import { Gem } from 'lucide-react';
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

const GoldCard = ({ quote }) => {
  const hasQuote = Number(quote?.c) > 0;
  const isLive = quote?.isLive === true && hasQuote;
  const isDemo = quote?.isDemo === true && hasQuote;
  const isSpot = quote?.marketType === 'spot';
  const isBenchmark = quote?.marketType === 'benchmark';
  const isStale = quote?.isStale === true && hasQuote;
  const isDelayed = quote?.isDelayed === true && hasQuote;
  const change = Number(quote?.d);
  const dayDirection = !Number.isFinite(change) ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const { flash: tickFlash } = useTickFlash(hasQuote ? Number(quote.c) : null, null, 'GOLD');
  const priceTone = hasQuote && (isLive || isDemo || quote?.isReal === true)
    ? tickToneClass(tickFlash || dayDirection, tickFlash)
    : '';
  return (
    <article className="commodity-card gold-card">
      <div className="commodity-icon"><Gem size={22} /></div>
      <div>
        <span>{isLive ? 'MCX:GOLD · Live MCX future' : isBenchmark ? 'GOLD · COMEX futures reference' : isSpot ? 'GOLD · International spot reference' : 'GOLD · Provider quote'}</span>
        <h3 key={tickFlash ? `gold-${tickFlash}` : 'gold-steady'} className={priceTone}>{hasQuote ? `₹${Number(quote.c).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Quote unavailable'}</h3>
        <p>{isLive ? 'Live MCX Exchange · ₹ per 10g' : isBenchmark ? 'Delayed COMEX × USD/INR · ₹ per 10g · not MCX' : isSpot ? 'International spot · ₹ per 10g · not MCX' : `Quote unit ${quote?.unit || 'INR/10g'}`}</p>
        {Number(quote?.inrPerGram) > 0 && <small>₹{Number(quote.inrPerGram).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/g{Number(quote?.sourcePriceUsd) > 0 ? ` · $${Number(quote.sourcePriceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}/${quote.sourcePriceUnit || 'troy oz'}` : ''}{Number(quote?.usdInr) > 0 ? ` · USD/INR ${Number(quote.usdInr).toFixed(4)}` : ''}</small>}
        <small>{hasQuote ? `${isDemo ? 'Simulated demo feed · not real market data' : isStale ? `Last ${quote.provider || 'provider'} quote · stale` : isDelayed ? `Delayed ${quote.provider || 'spot'} quote` : isLive ? `${quote.provider || 'Upstox'} quote` : 'Provider quote'} · ${formatTime(quote.timestamp)}` : 'Connect an Upstox account with MCX market access'}</small>
      </div>
      <strong className={dayDirection ? (dayDirection === 'up' ? 'gain' : dayDirection === 'down' ? 'loss' : 'price-flat') : ''}>
        {(isLive || isDemo || quote?.isReal === true) && Number.isFinite(change) ? <><TickArrow direction={dayDirection} />{`${isDemo ? 'Demo ' : isStale ? 'Last change ' : ''}${change > 0 ? '+' : change < 0 ? '−' : ''}₹${Math.abs(change).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</> : hasQuote ? 'Change unavailable' : 'No quote'}
      </strong>
    </article>
  );
};

export default GoldCard;
