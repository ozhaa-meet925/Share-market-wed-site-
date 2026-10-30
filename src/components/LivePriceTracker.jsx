import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, Radio, ArrowUpRight, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import MarketStatusBadge from './MarketStatusBadge';
import CompanyLogo from './CompanyLogo';
import { useCatalogQuotes } from '../hooks/useCatalogQuotes';

const PAGE_SIZE = 15;

const formatPrice = (value) => Number(value) > 0
  ? `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : 'Quote unavailable';

const CATEGORIES = ['All Shares', 'Top Gainers', 'Top Losers', 'Banking', 'IT', 'Auto', 'Energy', 'Pharma'];

const LivePriceTracker = ({ items = [], lastUpdated = null }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Shares');
  const [page, setPage] = useState(1);

  const filteredItems = useMemo(() => {
    let result = [...items];

    // Filter by category
    if (selectedCategory === 'Top Gainers') {
      result = result
        .filter((s) => (s.changePercent || 0) > 0)
        .sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));
    } else if (selectedCategory === 'Top Losers') {
      result = result
        .filter((s) => (s.changePercent || 0) < 0)
        .sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0));
    } else if (selectedCategory !== 'All Shares') {
      result = result.filter((s) => s.sector === selectedCategory);
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      result = result.filter(
        (s) => (s.symbol && s.symbol.toLowerCase().includes(term)) ||
               (s.name && s.name.toLowerCase().includes(term))
      );
    }

    return result;
  }, [items, selectedCategory, searchTerm]);

  useEffect(() => setPage(1), [searchTerm, selectedCategory]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const visibleItems = useMemo(
    () => filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredItems, page],
  );
  const {
    quotes,
    lastUpdated: quoteUpdated,
    isLoading,
    providerState,
    setupMessage,
    quoteError,
  } = useCatalogQuotes(visibleItems);
  const displayItems = visibleItems.map((stock) => {
    const quote = quotes.get(stock.symbol.toUpperCase());
    const quotePrice = Number(quote?.c);
    const quoteIsLive = quotePrice > 0 && quote?.isLive === true;
    const quoteIsResearch = quotePrice > 0 && quote?.isResearch === true;
    const stockPrice = Number(stock.price);
    const stockIsLive = stockPrice > 0 && stock.isLive === true;
    const quoteIsStale = quotePrice > 0 && quote?.isStale === true;
    const stockIsStale = stockPrice > 0 && stock.isStale === true;
    const source = quoteIsLive ? quote : quoteIsResearch ? quote : stockIsLive ? stock : quoteIsStale ? quote : stockIsStale ? stock : null;
    const price = Number(source?.c ?? source?.price);
    const isLive = source?.isLive === true;
    const isResearch = source?.isResearch === true;

    return {
      ...stock,
      price: price > 0 ? price : null,
      change: source?.d ?? source?.change ?? null,
      changePercent: source?.dp ?? source?.changePercent ?? null,
      high: source?.h ?? source?.high ?? null,
      low: source?.l ?? source?.low ?? null,
      isLive,
      isResearch,
      isStale: !isLive && source?.isStale === true,
      isDemo: !isLive && source?.isDemo === true,
      provider: source?.provider || null,
      dataSource: isLive
        ? `${source.provider || 'Market provider'} live quote`
        : isResearch
          ? `${source.provider || 'Yahoo Finance'} research quote · not live`
        : source?.isStale
          ? `${source.provider || 'Market provider'} quote · stale`
          : stock.dataSource || 'Live quote required',
      quoteUpdatedAt: source?.timestamp || source?.quoteUpdatedAt || null,
    };
  });

  return (
    <section className="panel live-tracker" aria-label="Current share prices">
      <div className="section-heading live-tracker-heading">
        <div>
          <span className="card-topline">
            <Radio size={14} className="live-pulse-icon" /> {displayItems.some((stock) => stock.isLive) ? 'Live market quotes' : 'Market quote status'}
          </span>
          <h2>Current Share Prices</h2>
          <span className="live-tracker-subtext">
            {providerState === 'ready'
              ? 'Prices refresh from your configured provider. Browse pages or search to load other shares.'
              : providerState === 'checking'
                ? 'Checking the live market provider…'
                : setupMessage || 'Configure a live market provider to receive current quotes.'}
          </span>
        </div>
        <div className="live-tracker-actions">
          <MarketStatusBadge />
          <Link to="/live" className="live-terminal-cta">
            Open Live Terminal <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>

      <div className="live-tracker-filter-bar">
        <div className="live-tracker-search-wrap">
          <Search size={15} className="live-tracker-search-icon" />
          <input
            type="text"
            className="live-tracker-search-input"
            placeholder={`Search across all ${items.length} listed shares...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchTerm('')}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="live-tracker-tabs" role="tablist">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`live-tracker-tab-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="live-price-grid">
        {displayItems.length === 0 ? (
          <div className="live-tracker-empty">
            <p>No share prices match "{searchTerm}".</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => { setSearchTerm(''); setSelectedCategory('All Shares'); }}
            >
              Reset filters
            </button>
          </div>
        ) : (
          displayItems.map((stock) => {
            const hasLiveChange = (stock.isLive || stock.isDemo || stock.isResearch)
              && stock.change !== null && stock.change !== undefined && Number.isFinite(Number(stock.change))
              && stock.changePercent !== null && stock.changePercent !== undefined && Number.isFinite(Number(stock.changePercent));
            const isGain = Number(stock.change) >= 0;
            const flashClass = stock.flash === 'up' ? 'flash-up' : stock.flash === 'down' ? 'flash-down' : '';
            return (
              <Link
                to={`/stocks/${stock.symbol}`}
                className={`live-price-row ${flashClass}`}
                key={stock.symbol}
                title={`${stock.name} - Current Price: ${formatPrice(stock.price)}`}
              >
                <div className="live-price-header-row">
                  <CompanyLogo symbol={stock.symbol} name={stock.name} size={38} />
                  <div className="live-price-company">
                    <strong>{stock.symbol}</strong>
                    <span>{stock.name}</span>
                  </div>
                </div>
                <div className="live-price-value">
                  <span className="live-current-price-label">{stock.isDemo ? `Simulated demo price · ${stock.marketOpen ? 'updates 09:00–16:00 IST' : 'session closed'} · not real` : stock.isResearch ? `Research quote · not live · ${stock.isStale ? 'stale · ' : ''}${stock.provider || 'Yahoo Finance'}` : stock.isLive ? `Current price · ${stock.dataSource || 'Upstox'}` : stock.isStale ? 'Last quote · stale' : 'Live quote required'}</span>
                  <b className={`stock-price-value ${stock.lastTick ? `price-${stock.lastTick}` : hasLiveChange ? (isGain ? 'price-up' : 'price-down') : ''} ${stock.flash ? `price-flash-${stock.flash}` : ''}`}>
                    {formatPrice(stock.price)}
                    {stock.isLive && stock.lastTick === 'up' ? ' ▲' : stock.isLive && stock.lastTick === 'down' ? ' ▼' : ''}
                  </b>
                  {hasLiveChange ? (
                    <span className={isGain ? 'gain' : 'loss'}>
                      {isGain ? '+' : ''}{Number(stock.change).toFixed(2)} ({isGain ? '+' : ''}{Number(stock.changePercent).toFixed(2)}%)
                    </span>
                  ) : <span>{stock.isDemo ? 'Demo change · simulated' : stock.isStale ? 'Last quote · stale' : 'Change unavailable'}</span>}
                  {(stock.isLive || stock.isResearch) && stock.high && stock.low && (
                    <small className="live-price-range">
                      H: ₹{Number(stock.high).toLocaleString('en-IN')} · L: ₹{Number(stock.low).toLocaleString('en-IN')}
                    </small>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>

      <div className="live-tracker-footer-bar">
        {filteredItems.length > PAGE_SIZE && (
          <div className="live-tracker-pagination">
            <span>Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString('en-IN')}–{Math.min(page * PAGE_SIZE, filteredItems.length).toLocaleString('en-IN')} of {filteredItems.length.toLocaleString('en-IN')}</span>
            <button type="button" className="live-tracker-toggle-btn" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} /> Previous</button>
            <span>Page {page} of {pageCount}</span>
            <button type="button" className="live-tracker-toggle-btn" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={16} /></button>
          </div>
        )}
        <div className="live-updated">
          <Clock3 size={14} />
          <span>{quoteUpdated || lastUpdated
            ? `Received ${(quoteUpdated || lastUpdated).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : providerState === 'checking'
              ? 'Checking quote feed…'
              : providerState === 'unavailable'
                ? setupMessage || 'Connect a live market provider'
                : isLoading
                  ? 'Loading current quotes…'
                  : quoteError || 'Waiting for provider quotes'}</span>
        </div>
      </div>
    </section>
  );
};

export default LivePriceTracker;
