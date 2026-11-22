import { blackScholes, impliedVolatility, maxPainFrom } from './serverFnoMarket.js';

// NSE's main site redirects this deployment to the .in mirror, which serves the
// same front-end assets and APIs. These endpoints are the exchange's intraday
// snapshots (last trade within seconds during market hours, last close after).
const NSE_BASE = 'https://www.nseindia.in';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 12000;
const CHAIN_TTL_MS = 3000;
const FUTURES_TTL_MS = 3000;
const EXPIRY_TTL_MS = 30 * 60 * 1000;
const RISK_FREE_RATE = 0.065;

const INDEX_FUTURES_KEYS = {
  NIFTY: 'nse50_fut',
  BANKNIFTY: 'nifty_bank_fut',
  FINNIFTY: 'finnifty_fut',
  MIDCPNIFTY: 'niftymidcap_fut',
  NIFTYNXT50: 'niftynxt50_fut',
};

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

export const nseDateToIso = (value) => {
  const text = String(value || '').trim();
  const dashed = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(text);
  if (dashed && MONTHS[dashed[2]] ) return `${dashed[3]}-${MONTHS[dashed[2]]}-${dashed[1]}`;
  const numeric = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (numeric) return `${numeric[3]}-${numeric[2]}-${numeric[1]}`;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text);
  return iso ? text : null;
};

export const isoToNseDate = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return null;
  const month = Object.keys(MONTHS).find((key) => MONTHS[key] === match[2]);
  return month ? `${match[3]}-${month}-${match[1]}` : null;
};

const timestampToIso = (value) => {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match || !MONTHS[match[2]]) return null;
  return `${match[3]}-${MONTHS[match[2]]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}+05:30`;
};

const istToday = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

const yearsUntil = (expiryIso, todayIso) => {
  const from = Date.parse(`${todayIso}T00:00:00+05:30`);
  const to = Date.parse(`${expiryIso}T15:30:00+05:30`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(to - from, 6 * 3600 * 1000) / (365 * 24 * 3600 * 1000);
};

const numberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const sentimentFor = (pcr) => {
  if (pcr == null) return 'Unavailable';
  if (pcr >= 1.2) return 'Call-heavy · bullish tilt';
  if (pcr <= 0.8) return 'Put-heavy · bearish tilt';
  return 'Balanced';
};

const fetchNseJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-IN,en;q=0.9',
      Referer: `${NSE_BASE}/option-chain`,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`The NSE intraday feed returned HTTP ${response.status}.`), { code: 'fno_live_unavailable' });
  }
  const text = await response.text();
  if (!text.trim().startsWith('{')) {
    throw Object.assign(new Error('The NSE intraday feed returned an unexpected response.'), { code: 'fno_live_unavailable' });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('The NSE intraday feed returned invalid JSON.'), { code: 'fno_live_unavailable' });
  }
};

const legFor = (leg, { optionType, years, spot }) => {
  if (!leg || typeof leg !== 'object') return null;
  const ltp = numberOrNull(leg.lastPrice);
  const ivPercent = numberOrNull(leg.impliedVolatility);
  let iv = ivPercent != null && ivPercent > 0 ? ivPercent / 100 : null;
  if (iv == null && ltp > 0 && spot > 0 && leg.strikePrice) {
    iv = impliedVolatility({ price: ltp, spot, strike: leg.strikePrice, years, optionType, rate: RISK_FREE_RATE });
  }
  const greeks = iv != null && spot > 0 && leg.strikePrice
    ? blackScholes({ spot, strike: leg.strikePrice, years, volatility: iv, rate: RISK_FREE_RATE, optionType })
    : null;
  return {
    symbol: String(leg.identifier || ''),
    ltp,
    change: numberOrNull(leg.change),
    changePercent: numberOrNull(leg.pChange ?? leg.PChange),
    oi: numberOrNull(leg.openInterest) ?? 0,
    oiChange: numberOrNull(leg.changeinOpenInterest) ?? 0,
    volume: numberOrNull(leg.totalTradedVolume) ?? 0,
    settlement: null,
    lotSize: null,
    iv: ivPercent != null && ivPercent > 0 ? Math.round(ivPercent * 10) / 10 : null,
    delta: greeks ? Math.round(greeks.delta * 1000) / 1000 : null,
    gamma: greeks ? Math.round(greeks.gamma * 10000) / 10000 : null,
    vega: greeks ? Math.round(greeks.vega * 100) / 100 : null,
    theta: greeks ? Math.round(greeks.theta * 100) / 100 : null,
    bid: numberOrNull(leg.buyPrice1),
    ask: numberOrNull(leg.sellPrice1),
  };
};

