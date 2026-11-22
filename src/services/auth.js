const SESSION_KEY = 'sharemarket:session';

const readSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
};

let currentUser = readSession();

const setSession = (user) => {
  currentUser = user || null;
  if (currentUser) localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  else localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('sharemarket:session-changed', { detail: currentUser }));
};

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
    const error = new Error(payload?.error || `The account service returned HTTP ${response.status}.`);
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
};

export const getCurrentUser = () => currentUser;

export const refreshSession = async () => {
  try {
    const payload = await request('/api/auth/me');
    setSession(payload?.user || null);
    return currentUser;
  } catch {
    return currentUser;
  }
};

export const requestOtp = (phone) => request('/api/auth/otp/request', {
  method: 'POST',
  body: JSON.stringify({ phone }),
});

export const verifyOtp = (phone, code) => request('/api/auth/otp/verify', {
  method: 'POST',
  body: JSON.stringify({ phone, code }),
});

export const registerAccount = async (details) => {
  const payload = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(details),
  });
  setSession(payload.user);
  return payload.user;
};

export const loginWithPin = async ({ phone, pin, verificationToken }) => {
  const payload = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, pin, verificationToken }),
  });
  setSession(payload.user);
  return payload.user;
};

export const loginWithFace = async ({ phone } = {}) => {
  const payload = await request('/api/auth/biometric/login', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
  setSession(payload.user);
  return payload.user;
};

export const logoutUser = async () => {
  try {
    await request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } finally {
    setSession(null);
  }
};

export const fetchWatchlist = () => request('/api/me/watchlist');

export const saveWatchlist = (symbols) => request('/api/me/watchlist', {
  method: 'PUT',
  body: JSON.stringify({ symbols }),
});

export const fetchSecuritySettings = () => request('/api/auth/security');

export const changeTradingPin = async ({ currentPin, newPin }) => {
  const payload = await request('/api/auth/security/pin', {
    method: 'POST',
    body: JSON.stringify({ currentPin, newPin }),
  });
  if (payload?.user) setSession(payload.user);
  return payload;
};

export const logoutAllDevices = async () => {
  try {
    await request('/api/auth/security/logout-all', { method: 'POST', body: JSON.stringify({}) });
  } finally {
    setSession(null);
  }
};

export const fetchPaperState = () => request('/api/me/paper');

export const savePaperState = (state) => request('/api/me/paper', {
  method: 'PUT',
  body: JSON.stringify({ state }),
});

// ── Active Devices & Remote Logout API ──────────────────────────────────────
export const fetchActiveDevices = () => request('/api/auth/security/devices');

export const revokeDevice = (sessionId) => request('/api/auth/security/devices/revoke', {
  method: 'POST',
  body: JSON.stringify({ sessionId }),
});

export const revokeOtherDevices = () => request('/api/auth/security/devices/revoke-others', {
  method: 'POST',
  body: JSON.stringify({}),
});

// ── Google Authenticator (TOTP 2FA) API ─────────────────────────────────────
export const setupTotp = () => request('/api/auth/security/totp/setup', {
  method: 'POST',
  body: JSON.stringify({}),
});

export const enableTotp = ({ secret, token }) => request('/api/auth/security/totp/enable', {
  method: 'POST',
  body: JSON.stringify({ secret, token }),
});

export const disableTotp = ({ pin, token }) => request('/api/auth/security/totp/disable', {
  method: 'POST',
  body: JSON.stringify({ pin, token }),
});

export const verifyTotp = (token) => request('/api/auth/security/totp/verify', {
  method: 'POST',
  body: JSON.stringify({ token }),
});
