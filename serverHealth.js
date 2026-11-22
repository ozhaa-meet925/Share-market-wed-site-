import crypto from 'node:crypto';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getPaperBrokerStatus, getPaperFeedSnapshot } from './serverAutoTrade.js';
import { auditStatus } from './serverCoreAudit.js';
import { publish, realtimeStatus } from './serverCoreBus.js';
import { probeWrite, readStore, storeHealth, writeStore } from './serverCoreStore.js';
import { databaseHealth as sqlHealth } from './serverDb.js';

const STORE_NAME = 'health.json';
const CHECK_INTERVAL_MS = 30_000;
const WINDOW_MS = 5 * 60_000;
const MAX_INCIDENTS = 200;
const MAX_ERRORS = 100;
const CORE_STORES = ['risk-shield.json', 'recovery.json', 'performance.json', 'health.json'];

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

const state = {
  startedAt: new Date().toISOString(),
  checks: 0,
  lastCheckAt: null,
  lastSnapshot: null,
  requests: 0,
  errors: 0,
  latencySamples: [],
  apiWindow: [],
  recentErrors: [],
  incidents: [],
  activeKeys: new Set(),
};

const persisted = readStore(STORE_NAME, { version: 1, incidents: [], lastCheckAt: null });
if (Array.isArray(persisted.incidents)) state.incidents = persisted.incidents.slice(-MAX_INCIDENTS);
const pendingFromDisk = state.incidents.filter((incident) => !incident.resolvedAt);
pendingFromDisk.forEach((incident) => state.activeKeys.add(incident.key));

let timer = null;
let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();

const round2 = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const iso = () => new Date().toISOString();
const persist = () => writeStore(STORE_NAME, { version: 1, incidents: state.incidents.slice(-MAX_INCIDENTS), lastCheckAt: state.lastCheckAt });

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return round2(sorted[index]);
};

export const recordApiSample = (method, path, statusCode, durationMs) => {
  const at = Date.now();
  state.requests += 1;
  if (statusCode >= 500) state.errors += 1;
  state.latencySamples.push(round2(durationMs));
  if (state.latencySamples.length > 500) state.latencySamples.shift();
  state.apiWindow.push({ at, statusCode, durationMs: round2(durationMs), path: String(path).slice(0, 80), method });
  while (state.apiWindow.length && at - state.apiWindow[0].at > WINDOW_MS) state.apiWindow.shift();
};

