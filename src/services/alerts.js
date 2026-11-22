import { soundEffects } from './sounds';

const STORAGE_KEY = 'sharemarket:price-alerts';
export const ALERTS_EVENT = 'sharemarket:alerts-updated';

const readAlerts = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
};

const writeAlerts = (alerts) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  window.dispatchEvent(new CustomEvent(ALERTS_EVENT, { detail: alerts }));
  return alerts;
};

export const getAlerts = () => readAlerts();

export const getPendingAlerts = () => readAlerts().filter((alert) => !alert.triggered);

export const createAlert = ({ symbol, target, direction }) => {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  const numericTarget = Number(target);
  if (!cleanSymbol) throw new Error('Choose a symbol for this alert.');
  if (!Number.isFinite(numericTarget) || numericTarget <= 0) throw new Error('Enter a valid target price.');
  const alert = {
    id: `${Date.now()}-${cleanSymbol}`,
    symbol: cleanSymbol,
    target: numericTarget,
    direction: direction === 'below' ? 'below' : 'above',
    triggered: false,
    createdAt: new Date().toISOString(),
  };
  writeAlerts([alert, ...readAlerts()]);
  return alert;
};

export const removeAlert = (id) => writeAlerts(readAlerts().filter((alert) => alert.id !== id));

const notifyTriggered = (alert, price, source) => {
  soundEffects.playAlert();
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`Target price hit: ${alert.symbol}`, {
        body: `${alert.symbol} reached ₹${price.toLocaleString('en-IN')} (target ${alert.direction === 'above' ? '≥' : '≤'} ₹${alert.target.toLocaleString('en-IN')}). ${source}`,
        icon: '/favicon.svg',
      });
    } catch {
      // Notification delivery fallback
    }
  }
};

const evaluatePrices = (priceBySymbol, source) => {
  let changed = false;
  const alerts = readAlerts().map((alert) => {
    if (alert.triggered) return alert;
    const price = priceBySymbol.get(alert.symbol);
    if (!Number.isFinite(price) || price <= 0) return alert;
    const reached = alert.direction === 'above' ? price >= alert.target : price <= alert.target;
    if (!reached) return alert;
    changed = true;
    notifyTriggered(alert, price, source);
    return {
      ...alert,
      triggered: true,
      triggeredAt: new Date().toISOString(),
      triggeredPrice: price,
      triggeredOn: source,
    };
  });
  if (changed) writeAlerts(alerts);
  return alerts;
};

export const evaluateAlerts = (stocks, { source = 'current quote' } = {}) => evaluatePrices(
  new Map(stocks.map((stock) => [String(stock.symbol || '').toUpperCase(), Number(stock.price)])),
  source,
);

export const evaluateAlertsFromQuotes = (quotes, { source = 'Yahoo Finance research quote · delayed' } = {}) => {
  const entries = quotes instanceof Map ? [...quotes.entries()] : Object.entries(quotes || {});
  return evaluatePrices(
    new Map(entries.map(([symbol, quote]) => [
      String(symbol || '').replace(/^(NSE|BSE|MCX):/i, '').toUpperCase(),
      Number(quote?.c ?? quote?.price),
    ])),
    source,
  );
};

export const requestAlertPermission = async () => {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      return await Notification.requestPermission();
    }
    return Notification.permission;
  }
  return 'denied';
};
