import { stocks } from '../data/stocks';
import { nifty, indices } from '../data/nifty';

const wait = (value) =>
  new Promise((resolve) => {
    window.setTimeout(() => resolve(value), 120);
  });

const requestJson = async (url) => {
  const response = await fetch(url);
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    const htmlResponse = responseText.trimStart().startsWith('<')
      || response.headers.get('content-type')?.includes('text/html');
    const error = new Error(htmlResponse
      ? 'The API proxy returned the website HTML instead of JSON. Start the app with `npm run dev` so the frontend and market API use the same ports.'
      : `The API returned an invalid response (HTTP ${response.status}).`);
    error.code = htmlResponse ? 'api_returned_html' : 'api_invalid_response';
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || 'Market data request failed');
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
};

export const marketApi = {
  getStocks: () => wait(stocks),
  getStock: (symbol) => wait(stocks.find((stock) => stock.symbol === symbol)),
  getIndices: () => wait(indices),
  getNifty: () => wait(nifty),
  getIpos: () => requestJson('/api/ipos'),
  getCalendar: (kind, from, to, forceRefresh = false) => requestJson(
    `/api/calendar?kind=${encodeURIComponent(kind)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${forceRefresh ? '&refresh=1' : ''}`,
  ),
  getIpoDetails: (ipoIdOrCompany) => requestJson(`/api/ipo/${encodeURIComponent(ipoIdOrCompany)}`),
  applyIpo: (company, lots = 1, upiId = '') => fetch('/api/ipo/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company, lots, upiId }),
  }).then((r) => r.json()),
  getGoldRates: async () => {
    try {
      const payload = await requestJson('/api/stock/batch?symbols=MCX%3AGOLD');
      return payload?.quotes?.GOLD ? [payload.quotes.GOLD] : [];
    } catch {
      return [];
    }
  },
  getSilverRates: async () => {
    try {
      const payload = await requestJson('/api/stock/batch?symbols=MCX%3ASILVER');
      return payload?.quotes?.SILVER ? [payload.quotes.SILVER] : [];
    } catch {
      return [];
    }
  },
  getMarketNews: () => requestJson('/api/news/market?category=general'),
  getHealth: () => requestJson('/api/health'),
  getStockCatalog: () => requestJson('/api/stocks/list?exchange=NSE'),
  getLiveQuote: (symbol) => requestJson(`/api/stock/quote?symbol=${encodeURIComponent(symbol)}`),
  getStockQuote: (symbol) => requestJson(`/api/stock/quote?symbol=${encodeURIComponent(symbol)}`),
  getMarketDepth: (symbol) => requestJson(`/api/market/depth?symbol=${encodeURIComponent(symbol)}`),
  getRecentTrades: (symbol) => requestJson(`/api/market/tape?symbol=${encodeURIComponent(symbol)}`),
  getCandles: (symbol, from, to, resolution = 'D') => requestJson(
    `/api/stock/history?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&resolution=${resolution}`,
  ),
  getBatchQuotes: (symbols) => requestJson(`/api/stock/batch?symbols=${symbols.map(encodeURIComponent).join(',')}`),
  getProviderInfo: () => requestJson('/api/provider'),
  askAICopilot: (message, context = {}) => fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context }),
  }).then((r) => r.json()),
  getAIStockAnalysis: (symbol) => requestJson(`/api/ai/analyze-stock?symbol=${encodeURIComponent(symbol)}`),
};
