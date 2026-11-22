import { getPaperAccount, computePaperSignals, getPaperFeedSnapshot, getPaperQuotes, getPaperStatusFor } from './serverAutoTrade.js';
import { authorizeEntry, shieldStatus, shieldStats } from './serverRiskShield.js';
import { recoveryStatus, recoveryStats } from './serverRecovery.js';
import { performanceStatus } from './serverPerformance.js';
import { healthMetadata, healthStatus } from './serverHealth.js';
import { publish, recentEvents } from './serverCoreBus.js';
import { recordAudit } from './serverCoreAudit.js';

const round2 = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const iso = () => new Date().toISOString();

const quoteBasis = (quote) => {
  if (!quote) return 'unavailable';
  if (quote.isLive === true) return 'live';
  if (quote.isResearch === true || quote.isDelayed === true) return 'delayed';
  return 'unknown';
};

const quoteAgeSeconds = (quote) => {
  const raw = Number(quote?.timestamp);
  if (!(raw > 0)) return null;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  return Math.max(0, Math.round((Date.now() - ms) / 1000));
};

const istSession = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const weekday = value('weekday');
  const minutes = Number(value('hour')) * 60 + Number(value('minute'));
  return {
    marketOpen: weekday !== 'Sat' && weekday !== 'Sun' && minutes >= 555 && minutes < 930,
    istTime: `${value('hour')}:${value('minute')}`,
    weekday,
    note: 'Exchange holidays are not applied here.',
  };
};

const MODEL_LIBRARY = [
  { id: 'trend', name: 'Trend structure', weight: 0.3 },
  { id: 'momentum', name: '20-day momentum', weight: 0.25 },
  { id: 'meanReversion', name: 'RSI mean reversion', weight: 0.15 },
  { id: 'composite', name: 'Composite signal score', weight: 0.2 },
  { id: 'regime', name: 'Volatility regime filter', weight: 0.1 },
];

const modelVotes = (signal) => {
  const price = Number(signal?.price);
  const sma20 = Number(signal?.sma20);
  const sma50 = Number(signal?.sma50);
  const rsi = Number(signal?.rsi14);
  const momentum = Number(signal?.momentum20Percent);
  const atr = Number(signal?.atr14Percent);
  const score = Number(signal?.score);

  const trendVote = sma20 > 0 && sma50 > 0 && price > 0
    ? (sma20 > sma50 && price > sma20 ? 1 : sma20 < sma50 && price < sma20 ? -1 : 0)
    : 0;
  const trendStrength = sma50 > 0 && Number.isFinite(sma20) ? clamp(Math.abs(sma20 - sma50) / sma50 / 0.02, 0, 1) : 0;

  const momentumVote = Number.isFinite(momentum) ? (momentum > 1 ? 1 : momentum < -1 ? -1 : 0) : 0;
  const momentumStrength = Number.isFinite(momentum) ? clamp(Math.abs(momentum) / 6, 0, 1) : 0;

  const rsiVote = Number.isFinite(rsi) ? (rsi < 35 ? 1 : rsi > 70 ? -1 : 0) : 0;
  const rsiStrength = Number.isFinite(rsi) ? clamp(Math.abs(rsi - 50) / 25, 0, 1) : 0;

  const compositeVote = Number.isFinite(score) ? clamp((score - 55) / 30, -1, 1) : 0;
  const compositeStrength = Number.isFinite(score) ? clamp(Math.abs(score - 50) / 40, 0, 1) : 0;

  const highVolatility = Number.isFinite(atr) && atr > 3;
  const regimeVote = highVolatility ? 0 : trendVote;
  const regimeStrength = highVolatility ? 0 : trendStrength;

  return [
    {
      id: 'trend',
      vote: trendVote,
      strength: round2(trendStrength),
      evidence: sma20 > 0 && sma50 > 0
        ? `SMA20 ${sma20} vs SMA50 ${sma50}; last ${price}.`
        : 'Trend averages are unavailable in the verified history.',
    },
    {
      id: 'momentum',
      vote: momentumVote,
      strength: round2(momentumStrength),
      evidence: Number.isFinite(momentum) ? `20-day momentum ${momentum}%.` : 'Momentum is unavailable in the verified history.',
    },
    {
      id: 'meanReversion',
      vote: rsiVote,
      strength: round2(rsiStrength),
      evidence: Number.isFinite(rsi) ? `RSI(14) at ${rsi}.` : 'RSI is unavailable in the verified history.',
    },
    {
      id: 'composite',
      vote: round2(compositeVote),
      strength: round2(compositeStrength),
      evidence: Number.isFinite(score) ? `Composite signal score ${score}/100 (${signal.action}).` : 'Composite score is unavailable.',
    },
    {
      id: 'regime',
      vote: regimeVote,
      strength: round2(regimeStrength),
      evidence: highVolatility
        ? `ATR is ${atr}% of price — volatility is high, so the regime filter withholds a directional vote.`
        : Number.isFinite(atr) ? `ATR is ${atr}% of price — normal volatility regime.` : 'Volatility regime is unavailable.',
    },
  ];
};

