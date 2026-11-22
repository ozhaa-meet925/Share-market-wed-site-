# Deployment Guide & Checklist

## 1. Prerequisites

- Node.js 24+ (the project uses `node:sqlite`, `node:test` and ESM).
- A persistent disk for `data/` (SQLite, users, auth secret, audit chain).
- Python 3 with the optional `yfinance` package if delayed research quotes are required (`npm run setup:yfinance`).
- TLS termination at a reverse proxy (Nginx/Caddy) for production.
- SMS delivery for OTP before real users; without it only demo OTP works.

## 2. Environment

Copy `.env.example` to `.env` and fill only what you operate. Never commit `.env`.

### Core

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | Production | Set `production` so demo OTP is hidden and cookies use `Secure` behind TLS. |
| `PORT` | No | Defaults to `4000` in production mode, `3001` in dev. |
| `TRUST_PROXY` | Behind a proxy | `1` or the proxy hop count. |
| `CORE_DATA_DIR` / `CORE_DB_PATH` | Recommended | Point at a backed-up persistent disk. |
| `AUTH_HIDE_DEMO_OTP` / `AUTH_SHOW_DEMO_OTP` | No | Keep demo OTP hidden in production. |
| `API_RATE_LIMIT_PER_MIN` | No | Default 900 per IP. |

### Market data

`MARKET_DATA_PROVIDER`, `KUN_DATA_API_TOKEN`, `KUN_DATA_API_BASE_URL`, `KUN_DATA_WS_URL`, `KUN_DATA_MARKET`, `KUN_DATA_EXCHANGE`, `YFINANCE_RESEARCH_ENABLED`, `ALPHA_VANTAGE_API_KEY`, `GOLDPRICE_API_KEY`, `FINNHUB_API_KEY`, `FMP_API_KEY`, `GEMINI_API_KEY`, `UPSTOX_ACCESS_TOKEN`, `UPSTOX_SYMBOL_MAP`, `GROWW_ACCESS_TOKEN`, `GROWW_SYMBOL_MAP`.

None are required to start. Missing providers surface as `Unavailable`/`Not Configured` with reasons.

### Brokers and live trading

| Variable | Required for | Notes |
| --- | --- | --- |
| `UPSTOX_CLIENT_ID`, `UPSTOX_CLIENT_SECRET`, `UPSTOX_REDIRECT_URI` | Upstox OAuth | Redirect URI must be `<origin>/api/brokers/upstox/callback`. |
| `UPSTOX_TRADING_MODE` | Upstox orders | `paper` (default), `sandbox`, `live`. |
| `UPSTOX_SANDBOX_API_BASE` | Upstox sandbox | Required when mode is `sandbox`. |
| `ZERODHA_API_KEY`, `ZERODHA_API_SECRET` | Kite OAuth | Callback: `<origin>/api/brokers/zerodha/callback`. |
| `ZERODHA_TRADING_MODE` | Kite orders | `paper` (default), `sandbox`, `live`. |
| `ZERODHA_SANDBOX_BASE_URL` | Kite sandbox | Kite has no official sandbox; point at an isolated mock only. |
| `ZERODHA_POSTBACK_TOKEN` | Kite postbacks | Shared secret; postback URL `<origin>/api/brokers/zerodha/postback?token=...`. |
| `BROKER_TOKEN_KEY` | **Yes for brokers** | 32+ random characters. Changing it makes stored tokens undecryptable. |
| `IPO_SESSION_SECRET` | IPO applications | Encrypts the IPO session cookie. |
| `LIVE_TRADING_ENABLED` | **Only after go-live approval** | Must equal `1`. Ships unset/`0`. This flag alone is not enough: the AI engine also needs configured credentials, a non-paper broker mode, a connected token, per-account live consent and instrument mapping. |

### Notification email

| Variable | Required for | Notes |
| --- | --- | --- |
| `SMTP_HOST` | Email alerts | SMTP server hostname. Without it, email is reported as not configured. |
| `SMTP_PORT` | Email alerts | Defaults to `587`; port `465` enables implicit TLS. |
| `SMTP_SECURE` | Email alerts | Set to `1` for implicit TLS when not using port `465`. |
| `SMTP_USER`, `SMTP_PASS` | SMTP auth | Leave unset only for an unauthenticated relay on a trusted network. |
| `SMTP_FROM` | Email alerts | Sender address; defaults to `SMTP_USER`. |

