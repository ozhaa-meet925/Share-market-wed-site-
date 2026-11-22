import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Star,
  Trash2,
  Plus,
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  ShoppingCart,
  Radio,
  Download,
  Share2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import CompanyLogo from '../components/CompanyLogo';
import QuickTradeModal from '../components/QuickTradeModal';
import { TickArrow } from '../components/PriceChange';
import { createCatalogStock, useStockCatalog } from '../hooks/useStockCatalog';
import { useCatalogQuotes } from '../hooks/useCatalogQuotes';
import { metalCatalogStocks } from '../data/metals';
import { stocks as stockSeed } from '../data/stocks';
import {
  WATCHLIST_EVENT,
  WATCHLIST_LISTS_EVENT,
  getActiveWatchlist,
  readLegacyWatchlistSymbols,
  readWatchlistLists,
  readWatchlistSymbols,
  saveActiveWatchlistSymbols,
  setActiveWatchlistSymbols,
  switchWatchlist,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
} from '../utils/watchlist';

const formatCurrency = (val) => Number(val) > 0
  ? `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : 'Quote unavailable';

const formatOptionalCurrency = (val) => Number(val) > 0
  ? `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';

const Watchlist = () => {
  const [listsState, setListsState] = useState(readWatchlistLists);
  const activeList = getActiveWatchlist(listsState);
  const watchlistSymbols = activeList.symbols;
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [listError, setListError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    const headers = ['Symbol,Name,Sector,Quote Unit,Price (INR),Change,Change %,Market Cap,P/E'];
    const rows = watchedStocks.map((s) =>
      `"${s.symbol}","${s.name}","${s.sector || ''}","${s.unit || 'share'}",${s.price ?? ''},${s.change ?? ''},${s.changePercent ?? ''},"${s.marketCap || ''}","${s.pe || ''}"`
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

  useEffect(() => {
    const legacy = readLegacyWatchlistSymbols();
    if (legacy) setActiveWatchlistSymbols(legacy);
    setListsState(readWatchlistLists());
  }, []);

  useEffect(() => {
    const syncWatchlist = (event) => {
      if (Array.isArray(event?.detail)) setActiveWatchlistSymbols(event.detail);
      setListsState(readWatchlistLists());
    };
    const syncLists = () => setListsState(readWatchlistLists());
    const syncStorage = (event) => {
      if (event.key === 'sharemarket:watchlist' || event.key === null) {
        setActiveWatchlistSymbols(readWatchlistSymbols());
        setListsState(readWatchlistLists());
      }
    };
    window.addEventListener(WATCHLIST_EVENT, syncWatchlist);
    window.addEventListener(WATCHLIST_LISTS_EVENT, syncLists);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, syncWatchlist);
      window.removeEventListener(WATCHLIST_LISTS_EVENT, syncLists);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  const watchedStocks = useMemo(() => {
    return watchlistStocks
      .map((stock) => {
        const quote = quotes.get(stock.symbol);
        const quoteHasPrice = Number(quote?.c) > 0;
        const isLive = quoteHasPrice && quote.isLive === true && quote.isDemo !== true;
        const isResearch = quoteHasPrice && quote.isResearch === true && quote.isLive !== true && quote.isDemo !== true;
        const isSpot = quoteHasPrice && quote.isReal === true && quote.isLive !== true && quote.isDemo !== true;
        const isStale = quoteHasPrice && quote.isStale === true;
        const isDemo = quoteHasPrice && quote.isDemo === true;
        const hasQuote = isLive || isResearch || isSpot;
        return {
          ...stock,
          price: quoteHasPrice ? Number(quote.c) : null,
          change: quoteHasPrice && quote.d !== null && quote.d !== undefined && Number.isFinite(Number(quote.d)) ? Number(quote.d) : null,
          changePercent: quoteHasPrice && quote.dp !== null && quote.dp !== undefined && Number.isFinite(Number(quote.dp)) ? Number(quote.dp) : null,
          low: quoteHasPrice ? Number(quote.l) : null,
          high: quoteHasPrice ? Number(quote.h) : null,
          week52High: quoteHasPrice ? Number(quote.week52High) || null : null,
          week52Low: quoteHasPrice ? Number(quote.week52Low) || null : null,
          unit: quote?.unit ? String(quote.unit).replace(/^INR\//i, '') : stock.unit || null,
          isMetal: stock.assetType === 'metal',
          route: stock.route || null,
          isLive,
          isResearch,
          isSpot,
          isDemo,
          isStale,
          hasQuote,
          flash: quote?.flash || null,
          lastTick: quote?.lastTick || null,
          quoteUpdatedAt: quote?.timestamp || null,
          dataSource: isDemo
            ? 'Demo quote · not real'
            : isSpot
              ? `${quote.provider || 'Metals spot feed'} · delayed spot · not live`
              : isResearch
                ? `${quote.provider || 'Yahoo Finance research feed'} · research · not live`
                : quote?.provider || (isStale ? 'Last quote · stale' : 'Connect a live market provider'),
        };
      })
      .filter((stock) =>
        stock.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        stock.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [watchlistStocks, quotes, searchQuery]);
  const liveQuoteCount = watchedStocks.filter((stock) => stock.isLive).length;
  const researchQuoteCount = watchedStocks.filter((stock) => stock.isResearch).length;
  const spotQuoteCount = watchedStocks.filter((stock) => stock.isSpot).length;
  const delayedQuoteCount = researchQuoteCount + spotQuoteCount;
  const quoteStatusClass = liveQuoteCount ? 'is-live' : delayedQuoteCount ? 'is-research' : 'is-unavailable';

  const handleRemove = (symbol) => {
    setListsState(saveActiveWatchlistSymbols(watchlistSymbols.filter((item) => item !== symbol)));
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!addSymbolInput) return;
    const clean = addSymbolInput.trim().toUpperCase();
    if (!watchlistSymbols.includes(clean)) {
      setListsState(saveActiveWatchlistSymbols([...watchlistSymbols, clean]));
    }
    setAddSymbolInput('');
  };

  const handleSwitchList = (listId) => {
    setListError('');
    setRenaming(false);
    setConfirmDelete(false);
    setListsState(switchWatchlist(listId));
  };

  const handleCreateList = (event) => {
    event.preventDefault();
    try {
      setListsState(createWatchlist(newListName));
      setNewListName('');
      setShowNewList(false);
      setListError('');
    } catch (error) {
      setListError(error.message);
    }
  };

  const handleRenameList = (event) => {
    event.preventDefault();
    setListsState(renameWatchlist(activeList.id, renameDraft));
    setRenaming(false);
    setListError('');
  };

  const handleDeleteList = () => {
    try {
      setListsState(deleteWatchlist(activeList.id));
      setConfirmDelete(false);
      setListError('');
    } catch (error) {
      setListError(error.message);
    }
  };

  const startRename = () => {
    setRenameDraft(activeList.name);
    setRenaming(true);
    setShowNewList(false);
    setListError('');
  };

  const availableToAdd = useMemo(() => {
    return [...metalCatalogStocks, ...stockSeed]
      .filter((stock) => !watchlistSymbols.includes(stock.symbol));
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
              : liveQuoteCount && delayedQuoteCount
                ? `${liveQuoteCount} live · ${delayedQuoteCount} delayed (not live)`
                : liveQuoteCount
                  ? `${liveQuoteCount}/${watchedStocks.length} live quotes`
                  : delayedQuoteCount
                    ? `${delayedQuoteCount} delayed quote${delayedQuoteCount === 1 ? '' : 's'} · not live`
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

      <section className="panel watchlist-list-bar" aria-label="Saved watchlists">
        <div className="watchlist-list-tabs" role="tablist" aria-label="Saved watchlists">
          {listsState.lists.map((list) => (
            <button
              key={list.id}
              type="button"
              role="tab"
              aria-selected={list.id === activeList.id}
              className={`watchlist-list-tab ${list.id === activeList.id ? 'active' : ''}`}
              onClick={() => handleSwitchList(list.id)}
            >
              {list.name}<span>{list.symbols.length}</span>
            </button>
          ))}
          {showNewList ? (
            <form className="watchlist-list-form" onSubmit={handleCreateList}>
              <input
                autoFocus
                value={newListName}
                maxLength={40}
                placeholder="New list name"
                aria-label="New watchlist name"
                onChange={(event) => setNewListName(event.target.value)}
              />
              <button type="submit" aria-label="Create watchlist"><Check size={15} /></button>
              <button type="button" aria-label="Cancel creating watchlist" onClick={() => { setShowNewList(false); setNewListName(''); }}><X size={15} /></button>
            </form>
          ) : (
            <button
              type="button"
              className="watchlist-list-add"
              onClick={() => { setShowNewList(true); setRenaming(false); setListError(''); }}
              disabled={listsState.lists.length >= 10}
              title="Create a new watchlist"
            >
              <Plus size={14} /> New list
            </button>
          )}
        </div>
        <div className="watchlist-list-actions">
          {renaming ? (
            <form className="watchlist-list-form" onSubmit={handleRenameList}>
              <input
                autoFocus
                value={renameDraft}
                maxLength={40}
                aria-label="Watchlist name"
                onChange={(event) => setRenameDraft(event.target.value)}
              />
              <button type="submit" aria-label="Save watchlist name"><Check size={15} /></button>
              <button type="button" aria-label="Cancel renaming" onClick={() => setRenaming(false)}><X size={15} /></button>
            </form>
          ) : confirmDelete ? (
            <div className="watchlist-list-confirm" role="group" aria-label="Confirm deleting this watchlist">
              <span>Delete “{activeList.name}”?</span>
              <button type="button" className="is-danger" onClick={handleDeleteList}>Delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <button type="button" className="watchlist-list-icon" onClick={startRename} title="Rename this watchlist" aria-label="Rename this watchlist"><Pencil size={14} /></button>
              <button
                type="button"
                className="watchlist-list-icon"
                onClick={() => { setConfirmDelete(true); setRenaming(false); }}
                disabled={listsState.lists.length <= 1}
                title="Delete this watchlist"
                aria-label="Delete this watchlist"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </section>
      {listError ? <p className="watchlist-list-error" role="alert">{listError}</p> : null}

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
                {s.symbol} — {s.name} ({s.sector}{s.unit ? ` · ₹/${s.unit}` : ''})
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
          const isGain = Number(stk.change) > 0;
          const isLoss = Number(stk.change) < 0;
          const changeDirection = isGain ? 'up' : isLoss ? 'down' : 'flat';
          const tickDirection = stk.lastTick === 'up' || stk.lastTick === 'down' ? stk.lastTick : changeDirection;
          const priceTone = `${tickDirection ? `price-${tickDirection}` : 'price-neutral'}${stk.flash === 'up' || stk.flash === 'down' ? ` price-flash-${stk.flash}` : ''}`;
          const low = stk.hasQuote && Number(stk.low) > 0 ? stk.low : null;
          const high = stk.hasQuote && Number(stk.high) > 0 ? stk.high : null;
          const rangePct = low && high && Number(stk.price) > 0 ? Math.min(
            100,
            Math.max(5, ((stk.price - low) / Math.max(1, high - low)) * 100)
          ) : 0;

          return (
            <div className="panel watchlist-card" key={stk.symbol}>
              <div className="card-top-row">
                <div>
                  <span className="badge-sector-mini">{stk.sector}</span>
                  <Link to={stk.isMetal ? stk.route : `/stocks/${stk.symbol}`} className="watchlist-card-title">
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
                  <span>{stk.isDemo
                    ? 'Simulated demo price · not real'
                    : stk.isLive
                      ? `Current price · ${stk.dataSource || 'Live provider'}`
                      : stk.isSpot
                        ? `Delayed spot · not live${stk.isStale ? ' · stale' : ''}`
                        : stk.isResearch
                          ? `Research quote · not live${stk.isStale ? ' · stale' : ' · delayed'}`
                          : stk.isStale ? 'Last quote · stale' : 'Live quote required'}</span>
                  <strong
                    key={stk.flash ? `${stk.quoteUpdatedAt}-${stk.flash}` : stk.symbol}
                    className={`stock-price-value ${priceTone}`}
                  >
                    {formatCurrency(stk.price)}
                    {stk.hasQuote && stk.unit
                      ? <small className="watchlist-price-unit"> / {stk.unit}</small>
                      : null}
                  </strong>
                  <span className={`price-change-tag ${stk.hasQuote ? changeDirection === 'up' ? 'gain' : changeDirection === 'down' ? 'loss' : 'price-flat' : ''}`}>
                    {stk.hasQuote ? <TickArrow direction={changeDirection} /> : null}
                    {stk.hasQuote && Number.isFinite(stk.change) && Number.isFinite(stk.changePercent)
                      ? `${isGain ? '+' : ''}${stk.change.toFixed(2)} (${isGain ? '+' : ''}${stk.changePercent.toFixed(2)}%)${stk.isSpot || stk.isResearch ? ' · delayed' : ''}`
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
                {stk.isMetal ? (
                  <>
                    <span>Quote unit: <b>₹ / {stk.unit || '—'}</b></span>
                    <span>52W high: <b>{formatOptionalCurrency(stk.week52High)}</b></span>
                    <span>52W low: <b>{formatOptionalCurrency(stk.week52Low)}</b></span>
                  </>
                ) : (
                  <>
                    <span>Vol: <b>{stk.volume}</b></span>
                    <span>P/E estimate: <b>{stk.pe || 'Unavailable'}</b></span>
                    <span>Mkt Cap: <b>{stk.marketCap}</b></span>
                  </>
                )}
              </div>

              {/* Card Footer Actions */}
              <div className="card-actions-row">
                <Link to={stk.isMetal ? stk.route : `/stocks/${stk.symbol}`} className="action-btn-sm details-btn">
                  Analyze <ArrowUpRight size={13} />
                </Link>
                {stk.isMetal ? (
                  <Link to={stk.route} className="action-btn-sm trade-btn">
                    <ShoppingCart size={13} /> Trade
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="action-btn-sm trade-btn"
                    disabled={!stk.isLive}
                    onClick={() => setTradingStock(stk)}
                  >
                    <ShoppingCart size={13} /> Quick Trade
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {watchedStocks.length === 0 && (
        <div className="panel empty-watchlist-state">
          <Star size={42} className="empty-icon" />
          <h3>No stocks in this filter</h3>
          <p>Add Indian equities or Gold / Silver metals from the dropdown above to track their market movements.</p>
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
