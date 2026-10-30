import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { BarChart2, TrendingUp, RefreshCw, SlidersHorizontal, Activity, Clock, Maximize2, Minimize2 } from 'lucide-react';

// Technical Indicator Helper: Calculate EMA
const calculateEMA = (candles, period) => {
  const k = 2 / (period + 1);
  const emaData = [];
  let ema = candles[0]?.close || 0;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    if (i === 0) {
      ema = close;
    } else {
      ema = close * k + ema * (1 - k);
    }
    emaData.push({
      time: candles[i].time,
      value: Number(ema.toFixed(2)),
    });
  }
  return emaData;
};

// Technical Indicator Helper: Calculate RSI (Relative Strength Index)
const calculateRSI = (candles, period = 14) => {
  if (candles.length < period + 1) return [];
  const rsiData = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  rsiData.push({ time: candles[period].time, value: Number(rsi.toFixed(2)) });

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = 100 - (100 / (1 + rs));
    rsiData.push({ time: candles[i].time, value: Number(rsi.toFixed(2)) });
  }

  return rsiData;
};

const timeframeIntervals = {
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '45m': 45 * 60,
  '1h': 60 * 60,
  '2h': 2 * 60 * 60,
  '4h': 4 * 60 * 60,
  '5h': 5 * 60 * 60,
  '1d': 24 * 60 * 60,
  '1w': 7 * 24 * 60 * 60,
  '1M': 30 * 24 * 60 * 60,
};

const createIllustrativeCandles = (symbol, timeframe, currentPrice) => {
  const count = 72;
  const secondsPerCandle = timeframeIntervals[timeframe] || 60;
  const now = Math.floor(Date.now() / 60) * 60;
  const hasLivePrice = Number(currentPrice) > 0;
  const anchor = hasLivePrice ? Number(currentPrice) : 100;
  const seed = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 0);
  let previous = anchor * 0.994;

  return Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    const wave = Math.sin(seed * 0.07 + index * 0.63) * 0.0035;
    const close = index === count - 1 && hasLivePrice
      ? anchor
      : anchor * (0.994 + progress * (1 - 0.994) + wave);
    const open = previous;
    const wick = Math.max(Math.max(open, close) * 0.0012, 0.01);
    previous = close;

    return {
      time: now - (count - 1 - index) * secondsPerCandle,
      open: Number(open.toFixed(2)),
      high: Number((Math.max(open, close) + wick).toFixed(2)),
      low: Number(Math.max(0.01, Math.min(open, close) - wick).toFixed(2)),
      close: Number(close.toFixed(2)),
      value: 0,
    };
  });
};

// Transformer Helper: Convert standard candles to Heikin-Ashi candles
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

// Transformer Helper: Renko Bricks (Fixed Box Size based on ATR/Price)
const toRenko = (candles) => {
  if (!candles.length) return [];
  const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
  const boxSize = Math.max(0.5, Number((avgPrice * 0.006).toFixed(2)));
  const bricks = [];
  let basePrice = Math.floor(candles[0].close / boxSize) * boxSize;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    while (c.close >= basePrice + boxSize) {
      bricks.push({
        time: c.time,
        open: basePrice,
        close: Number((basePrice + boxSize).toFixed(2)),
        high: Number((basePrice + boxSize).toFixed(2)),
        low: basePrice,
      });
      basePrice = Number((basePrice + boxSize).toFixed(2));
    }
    while (c.close <= basePrice - boxSize) {
      bricks.push({
        time: c.time,
        open: basePrice,
        close: Number((basePrice - boxSize).toFixed(2)),
        high: basePrice,
        low: Number((basePrice - boxSize).toFixed(2)),
      });
      basePrice = Number((basePrice - boxSize).toFixed(2));
    }
  }

  // Deduplicate timestamps for lightweight-charts
  const uniqueBricks = [];
  const seenTimes = new Set();
  for (let idx = 0; idx < bricks.length; idx++) {
    const b = bricks[idx];
    const time = seenTimes.has(b.time) ? b.time + idx : b.time;
    seenTimes.add(time);
    uniqueBricks.push({ ...b, time });
  }
  return uniqueBricks.length ? uniqueBricks : candles;
};

