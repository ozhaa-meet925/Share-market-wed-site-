# Database & Migrations

The trading core uses SQLite through Node's built-in `node:sqlite` (`DatabaseSync`) — no native build step. The schema is deliberately portable so the same tables can move to PostgreSQL; keep SQL free of SQLite-only constructs when extending it.

- Default file: `data/core/platform.sqlite` (override with `CORE_DB_PATH`).
- Pragmas on open: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Access is synchronous through the wrapper in `serverDb.js`: `db.run`, `db.get`, `db.query`, `db.transaction(fn)`.
- Writes that change order state use `db.transaction` → `BEGIN IMMEDIATE`, so failures roll back completely.
- Schema changes are append-only migrations registered in `MIGRATIONS` with an integer `version`. Applied versions are recorded in `schema_migrations`; the server refuses to start if a migration fails.

## Version 1 — initial trading schema

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `users` | Account identity mirrored from auth | `phone` unique; role, KYC status |
| `broker_accounts` | Per-user broker link | Unique `(user_id, broker)`; encrypted token columns |
| `strategies` | Strategy definitions | FK to user |
| `orders` | Normalized broker/paper orders | Unique `idempotency_key`; side and mode checks; broker order index |
| `order_events` | Append-only order state history | Auto-increment `seq`; FK cascade |
| `trades` | Fills | Unique `(order_id, broker_trade_id)` |
| `holdings` | Delivery holdings | Unique `(user_id, symbol, exchange, mode)` |
| `positions` | Intraday/positional exposure | Unique `(user_id, symbol, exchange, product, mode)` |
| `watchlists` | Named watchlists | Unique `(user_id, name)` |
| `ai_signals` | Signal history | Indexed by symbol/time |
| `risk_configs` | Per-user risk settings | PK `user_id` |
| `notifications` | In-app notifications | Indexed by user and unread state |
| `audit_log` | Reserved for a DB projection of the audit trail | `prev_hash` + `hash`; indexed by time |
| `api_health` | Health probe history | Indexed by component/time |
| `performance_reports` | Stored performance snapshots | Indexed by user/period |

## Version 2 — broker connection state

Adds to `broker_accounts`: `mode` (`paper|sandbox|live`), `live_authorized`, `live_authorized_at`, `last_probe_at`, `last_probe_status`, `last_error`.

## Encryption

Access and refresh tokens are encrypted with AES-256-GCM before insertion. The key comes from `BROKER_TOKEN_KEY`; it is never stored in the database. If the key is missing or changed, tokens cannot be decrypted and the API returns `token_unreadable` instead of guessing — the user must reconnect the broker.

## Audit trail

The operative audit trail is the append-only file `data/core/core-audit.jsonl`, one JSON object per line. Each entry stores `seq`, `prevHash` and `hash` (SHA-256 over `prevHash|canonical-entry`), so editing, deleting or reordering a line breaks verification. `audit_log` in SQLite is reserved for a future projection and is not written today.

- Writes take an exclusive `data/core/core-audit.lock`; the sequence number and previous hash are read from the file while the lock is held, never from process memory. This keeps two server processes that share a data directory on one chain. Locks older than 10 s, or held by a dead PID, are reclaimed.
- Verify with `GET /api/core/audit/verify` or `node -e "import('./serverCoreAudit.js').then(m => console.log(m.verifyAudit()))"`.
- Never hand-edit the file. `verifyAudit()` reports the first `brokenAt` sequence number if the chain is broken.

## Backup and retention

1. Stop the server (or use `sqlite3 .backup`) before copying `platform.sqlite`.
2. Copy the database and `data/auth-secret` together; the auth cookie and OAuth state HMAC depend on the secret.
3. `order_events` and `data/core/core-audit.jsonl` are retention-sensitive; export them before pruning. Do not edit rows or lines directly.
4. Test restores in a separate `CORE_DB_PATH` before relying on them.

## Moving to PostgreSQL

The wrapper isolates dialect differences. Required work: swap the driver, translate `INTEGER PRIMARY KEY AUTOINCREMENT` to identity columns, move `BEGIN IMMEDIATE` to `BEGIN`, and keep timestamps as UTC ISO strings. No query currently depends on SQLite-specific JSON functions.
