import LiveChart from '../components/LiveChart';
import MetalTradePanel from '../components/MetalTradePanel';
import MetalWatchlistButton from '../components/MetalWatchlistButton';
import MetalInstrumentsPanel from '../components/MetalInstrumentsPanel';
import ZerodhaCommodityPanel from '../components/ZerodhaCommodityPanel';
import BullionInsightsSuite from '../components/BullionInsightsSuite';
import MetalAIInsights from '../components/MetalAIInsights';
import PriceAlertForm from '../components/PriceAlertForm';
import { useMetalQuotes } from '../hooks/useMetalQuotes';
import {
  isBenchmarkMetalQuote,
  isLiveMetalQuote,
  metalBySymbol,
  metalQuoteSourceLabel,
} from '../data/metals';
import { ArrowUpRight, CircleDollarSign, Info, ShoppingCart, Sparkles } from 'lucide-react';

const silverContract = {
  symbol: 'MCX:SILVER',
  name: 'Silver',
  sector: 'Commodity',
};

const Silver = () => {
  const { quotes, market, error } = useMetalQuotes();
  const quote = quotes.get('SILVER');
  const silverPrice = Number.isFinite(Number(quote?.c)) && Number(quote.c) > 0 ? Number(quote.c) : null;
  const goldQuote = quotes.get('GOLD');
  const goldPrice = Number.isFinite(Number(goldQuote?.c)) && Number(goldQuote.c) > 0 ? Number(goldQuote.c) : null;
  const isLive = isLiveMetalQuote(quote);
  const isFuturesReference = isBenchmarkMetalQuote(quote);
  const sourceLabel = metalQuoteSourceLabel(quote);
  const marketLabel = market?.isOpen ? 'MCX market open' : 'MCX market closed';

  return (
    <div className="page silver-page">
      <section className="silver-hero" aria-labelledby="silver-page-title">
        <div className="silver-hero-copy">
          <span className="silver-eyebrow"><Sparkles size={15} /> MCX METALS MARKET</span>
          <h1 id="silver-page-title">MCX Silver (₹/kg)</h1>
          <p>Follow MCX Silver in rupees per kilogram, review daily ranges and 52-week bands, and paper-trade in grams with full order simulation.</p>
          <div className="silver-hero-tags" aria-label="Silver quote details">
            <span><CircleDollarSign size={15} /> {isLive ? 'Upstox MCX Silver Future' : isFuturesReference ? 'COMEX Silver Reference' : 'XAG/USD Spot Reference'}</span>
            <span>₹ per kg</span>
            <span>{sourceLabel}</span>
            <span>{marketLabel}</span>
          </div>
          {!isLive && quote?.liveFallbackReason ? (
            <p className="metal-live-note" role="status">
              <Info size={14} /> Live MCX feed not connected. {quote.liveFallbackReason} This card shows a verified {isFuturesReference ? 'Yahoo Finance COMEX futures reference' : 'spot reference'}, not a live exchange tick.
            </p>
          ) : null}
          <div className="metal-hero-actions">
            <MetalWatchlistButton symbol="SILVER" name="Silver" />
            <a href="#metal-trade" className="primary-button metal-trade-link">
              <ShoppingCart size={15} /> Trade silver
            </a>
          </div>
        </div>
        <div className="silver-coin-art" aria-hidden="true"><span>Ag</span><i>.999</i></div>
      </section>

      <div className="silver-chart-heading">
        <div><span>MARKET PRICE</span><h2>Silver price chart</h2></div>
        <p>{error || (isLive
          ? 'Live Upstox MCX quote with verified history from 1D through 5Y.'
          : `${isFuturesReference ? 'Yahoo Finance COMEX futures' : 'Delayed spot price'} with verified history from 1D through 5Y.`)}</p>
      </div>

      <div className="metal-market-layout">
        <LiveChart stock={silverContract} assetType="silver" />
        <MetalTradePanel metal={metalBySymbol.get('SILVER')} quote={quote} />
      </div>

      {/* Zerodha Kite Style MCX Trading Desk & Margin Calculator */}
      {silverPrice !== null ? (
        <>
          <ZerodhaCommodityPanel metal="SILVER" currentPrice={silverPrice} />
          <BullionInsightsSuite metal="SILVER" basePrice={silverPrice} goldPrice={goldPrice} silverPrice={silverPrice} />
        </>
      ) : (
        <p className="metal-live-note" role="status">
          <Info size={14} /> The silver trading desk and bullion calculators need a verified silver price, and every provider is unavailable right now.
        </p>
      )}

      <MetalAIInsights metal="SILVER" />

      <MetalInstrumentsPanel activeSymbol="SILVER" quotes={quotes} />

      <PriceAlertForm stock={{ symbol: 'SILVER', price: Number(quote?.c) || null }} />

      <aside className="silver-data-card" aria-label="Silver price source information">
        <span className="silver-info-icon"><Info size={18} /></span>
        <div className="silver-data-copy">
          <div className="silver-data-heading">
            <h2>About this price</h2>
            <a href={isLive ? 'https://upstox.com' : isFuturesReference ? 'https://finance.yahoo.com/quote/SI%3DF/' : 'https://goldprice.dev'} target="_blank" rel="noreferrer">
              {isLive ? 'Upstox source' : isFuturesReference ? 'Yahoo Finance source' : 'Free spot source'} <ArrowUpRight size={15} />
            </a>
          </div>
          <p>{isLive
            ? 'The price card shows the live Upstox MCX silver front-month quote in ₹ per kilogram. Chart candles use COMEX silver futures (SI=F) converted with the USD/INR rate, so chart history is research data — not MCX settlement prices. Buy and Sell buttons place paper orders only.'
            : isFuturesReference
              ? 'The price card uses Yahoo Finance COMEX silver futures (SI=F) converted to ₹ per kilogram with the Yahoo Finance USD/INR rate. Chart candles use the same futures research series. These are delayed references, not MCX settlement prices. Buy and Sell buttons place paper orders only.'
              : 'The price card uses an international XAG/INR spot reference converted to ₹ per kilogram and is delayed by about 15 minutes. Chart candles use COMEX silver futures (SI=F) converted with the USD/INR rate, so they are delayed research history, not MCX settlement prices. Buy and Sell buttons place paper orders only.'}</p>
          <div className="gold-data-tags">
            <span>Taxes and making charges excluded</span>
            <span>{isLive ? 'Live MCX quote' : isFuturesReference ? 'Delayed futures · not live' : 'Delayed spot · not live'}</span>
            <span>Paper trading only · no broker order</span>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default Silver;
