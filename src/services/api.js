const inFlightJsonRequests = new Map();

const performJsonRequest = async (url, options) => {
    const response = await fetch(url, options);
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

const requestJson = (url, options = {}) => {
  if (options.method && options.method !== 'GET') return performJsonRequest(url, options);
  if (inFlightJsonRequests.has(url)) return inFlightJsonRequests.get(url);

  const request = performJsonRequest(url, options).finally(() => {
    if (inFlightJsonRequests.get(url) === request) inFlightJsonRequests.delete(url);
  });

  inFlightJsonRequests.set(url, request);
  return request;
};

export const marketApi = {
  getIpos: () => requestJson('/api/ipos'),
  getIpoAuthStatus: () => requestJson('/api/ipo/auth/status'),
  connectIpoBroker: (returnTo = '/ipo') => {
    const destination = `/api/ipo/auth/connect?return_to=${encodeURIComponent(returnTo)}`;
    window.location.assign(destination);
  },
  disconnectIpoBroker: () => requestJson('/api/ipo/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }),
  getIpoOrders: () => requestJson('/api/ipo/orders'),
  getCalendar: (kind, from, to, forceRefresh = false) => requestJson(
    `/api/calendar?kind=${encodeURIComponent(kind)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${forceRefresh ? '&refresh=1' : ''}`,
  ),
  getMarketStatus: () => requestJson('/api/market/status'),
  getMarketSchedule: () => requestJson('/api/market/schedule'),
  getMarketHolidays: (year) => requestJson(`/api/market/holidays${year ? `?year=${year}` : ''}`),
  getSpecialSessions: () => requestJson('/api/market/special-sessions'),
  addSpecialSession: (session) => requestJson('/api/market/special-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  }),
  deleteSpecialSession: (date) => requestJson(`/api/market/special-sessions/${encodeURIComponent(date)}`, {
    method: 'DELETE',
  }),
  syncMarketCalendar: () => requestJson('/api/market/sync-calendar', { method: 'POST' }),
  getIpoDetails: (ipoIdOrCompany) => requestJson(`/api/ipo/${encodeURIComponent(ipoIdOrCompany)}`),
  applyIpo: (application) => requestJson('/api/ipo/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(application),
  }),
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
  getMetalsOverview: () => requestJson('/api/metals/overview'),
  getMetalInsight: (symbol) => requestJson(`/api/metals/insight?symbol=${encodeURIComponent(symbol)}`),
  getMetalPaperState: () => requestJson('/api/metals/paper'),
  placeMetalPaperOrder: (order) => requestJson('/api/metals/paper/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  }),
  cancelMetalPaperOrder: (orderId) => requestJson(`/api/metals/paper/orders/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
  }),
  getMarketNews: () => requestJson('/api/news/market?category=general'),
  getMutualFundNews: () => requestJson('/api/news/mutual-funds'),
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
  subscribeStockQuotes: (symbols, onQuote, onStatus, onError) => {
    const source = new EventSource(`/api/stock/stream?symbols=${symbols.map(encodeURIComponent).join(',')}`);
    source.addEventListener('quote', (event) => {
      try {
        onQuote?.(JSON.parse(event.data));
      } catch {
        onError?.(new Error('The market stream returned an invalid quote message.'));
      }
    });
    source.addEventListener('status', (event) => {
      try {
        onStatus?.(JSON.parse(event.data));
      } catch {
        onError?.(new Error('The market stream returned an invalid status message.'));
      }
    });
    source.addEventListener('provider_error', (event) => {
      try {
        const payload = JSON.parse(event.data);
        onError?.(new Error(payload.error || 'The market provider stream is unavailable.'));
      } catch {
        onError?.(new Error('The market provider stream is unavailable.'));
      }
    });
    source.onerror = () => onError?.(new Error('The market provider stream disconnected.'));
    return () => source.close();
  },
  getMutualFundSchemes: (limit = 12, offset = 0) => requestJson(
    `/api/mutual-funds/schemes?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
  ),
  searchMutualFunds: (query) => requestJson(`/api/mutual-funds/search?q=${encodeURIComponent(query)}`),
  getMutualFundHistory: (schemeCode, startDate) => requestJson(
    `/api/mutual-funds/${encodeURIComponent(schemeCode)}/nav${startDate ? `?startDate=${encodeURIComponent(startDate)}` : ''}`,
  ),
  getMutualFundLatest: (schemeCode, forceRefresh = false) => requestJson(`/api/mutual-funds/${encodeURIComponent(schemeCode)}/latest${forceRefresh ? '?refresh=1' : ''}`),
  askAICopilot: (message, context = {}, history = []) => requestJson('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context, history }),
  }),
  getAIStatus: () => requestJson('/api/ai/status'),
  getAIStockAnalysis: (symbol, exchange = 'NSE') => requestJson(
    `/api/ai/analyze-stock?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`,
  ),
};
