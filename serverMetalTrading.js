import crypto from 'node:crypto';
import { readSessionUser } from './serverAuth.js';
import { syncUser } from './serverBrokerStore.js';
import { getDatabase } from './serverDb.js';
import { notify } from './serverNotifications.js';
import { estimateMetalCharges } from './metalCharges.js';

const STARTING_CASH = 1_000_000;
const SYMBOLS = new Set(['GOLD', 'SILVER']);

const fail = (res, status, error, code) => res.status(status).json({ error, code });
const round = (value) => Number(Number(value).toFixed(2));

const ensureAccount = (db, userId) => {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO metal_paper_accounts (user_id, starting_cash, cash, reserved_cash, updated_at)
     VALUES (?, ?, ?, 0, ?) ON CONFLICT(user_id) DO NOTHING`,
    userId, STARTING_CASH, STARTING_CASH, now,
  );
  for (const symbol of SYMBOLS) {
    db.run(
      `INSERT INTO metal_paper_holdings (user_id, symbol, quantity_grams, reserved_grams, avg_price_per_gram, realized_pnl, updated_at)
       VALUES (?, ?, 0, 0, 0, 0, ?) ON CONFLICT(user_id, symbol) DO NOTHING`,
      userId, symbol, now,
    );
  }
};

const publicOrder = (row) => ({
  id: row.id,
  symbol: row.symbol,
  side: row.side,
  orderType: row.order_type,
  quantityGrams: row.quantity_grams,
  limitPricePerGram: row.limit_price_per_gram,
  executionPricePerGram: row.execution_price_per_gram,
  grossValue: row.gross_value,
  charges: row.charges,
  status: row.status,
  rejectReason: row.reject_reason,
  quoteProvider: row.quote_provider,
  quoteTimestamp: row.quote_timestamp,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  filledAt: row.filled_at,
  cancelledAt: row.cancelled_at,
  mode: 'paper',
});

const publicHolding = (row) => ({
  symbol: row.symbol,
  quantityGrams: row.quantity_grams,
  reservedGrams: row.reserved_grams,
  availableGrams: round(row.quantity_grams - row.reserved_grams),
  avgPricePerGram: row.avg_price_per_gram,
  realizedPnl: row.realized_pnl,
});

const tradingState = (db, userId) => {
  ensureAccount(db, userId);
  const account = db.get('SELECT * FROM metal_paper_accounts WHERE user_id = ?', userId);
  const holdings = db.query('SELECT * FROM metal_paper_holdings WHERE user_id = ? ORDER BY symbol', userId).map(publicHolding);
  const orders = db.query('SELECT * FROM metal_paper_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', userId).map(publicOrder);
  return {
    mode: 'paper',
    liveExecution: {
      available: false,
      reason: 'Real MCX order execution is disabled until an MCX-capable broker account and explicit live consent are verified.',
    },
    account: {
      startingCash: account.starting_cash,
      cash: account.cash,
      reservedCash: account.reserved_cash,
      availableCash: round(account.cash - account.reserved_cash),
      updatedAt: account.updated_at,
    },
    holdings,
    orders,
  };
};

const verifiedPricePerGram = (quote) => {
  if (!quote || quote.isReal !== true || quote.isDemo === true || quote.isStale === true) return null;
  const price = Number(quote.inrPerGram);
  return Number.isFinite(price) && price > 0 ? price : null;
};

const fillOrder = (db, orderId, pricePerGram, quote) => db.transaction((tx) => {
  const order = tx.get('SELECT * FROM metal_paper_orders WHERE id = ?', orderId);
  if (!order || order.status !== 'PENDING') return null;
  const account = tx.get('SELECT * FROM metal_paper_accounts WHERE user_id = ?', order.user_id);
  const holding = tx.get('SELECT * FROM metal_paper_holdings WHERE user_id = ? AND symbol = ?', order.user_id, order.symbol);
  const gross = round(order.quantity_grams * pricePerGram);
  const chargeBreakdown = estimateMetalCharges({ side: order.side, turnover: gross });
  const charges = chargeBreakdown.total;
  const now = new Date().toISOString();

  if (order.side === 'BUY') {
    const reserved = order.order_type === 'LIMIT'
      ? round(order.quantity_grams * order.limit_price_per_gram + estimateMetalCharges({ side: 'BUY', turnover: order.quantity_grams * order.limit_price_per_gram }).total)
      : 0;
    const nextReserved = Math.max(0, account.reserved_cash - reserved);
    const totalDebit = round(gross + charges);
    if (account.cash - nextReserved < totalDebit) throw new Error('Insufficient paper cash when the order matched.');
    const oldCost = holding.quantity_grams * holding.avg_price_per_gram;
    const nextQuantity = round(holding.quantity_grams + order.quantity_grams);
    const nextAverage = round((oldCost + gross + charges) / nextQuantity);
    tx.run('UPDATE metal_paper_accounts SET cash = ?, reserved_cash = ?, updated_at = ? WHERE user_id = ?', round(account.cash - totalDebit), nextReserved, now, order.user_id);
    tx.run('UPDATE metal_paper_holdings SET quantity_grams = ?, avg_price_per_gram = ?, updated_at = ? WHERE user_id = ? AND symbol = ?', nextQuantity, nextAverage, now, order.user_id, order.symbol);
  } else {
    const nextReserved = Math.max(0, holding.reserved_grams - (order.order_type === 'LIMIT' ? order.quantity_grams : 0));
    if (holding.quantity_grams - nextReserved < order.quantity_grams) throw new Error('Insufficient paper holdings when the order matched.');
    const nextQuantity = round(holding.quantity_grams - order.quantity_grams);
    const realized = round(holding.realized_pnl + ((pricePerGram - holding.avg_price_per_gram) * order.quantity_grams) - charges);
    tx.run('UPDATE metal_paper_accounts SET cash = ?, updated_at = ? WHERE user_id = ?', round(account.cash + gross - charges), now, order.user_id);
    tx.run('UPDATE metal_paper_holdings SET quantity_grams = ?, reserved_grams = ?, avg_price_per_gram = ?, realized_pnl = ?, updated_at = ? WHERE user_id = ? AND symbol = ?', nextQuantity, nextReserved, nextQuantity > 0 ? holding.avg_price_per_gram : 0, realized, now, order.user_id, order.symbol);
  }

  tx.run(
    `UPDATE metal_paper_orders SET execution_price_per_gram = ?, gross_value = ?, charges = ?, status = 'FILLED',
     quote_provider = ?, quote_timestamp = ?, updated_at = ?, filled_at = ? WHERE id = ?`,
    round(pricePerGram), gross, charges, String(quote.provider || ''), String(quote.priceTimestamp || quote.timestamp || ''), now, now, order.id,
  );
  return tx.get('SELECT * FROM metal_paper_orders WHERE id = ?', order.id);
});

const releaseReservation = (db, order) => db.transaction((tx) => {
  const current = tx.get('SELECT * FROM metal_paper_orders WHERE id = ?', order.id);
  if (!current || current.status !== 'PENDING') return false;
  const now = new Date().toISOString();
  if (current.side === 'BUY') {
    const reserved = round(current.quantity_grams * current.limit_price_per_gram + estimateMetalCharges({ side: 'BUY', turnover: current.quantity_grams * current.limit_price_per_gram }).total);
    tx.run('UPDATE metal_paper_accounts SET reserved_cash = MAX(0, reserved_cash - ?), updated_at = ? WHERE user_id = ?', reserved, now, current.user_id);
  } else {
    tx.run('UPDATE metal_paper_holdings SET reserved_grams = MAX(0, reserved_grams - ?), updated_at = ? WHERE user_id = ? AND symbol = ?', current.quantity_grams, now, current.user_id, current.symbol);
  }
  tx.run("UPDATE metal_paper_orders SET status = 'CANCELLED', updated_at = ?, cancelled_at = ? WHERE id = ?", now, now, current.id);
  return true;
});

const sendFillNotification = (order) => {
  if (!order) return;
  notify({
    userId: order.user_id,
    category: 'order',
    level: 'success',
    title: `Paper ${order.side.toLowerCase()} filled · ${order.symbol}`,
    body: `${order.quantity_grams} g at ₹${Number(order.execution_price_per_gram).toFixed(2)}/g · estimated charges ₹${Number(order.charges).toFixed(2)}. No broker order was placed.`,
    externalKey: `metal-paper-fill:${order.id}`,
  });
};

export const registerMetalTradingRoutes = (app, { getQuote, authenticate = readSessionUser }) => {
  app.get('/api/metals/paper', (req, res) => {
    const user = authenticate(req);
    if (!user) return fail(res, 401, 'Sign in to access your metals paper account.', 'not_authenticated');
    syncUser(user);
    return res.json(tradingState(getDatabase(), user.id));
  });

  app.post('/api/metals/paper/orders', async (req, res) => {
    const user = authenticate(req);
    if (!user) return fail(res, 401, 'Sign in to place metals paper orders.', 'not_authenticated');
    if (String(req.body?.mode || 'paper').toLowerCase() !== 'paper') {
      return fail(res, 409, 'Real MCX execution is not available. Use the clearly labelled paper mode.', 'metal_live_execution_unavailable');
    }
    const symbol = String(req.body?.symbol || '').trim().toUpperCase().replace(/^MCX:/, '');
    const side = String(req.body?.side || '').trim().toUpperCase();
    const orderType = String(req.body?.orderType || '').trim().toUpperCase();
    const quantityGrams = Number(req.body?.quantityGrams);
    const limitPricePerGram = Number(req.body?.limitPricePerGram);
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
    if (!SYMBOLS.has(symbol)) return fail(res, 400, 'Only GOLD and SILVER are supported.', 'unsupported_metal');
    if (!['BUY', 'SELL'].includes(side)) return fail(res, 400, 'Choose Buy or Sell.', 'invalid_side');
    if (!['MARKET', 'LIMIT'].includes(orderType)) return fail(res, 400, 'Choose Market or Limit.', 'invalid_order_type');
    if (!Number.isInteger(quantityGrams) || quantityGrams < 1 || quantityGrams > 100_000) return fail(res, 400, 'Quantity must be between 1 and 100,000 grams.', 'invalid_quantity');
    if (orderType === 'LIMIT' && (!(limitPricePerGram > 0) || limitPricePerGram > 10_000_000)) return fail(res, 400, 'Enter a valid positive limit price per gram.', 'invalid_limit_price');
    if (!/^[A-Za-z0-9:_-]{8,100}$/.test(idempotencyKey)) return fail(res, 400, 'A valid idempotency key is required.', 'invalid_idempotency_key');

    syncUser(user);
    const db = getDatabase();
    ensureAccount(db, user.id);
    const existing = db.get('SELECT * FROM metal_paper_orders WHERE user_id = ? AND idempotency_key = ?', user.id, idempotencyKey);
    if (existing) return res.json({ order: publicOrder(existing), ...tradingState(db, user.id) });

    let quote;
    try { quote = await getQuote(symbol); } catch { return fail(res, 502, 'A verified metal quote is required to place this paper order.', 'metal_quote_unavailable'); }
    const marketPrice = verifiedPricePerGram(quote);
    if (marketPrice === null) return fail(res, 409, 'The latest metal quote is unavailable or stale.', 'metal_quote_not_tradeable');
    const referencePrice = orderType === 'LIMIT' ? round(limitPricePerGram) : marketPrice;
    const gross = round(quantityGrams * referencePrice);
    const charges = estimateMetalCharges({ side, turnover: gross });
    const account = db.get('SELECT * FROM metal_paper_accounts WHERE user_id = ?', user.id);
    const holding = db.get('SELECT * FROM metal_paper_holdings WHERE user_id = ? AND symbol = ?', user.id, symbol);
    const requiredCash = round(gross + charges.total);
    if (side === 'BUY' && account.cash - account.reserved_cash < requiredCash) return fail(res, 409, 'Insufficient available paper cash.', 'insufficient_paper_cash');
    if (side === 'SELL' && holding.quantity_grams - holding.reserved_grams < quantityGrams) return fail(res, 409, 'Insufficient available paper holdings.', 'insufficient_paper_holdings');

    const id = `MPO-${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    db.transaction((tx) => {
      tx.run(
        `INSERT INTO metal_paper_orders (id, user_id, idempotency_key, symbol, side, order_type, quantity_grams,
         limit_price_per_gram, status, quote_provider, quote_timestamp, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
        id, user.id, idempotencyKey, symbol, side, orderType, quantityGrams,
        orderType === 'LIMIT' ? referencePrice : null, String(quote.provider || ''), String(quote.priceTimestamp || quote.timestamp || ''), now, now,
      );
      if (orderType === 'LIMIT' && side === 'BUY') {
        tx.run('UPDATE metal_paper_accounts SET reserved_cash = reserved_cash + ?, updated_at = ? WHERE user_id = ?', requiredCash, now, user.id);
      }
      if (orderType === 'LIMIT' && side === 'SELL') {
        tx.run('UPDATE metal_paper_holdings SET reserved_grams = reserved_grams + ?, updated_at = ? WHERE user_id = ? AND symbol = ?', quantityGrams, now, user.id, symbol);
      }
    });

    let order = db.get('SELECT * FROM metal_paper_orders WHERE id = ?', id);
    if (orderType === 'MARKET') {
      try {
        order = fillOrder(db, id, marketPrice, quote);
        sendFillNotification(order);
      } catch (error) {
        db.run("UPDATE metal_paper_orders SET status = 'REJECTED', reject_reason = ?, updated_at = ? WHERE id = ?", error.message, new Date().toISOString(), id);
        return fail(res, 409, error.message, 'paper_order_rejected');
      }
    }
    return res.status(201).json({ order: publicOrder(order), charges, ...tradingState(db, user.id) });
  });

  app.delete('/api/metals/paper/orders/:id', (req, res) => {
    const user = authenticate(req);
    if (!user) return fail(res, 401, 'Sign in to cancel metals paper orders.', 'not_authenticated');
    const db = getDatabase();
    const order = db.get('SELECT * FROM metal_paper_orders WHERE id = ? AND user_id = ?', String(req.params.id), user.id);
    if (!order) return fail(res, 404, 'Paper order was not found.', 'paper_order_not_found');
    if (order.status !== 'PENDING') return fail(res, 409, 'Only pending paper orders can be cancelled.', 'paper_order_not_pending');
    releaseReservation(db, order);
    return res.json({ ok: true, ...tradingState(db, user.id) });
  });
};

export const startMetalPaperOrderMatcher = ({ getQuote, intervalMs = 3_000 }) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const db = getDatabase();
      const pending = db.query("SELECT * FROM metal_paper_orders WHERE status = 'PENDING' AND order_type = 'LIMIT' ORDER BY created_at LIMIT 200");
      const symbols = [...new Set(pending.map((order) => order.symbol))];
      const quotes = new Map();
      await Promise.all(symbols.map(async (symbol) => {
        try { quotes.set(symbol, await getQuote(symbol)); } catch { /* wait for the next verified quote */ }
      }));
      for (const order of pending) {
        const quote = quotes.get(order.symbol);
        const price = verifiedPricePerGram(quote);
        if (price === null) continue;
        const matches = order.side === 'BUY' ? price <= order.limit_price_per_gram : price >= order.limit_price_per_gram;
        if (!matches) continue;
        try { sendFillNotification(fillOrder(db, order.id, price, quote)); } catch { /* reservations remain for a later valid match */ }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
