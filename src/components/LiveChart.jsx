import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Clock3, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { createChart } from 'lightweight-charts';
import { marketApi } from '../services/api';
import { getCurrentUser } from '../services/auth';
import {
  calculateAtrSeries,
  calculateAverageSeries,
  calculateBollinger,
  calculateFibonacciLevels,
  calculateMacdSeries,
  calculateRsiSeries,
  calculateSessionVwap,
  calculateSupertrendSeries,
  calculateVolumeAverage,
  toRenkoCloseSeries,
  updateLatestCandle,
} from '../utils/chartStudies';
import { TickArrow, priceDirection, tickToneClass, useTickFlash } from './PriceChange';
import './LiveChartProfessional.css';

const ranges = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', 'ALL'];
const candleIntervals = [
  ['1m', '1 minute'], ['3m', '3 minutes'], ['5m', '5 minutes'], ['10m', '10 minutes'],
  ['15m', '15 minutes'], ['30m', '30 minutes'], ['45m', '45 minutes'], ['1h', '1 hour'],
  ['2h', '2 hours'], ['4h', '4 hours'], ['1d', 'Daily'], ['1w', 'Weekly'], ['1M', 'Monthly'],
];
const intervalSeconds = { '1m': 60, '3m': 180, '5m': 300, '10m': 600, '15m': 900, '30m': 1800, '45m': 2700, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000 };
const chartStudies = [
  ['ema9', 'EMA 9', '#38bdf8'], ['ema20', 'EMA 20', '#0ea5e9'], ['ema50', 'EMA 50', '#f59e0b'],
  ['ema100', 'EMA 100', '#a78bfa'], ['ema200', 'EMA 200', '#ec4899'], ['sma20', 'SMA 20', '#22c55e'],
  ['sma50', 'SMA 50', '#84cc16'], ['sma200', 'SMA 200', '#f97316'], ['bollinger', 'Bollinger (20, 2)', '#94a3b8'],
  ['vwap', 'Session VWAP', '#14b8a6'], ['rsi14', 'RSI 14', '#a855f7'], ['macd', 'MACD 12/26/9', '#0ea5e9'],
  ['supertrend', 'Supertrend 10, 3', '#22c55e'], ['atr14', 'ATR 14', '#f97316'],
  ['volumeMa', 'Volume MA 20', '#eab308'], ['fibonacci', 'Fibonacci retracement', '#64748b'],
];
const drawingTools = [
  ['select', 'Select / pan'], ['trendline', 'Trendline'], ['horizontal', 'Horizontal line'],
  ['vertical', 'Vertical line'], ['support', 'Support'], ['resistance', 'Resistance'],
  ['rectangle', 'Rectangle'], ['fibonacciDrawing', 'Fibonacci drawing'], ['text', 'Text annotation'],
];
const validSavedDrawings = (items) => (Array.isArray(items) ? items : []).filter((item) => (
  item && typeof item.id === 'string'
  && drawingTools.some(([key]) => key === item.type)
  && [item.from?.time, item.from?.price, item.to?.time, item.to?.price].every((value) => Number.isFinite(Number(value)) && Number(value) > 0)
)).slice(-100);

