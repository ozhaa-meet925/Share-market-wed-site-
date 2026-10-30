import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isDemoSessionActive } from './src/utils/marketHours.js';
import {
  closeKunDataConnection,
  getKunDataStatus,
  getKunHistory,
  getKunQuotes,
  isKunDataConfigured,
} from './kunDataProvider.js';
import { getYahooResearchProviderName, getYahooResearchQuotes, isYahooResearchEnabled } from './yfinanceResearchProvider.js';

dotenv.config();

const DATA_DIR = path.join(process.cwd(), 'data');
const STOCK_DB_PATH = path.join(DATA_DIR, 'stock_prices.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Function to load saved prices from disk
const loadStoredStockPrices = () => {
  try {
    if (fs.existsSync(STOCK_DB_PATH)) {
      const raw = fs.readFileSync(STOCK_DB_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not read stored stock prices, using memory default:', err.message);
  }
  return {};
};

// Function to save live prices to disk
const saveStoredStockPrices = (data) => {
  try {
    fs.writeFileSync(STOCK_DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save stock prices to disk:', err.message);
  }
};

const app = express();
app.use(express.json());
const PORT = process.env.PORT_PROXY || 3001;
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
const UPSTOX_BASE_URL = 'https://api.upstox.com/v3';
const UPSTOX_NSE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const UPSTOX_MCX_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz';
const UPSTOX_GLOBAL_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/global.json.gz';
const METAL_SPOT_API_URL = 'https://api.goldprice.dev/v1/prices';
const METAL_SPOT_CACHE_MS = 10 * 60 * 1000;
const METAL_SPOT_STALE_AFTER_MS = 20 * 60 * 1000;
const COMMODITY_BENCHMARK_CACHE_MS = 60 * 1000;
const COMMODITY_BENCHMARK_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const COMMODITY_BENCHMARKS = {
  CRUDEOIL: { yahooSymbol: 'CL=F', label: 'WTI crude futures', unit: 'INR/bbl', unitMultiplier: 1 },
  NATURALGAS: { yahooSymbol: 'NG=F', label: 'Henry Hub natural gas futures', unit: 'INR/MMBtu', unitMultiplier: 1 },
  ALUMINIUM: { yahooSymbol: 'ALI=F', label: 'COMEX aluminium futures', unit: 'INR/kg', unitMultiplier: 0.001 },
  ZINC: { yahooSymbol: 'ZNC=F', label: 'COMEX zinc futures', unit: 'INR/kg', unitMultiplier: 0.001 },
};
const commodityBenchmarkCache = new Map();
const commodityBenchmarkRequests = new Map();
let usdInrRateCache = null;
let usdInrRateRequest = null;
const TROY_OUNCE_IN_GRAMS = 31.1034768;
const ZERODHA_BASE_URL = 'https://api.kite.trade';
const GROWW_BASE_URL = 'https://api.groww.in/v1';
const FMP_BASE_URL = 'https://financialmodelingprep.com';
const FINANCE_CALENDAR_BASE_URL = 'https://www.financecalendar.com/wp-json/fc/v1';
const FINANCE_CALENDAR_SOURCE_URL = 'https://www.financecalendar.com/api/';
const calendarCache = new Map();

const CALENDAR_FEEDS = {
  economic: { endpoint: '/stable/economic-calendar', cacheMs: 10 * 60 * 1000, label: 'Economic calendar' },
  holidays: { endpoint: '/stable/holidays-by-exchange', cacheMs: 12 * 60 * 60 * 1000, label: 'NSE holiday calendar' },
  earnings: { endpoint: '/stable/earnings-calendar', cacheMs: 3 * 60 * 60 * 1000, label: 'Earnings calendar' },
  dividends: { endpoint: '/stable/dividends-calendar', cacheMs: 12 * 60 * 60 * 1000, label: 'Dividend calendar' },
  splits: { endpoint: '/stable/splits-calendar', cacheMs: 12 * 60 * 60 * 1000, label: 'Stock split calendar' },
  ipos: { endpoint: '/stable/ipos-calendar', cacheMs: 12 * 60 * 60 * 1000, label: 'IPO calendar' },
};

const fetchFmpCalendar = async (endpoint, params, cacheMs, cacheKey, forceRefresh = false) => {
  const cached = calendarCache.get(cacheKey);
  const now = Date.now();
  if (!forceRefresh && cached?.lastFailureAt && now - cached.lastFailureAt < 60_000) return { ...cached, stale: true };
  if (!forceRefresh && cached && !cached.stale && now - cached.fetchedAt < cacheMs) return cached;
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || /^(your_|paste_)/i.test(apiKey)) {
    const error = new Error('FMP_API_KEY is not configured.');
    error.code = 'calendar_provider_not_configured';
    throw error;
  }

  let response;
  try {
    response = await axios.get(`${FMP_BASE_URL}${endpoint}`, {
      params: { ...params, apikey: apiKey },
      timeout: 15_000,
    });
  } catch (error) {
    if (cached) {
      const staleCache = { ...cached, stale: true, lastFailureAt: Date.now() };
      calendarCache.set(cacheKey, staleCache);
      return staleCache;
    }
    throw error;
  }
  if (!Array.isArray(response.data)) {
    throw new Error('The calendar provider returned an unexpected response.');
  }
  const fetchedAt = Date.now();
  const result = { data: response.data, fetchedAt, lastUpdated: new Date(fetchedAt).toISOString(), stale: false };
  calendarCache.set(cacheKey, result);
  return result;
};

const fetchFinanceCalendar = async (endpoint, params, cacheMs, cacheKey, forceRefresh = false) => {
  const cached = calendarCache.get(cacheKey);
  const now = Date.now();
  if (!forceRefresh && cached?.lastFailureAt && now - cached.lastFailureAt < 60_000) return { ...cached, stale: true };
  if (!forceRefresh && cached && !cached.stale && now - cached.fetchedAt < cacheMs) return cached;

  let response;
  try {
    response = await axios.get(`${FINANCE_CALENDAR_BASE_URL}${endpoint}`, {
      params,
      timeout: 15_000,
    });
  } catch (error) {
    if (cached) {
      const staleCache = { ...cached, stale: true, lastFailureAt: Date.now() };
      calendarCache.set(cacheKey, staleCache);
      return staleCache;
    }
    throw error;
  }

  const data = Array.isArray(response.data?.events)
    ? response.data.events
    : Array.isArray(response.data?.holidays)
      ? response.data.holidays
      : null;
  if (!data) {
    throw new Error('Finance Calendar returned an unexpected response.');
  }
  const fetchedAt = Date.now();
  const result = {
    data,
    fetchedAt,
    lastUpdated: new Date(fetchedAt).toISOString(),
    stale: false,
  };
  calendarCache.set(cacheKey, result);
  return result;
};

const calendarDate = (value) => {
  const parts = String(value || '').split('-');
  if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2
    || parts.some((part) => [...part].some((character) => !'0123456789'.includes(character)))) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
};

const calendarDateString = (date) => date.toISOString().slice(0, 10);
const calendarText = (...values) => values.find((value) => value != null && String(value).trim())?.toString().trim() || '';

const normalizeCalendarEvent = (kind, item, index) => {
  const date = calendarText(item.date, item.exDate, item.ipoDate, item.announcementDate);
  if (!calendarDate(date)) return null;
  const symbol = calendarText(item.symbol, item.ticker);
  let title = '';
  let details = '';
  let eventTime = '';

  if (kind === 'economic') {
    title = calendarText(item.title, item.name, item.series_name, item.event, 'Economic release');
    eventTime = calendarText(item.time_local, item.time_ist);
    details = [item.time_local || item.time_utc, item.period, item.impact && `${item.impact} impact`, item.status].filter(Boolean).join(' · ');
  } else if (kind === 'holidays') {
    title = calendarText(item.title, item.name, item.holiday, 'Exchange holiday');
    details = calendarText(item.note, item.holiday_status === 'early_close' ? `NSE early close${item.close_time_local ? ` at ${item.close_time_local}` : ''}` : item.exchange && `${item.exchange.toUpperCase()} market closed`, 'NSE market closed');
  } else if (kind === 'earnings') {
    title = calendarText(item.companyName, item.company, symbol, 'Earnings announcement');
    eventTime = calendarText(item.time);
    details = [symbol && `NSE: ${symbol}`, item.time, item.epsEstimated != null && `EPS est. ${item.epsEstimated}`, item.revenueEstimated != null && `Revenue est. ${item.revenueEstimated}`].filter(Boolean).join(' · ');
  } else if (kind === 'dividends') {
    title = calendarText(item.companyName, item.company, symbol, 'Dividend');
    details = [symbol && `NSE: ${symbol}`, item.dividend != null && `Dividend ${item.dividend}`, item.recordDate && `Record ${item.recordDate}`, item.paymentDate && `Payment ${item.paymentDate}`].filter(Boolean).join(' · ');
  } else if (kind === 'splits') {
    title = calendarText(item.companyName, item.company, symbol, 'Stock split');
    const ratio = item.numerator != null && item.denominator != null ? `${item.numerator}:${item.denominator}` : '';
    details = [symbol && `NSE: ${symbol}`, ratio && `Split ratio ${ratio}`].filter(Boolean).join(' · ');
  } else if (kind === 'ipos') {
    title = calendarText(item.company, item.companyName, item.name, symbol, 'IPO');
    details = [symbol, item.priceRange, item.exchange, item.actions].filter(Boolean).join(' · ');
  }

  return { id: `${kind}-${date}-${symbol || index}`, date, title, details, symbol, time: eventTime };
};

const calendarPreviewTemplates = {
  earnings: { title: 'Sample quarterly earnings event', offset: 1 },
  dividends: { title: 'Sample dividend event', offset: 2 },
  splits: { title: 'Sample stock split event', offset: 3 },
  ipos: { title: 'Sample IPO opening event', offset: 4 },
};

const getCalendarPreviewEvents = (kind, from, to) => {
  const template = calendarPreviewTemplates[kind];
  const firstDate = calendarDate(from);
  const lastDate = calendarDate(to);
  if (!template || !firstDate || !lastDate) return [];

  const availableDays = Math.floor((lastDate - firstDate) / 86_400_000);
  if (availableDays < template.offset) return [];

  const date = new Date(firstDate);
  date.setUTCDate(date.getUTCDate() + template.offset);
  const eventDate = calendarDateString(date);
  return [{
    id: `preview-${kind}-${eventDate}`,
    date: eventDate,
    title: template.title,
    details: 'Preview only · not a real company or exchange announcement',
    symbol: 'DEMO',
  }];
};

const isIndianCalendarListing = (item) => {
  const symbol = calendarText(item.symbol, item.ticker).toUpperCase();
  const exchange = calendarText(item.exchangeShortName, item.exchange, item.exchangeName).toUpperCase();
  const country = calendarText(item.countryCode, item.country, item.countryName).toUpperCase();
  return /\.(NS|BO)$/.test(symbol)
    || /NSE|BSE|NATIONAL STOCK EXCHANGE|BOMBAY STOCK EXCHANGE/.test(exchange)
    || country === 'IN'
    || country === 'INDIA';
};

const getFinanceNseHolidays = async (from, to, forceRefresh = false) => {
  const fromDate = calendarDate(from);
  const toDate = calendarDate(to);
  if (!fromDate || !toDate) return { data: [], lastUpdated: null, stale: false, missingYears: [] };

  const years = [];
  for (let year = fromDate.getUTCFullYear(); year <= toDate.getUTCFullYear(); year += 1) years.push(year);
  const results = await Promise.allSettled(years.map((year) => fetchFinanceCalendar(
    '/holidays',
    { exchange: 'nse', year },
    CALENDAR_FEEDS.holidays.cacheMs,
    `finance:holidays:${year}`,
    forceRefresh,
  )));
  const available = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const missingYears = results.flatMap((result, index) => result.status === 'rejected' ? [years[index]] : []);
  if (!available.length && results.length) throw results.find((result) => result.status === 'rejected')?.reason;

  const uniqueHolidays = new Map();
  available.flatMap((feed) => feed.data)
    .filter((item) => item.date >= from && item.date <= to)
    .forEach((item) => {
      const identity = [item.date, calendarText(item.name).toLowerCase(), calendarText(item.status).toLowerCase(), calendarText(item.close_time_local)].join(':');
      uniqueHolidays.set(identity, item);
    });

  return {
    data: [...uniqueHolidays.values()],
    lastUpdated: available.map((feed) => feed.lastUpdated).filter(Boolean).sort().at(-1) || null,
    stale: available.some((feed) => feed.stale),
    missingYears,
  };
};

const getNseExpiryEvents = async (from, to, forceRefresh = false) => {
  let holidays = [];
  let holidayDatesAvailable = false;
  let holidayFeed;
  try {
    holidayFeed = await getFinanceNseHolidays(from, to, forceRefresh);
    holidays = holidayFeed.data.map((item) => calendarText(item.date)).filter(Boolean);
    holidayDatesAvailable = true;
  } catch (error) {
    console.warn('Could not load NSE holidays for expiry adjustment:', error.response?.status || error.message);
  }

  const fromDate = calendarDate(from);
  const toDate = calendarDate(to);
  const holidaySet = new Set(holidays);
  const events = [];
  if (!fromDate || !toDate) return { events, holidayDatesAvailable };

  for (let year = fromDate.getUTCFullYear(), month = fromDate.getUTCMonth(); year < toDate.getUTCFullYear() || (year === toDate.getUTCFullYear() && month <= toDate.getUTCMonth());) {
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const expiry = new Date(Date.UTC(year, month, lastDay.getUTCDate() - ((lastDay.getUTCDay() - 2 + 7) % 7)));
    const scheduledDate = calendarDateString(expiry);
    let holidayAdjusted = false;
    if (holidayDatesAvailable) {
      while (expiry.getUTCDay() === 0 || expiry.getUTCDay() === 6 || holidaySet.has(calendarDateString(expiry))) {
        expiry.setUTCDate(expiry.getUTCDate() - 1);
        holidayAdjusted = true;
      }
    }
    const date = calendarDateString(expiry);
    if (date >= from && date <= to) {
      events.push({
        id: `nse-expiry-${year}-${month + 1}`,
        date,
        title: 'NSE monthly equity derivatives expiry',
        details: holidayDatesAvailable
          ? `${holidayAdjusted ? `Last Tuesday ${scheduledDate} adjusted to previous trading day` : 'Last Tuesday of the expiry month'} · NSE rule-derived date`
          : 'Last Tuesday rule date · holiday adjustment could not be verified',
        symbol: 'NSE F&O',
        verifiedAgainstHolidays: holidayDatesAvailable,
      });
    }
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return { events, holidayDatesAvailable, lastUpdated: holidayFeed?.lastUpdated || null, stale: holidayDatesAvailable && Boolean(holidayFeed?.stale) };
};

const upstoxInstrumentKeys = {
  RELIANCE: 'NSE_EQ|INE002A01018',
  TCS: 'NSE_EQ|INE467B01029',
  HDFCBANK: 'NSE_EQ|INE040A01034',
  INFY: 'NSE_EQ|INE009A01021',
  ITC: 'NSE_EQ|INE154A01025',
  SBIN: 'NSE_EQ|INE062A01020',
  ICICIBANK: 'NSE_EQ|INE090A01021',
  MARUTI: 'NSE_EQ|INE585B01010',
  BHARTIARTL: 'NSE_EQ|INE397D01024',
  LT: 'NSE_EQ|INE018A01030',
  AXISBANK: 'NSE_EQ|INE238A01034',
  KOTAKBANK: 'NSE_EQ|INE237A01028',
  ADANIENT: 'NSE_EQ|INE423A01024',
  SUNPHARMA: 'NSE_EQ|INE044A01036',
  TITAN: 'NSE_EQ|INE280A01028',
  BAJFINANCE: 'NSE_EQ|INE296A01024',
  WIPRO: 'NSE_EQ|INE075A01022',
  ASIANPAINT: 'NSE_EQ|INE021A01026',
  HINDALCO: 'NSE_EQ|INE038A01020',
  ONGC: 'NSE_EQ|INE213A01029',
  NTPC: 'NSE_EQ|INE733E01010',
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  NIFTYIT: 'NSE_INDEX|Nifty IT',
  SENSEX: 'BSE_INDEX|SENSEX',
};

const upstoxDynamicInstrumentKeys = new Map();
let upstoxInstrumentMasterFetchedAt = 0;
let upstoxInstrumentMasterRequest = null;
const metalSpotCache = new Map();
const metalSpotRequests = new Map();

const toProviderSymbol = (symbol) => symbol
  .replace(/^(NSE|BSE|MCX|GLOBAL):/i, '')
  .replace(/\.BSE$|\.NSE$/i, '')
  .toUpperCase();

// Load high accuracy real Indian market base prices if available
const REAL_BASES_PATH = path.join(DATA_DIR, 'real_market_bases.json');
let realMarketBases = {};
try {
  if (fs.existsSync(REAL_BASES_PATH)) {
    realMarketBases = JSON.parse(fs.readFileSync(REAL_BASES_PATH, 'utf-8'));
  }
} catch (e) {
  console.warn('Could not load real_market_bases.json:', e.message);
}

const defaultBasePrices = {
  ...realMarketBases,
  RELIANCE: { price: 1260.10, previousClose: 1252.30, name: 'Reliance Industries', sector: 'Energy' },
  TCS: { price: 4148.9, previousClose: 4171.05, name: 'Tata Consultancy Services', sector: 'IT' },
  HDFCBANK: { price: 1681.3, previousClose: 1662.55, name: 'HDFC Bank', sector: 'Banking' },
  INFY: { price: 1546.25, previousClose: 1534.85, name: 'Infosys', sector: 'IT' },
  ITC: { price: 486.95, previousClose: 490.05, name: 'ITC Limited', sector: 'FMCG' },
  SBIN: { price: 812.7, previousClose: 802.9, name: 'State Bank of India', sector: 'Banking' },
  ICICIBANK: { price: 1242.6, previousClose: 1227.25, name: 'ICICI Bank', sector: 'Banking' },
  MARUTI: { price: 12684.5, previousClose: 12781.3, name: 'Maruti Suzuki', sector: 'Auto' },
  BHARTIARTL: { price: 1684.2, previousClose: 1662.65, name: 'Bharti Airtel', sector: 'Telecom' },
  LT: { price: 3682.75, previousClose: 3664.45, name: 'Larsen & Toubro', sector: 'Capital Goods' },
  AXISBANK: { price: 1172.6, previousClose: 1181.05, name: 'Axis Bank', sector: 'Banking' },
  KOTAKBANK: { price: 1988.4, previousClose: 1976.25, name: 'Kotak Mahindra Bank', sector: 'Banking' },
  ADANIENT: { price: 2478.9, previousClose: 2510.5, name: 'Adani Enterprises', sector: 'Metals' },
  SUNPHARMA: { price: 1768.35, previousClose: 1748.45, name: 'Sun Pharma', sector: 'Pharma' },
  TITAN: { price: 3562.1, previousClose: 3536.7, name: 'Titan Company', sector: 'Consumer' },
  BAJFINANCE: { price: 7962.8, previousClose: 8031.25, name: 'Bajaj Finance', sector: 'Finance' },
  WIPRO: { price: 548.2, previousClose: 543.35, name: 'Wipro', sector: 'IT' },
  ASIANPAINT: { price: 2384.7, previousClose: 2398.9, name: 'Asian Paints', sector: 'Consumer' },
  HINDALCO: { price: 714.6, previousClose: 705.85, name: 'Hindalco Industries', sector: 'Metals' },
  ONGC: { price: 286.45, previousClose: 283.25, name: 'ONGC', sector: 'Energy' },
  NTPC: { price: 418.3, previousClose: 420.9, name: 'NTPC Limited', sector: 'Energy' },
  NIFTY: { price: 24891.3, previousClose: 24772.1, name: 'NIFTY 50', sector: 'Index' },
  SENSEX: { price: 81420.5, previousClose: 81090.2, name: 'BSE SENSEX', sector: 'Index' },
  BANKNIFTY: { price: 51248.75, previousClose: 50820.5, name: 'BANK NIFTY', sector: 'Index' },
};

// Stateful memory for live simulated ticks
// Stateful memory for live simulated ticks (hydrated from disk)
const storedPrices = loadStoredStockPrices();
const liveState = new Map();

const getOrInitState = (symbol) => {
  const cleanSymbol = symbol.toUpperCase().replace(/^NSE:|^BSE:|\.BSE$|\.NSE$/i, '');
  if (!liveState.has(cleanSymbol)) {
    const saved = storedPrices[cleanSymbol];
    const demoPriceBySymbol = {
      NIFTY: 25000, SENSEX: 82000, BANKNIFTY: 54000, NIFTYIT: 40000, NIFTYMIDCAP: 50000,
      GIFTNIFTY: 25000, DOWJONES: 43000, SP500: 6000, NASDAQ: 20000, FTSE100: 8500,
      GOLD: 80000, SILVER: 100000, CRUDEOIL: 6000, NATURALGAS: 300,
      COPPER: 800, ALUMINIUM: 250, ZINC: 250, USDINR: 85, BZUSD: 75,
    }[cleanSymbol];
    const fallbackPrice = 1000 + ((cleanSymbol.charCodeAt(0) || 75) * 12);
    // Prioritize official base prices from catalog over saved drifting values
    const hasDefault = Boolean(defaultBasePrices[cleanSymbol]);
    const base = defaultBasePrices[cleanSymbol] || (demoPriceBySymbol ? {
      price: demoPriceBySymbol,
      previousClose: Number((demoPriceBySymbol * 0.995).toFixed(2)),
      name: cleanSymbol,
      sector: 'Demo',
    } : {
      price: saved?.currentPrice || fallbackPrice,
      previousClose: saved?.previousClose || fallbackPrice * 0.992,
      name: cleanSymbol,
      sector: 'General',
    });
    const currentPrice = (hasDefault || demoPriceBySymbol) ? base.price : (saved?.currentPrice || base.price);
    const openPrice = base.previousClose * (1 + (Math.sin(cleanSymbol.length) * 0.003));

    liveState.set(cleanSymbol, {
      symbol: cleanSymbol,
      currentPrice: Number(currentPrice.toFixed(2)),
      previousClose: Number(base.previousClose.toFixed(2)),
      open: Number(openPrice.toFixed(2)),
      high: Number(((demoPriceBySymbol ? null : saved?.high) || Math.max(currentPrice, base.previousClose) * 1.012).toFixed(2)),
      low: Number(((demoPriceBySymbol ? null : saved?.low) || Math.min(currentPrice, base.previousClose) * 0.988).toFixed(2)),
      volume: saved?.volume || 1250000 + (cleanSymbol.length * 85000),
      lastUpdate: Date.now(),
      name: base.name,
      trades: [],
    });

    // Populate initial trade tape
    const item = liveState.get(cleanSymbol);
    const now = Date.now();
    for (let i = 10; i >= 0; i--) {
      const tradeTime = new Date(now - i * 4000).toLocaleTimeString('en-IN', { hour12: false });
      const variance = (Math.random() - 0.49) * 0.002;
      const tradePrice = Number((item.currentPrice * (1 + variance)).toFixed(2));
      const qty = Math.floor(15 + Math.random() * 450);
      item.trades.push({
        id: `tr_${now - i * 4000}_${i}`,
        time: tradeTime,
        price: tradePrice,
        quantity: qty,
        side: variance >= 0 ? 'BUY' : 'SELL',
      });
    }
  }
  return liveState.get(cleanSymbol);
};

// Periodic auto-sync to disk storage every 10 seconds
// Zerodha (Kite Connect) batch quote proxy
app.get('/api/zerodha/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'No symbols supplied' });

  const token = process.env.ZERODHA_TOKEN;
  const base = process.env.ZERODHA_BASE_URL || 'https://api.kite.trade';

  if (!token) {
    // Fallback to simulated data per symbol
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    return res.json(fallback);
  }

  try {
    const url = `${base}/quote?i=${symbols.join(',')}`;
    const resp = await fetch(url, { headers: { Authorization: `token ${token}` } });
    if (!resp.ok) throw new Error(`Zerodha ${resp.status}`);
    const raw = await resp.json();
    const formatted = symbols.reduce((out, sym) => {
      const q = raw[sym];
      if (q) {
        out[sym] = {
          c: q.last_price,
          d: q.change,
          dp: (q.change / q.last_price) * 100,
          h: q.high_price,
          l: q.low_price,
          o: q.open_price,
          pc: q.close_price,
          v: q.volume,
          isLive: true,
          provider: 'Zerodha',
          timestamp: new Date().toISOString(),
        };
      }
      return out;
    }, {});
    res.json(formatted);
  } catch (e) {
    console.error('Zerodha proxy error → fallback', e);
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    res.json(fallback);
  }
});
// RapidAPI (e.g., Yahoo Finance) batch quote proxy – fallback when Zerodha is unavailable
app.get('/api/rapid/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'No symbols supplied' });

  const rapidKey = process.env.RAPIDAPI_KEY;
  const rapidHost = process.env.RAPIDAPI_HOST; // e.g., 'yfapi.net'
  if (!rapidKey || !rapidHost) {
    console.warn('RapidAPI credentials missing – falling back to simulated data');
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    return res.json(fallback);
  }

  try {
    const url = `https://${rapidHost}/stock/v2/get-summary?symbol=${symbols.join(',')}`;
    const resp = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': rapidKey,
        'X-RapidAPI-Host': rapidHost,
      },
    });
    if (!resp.ok) throw new Error(`RapidAPI ${resp.status}`);
    const raw = await resp.json(); // structure depends on the chosen API
    // Assume raw is an array [{symbol, price, open, high, low, previousClose, volume, change, changePercent, timestamp}]
    const formatted = {};
    raw.forEach((q) => {
      const sym = q.symbol?.toUpperCase();
      if (!sym) return;
      formatted[sym] = {
        c: q.price,
        d: q.change,
        dp: q.changePercent,
        h: q.high,
        l: q.low,
        o: q.open,
        pc: q.previousClose,
        v: q.volume,
        isLive: true,
        provider: 'RapidAPI',
        timestamp: q.timestamp || new Date().toISOString(),
      };
    });
    res.json(formatted);
  } catch (e) {
    console.error('RapidAPI proxy error → fallback', e);
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    res.json(fallback);
  }
});
// Existing Zerodha route remains above
setInterval(() => {
  if (!liveState.size) return;
  const snapshot = {};
  for (const [sym, state] of liveState.entries()) {
    snapshot[sym] = {
      symbol: state.symbol,
      currentPrice: state.currentPrice,
      previousClose: state.previousClose,
      open: state.open,
      high: state.high,
      low: state.low,
      volume: state.volume,
      lastUpdate: state.lastUpdate,
      name: state.name,
    };
  }
  saveStoredStockPrices(snapshot);
}, 10000);

