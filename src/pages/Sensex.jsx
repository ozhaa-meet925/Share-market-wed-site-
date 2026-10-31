import { Link } from 'react-router-dom';
import { Activity, ArrowDownRight, ArrowUpRight, Clock } from 'lucide-react';
import Chart from '../components/Chart';
import StockCard from '../components/StockCard';
import { stocks as stockSeed } from '../data/stocks';
import { useLiveStocks } from '../hooks/useLiveStocks';
import { useMarketIndices } from '../hooks/useMarketIndices';

const sensexContributors = ['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ICICIBANK'];
const formatNumber = (value) => value !== null && value !== undefined && Number.isFinite(Number(value))
  ? Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : 'Unavailable';

const Sensex = () => {
  const { stocks } = useLiveStocks(stockSeed);
  const { quotes, histories, lastUpdated } = useMarketIndices(['BSE:SENSEX']);
  const quote = quotes.get('SENSEX');
  const hasQuote = Number(quote?.c) > 0;
  const isLive = quote?.isLive === true && hasQuote;
  const isDemo = quote?.isDemo === true && hasQuote;
  const isResearch = quote?.isResearch === true && hasQuote;
  const history = histories.get('SENSEX') || [];
  const contributors = stocks.filter((stock) => sensexContributors.includes(stock.symbol) && (stock.isLive || stock.isDemo));
  const tracked = stocks.filter((stock) => (stock.isLive || stock.isDemo) && stock.changePercent !== null);
  const advances = tracked.filter((stock) => Number(stock.changePercent) >= 0).length;
  const declines = tracked.length - advances;
  const advancePercent = tracked.length ? Math.round((advances / tracked.length) * 100) : 0;
  const change = quote?.d !== null && quote?.d !== undefined ? Number(quote.d) : null;
  const changePercent = quote?.dp !== null && quote?.dp !== undefined ? Number(quote.dp) : null;
  const positive = change !== null && change >= 0;
  const low = Number(quote?.l) > 0 ? Number(quote.l) : null;
  const high = Number(quote?.h) > 0 ? Number(quote.h) : null;
  const spread = high !== null && low !== null ? high - low : 0;
  const rangeProgress = spread > 0 ? Math.min(100, Math.max(0, ((Number(quote.c) - low) / spread) * 100)) : 0;

  return (
    <div className="page">
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span>Benchmark Index</span>
            <span className={`live-status-pill ${isLive ? '' : 'neutral-pill'}`}><span className="live-dot" /> {isDemo ? 'SIMULATED DEMO · NOT REAL' : isLive ? `${quote.provider || 'LIVE PROVIDER'} LIVE QUOTE`.toUpperCase() : isResearch ? `RESEARCH QUOTE · ${quote.isStale ? 'STALE' : 'NOT LIVE'}` : quote?.isStale ? 'LAST QUOTE · STALE' : 'QUOTE UNAVAILABLE'}</span>
            <span className="pill neutral-pill">BSE</span>
          </div>
          <h1>SENSEX</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="live-updated"><Clock size={14} /> {lastUpdated ? `${isResearch ? 'Research data received' : 'Received'} ${lastUpdated.toLocaleTimeString('en-IN')}` : 'Live quote required'}</div>
          <Link to="/nifty" className="secondary-button" style={{ fontSize: '0.82rem', padding: '6px 12px', minHeight: 'auto' }}>← View NIFTY 50</Link>
        </div>
      </div>

      <section className="details-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="panel detail-panel">
            <div className="quote-line">
              <div>
                <span>{isDemo ? 'Simulated demo value · not real' : isResearch ? `Research value · not live · ${quote.provider || 'Yahoo Finance'}` : isLive ? `Current value · ${quote.provider || 'Live provider'}` : 'Current value · live provider required'}</span>
                <h2>{hasQuote ? `₹${formatNumber(quote.c)}` : 'Quote unavailable'}</h2>
                <span>{isDemo ? 'Demo value only · not for trading' : isResearch ? `Research quote · not live${quote.isStale ? ' · stale' : ''}` : isLive ? 'Latest provider quote' : quote?.isStale ? 'Last provider quote; refresh failed' : 'Live quote required'}</span>
              </div>
              <div className="align-right">
                {change !== null && changePercent !== null ? (
                  <strong className={positive ? 'gain' : 'loss'}>
                    {positive ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                    {positive ? '+' : ''}{formatNumber(change)} ({positive ? '+' : ''}{changePercent.toFixed(2)}%)
                  </strong>
                ) : <strong>Change unavailable</strong>}
                <span>Latest provider snapshot</span>
              </div>
            </div>

            <div style={{ margin: '14px 0 10px' }}>
              <div className="section-heading"><strong>Session price snapshots</strong><span>Collected from available provider quotes</span></div>
              {history.length > 1 ? <Chart data={history} positive={positive} height={250} showXAxis /> : <div className="chart-empty-state">Chart will appear after multiple provider quotes are available.</div>}
            </div>

            <div className="day-range-wrapper" style={{ margin: '14px 0' }}>
              <div className="range-labels">
                <span>Low: <b>{low === null ? 'Unavailable' : `₹${formatNumber(low)}`}</b></span>
                <span>Day's range</span>
                <span>High: <b>{high === null ? 'Unavailable' : `₹${formatNumber(high)}`}</b></span>
              </div>
              <div className="range-bar-track"><div className="range-bar-fill" style={{ width: `${rangeProgress}%` }} /></div>
            </div>

            <div className="split-stats">
              <span>Open <b>{formatNumber(quote?.o)}</b></span>
              <span>High <b>{formatNumber(quote?.h)}</b></span>
              <span>Low <b>{formatNumber(quote?.l)}</b></span>
              <span>Prev close <b>{formatNumber(quote?.pc)}</b></span>
              <span>52W high <b>Unavailable</b></span>
              <span>52W low <b>Unavailable</b></span>
            </div>
          </div>

          <div className="panel market-breadth-panel">
            <div className="section-heading"><h3><Activity size={18} /> SENSEX tracked-stock breadth</h3><span>Calculated from current live provider quotes</span></div>
            {tracked.length ? (
              <>
                <div className="breadth-summary">
                  <strong className="gain"><ArrowUpRight size={16} /> Advances: {advances} ({advancePercent}%)</strong>
                  <strong className="loss"><ArrowDownRight size={16} /> Declines: {declines} ({100 - advancePercent}%)</strong>
                  <span>Quoted stocks: {tracked.length}/{stockSeed.length}</span>
                </div>
                <div className="breadth-bar-container"><div className="breadth-bar-advances" style={{ width: `${advancePercent}%` }} /><div className="breadth-bar-declines" style={{ width: `${100 - advancePercent}%` }} /></div>
              </>
            ) : <p>Market breadth appears after live provider quotes are available.</p>}
          </div>
        </div>

        <div className="side-stack">
          <div className="section-heading"><div><h3>Tracked contributors</h3><span>Only live provider priced shares</span></div></div>
          <div className="stock-grid one-column">
            {contributors.length ? contributors.map((stock) => <StockCard key={stock.symbol} stock={stock} />) : <div className="panel">Contributor quotes unavailable.</div>}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Sensex;
