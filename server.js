import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  closeKunDataConnection,
  getKunDataStatus,
  getKunHistory,
  getKunQuotes,
  isKunDataConfigured,
  subscribeKunQuotes,
} from './kunDataProvider.js';
import { getYahooResearchProviderName, getYahooResearchQuotes, getYahooResearchHistory, isYahooResearchEnabled } from './yfinanceResearchProvider.js';
import { getSectorHeatmapData } from './serverMarketAnalytics.js';
import { aggregateCandles, mergeNote, planResolution, resolutionSeconds, SUPPORTED_RESOLUTIONS } from './candleResolution.js';
import {
  classifyExchangeQuote,
  metalUnitPrices,
  TROY_OUNCE_GRAMS as TROY_OUNCE_IN_GRAMS,
} from './metalQuoteMath.js';
import { getNseIndexFeedStatus, getNseIndexQuotes, isNseIndexSymbol } from './nseIndexProvider.js';
import { analyzeSymbol, answerCopilot, getAIStatus, getLLMConfig } from './aiAnalyst.js';
import { readSessionUser, registerAuthRoutes } from './serverAuth.js';
import { getPaperQuotes, initAutoTrade } from './serverAutoTrade.js';
import { attachCoreWebSocket, closeCoreRealtime, publish } from './serverCoreBus.js';
import { coreHealthMiddleware, startHealthMonitor, stopHealthMonitor } from './serverHealth.js';
import { startRecoveryMonitor, stopRecoveryMonitor } from './serverRecovery.js';
import { registerCoreRoutes } from './serverCoreRoutes.js';
import { registerBrokerRoutes } from './serverBrokerRoutes.js';
import { registerNotificationRoutes } from './serverNotifications.js';
import { registerAdminRoutes } from './serverAdmin.js';
import { registerForecastRoutes } from './serverForecasts.js';
import { registerMetalTradingRoutes, startMetalPaperOrderMatcher } from './serverMetalTrading.js';
import { registerComplianceRoutes } from './serverCompliance.js';
import { registerMutualFundRoutes } from './serverMutualFunds.js';
import { createApiRateLimiter, resolveTrustProxy, securityHeaders } from './serverSecurity.js';
import { registerCompanyLogoRoutes } from './serverCompanyLogos.js';
import { computeMetalInsight } from './metalInsight.js';
import { registerFnoRoutes } from './serverFnoMarket.js';
import { applySentiment, SENTIMENT_METHOD } from './serverNewsSentiment.js';
import { createFnoLiveService } from './serverFnoLive.js';
import { listAdapters, liveTradingMasterEnabled } from './serverBrokers/index.js';
import { ensureInstrumentCache, instrumentStatus } from './serverBrokerInstruments.js';
import { getDatabase } from './serverDb.js';
import { buildMarketStatus, getMarketCalendarDateParts } from './serverMarketStatus.js';
import {
  seedOfficialMarketCalendar,
  getMCXScheduleStatus,
  getUpcomingHolidays,
  getSpecialSessions,
  getHolidaysForYear,
  getISTParts,
  timeToMinutes,
} from './serverMarketSchedule.js';

dotenv.config();

const DATA_DIR = path.join(process.cwd(), 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const app = express();
app.set('trust proxy', resolveTrustProxy());
app.disable('x-powered-by');

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use(securityHeaders());
app.use((req, res, next) => {
  if (!mutatingMethods.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.headers.host;
  try {
    // Compare hostnames only: the dev server proxies /api to another local port,
    // so an exact host:port match would reject legitimate same-host requests.
    // Localhost aliases (localhost / 127.0.0.1 / ::1) are the same machine.
    const isLoopback = (name) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(name);
    const originHostname = new URL(origin).hostname.toLowerCase();
    const requestHostname = new URL(`http://${host}`).hostname.toLowerCase();
    const sameSite = originHostname && requestHostname
      && (originHostname === requestHostname || (isLoopback(originHostname) && isLoopback(requestHostname)));
    if (!sameSite) {
      return res.status(403).json({ error: 'Cross-site requests are blocked for this endpoint.', code: 'cross_site_request_blocked' });
    }
  } catch {
    return res.status(403).json({ error: 'The request origin could not be verified.', code: 'invalid_request_origin' });
  }
  return next();
});
const MUTUAL_FUND_API_URL = 'https://api.mfapi.in';
const mutualFundCache = new Map();
const mutualFundRequests = new Map();
const fetchMutualFundPayload = async (cacheKey, path, params = {}, cacheMs = 10 * 60 * 1000, forceRefresh = false) => {
  const cached = mutualFundCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.savedAt < cacheMs) return cached.payload;
  if (mutualFundRequests.has(cacheKey)) return mutualFundRequests.get(cacheKey);
  const request = axios.get(`${MUTUAL_FUND_API_URL}${path}`, {
    params,
    timeout: 12_000,
    headers: { Accept: 'application/json' },
  }).then(({ data }) => {
    mutualFundCache.set(cacheKey, { payload: data, savedAt: Date.now() });
    return data;
  }).finally(() => {
    if (mutualFundRequests.get(cacheKey) === request) mutualFundRequests.delete(cacheKey);
  });
  mutualFundRequests.set(cacheKey, request);
  return request;
};
app.use(express.json());
registerCompanyLogoRoutes(app, {
  cacheDir: process.env.VERCEL_FUNCTIONS === '1' ? path.join(os.tmpdir(), 'logo-cache') : path.join(DATA_DIR, 'logo-cache'),
});
app.use('/api', createApiRateLimiter());
app.use('/api', coreHealthMiddleware);
const PORT = process.env.PORT_PROXY || process.env.PORT || 3001;
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
const UPSTOX_BASE_URL = 'https://api.upstox.com/v2';
const UPSTOX_NSE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const UPSTOX_MCX_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz';
const UPSTOX_GLOBAL_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/global.json.gz';
const METAL_SPOT_API_URL = 'https://api.goldprice.dev/v1/prices';
const METAL_SPOT_CACHE_MS = 10 * 60 * 1000;
const METAL_SPOT_STALE_AFTER_MS = 20 * 60 * 1000;
const COMMODITY_BENCHMARK_CACHE_MS = 4 * 1000;
const COMMODITY_BENCHMARK_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const COMMODITY_BENCHMARKS = {
  CRUDEOIL: { yahooSymbol: 'CL=F', label: 'WTI crude futures', unit: 'INR/bbl', unitMultiplier: 1 },
  NATURALGAS: { yahooSymbol: 'NG=F', label: 'Henry Hub natural gas futures', unit: 'INR/MMBtu', unitMultiplier: 1 },
  ALUMINIUM: { yahooSymbol: 'ALI=F', label: 'COMEX aluminium futures', unit: 'INR/kg', unitMultiplier: 0.001 },
  ZINC: { yahooSymbol: 'ZNC=F', label: 'COMEX zinc futures', unit: 'INR/kg', unitMultiplier: 0.001 },
  COPPER: { yahooSymbol: 'HG=F', label: 'COMEX copper futures', unit: 'INR/kg', unitMultiplier: 2.20462262 },
  GOLD: { yahooSymbol: 'GC=F', label: 'COMEX gold futures', unit: 'INR/10g', unitMultiplier: 10 / 31.1034768 },
  SILVER: { yahooSymbol: 'SI=F', label: 'COMEX silver futures', unit: 'INR/kg', unitMultiplier: 1000 / 31.1034768 },
};
const commodityBenchmarkCache = new Map();
const commodityBenchmarkRequests = new Map();
let usdInrRateCache = null;
let usdInrRateRequest = null;
const METAL_HISTORY_SYMBOLS = {
  GOLD: { yahooSymbol: 'GC=F', label: 'COMEX gold futures', unit: 'INR/10g', gramsPerUnit: 10 },
  SILVER: { yahooSymbol: 'SI=F', label: 'COMEX silver futures', unit: 'INR/kg', gramsPerUnit: 1000 },
};
// Yahoo publishes these granularities for the metal/benchmark series. Every
// coarser bar shown in the chart is merged from the widest native bar that
// divides it exactly, so no candle is ever built from anything but provider bars.
const YAHOO_NATIVE_INTERVALS = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m',
  '1d': '1d', '1w': '1wk', '1M': '1mo',
};
const buildYahooIntervalTable = (resolutions) => Object.fromEntries(resolutions
  .map((resolution) => {
    const plan = planResolution(resolution, Object.keys(YAHOO_NATIVE_INTERVALS));
    if (!plan) return null;
    return [resolution, {
      interval: YAHOO_NATIVE_INTERVALS[plan.baseResolution],
      baseSeconds: plan.baseSeconds,
      bucketSeconds: plan.seconds,
      effectiveResolution: plan.baseResolution,
      fallbackNote: mergeNote(plan),
    }];
  })
  .filter(Boolean));
const METAL_HISTORY_INTERVALS = buildYahooIntervalTable([
  '1m', '3m', '5m', '10m', '15m', '30m', '45m', '1h', '2h', '4h', '5h',
  '1d', 'D', '1w', 'W', '1M', 'M',
]);
const METAL_YEAR_RANGE_CACHE_MS = 6 * 60 * 60 * 1000;
const metalYearRangeCache = new Map();
const metalYearRangeRequests = new Map();
const ZERODHA_BASE_URL = 'https://api.kite.trade';
const GROWW_BASE_URL = 'https://api.groww.in/v1';
const FMP_BASE_URL = 'https://financialmodelingprep.com';
const FINANCE_CALENDAR_BASE_URL = 'https://www.financecalendar.com/wp-json/fc/v1';
const FINANCE_CALENDAR_SOURCE_URL = 'https://www.financecalendar.com/api/';
const NSE_HOLIDAY_PAGE_URL = 'https://www.nseindia.com/resources/exchange-communication-holidays';
const NSE_EVENTS_PAGE_URL = 'https://www.nseindia.com/companies-listing/corporate-filings-financial-results';
const NSE_CORPORATE_ACTIONS_PAGE_URL = 'https://www.nseindia.com/companies-listing/corporate-filings-actions';
const NSE_CORPORATE_EVENT_CACHE_MS = 3 * 60 * 60 * 1000;
const CALENDAR_MAX_EVENTS = 600;
const calendarCache = new Map();

const financeCalendarApiKey = () => {
  const key = process.env.FINANCE_CALENDAR_API_KEY;
  return key && !/^(your_|paste_)/i.test(key) ? key : null;
};