const tickSymbol = (cleanSymbol) => {
  const item = getOrInitState(cleanSymbol);
  if (!isDemoSessionActive()) return item;
  const now = Date.now();
  // Mean-reverting micro fluctuation around previousClose (within realistic ±2.5% intraday range)
  const basePrice = defaultBasePrices[cleanSymbol]?.price || item.previousClose;
  const deviation = (item.currentPrice - basePrice) / basePrice;
  // Mean reversion pull factor: if price drifted up, bias downwards and vice versa
  const pull = -deviation * 0.08;
  const randomShock = (Math.random() - 0.5) * 0.0018;
  const deltaFactor = randomShock + pull;

  const rawPrice = item.currentPrice * (1 + deltaFactor);
  // Clamp between ±3% of baseline to guarantee realistic market quotes
  const minAllowed = Number((basePrice * 0.97).toFixed(2));
  const maxAllowed = Number((basePrice * 1.03).toFixed(2));
  item.currentPrice = Number(Math.max(minAllowed, Math.min(maxAllowed, rawPrice)).toFixed(2));
  item.high = Number(Math.max(item.high, item.currentPrice).toFixed(2));
  item.low = Number(Math.min(item.low, item.currentPrice).toFixed(2));
  const tradeVol = Math.floor(25 + Math.random() * 600);
  item.volume += tradeVol;
  item.lastUpdate = now;

  const timeStr = new Date(now).toLocaleTimeString('en-IN', { hour12: false });
  item.trades.unshift({
    id: `tr_${now}_${Math.floor(Math.random() * 10000)}`,
    time: timeStr,
    price: item.currentPrice,
    quantity: tradeVol,
    side: deltaFactor >= 0 ? 'BUY' : 'SELL',
  });
  if (item.trades.length > 40) item.trades.pop();

  return item;
};

// ── Server-side 1-second auto-tick for all active symbols ──────────────────
// Ensures prices are ALWAYS changing every second, even between frontend polls
// Zerodha (Kite Connect) batch quote proxy
app.get('/api/zerodha/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'No symbols supplied' });

  const token = process.env.ZERODHA_TOKEN;
  const base = process.env.ZERODHA_BASE_URL || 'https://api.kite.trade';

  if (!token) {
    // Fallback to simulated data per symbol
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    return res.json(fallback);
  }

  try {
    const url = `${base}/quote?i=${symbols.join(',')}`;
    const resp = await fetch(url, { headers: { Authorization: `token ${token}` } });
    if (!resp.ok) throw new Error(`Zerodha ${resp.status}`);
    const raw = await resp.json();
    const formatted = symbols.reduce((out, sym) => {
      const q = raw[sym];
      if (q) {
        out[sym] = {
          c: q.last_price,
          d: q.change,
          dp: (q.change / q.last_price) * 100,
          h: q.high_price,
          l: q.low_price,
          o: q.open_price,
          pc: q.close_price,
          v: q.volume,
          isLive: true,
          provider: 'Zerodha',
          timestamp: new Date().toISOString(),
        };
      }
      return out;
    }, {});
    res.json(formatted);
  } catch (e) {
    console.error('Zerodha proxy error → fallback', e);
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    res.json(fallback);
  }
});
// RapidAPI (e.g., Yahoo Finance) batch quote proxy – fallback when Zerodha is unavailable
app.get('/api/rapid/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'No symbols supplied' });

  const rapidKey = process.env.RAPIDAPI_KEY;
  const rapidHost = process.env.RAPIDAPI_HOST; // e.g., 'yfapi.net'
  if (!rapidKey || !rapidHost) {
    console.warn('RapidAPI credentials missing – falling back to simulated data');
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    return res.json(fallback);
  }

  try {
    const url = `https://${rapidHost}/stock/v2/get-summary?symbol=${symbols.join(',')}`;
    const resp = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': rapidKey,
        'X-RapidAPI-Host': rapidHost,
      },
    });
    if (!resp.ok) throw new Error(`RapidAPI ${resp.status}`);
    const raw = await resp.json(); // structure depends on the chosen API
    // Assume raw is an array [{symbol, price, open, high, low, previousClose, volume, change, changePercent, timestamp}]
    const formatted = {};
    raw.forEach((q) => {
      const sym = q.symbol?.toUpperCase();
      if (!sym) return;
      formatted[sym] = {
        c: q.price,
        d: q.change,
        dp: q.changePercent,
        h: q.high,
        l: q.low,
        o: q.open,
        pc: q.previousClose,
        v: q.volume,
        isLive: true,
        provider: 'RapidAPI',
        timestamp: q.timestamp || new Date().toISOString(),
      };
    });
    res.json(formatted);
  } catch (e) {
    console.error('RapidAPI proxy error → fallback', e);
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    res.json(fallback);
  }
});
// Existing Zerodha route remains above
setInterval(() => {
  if (!liveState.size || !isDemoSessionActive()) return;
  for (const symbol of liveState.keys()) {
    tickSymbol(symbol);
  }
}, 1000);

const generateDynamicQuote = (rawSymbol) => {
  const cleanSymbol = rawSymbol.toUpperCase().replace(/^(NSE|BSE|MCX|GLOBAL):/i, '').replace(/\.BSE$|\.NSE$/i, '');
  const item = tickSymbol(cleanSymbol);
  const change = Number((item.currentPrice - item.previousClose).toFixed(2));
  const changePercent = Number(((change / item.previousClose) * 100).toFixed(2));

  return {
    c: item.currentPrice,
    d: change,
    dp: changePercent,
    h: item.high,
    l: item.low,
    o: item.open,
    pc: item.previousClose,
    v: item.volume,
    latestTradingDay: new Date(item.lastUpdate).toISOString(),
    timestamp: item.lastUpdate,
    symbol: cleanSymbol,
    provider: 'Simulated demo feed · not real market data',
    marketOpen: isDemoSessionActive(),
    isLive: false,
    isDemo: true,
  };
};

const generateMarketDepth = (rawSymbol) => {
  const cleanSymbol = rawSymbol.toUpperCase().replace(/^NSE:|^BSE:|\.BSE$|\.NSE$/i, '');
  const item = getOrInitState(cleanSymbol);
  const price = item.currentPrice;

  // 5 levels of bids below price
  const bids = [0.04, 0.12, 0.25, 0.45, 0.75].map((offset, i) => {
    const bidPrice = Number((price - (price * (offset / 100))).toFixed(2));
    const qty = Math.floor(350 + Math.abs(Math.sin((Date.now() / 1200) + i * 1.5)) * 4200);
    const orders = Math.floor(3 + Math.random() * 24);
    return { price: bidPrice, quantity: qty, orders };
  });

  // 5 levels of asks above price
  const asks = [0.04, 0.12, 0.25, 0.45, 0.75].map((offset, i) => {
    const askPrice = Number((price + (price * (offset / 100))).toFixed(2));
    const qty = Math.floor(350 + Math.abs(Math.cos((Date.now() / 1200) + i * 1.5)) * 4200);
    const orders = Math.floor(3 + Math.random() * 24);
    return { price: askPrice, quantity: qty, orders };
  });

  const totalBidQty = bids.reduce((acc, b) => acc + b.quantity, 0);
  const totalAskQty = asks.reduce((acc, a) => acc + a.quantity, 0);

  return {
    symbol: cleanSymbol,
    price,
    bids,
    asks,
    totalBidQty,
    totalAskQty,
    spread: Number((asks[0].price - bids[0].price).toFixed(2)),
    timestamp: Date.now(),
  };
};

const generateFallbackCandles = (cleanSymbol) => {
  const item = getOrInitState(cleanSymbol);
  const base = item.previousClose || item.currentPrice;
  const count = 45;
  const now = Math.floor(Date.now() / 1000);
  const daySec = 86400;
  const candles = [];
  let curr = base * 0.94;

  for (let i = count; i >= 0; i--) {
    const t = now - (i * daySec);
    const wave = Math.sin(i * 0.24) * 0.014;
    const rnd = (Math.random() - 0.48) * 0.016;
    const open = curr;
    curr = curr * (1 + wave + rnd);
    const close = i === 0 ? item.currentPrice : curr;
    const high = Math.max(open, close) * (1 + Math.random() * 0.007);
    const low = Math.min(open, close) * (1 - Math.random() * 0.007);
    const vol = Math.floor(650000 + Math.random() * 1800000);
    candles.push({
      time: t,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      value: vol,
    });
  }

  return {
    s: 'ok',
    t: candles.map((c) => c.time),
    o: candles.map((c) => c.open),
    h: candles.map((c) => c.high),
    l: candles.map((c) => c.low),
    c: candles.map((c) => c.close),
    v: candles.map((c) => c.value),
  };
};

