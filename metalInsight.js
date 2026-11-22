import { forecastFromDailyCandles } from './src/utils/marketForecast.js';

const MINIMUM_BARS = 30;
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const TRADING_DAYS = 252;

const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
};
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

const movingAverage = (closes, period) => {
  if (closes.length < period) return null;
  return round(average(closes.slice(-period)));
};

const rsiAt = (closes, period = 14) => {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  if (gains === 0 && losses === 0) return 50;
  if (losses === 0) return 100;
  if (gains === 0) return 0;
  return round(100 - (100 / (1 + (gains / losses))), 1);
};

const dailyVolatilityPercent = (closes, period = 20) => {
  if (closes.length <= period) return null;
  const returns = [];
  for (let index = closes.length - period; index < closes.length; index += 1) {
    returns.push(Math.log(closes[index] / closes[index - 1]));
  }
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return round(Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100, 1);
};

const classifyTrend = ({ price, sma20, sma50 }) => {
  if (!Number.isFinite(price) || !Number.isFinite(sma20) || !Number.isFinite(sma50)) return 'neutral';
  const alignedUp = price >= sma20 && sma20 >= sma50 && (price > sma20 || sma20 > sma50);
  const alignedDown = price <= sma20 && sma20 <= sma50 && (price < sma20 || sma20 < sma50);
  if (alignedUp) return 'bullish';
  if (alignedDown) return 'bearish';
  return 'neutral';
};

const cleanCandles = (input) => (Array.isArray(input) ? input : [])
  .map((candle) => ({
    time: Number(candle.time),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  }))
  .filter((candle) => Number.isFinite(candle.time) && candle.time > 0
    && [candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0)
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close))
  .sort((first, second) => first.time - second.time)
  .filter((candle, index, all) => index === 0 || candle.time !== all[index - 1].time);

const quoteBasis = (quote) => {
  if (!quote) return null;
  const price = Number(quote.c);
  return {
    price: Number.isFinite(price) && price > 0 ? round(price) : null,
    changePercent: Number.isFinite(Number(quote.dp)) ? round(Number(quote.dp)) : null,
    isLive: quote.isLive === true,
    isDelayed: quote.isDelayed === true || quote.isResearch === true,
    isStale: quote.isStale === true,
    provider: quote.provider || null,
    timestamp: quote.timestamp || null,
  };
};

const basisLabel = (quote) => {
  if (!quote) return 'Verified quotes unavailable';
  if (quote.isLive === true) return 'Live Upstox MCX quote';
  if (quote.isStale === true) return 'Last verified quote · stale, not live';
  return 'Yahoo Finance delayed COMEX reference · not MCX settlement';
};

const buildSummary = ({ name, unitLabel, price, sma20, sma50, rsi14, support, resistance, weekHigh, weekLow }) => {
  const parts = [];
  if (Number.isFinite(price)) parts.push(`Last reference close is ₹${price.toLocaleString('en-IN')} per ${unitLabel}.`);
  if (Number.isFinite(sma20) && Number.isFinite(sma50)) {
    parts.push(`20-day average ₹${sma20.toLocaleString('en-IN')} and 50-day average ₹${sma50.toLocaleString('en-IN')}.`);
  }
  if (Number.isFinite(rsi14)) parts.push(`RSI(14) is ${rsi14}.`);
  if (Number.isFinite(support) && Number.isFinite(resistance)) {
    parts.push(`Recent 20-bar support sits near ₹${support.toLocaleString('en-IN')} with resistance near ₹${resistance.toLocaleString('en-IN')}.`);
  }
  if (Number.isFinite(weekHigh) && Number.isFinite(weekLow)) {
    parts.push(`52-week range is ₹${weekLow.toLocaleString('en-IN')} – ₹${weekHigh.toLocaleString('en-IN')}.`);
  }
  return parts.join(' ');
};