export const parseLiveOptionChain = (payload, { ticker, expiry, now = new Date() } = {}) => {
  const records = payload?.records;
  const data = Array.isArray(records?.data) ? records.data : [];
  if (!data.length) return null;
  const symbol = String(ticker || records?.data?.[0]?.CE?.underlying || '').toUpperCase();
  const expiries = [...new Set((records.expiryDates || []).map(nseDateToIso).filter(Boolean))].sort();
  const requested = expiry ? nseDateToIso(expiry) : null;
  const chosenExpiry = requested && expiries.includes(requested) ? requested : (expiries[0] || nseDateToIso(data[0]?.expiryDates));
  if (!chosenExpiry) return null;

  const spot = numberOrNull(records.underlyingValue) ?? numberOrNull(data[0]?.CE?.underlyingValue) ?? null;
  const today = istToday(now);
  const years = yearsUntil(chosenExpiry, today);

  const byStrike = new Map();
  for (const row of data) {
    const rowExpiry = nseDateToIso(row.expiryDates);
    if (rowExpiry && rowExpiry !== chosenExpiry) continue;
    const strike = numberOrNull(row.CE?.strikePrice) ?? numberOrNull(row.PE?.strikePrice);
    if (strike == null) continue;
    byStrike.set(strike, { strike, row });
  }
  const sorted = [...byStrike.values()].sort((first, second) => first.strike - second.strike);
  if (!sorted.length) return null;

  const atm = spot != null
    ? sorted.reduce((best, current) => (
      Math.abs(current.strike - spot) < Math.abs(best.strike - spot) ? current : best
    ), sorted[0]).strike
    : null;

  const strikes = sorted.map(({ strike, row }) => ({
    strike,
    isAtm: strike === atm,
    distanceFromSpot: spot != null ? Math.round((strike - spot) * 100) / 100 : null,
    call: legFor(row.CE, { optionType: 'CE', years, spot }),
    put: legFor(row.PE, { optionType: 'PE', years, spot }),
  }));
  const totalCallOi = strikes.reduce((sum, row) => sum + (row.call?.oi || 0), 0);
  const totalPutOi = strikes.reduce((sum, row) => sum + (row.put?.oi || 0), 0);
  const pcr = totalCallOi > 0 ? Math.round((totalPutOi / totalCallOi) * 100) / 100 : null;
  const asOf = timestampToIso(records.timestamp) || timestampToIso(data[0]?.CE?.timestamp) || null;

  return {
    underlying: symbol,
    instrument: INDEX_FUTURES_KEYS[symbol] ? 'Index option' : 'Stock option',
    underlyingPrice: spot,
    tradeDate: asOf ? asOf.slice(0, 10) : today,
    asOf,
    expiry: chosenExpiry,
    expiries,
    lotSize: null,
    atmStrike: atm,
    pcr,
    pcrSentiment: sentimentFor(pcr),
    maxPain: maxPainFrom(strikes),
    totalCallOi,
    totalPutOi,
    strikes,
    source: 'NSE intraday option chain',
    isLive: true,
    dataQuality: 'Intraday exchange snapshot',
    exchangeTimestamp: records.timestamp || null,
    stale: false,
  };
};

