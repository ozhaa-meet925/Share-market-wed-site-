import { useState, useEffect } from 'react';
import { BellRing, ExternalLink, Trash2, ShieldCheck, Volume2 } from 'lucide-react';
import { useMarketNews } from '../hooks/useMarketNews';
import { getAlerts, removeAlert, requestAlertPermission } from '../services/alerts';
import { soundEffects } from '../services/sounds';

const notifications = [
  ['Price Alert', 'RELIANCE alert is waiting for a current provider quote.'],
  ['Portfolio', 'Your simulated SBIN position is up today.'],
  ['IPO', 'Medix Labs IPO closes soon. Review lot size and dates.'],
  ['Risk', 'This project uses demo data. Verify live prices before decisions.'],
];

const Notifications = () => {
  const [alerts, setAlerts] = useState(() => getAlerts());
  const [permission, setPermission] = useState(() => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'));
  const { news, isLive } = useMarketNews();

  const deleteAlert = (id) => setAlerts(removeAlert(id));

  const handleEnableNotifications = async () => {
    const status = await requestAlertPermission();
    setPermission(status);
    if (status === 'granted') {
      soundEffects.playOrderSuccess();
      try {
        new Notification('🔔 Price Alerts Active!', {
          body: 'You will now receive desktop / browser alerts when your target stock prices are hit.',
          icon: '/favicon.svg',
        });
      } catch (e) {}
    }
  };

  const handleTestChime = () => {
    soundEffects.playOrderSuccess();
  };

  return (
    <div className="page">
      <div className="page-title">
        <div>
          <span>Real-time Triggers</span>
          <h1>Price Alerts & Notifications</h1>
        </div>
        <div className="alerts-top-actions">
          {permission !== 'granted' ? (
            <button
              type="button"
              className="primary-button"
              onClick={handleEnableNotifications}
            >
              <BellRing size={16} /> Enable Browser Alerts
            </button>
          ) : (
            <span className="permission-active-pill">
              <ShieldCheck size={16} /> Browser Alerts Active
            </span>
          )}
          <div className="ringtone-picker-wrap">
            <label htmlFor="ringtone-select" className="ringtone-label">
              <BellRing size={15} /> Ringtone:
            </label>
            <select
              id="ringtone-select"
              className="ringtone-select"
              value={soundEffects.getTone()}
              onChange={(e) => {
                const newTone = e.target.value;
                soundEffects.setTone(newTone);
                soundEffects.playAlert(newTone);
              }}
            >
              <option value="bell">🔔 Temple Bell (Default)</option>
              <option value="chime">✨ Clean Chime</option>
              <option value="digital">⚡ Digital Pulse</option>
              <option value="cash">💰 Cash Register</option>
              <option value="marimba">🎵 Soft Marimba</option>
            </select>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => soundEffects.playAlert()}
            title="Play Ringtone"
          >
            <Volume2 size={16} /> Test Ringtone Bell
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="compact-list">
          {alerts.map((alert) => (
            <div className="compact-row notification-row" key={alert.id}>
              <BellRing size={20} />
              <div>
                <strong>{alert.symbol} price alert</strong>
                <span>{alert.triggered ? `Triggered at Rs ${alert.triggeredPrice}` : `Waiting for price to go ${alert.direction} Rs ${alert.target}`}</span>
              </div>
              <button className="notification-delete" type="button" aria-label={`Delete ${alert.symbol} price alert`} onClick={() => deleteAlert(alert.id)}><Trash2 size={17} /></button>
            </div>
          ))}
          {notifications.map(([title, text]) => (
            <div className="compact-row notification-row" key={title}>
              <BellRing size={20} />
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
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
