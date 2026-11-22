import crypto from 'node:crypto';
import { getAdapter, listAdapters, liveTradingMasterEnabled } from './serverBrokers/index.js';
import {
  brokerStateKey,
  disconnectBrokerAccount,
  getBrokerAccount,
  recordProbe,
  saveBrokerAccount,
  setLiveConsent,
  syncUser,
} from './serverBrokerStore.js';
import { getDatabase } from './serverDb.js';
import { readSessionUser } from './serverAuth.js';
import { recordAudit } from './serverCoreAudit.js';
import { authorizeLiveOrder } from './serverRiskShield.js';
import { getPaperAccount } from './serverAutoTrade.js';
import { notify } from './serverNotifications.js';
import { brokerReconcilerStatus, reconcileAccountOrders, startBrokerReconciler } from './serverBrokerReconcile.js';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const oauthStates = new Map();

const fail = (res, status, message, code, extra = {}) => res.status(status).json({ error: message, code, ...extra });

const requireUser = (req, res) => {
  const user = readSessionUser(req);
  if (!user) {
    fail(res, 401, 'Please sign in to continue.', 'not_authenticated');
    return null;
  }
  syncUser(user);
  return user;
};

const actorFor = (user, name) => ({ id: user.id, role: user.role || 'trader', name: name || user.name || 'User' });

const signState = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', brokerStateKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
};

const verifyState = (value) => {
  const [body, mac] = String(value || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', brokerStateKey()).update(body).digest('base64url');
  const macBuffer = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expected);
  if (macBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(macBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.nonce || payload.expiresAt < Date.now()) return null;
    const stored = oauthStates.get(payload.nonce);
    if (!stored) return null;
    oauthStates.delete(payload.nonce);
    return stored;
  } catch {
    return null;
  }
};

const errorPayload = (error) => ({
  message: error.message || 'The broker request failed.',
  code: error.code || 'broker_request_failed',
  status: error.status || 502,
  broker: error.broker || null,
  retryable: Boolean(error.retryable),
});

const withAccount = (req, res, brokerId) => {
  const user = requireUser(req, res);
  if (!user) return null;
  const adapter = getAdapter(brokerId);
  if (!adapter) {
    fail(res, 404, `Unknown broker: ${brokerId}.`, 'unknown_broker');
    return null;
  }
  const account = getBrokerAccount(user.id, adapter.id);
  if (!account || !account.accessToken) {
    return { user, adapter, account: null, response: res.status(409).json({ error: `${adapter.name} is not connected.`, code: 'broker_not_connected', broker: adapter.id }) };
  }
  if (account.tokenError) {
    return { user, adapter, account: null, response: res.status(409).json({ error: `Stored ${adapter.name} token could not be decrypted: ${account.tokenError}`, code: 'token_unreadable', broker: adapter.id }) };
  }
  return { user, adapter, account };
};

const publicConnection = (user, adapter) => {
  const account = getBrokerAccount(user.id, adapter.id);
  const config = adapter.config();
  return {
    connected: Boolean(account?.accessToken),
    configured: config.configured,
    missing: config.missing || [],
    mode: config.mode,
    liveAuthorized: Boolean(account?.liveAuthorized),
    tokenExpiresAt: account?.tokenExpiresAt || null,
    lastProbeAt: account?.lastProbeAt || null,
    lastProbeStatus: account?.lastProbeStatus || null,
    lastError: account?.lastError || null,
    externalUserId: account?.clientId || null,
  };
};

const UNCERTAIN_BROKER_ERRORS = new Set(['timeout', 'network_error', 'invalid_response']);

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

