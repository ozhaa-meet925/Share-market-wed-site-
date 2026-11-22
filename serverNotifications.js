import crypto from 'node:crypto';
import webpush from 'web-push';
import { findUserById, readSessionUser } from './serverAuth.js';
import { getDatabase } from './serverDb.js';
import { emailStatus, sendEmail } from './serverEmail.js';

const MAX_LIMIT = 100;
const MAX_PENDING_PRICE_ALERTS = 100;
const EMAIL_CATEGORIES = new Set(['trade', 'order', 'order_risk', 'risk', 'alert', 'price_alert', 'signal', 'news', 'security']);
let appliedVapidKey = '';

const vapidConfig = () => {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || '').trim();
  const missing = [];
  if (!publicKey) missing.push('VAPID_PUBLIC_KEY');
  if (!privateKey) missing.push('VAPID_PRIVATE_KEY');
  if (!subject) missing.push('VAPID_SUBJECT');
  return { configured: missing.length === 0, publicKey, privateKey, subject, missing };
};

const ensureVapid = () => {
  const config = vapidConfig();
  if (!config.configured) return config;
  const key = `${config.publicKey}:${config.privateKey}:${config.subject}`;
  if (key !== appliedVapidKey) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    appliedVapidKey = key;
  }
  return config;
};

const emailAddressFor = (user) => {
  const email = String(user?.email || '').trim();
  return email && !email.toLowerCase().endsWith('@sharemarket.local') ? email : null;
};

const isSupportedPushEndpoint = (endpoint) => {
  const host = endpoint.hostname.toLowerCase().replace(/\.$/, '');
  return host === 'fcm.googleapis.com'
    || host.endsWith('.push.services.mozilla.com')
    || host.endsWith('.push.apple.com')
    || host === 'notify.windows.com';
};

const preferencesFor = (userId) => {
  const row = getDatabase().get('SELECT email_enabled, news_enabled FROM notification_preferences WHERE user_id = ?', userId);
  return { emailEnabled: row?.email_enabled === 1, newsEnabled: row?.news_enabled === 1 };
};

export const notificationChannels = (user = null) => {
  const email = emailStatus();
  const recipientConfigured = Boolean(emailAddressFor(user));
  const preferences = user?.id ? preferencesFor(user.id) : { emailEnabled: false, newsEnabled: false };
  const push = vapidConfig();
  const subscriptionCount = user?.id
    ? Number(getDatabase().get('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?', user.id)?.count || 0)
    : null;
  return {
    inApp: { supported: true, enabled: true },
    email: {
      ...email,
      recipientConfigured,
      enabled: email.configured && recipientConfigured && preferences.emailEnabled,
      reason: !email.configured ? email.reason
        : !recipientConfigured ? 'Add a usable email address to the account before enabling delivery.'
          : preferences.emailEnabled ? 'Email alerts are enabled for this account.' : 'Email delivery is configured but not enabled in account preferences.',
    },
    push: {
      supported: true,
      configured: push.configured,
      enabled: push.configured && (subscriptionCount === null || subscriptionCount > 0),
      publicKey: push.configured ? push.publicKey : null,
      subscriptions: subscriptionCount,
      missing: push.missing,
      reason: push.configured
        ? subscriptionCount === 0 ? 'Push is configured; enable it on this device to receive alerts.' : 'Web Push is configured for background delivery.'
        : `Background push needs ${push.missing.join(', ')} on the server.`,
    },
  };
};

const subscriptionRowsFor = (userId) => getDatabase().query(
  'SELECT endpoint_hash, subscription_json FROM push_subscriptions WHERE user_id = ?', userId,
);

const sendPush = async (userId, notification) => {
  let config;
  try {
    config = ensureVapid();
  } catch (error) {
    console.warn('Web Push configuration is invalid:', error.message);
    return;
  }
  if (!config.configured) return;
  const db = getDatabase();
  const rows = subscriptionRowsFor(userId);
  await Promise.all(rows.map(async (row) => {
    try {
      const subscription = JSON.parse(row.subscription_json);
      await webpush.sendNotification(subscription, JSON.stringify({
        title: notification.title,
        body: notification.body || notification.category,
        url: '/notifications',
        tag: notification.id,
        level: notification.level,
      }), { TTL: 180, urgency: notification.level === 'critical' ? 'high' : 'normal' });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.run('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?', row.endpoint_hash, userId);
      } else {
        console.warn('Browser push delivery failed:', error.message);
      }
    }
  }));
};

