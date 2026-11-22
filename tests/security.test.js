import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApiRateLimiter,
  resolveTrustProxy,
  securityHeaders,
} from '../serverSecurity.js';
import { demoOtpVisible } from '../serverAuth.js';

const makeResponse = () => {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader: (name, value) => { headers[name] = value; },
    getHeader: (name) => headers[name],
    headers,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
};

test('security headers include CSP, clickjacking and MIME protections', () => {
  const res = makeResponse();
  let called = false;
  securityHeaders()({ method: 'GET', path: '/api/stocks', headers: {} }, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'SAMEORIGIN');
  assert.equal(res.headers['X-Permitted-Cross-Domain-Policies'], 'none');
  const csp = res.headers['Content-Security-Policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /script-src 'self' https:\/\/checkout\.razorpay\.com/);
  assert.match(csp, /img-src[^;]*https:/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Strict-Transport-Security'], undefined);
});

test('API responses are no-store while static files keep their own caching', () => {
  const apiRes = makeResponse();
  securityHeaders()({ method: 'GET', path: '/api/health', headers: {} }, apiRes, () => {});
  assert.equal(apiRes.headers['Cache-Control'], 'no-store');
  const pageRes = makeResponse();
  securityHeaders()({ method: 'GET', path: '/', headers: {} }, pageRes, () => {});
  assert.equal(pageRes.headers['Cache-Control'], undefined);
});

test('HSTS is only sent for secure requests', () => {
  const httpsRes = makeResponse();
  securityHeaders()({ method: 'GET', path: '/api/health', headers: { 'x-forwarded-proto': 'https' } }, httpsRes, () => {});
  assert.match(httpsRes.headers['Strict-Transport-Security'], /max-age=31536000/);
});

test('trust proxy defaults to loopback and accepts explicit values', () => {
  assert.equal(resolveTrustProxy(undefined), 'loopback');
  assert.equal(resolveTrustProxy(''), 'loopback');
  assert.equal(resolveTrustProxy('true'), true);
  assert.equal(resolveTrustProxy('false'), false);
  assert.equal(resolveTrustProxy('2'), 2);
  assert.equal(resolveTrustProxy('loopback'), 'loopback');
});

test('API rate limiter allows the configured burst and then blocks with Retry-After', () => {
  const limiter = createApiRateLimiter({ max: 3, windowMs: 60_000, enabled: true });
  const req = { ip: '203.0.113.9', socket: {} };
  for (let i = 0; i < 3; i += 1) {
    const res = makeResponse();
    let called = false;
    limiter(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(res.headers['RateLimit-Remaining'], String(2 - i));
  }
  const blocked = makeResponse();
  let called = false;
  limiter(req, blocked, () => { called = true; });
  assert.equal(called, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, 'rate_limited');
  assert.ok(Number(blocked.headers['Retry-After']) >= 1);
  const otherClient = makeResponse();
  let otherCalled = false;
  limiter({ ip: '198.51.100.4', socket: {} }, otherClient, () => { otherCalled = true; });
  assert.equal(otherCalled, true);
});

test('API rate limiter window resets after the configured period', async () => {
  const limiter = createApiRateLimiter({ max: 1, windowMs: 40, enabled: true });
  const req = { ip: '192.0.2.7', socket: {} };
  limiter(req, makeResponse(), () => {});
  const blocked = makeResponse();
  limiter(req, blocked, () => {});
  assert.equal(blocked.statusCode, 429);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const allowed = makeResponse();
  let called = false;
  limiter(req, allowed, () => { called = true; });
  assert.equal(called, true);
});

test('demo OTP is hidden in production and requires an explicit override', () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    AUTH_SHOW_DEMO_OTP: process.env.AUTH_SHOW_DEMO_OTP,
    AUTH_HIDE_DEMO_OTP: process.env.AUTH_HIDE_DEMO_OTP,
  };
  try {
    delete process.env.AUTH_SHOW_DEMO_OTP;
    delete process.env.AUTH_HIDE_DEMO_OTP;
    delete process.env.APP_ENV;
    delete process.env.NODE_ENV;
    assert.equal(demoOtpVisible(), true);

    process.env.NODE_ENV = 'production';
    assert.equal(demoOtpVisible(), false);

    process.env.AUTH_SHOW_DEMO_OTP = '1';
    assert.equal(demoOtpVisible(), true);

    delete process.env.AUTH_SHOW_DEMO_OTP;
    process.env.AUTH_HIDE_DEMO_OTP = '1';
    delete process.env.NODE_ENV;
    assert.equal(demoOtpVisible(), false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
