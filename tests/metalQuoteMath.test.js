import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyExchangeQuote,
  convertTroyOunceUsdToInr,
  metalUnitPrices,
  parseQuoteTimestamp,
  TROY_OUNCE_GRAMS,
} from '../metalQuoteMath.js';

test('MCX full quotes use the documented Upstox v2 endpoint', () => {
  const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(serverSource, /const UPSTOX_BASE_URL = 'https:\/\/api\.upstox\.com\/v2';/);
  assert.ok(serverSource.includes('`${UPSTOX_BASE_URL}/market-quote/quotes`'));
});

test('gold and silver unit prices preserve the provider quote value', () => {
  assert.deepEqual(metalUnitPrices('GOLD', 120000), {
    inrPerGram: 12000,
    inrPer10g: 120000,
    inrPerKg: 12000000,
  });
  assert.deepEqual(metalUnitPrices('SILVER', 150000), {
    inrPerGram: 150,
    inrPer10g: 1500,
    inrPerKg: 150000,
  });
});

test('troy-ounce USD conversion uses the exact mass and FX rate', () => {
  const result = convertTroyOunceUsdToInr(4000, 90, 10);
  assert.equal(result, Number((4000 * 90 * 10 / TROY_OUNCE_GRAMS).toFixed(2)));
});

test('metal conversions reject unavailable or invalid provider values', () => {
  assert.equal(convertTroyOunceUsdToInr(0, 90, 10), null);
  assert.equal(convertTroyOunceUsdToInr(4000, Number.NaN, 10), null);
  assert.deepEqual(metalUnitPrices('COPPER', 1000), {
    inrPerGram: null,
    inrPer10g: null,
    inrPerKg: null,
  });
});

test('exchange timestamps support seconds, milliseconds and provider date strings', () => {
  assert.equal(parseQuoteTimestamp(1_700_000_000), 1_700_000_000_000);
  assert.equal(parseQuoteTimestamp(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(parseQuoteTimestamp('2026-11-13T05:00:00.000Z'), 1_794_546_000_000);
  assert.equal(parseQuoteTimestamp(null), null);
  assert.equal(parseQuoteTimestamp('invalid'), null);
});

test('an exchange quote is live only while market is open and its timestamp is fresh', () => {
  const now = Date.parse('2026-11-13T05:01:00.000Z');
  assert.deepEqual(classifyExchangeQuote({
    timestamp: '2026-11-13T05:00:00.000Z',
    now,
    marketOpen: true,
  }), {
    timestampMs: Date.parse('2026-11-13T05:00:00.000Z'),
    ageMs: 60_000,
    isStale: false,
    isLive: true,
  });

  assert.equal(classifyExchangeQuote({
    timestamp: '2026-11-13T05:00:00.000Z',
    now,
    marketOpen: false,
  }).isLive, false);
  assert.equal(classifyExchangeQuote({
    timestamp: '2026-11-13T04:58:59.000Z',
    now,
    marketOpen: true,
  }).isStale, true);
});

test('missing and future exchange timestamps are never labelled live', () => {
  const now = Date.parse('2026-11-13T05:00:00.000Z');
  for (const timestamp of [null, 'invalid', '2026-11-13T05:00:06.000Z']) {
    const result = classifyExchangeQuote({ timestamp, now, marketOpen: true });
    assert.equal(result.isLive, false);
    assert.equal(result.isStale, true);
  }
});
