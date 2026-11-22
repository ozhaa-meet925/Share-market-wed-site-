# ShareMarket Pro — Platform Audit

Date: 2026-11-05
Scope: existing React 19 + Vite 7 + Express 4 ESM application in this repository, its data stores, providers and test suite.
Method: source inspection, live endpoint probing against the running server (`:4000`, `:3001`), headless-browser walkthrough of authenticated routes, and execution of the automated test suite. Nothing in this report is inferred from marketing copy; each claim lists how it was checked.

---

## 1. Snapshot

| Item | Value |
| --- | --- |
| Frontend routes | 43 (React Router) |
| Backend endpoints | 83 (`server*.js`) |
| Persistence | JSON document stores only (`data/`, `data/core/`) |
| Live broker trading | Not implemented |
| Live market quotes | Not available (no valid live provider token) |
| Delayed research quotes | Available (Yahoo Finance via yfinance) |
| Automated tests | 8 (backend core services only) |
| CI/CD | None |
| API documentation | None (README only) |
| Admin dashboard | None |

Verified this session: `npm test` → 8/8 passed; `vite build` clean; `/`, `/ai-trading`, `/portfolio`, `/security`, `/ai-core`, `/markets` rendered authenticated with no console errors; core endpoints returned 200; audit chain verified; health monitor healthy.

---

## 2. Working features (present and reachable)

**Market & research**
- Home, Live Terminal, Markets, Nifty, Sensex, Stocks, All Stocks, Stock details, Compare, Screener, Top Gainers/Losers.
- Candlestick history with multiple resolutions, provider fallback chain, and explicit "unavailable" states when a provider cannot answer.
- Delayed Yahoo research quotes, labelled `Research · not live`; the UI never presents them as live.
- Market depth is real when a live provider exists, otherwise `503` with a reason (`/api/market/depth`). Trade tape returns an explicit `503` — no fabricated tape.
- Commodities (COMEX × INR), gold/silver with spot fallback, mutual funds (Upstox scheme feed), IPO listings with NSE fallback, news (Google News RSS), calendars (NSE keyless feeds for earnings/holidays/expiries).

**Accounts & trading**
- OTP → PIN login, registration, logout-all-devices, Security Centre, PIN change.
- Session cookie is HttpOnly, SameSite=Lax, `Secure` when served over HTTPS; mutating requests are origin-checked; PINs are scrypt-hashed with timing-safe comparison; auth endpoints are rate-limited.
- Portfolio, watchlists, orders and paper-trading state sync to the signed-in account (`/api/me/*`).
- Server-side paper auto-trader with watchlist, signal scoring, stop-loss/target/trailing logic, backtest, pause/resume, and an audit trail.
- Upstox IPO application OAuth flow with an encrypted HttpOnly token cookie (AES-256-GCM, requires `IPO_SESSION_SECRET`).

**AI Core (built and verified this session)**
- Super Brain deterministic five-model ensemble with confidence, uncertainty and data-quality scoring.
- Risk Shield independent pre-trade gate, risk-based sizing, kill switch (reason required, audited).
- Smart Recovery idempotent intents, exponential backoff, restart recovery, reconciliation without resubmission.
- Performance Score with cost-adjusted metrics and 70/30 walk-forward (verdicts can honestly be "inconclusive").
- 24/7 health monitor (API, store, feed, realtime, CPU/memory/event loop), incidents, SSE and WebSocket.
- Hash-chained audit log with tamper detection.

---

## 3. Currently unavailable / broken (with evidence)