const fallbackNews = [
  {
    id: 1,
    headline: 'RBI Monetary Policy: MPC retains repo rate at 6.5%, projects FY27 GDP growth at 7.2%',
    summary: 'The Reserve Bank of India maintained liquidity support while highlighting resilient credit expansion, steady urban consumption, and robust manufacturing PMI.',
    source: 'Economic Times',
    datetime: Math.floor(Date.now() / 1000) - 300,
    category: 'general',
    url: '/news',
  },
  {
    id: 2,
    headline: 'Nifty IT surges 2.4% as TCS and Infosys secure multi-billion dollar AI transformation deals',
    summary: 'Enterprise demand for generative AI migration, cloud modernization, and ERP refreshes accelerates revenue visibility for top Indian IT exporters.',
    source: 'LiveMint',
    datetime: Math.floor(Date.now() / 1000) - 900,
    category: 'Stocks',
    url: '/news',
  },
  {
    id: 3,
    headline: 'Tata Technologies arm files draft red herring prospectus with SEBI for Rs 4,500 crore mega IPO',
    summary: 'The issue comprises an offer for sale alongside fresh equity capital infusion targeted at EV software R&D and global design studio expansions.',
    source: 'MoneyControl',
    datetime: Math.floor(Date.now() / 1000) - 1800,
    category: 'IPO',
    url: '/news',
  },
  {
    id: 4,
    headline: 'Gold prices breach Rs 78,500 per 10 grams amid global central bank buying and geopolitical hedge',
    summary: 'Spot gold surged to fresh historic peaks on MCX as continued bullion accumulation by sovereign central banks bolstered long-term retail demand.',
    source: 'Business Standard',
    datetime: Math.floor(Date.now() / 1000) - 2700,
    category: 'Gold',
    url: '/news',
  },
  {
    id: 5,
    headline: 'Silver crosses Rs 92,000/kg on unprecedented industrial consumption across solar PV and EV sectors',
    summary: 'Rising photovoltaic manufacturing demand coupled with tightening global mine supply drove domestic silver contracts to aggressive multi-year highs.',
    source: 'Financial Express',
    datetime: Math.floor(Date.now() / 1000) - 3600,
    category: 'Silver',
    url: '/news',
  },
  {
    id: 6,
    headline: 'Mutual Fund SIP monthly inflows register record Rs 24,150 crore in September; retail folio count tops 19 crore',
    summary: 'AMFI data shows systematic investment contributions reaching historic records, driven by persistent domestic household allocation toward diversified equity schemes.',
    source: 'NDTV Profit',
    datetime: Math.floor(Date.now() / 1000) - 5400,
    category: 'Mutual Funds',
    url: '/news',
  },
  {
    id: 7,
    headline: 'HDFC Bank and ICICI Bank lead Bank Nifty rally as net interest margins stabilize and asset quality shines',
    summary: "India's largest private lenders logged robust deposit franchise momentum with gross NPA ratios declining to historic cyclical lows.",
    source: 'Zee Business',
    datetime: Math.floor(Date.now() / 1000) - 7200,
    category: 'Stocks',
    url: '/news',
  },
  {
    id: 8,
    headline: 'FIIs turn net buyers injecting Rs 4,280 crore while DIIs pump Rs 3,950 crore into Indian equities',
    summary: 'Institutional liquidity supported domestic benchmark indices Nifty 50 and Sensex towards fresh record milestones across high-beta sectors.',
    source: 'The Hindu Business Line',
    datetime: Math.floor(Date.now() / 1000) - 9000,
    category: 'general',
    url: '/news',
  },
  {
    id: 9,
    headline: 'Swiggy IPO subscribed 3.8 times on final day with aggressive QIB demand and strong anchor participation',
    summary: 'The quick-commerce and food delivery giant attracted Rs 11,327 crore in bids, led by marquee sovereign wealth funds and domestic mutual funds.',
    source: 'Economic Times',
    datetime: Math.floor(Date.now() / 1000) - 10800,
    category: 'IPO',
    url: '/news',
  },
  {
    id: 10,
    headline: 'Auto sector posts double-digit festive wholesale dispatch growth led by Maruti, Mahindra, and Tata Motors',
    summary: 'SUV demand resilience, expanding EV portfolio penetration, and positive rural farm harvest cashflows fueled vehicle deliveries across OEM dealer networks.',
    source: 'LiveMint',
    datetime: Math.floor(Date.now() / 1000) - 12600,
    category: 'Stocks',
    url: '/news',
  },
  {
    id: 11,
    headline: 'Sovereign Gold Bonds deliver 13.8% CAGR returns upon maturity as domestic physical premiums stay elevated',
    summary: 'RBI redemption tranches reward long-term bullion investors tax-free capital gains alongside bi-annual sovereign coupon distributions.',
    source: 'MoneyControl',
    datetime: Math.floor(Date.now() / 1000) - 14400,
    category: 'Gold',
    url: '/news',
  },
  {
    id: 12,
    headline: 'Flexi-cap and Large-and-Midcap funds see strongest net inflows as investors balance growth and volatility',
    summary: 'Fund managers recalibrate active portfolio weights into domestic manufacturing, capital goods, and healthcare counters amidst valuation disparity.',
    source: 'Business Standard',
    datetime: Math.floor(Date.now() / 1000) - 18000,
    category: 'Mutual Funds',
    url: '/news',
  },
  {
    id: 13,
    headline: "Sun Pharma and Dr Reddy's rally on US FDA clearance for key injectable formulations and biosimilar launches",
    summary: 'Indian pharmaceutical majors expand specialty and complex generic footprints across US and European markets with favorable pricing dynamics.',
    source: 'NDTV Profit',
    datetime: Math.floor(Date.now() / 1000) - 21600,
    category: 'Stocks',
    url: '/news',
  },
  {
    id: 14,
    headline: 'SEBI introduces new framework for index derivatives eligibility to protect retail options traders',
    summary: 'The market regulator raised minimum contract sizes and rationalized weekly expiry contracts per exchange to curb speculative derivative leverage.',
    source: 'The Hindu Business Line',
    datetime: Math.floor(Date.now() / 1000) - 25200,
    category: 'general',
    url: '/news',
  },
  {
    id: 15,
    headline: 'MCX Silver delivery stocks hit 6-month low as electronics and AI hardware demand tightens availability',
    summary: 'Physical warehouses report sharp drawdown in bullion bars as high-conductivity electronics manufacturing outpaces quarterly imports.',
    source: 'Zee Business',
    datetime: Math.floor(Date.now() / 1000) - 28800,
    category: 'Silver',
    url: '/news',
  },
  {
    id: 16,
    headline: 'Hyundai Motor India makes landmark market debut after raising historic Rs 27,870 crore in public offering',
    summary: 'India largest ever initial public offering establishes strong institutional backing, signaling confidence in domestic automotive manufacturing.',
    source: 'Financial Express',
    datetime: Math.floor(Date.now() / 1000) - 32400,
    category: 'IPO',
    url: '/news',
  },
  {
    id: 17,
    headline: 'Small-cap fund NAVs rebound 3.2% as institutional managers cherry-pick quality cyclical beneficiaries',
    summary: 'Following recent valuation corrections, fund houses deploy cash reserves into defense engineering, infrastructure, and renewable power contractors.',
    source: 'Economic Times',
    datetime: Math.floor(Date.now() / 1000) - 39600,
    category: 'Mutual Funds',
    url: '/news',
  },
  {
    id: 18,
    headline: 'Reliance Industries outlines Rs 75,000 crore capital expenditure roadmap for new energy and 5G monetisation',
    summary: 'Jio Infocomm ARPU expansion and green hydrogen giga-factory commissioning schedule provide strong medium-term earnings visibility for the conglomerate.',
    source: 'LiveMint',
    datetime: Math.floor(Date.now() / 1000) - 46800,
    category: 'Stocks',
    url: '/news',
  },
  {
    id: 19,
    headline: "India's manufacturing PMI climbs to 57.5 signaling fastest output and order book expansion in 16 months",
    summary: 'Export orders and domestic consumption indices both showed marked acceleration, encouraging industrial capacity additions across corporate India.',
    source: 'MoneyControl',
    datetime: Math.floor(Date.now() / 1000) - 57600,
    category: 'general',
    url: '/news',
  },
  {
    id: 20,
    headline: 'Jewellery retailers report 25% surge in festive advance bookings despite elevated gold prices',
    summary: 'Consumer preference for hallmarked 22K and 18K bridal jewellery remains resilient with wedding season demand driving physical gold retail sales.',
    source: 'The Hindu Business Line',
    datetime: Math.floor(Date.now() / 1000) - 72000,
    category: 'Gold',
    url: '/news',
  },
];

const toAlphaVantageSymbol = (symbol) => {
  if (symbol.includes('.')) return symbol;
  return `${symbol}${process.env.ALPHA_VANTAGE_SYMBOL_SUFFIX || '.BSE'}`;
};
const toZerodhaSymbol = (symbol) => (symbol.includes(':') ? symbol : `NSE:${symbol}`);
const parseSymbolMap = (value) => {
  if (!value) return {};
  return value.split(',').reduce((map, pair) => {
    const [symbol, brokerSymbol] = pair.split('=').map((item) => item?.trim());
    if (symbol && brokerSymbol) map[symbol.toUpperCase()] = brokerSymbol;
    return map;
  }, {});
};
const toUpstoxInstrumentKey = (symbol) => {
  if (symbol.includes('|')) return symbol;
  const overrides = parseSymbolMap(process.env.UPSTOX_SYMBOL_MAP);
  const clean = toProviderSymbol(symbol);
  if (/^MCX:/i.test(symbol)) return upstoxDynamicInstrumentKeys.get(`MCX:${clean}`) || null;
  if (/^GLOBAL:/i.test(symbol)) {
    return upstoxDynamicInstrumentKeys.get(`GLOBAL:${clean}`)
      || (clean === 'SGX NIFTY' ? 'GLOBAL_INDEX|SGX NIFTY' : null);
  }
  const exchange = /^BSE:/i.test(symbol) ? 'BSE' : 'NSE';
  return overrides[clean] || upstoxInstrumentKeys[clean]
    || upstoxDynamicInstrumentKeys.get(`${exchange}:${clean}`)
    || upstoxDynamicInstrumentKeys.get(clean)
    || null;
};

const loadUpstoxInstrumentMaster = async () => {
  if (Date.now() - upstoxInstrumentMasterFetchedAt < 24 * 60 * 60 * 1000) return;
  if (upstoxInstrumentMasterRequest) return upstoxInstrumentMasterRequest;
  upstoxInstrumentMasterRequest = (async () => {
    const fetchMaster = async (url) => {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 12000 });
      return JSON.parse(gunzipSync(response.data).toString('utf8'));
    };
    const [nseResult, mcxResult, globalResult] = await Promise.allSettled([
      fetchMaster(UPSTOX_NSE_INSTRUMENTS_URL),
      fetchMaster(UPSTOX_MCX_INSTRUMENTS_URL),
      fetchMaster(UPSTOX_GLOBAL_INSTRUMENTS_URL),
    ]);
    if (nseResult.status === 'fulfilled') {
      for (const instrument of nseResult.value) {
        if (instrument?.segment !== 'NSE_EQ' || instrument.instrument_type !== 'EQ' || !instrument.instrument_key || !instrument.trading_symbol) continue;
        const symbol = instrument.trading_symbol.toUpperCase();
        upstoxDynamicInstrumentKeys.set(symbol, instrument.instrument_key);
        upstoxDynamicInstrumentKeys.set(`NSE:${symbol}`, instrument.instrument_key);
      }
    } else {
      console.warn('Could not load Upstox NSE instruments:', nseResult.reason?.message);
    }
    if (mcxResult.status === 'fulfilled') {
      const products = ['GOLD', 'SILVER', 'CRUDEOIL', 'NATURALGAS', 'COPPER', 'ALUMINIUM', 'ZINC'];
      for (const product of products) {
        const contracts = mcxResult.value
          .filter((instrument) => instrument?.segment === 'MCX_FO'
            && instrument.instrument_type === 'FUT'
            && instrument.underlying_symbol?.toUpperCase() === product
            && instrument.instrument_key)
          .map((instrument) => ({
            instrument,
            expiry: typeof instrument.expiry === 'number' ? instrument.expiry : Date.parse(instrument.expiry),
          }))
          .filter(({ expiry }) => Number.isFinite(expiry) && expiry > Date.now())
          .sort((first, second) => first.expiry - second.expiry);
        if (contracts[0]) upstoxDynamicInstrumentKeys.set(`MCX:${product}`, contracts[0].instrument.instrument_key);
      }
    } else {
      console.warn('Could not load Upstox MCX instruments:', mcxResult.reason?.message);
    }
    if (globalResult.status === 'fulfilled') {
      for (const instrument of globalResult.value) {
        if (!instrument?.instrument_key) continue;
        const name = String(instrument.name || '').toLowerCase();
        const tradingSymbol = String(instrument.trading_symbol || '').toUpperCase();
        if (name.includes('usd inr') || tradingSymbol === 'USDINR') {
          upstoxDynamicInstrumentKeys.set('GLOBAL:USDINR', instrument.instrument_key);
        }
        if (name.includes('oil (brent)') || tradingSymbol === 'BZUSD') {
          upstoxDynamicInstrumentKeys.set('GLOBAL:BZUSD', instrument.instrument_key);
        }
        if (name.includes('gift nifty') || tradingSymbol === 'SGX NIFTY') {
          upstoxDynamicInstrumentKeys.set('GLOBAL:SGX NIFTY', instrument.instrument_key);
        }
      }
    } else {
      console.warn('Could not load Upstox global instruments:', globalResult.reason?.message);
    }
    upstoxInstrumentMasterFetchedAt = Date.now();
    console.info(`Loaded Upstox instrument keys for ${upstoxDynamicInstrumentKeys.size} NSE, MCX and global symbols.`);
    upstoxInstrumentMasterRequest = null;
  })();
  upstoxInstrumentMasterRequest.catch(() => {
    upstoxInstrumentMasterFetchedAt = Date.now() - 23 * 60 * 60 * 1000;
    upstoxInstrumentMasterRequest = null;
  });
  return upstoxInstrumentMasterRequest;
};
const getMarketProvider = () => (process.env.MARKET_DATA_PROVIDER || 'kun').toLowerCase();
const isProviderConfigured = (provider = getMarketProvider()) => {
  if (provider === 'kun') return isKunDataConfigured();
  if (provider === 'upstox') return Boolean(process.env.UPSTOX_ACCESS_TOKEN);
  if (provider === 'zerodha') return Boolean(process.env.ZERODHA_API_KEY && process.env.ZERODHA_ACCESS_TOKEN);
  if (provider === 'alpha_vantage') return Boolean(process.env.ALPHA_VANTAGE_API_KEY);
  if (provider === 'groww') return Boolean(process.env.GROWW_ACCESS_TOKEN);
  return true; // Live Market Engine is built-in
};
const isLiveMarketProviderConfigured = (provider = getMarketProvider()) =>
  ['groww', 'kun', 'upstox', 'zerodha'].includes(provider) && isProviderConfigured(provider);

const parseAlphaNumber = (value) => {
  const number = Number.parseFloat(String(value ?? '').replace('%', ''));
  return Number.isFinite(number) ? number : null;
};

const normalizeAlphaQuote = (payload) => {
  const quote = payload?.['Global Quote'];
  if (!quote || !parseAlphaNumber(quote['05. price'])) return null;
  return {
    c: parseAlphaNumber(quote['05. price']),
    d: parseAlphaNumber(quote['09. change']),
    dp: parseAlphaNumber(quote['10. change percent']),
    h: parseAlphaNumber(quote['03. high']),
    l: parseAlphaNumber(quote['04. low']),
    o: parseAlphaNumber(quote['02. open']),
    pc: parseAlphaNumber(quote['08. previous close']),
    v: parseAlphaNumber(quote['06. volume']),
    latestTradingDay: quote['07. latest trading day'],
    symbol: quote['01. symbol'],
    provider: 'Alpha Vantage',
  };
};

const normalizeUpstoxQuote = (payload) => {
  const quote = payload?.last_price !== undefined ? payload : Object.values(payload?.data || {})[0];
  if (!quote || !parseAlphaNumber(quote.last_price)) return null;
  const previousClose = parseAlphaNumber(quote.prev_close_price ?? quote.ohlc?.close ?? quote.cp);
  const change = parseAlphaNumber(quote.net_change) ?? (previousClose ? parseAlphaNumber(quote.last_price) - previousClose : null);
  return {
    c: parseAlphaNumber(quote.last_price),
    d: change,
    dp: previousClose && change !== null ? Number(((change / previousClose) * 100).toFixed(2)) : null,
    h: parseAlphaNumber(quote.ohlc?.high),
    l: parseAlphaNumber(quote.ohlc?.low),
    o: parseAlphaNumber(quote.ohlc?.open),
    pc: previousClose,
    v: parseAlphaNumber(quote.volume),
    week52High: parseAlphaNumber(quote.year_high),
    week52Low: parseAlphaNumber(quote.year_low),
    timestamp: quote.timestamp || quote.last_trade_time || new Date().toISOString(),
    lastTradeTime: quote.last_trade_time || null,
    latestTradingDay: quote.last_trade_time,
    symbol: quote.symbol,
    provider: 'Upstox',
    isLive: true,
    depth: quote.depth || null,
  };
};

const normalizeZerodhaQuote = (payload) => {
  const quote = Object.values(payload?.data || {})[0];
  if (!quote || !parseAlphaNumber(quote.last_price)) return null;
  const previousClose = parseAlphaNumber(quote.ohlc?.close);
  const change = parseAlphaNumber(quote.net_change) ?? (previousClose ? parseAlphaNumber(quote.last_price) - previousClose : null);
  return {
    c: parseAlphaNumber(quote.last_price),
    d: change,
    dp: previousClose && change !== null ? Number(((change / previousClose) * 100).toFixed(2)) : null,
    h: parseAlphaNumber(quote.ohlc?.high),
    l: parseAlphaNumber(quote.ohlc?.low),
    o: parseAlphaNumber(quote.ohlc?.open),
    pc: previousClose,
    v: parseAlphaNumber(quote.volume),
    latestTradingDay: quote.last_trade_time || quote.timestamp,
    symbol: quote.tradingsymbol,
    provider: 'Zerodha Kite',
  };
};

// ── Groww API Integration ──
const growwTradingSymbols = {
  RELIANCE: 'RELIANCE', TCS: 'TCS', HDFCBANK: 'HDFCBANK', INFY: 'INFY',
  ITC: 'ITC', SBIN: 'SBIN', ICICIBANK: 'ICICIBANK', MARUTI: 'MARUTI',
  BHARTIARTL: 'BHARTIARTL', LT: 'LT', AXISBANK: 'AXISBANK',
  KOTAKBANK: 'KOTAKBANK', ADANIENT: 'ADANIENT', SUNPHARMA: 'SUNPHARMA',
  TITAN: 'TITAN', BAJFINANCE: 'BAJFINANCE', WIPRO: 'WIPRO',
  ASIANPAINT: 'ASIANPAINT', HINDALCO: 'HINDALCO', ONGC: 'ONGC', NTPC: 'NTPC',
};

