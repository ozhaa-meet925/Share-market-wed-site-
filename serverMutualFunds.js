/**
 * serverMutualFunds.js
 * Mutual Funds API routes — ES module, plug into server.js via:
 *   import { registerMutualFundRoutes } from './serverMutualFunds.js';
 *   registerMutualFundRoutes(app);
 *
 * Design tokens: --brand:#0d6f4e  --gain:#11875d  --loss:#c43b38
 * NAV source: https://api.mfapi.in  (free, no auth)
 */

import axios from 'axios';
import { getDatabase } from './serverDb.js';
import { computeRiskMetrics, computeXirr, estimatePortfolioTax } from './mfRisk.js';

// ─────────────────────────── NAV cache ───────────────────────────────────────
const navCache = new Map(); // key → { data, ts }
const NAV_TTL = 2 * 60 * 1000; // 2 minutes
const TOP_FUNDS_TTL = 15 * 60 * 1000; // 15 minutes
const topFundsCache = new Map();

const MF_BASE = 'https://api.mfapi.in';

/**
 * Fetch latest NAV for a scheme code from mfapi.in, with 2-min cache.
 * Returns { nav, date } or null on failure.
 */
async function fetchLatestNav(schemeCode) {
  const key = `latest:${schemeCode}`;
  const cached = navCache.get(key);
  if (cached && Date.now() - cached.ts < NAV_TTL) return cached.data;

  try {
    const { data } = await axios.get(`${MF_BASE}/mf/${schemeCode}/latest`, { timeout: 8000 });
    const latest = data?.data?.[0];
    if (!latest) return null;
    const result = { nav: parseFloat(latest.nav), date: latest.date, meta: data.meta };
    navCache.set(key, { data: result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}

/**
 * Fetch full NAV history for a scheme code from mfapi.in.
 * Returns { meta, data:[{date, nav}] } or null on failure.
 */
async function fetchNavHistory(schemeCode) {
  const key = `history:${schemeCode}`;
  const cached = navCache.get(key);
  if (cached && Date.now() - cached.ts < NAV_TTL) return cached.data;

  try {
    const { data } = await axios.get(`${MF_BASE}/mf/${schemeCode}`, { timeout: 12000 });
    if (!data?.data) return null;
    navCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// ─────────────────────────── CAGR helpers ────────────────────────────────────

/**
 * Parse "DD-MM-YYYY" → Date
 */
function parseMfDate(str) {
  const [d, m, y] = str.split('-');
  return new Date(`${y}-${m}-${d}`);
}

/**
 * Compute CAGR (%) for given years from a sorted NAV history array.
 * navHistory: [{ date:"DD-MM-YYYY", nav:"123.45" }, ...] newest-first (mfapi.in order)
 */
function computeCAGR(navHistory, years) {
  if (!navHistory || navHistory.length < 2) return null;
  const latestEntry = navHistory[0];
  const latestNav = parseFloat(latestEntry.nav);
  const targetDate = new Date(parseMfDate(latestEntry.date));
  targetDate.setFullYear(targetDate.getFullYear() - years);

  // Find the entry closest to targetDate (search from newest to oldest)
  let best = null;
  let bestDiff = Infinity;
  for (const entry of navHistory) {
    const d = parseMfDate(entry.date);
    const diff = Math.abs(d - targetDate);
    if (diff < bestDiff) { bestDiff = diff; best = entry; }
    if (d < targetDate) break; // passed it
  }
  if (!best) return null;
  const baseNav = parseFloat(best.nav);
  if (!baseNav) return null;
  return (Math.pow(latestNav / baseNav, 1 / years) - 1) * 100;
}

/**
 * XIRR approximation: simple CAGR formula.
 * Returns annualised % or null.
 */
function computeXIRR(currentValue, investedAmount, purchaseDateStr) {
  if (!purchaseDateStr || !investedAmount || investedAmount === 0) return null;
  const purchased = new Date(purchaseDateStr);
  const days = (Date.now() - purchased.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 0) return null;
  const years = days / 365;
  if (years < 0.01) return null;
  return (Math.pow(currentValue / investedAmount, 1 / years) - 1) * 100;
}

// ─────────────────────────── DB helpers ──────────────────────────────────────

async function getDb() {
  return getDatabase();
}

function dbRun(db, sql, params = []) {
  try { return Promise.resolve(db.run(sql, ...params)); }
  catch (error) { return Promise.reject(error); }
}

function dbAll(db, sql, params = []) {
  try { return Promise.resolve(db.query(sql, ...params)); }
  catch (error) { return Promise.reject(error); }
}

function dbGet(db, sql, params = []) {
  try { return Promise.resolve(db.get(sql, ...params)); }
  catch (error) { return Promise.reject(error); }
}

// ─────────────────────────── Table DDL ───────────────────────────────────────

const DDL_PORTFOLIO = `
  CREATE TABLE IF NOT EXISTS mf_portfolio (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          TEXT DEFAULT 'demo',
    scheme_code      TEXT NOT NULL,
    scheme_name      TEXT NOT NULL,
    fund_house       TEXT,
    category         TEXT,
    units            REAL NOT NULL,
    avg_nav          REAL NOT NULL,
    invested_amount  REAL NOT NULL,
    purchase_date    TEXT,
    sip_id           INTEGER,
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
  )`;

const DDL_SIP = `
  CREATE TABLE IF NOT EXISTS mf_sip (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    scheme_code            TEXT NOT NULL,
    scheme_name            TEXT NOT NULL,
    fund_house             TEXT,
    amount                 REAL NOT NULL,
    frequency              TEXT NOT NULL DEFAULT 'monthly',
    sip_date               INTEGER NOT NULL DEFAULT 1,
    start_date             TEXT,
    status                 TEXT DEFAULT 'active',
    next_due               TEXT,
    total_installments     INTEGER DEFAULT 0,
    completed_installments INTEGER DEFAULT 0,
    created_at             TEXT DEFAULT (datetime('now'))
  )`;

const DDL_WATCHLIST = `
  CREATE TABLE IF NOT EXISTS mf_watchlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scheme_code TEXT NOT NULL UNIQUE,
    scheme_name TEXT NOT NULL,
    fund_house  TEXT,
    category    TEXT,
    added_at    TEXT DEFAULT (datetime('now'))
  )`;

const DDL_TRANSACTIONS = `
  CREATE TABLE IF NOT EXISTS mf_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT NOT NULL,
    scheme_code      TEXT NOT NULL,
    scheme_name      TEXT NOT NULL,
    amount           REAL,
    units            REAL,
    nav              REAL,
    status           TEXT DEFAULT 'DEMO',
    transaction_date TEXT DEFAULT (date('now')),
    created_at       TEXT DEFAULT (datetime('now'))
  )`;

// ─────────────────────────── Next-due calculator ─────────────────────────────

// Earlier builds created these tables with a nullable TEXT id, so INSERTs left
// id NULL and row lookups could never match. Rebuild any such table once into
// the intended INTEGER PRIMARY KEY schema while preserving existing rows.
const SCHEMA_COLUMNS = {
  mf_portfolio: ['user_id', 'scheme_code', 'scheme_name', 'fund_house', 'category', 'units', 'avg_nav', 'invested_amount', 'purchase_date', 'sip_id', 'created_at', 'updated_at'],
  mf_sip: ['scheme_code', 'scheme_name', 'fund_house', 'amount', 'frequency', 'sip_date', 'start_date', 'status', 'next_due', 'total_installments', 'completed_installments', 'created_at'],
  mf_watchlist: ['scheme_code', 'scheme_name', 'fund_house', 'category', 'added_at'],
  mf_transactions: ['type', 'scheme_code', 'scheme_name', 'amount', 'units', 'nav', 'status', 'transaction_date', 'created_at'],
};

async function repairTableSchema(db, table, ddl) {
  await dbRun(db, ddl);
  const info = await dbAll(db, `PRAGMA table_info(${table})`);
  const idColumn = info.find((column) => column.name === 'id');
  const isHealthy = idColumn
    && String(idColumn.type).toUpperCase() === 'INTEGER'
    && Number(idColumn.notnull) === 1;
  if (isHealthy) return;

  const temp = `${table}__rebuild`;
  await dbRun(db, `DROP TABLE IF EXISTS ${temp}`);
  await dbRun(db, ddl.replace(`CREATE TABLE IF NOT EXISTS ${table}`, `CREATE TABLE ${temp}`));
  const existing = new Set(info.map((column) => column.name));
  const shared = SCHEMA_COLUMNS[table].filter((name) => existing.has(name));
  if (shared.length) {
    const list = shared.join(', ');
    await dbRun(db, `INSERT INTO ${temp} (${list}) SELECT ${list} FROM ${table}`);
  }
  await dbRun(db, `DROP TABLE ${table}`);
  await dbRun(db, `ALTER TABLE ${temp} RENAME TO ${table}`);
  console.log(`[MF] Rebuilt ${table} with an INTEGER primary key`);
}

let schemaReadyPromise = null;
async function getReadyDb() {
  const db = await getDb();
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await repairTableSchema(db, 'mf_portfolio', DDL_PORTFOLIO);
      await repairTableSchema(db, 'mf_sip', DDL_SIP);
      await repairTableSchema(db, 'mf_watchlist', DDL_WATCHLIST);
      await repairTableSchema(db, 'mf_transactions', DDL_TRANSACTIONS);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
  return db;
}

function parseLocalDay(value) {
  const parsed = value ? new Date(`${value}T00:00:00`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function stepSchedule(cursor, kind) {
  if (kind === 'weekly') cursor.setDate(cursor.getDate() + 7);
  else if (kind === 'quarterly') cursor.setMonth(cursor.getMonth() + 3);
  else cursor.setMonth(cursor.getMonth() + 1);
  return cursor;
}

function startOfSchedule(startDateStr, frequency, sipDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseLocalDay(startDateStr) || new Date(today);
  const kind = (frequency || 'monthly').toLowerCase();
  const cursor = new Date(start);
  if (kind !== 'weekly' && sipDate) {
    cursor.setDate(Math.min(Number(sipDate) || 1, 28));
    if (cursor < start) stepSchedule(cursor, kind);
  }
  return { cursor, kind, today };
}

function countDueInstallments(startDateStr, frequency, sipDate) {
  const { cursor, kind, today } = startOfSchedule(startDateStr, frequency, sipDate);
  let count = 0;
  let guard = 0;
  while (cursor < today && guard < 500) {
    count += 1;
    stepSchedule(cursor, kind);
    guard += 1;
  }
  return count;
}

function computeNextDue(startDateStr, frequency, sipDate) {
  const { cursor, kind, today } = startOfSchedule(startDateStr, frequency, sipDate);
  let guard = 0;
  while (cursor < today && guard < 400) {
    stepSchedule(cursor, kind);
    guard += 1;
  }
  const y = cursor.getFullYear();
  const m = String(cursor.getMonth() + 1).padStart(2, '0');
  const d = String(cursor.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─────────────────────────── Route registration ───────────────────────────────

export function registerMutualFundRoutes(app) {

  // ── 1. GET /api/mf/portfolio ──────────────────────────────────────────────
  app.get('/api/mf/portfolio', async (req, res) => {
    try {
      const db = await getReadyDb();
      await dbRun(db, DDL_PORTFOLIO);

      const holdings = await dbAll(db, `SELECT * FROM mf_portfolio ORDER BY created_at DESC`);

      let total_invested = 0;
      let total_current_value = 0;

      const enriched = await Promise.all(holdings.map(async (h) => {
        const navInfo = await fetchLatestNav(h.scheme_code);
        const current_nav = navInfo?.nav ?? h.avg_nav;
        const current_value = h.units * current_nav;
        const pnl = current_value - h.invested_amount;
        const pnl_percent = h.invested_amount ? (pnl / h.invested_amount) * 100 : 0;
        const xirr = computeXIRR(current_value, h.invested_amount, h.purchase_date);

        total_invested += h.invested_amount;
        total_current_value += current_value;

        return {
          ...h,
          current_nav,
          current_value: +current_value.toFixed(2),
          pnl: +pnl.toFixed(2),
          pnl_percent: +pnl_percent.toFixed(2),
          xirr_approx: xirr !== null ? +xirr.toFixed(2) : null,
          nav_as_of: navInfo?.date ?? null,
        };
      }));

      const total_pnl = total_current_value - total_invested;
      const total_pnl_percent = total_invested ? (total_pnl / total_invested) * 100 : 0;

      const categoryTotals = new Map();
      for (const h of enriched) {
        const key = h.category || 'Unclassified';
        const bucket = categoryTotals.get(key) || { category: key, invested: 0, current_value: 0, holdings: 0 };
        bucket.invested += h.invested_amount || 0;
        bucket.current_value += h.current_value || 0;
        bucket.holdings += 1;
        categoryTotals.set(key, bucket);
      }
      const allocation = [...categoryTotals.values()]
        .map((bucket) => ({
          ...bucket,
          invested: +bucket.invested.toFixed(2),
          current_value: +bucket.current_value.toFixed(2),
          weight_percent: total_current_value ? +((bucket.current_value / total_current_value) * 100).toFixed(2) : 0,
        }))
        .sort((a, b) => b.current_value - a.current_value);

      const splitBucket = () => ({ invested: 0, current_value: 0, holdings: 0 });
      const investment_split = { sip_linked: splitBucket(), lumpsum: splitBucket() };
      for (const h of enriched) {
        const bucket = h.sip_id != null ? investment_split.sip_linked : investment_split.lumpsum;
        bucket.invested += h.invested_amount || 0;
        bucket.current_value += h.current_value || 0;
        bucket.holdings += 1;
      }
      for (const bucket of Object.values(investment_split)) {
        bucket.invested = +bucket.invested.toFixed(2);
        bucket.current_value = +bucket.current_value.toFixed(2);
      }

      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const cashflows = [];
      for (const h of enriched) {
        const purchased = h.purchase_date ? new Date(h.purchase_date) : null;
        if (!purchased || Number.isNaN(purchased.getTime()) || purchased > new Date()) continue;
        cashflows.push({ date: h.purchase_date, amount: -(h.invested_amount || 0) });
      }
      if (cashflows.length && total_current_value > 0) {
        cashflows.push({ date: todayIso, amount: total_current_value });
      }
      const portfolioXirr = computeXirr(cashflows);

      const tax = estimatePortfolioTax(enriched, { today: todayIso });

      res.json({
        total_invested: +total_invested.toFixed(2),
        total_current_value: +total_current_value.toFixed(2),
        total_pnl: +total_pnl.toFixed(2),
        total_pnl_percent: +total_pnl_percent.toFixed(2),
        xirr: portfolioXirr,
        xirrStatus: portfolioXirr != null ? 'ok' : (holdings.length ? 'needs_purchase_dates' : 'no_holdings'),
        allocation,
        investment_split,
        tax,
        holdings: enriched,
      });
    } catch (err) {
      console.error('[MF] GET /api/mf/portfolio error:', err.message);
      res.status(500).json({ error: 'Failed to fetch portfolio', code: 'PORTFOLIO_FETCH_ERR' });
    }
  });

  // ── 2. POST /api/mf/portfolio ─────────────────────────────────────────────
  app.post('/api/mf/portfolio', async (req, res) => {
    try {
      const { scheme_code, scheme_name, fund_house, category, units, avg_nav, invested_amount, purchase_date, sip_id } = req.body;
      if (!scheme_code || !scheme_name || units == null || avg_nav == null || invested_amount == null) {
        return res.status(400).json({ error: 'Missing required fields', code: 'MISSING_FIELDS' });
      }

      const db = await getReadyDb();
      await dbRun(db, DDL_PORTFOLIO);

      const result = await dbRun(db,
        `INSERT INTO mf_portfolio (scheme_code, scheme_name, fund_house, category, units, avg_nav, invested_amount, purchase_date, sip_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [scheme_code, scheme_name, fund_house ?? null, category ?? null, units, avg_nav, invested_amount, purchase_date ?? null, sip_id ?? null]
      );

      const created = await dbGet(db, `SELECT * FROM mf_portfolio WHERE id = ?`, [result.lastInsertRowid]);
      res.status(201).json({
        ...created,
        demo_note: 'This is a DEMO record. Real transactions require authorized broker integration.',
      });
    } catch (err) {
      console.error('[MF] POST /api/mf/portfolio error:', err.message);
      res.status(500).json({ error: 'Failed to add portfolio holding', code: 'PORTFOLIO_INSERT_ERR' });
    }
  });

  // ── 3. DELETE /api/mf/portfolio/:id ──────────────────────────────────────
  app.delete('/api/mf/portfolio/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getReadyDb();
      await dbRun(db, DDL_PORTFOLIO);
      const result = await dbRun(db, `DELETE FROM mf_portfolio WHERE id = ?`, [id]);
      if (result.changes === 0) return res.status(404).json({ error: 'Holding not found', code: 'HOLDING_NOT_FOUND' });
      res.json({ success: true, id: +id });
    } catch (err) {
      console.error('[MF] DELETE /api/mf/portfolio error:', err.message);
      res.status(500).json({ error: 'Failed to delete holding', code: 'PORTFOLIO_DELETE_ERR' });
    }
  });

  // ── 4. GET /api/mf/sip ───────────────────────────────────────────────────
  app.get('/api/mf/sip', async (req, res) => {
    try {
      const db = await getReadyDb();
      await dbRun(db, DDL_SIP);
      const sips = await dbAll(db, `SELECT * FROM mf_sip ORDER BY created_at DESC`);
      const visible = [];
      let completedCount = 0;

      for (const sip of sips) {
        const total = Number(sip.total_installments) || 0;
        const completed = countDueInstallments(sip.start_date, sip.frequency, sip.sip_date);
        let status = sip.status;
        let next_due = sip.next_due;

        if (status === 'active' && total > 0 && completed >= total) {
          status = 'completed';
          next_due = null;
        }

        if (status !== sip.status || next_due !== sip.next_due || completed !== sip.completed_installments) {
          await dbRun(db,
            `UPDATE mf_sip SET status = ?, next_due = ?, completed_installments = ? WHERE id = ?`,
            [status, next_due, completed, sip.id]);
          sip.status = status;
          sip.next_due = next_due;
          sip.completed_installments = completed;
        }

        if (status === 'completed') completedCount += 1;
        else visible.push(sip);
      }

      res.json({ sips: visible, completed_count: completedCount });
    } catch (err) {
      console.error('[MF] GET /api/mf/sip error:', err.message);
      res.status(500).json({ error: 'Failed to fetch SIPs', code: 'SIP_FETCH_ERR' });
    }
  });

  // ── 5. POST /api/mf/sip ──────────────────────────────────────────────────
  app.post('/api/mf/sip', async (req, res) => {
    try {
      const { scheme_code, scheme_name, fund_house, amount, frequency, sip_date, start_date, total_installments } = req.body;
      if (!scheme_code || !scheme_name || !amount || !frequency) {
        return res.status(400).json({ error: 'Missing required fields', code: 'MISSING_FIELDS' });
      }

      const next_due = computeNextDue(start_date, frequency, sip_date);
      const completed_installments = countDueInstallments(start_date, frequency, sip_date);
      const total = Number(total_installments) > 0 ? Math.floor(Number(total_installments)) : 0;
      const db = await getReadyDb();
      await dbRun(db, DDL_SIP);

      const result = await dbRun(db,
        `INSERT INTO mf_sip (scheme_code, scheme_name, fund_house, amount, frequency, sip_date, start_date, status, next_due, total_installments, completed_installments)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [scheme_code, scheme_name, fund_house ?? null, amount, frequency, sip_date ?? 1, start_date ?? null, next_due, total, completed_installments]
      );

      const created = await dbGet(db, `SELECT * FROM mf_sip WHERE id = ?`, [result.lastInsertRowid]);
      res.status(201).json({
        ...created,
        demo_note: 'This is a DEMO record. Real transactions require authorized broker integration.',
      });
    } catch (err) {
      console.error('[MF] POST /api/mf/sip error:', err.message);
      res.status(500).json({ error: 'Failed to create SIP', code: 'SIP_INSERT_ERR' });
    }
  });

  // ── 6. PUT /api/mf/sip/:id ───────────────────────────────────────────────
  app.put('/api/mf/sip/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { status, amount } = req.body;
      if (status == null && amount == null) {
        return res.status(400).json({ error: 'Nothing to update', code: 'NOTHING_TO_UPDATE' });
      }

      const db = await getReadyDb();
      await dbRun(db, DDL_SIP);

      const fields = [];
      const values = [];
      if (status != null) { fields.push('status = ?'); values.push(status); }
      if (amount != null) { fields.push('amount = ?'); values.push(amount); }
      values.push(id);

      const result = await dbRun(db,
        `UPDATE mf_sip SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      if (result.changes === 0) return res.status(404).json({ error: 'SIP not found', code: 'SIP_NOT_FOUND' });

      const updated = await dbGet(db, `SELECT * FROM mf_sip WHERE id = ?`, [id]);
      res.json({
        ...updated,
        demo_note: 'This is a DEMO record. Real transactions require authorized broker integration.',
      });
    } catch (err) {
      console.error('[MF] PUT /api/mf/sip error:', err.message);
      res.status(500).json({ error: 'Failed to update SIP', code: 'SIP_UPDATE_ERR' });
    }
  });

  // ── 7. DELETE /api/mf/sip/:id ────────────────────────────────────────────
  app.delete('/api/mf/sip/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getReadyDb();
      await dbRun(db, DDL_SIP);
      const result = await dbRun(db, `DELETE FROM mf_sip WHERE id = ?`, [id]);
      if (result.changes === 0) return res.status(404).json({ error: 'SIP not found', code: 'SIP_NOT_FOUND' });
      res.json({ success: true, id: +id });
    } catch (err) {
      console.error('[MF] DELETE /api/mf/sip error:', err.message);
      res.status(500).json({ error: 'Failed to delete SIP', code: 'SIP_DELETE_ERR' });
    }
  });

  // ── 8. GET /api/mf/watchlist ─────────────────────────────────────────────
  app.get('/api/mf/watchlist', async (req, res) => {
    try {
      const db = await getReadyDb();
      await dbRun(db, DDL_WATCHLIST);
      const items = await dbAll(db, `SELECT * FROM mf_watchlist ORDER BY added_at DESC`);

      const enriched = await Promise.all(items.map(async (item) => {
        const navInfo = await fetchLatestNav(item.scheme_code);
        return {
          ...item,
          current_nav: navInfo?.nav ?? null,
          nav_as_of: navInfo?.date ?? null,
        };
      }));

      res.json({ watchlist: enriched });
    } catch (err) {
      console.error('[MF] GET /api/mf/watchlist error:', err.message);
      res.status(500).json({ error: 'Failed to fetch watchlist', code: 'WATCHLIST_FETCH_ERR' });
    }
  });

  // ── 9. POST /api/mf/watchlist ────────────────────────────────────────────
  app.post('/api/mf/watchlist', async (req, res) => {
    try {
      const { scheme_code, scheme_name, fund_house, category } = req.body;
      if (!scheme_code || !scheme_name) {
        return res.status(400).json({ error: 'scheme_code and scheme_name required', code: 'MISSING_FIELDS' });
      }

      const db = await getReadyDb();
      await dbRun(db, DDL_WATCHLIST);

      const existing = await dbGet(db, `SELECT id FROM mf_watchlist WHERE scheme_code = ?`, [scheme_code]);
      if (existing) return res.status(409).json({ error: 'Fund already in watchlist', code: 'DUPLICATE_WATCHLIST' });

      const result = await dbRun(db,
        `INSERT INTO mf_watchlist (scheme_code, scheme_name, fund_house, category) VALUES (?, ?, ?, ?)`,
        [scheme_code, scheme_name, fund_house ?? null, category ?? null]
      );

      const created = await dbGet(db, `SELECT * FROM mf_watchlist WHERE id = ?`, [result.lastInsertRowid]);
      res.status(201).json(created);
    } catch (err) {
      console.error('[MF] POST /api/mf/watchlist error:', err.message);
      res.status(500).json({ error: 'Failed to add to watchlist', code: 'WATCHLIST_INSERT_ERR' });
    }
  });

  // ── 10. DELETE /api/mf/watchlist/:scheme_code ────────────────────────────
  app.delete('/api/mf/watchlist/:scheme_code', async (req, res) => {
    try {
      const { scheme_code } = req.params;
      const db = await getReadyDb();
      await dbRun(db, DDL_WATCHLIST);
      const result = await dbRun(db, `DELETE FROM mf_watchlist WHERE scheme_code = ?`, [scheme_code]);
      if (result.changes === 0) return res.status(404).json({ error: 'Watchlist entry not found', code: 'WATCHLIST_NOT_FOUND' });
      res.json({ success: true, scheme_code });
    } catch (err) {
      console.error('[MF] DELETE /api/mf/watchlist error:', err.message);
      res.status(500).json({ error: 'Failed to remove from watchlist', code: 'WATCHLIST_DELETE_ERR' });
    }
  });

  // ── 11. GET /api/mf/transactions ─────────────────────────────────────────
  app.get('/api/mf/transactions', async (req, res) => {
    try {
      const db = await getReadyDb();
      await dbRun(db, DDL_TRANSACTIONS);
      const { scheme_code, type, limit = 50, offset = 0 } = req.query;

      let sql = `SELECT * FROM mf_transactions WHERE 1=1`;
      const params = [];
      if (scheme_code) { sql += ` AND scheme_code = ?`; params.push(scheme_code); }
      if (type) { sql += ` AND type = ?`; params.push(type); }
      sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(+limit, +offset);

      const transactions = await dbAll(db, sql, params);
      res.json({ transactions });
    } catch (err) {
      console.error('[MF] GET /api/mf/transactions error:', err.message);
      res.status(500).json({ error: 'Failed to fetch transactions', code: 'TXN_FETCH_ERR' });
    }
  });

  // ── 12. POST /api/mf/transactions ────────────────────────────────────────
  app.post('/api/mf/transactions', async (req, res) => {
    try {
      const { type, scheme_code, scheme_name, amount, units, nav, transaction_date } = req.body;
      if (!type || !scheme_code || !scheme_name) {
        return res.status(400).json({ error: 'Missing required fields: type, scheme_code, scheme_name', code: 'MISSING_FIELDS' });
      }
      const validTypes = ['SIP', 'Lumpsum', 'Redemption', 'Switch'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}`, code: 'INVALID_TYPE' });
      }

      const db = await getReadyDb();
      await dbRun(db, DDL_TRANSACTIONS);

      const result = await dbRun(db,
        `INSERT INTO mf_transactions (type, scheme_code, scheme_name, amount, units, nav, status, transaction_date)
         VALUES (?, ?, ?, ?, ?, ?, 'DEMO', ?)`,
        [type, scheme_code, scheme_name, amount ?? null, units ?? null, nav ?? null, transaction_date ?? new Date().toISOString().slice(0, 10)]
      );

      const created = await dbGet(db, `SELECT * FROM mf_transactions WHERE id = ?`, [result.lastInsertRowid]);
      res.status(201).json({
        ...created,
        demo_note: 'This is a DEMO record. Real transactions require authorized broker integration.',
      });
    } catch (err) {
      console.error('[MF] POST /api/mf/transactions error:', err.message);
      res.status(500).json({ error: 'Failed to record transaction', code: 'TXN_INSERT_ERR' });
    }
  });

  // ── 13. GET /api/mf/compare?codes=119598,100033 ──────────────────────────
  app.get('/api/mf/compare', async (req, res) => {
    try {
      const { codes } = req.query;
      if (!codes) return res.status(400).json({ error: 'codes query param required (comma-separated)', code: 'MISSING_CODES' });

      const codeList = codes.split(',').map(c => c.trim()).filter(Boolean).slice(0, 5);
      if (codeList.length === 0) return res.status(400).json({ error: 'No valid codes provided', code: 'NO_CODES' });

      const results = await Promise.all(codeList.map(async (code) => {
        try {
          const [historyRes, latestRes] = await Promise.all([
            fetchNavHistory(code),
            fetchLatestNav(code),
          ]);

          if (!historyRes) return { code, error: 'Fund not found' };

          const navHistory = historyRes.data || [];
          const meta = historyRes.meta || {};

          const y1 = computeCAGR(navHistory, 1);
          const y3 = computeCAGR(navHistory, 3);
          const y5 = computeCAGR(navHistory, 5);
          const y10 = computeCAGR(navHistory, 10);

          const schemeName = meta.scheme_name || '';
          const category = meta.scheme_category || '';
          const plan = schemeName.toLowerCase().includes('direct') ? 'Direct' : 'Regular';
          const option = schemeName.toLowerCase().includes('idcw') || schemeName.toLowerCase().includes('dividend') ? 'IDCW' : 'Growth';

          return {
            code,
            name: schemeName,
            meta,
            latest_nav: latestRes?.nav ?? null,
            latest_date: latestRes?.date ?? null,
            returns: {
              y1: y1 !== null ? +y1.toFixed(2) : null,
              y3: y3 !== null ? +y3.toFixed(2) : null,
              y5: y5 !== null ? +y5.toFixed(2) : null,
              y10: y10 !== null ? +y10.toFixed(2) : null,
            },
            risk: computeRiskMetrics(navHistory),
            category,
            plan,
            option,
          };
        } catch {
          return { code, error: 'Failed to fetch fund data' };
        }
      }));

      res.json({ comparison: results });
    } catch (err) {
      console.error('[MF] GET /api/mf/compare error:', err.message);
      res.status(500).json({ error: 'Compare failed', code: 'COMPARE_ERR' });
    }
  });

  // ── 13b. GET /api/mf/risk/:schemeCode ────────────────────────────────────
  app.get('/api/mf/risk/:schemeCode', async (req, res) => {
    try {
      const { schemeCode } = req.params;
      const historyRes = await fetchNavHistory(schemeCode);
      if (!historyRes?.data?.length) {
        return res.status(404).json({ error: 'Fund not found', code: 'FUND_NOT_FOUND' });
      }
      const meta = historyRes.meta || {};
      const risk = computeRiskMetrics(historyRes.data);
      res.json({
        scheme_code: schemeCode,
        scheme_name: meta.scheme_name || null,
        fund_house: meta.fund_house || null,
        category: meta.scheme_category || null,
        nav_points: historyRes.data.length,
        risk,
        source: 'AMFI NAV history via api.mfapi.in',
      });
    } catch (err) {
      console.error('[MF] GET /api/mf/risk error:', err.message);
      res.status(500).json({ error: 'Risk metrics unavailable', code: 'MF_RISK_ERR' });
    }
  });

  // ── 14. GET /api/mf/top-funds?category=equity&limit=10 ───────────────────
  app.get('/api/mf/top-funds', async (req, res) => {
    try {
      const { category = 'equity', limit = 10 } = req.query;
      const cacheKey = `topfunds:${category}:${limit}`;
      const cached = topFundsCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < TOP_FUNDS_TTL) {
        return res.json({ funds: cached.data, cached: true });
      }

      // Fetch search results for category
      const searchRes = await axios.get(`${MF_BASE}/mf/search`, {
        params: { q: category },
        timeout: 10000,
      });
      const schemes = (searchRes.data || []).slice(0, Math.min(+limit * 3, 30)); // fetch extras to filter

      // Enrich with NAV history to compute returns
      const enriched = await Promise.all(schemes.map(async (scheme) => {
        try {
          const historyRes = await fetchNavHistory(scheme.schemeCode);
          if (!historyRes) return null;

          const navHistory = historyRes.data || [];
          const meta = historyRes.meta || {};
          const latestEntry = navHistory[0];
          const y1 = computeCAGR(navHistory, 1);

          return {
            scheme_code: scheme.schemeCode,
            scheme_name: scheme.schemeName,
            fund_house: meta.fund_house || scheme.schemeName?.split(' ')[0] || '',
            category: meta.scheme_category || category,
            latest_nav: latestEntry ? parseFloat(latestEntry.nav) : null,
            latest_date: latestEntry?.date ?? null,
            returns: {
              y1: y1 !== null ? +y1.toFixed(2) : null,
            },
          };
        } catch {
          return null;
        }
      }));

      const valid = enriched
        .filter(f => f && f.returns.y1 !== null)
        .sort((a, b) => b.returns.y1 - a.returns.y1)
        .slice(0, +limit);

      topFundsCache.set(cacheKey, { data: valid, ts: Date.now() });
      res.json({ funds: valid, cached: false });
    } catch (err) {
      console.error('[MF] GET /api/mf/top-funds error:', err.message);
      res.status(500).json({ error: 'Failed to fetch top funds', code: 'TOP_FUNDS_ERR' });
    }
  });

  // ── 15. GET /api/mf/ai-analysis/:schemeCode ──────────────────────────────
  app.get('/api/mf/ai-analysis/:schemeCode', async (req, res) => {
    try {
      const { schemeCode } = req.params;

      const historyRes = await fetchNavHistory(schemeCode);
      if (!historyRes) {
        return res.status(404).json({ error: 'Fund not found', code: 'FUND_NOT_FOUND' });
      }

      const navHistory = historyRes.data || [];
      const meta = historyRes.meta || {};
      const category = (meta.scheme_category || '').toLowerCase();

      const y1 = computeCAGR(navHistory, 1);
      const y3 = computeCAGR(navHistory, 3);
      const y5 = computeCAGR(navHistory, 5);

      // Try AI analyst first
      let aiResult = null;
      try {
        const { answerCopilot } = await import('./aiAnalyst.js');
        const prompt = `Analyze this mutual fund: ${meta.scheme_name}. Category: ${meta.scheme_category}. 1Y return: ${y1?.toFixed(2)}%, 3Y: ${y3?.toFixed(2)}%, 5Y: ${y5?.toFixed(2)}%. Provide risk level, strengths, weaknesses, and who it is suitable for.`;
        const aiText = await answerCopilot(prompt);
        aiResult = { ai_text: aiText, used_ai: true };
      } catch {
        aiResult = null; // fall through to rule-based
      }

      // Determine risk level
      let risk_level = 'Moderate';
      if (/small.?cap|sectoral|thematic|international/i.test(category)) risk_level = 'High';
      else if (/liquid|overnight|money.?market|gilt|debt/i.test(category)) risk_level = 'Low';
      else if (/large.?cap|index|bluechip/i.test(category)) risk_level = 'Moderate';
      else if (/mid.?cap|flexi|multi.?cap/i.test(category)) risk_level = 'Moderately High';

      // Rule-based strengths & weaknesses
      const strengths = [];
      const weaknesses = [];

      if (y1 !== null && y1 > 15) strengths.push(`Strong 1Y return of ${y1.toFixed(1)}%`);
      if (y3 !== null && y3 > 12) strengths.push(`Consistent 3Y CAGR of ${y3.toFixed(1)}%`);
      if (y5 !== null && y5 > 10) strengths.push(`Solid 5Y CAGR of ${y5.toFixed(1)}%`);
      if (/direct/i.test(meta.scheme_name)) strengths.push('Direct plan – lower expense ratio');
      if (/index/i.test(category)) strengths.push('Passive strategy – low cost, tracks benchmark');
      if (/elss/i.test(category)) strengths.push('Tax saving under Section 80C (up to ₹1.5L)');

      if (y1 !== null && y1 < 5) weaknesses.push(`Weak recent 1Y performance (${y1.toFixed(1)}%)`);
      if (y1 !== null && y1 < 0) weaknesses.push('Negative 1Y return – high short-term risk');
      if (risk_level === 'High') weaknesses.push('High volatility – not suitable for short-term goals');
      if (navHistory.length < 365) weaknesses.push('Limited NAV history – track record too short to assess fully');
      if (/regular/i.test(meta.scheme_name)) weaknesses.push('Regular plan – higher expense ratio than Direct');

      if (strengths.length === 0) strengths.push('Diversified exposure within category');
      if (weaknesses.length === 0) weaknesses.push('No significant weaknesses identified from NAV data alone');

      // Suitable-for
      const suitableMap = {
        Low: 'Conservative investors seeking capital preservation and steady returns',
        Moderate: 'Investors with a 3-5 year horizon seeking balanced growth',
        'Moderately High': 'Investors with 5+ year horizon comfortable with moderate volatility',
        High: 'Aggressive investors with 7+ year horizon and high risk tolerance',
      };

      const recommendation = risk_level === 'Low'
        ? 'Consider for short-term parking or capital preservation'
        : risk_level === 'High'
        ? 'Suitable only for high-risk investors with long time horizon'
        : 'Good for SIP investments over a medium to long horizon';

      res.json({
        scheme_code: schemeCode,
        scheme_name: meta.scheme_name,
        fund_house: meta.fund_house,
        category: meta.scheme_category,
        risk_level,
        recommendation,
        strengths,
        weaknesses,
        suitable_for: suitableMap[risk_level] || 'Medium-risk investors',
        returns: {
          y1: y1 !== null ? +y1.toFixed(2) : null,
          y3: y3 !== null ? +y3.toFixed(2) : null,
          y5: y5 !== null ? +y5.toFixed(2) : null,
        },
        ai_note: 'AI analysis based on NAV history. Not financial advice.',
        is_demo: true,
        ...(aiResult?.used_ai ? { ai_text: aiResult.ai_text } : {}),
      });
    } catch (err) {
      console.error('[MF] GET /api/mf/ai-analysis error:', err.message);
      res.status(500).json({ error: 'AI analysis failed', code: 'AI_ANALYSIS_ERR' });
    }
  });

  console.log('[MF] Mutual Fund routes registered (16 endpoints)');
}
