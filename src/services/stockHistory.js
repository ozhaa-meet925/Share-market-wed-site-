import { marketApi } from './api';

const CARD_HISTORY_DAYS = 90;
const CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CONCURRENT_REQUESTS = 3;
const historyCache = new Map();
const historyPending = new Map();
const historyQueue = [];
let activeRequests = 0;

const runNext = () => {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && historyQueue.length) {
    const job = historyQueue.shift();
    activeRequests += 1;
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeRequests -= 1;
        runNext();
      });
  }
};

const withRequestLimit = (run) => new Promise((resolve, reject) => {
  historyQueue.push({ run, resolve, reject });
  runNext();
});

const normalizeCandles = (payload) => {
  if (payload?.s !== 'ok' || !Array.isArray(payload.t) || !payload.t.length) return [];
  const fields = [payload.o, payload.h, payload.l, payload.c];
  if (fields.some((values) => !Array.isArray(values) || values.length !== payload.t.length)) return [];

  const candles = payload.t.map((time, index) => ({
    time: Number(time),
    open: Number(payload.o[index]),
    high: Number(payload.h[index]),
    low: Number(payload.l[index]),
    close: Number(payload.c[index]),
    value: Number.isFinite(Number(payload.v?.[index])) ? Number(payload.v[index]) : null,
  })).filter((candle) => Number.isFinite(candle.time)
    && [candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0)
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close));

  return [...new Map(candles.sort((a, b) => a.time - b.time)
    .map((candle) => [candle.time, candle])).values()];
};

export const getStockCardHistory = (symbol, exchange = 'NSE') => {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  const cleanExchange = String(exchange || 'NSE').trim().toUpperCase();
  if (!cleanSymbol) return Promise.resolve({ candles: [], provider: null, isResearch: false });

  const cacheKey = `${cleanExchange}:${cleanSymbol}:1d:${CARD_HISTORY_DAYS}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return Promise.resolve(cached.value);
  if (historyPending.has(cacheKey)) return historyPending.get(cacheKey);

  const to = Math.floor(Date.now() / 1000);
  const from = to - CARD_HISTORY_DAYS * 24 * 60 * 60;
  const requestedSymbol = cleanExchange === 'BSE' ? `BSE:${cleanSymbol}` : cleanSymbol;
  const pending = withRequestLimit(() => marketApi.getCandles(requestedSymbol, from, to, '1d'))
    .then((payload) => {
      const value = {
        candles: normalizeCandles(payload),
        provider: payload?.provider || null,
        isResearch: payload?.isResearch === true,
      };
      if (value.candles.length) historyCache.set(cacheKey, { value, savedAt: Date.now() });
      return value;
    })
    .finally(() => {
      historyPending.delete(cacheKey);
    });

  historyPending.set(cacheKey, pending);
  return pending;
};
