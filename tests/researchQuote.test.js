import test from 'node:test';
import assert from 'node:assert/strict';

const { classifyResearchQuote } = await import('../yfinanceResearchProvider.js');

const IST_CLOSE_4_NOV = Date.parse('2026-11-04T10:02:29Z');
const PRE_OPEN_5_NOV = Date.parse('2026-11-05T02:00:00Z');
const MID_SESSION_5_NOV = Date.parse('2026-11-05T05:00:00Z');

test('a last-session research quote is labelled as close while the market is shut', () => {
  const result = classifyResearchQuote({ timestamp: IST_CLOSE_4_NOV / 1000, marketType: 'benchmark', now: PRE_OPEN_5_NOV });
  assert.equal(result.isClose, true);
  assert.equal(result.isStale, false);
});

test('a research quote older than the last session is stale even when the market is shut', () => {
  const sixDaysOld = (PRE_OPEN_5_NOV - 6 * 24 * 60 * 60 * 1000) / 1000;
  const result = classifyResearchQuote({ timestamp: sixDaysOld, marketType: 'equity', now: PRE_OPEN_5_NOV });
  assert.equal(result.isClose, false);
  assert.equal(result.isStale, true);
});

test('during an open session only a quote under thirty minutes old stays usable', () => {
  const fresh = classifyResearchQuote({ timestamp: (MID_SESSION_5_NOV - 60_000) / 1000, marketType: 'equity', now: MID_SESSION_5_NOV });
  const old = classifyResearchQuote({ timestamp: (MID_SESSION_5_NOV - 45 * 60_000) / 1000, marketType: 'equity', now: MID_SESSION_5_NOV });
  assert.deepEqual(fresh, { isClose: false, isStale: false });
  assert.deepEqual(old, { isClose: false, isStale: true });
});

test('global research quotes ignore the Indian session close label', () => {
  const result = classifyResearchQuote({ timestamp: IST_CLOSE_4_NOV / 1000, marketType: 'global', now: PRE_OPEN_5_NOV });
  assert.equal(result.isClose, false);
  assert.equal(result.isStale, true);
});
