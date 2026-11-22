import test from 'node:test';
import assert from 'node:assert/strict';
import { applySentiment, scoreHeadlineSentiment, SENTIMENT_METHOD } from '../serverNewsSentiment.js';

test('positive real-world style headline scores positive', () => {
  const result = scoreHeadlineSentiment('Nifty rallies to a record high as bank stocks surge');
  assert.equal(result.label, 'positive');
  assert.ok(result.score >= 0.34, `score ${result.score}`);
  assert.ok(result.matched.includes('rally'));
});

test('negative headline scores negative', () => {
  const result = scoreHeadlineSentiment('Sensex slumps as IT stocks plunge on weak results');
  assert.equal(result.label, 'negative');
  assert.ok(result.score <= -0.34, `score ${result.score}`);
});

test('headline without sentiment words stays neutral', () => {
  const result = scoreHeadlineSentiment('RBI announces the members of its new committee');
  assert.equal(result.label, 'neutral');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matched, []);
});

test('negated positive word is scored negative', () => {
  const result = scoreHeadlineSentiment('Gold does not rise despite a softer dollar');
  assert.equal(result.label, 'negative');
  assert.ok(result.score < 0);
});

test('scoring is deterministic for the same headline', () => {
  const headline = 'SIP inflows hit record high in November';
  assert.deepEqual(scoreHeadlineSentiment(headline), scoreHeadlineSentiment(headline));
  assert.ok(SENTIMENT_METHOD.includes('Keyword'));
});

test('applySentiment annotates items but keeps an explicit score', () => {
  const items = [
    { headline: 'Stocks jump as earnings beat estimates' },
    { headline: 'Shares fall on weak demand', sentiment: { label: 'negative', score: -1, matched: ['provided'] } },
  ];
  const scored = applySentiment(items);
  assert.equal(scored.length, 2);
  assert.equal(scored[0].sentiment.label, 'positive');
  assert.deepEqual(scored[1].sentiment, { label: 'negative', score: -1, matched: ['provided'] });
  assert.equal(scored[0].headline, items[0].headline);
});

test('empty or malformed input returns neutral sentiment', () => {
  assert.deepEqual(scoreHeadlineSentiment(''), { label: 'neutral', score: 0, matched: [] });
  assert.deepEqual(scoreHeadlineSentiment(null), { label: 'neutral', score: 0, matched: [] });
  assert.deepEqual(applySentiment(null), []);
});
