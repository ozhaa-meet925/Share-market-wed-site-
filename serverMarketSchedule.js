// ============================================================================
// serverMarketSchedule.js
// Complete Indian Stock Market Timing, Holiday Calendar & Special Session
// Management System for NSE/BSE & MCX.
//
// • Uses IST (Asia/Kolkata) exclusively via Intl.DateTimeFormat.
// • Zero external dependencies – Node.js built-ins only.
// • ESM exports.
// ============================================================================

// ---------------------------------------------------------------------------
// 1.  IST Helpers
// ---------------------------------------------------------------------------

const IST_TZ = 'Asia/Kolkata';

/** Return a formatter for the given options, always in IST. */
export function istFormatter(opts) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST_TZ, ...opts });
}

/** Get individual IST date/time parts from a Date object. */
export function getISTParts(date = new Date()) {
  const parts = istFormatter({
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    weekday: 'long',
  }).formatToParts(date);

  const get = (type) => parts.find(p => p.type === type)?.value ?? '';

  const year   = parseInt(get('year'), 10);
  const month  = parseInt(get('month'), 10);
  const day    = parseInt(get('day'), 10);
  let   hour   = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;                       // midnight edge-case
  const minute = parseInt(get('minute'), 10);
  const second = parseInt(get('second'), 10);
  const weekday = get('weekday');                   // e.g. "Monday"
  const dow    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(weekday);

  const dateStr  = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const clockStr = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}`;

  return { year, month, day, hour, minute, second, weekday, dow, dateStr, clockStr };
}

/** Convert IST date-string + time-string to a UTC Date. */
export function istToUTC(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [H, M, S] = (timeStr || '00:00:00').split(':').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, H - 5, M - 30, S || 0));
  return utc;
}

/** Minutes since midnight for a given HH:MM or HH:MM:SS string. */
export function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Total seconds since midnight from IST parts. */
export function istSecondsOfDay(parts) {
  return parts.hour * 3600 + parts.minute * 60 + parts.second;
}

function secOfDay(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

// ---------------------------------------------------------------------------
// 2.  Market Session Definitions (times in seconds since midnight, IST)
// ---------------------------------------------------------------------------

export const SESSIONS = {
  PRE_OPEN_ORDER_ENTRY:  { start: '09:00:00', end: '09:07:00', label: 'Pre-Open (Order Entry)' },
  PRE_OPEN_ORDER_MATCH:  { start: '09:07:00', end: '09:12:00', label: 'Pre-Open (Order Matching)' },
  PRE_OPEN_BUFFER:       { start: '09:12:00', end: '09:15:00', label: 'Pre-Open (Buffer)' },
  NORMAL:                { start: '09:15:00', end: '15:30:00', label: 'Normal Market' },
  CLOSING:               { start: '15:30:00', end: '15:40:00', label: 'Closing Session' },
  POST_CLOSE:            { start: '15:40:00', end: '16:00:00', label: 'Post-Closing Session' },
};

/** Default Muhurat Trading session window. */
export const MUHURAT_SESSION = { start: '18:15:00', end: '19:15:00', label: 'Muhurat Trading' };

// Pre-compute session boundaries in seconds
export const SESSION_BOUNDS = Object.fromEntries(
  Object.entries(SESSIONS).map(([k, v]) => [k, { ...v, startSec: secOfDay(v.start), endSec: secOfDay(v.end) }])
);
export const MUHURAT_BOUNDS = { ...MUHURAT_SESSION, startSec: secOfDay(MUHURAT_SESSION.start), endSec: secOfDay(MUHURAT_SESSION.end) };

// ---------------------------------------------------------------------------
// 3.  Official Holiday Calendar Data  (NSE/BSE Official Holidays)
// ---------------------------------------------------------------------------

export const HOLIDAY_CALENDAR = {

  // ── 2024 ──────────────────────────────────────────────────────────────────
  2024: [
    { date: '2024-01-26', name: 'Republic Day',                     isMuhuratTrading: false },
    { date: '2024-03-08', name: 'Mahashivratri',                    isMuhuratTrading: false },
    { date: '2024-03-25', name: 'Holi',                             isMuhuratTrading: false },
    { date: '2024-03-29', name: 'Good Friday',                      isMuhuratTrading: false },
    { date: '2024-04-11', name: 'Id-Ul-Fitr (Ramadan)',             isMuhuratTrading: false },
    { date: '2024-04-14', name: 'Dr. Ambedkar Jayanti',             isMuhuratTrading: false },
    { date: '2024-04-17', name: 'Ram Navami',                       isMuhuratTrading: false },
    { date: '2024-04-21', name: 'Shri Mahavir Jayanti',             isMuhuratTrading: false },
    { date: '2024-05-01', name: 'Maharashtra Day',                  isMuhuratTrading: false },
    { date: '2024-05-20', name: 'General Elections (Mumbai)',       isMuhuratTrading: false },
    { date: '2024-06-17', name: 'Eid-Ul-Adha (Bakri Id)',           isMuhuratTrading: false },
    { date: '2024-07-17', name: 'Muharram',                         isMuhuratTrading: false },
    { date: '2024-08-15', name: 'Independence Day',                 isMuhuratTrading: false },
    { date: '2024-10-02', name: 'Mahatma Gandhi Jayanti',           isMuhuratTrading: false },
    { date: '2024-11-01', name: 'Diwali (Lakshmi Puja)',            isMuhuratTrading: true  },
    { date: '2024-11-15', name: 'Guru Nanak Jayanti',               isMuhuratTrading: false },
    { date: '2024-11-20', name: 'Maharashtra Assembly Election',    isMuhuratTrading: false },
    { date: '2024-12-25', name: 'Christmas',                        isMuhuratTrading: false },
  ],

  // ── 2025 ──────────────────────────────────────────────────────────────────
  2025: [
    { date: '2025-02-26', name: 'Mahashivratri',                    isMuhuratTrading: false },
    { date: '2025-03-14', name: 'Holi',                             isMuhuratTrading: false },
    { date: '2025-03-31', name: 'Id-Ul-Fitr (Ramadan)',             isMuhuratTrading: false },
    { date: '2025-04-10', name: 'Shri Mahavir Jayanti',             isMuhuratTrading: false },
    { date: '2025-04-14', name: 'Dr. Ambedkar Jayanti',             isMuhuratTrading: false },
    { date: '2025-04-18', name: 'Good Friday',                      isMuhuratTrading: false },
    { date: '2025-05-01', name: 'Maharashtra Day',                  isMuhuratTrading: false },
    { date: '2025-08-15', name: 'Independence Day',                 isMuhuratTrading: false },
    { date: '2025-08-27', name: 'Ganesh Chaturthi',                 isMuhuratTrading: false },
    { date: '2025-10-02', name: 'Mahatma Gandhi Jayanti',           isMuhuratTrading: false },
    { date: '2025-10-20', name: 'Diwali (Lakshmi Puja)',            isMuhuratTrading: true  },
    { date: '2025-10-21', name: 'Diwali Balipratipada',             isMuhuratTrading: false },
    { date: '2025-11-05', name: 'Prakash Gurpurab Sri Guru Nanak Dev', isMuhuratTrading: false },
    { date: '2025-12-25', name: 'Christmas',                        isMuhuratTrading: false },
  ],

  // ── 2026 ──────────────────────────────────────────────────────────────────
  2026: [
    { date: '2026-01-15', name: 'Municipal Corporation Election',   isMuhuratTrading: false },
    { date: '2026-01-26', name: 'Republic Day',                     isMuhuratTrading: false },
    { date: '2026-02-15', name: 'Mahashivratri',                    isMuhuratTrading: false },
    { date: '2026-03-03', name: 'Holi',                             isMuhuratTrading: false },
    { date: '2026-03-21', name: 'Id-Ul-Fitr (Ramadan Eid)',         isMuhuratTrading: false },
    { date: '2026-03-26', name: 'Shri Ram Navami',                  isMuhuratTrading: false },
    { date: '2026-03-31', name: 'Shri Mahavir Jayanti',             isMuhuratTrading: false },
    { date: '2026-04-03', name: 'Good Friday',                      isMuhuratTrading: false },
    { date: '2026-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti',  isMuhuratTrading: false },
    { date: '2026-05-01', name: 'Maharashtra Day',                  isMuhuratTrading: false },
    { date: '2026-05-28', name: 'Bakri Id (Eid-Ul-Adha)',           isMuhuratTrading: false },
    { date: '2026-06-26', name: 'Muharram',                         isMuhuratTrading: false },
    { date: '2026-08-15', name: 'Independence Day',                 isMuhuratTrading: false },
    { date: '2026-09-14', name: 'Ganesh Chaturthi',                 isMuhuratTrading: false },
    { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti',           isMuhuratTrading: false },
    { date: '2026-10-20', name: 'Dussehra',                         isMuhuratTrading: false },
    { date: '2026-11-08', name: 'Diwali Laxmi Pujan*',              isMuhuratTrading: true  },
    { date: '2026-11-10', name: 'Diwali-Balipratipada',             isMuhuratTrading: false },
    { date: '2026-11-24', name: 'Prakash Gurpurb Sri Guru Nanak Dev', isMuhuratTrading: false },
    { date: '2026-12-25', name: 'Christmas',                        isMuhuratTrading: false },
  ],

  // ── 2027 ──────────────────────────────────────────────────────────────────
  2027: [
    { date: '2027-01-26', name: 'Republic Day',                     isMuhuratTrading: false },
    { date: '2027-03-01', name: 'Holi',                             isMuhuratTrading: false },
    { date: '2027-03-22', name: 'Id-Ul-Fitr (Ramadan)',             isMuhuratTrading: false },
    { date: '2027-03-26', name: 'Good Friday',                      isMuhuratTrading: false },
    { date: '2027-03-30', name: 'Ram Navami',                       isMuhuratTrading: false },
    { date: '2027-04-14', name: 'Dr. Ambedkar Jayanti',             isMuhuratTrading: false },
    { date: '2027-04-29', name: 'Shri Mahavir Jayanti',             isMuhuratTrading: false },
    { date: '2027-05-01', name: 'Maharashtra Day',                  isMuhuratTrading: false },
    { date: '2027-05-13', name: 'Buddha Purnima',                   isMuhuratTrading: false },
    { date: '2027-06-26', name: 'Muharram',                         isMuhuratTrading: false },
    { date: '2027-08-24', name: 'Milad-un-Nabi',                    isMuhuratTrading: false },
    { date: '2027-10-02', name: 'Mahatma Gandhi Jayanti',           isMuhuratTrading: false },
    { date: '2027-10-05', name: 'Dussehra',                         isMuhuratTrading: false },
    { date: '2027-11-09', name: 'Diwali (Lakshmi Puja)',            isMuhuratTrading: true  },
    { date: '2027-11-10', name: 'Diwali Balipratipada',             isMuhuratTrading: false },
    { date: '2027-11-24', name: 'Guru Nanak Jayanti',               isMuhuratTrading: false },
    { date: '2027-12-25', name: 'Christmas',                        isMuhuratTrading: false },
  ],
};

// ---------------------------------------------------------------------------
// 4.  Special Trading Sessions Seed
// ---------------------------------------------------------------------------

export const SPECIAL_SESSIONS_SEED = [
  {
    date: '2024-03-02',
    name: 'NSE/BSE Special Live Trading Session (Disaster Recovery Switchover)',
    startTime: '09:15',
    endTime: '12:30',
    exchange: 'NSE',
    segment: 'CM',
    description: 'Special live trading session from Primary site (09:15–10:00) and Disaster Recovery site (11:30–12:30).'
  },
  {
    date: '2024-05-18',
    name: 'NSE/BSE Special Live Trading Session (Disaster Recovery Switchover)',
    startTime: '09:15',
    endTime: '12:30',
    exchange: 'NSE',
    segment: 'CM',
    description: 'Special live trading session on Saturday from Primary site (09:15–10:00) and Disaster Recovery site (11:30–12:30).'
  },
  {
    date: '2024-11-01',
    name: 'Diwali Laxmi Pujan (Muhurat Trading)',
    startTime: '18:00',
    endTime: '19:15',
    exchange: 'NSE',
    segment: 'CM',
    description: 'Annual Diwali Muhurat Trading evening session (Samvat 2081).'
  },
  {
    date: '2025-10-20',
    name: 'Diwali Laxmi Pujan (Muhurat Trading)',
    startTime: '18:15',
    endTime: '19:15',
    exchange: 'NSE',
    segment: 'CM',
    description: 'Annual Diwali Muhurat Trading evening session (Samvat 2082).'
  },
  {
    date: '2026-11-08',
    name: 'Diwali Laxmi Pujan (Muhurat Trading)',
    startTime: '18:15',
    endTime: '19:15',
    exchange: 'NSE',
    segment: 'CM',
    description: 'Annual Diwali Muhurat Trading evening session (Samvat 2083).'
  },
  {
    date: '2027-11-09',
    name: 'Diwali Laxmi Pujan (Muhurat Trading)',
    startTime: '18:15',
    endTime: '19:15',
    exchange: 'NSE',
    segment: 'CM',
    description: 'Annual Diwali Muhurat Trading evening session (Samvat 2084).'
  },
];

// ---------------------------------------------------------------------------
// 5.  Live-Synced Holiday Overlay & Memory Cache
// ---------------------------------------------------------------------------

const liveOverlay = new Map();
let lastSyncTime  = null;
let syncSucceeded = false;

/** Find a holiday entry for a date-string. */
export function findHoliday(dateStr) {
  if (liveOverlay.has(dateStr)) return liveOverlay.get(dateStr);
  const year = parseInt(dateStr.slice(0, 4), 10);
  const list = HOLIDAY_CALENDAR[year] || [];
  return list.find(h => h.date === dateStr) || null;
}

/** Is a given IST date a weekend? (Saturday=6, Sunday=0) */
export function isWeekend(dow) {
  return dow === 0 || dow === 6;
}

/** Advance a Date by N calendar days. */
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Get the next trading day (IST) after a given date-string. */
export function nextTradingDayAfter(dateStr) {
  let d = istToUTC(dateStr, '12:00:00');
  for (let i = 0; i < 30; i++) {
    d = addDays(d, 1);
    const p = getISTParts(d);
    if (!isWeekend(p.dow) && !findHoliday(p.dateStr)) return p.dateStr;
  }
  return dateStr;
}

/** Compute countdown { hours, minutes, seconds } between two epoch-ms values. */
export function countdown(fromMs, toMs) {
  let diff = Math.max(0, Math.floor((toMs - fromMs) / 1000));
  const hours   = Math.floor(diff / 3600); diff %= 3600;
  const minutes = Math.floor(diff / 60);   diff %= 60;
  const seconds = diff;
  return { hours, minutes, seconds };
}

// ---------------------------------------------------------------------------
// 6.  MCX Commodity Market Schedule Status
// ---------------------------------------------------------------------------

export function getMCXScheduleStatus(instant = new Date()) {
  const ist = getISTParts(instant);
  const nowSec = istSecondsOfDay(ist);
  const isWknd = isWeekend(ist.dow);
  const holiday = findHoliday(ist.dateStr);

  // Full MCX closure holidays (both morning and evening)
  const isFullMcxHoliday = holiday && /republic|independence|gandhi|good friday|christmas/i.test(holiday.name);
  const isPartialHoliday = holiday && !isFullMcxHoliday;

  const morningStart = 9 * 3600;          // 09:00:00
  const morningEnd = 17 * 3600;           // 17:00:00
  const eveningStart = 17 * 3600;         // 17:00:00
  const eveningEnd = 23 * 3600 + 30 * 60; // 23:30:00

  let phase = 'CLOSED';
  let isOpen = false;
  let sessionName = 'MCX Closed';

  if (!isWknd && !isFullMcxHoliday) {
    if (!isPartialHoliday && nowSec >= morningStart && nowSec < morningEnd) {
      phase = 'MORNING_SESSION';
      isOpen = true;
      sessionName = 'MCX Morning Session (09:00–17:00 IST)';
    } else if (nowSec >= eveningStart && nowSec < eveningEnd) {
      phase = 'EVENING_SESSION';
      isOpen = true;
      sessionName = 'MCX Evening Session (17:00–23:30 IST)';
    }
  }

  return {
    exchange: 'MCX',
    segment: 'Commodity',
    phase,
    isOpen,
    status: isOpen ? 'MARKET OPEN' : 'MARKET CLOSED',
    statusEmoji: isOpen ? '🟢' : '🔴',
    sessionName,
    morningSession: '09:00–17:00 IST',
    eveningSession: '17:00–23:30 IST',
    isHoliday: Boolean(holiday),
    isPartialHoliday: Boolean(isPartialHoliday),
    holidayName: holiday?.name || null,
  };
}

// ---------------------------------------------------------------------------
// 7.  Database Seeding for Verified Exchange Calendars
// ---------------------------------------------------------------------------

export function seedOfficialMarketCalendar(db) {
  if (!db) return;
  const fetchedAt = new Date().toISOString();
  const sourceUrl = 'https://www.nseindia.com/api/holiday-master?type=trading';

  db.transaction((tx) => {
    for (const [yearStr, list] of Object.entries(HOLIDAY_CALENDAR)) {
      const year = Number(yearStr);
      tx.run(
        `INSERT INTO market_calendar_sync (exchange, segment, calendar_year, source_url, fetched_at)
         VALUES ('NSE', 'CM', ?, ?, ?)
         ON CONFLICT(exchange, segment, calendar_year) DO NOTHING`,
        year, sourceUrl, fetchedAt
      );
      tx.run(
        `INSERT INTO market_calendar_sync (exchange, segment, calendar_year, source_url, fetched_at)
         VALUES ('BSE', 'CM', ?, ?, ?)
         ON CONFLICT(exchange, segment, calendar_year) DO NOTHING`,
        year, 'https://www.bseindia.com/markets/MarketInfo/DispNewNoticesCirculars.aspx', fetchedAt
      );

      for (const h of list) {
        tx.run(
          `INSERT INTO market_calendar_events
            (exchange, segment, event_date, name, event_type, start_time, end_time, source_url, payload_json, fetched_at)
           VALUES ('NSE', 'CM', ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(exchange, segment, event_date, event_type, name) DO UPDATE SET
             start_time = coalesce(excluded.start_time, market_calendar_events.start_time),
             end_time = coalesce(excluded.end_time, market_calendar_events.end_time)`,
          h.date,
          h.name,
          h.isMuhuratTrading ? 'special_session' : 'closed',
          h.isMuhuratTrading ? '18:15:00' : null,
          h.isMuhuratTrading ? '19:15:00' : null,
          sourceUrl,
          JSON.stringify(h),
          fetchedAt
        );
      }
    }

    // Seed special sessions
    for (const s of SPECIAL_SESSIONS_SEED) {
      tx.run(
        `INSERT INTO market_calendar_events
          (exchange, segment, event_date, name, event_type, start_time, end_time, source_url, payload_json, fetched_at)
         VALUES (?, ?, ?, ?, 'special_session', ?, ?, ?, ?, ?)
         ON CONFLICT(exchange, segment, event_date, event_type, name) DO UPDATE SET
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           source_url = excluded.source_url`,
        s.exchange || 'NSE',
        s.segment || 'CM',
        s.date,
        s.name,
        s.startTime.length === 5 ? `${s.startTime}:00` : s.startTime,
        s.endTime.length === 5 ? `${s.endTime}:00` : s.endTime,
        sourceUrl,
        JSON.stringify(s),
        fetchedAt
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 8.  Merged Holidays & Upcoming Holidays
// ---------------------------------------------------------------------------

function mergedHolidaysForYear(year) {
  const base = [...(HOLIDAY_CALENDAR[year] || [])];
  const baseDates = new Set(base.map(h => h.date));

  for (const [date, entry] of liveOverlay) {
    if (date.startsWith(String(year)) && !baseDates.has(date)) {
      base.push(entry);
    }
  }

  base.sort((a, b) => (a.date > b.date ? 1 : -1));
  return base;
}

export function getHolidaysForYear(year) {
  return mergedHolidaysForYear(year).map(h => ({
    date: h.date,
    name: h.name,
    isMuhuratTrading: Boolean(h.isMuhuratTrading),
  }));
}

export function getSpecialSessions(year) {
  const holidays = mergedHolidaysForYear(year);
  const fromHolidays = holidays
    .filter(h => h.isMuhuratTrading)
    .map(h => ({
      date:      h.date,
      name:      `Muhurat Trading – ${h.name}`,
      startTime: MUHURAT_SESSION.start.slice(0, 5),
      endTime:   MUHURAT_SESSION.end.slice(0, 5),
      exchange:  'NSE & BSE',
      segment:   'CM',
    }));

  const fromSeed = SPECIAL_SESSIONS_SEED
    .filter(s => s.date.startsWith(String(year)))
    .map(s => ({
      date: s.date,
      name: s.name,
      startTime: s.startTime.slice(0, 5),
      endTime: s.endTime.slice(0, 5),
      exchange: s.exchange,
      segment: s.segment,
    }));

  const combined = [...fromHolidays, ...fromSeed];
  const unique = new Map();
  for (const item of combined) {
    unique.set(`${item.date}:${item.name}`, item);
  }
  return Array.from(unique.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function getUpcomingHolidays(count = 5) {
  const now      = new Date();
  const ist      = getISTParts(now);
  const todayStr = ist.dateStr;
  const todayMs  = istToUTC(todayStr, '00:00:00').getTime();
  const todayYear = ist.year;

  const candidates = [];

  for (let y = todayYear; y <= todayYear + 2; y++) {
    const list = mergedHolidaysForYear(y);
    for (const h of list) {
      if (h.date >= todayStr) {
        const hMs     = istToUTC(h.date, '00:00:00').getTime();
        const daysAway = Math.round((hMs - todayMs) / (24 * 60 * 60 * 1000));
        candidates.push({ date: h.date, name: h.name, daysAway, isMuhuratTrading: Boolean(h.isMuhuratTrading) });
      }
    }
  }

  candidates.sort((a, b) => (a.date > b.date ? 1 : -1));
  return candidates.slice(0, count);
}

function computeNextHoliday(todayStr) {
  const todayYear = parseInt(todayStr.slice(0, 4), 10);
  const candidates = [];

  for (let y = todayYear; y <= todayYear + 1; y++) {
    const list = mergedHolidaysForYear(y);
    for (const h of list) {
      if (h.date > todayStr) {
        candidates.push(h);
      }
    }
  }

  candidates.sort((a, b) => (a.date > b.date ? 1 : -1));
  if (candidates.length === 0) return null;

  const todayMs = istToUTC(todayStr, '00:00:00').getTime();
  const hMs = istToUTC(candidates[0].date, '00:00:00').getTime();
  const daysAway = Math.round((hMs - todayMs) / (24 * 60 * 60 * 1000));

  return {
    date: candidates[0].date,
    name: candidates[0].name,
    daysAway,
    isMuhuratTrading: Boolean(candidates[0].isMuhuratTrading),
  };
}

function computeNextOpen(instant, ist, phase, isTradingDay, isHol, isMuhurat) {
  const nowMs = instant.getTime();
  const nowSec = istSecondsOfDay(ist);

  if (phase === 'NORMAL' || phase === 'SPECIAL_SESSION') {
    return {
      date: ist.dateStr,
      time: '09:15',
      label: 'Market is currently open',
      targetAt: instant.toISOString(),
      countdown: { hours: 0, minutes: 0, seconds: 0 },
    };
  }

  let targetDate;
  let targetTime = '09:15';
  let label;

  if (isTradingDay && !isHol) {
    if (nowSec < SESSION_BOUNDS.PRE_OPEN_ORDER_ENTRY.startSec) {
      targetDate = ist.dateStr;
      targetTime = '09:00';
      label      = 'Pre-open begins today';
    } else if (nowSec < SESSION_BOUNDS.NORMAL.startSec) {
      targetDate = ist.dateStr;
      targetTime = '09:15';
      label      = 'Normal trading begins today';
    } else {
      targetDate = nextTradingDayAfter(ist.dateStr);
      targetTime = '09:00';
      label      = 'Next trading session';
    }
  } else if (isMuhurat && nowSec < MUHURAT_BOUNDS.startSec) {
    const muhuratOpen = istToUTC(ist.dateStr, MUHURAT_BOUNDS.start);
    return {
      date: ist.dateStr,
      time: MUHURAT_SESSION.start.slice(0, 5),
      label: 'Muhurat Trading today',
      targetAt: muhuratOpen.toISOString(),
      countdown: countdown(nowMs, muhuratOpen.getTime()),
    };
  } else {
    targetDate = nextTradingDayAfter(ist.dateStr);
    targetTime = '09:00';
    label      = 'Next trading session';
  }

  const targetOpenMs = istToUTC(targetDate, targetTime === '09:00' ? SESSION_BOUNDS.PRE_OPEN_ORDER_ENTRY.start : SESSION_BOUNDS.NORMAL.start).getTime();

  return {
    date: targetDate,
    time: targetTime,
    label,
    targetAt: new Date(targetOpenMs).toISOString(),
    countdown: countdown(nowMs, targetOpenMs),
  };
}

// ---------------------------------------------------------------------------
// 9.  Core getMarketScheduleStatus
// ---------------------------------------------------------------------------

export function getMarketScheduleStatus(instant = new Date()) {
  const ist = getISTParts(instant);
  const nowSec = istSecondsOfDay(ist);

  const holiday   = findHoliday(ist.dateStr);
  const isHol     = Boolean(holiday);
  const isWknd    = isWeekend(ist.dow);
  const isMuhurat = holiday?.isMuhuratTrading === true;

  // Check special session on this day
  const todaySpecial = SPECIAL_SESSIONS_SEED.find(s => s.date === ist.dateStr);
  const specialStartSec = todaySpecial ? secOfDay(todaySpecial.startTime.length === 5 ? `${todaySpecial.startTime}:00` : todaySpecial.startTime) : null;
  const specialEndSec = todaySpecial ? secOfDay(todaySpecial.endTime.length === 5 ? `${todaySpecial.endTime}:00` : todaySpecial.endTime) : null;
  const hasActiveSpecial = Boolean(todaySpecial && specialStartSec !== null && specialEndSec !== null && nowSec >= specialStartSec && nowSec < specialEndSec);
  const hasUpcomingSpecial = Boolean(todaySpecial && specialStartSec !== null && nowSec < specialStartSec);

  const isTradingDay = (!isWknd && (!isHol || isMuhurat)) || Boolean(todaySpecial);

  let phase          = 'CLOSED';
  let isOpen          = false;
  let isPreOpen       = false;
  let isClosing       = false;
  let isPostClose     = false;
  let isSpecialSess   = false;
  let sessionInfo     = { name: 'Market Closed', startTime: null, endTime: null };

  if (hasActiveSpecial) {
    phase         = 'SPECIAL_SESSION';
    isOpen        = true;
    isSpecialSess = true;
    sessionInfo   = { name: todaySpecial.name, startTime: todaySpecial.startTime, endTime: todaySpecial.endTime };
  } else if (isTradingDay && !isWknd && !isHol) {
    if (nowSec >= SESSION_BOUNDS.PRE_OPEN_ORDER_ENTRY.startSec && nowSec < SESSION_BOUNDS.PRE_OPEN_BUFFER.endSec) {
      phase     = 'PRE_OPEN';
      isPreOpen = true;
      if (nowSec < SESSION_BOUNDS.PRE_OPEN_ORDER_ENTRY.endSec) {
        sessionInfo = { name: SESSION_BOUNDS.PRE_OPEN_ORDER_ENTRY.label, startTime: SESSION_BOUNDS.PRE_OPEN_ORDER_ENTRY.start, endTime: SESSION_BOUNDS.PRE_OPEN_ORDER_ENTRY.end };
      } else if (nowSec < SESSION_BOUNDS.PRE_OPEN_ORDER_MATCH.endSec) {
        sessionInfo = { name: SESSION_BOUNDS.PRE_OPEN_ORDER_MATCH.label, startTime: SESSION_BOUNDS.PRE_OPEN_ORDER_MATCH.start, endTime: SESSION_BOUNDS.PRE_OPEN_ORDER_MATCH.end };
      } else {
        sessionInfo = { name: SESSION_BOUNDS.PRE_OPEN_BUFFER.label, startTime: SESSION_BOUNDS.PRE_OPEN_BUFFER.start, endTime: SESSION_BOUNDS.PRE_OPEN_BUFFER.end };
      }
    } else if (nowSec >= SESSION_BOUNDS.NORMAL.startSec && nowSec < SESSION_BOUNDS.NORMAL.endSec) {
      phase   = 'NORMAL';
      isOpen  = true;
      sessionInfo = { name: SESSION_BOUNDS.NORMAL.label, startTime: SESSION_BOUNDS.NORMAL.start, endTime: SESSION_BOUNDS.NORMAL.end };
    } else if (nowSec >= SESSION_BOUNDS.CLOSING.startSec && nowSec < SESSION_BOUNDS.CLOSING.endSec) {
      phase     = 'CLOSING';
      isClosing = true;
      sessionInfo = { name: SESSION_BOUNDS.CLOSING.label, startTime: SESSION_BOUNDS.CLOSING.start, endTime: SESSION_BOUNDS.CLOSING.end };
    } else if (nowSec >= SESSION_BOUNDS.POST_CLOSE.startSec && nowSec < SESSION_BOUNDS.POST_CLOSE.endSec) {
      phase       = 'POST_CLOSE';
      isPostClose = true;
      sessionInfo = { name: SESSION_BOUNDS.POST_CLOSE.label, startTime: SESSION_BOUNDS.POST_CLOSE.start, endTime: SESSION_BOUNDS.POST_CLOSE.end };
    }
  } else if (isMuhurat && nowSec >= MUHURAT_BOUNDS.startSec && nowSec < MUHURAT_BOUNDS.endSec) {
    phase         = 'SPECIAL_SESSION';
    isOpen        = true;
    isSpecialSess = true;
    sessionInfo   = { name: MUHURAT_BOUNDS.label, startTime: MUHURAT_BOUNDS.start, endTime: MUHURAT_BOUNDS.end };
  }

  // Status and Badge
  let status, statusEmoji, subtext, badgeColor;
  switch (phase) {
    case 'PRE_OPEN':
      status      = 'PRE-OPEN';
      statusEmoji = '🟡';
      subtext     = `${sessionInfo.name} · Normal trading starts at 09:15 IST`;
      badgeColor  = 'preopen';
      break;
    case 'NORMAL':
      status      = 'MARKET OPEN';
      statusEmoji = '🟢';
      subtext     = 'Normal trading session in progress (09:15–15:30 IST)';
      badgeColor  = 'live';
      break;
    case 'CLOSING':
      status      = 'CLOSING SESSION';
      statusEmoji = '🟡';
      subtext     = 'Closing price calculation in progress (15:30–15:40 IST)';
      badgeColor  = 'preopen';
      break;
    case 'POST_CLOSE':
      status      = 'POST-CLOSE SESSION';
      statusEmoji = '🟡';
      subtext     = 'Post-closing order window (15:40–16:00 IST)';
      badgeColor  = 'preopen';
      break;
    case 'SPECIAL_SESSION':
      status      = 'SPECIAL TRADING SESSION';
      statusEmoji = '🔵';
      subtext     = `${sessionInfo.name} (${sessionInfo.startTime}–${sessionInfo.endTime} IST)`;
      badgeColor  = 'special';
      break;
    default: // CLOSED
      if (hasUpcomingSpecial) {
        status      = 'SPECIAL SESSION SCHEDULED';
        statusEmoji = '🔵';
        subtext     = `${todaySpecial.name} scheduled today at ${todaySpecial.startTime} IST`;
        badgeColor  = 'special';
      } else if (isWknd) {
        status      = 'MARKET CLOSED';
        statusEmoji = '🔴';
        subtext     = `Weekend – Markets are closed on ${ist.weekday}s`;
        badgeColor  = 'closed';
      } else if (isHol && !isMuhurat) {
        status      = 'MARKET CLOSED';
        statusEmoji = '🔴';
        subtext     = `${holiday.name} · NSE/BSE trading holiday`;
        badgeColor  = 'closed';
      } else if (isMuhurat && nowSec < MUHURAT_BOUNDS.startSec) {
        status      = 'SPECIAL SESSION SCHEDULED';
        statusEmoji = '🔵';
        subtext     = `${holiday.name} · Muhurat Trading today at ${MUHURAT_SESSION.start.slice(0,5)} IST`;
        badgeColor  = 'special';
      } else {
        status      = 'MARKET CLOSED';
        statusEmoji = '🔴';
        subtext     = nowSec < SESSION_BOUNDS.PRE_OPEN_ORDER_ENTRY.startSec
                        ? 'Pre-open session begins at 09:00 IST'
                        : 'Trading session has ended for today';
        badgeColor  = 'closed';
      }
      break;
  }

  // Market Close countdown
  let marketClose = null;
  if (phase === 'NORMAL' || phase === 'PRE_OPEN') {
    const closeTime = istToUTC(ist.dateStr, SESSION_BOUNDS.NORMAL.end);
    marketClose = {
      time: SESSION_BOUNDS.NORMAL.end.slice(0, 5),
      targetAt: closeTime.toISOString(),
      countdown: countdown(instant.getTime(), closeTime.getTime()),
    };
  } else if (phase === 'SPECIAL_SESSION') {
    const closeTimeStr = sessionInfo.endTime || MUHURAT_SESSION.end;
    const closeTime = istToUTC(ist.dateStr, closeTimeStr.length === 5 ? `${closeTimeStr}:00` : closeTimeStr);
    marketClose = {
      time: closeTimeStr.slice(0, 5),
      targetAt: closeTime.toISOString(),
      countdown: countdown(instant.getTime(), closeTime.getTime()),
    };
  }

  const nextOpen = hasUpcomingSpecial
    ? {
        date: ist.dateStr,
        time: todaySpecial.startTime.slice(0, 5),
        label: `${todaySpecial.name} today`,
        targetAt: istToUTC(ist.dateStr, todaySpecial.startTime).toISOString(),
        countdown: countdown(instant.getTime(), istToUTC(ist.dateStr, todaySpecial.startTime).getTime()),
      }
    : computeNextOpen(instant, ist, phase, isTradingDay, isHol, isMuhurat);

  const nextHol = computeNextHoliday(ist.dateStr);
  const upcomingHols = getUpcomingHolidays(5);
  const mcxStatus = getMCXScheduleStatus(instant);
  const specialSessions = getSpecialSessions(ist.year);

  return {
    phase,
    isOpen,
    isPreOpen,
    isClosing,
    isPostClose,
    isSpecialSession: isSpecialSess,
    isWeekend: isWknd,
    isHoliday: isHol,
    holiday: holiday ? { date: holiday.date, name: holiday.name } : null,
    holidayName: holiday ? holiday.name : null,
    isTradingDay,
    isVerified: true,
    status,
    statusEmoji,
    subtext,
    badgeColor,
    date: ist.dateStr,
    clock: ist.clockStr,
    weekday: ist.weekday,
    sessionInfo,
    nextOpen,
    marketClose,
    nextHoliday: nextHol,
    upcomingHolidays: upcomingHols,
    specialSessions,
    specialSession: (hasActiveSpecial || hasUpcomingSpecial) ? todaySpecial : (isMuhurat ? { date: ist.dateStr, name: 'Muhurat Trading', startTime: '18:15', endTime: '19:15' } : null),
    source: syncSucceeded ? 'NSE/BSE Live Feed' : 'NSE/BSE Official Exchange Calendar',
    lastUpdated: lastSyncTime ? lastSyncTime.toISOString() : null,
    stale: false,
    indexStatus: {
      nifty50: {
        exchange: 'NSE',
        index: 'NIFTY 50',
        segment: 'Equity (CM)',
        isVerified: true,
        status: (phase === 'SPECIAL_SESSION') ? 'SPECIAL TRADING SESSION' : (isOpen ? 'MARKET OPEN' : (isPreOpen ? 'PRE-OPEN' : 'MARKET CLOSED')),
        statusEmoji,
        phase,
        timings: '09:15–15:30 IST',
      },
      sensex: {
        exchange: 'BSE',
        index: 'SENSEX',
        segment: 'Equity',
        isVerified: true,
        status: (phase === 'SPECIAL_SESSION') ? 'SPECIAL TRADING SESSION' : (isOpen ? 'MARKET OPEN' : (isPreOpen ? 'PRE-OPEN' : 'MARKET CLOSED')),
        statusEmoji,
        phase,
        timings: '09:15–15:30 IST',
      },
      derivatives: {
        exchange: 'NSE',
        segment: 'Derivatives (F&O)',
        isVerified: true,
        status: isOpen ? 'MARKET OPEN' : 'MARKET CLOSED',
        statusEmoji: isOpen ? '🟢' : '🔴',
        phase,
        timings: '09:15–15:30 IST',
      },
      commodity: mcxStatus,
    },
  };
}

// ---------------------------------------------------------------------------
// 10.  syncNseCalendar
// ---------------------------------------------------------------------------

export async function syncNseCalendar(fetchNseHolidays) {
  if (typeof fetchNseHolidays !== 'function') {
    return;
  }

  try {
    const now  = new Date();
    const year = getISTParts(now).year;
    const dateFrom = `${year}-01-01`;
    const dateTo   = `${year}-12-31`;

    const result = await fetchNseHolidays(dateFrom, dateTo);
    if (!result || !Array.isArray(result.data)) {
      return;
    }

    let added = 0;
    for (const entry of result.data) {
      const rawDate = entry.tradingDate || entry.date;
      if (!rawDate) continue;

      let dateStr;
      if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
        dateStr = rawDate.slice(0, 10);
      } else {
        const parsed = new Date(rawDate);
        if (isNaN(parsed.getTime())) continue;
        const p = getISTParts(parsed);
        dateStr = p.dateStr;
      }

      const name = (entry.description || entry.name || 'NSE Holiday').trim();
      const isMuhurat = /muhurat|diwali/i.test(name);

      if (!liveOverlay.has(dateStr)) {
        liveOverlay.set(dateStr, {
          date: dateStr,
          name,
          isMuhuratTrading: isMuhurat,
        });
        added++;
      }
    }

    lastSyncTime  = now;
    syncSucceeded = true;
  } catch (err) {
    console.error('[MarketSchedule] syncNseCalendar failed:', err.message || err);
  }
}