const fmpApiKey = () => {
  const key = process.env.FMP_API_KEY;
  return key && !/^(your_|paste_)/i.test(key) ? key : null;
};

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
  const apiKey = fmpApiKey();
  if (!apiKey) {
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
  const apiKey = financeCalendarApiKey();
  if (!apiKey) {
    const error = new Error('The economic calendar needs a Finance Calendar API key.');
    error.code = 'calendar_api_key_required';
    throw error;
  }

  let response;
  try {
    response = await axios.get(`${FINANCE_CALENDAR_BASE_URL}${endpoint}`, {
      params,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
      },
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

const normalizeExchangeTime = (hourText, minuteText, meridiem = '') => {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = String(meridiem).toUpperCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59 || hour > 23) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === 'PM' && hour !== 12) hour += 12;
    if (suffix === 'AM' && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const nseSessionHours = (item) => {
  const explicitStart = calendarText(item.start_time, item.startTime, item.open_time, item.openTime);
  const explicitEnd = calendarText(item.end_time, item.endTime, item.close_time, item.closeTime, item.close_time_local);
  const raw = [item.morning_session, item.evening_session, item.session, item.trading_hours, item.hours]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const parseClock = (value) => {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(String(value || '').trim());
    return match ? normalizeExchangeTime(match[1], match[2], match[3]) : null;
  };
  let startTime = parseClock(explicitStart);
  let endTime = parseClock(explicitEnd);
  if (!startTime || !endTime) {
    const rangePattern = /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(?:-|–|—|to)\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
    for (const value of raw) {
      const match = rangePattern.exec(value);
      if (!match) continue;
      startTime = normalizeExchangeTime(match[1], match[2], match[3]);
      endTime = normalizeExchangeTime(match[4], match[5], match[6]);
      if (startTime && endTime) break;
    }
  }
  return startTime && endTime ? { startTime, endTime } : null;
};

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

const NSE_MONTH_INDEX = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const calendarIsoFromNseDate = (value) => {
  const text = String(value || '').trim();
  const monthMatch = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text);
  if (monthMatch) {
    const month = NSE_MONTH_INDEX.indexOf(monthMatch[2].toLowerCase());
    if (month < 0) return '';
    return `${monthMatch[3]}-${String(month + 1).padStart(2, '0')}-${monthMatch[1].padStart(2, '0')}`;
  }
  const numericMatch = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
  if (numericMatch) {
    return `${numericMatch[3]}-${numericMatch[2].padStart(2, '0')}-${numericMatch[1].padStart(2, '0')}`;
  }
  return '';
};

const nseDateParam = (isoDate) => {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
};

const fetchNseCalendarJson = async (url, cacheKey, cacheMs, forceRefresh = false, referer = 'https://www.nseindia.com/') => {
  const cached = calendarCache.get(cacheKey);
  const now = Date.now();
  if (!forceRefresh && cached?.lastFailureAt && now - cached.lastFailureAt < 60_000) return { ...cached, stale: true };
  if (!forceRefresh && cached && !cached.stale && now - cached.fetchedAt < cacheMs) return cached;

  let response;
  try {
    response = await axios.get(url, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        Referer: referer,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
      },
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

  if (!response.data || typeof response.data !== 'object') {
    throw new Error('NSE returned an unexpected calendar response.');
  }

  const fetchedAt = Date.now();
  const result = {
    data: response.data,
    fetchedAt,
    lastUpdated: new Date(fetchedAt).toISOString(),
    stale: false,
  };
  calendarCache.set(cacheKey, result);
  return result;
};

const getFinanceNseHolidays = async (from, to, forceRefresh = false) => {
  const fromDate = calendarDate(from);
  const toDate = calendarDate(to);
  if (!fromDate || !toDate) return { data: [], lastUpdated: null, stale: false, missingYears: [] };

  const feed = await fetchNseCalendarJson(
    'https://www.nseindia.com/api/holiday-master?type=trading',
    'nse:holidays',
    CALENDAR_FEEDS.holidays.cacheMs,
    forceRefresh,
    NSE_HOLIDAY_PAGE_URL,
  );

  const segments = ['CM'];
  const publishedYears = new Set();
  const uniqueHolidays = new Map();
  segments.forEach((segment) => {
    const items = Array.isArray(feed.data?.[segment]) ? feed.data[segment] : [];
    items.forEach((item) => {
      const date = calendarIsoFromNseDate(item.tradingDate);
      if (!date) return;
      publishedYears.add(date.slice(0, 4));
      if (date < from || date > to) return;
      const name = calendarText(item.description, 'NSE trading holiday');
      const identity = `${date}:${name.toLowerCase()}`;
      if (uniqueHolidays.has(identity)) return;
      const sessionHours = nseSessionHours(item);
      const hasSessionMetadata = ['evening_session', 'morning_session'].some((key) => {
        const value = String(item[key] ?? '').trim();
        return value !== '' && !/^(?:n|no|false|0|-)$/i.test(value);
      });
      const hasSpecialSession = Boolean(
        hasSessionMetadata || sessionHours
        || /muhurat|special trading/i.test(name),
      );
      uniqueHolidays.set(identity, {
        date,
        name,
        symbol: '',
        exchange: 'NSE',
        status: hasSpecialSession ? 'special_session' : 'closed',
        holiday_status: hasSpecialSession ? 'early_close' : 'closed',
        start_time: sessionHours?.startTime || null,
        end_time: sessionHours?.endTime || null,
        close_time_local: calendarText(item.evening_session, item.morning_session),
        note: hasSpecialSession ? 'NSE special trading session' : 'NSE market closed',
        segment: 'CM',
        payload: item,
      });
    });
  });

  const requestedYears = [];
  for (let year = fromDate.getUTCFullYear(); year <= toDate.getUTCFullYear(); year += 1) requestedYears.push(String(year));
  const missingYears = requestedYears.filter((year) => !publishedYears.has(year));

  return {
    data: [...uniqueHolidays.values()],
    lastUpdated: feed.lastUpdated,
    stale: Boolean(feed.stale),
    missingYears,
  };
};

let latestNseMarketSession = null;
let persistedNseCalendarAt = null;
let lastNseCalendarPersistFailureAt = 0;

const persistNseCalendar = (feed, completeYears) => {
  if (!completeYears.length || feed.stale) return;
  const db = getDatabase();
  const fetchedAt = feed.lastUpdated || new Date().toISOString();
  const sourceUrl = 'https://www.nseindia.com/api/holiday-master?type=trading';
  const years = new Set(completeYears);
  const events = feed.data.filter((event) => years.has(event.date.slice(0, 4)));
  db.transaction((tx) => {
    for (const year of years) {
      tx.run("DELETE FROM market_calendar_events WHERE exchange = 'NSE' AND segment = 'CM' AND substr(event_date, 1, 4) = ?", year);
      tx.run(
        `INSERT INTO market_calendar_sync (exchange, segment, calendar_year, source_url, fetched_at)
         VALUES ('NSE', 'CM', ?, ?, ?)
         ON CONFLICT(exchange, segment, calendar_year) DO UPDATE SET source_url = excluded.source_url, fetched_at = excluded.fetched_at`,
        Number(year), sourceUrl, fetchedAt,
      );
    }
    for (const event of events) {
      tx.run(
        `INSERT INTO market_calendar_events
          (exchange, segment, event_date, name, event_type, start_time, end_time, source_url, payload_json, fetched_at)
         VALUES ('NSE', 'CM', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(exchange, segment, event_date, event_type, name) DO UPDATE SET
           start_time = excluded.start_time, end_time = excluded.end_time, source_url = excluded.source_url,
           payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
        event.date, event.name, event.status, event.start_time, event.end_time,
        sourceUrl, JSON.stringify(event.payload || {}), fetchedAt,
      );
    }
  });
};

const getNseMarketSession = async (instant = new Date()) => {
  const date = getMarketCalendarDateParts(instant);
  const startYear = `${date.year}-01-01`;
  const endYear = `${date.year + 1}-12-31`;
  let holidayFeed = null;
  let feedError = null;
  try {
    holidayFeed = await getFinanceNseHolidays(startYear, endYear);
  } catch (error) {
    feedError = error;
  }

  // Ensure DB is seeded with verified exchange calendar
  const db = getDatabase();
  try {
    seedOfficialMarketCalendar(db);
  } catch (err) {
    console.warn('[MarketSchedule] seedOfficialMarketCalendar error:', err.message || err);
  }

  // Query verified calendar events from database
  let dbEvents = [];
  try {
    dbEvents = db.prepare(`
      SELECT event_date AS date, name, event_type AS status, start_time AS startTime, end_time AS endTime
      FROM market_calendar_events
      WHERE event_date BETWEEN ? AND ?
      ORDER BY event_date ASC
    `).all(startYear, endYear);
  } catch (err) {
    console.warn('[MarketSchedule] Failed to query market_calendar_events:', err.message || err);
  }

  const feedYears = holidayFeed
    ? [String(date.year), String(date.year + 1)].filter((year) => !holidayFeed.missingYears.includes(year))
    : [];
  const dbYears = Array.from(new Set(dbEvents.map((e) => String(e.date).slice(0, 4))));
  const completeYears = Array.from(new Set([...feedYears, ...dbYears]));
  const currentYearPublished = completeYears.includes(String(date.year));

  if (holidayFeed && !holidayFeed.stale && feedYears.length
    && holidayFeed.lastUpdated !== persistedNseCalendarAt
    && Date.now() - lastNseCalendarPersistFailureAt >= 60_000) {
    try {
      persistNseCalendar(holidayFeed, feedYears);
      persistedNseCalendarAt = holidayFeed.lastUpdated;
      lastNseCalendarPersistFailureAt = 0;
    } catch (error) {
      lastNseCalendarPersistFailureAt = Date.now();
      console.error('[MarketSchedule] Failed to persist the official NSE calendar:', error.message || error);
    }
  }

  // Merge live feed and DB events
  const eventMap = new Map();
  for (const item of dbEvents) {
    const isSpecial = item.status === 'special_session';
    eventMap.set(`${item.date}:${item.name.toLowerCase()}`, {
      date: item.date,
      name: item.name,
      status: item.status,
      startTime: item.startTime || (isSpecial ? '18:15:00' : null),
      endTime: item.endTime || (isSpecial ? '19:15:00' : null),
    });
  }
  for (const item of (holidayFeed?.data || [])) {
    const key = `${item.date}:${item.name.toLowerCase()}`;
    const existing = eventMap.get(key);
    const isMuhurat = /muhurat|special trading/i.test(item.name);
    const hasSpecial = item.status === 'special_session' || isMuhurat || existing?.status === 'special_session';
    eventMap.set(key, {
      date: item.date,
      name: item.name,
      status: hasSpecial ? 'special_session' : item.status,
      startTime: item.start_time || existing?.startTime || (hasSpecial ? '18:15:00' : null),
      endTime: item.end_time || existing?.endTime || (hasSpecial ? '19:15:00' : null),
    });
  }

  const marketEvents = Array.from(eventMap.values());
  const isStale = Boolean(holidayFeed?.stale && !dbEvents.length);
  const result = buildMarketStatus({
    instant,
    events: marketEvents,
    completeYears,
    isVerified: currentYearPublished && !isStale,
    stale: isStale,
    source: holidayFeed && !holidayFeed.stale ? 'NSE/BSE official exchange feed' : 'NSE/BSE official exchange calendar',
    lastUpdated: holidayFeed?.lastUpdated || new Date().toISOString(),
  });

  result.squareOffWindow = result.phase === 'NORMAL' && result.minutes >= 15 * 60 + 15 && result.minutes < 15 * 60 + 30;
  result.isPreMarket = result.isPreOpen;

  const mcxStatus = getMCXScheduleStatus(instant);
  result.indexStatus = {
    nifty50: {
      exchange: 'NSE',
      index: 'NIFTY 50',
      segment: 'Equity (CM)',
      isVerified: result.isVerified,
      status: result.status,
      statusEmoji: result.statusEmoji,
      phase: result.phase,
      timings: '09:15–15:30 IST',
    },
    sensex: {
      exchange: 'BSE',
      index: 'SENSEX',
      segment: 'Equity',
      isVerified: result.isVerified,
      status: result.status,
      statusEmoji: result.statusEmoji,
      phase: result.phase,
      timings: '09:15–15:30 IST',
    },
    derivatives: {
      exchange: 'NSE',
      segment: 'Derivatives (F&O)',
      isVerified: result.isVerified,
      status: result.isOpen ? 'MARKET OPEN' : (result.isPreOpen ? 'PRE-OPEN' : result.status),
      statusEmoji: result.statusEmoji,
      phase: result.phase,
      timings: '09:15–15:30 IST',
    },
    commodity: mcxStatus,
  };

  result.upcomingHolidays = getUpcomingHolidays(5);
  result.specialSessions = getSpecialSessions(date.year);

  // Structured today's timeline
  result.todaySchedule = {
    date: result.date,
    day: date.weekday,
    isWeekend: result.isWeekend,
    isHoliday: result.isHoliday,
    holidayName: result.holidayName,
    isSpecialSession: result.isSpecialSession,
    sessions: [
      { name: 'Pre-Open (Order Entry)', start: '09:00', end: '09:08', active: result.phase === 'PRE_OPEN' && result.clock < '09:08:00' },
      { name: 'Pre-Open (Matching & Discovery)', start: '09:08', end: '09:12', active: result.phase === 'PRE_OPEN' && result.clock >= '09:08:00' && result.clock < '09:12:00' },
      { name: 'Pre-Open (Buffer)', start: '09:12', end: '09:15', active: result.phase === 'PRE_OPEN' && result.clock >= '09:12:00' },
      { name: 'Normal Trading Session', start: '09:15', end: '15:30', active: result.phase === 'NORMAL' },
      { name: 'Closing Auction', start: '15:30', end: '15:40', active: result.phase === 'CLOSING' },
      { name: 'Post-Closing Trading', start: '15:40', end: '16:00', active: result.phase === 'POST_CLOSE' },
    ],
  };

  if (result.specialSession) {
    result.todaySchedule.sessions.push({
      name: `Special Trading Session: ${result.specialSession.name}`,
      start: result.specialSession.startTime || '18:15',
      end: result.specialSession.endTime || '19:15',
      active: result.phase === 'SPECIAL_SESSION',
    });
  }

  latestNseMarketSession = result;
  return result;
};

const getNseMarketSessionSnapshot = () => latestNseMarketSession;

const getNseCorporateCalendarEvents = async (kind, from, to, forceRefresh = false) => {
  const rangeKey = `${nseDateParam(from)}:${nseDateParam(to)}`;

  if (kind === 'earnings') {
    const feed = await fetchNseCalendarJson(
      `https://www.nseindia.com/api/event-calendar?index=equities&from_date=${nseDateParam(from)}&to_date=${nseDateParam(to)}`,
      `nse:events:${rangeKey}`,
      NSE_CORPORATE_EVENT_CACHE_MS,
      forceRefresh,
      NSE_EVENTS_PAGE_URL,
    );
    const items = Array.isArray(feed.data) ? feed.data : [];
    const events = items.flatMap((item, index) => {
      const date = calendarIsoFromNseDate(item.date);
      const purpose = calendarText(item.purpose);
      if (!date || date < from || date > to || !/financial results/i.test(purpose)) return [];
      const symbol = calendarText(item.symbol);
      const details = [purpose, calendarText(item.bm_desc)].filter(Boolean).join(' · ');
      return [{
        id: `earnings-${date}-${symbol || index}`,
        date,
        title: calendarText(item.company, symbol, 'Company result date'),
        symbol,
        details: details.length > 260 ? `${details.slice(0, 257)}...` : details,
        time: '',
      }];
    });
    return { events, lastUpdated: feed.lastUpdated, stale: Boolean(feed.stale) };
  }

  if (kind === 'dividends' || kind === 'splits') {
    const feed = await fetchNseCalendarJson(
      `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${nseDateParam(from)}&to_date=${nseDateParam(to)}`,
      `nse:actions:${rangeKey}`,
      NSE_CORPORATE_EVENT_CACHE_MS,
      forceRefresh,
      NSE_CORPORATE_ACTIONS_PAGE_URL,
    );
    const items = Array.isArray(feed.data) ? feed.data : [];
    const subjectPattern = kind === 'dividends'
      ? /dividend|distribution/i
      : /split|sub-division|sub division|bonus/i;
    const seen = new Set();
    const events = items.flatMap((item, index) => {
      const subject = calendarText(item.subject);
      if (!subjectPattern.test(subject)) return [];
      const date = calendarIsoFromNseDate(item.exDate) || calendarIsoFromNseDate(item.recDate);
      if (!date || date < from || date > to) return [];
      const symbol = calendarText(item.symbol);
      const identity = `${date}:${symbol}:${subject.toLowerCase()}`;
      if (seen.has(identity)) return [];
      seen.add(identity);
      const details = [
        subject,
        calendarText(item.exDate) && calendarText(item.exDate) !== '-' && `Ex-date ${item.exDate}`,
        calendarText(item.recDate) && calendarText(item.recDate) !== '-' && `Record date ${item.recDate}`,
      ].filter(Boolean).join(' · ');
      return [{
        id: `${kind}-${date}-${symbol || index}`,
        date,
        title: calendarText(item.comp, symbol, kind === 'dividends' ? 'Dividend' : 'Stock split'),
        symbol,
        details,
        time: '',
      }];
    });
    return { events, lastUpdated: feed.lastUpdated, stale: Boolean(feed.stale) };
  }

  const feed = await getNseIpoFeed();
  const events = feed.data.flatMap((ipo) => {
    const date = ipo.applicationStartDateISO || '';
    if (!date || date < from || date > to) return [];
    const details = [
      ipo.priceBand !== 'Not announced' ? ipo.priceBand : '',
      ipo.closeDate && ipo.closeDate !== 'Not provided' ? `Closes ${ipo.closeDate}` : '',
      ipo.segment,
      ipo.status,
    ].filter(Boolean).join(' · ');
    return [{
      id: `ipos-${date}-${ipo.symbol || ipo.id}`,
      date,
      title: ipo.company,
      symbol: ipo.symbol,
      details,
      time: '',
    }];
  });
  return { events, lastUpdated: feed.lastUpdated, stale: Boolean(feed.stale) };
};

const isIndianEconomicEvent = (item) => {
  const country = calendarText(item.country, item.countryCode).toUpperCase();
  const currency = calendarText(item.currency).toUpperCase();
  return country === 'IN' || country === 'INDIA' || currency === 'INR';
};

const getEconomicCalendarFeed = async (from, to, forceRefresh = false) => {
  if (financeCalendarApiKey()) {
    const feed = await fetchFinanceCalendar(
      '/calendar',
      { from, to, country: 'IN', tz: 'Asia/Kolkata', limit: 500 },
      5 * 60 * 1000,
      `finance:economic:${from}:${to}`,
      forceRefresh,
    );
    return { ...feed, provider: 'Finance Calendar', providerUrl: FINANCE_CALENDAR_SOURCE_URL };
  }
  if (fmpApiKey()) {
    const feed = await fetchFmpCalendar(
      CALENDAR_FEEDS.economic.endpoint,
      { from, to },
      CALENDAR_FEEDS.economic.cacheMs,
      `fmp:economic:${from}:${to}`,
      forceRefresh,
    );
    return {
      ...feed,
      data: feed.data.filter(isIndianEconomicEvent),
      provider: 'Financial Modeling Prep',
      providerUrl: 'https://site.financialmodelingprep.com/developer/docs',
    };
  }
  const error = new Error('The India economic calendar needs a Finance Calendar API key.');
  error.code = 'calendar_api_key_required';
  throw error;
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
const metalSpotRetryAt = new Map();

const toProviderSymbol = (symbol) => symbol
  .replace(/^(NSE|BSE|MCX|GLOBAL):/i, '')
  .replace(/\.BSE$|\.NSE$/i, '')
  .toUpperCase();

// Identity-only fallback universe, used when no provider directory is readable.
// It carries names and sectors only: no price, change or history is ever served
// from this table, so an unquoted symbol stays blank instead of showing a made-up number.
const defaultStockUniverse = {
  RELIANCE: { name: "Reliance Industries", sector: "Energy" },
  TCS: { name: "Tata Consultancy Services", sector: "IT" },
  HDFCBANK: { name: "HDFC Bank", sector: "Banking" },
  INFY: { name: "Infosys", sector: "IT" },
  ITC: { name: "ITC Limited", sector: "FMCG" },
  SBIN: { name: "State Bank of India", sector: "Banking" },
  ICICIBANK: { name: "ICICI Bank", sector: "Banking" },
  MARUTI: { name: "Maruti Suzuki", sector: "Auto" },
  BHARTIARTL: { name: "Bharti Airtel", sector: "Telecom" },
  LT: { name: "Larsen & Toubro", sector: "Capital Goods" },
  AXISBANK: { name: "Axis Bank", sector: "Banking" },
  KOTAKBANK: { name: "Kotak Mahindra Bank", sector: "Banking" },
  ADANIENT: { name: "Adani Enterprises", sector: "Metals" },
  SUNPHARMA: { name: "Sun Pharma", sector: "Pharma" },
  TITAN: { name: "Titan Company", sector: "Consumer" },
  BAJFINANCE: { name: "Bajaj Finance", sector: "Finance" },
  WIPRO: { name: "Wipro", sector: "IT" },
  ASIANPAINT: { name: "Asian Paints", sector: "Consumer" },
  HINDALCO: { name: "Hindalco Industries", sector: "Metals" },
  ONGC: { name: "ONGC", sector: "Energy" },
  NTPC: { name: "NTPC Limited", sector: "Energy" },
  NIFTY: { name: "NIFTY 50", sector: "Index" },
  SENSEX: { name: "BSE SENSEX", sector: "Index" },
  BANKNIFTY: { name: "BANK NIFTY", sector: "Index" },
};

// Zerodha (Kite Connect) batch quote proxy. Real Kite data only — when the
// access token is missing or the call fails there is no fallback price.
app.get('/api/zerodha/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'No symbols supplied' });

  const token = process.env.ZERODHA_TOKEN;
  const base = process.env.ZERODHA_BASE_URL || 'https://api.kite.trade';

  if (!token) {
    return res.status(503).json({
      error: 'Zerodha Kite Connect is not connected. Set ZERODHA_TOKEN to receive live quotes; no simulated prices are served.',
      code: 'broker_not_connected',
      quotes: {},
    });
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
  } catch (error) {
    console.error('Zerodha proxy error:', error.message);
    res.status(502).json({
      error: 'Zerodha could not return current quotes. No simulated prices are served.',
      code: 'provider_unavailable',
      quotes: {},
    });
  }
});
// RapidAPI (e.g., Yahoo Finance) batch quote proxy. Credentials are required;
// an unconfigured or failing key returns an unavailable response, never a price.
app.get('/api/rapid/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'No symbols supplied' });

  const rapidKey = process.env.RAPIDAPI_KEY;
  const rapidHost = process.env.RAPIDAPI_HOST; // e.g., 'yfapi.net'
  if (!rapidKey || !rapidHost) {
    return res.status(503).json({
      error: 'RapidAPI is not configured. Set RAPIDAPI_KEY and RAPIDAPI_HOST to receive quotes; no simulated prices are served.',
      code: 'provider_not_configured',
      quotes: {},
    });
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
  } catch (error) {
    console.error('RapidAPI proxy error:', error.message);
    res.status(502).json({
      error: 'RapidAPI could not return current quotes. No simulated prices are served.',
      code: 'provider_unavailable',
      quotes: {},
    });
  }
});
const NEWS_FEED_CACHE_MS = 2 * 60 * 1000;
const NEWS_FEED_STALE_MS = 30 * 60 * 1000;
const NEWS_ARTICLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let marketNewsCache = null;
let marketNewsRequest = null;
let mutualFundNewsCache = null;
let mutualFundNewsRequest = null;

const decodeXmlEntities = (value) => String(value || '')
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;|&#39;/g, "'");

const readXmlTag = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  return decodeXmlEntities(match[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, '$1').replace(/<[^>]*>/g, ' ').trim());
};

const classifyNewsHeadline = (headline) => {
  const text = headline.toLowerCase();
  if (/\bipo\b|initial public offering|allotment|listing debut/.test(text)) return 'IPO';
  if (/\bgold\b|bullion/.test(text)) return 'Gold';
  if (/\bsilver\b/.test(text)) return 'Silver';
  if (/mutual fund|\bsip\b/.test(text)) return 'Mutual Funds';
  if (/\bstocks?\b|\bshares?\b|\bnifty\b|\bsensex\b|\bbse\b|\bnse\b/.test(text)) return 'Stocks';
  return 'general';
};

const normalizeFinnhubNews = (items) => (Array.isArray(items) ? items : [])
  .filter((item) => item.headline && item.url && Number.isFinite(Number(item.datetime)))
  .map((item) => ({
    id: String(item.id || item.url),
    headline: item.headline,
    summary: '',
    source: item.source || 'Finnhub',
    datetime: Number(item.datetime),
    category: classifyNewsHeadline(item.headline),
    url: item.url,
  }));

const fetchGoogleNewsRss = async (queries) => {
  const feeds = await Promise.all(queries.map((q) => axios.get('https://news.google.com/rss/search', {
    params: { q, hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
    headers: { 'User-Agent': 'ShareMarket/1.0 market-news-reader' },
    timeout: 12000,
    responseType: 'text',
  }).then((response) => String(response.data || ''))));
  const now = Date.now();
  const items = feeds.flatMap((xml) => [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, itemXml]) => {
      const headline = readXmlTag(itemXml, 'title');
      const sourceMatch = itemXml.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
      const source = sourceMatch ? decodeXmlEntities(sourceMatch[1].trim()) : 'Google News';
      const publishedAt = Date.parse(readXmlTag(itemXml, 'pubDate'));
      const url = readXmlTag(itemXml, 'link');
      if (!headline || !url || !Number.isFinite(publishedAt)
        || publishedAt > now + 6 * 60 * 60 * 1000 || now - publishedAt > NEWS_ARTICLE_MAX_AGE_MS) return null;
      const sourceSuffix = ` - ${source}`;
      const displayHeadline = headline.toLowerCase().endsWith(sourceSuffix.toLowerCase())
        ? headline.slice(0, -sourceSuffix.length).trim()
        : headline;
      return {
        id: url,
        headline: displayHeadline,
        summary: '',
        source,
        datetime: Math.floor(publishedAt / 1000),
        category: classifyNewsHeadline(displayHeadline),
        url,
      };
    }));
  return [...new Map(items.filter(Boolean).map((item) => [item.url, item])).values()]
    .filter(Boolean)
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 40);
};

const fetchGoogleMarketNews = () => fetchGoogleNewsRss(['Indian stock market', 'India IPO']);
const fetchGoogleMutualFundNews = async () => {
  const headlines = await fetchGoogleNewsRss([
    'mutual funds India',
    'mutual fund NFO India',
    'SEBI mutual fund India',
  ]);
  return headlines
    .filter((article) => /\bmutual funds?\b|\bSIP\b|\bNFOs?\b|new fund offer|\bschemes?\b|asset management|fund house|fund manager|direct plans?\b|expense ratio/i.test(article.headline))
    .map((article) => ({ ...article, category: 'Mutual Funds' }));
};

const makeNewsFeedResponse = (data, options = {}) => ({
  data,
  live: Boolean(options.live),
  stale: Boolean(options.stale),
  configured: Boolean(options.configured),
  provider: options.provider || null,
  lastUpdated: options.lastUpdated || null,
  note: options.note || '',
  sentimentMethod: SENTIMENT_METHOD,
});

const getMarketNewsFeed = async () => {
  const now = Date.now();
  if (marketNewsCache && now - marketNewsCache.cachedAt < NEWS_FEED_CACHE_MS) {
    return makeNewsFeedResponse(marketNewsCache.data, {
      live: true,
      configured: marketNewsCache.configured,
      provider: marketNewsCache.provider,
      lastUpdated: new Date(marketNewsCache.cachedAt).toISOString(),
      note: `Updated from ${marketNewsCache.provider}.`,
    });
  }
  if (marketNewsRequest) return marketNewsRequest;

  marketNewsRequest = (async () => {
    const providerErrors = [];
    const providers = [];
    if (process.env.FINNHUB_API_KEY) providers.push({
      name: 'Finnhub',
      fetch: async () => {
        const response = await axios.get('https://finnhub.io/api/v1/news', {
          params: { category: 'general', token: process.env.FINNHUB_API_KEY },
          timeout: 10000,
        });
        return normalizeFinnhubNews(response.data);
      },
    });
    providers.push({ name: 'Google News RSS', fetch: fetchGoogleMarketNews });

    for (const provider of providers) {
      try {
        const data = applySentiment(await provider.fetch());
        if (!data.length) throw new Error('The provider returned no recent market headlines.');
        const configured = provider.name === 'Google News RSS' || Boolean(process.env.FINNHUB_API_KEY);
        marketNewsCache = { data, provider: provider.name, configured, cachedAt: Date.now() };
        return makeNewsFeedResponse(data, {
          live: true,
          configured,
          provider: provider.name,
          lastUpdated: new Date(marketNewsCache.cachedAt).toISOString(),
          note: provider.name === 'Google News RSS'
            ? 'Live headlines from Google News RSS with links to the listed publishers.'
            : 'Live headlines from Finnhub.',
        });
      } catch (error) {
        providerErrors.push(`${provider.name}: ${error.message}`);
      }
    }

    const cachedAge = marketNewsCache ? Date.now() - marketNewsCache.cachedAt : Infinity;
    if (marketNewsCache && cachedAge < NEWS_FEED_STALE_MS) {
      return makeNewsFeedResponse(marketNewsCache.data, {
        live: false,
        stale: true,
        configured: marketNewsCache.configured,
        provider: marketNewsCache.provider,
        lastUpdated: new Date(marketNewsCache.cachedAt).toISOString(),
        note: 'Showing recently cached headlines because the latest provider refresh failed.',
      });
    }

    console.warn('Market news providers unavailable:', providerErrors.join(' | '));
    return makeNewsFeedResponse([], {
      live: false,
      configured: Boolean(process.env.FINNHUB_API_KEY),
      note: 'Live market headlines are temporarily unavailable. Please refresh shortly.',
    });
  })().finally(() => {
    marketNewsRequest = null;
  });

  return marketNewsRequest;
};

const getMutualFundNewsFeed = async () => {
  const now = Date.now();
  if (mutualFundNewsCache && now - mutualFundNewsCache.cachedAt < NEWS_FEED_CACHE_MS) {
    return makeNewsFeedResponse(mutualFundNewsCache.data, {
      live: true,
      configured: true,
      provider: 'Google News RSS',
      lastUpdated: new Date(mutualFundNewsCache.cachedAt).toISOString(),
      note: 'Recent mutual fund and NFO headlines with links to their publishers.',
    });
  }
  if (mutualFundNewsRequest) return mutualFundNewsRequest;

  mutualFundNewsRequest = (async () => {
    try {
      const data = applySentiment(await fetchGoogleMutualFundNews());
      if (!data.length) throw new Error('The news provider returned no recent mutual fund headlines.');
      mutualFundNewsCache = { data, cachedAt: Date.now() };
      return makeNewsFeedResponse(data, {
        live: true,
        configured: true,
        provider: 'Google News RSS',
        lastUpdated: new Date(mutualFundNewsCache.cachedAt).toISOString(),
        note: 'Recent mutual fund and NFO headlines with links to their publishers.',
      });
    } catch (error) {
      const cachedAge = mutualFundNewsCache ? Date.now() - mutualFundNewsCache.cachedAt : Infinity;
      if (mutualFundNewsCache && cachedAge < NEWS_FEED_STALE_MS) {
        return makeNewsFeedResponse(mutualFundNewsCache.data, {
          live: false,
          stale: true,
          configured: true,
          provider: 'Google News RSS',
          lastUpdated: new Date(mutualFundNewsCache.cachedAt).toISOString(),
          note: 'Showing recently cached headlines because the latest refresh failed.',
        });
      }
      console.warn('Mutual fund news provider unavailable:', error.message);
      return makeNewsFeedResponse([], {
        live: false,
        configured: true,
        provider: 'Google News RSS',
        note: 'Mutual fund headlines are temporarily unavailable. Please refresh shortly.',
      });
    } finally {
      mutualFundNewsRequest = null;
    }
  })();
  return mutualFundNewsRequest;
};

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
    timestamp: quote.timestamp || quote.last_trade_time || null,
    lastTradeTime: quote.last_trade_time || quote.timestamp || null,
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

const METAL_UPSTOX_CACHE_MS = 1_000;
const METAL_UPSTOX_RETRY_MS = 5 * 60_000;
const METAL_UPSTOX_STALE_AFTER_MS = 2 * 60_000;
const METAL_UPSTOX_UNITS = {
  GOLD: { unit: 'INR/10g', label: 'Gold front month' },
  SILVER: { unit: 'INR/kg', label: 'Silver front month' },
};
const metalUpstoxStatus = {
  configured: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
  available: false,
  tokenValid: null,
  reason: process.env.UPSTOX_ACCESS_TOKEN
    ? 'Live Upstox MCX quotes have not been requested yet.'
    : 'UPSTOX_ACCESS_TOKEN is not configured.',
  checkedAt: 0,
};
let metalUpstoxQuotes = new Map();
let metalUpstoxFetchedAt = 0;
let metalUpstoxRetryAt = 0;
let metalUpstoxRequest = null;

const refreshUpstoxMetalFreshness = (quotes, now = Date.now()) => {
  const market = getMCXScheduleStatus(new Date(now));
  return new Map([...quotes].map(([symbol, quote]) => {
    const freshness = classifyExchangeQuote({
      timestamp: quote.lastTradeTime || quote.priceTimestamp || quote.timestamp,
      now,
      marketOpen: market.isOpen,
      staleAfterMs: METAL_UPSTOX_STALE_AFTER_MS,
    });
    return [symbol, {
      ...quote,
      ...freshness,
      marketOpen: market.isOpen,
      marketPhase: market.phase,
      isClose: !market.isOpen,
    }];
  }));
};

const getUpstoxMetalQuotes = async () => {
  const now = Date.now();
  if (!process.env.UPSTOX_ACCESS_TOKEN) {
    metalUpstoxStatus.configured = false;
    metalUpstoxStatus.available = false;
    metalUpstoxStatus.tokenValid = false;
    metalUpstoxStatus.reason = 'UPSTOX_ACCESS_TOKEN is not configured.';
    metalUpstoxQuotes = new Map();
    return metalUpstoxQuotes;
  }
  metalUpstoxStatus.configured = true;
  if (metalUpstoxQuotes.size && now - metalUpstoxFetchedAt < METAL_UPSTOX_CACHE_MS) {
    metalUpstoxQuotes = refreshUpstoxMetalFreshness(metalUpstoxQuotes, now);
    return metalUpstoxQuotes;
  }
  if (now < metalUpstoxRetryAt) {
    metalUpstoxQuotes = refreshUpstoxMetalFreshness(metalUpstoxQuotes, now);
    return metalUpstoxQuotes;
  }
  if (metalUpstoxRequest) return metalUpstoxRequest;

  metalUpstoxRequest = (async () => {
    try {
      const quotes = await getUpstoxBatchQuotes(Object.keys(METAL_UPSTOX_UNITS).map((symbol) => `MCX:${symbol}`));
      const entries = Object.entries(quotes).filter(([symbol]) => METAL_UPSTOX_UNITS[symbol]);
      if (!entries.length) {
        metalUpstoxStatus.available = false;
        metalUpstoxStatus.tokenValid = null;
        metalUpstoxStatus.reason = 'Upstox returned no MCX gold or silver quotes. Showing delayed spot references.';
        metalUpstoxStatus.checkedAt = now;
        metalUpstoxFetchedAt = now;
        metalUpstoxRetryAt = now + 60_000;
        metalUpstoxQuotes = new Map();
        return metalUpstoxQuotes;
      }
      const next = new Map();
      for (const [symbol, quote] of entries) {
        const config = METAL_UPSTOX_UNITS[symbol];
        const market = getMCXScheduleStatus(new Date(now));
        const freshness = classifyExchangeQuote({
          timestamp: quote.lastTradeTime || quote.timestamp,
          now,
          marketOpen: market.isOpen,
          staleAfterMs: METAL_UPSTOX_STALE_AFTER_MS,
        });
        const yearRange = Number(quote.week52High) > 0 && Number(quote.week52Low) > 0
          ? null
          : await getMetalYearRange(symbol).catch(() => null);
        next.set(symbol, {
          ...quote,
          symbol,
          unit: config.unit,
          exchange: 'MCX',
          marketType: 'futures',
          provider: `Upstox MCX · ${config.label}`,
          providerUrl: 'https://upstox.com',
          ...freshness,
          marketOpen: market.isOpen,
          marketPhase: market.phase,
          isClose: !market.isOpen,
          isDelayed: false,
          isReal: true,
          isDemo: false,
          week52High: Number(quote.week52High) > 0 ? Number(quote.week52High) : yearRange?.high ?? null,
          week52Low: Number(quote.week52Low) > 0 ? Number(quote.week52Low) : yearRange?.low ?? null,
          ...metalUnitPrices(symbol, quote.c),
          priceTimestamp: quote.lastTradeTime || quote.timestamp || null,
        });
      }
      metalUpstoxQuotes = next;
      metalUpstoxFetchedAt = now;
      metalUpstoxRetryAt = 0;
      metalUpstoxStatus.available = [...next.values()].some((quote) => quote.isLive);
      metalUpstoxStatus.tokenValid = true;
      metalUpstoxStatus.reason = metalUpstoxStatus.available
        ? ''
        : getMCXScheduleStatus(new Date(now)).isOpen
          ? 'Upstox returned no fresh timestamped MCX quote. Showing a verified delayed reference.'
          : 'MCX is closed. Showing a verified delayed reference instead of labelling the last traded price as live.';
      metalUpstoxStatus.checkedAt = now;
      return next;
    } catch (error) {
      const statusCode = error.response?.status;
      metalUpstoxQuotes = new Map();
      metalUpstoxFetchedAt = now;
      metalUpstoxStatus.available = false;
      metalUpstoxStatus.tokenValid = statusCode === 401 ? false : null;
      metalUpstoxStatus.checkedAt = now;
      metalUpstoxStatus.reason = statusCode === 401
        ? 'Upstox access token is expired or invalid. Add a fresh token to enable live MCX quotes.'
        : 'Upstox live MCX quotes are unavailable right now. Showing delayed spot references.';
      metalUpstoxRetryAt = now + (statusCode === 401 ? METAL_UPSTOX_RETRY_MS : 60_000);
      console.warn(`Upstox metal quote error: ${statusCode || error.message}`);
      return metalUpstoxQuotes;
    } finally {
      metalUpstoxRequest = null;
    }
  })();
  return metalUpstoxRequest;
};

const UPSTOX_TOKEN_CHECK_MS = 5 * 60_000;
const upstoxTokenCheck = { cached: null, inFlight: null };

const checkUpstoxToken = async () => {
  if (!process.env.UPSTOX_ACCESS_TOKEN) {
    return { configured: false, tokenValid: false, reason: 'UPSTOX_ACCESS_TOKEN is not configured.', checkedAt: Date.now() };
  }
  const now = Date.now();
  if (upstoxTokenCheck.cached && now - upstoxTokenCheck.cached.checkedAt < UPSTOX_TOKEN_CHECK_MS) {
    return upstoxTokenCheck.cached;
  }
  if (upstoxTokenCheck.inFlight) return upstoxTokenCheck.inFlight;

  const request = (async () => {
    try {
      await axios.get('https://api.upstox.com/v2/user/profile', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}`,
        },
        timeout: 5000,
      });
      return { configured: true, tokenValid: true, reason: '', checkedAt: Date.now() };
    } catch (error) {
      const statusCode = error.response?.status;
      return {
        configured: true,
        tokenValid: statusCode === 401 ? false : null,
        reason: statusCode === 401
          ? 'the access token is expired or invalid. Generate a fresh UPSTOX_ACCESS_TOKEN.'
          : `the token could not be verified (${statusCode || error.code || 'network error'}).`,
        checkedAt: Date.now(),
      };
    }
  })();

  upstoxTokenCheck.inFlight = request;
  try {
    upstoxTokenCheck.cached = await request;
  } finally {
    if (upstoxTokenCheck.inFlight === request) upstoxTokenCheck.inFlight = null;
  }
  return upstoxTokenCheck.cached;
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
  const spotCurrency = 'USD';
  const spotSymbol = `${metal}-USD-SPOT`;
  const gramsPerUnit = isSilver ? 1000 : 10;
  const quoteUnit = isSilver || isCopper ? 'INR/kg' : 'INR/10g';
  const unitsPerKilogram = isCopper ? (1 / 0.45359237) : null;
  const now = Date.now();
  const cached = metalSpotCache.get(metal);
  const yearMetalForCache = isSilver ? 'SILVER' : isCopper ? null : 'GOLD';
  if (cached && now - cached.fetchedAt < METAL_SPOT_CACHE_MS) {
    const yearRange = yearMetalForCache ? metalYearRangeCache.get(yearMetalForCache)?.value : null;
    if (yearMetalForCache && !metalYearRangeCache.has(yearMetalForCache)) {
      getMetalYearRange(yearMetalForCache).catch(() => null);
    }
    return yearRange
      ? { ...cached.quote, week52High: yearRange.high, week52Low: yearRange.low }
      : cached.quote;
  }
  if (metalSpotRequests.has(metal)) return metalSpotRequests.get(metal);
  if ((metalSpotRetryAt.get(metal) || 0) > now) {
    if (cached?.quote) return { ...cached.quote, isLive: false, isDelayed: true, isStale: true };
    throw new Error(`The ${metalName.toLowerCase()} spot feed did not respond; retrying shortly.`);
  }

  const request = (async () => {
    try {
      const headers = process.env.GOLDPRICE_API_KEY
        ? { Authorization: `Bearer ${process.env.GOLDPRICE_API_KEY}` }
        : {};
      const spotRequest = axios.get(METAL_SPOT_API_URL, {
        params: { symbol: spotSymbol, include: 'stats' },
        headers,
        timeout: 4_500,
      });
      const fxRequest = axios.get('https://api.goldprice.dev/v1/convert', {
        params: { from: 'USD', to: 'INR', amount: 1 },
        headers,
        timeout: 4_500,
      });
      const [response, fxResponse] = await Promise.all([spotRequest, fxRequest]);
      const spot = response.data?.symbols?.find((item) => (
        item?.symbol === metal && item?.quote_currency === spotCurrency && item?.contract_type === 'spot'
      ));
      const pricePerTroyOunce = Number(spot?.price);
      const expectedSpotUnit = isCopper ? 'pound' : 'troy_ounce';
      if (!Number.isFinite(pricePerTroyOunce) || pricePerTroyOunce <= 0 || spot?.unit !== expectedSpotUnit) {
        throw new Error(`${metalName} spot API returned an invalid ${metal}/${spotCurrency} quote.`);
      }
      const usdToInr = Number(fxResponse?.data?.rate ?? fxResponse?.data?.result);
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
        : null;
      const quoteIsStale = spot.is_stale === true
        || fxResponse?.data?.is_stale === true
        || quoteTimestamp === null
        || now - quoteTimestamp > METAL_SPOT_STALE_AFTER_MS;
      const timestamp = quoteTimestamp === null ? null : new Date(quoteTimestamp).toISOString();
      const yearMetal = isSilver ? 'SILVER' : 'GOLD';
      const yearRange = isCopper ? null : metalYearRangeCache.get(yearMetal)?.value ?? null;
      if (!isCopper && !metalYearRangeCache.has(yearMetal)) {
        // The 52-week range is optional context; never delay the live quote for it.
        getMetalYearRange(yearMetal).catch(() => null);
      }
      const quote = {
        c: currentPrice,
        d: change,
        dp: changePercent,
        pc: previousClose,
        h: toInrInUnit(spot.high_price),
        l: toInrInUnit(spot.low_price),
        week52High: yearRange?.high ?? null,
        week52Low: yearRange?.low ?? null,
        v: null,
        timestamp,
        provider: isSilver
          ? 'goldprice.dev XAG/USD spot × USD/INR conversion'
          : isCopper
            ? 'goldprice.dev HG/USD copper spot × USD/INR conversion'
            : 'goldprice.dev XAU/USD spot × USD/INR conversion',
        providerUrl: 'https://goldprice.dev',
        unit: quoteUnit,
        metal,
        sourceSymbol: `${metal}/USD`,
        sourcePriceUsd: pricePerTroyOunce,
        sourcePriceUnit: isCopper ? 'USD/lb' : 'USD/troy oz',
        usdInr: usdToInr,
        priceTimestamp: Number.isFinite(spotTimestamp) ? new Date(spotTimestamp).toISOString() : null,
        fxTimestamp: Number.isFinite(fxTimestamp) ? new Date(fxTimestamp).toISOString() : null,
        ...metalUnitPrices(normalizedSymbol, currentPrice),
        marketType: 'spot',
        isLive: false,
        isDelayed: true,
        isReal: true,
        isDemo: false,
        isStale: quoteIsStale,
      };
      metalSpotCache.set(metal, { quote, fetchedAt: Date.now() });
      metalSpotRetryAt.delete(metal);
      return quote;
    } catch (error) {
      // Back off briefly so a slow upstream never stalls repeated batch requests.
      metalSpotRetryAt.set(metal, Date.now() + 60_000);
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

const METAL_QUOTE_UNITS = { GOLD: 'INR/10g', SILVER: 'INR/kg', COPPER: 'INR/kg' };

const decorateMetalQuote = (symbol, quote) => ({
  ...quote,
  unit: quote.unit || METAL_QUOTE_UNITS[symbol] || null,
  exchange: quote.exchange || 'MCX',
  marketType: quote.marketType || 'futures',
});

const getMetalQuote = async (requestedSymbol) => {
  const normalizedSymbol = String(requestedSymbol || '').trim().toUpperCase().replace(/^MCX:/, '');
  const hasLiveFeed = normalizedSymbol === 'GOLD' || normalizedSymbol === 'SILVER';
  if (hasLiveFeed) {
    const upstoxQuotes = await getUpstoxMetalQuotes().catch(() => null);
    const liveQuote = upstoxQuotes instanceof Map ? upstoxQuotes.get(normalizedSymbol) : null;
    if (liveQuote?.isLive === true && liveQuote.isStale !== true) {
      return { ...liveQuote, liveFeed: 'upstox', liveFallbackReason: null };
    }
  }
  // Primary: Use Yahoo Finance COMEX futures benchmark for Gold & Silver
  try {
    const benchmarkQuote = await getCommodityBenchmarkQuote(normalizedSymbol);
    if (benchmarkQuote) {
      return {
        ...benchmarkQuote,
        liveFeed: null,
        liveFallbackReason: hasLiveFeed && metalUpstoxStatus.configured ? metalUpstoxStatus.reason : null,
      };
    }
  } catch (benchmarkError) {
    console.warn(`Yahoo Finance quote lookup failed for ${normalizedSymbol}:`, benchmarkError.message);
  }
  try {
    const spotQuote = await getMetalSpotQuote(normalizedSymbol);
    return {
      ...spotQuote,
      liveFeed: null,
      liveFallbackReason: hasLiveFeed && metalUpstoxStatus.configured ? metalUpstoxStatus.reason : null,
    };
  } catch (spotError) {
    throw spotError;
  }
};

const getUsdToInrRate = async () => {
  const now = Date.now();
  if (usdInrRateCache && now - usdInrRateCache.fetchedAt < COMMODITY_BENCHMARK_CACHE_MS) return usdInrRateCache;
  if (usdInrRateRequest) return usdInrRateRequest;

  usdInrRateRequest = (async () => {
    try {
      const response = await axios.get(`${YAHOO_CHART_URL}/INR=X`, {
        params: { range: '1d', interval: '1m' },
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ShareMarket/1.0)',
        },
        timeout: 8_000,
      });
      const meta = response.data?.chart?.result?.[0]?.meta;
      const rate = Number(meta?.regularMarketPrice);
      if (Number.isFinite(rate) && rate > 0) {
        const timestamp = Number(meta?.regularMarketTime) > 0 ? Number(meta.regularMarketTime) * 1000 : Date.now();
        const result = {
          rate,
          timestamp,
          isStale: now - timestamp > COMMODITY_BENCHMARK_STALE_AFTER_MS,
          fetchedAt: Date.now(),
        };
        usdInrRateCache = result;
        return result;
      }
    } catch (yahooFxError) {
      console.warn('Yahoo Finance USD/INR lookup failed, trying backup:', yahooFxError.message);
    }

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
    const timestamp = Number.isFinite(timestampValue) ? timestampValue : Date.now();
    const result = {
      rate,
      timestamp,
      isStale: response.data?.is_stale === true || now - timestamp > COMMODITY_BENCHMARK_STALE_AFTER_MS,
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

const fetchYahooSeries = async (yahooSymbol, params, attempt = 0) => {
  try {
    const response = await axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(yahooSymbol)}`, {
      params,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; ShareMarket/1.0)',
      },
      timeout: 12_000,
    });
    const chart = response.data?.chart;
    const result = chart?.result?.[0];
    if (chart?.error || !result) throw new Error(`Yahoo Finance returned no ${yahooSymbol} series.`);
    return result;
  } catch (error) {
    // Yahoo intermittently times out or rate-limits under rapid range
    // switching; one retry keeps chart tabs from failing on a single blip.
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return fetchYahooSeries(yahooSymbol, params, attempt + 1);
    }
    throw error;
  }
};

