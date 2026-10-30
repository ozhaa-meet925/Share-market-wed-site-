import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  List,
  RotateCcw,
  Search as SearchIcon,
  SlidersHorizontal,
} from 'lucide-react';
import CompanyLogo from '../components/CompanyLogo';
import StockCard from '../components/StockCard';
import { stocks as stockSeed } from '../data/stocks';
import { useLiveStocks } from '../hooks/useLiveStocks';
import { useStockCatalog } from '../hooks/useStockCatalog';
import { useCatalogQuotes } from '../hooks/useCatalogQuotes';
import './Stocks.css';

const formatPrice = (value) => Number(value) > 0
  ? `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';

const formatPercent = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%`
  : '—';

const Stocks = () => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sector, setSector] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minDividendYield, setMinDividendYield] = useState('');
  const [sort, setSort] = useState('name');
  const [viewMode, setViewMode] = useState('cards');
  const [pageSize, setPageSize] = useState(24);
  const [page, setPage] = useState(1);
  const { stocks: liveStocks, lastUpdated } = useLiveStocks(stockSeed);
  const { catalog, isLiveCatalog } = useStockCatalog();
  const liveMap = useMemo(() => new Map(liveStocks.map((stock) => [stock.symbol, stock])), [liveStocks]);

  const stocks = useMemo(() => catalog.map((stock) => {
    const liveStock = liveMap.get(stock.symbol);
    if (liveStock?.isLive || liveStock?.isStale) {
      return {
        ...stock,
        ...liveStock,
      };
    }

    return {
      ...stock,
      isLive: false,
      isDemo: false,
      isStale: false,
      dataSource: 'Live quote required',
    };
  }), [catalog, liveMap]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const result = stocks.filter((stock) => {
      const matchesText = [stock.symbol, stock.name, stock.sector]
        .some((value) => String(value || '').toLowerCase().includes(term));
      const marketCap = Number.parseFloat(stock.marketCap) || 0;
      const matchesCategory = category === 'All'
        || (category === 'Large Cap' && marketCap >= 5)
        || (category === 'Mid Cap' && marketCap >= 2 && marketCap < 5)
        || (category === 'Small Cap' && marketCap < 2)
        || (category === 'Automobile' && ['Auto', 'Automobile'].includes(stock.sector))
        || (['Banking', 'IT', 'Pharma', 'Energy', 'FMCG', 'Metals', 'Financial Services', 'Defense & Engineering', 'Telecom'].includes(category) && stock.sector === category)
        || (category === 'PSU' && ['SBIN', 'ONGC', 'NTPC', 'HAL', 'BEL', 'COALINDIA', 'PNB', 'CANBK'].includes(stock.symbol))
        || (category === 'Top Gainers' && Number(stock.changePercent) > 0)
        || (category === 'Top Losers' && Number(stock.changePercent) < 0)
        || (category === 'Dividend Stocks' && Number(stock.dividendYield) >= 1.5);
      const matchesSector = sector === 'All' || stock.sector === sector;
      const matchesMin = !minPrice || (stock.price !== null && Number(stock.price) >= Number(minPrice));
      const matchesMax = !maxPrice || (stock.price !== null && Number(stock.price) <= Number(maxPrice));
      const matchesYield = !minDividendYield || Number(stock.dividendYield || 0) >= Number(minDividendYield);
      return matchesText && matchesCategory && matchesSector && matchesMin && matchesMax && matchesYield;
    });

    return result.sort((first, second) => {
      if (sort === 'change') return (Number(second.changePercent) || -Infinity) - (Number(first.changePercent) || -Infinity);
      if (sort === 'price') return (Number(second.price) || -Infinity) - (Number(first.price) || -Infinity);
      if (sort === 'pe') return (Number(first.pe) || Infinity) - (Number(second.pe) || Infinity);
      return String(first.name || first.symbol).localeCompare(String(second.name || second.symbol));
    });
  }, [category, maxPrice, minDividendYield, minPrice, query, sector, sort, stocks]);

  useEffect(() => setPage(1), [category, maxPrice, minDividendYield, minPrice, pageSize, query, sector, sort]);

  const sectors = ['All', ...new Set(stocks.map((stock) => stock.sector).filter(Boolean))];
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleStocks = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );
  const { quotes: catalogQuotes, histories: catalogHistories, lastUpdated: catalogUpdated, isLoading: quotesLoading } = useCatalogQuotes(visibleStocks);

  const displayStocks = visibleStocks.map((stock) => {
    const quote = catalogQuotes.get(stock.symbol);
    const quoteHasPrice = Number(quote?.c) > 0;
    const quoteIsCurrent = quoteHasPrice && quote.isLive === true;
    const stockIsCurrent = stock.isLive === true;
    const quoteIsStale = quoteHasPrice && quote.isStale === true;
    const stockIsStale = stock.isStale === true;
    const sourceQuote = quoteIsCurrent ? quote : stockIsCurrent ? stock : quoteIsStale ? quote : stockIsStale ? stock : null;
    const hasQuote = sourceQuote !== null;
    const isLive = sourceQuote?.isLive === true;
    const isDemo = false;
    const isStale = !isLive && sourceQuote?.isStale === true;
    const hasCurrentQuote = isLive;
    const quotePrice = Number(sourceQuote?.c ?? sourceQuote?.price);
    const price = hasQuote && quotePrice > 0 ? quotePrice : null;
    const quoteChange = sourceQuote?.d ?? sourceQuote?.change;
    const quoteChangePercent = sourceQuote?.dp ?? sourceQuote?.changePercent;
    const change = hasCurrentQuote && quoteChange !== null && quoteChange !== undefined && Number.isFinite(Number(quoteChange))
      ? Number(quoteChange)
      : null;
    const changePercent = hasCurrentQuote && quoteChangePercent !== null && quoteChangePercent !== undefined && Number.isFinite(Number(quoteChangePercent))
      ? Number(quoteChangePercent)
      : null;

    return {
      ...stock,
      price,
      previousClose: Number(sourceQuote?.pc ?? sourceQuote?.previousClose) > 0
        ? Number(sourceQuote.pc ?? sourceQuote.previousClose)
        : null,
      change,
      changePercent,
      high: Number(sourceQuote?.h ?? sourceQuote?.high) > 0 ? Number(sourceQuote.h ?? sourceQuote.high) : null,
      low: Number(sourceQuote?.l ?? sourceQuote?.low) > 0 ? Number(sourceQuote.l ?? sourceQuote.low) : null,
      history: catalogHistories.get(stock.symbol)?.length >= 2
        ? catalogHistories.get(stock.symbol)
        : stock.history || [],
      isLive,
      isDemo,
      isStale,
      dataSource: isLive
          ? `${sourceQuote.provider || 'Upstox'} live quote`
          : isStale
            ? `${sourceQuote.provider || 'Upstox'} quote · stale`
            : 'Live quote required',
      quoteUpdatedAt: hasQuote ? sourceQuote.timestamp || sourceQuote.quoteUpdatedAt || null : null,
      lastTick: sourceQuote?.lastTick || stock.lastTick || null,
      flash: hasCurrentQuote ? sourceQuote?.flash || stock.flash || null : null,
    };
  });

  const liveQuoteCount = displayStocks.filter((stock) => stock.isLive).length;
  const updatedAt = catalogUpdated || lastUpdated;
  const quoteUpdatedLabel = updatedAt
    ? updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : null;

  const clearFilters = () => {
    setQuery('');
    setCategory('All');
    setSector('All');
    setMinPrice('');
    setMaxPrice('');
    setMinDividendYield('');
    setSort('name');
  };

  return (
    <div className="page screener-page stocks-page">
      <header className="stocks-hero">
        <div className="stocks-hero-copy">
          <span className="stocks-eyebrow"><BarChart3 size={15} /> INDIA EQUITY SCREENER</span>
          <h1>Find stocks that fit your strategy.</h1>
          <p>Search India’s listed companies, compare key numbers, and narrow the market with filters that work.</p>
          <nav className="stocks-hero-links" aria-label="Stock tools">
            <Link to="/watchlist">Open watchlist <ArrowUpRight size={16} /></Link>
            <Link to="/compare">Compare stocks <ArrowUpRight size={16} /></Link>
            <Link to="/ipo">Explore IPOs <ArrowUpRight size={16} /></Link>
          </nav>
        </div>
        <aside className="stocks-quote-card" aria-label="Quote feed status">
          <div className="stocks-quote-card-top"><span><Activity size={15} /> QUOTE STATUS</span><i className={liveQuoteCount ? 'is-live' : ''} /></div>
          <strong>{liveQuoteCount ? `${liveQuoteCount} live` : quotesLoading ? 'Loading' : 'Awaiting live feed'}</strong>
          <p>{liveQuoteCount ? 'Live provider quotes on this page of results.' : 'Connect a market data provider to load current prices.'}</p>
          <span className="stocks-quote-updated">{quoteUpdatedLabel ? `Updated ${quoteUpdatedLabel} IST` : 'Waiting for quote update'}</span>
        </aside>
        <div className="stocks-hero-decoration" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
      </header>

      <section className="stocks-summary-grid" aria-label="Screener summary">
        <article className="stocks-summary-card"><span>Company universe</span><strong>{stocks.length.toLocaleString('en-IN')}</strong><small>{isLiveCatalog ? 'Listed companies' : 'Tracked companies'}</small></article>
        <article className="stocks-summary-card"><span>Matching results</span><strong>{filtered.length.toLocaleString('en-IN')}</strong><small>Based on your active filters</small></article>
        <article className="stocks-summary-card"><span>Live quotes on page</span><strong>{liveQuoteCount}<small> / {displayStocks.length}</small></strong><small>{liveQuoteCount ? 'Provider-confirmed prices' : 'No live quotes in this view'}</small></article>
        <article className="stocks-summary-card"><span>Available sectors</span><strong>{sectors.length - 1}</strong><small>Choose one to narrow results</small></article>
      </section>

      <section className="stocks-screener-panel" aria-label="Stock screener">
        <div className="stocks-screener-heading">
          <div>
            <span className="stocks-section-kicker"><SlidersHorizontal size={14} /> BUILD YOUR SHORTLIST</span>
            <h2>Explore stocks</h2>
            <p>Combine a category, sector, price range, and dividend yield.</p>
          </div>
          <button className="stocks-reset-button" type="button" onClick={clearFilters}><RotateCcw size={15} /> Reset filters</button>
        </div>

        <label className="stocks-search">
          <SearchIcon size={19} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, symbol, or sector" aria-label="Search company, symbol, or sector" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
        </label>

        <div className="stocks-discovery-row">
          <span>Quick filters</span>
          <div className="stocks-quick-filters">
            {['Large Cap', 'Mid Cap', 'Dividend Stocks'].map((item) => (
              <button key={item} className={category === item ? 'active' : ''} type="button" onClick={() => setCategory(category === item ? 'All' : item)}>{item}</button>
            ))}
          </div>
          <span className="stocks-filter-hint">Or use all filters below</span>
        </div>

        <div className="category-tabs" aria-label="Stock categories">
          {['All', 'Large Cap', 'Mid Cap', 'Small Cap', 'Banking', 'IT', 'Pharma', 'Automobile', 'Energy', 'FMCG', 'Metals', 'Financial Services', 'Defense & Engineering', 'Telecom', 'PSU', 'Top Gainers', 'Top Losers', 'Dividend Stocks'].map((item) => (
            <button key={item} type="button" className={category === item ? 'active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>
          ))}
        </div>

        <div className="stocks-filter-grid">
          <label>Sector<select value={sector} onChange={(event) => setSector(event.target.value)}>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Min price <span>₹</span><input type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Any" /></label>
          <label>Max price <span>₹</span><input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Any" /></label>
          <label>Min dividend yield <span>%</span><input type="number" min="0" step="0.1" value={minDividendYield} onChange={(event) => setMinDividendYield(event.target.value)} placeholder="Any" /></label>
          <label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Company name</option><option value="change">Daily change</option><option value="price">Price: high to low</option><option value="pe">P/E: low to high</option></select></label>
        </div>

        <div className="stocks-results-toolbar">
          <div><strong>{filtered.length.toLocaleString('en-IN')}</strong> matching stocks <span>·</span> page {page} of {pageCount}</div>
          <div className="stocks-view-controls" role="group" aria-label="Stock result view">
            <label className="stocks-page-size">Rows<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={24}>24</option><option value={48}>48</option><option value={96}>96</option></select></label>
            <button type="button" className={viewMode === 'cards' ? 'active' : ''} aria-pressed={viewMode === 'cards'} onClick={() => setViewMode('cards')}><Grid2X2 size={16} /> Cards</button>
            <button type="button" className={viewMode === 'table' ? 'active' : ''} aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')}><List size={17} /> Table</button>
          </div>
        </div>

        {!filtered.length ? (
          <div className="stocks-empty-state"><span><SearchIcon size={22} /></span><h3>No stocks match those filters</h3><p>Try a broader price range or clear the selected filters.</p><button type="button" onClick={clearFilters}>Show all stocks</button></div>
        ) : viewMode === 'cards' ? (
          <div className="stock-grid stocks-card-grid">
            {displayStocks.map((stock) => <StockCard key={stock.symbol} stock={stock} />)}
          </div>
        ) : (
          <div className="stocks-table-scroll" role="region" aria-label="Stock results table" tabIndex="0">
            <table className="stocks-table">
              <thead><tr><th scope="col">Company</th><th scope="col">Sector</th><th scope="col">Price</th><th scope="col">Day change</th><th scope="col">Market cap</th><th scope="col">P/E</th><th scope="col">Dividend</th></tr></thead>
              <tbody>
                {displayStocks.map((stock) => (
                  <tr key={stock.symbol}>
                    <td><Link className="stocks-table-company" to={`/stocks/${stock.symbol}`}><CompanyLogo symbol={stock.symbol} name={stock.name} size={38} /><span><strong>{stock.symbol}</strong><small>{stock.name}</small></span></Link></td>
                    <td>{stock.sector || '—'}</td>
                    <td><strong className="stocks-table-price">{formatPrice(stock.price)}</strong><span className={`stocks-data-badge ${stock.isLive ? 'is-live' : stock.isStale ? 'is-stale' : 'is-demo'}`}>{stock.isLive ? 'Live quote' : stock.isStale ? 'Last quote' : 'Demo · not real'}</span></td>
                    <td><span className={`stocks-change-pill ${Number(stock.changePercent) < 0 ? 'is-down' : Number(stock.changePercent) > 0 ? 'is-up' : ''}`}>{Number(stock.changePercent) < 0 ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}{formatPercent(stock.changePercent)}</span></td>
                    <td>{stock.marketCap || '—'}</td>
                    <td>{Number(stock.pe) > 0 ? Number(stock.pe).toFixed(1) : '—'}</td>
                    <td>{Number(stock.dividendYield) > 0 ? `${Number(stock.dividendYield).toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && <footer className="stocks-pagination" aria-label="Stock pages">
          <span>Showing {((page - 1) * pageSize + 1).toLocaleString('en-IN')}–{Math.min(page * pageSize, filtered.length).toLocaleString('en-IN')} of {filtered.length.toLocaleString('en-IN')}</span>
          <div>
            <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={17} /> Previous</button>
            <span>Page <strong>{page}</strong> of {pageCount}</span>
            <button type="button" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={17} /></button>
          </div>
        </footer>}
      </section>

      <p className="stocks-data-note"><Check size={14} /> Prices marked “Demo” are simulated examples, not live market quotes. Live status is shown only when confirmed by the connected provider.</p>
    </div>
  );
};

export default Stocks;
