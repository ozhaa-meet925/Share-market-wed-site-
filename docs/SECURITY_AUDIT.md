# Security Audit — ShareMarket Pro

Scope: authentication, session handling, broker credentials, order authorization, HTTP hardening, data at rest, logging and test coverage. Method: source review plus live header and endpoint checks on 2026-11-05. This is a code and configuration review, not a penetration test.

## 1. Controls implemented

| Area | Control | Where |
| --- | --- | --- |
| Authentication | OTP (6 digits) then 4-digit PIN; login requires a server-signed `verificationToken`, so a PIN alone cannot log in | `serverAuth.js` |
| PIN storage | `scrypt` hash with per-user salt; comparisons use `crypto.timingSafeEqual` | `serverAuth.js` |
| Session | HMAC-signed HttpOnly cookie, `SameSite=Lax`, `Secure` when TLS is detected; session version allows global logout | `serverAuth.js` |
| CSRF | SameSite cookie plus `Origin`/`Referer` validation on mutating methods | `serverSecurity.js` |
| Rate limiting | Global per-IP API limiter (default 900/min, `API_RATE_LIMIT_PER_MIN`); stricter in-memory limits on OTP, verify, login, register, PIN change, scans and config saves | `serverSecurity.js`, `serverAuth.js` |
| Headers | CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS behind TLS, `x-powered-by` disabled | `serverSecurity.js` |
| API caching | `Cache-Control: no-store` on API responses | `serverSecurity.js` |
| Broker OAuth | HMAC-signed state with nonce, 10-minute TTL, single use, bound to user and broker | `serverBrokerRoutes.js` |
| Broker tokens | AES-256-GCM encrypted at rest; key from `BROKER_TOKEN_KEY`; never returned to the browser | `serverBrokerStore.js` |
| Order authorization | Three independent gates (server flag, per-account consent, per-request `live:true`) plus open-session, Risk Shield and idempotency checks | `serverBrokerRoutes.js` |
| Order recovery | Uncertain outcomes become `unverified`, are reconciled against the broker order book, and are never automatically resubmitted | `serverBrokerReconcile.js` |
| Postbacks | Timing-safe token comparison | `serverBrokerRoutes.js` |
| Audit | Hash-chained JSONL audit log with a verification endpoint; risk and order decisions are recorded; appends are serialised across processes with a lock file and a stale-lock reclaim | `serverCoreAudit.js` |
| Notifications | Persisted per user; queries are scoped by `user_id` | `serverNotifications.js` |
| Secrets | Read from environment only; `.env`, runtime state and logs are gitignored; compliance and health responses contain names, never values | `.gitignore`, `serverCompliance.js` |
| Transport | HSTS emitted for secure requests; production deployment should terminate TLS at the proxy | `serverSecurity.js` |

## 2. Residual findings

| Severity | Finding | Impact | Recommended action |
| --- | --- | --- | --- |
| Medium | Demo OTP is returned by the API when demo delivery is active. Production hides it unless `AUTH_SHOW_DEMO_OTP=1`, but the flag is operator-controlled. | Phone ownership proof can be bypassed in a careless deployment. | Integrate an SMS provider, keep `NODE_ENV=production`, and never set `AUTH_SHOW_DEMO_OTP` outside local tests. |
| Medium | Rate limits are in-memory and per process. | Restarts clear them; multi-process deployments multiply the effective limit. | Move counters to Redis/PostgreSQL when running more than one process. |
| Medium | Broker access tokens have no automatic refresh scheduler. Upstox refresh support exists, but rotation is manual/reconnect-driven. | Expired tokens cause `token_invalid` until the user reconnects. | Add a scheduled refresh with revocation handling and alerting. |
| Medium | CSRF protection relies on SameSite + Origin checks rather than per-request tokens. | Adequate for same-origin JSON APIs, weaker if a subdomain is compromised. | Add double-submit CSRF tokens for broker and payment mutations. |
| Medium | No MFA beyond OTP + PIN. | Account takeover risk if a phone and PIN are both compromised. | Add TOTP/passkey as an optional second factor. |
| Low | Role model is coarse (`viewer`, `trader`, `admin`); no admin UI or admin-only operations. | No privilege escalation path today, but future admin endpoints need explicit guards. | Add per-resource authorization when admin surfaces are built. |
| Low | Logs may contain user ids, symbols and error messages. | Operational visibility is good; sensitive payloads should stay out. | Rotate logs, avoid request-body logging, restrict access. |
| Low | `data/auth-secret` and the SQLite file rely on filesystem permissions. | Local compromise exposes session signing and encrypted-token material. | Run as a dedicated user, restrict permissions, encrypt the volume. |

## 3. Live checks performed

- Unauthenticated `/api/brokers/:broker/orders/:id/modify` → `401 not_authenticated`.
- Authenticated with no broker connection → `409 broker_not_connected`; no order is created.
- `/api/brokers` → `liveTradingEnabled:false`, `orderPlacement:false` in paper mode.
- `/api/compliance/status` returns provider names and missing env keys but no secret values (covered by an automated test that checks actual env values are absent).
- Response headers include CSP, nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy, COOP and CORP.
- Audit chain verification endpoint returns valid after the test suite and manual operations. Two processes writing concurrently into a shared data directory produced 120 sequential entries with no fork, then the live chain verified at 135 entries.

## 4. Accepted limitations

- No real broker sandbox test was possible: no Upstox/Kite credentials and the existing Upstox read-only token is rejected upstream.
- No load test, fuzzing or third-party penetration test has been run.
- The LLM, if enabled, receives market context only; it has no tool access to order routes by design.
- Live trading is disabled by default and no real order has been placed by this project.
