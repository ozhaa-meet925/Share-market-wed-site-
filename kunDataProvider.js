import axios from 'axios';
import WebSocket from 'ws';

const quoteCache = new Map();
const desiredInstruments = new Map();
const sentInstruments = new Set();
const snapshotRequestedAt = new Map();
const pendingSnapshots = new Map();
const SNAPSHOT_CACHE_MS = 10_000;
const SNAPSHOT_BATCH_SIZE = 100;

let socket = null;
let reconnectTimer = null;
let reconnectDelay = 3_000;
let shuttingDown = false;

const config = () => ({
  token: process.env.KUN_DATA_API_TOKEN || '',
  apiBaseUrl: (process.env.KUN_DATA_API_BASE_URL || 'https://api.kun.pro').replace(/\/+$/, ''),
  wsUrl: process.env.KUN_DATA_WS_URL || 'ws://ws.kun.pro/ws',
  market: process.env.KUN_DATA_MARKET || 'IN',
  defaultExchange: process.env.KUN_DATA_EXCHANGE || 'NSE',
});

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const timestampToSeconds = (value, fallback = Math.floor(Date.now() / 1000)) => {
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value)) {
    const parsedDate = Date.parse(value);
    return Number.isFinite(parsedDate) ? Math.floor(parsedDate / 1000) : fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed > 1e12 ? parsed / 1000 : parsed);
};

const toInstrument = (rawSymbol) => {
  const value = String(rawSymbol || '').trim().toUpperCase();
  const match = value.match(/^(NSE|BSE):(.+)$/);
  if (value.includes(':') && !match) return null;
  const exchange = match?.[1] || config().defaultExchange;
  const ticker = (match?.[2] || value).trim();
  if (!ticker || !['NSE', 'BSE'].includes(exchange)) return null;
  return { exchange, ticker, instrument: `${exchange}:${ticker}`, key: ticker };
};

const normalizeQuote = (payload, instrument, source, receivedAt = Date.now()) => {
  const price = parseNumber(payload?.price ?? payload?.last_price ?? payload?.c);
  if (!(price > 0)) return null;
  const previousClose = parseNumber(payload?.prev_close ?? payload?.previous_close ?? payload?.pc);
  const change = parseNumber(payload?.ch ?? payload?.change ?? payload?.d)
    ?? (previousClose ? price - previousClose : null);
  const changePercent = parseNumber(payload?.chp ?? payload?.change_percent ?? payload?.dp)
    ?? (previousClose && change !== null ? Number(((change / previousClose) * 100).toFixed(2)) : null);
  const timestamp = timestampToSeconds(payload?.time ?? payload?.timestamp, Math.floor(receivedAt / 1000));
  return {
    c: price,
    d: change,
    dp: changePercent,
    h: parseNumber(payload?.high ?? payload?.h),
    l: parseNumber(payload?.low ?? payload?.l),
    o: parseNumber(payload?.open ?? payload?.o),
    pc: previousClose,
    v: parseNumber(payload?.volume ?? payload?.v),
    timestamp,
    lastTradeTime: timestamp,
    symbol: instrument.ticker,
    exchange: instrument.exchange,
    provider: 'Kunpeng Data',
    isLive: source === 'stream',
    isStale: false,
  };
};

const cacheQuote = (instrument, payload, source, receivedAt = Date.now()) => {
  const quote = normalizeQuote(payload, instrument, source, receivedAt);
  if (!quote) return null;
  quoteCache.set(instrument.instrument, { quote, source, receivedAt });
  return quote;
};

const instrumentFromMessage = (value, exchangeFallback = config().defaultExchange) => {
  const instrument = toInstrument(value);
  if (instrument) return instrument;
  const raw = String(value || '').trim().toUpperCase();
  if (!raw || raw.includes(':')) return null;
  return toInstrument(`${exchangeFallback}:${raw}`);
};

const saveStreamMessage = (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'system') {
    if (message.status === 'error') console.warn('Kunpeng Data stream message:', message.message || 'subscription error');
    return;
  }

  const nested = message.data;
  const items = Array.isArray(message)
    ? message
    : Array.isArray(message.list)
      ? message.list
      : Array.isArray(nested)
        ? nested
        : [nested && typeof nested === 'object' ? nested : message];

  for (const item of items) {
    const instrument = instrumentFromMessage(item?.symbol ?? item?.ticker, item?.exchange);
    if (!instrument || !desiredInstruments.has(instrument.instrument)) continue;
    cacheQuote(instrument, item, 'stream');
  }
};