const toGrowwTradingSymbol = (symbol) => {
  const clean = symbol.toUpperCase().replace(/^NSE:|^BSE:|\.BSE$|\.NSE$/i, '');
  const overrides = parseSymbolMap(process.env.GROWW_SYMBOL_MAP);
  return overrides[clean] || growwTradingSymbols[clean] || clean;
};

const normalizeGrowwQuote = (payload) => {
  const data = payload?.payload || payload;
  const price = parseAlphaNumber(data?.last_price ?? data?.ltp);
  if (!data || !price) return null;
  const previousClose = parseAlphaNumber(data.ohlc?.close);
  const change = parseAlphaNumber(data.day_change);
  const changePercent = parseAlphaNumber(data.day_change_perc);
  return {
    c: price,
    d: change,
    dp: changePercent,
    h: parseAlphaNumber(data.ohlc?.high),
    l: parseAlphaNumber(data.ohlc?.low),
    o: parseAlphaNumber(data.ohlc?.open),
    pc: previousClose,
    v: parseAlphaNumber(data.volume),
    week52High: parseAlphaNumber(data.week_52_high),
    week52Low: parseAlphaNumber(data.week_52_low),
    marketCap: parseAlphaNumber(data.market_cap),
    timestamp: data.last_trade_time || null,
    symbol: toGrowwTradingSymbol(data.trading_symbol || ''),
    provider: 'Groww',
    isLive: true,
    depth: data.depth || null,
  };
};

const parseGrowwOhlc = (value) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  return Object.fromEntries(
    [...value.matchAll(/(open|high|low|close)\s*:\s*([\d.]+)/gi)]
      .map(([, key, number]) => [key.toLowerCase(), Number(number)]),
  );
};

const getGrowwBatchQuotes = async (symbols) => {
  if (symbols.length > 50) throw new Error('Groww supports up to 50 instruments per live quote request.');
  const instruments = symbols.map((symbol) => {
    const exchange = /^BSE:/i.test(symbol) ? 'BSE' : 'NSE';
    return { symbol, exchange, tradingSymbol: toGrowwTradingSymbol(symbol) };
  });
  const exchangeSymbols = instruments.map(({ exchange, tradingSymbol }) => `${exchange}_${tradingSymbol}`);
  const params = { segment: 'CASH', exchange_symbols: exchangeSymbols.join(',') };
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${process.env.GROWW_ACCESS_TOKEN}`,
    'X-API-VERSION': '1.0',
  };
  const [ltpResponse, ohlcResponse] = await Promise.all([
    axios.get(`${GROWW_BASE_URL}/live-data/ltp`, { params, headers, timeout: 5000 }),
    axios.get(`${GROWW_BASE_URL}/live-data/ohlc`, { params, headers, timeout: 5000 }),
  ]);
  const prices = ltpResponse.data?.payload || {};
  const candles = ohlcResponse.data?.payload || {};
  const quotes = {};
  for (const [index, instrument] of instruments.entries()) {
    const exchangeSymbol = exchangeSymbols[index];
    const price = parseAlphaNumber(prices[exchangeSymbol]);
    if (!price) continue;
    const ohlc = parseGrowwOhlc(candles[exchangeSymbol]);
    const previousClose = parseAlphaNumber(ohlc.close);
    const change = previousClose ? Number((price - previousClose).toFixed(2)) : null;
    const symbol = instrument.symbol.replace(/^(NSE|BSE):/i, '').toUpperCase();
    quotes[symbol] = {
      c: price,
      d: change,
      dp: previousClose ? Number(((change / previousClose) * 100).toFixed(2)) : null,
      o: parseAlphaNumber(ohlc.open),
      h: parseAlphaNumber(ohlc.high),
      l: parseAlphaNumber(ohlc.low),
      pc: previousClose,
      timestamp: new Date().toISOString(),
      provider: 'Groww',
      isLive: true,
    };
  }
  return quotes;
};

const growwQuoteCache = new Map();
const growwBatchCursors = new Map();

const getUpstoxBatchQuotes = async (symbols) => {
  const buildRequested = () => symbols.map((symbol) => ({
    symbol: toProviderSymbol(symbol),
    instrumentKey: toUpstoxInstrumentKey(symbol),
  }));
  let requested = buildRequested();
  if (requested.some((item) => !item.instrumentKey)) {
    await loadUpstoxInstrumentMaster();
    requested = buildRequested();
  }
  const mapped = requested.filter((item) => item.instrumentKey);
  if (!mapped.length) return {};
  const response = await axios.get(`${UPSTOX_BASE_URL}/market-quote/quotes`, {
    params: { instrument_key: mapped.map((item) => item.instrumentKey).join(',') },
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}`,
    },
    timeout: 5000,
  });
  const requestedByKey = new Map(mapped.map((item) => [item.instrumentKey, item.symbol]));
  const quotes = {};
  for (const quote of Object.values(response.data?.data || {})) {
    const symbol = requestedByKey.get(quote.instrument_token);
    if (!symbol) continue;
    const normalized = normalizeUpstoxQuote(quote);
    if (normalized) quotes[symbol] = normalized;
  }
  return quotes;
};

const getMetalSpotQuote = async (requestedSymbol) => {
  const normalizedSymbol = String(requestedSymbol || '').trim().toUpperCase().replace(/^MCX:/, '');
  const isSilver = normalizedSymbol === 'SILVER';
  const isCopper = normalizedSymbol === 'COPPER';
  if (!isSilver && !isCopper && normalizedSymbol !== 'GOLD') {
    throw new Error(`No spot reference is available for ${normalizedSymbol || 'this symbol'}.`);
  }
  const metal = isSilver ? 'XAG' : isCopper ? 'HG' : 'XAU';
  const metalName = isSilver ? 'Silver' : isCopper ? 'Copper' : 'Gold';
  const spotCurrency = isSilver || isCopper ? 'USD' : 'INR';
  const spotSymbol = `${metal}-${spotCurrency}-SPOT`;
  const gramsPerUnit = isSilver ? 1000 : 10;
  const quoteUnit = isSilver || isCopper ? 'INR/kg' : 'INR/10g';
  const unitsPerKilogram = isCopper ? (1 / 0.45359237) : null;
  const now = Date.now();
  const cached = metalSpotCache.get(metal);
  if (cached && now - cached.fetchedAt < METAL_SPOT_CACHE_MS) return cached.quote;
  if (metalSpotRequests.has(metal)) return metalSpotRequests.get(metal);

  const request = (async () => {
    try {
      const headers = process.env.GOLDPRICE_API_KEY
        ? { Authorization: `Bearer ${process.env.GOLDPRICE_API_KEY}` }
        : {};
      const spotRequest = axios.get(METAL_SPOT_API_URL, {
        params: { symbol: spotSymbol, include: 'stats' },
        headers,
        timeout: 8_000,
      });
      const fxRequest = isSilver || isCopper
        ? axios.get('https://api.goldprice.dev/v1/convert', {
          params: { from: 'USD', to: 'INR', amount: 1 },
          headers,
          timeout: 8_000,
        })
        : Promise.resolve(null);
      const [response, fxResponse] = await Promise.all([spotRequest, fxRequest]);
      const spot = response.data?.symbols?.find((item) => (
        item?.symbol === metal && item?.quote_currency === spotCurrency && item?.contract_type === 'spot'
      ));
      const pricePerTroyOunce = Number(spot?.price);
      const expectedSpotUnit = isCopper ? 'pound' : 'troy_ounce';
      if (!Number.isFinite(pricePerTroyOunce) || pricePerTroyOunce <= 0 || spot?.unit !== expectedSpotUnit) {
        throw new Error(`${metalName} spot API returned an invalid ${metal}/${spotCurrency} quote.`);
      }
      const usdToInr = isSilver || isCopper
        ? Number(fxResponse?.data?.rate ?? fxResponse?.data?.result)
        : 1;
      if (!Number.isFinite(usdToInr) || usdToInr <= 0) {
        throw new Error(`Goldprice.dev returned an invalid USD/INR conversion rate for ${metalName.toLowerCase()}.`);
      }

      const toInrInUnit = (price) => {
        const amount = Number(price);
        return Number.isFinite(amount) && amount > 0
          ? Number((amount * usdToInr * (unitsPerKilogram || gramsPerUnit / TROY_OUNCE_IN_GRAMS)).toFixed(2))
          : null;
      };
      const currentPrice = toInrInUnit(pricePerTroyOunce);
      const previousClose = toInrInUnit(spot.prev_close_price);
      const rawChange = spot.ch === null || spot.ch === undefined || spot.ch === '' ? null : Number(spot.ch);
      const convertedChange = Number.isFinite(rawChange)
        ? Number((rawChange * usdToInr * (unitsPerKilogram || gramsPerUnit / TROY_OUNCE_IN_GRAMS)).toFixed(2))
        : null;
      const change = convertedChange ?? (previousClose === null ? null : Number((currentPrice - previousClose).toFixed(2)));
      const rawChangePercent = spot.chp === null || spot.chp === undefined || spot.chp === '' ? null : Number(spot.chp);
      const changePercent = Number.isFinite(rawChangePercent)
        ? rawChangePercent
        : previousClose && change !== null
          ? Number((change / previousClose * 100).toFixed(4))
          : null;
      const spotTimestamp = Date.parse(spot.computed_at || '');
      const fxTimestamp = Date.parse(fxResponse?.data?.timestamp || fxResponse?.data?.computed_at || '');
      const quoteTimestamp = Number.isFinite(fxTimestamp) && Number.isFinite(spotTimestamp)
        ? Math.min(fxTimestamp, spotTimestamp)
        : Number.isFinite(spotTimestamp) ? spotTimestamp : fxTimestamp;
      const quoteIsStale = spot.is_stale === true
        || fxResponse?.data?.is_stale === true
        || (Number.isFinite(quoteTimestamp) && now - quoteTimestamp > METAL_SPOT_STALE_AFTER_MS);
      const timestamp = Number.isFinite(quoteTimestamp) ? new Date(quoteTimestamp).toISOString() : new Date().toISOString();
      const quote = {
        c: currentPrice,
        d: change,
        dp: changePercent,
        pc: previousClose,
        h: toInrInUnit(spot.high_price),
        l: toInrInUnit(spot.low_price),
        v: null,
        timestamp,
        provider: isSilver
          ? 'goldprice.dev XAG/USD spot × USD/INR conversion'
          : isCopper
            ? 'goldprice.dev HG/USD copper spot × USD/INR conversion'
            : 'goldprice.dev XAU/INR spot',
        providerUrl: 'https://goldprice.dev',
        unit: quoteUnit,
        metal,
        marketType: 'spot',
        isLive: false,
        isDelayed: true,
        isReal: true,
        isDemo: false,
        isStale: quoteIsStale,
      };
      metalSpotCache.set(metal, { quote, fetchedAt: Date.now() });
      return quote;
    } catch (error) {
      if (cached?.quote) return { ...cached.quote, isLive: false, isDelayed: true, isStale: true };
      throw error;
    }
  })();

  metalSpotRequests.set(metal, request);
  try {
    return await request;
  } finally {
    if (metalSpotRequests.get(metal) === request) metalSpotRequests.delete(metal);
  }
};

const getUsdToInrRate = async () => {
  const now = Date.now();
  if (usdInrRateCache && now - usdInrRateCache.fetchedAt < COMMODITY_BENCHMARK_CACHE_MS) return usdInrRateCache;
  if (usdInrRateRequest) return usdInrRateRequest;

  usdInrRateRequest = (async () => {
    const headers = process.env.GOLDPRICE_API_KEY
      ? { Authorization: `Bearer ${process.env.GOLDPRICE_API_KEY}` }
      : {};
    const response = await axios.get('https://api.goldprice.dev/v1/convert', {
      params: { from: 'USD', to: 'INR', amount: 1 },
      headers,
      timeout: 8_000,
    });
    const rate = Number(response.data?.rate ?? response.data?.result);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('USD/INR conversion returned an invalid rate.');
    const timestampValue = Date.parse(response.data?.timestamp || response.data?.computed_at || '');
    const result = {
      rate,
      timestamp: Number.isFinite(timestampValue) ? timestampValue : Date.now(),
      isStale: response.data?.is_stale === true,
      fetchedAt: Date.now(),
    };
    usdInrRateCache = result;
    return result;
  })();

  try {
    return await usdInrRateRequest;
  } finally {
    usdInrRateRequest = null;
  }
};

const getCommodityBenchmarkQuote = async (requestedSymbol) => {
  const symbol = toProviderSymbol(requestedSymbol);
  const benchmark = COMMODITY_BENCHMARKS[symbol];
  if (!benchmark) return null;

  const now = Date.now();
  const cached = commodityBenchmarkCache.get(symbol);
  if (cached && now - cached.fetchedAt < COMMODITY_BENCHMARK_CACHE_MS) return cached.quote;
  if (commodityBenchmarkRequests.has(symbol)) return commodityBenchmarkRequests.get(symbol);

  const request = (async () => {
    try {
      const [response, usdInr] = await Promise.all([
        axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(benchmark.yahooSymbol)}`, {
          params: { range: '1d', interval: '1m' },
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; ShareMarket/1.0)',
          },
          timeout: 8_000,
        }),
        getUsdToInrRate(),
      ]);
      const chart = response.data?.chart;
      const result = chart?.result?.[0];
      if (chart?.error || !result) throw new Error('Yahoo Finance returned no benchmark quote.');

      const metadata = result.meta || {};
      const quote = result.indicators?.quote?.[0] || {};
      const timestamps = result.timestamp || [];
      let lastIndex = timestamps.length - 1;
      while (lastIndex >= 0 && !(Number(quote.close?.[lastIndex]) > 0)) lastIndex -= 1;
      const rawPrice = Number(metadata.regularMarketPrice ?? quote.close?.[lastIndex]);
      const rawPreviousClose = Number(metadata.chartPreviousClose ?? metadata.previousClose);
      if (!Number.isFinite(rawPrice) || rawPrice <= 0) throw new Error('Yahoo Finance returned an invalid benchmark price.');

      const multiplier = usdInr.rate * benchmark.unitMultiplier;
      const toInr = (value) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? Number((number * multiplier).toFixed(2)) : null;
      };
      const previousClose = toInr(rawPreviousClose);
      const currentPrice = toInr(rawPrice);
      const rawChange = Number.isFinite(rawPreviousClose) && rawPreviousClose > 0
        ? rawPrice - rawPreviousClose
        : Number(metadata.regularMarketChange);
      const rawChangePercent = Number.isFinite(rawPreviousClose) && rawPreviousClose > 0
        ? (rawPrice - rawPreviousClose) / rawPreviousClose * 100
        : Number(metadata.regularMarketChangePercent);
      const sourceTimestamp = Number(metadata.regularMarketTime) > 0
        ? Number(metadata.regularMarketTime) * 1000
        : Number(timestamps[lastIndex]) > 0 ? Number(timestamps[lastIndex]) * 1000 : Date.now();
      const high = Number(metadata.regularMarketDayHigh) || Math.max(0, ...(quote.high || []).map(Number).filter(Number.isFinite));
      const low = Number(metadata.regularMarketDayLow) || Math.min(...(quote.low || []).map(Number).filter((value) => Number.isFinite(value) && value > 0));
      const isStale = now - sourceTimestamp > COMMODITY_BENCHMARK_STALE_AFTER_MS
        || usdInr.isStale
        || now - usdInr.timestamp > COMMODITY_BENCHMARK_STALE_AFTER_MS;
      const normalizedQuote = {
        symbol,
        c: currentPrice,
        d: Number.isFinite(rawChange) ? Number((rawChange * multiplier).toFixed(2)) : null,
        dp: Number.isFinite(rawChangePercent) ? Number(rawChangePercent.toFixed(2)) : null,
        pc: previousClose,
        h: toInr(high),
        l: toInr(low),
        v: null,
        timestamp: new Date(sourceTimestamp).toISOString(),
        provider: `Yahoo Finance delayed ${benchmark.yahooSymbol} · USD/INR conversion`,
        providerUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(benchmark.yahooSymbol)}/`,
        unit: benchmark.unit,
        marketType: 'benchmark',
        benchmarkName: benchmark.label,
        isLive: false,
        isDelayed: true,
        isReal: true,
        isDemo: false,
        isStale,
      };
      commodityBenchmarkCache.set(symbol, { quote: normalizedQuote, fetchedAt: Date.now() });
      return normalizedQuote;
    } catch (error) {
      if (cached?.quote) {
        const staleQuote = { ...cached.quote, isLive: false, isStale: true };
        commodityBenchmarkCache.set(symbol, { quote: staleQuote, fetchedAt: cached.fetchedAt });
        return staleQuote;
      }
      throw error;
    }
  })();

  commodityBenchmarkRequests.set(symbol, request);
  try {
    return await request;
  } finally {
    if (commodityBenchmarkRequests.get(symbol) === request) commodityBenchmarkRequests.delete(symbol);
  }
};

const addCommodityBenchmarkFallbacks = async (symbols, existingQuotes = {}) => {
  const quotes = { ...existingQuotes };
  await Promise.all(symbols.map(async (rawSymbol) => {
    const symbol = toProviderSymbol(rawSymbol);
    if (!COMMODITY_BENCHMARKS[symbol] || Number(quotes[symbol]?.c) > 0) return;
    try {
      const quote = await getCommodityBenchmarkQuote(rawSymbol);
      if (quote) quotes[symbol] = quote;
    } catch (error) {
      console.warn(`Commodity benchmark quote failed for ${symbol}:`, error.response?.status || error.message);
    }
  }));
  return quotes;
};

