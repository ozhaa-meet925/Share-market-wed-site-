import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { authorizeEntry, isKillSwitchActive } from './serverRiskShield.js';
import { publish } from './serverCoreBus.js';
import {
  liveExecutionHealth,
  liveQuoteBatch,
  liveReadiness,
  submitLiveEntry,
  submitLiveExit,
  submitProtectiveStop,
  modifyProtectiveStop,
  cancelProtectiveStop,
  syncAiBrokerOrders,
  cancelOpenAiEntries,
  fetchBrokerPositions,
  estimateCharges,
} from './serverLiveExecution.js';
import { getBrokerAccount, listBrokerAccounts } from './serverBrokerStore.js';
import { getAdapter, liveTradingMasterEnabled } from './serverBrokers/index.js';
import { findUserById } from './serverAuth.js';
import { evaluatePriceAlerts, notificationChannels, notify, notifyNewsSubscribers } from './serverNotifications.js';
import { COST_MODEL_LABEL, costPercentForNotional } from './tradeCosts.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'autotrade.json');
const LOCK_PATH = path.join(DATA_DIR, 'autotrade.lock');
const SCAN_INTERVAL_MS = 20_000;
const SIGNAL_CACHE_MS = 10 * 60 * 1000;
const BACKTEST_CACHE_MS = 10 * 60 * 1000;
// 'unknown' is a quote whose provider did not declare live or delayed status.
// It gets its own tight budget so it can never inherit the delayed allowance.
const ENTRY_QUOTE_MAX_AGE_MS = { live: 5 * 60 * 1000, delayed: 12 * 60 * 1000, unknown: 60 * 1000 };
const EXIT_QUOTE_MAX_AGE_MS = { live: 15 * 60 * 1000, delayed: 20 * 60 * 1000, unknown: 2 * 60 * 1000 };
// After the session ends the provider only publishes the day's close, so the EOD
// square-off must still accept that quote instead of dropping it as stale.
const EOD_SQUARE_OFF_QUOTE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const EOD_SQUARE_OFF_END_MINUTES = 20 * 60;
const MAX_EVENTS = 200;
const MAX_ORDERS = 200;
const MAX_TRADES = 200;
const MAX_AUDIT = 300;
const STARTING_CAPITAL = 1000000;

const DEFAULT_WATCHLIST = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'SBIN', 'ICICIBANK', 'BHARTIARTL', 'LT'];

const nowIso = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const round2 = (value) => Number(Number(value).toFixed(2));
const round4 = (value) => Number(Number(value).toFixed(4));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const IST_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
});

const istNow = (date = new Date()) => {
  const parts = Object.fromEntries(IST_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
  const clock = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes,
    weekday: parts.weekday,
    weekend,
    clock,
    sessionOpen: !weekend && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30,
    squareOffWindow: !weekend && minutes >= 15 * 60 + 15 && minutes < 15 * 60 + 30,
  };
};

const istDateKeyOf = (iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? istNow(new Date(ms)).dateKey : null;
};

const quoteTimeMs = (quote) => {
  const raw = Number(quote?.timestamp);
  if (!(raw > 0)) return null;
  return raw < 1e12 ? raw * 1000 : raw;
};

const quoteBasisOf = (quote) => {
  if (!quote) return 'unavailable';
  if (quote.isLive === true) return 'live';
  if (quote.isResearch === true || quote.isDelayed === true) return 'delayed';
  return 'unknown';
};

const quoteAgeMs = (quote) => {
  const time = quoteTimeMs(quote);
  return time === null ? null : Math.max(0, Date.now() - time);
};

const isQuoteUsable = (quote, maxAgeMs, basis = 'unknown') => {
  if (!(Number(quote?.c) > 0)) return false;
  const age = quoteAgeMs(quote);
  // A quote with no publish time is only trusted from a live broker feed; every
  // other basis must prove its age, otherwise 'unknown' would inherit the
  // delayed budget and trade on a price we cannot date.
  if (age === null) return basis === 'live';
  return age <= maxAgeMs;
};

const quoteAgeBudget = (table, basis) => table[basis] || table.unknown;

const SYMBOL_PATTERN = /^[A-Z0-9&.\-]{1,20}$/;
const sanitizeSymbol = (value) => {
  const symbol = String(value || '').trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
};

const defaultRisk = () => ({
  maxDailyLoss: 25000,
  maxInvestmentPerTrade: 100000,
  maxDailyTrades: 6,
  maxOpenPositions: 5,
  stopLossPercent: 1.5,
  targetPercent: 3,
  trailingStopPercent: 1,
  maxPortfolioExposurePercent: 70,
  minSignalScore: 60,
  duplicateWindowMinutes: 30,
});

const createAccount = () => {
  const createdAt = nowIso();
  return {
    version: 1,
    status: 'running',
    mode: 'paper',
    autoStartPaper: true,
    execution: {
      broker: null,
      enabledAt: null,
      enabledBy: null,
      lastReadiness: null,
      lastSyncAt: null,
      syncError: null,
      lastLiveQuoteAt: null,
      brokerPositionCount: null,
      lastEntryError: null,
    },
    emergencyStopped: false,
    tradeStyle: 'intraday',
    watchlist: [...DEFAULT_WATCHLIST],
    risk: defaultRisk(),
    notifications: { browser: true, telegram: false },
    cash: STARTING_CAPITAL,
    startingCapital: STARTING_CAPITAL,
    positions: [],
    closedPositions: [],
    orders: [],
    trades: [],
    events: [],
    audit: [],
    cooldowns: {},
    totalRealizedPnl: 0,
    totalTrades: 0,
    daily: { date: null, startEquity: STARTING_CAPITAL, realizedPnl: 0, tradesCount: 0, halted: false, haltReason: null, riskBaselineEquity: null },
    scan: { lastRunAt: null, lastDurationMs: null, quoteCount: 0, dataBasis: 'unavailable', lastError: null, signalError: null },
    createdAt,
    updatedAt: createdAt,
  };
};

const ensureAccountShape = (account) => {
  const defaults = createAccount();
  const hadAutoStartPaperSetting = typeof account.autoStartPaper === 'boolean';
  for (const key of Object.keys(defaults)) {
    if (key === 'autoStartPaper' && !hadAutoStartPaperSetting) continue;
    if (account[key] === undefined) account[key] = defaults[key];
  }
  if (!['paper', 'live'].includes(account.mode)) account.mode = 'paper';
  account.execution = { ...defaults.execution, ...(account.execution || {}) };
  if (account.mode === 'live' && !['zerodha', 'upstox'].includes(account.execution.broker)) {
    account.mode = 'paper';
    account.execution.broker = null;
  }
  account.risk = { ...defaultRisk(), ...(account.risk || {}) };
  account.notifications = { browser: true, telegram: false, ...(account.notifications || {}) };
  account.daily = { date: null, startEquity: account.cash, realizedPnl: 0, tradesCount: 0, halted: false, haltReason: null, riskBaselineEquity: null, ...(account.daily || {}) };
  account.scan = { ...defaults.scan, ...(account.scan || {}) };
  account.watchlist = (Array.isArray(account.watchlist) ? account.watchlist : DEFAULT_WATCHLIST)
    .map(sanitizeSymbol).filter(Boolean).slice(0, 20);
  if (!account.watchlist.length) account.watchlist = [...DEFAULT_WATCHLIST];
  for (const key of ['positions', 'closedPositions', 'orders', 'trades', 'events', 'audit']) {
    if (!Array.isArray(account[key])) account[key] = [];
  }
  if (!hadAutoStartPaperSetting) {
    const previouslyStoppedByUser = account.emergencyStopped === true
      || account.events.some((event) => ['agent_stopped', 'emergency_stop'].includes(event.type))
      || account.audit.some((entry) => ['agent_stopped', 'emergency_stop'].includes(entry.action));
    account.autoStartPaper = !previouslyStoppedByUser;
  }
  if (!account.cooldowns || typeof account.cooldowns !== 'object') account.cooldowns = {};
  return account;
};

let store = { version: 1, accounts: {} };
try {
  const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  if (parsed?.accounts && typeof parsed.accounts === 'object') store = parsed;
} catch {
  // First run: start with an empty store.
}

const persistStore = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpPath = `${STORE_PATH}.${process.pid}.tmp`;
    const payload = JSON.stringify(store, null, 2);
    fs.writeFileSync(tmpPath, payload, 'utf8');
    let renamed = false;
    for (let attempt = 0; attempt < 8 && !renamed; attempt += 1) {
      try {
        fs.renameSync(tmpPath, STORE_PATH);
        renamed = true;
      } catch {
        // Antivirus/OneDrive/another writer can hold the target briefly; retry immediately.
      }
    }
    if (!renamed) {
      fs.writeFileSync(STORE_PATH, payload, 'utf8');
    }
    try { fs.copyFileSync(STORE_PATH, `${STORE_PATH}.bak`); } catch { /* backup is best-effort */ }
  } catch (error) {
    console.warn('Could not persist auto-trade accounts:', error.message);
  }
};

const accountFor = (userId) => {
  if (!store.accounts[userId]) store.accounts[userId] = createAccount();
  const account = ensureAccountShape(store.accounts[userId]);
  account.userId = userId;
  if (account.mode === 'paper'
    && account.status === 'stopped'
    && account.autoStartPaper
    && !account.emergencyStopped
    && !(account.daily.halted && account.daily.date === istNow().dateKey)) {
    account.status = 'running';
    account.updatedAt = nowIso();
    pushEvent(account, {
      type: 'agent_auto_started',
      severity: 'info',
      title: 'Paper auto-trader started automatically',
      message: 'Paper-only automation resumed for the configured watchlist. No broker orders can be sent in paper mode.',
    });
    addAudit(account, 'agent_auto_started', 'Paper automation resumed from the saved auto-start preference.', 'system');
    persistStore();
  }
  return account;
};

const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

const telegramSentAt = [];
const sendTelegram = async (account, event) => {
  if (!account.notifications.telegram || !telegramConfigured()) return;
  const now = Date.now();
  while (telegramSentAt.length && now - telegramSentAt[0] > 60_000) telegramSentAt.shift();
  if (telegramSentAt.length >= 10) return;
  telegramSentAt.push(now);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const text = `ShareMarket AI Trader (${account.mode === 'live' ? 'live' : 'paper'})\n${event.title}\n${event.message}`;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(6000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.description || `Telegram returned HTTP ${response.status}.`);
    }
  } catch (error) {
    console.warn('Telegram notification failed:', error.message);
  }
};

const pushEvent = (account, { type, severity = 'info', title, message, symbol = null }) => {
  const event = { id: uid('EVT'), at: nowIso(), type, severity, title, message, symbol };
  account.events.unshift(event);
  account.events = account.events.slice(0, MAX_EVENTS);
  account.updatedAt = event.at;
  sendTelegram(account, event);
  const categoryByType = {
    agent_started: 'order',
    agent_auto_started: 'order',
    agent_resumed: 'order',
    agent_paused: 'risk',
    agent_stopped: 'risk',
    ai_signal: 'signal',
    trade_opened: 'trade',
    trade_closed: 'trade',
    target_achieved: 'trade',
    manual_exit: 'trade',
    intraday_square_off: 'trade',
    broker_reconciled: 'order',
    stop_loss_triggered: 'risk',
    trailing_stop_triggered: 'risk',
    risk_limit_reached: 'risk',
    live_entry_failed: 'order_risk',
    order_rejected: 'order_risk',
    live_protection_failed: 'risk',
    live_protection_submitted: 'risk',
    broker_connection_lost: 'risk',
    worker_failure: 'risk',
    protective_stop_triggered: 'trade',
    emergency_stop: 'risk',
    exit_pending_market_open: 'risk',
    risk_halt_resumed: 'risk',
    data_unavailable: 'risk',
  };
  const category = categoryByType[type];
  if (category && account.userId) {
    try {
      notify({ userId: account.userId, category, title, body: message, level: severity, externalKey: `autotrade:${event.id}` });
    } catch (error) {
      console.warn('Auto-trade notification could not be queued:', error.message);
    }
  }
  return event;
};

const pauseLiveEntries = (account, { type, title, message }) => {
  const recentDuplicate = account.status === 'paused'
    && account.events.some((event) => event.type === type && event.title === title
      && Date.now() - Date.parse(event.at) < 5 * 60_000);
  account.status = 'paused';
  account.autoStartPaper = false;
  account.updatedAt = nowIso();
  if (recentDuplicate) return;
  pushEvent(account, { type, severity: 'critical', title, message });
  addAudit(account, type, message, 'system');
};

const addAudit = (account, action, detail, actor = 'ai') => {
  account.audit.unshift({ id: uid('AUD'), at: nowIso(), action, detail, actor });
  account.audit = account.audit.slice(0, MAX_AUDIT);
};

const addOrder = (account, order) => {
  const record = {
    id: uid('ORD'),
    at: nowIso(),
    orderType: 'Market',
    status: 'Executed',
    source: 'ai',
    quoteBasis: 'unknown',
    reason: null,
    ...order,
  };
  account.orders.unshift(record);
  account.orders = account.orders.slice(0, MAX_ORDERS);
  return record;
};

const displayOrderStatus = (status) => ({
  pending: 'Pending',
  submitted: 'Submitted',
  partially_filled: 'Partially filled',
  filled: 'Executed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  unverified: 'Unverified',
}[status] || status || 'Unknown');

const liveBrokerOf = (account) => (account.mode === 'live' ? account.execution?.broker || null : null);
const isLiveAccount = (account) => Boolean(liveBrokerOf(account));

const markToMarket = (account) => {
  let cost = 0;
  let marketValue = 0;
  for (const position of account.positions) {
    const last = Number(position.lastPrice) > 0 ? Number(position.lastPrice) : Number(position.entryPrice);
    cost += position.qty * position.entryPrice;
    marketValue += position.qty * last;
  }
  const roundedMarket = round2(marketValue);
  const roundedCost = round2(cost);
  return {
    investedValue: roundedCost,
    marketValue: roundedMarket,
    unrealizedPnl: round2(roundedMarket - roundedCost),
    equity: round2(account.cash + roundedMarket),
  };
};

