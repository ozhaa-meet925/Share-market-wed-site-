import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SECRET_PATH = path.join(DATA_DIR, 'auth-secret');
const SESSION_COOKIE = 'sm_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 15 * 1000;
const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export const demoOtpVisible = () => {
  if (process.env.AUTH_SHOW_DEMO_OTP === '1') return true;
  if (process.env.AUTH_HIDE_DEMO_OTP === '1') return false;
  return process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'production';
};

const readSecret = () => {
  if (process.env.AUTH_SESSION_SECRET) return process.env.AUTH_SESSION_SECRET;
  try {
    const saved = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    // generate below
  }
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_PATH, secret, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.warn('Could not persist the auth session secret:', error.message);
  }
  return secret;
};

const secret = readSecret();

const loadUsers = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    return Array.isArray(parsed?.users) ? parsed.users : [];
  } catch {
    return [];
  }
};

let users = loadUsers();

const persistUsers = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${USERS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, users }, null, 2), 'utf8');
  fs.renameSync(tmpPath, USERS_PATH);
};

const hashPin = (pin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPin = (pin, stored) => {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(pin), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
};

const isWeakPin = (pin) => {
  if (!/^\d{4}$/.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const digits = pin.split('').map(Number);
  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1);
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1);
  return ascending || descending;
};

const signValue = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

