# Smart notifications

## Channels

- In-app notifications, read/unread state, price-alert state, preferences, and push subscriptions are stored in SQLite per account.
- Email is opt-in per account. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and the optional `SMTP_USER` / `SMTP_PASS` pair. Use **Send email test** on the Notifications page before relying on delivery.
- Background browser push uses the Web Push protocol. Generate a VAPID key pair once with `npx web-push generate-vapid-keys --json`; store the public key in `VAPID_PUBLIC_KEY`, the private key only in the server environment as `VAPID_PRIVATE_KEY`, and a real `mailto:` or HTTPS contact in `VAPID_SUBJECT`. Never put the private key in frontend code or commit it.
- Users grant browser permission and subscribe each device from the Notifications page. The service worker displays push messages and opens the account notification page when clicked.
- Market-news delivery is opt-in. Headlines published before the user enabled news alerts are not sent as new alerts.

## Price alerts and event routing

Price alerts are account-backed and evaluated about once a minute by the single-process server scheduler. The scanner ignores demo, stale, undated, or unclassified quotes. A delayed research or exchange-close quote may cross a threshold after the actual market move; the notification names its source.

AI signal, confirmed trade, order-risk, stop-loss, target, trailing-stop, emergency-stop, and daily-risk events are persisted in the account notification feed. Email is sent only when the user enabled email and the account has a real email address. Push is sent only to devices with an active subscription.

## Serverless scheduling

The in-process scheduler is disabled on Vercel Functions. Configure `CRON_SECRET` as a server environment variable and call `GET /api/cron/notifications` with `Authorization: Bearer <CRON_SECRET>` from an external scheduler. The endpoint fails closed when the secret is missing or incorrect and returns no-store results.

Vercel Hobby cron jobs are limited to one run per day; once-a-minute alert evaluation needs a deployment plan or external scheduler that supports that cadence. See [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [Cron authorization](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
