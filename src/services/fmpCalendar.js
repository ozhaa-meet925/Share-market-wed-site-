// src/services/fmpCalendar.js
// Simple helper to fetch calendar data from the market proxy.
// `type` must match one of the keys in CALENDAR_FEEDS (e.g., 'economic').
export async function fetchCalendar(type) {
  const resp = await fetch(`http://localhost:3001/api/fmp-test/${type}`);
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error || 'Failed to load calendar data');
  }
  const data = await resp.json();
  // Return the raw data array for easier rendering.
  return data.data || [];
}
