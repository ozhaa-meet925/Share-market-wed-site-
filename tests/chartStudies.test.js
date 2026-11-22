import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAverageSeries,
  calculateAtrSeries,
  calculateBollinger,
  calculateFibonacciLevels,
  calculateMacdSeries,
  calculateRsiSeries,
  calculateSessionVwap,
  calculateSupertrendSeries,
  calculateVolumeAverage,
  toRenkoCloseSeries,
  updateLatestCandle,
} from '../src/utils/chartStudies.js';
import { forecastFromDailyCandles } from '../src/utils/marketForecast.js';

const candlesFromCloses = (closes) => closes.map((close, index) => ({
  time: index + 1,
  open: close,
  high: close,
  low: close,
  close,
  value: 1,
}));

const liveBarTime = Date.UTC(2026, 10, 13, 4, 0) / 1000;
const liveBars = [
  { time: liveBarTime - 300, open: 99, high: 101, low: 98, close: 100, value: 10 },
  { time: liveBarTime, open: 100, high: 102, low: 99, close: 101, value: 12 },
];
const providerTick = { c: 103, t: liveBarTime + 30, isLive: true, marketOpen: true };
const tickNow = (liveBarTime + 40) * 1000;

test('live ticks update only the latest OHLC candle and preserve reported volume', () => {
  const result = updateLatestCandle(liveBars, providerTick, 300, tickNow);
  assert.equal(result.length, liveBars.length);
  assert.equal(result[0], liveBars[0]);
  assert.deepEqual(result[1], { ...liveBars[1], close: 103, high: 103, quoteTime: providerTick.t * 1000 });
  assert.equal(liveBars[1].close, 101);
  assert.equal(updateLatestCandle(result, providerTick, 300, tickNow), result);
  assert.equal(updateLatestCandle(result, { ...providerTick, c: 100, t: liveBarTime + 20 }, 300, tickNow), result);
});

test('delayed and research quotes update the forming bar and keep their own basis', () => {
  for (const flags of [{ isDelayed: true }, { isResearch: true }, { isReal: true }]) {
    const result = updateLatestCandle(liveBars, { ...providerTick, ...flags }, 300, tickNow);
    assert.equal(result.length, liveBars.length);
    assert.equal(result[1].close, 103);
    assert.deepEqual(result[1], { ...liveBars[1], close: 103, high: 103, quoteTime: providerTick.t * 1000 });
  }
});

test('stale, closed, demo and unverified quotes never alter candles', () => {
  for (const flags of [
    { isLive: false }, { isStale: true }, { isClose: true }, { marketOpen: false }, { isDemo: true },
  ]) {
    assert.equal(updateLatestCandle(liveBars, { ...providerTick, ...flags }, 300, tickNow), liveBars);
  }
  assert.equal(updateLatestCandle(liveBars, { c: 103, t: liveBarTime + 30, marketOpen: true }, 300, tickNow), liveBars);
});

test('candle updates reject missing, old, future and earlier-bucket timestamps', () => {
  for (const t of [undefined, null, '', 'invalid', liveBarTime - 1, liveBarTime + 46]) {
    assert.equal(updateLatestCandle(liveBars, { ...providerTick, t }, 300, tickNow), liveBars);
  }
  assert.equal(updateLatestCandle(liveBars, providerTick, 300, tickNow + 180000), liveBars);
  assert.equal(updateLatestCandle(liveBars, providerTick, 86400, tickNow), liveBars);
  assert.equal(updateLatestCandle(liveBars, providerTick, undefined, tickNow), liveBars);
  for (const c of [null, 0, -1, 'bad', Infinity]) {
    assert.equal(updateLatestCandle(liveBars, { ...providerTick, c }, 300, tickNow), liveBars);
  }
});

test('a quote in the next bucket starts one new bar and keeps earlier gaps', () => {
  const tick = { c: 104, t: liveBarTime + 300, isLive: true, marketOpen: true, v: 40 };
  const now = (liveBarTime + 310) * 1000;
  const result = updateLatestCandle(liveBars, tick, 300, now);
  assert.equal(result.length, liveBars.length + 1);
  assert.equal(result[0], liveBars[0]);
  assert.deepEqual(result.at(-1), {
    time: liveBarTime + 300,
    open: 104,
    high: 104,
    low: 104,
    close: 104,
    value: 18,
    quoteTime: tick.t * 1000,
  });
  assert.equal(updateLatestCandle(liveBars, { ...tick, t: liveBarTime + 2400 }, 300, now), liveBars, 'the new bar cannot start in the future');
});