export const recordCoreError = ({ scope = 'server', message = 'Unknown error', stack = null, userId = null } = {}) => {
  const entry = {
    id: `ERR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    at: iso(),
    scope: String(scope).slice(0, 60),
    message: String(message).slice(0, 500),
    stack: stack ? String(stack).split('\n').slice(0, 4).join(' | ').slice(0, 800) : null,
    userId: userId ? String(userId) : null,
  };
  state.recentErrors.unshift(entry);
  state.recentErrors = state.recentErrors.slice(0, MAX_ERRORS);
  publish('health.error', entry);
  return entry;
};

export const coreHealthMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    recordApiSample(req.method, req.originalUrl || req.path || '/', res.statusCode, Number(process.hrtime.bigint() - startedAt) / 1e6);
  });
  next();
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
  const weekdayOpen = weekday !== 'Sat' && weekday !== 'Sun';
  const open = weekdayOpen && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
  return {
    timeZone: 'Asia/Kolkata',
    weekday,
    istTime: `${value('hour')}:${value('minute')}`,
    marketOpen: open,
    note: 'Exchange holidays are not applied here; the trading engine and exchange calendar remain authoritative. Monitoring runs 24/7 regardless.',
  };
};

// These endpoints legitimately run multi-second market research (Yahoo history,
// parameter grids). Counting them in the control-plane latency percentile would
// raise a false API incident every time a user runs an evaluation or backtest.
const LONG_RUNNING_ROUTES = [
  /^\/api\/core\/brain\/evaluate/,
  /^\/api\/core\/brain\/watchlist/,
  /^\/api\/core\/performance\/walk-forward/,
  // Server-sent event streams stay open by design; their lifetime is not request latency.
  /^\/api\/core\/stream/,
  /^\/api\/stock\/stream/,
];
const isLongRunning = (path) => LONG_RUNNING_ROUTES.some((pattern) => pattern.test(String(path)));

// These endpoints wait on an external market-data or research provider. Their latency
// tracks the provider, not this server, so they get a wider SLO and are reported separately.
const PROVIDER_BOUND_ROUTES = [
  /^\/api\/stock\//,
  /^\/api\/stocks\//,
  /^\/api\/ai\//,
  /^\/api\/autotrade\/signals/,
  /^\/api\/mutual-funds\//,
  /^\/api\/commodit/,
  /^\/api\/calendar/,
  /^\/api\/news/,
];
const isProviderBound = (path) => PROVIDER_BOUND_ROUTES.some((pattern) => pattern.test(String(path)));
const PROVIDER_P95_LIMIT_MS = 8000;

const summarizeSlowRoutes = (entries) => {
  const groups = new Map();
  for (const entry of entries) {
    const key = String(entry.path || 'unknown').split('?')[0];
    const group = groups.get(key) || { path: key, count: 0, durations: [] };
    group.count += 1;
    group.durations.push(entry.durationMs);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      path: group.path,
      requests: group.count,
      p95LatencyMs: percentile(group.durations, 0.95),
    }))
    .sort((a, b) => b.p95LatencyMs - a.p95LatencyMs)
    .slice(0, 3);
};

const apiHealth = () => {
  const window = state.apiWindow;
  const total = window.length;
  const failures = window.filter((entry) => entry.statusCode >= 500).length;
  const count4xx = window.filter((entry) => entry.statusCode >= 400 && entry.statusCode < 500).length;
  const errorRate = total ? (failures / total) * 100 : 0;
  const latencyWindow = window.filter((entry) => !isLongRunning(entry.path));
  const controlWindow = latencyWindow.filter((entry) => !isProviderBound(entry.path));
  const providerWindow = latencyWindow.filter((entry) => isProviderBound(entry.path));
  const latencies = controlWindow.map((entry) => entry.durationMs);
  const providerLatencies = providerWindow.map((entry) => entry.durationMs);
  const controlP95 = percentile(latencies, 0.95);
  const providerP95 = percentile(providerLatencies, 0.95);
  const status = total < 5
    ? 'healthy'
    : errorRate >= 20
      ? 'down'
      : errorRate >= 5 || controlP95 > 2000 || providerP95 > PROVIDER_P95_LIMIT_MS
        ? 'degraded'
        : 'healthy';
  return {
    status,
    windowMinutes: WINDOW_MS / 60000,
    requests: total,
    failures,
    clientErrors: count4xx,
    errorRatePercent: round2(errorRate),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: controlP95,
    providerRequests: providerWindow.length,
    providerP95LatencyMs: providerP95,
    providerP95LimitMs: PROVIDER_P95_LIMIT_MS,
    excludedLongRunning: window.length - latencyWindow.length,
    slowestRoutes: summarizeSlowRoutes(latencyWindow),
    lastRequestAt: state.apiWindow.length ? new Date(window[window.length - 1].at).toISOString() : null,
    totals: { requests: state.requests, serverErrors: state.errors },
  };
};

const databaseHealth = () => {
  const writes = probeWrite();
  const audit = auditStatus();
  const stores = storeHealth(CORE_STORES);
  const sql = sqlHealth();
  const corrupt = stores.filter((store) => {
    const primaryBroken = !store.primary.ok && store.primary.error !== 'missing';
    const backupBroken = !store.backup.ok && store.backup.error !== 'missing';
    return primaryBroken || backupBroken;
  });
  const initialized = stores.filter((store) => store.primary.ok).length;
  const status = !writes.ok || !audit.ok || !sql.ok
    ? 'down'
    : corrupt.length
      ? 'degraded'
      : 'healthy';
  return {
    status,
    engine: 'SQLite (node:sqlite, WAL) for transactional records; JSON stores for AI Core state',
    detail: corrupt.length
      ? `Corrupt store file(s): ${corrupt.map((store) => store.name).join(', ')}.`
      : `${initialized}/${stores.length} core store(s) written; missing files initialise on first write.`,
    writeProbe: writes,
    sql,
    auditChain: { ok: audit.ok, entries: audit.entries, seq: audit.seq, brokenAt: audit.brokenAt || null, reason: audit.reason || null },
    stores: stores.map((store) => ({
      name: store.name,
      primary: store.primary,
      backup: store.backup,
    })),
  };
};

const feedHealth = () => {
  const feed = getPaperFeedSnapshot();
  const broker = getPaperBrokerStatus();
  if (!feed.accountsScanned) {
    return {
      status: 'idle',
      detail: 'No auto-trade account has run a scan yet. Feed monitoring is armed and will report once a scan occurs.',
      feed,
      broker: broker ? { configured: broker.configured !== false, detail: broker.message || null } : null,
    };
  }
  const staleLimit = feed.marketOpen ? 120 : 900;
  const status = feed.lastError
    ? 'degraded'
    : feed.ageSeconds === null
      ? 'idle'
      : feed.ageSeconds > staleLimit
        ? 'degraded'
        : 'healthy';
  return {
    status,
    detail: feed.lastError
      ? `Last feed error: ${feed.lastError}`
      : `Latest delayed research feed sweep ${feed.ageSeconds}s ago across ${feed.accountsScanned} account(s), ${feed.quoteCount} quote(s).`,
    stalenessLimitSeconds: staleLimit,
    feed,
    broker: broker ? { configured: broker.configured !== false, detail: broker.message || null } : null,
  };
};

const realtimeHealth = () => {
  const status = realtimeStatus();
  const enabled = status.websocket.enabled || status.sse.enabled;
  return {
    status: enabled ? 'healthy' : 'degraded',
    detail: enabled
      ? `${status.websocket.clients} WebSocket client(s), ${status.sse.clients} SSE client(s).`
      : 'No realtime transport attached to this server instance.',
    ...status,
  };
};

const systemHealth = () => {
  const memory = process.memoryUsage();
  const cpuNow = process.cpuUsage(lastCpu);
  const elapsedMs = Math.max(1, Date.now() - lastCpuAt);
  lastCpu = process.cpuUsage();
  lastCpuAt = Date.now();
  const cores = os.cpus().length || 1;
  const cpuPercent = ((cpuNow.user + cpuNow.system) / 1000 / elapsedMs / cores) * 100;
  const totalMemory = os.totalmem();
  const memoryPercent = (memory.rss / totalMemory) * 100;
  const loopP95 = round2(loopDelay.percentile(95) / 1e6);
  const loopMax = round2(loopDelay.max / 1e6);
  loopDelay.reset();
  const status = memoryPercent > 92 || loopP95 > 250
    ? 'degraded'
    : 'healthy';
  return {
    status,
    uptimeSeconds: Math.round(process.uptime()),
    processUptimeSeconds: Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000),
    cpuPercent: round2(cpuPercent),
    cores,
    loadAverage: os.loadavg().map(round2),
    memory: {
      rssMb: round2(memory.rss / 1024 / 1024),
      heapUsedMb: round2(memory.heapUsed / 1024 / 1024),
      heapTotalMb: round2(memory.heapTotal / 1024 / 1024),
      systemUsedPercent: round2(memoryPercent),
      systemTotalMb: round2(totalMemory / 1024 / 1024),
    },
    eventLoop: { p95Ms: loopP95, maxMs: loopMax, resolutionMs: 20 },
    platform: `${process.platform} ${process.arch} · Node ${process.version}`,
    node: process.version,
  };
};

const openIncident = (key, severity, title, detail) => {
  if (state.activeKeys.has(key)) return;
  state.activeKeys.add(key);
  const incident = {
    id: `INC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
    key,
    severity,
    title,
    detail,
    status: 'open',
    openedAt: iso(),
    resolvedAt: null,
    durationSeconds: null,
  };
  state.incidents.unshift(incident);
  state.incidents = state.incidents.slice(0, MAX_INCIDENTS);
  persist();
  publish('health.alert', { id: incident.id, severity, title, detail, state: 'open', at: incident.openedAt });
  recordCoreError({ scope: `incident:${key}`, message: `${title} — ${detail}` });
};

