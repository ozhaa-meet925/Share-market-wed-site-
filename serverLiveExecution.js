import crypto from 'node:crypto';
import { getAdapter, liveTradingMasterEnabled } from './serverBrokers/index.js';
import { resolveInstrument } from './serverBrokerInstruments.js';
import { getBrokerAccount } from './serverBrokerStore.js';
import { normalizeBrokerStatus } from './serverBrokerReconcile.js';
import { authorizeLiveOrder } from './serverRiskShield.js';
import { notify } from './serverNotifications.js';
import { recordAudit } from './serverCoreAudit.js';
import { getDatabase } from './serverDb.js';

const ENTRY_QUOTE_MAX_AGE_MS = 60_000;
const EXIT_QUOTE_MAX_AGE_MS = 90_000;
const DEFAULT_FILL_WAIT_MS = Number(process.env.AI_LIVE_FILL_WAIT_MS) || 6_000;
const POLL_INTERVAL_MS = 1_200;
const OPEN_STATUSES = ['pending', 'submitted', 'partially_filled', 'unverified'];
const UNCERTAIN_CODES = new Set(['timeout', 'network_error', 'invalid_response']);

const round2 = (value) => Number(Number(value).toFixed(2));
const round4 = (value) => Number(Number(value).toFixed(4));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LiveExecutionError extends Error {
  constructor(code, message, { status = 409, broker = null, detail = null } = {}) {
    super(message);
    this.name = 'LiveExecutionError';
    this.code = code;
    this.status = status;
    this.broker = broker;
    this.detail = detail;
  }
}

const istParts = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes,
    clock: `${parts.hour}:${parts.minute}`,
    weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun',
    sessionOpen: parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30,
    squareOffWindow: parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && minutes >= 15 * 60 + 15 && minutes < 15 * 60 + 30,
  };
};

const actor = { id: 'ai-live-execution', role: 'system', name: 'AI Live Execution' };

const availableCashOf = (broker, funds) => {
  if (!funds || typeof funds !== 'object') return null;
  const equity = funds.equity || funds;
  const candidates = broker === 'upstox'
    ? [equity.available_margin, equity.available?.cash, equity.available?.opening_balance, equity.net, equity.cash]
    : [equity.available?.live_balance, equity.available?.cash, equity.net, equity.available?.opening_balance];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
};

const brokerPositionRows = (broker, payload) => {
  if (!payload) return [];
  if (broker === 'zerodha') return Array.isArray(payload?.net) ? payload.net : [];
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.data) ? payload.data : [];
};

export const normalizeBrokerPositions = (broker, payload) => {
  const map = new Map();
  for (const row of brokerPositionRows(broker, payload)) {
    const symbol = String(row.tradingsymbol || row.trading_symbol || row.symbol || '').toUpperCase();
    if (!symbol) continue;
    const exchange = String(row.exchange || '').toUpperCase();
    if (broker === 'zerodha' && exchange && exchange !== 'NSE') continue;
    if (broker === 'upstox' && row.instrument_token && !String(row.instrument_token).startsWith('NSE_')) continue;
    const quantity = Number(row.quantity ?? row.net_quantity ?? row.qty ?? 0);
    if (!Number.isFinite(quantity)) continue;
    const previous = map.get(symbol);
    if (previous) {
      previous.quantity += quantity;
      continue;
    }
    map.set(symbol, {
      symbol,
      quantity,
      averagePrice: Number(row.average_price ?? row.avg_price ?? 0) || null,
      lastPrice: Number(row.last_price ?? row.lastPrice ?? 0) || null,
      pnl: Number(row.pnl ?? row.unrealised_pnl ?? 0) || 0,
      product: row.product || null,
      instrumentToken: row.instrument_token || null,
    });
  }
  return map;
};

const orderBookRows = (payload) => (Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []);

const findOrder = (book, brokerOrderId) => {
  const id = String(brokerOrderId || '');
  if (!id) return null;
  return orderBookRows(book).find((row) => [row.order_id, row.orderId, row.id].some((value) => String(value || '') === id)) || null;
};

const readFill = (broker, raw) => {
  const status = raw ? normalizeBrokerStatus(broker, raw.status ?? raw.order_status) : null;
  const filled = Number(raw?.filled_quantity ?? raw?.filledQuantity ?? raw?.quantity_filled ?? 0) || 0;
  const average = Number(raw?.average_price ?? raw?.averagePrice ?? raw?.avg_price ?? 0);
  return {
    status,
    filledQuantity: filled,
    averagePrice: Number.isFinite(average) && average > 0 ? round2(average) : null,
    reason: raw?.status_message || raw?.statusMessage || raw?.reject_reason || raw?.rejection_reason || null,
  };
};

const mapProduct = (broker, tradeStyle) => {
  const intraday = tradeStyle !== 'swing';
  if (broker === 'upstox') return intraday ? 'I' : 'D';
  return intraday ? 'MIS' : 'CNC';
};

const quoteOf = (adapter, broker, symbol, instrument, raw) => {
  const row = raw?.[instrument.quoteKey] || Object.values(raw || {})[0];
  const price = Number(row?.lastPrice ?? row?.last_price ?? 0);
  if (!(price > 0)) return null;
  const providerAt = row?.at ? Date.parse(row.at) : null;
  const receivedAt = Date.now();
  const timestamp = Number.isFinite(providerAt) ? providerAt : receivedAt;
  return {
    symbol,
    c: round2(price),
    dp: Number.isFinite(Number(row?.changePercent)) ? round2(row.changePercent) : null,
    timestamp,
    receivedAt,
    isLive: true,
    assetClass: 'equity',
    source: `${adapter.name} ${broker === 'upstox' ? 'LTP' : 'REST'} quote`,
    quoteKey: instrument.quoteKey,
    ageMs: Math.max(0, receivedAt - timestamp),
  };
};

const fetchQuote = async ({ adapter, token, broker, symbol, instrument }) => {
  const raw = await adapter.getQuotes(token, [instrument.quoteKey]);
  return quoteOf(adapter, broker, symbol, instrument, raw);
};

const requireReadyAccount = ({ userId, broker, adapter, brokerAccount }) => {
  if (!liveTradingMasterEnabled()) {
    throw new LiveExecutionError('live_trading_disabled', 'Live trading is disabled on this server. Set LIVE_TRADING_ENABLED=1 after authorization.', { status: 403 });
  }
  if (!adapter) throw new LiveExecutionError('unknown_broker', `Unknown broker: ${broker}.`, { status: 404, broker });
  const config = adapter.config();
  if (!config.configured) {
    throw new LiveExecutionError('broker_not_configured', `${adapter.name} API credentials are not configured on the server.`, { status: 409, broker });
  }
  if (config.mode === 'paper') {
    throw new LiveExecutionError('broker_paper_mode', `${adapter.name} trading mode is paper; no live order can be sent.`, { status: 409, broker });
  }
  if (!brokerAccount?.accessToken) {
    throw new LiveExecutionError('broker_not_connected', `${adapter.name} is not connected.`, { status: 409, broker });
  }
  if (!brokerAccount.liveAuthorized) {
    throw new LiveExecutionError('live_consent_required', `Live trading consent is not enabled for ${adapter.name}.`, { status: 403, broker });
  }
  return config;
};

