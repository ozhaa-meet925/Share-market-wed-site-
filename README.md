# Share-market-wed-site-

A React + Vite share market dashboard with Indian indices, stocks, IPOs, commodities, portfolio, watchlist, orders, learning content, and calculators.

## Run

```bash
npm install
npm run setup:yfinance
npm run dev
```

`npm run setup:yfinance` is a one-time optional setup for Yahoo Finance research quotes when KUN has no quote. These values are for personal research, may be delayed or stale, and are always labeled as not live. KUN remains the real-time provider when its authorized token is configured.

## Build

```bash
npm run build
```

## Vercel deployment

The Vercel deployment serves the Vite app and routes `/api/*` requests to the Express market API. Without a live provider token, stock cards can use Yahoo Finance research quotes, clearly marked as delayed/not live. To enable live KUN quotes, add `MARKET_DATA_PROVIDER=kun` and an authorized `KUN_DATA_API_TOKEN` to the Vercel project's Environment Variables, then redeploy.

## Live IPO listings, tracking, and applications

The IPO page reads open and upcoming IPOs from Upstox, checks all result pages, and refreshes every minute. If Upstox is unavailable or rejects its token, the API falls back to the current and forthcoming issue feed published by NSE India and labels that source on screen. Closed or expired issues leave the active calendar; tracked issues keep their last-known details. The home page uses the same provider feed, and the UI never shows bundled sample IPOs as live data.

For listings, create an Upstox Analytics Token and set `UPSTOX_ACCESS_TOKEN` in `.env` locally or in the hosting provider's server-side environment variables. This read-only token can retrieve IPO listings and details. A user can also use their own secure OAuth session as the read-only feed token after connecting.

Applying and tracking broker applications requires a separate Upstox OAuth app because the Analytics Token cannot submit bids. Configure `UPSTOX_CLIENT_ID`, `UPSTOX_CLIENT_SECRET`, `UPSTOX_REDIRECT_URI`, and a private random `IPO_SESSION_SECRET` on the server. Add the exact callback URL `<site-origin>/api/ipo/auth/callback` to the Upstox app. Keep all four values server-side and never commit `.env`. The site redirects each user to Upstox login; it stores that user's broker token in an encrypted, HttpOnly cookie and sends an application only after the user reviews and confirms the bid. The user must still approve the UPI mandate in their UPI app. The IPO page's **My Applications** view polls Upstox for mandate, exchange, and allotment status.

IPO details include issue size, price band, dates, category subscriptions, registrar information, and available prospectus links. The upstream IPO detail API does not provide structured audited financial statements, use-of-proceeds breakdowns, strengths, or risk summaries for every issue; the app marks missing fields and links to the official RHP/DRHP when available instead of inventing those details.
## Live stock prices

Kunpeng Data is the default live quote provider. The [StockerAPI GitHub project](https://github.com/StockerAPI/india-stock-market-api) documents Kunpeng Data's hosted HTTP and WebSocket API; it is not a server to run locally. Create a Kunpeng Data member account and make sure its token is authorized for the India (`IN`) market and NSE exchange, then:

1. Copy `.env.example` to `.env`.
2. Keep `MARKET_DATA_PROVIDER=kun` and paste the member token into `KUN_DATA_API_TOKEN`.
3. Restart the market proxy with `npm run dev` (or `npm run start:proxy` and the frontend separately).

The proxy requests initial quote snapshots and chart history over HTTP, then subscribes to Kunpeng Data's NSE WebSocket stream and serves its cached updates through the existing `/api/stock/quote` and `/api/stock/batch` routes. The browser never receives the provider token. Historical candles use Kunpeng Data while `MARKET_DATA_PROVIDER=kun`; the chart shows an unavailable state when the account token or NSE permission is missing.

Upstox, Groww, and Zerodha remain optional live providers. For Upstox, set `MARKET_DATA_PROVIDER=upstox` and configure `UPSTOX_ACCESS_TOKEN`. Upstox symbol mapping overrides use `UPSTOX_SYMBOL_MAP=SYMBOL=NSE_EQ|ISIN,SYMBOL2=NSE_EQ|ISIN2`.

When KUN is not configured, the app can show Yahoo Finance research quotes through the optional `yfinance` package. These are not live quotes and may be delayed or stale. The app labels them as research data. Configure an authorized market provider before relying on real-time prices. Upstox's read-only token cannot place trades.

Groww is also supported if you already have its API credentials, but it is not the free option.

For Zerodha Kite, set `ZERODHA_API_KEY` and `ZERODHA_ACCESS_TOKEN`. The proxy sends symbols as `NSE:SYMBOL`.

Alpha Vantage can provide historical candles with `ALPHA_VANTAGE_API_KEY`; Indian symbols use the `.BSE` suffix by default, and `ALPHA_VANTAGE_SYMBOL_SUFFIX` can change that mapping. If a configured provider fails, its last quote is labeled stale; the app does not silently replace a failed live quote with the simulated demo feed.

## Calendar feeds

The Calendars page includes economic releases, NSE holidays, earnings, dividends, stock splits, IPOs, and NSE futures expiry. Calendar events come from the server-side Financial Modeling Prep (FMP) API; add `FMP_API_KEY` to `share-market/.env` and restart the proxy. Keep the key out of frontend code and source control. Confirm the FMP plan includes Indian market calendar data before relying on these feeds; the page shows a setup/error state instead of inventing events when data is unavailable. Economic, earnings, dividend, split, and IPO feeds refresh at different intervals. NSE monthly expiry dates are derived from NSE's published contract rule and adjusted with the configured NSE holiday feed when it is available.