const dataQuality = ({ quote, signal, bars }) => {
  const basis = quoteBasis(quote);
  const age = quoteAgeSeconds(quote);
  const factors = [];
  let score = 1;
  if (basis === 'live') factors.push('Live provider quote.');
  else if (basis === 'delayed') { score *= 0.92; factors.push('Delayed research quote.'); }
  else if (basis === 'unknown') { score *= 0.6; factors.push('Quote basis is unknown.'); }
  else { score = 0; factors.push('No usable quote was returned.'); }

  if (age !== null) {
    if (age > 900) { score *= 0.4; factors.push(`Quote is ${Math.round(age / 60)} minutes old.`); }
    else if (age > 120) { score *= 0.85; factors.push(`Quote is ${age} seconds old.`); }
    else factors.push(`Quote age ${age} seconds.`);
  } else {
    score *= 0.8;
    factors.push('Quote timestamp is unavailable.');
  }

  if (!signal || !Number.isFinite(Number(signal.score))) { score = 0; factors.push('Verified daily history is required for signal models and is unavailable.'); }
  else if (Number(bars) < 100) { score *= 0.7; factors.push(`Only ${bars} verified daily bars were used.`); }
  else factors.push(`${bars} verified daily bars.`);

  return { score: round2(clamp(score, 0, 1)), basis, ageSeconds: age, factors };
};

const consensusFor = (models) => {
  let weight = 0;
  let weighted = 0;
  for (const model of models) {
    const entry = MODEL_LIBRARY.find((item) => item.id === model.id);
    const w = entry?.weight || 0;
    weight += w;
    weighted += model.vote * model.strength * w;
  }
  const raw = weight > 0 ? weighted / weight : 0;
  const direction = Math.sign(raw);
  const directionalWeight = models.reduce((total, model) => {
    const w = MODEL_LIBRARY.find((item) => item.id === model.id)?.weight || 0;
    return total + (model.vote === 0 ? 0 : w);
  }, 0);
  const agreement = directionalWeight > 0
    ? models.filter((model) => model.vote !== 0 && Math.sign(model.vote) === direction)
      .reduce((total, model) => total + (MODEL_LIBRARY.find((item) => item.id === model.id)?.weight || 0), 0) / directionalWeight
    : 0;
  return { raw: clamp(raw, -1, 1), agreement: round2(agreement), directionalWeight: round2(directionalWeight) };
};

const classify = (raw, confidence) => {
  if (confidence < 35) return 'insufficient_edge';
  if (raw >= 0.45 && confidence >= 60) return 'strong_buy_candidate';
  if (raw >= 0.2 && confidence >= 50) return 'buy_candidate';
  if (raw <= -0.45 && confidence >= 60) return 'strong_avoid';
  if (raw <= -0.2 && confidence >= 50) return 'avoid';
  return 'watch';
};

const explanationFor = ({ symbol, decision, models, consensus, confidence, quality, context, signal }) => {
  const direction = consensus.raw > 0.1 ? 'bullish' : consensus.raw < -0.1 ? 'bearish' : 'mixed';
  const strongest = [...models].sort((a, b) => Math.abs(b.vote * b.strength) - Math.abs(a.vote * a.strength))[0];
  const parts = [
    `${symbol}: the deterministic ensemble is ${direction} with ${confidence}% confidence and ${100 - confidence}% uncertainty.`,
    strongest ? `Strongest input is ${MODEL_LIBRARY.find((item) => item.id === strongest.id)?.name}: ${strongest.evidence}` : null,
    signal?.score !== undefined ? `Composite score ${signal.score}/100 reads ${signal.action}.` : null,
    `Data quality ${Math.round(quality.score * 100)}% (${quality.basis} quote${quality.ageSeconds !== null ? `, ${quality.ageSeconds}s old` : ''}).`,
    context?.regime ? `Watchlist breadth is ${context.breadthPercent}% advancing, so the session regime is ${context.regime}.` : null,
    'This is a rules-based, data-grounded read — not an LLM forecast. Execution stays paper-only and the Risk Shield has final authority.',
  ].filter(Boolean);
  return { summary: parts.join(' '), decision, direction };
};

