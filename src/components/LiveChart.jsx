import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Clock3 } from 'lucide-react';
import { createChart } from 'lightweight-charts';
import { marketApi } from '../services/api';

const ranges = ['1D', '1W', '1M', '6M', '1Y', 'More'];
const rangeDays = { '1D': 2, '1W': 10, '1M': 45, '6M': 200, '1Y': 380, More: 1825 };
const QUOTE_REFRESH_MS = 1000;

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

const toCandleData = (payload) => {
  if (payload?.s !== 'ok' || !payload.t?.length) return [];
  return payload.t.map((time, index) => ({
    time,
    open: Number(payload.o[index]),
    high: Number(payload.h[index]),
    low: Number(payload.l[index]),
    close: Number(payload.c[index]),
    value: Number(payload.v?.[index]) || 0,
  }));
};

const createDemoCandles = (symbol, currentPrice, previousClose, range) => {
  const count = 56;
  const spanDays = range === '1D' ? 1 : (rangeDays[range] || 30);
  const now = Math.floor(Date.now() / 1000);
  const stepSeconds = (spanDays * 24 * 60 * 60) / (count - 1);
  const hasPrice = Number(currentPrice) > 0;
  const anchor = hasPrice ? Number(currentPrice) : 100;
  const base = Number(previousClose) > 0 ? Number(previousClose) : anchor;
  const targetRatio = hasPrice ? anchor / base : 1;
  const seed = [...symbol].reduce((value, character) => value + character.charCodeAt(0), 0);
  let previous = base * 0.992;

  return Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    const wave = Math.sin(seed * 0.07 + index * 0.72) * 0.004;
    const close = index === count - 1 && hasPrice
      ? anchor
      : base * (0.992 + progress * (targetRatio - 0.992) + wave);
    const open = previous;
    const spread = Math.max(Math.max(open, close) * (0.001 + (index % 4) * 0.00035), 0.01);
    const candle = {
      time: Math.floor((now - (count - 1 - index) * stepSeconds) / 60) * 60,
      open: Number(open.toFixed(2)),
      high: Number((Math.max(open, close) + spread).toFixed(2)),
      low: Number(Math.max(0.01, Math.min(open, close) - spread).toFixed(2)),
      close: Number(close.toFixed(2)),
      value: 1000 + ((seed * (index + 3)) % 25000),
    };
    previous = close;
    return candle;
  });
};

