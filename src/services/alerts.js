import { soundEffects } from './sounds';

const STORAGE_KEY = 'sharemarket:price-alerts';

const readAlerts = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
};

const writeAlerts = (alerts) => localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));

export const getAlerts = () => readAlerts();

export const createAlert = ({ symbol, target, direction }) => {
  const alert = {
    id: `${Date.now()}-${symbol}`,
    symbol,
    target: Number(target),
    direction,
    triggered: false,
    createdAt: new Date().toISOString(),
  };
  const alerts = [alert, ...readAlerts()];
  writeAlerts(alerts);
  return alert;
};

export const removeAlert = (id) => {
  const alerts = readAlerts().filter((alert) => alert.id !== id);
  writeAlerts(alerts);
  return alerts;
};

export const evaluateAlerts = (stocks) => {
  const prices = new Map(stocks.map((stock) => [stock.symbol, stock.price]));
  let changed = false;
  const alerts = readAlerts().map((alert) => {
    const price = prices.get(alert.symbol);
    const reached = price !== undefined && (
      alert.direction === 'above' ? price >= alert.target : price <= alert.target
    );
    if (reached && !alert.triggered) {
      changed = true;
      // Play chosen audible ringtone bell
      soundEffects.playAlert();

      // Dispatch Web Notification if permitted
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`🔔 Target Price Hit: ${alert.symbol}`, {
            body: `${alert.symbol} just reached ₹${price.toLocaleString('en-IN')} (Target: ${alert.direction === 'above' ? '≥' : '≤'} ₹${alert.target.toLocaleString('en-IN')})`,
            icon: '/favicon.svg',
          });
        } catch (e) {
          // Notification delivery fallback
        }
      }

      return { ...alert, triggered: true, triggeredAt: new Date().toISOString(), triggeredPrice: price };
    }
    return alert;
  });
  if (changed) writeAlerts(alerts);
  return alerts;
};

// Request Notification Permission
export const requestAlertPermission = async () => {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      return await Notification.requestPermission();
    }
    return Notification.permission;
  }
  return 'denied';
};