const ensureDaily = (account) => {
  const ist = istNow();
  if (account.daily.date === ist.dateKey) return ist;
  const metrics = markToMarket(account);
  if (account.daily.date) {
    const previousPnl = round2(metrics.equity - Number(account.daily.startEquity || metrics.equity));
    pushEvent(account, {
      type: 'daily_summary',
      severity: previousPnl >= 0 ? 'success' : 'warning',
      title: 'Previous session summary',
      message: `${account.daily.date}: ${previousPnl >= 0 ? '+' : ''}₹${previousPnl.toLocaleString('en-IN')} on ${account.daily.tradesCount} auto trade(s). New session risk limits reset.`,
    });
  }
  account.daily = {
    date: ist.dateKey,
    startEquity: metrics.equity,
    realizedPnl: 0,
    tradesCount: 0,
    halted: false,
    haltReason: null,
    riskBaselineEquity: null,
  };
  addAudit(account, 'session_reset', `New IST session ${ist.dateKey}; start equity ₹${metrics.equity.toLocaleString('en-IN')}.`);
  return ist;
};

const signalCache = new Map();
const backtestCache = new Map();
const cyclesInFlight = new Set();

const smaAt = (values, index, period) => {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let offset = index - period + 1; offset <= index; offset += 1) sum += values[offset];
  return sum / period;
};