export const liveReadiness = async ({ userId, broker, adapter: providedAdapter = null, symbols = [], probe = false }) => {
  const adapter = providedAdapter || getAdapter(broker);
  const blockers = [];
  const checks = [];
  const add = (id, label, ok, detail, state = ok ? 'pass' : 'fail') => {
    checks.push({ id, label, state, detail });
    if (state === 'fail') blockers.push({ id, detail });
  };

  add('server-flag', 'Server live flag', liveTradingMasterEnabled(),
    liveTradingMasterEnabled() ? 'LIVE_TRADING_ENABLED=1 is set.' : 'LIVE_TRADING_ENABLED is not set on the server.');

  if (!adapter) {
    add('broker', 'Broker adapter', false, `Unknown broker: ${broker}.`);
    return { ready: false, blockers, checks, checkedAt: new Date().toISOString() };
  }
  const config = adapter.config();
  const linked = getBrokerAccount(userId, adapter.id);
  add('configured', 'API credentials', config.configured,
    config.configured ? `${adapter.name} API credentials detected.` : `Missing: ${(config.missing || []).join(', ') || 'credentials'}.`);
  add('broker-mode', 'Broker trading mode', config.mode !== 'paper',
    config.mode === 'paper' ? `${adapter.name} is in paper mode; live order routing is blocked.` : `${adapter.name} mode: ${config.mode}.`);
  add('connected', 'Broker session', Boolean(linked?.accessToken),
    linked?.accessToken ? 'Encrypted access token is stored.' : `${adapter.name} is not connected.`);
  add('consent', 'Per-account live consent', Boolean(linked?.liveAuthorized),
    linked?.liveAuthorized ? 'Live consent is enabled for this account.' : 'Enable live trading consent in Broker Connections.');

  const missingInstruments = [];
  if (symbols.length) {
    for (const symbol of symbols) {
      try {
        const resolved = await resolveInstrument(adapter.id, symbol, { allowRefresh: true });
        if (!resolved?.instrumentKey) throw new Error('no instrument key');
      } catch (error) {
        missingInstruments.push(symbol);
      }
    }
    add('instruments', 'Instrument mapping', missingInstruments.length === 0,
      missingInstruments.length === 0 ? `${symbols.length} symbol(s) mapped.` : `Unmapped: ${missingInstruments.join(', ')}.`);
  }

  let probeResult = null;
  if (probe && linked?.accessToken) {
    try {
      const funds = await adapter.getFunds(linked.accessToken);
      probeResult = { ok: true, availableCash: availableCashOf(adapter.id, funds) };
      add('probe', 'Broker probe', true, 'Broker funds endpoint responded.');
    } catch (error) {
      probeResult = { ok: false, error: error.message };
      add('probe', 'Broker probe', false, `Broker probe failed: ${error.message}`);
    }
  }

  const market = istParts();
  add('market', 'NSE session', market.sessionOpen, market.sessionOpen ? `Open · ${market.clock} IST` : `Closed · ${market.clock} IST`, market.sessionOpen ? 'pass' : 'wait');

  return {
    ready: blockers.length === 0,
    readyForEntries: blockers.length === 0 && market.sessionOpen,
    broker: { id: adapter.id, name: adapter.name, mode: config.mode },
    checks,
    blockers,
    probe: probeResult,
    market: { open: market.sessionOpen, clock: market.clock, date: market.dateKey },
    protectiveExits: {
      mode: 'broker_stop_day',
      detail: 'A broker-side SL-M stop order with DAY validity is submitted after each verified live fill. Target and trailing exits remain backend-managed; GTT and overnight stop persistence are not enabled.',
    },
    checkedAt: new Date().toISOString(),
  };
};

export const liveQuoteBatch = async ({ userId, broker, symbols = [], adapter: providedAdapter = null, brokerAccount = null, fetchImpl = fetch }) => {
  const adapter = providedAdapter || getAdapter(broker);
  if (!adapter) throw new LiveExecutionError('unknown_broker', `Unknown broker: ${broker}.`);
  const linked = brokerAccount || getBrokerAccount(userId, broker);
  if (!linked?.accessToken) throw new LiveExecutionError('broker_not_connected', `${adapter.name} is not connected.`);
  const instruments = new Map();
  const missing = [];
  await Promise.all([...new Set(symbols)].map(async (symbol) => {
    try {
      instruments.set(symbol, await resolveInstrument(adapter.id, symbol, { allowRefresh: true, fetchImpl }));
    } catch {
      missing.push(symbol);
    }
  }));
  const keys = [...instruments.values()].map((instrument) => instrument.quoteKey);
  const quotes = {};
  if (keys.length) {
    const raw = await adapter.getQuotes(linked.accessToken, keys);
    for (const [symbol, instrument] of instruments) {
      const quote = quoteOf(adapter, adapter.id, symbol, instrument, raw);
      if (quote) quotes[symbol] = quote;
      else missing.push(symbol);
    }
  }
  return { quotes, missing, instruments: Object.fromEntries(instruments), source: `${adapter.name} broker REST`, fetchedAt: new Date().toISOString() };
};

export const estimateCharges = ({ broker, side, product, price, quantity }) => {
  const turnover = Number(price) * Number(quantity);
  if (!(turnover > 0)) return { total: 0, breakdown: {}, basis: 'estimated_schedule', broker };
  const intraday = ['MIS', 'I', 'INTRADAY'].includes(String(product || '').toUpperCase());
  const brokerage = intraday
    ? Math.min(broker === 'zerodha' ? turnover * 0.0003 : turnover * 0.0005, 20)
    : 0;
  const stt = turnover * (intraday ? (side === 'SELL' ? 0.00025 : 0) : 0.001);
  const exchange = turnover * 0.0000345;
  const sebi = turnover * 0.000001;
  const gst = (brokerage + exchange + sebi) * 0.18;
  const stamp = side === 'BUY' ? turnover * (intraday ? 0.00003 : 0.00015) : 0;
  const total = brokerage + stt + exchange + sebi + gst + stamp;
  return {
    total: round2(total),
    breakdown: {
      brokerage: round2(brokerage),
      stt: round2(stt),
      exchange: round4(exchange),
      sebi: round4(sebi),
      gst: round2(gst),
      stampDuty: round2(stamp),
    },
    basis: 'estimated_schedule',
    broker,
    note: 'Estimated from published NSE/broker equity rates. The contract note is the authoritative charge record.',
  };
};

const orderEvent = (db, orderId, status, detail) => {
  db.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)',
    orderId, status, detail ? JSON.stringify(detail) : null, new Date().toISOString());
};

