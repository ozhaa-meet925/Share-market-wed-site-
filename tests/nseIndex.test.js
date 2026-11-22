import test from 'node:test';
import assert from 'node:assert/strict';
import { isNseIndexSymbol, isNseSessionOpen, normalizeNseIndexPayload } from '../nseIndexProvider.js';

const row = (index, overrides = {}) => ({
  index,
  last: 100,
  variation: 1.5,
  percentChange: 1.52,
  previousClose: 98.5,
  open: 99,
  high: 101,
  low: 98,
  yearHigh: 120,
  yearLow: 80,
  advances: 30,
  declines: 20,
  ...overrides,
});

const payload = (timestamp, rows = [row('NIFTY 50')]) => ({ timestamp, data: rows });

test('NSE index rows normalize to exchange quotes with IST timestamps', () => {
  const result = normalizeNseIndexPayload(payload('04-Nov-2026 15:30'), Date.parse('2026-11-04T10:30:00Z'));
  const quote = result.quotes.NIFTY;
  assert.ok(quote);
  assert.equal(quote.c, 100);
  assert.equal(quote.pc, 98.5);
  assert.equal(quote.timestamp, '2026-11-04T10:00:00.000Z');
  assert.equal(quote.provider, 'NSE India');
  assert.equal(quote.liveFeed, 'nse');
  assert.equal(quote.isResearch, false);
  assert.equal(quote.isDemo, false);
});

test('a feed timestamp inside the session is marked live only when fresh', () => {
  const open = Date.parse('2026-11-04T08:29:00Z');
  const fresh = normalizeNseIndexPayload(payload('04-Nov-2026 13:58'), open).quotes.NIFTY;
  assert.equal(fresh.isLive, true);
  assert.equal(fresh.isDelayed, false);
  assert.equal(fresh.isClose, false);

  const delayed = normalizeNseIndexPayload(payload('04-Nov-2026 13:45'), open).quotes.NIFTY;
  assert.equal(delayed.isLive, false);
  assert.equal(delayed.isDelayed, true);
  assert.equal(delayed.isClose, false);

  const stale = normalizeNseIndexPayload(payload('04-Nov-2026 11:00'), open).quotes.NIFTY;
  assert.equal(stale.isLive, false);
  assert.equal(stale.isDelayed, false);
  assert.equal(stale.isStale, true);
});

test('a closed session or a previous-day feed is labelled as the exchange close', () => {
  const afterClose = normalizeNseIndexPayload(payload('04-Nov-2026 15:30'), Date.parse('2026-11-04T10:30:00Z')).quotes.NIFTY;
  assert.equal(afterClose.isLive, false);
  assert.equal(afterClose.isDelayed, false);
  assert.equal(afterClose.isStale, false);
  assert.equal(afterClose.isClose, true);

  const preOpen = normalizeNseIndexPayload(payload('04-Nov-2026 15:30'), Date.parse('2026-11-05T02:30:00Z')).quotes.NIFTY;
  assert.equal(preOpen.isClose, true);
  assert.equal(preOpen.isLive, false);
});

test('missing rows are skipped and only known NSE indices are addressed', () => {
  const result = normalizeNseIndexPayload({
    timestamp: '04-Nov-2026 15:30',
    data: [row('NIFTY IT', { last: 32061.9, percentChange: -1.5 }), row('NIFTY MIDCAP 150', { last: 21867.3 })],
  }, Date.parse('2026-11-04T10:30:00Z'));
  assert.deepEqual(Object.keys(result.quotes).sort(), ['NIFTYIT', 'NIFTYMIDCAP']);
  assert.equal(result.quotes.NIFTYIT.c, 32061.9);
  assert.equal(result.quotes.NIFTYIT.dp, -1.5);

  assert.equal(isNseIndexSymbol('NIFTY'), true);
  assert.equal(isNseIndexSymbol('BSE:SENSEX'), false, 'SENSEX is a BSE index and has no NSE feed');
  assert.equal(isNseIndexSymbol('RELIANCE'), false);
});

test('session detection follows IST weekday hours', () => {
  assert.equal(isNseSessionOpen(Date.parse('2026-11-04T04:00:00Z')), true, '09:30 IST');
  assert.equal(isNseSessionOpen(Date.parse('2026-11-04T10:00:00Z')), true, '15:30 IST');
  assert.equal(isNseSessionOpen(Date.parse('2026-11-04T10:31:00Z')), false, '16:01 IST');
  assert.equal(isNseSessionOpen(Date.parse('2026-11-07T05:00:00Z')), false, 'Saturday');
});
