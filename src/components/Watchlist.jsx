import { Star } from 'lucide-react';
import CompanyLogo from './CompanyLogo';
import { TickArrow, TickPrice, priceDirection } from './PriceChange';

const Watchlist = ({ items }) => (
  <section className="panel compact-watchlist-panel">
    <div className="section-heading">
      <h2>Watchlist</h2>
      <Star size={18} />
    </div>
    <div className="compact-list">
      {items.map((stock) => {
        const direction = priceDirection(stock.change, stock.changePercent, stock.flash, stock.lastTick);
        const hasChange = Number.isFinite(Number(stock.changePercent));
        return (
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
                <TickPrice as="b" value={stock.price} changePercent={stock.changePercent} />
                <span className="compact-quote-source">
                  {stock.isDemo
                    ? 'Demo price · not real'
                    : stock.isLive
                      ? 'Live quote'
                      : stock.isResearch
                        ? `Research quote · not live${stock.isStale ? ' · stale' : ' · delayed'}`
                        : stock.isStale ? 'Last quote · stale' : 'Quote status unavailable'}
                </span>
                {hasChange
                  ? (
                    <span className={direction === 'up' ? 'gain' : direction === 'down' ? 'loss' : 'price-flat'}>
                      <TickArrow direction={direction} />
                      {`${Number(stock.changePercent) > 0 ? '+' : ''}${Number(stock.changePercent).toFixed(2)}%`}{stock.isResearch ? ' · delayed' : ''}
                    </span>
                  )
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
        );
      })}
    </div>
  </section>
);

export default Watchlist;