const recordTransition = ({ userId, order, previous, next, filled, average, reason }) => {
  if (previous === next && !(filled > 0 && next !== 'filled')) return;
  const title = next === 'filled' ? 'Order filled'
    : next === 'rejected' ? 'Order rejected'
      : next === 'cancelled' ? 'Order cancelled'
        : next === 'partially_filled' ? 'Order partially filled'
          : next === 'unverified' ? 'Order status unconfirmed'
            : 'Order updated';
  const body = [
    `${order.symbol} ${order.side} ${order.quantity}`,
    filled > 0 ? `${filled} filled${average ? ` at ₹${average}` : ''}` : null,
    order.broker_order_id ? `Broker order ${order.broker_order_id}` : null,
    next === 'rejected' && reason ? reason : null,
  ].filter(Boolean).join(' · ');
  notify({
    userId,
    category: next === 'rejected' || next === 'unverified' ? 'order_risk' : 'order',
    title,
    body,
    level: next === 'rejected' ? 'warning' : next === 'unverified' ? 'warning' : next === 'filled' ? 'success' : 'info',
  });
};

const todayLiveOrderCount = (db, userId) => {
  const start = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  return Number(db.get(
    "SELECT COUNT(*) AS count FROM orders WHERE user_id = ? AND mode != 'paper' AND created_at >= ? AND status NOT IN ('rejected', 'cancelled')",
    userId, start,
  )?.count || 0);
};

const hasOpenOrderForSymbol = (db, userId, symbol) => Boolean(db.get(
  `SELECT id FROM orders WHERE user_id = ? AND origin = 'ai' AND symbol = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')}) LIMIT 1`,
  userId, symbol, ...OPEN_STATUSES,
));

const nextExitIdempotencyKey = (db, userId, positionId, reason) => {
  const day = istParts().dateKey;
  const attempts = Number(db.get(
    "SELECT COUNT(*) AS count FROM orders WHERE user_id = ? AND origin = 'ai' AND meta LIKE ? AND created_at >= ?",
    userId, `%"positionId":"${positionId}"%`, `${day}T00:00:00.000Z`,
  )?.count || 0);
  return `ai-exit-${day}-${positionId}-${reason}-${attempts + 1}`;
};

const insertOrder = (db, {
  userId, brokerAccountId, idempotencyKey, symbol, exchange, side, orderType, product,
  quantity, price, triggerPrice, mode, origin, meta,
}) => {
  const id = `ORD-${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  db.transaction((tx) => {
    tx.run(
      `INSERT INTO orders (id, user_id, broker_account_id, idempotency_key, symbol, exchange, side, order_type, product,
         quantity, price, trigger_price, status, mode, origin, meta, created_at, updated_at, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      id, userId, brokerAccountId, idempotencyKey, symbol, exchange, side, orderType, product,
      quantity, price ?? null, triggerPrice ?? null, mode, origin, meta ? JSON.stringify(meta) : null, at, at, at,
    );
    tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)',
      id, 'pending', JSON.stringify({ origin, meta }), at);
  });
  return { id, at };
};

const setProtectionOrderState = (db, orderId, { status, brokerOrderId = null, reason = null, meta = null }) => {
  const at = new Date().toISOString();
  db.transaction((tx) => {
    tx.run(
      `UPDATE orders SET status = ?, broker_order_id = COALESCE(?, broker_order_id), reject_reason = ?,
         meta = COALESCE(?, meta), updated_at = ? WHERE id = ?`,
      status, brokerOrderId, status === 'rejected' ? reason : null, meta ? JSON.stringify(meta) : null, at, orderId,
    );
    tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)',
      orderId, status, JSON.stringify({ brokerOrderId, reason }), at);
  });
};

const protectionOrderInput = ({ instrument, position, triggerPrice }) => ({
  instrumentToken: instrument.instrumentToken || instrument.instrumentKey,
  tradingsymbol: instrument.tradingsymbol,
  exchange: 'NSE',
  side: 'SELL',
  quantity: Number(position.qty),
  price: 0,
  triggerPrice,
  orderType: 'SL-M',
  product: position.product,
  validity: 'DAY',
  tag: 'SMPAI-SL',
});

const verifyProtectiveOrder = async ({ adapter, token, broker, brokerOrderId }) => {
  const deadline = Date.now() + 4_000;
  let lastError = null;
  do {
    try {
      const raw = findOrder(await adapter.getOrders(token), brokerOrderId);
      if (raw) return { ...readFill(broker, raw), raw };
    } catch (error) {
      lastError = error;
    }
    if (Date.now() < deadline) await sleep(250);
  } while (Date.now() < deadline);
  throw new LiveExecutionError('protection_unverified',
    `The broker did not expose protective stop ${brokerOrderId} in its order book within four seconds${lastError ? `: ${lastError.message}` : ''}. The order was not resubmitted.`,
    { broker });
};

