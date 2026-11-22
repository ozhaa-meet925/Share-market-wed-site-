import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { recordAudit } from '../serverCoreAudit.js';

const ROOT = path.resolve(process.cwd());
const AUTOTRADE_PATH = path.join(ROOT, 'data', 'autotrade.json');
const RISK_SHIELD_PATH = path.join(ROOT, 'data', 'core', 'risk-shield.json');

const USER_ID = process.argv[2] || 'USR-47d6e15ee41eba3d';
const BATCH_START = process.argv[3] || '2026-11-05T06:36:40Z';
const BATCH_END = process.argv[4] || '2026-11-05T06:36:50Z';

const round2 = (value) => Number(Number(value).toFixed(2));
const nowIso = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

const shield = JSON.parse(fs.readFileSync(RISK_SHIELD_PATH, 'utf8'));
const decisions = (shield.decisions || [])
  .filter((decision) => (
    decision.userId === USER_ID
    && decision.allowed === true
    && decision.source === 'auto'
    && decision.at >= BATCH_START
    && decision.at <= BATCH_END
    && Number(decision.qty) > 0
    && Number(decision.price) > 0
  ))
  .sort((a, b) => a.at.localeCompare(b.at));

if (!decisions.length) {
  console.error(`No approved decisions found for ${USER_ID} between ${BATCH_START} and ${BATCH_END}.`);
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(AUTOTRADE_PATH, 'utf8'));
const account = store.accounts[USER_ID];
if (!account) {
  console.error(`Account ${USER_ID} not found in autotrade.json.`);
  process.exit(1);
}

const risk = account.risk || {};
const stopPercent = Number(risk.stopLossPercent || 1.5);
const targetPercent = Number(risk.targetPercent || 3);

for (const decision of decisions) {
  const symbol = String(decision.symbol || '').toUpperCase();
  const qty = Number(decision.qty);
  const entry = round2(Number(decision.price));
  const value = round2(qty * entry);
  if (account.positions.some((position) => position.idempotencyKey === decision.idempotencyKey)) continue;

  const position = {
    id: uid('POS'),
    symbol,
    qty,
    entryPrice: entry,
    entryAt: decision.at,
    lastPrice: entry,
    lastQuoteAt: decision.at,
    highWater: entry,
    stopLoss: round2(Number(decision.stopLoss) || entry * (1 - stopPercent / 100)),
    stopLossKind: 'initial',
    target: round2(Number(decision.target) || entry * (1 + targetPercent / 100)),
    status: 'open',
    openedBy: 'ai',
    execution: 'paper',
    broker: null,
    brokerOrderId: null,
    brokerOrderRef: null,
    orderStatus: 'Executed',
    product: null,
    entryCharges: 0,
    idempotencyKey: decision.idempotencyKey,
    quoteBasis: 'delayed',
    signalScore: null,
    signalReasons: [],
    recovered: true,
  };
  const order = {
    id: uid('ORD'),
    at: decision.at,
    symbol,
    side: 'Buy',
    qty,
    price: entry,
    status: 'Executed',
    quoteBasis: 'delayed',
    execution: 'paper',
    brokerOrderId: null,
    brokerOrderIdRef: null,
    positionId: position.id,
    idempotencyKey: decision.idempotencyKey,
    reason: 'recovered confirmed fill',
  };
  position.orderId = order.id;

  account.cash = round2(account.cash - value);
  account.daily.tradesCount += 1;
  account.positions.unshift(position);
  account.orders.unshift(order);
  account.events.unshift({
    id: uid('EVT'),
    type: 'trade_opened',
    severity: 'success',
    title: `Recovered BUY executed: ${symbol}`,
    at: nowIso(),
    symbol,
    message: `${qty} @ ₹${entry.toLocaleString('en-IN')} · value ₹${value.toLocaleString('en-IN')} · SL ₹${position.stopLoss.toLocaleString('en-IN')} · target ₹${position.target.toLocaleString('en-IN')}. Restored from the Risk Shield decision recorded at ${decision.at} after the account file was overwritten by a duplicate server process; no broker order was involved.`,
  });
  account.audit.push({
    action: 'position_opened',
    at: nowIso(),
    detail: `${symbol} buy ${qty} @ ₹${entry}; SL ₹${position.stopLoss}; target ₹${position.target}; delayed quote; recovered from Risk Shield decision ${decision.id}.`,
  });
}

const totalValue = round2(decisions.reduce((sum, decision) => sum + Number(decision.qty) * Number(decision.price), 0));
account.events.unshift({
  id: uid('EVT'),
  type: 'recovery_restore',
  severity: 'warning',
  title: 'Ledger restored from approved decisions',
  at: nowIso(),
  message: `${decisions.length} paper trade(s) worth ₹${totalValue.toLocaleString('en-IN')} restored after storage contention with a duplicate server process.`,
});
account.audit.push({
  action: 'ledger_restored',
  at: nowIso(),
  detail: `${decisions.length} approved decisions restored; total value ₹${totalValue}.`,
});

const tmpPath = `${AUTOTRADE_PATH}.restore.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
fs.renameSync(tmpPath, AUTOTRADE_PATH);

const symbols = decisions.map((decision) => decision.symbol).join(', ');
const audit = recordAudit({
  actor: { id: 'recovery-engine', role: 'system', name: 'Smart Recovery Engine' },
  action: 'recovery.ledger_restored',
  resource: `autotrade:${USER_ID}`,
  outcome: 'success',
  detail: { symbols, trades: decisions.length, totalValue, restoredAt: nowIso() },
});

console.log(`Restored ${decisions.length} paper trades (${symbols}) worth ₹${totalValue.toLocaleString('en-IN')} for ${USER_ID}.`);
console.log(`Audit record: seq ${audit ? audit.seq : 'failed'}`);