// Transformer Helper: Three Line Break
const toLineBreak = (candles, lineCount = 3) => {
  if (candles.length <= lineCount) return candles;
  const lines = [];
  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    if (lines.length < lineCount) {
      lines.push(current);
      continue;
    }
    const recent = lines.slice(-lineCount);
    const highestHigh = Math.max(...recent.map((l) => Math.max(l.open, l.close)));
    const lowestLow = Math.min(...recent.map((l) => Math.min(l.open, l.close)));
    const prevClose = lines[lines.length - 1].close;

    if (current.close > highestHigh) {
      lines.push({
        ...current,
        open: prevClose,
        high: current.close,
        low: prevClose,
        close: current.close,
      });
    } else if (current.close < lowestLow) {
      lines.push({
        ...current,
        open: prevClose,
        high: prevClose,
        low: current.close,
        close: current.close,
      });
    }
  }
  return lines.length >= 2 ? lines : candles;
};

// Transformer Helper: Kagi Chart Lines (Yang / Yin trend reversal threshold)
const toKagi = (candles, reversalPercent = 0.008) => {
  if (candles.length < 2) return candles;
  const kagi = [];
  let trend = 0; // 1 = up, -1 = down
  let peak = candles[0].close;
  let valley = candles[0].close;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const price = c.close;
    if (trend === 0) {
      if (price >= peak * (1 + reversalPercent)) {
        trend = 1;
        kagi.push({ ...c, open: valley, high: price, low: valley, close: price });
        peak = price;
      } else if (price <= valley * (1 - reversalPercent)) {
        trend = -1;
        kagi.push({ ...c, open: peak, high: peak, low: price, close: price });
        valley = price;
      }
    } else if (trend === 1) {
      if (price > peak) {
        peak = price;
        kagi.push({ ...c, open: valley, high: price, low: valley, close: price });
      } else if (price <= peak * (1 - reversalPercent)) {
        trend = -1;
        valley = price;
        kagi.push({ ...c, open: peak, high: peak, low: price, close: price });
      }
    } else if (trend === -1) {
      if (price < valley) {
        valley = price;
        kagi.push({ ...c, open: peak, high: peak, low: price, close: price });
      } else if (price >= valley * (1 + reversalPercent)) {
        trend = 1;
        peak = price;
        kagi.push({ ...c, open: valley, high: price, low: valley, close: price });
      }
    }
  }
  return kagi.length >= 2 ? kagi : candles;
};

// Transformer Helper: Point & Figure (X's and O's Columns formatted as candle blocks)
const toPointAndFigure = (candles) => {
  if (!candles.length) return candles;
  const avg = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
  const box = Math.max(0.5, Number((avg * 0.005).toFixed(2)));
  const pnf = [];
  let colType = 'X'; // X = up, O = down
  let lastBox = Math.floor(candles[0].close / box) * box;

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    if (colType === 'X') {
      if (price >= lastBox + box) {
        const newBox = Math.floor(price / box) * box;
        pnf.push({
          time: candles[i].time,
          open: lastBox,
          high: newBox,
          low: lastBox,
          close: newBox,
        });
        lastBox = newBox;
      } else if (price <= lastBox - 3 * box) {
        colType = 'O';
        const newBox = Math.floor(price / box) * box;
        pnf.push({
          time: candles[i].time,
          open: lastBox,
          high: lastBox,
          low: newBox,
          close: newBox,
        });
        lastBox = newBox;
      }
    } else {
      if (price <= lastBox - box) {
        const newBox = Math.floor(price / box) * box;
        pnf.push({
          time: candles[i].time,
          open: lastBox,
          high: lastBox,
          low: newBox,
          close: newBox,
        });
        lastBox = newBox;
      } else if (price >= lastBox + 3 * box) {
        colType = 'X';
        const newBox = Math.floor(price / box) * box;
        pnf.push({
          time: candles[i].time,
          open: lastBox,
          high: newBox,
          low: lastBox,
          close: newBox,
        });
        lastBox = newBox;
      }
    }
  }
  return pnf.length >= 2 ? pnf : candles;
};