export const submitProtectiveStop = async ({
  userId,
  broker,
  position,
  adapter: providedAdapter = null,
  brokerAccount: providedBrokerAccount = null,
  db: providedDb = null,
  fetchImpl = fetch,
}) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = providedBrokerAccount || getBrokerAccount(userId, broker);
  const db = providedDb || getDatabase();
  if (!adapter) throw new LiveExecutionError('unknown_broker', `Unknown broker: ${broker}.`);
  const config = requireReadyAccount({ userId, broker, adapter, brokerAccount: linked });
  const quantity = Number(position?.qty);
  const triggerPrice = round2(Number(position?.stopLoss));
  if (!position?.id || !position?.symbol || !Number.isInteger(quantity) || quantity <= 0
    || !Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    throw new LiveExecutionError('invalid_protection', 'A valid live position, quantity and stop price are required.');
  }
  const instrument = await resolveInstrument(adapter.id, position.symbol, { allowRefresh: true, fetchImpl });
  const brokerPositions = normalizeBrokerPositions(adapter.id, await adapter.getPositions(linked.accessToken));
  const brokerPosition = brokerPositions.get(String(position.symbol).toUpperCase());
  if (!brokerPosition || Number(brokerPosition.quantity) < quantity) {
    throw new LiveExecutionError('protective_position_unverified',
      `The broker does not confirm at least ${quantity} open ${position.symbol} share(s); no stop order was sent.`,
      { broker: adapter.id });
  }
  const quoteRows = await adapter.getQuotes(linked.accessToken, [instrument.quoteKey]);
  const liveQuote = quoteOf(adapter, adapter.id, position.symbol, instrument, quoteRows);
  if (!liveQuote || triggerPrice >= liveQuote.c) {
    throw new LiveExecutionError('invalid_stop_trigger',
      `Stop trigger ₹${triggerPrice} must be below the current ${position.symbol} broker quote.`,
      { broker: adapter.id });
  }

  const protectionAttempts = Number(db.get(
    "SELECT COUNT(*) AS count FROM orders WHERE user_id = ? AND origin = 'ai' AND meta LIKE ?",
    userId, `%"positionId":"${position.id}"%`,
  )?.count || 0);
  const idempotencyKey = `ai-protection-${position.id}-${istParts().dateKey}-${protectionAttempts + 1}-${quantity}-${triggerPrice}`;
  const existing = db.get(
    'SELECT id, status, broker_order_id FROM orders WHERE idempotency_key = ?',
    idempotencyKey,
  );
  if (existing) {
    if (existing.status === 'submitted' && existing.broker_order_id) {
      return { orderId: existing.id, brokerOrderId: existing.broker_order_id, status: existing.status, triggerPrice };
    }
    throw new LiveExecutionError('protection_order_exists',
      `The existing protective stop is ${existing.status}; it was not resubmitted.`,
      { broker: adapter.id, detail: { orderId: existing.id } });
  }

  const meta = { type: 'protection', positionId: position.id, triggerPrice, product: position.product };
  const inserted = insertOrder(db, {
    userId,
    brokerAccountId: linked.id,
    idempotencyKey,
    symbol: position.symbol,
    exchange: 'NSE',
    side: 'SELL',
    orderType: 'SL-M',
    product: position.product,
    quantity,
    price: triggerPrice,
    triggerPrice,
    mode: config.mode,
    origin: 'ai',
    meta,
  });
  let submittedBrokerOrderId = null;
  try {
    const result = await adapter.placeOrder(linked.accessToken, protectionOrderInput({ instrument, position, triggerPrice }));
    if (!result?.brokerOrderId) {
      setProtectionOrderState(db, inserted.id, {
        status: 'unverified',
        reason: 'Broker did not return a protective stop order id.',
        meta: { ...meta, reconciliationRequired: true },
      });
      throw new LiveExecutionError('protection_unverified',
        'The broker did not confirm the protective stop order id. It was not resubmitted.',
        { broker: adapter.id, detail: { orderId: inserted.id } });
    }
    submittedBrokerOrderId = result.brokerOrderId;
    const verified = await verifyProtectiveOrder({
      adapter,
      token: linked.accessToken,
      broker: adapter.id,
      brokerOrderId: result.brokerOrderId,
    });
    if (verified.status === 'filled' && verified.filledQuantity < quantity) verified.status = 'partially_filled';
    if (!verified.status) {
      throw new LiveExecutionError('protection_unverified',
        'The broker order book returned an unrecognized protective stop status. The order was not resubmitted.',
        { broker: adapter.id, detail: { orderId: inserted.id, brokerOrderId: result.brokerOrderId } });
    }
    if (['rejected', 'cancelled'].includes(verified.status)) {
      throw new LiveExecutionError('protection_rejected',
        `The broker ${verified.status} the protective stop${verified.reason ? `: ${verified.reason}` : '.'}`,
        { broker: adapter.id, detail: { orderId: inserted.id, brokerOrderId: result.brokerOrderId } });
    }
    if (verified.status !== 'submitted') {
      applyOrderUpdate(db, inserted.id, {
        status: verified.status,
        filled: verified.filledQuantity,
        average: verified.averagePrice,
        reason: verified.reason,
      });
    }
    setProtectionOrderState(db, inserted.id, {
      status: verified.status,
      brokerOrderId: result.brokerOrderId,
      meta: { ...meta, brokerOrderId: result.brokerOrderId },
    });
    const stopTriggered = verified.status !== 'submitted';
    notify({
      userId,
      category: 'risk',
      title: `${stopTriggered ? 'Broker stop-loss triggered' : 'Broker stop-loss verified'}: ${position.symbol}`,
      body: `${quantity} ${position.symbol} share(s) · SL-M trigger ₹${triggerPrice} · ${adapter.name}. Broker status: ${verified.status}. Validity is today only.`,
      level: stopTriggered ? 'warning' : 'success',
    });
    recordAudit({
      actor,
      action: stopTriggered ? 'ai.live.protective_stop_triggered' : 'ai.live.protective_stop_submitted',
      resource: `order:${inserted.id}`,
      detail: { broker: adapter.id, symbol: position.symbol, quantity, triggerPrice, brokerOrderId: result.brokerOrderId },
    });
    return {
      orderId: inserted.id,
      brokerOrderId: result.brokerOrderId,
      status: verified.status,
      filledQuantity: verified.filledQuantity,
      averagePrice: verified.averagePrice,
      triggerPrice,
    };
  } catch (error) {
    const status = UNCERTAIN_CODES.has(error.code) || error.code === 'protection_unverified' ? 'unverified' : 'rejected';
    const reason = error.message || 'The broker rejected the protective stop.';
    setProtectionOrderState(db, inserted.id, {
      status,
      brokerOrderId: submittedBrokerOrderId,
      reason,
      meta: { ...meta, brokerOrderId: submittedBrokerOrderId, reconciliationRequired: status === 'unverified' },
    });
    if (error.code === 'protection_unverified') throw error;
    recordAudit({
      actor,
      action: 'ai.live.protective_stop_failed',
      resource: `order:${inserted.id}`,
      outcome: 'failure',
      detail: { broker: adapter.id, symbol: position.symbol, code: error.code || 'broker_error' },
    });
    throw new LiveExecutionError(status === 'unverified' ? 'protection_unverified' : 'protection_rejected',
      `${reason} The order was not retried.`,
      { broker: adapter.id, detail: { orderId: inserted.id } });
  }
};

export const modifyProtectiveStop = async ({
  userId,
  broker,
  position,
  adapter: providedAdapter = null,
  brokerAccount: providedBrokerAccount = null,
  db: providedDb = null,
  fetchImpl = fetch,
}) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = providedBrokerAccount || getBrokerAccount(userId, broker);
  const db = providedDb || getDatabase();
  if (!adapter || !position?.protectionOrderId || !position?.protectionBrokerOrderId) {
    throw new LiveExecutionError('protection_order_missing', 'The existing broker stop-loss order could not be identified.');
  }
  requireReadyAccount({ userId, broker, adapter, brokerAccount: linked });
  const triggerPrice = round2(Number(position.stopLoss));
  const instrument = await resolveInstrument(adapter.id, position.symbol, { allowRefresh: true, fetchImpl });
  const quoteRows = await adapter.getQuotes(linked.accessToken, [instrument.quoteKey]);
  const liveQuote = quoteOf(adapter, adapter.id, position.symbol, instrument, quoteRows);
  if (!liveQuote || !(triggerPrice > 0) || triggerPrice >= liveQuote.c) {
    throw new LiveExecutionError('invalid_stop_trigger', `The updated ${position.symbol} stop trigger is not below the current broker quote.`);
  }
  await adapter.modifyOrder(linked.accessToken, position.protectionBrokerOrderId, {
    quantity: Number(position.qty),
    orderType: 'SL-M',
    triggerPrice,
    validity: 'DAY',
  });
  const row = db.get('SELECT meta FROM orders WHERE id = ?', position.protectionOrderId);
  const meta = { ...(row?.meta ? JSON.parse(row.meta) : {}), triggerPrice, quantity: Number(position.qty) };
  db.run('UPDATE orders SET quantity = ?, price = ?, trigger_price = ?, meta = ?, updated_at = ? WHERE id = ?',
    Number(position.qty), triggerPrice, triggerPrice, JSON.stringify(meta), new Date().toISOString(), position.protectionOrderId);
  recordAudit({
    actor,
    action: 'ai.live.protective_stop_modified',
    resource: `order:${position.protectionOrderId}`,
    detail: { broker: adapter.id, symbol: position.symbol, quantity: position.qty, triggerPrice },
  });
  return { triggerPrice, status: 'submitted' };
};

