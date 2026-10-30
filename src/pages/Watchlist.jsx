import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Star,
  Trash2,
  Plus,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Search,
  SlidersHorizontal,
  ShoppingCart,
  Radio,
  Download,
  Share2,
} from 'lucide-react';
import CompanyLogo from '../components/CompanyLogo';
import QuickTradeModal from '../components/QuickTradeModal';
import { createCatalogStock, useStockCatalog } from '../hooks/useStockCatalog';
import { useCatalogQuotes } from '../hooks/useCatalogQuotes';
import { stocks as stockSeed } from '../data/stocks';

const DEFAULT_WATCHLIST = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'SBIN', 'ICICIBANK', 'MARUTI', 'BHARTIARTL'];

const formatCurrency = (val) => Number(val) > 0
  ? `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : 'Quote unavailable';

const Watchlist = () => {
  const [watchlistSymbols, setWatchlistSymbols] = useState(() => {
    try {
      const saved = localStorage.getItem('sharemarket:watchlist');
      return saved ? JSON.parse(saved) : DEFAULT_WATCHLIST;
    } catch {
      return DEFAULT_WATCHLIST;
    }
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [addSymbolInput, setAddSymbolInput] = useState('');
  const [tradingStock, setTradingStock] = useState(null);
  const { catalog } = useStockCatalog();
  const watchlistStocks = useMemo(
    () => watchlistSymbols.map((symbol) => (
      catalog.find((stock) => stock.symbol === symbol)
        || createCatalogStock(symbol, symbol)
    )),
    [catalog, watchlistSymbols],
  );
  const { quotes } = useCatalogQuotes(watchlistStocks);

  // Export Watchlist as CSV
  const handleExportCSV = () => {
    if (!watchedStocks.length) return;
    const headers = ['Symbol,Name,Sector,Price (INR),Change,Change %,Market Cap,P/E'];
    const rows = watchedStocks.map((s) =>
      `"${s.symbol}","${s.name}","${s.sector || ''}",${s.price ?? ''},${s.change ?? ''},${s.changePercent ?? ''},"${s.marketCap || ''}","${s.pe || ''}"`
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ShareMarket_Watchlist_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Share via WhatsApp
  const handleShareWhatsApp = () => {
    if (!watchedStocks.length) return;
    const text = `📊 *My ShareMarket Pro Watchlist:*\n` +
      watchedStocks.slice(0, 8).map((s) => `• *${s.symbol}*: ${s.price > 0 ? `₹${s.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${s.isResearch ? ' (research quote · not live)' : s.isLive ? ` (${s.changePercent >= 0 ? '+' : ''}${s.changePercent}%)` : ' (last quote · not live)'}` : 'Quote unavailable'}`).join('\n') +
      `\n\nTrack stock quotes at ShareMarket Pro.`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  // Persist watchlist changes
  useEffect(() => {
    localStorage.setItem('sharemarket:watchlist', JSON.stringify(watchlistSymbols));
  }, [watchlistSymbols]);

  const watchedStocks = useMemo(() => {
    return watchlistStocks
      .map((stock) => {
        const quote = quotes.get(stock.symbol);
        const quoteHasPrice = Number(quote?.c) > 0;
        const isLive = quoteHasPrice && quote.isLive === true && quote.isDemo !== true;
        const isResearch = quoteHasPrice && quote.isResearch === true && quote.isLive !== true && quote.isDemo !== true;
        const isStale = quoteHasPrice && quote.isStale === true;
        const isDemo = quoteHasPrice && quote.isDemo === true;
        return {
          ...stock,
          price: quoteHasPrice ? Number(quote.c) : null,
          change: quoteHasPrice && quote.d !== null && quote.d !== undefined && Number.isFinite(Number(quote.d)) ? Number(quote.d) : null,
          changePercent: quoteHasPrice && quote.dp !== null && quote.dp !== undefined && Number.isFinite(Number(quote.dp)) ? Number(quote.dp) : null,
          low: quoteHasPrice ? Number(quote.l) : null,
          high: quoteHasPrice ? Number(quote.h) : null,
          isLive,
          isResearch,
          isDemo,
          isStale,
          flash: quote?.flash || null,
          lastTick: quote?.lastTick || null,
          quoteUpdatedAt: quote?.timestamp || null,
          dataSource: isDemo ? 'Demo quote · not real' : isResearch ? `${quote.provider || 'Yahoo Finance research feed'} · research · not live` : quote?.provider || (isStale ? 'Last quote · stale' : 'Connect a live market provider'),
        };
      })
      .filter((stock) =>
        stock.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        stock.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [watchlistStocks, quotes, searchQuery]);
  const liveQuoteCount = watchedStocks.filter((stock) => stock.isLive).length;
  const researchQuoteCount = watchedStocks.filter((stock) => stock.isResearch).length;
  const quoteStatusClass = liveQuoteCount ? 'is-live' : researchQuoteCount ? 'is-research' : 'is-unavailable';

  const handleRemove = (symbol) => {
    setWatchlistSymbols((prev) => prev.filter((s) => s !== symbol));
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!addSymbolInput) return;
    const clean = addSymbolInput.trim().toUpperCase();
    if (!watchlistSymbols.includes(clean)) {
      setWatchlistSymbols((prev) => [...prev, clean]);
    }
    setAddSymbolInput('');
  };

  const availableToAdd = useMemo(() => {
    return stockSeed.filter((s) => !watchlistSymbols.includes(s.symbol));
  }, [watchlistSymbols]);

  return (
    <div className="page watchlist-page">
      <div className="page-title watchlist-header-title">
        <div>
          <span>Personal Watchlist</span>
          <h1>My Tracked Securities</h1>
        </div>
        <div className="watchlist-meta-info">
          <span className="live-status-pill">
            <span className={`live-dot ${quoteStatusClass}`} />
            <Radio size={14} />
            <b>{watchedStocks.some((stock) => stock.isDemo)
              ? 'Simulated demo values · not real'
              : liveQuoteCount && researchQuoteCount
                ? `${liveQuoteCount} live · ${researchQuoteCount} research (not live)`
                : liveQuoteCount
                  ? `${liveQuoteCount}/${watchedStocks.length} live quotes`
                  : researchQuoteCount
                    ? `${researchQuoteCount} research quotes · not live`
                    : 'Quotes unavailable'}</b>
          </span>
          <button
            type="button"
            className="secondary-button export-action-btn"
            onClick={handleExportCSV}
            title="Download Watchlist CSV report"
          >
            <Download size={15} /> Export CSV
          </button>
          <button
            type="button"
            className="secondary-button export-action-btn"
            onClick={handleShareWhatsApp}
            title="Share Watchlist on WhatsApp"
          >
            <Share2 size={15} /> WhatsApp
          </button>
          <Link to="/live" className="secondary-button">
            Open Live Terminal <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>

      {/* Watchlist Controls: Add stock & Search */}
      <section className="panel watchlist-controls-panel">
        <form onSubmit={handleAdd} className="add-watchlist-form">
          <select
            value={addSymbolInput}
            onChange={(e) => setAddSymbolInput(e.target.value)}
          >
            <option value="">+ Add stock to Watchlist...</option>
            {availableToAdd.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol} — {s.name} ({s.sector})
              </option>
            ))}
          </select>
          <button type="submit" disabled={!addSymbolInput} className="primary-button add-btn">
            <Plus size={16} /> Add to Watchlist
          </button>
        </form>

        <div className="watchlist-search-wrapper">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search within watchlist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </section>

      {/* Watchlist Grid */}
      <section className="watchlist-cards-grid">
        {watchedStocks.map((stk) => {
          const isGain = Number(stk.change) >= 0;
          const priceFlash = stk.flash === 'up' || stk.flash === 'down' ? `price-flash-${stk.flash}` : '';
          const priceTone = stk.lastTick === 'up' || stk.lastTick === 'down' ? `price-${stk.lastTick}` : '';
          const low = (stk.isLive || stk.isResearch || stk.isDemo) && Number(stk.low) > 0 ? stk.low : null;
          const high = (stk.isLive || stk.isResearch || stk.isDemo) && Number(stk.high) > 0 ? stk.high : null;
          const rangePct = low && high && Number(stk.price) > 0 ? Math.min(
            100,
            Math.max(5, ((stk.price - low) / Math.max(1, high - low)) * 100)
          ) : 0;

          return (
            <div className="panel watchlist-card" key={stk.symbol}>
              <div className="card-top-row">
                <div>
                  <span className="badge-sector-mini">{stk.sector}</span>
                  <Link to={`/stocks/${stk.symbol}`} className="watchlist-card-title">
                    <h3>{stk.symbol}</h3>
                    <span>{stk.name}</span>
                  </Link>
                </div>
                <button
                  type="button"
                  className="remove-fav-btn"
                  onClick={() => handleRemove(stk.symbol)}
                  title="Remove from Watchlist"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="card-price-row">
                <div className="price-big-box">
                  <span>{stk.isDemo ? 'Simulated demo price · not real' : stk.isLive ? `Current price · ${stk.dataSource || 'Live provider'}` : stk.isResearch ? `Research quote · not live${stk.isStale ? ' · stale' : ' · delayed'}` : stk.isStale ? 'Last quote · stale' : 'Live quote required'}</span>
                  <strong
                    key={stk.flash ? `${stk.quoteUpdatedAt}-${stk.flash}` : stk.symbol}
                    className={`stock-price-value ${priceTone} ${priceFlash}`}
                  >
                    {formatCurrency(stk.price)}
                  </strong>
                  <span className={`price-change-tag ${(stk.isLive || stk.isResearch || stk.isDemo) ? isGain ? 'gain' : 'loss' : ''}`}>
                    {stk.isLive || stk.isResearch || stk.isDemo ? (isGain ? <TrendingUp size={14} /> : <TrendingDown size={14} />) : null}
                    {(stk.isLive || stk.isResearch || stk.isDemo) && Number.isFinite(stk.change) && Number.isFinite(stk.changePercent)
                      ? `${isGain ? '+' : ''}${stk.change.toFixed(2)} (${isGain ? '+' : ''}${stk.changePercent.toFixed(2)}%)${stk.isResearch ? ' · delayed' : ''}`
                      : stk.isStale ? 'Last quote · stale' : 'Change unavailable'}
                  </span>
                </div>
              </div>

              {/* Day range bar */}
              <div className="card-range-slider">
                <div className="range-text">
                  <span>L: {low ? formatCurrency(low) : 'Unavailable'}</span>
                  <span>H: {high ? formatCurrency(high) : 'Unavailable'}</span>
                </div>
                <div className="range-track">
                  <div className="range-fill" style={{ width: `${rangePct}%` }} />
                </div>
              </div>

              {/* Stats */}
              <div className="card-mini-stats">
                <span>Vol: <b>{stk.volume}</b></span>
                <span>P/E estimate: <b>{stk.pe || 'Unavailable'}</b></span>
                <span>Mkt Cap: <b>{stk.marketCap}</b></span>
              </div>

              {/* Card Footer Actions */}
              <div className="card-actions-row">
                <Link to={`/stocks/${stk.symbol}`} className="action-btn-sm details-btn">
                  Analyze <ArrowUpRight size={13} />
                </Link>
                <button
                  type="button"
                  className="action-btn-sm trade-btn"
                  disabled={!stk.isLive}
                  onClick={() => setTradingStock(stk)}
                >
                  <ShoppingCart size={13} /> Quick Trade
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {watchedStocks.length === 0 && (
        <div className="panel empty-watchlist-state">
          <Star size={42} className="empty-icon" />
          <h3>No stocks in this filter</h3>
          <p>Add Indian equities from the dropdown above to track their live market movements.</p>
        </div>
      )}

      {/* Trade Modal */}
      {tradingStock && (
        <QuickTradeModal
          stock={tradingStock}
          initialSide="Buy"
          onClose={() => setTradingStock(null)}
        />
      )}
    </div>
  );
};

export default Watchlist;
