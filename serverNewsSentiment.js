// Deterministic keyword sentiment for real headlines. This is a transparent
// lexicon score, not a model prediction and not investment advice.

const POSITIVE_PHRASES = [
  ['all-time high', 1.5], ['record high', 1.5], ['record profit', 1.5], ['hits high', 1.2],
  ['beats estimates', 1.2], ['beats expectations', 1.2], ['buyback', 1], ['bonus issue', 0.8],
  ['order win', 1], ['wins order', 1], ['bags order', 1], ['stake buy', 0.8], ['fundraise', 0.6],
  ['fund inflow', 1], ['net inflow', 1], ['upgrade', 1], ['outperform', 1], ['expansion', 0.8],
  ['turnaround', 1], ['approval', 0.6], ['profit rises', 1.2], ['revenue rises', 1], ['dividend', 0.8],
];

const POSITIVE_WORDS = [
  'surge', 'surges', 'soar', 'soars', 'jump', 'jumps', 'rally', 'rallies', 'gain', 'gains',
  'rise', 'rises', 'climb', 'climbs', 'boost', 'boosts', 'strong', 'beats', 'profit', 'profits',
  'growth', 'grows', 'upbeat', 'optimistic', 'bullish', 'outlook', 'win', 'wins', 'record',
  'high', 'highs', 'recovery', 'rebound', 'rebounds', 'inflow', 'inflows', 'demand', 'expands',
  'upgraded', 'raise', 'raises', 'raised', 'success', 'approves', 'approved', 'doubles',
];

const NEGATIVE_PHRASES = [
  ['sell-off', -1.2], ['selloff', -1.2], ['profit warning', -1.5], ['misses estimates', -1.2],
  ['misses expectations', -1.2], ['loss widens', -1.2], ['net outflow', -1], ['fund outflow', -1],
  ['record low', -1.5], ['all-time low', -1.5], ['hits low', -1.2], ['margin squeeze', -1],
  ['downgrade', -1], ['job cuts', -0.8], ['class action', -1], ['probe ordered', -1],
];

const NEGATIVE_WORDS = [
  'fall', 'falls', 'drop', 'drops', 'slump', 'slumps', 'plunge', 'plunges', 'tumble', 'tumbles',
  'decline', 'declines', 'crash', 'crashes', 'loss', 'losses', 'weak', 'weakens', 'miss', 'misses',
  'downgrade', 'downgraded', 'bearish', 'fraud', 'scam', 'probe', 'penalty', 'fine', 'fined',
  'layoffs', 'default', 'defaults', 'resign', 'resigns', 'warning', 'warns', 'cut', 'cuts',
  'outflow', 'outflows', 'falling', 'sliding', 'pressure', 'concern', 'concerns', 'risk', 'risks',
  'strike', 'shutdown', 'delay', 'delays', 'recall', 'lawsuit', 'dip', 'dips', 'slides',
];

const NEGATIONS = new Set(['not', 'no', 'without', 'never', 'fails', 'fail', 'unlikely']);

const NORMALIZE_MAP = {
  rises: 'rise', surged: 'surge', surges: 'surge', soared: 'soar', soars: 'soar',
  jumped: 'jump', rallies: 'rally', rallied: 'rally', gained: 'gain', gains: 'gain',
  climbed: 'climb', climbs: 'climb', boosted: 'boost', boosts: 'boost',
  fell: 'fall', fallen: 'fall', dropped: 'drop', slumped: 'slump', plunged: 'plunge',
  tumbled: 'tumble', declined: 'decline', slides: 'slide', dipped: 'dip',
};

const NEGATION_WINDOW = 3;

const tokenize = (text) => text
  .replace(/[^a-z0-9%.\-\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

const isNegated = (tokens, index) => tokens
  .slice(Math.max(0, index - NEGATION_WINDOW), index)
  .some((token) => NEGATIONS.has(token));

const normalizeToken = (token) => NORMALIZE_MAP[token] || token;

export const scoreHeadlineSentiment = (headline) => {
  const text = String(headline || '').toLowerCase();
  if (!text.trim()) return { label: 'neutral', score: 0, matched: [] };
  const tokens = tokenize(text);
  let positive = 0;
  let negative = 0;
  const matched = [];

  for (const [phrase, weight] of POSITIVE_PHRASES) {
    if (text.includes(phrase)) {
      positive += Math.abs(weight);
      matched.push(phrase);
    }
  }
  for (const [phrase, weight] of NEGATIVE_PHRASES) {
    if (text.includes(phrase)) {
      negative += Math.abs(weight);
      matched.push(phrase);
    }
  }

  tokens.forEach((token, index) => {
    const base = normalizeToken(token);
    const negated = isNegated(tokens, index);
    if (POSITIVE_WORDS.includes(base)) {
      if (negated) negative += 1;
      else positive += 1;
      if (!matched.includes(base)) matched.push(base);
    }
    if (NEGATIVE_WORDS.includes(base)) {
      if (negated) positive += 1;
      else negative += 1;
      if (!matched.includes(base)) matched.push(base);
    }
  });
  // Remove negated duplicates from double counting when the base word repeated.
  const total = positive + negative;
  const score = total === 0 ? 0 : Number(((positive - negative) / total).toFixed(3));
  const label = score >= 0.34 ? 'positive' : score <= -0.34 ? 'negative' : 'neutral';
  return { label, score, matched: matched.slice(0, 6) };
};

export const applySentiment = (items) => (Array.isArray(items) ? items : []).map((item) => ({
  ...item,
  sentiment: item?.sentiment || scoreHeadlineSentiment(item?.headline),
}));

export const SENTIMENT_METHOD = 'Keyword lexicon on the real headline text; not a model forecast and not investment advice.';
