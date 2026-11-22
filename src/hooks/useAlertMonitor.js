import { useEffect } from 'react';
import { marketApi } from '../services/api';
import { ALERTS_EVENT, evaluateAlertsFromQuotes, getPendingAlerts } from '../services/alerts';

const CHECK_INTERVAL_MS = 60_000;
const MAX_ALERT_SYMBOLS = 100;

export default function useAlertMonitor() {
  useEffect(() => {
    let active = true;
    let busy = false;
    let lastRun = 0;

    const check = async (force = false) => {
      if (!active || busy) return;
      if (!force && Date.now() - lastRun < 5_000) return;
      const pending = getPendingAlerts();
      if (!pending.length) return;
      const symbols = [...new Set(pending.map((alert) => alert.symbol))].slice(0, MAX_ALERT_SYMBOLS);
      busy = true;
      lastRun = Date.now();
      try {
        const payload = await marketApi.getBatchQuotes(symbols);
        if (!active) return;
        evaluateAlertsFromQuotes(payload?.quotes || {}, {
          source: 'Yahoo Finance research quote · delayed',
        });
      } catch {
        // Keep the alerts pending; the next cycle retries.
      } finally {
        busy = false;
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    const onAlertsChanged = () => check(true);
    const onStorage = (event) => {
      if (event.key === 'sharemarket:price-alerts' || event.key === null) check(true);
    };

    check(true);
    const intervalId = window.setInterval(checkWhenVisible, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('focus', checkWhenVisible);
    window.addEventListener(ALERTS_EVENT, onAlertsChanged);
    window.addEventListener('storage', onStorage);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('focus', checkWhenVisible);
      window.removeEventListener(ALERTS_EVENT, onAlertsChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
}
