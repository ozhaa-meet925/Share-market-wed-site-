const NSE_HOME_URL = 'https://www.nseindia.com/';
const NSE_ALL_INDICES_URL = 'https://www.nseindia.com/api/allIndices';
const NSE_INDICES_PAGE_URL = 'https://www.nseindia.com/market-data/live-market-indices';
const CACHE_MS = 15_000;
const FAILURE_BACKOFF_MS = 30_000;
const COOKIE_TTL_MS = 10 * 60 * 1000;
const LIVE_MAX_AGE_MS = 120_000;
const DELAYED_MAX_AGE_MS = 15 * 60 * 1000;

export const NSE_INDEX_MAP = Object.freeze({
  NIFTY: 'NIFTY 50',
  BANKNIFTY: 'NIFTY BANK',
  NIFTYIT: 'NIFTY IT',
  NIFTYMIDCAP: 'NIFTY MIDCAP 150',
});

const cleanSymbol = (symbol) => String(symbol || '')
  .replace(/^(NSE|BSE|MCX|GLOBAL):/i, '')
  .replace(/\.BSE$|\.NSE$/i, '')
  .toUpperCase();

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const parseFeedTimestamp = (value) => {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const month = MONTHS.indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  const utc = Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]) - 5, Number(match[5]) - 30);
  return Number.isFinite(utc) ? utc : null;
};

const istDateKey = (timestampMs) => new Date(timestampMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const isNseSessionOpen = (now = Date.now()) => {
  const ist = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
};

export const normalizeNseIndexPayload = (payload, now = Date.now()) => {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const feedTimestamp = parseFeedTimestamp(payload?.timestamp);
  const marketOpen = isNseSessionOpen(now);
  const sameSession = feedTimestamp !== null && istDateKey(feedTimestamp) === istDateKey(now);
  const ageMs = feedTimestamp === null ? null : Math.max(0, now - feedTimestamp);
  const fresh = sameSession && ageMs !== null && ageMs <= LIVE_MAX_AGE_MS;
  const isLive = marketOpen && fresh;
  const isDelayed = marketOpen && sameSession && !fresh && ageMs !== null && ageMs <= DELAYED_MAX_AGE_MS;
  const isClose = !marketOpen || !sameSession;
  const isStale = !isClose && !isLive && !isDelayed;

  const quotes = {};
  for (const [symbol, indexName] of Object.entries(NSE_INDEX_MAP)) {
    const row = rows.find((item) => item && item.index === indexName);
    const price = Number(row?.last);
    if (!(price > 0)) continue;
    const previousClose = Number(row?.previousClose);
    const change = Number(row?.variation);
    const changePercent = Number(row?.percentChange);
    quotes[symbol] = {
      symbol,
      label: indexName,
      c: price,
      d: Number.isFinite(change) ? change : null,
      dp: Number.isFinite(changePercent) ? changePercent : null,
      pc: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
      o: Number(row?.open) || null,
      h: Number(row?.high) || null,
      l: Number(row?.low) || null,
      v: null,
      yearHigh: Number(row?.yearHigh) || null,
      yearLow: Number(row?.yearLow) || null,
      advances: Number(row?.advances),
      declines: Number(row?.declines),
      timestamp: feedTimestamp === null ? null : new Date(feedTimestamp).toISOString(),
      provider: 'NSE India',
      providerUrl: NSE_INDICES_PAGE_URL,
      marketType: 'index',
      liveFeed: 'nse',
      marketOpen,
      isLive,
      isDelayed,
      isClose,
      isStale,
      isResearch: false,
      isReal: true,
      isDemo: false,
    };
  }
  return { quotes, feedTimestamp, marketOpen, ageMs, isLive };
};

export const isNseIndexSymbol = (symbol) => Object.hasOwn(NSE_INDEX_MAP, cleanSymbol(symbol));

let cookieJar = { value: '', fetchedAt: 0 };
let cache = null;
let inflight = null;
let lastFailure = { at: 0, message: '' };

const requestHeaders = () => ({
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-IN,en;q=0.9',
  Referer: NSE_INDICES_PAGE_URL,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
});

const refreshCookies = async () => {
  const response = await fetch(NSE_HOME_URL, {
    headers: { ...requestHeaders(), Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(15_000),
  });
  const cookies = (response.headers.getSetCookie?.() || [])
    .map((line) => String(line).split(';')[0])
    .filter(Boolean)
    .join('; ');
  if (!cookies) throw new Error('NSE did not issue a session cookie');
  cookieJar = { value: cookies, fetchedAt: Date.now() };
};

const requestAllIndices = async (forceCookies = false) => {
  if (forceCookies || !cookieJar.value || Date.now() - cookieJar.fetchedAt > COOKIE_TTL_MS) {
    await refreshCookies();
  }
  const response = await fetch(NSE_ALL_INDICES_URL, {
    headers: { ...requestHeaders(), Cookie: cookieJar.value },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    await refreshCookies();
    return fetch(NSE_ALL_INDICES_URL, {
      headers: { ...requestHeaders(), Cookie: cookieJar.value },
      signal: AbortSignal.timeout(15_000),
    });
  }
  return response;
};

const fetchFeed = async () => {
  const response = await requestAllIndices();
  if (response.status !== 200) throw new Error(`NSE allIndices returned ${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    throw new Error('NSE returned an unexpected allIndices payload');
  }
  return payload;
};

export const getNseIndexQuotes = async (symbols) => {
  const wanted = [...new Set(symbols.map(cleanSymbol).filter((symbol) => Object.hasOwn(NSE_INDEX_MAP, symbol)))];
  if (!wanted.length) return {};

  const now = Date.now();
  if (!cache || now - cache.fetchedAt >= CACHE_MS) {
    const backedOff = lastFailure.at && now - lastFailure.at < FAILURE_BACKOFF_MS;
    if (!backedOff) {
      if (!inflight) {
        inflight = fetchFeed()
          .then((payload) => {
            cache = { payload, fetchedAt: Date.now() };
            lastFailure = { at: 0, message: '' };
            return cache;
          })
          .catch((error) => {
            lastFailure = { at: Date.now(), message: error.message };
            throw error;
          })
          .finally(() => { inflight = null; });
      }
      try {
        await inflight;
      } catch (error) {
        if (!cache) throw error;
      }
    }
  }

  if (!cache) throw new Error('NSE index feed is unavailable');
  const normalized = normalizeNseIndexPayload(cache.payload, Date.now());
  const quotes = {};
  for (const symbol of wanted) {
    if (normalized.quotes[symbol]) quotes[symbol] = normalized.quotes[symbol];
  }
  return quotes;
};

export const getNseIndexFeedStatus = () => ({
  provider: 'NSE India',
  page: NSE_INDICES_PAGE_URL,
  configured: true,
  lastFetchedAt: cache ? new Date(cache.fetchedAt).toISOString() : null,
  lastFailureAt: lastFailure.at ? new Date(lastFailure.at).toISOString() : null,
  lastError: lastFailure.message || null,
  symbols: Object.keys(NSE_INDEX_MAP),
});
