import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-db-'));
const dbFile = path.join(tempDir, 'platform.sqlite');
process.env.CORE_DB_PATH = dbFile;

const { openDatabase, closeDatabase, databaseHealth, migrationStatus } = await import('../serverDb.js');
const LATEST_VERSION = migrationStatus().latest;

const db = openDatabase({ file: dbFile });
const now = new Date().toISOString();

const seedUser = (id = 'USR-1', phone = '9000000001') => {
  db.run(
    'INSERT INTO users (id, phone, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, phone, 'Test User', 'trader', now, now,
  );
};

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('migrations apply once and expose the full trading schema', () => {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((row) => row.name);
  for (const required of ['users', 'broker_accounts', 'orders', 'order_events', 'trades', 'holdings', 'positions', 'watchlists', 'strategies', 'ai_signals', 'risk_configs', 'notifications', 'audit_log', 'api_health', 'performance_reports', 'market_calendar_events', 'market_calendar_sync']) {
    assert.ok(tables.includes(required), `missing table ${required}`);
  }
  assert.equal(db.get('SELECT MAX(version) AS version FROM schema_migrations').version, LATEST_VERSION);
  assert.equal(db.get('PRAGMA integrity_check').integrity_check, 'ok');

  const reopened = openDatabase({ file: dbFile });
  assert.equal(reopened.get('SELECT COUNT(*) AS count FROM schema_migrations').count, LATEST_VERSION, 'migrations must not reapply');
  reopened.close();
  assert.equal(databaseHealth().ok, true);
  assert.equal(databaseHealth().schemaVersion, LATEST_VERSION);
});

test('transactions commit atomically and roll back on failure', () => {
  seedUser();
  db.transaction((tx) => {
    tx.run('INSERT INTO watchlists (id, user_id, name, symbols, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      'WL-1', 'USR-1', 'Long term', '["RELIANCE"]', now, now);
  });
  assert.equal(db.get('SELECT COUNT(*) AS count FROM watchlists').count, 1);

  assert.throws(() => {
    db.transaction((tx) => {
      tx.run('INSERT INTO watchlists (id, user_id, name, symbols, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        'WL-2', 'USR-1', 'Momentum', '[]', now, now);
      throw new Error('simulated failure');
    });
  }, /simulated failure/);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM watchlists').count, 1, 'rolled-back row must not persist');
});

test('order state changes are recorded in one transaction with idempotency', () => {
  db.transaction((tx) => {
    tx.run(
      `INSERT INTO orders (id, user_id, idempotency_key, symbol, exchange, side, order_type, product, quantity, status, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ORD-1', 'USR-1', 'idem-1', 'RELIANCE', 'NSE', 'BUY', 'MARKET', 'CNC', 10, 'pending', 'paper', now, now,
    );
    tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', 'ORD-1', 'pending', '{"source":"test"}', now);
    tx.run('UPDATE orders SET status = ?, filled_quantity = ?, average_price = ?, updated_at = ? WHERE id = ?',
      'complete', 10, 1300.5, now, 'ORD-1');
    tx.run('INSERT INTO order_events (order_id, status, detail, at) VALUES (?, ?, ?, ?)', 'ORD-1', 'complete', null, now);
  });

  const order = db.get('SELECT * FROM orders WHERE id = ?', 'ORD-1');
  assert.equal(order.status, 'complete');
  assert.equal(order.filled_quantity, 10);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM order_events WHERE order_id = ?', 'ORD-1').count, 2);

  assert.throws(() => {
    db.run(
      `INSERT INTO orders (id, user_id, idempotency_key, symbol, exchange, side, quantity, status, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ORD-2', 'USR-1', 'idem-1', 'TCS', 'NSE', 'SELL', 5, 'pending', 'paper', now, now,
    );
  }, /UNIQUE/i);
});

test('foreign keys and check constraints reject invalid orders', () => {
  assert.throws(() => {
    db.run(
      `INSERT INTO orders (id, user_id, idempotency_key, symbol, exchange, side, quantity, status, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ORD-3', 'USR-MISSING', 'idem-3', 'TCS', 'NSE', 'BUY', 1, 'pending', 'paper', now, now,
    );
  }, /FOREIGN KEY/i);

  assert.throws(() => {
    db.run(
      `INSERT INTO orders (id, user_id, idempotency_key, symbol, exchange, side, quantity, status, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ORD-4', 'USR-1', 'idem-4', 'TCS', 'NSE', 'HOLD', 1, 'pending', 'paper', now, now,
    );
  }, /CHECK/i);

  assert.throws(() => {
    db.run(
      `INSERT INTO orders (id, user_id, idempotency_key, symbol, exchange, side, quantity, status, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ORD-5', 'USR-1', 'idem-5', 'TCS', 'NSE', 'BUY', 1, 'pending', 'pretend-live', now, now,
    );
  }, /CHECK/i);
});

test('notifications track delivery and unread state', () => {
  db.run(
    'INSERT INTO notifications (id, user_id, category, title, body, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'NTF-1', 'USR-1', 'order', 'Order executed', 'RELIANCE 10 @ 1300.50', 'success', now,
  );
  db.run(
    'INSERT INTO notifications (id, user_id, category, title, body, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'NTF-2', 'USR-1', 'risk', 'Risk limit reached', 'Daily loss cap hit', 'warning', now,
  );
  const unread = db.get('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL', 'USR-1');
  assert.equal(unread.count, 2);
  db.run('UPDATE notifications SET read_at = ? WHERE id = ?', now, 'NTF-1');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL', 'USR-1').count, 1);
});

test('health reports the SQLite engine and schema version', () => {
  const health = databaseHealth();
  assert.equal(health.ok, true);
  assert.equal(health.schemaVersion, LATEST_VERSION);
  assert.match(health.engine, /SQLite/);
  assert.ok(health.tables >= 15);
});
