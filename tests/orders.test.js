import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-orders-'));
process.env.CORE_DATA_DIR = tempDir;
process.env.CORE_DB_PATH = path.join(tempDir, 'platform.sqlite');
process.env.BROKER_TOKEN_KEY = 'test-broker-token-key-with-more-than-32-characters';
delete process.env.LIVE_TRADING_ENABLED;

const dbModule = await import('../serverDb.js');
const risk = await import('../serverRiskShield.js');
const notifications = await import('../serverNotifications.js');
const reconcile = await import('../serverBrokerReconcile.js');
const brokerStore = await import('../serverBrokerStore.js');
const brokerRoutes = await import('../serverBrokerRoutes.js');
const brokerIndex = await import('../serverBrokers/index.js');
const email = await import('../serverEmail.js');

const db = dbModule.openDatabase({ file: process.env.CORE_DB_PATH });
const now = new Date().toISOString();

const user = { id: 'USR-ORDERS', phone: '9000000011', name: 'Order Test', role: 'trader', kycStatus: 'active' };
brokerStore.syncUser(user);

test.after(() => {
  dbModule.closeDatabase();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('live risk shield approves a clean order and blocks unsafe ones', () => {
  const base = {
    userId: 'USR-LIVE',
    broker: 'upstox',
    symbol: 'RELIANCE',
    side: 'BUY',
    quantity: 10,
    price: 100,
    marketOpen: true,
    brokerFunds: { availableCash: 5000 },
    riskSettings: { maxInvestmentPerTrade: 2000, maxDailyTrades: 5 },
    todayLiveOrders: 1,
  };

  const clean = risk.authorizeLiveOrder(base);
  assert.equal(clean.allowed, true);
  assert.equal(clean.source, 'live');
  assert.equal(clean.value, 1000);
  assert.ok(clean.checks.every((check) => check.status !== 'fail'));

  risk.setKillSwitch({ userId: 'USR-LIVE', active: true, reason: 'Emergency stop test', actor: { id: 'tester' } });
  assert.equal(risk.authorizeLiveOrder(base).allowed, false, 'kill switch must block live orders');
  risk.setKillSwitch({ userId: 'USR-LIVE', active: false, reason: '', actor: { id: 'tester' } });

  assert.equal(risk.authorizeLiveOrder({ ...base, marketOpen: false }).allowed, false, 'closed session must block');
  assert.equal(risk.authorizeLiveOrder({ ...base, price: 0 }).allowed, false, 'missing verified price must block');
  assert.equal(risk.authorizeLiveOrder({ ...base, riskSettings: { maxInvestmentPerTrade: 500 } }).allowed, false, 'per-trade cap must block');
  assert.equal(risk.authorizeLiveOrder({ ...base, duplicateSymbol: true }).allowed, false, 'duplicate live entry must block');
  assert.equal(risk.authorizeLiveOrder({ ...base, brokerFunds: { availableCash: 100 } }).allowed, false, 'insufficient broker cash must block');
  assert.equal(risk.authorizeLiveOrder({ ...base, todayLiveOrders: 5 }).allowed, false, 'daily trade cap must block');
});

test('risk shield decisions are persisted for live orders', () => {
  const status = risk.shieldStatus('USR-LIVE');
  assert.ok(status.recentDecisions.some((decision) => decision.source === 'live'));
  assert.ok(status.recentDecisions.some((decision) => decision.source === 'live' && decision.allowed === false));
});

test('notifications are stored, listed and counted as unread', () => {
  const record = notifications.notify({
    userId: 'USR-LIVE',
    category: 'order',
    title: 'Order filled',
    body: 'RELIANCE BUY 10 filled at ₹100',
    level: 'success',
  });
  assert.ok(record?.id);
  const feed = notifications.listNotifications('USR-LIVE');
  assert.equal(feed.items[0].id, record.id);
  assert.ok(feed.unread >= 1);
  assert.equal(feed.channels.inApp.supported, true);
  assert.equal(feed.channels.email.supported, true);
  assert.equal(feed.channels.email.configured, false);
  assert.equal(feed.channels.email.enabled, false);
  assert.ok(feed.channels.email.missing.includes('SMTP_HOST'));
  assert.equal(feed.channels.push.supported, true);
  assert.equal(feed.channels.push.configured, false);
  assert.equal(feed.channels.push.enabled, false);

  const other = notifications.listNotifications('USR-OTHER');
  assert.equal(other.items.length, 0);
  assert.equal(other.unread, 0);
});

test('notification routes include preferences, push and alert controls', () => {
  const registered = [];
  const app = {
    get: (route) => registered.push(`GET ${route}`),
    post: (route) => registered.push(`POST ${route}`),
    put: (route) => registered.push(`PUT ${route}`),
    delete: (route) => registered.push(`DELETE ${route}`),
  };
  notifications.registerNotificationRoutes(app);
  assert.deepEqual(registered.slice().sort(), [
    'DELETE /api/notifications/price-alerts/:id',
    'DELETE /api/notifications/push-subscriptions',
    'GET /api/notifications',
    'POST /api/notifications/price-alerts',
    'POST /api/notifications/push-subscriptions',
    'POST /api/notifications/read',
    'POST /api/notifications/test-email',
    'POST /api/notifications/test-push',
    'PUT /api/notifications/preferences',
  ]);
});

test('email delivery reports its real configuration state', async () => {
  const status = email.emailStatus();
  assert.equal(status.supported, true);
  assert.equal(status.configured, false);
  assert.equal(status.enabled, false);
  assert.ok(status.missing.includes('SMTP_HOST'));
  assert.match(status.reason, /SMTP_HOST/);
  const result = await email.sendEmail({ to: 'trader@example.com', subject: 'test', text: 'body' });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not_configured');
});

test('broker statuses normalize for both adapters', () => {
  assert.equal(reconcile.normalizeBrokerStatus('upstox', 'complete'), 'filled');
  assert.equal(reconcile.normalizeBrokerStatus('upstox', 'partially filled'), 'partially_filled');
  assert.equal(reconcile.normalizeBrokerStatus('upstox', 'trigger pending'), 'submitted');
  assert.equal(reconcile.normalizeBrokerStatus('zerodha', 'COMPLETE'), 'filled');
  assert.equal(reconcile.normalizeBrokerStatus('zerodha', 'REJECTED'), 'rejected');
  assert.equal(reconcile.normalizeBrokerStatus('zerodha', 'CANCELLED'), 'cancelled');
  assert.equal(reconcile.normalizeBrokerStatus('zerodha', 'OPEN'), 'submitted');
  assert.equal(reconcile.normalizeBrokerStatus('zerodha', 'unexpected'), null);
});

test('broker routes expose place, modify and cancel endpoints and stay gated by default', () => {
  const registered = [];
  const app = { get: (route) => registered.push(`GET ${route}`), post: (route) => registered.push(`POST ${route}`) };
  brokerRoutes.registerBrokerRoutes(app);
  reconcile.stopBrokerReconciler();
  assert.ok(registered.includes('POST /api/brokers/:broker/orders'));
  assert.ok(registered.includes('POST /api/brokers/:broker/orders/:orderId/modify'));
  assert.ok(registered.includes('POST /api/brokers/:broker/orders/:orderId/cancel'));
  assert.equal(brokerIndex.liveTradingMasterEnabled(), false, 'live routing must be off unless explicitly enabled');
});

test('reconciliation verifies an unconfirmed order against the broker book instead of resubmitting', async () => {
  const account = brokerStore.saveBrokerAccount({
    userId: user.id,
    broker: 'upstox',
    accessToken: 'test-token',
    mode: 'live',
  });
  db.transaction((tx) => {
    tx.run(
      `INSERT INTO orders (id, user_id, broker_account_id, idempotency_key, symbol, exchange, side, order_type, product, quantity, price, status, mode, broker_order_id, created_at, updated_at, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ORD-UNVERIFIED', user.id, account.id, 'idem-unverified-1', 'RELIANCE', 'NSE', 'BUY', 'MARKET', 'CNC', 10, null,
      'unverified', 'live', 'BO-9001', now, now, now,
    );
    tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', 'ORD-UNVERIFIED', 'unverified', '{"code":"timeout"}', now);
  });

  const fakeAdapter = {
    id: 'upstox',
    getOrders: async () => [{ order_id: 'BO-9001', status: 'complete', filled_quantity: 10, average_price: 1450.5 }],
  };
  const result = await reconcile.reconcileAccountOrders({ userId: user.id, broker: 'upstox', adapter: fakeAdapter });
  assert.equal(result.checked, 1);
  assert.equal(result.updated.length, 1);
  assert.equal(result.updated[0].to, 'filled');

  const order = db.get('SELECT status, filled_quantity, average_price FROM orders WHERE id = ?', 'ORD-UNVERIFIED');
  assert.equal(order.status, 'filled');
  assert.equal(order.filled_quantity, 10);
  assert.equal(order.average_price, 1450.5);

  const events = db.query('SELECT status FROM order_events WHERE order_id = ? ORDER BY seq', 'ORD-UNVERIFIED').map((row) => row.status);
  assert.deepEqual(events, ['unverified', 'filled']);

  const feed = notifications.listNotifications(user.id);
  assert.ok(feed.items.some((item) => item.title === 'Order filled'));

  const again = await reconcile.reconcileAccountOrders({ userId: user.id, broker: 'upstox', adapter: fakeAdapter });
  assert.equal(again.checked, 0, 'terminal orders must not be polled again');
});
