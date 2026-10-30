import { Activity, TrendingDown, TrendingUp } from 'lucide-react';

const buildIllustrativeCandles = (symbol) => {
  const seed = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 0);
  let previous = 100;

  return Array.from({ length: 20 }, (_, index) => {
    const open = previous;
    const close = 100 + Math.sin(seed * 0.07 + index * 0.72) * 4.2 + Math.sin(index * 0.2) * 1.8;
    const wick = 0.7 + ((seed + index * 7) % 5) * 0.22;
    previous = close;
    return { open, close, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick };
  });
};

const buildSnapshotCandles = (history) => {
  const prices = history.map(Number).filter((price) => Number.isFinite(price) && price > 0).slice(-60);
  // Use quote snapshots only when there are enough points to form a full,
  // evenly spaced chart. Until then, show the clearly labelled preview below.
  if (prices.length < 60) return [];
  const candleCount = 20;
  const bucketSize = Math.ceil(prices.length / candleCount);

  return Array.from({ length: candleCount }, (_, index) => {
    const samples = prices.slice(index * bucketSize, (index + 1) * bucketSize);
    const open = samples[0];
    const close = samples[samples.length - 1];
    return { open, close, high: Math.max(...samples), low: Math.min(...samples) };
  }).filter((candle) => Number.isFinite(candle.open) && Number.isFinite(candle.close));
};

const MiniCandlestickChart = ({ candles, label }) => {
  const width = 320;
  const height = 132;
  const padding = { top: 7, right: 4, bottom: 5, left: 4 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = candles.flatMap(({ high, low }) => [high, low]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = Math.max(high - low, Math.abs((high + low) / 2) * 0.001, 0.1);
  const min = low - spread * 0.08;
  const max = high + spread * 0.08;
  const y = (value) => padding.top + ((max - value) / (max - min)) * plotHeight;
  const step = plotWidth / candles.length;
  const bodyWidth = Math.max(3, Math.min(10, step * 0.68));

  return (
    <svg className="market-card-candle-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {[0.25, 0.5, 0.75].map((position) => (
        <line key={position} x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight * position} y2={padding.top + plotHeight * position} className="market-card-candle-grid" />
      ))}
      {candles.map(({ open, close, high: candleHigh, low: candleLow }, index) => {
        const x = padding.left + step * (index + 0.5);
        const rising = close >= open;
        const color = rising ? '#00a878' : '#e2534a';
        const bodyTop = Math.min(y(open), y(close));
        const bodyHeight = Math.max(1.5, Math.abs(y(open) - y(close)));
        return (
          <g key={index}>
            <line x1={x} x2={x} y1={y(candleHigh)} y2={y(candleLow)} stroke={color} strokeWidth="1.6" />
            <rect x={x - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} rx="0.6" fill={color} />
          </g>
        );
      })}
    </svg>
  );
};

const formatPrice = (value) => value !== null && value !== undefined && Number.isFinite(Number(value))
  ? `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : 'Unavailable';

const MarketCard = ({ name, quote, history = [], lastUpdated }) => {
  const hasQuote = Number(quote?.c) > 0;
  const isLive = quote?.isLive === true && hasQuote;
  const isDemo = quote?.isDemo === true && hasQuote;
  const isStale = quote?.isStale === true && hasQuote;
  const isDelayed = quote?.isDelayed === true && hasQuote;
  const isResearch = quote?.isResearch === true && hasQuote;
  const isBenchmark = quote?.marketType === 'benchmark' && hasQuote;
  const change = quote?.d !== null && quote?.d !== undefined ? Number(quote.d) : null;
  const changePercent = quote?.dp !== null && quote?.dp !== undefined ? Number(quote.dp) : null;
  const positive = Number(change) >= 0;
  const updatedAt = quote?.timestamp
    ? new Date(Number(quote.timestamp) < 1e12 ? Number(quote.timestamp) * 1000 : quote.timestamp)
    : hasQuote ? lastUpdated : null;
  const snapshotCandles = buildSnapshotCandles(history);
  const hasSnapshotCandles = snapshotCandles.length >= 2;
  const updatedLabel = updatedAt
    ? isStale
      ? `Stale · ${updatedAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
      : `${isDemo ? 'Demo update' : isDelayed ? 'As of' : 'Quote time'} ${updatedAt.toLocaleTimeString('en-IN')}`
    : hasSnapshotCandles ? 'Session quote samples' : 'No provider quote';
  const candles = hasSnapshotCandles ? snapshotCandles : hasQuote ? buildIllustrativeCandles(name) : [];
  const candleLabel = hasSnapshotCandles ? `${name} session quote snapshot candles` : `${name} illustrative demo candles, not market data`;
  const candleNote = hasSnapshotCandles
    ? `${isDemo ? 'Simulated quote snapshots · not market history' : isResearch ? 'Yahoo research quote snapshots · not market history' : 'Sampled quote candles · not provider OHLC history'}`
    : `Illustrative candle preview · ${hasQuote ? 'history unavailable' : 'quote unavailable'} · not market data`;

  return (
    <article className="market-card">
      <div className="card-topline">
        <span className="market-card-title">
          {name} <Activity size={12} className={`pulse-icon ${isLive ? 'text-emerald' : ''}`} />
        </span>
        {hasQuote && changePercent !== null ? (
          <strong className={`market-card-change ${positive ? 'gain' : 'loss'}`}>
            {positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {isDemo ? 'Demo ' : ''}{positive ? '+' : ''}{changePercent.toFixed(2)}%
          </strong>
        ) : <span className="market-card-change">Change unavailable</span>}
      </div>

      <div className="market-card-price-wrap">
        <span className="market-card-price-label">{!hasQuote ? 'Market quote unavailable' : isDemo ? 'Simulated demo price · not real' : isResearch ? `Research quote · not live · ${isStale ? 'stale · ' : ''}${quote?.provider || 'Yahoo Finance'}` : isStale ? isBenchmark ? `Stale benchmark reference · ${quote?.benchmarkName || 'Yahoo Finance'}` : `Last ${quote?.provider || 'provider'} quote · stale` : isBenchmark ? `Delayed global benchmark · ${quote?.benchmarkName || 'Yahoo Finance'}` : isDelayed ? `Delayed spot reference · ${quote?.provider || 'provider'}` : isLive ? `Current price · ${quote?.provider || 'Upstox'}` : `Provider quote · ${quote?.provider || 'market feed'}`}</span>
        <h3 className="market-card-price">{hasQuote ? formatPrice(Number(quote.c)) : 'Quote unavailable'}</h3>
      </div>

      <div className="market-card-chart-container">
        {hasQuote
          ? <>
            <MiniCandlestickChart candles={candles} label={candleLabel} />
            <span className="market-card-candle-note">{candleNote}</span>
          </>
          : <div className="market-card-no-quote" role="status">
            <Activity size={18} aria-hidden="true" />
            <span>Waiting for a market or benchmark quote</span>
          </div>}
      </div>

      <div className="market-timeframe-selector" aria-label="Chart history range">
        <span className="timeframe-btn active">{isDemo ? 'Demo' : isResearch ? 'Research' : isBenchmark ? 'Benchmark' : hasSnapshotCandles ? (isLive ? 'Live' : 'Session') : hasQuote ? 'Preview' : 'No data'}</span>
        <span className="market-card-updated" title={updatedAt?.toLocaleString('en-IN')}>{updatedLabel}</span>
      </div>

      <div className="split-stats">
        <span>High <b>{formatPrice(quote?.h)}</b></span>
        <span>Low <b>{formatPrice(quote?.l)}</b></span>
      </div>
    </article>
  );
};

export default MarketCard;
