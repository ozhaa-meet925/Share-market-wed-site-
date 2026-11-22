# API & Provider Integration Report

Last verified: 2026-11-05 against the running build (`:4000`, API `:3001`).

## 1. Market data providers

| Provider | Used for | Implementation | Configured here | Status | Honest limit |
| --- | --- | --- | --- | --- | --- |
| Kunpeng Data (KUN) | Live NSE quotes, depth, WebSocket ticks, history | HTTP + WebSocket proxy in `server.js` | No `KUN_DATA_API_TOKEN` | **Unavailable** | Needs a member token authorized for the IN market / NSE exchange. |
| Yahoo Finance / yfinance | Delayed research quotes and candles | Python bridge (`yfinance_research.py`) via `yfinanceResearchProvider.js` | Python bridge installed, provider enabled | **Available, delayed** | Not a licensed real-time feed. Always labelled research/not live. |
| Upstox (read-only market data) | Quotes and metals | Existing read-only adapter in `server.js` | Token present but rejected upstream | **Degraded** | Expired/invalid token. IPO listings do not use Upstox. |
| Zerodha quote API | Historical/quote fallback | Existing read-only calls | No API key | **Not configured** | Requires a valid Kite API key and access token. |
| Groww | Quotes / depth | Existing adapter | No token | **Not configured** | Requires Groww API credentials. |
| Alpha Vantage | Historical candles fallback | Existing adapter | No key | **Not configured** | Optional; free tier is rate-limited. |
| NSE India (keyless) | Live IPO listings, holidays, corporate actions, results, board meetings | Server-side fetch of public pages | Working | **Available** | Public pages only; upstream rate limits apply. |
| NSE India index feed | NIFTY 50, NIFTY BANK, NIFTY IT, NIFTY MIDCAP 150 quotes | `nseIndexProvider.js` (`/api/allIndices` snapshot, 15 s cache) | Working | **Available** | Marked live only in an open session with a feed timestamp under 2 minutes old; otherwise delayed or exchange close. Website data is for personal reference; redistribution needs an NSE licence. |
| AMFI | Mutual fund NAV | Published NAV files | Working | **Available** | End-of-day values, not tradable prices. |
| goldprice.dev / COMEX | Gold and silver spot/futures | Existing metals service | Working | **Available** | Third-party public feeds; delayed, converted to INR. |
| FMP / finance calendar | Economic calendar | Existing adapter | No valid key | **Not configured** | Returns `503` with a setup message; events are never invented. |
| Google News RSS | Headlines | Existing fetch | Working | **Available** | Headlines only. |
| Investing.com | — | **Not integrated** | — | **Not integrated** | No official public API is used and nothing is scraped. Only an official widget or a licensed provider could be added. |

Selection is server-side; the browser never receives provider tokens.

Index coverage is mixed on purpose: NIFTY 50, NIFTY BANK, NIFTY IT and NIFTY MIDCAP 150 prefer the NSE India exchange feed, while SENSEX has no BSE-licensed feed configured and remains a delayed Yahoo research quote. The UI labels each quote individually; it never promotes research data to live.

## 1.1 Exchange market status

`GET /api/market/status` derives NSE cash-market phases in `Asia/Kolkata` from the official NSE trading-holiday feed and the published equity session windows. The server persists successfully refreshed NSE CM holiday and special-session records in `market_calendar_events` and records yearly refreshes in `market_calendar_sync`. Missing or stale calendar data fails closed for live order routing. A special-session record only opens the market when the exchange feed includes a valid start and end time; an announcement without parseable hours is displayed as unverified and cannot authorize orders.

The current deployment does not have an independently verified BSE holiday feed or licensed live SENSEX feed. Consequently, the status panel labels SENSEX as not independently verified rather than presenting NSE hours or research quotes as authoritative BSE status. Special sessions announced only through circulars and not represented in the NSE calendar feed still require an official machine-readable source before they can be activated automatically.

## 2. Broker adapters

