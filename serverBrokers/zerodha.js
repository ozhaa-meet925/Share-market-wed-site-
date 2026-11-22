import crypto from 'node:crypto';
import { BrokerError, createRateLimiter, requestJson } from './http.js';

const env = (key) => String(process.env[key] || '').trim();

const publicConfig = () => {
  const apiKey = env('ZERODHA_API_KEY');
  const apiSecret = env('ZERODHA_API_SECRET');
  const mode = ['paper', 'sandbox', 'live'].includes(env('ZERODHA_TRADING_MODE')) ? env('ZERODHA_TRADING_MODE') : 'paper';
  return {
    configured: Boolean(apiKey && apiSecret),
    apiKey,
    hasSecret: Boolean(apiSecret),
    mode,
    sandboxBaseUrl: env('ZERODHA_SANDBOX_BASE_URL') || null,
    missing: [!apiKey && 'ZERODHA_API_KEY', !apiSecret && 'ZERODHA_API_SECRET'].filter(Boolean),
  };
};

const unwrap = (payload) => {
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data;
  return payload;
};

export const createZerodhaAdapter = () => {
  const limiter = createRateLimiter({ maxPerSecond: Number(env('ZERODHA_MAX_RPS')) || 8 });
  const apiBase = () => env('ZERODHA_BASE_URL') || 'https://api.kite.trade';
  const tradeBase = () => (publicConfig().mode === 'sandbox' ? publicConfig().sandboxBaseUrl : apiBase());

  const headers = (token) => {
    const config = publicConfig();
    return {
      Authorization: `token ${config.apiKey}:${token}`,
      'X-Kite-Version': '3',
    };
  };

  const call = (path, { method = 'GET', token, params, data, base = tradeBase(), retries, idempotent } = {}) => {
    if (!base) {
      throw new BrokerError({
        broker: 'zerodha',
        code: 'sandbox_not_configured',
        status: 400,
        message: 'Zerodha has no official sandbox. Set ZERODHA_SANDBOX_BASE_URL to an isolated mock base or use controlled live testing.',
      });
    }
    return requestJson({
      broker: 'zerodha',
      method,
      url: `${base}${path}`,
      headers: headers(token),
      params,
      data: data instanceof URLSearchParams ? data : data ? new URLSearchParams(
        Object.entries(data).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]),
      ) : undefined,
      limiter,
      retries,
      idempotent,
    });
  };

  const adapter = {
    id: 'zerodha',
    name: 'Zerodha Kite Connect',
    docsUrl: 'https://kite.trade/docs/connect/v3/',
    authType: 'oauth',
    config: publicConfig,
    capabilities() {
      const config = publicConfig();
      return {
        profile: true,
        funds: true,
        instruments: {
          supported: false,
          reason: 'Instrument master download is not bundled; supply the instrument token from the broker console.',
        },
        quotes: true,
        history: true,
        orders: true,
        orderUpdates: { supported: true, mechanism: 'REST polling plus signed postback endpoint' },
        gtt: {
          supported: false,
          reason: 'GTT endpoints are not wired; regular place, modify and cancel are available.',
        },
        marketDataFeed: {
          supported: false,
          reason: 'KiteTicker uses a binary WebSocket protocol; a decoder is not bundled, so REST quotes are used.',
        },
        orderPlacement: config.configured && config.mode !== 'paper' && (config.mode !== 'sandbox' || Boolean(config.sandboxBaseUrl)),
        sandbox: config.mode === 'sandbox' ? Boolean(config.sandboxBaseUrl) : false,
      };
    },
    isConfigured: () => publicConfig().configured,

    getLoginUrl(state) {
      const config = publicConfig();
      if (!config.configured) {
        throw new BrokerError({
          broker: 'zerodha',
          code: 'broker_not_configured',
          status: 400,
          message: `Zerodha Kite Connect is not configured. Missing: ${config.missing.join(', ')}.`,
        });
      }
      const url = new URL('https://kite.zerodha.com/connect/login');
      url.searchParams.set('v', '3');
      url.searchParams.set('api_key', config.apiKey);
      url.searchParams.set('redirect_params', `state=${encodeURIComponent(state)}`);
      return url.toString();
    },

    async exchangeCode(requestToken, { state } = {}) {
      const config = publicConfig();
      if (!config.configured) {
        throw new BrokerError({ broker: 'zerodha', code: 'broker_not_configured', status: 400, message: 'Zerodha Kite Connect is not configured.' });
      }
      const checksum = crypto.createHash('sha256').update(config.apiKey + requestToken + config.apiSecret).digest('hex');
      const { payload } = await requestJson({
        broker: 'zerodha',
        method: 'POST',
        url: `${apiBase()}/session/token`,
        data: new URLSearchParams({ api_key: config.apiKey, request_token: requestToken, checksum }),
        limiter,
        idempotent: false,
      });
      const data = unwrap(payload);
      if (!data?.access_token) {
        throw new BrokerError({ broker: 'zerodha', code: 'token_exchange_failed', status: 502, message: 'Zerodha did not return an access token.' });
      }
      return {
        accessToken: data.access_token,
        refreshToken: null,
        userId: data.user_id || null,
        userName: data.user_name || null,
        expiresInSeconds: null,
        state,
      };
    },

    async getProfile(token) {
      const { payload } = await call('/user/profile', { token });
      return unwrap(payload);
    },

    async getFunds(token) {
      const { payload } = await call('/user/margins', { token });
      return unwrap(payload);
    },

    async getHoldings(token) {
      const { payload } = await call('/portfolio/holdings', { token });
      return unwrap(payload) || [];
    },

    async getPositions(token) {
      const { payload } = await call('/portfolio/positions', { token });
      return unwrap(payload) || { net: [], day: [] };
    },

    async getOrders(token) {
      const { payload } = await call('/orders', { token });
      return unwrap(payload) || [];
    },

    async getTrades(token) {
      const { payload } = await call('/trades', { token });
      return unwrap(payload) || [];
    },

    async getQuotes(token, instruments = []) {
      if (!instruments.length) return {};
      const { payload } = await call('/quote', {
        token,
        params: { i: instruments },
      });
      const data = unwrap(payload) || {};
      return Object.fromEntries(Object.entries(data).map(([key, quote]) => [key, {
        instrument: key,
        lastPrice: Number(quote?.last_price),
        at: quote?.timestamp || null,
        volume: quote?.volume ?? null,
      }]));
    },

    async getHistory(token, { instrumentToken, interval = 'day', from, to }) {
      if (!instrumentToken) {
        throw new BrokerError({ broker: 'zerodha', code: 'invalid_instrument', status: 400, message: 'A Zerodha instrument token is required.' });
      }
      const { payload } = await call(`/instruments/historical/${encodeURIComponent(instrumentToken)}/${encodeURIComponent(interval)}`, {
        token,
        params: { from, to },
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
      }));
    },

    async placeOrder(token, order) {
      const config = publicConfig();
      if (config.mode === 'paper') {
        throw new BrokerError({ broker: 'zerodha', code: 'live_trading_disabled', status: 403, message: 'Zerodha trading mode is paper; no order was sent.' });
      }
      if (config.mode === 'sandbox' && !config.sandboxBaseUrl) {
        throw new BrokerError({ broker: 'zerodha', code: 'sandbox_not_configured', status: 400, message: 'Zerodha has no official sandbox; set ZERODHA_SANDBOX_BASE_URL to an isolated mock base before sandbox orders.' });
      }
      const variety = order.variety || 'regular';
      const { payload } = await call(`/orders/${variety}`, {
        method: 'POST',
        token,
        idempotent: false,
        data: {
          tradingsymbol: order.tradingsymbol,
          exchange: order.exchange || 'NSE',
          transaction_type: order.side,
          order_type: order.orderType || 'MARKET',
          quantity: Number(order.quantity),
          product: order.product || 'CNC',
          validity: order.validity || 'DAY',
          price: Number(order.price) || undefined,
          trigger_price: Number(order.triggerPrice) || undefined,
          disclosed_quantity: Number(order.disclosedQuantity) || undefined,
          tag: order.tag || undefined,
        },
      });
      return { brokerOrderId: unwrap(payload)?.order_id || null, raw: unwrap(payload) };
    },

    async modifyOrder(token, orderId, patch) {
      const variety = patch.variety || 'regular';
      const { payload } = await call(`/orders/${variety}/${encodeURIComponent(orderId)}`, {
        method: 'PUT',
        token,
        idempotent: false,
        data: {
          quantity: patch.quantity,
          price: patch.price,
          order_type: patch.orderType,
          trigger_price: patch.triggerPrice,
          validity: patch.validity,
        },
      });
      return { brokerOrderId: unwrap(payload)?.order_id || orderId, raw: unwrap(payload) };
    },

    async cancelOrder(token, orderId, { variety = 'regular' } = {}) {
      const { payload } = await call(`/orders/${variety}/${encodeURIComponent(orderId)}`, {
        method: 'DELETE',
        token,
        idempotent: false,
      });
      return { brokerOrderId: unwrap(payload)?.order_id || orderId, raw: unwrap(payload) };
    },
  };

  return adapter;
};
