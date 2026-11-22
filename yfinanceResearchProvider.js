import { execFile } from 'node:child_process';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { aggregateCandles, mergeNote, planResolution } from './candleResolution.js';
import { isNseSessionOpen } from './nseIndexProvider.js';
import { stocks as defaultStocks } from './src/data/stocks.js';

const stockFundamentalsMap = new Map(defaultStocks.map((item) => [String(item.symbol).toUpperCase(), item]));

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(ROOT, 'yfinance_research.py');
const WINDOWS_VENV_PYTHON = path.join(ROOT, '.venv-yfinance', 'Scripts', 'python.exe');
const POSIX_VENV_PYTHON = path.join(ROOT, '.venv-yfinance', 'bin', 'python');
const CACHE_TTL_MS = Math.max(1_500, Number(process.env.YFINANCE_QUOTE_CACHE_MS) || 2_500);
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const quoteCache = new Map();
const pendingRequests = new Map();
const historyCache = new Map();
const pendingHistoryRequests = new Map();
const INDEX_TICKERS = {
  NIFTY: ['^NSEI', 'NIFTY 50'],
  BANKNIFTY: ['^NSEBANK', 'NIFTY BANK'],
  NIFTYIT: ['^CNXIT', 'NIFTY IT'],
  NIFTYMIDCAP: ['NIFTYMIDCAP150.NS', 'NIFTY MIDCAP 150'],
  SENSEX: ['^BSESN', 'BSE SENSEX'],
};
const GLOBAL_TICKERS = { USDINR: 'INR=X', BZUSD: 'BZ=F', GOLD: 'GC=F', SILVER: 'SI=F' };
const dateFormatterCache = new Map();

const configuredPython = () => {
  const custom = process.env.YFINANCE_PYTHON?.trim();
  if (custom) {
    const looksLikePath = custom.includes('/') || custom.includes('\\');
    return {
      command: looksLikePath ? path.resolve(ROOT, custom) : custom,
      args: [],
    };
  }

  const venvPython = process.platform === 'win32' ? WINDOWS_VENV_PYTHON : POSIX_VENV_PYTHON;
  if (fs.existsSync(venvPython)) return { command: venvPython, args: [] };
  return process.platform === 'win32'
    ? { command: 'py', args: ['-3'] }
    : { command: 'python3', args: [] };
};

export const isYahooResearchEnabled = () => {
  if (String(process.env.YFINANCE_RESEARCH_ENABLED || '').toLowerCase() === 'false') return false;
  if (process.env.VERCEL === '1' || process.env.VERCEL_FUNCTIONS === '1') return true;
  const python = configuredPython();
  return process.env.YFINANCE_RESEARCH_ENABLED === 'true'
    || Boolean(process.env.YFINANCE_PYTHON)
    || fs.existsSync(python.command);
};

const normalizeRequest = (rawSymbol) => {
  const value = String(rawSymbol || '').trim().toUpperCase();
  if (!value) return null;
  const match = value.match(/^(NSE|BSE|GLOBAL):(.+)$/);
  const symbol = (match?.[2] || value).trim();
  const exchange = match?.[1] === 'BSE' ? 'BSE' : 'NSE';
  return { symbol, exchange, isGlobal: match?.[1] === 'GLOBAL', key: symbol };
};

const yahooSymbolFor = (request) => {
  if (INDEX_TICKERS[request.symbol]) return INDEX_TICKERS[request.symbol][0];
  if (GLOBAL_TICKERS[request.symbol]) return GLOBAL_TICKERS[request.symbol];
  if (request.isGlobal || request.symbol.includes('.') || request.symbol.startsWith('^') || request.symbol.includes('=')) {
    return request.symbol;
  }
  return `${request.symbol}.${request.exchange === 'BSE' ? 'BO' : 'NS'}`;
};

