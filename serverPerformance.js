import { getPaperAccount, getPaperDailyCandles, runBacktestSeries } from './serverAutoTrade.js';
import { readStore, writeStore } from './serverCoreStore.js';
import { recordAudit } from './serverCoreAudit.js';
import { publish } from './serverCoreBus.js';

const STORE_NAME = 'performance.json';
const DEFAULT_COST_BPS = 12;
const MAX_SNAPSHOTS = 400;
const GRID = {
  targetPercent: [1.5, 2.5, 4],
  stopLossPercent: [1, 2, 3],
};

const store = () => readStore(STORE_NAME, { version: 1, users: {} });
const persist = (data) => writeStore(STORE_NAME, data);

const round2 = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const round4 = (value) => (Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const mean = (values) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);
const stdev = (values) => {
  if (values.length < 2) return null;
  const avg = mean(values);
  const variance = values.reduce((total, value) => total + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};
const sum = (values) => values.reduce((total, value) => total + value, 0);
const normCostBps = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 100) : null;
};

const riskStats = (returns, periodsPerYear) => {
  const clean = returns.filter((value) => Number.isFinite(value));
  if (clean.length < 3) {
    return { sharpe: null, sortino: null, sample: clean.length, basis: 'insufficient trade-day returns' };
  }
  const avg = mean(clean);
  const sd = stdev(clean);
  const downside = Math.sqrt(mean(clean.map((value) => Math.min(0, value) ** 2)) || 0);
  const annualiser = Math.sqrt(Math.max(1, periodsPerYear));
  return {
    sharpe: sd > 0 ? round2((avg / sd) * annualiser) : null,
    sortino: downside > 0 ? round2((avg / downside) * annualiser) : null,
    averagePeriodReturnPercent: round4(avg * 100),
    periodsPerYear: round2(periodsPerYear),
    sample: clean.length,
    basis: 'Annualised from realised per-period returns; win rate is not used here.',
  };
};

export const scoreMetrics = (metrics) => {
  const sharpe = Number(metrics?.riskAdjusted?.sharpe);
  const profitFactor = Number(metrics?.profitFactor);
  const maxDrawdown = Number(metrics?.maxDrawdownPercent);
  const netReturn = Number(metrics?.netReturnPercent);
  const winRate = Number(metrics?.winRatePercent);
  const trades = Number(metrics?.tradeCount) || 0;

  if (trades < 1) {
    return {
      score: null,
      sampleFactor: 0,
      components: { riskAdjustedSharpe: 0, profitFactor: 0, drawdownControl: 0, netReturn: 0, winRate: 0 },
      weightsPercent: { riskAdjustedSharpe: 30, profitFactor: 25, drawdownControl: 20, netReturn: 10, winRate: 15 },
      note: 'No closed trades in this sample, so no composite score is issued.',
    };
  }

  const sharpePoints = clamp(((Number.isFinite(sharpe) ? sharpe : 0) + 1) / 4, 0, 1) * 30;
  const pfPoints = clamp(((Number.isFinite(profitFactor) ? profitFactor : 0) - 0.5) / 2.5, 0, 1) * 25;
  const drawdownPoints = clamp(1 - (Number.isFinite(maxDrawdown) ? maxDrawdown : 40) / 25, 0, 1) * 20;
  const returnPoints = clamp((Number.isFinite(netReturn) ? netReturn : 0) / 30 + 0.5, 0, 1) * 10;
  const winPoints = clamp((Number.isFinite(winRate) ? winRate : 0) / 100, 0, 1) * 15;
  const sampleFactor = trades >= 20 ? 1 : clamp(0.5 + trades / 40, 0.5, 0.95);
  const raw = sharpePoints + pfPoints + drawdownPoints + returnPoints + winPoints;

  return {
    score: round2(raw * sampleFactor),
    sampleFactor: round2(sampleFactor),
    components: {
      riskAdjustedSharpe: round2(sharpePoints),
      profitFactor: round2(pfPoints),
      drawdownControl: round2(drawdownPoints),
      netReturn: round2(returnPoints),
      winRate: round2(winPoints),
    },
    weightsPercent: { riskAdjustedSharpe: 30, profitFactor: 25, drawdownControl: 20, netReturn: 10, winRate: 15 },
    note: 'Win rate is capped at 15% of the composite and scaled down for small samples, so a high hit rate cannot outrank better risk-adjusted, cost-aware returns.',
  };
};

