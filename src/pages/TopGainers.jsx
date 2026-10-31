import StockCard from '../components/StockCard';
import { stocks as stockSeed } from '../data/stocks';
import { useLiveStocks } from '../hooks/useLiveStocks';

const TopGainers = () => {
  const { stocks } = useLiveStocks(stockSeed);
  const gainers = [...stocks].filter((stock) => (stock.isLive || stock.isDemo) && stock.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent);

  return (
    <div className="page">
      <div className="page-title">
        <span>Market Movers</span>
        <h1>Top Gainers</h1>
      </div>
      <div className="stock-grid">
        {gainers.length ? gainers.map((stock) => <StockCard key={stock.symbol} stock={stock} />) : <div className="panel">Top gainer quotes are unavailable. Configure a live market data provider to load current prices.</div>}
      </div>
    </div>
  );
};

export default TopGainers;
