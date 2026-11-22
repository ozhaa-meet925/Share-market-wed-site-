# ShareMarket Pro — HTTP API Reference

Base path: `/api`. Requests and responses are JSON unless noted. The production server (`node server.js`, `PORT=4000`) serves the built frontend and these routes from one origin. In development the Vite server (`:5173`) proxies `/api` to the API server (`:3001`).

This document lists the implemented contract. It is a reference, not an OpenAPI schema; every route below exists in `server.js` or a `server*.js` module.

---

## Authentication

Sessions use an HttpOnly, SameSite=Lax cookie named `sm_session` (HMAC-signed). Send it with every authenticated request; browsers do it automatically for same-origin `fetch` with `credentials: 'same-origin'`.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/api/auth/otp/request` | `{ phone }` | Sends an OTP. In demo mode the response includes `demoOtp`; production hides it unless `AUTH_SHOW_DEMO_OTP=1`. |
| POST | `/api/auth/otp/verify` | `{ phone, code }` | `{ verificationToken }` valid for 10 minutes. The token proves phone ownership. |
| POST | `/api/auth/register` | `{ name, phone, pin, pan, bank, accountNumber, ifsc, verificationToken }` | Creates the account and issues the session. |
| POST | `/api/auth/login` | `{ phone, pin, verificationToken }` | Issues the session. A PIN alone is not accepted. |
| POST | `/api/auth/logout` | — | Clears the session cookie. |
| GET | `/api/auth/me` | — | `{ user }` or `{ user: null }`. |
| GET | `/api/auth/security` | — | Session metadata, last login, security events. |
| POST | `/api/auth/security/pin` | `{ currentPin, newPin }` | Rotates the PIN. Rate-limited to 5 attempts / 15 minutes. |
| POST | `/api/auth/security/logout-all` | — | Invalidates every session for the account. |

Rate limits (in memory, per IP + identifier): OTP request 5 / 15 min, OTP verify 10 / 15 min, login 10 / 15 min, register 10 / hour, PIN change 5 / 15 min.

### Account state

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/me/watchlist` | — | `{ symbols }` |
| PUT | `/api/me/watchlist` | `{ symbols: string[] }` | Replaces the signed-in watchlist. |
| GET | `/api/me/paper` | — | `{ state }` paper-trading state. |
| PUT | `/api/me/paper` | `{ state }` | Persists paper state for the account. |

---

## Error envelope

```json
{ "error": "Human-readable message.", "code": "machine_readable_code", "broker": "upstox" }
```

`code` is stable; `broker` appears on broker errors. Broker adapter errors also include `retryable`. Common codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `not_authenticated` | 401 | No valid session. |
| `invalid_phone`, `invalid_otp`, `invalid_pin`, `phone_not_verified` | 400/401 | Authentication input rejected. |
| `*_rate_limited` | 429 | Rate limit hit. Response includes `Retry-After`. |
| `unknown_broker` | 404 | Broker id is not `upstox` or `zerodha`. |
| `broker_not_connected` | 409 | No stored token for this user and broker. |
| `token_unreadable` | 409 | Stored token cannot be decrypted with `BROKER_TOKEN_KEY`. |
| `live_trading_disabled` | 403 | `LIVE_TRADING_ENABLED` is not `1`. |
| `live_consent_required` | 403 | Account has not granted live consent. |
| `live_confirmation_missing` | 400 | Body did not include `live: true`. |
| `market_closed` | 409 | Outside 09:15–15:30 IST on a weekday. |
| `risk_blocked` | 403 | Risk Shield rejected the order; `checks[]` explains why. |
| `idempotency_key_required` | 400 | Missing or short `idempotencyKey`. |
| `confirmation_required` | 400 | Typed confirmation phrase was not supplied. |
| `broker_request_failed` | 502/409 | Upstream broker rejection. Check `message` and `retryable`. |

All API responses are sent with `Cache-Control: no-store`.

---

## Market data

| Method | Path | Query / body | Notes |
| --- | --- | --- | --- |
| GET | `/api/stock/quote` | `symbol` | Single delayed/research or provider quote. Response labels its source and freshness. |
| GET | `/api/stock/batch` | `symbols` (comma list) | Batch quotes. |
| GET | `/api/stock/history` | `symbol`, `interval`, `range` | OHLC candles from the configured provider chain. |
| GET | `/api/stock/stream` | `symbols` | SSE stream of provider updates when a live feed is configured. |
| GET | `/api/stocks/list` | — | Instrument universe used by search/screener. |
| GET | `/api/market/depth` | `symbol` | Live depth only; returns `503` with a reason when no live feed exists. |
| GET | `/api/market/tape` | `symbol` | Time & sales. Returns `503` by design; no tape is fabricated. |
| GET | `/api/health` | — | Provider health and configuration summary. |
| GET | `/api/provider` | — | Configured quote provider and token validity (no secrets). |

Provider selection is server-side (`MARKET_DATA_PROVIDER`). Research data from Yahoo/yfinance is always presented as delayed research, never as live exchange data.

