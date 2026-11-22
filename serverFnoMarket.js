import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Official NSE F&O end-of-day bhavcopy. The intraday option-chain API is blocked
// for this deployment, so the desk reads the published archive file instead and
// labels every response as end-of-day.
const ARCHIVE_URL = (ymd) => `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${ymd}_F_0000.csv.zip`;
const FETCH_TIMEOUT_MS = 25000;
const SESSION_RETRY_MS = 15 * 60 * 1000;
const MAX_LOOKBACK_DAYS = 10;
const RISK_FREE_RATE = 0.065;
const OPTION_TYPES = new Set(['IDO', 'STO']);
const FUTURES_TYPES = new Set(['IDF', 'STF']);
const INSTRUMENT_LABELS = { IDO: 'Index option', STO: 'Stock option', IDF: 'Index future', STF: 'Stock future' };
const INDEX_ORDER = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'];

export const istDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

const ymd = (isoDate) => isoDate.replace(/-/g, '');

const shiftDate = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const weekday = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

const splitCsvLine = (line) => {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { fields.push(current); current = ''; }
    else current += char;
  }
  fields.push(current);
  return fields;
};

export const readZipEntries = (buffer) => {
  const entries = new Map();
  const minEocd = 22;
  let eocd = -1;
  for (let offset = buffer.length - minEocd; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('The archive is not a readable ZIP file.');
  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('The ZIP central directory is corrupt.');
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('The ZIP local header is corrupt.');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed);
    entries.set(name, data);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const toNumber = (value) => {
  const number = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
};

export const parseBhavcopyCsv = (csv) => {
  const lines = String(csv || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('The F&O bhavcopy is empty.');
  const header = splitCsvLine(lines[0]).map((name) => name.trim());
  const column = (name) => header.indexOf(name);
  const required = ['TradDt', 'FinInstrmTp', 'TckrSymb', 'XpryDt', 'StrkPric', 'OptnTp', 'ClsPric', 'UndrlygPric', 'OpnIntrst'];
  const missing = required.filter((name) => column(name) < 0);
  if (missing.length) throw new Error(`The F&O bhavcopy is missing columns: ${missing.join(', ')}.`);

  const rows = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const instrument = String(values[column('FinInstrmTp')] || '').trim();
    const ticker = String(values[column('TckrSymb')] || '').trim().toUpperCase();
    if (!ticker || (!OPTION_TYPES.has(instrument) && !FUTURES_TYPES.has(instrument))) continue;
    rows.push({
      tradeDate: String(values[column('TradDt')] || '').trim(),
      instrument,
      ticker,
      expiry: String(values[column('XpryDt')] || '').trim(),
      strike: toNumber(values[column('StrkPric')]),
      optionType: String(values[column('OptnTp')] || '').trim().toUpperCase(),
      name: String(values[column('FinInstrmNm')] || '').trim(),
      close: toNumber(values[column('ClsPric')]),
      last: toNumber(values[column('LastPric')]),
      prevClose: toNumber(values[column('PrvsClsgPric')]),
      underlyingPrice: toNumber(values[column('UndrlygPric')]),
      settlement: toNumber(values[column('SttlmPric')]),
      oi: toNumber(values[column('OpnIntrst')]) || 0,
      oiChange: toNumber(values[column('ChngInOpnIntrst')]) || 0,
      volume: toNumber(values[column('TtlTradgVol')]) || 0,
      lotSize: toNumber(values[column('NewBrdLotQty')]),
    });
  }
  return { tradeDate: rows[0]?.tradeDate || null, rows };
};

const yearsBetween = (fromIso, toIso) => {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return (to - from) / (365 * 24 * 3600 * 1000);
};

const normalCdf = (value) => 0.5 * (1 + erf(value / Math.SQRT2));

const erf = (value) => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
};

