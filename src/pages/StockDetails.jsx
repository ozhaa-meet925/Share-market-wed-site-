import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity } from 'lucide-react';
import CandlestickChart from '../components/CandlestickChart';
import LiveChart from '../components/LiveChart';
import PriceAlertForm from '../components/PriceAlertForm';
import TradeBox from '../components/TradeBox';
import StockAIInsights from '../components/StockAIInsights';
import { marketApi } from '../services/api';
import { createCatalogStock, useStockCatalog } from '../hooks/useStockCatalog';

const toCandleData = (payload) => {
  if (payload?.s !== 'ok' || !payload.t?.length) return [];
  return payload.t.map((time, index) => ({
    time,
    open: payload.o[index],
    high: payload.h[index],
    low: payload.l[index],
    close: payload.c[index],
    value: payload.v[index],
  }));
};

const QUOTE_REFRESH_MS = 15_000;
const CHART_TIMEFRAMES = {
  '1m': { seconds: 60, resolution: '1m' },
  '5m': { seconds: 5 * 60, resolution: '5m' },
  '15m': { seconds: 15 * 60, resolution: '15m' },
  '30m': { seconds: 30 * 60, resolution: '30m' },
  '45m': { seconds: 45 * 60, resolution: '45m' },
  '1h': { seconds: 60 * 60, resolution: '1h' },
  '2h': { seconds: 2 * 60 * 60, resolution: '2h' },
  '4h': { seconds: 4 * 60 * 60, resolution: '4h' },
  '5h': { seconds: 5 * 60 * 60, resolution: '5h' },
  '1d': { seconds: 24 * 60 * 60, resolution: '1d' },
  '1w': { seconds: 7 * 24 * 60 * 60, resolution: '1w' },
  '1M': { seconds: 30 * 24 * 60 * 60, resolution: '1M' },
};

