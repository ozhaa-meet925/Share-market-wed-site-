import crypto from 'node:crypto';
import { getDatabase } from './serverDb.js';
import { readSessionUser } from './serverAuth.js';
import { syncUser } from './serverBrokerStore.js';
import { forecastFromDailyCandles } from './src/utils/marketForecast.js';

const SYMBOL_PATTERN = /^[A-Z0-9&.\-]{1,20}$/;
const DEFAULT_HORIZON = 5;
const MAX_HORIZON = 30;
const MAX_LIST = 100;

const fail = (res, status, message, code) => res.status(status).json({ error: message, code });

const publicForecast = (row) => row ? {
  id: row.id,
  symbol: row.symbol,
  horizonBars: Number(row.horizon_bars),
  target: row.target,
  direction: row.direction,
  probabilityPercent: Number((Number(row.probability) * 100).toFixed(1)),
  baseClose: Number(row.base_close),
  baseBarTime: Number(row.base_bar_time),
  model: row.model,
  status: row.status,
  resolvedClose: row.resolved_close == null ? null : Number(row.resolved_close),
  resolvedBarTime: row.resolved_bar_time == null ? null : Number(row.resolved_bar_time),
  resolvedAt: row.resolved_at || null,
  createdAt: row.created_at,
} : null;

const cleanCandles = (input) => (Array.isArray(input) ? input : [])
  .map((candle) => ({
    time: Number(candle?.time),
    open: Number(candle?.open),
    high: Number(candle?.high),
    low: Number(candle?.low),
    close: Number(candle?.close),
  }))
  .filter((candle) => Number.isFinite(candle.time) && candle.time > 0
    && [candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0))
  .sort((first, second) => first.time - second.time);

export const recordForecast = ({ userId, symbol, candles, horizonBars = DEFAULT_HORIZON }) => {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(cleanSymbol)) {
    throw Object.assign(new Error('Enter a valid market symbol.'), { code: 'invalid_symbol' });
  }
  const bars = cleanCandles(candles);
  const forecast = forecastFromDailyCandles(bars, { horizonBars });
  if (forecast.status !== 'ok') return { forecast, record: null, created: false };

  const baseBar = bars.find((bar) => bar.time === forecast.latestBarTime) || bars.at(-1);
  const probability = Number((forecast.probabilityPercent / 100).toFixed(6));
  // Neutral carries no directional call, so it is stored but never counted as a hit.
  const status = forecast.direction === 'neutral' ? 'unscorable' : 'pending';
  const id = `FCT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const db = getDatabase();
  db.run(
    `INSERT OR IGNORE INTO forecast_predictions
      (id, user_id, symbol, horizon_bars, target, direction, probability, base_close, base_bar_time, model, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, cleanSymbol, horizonBars, forecast.target, forecast.direction, probability,
    baseBar.close, baseBar.time, forecast.model, status, createdAt,
  );
  const row = db.get(
    'SELECT * FROM forecast_predictions WHERE user_id = ? AND symbol = ? AND horizon_bars = ? AND base_bar_time = ?',
    userId, cleanSymbol, horizonBars, baseBar.time,
  );
  return { forecast, record: publicForecast(row), created: row?.id === id };
};

export const resolveForecasts = async ({ userId, getDailyCandles, limit = 200 }) => {
  if (typeof getDailyCandles !== 'function') return { checked: 0, resolved: 0 };
  const db = getDatabase();
  const pending = db.query(
    "SELECT * FROM forecast_predictions WHERE user_id = ? AND status = 'pending' ORDER BY base_bar_time DESC LIMIT ?",
    userId, Math.max(1, Math.min(Number(limit) || 200, 500)),
  );
  if (pending.length === 0) return { checked: 0, resolved: 0 };

  const symbolBars = new Map();
  const loadBars = async (symbol) => {
    if (!symbolBars.has(symbol)) {
      let bars = [];
      try {
        bars = cleanCandles(await getDailyCandles(symbol));
      } catch {
        bars = [];
      }
      symbolBars.set(symbol, bars);
    }
    return symbolBars.get(symbol);
  };

  let resolved = 0;
  const resolvedAt = new Date().toISOString();
  for (const row of pending) {
    const bars = await loadBars(row.symbol);
    const baseIndex = bars.findIndex((bar) => bar.time === Number(row.base_bar_time));
    const targetIndex = baseIndex + Number(row.horizon_bars);
    if (baseIndex < 0 || targetIndex >= bars.length) continue;
    const resolvedBar = bars[targetIndex];
    const baseClose = Number(row.base_close);
    const status = row.direction === 'bullish'
      ? (resolvedBar.close > baseClose ? 'correct' : 'incorrect')
      : (resolvedBar.close < baseClose ? 'correct' : 'incorrect');
    const result = db.run(
      `UPDATE forecast_predictions
          SET status = ?, resolved_close = ?, resolved_bar_time = ?, resolved_at = ?
        WHERE id = ? AND user_id = ? AND status = 'pending'`,
      status, resolvedBar.close, resolvedBar.time, resolvedAt, row.id, userId,
    );
    resolved += Number(result.changes) || 0;
  }
  return { checked: pending.length, resolved };
};