export const blackScholes = ({ spot, strike, years, volatility, rate = RISK_FREE_RATE, optionType }) => {
  if (!(spot > 0) || !(strike > 0) || !(years > 0)) return null;
  const sigma = Math.max(volatility, 0.0001);
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + (sigma * sigma) / 2) * years) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discount = Math.exp(-rate * years);
  const callPrice = spot * normalCdf(d1) - strike * discount * normalCdf(d2);
  const putPrice = strike * discount * normalCdf(-d2) - spot * normalCdf(-d1);
  const delta = optionType === 'CE' ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = Math.exp(-(d1 * d1) / 2) / (spot * sigma * sqrtT * Math.sqrt(2 * Math.PI));
  const vega = (spot * Math.exp(-(d1 * d1) / 2) * sqrtT) / Math.sqrt(2 * Math.PI) / 100;
  const thetaAnnual = -(spot * Math.exp(-(d1 * d1) / 2) * sigma) / (2 * sqrtT)
    + (optionType === 'CE' ? -rate * strike * discount * normalCdf(d2) : rate * strike * discount * normalCdf(-d2));
  return {
    price: optionType === 'CE' ? callPrice : putPrice,
    delta,
    gamma,
    vega,
    theta: thetaAnnual / 365,
  };
};

export const impliedVolatility = ({ price, spot, strike, years, rate = RISK_FREE_RATE, optionType }) => {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(years > 0)) return null;
  const intrinsic = optionType === 'CE' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const upperBound = optionType === 'CE' ? spot : strike;
  if (price <= intrinsic || price >= upperBound) return null;
  let low = 0.0001;
  let high = 5;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    const model = blackScholes({ spot, strike, years, volatility: mid, rate, optionType });
    if (!model) return null;
    if (model.price < price) low = mid;
    else high = mid;
    if (high - low < 1e-5) break;
  }
  const result = (low + high) / 2;
  return result < 0.0005 || result > 4.9 ? null : result;
};

export const maxPainFrom = (strikes) => {
  const candidates = strikes.filter((row) => Number.isFinite(row.strike));
  if (!candidates.length) return null;
  let best = null;
  for (const candidate of candidates) {
    let loss = 0;
    for (const row of candidates) {
      if (row.call?.oi) loss += Math.max(candidate.strike - row.strike, 0) * row.call.oi;
      if (row.put?.oi) loss += Math.max(row.strike - candidate.strike, 0) * row.put.oi;
    }
    if (!best || loss < best.loss) best = { strike: candidate.strike, loss };
  }
  return best?.strike ?? null;
};

const pcrSentiment = (pcr) => {
  if (pcr == null) return 'Unavailable';
  if (pcr >= 1.2) return 'Call-heavy · bullish tilt';
  if (pcr <= 0.8) return 'Put-heavy · bearish tilt';
  return 'Balanced';
};

const contractRow = (row, tradeDate, expiry) => {
  if (!row) return null;
  const ltp = row.last && row.last > 0 ? row.last : row.close;
  const prev = row.prevClose;
  const change = ltp != null && prev != null ? Math.round((ltp - prev) * 100) / 100 : null;
  const years = yearsBetween(tradeDate, expiry);
  const iv = ltp != null && row.underlyingPrice != null && row.strike != null
    ? impliedVolatility({ price: ltp, spot: row.underlyingPrice, strike: row.strike, years, optionType: row.optionType })
    : null;
  const greeks = iv != null
    ? blackScholes({ spot: row.underlyingPrice, strike: row.strike, years, volatility: iv, optionType: row.optionType })
    : null;
  return {
    symbol: row.name,
    ltp,
    change,
    changePercent: change != null && prev ? Math.round((change / prev) * 10000) / 100 : null,
    oi: row.oi,
    oiChange: row.oiChange,
    volume: row.volume,
    settlement: row.settlement,
    lotSize: row.lotSize,
    iv: iv != null ? Math.round(iv * 1000) / 10 : null,
    delta: greeks ? Math.round(greeks.delta * 1000) / 1000 : null,
    gamma: greeks ? Math.round(greeks.gamma * 10000) / 10000 : null,
    vega: greeks ? Math.round(greeks.vega * 100) / 100 : null,
    theta: greeks ? Math.round(greeks.theta * 100) / 100 : null,
  };
};

