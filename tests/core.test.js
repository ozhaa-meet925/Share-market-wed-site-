import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Every core service resolves CORE_DIR from this variable at import time, so the
// suite writes to a throwaway directory instead of the real audit/store files.
process.env.CORE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sharemarket-core-test-'));

const store = await import('../serverCoreStore.js');
const audit = await import('../serverCoreAudit.js');
const risk = await import('../serverRiskShield.js');
const recovery = await import('../serverRecovery.js');
const performance = await import('../serverPerformance.js');
const health = await import('../serverHealth.js');
const { publish } = await import('../serverCoreBus.js');

const account = (overrides = {}) => ({
  userId: 'USR-TEST',
  status: 'running',
  emergencyStopped: false,
  cash: 1_000_000,
  positions: [],
  daily: { startEquity: 1_000_000, tradesCount: 0, halted: false },
  risk: {
    stopLossPercent: 2,
    targetPercent: 4,
    maxInvestmentPerTrade: 100_000,
    maxDailyLoss: 25_000,
    maxPortfolioExposurePercent: 50,
    maxOpenPositions: 5,
    maxDailyTrades: 10,
    minSignalScore: 60,
  },
  ...overrides,
});

const order = (overrides = {}) => ({
  account: account(),
  quote: { symbol: 'RELIANCE', c: 1000 },
  signal: { symbol: 'RELIANCE', price: 1000, action: 'Buy', score: 80 },
  source: 'auto',
  marketOpen: true,
  quoteAgeSeconds: 10,
  ...overrides,
});

test('store writes atomically and falls back to the .bak copy when the primary is corrupt', () => {
  store.writeStore('doc.json', { v: 1 });
  store.writeStore('doc.json', { v: 2 });
  assert.deepEqual(store.readStore('doc.json', null), { v: 2 });

  fs.writeFileSync(path.join(store.CORE_DIR, 'doc.json'), '{not json', 'utf8');
  assert.deepEqual(store.readStore('doc.json', null), { v: 1 });

  const probe = store.probeWrite();
  assert.equal(probe.ok, true);
});

test('risk shield approves a valid sized entry and derives quantity from risk', () => {
  const decision = risk.authorizeEntry({
    userId: 'USR-SIZE',
    ...order(),
    actor: { id: 'USR-SIZE', role: 'trader', name: 'Test' },
  });

  assert.equal(decision.allowed, true, decision.reason);
  // riskPerTrade 0.75% of 1,000,000 = 7,500; 2% stop = 20/share risk → 375 shares
  // but the per-trade cap of ₹100,000 buys only 100 shares.
  assert.equal(decision.qty, 100);
  assert.equal(decision.value, 100_000);
  assert.equal(decision.stopLoss, 980);
  assert.equal(decision.target, 1040);
  assert.equal(decision.checks.find((check) => check.id === 'sizing').status, 'pass');
  assert.equal(decision.checks.find((check) => check.id === 'target').status, 'pass');
  assert.match(decision.idempotencyKey, /^[a-f0-9]{32}$/);
});

test('risk shield blocks outside the NSE session, with stale quotes, duplicates and insufficient funds', () => {
  const closed = risk.authorizeEntry({ userId: 'USR-CLOSED', ...order({ marketOpen: false }) });
  assert.equal(closed.allowed, false);
  assert.equal(closed.checks.find((check) => check.id === 'market-session').status, 'fail');

  const stale = risk.authorizeEntry({ userId: 'USR-STALE', ...order({ quoteAgeSeconds: 4_000 }) });
  assert.equal(stale.allowed, false);
  assert.equal(stale.checks.find((check) => check.id === 'quote').status, 'fail');

  const duplicate = risk.authorizeEntry({
    userId: 'USR-DUP',
    ...order({ account: account({ positions: [{ symbol: 'RELIANCE', qty: 5, lastPrice: 1000 }] }) }),
  });
  assert.equal(duplicate.allowed, false);
  assert.equal(duplicate.checks.find((check) => check.id === 'duplicate').status, 'fail');

  const poor = risk.authorizeEntry({ userId: 'USR-POOR', ...order({ account: account({ cash: 500 }) }) });
  assert.equal(poor.allowed, false);
  assert.equal(poor.qty, 0);
  assert.equal(poor.checks.find((check) => check.id === 'sizing').status, 'fail');
});

