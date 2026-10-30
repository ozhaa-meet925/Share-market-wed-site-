import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, Clock } from 'lucide-react';
import { useLiveStocks } from '../hooks/useLiveStocks';
import { stocks as stockSeed } from '../data/stocks';
import { getMarketStatus } from '../utils/marketHours';

const TopTicker = () => {
  const { stocks } = useLiveStocks(stockSeed, 1000);
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());

  useEffect(() => {
    const timer = setInterval(() => setMarketStatus(getMarketStatus()), 30000);
    return () => clearInterval(timer);
  }, []);

  const items = stocks.slice(0, 6);

  return (
    <div className="top-ticker-bar">
      <div className={`ticker-badge ${marketStatus.isOpen ? 'badge-live' : 'badge-closed'}`}>
        {marketStatus.isOpen ? <Activity size={13} /> : <Clock size={13} />}
        <span>{marketStatus.isOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}</span>
      </div>
      <div className="ticker-track-wrapper">
        <div className="ticker-track">
          {[...items, ...items].map((item, idx) => {
            const hasQuote = Number(item.price) > 0;
            const positive = Number(item.changePercent) >= 0;
            return (
              <div key={`${item.symbol}-${idx}`} className="ticker-item">
                <span className="ticker-symbol">{item.symbol}</span>
                <span className="ticker-price">
                  {hasQuote ? `₹${Number(item.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </span>
                {item.isDemo ? (
                  <span className="ticker-change">Demo · simulated</span>
                ) : item.isLive && Number.isFinite(Number(item.changePercent)) ? (
                  <span className={`ticker-change ${positive ? 'positive' : 'negative'}`}>
                    {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {positive ? '+' : ''}{Number(item.changePercent).toFixed(2)}%
                  </span>
                ) : (
                  <span className="ticker-change">{item.isStale ? 'Last quote · stale' : 'Connect free Upstox token'}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="ticker-schedule-note">{marketStatus.subtext}</div>
    </div>
  );
};

export default TopTicker;