const buildFxRateLookup = (timestamps = [], closes = []) => {
  const points = timestamps
    .map((time, index) => ({ time: Number(time), rate: Number(closes?.[index]) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.rate) && point.rate > 0)
    .sort((first, second) => first.time - second.time);
  if (!points.length) return () => null;
  return (timestamp) => {
    const target = Number(timestamp);
    if (!Number.isFinite(target)) return null;
    let low = 0;
    let high = points.length - 1;
    let closest = points[0];
    while (low <= high) {
      const middle = (low + high) >> 1;
      const point = points[middle];
      if (Math.abs(point.time - target) < Math.abs(closest.time - target)) closest = point;
      if (point.time === target) break;
      if (point.time < target) low = middle + 1;
      else high = middle - 1;
    }
    return closest.rate;
  };
};

const getMetalYearRange = async (metal) => {
  const config = METAL_HISTORY_SYMBOLS[metal];
  if (!config) return null;
  const now = Date.now();
  const cached = metalYearRangeCache.get(metal);
  const cacheTtl = cached?.value ? METAL_YEAR_RANGE_CACHE_MS : 10 * 60 * 1000;
  if (cached && now - cached.fetchedAt < cacheTtl) return cached.value;
  if (metalYearRangeRequests.has(metal)) return metalYearRangeRequests.get(metal);

  const request = (async () => {
    try {
      const [metalSeries, fxSeries] = await Promise.all([
        fetchYahooSeries(config.yahooSymbol, { range: '1y', interval: '1d' }),
        fetchYahooSeries('INR=X', { range: '1y', interval: '1d' }),
      ]);
      const quote = metalSeries.indicators?.quote?.[0] || {};
      const fxAt = buildFxRateLookup(fxSeries.timestamp, fxSeries.indicators?.quote?.[0]?.close);
      const multiplier = config.gramsPerUnit / TROY_OUNCE_IN_GRAMS;
      let high = null;
      let low = null;
      (metalSeries.timestamp || []).forEach((time, index) => {
        const fx = fxAt(time);
        const dayHigh = Number(quote.high?.[index]);
        const dayLow = Number(quote.low?.[index]);
        if (!Number.isFinite(fx) || !(dayHigh > 0) || !(dayLow > 0)) return;
        const scaledHigh = dayHigh * fx * multiplier;
        const scaledLow = dayLow * fx * multiplier;
        high = high === null ? scaledHigh : Math.max(high, scaledHigh);
        low = low === null ? scaledLow : Math.min(low, scaledLow);
      });
      const value = high !== null && low !== null
        ? { high: Number(high.toFixed(2)), low: Number(low.toFixed(2)) }
        : null;
      metalYearRangeCache.set(metal, { value, fetchedAt: Date.now() });
      return value;
    } catch (error) {
      console.warn(`Metal 52-week range error for ${metal}:`, error.message);
      metalYearRangeCache.set(metal, { value: cached?.value || null, fetchedAt: Date.now() });
      return cached?.value || null;
    }
  })();

  metalYearRangeRequests.set(metal, request);
  try {
    return await request;
  } finally {
    if (metalYearRangeRequests.get(metal) === request) metalYearRangeRequests.delete(metal);
  }
};

const getMetalHistoryCandles = async ({ metal, resolution, from, to }) => {
  const config = METAL_HISTORY_SYMBOLS[metal];
  const settings = METAL_HISTORY_INTERVALS[resolution];
  if (!config || !settings) return { candles: [], provider: '' };

  const toTime = Number(to) || Math.floor(Date.now() / 1000);
  const requestedFrom = Number(from) > 0 ? Number(from) : 0;
  const metalParams = { interval: settings.interval, events: 'div,splits' };
  if (requestedFrom > 0) {
    metalParams.period1 = Math.max(0, requestedFrom - settings.baseSeconds * 3);
    metalParams.period2 = toTime;
  } else {
    metalParams.range = 'max';
  }
  const fxParams = requestedFrom > 0
    ? { interval: '1d', period1: requestedFrom - 40 * 24 * 60 * 60, period2: toTime }
    : { interval: '1d', range: 'max' };

  const [metalSeries, fxSeries] = await Promise.all([
    fetchYahooSeries(config.yahooSymbol, metalParams),
    fetchYahooSeries('INR=X', fxParams),
  ]);
  const quote = metalSeries.indicators?.quote?.[0] || {};
  const fxAt = buildFxRateLookup(fxSeries.timestamp, fxSeries.indicators?.quote?.[0]?.close);
  const multiplier = config.gramsPerUnit / TROY_OUNCE_IN_GRAMS;
  const scaleValue = (value) => Number(value.toFixed(2));

  let candles = (metalSeries.timestamp || []).map((time, index) => {
    const open = Number(quote.open?.[index]);
    const high = Number(quote.high?.[index]);
    const low = Number(quote.low?.[index]);
    const close = Number(quote.close?.[index]);
    const fx = fxAt(time);
    if (![open, high, low, close].every((price) => Number.isFinite(price) && price > 0)) return null;
    if (!Number.isFinite(fx) || fx <= 0) return null;
    const scale = fx * multiplier;
    return {
      time: Number(time),
      open: scaleValue(open * scale),
      high: scaleValue(high * scale),
      low: scaleValue(low * scale),
      close: scaleValue(close * scale),
      value: Number(quote.volume?.[index]) || 0,
    };
  }).filter(Boolean);

  if (settings.bucketSeconds > settings.baseSeconds) {
    candles = aggregateCandles(candles, settings.bucketSeconds);
  }

  candles = candles
    .filter((candle) => Number.isFinite(candle.time)
      && (requestedFrom <= 0 || candle.time + settings.bucketSeconds > requestedFrom)
      && candle.time <= toTime)
    .sort((first, second) => first.time - second.time);

  return {
    candles,
    provider: `Yahoo Finance delayed ${config.yahooSymbol} · USD/INR conversion`,
    effectiveResolution: settings.effectiveResolution,
    fallbackNote: settings.fallbackNote,
  };
};

const benchmarkHistoryCache = new Map();
const getCommodityBenchmarkHistory = async ({ symbol, resolution, from, to }) => {
  const benchmark = COMMODITY_BENCHMARKS[symbol];
  const settings = METAL_HISTORY_INTERVALS[resolution];
  if (!benchmark || !settings) return { candles: [], provider: '' };

  const toTime = Number(to) || Math.floor(Date.now() / 1000);
  const requestedFrom = Number(from) > 0 ? Number(from) : 0;
  const cacheKey = `${symbol}|${resolution}|${requestedFrom > 0 ? Math.floor(requestedFrom / 300) : 0}|${Math.floor(toTime / 60)}`;
  const cached = benchmarkHistoryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 60_000) return cached.value;

  const fxParams = requestedFrom > 0
    ? { interval: '1d', period1: requestedFrom - 120 * 24 * 60 * 60, period2: toTime }
    : { interval: '1d', range: 'max' };

  const fetchCandles = async (activeSettings, fromLimit = requestedFrom) => {
    const seriesParams = { interval: activeSettings.interval, events: 'div,splits' };
    if (fromLimit > 0) {
      seriesParams.period1 = Math.max(0, fromLimit - activeSettings.baseSeconds * 3);
      seriesParams.period2 = toTime;
    } else {
      seriesParams.range = 'max';
    }
    const [series, fxSeries] = await Promise.all([
      fetchYahooSeries(benchmark.yahooSymbol, seriesParams),
      fetchYahooSeries('INR=X', fxParams),
    ]);
    const quote = series.indicators?.quote?.[0] || {};
    const fxAt = buildFxRateLookup(fxSeries.timestamp, fxSeries.indicators?.quote?.[0]?.close);
    const multiplier = benchmark.unitMultiplier;
    const scaleValue = (value) => Number(value.toFixed(2));

    let candles = (series.timestamp || []).map((time, index) => {
      const open = Number(quote.open?.[index]);
      const high = Number(quote.high?.[index]);
      const low = Number(quote.low?.[index]);
      const close = Number(quote.close?.[index]);
      const fx = fxAt(time);
      if (![open, high, low, close].every((price) => Number.isFinite(price) && price > 0)) return null;
      if (!Number.isFinite(fx) || fx <= 0) return null;
      const scale = fx * multiplier;
      return {
        time: Number(time),
        open: scaleValue(open * scale),
        high: scaleValue(high * scale),
        low: scaleValue(low * scale),
        close: scaleValue(close * scale),
        value: Number(quote.volume?.[index]) || 0,
      };
    }).filter(Boolean);

    if (activeSettings.bucketSeconds > activeSettings.baseSeconds) {
      candles = aggregateCandles(candles, activeSettings.bucketSeconds);
    }

    return candles
      .filter((candle) => Number.isFinite(candle.time)
        && (fromLimit <= 0 || candle.time + activeSettings.bucketSeconds > fromLimit)
        && candle.time <= toTime)
      .sort((first, second) => first.time - second.time);
  };

  let candles = await fetchCandles(settings);
  let effectiveResolution = settings.effectiveResolution || resolution;
  let fallbackNote = settings.fallbackNote || '';
  if (!candles.length && settings.interval !== '1d') {
    // Thinly traded contracts publish no intraday bars; show a readable daily window instead.
    const fallbackDays = 60;
    const fallbackFrom = Math.max(0, toTime - fallbackDays * 24 * 60 * 60);
    const dailyFrom = requestedFrom > 0 ? Math.min(requestedFrom, fallbackFrom) : fallbackFrom;
    candles = await fetchCandles(METAL_HISTORY_INTERVALS['1d'], dailyFrom);
    if (candles.length) {
      effectiveResolution = '1d';
      fallbackNote = `daily bars over the last ${fallbackDays} days`;
    }
  }

  const value = {
    candles,
    effectiveResolution,
    fallbackNote,
    provider: `Yahoo Finance delayed ${benchmark.yahooSymbol} · USD/INR conversion`,
  };
  benchmarkHistoryCache.set(cacheKey, { value, savedAt: Date.now() });
  while (benchmarkHistoryCache.size > 80) benchmarkHistoryCache.delete(benchmarkHistoryCache.keys().next().value);
  return value;
};

