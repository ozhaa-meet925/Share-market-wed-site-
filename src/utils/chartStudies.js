const indiaDate = (timestamp) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(timestamp * 1000));

const IST_OFFSET_SECONDS = 5 * 60 * 60 + 30 * 60;

// Same IST-aligned bucketing the server uses when it merges provider bars.
export const candleBucketStart = (timeMs, seconds) => Math.floor((timeMs / 1000 + IST_OFFSET_SECONDS) / seconds) * seconds
  - IST_OFFSET_SECONDS;

const isVerifiedQuote = (quote) => quote?.isLive === true || quote?.isResearch === true
  || quote?.isDelayed === true || quote?.isReal === true;

// Provider volume is cumulative for the session; the bar keeps only the share
// printed inside its own window. Daily bars use the reported volume directly.
const barVolume = (candles, quote, seconds, bucketStart) => {
  const total = Number(quote?.v);
  if (!Number.isFinite(total) || total < 0) return null;
  if (seconds >= 86400) return total;
  const sessionStart = Math.floor((bucketStart + IST_OFFSET_SECONDS) / 86400) * 86400 - IST_OFFSET_SECONDS;
  let earlier = 0;
  for (const candle of candles) {
    if (candle.time < sessionStart || candle.time >= bucketStart) continue;
    if (Number.isFinite(Number(candle.value))) earlier += Number(candle.value);
  }
  return Math.max(0, total - earlier);
};

// A verified quote may update the forming bar or start the next one. Quotes are
// accepted on their own basis (live within 2 minutes, delayed within 30), so a
// delayed feed is never presented as an exchange tick — the chart caption keeps
// its delayed/research label.
export const updateLatestCandle = (candles, quote, seconds, now = Date.now()) => {
  if (!Array.isArray(candles) || candles.length === 0 || !(seconds > 0 && seconds <= 86400)) return candles;
  if (!isVerifiedQuote(quote) || quote.isStale === true || quote.isClose === true
    || quote.isDemo === true || quote.marketOpen === false) return candles;
  const price = Number(quote.c);
  const rawTime = quote.lastTradeTime ?? quote.t ?? quote.timestamp;
  const numericTime = Number(rawTime);
  const time = rawTime == null || rawTime === '' ? NaN
    : Number.isFinite(numericTime) ? numericTime * (numericTime < 1e12 ? 1000 : 1)
      : Date.parse(rawTime);
  if (!(price > 0) || !Number.isFinite(price) || !Number.isFinite(time)) return candles;
  const freshnessMs = quote.isLive === true ? 120000 : 30 * 60 * 1000;
  if (now - time > freshnessMs || time > now + 5000) return candles;
  const latest = candles.at(-1);
  if (time < (latest.quoteTime ?? 0)) return candles;
  const bucketStart = candleBucketStart(time, seconds);
  if (bucketStart < latest.time) return candles;
  const volume = Number.isFinite(Number(latest.value)) || bucketStart > latest.time
    ? barVolume(candles, quote, seconds, bucketStart)
    : null;
  if (bucketStart === latest.time) {
    if (latest.close === price && time <= (latest.quoteTime ?? 0)) return candles;
    return [...candles.slice(0, -1), {
      ...latest,
      close: price,
      high: Math.max(latest.high, price),
      low: Math.min(latest.low, price),
      ...(volume === null ? {} : { value: volume }),
      quoteTime: time,
    }];
  }
  if (bucketStart * 1000 > now + 5000) return candles;
  return [...candles, {
    time: bucketStart,
    open: price,
    high: price,
    low: price,
    close: price,
    ...(volume === null ? {} : { value: volume }),
    quoteTime: time,
  }];
};

export const toRenkoCloseSeries = (candles, boxFraction = 0.006) => {
  if (!Array.isArray(candles) || !candles.length) return [];
  const average = candles.reduce((sum, candle) => sum + Number(candle.close), 0) / candles.length;
  const boxSize = Math.max(0.01, Number((average * boxFraction).toFixed(2)));
  let brickClose = Number(candles[0].close);
  return candles.map((candle) => {
    const close = Number(candle.close);
    while (close >= brickClose + boxSize) brickClose = Number((brickClose + boxSize).toFixed(2));
    while (close <= brickClose - boxSize) brickClose = Number((brickClose - boxSize).toFixed(2));
    return { time: candle.time, value: brickClose };
  });
};

export const calculateAverageSeries = (candles, period, kind = 'sma') => {
  if (!Array.isArray(candles) || !Number.isInteger(period) || period < 1 || candles.length < period) return [];
  const output = [];
  let average = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  output.push({ time: candles[period - 1].time, value: average });
  const alpha = 2 / (period + 1);
  for (let index = period; index < candles.length; index += 1) {
    if (kind === 'ema') average = (candles[index].close - average) * alpha + average;
    else average = candles.slice(index - period + 1, index + 1).reduce((sum, candle) => sum + candle.close, 0) / period;
    output.push({ time: candles[index].time, value: average });
  }
  return output;
};

