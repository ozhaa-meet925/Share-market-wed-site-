import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Activity,
  Bell,
  BellRing,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Landmark,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { marketApi } from '../services/api';
import './Calendar.css';

const calendars = [
  { id: 'economic', label: 'Economic', title: 'Economic Calendar', icon: Sparkles, description: 'Economic releases and indicators' },
  { id: 'holidays', label: 'Holidays', title: 'Holiday Calendar', icon: Landmark, description: 'Upcoming exchange closures' },
  { id: 'earnings', label: 'Earnings', title: 'Earnings Calendar', icon: CircleDollarSign, description: 'Company result dates' },
  { id: 'dividends', label: 'Dividends', title: 'Dividend Calendar', icon: CircleDollarSign, description: 'Declared dividend events' },
  { id: 'splits', label: 'Splits', title: 'Splits Calendar', icon: Landmark, description: 'Stock split announcements' },
  { id: 'ipos', label: 'IPOs', title: 'IPO Calendar', icon: CircleDollarSign, description: 'New issue dates and listings' },
  { id: 'expiries', label: 'Futures expiry', title: 'Futures Expiry Calendar', icon: Clock3, description: 'NSE monthly derivatives expiry' },
];

const ranges = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

const toDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatCalendarDate = (value) => {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', weekday: 'short' }).format(date);
};

const formatCalendarTableDate = (value) => {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const formatCalendarGroupDate = (value) => {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
};

const formatCalendarMonth = (year, month) => new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
}).format(new Date(year, month, 1));

const formatTodayDate = (date) => new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
}).format(date);

const formatUpdatedAt = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const CALENDAR_REMINDER_STORAGE_KEY = 'sharemarket.calendar.reminders.v1';

const readCalendarReminders = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CALENDAR_REMINDER_STORAGE_KEY) || '[]');
    return Array.isArray(stored)
      ? stored.filter((reminder) => reminder?.id && reminder?.title && reminder?.date && Number.isFinite(reminder.triggerAt) && Number.isFinite(reminder.eventAt))
      : [];
  } catch {
    return [];
  }
};

const getEventDateTimeInIst = (event) => {
  const time = String(event.time || '').trim().toLowerCase();
  let hour = 9;
  let minute = 0;
  if (time === 'bmo' || time.includes('before market')) {
    hour = 9;
    minute = 15;
  } else if (time === 'amc' || time.includes('after market')) {
    hour = 15;
    minute = 30;
  } else {
    const match = time.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);
    if (match) {
      hour = Number(match[1]);
      minute = Number(match[2] || 0);
      if (match[3]) {
        if (hour < 1 || hour > 12) return new Date(`${event.date}T09:00:00+05:30`).getTime();
        if (match[3] === 'pm' && hour < 12) hour += 12;
        if (match[3] === 'am' && hour === 12) hour = 0;
      }
      if (hour > 23 || minute > 59) return new Date(`${event.date}T09:00:00+05:30`).getTime();
    }
  }
  return new Date(`${event.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`).getTime();
};

const formatEventTimeInIst = (value) => new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
}).format(new Date(value));

const getCalendarDaysUntil = (date, today) => {
  const [year, month, day] = date.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86_400_000);
};

const formatReminderAt = (value) => new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
}).format(new Date(value));