| Feature | Status | Evidence / cause |
| --- | --- | --- |
| Live NSE quotes | Unavailable | `/api/health` → `providerConnected:false`, `configuredProvider:"kun"`, setup required |
| Upstox live quotes / MCX metals | Unavailable | `/api/provider` → `configured:true, tokenValid:false`; logs show `401` on metal quote and IPO feed |
| Upstox IPO listings | Degraded | Falls back to official NSE feed; labelled on screen |
| Zerodha integration | Not configured | `configured:false`; code contains read-only quote calls only, no order endpoints |
| Groww | Not configured | `configured:false`; quote/depth adapters exist |
| Alpha Vantage history | Not configured | `configured:false` |
| Economic calendar | Unavailable (HTTP 503) | Requires `FINANCE_CALENDAR_API_KEY` or a valid FMP key; current FMP key is rejected |
| Email notifications | Not implemented | Code states SMTP transport is not implemented |
| Time & sales tape | Unavailable by design | Explicit HTTP 503 |
| Payment endpoints | Not configured | No Razorpay keys present in the environment |
| LLM explanations | Rules-based only | No LLM key configured; explanations are computed, not generated |

---

## 4. Missing versus the production target

1. **Broker trading adapters** — no Kite/Upstox order placement, modification, cancellation, order book, trade book, holdings/positions sync, GTT, postbacks, funds/margins, or token lifecycle. Upstox read-only quotes and IPO applications are the only broker write path, and the token is invalid.
2. **Real database** — no SQL schema, migrations, transactions or row-level isolation. Users, paper accounts, orders, audits and risk configs live in JSON files.
3. **Live trading** — intentionally disabled; there is no verified broker execution path. This matches the current safety policy.
4. **Notifications** — in-app plus a test endpoint only; no email or push delivery.
5. **Admin / system monitoring UI** — health exists inside AI Core, but there is no admin dashboard, user management or system-monitoring page.
6. **Broker connections & subscription management** — no UI, no plans/billing state.
7. **Strategy builder** — the auto-trader exposes settings and indicators, but users cannot define arbitrary entry/exit conditions.
8. **Financial statements / full fundamentals** — partial; some responses return `financials: null` and link out instead.
9. **Testing** — only 8 backend unit tests. No frontend, API-contract, E2E, security, or load tests; no CI pipeline or deployment gates.
10. **API documentation** — no OpenAPI/spec; env template exists (`.env.example`).
11. **Rate limiting** — auth routes only. Expensive public routes (quotes, history, AI evaluate/watchlist, walk-forward) have caches/cooldowns but no global per-IP limit.

---

## 5. API / provider status

| Provider | Used for | Integration | Auth | Last check | Limitation |
| --- | --- | --- | --- | --- | --- |
| Yahoo Finance (yfinance) | Research quotes/history | Working | None | 2026-11-05 | Delayed/stale, not licensed real-time |
| Kunpeng (KUN) | Live quotes/stream | Not connected | Token missing | 2026-11-05 | Requires authorized NSE token |
| Upstox | Quotes, metals, IPOs, IPO apply | Configured, **invalid token** | Bearer/OAuth | 2026-11-05 | 401; token must be regenerated |
| Zerodha Kite | Read-only quotes | Not configured | API key/token | 2026-11-05 | No trading endpoints implemented |
| Groww | Quotes, depth | Not configured | Bearer | 2026-11-05 | Requires Groww credentials |
| Alpha Vantage | Historical candles | Not configured | API key | 2026-11-05 | Optional fallback |
| NSE India (keyless) | Earnings, holidays, expiries, IPO fallback | Working | None | 2026-11-05 | Official public pages; rate-limited upstream |
| Google News RSS | Market news | Working | None | 2026-11-05 | Headlines only, no licensed terminal news |
| FMP / Finance Calendar | Economic calendar | **Rejected** | API key | 2026-11-05 | 503 until a valid key is configured |
| Gemini / LLM | Conversational AI | Not configured | API key | 2026-11-05 | Rules-based answers only |
| SMTP | Email alerts | Not implemented | — | — | No transport |
| Razorpay | Payments | Not configured | Keys | — | Endpoints present, unusable without keys |

---

## 6. Database and storage

- JSON files: `data/users.json`, `data/autotrade.json`, `data/core/*.json`, `data/core/core-audit.jsonl`.
- Writes use temp-file + rename with `.bak` fallback reads — good crash resilience for single-process use, but **not** a database: no transactions, no concurrent-writer safety across processes, no schema migrations, no queries, no row-level access control.
- Audit log is append-only, hash-chained and tamper-evident (verified).
- Sensitive material at rest: `data/auth-secret` (HMAC key) and `users.json` (scrypt PIN hashes) are plain files with default permissions. Broker tokens are not stored server-side for trading (only the encrypted IPO session cookie).

