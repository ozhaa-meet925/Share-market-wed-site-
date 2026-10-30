import LiveChart from '../components/LiveChart';
import { ArrowUpRight, CircleDollarSign, Info, Sparkles } from 'lucide-react';

const silverContract = {
  symbol: 'MCX:SILVER',
  name: 'Silver',
  sector: 'Commodity',
};

const Silver = () => (
  <div className="page silver-page">
    <section className="silver-hero" aria-labelledby="silver-page-title">
      <div className="silver-hero-copy">
        <span className="silver-eyebrow"><Sparkles size={15} /> METALS MARKET</span>
        <h1 id="silver-page-title">Silver Market Price</h1>
        <p>Follow the silver market with its price, daily range, and quote source in one clear view.</p>
        <div className="silver-hero-tags" aria-label="Silver quote details">
          <span><CircleDollarSign size={15} /> Silver market</span>
          <span>₹ per kg</span>
          <span>Spot &amp; MCX sources</span>
        </div>
      </div>
      <div className="silver-coin-art" aria-hidden="true"><span>Ag</span><i>.999</i></div>
    </section>

    <div className="silver-chart-heading">
      <div><span>MARKET PRICE</span><h2>Silver price chart</h2></div>
      <p>Choose a range or candle style to explore the chart.</p>
    </div>

    <LiveChart stock={silverContract} assetType="silver" />

    <aside className="silver-data-card" aria-label="Silver price source information">
      <span className="silver-info-icon"><Info size={18} /></span>
      <div className="silver-data-copy">
        <div className="silver-data-heading">
          <h2>About this price</h2>
          <a href="https://goldprice.dev" target="_blank" rel="noreferrer">Free spot source <ArrowUpRight size={15} /></a>
        </div>
        <p>Without an Upstox MCX quote, this page uses an international XAG/INR spot reference converted to ₹ per kg. The free spot feed is delayed; this is not a city retail price and excludes taxes and making charges.</p>
      </div>
    </aside>
  </div>
);

export default Silver;
