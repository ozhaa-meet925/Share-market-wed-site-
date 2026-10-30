import { Gem } from 'lucide-react';

const formatTime = (value) => {
  if (!value) return 'Waiting for provider quote';
  const date = typeof value === 'number' || /^\d+$/.test(String(value))
    ? new Date(Number(value) < 1e12 ? Number(value) * 1000 : Number(value))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Waiting for provider quote' : `Updated ${date.toLocaleTimeString('en-IN')}`;
};

const GoldCard = ({ quote }) => {
  const hasQuote = Number(quote?.c) > 0;
  const isLive = quote?.isLive === true && hasQuote;
  const isDemo = quote?.isDemo === true && hasQuote;
  const isSpot = quote?.marketType === 'spot';
  const isStale = quote?.isStale === true && hasQuote;
  const isDelayed = quote?.isDelayed === true && hasQuote;
  const change = Number(quote?.d);
  return (
    <article className="commodity-card gold-card">
      <div className="commodity-icon"><Gem size={22} /></div>
      <div>
        <span>{isSpot ? 'Gold · international spot reference' : 'Gold · MCX front-month future'}</span>
        <h3>{hasQuote ? `₹${Number(quote.c).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Quote unavailable'}</h3>
        <p>{isSpot ? `Spot reference · quote unit ${quote.unit || 'INR/10g'}` : `Exchange contract · quote unit ${quote?.unit || 'INR/10g'}`}</p>
        <small>{hasQuote ? `${isDemo ? 'Simulated demo feed · not real market data' : isStale ? `Last ${quote.provider || 'provider'} quote · stale` : isDelayed ? `Delayed ${quote.provider || 'spot'} quote` : isLive ? `${quote.provider || 'Upstox'} quote` : 'Provider quote'} · ${formatTime(quote.timestamp)}` : 'Connect an Upstox account with MCX market access'}</small>
      </div>
      <strong className={isLive || isDemo || quote?.isReal === true ? change >= 0 ? 'gain' : 'loss' : ''}>
        {(isLive || isDemo || quote?.isReal === true) && Number.isFinite(change) ? `${isDemo ? 'Demo ' : isStale ? 'Last change ' : ''}${change >= 0 ? '+' : '−'}₹${Math.abs(change).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : hasQuote ? 'Change unavailable' : 'No quote'}
      </strong>
    </article>
  );
};

export default GoldCard;