export const notify = ({ userId, category, title, body = '', level = 'info', channel = 'in_app', externalKey = null }) => {
  if (!userId || !category || !title) return null;
  const createdAt = new Date().toISOString();
  const record = {
    id: `NTF-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    userId,
    category: String(category).slice(0, 48),
    title: String(title).slice(0, 160),
    body: body ? String(body).slice(0, 600) : null,
    level: ['info', 'success', 'warning', 'critical'].includes(level) ? level : 'info',
    channel,
    createdAt,
  };
  const key = externalKey ? String(externalKey).slice(0, 180) : null;
  try {
    const result = getDatabase().run(
      `INSERT OR IGNORE INTO notifications (id, user_id, category, title, body, level, channel, sent_at, created_at, external_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id, userId, record.category, record.title, record.body, record.level, channel, createdAt, createdAt, key,
    );
    if (Number(result.changes) === 0) return null;
  } catch (error) {
    console.warn('Notification persist failed:', error.message);
    return null;
  }
  const user = findUserById(userId);
  const preferences = preferencesFor(userId);
  const recipient = emailAddressFor(user);
  if (EMAIL_CATEGORIES.has(record.category) && preferences.emailEnabled && recipient) {
    sendEmail({
      to: recipient,
      subject: `[ShareMarket Pro] ${record.title}`,
      text: [
        record.title,
        '',
        record.body || '',
        '',
        `Category: ${record.category} · Level: ${record.level}`,
        `At: ${record.createdAt}`,
        '',
        'Check the account activity and verified broker order book before acting on this alert.',
      ].join('\n'),
    }).catch(() => {});
  }

  // Telegram Multi-Channel Trigger Dispatch
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && ['critical', 'warning', 'info'].includes(record.level)) {
    const tgMsg = `🔔 *ShareMarket Pro Alert*\n\n*${record.title}*\n${record.body || ''}\n\n🕒 ${record.createdAt}`;
    fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: tgMsg, parse_mode: 'Markdown' }),
    }).catch((err) => console.warn('Telegram alert push failed:', err.message));
  }

  // WhatsApp Webhook Trigger Dispatch (if webhook URL configured)
  if (process.env.WHATSAPP_WEBHOOK_URL) {
    fetch(process.env.WHATSAPP_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: user?.phone,
        message: `${record.title}\n${record.body || ''}`,
        timestamp: record.createdAt,
      }),
    }).catch((err) => console.warn('WhatsApp alert webhook failed:', err.message));
  }

  sendPush(userId, record).catch(() => {});
  return record;
};

const publicRow = (row) => ({
  id: row.id,
  category: row.category,
  title: row.title,
  body: row.body,
  level: row.level,
  channel: row.channel,
  readAt: row.read_at,
  createdAt: row.created_at,
});

const publicPriceAlert = (row) => ({
  id: row.id,
  symbol: row.symbol,
  direction: row.direction,
  purpose: row.purpose || 'target',
  target: Number(row.target),
  triggered: row.status === 'triggered',
  createdAt: row.created_at,
  triggeredAt: row.triggered_at,
  triggeredPrice: row.triggered_price === null ? null : Number(row.triggered_price),
  triggeredOn: row.triggered_source,
});

export const listPriceAlerts = (userId) => getDatabase().query(
  'SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', userId,
).map(publicPriceAlert);

const listPreferences = (userId) => preferencesFor(userId);

export const listNotifications = (userId, limit = 40, user = null) => {
  const size = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 40));
  const db = getDatabase();
  const rows = db.query(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    userId, size,
  );
  const unread = db.get('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL', userId);
  return {
    items: rows.map(publicRow),
    unread: Number(unread?.count || 0),
    channels: notificationChannels(user || findUserById(userId)),
    preferences: listPreferences(userId),
    priceAlerts: listPriceAlerts(userId),
  };
};