const emptyMetrics = (costBps, reason) => ({
  tradeCount: 0,
  winRatePercent: null,
  profitFactor: null,
  netPnl: null,
  netReturnPercent: null,
  maxDrawdownPercent: null,
  maxDrawdownValue: null,
  averageWin: null,
  averageLoss: null,
  payoffRatio: null,
  expectancy: null,
  largestWin: null,
  largestLoss: null,
  averageHoldingHours: null,
  grossPnl: null,
  modeledCosts: null,
  costBpsPerSide: costBps,
  riskAdjusted: { sharpe: null, sortino: null, sample: 0, basis: reason },
});

const ledgerMetrics = (trades, startingCapital, costBps) => {
  if (!trades.length) return emptyMetrics(costBps, 'no closed paper trades yet');
  const ordered = [...trades].sort((a, b) => new Date(a.exitAt) - new Date(b.exitAt));
  const rows = ordered.map((trade) => {
    const notional = Math.abs(Number(trade.entryPrice) * Number(trade.qty)) || 0;
    const modeledCost = round2(notional * (costBps / 10000) * 2);
    const grossPnl = Number(trade.pnl) || 0;
    const netPnl = round2(grossPnl - modeledCost);
    return {
      at: trade.exitAt,
      symbol: trade.symbol,
      qty: trade.qty,
      grossPnl,
      modeledCost,
      netPnl,
      netReturnPercent: notional > 0 ? (netPnl / notional) * 100 : 0,
      openedBy: trade.openedBy || 'ai',
      entryAt: trade.entryAt,
    };
  });

  const wins = rows.filter((row) => row.netPnl > 0);
  const losses = rows.filter((row) => row.netPnl <= 0);
  const grossProfit = sum(wins.map((row) => row.netPnl));
  const grossLoss = Math.abs(sum(losses.map((row) => row.netPnl)));
  const netPnl = round2(sum(rows.map((row) => row.netPnl)));
  const modeledCosts = round2(sum(rows.map((row) => row.modeledCost)));
  const grossPnl = round2(sum(rows.map((row) => row.grossPnl)));

  let equity = startingCapital;
  let peak = startingCapital;
  let maxDrawdownValue = 0;
  let maxDrawdownPercent = 0;
  const curve = [{ date: rows[0].entryAt || rows[0].at, equity: round2(startingCapital), netPnl: 0 }];
  const dailyMap = new Map();
  for (const row of rows) {
    equity = round2(equity + row.netPnl);
    peak = Math.max(peak, equity);
    const drawdownValue = peak - equity;
    if (drawdownValue > maxDrawdownValue) {
      maxDrawdownValue = drawdownValue;
      maxDrawdownPercent = peak > 0 ? (drawdownValue / peak) * 100 : 0;
    }
    curve.push({ date: row.at, equity, netPnl: row.netPnl });
    const day = String(row.at).slice(0, 10);
    dailyMap.set(day, round2((dailyMap.get(day) || 0) + row.netPnl));
  }

  const first = new Date(rows[0].at).getTime();
  const last = new Date(rows[rows.length - 1].at).getTime();
  const spanDays = Math.max(1, (last - first) / 86_400_000);
  const periodsPerYear = clamp((rows.length / spanDays) * 365, 1, 252);
  const returns = rows.map((row) => row.netReturnPercent / 100);
  const holdingHours = rows.map((row) => (new Date(row.at).getTime() - new Date(row.entryAt).getTime()) / 3_600_000).filter(Number.isFinite);

  return {
    tradeCount: rows.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePercent: round2((wins.length / rows.length) * 100),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : null,
    netPnl,
    grossPnl,
    modeledCosts,
    netReturnPercent: startingCapital > 0 ? round2((netPnl / startingCapital) * 100) : null,
    maxDrawdownPercent: round2(maxDrawdownPercent),
    maxDrawdownValue: round2(maxDrawdownValue),
    averageWin: wins.length ? round2(grossProfit / wins.length) : null,
    averageLoss: losses.length ? round2(-grossLoss / losses.length) : null,
    payoffRatio: grossLoss > 0 && wins.length ? round2((grossProfit / wins.length) / (grossLoss / losses.length)) : null,
    expectancy: round2(netPnl / rows.length),
    largestWin: wins.length ? round2(Math.max(...wins.map((row) => row.netPnl))) : null,
    largestLoss: losses.length ? round2(Math.min(...losses.map((row) => row.netPnl))) : null,
    averageHoldingHours: holdingHours.length ? round2(mean(holdingHours)) : null,
    costBpsPerSide: costBps,
    riskAdjusted: riskStats(returns, periodsPerYear),
    equityCurve: curve.slice(-300),
    dailyPnl: [...dailyMap.entries()].map(([date, value]) => ({ date, netPnl: value })).slice(-180),
    basis: {
      pnl: 'Net of a modelled round-trip cost applied to both entry and exit notional; the paper ledger itself is cost-free.',
      returns: 'Per-trade net returns on entry notional, annualised by observed trade frequency.',
      drawdown: 'Peak-to-trough on realised equity after modelled costs.',
    },
  };
};

