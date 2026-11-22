import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-forecast-'));
process.env.CORE_DB_PATH = path.join(tempDir, 'platform.sqlite');

const dbModule = await import('../serverDb.js');
const {
  recordForecast,
  resolveForecasts,
  listForecasts,
  forecastStats,
  registerForecastRoutes,
} = await import('../serverForecasts.js');

const db = dbModule.getDatabase();
const NOW = new Date().toISOString();
const USER_ID = 'USR-forecast-test';

db.run(
  "INSERT INTO users (id, phone, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'trader', ?, ?)",
  USER_ID, '+919000000001', 'Forecast Tester', 'forecast@example.com', NOW, NOW,
);

test.after(() => {
  dbModule.closeDatabase();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const DAY = 86400;
const startTime = 1_700_000_000;

const trendingCandles = (count) => Array.from({ length: count }, (_, index) => {
  const time = startTime + (index * DAY);
  const close = 100 + (index * 0.25) + Math.sin(index / 5);
  return {
    time,
    open: close - 0.1,
    high: close + 0.6,
    low: close - 0.7,
    close,
  };
});

test('a forecast is stored once per symbol, horizon and base bar', () => {
  const candles = trendingCandles(360);
  const first = recordForecast({ userId: USER_ID, symbol: 'reliance', candles, horizonBars: 5 });
  assert.equal(first.forecast.status, 'ok');
  assert.ok(first.record);
  assert.equal(first.created, true);
  assert.equal(first.record.symbol, 'RELIANCE');
  assert.equal(first.record.horizonBars, 5);
  assert.equal(first.record.baseBarTime, candles.at(-1).time);
  assert.ok(Math.abs(first.record.baseClose - candles.at(-1).close) < 1e-9);
  assert.ok(['bullish', 'bearish', 'neutral'].includes(first.record.direction));

  const second = recordForecast({ userId: USER_ID, symbol: 'RELIANCE', candles, horizonBars: 5 });
  assert.equal(second.created, false);
  assert.equal(second.record.id, first.record.id);
  assert.equal(listForecasts(USER_ID).filter((row) => row.symbol === 'RELIANCE').length, 1);
});

test('forecasts are withheld when history is too short to train, and nothing is stored', () => {
  const before = listForecasts(USER_ID).length;
  const result = recordForecast({ userId: USER_ID, symbol: 'TCS', candles: trendingCandles(40) });
  assert.equal(result.forecast.status, 'insufficient_history');
  assert.equal(result.record, null);
  assert.equal(listForecasts(USER_ID).length, before);
});

test('directional calls resolve to correct or incorrect, open calls stay pending', async () => {
  const baseBar = startTime + (400 * DAY);
  const insert = (id, symbol, direction, probability, horizon = 2) => db.run(
    `INSERT INTO forecast_predictions
      (id, user_id, symbol, horizon_bars, target, direction, probability, base_close, base_bar_time, model, status, created_at)
     VALUES (?, ?, ?, ?, 'test target', ?, ?, 100, ?, 'test-model', 'pending', ?)`,
    id, USER_ID, symbol, horizon, direction, probability, baseBar, NOW,
  );
  insert('FCT-test-bull', 'INFY', 'bullish', 0.7);
  insert('FCT-test-bear', 'WIPRO', 'bearish', 0.3);
  insert('FCT-test-open', 'TCS', 'bullish', 0.6, 3);

  const bars = [
    { time: baseBar, open: 100, high: 101, low: 99, close: 100 },
    { time: baseBar + DAY, open: 100, high: 103, low: 100, close: 102 },
    { time: baseBar + (2 * DAY), open: 102, high: 106, low: 102, close: 105 },
  ];
  const summary = await resolveForecasts({
    userId: USER_ID,
    getDailyCandles: async () => bars,
  });
  assert.ok(summary.checked >= 3);
  assert.equal(summary.resolved, 2);

  const byId = Object.fromEntries(listForecasts(USER_ID, 100).map((row) => [row.id, row]));
  assert.equal(byId['FCT-test-bull'].status, 'correct');
  assert.equal(byId['FCT-test-bull'].resolvedClose, 105);
  assert.equal(byId['FCT-test-bull'].resolvedBarTime, baseBar + (2 * DAY));
  assert.equal(byId['FCT-test-bear'].status, 'incorrect');
  assert.equal(byId['FCT-test-open'].status, 'pending');

  const again = await resolveForecasts({ userId: USER_ID, getDailyCandles: async () => bars });
  assert.equal(again.resolved, 0, 'already-scored calls must not be rewritten');
});

test('stats count only scored directional calls and report a real Brier score', () => {
  db.run(
    `INSERT INTO forecast_predictions
      (id, user_id, symbol, horizon_bars, target, direction, probability, base_close, base_bar_time, model, status, created_at)
     VALUES ('FCT-test-neutral', ?, 'INFY', 2, 'test target', 'neutral', 0.5, 100, ?, 'test-model', 'unscorable', ?)`,
    USER_ID, startTime + (500 * DAY), NOW,
  );
  const stats = forecastStats(USER_ID);
  const rows = listForecasts(USER_ID, 100);
  const resolvedRows = rows.filter((row) => ['correct', 'incorrect'].includes(row.status));
  assert.equal(stats.scored, resolvedRows.length);
  assert.equal(stats.correct, 1);
  assert.equal(stats.incorrect, 1);
  assert.equal(stats.hitRatePercent, 50);
  assert.equal(stats.unscorable, rows.filter((row) => row.status === 'unscorable').length);
  assert.ok(stats.unscorable >= 1);
  assert.equal(stats.brierScore, 0.29);
  assert.match(stats.note, /only directional forecasts/i);
});

const makeApp = () => {
  const routes = [];
  return {
    routes,
    get: (routePath, handler) => routes.push({ method: 'GET', path: routePath, handler }),
    post: (routePath, handler) => routes.push({ method: 'POST', path: routePath, handler }),
  };
};

const resDouble = () => {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = (key, value) => { res.headers[key] = value; return res; };
  return res;
};

test('forecast routes are registered and reject anonymous callers', async () => {
  const app = makeApp();
  registerForecastRoutes(app, { readUser: () => null, getDailyCandles: async () => [] });
  const keys = app.routes.map((route) => `${route.method} ${route.path}`).sort();
  assert.deepEqual(keys, ['GET /api/forecasts', 'POST /api/forecasts']);
  for (const route of app.routes) {
    const res = resDouble();
    await route.handler({ body: { symbol: 'INFY' }, query: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'not_authenticated');
  }
});

test('posting a forecast with too little history returns 422 and posting a full history stores it', async () => {
  const app = makeApp();
  let candles = trendingCandles(40);
  registerForecastRoutes(app, {
    readUser: () => ({ id: USER_ID, role: 'trader' }),
    getDailyCandles: async () => candles,
  });
  const handler = app.routes.find((route) => route.method === 'POST').handler;

  const shortRes = resDouble();
  await handler({ body: { symbol: 'SBIN' }, query: {} }, shortRes);
  assert.equal(shortRes.statusCode, 422);
  assert.equal(shortRes.body.code, 'insufficient_history');
  assert.equal(shortRes.body.record, undefined);

  candles = trendingCandles(360);
  const okRes = resDouble();
  await handler({ body: { symbol: 'SBIN', horizonBars: 5 }, query: {} }, okRes);
  assert.equal(okRes.statusCode, 201);
  assert.equal(okRes.body.created, true);
  assert.equal(okRes.body.record.symbol, 'SBIN');
  assert.ok(okRes.body.stats.total >= 1);

  const invalidRes = resDouble();
  await handler({ body: { symbol: 'SBIN', horizonBars: 0 }, query: {} }, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.code, 'invalid_horizon');
});