export const computeMetalInsight = ({
  symbol,
  quote = null,
  candles = [],
  historyProvider = '',
  horizonBars = 5,
} = {}) => {
  const cleanSymbol = String(symbol || '').trim().toUpperCase().replace(/^MCX:/, '');
  const name = cleanSymbol === 'SILVER' ? 'Silver' : 'Gold';
  const unitLabel = cleanSymbol === 'SILVER' ? 'kg' : '10g';
  const basis = quoteBasis(quote);

  const clean = cleanCandles(candles);
  if (clean.length < MINIMUM_BARS) {
    return {
      status: 'insufficient_history',
      symbol: cleanSymbol,
      name,
      unit: cleanSymbol === 'SILVER' ? 'INR/kg' : 'INR/10g',
      candleCount: clean.length,
      minimumBars: MINIMUM_BARS,
      quote: basis,
      basisLabel: basisLabel(quote),
      note: `A technical read needs at least ${MINIMUM_BARS} verified daily bars; only ${clean.length} are available right now.`,
    };
  }

  const closes = clean.map((candle) => candle.close);
  const lastCandle = clean.at(-1);
  const lastClose = round(lastCandle.close);
  const price = basis?.price ?? lastClose;
  const sma20 = movingAverage(closes, 20);
  const sma50 = movingAverage(closes, 50);
  const rsi14 = rsiAt(closes, 14);
  const volatilityPercent = dailyVolatilityPercent(closes, 20);

  const recent = clean.slice(-21, -1);
  const support = round(Math.min(...recent.map((candle) => candle.low)));
  const resistance = round(Math.max(...recent.map((candle) => candle.high)));

  const yearWindow = clean.filter((candle) => candle.time >= lastCandle.time - YEAR_SECONDS);
  const weekHigh = round(Math.max(...yearWindow.map((candle) => candle.high)));
  const weekLow = round(Math.min(...yearWindow.map((candle) => candle.low)));

  const trend = classifyTrend({ price, sma20, sma50 });
  const distanceFromHighPercent = Number.isFinite(weekHigh) && weekHigh > 0
    ? round(((price - weekHigh) / weekHigh) * 100, 1)
    : null;
  const distanceFromLowPercent = Number.isFinite(weekLow) && weekLow > 0
    ? round(((price - weekLow) / weekLow) * 100, 1)
    : null;

  const signals = [
    trend,
    Number.isFinite(sma20) ? (price >= sma20 ? 'above-sma20' : 'below-sma20') : null,
    Number.isFinite(sma50) ? (price >= sma50 ? 'above-sma50' : 'below-sma50') : null,
    Number.isFinite(rsi14) && rsi14 >= 70 ? 'overbought' : null,
    Number.isFinite(rsi14) && rsi14 <= 30 ? 'oversold' : null,
    Number.isFinite(weekHigh) && price >= weekHigh * 0.98 ? 'near-52w-high' : null,
    Number.isFinite(weekLow) && price <= weekLow * 1.02 ? 'near-52w-low' : null,
    Number.isFinite(resistance) && lastClose > resistance ? 'above-20-bar-resistance' : null,
    Number.isFinite(support) && lastClose < support ? 'below-20-bar-support' : null,
  ].filter(Boolean);

  const forecast = forecastFromDailyCandles(clean, { horizonBars });
  const forecastBlock = forecast.status === 'ok'
    ? {
        status: 'ok',
        direction: forecast.direction,
        probabilityPercent: forecast.probabilityPercent,
        sensitivityRangePercent: forecast.modelSensitivityRangePercent,
        target: forecast.target,
        model: forecast.model,
        performance: forecast.performance,
        latestBarTime: forecast.latestBarTime,
        disclaimer: forecast.disclaimer,
      }
    : {
        status: forecast.status,
        candleCount: forecast.candleCount,
        note: forecast.note,
      };

  const lastBarTime = lastCandle.time;

  return {
    status: 'ok',
    symbol: cleanSymbol,
    name,
    unit: cleanSymbol === 'SILVER' ? 'INR/kg' : 'INR/10g',
    trend,
    quote: basis,
    basisLabel: basisLabel(quote),
    history: {
      provider: historyProvider || 'Yahoo Finance delayed daily bars · USD/INR conversion',
      bars: clean.length,
      lastBarTime,
      lastBarIso: new Date(lastBarTime * 1000).toISOString(),
      lastBarClose: lastClose,
    },
    metrics: {
      price,
      sma20,
      sma50,
      rsi14,
      support,
      resistance,
      volatilityPercent,
      week52High: weekHigh,
      week52Low: weekLow,
      distanceFromHighPercent,
      distanceFromLowPercent,
    },
    signals,
    summary: buildSummary({
      name, unitLabel, price, sma20, sma50, rsi14, support, resistance, weekHigh, weekLow,
    }),
    forecast: forecastBlock,
    disclaimer: 'Rules-based read of Yahoo Finance delayed daily bars converted with the USD/INR rate. These are not MCX settlement prices and this is not investment advice.',
    generatedAt: new Date().toISOString(),
  };
};
