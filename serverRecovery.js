import crypto from 'node:crypto';
import { readStore, writeStore } from './serverCoreStore.js';
import { publish, subscribe } from './serverCoreBus.js';
import { recordAudit } from './serverCoreAudit.js';

const ALERT_LIMIT = 100;
const INTENT_LIMIT = 200;
const UNRESOLVED_AFTER_MS = 90_000;
const HEALTHY_PROBE_MS = 120_000;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 300_000;

const emptyState = () => ({
  version: 1,
  bootId: crypto.randomUUID(),
  boots: 0,
  intents: [],
  alerts: [],
  provider: {
    status: 'unknown',
    attempts: 0,
    delayMs: BASE_BACKOFF_MS,
    nextProbeAt: null,
    lastProbeAt: null,
    lastOkAt: null,
    lastError: null,
    history: [],
  },
  lastReconcileAt: null,
});

let state = readStore('recovery.json', emptyState());
const ensureShape = () => {
  const defaults = emptyState();
  for (const key of Object.keys(defaults)) {
    if (state[key] === undefined || state[key] === null) state[key] = defaults[key];
  }
  state.intents = Array.isArray(state.intents) ? state.intents.slice(0, INTENT_LIMIT) : [];
  state.alerts = Array.isArray(state.alerts) ? state.alerts.slice(0, ALERT_LIMIT) : [];
  state.provider = { ...defaults.provider, ...(state.provider || {}) };
  state.provider.history = Array.isArray(state.provider.history) ? state.provider.history.slice(0, 20) : [];
  return state;
};
const persist = () => writeStore('recovery.json', ensureShape());

const boot = () => {
  ensureShape();
  state.boots = Number(state.boots || 0) + 1;
  state.bootId = crypto.randomUUID();
  let recovered = 0;
  for (const intent of state.intents) {
    if (intent.status === 'in_flight') {
      intent.status = 'unverified';
      intent.recoveredAt = new Date().toISOString();
      intent.note = 'Server restarted while the intent was in flight. Status must be verified against the paper ledger before any retry.';
      recovered += 1;
    }
  }
  if (recovered) {
    recordAudit({
      actor: { id: 'recovery-engine', role: 'system', name: 'Smart Recovery Engine' },
      action: 'recovery.restart_detected',
      resource: 'recovery:intents',
      detail: { recovered, bootId: state.bootId, boots: state.boots },
    });
    publish('recovery.restart', { recovered, bootId: state.bootId, boots: state.boots });
  }
  persist();
  return { recovered, bootId: state.bootId, boots: state.boots };
};

const bootResult = boot();
let providerTimer = null;
let probing = false;
let monitorConfig = { probe: null };

const addAlert = ({ key, type, severity = 'warning', title, message, userId = null, intentId = null }) => {
  ensureShape();
  const existing = state.alerts.find((alert) => alert.key === key && !alert.resolved);
  if (existing) return existing;
  const alert = {
    id: `RALT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    key,
    at: new Date().toISOString(),
    type,
    severity,
    title,
    message,
    userId,
    intentId,
    resolved: false,
    resolvedAt: null,
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, ALERT_LIMIT);
  persist();
  recordAudit({
    actor: { id: 'recovery-engine', role: 'system', name: 'Smart Recovery Engine' },
    action: 'recovery.alert_raised',
    resource: `recovery:${intentId || 'provider'}`,
    outcome: 'failure',
    detail: { type, title, message: String(message).slice(0, 240), intentId },
  });
  publish('recovery.alert', alert);
  return alert;
};

const resolveAlert = (key) => {
  ensureShape();
  let changed = false;
  for (const alert of state.alerts) {
    if (alert.key === key && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      changed = true;
      publish('recovery.alertResolved', { id: alert.id, key, at: alert.resolvedAt });
    }
  }
  if (changed) persist();
};

const registerIntent = (payload) => {
  ensureShape();
  if (!payload?.idempotencyKey || !payload?.userId) return null;
  const existing = state.intents.find((intent) => intent.idempotencyKey === payload.idempotencyKey);
  if (existing) return existing;
  const intent = {
    id: `INT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    at: new Date().toISOString(),
    userId: payload.userId,
    idempotencyKey: payload.idempotencyKey,
    symbol: payload.symbol || null,
    qty: Number(payload.qty) || 0,
    price: Number(payload.price) || null,
    shieldDecisionId: payload.shieldDecisionId || null,
    status: 'in_flight',
    orderId: null,
    verifiedAt: null,
    unresolvedAt: null,
    note: null,
  };
  state.intents.unshift(intent);
  state.intents = state.intents.slice(0, INTENT_LIMIT);
  persist();
  return intent;
};