| Capability | Upstox | Zerodha Kite Connect |
| --- | --- | --- |
| OAuth login + signed state | Implemented (`/api/brokers/upstox/login-url`) | Implemented (`/api/brokers/zerodha/login-url`) |
| Token storage | AES-256-GCM encrypted in SQLite | Same |
| Profile / funds | Implemented | Implemented |
| Holdings / positions | Implemented | Implemented |
| Quotes (REST) | Implemented (`v3/market-quote/ltp`) | Implemented (`/quote`) |
| Historical candles | Implemented (v3) | Implemented (`/instruments/historical`) |
| Order book / trade book | Implemented | Implemented |
| Place / modify / cancel | Implemented, triple-gated | Implemented, triple-gated |
| Postbacks | REST polling + reconciler | Signed postback endpoint + reconciler |
| Streaming ticks | **Not bundled** — protobuf decoder missing | **Not bundled** — KiteTicker binary decoder missing |
| Instrument master download | **Not bundled** | **Not bundled** |
| GTT | **Not implemented** | **Not implemented** (capability reports `supported:false`) |
| Paper/sandbox mode | `paper` by default; `sandbox` needs `UPSTOX_SANDBOX_API_BASE` | No official sandbox; `ZERODHA_SANDBOX_BASE_URL` can point at an isolated mock |

Capability flags are reported by `/api/brokers` and are deliberately conservative: a feature is `true` only when the adapter implements it. There are no fake success paths.

The AI live-trading path submits a broker-side `SL-M` stop with `DAY` validity after a verified fill, and modifies that order when a trailing stop advances. It is not a GTT order and does not persist overnight; a next-session stop must be renewed after checking the broker's current net position. Targets and emergency/manual exits still depend on the backend worker. A rejected, unverified, or missing protective order pauses new live entries and creates a risk alert. Broker APIs and product-specific rules can reject stop-market orders; the system does not fall back silently to a software-only stop.

The backend exposes scheduler heartbeat fields in the authenticated auto-trade status response and pauses live entries when broker quotes, order synchronization, position verification, or the worker cycle fails. In-app and configured Web Push notifications are best-effort while the server is reachable. Detecting a fully offline host requires a separate external uptime monitor.

### Three gates for live orders

1. Server master switch: `LIVE_TRADING_ENABLED=1`.
2. Per-account consent: `POST /api/brokers/:broker/live-consent` with `ENABLE LIVE TRADING`.
3. Per-request confirmation: `live: true` plus an idempotency key.

All three plus an open NSE session and a passing Risk Shield decision are required. If any gate fails, the request is rejected with a specific code. Live routing ships **disabled**.

### Order safety

- Every order body is validated (side, quantity, instrument, idempotency key).
- Duplicate idempotency keys return the original order instead of submitting again.
- Timeout/network/invalid-response errors become `unverified`; the order is **not** resubmitted.
- The reconciler polls the broker order book every 90 seconds and on demand, updates status/fills, writes `order_events` and notifies the user. AI entries submit a separate broker-side `SL-M`/`DAY` protective stop only after a verified fill; protection must be checked/renewed on each trading day.
- Postbacks are token-checked with `crypto.timingSafeEqual`.
- Risk Shield runs again for each live order, including broker funds and quote freshness.

## 3. Notifications

| Channel | State | Reason |
| --- | --- | --- |
| In-app | **Working** | Persisted in SQLite, exposed via `/api/notifications`, streamed on the core event bus. |
| Email | **Not implemented** | No SMTP transport is configured or coded; the API reports `supported:false`. |
| Push | **Not implemented** | No Web Push/VAPID keys or service worker subscription flow; reported as unsupported. |

## 4. AI / LLM

- The Super Brain ensemble, Risk Shield, recovery, performance scoring and health monitoring are deterministic and work without external AI keys.
- `GEMINI_API_KEY` enables natural-language explanations. Without it, explanations are rules-based and labelled as computed.
- The LLM never calculates trade sizes, never passes Risk Shield, and never sends broker orders.

## 5. What an operator must supply before real trading

1. Broker OAuth application credentials for Upstox and/or Kite, with the exact callback URLs.
2. A persistent `BROKER_TOKEN_KEY` (32+ random characters) and `IPO_SESSION_SECRET`.
3. A market-data licence and provider token if real-time NSE/BSE data is required.
4. Exchange/SEBI approval for algorithmic order flow where applicable, plus review of broker API terms for multi-user use.
5. `LIVE_TRADING_ENABLED=1` only after sandbox verification, Risk Shield review and a written go-live checklist.

Connecting a personal broker account authorizes that account only. It does **not** authorize operating a public live-trading platform.

The Compliance page includes an operator checklist for broker account verification, broker-specific stop-loss testing, production safeguards, and external regulatory/broker confirmation. These items are intentionally labelled as requiring manual verification: the application cannot certify a sandbox or live broker order, production availability, or legal compliance. Keep live routing disabled until the applicable checks are completed and documented.
