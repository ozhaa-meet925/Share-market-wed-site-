# Performance Report

Measured on 2026-11-05 on the local Windows machine running the production server (`:4000`) and the API (`:3001`). These are single-request timings, not a load test.

## 1. Endpoint latency

| Endpoint | Auth | Median sample |
| --- | --- | --- |
| `/api/health` | No | 4 ms |
| `/api/compliance/status` | No | 4 ms |
| `/api/brokers` | Yes | 4 ms |
| `/api/notifications` | Yes | 3 ms |
| `/api/core/health` | Yes | 23 ms |
| `/api/core/overview` | Yes | 14 ms |
| `/api/stock/quote?symbol=RELIANCE` | Yes | 233 ms (upstream provider) |
| `/api/stock/history?symbol=RELIANCE` | Yes | 1.35 s (upstream history fetch) |

Local core and broker endpoints stay in single-digit milliseconds because they read SQLite or cached state. Market-data routes are dominated by the upstream provider; the app already caches quotes and history and never fabricates a fallback.

## 2. Frontend bundle

Latest `vite build`:

| Asset | Size | Gzip |
| --- | --- | --- |
| `index-*.js` | 1,155.99 kB | 345.84 kB |
| `index-*.css` | 473.34 kB | 84.24 kB |
| `MutualFunds-*.js` | 407.51 kB | 119.07 kB |

Vite warns that the main chunk exceeds 500 kB. This is the largest remaining performance issue for cold loads. Recommended (not yet done): route-level `React.lazy` for heavy pages (charts, AI Core, Mutual Funds) and `manualChunks` for `recharts`/`lightweight-charts`.

## 3. Backend efficiency

- SQLite with WAL mode and indexes on user/time, status, broker order id, unread notifications and audit time.
- Order submission uses `BEGIN IMMEDIATE` transactions; the write path is short and does not hold locks during broker HTTP calls.
- Broker HTTP requests use a per-adapter rate limiter and bounded retries with backoff for idempotent calls. Order placement is never retried automatically.
- The reconciler runs every 90 seconds over at most 50 connected accounts and only polls non-terminal orders.
- In-memory caches serve repeated quote/history/AI requests; expensive AI routes have cooldowns.
- Global API rate limiting is O(1) per request (Map counters).

## 4. Capacity notes

| Area | Limit today |
| --- | --- |
| Database | Single node, one writer; suitable for one process. Multi-process requires PostgreSQL or a separate writer. |
| Broker rate limits | Enforced per adapter (Upstox default 8 req/s). The reconciler adds a bounded, periodic load. |
| Notifications | Indexed per user; read API caps the list (default 50). |
| WebSocket/SSE | One core event stream per client; the legacy market WebSocket depends on the external provider. |
| Frontend | Main JS chunk is large; first paint on slow networks will suffer until code-splitting is added. |

## 5. Verification method

```bash
curl -s -o /dev/null -w '%{time_total}s %{http_code}\n' http://localhost:4000/api/health
curl -s -o /dev/null -w '%{time_total}s %{http_code}\n' -b cookies.txt http://localhost:4000/api/core/health
```

Repeat 3–5 times and take the median. Use `NODE_ENV=production` and the built frontend for meaningful numbers. Real load testing (k6/autocannon) remains an open task.