const backtestCurveRisk = (curve) => {
  if (!Array.isArray(curve) || curve.length < 4) return { sharpe: null, sortino: null, sample: 0, basis: 'insufficient equity curve' };
  const returns = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1].equity;
    const current = curve[index].equity;
    if (previous > 0) returns.push(current / previous - 1);
  }
  return riskStats(returns, 252);
};

const backtestMetrics = (result) => {
  const metrics = result?.metrics || {};
  const riskAdjusted = backtestCurveRisk(result?.curve);
  const wins = (result?.trades || []).filter((trade) => trade.returnPercent > 0).length;
  const losses = (result?.trades || []).filter((trade) => trade.returnPercent <= 0).length;
  return {
    tradeCount: metrics.tradeCount || 0,
    winCount: wins,
    lossCount: losses,
    winRatePercent: metrics.winRatePercent ?? null,
    profitFactor: metrics.profitFactor ?? null,
    netPnl: null,
    netReturnPercent: metrics.totalReturnPercent ?? null,
    maxDrawdownPercent: metrics.maxDrawdownPercent ?? null,
    averageWin: null,
    averageLoss: null,
    payoffRatio: null,
    expectancy: metrics.averageTradePercent ?? null,
    costBpsPerSide: metrics.costBpsPerSide,
    buyHoldReturnPercent: metrics.buyHoldReturnPercent ?? null,
    riskAdjusted,
    basis: {
      pnl: 'Simulated percentage return on a normalised unit equity; costs applied on entry and exit.',
      costs: 'Brokerage, STT, exchange charges, stamp duty and slippage beyond the modelled bps are not included.',
    },
  };
};

const strategyMetricsFor = (account, costBps) => {
  const trades = Array.isArray(account.trades) ? account.trades : [];
  const groups = new Map();
  for (const trade of trades) {
    const key = trade.openedBy === 'manual' ? 'manual' : 'ai';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }
  const startingCapital = Number(account.startingCapital) || Number(account.cash) || 100000;
  const label = { ai: 'AI Auto Trader', manual: 'Manual paper entries' };
  return [...groups.entries()].map(([key, list]) => {
    const metrics = ledgerMetrics(list, startingCapital, costBps);
    return { id: key, name: label[key] || key, source: 'paper ledger', metrics, score: scoreMetrics(metrics) };
  }).sort((a, b) => (b.score.score || 0) - (a.score.score || 0))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
};

const saveSnapshot = (userId, account, metrics) => {
  const data = store();
  if (!data.users[userId]) data.users[userId] = { snapshots: [], lastUpdatedAt: null };
  const bucket = data.users[userId];
  const date = new Date().toISOString().slice(0, 10);
  const snapshot = {
    date,
    at: new Date().toISOString(),
    equity: round2((Number(account.startingCapital) || 0) + (metrics.netPnl || 0)),
    realizedPnl: metrics.netPnl,
    tradeCount: metrics.tradeCount,
    winRatePercent: metrics.winRatePercent,
    profitFactor: metrics.profitFactor,
    maxDrawdownPercent: metrics.maxDrawdownPercent,
  };
  const existing = bucket.snapshots.findIndex((item) => item.date === date);
  if (existing >= 0) bucket.snapshots[existing] = snapshot;
  else bucket.snapshots.push(snapshot);
  bucket.snapshots = bucket.snapshots.slice(-MAX_SNAPSHOTS);
  bucket.lastUpdatedAt = snapshot.at;
  persist(data);
  return bucket.snapshots;
};