---

## 7. Security findings

| Severity | Finding | Detail |
| --- | --- | --- |
| High | Demo OTP returned by API | `/api/auth/otp/request` returns `demoOtp` unless `AUTH_HIDE_DEMO_OTP=1`. Acceptable for local testing, unacceptable in production; phone verification can be bypassed. Existing-account login still requires the 4-digit PIN, which is rate-limited. |
| High (operational) | Invalid live provider token | Upstox token is expired/invalid and currently 11 characters. All live claims correctly degrade, but an operator must rotate it before any live-data work. |
| Medium | No global rate limiting | Public quote/history/AI routes can be hammered; cost and upstream-ban risk. |
| Medium | No CSP header | React escapes output and frame/opener policies exist, but there is no Content-Security-Policy defense-in-depth. |
| Medium | No encryption at rest for JSON stores | PIN hashes are salted/scrypt; audit and account data are plaintext. A future broker-token store needs envelope encryption and key management. |
| Medium | CSRF relies on SameSite + Origin check | No per-request CSRF token; acceptable for same-origin JSON APIs but worth strengthening for broker actions. |
| Low | Roles are coarse | `viewer/trader/admin` exist in the auth model, but no admin-only operations or admin UI are wired. |
| Low | Project hygiene | 34 screenshot PNGs, logs, temp files, unused `Calder.jsx`, a 174 MB `.venv-yfinance`, and `.env` live inside the project folder. No git repository, so no history leak today; a future repo must ignore all of these. |

Positive controls verified: `x-powered-by` disabled, nosniff, SAMEORIGIN framing, Referrer-Policy, Permissions-Policy, COOP, HSTS on HTTPS, HttpOnly session cookie with `Secure` behind TLS, origin check on POST/PUT/PATCH/DELETE, scrypt PIN hashing with `timingSafeEqual`, auth rate limits, encrypted broker cookie, audit chain verification.

---

## 8. Code hygiene

- One unused page (`src/pages/Calder.jsx`).
- Large monolithic `server.js` (4,654 lines) mixing providers, auth, market data, IPOs, payments and AI routes; the new core services are properly separated, the legacy routes are not.
- Duplicated provider-selection logic across quote/history/depth endpoints.
- 34 root-level PNGs and several log/tmp files that should not ship.
- `api/index.js` is a 5-line Vercel bridge into `server.js` — fine, but it means every endpoint runs in one function.

---

## 9. Compliance and licensing

- Yahoo Finance research data is **not** a licensed real-time market-data feed; it must remain labelled delayed.
- Enabling broker order placement for the public requires broker API terms review, exchange approval for algorithmic trading, SEBI retail-algo requirements, and market-data licensing. A broker API key alone does **not** authorize a public multi-user trading platform.
- No real order has been placed by this project; live trading remains disabled by policy.

---

## 10. Recommended sequence

**M0 — Security & hygiene (no new features):** production OTP delivery gate, global rate limits, CSP, remove dead files/screenshots from deploy output, `.gitignore`, rotate the invalid Upstox token (operator action), document env keys.

**M1 — Data layer:** introduce a real database (SQLite for single-node, PostgreSQL for production) with migrations for users, broker accounts, encrypted tokens, orders, trades, holdings, positions, watchlists, strategies, signals, risk configs, notifications, audit and health; migrate JSON stores behind a repository layer; wrap order/position writes in transactions.

**M2 — Broker abstraction:** a provider interface shared by Kite and Upstox (auth, token lifecycle, profile, funds, instruments, quotes, history, holdings, positions, order book, trade book). Start read-only with the Upstox sandbox; every order method stays behind a hard feature flag.

**M3 — Order engine & recovery:** verified order state machine, idempotency, partial fills, postbacks, reconciliation, explicit "unverified" state on timeout, no blind resubmission.