const flushSubscriptions = () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const { market } = config();
  const groups = new Map();
  for (const instrument of desiredInstruments.values()) {
    if (sentInstruments.has(instrument.instrument)) continue;
    const symbols = groups.get(instrument.exchange) || [];
    symbols.push(instrument);
    groups.set(instrument.exchange, symbols);
  }

  for (const [exchange, instruments] of groups) {
    for (let index = 0; index < instruments.length; index += SNAPSHOT_BATCH_SIZE) {
      const batch = instruments.slice(index, index + SNAPSHOT_BATCH_SIZE);
      try {
        socket.send(JSON.stringify({
          action: 'subscribe',
          market,
          exchange,
          symbols: batch.map((instrument) => instrument.instrument),
          replay: 'last',
        }));
        batch.forEach((instrument) => sentInstruments.add(instrument.instrument));
      } catch (error) {
        console.warn('Could not subscribe to Kunpeng Data symbols:', error.message);
      }
    }
  }
};

const scheduleReconnect = () => {
  if (shuttingDown || reconnectTimer || !config().token || !desiredInstruments.size) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectStream();
  }, delay);
  reconnectTimer.unref?.();
};

const connectStream = () => {
  const { token, wsUrl } = config();
  if (!token || shuttingDown || !desiredInstruments.size) return;
  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;

  let connectionUrl;
  try {
    connectionUrl = new URL(wsUrl);
    connectionUrl.searchParams.set('token', token);
  } catch (error) {
    console.error('Invalid Kunpeng Data WebSocket URL:', error.message);
    return;
  }

  try {
    const nextSocket = new WebSocket(connectionUrl.toString());
    socket = nextSocket;
    nextSocket.on('open', () => {
      reconnectDelay = 3_000;
      sentInstruments.clear();
      flushSubscriptions();
      console.info('Connected to Kunpeng Data market stream.');
    });
    nextSocket.on('message', (data) => {
      try {
        saveStreamMessage(JSON.parse(data.toString()));
      } catch {
        console.warn('Kunpeng Data sent an unreadable market message.');
      }
    });
    nextSocket.on('close', () => {
      if (socket === nextSocket) socket = null;
      sentInstruments.clear();
      scheduleReconnect();
    });
    nextSocket.on('error', (error) => {
      console.warn('Kunpeng Data WebSocket error:', error.message);
    });
  } catch (error) {
    console.warn('Could not connect to Kunpeng Data:', error.message);
    scheduleReconnect();
  }
};

const fetchSnapshotGroup = async (instruments) => {
  const { token, apiBaseUrl, market } = config();
  const exchange = instruments[0]?.exchange;
  const requestAt = Date.now();
  instruments.forEach((instrument) => snapshotRequestedAt.set(instrument.instrument, requestAt));
  const response = await axios.get(`${apiBaseUrl}/api/exchange`, {
    params: {
      market,
      venue: exchange,
      symbols: instruments.map((instrument) => instrument.instrument).join(','),
    },
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    timeout: 8_000,
  });
  const rows = response.data?.list || response.data?.data?.list;
  if (!Array.isArray(rows)) throw new Error('Kunpeng Data returned an invalid exchange snapshot.');

  const receivedAt = Date.now();
  for (const row of rows) {
    const instrument = instrumentFromMessage(row?.symbol ?? row?.ticker, row?.exchange);
    if (!instrument) continue;
    const current = quoteCache.get(instrument.instrument);
    if (current?.source === 'stream' && current.receivedAt >= requestAt) continue;
    cacheQuote(instrument, row, 'snapshot', receivedAt);
  }
  if (!rows.length) throw new Error('Kunpeng Data returned no NSE quotes for the requested symbols.');
};