export const buildOptionChain = (rows, { ticker, expiry } = {}) => {
  const symbol = String(ticker || '').toUpperCase();
  const options = rows.filter((row) => row.ticker === symbol && OPTION_TYPES.has(row.instrument));
  if (!options.length) return null;
  const expiries = [...new Set(options.map((row) => row.expiry))].filter(Boolean).sort();
  const chosenExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0];
  const selected = options.filter((row) => row.expiry === chosenExpiry);
  if (!selected.length) return null;

  const byStrike = new Map();
  for (const row of selected) {
    if (row.strike == null) continue;
    const entry = byStrike.get(row.strike) || { strike: row.strike, call: null, put: null };
    if (row.optionType === 'CE') entry.call = row;
    else if (row.optionType === 'PE') entry.put = row;
    byStrike.set(row.strike, entry);
  }
  const underlyingPrice = selected.find((row) => row.underlyingPrice != null)?.underlyingPrice ?? null;
  const strikesSorted = [...byStrike.values()].sort((first, second) => first.strike - second.strike);
  const atm = underlyingPrice != null
    ? strikesSorted.reduce((best, current) => (
      Math.abs(current.strike - underlyingPrice) < Math.abs(best.strike - underlyingPrice) ? current : best
    ), strikesSorted[0])?.strike
    : null;

  const strikes = strikesSorted.map((entry) => ({
    strike: entry.strike,
    isAtm: entry.strike === atm,
    distanceFromSpot: underlyingPrice != null ? Math.round((entry.strike - underlyingPrice) * 100) / 100 : null,
    call: contractRow(entry.call, selected[0].tradeDate, chosenExpiry),
    put: contractRow(entry.put, selected[0].tradeDate, chosenExpiry),
  }));
  const totalCallOi = strikes.reduce((sum, row) => sum + (row.call?.oi || 0), 0);
  const totalPutOi = strikes.reduce((sum, row) => sum + (row.put?.oi || 0), 0);
  const pcr = totalCallOi > 0 ? Math.round((totalPutOi / totalCallOi) * 100) / 100 : null;

  return {
    underlying: symbol,
    instrument: INSTRUMENT_LABELS[selected[0].instrument] || 'Option',
    underlyingPrice,
    tradeDate: selected[0].tradeDate,
    expiry: chosenExpiry,
    expiries,
    lotSize: selected.find((row) => row.lotSize)?.lotSize ?? null,
    atmStrike: atm,
    pcr,
    pcrSentiment: pcrSentiment(pcr),
    maxPain: maxPainFrom(strikes),
    totalCallOi,
    totalPutOi,
    strikes,
  };
};

export const buildFuturesBoard = (rows, { ticker } = {}) => {
  const symbol = String(ticker || '').toUpperCase();
  const futures = rows.filter((row) => row.ticker === symbol && FUTURES_TYPES.has(row.instrument));
  if (!futures.length) return null;
  const contracts = futures
    .sort((first, second) => String(first.expiry).localeCompare(String(second.expiry)))
    .map((row) => {
      const price = row.last && row.last > 0 ? row.last : row.close;
      const change = price != null && row.prevClose != null ? Math.round((price - row.prevClose) * 100) / 100 : null;
      return {
        symbol: row.name,
        expiry: row.expiry,
        price,
        change,
        changePercent: change != null && row.prevClose ? Math.round((change / row.prevClose) * 10000) / 100 : null,
        oi: row.oi,
        oiChange: row.oiChange,
        volume: row.volume,
        settlement: row.settlement,
        lotSize: row.lotSize,
        underlyingPrice: row.underlyingPrice,
        basis: price != null && row.underlyingPrice != null ? Math.round((price - row.underlyingPrice) * 100) / 100 : null,
        basisPercent: price != null && row.underlyingPrice
          ? Math.round(((price - row.underlyingPrice) / row.underlyingPrice) * 10000) / 100
          : null,
      };
    });
  return {
    underlying: symbol,
    instrument: INSTRUMENT_LABELS[futures[0].instrument] || 'Futures',
    tradeDate: futures[0].tradeDate,
    underlyingPrice: futures.find((row) => row.underlyingPrice != null)?.underlyingPrice ?? null,
    contracts,
  };
};

