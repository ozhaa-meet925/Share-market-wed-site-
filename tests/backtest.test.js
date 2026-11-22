import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateEquityCosts, costPercentForNotional, EQUITY_COST_RATES } from '../tradeCosts.js';
import { runBacktestSeries } from '../serverAutoTrade.js';

const DAY = 86400;
const bar = (index, overrides = {}) => ({
  time: 1760000000 + index * DAY,
  open: 100 + index * 0.5,
  high: 101 + index * 0.5,
  low: 99 + index * 0.5,
  close: 100.4 + index * 0.5,
  volume: 1_000_000,
  ...overrides,
});

const risingSeries = (length, patch = {}) => Array.from({ length }, (_, index) => {
  const overrides = {...(patch[index] || {})};
  return bar(index, overrides);
});

test('Indian delivery cost model charges both legs on a 1 lakh notional', () => {
  const costs = estimateEquityCosts({ notional: 100000 });
  assert.equal(costs.model, 'indian_equity_delivery');
  assert.equal(costs.buy.brokerage, 20);
  assert.equal(costs.buy.stt, 100);
  assert.equal(costs.buy.stamp, 15);
  assert.equal(costs.buy.exchange, 2.97);
  assert.equal(costs.buy.sebi, 0.1);
  assert.equal(costs.buy.gst, 4.1526);
  assert.equal(costs.sell.gst, 4.1526);
  assert.equal(costs.sell.dp, 15.93);
  assert.equal(costs.buy.total, 142.2226);
  assert.equal(costs.sell.total, 143.1526);
  assert.equal(costs.roundTripPercent, 0.285375);
  assert.ok(EQUITY_COST_RATES.brokerageCap === 20);
  assert.equal(estimateEquityCosts({ notional: 0 }), null);
});

test('costPercentForNotional returns per-side percentages used by the engine', () => {
  const model = costPercentForNotional(200000);
  assert.equal(model.buyPercent, 0.130423);
  assert.equal(model.sellPercent, 0.123388);
  assert.ok(model.roundTripPercent > 0.2 && model.roundTripPercent < 0.3);
});

test('backtest fills the entry at the next session open, not the signal close', () => {
  const series = risingSeries(80);
  const run = runBacktestSeries({
    symbol: 'TEST', candles: series, days: 80,
    targetPercent: 10, stopLossPercent: 5, costBps: 0,
    rules: ['above_sma20'],
  });
  assert.ok(run.trades.length >= 1);
  const first = run.trades[0];
  const signalBar = series[50];
  const entryBar = series[51];
  assert.equal(new Date(first.entryAt).getTime(), entryBar.time * 1000);
  assert.notEqual(first.entryAt, new Date(signalBar.time * 1000).toISOString());
  assert.equal(first.entryPrice, entryBar.open);
});

test('stop-loss is triggered by the intrabar low even when the close recovers', () => {
  const series = risingSeries(80, {
    52: { low: 115, high: 127.5, close: 126.8, open: 126 },
  });
  const run = runBacktestSeries({
    symbol: 'TEST', candles: series, days: 80,
    targetPercent: 10, stopLossPercent: 2, costBps: 0,
    rules: ['above_sma20'],
  });
  const stopTrade = run.trades.find((trade) => trade.exitReason === 'stop_loss');
  assert.ok(stopTrade, 'expected an intrabar stop exit');
  assert.ok(stopTrade.exitPrice < series[52].close, 'stop must fill below the recovering close');
  assert.equal(stopTrade.exitPrice, Math.round((series[51].open * 0.98) * 100) / 100);
});

test('custom entry rules change the signals and are reported back', () => {
  const series = Array.from({ length: 80 }, (_, index) => (index < 61
    ? bar(index, { open: 100, high: 101, low: 99, close: 100.4, volume: 1_000_000 })
    : bar(index, { open: 108 + (index - 61), high: 111 + (index - 61), low: 107 + (index - 61), close: 110 + (index - 61), volume: 2_500_000 })));
  const breakout = runBacktestSeries({
    symbol: 'TEST', candles: series, days: 80,
    targetPercent: 10, stopLossPercent: 5, costBps: 0,
    rules: ['breakout_20', 'volume_surge'],
  });
  assert.deepEqual(breakout.rules, ['breakout_20', 'volume_surge']);
  assert.equal(breakout.rules.length, 2);
  assert.ok(breakout.trades.length >= 1);
});

test('the default run applies the full cost model and reports it', () => {
  const series = risingSeries(120);
  const run = runBacktestSeries({
    symbol: 'TEST', candles: series, days: 120,
    targetPercent: 10, stopLossPercent: 5,
  });
  assert.ok(run.metrics.costPercentRoundTrip > 0.2);
  assert.ok(run.metrics.costBpsPerSide > 10);
  assert.ok(run.assumptions.some((line) => line.includes('STT')));
  assert.ok(run.trades.every((trade) => trade.exitReason !== 'target' || trade.returnPercent < 10));
});