export const listForecasts = (userId, limit = 50) => getDatabase()
  .query(
    'SELECT * FROM forecast_predictions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    userId, Math.max(1, Math.min(Number(limit) || 50, MAX_LIST)),
  )
  .map(publicForecast);

export const forecastStats = (userId) => {
  const rows = getDatabase().query(
    'SELECT probability, base_close, resolved_close, status FROM forecast_predictions WHERE user_id = ?',
    userId,
  );
  const tally = { total: rows.length, pending: 0, unscorable: 0, correct: 0, incorrect: 0 };
  let brierTotal = 0;
  let probabilityTotal = 0;
  for (const row of rows) {
    if (row.status === 'pending') tally.pending += 1;
    else if (row.status === 'unscorable') tally.unscorable += 1;
    else {
      if (row.status === 'correct') tally.correct += 1;
      else tally.incorrect += 1;
      probabilityTotal += Number(row.probability);
      const wentUp = Number(row.resolved_close) > Number(row.base_close) ? 1 : 0;
      brierTotal += ((Number(row.probability) - wentUp) ** 2);
    }
  }
  const scored = tally.correct + tally.incorrect;
  return {
    ...tally,
    scored,
    hitRatePercent: scored ? Number(((tally.correct / scored) * 100).toFixed(1)) : null,
    averageProbabilityPercent: scored ? Number(((probabilityTotal / scored) * 100).toFixed(1)) : null,
    brierScore: scored ? Number((brierTotal / scored).toFixed(4)) : null,
    note: 'Only directional forecasts (bullish or bearish) are scored once the target bar has closed. Neutral calls and still-open forecasts are excluded from the hit rate.',
  };
};

export const registerForecastRoutes = (app, deps = {}) => {
  const sessionUser = deps.readUser || readSessionUser;
  const getDailyCandles = deps.getDailyCandles;

  app.get('/api/forecasts', async (req, res) => {
    const user = sessionUser(req);
    if (!user) return fail(res, 401, 'Please sign in to read your forecast track record.', 'not_authenticated');
    try {
      syncUser(user);
      await resolveForecasts({ userId: user.id, getDailyCandles });
      res.set('Cache-Control', 'no-store');
      res.json({
        forecasts: listForecasts(user.id, req.query.limit),
        stats: forecastStats(user.id),
      });
    } catch {
      fail(res, 503, 'The forecast track record is temporarily unavailable.', 'forecasts_unavailable');
    }
  });

  app.post('/api/forecasts', async (req, res) => {
    const user = sessionUser(req);
    if (!user) return fail(res, 401, 'Please sign in to save a forecast.', 'not_authenticated');
    const symbol = String(req.body?.symbol || '').trim().toUpperCase().replace(/^(NSE|BSE):/, '');
    if (!SYMBOL_PATTERN.test(symbol)) return fail(res, 400, 'Enter a valid market symbol.', 'invalid_symbol');
    const horizonBars = req.body?.horizonBars === undefined ? DEFAULT_HORIZON : Number(req.body.horizonBars);
    if (!Number.isInteger(horizonBars) || horizonBars < 1 || horizonBars > MAX_HORIZON) {
      return fail(res, 400, `Choose a horizon between 1 and ${MAX_HORIZON} daily bars.`, 'invalid_horizon');
    }
    if (typeof getDailyCandles !== 'function') {
      return fail(res, 503, 'Daily history is not configured on this server.', 'history_unavailable');
    }
    let candles;
    try {
      candles = await getDailyCandles(symbol);
    } catch {
      candles = null;
    }
    if (!Array.isArray(candles) || candles.length === 0) {
      return fail(res, 502, `No verified daily OHLC history was returned for ${symbol}.`, 'history_unavailable');
    }
    try {
      syncUser(user);
      const { forecast, record, created } = recordForecast({ userId: user.id, symbol, candles, horizonBars });
      if (!record) {
        return res.status(422).json({
          error: 'A forecast is withheld until the chronological training and out-of-sample windows are large enough.',
          code: 'insufficient_history',
          forecast,
          stats: forecastStats(user.id),
        });
      }
      res.status(created ? 201 : 200).json({
        record,
        created,
        forecasts: listForecasts(user.id, 50),
        stats: forecastStats(user.id),
      });
    } catch (error) {
      if (error?.code === 'invalid_symbol') return fail(res, 400, error.message, 'invalid_symbol');
      fail(res, 503, 'The forecast could not be saved.', 'forecast_save_failed');
    }
  });
};