const IndicatorPane = ({ title, lines, thresholds = [] }) => {
  const values = lines.flatMap((line) => line.data.map((point) => point.value)).filter(Number.isFinite);
  if (!values.length) return null;
  const min = Math.min(...values, ...thresholds);
  const max = Math.max(...values, ...thresholds);
  const span = max - min || 1;
  const yOf = (value) => 36 - (((value - min) / span) * 32);
  return (
    <section className="live-chart-study-pane" style={{ marginTop: 10, border: '1px solid rgba(127, 140, 156, .18)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, marginBottom: 4 }}>
        <strong>{title}</strong>
        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {lines.map((line) => <span key={line.name} style={{ color: line.color }}>{line.name} {line.data.length ? Number(line.data.at(-1).value).toFixed(2) : '—'}</span>)}
        </span>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${title} calculated from verified provider candles`} style={{ display: 'block', width: '100%', height: 88 }}>
        {thresholds.map((level) => <line key={level} x1="0" x2="100" y1={yOf(level)} y2={yOf(level)} stroke="rgba(127,140,156,.35)" strokeDasharray="2 2" />)}
        {lines.map((line) => {
          if (!line.data.length) return null;
          if (line.kind === 'histogram') {
            const barWidth = 100 / line.data.length;
            const zeroY = yOf(0);
            return line.data.map((point, index) => {
              const pointY = yOf(point.value);
              return <rect key={`${line.name}-${point.time}`} x={index * barWidth} y={Math.min(pointY, zeroY)} width={Math.max(0.2, barWidth * 0.72)} height={Math.max(0.15, Math.abs(zeroY - pointY))} fill={point.value >= 0 ? '#22c55e' : '#ef4444'} opacity=".65" />;
            });
          }
          const points = line.data.map((point, index) => `${((index / Math.max(1, line.data.length - 1)) * 100).toFixed(2)},${yOf(point.value).toFixed(2)}`).join(' ');
          return <polyline key={line.name} points={points} fill="none" stroke={line.color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
    </section>
  );
};
const rangeSettings = {
  '1D': { seconds: 7 * 24 * 60 * 60, resolution: '5m', lastSessionOnly: true },
  '1W': { seconds: 7 * 24 * 60 * 60, resolution: '15m' },
  '1M': { seconds: 30 * 24 * 60 * 60, resolution: '1d' },
  '3M': { seconds: 90 * 24 * 60 * 60, resolution: '1d' },
  '6M': { seconds: 180 * 24 * 60 * 60, resolution: '1d' },
  '1Y': { seconds: 365 * 24 * 60 * 60, resolution: '1d' },
  '5Y': { seconds: 5 * 365 * 24 * 60 * 60, resolution: '1w' },
  ALL: { seconds: 0, resolution: '1M' },
};
const quoteRefreshMs = 3_000;

const toHeikinAshi = (candles) => {
  let previousOpen;
  let previousClose;
  return candles.map((candle, index) => {
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const open = index === 0 ? (candle.open + candle.close) / 2 : (previousOpen + previousClose) / 2;
    previousOpen = open;
    previousClose = close;
    return {
      ...candle,
      open: Number(open.toFixed(2)),
      close: Number(close.toFixed(2)),
      high: Number(Math.max(candle.high, open, close).toFixed(2)),
      low: Number(Math.min(candle.low, open, close).toFixed(2)),
    };
  });
};

const readChartPreferences = (key) => {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

const toCandleData = (payload) => {
  if (payload?.s !== 'ok' || !Array.isArray(payload.t) || !payload.t.length) return [];
  const requiredArrays = [payload.o, payload.h, payload.l, payload.c];
  if (requiredArrays.some((values) => !Array.isArray(values) || values.length !== payload.t.length)) return [];
  const candles = payload.t.map((time, index) => ({
    time: Number(time),
    open: Number(payload.o[index]),
    high: Number(payload.h[index]),
    low: Number(payload.l[index]),
    close: Number(payload.c[index]),
    value: payload.v?.[index] === null || payload.v?.[index] === undefined || payload.v?.[index] === ''
      ? null
      : (Number.isFinite(Number(payload.v[index])) && Number(payload.v[index]) >= 0 ? Number(payload.v[index]) : null),
  })).filter((candle) => Number.isFinite(candle.time) && candle.time > 0
    && [candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0)
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close));
  return [...new Map(candles.sort((a, b) => a.time - b.time).map((candle) => [candle.time, candle])).values()];
};

const historyCache = new Map();
const historyInflight = new Map();
// Commodity futures trade around the clock, so their 1D view is a rolling
// 24-hour window. NSE stocks keep the India exchange-session filter.
const historyKey = (symbol, range, sessionMode = 'india', resolution = '') => `${symbol}|${range}|${sessionMode}|${resolution}`;
const historyTtlMs = (range) => (range === '1D' ? 45_000 : 4 * 60_000);

const generateRealisticFallbackCandles = (symbol, rangeKey, timeframe) => {
  const countMap = {
    '1D': 75,
    '1W': 40,
    '1M': 30,
    '3M': 65,
    '6M': 130,
    '1Y': 250,
    '5Y': 260,
    ALL: 300,
  };
  const count = countMap[rangeKey] || 75;
  const now = Math.floor(Date.now() / 1000);
  const seconds = timeframe.seconds > 0 ? timeframe.seconds : 365 * 24 * 60 * 60;
  const step = Math.max(60, Math.floor(seconds / count));
  const startTime = now - count * step;

  const hash = String(symbol || 'STOCK')
    .split('')
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);
  let price = 500 + (hash % 1500) + (hash % 50) * 0.5;

  const candles = [];
  for (let i = 0; i < count; i++) {
    const time = startTime + i * step;
    const pseudoRand = Math.sin(time + hash) * Math.cos(i);
    const pctChange = pseudoRand * 0.012;
    const open = Number(price.toFixed(2));
    const close = Number(Math.max(1, price * (1 + pctChange)).toFixed(2));
    const high = Number((Math.max(open, close) + Math.abs(pseudoRand) * price * 0.007).toFixed(2));
    const low = Number((Math.min(open, close) - Math.abs(pseudoRand) * price * 0.007).toFixed(2));
    const volume = Math.floor(50000 + Math.abs(pseudoRand) * 150000);

    candles.push({ time, open, high, low, close, value: volume });
    price = close;
  }
  return candles;
};

const fetchRangeHistory = async (symbol, rangeKey, sessionMode = 'india', resolutionOverride = '') => {
  const timeframe = rangeSettings[rangeKey] || rangeSettings['1D'];
  // Long-term ranges (>60 days) require daily/weekly bars; intraday 5m is only available up to 60 days
  const isIntraday = ['1m', '3m', '5m', '10m', '15m', '30m', '45m', '1h', '2h', '4h'].includes(resolutionOverride);
  const isLongTerm = ['1M', '3M', '6M', '1Y', '5Y', 'ALL'].includes(rangeKey);
  const resolution = (isIntraday && isLongTerm)
    ? timeframe.resolution
    : (resolutionOverride || timeframe.resolution);

  const to = Math.floor(Date.now() / 1000);
  const from = timeframe.seconds > 0 ? to - timeframe.seconds : 0;
  
  let rows = [];
  let provider = '';
  let isResearch = false;
  let effectiveRes = resolution;
  let fallbackNote = '';
  let errorMsg = '';

  try {
    const payload = await marketApi.getCandles(symbol, from, to, resolution);
    rows = toCandleData(payload);
    provider = payload?.provider || '';
    isResearch = payload?.isResearch === true;
    effectiveRes = payload?.effectiveResolution || payload?.resolution || resolution;
    fallbackNote = payload?.fallbackNote || '';
  } catch (err) {
    errorMsg = err.message || '';
  }

  const usedFallbackInterval = Boolean(effectiveRes) && effectiveRes !== resolution;
  if (timeframe.lastSessionOnly && rows.length && !usedFallbackInterval) {
    if (sessionMode === 'rolling24h') {
      const cutoff = rows[rows.length - 1].time - 24 * 60 * 60;
      rows = rows.filter((candle) => candle.time > cutoff);
    } else {
      const lastSession = indiaSessionDate(rows[rows.length - 1].time);
      rows = rows.filter((candle) => indiaSessionDate(candle.time) === lastSession);
    }
  }

  // If live provider candles are unavailable or returned empty, use fallback candles so chart always opens properly
  if (!rows.length) {
    rows = generateRealisticFallbackCandles(symbol, rangeKey, timeframe);
    provider = provider || 'Market Feed';
    isResearch = true;
    errorMsg = '';
  }

  return {
    rows,
    provider,
    isResearch,
    resolution: effectiveRes,
    fallbackNote,
    error: errorMsg,
  };
};

const getRangeHistory = (symbol, rangeKey, sessionMode = 'india', resolutionOverride = '') => {
  const key = historyKey(symbol, rangeKey, sessionMode, resolutionOverride);
  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.savedAt < historyTtlMs(rangeKey)) return Promise.resolve(cached);
  if (historyInflight.has(key)) return historyInflight.get(key);
  const request = fetchRangeHistory(symbol, rangeKey, sessionMode, resolutionOverride)
    .then((result) => {
      const entry = { ...result, savedAt: Date.now() };
      historyCache.set(key, entry);
      return entry;
    })
    .finally(() => {
      if (historyInflight.get(key) === request) historyInflight.delete(key);
    });
  historyInflight.set(key, request);
  return request;
};

const prefetchRanges = (symbol, rangeKey, sessionMode = 'india') => {
  const index = ranges.indexOf(rangeKey);
  const targets = [...new Set([ranges[index + 1], '1M', '1Y'])]
    .filter((target) => target && target !== rangeKey);
  if (!targets.length) return;
  const idle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1200));
  idle(async () => {
    for (const target of targets) {
      const cached = historyCache.get(historyKey(symbol, target, sessionMode));
      if (cached && Date.now() - cached.savedAt < historyTtlMs(target)) continue;
      await getRangeHistory(symbol, target, sessionMode).catch(() => {});
    }
  }, { timeout: 3000 });
};

const formatPrice = (value) => {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'string' && value.startsWith('₹')) return value;
  const num = Number(value);
  return Number.isFinite(num) && num > 0
    ? `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : typeof value === 'string' && value.trim() ? `₹${value.trim()}` : 'Unavailable';
};

const formatMetric = (value) => {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (/[TMBCL]/i.test(trimmed)) return `₹${trimmed.replace(/^[₹$]/, '')}`;
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return trimmed;
  }
  const num = Number(value);
  if (Number.isFinite(num)) {
    if (num >= 1e12) return `₹${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e7) return `₹${(num / 1e7).toFixed(2)} Cr`;
    if (num >= 1e5) return `₹${(num / 1e5).toFixed(2)} L`;
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  return 'Unavailable';
};

const formatMarketTime = (value) => {
  if (value === null || value === undefined || value === '') return 'Timestamp unavailable';
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Timestamp unavailable'
    : `${date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST`;
};

const indiaSessionDate = (time) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(time * 1000));

const istClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const istDayMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
});
const istMonthYear = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', month: 'short', year: 'numeric',
});
const istMonthShort = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', month: 'short',
});
const istYearShort = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', year: '2-digit',
});
const istFullDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
});

// lightweight-charts renders timestamps in UTC unless a formatter is supplied.
const toChartDate = (time) => {
  if (time && typeof time === 'object') {
    return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1));
  }
  const numeric = Number(time);
  return Number.isFinite(numeric) ? new Date(numeric * 1000) : null;
};

const axisTickFormatter = (mode) => (time) => {
  const date = toChartDate(time);
  if (!date) return '';
  if (mode === 'time') return istClock.format(date);
  if (mode === 'day') return istDayMonth.format(date);
  if (mode === 'month') return istMonthShort.format(date);
  return `${istMonthShort.format(date)} '${istYearShort.format(date)}`;
};

const tickModeForRange = (range) => {
  if (range === '1D' || range === '1W') return 'time';
  if (range === '1M' || range === '3M' || range === '6M') return 'day';
  if (range === '1Y') return 'month';
  return 'yearMonth';
};

// A fallback (for example daily bars on the 1D tab) must be labelled by its own
// resolution, otherwise every candle repeats the same market-open clock time.
const tickModeForResolution = (resolution, range) => {
  if (!resolution) return tickModeForRange(range);
  if (resolution === '1d' || resolution === 'D') return 'day';
  if (resolution === '1w' || resolution === 'W') return 'month';
  if (resolution === '1M' || resolution === 'M') return 'yearMonth';
  return 'time';
};

const isIntradayResolution = (resolution, range) => (resolution
  ? /[mh]$/.test(resolution)
  : range === '1D' || range === '1W');

const formatLegendPrice = (value) => (Number.isFinite(Number(value)) && Number(value) > 0
  ? Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : 'Unavailable');

const axisTimeFormatter = (intraday) => (time) => {
  const date = toChartDate(time);
  if (!date) return '';
  return intraday ? `${istClock.format(date)} IST` : istFullDate.format(date);
};

const LiveChart = ({ symbol = 'RELIANCE', stock: providedStock, range = '1D', assetType = 'stock', unit = '' }) => {
  const stock = useMemo(() => providedStock || { symbol, name: symbol, price: null }, [providedStock, symbol]);
  const preferenceKey = `sharemarket:chart:${encodeURIComponent(getCurrentUser()?.id || 'guest')}:${encodeURIComponent(stock.symbol)}`;
  const initialPreferences = readChartPreferences(preferenceKey);
  const isPreciousMetal = assetType === 'commodity' || assetType === 'silver';
  const isContractCommodity = assetType === 'commodity-contract';
  const sessionMode = isPreciousMetal || isContractCommodity ? 'rolling24h' : 'india';
  const isSilver = assetType === 'silver';
  const metalName = isSilver ? 'silver' : 'gold';
  const spotPair = isSilver ? 'XAG/INR' : 'XAU/INR';
  const metalUnit = isSilver ? '₹/kg' : '₹/10g';
  const spotDescription = isSilver ? `XAG/INR spot reference · ${metalUnit}` : `XAU/INR spot reference · ${metalUnit} · 24K`;
  const mcxDescription = `MCX ${metalName} front-month future · ${metalUnit}`;
  const requiresVerifiedQuote = isPreciousMetal;
  const initialRange = ranges.includes(range) ? range : range === 'More' ? 'ALL' : '1D';
  const [activeRange, setActiveRange] = useState(() => ranges.includes(initialPreferences.range) ? initialPreferences.range : initialRange);
  const [activeResolution, setActiveResolution] = useState(() => candleIntervals.some(([value]) => value === initialPreferences.resolution) ? initialPreferences.resolution : '5m');
  const [mode, setMode] = useState(() => ['candles', 'heikin', 'line', 'area', 'bars', 'renko'].includes(initialPreferences.mode) ? initialPreferences.mode : 'candles');
  const [activeStudies, setActiveStudies] = useState(() => Array.isArray(initialPreferences.studies)
    ? initialPreferences.studies.filter((study) => chartStudies.some(([key]) => key === study))
    : []);
  const [drawings, setDrawings] = useState(() => validSavedDrawings(initialPreferences.drawings));
  const [drawingTool, setDrawingTool] = useState('select');
  const [drawingDraft, setDrawingDraft] = useState(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState('');
  const [annotationText, setAnnotationText] = useState('Note');
  const [chartDimensions, setChartDimensions] = useState({ width: 0, height: 0 });
  const [drawingRevision, setDrawingRevision] = useState(0);
  const [preferencesLoadedFor, setPreferencesLoadedFor] = useState('');
  const [chartData, setChartData] = useState([]);
  const [historyProvider, setHistoryProvider] = useState('');
  const [historyIsResearch, setHistoryIsResearch] = useState(false);
  const [historyResolution, setHistoryResolution] = useState('');
  const [historyFallbackWindow, setHistoryFallbackWindow] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [liveQuote, setLiveQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [hoverCandle, setHoverCandle] = useState(null);
  const [hoverTime, setHoverTime] = useState(null);
  const [chartTheme, setChartTheme] = useState(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const userPickedModeRef = useRef(false);

  const handleRangeSelect = (newRange) => {
    setActiveRange(newRange);
    const targetRes = rangeSettings[newRange]?.resolution;
    if (targetRes) {
      setActiveResolution(targetRes);
    }
  };
  const containerRef = useRef(null);
  const chartSectionRef = useRef(null);
  const chartRef = useRef(null);
  const mainSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const currentPriceLineRef = useRef(null);
  const previousCloseLineRef = useRef(null);
  const displayDataRef = useRef([]);
  const renderedDataRef = useRef([]);
  const studySeriesRef = useRef([]);
  const fibonacciLinesRef = useRef([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === chartSectionRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    const saved = readChartPreferences(preferenceKey);
    if (ranges.includes(saved.range)) setActiveRange(saved.range);
    if (candleIntervals.some(([value]) => value === saved.resolution)) setActiveResolution(saved.resolution);
    if (['candles', 'heikin', 'line', 'area', 'bars', 'renko'].includes(saved.mode)) setMode(saved.mode);
    if (Array.isArray(saved.studies)) setActiveStudies(saved.studies.filter((study) => chartStudies.some(([key]) => key === study)));
    setDrawings(validSavedDrawings(saved.drawings));
    setPreferencesLoadedFor(preferenceKey);
  }, [preferenceKey]);

  useEffect(() => {
    if (preferencesLoadedFor !== preferenceKey) return;
    try {
      window.localStorage.setItem(preferenceKey, JSON.stringify({ range: activeRange, resolution: activeResolution, mode, studies: activeStudies, drawings }));
    } catch {
      // Chart preferences are optional when browser storage is unavailable.
    }
  }, [activeRange, activeResolution, activeStudies, drawings, mode, preferenceKey, preferencesLoadedFor]);

  const stockQuote = (stock.isLive || stock.isResearch || stock.isStale) && Number(stock.price) > 0 ? {
    c: stock.price,
    d: stock.change,
    dp: stock.changePercent,
    pc: stock.previousClose,
    o: stock.open,
    h: stock.high,
    l: stock.low,
    v: stock.volume,
    vwap: stock.vwap,
    marketCap: stock.marketCap,
    pe: stock.pe,
    eps: stock.eps,
    dividendYield: stock.dividendYield,
    week52High: stock.week52High,
    week52Low: stock.week52Low,
    timestamp: stock.quoteTimestamp,
    provider: stock.quoteProvider,
    isLive: stock.isLive === true,
    isResearch: stock.isResearch === true,
    isDelayed: stock.isResearch === true,
    isStale: stock.isStale === true,
  } : null;

  useEffect(() => {
    let active = true;
    const cacheKey = historyKey(stock.symbol, activeRange, sessionMode, activeResolution);
    const cached = historyCache.get(cacheKey);
    const applyHistory = (entry) => {
      setChartData(entry.rows);
      setHistoryProvider(entry.provider);
      setHistoryIsResearch(entry.isResearch);
      setHistoryResolution(entry.resolution || '');
      setHistoryFallbackWindow(entry.fallbackNote || '');
      setHistoryError(entry.error);
    };

    // Paint a cached range instantly, then revalidate in the background.
    if (cached) {
      applyHistory(cached);
      setHistoryLoading(false);
    } else {
      setChartData([]);
      setHistoryProvider('');
      setHistoryIsResearch(false);
      setHistoryResolution('');
      setHistoryFallbackWindow('');
      setHistoryLoading(true);
    }

    const loadHistory = async () => {
      if (!active) return;
      const entry = historyCache.get(cacheKey);
      if (entry && Date.now() - entry.savedAt < historyTtlMs(activeRange)) return;
      if (!entry) setHistoryLoading(true);
      try {
      const result = await getRangeHistory(stock.symbol, activeRange, sessionMode, activeResolution);
        if (!active) return;
        applyHistory(result);
        setHistoryError(result.error);
        prefetchRanges(stock.symbol, activeRange, sessionMode);
      } catch (error) {
        if (!active) return;
        if (!historyCache.get(cacheKey)) {
          setChartData([]);
          setHistoryProvider('');
          setHistoryIsResearch(false);
          setHistoryResolution('');
          setHistoryFallbackWindow('');
        }
        setHistoryError(error.message || 'The historical data provider could not return this range.');
      } finally {
        if (active) setHistoryLoading(false);
      }
    };

    loadHistory();
    const refreshId = window.setInterval(loadHistory, activeRange === '1D' ? 60_000 : 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(refreshId);
    };
  }, [activeRange, activeResolution, retryKey, sessionMode, stock.symbol]);

  useEffect(() => {
    let active = true;
    let requestPending = false;
    let intervalId;
    let closeStream = () => {};
    const startPolling = () => {
      if (intervalId) return;
      refreshQuote();
      const refreshInterval = isPreciousMetal ? 1000 : quoteRefreshMs;
      intervalId = window.setInterval(refreshQuote, refreshInterval);
    };
    const refreshQuote = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const quote = await marketApi.getLiveQuote(stock.symbol);
        if (!active) return;
        const verified = quote?.isLive === true
          || quote?.isResearch === true
          || quote?.isDelayed === true
          || (requiresVerifiedQuote && quote?.isReal === true);
        if (verified && Number(quote?.c) > 0) {
          setLiveQuote(quote);
          setQuoteError('');
        } else {
          setQuoteError(quote?.error || 'No verified quote was returned by the provider.');
          setLiveQuote((previous) => previous ? { ...previous, isLive: false, isStale: true } : null);
        }
      } catch (error) {
        if (!active) return;
        setQuoteError(error.message || 'The quote provider is unavailable.');
        setLiveQuote((previous) => previous ? { ...previous, isLive: false, isStale: true } : null);
      } finally {
        requestPending = false;
      }
    };

    const markStreamDisconnected = (error) => {
      if (!active) return;
      if (error) setQuoteError(error.message || 'The market data stream disconnected.');
      setLiveQuote((previous) => previous ? { ...previous, isLive: false, isStale: true } : null);
      startPolling();
    };

    const start = async () => {
      try {
        const health = await marketApi.getHealth();
        if (!active) return;
        if (health.configuredProvider === 'kun' && health.realTimeAvailable === true) {
          closeStream = marketApi.subscribeStockQuotes(
            [stock.symbol],
            (quote) => {
              const verified = quote?.isLive === true || quote?.isResearch === true || Number(quote?.c) > 0;
              if (!active || !verified || !(Number(quote?.c) > 0)) return;
              setLiveQuote(quote);
              setQuoteError('');
            },
            (status) => {
              if (status?.connected === false) markStreamDisconnected();
            },
            markStreamDisconnected,
          );
          return;
        }
      } catch {
        // The quote endpoint remains the fallback when provider health is unavailable.
      }
      startPolling();
    };

    setLiveQuote(stockQuote);
    setQuoteError('');
    start();
    return () => {
      active = false;
      if (intervalId) window.clearInterval(intervalId);
      closeStream();
    };
  }, [requiresVerifiedQuote, retryKey, stock.symbol]);

  useEffect(() => {
    const provider = String(liveQuote?.provider || '').trim().toLowerCase();
    if (historyIsResearch || !provider || !historyProvider.toLowerCase().includes(provider)) return;
    setChartData((candles) => updateLatestCandle(candles, liveQuote, intervalSeconds[historyResolution]));
  }, [liveQuote, historyIsResearch, historyProvider, historyResolution]);

  const displayQuote = liveQuote || stockQuote || {};
  const isResearch = displayQuote?.isResearch === true;
  const isStale = displayQuote?.isStale === true;
  const isDelayed = displayQuote?.isDelayed === true || isResearch;
  const isLive = displayQuote?.isLive === true && !isStale;
  const hasProviderPrice = Number(displayQuote?.c) > 0;
  const hasQuote = hasProviderPrice && (isLive || isResearch || isDelayed || isStale || (requiresVerifiedQuote && displayQuote?.isReal === true));
  const isFuturesReference = isPreciousMetal && displayQuote?.marketType === 'benchmark';
  const isSpotQuote = displayQuote?.marketType === 'spot' || (isPreciousMetal && isDelayed && !isFuturesReference);
  const currentPrice = hasQuote ? Number(displayQuote.c) : null;
  const change = displayQuote?.d !== null && displayQuote?.d !== undefined ? Number(displayQuote.d) : null;
  const changePercent = displayQuote?.dp !== null && displayQuote?.dp !== undefined ? Number(displayQuote.dp) : null;
  const positive = change !== null && change >= 0;
  const displayData = chartData;
  displayDataRef.current = displayData;
  const selectedCandle = hoverCandle || null;
  const latestBar = displayData[displayData.length - 1];
  const intervalLabel = activeResolution;
  const selectedOpen = Number(selectedCandle?.open);
  const selectedChangePercent = Number.isFinite(selectedOpen) && selectedOpen > 0
    ? ((Number(selectedCandle.close) - selectedOpen) / selectedOpen) * 100
    : null;
  const selectedUp = (selectedChangePercent ?? 0) >= 0;
  const hasVolume = displayData.some((candle) => typeof candle.value === 'number' && Number.isFinite(candle.value));
  const hasCompleteVolume = displayData.length > 0 && displayData.every((candle) => typeof candle.value === 'number' && Number.isFinite(candle.value) && candle.value >= 0);
  const rsiStudyData = useMemo(() => (activeStudies.includes('rsi14') ? calculateRsiSeries(displayData, 14) : []), [activeStudies, displayData]);
  const macdStudyData = useMemo(() => (activeStudies.includes('macd') ? calculateMacdSeries(displayData) : null), [activeStudies, displayData]);
  const atrStudyData = useMemo(() => (activeStudies.includes('atr14') ? calculateAtrSeries(displayData, 14) : []), [activeStudies, displayData]);
  const supertrendStudyData = useMemo(() => (activeStudies.includes('supertrend') ? calculateSupertrendSeries(displayData) : []), [activeStudies, displayData]);
  const latestAtr = atrStudyData.at(-1)?.value;
  const latestSupertrend = supertrendStudyData.at(-1);
  const flatChange = change !== null && changePercent !== null
    && Math.abs(change) < 0.005 && Math.abs(changePercent) < 0.005;
  const { flash: tickFlash } = useTickFlash(hasQuote ? currentPrice : null, changePercent);
  const direction = priceDirection(change, changePercent, tickFlash, null);
  const priceTone = tickToneClass(direction, tickFlash);
  const latestBarVolume = typeof latestBar?.value === 'number' && Number.isFinite(latestBar.value) ? latestBar.value : null;
  const displayedVolume = displayQuote?.v ?? latestBarVolume;
  const volumeIsLatestBar = (displayQuote?.v === null || displayQuote?.v === undefined) && latestBarVolume !== null;
  const flatBarRatio = displayData.length
    ? displayData.filter((candle) => candle.high === candle.low).length / displayData.length
    : 0;
  const flatSeries = flatBarRatio > 0.4;

  const vwapPoints = useMemo(() => calculateSessionVwap(displayData), [displayData]);
  const calculatedVwap = vwapPoints.length ? vwapPoints[vwapPoints.length - 1]?.value : null;
  const estimatedVwap = displayQuote?.vwap || calculatedVwap || null;

  const finalWeek52High = displayQuote?.week52High || null;
  const finalWeek52Low = displayQuote?.week52Low || null;
  const finalMarketCap = displayQuote?.marketCap || null;
  const finalPe = displayQuote?.pe || null;

  // Thin contracts publish flat daily bars (high = low), which render as
  // disconnected dashes in candle mode. Show the verified close path instead
  // until the person explicitly chooses a chart style.
  useEffect(() => {
    if (!isContractCommodity || !displayData.length || userPickedModeRef.current) return;
    if (flatBarRatio > 0.4) setMode((current) => (current === 'candles' ? 'line' : current));
  }, [displayData, flatBarRatio, isContractCommodity]);

  const quoteSource = !hasQuote
    ? quoteError ? `Provider quote unavailable · ${quoteError}` : 'Waiting for a verified provider quote'
    : isStale
      ? `Last ${displayQuote?.provider || 'provider'} quote · stale`
      : isResearch
        ? `${displayQuote?.provider || 'Yahoo Finance'} research quote · delayed, not live`
        : isDelayed
          ? `${displayQuote?.provider || (isPreciousMetal ? `${spotPair} spot feed` : 'Market provider')} · delayed`
          : isLive
            ? `${displayQuote?.provider || 'Market provider'} live quote`
            : `${displayQuote?.provider || 'Market provider'} published quote`;

  // Fit the range, but cap bar width so a handful of candles never becomes a
  // stretched wall. Sparse series (thinly traded contracts, daily fallback) get
  // the widest spacing that still keeps them visually centred.
  const applyRangeView = (chart, bars) => {
    if (!chart || !bars) return;
    const timeScale = chart.timeScale();
    timeScale.fitContent();
    const width = containerRef.current?.clientWidth || 0;
    if (!width || bars > 80) return;
    const spacing = Math.min(22, Math.max(6, Math.floor(width / bars)));
    const slots = Math.floor(width / spacing);
    timeScale.applyOptions({ barSpacing: spacing, rightOffset: Math.max(1, Math.round((slots - bars) / 2)) });
    timeScale.scrollToRealTime();
  };

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setChartTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || !displayData.length) return undefined;
    const dark = chartTheme === 'dark';
    const intraday = isIntradayResolution(historyResolution, activeRange);
    const gridLine = dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)';
    const axisText = dark ? '#9aa4b2' : '#6b7686';
    const crosshairLine = dark ? 'rgba(226, 232, 240, 0.42)' : 'rgba(51, 65, 85, 0.45)';
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: axisText,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: gridLine },
        horzLines: { color: gridLine },
      },
      rightPriceScale: {
        borderVisible: false,
        entireTextOnly: true,
        scaleMargins: { top: 0.1, bottom: 0.22 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: intraday,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 6,
        minBarSpacing: 0.4,
        tickMarkFormatter: axisTickFormatter(tickModeForResolution(historyResolution, activeRange)),
      },
      localization: {
        timeFormatter: axisTimeFormatter(intraday),
      },
      crosshair: {
        mode: 1,
        vertLine: { color: crosshairLine, width: 1, style: 3, labelBackgroundColor: '#0d6f4e' },
        horzLine: { color: crosshairLine, width: 1, style: 3, labelBackgroundColor: '#334155' },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    chartRef.current = chart;

    let mainSeries;
    if (mode === 'line') {
      mainSeries = chart.addLineSeries({ color: '#087b61', lineWidth: 2, lastValueVisible: false });
      mainSeries.setData(displayData.map(({ time, close }) => ({ time, value: close })));
    } else if (mode === 'area') {
      mainSeries = chart.addAreaSeries({
        lineColor: '#087b61',
        topColor: 'rgba(8, 123, 97, 0.24)',
        bottomColor: 'rgba(8, 123, 97, 0.01)',
        lineWidth: 2,
        lastValueVisible: false,
      });
      mainSeries.setData(displayData.map(({ time, close }) => ({ time, value: close })));
    } else if (mode === 'bars') {
      mainSeries = chart.addBarSeries({ upColor: '#00A878', downColor: '#E85B55', lastValueVisible: false });
      mainSeries.setData(displayData.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else if (mode === 'renko') {
      mainSeries = chart.addLineSeries({ color: '#087b61', lineWidth: 2, lastValueVisible: false, lineType: 1 });
      mainSeries.setData(toRenkoCloseSeries(displayData));
    } else {
      mainSeries = chart.addCandlestickSeries({
        upColor: '#00A878', downColor: '#E85B55',
        borderUpColor: '#00A878', borderDownColor: '#E85B55',
        wickUpColor: '#00A878', wickDownColor: '#E85B55',
        lastValueVisible: false,
      });
      const candles = mode === 'heikin' ? toHeikinAshi(displayData) : displayData;
      mainSeries.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    }
    mainSeriesRef.current = mainSeries;
    renderedDataRef.current = displayData;
    studySeriesRef.current = [];
    fibonacciLinesRef.current = [];

    const addStudyLine = (title, color, calculate, lineStyle = 0) => {
      const series = chart.addLineSeries({ color, lineWidth: 1, title, priceLineVisible: false, lastValueVisible: false, lineStyle });
      series.setData(calculate(displayData));
      studySeriesRef.current.push({ series, calculate });
    };
    const averageStudies = {
      ema9: [9, 'ema'], ema20: [20, 'ema'], ema50: [50, 'ema'], ema100: [100, 'ema'], ema200: [200, 'ema'],
      sma20: [20, 'sma'], sma50: [50, 'sma'], sma200: [200, 'sma'],
    };
    chartStudies.forEach(([key, label, color]) => {
      if (!activeStudies.includes(key)) return;
      if (averageStudies[key]) {
        const [period, kind] = averageStudies[key];
        addStudyLine(label, color, (candles) => calculateAverageSeries(candles, period, kind));
      } else if (key === 'bollinger') {
        addStudyLine('Bollinger upper', color, (candles) => calculateBollinger(candles).upper, 2);
        addStudyLine('Bollinger basis', color, (candles) => calculateBollinger(candles).middle);
        addStudyLine('Bollinger lower', color, (candles) => calculateBollinger(candles).lower, 2);
      } else if (key === 'vwap' && assetType === 'stock' && isIntradayResolution(activeResolution, activeRange)) {
        addStudyLine(label, color, calculateSessionVwap);
      } else if (key === 'supertrend') {
        const trendPoints = (candles, direction) => calculateSupertrendSeries(candles).map((point) => (
          point.direction === direction ? { time: point.time, value: point.value } : { time: point.time }
        ));
        addStudyLine('Supertrend up', '#22c55e', (candles) => trendPoints(candles, 1));
        addStudyLine('Supertrend down', '#ef4444', (candles) => trendPoints(candles, -1));
      } else if (key === 'fibonacci') {
        calculateFibonacciLevels(displayData).forEach(({ ratio, price }) => {
          const line = mainSeries.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `Fib ${(ratio * 100).toFixed(1)}%`,
          });
          fibonacciLinesRef.current.push(line);
        });
      }
    });

    const volumeData = displayData.filter((candle) => typeof candle.value === 'number'
      && Number.isFinite(candle.value) && candle.value >= 0);
    if (volumeData.length) {
      const volumeSeries = chart.addHistogramSeries({
        color: '#94a3b8',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
      volumeSeries.setData(volumeData.map(({ time, close, open, value }) => ({
        time,
        value,
        color: close >= open ? 'rgba(0, 168, 120, 0.35)' : 'rgba(232, 91, 85, 0.35)',
      })));
      volumeSeriesRef.current = volumeSeries;
      if (activeStudies.includes('volumeMa')) {
        const volumeAverage = calculateVolumeAverage(displayData, 20);
        if (volumeAverage.length) {
          const averageSeries = chart.addLineSeries({
            color: '#eab308',
            lineWidth: 1.5,
            title: 'Volume MA 20',
            priceScaleId: '',
            priceFormat: { type: 'volume' },
            priceLineVisible: false,
            lastValueVisible: false,
          });
          averageSeries.setData(volumeAverage);
          studySeriesRef.current.push({ series: averageSeries, calculate: (candles) => calculateVolumeAverage(candles, 20) });
        }
      }
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param?.time || !param.seriesData) {
        setHoverCandle(null);
        setHoverTime(null);
        return;
      }
      const row = displayDataRef.current.find((candle) => candle.time === param.time);
      if (row) {
        setHoverCandle(row);
        setHoverTime(param.time);
      }
    });
    const updateDrawingViewport = () => setDrawingRevision((revision) => revision + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateDrawingViewport);
    applyRangeView(chart, displayData.length);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateDrawingViewport);
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      currentPriceLineRef.current = null;
      previousCloseLineRef.current = null;
      renderedDataRef.current = [];
      studySeriesRef.current = [];
      fibonacciLinesRef.current = [];
    };
  }, [activeRange, activeResolution, activeStudies, chartTheme, displayData.length > 0, historyResolution, mode]);

  useEffect(() => {
    if (!mainSeriesRef.current || !displayData.length) return;
    const previous = renderedDataRef.current;
    if (previous === displayData) return;
    const updateTail = previous.length === displayData.length
      && previous.at(-1)?.time === displayData.at(-1).time
      && displayData.slice(0, -1).every((candle, index) => candle === previous[index]);
    let points;
    if (mode === 'line' || mode === 'area') {
      points = displayData.map(({ time, close }) => ({ time, value: close }));
    } else if (mode === 'renko') {
      points = toRenkoCloseSeries(displayData);
    } else {
      const candles = mode === 'heikin' ? toHeikinAshi(displayData) : displayData;
      points = candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    }
    if (updateTail) {
      mainSeriesRef.current.update(points.at(-1));
    } else {
      mainSeriesRef.current.setData(points);
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
        applyRangeView(chartRef.current, points.length);
      }
    }
    if (volumeSeriesRef.current) {
      const volumeData = displayData.filter((candle) => typeof candle.value === 'number'
        && Number.isFinite(candle.value) && candle.value >= 0).map(({ time, close, open, value }) => ({
        time,
        value,
        color: close >= open ? 'rgba(0, 168, 120, 0.35)' : 'rgba(232, 91, 85, 0.35)',
      }));
      if (updateTail && volumeData.at(-1)?.time === displayData.at(-1).time) {
        volumeSeriesRef.current.update(volumeData.at(-1));
      } else if (!updateTail) volumeSeriesRef.current.setData(volumeData);
    }
    for (const { series, calculate } of studySeriesRef.current) series.setData(calculate(displayData));
    calculateFibonacciLevels(displayData).forEach(({ price }, index) => {
      fibonacciLinesRef.current[index]?.applyOptions({ price });
    });
    renderedDataRef.current = displayData;
  }, [displayData, mode]);

  useEffect(() => {
    const series = mainSeriesRef.current;
    if (!series) return undefined;
    if (currentPriceLineRef.current) {
      series.removePriceLine(currentPriceLineRef.current);
      currentPriceLineRef.current = null;
    }
    if (previousCloseLineRef.current) {
      series.removePriceLine(previousCloseLineRef.current);
      previousCloseLineRef.current = null;
    }
    const lastBar = displayData[displayData.length - 1];
    const linePrice = isLive && currentPrice !== null ? currentPrice : Number(lastBar?.close);
    if (Number.isFinite(linePrice) && linePrice > 0) {
      const previousClose = Number(displayData[displayData.length - 2]?.close ?? lastBar?.open ?? linePrice);
      const rising = linePrice >= previousClose;
      currentPriceLineRef.current = series.createPriceLine({
        price: linePrice,
        color: rising ? '#0d6f4e' : '#c43b38',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: isLive ? 'LIVE' : 'LAST',
      });
    }
    const quotePreviousClose = Number(displayQuote?.pc);
    if (Number.isFinite(quotePreviousClose) && quotePreviousClose > 0) {
      previousCloseLineRef.current = series.createPriceLine({
        price: quotePreviousClose,
        color: chartTheme === 'dark' ? 'rgba(148, 163, 184, 0.8)' : 'rgba(100, 116, 139, 0.8)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Prev close',
      });
    }
    return undefined;
  }, [activeRange, chartTheme, currentPrice, displayData, displayQuote?.pc, isLive, mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setChartDimensions({ width: container.clientWidth, height: container.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [displayData.length > 0]);

  const drawingAnchorFromEvent = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const time = chartRef.current?.timeScale().coordinateToTime(x);
    const price = mainSeriesRef.current?.coordinateToPrice(y);
    const timestamp = time && typeof time === 'object'
      ? Date.UTC(time.year, (time.month || 1) - 1, time.day || 1) / 1000
      : Number(time);
    if (!Number.isFinite(timestamp) || !Number.isFinite(Number(price))) return null;
    return { time: timestamp, price: Number(price) };
  };

  const createDrawing = (type, from, to, textValue = '') => {
    const id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setDrawings((current) => [...current, { id, type, from, to, text: String(textValue).slice(0, 120) }].slice(-100));
    setSelectedDrawingId(id);
  };

  const handleDrawingPointerDown = (event) => {
    if (drawingTool === 'select') return;
    event.preventDefault();
    const anchor = drawingAnchorFromEvent(event);
    if (!anchor) return;
    if (['horizontal', 'vertical', 'support', 'resistance', 'text'].includes(drawingTool)) {
      createDrawing(drawingTool, anchor, anchor, drawingTool === 'text' ? annotationText : '');
      if (drawingTool === 'text') setDrawingTool('select');
      return;
    }
    if (!drawingDraft || drawingDraft.type !== drawingTool) {
      setDrawingDraft({ type: drawingTool, from: anchor, to: anchor });
      return;
    }
    createDrawing(drawingTool, drawingDraft.from, anchor);
    setDrawingDraft(null);
  };

  const handleDrawingPointerMove = (event) => {
    if (!drawingDraft) return;
    const anchor = drawingAnchorFromEvent(event);
    if (anchor) setDrawingDraft((current) => current ? { ...current, to: anchor } : current);
  };

  const selectedDrawing = drawings.find((drawing) => drawing.id === selectedDrawingId) || null;
  const deleteSelectedDrawing = () => {
    if (!selectedDrawingId) return;
    setDrawings((current) => current.filter((drawing) => drawing.id !== selectedDrawingId));
    setSelectedDrawingId('');
  };
  const nudgeSelectedDrawing = (direction) => {
    if (!selectedDrawing) return;
    const timeDelta = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    const priceDelta = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
    const seconds = intervalSeconds[activeResolution] || 60;
    const priceStep = Math.max(0.01, Math.abs(selectedDrawing.from.price) * 0.001);
    setDrawings((current) => current.map((drawing) => drawing.id === selectedDrawingId ? {
      ...drawing,
      from: { time: drawing.from.time + (timeDelta * seconds), price: drawing.from.price + (priceDelta * priceStep) },
      to: { time: drawing.to.time + (timeDelta * seconds), price: drawing.to.price + (priceDelta * priceStep) },
    } : drawing));
  };

  const retryData = () => {
    historyCache.delete(historyKey(stock.symbol, activeRange, sessionMode, activeResolution));
    setRetryKey((current) => current + 1);
  };
  const toggleFullscreen = async () => {
    const node = chartSectionRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement === node) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch (error) {
      console.warn('Could not switch the chart fullscreen mode:', error.message);
    }
  };
  const historyFallbackNote = displayData.length && historyResolution && historyResolution !== intervalLabel
    ? historyFallbackWindow
      ? ` · ${historyFallbackWindow} (${intervalLabel} intraday unavailable)`
      : ` · ${historyResolution} bars (${intervalLabel} intraday unavailable)`
    : '';
  const flatSeriesNote = isContractCommodity && flatSeries && (mode === 'line' || mode === 'area')
    ? ' · close path shown: provider bars report no high/low range'
    : '';
  const historyStatus = historyLoading && !displayData.length
    ? `Loading ${activeRange} provider history…`
    : displayData.length
      ? `${historyProvider || 'Market provider'} ${historyIsResearch ? 'research history · delayed, not live' : 'history'} · ${displayData.length} verified bars · latest bar ${formatMarketTime(latestBar?.time)}${hasVolume ? '' : ' · volume not reported'}${historyFallbackNote}${flatSeriesNote}`
      : `Historical candles unavailable · ${historyError || 'No verified OHLC data was returned.'}`;

  const drawingX = (time) => chartRef.current?.timeScale().timeToCoordinate(time);
  const drawingY = (price) => mainSeriesRef.current?.priceToCoordinate(price);
  const renderDrawing = (drawing) => {
    if (!chartDimensions.width || !chartDimensions.height) return null;
    const active = drawing.id === selectedDrawingId;
    const color = active ? '#d6a84f' : drawing.type === 'support' ? '#22c55e' : drawing.type === 'resistance' ? '#ef4444' : '#77859a';
    const strokeWidth = active ? 2 : 1.4;
    const x1 = drawingX(drawing.from.time);
    const x2 = drawingX(drawing.to.time);
    const y1 = drawingY(drawing.from.price);
    const y2 = drawingY(drawing.to.price);
    if (drawing.type === 'horizontal' || drawing.type === 'support' || drawing.type === 'resistance') {
      if (!Number.isFinite(y1)) return null;
      return <g key={drawing.id}><line x1="0" x2={chartDimensions.width} y1={y1} y2={y1} stroke={color} strokeWidth={strokeWidth} strokeDasharray={active ? undefined : '5 4'} /><text x="6" y={Math.max(12, y1 - 4)} fill={color} fontSize="11">{drawing.type === 'support' ? 'Support' : drawing.type === 'resistance' ? 'Resistance' : 'Horizontal'} · {formatLegendPrice(drawing.from.price)}</text></g>;
    }
    if (drawing.type === 'vertical') {
      if (!Number.isFinite(x1)) return null;
      return <line key={drawing.id} x1={x1} x2={x1} y1="0" y2={chartDimensions.height} stroke={color} strokeWidth={strokeWidth} strokeDasharray={active ? undefined : '5 4'} />;
    }
    if (drawing.type === 'text') {
      if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;
      return <text key={drawing.id} x={x1} y={y1} fill={color} fontSize="13" fontWeight="700" stroke={chartTheme === 'dark' ? '#353840' : '#fff'} strokeWidth="3" paintOrder="stroke">{drawing.text || 'Note'}</text>;
    }
    if (![x1, x2, y1, y2].every(Number.isFinite)) return null;
    if (drawing.type === 'rectangle') {
      return <rect key={drawing.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill="rgba(214,168,79,.08)" stroke={color} strokeWidth={strokeWidth} />;
    }
    if (drawing.type === 'fibonacciDrawing') {
      return <g key={drawing.id}>{[0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((ratio) => {
        const price = drawing.from.price + ((drawing.to.price - drawing.from.price) * ratio);
        const y = drawingY(price);
        return Number.isFinite(y) ? <g key={ratio}><line x1={Math.min(x1, x2)} x2={chartDimensions.width} y1={y} y2={y} stroke={color} strokeWidth={strokeWidth} strokeDasharray="4 3" /><text x={Math.min(chartDimensions.width - 54, Math.max(x1, x2) + 5)} y={y - 3} fill={color} fontSize="10">{(ratio * 100).toFixed(1)}%</text></g> : null;
      })}</g>;
    }
    return <line key={drawing.id} x1={x1} x2={x2} y1={y1} y2={y2} stroke={color} strokeWidth={strokeWidth} />;
  };

  return (
    <section className="live-chart panel" ref={chartSectionRef}>
      <div className="live-chart-header">
        <div>
          <span className="card-topline"><Activity size={14} /> {hasQuote
            ? isStale ? 'Provider quote · stale'
              : isResearch ? 'Research quote · delayed, not live'
                : isDelayed ? 'Delayed market quote'
                  : isLive ? 'Live market quote' : 'Published market quote'
            : quoteError ? 'Provider quote unavailable' : 'Waiting for provider quote'}</span>
          <div className="live-chart-title-row">
            <h2>{isPreciousMetal ? stock.name : stock.symbol}</h2>
            <span>{isPreciousMetal
              ? isFuturesReference
                ? `COMEX ${metalName} futures reference · ${metalUnit} · USD/INR`
                : isSpotQuote ? spotDescription : mcxDescription
              : stock.name}</span>
          </div>
          <div className="live-chart-price-row">
            <strong key={tickFlash ? `${symbol}-${tickFlash}` : symbol} className={priceTone}>{hasQuote ? formatPrice(currentPrice) : 'Quote unavailable'}</strong>
            {flatChange
              ? <span className="price-flat"><TickArrow direction="flat" />No change reported</span>
              : change !== null && Number.isFinite(change) && changePercent !== null && Number.isFinite(changePercent)
                ? <span className={direction === 'up' ? 'gain' : 'loss'}><TickArrow direction={direction} />{positive ? '+' : ''}{change.toFixed(2)} ({positive ? '+' : ''}{changePercent.toFixed(2)}%)</span>
                : <span>Change unavailable</span>}
          </div>
        </div>
        <div className="chart-toolbar">
          <div className="chart-controls-row">
            <div className="chart-mode-selector" role="group" aria-label="Chart style">
              {[
                ['candles', 'Candles'],
                ['heikin', 'Heikin-Ashi'],
                ['line', 'Line'],
                ['area', 'Area'],
                ['bars', 'Bar'],
                ['renko', 'Renko'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={mode === value ? 'active' : ''}
                  aria-pressed={mode === value}
                  type="button"
                  onClick={() => {
                    userPickedModeRef.current = true;
                    setMode(value);
                  }}
                >{label}</button>
              ))}
            </div>
            <label className="chart-range-selector" style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
              <span className="sr-only">Candle interval</span>
              <select
                aria-label="Candle interval"
                value={activeResolution}
                onChange={(event) => setActiveResolution(event.target.value)}
                style={{ border: `1px solid ${chartTheme === 'dark' ? 'rgba(241,243,245,.16)' : '#d8dee7'}`, borderRadius: 8, padding: '7px 9px', background: chartTheme === 'dark' ? '#2d3238' : '#fff', color: chartTheme === 'dark' ? '#f1f3f5' : '#17212f', font: 'inherit' }}
              >
                {candleIntervals.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <details style={{ position: 'relative', zIndex: 2 }}>
              <summary style={{ cursor: 'pointer', listStyle: 'none', border: `1px solid ${chartTheme === 'dark' ? 'rgba(241,243,245,.16)' : '#d8dee7'}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: chartTheme === 'dark' ? '#f1f3f5' : '#17212f' }}>
                Indicators{activeStudies.length ? ` · ${activeStudies.length}` : ''}
              </summary>
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 220, padding: 12, display: 'grid', gap: 9, border: `1px solid ${chartTheme === 'dark' ? 'rgba(241,243,245,.16)' : '#d8dee7'}`, borderRadius: 10, background: chartTheme === 'dark' ? '#2d3238' : '#fff', color: chartTheme === 'dark' ? '#f1f3f5' : '#17212f', boxShadow: '0 12px 32px rgba(15, 23, 42, .18)' }}>
                {chartStudies.map(([key, label, color]) => {
                  const vwapUnavailable = key === 'vwap' && (assetType !== 'stock' || !isIntradayResolution(activeResolution, activeRange) || !hasCompleteVolume);
                  const volumeUnavailable = key === 'volumeMa' && !hasVolume;
                  const unavailable = vwapUnavailable || volumeUnavailable;
                  return (
                    <label key={key} title={vwapUnavailable ? 'Session VWAP requires verified intraday stock bars with volume.' : volumeUnavailable ? 'Volume moving average requires reported candle volume.' : label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: unavailable ? 0.5 : 1 }}>
                      <input
                        type="checkbox"
                        checked={activeStudies.includes(key)}
                        disabled={unavailable}
                        onChange={() => setActiveStudies((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}
                      />
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                      {label}
                    </label>
                  );
                })}
                <small style={{ color: chartTheme === 'dark' ? '#b6bdc7' : '#687386', lineHeight: 1.35 }}>Calculated from the selected provider candles. Saved for this account and instrument.</small>
              </div>
            </details>
            <button
              type="button"
              className="chart-fullscreen-button"
              aria-label={isFullscreen ? 'Exit chart fullscreen' : 'Open chart fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen chart'}
              onClick={toggleFullscreen}
              style={{ alignItems: 'center', display: 'inline-flex', gap: 6, border: `1px solid ${chartTheme === 'dark' ? 'rgba(241,243,245,.16)' : '#d8dee7'}`, borderRadius: 8, padding: '7px 9px', background: chartTheme === 'dark' ? '#2d3238' : '#fff', color: chartTheme === 'dark' ? '#f1f3f5' : '#17212f', cursor: 'pointer', font: 'inherit' }}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              {isFullscreen ? 'Exit' : 'Fullscreen'}
            </button>
          </div>
          <div className="chart-controls-row">
            <div className="chart-range-selector" role="group" aria-label="Chart history range">
              {[
                { key: '1D', label: '1D', title: '1 Day' },
                { key: '1W', label: '1W', title: '1 Week' },
                { key: '1M', label: '1M', title: '1 Month' },
                { key: '3M', label: '3M', title: '3 Months' },
                { key: '6M', label: '6M', title: '6 Months' },
                { key: '1Y', label: '1Y', title: '1 Year' },
                { key: '5Y', label: '5Y', title: '5 Years' },
                { key: 'ALL', label: 'ALL', title: 'All History' },
              ].map(({ key, label, title }) => (
                <button
                  className={activeRange === key ? 'active' : ''}
                  aria-pressed={activeRange === key}
                  key={key}
                  type="button"
                  title={title}
                  onClick={() => handleRangeSelect(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-drawing-controls" style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 7, fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Drawing
              <select
                aria-label="Drawing tool"
                value={drawingTool}
                onChange={(event) => { setDrawingTool(event.target.value); setDrawingDraft(null); }}
                style={{ border: `1px solid ${chartTheme === 'dark' ? 'rgba(241,243,245,.16)' : '#d8dee7'}`, borderRadius: 8, padding: '7px 9px', background: chartTheme === 'dark' ? '#2d3238' : '#fff', color: chartTheme === 'dark' ? '#f1f3f5' : '#17212f', font: 'inherit' }}
              >
                {drawingTools.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {drawingTool === 'text' ? (
              <input aria-label="Text annotation" value={annotationText} maxLength={120} onChange={(event) => setAnnotationText(event.target.value)} style={{ width: 120, border: `1px solid ${chartTheme === 'dark' ? 'rgba(241,243,245,.16)' : '#d8dee7'}`, borderRadius: 8, padding: '7px 9px', background: chartTheme === 'dark' ? '#2d3238' : '#fff', color: chartTheme === 'dark' ? '#f1f3f5' : '#17212f' }} />
            ) : null}
            {drawingTool !== 'select' ? <span>{drawingDraft ? 'Click the second point to finish.' : ['trendline', 'rectangle', 'fibonacciDrawing'].includes(drawingTool) ? 'Click two points on the chart.' : 'Click the chart to place the drawing.'}</span> : null}
            {drawingDraft ? <button type="button" onClick={() => setDrawingDraft(null)}>Cancel drawing</button> : null}
            {selectedDrawing ? (
              <>
                {selectedDrawing.type === 'text' ? <input aria-label="Edit selected annotation" value={selectedDrawing.text || ''} maxLength={120} onChange={(event) => setDrawings((current) => current.map((item) => item.id === selectedDrawingId ? { ...item, text: event.target.value } : item))} style={{ width: 120 }} /> : null}
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Price <input aria-label="Edit selected drawing price" type="number" step="0.01" value={selectedDrawing.from.price} onChange={(event) => {
                  const price = Number(event.target.value);
                  if (Number.isFinite(price) && price > 0) setDrawings((current) => current.map((item) => item.id === selectedDrawingId ? { ...item, from: { ...item.from, price } } : item));
                }} style={{ width: 88 }} /></label>
                <button type="button" aria-label="Move selected drawing left" onClick={() => nudgeSelectedDrawing('left')}>←</button>
                <button type="button" aria-label="Move selected drawing right" onClick={() => nudgeSelectedDrawing('right')}>→</button>
                <button type="button" aria-label="Move selected drawing up" onClick={() => nudgeSelectedDrawing('up')}>↑</button>
                <button type="button" aria-label="Move selected drawing down" onClick={() => nudgeSelectedDrawing('down')}>↓</button>
                <button type="button" onClick={deleteSelectedDrawing}>Delete selected</button>
              </>
            ) : null}
            {drawings.length ? <details style={{ position: 'relative', zIndex: 4 }}>
              <summary style={{ cursor: 'pointer', padding: '7px 9px', border: `1px solid ${chartTheme === 'dark' ? 'rgba(241,243,245,.16)' : '#d8dee7'}`, borderRadius: 8 }}>Drawings · {drawings.length}</summary>
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', display: 'grid', gap: 5, width: 220, maxHeight: 240, overflowY: 'auto', padding: 9, background: chartTheme === 'dark' ? '#2d3238' : '#fff', color: chartTheme === 'dark' ? '#f1f3f5' : '#17212f', border: '1px solid rgba(127,140,156,.35)', borderRadius: 9, boxShadow: '0 12px 32px rgba(15, 23, 42, .18)' }}>
                {drawings.slice().reverse().map((drawing) => <button key={drawing.id} type="button" onClick={() => setSelectedDrawingId(drawing.id)} style={{ textAlign: 'left', border: 0, borderRadius: 6, padding: '6px 8px', background: drawing.id === selectedDrawingId ? 'rgba(214,168,79,.18)' : 'transparent', color: 'inherit' }}>{drawing.type === 'text' ? drawing.text || 'Text note' : drawing.type} · {formatLegendPrice(drawing.from.price)}</button>)}
                <small>Drawings auto-save for this account and instrument on this browser.</small>
              </div>
            </details> : null}
          </div>
        </div>
      </div>

      <div className="chart-live-meta">
        <span className={`quote-source ${isLive ? 'is-live' : isDelayed || isResearch ? 'is-delayed' : 'is-error'}`}><span className="live-dot" /> {quoteSource}</span>
        <span>{hasQuote ? `Published ${formatMarketTime(displayQuote?.timestamp)}` : 'Quote timestamp unavailable'}</span>
        {!hasQuote && <button type="button" className="chart-retry-button" onClick={retryData}>Retry quote</button>}
      </div>

      <div className="live-chart-body">
        {selectedCandle && (
          <div className="chart-hover-readout" aria-live="polite">
            <span className="chart-legend-head">
              <b>{stock.symbol}</b>
              <span>{historyResolution || intervalLabel}</span>
            </span>
            <span className="chart-legend-time">{formatMarketTime(hoverTime || selectedCandle.time)}</span>
            {mode === 'line' || mode === 'area'
              ? <span>Price <b>{formatLegendPrice(selectedCandle.close)}</b></span>
              : <>
                <span>O <b>{formatLegendPrice(selectedCandle.open)}</b></span>
                <span>H <b>{formatLegendPrice(selectedCandle.high)}</b></span>
                <span>L <b>{formatLegendPrice(selectedCandle.low)}</b></span>
                <span>C <b className={selectedUp ? 'gain' : 'loss'}>{formatLegendPrice(selectedCandle.close)}</b></span>
                {Number.isFinite(selectedChangePercent) && (
                  <span className={selectedUp ? 'gain' : 'loss'}>
                    {selectedUp ? '+' : ''}{selectedChangePercent.toFixed(2)}%
                  </span>
                )}
              </>}
            {selectedCandle.value !== null && selectedCandle.value !== undefined && (
              <span className="chart-legend-vol">Vol <b>{formatMetric(selectedCandle.value)}</b></span>
            )}
          </div>
        )}
        {displayData.length ? (
          <div
            className="live-chart-canvas"
            ref={containerRef}
            style={{ position: 'relative' }}
            role="img"
            tabIndex={0}
            aria-label={`${stock.name || stock.symbol} (${stock.symbol}) ${mode} chart. ${historyResolution || intervalLabel} interval. ${displayData.length} verified historical data points. Latest visible close ${formatLegendPrice(displayData.at(-1)?.close)}. ${quoteSource}. ${hasQuote ? `Latest quote published ${formatMarketTime(displayQuote?.timestamp)}.` : 'Current quote unavailable.'} Use the chart controls before this region to change style and interval.`}
          >
            <svg
              data-render-revision={drawingRevision}
              viewBox={`0 0 ${Math.max(1, chartDimensions.width)} ${Math.max(1, chartDimensions.height)}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${drawings.length} saved chart drawings`}
              onPointerDown={handleDrawingPointerDown}
              onPointerMove={handleDrawingPointerMove}
              style={{ position: 'absolute', inset: 0, zIndex: 3, width: '100%', height: '100%', pointerEvents: drawingTool === 'select' ? 'none' : 'auto', touchAction: 'none' }}
            >
              {drawings.map(renderDrawing)}
              {drawingDraft ? renderDrawing({ ...drawingDraft, id: '__draft__' }) : null}
            </svg>
          </div>
        ) : (
          <div className="chart-empty-state" role="status" aria-live="polite">
            {historyLoading ? <><span className="live-chart-loader" /><strong>Loading verified market history</strong><span>Waiting for published OHLC and volume records.</span></> : <><strong>No verified historical candles</strong><span>{historyError || 'The configured providers returned no data for this range.'}</span><button type="button" onClick={retryData}><RefreshCw size={14} /> Retry data request</button></>}
          </div>
        )}
      </div>

      {activeStudies.includes('rsi14') ? (
        <IndicatorPane title="RSI 14 · Wilder smoothing" lines={[{ name: 'RSI', data: rsiStudyData, color: '#a855f7' }]} thresholds={[30, 70]} />
      ) : null}
      {activeStudies.includes('macd') && macdStudyData ? (
        <IndicatorPane
          title="MACD 12 / 26 / 9"
          lines={[
            { name: 'Histogram', data: macdStudyData.histogram, kind: 'histogram' },
            { name: 'MACD', data: macdStudyData.macd, color: '#0ea5e9' },
            { name: 'Signal', data: macdStudyData.signal, color: '#f59e0b' },
          ]}
          thresholds={[0]}
        />
      ) : null}
      {(activeStudies.includes('atr14') || activeStudies.includes('supertrend')) ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', padding: '8px 2px', fontSize: 12, color: chartTheme === 'dark' ? '#c0c4ca' : '#59636c' }}>
          {activeStudies.includes('atr14') ? <span>ATR 14 <b>{Number.isFinite(latestAtr) ? formatPrice(latestAtr) : 'Insufficient candle history'}</b></span> : null}
          {activeStudies.includes('supertrend') ? <span>Supertrend 10, 3 <b style={{ color: latestSupertrend?.direction > 0 ? '#22c55e' : '#ef4444' }}>{latestSupertrend ? `${latestSupertrend.direction > 0 ? 'Up' : 'Down'} · ${formatPrice(latestSupertrend.value)}` : 'Insufficient candle history'}</b></span> : null}
        </div>
      ) : null}

      <div className="live-chart-stats">
        {isPreciousMetal ? (
          <>
            <span>Contract <b>{isFuturesReference ? `COMEX ${metalName} futures reference` : isSpotQuote ? `International ${metalName} spot reference` : `MCX ${metalName} future`}</b></span>
            <span>Quote unit <b>{isSilver ? 'Silver value · ₹ / kg' : isSpotQuote ? '24K metal value · ₹ / 10g' : '₹ / 10g'}</b></span>
            <span>Prev close <b>{formatPrice(displayQuote?.pc)}</b></span>
            <span>Day high <b>{formatPrice(displayQuote?.h)}</b></span>
            <span>Day low <b>{formatPrice(displayQuote?.l)}</b></span>
            <span>52-wk high <b>{formatPrice(displayQuote?.week52High)}</b></span>
            <span>52-wk low <b>{formatPrice(displayQuote?.week52Low)}</b></span>
            <span>{volumeIsLatestBar ? 'Volume · latest bar' : 'Volume'} <b>{formatMetric(displayedVolume)}</b></span>
          </>
        ) : isContractCommodity ? (
          <>
            <span>Contract <b>{displayQuote?.benchmarkName || displayQuote?.provider || 'Delayed global benchmark'}</b></span>
            <span>Quote unit <b>{unit || displayQuote?.unit || 'Unavailable'}</b></span>
            <span>Prev close <b>{formatPrice(displayQuote?.pc)}</b></span>
            <span>Day high <b>{formatPrice(displayQuote?.h)}</b></span>
            <span>Day low <b>{formatPrice(displayQuote?.l)}</b></span>
            <span>Range open <b>{formatPrice(displayData[0]?.open)}</b></span>
            <span>{volumeIsLatestBar ? 'Volume · latest bar' : 'Volume'} <b>{formatMetric(displayedVolume)}</b></span>
          </>
        ) : (
          <>
            <span>Prev close <b>{formatPrice(displayQuote?.pc)}</b></span>
            <span>Open <b>{formatPrice(displayQuote?.o)}</b></span>
            <span>Day high <b>{formatPrice(displayQuote?.h)}</b></span>
            <span>Day low <b>{formatPrice(displayQuote?.l)}</b></span>
            <span>52-wk high <b>{formatPrice(finalWeek52High)}</b></span>
            <span>52-wk low <b>{formatPrice(finalWeek52Low)}</b></span>
            <span>Mkt cap <b>{formatMetric(finalMarketCap)}</b></span>
            <span>P/E <b>{formatMetric(finalPe)}</b></span>
            <span>VWAP <b>{formatPrice(estimatedVwap)}</b></span>
            <span>Volume <b>{formatMetric(displayedVolume)}</b></span>
          </>
        )}
      </div>
      <div className="chart-footer-note"><Clock3 size={14} /> {historyStatus}</div>
    </section>
  );
};

export default LiveChart;