export const calculateBollinger = (candles, period = 20, deviations = 2) => {
  const series = { upper: [], middle: [], lower: [] };
  if (!Array.isArray(candles) || !Number.isInteger(period) || period < 1 || candles.length < period) return series;
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1).map((candle) => candle.close);
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const deviation = Math.sqrt(window.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period);
    const time = candles[index].time;
    series.middle.push({ time, value: mean });
    series.upper.push({ time, value: mean + deviations * deviation });
    series.lower.push({ time, value: mean - deviations * deviation });
  }
  return series;
};

export const calculateSessionVwap = (candles) => {
  if (!Array.isArray(candles)) return [];
  let session = '';
  let weightedPrice = 0;
  let totalVolume = 0;
  const values = [];
  for (const candle of candles) {
    if (typeof candle.value !== 'number' || !Number.isFinite(candle.value) || candle.value < 0) return [];
    const nextSession = indiaDate(candle.time);
    if (nextSession !== session) {
      session = nextSession;
      weightedPrice = 0;
      totalVolume = 0;
    }
    weightedPrice += ((candle.high + candle.low + candle.close) / 3) * candle.value;
    totalVolume += candle.value;
    if (totalVolume > 0) values.push({ time: candle.time, value: weightedPrice / totalVolume });
  }
  return values;
};

export const calculateRsiSeries = (candles, period = 14) => {
  if (!Array.isArray(candles) || candles.length <= period) return [];
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  const value = () => (averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - (100 / (1 + (averageGain / averageLoss))));
  const result = [{ time: candles[period].time, value: value() }];
  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    averageGain = ((averageGain * (period - 1)) + Math.max(0, change)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(0, -change)) / period;
    result.push({ time: candles[index].time, value: value() });
  }
  return result;
};

const emaValues = (values, period) => {
  if (values.length < period) return [];
  const result = [];
  let average = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result.push(average);
  const alpha = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    average = ((values[index] - average) * alpha) + average;
    result.push(average);
  }
  return result;
};

export const calculateMacdSeries = (candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
  if (!Array.isArray(candles) || candles.length < slowPeriod + signalPeriod - 1) {
    return { macd: [], signal: [], histogram: [] };
  }
  const closes = candles.map((candle) => candle.close);
  const fast = emaValues(closes, fastPeriod);
  const slow = emaValues(closes, slowPeriod);
  const offset = slowPeriod - fastPeriod;
  const macdValues = slow.map((value, index) => fast[index + offset] - value);
  const signalValues = emaValues(macdValues, signalPeriod);
  const signalOffset = signalPeriod - 1;
  const macd = [];
  const signal = [];
  const histogram = [];
  for (let index = signalOffset; index < macdValues.length; index += 1) {
    const sourceIndex = slowPeriod - 1 + index;
    const line = macdValues[index];
    const signalValue = signalValues[index - signalOffset];
    const time = candles[sourceIndex].time;
    macd.push({ time, value: line });
    signal.push({ time, value: signalValue });
    histogram.push({ time, value: line - signalValue });
  }
  return { macd, signal, histogram };
};

export const calculateAtrSeries = (candles, period = 14) => {
  if (!Array.isArray(candles) || candles.length <= period) return [];
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    trueRanges.push(Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose)));
  }
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const result = [{ time: candles[period].time, value: atr }];
  for (let index = period; index < trueRanges.length; index += 1) {
    atr = ((atr * (period - 1)) + trueRanges[index]) / period;
    result.push({ time: candles[index + 1].time, value: atr });
  }
  return result;
};

export const calculateSupertrendSeries = (candles, period = 10, multiplier = 3) => {
  const atr = calculateAtrSeries(candles, period);
  if (!atr.length) return [];
  const atrByTime = new Map(atr.map((point) => [point.time, point.value]));
  let upperBand = null;
  let lowerBand = null;
  let direction = 1;
  const result = [];
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const volatility = atrByTime.get(candle.time);
    if (!Number.isFinite(volatility)) continue;
    const midpoint = (candle.high + candle.low) / 2;
    const basicUpper = midpoint + (multiplier * volatility);
    const basicLower = midpoint - (multiplier * volatility);
    const previousClose = candles[index - 1]?.close;
    upperBand = upperBand === null || basicUpper < upperBand || previousClose > upperBand ? basicUpper : upperBand;
    lowerBand = lowerBand === null || basicLower > lowerBand || previousClose < lowerBand ? basicLower : lowerBand;
    if (candle.close > upperBand) direction = 1;
    else if (candle.close < lowerBand) direction = -1;
    result.push({ time: candle.time, value: direction > 0 ? lowerBand : upperBand, direction });
  }
  return result;
};

export const calculateVolumeAverage = (candles, period = 20) => {
  if (!Array.isArray(candles) || candles.length < period) return [];
  const result = [];
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    if (window.some((candle) => typeof candle.value !== 'number' || !Number.isFinite(candle.value) || candle.value < 0)) continue;
    result.push({ time: candles[index].time, value: window.reduce((sum, candle) => sum + candle.value, 0) / period });
  }
  return result;
};

export const calculateFibonacciLevels = (candles) => {
  if (!Array.isArray(candles) || !candles.length) return [];
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const span = high - low;
  return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((ratio) => ({
    ratio,
    price: high - (span * ratio),
  }));
};
