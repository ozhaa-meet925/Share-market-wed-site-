import LiveChart from '../components/LiveChart';
import { ArrowUpRight, Coins, Info, Sparkles } from 'lucide-react';

const goldContract = {
  symbol: 'MCX:GOLD',
  name: 'Gold',
  sector: 'Commodity',
};

const Gold = () => (
  <div className="page commodity-detail-page gold-page">
    <section className="gold-hero" aria-labelledby="gold-page-title">
      <div className="gold-hero-copy">
        <span className="gold-eyebrow"><Sparkles size={15} /> METALS MARKET</span>
        <h1 id="gold-page-title">Gold, in focus.</h1>
        <p>Follow the gold market with a clear price reference, chart controls, and source details in one place.</p>
        <div className="gold-hero-tags" aria-label="Gold price details">
          <span><Coins size={15} /> Gold market</span>
          <span>₹ per 10g</span>
          <span>Spot &amp; MCX sources</span>
        </div>
      </div>
      <div className="gold-hero-art" aria-hidden="true">
        <div className="gold-coin-mark"><span>Au</span><i>24K</i></div>
        <span className="gold-art-spark gold-art-spark-one">✦</span>
        <span className="gold-art-spark gold-art-spark-two">✧</span>
      </div>
    </section>

    <div className="gold-chart-heading">
      <div>
        <span>MARKET PRICE</span>
        <h2>Gold price chart</h2>
      </div>
      <p>Switch the range or chart style to explore the view.</p>
    </div>

    <LiveChart stock={goldContract} assetType="commodity" />

    <aside className="gold-data-card" aria-label="Gold price source information">
      <span className="gold-info-icon"><Info size={18} /></span>
      <div className="gold-data-copy">
        <div className="gold-data-heading">
          <h2>About this price</h2>
          <a href="https://goldprice.dev" target="_blank" rel="noreferrer">
            Free spot source <ArrowUpRight size={15} />
          </a>
        </div>
        <p>The free feed is an international XAU/INR spot reference converted to ₹ per 10g and delayed by about 15 minutes. If Upstox is configured, the chart identifies its MCX futures quote separately. Neither is a local jewellery rate.</p>
        <div className="gold-data-tags">
          <span>Taxes and making charges excluded</span>
          <span>Intraday candles are illustrative when history is unavailable</span>
        </div>
      </div>
    </aside>
  </div>
);

export default Gold;
