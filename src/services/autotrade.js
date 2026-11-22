const request = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || `The auto-trader service returned HTTP ${response.status}.`);
    error.code = payload?.code;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

const post = (url, body = {}) => request(url, { method: 'POST', body: JSON.stringify(body) });
const put = (url, body = {}) => request(url, { method: 'PUT', body: JSON.stringify(body) });

export const autoTradeApi = {
  getStatus: () => request('/api/autotrade/status'),
  saveConfig: (config) => put('/api/autotrade/config', config),
  start: (confirmation, acceptRisk) => post('/api/autotrade/start', { confirmation, acceptRisk }),
  pause: () => post('/api/autotrade/pause'),
  resume: (confirmation, acceptRisk) => post('/api/autotrade/resume', { confirmation, acceptRisk }),
  stop: (emergency = true) => post('/api/autotrade/stop', { emergency }),
  scan: () => post('/api/autotrade/scan'),
  exitPosition: (id) => post(`/api/autotrade/positions/${encodeURIComponent(id)}/exit`),
  getReadiness: (broker, probe = true) => request(`/api/autotrade/readiness?broker=${encodeURIComponent(broker)}${probe ? '&probe=1' : ''}`),
  setExecution: (mode, broker, confirmation, acceptRisk) => put('/api/autotrade/execution', { mode, broker, confirmation, acceptRisk }),
  syncBrokerOrders: () => post('/api/autotrade/sync'),
  getSignals: (symbols = []) => request(`/api/autotrade/signals${symbols.length ? `?symbols=${symbols.map(encodeURIComponent).join(',')}` : ''}`),
  runBacktest: ({ symbol, days, targetPercent, stopLossPercent, rules, rsiMax, momentumMinPercent }) => request(
    `/api/autotrade/backtest?symbol=${encodeURIComponent(symbol)}&days=${encodeURIComponent(days)}`
    + (targetPercent ? `&targetPercent=${encodeURIComponent(targetPercent)}` : '')
    + (stopLossPercent ? `&stopLossPercent=${encodeURIComponent(stopLossPercent)}` : '')
    + (rules?.length ? `&rules=${encodeURIComponent(rules.join(','))}` : '')
    + (rsiMax ? `&rsiMax=${encodeURIComponent(rsiMax)}` : '')
    + (Number.isFinite(momentumMinPercent) ? `&momentumMin=${encodeURIComponent(momentumMinPercent)}` : ''),
  ),
  explain: (symbol) => post('/api/autotrade/explain', { symbol }),
  getAudit: (limit = 100) => request(`/api/autotrade/audit?limit=${encodeURIComponent(limit)}`),
  testNotifications: () => post('/api/autotrade/notifications/test'),
  testEmail: () => post('/api/notifications/test-email'),
};