**M4 — Notifications & authorization:** email/push delivery, order lifecycle alerts, two-step explicit live-trading authorization, kill switch integrated at the broker boundary.

**M5 — Product surfaces:** broker connections, admin/system monitoring, subscription management, strategy builder, fundamentals.

**M6 — Quality gates:** unit, integration, API contract, E2E, security and load tests; CI that blocks deployment on failure; OpenAPI docs; deployment checklist.

---

## 11. Honest limits of this audit

- No live broker sandbox test was possible: Upstox token is invalid and no Kite credentials exist.
- No penetration test or load test was run; security findings are code-review based.
- Frontend verification covered the main routes at desktop and 390 px; it did not click every button on all 43 routes.
- The JSON store is single-process safe; multi-process/concurrent-writer safety was not tested.

---

## 12. Remediation status (2026-11-05)

Implemented after this audit, module by module. Findings above remain as the historical baseline.

| Module | Delivered | Evidence |
| --- | --- | --- |
| M0 Security & hygiene | CSP, global API rate limiter, production OTP gate, `.gitignore`, secret scan in CI | `serverSecurity.js`, `tests/security.test.js`, `.github/workflows/ci.yml` |
| M1 Data layer | SQLite with WAL, versioned migrations, transactions, encrypted broker tokens, order/event/trade/notification schema | `serverDb.js`, `docs/DATABASE.md`, `tests/db.test.js` |
| M2 Broker adapters | Upstox and Kite OAuth, signed state, profile, funds, holdings, positions, quotes, history, orders, trades, place/modify/cancel, postbacks | `serverBrokers/`, `serverBrokerRoutes.js`, `tests/broker.test.js` |
| M3 Order engine & recovery | Idempotency, transactional order writes, Risk Shield on live orders, `unverified` state, 90 s reconciler, in-app notifications | `serverRiskShield.js`, `serverBrokerReconcile.js`, `serverNotifications.js`, `tests/orders.test.js` |
| M4 Transparency | Compliance/data-source endpoint and page with honest provider/broker states | `serverCompliance.js`, `src/pages/Compliance.jsx`, `tests/compliance.test.js` |
| M5 Product surface | Broker Connections page plus gated live order desk (place, quote check, modify, cancel, consent) | `src/pages/BrokerConnections.jsx`, `BrokerConnections.css` |
| M6 Quality gates & docs | CI (tests, build, secret scan, deployment gate); API reference, integration report, security audit, performance report, test report, deployment guide | `.github/workflows/ci.yml`, `docs/` |

Test suite: **51 / 51 passing**. Frontend build: clean. Live routing: **disabled by default**, triple-gated, and no real order has been placed.

Final regression found that two server processes sharing `data/core/` could fork the hash-chained audit log: each cached the last sequence in memory and appended without a lock. The write path now takes `core-audit.lock`, re-reads the last entry under the lock, and reclaims stale locks; the forked log was repaired to its longest valid chain (three orphaned lines removed, backup kept). Verified with 120 concurrent cross-process writes and a live chain of 135 entries, and the `/ai-core` page now renders with no duplicate-key warnings.

### Remaining operator actions

1. Supply Upstox/Kite OAuth credentials and a persistent `BROKER_TOKEN_KEY`, then verify sandbox orders before any live routing.
2. Rotate the expired Upstox read-only market-data token.
3. Configure an SMS provider before public sign-ups (demo OTP is gated but not delivery).
4. Configure a licensed real-time market-data provider if live quotes are required; keep Yahoo research data labelled delayed.
5. Obtain broker/exchange/SEBI approvals before enabling `LIVE_TRADING_ENABLED=1`, and review broker API terms for multi-user use.
6. Add PostgreSQL and move rate limits to shared storage before running multiple processes.
7. Add code-splitting to reduce the 1.16 MB main JS bundle (see `docs/PERFORMANCE.md`).

### Not claimed

- No live broker sandbox integration test was possible without credentials.
- Email/push notifications, broker streaming feed decoders, GTT, and instrument master downloads remain unimplemented and are reported honestly as unsupported.
- Investing.com is not integrated; nothing is scraped.
