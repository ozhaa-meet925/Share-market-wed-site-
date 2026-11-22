import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMetalInsight } from '../metalInsight.js';

const DAY = 86400;
const TIME0 = 1_735_000_000; // fixed epoch, aligned to a UTC day boundary

const series = (count, start, step) => Array.from({ length: count }, (_, index) => {
  const close = start + step * index;
  const open = close - step;
  return {
    time: TIME0 + index * DAY,
    open,
    high: Math.max(open, close) + 2,
    low: Math.min(open, close) - 2,
    close,
    value: 100 + index,
  };
});

test('metals insight withholds a read until enough verified daily bars exist', () => {
  const insight = computeMetalInsight({
    symbol: 'GOLD',
    quote: { c: 76500, dp: 0.4, isLive: false, isDelayed: true, provider: 'Yahoo Finance delayed GC=F' },
    candles: series(12, 70000, 10),
    historyProvider: 'Yahoo Finance delayed GC=F',
  });
  assert.equal(insight.status, 'insufficient_history');
  assert.equal(insight.candleCount, 12);
  assert.equal(insight.minimumBars, 30);
  assert.equal(insight.quote.price, 76500);
  assert.match(insight.note, /at least 30 verified daily bars/i);
  assert.equal(insight.summary, undefined);
});

test('a rising daily series reads bullish with overbought RSI and a live trend line', () => {
  const insight = computeMetalInsight({
    symbol: 'GOLD',
    quote: { c: 82000, dp: 1.25, isLive: true, provider: 'Upstox MCX Gold' },
    candles: series(200, 60000, 100),
    historyProvider: 'Yahoo Finance delayed GC=F · USD/INR conversion',
  });

  assert.equal(insight.status, 'ok');
  assert.equal(insight.trend, 'bullish');
  assert.ok(insight.metrics.sma20 > insight.metrics.sma50);
  assert.equal(insight.metrics.rsi14, 100);
  assert.ok(insight.signals.includes('overbought'));
  assert.ok(insight.signals.includes('above-sma20'));
  assert.ok(insight.signals.includes('above-sma50'));
  assert.equal(insight.metrics.price, 82000);
  assert.ok(insight.metrics.support < insight.metrics.resistance);
  assert.ok(insight.metrics.week52High >= insight.metrics.week52Low);
  assert.match(insight.basisLabel, /live upstox mcx quote/i);
  assert.match(insight.summary, /RSI\(14\) is 100/);
  for (const value of Object.values(insight.metrics)) {
    assert.ok(value === null || Number.isFinite(Number(value)), `metric ${value} must be finite`);
  }
});

test('a falling daily series reads bearish with oversold RSI', () => {
  const insight = computeMetalInsight({
    symbol: 'SILVER',
    quote: { c: 89000, dp: -2.1, isDelayed: true, provider: 'Yahoo Finance delayed SI=F' },
    candles: series(200, 120000, -100),
  });

  assert.equal(insight.status, 'ok');
  assert.equal(insight.trend, 'bearish');
  assert.equal(insight.metrics.rsi14, 0);
  assert.ok(insight.signals.includes('oversold'));
  assert.ok(insight.signals.includes('below-sma20'));
  assert.ok(insight.signals.includes('below-sma50'));
  assert.match(insight.summary, /52-week range/);
});

test('a flat series stays neutral instead of inventing a trend', () => {
  const insight = computeMetalInsight({
    symbol: 'GOLD',
    quote: null,
    candles: series(120, 70000, 0),
  });

  assert.equal(insight.status, 'ok');
  assert.equal(insight.trend, 'neutral');
  assert.equal(insight.metrics.rsi14, 50);
  assert.equal(insight.quote, null);
  assert.match(insight.basisLabel, /Verified quotes unavailable/);
  assert.equal(insight.metrics.distanceFromHighPercent, 0);
});

test('stale quotes are labelled stale and never presented as live', () => {
  const insight = computeMetalInsight({
    symbol: 'GOLD',
    quote: { c: 76000, isLive: false, isDelayed: true, isStale: true, provider: 'Yahoo Finance delayed GC=F' },
    candles: series(60, 70000, 5),
  });

  assert.equal(insight.quote.isLive, false);
  assert.equal(insight.quote.isStale, true);
  assert.match(insight.basisLabel, /stale, not live/i);
});

test('invalid or duplicate candles are dropped before the read is computed', () => {
  const base = series(40, 70000, 5);
  const candles = [
    ...base,
    { time: base[0].time, open: 1, high: 1, low: 1, close: 1 },
    { time: base[5].time + 1, open: 0, high: 0, low: 0, close: 0 },
    { time: 'nope', open: 1, high: 2, low: 0, close: 1 },
  ];
  const insight = computeMetalInsight({ symbol: 'GOLD', candles });

  assert.equal(insight.status, 'ok');
  assert.equal(insight.history.bars, 40);
  assert.equal(insight.history.lastBarTime, base.at(-1).time);
});

test('forecast block is either a real holdout result or an explicit withhold', () => {
  const insight = computeMetalInsight({
    symbol: 'GOLD',
    candles: series(200, 60000, 100),
  });

  assert.ok(['ok', 'insufficient_history'].includes(insight.forecast.status));
  if (insight.forecast.status === 'ok') {
    assert.ok(insight.forecast.probabilityPercent >= 0 && insight.forecast.probabilityPercent <= 100);
    assert.ok(['bullish', 'bearish', 'neutral'].includes(insight.forecast.direction));
    assert.ok(insight.forecast.performance.sampleCount >= 30);
    assert.match(insight.forecast.disclaimer, /not a guarantee|holdout/i);
  } else {
    assert.match(insight.forecast.note, /withheld/i);
  }
});
