import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import {
  getYahooResearchHistory,
  getYahooResearchProviderName,
  getYahooResearchQuotes,
  isYahooResearchEnabled,
} from './yfinanceResearchProvider.js';

const CATALOG_PATH = path.join(process.cwd(), 'public', 'all_companies.json');
const CATALOG_CACHE_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_CACHE_MS = 60 * 1000;
const HISTORY_DAYS = 3650;
const LLM_TIMEOUT_MS = 25_000;
const INDEX_SYMBOLS = new Set(['NIFTY', 'SENSEX', 'BANKNIFTY', 'NIFTYIT', 'NIFTYMIDCAP']);
const INDEX_LABELS = {
  NIFTY: 'NIFTY 50',
  SENSEX: 'BSE SENSEX',
  BANKNIFTY: 'NIFTY BANK',
  NIFTYIT: 'NIFTY IT',
  NIFTYMIDCAP: 'NIFTY MIDCAP 150',
};
const NON_COMPANY_TOKENS = new Set([
  'what', 'which', 'when', 'why', 'how', 'the', 'and', 'for', 'today', 'now', 'market', 'markets',
  'stock', 'stocks', 'share', 'shares', 'price', 'trend', 'analysis', 'analyze', 'analyse', 'compare',
  'buy', 'sell', 'hold', 'good', 'best', 'strong', 'bullish', 'bearish', 'nifty', 'sensex', 'portfolio',
  'gold', 'silver', 'india', 'indian', 'should', 'invest', 'investing', 'level', 'levels', 'support',
  'resistance', 'volume', 'rsi', 'macd', 'sma', 'ema', 'about', 'tell', 'this', 'that', 'momentum',
  'gainers', 'losers', 'breakout', 'breakdown', 'screener', 'screen', 'top', 'list', 'find',
  'all', 'any', 'each', 'every', 'company', 'companies', 'data', 'year', 'years', 'history',
  'historical', 'long', 'term', 'with', 'from', 'last', 'past', 'give', 'show', 'me', 'please',
  'can', 'will', 'would', 'could', 'does', 'did', 'is', 'are', 'was', 'were', 'be', 'has', 'have',
  'up', 'down', 'go', 'going', 'rise', 'fall', 'increase', 'decrease', 'future', 'predict',
  'prediction', 'forecast', 'target', 'probability', 'likely', 'chance', 'kya', 'hai', 'hoga',
  'jayega', 'upar', 'neeche', 'mein', 'ya', 'ka', 'ki', 'ke', 'high', 'low', 'highs', 'lows',
  'highest', 'lowest', 'range', '52', 'week', 'weeks', 'month', 'months', 'ten', 'decade',
  'decades', 'near', 'time', 'cagr', 'drawdown', 'return', 'returns', 'suggestion', 'suggestions',
  'batao', 'bata', 'dikhao', 'chahiye', 'kar', 'karo', 'de', 'do', 'of', 'at', 'on', 'in', 'to',
  'its', 'their', 'my', 'our', 'a', 'an', 'meaning', 'define', 'definition', 'explain', 'difference',
  'differ', 'versus', 'vs', 'mutual', 'fund', 'funds', 'etf', 'etfs', 'index', 'indices', 'scheme',
  'schemes', 'nav', 'amc', 'dividend', 'dividends', 'ipo', 'bond', 'bonds', 'futures', 'options',
  'derivative', 'derivatives', 'commodity', 'commodities', 'crypto', 'kya', 'matlab', 'samjhao',
  'stop', 'stoploss', 'loss', 'losses', 'profit', 'gains', 'trade', 'trades', 'trading', 'trader',
]);

