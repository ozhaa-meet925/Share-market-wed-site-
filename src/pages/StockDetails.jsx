import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Activity, ArrowLeft, ArrowUpRight, Bookmark, BookmarkCheck, GitCompareArrows,
  Newspaper, RefreshCw, ShieldAlert,
} from 'lucide-react';
import LiveChart from '../components/LiveChart';
import PriceAlertForm from '../components/PriceAlertForm';
import TradeBox from '../components/TradeBox';
import StockAIInsights from '../components/StockAIInsights';
import { TickArrow, tickToneClass, useTickFlash } from '../components/PriceChange';
import { marketApi } from '../services/api';
import { createCatalogStock, useStockCatalog } from '../hooks/useStockCatalog';
import './StockDetails.css';

const QUOTE_REFRESH_MS = 1_000;
const WATCHLIST_KEY = 'sharemarket:watchlist';
const TABS = [
  'Overview',
  'Chart',
  'Financials',
  'Fundamentals',
  'Technical Analysis',
  'Shareholding Pattern',
  'Company Profile',
  'Latest News',
];

const finiteValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value)
  : null;

const formatValue = (value, digits = 2) => {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'string' && /[A-Za-z]/.test(value)) return value;
  const num = Number(value);
  if (!Number.isFinite(num)) return 'Unavailable';
  return num.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatPublishedTime = (timestamp, includeTime = true) => {
  if (timestamp === null || timestamp === undefined || timestamp === '') return 'Publication time unavailable';
  const numericTimestamp = Number(timestamp);
  const date = Number.isFinite(numericTimestamp) && numericTimestamp > 0
    ? new Date(numericTimestamp * 1000)
    : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Publication time unavailable';
  return `${date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' } : {}),
    timeZone: 'Asia/Kolkata',
  })} IST`;
};

const toCandleData = (payload) => {
  if (payload?.s !== 'ok' || !Array.isArray(payload.t) || !payload.t.length) return [];
  if ([payload.o, payload.h, payload.l, payload.c].some((values) => !Array.isArray(values) || values.length !== payload.t.length)) return [];

  const candles = payload.t.map((time, index) => ({
    time: Number(time),
    open: Number(payload.o[index]),
    high: Number(payload.h[index]),
    low: Number(payload.l[index]),
    close: Number(payload.c[index]),
    value: finiteValue(payload.v?.[index]),
  })).filter((candle) => Number.isFinite(candle.time)
    && [candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0)
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close));

  return [...new Map(candles.sort((a, b) => a.time - b.time)
    .map((candle) => [candle.time, candle])).values()];
};

const getWatchlist = () => {
  try {
    const list = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
    return Array.isArray(list) ? list.map((symbol) => String(symbol).toUpperCase()) : [];
  } catch {
    return [];
  }
};

const withoutProviderQuote = (stock) => ({
  ...stock,
  price: null,
  change: null,
  changePercent: null,
  open: null,
  high: null,
  low: null,
  previousClose: null,
  volume: null,
  vwap: null,
  marketCap: null,
  pe: null,
  eps: null,
  dividendYield: null,
  week52High: null,
  week52Low: null,
  quoteTimestamp: null,
  quoteProvider: null,
  isLive: false,
  isResearch: false,
  isDemo: false,
  isStale: false,
});

const calculateTechnicalMetrics = (candles) => {
  const closes = candles.map((candle) => candle.close);
  const average = (period) => closes.length >= period
    ? closes.slice(-period).reduce((total, price) => total + price, 0) / period
    : null;
  const changes = closes.slice(-15).slice(1).map((price, index) => price - closes.slice(-15)[index]);
  const gains = changes.reduce((total, change) => total + Math.max(change, 0), 0) / 14;
  const losses = changes.reduce((total, change) => total + Math.max(-change, 0), 0) / 14;
  const rsi = changes.length === 14
    ? losses === 0 ? 100 : 100 - (100 / (1 + gains / losses))
    : null;
  return {
    latest: closes.at(-1) ?? null,
    sma20: average(20),
    sma50: average(50),
    rsi14: rsi,
    latestBarTime: candles.at(-1)?.time ?? null,
    candleCount: candles.length,
  };
};

