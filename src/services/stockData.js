// src/services/stockData.js
// Simple helper to fetch static stock price JSON placed in the public folder.
// The JSON file is bundled into the build via the `public/data/` directory.
export async function fetchStockData() {
  const response = await fetch('/data/stock_prices.json');
  if (!response.ok) throw new Error('Failed to load stock data');
  const raw = await response.json();
  // Convert the object map into an array for easier rendering.
  return Object.entries(raw).map(([symbol, info]) => ({
    symbol,
    name: info.name,
    currentPrice: info.currentPrice,
    previousClose: info.previousClose,
    open: info.open,
    high: info.high,
    low: info.low,
    volume: info.volume,
    lastUpdate: new Date(info.lastUpdate).toLocaleString(),
  }));
}
