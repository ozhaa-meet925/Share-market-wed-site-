import { Link } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  ArrowUpRight,
  Radio,
  Layers,
  Flame,
  Globe,
  Landmark,
} from 'lucide-react';
import MarketCard from '../components/MarketCard';
import { indices, nifty } from '../data/nifty';
import { sectors as sectorSeed, stocks as stockSeed } from '../data/stocks';
import { useMarketIndices } from '../hooks/useMarketIndices';
import { useLiveStocks } from '../hooks/useLiveStocks';

const flowChartPreview = [
  { label: 'Day 1', fii: 28, dii: 46 },
  { label: 'Day 2', fii: -38, dii: 24 },
  { label: 'Day 3', fii: -22, dii: 40 },
  { label: 'Day 4', fii: 46, dii: -30 },
  { label: 'Day 5', fii: 31, dii: 38 },
];

const marketIndexSymbols = [
  ...indices.map((index) => index.symbol).filter(Boolean),
  'GLOBAL:USDINR', 'GLOBAL:BZUSD', 'GLOBAL:SGX NIFTY',
];

const formatCuePrice = (quote, currency = '₹') => Number(quote?.c) > 0
  ? `${currency}${Number(quote.c).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : 'Quote unavailable';

const formatCueTime = (value) => {
  if (!value) return '';
  const date = typeof value === 'number' || /^\d+$/.test(String(value))
    ? new Date(Number(value) < 1e12 ? Number(value) * 1000 : Number(value))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-IN');
};

const Markets = () => {
  const { quotes, histories, lastUpdated } = useMarketIndices(marketIndexSymbols);
  const { stocks: trackedStocks } = useLiveStocks(stockSeed);
  return (
    <div className="page markets-page">
    <div className="page-title markets-header-title">
      <div>
        <span>Indian Capital Markets</span>
        <h1>NSE & BSE Market Intelligence</h1>
      </div>
      <div className="markets-header-actions">
        <Link to="/live" className="primary-button">
          <Radio size={15} /> Open Live Terminal
        </Link>
        <Link to="/top-gainers" className="secondary-button">
          Top Gainers
        </Link>
        <Link to="/top-losers" className="secondary-button">
          Top Losers
        </Link>
      </div>
    </div>

    {/* Indices Strip */}
    <section className="market-strip">
      <MarketCard
        name={nifty.name}
        quote={quotes.get('NIFTY')}
        history={histories.get('NIFTY')}
        lastUpdated={lastUpdated}
      />
      {indices.slice(1).map((index) => (
        <MarketCard
          key={index.name}
          name={index.name}
          quote={index.symbol ? quotes.get(index.symbol) : null}
          history={index.symbol ? histories.get(index.symbol) : []}
          lastUpdated={lastUpdated}
        />
      ))}
    </section>

    {/* FII / DII Institutional Flow & Market Breadth Split */}
    <div className="markets-split-grid">
      {/* FII / DII Institutional Activity */}
      <section className="panel fii-dii-panel">
        <div className="section-heading">
          <h3>
            <Landmark size={18} /> Institutional Cash Inflow (FII & DII)
          </h3>
          <span>Daily Net Buy / Sell Cash Market Turnover</span>
        </div>
        <div className="fii-dii-cards-list">
          <div className="flow-data-status">Illustrative preview · not live data</div>
          <div className="flow-preview-intro">
            <strong>Example net-buy / net-sell pattern</strong>
            <span>Bar heights are illustrative and do not represent market figures.</span>
          </div>
          <div
            className="flow-chart-plot"
            role="img"
            aria-label="Illustrative FII and DII flow pattern. Bars are samples, not market data."
          >
            <div className="flow-zero-line" aria-hidden="true" />
            {flowChartPreview.map((session) => (
              <div className="flow-session" key={session.label}>
                <div className="flow-session-bars" aria-hidden="true">
                  <span
                    className={`flow-bar flow-bar-fii ${session.fii >= 0 ? 'positive' : 'negative'}`}
                    style={{ height: `${Math.abs(session.fii)}%` }}
                  />
                  <span
                    className={`flow-bar flow-bar-dii ${session.dii >= 0 ? 'positive' : 'negative'}`}
                    style={{ height: `${Math.abs(session.dii)}%` }}
                  />
                </div>
                <span className="flow-session-label">{session.label}</span>
              </div>
            ))}
          </div>
          <div className="flow-preview-legend" aria-label="Chart legend">
            <span><i className="flow-legend-fii" />FII sample</span>
            <span><i className="flow-legend-dii" />DII sample</span>
            <span><i className="flow-legend-zero" />Zero line · net sell below</span>
          </div>
          <p className="flow-source-note">
            The configured quote feed does not provide verified daily FII/DII cash-flow totals.
          </p>
        </div>
      </section>

      {/* Global & Currency Cues */}
      <section className="panel global-cues-panel">
        <div className="section-heading">
          <h3>
            <Globe size={18} /> Global & Currency Cues
          </h3>
          <span>Key Macros & Commodities</span>
        </div>
        <div className="global-cues-grid">
          {[
            { label: 'USD / INR', symbol: 'USDINR', currency: '₹', unit: 'per USD' },
            { label: 'Brent Crude', symbol: 'BZUSD', currency: '$', unit: 'per barrel' },
            { label: 'India 10Y Yield', symbol: null, currency: '', unit: 'Not in quote feed' },
            { label: 'GIFT Nifty', symbol: 'SGX NIFTY', currency: '', unit: 'index points' },
          ].map((cue) => {
            const quote = cue.symbol ? quotes.get(cue.symbol) : null;
            const isLive = quote?.isLive === true && Number(quote.c) > 0;
            const isDemo = quote?.isDemo === true && Number(quote.c) > 0;
            const isResearch = quote?.isResearch === true && Number(quote.c) > 0;
            const positive = Number(quote?.d) >= 0;
            return (
              <div className="cue-card" key={cue.label}>
                <span className="cue-title">{cue.label}</span>
                <b>{cue.symbol ? formatCuePrice(quote, cue.currency) : 'Quote unavailable'}</b>
                <small className={isLive || isDemo || isResearch ? positive ? 'gain' : 'loss' : ''}>
                  {(isLive || isDemo || isResearch) && quote.dp !== null ? `${isDemo ? 'Demo ' : ''}${isResearch ? 'Research ' : ''}${positive ? '+' : ''}${Number(quote.dp).toFixed(2)}% · ` : ''}{cue.unit}
                </small>
                <small>{isDemo ? 'Simulated demo feed · not real' : isResearch ? `Yahoo Finance via yfinance · research only · ${formatCueTime(quote.timestamp)}` : isLive ? `${quote.provider || 'Market provider'} · ${formatCueTime(quote.timestamp)}` : 'Connect a live market provider'}</small>
              </div>
            );
          })}
        </div>
      </section>
    </div>

    {/* Sector Performance Matrix */}
    <section className="panel sector-performance-panel">
      <div className="section-heading">
        <div>
          <h3>
            <Flame size={18} /> Comprehensive Sector Performance
          </h3>
        <span>Average daily move from available tracked stock quotes</span>
        </div>
        <Link to="/stocks" className="view-stocks-link">
          Explore All Stocks <ArrowUpRight size={14} />
        </Link>
      </div>

      <div className="sector-matrix-list">
        {sectorSeed.map((sector) => {
          const members = trackedStocks.filter((stock) => stock.sector === sector.name && (stock.isLive || stock.isDemo) && stock.changePercent !== null);
          const sectorChange = members.length
            ? Number((members.reduce((sum, stock) => sum + Number(stock.changePercent), 0) / members.length).toFixed(2))
            : null;
          const isUp = sectorChange !== null && sectorChange >= 0;
          return (
            <div className="sector-matrix-row" key={sector.name}>
              <div className="sec-meta">
                <strong>{sector.name}</strong>
                <span>{members.length} {members.some((stock) => stock.isDemo) ? 'demo tracked' : 'live tracked'} {members.length === 1 ? 'stock' : 'stocks'}</span>
              </div>
              <div className="sec-track">{sectorChange !== null && <div className={`sec-bar ${isUp ? 'bar-gain' : 'bar-loss'}`} style={{ width: `${Math.min(100, Math.abs(sectorChange) * 25 + 15)}%` }} />}</div>
              <b className={sectorChange === null ? '' : isUp ? 'gain' : 'loss'}>{sectorChange === null ? '—' : `${isUp ? '+' : ''}${sectorChange}%`}</b>
            </div>
          );
        })}
      </div>
    </section>
    </div>
  );
};

export default Markets;
