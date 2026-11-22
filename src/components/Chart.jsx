import { useMemo } from 'react';

const compactNumber = (value) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const chartDate = (value, range) => {
  const date = new Date(Number(value) * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(range > 365 * 24 * 60 * 60 ? { year: '2-digit' } : {}),
    timeZone: 'Asia/Kolkata',
  }).format(date);
};

const Chart = ({ data = [], height = 82, symbol = 'stock', loading = false, showXAxis = false, showYAxis = false, maxCandles }) => {
  const visibleCount = maxCandles || (showXAxis ? 90 : 28);
  const candles = useMemo(() => (Array.isArray(data) ? data : [])
    .filter((item) => item && Number.isFinite(Number(item.time))
      && ['open', 'high', 'low', 'close'].every((key) => Number.isFinite(Number(item[key])) && Number(item[key]) > 0)
      && Number(item.high) >= Math.max(Number(item.open), Number(item.close))
      && Number(item.low) <= Math.min(Number(item.open), Number(item.close)))
    .sort((a, b) => Number(a.time) - Number(b.time))
    .slice(-visibleCount), [data, visibleCount]);

  if (candles.length < 2) {
    return (
      <div className="mini-candle-chart-empty" style={{ height }} role="img" aria-label={`${symbol} historical candles unavailable`}>
        {loading ? 'Loading historical candles…' : 'Historical candles unavailable'}
      </div>
    );
  }

  const chartWidth = showXAxis || showYAxis ? 320 : 260;
  const padding = {
    top: 7,
    right: 5,
    bottom: showXAxis ? 23 : 5,
    left: showYAxis ? 58 : 4,
  };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const minValue = Math.min(...candles.map((candle) => Number(candle.low)));
  const maxValue = Math.max(...candles.map((candle) => Number(candle.high)));
  const spread = Math.max(maxValue - minValue, Math.max(maxValue * 0.001, 0.01));
  const min = minValue - spread * 0.04;
  const max = maxValue + spread * 0.04;
  const yOf = (value) => padding.top + ((max - Number(value)) / (max - min)) * plotHeight;
  const columnWidth = plotWidth / candles.length;
  const bodyWidth = Math.min(showXAxis ? 7 : 5.2, columnWidth * 0.66);
  const timeRange = Number(candles.at(-1).time) - Number(candles[0].time);
  const isIndex = /^(NIFTY|SENSEX|BANKNIFTY|NIFTYIT|NIFTYMIDCAP)$/i.test(symbol.replace(/^(NSE|BSE):/i, ''));

  return (
    <div className="mini-candle-chart-wrap" style={{ height, width: '100%', position: 'relative' }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${chartWidth} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${symbol} historical OHLC candles${showXAxis ? ' with IST date axis' : ''}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {[0, 0.5, 1].map((position) => {
          const y = padding.top + plotHeight * position;
          const value = max - ((max - min) * position);
          return (
            <g key={position}>
              <line x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 3" />
              {showYAxis ? (
                <text x={padding.left - 5} y={y + 3} textAnchor="end" fill="currentColor" opacity="0.72" fontSize="9">
                  {isIndex ? compactNumber(value) : `₹${compactNumber(value)}`}
                </text>
              ) : null}
            </g>
          );
        })}
        {candles.map((candle, index) => {
          const x = padding.left + (index * columnWidth) + (columnWidth / 2);
          const openY = yOf(candle.open);
          const closeY = yOf(candle.close);
          const highY = yOf(candle.high);
          const lowY = yOf(candle.low);
          const color = Number(candle.close) >= Number(candle.open) ? 'var(--gain)' : 'var(--loss)';
          return (
            <g key={`${candle.time}-${index}`}>
              <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1.2" />
              <rect
                x={x - bodyWidth / 2}
                y={Math.min(openY, closeY)}
                width={bodyWidth}
                height={Math.max(1.8, Math.abs(closeY - openY))}
                fill={color}
                rx="0.7"
              />
            </g>
          );
        })}
        {showXAxis ? [0, Math.floor((candles.length - 1) / 2), candles.length - 1].map((index, tickIndex, ticks) => {
          const candle = candles[index];
          const x = padding.left + (index * columnWidth) + (columnWidth / 2);
          const anchor = tickIndex === 0 ? 'start' : tickIndex === ticks.length - 1 ? 'end' : 'middle';
          const tickX = tickIndex === 0 ? padding.left : tickIndex === ticks.length - 1 ? chartWidth - padding.right : x;
          return (
            <text key={candle.time} x={tickX} y={height - 5} textAnchor={anchor} fill="currentColor" opacity="0.72" fontSize="9">
              {chartDate(candle.time, timeRange)}
            </text>
          );
        }) : null}
      </svg>
    </div>
  );
};

export default Chart;
