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

export const adminApi = {
  overview: () => fetch('/api/admin/overview', { credentials: 'same-origin' }).then(parse),
  audit: (limit = 50) => fetch(`/api/admin/audit?limit=${limit}`, { credentials: 'same-origin' }).then(parse),
  updateRole: (userId, role) => fetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ role }),
  }).then(parse),
};