const fetchSnapshots = async (instruments) => {
  const grouped = new Map();
  for (const instrument of instruments) {
    const group = grouped.get(instrument.exchange) || [];
    group.push(instrument);
    grouped.set(instrument.exchange, group);
  }

  const jobs = [];
  for (const group of grouped.values()) {
    for (let offset = 0; offset < group.length; offset += SNAPSHOT_BATCH_SIZE) {
      const batch = group.slice(offset, offset + SNAPSHOT_BATCH_SIZE);
      const pending = batch.map((instrument) => pendingSnapshots.get(instrument.instrument)).filter(Boolean);
      const fresh = batch.filter((instrument) => !pendingSnapshots.has(instrument.instrument));
      if (fresh.length) {
        const job = fetchSnapshotGroup(fresh);
        fresh.forEach((instrument) => pendingSnapshots.set(instrument.instrument, job));
        jobs.push(job.finally(() => {
          fresh.forEach((instrument) => {
            if (pendingSnapshots.get(instrument.instrument) === job) pendingSnapshots.delete(instrument.instrument);
          });
        }));
      }
      jobs.push(...pending);
    }
  }
  const results = await Promise.allSettled(jobs);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure && !instruments.some((instrument) => quoteCache.has(instrument.instrument))) {
    throw failure.reason;
  }
};

const decorateCachedQuote = (instrument) => {
  const cached = quoteCache.get(instrument.instrument);
  if (!cached) return null;
  const ageMs = Math.max(0, Date.now() - cached.receivedAt);
  const streamConnected = cached.source === 'stream' && socket?.readyState === WebSocket.OPEN;
  const snapshotFresh = cached.source === 'snapshot' && ageMs <= SNAPSHOT_CACHE_MS;
  const isLive = streamConnected || snapshotFresh;
  return {
    ...cached.quote,
    isLive,
    isStale: !isLive,
    ageMs,
  };
};

export const isKunDataConfigured = () => Boolean(config().token);

export const getKunDataStatus = () => ({
  connected: socket?.readyState === WebSocket.OPEN,
  subscribedSymbols: desiredInstruments.size,
});

export const getKunQuotes = async (symbols) => {
  const { token } = config();
  if (!token) throw new Error('Set KUN_DATA_API_TOKEN in .env to enable NSE live quotes.');
  const instruments = [...new Map(symbols.map(toInstrument).filter(Boolean)
    .map((instrument) => [instrument.instrument, instrument])).values()];
  if (!instruments.length) return {};

  instruments.forEach((instrument) => desiredInstruments.set(instrument.instrument, instrument));
  connectStream();

  const now = Date.now();
  const needsSnapshot = instruments.filter((instrument) => {
    const cached = quoteCache.get(instrument.instrument);
    const liveStream = cached?.source === 'stream' && socket?.readyState === WebSocket.OPEN;
    const freshSnapshot = cached?.source === 'snapshot' && now - cached.receivedAt <= SNAPSHOT_CACHE_MS;
    const snapshotPending = pendingSnapshots.has(instrument.instrument);
    const recentlyRequested = now - (snapshotRequestedAt.get(instrument.instrument) || 0) < SNAPSHOT_CACHE_MS;
    return !liveStream && !freshSnapshot && (snapshotPending || !recentlyRequested);
  });

  if (needsSnapshot.length) {
    try {
      await fetchSnapshots(needsSnapshot);
    } catch (error) {
      console.warn('Kunpeng Data snapshot request failed:', error.response?.status || error.message);
      if (!instruments.some((instrument) => quoteCache.has(instrument.instrument))) throw error;
    }
  }

  return Object.fromEntries(instruments.map((instrument) => [instrument.key, decorateCachedQuote(instrument)]).filter(([, quote]) => quote));
};

export const getKunHistory = async ({ symbol, interval, count }) => {
  const { token, apiBaseUrl, market } = config();
  if (!token) throw new Error('Set KUN_DATA_API_TOKEN in .env to enable NSE history.');
  const instrument = toInstrument(symbol);
  if (!instrument) throw new Error(`Unsupported Kunpeng Data instrument: ${symbol}`);
  const response = await axios.get(`${apiBaseUrl}/api/history`, {
    params: { market, symbol: instrument.instrument, interval, count },
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    timeout: 12_000,
  });
  const rows = response.data?.list || response.data?.data?.list;
  if (!Array.isArray(rows)) throw new Error('Kunpeng Data returned an invalid candle response.');
  return rows.map((row) => ({
    time: timestampToSeconds(row.timestamp ?? row.time),
    open: parseNumber(row.open),
    high: parseNumber(row.high),
    low: parseNumber(row.low),
    close: parseNumber(row.close),
    value: parseNumber(row.volume) || 0,
  })).filter((candle) => Number.isFinite(candle.time)
    && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
    .sort((first, second) => first.time - second.time);
};

export const closeKunDataConnection = () => {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (socket) {
    socket.removeAllListeners();
    socket.close();
    socket = null;
  }
};
