const parse = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `Request failed (HTTP ${response.status}).`);
    error.code = payload.code || 'request_failed';
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

const get = (path) => fetch(path, { credentials: 'same-origin' }).then(parse);
const post = (path, body) => fetch(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  body: JSON.stringify(body || {}),
}).then(parse);

export const brokersApi = {
  list: () => get('/api/brokers'),
  loginUrl: (broker) => get(`/api/brokers/${broker}/login-url`),
  probe: (broker) => post(`/api/brokers/${broker}/probe`),
  disconnect: (broker) => post(`/api/brokers/${broker}/disconnect`),
  setLiveConsent: (broker, enabled, confirmation) => post(`/api/brokers/${broker}/live-consent`, { enabled, confirmation }),
  account: (broker) => get(`/api/brokers/${broker}/account`),
  portfolio: (broker) => get(`/api/brokers/${broker}/portfolio`),
  orders: (broker) => get(`/api/brokers/${broker}/orders`),
  quotes: (broker, instruments) => get(`/api/brokers/${broker}/quotes?instruments=${encodeURIComponent(instruments)}`),
  placeOrder: (broker, order) => post(`/api/brokers/${broker}/orders`, order),
  modifyOrder: (broker, orderId, patch) => post(`/api/brokers/${broker}/orders/${encodeURIComponent(orderId)}/modify`, patch),
  cancelOrder: (broker, orderId, variety) => post(`/api/brokers/${broker}/orders/${encodeURIComponent(orderId)}/cancel`, { variety }),
};
