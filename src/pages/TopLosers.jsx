import StockCard from '../components/StockCard';
import { stocks as stockSeed } from '../data/stocks';
import { useLiveStocks } from '../hooks/useLiveStocks';

const TopLosers = () => {
  const { stocks } = useLiveStocks(stockSeed);
  const losers = [...stocks].filter((stock) => (stock.isLive || stock.isDemo) && stock.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent);

  return (
    <div className="page">
      <div className="page-title">
        <span>Market Movers</span>
        <h1>Top Losers</h1>
      </div>
      <div className="stock-grid">
        {losers.length ? losers.map((stock) => <StockCard key={stock.symbol} stock={stock} />) : <div className="panel">Top loser quotes are unavailable. Add the free Upstox Analytics Token to .env.</div>}
      </div>
    </div>
  );
};

export default TopLosers;
