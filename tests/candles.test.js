import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_RESOLUTIONS,
  aggregateCandles,
  mergeNote,
  planResolution,
  resolutionSeconds,
} from '../candleResolution.js';

const YAHOO_NATIVE = ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'];

test('every chart timeframe in the product spec resolves', () => {
  const required = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
  required.forEach((resolution) => {
    const plan = planResolution(resolution, YAHOO_NATIVE);
    assert.ok(plan, `${resolution} must resolve against the Yahoo native set`);
    assert.equal(plan.seconds, resolutionSeconds(resolution));
    assert.ok(YAHOO_NATIVE.includes(plan.baseResolution));
    assert.equal(plan.baseSeconds * plan.factor, plan.seconds);
  });
  assert.deepEqual(SUPPORTED_RESOLUTIONS.filter((r) => !required.includes(r)), ['45m', '2h']);
});

test('calendar bars are only served natively', () => {
  assert.equal(planResolution('1d', ['1m', '5m']), null);
  assert.equal(planResolution('1w', ['1h']), null);
  assert.equal(planResolution('1M', ['1d']), null);
  assert.equal(planResolution('1d', ['1d']).factor, 1);
});

test('unsupported granularities are rejected instead of guessed', () => {
  assert.equal(planResolution('7m', YAHOO_NATIVE), null);
  assert.equal(resolutionSeconds('90s'), null);
  assert.equal(planResolution('', YAHOO_NATIVE), null);
});

test('aggregation merges exact IST-aligned buckets without inventing bars', () => {
  // 08:15 IST = 02:45 UTC; a 45m bucket therefore starts on the IST clock.
  const start = Math.floor(Date.UTC(2026, 10, 5, 3, 15, 0) / 1000);
  const base = Array.from({ length: 12 }, (_, index) => ({
    time: start + index * 60,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    value: 10,
  }));
  const merged = aggregateCandles(base, 2700);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].time, start - 1800);
  assert.equal(new Date(merged[0].time * 1000).toISOString(), '2026-11-05T02:45:00.000Z');
  assert.equal(merged[0].open, 100);
  assert.equal(merged[0].high, 112);
  assert.equal(merged[0].low, 99);
  assert.equal(merged[0].close, 111.5);
  assert.equal(merged[0].value, 120);
});

test('aggregation spans buckets and keeps missing volume honest', () => {
  const start = Math.floor(Date.UTC(2026, 10, 5, 4, 0, 0) / 1000);
  const base = [
    { time: start, open: 10, high: 12, low: 9, close: 11, value: 5 },
    { time: start + 300, open: 11, high: 15, low: 10, close: 14, value: null },
    { time: start + 600, open: 14, high: 16, low: 13, close: 15, value: 7 },
  ];
  const merged = aggregateCandles(base, 600);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].value, 5);
  assert.equal(merged[1].value, 7);
  assert.equal(merged[1].open, 14);
  assert.equal(mergeNote(planResolution('10m', YAHOO_NATIVE)), '10m bars merged from verified 5m provider bars');
  assert.equal(mergeNote(planResolution('5m', YAHOO_NATIVE)), '');
});