const addYahooResearchFallbacks = async (symbols, existingQuotes = {}) => {
  const quotes = { ...existingQuotes };
  const missing = symbols.filter((rawSymbol) => {
    const symbol = toProviderSymbol(rawSymbol);
    return !(Number(quotes[symbol]?.c) > 0);
  });
  if (!missing.length || !isYahooResearchEnabled()) return quotes;
  try {
    const researchQuotes = await getYahooResearchQuotes(missing);
    for (const [symbol, quote] of Object.entries(researchQuotes)) {
      if (!(Number(quotes[symbol]?.c) > 0)) quotes[symbol] = quote;
    }
  } catch (error) {
    console.warn('Yahoo Finance research quote fallback failed:', error.message);
  }
  return quotes;
};

const isGoldSilverCopperSpotSymbol = (symbol) => /^(?:MCX:)?(?:GOLD|SILVER|COPPER)$/i.test(String(symbol || '').trim());

const addGoldSilverCopperSpotFallbacks = async (symbols, existingQuotes = {}) => {
  const quotes = { ...existingQuotes };
  await Promise.all(symbols.filter(isGoldSilverCopperSpotSymbol).map(async (symbol) => {
    const cleanSymbol = toProviderSymbol(symbol);
    if (Number(quotes[cleanSymbol]?.c) > 0) return;
    try {
      quotes[cleanSymbol] = { ...await getMetalSpotQuote(symbol), symbol: cleanSymbol };
    } catch {
      // Keep unavailable spot quotes out of the result.
    }
  }));
  return quotes;
};

const getProviderQuote = async (provider, symbol) => {
  if (provider === 'kun' && isKunDataConfigured()) {
    const cleanSymbol = toProviderSymbol(symbol);
    const quotes = await getKunQuotes([symbol]);
    return quotes[cleanSymbol] || null;
  }

  if (provider === 'upstox' && process.env.UPSTOX_ACCESS_TOKEN) {
    const cleanSymbol = toProviderSymbol(symbol);
    const quotes = await getUpstoxBatchQuotes([symbol]);
    return quotes[cleanSymbol] || null;
  }

  if (provider === 'zerodha' && process.env.ZERODHA_API_KEY && process.env.ZERODHA_ACCESS_TOKEN) {
    const response = await axios.get(`${ZERODHA_BASE_URL}/quote`, {
      params: { i: toZerodhaSymbol(symbol) },
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${process.env.ZERODHA_API_KEY}:${process.env.ZERODHA_ACCESS_TOKEN}`,
      },
    });
    return normalizeZerodhaQuote(response.data);
  }

  if (provider === 'alpha_vantage' && process.env.ALPHA_VANTAGE_API_KEY) {
    const response = await axios.get(ALPHA_VANTAGE_BASE_URL, {
      params: { function: 'GLOBAL_QUOTE', symbol: toAlphaVantageSymbol(symbol), apikey: process.env.ALPHA_VANTAGE_API_KEY },
    });
    return normalizeAlphaQuote(response.data);
  }

  if (provider === 'groww' && process.env.GROWW_ACCESS_TOKEN) {
    const exchange = /^BSE:/i.test(symbol) ? 'BSE' : 'NSE';
    const response = await axios.get(`${GROWW_BASE_URL}/live-data/quote`, {
      params: {
        exchange,
        segment: 'CASH',
        trading_symbol: toGrowwTradingSymbol(symbol),
      },
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${process.env.GROWW_ACCESS_TOKEN}`,
        'X-API-VERSION': '1.0',
      },
      timeout: 5000,
    });
    const quote = normalizeGrowwQuote(response.data);
    if (quote) return { ...quote, symbol: symbol.replace(/^(NSE|BSE):/i, '').toUpperCase() };
  }

  throw new Error(`No real-time quote returned for ${symbol} by ${provider}.`);
};

// Batch Quotes — fetch multiple symbols at once
app.get('/api/stock/batch', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'symbols query param is required (comma-separated)' });
  if (symbols.length > 500) return res.status(400).json({ error: 'A maximum of 500 symbols can be requested at once.' });
  const provider = getMarketProvider();
  if (!isLiveMarketProviderConfigured(provider)) {
    const quotes = {};
    const missing = [];
    await Promise.all(symbols.map(async (symbol) => {
      const cleanSymbol = toProviderSymbol(symbol);
      if (isGoldSilverCopperSpotSymbol(symbol)) {
        try {
          quotes[cleanSymbol] = { ...await getMetalSpotQuote(symbol), symbol: cleanSymbol };
        } catch {
          missing.push(cleanSymbol);
        }
        return;
      }
      if (/^MCX:/i.test(symbol)) {
        missing.push(cleanSymbol);
        return;
      }
      missing.push(cleanSymbol);
    }));
    const quotesWithBenchmarks = await addCommodityBenchmarkFallbacks(symbols, quotes);
    const quotesWithResearch = await addYahooResearchFallbacks(symbols, quotesWithBenchmarks);
    const missingSymbols = symbols.map(toProviderSymbol).filter((symbol) => !quotesWithResearch[symbol]);
    const hasBenchmarkQuotes = Object.values(quotesWithResearch).some((quote) => quote.marketType === 'benchmark');
    const hasResearchQuotes = Object.values(quotesWithResearch).some((quote) => quote.isResearch === true);
    if (!Object.keys(quotesWithResearch).length) {
      return res.status(503).json({
        error: 'Live stock data is unavailable. Configure a supported market provider token to receive current prices.',
        code: 'live_provider_not_configured',
        realTimeAvailable: false,
        researchDataAvailable: isYahooResearchEnabled(),
        provider: null,
        quotes: {},
        missing: missingSymbols,
      });
    }
    return res.json({
      provider: [
        Object.values(quotesWithResearch).some((quote) => quote.marketType === 'spot') ? 'goldprice.dev spot' : null,
        hasResearchQuotes ? `${getYahooResearchProviderName()} · research` : null,
      ].filter(Boolean).join(' + '),
      isLive: false,
      researchOnly: Object.values(quotesWithResearch).some((quote) => quote.isResearch === true),
      quotes: quotesWithResearch,
      missing: missingSymbols,
    });
  }
  try {
    if (provider === 'kun') {
      const equitySymbols = symbols.filter((symbol) => (
        !isGoldSilverCopperSpotSymbol(symbol) && !/^MCX:/i.test(symbol)
      ));
      let kunQuotes = {};
      if (equitySymbols.length) kunQuotes = await getKunQuotes(equitySymbols);
      const quotesWithSpotFallbacks = await addGoldSilverCopperSpotFallbacks(symbols, kunQuotes);
      const quotesWithBenchmarks = await addCommodityBenchmarkFallbacks(symbols, quotesWithSpotFallbacks);
      const quotes = await addYahooResearchFallbacks(symbols, quotesWithBenchmarks);
      if (!Object.keys(quotes).length) {
        return res.status(502).json({ error: 'Kunpeng Data returned no live prices for the requested symbols.' });
      }
      const missing = symbols.map(toProviderSymbol).filter((symbol) => !quotes[symbol]);
      return res.json({
        provider: [
          Object.values(quotes).some((quote) => quote.isLive === true) ? 'Kunpeng Data' : null,
          Object.values(quotes).some((quote) => quote.isResearch === true) ? `${getYahooResearchProviderName()} · research` : null,
        ].filter(Boolean).join(' + '),
        isLive: Object.values(quotes).some((quote) => quote.isLive === true),
        researchOnly: Object.values(quotes).some((quote) => quote.isResearch === true),
        quotes,
        missing,
      });
    }

    if (provider === 'upstox') {
      let upstoxQuotes = {};
      try {
        upstoxQuotes = await getUpstoxBatchQuotes(symbols);
      } catch (error) {
        console.warn('Upstox batch quote failed; using available spot fallback quotes:', error.response?.status || error.message);
      }
      const spotQuotes = await addGoldSilverCopperSpotFallbacks(symbols, upstoxQuotes);
      const quotes = await addCommodityBenchmarkFallbacks(symbols, spotQuotes);
      if (!Object.keys(quotes).length) return res.status(502).json({ error: 'Upstox returned no live prices for the requested symbols.' });
      const missing = symbols.filter((symbol) => !quotes[toProviderSymbol(symbol)]);
      return res.json({ provider, quotes, missing });
    }
    if (provider === 'groww') {
      const batchLimit = 50;
      const batchKey = symbols.join(',');
      let requestedBatch = symbols;
      if (symbols.length > batchLimit) {
        const cursor = growwBatchCursors.get(batchKey) || 0;
        requestedBatch = symbols.slice(cursor, cursor + batchLimit);
        if (requestedBatch.length < batchLimit) requestedBatch = [...requestedBatch, ...symbols.slice(0, batchLimit - requestedBatch.length)];
        growwBatchCursors.set(batchKey, (cursor + batchLimit) % symbols.length);
      }

      const freshQuotes = await getGrowwBatchQuotes(requestedBatch);
      const receivedAt = Date.now();
      for (const [symbol, quote] of Object.entries(freshQuotes)) {
        growwQuoteCache.set(symbol, { ...quote, receivedAt });
      }

      const quotes = {};
      for (const rawSymbol of symbols) {
        const symbol = rawSymbol.replace(/^(NSE|BSE):/i, '');
        const cached = growwQuoteCache.get(symbol);
        if (cached) {
          const ageMs = receivedAt - cached.receivedAt;
          quotes[symbol] = {
            ...cached,
            isLive: ageMs <= 5000,
            isStale: ageMs > 5000,
            ageMs,
          };
        }
      }
      const quotesWithSpotFallbacks = await addGoldSilverCopperSpotFallbacks(symbols, quotes);
      const quotesWithReferences = await addCommodityBenchmarkFallbacks(symbols, quotesWithSpotFallbacks);
      if (!Object.keys(quotesWithReferences).length) return res.status(502).json({ error: 'Groww returned no live prices for the requested symbols.' });
      const missing = symbols.map(toProviderSymbol).filter((symbol) => !quotesWithReferences[symbol]);
      return res.json({ provider, quotes: quotesWithReferences, missing });
    }
    const results = {};
    await Promise.all(symbols.map(async (symbol) => {
      try {
        const quote = await getProviderQuote(provider, symbol);
        if (quote?.c) results[symbol.replace(/^(NSE|BSE):/i, '')] = quote;
      } catch {
        // Leave provider failures unavailable; never substitute a simulated quote.
      }
    }));
    const quotesWithSpotFallbacks = await addGoldSilverCopperSpotFallbacks(symbols, results);
    const quotesWithReferences = await addCommodityBenchmarkFallbacks(symbols, quotesWithSpotFallbacks);
    if (!Object.keys(quotesWithReferences).length) return res.status(502).json({ error: `${provider} returned no live prices for the requested symbols.` });
    const missing = symbols.map(toProviderSymbol).filter((symbol) => !quotesWithReferences[symbol]);
    return res.json({ provider, quotes: quotesWithReferences, missing });
  } catch (error) {
    console.warn(`${provider} batch quote error:`, error.message);
    return res.status(502).json({ error: `${provider} could not return current quotes. Try again shortly.` });
  }
});

// GET /api/db/prices — Get all stored prices from persistent database
app.get('/api/db/prices', (req, res) => {
  const fileData = loadStoredStockPrices();
  const currentMemory = {};
  for (const [sym, state] of liveState.entries()) {
    currentMemory[sym] = {
      symbol: state.symbol,
      currentPrice: state.currentPrice,
      previousClose: state.previousClose,
      open: state.open,
      high: state.high,
      low: state.low,
      volume: state.volume,
      lastUpdate: state.lastUpdate,
    };
  }
  const merged = { ...fileData, ...currentMemory };
  res.json({ count: Object.keys(merged).length, storage: 'data/stock_prices.json', prices: merged });
});

// POST /api/db/price — Store / Update a stock price directly into database
app.post('/api/db/price', (req, res) => {
  const { symbol, price, previousClose, name } = req.body || {};
  if (!symbol || !price) {
    return res.status(400).json({ error: 'symbol and price are required fields' });
  }
  const cleanSymbol = symbol.toUpperCase().trim();
  const numPrice = Number(Number(price).toFixed(2));
  const numPrev = previousClose ? Number(Number(previousClose).toFixed(2)) : numPrice;

  const item = getOrInitState(cleanSymbol);
  item.currentPrice = numPrice;
  item.previousClose = numPrev;
  if (name) item.name = name;
  item.high = Math.max(item.high, numPrice);
  item.low = Math.min(item.low, numPrice);
  item.lastUpdate = Date.now();

  // Save to persistent storage immediately
  const fileData = loadStoredStockPrices();
  fileData[cleanSymbol] = {
    symbol: cleanSymbol,
    currentPrice: item.currentPrice,
    previousClose: item.previousClose,
    open: item.open,
    high: item.high,
    low: item.low,
    volume: item.volume,
    lastUpdate: item.lastUpdate,
    name: item.name,
  };
  saveStoredStockPrices(fileData);

  res.json({ success: true, message: `Price for ${cleanSymbol} stored successfully`, stock: fileData[cleanSymbol] });
});

// Provider Info
app.get('/api/provider', (req, res) => {
  const provider = getMarketProvider();
  const liveDataAvailable = isLiveMarketProviderConfigured(provider);
  res.json({
    active: liveDataAvailable ? provider : null,
    liveDataAvailable,
    configured: {
      kun: isKunDataConfigured(),
      groww: Boolean(process.env.GROWW_ACCESS_TOKEN),
      upstox: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
      zerodha: Boolean(process.env.ZERODHA_API_KEY && process.env.ZERODHA_ACCESS_TOKEN),
      alpha_vantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      gemini_ai: Boolean(process.env.GEMINI_API_KEY),
      live_engine: false,
    },
    stream: provider === 'kun' ? getKunDataStatus() : null,
  });
});

// ==========================================
// AI COPILOT & STOCK ANALYSIS ENDPOINTS
// ==========================================

// AI Chatbot Copilot Endpoint
app.post('/api/ai/chat', async (req, res) => {
  const { message, context = {} } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const geminiKey = process.env.GEMINI_API_KEY;

  // Stock Market Context Formulation
  const activeStockContext = context.symbol
    ? `The user is currently viewing ${context.symbol} (Price: ₹${context.price || 'N/A'}, Change: ${context.change || 'N/A'}%).`
    : 'The user is browsing the Indian stock market dashboard.';

  // If Gemini API Key is configured in .env, call real Google Gemini 1.5 Flash
  if (geminiKey) {
    try {
      const prompt = `You are "ShareMarket AI Copilot", an expert Indian stock market trading and investment analyst.
Context: ${activeStockContext}
User question: "${message}"

Give a concise, professional, insightful answer formatted in clean bullet points with:
1. Direct trend / technical insight (Support, Resistance, Trend).
2. Key catalyst or fundamental context.
3. Risk advice (Stop loss, balanced allocation).
Keep your tone crisp, like a financial terminal analyst. Keep under 180 words.`;

      const aiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
        },
        { timeout: 9000 },
      );

      const reply = aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) {
        return res.json({ reply, provider: 'Google Gemini 1.5 Flash' });
      }
    } catch (apiErr) {
      console.warn('Gemini API call failed, using high-intelligence local analyst fallback:', apiErr.message);
    }
  }

  // Built-in Intelligent Financial Rule & Market Engine Fallback
  const lower = message.toLowerCase();
  let reply = '';

  if (lower.includes('reliance') || (context.symbol === 'RELIANCE' && lower.includes('trend'))) {
    reply = `📊 **Reliance Industries (RELIANCE) Analysis**:
• **Trend**: Mildly Bullish consolidation near ₹2,920–₹2,980.
• **Key Levels**: Crucial support at ₹2,880; immediate resistance at ₹2,965. A breakout above ₹2,965 targets ₹3,020.
• **Catalysts**: Retail subscriber monetization, green hydrogen capex, and steady Jio ARPU expansion.
• **Strategy**: Buy on dips near ₹2,890 with stop-loss at ₹2,840.`;
  } else if (lower.includes('nifty') || lower.includes('market') || lower.includes('sensex')) {
    reply = `📈 **Market Benchmark Outlook (NIFTY 50)**:
• **Current Structure**: Benchmark trading near 24,900 with positive institutional breadth.
• **Support / Resistance**: Immediate base at 24,750; overhead resistance at 25,120.
• **Institutional Inflow**: FII & DII flows remain supportive in private banking and automotive.
• **Trader Tip**: Maintain strict trailing stop-losses given derivative expiry volatility.`;
  } else if (lower.includes('buy') || lower.includes('sell') || lower.includes('invest') || lower.includes('portfolio')) {
    reply = `💡 **Portfolio Allocation Recommendation**:
• **Core Equity (60%)**: Large-cap benchmark leaders (HDFC Bank, Reliance, TCS, L&T).
• **Growth Midcaps (25%)**: High-ROE defense, electronics manufacturing, and renewables.
• **Hedge & Cash (15%)**: Bullion (Gold/Silver) & Liquid debt funds for buying market dips.
• **Risk Rule**: Never risk more than 1.5% capital on a single intraday trade.`;
  } else if (context.symbol) {
    reply = `🔍 **${context.symbol} Technical Snapshot**:
• **Price Action**: Last traded at ₹${context.price || 'Market'} with intraday momentum.
• **Technical Bias**: Maintaining support above the 20 EMA trendline.
• **Momentum Indicator**: RSI hovering near balanced territory (48–56 zone).
• **Verdict**: Accumulate in staggered tranches with disciplined risk management.`;
  } else {
    reply = `🤖 **ShareMarket AI Copilot**:
• **Market Status**: Indian benchmark indices maintaining positive momentum.
• **Sector Leaders**: Private Banking, Auto, and Capital Goods outperforming.
• **Ask me anything**: You can ask for technical levels, support/resistance of any NSE stock, or portfolio sizing advice!`;
  }

  return res.json({ reply, provider: 'ShareMarket Built-in AI Engine' });
});

