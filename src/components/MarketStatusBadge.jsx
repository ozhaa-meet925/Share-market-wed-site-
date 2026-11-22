import { useEffect, useState } from 'react';
import { Calendar, ChevronDown, ChevronUp, Clock, Info, Radio, Sparkles } from 'lucide-react';
import { useMarketLiveContext } from '../context/MarketLiveContext';
import './MarketStatusBadge.css';

const istClockFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const istDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const phaseEmoji = (info) => {
  if (info.statusEmoji) return info.statusEmoji;
  if (info.isSpecialSession) return '🔵';
  if (info.isPreOpen || info.isPreMarket) return '🟡';
  if (info.isOpen) return '🟢';
  return '🔴';
};

const phaseLabel = (info) => {
  if (info.status) return info.status;
  if (info.isSpecialSession) return 'SPECIAL TRADING SESSION';
  if (info.isPreOpen || info.isPreMarket) return 'PRE-OPEN';
  if (info.isOpen) return 'MARKET OPEN';
  return 'MARKET CLOSED';
};

const badgeClass = (info) => {
  if (info.isSpecialSession) return 'market-status-special';
  if (info.isPreOpen || info.isPreMarket) return 'market-status-preopen';
  if (info.isOpen) return 'market-status-live';
  return 'market-status-closed';
};

const panelModifierClass = (info) => {
  if (info.isSpecialSession) return 'is-special';
  if (info.isPreOpen || info.isPreMarket) return 'is-preopen';
  if (info.isOpen) return 'is-open';
  return 'is-closed';
};

