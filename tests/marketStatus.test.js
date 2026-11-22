import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketStatus } from '../serverMarketStatus.js';
import { getMarketScheduleStatus, getMCXScheduleStatus, getUpcomingHolidays } from '../serverMarketSchedule.js';

const verified = { completeYears: ['2026'], isVerified: true };

test('NSE equity status uses IST pre-open, normal and close boundaries', () => {
  const preOpen = buildMarketStatus({ ...verified, instant: new Date('2026-11-12T03:05:00.000Z') });
  assert.equal(preOpen.clock, '08:35:00');
  assert.equal(preOpen.phase, 'CLOSED');

  const preOpenWindow = buildMarketStatus({ ...verified, instant: new Date('2026-11-12T03:30:00.000Z') });
  assert.equal(preOpenWindow.phase, 'PRE_OPEN');
  assert.equal(preOpenWindow.nextOpen.time, '09:15');

  const normal = buildMarketStatus({ ...verified, instant: new Date('2026-11-12T03:45:00.000Z') });
  assert.equal(normal.phase, 'NORMAL');
  assert.equal(normal.isOpen, true);

  const closingBoundary = buildMarketStatus({ ...verified, instant: new Date('2026-11-12T10:00:00.000Z') });
  assert.equal(closingBoundary.phase, 'CLOSING');
  assert.equal(closingBoundary.isOpen, false);
});

test('official holidays close ordinary weekday sessions and appear in dashboard data', () => {
  const result = buildMarketStatus({
    ...verified,
    instant: new Date('2026-11-12T04:00:00.000Z'),
    events: [{ date: '2026-11-12', name: 'Exchange holiday', status: 'closed' }],
  });
  assert.equal(result.phase, 'CLOSED');
  assert.equal(result.isOpen, false);
  assert.deepEqual(result.holiday, { date: '2026-11-12', name: 'Exchange holiday' });
});

test('an official special session overrides a Saturday closure for its published hours', () => {
  const event = {
    date: '2026-11-14',
    name: 'Special Saturday session',
    status: 'special_session',
    startTime: '10:00',
    endTime: '13:00',
  };
  const during = buildMarketStatus({
    ...verified,
    instant: new Date('2026-11-14T05:30:00.000Z'),
    events: [event],
  });
  assert.equal(during.isWeekend, true);
  assert.equal(during.phase, 'SPECIAL_SESSION');
  assert.equal(during.isOpen, true);

  const before = buildMarketStatus({
    ...verified,
    instant: new Date('2026-11-14T04:29:30.000Z'),
    events: [event],
  });
  assert.equal(before.nextOpen.time, '10:00');
  assert.equal(before.nextOpen.countdown.seconds, 30);
});

test('special events with no published hours and stale calendars fail closed', () => {
  const missingHours = buildMarketStatus({
    ...verified,
    instant: new Date('2026-11-14T05:30:00.000Z'),
    events: [{ date: '2026-11-14', name: 'Special session', status: 'special_session' }],
  });
  assert.equal(missingHours.phase, 'SPECIAL_UNVERIFIED');
  assert.equal(missingHours.isOpen, false);
  assert.equal(missingHours.isTradingDay, null);

  const stale = buildMarketStatus({
    ...verified,
    stale: true,
    instant: new Date('2026-11-12T04:00:00.000Z'),
  });
  assert.equal(stale.isVerified, false);
  assert.equal(stale.phase, 'UNVERIFIED');
  assert.equal(stale.isOpen, false);
});

test('market close and next session countdowns have exact server timestamps', () => {
  const open = buildMarketStatus({
    ...verified,
    instant: new Date('2026-11-12T09:59:00.000Z'),
  });
  assert.equal(open.marketClose.countdown.seconds, 0);
  assert.equal(open.marketClose.countdown.minutes, 1);
  assert.equal(Date.parse(open.marketClose.targetAt), Date.parse('2026-11-12T10:00:00.000Z'));

  const saturday = buildMarketStatus({
    ...verified,
    instant: new Date('2026-11-14T05:00:00.000Z'),
  });
  assert.equal(saturday.nextOpen.date, '2026-11-16');
  assert.equal(saturday.nextOpen.time, '09:00');
});

test('calendar and current-year verification are required before showing a market status', () => {
  const result = buildMarketStatus({ instant: new Date('2026-11-12T04:00:00.000Z') });
  assert.equal(result.isVerified, false);
  assert.equal(result.status, 'STATUS UNVERIFIED');
  assert.equal(result.nextOpen, null);
});

test('getMarketScheduleStatus reports multi-segment statuses for NSE, BSE and MCX', () => {
  const openInstant = new Date('2026-11-12T05:00:00.000Z'); // 10:30 AM IST on Thursday
  const status = getMarketScheduleStatus(openInstant);
  assert.equal(status.isOpen, true);
  assert.equal(status.phase, 'NORMAL');
  assert.equal(status.status, 'MARKET OPEN');
  assert.equal(status.statusEmoji, '🟢');
  assert.equal(status.indexStatus.nifty50.status, 'MARKET OPEN');
  assert.equal(status.indexStatus.sensex.status, 'MARKET OPEN');
  assert.equal(status.indexStatus.derivatives.status, 'MARKET OPEN');
  assert.equal(status.indexStatus.commodity.isOpen, true);
  assert.ok(status.upcomingHolidays.length > 0);
});

test('MCX commodity market timing handles morning and evening sessions', () => {
  const morning = getMCXScheduleStatus(new Date('2026-11-12T05:00:00.000Z')); // 10:30 AM IST
  assert.equal(morning.isOpen, true);
  assert.equal(morning.phase, 'MORNING_SESSION');

  const evening = getMCXScheduleStatus(new Date('2026-11-12T13:00:00.000Z')); // 18:30 IST (6:30 PM IST)
  assert.equal(evening.isOpen, true);
  assert.equal(evening.phase, 'EVENING_SESSION');

  const night = getMCXScheduleStatus(new Date('2026-11-12T18:45:00.000Z')); // 00:15 IST (after midnight)
  assert.equal(night.isOpen, false);
  assert.equal(night.phase, 'CLOSED');
});