const catalogCache = { entries: null, loadedAt: 0 };
const catalogRequest = { pending: null };
const snapshotCache = new Map();
const snapshotRequests = new Map();

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const isNum = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));
const round = (value, digits = 2) => (isNum(value) ? Number(Number(value).toFixed(digits)) : null);
const money = (value) => (isNum(value) && Number(value) > 0 ? `₹${inr.format(Number(value))}` : 'unavailable');
const pct = (value, digits = 2) => (isNum(value) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}%` : 'unavailable');

const formatIst = (timestamp) => {
  if (!isNum(timestamp) || Number(timestamp) <= 0) return null;
  const ms = Number(timestamp) < 1e12 ? Number(timestamp) * 1000 : Number(timestamp);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const formatIstDate = (timestamp) => {
  if (!isNum(timestamp) || Number(timestamp) <= 0) return null;
  const ms = Number(timestamp) < 1e12 ? Number(timestamp) * 1000 : Number(timestamp);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

const standardDeviation = (values) => {
  if (values.length < 2) return null;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

const smaLast = (closes, period) => (closes.length < period ? null : average(closes.slice(-period)));

const smaAt = (closes, period, offsetFromEnd = 0) => {
  const end = closes.length - offsetFromEnd;
  if (end < period) return null;
  return average(closes.slice(end - period, end));
};

const changeFromBarsAgo = (closes, bars, price) => {
  if (!(closes.length > bars) || !(price > 0)) return null;
  const base = closes[closes.length - 1 - bars];
  return base > 0 ? ((price / base) - 1) * 100 : null;
};

const maxDrawdownPercent = (closes) => {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  for (const close of closes) {
    if (close > peak) peak = close;
    else if (peak > 0) worst = Math.min(worst, (close / peak - 1) * 100);
  }
  return worst;
};

const emaSeries = (values, period) => {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  const series = [];
  let ema = average(values.slice(0, period));
  series.push(ema);
  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
    series.push(ema);
  }
  return series;
};

const rsiLast = (closes, period = 14) => {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    avgGain = (avgGain * (period - 1) + (delta > 0 ? delta : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (delta < 0 ? -delta : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const strength = avgGain / avgLoss;
  return 100 - 100 / (1 + strength);
};

const macdLast = (closes) => {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  if (!ema12.length || !ema26.length) return null;
  const offset = ema12.length - ema26.length;
  const macdLine = ema26.map((value, index) => ema12[index + offset] - value);
  const signalSeries = emaSeries(macdLine, 9);
  if (!signalSeries.length) return null;
  const macd = macdLine[macdLine.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  return { macd: round(macd), signal: round(signal), histogram: round(macd - signal) };
};

const bollingerLast = (closes, period = 20) => {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const middle = average(window);
  const deviation = standardDeviation(window);
  if (!isNum(middle) || !isNum(deviation)) return null;
  return {
    middle: round(middle),
    upper: round(middle + deviation * 2),
    lower: round(middle - deviation * 2),
    widthPercent: round(((deviation * 4) / middle) * 100),
  };
};

const atrLast = (candles, period = 14) => {
  if (candles.length < period + 1) return null;
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  return average(trueRanges.slice(-period));
};

const annualisedVolatility = (closes, period = 20) => {
  if (closes.length < period + 1) return null;
  const returns = [];
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    if (!(previous > 0)) continue;
    returns.push(Math.log(closes[index] / previous));
  }
  const deviation = standardDeviation(returns);
  return isNum(deviation) ? deviation * Math.sqrt(252) * 100 : null;
};

const swingLevels = (candles, price) => {
  const window = candles.slice(-90);
  const pivotLows = [];
  const pivotHighs = [];
  for (let index = 2; index < window.length - 2; index += 1) {
    const low = window[index].low;
    const high = window[index].high;
    if (low <= window[index - 1].low && low <= window[index - 2].low
      && low <= window[index + 1].low && low <= window[index + 2].low) pivotLows.push(low);
    if (high >= window[index - 1].high && high >= window[index - 2].high
      && high >= window[index + 1].high && high >= window[index + 2].high) pivotHighs.push(high);
  }
  const recent = candles.slice(-20);
  const twentyDayLow = recent.length ? Math.min(...recent.map((candle) => candle.low)) : null;
  const twentyDayHigh = recent.length ? Math.max(...recent.map((candle) => candle.high)) : null;
  const yearWindow = candles.slice(-252);
  const yearLow = yearWindow.length ? Math.min(...yearWindow.map((candle) => candle.low)) : null;
  const yearHigh = yearWindow.length ? Math.max(...yearWindow.map((candle) => candle.high)) : null;
  const gap = price * 0.003;
  const pivotSupport = pivotLows.filter((level) => level < price - gap).sort((a, b) => b - a)[0] ?? null;
  const pivotResistance = pivotHighs.filter((level) => level > price + gap).sort((a, b) => a - b)[0] ?? null;
  const support = pivotSupport ?? (isNum(twentyDayLow) && twentyDayLow < price - gap ? twentyDayLow : null);
  const resistance = pivotResistance
    ?? (isNum(twentyDayHigh) && twentyDayHigh > price + gap ? twentyDayHigh : null)
    ?? (isNum(yearHigh) && yearHigh > price + gap ? yearHigh : null);
  return {
    support: round(support),
    resistance: round(resistance),
    twentyDayLow: round(twentyDayLow),
    twentyDayHigh: round(twentyDayHigh),
  };
};

const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(ltd|limited|india|corporation|corp|company|co|the|plc)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const loadCatalog = async () => {
  if (catalogCache.entries && Date.now() - catalogCache.loadedAt < CATALOG_CACHE_MS) return catalogCache.entries;
  if (catalogRequest.pending) return catalogRequest.pending;
  catalogRequest.pending = (async () => {
    try {
      const raw = await fs.promises.readFile(CATALOG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = (Array.isArray(parsed) ? parsed : [])
        .map((item) => ({
          symbol: String(item?.symbol || '').trim().toUpperCase(),
          exchange: String(item?.exchange || '').trim().toUpperCase() === 'BSE' ? 'BSE' : 'NSE',
          name: String(item?.description || item?.name || '').trim(),
        }))
        .filter((item) => item.symbol)
        .map((item) => ({ ...item, normalized: normalizeName(item.name) }));
      catalogCache.entries = entries;
      catalogCache.loadedAt = Date.now();
      return entries;
    } catch {
      return [];
    } finally {
      catalogRequest.pending = null;
    }
  })();
  return catalogRequest.pending;
};

const detectIndexes = (query) => {
  const found = [];
  const checks = [
    { symbol: 'BANKNIFTY', pattern: /\bbank\s*nifty\b|\bnifty\s*bank\b/i },
    { symbol: 'NIFTYIT', pattern: /\bnifty\s*it\b/i },
    { symbol: 'NIFTYMIDCAP', pattern: /\bnifty\s*midcap\b/i },
    { symbol: 'SENSEX', pattern: /\bsensex\b/i },
    { symbol: 'NIFTY', pattern: /\bnifty\b/i },
  ];
  checks.forEach((check) => {
    if (check.pattern.test(query) && !found.includes(check.symbol)) found.push(check.symbol);
  });
  return found;
};

export const resolveInstruments = async (message, context = {}) => {
  const query = String(message || '');
  const tokens = query.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const results = [];
  const add = (instrument) => {
    if (instrument && !results.some((item) => item.symbol === instrument.symbol)) results.push(instrument);
  };

  if (context.symbol && !['GOLD', 'SILVER'].includes(String(context.symbol).toUpperCase())) {
    const inMessage = tokens.includes(String(context.symbol).toUpperCase());
    if (inMessage) {
      add({
        symbol: String(context.symbol).toUpperCase(),
        exchange: String(context.exchange || 'NSE').toUpperCase() === 'BSE' ? 'BSE' : 'NSE',
        name: context.name || String(context.symbol).toUpperCase(),
        kind: 'equity',
      });
    }
  }

  const indexes = detectIndexes(query);
  if (indexes.length) return indexes.map((symbol) => ({
    symbol,
    exchange: 'NSE',
    name: INDEX_LABELS[symbol],
    kind: 'index',
  }));

  const catalog = await loadCatalog();
  const upperTokens = new Set(tokens.filter((token) => !NON_COMPANY_TOKENS.has(token.toLowerCase()) && !/^\d+$/.test(token)));
  const companyTokens = [...upperTokens];
  const normalizedQuery = normalizeName(query);
  const paddedQuery = ` ${normalizedQuery} `;
  const scored = [];
  for (const entry of catalog) {
    const nameTokens = entry.normalized ? entry.normalized.split(' ') : [];
    const coverage = companyTokens.length
      ? companyTokens.filter((token) => entry.symbol === token
        || nameTokens.includes(token.toLowerCase())).length / companyTokens.length
      : 0;
    let score = 0;
    if (upperTokens.has(entry.symbol)) score = 100 * Math.max(coverage, 0.4);
    else if (entry.normalized && entry.normalized === normalizedQuery) score = 90;
    else if (entry.normalized.length >= 4 && paddedQuery.includes(` ${entry.normalized} `)) score = 85;
    else if (entry.normalized) {
      const matched = nameTokens.filter((token) => (
        token.length >= 4
        && !NON_COMPANY_TOKENS.has(token)
        && upperTokens.has(token.toUpperCase())
      ));
      if (matched.length) score = (55 + Math.max(...matched.map((token) => token.length))) * Math.max(coverage, 0.5);
    }
    if (score) scored.push({ ...entry, score });
  }
  scored.sort((first, second) => second.score - first.score || second.normalized.length - first.normalized.length);
  scored.slice(0, 3).forEach((entry) => add({
    symbol: entry.symbol,
    exchange: entry.exchange,
    name: entry.name || entry.symbol,
    normalized: entry.normalized,
    kind: 'equity',
  }));

  if (!results.length && context.symbol) {
    add({
      symbol: String(context.symbol).toUpperCase(),
      exchange: String(context.exchange || 'NSE').toUpperCase() === 'BSE' ? 'BSE' : 'NSE',
      name: context.name || String(context.symbol).toUpperCase(),
      kind: 'equity',
    });
  }

  if (results.length > 1 && !/\b(compare|comparison|vs|versus|and)\b/i.test(query)) {
    const [first] = results;
    return results.slice(0, 2).filter((item, index) => index === 0
      || (item.normalized && first.normalized && item.normalized.startsWith(`${first.normalized} `)));
  }
  return results;
};

const buildSnapshot = (instrument, quote, history) => {
  const candles = Array.isArray(history?.candles) ? history.candles : [];
  const closes = candles.map((candle) => candle.close).filter((value) => value > 0);
  const volumes = candles.map((candle) => (isNum(candle.value) ? Number(candle.value) : null));
  const price = Number(quote?.c) > 0 ? Number(quote.c) : closes[closes.length - 1] ?? null;
  if (!(price > 0)) return null;

  const previousClose = Number(quote?.pc) > 0 ? Number(quote.pc) : (closes.length > 1 ? closes[closes.length - 2] : null);
  const change = isNum(quote?.d) ? Number(quote.d) : (isNum(previousClose) ? price - previousClose : null);
  const changePercent = isNum(quote?.dp)
    ? Number(quote.dp)
    : (isNum(previousClose) && previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null);

  const rsi = rsiLast(closes);
  const sma20 = smaLast(closes, 20);
  const sma50 = smaLast(closes, 50);
  const sma200 = smaLast(closes, 200);
  const ema21 = emaSeries(closes, 21).at(-1) ?? null;
  const macd = macdLast(closes);
  const bollinger = bollingerLast(closes);
  const atr = atrLast(candles);
  const volatility = annualisedVolatility(closes);
  const levels = swingLevels(candles, price);
  const volumeWindow = volumes.slice(-21, -1).filter((value) => isNum(value) && value > 0);
  const volumeAverage = average(volumeWindow);
  const latestVolume = volumes.at(-1);
  const yearCandles = candles.slice(-252);
  const yearHigh = yearCandles.length ? Math.max(...yearCandles.map((candle) => candle.high)) : null;
  const yearLow = yearCandles.length ? Math.min(...yearCandles.map((candle) => candle.low)) : null;

  const firstClose = closes[0];
  const firstTime = candles[0]?.time;
  const lastTime = candles.at(-1)?.time;
  const historyYears = isNum(firstTime) && isNum(lastTime) && Number(lastTime) > Number(firstTime)
    ? (Number(lastTime) - Number(firstTime)) / (365.25 * 24 * 60 * 60)
    : null;
  const totalReturnPercent = isNum(firstClose) && firstClose > 0 ? ((price / firstClose) - 1) * 100 : null;
  const cagrPercent = isNum(totalReturnPercent) && isNum(historyYears) && historyYears >= 1
    ? ((price / firstClose) ** (1 / historyYears) - 1) * 100
    : null;
  const oneYearReturnPercent = changeFromBarsAgo(closes, 252, price);
  const threeYearReturnPercent = changeFromBarsAgo(closes, 756, price);
  const fiveYearReturnPercent = changeFromBarsAgo(closes, 1260, price);
  const maxDrawdown = maxDrawdownPercent(closes);
  let windowHigh = null;
  let windowLow = null;
  let windowHighDate = null;
  let windowLowDate = null;
  candles.forEach((candle) => {
    if (isNum(candle.high) && candle.high > 0 && (!isNum(windowHigh) || candle.high > windowHigh)) {
      windowHigh = Number(candle.high);
      windowHighDate = formatIstDate(candle.time);
    }
    if (isNum(candle.low) && candle.low > 0 && (!isNum(windowLow) || candle.low < windowLow)) {
      windowLow = Number(candle.low);
      windowLowDate = formatIstDate(candle.time);
    }
  });
  const fromHighPercent = isNum(windowHigh) && windowHigh > 0 ? ((price / windowHigh) - 1) * 100 : null;
  const fromLowPercent = isNum(windowLow) && windowLow > 0 ? ((price / windowLow) - 1) * 100 : null;
  const rangePositionPercent = isNum(windowHigh) && isNum(windowLow) && windowHigh > windowLow
    ? ((price - windowLow) / (windowHigh - windowLow)) * 100
    : null;
  const sma200Prior = smaAt(closes, 200, 20);
  const sma200SlopePercent = isNum(sma200) && isNum(sma200Prior) && sma200Prior > 0
    ? ((sma200 / sma200Prior) - 1) * 100
    : null;

  let longTermScore = 0;
  const longTermReasons = [];
  if (isNum(sma200)) {
    if (price > sma200) { longTermScore += 1; longTermReasons.push('ltAboveSma200'); } else { longTermScore -= 1; longTermReasons.push('ltBelowSma200'); }
  }
  if (isNum(sma50) && isNum(sma200)) {
    if (sma50 > sma200) { longTermScore += 1; longTermReasons.push('ltGoldenCross'); } else { longTermScore -= 1; longTermReasons.push('ltDeathCross'); }
  }
  if (isNum(sma200SlopePercent)) {
    if (sma200SlopePercent > 0) { longTermScore += 1; longTermReasons.push('ltSma200Rising'); } else { longTermScore -= 1; longTermReasons.push('ltSma200Falling'); }
  }
  if (isNum(oneYearReturnPercent)) {
    if (oneYearReturnPercent > 0) { longTermScore += 1; longTermReasons.push('ltPositiveYear'); } else { longTermScore -= 1; longTermReasons.push('ltNegativeYear'); }
  }
  const longTermTrend = !isNum(sma200) || !isNum(oneYearReturnPercent)
    ? null
    : longTermScore >= 2 ? 'bullish' : longTermScore <= -2 ? 'bearish' : 'neutral';
  const longTermBias = longTermTrend === 'bullish' ? 'up' : longTermTrend === 'bearish' ? 'down' : longTermTrend === 'neutral' ? 'sideways' : null;

  let trendScore = 0;
  const reasons = [];
  if (isNum(sma20)) {
    if (price > sma20) { trendScore += 1; reasons.push('priceAboveSma20'); } else { trendScore -= 1; reasons.push('priceBelowSma20'); }
  }
  if (isNum(sma20) && isNum(sma50)) {
    if (sma20 > sma50) { trendScore += 1; reasons.push('sma20AboveSma50'); } else { trendScore -= 1; reasons.push('sma20BelowSma50'); }
  }
  if (macd && isNum(macd.histogram)) {
    if (macd.histogram > 0) { trendScore += 1; reasons.push('macdPositive'); } else { trendScore -= 1; reasons.push('macdNegative'); }
  }
  if (isNum(rsi)) {
    if (rsi >= 55) { trendScore += 1; reasons.push('rsiStrong'); } else if (rsi <= 45) { trendScore -= 1; reasons.push('rsiWeak'); }
  }
  const trend = trendScore >= 2 ? 'bullish' : trendScore <= -2 ? 'bearish' : 'neutral';

  return {
    symbol: instrument.symbol,
    name: instrument.name || INDEX_LABELS[instrument.symbol] || instrument.symbol,
    exchange: instrument.exchange,
    kind: instrument.kind,
    price: round(price),
    change: round(change),
    changePercent: round(changePercent),
    previousClose: round(previousClose),
    dayHigh: round(quote?.h),
    dayLow: round(quote?.l),
    dayOpen: round(quote?.o),
    volume: isNum(quote?.v) ? Number(quote.v) : (isNum(latestVolume) ? Number(latestVolume) : null),
    asOf: quote?.timestamp ? formatIst(quote.timestamp) : (candles.length ? formatIst(candles.at(-1).time) : null),
    asOfIso: quote?.timestamp ? new Date((Number(quote.timestamp) < 1e12 ? Number(quote.timestamp) * 1000 : Number(quote.timestamp))).toISOString() : null,
    dataProvider: getYahooResearchProviderName(),
    isLive: false,
    isDelayed: true,
    isResearch: true,
    historyBars: candles.length,
    indicators: {
      rsi14: round(rsi),
      sma20: round(sma20),
      sma50: round(sma50),
      sma200: round(sma200),
      ema21: round(ema21),
      macd,
      bollinger,
      atr14: round(atr),
      atrPercent: isNum(atr) && price > 0 ? round((atr / price) * 100) : null,
      volatility20Annualised: round(volatility),
      volumeAverage20: round(volumeAverage, 0),
      volumeRatio: isNum(volumeAverage) && volumeAverage > 0 && isNum(latestVolume)
        ? round(Number(latestVolume) / volumeAverage)
        : null,
    },
    levels: {
      ...levels,
      yearHigh: round(yearHigh),
      yearLow: round(yearLow),
    },
    momentum: {
      week1Percent: closes.length > 6 ? round(((price / closes[closes.length - 6]) - 1) * 100) : null,
      month1Percent: closes.length > 22 ? round(((price / closes[closes.length - 22]) - 1) * 100) : null,
    },
    trend,
    trendScore,
    trendReasons: reasons,
    longTerm: {
      bars: candles.length,
      firstBar: candles.length ? formatIstDate(firstTime) : null,
      lastBar: candles.length ? formatIstDate(lastTime) : null,
      years: round(historyYears, 1),
      totalReturnPercent: round(totalReturnPercent),
      cagrPercent: round(cagrPercent),
      oneYearReturnPercent: round(oneYearReturnPercent),
      threeYearReturnPercent: round(threeYearReturnPercent),
      fiveYearReturnPercent: round(fiveYearReturnPercent),
      maxDrawdownPercent: round(maxDrawdown),
      windowHigh: round(windowHigh),
      windowHighDate,
      windowLow: round(windowLow),
      windowLowDate,
      fromHighPercent: round(fromHighPercent),
      fromLowPercent: round(fromLowPercent),
      rangePositionPercent: round(rangePositionPercent, 1),
      sma200: round(sma200),
      sma200SlopePercent: round(sma200SlopePercent),
      priceVsSma200Percent: isNum(sma200) && sma200 > 0 ? round(((price / sma200) - 1) * 100) : null,
      trend: longTermTrend,
      bias: longTermBias,
      score: longTermScore,
      checks: longTermReasons.length,
      reasons: longTermReasons,
    },
  };
};

const istDate = (ms) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(ms));

const fetchSnapshot = async (instrument) => {
  const key = `${instrument.exchange}:${instrument.symbol}`;
  const cached = snapshotCache.get(key);
  if (cached && Date.now() - cached.savedAt < SNAPSHOT_CACHE_MS) return cached.value;
  if (snapshotRequests.has(key)) return snapshotRequests.get(key);

  const request = (async () => {
    const requested = `${instrument.exchange}:${instrument.symbol}`;
    const fromMs = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const toMs = Date.now() + 24 * 60 * 60 * 1000;
    const [quotes, history] = await Promise.all([
      getYahooResearchQuotes([requested]).catch(() => ({})),
      getYahooResearchHistory({
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        from: Math.floor(fromMs / 1000),
        to: Math.floor(toMs / 1000),
        start: istDate(fromMs),
        end: istDate(toMs),
        resolution: '1d',
      }).catch(() => null),
    ]);
    const quote = quotes?.[instrument.symbol] || null;
    const snapshot = buildSnapshot(instrument, quote, history);
    if (snapshot) snapshotCache.set(key, { value: snapshot, savedAt: Date.now() });
    while (snapshotCache.size > 300) snapshotCache.delete(snapshotCache.keys().next().value);
    return snapshot;
  })().finally(() => snapshotRequests.delete(key));

  snapshotRequests.set(key, request);
  return request;
};

const reasonText = (reason, snapshot, language) => {
  const { indicators, price } = snapshot;
  const hindi = language === 'hi';
  const map = {
    priceAboveSma20: () => (hindi
      ? `Price ₹${inr.format(price)} 20-day SMA ₹${inr.format(indicators.sma20)} se upar hai`
      : `Price ₹${inr.format(price)} is above the 20-day SMA (₹${inr.format(indicators.sma20)})`),
    priceBelowSma20: () => (hindi
      ? `Price ₹${inr.format(price)} 20-day SMA ₹${inr.format(indicators.sma20)} se neeche hai`
      : `Price ₹${inr.format(price)} is below the 20-day SMA (₹${inr.format(indicators.sma20)})`),
    sma20AboveSma50: () => (hindi
      ? `20-day SMA 50-day SMA se upar hai (short-term uptrend)`
      : 'The 20-day SMA is above the 50-day SMA (short-term uptrend)'),
    sma20BelowSma50: () => (hindi
      ? `20-day SMA 50-day SMA se neeche hai (short-term downtrend)`
      : 'The 20-day SMA is below the 50-day SMA (short-term downtrend)'),
    macdPositive: () => (hindi
      ? `MACD histogram positive hai (${indicators.macd?.histogram})`
      : `MACD histogram is positive (${indicators.macd?.histogram})`),
    macdNegative: () => (hindi
      ? `MACD histogram negative hai (${indicators.macd?.histogram})`
      : `MACD histogram is negative (${indicators.macd?.histogram})`),
    rsiStrong: () => (hindi
      ? `RSI(14) ${indicators.rsi14} — bullish momentum zone`
      : `RSI(14) is ${indicators.rsi14} — bullish momentum zone`),
    rsiWeak: () => (hindi
      ? `RSI(14) ${indicators.rsi14} — bearish pressure zone`
      : `RSI(14) is ${indicators.rsi14} — bearish pressure zone`),
  };
  return map[reason] ? map[reason]() : null;
};

const trendLabel = (trend, language) => {
  if (language === 'hi') return { bullish: 'Bullish (tezi)', bearish: 'Bearish (kamzori)', neutral: 'Neutral (sideways)' }[trend];
  return { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' }[trend];
};

const historyWindowLabel = (longTerm) => {
  const years = isNum(longTerm?.years) ? Number(longTerm.years) : null;
  if (years == null) return 'History';
  if (years >= 9.5) return '10-year';
  if (years >= 1.5) return `${Math.round(years)}-year`;
  return 'Since-listing';
};

const longTermReasonText = (reason, snapshot, language) => {
  const { longTerm } = snapshot;
  const hindi = language === 'hi';
  const sma200Text = isNum(longTerm.sma200) ? `₹${inr.format(longTerm.sma200)}` : 'unavailable';
  const vsSma = isNum(longTerm.priceVsSma200Percent) ? Math.abs(longTerm.priceVsSma200Percent).toFixed(2) : null;
  const slope = isNum(longTerm.sma200SlopePercent) ? Math.abs(longTerm.sma200SlopePercent).toFixed(2) : null;
  const map = {
    ltAboveSma200: () => (hindi
      ? `Price 200-day SMA (${sma200Text}) se ${vsSma}% upar hai`
      : `Price is ${vsSma}% above the 200-day SMA (${sma200Text})`),
    ltBelowSma200: () => (hindi
      ? `Price 200-day SMA (${sma200Text}) se ${vsSma}% neeche hai`
      : `Price is ${vsSma}% below the 200-day SMA (${sma200Text})`),
    ltGoldenCross: () => (hindi
      ? '50-day SMA 200-day SMA se upar hai (long-term uptrend structure)'
      : 'The 50-day SMA is above the 200-day SMA (long-term uptrend structure)'),
    ltDeathCross: () => (hindi
      ? '50-day SMA 200-day SMA se neeche hai (long-term downtrend structure)'
      : 'The 50-day SMA is below the 200-day SMA (long-term downtrend structure)'),
    ltSma200Rising: () => (hindi
      ? `200-day SMA pichhle 20 sessions mein ${slope}% upar chala hai`
      : `The 200-day SMA rose ${slope}% over the last 20 sessions`),
    ltSma200Falling: () => (hindi
      ? `200-day SMA pichhle 20 sessions mein ${slope}% neeche aaya hai`
      : `The 200-day SMA fell ${slope}% over the last 20 sessions`),
    ltPositiveYear: () => (hindi
      ? `Pichhle 1 saal ka return ${pct(longTerm.oneYearReturnPercent)} hai`
      : `The 1-year return is ${pct(longTerm.oneYearReturnPercent)}`),
    ltNegativeYear: () => (hindi
      ? `Pichhle 1 saal ka return ${pct(longTerm.oneYearReturnPercent)} hai`
      : `The 1-year return is ${pct(longTerm.oneYearReturnPercent)}`),
  };
  return map[reason] ? map[reason]() : null;
};

const buildScenarioRead = (snapshot, language) => {
  const hi = language === 'hi';
  const { indicators, levels, longTerm, trend, price } = snapshot;
  const lines = [];
  const shortLabel = trendLabel(trend, language);
  const longLabel = longTerm?.trend ? trendLabel(longTerm.trend, language) : null;

  if (longLabel) {
    lines.push(trend === longTerm.trend
      ? (hi
        ? `Short-term aur long-term dono ${shortLabel} hain — structure aligned hai.`
        : `Short-term and long-term reads are both ${shortLabel.toLowerCase()} — the structure is aligned.`)
      : (hi
        ? `Short-term ${shortLabel} hai lekin long-term ${longLabel} — signals mixed hain.`
        : `Short-term is ${shortLabel.toLowerCase()} while the long-term read is ${longLabel.toLowerCase()} — signals are mixed.`));
  } else {
    lines.push(hi
      ? '200-day history na hone ki wajah se long-term structure compute nahi hua.'
      : 'Long-term structure was not computed because 200-day history is unavailable.');
  }

  if (isNum(longTerm?.windowHigh) && isNum(longTerm?.windowLow)) {
    const windowName = historyWindowLabel(longTerm);
    const position = isNum(longTerm.rangePositionPercent) ? `${longTerm.rangePositionPercent.toFixed(1)}%` : null;
    const highDate = longTerm.windowHighDate ? ` (${longTerm.windowHighDate})` : '';
    const lowDate = longTerm.windowLowDate ? ` (${longTerm.windowLowDate})` : '';
    lines.push(hi
      ? `${windowName} range: ${money(longTerm.windowLow)}${lowDate} – ${money(longTerm.windowHigh)}${highDate}. Price range ka ${position || 'position unavailable'} par hai, high se ${isNum(longTerm.fromHighPercent) ? Math.abs(longTerm.fromHighPercent).toFixed(2) : '—'}% neeche aur low se ${isNum(longTerm.fromLowPercent) ? Math.abs(longTerm.fromLowPercent).toFixed(2) : '—'}% upar.`
      : `${windowName} range: ${money(longTerm.windowLow)}${lowDate} – ${money(longTerm.windowHigh)}${highDate}. Price sits at ${position || 'an unavailable position'} of that range, ${isNum(longTerm.fromHighPercent) ? Math.abs(longTerm.fromHighPercent).toFixed(2) : '—'}% below the high and ${isNum(longTerm.fromLowPercent) ? Math.abs(longTerm.fromLowPercent).toFixed(2) : '—'}% above the low.`);
  }

  const resistance = isNum(levels.resistance)
    ? levels.resistance
    : (isNum(levels.yearHigh) && levels.yearHigh > price ? levels.yearHigh : null);
  const support = isNum(levels.support)
    ? levels.support
    : (isNum(levels.twentyDayLow) && levels.twentyDayLow < price ? levels.twentyDayLow : null);
  const sma200 = isNum(longTerm?.sma200) ? longTerm.sma200 : null;

  if (resistance && support) {
    lines.push(hi
      ? `${money(resistance)} ke upar daily close upside structure confirm karega; ${money(support)} ke neeche daily close short-term set-up kamzor karega.`
      : `A daily close above ${money(resistance)} would confirm the upside structure; a close below ${money(support)} would weaken the short-term set-up.`);
  } else if (resistance) {
    lines.push(hi
      ? `Price ke neeche verified support nahi mila; ${money(resistance)} ke upar daily close next upside confirmation hoga.`
      : `No verified support was found below price; a daily close above ${money(resistance)} would be the next upside confirmation.`);
  } else if (support) {
    lines.push(hi
      ? `Price ke upar verified resistance nahi mila; ${money(support)} ke neeche daily close short-term set-up kamzor karega.`
      : `No verified resistance was found above price; a daily close below ${money(support)} would weaken the short-term set-up.`);
  }

  if (sma200 && (!resistance || Math.abs(sma200 - resistance) / resistance > 0.005)) {
    const supportive = price >= sma200;
    lines.push(hi
      ? `200-day average ${money(sma200)} long-term pivot hai: iske ${supportive ? 'upar' : 'neeche'} close long-term read ko ${supportive ? 'supportive' : 'weak'} rakhta hai.`
      : `The 200-day average at ${money(sma200)} is the long-term pivot: closes ${supportive ? 'above' : 'below'} it keep the long-term read ${supportive ? 'supportive' : 'weak'}.`);
  }

  if (isNum(indicators.rsi14)) {
    if (indicators.rsi14 >= 70) {
      lines.push(hi
        ? `RSI(14) ${indicators.rsi14} overbought hai — trend extend ho sakta hai, lekin pullback risk zyada hai.`
        : `RSI(14) at ${indicators.rsi14} is overbought — the trend can stay extended, but pullback risk is higher.`);
    } else if (indicators.rsi14 <= 30) {
      lines.push(hi
        ? `RSI(14) ${indicators.rsi14} oversold hai — bounce aa sakta hai, lekin akela RSI reversal signal nahi hai.`
        : `RSI(14) at ${indicators.rsi14} is oversold — a bounce is possible, but RSI alone is not a reversal signal.`);
    } else {
      lines.push(hi
        ? `RSI(14) ${indicators.rsi14} neutral 30–70 band mein hai.`
        : `RSI(14) at ${indicators.rsi14} sits inside the neutral 30–70 band.`);
    }
  }

  if (isNum(indicators.atr14)) {
    const atrPercent = isNum(indicators.atrPercent) ? `${indicators.atrPercent}%` : '—';
    lines.push(hi
      ? `ATR(14) ${money(indicators.atr14)} (price ka ${atrPercent}) normal daily swing hai — isse chhote moves noise hain.`
      : `ATR(14) of ${money(indicators.atr14)} (${atrPercent} of price) is the normal daily swing — moves smaller than that are noise.`);
  }

  if (isNum(indicators.volatility20Annualised)) {
    const level = indicators.volatility20Annualised >= 40
      ? (hi ? 'zyada' : 'high')
      : indicators.volatility20Annualised >= 20 ? (hi ? 'moderate' : 'moderate') : (hi ? 'kam' : 'low');
    lines.push(hi
      ? `20-day annualised volatility ${indicators.volatility20Annualised}% ${level} hai.`
      : `20-day annualised volatility of ${indicators.volatility20Annualised}% is ${level}.`);
  }

  lines.push(hi
    ? 'Yeh conditions aur risk references verified OHLC se compute hue hain — buy/sell recommendation nahi.'
    : 'These are conditions and risk references computed from verified OHLC — not a buy/sell recommendation.');
  return lines;
};

const dataLine = (snapshot, language) => (language === 'hi'
  ? `${snapshot.dataProvider} research data · delayed, live nahi · ${snapshot.asOf || 'samay unavailable'} IST`
  : `${snapshot.dataProvider} research data · delayed, not live · ${snapshot.asOf || 'time unavailable'} IST`);
const disclaimerLine = (language) => (language === 'hi'
  ? 'Yeh analysis research data par based hai, investment advice nahi. Price/profit ki guarantee nahi hai.'
  : 'This is analysis of research data, not investment advice. No price or profit is guaranteed.');

const insufficientLine = (language) => (language === 'hi'
  ? 'Is symbol ke liye verified OHLC history available nahi hai, isliye technical levels nahi diye ja rahe.'
  : 'Verified OHLC history is unavailable for this symbol, so technical levels are not being shown.');

export const formatSnapshotAnswer = (snapshot, { language = 'en' } = {}) => {
  if (!snapshot) return '';
  const hi = language === 'hi';
  const { indicators, levels, momentum } = snapshot;
  const lines = [];
  lines.push(`${snapshot.name} (${snapshot.symbol} · ${snapshot.exchange})`);
  lines.push(hi
    ? `Research quote: ${money(snapshot.price)} (${pct(snapshot.changePercent)}) · delayed, live nahi`
    : `Research quote: ${money(snapshot.price)} (${pct(snapshot.changePercent)}) · delayed, not live`);
  if (snapshot.dayLow && snapshot.dayHigh) {
    lines.push(hi
      ? `Din ka range: ${money(snapshot.dayLow)} – ${money(snapshot.dayHigh)}`
      : `Day range: ${money(snapshot.dayLow)} – ${money(snapshot.dayHigh)}`);
  }
  lines.push('');
  lines.push(hi ? `Trend: ${trendLabel(snapshot.trend, language)}` : `Trend: ${trendLabel(snapshot.trend, language)} (${snapshot.trendScore > 0 ? '+' : ''}${snapshot.trendScore} checks)`);
  snapshot.trendReasons.slice(0, 4).forEach((reason) => {
    const text = reasonText(reason, snapshot, language);
    if (text) lines.push(`- ${text}`);
  });
  lines.push('');
  lines.push(hi ? 'Key levels (verified OHLC se computed)' : 'Key levels (computed from verified OHLC)');
  const supportLevel = levels.support ?? (isNum(levels.twentyDayLow) && levels.twentyDayLow < snapshot.price ? levels.twentyDayLow : null);
  const resistanceLevel = levels.resistance ?? (isNum(levels.twentyDayHigh) && levels.twentyDayHigh > snapshot.price ? levels.twentyDayHigh : null);
  lines.push(`- Support: ${supportLevel ? money(supportLevel) : (hi ? 'price ke neeche verified swing low nahi mila' : 'no verified swing low below price')}`);
  lines.push(`- Resistance: ${resistanceLevel ? money(resistanceLevel) : (hi ? 'price ke upar recent swing high nahi mila' : 'no recent swing high above price')}`);
  if (levels.yearHigh && levels.yearLow) {
    lines.push(`- ${hi ? '52-week range' : '52-week range'}: ${money(levels.yearLow)} – ${money(levels.yearHigh)}`);
  }
  lines.push('');
  lines.push(hi ? 'Risk read' : 'Risk read');
  if (isNum(indicators.atr14)) {
    lines.push(`- ATR(14): ${money(indicators.atr14)} (${indicators.atrPercent}% ${hi ? 'of price' : 'of price'})`);
  }
  if (isNum(indicators.volatility20Annualised)) {
    lines.push(`- ${hi ? '20-day annualised volatility' : '20-day annualised volatility'}: ${indicators.volatility20Annualised}%`);
  }
  if (isNum(indicators.volumeRatio)) {
    lines.push(`- ${hi ? 'Volume vs 20-day average' : 'Volume vs 20-day average'}: ${indicators.volumeRatio}×`);
  }
  if (isNum(momentum.week1Percent) || isNum(momentum.month1Percent)) {
    lines.push('');
    lines.push(`${hi ? '1-week move' : '1-week move'}: ${pct(momentum.week1Percent)} · ${hi ? '1-month move' : '1-month move'}: ${pct(momentum.month1Percent)}`);
  }

  const { longTerm } = snapshot;
  lines.push('');
  lines.push(hi ? 'Long-term record (10 saal tak, verified OHLC)' : 'Long-term record (up to 10 years, verified OHLC)');
  if (longTerm?.trend) {
    const window = [longTerm.firstBar, longTerm.lastBar].filter(Boolean).join(' – ');
    lines.push(`- ${hi ? 'Window' : 'Window'}: ${window} · ${plain.format(longTerm.bars)} ${hi ? 'daily bars' : 'daily bars'}${isNum(longTerm.years) ? ` (${longTerm.years}y)` : ''}`);
    if (isNum(longTerm.totalReturnPercent)) {
      const cagr = isNum(longTerm.cagrPercent) ? ` · CAGR ${pct(longTerm.cagrPercent)}/yr` : '';
      lines.push(`- ${hi ? 'Total change' : 'Total change'}: ${pct(longTerm.totalReturnPercent)}${cagr}`);
    }
    const spans = [];
    if (isNum(longTerm.fiveYearReturnPercent)) spans.push(`${hi ? '5-year' : '5-year'} ${pct(longTerm.fiveYearReturnPercent)}`);
    if (isNum(longTerm.threeYearReturnPercent)) spans.push(`${hi ? '3-year' : '3-year'} ${pct(longTerm.threeYearReturnPercent)}`);
    if (spans.length) lines.push(`- ${spans.join(' · ')}`);
    if (isNum(longTerm.maxDrawdownPercent)) {
      lines.push(`- ${hi ? 'Max drawdown in window' : 'Max drawdown in window'}: ${pct(longTerm.maxDrawdownPercent)}`);
    }
    if (isNum(longTerm.windowHigh) && isNum(longTerm.windowLow)) {
      const windowName = historyWindowLabel(longTerm);
      const highDate = longTerm.windowHighDate ? ` (${longTerm.windowHighDate})` : '';
      const lowDate = longTerm.windowLowDate ? ` (${longTerm.windowLowDate})` : '';
      lines.push(`- ${windowName} high: ${money(longTerm.windowHigh)}${highDate} · ${windowName} low: ${money(longTerm.windowLow)}${lowDate}`);
      const parts = [];
      if (isNum(longTerm.fromHighPercent)) parts.push(hi ? `high se ${Math.abs(longTerm.fromHighPercent).toFixed(2)}% neeche` : `${Math.abs(longTerm.fromHighPercent).toFixed(2)}% below high`);
      if (isNum(longTerm.fromLowPercent)) parts.push(hi ? `low se ${Math.abs(longTerm.fromLowPercent).toFixed(2)}% upar` : `${Math.abs(longTerm.fromLowPercent).toFixed(2)}% above low`);
      if (isNum(longTerm.rangePositionPercent)) parts.push(hi ? `range ka ${longTerm.rangePositionPercent.toFixed(1)}%` : `${longTerm.rangePositionPercent.toFixed(1)}% of range`);
      if (parts.length) lines.push(`- ${parts.join(' · ')}`);
    }
    if (isNum(longTerm.sma200)) {
      lines.push(`- 200-day SMA: ${money(longTerm.sma200)} (${hi ? 'price' : 'price'} ${pct(longTerm.priceVsSma200Percent)} vs SMA)`);
    }
    lines.push('');
    lines.push(hi ? 'Up/down read (rules-based, forecast nahi)' : 'Up/down read (rules-based, not a forecast)');
    const biasLabel = {
      up: hi ? 'up (bullish)' : 'up (bullish)',
      down: hi ? 'down (bearish)' : 'down (bearish)',
      sideways: hi ? 'sideways (neutral)' : 'sideways (neutral)',
    }[longTerm.bias];
    lines.push(`- ${hi ? 'Long-term trend' : 'Long-term trend'}: ${trendLabel(longTerm.trend, language)} · ${longTerm.score > 0 ? '+' : ''}${longTerm.score} ${hi ? 'of' : 'of'} ${longTerm.checks} checks`);
    lines.push(`- ${hi ? 'Bias' : 'Bias'}: ${biasLabel}`);
    longTerm.reasons.slice(0, 4).forEach((reason) => {
      const text = longTermReasonText(reason, snapshot, language);
      if (text) lines.push(`- ${text}`);
    });
    lines.push(hi
      ? '- Yeh sirf past prices ka trend read hai — future prediction, target ya probability nahi.'
      : '- This reads past prices only. It is not a prediction, target or probability.');
  } else {
    lines.push(hi
      ? `- Sirf ${plain.format(longTerm?.bars || 0)} verified daily bars available hain, isliye 200-day aur multi-year checks compute nahi kiye gaye.`
      : `- Only ${plain.format(longTerm?.bars || 0)} verified daily bars are available, so 200-day and multi-year checks were not computed.`);
  }
  lines.push('');
  lines.push(hi ? 'Suggestion read (rules-based, advice nahi)' : 'Suggestion read (rules-based, not advice)');
  buildScenarioRead(snapshot, language).forEach((text) => lines.push(`- ${text}`));
  lines.push('');
  lines.push(dataLine(snapshot, language));
  lines.push(disclaimerLine(language));
  return lines.join('\n');
};

const formatCopilotSnapshotAnswer = (snapshots, query, language) => {
  const hi = language === 'hi';
  const [first, second] = snapshots;
  const asksForHistoryRange = /\b(high|low|range|52.?week|10.?year|all.?time|highest|lowest)\b/i.test(query);
  const asksForTrend = /\b(up|down|trend|bullish|bearish|forecast|predict|will)\b/i.test(query);
  const asksForSuggestion = /\b(suggest|suggestion|should i|buy|sell|entry|stop.?loss)\b/i.test(query);
  const asksForLongTerm = /\b(long.?term|10.?year|decade|multi.?year)\b/i.test(query);
  const quote = (snapshot) => `${snapshot.symbol} ${money(snapshot.price)} (${pct(snapshot.changePercent)})`;

  if (second) {
    const relative = (snapshot) => asksForTrend && snapshot.longTerm?.trend
      ? `${trendLabel(snapshot.longTerm.trend, language)} long-term`
      : trendLabel(snapshot.trend, language);
    return hi
      ? `${quote(first)} · trend ${relative(first)}; ${quote(second)} · trend ${relative(second)}. Yeh delayed research data hai, live nahi.`
      : `${quote(first)} · ${relative(first)} trend; ${quote(second)} · ${relative(second)} trend. Delayed research data, not live.`;
  }

  if (!first) return '';
  const { longTerm, levels, indicators } = first;
  const asOf = first.asOf ? ` · ${first.asOf} IST` : '';
  const source = `${first.dataProvider || 'Verified'} research data${asOf} · ${hi ? 'delayed, live nahi' : 'delayed, not live'}`;

  if (asksForHistoryRange && longTerm) {
    const windowName = historyWindowLabel(longTerm);
    const parts = [];
    if (/\b(high|range|highest|all.?time)\b/i.test(query) && isNum(longTerm.windowHigh)) {
      parts.push(`${hi ? 'High' : 'High'} ${money(longTerm.windowHigh)}${longTerm.windowHighDate ? ` (${longTerm.windowHighDate})` : ''}`);
    }
    if (/\b(low|range|lowest|all.?time)\b/i.test(query) && isNum(longTerm.windowLow)) {
      parts.push(`${hi ? 'Low' : 'Low'} ${money(longTerm.windowLow)}${longTerm.windowLowDate ? ` (${longTerm.windowLowDate})` : ''}`);
    }
    if (!parts.length) {
      if (isNum(longTerm.windowHigh)) parts.push(`High ${money(longTerm.windowHigh)}${longTerm.windowHighDate ? ` (${longTerm.windowHighDate})` : ''}`);
      if (isNum(longTerm.windowLow)) parts.push(`Low ${money(longTerm.windowLow)}${longTerm.windowLowDate ? ` (${longTerm.windowLowDate})` : ''}`);
    }
    if (parts.length) {
      const currentPrice = isNum(first.price) ? `Current price ${money(first.price)}` : '';
      const distanceFromHigh = /\bnear\b/i.test(query) && isNum(longTerm.fromHighPercent)
        ? `${Math.abs(longTerm.fromHighPercent).toFixed(1)}% below the high`
        : '';
      return `${first.symbol} ${windowName} range: ${parts.join(' · ')}${currentPrice ? ` · ${currentPrice}` : ''}${distanceFromHigh ? ` (${distanceFromHigh})` : ''}. ${source}.`;
    }
  }

  if (asksForTrend && (longTerm?.trend || first.trend)) {
    const trend = asksForLongTerm && longTerm?.trend ? longTerm.trend : first.trend;
    const period = asksForLongTerm ? (hi ? 'long-term' : 'long-term') : (hi ? 'short-term' : 'short-term');
    const levelsText = [
      isNum(levels.support) ? `${hi ? 'support' : 'support'} ${money(levels.support)}` : '',
      isNum(levels.resistance) ? `${hi ? 'resistance' : 'resistance'} ${money(levels.resistance)}` : '',
    ].filter(Boolean).join(' · ');
    const notForecast = hi
      ? 'Yeh past data ka trend hai, future prediction nahi.'
      : 'This describes past data, not a prediction.';
    return `${first.symbol}: ${period} trend ${trendLabel(trend, language)}${levelsText ? `; ${levelsText}` : ''}. ${source}. ${notForecast}`;
  }

  const support = isNum(levels.support) ? `support ${money(levels.support)}` : '';
  const resistance = isNum(levels.resistance) ? `resistance ${money(levels.resistance)}` : '';
  const levelsText = [support, resistance].filter(Boolean).join(' · ');
  const longTrend = longTerm?.trend ? `${hi ? 'Long-term' : 'Long-term'} ${trendLabel(longTerm.trend, language).toLowerCase()}` : '';
  const scenario = asksForSuggestion && isNum(indicators.atr14)
    ? ` ATR(14) ${money(indicators.atr14)} is the recent average daily range; not a buy/sell recommendation.`
    : '';
  return `${first.name || first.symbol} (${first.symbol}): ${quote(first)}. Short-term ${trendLabel(first.trend, language).toLowerCase()}${longTrend ? `; ${longTrend}` : ''}${levelsText ? `; ${levelsText}` : ''}. ${source}.${scenario}`;
};

export const getLLMConfig = () => {
  const gemini = String(process.env.GEMINI_API_KEY || '').trim();
  if (gemini && !/^(your_|paste_)/i.test(gemini)) {
    return {
      provider: 'gemini',
      label: 'Google Gemini',
      model: String(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim(),
    };
  }
  const apiKey = String(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  if (apiKey && !/^(your_|paste_)/i.test(apiKey)) {
    return {
      provider: 'openai',
      label: 'OpenAI-compatible LLM',
      model: String(process.env.LLM_MODEL || 'gpt-4o-mini').trim(),
      baseUrl: String(process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey,
    };
  }
  return null;
};

const buildSystemPrompt = (snapshots, language) => {
  const data = snapshots.map((snapshot) => ({
    symbol: snapshot.symbol,
    name: snapshot.name,
    price: snapshot.price,
    dayChangePercent: snapshot.changePercent,
    dayRange: [snapshot.dayLow, snapshot.dayHigh],
    yearRange: [snapshot.levels.yearLow, snapshot.levels.yearHigh],
    rsi14: snapshot.indicators.rsi14,
    sma20: snapshot.indicators.sma20,
    sma50: snapshot.indicators.sma50,
    macd: snapshot.indicators.macd,
    atr14: snapshot.indicators.atr14,
    volatility20Annualised: snapshot.indicators.volatility20Annualised,
    support: snapshot.levels.support,
    resistance: snapshot.levels.resistance,
    trend: snapshot.trend,
    longTerm: {
      years: snapshot.longTerm?.years,
      bars: snapshot.longTerm?.bars,
      totalReturnPercent: snapshot.longTerm?.totalReturnPercent,
      cagrPercent: snapshot.longTerm?.cagrPercent,
      fiveYearReturnPercent: snapshot.longTerm?.fiveYearReturnPercent,
      threeYearReturnPercent: snapshot.longTerm?.threeYearReturnPercent,
      maxDrawdownPercent: snapshot.longTerm?.maxDrawdownPercent,
      tenYearHigh: snapshot.longTerm?.windowHigh,
      tenYearHighDate: snapshot.longTerm?.windowHighDate,
      tenYearLow: snapshot.longTerm?.windowLow,
      tenYearLowDate: snapshot.longTerm?.windowLowDate,
      fromHighPercent: snapshot.longTerm?.fromHighPercent,
      fromLowPercent: snapshot.longTerm?.fromLowPercent,
      rangePositionPercent: snapshot.longTerm?.rangePositionPercent,
      sma200: snapshot.longTerm?.sma200,
      trend: snapshot.longTerm?.trend,
      bias: snapshot.longTerm?.bias,
      score: snapshot.longTerm?.score,
      checks: snapshot.longTerm?.checks,
    },
    asOf: snapshot.asOf,
    dataQuality: 'delayed research data, not live',
  }));
  return [
    'You are ShareMarket AI Copilot, an Indian markets analyst.',
    'Use ONLY the verified market snapshot below for prices, levels and indicators. Never invent or estimate numbers that are not present.',
    `The data is delayed research data, not live. State that when relevant. You must write the entire reply in ${language === 'hi' ? 'Hindi using Devanagari script' : 'English'}.`,
    `Answer the exact question in at most 3 short sentences (about 60 words), in ${language === 'hi' ? 'Hindi using Devanagari script' : 'English'}.`,
    'Use only the relevant snapshot facts; do not dump all indicators. Use plain text and no markdown tables.',
    'The snapshot includes up to 10 years of daily bars, the 10-year high and low with dates, and a rules-based long-term trend read. If asked for a high or low, report longTerm.tenYearHigh and longTerm.tenYearLow with their dates.',
    'If asked whether a stock will go up or down, report that trend read and its checks, and state clearly that it is not a prediction, target or probability.',
    'If asked for a suggestion, give a rules-based scenario: trend alignment, the exact close above resistance / below support that would confirm or weaken it, and the ATR-based normal daily swing. Say it is not investment advice.',
    'Do not promise returns. Add a one-line risk note when discussing trades. Say when the snapshot lacks information.',
    `Verified snapshot (as of ${snapshots.map((item) => `${item.symbol}: ${item.asOf || 'unknown'}`).join('; ')}):`,
    JSON.stringify(data),
    `Reminder: the user wrote in ${language === 'hi' ? 'Hindi' : 'English'}; write the whole reply in ${language === 'hi' ? 'Hindi (Devanagari script)' : 'English'} only.`,
  ].join('\n');
};

const sanitizeHistory = (history) => (Array.isArray(history) ? history : [])
  .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
  .slice(-8)
  .map((item) => ({ role: item.role, content: item.content.slice(0, 1200) }));

const GEMINI_FALLBACK_MODEL = 'gemini-flash-lite-latest';

const generateGemini = async (model, systemPrompt, history, message) => {
  const contents = [
    ...history.map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 350 },
    },
    {
      params: { key: process.env.GEMINI_API_KEY },
      timeout: LLM_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    },
  );
  const text = response.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  return { text: text || null, model };
};

const callGemini = async (config, systemPrompt, history, message) => {
  try {
    return await generateGemini(config.model, systemPrompt, history, message);
  } catch (error) {
    // Google retires models for existing keys; a 404 means retry on a currently served alias.
    if (error.response?.status !== 404 || config.model === GEMINI_FALLBACK_MODEL) throw error;
    return generateGemini(GEMINI_FALLBACK_MODEL, systemPrompt, history, message);
  }
};

const callOpenAI = async (config, systemPrompt, history, message) => {
  const response = await axios.post(
    `${config.baseUrl}/chat/completions`,
    {
      model: config.model,
      temperature: 0.3,
      max_tokens: 350,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ],
    },
    {
      timeout: LLM_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    },
  );
  return response.data?.choices?.[0]?.message?.content?.trim() || null;
};

const HINDI_REPLY_DIRECTIVE = 'उत्तर केवल हिंदी (देवनागरी लिपि) में दें। पूरा उत्तर देवनागरी में लिखें, अंग्रेज़ी में नहीं।';
const hasDevanagari = (text) => /[\u0900-\u097F]/.test(String(text || ''));

const callLLM = async (config, systemPrompt, history, message, language) => {
  const run = (userMessage) => (config.provider === 'gemini'
    ? callGemini(config, systemPrompt, history, userMessage)
    : callOpenAI(config, systemPrompt, history, userMessage).then((text) => ({ text, model: config.model })));
  const first = await run(message);
  if (language !== 'hi' || !first.text || hasDevanagari(first.text)) return first;
  try {
    const retry = await run(`${HINDI_REPLY_DIRECTIVE}\n${message}`);
    return retry.text ? retry : first;
  } catch {
    return first;
  }
};

const UNKNOWN_REPLY = 'Ask about an NSE/BSE stock or index—for example, “Analyze RELIANCE”, “10-year high and low of TCS”, or “Compare INFOSYS and TCS”. I use delayed research data and will say when information is unavailable.';

const CONCEPTS = [
  {
    pattern: /\bstop[\s-]?loss\b/i,
    en: 'A stop loss is a pre-set exit price that closes a trade when the market moves against you, capping the loss. It can be a fixed price below support or an ATR-based distance, and it works only if the order actually reaches the exchange. It limits loss size; it does not guarantee a fill or prevent gaps.',
    hi: 'Stop loss ek pehle se tay exit price hai jo trade ko band kar deta hai jab market aapke khilaaf jaaye, loss ko limit karta hai. Yeh support ke neeche fixed price ya ATR-based distance ho sakta hai, aur tabhi kaam karta hai jab order exchange tak pahunche. Yeh loss ki size limit karta hai; fill ki guarantee ya gap protection nahi deta.',
  },
  {
    pattern: /\brsi\b|relative strength/i,
    en: 'RSI (Relative Strength Index) measures the speed of recent price changes on a 0–100 scale. Above 70 is often read as overbought, below 30 as oversold. RSI is a momentum gauge, not a buy/sell guarantee.',
    hi: 'RSI (Relative Strength Index) 0–100 scale par recent price movement ki speed batata hai. 70 ke upar overbought aur 30 ke neeche oversold mana jata hai. Yeh momentum gauge hai, buy/sell guarantee nahi.',
  },
  {
    pattern: /\bmacd\b/i,
    en: 'MACD compares a 12-period and 26-period EMA. The MACD line crossing above its 9-period signal line is read as improving momentum; crossing below as weakening momentum. Confirm with price and volume.',
    hi: 'MACD 12-period aur 26-period EMA compare karta hai. MACD line signal line ke upar jaaye to momentum sudhar raha hota hai, neeche jaaye to kamzor. Price aur volume se confirm karein.',
  },
  {
    pattern: /\bbollinger\b/i,
    en: 'Bollinger Bands are a 20-period moving average plus/minus two standard deviations. Narrow bands mean low volatility; a price close outside a band signals an unusually large move, not a direction forecast.',
    hi: 'Bollinger Bands 20-period moving average ke around do standard deviations hote hain. Patli bands kam volatility dikhati hain; band ke bahar close unusual move batata hai, direction forecast nahi.',
  },
  {
    pattern: /\batr\b|average true range/i,
    en: 'ATR (Average True Range) measures average daily trading range over 14 periods. It is used for position sizing and stop placement, not for predicting direction.',
    hi: 'ATR (Average True Range) 14 periods ka average daily range batata hai. Iska use position sizing aur stop-loss placement ke liye hota hai, direction predict karne ke liye nahi.',
  },
  {
    pattern: /\b(sma|ema)\b|moving average/i,
    en: 'SMA and EMA are moving averages. SMA gives an equal-weighted average; EMA reacts faster to recent prices. Price above a rising average is usually read as an uptrend.',
    hi: 'SMA aur EMA moving averages hain. SMA simple average hai, EMA recent prices ko zyada weight deta hai. Rising average ke upar price ko aam taur par uptrend mana jata hai.',
  },
  {
    pattern: /support|resistance/i,
    en: 'Support is a price area where buying has previously absorbed selling; resistance is where selling has previously capped rallies. They are zones, not exact lines, and can break.',
    hi: 'Support woh price zone hai jahan pehle buying ne selling absorb ki; resistance jahan selling ne rally rok di. Yeh zones hain, exact lines nahi, aur break ho sakte hain.',
  },
  {
    pattern: /\bp\/?e\b|price to earnings/i,
    en: 'P/E is price divided by earnings per share. A higher P/E implies the market expects more growth or is paying a premium; compare within the same industry and with the company\'s own history.',
    hi: 'P/E price ko earnings per share se divide karta hai. Zyada P/E ka matlab market zyada growth expect kar raha hai ya premium de raha hai; same industry aur company history se compare karein.',
  },
  {
    pattern: /volatility/i,
    en: 'Volatility measures how much a price moves. This app reports 20-day annualised volatility from daily returns; higher volatility means wider swings and usually requires smaller position sizes.',
    hi: 'Volatility price movement ki magnitude batati hai. Yeh app 20-day annualised volatility daily returns se nikalta hai; zyada volatility ka matlab bade swings aur chhoti position size.',
  },
  {
    pattern: /diversif/i,
    en: 'Diversification spreads risk across sectors and instruments so one holding cannot dominate portfolio outcomes. It reduces concentration risk but does not remove market risk.',
    hi: 'Diversification risk ko sectors aur instruments mein failata hai taaki ek holding portfolio decide na kare. Yeh concentration risk kam karta hai, market risk nahi.',
  },
  {
    pattern: /\bsip\b|systematic investment/i,
    en: 'A SIP invests a fixed amount at fixed intervals. It averages purchase cost across market cycles and is not a guarantee of profit; fund selection and duration still matter.',
    hi: 'SIP fixed amount ko fixed interval par invest karta hai. Yeh market cycles mein average cost banata hai, profit guarantee nahi; fund selection aur duration phir bhi zaroori hain.',
  },
  {
    pattern: /mutual\s+funds?|\bmutual\b/i,
    en: 'A mutual fund pools money from many investors and a professional manager buys a basket of stocks, bonds or both on their behalf. Units are priced daily at NAV (net asset value). Returns depend on the underlying holdings, so a mutual fund is not a guaranteed product.',
    hi: 'Mutual fund kai investors ka paisa ikattha karta hai aur ek professional manager unki taraf se stocks, bonds ya dono ka basket kharidta hai. Units ki keemat roz NAV (net asset value) par tay hoti hai. Return underlying holdings par depend karta hai, guarantee nahi.',
  },
  {
    pattern: /\betfs?\b|exchange traded fund/i,
    en: 'An ETF is a basket of securities that trades on an exchange like a stock, so its price moves through the day. Most Indian equity ETFs track an index such as NIFTY 50. Compare an ETF\'s price with its iNAV and check liquidity before trading.',
    hi: 'ETF securities ka basket hai jo exchange par stock ki tarah trade hota hai, isliye price din bhar badalta hai. Zyadatar Indian equity ETFs NIFTY 50 jaise index ko track karte hain. Trade se pehle ETF price ko iNAV aur liquidity se compare karein.',
  },
  {
    pattern: /index\s+funds?/i,
    en: 'An index fund copies a market index instead of picking stocks. It holds the same constituents in roughly the same weights, so it tracks index returns before costs and tracking error. It is passive, not risk-free.',
    hi: 'Index fund stocks pick karne ke bajaye market index ki copy karta hai. Same constituents lagbhag same weights mein hold karta hai, isliye costs aur tracking error se pehle index return deta hai. Yeh passive hai, risk-free nahi.',
  },
  {
    pattern: /dividend/i,
    en: 'A dividend is a part of profit a company distributes to shareholders, usually per share. The price typically adjusts down by the dividend amount on the ex-date. Dividend yield is annual dividend divided by price; a high yield can also signal a falling price.',
    hi: 'Dividend company ke profit ka woh hissa hai jo shareholders ko, aam taur par per share, diya jata hai. Ex-date par price aam taur par dividend amount ke barabar neeche adjust hota hai. Dividend yield annual dividend / price hai; zyada yield girte price ka signal bhi ho sakta hai.',
  },
];

const conceptAnswer = (query, language) => {
  const match = CONCEPTS.find((concept) => concept.pattern.test(query));
  if (!match) return null;
  const text = language === 'hi' ? match.hi : match.en;
  const note = language === 'hi'
    ? 'Yeh educational explanation hai, kisi stock ke liye specific advice nahi. Stock-specific levels ke liye symbol ke saath poochhein.'
    : 'This is an educational explanation, not advice for a specific stock. Ask with a symbol for stock-specific levels.';
  return `${text}\n\n${note}`;
};

export const answerCopilot = async ({ message, context = {}, history = [] }) => {
  const query = String(message || '').trim();
  if (!query) throw new Error('Message is required');
  const language = /[\u0900-\u097F]/.test(query) ? 'hi' : (context.language === 'hi' ? 'hi' : 'en');

  if (!isYahooResearchEnabled()) {
    return {
      reply: `Verified market data is unavailable because the research data provider is not running.