export const parseLiveFutures = (payload, { ticker } = {}) => {
  const symbol = String(ticker || '').toUpperCase();
  const rows = (payload?.data || []).filter((row) => String(row.underlying || '').toUpperCase() === symbol);
  if (!rows.length) return null;
  const underlyingPrice = numberOrNull(rows[0].underlyingValue);
  const contracts = rows
    .map((row) => {
      const price = numberOrNull(row.lastPrice);
      const change = numberOrNull(row.change);
      const basis = price != null && underlyingPrice != null ? Math.round((price - underlyingPrice) * 100) / 100 : null;
      return {
        symbol: String(row.contract || row.identifier || symbol),
        expiry: nseDateToIso(row.expiryDate),
        price,
        change,
        changePercent: numberOrNull(row.pChange),
        oi: numberOrNull(row.openInterest) ?? 0,
        oiChange: null,
        volume: numberOrNull(row.volume) ?? 0,
        settlement: null,
        lotSize: null,
        underlyingPrice,
        basis,
        basisPercent: basis != null && underlyingPrice ? Math.round((basis / underlyingPrice) * 10000) / 100 : null,
        open: numberOrNull(row.openPrice),
        high: numberOrNull(row.highPrice),
        low: numberOrNull(row.lowPrice),
      };
    })
    .sort((first, second) => String(first.expiry).localeCompare(String(second.expiry)));

  return {
    underlying: symbol,
    instrument: String(rows[0].instrument || 'Futures'),
    tradeDate: timestampToIso(payload?.timestamp)?.slice(0, 10) || null,
    underlyingPrice,
    contracts,
    asOf: timestampToIso(payload?.timestamp),
    exchangeTimestamp: payload?.timestamp || null,
    marketStatus: payload?.marketStatus || null,
    source: 'NSE intraday futures watch',
    isLive: true,
    dataQuality: 'Intraday exchange snapshot',
    stale: false,
  };
};

const createTtlCache = () => {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry || Date.now() - entry.at >= entry.ttlMs) return undefined;
      return entry.value;
    },
    async load(key, ttlMs, loader) {
      const entry = entries.get(key);
      if (entry && Date.now() - entry.at < ttlMs) return entry.value;
      if (entry?.inflight) return entry.inflight;
      const inflight = loader()
        .then((value) => {
          entries.set(key, { at: Date.now(), value, ttlMs });
          return value;
        })
        .finally(() => {
          const current = entries.get(key);
          if (current && current.inflight === inflight) delete current.inflight;
        });
      entries.set(key, { at: entry?.at || 0, value: entry?.value, ttlMs, inflight });
      return inflight;
    },
  };
};

export const createFnoLiveService = ({ fetcher = fetchNseJson, now = () => new Date() } = {}) => {
  const cache = createTtlCache();

  const expiriesFor = async (symbol) => {
    const payload = await cache.load(`expiries:${symbol}`, EXPIRY_TTL_MS, () => fetcher(
      `${NSE_BASE}/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`,
    ));
    const list = [...new Set((payload?.expiryDates || []).map(nseDateToIso).filter(Boolean))].sort();
    return list;
  };

  const chainPayload = async (symbol, expiryIso) => {
    const type = INDEX_FUTURES_KEYS[symbol] ? 'Indices' : 'Equity';
    const url = `${NSE_BASE}/api/option-chain-v3?type=${type}&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(isoToNseDate(expiryIso))}`;
    return cache.load(`chain:${symbol}:${expiryIso}`, CHAIN_TTL_MS, () => fetcher(url));
  };

  const futuresPayload = async (symbol) => {
    const key = INDEX_FUTURES_KEYS[symbol] || 'stock_fut';
    const payload = await cache.load(`futures:${key}`, FUTURES_TTL_MS, () => fetcher(
      `${NSE_BASE}/api/liveEquity-derivatives?index=${key}`,
    ));
    return { key, payload };
  };

  return {
    async expiries({ ticker } = {}) {
      return expiriesFor(String(ticker || '').toUpperCase());
    },
    async chain({ ticker, expiry } = {}) {
      const symbol = String(ticker || '').toUpperCase();
      if (!symbol) return null;
      let target = expiry ? nseDateToIso(expiry) : null;
      const expiries = await expiriesFor(symbol);
      if (!target || !expiries.includes(target)) target = expiries[0] || null;
      if (!target) return null;
      const payload = await chainPayload(symbol, target);
      return parseLiveOptionChain(payload, { ticker: symbol, expiry: target, now: now() });
    },
    async futures({ ticker } = {}) {
      const symbol = String(ticker || '').toUpperCase();
      if (!symbol) return null;
      const { payload } = await futuresPayload(symbol);
      return parseLiveFutures(payload, { ticker: symbol });
    },
    async status() {
      const { payload } = await futuresPayload('NIFTY');
      const asOf = timestampToIso(payload?.timestamp);
      return {
        source: 'NSE intraday derivatives feed',
        tradeDate: asOf ? asOf.slice(0, 10) : istToday(now()),
        asOf,
        exchangeTimestamp: payload?.timestamp || null,
        isLive: true,
        dataQuality: 'Intraday exchange snapshot',
        marketStatus: payload?.marketStatus || null,
      };
    },
  };
};
