export const metals = [
  {
    symbol: 'GOLD',
    exchange: 'MCX',
    name: 'Gold',
    sector: 'Precious Metals',
    apiSymbol: 'MCX:GOLD',
    quoteUnit: '10g',
    quantityUnit: 'g',
    unitsPerQuoteUnit: 10,
    route: '/gold',
    tone: 'gold',
    description: '24K gold priced in rupees per 10 grams.',
  },
  {
    symbol: 'SILVER',
    exchange: 'MCX',
    name: 'Silver',
    sector: 'Precious Metals',
    apiSymbol: 'MCX:SILVER',
    quoteUnit: 'kg',
    quantityUnit: 'g',
    unitsPerQuoteUnit: 1000,
    route: '/silver',
    tone: 'silver',
    description: 'Silver priced in rupees per kilogram.',
  },
];

export const isLiveMetalQuote = (quote) => quote?.liveFeed === 'upstox'
  && quote?.isLive === true
  && quote?.isStale !== true;

export const isBenchmarkMetalQuote = (quote) => quote?.marketType === 'benchmark';

export const metalQuoteSourceLabel = (quote) => {
  if (!quote) return 'Quote unavailable';
  if (quote.liveFeed === 'upstox') {
    if (quote.isStale === true) return 'Upstox MCX · stale';
    return quote.isLive === true ? 'Live Upstox MCX' : 'Upstox MCX · delayed';
  }
  if (isBenchmarkMetalQuote(quote)) {
    return quote.isStale === true ? 'Yahoo Finance · stale' : 'Yahoo Finance COMEX';
  }
  if (quote.isStale === true) return 'Delayed spot · stale';
  if (quote.isDelayed === true || quote.isResearch === true) return 'Delayed spot';
  return 'Published quote';
};

export const metalBySymbol = new Map(metals.map((metal) => [metal.symbol, metal]));

export const metalCatalogStocks = metals.map((metal) => ({
  symbol: metal.symbol,
  exchange: metal.exchange,
  name: metal.name,
  sector: metal.sector,
  unit: metal.quoteUnit,
  route: metal.route,
  assetType: 'metal',
}));

export const isMetalSymbol = (symbol) => metalBySymbol.has(
  String(symbol || '').replace(/^MCX:/i, '').trim().toUpperCase(),
);

export const metalPricePerGram = (metal, quoteUnitPrice) => {
  const price = Number(quoteUnitPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  return Number((price / metal.unitsPerQuoteUnit).toFixed(2));
};

export const unsupportedMetalContracts = [
  { name: 'Gold Mini', symbol: 'GOLDM', reason: 'Only Gold and Silver front-month quotes are wired in this app.' },
  { name: 'Gold Petal', symbol: 'GOLDPETAL', reason: 'Only Gold and Silver front-month quotes are wired in this app.' },
  { name: 'Silver Mini', symbol: 'SILVERM', reason: 'Only Gold and Silver front-month quotes are wired in this app.' },
  { name: 'Silver Micro', symbol: 'SILVERMIC', reason: 'Only Gold and Silver front-month quotes are wired in this app.' },
];