export const listFnoUnderlyings = (rows) => {
  const indexes = [];
  const stocks = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.ticker}:${row.instrument.startsWith('ID') ? 'index' : 'stock'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { symbol: row.ticker, kind: row.instrument.startsWith('ID') ? 'index' : 'stock' };
    if (entry.kind === 'index') indexes.push(entry);
    else stocks.push(entry);
  }
  const rank = (entry) => {
    const index = INDEX_ORDER.indexOf(entry.symbol);
    return index < 0 ? INDEX_ORDER.length : index;
  };
  indexes.sort((first, second) => rank(first) - rank(second) || first.symbol.localeCompare(second.symbol));
  stocks.sort((first, second) => first.symbol.localeCompare(second.symbol));
  return [...indexes, ...stocks];
};

const fetchArchive = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShareMarketPro/1.0)', Accept: 'application/zip,application/octet-stream' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The NSE archive returned HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('The NSE archive did not return a ZIP file.');
  return buffer;
};

export const createFnoMarketService = ({ cacheDir, fetcher = fetchArchive, now = () => new Date() } = {}) => {
  const state = { session: null, loadedAt: 0, inflight: null, lastError: null };

  const parseZip = (buffer) => {
    const entries = readZipEntries(buffer);
    const csvEntry = [...entries.entries()].find(([name]) => name.toLowerCase().endsWith('.csv'));
    if (!csvEntry) throw new Error('The NSE archive contained no CSV file.');
    return parseBhavcopyCsv(csvEntry[1].toString('utf8'));
  };

  const loadSession = async () => {
    if (state.session && Date.now() - state.loadedAt < SESSION_RETRY_MS) return state.session;
    if (state.inflight) return state.inflight;
    state.inflight = (async () => {
      const today = istDate(now());
      let lastError = null;
      for (let offset = 0; offset < MAX_LOOKBACK_DAYS; offset += 1) {
        const date = shiftDate(today, -offset);
        if (weekday(date) === 0 || weekday(date) === 6) continue;
        const cachedFile = cacheDir ? path.join(cacheDir, `fo-${date}.zip`) : null;
        try {
          let buffer = null;
          if (cachedFile && fs.existsSync(cachedFile)) buffer = fs.readFileSync(cachedFile);
          if (!buffer) {
            buffer = await fetcher(ARCHIVE_URL(ymd(date)));
            if (buffer && cachedFile) {
              fs.mkdirSync(cacheDir, { recursive: true });
              fs.writeFileSync(cachedFile, buffer);
            }
          }
          if (!buffer) continue;
          const parsed = parseZip(buffer);
          state.session = { ...parsed, sourceDate: date, sourceUrl: ARCHIVE_URL(ymd(date)), loadedAt: new Date().toISOString() };
          state.loadedAt = Date.now();
          state.lastError = null;
          return state.session;
        } catch (error) {
          lastError = error;
        }
      }
      state.lastError = lastError?.message || 'No F&O bhavcopy was found for the last ten trading days.';
      if (state.session) return { ...state.session, stale: true };
      throw Object.assign(new Error(state.lastError), { code: 'fno_feed_unavailable' });
    })().finally(() => { state.inflight = null; });
    return state.inflight;
  };

  return {
    async status() {
      const session = await loadSession();
      return {
        source: 'NSE F&O bhavcopy (end-of-day)',
        tradeDate: session.tradeDate,
        asOf: session.tradeDate,
        isLive: false,
        dataQuality: 'End-of-day official NSE archive; not an intraday feed.',
        stale: Boolean(session.stale),
        rowCount: session.rows.length,
        underlyings: listFnoUnderlyings(session.rows),
        loadedAt: session.loadedAt,
      };
    },
    async chain({ ticker, expiry } = {}) {
      const session = await loadSession();
      const chain = buildOptionChain(session.rows, { ticker, expiry });
      if (!chain) return null;
      return { ...chain, source: 'NSE F&O bhavcopy', isLive: false, dataQuality: 'End-of-day', stale: Boolean(session.stale) };
    },
    async futures({ ticker } = {}) {
      const session = await loadSession();
      const board = buildFuturesBoard(session.rows, { ticker });
      if (!board) return null;
      return { ...board, source: 'NSE F&O bhavcopy', isLive: false, dataQuality: 'End-of-day', stale: Boolean(session.stale) };
    },
  };
};

