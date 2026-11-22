import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import './StockCard.css';

import CompanyLogo from './CompanyLogo';
import Chart from './Chart';
import { TickArrow, tickToneClass, useTickFlash } from './PriceChange';
import { getStockCardHistory } from '../services/stockHistory';

const StockCard = ({ stock, variant = 'default' }) => {
  const navigate = useNavigate();
  const cardRef = useRef(null);
  const [historyState, setHistoryState] = useState({ symbol: '', candles: [], provider: null, isResearch: false, loading: false });
  const [historyRetry, setHistoryRetry] = useState(0);
  const symbol = String(stock.symbol || '').trim().toUpperCase();
  const exchange = String(stock.exchange || 'NSE').trim().toUpperCase();
  const stockHref = `/stocks/${encodeURIComponent(symbol)}`;
  const quoteTimestamp = stock.quoteTimestamp ?? stock.timestamp;
  const quoteDate = quoteTimestamp === null || quoteTimestamp === undefined || quoteTimestamp === ''
    ? null
    : new Date(Number.isFinite(Number(quoteTimestamp))
      ? Number(quoteTimestamp) < 1e12 ? Number(quoteTimestamp) * 1000 : Number(quoteTimestamp)
      : quoteTimestamp);
  const quoteTimeLabel = quoteDate && Number.isFinite(quoteDate.getTime())
    ? quoteDate.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : null;

  useEffect(() => {
    let active = true;
    let requested = false;
    const loadHistory = () => {
      if (requested || !symbol) return;
      requested = true;
      setHistoryState({ symbol, candles: [], provider: null, isResearch: false, loading: true });
      getStockCardHistory(symbol, exchange)
        .then((result) => {
          if (active) setHistoryState({ symbol, ...result, loading: false });
        })
        .catch(() => {
          if (active) setHistoryState({ symbol, candles: [], provider: null, isResearch: false, loading: false });
        });
    };

    if (!cardRef.current || typeof IntersectionObserver === 'undefined') {
      loadHistory();
      return () => { active = false; };
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadHistory();
      }
    }, { rootMargin: '180px 0px' });
    observer.observe(cardRef.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [exchange, historyRetry, symbol]);

  const handleCardClick = (event) => {
    if (event.target.closest('a, button, input, select, textarea')) return;
    navigate(stockHref);
  };
  const handleCardKeyDown = (event) => {
    if (event.target !== event.currentTarget || event.key !== 'Enter') return;
    event.preventDefault();
    navigate(stockHref);
  };
  const history = historyState.symbol === symbol ? historyState.candles : [];
  const hasChartHistory = history.length >= 2;
  const historyStatus = historyState.symbol !== symbol || historyState.loading
    ? 'Loading published candles…'
    : hasChartHistory
      ? `Historical OHLC · ${historyState.provider || 'Market data provider'}${historyState.isResearch ? ' · delayed research' : ''}`
      : 'Historical candle data unavailable';

  const rawPrice = Number(stock.price);
  const hasRawPrice = Number.isFinite(rawPrice) && rawPrice > 0;
  const change = stock.change === null || stock.change === undefined || stock.change === ''
    ? Number.NaN
    : Number(stock.change);
  const changePercent = stock.changePercent === null || stock.changePercent === undefined || stock.changePercent === ''
    ? Number.NaN
    : Number(stock.changePercent);
  const isLive = hasRawPrice && stock.isLive === true && stock.isDemo !== true && stock.isStale !== true;
  const isResearch = hasRawPrice && stock.isResearch === true && stock.isLive !== true;
  const isStale = hasRawPrice && !isLive && stock.isStale === true;
  const isDemo = false;
  const price = hasRawPrice && (isLive || isResearch || isStale) ? rawPrice : null;
  const hasPrice = price !== null;
  const hasChange = Number.isFinite(change);
  const hasChangePercent = Number.isFinite(changePercent);
  const hasCurrentQuote = isLive || isResearch || isStale;
  const { flash: tickFlash } = useTickFlash(hasCurrentQuote ? price : null, hasChangePercent ? changePercent : null, symbol);
  const flash = stock.flash === 'up' || stock.flash === 'down' ? stock.flash : tickFlash;
  const changeDirection = hasCurrentQuote && hasChangePercent
    ? changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : null
    : null;
  const lastTick = flash
    || (stock.lastTick === 'up' || stock.lastTick === 'down' ? stock.lastTick : null);
  const priceDirection = hasCurrentQuote ? lastTick || changeDirection : null;
  const priceTone = tickToneClass(hasCurrentQuote ? (changePercent === 0 ? 'flat' : priceDirection) : null, flash);
  const priceFlashKey = flash
    ? `${stock.symbol}-${stock.quoteUpdatedAt || stock.timestamp || price}-${flash}`
    : `${stock.symbol}-steady`;
  const hasDisplayChange = hasPrice && hasCurrentQuote && hasChange && hasChangePercent;
  const formattedPrice = hasPrice
    ? `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Quote unavailable';

  if (variant === 'market') {
    return (
      <article
        ref={cardRef}
        className="stock-card market-stock-card"
        role="link"
        tabIndex={0}
        aria-label={`View ${stock.name || stock.symbol} stock details`}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
      >
        <CompanyLogo symbol={stock.symbol} name={stock.name} size={38} />
        <div className="market-stock-name">{stock.symbol}</div>
        <div className="market-stock-price-block">
          <span className="market-stock-price-label">{isDemo ? 'Demo quote · not real' : isResearch ? `Research quote · not live · ${isStale ? 'stale · ' : ''}${stock.dataSource || 'Yahoo Finance'}` : isLive ? `Current price · ${stock.dataSource || 'market provider'}` : isStale ? 'Last quote · stale' : 'Live quote required'}</span>
          <div key={priceFlashKey} className={`market-stock-price stock-price-value ${priceTone}`}>
            {formattedPrice} {hasDisplayChange ? <TickArrow direction={lastTick || (changePercent === 0 ? 'flat' : changeDirection)} /> : null}
          </div>
        </div>
        <div className={`market-stock-change ${hasDisplayChange ? changePercent === 0 ? 'price-flat' : `price-${changeDirection}` : ''}`}>{hasDisplayChange
          ? `${change > 0 ? '+' : ''}${change.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)`
          : '—'}</div>
        <div className="market-stock-meta">
          <span>Market cap <b>{stock.marketCap || '-'}</b></span>
          <span>Volume <b>{stock.volume || '-'}</b></span>
        </div>
        <div className="market-stock-footer">
          <ArrowUpRight size={24} /> {isLive ? 'Live provider quote received' : isResearch ? 'Research data · not live' : isStale ? 'Last provider quote · stale' : 'Connect a live market provider'}
        </div>
        <Link to={stockHref} className="stock-card-details-button" onClick={(event) => event.stopPropagation()}>
          View Details <ArrowUpRight size={15} />
        </Link>
      </article>
    );
  }

  return (
    <article
      ref={cardRef}
      className="stock-card"
      role="link"
      tabIndex={0}
      aria-label={`View ${stock.name || stock.symbol} stock details`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div className="stock-header">
        <div>
          <div className="stock-title">
            <CompanyLogo symbol={stock.symbol} name={stock.name} size={36} />
            <div>
              <strong>{stock.symbol}</strong>
              <span>{stock.name}</span>
            </div>
          </div>
        </div>
        <Link
          to={stockHref}
          onClick={(event) => event.stopPropagation()}
          aria-label={`View quote and details for ${stock.symbol}`}
          className={hasDisplayChange ? (changeDirection === 'up' ? 'pill gain-pill' : changeDirection === 'down' ? 'pill loss-pill' : 'pill neutral-pill') : 'pill neutral-pill'}
        >
          {hasDisplayChange ? (
            <>
              <TickArrow direction={changePercent === 0 ? 'flat' : changeDirection} />
              {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
            </>
          ) : 'Quote'}
        </Link>
      </div>
      <div className="stock-card-chart">
        <Chart data={history} height={82} symbol={stock.symbol} loading={historyState.loading || historyState.symbol !== symbol} />
        <span className={`stock-chart-note${hasChartHistory ? '' : ' is-preview'}`}>
          {historyStatus}
          {hasChartHistory && history.at(-1)?.time ? ` · latest ${new Date(history.at(-1).time * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}
        </span>
        {!historyState.loading && !hasChartHistory ? (
          <button type="button" className="stock-card-history-retry" onClick={() => setHistoryRetry((current) => current + 1)}>
            Retry history
          </button>
        ) : null}
      </div>
      <div className="stock-footer">
        <div className="stock-current-price">
          <span>{isDemo ? 'Demo quote · not real' : isResearch ? `Research quote · not live · ${isStale ? 'stale · ' : ''}${stock.dataSource || 'Yahoo Finance'}` : isLive ? `Current price · ${stock.dataSource || 'market provider'}` : isStale ? 'Last quote · stale' : 'Live quote required'}</span>
          <b key={priceFlashKey} className={`stock-price-value ${priceTone}`}>{formattedPrice}</b>
        </div>
        <span>{stock.dataSource || (isStale ? 'Last provider quote' : stock.sector)}{hasCurrentQuote && quoteTimeLabel ? ` · ${isStale ? 'as of' : 'published'} ${quoteTimeLabel} IST` : ''}</span>
      </div>
      <Link to={stockHref} className="stock-card-details-button" onClick={(event) => event.stopPropagation()}>
        View Details <ArrowUpRight size={15} />
      </Link>
    </article>
  );
};

export default StockCard;
