import { recordAudit } from './serverCoreAudit.js';
import { notify } from './serverNotifications.js';
import { getBrokerAccount, listAllBrokerAccounts } from './serverBrokerStore.js';
import { getAdapter } from './serverBrokers/index.js';
import { getDatabase } from './serverDb.js';

const OPEN_STATUSES = ['unverified', 'submitted', 'partially_filled'];
const TERMINAL = new Set(['filled', 'rejected', 'cancelled']);
const POLL_LIMIT = 25;
const DEFAULT_INTERVAL_MS = 90_000;

const UPSTOX_STATUS = {
  complete: 'filled',
  rejected: 'rejected',
  cancelled: 'cancelled',
  'cancelled after market order': 'cancelled',
  'partially filled': 'partially_filled',
  open: 'submitted',
  'trigger pending': 'submitted',
  'put order req received': 'submitted',
  'validation pending': 'submitted',
  modified: 'submitted',
};

const ZERODHA_STATUS = {
  complete: 'filled',
  rejected: 'rejected',
  cancelled: 'cancelled',
  'cancelled amo': 'cancelled',
  'partially filled': 'partially_filled',
  open: 'submitted',
  'trigger pending': 'submitted',
  'modify pending': 'submitted',
  'put order req received': 'submitted',
  'validation pending': 'submitted',
  'amo req received': 'submitted',
  'open pending': 'submitted',
};

export const normalizeBrokerStatus = (broker, rawStatus) => {
  const key = String(rawStatus || '').trim().toLowerCase();
  if (!key) return null;
  const map = broker === 'zerodha' ? ZERODHA_STATUS : broker === 'upstox' ? UPSTOX_STATUS : {};
  return map[key] || null;
};

const orderBookOf = (payload) => (Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []);

const findBrokerOrder = (book, brokerOrderId) => {
  const id = String(brokerOrderId || '');
  if (!id) return null;
  return book.find((row) => [row.order_id, row.orderId, row.id].some((value) => String(value || '') === id)) || null;
};

const readFilled = (row) => {
  const qty = Number(row.filled_quantity ?? row.filledQuantity ?? row.quantity_filled ?? 0);
  return Number.isFinite(qty) ? qty : 0;
};

const readAverage = (row) => {
  const price = Number(row.average_price ?? row.averagePrice ?? row.avg_price ?? 0);
  return Number.isFinite(price) && price > 0 ? price : null;
};

const readReason = (row) => row.status_message || row.statusMessage || row.reject_reason || row.rejection_reason || null;

const notifyTransition = ({ userId, order, next, filled, average }) => {
  const title = next === 'filled' ? 'Order filled'
    : next === 'rejected' ? 'Order rejected'
      : next === 'cancelled' ? 'Order cancelled'
        : next === 'partially_filled' ? 'Order partially filled'
          : 'Order updated';
  const body = [
    `${order.symbol} ${order.side} ${order.quantity}`,
    filled > 0 ? `${filled} filled${average ? ` at ₹${average}` : ''}` : null,
    next === 'rejected' && order.reject_reason ? order.reject_reason : null,
    `Broker order ${order.broker_order_id}`,
  ].filter(Boolean).join(' · ');
  notify({
    userId,
    category: 'order',
    title,
    body,
    level: next === 'rejected' ? 'warning' : next === 'filled' ? 'success' : 'info',
  });
};