const getCommodityBenchmarkQuote = async (requestedSymbol) => {
  const symbol = toProviderSymbol(requestedSymbol);
  const benchmark = COMMODITY_BENCHMARKS[symbol];
  if (!benchmark) return null;

  const now = Date.now();
  const cached = commodityBenchmarkCache.get(symbol);
  if (cached && now - cached.fetchedAt < COMMODITY_BENCHMARK_CACHE_MS) {
    return cached.quote;
  }
  if (commodityBenchmarkRequests.has(symbol)) return commodityBenchmarkRequests.get(symbol);

  const request = (async () => {
    try {
      const [response, dailyResponse, usdInr] = await Promise.all([
        axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(benchmark.yahooSymbol)}`, {
          params: { range: '1d', interval: '1m' },
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; ShareMarket/1.0)',
          },
          timeout: 8_000,
        }),
        axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(benchmark.yahooSymbol)}`, {
          params: { range: '5d', interval: '1d' },
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; ShareMarket/1.0)',
          },
          timeout: 8_000,
        }).catch(() => null),
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

      // Illiquid contracts can carry week-old intraday metadata; prefer a newer daily close when one exists.
      const dailyResult = dailyResponse?.data?.chart?.result?.[0];
      const dailyQuote = dailyResult?.indicators?.quote?.[0] || {};
      const dailyTimes = dailyResult?.timestamp || [];
      let dailyIndex = dailyTimes.length - 1;
      while (dailyIndex >= 0 && !(Number(dailyQuote.close?.[dailyIndex]) > 0)) dailyIndex -= 1;
      const dailyClose = Number(dailyQuote.close?.[dailyIndex]);
      const dailyTime = Number(dailyTimes[dailyIndex]) * 1000;
      let dailyPreviousClose = null;
      for (let index = dailyIndex - 1; index >= 0; index -= 1) {
        const value = Number(dailyQuote.close?.[index]);
        if (value > 0) {
          dailyPreviousClose = value;
          break;
        }
      }
      const metaTimestamp = Number(metadata.regularMarketTime) > 0
        ? Number(metadata.regularMarketTime) * 1000
        : Number(timestamps[lastIndex]) > 0 ? Number(timestamps[lastIndex]) * 1000 : 0;
      const useDailyClose = Number.isFinite(dailyClose) && dailyClose > 0
        && Number.isFinite(dailyTime) && dailyTime > 0
        && dailyTime > metaTimestamp + 6 * 60 * 60 * 1000;
      const effectivePrice = useDailyClose ? dailyClose : rawPrice;
      const effectivePreviousClose = useDailyClose && Number.isFinite(dailyPreviousClose)
        ? dailyPreviousClose
        : rawPreviousClose;

      const multiplier = usdInr.rate * benchmark.unitMultiplier;
      const toInr = (value) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? Number((number * multiplier).toFixed(2)) : null;
      };
      const previousClose = toInr(effectivePreviousClose);
      const currentPrice = toInr(effectivePrice);
      const rawChange = Number.isFinite(effectivePreviousClose) && effectivePreviousClose > 0
        ? effectivePrice - effectivePreviousClose
        : Number(metadata.regularMarketChange);
      const rawChangePercent = Number.isFinite(effectivePreviousClose) && effectivePreviousClose > 0
        ? (effectivePrice - effectivePreviousClose) / effectivePreviousClose * 100
        : Number(metadata.regularMarketChangePercent);
      const sourceTimestamp = useDailyClose
        ? dailyTime
        : metaTimestamp > 0 ? metaTimestamp : null;
      const high = useDailyClose
        ? Number(dailyQuote.high?.[dailyIndex])
        : Number(metadata.regularMarketDayHigh) || Math.max(0, ...(quote.high || []).map(Number).filter(Number.isFinite));
      const low = useDailyClose
        ? Number(dailyQuote.low?.[dailyIndex])
        : Number(metadata.regularMarketDayLow) || Math.min(...(quote.low || []).map(Number).filter((value) => Number.isFinite(value) && value > 0));
      const isStale = sourceTimestamp === null
        || now - sourceTimestamp > COMMODITY_BENCHMARK_STALE_AFTER_MS
        || usdInr.isStale
        || now - usdInr.timestamp > COMMODITY_BENCHMARK_STALE_AFTER_MS;
      const yearMetal = symbol === 'SILVER' ? 'SILVER' : symbol === 'GOLD' ? 'GOLD' : null;
      const yearRange = yearMetal ? metalYearRangeCache.get(yearMetal)?.value : null;
      if (yearMetal && !metalYearRangeCache.has(yearMetal)) {
        getMetalYearRange(yearMetal).catch(() => null);
      }
      const week52High = toInr(metadata.fiftyTwoWeekHigh) || yearRange?.high || null;
      const week52Low = toInr(metadata.fiftyTwoWeekLow) || yearRange?.low || null;
      const normalizedQuote = {
        symbol,
        exchange: 'COMEX',
        sourceExchange: 'COMEX',
        c: currentPrice,
        d: Number.isFinite(rawChange) ? Number((rawChange * multiplier).toFixed(2)) : null,
        dp: Number.isFinite(rawChangePercent) ? Number(rawChangePercent.toFixed(2)) : null,
        pc: previousClose,
        h: toInr(high),
        l: toInr(low),
        week52High,
        week52Low,
        v: null,
        timestamp: sourceTimestamp === null ? null : new Date(sourceTimestamp).toISOString(),
        provider: `Yahoo Finance delayed ${benchmark.yahooSymbol} · USD/INR conversion`,
        providerUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(benchmark.yahooSymbol)}/`,
        unit: benchmark.unit,
        metal: symbol === 'GOLD' ? 'XAU' : symbol === 'SILVER' ? 'XAG' : null,
        sourceSymbol: benchmark.yahooSymbol,
        sourcePriceUsd: effectivePrice,
        sourcePriceUnit: ['GOLD', 'SILVER'].includes(symbol) ? 'USD/troy oz' : null,
        usdInr: usdInr.rate,
        priceTimestamp: sourceTimestamp === null ? null : new Date(sourceTimestamp).toISOString(),
        fxTimestamp: new Date(usdInr.timestamp).toISOString(),
        ...metalUnitPrices(symbol, currentPrice),
        marketType: 'benchmark',
        benchmarkName: benchmark.label,
        isLive: false,
        isDelayed: true,
        isReal: true,
        isDemo: false,
        isStale,
      };
      commodityBenchmarkCache.set(symbol, {
        quote: normalizedQuote,
        fetchedAt: Date.now(),
      });
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

const addNseIndexFallbacks = async (symbols, existingQuotes = {}) => {
  const quotes = { ...existingQuotes };
  const missing = [...new Set(symbols.map(toProviderSymbol))]
    .filter((symbol) => isNseIndexSymbol(symbol) && !(Number(quotes[symbol]?.c) > 0));
  if (!missing.length) return quotes;
  try {
    const nseQuotes = await getNseIndexQuotes(missing);
    for (const [symbol, quote] of Object.entries(nseQuotes)) {
      if (!(Number(quotes[symbol]?.c) > 0)) quotes[symbol] = quote;
    }
  } catch (error) {
    console.warn('NSE India index feed unavailable:', error.message);
  }
  return quotes;
};

const addYahooResearchFallbacks = async (symbols, existingQuotes = {}) => {
  const quotes = { ...existingQuotes };
  const missing = symbols.filter((rawSymbol) => {
    const symbol = toProviderSymbol(rawSymbol);
    if (/^MCX:/i.test(rawSymbol) || isGoldSilverCopperSpotSymbol(rawSymbol)) return false;
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
    const providerQuote = Number(quotes[cleanSymbol]?.c) > 0 ? quotes[cleanSymbol] : null;
    try {
      quotes[cleanSymbol] = { ...await getMetalQuote(symbol), symbol: cleanSymbol };
    } catch {
      if (providerQuote) quotes[cleanSymbol] = decorateMetalQuote(cleanSymbol, providerQuote);
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
          quotes[cleanSymbol] = { ...await getMetalQuote(symbol), symbol: cleanSymbol };
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
    const quotesWithNseIndices = await addNseIndexFallbacks(symbols, quotesWithBenchmarks);
    const quotesWithResearch = await addYahooResearchFallbacks(symbols, quotesWithNseIndices);
    const missingSymbols = symbols.map(toProviderSymbol).filter((symbol) => !quotesWithResearch[symbol]);
    const hasBenchmarkQuotes = Object.values(quotesWithResearch).some((quote) => quote.marketType === 'benchmark');
    const hasResearchQuotes = Object.values(quotesWithResearch).some((quote) => quote.isResearch === true);
    const hasLiveMetalQuotes = Object.values(quotesWithResearch).some((quote) => quote.isLive === true && quote.liveFeed === 'upstox');
    const hasNseIndexQuotes = Object.values(quotesWithResearch).some((quote) => quote.liveFeed === 'nse');
    const hasLiveNseIndices = Object.values(quotesWithResearch).some((quote) => quote.liveFeed === 'nse' && quote.isLive === true);
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
        hasLiveMetalQuotes ? 'Upstox MCX' : null,
        hasBenchmarkQuotes ? 'Yahoo Finance benchmarks' : null,
        Object.values(quotesWithResearch).some((quote) => quote.marketType === 'spot') ? 'goldprice.dev spot' : null,
        hasNseIndexQuotes ? 'NSE India index feed' : null,
        hasResearchQuotes ? `${getYahooResearchProviderName()} · research` : null,
      ].filter(Boolean).join(' + '),
      isLive: hasLiveMetalQuotes || hasLiveNseIndices,
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
      const quotesWithNseIndices = await addNseIndexFallbacks(symbols, quotesWithBenchmarks);
      const quotes = await addYahooResearchFallbacks(symbols, quotesWithNseIndices);
      if (!Object.keys(quotes).length) {
        return res.status(502).json({ error: 'Kunpeng Data returned no live prices for the requested symbols.' });
      }
      const missing = symbols.map(toProviderSymbol).filter((symbol) => !quotes[symbol]);
      return res.json({
        provider: [
          Object.values(quotes).some((quote) => quote.isLive === true) ? 'Kunpeng Data' : null,
          Object.values(quotes).some((quote) => quote.liveFeed === 'nse') ? 'NSE India index feed' : null,
          Object.values(quotes).some((quote) => quote.isResearch === true) ? `${getYahooResearchProviderName()} · research` : null,
        ].filter(Boolean).join(' + '),
        isLive: Object.values(quotes).some((quote) => quote.isLive === true),
        researchOnly: Object.values(quotes).some((quote) => quote.isResearch === true),
        quotes: quotes,
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


// Provider Info
app.get('/api/provider', async (req, res) => {
  const provider = getMarketProvider();
  const liveDataAvailable = isLiveMarketProviderConfigured(provider);
  const upstoxHealth = await checkUpstoxToken();
  res.json({
    active: liveDataAvailable ? provider : null,
    liveDataAvailable,
    configuredProvider: provider,
    configured: {
      kun: isKunDataConfigured(),
      groww: Boolean(process.env.GROWW_ACCESS_TOKEN),
      upstox: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
      zerodha: Boolean(process.env.ZERODHA_API_KEY && process.env.ZERODHA_ACCESS_TOKEN),
      alpha_vantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      gemini_ai: Boolean(process.env.GEMINI_API_KEY),
      live_engine: false,
    },
    providerHealth: {
      upstox: upstoxHealth,
    },
    stream: provider === 'kun' ? getKunDataStatus() : null,
  });
});

// ==========================================
// AI COPILOT & STOCK ANALYSIS ENDPOINTS
// ==========================================

// AI Copilot chat endpoint - every answer is grounded in verified research data.
app.post('/api/ai/chat', async (req, res) => {
  const { message, context = {}, history = [] } = req.body || {};
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return res.status(400).json({ error: 'Message is required.', code: 'message_required' });
  if (cleanMessage.length > 800) return res.status(400).json({ error: 'Please keep questions under 800 characters.', code: 'message_too_long' });

  try {
    const result = await answerCopilot({ message: cleanMessage, context, history });
    res.set('Cache-Control', 'no-store');
    return res.json(result);
  } catch (error) {
    console.error('AI copilot error:', error.message);
    return res.status(502).json({
      error: 'The AI copilot could not complete this request. Verified research data may be temporarily unavailable.',
      code: 'ai_copilot_failed',
    });
  }
});

app.get('/api/ai/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(getAIStatus());
});

// Verified OHLC analysis. No live-provider requirement; output is labelled research data.
app.get('/api/ai/analyze-stock', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const exchange = String(req.query.exchange || 'NSE').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'A stock symbol is required.', code: 'symbol_required' });
  if (!['NSE', 'BSE'].includes(exchange)) return res.status(400).json({ error: 'exchange must be NSE or BSE.', code: 'unsupported_exchange' });

  try {
    const analysis = await analyzeSymbol(symbol, exchange);
    res.set('Cache-Control', 'private, max-age=30');
    return res.json(analysis);
  } catch (error) {
    const status = error.code === 'research_provider_unavailable' ? 503
      : error.code === 'research_data_unavailable' ? 404
      : 502;
    return res.status(status).json({ error: error.message, code: error.code || 'ai_analysis_failed' });
  }
});

app.get('/', (req, res) => {
  const indexFile = path.join(process.cwd(), 'dist', 'index.html');
  if (process.env.VERCEL !== '1' && fs.existsSync(indexFile)) return res.sendFile(indexFile);
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
    metals: {
      liveProvider: metalUpstoxStatus.configured ? 'upstox' : null,
      live: metalUpstoxStatus.available,
      configured: metalUpstoxStatus.configured,
      tokenValid: metalUpstoxStatus.tokenValid,
      reason: metalUpstoxStatus.reason,
      checkedAt: metalUpstoxStatus.checkedAt ? new Date(metalUpstoxStatus.checkedAt).toISOString() : null,
      fallback: 'goldprice.dev spot',
    },
    nseIndexFeed: getNseIndexFeedStatus(),
  });
});

app.post('/api/payments/order', async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount < 10 || amount > 10000000) return res.status(400).json({ error: 'Amount must be between Rs 10 and Rs 1,00,000.' });

  // If Razorpay live keys are configured, use real Razorpay API. Otherwise provide simulated sandbox order
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    try {
      const response = await axios.post('https://api.razorpay.com/v1/orders', {
        amount: amount * 100,
        currency: 'INR',
        receipt: `sm_${Date.now()}`,
        notes: { product: 'ShareMarket wallet top-up' },
      }, { auth: { username: process.env.RAZORPAY_KEY_ID, password: process.env.RAZORPAY_KEY_SECRET } });
      return res.json({ ...response.data, keyId: process.env.RAZORPAY_KEY_ID });
    } catch (error) {
      // Fallback to simulated test order if upstream auth fails
      console.warn('Razorpay upstream error, serving sandbox order:', error.message);
    }
  }

  // Simulated Instant Sandbox Wallet Top-up Order
  const sandboxOrderId = `order_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return res.json({
    id: sandboxOrderId,
    entity: 'order',
    amount: amount * 100,
    amount_paid: 0,
    amount_due: amount * 100,
    currency: 'INR',
    receipt: `sm_${Date.now()}`,
    status: 'created',
    keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_sharemarket_sandbox',
    isSandbox: true,
  });
});

