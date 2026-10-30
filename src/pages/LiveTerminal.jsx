import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Radio,
  Volume2,
  VolumeX,
  TrendingUp,
  TrendingDown,
  Layers,
  BarChart2,
  ShieldAlert,
  SlidersHorizontal,
  Search,
  ShoppingCart,
  Flame,
  CheckCircle,
} from 'lucide-react';
import LiveChart from '../components/LiveChart';
import { stocks as stockSeed } from '../data/stocks';
import { marketApi } from '../services/api';

const formatCurrency = (val) => Number.isFinite(Number(val)) && val !== null
  ? `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';

const createIllustrativeDepth = (symbol, referencePrice) => {
  const price = Number(referencePrice);
  if (!Number.isFinite(price) || price <= 0) return null;

  const seed = [...(symbol || 'STOCK')].reduce((total, char) => total + char.charCodeAt(0), 0);
  const mid = Math.round(price / 0.05) * 0.05;
  const bids = Array.from({ length: 5 }, (_, index) => ({
    price: Number((mid - (index + 1) * 0.05).toFixed(2)),
    quantity: 700 + ((seed + index * 379) % 2500),
    orders: 2 + ((seed + index * 13) % 35),
  }));
  const asks = Array.from({ length: 5 }, (_, index) => ({
    price: Number((mid + (index + 1) * 0.05).toFixed(2)),
    quantity: 700 + ((seed + index * 523 + 97) % 2500),
    orders: 2 + ((seed + index * 17 + 5) % 35),
  }));

  return {
    bids,
    asks,
    totalBidQty: bids.reduce((total, level) => total + level.quantity, 0),
    totalAskQty: asks.reduce((total, level) => total + level.quantity, 0),
    spread: Number((asks[0].price - bids[0].price).toFixed(2)),
  };
};

const createIllustrativeTape = (symbol, referencePrice) => {
  const price = Number(referencePrice);
  if (!Number.isFinite(price) || price <= 0) return [];

  const seed = [...(symbol || 'STOCK')].reduce((total, char) => total + char.charCodeAt(0), 0);
  const mid = Math.round(price / 0.05) * 0.05;
  const offsets = [-3, -2, -1, 0, 1, 0, 2, 1];
  return offsets.map((offset, index) => ({
    id: `sample-${symbol}-${index}`,
    time: 'Sample',
    price: Number((mid + offset * 0.05).toFixed(2)),
    quantity: 1 + ((seed + index * 19) % 90),
    side: index % 2 === 0 ? 'BUY' : 'SELL',
  }));
};

const formatCompact = (val) => {
  if (val >= 1e7) return `${(val / 1e7).toFixed(2)} Cr`;
  if (val >= 1e5) return `${(val / 1e5).toFixed(2)} L`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(1)} K`;
  return String(val);
};

// Web Audio API beep generator
const playTickAudio = (isGain) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGain ? 880 : 440, ctx.currentTime);
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    // Ignore audio permission restrictions
  }
};

const initialIndices = [
  { symbol: 'NIFTY', label: 'NIFTY 50', name: 'Nifty 50 Index' },
  { symbol: 'BSE:SENSEX', label: 'SENSEX', name: 'BSE Sensex' },
  { symbol: 'BANKNIFTY', label: 'BANK NIFTY', name: 'Nifty Bank Index' },
  { symbol: 'NIFTYIT', label: 'NIFTY IT', name: 'Nifty IT Index' },
];

const sectors = [
  { name: 'Banking', sector: 'Banking' },
  { name: 'IT & Software', sector: 'IT' },
  { name: 'Energy & Oil', sector: 'Energy' },
  { name: 'Automobile', sector: 'Auto' },
  { name: 'Metals & Mining', sector: 'Metals' },
  { name: 'Pharma & Health', sector: 'Pharma' },
  { name: 'FMCG', sector: 'FMCG' },
  { name: 'Telecom', sector: 'Telecom' },
];

