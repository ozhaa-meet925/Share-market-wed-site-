import { BriefcaseBusiness } from 'lucide-react';
import { TickArrow, tickToneClass } from './PriceChange';

const Portfolio = ({ holdings }) => {
  const hasQuoteValue = (item) => (item.isLive || item.isDemo || item.isResearch || item.isStale)
    && item.value !== null
    && item.value !== undefined
    && Number.isFinite(Number(item.value));
  const hasDayGain = (item) => item.dayGain !== null
    && item.dayGain !== undefined
    && Number.isFinite(Number(item.dayGain));
  const hasChange = (item) => item.pnl !== null
    && item.pnl !== undefined
    && Number.isFinite(Number(item.pnl));
  const allQuotesAvailable = holdings.length > 0 && holdings.every(hasQuoteValue);
  const quoteCount = holdings.filter(hasQuoteValue).length;
  const hasDemoValues = holdings.some((item) => item.isDemo === true && hasQuoteValue(item));
  const liveSources = [...new Set(holdings
    .filter((item) => item.isLive === true && hasQuoteValue(item))
    .map((item) => item.dataSource)
    .filter(Boolean))];
  const hasResearchValues = holdings.some((item) => (item.isResearch === true || item.isStale === true) && hasQuoteValue(item));
  const total = allQuotesAvailable ? holdings.reduce((sum, item) => sum + item.value, 0) : null;
  const allChangesAvailable = allQuotesAvailable && holdings.every(hasDayGain);
  const dayGain = allChangesAvailable ? holdings.reduce((sum, item) => sum + item.dayGain, 0) : null;
  const quoteStatus = hasDemoValues
    ? 'Sample quantities · simulated prices · not real market data'
    : allQuotesAvailable
      ? `Sample quantities · ${liveSources.join(', ') || 'market quotes'}${hasResearchValues ? ' · delayed research quotes · not live' : ''}`
      : quoteCount > 0
        ? `Sample quantities · ${quoteCount} of ${holdings.length} quotes available${hasResearchValues ? ' · delayed research' : ''}`
        : 'Sample quantities · current quotes unavailable';

  return (
    <section className="panel compact-portfolio-card">
      <div className="section-heading">
        <h2>Portfolio</h2>
        <BriefcaseBusiness size={18} />
      </div>
      <div className="portfolio-total">
        <span>Current Value</span>
        <strong>{total === null ? 'Awaiting live quotes' : `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</strong>
        <b className={dayGain === null ? '' : dayGain > 0 ? 'gain' : dayGain < 0 ? 'loss' : 'price-flat'}>
          {dayGain === null ? 'Day move unavailable' : <>{dayGain > 0 ? '+' : dayGain < 0 ? '−' : ''}₹{Math.abs(dayGain).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} today</>}
        </b>
        <small>{quoteStatus}</small>
      </div>
      <div className="compact-list">
        {holdings.map((holding) => {
          const pnlValue = Number(holding.pnl);
          const pnlDirection = !hasChange(holding) ? null : pnlValue > 0 ? 'up' : pnlValue < 0 ? 'down' : 'flat';
          const tickDirection = holding.flash === 'up' || holding.flash === 'down' ? holding.flash : pnlDirection;
          return (
          <div className={`compact-row ${holding.flash ? `flash-${holding.flash}` : ''}`} key={holding.symbol}>
            <div className="compact-holding-info">
              <strong>{holding.symbol}</strong>
              <span>{holding.qty} shares</span>
            </div>
            <div className="align-right compact-holding-metrics">
              <b
                key={holding.flash ? `${holding.symbol}-${holding.flash}` : 'steady'}
                className={`stock-price-value ${hasQuoteValue(holding) ? tickToneClass(tickDirection, holding.flash) : ''}`}
              >
                {!hasQuoteValue(holding) ? 'Quote unavailable' : `₹${Number(holding.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </b>
              <span className={`compact-holding-change ${pnlDirection ? (pnlDirection === 'up' ? 'gain' : pnlDirection === 'down' ? 'loss' : 'price-flat') : ''}`}>
                {!hasChange(holding) ? 'Change unavailable' : <><TickArrow direction={pnlDirection} />{`${holding.isDemo ? 'Demo · ' : holding.isResearch || holding.isStale ? 'Delayed · ' : ''}${pnlValue > 0 ? '+' : ''}${pnlValue.toFixed(2)}%`}</>}
              </span>
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
};

export default Portfolio;