export const performanceFor = (userId, { costBps = DEFAULT_COST_BPS, broker = null } = {}) => {
  const account = getPaperAccount(userId);
  const bps = normCostBps(costBps);
  const startingCapital = Number(account.startingCapital) || Number(account.cash) || 100000;
  const metrics = ledgerMetrics(Array.isArray(account.trades) ? account.trades : [], startingCapital, bps);
  const snapshots = saveSnapshot(userId, account, metrics);
  const strategies = strategyMetricsFor(account, bps);
  const brokerConfigured = broker?.configured === true && broker?.liveOrdersEnabled === true;

  const result = {
    costBpsPerSide: bps,
    currency: 'INR',
    generatedAt: new Date().toISOString(),
    sample: {
      storedTrades: Array.isArray(account.trades) ? account.trades.length : 0,
      lifetimeTrades: Number(account.totalTrades) || 0,
      complete: (Number(account.totalTrades) || 0) <= (Array.isArray(account.trades) ? account.trades.length : 0),
      startingCapital,
    },
    paper: metrics,
    strategies,
    history: {
      snapshots,
      dailyPnl: metrics.dailyPnl || [],
      note: snapshots.length > 1
        ? 'One snapshot is stored per UTC day; snapshots are the persistent performance history across restarts.'
        : 'History starts building from the first day this engine is queried.',
    },
    paperVsLive: {
      paper: {
        available: true,
        tradeCount: metrics.tradeCount,
        netPnl: metrics.netPnl,
        netReturnPercent: metrics.netReturnPercent,
        maxDrawdownPercent: metrics.maxDrawdownPercent,
      },
      live: {
        available: false,
        tradeCount: 0,
        reason: brokerConfigured
          ? 'Live execution is disabled by policy on this deployment, so no live fills exist to compare.'
          : 'No broker order-routing provider is configured; only paper execution exists. Live metrics are unavailable rather than estimated.',
      },
      mode: 'paper-only',
    },
    ranking: {
      strategy: 'Composite: 30% risk-adjusted returns, 25% profit factor, 20% drawdown control, 10% net return, 15% win rate, then scaled by sample size.',
      note: 'Strategies are never ranked by win rate alone; costs and drawdown are included.',
    },
    disclaimer: 'Paper performance is not indicative of live results. Past performance does not guarantee future returns.',
  };
  publish('performance.updated', { userId, tradeCount: metrics.tradeCount, score: scoreMetrics(metrics).score, at: result.generatedAt });
  return result;
};

const pickGridResult = (symbol, candles, costBps) => {
  let best = null;
  const candidates = [];
  for (const targetPercent of GRID.targetPercent) {
    for (const stopLossPercent of GRID.stopLossPercent) {
      const run = runBacktestSeries({ symbol, candles, days: candles.length, targetPercent, stopLossPercent, costBps });
      const metrics = backtestMetrics(run);
      const score = scoreMetrics(metrics);
      candidates.push({ targetPercent, stopLossPercent, metrics, score });
      if (score.score === null) continue;
      if (!best || score.score > best.score.score) best = { targetPercent, stopLossPercent, metrics, score };
    }
  }
  return { best, candidates };
};