const resolveIncident = (key) => {
  if (!state.activeKeys.has(key)) return;
  state.activeKeys.delete(key);
  const incident = state.incidents.find((item) => item.key === key && !item.resolvedAt);
  if (!incident) return;
  incident.status = 'resolved';
  incident.resolvedAt = iso();
  incident.durationSeconds = Math.round((new Date(incident.resolvedAt).getTime() - new Date(incident.openedAt).getTime()) / 1000);
  persist();
  publish('health.alert', { id: incident.id, severity: incident.severity, title: incident.title, detail: incident.detail, state: 'resolved', at: incident.resolvedAt });
};

const evaluateIncidents = (components) => {
  const checks = [
    ['database', 'critical', 'Core store or audit chain failure'],
    ['api', 'warning', 'API error rate or latency above threshold'],
    ['marketFeed', 'warning', 'Market data feed degraded'],
    ['system', 'warning', 'System resource pressure'],
    ['realtime', 'info', 'Realtime transport unavailable'],
  ];
  for (const [key, severity, title] of checks) {
    const component = components[key];
    const failing = component && ['degraded', 'down'].includes(component.status);
    if (failing) openIncident(key, component.status === 'down' ? 'critical' : severity, title, component.detail || `${key} is ${component.status}.`);
    else resolveIncident(key);
  }
};

