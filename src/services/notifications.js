const parse = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (HTTP ${response.status}).`);
    error.code = payload.code || 'request_failed';
    error.status = response.status;
    throw error;
  }
  return payload;
};

const jsonRequest = (url, method, body) => fetch(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  body: JSON.stringify(body),
}).then(parse);

export const notificationsApi = {
  list: (limit = 40) => fetch(`/api/notifications?limit=${limit}`, { credentials: 'same-origin' }).then(parse),
  markRead: (ids) => jsonRequest('/api/notifications/read', 'POST', ids ? { ids } : {}),
  createPriceAlert: (alert) => jsonRequest('/api/notifications/price-alerts', 'POST', alert),
  deletePriceAlert: (id) => fetch(`/api/notifications/price-alerts/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).then(parse),
  savePreferences: (preferences) => jsonRequest('/api/notifications/preferences', 'PUT', preferences),
  savePushSubscription: (subscription) => jsonRequest('/api/notifications/push-subscriptions', 'POST', subscription),
  removePushSubscription: (endpoint) => jsonRequest('/api/notifications/push-subscriptions', 'DELETE', { endpoint }),
  testEmail: () => jsonRequest('/api/notifications/test-email', 'POST', {}),
  testPush: () => jsonRequest('/api/notifications/test-push', 'POST', {}),
};
