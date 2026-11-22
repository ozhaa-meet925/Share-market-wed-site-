const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number.parseInt(process.env.API_RATE_LIMIT_PER_MIN || '900', 10) || 900;

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' https://checkout.razorpay.com https://cdn.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: ws: wss:",
  "frame-src https://checkout.razorpay.com https://api.razorpay.com",
  "media-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export const isProduction = () =>
  process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';

export const resolveTrustProxy = (raw = process.env.TRUST_PROXY) => {
  if (raw === undefined || raw === '') return 'loopback';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : raw;
};

export const securityHeaders = () => (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', CSP_DIRECTIVES);
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
};

export const createApiRateLimiter = ({
  windowMs = RATE_LIMIT_WINDOW_MS,
  max = RATE_LIMIT_MAX,
  enabled = process.env.API_RATE_LIMIT_DISABLED !== '1',
} = {}) => {
  const buckets = new Map();
  let lastSweep = Date.now();

  const sweep = (now) => {
    if (now - lastSweep < windowMs) return;
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
    lastSweep = now;
  };

  return (req, res, next) => {
    if (!enabled) return next();
    const now = Date.now();
    sweep(now);
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests from this network. Please slow down and retry shortly.',
        code: 'rate_limited',
        retryAfterSeconds: retryAfter,
      });
    }
    return next();
  };
};
