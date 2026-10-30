import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const timeLabels = ['9:15', '10:30', '11:45', '13:00', '14:15', '15:00', '15:30'];

const buildIllustrativeSeries = (symbol) => {
  const seed = [...String(symbol || 'stock')].reduce((total, character) => total + character.charCodeAt(0), 0);
  const phase = (seed % 29) / 7;
  return Array.from({ length: 24 }, (_, index) => ({
    label: `Sample ${index + 1}`,
    value: Number((50
      + Math.sin(phase + index * 0.48) * 10
      + Math.cos(phase * 0.7 + index * 0.91) * 3.5
      + Math.sin(index * 0.16 + phase) * 2).toFixed(2)),
  }));
};

const Chart = ({ data = [], positive = true, height = 82, symbol = 'stock' }) => {
  const seed = [...String(symbol || 'stock')].reduce((total, character) => total + character.charCodeAt(0), 0);
  const candleCount = 26;

  // Build realistic mini OHLC candlesticks
  const candles = useMemo(() => {
    const list = Array.isArray(data) && data.length >= 7 ? data : [];
    const basePrice = list.length ? list[list.length - 1] : 100 + (seed % 900);
    let prevClose = list.length ? list[0] : basePrice * 0.98;

    return Array.from({ length: candleCount }, (_, i) => {
      const wave = Math.sin((seed * 0.12) + (i * 0.75)) * 0.015;
      const stepTrend = (i / (candleCount - 1)) * (positive ? 0.025 : -0.025);
      const close = basePrice * (0.985 + stepTrend + wave + (Math.sin(i * 1.4) * 0.008));
      const open = prevClose;
      const isUp = close >= open;
      const wick = Math.max(Math.abs(close - open) * 0.35, basePrice * 0.003);
      const high = Math.max(open, close) + wick;
      const low = Math.min(open, close) - wick;
      prevClose = close;

      return {
        open: Number(open.toFixed(2)),
        close: Number(close.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(Math.max(0.1, low).toFixed(2)),
        isUp,
      };
    });
  }, [data, positive, seed]);

  const allValues = candles.flatMap((c) => [c.high, c.low]);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const spread = Math.max(maxVal - minVal, 1);
  const padTop = 6;
  const padBottom = 6;
  const usableHeight = Math.max(10, height - padTop - padBottom);

  const getY = (val) => padTop + ((maxVal - val) / spread) * usableHeight;

  return (
    <div className="mini-candle-chart-wrap" style={{ height, width: '100%', position: 'relative' }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 260 ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Subtle reference grid lines */}
        <line x1="0" x2="260" y1={height * 0.25} y2={height * 0.25} stroke="rgba(255, 255, 255, 0.04)" strokeDasharray="2 3" />
        <line x1="0" x2="260" y1={height * 0.75} y2={height * 0.75} stroke="rgba(255, 255, 255, 0.04)" strokeDasharray="2 3" />

        {candles.map((c, idx) => {
          const colWidth = 260 / candleCount;
          const x = idx * colWidth + colWidth / 2;
          const bodyWidth = 5.2;
          const yOpen = getY(c.open);
          const yClose = getY(c.close);
          const yHigh = getY(c.high);
          const yLow = getY(c.low);

          const bodyY = Math.min(yOpen, yClose);
          const bodyHeight = Math.max(2.5, Math.abs(yClose - yOpen));
          const color = c.isUp ? '#00D09C' : '#EB5B56';

          return (
            <g key={idx} className="mini-candle-group">
              {/* Wick */}
              <line
                x1={x}
                x2={x}
                y1={yHigh}
                y2={yLow}
                stroke={color}
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              {/* Candle Body */}
              <rect
                x={x - bodyWidth / 2}
                y={bodyY}
                width={bodyWidth}
                height={bodyHeight}
                fill={color}
                rx="1"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default Chart;
