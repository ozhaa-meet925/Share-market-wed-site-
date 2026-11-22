const parse = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (HTTP ${response.status}).`);
    error.code = payload.code || 'request_failed';
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

export const forecastsApi = {
  list: (limit = 50) => fetch(`/api/forecasts?limit=${limit}`, { credentials: 'same-origin' }).then(parse),
  save: (symbol, horizonBars = 5) => fetch('/api/forecasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ symbol, horizonBars }),
  }).then(parse),
};