const rsiAt = (values, index, period = 14) => {
  if (index < period) return null;
  let gains = 0;
  let losses = 0;
  for (let offset = index - period + 1; offset <= index; offset += 1) {
    const delta = values[offset] - values[offset - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  if (gains + losses === 0) return 50;
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
};

const stdev = (values) => {
  if (values.length < 2) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const atrPercent = (candles, index, period = 14) => {
  if (index < period) return null;
  let sum = 0;
  for (let offset = index - period + 1; offset <= index; offset += 1) {
    const candle = candles[offset];
    const previous = candles[offset - 1];
    const trueRange = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
    sum += trueRange;
  }
  const close = candles[index].close;
  return close > 0 ? ((sum / period) / close) * 100 : null;
};

const buildSignal = (symbol, candles) => {
  const series = candles.filter((candle) => candle && candle.close > 0).slice(-160);
  if (series.length < 60) {
    const error = new Error(`Only ${series.length} daily bars are available for ${symbol}; at least 60 are required.`);
    error.code = 'insufficient_history';
    throw error;
  }
  const closes = series.map((candle) => candle.close);
  const last = closes.length - 1;
  const price = closes[last];
  const sma20 = smaAt(closes, last, 20);
  const sma50 = smaAt(closes, last, 50);
  const rsi14 = rsiAt(closes, last, 14);
  const atr14Percent = atrPercent(series, last, 14);
  const momentum20 = closes[last - 20] > 0 ? (price / closes[last - 20] - 1) * 100 : null;
  const returns = [];
  for (let index = last - 19; index <= last; index += 1) {
    if (closes[index - 1] > 0) returns.push((closes[index] / closes[index - 1] - 1) * 100);
  }
  const volatility20 = stdev(returns);
  const recentHigh = Math.max(...series.slice(-20).map((candle) => candle.high));
  const scoreParts = [];
  let score = 40;
  const add = (points, reason) => {
    score += points;
    scoreParts.push({ points, reason });
  };
  if (sma20 !== null && price > sma20) add(18, 'Price is above the 20-day SMA');
  if (sma20 !== null && sma50 !== null && sma20 > sma50) add(18, '20-day SMA is above the 50-day SMA');
  if (rsi14 !== null && rsi14 >= 45 && rsi14 <= 70) add(12, `RSI ${round2(rsi14)} is in the momentum zone`);
  if (momentum20 !== null && momentum20 > 1.5) add(12, `20-day momentum is +${round2(momentum20)}%`);
  if (price >= recentHigh * 0.995) add(10, 'Price is within 0.5% of its 20-day high');
  if (volatility20 !== null && volatility20 < 3) add(8, `20-day volatility is contained at ${round2(volatility20)}%`);
  if (rsi14 !== null && rsi14 > 75) add(-15, `RSI ${round2(rsi14)} is overbought`);
  if (momentum20 !== null && momentum20 < -2) add(-12, `20-day momentum is ${round2(momentum20)}%`);
  if (volatility20 !== null && volatility20 > 5) add(-8, `20-day volatility is elevated at ${round2(volatility20)}%`);
  if (sma20 !== null && price < sma20) add(-10, 'Price is below the 20-day SMA');
  score = Math.round(clamp(score, 5, 100));
  const trend = sma20 !== null && sma50 !== null
    ? sma20 > sma50 && (momentum20 === null || momentum20 >= 0) ? 'up'
      : sma20 < sma50 && (momentum20 === null || momentum20 <= 0) ? 'down'
        : 'sideways'
    : 'unknown';
  const action = score >= 65 ? 'Buy' : score >= 45 ? 'Watch' : 'Avoid';
  return {
    symbol,
    price: round2(price),
    sma20: sma20 === null ? null : round2(sma20),
    sma50: sma50 === null ? null : round2(sma50),
    rsi14: rsi14 === null ? null : round2(rsi14),
    atr14Percent: atr14Percent === null ? null : round2(atr14Percent),
    momentum20Percent: momentum20 === null ? null : round2(momentum20),
    volatility20Percent: volatility20 === null ? null : round2(volatility20),
    dayHigh20: round2(recentHigh),
    trend,
    score,
    action,
    reasons: scoreParts,
    bars: series.length,
    asOf: new Date(series[last].time * 1000).toISOString(),
    basis: 'delayed daily research bars',
    disclaimer: 'Rules-based technical read, not a prediction or a guarantee. Generated from delayed daily data.',
  };
};

const loadSignal = async (symbol, deps, { force = false } = {}) => {
  const cached = signalCache.get(symbol);
  if (!force && cached && Date.now() - cached.savedAt < SIGNAL_CACHE_MS) return cached.signal;
  const candles = await deps.getDailyCandles(symbol);
  if (!candles || candles.length < 60) {
    const error = new Error(`Verified daily history for ${symbol} is unavailable right now.`);
    error.code = 'research_unavailable';
    throw error;
  }
  const signal = buildSignal(symbol, candles);
  signalCache.set(symbol, { signal, savedAt: Date.now() });
  return signal;
};

const closePosition = (account, position, price, reason, quote, options = {}) => {
  const closeQty = Math.max(1, Math.min(Number(options.qty) || position.qty, position.qty));
  const fees = round2(Math.max(0, Number(options.fees) || 0));
  const live = options.live || null;
  const proceeds = round2(closeQty * price);
  const grossPnl = round2((price - position.entryPrice) * closeQty);
  const pnl = round2(grossPnl - fees);
  const pnlPercent = position.entryPrice > 0 ? round2((pnl / (position.entryPrice * closeQty)) * 100) : 0;
  account.cash = round2(account.cash + proceeds);
  const remainingQty = position.qty - closeQty;
  if (remainingQty > 0) {
    position.qty = remainingQty;
  } else {
    account.positions = account.positions.filter((item) => item.id !== position.id);
  }
  account.daily.realizedPnl = round2(account.daily.realizedPnl + pnl);
  account.totalRealizedPnl = round2(account.totalRealizedPnl + pnl);
  account.totalTrades += 1;
  if (remainingQty <= 0) account.cooldowns[position.symbol] = Date.now();

  const closed = {
    ...position,
    qty: closeQty,
    status: remainingQty > 0 ? 'partially_closed' : 'closed',
    exitPrice: round2(price),
    exitAt: nowIso(),
    exitReason: reason,
    grossPnl,
    fees,
    realizedPnl: pnl,
    realizedPnlPercent: pnlPercent,
    brokerOrderId: live?.brokerOrderId || null,
    brokerOrderStatus: live?.status || null,
    note: options.note || null,
  };
  account.closedPositions.unshift(closed);
  account.closedPositions = account.closedPositions.slice(0, 100);

  account.trades.unshift({
    id: uid('TRD'),
    symbol: position.symbol,
    qty: closeQty,
    entryAt: position.entryAt,
    entryPrice: position.entryPrice,
    exitAt: closed.exitAt,
    exitPrice: closed.exitPrice,
    pnl,
    pnlPercent,
    fees,
    exitReason: reason,
    openedBy: position.openedBy || 'ai',
    execution: position.execution || 'paper',
    brokerOrderId: live?.brokerOrderId || position.brokerOrderId || null,
  });
  account.trades = account.trades.slice(0, MAX_TRADES);

  addOrder(account, {
    symbol: position.symbol,
    side: 'Sell',
    qty: closeQty,
    price: round2(price),
    status: live ? displayOrderStatus(live.status) : 'Executed',
    quoteBasis: quoteBasisOf(quote) === 'unknown' && live ? 'live' : quoteBasisOf(quote),
    execution: position.execution || 'paper',
    brokerOrderId: live?.brokerOrderId || null,
    brokerOrderIdRef: live?.orderId || null,
    reason,
    positionId: position.id,
  });

  const labels = {
    target: { type: 'target_achieved', severity: 'success', title: 'Target achieved' },
    stop_loss: { type: 'stop_loss_triggered', severity: 'warning', title: 'Stop-loss triggered' },
    trailing_stop: { type: 'trailing_stop_triggered', severity: 'warning', title: 'Trailing stop triggered' },
    square_off: { type: 'intraday_square_off', severity: 'info', title: 'Intraday square-off' },
    manual: { type: 'manual_exit', severity: 'info', title: 'Manual exit' },
    broker_reconciled: { type: 'broker_reconciled', severity: 'warning', title: 'Broker position reconciled' },
  };
  const label = labels[reason] || { type: 'trade_closed', severity: 'info', title: 'Position closed' };
  pushEvent(account, {
    type: label.type,
    severity: label.severity,
    title: `${label.title}: ${position.symbol}`,
    symbol: position.symbol,
    message: `${closeQty} @ ₹${round2(price)} · ${pnl >= 0 ? '+' : ''}₹${Math.abs(pnl).toLocaleString('en-IN')} (${pnlPercent}%)${fees > 0 ? ` after ₹${fees} estimated charges` : ''}. ${reason === 'target' ? 'Profit booked automatically.' : reason === 'manual' ? 'Closed from the dashboard.' : reason === 'broker_reconciled' ? 'The broker reports no open quantity, so the mirror position was closed.' : 'Risk rule executed.'}${live?.brokerOrderId ? ` Broker order ${live.brokerOrderId}.` : ''}`,
  });
  addAudit(account, 'position_closed', `${position.symbol} ${closeQty} @ ₹${round2(price)} · ${reason} · P&L ₹${pnl}${live?.brokerOrderId ? ` · broker ${live.brokerOrderId}` : ''}.`);
  return closed;
};

const openPosition = (account, { symbol, qty, price, quote, signal, idempotencyKey = null, live = null, recovered = false }) => {
  const value = round2(qty * price);
  const entry = round2(price);
  const risk = account.risk;
  const position = {
    id: uid('POS'),
    symbol,
    qty,
    entryPrice: entry,
    entryAt: nowIso(),
    lastPrice: entry,
    lastQuoteAt: nowIso(),
    highWater: entry,
    stopLoss: round2(entry * (1 - risk.stopLossPercent / 100)),
    stopLossKind: 'initial',
    target: round2(entry * (1 + risk.targetPercent / 100)),
    status: 'open',
    openedBy: 'ai',
    execution: live ? 'live' : 'paper',
    broker: live?.broker || null,
    brokerOrderId: live?.brokerOrderId || null,
    brokerOrderRef: live?.orderId || null,
    orderStatus: live ? displayOrderStatus(live.status) : 'Executed',
    product: live?.product || null,
    entryCharges: live?.fees ? round2(live.fees) : 0,
    idempotencyKey,
    quoteBasis: live ? 'live' : quoteBasisOf(quote),
    signalScore: signal?.score ?? null,
    signalReasons: (signal?.reasons || []).slice(0, 4).map((item) => item.reason),
    recovered: recovered || false,
  };
  account.cash = round2(account.cash - value);
  account.positions.unshift(position);
  account.daily.tradesCount += 1;
  const order = addOrder(account, {
    symbol,
    side: 'Buy',
    qty,
    price: entry,
    status: live ? displayOrderStatus(live.status) : 'Executed',
    quoteBasis: live ? 'live' : position.quoteBasis,
    execution: position.execution,
    brokerOrderId: live?.brokerOrderId || null,
    brokerOrderIdRef: live?.orderId || null,
    positionId: position.id,
    idempotencyKey,
    reason: recovered ? 'recovered verified fill' : signal ? `signal ${signal.score}/100` : 'manual',
  });
  position.orderId = order.id;
  pushEvent(account, {
    type: 'trade_opened',
    severity: 'success',
    title: `${live ? 'LIVE ' : 'Auto '}BUY executed: ${symbol}`,
    symbol,
    message: `${qty} @ ₹${entry.toLocaleString('en-IN')} · value ₹${value.toLocaleString('en-IN')} · SL ₹${position.stopLoss.toLocaleString('en-IN')} · target ₹${position.target.toLocaleString('en-IN')} · signal ${signal?.score ?? '—'}/100${live?.brokerOrderId ? ` · broker order ${live.brokerOrderId}` : ''}${recovered ? ' · recovered from broker fill' : ''}.`,
  });
  addAudit(account, 'position_opened', `${symbol} buy ${qty} @ ₹${entry}; SL ₹${position.stopLoss}; target ₹${position.target}; ${position.quoteBasis} quote${live?.brokerOrderId ? `; broker order ${live.brokerOrderId}` : ''}.`);
  return position;
};

const recordRejection = (account, symbol, detail, quote) => {
  addOrder(account, {
    symbol,
    side: 'Buy',
    qty: 0,
    price: Number(quote?.c) > 0 ? round2(quote.c) : null,
    status: 'Rejected',
    quoteBasis: quoteBasisOf(quote),
    reason: detail,
  });
  pushEvent(account, {
    type: 'order_rejected',
    severity: 'warning',
    title: `Order not placed: ${symbol}`,
    symbol,
    message: detail,
  });
  addAudit(account, 'order_rejected', `${symbol}: ${detail}`);
};

const liveQuoteSnapshot = async ({ userId, account, symbols }) => {
  const broker = liveBrokerOf(account);
  const batch = await liveQuoteBatch({ userId, broker, symbols });
  account.execution.lastLiveQuoteAt = nowIso();
  return batch;
};

const applyBrokerOrderUpdates = (account, updates = []) => {
  let changed = false;
  for (const update of updates) {
    const meta = update.meta || {};
    if (meta.type === 'protection') {
      const position = account.positions.find((item) => item.id === meta.positionId);
      if (!position) continue;
      const cumulativeFilled = Math.max(0, Number(update.filledQuantity) || 0);
      const previousFilled = Math.max(0, Number(position.protectionFilledQuantity) || 0);
      const fillDelta = Math.min(Math.max(0, cumulativeFilled - previousFilled), position.qty);
      if (fillDelta > 0) {
        position.protectionFilledQuantity = cumulativeFilled;
        closePosition(account, position, Number(update.averagePrice) || position.lastPrice || position.entryPrice,
          'stop_loss', null, { qty: fillDelta, live: { brokerOrderId: update.brokerOrderId, status: update.status } });
        changed = true;
      }
      if (['rejected', 'cancelled', 'unverified'].includes(update.status)) {
        const expired = update.status === 'cancelled' && /DAY protective stop expired/i.test(update.reason || '');
        position.protectionStatus = expired ? 'expired' : 'failed';
        if (update.status === 'rejected' || update.status === 'cancelled') {
          position.protectionOrderId = null;
          position.protectionBrokerOrderId = null;
        }
        const message = `The ${position.symbol} broker stop-loss is ${update.status}${update.reason ? `: ${update.reason}` : ''}. New live entries are paused; check the broker order book and position protection.`;
        pauseLiveEntries(account, {
          type: 'live_protection_failed',
          title: `Broker stop-loss ${update.status}: ${position.symbol}`,
          message,
        });
        changed = true;
      } else if (fillDelta > 0 && account.positions.includes(position)) {
        position.protectionStatus = 'pending_exit';
        pauseLiveEntries(account, {
          type: 'live_protection_failed',
          title: `Stop-loss partially filled: ${position.symbol}`,
          message: `${fillDelta} additional ${position.symbol} share(s) were sold by the broker stop-loss. The remaining broker stop order is being reconciled; new entries and replacement sells are paused.`,
        });
      } else if (fillDelta > 0) {
        pushEvent(account, {
          type: 'protective_stop_triggered',
          severity: 'warning',
          title: `Broker stop-loss executed: ${position.symbol}`,
          symbol: position.symbol,
          message: `The broker confirmed the stop-loss fill for ${cumulativeFilled} ${position.symbol} share(s).`,
        });
        pauseLiveEntries(account, {
          type: 'live_protection_failed',
          title: `Broker stop-loss triggered: ${position.symbol}`,
          message: `The stop-loss fully exited ${position.symbol}. New entries are paused for an order-book review.`,
        });
      }
      continue;
    }
    if (meta.type === 'entry') {
      const existing = account.positions.find((position) => (
        (position.brokerOrderId && position.brokerOrderId === update.brokerOrderId)
        || (position.brokerOrderRef && position.brokerOrderRef === update.orderId)
      ));
      if (existing) {
        existing.orderStatus = displayOrderStatus(update.status);
        if (Number(update.filledQuantity) > Number(existing.qty)) {
          const delta = Number(update.filledQuantity) - Number(existing.qty);
          const fillPrice = Number(update.averagePrice) || Number(existing.entryPrice);
          existing.qty = Number(update.filledQuantity);
          account.cash = round2(account.cash - delta * fillPrice);
          addAudit(account, 'fill_reconciled', `${existing.symbol} additional ${delta} share(s) filled at ₹${fillPrice} from broker reconciliation.`);
          changed = true;
        }
        continue;
      }
      if (Number(update.filledQuantity) > 0 && ['filled', 'partially_filled'].includes(update.status)) {
        openPosition(account, {
          symbol: update.symbol,
          qty: Number(update.filledQuantity),
          price: Number(update.averagePrice) || 0,
          quote: null,
          signal: meta.signalScore ? { score: meta.signalScore, reasons: [] } : null,
          live: {
            broker: liveBrokerOf(account),
            brokerOrderId: update.brokerOrderId,
            orderId: update.orderId,
            status: update.status,
            product: meta.product || null,
          },
          recovered: true,
        });
        changed = true;
      }
      continue;
    }
    if (meta.type === 'exit') {
      const position = account.positions.find((item) => item.id === meta.positionId);
      if (!position) continue;
      if (Number(update.filledQuantity) > 0) {
        closePosition(account, position, Number(update.averagePrice) || position.lastPrice || position.entryPrice, meta.reason || 'manual', null, {
          qty: Math.min(Number(update.filledQuantity), position.qty),
          live: {
            brokerOrderId: update.brokerOrderId,
            orderId: update.orderId,
            status: update.status,
          },
        });
        if (account.positions.includes(position) && ['rejected', 'cancelled'].includes(update.status)) {
          position.protectionStatus = 'expired';
        } else if (account.positions.includes(position)) {
          position.protectionStatus = 'pending_exit';
          pauseLiveEntries(account, {
            type: 'live_protection_failed',
            title: `Live exit is still pending: ${position.symbol}`,
            message: `The broker exit order has only partially filled. No replacement stop was sent, to avoid a duplicate sell; verify the remaining position and exit order with the broker.`,
          });
        }
        changed = true;
      } else if (['rejected', 'cancelled'].includes(update.status)) {
        position.protectionStatus = 'expired';
        changed = true;
      }
    }
  }
  return changed;
};

const reconcileMirrorWithBroker = async (userId, account, brokerPositions, quotes) => {
  if (!brokerPositions) return false;
  let changed = false;
  for (const position of [...account.positions]) {
    if (position.execution !== 'live') continue;
    const row = brokerPositions.get(position.symbol);
    const netQuantity = Number(row?.quantity) || 0;
    if (netQuantity > 0) continue;
    if (!await cancelPositionProtection(userId, account, position, 'Broker position is flat')) continue;
    if (netQuantity < 0) {
      pauseLiveEntries(account, {
        type: 'live_protection_failed',
        title: `Unexpected short broker position: ${position.symbol}`,
        message: `The broker reports a net short position of ${Math.abs(netQuantity)} ${position.symbol} share(s), while the AI mirror expected a long position. New entries are paused; reconcile the broker position manually.`,
      });
    }
    const quote = quotes[position.symbol] || null;
    closePosition(account, position, Number(quote?.c) || position.lastPrice || position.entryPrice, 'broker_reconciled', quote, {
      note: 'The broker net position is zero, so the mirrored position was closed without sending another order.',
    });
    changed = true;
  }
  return changed;
};

const handleLiveExitResult = (account, position, result, reason, quote) => {
  const orderMeta = {
    brokerOrderId: result.brokerOrderId,
    orderId: result.orderId,
    status: result.status,
  };
  if (result.status === 'broker_flat') {
    closePosition(account, position, Number(position.lastPrice) || Number(position.entryPrice), 'broker_reconciled', quote, {
      live: orderMeta,
      note: result.message,
    });
    return;
  }
  if (Number(result.filledQuantity) > 0) {
    const exitFees = Number(result.charges?.total) || 0;
    const entryFeeShare = round2((Number(position.entryCharges) || 0) * (Number(result.filledQuantity) / Math.max(Number(position.qty) || 1, 1)));
    closePosition(account, position, Number(result.averagePrice) || Number(quote?.c) || position.entryPrice, reason, quote, {
      qty: Math.min(Number(result.filledQuantity), position.qty),
      fees: round2(exitFees + entryFeeShare),
      live: orderMeta,
    });
    return;
  }
  addOrder(account, {
    symbol: position.symbol,
    side: 'Sell',
    qty: result.quantity,
    price: Number(quote?.c) || null,
    status: displayOrderStatus(result.status),
    quoteBasis: 'live',
    execution: 'live',
    brokerOrderId: result.brokerOrderId,
    brokerOrderIdRef: result.orderId,
    reason: `${reason} · awaiting verified fill`,
    positionId: position.id,
  });
  pushEvent(account, {
    type: 'exit_pending',
    severity: 'warning',
    title: `Exit not yet confirmed: ${position.symbol}`,
    symbol: position.symbol,
    message: `A ${position.symbol} sell order was ${result.status === 'unverified' ? 'sent but not confirmed by the broker' : 'accepted but not filled'}. The position stays open in the mirror until the broker confirms the fill.`,
  });
};

const openLiveEntry = async ({ userId, account, symbol, quote, signal, ist }) => {
  const broker = liveBrokerOf(account);
  const result = await submitLiveEntry({
    userId,
    broker,
    symbol,
    risk: account.risk,
    signal,
    tradeStyle: account.tradeStyle,
    marketOpen: ist.sessionOpen,
  });
  const liveMeta = {
    broker,
    brokerOrderId: result.brokerOrderId,
    orderId: result.orderId,
    status: result.status,
    product: result.product || null,
    fees: estimateCharges({
      broker,
      side: 'BUY',
      product: result.product || (account.tradeStyle === 'swing' ? (broker === 'upstox' ? 'D' : 'CNC') : (broker === 'upstox' ? 'I' : 'MIS')),
      price: Number(result.averagePrice) || Number(quote.c),
      quantity: Number(result.filledQuantity) || 0,
    }).total,
  };
  if (result.deduplicated) {
    const mirrored = account.positions.some((position) => (
      (position.brokerOrderId && position.brokerOrderId === result.brokerOrderId)
      || (position.brokerOrderRef && position.brokerOrderRef === result.orderId)
    ));
    if (!mirrored && Number(result.filledQuantity) > 0) {
      const position = openPosition(account, {
        symbol,
        qty: Number(result.filledQuantity),
        price: Number(result.averagePrice) || Number(quote.c),
        quote,
        signal,
        live: liveMeta,
        recovered: true,
      });
      await establishLiveProtection(userId, account, position);
    }
    return result;
  }
  if (Number(result.filledQuantity) > 0) {
    const position = openPosition(account, {
      symbol,
      qty: Number(result.filledQuantity),
      price: Number(result.averagePrice) || Number(quote.c),
      quote,
      signal,
      live: liveMeta,
    });
    await establishLiveProtection(userId, account, position);
  } else {
    addOrder(account, {
      symbol,
      side: 'Buy',
      qty: result.quantity,
      price: Number(quote.c),
      status: displayOrderStatus(result.status),
      quoteBasis: 'live',
      execution: 'live',
      brokerOrderId: result.brokerOrderId,
      brokerOrderIdRef: result.orderId,
      reason: result.status === 'unverified'
        ? 'Broker did not confirm the order; reconciliation required and no resubmission was attempted.'
        : 'Accepted by the broker; awaiting a verified fill before a position is created.',
    });
    pushEvent(account, {
      type: 'entry_pending',
      severity: 'warning',
      title: `Entry not yet confirmed: ${symbol}`,
      symbol,
      message: result.status === 'unverified'
        ? `The ${broker} order response was uncertain. No position was created and the order was not resubmitted; the reconciler will check the broker order book.`
        : `The ${broker} entry for ${symbol} was accepted but has not filled yet. A position will be created only after a verified fill.`,
    });
  }
  account.execution.lastEntryError = null;
  return result;
};

const establishLiveProtection = async (userId, account, position) => {
  try {
    const protection = await submitProtectiveStop({
      userId,
      broker: liveBrokerOf(account),
      position,
    });
    position.protectionOrderId = protection.orderId;
    position.protectionBrokerOrderId = protection.brokerOrderId;
    position.protectionTrigger = protection.triggerPrice;
    if (protection.status !== 'submitted') {
      const filled = Math.min(Number(protection.filledQuantity) || 0, position.qty);
      position.protectionFilledQuantity = filled;
      if (filled > 0) {
        closePosition(account, position,
          Number(protection.averagePrice) || Number(position.lastPrice) || position.entryPrice,
          'stop_loss', null, { qty: filled, live: { brokerOrderId: protection.brokerOrderId, status: protection.status } });
      }
      if (account.positions.includes(position)) {
        position.protectionStatus = 'pending_exit';
        pauseLiveEntries(account, {
          type: 'live_protection_failed',
          title: `Broker stop-loss triggered: ${position.symbol}`,
          message: `The protective stop has already filled ${filled} share(s); its remaining quantity is being reconciled. New entries and replacement sells are paused.`,
        });
      } else {
        pushEvent(account, {
          type: 'protective_stop_triggered',
          severity: 'warning',
          title: `Broker stop-loss executed: ${position.symbol}`,
          symbol: position.symbol,
          message: `The broker confirmed the stop-loss fill for ${filled} ${position.symbol} share(s).`,
        });
      }
      return;
    }
    position.protectionStatus = protection.status;
    position.protectionValidity = 'DAY';
    position.protectionDate = istNow().dateKey;
    position.protectionQuantity = position.qty;
    position.protectionFilledQuantity = 0;
    pushEvent(account, {
      type: 'live_protection_submitted',
      severity: 'success',
      title: `Broker stop-loss submitted: ${position.symbol}`,
      symbol: position.symbol,
      message: `${position.qty} share(s) protected by broker SL-M at ₹${protection.triggerPrice}. The stop is valid for today's session; trailing updates remain monitored by the backend.`,
    });
  } catch (error) {
    position.protectionStatus = 'failed';
    pauseLiveEntries(account, {
      type: 'live_protection_failed',
      title: `Live position needs stop-loss protection: ${position.symbol}`,
      message: `${error.message} New live entries have been paused. Check the broker order book and protect or close this position before resuming.`,
    });
  }
};

const cancelPositionProtection = async (userId, account, position, reason) => {
  if (!position.protectionOrderId) return true;
  if (position.protectionStatus === 'expired') {
    position.protectionOrderId = null;
    position.protectionBrokerOrderId = null;
    return true;
  }
  try {
    await cancelProtectiveStop({ userId, broker: liveBrokerOf(account), position, reason });
    position.protectionOrderId = null;
    position.protectionBrokerOrderId = null;
    position.protectionStatus = 'cancelled';
    return true;
  } catch (error) {
    pauseLiveEntries(account, {
      type: 'live_protection_failed',
      title: `Could not safely replace the ${position.symbol} stop-loss`,
      message: `${error.message} No additional market sell order was sent, to avoid a duplicate exit. Check the broker order book.`,
    });
    return false;
  }
};

const runAccountCycle = async (userId, account, deps) => {
  if (account.status === 'stopped') return;
  if (cyclesInFlight.has(userId)) return;
  account.userId = userId;
  cyclesInFlight.add(userId);
  try {
  const startedAt = Date.now();
  const ist = ensureDaily(account);
  if (typeof deps.getMarketSession === 'function') {
    let marketSession = null;
    try {
      marketSession = await deps.getMarketSession();
    } catch {
      marketSession = null;
    }
    if (marketSession?.isVerified) {
      ist.isTradingDay = marketSession.isTradingDay === true;
      ist.marketVerified = true;
      ist.marketHoliday = marketSession.holiday || null;
      ist.marketStatus = marketSession.status;
      ist.sessionOpen = marketSession.isOpen === true;
      ist.squareOffWindow = marketSession.squareOffWindow === true;
      ist.weekend = marketSession.isWeekend === true;
      ist.minutes = Number(marketSession.minutes) || ist.minutes;
      ist.clock = marketSession.clock || ist.clock;
      ist.dateKey = marketSession.date || ist.dateKey;
    } else {
      ist.isTradingDay = false;
      ist.marketVerified = false;
      ist.marketHoliday = null;
      ist.marketStatus = marketSession?.status || 'STATUS UNVERIFIED';
      ist.sessionOpen = false;
      ist.squareOffWindow = false;
    }
  } else {
    ist.isTradingDay = !ist.weekend;
    ist.marketVerified = false;
    ist.marketStatus = 'Local weekday schedule';
  }
  const isLive = isLiveAccount(account);
  const broker = liveBrokerOf(account);
  const wanted = [...new Set([...account.watchlist, ...account.positions.map((position) => position.symbol)])];
  let quotes = {};
  let quoteError = null;
  if (isLive) {
    try {
      const batch = await liveQuoteSnapshot({ userId, account, symbols: wanted });
      quotes = batch.quotes || {};
      account.scan.missingSymbols = (batch.missing || []).slice(0, 20);
    } catch (error) {
      quoteError = `${broker} live quotes are unavailable: ${error.message}`;
      quotes = {};
    }
  } else {
    try {
      quotes = (await deps.quoteBatch(wanted)) || {};
    } catch (error) {
      quoteError = error.message || 'The market quote provider did not respond.';
    }
  }

  account.scan.lastError = quoteError;
  const quoteCount = Object.values(quotes).filter((quote) => Number(quote?.c) > 0).length;
  const bases = Object.values(quotes).map(quoteBasisOf);
  account.scan.dataBasis = bases.includes('live') ? 'live' : bases.includes('delayed') ? 'delayed' : 'unavailable';
  account.scan.quoteSource = isLive ? `${broker} broker REST` : 'configured market data provider';
  account.scan.quoteCount = quoteCount;
  if (isLive && (quoteError || quoteCount === 0)) {
    const detail = quoteError || `${broker} returned no usable broker quotes.`;
    account.scan.lastError = detail;
    pauseLiveEntries(account, {
      type: 'broker_connection_lost',
      title: 'Live broker quotes unavailable',
      message: `${detail} New live entries are paused. Open positions remain monitored, but broker-side protection must be checked in the broker order book.`,
    });
  }

  if (!quoteCount && account.positions.length) {
    const lastWarning = account.scan.lastDataWarningAt ? new Date(account.scan.lastDataWarningAt).getTime() : 0;
    if (Date.now() - lastWarning > 10 * 60 * 1000) {
      account.scan.lastDataWarningAt = nowIso();
      pushEvent(account, {
        type: 'data_unavailable',
        severity: 'warning',
        title: 'Market data unavailable',
        message: quoteError || 'No verified quotes were returned. Open positions were not re-priced this cycle.',
      });
    }
  }

  let brokerPositions = null;
  if (isLive) {
    try {
      const sync = await syncAiBrokerOrders({ userId, broker });
      if (sync?.updated?.length) {
        const changed = applyBrokerOrderUpdates(account, sync.updated);
        account.execution.lastSyncAt = nowIso();
        addAudit(account, 'broker_sync', `${sync.updated.length} AI order(s) reconciled with the ${broker} order book${changed ? '; the mirror was updated' : ''}.`);
      }
      account.execution.syncError = sync?.error || null;
      if (sync?.error) {
        pauseLiveEntries(account, {
          type: 'broker_connection_lost',
          title: 'Live broker order book unavailable',
          message: `${broker} order synchronization failed (${sync.error}). New live entries are paused; existing protective orders remain with the broker.`,
        });
      }
    } catch (error) {
      account.execution.syncError = error.message;
      pauseLiveEntries(account, {
        type: 'broker_connection_lost',
        title: 'Live broker order synchronization failed',
        message: `${error.message} New live entries are paused; existing protective orders remain with the broker.`,
      });
    }
    try {
      brokerPositions = await fetchBrokerPositions({ userId, broker });
      account.execution.brokerPositionCount = [...brokerPositions.values()]
        .filter((row) => Math.abs(Number(row.quantity) || 0) > 0).length;
    } catch (error) {
      brokerPositions = null;
      account.execution.brokerPositionCount = null;
      account.execution.syncError = account.execution.syncError || `Broker positions: ${error.message}`;
      pauseLiveEntries(account, {
        type: 'broker_connection_lost',
        title: 'Live broker positions unavailable',
        message: `${error.message} New live entries are paused because current broker exposure could not be verified.`,
      });
    }
    await reconcileMirrorWithBroker(userId, account, brokerPositions, quotes);
    if (brokerPositions && ist.sessionOpen && !account.execution.syncError) {
      for (const position of [...account.positions]) {
        if (position.execution !== 'live'
          || ['failed', 'pending_exit'].includes(position.protectionStatus)) continue;
        if (position.protectionStatus === 'expired' || !position.protectionOrderId) {
          position.protectionOrderId = null;
          position.protectionBrokerOrderId = null;
          await establishLiveProtection(userId, account, position);
        }
      }
    }
  }

  const eodSquareOff = account.tradeStyle === 'intraday' && ist.isTradingDay === true
    && ist.minutes >= 15 * 60 + 30 && ist.minutes < EOD_SQUARE_OFF_END_MINUTES;
  const squareOffActive = ist.squareOffWindow || eodSquareOff;

  for (const position of [...account.positions]) {
    const quote = quotes[position.symbol];
    const basis = quoteBasisOf(quote);
    const quoteUsable = isQuoteUsable(quote, quoteAgeBudget(EXIT_QUOTE_MAX_AGE_MS, basis), basis)
      || (squareOffActive && isQuoteUsable(quote, EOD_SQUARE_OFF_QUOTE_MAX_AGE_MS, basis));
    if (!quoteUsable) continue;
    const price = round2(quote.c);
    position.lastPrice = price;
    position.lastQuoteAt = nowIso();
    position.quoteBasis = quoteBasisOf(quote);
    position.highWater = round2(Math.max(position.highWater || position.entryPrice, price));

    if (isLive && position.protectionStatus === 'submitted'
      && Number(position.protectionQuantity) !== Number(position.qty)) {
      try {
        await modifyProtectiveStop({ userId, broker, position });
        position.protectionQuantity = position.qty;
      } catch (error) {
        position.protectionStatus = 'failed';
        pauseLiveEntries(account, {
          type: 'live_protection_failed',
          title: `Could not resize ${position.symbol} stop-loss`,
          message: `${error.message} New live entries are paused; verify that the broker stop quantity covers the open position.`,
        });
      }
    }

    const priorStopLoss = position.stopLoss;
    const trailingCandidate = position.highWater * (1 - account.risk.trailingStopPercent / 100);
    const trailingArmed = position.highWater > position.entryPrice * (1 + account.risk.trailingStopPercent / 100);
    if (trailingArmed && trailingCandidate > position.stopLoss + 0.005) {
      position.stopLoss = round2(trailingCandidate);
      position.stopLossKind = 'trailing';
    }
    if (isLive && position.stopLoss !== priorStopLoss && position.protectionStatus === 'submitted') {
      try {
        const updatedProtection = await modifyProtectiveStop({ userId, broker, position });
        position.protectionTrigger = updatedProtection.triggerPrice;
      } catch (error) {
        position.protectionStatus = 'failed';
        pauseLiveEntries(account, {
          type: 'live_protection_failed',
          title: `Could not update ${position.symbol} trailing stop`,
          message: `${error.message} New live entries are paused; verify the broker's existing stop-loss order immediately.`,
        });
      }
    }

    let exitReason = null;
    const carriedFromSession = account.tradeStyle === 'intraday' && ist.sessionOpen
      && istDateKeyOf(position.entryAt) !== null && istDateKeyOf(position.entryAt) !== ist.dateKey;
    if (price <= position.stopLoss) exitReason = position.stopLossKind === 'trailing' ? 'trailing_stop' : 'stop_loss';
    else if (price >= position.target) exitReason = 'target';
    else if (account.tradeStyle === 'intraday' && (squareOffActive || carriedFromSession)) exitReason = 'square_off';
    if (isLive && position.protectionStatus === 'pending_exit') continue;
    if (!exitReason) continue;

    if (isLive) {
      if (!ist.sessionOpen) {
        const lastNotice = account.execution.eodSquareNoticeAt ? Date.parse(account.execution.eodSquareNoticeAt) : 0;
        if (Date.now() - lastNotice > 60 * 60 * 1000) {
          account.execution.eodSquareNoticeAt = nowIso();
          pushEvent(account, {
            type: 'exit_pending_market_open',
            severity: 'info',
            title: `Live exit awaiting market open: ${position.symbol}`,
            symbol: position.symbol,
            message: `The ${exitReason.replace(/_/g, ' ')} rule was reached while the NSE session was closed. No live exit order was sent; it will be checked again during a verified trading session.`,
          });
          addAudit(account, 'exit_pending_market_open', `${position.symbol}: ${exitReason} reached outside a verified NSE session; exit order deferred.`);
        }
        continue;
      }
      try {
        if (!await cancelPositionProtection(userId, account, position, `Replacing stop with ${exitReason} exit`)) continue;
        const result = await submitLiveExit({
          userId,
          broker,
          position: { ...position, tradeStyle: account.tradeStyle },
          reason: exitReason,
          marketOpen: ist.sessionOpen,
        });
        handleLiveExitResult(account, position, result, exitReason, quote);
        if (account.positions.includes(position) && position.qty > 0
          && ['rejected', 'cancelled'].includes(result.status)) {
          await establishLiveProtection(userId, account, position);
        } else if (account.positions.includes(position) && position.qty > 0) {
          position.protectionStatus = 'pending_exit';
          pauseLiveEntries(account, {
            type: 'live_protection_failed',
            title: `Live exit still pending: ${position.symbol}`,
            message: `The broker has not confirmed the full exit. No replacement stop was sent to avoid a duplicate sell; verify the broker order and remaining position.`,
          });
        }
      } catch (error) {
        account.execution.syncError = error.message;
        pushEvent(account, {
          type: 'exit_failed',
          severity: 'critical',
          title: `Live exit failed: ${position.symbol}`,
          symbol: position.symbol,
          message: `${error.message} The position remains open and the exit will be retried on the next scan.`,
        });
        addAudit(account, 'exit_failed', `${position.symbol}: ${error.message}`);
      }
    } else {
      closePosition(account, position, price, exitReason, quote, {
        note: carriedFromSession
          ? 'Carried over from an earlier session; intraday positions are squared off as soon as the session quotes them.'
          : eodSquareOff
            ? 'Intraday square-off settled at the published day close after the session ended.'
            : null,
      });
    }
  }

  const metrics = markToMarket(account);
  const riskBaseline = Number(account.daily.riskBaselineEquity || account.daily.startEquity || metrics.equity);
  const dayPnl = round2(metrics.equity - riskBaseline);
  if (!account.daily.halted && dayPnl <= -account.risk.maxDailyLoss) {
    account.daily.halted = true;
    account.daily.haltReason = `Daily loss limit of ₹${account.risk.maxDailyLoss.toLocaleString('en-IN')} reached.`;
    account.daily.haltedAt = nowIso();
    pushEvent(account, {
      type: 'risk_limit_reached',
      severity: 'critical',
      title: 'Daily risk limit reached',
      message: `${account.daily.haltReason} No new auto entries will be opened today; open positions are still managed. Resume requires explicit authorization.`,
    });
    addAudit(account, 'risk_halt', account.daily.haltReason);
    if (isLive) {
      try {
        const cancelled = await cancelOpenAiEntries({ userId, broker, reason: 'Daily risk limit reached' });
        if (cancelled?.cancelled?.length) {
          addAudit(account, 'risk_halt_cancel', `${cancelled.cancelled.length} unfilled ${broker} entry order(s) cancelled.`);
        }
      } catch (error) {
        addAudit(account, 'risk_halt_cancel_failed', `Unfilled live entries could not be cancelled: ${error.message}`);
      }
    }
  }

  let occupiedSlots = isLive && brokerPositions
    ? [...brokerPositions.values()].filter((row) => Math.abs(Number(row.quantity) || 0) > 0).length
    : account.positions.length;
  const canEnter = account.status === 'running'
    && ist.sessionOpen
    && !account.daily.halted
    && !account.emergencyStopped
    && !isKillSwitchActive(userId)
    && account.daily.tradesCount < account.risk.maxDailyTrades
    && occupiedSlots < account.risk.maxOpenPositions
    && quoteCount > 0
    && (!isLive || (brokerPositions !== null
      && !account.execution.syncError
      && account.positions.every((position) => position.protectionStatus === 'submitted')));

  if (canEnter) {
    const duplicateMs = account.risk.duplicateWindowMinutes * 60 * 1000;
    const fatalLiveCodes = new Set([
      'live_trading_disabled', 'unknown_broker', 'broker_not_configured', 'broker_paper_mode',
      'broker_not_connected', 'live_consent_required', 'instrument_unmapped',
      'broker_funds_unavailable', 'quote_unavailable', 'stale_quote', 'market_closed',
    ]);
    for (const symbol of account.watchlist) {
      if (account.daily.tradesCount >= account.risk.maxDailyTrades) break;
      if (occupiedSlots >= account.risk.maxOpenPositions) break;
      if (account.positions.some((position) => position.symbol === symbol)) continue;
      const lastExit = Number(account.cooldowns[symbol]);
      if (Number.isFinite(lastExit) && Date.now() - lastExit < duplicateMs) continue;
      const quote = quotes[symbol];
      const entryBasis = quoteBasisOf(quote);
      if (!isQuoteUsable(quote, quoteAgeBudget(ENTRY_QUOTE_MAX_AGE_MS, entryBasis), entryBasis)) continue;

      let signal;
      try {
        signal = await loadSignal(symbol, deps);
      } catch (error) {
        account.scan.signalError = error.message;
        continue;
      }
      // A user can pause or emergency-stop while signal history is loading.
      // Re-check before authorizing an entry so an in-flight scan cannot place
      // one more order after the stop request.
      if (account.status !== 'running' || account.emergencyStopped || isKillSwitchActive(userId)) break;
      account.scan.signalError = null;
      if (signal.action !== 'Buy' || signal.score < account.risk.minSignalScore) continue;
      const recentSignalNotice = account.events.some((event) => event.type === 'ai_signal'
        && event.symbol === symbol
        && Date.now() - new Date(event.at).getTime() < 15 * 60_000);
      if (!recentSignalNotice) {
        pushEvent(account, {
          type: 'ai_signal',
          severity: 'info',
          title: `AI signal qualified: ${symbol}`,
          symbol,
          message: `Rules-based Buy score ${signal.score}/100 · trend ${signal.trend || 'unavailable'} · RSI ${signal.rsi14 ?? 'unavailable'} · 20-day momentum ${signal.momentum20Percent ?? 'unavailable'}% · ${quoteBasisOf(quote)} quote. Risk Shield must approve any entry.`,
        });
      }

      if (isLive) {
        try {
          const result = await openLiveEntry({ userId, account, symbol, quote, signal, ist });
          if (result?.verified) occupiedSlots += 1;
        } catch (error) {
          account.execution.lastEntryError = error.message;
          if (error.code === 'risk_blocked' || error.code === 'insufficient_budget') {
            recordRejection(account, symbol, `Live Risk Shield blocked: ${error.message}`, quote);
          } else {
            pushEvent(account, {
              type: 'live_entry_failed',
              severity: 'warning',
              title: `Live entry not placed: ${symbol}`,
              symbol,
              message: `${error.message} No order was sent${error.detail?.orderId ? ` (order record ${error.detail.orderId})` : ''}.`,
            });
          }
          addAudit(account, 'live_entry_failed', `${symbol}: ${error.code || 'error'} · ${error.message}`);
          if (fatalLiveCodes.has(error.code)) break;
          continue;
        }
        if (account.status !== 'running') break;
        if (account.positions.length >= account.risk.maxOpenPositions) break;
        continue;
      }

      const ageMs = quoteAgeMs(quote);
      const shieldDecision = authorizeEntry({
        userId,
        account,
        quote,
        signal,
        source: 'auto',
        marketOpen: ist.sessionOpen,
        quoteAgeSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
        actor: { id: userId, role: 'system', name: 'AI Auto Trader' },
      });
      if (!shieldDecision.allowed) {
        recordRejection(account, symbol, `Risk Shield blocked: ${shieldDecision.reason}`, quote);
        continue;
      }
      const position = openPosition(account, {
        symbol,
        qty: shieldDecision.qty,
        price: round2(quote.c),
        quote,
        signal,
        idempotencyKey: shieldDecision.idempotencyKey,
      });
      publish('order.executed', {
        userId,
        orderId: position.orderId || null,
        positionId: position.id,
        symbol,
        qty: shieldDecision.qty,
        price: round2(quote.c),
        idempotencyKey: shieldDecision.idempotencyKey,
        shieldDecisionId: shieldDecision.id,
        at: nowIso(),
      });
      if (account.positions.length >= account.risk.maxOpenPositions) break;
    }
  }

  const finishedAt = Date.now();
  account.scan.lastRunAt = new Date(finishedAt).toISOString();
  account.scan.lastDurationMs = finishedAt - startedAt;
  account.scan.marketOpen = ist.sessionOpen;
  account.scan.marketStatus = ist.marketStatus;
  account.scan.marketVerified = ist.marketVerified;
  account.scan.istClock = ist.clock;
  account.updatedAt = nowIso();
  persistStore();
  } finally {
    cyclesInFlight.delete(userId);
  }
};

const publicChannels = (account) => {
  const channels = notificationChannels(account.userId ? findUserById(account.userId) : null);
  return {
    inApp: channels.inApp.enabled,
    browser: { supported: true, enabled: account.notifications.browser === true },
    telegram: {
      configured: telegramConfigured(),
      enabled: account.notifications.telegram === true,
      missing: telegramConfigured() ? [] : ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    },
    email: channels.email,
    push: channels.push,
  };
};

const publicPosition = (position) => {
  const last = Number(position.lastPrice) > 0 ? position.lastPrice : position.entryPrice;
  const invested = round2(position.qty * position.entryPrice);
  const marketValue = round2(position.qty * last);
  const pnl = round2(marketValue - invested);
  return {
    ...position,
    lastPrice: round2(last),
    investedValue: invested,
    marketValue,
    unrealizedPnl: pnl,
    unrealizedPnlPercent: invested > 0 ? round2((pnl / invested) * 100) : 0,
    stopLossDistancePercent: last > 0 ? round2(((last - position.stopLoss) / last) * 100) : null,
    targetDistancePercent: last > 0 ? round2(((position.target - last) / last) * 100) : null,
  };
};

const publicStatus = (account, deps) => {
  const metrics = markToMarket(account);
  const dailyStart = Number(account.daily.startEquity || metrics.equity);
  const dayPnl = round2(metrics.equity - dailyStart);
  const ist = istNow();
  const marketSession = deps.getMarketSessionSnapshot ? deps.getMarketSessionSnapshot() : null;
  const isLive = isLiveAccount(account);
  const brokerStatus = deps.getBrokerStatus ? deps.getBrokerStatus() : null;
  return {
    status: account.status,
    mode: account.mode,
    execution: {
      mode: account.mode,
      broker: account.execution.broker,
      enabledAt: account.execution.enabledAt,
      enabledBy: account.execution.enabledBy,
      lastReadiness: account.execution.lastReadiness,
      lastSyncAt: account.execution.lastSyncAt,
      syncError: account.execution.syncError,
      lastLiveQuoteAt: account.execution.lastLiveQuoteAt,
      lastEntryError: account.execution.lastEntryError,
      brokerPositionCount: account.execution.brokerPositionCount,
      slotSource: isLive ? 'Verified broker net positions' : 'Virtual paper positions',
      protectiveExits: isLive
        ? 'Broker-side SL-M stop-loss (DAY validity); target and trailing exits are backend-managed.'
        : 'Paper exits are simulated by the backend worker.',
      liveHealth: liveExecutionHealth(),
    },
    liveTrading: {
      enabled: isLive,
      masterFlag: liveTradingMasterEnabled(),
      reason: isLive
        ? `Live automation is enabled through ${account.execution.broker}. Every entry needs a fresh broker quote, verified funds, Risk Shield approval and per-account live consent; every position is mirrored only after a verified fill.`
        : 'Paper mode: no broker order is sent by the AI engine. Live automation can be enabled only after a broker account is connected, per-account consent is granted and LIVE_TRADING_ENABLED=1 is set on the server.',
      broker: brokerStatus,
    },
    emergencyStopped: account.emergencyStopped,
    autoStartPaper: account.autoStartPaper === true,
    automationSchedulerAvailable: deps.automationSchedulerAvailable
      ? deps.automationSchedulerAvailable()
      : true,
    automationWorker: {
      ...schedulerHealth,
      intervalMs: SCAN_INTERVAL_MS,
    },
    tradeStyle: account.tradeStyle,
    watchlist: account.watchlist,
    risk: account.risk,
    notifications: account.notifications,
    startingCapital: account.startingCapital,
    cash: round2(account.cash),
    investedValue: metrics.investedValue,
    marketValue: metrics.marketValue,
    equity: metrics.equity,
    unrealizedPnl: metrics.unrealizedPnl,
    dayPnl,
    dayPnlPercent: dailyStart > 0 ? round2((dayPnl / dailyStart) * 100) : 0,
    totalPnl: round2(metrics.equity - account.startingCapital),
    totalPnlPercent: account.startingCapital > 0 ? round2(((metrics.equity - account.startingCapital) / account.startingCapital) * 100) : 0,
    daily: { ...account.daily, dayPnl },
    openPositions: account.positions.length,
    positions: account.positions.map(publicPosition),
    closedPositions: account.closedPositions.slice(0, 30),
    orders: account.orders.slice(0, 100),
    trades: account.trades.slice(0, 100),
    events: account.events.slice(0, 60),
    audit: account.audit.slice(0, 80),
    scan: account.scan,
    market: {
      ...(marketSession || {}),
      isOpen: marketSession ? marketSession.isOpen === true : false,
      isVerified: marketSession?.isVerified === true,
      status: marketSession?.status || 'STATUS UNVERIFIED',
      subtext: marketSession?.subtext || 'NSE holiday status is being checked.',
      clock: marketSession?.clock || ist.clock,
      date: marketSession?.date || ist.dateKey,
      venue: 'NSE equity session 09:15–15:30 IST',
      squareOffAt: '15:15 IST',
      squareOffActive: marketSession?.squareOffWindow === true
        || (marketSession?.isTradingDay === true
          && !marketSession.isWeekend
          && marketSession.minutes >= 15 * 60 + 30
          && marketSession.minutes < EOD_SQUARE_OFF_END_MINUTES),
      squareOffSettleAfterClose: '15:30–20:00 IST at the published day close',
    },
    channels: publicChannels(account),
    ai: { llmConfigured: deps.aiConfigured ? deps.aiConfigured() : false },
    broker: brokerStatus,
    updatedAt: account.updatedAt,
    createdAt: account.createdAt,
    disclaimers: isLive
      ? [
        `Live automation is enabled through ${account.execution.broker}. Orders are real broker orders routed only after all gates pass; fills are mirrored from verified broker data.`,
        'Signals and backtests are rules-based analysis of delayed daily history, not predictions or guarantees. Intraday entries use broker REST quotes.',
        'The engine samples quotes every 20 seconds; stop-loss and target exits are market orders, so the fill can differ from the trigger level.',
        'Estimated charges are indicative; the broker contract note is authoritative. Investing in securities carries risk. This is not investment advice.',
      ]
      : [
        'Paper automation only: orders are virtual and no broker order is sent.',
        'Signals and backtests are rules-based analysis of delayed daily data, not predictions or guarantees.',
        'The engine samples quotes every 20 seconds; stop-loss and target fills can differ from the exact trigger level.',
        'Investing in securities carries risk. This is not investment advice.',
      ],
  };
};

const sanitizeRisk = (input, current) => {
  const risk = { ...current };
  const number = (key, min, max) => {
    const value = Number(input?.[key]);
    if (Number.isFinite(value)) risk[key] = clamp(value, min, max);
  };
  number('maxDailyLoss', 1000, 10000000);
  number('maxInvestmentPerTrade', 1000, 50000000);
  number('maxDailyTrades', 1, 50);
  number('maxOpenPositions', 1, 20);
  number('maxPortfolioExposurePercent', 5, 100);
  number('minSignalScore', 30, 90);
  number('duplicateWindowMinutes', 1, 240);
  number('stopLossPercent', 0.2, 20);
  number('targetPercent', 0.2, 40);
  number('trailingStopPercent', 0.2, 15);
  for (const key of ['maxDailyTrades', 'maxOpenPositions', 'minSignalScore', 'duplicateWindowMinutes']) {
    risk[key] = Math.round(risk[key]);
  }
  for (const key of ['maxDailyLoss', 'maxInvestmentPerTrade', 'maxPortfolioExposurePercent', 'stopLossPercent', 'targetPercent', 'trailingStopPercent']) {
    risk[key] = round2(risk[key]);
  }
  return risk;
};

export const BACKTEST_RULES = Object.freeze({
  sma_cross: 'SMA20 is above SMA50',
  above_sma20: 'Price is above SMA20',
  momentum_positive: '20-bar momentum is above the configured minimum',
  rsi_below: 'RSI14 is below the configured maximum',
  breakout_20: 'Price closes above the previous 20-bar high',
  volume_surge: 'Volume is above 1.5x its 20-bar average',
});

const DEFAULT_ENTRY_RULES = ['sma_cross', 'above_sma20', 'momentum_positive', 'rsi_below'];

const maxHighBefore = (series, index, period) => {
  let high = null;
  for (let offset = Math.max(0, index - period); offset < index; offset += 1) {
    const value = series[offset]?.high;
    if (!Number.isFinite(value)) continue;
    high = high == null ? value : Math.max(high, value);
  }
  return high;
};

const averageVolumeBefore = (series, index, period) => {
  let total = 0;
  let count = 0;
  for (let offset = Math.max(0, index - period); offset < index; offset += 1) {
    const value = series[offset]?.volume;
    if (!Number.isFinite(value) || value <= 0) continue;
    total += value;
    count += 1;
  }
  return count >= Math.max(5, Math.floor(period / 2)) ? total / count : null;
};

const entryRulesSatisfied = (series, closes, index, { rules, rsiMax, momentumMinPercent }) => {
  const close = closes[index];
  const s20 = smaAt(closes, index, 20);
  const s50 = smaAt(closes, index, 50);
  const rsi = rsiAt(closes, index, 14);
  const momentum = closes[index - 20] > 0 ? closes[index] / closes[index - 20] - 1 : null;
  for (const rule of rules) {
    if (rule === 'sma_cross') {
      if (!(s20 !== null && s50 !== null && s20 > s50)) return false;
    } else if (rule === 'above_sma20') {
      if (!(s20 !== null && close > s20)) return false;
    } else if (rule === 'momentum_positive') {
      if (!(momentum !== null && momentum * 100 > momentumMinPercent)) return false;
    } else if (rule === 'rsi_below') {
      if (!(rsi === null || rsi < rsiMax)) return false;
    } else if (rule === 'breakout_20') {
      const priorHigh = maxHighBefore(series, index, 20);
      if (!(priorHigh !== null && close > priorHigh)) return false;
    } else if (rule === 'volume_surge') {
      const average = averageVolumeBefore(series, index, 20);
      const volume = series[index]?.volume;
      if (!(average && Number.isFinite(volume) && volume > average * 1.5)) return false;
    }
  }
  return true;
};

const runBacktest = ({
  symbol,
  candles,
  days,
  targetPercent,
  stopLossPercent,
  costBps,
  rules = DEFAULT_ENTRY_RULES,
  rsiMax = 72,
  momentumMinPercent = 0.5,
}) => {
  const series = candles.filter((candle) => candle.close > 0).slice(-days);
  const closes = series.map((candle) => candle.close);
  const trades = [];
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let inPosition = null;
  let pendingEntry = null;
  let pendingTrendExit = false;
  const curve = [];
  const flatCost = Number.isFinite(costBps);
  const model = flatCost ? null : costPercentForNotional(100000);
  const buyCost = flatCost ? costBps / 10000 : model.buyPercent / 100;
  const sellCost = flatCost ? costBps / 10000 : model.sellPercent / 100;
  const activeRules = [...new Set((Array.isArray(rules) && rules.length ? rules : DEFAULT_ENTRY_RULES)
    .filter((rule) => Object.hasOwn(BACKTEST_RULES, rule)))];

  const closeTrade = (exitPrice, exitTime, exitReason) => {
    const netExit = exitPrice * (1 - sellCost);
    const returnPercent = (netExit / inPosition.entryPrice - 1) * 100;
    equity = inPosition.equityAtEntry * (netExit / inPosition.entryPrice);
    trades.push({
      entryAt: new Date(inPosition.entryTime * 1000).toISOString(),
      exitAt: new Date(exitTime * 1000).toISOString(),
      entryPrice: round2(inPosition.entryPrice),
      exitPrice: round2(netExit),
      returnPercent: round2(returnPercent),
      exitReason,
    });
    inPosition = null;
    pendingTrendExit = false;
  };

  for (let index = 50; index < series.length; index += 1) {
    const candle = series[index];
    const close = candle.close;
    const open = Number.isFinite(candle.open) && candle.open > 0 ? candle.open : close;
    const low = Number.isFinite(candle.low) ? candle.low : Math.min(open, close);
    const high = Number.isFinite(candle.high) ? candle.high : Math.max(open, close);

    if (pendingEntry) {
      inPosition = {
        entryPrice: open * (1 + buyCost),
        entryTime: candle.time,
        equityAtEntry: equity,
      };
      pendingEntry = null;
    }

    if (inPosition) {
      const stop = inPosition.entryPrice * (1 - stopLossPercent / 100);
      const target = inPosition.entryPrice * (1 + targetPercent / 100);
      if (low <= stop) {
        closeTrade(Math.min(open, stop), candle.time, 'stop_loss');
      } else if (high >= target) {
        closeTrade(Math.max(open, target), candle.time, 'target');
      } else if (pendingTrendExit) {
        closeTrade(open, candle.time, 'trend_exit');
      }
    }

    if (!inPosition && !pendingEntry) {
      if (entryRulesSatisfied(series, closes, index, {
        rules: activeRules,
        rsiMax,
        momentumMinPercent,
      })) {
        pendingEntry = { signalTime: candle.time };
      }
    }

    if (inPosition) {
      const s20 = smaAt(closes, index, 20);
      const s50 = smaAt(closes, index, 50);
      if (s20 !== null && s50 !== null && s20 < s50) pendingTrendExit = true;
    }

    const marked = inPosition ? inPosition.equityAtEntry * (close / inPosition.entryPrice) : equity;
    peak = Math.max(peak, marked);
    maxDrawdown = Math.max(maxDrawdown, ((peak - marked) / peak) * 100);
    curve.push({ time: candle.time, equity: round4(marked) });
  }

  if (inPosition) {
    const last = series[series.length - 1];
    closeTrade(last.close, last.time, 'end_of_test');
    curve.push({ time: last.time, equity: round4(equity) });
  }

  const wins = trades.filter((trade) => trade.returnPercent > 0);
  const losses = trades.filter((trade) => trade.returnPercent <= 0);
  const grossWin = wins.reduce((total, trade) => total + trade.returnPercent, 0);
  const grossLoss = Math.abs(losses.reduce((total, trade) => total + trade.returnPercent, 0));
  const firstClose = closes[Math.min(50, closes.length - 1)];
  const lastClose = closes[closes.length - 1];
  return {
    symbol,
    days: series.length,
    trades: trades.slice(-60),
    curve: curve.slice(-420),
    metrics: {
      totalReturnPercent: round2((equity - 1) * 100),
      buyHoldReturnPercent: firstClose > 0 ? round2((lastClose / firstClose - 1) * 100) : null,
      tradeCount: trades.length,
      winRatePercent: trades.length ? round2((wins.length / trades.length) * 100) : null,
      averageTradePercent: trades.length ? round2(trades.reduce((total, trade) => total + trade.returnPercent, 0) / trades.length) : null,
      profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : null,
      maxDrawdownPercent: round2(maxDrawdown),
      costBpsPerSide: flatCost ? costBps : round2((buyCost * 10000 + sellCost * 10000) / 2),
      costPercentRoundTrip: round2((buyCost + sellCost) * 100),
    },
    rules: activeRules,
    assumptions: [
      'Signals are evaluated on a daily close and filled at the next session open, so no signal uses a price it could not have traded.',
      'Stop-loss and target levels are checked against each session high/low; when a gap opens beyond a level the fill uses the open.',
      flatCost
        ? `A flat modelled cost of ${costBps} bps per side is applied on entry and exit.`
        : COST_MODEL_LABEL,
      `Entry rules (all must hold): ${activeRules.map((rule) => BACKTEST_RULES[rule]).join('; ') || 'none'}.`,
      'Historical simulation is not a forecast and does not guarantee future results.',
    ],
    asOf: new Date(series[series.length - 1].time * 1000).toISOString(),
  };
};

const fail = (res, status, message, code) => res.status(status).json({ error: message, code });

const requireUser = (req, res, deps) => {
  const user = deps.readSessionUser(req);
  if (!user) {
    fail(res, 401, 'Sign in to use the AI auto-trader.', 'not_authenticated');
    return null;
  }
  return user;
};

const actionGuard = new Map();
const allowAction = (userId, action, windowMs = 1200) => {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const last = actionGuard.get(key) || 0;
  if (now - last < windowMs) return false;
  actionGuard.set(key, now);
  return true;
};

const deterministicExplanation = (signal, account) => {
  const reasons = signal.reasons.length
    ? signal.reasons.map((item) => `- ${item.reason} (${item.points >= 0 ? '+' : ''}${item.points})`).join('\n')
    : '- No strong technical alignment right now.';
  const holding = account.positions.find((position) => position.symbol === signal.symbol);
  return [
    `${signal.symbol}: rules-based ${signal.action} read, score ${signal.score}/100.`,
    `Price ₹${signal.price}, 20-day SMA ₹${signal.sma20 ?? '—'}, 50-day SMA ₹${signal.sma50 ?? '—'}, RSI ${signal.rsi14 ?? '—'}, 20-day volatility ${signal.volatility20Percent ?? '—'}%.`,
    reasons,
    holding
      ? `You currently hold ${holding.qty} share(s) from ₹${holding.entryPrice}; stop ₹${holding.stopLoss}, target ₹${holding.target}.`
      : 'There is no open auto position in this symbol.',
    'This is a technical read of delayed daily bars, not a prediction or investment advice.',
  ].join('\n');
};

let runtimeDeps = null;
const schedulerHealth = {
  running: false,
  heartbeatAt: null,
  lastSweepStartedAt: null,
  lastError: null,
};

const connectedBrokerFor = (userId) => {
  const accounts = listBrokerAccounts(userId);
  return accounts.find((item) => item.status === 'connected')?.broker || null;
};

const readinessFor = async (userId, account, broker, { probe = false } = {}) => {
  const heartbeatAt = Date.parse(schedulerHealth.heartbeatAt || '');
  const workerHealthy = schedulerHealth.running
    && Number.isFinite(heartbeatAt)
    && Date.now() - heartbeatAt <= SCAN_INTERVAL_MS * 6
    && runtimeDeps?.automationSchedulerAvailable?.() !== false;
  if (!workerHealthy) {
    return {
      ready: false,
      readyForEntries: false,
      broker,
      blockers: [{ id: 'worker', detail: 'The persistent auto-trading worker is not running on this server.' }],
      checks: [{ id: 'worker', label: 'Persistent trading worker', state: 'fail', detail: 'Live automation requires the persistent backend worker.' }],
      checkedAt: nowIso(),
    };
  }
  if (!broker) {
    return {
      ready: false,
      readyForEntries: false,
      blockers: [{ id: 'broker-linked', detail: 'No broker account is connected. Open Broker Connections first.' }],
      checks: [{ id: 'broker-linked', label: 'Broker connection', state: 'fail', detail: 'No broker account is connected.' }],
      checkedAt: nowIso(),
    };
  }
  const readiness = await liveReadiness({
    userId,
    broker,
    symbols: account.watchlist.slice(0, 20),
    probe,
  });
  return { ...readiness, broker };
};

const acquireSchedulerLock = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(LOCK_PATH)) {
      let existing = null;
      try {
        existing = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
      } catch {
        existing = null;
      }
      const pid = Number(existing?.pid);
      if (pid && pid !== process.pid) {
        let alive = false;
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
        if (alive) {
          return { ok: false, reason: `Another backend process (pid ${pid}) owns the auto-trade scheduler.`, foreignPid: pid };
        }
      }
    }
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: nowIso() }), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: true, warning: `Scheduler lock could not be written: ${error.message}` };
  }
};

