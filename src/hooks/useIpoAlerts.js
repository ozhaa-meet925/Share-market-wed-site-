import { useCallback, useEffect, useState } from 'react';

const ALERTS_KEY = 'sharemarket-ipo-alerts-v1';
const SENT_ALERTS_KEY = 'sharemarket-ipo-alerts-sent-v1';
const snapshotFields = ['company', 'status', 'openDate', 'closeDate', 'allotmentDate', 'listingDate'];
const events = [
  ['openDate', 'Issue opens'],
  ['closeDate', 'Issue closes'],
  ['allotmentDate', 'Allotment date'],
  ['listingDate', 'Listing date'],
];

const readArray = (key) => {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const dateKeyInIndia = (value) => {
  const raw = String(value || '').trim();
  if (!raw || /^(—|not provided|n\/a)$/i.test(raw)) return '';
  const isoDate = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoDate) return isoDate[1];
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(timestamp))
    : '';
};

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export const useIpoAlerts = (ipos = []) => {
  const [alertIpos, setAlertIpos] = useState(() => readArray(ALERTS_KEY));
  const [permission, setPermission] = useState(() => (
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
  ));
  const [message, setMessage] = useState('');

  useEffect(() => {
    const sync = (event) => {
      if (event.key === ALERTS_KEY) setAlertIpos(readArray(ALERTS_KEY));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const toggleAlert = useCallback((ipo) => {
    if (!ipo?.id) return;
    setAlertIpos((current) => {
      const id = String(ipo.id);
      const next = current.some((item) => String(item.id) === id)
        ? current.filter((item) => String(item.id) !== id)
        : [...current, {
          id,
          ...Object.fromEntries(snapshotFields
            .filter((field) => ipo[field] !== undefined && ipo[field] !== null)
            .map((field) => [field, ipo[field]])),
        }];
      window.localStorage.setItem(ALERTS_KEY, JSON.stringify(next));
      return next;
    });
    setMessage('IPO reminder preference saved in this browser.');
  }, []);

  const isAlerted = useCallback(
    (ipoId) => alertIpos.some((item) => String(item.id) === String(ipoId)),
    [alertIpos],
  );

  const enableBrowserAlerts = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      setMessage('This browser does not support notifications.');
      return;
    }
    try {
      const nextPermission = await window.Notification.requestPermission();
      setPermission(nextPermission);
      setMessage(nextPermission === 'granted'
        ? 'Browser alerts enabled. IPO reminders run while this page is open.'
        : 'Browser notification permission was not granted. You can change it in browser site settings.');
    } catch {
      setMessage('Could not request browser notification permission.');
    }
  }, []);

  useEffect(() => {
    if (!('Notification' in window) || window.Notification.permission !== 'granted' || alertIpos.length === 0) return undefined;

    const checkDates = () => {
      const today = todayInIndia();
      const sent = new Set(readArray(SENT_ALERTS_KEY));
      let changed = false;

      alertIpos.forEach((saved) => {
        const ipo = ipos.find((item) => String(item.id) === String(saved.id)) || saved;
        events.forEach(([field, label]) => {
          const eventDate = dateKeyInIndia(ipo[field]);
          if (!eventDate || eventDate !== today) return;
          const alertKey = `${saved.id}:${field}:${eventDate}`;
          if (sent.has(alertKey)) return;
          const notification = new window.Notification(`${ipo.company || 'IPO'} · ${label}`, {
            body: `${label} is today. Open the IPO page to review the latest provider information.`,
            tag: alertKey,
          });
          notification.onclick = () => {
            window.focus();
            window.location.assign(`/ipo/${encodeURIComponent(saved.id)}`);
          };
          sent.add(alertKey);
          changed = true;
        });
      });

      if (changed) window.localStorage.setItem(SENT_ALERTS_KEY, JSON.stringify([...sent].slice(-250)));
    };

    checkDates();
    const timer = window.setInterval(checkDates, 60_000);
    return () => window.clearInterval(timer);
  }, [alertIpos, ipos]);

  return {
    alertIpos,
    toggleAlert,
    isAlerted,
    permission,
    enableBrowserAlerts,
    message,
  };
};