test('kill switch requires a reason, halts entries, and releases cleanly', () => {
  const rejected = risk.setKillSwitch({ userId: 'USR-KILL', active: true, reason: 'no' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'reason_required');

  assert.equal(risk.setKillSwitch({ userId: 'USR-KILL', active: true, reason: 'QA emergency stop' }).ok, true);
  assert.equal(risk.isKillSwitchActive('USR-KILL'), true);

  const blocked = risk.authorizeEntry({ userId: 'USR-KILL', ...order() });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.checks.find((check) => check.id === 'kill-switch').status, 'fail');

  assert.equal(risk.setKillSwitch({ userId: 'USR-KILL', active: false, reason: 'QA release' }).ok, true);
  assert.equal(risk.isKillSwitchActive('USR-KILL'), false);
  assert.equal(risk.authorizeEntry({ userId: 'USR-KILL', ...order() }).allowed, true);
});

test('recovery registers one intent per idempotency key and reconciles without resubmitting', () => {
  const event = {
    userId: 'USR-REC',
    decisionId: 'RSK-TEST',
    symbol: 'INFY',
    qty: 5,
    price: 100,
    allowed: true,
    source: 'auto',
    idempotencyKey: 'idem-key-1',
  };
  publish('risk.decision', event);
  publish('risk.decision', { ...event, decisionId: 'RSK-TEST-2' });

  let status = recovery.recoveryStatus('USR-REC');
  assert.equal(status.intents.length, 1, 'duplicate intents must collapse on the idempotency key');
  assert.equal(status.intents[0].status, 'in_flight');

  const before = recovery.recoveryStats();
  const pending = recovery.reconcile({ getAccount: () => null });
  assert.ok(pending.checked >= 1);
  assert.ok(pending.pending >= 1);
  assert.equal(pending.unresolved, 0);
  assert.equal(recovery.recoveryStats().pending, before.pending, 'reconcile must not create or resubmit intents');

  publish('order.executed', { idempotencyKey: 'idem-key-1', orderId: 'ORD-1' });
  status = recovery.recoveryStatus('USR-REC');
  assert.equal(status.counts.confirmed, 1);

  const second = { ...event, idempotencyKey: 'idem-key-2', symbol: 'TCS' };
  publish('risk.decision', second);
  const matched = recovery.reconcile({ getAccount: () => ({ orders: [{ id: 'ORD-2', idempotencyKey: 'idem-key-2' }] }) });
  assert.equal(matched.confirmed, 1);
  const afterMatch = recovery.recoveryStatus('USR-REC');
  assert.equal(afterMatch.counts.confirmed, 2);
  assert.equal(afterMatch.counts.unresolved, 0);
});

test('performance score refuses a no-trade sample and is not driven by win rate alone', () => {
  const empty = performance.scoreMetrics({ tradeCount: 0 });
  assert.equal(empty.score, null);

  const strongRisk = performance.scoreMetrics({
    tradeCount: 40, riskAdjusted: { sharpe: 1.6 }, profitFactor: 2, maxDrawdownPercent: 5,
    netReturnPercent: 20, winRatePercent: 45,
  });
  const highWinRate = performance.scoreMetrics({
    tradeCount: 40, riskAdjusted: { sharpe: -0.5 }, profitFactor: 0.8, maxDrawdownPercent: 28,
    netReturnPercent: 2, winRatePercent: 90,
  });
  assert.ok(strongRisk.score > highWinRate.score, 'risk-adjusted returns must outrank a high win rate');

  const smallSample = performance.scoreMetrics({
    tradeCount: 5, riskAdjusted: { sharpe: 1.6 }, profitFactor: 2, maxDrawdownPercent: 5,
    netReturnPercent: 20, winRatePercent: 45,
  });
  assert.ok(smallSample.sampleFactor < 1, 'a 5-trade sample must be scaled down');
});

