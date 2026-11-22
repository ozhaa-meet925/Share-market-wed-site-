import { Activity, ChevronRight } from 'lucide-react';
import { TickArrow, priceDirection, tickToneClass } from './PriceChange';

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
        const color = rising ? 'var(--gain)' : 'var(--loss)';
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

const MiniCloseLineChart = ({ candles, label }) => {
  const width = 320;
  const height = 132;
  const padding = { top: 7, right: 4, bottom: 5, left: 4 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const closes = candles.map((candle) => Number(candle.close));
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const spread = Math.max(high - low, Math.abs((high + low) / 2) * 0.001, 0.1);
  const min = low - spread * 0.08;
  const max = high + spread * 0.08;
  const y = (value) => padding.top + ((max - value) / (max - min)) * plotHeight;
  const x = (index) => padding.left + (plotWidth / Math.max(1, closes.length - 1)) * index;
  const points = closes.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
  const rising = closes.at(-1) >= closes[0];
  const stroke = rising ? 'var(--gain)' : 'var(--loss)';
  const baseY = padding.top + plotHeight;

  return (
    <svg className="market-card-candle-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {[0.25, 0.5, 0.75].map((position) => (
        <line key={position} x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight * position} y2={padding.top + plotHeight * position} className="market-card-candle-grid" />
      ))}
      <polygon points={`${padding.left},${baseY} ${points} ${(width - padding.right).toFixed(2)},${baseY}`} fill={stroke} opacity="0.1" />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