export const cancelProtectiveStop = async ({
  userId,
  broker,
  position,
  reason,
  adapter: providedAdapter = null,
  brokerAccount: providedBrokerAccount = null,
  db: providedDb = null,
}) => {
  if (!position?.protectionOrderId || !position?.protectionBrokerOrderId) return { cancelled: true, skipped: 'no_protection_order' };
  const adapter = providedAdapter || getAdapter(broker);
  const linked = providedBrokerAccount || getBrokerAccount(userId, broker);
  const db = providedDb || getDatabase();
  if (!adapter || !linked?.accessToken) throw new LiveExecutionError('broker_not_connected', `${broker} is not connected.`);
  await adapter.cancelOrder(linked.accessToken, position.protectionBrokerOrderId, {});
  const verified = await verifyProtectiveOrder({
    adapter,
    token: linked.accessToken,
    broker: adapter.id,
    brokerOrderId: position.protectionBrokerOrderId,
  });
  if (verified.status !== 'cancelled') {
    throw new LiveExecutionError(
      verified.status === 'filled' || verified.status === 'partially_filled'
        ? 'protection_already_triggered'
        : 'protection_cancel_unverified',
      verified.status === 'filled' || verified.status === 'partially_filled'
        ? 'The broker stop-loss triggered while cancellation was in progress; no second sell order was sent.'
        : `The broker has not confirmed cancellation of the protective stop (status: ${verified.status || 'unknown'}). No second sell order was sent.`,
      { broker: adapter.id },
    );
  }
  applyOrderUpdate(db, position.protectionOrderId, { status: 'cancelled', filled: 0, average: null, reason });
  recordAudit({
    actor,
    action: 'ai.live.protective_stop_cancelled',
    resource: `order:${position.protectionOrderId}`,
    detail: { broker: adapter.id, symbol: position.symbol, reason },
  });
  return { cancelled: true, brokerOrderId: position.protectionBrokerOrderId };
};

const applyOrderUpdate = (db, orderId, { status, filled, average, reason = null }) => {
  const at = new Date().toISOString();
  const terminal = ['filled', 'rejected', 'cancelled'].includes(status);
  db.transaction((tx) => {
    tx.run(
      `UPDATE orders SET status = ?, filled_quantity = ?, average_price = ?, reject_reason = ?, updated_at = ?,
         completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END
       WHERE id = ?`,
      status, filled ?? 0, average ?? null, status === 'rejected' ? reason : null, at, terminal ? 1 : 0, at, orderId,
    );
    tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)',
      orderId, status, JSON.stringify({ filled: filled ?? 0, averagePrice: average ?? null, reason }), at);
  });
  return at;
};

const pollOrder = async ({ adapter, token, broker, brokerOrderId, waitMs }) => {
  const deadline = Date.now() + Math.max(0, waitMs);
  let last = { status: 'submitted', filledQuantity: 0, averagePrice: null, reason: null };
  for (;;) {
    try {
      const book = await adapter.getOrders(token);
      const raw = findOrder(book, brokerOrderId);
      if (raw) {
        const read = readFill(broker, raw);
        if (read.status) last = read;
        if (['filled', 'rejected', 'cancelled'].includes(read.status)) return last;
      }
    } catch {
      // Status polling is best-effort; the durable reconciler retries later.
    }
    if (Date.now() >= deadline) return last;
    await sleep(POLL_INTERVAL_MS);
  }
};