const markExecuted = ({ idempotencyKey, orderId }) => {
  ensureShape();
  const intent = state.intents.find((item) => item.idempotencyKey === idempotencyKey);
  if (!intent) return null;
  intent.status = 'confirmed';
  intent.orderId = orderId || intent.orderId;
  intent.verifiedAt = new Date().toISOString();
  intent.note = 'Confirmed in the paper ledger.';
  resolveAlert(`unresolved:${idempotencyKey}`);
  persist();
  publish('recovery.reconciled', { intentId: intent.id, idempotencyKey, status: intent.status, orderId: intent.orderId });
  return intent;
};

const findOrder = (account, intent) => {
  if (!account || !Array.isArray(account.orders)) return null;
  return account.orders.find((order) => (
    (intent.orderId && order.id === intent.orderId)
    || (order.idempotencyKey && order.idempotencyKey === intent.idempotencyKey)
  )) || null;
};

export const reconcile = ({ getAccount }) => {
  ensureShape();
  const summary = { checked: 0, confirmed: 0, unresolved: 0, pending: 0 };
  const now = Date.now();
  for (const intent of state.intents) {
    if (intent.status === 'confirmed') continue;
    summary.checked += 1;
    const account = typeof getAccount === 'function' ? getAccount(intent.userId) : null;
    const order = findOrder(account, intent);
    if (order) {
      intent.status = 'confirmed';
      intent.orderId = order.id || intent.orderId;
      intent.verifiedAt = new Date().toISOString();
      intent.note = 'Matched to a paper order. The order was never resubmitted.';
      resolveAlert(`unresolved:${intent.idempotencyKey}`);
      summary.confirmed += 1;
      continue;
    }
    const ageMs = now - new Date(intent.at).getTime();
    if (ageMs >= UNRESOLVED_AFTER_MS) {
      if (intent.status !== 'unresolved') {
        intent.status = 'unresolved';
        intent.unresolvedAt = new Date().toISOString();
        intent.note = 'No matching paper order was found. It was not resubmitted; verify before acting.';
        addAlert({
          key: `unresolved:${intent.idempotencyKey}`,
          type: 'unresolved_order',
          severity: 'critical',
          title: `Unresolved order: ${intent.symbol || 'unknown'}`,
          message: `Intent ${intent.id} has no matching paper order after ${Math.round(ageMs / 1000)}s. It was NOT resubmitted. Verify the ledger manually.`,
          userId: intent.userId,
          intentId: intent.id,
        });
        summary.unresolved += 1;
      }
    } else {
      summary.pending += 1;
    }
  }
  state.lastReconcileAt = new Date().toISOString();
  persist();
  if (summary.checked) {
    recordAudit({
      actor: { id: 'recovery-engine', role: 'system', name: 'Smart Recovery Engine' },
      action: 'recovery.reconciliation',
      resource: 'recovery:intents',
      detail: summary,
    });
  }
  publish('recovery.reconcile', summary);
  return summary;
};

const scheduleProbe = (delayMs) => {
  if (providerTimer) clearTimeout(providerTimer);
  providerTimer = setTimeout(runProbe, Math.max(250, delayMs));
  providerTimer.unref?.();
};

const runProbe = async () => {
  if (probing || typeof monitorConfig.probe !== 'function') return;
  probing = true;
  ensureShape();
  const provider = state.provider;
  try {
    const result = await monitorConfig.probe();
    if (!result) throw new Error('The research provider returned no usable data.');
    const wasDegraded = provider.status !== 'healthy';
    provider.status = 'healthy';
    provider.attempts = 0;
    provider.delayMs = HEALTHY_PROBE_MS;
    provider.lastProbeAt = new Date().toISOString();
    provider.lastOkAt = provider.lastProbeAt;
    provider.lastError = null;
    provider.nextProbeAt = new Date(Date.now() + HEALTHY_PROBE_MS).toISOString();
    provider.history.unshift({ at: provider.lastProbeAt, ok: true, latencyMs: result.latencyMs ?? null });
    provider.history = provider.history.slice(0, 20);
    resolveAlert('provider:research');
    if (wasDegraded) {
      recordAudit({
        actor: { id: 'recovery-engine', role: 'system', name: 'Smart Recovery Engine' },
        action: 'recovery.provider_recovered',
        resource: 'provider:research',
        detail: { latencyMs: result.latencyMs ?? null },
      });
      publish('recovery.provider', { status: 'healthy', recovered: true });
    }
    persist();
    scheduleProbe(HEALTHY_PROBE_MS);
  } catch (error) {
    provider.attempts = Number(provider.attempts || 0) + 1;
    provider.status = provider.attempts >= 3 ? 'down' : 'degraded';
    provider.delayMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** (provider.attempts - 1)));
    provider.lastProbeAt = new Date().toISOString();
    provider.lastError = error.message || 'Research provider probe failed.';
    provider.nextProbeAt = new Date(Date.now() + provider.delayMs).toISOString();
    provider.history.unshift({ at: provider.lastProbeAt, ok: false, error: provider.lastError });
    provider.history = provider.history.slice(0, 20);
    if (provider.attempts >= 3) {
      addAlert({
        key: 'provider:research',
        type: 'provider_unavailable',
        severity: 'critical',
        title: 'Market data provider unavailable',
        message: `${provider.lastError} Reconnecting with exponential backoff (next attempt in ${Math.round(provider.delayMs / 1000)}s). Open positions were not re-priced from invented data.`,
      });
    }
    recordAudit({
      actor: { id: 'recovery-engine', role: 'system', name: 'Smart Recovery Engine' },
      action: 'recovery.provider_probe_failed',
      resource: 'provider:research',
      outcome: 'failure',
      detail: { attempts: provider.attempts, delayMs: provider.delayMs, error: provider.lastError },
    });
    publish('recovery.provider', {
      status: provider.status,
      attempts: provider.attempts,
      delayMs: provider.delayMs,
      nextProbeAt: provider.nextProbeAt,
      error: provider.lastError,
    });
    persist();
    scheduleProbe(provider.delayMs);
  } finally {
    probing = false;
  }
};

