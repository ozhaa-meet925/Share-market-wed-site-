import { useEffect, useState } from 'react';
import { Activity, Clock } from 'lucide-react';
import { useLiveStocks } from '../hooks/useLiveStocks';
import { stocks as stockSeed } from '../data/stocks';
import { useMarketLiveContext } from '../context/MarketLiveContext';
import { TickArrow, priceDirection, tickToneClass } from './PriceChange';

const TopTicker = () => {
  const { stocks } = useLiveStocks(stockSeed);
  const { marketInfo } = useMarketLiveContext();
  const marketStatus = marketInfo || {};
  const [now, setNow] = useState(Date.now);

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

  const isLiveOrSpecial = marketStatus.isOpen || marketStatus.isSpecialSession;
  const isPreOpen = marketStatus.isPreOpen || marketStatus.isPreMarket;
  const statusEmoji = marketStatus.statusEmoji || (marketStatus.isSpecialSession ? '🔵' : (marketStatus.isOpen ? '🟢' : (isPreOpen ? '🟡' : '🔴')));

  const badgeLabel = marketStatus.isSpecialSession
    ? 'SPECIAL SESSION'
    : isPreOpen
      ? 'PRE-OPEN'
      : marketStatus.isOpen ? 'MARKET OPEN' : 'MARKET CLOSED';

  const badgeState = marketStatus.isSpecialSession
    ? 'badge-special'
    : isPreOpen
      ? 'badge-preopen'
      : marketStatus.isOpen ? 'badge-live' : 'badge-closed';

  const items = stocks.slice(0, 6);

  return (
    <div className="top-ticker-bar">
      <div className={`ticker-badge ${badgeState}`} title="Exchange live session status">
        {marketStatus.isOpen ? <Activity size={13} /> : <Clock size={13} />}
        <span>{statusEmoji} {badgeLabel}</span>
        {isLiveOrSpecial && marketStatus.marketClose ? (
          <span style={{ opacity: 0.88, fontSize: '11px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            ({countdownText(marketStatus.marketClose.targetAt, marketStatus.marketClose.countdown)})
          </span>
        ) : marketStatus.nextOpen ? (
          <span style={{ opacity: 0.88, fontSize: '11px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            (Opens {countdownText(marketStatus.nextOpen.targetAt, marketStatus.nextOpen.countdown)})
          </span>
        ) : null}
      </div>

      <div className="ticker-track-wrapper">
        <div className="ticker-track">
          {[...items, ...items].map((item, idx) => {
            const hasQuote = Number(item.price) > 0;
            const direction = priceDirection(item.change, item.changePercent, item.flash, item.lastTick);
            const tone = tickToneClass(direction, item.flash);
            const hasChangePercent = Number.isFinite(Number(item.changePercent));
            return (
              <div key={`${item.symbol}-${idx}`} className="ticker-item">
                <span className="ticker-symbol">{item.symbol}</span>
                <span className={`ticker-price ${tone}`}>
                  {hasQuote ? `₹${Number(item.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </span>
                {item.isDemo ? (
                  <span className="ticker-change">Demo · simulated</span>
                ) : hasQuote && hasChangePercent ? (
                  <span className={`ticker-change ${direction === 'up' ? 'positive' : direction === 'down' ? 'negative' : ''}`}>
                    <TickArrow direction={direction} />
                    {Number(item.changePercent) >= 0 ? '+' : ''}{Number(item.changePercent).toFixed(2)}%
                    {item.isResearch ? ' · research' : item.isStale ? ' · stale' : ''}
                  </span>
                ) : item.isResearch ? (
                  <span className="ticker-change">Research · not live{item.isStale ? ' · stale' : ''}</span>
                ) : (
                  <span className="ticker-change">{item.isStale ? 'Last quote · stale' : 'Live quote required'}</span>
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