app.post('/api/payments/verify', (req, res) => {
  const { orderId, paymentId, signature } = req.body || {};
  if (!orderId || !paymentId) return res.status(400).json({ verified: false, error: 'Payment verification details are incomplete.' });
  
  if (process.env.RAZORPAY_KEY_SECRET && signature && !orderId.startsWith('order_test_')) {
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    const received = Buffer.from(signature);
    const verified = received.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), received);
    return res.status(verified ? 200 : 400).json({ verified });
  }

  // Sandbox automatic verification
  return res.json({ verified: true, sandbox: true, paymentId });
});

app.get('/api/news/market', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=30');
  res.json(await getMarketNewsFeed());
});

app.get('/api/analytics/sector-heatmap', (req, res) => {
  res.json(getSectorHeatmapData());
});

app.get('/api/news/mutual-funds', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=30');
  res.json(await getMutualFundNewsFeed());
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

  const defaultList = Object.entries(defaultStockUniverse).map(([sym, item]) => ({
    symbol: sym,
    description: item.name,
    displaySymbol: sym,
    exchange: 'NSE',
    type: 'EQ',
  }));
  res.json(requestedExchange === 'BSE' ? [] : defaultList);
});

// Forward Kunpeng's authorized WebSocket ticks to the chart over a server event stream.
app.get('/api/stock/stream', async (req, res) => {
  const symbols = [...new Set(String(req.query.symbols || req.query.symbol || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z0-9._-]{1,24}$/.test(value)))].slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: 'Provide at least one valid stock symbol.' });
  if (getMarketProvider() !== 'kun' || !isKunDataConfigured()) {
    return res.status(503).json({ error: 'The selected market provider does not have an active WebSocket feed.' });
  }

  res.status(200);
  res.set({
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const sendEvent = (event, payload) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const unsubscribe = subscribeKunQuotes((quote) => {
    if (symbols.includes(quote.symbol)) sendEvent('quote', quote);
  });
  const statusInterval = setInterval(() => sendEvent('status', getKunDataStatus()), 10_000);
  statusInterval.unref?.();
  let closed = false;
  const closeStream = () => {
    if (closed) return;
    closed = true;
    clearInterval(statusInterval);
    unsubscribe();
  };
  res.on('close', closeStream);

  try {
    const quotes = await getKunQuotes(symbols);
    Object.values(quotes).forEach((quote) => sendEvent('quote', quote));
    sendEvent('status', getKunDataStatus());
  } catch (error) {
    sendEvent('provider_error', { error: error.message || 'The provider stream is unavailable.' });
    closeStream();
    res.end();
  }
});

app.get('/api/metals/overview', async (req, res) => {
  const results = await Promise.allSettled([
    getMetalQuote('GOLD'),
    getMetalQuote('SILVER'),
    getMetalSpotQuote('GOLD'),
    getMetalSpotQuote('SILVER'),
    getUsdToInrRate(),
  ]);
  const value = (index) => results[index].status === 'fulfilled' ? results[index].value : null;
  const gold = value(0);
  const silver = value(1);
  if (!gold && !silver) {
    return res.status(502).json({
      error: 'Gold and silver providers are unavailable right now.',
      code: 'metals_providers_unavailable',
    });
  }
  const fx = value(4);
  return res.json({
    market: getMCXScheduleStatus(),
    quotes: { GOLD: gold, SILVER: silver },
    spotReferences: { GOLD: value(2), SILVER: value(3) },
    fx: fx ? {
      pair: 'USD/INR',
      rate: fx.rate,
      timestamp: new Date(fx.timestamp).toISOString(),
      isStale: fx.isStale,
      provider: 'Yahoo Finance with goldprice.dev fallback',
    } : null,
    checkedAt: new Date().toISOString(),
  });
});