// AI Quick Stock Technical Scanner
app.get('/api/ai/analyze-stock', async (req, res) => {
  const { symbol = 'RELIANCE' } = req.query;
  const provider = getMarketProvider();
  if (!isLiveMarketProviderConfigured(provider)) {
    return res.status(503).json({ error: 'Live stock analysis requires a configured market data provider.', code: 'live_provider_not_configured' });
  }

  let quote;
  try {
    quote = await getProviderQuote(provider, symbol);
  } catch (error) {
    return res.status(502).json({ error: `${provider} could not return a current quote for ${symbol}.` });
  }
  if (!quote || !(Number(quote.c) > 0)) return res.status(502).json({ error: `${provider} returned no current quote for ${symbol}.` });

  const changePercent = Number(quote.dp) || 0;
  const isGain = changePercent >= 0;
  const support = Number(quote.l) > 0 ? Number(quote.l) : null;
  const resistance = Number(quote.h) > 0 ? Number(quote.h) : null;

  const analysis = {
    symbol: String(symbol).toUpperCase(),
    price: Number(quote.c),
    changePercent,
    provider: quote.provider || provider,
    timestamp: quote.timestamp || new Date().toISOString(),
    isLive: quote.isLive === true,
    sentiment: isGain ? (changePercent > 1.5 ? 'Strong Bullish' : 'Mild Bullish') : (changePercent < -1.5 ? 'Strong Bearish' : 'Mild Bearish'),
    support,
    resistance,
    summary: `${String(symbol).toUpperCase()} is showing ${isGain ? 'a positive daily move' : 'a negative daily move'}${support ? ` with an observed low of ₹${support}` : ''}${resistance ? ` and observed high of ₹${resistance}` : ''}.`,
  };

  res.json(analysis);
});

app.get('/', (req, res) => {
  const provider = getMarketProvider();
  const liveDataAvailable = isLiveMarketProviderConfigured(provider);
  res.json({
    service: 'ShareMarket Market Data API',
    status: 'running',
    liveEngineActive: liveDataAvailable,
    demoDataAvailable: false,
    provider: liveDataAvailable ? provider : null,
    website: 'http://127.0.0.1:5173',
  });
});

app.get('/api/health', (req, res) => {
  const provider = getMarketProvider();
  const liveDataAvailable = isLiveMarketProviderConfigured(provider);
  const kunStatus = provider === 'kun' ? getKunDataStatus() : null;
  res.json({
    status: 'ok',
    liveEngineActive: false,
    apiKeyConfigured: liveDataAvailable,
    realTimeAvailable: liveDataAvailable,
    researchDataAvailable: isYahooResearchEnabled(),
    researchProvider: isYahooResearchEnabled() ? getYahooResearchProviderName() : null,
    demoDataAvailable: false,
    provider: liveDataAvailable ? provider : null,
    configuredProvider: provider,
    providerConnected: kunStatus ? kunStatus.connected : liveDataAvailable,
    setupRequired: liveDataAvailable ? null : provider === 'kun'
      ? 'Set KUN_DATA_API_TOKEN in .env and restart the server.'
      : 'Configure a supported market data provider token in .env and restart the server.',
    providers: {
      live_engine: false,
      kun: isKunDataConfigured(),
      alpha_vantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      upstox: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
      zerodha: Boolean(process.env.ZERODHA_API_KEY && process.env.ZERODHA_ACCESS_TOKEN),
      groww: Boolean(process.env.GROWW_ACCESS_TOKEN),
    },
  });
});

app.post('/api/payments/order', async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount < 10 || amount > 10000000) return res.status(400).json({ error: 'Amount must be between Rs 10 and Rs 1,00,000.' });
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ error: 'Razorpay test keys are not configured on the server.' });
  try {
    const response = await axios.post('https://api.razorpay.com/v1/orders', {
      amount: amount * 100,
      currency: 'INR',
      receipt: `sm_${Date.now()}`,
      notes: { product: 'ShareMarket wallet top-up' },
    }, { auth: { username: process.env.RAZORPAY_KEY_ID, password: process.env.RAZORPAY_KEY_SECRET } });
    res.json({ ...response.data, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (error) {
    res.status(502).json({ error: error.response?.data?.error?.description || error.message });
  }
});

app.post('/api/payments/verify', (req, res) => {
  const { orderId, paymentId, signature } = req.body || {};
  if (!orderId || !paymentId || !signature || !process.env.RAZORPAY_KEY_SECRET) return res.status(400).json({ verified: false, error: 'Payment verification details are incomplete.' });
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const received = Buffer.from(signature);
  const verified = received.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), received);
  res.status(verified ? 200 : 400).json({ verified });
});

app.get('/api/news/market', async (req, res) => {
  const category = req.query.category || 'general';
  if (process.env.FINNHUB_API_KEY) {
    try {
      const response = await axios.get('https://finnhub.io/api/v1/news', {
        params: { category, token: process.env.FINNHUB_API_KEY },
      });
      return res.json(response.data);
    } catch {
      // Fallback below
    }
  }
  res.json(fallbackNews);
});

app.get('/api/stocks/list', async (req, res) => {
  const requestedExchange = String(req.query.exchange || '').trim().toUpperCase();
  if (requestedExchange && !['NSE', 'BSE'].includes(requestedExchange)) {
    return res.status(400).json({ error: 'exchange must be NSE or BSE', code: 'unsupported_exchange' });
  }

  const allCompaniesPath = path.join(process.cwd(), 'public', 'all_companies.json');
  if (fs.existsSync(allCompaniesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(allCompaniesPath, 'utf8'));
      const companies = Array.isArray(data) ? data : [];
      return res.json(requestedExchange
        ? companies.filter((company) => String(company.exchange || '').toUpperCase() === requestedExchange)
        : companies);
    } catch {
      // Fallback
    }
  }

  const defaultList = Object.entries(defaultBasePrices).map(([sym, item]) => ({
    symbol: sym,
    description: item.name,
    displaySymbol: sym,
    exchange: 'NSE',
    type: 'EQ',
  }));
  res.json(requestedExchange === 'BSE' ? [] : defaultList);
});

// Real-Time Live Quote
app.get('/api/stock/quote', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  const isMetalSymbol = isGoldSilverCopperSpotSymbol(symbol);
  const isCommodityBenchmark = Boolean(COMMODITY_BENCHMARKS[toProviderSymbol(symbol)]);
  const metalName = /SILVER/i.test(String(symbol)) ? 'silver' : /COPPER/i.test(String(symbol)) ? 'copper' : 'gold';
  const metalCode = metalName === 'silver' ? 'XAG' : metalName === 'copper' ? 'HG' : 'XAU';
  const provider = getMarketProvider();
  if (!isLiveMarketProviderConfigured(provider)) {
    if (isMetalSymbol) {
      try {
        return res.json(await getMetalSpotQuote(symbol));
      } catch (error) {
        console.warn(`${metalName} spot quote error:`, error.response?.status || error.message);
        const source = metalName === 'gold' ? 'XAU/INR spot' : `${metalCode}/USD spot and USD/INR conversion`;
        return res.status(502).json({ error: `The ${source} feed is unavailable right now.` });
      }
    }
    if (isCommodityBenchmark) {
      try {
        return res.json(await getCommodityBenchmarkQuote(symbol));
      } catch (error) {
        console.warn(`Commodity benchmark quote error for ${symbol}:`, error.response?.status || error.message);
        return res.status(502).json({ error: `The global benchmark reference for ${symbol} is unavailable right now.` });
      }
    }
    if (/^MCX:/i.test(String(symbol))) return res.status(502).json({ error: `No real market quote is available for ${symbol}.` });
    try {
      const researchQuotes = await getYahooResearchQuotes([symbol]);
      const researchQuote = researchQuotes[toProviderSymbol(symbol)];
      if (researchQuote) return res.json(researchQuote);
    } catch (error) {
      console.warn('Yahoo Finance research quote failed:', error.message);
    }
    return res.status(503).json({
      error: 'Live stock data is unavailable. Configure a supported market provider token to receive current prices.',
      code: 'live_provider_not_configured',
      realTimeAvailable: false,
      researchDataAvailable: isYahooResearchEnabled(),
    });
  }

  try {
    const quote = await getProviderQuote(provider, symbol);
    if (quote) return res.json(quote);
    if (isMetalSymbol) return res.json(await getMetalSpotQuote(symbol));
    if (isCommodityBenchmark) return res.json(await getCommodityBenchmarkQuote(symbol));
    const researchQuotes = await getYahooResearchQuotes([symbol]);
    if (researchQuotes[toProviderSymbol(symbol)]) return res.json(researchQuotes[toProviderSymbol(symbol)]);
    return res.status(502).json({ error: `${provider} returned no live quote for ${symbol}.` });
  } catch (error) {
    if (isMetalSymbol) {
      try {
        return res.json(await getMetalSpotQuote(symbol));
      } catch (fallbackError) {
        console.warn(`${metalName} spot quote fallback error:`, fallbackError.response?.status || fallbackError.message);
      }
    }
    if (isCommodityBenchmark) {
      try {
        return res.json(await getCommodityBenchmarkQuote(symbol));
      } catch (fallbackError) {
        console.warn(`Commodity benchmark quote fallback error for ${symbol}:`, fallbackError.response?.status || fallbackError.message);
      }
    }
    try {
      const researchQuotes = await getYahooResearchQuotes([symbol]);
      const researchQuote = researchQuotes[toProviderSymbol(symbol)];
      if (researchQuote) return res.json(researchQuote);
    } catch (fallbackError) {
      console.warn('Yahoo Finance research quote fallback failed:', fallbackError.message);
    }
    console.warn(`${provider} quote error for ${symbol}:`, error.message);
    return res.status(502).json({ error: `${provider} could not return a current quote. Try again shortly.` });
  }
});

// Level-2 Market Depth (Order Book) — tries Groww depth if available
app.get('/api/market/depth', async (req, res) => {
  const { symbol = 'RELIANCE' } = req.query;
  if (getMarketProvider() === 'upstox' && isLiveMarketProviderConfigured('upstox')) {
    try {
      const quote = await getProviderQuote('upstox', symbol);
      if (!quote?.depth) return res.status(502).json({ error: `Upstox returned no live market depth for ${symbol}.` });
      const bids = (quote.depth.buy || []).map((item) => ({ price: item.price, quantity: item.quantity, orders: item.orders || 1 }));
      const asks = (quote.depth.sell || []).map((item) => ({ price: item.price, quantity: item.quantity, orders: item.orders || 1 }));
      return res.json({
        symbol: symbol.toUpperCase(),
        price: quote.c,
        bids,
        asks,
        totalBidQty: bids.reduce((total, item) => total + item.quantity, 0),
        totalAskQty: asks.reduce((total, item) => total + item.quantity, 0),
        spread: asks[0] && bids[0] ? Number((asks[0].price - bids[0].price).toFixed(2)) : null,
        timestamp: quote.timestamp,
        provider: quote.provider,
        isLive: true,
      });
    } catch (error) {
      console.warn(`Upstox depth error for ${symbol}:`, error.message);
      return res.status(502).json({ error: 'Upstox could not return live market depth.' });
    }
  }
  if (!isLiveMarketProviderConfigured('groww') || getMarketProvider() !== 'groww') {
    return res.status(503).json({ error: 'Live market depth is unavailable for the configured provider.' });
  }

  // Try Groww depth if token is available
  try {
    const exchange = /^BSE:/i.test(symbol) ? 'BSE' : 'NSE';
    const response = await axios.get(`${GROWW_BASE_URL}/live-data/quote`, {
      params: { exchange, segment: 'CASH', trading_symbol: toGrowwTradingSymbol(symbol) },
      headers: { Accept: 'application/json', Authorization: `Bearer ${process.env.GROWW_ACCESS_TOKEN}`, 'X-API-VERSION': '1.0' },
      timeout: 5000,
    });
    const data = response.data?.payload;
    if (data?.depth) {
      const price = parseAlphaNumber(data.last_price);
      const bids = (data.depth.buy || []).map((b) => ({ price: b.price, quantity: b.quantity, orders: b.orders || 1 }));
      const asks = (data.depth.sell || []).map((a) => ({ price: a.price, quantity: a.quantity, orders: a.orders || 1 }));
      return res.json({
        symbol: symbol.toUpperCase(), price, bids, asks,
        totalBidQty: parseAlphaNumber(data.total_buy_quantity) || bids.reduce((s, b) => s + b.quantity, 0),
        totalAskQty: parseAlphaNumber(data.total_sell_quantity) || asks.reduce((s, a) => s + a.quantity, 0),
        spread: asks[0] && bids[0] ? Number((asks[0].price - bids[0].price).toFixed(2)) : 0,
        timestamp: data.last_trade_time || Date.now(), provider: 'Groww', isLive: true,
      });
    }
    return res.status(502).json({ error: `Groww returned no live market depth for ${symbol}.` });
  } catch (error) {
    console.warn(`Groww depth error for ${symbol}:`, error.message);
    return res.status(502).json({ error: 'Groww could not return live market depth.' });
  }
});

// Time & Sales (Trade Tape)
app.get('/api/market/tape', (req, res) => {
  res.status(503).json({ error: 'Live time and sales is not available from the configured quote endpoint.' });
});