export const evaluateSymbol = async (userId, symbol, { allowPreflight = false, actor = null } = {}) => {
  const cleaned = String(symbol || '').trim().toUpperCase();
  const session = istSession();
  const account = getPaperAccount(userId);
  const quotes = await getPaperQuotes([cleaned]);
  const quote = quotes[cleaned] || null;
  let signal = null;
  let signalError = null;
  try {
    const [computed] = await computePaperSignals([cleaned]);
    if (computed?.error) signalError = computed.error;
    else signal = computed;
  } catch (error) {
    signalError = error.message;
  }

  const quality = dataQuality({ quote, signal, bars: signal?.bars });
  if (!signal) {
    return {
      symbol: cleaned,
      status: 'unavailable',
      decision: 'insufficient_data',
      confidence: 0,
      uncertainty: 100,
      explanation: `${cleaned}: ${signalError || 'Verified daily history is unavailable.'} No signal or confidence is fabricated.`,
      models: [],
      quote: quote ? { price: round2(quote.c), basis: quality.basis, ageSeconds: quality.ageSeconds } : null,
      dataQuality: quality,
      execution: { executed: false, reason: 'Live trading is disabled and no paper entry was placed by an analysis request.' },
      riskPreview: null,
      engine: 'deterministic ensemble · verified OHLC',
      generatedAt: iso(),
    };
  }

  const models = modelVotes(signal);
  const consensus = consensusFor(models);
  const confidence = Math.round(clamp(Math.abs(consensus.raw) * (0.55 + 0.45 * consensus.agreement) * quality.score * 100, 0, 100));
  const decision = classify(consensus.raw, confidence);
  const feed = getPaperFeedSnapshot();
  const status = getPaperStatusFor(userId);
  const context = {
    feed: { lastRunAt: feed.lastRunAt, ageSeconds: feed.ageSeconds, dataBasis: feed.dataBasis, marketOpen: feed.marketOpen },
    marketOpen: session.marketOpen,
    istTime: session.istTime,
    equity: status?.equity ?? null,
    cash: status?.cash ?? null,
    openPositions: status?.openPositions ?? account.positions.length,
  };
  const explanation = explanationFor({ symbol: cleaned, decision, models, consensus, confidence, quality, context, signal });

  let riskPreview = null;
  if (allowPreflight) {
    riskPreview = authorizeEntry({
      userId,
      account,
      quote,
      signal,
      source: 'preflight',
      marketOpen: session.marketOpen,
      quoteAgeSeconds: quality.ageSeconds,
      actor: actor || { id: userId, role: 'trader', name: 'AI Super Brain preflight' },
    });
  }

  const result = {
    symbol: cleaned,
    status: quality.score > 0 ? 'evaluated' : 'degraded_data',
    decision,
    confidence,
    uncertainty: 100 - confidence,
    uncertaintyBand: confidence >= 65 ? 'low' : confidence >= 45 ? 'medium' : 'high',
    consensus: { score: round2(consensus.raw), agreement: consensus.agreement, directionalWeight: consensus.directionalWeight },
    models: models.map((model) => ({
      ...model,
      ...MODEL_LIBRARY.find((item) => item.id === model.id),
      contribution: round2(model.vote * model.strength * (MODEL_LIBRARY.find((item) => item.id === model.id)?.weight || 0)),
    })),
    signal: {
      score: signal.score,
      action: signal.action,
      trend: signal.trend,
      price: signal.price,
      asOf: signal.asOf,
      basis: signal.basis,
      reasons: signal.reasons,
    },
    quote: quote ? {
      price: round2(quote.c),
      changePercent: Number.isFinite(Number(quote.dp)) ? round2(quote.dp) : null,
      basis: quality.basis,
      ageSeconds: quality.ageSeconds,
      asOf: quote.timestamp ? new Date((Number(quote.timestamp) < 1e12 ? Number(quote.timestamp) * 1000 : Number(quote.timestamp))).toISOString() : null,
    } : null,
    context,
    dataQuality: quality,
    explanation: explanation.summary,
    riskPreview: riskPreview ? {
      advisoryOnly: true,
      allowed: riskPreview.allowed,
      reason: riskPreview.reason,
      qty: riskPreview.qty,
      value: riskPreview.value,
      stopLoss: riskPreview.stopLoss,
      target: riskPreview.target,
      idempotencyKey: riskPreview.idempotencyKey,
      decisionId: riskPreview.id,
      checks: riskPreview.checks,
    } : null,
    execution: {
      executed: false,
      mode: 'paper-only',
      requiresExplicitAuthorization: true,
      reason: 'Analysis never places an order. Automated paper entries must pass the Risk Shield; live broker execution is disabled.',
    },
    engine: 'deterministic ensemble · verified OHLC',
    liveTrading: false,
    generatedAt: iso(),
  };
  publish('brain.evaluated', {
    userId,
    symbol: cleaned,
    decision,
    confidence,
    quoteBasis: quality.basis,
    at: result.generatedAt,
  });
  return result;
};