export const startRecoveryMonitor = ({ probe }) => {
  monitorConfig = { probe };
  ensureShape();
  if (state.provider.nextProbeAt) {
    const wait = new Date(state.provider.nextProbeAt).getTime() - Date.now();
    scheduleProbe(Math.max(500, wait));
  } else {
    scheduleProbe(800);
  }
};

export const stopRecoveryMonitor = () => {
  if (providerTimer) clearTimeout(providerTimer);
  providerTimer = null;
};

export const recoveryStatus = (userId, { broker = null, getAccount = null } = {}) => {
  ensureShape();
  if (typeof getAccount === 'function') reconcile({ getAccount });
  const intents = state.intents.filter((intent) => !userId || intent.userId === userId);
  const alerts = state.alerts.filter((alert) => !userId || !alert.userId || alert.userId === userId);
  const provider = state.provider;
  return {
    boot: { bootId: state.bootId, boots: state.boots, restartedThisBoot: bootResult.recovered },
    provider: {
      status: provider.status,
      attempts: provider.attempts,
      delayMs: provider.delayMs,
      nextProbeAt: provider.nextProbeAt,
      lastProbeAt: provider.lastProbeAt,
      lastOkAt: provider.lastOkAt,
      lastError: provider.lastError,
      history: provider.history.slice(0, 10),
      retryPolicy: 'exponential backoff 5s → 10s → 20s … capped at 300s',
    },
    broker: {
      configured: Boolean(broker?.orderRouting?.configured),
      enabled: Boolean(broker?.orderRouting?.enabled),
      provider: broker?.orderRouting?.provider || null,
      reason: broker?.orderRouting?.reason || 'Broker order routing is not configured in this deployment.',
      reconnection: broker?.orderRouting?.configured ? 'monitored' : 'not_applicable',
    },
    intents: intents.slice(0, 20),
    counts: {
      total: intents.length,
      pending: intents.filter((intent) => intent.status === 'in_flight').length,
      unverified: intents.filter((intent) => intent.status === 'unverified').length,
      unresolved: intents.filter((intent) => intent.status === 'unresolved').length,
      confirmed: intents.filter((intent) => intent.status === 'confirmed').length,
    },
    alerts: alerts.slice(0, 20),
    lastReconcileAt: state.lastReconcileAt,
    policy: {
      resubmit: false,
      note: 'A timed-out order is never resubmitted. Its paper-ledger status is verified first; unresolved intents are surfaced to the user.',
    },
  };
};

export const recoveryStats = () => {
  ensureShape();
  return {
    providerStatus: state.provider.status,
    unresolved: state.intents.filter((intent) => intent.status === 'unresolved').length,
    pending: state.intents.filter((intent) => intent.status === 'in_flight' || intent.status === 'unverified').length,
    lastReconcileAt: state.lastReconcileAt,
  };
};

export const acknowledgeRecoveryAlert = ({ alertId, actor }) => {
  ensureShape();
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) return { ok: false, error: 'Alert not found.', code: 'alert_not_found' };
  if (!alert.resolved) {
    alert.resolved = true;
    alert.resolvedAt = new Date().toISOString();
    persist();
    recordAudit({
      actor,
      action: 'recovery.alert_acknowledged',
      resource: `recovery:${alert.id}`,
      detail: { type: alert.type, title: alert.title },
    });
    publish('recovery.alertResolved', { id: alert.id, key: alert.key, at: alert.resolvedAt });
  }
  return { ok: true, alert };
};

subscribe('risk.decision', (event) => {
  const payload = event.payload || {};
  if (payload.allowed && payload.source === 'auto') {
    registerIntent({
      userId: payload.userId,
      idempotencyKey: payload.idempotencyKey,
      symbol: payload.symbol,
      qty: payload.qty,
      price: payload.price,
      shieldDecisionId: payload.decisionId,
    });
  }
});

subscribe('order.executed', (event) => {
  const payload = event.payload || {};
  markExecuted({ idempotencyKey: payload.idempotencyKey, orderId: payload.orderId });
});