Trade, order and risk notifications are emailed only after verified broker execution. `POST /api/notifications/test-email` reports the missing variables until SMTP is configured.

### Payments

`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`. Unconfigured endpoints return a setup error.

## 3. Build and run

```bash
npm ci
npm test
npx vite build
NODE_ENV=production PORT=4000 node server.js
```

`node server.js` serves `dist/` plus `/api`. In development, run `npm run dev` (API on `:3001`) and `npm run dev:client` (Vite on `:5173`).

### systemd example

```ini
[Unit]
Description=ShareMarket Pro
After=network.target

[Service]
Type=simple
User=sharemarket
WorkingDirectory=/opt/sharemarket
EnvironmentFile=/opt/sharemarket/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Nginx sketch

```nginx
server {
  listen 443 ssl http2;
  server_name example.com;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }
}
```

Set `TRUST_PROXY=1` so rate limiting and HTTPS detection see the real client.

## 4. Go-live checklist

- [ ] `npm test` passes (63/63) and `vite build` is clean.
- [ ] `NODE_ENV=production`; demo OTP hidden or SMS delivery configured.
- [ ] TLS enabled; `TRUST_PROXY` set; HSTS observed.
- [ ] `BROKER_TOKEN_KEY` and `IPO_SESSION_SECRET` are long, random and stored outside the repo.
- [ ] Database and `data/auth-secret` are on persistent storage and backed up.
- [ ] `LIVE_TRADING_ENABLED` is **unset** unless a specific, written trading authorization exists.
- [ ] Broker OAuth apps use the exact production callback URLs.
- [ ] Upstox/Kite sandbox orders have been verified end to end if live routing will be enabled.
- [ ] `/api/compliance/status` shows the expected provider/broker state.
- [ ] `/api/brokers` shows `liveTradingEnabled` matching intent.
- [ ] `/api/autotrade/readiness?broker=upstox&probe=1` reports `ready: true` before live automation is enabled.
- [ ] SMTP variables are set if email alerts are expected; otherwise `/api/notifications` reports `email.configured: false`.
- [ ] Audit chain verification succeeds.
- [ ] Logs are captured and rotated; `.env` is unreadable by other users.

## 5. Enabling live routing (operator action)

1. Complete sandbox verification and record the evidence.
2. Obtain the required broker/exchange/SEBI approvals for algorithmic or multi-user order flow.
3. Set the broker's `*_TRADING_MODE=live` (or `sandbox`).
4. Set `LIVE_TRADING_ENABLED=1` and restart.
5. Each user must still grant per-account consent; each order must send `live:true`.
6. For AI automation, connect the broker, keep the agent stopped and paper positions closed, then enable live execution from the AI Trading dashboard with the typed `ENABLE LIVE AUTO TRADING` confirmation.
7. Keep the kill switch and Risk Shield enabled; monitor `/api/core/health` and notifications.

Any one of these being missing blocks orders with a specific error code.

## 6. Rollback

1. Set `LIVE_TRADING_ENABLED=0` and restart — this blocks new live orders immediately.
2. Revoke live consent per account (`POST /api/brokers/:broker/live-consent` with `enabled:false`).
3. Stop the reconciler load by stopping the server if the broker API is failing.
4. Restore the previous build and database backup if a schema migration caused the issue. Migrations are forward-only; restore rather than downgrade.
5. Verify `/api/health`, `/api/compliance/status` and the audit chain after rollback.

## 7. Known operational limits

- Single-process SQLite. Do not scale horizontally without PostgreSQL.
- In-memory rate limits reset on restart.
- Streaming broker feeds are not bundled; quotes use REST polling and the AI worker evaluates entries on a 20-second cycle.
- Browser push is not implemented (no FCM/APNs provider); email alerts need SMTP, and in-app alerts are persisted in SQLite.