// Historical candles at the selected chart interval. Use the selected live
// provider where supported, then use Alpha Vantage for matching series.
app.get('/api/stock/history', async (req, res) => {
  const { symbol, from, to } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });

  const resolution = String(req.query.resolution || 'D');
  const candleIntervals = {
    '1m': { seconds: 60, upstoxUnit: 'minutes', upstoxInterval: 1, alphaInterval: '1min', alphaBaseSeconds: 60, alphaFactor: 1 },
    '5m': { seconds: 5 * 60, upstoxUnit: 'minutes', upstoxInterval: 5, alphaInterval: '5min', alphaBaseSeconds: 5 * 60, alphaFactor: 1 },
    '15m': { seconds: 15 * 60, upstoxUnit: 'minutes', upstoxInterval: 15, alphaInterval: '15min', alphaBaseSeconds: 15 * 60, alphaFactor: 1 },
    '30m': { seconds: 30 * 60, upstoxUnit: 'minutes', upstoxInterval: 30, alphaInterval: '30min', alphaBaseSeconds: 30 * 60, alphaFactor: 1 },
    '45m': { seconds: 45 * 60, upstoxUnit: 'minutes', upstoxInterval: 45, alphaInterval: '15min', alphaBaseSeconds: 15 * 60, alphaFactor: 3 },
    '1h': { seconds: 60 * 60, upstoxUnit: 'hours', upstoxInterval: 1, alphaInterval: '60min', alphaBaseSeconds: 60 * 60, alphaFactor: 1 },
    '2h': { seconds: 2 * 60 * 60, upstoxUnit: 'hours', upstoxInterval: 2, alphaInterval: '60min', alphaBaseSeconds: 60 * 60, alphaFactor: 2 },
    '4h': { seconds: 4 * 60 * 60, upstoxUnit: 'hours', upstoxInterval: 4, alphaInterval: '60min', alphaBaseSeconds: 60 * 60, alphaFactor: 4 },
    '5h': { seconds: 5 * 60 * 60, upstoxUnit: 'hours', upstoxInterval: 5, alphaInterval: '60min', alphaBaseSeconds: 60 * 60, alphaFactor: 5 },
    '1d': { seconds: 24 * 60 * 60, upstoxUnit: 'days', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_DAILY', alphaSeries: 'Time Series (Daily)' },
    D: { seconds: 24 * 60 * 60, upstoxUnit: 'days', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_DAILY', alphaSeries: 'Time Series (Daily)' },
    '1w': { seconds: 7 * 24 * 60 * 60, upstoxUnit: 'weeks', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_WEEKLY', alphaSeries: 'Weekly Time Series' },
    W: { seconds: 7 * 24 * 60 * 60, upstoxUnit: 'weeks', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_WEEKLY', alphaSeries: 'Weekly Time Series' },
    '1M': { seconds: 30 * 24 * 60 * 60, upstoxUnit: 'months', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_MONTHLY', alphaSeries: 'Monthly Time Series' },
    M: { seconds: 30 * 24 * 60 * 60, upstoxUnit: 'months', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_MONTHLY', alphaSeries: 'Monthly Time Series' },
  };
  const interval = candleIntervals[resolution];
  if (!interval) return res.status(400).json({ error: 'Unsupported candle resolution.' });

  const toTime = Number(to) || Math.floor(Date.now() / 1000);
  const fromTime = Number(from) || 0;
  const requestedFrom = fromTime || (toTime - interval.seconds * 100);
  const requestedTo = toTime || Math.floor(Date.now() / 1000);
  const toIndiaDate = (timestamp) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(timestamp * 1000));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const makePayload = (candles, provider) => ({
    s: candles.length ? 'ok' : 'no_data',
    t: candles.map((candle) => candle.time),
    o: candles.map((candle) => candle.open),
    h: candles.map((candle) => candle.high),
    l: candles.map((candle) => candle.low),
    c: candles.map((candle) => candle.close),
    v: candles.map((candle) => candle.value),
    provider,
    resolution,
  });

  if (getMarketProvider() === 'kun' && isKunDataConfigured()) {
    const kunIntervals = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '30m': '15',
      '45m': '15',
      '1h': '60',
      '2h': '60',
      '4h': '240',
      '5h': '240',
      '1d': 'D',
      D: 'D',
      '1w': 'W',
      W: 'W',
      '1M': 'M',
      M: 'M',
    };
    try {
      const count = Math.min(2500, Math.max(20, Math.ceil((requestedTo - requestedFrom) / interval.seconds) + 5));
      const candles = await getKunHistory({ symbol: String(symbol), interval: kunIntervals[resolution], count });
      const rangedCandles = candles.filter((candle) => candle.time >= requestedFrom && candle.time <= requestedTo);
      return res.json(makePayload(rangedCandles, 'Kunpeng Data'));
    } catch (error) {
      console.warn(`Kunpeng Data history error for ${symbol} (${resolution}):`, error.response?.status || error.message);
      return res.status(502).json({ error: `Kunpeng Data could not return historical candles for ${symbol}.` });
    }
  }

  if (getMarketProvider() === 'upstox' && process.env.UPSTOX_ACCESS_TOKEN) {
    try {
      await loadUpstoxInstrumentMaster();
      const instrumentKey = toUpstoxInstrumentKey(String(symbol));
      if (!instrumentKey) throw new Error(`No Upstox instrument key found for ${symbol}.`);
      const historyUrl = `${UPSTOX_BASE_URL}/historical-candle/${encodeURIComponent(instrumentKey)}/${interval.upstoxUnit}/${interval.upstoxInterval}/${toIndiaDate(requestedTo)}/${toIndiaDate(requestedFrom)}`;
      const response = await axios.get(historyUrl, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}` },
        timeout: 12_000,
      });
      const rawCandles = response.data?.data?.candles;
      if (!Array.isArray(rawCandles)) throw new Error('Upstox did not return historical candles.');
      const candles = rawCandles.map(([time, open, high, low, close, value]) => ({
        time: Math.floor(new Date(time).getTime() / 1000),
        open: parseAlphaNumber(open),
        high: parseAlphaNumber(high),
        low: parseAlphaNumber(low),
        close: parseAlphaNumber(close),
        value: parseAlphaNumber(value) || 0,
      }))
        .filter((candle) => Number.isFinite(candle.time)
          && candle.time >= requestedFrom
          && candle.time <= requestedTo
          && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
        .sort((first, second) => first.time - second.time);
      return res.json(makePayload(candles, 'Upstox'));
    } catch (error) {
      console.warn(`Upstox historical candles error for ${symbol} (${resolution}):`, error.message);
      if (!process.env.ALPHA_VANTAGE_API_KEY) {
        return res.status(502).json({ error: 'Upstox historical candles are unavailable for this interval.' });
      }
    }
  }

  if (process.env.ALPHA_VANTAGE_API_KEY) {
    try {
      const params = {
        function: interval.alphaFunction || 'TIME_SERIES_INTRADAY',
        symbol: toAlphaVantageSymbol(symbol),
        outputsize: 'compact',
        apikey: process.env.ALPHA_VANTAGE_API_KEY,
      };
      if (interval.alphaInterval) params.interval = interval.alphaInterval;
      const response = await axios.get(ALPHA_VANTAGE_BASE_URL, { params, timeout: 12_000 });
      const series = response.data?.[interval.alphaSeries || `Time Series (${interval.alphaInterval})`];
      if (!series) throw new Error('Alpha Vantage did not return the requested candle series.');
      let candles = Object.entries(series)
        .map(([date, values]) => {
          const timestamp = date.includes(' ')
            ? new Date(`${date.replace(' ', 'T')}+05:30`).getTime()
            : new Date(`${date}T00:00:00Z`).getTime();
          return {
            time: Math.floor(timestamp / 1000),
            open: parseAlphaNumber(values['1. open']),
            high: parseAlphaNumber(values['2. high']),
            low: parseAlphaNumber(values['3. low']),
            close: parseAlphaNumber(values['4. close']),
            value: parseAlphaNumber(values['5. volume']) || 0,
          };
        })
        .filter((candle) => Number.isFinite(candle.time)
          && candle.time >= requestedFrom
          && candle.time <= requestedTo
          && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
        .sort((first, second) => first.time - second.time);

      if (interval.alphaFactor > 1) {
        const bucketSeconds = interval.alphaBaseSeconds * interval.alphaFactor;
        const buckets = new Map();
        candles.forEach((candle) => {
          const bucketTime = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
          const current = buckets.get(bucketTime);
          if (current) {
            current.high = Math.max(current.high, candle.high);
            current.low = Math.min(current.low, candle.low);
            current.close = candle.close;
            current.value += candle.value;
          } else {
            buckets.set(bucketTime, { ...candle, time: bucketTime });
          }
        });
        candles = [...buckets.values()];
      }
      return res.json(makePayload(candles, 'Alpha Vantage'));
    } catch (error) {
      console.warn(`Alpha Vantage historical candles error for ${symbol} (${resolution}):`, error.message);
      return res.status(502).json({ error: 'Historical candle data is unavailable right now.' });
    }
  }

  return res.status(503).json({ error: 'Configure Upstox or Alpha Vantage history access to load verified candles.' });
});

// ── LIVE IPO ENGINE & SUBSCRIPTION TICKER ──────────────────────────────────
const initialIposData = [
  // ── CURRENT WORKING / OPEN IPOS ───────────────────────────────────────
  {
    company: 'Nova Finserv',
    priceBand: 'Rs 410 - Rs 432',
    minPrice: 410,
    cutOffPrice: 432,
    lotSize: 34,
    issueSize: 'Rs 1,420 Cr',
    minInvestment: 'Rs 14,688',
    openDate: '12 Oct',
    closeDate: '16 Oct',
    allotmentDate: '17 Oct',
    listingDate: '21 Oct',
    subscription: 3.42,
    qib: 4.85,
    nii: 3.20,
    retail: 2.75,
    gmp: '+14%',
    gmpValue: 'Rs 60',
    status: 'Open',
    segment: 'Mainboard',
    totalApplications: 124800,
  },
  {
    company: 'Medix Labs',
    priceBand: 'Rs 155 - Rs 162',
    minPrice: 155,
    cutOffPrice: 162,
    lotSize: 92,
    issueSize: 'Rs 620 Cr',
    minInvestment: 'Rs 14,904',
    openDate: '13 Oct',
    closeDate: '17 Oct',
    allotmentDate: '18 Oct',
    listingDate: '22 Oct',
    subscription: 5.84,
    qib: 8.12,
    nii: 6.45,
    retail: 4.15,
    gmp: '+6%',
    gmpValue: 'Rs 9.50',
    status: 'Open',
    segment: 'Mainboard',
    totalApplications: 289540,
  },
  {
    company: 'Bharat Renewables',
    priceBand: 'Rs 188 - Rs 198',
    minPrice: 188,
    cutOffPrice: 198,
    lotSize: 75,
    issueSize: 'Rs 980 Cr',
    minInvestment: 'Rs 14,850',
    openDate: '14 Oct',
    closeDate: '18 Oct',
    allotmentDate: '20 Oct',
    listingDate: '24 Oct',
    subscription: 4.22,
    qib: 5.40,
    nii: 3.90,
    retail: 3.65,
    gmp: '+11%',
    gmpValue: 'Rs 22',
    status: 'Open',
    segment: 'Mainboard',
    totalApplications: 194120,
  },
  {
    company: 'Waaree Energies',
    priceBand: 'Rs 1,427 - Rs 1,503',
    minPrice: 1427,
    cutOffPrice: 1503,
    lotSize: 9,
    issueSize: 'Rs 4,321 Cr',
    minInvestment: 'Rs 13,527',
    openDate: '14 Oct',
    closeDate: '17 Oct',
    allotmentDate: '18 Oct',
    listingDate: '22 Oct',
    subscription: 8.76,
    qib: 12.40,
    nii: 9.80,
    retail: 5.90,
    gmp: '+95%',
    gmpValue: 'Rs 1,425',
    status: 'Open',
    segment: 'Mainboard',
    totalApplications: 412900,
  },
  {
    company: 'Quantum Microtech',
    priceBand: 'Rs 112 - Rs 118',
    minPrice: 112,
    cutOffPrice: 118,
    lotSize: 1200,
    issueSize: 'Rs 48 Cr',
    minInvestment: 'Rs 1,41,600',
    openDate: '13 Oct',
    closeDate: '16 Oct',
    allotmentDate: '17 Oct',
    listingDate: '21 Oct',
    subscription: 14.50,
    qib: 18.20,
    nii: 16.10,
    retail: 9.40,
    gmp: '+28%',
    gmpValue: 'Rs 33',
    status: 'Open',
    segment: 'SME',
    totalApplications: 58200,
  },

  // ── UPCOMING IPOS (OCTOBER & NOVEMBER 2026) ──────────────────────
  {
    company: 'Hyundai Motor India',
    priceBand: 'Rs 1,865 - Rs 1,960',
    minPrice: 1865,
    cutOffPrice: 1960,
    lotSize: 7,
    issueSize: 'Rs 27,870 Cr',
    minInvestment: 'Rs 13,720',
    openDate: '15 Oct',
    closeDate: '17 Oct',
    allotmentDate: '18 Oct',
    listingDate: '22 Oct',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+5%',
    gmpValue: 'Rs 95',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'Swiggy Limited',
    priceBand: 'Rs 371 - Rs 390',
    minPrice: 371,
    cutOffPrice: 390,
    lotSize: 38,
    issueSize: 'Rs 11,327 Cr',
    minInvestment: 'Rs 14,820',
    openDate: '20 Oct',
    closeDate: '23 Oct',
    allotmentDate: '24 Oct',
    listingDate: '29 Oct',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+12%',
    gmpValue: 'Rs 46',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'Deepak Builders & Engineers',
    priceBand: 'Rs 192 - Rs 203',
    minPrice: 192,
    cutOffPrice: 203,
    lotSize: 73,
    issueSize: 'Rs 260 Cr',
    minInvestment: 'Rs 14,819',
    openDate: '21 Oct',
    closeDate: '23 Oct',
    allotmentDate: '24 Oct',
    listingDate: '28 Oct',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+30%',
    gmpValue: 'Rs 61',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'Godavari Biorefineries',
    priceBand: 'Rs 334 - Rs 352',
    minPrice: 334,
    cutOffPrice: 352,
    lotSize: 42,
    issueSize: 'Rs 555 Cr',
    minInvestment: 'Rs 14,784',
    openDate: '23 Oct',
    closeDate: '25 Oct',
    allotmentDate: '28 Oct',
    listingDate: '30 Oct',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+10%',
    gmpValue: 'Rs 35',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'NTPC Green Energy',
    priceBand: 'Rs 102 - Rs 108',
    minPrice: 102,
    cutOffPrice: 108,
    lotSize: 138,
    issueSize: 'Rs 10,000 Cr',
    minInvestment: 'Rs 14,904',
    openDate: '24 Oct',
    closeDate: '28 Oct',
    allotmentDate: '29 Oct',
    listingDate: '3 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+15%',
    gmpValue: 'Rs 16',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'Afcons Infrastructure',
    priceBand: 'Rs 440 - Rs 463',
    minPrice: 440,
    cutOffPrice: 463,
    lotSize: 32,
    issueSize: 'Rs 5,430 Cr',
    minInvestment: 'Rs 14,816',
    openDate: '25 Oct',
    closeDate: '29 Oct',
    allotmentDate: '30 Oct',
    listingDate: '4 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+18%',
    gmpValue: 'Rs 83',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'Astra Solar',
    priceBand: 'Rs 265 - Rs 280',
    minPrice: 265,
    cutOffPrice: 280,
    lotSize: 53,
    issueSize: 'Rs 860 Cr',
    minInvestment: 'Rs 14,840',
    openDate: '26 Oct',
    closeDate: '30 Oct',
    allotmentDate: '31 Oct',
    listingDate: '5 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+8%',
    gmpValue: 'Rs 22',
    status: 'Upcoming',
    segment: 'SME',
    totalApplications: 0,
  },
  {
    company: 'Urban Infra Trust',
    priceBand: 'Rs 92 - Rs 98',
    minPrice: 92,
    cutOffPrice: 98,
    lotSize: 150,
    issueSize: 'Rs 740 Cr',
    minInvestment: 'Rs 14,700',
    openDate: '28 Oct',
    closeDate: '31 Oct',
    allotmentDate: '3 Nov',
    listingDate: '7 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+5%',
    gmpValue: 'Rs 5',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'ACME Solar Holdings',
    priceBand: 'Rs 275 - Rs 289',
    minPrice: 275,
    cutOffPrice: 289,
    lotSize: 51,
    issueSize: 'Rs 2,900 Cr',
    minInvestment: 'Rs 14,739',
    openDate: '29 Oct',
    closeDate: '31 Oct',
    allotmentDate: '4 Nov',
    listingDate: '6 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+14%',
    gmpValue: 'Rs 40',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'Sagility India',
    priceBand: 'Rs 28 - Rs 30',
    minPrice: 28,
    cutOffPrice: 30,
    lotSize: 500,
    issueSize: 'Rs 2,106 Cr',
    minInvestment: 'Rs 15,000',
    openDate: '30 Oct',
    closeDate: '4 Nov',
    allotmentDate: '5 Nov',
    listingDate: '7 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+7%',
    gmpValue: 'Rs 2.10',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'Tata Autocomp Systems',
    priceBand: 'Rs 580 - Rs 610',
    minPrice: 580,
    cutOffPrice: 610,
    lotSize: 24,
    issueSize: 'Rs 2,800 Cr',
    minInvestment: 'Rs 14,640',
    openDate: '2 Nov',
    closeDate: '6 Nov',
    allotmentDate: '7 Nov',
    listingDate: '11 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+24%',
    gmpValue: 'Rs 145',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'Lenskart Solutions',
    priceBand: 'Rs 420 - Rs 445',
    minPrice: 420,
    cutOffPrice: 445,
    lotSize: 33,
    issueSize: 'Rs 3,200 Cr',
    minInvestment: 'Rs 14,685',
    openDate: '8 Nov',
    closeDate: '12 Nov',
    allotmentDate: '13 Nov',
    listingDate: '17 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+18%',
    gmpValue: 'Rs 80',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },
  {
    company: 'HDB Financial Services',
    priceBand: 'Rs 740 - Rs 775',
    minPrice: 740,
    cutOffPrice: 775,
    lotSize: 19,
    issueSize: 'Rs 12,500 Cr',
    minInvestment: 'Rs 14,725',
    openDate: '15 Nov',
    closeDate: '19 Nov',
    allotmentDate: '20 Nov',
    listingDate: '24 Nov',
    subscription: 0.0,
    qib: 0.0,
    nii: 0.0,
    retail: 0.0,
    gmp: '+20%',
    gmpValue: 'Rs 155',
    status: 'Upcoming',
    segment: 'Mainboard',
    totalApplications: 0,
  },

  // ── CLOSED / RECENTLY LISTED IPOS ──────────────────────────────────
  {
    company: 'FinEdge Technologies',
    priceBand: 'Rs 520 - Rs 548',
    minPrice: 520,
    cutOffPrice: 548,
    lotSize: 27,
    issueSize: 'Rs 1,860 Cr',
    minInvestment: 'Rs 14,796',
    openDate: '28 Sep',
    closeDate: '2 Oct',
    allotmentDate: '3 Oct',
    listingDate: '7 Oct',
    subscription: 18.42,
    qib: 24.50,
    nii: 19.80,
    retail: 11.20,
    gmp: '+22%',
    gmpValue: 'Rs 120',
    status: 'Closed',
    segment: 'Mainboard',
    totalApplications: 840120,
  },
  {
    company: 'GreenGrid Power',
    priceBand: 'Rs 310 - Rs 326',
    minPrice: 310,
    cutOffPrice: 326,
    lotSize: 46,
    issueSize: 'Rs 1,125 Cr',
    minInvestment: 'Rs 14,996',
    openDate: '20 Sep',
    closeDate: '24 Sep',
    allotmentDate: '25 Sep',
    listingDate: '29 Sep',
    subscription: 12.76,
    qib: 16.40,
    nii: 14.10,
    retail: 8.50,
    gmp: '+16%',
    gmpValue: 'Rs 52',
    status: 'Listed',
    segment: 'Mainboard',
    totalApplications: 620400,
  },
  {
    company: 'CarePoint Hospitals',
    priceBand: 'Rs 214 - Rs 226',
    minPrice: 214,
    cutOffPrice: 226,
    lotSize: 66,
    issueSize: 'Rs 680 Cr',
    minInvestment: 'Rs 14,916',
    openDate: '15 Sep',
    closeDate: '19 Sep',
    allotmentDate: '20 Sep',
    listingDate: '24 Sep',
    subscription: 8.35,
    qib: 10.20,
    nii: 9.15,
    retail: 5.70,
    gmp: '+11%',
    gmpValue: 'Rs 25',
    status: 'Listed',
    segment: 'SME',
    totalApplications: 410300,
  },
  {
    company: 'BluePeak Retail',
    priceBand: 'Rs 146 - Rs 154',
    minPrice: 146,
    cutOffPrice: 154,
    lotSize: 96,
    issueSize: 'Rs 510 Cr',
    minInvestment: 'Rs 14,784',
    openDate: '10 Sep',
    closeDate: '14 Sep',
    allotmentDate: '15 Sep',
    listingDate: '19 Sep',
    subscription: 5.14,
    qib: 6.80,
    nii: 5.40,
    retail: 3.25,
    gmp: '+6%',
    gmpValue: 'Rs 9',
    status: 'Closed',
    segment: 'SME',
    totalApplications: 275000,
  },
];

const liveIposState = initialIposData.map((ipo) => ({ ...ipo }));

const UPSTOX_IPO_API_URL = 'https://api.upstox.com/v2/ipos';
const UPSTOX_IPO_CACHE_TTL_MS = 60_000;
const UPSTOX_IPO_STATUSES = ['open', 'upcoming'];
const isActiveIpo = (ipo) => ['open', 'upcoming', 'open soon'].includes(
  String(ipo.status || '').trim().toLowerCase(),
);
const getActiveIpos = (ipos) => ipos.filter(isActiveIpo);
let upstoxIpoCache = null;
let upstoxIpoRequest = null;

const formatIpoDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
};

const formatIpoAmount = (value) => Number(value).toLocaleString('en-IN');

const mapUpstoxIpo = (item, fallbackStatus = 'upcoming') => {
  const timeline = item.timeline || {};
  const minimumPrice = Number(item.minimum_price) > 0 ? Number(item.minimum_price) : null;
  const maximumPrice = Number(item.maximum_price) > 0 ? Number(item.maximum_price) : null;
  const priceBand = minimumPrice === null
    ? 'Not announced'
    : maximumPrice && maximumPrice !== minimumPrice
      ? `₹${formatIpoAmount(minimumPrice)} – ₹${formatIpoAmount(maximumPrice)}`
      : `₹${formatIpoAmount(maximumPrice || minimumPrice)}`;
  const totalSubscription = item.total_subscription == null || item.total_subscription === ''
    ? null
    : Number(item.total_subscription);
  const minimumInvestment = Number(item.minimum_quantity) > 0 && Number(item.cut_off_price) > 0
    ? `₹${formatIpoAmount(Number(item.minimum_quantity) * Number(item.cut_off_price))}`
    : '';

  return {
    id: item.id,
    symbol: item.symbol || '',
    isin: item.isin || '',
    company: (item.name || item.symbol || 'Unnamed IPO').replace(/\s+IPO$/i, ''),
    priceBand,
    minPrice: minimumPrice,
    cutOffPrice: Number(item.cut_off_price) || maximumPrice || minimumPrice || null,
    lotSize: Number(item.lot_size) || null,
    issueSize: item.issue_size != null && Number.isFinite(Number(item.issue_size))
      ? `₹${formatIpoAmount(item.issue_size)} Cr`
      : '—',
    minInvestment: minimumInvestment,
    openDate: formatIpoDate(timeline.application_start_date || item.bidding_start_date),
    closeDate: formatIpoDate(timeline.application_end_date || item.bidding_end_date),
    allotmentDate: formatIpoDate(timeline.allotment_date),
    listingDate: formatIpoDate(timeline.listing_date),
    subscription: totalSubscription !== null && Number.isFinite(totalSubscription) ? `${totalSubscription.toFixed(2)}x` : '—',
    qibFormatted: item.qib_subscription == null ? '' : `${item.qib_subscription}x`,
    niiFormatted: item.nii_subscription == null ? '' : `${item.nii_subscription}x`,
    retailFormatted: item.retail_subscription == null ? '' : `${item.retail_subscription}x`,
    gmp: '',
    gmpValue: 'Not provided',
    status: (item.status || fallbackStatus).replace(/^./, (letter) => letter.toUpperCase()),
    segment: item.issue_type === 'sme' ? 'SME' : 'Mainboard',
    totalApplications: null,
    industry: item.industry || '',
    listingPrice: item.listing_price ?? null,
    listingExchange: item.listing_exchange || '',
    prospectusUrl: item.rhp_url || item.drhp_url || '',
    registrar: item.registrar_info || null,
    source: 'upstox',
    isLive: true,
  };
};

const getUpstoxIpoFeed = async () => {
  if (upstoxIpoCache && Date.now() - upstoxIpoCache.fetchedAt < UPSTOX_IPO_CACHE_TTL_MS) {
    return upstoxIpoCache;
  }
  if (upstoxIpoRequest) return upstoxIpoRequest;

  upstoxIpoRequest = (async () => {
    const token = process.env.UPSTOX_ACCESS_TOKEN;
    if (!token) throw new Error('UPSTOX_ACCESS_TOKEN is not configured.');

    const responses = await Promise.all(UPSTOX_IPO_STATUSES.map((status) => axios.get(UPSTOX_IPO_API_URL, {
      params: { status, page_number: 1, records: 30 },
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: 12_000,
    })));

    const uniqueIpos = new Map();
    for (const [index, response] of responses.entries()) {
      for (const item of response.data?.data || []) {
        if (item.id) uniqueIpos.set(item.id, mapUpstoxIpo(item, UPSTOX_IPO_STATUSES[index]));
      }
    }

    const fetchedAt = Date.now();
    upstoxIpoCache = {
      data: getActiveIpos([...uniqueIpos.values()]),
      fetchedAt,
      lastUpdated: new Date(fetchedAt).toISOString(),
    };
    return upstoxIpoCache;
  })();

  try {
    return await upstoxIpoRequest;
  } finally {
    upstoxIpoRequest = null;
  }
};

const formatDemoIpos = () => liveIposState.map((ipo) => ({
  ...ipo,
  subscription: `${Number(ipo.subscription).toFixed(2)}x`,
  qibFormatted: `${Number(ipo.qib).toFixed(2)}x`,
  niiFormatted: `${Number(ipo.nii).toFixed(2)}x`,
  retailFormatted: `${Number(ipo.retail).toFixed(2)}x`,
  source: 'demo',
  isLive: false,
}));

// 1-second simulated live subscription & application updates for OPEN IPOs
// Zerodha (Kite Connect) batch quote proxy
app.get('/api/zerodha/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'No symbols supplied' });

  const token = process.env.ZERODHA_TOKEN;
  const base = process.env.ZERODHA_BASE_URL || 'https://api.kite.trade';

  if (!token) {
    // Fallback to simulated data per symbol
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    return res.json(fallback);
  }

  try {
    const url = `${base}/quote?i=${symbols.join(',')}`;
    const resp = await fetch(url, { headers: { Authorization: `token ${token}` } });
    if (!resp.ok) throw new Error(`Zerodha ${resp.status}`);
    const raw = await resp.json();
    const formatted = symbols.reduce((out, sym) => {
      const q = raw[sym];
      if (q) {
        out[sym] = {
          c: q.last_price,
          d: q.change,
          dp: (q.change / q.last_price) * 100,
          h: q.high_price,
          l: q.low_price,
          o: q.open_price,
          pc: q.close_price,
          v: q.volume,
          isLive: true,
          provider: 'Zerodha',
          timestamp: new Date().toISOString(),
        };
      }
      return out;
    }, {});
    res.json(formatted);
  } catch (e) {
    console.error('Zerodha proxy error → fallback', e);
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    res.json(fallback);
  }
});
// RapidAPI (e.g., Yahoo Finance) batch quote proxy – fallback when Zerodha is unavailable
app.get('/api/rapid/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'No symbols supplied' });

  const rapidKey = process.env.RAPIDAPI_KEY;
  const rapidHost = process.env.RAPIDAPI_HOST; // e.g., 'yfapi.net'
  if (!rapidKey || !rapidHost) {
    console.warn('RapidAPI credentials missing – falling back to simulated data');
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    return res.json(fallback);
  }

  try {
    const url = `https://${rapidHost}/stock/v2/get-summary?symbol=${symbols.join(',')}`;
    const resp = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': rapidKey,
        'X-RapidAPI-Host': rapidHost,
      },
    });
    if (!resp.ok) throw new Error(`RapidAPI ${resp.status}`);
    const raw = await resp.json(); // structure depends on the chosen API
    // Assume raw is an array [{symbol, price, open, high, low, previousClose, volume, change, changePercent, timestamp}]
    const formatted = {};
    raw.forEach((q) => {
      const sym = q.symbol?.toUpperCase();
      if (!sym) return;
      formatted[sym] = {
        c: q.price,
        d: q.change,
        dp: q.changePercent,
        h: q.high,
        l: q.low,
        o: q.open,
        pc: q.previousClose,
        v: q.volume,
        isLive: true,
        provider: 'RapidAPI',
        timestamp: q.timestamp || new Date().toISOString(),
      };
    });
    res.json(formatted);
  } catch (e) {
    console.error('RapidAPI proxy error → fallback', e);
    const fallback = symbols.reduce((out, sym) => ({ ...out, [sym]: generateDynamicQuote(sym) }), {});
    res.json(fallback);
  }
});
// Existing Zerodha route remains above
setInterval(() => {
  for (const ipo of liveIposState) {
    if (ipo.status === 'Open') {
      // Add small incoming bids per second
      const newApps = Math.floor(1 + Math.random() * 8);
      ipo.totalApplications += newApps;

      const subDelta = Number((Math.random() * 0.004).toFixed(3));
      ipo.subscription = Number((ipo.subscription + subDelta).toFixed(2));
      ipo.retail = Number((ipo.retail + subDelta * 0.6).toFixed(2));
      ipo.qib = Number((ipo.qib + subDelta * 1.3).toFixed(2));
      ipo.nii = Number((ipo.nii + subDelta * 0.9).toFixed(2));
    }
  }
}, 1000);

