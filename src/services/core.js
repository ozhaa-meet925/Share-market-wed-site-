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
    const error = new Error(payload?.error || `The AI Core service returned HTTP ${response.status}.`);
    error.code = payload?.code;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

const post = (url, body = {}) => request(url, { method: 'POST', body: JSON.stringify(body) });

export const coreApi = {
  overview: () => request('/api/core/overview'),
  evaluate: (symbol, preflight = false) => post('/api/core/brain/evaluate', { symbol, preflight }),
  evaluateWatchlist: (symbols = null, preflight = false) => post('/api/core/brain/watchlist', {
    ...(symbols ? { symbols } : {}),
    preflight,
    limit: 8,
  }),
  brainStatus: () => request('/api/core/brain/status'),
  riskStatus: () => request('/api/core/risk/status'),
  preflight: (symbol) => post('/api/core/risk/preflight', { symbol }),
  setKillSwitch: (active, reason) => post('/api/core/risk/kill-switch', { active, reason }),
  recovery: () => request('/api/core/recovery'),
  reconcile: () => post('/api/core/recovery/reconcile'),
  acknowledgeRecoveryAlert: (id) => post(`/api/core/recovery/alerts/${encodeURIComponent(id)}/ack`),
  performance: (costBps = 12) => request(`/api/core/performance?costBps=${encodeURIComponent(costBps)}`),
  walkForward: ({ symbols = null, days = 500, costBps = 12 } = {}) => post('/api/core/performance/walk-forward', {
    ...(symbols ? { symbols } : {}),
    days,
    costBps,
  }),
  health: () => request('/api/core/health'),
  incidents: (limit = 30) => request(`/api/core/incidents?limit=${encodeURIComponent(limit)}`),
  acknowledgeIncident: (id) => post(`/api/core/incidents/${encodeURIComponent(id)}/ack`),
  audit: (limit = 25) => request(`/api/core/audit?limit=${encodeURIComponent(limit)}`),
  verifyAudit: () => request('/api/core/audit/verify'),
  events: (limit = 30) => request(`/api/core/events?limit=${encodeURIComponent(limit)}`),
  reportClientError: (payload) => post('/api/core/client-error', payload),
  streamUrl: '/api/core/stream',
};