const formatPrice = (value) => Number(value) > 0
  ? `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : 'Unavailable';

const formatQuoteTime = (value) => {
  if (!value) return 'Waiting for provider quote';
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric < 1e12 ? numeric * 1000 : numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Waiting for provider quote' : `Price time ${date.toLocaleTimeString('en-IN')}`;
};

const LiveChart = ({ symbol = 'RELIANCE', stock: providedStock, range = '1D', assetType = 'stock' }) => {
  const stock = useMemo(() => providedStock || { symbol, name: symbol, price: null }, [providedStock, symbol]);
  const isPreciousMetal = assetType === 'commodity' || assetType === 'silver';
  const isSilver = assetType === 'silver';
  const metalName = isSilver ? 'silver' : 'gold';
  const spotPair = isSilver ? 'XAG/INR' : 'XAU/INR';
  const metalUnit = isSilver ? '₹/kg' : '₹/10g';
  const spotDescription = isSilver ? `XAG/INR spot reference · ${metalUnit}` : `XAU/INR spot reference · ${metalUnit} · 24K`;
  const mcxDescription = `MCX ${metalName} front-month future · ${metalUnit}`;
  const requiresVerifiedQuote = isPreciousMetal;
  const [activeRange, setActiveRange] = useState(ranges.includes(range) ? range : '1D');
  const [mode, setMode] = useState('candle');
  const [chartData, setChartData] = useState([]);
  const [liveQuote, setLiveQuote] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [configuredProvider, setConfiguredProvider] = useState('kun');
  const [providerConfigured, setProviderConfigured] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    setChartData([]);
    let active = true;
    const to = Math.floor(Date.now() / 1000);
    const from = to - (rangeDays[activeRange] * 24 * 60 * 60);
    marketApi.getCandles(stock.symbol, from, to, activeRange === '1D' ? '15m' : 'D')
      .then((payload) => { if (active) setChartData(toCandleData(payload)); })
      .catch(() => { if (active) setChartData([]); });
    return () => { active = false; };
  }, [activeRange, stock.symbol]);

  useEffect(() => {
    let active = true;
    let requestPending = false;
    setLiveQuote(null);
    setLastUpdated(null);
    const refreshQuote = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const quote = await marketApi.getLiveQuote(stock.symbol);
        if (!active) return;
        if ((quote?.isLive === true || (requiresVerifiedQuote && quote?.isReal === true)) && Number(quote.c) > 0) {
          setLiveQuote(quote);
          setLastUpdated(new Date());
        } else {
          setLiveQuote((previous) => previous ? { ...previous, isLive: false, isStale: true } : null);
        }
      } catch {
        if (active) setLiveQuote((previous) => previous ? { ...previous, isLive: false, isStale: true } : null);
      } finally {
        requestPending = false;
      }
    };

    let intervalId;
    const start = async () => {
      if (requiresVerifiedQuote) {
        refreshQuote();
        intervalId = window.setInterval(refreshQuote, 60_000);
        return;
      }
      try {
        const health = await marketApi.getHealth();
        if (!active) return;
        setConfiguredProvider(health.configuredProvider || health.provider || 'kun');
        setProviderConfigured(health.apiKeyConfigured === true);
        if (!health.realTimeAvailable) return;
        refreshQuote();
        intervalId = window.setInterval(refreshQuote, QUOTE_REFRESH_MS);
      } catch {
        // Keep the chart available with an explicit quote-unavailable state.
      }
    };
    start();
    return () => {
      active = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [requiresVerifiedQuote, stock.symbol]);

  const catalogQuote = stock.isLive || stock.isStale ? {
    c: stock.price,
    d: stock.change,
    dp: stock.changePercent,
    pc: stock.previousClose,
    h: stock.high,
    l: stock.low,
    timestamp: stock.quoteUpdatedAt,
    provider: 'Upstox',
    isLive: stock.isLive === true,
    isStale: stock.isStale === true,
  } : null;
  const displayQuote = liveQuote || catalogQuote;
  const hasQuote = Number(displayQuote?.c) > 0;
  const isLive = displayQuote?.isLive === true && hasQuote;
  const isDemo = false;
  const isDelayed = displayQuote?.isDelayed === true && hasQuote;
  const isSpotQuote = displayQuote?.marketType === 'spot' || (isPreciousMetal && isDelayed);
  const source = isDemo
    ? 'Simulated demo feed · not real market data'
    : isLive
      ? `${displayQuote.provider || 'Upstox'} live quote`
          : displayQuote?.isStale
        ? `Last ${displayQuote.provider || 'provider'} quote · stale`
        : isDelayed
          ? `${displayQuote.provider || 'Gold spot'} · about 15 minutes delayed`
          : requiresVerifiedQuote
            ? `Waiting for a real ${metalName} spot quote`
            : configuredProvider === 'kun'
              ? providerConfigured ? 'Waiting for Kunpeng Data NSE quote' : 'Add KUN_DATA_API_TOKEN to .env for NSE live quotes'
              : configuredProvider === 'upstox'
                ? providerConfigured ? 'Waiting for Upstox quote' : 'Add UPSTOX_ACCESS_TOKEN to .env'
                : providerConfigured ? 'Waiting for market provider quote' : 'Configure the live market provider token in .env';
  const currentPrice = hasQuote ? Number(displayQuote.c) : null;
  const change = displayQuote?.d !== null && displayQuote?.d !== undefined ? Number(displayQuote.d) : null;
  const changePercent = displayQuote?.dp !== null && displayQuote?.dp !== undefined ? Number(displayQuote.dp) : null;
  const positive = change !== null && change >= 0;
  const isIllustrative = chartData.length === 0;
  const baseChartData = useMemo(() => (
    chartData.length
      ? chartData
      : createDemoCandles(stock.symbol, currentPrice, displayQuote?.pc, activeRange)
  ), [activeRange, chartData, currentPrice, displayQuote?.pc, stock.symbol]);

  const displayData = useMemo(() => {
    if (!baseChartData.length || currentPrice === null) return baseChartData;
    const candles = [...baseChartData];
    const index = candles.length - 1;
    const last = candles[index];
    candles[index] = { ...last, close: currentPrice, high: Math.max(last.high, currentPrice), low: Math.min(last.low, currentPrice) };
    return candles;
  }, [baseChartData, currentPrice]);

  useEffect(() => {
    if (!containerRef.current || !displayData.length) return undefined;
    const dark = document.documentElement.dataset.theme === 'dark';
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: dark ? '#94a3b8' : '#64748b' },
      grid: { vertLines: { color: dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)' }, horzLines: { color: dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)' } },
      rightPriceScale: { visible: !isIllustrative || hasQuote, borderColor: dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)', scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderColor: dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)', timeVisible: activeRange === '1D' },
      crosshair: { mode: 1 },
    });
    const candleSeries = chart.addCandlestickSeries({ upColor: '#00D09C', downColor: '#EB5B56', borderUpColor: '#00D09C', borderDownColor: '#EB5B56', wickUpColor: '#00D09C', wickDownColor: '#EB5B56' });
    const volumeSeries = chart.addHistogramSeries({ color: '#94a3b8', priceFormat: { type: 'volume' }, priceScaleId: '' });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const candles = mode === 'heikin' ? toHeikinAshi(displayData) : displayData;
    candleSeries.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    volumeSeries.setData(candles.map(({ time, close, open, value }) => ({ time, value, color: close >= open ? 'rgba(17, 135, 93, 0.35)' : 'rgba(196, 59, 56, 0.35)' })));
    if (currentPrice !== null) candleSeries.createPriceLine({ price: currentPrice, color: positive ? '#0d6f4e' : '#c43b38', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: isDemo ? 'DEMO' : displayQuote?.isStale ? 'STALE' : isDelayed ? 'DELAYED SPOT' : isLive ? 'LIVE' : 'LAST QUOTE' });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [activeRange, currentPrice, displayData, isDelayed, isDemo, isLive, mode, positive]);

  return (
    <section className="live-chart panel">
      <div className="live-chart-header">
        <div>
          <span className="card-topline"><Activity size={14} /> {!hasQuote ? (requiresVerifiedQuote ? `Waiting for a real ${metalName} price` : 'Illustrative chart · no quote') : isDemo ? 'Simulated demo feed · not real' : displayQuote?.isStale ? 'Last known provider quote · stale' : isDelayed ? `${stock.name} spot reference · delayed` : `${displayQuote?.provider || 'Upstox'} market quote`}</span>
          <div className="live-chart-title-row">
            <h2>{isPreciousMetal ? stock.name : stock.symbol}</h2>
            <span>{isPreciousMetal ? (isSpotQuote ? spotDescription : mcxDescription) : stock.name}</span>
          </div>
          <div className="live-chart-price-row">
            <strong>{hasQuote ? formatPrice(currentPrice) : 'Quote unavailable'}</strong>
            {change !== null && changePercent !== null ? <span className={positive ? 'gain' : 'loss'}>{positive ? '+' : ''}{change.toFixed(2)} ({positive ? '+' : ''}{changePercent.toFixed(2)}%)</span> : <span>Change unavailable</span>}
          </div>
        </div>
        <div className="chart-toolbar">
          <div className="chart-mode-selector" role="group" aria-label="Chart style">
            <button className={mode === 'heikin' ? 'active' : ''} aria-pressed={mode === 'heikin'} type="button" onClick={() => setMode('heikin')}>Heikin-Ashi</button>
            <button className={mode === 'candle' ? 'active' : ''} aria-pressed={mode === 'candle'} type="button" onClick={() => setMode('candle')}>Candles</button>
          </div>
          <div className="chart-range-selector" role="group" aria-label="Chart time range">{ranges.map((item) => <button className={activeRange === item ? 'active' : ''} aria-pressed={activeRange === item} key={item} type="button" onClick={() => setActiveRange(item)}>{item}</button>)}</div>
        </div>
      </div>
      <div className="chart-live-meta">
        <span className={`quote-source ${isLive ? 'is-live' : isDelayed ? 'is-delayed' : 'is-demo'}`}><span className="live-dot" /> {source}{isDelayed ? '' : ' · checks for updates every second'}</span>
        <span>{formatQuoteTime(displayQuote?.timestamp || lastUpdated)}</span>
      </div>
      <div className="live-chart-body">
        {hasQuote && <div className="live-chart-current-badge"><span>{isDemo ? 'Demo price · not real' : displayQuote?.isStale ? 'Stale provider price' : isDelayed ? `Delayed ${stock.name.toLowerCase()} spot price` : isLive ? 'Current price' : 'Last quote'}</span><strong>{formatPrice(currentPrice)}</strong>{change !== null && changePercent !== null ? <small className={positive ? 'gain' : 'loss'}>{isDemo ? 'Demo · ' : ''}{positive ? '+' : ''}{change.toFixed(2)} ({positive ? '+' : ''}{changePercent.toFixed(2)}%)</small> : null}</div>}
        {displayData.length
          ? <div className="live-chart-canvas" ref={containerRef} aria-label={`${stock.symbol} ${isIllustrative ? 'illustrative' : 'provider history'} candlestick chart`} />
          : <div className="chart-empty-state">Chart data is unavailable.</div>}
      </div>
      <div className="live-chart-stats">
        {isPreciousMetal ? (
          <>
            <span>Contract <b>{isSpotQuote ? `International ${metalName} spot reference` : `MCX ${metalName} future`}</b></span>
            <span>Quote unit <b>{isSilver ? 'Silver value · ₹ / kg' : isSpotQuote ? '24K metal value · ₹ / 10g' : '₹ / 10g'}</b></span>
            <span>Prev close <b>{formatPrice(displayQuote?.pc)}</b></span>
            <span>Day high <b>{formatPrice(displayQuote?.h)}</b></span>
            <span>Day low <b>{formatPrice(displayQuote?.l)}</b></span>
            <span>Volume <b>{Number(displayQuote?.v) > 0 ? Number(displayQuote.v).toLocaleString('en-IN') : 'Unavailable'}</b></span>
          </>
        ) : (
          <>
            <span>Prev close <b>{formatPrice(displayQuote?.pc)}</b></span>
            <span>Mkt cap <b>{stock.marketCap || 'Unavailable'} · estimated</b></span>
            <span>High <b>{formatPrice(displayQuote?.h)}</b></span>
            <span>P/E <b>{stock.pe || 'Unavailable'} · estimated</b></span>
            <span>Low <b>{formatPrice(displayQuote?.l)}</b></span>
            <span>Dividend <b>{stock.dividendYield ?? 'Unavailable'}% · estimated</b></span>
            <span>52-wk range <b>Unavailable</b></span>
            <span>Volume <b>{stock.volume || 'Unavailable'}</b></span>
          </>
        )}
      </div>
      <div className="chart-footer-note"><Clock3 size={14} /> {isIllustrative
        ? isDemo
          ? 'Candles and price are simulated demo data, not historical exchange prices.'
          : displayQuote?.isStale
            ? 'The provider quote is stale. Candles are illustrative because historical prices are unavailable.'
          : isLive
            ? 'Candles are illustrative because provider history is unavailable; the quote above is live.'
            : isDelayed
              ? `The quote is a real ${spotPair} ${metalName} spot reference delayed by about 15 minutes. Candles are illustrative because this free feed does not provide intraday history.`
            : hasQuote
              ? 'Candles are illustrative; the quote above is the last known provider price.'
              : requiresVerifiedQuote
                ? `Illustrative candles only · waiting for the ${spotPair} ${metalName} spot API or a live MCX provider.`
                : 'Illustrative candles only · no provider quote or historical price data is available.'
        : isDemo
          ? 'Candles and price are simulated demo data, not historical exchange prices.'
          : displayQuote?.isStale
            ? 'The provider quote is stale. Candles are illustrative because historical prices are unavailable.'
          : isDelayed
            ? `The quote is a real ${spotPair} ${metalName} spot reference delayed by about 15 minutes. Candles are illustrative because this free feed does not provide intraday history.`
          : 'Provider quote status and received time are shown above. Candles use the configured history source.'}</div>
    </section>
  );
};

export default LiveChart;
