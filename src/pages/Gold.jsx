import LiveChart from '../components/LiveChart';
import MetalTradePanel from '../components/MetalTradePanel';
import MetalWatchlistButton from '../components/MetalWatchlistButton';
import MetalInstrumentsPanel from '../components/MetalInstrumentsPanel';
import PriceAlertForm from '../components/PriceAlertForm';
import ZerodhaCommodityPanel from '../components/ZerodhaCommodityPanel';
import BullionInsightsSuite from '../components/BullionInsightsSuite';
import MetalAIInsights from '../components/MetalAIInsights';
import MetalMarketSnapshot from '../components/MetalMarketSnapshot';
import { useMetalQuotes } from '../hooks/useMetalQuotes';
import {
  isBenchmarkMetalQuote,
  isLiveMetalQuote,
  metalBySymbol,
  metalQuoteSourceLabel,
} from '../data/metals';
import { ArrowUpRight, Coins, Info, ShoppingCart, Sparkles } from 'lucide-react';

const goldContract = {
  symbol: 'MCX:GOLD',
  name: 'Gold',
  sector: 'Commodity',
};

const Gold = () => {
  const { quotes, market, error } = useMetalQuotes();
  const quote = quotes.get('GOLD');
  const goldPrice = Number.isFinite(Number(quote?.c)) && Number(quote.c) > 0 ? Number(quote.c) : null;
  const silverQuote = quotes.get('SILVER');
  const silverPrice = Number.isFinite(Number(silverQuote?.c)) && Number(silverQuote.c) > 0 ? Number(silverQuote.c) : null;
  const isLive = isLiveMetalQuote(quote);
  const isFuturesReference = isBenchmarkMetalQuote(quote);
  const sourceLabel = metalQuoteSourceLabel(quote);
  const marketLabel = market?.isOpen ? 'MCX market open' : 'MCX market closed';

  return (
    <div className="page commodity-detail-page gold-page">
      <section className="gold-hero" aria-labelledby="gold-page-title">
        <div className="gold-hero-copy">
          <span className="gold-eyebrow"><Sparkles size={15} /> MCX METALS MARKET</span>
          <h1 id="gold-page-title">MCX Gold (₹/10g)</h1>
          <p>Track MCX Gold in rupees per 10 grams (24K), follow the move across 1D to 5Y charts, and place paper trades in MCX contract units.</p>
          <div className="gold-hero-tags" aria-label="Gold price details">
            <span><Coins size={15} /> {isLive ? 'Upstox MCX Gold Future' : isFuturesReference ? 'COMEX Gold Reference' : 'XAU/USD Spot Reference'}</span>
            <span>₹ per 10g</span>
            <span>{sourceLabel}</span>
            <span>{marketLabel}</span>
          </div>
          {!isLive && quote?.liveFallbackReason ? (
            <p className="metal-live-note" role="status">
              <Info size={14} /> Live MCX feed not connected. {quote.liveFallbackReason} This card shows a verified {isFuturesReference ? 'Yahoo Finance COMEX futures reference' : 'spot reference'}, not a live exchange tick.
            </p>
          ) : null}
          <div className="metal-hero-actions">
            <MetalWatchlistButton symbol="GOLD" name="Gold" />
            <a href="#metal-trade" className="primary-button metal-trade-link">
              <ShoppingCart size={15} /> Trade gold
            </a>
          </div>
        </div>
        <div className="gold-hero-art" aria-hidden="true">
          <div className="gold-coin-mark"><span>Au</span><i>24K</i></div>
          <span className="gold-art-spark gold-art-spark-one">✦</span>
          <span className="gold-art-spark gold-art-spark-two">✧</span>
        </div>
      </section>

      <MetalMarketSnapshot name="Gold" quote={quote} market={market} unit="10g" />

      <div className="gold-chart-heading">
        <div>
          <span>MARKET PRICE</span>
          <h2>Gold price chart</h2>
        </div>
        <p>{error || (isLive
          ? 'Live Upstox MCX quote with verified history from 1D through 5Y.'
          : `${isFuturesReference ? 'Yahoo Finance COMEX futures' : 'Delayed spot price'} with verified history from 1D through 5Y.`)}</p>
      </div>

      <div className="metal-market-layout">
        <LiveChart stock={goldContract} assetType="commodity" />
        <MetalTradePanel metal={metalBySymbol.get('GOLD')} quote={quote} />
      </div>

      {/* Zerodha Kite Style MCX Trading Desk & Margin Calculator */}
      {goldPrice !== null ? (
        <>
          <ZerodhaCommodityPanel metal="GOLD" currentPrice={goldPrice} />
          <BullionInsightsSuite metal="GOLD" basePrice={goldPrice} goldPrice={goldPrice} silverPrice={silverPrice} />
        </>
      ) : (
        <p className="metal-live-note" role="status">
          <Info size={14} /> The gold trading desk and bullion calculators need a verified gold price, and every provider is unavailable right now.
        </p>
      )}

      <MetalAIInsights metal="GOLD" />

      <MetalInstrumentsPanel activeSymbol="GOLD" quotes={quotes} />

      <PriceAlertForm stock={{ symbol: 'GOLD', price: Number(quote?.c) || null }} />

      <aside className="gold-data-card" aria-label="Gold price source information">
        <span className="gold-info-icon"><Info size={18} /></span>
        <div className="gold-data-copy">
          <div className="gold-data-heading">
            <h2>About this price</h2>
            <a href={isLive ? 'https://upstox.com' : isFuturesReference ? 'https://finance.yahoo.com/quote/GC%3DF/' : 'https://goldprice.dev'} target="_blank" rel="noreferrer">
              {isLive ? 'Upstox source' : isFuturesReference ? 'Yahoo Finance source' : 'Free spot source'} <ArrowUpRight size={15} />
            </a>
          </div>
          <p>{isLive
            ? 'The price card shows the live Upstox MCX gold front-month quote in ₹ per 10g. Chart candles come from COMEX gold futures (GC=F) converted with the USD/INR rate, so chart history is research data — not MCX settlement prices. Buy and Sell buttons place paper orders in the virtual ledger only.'
            : isFuturesReference
              ? 'The price card uses Yahoo Finance COMEX gold futures (GC=F) converted to ₹ per 10g with the Yahoo Finance USD/INR rate. Chart candles use the same futures research series. These are delayed references, not MCX settlement prices. Buy and Sell buttons place paper orders in the virtual ledger only.'
              : 'The price card uses an international XAU/INR spot reference converted to ₹ per 10g and delayed by about 15 minutes. Chart candles come from COMEX gold futures (GC=F) converted with the USD/INR rate, so they are research history — not MCX settlement prices. Buy and Sell buttons place paper orders in the virtual ledger only.'}</p>
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

export default Gold;