app.get('/api/metals/insight', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase().replace(/^MCX:/, '');
  if (!METAL_HISTORY_SYMBOLS[symbol]) {
    return res.status(400).json({ error: 'Only GOLD and SILVER insights are supported.', code: 'unsupported_symbol' });
  }
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 420 * 24 * 60 * 60;
    const [quoteResult, historyResult] = await Promise.allSettled([
      getMetalQuote(symbol),
      getMetalHistoryCandles({ metal: symbol, resolution: '1d', from, to }),
    ]);
    const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
    const history = historyResult.status === 'fulfilled' ? historyResult.value : null;
    const insight = computeMetalInsight({
      symbol,
      quote,
      candles: history?.candles || [],
      historyProvider: history?.provider || '',
    });
    if (insight.status !== 'ok' && !insight.quote?.price) {
      return res.status(502).json({
        error: `Verified ${symbol.toLowerCase()} history and quotes are unavailable right now.`,
        code: 'metals_insight_unavailable',
      });
    }
    res.set('Cache-Control', 'private, max-age=60');
    return res.json(insight);
  } catch (error) {
    console.warn(`Metals insight error for ${symbol}:`, error.message);
    return res.status(502).json({ error: 'The metals insight could not be computed right now.', code: 'metals_insight_failed' });
  }
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
        return res.json(await getMetalQuote(symbol));
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
    if (isNseIndexSymbol(symbol)) {
      try {
        const nseQuote = (await getNseIndexQuotes([symbol]))[toProviderSymbol(symbol)];
        if (nseQuote) return res.json(nseQuote);
      } catch (error) {
        console.warn('NSE India index quote failed:', error.message);
      }
    }
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
    if (quote) {
      if (isMetalSymbol) {
        try {
          return res.json(await getMetalQuote(symbol));
        } catch {
          return res.json(decorateMetalQuote(toProviderSymbol(symbol), quote));
        }
      }
      return res.json(quote);
    }
    if (isMetalSymbol) return res.json(await getMetalQuote(symbol));
    if (isCommodityBenchmark) return res.json(await getCommodityBenchmarkQuote(symbol));
    const researchQuotes = await getYahooResearchQuotes([symbol]);
    if (researchQuotes[toProviderSymbol(symbol)]) return res.json(researchQuotes[toProviderSymbol(symbol)]);
    return res.status(502).json({ error: `${provider} returned no live quote for ${symbol}.` });
  } catch (error) {
    if (isMetalSymbol) {
      try {
        return res.json(await getMetalQuote(symbol));
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
    if (isNseIndexSymbol(symbol)) {
      try {
        const nseQuote = (await getNseIndexQuotes([symbol]))[toProviderSymbol(symbol)];
        if (nseQuote) return res.json(nseQuote);
      } catch (fallbackError) {
        console.warn('NSE India index quote fallback failed:', fallbackError.message);
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
const historyPayloadCache = new Map();
app.get('/api/stock/history', async (req, res) => {
  const { symbol, from, to } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });

  const resolution = String(req.query.resolution || 'D');
  // Providers publish a fixed set of candle granularities. A request for a
  // coarser bar is served by merging an exact number of those verified bars —
  // nothing is ever interpolated or generated locally.
  const resolutionAliases = { D: '1d', W: '1w', M: '1M' };
  const kunBaseIntervals = {
    '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240',
    '1d': 'D', '1w': 'W', '1M': 'M',
  };
  const candleBaseParams = {
    '1m': { upstoxUnit: 'minutes', upstoxInterval: 1, alphaInterval: '1min' },
    '5m': { upstoxUnit: 'minutes', upstoxInterval: 5, alphaInterval: '5min' },
    '15m': { upstoxUnit: 'minutes', upstoxInterval: 15, alphaInterval: '15min' },
    '30m': { upstoxUnit: 'minutes', upstoxInterval: 30, alphaInterval: '30min' },
    '1h': { upstoxUnit: 'hours', upstoxInterval: 1, alphaInterval: '60min' },
    '2h': { upstoxUnit: 'hours', upstoxInterval: 2 },
    '4h': { upstoxUnit: 'hours', upstoxInterval: 4 },
    '1d': { upstoxUnit: 'days', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_DAILY', alphaSeries: 'Time Series (Daily)' },
    '1w': { upstoxUnit: 'weeks', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_WEEKLY', alphaSeries: 'Weekly Time Series' },
    '1M': { upstoxUnit: 'months', upstoxInterval: 1, alphaFunction: 'TIME_SERIES_MONTHLY', alphaSeries: 'Monthly Time Series' },
  };
  // Only granularities each provider is known to publish. Anything the chart
  // asks for above that list is merged from those verified bars.
  const providerNativeResolutions = {
    kun: Object.keys(kunBaseIntervals),
    upstox: ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M'],
    alpha: ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'],
    yahoo: ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'],
  };
  const candlePlan = (provider) => planResolution(
    resolutionAliases[resolution] || resolution,
    providerNativeResolutions[provider],
  );
  const requestedSeconds = resolutionSeconds(resolution);
  if (!requestedSeconds) {
    return res.status(400).json({
      error: `Unsupported candle resolution "${resolution}".`,
      supportedResolutions: SUPPORTED_RESOLUTIONS,
    });
  }

  const toTime = Number(to) || Math.floor(Date.now() / 1000);
  const fromTime = Number(from) || 0;
  const hasFromParameter = from !== undefined && from !== '';
  // Align the window to 30-second buckets so repeat requests reuse cached series
  // instead of pulling the whole history again for a one-second range shift.
  const historyBucketSeconds = 30;
  const requestedTo = Math.floor(toTime / historyBucketSeconds) * historyBucketSeconds;
  const requestedFrom = hasFromParameter
    ? Math.floor(Math.max(0, fromTime) / historyBucketSeconds) * historyBucketSeconds
    : (requestedTo - requestedSeconds * 100);
  const historyPayloadKey = `${String(symbol).toUpperCase()}|${resolution}|${requestedFrom}|${requestedTo}`;
  const cachedHistoryPayload = historyPayloadCache.get(historyPayloadKey);
  if (cachedHistoryPayload) {
    const ttl = cachedHistoryPayload.status === 200 ? 45_000 : 5_000;
    if (Date.now() - cachedHistoryPayload.savedAt < ttl) {
      return res.status(cachedHistoryPayload.status).json(cachedHistoryPayload.body);
    }
  }
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    historyPayloadCache.set(historyPayloadKey, { status: res.statusCode || 200, body, savedAt: Date.now() });
    while (historyPayloadCache.size > 300) historyPayloadCache.delete(historyPayloadCache.keys().next().value);
    return sendJson(body);
  };
  const toIndiaDate = (timestamp) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(timestamp * 1000));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const makePayload = (candles, provider, plan = null) => ({
    s: candles.length ? 'ok' : 'no_data',
    t: candles.map((candle) => candle.time),
    o: candles.map((candle) => candle.open),
    h: candles.map((candle) => candle.high),
    l: candles.map((candle) => candle.low),
    c: candles.map((candle) => candle.close),
    v: candles.map((candle) => candle.value),
    provider,
    resolution,
    effectiveResolution: plan ? plan.baseResolution : resolution,
    fallbackNote: plan ? mergeNote(plan) : '',
  });
  const researchHistoryPayload = async () => {
    if (!isYahooResearchEnabled()) return null;
    try {
      const research = await getYahooResearchHistory({
        symbol: String(symbol),
        from: requestedFrom,
        to: requestedTo,
        start: requestedFrom > 0 ? toIndiaDate(requestedFrom) : '',
        end: toIndiaDate(requestedTo + 24 * 60 * 60),
        resolution,
      });
      const candles = (research?.candles || []).filter((candle) => (
        candle.time + requestedSeconds > requestedFrom && candle.time <= requestedTo
      ));
      if (!candles.length) return null;
      return {
        ...makePayload(candles, research.provider),
        effectiveResolution: research.effectiveResolution || resolution,
        fallbackNote: research.fallbackNote || '',
        isLive: false,
        isDelayed: true,
        isResearch: true,
      };
    } catch (error) {
      console.warn(`Yahoo Finance research history error for ${symbol} (${resolution}):`, error.message);
      return null;
    }
  };

  const metalSymbol = toProviderSymbol(String(symbol));
  const metalConfig = METAL_HISTORY_SYMBOLS[metalSymbol];
  if (metalConfig) {
    try {
      const metalHistory = await getMetalHistoryCandles({
        metal: metalSymbol,
        resolution,
        from: hasFromParameter ? requestedFrom : 0,
        to: requestedTo,
      });
      if (metalHistory.candles.length) {
        return res.json({
          ...makePayload(metalHistory.candles, metalHistory.provider),
          effectiveResolution: metalHistory.effectiveResolution || resolution,
          fallbackNote: metalHistory.fallbackNote || '',
          unit: metalConfig.unit,
          isLive: false,
          isDelayed: true,
          isReal: true,
          isResearch: true,
        });
      }
      return res.status(502).json({
        error: `No verified ${metalSymbol.toLowerCase()} candles are available for this range.`,
      });
    } catch (error) {
      console.warn(`Metal historical candles error for ${symbol} (${resolution}):`, error.message);
      return res.status(502).json({
        error: `The ${metalSymbol.toLowerCase()} historical feed is unavailable right now.`,
      });
    }
  }

  const benchmarkConfig = COMMODITY_BENCHMARKS[metalSymbol];
  if (benchmarkConfig) {
    try {
      const benchmarkHistory = await getCommodityBenchmarkHistory({
        symbol: metalSymbol,
        resolution,
        from: hasFromParameter ? requestedFrom : 0,
        to: requestedTo,
      });
      if (benchmarkHistory.candles.length) {
        return res.json({
          ...makePayload(benchmarkHistory.candles, benchmarkHistory.provider),
          effectiveResolution: benchmarkHistory.effectiveResolution || resolution,
          fallbackNote: benchmarkHistory.fallbackNote || '',
          unit: benchmarkConfig.unit,
          isLive: false,
          isDelayed: true,
          isReal: true,
          isResearch: true,
        });
      }
      return res.status(502).json({
        error: `No verified ${metalSymbol.toLowerCase()} candles are available for this range.`,
      });
    } catch (error) {
      console.warn(`Benchmark historical candles error for ${symbol} (${resolution}):`, error.message);
      return res.status(502).json({
        error: `The ${metalSymbol.toLowerCase()} historical feed is unavailable right now.`,
      });
    }
  }

  if (getMarketProvider() === 'kun' && isKunDataConfigured()) {
    // Kunpeng has only ever returned the bars keyed below; every coarser chart
    // timeframe is merged from them instead of relabelling a finer series.
    const plan = candlePlan('kun');
    if (!plan) {
      return res.status(503).json({
        error: `Kunpeng Data publishes no ${resolution} candles and ${resolution} cannot be built from its verified bars.`,
        supportedResolutions: Object.keys(kunBaseIntervals),
      });
    }
    try {
      const count = Math.min(2500, Math.max(20, Math.ceil((requestedTo - requestedFrom) / plan.baseSeconds) + 5));
      const candles = await getKunHistory({ symbol: String(symbol), interval: kunBaseIntervals[plan.baseResolution], count });
      const merged = plan.isMerged ? aggregateCandles(candles, plan.seconds) : candles;
      const rangedCandles = merged.filter((candle) => candle.time + plan.seconds > requestedFrom && candle.time <= requestedTo);
      return res.json(makePayload(rangedCandles, 'Kunpeng Data', plan));
    } catch (error) {
      console.warn(`Kunpeng Data history error for ${symbol} (${resolution}):`, error.response?.status || error.message);
      const researchPayload = await researchHistoryPayload();
      if (researchPayload) return res.json(researchPayload);
      return res.status(502).json({ error: `Kunpeng Data could not return historical candles for ${symbol}.` });
    }
  }

  if (getMarketProvider() === 'upstox' && process.env.UPSTOX_ACCESS_TOKEN) {
    const plan = candlePlan('upstox');
    const baseParams = plan && candleBaseParams[plan.baseResolution];
    if (!plan || !baseParams) {
      return res.status(503).json({
        error: `Upstox publishes no ${resolution} candles and ${resolution} cannot be built from its verified bars.`,
        supportedResolutions: providerNativeResolutions.upstox,
      });
    }
    try {
      await loadUpstoxInstrumentMaster();
      const instrumentKey = toUpstoxInstrumentKey(String(symbol));
      if (!instrumentKey) throw new Error(`No Upstox instrument key found for ${symbol}.`);
      const historyUrl = `${UPSTOX_BASE_URL}/historical-candle/${encodeURIComponent(instrumentKey)}/${baseParams.upstoxUnit}/${baseParams.upstoxInterval}/${toIndiaDate(requestedTo)}/${toIndiaDate(requestedFrom)}`;
      const response = await axios.get(historyUrl, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}` },
        timeout: 12_000,
      });
      const rawCandles = response.data?.data?.candles;
      if (!Array.isArray(rawCandles)) throw new Error('Upstox did not return historical candles.');
      let candles = rawCandles.map(([time, open, high, low, close, value]) => ({
        time: Math.floor(new Date(time).getTime() / 1000),
        open: parseAlphaNumber(open),
        high: parseAlphaNumber(high),
        low: parseAlphaNumber(low),
        close: parseAlphaNumber(close),
        value: parseAlphaNumber(value) || 0,
      }))
        .filter((candle) => Number.isFinite(candle.time)
          && candle.time <= requestedTo
          && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
        .sort((first, second) => first.time - second.time);
      if (plan.isMerged) candles = aggregateCandles(candles, plan.seconds);
      candles = candles.filter((candle) => candle.time + plan.seconds > requestedFrom);
      return res.json(makePayload(candles, 'Upstox', plan));
    } catch (error) {
      console.warn(`Upstox historical candles error for ${symbol} (${resolution}):`, error.message);
      if (!process.env.ALPHA_VANTAGE_API_KEY) {
        const researchPayload = await researchHistoryPayload();
        if (researchPayload) return res.json(researchPayload);
        return res.status(502).json({ error: 'Upstox historical candles are unavailable for this interval.' });
      }
    }
  }

  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    const researchPayload = await researchHistoryPayload();
    if (researchPayload) return res.json(researchPayload);
  }

  if (process.env.ALPHA_VANTAGE_API_KEY) {
    const plan = candlePlan('alpha');
    const baseParams = plan && candleBaseParams[plan.baseResolution];
    if (!plan || !baseParams) {
      return res.status(503).json({
        error: `Alpha Vantage publishes no ${resolution} candles and ${resolution} cannot be built from its verified bars.`,
        supportedResolutions: providerNativeResolutions.alpha,
      });
    }
    try {
      const params = {
        function: baseParams.alphaFunction || 'TIME_SERIES_INTRADAY',
        symbol: toAlphaVantageSymbol(symbol),
        outputsize: 'compact',
        apikey: process.env.ALPHA_VANTAGE_API_KEY,
      };
      if (baseParams.alphaInterval) params.interval = baseParams.alphaInterval;
      const response = await axios.get(ALPHA_VANTAGE_BASE_URL, { params, timeout: 12_000 });
      const series = response.data?.[baseParams.alphaSeries || `Time Series (${baseParams.alphaInterval})`];
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
          && candle.time <= requestedTo
          && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
        .sort((first, second) => first.time - second.time);

      if (plan.isMerged) candles = aggregateCandles(candles, plan.seconds);
      candles = candles.filter((candle) => candle.time + plan.seconds > requestedFrom);
      return res.json(makePayload(candles, 'Alpha Vantage', plan));
    } catch (error) {
      console.warn(`Alpha Vantage historical candles error for ${symbol} (${resolution}):`, error.message);
      return res.status(502).json({ error: 'Historical candle data is unavailable right now.' });
    }
  }

  return res.status(503).json({ error: 'Configure Upstox or Alpha Vantage history access to load verified candles.' });
});

// ── LIVE IPO ENGINE & SUBSCRIPTION TICKER ──────────────────────────────────
const UPSTOX_IPO_API_URL = 'https://api.upstox.com/v2/ipos';
const UPSTOX_IPO_CACHE_TTL_MS = 60_000;
const UPSTOX_IPO_STATUSES = ['open', 'upcoming', 'closed', 'listed'];
const NSE_IPO_PAGE_URL = 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo';
const NSE_IPO_CURRENT_URL = 'https://www.nseindia.com/api/ipo-current-issue';
const NSE_IPO_UPCOMING_URL = 'https://www.nseindia.com/api/all-upcoming-issues?category=ipo';
const NSE_IPO_TRACKER_URL = 'https://www.nseindia.com/api/NextApi/apiClient?functionName=getIPOTrackerSummary';
const NSE_IPO_TRACKER_PAGE_URL = 'https://www.nseindia.com/ipo-tracker?type=ipo_year';
const NSE_IPO_CACHE_TTL_MS = 60_000;
const NSE_IPO_AUTO_REFRESH_MS = NSE_IPO_CACHE_TTL_MS;
const hasIpoApplicationEnded = (ipo, now = Date.now()) => {
  const date = String(ipo.applicationEndDateISO || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [, year, month, day] = match;
  const endOfApplication = Date.UTC(Number(year), Number(month) - 1, Number(day), 18, 30);
  return new Date(endOfApplication).toISOString().slice(0, 10) === date && now >= endOfApplication;
};
const isActiveIpo = (ipo) => {
  const status = String(ipo.status || '').trim().toLowerCase();
  return ['open', 'upcoming', 'open soon'].includes(status)
    && !hasIpoApplicationEnded(ipo);
};
const getActiveIpos = (ipos) => ipos.filter(isActiveIpo);
let upstoxIpoCache = null;
let upstoxIpoRequest = null;

const fetchUpstoxIposByStatus = async (status, token) => {
  const fetchPage = (pageNumber) => axios.get(UPSTOX_IPO_API_URL, {
    params: { status, page_number: pageNumber, records: 30 },
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    timeout: 12_000,
  });

  const firstPage = await fetchPage(1);
  const totalPages = Math.max(1, Number(firstPage.data?.meta_data?.page?.total_pages) || 1);
  const pagesToFetch = ['open', 'upcoming'].includes(status) ? totalPages : 1;
  const remainingPages = await Promise.all(
    Array.from({ length: pagesToFetch - 1 }, (_, index) => fetchPage(index + 2)),
  );

  return [firstPage, ...remainingPages].flatMap((response) => response.data?.data || []);
};

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

let nseIpoCache = null;
let nseIpoRequest = null;
let nseIpoAutoRefreshTimer = null;

const loadPersistedNseIpoFeed = () => {
  if (nseIpoCache) return nseIpoCache;
  try {
    const row = getDatabase().get(
      'SELECT payload_json, fetched_at, last_updated FROM ipo_feed_cache WHERE source = ?',
      'nse',
    );
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json);
    if (!Array.isArray(parsed?.data) || !Array.isArray(parsed?.history)
      || !Number.isFinite(Number(row.fetched_at))) return null;
    const fetchedAt = Number(row.fetched_at);
    nseIpoCache = {
      data: getActiveIpos(parsed.data),
      history: parsed.history,
      fetchedAt,
      lastUpdated: row.last_updated || new Date(fetchedAt).toISOString(),
      restoredFromDatabase: true,
    };
    return nseIpoCache;
  } catch (error) {
    console.error('Could not restore the cached NSE IPO feed:', error.message || error);
    return null;
  }
};

const persistNseIpoFeed = (feed) => {
  try {
    getDatabase().run(`
      INSERT INTO ipo_feed_cache (source, payload_json, fetched_at, last_updated, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        payload_json = excluded.payload_json,
        fetched_at = excluded.fetched_at,
        last_updated = excluded.last_updated,
        updated_at = excluded.updated_at
    `, 'nse', JSON.stringify({ data: feed.data, history: feed.history }),
      feed.fetchedAt, feed.lastUpdated, new Date().toISOString());
  } catch (error) {
    console.error('Could not persist the NSE IPO feed:', error.message || error);
  }
};

const parseNseIpoDate = (value) => {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(value || '').trim());
  if (!match) return '';
  const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    .indexOf(match[2].toLowerCase());
  if (monthIndex < 0) return '';
  return `${match[3]}-${String(monthIndex + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
};

const mapNseIpo = (item, { includeClosed = false } = {}) => {
  const applicationEndDateISO = parseNseIpoDate(item.issueEndDate);
  const applicationStartDateISO = parseNseIpoDate(item.issueStartDate);
  let status = String(item.status || '').toLowerCase();
  const startDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(applicationStartDateISO);
  const endDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(applicationEndDateISO);
  const now = Date.now();
  if (endDateMatch) {
    const [, year, month, day] = endDateMatch;
    const endOfApplication = Date.UTC(Number(year), Number(month) - 1, Number(day), 18, 30);
    if (new Date(endOfApplication).toISOString().slice(0, 10) === applicationEndDateISO && now >= endOfApplication) {
      status = 'closed';
    }
  }
  if (status !== 'closed' && startDateMatch) {
    const [, year, month, day] = startDateMatch;
    const startOfApplication = Date.UTC(Number(year), Number(month) - 1, Number(day), 4, 30);
    if (new Date(startOfApplication).toISOString().slice(0, 10) === applicationStartDateISO) {
      status = now < startOfApplication ? 'forthcoming' : 'active';
    }
  }
  const allowed = includeClosed ? ['active', 'forthcoming', 'closed'] : ['active', 'forthcoming'];
  if (!allowed.includes(status)) return null;
  const priceValues = String(item.priceBand || item.issuePrice || '')
    .match(/[\d,]+(?:\.\d+)?/g)?.map((value) => Number(value.replaceAll(',', '')))
    .filter(Number.isFinite) || [];
  const minimumPrice = priceValues.length ? priceValues[0] : null;
  const maximumPrice = priceValues.length > 1 ? priceValues.at(-1) : minimumPrice;
  const priceBand = minimumPrice === null
    ? 'Not announced'
    : maximumPrice !== minimumPrice
      ? `₹${formatIpoAmount(minimumPrice)} – ₹${formatIpoAmount(maximumPrice)}`
      : `₹${formatIpoAmount(minimumPrice)}`;
  const lotSize = Number(String(item.lotSize || '').replaceAll(',', '')) || null;
  const offeredShares = Number(String(item.issueSize || item.noOfSharesOffered || '').replaceAll(',', '')) || null;
  const subscriptionValue = Number(item.noOfTime || item.noOfTimes);
  const symbol = String(item.symbol || '').trim();
  const company = String(item.companyName || item.company || symbol || 'IPO issue').trim();
  const idSlug = (symbol || company).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const issueStatus = status === 'active' ? 'Open' : status === 'closed' ? 'Closed' : 'Upcoming';

  return {
    id: `nse-${idSlug}`,
    symbol,
    company,
    priceBand,
    minPrice: minimumPrice,
    minimumPrice,
    maximumPrice,
    cutOffPrice: maximumPrice,
    lotSize,
    minimumQuantity: lotSize,
    issueSize: offeredShares ? `${formatIpoAmount(offeredShares)} shares` : 'Not provided',
    issueSizeLabel: 'Shares offered',
    minInvestment: lotSize && maximumPrice
      ? `₹${formatIpoAmount(lotSize * maximumPrice)}`
      : '',
    openDate: formatIpoDate(applicationStartDateISO),
    closeDate: formatIpoDate(applicationEndDateISO),
    applicationStartDateISO,
    applicationEndDateISO,
    allotmentDate: 'Not provided',
    listingDate: 'Not provided',
    subscription: Number.isFinite(subscriptionValue) && subscriptionValue > 0
      ? `${subscriptionValue.toFixed(2)}x`
      : 'Not provided',
    qibFormatted: '',
    niiFormatted: '',
    retailFormatted: '',
    gmp: '',
    gmpValue: 'Not provided',
    status: issueStatus,
    segment: String(item.series || '').toUpperCase() === 'SME' ? 'SME' : 'Mainboard',
    totalApplications: null,
    issueExchange: item.isBse === '1' ? 'BSE' : 'NSE',
    listingExchange: item.isBse === '1' ? 'BSE' : 'NSE',
    source: 'nse',
    sourceUrl: NSE_IPO_PAGE_URL,
    isLive: true,
    investors: [],
    registrar: null,
    financials: null,
    useOfProceeds: null,
    strengths: [],
    risks: [],
  };
};

const mapNseListedIpo = (item) => {
  const symbol = String(item.SYMBOL || '').trim();
  const company = String(item.COMPANYNAME || symbol || 'Listed IPO').trim();
  const issuePrice = Number(item.ISSUE_PRICE);
  const listingDateMatch = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(item.LISTED_ON || ''));
  const listingDateISO = listingDateMatch
    ? `${listingDateMatch[3]}-${listingDateMatch[2]}-${listingDateMatch[1]}`
    : '';
  const idSlug = (symbol || company).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return {
    id: `nse-${idSlug}`,
    symbol,
    company,
    priceBand: Number.isFinite(issuePrice) ? `₹${formatIpoAmount(issuePrice)}` : 'Not provided',
    priceBandLabel: 'Issue price',
    minPrice: Number.isFinite(issuePrice) ? issuePrice : null,
    minimumPrice: Number.isFinite(issuePrice) ? issuePrice : null,
    maximumPrice: Number.isFinite(issuePrice) ? issuePrice : null,
    cutOffPrice: Number.isFinite(issuePrice) ? issuePrice : null,
    lotSize: null,
    minimumQuantity: null,
    issueSize: 'Not provided',
    issueSizeLabel: 'Issue size',
    minInvestment: '',
    openDate: 'Not provided',
    closeDate: 'Not provided',
    allotmentDate: 'Not provided',
    listingDate: formatIpoDate(listingDateISO),
    subscription: 'Not provided',
    gmp: '',
    gmpValue: 'Not provided',
    status: 'Listed',
    segment: String(item.MARKETTYPE || '').toUpperCase().includes('SME') ? 'SME' : 'Mainboard',
    listingExchange: 'NSE',
    listingPrice: Number(item.LISTED_DAY_CLOSE) || null,
    currentPrice: Number(item.LTP || item.CURRENT_PRICE) || null,
    listingGain: Number(item.LISTED_DAY_GAIN) || 0,
    listingGainPercent: Number(item.LISTED_DAY_GAIN_PER) || 0,
    gainFromIssue: Number(item.GAIN_LOSS) || 0,
    gainFromIssuePercent: Number(item.GAIN_LOSS_PER) || 0,
    source: 'nse',
    sourceUrl: NSE_IPO_TRACKER_PAGE_URL,
    isLive: true,
  };
};

const getNseIpoFeed = async () => {
  const currentCache = nseIpoCache || loadPersistedNseIpoFeed();
  if (currentCache && Date.now() - currentCache.fetchedAt < NSE_IPO_CACHE_TTL_MS) {
    return { ...currentCache, data: getActiveIpos(currentCache.data) };
  }
  if (nseIpoRequest) return nseIpoRequest;

  nseIpoRequest = (async () => {
    const headers = {
      Accept: 'application/json,text/plain,*/*',
      Referer: NSE_IPO_PAGE_URL,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
    };
    const [currentResponse, upcomingResponse, trackerResponse] = await Promise.all([
      axios.get(NSE_IPO_CURRENT_URL, { headers, timeout: 12_000 }),
      axios.get(NSE_IPO_UPCOMING_URL, { headers, timeout: 12_000 }),
      axios.get(NSE_IPO_TRACKER_URL, { headers: { ...headers, Referer: NSE_IPO_TRACKER_PAGE_URL }, timeout: 12_000 }),
    ]);
    if (!Array.isArray(currentResponse.data) || !Array.isArray(upcomingResponse.data)
      || !Array.isArray(trackerResponse.data?.data)) {
      throw new Error('NSE returned an invalid IPO feed.');
    }

    const issuesBySymbol = new Map();
    for (const item of [...upcomingResponse.data, ...currentResponse.data]) {
      const key = String(item.symbol || item.companyName || '').trim().toLowerCase();
      if (!key) continue;
      const previous = issuesBySymbol.get(key) || {};
      issuesBySymbol.set(key, {
        ...previous,
        ...Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null && value !== undefined && value !== '')),
      });
    }

    const mappedIssues = [...issuesBySymbol.values()].map(mapNseIpo).filter(Boolean);
    const fetchedAt = Date.now();
    const data = getActiveIpos(mappedIssues)
      .sort((first, second) => (first.status === 'Open' ? 0 : 1) - (second.status === 'Open' ? 0 : 1));
    const historyById = new Map();
    for (const item of [...upcomingResponse.data, ...currentResponse.data]) {
      const closed = mapNseIpo(item, { includeClosed: true });
      if (closed && closed.status === 'Closed') {
        historyById.set(closed.id, { ...closed, isLive: false, stale: true });
      }
    }
    for (const ipo of trackerResponse.data.data.map(mapNseListedIpo).filter((item) => item.symbol)) {
      historyById.set(ipo.id, ipo);
    }
    const activeIds = new Set(data.map((ipo) => ipo.id));
    for (const ipo of [...(nseIpoCache?.data || []), ...mappedIssues]) {
      if (!activeIds.has(ipo.id) && hasIpoApplicationEnded(ipo)) {
        historyById.set(ipo.id, { ...ipo, status: 'Closed', isLive: false, stale: true });
      }
    }
    nseIpoCache = {
      data,
      history: [...historyById.values()],
      fetchedAt,
      lastUpdated: new Date(fetchedAt).toISOString(),
    };
    persistNseIpoFeed(nseIpoCache);
    return nseIpoCache;
  })();

  try {
    return await nseIpoRequest;
  } finally {
    nseIpoRequest = null;
  }
};

const refreshNseIpoFeedQuietly = async () => {
  try {
    await getNseIpoFeed();
  } catch (error) {
    console.error('Automatic NSE IPO refresh failed:', error.response?.status || error.message);
  }
};

const startNseIpoAutoRefresh = ({ intervalMs = NSE_IPO_AUTO_REFRESH_MS } = {}) => {
  loadPersistedNseIpoFeed();
  refreshNseIpoFeedQuietly();
  if (nseIpoAutoRefreshTimer) return;
  nseIpoAutoRefreshTimer = setInterval(refreshNseIpoFeedQuietly, intervalMs);
  nseIpoAutoRefreshTimer.unref?.();
};

const stopNseIpoAutoRefresh = () => {
  if (!nseIpoAutoRefreshTimer) return;
  clearInterval(nseIpoAutoRefreshTimer);
  nseIpoAutoRefreshTimer = null;
};

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
    logoUrl: [item.logo_url, item.logoUrl, item.logo].find((value) => typeof value === 'string' && value.trim()) || '',
    priceBand,
    minPrice: minimumPrice,
    cutOffPrice: Number(item.cut_off_price) || maximumPrice || minimumPrice || null,
    lotSize: Number(item.lot_size) || null,
    issueSize: item.issue_size != null && Number.isFinite(Number(item.issue_size))
      ? `₹${formatIpoAmount(item.issue_size)} Cr`
      : '—',
    minInvestment: minimumInvestment,
    minimumQuantity: Number(item.minimum_quantity) || null,
    faceValue: Number(item.face_value) || null,
    dailyStartTime: item.daily_start_time || '',
    dailyEndTime: item.daily_end_time || '',
    minimumPrice,
    maximumPrice,
    openDate: formatIpoDate(timeline.application_start_date || item.bidding_start_date),
    closeDate: formatIpoDate(timeline.application_end_date || item.bidding_end_date),
    applicationEndDateISO: timeline.application_end_date || item.bidding_end_date || '',
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
    companyOverview: item.company_overview || item.company_description || item.description || '',
    freshIssue: item.fresh_issue || item.fresh_issue_size || item.freshIssue || '',
    offerForSale: item.offer_for_sale || item.offer_for_sale_size || item.ofs || item.offerForSale || '',
    leadManagers: item.lead_managers || item.book_running_lead_managers || item.leadManager || [],
    competitors: item.competitors || item.comparable_companies || [],
    industryAnalysis: item.industry_analysis || '',
    review: item.ipo_review || item.review || '',
    expertAnalysis: item.expert_analysis || item.analyst_summary || '',
    rating: item.ipo_rating || item.rating || '',
    recommendation: item.recommendation || item.verdict || '',
    pros: item.pros || [],
    cons: item.cons || [],
    weaknesses: item.weaknesses || item.cons || [],
    listingPrice: item.listing_price ?? null,
    listingExchange: item.listing_exchange || '',
    prospectusUrl: item.rhp_url || '',
    draftProspectusUrl: item.drhp_url || '',
    registrar: item.registrar_info || null,
    investors: Array.isArray(item.investors) ? item.investors : [],
    financials: item.financials || item.company_financials || null,
    useOfProceeds: item.use_of_proceeds || item.objects_of_issue || item.issue_objectives || null,
    strengths: Array.isArray(item.strengths) ? item.strengths : Array.isArray(item.pros) ? item.pros : [],
    risks: Array.isArray(item.risks) ? item.risks : [],
    dailyBidTimings: item.daily_start_time && item.daily_end_time
      ? `${item.daily_start_time.slice(0, 5)}–${item.daily_end_time.slice(0, 5)} IST`
      : '',
    source: 'upstox',
    isLive: true,
  };
};

const getUpstoxIpoFeed = async (accessToken = process.env.UPSTOX_ACCESS_TOKEN) => {
  if (upstoxIpoCache && Date.now() - upstoxIpoCache.fetchedAt < UPSTOX_IPO_CACHE_TTL_MS) {
    return upstoxIpoCache;
  }
  if (upstoxIpoRequest) return upstoxIpoRequest;

  upstoxIpoRequest = (async () => {
    const token = accessToken;
    if (!token) throw new Error('UPSTOX_ACCESS_TOKEN is not configured.');

    const statusLists = await Promise.all(
      UPSTOX_IPO_STATUSES.map((status) => fetchUpstoxIposByStatus(status, token)),
    );

    const uniqueIpos = new Map();
    for (const [index, items] of statusLists.entries()) {
      for (const item of items) {
        if (item.id) uniqueIpos.set(item.id, mapUpstoxIpo(item, UPSTOX_IPO_STATUSES[index]));
      }
    }

    const allIpos = [...uniqueIpos.values()];
    const fetchedAt = Date.now();
    upstoxIpoCache = {
      data: getActiveIpos(allIpos),
      history: allIpos.filter((ipo) => ['closed', 'listed'].includes(String(ipo.status).toLowerCase())),
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

// Calendar events are proxied server-side so provider credentials never reach the browser.
app.get('/api/market/status', async (req, res) => {
  try {
    const status = await getNseMarketSession();
    res.set('Cache-Control', 'no-store');
    res.json(status);
  } catch (error) {
    res.status(503).json({
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
      isOpen: false,
      isTradingDay: null,
      isVerified: false,
      status: 'STATUS UNVERIFIED',
      subtext: error.message || 'Market status is unavailable.',
      badgeColor: 'closed',
      source: 'NSE/BSE India',
      indexStatus: {
        nifty50: { exchange: 'NSE', isVerified: false, status: 'STATUS UNVERIFIED' },
        sensex: { exchange: 'BSE', isVerified: false, status: 'STATUS UNVERIFIED' },
      },
      stale: false,
      lastUpdated: null,
    });
  }
});

app.get('/api/market/schedule', async (req, res) => {
  try {
    const status = await getNseMarketSession();
    res.set('Cache-Control', 'no-store');
    res.json({
      exchange: 'NSE & BSE',
      timezone: 'Asia/Kolkata (IST)',
      equity: {
        preOpen: {
          start: '09:00',
          end: '09:15',
          label: 'Pre-Open Session',
          subPhases: [
            { name: 'Order Entry & Modification', start: '09:00', end: '09:08' },
            { name: 'Order Matching & Discovery', start: '09:08', end: '09:12' },
            { name: 'Buffer / Transition', start: '09:12', end: '09:15' },
          ],
        },
        normal: { start: '09:15', end: '15:30', label: 'Continuous Trading Session' },
        closing: { start: '15:30', end: '15:40', label: 'Closing Price Calculation (30-min VWAP)' },
        postClose: { start: '15:40', end: '16:00', label: 'Post-Market Trading at Closing Price' },
      },
      derivatives: {
        normal: { start: '09:15', end: '15:30', label: 'Futures & Options Trading' },
      },
      commodity: {
        morning: { start: '09:00', end: '17:00', label: 'MCX Morning Session' },
        evening: { start: '17:00', end: '23:30', label: 'MCX Evening Session (Bullion, Metals, Energy)' },
      },
      today: status.todaySchedule,
      currentStatus: status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/holidays', async (req, res) => {
  try {
    const year = Number(req.query.year) || getISTParts(new Date()).year;
    const holidays = getHolidaysForYear(year);
    res.set('Cache-Control', 'no-store');
    res.json({
      year,
      count: holidays.length,
      holidays,
      source: 'NSE / BSE Official Holiday Calendar',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/special-sessions', (req, res) => {
  try {
    const db = getDatabase();
    seedOfficialMarketCalendar(db);
    const rows = db.prepare(`
      SELECT event_date AS date, name, exchange, segment, start_time AS startTime, end_time AS endTime, source_url AS sourceUrl
      FROM market_calendar_events
      WHERE event_type = 'special_session'
      ORDER BY event_date ASC
    `).all();
    res.set('Cache-Control', 'no-store');
    res.json({
      specialSessions: rows.map((r) => ({
        ...r,
        startTime: r.startTime ? String(r.startTime).slice(0, 5) : '18:15',
        endTime: r.endTime ? String(r.endTime).slice(0, 5) : '19:15',
      })),
      note: 'Officially announced special trading sessions override standard weekend and holiday schedules.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/market/special-sessions', (req, res) => {
  const { date, name, startTime, endTime, exchange = 'NSE', segment = 'CM' } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Valid date in YYYY-MM-DD format is required.' });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Session name is required.' });
  }
  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'startTime and endTime in HH:MM format are required.' });
  }

  try {
    const db = getDatabase();
    const fetchedAt = new Date().toISOString();
    const cleanStart = startTime.length === 5 ? `${startTime}:00` : startTime;
    const cleanEnd = endTime.length === 5 ? `${endTime}:00` : endTime;
    const sourceUrl = 'Exchange Special Trading Session Circular';

    db.transaction((tx) => {
      tx.run(
        `INSERT INTO market_calendar_events
          (exchange, segment, event_date, name, event_type, start_time, end_time, source_url, payload_json, fetched_at)
         VALUES (?, ?, ?, ?, 'special_session', ?, ?, ?, ?, ?)
         ON CONFLICT(exchange, segment, event_date, event_type, name) DO UPDATE SET
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           source_url = excluded.source_url,
           fetched_at = excluded.fetched_at`,
        exchange, segment, date, name.trim(), cleanStart, cleanEnd, sourceUrl, JSON.stringify(req.body), fetchedAt
      );
    });

    calendarCache.clear();
    latestNseMarketSession = null;
    publish('market.special_session_updated', { date, name, startTime, endTime, exchange, segment });

    res.json({
      success: true,
      message: `Special trading session '${name}' scheduled for ${date} (${startTime}–${endTime} IST). Market will open during these hours.`,
      session: { date, name, startTime, endTime, exchange, segment },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/market/special-sessions/:date', (req, res) => {
  const { date } = req.params;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Valid date in YYYY-MM-DD format is required.' });
  }

  try {
    const db = getDatabase();
    db.run("DELETE FROM market_calendar_events WHERE event_date = ? AND event_type = 'special_session'", date);
    calendarCache.clear();
    latestNseMarketSession = null;
    publish('market.special_session_deleted', { date });
    res.json({ success: true, message: `Special session for ${date} removed.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/market/sync-calendar', async (req, res) => {
  try {
    calendarCache.clear();
    latestNseMarketSession = null;
    const status = await getNseMarketSession();
    res.json({ success: true, message: 'Market calendar synchronized with official exchange data.', status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
      provider = 'NSE India';
      providerUrl = NSE_HOLIDAY_PAGE_URL;
      if (!expiryFeed.holidayDatesAvailable) {
        note = 'Expiry dates follow the published NSE monthly rule. A holiday feed was unavailable, so a holiday adjustment could not be verified.';
      } else if (stale) {
        note = 'Showing expiry dates calculated with the last successful NSE holiday feed; the latest holiday refresh failed.';
      } else {
        note = 'Rule-derived using the NSE monthly expiry schedule and official NSE holiday dates.';
      }
    } else if (kind === 'holidays') {
      const feed = await getFinanceNseHolidays(from, to, forceRefresh);
      events = feed.data.map((item, index) => normalizeCalendarEvent(kind, item, index)).filter(Boolean);
      lastUpdated = feed.lastUpdated;
      cacheMs = CALENDAR_FEEDS.holidays.cacheMs;
      stale = Boolean(feed.stale);
      provider = 'NSE India';
      providerUrl = NSE_HOLIDAY_PAGE_URL;
      note = 'NSE India closures from the official exchange holiday feed.';
      if (feed.missingYears?.length) {
        note += ` NSE has not published ${feed.missingYears.join(', ')} yet.`;
      }
      if (stale) note = 'Showing the last successful NSE holiday feed; its latest refresh failed.';
    } else if (kind === 'economic') {
      const feed = await getEconomicCalendarFeed(from, to, forceRefresh);
      events = feed.data.map((item, index) => normalizeCalendarEvent(kind, item, index)).filter(Boolean);
      lastUpdated = feed.lastUpdated;
      cacheMs = CALENDAR_FEEDS.economic.cacheMs;
      stale = Boolean(feed.stale);
      provider = feed.provider;
      providerUrl = feed.providerUrl;
      note = 'India economic releases and central-bank dates. Coverage varies by published source schedule.';
      if (stale) note = 'Showing the last successful economic calendar feed; its latest refresh failed.';
    } else {
      const feed = await getNseCorporateCalendarEvents(kind, from, to, forceRefresh);
      events = feed.events;
      lastUpdated = feed.lastUpdated;
      cacheMs = kind === 'ipos' ? NSE_IPO_CACHE_TTL_MS : NSE_CORPORATE_EVENT_CACHE_MS;
      stale = Boolean(feed.stale);
      provider = 'NSE India';
      providerUrl = {
        earnings: NSE_EVENTS_PAGE_URL,
        dividends: NSE_CORPORATE_ACTIONS_PAGE_URL,
        splits: NSE_CORPORATE_ACTIONS_PAGE_URL,
        ipos: NSE_IPO_PAGE_URL,
      }[kind];
      note = {
        earnings: 'Board meetings considering financial results, from the official NSE corporate filings feed.',
        dividends: 'Dividend and distribution corporate actions with ex-dates from official NSE filings.',
        splits: 'Stock splits and bonus issues from official NSE corporate actions.',
        ipos: 'Current and forthcoming mainboard and SME issues from the official NSE IPO feed.',
      }[kind];
      if (stale) note = 'Showing the last successful NSE feed; its latest refresh failed.';
    }

    const sortedEvents = events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    const totalEvents = sortedEvents.length;
    const visibleEvents = totalEvents > CALENDAR_MAX_EVENTS ? sortedEvents.slice(0, CALENDAR_MAX_EVENTS) : sortedEvents;
    if (totalEvents > visibleEvents.length) {
      note += ` Showing the first ${visibleEvents.length} of ${totalEvents} events in this range; narrow the dates to see the rest.`;
    }

    return res.json({
      kind,
      data: visibleEvents,
      count: totalEvents,
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
    if (error.code === 'calendar_api_key_required') {
      return res.status(503).json({
        error: 'The India economic calendar needs a provider API key. Add FINANCE_CALENDAR_API_KEY=your_key to share-market/.env, or use a valid FMP_API_KEY, then restart the server.',
        code: 'calendar_api_key_required',
        configured: false,
      });
    }
    console.error(`Calendar provider request failed (${kind}):`, error.response?.status || error.message);
    return res.status(502).json({
      error: kind === 'economic'
        ? 'Finance Calendar could not load this feed. Check the API key, then try again.'
        : 'NSE India could not load this feed. Please refresh in a moment.',
      code: 'calendar_provider_error',
      configured: kind !== 'economic' || Boolean(financeCalendarApiKey() || fmpApiKey()),
    });
  }
});

// GET /api/ipos - Provider-only open and upcoming IPO feed.
app.get('/api/ipos', async (req, res) => {
  try {
    const feed = await getNseIpoFeed();
    return res.json({
      success: true,
      count: feed.data.length,
      data: feed.data,
      history: feed.history,
      source: 'nse',
      live: true,
      configured: true,
      restoredFromDatabase: Boolean(feed.restoredFromDatabase),
      lastUpdated: feed.lastUpdated,
      refreshIntervalMs: NSE_IPO_CACHE_TTL_MS,
      autoRefresh: Boolean(nseIpoAutoRefreshTimer),
      autoRefreshIntervalMs: NSE_IPO_AUTO_REFRESH_MS,
      message: 'The server checks the free NSE India feed every 60 seconds and adds current and forthcoming issues automatically.',
    });
  } catch (error) {
    console.error('NSE IPO feed request failed:', error.response?.status || error.message);
    if (nseIpoCache) {
      const data = getActiveIpos(nseIpoCache.data).map((ipo) => ({ ...ipo, isLive: false, stale: true }));
      const history = nseIpoCache.history.map((ipo) => ({ ...ipo, isLive: false, stale: true }));
      if (data.length || history.length) {
        return res.json({
          success: true,
          count: data.length,
          data,
          history,
          source: 'nse',
          live: false,
          stale: true,
          configured: true,
          lastUpdated: nseIpoCache.lastUpdated,
          refreshIntervalMs: NSE_IPO_CACHE_TTL_MS,
          autoRefresh: Boolean(nseIpoAutoRefreshTimer),
          autoRefreshIntervalMs: NSE_IPO_AUTO_REFRESH_MS,
          message: 'The free NSE India IPO feed could not be refreshed. Showing the last successful NSE update while automatic retries continue.',
        });
      }
    }

    return res.json({
      success: true,
      count: 0,
      data: [],
      history: [],
      source: 'unavailable',
      live: false,
      configured: false,
      lastUpdated: new Date().toISOString(),
      message: 'The free NSE India IPO feed is unavailable right now. No sample listings are being shown.',
    });
  }
});

app.get('/api/ipo/orders', async (req, res) => {
  const token = userIpoToken(req);
  if (!token) return res.status(401).json({ error: 'Connect your Upstox account to view and track your IPO applications.', code: 'ipo_account_not_connected' });
  try {
    const getPage = (pageNumber) => axios.get(IPO_ORDER_API_URL, {
      params: { page_number: pageNumber, records: 30 },
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: 12_000,
    });
    const firstPage = await getPage(1);
    const totalPages = Math.max(1, Number(firstPage.data?.meta_data?.page?.total_pages) || 1);
    const rest = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => getPage(index + 2)));
    return res.json({
      data: [firstPage, ...rest].flatMap((response) => response.data?.data || []),
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Upstox IPO application list failed:', error.response?.status || error.message);
    return res.status(error.response?.status || 502).json({ error: 'Could not load your IPO applications from Upstox.', code: 'ipo_orders_unavailable' });
  }
});

// GET /api/ipo/:company - Upstox details or live NSE listing details.
app.get('/api/ipo/:company', async (req, res) => {
  const lookup = decodeURIComponent(req.params.company).toLowerCase();
  const accessToken = userIpoToken(req) || process.env.UPSTOX_ACCESS_TOKEN;
  const isNseIssue = lookup.startsWith('nse-');

  if (accessToken && !isNseIssue) {
    try {
      const feed = await getUpstoxIpoFeed(accessToken);
      const listedIpo = [...feed.data, ...(feed.history || [])].find((ipo) => (
        ipo.id?.toLowerCase() === lookup || ipo.company.toLowerCase() === lookup
      ));
      const ipoId = listedIpo?.id || (/^[a-z0-9-]{2,120}$/i.test(lookup) ? lookup : '');
      if (ipoId) {
        const response = await axios.get(`${UPSTOX_IPO_API_URL}/${encodeURIComponent(ipoId)}`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
          timeout: 12_000,
        });
        if (response.data?.status === 'success' && response.data?.data) {
          return res.json({
            ...mapUpstoxIpo(response.data.data),
            source: 'upstox',
            isLive: true,
            lastUpdate: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      console.error('Upstox IPO details request failed:', error.response?.status || error.message);
    }
  }

  try {
    const feed = await getNseIpoFeed();
    const nseLookup = lookup.replace(/^nse-/, '');
    const ipo = feed.data.find((item) => (
      item.id.toLowerCase() === lookup
      || item.symbol.toLowerCase() === nseLookup
      || item.company.toLowerCase() === lookup
    )) || (feed.history || []).find((item) => (
      item.id.toLowerCase() === lookup
      || item.symbol.toLowerCase() === nseLookup
      || item.company.toLowerCase() === lookup
    ));
    if (!ipo) return res.status(404).json({ error: 'IPO not found in the current, forthcoming, or listed NSE issue feeds.' });
    return res.json({ ...ipo, lastUpdate: feed.lastUpdated });
  } catch (error) {
    console.error('NSE IPO details request failed:', error.response?.status || error.message);
    return res.status(accessToken ? 502 : 503).json({
      error: 'Could not load this IPO from NSE India or Upstox.',
      code: 'ipo_details_unavailable',
    });
  }
});

const IPO_ORDER_API_URL = `${UPSTOX_IPO_API_URL}/orders`;
const IPO_AUTH_COOKIE = 'sharemarket_ipo_upstox_session';
const IPO_STATE_COOKIE = 'sharemarket_ipo_upstox_state';
const hasStrongIpoSessionSecret = () => Buffer.byteLength(process.env.IPO_SESSION_SECRET || '', 'utf8') >= 32;
const ipoSessionKey = () => hasStrongIpoSessionSecret()
  ? crypto.createHash('sha256').update(process.env.IPO_SESSION_SECRET).digest()
  : null;
const getRequestCookie = (req, name) => {
  const prefix = `${name}=`;
  const cookie = String(req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : '';
};
const appendCookie = (res, name, value, { maxAge = 0, httpOnly = true, path = '/api/ipo', secure = false } = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
};
const requestIsSecure = (req) => req.get('x-forwarded-proto') === 'https' || req.secure;
const clearIpoCookie = (req, res, name) => appendCookie(res, name, '', {
  maxAge: 0,
  path: name === IPO_STATE_COOKIE ? '/api/ipo/auth' : '/api/ipo',
  secure: requestIsSecure(req),
});
const sealIpoAccessToken = (token) => {
  const key = ipoSessionKey();
  if (!key) throw new Error('IPO_SESSION_SECRET is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((value) => value.toString('base64url')).join('.');
};
const unsealIpoAccessToken = (req) => {
  try {
    const key = ipoSessionKey();
    if (!key) return '';
    const [ivPart, tagPart, ciphertextPart] = getRequestCookie(req, IPO_AUTH_COOKIE).split('.');
    if (!ivPart || !tagPart || !ciphertextPart) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
};
const userIpoToken = (req) => unsealIpoAccessToken(req);
const safeReturnPath = (value) => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
  ? value.slice(0, 500)
  : '/ipo';
const verifyIpoOAuthState = (storedValue, state) => {
  const [storedState, returnEncoded, signature] = storedValue.split('.');
  const secret = process.env.IPO_SESSION_SECRET;
  if (!secret || !storedState || !returnEncoded || !signature || storedState !== state) return null;
  const payload = `${storedState}.${returnEncoded}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    return safeReturnPath(Buffer.from(returnEncoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};
const ipoOAuthIsConfigured = () => Boolean(
  process.env.UPSTOX_CLIENT_ID
  && process.env.UPSTOX_CLIENT_SECRET
  && process.env.UPSTOX_REDIRECT_URI
  && hasStrongIpoSessionSecret(),
);
const requireSameOrigin = (req, res) => {
  const source = req.get('origin') || req.get('referer');
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!source || !host) {
    res.status(403).json({ error: 'The request origin could not be verified.', code: 'invalid_request_origin' });
    return false;
  }
  try {
    if (new URL(source).host !== host) throw new Error('origin mismatch');
  } catch {
    res.status(403).json({ error: 'The request origin could not be verified.', code: 'invalid_request_origin' });
    return false;
  }
  return true;
};

app.get('/api/ipo/auth/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ configured: ipoOAuthIsConfigured(), connected: Boolean(userIpoToken(req)) });
});

app.get('/api/ipo/auth/connect', (req, res) => {
  if (!ipoOAuthIsConfigured()) {
    return res.status(503).json({
      error: 'Configure UPSTOX_CLIENT_ID, UPSTOX_CLIENT_SECRET, UPSTOX_REDIRECT_URI, and IPO_SESSION_SECRET on the server to enable secure broker login.',
      code: 'ipo_oauth_not_configured',
    });
  }
  const redirectUri = new URL(process.env.UPSTOX_REDIRECT_URI);
  const returnTo = safeReturnPath(String(req.query.return_to || '/ipo'));
  const state = crypto.randomBytes(24).toString('hex');
  const returnEncoded = Buffer.from(returnTo).toString('base64url');
  const payload = `${state}.${returnEncoded}`;
  const signature = crypto.createHmac('sha256', process.env.IPO_SESSION_SECRET).update(payload).digest('base64url');
  appendCookie(res, IPO_STATE_COOKIE, `${payload}.${signature}`, {
    maxAge: 600,
    path: '/api/ipo/auth',
    secure: requestIsSecure(req),
  });
  const login = new URL('https://api.upstox.com/v2/login/authorization/dialog');
  login.searchParams.set('response_type', 'code');
  login.searchParams.set('client_id', process.env.UPSTOX_CLIENT_ID);
  login.searchParams.set('redirect_uri', redirectUri.toString());
  login.searchParams.set('state', state);
  return res.redirect(302, login.toString());
});

app.get('/api/ipo/auth/callback', async (req, res) => {
  const returnTo = verifyIpoOAuthState(getRequestCookie(req, IPO_STATE_COOKIE), String(req.query.state || ''));
  clearIpoCookie(req, res, IPO_STATE_COOKIE);
  const redirectUri = process.env.UPSTOX_REDIRECT_URI;
  if (!returnTo || !ipoOAuthIsConfigured() || !redirectUri) {
    return res.status(400).send('Upstox login could not be verified. Return to the IPO page and connect again.');
  }
  if (req.query.error || !req.query.code) {
    const failure = new URL(returnTo, new URL(redirectUri).origin);
    failure.searchParams.set('ipo_auth', 'failed');
    return res.redirect(302, failure.toString());
  }

  try {
    const tokenResponse = await axios.post(
      'https://api.upstox.com/v2/login/authorization/token',
      new URLSearchParams({
        code: String(req.query.code),
        client_id: process.env.UPSTOX_CLIENT_ID,
        client_secret: process.env.UPSTOX_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
      { headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12_000 },
    );
    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) throw new Error('Upstox did not return an access token.');
    appendCookie(res, IPO_AUTH_COOKIE, sealIpoAccessToken(accessToken), {
      maxAge: 8 * 60 * 60,
      secure: requestIsSecure(req),
    });
    const destination = new URL(returnTo, new URL(redirectUri).origin);
    destination.searchParams.set('ipo_auth', 'connected');
    return res.redirect(302, destination.toString());
  } catch (error) {
    console.error('Upstox IPO authorization failed:', error.response?.status || error.message);
    const destination = new URL(returnTo, new URL(redirectUri).origin);
    destination.searchParams.set('ipo_auth', 'failed');
    return res.redirect(302, destination.toString());
  }
});

app.post('/api/ipo/auth/logout', (req, res) => {
  if (!requireSameOrigin(req, res)) return;
  clearIpoCookie(req, res, IPO_AUTH_COOKIE);
  res.json({ connected: false });
});

// Submits only after the logged-in user confirms their bid; the broker token stays in an encrypted HttpOnly cookie.
app.post('/api/ipo/apply', async (req, res) => {
  if (!requireSameOrigin(req, res)) return;
  const token = userIpoToken(req);
  if (!token) return res.status(401).json({ error: 'Connect your Upstox account before applying.', code: 'ipo_account_not_connected' });

  const { id, upi, category = 'IND', lots = 1, price } = req.body || {};
  if (typeof id !== 'string' || !/^[a-z0-9-]{2,120}$/i.test(id)) {
    return res.status(400).json({ error: 'Select a valid IPO from the live feed.', code: 'invalid_ipo_id' });
  }
  if (typeof upi !== 'string' || !/^[\w.-]{2,256}@[\w.-]{2,64}$/.test(upi.trim())) {
    return res.status(400).json({ error: 'Enter a valid UPI ID.', code: 'invalid_upi' });
  }
  if (!['IND', 'HNI'].includes(category)) {
    return res.status(400).json({ error: 'Choose Individual or HNI investor category.', code: 'invalid_ipo_category' });
  }
  const lotCount = Number(lots);
  const bidPrice = Number(price);
  if (!Number.isInteger(lotCount) || lotCount < 1 || lotCount > 100 || !Number.isFinite(bidPrice)) {
    return res.status(400).json({ error: 'Enter a valid lot count and bid price.', code: 'invalid_ipo_bid' });
  }

  try {
    const detailsResponse = await axios.get(`${UPSTOX_IPO_API_URL}/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      timeout: 12_000,
    });
    const details = detailsResponse.data?.data;
    if (!details || detailsResponse.data?.status !== 'success') throw new Error('Upstox returned invalid IPO details.');
    if (String(details.status).toLowerCase() !== 'open'
      || hasIpoApplicationEnded(mapUpstoxIpo(details, 'open'))) {
      return res.status(409).json({ error: 'This IPO is no longer open for applications.', code: 'ipo_not_open' });
    }
    const quantity = Number(details.lot_size) * lotCount;
    const minimumQuantity = Number(details.minimum_quantity) || Number(details.lot_size);
    const minimumPrice = Number(details.minimum_price);
    const maximumPrice = Number(details.maximum_price);
    const cutOffPrice = Number(details.cut_off_price);
    const quantityValid = quantity >= minimumQuantity && quantity % Number(details.lot_size) === 0;
    const priceValid = (bidPrice >= minimumPrice && bidPrice <= maximumPrice)
      || (cutOffPrice > 0 && bidPrice === cutOffPrice);
    if (!quantityValid || !priceValid) {
      return res.status(400).json({
        error: `Bid does not match current issue rules. Quantity must be at least ${minimumQuantity}; price must be ₹${minimumPrice}–₹${maximumPrice}${cutOffPrice ? ` or cut-off ₹${cutOffPrice}` : ''}.`,
        code: 'ipo_bid_outside_issue_rules',
      });
    }
    if (Array.isArray(details.investors) && details.investors.length
      && !details.investors.some((investor) => String(investor.category).toUpperCase() === category)) {
      return res.status(400).json({ error: 'This issue does not offer the selected investor category.', code: 'ipo_category_not_supported' });
    }

    const response = await axios.post(IPO_ORDER_API_URL, {
      id,
      upi: upi.trim(),
      category,
      bids: [{ quantity, price: bidPrice }],
    }, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 15_000,
    });
    const orderId = response.data?.data?.order_id;
    if (response.data?.status !== 'success' || !orderId) {
      return res.status(502).json({ error: response.data?.message || 'Upstox did not confirm the IPO application.', code: 'ipo_application_unconfirmed' });
    }
    return res.json({
      success: true,
      orderId,
      quantity,
      bidPrice,
      amount: quantity * bidPrice,
      message: 'Application submitted to Upstox. Approve the UPI mandate in your UPI app to block funds and complete it.',
    });
  } catch (error) {
    console.error('Upstox IPO application failed:', error.response?.status || error.message);
    return res.status(error.response?.status || 502).json({
      error: error.response?.data?.errors?.[0]?.message || 'Upstox could not submit this IPO application.',
      code: 'ipo_application_failed',
    });
  }
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

const getAutoTradeQuotes = async (symbols) => {
  const clean = [...new Set(symbols.map((symbol) => toProviderSymbol(symbol))
    .filter((symbol) => /^[A-Z0-9&.\-]{1,20}$/.test(symbol)))].slice(0, 40);
  const quotes = {};
  if (!clean.length) return quotes;
  const metalSymbols = clean.filter((symbol) => symbol === 'GOLD' || symbol === 'SILVER');
  const equitySymbols = clean.filter((symbol) => !metalSymbols.includes(symbol));
  if (metalSymbols.length) {
    await Promise.all(metalSymbols.map(async (symbol) => {
      try {
        const quote = await getMetalQuote(symbol);
        if (Number(quote?.c) > 0) quotes[symbol] = quote;
      } catch (error) {
        console.warn(`Metal alert quote lookup failed for ${symbol}:`, error.message);
      }
    }));
  }
  if (!equitySymbols.length) return quotes;
  const provider = getMarketProvider();
  if (isLiveMarketProviderConfigured(provider)) {
    try {
      if (provider === 'kun') Object.assign(quotes, await getKunQuotes(equitySymbols));
      else if (provider === 'upstox') Object.assign(quotes, await getUpstoxBatchQuotes(equitySymbols));
      else if (provider === 'groww') Object.assign(quotes, await getGrowwBatchQuotes(equitySymbols));
      else {
        await Promise.all(equitySymbols.map(async (symbol) => {
          try {
            const quote = await getProviderQuote(provider, symbol);
            if (Number(quote?.c) > 0) quotes[symbol] = quote;
          } catch {
            // Leave the symbol to the research fallback below.
          }
        }));
      }
    } catch (error) {
      console.warn('Auto-trade live quote batch failed:', error.message);
    }
  }
  const missing = equitySymbols.filter((symbol) => !(Number(quotes[symbol]?.c) > 0));
  if (missing.length) {
    try {
      const researchQuotes = await getYahooResearchQuotes(missing);
      for (const [symbol, quote] of Object.entries(researchQuotes)) {
        if (!(Number(quotes[symbol]?.c) > 0)) quotes[symbol] = quote;
      }
    } catch (error) {
      console.warn('Auto-trade research quote fallback failed:', error.message);
    }
  }
  return quotes;
};

const toDateStamp = (timestampSeconds) => new Date(timestampSeconds * 1000).toISOString().slice(0, 10);

const getAutoTradeDailyCandles = async (symbol) => {
  const clean = toProviderSymbol(symbol);
  if (!/^[A-Z0-9&.\-]{1,20}$/.test(clean)) return null;
  const to = Math.floor(Date.now() / 1000);
  const from = to - 420 * 24 * 60 * 60;
  const payload = await getYahooResearchHistory({
    symbol: clean,
    exchange: 'NSE',
    resolution: '1d',
    from,
    to,
    start: toDateStamp(from),
    end: toDateStamp(to + 24 * 60 * 60),
  });
  return payload?.candles || null;
};

const getAutoTradeBrokerStatus = () => {
  const provider = getMarketProvider();
  const adapters = listAdapters().map((adapter) => {
    const config = adapter.config();
    return {
      id: adapter.id,
      name: adapter.name,
      configured: config.configured,
      mode: config.mode,
      missing: config.missing || [],
    };
  });
  const routable = adapters.filter((adapter) => adapter.configured && adapter.mode !== 'paper');
  const masterEnabled = liveTradingMasterEnabled();
  return {
    marketDataProvider: isLiveMarketProviderConfigured(provider) ? provider : null,
    quoteProviders: Object.fromEntries(adapters.map((adapter) => [adapter.id, adapter.configured])),
    adapters,
    orderRouting: {
      configured: routable.length > 0,
      enabled: masterEnabled && routable.length > 0,
      provider: routable[0]?.id || null,
      liveFlagRequested: masterEnabled,
      reason: masterEnabled
        ? routable.length
          ? `Live routing is available for ${routable.map((adapter) => adapter.id).join(', ')}. Every account still needs a connected broker session and per-account live consent.`
          : 'LIVE_TRADING_ENABLED=1 is set, but no broker API credentials are configured for live routing.'
        : 'LIVE_TRADING_ENABLED is not set. The AI engine stays paper-only until the server flag, a connected broker account and per-account consent are all in place.',
    },
    instruments: instrumentStatus(),
    checkedAt: new Date().toISOString(),
  };
};

const explainAutoTradeSignal = async ({ signal, account }) => {
  if (!getLLMConfig()) return null;
  const positions = account.positions.slice(0, 4)
    .map((position) => `${position.symbol} ${position.qty}@₹${position.entryPrice}`)
    .join(', ') || 'none';
  const message = [
    `Explain this paper-trading signal for ${signal.symbol} in under 90 words, using only these computed numbers:`,
    `score ${signal.score}/100 (${signal.action}), price ₹${signal.price}, SMA20 ₹${signal.sma20}, SMA50 ₹${signal.sma50}, RSI ${signal.rsi14}, 20-day momentum ${signal.momentum20Percent}%, volatility ${signal.volatility20Percent}%, trend ${signal.trend}.`,
    `Open paper positions: ${positions}. State that this is a rules-based read of delayed data, not a prediction or investment advice.`,
  ].join(' ');
  const result = await answerCopilot({ message, context: {} });
  return { reply: result?.reply || null, provider: result?.provider || 'ShareMarket AI Copilot' };
};

const probeResearchFeed = async () => {
  const startedAt = Date.now();
  const quotes = await getPaperQuotes(['RELIANCE']);
  const quote = quotes?.RELIANCE;
  if (!(Number(quote?.c) > 0)) {
    throw new Error('No usable quote was returned by the configured live or delayed research feed.');
  }
  return { latencyMs: Date.now() - startedAt, basis: quote.isLive === true ? 'live' : 'delayed' };
};

const autoTrade = initAutoTrade(app, {
  readSessionUser,
  quoteBatch: getAutoTradeQuotes,
  getMarketNewsFeed,
  getMarketSession: getNseMarketSession,
  getMarketSessionSnapshot: getNseMarketSessionSnapshot,
  automationSchedulerAvailable: () => process.env.VERCEL !== '1' && process.env.VERCEL_FUNCTIONS !== '1',
  getDailyCandles: getAutoTradeDailyCandles,
  getBrokerStatus: getAutoTradeBrokerStatus,
  explainSignal: explainAutoTradeSignal,
  aiConfigured: () => Boolean(getLLMConfig()),
});
if (process.env.VERCEL !== '1' && process.env.VERCEL_FUNCTIONS !== '1') autoTrade.start();
if (listAdapters().some((adapter) => adapter.config().configured)) ensureInstrumentCache();

registerAuthRoutes(app);
registerBrokerRoutes(app, { getMarketSession: getNseMarketSession });
registerNotificationRoutes(app);
registerMetalTradingRoutes(app, { getQuote: getMetalQuote });
registerFnoRoutes(app, {
  cacheDir: path.join(DATA_DIR, 'fno-cache'),
  live: createFnoLiveService(),
});
registerComplianceRoutes(app);
registerCoreRoutes(app);
registerAdminRoutes(app);
registerForecastRoutes(app, { getDailyCandles: getAutoTradeDailyCandles });
registerMutualFundRoutes(app);
export default app;

if (process.env.VERCEL !== '1' && process.env.VERCEL_FUNCTIONS !== '1') {
const stopMetalPaperMatcher = startMetalPaperOrderMatcher({ getQuote: getMetalQuote });
app.get('/api/mutual-funds/schemes', async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 12));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const key = `schemes:${limit}:${offset}`;
  try {
    const payload = await fetchMutualFundPayload(key, '/mf', { limit, offset }, 30 * 60 * 1000);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: 'The mutual fund NAV provider is unavailable right now.', code: 'mutual_fund_provider_unavailable' });
  }
});

app.get('/api/mutual-funds/search', async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 80);
  if (query.length < 2) return res.status(400).json({ error: 'Enter at least two characters to search.', code: 'query_too_short' });
  const key = `search:${query.toLowerCase()}`;
  try {
    const payload = await fetchMutualFundPayload(key, '/mf/search', { q: query }, 15 * 60 * 1000);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: 'The mutual fund search provider is unavailable right now.', code: 'mutual_fund_provider_unavailable' });
  }
});

app.get('/api/mutual-funds/:schemeCode/latest', async (req, res) => {
  const schemeCode = String(req.params.schemeCode || '');
  if (!/^\d{1,12}$/.test(schemeCode)) return res.status(400).json({ error: 'Invalid mutual fund scheme code.', code: 'invalid_scheme_code' });
  const forceRefresh = req.query.refresh === '1';
  try {
    const payload = await fetchMutualFundPayload(`latest:${schemeCode}`, `/mf/${schemeCode}/latest`, {}, 2 * 60 * 1000, forceRefresh);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (error) {
    res.status(error.response?.status === 404 ? 404 : 502).json({ error: error.response?.status === 404 ? 'Scheme not found.' : 'The mutual fund NAV provider is unavailable right now.', code: error.response?.status === 404 ? 'scheme_not_found' : 'mutual_fund_provider_unavailable' });
  }
});

app.get('/api/mutual-funds/:schemeCode/nav', async (req, res) => {
  const schemeCode = String(req.params.schemeCode || '');
  if (!/^\d{1,12}$/.test(schemeCode)) return res.status(400).json({ error: 'Invalid mutual fund scheme code.', code: 'invalid_scheme_code' });
  const startDate = String(req.query.startDate || '');
  const params = startDate ? { startDate } : {};
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return res.status(400).json({ error: 'Use a YYYY-MM-DD start date.', code: 'invalid_start_date' });
  const key = `nav:${schemeCode}:${startDate || 'max'}`;
  try {
    const payload = await fetchMutualFundPayload(key, `/mf/${schemeCode}`, params, 10 * 60 * 1000);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (error) {
    res.status(error.response?.status === 404 ? 404 : 502).json({ error: error.response?.status === 404 ? 'Scheme not found.' : 'The mutual fund NAV provider is unavailable right now.', code: error.response?.status === 404 ? 'scheme_not_found' : 'mutual_fund_provider_unavailable' });
  }
});

const DIST_DIR = path.join(process.cwd(), 'dist');
if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  console.warn('No production build found in dist/. Run "npm run build" before starting this server.');
}

const server = app.listen(PORT, () => {
    console.log(`ShareMarket server listening on http://localhost:${PORT}`);
    attachCoreWebSocket(server, { path: '/ws/core', authenticate: (request) => readSessionUser(request) });
    startHealthMonitor({ intervalMs: 30_000 });
    startRecoveryMonitor({ probe: probeResearchFeed });
    startNseIpoAutoRefresh();
  });

  const shutdown = () => {
    stopHealthMonitor();
    stopRecoveryMonitor();
    stopNseIpoAutoRefresh();
    stopMetalPaperMatcher();
    closeCoreRealtime();
    closeKunDataConnection();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