export const evaluateWatchlist = async (userId, { symbols = null, limit = 8, allowPreflight = false, actor = null } = {}) => {
  const account = getPaperAccount(userId);
  const requested = Array.isArray(symbols) && symbols.length
    ? symbols
    : Array.isArray(account.watchlist) ? account.watchlist : [];
  const cleaned = [...new Set(requested.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))].slice(0, clamp(Number(limit) || 8, 1, 12));
  const evaluations = [];
  for (const symbol of cleaned) {
    try {
      evaluations.push(await evaluateSymbol(userId, symbol, { allowPreflight, actor }));
    } catch (error) {
      evaluations.push({
        symbol,
        status: 'error',
        decision: 'insufficient_data',
        confidence: 0,
        uncertainty: 100,
        explanation: `${symbol}: ${error.message}`,
        models: [],
        execution: { executed: false, mode: 'paper-only' },
        liveTrading: false,
        generatedAt: iso(),
      });
    }
  }
  const evaluated = evaluations.filter((item) => item.status === 'evaluated');
  const quotes = await getPaperQuotes(evaluated.map((item) => item.symbol));
  const advancing = Object.values(quotes).filter((quote) => Number(quote?.dp) > 0).length;
  const breadthPercent = Object.keys(quotes).length ? round2((advancing / Object.keys(quotes).length) * 100) : null;
  const averageChange = Object.values(quotes).map((quote) => Number(quote?.dp)).filter(Number.isFinite);
  const regime = breadthPercent === null ? 'unknown' : breadthPercent >= 60 ? 'risk-on' : breadthPercent <= 40 ? 'risk-off' : 'mixed';

  const summary = {
    generatedAt: iso(),
    userId,
    market: {
      ...istSession(),
      breadthPercent,
      averageChangePercent: averageChange.length ? round2(averageChange.reduce((total, value) => total + value, 0) / averageChange.length) : null,
      regime,
      feed: getPaperFeedSnapshot(),
    },
    engine: 'deterministic ensemble · verified OHLC',
    llmConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.LLM_API_KEY),
    liveTrading: false,
    symbolsEvaluated: evaluated.length,
    highConfidence: evaluated.filter((item) => item.confidence >= 65).length,
    averageConfidence: evaluated.length ? Math.round(evaluated.reduce((total, item) => total + item.confidence, 0) / evaluated.length) : null,
    evaluations: evaluations.map((item) => ({
      ...item,
      context: { ...item.context, regime, breadthPercent },
    })),
    riskAuthority: 'AI Risk Shield remains the final gate for every automated or preflight order.',
    disclaimer: 'Rules-based read from delayed research data. Not a forecast, not investment advice, and not an execution instruction.',
  };
  recordAudit({
    actor: actor || { id: userId, role: 'trader', name: 'AI Super Brain' },
    action: 'brain.watchlist_evaluated',
    resource: `brain:${userId}`,
    detail: { symbols: cleaned, evaluated: evaluated.length, highConfidence: summary.highConfidence },
  });
  return summary;
};