const livePreflight = async ({ user, adapter, account, side, quantity, symbol, instrumentToken, price }) => {
  const paper = getPaperAccount(user.id);
  const riskSettings = paper?.risk || {};
  let quote = null;
  let quoteAgeSeconds = null;
  try {
    const key = instrumentToken || symbol;
    if (key) {
      const quotes = await adapter.getQuotes(account.accessToken, [key]);
      const first = Object.values(quotes || {})[0];
      if (Number(first?.lastPrice) > 0) {
        quote = first;
        const atMs = first.at ? Date.parse(first.at) : NaN;
        if (Number.isFinite(atMs)) quoteAgeSeconds = Math.max(0, Math.round((Date.now() - atMs) / 1000));
      }
    }
  } catch {
    quote = null;
  }

  let brokerFunds = null;
  if (side === 'BUY') {
    try {
      const availableCash = availableCashOf(adapter.id, await adapter.getFunds(account.accessToken));
      if (availableCash !== null) brokerFunds = { availableCash };
    } catch {
      brokerFunds = null;
    }
  }

  const db = getDatabase();
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const todayLiveOrders = Number(db.get(
    "SELECT COUNT(*) AS count FROM orders WHERE user_id = ? AND mode = 'live' AND created_at >= ? AND status NOT IN ('rejected', 'cancelled')",
    user.id, dayStart,
  )?.count || 0);
  const duplicateSymbol = Boolean(db.get(
    "SELECT id FROM orders WHERE user_id = ? AND mode = 'live' AND symbol = ? AND status IN ('pending', 'submitted', 'partially_filled', 'unverified')",
    user.id, symbol,
  ));

  const quotePrice = Number(quote?.lastPrice) || 0;
  const limitPrice = Number(price) || 0;
  const referencePrice = side === 'BUY' ? Math.max(quotePrice, limitPrice) : (quotePrice || limitPrice);
  const decision = authorizeLiveOrder({
    userId: user.id,
    broker: adapter.id,
    symbol,
    side,
    quantity,
    price: referencePrice,
    quoteAgeSeconds,
    brokerFunds,
    riskSettings,
    todayLiveOrders,
    duplicateSymbol,
    marketOpen: await marketSessionOpen(),
    actor: actorFor(user, 'Risk Shield'),
  });
  return { decision, quote, brokerFunds, referencePrice };
};