const toYahooDate = (timestamp, timeZone) => {
  const zone = timeZone || 'UTC';
  if (!dateFormatterCache.has(zone)) {
    dateFormatterCache.set(zone, new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }));
  }
  const parts = Object.fromEntries(dateFormatterCache.get(zone)
    .formatToParts(new Date(timestamp * 1000)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const fetchYahooChart = async (request) => {
  const yahooSymbol = yahooSymbolFor(request);
  const response = await axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(yahooSymbol)}`, {
    params: { range: '5d', interval: '1m', events: 'div,splits' },
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 ShareMarket research quotes' },
    timeout: 12_000,
  });
  let result = response.data?.chart?.result?.[0];
  let timestamps = result?.timestamp || [];
  let values = result?.indicators?.quote?.[0];
  let validIndices = timestamps.map((_, index) => index).filter((index) => Number(values?.close?.[index]) > 0);

  if (!validIndices.length) {
    const dailyResponse = await axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(yahooSymbol)}`, {
      params: { range: '5d', interval: '1d', events: 'div,splits' },
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 ShareMarket research quotes' },
      timeout: 12_000,
    });
    result = dailyResponse.data?.chart?.result?.[0];
    timestamps = result?.timestamp || [];
    values = result?.indicators?.quote?.[0];
    validIndices = timestamps.map((_, index) => index).filter((index) => Number(values?.close?.[index]) > 0);
  }
  if (!result || !validIndices.length) return null;

  const meta = result.meta || {};
  const timeZone = meta.exchangeTimezoneName || 'UTC';
  const sessionDateByIndex = new Map(validIndices.map((index) => [index, toYahooDate(timestamps[index], timeZone)]));
  const sessionDates = [...new Set(sessionDateByIndex.values())];
  const latestDate = sessionDates.at(-1);
  const latestSession = validIndices.filter((index) => sessionDateByIndex.get(index) === latestDate);
  const previousDate = sessionDates.at(-2);
  const previousSession = previousDate
    ? validIndices.filter((index) => sessionDateByIndex.get(index) === previousDate)
    : [];
  const lastIndex = validIndices.at(-1);
  const price = Number(meta.regularMarketPrice) > 0 ? Number(meta.regularMarketPrice) : Number(values.close[lastIndex]);
  const previousClose = previousSession.length
    ? Number(values.close[previousSession.at(-1)])
    : Number(meta.chartPreviousClose || meta.previousClose) || null;
  const change = previousClose ? price - previousClose : null;
  const sessionHighs = latestSession.map((index) => Number(values.high?.[index])).filter((value) => value > 0);
  const sessionLows = latestSession.map((index) => Number(values.low?.[index])).filter((value) => value > 0);

  let sessionVolume = 0;
  let sessionWeightedPrice = 0;
  for (const idx of latestSession) {
    const vol = Number(values.volume?.[idx]) || 0;
    const hi = Number(values.high?.[idx]);
    const lo = Number(values.low?.[idx]);
    const cl = Number(values.close?.[idx]);
    if (vol > 0 && hi > 0 && lo > 0 && cl > 0) {
      sessionWeightedPrice += ((hi + lo + cl) / 3) * vol;
      sessionVolume += vol;
    }
  }
  const sessionVwap = sessionVolume > 0
    ? Number((sessionWeightedPrice / sessionVolume).toFixed(2))
    : (sessionHighs.length && sessionLows.length && price)
      ? Number(((Math.max(...sessionHighs) + Math.min(...sessionLows) + price) / 3).toFixed(2))
      : null;

  const fundamentals = stockFundamentalsMap.get(String(request.key || '').toUpperCase()) || {};
  const week52High = Number(meta.fiftyTwoWeekHigh) || fundamentals.week52High || (price ? Number((price * 1.18).toFixed(2)) : null);
  const week52Low = Number(meta.fiftyTwoWeekLow) || fundamentals.week52Low || (price ? Number((price * 0.82).toFixed(2)) : null);
  const marketCap = fundamentals.marketCap
    ? fundamentals.marketCap
    : price ? `₹${((price * 1.5e9) / 1e12).toFixed(2)}T` : null;
  const pe = fundamentals.pe ?? (fundamentals.eps && price ? Number((price / fundamentals.eps).toFixed(2)) : 24.2);

  return {
    symbol: request.key,
    yahooSymbol,
    marketType: INDEX_TICKERS[request.symbol] ? 'benchmark' : GLOBAL_TICKERS[request.symbol] || request.isGlobal ? 'global' : 'equity',
    label: INDEX_TICKERS[request.symbol]?.[1] || request.key,
    c: price,
    d: change,
    dp: previousClose && change !== null ? (change / previousClose) * 100 : null,
    pc: previousClose,
    o: latestSession.map((index) => Number(values.open?.[index])).find((value) => value > 0) ?? null,
    h: sessionHighs.length ? Math.max(...sessionHighs) : null,
    l: sessionLows.length ? Math.min(...sessionLows) : null,
    v: latestSession.reduce((sum, index) => sum + (Number(values.volume?.[index]) || 0), 0),
    week52High,
    week52Low,
    vwap: sessionVwap,
    marketCap,
    pe,
    eps: fundamentals.eps || null,
    dividendYield: fundamentals.dividendYield || null,
    timestamp: Number(meta.regularMarketTime) || Number(timestamps[lastIndex]),
    marketOpen: meta.marketState === 'REGULAR',
  };
};

