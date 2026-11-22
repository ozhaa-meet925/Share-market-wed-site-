import crypto from 'node:crypto';
import { readStore, writeStore } from './serverCoreStore.js';
import { publish } from './serverCoreBus.js';
import { recordAudit } from './serverCoreAudit.js';
import { notify } from './serverNotifications.js';

const RING_LIMIT = 200;
const DEFAULT_CONFIG = Object.freeze({
  maxDrawdownPercent: 20,
  riskPerTradePercent: 0.75,
  minRewardRiskRatio: 1,
});
const MAX_DECISION_AGE_MS = 24 * 60 * 60 * 1000;

const emptyState = () => ({ version: 1, killSwitches: {}, configs: {}, peaks: {}, decisions: [] });
let state = readStore('risk-shield.json', emptyState());

const ensureShape = () => {
  const defaults = emptyState();
  for (const key of Object.keys(defaults)) {
    if (state[key] === undefined || state[key] === null || typeof state[key] !== typeof defaults[key]) state[key] = defaults[key];
  }
  state.decisions = Array.isArray(state.decisions) ? state.decisions.slice(0, RING_LIMIT) : [];
  return state;
};

const persist = () => writeStore('risk-shield.json', ensureShape());

const round2 = (value) => Number(Number(value).toFixed(2));
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const accounting = (account = {}) => {
  const positions = Array.isArray(account.positions) ? account.positions : [];
  const cash = num(account.cash) ?? 0;
  const investedValue = positions.reduce((total, position) => (
    total + (num(position.qty) || 0) * (num(position.lastPrice) || num(position.entryPrice) || 0)
  ), 0);
  const equity = cash + investedValue;
  return { cash, investedValue, equity, positions };
};

export const configFor = (userId) => {
  ensureShape();
  const stored = state.configs[userId] || {};
  const config = { ...DEFAULT_CONFIG, ...stored };
  return {
    maxDrawdownPercent: Math.min(80, Math.max(1, num(config.maxDrawdownPercent) ?? DEFAULT_CONFIG.maxDrawdownPercent)),
    riskPerTradePercent: Math.min(10, Math.max(0.1, num(config.riskPerTradePercent) ?? DEFAULT_CONFIG.riskPerTradePercent)),
    minRewardRiskRatio: Math.min(5, Math.max(0.2, num(config.minRewardRiskRatio) ?? DEFAULT_CONFIG.minRewardRiskRatio)),
  };
};

export const isKillSwitchActive = (userId) => {
  ensureShape();
  return state.killSwitches[userId]?.active === true;
};

export const killSwitchFor = (userId) => {
  ensureShape();
  return state.killSwitches[userId] || { active: false, reason: null, at: null, actor: null };
};

export const setKillSwitch = ({ userId, active, reason, actor }) => {
  ensureShape();
  const cleanReason = String(reason || '').trim().slice(0, 240);
  if (active && cleanReason.length < 4) {
    return { ok: false, error: 'A reason of at least 4 characters is required to activate the kill switch.', code: 'reason_required' };
  }
  state.killSwitches[userId] = {
    active: Boolean(active),
    reason: cleanReason || null,
    at: new Date().toISOString(),
    actor: { id: actor?.id || userId, name: actor?.name || 'User' },
  };
  persist();
  const record = recordAudit({
    actor,
    action: active ? 'risk.kill_switch_activated' : 'risk.kill_switch_released',
    resource: `risk:${userId}`,
    outcome: 'success',
    detail: { reason: cleanReason || 'Kill switch released' },
  });
  publish('risk.killSwitch', { userId, ...state.killSwitches[userId], auditId: record?.seq || null });
  try {
    notify({
      userId,
      category: 'risk',
      level: active ? 'critical' : 'warning',
      title: active ? 'Risk Shield emergency stop activated' : 'Risk Shield emergency stop released',
      body: active ? `New orders are blocked. Reason: ${cleanReason}` : 'The emergency stop was released; normal account authorization and risk checks still apply.',
      externalKey: `risk-kill-switch:${userId}:${state.killSwitches[userId].at}:${active ? 'on' : 'off'}`,
    });
  } catch (error) {
    console.warn('Risk Shield notification could not be queued:', error.message);
  }
  return { ok: true, killSwitch: state.killSwitches[userId] };
};

const updatePeak = (userId, equity) => {
  ensureShape();
  if (!(equity > 0)) return { peak: null, drawdownPercent: null };
  const current = state.peaks[userId];
  const peak = current && Number(current.peak) > equity ? Number(current.peak) : equity;
  state.peaks[userId] = { peak: round2(peak), at: new Date().toISOString() };
  persist();
  return {
    peak: round2(peak),
    drawdownPercent: peak > 0 ? round2(((peak - equity) / peak) * 100) : 0,
  };
};

