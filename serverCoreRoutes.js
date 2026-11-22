import { readSessionUser } from './serverAuth.js';
import { addSseClient, recentEvents, removeSseClient } from './serverCoreBus.js';
import { readAudit, verifyAudit } from './serverCoreAudit.js';
import { getPaperAccount, getPaperBrokerStatus } from './serverAutoTrade.js';
import { brainOverview, brainStatus, evaluateSymbol, evaluateWatchlist } from './serverAICore.js';
import { killSwitchFor, setKillSwitch, shieldStatus } from './serverRiskShield.js';
import { acknowledgeRecoveryAlert, reconcile, recoveryStatus } from './serverRecovery.js';
import { performanceFor, runWalkForward } from './serverPerformance.js';
import {
  acknowledgeIncident,
  healthMetadata,
  healthSnapshot,
  healthStatus,
  listIncidents,
  recordCoreError,
} from './serverHealth.js';

const ROLES = ['viewer', 'trader', 'admin'];
const WALK_FORWARD_COOLDOWN_MS = 90_000;
const walkForwardRuns = new Map();

const roleOf = (user) => (ROLES.includes(user?.role) ? user.role : 'trader');
const fail = (res, status, message, code) => res.status(status).json({ error: message, code });

const requireUser = (req, res) => {
  const user = readSessionUser(req);
  if (!user) {
    fail(res, 401, 'Please sign in to use the AI Core.', 'not_authenticated');
    return null;
  }
  return user;
};

const requireTrader = (user, res) => {
  if (roleOf(user) === 'viewer') {
    fail(res, 403, 'Your account has read-only access. A trader or admin role is required for this action.', 'insufficient_role');
    return false;
  }
  return true;
};

const actorFor = (user, name) => ({ id: user.id, role: roleOf(user), name: name || user.name || user.id });
const symbolOf = (value) => {
  const symbol = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9.&-]{1,20}$/.test(symbol) ? symbol : null;
};