### Supporting content

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/ipos` | Free, keyless NSE India live IPO listings; responses identify the source and stale-cache state. |
| GET | `/api/ipo/:company` | IPO details from NSE India, with Upstox details available for Upstox-specific records. |
| GET | `/api/ipo/auth/connect`, `/api/ipo/auth/status`, `/api/ipo/auth/callback` | Per-user OAuth for IPO applications. |
| GET | `/api/ipo/orders`, POST `/api/ipo/apply` | Requires the encrypted IPO session cookie. |
| GET | `/api/mutual-funds/schemes`, `/search`, `/:schemeCode/latest`, `/:schemeCode/nav` | AMFI end-of-day NAV. |
| GET | `/api/calendar` | NSE keyless calendars; economic tab requires a licensed key. |
| GET | `/api/news/market`, `/api/news/mutual-funds` | Headline feeds. |
| POST | `/api/payments/order`, `/api/payments/verify` | Present but unconfigured without Razorpay keys. |

---

## Brokers

All broker routes require a session. Tokens never travel to the browser.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/brokers` | Adapter list, capabilities, connection state, live master switch, reconciler state. |
| GET | `/api/brokers/:broker/login-url` | Signed OAuth state + broker authorization URL. |
| GET | `/api/brokers/:broker/callback` | OAuth redirect target. Exchanges the code and stores encrypted tokens. |
| POST | `/api/brokers/:broker/probe` | Calls the broker profile endpoint and records latency/health. |
| POST | `/api/brokers/:broker/disconnect` | Deletes stored tokens and revokes live consent. |
| GET | `/api/brokers/:broker/account` | Profile + funds. |
| GET | `/api/brokers/:broker/portfolio` | Holdings + positions. |
| GET | `/api/brokers/:broker/orders` | Order book + trade book, then reconciles local unverified orders. |
| POST | `/api/brokers/:broker/reconcile` | Manual reconciliation against the broker order book. |
| GET | `/api/brokers/:broker/quotes` | REST quotes for up to 100 instrument keys. |
| GET | `/api/brokers/:broker/history` | Historical candles. |
| POST | `/api/brokers/:broker/live-consent` | `{ enabled, confirmation }`. Enabling requires typing `ENABLE LIVE TRADING` and server routing enabled. |

### Order placement

`POST /api/brokers/:broker/orders`

```json
{
  "live": true,
  "side": "BUY",
  "quantity": 10,
  "instrumentToken": "NSE_EQ|INE002A01018",
  "tradingsymbol": "RELIANCE",
  "exchange": "NSE",
  "orderType": "MARKET",
  "product": "D",
  "price": 0,
  "triggerPrice": 0,
  "validity": "DAY",
  "idempotencyKey": "a-uuid-or-6-plus-character-key"
}
```

Gates, in order: session → `LIVE_TRADING_ENABLED=1` → per-account live consent → `live:true` → open NSE session → idempotency → Risk Shield (kill switch, session, quote freshness, broker funds, per-trade cap, daily cap, duplicate entry, sizing) → adapter. A successful place returns `201 { orderId, brokerOrderId, status, mode }`.

If the broker times out, drops the connection, or returns an unreadable response, the order is stored as `unverified` and the API returns `202` with `reconciliationRequired: true`. It is **never resubmitted**. The background reconciler (90 s) and `GET .../orders` both check the broker order book and update local state.

`POST /api/brokers/:broker/orders/:orderId/modify` accepts any of `{ quantity, price, triggerPrice, orderType, validity, variety }`. It requires live routing + consent. Uncertain outcomes return `202` with `reconciliationRequired: true`.

`POST /api/brokers/:broker/orders/:orderId/cancel` accepts `{ variety }` and requires live routing + consent.

`POST /api/brokers/zerodha/postback` validates `ZERODHA_POSTBACK_TOKEN` with a timing-safe comparison and updates the matching order.

---

## AI Core

