import { useEffect, useState } from 'react';
import { Clock, Radio } from 'lucide-react';
import { getMarketStatus } from '../utils/marketHours';

const MarketStatusBadge = () => {
  const [marketInfo, setMarketInfo] = useState(getMarketStatus());

  useEffect(() => {
    const timer = setInterval(() => setMarketInfo(getMarketStatus()), 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="market-status-container">
      <div className={`market-status-badge ${marketInfo.isOpen ? 'market-status-live' : 'market-status-closed'}`}>
        <span className="market-status-dot" />
        <span className="market-status-text">
          {marketInfo.isOpen ? <Radio size={13} /> : <Clock size={13} />}
          {marketInfo.status}
        </span>
      </div>
      <div className="market-status-subtext">{marketInfo.subtext}</div>
    </div>
  );
};

export default MarketStatusBadge;