const releaseSchedulerLock = () => {
  try {
    const existing = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (Number(existing?.pid) === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {
    // Lock already gone or unreadable.
  }
};

export const initAutoTrade = (app, deps) => {
  runtimeDeps = deps;
  let timer = null;
  let watchdogTimer = null;
  let notificationTimer = null;
  let notificationSweepBusy = false;
  let sweeping = false;

  const runNotificationSweep = async () => {
    if (notificationSweepBusy) return { skipped: 'already_running' };
    notificationSweepBusy = true;
    try {
      const priceAlerts = await evaluatePriceAlerts(deps.quoteBatch);
      let newsNotifications = 0;
      if (typeof deps.getMarketNewsFeed === 'function') {
        const feed = await deps.getMarketNewsFeed();
        newsNotifications = notifyNewsSubscribers(feed);
      }
      return { priceAlerts, newsNotifications };
    } catch (error) {
      console.warn('Notification scan failed:', error.message);
      return { error: error.message };
    } finally {
      notificationSweepBusy = false;
    }
  };

  app.get('/api/cron/notifications', async (req, res) => {
    const secret = String(process.env.CRON_SECRET || '');
    const provided = String(req.get('authorization') || '');
    if (!secret) return fail(res, 404, 'Notification scheduler is not configured.', 'scheduler_not_configured');
    const expected = Buffer.from(`Bearer ${secret}`);
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return fail(res, 401, 'Unauthorized scheduler request.', 'scheduler_unauthorized');
    }
    res.set('Cache-Control', 'no-store');
    const result = await runNotificationSweep();
    res.json({ ok: !result.error, ...result, checkedAt: nowIso() });
  });

  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    schedulerHealth.lastSweepStartedAt = nowIso();
    schedulerHealth.lastError = null;
    try {
      for (const [userId, account] of Object.entries(store.accounts)) {
        if (account.status !== 'running' && account.status !== 'paused') continue;
        try {
          await runAccountCycle(userId, ensureAccountShape(account), deps);
        } catch (error) {
          account.scan.lastError = error.message;
          schedulerHealth.lastError = error.message;
          if (isLiveAccount(account)) {
            pauseLiveEntries(account, {
              type: 'worker_failure',
              title: 'Live trading worker failed',
              message: `${error.message} New live entries are paused. Check broker stop-loss orders and restart/resume only after reviewing the open positions.`,
            });
          }
          console.warn(`Auto-trade cycle failed for ${userId}:`, error.message);
          persistStore();
        }
      }
    } finally {
      sweeping = false;
      schedulerHealth.heartbeatAt = nowIso();
    }
  };

  const restoreAccountAutomationAfterRestart = () => {
    for (const userId of Object.keys(store.accounts)) {
      const account = ensureAccountShape(store.accounts[userId]);
      account.userId = userId;
      if (isLiveAccount(account) && account.status === 'running') {
        account.status = 'paused';
        account.autoStartPaper = false;
        account.updatedAt = nowIso();
        pushEvent(account, {
          type: 'agent_paused',
          severity: 'warning',
          title: 'Live automation paused after backend restart',
          message: 'Existing live positions remain monitored, but new live entries require you to resume the agent explicitly.',
        });
        addAudit(account, 'live_restart_pause', 'New live entries were paused after backend restart; explicit user resume is required.', 'system');
      } else {
        accountFor(userId);
      }
    }
    persistStore();
  };

  app.get('/api/autotrade/status', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    if (typeof deps.getMarketSession === 'function') {
      try { await deps.getMarketSession(); } catch { /* status endpoint remains available if the holiday feed is down */ }
    }
    res.set('Cache-Control', 'no-store');
    res.json({ account: publicStatus(accountFor(user.id), deps), serverTime: nowIso() });
  });

  app.put('/api/autotrade/config', (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    if (!allowAction(user.id, 'config')) return fail(res, 429, 'Please wait a moment before saving again.', 'too_many_requests');
    const account = accountFor(user.id);
    const body = req.body || {};
    if (Array.isArray(body.watchlist)) {
      const watchlist = [...new Set(body.watchlist.map(sanitizeSymbol).filter(Boolean))];
      if (!watchlist.length) return fail(res, 400, 'Select at least one NSE symbol.', 'invalid_watchlist');
      if (watchlist.length > 20) return fail(res, 400, 'The watchlist can hold up to 20 symbols.', 'watchlist_too_large');
      account.watchlist = watchlist;
    }
    if (body.risk && typeof body.risk === 'object') {
      account.risk = sanitizeRisk(body.risk, account.risk);
    }
    if (body.tradeStyle === 'intraday' || body.tradeStyle === 'swing') {
      account.tradeStyle = body.tradeStyle;
    }
    if (body.notifications && typeof body.notifications === 'object') {
      if (typeof body.notifications.browser === 'boolean') account.notifications.browser = body.notifications.browser;
      if (typeof body.notifications.telegram === 'boolean') account.notifications.telegram = body.notifications.telegram;
    }
    account.updatedAt = nowIso();
    addAudit(account, 'config_updated', 'Strategy, risk and notification settings saved.', 'user');
    pushEvent(account, {
      type: 'config_updated',
      severity: 'info',
      title: 'Auto-trader settings updated',
      message: `Style ${account.tradeStyle}; SL ${account.risk.stopLossPercent}%; target ${account.risk.targetPercent}%; max ${account.risk.maxDailyTrades} trades/day.`,
    });
    persistStore();
    res.json({ account: publicStatus(account, deps) });
  });

  app.get('/api/autotrade/readiness', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    const broker = String(req.query.broker || account.execution.broker || connectedBrokerFor(user.id) || '').toLowerCase();
    if (!['zerodha', 'upstox'].includes(broker)) {
      return fail(res, 400, 'Connect a supported broker (Zerodha or Upstox) before checking live readiness.', 'broker_required');
    }
    try {
      const readiness = await readinessFor(user.id, account, broker, { probe: req.query.probe === '1' });
      account.execution.lastReadiness = readiness;
      persistStore();
      res.set('Cache-Control', 'no-store');
      res.json({
        broker,
        readiness,
        brokerAccounts: listBrokerAccounts(user.id),
        execution: {
          mode: account.mode,
          broker: account.execution.broker,
          masterFlag: liveTradingMasterEnabled(),
        },
        health: liveExecutionHealth(),
      });
    } catch (error) {
      fail(res, 502, error.message || 'Live readiness could not be checked.', error.code || 'readiness_failed');
    }
  });

  app.put('/api/autotrade/execution', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    if (!allowAction(user.id, 'execution')) return fail(res, 429, 'Please wait a moment before changing the execution mode.', 'too_many_requests');
    const account = accountFor(user.id);
    const body = req.body || {};
    const mode = String(body.mode || '').toLowerCase();
    if (!['paper', 'live'].includes(mode)) return fail(res, 400, 'Choose paper or live execution.', 'invalid_mode');
    if (account.status === 'running') return fail(res, 409, 'Pause or stop the agent before changing the execution mode.', 'agent_running');

    if (mode === 'paper') {
      if (account.positions.some((position) => position.execution === 'live')) {
        return fail(res, 409, 'Close the open live positions through the broker desk before returning this agent to paper mode.', 'live_positions_open');
      }
      const previous = account.mode;
      account.mode = 'paper';
      account.execution.broker = null;
      account.updatedAt = nowIso();
      pushEvent(account, {
        type: 'execution_mode_changed',
        severity: 'info',
        title: 'Switched to paper execution',
        message: 'The AI engine no longer sends broker orders. Existing paper positions stay in the virtual ledger.',
      });
      addAudit(account, 'execution_mode_changed', `Execution mode ${previous} → paper.`, 'user');
      persistStore();
      return res.json({ account: publicStatus(account, deps) });
    }

    const broker = String(body.broker || account.execution.broker || '').toLowerCase();
    if (String(body.confirmation || '').trim().toUpperCase() !== 'ENABLE LIVE AUTO TRADING' || body.acceptRisk !== true) {
      return fail(res, 400, 'Type ENABLE LIVE AUTO TRADING and accept the live risk disclosure to authorize live execution.', 'confirmation_required');
    }
    if (!['zerodha', 'upstox'].includes(broker)) return fail(res, 400, 'Choose a supported broker (Zerodha or Upstox).', 'invalid_broker');
    if (account.positions.length) {
      return fail(res, 409, 'Close all paper positions before enabling live execution, so live slots start from verified broker positions.', 'positions_open');
    }
    let readiness;
    try {
      readiness = await readinessFor(user.id, account, broker, { probe: true });
    } catch (error) {
      return fail(res, 502, error.message || 'Live readiness could not be verified.', error.code || 'readiness_failed');
    }
    account.execution.lastReadiness = readiness;
    if (!readiness.ready) {
      persistStore();
      const reason = readiness.blockers?.map((blocker) => blocker.detail).join(' ') || 'Live readiness checks did not pass.';
      return res.status(409).json({ error: reason, code: 'live_readiness_failed', readiness });
    }
    account.mode = 'live';
    account.autoStartPaper = false;
    account.execution.broker = broker;
    account.execution.enabledAt = nowIso();
    account.execution.enabledBy = 'user';
    account.updatedAt = nowIso();
    pushEvent(account, {
      type: 'live_execution_enabled',
      severity: 'critical',
      title: `Live execution authorized via ${broker}`,
      message: `The AI engine can now place real ${broker} market orders after all gates pass: fresh broker quote, verified funds, Risk Shield approval and per-account live consent. Positions are mirrored only after a verified fill.`,
    });
    addAudit(account, 'execution_mode_live', `Live execution enabled through ${broker} after typed confirmation and readiness checks.`, 'user');
    persistStore();
    res.json({ account: publicStatus(account, deps), readiness });
  });

  app.post('/api/autotrade/sync', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    if (!isLiveAccount(account)) return fail(res, 409, 'Broker order sync is available only in live execution mode.', 'not_live');
    try {
      const sync = await syncAiBrokerOrders({ userId: user.id, broker: liveBrokerOf(account) });
      applyBrokerOrderUpdates(account, sync.updated || []);
      account.execution.lastSyncAt = nowIso();
      account.execution.syncError = sync.error || null;
      account.updatedAt = nowIso();
      persistStore();
      res.json({ sync, account: publicStatus(account, deps) });
    } catch (error) {
      account.execution.syncError = error.message;
      persistStore();
      fail(res, 502, error.message || 'Broker order sync failed.', error.code || 'sync_failed');
    }
  });

  app.post('/api/autotrade/start', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const body = req.body || {};
    if (body.acceptRisk !== true || String(body.confirmation || '').trim().toUpperCase() !== 'START AUTO TRADING') {
      return fail(res, 400, 'Confirm the risk disclosure and type START AUTO TRADING to authorize the agent.', 'confirmation_required');
    }
    const account = accountFor(user.id);
    if (account.status === 'running') return fail(res, 409, 'The auto-trader is already running.', 'already_running');
    if (!allowAction(user.id, 'start')) return fail(res, 429, 'Please wait a moment before trying again.', 'too_many_requests');
    if (isLiveAccount(account)) {
      let readiness = account.execution.lastReadiness;
      const checkedAt = readiness?.checkedAt ? new Date(readiness.checkedAt).getTime() : 0;
      if (!readiness || Date.now() - checkedAt > 5 * 60 * 1000) {
        try {
          readiness = await readinessFor(user.id, account, liveBrokerOf(account), { probe: false });
          account.execution.lastReadiness = readiness;
        } catch (error) {
          return fail(res, 503, error.message || 'Live readiness could not be verified.', error.code || 'readiness_failed');
        }
      }
      if (!readiness.ready) {
        persistStore();
        return res.status(409).json({
          error: readiness.blockers?.map((blocker) => blocker.detail).join(' ') || 'Live readiness checks did not pass.',
          code: 'live_readiness_failed',
          readiness,
        });
      }
    }
    ensureDaily(account);
    account.status = 'running';
    account.emergencyStopped = false;
    account.autoStartPaper = account.mode === 'paper';
    account.updatedAt = nowIso();
    pushEvent(account, {
      type: 'agent_started',
      severity: 'success',
      title: 'AI auto-trader started',
      message: isLiveAccount(account)
        ? `LIVE mode via ${liveBrokerOf(account)}. ${account.tradeStyle === 'intraday' ? 'Intraday' : 'Swing'} style, ${account.watchlist.length} symbols, risk caps active. Every entry still needs a fresh broker quote and Risk Shield approval.`
        : `Paper mode. ${account.tradeStyle === 'intraday' ? 'Intraday' : 'Swing'} style, ${account.watchlist.length} symbols, risk caps active.`,
    });
    addAudit(account, 'agent_started', `Agent authorized by user in ${account.mode} mode${isLiveAccount(account) ? ` through ${liveBrokerOf(account)}` : ''}. Style ${account.tradeStyle}; max daily loss ₹${account.risk.maxDailyLoss}.`, 'user');
    persistStore();
    setTimeout(() => {
      runAccountCycle(user.id, account, deps).catch((error) => console.warn('First auto-trade scan failed:', error.message));
    }, 1200).unref?.();
    res.json({ account: publicStatus(account, deps) });
  });

  app.post('/api/autotrade/pause', (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    if (account.status !== 'running') return fail(res, 409, 'The auto-trader is not running.', 'not_running');
    account.status = 'paused';
    account.updatedAt = nowIso();
    pushEvent(account, {
      type: 'agent_paused',
      severity: 'info',
      title: 'AI auto-trader paused',
      message: 'No new entries will be opened. Existing positions remain protected by stop-loss, target and trailing rules.',
    });
    addAudit(account, 'agent_paused', 'User paused new entries.', 'user');
    persistStore();
    res.json({ account: publicStatus(account, deps) });
  });

  app.post('/api/autotrade/resume', (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    const body = req.body || {};
    if (account.daily.halted) {
      if (body.acceptRisk !== true || String(body.confirmation || '').trim().toUpperCase() !== 'RESUME AUTO TRADING') {
        return fail(res, 400, 'Daily risk limits were hit. Type RESUME AUTO TRADING and accept the risk disclosure to authorize new entries.', 'halt_confirmation_required');
      }
      const metrics = markToMarket(account);
      account.daily.halted = false;
      account.daily.haltedAt = null;
      account.daily.resumedAt = nowIso();
      account.daily.riskBaselineEquity = metrics.equity;
      account.status = 'running';
      account.emergencyStopped = false;
      account.autoStartPaper = account.mode === 'paper';
      account.updatedAt = nowIso();
      pushEvent(account, {
        type: 'risk_halt_resumed',
        severity: 'warning',
        title: 'Daily risk halt cleared by user',
        message: `New entries are authorized again with a fresh risk baseline at ₹${metrics.equity.toLocaleString('en-IN')}. The original daily loss limit still applies from this baseline.`,
      });
      addAudit(account, 'risk_halt_resumed', `User authorized resuming after the daily risk halt; new risk baseline ₹${metrics.equity}.`, 'user');
      persistStore();
      return res.json({ account: publicStatus(account, deps) });
    }
    if (account.status !== 'paused') return fail(res, 409, 'The auto-trader is not paused.', 'not_paused');
    account.status = 'running';
    account.autoStartPaper = account.mode === 'paper';
    account.updatedAt = nowIso();
    pushEvent(account, {
      type: 'agent_resumed',
      severity: 'success',
      title: 'AI auto-trader resumed',
      message: isLiveAccount(account)
        ? `New entries are enabled again in live mode through ${liveBrokerOf(account)}, subject to the daily risk limits, fresh broker quotes and Risk Shield approval.`
        : 'New entries are enabled again, subject to the daily risk limits.',
    });
    addAudit(account, 'agent_resumed', 'User resumed new entries.', 'user');
    persistStore();
    res.json({ account: publicStatus(account, deps) });
  });

  app.post('/api/autotrade/stop', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    const emergency = req.body?.emergency !== false;
    const hasOpenPositions = account.positions.length > 0;
    // Keep the exit monitor alive for open positions. With no positions, the
    // scheduler can stop completely. Starting again clears emergencyStopped.
    account.status = hasOpenPositions ? 'paused' : 'stopped';
    account.emergencyStopped = emergency || account.emergencyStopped;
    account.autoStartPaper = false;
    account.updatedAt = nowIso();
    let cancelledEntries = null;
    if (isLiveAccount(account) && emergency) {
      try {
        cancelledEntries = await cancelOpenAiEntries({ userId: user.id, broker: liveBrokerOf(account), reason: 'Emergency stop' });
      } catch (error) {
        cancelledEntries = { cancelled: [], failed: [{ message: error.message }] };
      }
    }
    pushEvent(account, {
      type: emergency ? 'emergency_stop' : 'agent_stopped',
      severity: emergency ? 'critical' : 'warning',
      title: emergency ? 'Emergency stop activated' : 'AI auto-trader stopped',
      message: hasOpenPositions
        ? `New entries blocked${cancelledEntries?.cancelled?.length ? ` and ${cancelledEntries.cancelled.length} unfilled broker entry order(s) cancelled` : ''}. ${account.positions.length} open position(s) remain monitored for stop-loss, target, trailing stop and square-off.`
        : `Automation halted${cancelledEntries?.cancelled?.length ? ` and ${cancelledEntries.cancelled.length} unfilled broker entry order(s) cancelled` : ''}. No open positions.`,
    });
    addAudit(account, emergency ? 'emergency_stop' : 'agent_stopped', hasOpenPositions
      ? `User stopped new entries with ${account.positions.length} open position(s) still monitored for exits.`
      : 'User stopped the engine with no open positions.', 'user');
    persistStore();
    res.json({ account: publicStatus(account, deps), cancelledEntries });
  });

  app.post('/api/autotrade/scan', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    if (!allowAction(user.id, 'scan', 8000)) return fail(res, 429, 'A scan just ran. Try again in a few seconds.', 'scan_throttled');
    const account = accountFor(user.id);
    if (account.status === 'stopped') return fail(res, 409, 'Start the auto-trader before scanning for entries.', 'agent_stopped');
    try {
      await runAccountCycle(user.id, account, deps);
      res.json({ account: publicStatus(account, deps) });
    } catch (error) {
      fail(res, 502, error.message || 'The scan could not complete.', 'scan_failed');
    }
  });

  app.post('/api/autotrade/positions/:id/exit', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    const position = account.positions.find((item) => item.id === req.params.id);
    if (!position) return fail(res, 404, 'That open position was not found.', 'position_not_found');
    if (isLiveAccount(account) && position.protectionStatus === 'pending_exit') {
      return fail(res, 409, 'A broker exit order is still pending. Reconcile it before sending another sell order.', 'exit_pending');
    }
    if (isLiveAccount(account)) {
      const marketSession = typeof deps.getMarketSession === 'function'
        ? await deps.getMarketSession().catch(() => null)
        : null;
      const sessionOpen = typeof deps.getMarketSession === 'function'
        ? marketSession?.isVerified === true && marketSession.isOpen === true
        : istNow().sessionOpen;
      if (!sessionOpen) return fail(res, 409, String(marketSession?.status || '').includes('UNVERIFIED')
        ? 'The NSE holiday calendar could not be verified; live exits are blocked for safety.'
        : 'The NSE session is closed; live exits cannot be sent.', 'market_closed');
      try {
        const protectionCancelled = await cancelPositionProtection(user.id, account, position, 'Replacing protection with a manual exit');
        if (!protectionCancelled) {
          persistStore();
          return res.status(409).json({
            error: 'The protective stop could not be cancelled safely; no market sell order was sent.',
            code: 'protection_cancel_failed',
            account: publicStatus(account, deps),
          });
        }
        const result = await submitLiveExit({
          userId: user.id,
          broker: liveBrokerOf(account),
          position: { ...position, tradeStyle: account.tradeStyle },
          reason: 'manual',
          marketOpen: sessionOpen,
        });
        handleLiveExitResult(account, position, result, 'manual', null);
        if (account.positions.includes(position) && position.qty > 0
          && ['rejected', 'cancelled'].includes(result.status)) {
          await establishLiveProtection(user.id, account, position);
        } else if (account.positions.includes(position) && position.qty > 0) {
          position.protectionStatus = 'pending_exit';
          pauseLiveEntries(account, {
            type: 'live_protection_failed',
            title: `Manual exit still pending: ${position.symbol}`,
            message: `The broker has not confirmed the full manual exit. No replacement stop was sent to avoid a duplicate sell; verify the broker order and remaining position.`,
          });
        }
        account.updatedAt = nowIso();
        persistStore();
        const refreshed = account.positions.find((item) => item.id === position.id) || null;
        return res.json({ exit: result, position: refreshed, account: publicStatus(account, deps) });
      } catch (error) {
        account.execution.syncError = error.message;
        persistStore();
        return res.status(502).json({
          error: error.message,
          code: error.code || 'live_exit_failed',
          orderId: error.detail?.orderId || null,
          account: publicStatus(account, deps),
        });
      }
    }
    let quote = null;
    try {
      const quotes = await deps.quoteBatch([position.symbol]);
      quote = quotes?.[position.symbol] || null;
    } catch {
      quote = null;
    }
    const basis = quoteBasisOf(quote);
    if (!isQuoteUsable(quote, quoteAgeBudget(EXIT_QUOTE_MAX_AGE_MS, basis), basis)) {
      return fail(res, 502, `A verified quote for ${position.symbol} is unavailable right now.`, 'quote_unavailable');
    }
    const closed = closePosition(account, position, round2(quote.c), 'manual', quote);
    persistStore();
    res.json({ closed, account: publicStatus(account, deps) });
  });

  app.get('/api/autotrade/signals', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    const requested = String(req.query.symbols || '').split(',').map(sanitizeSymbol).filter(Boolean);
    if (requested.some((symbol) => !account.watchlist.includes(symbol))) {
      return fail(res, 400, 'Signals are limited to symbols in your configured AI watchlist.', 'symbol_outside_watchlist');
    }
    const symbols = [...new Set(requested.length ? requested : account.watchlist)].slice(0, 20);
    let quotes = {};
    try {
      quotes = (await deps.quoteBatch(symbols)) || {};
    } catch {
      quotes = {};
    }
    const results = await Promise.all(symbols.map(async (symbol) => {
      try {
        const signal = await loadSignal(symbol, deps);
        const quote = quotes[symbol];
        const basis = quoteBasisOf(quote);
        return {
          ...signal,
          price: Number(quote?.c) > 0 ? round2(quote.c) : signal.price,
          changePercent: Number.isFinite(Number(quote?.dp)) ? round2(quote.dp) : null,
          quoteBasis: basis,
          quoteLabel: basis === 'live' ? 'Live provider quote' : basis === 'delayed' ? 'Delayed research quote' : 'Daily close only',
          quoteAgeSeconds: quoteAgeMs(quote) === null ? null : Math.round(quoteAgeMs(quote) / 1000),
        };
      } catch (error) {
        return { symbol, error: error.message, code: error.code || 'signal_failed', action: 'Unavailable', score: null };
      }
    }));
    res.set('Cache-Control', 'no-store');
    res.json({
      signals: results.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
      generatedAt: nowIso(),
      basis: 'Delayed daily research bars for indicators plus the latest verified quote for price.',
      disclaimer: 'Rules-based technical scoring, not a prediction or guarantee.',
    });
  });

  app.get('/api/autotrade/backtest', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const symbol = sanitizeSymbol(req.query.symbol);
    if (!symbol) return fail(res, 400, 'Choose a valid NSE symbol.', 'invalid_symbol');
    const days = clamp(Number.parseInt(req.query.days, 10) || 250, 120, 750);
    const account = accountFor(user.id);
    if (!account.watchlist.includes(symbol)) {
      return fail(res, 400, 'Backtests are limited to symbols in your configured AI watchlist.', 'symbol_outside_watchlist');
    }
    const targetPercent = clamp(Number(req.query.targetPercent) || account.risk.targetPercent, 0.2, 40);
    const stopLossPercent = clamp(Number(req.query.stopLossPercent) || account.risk.stopLossPercent, 0.2, 20);
    const requestedCost = Number(req.query.costBps);
    const costBps = Number.isFinite(requestedCost) && req.query.costBps !== '' ? clamp(requestedCost, 0, 100) : undefined;
    const rules = String(req.query.rules || '')
      .split(',')
      .map((rule) => rule.trim())
      .filter((rule) => Object.hasOwn(BACKTEST_RULES, rule));
    const rsiMax = clamp(Number(req.query.rsiMax) || 72, 20, 95);
    const momentumMinPercent = clamp(Number(req.query.momentumMin) || 0.5, -10, 20);
    const cacheKey = `${symbol}:${days}:${targetPercent}:${stopLossPercent}:${costBps ?? 'model'}:${rules.join('+') || 'default'}:${rsiMax}:${momentumMinPercent}`;
    const cached = backtestCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < BACKTEST_CACHE_MS) return res.json(cached.result);
    try {
      const candles = await deps.getDailyCandles(symbol);
      if (!candles || candles.length < 120) {
        return fail(res, 503, `Verified daily history for ${symbol} is unavailable right now.`, 'research_unavailable');
      }
      const result = {
        ...runBacktest({ symbol, candles, days, targetPercent, stopLossPercent, costBps, rules, rsiMax, momentumMinPercent }),
        generatedAt: nowIso(),
      };
      backtestCache.set(cacheKey, { result, savedAt: Date.now() });
      res.set('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      fail(res, 502, error.message || 'The backtest could not be completed.', 'backtest_failed');
    }
  });

  app.post('/api/autotrade/explain', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const symbol = sanitizeSymbol(req.body?.symbol);
    if (!symbol) return fail(res, 400, 'Choose a valid NSE symbol.', 'invalid_symbol');
    const account = accountFor(user.id);
    let signal;
    try {
      signal = await loadSignal(symbol, deps);
    } catch (error) {
      return fail(res, 503, error.message || 'Verified history is unavailable.', error.code || 'research_unavailable');
    }
    const fallback = deterministicExplanation(signal, account);
    if (deps.explainSignal) {
      try {
        const llm = await Promise.race([
          deps.explainSignal({ signal, account: publicStatus(account, deps) }),
          new Promise((resolve) => setTimeout(() => resolve(null), 20_000)),
        ]);
        if (llm?.reply) {
          return res.json({
            explanation: llm.reply,
            provider: llm.provider || 'LLM',
            llmConfigured: true,
            signal,
            basis: 'LLM narrative grounded in the computed signal and account state.',
          });
        }
      } catch (error) {
        console.warn('Auto-trade LLM explanation failed:', error.message);
      }
    }
    res.json({
      explanation: fallback,
      provider: 'Rules-based engine',
      llmConfigured: deps.aiConfigured ? deps.aiConfigured() : false,
      signal,
      basis: 'Computed directly from verified daily bars; no LLM key is configured.',
    });
  });

  app.post('/api/autotrade/notifications/test', async (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    if (!telegramConfigured()) {
      return fail(res, 503, 'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server.', 'telegram_not_configured');
    }
    if (!account.notifications.telegram) return fail(res, 400, 'Enable Telegram notifications first.', 'telegram_disabled');
    const event = pushEvent(account, {
      type: 'notification_test',
      severity: 'info',
      title: 'Test notification',
      message: 'Telegram delivery from the ShareMarket AI paper trader is connected.',
    });
    persistStore();
    res.json({ sent: true, event });
  });

  app.get('/api/autotrade/audit', (req, res) => {
    const user = requireUser(req, res, deps);
    if (!user) return;
    const account = accountFor(user.id);
    const limit = clamp(Number.parseInt(req.query.limit, 10) || 100, 1, 300);
    res.set('Cache-Control', 'no-store');
    res.json({
      events: account.events.slice(0, limit),
      audit: account.audit.slice(0, limit),
      orders: account.orders.slice(0, limit),
      trades: account.trades.slice(0, limit),
    });
  });

  return {
    start: () => {
      if (timer) return;
      const lock = acquireSchedulerLock();
      if (!lock.ok) {
        schedulerHealth.running = false;
        schedulerHealth.lastError = lock.reason;
        console.warn(`Auto-trade scheduler not started: ${lock.reason}`);
        for (const [userId, account] of Object.entries(store.accounts)) {
          if (!isLiveAccount(account) || (account.status !== 'running' && !account.positions.length)) continue;
          account.userId = userId;
          pauseLiveEntries(account, {
            type: 'worker_failure',
            title: 'Live trading worker is unavailable',
            message: `${lock.reason} The application worker cannot monitor positions; broker-side DAY stop orders must be checked directly with the broker.`,
          });
        }
        persistStore();
        return;
      }
      if (lock.warning) console.warn(lock.warning);
      restoreAccountAutomationAfterRestart();
      schedulerHealth.running = true;
      schedulerHealth.heartbeatAt = nowIso();
      schedulerHealth.lastSweepStartedAt = null;
      schedulerHealth.lastError = null;
      process.once('exit', releaseSchedulerLock);
      timer = setInterval(() => {
        sweep().catch((error) => console.warn('Auto-trade sweep failed:', error.message));
      }, SCAN_INTERVAL_MS);
      timer.unref?.();
      watchdogTimer = setInterval(() => {
        if (!schedulerHealth.running || !schedulerHealth.heartbeatAt) return;
        const heartbeatAge = Date.now() - Date.parse(schedulerHealth.heartbeatAt);
        if (heartbeatAge <= SCAN_INTERVAL_MS * 6) return;
        schedulerHealth.lastError = `Trading worker heartbeat is ${Math.round(heartbeatAge / 1000)} seconds old.`;
        for (const [userId, account] of Object.entries(store.accounts)) {
          if (!isLiveAccount(account) || (account.status !== 'running' && !account.positions.length)) continue;
          account.userId = userId;
          pauseLiveEntries(account, {
            type: 'worker_failure',
            title: 'Live trading worker heartbeat is stale',
            message: `${schedulerHealth.lastError} New live entries are paused. Broker-side DAY stop orders should be verified directly with the broker.`,
          });
        }
        persistStore();
      }, SCAN_INTERVAL_MS);
      watchdogTimer.unref?.();
      notificationTimer = setInterval(() => {
        runNotificationSweep().catch((error) => console.warn('Notification scan failed:', error.message));
      }, 60_000);
      notificationTimer.unref?.();
      setTimeout(() => runNotificationSweep().catch((error) => console.warn('Initial notification scan failed:', error.message)), 6000).unref?.();
      // Recover after a restart: reconcile pending broker orders and resume protection
      // of open positions without waiting a full interval.
      setTimeout(() => sweep().catch((error) => console.warn('Auto-trade recovery sweep failed:', error.message)), 2500).unref?.();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
      if (watchdogTimer) clearInterval(watchdogTimer);
      watchdogTimer = null;
      if (notificationTimer) clearInterval(notificationTimer);
      notificationTimer = null;
      schedulerHealth.running = false;
      releaseSchedulerLock();
    },
    sweep,
  };
};

