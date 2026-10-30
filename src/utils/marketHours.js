/**
 * Utility to calculate Indian Stock Market (NSE / BSE) live status:
 * - Market Hours: Monday to Friday, 9:15 AM - 3:30 PM IST
 * - Pre-Market: Monday to Friday, 9:00 AM - 9:15 AM IST
 * - Closed: After 3:30 PM, before 9:00 AM, and Weekends (Saturday & Sunday)
 */

const indianWeekdays = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

export function isDemoSessionActive(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);

  return indianWeekdays.has(values.weekday) && minutes >= 9 * 60 && minutes < 16 * 60;
}

export function getMarketStatus() {
  const now = new Date();

  // Convert current time to IST (UTC+5:30)
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + (3600000 * 5.5));

  const day = istDate.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const isWeekend = day === 0 || day === 6;

  // 9:00 AM = 540 minutes, 9:15 AM = 555 minutes, 3:30 PM = 930 minutes
  const preMarketStart = 9 * 60; // 540
  const marketStart = 9 * 60 + 15; // 555
  const marketEnd = 15 * 60 + 30; // 930

  if (isWeekend) {
    const dayName = day === 6 ? 'Saturday' : 'Sunday';
    return {
      isOpen: false,
      isPreMarket: false,
      isWeekend: true,
      status: 'CLOSED (WEEKEND)',
      subtext: `Markets closed on ${dayName}. Reopens Monday at 09:15 AM IST.`,
      badgeColor: 'closed',
    };
  }

  if (timeInMinutes >= preMarketStart && timeInMinutes < marketStart) {
    return {
      isOpen: false,
      isPreMarket: true,
      isWeekend: false,
      status: 'PRE-MARKET',
      subtext: 'Pre-market order placement session (09:00 AM - 09:15 AM).',
      badgeColor: 'warning',
    };
  }

  if (timeInMinutes >= marketStart && timeInMinutes <= marketEnd) {
    return {
      isOpen: true,
      isPreMarket: false,
      isWeekend: false,
      status: 'MARKET LIVE',
      subtext: 'Regular trading session active (09:15 AM - 03:30 PM IST).',
      badgeColor: 'live',
    };
  }

  return {
    isOpen: false,
    isPreMarket: false,
    isWeekend: false,
    status: 'MARKET CLOSED',
    subtext: timeInMinutes > marketEnd
      ? 'Trading session ended. Reopens next trading day at 09:15 AM IST.'
      : 'Markets opening today at 09:15 AM IST.',
    badgeColor: 'closed',
  };
}