export const brainOverview = async (userId, { actor = null } = {}) => {
  const account = getPaperAccount(userId);
  const status = getPaperStatusFor(userId);
  const performance = performanceStatus();
  const health = healthStatus();
  const recovery = recoveryStatus(userId, { getAccount: getPaperAccount });
  const shield = shieldStatus(userId, account);
  const feed = getPaperFeedSnapshot();
  const session = istSession();
  const recent = recentEvents(30);
  const modules = [
    {
      id: 'brain',
      name: 'AI Super Brain',
      status: 'online',
      summary: `Deterministic ensemble over ${account.watchlist.length} watchlist symbol(s). Explanations are computed, not generated.`,
      metrics: { watchlist: account.watchlist.length, llmConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.LLM_API_KEY) },
    },
    {
      id: 'risk',
      name: 'AI Risk Shield',
      status: shield.killSwitch?.active ? 'halted' : 'online',
      summary: shield.killSwitch?.active
        ? `Kill switch active: ${shield.killSwitch.reason || 'manual halt'}.`
        : `Independent pre-trade authority. ${shield.today.blocked} blocked / ${shield.today.evaluated} evaluated today.`,
      metrics: { ...shieldStats(), drawdownPercent: shield.drawdownPercent, today: shield.today },
    },
    {
      id: 'recovery',
      name: 'Smart Recovery Engine',
      status: recovery.counts.unresolved > 0 ? 'attention' : recovery.provider.status === 'unreachable' ? 'degraded' : 'online',
      summary: `${recovery.counts.pending} pending, ${recovery.counts.unresolved} unresolved intent(s). Broker routing: ${recovery.broker.configured ? 'configured' : 'not configured'}.`,
      metrics: { ...recoveryStats(), retryPolicy: recovery.provider.retryPolicy },
    },
    {
      id: 'performance',
      name: 'AI Performance Score',
      status: 'online',
      summary: `${performance.snapshots} stored snapshot(s) across ${performance.users} account(s). Costs modelled at ${performance.costBpsPerSide} bps per side.`,
      metrics: performance,
    },
    {
      id: 'health',
      name: '24/7 System Health',
      status: health.status,
      summary: `Last check ${health.checkedAt}. Monitoring continues outside market hours.`,
      metrics: {
        uptimeSeconds: health.components?.system?.uptimeSeconds ?? null,
        activeIncidents: health.activeIncidents ?? 0,
        intervalSeconds: healthMetadata().intervalMs / 1000,
        api: health.components?.api,
        database: health.components?.database?.status,
        feed: health.components?.marketFeed?.status,
        realtime: health.components?.realtime?.status,
      },
    },
  ];

  const overview = {
    generatedAt: iso(),
    user: { id: userId, role: actor?.role || 'trader' },
    mode: {
      liveTrading: false,
      paperOnly: true,
      brokerRouting: recovery.broker.configured ? 'configured' : 'not_configured',
      engine: 'deterministic ensemble · verified OHLC',
      llmConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.LLM_API_KEY),
      disclaimer: 'Live broker order placement is disabled by policy on this deployment.',
    },
    market: {
      ...session,
      feed,
      regime: 'computed per evaluation',
    },
    account: status ? {
      cash: status.cash,
      equity: status.equity,
      investedValue: status.investedValue,
      openPositions: status.openPositions,
      dayPnl: status.dayPnl,
      totalPnl: status.totalPnl,
      watchlist: status.watchlist,
    } : {
      cash: account.cash,
      equity: account.cash,
      investedValue: 0,
      openPositions: account.positions.length,
      watchlist: account.watchlist,
    },
    killSwitch: shield.killSwitch,
    modules,
    communication: {
      transport: 'event bus + Server-Sent Events + WebSocket',
      recentEvents: recent,
      lastEventAt: recent[0]?.at || null,
      subscribers: modules.length,
    },
    safety: {
      killSwitchAuthority: 'independent',
      liveOrders: 'disabled',
      orderRouting: recovery.broker.configured ? 'configured' : 'not_configured',
      requiresExplicitAuthorization: true,
      note: 'AI analysis cannot bypass the Risk Shield or authorization. Every automated order is audited in a hash-chained log.',
    },
    disclaimer: 'Paper-only AI infrastructure. Market reads use delayed research data and are not investment advice.',
  };
  recordAudit({
    actor: actor || { id: userId, role: 'trader', name: 'AI Super Brain' },
    action: 'core.overview_read',
    resource: 'core',
    detail: { modules: modules.length, liveTrading: false },
  });
  return overview;
};

export const brainStatus = () => ({
  engine: 'deterministic ensemble · verified OHLC',
  models: MODEL_LIBRARY,
  llmConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.LLM_API_KEY),
  liveTrading: false,
});
