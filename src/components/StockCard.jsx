import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import './StockCard.css';

import CompanyLogo from './CompanyLogo';
import Chart from './Chart';

const StockCard = ({ stock, variant = 'default' }) => {
  const providedPrice = Number(stock.price);
  const hasProvidedPrice = Number.isFinite(providedPrice) && providedPrice > 0;
  const price = hasProvidedPrice ? providedPrice : null;
  const change = stock.change === null || stock.change === undefined || stock.change === ''
    ? Number.NaN
    : Number(stock.change);
  const changePercent = stock.changePercent === null || stock.changePercent === undefined || stock.changePercent === ''
    ? Number.NaN
    : Number(stock.changePercent);
  const hasPrice = Number.isFinite(price) && price > 0;
  const hasChange = Number.isFinite(change);
  const hasChangePercent = Number.isFinite(changePercent);
  const isLive = hasProvidedPrice && stock.isLive === true && stock.isDemo !== true;
  const isStale = hasProvidedPrice && !isLive && stock.isStale === true;
  const isDemo = stock.isDemo === true && hasProvidedPrice;
  const isResearch = stock.isResearch === true && hasProvidedPrice;
  const hasCurrentQuote = isLive || isDemo || isResearch;
  const changeDirection = hasCurrentQuote && hasChangePercent
    ? changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : null
    : null;
  const lastTick = stock.flash === 'up' || stock.flash === 'down'
    ? stock.flash
    : stock.lastTick === 'up' || stock.lastTick === 'down' ? stock.lastTick : null;
  const priceDirection = hasCurrentQuote ? lastTick || changeDirection : null;
  const priceTone = priceDirection ? `price-${priceDirection}` : 'price-neutral';
  const priceFlash = hasCurrentQuote && stock.flash ? `price-flash-${stock.flash}` : '';
  const priceFlashKey = stock.flash
    ? `${stock.symbol}-${stock.quoteUpdatedAt || stock.timestamp || price}-${stock.flash}`
    : `${stock.symbol}-steady`;
  const hasDisplayChange = hasPrice && hasCurrentQuote && hasChange && hasChangePercent;
  const TrendIcon = changeDirection === 'down' ? ArrowDownRight : ArrowUpRight;
  const hasChartHistory = Array.isArray(stock.history) && stock.history.length >= 7;
  const formattedPrice = hasPrice
    ? `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Quote unavailable';

  if (variant === 'market') {
    return (
      <Link to={`/stocks/${stock.symbol}`} className="stock-card market-stock-card">
        <CompanyLogo symbol={stock.symbol} name={stock.name} size={38} />
        <div className="market-stock-name">{stock.symbol}</div>
        <div className="market-stock-price-block">
          <span className="market-stock-price-label">{isDemo ? 'Demo quote · not real' : isResearch ? `Research quote · not live · ${isStale ? 'stale · ' : ''}${stock.dataSource || 'Yahoo Finance'}` : isLive ? `Current price · ${stock.dataSource || 'market provider'}` : isStale ? 'Last quote · stale' : 'Live quote required'}</span>
          <div key={priceFlashKey} className={`market-stock-price stock-price-value ${priceTone} ${priceFlash}`}>
            {formattedPrice} {hasDisplayChange && changeDirection ? <TrendIcon size={18} /> : null}
          </div>
        </div>
        <div className={`market-stock-change ${hasDisplayChange && changeDirection ? `price-${changeDirection}` : ''}`}>{hasDisplayChange
          ? `${change > 0 ? '+' : ''}${change.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)`
          : '—'}</div>
        <div className="market-stock-meta">
          <span>Market cap <b>{stock.marketCap || '-'}</b></span>
          <span>Volume <b>{stock.volume || '-'}</b></span>
        </div>
        <div className="market-stock-footer">
          <ArrowUpRight size={24} /> {isLive ? 'Live provider quote received' : isResearch ? 'Research data · not live' : isStale ? 'Last provider quote · stale' : 'Connect a live market provider'}
        </div>
      </Link>
    );
  }

  return (
    <Link to={`/stocks/${stock.symbol}`} className="stock-card">
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
        <div className={hasDisplayChange ? (changeDirection === 'up' ? 'pill gain-pill' : changeDirection === 'down' ? 'pill loss-pill' : 'pill neutral-pill') : 'pill neutral-pill'}>
          {hasDisplayChange ? (
            <>
              {changeDirection ? <TrendIcon size={15} /> : null}
              {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
            </>
          ) : 'Quote'}
        </div>
      </div>
      <div className="stock-card-chart">
        <Chart data={stock.history} positive={changeDirection !== 'down'} height={82} symbol={stock.symbol} />
        <span className={hasChartHistory ? 'stock-chart-note' : 'stock-chart-note is-preview'}>
          {hasChartHistory
            ? isDemo ? 'Simulated quote snapshots · not market history' : 'Session quote snapshots · not provider candle history'
            : 'Illustrative preview · historical prices unavailable'}
        </span>
      </div>
      <div className="stock-footer">
        <div className="stock-current-price">
          <span>{isDemo ? 'Demo quote · not real' : isResearch ? `Research quote · not live · ${isStale ? 'stale · ' : ''}${stock.dataSource || 'Yahoo Finance'}` : isLive ? `Current price · ${stock.dataSource || 'market provider'}` : isStale ? 'Last quote · stale' : 'Live quote required'}</span>
          <b key={priceFlashKey} className={`stock-price-value ${priceTone} ${priceFlash}`}>{formattedPrice}</b>
        </div>
        <span>{stock.dataSource || (isStale ? 'Last provider quote' : stock.sector)}</span>
      </div>
    </Link>
  );
};

export default StockCard;