export const submitLiveEntry = async ({
  userId,
  broker,
  symbol,
  risk = {},
  signal = null,
  tradeStyle = 'intraday',
  brokerAccount = null,
  adapter: providedAdapter = null,
  db: providedDb = null,
  fetchImpl = fetch,
  waitMs = DEFAULT_FILL_WAIT_MS,
  marketOpen = null,
}) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = brokerAccount || getBrokerAccount(userId, broker);
  const db = providedDb || getDatabase();
  const config = requireReadyAccount({ userId, broker, adapter, brokerAccount: linked });
  const session = istParts();
  const open = marketOpen === true;
  if (!open) throw new LiveExecutionError('market_closed', 'A verified open NSE session is required; live entries are blocked.', { status: 409, broker });
  if (symbol === undefined) throw new LiveExecutionError('invalid_symbol', 'A symbol is required.');
  const instrument = await resolveInstrument(adapter.id, symbol, { fetchImpl });
  if (!instrument?.instrumentKey) throw new LiveExecutionError('instrument_unmapped', `No live instrument mapping for ${symbol}.`, { status: 409, broker });

  const quote = await fetchQuote({ adapter, token: linked.accessToken, broker: adapter.id, symbol, instrument });
  if (!quote) throw new LiveExecutionError('quote_unavailable', `No live ${adapter.name} quote for ${symbol}.`, { status: 502, broker });
  if (quote.ageMs > ENTRY_QUOTE_MAX_AGE_MS) {
    throw new LiveExecutionError('stale_quote', `The ${adapter.name} quote for ${symbol} is ${Math.round(quote.ageMs / 1000)}s old; live entries require ${Math.round(ENTRY_QUOTE_MAX_AGE_MS / 1000)}s or newer data.`, { status: 409, broker });
  }

  let funds = null;
  try {
    funds = await adapter.getFunds(linked.accessToken);
  } catch (error) {
    throw new LiveExecutionError('broker_funds_unavailable', `Broker funds could not be read, so position size cannot be verified: ${error.message}`, { status: 502, broker });
  }
  const availableCash = availableCashOf(adapter.id, funds);
  if (availableCash === null) {
    throw new LiveExecutionError('broker_funds_unavailable', 'The broker did not return available equity funds.', { status: 502, broker });
  }

  const perTradeCap = Number(risk.maxInvestmentPerTrade) || 0;
  const budget = Math.min(perTradeCap > 0 ? perTradeCap : availableCash, availableCash);
  const quantity = Math.floor(budget / quote.c);
  if (!(quantity >= 1)) {
    throw new LiveExecutionError('insufficient_budget', `Broker cash ₹${round2(availableCash)} and the per-trade cap cannot buy one share of ${symbol} at ₹${quote.c}.`, { status: 409, broker });
  }

  let positions = null;
  try {
    positions = normalizeBrokerPositions(adapter.id, await adapter.getPositions(linked.accessToken));
  } catch {
    positions = null;
  }
  const heldQty = Number(positions?.get(symbol)?.quantity || 0);
  const duplicateSymbol = heldQty > 0 || hasOpenOrderForSymbol(db, userId, symbol);
  const todayOrders = todayLiveOrderCount(db, userId);
  const decision = authorizeLiveOrder({
    userId,
    broker: adapter.id,
    symbol,
    side: 'BUY',
    quantity,
    price: quote.c,
    quoteAgeSeconds: Math.round(quote.ageMs / 1000),
    brokerFunds: { availableCash },
    riskSettings: risk,
    todayLiveOrders: todayOrders,
    duplicateSymbol,
    marketOpen: open,
    actor: { id: userId, role: 'system', name: 'AI Live Executor' },
  });
  if (!decision.allowed) {
    throw new LiveExecutionError('risk_blocked', `Risk Shield blocked the live entry: ${decision.reason}`, { status: 403, broker, detail: { checks: decision.checks } });
  }

  const day = session.dateKey;
  const idempotencyKey = `ai-entry-${day}-${decision.idempotencyKey}`;
  const existing = db.get('SELECT id, status, broker_order_id, filled_quantity, average_price FROM orders WHERE idempotency_key = ?', idempotencyKey);
  if (existing) {
    return {
      deduplicated: true,
      orderId: existing.id,
      brokerOrderId: existing.broker_order_id,
      status: existing.status,
      filledQuantity: Number(existing.filled_quantity) || 0,
      averagePrice: Number(existing.average_price) || null,
      symbol,
      side: 'BUY',
      quantity,
      quote,
      instrument,
      verified: Number(existing.filled_quantity) > 0,
    };
  }

  const product = mapProduct(adapter.id, tradeStyle);
  const meta = { type: 'entry', autoTrade: true, signalScore: signal?.score ?? null, quoteBasis: 'broker_live', product };
  const inserted = insertOrder(db, {
    userId,
    brokerAccountId: linked.id,
    idempotencyKey,
    symbol,
    exchange: 'NSE',
    side: 'BUY',
    orderType: 'MARKET',
    product,
    quantity,
    price: quote.c,
    mode: config.mode,
    origin: 'ai',
    meta,
  });

  let result;
  try {
    result = await adapter.placeOrder(linked.accessToken, {
      instrumentToken: instrument.instrumentToken || instrument.instrumentKey,
      tradingsymbol: instrument.tradingsymbol,
      exchange: 'NSE',
      side: 'BUY',
      quantity,
      price: 0,
      triggerPrice: 0,
      orderType: 'MARKET',
      product,
      validity: 'DAY',
      tag: 'SMPAI',
    });
  } catch (error) {
    const uncertain = UNCERTAIN_CODES.has(error.code);
    const status = uncertain ? 'unverified' : 'rejected';
    applyOrderUpdate(db, inserted.id, { status, filled: 0, average: null, reason: error.message });
    const order = { id: inserted.id, symbol, side: 'BUY', quantity, broker_order_id: null };
    recordTransition({ userId, order, previous: 'pending', next: status, filled: 0, average: null, reason: error.message });
    recordAudit({
      actor,
      action: uncertain ? 'ai.live.entry_unverified' : 'ai.live.entry_rejected',
      resource: `order:${inserted.id}`,
      outcome: 'failure',
      detail: { broker: adapter.id, symbol, quantity, code: error.code || 'broker_error' },
    });
    if (uncertain) {
      return {
        orderId: inserted.id,
        brokerOrderId: null,
        status,
        reconciliationRequired: true,
        filledQuantity: 0,
        averagePrice: null,
        symbol,
        side: 'BUY',
        quantity,
        quote,
        instrument,
        verified: false,
        message: 'The broker did not confirm the order. It was not resubmitted; reconciliation will verify the broker order book.',
      };
    }
    throw new LiveExecutionError(error.code || 'order_rejected', error.message, { status: 409, broker: adapter.id, detail: { orderId: inserted.id } });
  }

  const brokerOrderId = result?.brokerOrderId || null;
  db.transaction((tx) => {
    tx.run('UPDATE orders SET status = ?, broker_order_id = ?, updated_at = ? WHERE id = ?', 'submitted', brokerOrderId, new Date().toISOString(), inserted.id);
    tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)',
      inserted.id, 'submitted', JSON.stringify({ brokerOrderId }), new Date().toISOString());
  });
  notify({
    userId,
    category: 'order',
    title: 'BUY order submitted',
    body: `${symbol} × ${quantity} submitted to ${adapter.name}${brokerOrderId ? ` · order ${brokerOrderId}` : ''}. Awaiting verified execution.`,
    level: 'info',
  });
  recordAudit({ actor, action: 'ai.live.entry_submitted', resource: `order:${inserted.id}`, detail: { broker: adapter.id, symbol, quantity, brokerOrderId } });

  const polled = await pollOrder({ adapter, token: linked.accessToken, broker: adapter.id, brokerOrderId, waitMs });
  const status = polled.status || 'submitted';
  const filled = polled.filledQuantity || 0;
  const average = polled.averagePrice;
  const finalStatus = status === 'filled' && filled < quantity ? 'partially_filled' : status;
  applyOrderUpdate(db, inserted.id, { status: finalStatus, filled, average, reason: polled.reason });
  const orderRow = { id: inserted.id, symbol, side: 'BUY', quantity, broker_order_id: brokerOrderId };
  recordTransition({ userId, order: orderRow, previous: 'submitted', next: finalStatus, filled, average, reason: polled.reason });
  if (filled > 0) {
    notify({
      userId,
      category: 'trade',
      title: finalStatus === 'filled' ? `BUY execution verified: ${symbol}` : `BUY partially filled: ${symbol}`,
      body: `${filled}/${quantity} filled at ₹${average ?? '—'} · ${adapter.name} · order ${brokerOrderId ?? 'pending id'}. The AI worker will submit a broker-side DAY stop-loss after mirroring the verified fill.`,
      level: finalStatus === 'filled' ? 'success' : 'warning',
    });
    recordAudit({ actor, action: 'ai.live.entry_filled', resource: `order:${inserted.id}`, detail: { broker: adapter.id, symbol, filled, average, brokerOrderId } });
  }

  return {
    orderId: inserted.id,
    brokerOrderId,
    status: finalStatus,
    filledQuantity: filled,
    averagePrice: average,
    rejectReason: polled.reason,
    symbol,
    side: 'BUY',
    quantity,
    quote,
    instrument,
    product,
    verified: filled > 0,
    reconciliationRequired: ['submitted', 'unverified', 'partially_filled'].includes(finalStatus),
  };
};