export const registerFnoRoutes = (app, { cacheDir, live = null } = {}) => {
  const service = createFnoMarketService({ cacheDir });

  const handle = (res, error) => {
    if (error?.code === 'fno_feed_unavailable') {
      return res.status(503).json({
        error: 'The official NSE F&O bhavcopy could not be loaded right now, so no derivative prices are shown.',
        code: error.code,
        detail: error.message,
      });
    }
    return res.status(502).json({ error: 'The F&O desk could not complete this request.', code: 'fno_failed' });
  };

  app.get('/api/fno/status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let liveStatus = null;
    if (live) {
      try {
        liveStatus = await live.status();
      } catch {
        liveStatus = null;
      }
    }
    try {
      const eod = await service.status();
      res.json({
        ...eod,
        live: liveStatus,
        isLive: Boolean(liveStatus),
        asOf: liveStatus?.asOf || eod.asOf,
        marketStatus: liveStatus?.marketStatus || null,
      });
    } catch (error) {
      if (liveStatus) return res.json({ ...liveStatus, underlyings: [], stale: false });
      handle(res, error);
    }
  });

  app.get(['/api/fno/option-chain', '/api/analytics/options-chain'], async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ticker = String(req.query.underlying || 'NIFTY').trim().toUpperCase();
    if (!/^[A-Z0-9&.-]{2,24}$/.test(ticker)) {
      return res.status(400).json({ error: 'underlying must be an NSE F&O symbol.', code: 'invalid_underlying' });
    }
    const expiry = String(req.query.expiry || '').trim() || undefined;
    if (live) {
      try {
        const chain = await live.chain({ ticker, expiry });
        if (chain) return res.json(chain);
      } catch {
        // Intraday feed failed; fall back to the official end-of-day archive below.
      }
    }
    try {
      const chain = await service.chain({ ticker, expiry });
      if (!chain) return res.status(404).json({ error: `No listed options were found for ${ticker}.`, code: 'unknown_underlying' });
      res.json(chain);
    } catch (error) {
      handle(res, error);
    }
  });

  app.get('/api/fno/futures', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ticker = String(req.query.underlying || 'NIFTY').trim().toUpperCase();
    if (!/^[A-Z0-9&.-]{2,24}$/.test(ticker)) {
      return res.status(400).json({ error: 'underlying must be an NSE F&O symbol.', code: 'invalid_underlying' });
    }
    if (live) {
      try {
        const board = await live.futures({ ticker });
        if (board) return res.json(board);
      } catch {
        // Live watch can miss inactive stock futures; fall back to the archive.
      }
    }
    try {
      const board = await service.futures({ ticker });
      if (!board) return res.status(404).json({ error: `No listed futures were found for ${ticker}.`, code: 'unknown_underlying' });
      res.json(board);
    } catch (error) {
      handle(res, error);
    }
  });
};