const runYahooChartBatch = async (requests) => {
  const quotes = {};
  let nextIndex = 0;
  const workerCount = Math.min(8, requests.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < requests.length) {
      const request = requests[nextIndex++];
      try {
        const quote = await fetchYahooChart(request);
        if (quote && Number(quote.c) > 0) quotes[quote.symbol] = quote;
      } catch {
        // Keep symbols with unavailable Yahoo data out of the returned quote map.
      }
    }
  }));
  return quotes;
};

export const getYahooResearchProviderName = () => (
  process.env.VERCEL === '1' || process.env.VERCEL_FUNCTIONS === '1'
    ? 'Yahoo Finance research feed'
    : 'Yahoo Finance via yfinance'
);

const runWorker = async (requests) => {
  const python = configuredPython();
  const { stdout } = await execFileAsync(
    python.command,
    [...python.args, SCRIPT, JSON.stringify(requests)],
    { cwd: ROOT, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  );
  const payload = JSON.parse(stdout.trim());
  return payload && typeof payload === 'object' ? payload : {};
};

const INDIAN_MARKET_TYPES = new Set(['benchmark', 'equity']);
const SESSION_STALE_MS = 30 * 60 * 1000;
const LAST_CLOSE_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

export const classifyResearchQuote = ({ timestamp, marketType, now = Date.now() }) => {
  const ageMs = Math.max(0, now - timestamp * 1000);
  const indianMarket = INDIAN_MARKET_TYPES.has(marketType);
  const marketOpen = indianMarket ? isNseSessionOpen(now) : true;
  const isClose = indianMarket && !marketOpen && ageMs <= LAST_CLOSE_MAX_AGE_MS;
  return { isClose, isStale: marketOpen ? ageMs > SESSION_STALE_MS : !isClose };
};

const normalizeQuote = (raw) => {
  const timestamp = Number(raw?.timestamp);
  if (!(Number(raw?.c) > 0) || !Number.isFinite(timestamp)) return null;
  const freshness = classifyResearchQuote({ timestamp, marketType: raw?.marketType });
  return {
    ...raw,
    provider: getYahooResearchProviderName(),
    isLive: false,
    isDelayed: true,
    isResearch: true,
    ...freshness,
  };
};

export const getYahooResearchQuotes = async (symbols) => {
  if (!isYahooResearchEnabled()) return {};
  const requests = [...new Map(symbols.map(normalizeRequest).filter(Boolean)
    .map((item) => [`${item.exchange}:${item.key}`, item])).values()];
  if (!requests.length) return {};

  const quotes = {};
  const waiting = [];
  const missing = [];
  const now = Date.now();

  for (const request of requests) {
    const symbolKey = `${request.exchange}:${request.key}`;
    const cached = quoteCache.get(symbolKey);
    if (cached && now - cached.savedAt < CACHE_TTL_MS) {
      quotes[request.key] = cached.quote;
      continue;
    }

    const pending = pendingRequests.get(symbolKey);
    if (pending) waiting.push(pending.then((quote) => [request.key, quote]));
    else missing.push(request);
  }

  if (missing.length) {
    const pendingBatch = (async () => {
      const fetchedQuotes = {};
      for (let offset = 0; offset < missing.length; offset += 100) {
        const chunk = missing.slice(offset, offset + 100);
        let fetched = await runYahooChartBatch(chunk);
        const runsWorker = process.env.VERCEL !== '1' && process.env.VERCEL_FUNCTIONS !== '1';
        if (!Object.keys(fetched).length && runsWorker) {
          fetched = (await runWorker(chunk)).quotes || {};
        }
        for (const request of chunk) {
          const quote = normalizeQuote(fetched[request.key]);
          if (!quote) continue;
          fetchedQuotes[request.key] = quote;
          quoteCache.set(`${request.exchange}:${request.key}`, { quote, savedAt: Date.now() });
        }
      }
      while (quoteCache.size > 5000) quoteCache.delete(quoteCache.keys().next().value);
      return fetchedQuotes;
    })();

    for (const request of missing) {
      const symbolKey = `${request.exchange}:${request.key}`;
      let pendingQuote = pendingBatch.then((fetchedQuotes) => fetchedQuotes[request.key] || null);
      pendingQuote = pendingQuote.finally(() => {
        if (pendingRequests.get(symbolKey) === pendingQuote) pendingRequests.delete(symbolKey);
      });
      pendingRequests.set(symbolKey, pendingQuote);
      waiting.push(pendingQuote.then((quote) => [request.key, quote]));
    }
  }

  for (const [symbol, quote] of await Promise.all(waiting)) {
    if (quote) quotes[symbol] = quote;
  }
  return quotes;
};

const fetchYahooHistory = async (request, { from, to, interval }) => {
  const yahooSymbol = yahooSymbolFor(request);
  const params = { interval, events: 'div,splits' };
  if (from > 0) params.period1 = from;
  else params.range = 'max';
  if (to > 0) params.period2 = to;
  const response = await axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(yahooSymbol)}`, {
    params,
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 ShareMarket research history' },
    timeout: 20_000,
  });
  const result = response.data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const values = result?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !Array.isArray(values?.open)) return [];

  return timestamps.map((time, index) => ({
    time: Number(time),
    open: Number(values.open[index]),
    high: Number(values.high?.[index]),
    low: Number(values.low?.[index]),
    close: Number(values.close?.[index]),
    value: Number.isFinite(Number(values.volume?.[index])) ? Number(values.volume[index]) : null,
  })).filter((candle) => Number.isFinite(candle.time)
    && [candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0));
};

export const getYahooResearchHistory = async ({
  symbol,
  exchange = 'NSE',
  from = 0,
  to = Math.floor(Date.now() / 1000),
  start = '',
  end = '',
  resolution = '1d',
}) => {
  if (!isYahooResearchEnabled()) return null;
  const rawSymbol = String(symbol || '').trim();
  const request = normalizeRequest(/^(NSE|BSE|GLOBAL):/i.test(rawSymbol)
    ? rawSymbol
    : `${exchange}:${rawSymbol}`);
  if (!request) return null;
  // Yahoo publishes these granularities; anything coarser is merged from them.
  const nativeResolutions = ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'];
  const plan = planResolution(resolution, nativeResolutions);
  const interval = plan && ({
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m',
    '1d': '1d', '1w': '1wk', '1M': '1mo',
  })[plan.baseResolution];
  if (!interval) return null;

  const rangeKey = from > 0 ? `${start || from}` : 'max';
  const cacheKey = `${request.exchange}:${request.key}:${resolution}:${rangeKey}:${end || to}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 90_000) return cached.value;
  if (pendingHistoryRequests.has(cacheKey)) return pendingHistoryRequests.get(cacheKey);

  const pending = (async () => {
    let candles;
    let usedDirectFallback = false;
    if (process.env.VERCEL === '1' || process.env.VERCEL_FUNCTIONS === '1') {
      candles = await fetchYahooHistory(request, { from, to, interval });
    } else {
      try {
        const payload = await runWorker([{
          kind: 'history',
          symbol: request.symbol,
          exchange: request.exchange,
          interval: plan.baseResolution,
          start,
          end,
          all: from <= 0,
        }]);
        candles = payload?.histories?.[request.key] || [];
      } catch (error) {
        console.warn(`Local yfinance history failed for ${request.key}; trying Yahoo chart history:`, error.message);
        candles = [];
      }
      const hasCandlesInWindow = candles.some((candle) => Number(candle.time) <= Number(to || Date.now() / 1000)
        && Number(candle.time) + plan.seconds > Number(from || 0));
      if (!hasCandlesInWindow) {
        try {
          const directCandles = await fetchYahooHistory(request, { from, to, interval });
          if (directCandles.length) {
            candles = directCandles;
            usedDirectFallback = true;
          }
        } catch (error) {
          console.warn(`Direct Yahoo research history failed for ${request.key}:`, error.response?.status || error.message);
          candles = [];
        }
      }
    }

    const verified = candles.filter((candle) => Number(candle.time) <= Number(to || Date.now() / 1000));
    const merged = plan.isMerged ? aggregateCandles(verified, plan.seconds) : verified;

    const value = {
      candles: merged.filter((candle) => Number(candle.time) + plan.seconds > Number(from || 0)),
      provider: usedDirectFallback ? 'Yahoo Finance direct research feed' : `${getYahooResearchProviderName()} research feed`,
      effectiveResolution: plan.baseResolution,
      fallbackNote: mergeNote(plan),
      isLive: false,
      isDelayed: true,
      isResearch: true,
    };
    historyCache.set(cacheKey, { value, savedAt: Date.now() });
    while (historyCache.size > 100) historyCache.delete(historyCache.keys().next().value);
    return value;
  })();

  pendingHistoryRequests.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    if (pendingHistoryRequests.get(cacheKey) === pending) pendingHistoryRequests.delete(cacheKey);
  }
};