export const registerCoreRoutes = (app) => {
  app.get('/api/core/overview', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await brainOverview(user.id, { actor: actorFor(user, 'AI Super Brain') }));
    } catch (error) {
      recordCoreError({ scope: 'core-overview', message: error.message, stack: error.stack, userId: user.id });
      fail(res, 503, 'The AI Core overview is temporarily unavailable.', 'core_overview_unavailable');
    }
  });

  app.get('/api/core/brain/status', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    res.json(brainStatus());
  });

  app.post('/api/core/brain/evaluate', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const symbol = symbolOf(req.body?.symbol);
    if (!symbol) return fail(res, 400, 'Provide a valid NSE trading symbol.', 'invalid_symbol');
    const wantsPreflight = req.body?.preflight === true;
    if (wantsPreflight && !requireTrader(user, res)) return;
    res.set('Cache-Control', 'no-store');
    try {
      const evaluation = await evaluateSymbol(user.id, symbol, {
        allowPreflight: wantsPreflight,
        actor: actorFor(user, 'AI Super Brain'),
      });
      res.json(evaluation);
    } catch (error) {
      recordCoreError({ scope: 'brain-evaluate', message: error.message, stack: error.stack, userId: user.id });
      fail(res, 503, 'The AI Super Brain could not complete this evaluation.', 'brain_evaluation_failed');
    }
  });

  app.post('/api/core/brain/watchlist', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const wantsPreflight = req.body?.preflight === true;
    if (wantsPreflight && !requireTrader(user, res)) return;
    const symbols = Array.isArray(req.body?.symbols)
      ? req.body.symbols.map(symbolOf).filter(Boolean).slice(0, 12)
      : null;
    if (req.body?.symbols && !symbols) return fail(res, 400, 'Provide an array of valid symbols.', 'invalid_symbols');
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await evaluateWatchlist(user.id, {
        symbols,
        limit: req.body?.limit,
        allowPreflight: wantsPreflight,
        actor: actorFor(user, 'AI Super Brain'),
      }));
    } catch (error) {
      recordCoreError({ scope: 'brain-watchlist', message: error.message, stack: error.stack, userId: user.id });
      fail(res, 503, 'The AI Super Brain could not evaluate the watchlist.', 'brain_watchlist_failed');
    }
  });

  app.get('/api/core/risk/status', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const account = getPaperAccount(user.id);
    res.set('Cache-Control', 'no-store');
    res.json({
      ...shieldStatus(user.id, account),
      role: roleOf(user),
      configEditable: roleOf(user) === 'admin',
      liveTrading: false,
      authority: 'independent · final gate for automated and preflight orders',
    });
  });

  app.post('/api/core/risk/preflight', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!requireTrader(user, res)) return;
    const symbol = symbolOf(req.body?.symbol);
    if (!symbol) return fail(res, 400, 'Provide a valid NSE trading symbol.', 'invalid_symbol');
    res.set('Cache-Control', 'no-store');
    try {
      const evaluation = await evaluateSymbol(user.id, symbol, {
        allowPreflight: true,
        actor: actorFor(user, 'Risk Shield preflight'),
      });
      if (!evaluation.riskPreview) {
        return res.status(409).json({
          error: evaluation.explanation || 'No usable quote is available for a preflight.',
          code: 'preflight_unavailable',
          evaluation,
        });
      }
      res.json({
        symbol,
        preflight: evaluation.riskPreview,
        confidence: evaluation.confidence,
        uncertainty: evaluation.uncertainty,
        explanation: evaluation.explanation,
        executed: false,
        liveTrading: false,
        note: 'Preflight is advisory. It never places an order; the same Risk Shield gate runs again for any automated entry.',
      });
    } catch (error) {
      recordCoreError({ scope: 'risk-preflight', message: error.message, stack: error.stack, userId: user.id });
      fail(res, 503, 'The Risk Shield could not complete this preflight.', 'preflight_failed');
    }
  });

  app.post('/api/core/risk/kill-switch', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!requireTrader(user, res)) return;
    const active = req.body?.active === true;
    const reason = String(req.body?.reason || '').trim();
    if (active && reason.length < 4) return fail(res, 400, 'Enter a reason of at least 4 characters to stop automated trading.', 'reason_required');
    if (!active) {
      const current = killSwitchFor(user.id);
      if (current?.active && reason.length < 4) {
        return fail(res, 400, 'Enter a reason of at least 4 characters before releasing the kill switch.', 'reason_required');
      }
    }
    const result = setKillSwitch({ userId: user.id, active, reason: reason || 'Kill switch released by user.', actor: actorFor(user, 'Risk Shield') });
    if (!result.ok) return fail(res, 400, result.error, result.code || 'kill_switch_failed');
    res.json({ ...result, role: roleOf(user), active, liveTrading: false });
  });

  app.get('/api/core/recovery', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    res.json(recoveryStatus(user.id, { broker: getPaperBrokerStatus(), getAccount: getPaperAccount }));
  });

  app.post('/api/core/recovery/reconcile', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!requireTrader(user, res)) return;
    const result = reconcile({ getAccount: getPaperAccount });
    res.json({
      ...result,
      broker: getPaperBrokerStatus()?.orderRouting || { configured: false },
      policy: 'A timed-out intent is verified against the paper ledger before any retry decision. It is never blindly resubmitted.',
    });
  });

  app.post('/api/core/recovery/alerts/:id/ack', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!requireTrader(user, res)) return;
    const result = acknowledgeRecoveryAlert({ alertId: String(req.params.id), actor: actorFor(user, 'Recovery Engine') });
    if (!result.ok) return fail(res, 404, result.error, result.code || 'alert_not_found');
    res.json(result);
  });

  app.get('/api/core/performance', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    try {
      res.json(performanceFor(user.id, { costBps: req.query.costBps, broker: getPaperBrokerStatus() }));
    } catch (error) {
      recordCoreError({ scope: 'performance', message: error.message, stack: error.stack, userId: user.id });
      fail(res, 503, 'Performance metrics are temporarily unavailable.', 'performance_unavailable');
    }
  });

  app.post('/api/core/performance/walk-forward', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!requireTrader(user, res)) return;
    const last = walkForwardRuns.get(user.id) || 0;
    const waitMs = WALK_FORWARD_COOLDOWN_MS - (Date.now() - last);
    if (waitMs > 0) {
      res.set('Retry-After', String(Math.ceil(waitMs / 1000)));
      return fail(res, 429, `An out-of-sample run is limited to once every ${WALK_FORWARD_COOLDOWN_MS / 1000} seconds.`, 'walkforward_cooldown');
    }
    const account = getPaperAccount(user.id);
    const requestedSymbols = Array.isArray(req.body?.symbols) && req.body.symbols.length
      ? [...new Set(req.body.symbols.map(symbolOf).filter(Boolean))]
      : account.watchlist;
    if (requestedSymbols.some((symbol) => !account.watchlist.includes(symbol))) {
      return fail(res, 400, 'Walk-forward tests are limited to symbols in your configured AI watchlist.', 'symbol_outside_watchlist');
    }
    const symbols = requestedSymbols.slice(0, 20);
    if (!symbols.length) return fail(res, 400, 'Provide at least one valid symbol.', 'invalid_symbols');
    walkForwardRuns.set(user.id, Date.now());
    res.set('Cache-Control', 'no-store');
    try {
      const result = await runWalkForward(user.id, {
        symbols,
        days: req.body?.days,
        costBps: req.body?.costBps,
      });
      res.json({ ...result, role: roleOf(user), liveTrading: false });
    } catch (error) {
      recordCoreError({ scope: 'walk-forward', message: error.message, stack: error.stack, userId: user.id });
      fail(res, 503, 'The walk-forward test could not be completed.', 'walkforward_failed');
    }
  });

  app.get('/api/core/health', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    res.json({ ...healthSnapshot(), metadata: healthMetadata(), role: roleOf(user) });
  });

  app.get('/api/core/incidents', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    res.json({ incidents: listIncidents(req.query.limit), status: healthStatus().status, metadata: healthMetadata() });
  });

  app.post('/api/core/incidents/:id/ack', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!requireTrader(user, res)) return;
    const result = acknowledgeIncident(String(req.params.id), actorFor(user, 'Health Monitor'));
    if (!result.ok) return fail(res, 404, 'Incident not found.', result.error);
    res.json(result);
  });

  app.get('/api/core/audit', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    res.json({
      verification: verifyAudit(),
      entries: readAudit(req.query.limit || 40),
      role: roleOf(user),
      note: 'Every AI, risk, recovery and performance action is appended to a hash-chained log; verification recomputes each hash.',
    });
  });

  app.get('/api/core/audit/verify', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    res.json(verifyAudit());
  });

  app.get('/api/core/events', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    res.set('Cache-Control', 'no-store');
    res.json({ events: recentEvents(limit) });
  });

  app.get('/api/core/stream', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(`event: core\ndata: ${JSON.stringify({
      id: 'core-ready',
      topic: 'stream.ready',
      at: new Date().toISOString(),
      payload: { status: healthStatus().status, role: roleOf(user), recent: recentEvents(10) },
    })}\n\n`);
    const clientId = addSseClient(res);
    const heartbeat = setInterval(() => {
      try { res.write(': keep-alive\n\n'); } catch { /* closed below */ }
    }, 20_000);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat);
      removeSseClient(clientId);
    });
  });

  app.post('/api/core/client-error', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const message = String(req.body?.message || '').slice(0, 500);
    if (!message) return fail(res, 400, 'Provide the client error message.', 'message_required');
    const entry = recordCoreError({
      scope: `client:${String(req.body?.scope || 'ui').slice(0, 40)}`,
      message,
      stack: req.body?.stack || null,
      userId: user.id,
    });
    res.status(202).json({ recorded: true, id: entry.id });
  });

  app.get('/api/health/core', (req, res) => {
    const snapshot = healthStatus();
    res.set('Cache-Control', 'no-store');
    res.status(snapshot.status === 'down' ? 503 : 200).json({
      status: snapshot.status,
      checkedAt: snapshot.checkedAt,
      uptimeSeconds: snapshot.components?.system?.uptimeSeconds ?? Math.round(process.uptime()),
      components: {
        database: snapshot.components?.database?.status || 'unknown',
        api: snapshot.components?.api?.status || 'unknown',
        marketFeed: snapshot.components?.marketFeed?.status || 'unknown',
        realtime: snapshot.components?.realtime?.status || 'unknown',
      },
      liveTrading: false,
      monitor: { alwaysOn: true, intervalSeconds: healthMetadata().intervalMs / 1000 },
    });
  });
};
