import { Activity, ArrowUpRight, Clock3, Info, Layers3, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import GoldCard from '../components/GoldCard';
import SilverCard from '../components/SilverCard';
import MarketCard from '../components/MarketCard';
import { useMarketIndices } from '../hooks/useMarketIndices';

const commodityContracts = [
  { symbol: 'CRUDEOIL', name: 'Crude Oil', unit: '₹/bbl' },
  { symbol: 'NATURALGAS', name: 'Natural Gas', unit: '₹/MMBtu' },
  { symbol: 'COPPER', name: 'Copper', unit: '₹/kg' },
  { symbol: 'ALUMINIUM', name: 'Aluminium', unit: '₹/kg' },
  { symbol: 'ZINC', name: 'Zinc', unit: '₹/kg' },
];

const Commodities = () => {
  const { quotes, histories, lastUpdated } = useMarketIndices([
    'MCX:GOLD', 'MCX:SILVER', ...commodityContracts.map((item) => `MCX:${item.symbol}`),
  ]);
  const allSymbols = ['GOLD', 'SILVER', ...commodityContracts.map((item) => item.symbol)];
  const pricedQuotes = allSymbols
    .map((symbol) => quotes.get(symbol))
    .filter((quote) => Number(quote?.c) > 0);
  const unavailableContracts = commodityContracts.filter((item) => !quotes.has(item.symbol));
  const staleCount = pricedQuotes.filter((quote) => quote.isStale === true).length;
  const liveCount = pricedQuotes.filter((quote) => quote.isLive === true && quote.isDemo !== true).length;
  const referenceCount = pricedQuotes.filter((quote) => ['spot', 'benchmark'].includes(quote.marketType)).length;
  const hasDemoQuotes = pricedQuotes.some((quote) => quote.isDemo === true);
  const hasSpotQuotes = pricedQuotes.some((quote) => quote.marketType === 'spot');
  const hasMcxQuotes = pricedQuotes.some((quote) => quote.isLive === true && quote.marketType !== 'spot');
  const hasBenchmarkQuotes = pricedQuotes.some((quote) => quote.marketType === 'benchmark');
  const checkedTime = lastUpdated?.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const sourceLabel = hasDemoQuotes
    ? 'Simulated demo feed · not real market data'
    : [
      hasMcxQuotes ? 'Upstox MCX futures' : null,
      hasBenchmarkQuotes ? 'Delayed global benchmarks' : null,
      hasSpotQuotes ? 'International spot references' : null,
    ].filter(Boolean).join(' · ') || 'Waiting for commodity price feeds';

  return (
    <div className="page commodities-page">
      <header className="commodity-hero">
        <div className="commodity-hero-copy">
          <span className="commodity-eyebrow"><Sparkles size={14} /> INDIA MARKET WATCH</span>
          <h1>Commodities</h1>
          <p>Prices, market references and quote updates in one clear view.</p>
        </div>
        <div className="commodity-live-status" aria-live="polite">
          <span className={`commodity-live-dot ${pricedQuotes.length ? 'is-active' : ''}`} />
          <span>{pricedQuotes.length ? 'Price feed connected' : 'Connecting to price feeds'}</span>
          <small>{checkedTime ? `Checked ${checkedTime}` : 'Waiting for first update'}</small>
        </div>
      </header>

      <section className="commodity-overview" aria-label="Commodity quote summary">
        <div className="commodity-overview-item">
          <span className="commodity-overview-icon"><Layers3 size={16} /></span>
          <span><strong>{pricedQuotes.length}<small> / {allSymbols.length}</small></strong><em>quotes available</em></span>
        </div>
        <div className="commodity-overview-item">
          <span className="commodity-overview-icon is-green"><Activity size={16} /></span>
          <span><strong>{liveCount}</strong><em>live exchange quotes</em></span>
        </div>
        <div className="commodity-overview-item">
          <span className="commodity-overview-icon is-blue"><Clock3 size={16} /></span>
          <span><strong>{referenceCount}</strong><em>spot or benchmark references</em></span>
        </div>
        <div className="commodity-overview-source">
          <span>DATA SOURCES</span>
          <strong>{sourceLabel}</strong>
        </div>
      </section>

      {staleCount > 0 && (
        <div className="commodity-stale-note" role="status">
          <Info size={17} />
          <span><strong>{staleCount} quote{staleCount === 1 ? '' : 's'} may be stale.</strong> The last available price is kept visible with its quote time.</span>
        </div>
      )}

      <section className="commodity-section" aria-labelledby="precious-metals-heading">
        <div className="commodity-section-heading">
          <div>
            <span className="commodity-section-kicker">PRECIOUS METALS</span>
            <h2 id="precious-metals-heading">Gold &amp; Silver</h2>
          </div>
          <span className="commodity-section-count">2 instruments</span>
        </div>
        <div className="commodity-grid">
          <GoldCard quote={quotes.get('GOLD')} />
          <SilverCard quote={quotes.get('SILVER')} />
        </div>
      </section>

      <section className="commodity-section commodity-section-markets" aria-labelledby="energy-metals-heading">
        <div className="commodity-section-heading">
          <div>
            <span className="commodity-section-kicker">ENERGY &amp; INDUSTRIAL METALS</span>
            <h2 id="energy-metals-heading">Market quotes</h2>
          </div>
          <span className="commodity-section-count">{commodityContracts.length} instruments</span>
        </div>
        <div className="market-strip commodity-market-grid">
          {commodityContracts.map((item) => (
            <MarketCard
              key={item.symbol}
              name={`${item.name} · ${item.unit}`}
              quote={quotes.get(item.symbol)}
              history={histories.get(item.symbol) || []}
              lastUpdated={lastUpdated}
            />
          ))}
        </div>
      </section>

      <aside className="commodity-source-panel">
        <span className="commodity-source-icon"><Info size={18} /></span>
        <div className="commodity-source-copy">
          <strong>About these prices</strong>
          <p>
            {hasSpotQuotes && 'Gold, Silver and Copper may use international spot references when MCX quotes are unavailable. '}
            {hasBenchmarkQuotes && 'Crude Oil, Natural Gas, Aluminium and Zinc may use delayed global futures converted to INR; these are not local MCX contracts or retail rates. '}
            {unavailableContracts.length > 0 && `No quote is available for ${unavailableContracts.map((item) => item.name).join(', ')} yet. `}
            {hasDemoQuotes && 'Cards marked Demo show simulated values, not real market prices. '}
            {staleCount > 0 && 'A stale label means the card is showing its last available quote.'}
            {!hasSpotQuotes && !hasBenchmarkQuotes && unavailableContracts.length === 0 && !hasDemoQuotes && 'Exchange quotes depend on your connected provider and its market access.'}
          </p>
        </div>
        <div className="commodity-detail-links">
          <Link to="/gold">Gold details <ArrowUpRight size={14} /></Link>
          <Link to="/silver">Silver details <ArrowUpRight size={14} /></Link>
        </div>
      </aside>
    </div>
  );
};

export default Commodities;