const Calendar = () => {
  const [activeKind, setActiveKind] = useState('holidays');
  const [rangeDays, setRangeDays] = useState(365);
  const [query, setQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [expiryRefreshKey, setExpiryRefreshKey] = useState(0);
  const forceNextRefresh = useRef(false);
  const forceExpiryRefresh = useRef(false);
  const [feed, setFeed] = useState(null);
  const [expiryFeed, setExpiryFeed] = useState(null);
  const [expiryError, setExpiryError] = useState(false);
  const [reminders, setReminders] = useState(readCalendarReminders);
  const [openReminderId, setOpenReminderId] = useState(null);
  const [showReminders, setShowReminders] = useState(false);
  const [reminderMessage, setReminderMessage] = useState('');
  const [notificationPermission, setNotificationPermission] = useState(() => (
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
  ));
  const deliveredReminders = useRef(new Set());
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const today = new Date(clockNow);
  const from = toDateInputValue(today);
  const todayKey = from;
  const through = new Date(today);
  through.setDate(through.getDate() + rangeDays - 1);
  const to = toDateInputValue(through);
  const expiryThrough = new Date(today);
  expiryThrough.setDate(expiryThrough.getDate() + 90);
  const expiryTo = toDateInputValue(expiryThrough);
  const activeCalendar = calendars.find((calendar) => calendar.id === activeKind) || calendars[0];
  const ActiveIcon = activeCalendar.icon;
  const exchangeLabel = {
    economic: 'Economic indicators',
    holidays: 'NSE India',
    earnings: 'NSE / BSE',
    dividends: 'NSE / BSE',
    splits: 'NSE / BSE',
    ipos: 'NSE / BSE',
    expiries: 'NSE derivatives',
  }[activeKind] || 'India market';

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let isCurrent = true;
    let autoRefreshTimer;
    const forceRefresh = forceNextRefresh.current;
    forceNextRefresh.current = false;
    setLoading(true);
    setError(null);
    setFeed(null);

    marketApi.getCalendar(activeKind, from, to, forceRefresh)
      .then((payload) => {
        if (!isCurrent) return;
        setFeed(payload);
        if (activeKind === 'expiries') {
          setExpiryFeed(payload);
          setExpiryError(false);
        }
        const ageMs = payload.lastUpdated ? Date.now() - new Date(payload.lastUpdated).getTime() : 0;
        const refreshAfterMs = payload.stale
          ? 60_000
          : Math.max(30_000, Number(payload.refreshIntervalMs || 10 * 60 * 1000) - Math.max(0, ageMs));
        autoRefreshTimer = window.setTimeout(() => setRefreshKey((key) => key + 1), refreshAfterMs);
      })
      .catch((requestError) => {
        if (!isCurrent) return;
        setError(requestError);
        if (requestError.code !== 'calendar_provider_not_configured') {
          autoRefreshTimer = window.setTimeout(() => setRefreshKey((key) => key + 1), 90_000);
        }
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });

    return () => {
      isCurrent = false;
      if (autoRefreshTimer) window.clearTimeout(autoRefreshTimer);
    };
  }, [activeKind, from, to, refreshKey]);

  useEffect(() => {
    if (activeKind === 'expiries') return undefined;
    let isCurrent = true;
    let autoRefreshTimer;
    const forceRefresh = forceExpiryRefresh.current;
    forceExpiryRefresh.current = false;

    marketApi.getCalendar('expiries', from, expiryTo, forceRefresh)
      .then((payload) => {
        if (!isCurrent) return;
        setExpiryFeed(payload);
        setExpiryError(false);
        const ageMs = payload.lastUpdated ? Date.now() - new Date(payload.lastUpdated).getTime() : 0;
        const refreshAfterMs = payload.stale
          ? 60_000
          : Math.max(30_000, Number(payload.refreshIntervalMs || 10 * 60 * 1000) - Math.max(0, ageMs));
        autoRefreshTimer = window.setTimeout(() => setExpiryRefreshKey((key) => key + 1), refreshAfterMs);
      })
      .catch(() => {
        if (!isCurrent) return;
        setExpiryError(true);
        autoRefreshTimer = window.setTimeout(() => setExpiryRefreshKey((key) => key + 1), 90_000);
      });

    return () => {
      isCurrent = false;
      if (autoRefreshTimer) window.clearTimeout(autoRefreshTimer);
    };
  }, [activeKind, from, expiryTo, expiryRefreshKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CALENDAR_REMINDER_STORAGE_KEY, JSON.stringify(reminders));
    } catch {
      setReminderMessage('This browser could not save reminders locally.');
    }
  }, [reminders]);

  useEffect(() => {
    const deliverDueReminders = () => {
      const now = Date.now();
      const expiredIds = new Set(reminders.filter((reminder) => reminder.eventAt <= now).map((reminder) => reminder.id));
      const dueReminders = reminders.filter((reminder) => (
        reminder.triggerAt <= now && reminder.eventAt > now && !deliveredReminders.current.has(reminder.id)
      ));
      if (!expiredIds.size && !dueReminders.length) return;

      dueReminders.forEach((reminder) => {
        deliveredReminders.current.add(reminder.id);
        if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
          try {
            const notification = new window.Notification('Market calendar reminder', {
              body: `${reminder.title} · Today at ${reminder.eventTime} IST`,
              tag: reminder.id,
            });
            notification.onclick = () => window.focus();
          } catch {
            setReminderMessage('A reminder is due, but this browser could not show the notification.');
          }
        }
      });

      const completedIds = new Set([...expiredIds, ...dueReminders.map((reminder) => reminder.id)]);
      setReminders((current) => current.filter((reminder) => !completedIds.has(reminder.id)));
      if (dueReminders.length) setReminderMessage(`${dueReminders.length === 1 ? 'Reminder sent' : `${dueReminders.length} reminders sent`} to this browser.`);
    };

    const timer = window.setInterval(deliverDueReminders, 20_000);
    deliverDueReminders();
    return () => window.clearInterval(timer);
  }, [reminders]);

  useEffect(() => {
    if (!reminderMessage) return undefined;
    const timer = window.setTimeout(() => setReminderMessage(''), 5_000);
    return () => window.clearTimeout(timer);
  }, [reminderMessage]);

  const handleReminderOption = async (event, hoursBefore) => {
    const id = `${event.id}:${hoursBefore}`;
    if (reminders.some((reminder) => reminder.id === id)) {
      setReminders((current) => current.filter((reminder) => reminder.id !== id));
      setReminderMessage('Reminder removed.');
      return;
    }

    if (feed?.demo || event.symbol === 'DEMO' || event.details?.includes('Preview only')) {
      setReminderMessage('Live event data is needed before setting a reminder for this preview.');
      return;
    }

    const eventAt = getEventDateTimeInIst(event);
    const triggerAt = eventAt - hoursBefore * 60 * 60 * 1000;
    if (triggerAt <= Date.now()) {
      setReminderMessage('That reminder time has already passed.');
      return;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      setReminderMessage('This browser does not support notifications.');
      return;
    }

    let permission = window.Notification.permission;
    if (permission === 'default') {
      try {
        permission = await window.Notification.requestPermission();
      } catch {
        setReminderMessage('The browser could not request notification permission. Check its site settings.');
        return;
      }
    }
    setNotificationPermission(permission);
    if (permission !== 'granted') {
      setReminderMessage(permission === 'denied'
        ? 'Notifications are blocked. Allow them in browser settings to set reminders.'
        : 'Allow browser notifications to set a reminder.');
      return;
    }

    setReminders((current) => [...current, {
      id,
      title: event.title,
      date: event.date,
      eventAt,
      triggerAt,
      hoursBefore,
      eventTime: formatEventTimeInIst(eventAt),
      kind: activeKind,
      symbol: event.symbol,
    }]);
    setReminderMessage(`${hoursBefore === 24 ? 'One-day' : 'One-hour'} reminder saved for ${event.title}.`);
    setOpenReminderId(null);
  };

  const filteredEvents = useMemo(() => {
    const events = feed?.data || [];
    const searchTerm = query.trim().toLowerCase();
    if (!searchTerm) return events;
    return events.filter((event) => `${event.title} ${event.details} ${event.symbol}`.toLowerCase().includes(searchTerm));
  }, [feed, query]);

  const visibleEvents = useMemo(
    () => activeKind === 'holidays' ? filteredEvents.slice(0, 10) : filteredEvents,
    [activeKind, filteredEvents],
  );

  const groupedEvents = useMemo(() => {
    const groups = new Map();
    visibleEvents.forEach((event) => {
      const dayEvents = groups.get(event.date) || [];
      dayEvents.push(event);
      groups.set(event.date, dayEvents);
    });
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [visibleEvents]);

  const calendarMonths = useMemo(() => {
    const eventCounts = new Map();
    (feed?.data || []).forEach((event) => eventCounts.set(event.date, (eventCounts.get(event.date) || 0) + 1));
    const firstDate = new Date(`${from}T00:00:00`);
    const lastDate = new Date(`${to}T00:00:00`);
    const months = [];

    for (let cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
      cursor <= lastDate;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const cells = [];
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const dateKey = toDateInputValue(date);
        if (dateKey < from || dateKey > to) continue;
        cells.push({
          date: dateKey,
          day,
          weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(date),
          eventCount: eventCounts.get(dateKey) || 0,
          isToday: dateKey === todayKey,
        });
      }

      months.push({ key: `${year}-${month}`, title: formatCalendarMonth(year, month), cells });
    }
    return months;
  }, [feed?.data, from, to, todayKey]);

  const providerNotConfigured = error?.code === 'calendar_provider_not_configured';
  const apiProxyIssue = error?.code === 'api_returned_html' || error?.code === 'api_invalid_response';
  const providerStatus = !feed
    ? (providerNotConfigured ? 'setup' : error ? 'error' : 'loading')
    : feed.demo ? 'demo' : feed.stale ? 'stale' : 'connected';
  const expectedProvider = ['economic', 'holidays', 'expiries'].includes(activeKind) ? 'Finance Calendar' : 'Financial Modeling Prep';
  const todaysEvents = feed?.data?.filter((event) => event.date === todayKey).length;
  const nextEvent = feed?.data?.[0];
  const expiryEvents = (activeKind === 'expiries' ? feed?.data : expiryFeed?.data) || [];
  const nextExpiry = expiryEvents.find((event) => event.date >= todayKey);
  const expiryDaysRemaining = nextExpiry ? getCalendarDaysUntil(nextExpiry.date, todayKey) : null;
  const activeReminders = reminders.filter((reminder) => reminder.eventAt > clockNow);

  return (
    <div className="page calendar-page">
      <div className="page-title calendar-page-title">
        <div>
          <span className="calendar-eyebrow"><span className={`calendar-live-dot is-${providerStatus}`} /> MARKET EVENTS · INDIA</span>
          <h1>Calendars</h1>
          <p>Plan around market events with one clear, searchable schedule.</p>
        </div>
        <div className="calendar-region-badge">
          <span>IN</span>
          <div>
            <strong>India market</strong>
            <small>Dates shown in IST</small>
            <small className="calendar-current-date"><CalendarDays size={12} />Today · {formatTodayDate(today)}</small>
          </div>
        </div>
      </div>

      <div className="calendar-overview-grid" aria-label="Calendar overview">
        <article className="calendar-overview-card">
          <div className="calendar-overview-label"><span>Events in this range</span><CalendarDays size={16} /></div>
          <strong>{feed ? feed.count : '—'}</strong>
          <small>{ranges.find((range) => range.days === rangeDays)?.label || 'Selected dates'}</small>
        </article>
        <article className="calendar-overview-card calendar-overview-next">
          <div className="calendar-overview-label"><span>Next event</span><Clock3 size={16} /></div>
          <strong>{nextEvent ? formatCalendarDate(nextEvent.date) : feed ? 'No events' : '—'}</strong>
          <small>{nextEvent?.title || (feed ? 'Try a longer date range' : 'Waiting for calendar feed')}</small>
        </article>
        <button
          className="calendar-overview-card calendar-expiry-card"
          type="button"
          onClick={() => { setActiveKind('expiries'); setRangeDays(90); }}
          aria-label={nextExpiry ? `Open NSE expiry calendar, next expiry in ${expiryDaysRemaining} days` : 'Open NSE expiry calendar'}
        >
          <div className="calendar-overview-label"><span>Next NSE F&amp;O expiry</span><Clock3 size={16} /></div>
          <strong>{nextExpiry ? (expiryDaysRemaining === 0 ? 'Today' : `${expiryDaysRemaining} ${expiryDaysRemaining === 1 ? 'day' : 'days'}`) : expiryError ? 'Unavailable' : 'Checking…'}</strong>
          <small>{nextExpiry ? `${formatCalendarTableDate(nextExpiry.date)} · ${nextExpiry.verifiedAgainstHolidays ? 'holiday checked' : 'rule-derived date'}` : expiryError ? 'Tap to open expiry calendar' : 'Loading NSE schedule'}</small>
        </button>
        <article className="calendar-overview-card calendar-overview-status">
          <div className="calendar-overview-label"><span>Feed status</span><Activity size={16} /></div>
          <strong>{feed ? (feed.demo ? 'Demo preview' : feed.stale ? 'Last known data' : 'Connected') : providerNotConfigured ? 'Setup needed' : error ? 'Unavailable' : 'Connecting'}</strong>
          <small>{feed?.demo ? 'Examples only · not live announcements' : feed?.lastUpdated ? `Updated ${formatUpdatedAt(feed.lastUpdated)}` : 'Provider update times vary'}</small>
        </article>
      </div>

      <section className="panel calendar-panel calendar-dashboard" aria-labelledby="calendar-title">
        <div className="calendar-heading">
          <div className="calendar-heading-copy">
            <span>MARKET SCHEDULE</span>
            <h2 id="calendar-title"><ActiveIcon size={22} />{activeCalendar.title}</h2>
            <p>{activeCalendar.description}</p>
          </div>
          <div className="calendar-heading-actions">
            <button
              className={`calendar-reminders-toggle${showReminders ? ' is-open' : ''}`}
              type="button"
              onClick={() => setShowReminders((open) => !open)}
              aria-expanded={showReminders}
              aria-controls="calendar-reminders-panel"
            >
              {activeReminders.length ? <BellRing size={16} /> : <Bell size={16} />}
              <span>Reminders</span>
              <span className="calendar-reminder-count">{activeReminders.length}</span>
            </button>
            <button
              className="calendar-refresh-button"
              type="button"
              onClick={() => {
                forceNextRefresh.current = true;
                if (activeKind !== 'expiries') {
                  forceExpiryRefresh.current = true;
                  setExpiryRefreshKey((key) => key + 1);
                }
                setRefreshKey((key) => key + 1);
              }}
              disabled={loading}
              aria-label="Refresh calendar events"
              title="Refresh events"
            >
              <RefreshCw size={16} className={loading ? 'calendar-refreshing' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {showReminders && (
          <section className="calendar-reminders-panel" id="calendar-reminders-panel" aria-label="Saved event reminders">
            <div className="calendar-reminders-panel-heading">
              <div>
                <strong>My reminders <span>{activeReminders.length}</span></strong>
                <p>
                  {notificationPermission === 'granted'
                    ? 'Browser notifications are allowed.'
                    : notificationPermission === 'denied'
                      ? 'Notifications are blocked in browser settings.'
                      : notificationPermission === 'unsupported'
                        ? 'This browser does not support notifications.'
                        : 'Your browser will ask before the first reminder.'}
                  {' '}Keep this Calendar page open for scheduled alerts.
                </p>
              </div>
              <button type="button" className="calendar-reminders-close" onClick={() => setShowReminders(false)} aria-label="Close reminders"><X size={16} /></button>
            </div>
            {activeReminders.length ? (
              <ul className="calendar-reminders-list">
                {[...activeReminders].sort((left, right) => left.triggerAt - right.triggerAt).map((reminder) => (
                  <li key={reminder.id}>
                    <span className="calendar-reminder-list-icon"><Bell size={15} /></span>
                    <div>
                      <strong>{reminder.title}</strong>
                      <small>{reminder.hoursBefore === 24 ? '1 day before' : '1 hour before'} · {formatCalendarTableDate(reminder.date)} · Notify {formatReminderAt(reminder.triggerAt)}</small>
                    </div>
                    <button type="button" className="calendar-reminder-remove" onClick={() => setReminders((current) => current.filter((item) => item.id !== reminder.id))} aria-label={`Remove reminder for ${reminder.title}`}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="calendar-reminders-empty">No reminders yet. Use the bell beside an event to add one.</p>
            )}
          </section>
        )}
        {reminderMessage && (
          <div className="calendar-reminder-message" role="status">
            <Bell size={15} />
            <span>{reminderMessage}</span>
            <button type="button" onClick={() => setReminderMessage('')} aria-label="Dismiss reminder message"><X size={14} /></button>
          </div>
        )}

        <div className="calendar-filters" role="tablist" aria-label="Choose a calendar">
          {calendars.map((calendar) => {
            const CategoryIcon = calendar.icon;
            return (
              <button
                className={activeKind === calendar.id ? 'active' : ''}
                key={calendar.id}
                type="button"
                role="tab"
                aria-selected={activeKind === calendar.id}
                onClick={() => { setActiveKind(calendar.id); setQuery(''); }}
              >
                <CategoryIcon size={15} />{calendar.label}
              </button>
            );
          })}
        </div>

        <div className="calendar-toolbar">
          <div className="calendar-range-options" aria-label="Event date range">
            {ranges.map((range) => (
              <button
                type="button"
                className={rangeDays === range.days ? 'active' : ''}
                key={range.days}
                onClick={() => setRangeDays(range.days)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <label className="calendar-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" aria-label="Search events" />
          </label>
        </div>

        <div className="calendar-feed-meta">
          <span className="calendar-provider-badge"><span className={`calendar-live-dot is-${providerStatus}`} />{feed?.demo ? 'Demo preview · sample only' : feed?.provider ? `${feed.provider} ${feed.stale ? 'cached feed' : 'feed'}` : providerNotConfigured ? 'FMP · setup required' : error ? `${expectedProvider} · feed unavailable` : `${expectedProvider} · connecting`}</span>
          <span>{from} – {to}</span>
          {activeKind === 'holidays' && feed && filteredEvents.length > 10 && <span>Showing next 10 of {filteredEvents.length} published holidays</span>}
          {activeKind === 'holidays' && feed && filteredEvents.length <= 10 && <span>{filteredEvents.length} published holidays in this range</span>}
          {Number.isInteger(todaysEvents) && <span><CalendarDays size={13} /> {todaysEvents} today</span>}
        </div>

        <section className="calendar-date-overview" aria-label={`Every date from ${from} to ${to}`}>
          <div className="calendar-date-overview-heading">
            <div>
              <h3>Every date in this range</h3>
              <p>Green markers show dates with events. Days without events stay visible too.</p>
            </div>
            <span>{rangeDays} days</span>
          </div>
          <div className="calendar-months">
            {calendarMonths.map((month) => (
              <section className="calendar-month-card" key={month.key} aria-label={`${month.title} dates`}>
                <h4>{month.title}</h4>
                <div className="calendar-month-grid">
                  {month.cells.map((cell) => (
                    <div
                      className={`calendar-date-cell${cell.isToday ? ' is-today' : ''}${cell.eventCount ? ' has-events' : ''}`}
                      key={cell.date}
                      aria-label={`${formatCalendarGroupDate(cell.date)}${cell.eventCount ? `, ${cell.eventCount} ${cell.eventCount === 1 ? 'event' : 'events'}` : ', no events'}`}
                      title={`${formatCalendarGroupDate(cell.date)}${cell.eventCount ? ` · ${cell.eventCount} ${cell.eventCount === 1 ? 'event' : 'events'}` : ''}`}
                    >
                      <span className="calendar-date-weekday">{cell.weekday}</span>
                      <time dateTime={cell.date}>{cell.day}</time>
                      {cell.eventCount > 0 && <span className="calendar-date-event-marker">{cell.eventCount}</span>}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        {loading ? (
          <div className="calendar-state" role="status"><RefreshCw size={20} className="calendar-refreshing" /><div><strong>Loading calendar feed</strong><span>Checking the selected event dates.</span></div></div>
        ) : error ? (
          <div className={`calendar-state calendar-error-state ${providerNotConfigured ? 'calendar-setup-state' : ''}`} role="alert">
            <div className="calendar-state-icon"><AlertCircle size={21} /></div>
            <div className="calendar-state-content">
              <strong>{providerNotConfigured ? 'Connect FMP for company events' : apiProxyIssue ? 'API connection needs attention' : 'Calendar feed unavailable'}</strong>
              <span>{error.message || 'Could not load calendar events. Please try again.'}</span>
              {providerNotConfigured ? (
                <ol className="calendar-setup-steps">
                  <li>Create an FMP API key with access to Indian company calendar endpoints.</li>
                  <li>Add <code>FMP_API_KEY=your_key</code> to <code>share-market/.env</code>.</li>
                  <li>Restart the market proxy and refresh this page.</li>
                </ol>
              ) : apiProxyIssue ? (
                <ol className="calendar-setup-steps">
                  <li>Stop any separately running Vite or proxy windows.</li>
                  <li>Run <code>npm run dev</code> from the <code>share-market</code> folder.</li>
                  <li>Open the exact Local URL printed in that terminal.</li>
                </ol>
              ) : (
                <button className="calendar-retry-button" type="button" onClick={() => setRefreshKey((key) => key + 1)}>Try again</button>
              )}
            </div>
          </div>
        ) : groupedEvents.length ? (
          <div className="calendar-list" aria-live="polite">
            <div className="calendar-table-scroll">
              <table className="calendar-event-table" aria-label={`${activeCalendar.title} events`}>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Country</th>
                    <th scope="col">Exchange</th>
                    <th scope="col">Event</th>
                    <th scope="col">Reminder</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedEvents.flatMap(([, events]) => events).map((event) => {
                    const eventReminders = reminders.filter((reminder) => reminder.id.startsWith(`${event.id}:`));
                    const isDemoEvent = Boolean(feed?.demo || event.symbol === 'DEMO' || event.details?.includes('Preview only'));
                    return (
                      <tr key={event.id}>
                        <td className="calendar-table-date"><time dateTime={event.date}>{formatCalendarTableDate(event.date)}</time></td>
                        <td><span className="calendar-table-country"><span aria-hidden="true">🇮🇳</span> India</span></td>
                        <td className="calendar-table-exchange">{exchangeLabel}</td>
                        <td>
                          <div className="calendar-table-event-title">{event.title}</div>
                          {event.symbol && <span className="calendar-symbol-tag">{event.symbol}</span>}
                          {event.details && <div className="calendar-table-event-details">{event.details}</div>}
                        </td>
                        <td className="calendar-reminder-cell">
                          <div className="calendar-reminder-control">
                            <button
                              className={`calendar-reminder-button${eventReminders.length ? ' has-reminder' : ''}`}
                              type="button"
                              onClick={() => setOpenReminderId((current) => current === event.id ? null : event.id)}
                              disabled={isDemoEvent}
                              aria-expanded={openReminderId === event.id}
                              aria-label={isDemoEvent ? 'Live data is required for event reminders' : `Set reminder for ${event.title}`}
                              title={isDemoEvent ? 'Live event feed required for reminders' : 'Choose when to be notified'}
                            >
                              {eventReminders.length ? <BellRing size={15} /> : <Bell size={15} />}
                              <span>{eventReminders.length ? `${eventReminders.length} set` : 'Remind me'}</span>
                            </button>
                            {openReminderId === event.id && !isDemoEvent && (
                              <div className="calendar-reminder-menu">
                                <strong>Notify before event</strong>
                                {[24, 1].map((hoursBefore) => {
                                  const reminderId = `${event.id}:${hoursBefore}`;
                                  const isSet = eventReminders.some((reminder) => reminder.id === reminderId);
                                  const notifyAt = getEventDateTimeInIst(event) - hoursBefore * 60 * 60 * 1000;
                                  const tooLate = notifyAt <= Date.now() && !isSet;
                                  return (
                                    <button
                                      type="button"
                                      key={hoursBefore}
                                      className={isSet ? 'is-set' : ''}
                                      disabled={tooLate}
                                      onClick={() => handleReminderOption(event, hoursBefore)}
                                    >
                                      <span>
                                        <b>{hoursBefore === 24 ? '1 day before' : '1 hour before'}</b>
                                        <small>{tooLate ? 'Time passed' : formatReminderAt(notifyAt)}</small>
                                      </span>
                                      <span>{isSet ? 'On' : tooLate ? '—' : 'Set'}</span>
                                    </button>
                                  );
                                })}
                                <small className="calendar-reminder-menu-note">Provider time is used when available; otherwise alerts assume 9:00 AM IST. Keep this page open.</small>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="calendar-state calendar-empty-state">
            <div className="calendar-state-icon"><CalendarDays size={21} /></div>
            <div><strong>{query ? 'No matching events' : 'No events in this date range'}</strong><span>{query ? 'Try another company name, symbol, or event.' : 'Choose a longer date range or check back after the provider refreshes.'}</span></div>
          </div>
        )}

        <div className="calendar-footnote">
          <Sparkles size={15} />
          <span>
            {feed?.note || 'Calendar data comes from a provider feed. Update frequency and India market coverage depend on the provider.'}
            {feed?.providerUrl && <> · Data: <a href={feed.providerUrl} target="_blank" rel="noreferrer">{feed.provider}</a></>}
          </span>
        </div>
      </section>
    </div>
  );
};

export default Calendar;