const fail = (res, status, message, code) => res.status(status).json({ error: message, code });
const stableKey = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export const evaluatePriceAlerts = async (quoteBatch) => {
  const db = getDatabase();
  const cursor = db.get("SELECT value FROM notification_scan_state WHERE key = 'price_alerts_cursor'")?.value || null;
  let pending = cursor
    ? db.query("SELECT * FROM price_alerts WHERE status = 'pending' AND id > ? ORDER BY id LIMIT 200", cursor)
    : [];
  if (!pending.length) pending = db.query("SELECT * FROM price_alerts WHERE status = 'pending' ORDER BY id LIMIT 200");
  if (!pending.length || typeof quoteBatch !== 'function') return { examined: 0, triggered: 0 };
  db.run(
    `INSERT INTO notification_scan_state (key, value, updated_at) VALUES ('price_alerts_cursor', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    pending.at(-1).id, new Date().toISOString(),
  );
  const symbols = [...new Set(pending.map((alert) => alert.symbol))];
  let examined = 0;
  let triggered = 0;
  for (let offset = 0; offset < symbols.length; offset += 40) {
    const batchSymbols = symbols.slice(offset, offset + 40);
    let quotes = {};
    try {
      quotes = await quoteBatch(batchSymbols);
    } catch (error) {
      console.warn('Price-alert quote scan failed:', error.message);
      continue;
    }
    for (const alert of pending.filter((row) => batchSymbols.includes(row.symbol))) {
      examined += 1;
      const quote = quotes?.[alert.symbol];
      const price = Number(quote?.c);
      const knownBasis = quote?.isLive === true || quote?.isReal === true || quote?.isResearch === true
        || quote?.isDelayed === true || quote?.isClose === true;
      if (!(price > 0) || !knownBasis || quote?.isDemo === true || quote?.isStale === true) continue;
      const rawTimestamp = quote.timestamp;
      const numericTimestamp = Number(rawTimestamp);
      const parsedTimestamp = typeof rawTimestamp === 'string' && !/^\d+(\.\d+)?$/.test(rawTimestamp.trim())
        ? Date.parse(rawTimestamp)
        : NaN;
      const timestampMs = numericTimestamp > 0
        ? (numericTimestamp < 1e12 ? numericTimestamp * 1000 : numericTimestamp)
        : Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
      const maxAgeMs = quote.isLive === true ? 10 * 60_000 : 36 * 60 * 60_000;
      if (!timestampMs || Date.now() - timestampMs > maxAgeMs || timestampMs > Date.now() + 60_000) continue;
      const reached = alert.direction === 'above' ? price >= Number(alert.target) : price <= Number(alert.target);
      if (!reached) continue;
      const at = new Date().toISOString();
      const source = quote.isLive === true
        ? `${quote.provider || 'Live provider'} quote`
        : quote.isClose === true ? `${quote.provider || 'Exchange'} close`
          : `${quote.provider || 'Research provider'} delayed quote`;
      const changed = db.run(
        "UPDATE price_alerts SET status = 'triggered', triggered_at = ?, triggered_price = ?, triggered_source = ? WHERE id = ? AND status = 'pending'",
        at, price, source, alert.id,
      );
      if (Number(changed.changes) !== 1) continue;
      triggered += 1;
      const purposeLabel = alert.purpose === 'stop_loss' ? 'stop-loss' : alert.purpose === 'take_profit' ? 'take-profit' : 'target';
      notify({
        userId: alert.user_id,
        category: 'price_alert',
        level: 'warning',
        title: `${alert.symbol} ${purposeLabel} alert triggered`,
        body: `${alert.symbol} reported ₹${price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}, crossing your ${purposeLabel} ${alert.direction} ₹${Number(alert.target).toLocaleString('en-IN', { maximumFractionDigits: 2 })} threshold. Source: ${source}.`,
        externalKey: `price-alert:${alert.id}:triggered`,
      });
    }
  }
  return { examined, triggered };
};

export const notifyNewsSubscribers = (feed) => {
  if (feed?.live !== true) return 0;
  const db = getDatabase();
  const users = db.query('SELECT user_id, updated_at FROM notification_preferences WHERE news_enabled = 1');
  if (!users.length) return 0;
  const articles = (Array.isArray(feed?.data) ? feed.data : [])
    .filter((item) => item?.headline)
    .slice(0, 10);
  let delivered = 0;
  for (const article of articles) {
    const id = article.id || article.url || `${article.headline}:${article.datetime || ''}`;
    const published = Number(article.datetime);
    const publishedAt = published > 1e12 ? published : published * 1000;
    if (publishedAt > 0 && (Date.now() - publishedAt > 24 * 60 * 60_000 || publishedAt > Date.now() + 60_000)) continue;
    const externalKey = `market-news:${stableKey(id)}`;
    for (const { user_id: userId, updated_at: enabledAt } of users) {
      if (publishedAt > 0 && publishedAt < new Date(enabledAt).getTime()) continue;
      const record = notify({
        userId,
        category: 'news',
        level: 'info',
        title: String(article.headline).slice(0, 160),
        body: `${article.source || feed.provider || 'Market news'}${article.url ? ` · ${article.url}` : ''}`,
        externalKey,
      });
      if (record) delivered += 1;
    }
  }
  return delivered;
};

export const registerNotificationRoutes = (app) => {
  app.get('/api/notifications', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Please sign in to read notifications.', 'not_authenticated');
    try {
      res.json(listNotifications(user.id, req.query.limit, user));
    } catch (error) {
      fail(res, 503, 'Notifications are temporarily unavailable.', 'notifications_unavailable');
    }
  });

  app.post('/api/notifications/read', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Please sign in to update notifications.', 'not_authenticated');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, MAX_LIMIT) : [];
    const at = new Date().toISOString();
    try {
      const db = getDatabase();
      if (ids.length === 0) {
        db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', at, user.id);
      } else {
        const placeholders = ids.map(() => '?').join(',');
        db.run(
          `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
          at, user.id, ...ids,
        );
      }
      res.json({ ok: true, ...listNotifications(user.id, 40, user) });
    } catch (error) {
      fail(res, 503, 'Notifications are temporarily unavailable.', 'notifications_unavailable');
    }
  });

  app.put('/api/notifications/preferences', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Please sign in to update notification preferences.', 'not_authenticated');
    const body = req.body || {};
    if (typeof body.emailEnabled !== 'boolean' || typeof body.newsEnabled !== 'boolean') {
      return fail(res, 400, 'Choose email and market-news notification preferences.', 'invalid_preferences');
    }
    if (body.emailEnabled && !emailAddressFor(user)) return fail(res, 400, 'Add a usable email address to your account before enabling email alerts.', 'email_required');
    const at = new Date().toISOString();
    try {
      getDatabase().run(
        `INSERT INTO notification_preferences (user_id, email_enabled, news_enabled, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET email_enabled = excluded.email_enabled, news_enabled = excluded.news_enabled, updated_at = excluded.updated_at`,
        user.id, body.emailEnabled ? 1 : 0, body.newsEnabled ? 1 : 0, at,
      );
      res.json({ ok: true, ...listNotifications(user.id, 40, user) });
    } catch (error) {
      fail(res, 503, 'Notification preferences could not be saved.', 'preferences_unavailable');
    }
  });

  app.post('/api/notifications/price-alerts', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Sign in to save account price alerts.', 'not_authenticated');
    const symbol = String(req.body?.symbol || '').trim().toUpperCase().replace(/^(NSE|BSE):/, '');
    const direction = String(req.body?.direction || '').toLowerCase();
    const purpose = String(req.body?.purpose || 'target').toLowerCase();
    const target = Number(req.body?.target);
    if (!/^[A-Z0-9&.\-]{1,20}$/.test(symbol)) return fail(res, 400, 'Enter a valid market symbol.', 'invalid_symbol');
    if (!['above', 'below'].includes(direction)) return fail(res, 400, 'Choose above or below.', 'invalid_direction');
    if (!['target', 'stop_loss', 'take_profit'].includes(purpose)) return fail(res, 400, 'Choose target, stop-loss or take-profit.', 'invalid_alert_purpose');
    if (!Number.isFinite(target) || target <= 0 || target > 1_000_000_000) return fail(res, 400, 'Enter a valid positive target price.', 'invalid_target');
    const db = getDatabase();
    const activeCount = Number(db.get("SELECT COUNT(*) AS count FROM price_alerts WHERE user_id = ? AND status = 'pending'", user.id)?.count || 0);
    if (activeCount >= MAX_PENDING_PRICE_ALERTS) return fail(res, 409, `An account can have at most ${MAX_PENDING_PRICE_ALERTS} pending price alerts.`, 'alert_limit_reached');
    const id = `ALT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const at = new Date().toISOString();
    db.run(
      "INSERT INTO price_alerts (id, user_id, symbol, direction, purpose, target, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      id, user.id, symbol, direction, purpose, target, at,
    );
    const alert = db.get('SELECT * FROM price_alerts WHERE id = ? AND user_id = ?', id, user.id);
    res.status(201).json({ alert: publicPriceAlert(alert), priceAlerts: listPriceAlerts(user.id) });
  });

  app.delete('/api/notifications/price-alerts/:id', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Sign in to remove account price alerts.', 'not_authenticated');
    const result = getDatabase().run('DELETE FROM price_alerts WHERE id = ? AND user_id = ?', String(req.params.id), user.id);
    if (Number(result.changes) !== 1) return fail(res, 404, 'Price alert was not found.', 'alert_not_found');
    res.json({ ok: true, priceAlerts: listPriceAlerts(user.id) });
  });

  app.post('/api/notifications/push-subscriptions', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Sign in to enable device push notifications.', 'not_authenticated');
    try {
      const config = ensureVapid();
      if (!config.configured) return fail(res, 503, `Background push is not configured. Set ${config.missing.join(', ')} on the server.`, 'push_not_configured');
    } catch (error) {
      return fail(res, 503, 'The server Web Push keys are invalid.', 'push_configuration_invalid');
    }
    const subscription = req.body;
    let endpoint;
    try { endpoint = new URL(String(subscription?.endpoint || '')); } catch { return fail(res, 400, 'A valid Push API endpoint is required.', 'invalid_subscription'); }
    if (endpoint.protocol !== 'https:' || !isSupportedPushEndpoint(endpoint)
      || typeof subscription?.keys?.p256dh !== 'string' || typeof subscription?.keys?.auth !== 'string'
      || subscription.keys.p256dh.length > 256 || subscription.keys.auth.length > 128) {
      return fail(res, 400, 'The browser push subscription is incomplete or uses an unsupported push provider.', 'invalid_subscription');
    }
    const canonicalEndpoint = endpoint.toString();
    const endpointHash = stableKey(canonicalEndpoint);
    const db = getDatabase();
    const existing = db.get('SELECT user_id FROM push_subscriptions WHERE endpoint_hash = ?', endpointHash);
    if (existing && existing.user_id !== user.id) return fail(res, 409, 'This device subscription is linked to another account.', 'subscription_owned');
    const at = new Date().toISOString();
    db.run(
      `INSERT INTO push_subscriptions (endpoint_hash, user_id, endpoint, subscription_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint_hash) DO UPDATE SET subscription_json = excluded.subscription_json, updated_at = excluded.updated_at`,
      endpointHash, user.id, canonicalEndpoint, JSON.stringify(subscription), at, at,
    );
    res.status(201).json({ ok: true, channels: notificationChannels(user) });
  });

  app.delete('/api/notifications/push-subscriptions', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Sign in to disable device push notifications.', 'not_authenticated');
    let endpoint;
    try { endpoint = new URL(String(req.body?.endpoint || '')).toString(); } catch { return fail(res, 400, 'The device endpoint is invalid.', 'invalid_subscription'); }
    getDatabase().run('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?', stableKey(endpoint), user.id);
    res.json({ ok: true, channels: notificationChannels(user) });
  });

  app.post('/api/notifications/test-push', (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Sign in to test browser push delivery.', 'not_authenticated');
    if (!vapidConfig().configured) return fail(res, 503, 'Configure Web Push keys on the server first.', 'push_not_configured');
    if (!subscriptionRowsFor(user.id).length) return fail(res, 409, 'Enable push on this device first.', 'push_subscription_missing');
    const record = notify({ userId: user.id, category: 'notification_test', level: 'info', title: 'Push delivery test', body: 'Background browser notifications are connected.' });
    res.status(202).json({ queued: Boolean(record), channels: notificationChannels(user) });
  });

  app.post('/api/notifications/test-email', async (req, res) => {
    const user = readSessionUser(req);
    if (!user) return fail(res, 401, 'Please sign in to test email delivery.', 'not_authenticated');
    const status = emailStatus();
    if (!status.configured) {
      return res.status(503).json({
        error: `Email delivery is not configured. Set ${status.missing.join(', ')} on the server.`,
        code: 'email_not_configured',
        channels: notificationChannels(user),
      });
    }
    const recipient = emailAddressFor(user);
    if (!recipient) return fail(res, 400, 'This account has no usable email address.', 'missing_email');
    const result = await sendEmail({
      to: recipient,
      subject: '[ShareMarket Pro] Test email delivery',
      text: 'Email delivery from ShareMarket Pro is connected. Trade, order, risk, price and opted-in market-news alerts will be emailed to this address.',
    });
    if (!result.sent) return fail(res, 502, `Email delivery failed (${result.reason}).`, 'email_delivery_failed');
    res.json({ sent: true, to: recipient, messageId: result.messageId || null });
  });
};