export const reconcileAccountOrders = async ({ userId, broker, accessToken = null, adapter: providedAdapter = null, orderBook = null }) => {
  const adapter = providedAdapter || getAdapter(broker);
  if (!adapter) return { checked: 0, updated: [], skipped: 'unknown_broker' };
  const account = accessToken ? { accessToken } : getBrokerAccount(userId, broker);
  if (!account?.accessToken) return { checked: 0, updated: [], skipped: 'not_connected' };

  const db = getDatabase();
  const rows = db.query(
    `SELECT id, symbol, side, quantity, status, broker_order_id, filled_quantity, average_price
     FROM orders
     WHERE user_id = ? AND broker_account_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
       AND broker_order_id IS NOT NULL
     ORDER BY created_at DESC LIMIT ?`,
    userId, account.id, ...OPEN_STATUSES, POLL_LIMIT,
  );
  if (rows.length === 0) return { checked: 0, updated: [] };

  let book;
  try {
    book = orderBookOf(orderBook ?? await adapter.getOrders(account.accessToken));
  } catch (error) {
    recordAudit({
      actor: { id: 'recovery-engine', role: 'system', name: 'Broker Reconciliation' },
      action: 'recovery.reconcile_failed',
      resource: `broker:${broker}`,
      outcome: 'failure',
      detail: { userId, code: error.code || 'unknown', message: String(error.message).slice(0, 200) },
    });
    return { checked: rows.length, updated: [], error: error.code || 'reconcile_failed' };
  }

  const updated = [];
  for (const order of rows) {
    const remote = findBrokerOrder(book, order.broker_order_id);
    if (!remote) continue;
    const next = normalizeBrokerStatus(broker, remote.status ?? remote.order_status);
    if (!next) continue;
    const filled = readFilled(remote);
    const average = readAverage(remote);
    const reason = readReason(remote);
    const changed = next !== order.status
      || held(filled, order.filled_quantity)
      || (average !== null && average !== order.average_price);
    if (!changed) continue;

    const at = new Date().toISOString();
    const terminal = TERMINAL.has(next);
    db.transaction((tx) => {
      tx.run(
        `UPDATE orders SET status = ?, filled_quantity = ?, average_price = ?, reject_reason = ?,
           updated_at = ?, completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END
         WHERE id = ? AND user_id = ?`,
        next, filled, average, next === 'rejected' ? reason : null,
        at, terminal ? 1 : 0, at, order.id, userId,
      );
      tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)',
        order.id, next, JSON.stringify({ source: 'broker_reconciliation', filled, averagePrice: average, reason }), at);
    });
    if (next !== order.status) {
      notifyTransition({ userId, order: { ...order, reject_reason: reason }, next, filled, average });
    }
    recordAudit({
      actor: { id: 'recovery-engine', role: 'system', name: 'Broker Reconciliation' },
      action: 'recovery.order_verified',
      resource: `order:${order.id}`,
      detail: { broker, from: order.status, to: next, filled, averagePrice: average },
    });
    updated.push({ orderId: order.id, brokerOrderId: order.broker_order_id, from: order.status, to: next, filled });
  }
  return { checked: rows.length, updated };
};

const held = (filled, previous) => Number(filled) !== Number(previous || 0);

let monitor = null;
export const brokerReconcilerStatus = () => ({
  running: Boolean(monitor),
  intervalMs: monitor?.intervalMs || null,
  lastRunAt: monitor?.lastRunAt || null,
  lastSummary: monitor?.lastSummary || null,
});

export const runBrokerReconciler = async () => {
  const accounts = listAllBrokerAccounts();
  const summary = { accounts: accounts.length, checked: 0, updated: 0, errors: 0 };
  for (const row of accounts) {
    try {
      const result = await reconcileAccountOrders({ userId: row.user_id, broker: row.broker });
      summary.checked += result.checked;
      summary.updated += result.updated.length;
      if (result.error) summary.errors += 1;
    } catch {
      summary.errors += 1;
    }
  }
  if (monitor) {
    monitor.lastRunAt = new Date().toISOString();
    monitor.lastSummary = summary;
  }
  return summary;
};

export const startBrokerReconciler = ({ intervalMs = DEFAULT_INTERVAL_MS } = {}) => {
  if (monitor) return brokerReconcilerStatus();
  monitor = { intervalMs, lastRunAt: null, lastSummary: null, timer: null };
  monitor.timer = setInterval(() => { runBrokerReconciler().catch(() => {}); }, intervalMs);
  monitor.timer.unref?.();
  return brokerReconcilerStatus();
};

export const stopBrokerReconciler = () => {
  if (!monitor) return;
  clearInterval(monitor.timer);
  monitor = null;
};
