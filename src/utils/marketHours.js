// Demo-only time gate; exchange status is supplied by the backend market calendar.
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