const StockDetails = () => {
  const { symbol } = useParams();
  const { catalog } = useStockCatalog();
  const stock = useMemo(
    () => catalog.find((item) => item.symbol === symbol) || createCatalogStock(String(symbol || '').toUpperCase(), String(symbol || '').toUpperCase()),
    [catalog, symbol],
  );
  const [liveStock, setLiveStock] = useState(stock);
  const [candles, setCandles] = useState([]);
  const [chartTimeframe, setChartTimeframe] = useState('15m');
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [historyProvider, setHistoryProvider] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [dataSource, setDataSource] = useState('Connect KUN for live prices; Yahoo research fallback may be delayed');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let active = true;
    const refreshQuote = async () => {
      try {
        const quote = await marketApi.getLiveQuote(stock.symbol);
        const isResearch = quote?.isResearch === true;
        const isLive = quote?.isLive === true;
        if (!active || (!isLive && !isResearch) || !(Number(quote?.c) > 0)) return;
        setLiveStock((current) => ({
          ...current,
          price: quote.c,
          change: quote.d ?? null,
          changePercent: quote.dp ?? null,
          high: quote.h || null,
          low: quote.l || null,
          previousClose: quote.pc || null,
          quoteUpdatedAt: quote.timestamp || new Date().toISOString(),
          isLive,
          isResearch,
          isDemo: false,
          isStale: quote.isStale === true,
        }));
        setDataSource(isResearch
          ? `${quote.provider || 'Yahoo Finance via yfinance'} research quote · not live`
          : `${quote.provider || 'Market provider'} live quote`);
        setLastUpdated(new Date());
      } catch {
        if (active) {
          setLiveStock((current) => current.price ? { ...current, isLive: false, isStale: true } : current);
          setDataSource((current) => current.includes('Upstox') ? 'Last Upstox quote · refresh failed' : 'Connect free Upstox token');
        }
      }
    };

    setLiveStock({ ...stock, isLive: false, isResearch: false, isStale: false });
    setLastUpdated(null);
    refreshQuote();
    const quoteIntervalId = window.setInterval(refreshQuote, QUOTE_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(quoteIntervalId);
    };
  }, [stock]);

  useEffect(() => {
    let active = true;
    let requestPending = false;
    let hasLoadedOnce = false;
    const interval = CHART_TIMEFRAMES[chartTimeframe] || CHART_TIMEFRAMES['15m'];

    const loadCandles = async () => {
      if (requestPending) return;
      requestPending = true;
      if (!hasLoadedOnce) setCandlesLoading(true);

      const to = Math.floor(Date.now() / 1000);
      const visibleBarsSeconds = interval.seconds * 100;
      const intradayLookbackSeconds = 30 * 24 * 60 * 60;
      const from = to - Math.max(
        visibleBarsSeconds,
        interval.seconds < 24 * 60 * 60 ? intradayLookbackSeconds : 0,
      );
      try {
        const payload = await marketApi.getCandles(stock.symbol, from, to, interval.resolution);
        if (!active) return;
        const nextCandles = toCandleData(payload);
        setCandles(nextCandles);
        setHistoryProvider(payload?.provider || null);
        setHistoryError(nextCandles.length ? '' : 'No historical candles were returned for this interval.');
      } catch (error) {
        if (active) {
          setCandles([]);
          setHistoryProvider(null);
          setHistoryError(error.message || 'Historical candles are unavailable for this interval.');
        }
      } finally {
        hasLoadedOnce = true;
        requestPending = false;
        if (active) setCandlesLoading(false);
      }
    };

    setCandles([]);
    setHistoryProvider(null);
    setHistoryError('');
    setCandlesLoading(true);
    loadCandles();
    const refreshMs = interval.seconds <= 30 * 60 ? 60_000 : 5 * 60_000;
    const candleIntervalId = window.setInterval(loadCandles, refreshMs);

    return () => {
      active = false;
      window.clearInterval(candleIntervalId);
    };
  }, [chartTimeframe, stock.symbol]);

  const positive = Number(liveStock.change) >= 0;
  const hasPrice = Number.isFinite(liveStock.price) && liveStock.price > 0;

  return (
    <div className="page">
      <Link className="back-link" to="/stocks">Back to stocks</Link>
      <section className="details-layout">
        <div className="panel detail-panel">
          <div className="quote-line">
            <div>
              <span>{liveStock.sector}</span>
              <h1>{liveStock.symbol}</h1>
              <p>{liveStock.name}</p>
              <span className="data-source"><Activity size={13} /> {dataSource}{lastUpdated ? ` · ${lastUpdated.toLocaleTimeString('en-IN')}` : ''}</span>
            </div>
            <div className="align-right">
              <h2>{hasPrice ? `₹${Number(liveStock.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Quote unavailable'}</h2>
              <strong className={liveStock.isLive && liveStock.changePercent !== null ? (positive ? 'gain' : 'loss') : ''}>
                {(liveStock.isLive || liveStock.isResearch) && liveStock.change !== null && liveStock.changePercent !== null
                  ? `${positive ? '+' : ''}${Number(liveStock.change).toFixed(2)} (${positive ? '+' : ''}${Number(liveStock.changePercent).toFixed(2)}%)`
                  : liveStock.isResearch ? 'Research quote · not live' : liveStock.isStale ? 'Last quote · stale' : 'Waiting for live quote'}
              </strong>
            </div>
          </div>
          <CandlestickChart
            candles={candles}
            currentPrice={hasPrice && (liveStock.isLive || liveStock.isResearch || liveStock.isDemo || liveStock.isStale) ? liveStock.price : null}
            symbol={liveStock.symbol}
            timeframe={chartTimeframe}
            onTimeframeChange={setChartTimeframe}
            isLoading={candlesLoading}
            historyProvider={historyProvider}
            historyError={historyError}
            isDemoQuote={liveStock.isDemo === true}
            isLiveQuote={liveStock.isLive === true}
            isStaleQuote={liveStock.isStale === true || liveStock.isResearch === true}
          />
          <section className="stock-detail-live-chart">
            <LiveChart symbol={liveStock.symbol} stock={liveStock} />
          </section>
          <div className="split-stats">
            <span>Previous Close <b>{liveStock.previousClose ?? 'Unavailable'}</b></span>
            <span>High <b>{liveStock.high ?? 'Unavailable'}</b></span>
            <span>Low <b>{liveStock.low ?? 'Unavailable'}</b></span>
            <span>Volume <b>{liveStock.volume}</b></span>
            <span>Market Cap <b>{liveStock.marketCap}</b></span>
            <span>P/E <b>{liveStock.pe}</b></span>
            <span>EPS <b>{liveStock.eps}</b></span>
            <span>Dividend <b>{liveStock.dividendYield}%</b></span>
            <span>52W High <b>{liveStock.week52High ?? 'Unavailable'}</b></span>
            <span>52W Low <b>{liveStock.week52Low ?? 'Unavailable'}</b></span>
          </div>
          <StockAIInsights stock={liveStock} />
          <section className="company-info">
            <h2>Company Information</h2>
            <p>{liveStock.description}</p>
          </section>
          <PriceAlertForm stock={liveStock} evaluateCurrentPrice={liveStock.isLive} />
        </div>
        <TradeBox stock={liveStock} />
      </section>
    </div>
  );
};

export default StockDetails;