All routes require a session; mutation routes also require the `trader` role (viewers get `403`).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/core/overview` | Dashboard snapshot: brain, risk, performance, health, recovery. |
| GET | `/api/core/brain/status` | Model registry and readiness. |
| POST | `/api/core/brain/evaluate` | `{ symbol, preflight? }`. Deterministic five-model ensemble; the LLM never executes orders. |
| POST | `/api/core/brain/watchlist` | `{ symbols[], preflight? }`, max 12 symbols. |
| GET | `/api/core/risk/status` | Risk config, open decisions, drawdown, kill switch. |
| POST | `/api/core/risk/preflight` | `{ symbol }`. Advisory only; returns a Risk Shield preview. |
| POST | `/api/core/risk/kill-switch` | `{ active, reason }`. A reason of 4+ characters is required to stop and to release. |
| GET | `/api/core/recovery` | Paper recovery intents and alerts. |
| POST | `/api/core/recovery/reconcile` | Verifies timed-out paper intents against the paper ledger; no blind retry. |
| POST | `/api/core/recovery/alerts/:id/ack` | Acknowledge an alert. |
| GET | `/api/core/performance` | Cost-adjusted performance score and metrics. |
| POST | `/api/core/performance/walk-forward` | 70/30 walk-forward evaluation. |
| GET | `/api/core/health` | 24/7 health snapshot. |
| GET | `/api/core/incidents` | Incident list. |
| POST | `/api/core/incidents/:id/ack` | Acknowledge an incident. |
| GET | `/api/core/audit` | Hash-chained audit entries. |
| GET | `/api/core/audit/verify` | Recomputes the chain and reports tampering. |
| GET | `/api/core/events` | SSE stream of core events. |
| GET | `/api/core/stream` | WebSocket upgrade for realtime events. |
| POST | `/api/core/client-error` | Client error reporting. |

### Automated trading (paper and live execution)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/autotrade/status`, `/signals`, `/backtest`, `/audit` | Agent state and evidence. |
| GET | `/api/autotrade/readiness?broker=upstox&probe=1` | Per-gate live readiness: server flag, credentials, broker mode, session, consent, instrument mapping, NSE session and an optional funds probe. Returns `ready`, `checks[]` and `blockers[]`. |
| PUT | `/api/autotrade/execution` | `{ mode: "live", broker, confirm: "ENABLE LIVE AUTO TRADING", acceptRisk: true }` or `{ mode: "paper" }`. Blocked while the agent runs or live positions are open; live needs a fully ready broker. |
| POST | `/api/autotrade/sync` | Pull AI orders from the broker order book and reconcile statuses without resubmitting. Live mode only. |
| PUT | `/api/autotrade/config` | Watchlist (max 20), sizing and risk settings. |
| POST | `/api/autotrade/start` | Requires `{ acceptRisk: true, confirmation: "START AUTO TRADING" }`. |
| POST | `/api/autotrade/pause`, `/resume` | Pause or resume the agent. After a daily risk halt, resume requires `{ acceptRisk: true, confirmation: "RESUME AUTO TRADING" }`. |
| POST | `/api/autotrade/stop` | Emergency stop by default. Blocks entries immediately; existing positions remain monitored in exits-only mode. In live mode, unfilled AI entry orders are also cancelled at the broker. |
| POST | `/api/autotrade/scan` | Run one scan cycle (throttled). |
| POST | `/api/autotrade/explain` | LLM explanation when configured, rules-based otherwise. |
| POST | `/api/autotrade/positions/:id/exit` | Close a position. In live mode the exit is sent to the broker and mirrors the verified fill. |
| POST | `/api/autotrade/notifications/test` | Create a test in-app notification. |

Paper is the default and sends no broker order. Live execution is enabled only when `LIVE_TRADING_ENABLED=1`, credentials are configured with a non-paper broker mode, the account token is connected, per-account consent is granted, instrument mapping and broker funds pass, the persistent auto-trade worker is running, the NSE session is open, Risk Shield approves, and the user types the confirmation phrase. Entries require a broker quote no older than 60s; exits require one no older than 90s. Positions mirror only verified fills; uncertain broker responses are recorded as `unverified` and never resubmitted. A broker-side SL-M stop with DAY validity is submitted after a verified fill and updated when the trailing stop advances. It is not GTT and does not persist overnight; targets and manual exits remain backend-managed. If protection or broker synchronization fails, new live entries pause and an in-app/configured Web Push alert is generated. A fully offline server requires external uptime monitoring.

---

## Notifications and compliance

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/notifications?limit=50` | In-app notifications plus channel support flags. |
| POST | `/api/notifications/read` | `{ ids?: string[], all?: boolean }`. |
| POST | `/api/notifications/test-email` | Sends a test email to the signed-in account. Returns `503 email_not_configured` until SMTP is configured. |
| GET | `/api/compliance/status` | Public, secret-free status of live routing, brokers and data sources. |

`notifications.channels` reports in-app and email support, with `email.configured`/`enabled` and the missing SMTP variables until an SMTP transport is set. Trade, order, order-risk, risk, alert and security notifications are emailed to the account address when SMTP is configured. Push remains unsupported (no FCM/APNs provider) and is reported with a reason.

---

## Using the API from scripts

```bash
# 1. Request and verify an OTP (demo mode returns demoOtp)
curl -s -X POST http://localhost:4000/api/auth/otp/request \
  -H 'Content-Type: application/json' -d '{"phone":"9876500001"}'

# 2. Exchange the code for a verification token
curl -s -X POST http://localhost:4000/api/auth/otp/verify \
  -H 'Content-Type: application/json' -d '{"phone":"9876500001","code":"123456"}'

# 3. Log in and keep the session cookie
curl -s -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9876500001","pin":"4821","verificationToken":"<token>"}'

# 4. Call an authenticated endpoint
curl -s -b cookies.txt http://localhost:4000/api/compliance/status
```

Never place real orders from scripts unless you have explicit authorization, operator approval, and a tested sandbox configuration.
