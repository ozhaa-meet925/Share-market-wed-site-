import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, TrendingUp } from 'lucide-react';
import LivePriceTracker from '../components/LivePriceTracker';
import LiveChart from '../components/LiveChart';
import CompanyList from '../components/CompanyList';
import MarketCard from '../components/MarketCard';
import StockCard from '../components/StockCard';
import WatchlistPanel from '../components/Watchlist';
import PortfolioPanel from '../components/Portfolio';
import { indices, nifty } from '../data/nifty';
import { stocks as stockSeed } from '../data/stocks';
import { ipos } from '../data/ipo';
import NewsCard from '../components/NewsCard';
import IpoCard from '../components/IpoCard';
import { useLiveStocks } from '../hooks/useLiveStocks';
import { useMarketNews } from '../hooks/useMarketNews';
import { useStockCatalog } from '../hooks/useStockCatalog';
import { useMarketIndices } from '../hooks/useMarketIndices';

const marketIndexSymbols = indices.map((index) => index.symbol).filter(Boolean);

const holdings = [
  { symbol: 'RELIANCE', qty: 12 },
  { symbol: 'HDFCBANK', qty: 40 },
  { symbol: 'INFY', qty: 20 },
];

const Home = () => {
  const { catalog, addStock } = useStockCatalog();
  const { stocks, lastUpdated } = useLiveStocks(stockSeed);
  const { quotes: indexQuotes, histories: indexHistories, lastUpdated: indexUpdated } = useMarketIndices(marketIndexSymbols);
  const { news } = useMarketNews();
  const [selectedSymbol, setSelectedSymbol] = useState(stockSeed[0].symbol);
  const liveStockMap = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const catalogStocks = catalog.map((stock) => liveStockMap.get(stock.symbol) || stock);
  const topMovers = stocks.filter((stock) => stock.isLive).sort((a, b) => Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0)).slice(0, 4);
  const quotedHoldings = holdings.map((holding) => {
    const quote = stocks.find((stock) => stock.symbol === holding.symbol);
    const hasDisplayQuote = quote?.isLive === true && Number(quote.price) > 0;
    return {
      ...holding,
      value: hasDisplayQuote ? quote.price * holding.qty : null,
      dayGain: hasDisplayQuote && quote.change !== null ? quote.change * holding.qty : null,
      pnl: hasDisplayQuote ? quote.changePercent : null,
      isLive: quote?.isLive === true,
      isDemo: false,
      dataSource: quote?.dataSource,
      marketOpen: quote?.marketOpen === true,
      flash: quote?.flash,
    };
  });
  const selectedStock = catalogStocks.find((stock) => stock.symbol === selectedSymbol) || stocks[0];

  return (
    <div className="page home-page">
      <section className="hero-grid home-hero" aria-label="Market dashboard introduction">
        <div className="hero-copy home-hero-copy">
          <img
            className="home-hero-image"
            src="https://images.unsplash.com/photo-1766218329569-53c9270bb305?auto=format&fit=crop&fm=jpg&q=82&w=1800"
            alt="Investor using laptops displaying stock market charts"
            fetchPriority="high"
            onError={(event) => { event.currentTarget.hidden = true; }}
          />
          <div className="home-hero-scrim" aria-hidden="true" />
          <div className="home-hero-decoration" aria-hidden="true" />
          <span className="eyebrow"><TrendingUp size={16} /> Your Indian market dashboard</span>
          <h1>See the market <span>with more clarity.</span></h1>
          <p>Follow share prices, market indices, IPOs and your portfolio from one simple place. Compare moves and explore the latest market updates.</p>
          <div className="hero-actions">
            <Link className="primary-button" to="/stocks">Explore stocks <ArrowRight size={17} /></Link>
            <Link className="secondary-button" to="/markets">View markets</Link>
          </div>
          <div className="home-hero-note"><span aria-hidden="true" /> Stocks <i /> Indices <i /> IPOs <i /> Portfolio</div>
        </div>
        <div className="hero-market home-hero-market">
          <MarketCard
            name={nifty.name}
            quote={indexQuotes.get('NIFTY')}
            history={indexHistories.get('NIFTY')}
            lastUpdated={indexUpdated}
          />
        </div>
      </section>

      <section className="home-market-section" aria-labelledby="home-market-heading">
        <div className="home-section-intro">
          <div>
            <span className="home-section-kicker">MARKET OVERVIEW</span>
            <h2 id="home-market-heading">India’s key indices</h2>
            <p>Quick snapshot of the major market benchmarks.</p>
          </div>
          <Link to="/markets">Explore markets <ArrowRight size={16} /></Link>
        </div>
        <div className="market-strip">
          {indices.map((index) => (
            <MarketCard
              key={index.name}
              name={index.name}
              quote={index.symbol ? indexQuotes.get(index.symbol) : null}
              history={index.symbol ? indexHistories.get(index.symbol) : []}
              lastUpdated={indexUpdated}
            />
          ))}
        </div>
      </section>

      <LivePriceTracker items={catalogStocks} lastUpdated={lastUpdated} />

      <section className="company-and-chart home-company-chart">
        <aside className="home-widget home-company-widget">
          <div className="section-heading">
            <div>
              <span className="home-section-kicker">DISCOVER</span>
              <h3>All companies</h3>
              <span>{catalogStocks.length} listed companies</span>
            </div>
            <Link to="/stocks">View all</Link>
          </div>
          <CompanyList companies={catalogStocks} onSelect={setSelectedSymbol} selected={selectedSymbol} onAddStock={addStock} />
        </aside>
        <div className="home-widget home-chart-widget">
          <div className="home-chart-heading">
            <div>
              <span className="home-section-kicker">PRICE MOVEMENT</span>
              <h3>{selectedStock.name}</h3>
            </div>
            <span className="home-chart-symbol">{selectedStock.symbol}</span>
          </div>
          <LiveChart symbol={selectedStock.symbol} stock={selectedStock} />
        </div>
      </section>

      <section className="content-grid home-content-grid">
        <div>
          <div className="section-heading">
            <div>
              <span className="home-section-kicker">STOCKS TO WATCH</span>
              <h2>Top movers</h2>
            </div>
            <Link to="/stocks">View all</Link>
          </div>
          <div className="stock-grid">
            {topMovers.map((stock) => <StockCard key={stock.symbol} stock={stock} />)}
          </div>
          <div className="section-heading spaced-heading">
            <div>
              <span className="home-section-kicker">NEW LISTINGS</span>
              <h2>Latest IPOs</h2>
            </div>
            <Link to="/ipo">View calendar</Link>
          </div>
          <div className="ipo-list compact-ipo-list">
            {ipos.slice(0, 2).map((ipo) => <IpoCard key={ipo.company} ipo={ipo} compact />)}
          </div>
          <div className="section-heading spaced-heading">
            <div>
              <span className="home-section-kicker">MARKET UPDATES</span>
              <h2>Latest news</h2>
            </div>
            <Link to="/news">Read more</Link>
          </div>
          <div className="news-grid compact-news-grid">
            {news.slice(0, 2).map((item, index) => <NewsCard key={`${item.title}-${index}`} item={item} />)}
          </div>
        </div>
        <aside className="side-stack">
          <WatchlistPanel items={stocks.slice(0, 4)} />
          <PortfolioPanel holdings={quotedHoldings} />
          <section className="panel trust-panel">
            <ShieldCheck size={22} />
            <div>
              <h2>Risk First</h2>
              <p>Always verify live data before real trades.</p>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
};

export default Home;