${language === 'hi' ? 'Research provider start karein, phir dobara poochhein.' : 'Start the research data provider and ask again.'}`,
      provider: 'ShareMarket AI Copilot',
      llmConfigured: Boolean(getLLMConfig()),
      grounding: null,
      disclaimer: disclaimerLine(language),
    };
  }

const GENERAL_PROMPT = `You are ShareMarket AI Copilot for Indian markets.
Answer the user's exact educational question in no more than 3 short sentences (about 60 words).
Never invent prices, levels, returns or current market data. If the user asks for current data without a stock symbol, ask for the NSE/BSE symbol or tell them which page in the app shows it.
Say that you cannot give investment advice. Use plain text with simple hyphen bullets.
Always match the user's language: reply in Hindi (Devanagari script) when the question is in Hindi, otherwise in English.`;

const promptForLanguage = (prompt, language) => `${prompt}\nThe reply must be entirely in ${language === 'hi' ? 'Hindi (Devanagari script)' : 'English'}.`;

  const concept = conceptAnswer(query, language);
  const definitionStyle = /\b(what(?:'s|s|\s+is)?|meaning|define|definition|explain|difference|differ|how\s+(?:does|do|is)|tell\s+me\s+about|kya|matlab|samjhao)\b/i.test(query);
  let conceptOnly = false;
  if (concept && definitionStyle) {
    const namedTokens = new Set(query.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
    const explicitIndex = detectIndexes(query).length > 0
      || ['GOLD', 'SILVER'].some((symbol) => namedTokens.has(symbol));
    if (!explicitIndex) {
      const catalog = await loadCatalog();
      conceptOnly = !catalog.some((entry) => namedTokens.has(entry.symbol));
    }
  }

  const instruments = conceptOnly ? [] : await resolveInstruments(query, context);
  const fetchedSnapshots = (await Promise.all(instruments.slice(0, 2).map((instrument) => fetchSnapshot(instrument))))
    .filter(Boolean);

  if (instruments.length && !fetchedSnapshots.length) {
    if (concept) {
      return {
        reply: concept,
        provider: 'ShareMarket AI Copilot',
        llmConfigured: Boolean(getLLMConfig()),
        grounding: null,
        disclaimer: disclaimerLine(language),
      };
    }
    return {
      reply: `Verified research data is currently unavailable for ${instruments.map((instrument) => instrument.symbol).join(', ')}.

${language === 'hi' ? 'Research provider se data nahi mila, isliye main koi price ya level estimate nahi karunga.' : 'The research provider returned no data, so I will not estimate a price or level.'}`,
      provider: 'ShareMarket AI Copilot',
      llmConfigured: Boolean(getLLMConfig()),
      grounding: null,
      disclaimer: disclaimerLine(language),
    };
  }

  if (!fetchedSnapshots.length) {
    if (/\b(which|what|list|top|find|all|every|each|analy[sz]e)\b[\s\S]*\b(stocks?|shares?|scrips?|compan(y|ies))\b|\bscreener?\b|\b(top|best)\s+(gainers?|losers?)\b/i.test(query)) {
      const catalogSize = (await loadCatalog()).length;
      return {
        reply: language === 'hi'
          ? `Chat ek saath poore market ka screener nahi chalata, lekin catalog ki har company (${plain.format(catalogSize)} NSE/BSE listings) ko alag se, 10 saal tak ke verified daily data ke saath analyse kar sakta hai — jaise "Analyze TATA MOTORS" ya "Will INFOSYS go up or down?". Verified quotes ke liye Stocks page ke Top Gainers/Top Losers filters ya Live Terminal use karein.`
          : `Chat cannot screen every listed company at once, but it can analyse any company in the catalog (${plain.format(catalogSize)} NSE/BSE listings) individually with up to 10 years of verified daily data — for example "Analyze TATA MOTORS" or "Will INFOSYS go up or down?". For quoted movers, use the Stocks page filters (Top Gainers / Top Losers) or the Live Terminal.`,
        provider: 'ShareMarket AI Copilot',
        llmConfigured: Boolean(getLLMConfig()),
        grounding: null,
        disclaimer: disclaimerLine(language),
      };
    }
    if (/\bgold\b|\bsilver\b/i.test(query)) {
      return {
        reply: language === 'hi'
          ? 'Gold aur Silver MCX quotes, spot fallback aur charts Commodities page par available hain. Chat abhi NSE/BSE equities aur Indian indices ka verified data analysis karta hai; metal analysis ke liye Commodities page kholen.'
          : 'Gold and Silver MCX quotes, spot fallback and charts are available on the Commodities page. Chat currently analyses verified NSE/BSE equities and Indian indices, so please use Commodities for metals.',
        provider: 'ShareMarket AI Copilot',
        llmConfigured: Boolean(getLLMConfig()),
        grounding: null,
        disclaimer: disclaimerLine(language),
      };
    }
    const generalLLM = getLLMConfig();
    if (generalLLM) {
      try {
        const result = await callLLM(generalLLM, promptForLanguage(GENERAL_PROMPT, language), sanitizeHistory(history), query, language);
        if (result.text) {
          return {
            reply: result.text,
            provider: `${generalLLM.label} · ${result.model}`,
            llmConfigured: true,
            llmProvider: generalLLM.label,
            llmModel: result.model,
            grounding: null,
            disclaimer: disclaimerLine(language),
          };
        }
      } catch {
        // Fall through to the verified educational answer.
      }
    }
    return {
      reply: concept || UNKNOWN_REPLY,
      provider: 'ShareMarket AI Copilot',
      llmConfigured: Boolean(generalLLM),
      grounding: null,
      disclaimer: disclaimerLine(language),
    };
  }

  const wantsComparison = /\b(compare|comparison|vs|versus|and)\b/i.test(query);
  let snapshots = fetchedSnapshots;
  let disambiguation = null;
  if (!wantsComparison && fetchedSnapshots.length > 1) {
    const [primary, ...others] = fetchedSnapshots;
    snapshots = [primary];
    if (others.length) {
      const list = others.map((item) => `${item.symbol} (${item.name})`).join(', ');
      disambiguation = language === 'hi'
        ? `Note: is naam se ${list} bhi match hua. Uske alag analysis ke liye uska symbol poochhein.`
        : `Note: ${list} also matches this name. Ask with that symbol for its own analysis.`;
    }
  }

  const llm = getLLMConfig();
  let reply = null;
  let provider = 'Computed from verified OHLC';
  let llmModelUsed = llm?.model || null;
  let llmError = null;

  if (llm) {
    try {
      const systemPrompt = buildSystemPrompt(snapshots, language);
      const cleanedHistory = sanitizeHistory(history);
      const result = await callLLM(llm, systemPrompt, cleanedHistory, query, language);
      reply = result.text;
      if (reply) {
        provider = `${llm.label} · ${result.model}`;
        llmModelUsed = result.model;
      }
    } catch (error) {
      llmError = error.response?.status
        ? `The LLM provider rejected the request (HTTP ${error.response.status}).`
        : 'The LLM provider could not be reached.';
    }
  }

  if (!reply) {
    reply = formatCopilotSnapshotAnswer(snapshots, query, language);
    if (snapshots.some((snapshot) => !snapshot.historyBars || snapshot.historyBars < 30)) {
      reply += ` ${insufficientLine(language)}`;
    }
    if (llmError) {
      reply += ` ${language === 'hi' ? 'AI API unavailable; jawab verified OHLC data se compute hua.' : 'AI API unavailable; this answer was computed from verified OHLC data.'}`;
    }
  }

  if (disambiguation) reply = `${reply}\n\n${disambiguation}`;

  return {
    reply,
    provider,
    llmConfigured: Boolean(llm),
    llmProvider: llm?.label || null,
    llmModel: llmModelUsed,
    llmError,
    grounding: {
      symbols: snapshots.map((snapshot) => snapshot.symbol),
      asOf: snapshots.map((snapshot) => ({ symbol: snapshot.symbol, at: snapshot.asOf, iso: snapshot.asOfIso })),
      dataProvider: getYahooResearchProviderName(),
      isLive: false,
      isDelayed: true,
      isResearch: true,
      historyBars: snapshots.map((snapshot) => ({ symbol: snapshot.symbol, bars: snapshot.historyBars })),
    },
    disclaimer: disclaimerLine(language),
  };
};

const lookupCompanyName = async (symbol) => {
  const catalog = await loadCatalog();
  const match = catalog.find((entry) => entry.symbol === symbol);
  return match?.name?.replace(/\.$/, '') || symbol;
};

export const analyzeSymbol = async (symbol, exchange = 'NSE') => {
  if (!isYahooResearchEnabled()) {
    const error = new Error('The Yahoo research provider is not available on this server.');
    error.code = 'research_provider_unavailable';
    throw error;
  }
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  if (!cleanSymbol) {
    const error = new Error('A stock symbol is required.');
    error.code = 'symbol_required';
    throw error;
  }
  const snapshot = await fetchSnapshot({
    symbol: cleanSymbol,
    exchange: String(exchange || 'NSE').toUpperCase() === 'BSE' ? 'BSE' : 'NSE',
    name: INDEX_LABELS[cleanSymbol] || await lookupCompanyName(cleanSymbol),
    kind: INDEX_SYMBOLS.has(cleanSymbol) ? 'index' : 'equity',
  });
  if (!snapshot) {
    const error = new Error(`Verified research data is unavailable for ${cleanSymbol}.`);
    error.code = 'research_data_unavailable';
    throw error;
  }

  return {
    ...snapshot,
    summary: formatSnapshotAnswer(snapshot, { language: 'en' }),
    suggestions: buildScenarioRead(snapshot, 'en'),
    signals: [
      snapshot.trend,
      snapshot.longTerm?.trend ? `long-term-${snapshot.longTerm.trend}` : null,
      isNum(snapshot.indicators.rsi14) && snapshot.indicators.rsi14 >= 70 ? 'overbought' : null,
      isNum(snapshot.indicators.rsi14) && snapshot.indicators.rsi14 <= 30 ? 'oversold' : null,
      isNum(snapshot.indicators.volumeRatio) && snapshot.indicators.volumeRatio >= 2 ? 'volume-spike' : null,
    ].filter(Boolean),
    modelVersion: 'rules-v3 (10-year high/low, scenario read)',
    disclaimer: disclaimerLine('en'),
  };
};

export const getAIStatus = () => {
  const llm = getLLMConfig();
  return {
    llmConfigured: Boolean(llm),
    llmProvider: llm?.label || null,
    llmModel: llm?.model || null,
    researchAvailable: isYahooResearchEnabled(),
    researchProvider: isYahooResearchEnabled() ? getYahooResearchProviderName() : null,
    setup: llm ? null : 'Optional: set GEMINI_API_KEY (or LLM_API_KEY for an OpenAI-compatible endpoint) in .env and restart the server for conversational answers. Computed answers from verified OHLC work without a key.',
  };
};
