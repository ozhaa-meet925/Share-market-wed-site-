import { createContext, useContext, useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const checkingStatus = {
  phase: 'CLOSED',
  isOpen: false,
  isPreOpen: false,
  isPreMarket: false,
  isClosing: false,
  isPostClose: false,
  isSpecialSession: false,
  isWeekend: false,
  isHoliday: false,
  holidayName: null,
  isTradingDay: null,
  isVerified: false,
  status: 'CHECKING NSE CALENDAR',
  statusEmoji: '🔴',
  subtext: 'Checking the official NSE holiday calendar and session hours.',
  badgeColor: 'closed',
  date: '',
  clock: '',
  weekday: '',
  sessionInfo: null,
  nextOpen: null,
  marketClose: null,
  nextHoliday: null,
  upcomingHolidays: [],
  specialSessions: [],
  source: '',
  stale: false,
  lastUpdated: null,
};

const MarketLiveContext = createContext({
  isTicking: false,
  isWeekendClosed: false,
  marketInfo: checkingStatus,
  toggleTicking: () => {},
  setIsTicking: () => {},
});

export const MarketLiveProvider = ({ children }) => {
  const [marketInfo, setMarketInfo] = useState(checkingStatus);
  const [isTicking, setIsTicking] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const status = await marketApi.getMarketStatus();
        if (!active) return;
        // Backward compat: map old fields to new
        const merged = {
          ...checkingStatus,
          ...status,
          // Ensure phase exists
          phase: status.phase || (
            status.isSpecialSession ? 'SPECIAL_SESSION'
            : status.isPreOpen || status.isPreMarket ? 'PRE_OPEN'
            : status.isClosing ? 'CLOSING'
            : status.isPostClose ? 'POST_CLOSE'
            : status.isOpen ? 'NORMAL'
            : 'CLOSED'
          ),
          statusEmoji: status.statusEmoji || (
            status.isSpecialSession ? '🔵'
            : status.isPreOpen || status.isPreMarket ? '🟡'
            : status.isOpen ? '🟢'
            : '🔴'
          ),
        };
        setMarketInfo(merged);
        setIsTicking(merged.isOpen === true || merged.isPreOpen === true || merged.isSpecialSession === true);
      } catch {
        if (!active) return;
        setMarketInfo((current) => ({
          ...current,
          isOpen: false,
          isVerified: false,
          phase: 'CLOSED',
          statusEmoji: '🔴',
          status: 'STATUS UNVERIFIED',
          subtext: 'Could not verify the NSE holiday calendar. Market automation is paused until status is available.',
          badgeColor: 'closed',
        }));
        setIsTicking(false);
      }
    };

    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const toggleTicking = () => setIsTicking((previous) => !previous);

  return (
    <MarketLiveContext.Provider
      value={{
        isTicking,
        isWeekendClosed: marketInfo.isWeekend === true,
        marketInfo,
        toggleTicking,
        setIsTicking,
      }}
    >
      {children}
    </MarketLiveContext.Provider>
  );
};

export const useMarketLiveContext = () => useContext(MarketLiveContext);
