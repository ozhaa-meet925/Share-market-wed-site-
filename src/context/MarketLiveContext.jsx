import { createContext, useContext, useState } from 'react';
import { getMarketStatus } from '../utils/marketHours';

const MarketLiveContext = createContext({
  isTicking: false,
  isWeekendClosed: false,
  toggleTicking: () => {},
  setIsTicking: () => {},
});

export const MarketLiveProvider = ({ children }) => {
  const initialStatus = getMarketStatus();

  // Automatically close/pause live ticks on Saturday and Sunday
  const [isTicking, setIsTicking] = useState(() => initialStatus.isOpen);

  const toggleTicking = () => setIsTicking((prev) => !prev);

  return (
    <MarketLiveContext.Provider
      value={{
        isTicking,
        isWeekendClosed: initialStatus.isWeekend,
        toggleTicking,
        setIsTicking,
      }}
    >
      {children}
    </MarketLiveContext.Provider>
  );
};

export const useMarketLiveContext = () => useContext(MarketLiveContext);
