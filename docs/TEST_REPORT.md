# Test Report

Run date: 2026-11-05. Command: `npm test` (`node --test`). Result: **63 / 63 passing, 0 failing**.

| Suite | Tests | Coverage focus |
| --- | --- | --- |
| `tests/core.test.js` | 10 | Super Brain ensemble output, Risk Shield decisions, kill switch, recovery idempotency, performance scoring, audit chain integrity and cross-process serialisation, health monitor. |
| `tests/security.test.js` | 7 | API no-store, HSTS gating, trust-proxy parsing, global API rate limiter burst/reset, demo OTP production gating, session validation helpers. |
| `tests/db.test.js` | 6 | Migration application and versioning, WAL/foreign keys, transactional rollback, order + event writes, query helpers, re-open idempotency. |
| `tests/broker.test.js` | 7 | Adapter configuration honesty, OAuth state signing, AES-GCM token round-trip and tamper rejection, paper-mode order refusal, quote normalization, capability flags. |
| `tests/orders.test.js` | 8 | Live Risk Shield approve/block matrix, decision persistence, notification feed and unread counts, email configuration honesty (`not_configured` without SMTP), route registration for place/modify/cancel and notification read/test-email, status normalization, reconciliation `unverified → filled` without resubmission. |
| `tests/liveExecution.test.js` | 11 | Verified entry mirroring, partial fills, rejected orders, uncertain responses recorded `unverified` with no resubmit, stale-quote blocking, duplicate/kill-switch Risk Shield blocks, exit P&L after charges, `broker_flat` exits, broker-book reconciliation without resubmission, broker-side cancellation of unfilled entries, readiness blocker reporting. |
| `tests/compliance.test.js` | 5 | Live routing disabled by default, both brokers reported, Investing.com marked not integrated, no secret values leak, required disclosures, route registration. |
| `tests/nseIndex.test.js` | 5 | NSE allIndices rows normalise to exchange quotes with IST timestamps, live only while the session is open and the feed is under two minutes old, close/stale labelling, unknown rows skipped. |
| `tests/researchQuote.test.js` | 4 | Research quotes from the last session are labelled as close outside market hours, genuinely old quotes stay stale, intraday quotes go stale after 30 minutes, global quotes never inherit the Indian close label. |

## Manual and browser verification

| Area | Method | Result |
| --- | --- | --- |
| Broker Connections (desktop 1440, mobile 390) | Headless Chrome, authenticated session | Honest "Not Connected" states, missing env keys listed, Connect disabled when unconfigured, order desk visible and disabled with "Connect … before trading", no console errors, no horizontal overflow. |
| Compliance page (desktop/mobile) | Headless Chrome | Live routing banner, broker gating, data-source badges (`Available`, `Not Configured`, `Not Integrated`), six disclosures, footer link, no console errors, no overflow. |
| Notifications | Headless Chrome + live API | In-app feed renders with channel support pills; unread styling and mark-all-read work; email reports `not configured` with the missing SMTP variables and `test-email` returns 503; push labelled unsupported. |
| AI Trading live readiness | Browser (production preview) + live API | Paper dashboard keeps its positions and shows `PAPER ACCOUNT`; opening "Enable live execution" shows seven readiness checks with real fail/pass states and a disabled confirmation button; `/api/autotrade/readiness` reports missing `LIVE_TRADING_ENABLED`, credentials, non-paper mode, session and consent instead of claiming readiness. |
| Risk Shield on live orders | Unit tests + live API probes | Missing session → 401, no broker connection → 409, live flag off → 403; no order row is created when a gate fails. |
| Order modify/cancel endpoints | Unit route test + live 401/409 probes | Routes exist and remain gated by master switch + consent. |
| AI Core audit table | Headless Chrome, authenticated session | Chain verifies at 135 entries, 40 rendered rows have unique sequence keys (25 in view), no duplicate-key or console errors. |
| Audit concurrency | Three child processes writing 45 entries into one data dir | 45 sequential entries, no fork, lock released; manual two-process run added 120 entries to a clean dir. |

## Evidence of the no-fake policy

- Unconfigured brokers report `Not Connected` and never render fabricated profile/funds data.
- Market-data endpoints return `503` with a reason instead of synthesized quotes when a live feed is missing.
- Order desk buttons are disabled with an explicit reason, not hidden behind a fake success.
- Email and push channels are reported unsupported with the missing dependency.

## Gaps

- No live broker sandbox test: no Upstox/Kite credentials were available and the existing Upstox read-only token is rejected upstream.
- No load test, fuzzing or third-party penetration test.
- No automated frontend component test suite; verification used headless-browser walkthroughs plus build checks.
- Economic-calendar and email delivery paths cannot be exercised until their provider keys/transport exist.

## Reproduce

```bash
npm install
npm test
npx vite build
PORT=4000 node server.js
```

Tests use a temporary `CORE_DATA_DIR` and `CORE_DB_PATH`; they never touch production data.
