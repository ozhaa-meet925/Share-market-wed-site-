import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-live-'));
process.env.CORE_DATA_DIR = tempDir;
process.env.CORE_DB_PATH = path.join(tempDir, 'platform.sqlite');
process.env.BROKER_TOKEN_KEY = 'test-broker-token-key-with-more-than-32-characters';
process.env.LIVE_TRADING_ENABLED = '1';
process.env.AI_LIVE_FILL_WAIT_MS = '0';
process.env.INSTRUMENT_OVERRIDES = JSON.stringify({
  RELIANCE: { upstox: 'NSE_EQ|INE002A01018' },
  TCS: { upstox: 'NSE_EQ|INE467B01029' },
  INFY: { upstox: 'NSE_EQ|INE009A01021' },
  SBIN: { upstox: 'NSE_EQ|INE062A01020' },
  HDFCBANK: { upstox: 'NSE_EQ|INE040A01034' },
  ICICIBANK: { upstox: 'NSE_EQ|INE090A01021' },
});

const dbModule = await import('../serverDb.js');
const store = await import('../serverBrokerStore.js');
const risk = await import('../serverRiskShield.js');
const live = await import('../serverLiveExecution.js');

const db = dbModule.openDatabase({ file: process.env.CORE_DB_PATH });

test.after(() => {
  dbModule.closeDatabase();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const QUOTE_KEY = {
  RELIANCE: 'NSE_EQ|INE002A01018',
  TCS: 'NSE_EQ|INE467B01029',
  INFY: 'NSE_EQ|INE009A01021',
  SBIN: 'NSE_EQ|INE062A01020',
  HDFCBANK: 'NSE_EQ|INE040A01034',
  ICICIBANK: 'NSE_EQ|INE090A01021',
};

const makeUser = (id) => {
  store.syncUser({ id, phone: `90000${id.slice(-5)}`, name: id, role: 'trader', kycStatus: 'active' });
  store.saveBrokerAccount({ userId: id, broker: 'upstox', accessToken: `token-${id}`, mode: 'live' });
  store.setLiveConsent(id, 'upstox', true);
  return id;
};

const makeAdapter = ({ mode = 'filled', price = 100, quoteAgeMs = 0, cash = 100000, positions = [], book = [] } = {}) => {
  const state = {
    mode,
    price,
    quoteAgeMs,
    cash,
    positions: [...positions],
    book: [...book],
    placed: [],
    cancelled: [],
    serial: 0,
  };
  const adapter = {
    id: 'upstox',
    name: 'Upstox (test)',
    state,
    config: () => ({ configured: true, mode: 'live', missing: [] }),
    getQuotes: async (_token, keys) => Object.fromEntries(keys.map((key) => [key, {
      lastPrice: state.price,
      at: new Date(Date.now() - state.quoteAgeMs).toISOString(),
    }])),
    getFunds: async () => ({ equity: { available_margin: state.cash } }),
    getPositions: async () => state.positions,
    getOrders: async () => state.book,
    getTrades: async () => [],
    placeOrder: async (_token, order) => {
      state.placed.push(order);
      const protective = order.orderType === 'SL-M';
      if (state.mode === 'reject') {
        throw Object.assign(new Error('Order rejected by exchange'), { code: 'order_rejected' });
      }
      if (state.mode === 'timeout') {
        throw Object.assign(new Error('Broker request timed out'), { code: 'timeout' });
      }
      state.serial += 1;
      const brokerOrderId = `BO-TEST-${state.serial}`;
      const filled = protective ? 0 : state.mode === 'partial' ? Math.max(1, Math.floor(order.quantity / 2)) : state.mode === 'open' ? 0 : order.quantity;
      const row = {
        order_id: brokerOrderId,
        tradingsymbol: order.tradingsymbol,
        transaction_type: order.side,
        quantity: order.quantity,
        status: protective ? 'trigger pending' : state.mode === 'open' ? 'open' : state.mode === 'partial' ? 'partially filled' : 'complete',
        filled_quantity: filled,
        average_price: state.price,
        status_message: null,
      };
      state.book = [...state.book.filter((item) => item.order_id !== brokerOrderId), row];
      return { brokerOrderId };
    },
    cancelOrder: async (_token, brokerOrderId) => {
      state.cancelled.push(brokerOrderId);
      state.book = state.book.map((row) => (row.order_id === brokerOrderId ? { ...row, status: 'cancelled' } : row));
      return { brokerOrderId };
    },
    modifyOrder: async (_token, brokerOrderId, patch) => {
      state.modified = { brokerOrderId, patch };
      return { brokerOrderId };
    },
  };
  return adapter;
};

const RISK = { maxInvestmentPerTrade: 5000, maxDailyTrades: 20 };

const submit = (userId, adapter, symbol, extra = {}) => live.submitLiveEntry({
  userId,
  broker: 'upstox',
  symbol,
  adapter,
  brokerAccount: store.getBrokerAccount(userId, 'upstox'),
  risk: RISK,
  marketOpen: true,
  waitMs: 0,
  ...extra,
});

test('verified entry mirrors only after the broker confirms a full fill', async () => {
  const userId = makeUser('USR-LIVE-FILL');
  const adapter = makeAdapter({ mode: 'filled', price: 100 });
  const result = await submit(userId, adapter, 'RELIANCE');

  assert.equal(result.status, 'filled');
  assert.equal(result.verified, true);
  assert.equal(result.filledQuantity, 50);
  assert.equal(result.averagePrice, 100);
  assert.match(result.brokerOrderId, /^BO-TEST-/);
  assert.equal(adapter.state.placed.length, 1);
  assert.equal(adapter.state.placed[0].orderType, 'MARKET');
  assert.equal(adapter.state.placed[0].side, 'BUY');

  const order = db.get('SELECT * FROM orders WHERE id = ?', result.orderId);
  assert.equal(order.status, 'filled');
  assert.equal(order.broker_order_id, result.brokerOrderId);
  assert.equal(order.origin, 'ai');
  assert.equal(order.mode, 'live');
});

test('a partial fill is tracked with verified quantity and stays reconcilable', async () => {
  const userId = makeUser('USR-LIVE-PART');
  const adapter = makeAdapter({ mode: 'partial', price: 200 });
  const result = await submit(userId, adapter, 'TCS', { risk: { maxInvestmentPerTrade: 4000, maxDailyTrades: 20 } });

  assert.equal(result.status, 'partially_filled');
  assert.equal(result.filledQuantity, 10);
  assert.equal(result.verified, true);
  assert.equal(result.reconciliationRequired, true);
  const order = db.get('SELECT status, filled_quantity FROM orders WHERE id = ?', result.orderId);
  assert.equal(order.status, 'partially_filled');
  assert.equal(Number(order.filled_quantity), 10);
});

test('a rejected order is terminal, notified and never retried', async () => {
  const userId = makeUser('USR-LIVE-REJECT');
  const adapter = makeAdapter({ mode: 'reject', price: 300 });
  await assert.rejects(
    () => submit(userId, adapter, 'INFY'),
    (error) => error.code === 'order_rejected' && error.status === 409,
  );
  assert.equal(adapter.state.placed.length, 1);
  const orders = db.query("SELECT status FROM orders WHERE user_id = ? AND origin = 'ai'", userId);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, 'rejected');
});

test('an uncertain broker response is marked unverified and not resubmitted', async () => {
  const userId = makeUser('USR-LIVE-UNSURE');
  const adapter = makeAdapter({ mode: 'timeout', price: 400 });
  const first = await submit(userId, adapter, 'SBIN');

  assert.equal(first.status, 'unverified');
  assert.equal(first.verified, false);
  assert.equal(first.reconciliationRequired, true);
  assert.equal(adapter.state.placed.length, 1);

  const second = await submit(userId, adapter, 'SBIN').catch((error) => error);
  assert.equal(second.code, 'risk_blocked', 'an unverified order must block a fresh entry instead of being resent');
  assert.equal(adapter.state.placed.length, 1, 'an unverified order must never be resent');
  const openOrder = db.get('SELECT status, broker_order_id FROM orders WHERE id = ?', first.orderId);
  assert.equal(openOrder.status, 'unverified');
  assert.equal(openOrder.broker_order_id, null);
});

test('stale broker quotes block live entries before any order is sent', async () => {
  const userId = makeUser('USR-LIVE-STALE');
  const adapter = makeAdapter({ quoteAgeMs: 5 * 60 * 1000 });
  await assert.rejects(
    () => submit(userId, adapter, 'HDFCBANK'),
    (error) => error.code === 'stale_quote',
  );
  assert.equal(adapter.state.placed.length, 0);
});

test('verified live positions receive a broker-side stop-loss that can be trailed and cancelled', async () => {
  const userId = makeUser('USR-LIVE-PROTECT');
  const adapter = makeAdapter({
    price: 100,
    positions: [{ tradingsymbol: 'RELIANCE', exchange: 'NSE', quantity: 50, average_price: 100 }],
  });
  const position = {
    id: 'POS-PROTECT-1',
    symbol: 'RELIANCE',
    qty: 50,
    stopLoss: 98.5,
    product: 'I',
  };
  const stop = await live.submitProtectiveStop({
    userId,
    broker: 'upstox',
    position,
    adapter,
    brokerAccount: store.getBrokerAccount(userId, 'upstox'),
    db,
  });

  assert.equal(stop.status, 'submitted');
  assert.equal(stop.triggerPrice, 98.5);
  assert.equal(adapter.state.placed.length, 1);
  assert.deepEqual(
    { side: adapter.state.placed[0].side, quantity: adapter.state.placed[0].quantity, orderType: adapter.state.placed[0].orderType, triggerPrice: adapter.state.placed[0].triggerPrice },
    { side: 'SELL', quantity: 50, orderType: 'SL-M', triggerPrice: 98.5 },
  );
  const row = db.get('SELECT status, order_type, trigger_price, meta FROM orders WHERE id = ?', stop.orderId);
  assert.equal(row.status, 'submitted');
  assert.equal(row.order_type, 'SL-M');
  assert.equal(Number(row.trigger_price), 98.5);
  assert.equal(JSON.parse(row.meta).type, 'protection');

  const protectedPosition = {
    ...position,
    protectionOrderId: stop.orderId,
    protectionBrokerOrderId: stop.brokerOrderId,
    stopLoss: 99,
  };
  await live.modifyProtectiveStop({
    userId,
    broker: 'upstox',
    position: protectedPosition,
    adapter,
    brokerAccount: store.getBrokerAccount(userId, 'upstox'),
    db,
  });
  assert.equal(adapter.state.modified.patch.triggerPrice, 99);

  await live.cancelProtectiveStop({
    userId,
    broker: 'upstox',
    position: protectedPosition,
    reason: 'test exit',
    adapter,
    brokerAccount: store.getBrokerAccount(userId, 'upstox'),
    db,
  });
  assert.deepEqual(adapter.state.cancelled, [stop.brokerOrderId]);
  assert.equal(db.get('SELECT status FROM orders WHERE id = ?', stop.orderId).status, 'cancelled');
});

test('protective stop refuses to oversell when the broker position is not verified', async () => {
  const userId = makeUser('USR-PROTECT-NET-EMPTY');
  const adapter = makeAdapter({ price: 100, positions: [] });
  await assert.rejects(
    () => live.submitProtectiveStop({
      userId,
      broker: 'upstox',
      position: { id: 'POS-PROTECT-FLAT', symbol: 'RELIANCE', qty: 10, stopLoss: 98, product: 'I' },
      adapter,
      brokerAccount: store.getBrokerAccount(userId, 'upstox'),
      db,
    }),
    (error) => error.code === 'protective_position_unverified',
  );
  assert.equal(adapter.state.placed.length, 0);
});

test('a broker-rejected protective stop is persisted as rejected and reported as failure', async () => {
  const userId = makeUser('USR-STOP-REJECT-X7');
  const adapter = makeAdapter({
    mode: 'reject',
    price: 100,
    positions: [{ tradingsymbol: 'RELIANCE', exchange: 'NSE', quantity: 10, average_price: 100 }],
  });
  await assert.rejects(
    () => live.submitProtectiveStop({
      userId,
      broker: 'upstox',
      position: { id: 'POS-PROTECT-REJECT', symbol: 'RELIANCE', qty: 10, stopLoss: 98, product: 'I' },
      adapter,
      brokerAccount: store.getBrokerAccount(userId, 'upstox'),
      db,
    }),
    (error) => error.code === 'protection_rejected',
  );
  const order = db.get("SELECT status, reject_reason FROM orders WHERE symbol = 'RELIANCE' AND order_type = 'SL-M' AND user_id = ?", userId);
  assert.equal(order.status, 'rejected');
  assert.match(order.reject_reason, /rejected by exchange/i);
});

test('the Risk Shield blocks duplicate live exposure and an engaged kill switch', async () => {
  const userId = makeUser('USR-LIVE-DUP');
  const adapter = makeAdapter({ mode: 'filled', price: 150, positions: [{ tradingsymbol: 'ICICIBANK', quantity: 10, average_price: 150 }] });
  await assert.rejects(
    () => submit(userId, adapter, 'ICICIBANK'),
    (error) => error.code === 'risk_blocked' && /already has a live order or position/i.test(error.message),
  );
  assert.equal(adapter.state.placed.length, 0);

  const killUser = makeUser('USR-LIVE-KILL');
  risk.setKillSwitch({ userId: killUser, active: true, reason: 'Manual emergency stop', actor: { id: 'test', role: 'system' } });
  await assert.rejects(
    () => submit(killUser, makeAdapter(), 'RELIANCE'),
    (error) => error.code === 'risk_blocked' && /Manual emergency stop/i.test(error.message),
  );
});

test('a verified exit closes the broker quantity and reports P&L after estimated charges', async () => {
  const userId = makeUser('USR-LIVE-EXIT');
  const adapter = makeAdapter({
    mode: 'filled',
    price: 110,
    positions: [{ tradingsymbol: 'RELIANCE', quantity: 10, average_price: 100 }],
  });
  const result = await live.submitLiveExit({
    userId,
    broker: 'upstox',
    position: { id: 'POS-TEST-1', symbol: 'RELIANCE', qty: 10, entryPrice: 100, product: 'I' },
    reason: 'target',
    adapter,
    brokerAccount: store.getBrokerAccount(userId, 'upstox'),
    marketOpen: true,
    waitMs: 0,
  });

  assert.equal(result.status, 'filled');
  assert.equal(result.verified, true);
  assert.equal(result.filledQuantity, 10);
  assert.equal(result.averagePrice, 110);
  assert.equal(result.grossPnl, 100);
  assert.ok(result.charges.total > 0);
  assert.ok(result.realizedPnl < 100, 'charges must reduce the mirrored P&L');
  assert.equal(adapter.state.placed[0].side, 'SELL');
});

test('an exit is not sent when the broker reports no open quantity', async () => {
  const userId = makeUser('USR-LIVE-FLAT');
  const adapter = makeAdapter({ positions: [] });
  const result = await live.submitLiveExit({
    userId,
    broker: 'upstox',
    position: { id: 'POS-TEST-2', symbol: 'RELIANCE', qty: 10, entryPrice: 100 },
    adapter,
    brokerAccount: store.getBrokerAccount(userId, 'upstox'),
    marketOpen: true,
    waitMs: 0,
  });

  assert.equal(result.status, 'broker_flat');
  assert.equal(result.verified, false);
  assert.equal(adapter.state.placed.length, 0);
});

test('recovery syncs a submitted order from the broker book without resubmitting', async () => {
  const userId = makeUser('USR-LIVE-SYNC');
  const adapter = makeAdapter({ mode: 'open', price: 250 });
  const submitted = await submit(userId, adapter, 'INFY', { risk: { maxInvestmentPerTrade: 5000, maxDailyTrades: 20 } });

  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.filledQuantity, 0);
  assert.equal(adapter.state.placed.length, 1);

  adapter.state.book = adapter.state.book.map((row) => ({
    ...row,
    status: 'complete',
    filled_quantity: 20,
    average_price: 251,
  }));
  const sync = await live.syncAiBrokerOrders({
    userId,
    broker: 'upstox',
    adapter,
    brokerAccount: store.getBrokerAccount(userId, 'upstox'),
  });

  assert.equal(sync.checked, 1);
  assert.equal(sync.updated.length, 1);
  assert.equal(sync.updated[0].status, 'filled');
  assert.equal(sync.updated[0].filledQuantity, 20);
  const order = db.get('SELECT status, filled_quantity, average_price FROM orders WHERE id = ?', submitted.orderId);
  assert.equal(order.status, 'filled');
  assert.equal(Number(order.filled_quantity), 20);
  assert.equal(Number(order.average_price), 251);
  assert.equal(adapter.state.placed.length, 1, 'reconciliation must not place a new order');
});

