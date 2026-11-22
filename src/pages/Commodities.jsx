import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowUpRight, Box, Cable, Clock3, Droplets, Flame, Gem, Hexagon, Info, Layers3, Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import GoldCard from '../components/GoldCard';
import SilverCard from '../components/SilverCard';
import MarketCard from '../components/MarketCard';
import LiveChart from '../components/LiveChart';
import PriceAlertForm from '../components/PriceAlertForm';
import { useMarketIndices } from '../hooks/useMarketIndices';

const commodityContracts = [
  { symbol: 'CRUDEOIL', name: 'Crude Oil', unit: '₹/bbl' },
  { symbol: 'NATURALGAS', name: 'Natural Gas', unit: '₹/MMBtu' },
  { symbol: 'COPPER', name: 'Copper', unit: '₹/kg' },
  { symbol: 'ALUMINIUM', name: 'Aluminium', unit: '₹/kg' },
  { symbol: 'ZINC', name: 'Zinc', unit: '₹/kg' },
];

const chartInstruments = [
  { symbol: 'GOLD', name: 'Gold', label: 'Gold', assetType: 'commodity', icon: Gem },
  { symbol: 'SILVER', name: 'Silver', label: 'Silver', assetType: 'silver', icon: Hexagon },
  { symbol: 'CRUDEOIL', name: 'Crude Oil', label: 'Crude Oil · ₹/bbl', assetType: 'commodity-contract', unit: '₹/bbl', icon: Droplets },
  { symbol: 'NATURALGAS', name: 'Natural Gas', label: 'Natural Gas · ₹/MMBtu', assetType: 'commodity-contract', unit: '₹/MMBtu', icon: Flame },
  { symbol: 'COPPER', name: 'Copper', label: 'Copper · ₹/kg', assetType: 'commodity-contract', unit: '₹/kg', icon: Cable },
  { symbol: 'ALUMINIUM', name: 'Aluminium', label: 'Aluminium · ₹/kg', assetType: 'commodity-contract', unit: '₹/kg', icon: Layers3 },
  { symbol: 'ZINC', name: 'Zinc', label: 'Zinc · ₹/kg', assetType: 'commodity-contract', unit: '₹/kg', icon: Box },
];

const formatTabPrice = (value) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const Commodities = () => {
  const { quotes, histories, historyMeta, lastUpdated, retryHistory } = useMarketIndices([
    'MCX:GOLD', 'MCX:SILVER', ...commodityContracts.map((item) => `MCX:${item.symbol}`),
  ]);
  const [chartSymbol, setChartSymbol] = useState('GOLD');
  const [alertMetal, setAlertMetal] = useState('GOLD');
  const chartSectionRef = useRef(null);
  const chartTabsRef = useRef(null);

  useEffect(() => {
    const strip = chartTabsRef.current;
    const active = strip?.querySelector('button.active');
    if (!strip || !active) return;
    strip.scrollTo({
      left: Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2),
      behavior: 'smooth',
    });
  }, [chartSymbol]);
  const selectedChart = chartInstruments.find((item) => item.symbol === chartSymbol) || chartInstruments[0];
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

  const openChart = (symbol) => {
    setChartSymbol(symbol);
    window.requestAnimationFrame(() => {
      chartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

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

      <section ref={chartSectionRef} className="commodity-section commodity-chart-section" aria-labelledby="commodity-chart-heading">
        <div className="commodity-section-heading">
          <div>
            <span className="commodity-section-kicker">PRICE ACTION</span>
            <h2 id="commodity-chart-heading">Commodity charts</h2>
          </div>
          <span className="commodity-section-count">7 instruments · 1D to ALL</span>
        </div>
        <div className="commodity-chart-shell">
          <div ref={chartTabsRef} className="commodity-chart-tabs" role="tablist" aria-label="Choose commodity chart">
            {chartInstruments.map((item) => {
              const Icon = item.icon;
              const quote = quotes.get(item.symbol);
              const hasQuote = Number(quote?.c) > 0;
              return (
                <button
                  key={item.symbol}
                  type="button"
                  role="tab"
                  aria-selected={chartSymbol === item.symbol}
                  aria-label={hasQuote ? `${item.name}, ${formatTabPrice(quote.c)} rupees` : item.name}
                  className={chartSymbol === item.symbol ? 'active' : ''}
                  onClick={() => setChartSymbol(item.symbol)}
                >
                  <span className="commodity-chart-tab-icon"><Icon size={15} /></span>
                  <span className="commodity-chart-tab-copy">
                    <strong>{item.name}</strong>
                    <small>{hasQuote ? `₹${formatTabPrice(quote.c)}` : 'No quote'}</small>
                  </span>
                </button>
              );
            })}
          </div>
          <LiveChart
            key={selectedChart.symbol}
            stock={{ symbol: selectedChart.symbol, name: selectedChart.label }}
            assetType={selectedChart.assetType}
            unit={selectedChart.unit}
          />
        </div>
      </section>

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
        <div className="commodity-metal-alert">
          <div className="commodity-metal-alert-tabs" role="tablist" aria-label="Choose metal for price alert">
            {['GOLD', 'SILVER'].map((symbol) => (
              <button
                key={symbol}
                type="button"
                role="tab"
                aria-selected={alertMetal === symbol}
                className={alertMetal === symbol ? 'active' : ''}
                onClick={() => setAlertMetal(symbol)}
              >
                {symbol === 'GOLD' ? 'Gold alert' : 'Silver alert'}
              </button>
            ))}
          </div>
          <PriceAlertForm
            key={alertMetal}
            stock={{ symbol: alertMetal, price: Number(quotes.get(alertMetal)?.c) || null }}
          />
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
          {commodityContracts.map((item) => {
            const meta = historyMeta.get(item.symbol);
            return (
              <MarketCard
                key={item.symbol}
                name={`${item.name} · ${item.unit}`}
                quote={quotes.get(item.symbol)}
                history={histories.get(item.symbol) || []}
                historyStatus={meta?.status || 'loading'}
                historyError={meta?.error || ''}
                historyProvider={meta?.provider || ''}
                historyIsResearch={meta?.isResearch === true}
                onRetryHistory={retryHistory}
                onOpenChart={() => openChart(item.symbol)}
                lastUpdated={lastUpdated}
              />
            );
          })}
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