const timeframeNames = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '45m': '45 minutes',
  '1h': '1 hour',
  '2h': '2 hours',
  '4h': '4 hours',
  '5h': '5 hours',
  '1d': '1 day',
  '1w': '1 week',
  '1M': '1 month',
};

const CandlestickChart = ({
  candles = [],
  currentPrice,
  symbol = 'STOCK',
  timeframe: selectedTimeframe,
  onTimeframeChange,
  isLoading = false,
  historyProvider,
  historyError = '',
  isDemoQuote = false,
  isLiveQuote = false,
  isStaleQuote = false,
}) => {
  const containerRef = useRef(null);
  const chartWrapperRef = useRef(null);
  const rsiContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const rsiChartInstanceRef = useRef(null);
  const currentPriceLineRef = useRef(null);
  const currentPriceRef = useRef(currentPrice);
  const currentPriceLabelRef = useRef('LIVE');
  currentPriceRef.current = currentPrice;
  currentPriceLabelRef.current = isDemoQuote ? 'DEMO' : isStaleQuote ? 'LAST' : 'LIVE';

  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localTimeframe, setLocalTimeframe] = useState('15m');
  const timeframe = selectedTimeframe || localTimeframe;
  const setTimeframe = (value) => {
    setLocalTimeframe(value);
    onTimeframeChange?.(value);
  };
  const toggleFullscreen = async () => {
    const wrapper = chartWrapperRef.current;
    if (!wrapper) return;
    try {
      if (document.fullscreenElement === wrapper) await document.exitFullscreen();
      else await wrapper.requestFullscreen();
    } catch (error) {
      console.warn('Could not switch the chart fullscreen mode:', error.message);
    }
  };
  const [chartType, setChartType] = useState('candles');
  const [hoverData, setHoverData] = useState(null);

  // Technical Indicator Toggles
  const [showEMA20, setShowEMA20] = useState(true);
  const [showEMA50, setShowEMA50] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [latestRSI, setLatestRSI] = useState(null);

  const verifiedData = useMemo(() => candles
    .filter((candle) => Number.isFinite(Number(candle.time))
      && Number.isFinite(Number(candle.open))
      && Number.isFinite(Number(candle.high))
      && Number.isFinite(Number(candle.low))
      && Number.isFinite(Number(candle.close)))
    .sort((first, second) => Number(first.time) - Number(second.time))
    .slice(-72), [candles]);
  const isIllustrative = verifiedData.length === 0;
  const baseData = useMemo(
    () => isIllustrative ? createIllustrativeCandles(symbol, timeframe, currentPrice) : verifiedData,
    [currentPrice, isIllustrative, symbol, timeframe, verifiedData],
  );

  // Keep provider candles unchanged; show the latest quote as its own price line.
  const displayData = baseData;

  // Compute Indicator series
  const ema20Data = useMemo(() => (showEMA20 && !isIllustrative ? calculateEMA(displayData, 20) : []), [displayData, isIllustrative, showEMA20]);
  const ema50Data = useMemo(() => (showEMA50 && !isIllustrative ? calculateEMA(displayData, 50) : []), [displayData, isIllustrative, showEMA50]);
  const rsiSeriesData = useMemo(() => (showRSI && !isIllustrative ? calculateRSI(displayData, 14) : []), [displayData, isIllustrative, showRSI]);

  useEffect(() => {
    if (rsiSeriesData.length) {
      setLatestRSI(rsiSeriesData[rsiSeriesData.length - 1].value);
    }
  }, [rsiSeriesData]);

  // Theme observer
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme || 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === chartWrapperRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  // Main Chart Rendering
  useEffect(() => {
    if (!containerRef.current || !displayData.length) return undefined;
    const isDark = theme === 'dark';

    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
      chartInstanceRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#94a3b8' : '#64748b',
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)' },
        horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)' },
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
        scaleMargins: { top: 0.12, bottom: 0.22 },
        alignLabels: true,
        visible: !isIllustrative || Number(currentPrice) > 0,
      },
      timeScale: {
        borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
        timeVisible: (timeframeIntervals[timeframe] || 60) < (24 * 60 * 60),
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)', width: 1, style: 3 },
        horzLine: { color: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)', width: 1, style: 3 },
      },
    });

    chartInstanceRef.current = chart;

    let mainSeries;
    if (chartType === 'heikin') {
      mainSeries = chart.addCandlestickSeries({
        upColor: '#00D09C',
        downColor: '#EB5B56',
        borderUpColor: '#00D09C',
        borderDownColor: '#EB5B56',
        wickUpColor: '#00D09C',
        wickDownColor: '#EB5B56',
      });
      const heikinData = toHeikinAshi(displayData);
      mainSeries.setData(heikinData.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else if (chartType === 'renko') {
      mainSeries = chart.addCandlestickSeries({
        upColor: '#00D09C',
        downColor: '#EB5B56',
        borderUpColor: '#00D09C',
        borderDownColor: '#EB5B56',
        wickUpColor: '#00D09C',
        wickDownColor: '#EB5B56',
      });
      const renkoData = toRenko(displayData);
      mainSeries.setData(renkoData.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else if (chartType === 'linebreak') {
      mainSeries = chart.addCandlestickSeries({
        upColor: '#00D09C',
        downColor: '#EB5B56',
        borderUpColor: '#00D09C',
        borderDownColor: '#EB5B56',
        wickUpColor: '#00D09C',
        wickDownColor: '#EB5B56',
      });
      const lbData = toLineBreak(displayData);
      mainSeries.setData(lbData.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else if (chartType === 'kagi') {
      mainSeries = chart.addLineSeries({
        color: '#00D09C',
        lineWidth: 3,
      });
      const kagiData = toKagi(displayData);
      mainSeries.setData(kagiData.map(({ time, close }) => ({ time, value: close })));
    } else if (chartType === 'pnf') {
      mainSeries = chart.addBarSeries({
        upColor: '#00D09C',
        downColor: '#EB5B56',
        openVisible: true,
        thinBars: false,
      });
      const pnfData = toPointAndFigure(displayData);
      mainSeries.setData(pnfData.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else if (chartType === 'baseline') {
      const avg = displayData.reduce((sum, c) => sum + c.close, 0) / (displayData.length || 1);
      mainSeries = chart.addBaselineSeries({
        baseValue: { type: 'price', price: Number(avg.toFixed(2)) },
        topLineColor: '#00D09C',
        topFillColor1: 'rgba(0, 208, 156, 0.28)',
        topFillColor2: 'rgba(0, 208, 156, 0.05)',
        bottomLineColor: '#EB5B56',
        bottomFillColor1: 'rgba(235, 91, 86, 0.05)',
        bottomFillColor2: 'rgba(235, 91, 86, 0.28)',
        lineWidth: 2,
      });
      mainSeries.setData(displayData.map(({ time, close }) => ({ time, value: close })));
    } else if (chartType === 'hollow') {
      mainSeries = chart.addCandlestickSeries({
        upColor: isDark ? '#161a1f' : '#ffffff',
        downColor: '#EB5B56',
        borderUpColor: '#00D09C',
        borderDownColor: '#EB5B56',
        wickUpColor: '#00D09C',
        wickDownColor: '#EB5B56',
      });
      mainSeries.setData(displayData.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else if (chartType === 'bars') {
      mainSeries = chart.addBarSeries({
        upColor: '#00D09C',
        downColor: '#EB5B56',
        openVisible: true,
        thinBars: false,
      });
      mainSeries.setData(displayData.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else if (chartType === 'line') {
      mainSeries = chart.addLineSeries({
        color: '#00D09C',
        lineWidth: 2,
      });
      mainSeries.setData(displayData.map(({ time, close }) => ({ time, value: close })));
    } else if (chartType === 'area') {
      mainSeries = chart.addAreaSeries({
        topColor: isDark ? 'rgba(0, 208, 156, 0.4)' : 'rgba(0, 208, 156, 0.28)',
        bottomColor: 'rgba(0, 208, 156, 0.0)',
        lineColor: '#00D09C',
        lineWidth: 2,
      });
      mainSeries.setData(displayData.map(({ time, close }) => ({ time, value: close })));
    } else {
      mainSeries = chart.addCandlestickSeries({
        upColor: '#00D09C',
        downColor: '#EB5B56',
        borderUpColor: '#00D09C',
        borderDownColor: '#EB5B56',
        wickUpColor: '#00D09C',
        wickDownColor: '#EB5B56',
      });
      mainSeries.setData(displayData.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    }

    // Add EMA 20 Overlay (Bright Blue)
    if (!isIllustrative && showEMA20 && ema20Data.length) {
      const ema20Series = chart.addLineSeries({
        color: '#38bdf8',
        lineWidth: 1.5,
        title: 'EMA 20',
        priceLineVisible: false,
      });
      ema20Series.setData(ema20Data);
    }

    // Add EMA 50 Overlay (Golden Amber)
    if (!isIllustrative && showEMA50 && ema50Data.length) {
      const ema50Series = chart.addLineSeries({
        color: '#f59e0b',
        lineWidth: 1.5,
        title: 'EMA 50',
        priceLineVisible: false,
      });
      ema50Series.setData(ema50Data);
    }

    // Volume Histogram
    const volumeSeries = chart.addHistogramSeries({
      color: '#94a3b8',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeries.setData(displayData.map(({ time, close, open, value }) => ({
      time,
      value: Number(value) || 0,
      color: close >= open ? 'rgba(0, 208, 156, 0.35)' : 'rgba(235, 91, 86, 0.35)',
    })));

    // Live Price Line
    const latestPrice = Number(currentPriceRef.current) > 0 ? Number(currentPriceRef.current) : null;
    if (latestPrice !== null && !isIllustrative) {
      currentPriceLineRef.current = mainSeries.createPriceLine({
        price: latestPrice,
        color: '#00D09C',
        lineWidth: 1.5,
        lineStyle: 2,
        axisLabelVisible: true,
        title: currentPriceLabelRef.current,
      });
    } else {
      currentPriceLineRef.current = null;
    }

    // Crosshair listener
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesPrices) {
        setHoverData(null);
        return;
      }
      const data = param.seriesPrices.get(mainSeries);
      if (data) setHoverData(typeof data === 'number' ? { close: data } : data);
    });

    chart.timeScale().fitContent();

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
        currentPriceLineRef.current = null;
      }
    };
  }, [displayData, isIllustrative, theme, chartType, showEMA20, showEMA50, ema20Data, ema50Data]);

  useEffect(() => {
    const priceLine = currentPriceLineRef.current;
    const price = Number(currentPrice);
    if (!priceLine || !Number.isFinite(price) || price <= 0) return;
    priceLine.applyOptions({
      price,
      title: currentPriceLabelRef.current,
    });
  }, [currentPrice, isDemoQuote, isStaleQuote]);

  // Separate RSI Oscillator Sub-chart
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current || !rsiSeriesData.length) return undefined;
    const isDark = theme === 'dark';

    if (rsiChartInstanceRef.current) {
      rsiChartInstanceRef.current.remove();
      rsiChartInstanceRef.current = null;
    }

    const rsiChart = createChart(rsiContainerRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#94a3b8' : '#64748b',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'transparent' },
        horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' },
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
        timeVisible: true,
      },
    });

    rsiChartInstanceRef.current = rsiChart;

    const rsiLine = rsiChart.addLineSeries({
      color: '#a855f7', // Purple RSI line
      lineWidth: 2,
      title: 'RSI(14)',
    });
    rsiLine.setData(rsiSeriesData);

    // Overbought level (70)
    rsiLine.createPriceLine({
      price: 70,
      color: '#ef4444',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: 'Overbought (70)',
    });

    // Oversold level (30)
    rsiLine.createPriceLine({
      price: 30,
      color: '#10b981',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: 'Oversold (30)',
    });

    rsiChart.timeScale().fitContent();

    return () => {
      if (rsiChartInstanceRef.current) {
        rsiChartInstanceRef.current.remove();
        rsiChartInstanceRef.current = null;
      }
    };
  }, [showRSI, rsiSeriesData, theme]);

  const activeCandle = hoverData || displayData[displayData.length - 1] || {};
  const isPositive = (activeCandle.close || 0) >= (activeCandle.open || activeCandle.close || 0);
  const timeframeName = timeframeNames[timeframe] || 'selected interval';
  const sourceNote = isLoading
    ? `Loading ${timeframeName} candles…`
    : isIllustrative
      ? `Illustrative ${timeframeName} candles · ${historyError || 'verified history is unavailable.'}${isDemoQuote ? ' The price above is simulated too.' : isLiveQuote ? ' The quote above is live; these candles are not.' : isStaleQuote ? ' The price above is a stale quote.' : ''}`
      : `${historyProvider || 'Provider'} history · ${timeframeName} candles · ${verifiedData.length} bars.`;

  return (
    <div className="pro-chart-wrapper" ref={chartWrapperRef}>
      <div className={`pro-chart-source-note ${isLoading ? 'is-loading' : ''}`} role="status" aria-live="polite" title={historyError || undefined}>
        {sourceNote}
      </div>
      {/* TradingView / Zerodha Pro Style Segmented Toolbar */}
      <div className="tv-chart-toolbar">
        {/* Left Segment: Timeframe Interval Buttons + More Dropdown */}
        <div className="tv-toolbar-group tv-intervals-group">
          {[
            { label: '1m', value: '1m', title: '1 Minute' },
            { label: '5', value: '5m', title: '5 Minutes' },
            { label: '15', value: '15m', title: '15 Minutes' },
            { label: '30', value: '30m', title: '30 Minutes' },
            { label: '1h', value: '1h', title: '1 Hour' },
            { label: '4h', value: '4h', title: '4 Hours' },
            { label: '1D', value: '1d', title: '1 Day' },
            { label: '1W', value: '1w', title: '1 Week' },
            { label: '1M', value: '1M', title: '1 Month' },
          ].map((tf) => (
            <button
              key={tf.value}
              type="button"
              className={`tv-btn tv-tf-btn ${timeframe === tf.value ? 'active' : ''}`}
              onClick={() => setTimeframe(tf.value)}
              aria-pressed={timeframe === tf.value}
              title={tf.title}
            >
              {tf.label}
            </button>
          ))}

          {/* Timeframe Dropdown (showing active if not in quick pills or for all 12 intervals) */}
          <div className="tv-dropdown-pill">
            <select
              className="tv-select-hidden"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              title="All Timeframes"
            >
              <option value="1m">1 minute (1m)</option>
              <option value="5m">5 minutes (5m)</option>
              <option value="15m">15 minutes (15m)</option>
              <option value="30m">30 minutes (30m)</option>
              <option value="45m">45 minutes (45m)</option>
              <option value="1h">1 hour (1h)</option>
              <option value="2h">2 hours (2h)</option>
              <option value="4h">4 hours (4h)</option>
              <option value="5h">5 hours (5h)</option>
              <option value="1d">1 day (1D)</option>
              <option value="1w">1 week (1W)</option>
              <option value="1M">1 month (1M)</option>
            </select>
            <span className="tv-dropdown-arrow">▼</span>
          </div>
        </div>

        <div className="tv-toolbar-divider" />

        {/* Center-Left Segment: Chart Type Icons + Dropdown */}
        <div className="tv-toolbar-group tv-chart-styles-group">
          {/* Quick Candle Icon Button */}
          <button
            type="button"
            className={`tv-btn tv-icon-btn ${chartType === 'candles' || chartType === 'hollow' || chartType === 'heikin' ? 'active' : ''}`}
            onClick={() => setChartType('candles')}
            title="Candlestick Chart"
          >
            {/* SVG Candlestick Icon matching screenshot */}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 3v4m0 10v4M15 6v2m0 8v5" strokeLinecap="round" />
              <rect x="7" y="7" width="4" height="10" rx="0.5" fill="currentColor" fillOpacity="0.2" />
              <rect x="13" y="8" width="4" height="8" rx="0.5" fill="currentColor" fillOpacity="0.2" />
            </svg>
          </button>

          {/* Quick Line / Area Icon Button */}
          <button
            type="button"
            className={`tv-btn tv-icon-btn ${chartType === 'line' || chartType === 'area' || chartType === 'baseline' ? 'active' : ''}`}
            onClick={() => setChartType('line')}
            title="Line Chart"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="16 17 22 17 22 11" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Quick Bars (OHLC) Icon Button */}
          <button
            type="button"
            className={`tv-btn tv-icon-btn ${chartType === 'bars' || chartType === 'renko' || chartType === 'linebreak' ? 'active' : ''}`}
            onClick={() => setChartType('bars')}
            title="OHLC Bars"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="4" x2="8" y2="20" strokeLinecap="round" />
              <line x1="4" y1="9" x2="8" y2="9" strokeLinecap="round" />
              <line x1="8" y1="15" x2="12" y2="15" strokeLinecap="round" />
              <line x1="16" y1="5" x2="16" y2="19" strokeLinecap="round" />
              <line x1="12" y1="8" x2="16" y2="8" strokeLinecap="round" />
              <line x1="16" y1="13" x2="20" y2="13" strokeLinecap="round" />
            </svg>
          </button>

          {/* Full Chart Style Dropdown Menu */}
          <div className="tv-dropdown-pill">
            <select
              className="tv-select-hidden"
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
              title="All Chart Styles"
            >
              <option value="candles">📊 Candles (Japanese)</option>
              <option value="bars">🪜 Bars (OHLC)</option>
              <option value="hollow">🕯️ Hollow Candle</option>
              <option value="heikin">📈 Heikin-Ashi (Smoothed)</option>
              <option value="line">📈 Line (Close)</option>
              <option value="area">🏔️ Area (Mountain)</option>
              <option value="baseline">⚖️ Baseline</option>
              <option value="renko">🧱 Renko (Bricks)</option>
              <option value="linebreak">⚡ Line Break</option>
              <option value="kagi">🎋 Kagi</option>
              <option value="pnf">🎯 Point & Figure</option>
            </select>
            <span className="tv-dropdown-arrow">▼</span>
          </div>
        </div>

        <div className="tv-toolbar-divider" />

        {/* Technical Indicators Modal Trigger / Pills */}
        {!isIllustrative && (
          <div className="tv-toolbar-group tv-indicators-group">
            <button
              type="button"
              className={`tv-btn tv-icon-btn ${showEMA20 || showEMA50 || showRSI ? 'active' : ''}`}
              title="Technical Indicators (EMA 20, EMA 50, RSI)"
              onClick={() => {
                if (!showEMA20 && !showEMA50) {
                  setShowEMA20(true);
                  setShowEMA50(true);
                } else if (!showRSI) {
                  setShowRSI(true);
                } else {
                  setShowEMA20(false);
                  setShowEMA50(false);
                  setShowRSI(false);
                }
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 3v18h18" strokeLinecap="round" />
                <path d="M18 9l-5 5-4-4-3 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="tv-dropdown-pill">
              <select
                className="tv-select-hidden"
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'ema20') setShowEMA20((c) => !c);
                  if (val === 'ema50') setShowEMA50((c) => !c);
                  if (val === 'rsi') setShowRSI((c) => !c);
                  if (val === 'all') { setShowEMA20(true); setShowEMA50(true); setShowRSI(true); }
                  if (val === 'none') { setShowEMA20(false); setShowEMA50(false); setShowRSI(false); }
                }}
                title="Select Indicators"
              >
                <option value="">⚙️ Indicators</option>
                <option value="ema20">{showEMA20 ? '✓ ' : ''}EMA 20</option>
                <option value="ema50">{showEMA50 ? '✓ ' : ''}EMA 50</option>
                <option value="rsi">{showRSI ? '✓ ' : ''}RSI (14 Period)</option>
                <option value="all">Turn ON All Indicators</option>
                <option value="none">Turn OFF All Indicators</option>
              </select>
              <span className="tv-dropdown-arrow">▼</span>
            </div>

            {/* Quick Indicator toggles badge */}
            <button
              type="button"
              className={`tv-pill-badge ${showEMA20 ? 'on' : ''}`}
              onClick={() => setShowEMA20((c) => !c)}
            >
              EMA 20
            </button>
            <button
              type="button"
              className={`tv-pill-badge ${showEMA50 ? 'on' : ''}`}
              onClick={() => setShowEMA50((c) => !c)}
            >
              EMA 50
            </button>
            <button
              type="button"
              className={`tv-pill-badge ${showRSI ? 'on' : ''}`}
              onClick={() => setShowRSI((c) => !c)}
            >
              RSI {latestRSI && showRSI ? `(${latestRSI})` : ''}
            </button>
          </div>
        )}

        <div className="tv-toolbar-divider" />

        {/* OHLC Realtime Inspector Box */}
        {!isIllustrative && activeCandle.open && (
          <div className="tv-ohlc-display">
            <span>O <b className={isPositive ? 'gain-text' : 'loss-text'}>{Number(activeCandle.open).toFixed(2)}</b></span>
            <span>H <b className="gain-text">{Number(activeCandle.high).toFixed(2)}</b></span>
            <span>L <b className="loss-text">{Number(activeCandle.low).toFixed(2)}</b></span>
            <span>C <b className={isPositive ? 'gain-text' : 'loss-text'}>{Number(activeCandle.close).toFixed(2)}</b></span>
          </div>
        )}

        {/* Right Segment: Utility Tools (Reset, Undo, Redo, Compare) */}
        <div className="tv-toolbar-right">
          {/* Compare Scale Icon */}
          <button
            type="button"
            className="tv-btn tv-icon-btn"
            title="Scale / Balance"
            onClick={() => chartInstanceRef.current?.timeScale().resetTimeScale()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3v18M6 8l6-3 6 3M6 8l-3 6h6l-3-6zM18 8l-3 6h6l-3-6z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Reset Zoom / Fit */}
          <button
            type="button"
            className="tv-btn tv-icon-btn"
            onClick={() => chartInstanceRef.current?.timeScale().fitContent()}
            title="Reset Zoom / Fit Content"
            aria-label="Reset chart zoom"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="tv-btn tv-icon-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit full screen' : 'Open chart full screen'}
            aria-label={isFullscreen ? 'Exit chart full screen' : 'Open chart full screen'}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Main Lightweight Canvas Container */}
      <div className="candlestick-chart pro-canvas-box" ref={containerRef} />

      {/* Dedicated RSI Oscillator View */}
      {showRSI && !isIllustrative && (
        <div className="pro-rsi-pane">
          <div className="pro-rsi-header">
            <span>RSI (14 Period) — Relative Strength Index</span>
            <span style={{ color: latestRSI > 70 ? '#ef4444' : latestRSI < 30 ? '#10b981' : '#a855f7', fontWeight: 700 }}>
              {latestRSI ? `${latestRSI} (${latestRSI > 70 ? 'Overbought' : latestRSI < 30 ? 'Oversold' : 'Neutral'})` : ''}
            </span>
          </div>
          <div style={{ height: 130, width: '100%' }} ref={rsiContainerRef} />
        </div>
      )}
    </div>
  );
};

export default CandlestickChart;
