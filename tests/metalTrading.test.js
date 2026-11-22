import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-metals-'));
process.env.CORE_DATA_DIR = tempDir;
process.env.CORE_DB_PATH = path.join(tempDir, 'platform.sqlite');

const dbModule = await import('../serverDb.js');
const { estimateMetalCharges } = await import('../metalCharges.js');
const { registerMetalTradingRoutes, startMetalPaperOrderMatcher } = await import('../serverMetalTrading.js');

const db = dbModule.getDatabase();
const user = { id: 'USR-METALS', phone: '9000000077', name: 'Metals Test', role: 'trader', kycStatus: 'active' };
let quotePrice = 1_000;
const getQuote = async (symbol) => ({
  symbol,
  isReal: true,
  isDemo: false,
  isStale: false,
  inrPerGram: quotePrice,
  provider: 'verified-test-provider',
  priceTimestamp: new Date().toISOString(),
});

const routes = new Map();
const app = {
  get: (route, handler) => routes.set(`GET ${route}`, handler),
  post: (route, handler) => routes.set(`POST ${route}`, handler),
  delete: (route, handler) => routes.set(`DELETE ${route}`, handler),
};
registerMetalTradingRoutes(app, { getQuote, authenticate: (req) => req.user || null });

const invoke = async (key, req = {}) => {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await routes.get(key)({ body: {}, params: {}, ...req }, response);
  return response;
};

const orderRequest = (overrides = {}) => ({
  user,
  body: {
    mode: 'paper',
    symbol: 'GOLD',
    side: 'BUY',
    orderType: 'MARKET',
    quantityGrams: 10,
    idempotencyKey: 'metal-test-market-buy',
    ...overrides,
  },
});

let stopMatcher = null;
test.after(() => {
  stopMatcher?.();
  dbModule.closeDatabase();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('metal charges are deterministic and side-specific', () => {
  const buy = estimateMetalCharges({ side: 'BUY', turnover: 100_000 });
  const sell = estimateMetalCharges({ side: 'SELL', turnover: 100_000 });
  assert.deepEqual(buy, {
    brokerage: 20,
    exchangeTransaction: 2.1,
    sebi: 0.1,
    ctt: 0,
    stampDuty: 2,
    gst: 3.98,
    total: 28.18,
    estimateOnly: true,
  });
  assert.equal(sell.stampDuty, 0);
  assert.equal(sell.ctt, 10);
  assert.equal(sell.total, 36.18);
  assert.equal(estimateMetalCharges({ side: 'BUY', turnover: 0 }), null);
});

test('metal trading migration creates constrained account, holding and order tables', () => {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name);
  assert.ok(tables.includes('metal_paper_accounts'));
  assert.ok(tables.includes('metal_paper_holdings'));
  assert.ok(tables.includes('metal_paper_orders'));
  assert.throws(() => {
    db.run(
      `INSERT INTO metal_paper_orders (id, user_id, idempotency_key, symbol, side, order_type, quantity_grams, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'BAD-METAL-ORDER', 'MISSING', 'bad-metal-order', 'COPPER', 'BUY', 'MARKET', 1, 'PENDING', new Date().toISOString(), new Date().toISOString(),
    );
  }, /(CHECK|FOREIGN KEY)/i);
});

test('metal paper routes require authentication and reject live execution', async () => {
  const state = await invoke('GET /api/metals/paper');
  assert.equal(state.statusCode, 401);
  assert.equal(state.payload.code, 'not_authenticated');

  const live = await invoke('POST /api/metals/paper/orders', orderRequest({ mode: 'live', idempotencyKey: 'metal-test-live-order' }));
  assert.equal(live.statusCode, 409);
  assert.equal(live.payload.code, 'metal_live_execution_unavailable');
});

test('market buy fills transactionally and an idempotent retry does not duplicate it', async () => {
  const placed = await invoke('POST /api/metals/paper/orders', orderRequest());
  assert.equal(placed.statusCode, 201);
  assert.equal(placed.payload.order.status, 'FILLED');
  assert.equal(placed.payload.order.executionPricePerGram, 1_000);
  assert.equal(placed.payload.holdings.find((item) => item.symbol === 'GOLD').quantityGrams, 10);
  assert.equal(placed.payload.orders.length, 1);
  assert.ok(placed.payload.account.cash < 990_000);

  const retried = await invoke('POST /api/metals/paper/orders', orderRequest());
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.payload.order.id, placed.payload.order.id);
  assert.equal(retried.payload.orders.length, 1);
});

test('limit buy reserves cash and cancellation releases it', async () => {
  const pending = await invoke('POST /api/metals/paper/orders', orderRequest({
    orderType: 'LIMIT',
    quantityGrams: 5,
    limitPricePerGram: 900,
    idempotencyKey: 'metal-test-limit-cancel',
  }));
  assert.equal(pending.statusCode, 201);
  assert.equal(pending.payload.order.status, 'PENDING');
  assert.ok(pending.payload.account.reservedCash > 4_500);

  const cancelled = await invoke('DELETE /api/metals/paper/orders/:id', {
    user,
    params: { id: pending.payload.order.id },
  });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.payload.account.reservedCash, 0);
  assert.equal(cancelled.payload.orders.find((item) => item.id === pending.payload.order.id).status, 'CANCELLED');
});

test('limit sell reserves holdings and matcher fills only at a verified matching quote', async () => {
  const pending = await invoke('POST /api/metals/paper/orders', orderRequest({
    side: 'SELL',
    orderType: 'LIMIT',
    quantityGrams: 4,
    limitPricePerGram: 1_100,
    idempotencyKey: 'metal-test-limit-match',
  }));
  assert.equal(pending.statusCode, 201);
  assert.equal(pending.payload.order.status, 'PENDING');
  assert.equal(pending.payload.holdings.find((item) => item.symbol === 'GOLD').reservedGrams, 4);

  quotePrice = 1_200;
  stopMatcher = startMetalPaperOrderMatcher({ getQuote, intervalMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  stopMatcher();
  stopMatcher = null;

  const state = await invoke('GET /api/metals/paper', { user });
  const filled = state.payload.orders.find((item) => item.id === pending.payload.order.id);
  const holding = state.payload.holdings.find((item) => item.symbol === 'GOLD');
  assert.equal(filled.status, 'FILLED');
  assert.equal(filled.executionPricePerGram, 1_200);
  assert.equal(holding.quantityGrams, 6);
  assert.equal(holding.reservedGrams, 0);
  assert.ok(holding.realizedPnl > 0);
});