export const submitLiveExit = async ({
  userId,
  broker,
  position,
  reason = 'manual',
  brokerAccount = null,
  adapter: providedAdapter = null,
  db: providedDb = null,
  fetchImpl = fetch,
  waitMs = DEFAULT_FILL_WAIT_MS,
  marketOpen = null,
}) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = brokerAccount || getBrokerAccount(userId, broker);
  const db = providedDb || getDatabase();
  const config = requireReadyAccount({ userId, broker, adapter, brokerAccount: linked });
  const open = marketOpen === true;
  if (!open) throw new LiveExecutionError('market_closed', 'A verified open NSE session is required; live exits are blocked.', { status: 409, broker });
  if (!position?.symbol) throw new LiveExecutionError('invalid_position', 'A position is required for a live exit.');

  const instrument = await resolveInstrument(adapter.id, position.symbol, { fetchImpl });
  let positions;
  try {
    positions = normalizeBrokerPositions(adapter.id, await adapter.getPositions(linked.accessToken));
  } catch (error) {
    throw new LiveExecutionError('broker_positions_unavailable', `Open broker quantity could not be verified, so no exit was sent: ${error.message}`, { status: 502, broker });
  }
  const brokerQty = Number(positions.get(position.symbol)?.quantity || 0);
  const quantity = Math.min(Math.abs(Number(position.qty) || 0), brokerQty);
  if (!(quantity >= 1)) {
    return { status: 'broker_flat', symbol: position.symbol, brokerQuantity: brokerQty, filledQuantity: 0, verified: false, message: 'The broker reports no open quantity for this symbol; no sell order was sent.' };
  }

  const quote = await fetchQuote({ adapter, token: linked.accessToken, broker: adapter.id, symbol: position.symbol, instrument });
  if (!quote) throw new LiveExecutionError('quote_unavailable', `No live ${adapter.name} quote for ${position.symbol}.`, { status: 502, broker });
  if (quote.ageMs > EXIT_QUOTE_MAX_AGE_MS) {
    throw new LiveExecutionError('stale_quote', `The ${adapter.name} exit quote is ${Math.round(quote.ageMs / 1000)}s old; the exit was not sent.`, { status: 409, broker });
  }

  const idempotencyKey = nextExitIdempotencyKey(db, userId, position.id, reason);
  const product = position.product || mapProduct(adapter.id, position.tradeStyle || 'intraday');
  const meta = { type: 'exit', autoTrade: true, positionId: position.id, reason, quoteBasis: 'broker_live', product };
  const inserted = insertOrder(db, {
    userId,
    brokerAccountId: linked.id,
    idempotencyKey,
    symbol: position.symbol,
    exchange: 'NSE',
    side: 'SELL',
    orderType: 'MARKET',
    product,
    quantity,
    price: quote.c,
    mode: config.mode,
    origin: 'ai',
    meta,
  });

  let result;
  try {
    result = await adapter.placeOrder(linked.accessToken, {
      instrumentToken: instrument.instrumentToken || instrument.instrumentKey,
      tradingsymbol: instrument.tradingsymbol,
      exchange: 'NSE',
      side: 'SELL',
      quantity,
      price: 0,
      triggerPrice: 0,
      orderType: 'MARKET',
      product,
      validity: 'DAY',
      tag: 'SMPAI',
    });
  } catch (error) {
    const uncertain = UNCERTAIN_CODES.has(error.code);
    const status = uncertain ? 'unverified' : 'rejected';
    applyOrderUpdate(db, inserted.id, { status, filled: 0, average: null, reason: error.message });
    recordTransition({ userId, order: { id: inserted.id, symbol: position.symbol, side: 'SELL', quantity, broker_order_id: null }, previous: 'pending', next: status, filled: 0, average: null, reason: error.message });
    recordAudit({ actor, action: uncertain ? 'ai.live.exit_unverified' : 'ai.live.exit_rejected', resource: `order:${inserted.id}`, outcome: 'failure', detail: { broker: adapter.id, symbol: position.symbol, quantity, code: error.code || 'broker_error', reason } });
    if (uncertain) {
      return { orderId: inserted.id, brokerOrderId: null, status, filledQuantity: 0, averagePrice: null, symbol: position.symbol, side: 'SELL', quantity, quote, verified: false, reconciliationRequired: true };
    }
    throw new LiveExecutionError(error.code || 'exit_rejected', error.message, { status: 409, broker: adapter.id, detail: { orderId: inserted.id } });
  }

  const brokerOrderId = result?.brokerOrderId || null;
  db.transaction((tx) => {
    tx.run('UPDATE orders SET status = ?, broker_order_id = ?, updated_at = ? WHERE id = ?', 'submitted', brokerOrderId, new Date().toISOString(), inserted.id);
    tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)',
      inserted.id, 'submitted', JSON.stringify({ brokerOrderId }), new Date().toISOString());
  });
  notify({
    userId,
    category: 'order',
    title: 'SELL order submitted',
    body: `${position.symbol} × ${quantity} exit (${reason}) submitted to ${adapter.name}${brokerOrderId ? ` · order ${brokerOrderId}` : ''}. Awaiting verified execution.`,
    level: 'info',
  });
  recordAudit({ actor, action: 'ai.live.exit_submitted', resource: `order:${inserted.id}`, detail: { broker: adapter.id, symbol: position.symbol, quantity, reason, brokerOrderId } });

  const polled = await pollOrder({ adapter, token: linked.accessToken, broker: adapter.id, brokerOrderId, waitMs });
  const status = polled.status || 'submitted';
  const filled = polled.filledQuantity || 0;
  const average = polled.averagePrice;
  const finalStatus = status === 'filled' && filled < quantity ? 'partially_filled' : status;
  applyOrderUpdate(db, inserted.id, { status: finalStatus, filled, average, reason: polled.reason });
  recordTransition({ userId, order: { id: inserted.id, symbol: position.symbol, side: 'SELL', quantity, broker_order_id: brokerOrderId }, previous: 'submitted', next: finalStatus, filled, average, reason: polled.reason });

  const charges = filled > 0 ? estimateCharges({ broker: adapter.id, side: 'SELL', product, price: average || quote.c, quantity: filled }) : null;
  const grossPnl = filled > 0 ? round2(((average || quote.c) - Number(position.entryPrice || 0)) * filled) : 0;
  const realizedPnl = filled > 0 ? round2(grossPnl - Number(charges?.total || 0)) : 0;
  if (filled > 0) {
    notify({
      userId,
      category: 'trade',
      title: finalStatus === 'filled' ? `SELL execution verified: ${position.symbol}` : `SELL partially filled: ${position.symbol}`,
      body: `${filled}/${quantity} filled at ₹${average ?? '—'} · ${adapter.name} · order ${brokerOrderId ?? 'pending id'} · P&L ₹${realizedPnl} after estimated charges.`,
      level: finalStatus === 'filled' ? 'success' : 'warning',
    });
    recordAudit({ actor, action: 'ai.live.exit_filled', resource: `order:${inserted.id}`, detail: { broker: adapter.id, symbol: position.symbol, filled, average, brokerOrderId, realizedPnl, reason } });
  }

  return {
    orderId: inserted.id,
    brokerOrderId,
    status: finalStatus,
    filledQuantity: filled,
    averagePrice: average,
    rejectReason: polled.reason,
    symbol: position.symbol,
    side: 'SELL',
    quantity,
    quote,
    product,
    charges,
    grossPnl,
    realizedPnl,
    verified: filled > 0,
    reconciliationRequired: ['submitted', 'unverified', 'partially_filled'].includes(finalStatus),
  };
};

export const fetchBrokerPositions = async ({ userId, broker, adapter: providedAdapter = null, brokerAccount = null }) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = brokerAccount || getBrokerAccount(userId, broker);
  if (!adapter || !linked?.accessToken) throw new LiveExecutionError('broker_not_connected', `${broker} is not connected.`);
  return normalizeBrokerPositions(adapter.id, await adapter.getPositions(linked.accessToken));
};

export const fetchBrokerFunds = async ({ userId, broker, adapter: providedAdapter = null, brokerAccount = null }) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = brokerAccount || getBrokerAccount(userId, broker);
  if (!adapter || !linked?.accessToken) throw new LiveExecutionError('broker_not_connected', `${broker} is not connected.`);
  const funds = await adapter.getFunds(linked.accessToken);
  return { availableCash: availableCashOf(adapter.id, funds), raw: funds };
};

