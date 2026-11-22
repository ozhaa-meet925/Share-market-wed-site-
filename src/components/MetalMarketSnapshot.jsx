import { ArrowDownRight, ArrowUpRight, BellPlus, Clock3, Radio, WifiOff } from 'lucide-react';
import './MetalMarketSnapshot.css';

const formatPrice = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? `₹${number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Price unavailable';
};

const formatQuoteTime = (value) => {
  if (!value) return 'Provider timestamp unavailable';
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) && numeric < 1e12 ? numeric * 1000 : value);
  if (!Number.isFinite(date.getTime())) return 'Provider timestamp unavailable';
  return `Provider time ${date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })} IST`;
};

const getQuoteStatus = (quote) => {
  if (!quote) return { label: 'Unavailable', tone: 'unavailable' };
  if (quote.isStale === true) return { label: 'Stale · latest available', tone: 'stale' };
  if (quote.isLive === true && quote.isDemo !== true) return { label: 'Live MCX', tone: 'live' };
  if (quote.isDelayed === true || quote.isResearch === true || quote.marketType === 'benchmark' || quote.marketType === 'spot') {
    return { label: 'Delayed reference · not live MCX', tone: 'delayed' };
  }
  return { label: 'Provider quote · live status unconfirmed', tone: 'unavailable' };
};

const MetalMarketSnapshot = ({ name, quote, market, unit }) => {
  const status = getQuoteStatus(quote);
  const change = Number(quote?.d);
  const changePercent = Number(quote?.dp);
  const hasChange = Number.isFinite(change) && Number.isFinite(changePercent);
  const direction = hasChange ? (change > 0 ? 'up' : change < 0 ? 'down' : 'flat') : 'unknown';
  const provider = quote?.provider || (quote?.liveFeed === 'upstox' ? 'Upstox MCX' : 'Provider unavailable');
  const sessions = market?.morningSession && market?.eveningSession
    ? `${market.morningSession} and ${market.eveningSession} IST`
    : 'MCX session schedule unavailable';

  return (
    <section className="metal-market-snapshot" aria-label={`${name} market summary`}>
      <div className="metal-snapshot-primary">
        <span className="metal-snapshot-eyebrow">{status.tone === 'live' ? <Radio size={14} /> : <WifiOff size={14} />} {name} · ₹/{unit}</span>
        <strong>{formatPrice(quote?.c)}</strong>
        <span className={`metal-snapshot-status is-${status.tone}`}>
          <i aria-hidden="true" />{status.label}
        </span>
      </div>
      <div className="metal-snapshot-facts">
        <div className={`metal-snapshot-change is-${direction}`}>
          <span>Daily change</span>
          <strong>
            {hasChange ? <>{direction === 'up' ? <ArrowUpRight size={16} /> : direction === 'down' ? <ArrowDownRight size={16} /> : null}{change > 0 ? '+' : change < 0 ? '-' : ''}₹{Math.abs(change).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%)</> : 'Unavailable'}
          </strong>
        </div>
        <div>
          <span>Price source</span>
          <strong>{provider}</strong>
        </div>
        <div>
          <span>Quote timestamp</span>
          <strong><Clock3 size={14} /> {formatQuoteTime(quote?.priceTimestamp || quote?.timestamp)}</strong>
        </div>
        <div>
          <span>MCX market</span>
          <strong>{market?.status || 'Status unavailable'}</strong>
          <small>{sessions}</small>
        </div>
      </div>
      <a className="metal-snapshot-alert" href="#price-alerts"><BellPlus size={16} /> Set price alert</a>
      {!quote || quote.isStale === true || quote.isLive !== true ? (
        <p className="metal-snapshot-note" role="status">
          {quote?.liveFallbackReason || (quote?.isStale ? 'This is the last available quote; it may be out of date.' : 'This price is a reference and is not a live MCX quote.')}
        </p>
      ) : null}
    </section>
  );
};

export default MetalMarketSnapshot;