const LiveTerminal = () => {
  const [stockList, setStockList] = useState(() => stockSeed.map((stock) => ({
    ...stock,
    price: null,
    previousClose: null,
    change: null,
    changePercent: null,
    high: null,
    low: null,
    flash: null,
    lastTick: null,
    isLive: false,
    isDemo: false,
    isStale: false,
  })));
  const [indexList, setIndexList] = useState(() => initialIndices.map((index) => ({ ...index, quote: null })));
  const [selectedSymbol, setSelectedSymbol] = useState('RELIANCE');
  const [streamSpeed, setStreamSpeed] = useState(1000);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [clockTime, setClockTime] = useState(() => new Date());
  const [depthData, setDepthData] = useState(null);
  const [tradeTape, setTradeTape] = useState([]);
  const [tradeTapeIsLive, setTradeTapeIsLive] = useState(false);
  const [tradeTapeSymbol, setTradeTapeSymbol] = useState('');
  const [quickOrderMsg, setQuickOrderMsg] = useState('');
  const [alertTarget, setAlertTarget] = useState('');
  const [alertSuccess, setAlertSuccess] = useState('');

  const selectedStock = useMemo(
    () => stockList.find((s) => s.symbol === selectedSymbol) || stockList[0],
    [stockList, selectedSymbol]
  );
  const selectedSeedPrice = stockSeed.find((stock) => stock.symbol === selectedSymbol)?.price;
  const previewReferencePrice = selectedStock?.price ?? selectedSeedPrice;
  const illustrativeDepth = useMemo(
    () => createIllustrativeDepth(selectedSymbol, previewReferencePrice),
    [selectedSymbol, previewReferencePrice]
  );
  const illustrativeTape = useMemo(
    () => createIllustrativeTape(selectedSymbol, previewReferencePrice),
    [selectedSymbol, previewReferencePrice]
  );
  const hasLiveDepth = depthData?.symbol === selectedSymbol && depthData?.isLive === true && depthData?.isDemo !== true && depthData.bids?.length && depthData.asks?.length;
  const hasLiveTape = tradeTapeIsLive && tradeTapeSymbol === selectedSymbol && tradeTape.length > 0;
  const displayedDepth = hasLiveDepth ? depthData : illustrativeDepth;
  const displayedTape = hasLiveTape ? tradeTape : illustrativeTape;

  // Real-time IST clock
  useEffect(() => {
    const timer = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Provider quotes are preferred; the API marks its no-credential fallback as simulated demo data.
  useEffect(() => {
    if (streamSpeed === 0) return; // Paused

    let active = true;
    let requestPending = false;

    const tickAll = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const requestedSymbols = [...stockSeed.map((stock) => stock.symbol), ...initialIndices.map((index) => index.symbol)];
        const payload = await marketApi.getBatchQuotes(requestedSymbols);
        if (!active) return;
        const quoteMap = new Map(Object.entries(payload?.quotes || {}).map(([symbol, quote]) => [symbol.toUpperCase(), quote]));
        setStockList((current) => current.map((stock) => {
          const quote = quoteMap.get(stock.symbol);
          if (!quote || (quote.isLive !== true && quote.isDemo !== true) || !(Number(quote.c) > 0)) {
            return { ...stock, isLive: false, isDemo: false, isStale: stock.price !== null, flash: null };
          }
          const price = Number(quote.c);
          const direction = stock.price === null || price === stock.price ? stock.lastTick : price > stock.price ? 'up' : 'down';
          if (soundEnabled && stock.symbol === selectedSymbol && stock.price !== null && price !== stock.price) playTickAudio(price > stock.price);
          return {
            ...stock,
            price,
            previousClose: Number(quote.pc) > 0 ? Number(quote.pc) : null,
            change: Number.isFinite(Number(quote.d)) ? Number(quote.d) : null,
            changePercent: Number.isFinite(Number(quote.dp)) ? Number(quote.dp) : null,
            high: Number(quote.h) > 0 ? Number(quote.h) : null,
            low: Number(quote.l) > 0 ? Number(quote.l) : null,
            lastTradeTime: quote.lastTradeTime || quote.timestamp || null,
            isLive: quote.isLive === true && quote.isDemo !== true,
            isDemo: quote.isDemo === true,
            isStale: false,
            dataSource: quote.provider || 'Upstox',
            flash: stock.price === null || price === stock.price ? null : direction,
            lastTick: direction,
          };
        }));
        setIndexList(initialIndices.map((index) => ({ ...index, quote: quoteMap.get(index.symbol.replace(/^BSE:/, '').toUpperCase()) || null })));
      } catch {
        if (active) {
          setStockList((current) => current.map((stock) => ({ ...stock, isLive: false, isStale: stock.price !== null, flash: null })));
          setIndexList((current) => current.map((index) => ({ ...index, quote: null })));
        }
      } finally {
        requestPending = false;
      }
    };

    tickAll();
    const interval = setInterval(tickAll, streamSpeed);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [streamSpeed, soundEnabled, selectedSymbol]);

  // Fetch Level-2 Market Depth & Trade Tape for selected symbol
  useEffect(() => {
    let active = true;

    const fetchDepthAndTape = async () => {
      const [depthResult, tapeResult] = await Promise.allSettled([
        marketApi.getMarketDepth(selectedSymbol),
        marketApi.getRecentTrades(selectedSymbol),
      ]);
      if (!active) return;

      const depth = depthResult.status === 'fulfilled' ? depthResult.value : null;
      setDepthData(depth?.bids?.length && depth?.asks?.length ? depth : null);

      const tape = tapeResult.status === 'fulfilled' ? tapeResult.value : null;
      const trades = Array.isArray(tape?.trades) ? tape.trades : [];
      setTradeTape(trades);
      setTradeTapeIsLive(tape?.isLive === true && tape?.isDemo !== true && trades.length > 0);
      setTradeTapeSymbol(selectedSymbol);
    };

    fetchDepthAndTape();
    const interval = setInterval(fetchDepthAndTape, Math.max(1500, streamSpeed));
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [selectedSymbol, streamSpeed, selectedStock.price]);

  // Market breadth uses only fresh provider quotes.
  const liveStocks = stockList.filter((stock) => (stock.isLive || stock.isDemo) && stock.change !== null);
  const advances = liveStocks.filter((stock) => stock.change >= 0).length;
  const declines = liveStocks.filter((stock) => stock.change < 0).length;
  const advancePercent = liveStocks.length ? Math.round((advances / liveStocks.length) * 100) : 0;

  // Filtered Stock Matrix
  const filteredStocks = stockList.filter((stk) => {
    const matchesSearch =
      stk.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      stk.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (activeFilter === 'BANKING') return stk.sector === 'Banking';
    if (activeFilter === 'IT') return stk.sector === 'IT';
    if (activeFilter === 'GAINERS') return stk.change > 0;
    if (activeFilter === 'LOSERS') return stk.change < 0;
    return true;
  });

  const handleQuickTrade = (side) => {
    setQuickOrderMsg(`Executed ${side} 10 shares of ${selectedStock.symbol} at ${formatCurrency(selectedStock.price)}`);
    setTimeout(() => setQuickOrderMsg(''), 4000);
  };

  const handleSetAlert = (e) => {
    e.preventDefault();
    if (!alertTarget) return;
    setAlertSuccess(`Live price alert set for ${selectedStock.symbol} at ₹${alertTarget}`);
    setAlertTarget('');
    setTimeout(() => setAlertSuccess(''), 4000);
  };

  const isStockGain = selectedStock.change !== null && selectedStock.change >= 0;

  return (
    <div className="page live-terminal-page">
      {/* 1. Terminal Top Control Bar */}
      <section className="terminal-header-bar">
        <div className="terminal-title-group">
          <div className="live-status-pill">
            <span className="live-dot pulse" />
            <Radio size={15} />
            <strong>{selectedStock.isDemo ? 'SIMULATED DEMO · NOT REAL' : selectedStock.isLive ? 'UPSTOX LIVE' : 'UPSTOX TOKEN REQUIRED'}</strong>
          </div>
          <h1>NSE / BSE Live Tracking Terminal</h1>
        </div>

        <div className="terminal-meta-controls">
          <div className="terminal-clock">
            <Clock size={15} />
            <span>{clockTime.toLocaleTimeString('en-IN')} IST</span>
          </div>

          <div className="speed-controller">
            <SlidersHorizontal size={14} />
            <span>Speed:</span>
            <button
              className={streamSpeed === 1500 ? 'active' : ''}
              onClick={() => setStreamSpeed(1500)}
              title="Fast (1.5s)"
            >
              1.5s
            </button>
            <button
              className={streamSpeed === 2500 ? 'active' : ''}
              onClick={() => setStreamSpeed(2500)}
              title="Normal (2.5s)"
            >
              2.5s
            </button>
            <button
              className={streamSpeed === 5000 ? 'active' : ''}
              onClick={() => setStreamSpeed(5000)}
              title="Relaxed (5s)"
            >
              5s
            </button>
            <button
              className={streamSpeed === 0 ? 'active' : ''}
              onClick={() => setStreamSpeed(0)}
              title="Pause Stream"
            >
              Pause
            </button>
          </div>

          <button
            className={`audio-toggle-btn ${soundEnabled ? 'active' : ''}`}
            onClick={() => setSoundEnabled((prev) => !prev)}
            title={soundEnabled ? 'Disable tick audio' : 'Enable tick audio chime'}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{soundEnabled ? 'Chime On' : 'Chime Off'}</span>
          </button>
        </div>
      </section>

      {/* 2. Live Indices Ribbon */}
      <section className="indices-ribbon">
        {indexList.map((idx) => {
          const quote = idx.quote;
          const isUp = Number(quote?.d) >= 0;
          return (
            <div className="ribbon-card" key={idx.symbol}>
              <div className="ribbon-top">
                <strong>{idx.label}</strong>
                <span className={quote ? isUp ? 'gain' : 'loss' : ''}>
                  {quote && (isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />)}
                  {quote && Number.isFinite(Number(quote.dp)) ? `${isUp ? '+' : ''}${quote.dp}%` : '—'}
                </span>
              </div>
              <div className="ribbon-bottom">
                <b>{formatCurrency(quote?.c)}</b>
                <small className={quote ? isUp ? 'gain' : 'loss' : ''}>
                  {quote && Number.isFinite(Number(quote.d)) ? `${isUp ? '+' : ''}${quote.d}` : '—'}
                </small>
                {quote?.isDemo ? <small>DEMO · NOT REAL</small> : null}
              </div>
            </div>
          );
        })}
      </section>

      {/* 3. Market Breadth Bar */}
      <section className="market-breadth-panel">
        <div className="breadth-summary">
          <span>Market Breadth:</span>
          <strong className="gain">Advances: {advances}</strong>
          <strong className="loss">Declines: {declines}</strong>
          <span>Live quotes: {liveStocks.length}/{stockList.length}</span>
        </div>
        <div className="breadth-bar-container">
          <div
            className="breadth-bar-advances"
            style={{ width: `${advancePercent}%` }}
            title={`Advances: ${advancePercent}%`}
          />
          <div
            className="breadth-bar-declines"
            style={{ width: `${100 - advancePercent}%` }}
            title={`Declines: ${100 - advancePercent}%`}
          />
        </div>
      </section>

      {/* Quick Order Notification */}
      {quickOrderMsg && (
        <div className="toast-notification success">
          <CheckCircle size={18} />
          <span>{quickOrderMsg}</span>
        </div>
      )}
      {alertSuccess && (
        <div className="toast-notification info">
          <ShieldAlert size={18} />
          <span>{alertSuccess}</span>
        </div>
      )}

      {/* 4. Terminal Main Grid Layout */}
      <div className="terminal-main-grid">
        {/* Left Column: Active Stock Terminal & Execution */}
        <div className="terminal-left-column">
          {/* Active Stock Hero Card */}
          <section className="panel stock-hero-panel">
            <div className="stock-hero-header">
              <div>
                <span className="badge-sector">{selectedStock.sector}</span>
                <h2>{selectedStock.symbol}</h2>
                <p>{selectedStock.name}</p>
              </div>
              <div className="stock-hero-price-box">
                <span className="hero-price-label">{selectedStock.isDemo ? 'Demo price · not real' : selectedStock.isLive ? 'Upstox price' : 'Connect free Upstox token'}</span>
                <strong className={`hero-price-val ${selectedStock.flash ? `flash-${selectedStock.flash}` : ''}`}>
                  {formatCurrency(selectedStock.price)}
                </strong>
                <span className={`hero-price-change ${selectedStock.change === null ? '' : isStockGain ? 'gain' : 'loss'}`}>
                  {selectedStock.change === null ? '—' : <>{isStockGain ? <TrendingUp size={16} /> : <TrendingDown size={16} />}{isStockGain ? '+' : ''}{selectedStock.change} ({isStockGain ? '+' : ''}{selectedStock.changePercent}%)</>}
                </span>
              </div>
            </div>

            {/* Quick Actions & Price Range */}
            <div className="stock-hero-action-bar">
              <div className="quick-trade-actions">
                <button
                  className="quick-buy-btn"
                  onClick={() => handleQuickTrade('BUY')}
                  disabled={!selectedStock.isLive}
                >
                  <ShoppingCart size={15} /> Buy 10 @ Market
                </button>
                <button
                  className="quick-sell-btn"
                  onClick={() => handleQuickTrade('SELL')}
                  disabled={!selectedStock.isLive}
                >
                  Sell 10 @ Market
                </button>
                <Link to={`/stocks/${selectedStock.symbol}`} className="details-link-btn">
                  Full Details <ArrowUpRight size={14} />
                </Link>
              </div>

              <form onSubmit={handleSetAlert} className="quick-alert-form">
                <input
                  type="number"
                  step="0.05"
                  placeholder="Alert ₹ price..."
                  value={alertTarget}
                  onChange={(e) => setAlertTarget(e.target.value)}
                />
                <button type="submit">Set Alert</button>
              </form>
            </div>

            {/* Day High / Low progress line */}
            <div className="day-range-wrapper">
              <div className="range-labels">
                <span>Low: <b>{formatCurrency(selectedStock.low)}</b></span>
                <span>High: <b>{formatCurrency(selectedStock.high)}</b></span>
              </div>
              <div className="range-bar-track">
                <div
                  className="range-bar-fill"
                  style={{
                    left: '0%',
                    width: selectedStock.price && selectedStock.high && selectedStock.low ? `${Math.min(
                      100,
                      Math.max(
                        5,
                        ((selectedStock.price - selectedStock.low) /
                          Math.max(1, selectedStock.high - selectedStock.low)) *
                          100
                      )
                    )}%` : '0%',
                  }}
                />
              </div>
            </div>
          </section>

          {/* Interactive Live Candlestick & Volume Chart */}
          <section className="terminal-chart-wrapper">
            <LiveChart symbol={selectedStock.symbol} stock={selectedStock} />
          </section>

          {/* Level-2 Order Book & Trade Tape Split */}
          <section className="depth-and-tape-grid">
            {/* Level-2 Market Depth */}
            <div className="panel depth-panel">
              <div className="panel-heading">
                <h3>
                  <Layers size={17} /> Market Depth (Level 2)
                </h3>
                <span className="depth-spread">Spread: {formatCurrency(displayedDepth?.spread)}</span>
              </div>
              <div className={`market-data-note ${hasLiveDepth ? 'is-live' : 'is-sample'}`}>
                {hasLiveDepth ? `${depthData.provider || 'Provider'} live order book` : 'Illustrative sample · not actual exchange orders'}
              </div>

              <div className="depth-tables-container">
                {/* Bids Table */}
                <div className="depth-table bids-table">
                  <div className="depth-table-header">
                    <span>Orders</span>
                    <span>Qty</span>
                    <span>Bid Price</span>
                  </div>
                  {displayedDepth?.bids?.map((bid, i) => {
                    const depthPercent = Math.min(100, Math.round((bid.quantity / 3500) * 100));
                    return (
                      <div className="depth-row bid-row" key={`bid-${i}`}>
                        <div
                          className="depth-fill-bar bid-fill"
                          style={{ width: `${depthPercent}%` }}
                        />
                        <span className="col-orders">{bid.orders}</span>
                        <span className="col-qty">{bid.quantity.toLocaleString('en-IN')}</span>
                        <span className="col-price gain">{formatCurrency(bid.price)}</span>
                      </div>
                    );
                  })}
                  {!displayedDepth?.bids?.length && <p className="chart-empty-state">Order book preview is unavailable without a reference price.</p>}
                  <div className="depth-total-row">
                    <span>Total Bid Qty:</span>
                    <strong className="gain">{displayedDepth?.totalBidQty?.toLocaleString('en-IN') || '—'}</strong>
                  </div>
                </div>

                {/* Asks Table */}
                <div className="depth-table asks-table">
                  <div className="depth-table-header">
                    <span>Ask Price</span>
                    <span>Qty</span>
                    <span>Orders</span>
                  </div>
                  {displayedDepth?.asks?.map((ask, i) => {
                    const depthPercent = Math.min(100, Math.round((ask.quantity / 3500) * 100));
                    return (
                      <div className="depth-row ask-row" key={`ask-${i}`}>
                        <div
                          className="depth-fill-bar ask-fill"
                          style={{ width: `${depthPercent}%` }}
                        />
                        <span className="col-price loss">{formatCurrency(ask.price)}</span>
                        <span className="col-qty">{ask.quantity.toLocaleString('en-IN')}</span>
                        <span className="col-orders">{ask.orders}</span>
                      </div>
                    );
                  })}
                  {!displayedDepth?.asks?.length && <p className="chart-empty-state">Order book preview is unavailable without a reference price.</p>}
                  <div className="depth-total-row">
                    <span>Total Ask Qty:</span>
                    <strong className="loss">{displayedDepth?.totalAskQty?.toLocaleString('en-IN') || '—'}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Time & Sales (Trade Tape) */}
            <div className="panel tape-panel">
              <div className="panel-heading">
                <h3>
                  <Activity size={17} /> Time & Sales (Trade Tape)
                </h3>
                <span className="tape-count">{hasLiveTape ? `${tradeTape.length} ticks` : `${displayedTape.length} sample rows`}</span>
              </div>
              <div className={`market-data-note ${hasLiveTape ? 'is-live' : 'is-sample'}`}>
                {hasLiveTape ? 'Live provider trade prints' : 'Illustrative sample · not actual trades'}
              </div>
              <div className="tape-list">
                <div className="tape-header-row">
                  <span>Time</span>
                  <span>Price</span>
                  <span>Qty</span>
                  <span>Side</span>
                </div>
                <div className="tape-items-scroll">
                  {displayedTape.map((trade) => (
                    <div className={`tape-row side-${trade.side.toLowerCase()}`} key={trade.id}>
                      <span className="tape-time">{trade.time}</span>
                      <span className="tape-price">{formatCurrency(trade.price)}</span>
                      <span className="tape-qty">{trade.quantity}</span>
                      <span className={`tape-side ${trade.side === 'BUY' ? 'gain' : 'loss'}`}>
                        {trade.side}
                      </span>
                    </div>
                  ))}
                  {!displayedTape.length && <p className="chart-empty-state">Trade tape preview is unavailable without a reference price.</p>}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Live Watchlist Matrix & Sector Heatmap */}
        <aside className="terminal-right-column">
          {/* Live Watchlist Matrix */}
          <section className="panel live-watchlist-matrix">
            <div className="watchlist-matrix-header">
              <h3>
                <BarChart2 size={17} /> Live Stock Matrix
              </h3>
              <div className="search-box">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Filter stock..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Category tabs */}
            <div className="watchlist-filter-tabs">
              {['ALL', 'GAINERS', 'LOSERS', 'BANKING', 'IT'].map((filter) => (
                <button
                  key={filter}
                  className={activeFilter === filter ? 'active' : ''}
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Stock list rows */}
            <div className="matrix-stock-rows">
              {filteredStocks.map((stk) => {
                const isGain = stk.change !== null && stk.change >= 0;
                const isSelected = stk.symbol === selectedSymbol;
                const flashClass = stk.flash === 'up' ? 'flash-up' : stk.flash === 'down' ? 'flash-down' : '';

                return (
                  <div
                    key={stk.symbol}
                    className={`matrix-row ${isSelected ? 'selected' : ''} ${flashClass}`}
                    onClick={() => setSelectedSymbol(stk.symbol)}
                  >
                    <div className="matrix-col-symbol">
                      <strong>{stk.symbol}</strong>
                      <span>{stk.name}</span>
                    </div>
                    <div className="matrix-col-price">
                      <b className={stk.isLive || stk.isDemo ? isGain ? 'gain' : 'loss' : ''}>
                        {formatCurrency(stk.price)}
                      </b>
                      <span className={stk.isLive || stk.isDemo ? isGain ? 'gain' : 'loss' : ''}>
                        {stk.isDemo ? 'Demo · simulated' : stk.isLive && stk.change !== null ? `${isGain ? '+' : ''}${stk.change} (${isGain ? '+' : ''}${stk.changePercent}%)` : 'Connect free Upstox token'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sector Momentum Heatmap */}
          <section className="panel sector-heatmap-panel">
            <div className="panel-heading">
              <h3>
                <Flame size={17} /> Tracked Sector Moves
              </h3>
            </div>
            <div className="sector-tiles-grid">
              {sectors.map((sec) => {
                const members = stockList.filter((stock) => stock.sector === sec.sector && (stock.isLive || stock.isDemo) && stock.changePercent !== null);
                const sectorChange = members.length
                  ? Number((members.reduce((total, stock) => total + stock.changePercent, 0) / members.length).toFixed(2))
                  : null;
                const isUp = sectorChange !== null && sectorChange >= 0;
                return (
                  <div
                    key={sec.name}
                    className={`sector-tile ${sectorChange === null ? '' : isUp ? 'tile-gain' : 'tile-loss'}`}
                  >
                    <div className="sector-tile-top">
                      <strong>{sec.name}</strong>
                      <span className={sectorChange === null ? '' : isUp ? 'gain' : 'loss'}>
                        {sectorChange === null ? '—' : `${isUp ? '+' : ''}${sectorChange}%`}
                      </span>
                    </div>
                    <small>{members.length} {members.some((stock) => stock.isDemo) ? 'demo tracked' : 'live tracked'} {members.length === 1 ? 'stock' : 'stocks'}</small>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default LiveTerminal;