test('unfilled AI entries are cancelled at the broker when a risk halt stops the agent', async () => {
  const userId = makeUser('USR-LIVE-CANCEL');
  const adapter = makeAdapter({ mode: 'open', price: 80 });
  const submitted = await submit(userId, adapter, 'SBIN', { risk: { maxInvestmentPerTrade: 4000, maxDailyTrades: 20 } });
  assert.equal(submitted.status, 'submitted');

  const result = await live.cancelOpenAiEntries({
    userId,
    broker: 'upstox',
    adapter,
    brokerAccount: store.getBrokerAccount(userId, 'upstox'),
    reason: 'Daily loss limit reached',
  });

  assert.equal(result.cancelled.length, 1);
  assert.equal(adapter.state.cancelled.length, 1);
  assert.equal(adapter.state.cancelled[0], submitted.brokerOrderId);
  const order = db.get('SELECT status FROM orders WHERE id = ?', submitted.orderId);
  assert.equal(order.status, 'cancelled');
});

test('live readiness reports every missing gate instead of pretending to be ready', async () => {
  const userId = 'USR-LIVE-READY';
  store.syncUser({ id: userId, phone: '9000099001', name: 'Readiness', role: 'trader', kycStatus: 'active' });
  const adapter = makeAdapter();
  const notLinked = await live.liveReadiness({ userId, broker: 'upstox', adapter, symbols: ['RELIANCE'] });
  assert.equal(notLinked.ready, false);
  assert.ok(notLinked.blockers.some((item) => item.id === 'connected'));
  assert.ok(notLinked.blockers.some((item) => item.id === 'consent'));
  assert.ok(notLinked.checks.some((item) => item.id === 'instruments' && item.state === 'pass'));

  store.saveBrokerAccount({ userId, broker: 'upstox', accessToken: 'ready-token', mode: 'live' });
  store.setLiveConsent(userId, 'upstox', true);
  const linked = await live.liveReadiness({ userId, broker: 'upstox', adapter, symbols: ['RELIANCE'] });
  assert.equal(linked.ready, true);
  assert.equal(linked.blockers.length, 0);
});
