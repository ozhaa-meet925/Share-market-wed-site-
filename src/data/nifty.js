// Index identity only. Prices, changes and history must come from the market
// provider via useMarketIndices; nothing numeric belongs in this file.
export const indices = [
  { symbol: 'NIFTY', name: 'NIFTY 50', contributors: ['RELIANCE', 'HDFCBANK', 'SBIN', 'INFY'] },
  { symbol: 'SENSEX', name: 'SENSEX' },
  { symbol: 'BANKNIFTY', name: 'NIFTY BANK' },
  { symbol: 'NIFTYIT', name: 'NIFTY IT' },
  { symbol: 'NIFTYMIDCAP', name: 'NIFTY MIDCAP' },
];

export const nifty = indices[0];