const buildChecks = ({ account, quote, signal, source, marketOpen, quoteAgeSeconds, price, qty, value, stopLoss, target, risk, config, equity, drawdownPercent }) => {
  ensureShape();
  const checks = [];
  const add = (id, label, status, detail, value_ = null) => checks.push({ id, label, status, detail, value: value_ });
  const positions = Array.isArray(account.positions) ? account.positions : [];
  const daily = account.daily || {};
  const riskSettings = { ...risk };
  const symbol = String(signal?.symbol || account?.symbol || '').toUpperCase();
  const killSwitch = killSwitchFor(account.userId);

  add('kill-switch', 'Kill switch', killSwitch.active ? 'fail' : 'pass',
    killSwitch.active ? `Risk engine disabled: ${killSwitch.reason || 'emergency stop active'}.` : 'Risk engine armed.');

  if (source === 'auto') {
    const authorized = account.status === 'running' && !account.emergencyStopped;
    add('authorization', 'User authorization', authorized ? 'pass' : 'fail',
      authorized ? 'Paper agent is authorized and running.' : 'The agent is not running. START AUTO TRADING authorization is required.');
  } else {
    const running = account.status === 'running';
    add('authorization', 'User authorization', running ? 'pass' : 'warn',
      running ? 'Paper agent is authorized and running.' : 'Paper agent is not running; this order could not execute until authorized.');
  }

  if (marketOpen === null || marketOpen === undefined) {
    add('market-session', 'NSE session', 'warn', 'Session state was not supplied by the caller.');
  } else {
    add('market-session', 'NSE session', marketOpen ? 'pass' : 'fail',
      marketOpen ? 'NSE equity session is open.' : 'NSE equity session is closed (09:15–15:30 IST, Mon–Fri).');
  }

  if (!(price > 0)) {
    add('quote', 'Verified quote', 'fail', 'No verified quote is available for this symbol.');
  } else if (quoteAgeSeconds !== null && quoteAgeSeconds !== undefined) {
    const age = Math.max(0, Number(quoteAgeSeconds));
    add('quote', 'Verified quote', age > 900 ? 'fail' : age > 300 ? 'warn' : 'pass',
      `Last verified quote is ${Math.round(age)}s old.`, { ageSeconds: Math.round(age) });
  } else {
    add('quote', 'Verified quote', 'pass', `Priced at ₹${round2(price)}.`, { price: round2(price) });
  }

  add('funds', 'Available funds', value <= (num(account.cash) || 0) ? 'pass' : 'fail',
    `Order value ₹${round2(value)} vs available cash ₹${round2(account.cash || 0)}.`,
    { orderValue: round2(value), cash: round2(account.cash || 0) });

  add('per-trade-cap', 'Per-trade cap', value <= Number(riskSettings.maxInvestmentPerTrade || 0) ? 'pass' : 'fail',
    `Order value ₹${round2(value)} vs cap ₹${round2(riskSettings.maxInvestmentPerTrade || 0)}.`);

  const dayPnl = equity - Number(daily.startEquity || equity);
  const dailyLimit = Number(riskSettings.maxDailyLoss || 0);
  const dailyFail = daily.halted === true || (dailyLimit > 0 && dayPnl <= -dailyLimit);
  add('daily-loss', 'Daily loss limit', dailyFail ? 'fail' : 'pass',
    dailyFail ? (daily.haltReason || `Day P&L ₹${round2(dayPnl)} has reached the ₹${round2(dailyLimit)} limit.`)
      : `Day P&L ₹${round2(dayPnl)} against a ₹${round2(dailyLimit)} limit.`);

  add('drawdown', 'Maximum drawdown', drawdownPercent !== null && drawdownPercent > config.maxDrawdownPercent ? 'fail' : 'pass',
    drawdownPercent === null ? 'Peak equity is not available yet.'
      : `Drawdown ${drawdownPercent}% vs cap ${config.maxDrawdownPercent}%.`, { drawdownPercent });

  const exposureLimit = (equity * Number(riskSettings.maxPortfolioExposurePercent || 0)) / 100;
  const projectedExposure = (num(account.investedValue) || accounting(account).investedValue) + value;
  add('exposure', 'Portfolio exposure', projectedExposure > exposureLimit + 0.01 ? 'fail' : 'pass',
    `Projected exposure ₹${round2(projectedExposure)} vs limit ₹${round2(exposureLimit)}.`);

  add('position-slots', 'Open position slots', positions.length >= Number(riskSettings.maxOpenPositions || 0) ? 'fail' : 'pass',
    `${positions.length}/${riskSettings.maxOpenPositions} slots used.`);

  add('daily-trades', 'Daily trade count', Number(daily.tradesCount || 0) >= Number(riskSettings.maxDailyTrades || 0) ? 'fail' : 'pass',
    `${Number(daily.tradesCount || 0)}/${riskSettings.maxDailyTrades} entries used today.`);

  const duplicate = symbol && positions.some((position) => String(position.symbol).toUpperCase() === symbol);
  add('duplicate', 'Duplicate symbol', duplicate ? 'fail' : 'pass',
    duplicate ? `${symbol} already has an open paper position.` : 'No open position in this symbol.');

  const stopDistancePercent = price > 0 ? ((price - stopLoss) / price) * 100 : 0;
  const stopValid = stopLoss > 0 && stopLoss < price && stopDistancePercent >= 0.2 && stopDistancePercent <= 20;
  add('stop-loss', 'Stop-loss', stopValid ? 'pass' : 'fail',
    `Stop ₹${round2(stopLoss)} (${round2(stopDistancePercent)}% below entry).`, { stopLoss: round2(stopLoss) });

  const rewardRisk = price > stopLoss ? (target - price) / (price - stopLoss) : 0;
  const targetValid = target > price && rewardRisk >= config.minRewardRiskRatio;
  add('target', 'Target and reward:risk', targetValid ? 'pass' : 'fail',
    `Target ₹${round2(target)} · reward:risk ${round2(rewardRisk)}:1 (minimum ${config.minRewardRiskRatio}:1).`,
    { target: round2(target), rewardRisk: round2(rewardRisk) });

  if (source === 'auto' || source === 'brain' || source === 'preflight') {
    const score = num(signal?.score);
    const action = signal?.action;
    if (score === null) {
      add('signal', 'Signal quality', 'warn', 'No rules-based signal was supplied.');
    } else {
      const pass = action === 'Buy' && score >= Number(riskSettings.minSignalScore || 0);
      add('signal', 'Signal quality', pass ? 'pass' : 'fail',
        `${action || 'No action'} at ${score}/100 · minimum ${riskSettings.minSignalScore}/100.`, { score });
    }
  }

  add('sizing', 'Risk-based sizing', qty >= 1 ? 'pass' : 'fail',
    qty >= 1 ? `${qty} share(s), ₹${round2(value)} at ₹${round2(price)}.` : 'Risk-based size is below one share.');

  return checks;
};