const StockDetails = () => {
  const { symbol: routeSymbol = '' } = useParams();
  const symbol = decodeURIComponent(routeSymbol).trim().toUpperCase();
  const { catalog } = useStockCatalog();
  const stock = useMemo(
    () => catalog.find((item) => String(item.symbol).toUpperCase() === symbol)
      || createCatalogStock(symbol, symbol),
    [catalog, symbol],
  );
  const [liveStock, setLiveStock] = useState(() => withoutProviderQuote(stock));
  const [dataSource, setDataSource] = useState('Checking configured market data providers');
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [activeTab, setActiveTab] = useState('Chart');
  const [watchlisted, setWatchlisted] = useState(() => getWatchlist().includes(symbol));
  const [annualHistory, setAnnualHistory] = useState({ candles: [], provider: '', isResearch: false, loading: true, error: '' });
  const [newsState, setNewsState] = useState({ items: [], provider: '', loading: false, error: '' });

  useEffect(() => {
    setActiveTab('Chart');
    setWatchlisted(getWatchlist().includes(symbol));
    setLiveStock(withoutProviderQuote(stock));
  }, [stock, symbol]);

  useEffect(() => {
    let active = true;
    let pending = false;
    const refreshQuote = async () => {
      if (pending) return;
      pending = true;
      if (!liveStock.price) setQuoteLoading(true);
      try {
        const quote = await marketApi.getLiveQuote(stock.symbol);
        const isResearch = quote?.isResearch === true;
        const isLive = quote?.isLive === true && quote?.isStale !== true;
        if ((!isLive && !isResearch) || !(Number(quote?.c) > 0)) {
          throw new Error(quote?.error || 'No verified provider quote is available.');
        }
        if (!active) return;
        const nextStock = {
          ...stock,
          price: Number(quote.c),
          change: finiteValue(quote.d),
          changePercent: finiteValue(quote.dp),
          open: finiteValue(quote.o) > 0 ? Number(quote.o) : null,
          high: finiteValue(quote.h) > 0 ? Number(quote.h) : null,
          low: finiteValue(quote.l) > 0 ? Number(quote.l) : null,
          previousClose: finiteValue(quote.pc) > 0 ? Number(quote.pc) : null,
          volume: finiteValue(quote.v) !== null && finiteValue(quote.v) >= 0 ? Number(quote.v) : null,
          vwap: finiteValue(quote.vwap),
          marketCap: finiteValue(quote.marketCap),
          pe: finiteValue(quote.pe),
          eps: finiteValue(quote.eps),
          dividendYield: finiteValue(quote.dividendYield),
          week52High: finiteValue(quote.week52High),
          week52Low: finiteValue(quote.week52Low),
          quoteTimestamp: quote.timestamp ?? null,
          quoteProvider: quote.provider || null,
          isLive,
          isResearch,
          isDemo: false,
          isStale: quote.isStale === true || quote.isDelayed === true,
        };
        setLiveStock(nextStock);
        const source = isResearch
          ? `${quote.provider || 'Yahoo Finance'} research quote · delayed, not live`
          : `${quote.provider || 'Market provider'} live quote`;
        const published = quote.timestamp ? ` · published ${formatPublishedTime(quote.timestamp)}` : '';
        setDataSource(`${source}${published}${quote.isStale ? ' · stale' : ''}`);
        setQuoteError('');
      } catch (error) {
        if (active) {
          setLiveStock((current) => current.price
            ? { ...current, isLive: false, isStale: true }
            : withoutProviderQuote(stock));
          setDataSource('No current provider quote available');
          setQuoteError(error.message || 'The quote provider is unavailable.');
        }
      } finally {
        pending = false;
        if (active) setQuoteLoading(false);
      }
    };

    refreshQuote();
    const intervalId = window.setInterval(refreshQuote, QUOTE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [retryKey, stock]);

  useEffect(() => {
    let active = true;
    setAnnualHistory({ candles: [], provider: '', isResearch: false, loading: true, error: '' });
    const to = Math.floor(Date.now() / 1000);
    marketApi.getCandles(stock.symbol, to - 365 * 24 * 60 * 60, to, 'D')
      .then((payload) => {
        if (!active) return;
        const candles = toCandleData(payload);
        setAnnualHistory({
          candles,
          provider: payload?.provider || '',
          isResearch: payload?.isResearch === true,
          loading: false,
          error: candles.length ? '' : payload?.error || 'No verified daily history is available for this stock.',
        });
      })
      .catch((error) => {
        if (active) setAnnualHistory({ candles: [], provider: '', isResearch: false, loading: false, error: error.message || 'Historical data is unavailable.' });
      });
    return () => { active = false; };
  }, [retryKey, stock.symbol]);

  useEffect(() => {
    if (activeTab !== 'Latest News') return undefined;
    let active = true;
    setNewsState({ items: [], provider: '', loading: true, error: '' });
    marketApi.getMarketNews()
      .then((payload) => {
        if (!active) return;
        const feed = Array.isArray(payload) ? { data: payload } : payload;
        const name = String(stock.name || '').toLowerCase();
        const ticker = symbol.toLowerCase();
        const items = (Array.isArray(feed?.data) ? feed.data : []).filter((item) => {
          const related = [item.symbols, item.relatedSymbols].flatMap((value) => (
            Array.isArray(value) ? value : value ? [value] : []
          ));
          const declaredSymbols = related.map((value) => String(value).toLowerCase());
          if (declaredSymbols.includes(ticker)) return true;
          const text = `${item.headline || ''} ${item.summary || ''}`.toLowerCase();
          return Boolean(name && name.length > 5 && text.includes(name)) || text.includes(ticker);
        }).slice(0, 12);
        setNewsState({
          items,
          provider: feed?.provider || '',
          loading: false,
          error: items.length ? '' : feed?.note || `No publisher headlines were returned for ${symbol}.`,
        });
      })
      .catch((error) => {
        if (active) setNewsState({ items: [], provider: '', loading: false, error: error.message || 'Market news is unavailable.' });
      });
    return () => { active = false; };
  }, [activeTab, stock.name, symbol]);

  const hasPrice = liveStock.symbol === symbol && Number.isFinite(Number(liveStock.price)) && Number(liveStock.price) > 0
    && (liveStock.isLive || liveStock.isResearch || liveStock.isStale);
  const displayedChange = (liveStock.isLive || liveStock.isResearch) && finiteValue(liveStock.change) !== null;
  const { flash: tickFlash, direction: tickDirection } = useTickFlash(hasPrice ? liveStock.price : null, liveStock.changePercent);
  const changeDirection = finiteValue(liveStock.change) === null ? tickDirection
    : Number(liveStock.change) > 0 ? 'up' : Number(liveStock.change) < 0 ? 'down' : 'flat';
  const priceTone = hasPrice ? tickToneClass(tickDirection || changeDirection, tickFlash) : '';
  const quoteTimestamp = liveStock.quoteTimestamp;
  const retryMarketData = () => setRetryKey((current) => current + 1);
  const toggleWatchlist = () => {
    const current = getWatchlist();
    const next = current.includes(symbol) ? current.filter((item) => item !== symbol) : [symbol, ...current];
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    setWatchlisted(next.includes(symbol));
    window.dispatchEvent(new CustomEvent('sharemarket:watchlist-updated', { detail: next }));
  };
  const technicalMetrics = useMemo(() => calculateTechnicalMetrics(annualHistory.candles), [annualHistory.candles]);
  const rangeHigh = annualHistory.candles.length
    ? Math.max(...annualHistory.candles.map((candle) => candle.high))
    : null;
  const rangeLow = annualHistory.candles.length
    ? Math.min(...annualHistory.candles.map((candle) => candle.low))
    : null;
  const week52High = finiteValue(liveStock.week52High) ?? rangeHigh;
  const week52Low = finiteValue(liveStock.week52Low) ?? rangeLow;
  const marketCap = finiteValue(liveStock.marketCap);

  return (
    <div className="page stock-details-page">
      <Link className="back-link stock-details-back" to="/stocks"><ArrowLeft size={16} /> Back to stocks</Link>
      <section className="details-layout">
        <div className="panel detail-panel stock-detail-main">
          <header className="stock-detail-header">
            <div>
              <span className="stock-detail-sector">{stock.sector || 'NSE equity'} · {stock.exchange || 'NSE'}</span>
              <h1>{symbol}</h1>
              <p>{stock.name || symbol}</p>
              <span className={`data-source ${liveStock.isLive ? 'is-live' : liveStock.isResearch ? 'is-research' : 'is-unavailable'}`}>
                <Activity size={13} /> {dataSource}
              </span>
            </div>
            <div className="stock-detail-price">
              <strong key={`${symbol}-${tickFlash || 'steady'}`} className={priceTone}>{hasPrice ? `₹${formatValue(liveStock.price)}` : quoteLoading ? 'Loading quote…' : 'Quote unavailable'}</strong>
              {displayedChange ? (
                <span className={changeDirection === 'up' ? 'gain' : changeDirection === 'down' ? 'loss' : 'price-flat'}>
                  <TickArrow direction={changeDirection} />
                  {Number(liveStock.change) > 0 ? '+' : ''}{formatValue(liveStock.change)} ({Number(liveStock.changePercent) > 0 ? '+' : ''}{formatValue(liveStock.changePercent)}%)
                </span>
              ) : <span>{liveStock.isResearch ? 'Research quote · not live' : liveStock.isStale ? 'Last quote · stale' : 'Waiting for provider quote'}</span>}
              {quoteTimestamp ? <small>Published {formatPublishedTime(quoteTimestamp)}</small> : null}
              {!hasPrice && quoteError ? <button type="button" onClick={retryMarketData} className="quote-retry-button">Retry quote</button> : null}
            </div>
          </header>

          <div className="stock-detail-actions" aria-label="Stock actions">
            <button type="button" className="secondary-button" onClick={toggleWatchlist} aria-pressed={watchlisted}>
              {watchlisted ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
              {watchlisted ? 'In Watchlist' : 'Add to Watchlist'}
            </button>
            <Link className="secondary-button" to={`/compare?add=${encodeURIComponent(symbol)}`}>
              <GitCompareArrows size={16} /> Compare
            </Link>
            <button type="button" className="secondary-button" onClick={retryMarketData}>
              <RefreshCw size={15} /> Refresh data
            </button>
          </div>

          <div className="stock-detail-tabs" role="tablist" aria-label="Stock details sections">
            {TABS.map((tab) => (
              <button
                key={tab}
                id={`stock-tab-${tab.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls="stock-detail-tab-panel"
                className={activeTab === tab ? 'is-active' : ''}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <section id="stock-detail-tab-panel" className="stock-detail-tab-panel" role="tabpanel" aria-labelledby={`stock-tab-${activeTab.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
            {activeTab === 'Chart' ? (
              <LiveChart key={`${symbol}-${retryKey}`} symbol={symbol} stock={liveStock} />
            ) : null}

            {activeTab === 'Overview' ? (
              <div className="stock-detail-overview">
                <section className="stock-detail-stats" aria-label="Latest available stock statistics">
                  {[
                    ['Previous close', liveStock.previousClose], ['Open', liveStock.open],
                    ['Day high', liveStock.high], ['Day low', liveStock.low],
                    ['Volume', liveStock.volume, 0], ['Market cap', marketCap],
                    ['P/E ratio', liveStock.pe], ['EPS', liveStock.eps],
                    ['52-week high', week52High], ['52-week low', week52Low],
                  ].map(([label, value, digits = 2]) => (
                    <div className="stock-detail-stat" key={label}>
                      <span>{label}</span>
                      <strong>{finiteValue(value) === null ? 'Unavailable' : `${label === 'Volume' ? '' : label.includes('cap') ? '₹' : ''}${formatValue(value, digits)}`}</strong>
                    </div>
                  ))}
                </section>
                <section className="stock-detail-info-card">
                  <span>Company overview</span>
                  <h2>{stock.name || symbol}</h2>
                  <p>{stock.description || 'A company overview was not supplied by the current stock catalog.'}</p>
                  <div><span>Sector</span><strong>{stock.sector || 'Unavailable'}</strong></div>
                  <div><span>Exchange</span><strong>{stock.exchange || 'NSE'}</strong></div>
                </section>
                <StockAIInsights stock={liveStock} />
                <PriceAlertForm stock={liveStock} evaluateCurrentPrice={liveStock.isLive === true} />
              </div>
            ) : null}

            {activeTab === 'Fundamentals' ? (
              <div className="stock-detail-stats stock-detail-fundamentals">
                {[
                  ['Market capitalization', liveStock.marketCap, '₹'], ['P/E ratio', liveStock.pe, ''],
                  ['EPS', liveStock.eps, '₹'], ['Dividend yield', liveStock.dividendYield, '%'],
                  ['52-week high', week52High, '₹'], ['52-week low', week52Low, '₹'],
                ].map(([label, value, prefix]) => (
                  <div className="stock-detail-stat" key={label}>
                    <span>{label}</span>
                    <strong>{finiteValue(value) === null ? 'Unavailable' : `${prefix}${formatValue(value)}${prefix === '%' ? '' : ''}`}</strong>
                  </div>
                ))}
                <p className="stock-detail-data-note">Only values returned by the selected quote provider are shown. Missing fundamentals are not estimated.</p>
              </div>
            ) : null}

            {activeTab === 'Financials' ? (
              <ProviderEmptyState
                title="Financial statements unavailable"
                body="The configured market data service does not currently return verified quarterly or annual statements, balance sheets, or cash-flow reports for this stock."
                source={dataSource}
              />
            ) : null}

            {activeTab === 'Technical Analysis' ? (
              <div className="stock-technical-panel">
                <div className="stock-tab-heading">
                  <div><span>Derived from daily provider candles</span><h2>Technical indicators</h2></div>
                  <button type="button" className="secondary-button" onClick={retryMarketData}><RefreshCw size={15} /> Refresh</button>
                </div>
                {annualHistory.loading ? <div className="stock-tab-state" role="status">Loading verified historical bars…</div> : null}
                {!annualHistory.loading && annualHistory.error ? <ProviderEmptyState title="Technical history unavailable" body={annualHistory.error} source={annualHistory.provider} /> : null}
                {!annualHistory.loading && !annualHistory.error ? (
                  <>
                    <div className="stock-detail-stats stock-detail-fundamentals">
                      {[
                        ['Latest close', technicalMetrics.latest, '₹'],
                        ['20-session SMA', technicalMetrics.sma20, '₹'],
                        ['50-session SMA', technicalMetrics.sma50, '₹'],
                        ['14-session RSI', technicalMetrics.rsi14, ''],
                      ].map(([label, value, prefix]) => (
                        <div className="stock-detail-stat" key={label}>
                          <span>{label}</span>
                          <strong>{finiteValue(value) === null ? 'Insufficient bars' : `${prefix}${formatValue(value)}`}</strong>
                        </div>
                      ))}
                    </div>
                    <p className="stock-detail-data-note">
                      {technicalMetrics.candleCount} verified daily bars · {annualHistory.provider || 'Provider'}
                      {annualHistory.isResearch ? ' · delayed research data, not live' : ''}
                      {technicalMetrics.latestBarTime ? ` · latest bar ${formatPublishedTime(technicalMetrics.latestBarTime, false)}` : ''}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'Shareholding Pattern' ? (
              <ProviderEmptyState
                title="Shareholding data unavailable"
                body="A verified shareholding-pattern feed is not configured for this stock. Promoter, FII, DII, and public holding percentages are not inferred."
                source={dataSource}
              />
            ) : null}

            {activeTab === 'Company Profile' ? (
              <section className="stock-detail-info-card stock-profile-card">
                <span>Company profile</span>
                <h2>{stock.name || symbol}</h2>
                <p>{stock.description || 'A detailed company profile was not supplied by the current stock catalog.'}</p>
                <div><span>Symbol</span><strong>{symbol}</strong></div>
                <div><span>Exchange</span><strong>{stock.exchange || 'NSE'}</strong></div>
                <div><span>Sector</span><strong>{stock.sector || 'Unavailable'}</strong></div>
                <div><span>Industry</span><strong>{stock.industry || 'Unavailable'}</strong></div>
              </section>
            ) : null}

            {activeTab === 'Latest News' ? (
              <section className="stock-news-panel">
                <div className="stock-tab-heading"><div><span>Publisher headlines matching this company</span><h2><Newspaper size={19} /> Latest news</h2></div></div>
                {newsState.loading ? <div className="stock-tab-state" role="status">Loading market headlines…</div> : null}
                {!newsState.loading && newsState.items.length ? newsState.items.map((item, index) => (
                  <article className="stock-news-item" key={item.id || `${item.headline}-${index}`}>
                    <div><strong>{item.headline}</strong><p>{item.summary || 'Open the publisher source for the full story.'}</p><span>{item.source || newsState.provider || 'Market feed'} · {formatPublishedTime(item.datetime)}</span></div>
                    {item.url ? <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Read: ${item.headline}`}><ArrowUpRight size={17} /></a> : null}
                  </article>
                )) : null}
                {!newsState.loading && newsState.error ? <ProviderEmptyState title="No matching headlines" body={newsState.error} source={newsState.provider} /> : null}
              </section>
            ) : null}
          </section>
        </div>
        <TradeBox stock={liveStock} />
      </section>
    </div>
  );
};

const ProviderEmptyState = ({ title, body, source }) => (
  <div className="stock-provider-empty">
    <ShieldAlert size={20} />
    <div><h2>{title}</h2><p>{body}</p>{source ? <span>Data source: {source}</span> : null}</div>
  </div>
);

export default StockDetails;