export const healthSnapshot = ({ persistCheck = true } = {}) => {
  const components = {
    api: apiHealth(),
    database: databaseHealth(),
    marketFeed: feedHealth(),
    realtime: realtimeHealth(),
    system: systemHealth(),
  };
  const session = istSession();
  const criticalDown = components.database.status === 'down' || components.api.status === 'down';
  const degraded = Object.entries(components).some(([key, component]) => key !== 'marketFeed' && component.status === 'degraded');
  const overall = criticalDown ? 'down' : degraded || components.marketFeed.status === 'degraded' ? 'degraded' : 'healthy';

  evaluateIncidents(components);

  const snapshot = {
    status: overall,
    checkedAt: iso(),
    checks: state.checks + 1,
    monitor: {
      intervalSeconds: CHECK_INTERVAL_MS / 1000,
      alwaysOn: true,
      startedAt: state.startedAt,
      marketSession: session,
      note: 'Health checks continue outside Indian market hours by design.',
    },
    components,
    activeIncidents: state.incidents.filter((incident) => !incident.resolvedAt).length,
    recentErrors: state.recentErrors.slice(0, 20),
  };

  state.checks += 1;
  state.lastCheckAt = snapshot.checkedAt;
  state.lastSnapshot = snapshot;
  if (persistCheck) {
    state.lastSnapshot = snapshot;
    writeStore(STORE_NAME, {
      version: 1,
      incidents: state.incidents.slice(-MAX_INCIDENTS),
      lastCheckAt: state.lastCheckAt,
      lastStatus: overall,
    });
  }
  publish('health.snapshot', { status: overall, checkedAt: snapshot.checkedAt, activeIncidents: snapshot.activeIncidents });
  return snapshot;
};

export const startHealthMonitor = ({ intervalMs = CHECK_INTERVAL_MS } = {}) => {
  if (timer) return { started: false, intervalMs: CHECK_INTERVAL_MS };
  healthSnapshot();
  timer = setInterval(() => {
    try {
      healthSnapshot();
    } catch (error) {
      recordCoreError({ scope: 'health-monitor', message: error.message, stack: error.stack });
    }
  }, intervalMs);
  timer.unref?.();
  return { started: true, intervalMs };
};

export const stopHealthMonitor = () => {
  if (timer) clearInterval(timer);
  timer = null;
  loopDelay.disable();
};

export const healthStatus = () => state.lastSnapshot || healthSnapshot();

export const listIncidents = (limit = 50) => state.incidents.slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));

export const acknowledgeIncident = (id, actor = {}) => {
  const incident = state.incidents.find((item) => item.id === id);
  if (!incident) return { ok: false, error: 'incident_not_found' };
  incident.acknowledgedAt = iso();
  incident.acknowledgedBy = String(actor.id || actor.name || 'unknown').slice(0, 80);
  persist();
  return { ok: true, incident };
};

export const healthMetadata = () => ({
  intervalMs: CHECK_INTERVAL_MS,
  alwaysOn: true,
  windowMs: WINDOW_MS,
  startedAt: state.startedAt,
  checks: state.checks,
  lastCheckAt: state.lastCheckAt,
  openIncidents: state.incidents.filter((incident) => !incident.resolvedAt).length,
  recentErrorCount: state.recentErrors.length,
  stores: CORE_STORES,
});