export const getPaperAccount = (userId) => accountFor(userId);
export const listPaperAccounts = () => store.accounts;
export const getPaperStatusFor = (userId) => publicStatus(accountFor(userId), runtimeDeps || {});

export const computePaperSignals = async (symbols = []) => {
  const clean = [...new Set((Array.isArray(symbols) ? symbols : []).map(sanitizeSymbol).filter(Boolean))].slice(0, 20);
  if (!runtimeDeps) {
    return clean.map((symbol) => ({ symbol, error: 'The paper engine is not initialized.', code: 'runtime_unavailable', action: 'Unavailable', score: null }));
  }
  return Promise.all(clean.map(async (symbol) => {
    try {
      return await loadSignal(symbol, runtimeDeps);
    } catch (error) {
      return { symbol, error: error.message, code: error.code || 'signal_failed', action: 'Unavailable', score: null };
    }
  }));
};

export const getPaperQuotes = async (symbols = []) => {
  if (!runtimeDeps) return {};
  try {
    return (await runtimeDeps.quoteBatch(symbols)) || {};
  } catch {
    return {};
  }
};

export const getPaperDailyCandles = async (symbol) => {
  if (!runtimeDeps) return null;
  try {
    return await runtimeDeps.getDailyCandles(symbol);
  } catch {
    return null;
  }
};