const MarketStatusBadge = () => {
  const { marketInfo } = useMarketLiveContext();
  const status = marketInfo || {};
  const [now, setNow] = useState(Date.now);
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const countdownText = (targetAt, fallback) => {
    const target = Date.parse(targetAt || '');
    const secondsLeft = Number.isFinite(target)
      ? Math.max(0, Math.floor((target - now) / 1000))
      : Math.max(0, Number(fallback?.hours || 0) * 3600 + Number(fallback?.minutes || 0) * 60 + Number(fallback?.seconds || 0));
    const hours = Math.floor(secondsLeft / 3600);
    const minutes = Math.floor((secondsLeft % 3600) / 60);
    const seconds = secondsLeft % 60;
    return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
  };

  const isLiveOrSpecial = status.isOpen || status.isSpecialSession;
  const isPreOpen = status.isPreOpen || status.isPreMarket;

  const niftyStatus = status.indexStatus?.nifty50?.status || (isLiveOrSpecial ? 'MARKET OPEN' : (isPreOpen ? 'PRE-OPEN' : 'MARKET CLOSED'));
  const sensexStatus = status.indexStatus?.sensex?.status || (isLiveOrSpecial ? 'MARKET OPEN' : (isPreOpen ? 'PRE-OPEN' : 'MARKET CLOSED'));
  const mcxStatus = status.indexStatus?.commodity?.status || 'MARKET OPEN';

  const nextHol = status.nextHoliday;

  return (
    <div className={`market-status-panel ${panelModifierClass(status)}`} role="region" aria-label="Indian Stock Market Status">
      {/* ── Top Header: Status Pill + Live IST Clock ── */}
      <div className="market-status-header">
        <div className={`market-status-badge ${badgeClass(status)}`}>
          <span className="market-status-dot" aria-hidden="true" />
          <span>
            {phaseEmoji(status)} {phaseLabel(status)}
          </span>
        </div>

        <div className="market-status-clock" title="Indian Standard Time (IST)">
          <Clock size={13} />
          <span>{istDateFormatter.format(now)} · <b>{istClockFormatter.format(now)} IST</b></span>
        </div>
      </div>

      {/* ── Middle Highlights: Live Countdown & Session Tag ── */}
      <div className="market-status-metrics">
        <div className="market-metric-box">
          <span className="market-metric-label">
            <Clock size={12} />
            {isLiveOrSpecial ? 'Market Closes In' : 'Next Market Open'}
          </span>
          <span className={`market-metric-value highlight-countdown ${isLiveOrSpecial ? '' : 'is-closed'}`}>
            {isLiveOrSpecial
              ? countdownText(status.marketClose?.targetAt, status.marketClose?.countdown)
              : status.nextOpen
                ? `${countdownText(status.nextOpen.targetAt, status.nextOpen.countdown)} · ${status.nextOpen.time} IST`
                : '—'}
          </span>
        </div>

        <div className="market-metric-box">
          <span className="market-metric-label">
            <Radio size={12} />
            Today's Session
          </span>
          <span className="market-metric-value" style={{ fontSize: '12px' }}>
            {status.sessionInfo?.name || (status.isWeekend ? 'Weekend Closure' : (status.holiday?.name ? status.holiday.name : 'Normal Market (09:15–15:30)'))}
          </span>
        </div>
      </div>

      {/* ── Indices Strip: NIFTY 50, SENSEX, MCX ── */}
      <div className="market-indices-strip">
        <div className="market-index-chip">
          <span className="market-index-name">NIFTY 50 (NSE)</span>
          <span className={`market-index-tag ${niftyStatus.includes('OPEN') ? 'is-open' : (niftyStatus.includes('SPECIAL') ? 'is-special' : 'is-closed')}`}>
            {niftyStatus.includes('OPEN') ? 'OPEN' : (niftyStatus.includes('PRE') ? 'PRE-OPEN' : (niftyStatus.includes('SPECIAL') ? 'SPECIAL' : 'CLOSED'))}
          </span>
        </div>

        <div className="market-index-chip">
          <span className="market-index-name">SENSEX (BSE)</span>
          <span className={`market-index-tag ${sensexStatus.includes('OPEN') ? 'is-open' : (sensexStatus.includes('SPECIAL') ? 'is-special' : 'is-closed')}`}>
            {sensexStatus.includes('OPEN') ? 'OPEN' : (sensexStatus.includes('PRE') ? 'PRE-OPEN' : (sensexStatus.includes('SPECIAL') ? 'SPECIAL' : 'CLOSED'))}
          </span>
        </div>

        <div className="market-index-chip">
          <span className="market-index-name">MCX Bullion</span>
          <span className={`market-index-tag ${mcxStatus.includes('OPEN') ? 'is-open' : 'is-closed'}`}>
            {mcxStatus.includes('OPEN') ? 'OPEN (09:00–23:30)' : 'CLOSED'}
          </span>
        </div>
      </div>

      {/* ── Footer: Next Holiday + Accordion Toggle ── */}
      <div className="market-status-footer">
        <div className="market-holiday-notice">
          <Calendar size={13} />
          {nextHol ? (
            <span>
              Next holiday: <b>{nextHol.name}</b> · {nextHol.date}{nextHol.daysAway !== undefined ? ` (${nextHol.daysAway}d)` : ''}
            </span>
          ) : (
            <span>Official Exchange Schedule (IST)</span>
          )}
        </div>

        <button
          type="button"
          className="market-schedule-toggle-btn"
          onClick={() => setShowSchedule((prev) => !prev)}
          aria-expanded={showSchedule}
        >
          <span>{showSchedule ? 'Hide Timetable' : 'Exchange Hours'}</span>
          {showSchedule ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {status.subtext && (
        <div className="market-status-note">
          <Info size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
          {status.subtext}
        </div>
      )}

      {/* ── Expandable Timetable Drawer ── */}
      {showSchedule && (
        <div className="market-schedule-drawer">
          <div className="schedule-drawer-heading">
            <span>Official Indian Stock Market Timetable (IST)</span>
            <span style={{ fontSize: '10.5px', color: 'var(--text-3)' }}>NSE · BSE · MCX</span>
          </div>

          <div className="schedule-timeline-list">
            <div className={`schedule-timeline-item ${status.phase === 'PRE_OPEN' ? 'is-current' : ''}`}>
              <span>Pre-Open Session (Order Entry & Matching)</span>
              <span className="schedule-timeline-time">09:00 – 09:15 IST</span>
            </div>
            <div className={`schedule-timeline-item ${status.phase === 'NORMAL' ? 'is-current' : ''}`}>
              <span>Continuous Trading (NSE / BSE Equity & F&O)</span>
              <span className="schedule-timeline-time">09:15 – 15:30 IST</span>
            </div>
            <div className={`schedule-timeline-item ${status.phase === 'CLOSING' ? 'is-current' : ''}`}>
              <span>Closing Auction (30-min VWAP calculation)</span>
              <span className="schedule-timeline-time">15:30 – 15:40 IST</span>
            </div>
            <div className={`schedule-timeline-item ${status.phase === 'POST_CLOSE' ? 'is-current' : ''}`}>
              <span>Post-Market Session (Trading at Close Price)</span>
              <span className="schedule-timeline-time">15:40 – 16:00 IST</span>
            </div>
            <div className={`schedule-timeline-item ${status.phase === 'SPECIAL_SESSION' ? 'is-current' : ''}`}>
              <span>Special Trading (Diwali Muhurat & Saturday Sessions)</span>
              <span className="schedule-timeline-time">Announced Hours</span>
            </div>
            <div className="schedule-timeline-item">
              <span>MCX Commodities (Gold, Silver, Crude Oil)</span>
              <span className="schedule-timeline-time">09:00 – 23:30 IST</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketStatusBadge;
