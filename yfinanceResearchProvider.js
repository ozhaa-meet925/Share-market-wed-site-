import { execFile } from 'node:child_process';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(ROOT, 'yfinance_research.py');
const WINDOWS_VENV_PYTHON = path.join(ROOT, '.venv-yfinance', 'Scripts', 'python.exe');
const POSIX_VENV_PYTHON = path.join(ROOT, '.venv-yfinance', 'bin', 'python');
const CACHE_TTL_MS = 60_000;
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const quoteCache = new Map();
const pendingRequests = new Map();
const INDEX_TICKERS = {
  NIFTY: ['^NSEI', 'NIFTY 50'],
  BANKNIFTY: ['^NSEBANK', 'NIFTY BANK'],
  NIFTYIT: ['^CNXIT', 'NIFTY IT'],
  NIFTYMIDCAP: ['NIFTYMIDCAP150.NS', 'NIFTY MIDCAP 150'],
};
const GLOBAL_TICKERS = { USDINR: 'INR=X', BZUSD: 'BZ=F' };
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
  return payload?.quotes && typeof payload.quotes === 'object' ? payload.quotes : {};
};

const normalizeQuote = (raw) => {
  const timestamp = Number(raw?.timestamp);
  if (!(Number(raw?.c) > 0) || !Number.isFinite(timestamp)) return null;
  const stale = Date.now() - timestamp * 1000 > 30 * 60 * 1000;
  return {
    ...raw,
    provider: getYahooResearchProviderName(),
    isLive: false,
    isDelayed: true,
    isResearch: true,
    isStale: stale,
  };
};

export const getYahooResearchQuotes = async (symbols) => {
  if (!isYahooResearchEnabled()) return {};
  const requests = [...new Map(symbols.map(normalizeRequest).filter(Boolean)
    .map((item) => [`${item.exchange}:${item.key}`, item])).values()];
  if (!requests.length) return {};

  const cacheKey = requests.map((item) => `${item.exchange}:${item.key}`).sort().join(',');
  const cached = quoteCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.quotes;
  if (pendingRequests.has(cacheKey)) return pendingRequests.get(cacheKey);

  const pending = (async () => {
    const quotes = {};
    for (let offset = 0; offset < requests.length; offset += 100) {
      const chunk = requests.slice(offset, offset + 100);
      const fetched = process.env.VERCEL === '1' || process.env.VERCEL_FUNCTIONS === '1'
        ? await runYahooChartBatch(chunk)
        : await runWorker(chunk);
      for (const [symbol, rawQuote] of Object.entries(fetched)) {
        const quote = normalizeQuote(rawQuote);
        if (quote) quotes[symbol] = quote;
      }
    }
    quoteCache.set(cacheKey, { quotes, savedAt: Date.now() });
    if (quoteCache.size > 100) quoteCache.delete(quoteCache.keys().next().value);
    return quotes;
  })().finally(() => pendingRequests.delete(cacheKey));

  pendingRequests.set(cacheKey, pending);
  return pending;
};
