import { BriefcaseBusiness } from 'lucide-react';

const Portfolio = ({ holdings }) => {
  const hasQuoteValue = (item) => (item.isLive || item.isDemo)
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
  const total = allQuotesAvailable ? holdings.reduce((sum, item) => sum + item.value, 0) : null;
  const allChangesAvailable = allQuotesAvailable && holdings.every(hasDayGain);
  const dayGain = allChangesAvailable ? holdings.reduce((sum, item) => sum + item.dayGain, 0) : null;
  const quoteStatus = hasDemoValues
    ? 'Sample quantities · simulated prices · not real market data'
    : allQuotesAvailable
      ? `Sample quantities · ${liveSources.join(', ') || 'Current market quotes'}`
      : quoteCount > 0
        ? `Sample quantities · ${quoteCount} of ${holdings.length} current quotes available`
        : 'Sample quantities · current quotes unavailable';

  return (
    <section className="panel compact-portfolio-card">
      <div className="section-heading">
        <h2>Portfolio</h2>
        <BriefcaseBusiness size={18} />
      </div>
      <div className="portfolio-total">
        <span>Current Value</span>
        <strong>{total === null ? 'Awaiting live quotes' : `₹${total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}</strong>
        <b className={dayGain === null ? '' : dayGain >= 0 ? 'gain' : 'loss'}>
          {dayGain === null ? 'Day move unavailable' : `${dayGain >= 0 ? '+' : ''}₹${dayGain.toLocaleString('en-IN', { maximumFractionDigits: 2 })} today`}
        </b>
        <small>{quoteStatus}</small>
      </div>
      <div className="compact-list">
        {holdings.map((holding) => (
          <div className={`compact-row ${holding.flash ? `flash-${holding.flash}` : ''}`} key={holding.symbol}>
            <div className="compact-holding-info">
              <strong>{holding.symbol}</strong>
              <span>{holding.qty} shares</span>
            </div>
            <div className="align-right compact-holding-metrics">
              <b className={`stock-price-value ${holding.flash ? `price-flash-${holding.flash}` : ''}`}>
                {!hasQuoteValue(holding) ? 'Quote unavailable' : `₹${Number(holding.value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
              </b>
              <span className={`compact-holding-change ${!hasChange(holding) ? '' : Number(holding.pnl) >= 0 ? 'gain' : 'loss'}`}>
                {!hasChange(holding) ? 'Change unavailable' : `${holding.isDemo ? 'Demo · ' : ''}${Number(holding.pnl) >= 0 ? '+' : ''}${Number(holding.pnl)}%`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default Portfolio;
