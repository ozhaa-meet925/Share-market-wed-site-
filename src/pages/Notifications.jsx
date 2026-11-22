import { useCallback, useState, useEffect, useRef } from 'react';
import { BellRing, ExternalLink, Trash2, ShieldCheck, Volume2, BellPlus, Info, CheckCheck, Mail, Smartphone, Send } from 'lucide-react';
import { useMarketNews } from '../hooks/useMarketNews';
import { soundEffects } from '../services/sounds';
import { marketApi } from '../services/api';
import { notificationsApi } from '../services/notifications';
import { coreApi } from '../services/core';
import { stocks as stockSeed } from '../data/stocks';
import './Notifications.css';

const base64UrlToBytes = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
};

const Notifications = () => {
  const [alerts, setAlerts] = useState([]);
  const [preferences, setPreferences] = useState({ emailEnabled: false, newsEnabled: false });
  const [permission, setPermission] = useState(() => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'));
  const [symbol, setSymbol] = useState('RELIANCE');
  const [direction, setDirection] = useState('above');
  const [target, setTarget] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [refQuote, setRefQuote] = useState(null);
  const [refState, setRefState] = useState('idle');
  const [accountFeed, setAccountFeed] = useState(null);
  const [accountFeedError, setAccountFeedError] = useState('');
  const [marking, setMarking] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [devicePushEnabled, setDevicePushEnabled] = useState(false);
  const [calendarReminders, setCalendarReminders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sharemarket.calendar.reminders.v1') || '[]').filter((item) => Number(item.triggerAt) > Date.now()); } catch { return []; }
  });
  const [channelBusy, setChannelBusy] = useState('');
  const [channelMessage, setChannelMessage] = useState('');
  const { news, isLive } = useMarketNews();
  const hasLoadedFeed = useRef(false);
  const seenNotificationIds = useRef(new Set());

  useEffect(() => {
    const syncReminders = (event) => {
      let next = event?.detail;
      if (!Array.isArray(next)) {
        try { next = JSON.parse(localStorage.getItem('sharemarket.calendar.reminders.v1') || '[]'); } catch { next = []; }
      }
      setCalendarReminders(Array.isArray(next) ? next.filter((item) => Number(item.triggerAt) > Date.now()) : []);
    };
    window.addEventListener('sharemarket:calendar-reminders-updated', syncReminders);
    window.addEventListener('storage', syncReminders);
    return () => {
      window.removeEventListener('sharemarket:calendar-reminders-updated', syncReminders);
      window.removeEventListener('storage', syncReminders);
    };
  }, []);

  const loadAccountFeed = useCallback(async () => {
    try {
      const payload = await notificationsApi.list();
      setAccountFeed(payload);
      setAlerts(payload.priceAlerts || []);
      setPreferences(payload.preferences || { emailEnabled: false, newsEnabled: false });
      const unseen = (payload.items || []).filter((item) => !seenNotificationIds.current.has(item.id));
      if (hasLoadedFeed.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        unseen.slice(0, 3).forEach((item) => {
          try {
            new Notification(item.title, { body: item.body || item.category, icon: '/favicon.svg', tag: item.id });
          } catch {
            // Foreground notification delivery is best-effort; the in-app record is retained.
          }
        });
      }
      (payload.items || []).forEach((item) => seenNotificationIds.current.add(item.id));
      hasLoadedFeed.current = true;
      setAccountFeedError('');
    } catch (error) {
      setAccountFeed(null);
      setAlerts([]);
      setPreferences({ emailEnabled: false, newsEnabled: false });
      setAccountFeedError(error.status === 401 ? 'auth' : error.message);
    }
  }, []);

  useEffect(() => { loadAccountFeed(); }, [loadAccountFeed]);

  useEffect(() => {
    const source = new EventSource(coreApi.streamUrl);
    source.addEventListener('core', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (['notification.created', 'notification.read'].includes(payload.topic)) loadAccountFeed();
      } catch {
        // Polling below remains the fallback for malformed stream events.
      }
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadAccountFeed();
    }, 30_000);
    return () => {
      source.close();
      window.clearInterval(timer);
    };
  }, [loadAccountFeed]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration('/').then((registration) => registration?.pushManager?.getSubscription())
      .then((subscription) => setDevicePushEnabled(Boolean(subscription)))
      .catch(() => setDevicePushEnabled(false));
  }, []);

  const markAllRead = async () => {
    setMarking(true);
    try {
      setAccountFeed(await notificationsApi.markRead());
    } catch (error) {
      setAccountFeedError(error.message);
    } finally {
      setMarking(false);
    }
  };

  const refreshFromPayload = (payload) => {
    setAccountFeed(payload);
    setAlerts(payload.priceAlerts || []);
    setPreferences(payload.preferences || { emailEnabled: false, newsEnabled: false });
  };

  useEffect(() => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      setRefQuote(null);
      setRefState('idle');
      return undefined;
    }
    let active = true;
    setRefState('loading');
    const timer = setTimeout(async () => {
      try {
        const payload = await marketApi.getBatchQuotes([clean]);
        const quote = payload?.quotes?.[clean] || Object.values(payload?.quotes || {})[0];
        if (!active) return;
        if (Number(quote?.c) > 0 && quote?.isDemo !== true) {
          const provider = quote.provider || 'Provider';
          const basis = quote.isStale === true ? `${provider} · stale`
            : quote.isLive === true ? `${provider} · live`
              : quote.isClose === true ? `${provider} · exchange close`
              : quote.isResearch === true || quote.isDelayed === true || quote.isReal === true ? `${provider} · research / delayed`
                  : `${provider} · classification unavailable`;
          const rawTimestamp = quote.timestamp;
          const numericTimestamp = Number(rawTimestamp);
          const timestamp = numericTimestamp > 0
            ? (numericTimestamp > 1e12 ? numericTimestamp / 1000 : numericTimestamp)
            : typeof rawTimestamp === 'string' && Number.isFinite(Date.parse(rawTimestamp))
              ? Date.parse(rawTimestamp) / 1000
              : null;
          setRefQuote({
            price: Number(quote.c),
            changePercent: Number.isFinite(Number(quote.dp)) ? Number(quote.dp) : null,
            timestamp,
            basis,
          });
          setRefState('ready');
        } else {
          setRefQuote(null);
          setRefState('unavailable');
        }
      } catch {
        if (!active) return;
        setRefQuote(null);
        setRefState('unavailable');
      }
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [symbol]);

  const deleteAlert = async (id) => {
    try {
      const payload = await notificationsApi.deletePriceAlert(id);
      setAlerts(payload.priceAlerts || []);
      setChannelMessage('Price alert removed from this account.');
    } catch (error) {
      setChannelMessage(error.message);
    }
  };

  const handleCreateAlert = async (event) => {
    event.preventDefault();
    try {
      const payload = await notificationsApi.createPriceAlert({ symbol, target: Number(target), direction });
      setAlerts(payload.priceAlerts || []);
      setFormMessage(`${symbol.trim().toUpperCase()} alert saved to your account. The server checks verified provider quotes when its notification scheduler runs.`);
      setTarget('');
    } catch (error) {
      setFormMessage(error.message);
    }
  };

  const handleEnableNotifications = async () => {
    if (!('Notification' in window)) {
      setChannelMessage('This browser does not support notifications.');
      return;
    }
    setPushBusy(true);
    setChannelMessage('');
    try {
      const status = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      setPermission(status);
      if (status !== 'granted') {
        setChannelMessage('Notification permission was not granted.');
        return;
      }
      soundEffects.playOrderSuccess();
      const push = accountFeed?.channels?.push;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setChannelMessage('Browser notifications are allowed in this tab, but this browser does not support background Web Push.');
        return;
      }
      if (!push?.configured || !push.publicKey) {
        setChannelMessage(`Browser permission is enabled. ${push?.reason || 'Background push server keys are not configured yet.'}`);
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(push.publicKey),
        });
      const payload = await notificationsApi.savePushSubscription(subscription.toJSON());
      if (accountFeed) refreshFromPayload({ ...accountFeed, channels: payload.channels });
      setDevicePushEnabled(true);
      setChannelMessage('Background push is enabled for this device.');
    } catch (error) {
      setChannelMessage(error.message || 'Browser push could not be enabled.');
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    setChannelMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager?.getSubscription();
      if (subscription) {
        await notificationsApi.removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setDevicePushEnabled(false);
      await loadAccountFeed();
      setChannelMessage('Background push was disabled for this device.');
    } catch (error) {
      setChannelMessage(error.message || 'Push could not be disabled.');
    } finally {
      setPushBusy(false);
    }
  };

  const updatePreference = async (key, checked) => {
    const next = { ...preferences, [key]: checked };
    setChannelBusy(key);
    setChannelMessage('');
    try {
      refreshFromPayload(await notificationsApi.savePreferences(next));
      setChannelMessage('Notification preferences saved.');
    } catch (error) {
      setChannelMessage(error.message);
    } finally {
      setChannelBusy('');
    }
  };

  const testEmail = async () => {
    setChannelBusy('email-test');
    setChannelMessage('');
    try {
      const payload = await notificationsApi.testEmail();
      setChannelMessage(`Test email sent to ${payload.to}.`);
    } catch (error) {
      setChannelMessage(error.message);
    } finally {
      setChannelBusy('');
    }
  };

  const testPush = async () => {
    setChannelBusy('push-test');
    setChannelMessage('');
    try {
      await notificationsApi.testPush();
      setChannelMessage('Push test notification queued for this device.');
    } catch (error) {
      setChannelMessage(error.message);
    } finally {
      setChannelBusy('');
    }
  };

  const pendingAlerts = alerts.filter((alert) => !alert.triggered);
  const triggeredAlerts = alerts.filter((alert) => alert.triggered);

  return (
    <div className="page">
      <div className="page-title">
        <div>
          <span>Price triggers</span>
          <h1>Price Alerts & Notifications</h1>
        </div>
        <div className="alerts-top-actions">
          <button type="button" className="primary-button" onClick={devicePushEnabled ? disablePush : handleEnableNotifications} disabled={pushBusy || !accountFeed} title={accountFeed?.channels?.push?.reason || undefined}>
            <BellRing size={16} /> {pushBusy ? 'Updating…' : devicePushEnabled ? 'Disable background push' : 'Enable browser push'}
          </button>
          {permission === 'granted' && !devicePushEnabled ? <span className="permission-active-pill"><ShieldCheck size={16} /> Browser permission enabled</span> : null}
          <div className="ringtone-picker-wrap">
            <label htmlFor="ringtone-select" className="ringtone-label">
              <BellRing size={15} /> Ringtone:
            </label>
            <select
              id="ringtone-select"
              className="ringtone-select"
              value={soundEffects.getTone()}
              onChange={(event) => {
                const newTone = event.target.value;
                soundEffects.setTone(newTone);
                soundEffects.playAlert(newTone);
              }}
            >
              <option value="bell">Temple Bell (Default)</option>
              <option value="chime">Clean Chime</option>
              <option value="digital">Digital Pulse</option>
              <option value="cash">Cash Register</option>
              <option value="marimba">Soft Marimba</option>
            </select>
          </div>
          <button type="button" className="secondary-button" onClick={() => soundEffects.playAlert()} title="Play ringtone">
            <Volume2 size={16} /> Test Ringtone
          </button>
        </div>
      </div>

      <section className="panel alert-create-panel">
        <div className="section-heading">
          <div>
            <span>New trigger</span>
            <h2>Create a price alert</h2>
          </div>
          <BellPlus size={22} />
        </div>
        <form className="alert-create-form" onSubmit={handleCreateAlert}>
          <label>
            Symbol
            <input
              list="alert-symbol-options"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="e.g. RELIANCE"
              required
            />
            <datalist id="alert-symbol-options">
              {stockSeed.map((stock) => <option key={stock.symbol} value={stock.symbol}>{stock.name}</option>)}
            </datalist>
          </label>
          <label>
            Condition
            <select value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="above">Goes above</option>
              <option value="below">Goes below</option>
            </select>
          </label>
          <label>
            Target price (₹)
            <input type="number" min="0.01" step="0.01" value={target} onChange={(event) => setTarget(event.target.value)} required />
          </label>
          <button type="submit" className="primary-button"><BellPlus size={16} /> Save alert</button>
        </form>
        <p className="alert-quote-ref" aria-live="polite">
          {refState === 'loading' ? <span>Checking the latest research quote…</span> : null}
          {refState === 'ready' && refQuote ? (
            <>
              <span>
                Latest {refQuote.basis} quote: <strong>₹{refQuote.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                {refQuote.changePercent === null ? '' : ` (${refQuote.changePercent >= 0 ? '+' : ''}${refQuote.changePercent.toFixed(2)}%)`}
                {refQuote.timestamp ? ` · ${new Date(refQuote.timestamp * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
              </span>
              <button type="button" onClick={() => setTarget(String(refQuote.price))}>Use this price</button>
            </>
          ) : null}
          {refState === 'unavailable' ? <span>No verified quote for this symbol right now. The alert is checked again when a quote arrives.</span> : null}
        </p>
        {formMessage ? <p className="alert-form-message" role="status">{formMessage}</p> : null}
        <p className="alert-source-note">
          <Info size={14} /> The server checks pending alerts when its notification scheduler runs. Serverless deployments need an external scheduler; see the notification setup guide. Demo, stale, undated, and unclassified quotes are ignored, and research or exchange-close triggers can arrive after the market move.
        </p>
      </section>

      <section className="panel account-notifications">
        <div className="section-heading">
          <div>
            <span>Account events</span>
            <h2>Order &amp; risk notifications</h2>
          </div>
          {accountFeed && accountFeed.unread > 0 ? (
            <button type="button" className="secondary-button" onClick={markAllRead} disabled={marking}>
              <CheckCheck size={15} /> {marking ? 'Marking…' : `Mark ${accountFeed.unread} read`}
            </button>
          ) : null}
        </div>

        {accountFeed ? (
          <div className="notification-channels">
            <span className="channel-pill on">In-app · active</span>
            <span className={`channel-pill ${accountFeed.channels.email.enabled ? 'on' : 'off'}`} title={accountFeed.channels.email.reason}>
              <Mail size={13} /> Email · {accountFeed.channels.email.enabled ? 'enabled' : accountFeed.channels.email.configured ? 'opt in below' : 'needs SMTP'}
            </span>
            <span className={`channel-pill ${devicePushEnabled ? 'on' : 'off'}`} title={accountFeed.channels.push.reason}>
              <Smartphone size={13} /> Push · {devicePushEnabled ? 'this device enabled' : accountFeed.channels.push.configured ? 'device not subscribed' : 'needs server keys'}
            </span>
          </div>
        ) : null}

        {accountFeed ? (
          <div className="notification-preferences">
            <label>
              <input
                type="checkbox"
                checked={preferences.emailEnabled}
                disabled={channelBusy === 'emailEnabled' || !accountFeed.channels.email.recipientConfigured}
                onChange={(event) => updatePreference('emailEnabled', event.target.checked)}
              />
              <span><strong>Email account, risk and price alerts</strong><small>{accountFeed.channels.email.recipientConfigured ? `${accountFeed.channels.email.reason} This includes triggered price alerts.` : 'Add an email address to your account to enable email delivery for account and price alerts.'}</small></span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={preferences.newsEnabled}
                disabled={channelBusy === 'newsEnabled'}
                onChange={(event) => updatePreference('newsEnabled', event.target.checked)}
              />
              <span><strong>Market news alerts</strong><small>New headlines are saved to your account and delivered through enabled email and push channels.</small></span>
            </label>
            <div className="notification-preference-actions">
              {accountFeed.channels.email.configured && accountFeed.channels.email.recipientConfigured ? (
                <button type="button" className="secondary-button" onClick={testEmail} disabled={channelBusy === 'email-test'}>
                  <Mail size={14} /> {channelBusy === 'email-test' ? 'Sending…' : 'Send email test'}
                </button>
              ) : null}
              {devicePushEnabled ? (
                <button type="button" className="secondary-button" onClick={testPush} disabled={channelBusy === 'push-test'}>
                  <Send size={14} /> {channelBusy === 'push-test' ? 'Queueing…' : 'Send push test'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {channelMessage ? <p className="alert-form-message" role="status">{channelMessage}</p> : null}

        {accountFeedError === 'auth' ? (
          <p className="account-feed-note">
            Sign in to save price alerts and manage account notification channels.
          </p>
        ) : accountFeedError ? (
          <p className="account-feed-note bad">{accountFeedError} <button type="button" className="link-button" onClick={loadAccountFeed}>Retry</button></p>
        ) : null}

        {!accountFeed && !accountFeedError ? <p className="account-feed-note">Loading account notifications…</p> : null}

        {accountFeed && accountFeed.items.length === 0 ? (
          <p className="account-feed-note">No account notifications yet. Order, risk and broker events will appear here.</p>
        ) : null}

        {accountFeed && accountFeed.items.length > 0 ? (
          <div className="compact-list">
            {accountFeed.items.slice(0, 12).map((item) => (
              <div className={`compact-row notification-row account-event ${item.readAt ? '' : 'is-unread'}`} key={item.id}>
                {item.level === 'warning' ? <BellRing size={19} /> : item.level === 'success' ? <ShieldCheck size={19} /> : <Info size={19} />}
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.body || item.category}</span>
                  <span className="account-event-meta">
                    {item.category} · {new Date(item.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel calendar-notification-reminders" aria-labelledby="calendar-reminders-title">
        <div className="section-heading">
          <div><span>Market calendar</span><h2 id="calendar-reminders-title">Upcoming calendar reminders</h2></div>
          <BellRing size={19} />
        </div>
        {calendarReminders.length ? (
          <ul>
            {calendarReminders.slice().sort((a, b) => a.triggerAt - b.triggerAt).map((reminder) => (
              <li key={reminder.id}>
                <span><strong>{reminder.title}</strong><small>{reminder.hoursBefore === 24 ? '1 day before' : '1 hour before'} · {new Date(`${reminder.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · browser reminder</small></span>
                <a href="/calendar">Open calendar</a>
              </li>
            ))}
          </ul>
        ) : <p>No upcoming calendar reminders. Set a holiday or market-event reminder from the Calendar page.</p>}
        <small>Calendar reminders are saved on this browser and require the Calendar page to remain open at the reminder time.</small>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span>Saved alerts</span>
            <h2>{pendingAlerts.length} waiting · {triggeredAlerts.length} triggered</h2>
          </div>
        </div>
        <div className="compact-list">
          {alerts.length === 0 ? (
            <div className="compact-row notification-row">
              <BellRing size={20} />
              <div>
                <strong>No price alerts yet</strong>
                <span>Create an alert above or from any stock page.</span>
              </div>
            </div>
          ) : null}
          {alerts.map((alert) => (
            <div className="compact-row notification-row" key={alert.id}>
              <BellRing size={20} />
              <div>
                <strong>{alert.symbol} price alert</strong>
                <span>
                  {alert.triggered
                    ? `Triggered at ₹${Number(alert.triggeredPrice).toLocaleString('en-IN')} · ${alert.triggeredOn || 'quote check'}`
                    : `Waiting for price to go ${alert.direction} ₹${Number(alert.target).toLocaleString('en-IN')}`}
                </span>
              </div>
              <button className="notification-delete" type="button" aria-label={`Delete ${alert.symbol} price alert`} onClick={() => deleteAlert(alert.id)}><Trash2 size={17} /></button>
            </div>
          ))}
          {news.slice(0, 5).map((item, index) => (
            <div className="compact-row notification-row" key={`news-${item.title}-${index}`}>
              <BellRing size={20} />
              <div>
                <strong>{isLive ? 'Live market news' : 'Market news'}</strong>
                <span>{item.title} · {item.time}</span>
              </div>
              {item.url ? <a className="notification-news-link" href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title}`}><ExternalLink size={17} /></a> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Notifications;
