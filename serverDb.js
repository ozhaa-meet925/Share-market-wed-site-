import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CORE_DIR } from './serverCoreStore.js';

export const DB_PATH = path.resolve(process.env.CORE_DB_PATH || path.join(CORE_DIR, 'platform.sqlite'));

// Versioned migrations. Each entry runs once inside its own transaction and is
// recorded in schema_migrations. Keep statements portable to PostgreSQL where
// practical so the same schema can move to a server database later.
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_trading_schema',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL UNIQUE,
        name TEXT,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'trader',
        kyc_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE broker_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        broker TEXT NOT NULL,
        client_id TEXT,
        status TEXT NOT NULL DEFAULT 'disconnected',
        access_token_cipher TEXT,
        refresh_token_cipher TEXT,
        token_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, broker)
      );
      CREATE INDEX idx_broker_accounts_user ON broker_accounts(user_id);

      CREATE TABLE strategies (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'rule',
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_strategies_user ON strategies(user_id);

      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        broker_account_id TEXT REFERENCES broker_accounts(id) ON DELETE SET NULL,
        strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        order_type TEXT NOT NULL DEFAULT 'MARKET',
        product TEXT NOT NULL DEFAULT 'CNC',
        quantity REAL NOT NULL CHECK (quantity > 0),
        price REAL,
        trigger_price REAL,
        status TEXT NOT NULL DEFAULT 'draft',
        broker_order_id TEXT,
        filled_quantity REAL NOT NULL DEFAULT 0,
        average_price REAL,
        mode TEXT NOT NULL CHECK (mode IN ('paper', 'sandbox', 'live')),
        reject_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        submitted_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX idx_orders_user_created ON orders(user_id, created_at);
      CREATE INDEX idx_orders_status ON orders(status);
      CREATE INDEX idx_orders_broker_order ON orders(broker_order_id);

      CREATE TABLE order_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        detail TEXT,
        at TEXT NOT NULL
      );
      CREATE INDEX idx_order_events_order ON order_events(order_id, seq);

      CREATE TABLE trades (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        broker_trade_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        quantity REAL NOT NULL CHECK (quantity > 0),
        price REAL NOT NULL CHECK (price >= 0),
        fees REAL NOT NULL DEFAULT 0,
        mode TEXT NOT NULL CHECK (mode IN ('paper', 'sandbox', 'live')),
        executed_at TEXT NOT NULL,
        UNIQUE (order_id, broker_trade_id)
      );
      CREATE INDEX idx_trades_user_time ON trades(user_id, executed_at);

      CREATE TABLE holdings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        avg_price REAL NOT NULL DEFAULT 0,
        mode TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, symbol, exchange, mode)
      );

      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        product TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        avg_price REAL NOT NULL DEFAULT 0,
        last_price REAL,
        pnl REAL,
        mode TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, symbol, exchange, product, mode)
      );

      CREATE TABLE watchlists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        symbols TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, name)
      );

      CREATE TABLE ai_signals (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        symbol TEXT NOT NULL,
        action TEXT NOT NULL,
        score REAL,
        confidence REAL,
        rationale TEXT,
        model TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_ai_signals_symbol_time ON ai_signals(symbol, created_at);

      CREATE TABLE risk_configs (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        config TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        level TEXT NOT NULL DEFAULT 'info',
        channel TEXT NOT NULL DEFAULT 'in_app',
        read_at TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);
      CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at);

      CREATE TABLE audit_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        resource TEXT,
        detail TEXT,
        at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_log_time ON audit_log(at);

      CREATE TABLE api_health (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms REAL,
        detail TEXT,
        checked_at TEXT NOT NULL
      );
      CREATE INDEX idx_api_health_component_time ON api_health(component, checked_at);

      CREATE TABLE performance_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        mode TEXT NOT NULL,
        metrics TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_performance_user_period ON performance_reports(user_id, period_end);
    `,
  },
  {
    version: 2,
    name: 'broker_connection_state',
    sql: `
      ALTER TABLE broker_accounts ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper';
      ALTER TABLE broker_accounts ADD COLUMN live_authorized INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE broker_accounts ADD COLUMN live_authorized_at TEXT;
      ALTER TABLE broker_accounts ADD COLUMN last_probe_at TEXT;
      ALTER TABLE broker_accounts ADD COLUMN last_probe_status TEXT;
      ALTER TABLE broker_accounts ADD COLUMN last_error TEXT;
    `,
  },
  {
    version: 3,
    name: 'ai_live_order_linkage',
    sql: `
      ALTER TABLE orders ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE orders ADD COLUMN meta TEXT;
      CREATE INDEX idx_orders_origin_status ON orders(user_id, origin, status);
    `,
  },
  {
    version: 4,
    name: 'smart_notifications_and_price_alerts',
    sql: `
      ALTER TABLE notifications ADD COLUMN external_key TEXT;
      CREATE UNIQUE INDEX idx_notifications_external_key
        ON notifications(user_id, external_key) WHERE external_key IS NOT NULL;

      CREATE TABLE notification_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email_enabled INTEGER NOT NULL DEFAULT 0,
        news_enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE push_subscriptions (
        endpoint_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        subscription_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

      CREATE TABLE price_alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
        target REAL NOT NULL CHECK (target > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'triggered')),
        created_at TEXT NOT NULL,
        triggered_at TEXT,
        triggered_price REAL,
        triggered_source TEXT
      );
      CREATE INDEX idx_price_alerts_user_status ON price_alerts(user_id, status, created_at);
      CREATE INDEX idx_price_alerts_pending ON price_alerts(status, symbol);
      CREATE INDEX idx_price_alerts_scan ON price_alerts(status, id);

      CREATE TABLE notification_scan_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    name: 'official_market_calendar',
    sql: `
      CREATE TABLE market_calendar_events (
        exchange TEXT NOT NULL,
        segment TEXT NOT NULL,
        event_date TEXT NOT NULL,
        name TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('closed', 'special_session')),
        start_time TEXT,
        end_time TEXT,
        source_url TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (exchange, segment, event_date, event_type, name)
      );
      CREATE INDEX idx_market_calendar_events_date
        ON market_calendar_events (exchange, segment, event_date);

      CREATE TABLE market_calendar_sync (
        exchange TEXT NOT NULL,
        segment TEXT NOT NULL,
        calendar_year INTEGER NOT NULL,
        source_url TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (exchange, segment, calendar_year)
      );
    `,
  },
  {
    version: 6,
    name: 'ipo_feed_cache',
    sql: `
      CREATE TABLE ipo_feed_cache (
        source TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        last_updated TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 7,
    name: 'metal_paper_trading',
    sql: `
      CREATE TABLE metal_paper_accounts (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        starting_cash REAL NOT NULL DEFAULT 1000000,
        cash REAL NOT NULL DEFAULT 1000000 CHECK (cash >= 0),
        reserved_cash REAL NOT NULL DEFAULT 0 CHECK (reserved_cash >= 0),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE metal_paper_holdings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL CHECK (symbol IN ('GOLD', 'SILVER')),
        quantity_grams REAL NOT NULL DEFAULT 0 CHECK (quantity_grams >= 0),
        reserved_grams REAL NOT NULL DEFAULT 0 CHECK (reserved_grams >= 0),
        avg_price_per_gram REAL NOT NULL DEFAULT 0 CHECK (avg_price_per_gram >= 0),
        realized_pnl REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, symbol)
      );

      CREATE TABLE metal_paper_orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        symbol TEXT NOT NULL CHECK (symbol IN ('GOLD', 'SILVER')),
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT')),
        quantity_grams REAL NOT NULL CHECK (quantity_grams > 0),
        limit_price_per_gram REAL,
        execution_price_per_gram REAL,
        gross_value REAL,
        charges REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'FILLED', 'CANCELLED', 'REJECTED')),
        reject_reason TEXT,
        quote_provider TEXT,
        quote_timestamp TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        filled_at TEXT,
        cancelled_at TEXT,
        UNIQUE (user_id, idempotency_key)
      );
      CREATE INDEX idx_metal_orders_user_time ON metal_paper_orders(user_id, created_at);
      CREATE INDEX idx_metal_orders_pending ON metal_paper_orders(status, symbol, created_at);
    `,
  },
  {
    version: 8,
    name: 'price_alert_purpose',
    sql: `
      ALTER TABLE price_alerts ADD COLUMN purpose TEXT NOT NULL DEFAULT 'target'
        CHECK (purpose IN ('target', 'stop_loss', 'take_profit'));
    `,
  },
  {
    version: 9,
    name: 'forecast_predictions',
    sql: `
      CREATE TABLE forecast_predictions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        horizon_bars INTEGER NOT NULL,
        target TEXT NOT NULL,
        direction TEXT NOT NULL,
        probability REAL NOT NULL,
        base_close REAL NOT NULL,
        base_bar_time INTEGER NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'correct', 'incorrect', 'unscorable')),
        resolved_close REAL,
        resolved_bar_time INTEGER,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, symbol, horizon_bars, base_bar_time)
      );
      CREATE INDEX idx_forecast_user_created ON forecast_predictions(user_id, created_at);
      CREATE INDEX idx_forecast_pending ON forecast_predictions(status, symbol, base_bar_time);
    `,
  },
];

let singleton = null;
let migrationState = { version: 0, applied: [], lastRunAt: null, error: null };

export const getDatabasePath = () => path.resolve(process.env.CORE_DB_PATH || DB_PATH);

const applyMigrations = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = [];
  for (const migration of MIGRATIONS) {
    const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
    if (existing) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-check inside the write lock: another server process may have applied it.
      const raced = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
      if (!raced) {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, new Date().toISOString());
        applied.push(migration.version);
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore rollback failure */ }
      throw error;
    }
  }
  const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0;
  migrationState = { version, applied, lastRunAt: new Date().toISOString(), error: null };
  return migrationState;
};

const createHandle = (db, file) => {
  let closed = false;
  const handle = {
    file,
    raw: db,
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    query: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
    transaction: (fn) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(handle);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* ignore rollback failure */ }
        throw error;
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
      if (singleton === handle) singleton = null;
    },
  };
  return handle;
};

export const openDatabase = ({ file = getDatabasePath(), migrate = true } = {}) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  if (migrate) applyMigrations(db);
  return createHandle(db, file);
};

export const getDatabase = () => {
  if (!singleton) singleton = openDatabase();
  return singleton;
};

export const closeDatabase = () => {
  if (singleton) singleton.close();
};

export const migrationStatus = () => ({ ...migrationState, latest: MIGRATIONS[MIGRATIONS.length - 1].version });

export const databaseHealth = () => {
  const startedAt = Date.now();
  try {
    const db = getDatabase();
    const integrity = db.get('PRAGMA integrity_check');
    const version = db.get('SELECT MAX(version) AS version FROM schema_migrations')?.version || 0;
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((row) => row.name);
    return {
      ok: integrity?.integrity_check === 'ok',
      engine: 'SQLite (node:sqlite) with WAL journal and foreign keys',
      file: db.file,
      schemaVersion: version,
      tables: tables.length,
      latencyMs: Date.now() - startedAt,
      ...migrationStatus(),
    };
  } catch (error) {
    return {
      ok: false,
      engine: 'SQLite (node:sqlite)',
      file: getDatabasePath(),
      error: error.message,
      latencyMs: Date.now() - startedAt,
    };
  }
};