test('session volume inside a bar subtracts volume already printed in the session', () => {
  const sessionBars = [
    { time: liveBarTime - 300, open: 99, high: 101, low: 98, close: 100, value: 10 },
    { time: liveBarTime, open: 100, high: 102, low: 99, close: 101, value: 12 },
  ];
  const intraday = updateLatestCandle(sessionBars, { ...providerTick, v: 40 }, 300, tickNow);
  assert.equal(intraday[1].value, 30, '40 cumulative minus 10 from the earlier bar');
  const daily = updateLatestCandle(liveBars, { ...providerTick, t: liveBarTime + 30, v: 40 }, 86400, tickNow);
  assert.equal(daily, liveBars, 'a 09:30 IST quote belongs to the previous IST day on a daily chart');
});

test('live candle timestamps accept provider ISO strings and epoch milliseconds', () => {
  const expected = updateLatestCandle(liveBars, providerTick, 300, tickNow);
  assert.deepEqual(updateLatestCandle(liveBars, { ...providerTick, lastTradeTime: new Date(providerTick.t * 1000).toISOString() }, 300, tickNow), expected);
  assert.deepEqual(updateLatestCandle(liveBars, { ...providerTick, t: providerTick.t * 1000 }, 300, tickNow), expected);
});

test('same-price ticks retain ordering and falling ticks update the low without fabricating open', () => {
  const unchangedPrice = updateLatestCandle(liveBars, { ...providerTick, c: 101 }, 300, tickNow);
  assert.equal(updateLatestCandle(unchangedPrice, { ...providerTick, c: 98, t: liveBarTime + 20 }, 300, tickNow), unchangedPrice);
  const result = updateLatestCandle(unchangedPrice, { ...providerTick, c: 98, t: liveBarTime + 31 }, 300, tickNow);
  assert.equal(result[1].low, 98);
  assert.equal(result[1].high, 102);
  assert.equal(result[1].open, 100);
});

test('simple and exponential moving averages use the selected provider closes', () => {
  const candles = candlesFromCloses([1, 2, 3, 4, 5]);
  assert.deepEqual(calculateAverageSeries(candles, 3), [
    { time: 3, value: 2 }, { time: 4, value: 3 }, { time: 5, value: 4 },
  ]);
  assert.deepEqual(calculateAverageSeries(candles, 3, 'ema'), [
    { time: 3, value: 2 }, { time: 4, value: 3 }, { time: 5, value: 4 },
  ]);
  assert.deepEqual(calculateAverageSeries(candles, 20), []);
});

test('Bollinger bands use a rolling population standard deviation', () => {
  const result = calculateBollinger(candlesFromCloses([1, 2, 3]), 3, 2);
  const deviation = Math.sqrt(2 / 3);
  assert.deepEqual(result.middle, [{ time: 3, value: 2 }]);
  assert.ok(Math.abs(result.upper[0].value - (2 + (2 * deviation))) < 1e-12);
  assert.ok(Math.abs(result.lower[0].value - (2 - (2 * deviation))) < 1e-12);
});

test('Renko close steps retain the real source-bar timestamps', () => {
  const result = toRenkoCloseSeries(candlesFromCloses([100, 101, 99.7]));
  assert.deepEqual(result.map(({ time }) => time), [1, 2, 3]);
  assert.deepEqual(result.map(({ value }) => value), [100, 100.6, 100]);
  assert.equal(new Set(result.map(({ time }) => time)).size, result.length);
});

test('session VWAP resets at the next IST trading date and rejects incomplete volume history', () => {
  const firstBar = Date.UTC(2026, 10, 5, 4, 0) / 1000;
  const result = calculateSessionVwap([
    { time: firstBar, high: 11, low: 9, close: 10, value: 2 },
    { time: firstBar + 60, high: 21, low: 19, close: 20, value: 1 },
    { time: firstBar + 86400, high: 31, low: 29, close: 30, value: 1 },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].value, 10);
  assert.ok(Math.abs(result[1].value - (40 / 3)) < 1e-12);
  assert.equal(result[2].value, 30);
  assert.deepEqual(calculateSessionVwap([{ time: firstBar, high: 11, low: 9, close: 10, value: null }]), []);
});