export const runWalkForward = async (userId, { symbols = [], days = 500, costBps = null, trainRatio = 0.7 } = {}) => {
  const bps = normCostBps(costBps);
  const ratio = clamp(Number(trainRatio) || 0.7, 0.5, 0.85);
  const requested = [...new Set((Array.isArray(symbols) ? symbols : [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9.&-]{1,20}$/.test(symbol)))].slice(0, 20);
  const cap = clamp(Number(days) || 500, 160, 1600);
  const results = [];

  for (const symbol of requested) {
    const candles = await getPaperDailyCandles(symbol);
    const series = Array.isArray(candles) ? candles.filter((candle) => candle.close > 0).slice(-cap) : [];
    if (series.length < 160) {
      results.push({
        symbol,
        status: 'insufficient_history',
        reason: `Only ${series.length} verified daily bars available; at least 160 are required for a 70/30 walk-forward split.`,
      });
      continue;
    }
    const splitIndex = Math.max(100, Math.floor(series.length * ratio));
    const train = series.slice(0, splitIndex);
    const test = series.slice(splitIndex);
    const { best, candidates } = pickGridResult(symbol, train, bps);
    if (!best || !best.metrics.tradeCount) {
      results.push({ symbol, status: 'no_signals', reason: 'The rule set produced no in-sample trades on the verified history.' });
      continue;
    }
    const oosRun = runBacktestSeries({
      symbol,
      candles: test,
      days: test.length,
      targetPercent: best.targetPercent,
      stopLossPercent: best.stopLossPercent,
      costBps: bps,
    });
    const oos = backtestMetrics(oosRun);
    const degradation = (best.metrics.netReturnPercent ?? 0) - (oos.netReturnPercent ?? 0);
    const status = oos.tradeCount < 3
      ? 'insufficient_out_of_sample_trades'
      : (oos.netReturnPercent ?? 0) > 0 && (oos.profitFactor ?? 0) >= 1
        ? 'held_up'
        : (oos.netReturnPercent ?? 0) <= 0 && degradation > 0
          ? 'degraded'
          : 'mixed';
    results.push({
      symbol,
      status,
      split: { trainBars: train.length, testBars: test.length, trainRatio: round2(ratio), costBpsPerSide: bps },
      selectedParameters: { targetPercent: best.targetPercent, stopLossPercent: best.stopLossPercent },
      inSample: { ...best.metrics, score: best.score.score, gridCandidates: candidates.length, topScoreComponents: best.score.components },
      outOfSample: { ...oos, score: scoreMetrics(oos).score },
      outOfSampleCurve: oosRun.curve,
      degradationPercent: round2(degradation),
      notes: [
        'Parameters are chosen only on the first split of verified daily bars, then evaluated once on the untouched later split.',
        'Out-of-sample results are still a simulation on past bars, not a forecast.',
      ],
    });
  }

  const tested = results.filter((item) => item.status !== 'insufficient_history');
  const evaluable = tested.filter((item) => ['held_up', 'mixed', 'degraded'].includes(item.status));
  const observed = tested.filter((item) => (item.outOfSample?.tradeCount || 0) >= 1);
  const heldUp = evaluable.filter((item) => item.status === 'held_up').length;
  const verdict = !tested.length
    ? 'insufficient_data'
    : !evaluable.length
      ? 'inconclusive'
      : heldUp === evaluable.length
        ? 'held_up'
        : heldUp > 0
          ? 'mixed'
          : 'degraded';

  const payload = {
    generatedAt: new Date().toISOString(),
    costBpsPerSide: bps,
    costModel: bps == null ? 'indian_equity_delivery' : 'flat',
    requestedSymbols: requested,
    testedSymbols: tested.length,
    verdict,
    summary: {
      heldUp,
      mixed: tested.filter((item) => item.status === 'mixed').length,
      degraded: tested.filter((item) => item.status === 'degraded').length,
      inconclusive: results.filter((item) => item.status === 'insufficient_out_of_sample_trades').length,
      insufficientHistory: results.filter((item) => item.status === 'insufficient_history').length,
      averageOutOfSampleReturnPercent: observed.length
        ? round2(mean(observed.map((item) => item.outOfSample.netReturnPercent).filter(Number.isFinite)) || 0)
        : null,
      observedOutOfSampleRuns: observed.length,
    },
    results,
    assumptions: [
      'Walk-forward split uses 70% of the verified daily bars for parameter selection and the untouched remainder for evaluation.',
      bps == null
        ? 'Indian equity delivery charges are applied on every entry and exit (brokerage capped at ₹20/order, STT, stamp duty, exchange and SEBI fees, GST, DP charge).'
        : `A modelled cost of ${bps} bps per side is applied on entry and exit. Taxes, stamp duty and slippage beyond that are excluded.`,
      'The rule set is fixed; only target and stop-loss grid values are tuned in-sample.',
      'Historical simulation is not a forecast and does not guarantee future results.',
    ],
  };

  const data = store();
  if (!data.users[userId]) data.users[userId] = { snapshots: [], lastUpdatedAt: null };
  data.users[userId].lastWalkForward = {
    at: payload.generatedAt,
    verdict,
    testedSymbols: payload.testedSymbols,
    summary: payload.summary,
  };
  data.users[userId].lastUpdatedAt = payload.generatedAt;
  persist(data);
  recordAudit({
    actor: { id: userId, role: 'trader', name: 'Performance Score' },
    action: 'walkforward.completed',
    resource: 'performance',
    detail: { verdict, testedSymbols: payload.testedSymbols, costBps: bps },
  });
  publish('performance.walkforward', { userId, verdict, testedSymbols: payload.testedSymbols, at: payload.generatedAt });
  return payload;
};

export const performanceStatus = () => {
  const data = store();
  const users = Object.values(data.users || {});
  const snapshots = users.reduce((total, user) => total + (Array.isArray(user.snapshots) ? user.snapshots.length : 0), 0);
  const lastUpdatedAt = users.map((user) => user.lastUpdatedAt).filter(Boolean).sort().pop() || null;
  return {
    store: STORE_NAME,
    users: users.length,
    snapshots,
    lastUpdatedAt,
    costBpsPerSide: DEFAULT_COST_BPS,
    walkForwardGrid: GRID,
  };
};
