import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../serverDb.js';

test('Mutual Funds database tables and operations', () => {
  const db = getDatabase();

  // 1. Ensure table schema can be created
  db.run(`
    CREATE TABLE IF NOT EXISTS mf_portfolio (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'demo_user',
      scheme_code TEXT NOT NULL,
      scheme_name TEXT NOT NULL,
      fund_house TEXT,
      category TEXT,
      units REAL NOT NULL DEFAULT 0,
      avg_nav REAL NOT NULL DEFAULT 0,
      invested_amount REAL NOT NULL DEFAULT 0,
      purchase_date TEXT,
      sip_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mf_sip (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'demo_user',
      scheme_code TEXT NOT NULL,
      scheme_name TEXT NOT NULL,
      fund_house TEXT,
      amount REAL NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'Monthly',
      sip_date INTEGER NOT NULL DEFAULT 1,
      start_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      next_due TEXT,
      total_installments INTEGER DEFAULT 0,
      completed_installments INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mf_watchlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'demo_user',
      scheme_code TEXT NOT NULL,
      scheme_name TEXT NOT NULL,
      fund_house TEXT,
      category TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, scheme_code)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mf_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'demo_user',
      type TEXT NOT NULL,
      scheme_code TEXT NOT NULL,
      scheme_name TEXT NOT NULL,
      amount REAL NOT NULL,
      units REAL,
      nav REAL,
      status TEXT NOT NULL DEFAULT 'DEMO',
      transaction_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 2. Test inserting holding
  const testId = `test_${Date.now()}`;
  db.run(
    `INSERT INTO mf_portfolio (id, scheme_code, scheme_name, fund_house, category, units, avg_nav, invested_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    testId, '119598', 'Parag Parikh Flexi Cap', 'PPFAS', 'Equity', 50, 60, 3000
  );

  const row = db.get('SELECT * FROM mf_portfolio WHERE id = ?', testId);
  assert.ok(row);
  assert.equal(row.scheme_code, '119598');
  assert.equal(row.invested_amount, 3000);

  // 3. Test SIP insertion
  const sipId = `sip_${Date.now()}`;
  db.run(
    `INSERT INTO mf_sip (id, scheme_code, scheme_name, fund_house, amount, frequency, sip_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    sipId, '119598', 'Parag Parikh Flexi Cap', 'PPFAS', 2500, 'Monthly', 5
  );

  const sipRow = db.get('SELECT * FROM mf_sip WHERE id = ?', sipId);
  assert.ok(sipRow);
  assert.equal(sipRow.amount, 2500);

  // Clean up test rows
  db.run('DELETE FROM mf_portfolio WHERE id = ?', testId);
  db.run('DELETE FROM mf_sip WHERE id = ?', sipId);

  assert.equal(db.get('SELECT * FROM mf_portfolio WHERE id = ?', testId), undefined);
  assert.equal(db.get('SELECT * FROM mf_sip WHERE id = ?', sipId), undefined);
});
