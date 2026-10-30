import { Star } from 'lucide-react';
import CompanyLogo from './CompanyLogo';

const Watchlist = ({ items }) => (
  <section className="panel compact-watchlist-panel">
    <div className="section-heading">
      <h2>Watchlist</h2>
      <Star size={18} />
    </div>
    <div className="compact-list">
      {items.map((stock) => (
        <div className="compact-row" key={stock.symbol}>
          <div className="compact-company-wrap">
            <CompanyLogo symbol={stock.symbol} name={stock.name} size={30} />
            <div>
              <strong>{stock.symbol}</strong>
              <span>{stock.name}</span>
            </div>
          </div>
          <div className="align-right">
            {Number(stock.price) > 0 ? (
              <>
                <b>₹{Number(stock.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                <span className="compact-quote-source">
                  {stock.isDemo
                    ? 'Demo price · not real'
                    : stock.isLive
                      ? 'Live quote'
                      : stock.isResearch
                        ? `Research quote · not live${stock.isStale ? ' · stale' : ' · delayed'}`
                        : stock.isStale ? 'Last quote · stale' : 'Quote status unavailable'}
                </span>
                {stock.changePercent !== null && Number.isFinite(Number(stock.changePercent))
                  ? <span className={Number(stock.changePercent) >= 0 ? 'gain' : 'loss'}>{Number(stock.changePercent) >= 0 ? '+' : ''}{Number(stock.changePercent).toFixed(2)}%{stock.isResearch ? ' · delayed' : ''}</span>
                  : <span>Change unavailable</span>}
              </>
            ) : (
              <>
                <b>Quote unavailable</b>
                <span>{stock.dataSource || 'Waiting for a market quote'}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  </section>
);

export default Watchlist;
