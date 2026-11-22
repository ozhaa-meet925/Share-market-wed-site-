export class BrokerError extends Error {
  constructor({ broker, code, message, status = 502, retryable = false, detail = null }) {
    super(message);
    this.name = 'BrokerError';
    this.broker = broker;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createRateLimiter = ({ maxPerSecond = 8 } = {}) => {
  const stamps = [];
  return async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 1000) stamps.shift();
      if (stamps.length < maxPerSecond) {
        stamps.push(now);
        return;
      }
      await sleep(Math.max(20, 1000 - (now - stamps[0])));
    }
  };
};

const parseBody = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
};

const errorMessage = (payload, fallback) => {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload.slice(0, 300);
  return payload.message
    || payload.error?.message
    || payload.errors?.[0]?.message
    || payload.error_description
    || payload.error
    || fallback;
};

export const requestJson = async ({
  broker,
  method = 'GET',
  url,
  headers = {},
  params,
  data,
  timeoutMs = 15_000,
  retries = 2,
  limiter,
  idempotent = method === 'GET',
  expectJson = true,
}) => {
  const target = new URL(url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null && item !== '') target.searchParams.append(key, String(item));
        }
      } else if (value !== undefined && value !== null && value !== '') {
        target.searchParams.set(key, String(value));
      }
    }
  }

  let attempt = 0;
  for (;;) {
    attempt += 1;
    await limiter?.();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init = { method, headers: { Accept: 'application/json', ...headers }, signal: controller.signal };
      if (data !== undefined && data !== null) {
        if (data instanceof URLSearchParams) {
          init.body = data.toString();
          init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else {
          init.body = JSON.stringify(data);
          init.headers['Content-Type'] = 'application/json';
        }
      }
      const response = await fetch(target, init);
      const text = await response.text();
      const payload = parseBody(text);
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && idempotent && attempt <= retries) {
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 300 * attempt;
          await sleep(waitMs);
          continue;
        }
        throw new BrokerError({
          broker,
          status: response.status,
          code: response.status === 401 ? 'token_invalid' : response.status === 429 ? 'rate_limited' : 'broker_error',
          message: errorMessage(payload, `${broker} rejected the request (HTTP ${response.status}).`),
          retryable,
          detail: typeof payload === 'object' ? payload : null,
        });
      }
      if (expectJson && typeof payload === 'string') {
        throw new BrokerError({ broker, code: 'invalid_response', message: `${broker} returned a non-JSON response.` });
      }
      return { payload, status: response.status, headers: response.headers };
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      if (attempt <= retries && idempotent) {
        await sleep(300 * attempt);
        continue;
      }
      const timedOut = error.name === 'AbortError';
      throw new BrokerError({
        broker,
        code: timedOut ? 'timeout' : 'network_error',
        message: timedOut ? `${broker} did not respond in time.` : `${broker} is unreachable (${error.message}).`,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }
};
