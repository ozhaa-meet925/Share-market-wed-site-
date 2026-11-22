import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CACHE_DIR = path.resolve(process.env.INSTRUMENTS_CACHE_DIR || path.join(process.cwd(), 'data', 'instruments'));
const CACHE_TTL_MS = Number(process.env.INSTRUMENTS_CACHE_TTL_MS) || 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25_000;

const UPSTOX_SOURCE = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const ZERODHA_SOURCE = 'https://api.kite.trade/instruments';
const SYMBOL_PATTERN = /^[A-Z0-9&.\-]{1,20}$/;

const cache = {
  upstox: { map: new Map(), fetchedAt: null, source: UPSTOX_SOURCE, error: null },
  zerodha: { map: new Map(), fetchedAt: null, source: ZERODHA_SOURCE, error: null },
};
const loading = new Map();

const cleanSymbol = (value) => {
  const symbol = String(value || '').trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
};

const cacheFile = (broker) => path.join(CACHE_DIR, `${broker}-nse.json`);

const parseOverrideMap = () => {
  try {
    const parsed = JSON.parse(process.env.INSTRUMENT_OVERRIDES || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const loadCachedFile = (broker) => {
  try {
    const payload = JSON.parse(fs.readFileSync(cacheFile(broker), 'utf8'));
    if (!payload?.instruments || typeof payload.instruments !== 'object') return;
    cache[broker].map = new Map(Object.entries(payload.instruments));
    cache[broker].fetchedAt = payload.fetchedAt || null;
    cache[broker].source = payload.source || cache[broker].source;
  } catch {
    // No usable cache yet; the resolver will refresh on demand.
  }
};

loadCachedFile('upstox');
loadCachedFile('zerodha');

const persist = (broker) => {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const instruments = Object.fromEntries(cache[broker].map);
    fs.writeFileSync(cacheFile(broker), JSON.stringify({
      fetchedAt: cache[broker].fetchedAt,
      source: cache[broker].source,
      instruments,
    }), 'utf8');
  } catch (error) {
    cache[broker].error = `Instrument cache could not be written: ${error.message}`;
  }
};

const parseCsvLine = (line) => {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
};

const fetchZerodhaInstruments = async ({ fetchImpl }) => {
  const headers = { 'User-Agent': 'ShareMarketPro/1.0 instrument-resolver' };
  const apiKey = String(process.env.ZERODHA_API_KEY || '').trim();
  if (apiKey) headers['X-Kite-Version'] = '3';
  const response = await fetchImpl(ZERODHA_SOURCE, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) throw new Error(`Kite instrument master returned HTTP ${response.status}.`);
  const csv = await response.text();
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines.shift() || '');
  const index = Object.fromEntries(header.map((name, position) => [name.trim(), position]));
  const map = new Map();
  for (const line of lines) {
    const row = parseCsvLine(line);
    const exchange = String(row[index.exchange] || '').trim();
    const instrumentType = String(row[index.instrument_type] || '').trim();
    if (exchange !== 'NSE' || instrumentType !== 'EQ') continue;
    const symbol = cleanSymbol(row[index.tradingsymbol]);
    if (!symbol) continue;
    map.set(symbol, {
      broker: 'zerodha',
      symbol,
      exchange: 'NSE',
      tradingsymbol: symbol,
      instrumentToken: String(row[index.instrument_token] || '').trim() || null,
      instrumentKey: `NSE:${symbol}`,
      quoteKey: `NSE:${symbol}`,
      lotSize: Number(row[index.lot_size]) || 1,
      tickSize: Number(row[index.tick_size]) || 0.05,
      fetchedAt: new Date().toISOString(),
    });
  }
  if (!map.size) throw new Error('Kite instrument master did not contain any NSE equity rows.');
  return map;
};

const fetchUpstoxInstruments = async ({ fetchImpl }) => {
  const response = await fetchImpl(UPSTOX_SOURCE, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) throw new Error(`Upstox instrument master returned HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  const text = (isGzip ? zlib.gunzipSync(buffer) : buffer).toString('utf8');
  const rows = JSON.parse(text);
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const segment = String(row.segment || row.segment_name || '').toUpperCase();
    const instrumentType = String(row.instrument_type || '').toUpperCase();
    if (segment !== 'NSE_EQ' || (instrumentType && instrumentType !== 'EQ')) continue;
    const symbol = cleanSymbol(row.trading_symbol || row.tradingsymbol);
    const instrumentKey = String(row.instrument_key || row.instrumentKey || '').trim();
    if (!symbol || !instrumentKey) continue;
    map.set(symbol, {
      broker: 'upstox',
      symbol,
      exchange: 'NSE',
      tradingsymbol: symbol,
      instrumentToken: instrumentKey,
      instrumentKey,
      quoteKey: instrumentKey,
      isin: row.isin || null,
      lotSize: Number(row.lot_size) || 1,
      tickSize: Number(row.tick_size) || 0.05,
      fetchedAt: new Date().toISOString(),
    });
  }
  if (!map.size) throw new Error('Upstox instrument master did not contain any NSE equity rows.');
  return map;
};

const overridesFor = (broker) => {
  const overrides = parseOverrideMap();
  const map = new Map();
  for (const [symbol, value] of Object.entries(overrides)) {
    const clean = cleanSymbol(symbol);
    if (!clean) continue;
    const entry = typeof value === 'string' ? { [broker]: value } : value;
    const key = entry?.[broker];
    if (!key) continue;
    map.set(clean, {
      broker,
      symbol: clean,
      exchange: 'NSE',
      tradingsymbol: clean,
      instrumentToken: String(key),
      instrumentKey: String(key),
      quoteKey: broker === 'zerodha' ? `NSE:${clean}` : String(key),
      source: 'env_override',
      fetchedAt: null,
    });
  }
  return map;
};

export const refreshInstruments = async ({ broker = null, force = false, fetchImpl = fetch } = {}) => {
  const targets = broker ? [broker] : ['upstox', 'zerodha'];
  const results = {};
  for (const id of targets) {
    if (!cache[id]) {
      results[id] = { ok: false, error: `Unknown broker ${id}.` };
      continue;
    }
    const state = cache[id];
    const age = state.fetchedAt ? Date.now() - new Date(state.fetchedAt).getTime() : Infinity;
    if (!force && state.map.size && age < CACHE_TTL_MS) {
      results[id] = { ok: true, cached: true, count: state.map.size, fetchedAt: state.fetchedAt };
      continue;
    }
    if (loading.has(id)) {
      results[id] = await loading.get(id);
      continue;
    }
    const job = (async () => {
      try {
        const map = id === 'upstox'
          ? await fetchUpstoxInstruments({ fetchImpl })
          : await fetchZerodhaInstruments({ fetchImpl });
        for (const [symbol, entry] of overridesFor(id)) map.set(symbol, entry);
        state.map = map;
        state.fetchedAt = new Date().toISOString();
        state.error = null;
        persist(id);
        return { ok: true, count: map.size, fetchedAt: state.fetchedAt };
      } catch (error) {
        state.error = error.message;
        if (!state.map.size) {
          for (const [symbol, entry] of overridesFor(id)) state.map.set(symbol, entry);
        }
        return { ok: false, count: state.map.size, error: error.message };
      } finally {
        loading.delete(id);
      }
    })();
    loading.set(id, job);
    results[id] = await job;
  }
  return results;
};

const stale = (state) => !state.fetchedAt || Date.now() - new Date(state.fetchedAt).getTime() > CACHE_TTL_MS;

export const ensureInstrumentCache = () => {
  for (const id of ['upstox', 'zerodha']) {
    if (!cache[id].map.size || stale(cache[id])) {
      refreshInstruments({ broker: id }).catch(() => {});
    }
  }
};

export const resolveInstrument = async (broker, symbol, { fetchImpl = fetch, allowRefresh = true } = {}) => {
  const clean = cleanSymbol(symbol);
  if (!clean) throw new Error(`Invalid NSE symbol: ${symbol}`);
  if (!cache[broker]) throw new Error(`Unsupported broker: ${broker}`);
  const override = overridesFor(broker).get(clean);
  if (override) return override;
  let entry = cache[broker].map.get(clean);
  if (!entry && allowRefresh) {
    await refreshInstruments({ broker, fetchImpl });
    entry = cache[broker].map.get(clean);
  }
  if (entry) return entry;
  if (broker === 'zerodha') {
    return {
      broker,
      symbol: clean,
      exchange: 'NSE',
      tradingsymbol: clean,
      instrumentToken: null,
      instrumentKey: `NSE:${clean}`,
      quoteKey: `NSE:${clean}`,
      source: 'symbol_fallback',
      warning: 'Kite instrument master has not been loaded; tradingsymbol routing is used without a historical token.',
      fetchedAt: null,
    };
  }
  const detail = cache[broker].error ? ` ${cache[broker].error}` : '';
  throw new Error(`No NSE equity instrument mapping for ${clean} on ${broker}.${detail}`);
};

export const instrumentStatus = () => ({
  cacheDir: CACHE_DIR,
  ttlMs: CACHE_TTL_MS,
  brokers: Object.fromEntries(Object.entries(cache).map(([id, state]) => [id, {
    loaded: state.map.size,
    fetchedAt: state.fetchedAt,
    stale: stale(state),
    source: state.source,
    error: state.error,
    refreshing: loading.has(id),
  }])),
});

export const instrumentSymbols = (broker) => [...cache[broker]?.map.keys?.() || []];
