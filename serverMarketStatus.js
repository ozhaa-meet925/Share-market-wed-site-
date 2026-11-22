const TIME_ZONE = 'Asia/Kolkata';
const NORMAL_OPEN = 9 * 60 + 15;
const NORMAL_CLOSE = 15 * 60 + 30;
const PRE_OPEN = 9 * 60;

const istFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const isoDate = ({ year, month, day }) => `${year}-${month}-${day}`;

const dateParts = (instant) => {
  const parts = Object.fromEntries(istFormatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  return {
    date: isoDate(parts),
    year: Number(parts.year),
    clock: `${String(hour).padStart(2, '0')}:${parts.minute}:${parts.second}`,
    seconds: hour * 3600 + Number(parts.minute) * 60 + Number(parts.second),
    weekday: parts.weekday,
    weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun',
  };
};

const dateFromKey = (key) => new Date(`${key}T00:00:00.000Z`);

const dateKeyFromDate = (date) => date.toISOString().slice(0, 10);

const addDays = (dateKey, count) => {
  const date = dateFromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + count);
  return dateKeyFromDate(date);
};

const weekdayForDate = (dateKey) => new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
const isWeekendDate = (dateKey) => [0, 6].includes(weekdayForDate(dateKey));

const timeSeconds = (value) => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
};

const asIstEpoch = (dateKey, time) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second) - 330 * 60_000;
};

