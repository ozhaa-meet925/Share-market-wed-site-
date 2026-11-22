import { CircleDollarSign } from 'lucide-react';
import { TickArrow, tickToneClass, useTickFlash } from './PriceChange';

const formatTime = (value) => {
  if (!value) return 'Waiting for provider quote';
  const date = typeof value === 'number' || /^\d+$/.test(String(value))
    ? new Date(Number(value) < 1e12 ? Number(value) * 1000 : Number(value))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Waiting for provider quote' : `Published ${date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })} IST`;
};

const SilverCard = ({ quote }) => {
  const hasQuote = Number(quote?.c) > 0;
  const isLive = quote?.isLive === true && hasQuote;
  const isDemo = quote?.isDemo === true && hasQuote;
  const isSpot = quote?.marketType === 'spot';
  const isBenchmark = quote?.marketType === 'benchmark';
  const isStale = quote?.isStale === true && hasQuote;
  const isDelayed = quote?.isDelayed === true && hasQuote;
  const change = Number(quote?.d);
  const dayDirection = !Number.isFinite(change) ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const { flash: tickFlash } = useTickFlash(hasQuote ? Number(quote.c) : null, null, 'SILVER');
  const priceTone = hasQuote && (isLive || isDemo || quote?.isReal === true)
    ? tickToneClass(tickFlash || dayDirection, tickFlash)
    : '';
  return (
    <article className="commodity-card silver-card">
      <div className="commodity-icon"><CircleDollarSign size={22} /></div>
      <div>
        <span>{isLive ? 'MCX:SILVER · Live MCX future' : isBenchmark ? 'SILVER · COMEX futures reference' : isSpot ? 'SILVER · International spot reference' : 'SILVER · Provider quote'}</span>
        <h3 key={tickFlash ? `silver-${tickFlash}` : 'silver-steady'} className={priceTone}>{hasQuote ? `₹${Number(quote.c).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Quote unavailable'}</h3>
        <p>{isLive ? 'Live MCX Exchange · ₹ per kg' : isBenchmark ? 'Delayed COMEX × USD/INR · ₹ per kg · not MCX' : isSpot ? 'International spot · ₹ per kg · not MCX' : `Quote unit ${quote?.unit || 'INR/kg'}`}</p>
        {Number(quote?.inrPerGram) > 0 && <small>₹{Number(quote.inrPerGram).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/g{Number(quote?.sourcePriceUsd) > 0 ? ` · $${Number(quote.sourcePriceUsd).toLocaleString('en-US', { maximumFractionDigits: 3 })}/${quote.sourcePriceUnit || 'troy oz'}` : ''}{Number(quote?.usdInr) > 0 ? ` · USD/INR ${Number(quote.usdInr).toFixed(4)}` : ''}</small>}
        <small>{hasQuote ? `${isDemo ? 'Simulated demo feed · not real market data' : isStale ? `Last ${quote.provider || 'provider'} quote · stale` : isDelayed ? `Delayed ${quote.provider || 'spot'} quote` : isLive ? `${quote.provider || 'Upstox'} quote` : 'Provider quote'} · ${formatTime(quote.timestamp)}` : 'Connect an Upstox account with MCX market access'}</small>
      </div>
      <strong className={dayDirection ? (dayDirection === 'up' ? 'gain' : dayDirection === 'down' ? 'loss' : 'price-flat') : ''}>
        {(isLive || isDemo || quote?.isReal === true) && Number.isFinite(change) ? <><TickArrow direction={dayDirection} />{`${isDemo ? 'Demo ' : isStale ? 'Last change ' : ''}${change > 0 ? '+' : change < 0 ? '−' : ''}₹${Math.abs(change).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</> : hasQuote ? 'Change unavailable' : 'No quote'}
      </strong>
    </article>
  );
};

export default SilverCard;