test('health separates real API failures from long-running research calls', () => {
  for (let index = 0; index < 6; index += 1) health.recordApiSample('GET', '/api/core/overview', 200, 12);
  assert.equal(health.healthSnapshot().components.api.status, 'healthy');

  health.recordApiSample('GET', '/api/core/overview', 500, 40);
  assert.equal(health.healthSnapshot().components.api.status, 'degraded');

  for (let index = 0; index < 4; index += 1) health.recordApiSample('GET', '/api/core/overview', 500, 40);
  assert.equal(health.healthSnapshot().components.api.status, 'down');

  for (let index = 0; index < 20; index += 1) health.recordApiSample('GET', '/api/core/overview', 200, 10);
  const before = health.healthSnapshot().components.api;
  for (let index = 0; index < 10; index += 1) health.recordApiSample('POST', '/api/core/performance/walk-forward', 200, 30_000);
  const after = health.healthSnapshot().components.api;
  assert.ok(after.excludedLongRunning >= before.excludedLongRunning + 10);
  assert.ok(after.p95LatencyMs < 2000, 'a 30s backtest must not raise the control-plane p95');

  const snapshot = health.healthSnapshot();
  assert.equal(snapshot.components.database.status, 'healthy', 'missing stores initialise on first write');
  assert.equal(snapshot.monitor.alwaysOn, true);
});

test('provider-bound latency is reported separately from control-plane latency', async () => {
  const fresh = await import('../serverHealth.js?provider-latency');
  for (let index = 0; index < 10; index += 1) fresh.recordApiSample('GET', '/api/health', 200, 20);
  for (let index = 0; index < 10; index += 1) fresh.recordApiSample('GET', '/api/stock/batch', 200, 4000);
  let api = fresh.healthSnapshot({ persistCheck: false }).components.api;
  assert.equal(api.status, 'healthy', 'a 4s provider fetch is still within the data-plane SLO');
  assert.ok(api.p95LatencyMs < 2000, 'provider latency must not pollute the control-plane p95');
  assert.ok(api.providerP95LatencyMs >= 4000);

  for (let index = 0; index < 10; index += 1) fresh.recordApiSample('GET', '/api/stock/batch', 200, 9000);
  api = fresh.healthSnapshot({ persistCheck: false }).components.api;
  assert.equal(api.status, 'degraded', 'a 9s provider p95 breaches the data-plane SLO');
});

test('audit chain verifies and detects tampering', () => {
  audit.recordAudit({ actor: { id: 'USR-TEST', role: 'system', name: 'QA' }, action: 'qa.test', resource: 'qa:chain' });
  audit.recordAudit({ actor: { id: 'USR-TEST', role: 'system', name: 'QA' }, action: 'qa.test', resource: 'qa:chain' });

  const clean = audit.verifyAudit();
  assert.equal(clean.ok, true);
  assert.equal(clean.brokenAt, undefined);
  assert.ok(clean.entries >= 2);

  const file = audit.auditFilePath();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const first = JSON.parse(lines[0]);
  first.detail = { ...first.detail, tampered: true };
  lines[0] = JSON.stringify(first);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');

  const broken = audit.verifyAudit();
  assert.equal(broken.ok, false);
  assert.equal(broken.brokenAt, first.seq ?? 1);
});

test('audit appends stay serialised across processes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharemarket-audit-lock-'));
  const moduleUrl = pathToFileURL(path.join(import.meta.dirname, '..', 'serverCoreAudit.js')).href;
  const writer = `import(${JSON.stringify(moduleUrl)}).then((m) => { for (let i = 0; i < 15; i += 1) m.recordAudit({ action: 'qa.lock', resource: 'qa:lock', detail: { i } }); });`;
  const runWriter = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', writer], {
      env: { ...process.env, CORE_DATA_DIR: dir },
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`audit writer exited with ${code}`))));
  });

  try {
    await Promise.all([runWriter(), runWriter(), runWriter()]);
    const entries = fs.readFileSync(path.join(dir, 'core-audit.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(entries.length, 45, 'every concurrent write must land in the log');
    assert.deepEqual(entries.map((entry) => entry.seq), Array.from({ length: 45 }, (_, index) => index + 1), 'sequence numbers must not fork');
    assert.equal(fs.existsSync(path.join(dir, 'core-audit.lock')), false, 'the lock must be released');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