export const registerBrokerRoutes = (app, { getMarketSession = async () => null } = {}) => {
  startBrokerReconciler();

  const readMarketSession = async () => {
    try {
      return await getMarketSession();
    } catch (error) {
      console.error('[BrokerRoutes] Failed to verify the exchange session:', error.message || error);
      return null;
    }
  };
  const marketSessionOpen = async () => {
    const session = await readMarketSession();
    return session?.isVerified === true && session.isOpen === true;
  };

  app.get('/api/brokers', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    res.json({
      liveTradingEnabled: liveTradingMasterEnabled(),
      liveTradingRequirement: 'Live order routing needs LIVE_TRADING_ENABLED=1 on the server, an explicit per-account consent, and live:true on each order.',
      reconciliation: brokerReconcilerStatus(),
      brokers: listAdapters().map((adapter) => ({
        id: adapter.id,
        name: adapter.name,
        docsUrl: adapter.docsUrl,
        authType: adapter.authType,
        capabilities: adapter.capabilities(),
        connection: publicConnection(user, adapter),
      })),
    });
  });

  app.post('/api/brokers/:broker/probe', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { user, adapter, account } = ctx;
    const startedAt = Date.now();
    try {
      const profile = await adapter.getProfile(account.accessToken);
      recordProbe(user.id, adapter.id, { status: 'connected' });
      recordAudit({ actor: actorFor(user), action: 'broker.probe', resource: `broker:${adapter.id}`, detail: { status: 'connected', latencyMs: Date.now() - startedAt } });
      res.json({ connected: true, status: 'connected', latencyMs: Date.now() - startedAt, profile });
    } catch (error) {
      const payload = errorPayload(error);
      const status = payload.code === 'token_invalid' ? 'token_invalid' : 'error';
      recordProbe(user.id, adapter.id, { status, message: payload.message });
      recordAudit({ actor: actorFor(user), action: 'broker.probe', resource: `broker:${adapter.id}`, detail: { status, code: payload.code } });
      res.status(payload.status >= 400 && payload.status < 500 ? 409 : 502).json({ connected: false, status, ...payload });
    }
  });

  for (const adapter of listAdapters()) {
    app.get(`/api/brokers/${adapter.id}/login-url`, (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;
      try {
        const nonce = crypto.randomUUID();
        const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
        oauthStates.set(nonce, { userId: user.id, broker: adapter.id, expiresAt });
        const state = signState({ nonce, broker: adapter.id, userId: user.id, expiresAt });
        res.json({ url: adapter.getLoginUrl(state), expiresInSeconds: OAUTH_STATE_TTL_MS / 1000 });
      } catch (error) {
        const payload = errorPayload(error);
        res.status(payload.status >= 400 && payload.status < 500 ? payload.status : 502).json(payload);
      }
    });
  }

  app.get('/api/brokers/:broker/callback', async (req, res) => {
    const adapter = getAdapter(req.params.broker);
    const redirect = (params) => res.redirect(`/broker-connections?${new URLSearchParams(params).toString()}`);
    if (!adapter) return redirect({ error: 'unknown_broker' });
    const stored = verifyState(req.query.state);
    const user = readSessionUser(req);
    if (!stored || !user || stored.userId !== user.id || stored.broker !== adapter.id) {
      return redirect({ error: 'oauth_state_invalid' });
    }
    try {
      syncUser(user);
      const code = String(req.query.code || req.query.request_token || '');
      if (!code) throw new Error('The broker did not return an authorization code.');
      const tokens = await adapter.exchangeCode(code);
      saveBrokerAccount({
        userId: user.id,
        broker: adapter.id,
        clientId: tokens.userId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresInSeconds: tokens.expiresInSeconds,
        mode: adapter.config().mode,
      });
      recordAudit({ actor: actorFor(user), action: 'broker.connected', resource: `broker:${adapter.id}`, detail: { mode: adapter.config().mode } });
      return redirect({ connected: adapter.id });
    } catch (error) {
      recordAudit({ actor: actorFor(user), action: 'broker.connect_failed', resource: `broker:${adapter.id}`, detail: { code: error.code || 'broker_error' } });
      return redirect({ error: error.code || 'broker_connect_failed' });
    }
  });

  app.post('/api/brokers/:broker/disconnect', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const adapter = getAdapter(req.params.broker);
    if (!adapter) return fail(res, 404, `Unknown broker: ${req.params.broker}.`, 'unknown_broker');
    const removed = disconnectBrokerAccount(user.id, adapter.id);
    if (!removed) return fail(res, 404, 'No stored connection to remove.', 'broker_not_connected');
    recordAudit({ actor: actorFor(user), action: 'broker.disconnected', resource: `broker:${adapter.id}` });
    res.json({ ok: true });
  });

  app.get('/api/brokers/:broker/account', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { adapter, account } = ctx;
    const results = await Promise.allSettled([adapter.getProfile(account.accessToken), adapter.getFunds(account.accessToken)]);
    const [profile, funds] = results;
    if (profile.status === 'rejected' && funds.status === 'rejected') {
      const payload = errorPayload(profile.reason);
      return res.status(502).json(payload);
    }
    recordProbe(ctx.user.id, adapter.id, { status: 'connected' });
    res.json({
      profile: profile.status === 'fulfilled' ? profile.value : null,
      funds: funds.status === 'fulfilled' ? funds.value : null,
      errors: results.filter((result) => result.status === 'rejected').map((result) => errorPayload(result.reason).message),
    });
  });

  app.get('/api/brokers/:broker/portfolio', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { adapter, account } = ctx;
    const results = await Promise.allSettled([adapter.getHoldings(account.accessToken), adapter.getPositions(account.accessToken)]);
    if (results.every((result) => result.status === 'rejected')) {
      return res.status(502).json(errorPayload(results[0].reason));
    }
    res.json({
      holdings: results[0].status === 'fulfilled' ? results[0].value : [],
      positions: results[1].status === 'fulfilled' ? results[1].value : [],
      errors: results.filter((result) => result.status === 'rejected').map((result) => errorPayload(result.reason).message),
    });
  });

  app.get('/api/brokers/:broker/orders', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { user, adapter, account } = ctx;
    const results = await Promise.allSettled([adapter.getOrders(account.accessToken), adapter.getTrades(account.accessToken)]);
    if (results.every((result) => result.status === 'rejected')) {
      return res.status(502).json(errorPayload(results[0].reason));
    }
    let reconciliation = null;
    if (results[0].status === 'fulfilled') {
      reconciliation = await reconcileAccountOrders({
        userId: user.id,
        broker: adapter.id,
        accessToken: account.accessToken,
        adapter,
        orderBook: results[0].value,
      }).catch(() => null);
    }
    res.json({
      orders: results[0].status === 'fulfilled' ? results[0].value : [],
      trades: results[1].status === 'fulfilled' ? results[1].value : [],
      errors: results.filter((result) => result.status === 'rejected').map((result) => errorPayload(result.reason).message),
      reconciliation: reconciliation ? { checked: reconciliation.checked, updated: reconciliation.updated } : null,
    });
  });

  app.post('/api/brokers/:broker/reconcile', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { user, adapter } = ctx;
    const result = await reconcileAccountOrders({ userId: user.id, broker: adapter.id, adapter }).catch(() => null);
    if (!result) return fail(res, 502, 'The broker order book could not be read for reconciliation.', 'reconcile_unavailable');
    res.json({ ...result, monitor: brokerReconcilerStatus() });
  });

  app.get('/api/brokers/:broker/quotes', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { adapter, account } = ctx;
    const instruments = String(req.query.instruments || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 100);
    if (!instruments.length) return fail(res, 400, 'Provide at least one instrument key.', 'invalid_instruments');
    try {
      res.json({ quotes: await adapter.getQuotes(account.accessToken, instruments), source: 'broker_rest' });
    } catch (error) {
      res.status(502).json(errorPayload(error));
    }
  });

  app.get('/api/brokers/:broker/history', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { adapter, account } = ctx;
    try {
      const candles = await adapter.getHistory(account.accessToken, {
        instrumentKey: req.query.instrumentKey,
        instrumentToken: req.query.instrumentToken,
        unit: req.query.unit,
        interval: req.query.interval,
        from: req.query.from,
        to: req.query.to,
        toDate: req.query.toDate,
      });
      res.json({ candles, source: 'broker_rest' });
    } catch (error) {
      res.status(502).json(errorPayload(error));
    }
  });

  app.post('/api/brokers/:broker/live-consent', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const adapter = getAdapter(req.params.broker);
    if (!adapter) return fail(res, 404, `Unknown broker: ${req.params.broker}.`, 'unknown_broker');
    const enabled = req.body?.enabled === true;
    if (enabled && String(req.body?.confirmation || '') !== 'ENABLE LIVE TRADING') {
      return fail(res, 400, 'Type ENABLE LIVE TRADING exactly to confirm.', 'confirmation_required');
    }
    if (enabled && !liveTradingMasterEnabled()) {
      return fail(res, 403, 'Live trading is disabled on this server. Set LIVE_TRADING_ENABLED=1 only after authorization and testing.', 'live_trading_disabled');
    }
    const account = getBrokerAccount(user.id, adapter.id);
    if (!account) return fail(res, 409, `${adapter.name} is not connected.`, 'broker_not_connected');
    const updated = setLiveConsent(user.id, adapter.id, enabled);
    recordAudit({ actor: actorFor(user), action: enabled ? 'broker.live_consent_granted' : 'broker.live_consent_revoked', resource: `broker:${adapter.id}` });
    res.json({ liveAuthorized: updated.liveAuthorized, liveAuthorizedAt: updated.liveAuthorizedAt });
  });

  app.post('/api/brokers/:broker/orders', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { user, adapter, account } = ctx;

    if (!liveTradingMasterEnabled()) {
      return fail(res, 403, 'Live broker orders are disabled on this server. Paper trading remains available.', 'live_trading_disabled');
    }
    if (!account.liveAuthorized) {
      return fail(res, 403, 'Enable live trading consent for this broker account before placing orders.', 'live_consent_required');
    }
    if (req.body?.live !== true) {
      return fail(res, 400, 'Set live:true to confirm this is a live order.', 'live_confirmation_missing');
    }
    const marketSession = await readMarketSession();
    if (marketSession?.isVerified !== true) {
      return fail(res, 503, 'The official NSE trading calendar could not be verified; live orders are blocked.', 'market_status_unverified');
    }
    if (marketSession.isOpen !== true) {
      return fail(res, 409, 'The NSE session is closed; live orders are rejected.', 'market_closed');
    }

    const side = String(req.body?.side || '').toUpperCase();
    const quantity = Number(req.body?.quantity);
    const instrumentToken = String(req.body?.instrumentToken || '').trim();
    const tradingsymbol = String(req.body?.tradingsymbol || req.body?.symbol || '').trim().toUpperCase();
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
    if (!['BUY', 'SELL'].includes(side)) return fail(res, 400, 'Choose BUY or SELL.', 'invalid_side');
    if (!Number.isFinite(quantity) || quantity <= 0) return fail(res, 400, 'Enter a valid quantity.', 'invalid_quantity');
    if (!instrumentToken && !tradingsymbol) return fail(res, 400, 'Provide the broker instrument identifier.', 'invalid_instrument');
    if (!/^[\w:.\-]{6,}$/.test(idempotencyKey)) return fail(res, 400, 'Provide an idempotency key (6+ characters).', 'idempotency_key_required');

    const db = getDatabase();
    const existing = db.get('SELECT id, status, broker_order_id FROM orders WHERE idempotency_key = ?', idempotencyKey);
    if (existing) {
      return res.status(200).json({ deduplicated: true, orderId: existing.id, brokerOrderId: existing.broker_order_id, status: existing.status });
    }

    const orderSymbol = tradingsymbol || instrumentToken;
    const { decision, quote, brokerFunds } = await livePreflight({
      user,
      adapter,
      account,
      side,
      quantity,
      symbol: orderSymbol,
      instrumentToken,
      price: req.body?.price,
    });
    if (!decision.allowed) {
      notify({
        userId: user.id,
        category: 'risk',
        title: 'Live order blocked by Risk Shield',
        body: `${orderSymbol} ${side} ${quantity}: ${decision.reason}`,
        level: 'warning',
      });
      return fail(res, 403, `Risk Shield blocked this order: ${decision.reason}`, 'risk_blocked', {
        checks: decision.checks,
        decisionId: decision.id,
      });
    }

    const timestamp = new Date().toISOString();
    const orderId = `ORD-${crypto.randomUUID()}`;
    const mode = adapter.config().mode;
    try {
      db.transaction((tx) => {
        tx.run(
          `INSERT INTO orders (id, user_id, broker_account_id, idempotency_key, symbol, exchange, side, order_type, product, quantity, price, trigger_price, status, mode, created_at, updated_at, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
          orderId, user.id, account.id, idempotencyKey, orderSymbol, req.body?.exchange || 'NSE', side,
          String(req.body?.orderType || 'MARKET').toUpperCase(), String(req.body?.product || 'CNC').toUpperCase(), quantity,
          Number(req.body?.price) || null, Number(req.body?.triggerPrice) || null, mode, timestamp, timestamp, timestamp,
        );
        tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', orderId, 'pending',
          JSON.stringify({ channel: 'live', riskDecisionId: decision.id, quotePrice: quote?.lastPrice ?? null, brokerCash: brokerFunds?.availableCash ?? null }), timestamp);
      });

      const result = await adapter.placeOrder(account.accessToken, {
        instrumentToken,
        tradingsymbol,
        exchange: req.body?.exchange || 'NSE',
        side,
        quantity,
        price: Number(req.body?.price) || 0,
        triggerPrice: Number(req.body?.triggerPrice) || 0,
        orderType: String(req.body?.orderType || 'MARKET').toUpperCase(),
        product: String(req.body?.product || 'CNC').toUpperCase(),
        validity: req.body?.validity || 'DAY',
        tag: 'SMP',
      });

      db.transaction((tx) => {
        tx.run('UPDATE orders SET status = ?, broker_order_id = ?, updated_at = ? WHERE id = ?', 'submitted', result.brokerOrderId, new Date().toISOString(), orderId);
        tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', orderId, 'submitted', JSON.stringify({ brokerOrderId: result.brokerOrderId }), new Date().toISOString());
      });
      notify({
        userId: user.id,
        category: 'order',
        title: `${side} order submitted`,
        body: `${orderSymbol} × ${quantity} accepted by ${adapter.name} (${result.brokerOrderId}).`,
        level: 'info',
      });
      recordAudit({ actor: actorFor(user), action: 'order.sent_to_broker', resource: `order:${orderId}`, detail: { broker: adapter.id, mode, riskDecisionId: decision.id } });
      res.status(201).json({ orderId, brokerOrderId: result.brokerOrderId, status: 'submitted', mode });
    } catch (error) {
      const payload = errorPayload(error);
      const uncertain = UNCERTAIN_BROKER_ERRORS.has(payload.code);
      const status = uncertain ? 'unverified' : 'rejected';
      db.transaction((tx) => {
        tx.run('UPDATE orders SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?',
          status, uncertain ? null : payload.code, new Date().toISOString(), orderId);
        tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', orderId, status,
          JSON.stringify({ code: payload.code, message: payload.message, reconciliationRequired: uncertain }), new Date().toISOString());
      });
      if (uncertain) {
        notify({
          userId: user.id,
          category: 'order',
          title: 'Order status unconfirmed',
          body: `${orderSymbol} ${side} ${quantity}: ${payload.message} The order was not resubmitted and will be reconciled against the broker order book.`,
          level: 'warning',
        });
        recordAudit({ actor: actorFor(user), action: 'order.unverified', resource: `order:${orderId}`, outcome: 'failure', detail: { broker: adapter.id, code: payload.code } });
        return res.status(202).json({
          orderId,
          status,
          reconciliationRequired: true,
          message: 'The broker did not confirm the order. It was not resubmitted; reconciliation will verify the broker order book.',
          code: payload.code,
        });
      }
      notify({
        userId: user.id,
        category: 'order',
        title: 'Order rejected',
        body: `${orderSymbol} ${side} ${quantity}: ${payload.message}`,
        level: 'warning',
      });
      recordAudit({ actor: actorFor(user), action: 'order.rejected', resource: `order:${orderId}`, detail: { broker: adapter.id, code: payload.code } });
      res.status(payload.status >= 400 && payload.status < 500 ? 409 : 502).json({ ...payload, orderId, status: 'rejected' });
    }
  });

  app.post('/api/brokers/:broker/orders/:orderId/modify', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { user, adapter, account } = ctx;
    if (!liveTradingMasterEnabled() || !account.liveAuthorized) {
      return fail(res, 403, 'Live broker order changes are disabled for this account.', 'live_trading_disabled');
    }
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) return fail(res, 400, 'A broker order id is required.', 'invalid_order_id');

    const patch = {};
    if (req.body?.quantity !== undefined && req.body.quantity !== '') {
      const quantity = Number(req.body.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return fail(res, 400, 'Quantity must be greater than zero.', 'invalid_quantity');
      patch.quantity = quantity;
    }
    if (req.body?.price !== undefined && req.body.price !== '') {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price < 0) return fail(res, 400, 'Price must be zero or greater.', 'invalid_price');
      patch.price = price;
    }
    if (req.body?.triggerPrice !== undefined && req.body.triggerPrice !== '') {
      const triggerPrice = Number(req.body.triggerPrice);
      if (!Number.isFinite(triggerPrice) || triggerPrice < 0) return fail(res, 400, 'Trigger price must be zero or greater.', 'invalid_trigger_price');
      patch.triggerPrice = triggerPrice;
    }
    if (req.body?.orderType) patch.orderType = String(req.body.orderType).toUpperCase();
    if (req.body?.validity) patch.validity = String(req.body.validity).toUpperCase();
    if (req.body?.variety) patch.variety = String(req.body.variety);
    if (!['quantity', 'price', 'triggerPrice', 'orderType', 'validity'].some((key) => patch[key] !== undefined)) {
      return fail(res, 400, 'Provide at least one field to modify.', 'no_changes');
    }

    try {
      const result = await adapter.modifyOrder(account.accessToken, orderId, patch);
      const timestamp = new Date().toISOString();
      const order = getDatabase().get('SELECT id FROM orders WHERE broker_order_id = ? AND user_id = ?', orderId, user.id);
      if (order) {
        getDatabase().transaction((tx) => {
          const fields = [];
          const values = [];
          if (patch.quantity !== undefined) { fields.push('quantity = ?'); values.push(patch.quantity); }
          if (patch.price !== undefined) { fields.push('price = ?'); values.push(patch.price); }
          if (patch.triggerPrice !== undefined) { fields.push('trigger_price = ?'); values.push(patch.triggerPrice); }
          if (patch.orderType) { fields.push('order_type = ?'); values.push(patch.orderType); }
          fields.push('updated_at = ?');
          values.push(timestamp);
          tx.run(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, ...values, order.id);
          tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', order.id, 'modified',
            JSON.stringify({ broker: adapter.id, brokerOrderId: orderId, patch }), timestamp);
        });
      }
      recordAudit({ actor: actorFor(user), action: 'order.modify_requested', resource: `broker:${adapter.id}`, detail: { orderId, patch } });
      res.json({ ok: true, orderId, ...result });
    } catch (error) {
      const payload = errorPayload(error);
      const uncertain = UNCERTAIN_BROKER_ERRORS.has(payload.code);
      notify({
        userId: user.id,
        category: 'order',
        title: uncertain ? 'Order modification unconfirmed' : 'Order modification failed',
        body: `Order ${orderId}: ${payload.message}${uncertain ? ' The change was not retried; verify the broker order book.' : ''}`,
        level: 'warning',
      });
      recordAudit({
        actor: actorFor(user),
        action: uncertain ? 'order.modify_unverified' : 'order.modify_failed',
        resource: `broker:${adapter.id}`,
        outcome: 'failure',
        detail: { orderId, code: payload.code, patch },
      });
      if (uncertain) {
        return res.status(202).json({
          ...payload,
          orderId,
          status: 'unverified',
          reconciliationRequired: true,
          message: 'The broker did not confirm the modification. It was not retried; verify the broker order book.',
        });
      }
      res.status(payload.status >= 400 && payload.status < 500 ? 409 : 502).json({ ...payload, orderId });
    }
  });

  app.post('/api/brokers/:broker/orders/:orderId/cancel', async (req, res) => {
    const ctx = withAccount(req, res, req.params.broker);
    if (!ctx) return;
    if (ctx.response) return ctx.response;
    const { user, adapter, account } = ctx;
    if (!liveTradingMasterEnabled() || !account.liveAuthorized) {
      return fail(res, 403, 'Live broker orders are disabled for this account.', 'live_trading_disabled');
    }
    try {
      const result = await adapter.cancelOrder(account.accessToken, req.params.orderId, { variety: req.body?.variety });
      getDatabase().transaction((tx) => {
        const order = tx.get('SELECT id FROM orders WHERE broker_order_id = ? AND user_id = ?', req.params.orderId, user.id);
        if (order) {
          tx.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'cancelled', new Date().toISOString(), order.id);
          tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', order.id, 'cancelled', null, new Date().toISOString());
        }
      });
      recordAudit({ actor: actorFor(user), action: 'order.cancel_requested', resource: `broker:${adapter.id}`, detail: { orderId: req.params.orderId } });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(502).json(errorPayload(error));
    }
  });

  app.post('/api/brokers/zerodha/postback', (req, res) => {
    const expected = process.env.ZERODHA_POSTBACK_TOKEN;
    if (!expected) return fail(res, 503, 'Zerodha postbacks are not configured (ZERODHA_POSTBACK_TOKEN is unset).', 'postback_not_configured');
    const provided = String(req.query.token || '');
    if (!provided || provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return fail(res, 401, 'Invalid postback token.', 'invalid_postback_token');
    }
    const brokerOrderId = String(req.body?.order_id || '');
    if (!brokerOrderId) return fail(res, 400, 'Missing order_id.', 'invalid_postback');
    const db = getDatabase();
    const order = db.get('SELECT id FROM orders WHERE broker_order_id = ?', brokerOrderId);
    if (!order) return fail(res, 404, 'Unknown broker order.', 'order_not_found');
    const status = String(req.body?.status || 'update').toLowerCase();
    db.transaction((tx) => {
      tx.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), order.id);
      tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', order.id, status, JSON.stringify({ source: 'zerodha_postback' }), new Date().toISOString());
    });
    res.json({ ok: true });
  });
};