const countdown = (now, target) => {
  let seconds = Math.max(0, Math.floor((target - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  return { hours, minutes, seconds: seconds % 60 };
};

const normalizeEvent = (event) => {
  const start = timeSeconds(event.startTime);
  const end = timeSeconds(event.endTime);
  return {
    ...event,
    startSeconds: start,
    endSeconds: end,
    hasSchedule: event.status === 'special_session' && start !== null && end !== null && end > start,
  };
};

const sessionEventFor = (events, date) => events.find((event) => event.date === date && event.status === 'special_session');
const holidayFor = (events, date) => events.find((event) => event.date === date && event.status === 'closed');

const formatCountdown = (value) => ({
  hours: value.hours,
  minutes: value.minutes,
  seconds: value.seconds,
});

const findNextOpen = ({ now, parts, events, completeYears, currentPhase }) => {
  if (currentPhase === 'NORMAL' || currentPhase === 'SPECIAL_SESSION') {
    return {
      date: parts.date,
      time: parts.clock,
      label: 'Market is currently open',
      targetAt: new Date(now).toISOString(),
      countdown: { hours: 0, minutes: 0, seconds: 0 },
    };
  }

  for (let offset = 0; offset <= 370; offset += 1) {
    const date = addDays(parts.date, offset);
    if (!completeYears.has(date.slice(0, 4))) return null;

    const special = sessionEventFor(events, date);
    if (special?.hasSchedule) {
      if (offset > 0 || parts.seconds < special.startSeconds) {
        const [hour, minute] = special.startTime.split(':');
        const target = asIstEpoch(date, `${hour}:${minute}:${String(special.startTime.split(':')[2] || '00').padStart(2, '0')}`);
        return {
          date,
          time: special.startTime,
          label: `${special.name} ${offset === 0 ? 'today' : ''}`.trim(),
          targetAt: new Date(target).toISOString(),
          countdown: formatCountdown(countdown(now, target)),
        };
      }
    }

    if (!isWeekendDate(date) && !holidayFor(events, date) && !special) {
      const targetTime = offset > 0 || parts.seconds < PRE_OPEN * 60 ? '09:00:00' : '09:15:00';
      const targetSeconds = timeSeconds(targetTime);
      if (offset > 0 || parts.seconds < targetSeconds) {
        const [hour, minute] = targetTime.split(':');
        return {
          date,
          time: `${hour}:${minute}`,
          label: offset === 0 ? 'Opens today' : 'Next trading session',
          targetAt: new Date(asIstEpoch(date, targetTime)).toISOString(),
          countdown: formatCountdown(countdown(now, asIstEpoch(date, targetTime))),
        };
      }
    }
  }
  return null;
};

export const buildMarketStatus = ({
  instant = new Date(),
  events = [],
  completeYears = [],
  isVerified = false,
  stale = false,
  source = 'NSE India',
  lastUpdated = null,
}) => {
  const now = instant.getTime();
  const parts = dateParts(instant);
  const normalizedEvents = events.map(normalizeEvent);
  const completeYearSet = new Set(completeYears.map(String));
  const calendarVerified = isVerified && !stale && completeYearSet.has(String(parts.date.slice(0, 4)));
  const holiday = holidayFor(normalizedEvents, parts.date);
  const special = sessionEventFor(normalizedEvents, parts.date);
  const specialHasSchedule = Boolean(special?.hasSchedule);
  const normalTradingDay = !parts.weekend && !holiday && !special;
  const specialPending = Boolean(special && !specialHasSchedule);
  const verified = calendarVerified && !specialPending;
  const isTradingDay = specialHasSchedule ? true : specialPending ? null : normalTradingDay;
  const minutes = parts.seconds / 60;
  let phase = 'CLOSED';
  let isOpen = false;
  let isPreOpen = false;
  let isClosing = false;
  let isPostClose = false;
  let sessionInfo = { name: 'Market Closed', startTime: null, endTime: null };
  let marketClose = null;

  if (verified && specialHasSchedule) {
    const startTime = special.startTime;
    const endTime = special.endTime;
    if (parts.seconds >= special.startSeconds && parts.seconds < special.endSeconds) {
      phase = 'SPECIAL_SESSION';
      isOpen = true;
      sessionInfo = { name: special.name, startTime, endTime };
      marketClose = {
        time: endTime.slice(0, 5),
        targetAt: new Date(asIstEpoch(parts.date, endTime)).toISOString(),
        countdown: countdown(now, asIstEpoch(parts.date, endTime)),
      };
    } else {
      sessionInfo = { name: `${special.name} scheduled`, startTime, endTime };
    }
  } else if (verified && normalTradingDay) {
    if (minutes >= 9 * 60 && minutes < NORMAL_OPEN) {
      phase = 'PRE_OPEN';
      isPreOpen = true;
      sessionInfo = { name: 'Pre-Open', startTime: '09:00', endTime: '09:15' };
    } else if (minutes >= NORMAL_OPEN && minutes < NORMAL_CLOSE) {
      phase = 'NORMAL';
      isOpen = true;
      sessionInfo = { name: 'Normal Market', startTime: '09:15', endTime: '15:30' };
    } else if (minutes >= NORMAL_CLOSE && minutes < 15 * 60 + 40) {
      phase = 'CLOSING';
      isClosing = true;
      sessionInfo = { name: 'Closing Session', startTime: '15:30', endTime: '15:40' };
    } else if (minutes >= 15 * 60 + 40 && minutes < 16 * 60) {
      phase = 'POST_CLOSE';
      isPostClose = true;
      sessionInfo = { name: 'Post-Close Session', startTime: '15:40', endTime: '16:00' };
    }

    if (isPreOpen || isOpen) {
      marketClose = {
        time: '15:30',
        targetAt: new Date(asIstEpoch(parts.date, '15:30:00')).toISOString(),
        countdown: countdown(now, asIstEpoch(parts.date, '15:30:00')),
      };
    }
  }

  if (specialPending && calendarVerified) {
    phase = 'SPECIAL_UNVERIFIED';
  } else if (!verified) {
    phase = 'UNVERIFIED';
    sessionInfo = { name: 'Exchange calendar unavailable', startTime: null, endTime: null };
  }

  const statusByPhase = {
    PRE_OPEN: ['PRE-OPEN', '🟡', 'preopen'],
    NORMAL: ['MARKET OPEN', '🟢', 'live'],
    CLOSING: ['CLOSING SESSION', '🟡', 'preopen'],
    POST_CLOSE: ['POST-CLOSE SESSION', '🟡', 'preopen'],
    SPECIAL_SESSION: ['SPECIAL TRADING SESSION', '🔵', 'special'],
    SPECIAL_UNVERIFIED: ['SPECIAL SESSION HOURS UNVERIFIED', '🔵', 'special'],
    UNVERIFIED: ['STATUS UNVERIFIED', '🔴', 'closed'],
    CLOSED: ['MARKET CLOSED', '🔴', 'closed'],
  }[phase];

  let subtext;
  if (phase === 'UNVERIFIED') {
    subtext = stale
      ? 'The official NSE trading calendar is stale. Trading is blocked until it is refreshed.'
      : 'The official NSE trading calendar could not be verified. Trading is blocked.';
  } else if (phase === 'SPECIAL_UNVERIFIED') {
    subtext = `${special.name} is listed by NSE, but its official session hours are unavailable. Trading remains blocked.`;
  } else if (phase === 'SPECIAL_SESSION') {
    subtext = `${special.name} · ${special.startTime}–${special.endTime} IST.`;
  } else if (holiday) {
    subtext = `${holiday.name} · NSE equity market holiday.`;
  } else if (parts.weekend && !specialHasSchedule) {
    subtext = `Markets are closed on ${parts.weekday}.`;
  } else if (phase === 'PRE_OPEN') {
    subtext = 'Pre-open session (09:00–09:15 IST); normal trading starts at 09:15.';
  } else if (phase === 'NORMAL') {
    subtext = 'Normal NSE equity trading session (09:15–15:30 IST).';
  } else if (phase === 'CLOSING') {
    subtext = 'Closing session.';
  } else if (phase === 'POST_CLOSE') {
    subtext = 'Post-close session.';
  } else if (specialHasSchedule) {
    subtext = `${special.name} scheduled ${special.startTime}–${special.endTime} IST.`;
  } else {
    subtext = minutes < 9 * 60
      ? 'The pre-open session begins at 09:00 IST.'
      : 'The regular trading session has ended for today.';
  }

  const nextOpen = verified
    ? findNextOpen({ now, parts, events: normalizedEvents, completeYears: completeYearSet, currentPhase: phase })
    : null;
  const upcomingHoliday = normalizedEvents
    .filter((event) => event.date >= parts.date && completeYearSet.has(event.date.slice(0, 4)))
    .sort((left, right) => left.date.localeCompare(right.date))[0];

  return {
    phase,
    isOpen,
    isPreOpen,
    isClosing,
    isPostClose,
    isSpecialSession: phase === 'SPECIAL_SESSION',
    isWeekend: parts.weekend,
    isHoliday: Boolean(holiday),
    holiday: holiday ? { date: holiday.date, name: holiday.name } : null,
    holidayName: holiday?.name || null,
    isTradingDay: verified ? isTradingDay : null,
    isVerified: verified,
    status: statusByPhase[0],
    statusEmoji: statusByPhase[1],
    badgeColor: statusByPhase[2],
    subtext,
    date: parts.date,
    clock: parts.clock,
    weekday: parts.weekday,
    minutes: Math.floor(minutes),
    sessionInfo,
    nextOpen,
    marketClose,
    nextHoliday: upcomingHoliday ? { date: upcomingHoliday.date, name: upcomingHoliday.name } : null,
    specialSession: special ? {
      date: special.date,
      name: special.name,
      startTime: special.startTime || null,
      endTime: special.endTime || null,
    } : null,
    source,
    stale: Boolean(stale),
    lastUpdated,
  };
};

export const getMarketCalendarDateParts = (instant = new Date()) => dateParts(instant);