export const getPaperBrokerStatus = () => (runtimeDeps?.getBrokerStatus ? runtimeDeps.getBrokerStatus() : null);

export const getPaperFeedSnapshot = () => {
  const accounts = Object.values(store.accounts);
  let latest = null;
  let error = null;
  let accountsScanned = 0;
  for (const account of accounts) {
    const scan = account?.scan;
    if (!scan?.lastRunAt) continue;
    accountsScanned += 1;
    error = scan.lastError || error;
    const at = new Date(scan.lastRunAt).getTime();
    if (!latest || at > latest.at) {
      latest = {
        at,
        lastRunAt: scan.lastRunAt,
        quoteCount: Number(scan.quoteCount) || 0,
        dataBasis: scan.dataBasis || 'unavailable',
        marketOpen: scan.marketOpen === true,
        durationMs: Number(scan.lastDurationMs) || null,
      };
    }
  }
  return {
    lastRunAt: latest?.lastRunAt || null,
    ageSeconds: latest ? Math.max(0, Math.round((Date.now() - latest.at) / 1000)) : null,
    quoteCount: latest?.quoteCount || 0,
    dataBasis: latest?.dataBasis || 'unavailable',
    marketOpen: latest?.marketOpen || false,
    lastScanDurationMs: latest?.durationMs || null,
    lastError: error,
    accountsScanned,
  };
};

export const runBacktestSeries = (options) => runBacktest(options);
