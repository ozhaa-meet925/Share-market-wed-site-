import { BrokerError, createRateLimiter, requestJson } from './http.js';

const env = (key) => String(process.env[key] || '').trim();

const publicConfig = () => {
  const clientId = env('UPSTOX_CLIENT_ID');
  const clientSecret = env('UPSTOX_CLIENT_SECRET');
  const redirectUri = env('UPSTOX_REDIRECT_URI');
  const mode = ['paper', 'sandbox', 'live'].includes(env('UPSTOX_TRADING_MODE')) ? env('UPSTOX_TRADING_MODE') : 'paper';
  const configured = Boolean(clientId && clientSecret && redirectUri);
  return {
    configured,
    clientId,
    hasSecret: Boolean(clientSecret),
    redirectUri,
    mode,
    missing: [
      !clientId && 'UPSTOX_CLIENT_ID',
      !clientSecret && 'UPSTOX_CLIENT_SECRET',
      !redirectUri && 'UPSTOX_REDIRECT_URI',
    ].filter(Boolean),
  };
};

const unwrap = (payload) => {
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data;
  return payload;
};

export const createUpstoxAdapter = () => {
  const limiter = createRateLimiter({ maxPerSecond: Number(env('UPSTOX_MAX_RPS')) || 8 });
  const apiBase = () => env('UPSTOX_API_BASE') || 'https://api.upstox.com/v2';
  const v3Base = () => env('UPSTOX_V3_BASE') || 'https://api.upstox.com/v3';
  const sandboxBase = () => env('UPSTOX_SANDBOX_API_BASE');
  const tradeBase = () => (publicConfig().mode === 'sandbox' ? sandboxBase() : apiBase());

  const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

  const call = (path, { method = 'GET', token, data, params, base = tradeBase(), retries, idempotent } = {}) => {
    if (!base) {
      throw new BrokerError({
        broker: 'upstox',
        code: 'sandbox_not_configured',
        status: 400,
        message: 'Upstox sandbox mode is selected but UPSTOX_SANDBOX_API_BASE is not set.',
      });
    }
    return requestJson({
      broker: 'upstox',
      method,
      url: `${base}${path}`,
      headers: token ? authHeaders(token) : {},
      data,
      params,
      limiter,
      retries,
      idempotent,
    });
  };

  const adapter = {
    id: 'upstox',
    name: 'Upstox',
    docsUrl: 'https://upstox.com/developer/api-documentation/',
    authType: 'oauth',
    config: publicConfig,
    capabilities() {
      const config = publicConfig();
      return {
        profile: true,
        funds: true,
        instruments: {
          supported: false,
          reason: 'Instrument master download is not bundled; supply the instrument key from the broker console.',
        },
        quotes: true,
        history: true,
        orders: true,
        orderUpdates: { supported: true, mechanism: 'REST polling and portfolio stream (feed decoder not bundled)' },
        marketDataFeed: {
          supported: false,
          reason: 'Upstox Market Data Feed V3 uses a protobuf binary protocol; a decoder is not bundled, so REST quotes are used.',
        },
        orderPlacement: config.configured && config.mode !== 'paper' && (config.mode !== 'sandbox' || Boolean(sandboxBase())),
      };
    },
    isConfigured: () => publicConfig().configured,

    getLoginUrl(state) {
      const config = publicConfig();
      if (!config.configured) {
        throw new BrokerError({
          broker: 'upstox',
          code: 'broker_not_configured',
          status: 400,
          message: `Upstox OAuth is not configured. Missing: ${config.missing.join(', ')}.`,
        });
      }
      const url = new URL('https://api.upstox.com/v2/login/authorization/dialog');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchangeCode(code) {
      const config = publicConfig();
      if (!config.configured) {
        throw new BrokerError({ broker: 'upstox', code: 'broker_not_configured', status: 400, message: 'Upstox OAuth is not configured.' });
      }
      const { payload } = await requestJson({
        broker: 'upstox',
        method: 'POST',
        url: `${apiBase()}/login/authorization/token`,
        data: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
        }),
        limiter,
        idempotent: false,
      });
      if (!payload?.access_token) {
        throw new BrokerError({ broker: 'upstox', code: 'token_exchange_failed', status: 502, message: 'Upstox did not return an access token.' });
      }
      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token || null,
        userId: payload.user_id || null,
        expiresInSeconds: Number(payload.expires_in) || null,
      };
    },

    async refreshAccessToken(refreshToken) {
      const config = publicConfig();
      if (!config.configured) {
        throw new BrokerError({ broker: 'upstox', code: 'broker_not_configured', status: 400, message: 'Upstox OAuth is not configured.' });
      }
      const { payload } = await requestJson({
        broker: 'upstox',
        method: 'POST',
        url: `${apiBase()}/login/authorization/token`,
        data: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
        }),
        limiter,
        idempotent: false,
      });
      if (!payload?.access_token) {
        throw new BrokerError({ broker: 'upstox', code: 'refresh_failed', status: 502, message: 'Upstox did not return a refreshed access token.' });
      }
      return { accessToken: payload.access_token, refreshToken: payload.refresh_token || refreshToken, expiresInSeconds: Number(payload.expires_in) || null };
    },

    async getProfile(token) {
      const { payload } = await call('/user/profile', { token });
      return unwrap(payload);
    },

    async getFunds(token) {
      const { payload } = await call('/user/get-funds-and-margin', { token });
      return unwrap(payload);
    },

    async getHoldings(token) {
      const { payload } = await call('/portfolio/long-term-holdings', { token });
      return unwrap(payload) || [];
    },

    async getPositions(token) {
      const { payload } = await call('/portfolio/short-term-positions', { token });
      return unwrap(payload) || [];
    },

    async getOrders(token) {
      const { payload } = await call('/order/retrieve-all', { token });
      return unwrap(payload) || [];
    },

    async getTrades(token) {
      const { payload } = await call('/order/trades/get-trades-for-day', { token });
      return unwrap(payload) || [];
    },

    async getQuotes(token, instrumentKeys = []) {
      if (!instrumentKeys.length) return {};
      const unique = [...new Set(instrumentKeys)].slice(0, 500);
      const { payload } = await requestJson({
        broker: 'upstox',
        url: `${v3Base()}/market-quote/ltp`,
        params: { instrument_key: unique.join(',') },
        headers: authHeaders(token),
        limiter,
      });
      const data = unwrap(payload) || {};
      const quotes = {};
      for (const [key, quote] of Object.entries(data)) {
        quotes[key] = {
          instrumentKey: key,
          lastPrice: Number(quote?.last_price),
          at: quote?.last_trade_time || null,
        };
      }
      return quotes;
    },

    async getHistory(token, { instrumentKey, unit = 'minutes', interval = 1, toDate }) {
      if (!instrumentKey) {
        throw new BrokerError({ broker: 'upstox', code: 'invalid_instrument', status: 400, message: 'An Upstox instrument key is required.' });
      }
      const date = toDate || new Date().toISOString().slice(0, 10);
      const { payload } = await requestJson({
        broker: 'upstox',
        url: `${v3Base()}/historical-candle/${encodeURIComponent(instrumentKey)}/${encodeURIComponent(unit)}/${encodeURIComponent(interval)}/${encodeURIComponent(date)}`,
        headers: authHeaders(token),
        limiter,
      });
      const candles = unwrap(payload)?.candles || [];
      return candles.map((candle) => ({
        at: candle[0],
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5]),
        openInterest: candle[6] ?? null,
      })).reverse();
    },

    async placeOrder(token, order) {
      const config = publicConfig();
      if (config.mode === 'paper') {
        throw new BrokerError({ broker: 'upstox', code: 'live_trading_disabled', status: 403, message: 'Upstox trading mode is paper; no order was sent.' });
      }
      if (config.mode === 'sandbox' && !sandboxBase()) {
        throw new BrokerError({ broker: 'upstox', code: 'sandbox_not_configured', status: 400, message: 'Set UPSTOX_SANDBOX_API_BASE before placing sandbox orders.' });
      }
      const { payload } = await call('/order/place', {
        method: 'POST',
        token,
        idempotent: false,
        data: {
          quantity: Number(order.quantity),
          product: order.product || 'D',
          validity: order.validity || 'DAY',
          price: Number(order.price) || 0,
          tag: order.tag || undefined,
          instrument_token: order.instrumentToken,
          order_type: order.orderType || 'MARKET',
          transaction_type: order.side,
          disclosed_quantity: 0,
          trigger_price: Number(order.triggerPrice) || 0,
          is_amo: Boolean(order.amo),
          slice: false,
        },
      });
      return { brokerOrderId: unwrap(payload)?.order_id || null, raw: unwrap(payload) };
    },

    async modifyOrder(token, orderId, patch) {
      const { payload } = await call('/order/modify', {
        method: 'PUT',
        token,
        idempotent: false,
        data: {
          order_id: orderId,
          quantity: patch.quantity,
          price: patch.price,
          order_type: patch.orderType,
          trigger_price: patch.triggerPrice,
          validity: patch.validity,
        },
      });
      return { brokerOrderId: unwrap(payload)?.order_id || orderId, raw: unwrap(payload) };
    },

    async cancelOrder(token, orderId) {
      const { payload } = await call('/order/cancel', {
        method: 'DELETE',
        token,
        params: { order_id: orderId },
        idempotent: false,
      });
      return { brokerOrderId: unwrap(payload)?.order_id || orderId, raw: unwrap(payload) };
    },
  };

  return adapter;
};