const finalizeDecision = ({
  userId,
  source,
  symbol,
  allowed,
  reason,
  price,
  qty,
  value,
  stopLoss = null,
  target = null,
  equity = null,
  drawdownPercent = null,
  idempotencyKey,
  startedAt,
  checks,
  actor,
}) => {
  const failed = checks.filter((check) => check.status === 'fail');
  const drawdownFailure = failed.find((check) => check.id === 'drawdown');
  if (drawdownFailure) {
    try {
      notify({
        userId,
        category: 'risk',
        level: 'critical',
        title: 'Portfolio drawdown limit breached',
        body: drawdownFailure.detail,
        externalKey: `portfolio-drawdown:${new Date().toISOString().slice(0, 10)}`,
      });
    } catch {
      // Preserve the risk decision even if notification delivery is unavailable.
    }
  }
  const decision = {
    id: `RSK-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
    at: new Date().toISOString(),
    userId,
    source,
    symbol,
    allowed,
    reason: String(reason).slice(0, 400),
    price,
    qty,
    value,
    stopLoss,
    target,
    equity: equity === null ? null : round2(equity),
    drawdownPercent,
    idempotencyKey,
    durationMs: Date.now() - startedAt,
    checks,
  };

  state.decisions.unshift(decision);
  const cutoff = Date.now() - MAX_DECISION_AGE_MS;
  state.decisions = state.decisions
    .filter((item) => new Date(item.at).getTime() >= cutoff)
    .slice(0, RING_LIMIT);
  persist();

  recordAudit({
    actor: actor || { id: userId, role: 'system', name: source === 'auto' ? 'AI Auto Trader' : 'Risk Shield' },
    action: allowed ? 'risk.order_approved' : 'risk.order_blocked',
    resource: `risk:${userId}:${symbol || 'unknown'}`,
    outcome: allowed ? 'success' : 'denied',
    detail: {
      source,
      symbol,
      qty,
      value,
      reason: decision.reason,
      failedChecks: failed.map((check) => check.id),
      decisionId: decision.id,
    },
  });

  publish('risk.decision', {
    userId,
    decisionId: decision.id,
    symbol,
    source,
    allowed,
    reason: decision.reason,
    qty,
    value,
    idempotencyKey,
    failedChecks: failed.map((check) => check.id),
    at: decision.at,
  });

  return decision;
};

export const authorizeEntry = ({
  userId,
  account = {},
  quote = null,
  signal = null,
  source = 'auto',
  marketOpen = null,
  quoteAgeSeconds = null,
  actor = null,
}) => {
  const startedAt = Date.now();
  ensureShape();
  const risk = account.risk || {};
  const config = configFor(userId);
  const accountView = { ...account, userId };
  const metrics = accounting(account);
  const equity = metrics.equity;
  const symbol = String(signal?.symbol || quote?.symbol || accountView.symbol || '').toUpperCase();
  const price = Number(quote?.c) > 0 ? round2(quote.c) : round2(num(signal?.price) || 0);
  const stopPercent = Number(risk.stopLossPercent || 1.5);
  const targetPercent = Number(risk.targetPercent || 3);
  const stopLoss = round2(price * (1 - stopPercent / 100));
  const target = round2(price * (1 + targetPercent / 100));
  const peakInfo = updatePeak(userId, equity);
  const exposureLimit = (equity * Number(risk.maxPortfolioExposurePercent || 0)) / 100;
  const exposureRoom = Math.max(0, exposureLimit - metrics.investedValue);
  const budget = Math.max(0, Math.min(Number(risk.maxInvestmentPerTrade || 0), metrics.cash, exposureRoom));
  const riskPerShare = Math.max(0.01, price * stopPercent / 100);
  const riskBudget = equity * config.riskPerTradePercent / 100;
  const qtyByRisk = Math.floor(riskBudget / riskPerShare);
  const qtyByBudget = price > 0 ? Math.floor(budget / price) : 0;
  const qty = Math.max(0, Math.min(qtyByRisk, qtyByBudget));
  const value = round2(qty * price);

  const checks = buildChecks({
    account: accountView,
    quote,
    signal,
    source,
    marketOpen,
    quoteAgeSeconds,
    price,
    qty,
    value,
    stopLoss,
    target,
    risk,
    config,
    equity,
    drawdownPercent: peakInfo.drawdownPercent,
  });
  const failed = checks.filter((check) => check.status === 'fail');
  const warned = checks.filter((check) => check.status === 'warn');
  const allowed = failed.length === 0;
  const reason = failed.length
    ? failed.map((check) => check.detail).join(' ')
    : warned.length ? `Passed with warnings: ${warned.map((check) => check.detail).join(' ')}` : 'All risk checks passed.';

  const idempotencyKey = crypto.createHash('sha256')
    .update(`${userId}|${symbol}|${price}|${qty}|${signal?.score ?? 'na'}|${stopLoss}|${target}`)
    .digest('hex')
    .slice(0, 32);

  return finalizeDecision({
    userId,
    source,
    symbol,
    allowed,
    reason,
    price,
    qty,
    value,
    stopLoss,
    target,
    equity,
    drawdownPercent: peakInfo.drawdownPercent,
    idempotencyKey,
    startedAt,
    checks,
    actor,
  });
};

export const authorizeLiveOrder = ({
  userId,
  broker = 'broker',
  symbol = '',
  side = 'BUY',
  quantity = 0,
  price = 0,
  quoteAgeSeconds = null,
  brokerFunds = null,
  riskSettings = {},
  todayLiveOrders = 0,
  duplicateSymbol = false,
  marketOpen = null,
  actor = null,
}) => {
  const startedAt = Date.now();
  ensureShape();
  const checks = [];
  const add = (id, label, status, detail, value = null) => checks.push({ id, label, status, detail, value });
  const cleanSymbol = String(symbol || '').toUpperCase();
  const qty = Math.max(0, Number(quantity) || 0);
  const orderPrice = Math.max(0, Number(price) || 0);
  const value = round2(qty * orderPrice);
  const killSwitch = killSwitchFor(userId);

  add('kill-switch', 'Kill switch', killSwitch.active ? 'fail' : 'pass',
    killSwitch.active ? `Risk engine disabled: ${killSwitch.reason || 'emergency stop active'}.` : 'Risk engine armed.');

  if (marketOpen === null || marketOpen === undefined) {
    add('market-session', 'NSE session', 'warn', 'Session state was not supplied by the caller.');
  } else {
    add('market-session', 'NSE session', marketOpen ? 'pass' : 'fail',
      marketOpen ? 'NSE equity session is open.' : 'NSE equity session is closed (09:15–15:30 IST, Mon–Fri).');
  }

  if (!(orderPrice > 0)) {
    add('quote', 'Verified quote', 'fail', 'A verified price is required before a live order can be routed.');
  } else if (quoteAgeSeconds !== null && quoteAgeSeconds !== undefined) {
    const age = Math.max(0, Number(quoteAgeSeconds));
    add('quote', 'Verified quote', age > 900 ? 'fail' : age > 300 ? 'warn' : 'pass',
      `Broker quote is ${Math.round(age)}s old.`, { ageSeconds: Math.round(age) });
  } else {
    add('quote', 'Verified quote', 'pass', `Reference price ₹${round2(orderPrice)}.`, { price: round2(orderPrice) });
  }

  if (side === 'BUY') {
    const availableCash = num(brokerFunds?.availableCash);
    add('funds', 'Broker funds', availableCash === null ? 'warn' : value <= availableCash ? 'pass' : 'fail',
      availableCash === null
        ? 'Broker funds were not returned; confirm margins in the broker terminal.'
        : `Order value ₹${round2(value)} vs broker cash ₹${round2(availableCash)}.`,
      { orderValue: round2(value), availableCash: availableCash === null ? null : round2(availableCash) });
  }

  const perTradeCap = num(riskSettings.maxInvestmentPerTrade);
  if (perTradeCap !== null && perTradeCap > 0) {
    add('per-trade-cap', 'Per-trade cap', value <= perTradeCap ? 'pass' : 'fail',
      `Order value ₹${round2(value)} vs cap ₹${round2(perTradeCap)}.`);
  }

  const maxDailyTrades = num(riskSettings.maxDailyTrades);
  if (maxDailyTrades !== null && maxDailyTrades > 0) {
    add('daily-trades', 'Daily trade count', todayLiveOrders >= maxDailyTrades ? 'fail' : 'pass',
      `${todayLiveOrders}/${maxDailyTrades} live orders used today.`);
  }

  add('duplicate', 'Duplicate live entry', duplicateSymbol ? 'fail' : 'pass',
    duplicateSymbol ? `${cleanSymbol} already has a live order or position today.` : 'No duplicate live entry.');

  add('sizing', 'Order size', qty >= 1 ? 'pass' : 'fail',
    qty >= 1 ? `${qty} share(s), ₹${round2(value)} via ${broker}.` : 'Quantity must be at least one share.');

  const failed = checks.filter((check) => check.status === 'fail');
  const warned = checks.filter((check) => check.status === 'warn');
  const allowed = failed.length === 0;
  const reason = failed.length
    ? failed.map((check) => check.detail).join(' ')
    : warned.length ? `Passed with warnings: ${warned.map((check) => check.detail).join(' ')}` : 'All live risk checks passed.';
  const idempotencyKey = crypto.createHash('sha256')
    .update(`${userId}|live|${cleanSymbol}|${side}|${qty}|${orderPrice}`)
    .digest('hex')
    .slice(0, 32);

  return finalizeDecision({
    userId,
    source: 'live',
    symbol: cleanSymbol,
    allowed,
    reason,
    price: round2(orderPrice),
    qty,
    value,
    idempotencyKey,
    startedAt,
    checks,
    actor,
  });
};

export const shieldStatus = (userId, account = {}) => {
  ensureShape();
  const config = configFor(userId);
  const decisions = state.decisions.filter((decision) => decision.userId === userId);
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = decisions.filter((decision) => decision.at.slice(0, 10) === todayKey);
  const metrics = accounting(account);
  const peak = state.peaks[userId]?.peak || (metrics.equity > 0 ? metrics.equity : null);
  const drawdownPercent = peak && peak > 0 ? round2(((peak - metrics.equity) / peak) * 100) : null;
  return {
    authority: 'independent',
    liveTrading: false,
    killSwitch: killSwitchFor(userId),
    config,
    peakEquity: peak === null ? null : round2(peak),
    currentEquity: round2(metrics.equity),
    drawdownPercent,
    today: {
      evaluated: today.length,
      approved: today.filter((decision) => decision.allowed).length,
      blocked: today.filter((decision) => !decision.allowed).length,
    },
    recentDecisions: decisions.slice(0, 12),
    lastDecision: decisions[0] || null,
  };
};

export const shieldStats = () => {
  ensureShape();
  return {
    decisions: state.decisions.length,
    accountsWithKillSwitch: Object.values(state.killSwitches).filter((item) => item.active).length,
    lastDecisionAt: state.decisions[0]?.at || null,
  };
};
