export const TROY_OUNCE_GRAMS = 31.1034768;

export const metalUnitPrices = (symbol, quoteUnitPrice) => {
  const price = Number(quoteUnitPrice);
  if (!(price > 0)) return { inrPerGram: null, inrPer10g: null, inrPerKg: null };
  const normalized = String(symbol || '').trim().toUpperCase();
  const inrPerGram = normalized === 'GOLD' ? price / 10 : normalized === 'SILVER' ? price / 1000 : null;
  return {
    inrPerGram: inrPerGram === null ? null : Number(inrPerGram.toFixed(4)),
    inrPer10g: inrPerGram === null ? null : Number((inrPerGram * 10).toFixed(2)),
    inrPerKg: inrPerGram === null ? null : Number((inrPerGram * 1000).toFixed(2)),
  };
};

export const convertTroyOunceUsdToInr = (usdPerTroyOunce, usdInr, grams) => {
  const usdPrice = Number(usdPerTroyOunce);
  const fxRate = Number(usdInr);
  const targetGrams = Number(grams);
  if (!(usdPrice > 0) || !(fxRate > 0) || !(targetGrams > 0)) return null;
  return Number((usdPrice * fxRate * targetGrams / TROY_OUNCE_GRAMS).toFixed(2));
};

export const parseQuoteTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const classifyExchangeQuote = ({
  timestamp,
  now = Date.now(),
  marketOpen,
  staleAfterMs = 120_000,
  futureToleranceMs = 5_000,
}) => {
  const timestampMs = parseQuoteTimestamp(timestamp);
  const hasFutureSkew = timestampMs !== null && timestampMs > now + futureToleranceMs;
  const ageMs = timestampMs === null || hasFutureSkew ? null : Math.max(0, now - timestampMs);
  const isStale = ageMs === null || ageMs > staleAfterMs;
  return {
    timestampMs,
    ageMs,
    isStale,
    isLive: marketOpen === true && !isStale,
  };
};