test('RSI uses Wilder smoothing and handles flat and one-way price paths', () => {
  assert.equal(calculateRsiSeries(candlesFromCloses(Array.from({ length: 16 }, (_, i) => i + 1)), 14).at(-1).value, 100);
  assert.equal(calculateRsiSeries(candlesFromCloses(Array(16).fill(5)), 14).at(-1).value, 50);
});

test('MACD aligns fast and slow averages before computing its signal', () => {
  const result = calculateMacdSeries(candlesFromCloses(Array.from({ length: 60 }, (_, i) => 100 + (i * 0.5))));
  assert.ok(result.macd.length > 0);
  assert.ok(result.signal.length > 0);
  assert.ok(result.histogram.every((point) => Number.isFinite(point.value)));
  assert.equal(result.macd[0].time, result.signal[0].time);
});

test('ATR and Supertrend use the verified high, low, and prior close series', () => {
  const candles = [
    { time: 1, open: 10, high: 11, low: 9, close: 10 },
    { time: 2, open: 10, high: 12, low: 9, close: 11 },
    { time: 3, open: 11, high: 13, low: 10, close: 12 },
    { time: 4, open: 12, high: 14, low: 12, close: 13 },
  ];
  const atr = calculateAtrSeries(candles, 2);
  assert.deepEqual(atr, [{ time: 3, value: 3 }, { time: 4, value: 2.5 }]);
  const supertrend = calculateSupertrendSeries(candles, 2, 2);
  assert.ok(supertrend.length > 0);
  assert.ok(supertrend.every((point) => Number.isFinite(point.value) && [-1, 1].includes(point.direction)));
});

test('volume average excludes bars without a reported volume and Fibonacci levels use selected highs/lows', () => {
  const volume = calculateVolumeAverage([
    { time: 1, value: 10 }, { time: 2, value: null }, { time: 3, value: 20 }, { time: 4, value: 30 },
  ], 2);
  assert.deepEqual(volume, [{ time: 4, value: 25 }]);
  const levels = calculateFibonacciLevels([
    { high: 110, low: 100 }, { high: 120, low: 105 },
  ]);
  assert.equal(levels[0].price, 120);
  assert.equal(levels.at(-1).price, 100);
  assert.equal(levels.find((level) => level.ratio === 0.5).price, 110);
});

test('the research model withholds probabilities on short history', () => {
  const result = forecastFromDailyCandles(candlesFromCloses(Array.from({ length: 80 }, (_, i) => 100 + i)));
  assert.equal(result.status, 'insufficient_history');
  assert.equal(result.probabilityPercent, null);
});

test('the research model reports a chronological holdout and sensitivity range', () => {
  let close = 100;
  const candles = Array.from({ length: 240 }, (_, index) => {
    close *= 1 + (0.0008 + (Math.sin(index / 5) * 0.004));
    return { time: (index + 1) * 86400, open: close * 0.998, high: close * 1.01, low: close * 0.99, close };
  });
  const result = forecastFromDailyCandles(candles, { horizonBars: 3, minimumTrainSamples: 60, minimumTestSamples: 20 });
  assert.equal(result.status, 'ok');
  assert.equal(result.model, 'L2 logistic-regression ensemble');
  assert.ok(result.performance.sampleCount >= 20);
  assert.ok(result.performance.accuracyPercent >= 0 && result.performance.accuracyPercent <= 100);
  assert.ok(result.performance.brierScore >= 0 && result.performance.brierScore <= 1);
  assert.ok(result.modelSensitivityRangePercent[0] <= result.probabilityPercent);
  assert.ok(result.modelSensitivityRangePercent[1] >= result.probabilityPercent);
  assert.equal(result.featureSensitivities.length, 7);
  assert.ok(result.featureSensitivities.every((item) => item.feature && Number.isFinite(item.probabilityChangePoints)));
});