const formatPrice = (value) => value !== null && value !== undefined && Number.isFinite(Number(value))
  ? `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : 'Unavailable';

const formatHistoryDate = (value) => new Date(Number(value) * 1000).toLocaleDateString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
});

const MarketCard = ({
  name,
  quote,
  history = [],
  historyStatus = 'unavailable',
  historyError = '',
  historyProvider = '',
  historyIsResearch = false,
  onRetryHistory,
  onOpenChart,
  lastUpdated,
}) => {
  const hasQuote = Number(quote?.c) > 0
    && quote?.isDemo !== true
    && (quote?.isLive === true || quote?.isReal === true || quote?.isResearch === true
      || quote?.isDelayed === true || quote?.isStale === true || quote?.isClose === true);
  const isLive = quote?.isLive === true && hasQuote;
  const isStale = quote?.isStale === true && hasQuote;
  const isDelayed = quote?.isDelayed === true && hasQuote;
  const isResearch = quote?.isResearch === true && hasQuote;
  const isClose = quote?.isClose === true && hasQuote;
  const isIndex = quote?.marketType === 'index' && hasQuote;
  const isBenchmark = quote?.marketType === 'benchmark' && hasQuote;
  const change = quote?.d !== null && quote?.d !== undefined ? Number(quote.d) : null;
  const changePercent = quote?.dp !== null && quote?.dp !== undefined ? Number(quote.dp) : null;
  const positive = Number(change) >= 0;
  const flatChange = change !== null && changePercent !== null
    && Math.abs(change) < 0.005 && Math.abs(changePercent) < 0.005;
  const direction = priceDirection(change, changePercent, quote?.flash, quote?.lastTick);
  const priceTone = tickToneClass(flatChange ? 'flat' : direction, quote?.flash);
  const updatedAt = quote?.timestamp
    ? new Date(Number(quote.timestamp) < 1e12 ? Number(quote.timestamp) * 1000 : quote.timestamp)
    : null;
  const candles = (Array.isArray(history) ? history : []).filter((candle) => (
    candle && Number.isFinite(Number(candle.time))
      && ['open', 'high', 'low', 'close'].every((field) => Number.isFinite(Number(candle[field])) && Number(candle[field]) > 0)
      && Number(candle.high) >= Math.max(Number(candle.open), Number(candle.close))
      && Number(candle.low) <= Math.min(Number(candle.open), Number(candle.close))
  ));
  const hasVerifiedHistory = candles.length >= 2;
  // Thin contracts (for example COMEX aluminium and zinc) often publish daily
  // bars with high = low, which collapse into dots as candles. The verified
  // closes still trace the trend, so draw those series as a line instead.
  const flatSeries = candles.length >= 2
    && candles.filter((candle) => Number(candle.high) === Number(candle.low)).length / candles.length > 0.4;
  const historySource = historyProvider.replace(/\s+research feed$/i, '');
  const updatedLabel = updatedAt
    ? isStale
      ? `Stale · ${updatedAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
      : isClose
        ? `${isResearch ? 'Last close' : 'Exchange close'} · ${updatedAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
        : `${isDelayed || isResearch ? 'As of' : 'Quote time'} ${updatedAt.toLocaleTimeString('en-IN')}`
    : 'Quote timestamp unavailable';
  const candleLabel = `${name} verified historical OHLC candles`;
  const candleNote = hasVerifiedHistory
    ? historyIsResearch
      ? `${historySource || 'Research provider'} research · delayed, not live · latest ${formatHistoryDate(candles.at(-1).time)}`
      : `${historySource || 'Provider'} historical OHLC · latest ${formatHistoryDate(candles.at(-1).time)}`
    : 'Verified historical OHLC unavailable';
  const emptyHistoryMessage = historyStatus === 'loading'
    ? 'Loading published historical OHLC…'
    : historyError || 'No verified historical OHLC candles are available for this index.';

  return (
    <article className="market-card">
      <div className="card-topline">
        <span className="market-card-title">
          {name} <Activity size={12} className={`pulse-icon ${isLive ? 'text-emerald' : ''}`} />
        </span>
        {hasQuote && changePercent !== null ? (
          flatChange
            ? <strong className="market-card-change price-flat"><TickArrow direction="flat" />No change reported</strong>
            : <strong className={`market-card-change ${positive ? 'gain' : 'loss'}`}>
              <TickArrow direction={direction} />
              {positive ? '+' : ''}{changePercent.toFixed(2)}%
            </strong>
        ) : <span className="market-card-change">Change unavailable</span>}
      </div>

      <div className="market-card-price-wrap">
        <span className="market-card-price-label">{!hasQuote ? 'Market quote unavailable' : isResearch ? `Research quote · not live · ${isStale ? 'stale · ' : isClose ? 'last close · ' : ''}${quote?.provider || 'Yahoo Finance'}` : isClose ? `${quote?.provider || 'Exchange'} · exchange feed` : isStale ? isBenchmark ? `Stale benchmark reference · ${quote?.benchmarkName || 'Yahoo Finance'}` : isIndex ? `Stale index feed · ${quote?.provider || 'provider'}` : `Last ${quote?.provider || 'provider'} quote · stale` : isBenchmark ? `Delayed global benchmark · ${quote?.benchmarkName || 'Yahoo Finance'}` : isDelayed ? isIndex ? `Delayed index feed · ${quote?.provider || 'provider'}` : `Delayed spot reference · ${quote?.provider || 'provider'}` : isLive ? `Current price · ${quote?.provider || 'Upstox'}` : `Provider quote · ${quote?.provider || 'market feed'}`}</span>
        <h3 className={`market-card-price ${priceTone}`}>{hasQuote ? formatPrice(Number(quote.c)) : 'Quote unavailable'}</h3>
      </div>

      <div className="market-card-chart-container">
        {hasVerifiedHistory
          ? <>
            {flatSeries
              ? <MiniCloseLineChart candles={candles} label={candleLabel} />
              : <MiniCandlestickChart candles={candles} label={candleLabel} />}
            <span className="market-card-candle-note">
              {candleNote}{flatSeries ? ' · line view, provider reports little daily range' : ''}
            </span>
          </>
          : <div className={`market-card-no-quote${historyStatus === 'loading' ? ' is-loading' : ''}`} role="status">
            <Activity size={18} aria-hidden="true" />
            <span>{hasQuote ? emptyHistoryMessage : 'Waiting for a verified market or benchmark quote'}</span>
            {(historyStatus === 'error' || historyStatus === 'unavailable') && onRetryHistory && (
              <button type="button" className="market-card-history-retry" onClick={onRetryHistory}>Retry history</button>
            )}
          </div>}
      </div>

      <div className="market-timeframe-selector" aria-label="Chart history range">
        <span className="timeframe-btn active">{hasVerifiedHistory ? 'Historical OHLC' : historyStatus === 'loading' ? 'Loading history' : 'No history'}</span>
        <span className="market-card-updated" title={updatedAt?.toLocaleString('en-IN') || undefined}>{hasQuote ? updatedLabel : lastUpdated ? `Checked ${lastUpdated.toLocaleTimeString('en-IN')}` : updatedLabel}</span>
        {onOpenChart && (
          <button type="button" className="market-card-open-chart" onClick={onOpenChart}>
            Chart <ChevronRight size={12} />
          </button>
        )}
      </div>

      <div className="split-stats">
        <span>High <b>{formatPrice(quote?.h)}</b></span>
        <span>Low <b>{formatPrice(quote?.l)}</b></span>
      </div>
    </article>
  );
};

export default MarketCard;