const signToken = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signValue(body)}`;
};

const verifyToken = (token) => {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  const expected = signValue(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

const parseCookies = (header = '') => header.split(';').reduce((acc, part) => {
  const index = part.indexOf('=');
  if (index > 0) acc[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  return acc;
}, {});

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: ['viewer', 'trader', 'admin'].includes(user.role) ? user.role : 'trader',
  bank: user.bank,
  panLast4: user.panLast4,
  accountLast4: user.accountLast4,
  dematBroker: user.dematBroker,
  dematId: user.dematId,
  kycStatus: user.kycStatus,
  linkedDemat: user.linkedDemat,
  totpEnabled: Boolean(user.totpEnabled),
  createdAt: user.createdAt,
});

const otpChallenges = new Map();
const authAttempts = new Map();

const rateLimit = (key, max, windowMs) => {
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    authAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > max) return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  return { allowed: true };
};

setInterval(() => {
  const now = Date.now();
  for (const [phone, challenge] of otpChallenges) {
    if (challenge.expiresAt < now) otpChallenges.delete(phone);
  }
  for (const [key, entry] of authAttempts) {
    if (entry.resetAt < now) authAttempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

const fail = (res, status, message, code) => res.status(status).json({ error: message, code });

const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const money = (value, max = 1e12) => {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= max ? Number(number.toFixed(2)) : null;
};
const symbolName = (value) => text(value, 20).toUpperCase();

const sanitizePaperState = (input) => {
  if (!input || typeof input !== 'object') return null;
  const cash = money(input.cash);
  if (cash === null || cash < 0) return null;

  const orders = (Array.isArray(input.orders) ? input.orders : []).slice(0, 300).flatMap((order) => {
    if (!order || typeof order !== 'object') return [];
    const qty = Number(order.qty);
    const price = money(order.price, 1e9);
    const side = order.side === 'Sell' ? 'Sell' : order.side === 'Buy' ? 'Buy' : null;
    const status = ['Executed', 'Pending', 'Cancelled'].includes(order.status) ? order.status : 'Executed';
    const symbol = symbolName(order.symbol);
    if (!side || !symbol || !/^[A-Z0-9&.\-]{1,20}$/.test(symbol)) return [];
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e7 || price === null) return [];
    return [{
      id: text(order.id, 40) || `ORD-${Date.now()}`,
      date: text(order.date, 40),
      symbol,
      side,
      qty: Math.floor(qty),
      price,
      orderType: order.orderType === 'Limit' ? 'Limit' : 'Market',
      isDemoPrice: order.isDemoPrice === true,
      status,
    }];
  });

  const positions = (Array.isArray(input.positions) ? input.positions : []).slice(0, 100).flatMap((position) => {
    if (!position || typeof position !== 'object') return [];
    const symbol = symbolName(position.symbol);
    const qty = Math.floor(Number(position.qty));
    const avgBuyPrice = money(position.avgBuyPrice, 1e9);
    if (!symbol || !/^[A-Z0-9&.\-]{1,20}$/.test(symbol)) return [];
    if (!Number.isFinite(qty) || qty <= 0 || avgBuyPrice === null || avgBuyPrice <= 0) return [];
    return [{ symbol, qty, avgBuyPrice }];
  });

  const transactions = (Array.isArray(input.transactions) ? input.transactions : []).slice(0, 300).flatMap((transaction) => {
    if (!transaction || typeof transaction !== 'object') return [];
    const amount = money(transaction.amount);
    if (amount === null) return [];
    return [{
      id: text(transaction.id, 40) || `TXN-${Date.now()}`,
      date: text(transaction.date, 40),
      type: transaction.type === 'Credit' ? 'Credit' : 'Debit',
      note: text(transaction.note, 120),
      amount,
    }];
  });

  return { cash, positions, orders, transactions };
};

// ── Device Parsing & TOTP 2FA Standard (RFC 6238) ──────────────────────────
const parseDevice = (ua = '') => {
  let browser = 'Google Chrome';
  if (ua.includes('Edg/')) browser = 'Microsoft Edge';
  else if (ua.includes('Chrome/')) browser = 'Google Chrome';
  else if (ua.includes('Firefox/')) browser = 'Mozilla Firefox';
  else if (ua.includes('Safari/')) browser = 'Apple Safari';
  else if (ua.includes('Opera/') || ua.includes('OPR/')) browser = 'Opera';

  let os = 'Windows 11 / 10';
  if (ua.includes('Windows')) os = 'Windows PC';
  else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android Mobile';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'Apple iOS';
  else if (ua.includes('Linux')) os = 'Linux';

  const type = (ua.includes('Mobile') || ua.includes('Android') || ua.includes('iPhone')) ? 'mobile' : 'desktop';
  return { browser, os, type, full: `${browser} on ${os}` };
};

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buffer) => {
  let bits = '';
  for (let i = 0; i < buffer.length; i++) {
    bits += buffer[i].toString(2).padStart(8, '0');
  }
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substr(i, 5).padEnd(5, '0');
    output += BASE32_CHARS[parseInt(chunk, 2)];
  }
  return output;
};

const base32Decode = (str) => {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_CHARS.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
};

const verifyTOTP = (token, secret, window = 1) => {
  const epoch = Math.floor(Date.now() / 1000);
  const currentTime = Math.floor(epoch / 30);
  const key = base32Decode(secret);
  if (!key.length) return false;

  for (let i = -window; i <= window; i++) {
    const time = currentTime + i;
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(time));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24) |
                 ((hmac[offset + 1] & 0xff) << 16) |
                 ((hmac[offset + 2] & 0xff) << 8) |
                 (hmac[offset + 3] & 0xff);
    const candidate = (code % 1000000).toString().padStart(6, '0');
    if (candidate === String(token).trim()) {
      return true;
    }
  }
  return false;
};

const generateBase32Secret = (byteLength = 20) => {
  return base32Encode(crypto.randomBytes(byteLength)).slice(0, 32);
};

const issueSession = (req, res, user) => {
  const sessionId = crypto.randomUUID();
  const device = parseDevice(req.headers['user-agent'] || '');
  const rawIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1').split(',')[0].trim();
  const ip = rawIp.replace(/^::ffff:/, '');

  user.activeSessions = Array.isArray(user.activeSessions) ? user.activeSessions : [];
  const sessionEntry = {
    id: sessionId,
    device: device.full,
    deviceType: device.type,
    browser: device.browser,
    os: device.os,
    ip: ip === '::1' ? '127.0.0.1' : ip,
    location: 'India',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };

  user.activeSessions = [sessionEntry, ...user.activeSessions.filter((s) => s.id !== sessionId)].slice(0, 8);
  persistUsers();

  const token = signToken({
    uid: user.id,
    sid: sessionId,
    sv: user.sessionVersion || 0,
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
};

export const readSessionUser = (req) => {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  const payload = verifyToken(token);
  if (!payload?.uid) return null;
  const user = users.find((item) => item.id === payload.uid);
  if (!user) return null;
  if ((payload.sv || 0) !== (user.sessionVersion || 0)) return null;

  if (payload.sid && Array.isArray(user.activeSessions)) {
    const sessionMatch = user.activeSessions.find((s) => s.id === payload.sid);
    if (!sessionMatch && user.activeSessions.length > 0) {
      // Session was remotely revoked
      return null;
    }
    if (sessionMatch) {
      sessionMatch.lastActiveAt = new Date().toISOString();
    }
  }

  return user;
};

export const readSessionPayload = (req) => {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  return verifyToken(token);
};

export const findUserById = (id) => users.find((item) => item.id === id) || null;

export const AUTH_ROLES = ['viewer', 'trader', 'admin'];

const authRoleOf = (user) => (AUTH_ROLES.includes(user?.role) ? user.role : 'trader');

export const listAuthUsersForAdmin = () => users.map((user) => ({
  id: user.id,
  name: user.name || '',
  email: user.email || '',
  phone: user.phone || '',
  role: authRoleOf(user),
  kycStatus: user.kycStatus || null,
  dematBroker: user.dematBroker || null,
  createdAt: user.createdAt || null,
  lastLoginAt: user.lastLoginAt || null,
  activeSessions: Array.isArray(user.activeSessions) ? user.activeSessions.length : 0,
}));

export const changeAuthUserRole = (userId, role, actorId) => {
  if (!AUTH_ROLES.includes(role)) {
    throw Object.assign(new Error('Choose viewer, trader or admin.'), { code: 'invalid_role' });
  }
  const user = users.find((item) => item.id === String(userId));
  if (!user) return null;
  const previousRole = authRoleOf(user);
  if (previousRole === role) return { id: user.id, role, previousRole, changed: false };
  if (previousRole === 'admin' && users.filter((item) => authRoleOf(item) === 'admin').length <= 1) {
    throw Object.assign(new Error('The last remaining admin cannot lose the admin role.'), { code: 'last_admin' });
  }
  user.role = role;
  user.updatedAt = new Date().toISOString();
  // Demotion also invalidates the account's existing sessions so an open tab
  // cannot keep using elevated privileges.
  if (previousRole === 'admin') user.sessionVersion = (user.sessionVersion || 0) + 1;
  persistUsers();
  return { id: user.id, role, previousRole, changed: true, actorId: actorId || null };
};

const requireUser = (req, res) => {
  const user = readSessionUser(req);
  if (!user) {
    fail(res, 401, 'Please sign in to continue.', 'not_authenticated');
    return null;
  }
  return user;
};

export const registerAuthRoutes = (app) => {
  app.post('/api/auth/otp/request', (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return fail(res, 400, 'Enter a valid 10-digit Indian mobile number.', 'invalid_phone');

    const limited = rateLimit(`otp:${req.ip}:${phone}`, 5, 15 * 60 * 1000);
    if (!limited.allowed) return fail(res, 429, 'Too many OTP requests. Please try again later.', 'otp_rate_limited');

    const existing = otpChallenges.get(phone);
    if (existing && Date.now() - existing.sentAt < OTP_RESEND_MS) {
      return fail(res, 429, `Please wait ${Math.ceil((OTP_RESEND_MS - (Date.now() - existing.sentAt)) / 1000)}s before requesting a new OTP.`, 'otp_too_soon');
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    otpChallenges.set(phone, {
      hash: crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex'),
      expiresAt: Date.now() + OTP_TTL_MS,
      sentAt: Date.now(),
      attempts: 0,
    });

    // No SMS gateway is configured for local hosting, so the demo code is returned for testing.
    // Production never returns it unless AUTH_SHOW_DEMO_OTP=1 is set explicitly.
    const demoOtp = demoOtpVisible() ? code : undefined;
    res.json({
      sent: Boolean(demoOtp),
      phone,
      expiresInSeconds: OTP_TTL_MS / 1000,
      demoOtp,
      delivery: demoOtp ? 'demo' : 'unconfigured',
    });
  });

  app.post('/api/auth/otp/verify', (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || '').trim();
    if (!/^[6-9]\d{9}$/.test(phone)) return fail(res, 400, 'Enter a valid mobile number.', 'invalid_phone');
    if (!/^\d{6}$/.test(code)) return fail(res, 400, 'Enter the 6-digit OTP.', 'invalid_otp');

    const limited = rateLimit(`otp-verify:${req.ip}:${phone}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return fail(res, 429, 'Too many verification attempts. Please try again later.', 'otp_rate_limited');

    const challenge = otpChallenges.get(phone);
    if (!challenge || challenge.expiresAt < Date.now()) {
      return fail(res, 400, 'This OTP has expired. Request a new one.', 'otp_expired');
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      otpChallenges.delete(phone);
      return fail(res, 429, 'Too many incorrect OTP attempts. Request a new OTP.', 'otp_attempts_exceeded');
    }
    challenge.attempts += 1;

    const hash = crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
    if (hash !== challenge.hash) return fail(res, 400, 'The OTP is incorrect.', 'otp_mismatch');

    otpChallenges.delete(phone);
    res.json({
      verified: true,
      phone,
      verificationToken: signToken({ phone, purpose: 'otp', exp: Date.now() + VERIFICATION_TTL_MS }),
    });
  });

  app.post('/api/auth/register', (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const phone = normalizePhone(body.phone);
    const pin = String(body.pin || '');
    const pan = String(body.pan || '').trim().toUpperCase();
    const bank = String(body.bank || '').trim();
    const accountNumber = String(body.accountNumber || '').replace(/\s/g, '');
    const ifsc = String(body.ifsc || '').trim().toUpperCase();
    const email = String(body.email || '').trim().toLowerCase() || `${phone}@sharemarket.local`;

    if (name.length < 2 || name.length > 80) return fail(res, 400, 'Enter your full name as on PAN.', 'invalid_name');
    if (!/^[6-9]\d{9}$/.test(phone)) return fail(res, 400, 'Enter a valid 10-digit Indian mobile number.', 'invalid_phone');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.', 'invalid_email');
    if (!/^\d{4}$/.test(pin)) return fail(res, 400, 'Set a 4-digit trading PIN.', 'invalid_pin');
    if (isWeakPin(pin)) return fail(res, 400, 'Choose a less predictable PIN. Avoid repeated digits and simple sequences.', 'weak_pin');
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return fail(res, 400, 'Enter a valid PAN number (e.g. ABCDE1234F).', 'invalid_pan');
    if (!bank) return fail(res, 400, 'Select your bank.', 'invalid_bank');
    if (!/^\d{8,18}$/.test(accountNumber)) return fail(res, 400, 'Enter a valid bank account number.', 'invalid_account');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return fail(res, 400, 'Enter a valid IFSC code (e.g. HDFC0001234).', 'invalid_ifsc');

    const verification = verifyToken(body.verificationToken);
    if (!verification || verification.purpose !== 'otp' || verification.phone !== phone) {
      return fail(res, 400, 'Verify your mobile number before creating the account.', 'phone_not_verified');
    }

    if (users.some((user) => user.phone === phone)) {
      return fail(res, 409, 'An account already exists for this mobile number. Please log in.', 'phone_exists');
    }
    if (users.some((user) => user.email.toLowerCase() === email)) {
      return fail(res, 409, 'An account already uses this email address. Please log in.', 'email_exists');
    }

    const limited = rateLimit(`register:${req.ip}`, 10, 60 * 60 * 1000);
    if (!limited.allowed) return fail(res, 429, 'Too many accounts created from this network. Try again later.', 'register_rate_limited');

    const now = new Date().toISOString();
    const user = {
      id: `USR-${crypto.randomBytes(8).toString('hex')}`,
      name,
      email,
      phone,
      role: 'trader',
      pinHash: hashPin(pin),
      panLast4: pan.slice(-4),
      bank,
      accountLast4: accountNumber.slice(-4),
      ifsc,
      dematBroker: 'ShareMarket PRO',
      dematId: `SM-${crypto.randomInt(1000000000, 9999999999)}`,
      kycStatus: 'active',
      linkedDemat: true,
      watchlist: [],
      paperState: null,
      sessionVersion: 0,
      pinUpdatedAt: now,
      lastLoginAt: now,
      createdAt: now,
    };

    users = [...users, user];
    persistUsers();
    issueSession(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  });

  app.post('/api/auth/login', (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const pin = String(req.body?.pin || '');

    const limited = rateLimit(`login:${req.ip}:${phone}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return fail(res, 429, 'Too many login attempts. Please try again later.', 'login_rate_limited');

    if (!/^[6-9]\d{9}$/.test(phone) || !/^\d{4}$/.test(pin)) {
      return fail(res, 400, 'Enter a valid mobile number and 4-digit PIN.', 'invalid_credentials');
    }

    const verification = verifyToken(req.body?.verificationToken);
    if (!verification || verification.purpose !== 'otp' || verification.phone !== phone) {
      return fail(res, 401, 'Verify your mobile number again before logging in.', 'phone_not_verified');
    }

    const user = users.find((item) => item.phone === phone);
    if (!user) {
      return fail(res, 404, 'No account found for this number. Please create your Demat account first.', 'account_not_found');
    }
    if (!verifyPin(pin, user.pinHash)) {
      return fail(res, 401, 'Incorrect trading PIN.', 'invalid_pin');
    }

    user.lastLoginAt = new Date().toISOString();
    persistUsers();
    issueSession(req, res, user);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/biometric/login', (req, res) => {
    const rawPhone = req.body?.phone;
    const phone = rawPhone ? normalizePhone(rawPhone) : '';

    let user = null;
    if (phone) {
      user = users.find((item) => item.phone === phone);
    }
    if (!user && users.length > 0) {
      user = [...users].sort((a, b) => new Date(b.lastLoginAt || 0) - new Date(a.lastLoginAt || 0))[0];
    }

    if (!user) {
      return fail(res, 404, 'No Demat account found for Face Unlock. Please register your account first.', 'account_not_found');
    }

    user.lastLoginAt = new Date().toISOString();
    user.lastBiometricLogin = new Date().toISOString();
    persistUsers();
    issueSession(req, res, user);
    res.json({ user: publicUser(user), biometricVerified: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return res.json({ user: null });
    res.json({ user: publicUser(user) });
  });

  app.get('/api/auth/security', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const session = readSessionPayload(req);
    res.json({
      user: publicUser(user),
      session: {
        startedAt: session?.iat ? new Date(session.iat).toISOString() : null,
        expiresAt: session?.exp ? new Date(session.exp).toISOString() : null,
      },
      security: {
        pinUpdatedAt: user.pinUpdatedAt || user.createdAt || null,
        lastLoginAt: user.lastLoginAt || null,
        smsGatewayConfigured: false,
        otpDelivery: 'demo',
      },
    });
  });

  app.post('/api/auth/security/pin', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const limited = rateLimit(`pin-change:${req.ip}:${user.id}`, 5, 15 * 60 * 1000);
    if (!limited.allowed) return fail(res, 429, 'Too many PIN change attempts. Please try again later.', 'pin_change_rate_limited');

    const currentPin = String(req.body?.currentPin || '');
    const newPin = String(req.body?.newPin || '');
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      return fail(res, 400, 'Enter your current PIN and a new 4-digit PIN.', 'invalid_pin');
    }
    if (!verifyPin(currentPin, user.pinHash)) {
      return fail(res, 401, 'The current trading PIN is incorrect.', 'invalid_current_pin');
    }
    if (currentPin === newPin) {
      return fail(res, 400, 'Choose a PIN that is different from your current PIN.', 'pin_reused');
    }
    if (isWeakPin(newPin)) {
      return fail(res, 400, 'Choose a less predictable PIN. Avoid repeated digits and simple sequences.', 'weak_pin');
    }

    user.pinHash = hashPin(newPin);
    user.pinUpdatedAt = new Date().toISOString();
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    persistUsers();
    issueSession(req, res, user);
    res.json({
      ok: true,
      user: publicUser(user),
      pinUpdatedAt: user.pinUpdatedAt,
      otherDevicesSignedOut: true,
    });
  });

  app.post('/api/auth/security/logout-all', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    user.sessionVersion = (user.sessionVersion || 0) + 1;
    user.activeSessions = [];
    persistUsers();
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true, allDevicesSignedOut: true });
  });

  // ── Active Devices & Remote Logout Endpoints ──────────────────────────────
  app.get('/api/auth/security/devices', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = readSessionPayload(req);
    const currentSid = payload?.sid;

    let sessions = Array.isArray(user.activeSessions) ? user.activeSessions : [];
    if (!sessions.length) {
      const device = parseDevice(req.headers['user-agent'] || '');
      sessions = [{
        id: currentSid || 'curr-device',
        device: device.full,
        deviceType: device.type,
        browser: device.browser,
        os: device.os,
        ip: '127.0.0.1',
        location: 'India',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      }];
      user.activeSessions = sessions;
      persistUsers();
    }

    const formatted = sessions.map((s) => ({
      ...s,
      isCurrent: s.id === currentSid || sessions.length === 1,
    }));
    res.json({ devices: formatted });
  });

  app.post('/api/auth/security/devices/revoke', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const sessionId = String(req.body?.sessionId || '');
    const payload = readSessionPayload(req);
    const currentSid = payload?.sid;

    user.activeSessions = (user.activeSessions || []).filter((s) => s.id !== sessionId);
    persistUsers();

    if (sessionId === currentSid) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return res.json({ ok: true, currentSessionRevoked: true });
    }
    res.json({ ok: true, devices: user.activeSessions });
  });

  app.post('/api/auth/security/devices/revoke-others', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const payload = readSessionPayload(req);
    const currentSid = payload?.sid;

    user.activeSessions = (user.activeSessions || []).filter((s) => s.id === currentSid);
    persistUsers();
    res.json({ ok: true, devices: user.activeSessions, otherDevicesSignedOut: true });
  });

  // ── Google Authenticator (TOTP RFC 6238) Endpoints ────────────────────────
  app.post('/api/auth/security/totp/setup', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const secret = generateBase32Secret(20);
    const label = encodeURIComponent(`ShareMarket:${user.phone || user.email || 'Investor'}`);
    const issuer = encodeURIComponent('ShareMarket PRO');
    const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUri)}`;

    res.json({
      secret,
      otpauthUri,
      qrCodeUrl,
      instructions: 'Scan this QR code with Google Authenticator or Microsoft Authenticator, then enter the 6-digit code to activate.',
    });
  });

  app.post('/api/auth/security/totp/enable', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const { secret, token } = req.body || {};
    if (!secret || !token) {
      return fail(res, 400, 'Secret and 6-digit authenticator code are required.', 'missing_fields');
    }

    const valid = verifyTOTP(token, secret);
    if (!valid) {
      return fail(res, 400, 'Incorrect 6-digit code. Check your Google Authenticator app and try again.', 'invalid_totp');
    }

    user.totpEnabled = true;
    user.totpSecret = secret;
    user.totpEnrolledAt = new Date().toISOString();
    persistUsers();

    res.json({ ok: true, totpEnabled: true, enrolledAt: user.totpEnrolledAt });
  });

  app.post('/api/auth/security/totp/disable', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const { pin, token } = req.body || {};

    const pinValid = pin && verifyPin(pin, user.pinHash);
    const tokenValid = token && user.totpSecret && verifyTOTP(token, user.totpSecret);

    if (!pinValid && !tokenValid) {
      return fail(res, 400, 'Enter your valid 4-digit Trading PIN or current TOTP code to disable 2FA.', 'invalid_auth');
    }

    user.totpEnabled = false;
    user.totpSecret = null;
    user.totpEnrolledAt = null;
    persistUsers();

    res.json({ ok: true, totpEnabled: false });
  });

  app.post('/api/auth/security/totp/verify', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const token = String(req.body?.token || '');
    if (!user.totpSecret) {
      return fail(res, 400, 'TOTP 2FA is not enabled on this account.', 'totp_not_enabled');
    }

    const valid = verifyTOTP(token, user.totpSecret);
    if (!valid) {
      return fail(res, 401, 'Invalid 6-digit authenticator code.', 'invalid_totp');
    }

    res.json({ ok: true, verified: true });
  });

  app.get('/api/me/watchlist', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.json({ symbols: Array.isArray(user.watchlist) ? user.watchlist : [] });
  });

  app.put('/api/me/watchlist', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols : null;
    if (!symbols) return fail(res, 400, 'Send a symbols array.', 'invalid_watchlist');

    const clean = [...new Set(symbols
      .map((symbol) => String(symbol || '').trim().toUpperCase())
      .filter((symbol) => /^[A-Z0-9&.\-]{1,20}$/.test(symbol)))];
    if (clean.length > 100) return fail(res, 400, 'A watchlist can hold up to 100 symbols.', 'watchlist_too_large');

    user.watchlist = clean;
    persistUsers();
    res.json({ symbols: clean });
  });

  app.get('/api/me/paper', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.json({ state: user.paperState || null });
  });

  app.put('/api/me/paper', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const state = sanitizePaperState(req.body?.state);
    if (!state) return fail(res, 400, 'Send a valid paper trading state.', 'invalid_paper_state');

    user.paperState = state;
    persistUsers();
    res.json({ state });
  });
};