// Calendar events are proxied server-side so provider credentials never reach the browser.
app.get('/api/calendar', async (req, res) => {
  const kind = String(req.query.kind || '').toLowerCase();
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const forceRefresh = req.query.refresh === '1';
  const fromDate = calendarDate(from);
  const toDate = calendarDate(to);
  if (!fromDate || !toDate || from > to) {
    return res.status(400).json({ error: 'Use valid from and to dates in YYYY-MM-DD format.', code: 'invalid_calendar_range' });
  }
  if ((toDate - fromDate) / 86_400_000 > 365) {
    return res.status(400).json({ error: 'Calendar date ranges are limited to one year.', code: 'calendar_range_too_large' });
  }
  if (!CALENDAR_FEEDS[kind] && kind !== 'expiries') {
    return res.status(400).json({ error: 'Unsupported calendar category.', code: 'unsupported_calendar' });
  }

  try {
    let events;
    let lastUpdated;
    let cacheMs;
    let stale = false;
    let provider = 'Finance Calendar';
    let providerUrl = FINANCE_CALENDAR_SOURCE_URL;
    let configured = true;
    let note = 'Calendar dates come from the Finance Calendar feed.';
    if (kind === 'expiries') {
      const expiryFeed = await getNseExpiryEvents(from, to, forceRefresh);
      events = expiryFeed.events;
      lastUpdated = expiryFeed.lastUpdated || new Date().toISOString();
      cacheMs = CALENDAR_FEEDS.holidays.cacheMs;
      stale = expiryFeed.stale;
      if (!expiryFeed.holidayDatesAvailable) {
        note = 'Expiry dates follow the published NSE monthly rule. A holiday feed was unavailable, so a holiday adjustment could not be verified.';
      } else if (stale) {
        note = 'Showing expiry dates calculated with the last successful NSE holiday feed; the latest holiday refresh failed.';
      } else {
        note = 'Rule-derived using the NSE monthly expiry schedule and Finance Calendar holiday dates.';
      }
    } else if (kind === 'economic' || kind === 'holidays') {
      let feed;
      if (kind === 'holidays') {
        feed = await getFinanceNseHolidays(from, to, forceRefresh);
      } else {
        feed = await fetchFinanceCalendar('/calendar', {
          from,
          to,
          country: 'IN',
          tz: 'Asia/Kolkata',
          limit: 500,
        }, 5 * 60 * 1000, `finance:economic:${from}:${to}`, forceRefresh);
      }
      events = feed.data.map((item, index) => normalizeCalendarEvent(kind, item, index)).filter(Boolean);
      lastUpdated = feed.lastUpdated;
      cacheMs = kind === 'economic' ? 5 * 60 * 1000 : CALENDAR_FEEDS.holidays.cacheMs;
      stale = Boolean(feed.stale);
      note = kind === 'economic'
        ? 'India economic releases and central-bank dates. Coverage varies by published source schedule.'
        : 'NSE India closures and early closes from the published exchange calendar.';
      if (kind === 'holidays' && feed.missingYears?.length) {
        note += ` The provider has not published ${feed.missingYears.join(', ')} yet.`;
      }
      if (stale) note = 'Showing the last successful Finance Calendar feed; its latest refresh failed.';
    } else {
      const config = CALENDAR_FEEDS[kind];
      const params = { from, to };
      const cacheKey = `${kind}:${from}:${to}`;
      const feed = await fetchFmpCalendar(config.endpoint, params, config.cacheMs, cacheKey, forceRefresh);
      const indiaOnlyKinds = new Set(['earnings', 'dividends', 'splits', 'ipos']);
      const providerEvents = indiaOnlyKinds.has(kind) ? feed.data.filter(isIndianCalendarListing) : feed.data;
      events = providerEvents.map((item, index) => normalizeCalendarEvent(kind, item, index)).filter(Boolean);
      lastUpdated = feed.lastUpdated;
      cacheMs = config.cacheMs;
      stale = Boolean(feed.stale);
      provider = 'Financial Modeling Prep';
      providerUrl = 'https://site.financialmodelingprep.com/developer/docs';
      configured = Boolean(process.env.FMP_API_KEY);
      if (indiaOnlyKinds.has(kind)) note = 'Only Indian listing tickers and NSE/BSE exchange records are included.';
      if (stale) note = 'Showing the last successful provider feed; its latest refresh failed.';
    }

    return res.json({
      kind,
      data: events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
      count: events.length,
      provider,
      providerUrl,
      live: !stale,
      stale,
      configured,
      lastUpdated,
      refreshIntervalMs: cacheMs,
      note,
    });
  } catch (error) {
    if (error.code === 'calendar_provider_not_configured') {
      const data = getCalendarPreviewEvents(kind, from, to);
      return res.json({
        kind,
        data,
        count: data.length,
        provider: 'Demo preview',
        providerUrl: null,
        live: false,
        stale: false,
        demo: true,
        configured: false,
        lastUpdated: new Date().toISOString(),
        refreshIntervalMs: 5 * 60 * 1000,
        note: 'Preview dates are examples only, not real company announcements. Add an FMP_API_KEY with Indian market access for actual earnings, dividends, splits, and IPO events.',
      });
    }
    console.error(`Calendar provider request failed (${kind}):`, error.response?.status || error.message);
    return res.status(502).json({
      error: kind === 'economic' || kind === 'holidays' || kind === 'expiries'
        ? 'Finance Calendar could not load this feed. Please refresh in a moment.'
        : 'Financial Modeling Prep could not load this feed. Check the API key and Indian market access, then try again.',
      code: 'calendar_provider_error',
      configured: kind === 'economic' || kind === 'holidays' || kind === 'expiries' || Boolean(process.env.FMP_API_KEY),
    });
  }
});

// GET /api/ipos - Upstox IPO feed with an explicitly labelled local demo fallback.
app.get('/api/ipos', async (req, res) => {
  if (!process.env.UPSTOX_ACCESS_TOKEN) {
    const data = getActiveIpos(formatDemoIpos());
    return res.json({
      success: true,
      count: data.length,
      data,
      source: 'demo',
      live: false,
      configured: false,
      lastUpdated: new Date().toISOString(),
      message: 'Add UPSTOX_ACCESS_TOKEN to .env and restart the server to load the live IPO feed.',
    });
  }

  try {
    const feed = await getUpstoxIpoFeed();
    const data = feed.data;
    return res.json({
      success: true,
      count: data.length,
      data,
      source: 'upstox',
      live: true,
      configured: true,
      lastUpdated: feed.lastUpdated,
      refreshIntervalMs: UPSTOX_IPO_CACHE_TTL_MS,
    });
  } catch (error) {
    if (upstoxIpoCache?.data?.length) {
      const data = upstoxIpoCache.data;
      return res.json({
        success: true,
        count: data.length,
        data,
        source: 'upstox',
        live: false,
        stale: true,
        configured: true,
        lastUpdated: upstoxIpoCache.lastUpdated,
        message: 'Showing the last successful Upstox IPO feed; the latest refresh failed.',
      });
    }

    console.error('Upstox IPO feed request failed:', error.response?.status || error.message);
    const data = getActiveIpos(formatDemoIpos());
    return res.json({
      success: true,
      count: data.length,
      data,
      source: 'demo',
      live: false,
      configured: true,
      lastUpdated: new Date().toISOString(),
      message: 'Upstox could not refresh the IPO feed. Check that the access token is valid; demo data is shown.',
    });
  }
});

// GET /api/ipo/:company - Full Upstox detail, looked up by IPO ID or company name.
app.get('/api/ipo/:company', async (req, res) => {
  const lookup = decodeURIComponent(req.params.company).toLowerCase();

  if (process.env.UPSTOX_ACCESS_TOKEN) {
    try {
      const feed = await getUpstoxIpoFeed();
      const listedIpo = feed.data.find((ipo) => (
        ipo.id?.toLowerCase() === lookup || ipo.company.toLowerCase() === lookup
      ));
      if (!listedIpo) return res.status(404).json({ error: 'IPO not found in this list.' });
      if (listedIpo.source === 'manual') {
        return res.json({ ...listedIpo, lastUpdate: new Date().toISOString() });
      }
      const ipoId = listedIpo.id;
      const response = await axios.get(`${UPSTOX_IPO_API_URL}/${encodeURIComponent(ipoId)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}` },
        timeout: 12_000,
      });
      if (response.data?.status !== 'success' || !response.data?.data) {
        return res.status(502).json({ error: 'Upstox returned an invalid IPO detail response.' });
      }
      return res.json({
        ...mapUpstoxIpo(response.data.data),
        source: 'upstox',
        isLive: true,
        lastUpdate: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Upstox IPO details request failed:', error.response?.status || error.message);
      return res.status(error.response?.status === 404 ? 404 : 502).json({
        error: error.response?.status === 404 ? 'IPO not found in the Upstox feed.' : 'Could not load IPO details from Upstox.',
      });
    }
  }

  const found = getActiveIpos(formatDemoIpos()).find((ipo) => (
    ipo.company.toLowerCase() === lookup || ipo.id?.toLowerCase() === lookup
  ));
  if (!found) return res.status(404).json({ error: 'IPO not found' });
  return res.json({
    ...found,
    lastUpdate: new Date().toISOString(),
  });
});

// POST /api/ipo/apply - Real-time IPO application
app.post('/api/ipo/apply', (req, res) => {
  const { company, lots = 1, upiId } = req.body;
  const ipo = liveIposState.find((i) => i.company.toLowerCase() === (company || '').toLowerCase());
  if (!ipo) {
    return res.status(404).json({ error: 'IPO not found' });
  }
  if (ipo.status !== 'Open') {
    return res.status(400).json({ error: `Cannot apply: IPO status is ${ipo.status}` });
  }

  // Update live subscription stats
  ipo.totalApplications += 1;
  const lotDelta = (lots * 0.001);
  ipo.subscription = Number((ipo.subscription + lotDelta).toFixed(2));
  ipo.retail = Number((ipo.retail + lotDelta).toFixed(2));

  const investment = lots * ipo.lotSize * ipo.cutOffPrice;
  res.json({
    success: true,
    message: `IPO application submitted for ${ipo.company}`,
    application: {
      company: ipo.company,
      lots,
      amount: `Rs ${investment.toLocaleString('en-IN')}`,
      upiId: upiId || 'N/A',
      status: 'Submitted',
      timestamp: new Date().toISOString(),
    },
  });
});

app.get('/api/fmp-test/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const feed = CALENDAR_FEEDS[type];
    if (!feed) return res.status(400).json({ error: 'Invalid calendar type' });
    const result = await fetchFmpCalendar(feed.endpoint, { exchange: 'NSE' }, feed.cacheMs, `test:${type}`);
    res.json(result);
  } catch (err) {
    const code = err.code || 'server_error';
    res.status(500).json({ error: err.message, code });
  }
});
export default app;

if (process.env.VERCEL !== '1' && process.env.VERCEL_FUNCTIONS !== '1') {
  const server = app.listen(PORT, () => {
    console.log(`Live Market Proxy listening on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    closeKunDataConnection();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