export const syncAiBrokerOrders = async ({ userId, broker, adapter: providedAdapter = null, brokerAccount = null, db: providedDb = null }) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = brokerAccount || getBrokerAccount(userId, broker);
  const db = providedDb || getDatabase();
  if (!adapter || !linked?.accessToken) return { checked: 0, updated: [], skipped: 'not_connected' };
  const rows = db.query(
    `SELECT id, symbol, side, quantity, status, broker_order_id, filled_quantity, average_price, meta, created_at
     FROM orders WHERE user_id = ? AND origin = 'ai' AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
       AND broker_order_id IS NOT NULL ORDER BY created_at DESC LIMIT 25`,
    userId, ...OPEN_STATUSES,
  );
  if (!rows.length) return { checked: 0, updated: [] };
  let book;
  try {
    book = await adapter.getOrders(linked.accessToken);
  } catch {
    return { checked: rows.length, updated: [], error: 'order_book_unavailable' };
  }
  const updated = [];
  for (const order of rows) {
    const raw = findOrder(book, order.broker_order_id);
    if (!raw) {
      const meta = order.meta ? JSON.parse(order.meta) : null;
      if (meta?.type === 'protection'
        && istParts(new Date(order.created_at)).dateKey !== istParts().dateKey) {
        applyOrderUpdate(db, order.id, { status: 'cancelled', filled: 0, average: null, reason: 'DAY protective stop expired after the trading session.' });
        updated.push({
          orderId: order.id,
          symbol: order.symbol,
          side: order.side,
          quantity: Number(order.quantity),
          status: 'cancelled',
          filledQuantity: 0,
          averagePrice: null,
          brokerOrderId: order.broker_order_id,
          reason: 'DAY protective stop expired after the trading session.',
          meta,
        });
      }
      continue;
    }
    const read = readFill(adapter.id, raw);
    if (!read.status) continue;
    const finalStatus = read.status === 'filled' && read.filledQuantity < Number(order.quantity) ? 'partially_filled' : read.status;
    const changed = finalStatus !== order.status
      || read.filledQuantity !== Number(order.filled_quantity)
      || (read.averagePrice !== null && read.averagePrice !== Number(order.average_price));
    if (!changed) continue;
    applyOrderUpdate(db, order.id, { status: finalStatus, filled: read.filledQuantity, average: read.averagePrice, reason: read.reason });
    recordTransition({ userId, order, previous: order.status, next: finalStatus, filled: read.filledQuantity, average: read.averagePrice, reason: read.reason });
    recordAudit({
      actor,
      action: 'ai.live.order_reconciled',
      resource: `order:${order.id}`,
      detail: { broker: adapter.id, from: order.status, to: finalStatus, filled: read.filledQuantity, averagePrice: read.averagePrice },
    });
    updated.push({
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: Number(order.quantity),
      status: finalStatus,
      filledQuantity: read.filledQuantity,
      averagePrice: read.averagePrice,
      brokerOrderId: order.broker_order_id,
      meta: order.meta ? JSON.parse(order.meta) : null,
      reason: read.reason,
    });
  }
  return { checked: rows.length, updated };
};

export const findBrokerExitPrice = async ({ userId, broker, symbol, since = null, adapter: providedAdapter = null, brokerAccount = null }) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = brokerAccount || getBrokerAccount(userId, broker);
  if (!adapter || !linked?.accessToken) return null;
  let trades;
  try {
    trades = await adapter.getTrades(linked.accessToken);
  } catch {
    return null;
  }
  const rows = Array.isArray(trades) ? trades : Array.isArray(trades?.data) ? trades.data : [];
  let qty = 0;
  let value = 0;
  const sinceMs = since ? new Date(since).getTime() : 0;
  for (const row of rows) {
    const rowSymbol = String(row.tradingsymbol || row.trading_symbol || row.symbol || '').toUpperCase();
    const side = String(row.transaction_type || row.transactionType || '').toUpperCase();
    if (rowSymbol !== symbol || side !== 'SELL') continue;
    const at = Date.parse(row.fill_timestamp || row.order_timestamp || row.exchange_timestamp || row.trade_time || 0);
    if (Number.isFinite(at) && at < sinceMs) continue;
    const rowQty = Number(row.quantity ?? 0);
    const rowPrice = Number(row.average_price ?? row.price ?? 0);
    if (!(rowQty > 0) || !(rowPrice > 0)) continue;
    qty += rowQty;
    value += rowQty * rowPrice;
  }
  if (!(qty > 0)) return null;
  return { quantity: qty, averagePrice: round2(value / qty) };
};

export const cancelOpenAiEntries = async ({ userId, broker, adapter: providedAdapter = null, brokerAccount = null, db: providedDb = null, reason = 'Daily risk limit reached' }) => {
  const adapter = providedAdapter || getAdapter(broker);
  const linked = brokerAccount || getBrokerAccount(userId, broker);
  const db = providedDb || getDatabase();
  if (!adapter || !linked?.accessToken) return { cancelled: [], failed: [], skipped: 'not_connected' };
  const rows = db.query(
    `SELECT id, symbol, broker_order_id, status FROM orders
     WHERE user_id = ? AND origin = 'ai' AND side = 'BUY' AND status IN ('pending', 'submitted')
     ORDER BY created_at DESC LIMIT 20`,
    userId,
  );
  const cancelled = [];
  const failed = [];
  for (const row of rows) {
    if (!row.broker_order_id) { failed.push({ orderId: row.id, code: 'missing_broker_order_id' }); continue; }
    try {
      await adapter.cancelOrder(linked.accessToken, row.broker_order_id, {});
      applyOrderUpdate(db, row.id, { status: 'cancelled', filled: 0, average: null, reason });
      notify({
        userId,
        category: 'order_risk',
        title: 'Unfilled entry cancelled',
        body: `${row.symbol} entry ${row.broker_order_id} was cancelled because: ${reason}.`,
        level: 'warning',
      });
      cancelled.push({ orderId: row.id, brokerOrderId: row.broker_order_id, symbol: row.symbol });
    } catch (error) {
      failed.push({ orderId: row.id, brokerOrderId: row.broker_order_id, code: error.code || 'cancel_failed', message: error.message });
    }
  }
  if (cancelled.length || failed.length) {
    recordAudit({
      actor,
      action: 'ai.live.entries_cancelled',
      resource: `broker:${adapter.id}`,
      detail: { reason, cancelled, failed },
    });
  }
  return { cancelled, failed };
};

export const liveExecutionHealth = () => ({
  masterEnabled: liveTradingMasterEnabled(),
  entryQuoteMaxAgeMs: ENTRY_QUOTE_MAX_AGE_MS,
  exitQuoteMaxAgeMs: EXIT_QUOTE_MAX_AGE_MS,
  fillWaitMs: DEFAULT_FILL_WAIT_MS,
  protectiveOrders: 'broker-side SL-M with DAY validity; targets and trailing exits are backend-managed',
  transport: 'REST polling (broker WebSocket decoders not bundled)',
});
