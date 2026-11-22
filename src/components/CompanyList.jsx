import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { List } from 'react-window';
import { Search, Plus, Star, X, Check } from 'lucide-react';
import { createCatalogStock, saveCustomStock } from '../hooks/useStockCatalog';
import { useCatalogQuotes } from '../hooks/useCatalogQuotes';
import { normalizeWatchlistSymbols, readWatchlistSymbols } from '../utils/watchlist';
import CompanyLogo from './CompanyLogo';
import { TickArrow, tickToneClass } from './PriceChange';

const COMPANY_ROW_HEIGHT = 82;
const INITIAL_VISIBLE_RANGE = { startIndex: 0, stopIndex: 6 };
const SECTORS = [
  'Banking', 'IT', 'Auto', 'Pharma', 'Energy', 'FMCG',
  'Metals', 'Financial Services', 'Defense & Engineering', 'Telecom', 'Diversified',
];

const isVerifiedQuote = (quote) => Number(quote?.c ?? quote?.price) > 0
  && quote?.isDemo !== true
  && (quote?.isLive === true || quote?.isResearch === true || quote?.isStale === true);

const quoteTimestampLabel = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
};

const CompanyRow = ({
  ariaAttributes,
  companies,
  index,
  onSelect,
  onToggleWatchlist,
  quotes,
  quotesLoading,
  selected,
  style,
  watchlist,
}) => {
  const navigate = useNavigate();
  const stock = companies[index];
  if (!stock) return null;

  const symbol = String(stock.symbol || '').toUpperCase();
  const quote = quotes.get(symbol);
  const freshQuote = isVerifiedQuote(quote) ? quote : null;
  const displayedStock = freshQuote ? {
    ...stock,
    price: Number(freshQuote.c ?? freshQuote.price),
    change: freshQuote.d ?? freshQuote.change ?? null,
    changePercent: freshQuote.dp ?? freshQuote.changePercent ?? null,
    isLive: freshQuote.isLive === true && freshQuote.isStale !== true,
    isResearch: freshQuote.isResearch === true,
    isStale: freshQuote.isStale === true,
    isDemo: false,
    dataSource: freshQuote.provider || stock.dataSource,
    quoteTimestamp: freshQuote.timestamp || freshQuote.quoteTimestamp || null,
    flash: freshQuote.flash ?? null,
    lastTick: freshQuote.lastTick ?? null,
  } : stock;
  const hasQuote = Number(displayedStock.price) > 0
    && displayedStock.isDemo !== true
    && (displayedStock.isLive === true || displayedStock.isResearch === true || displayedStock.isStale === true);
  const isLive = hasQuote && displayedStock.isLive === true && displayedStock.isStale !== true;
  const isResearch = hasQuote && displayedStock.isResearch === true;
  const isStale = hasQuote && !isLive && displayedStock.isStale === true;
  const changePercent = Number(displayedStock.changePercent);
  const hasChange = hasQuote && displayedStock.changePercent !== null
    && displayedStock.changePercent !== undefined && Number.isFinite(changePercent);
  const dayDirection = !hasChange ? null : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat';
  const priceTone = hasQuote ? tickToneClass(displayedStock.flash || dayDirection, displayedStock.flash) : '';
  const isStarred = watchlist.includes(symbol);
  const priceDisplay = hasQuote
    ? `₹${Number(displayedStock.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Quote unavailable';
  const showQuoteSkeleton = quotesLoading && !hasQuote;
  const sourceLabel = isLive
    ? `Live quote · ${displayedStock.dataSource || 'market provider'}`
    : isResearch
      ? `Research quote · not live${isStale ? ' · stale' : ''}`
      : isStale
        ? `Last quote · stale · ${displayedStock.dataSource || 'market provider'}`
        : quotesLoading ? 'Loading latest quote…' : 'Live quote required';
  const timestamp = quoteTimestampLabel(displayedStock.quoteTimestamp || displayedStock.timestamp);

  const selectRow = () => {
    onSelect?.(stock.symbol);
    navigate(`/stocks/${encodeURIComponent(symbol)}`);
  };
  const handleRowKeyDown = (event) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    selectRow();
  };

  return (
    <div {...ariaAttributes} style={{ ...style, boxSizing: 'border-box', paddingBottom: 7, paddingRight: 4 }}>
      <div
        className={`company-item ${selected === stock.symbol ? 'active' : ''}`}
        role="group"
        aria-label={`${stock.name || symbol}, ${symbol}, ${stock.exchange || 'NSE'}`}
        tabIndex={0}
        onClick={selectRow}
        onKeyDown={handleRowKeyDown}
      >
        <CompanyLogo symbol={symbol} name={stock.name} size={38} />

        <div className="company-info-col">
          <span className="symbol">{symbol}</span>
          <div className="company-meta-sub">
            <span className="name" title={stock.name}>{stock.name}</span>
            <span className="company-sector-badge" title={`${stock.sector || 'Sector unavailable'} · ${stock.exchange || 'NSE'}`}>
              {stock.sector || 'Sector unavailable'} · {stock.exchange || 'NSE'}
            </span>
          </div>
        </div>

        <div className="company-price-col">
          <span className={`company-price-tag${isLive ? ' is-live' : isResearch ? ' is-research' : isStale ? ' is-stale' : ''}`} title={sourceLabel}>
            {sourceLabel}
          </span>
          <div key={displayedStock.flash ? `${symbol}-${displayedStock.flash}` : 'steady'} className={`${showQuoteSkeleton ? 'company-price-skeleton' : 'company-price'} ${priceTone}`}>
            {showQuoteSkeleton ? <span className="sr-only">Loading quote</span> : priceDisplay}
          </div>
          <div className={`company-change ${dayDirection === 'up' ? 'gain' : dayDirection === 'down' ? 'loss' : dayDirection === 'flat' ? 'price-flat' : ''}`}>
            {hasChange
              ? <><TickArrow direction={dayDirection} />{`${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`}</>
              : showQuoteSkeleton ? <span className="sr-only">Loading daily change</span> : 'Change unavailable'}
          </div>
          {timestamp ? <span className="company-quote-time" title={`Quote timestamp · ${timestamp} IST`}>As of {timestamp} IST</span> : null}
        </div>

        <div className="company-item-actions">
          <button
            type="button"
            className={`watchlist-star-btn ${isStarred ? 'starred' : ''}`}
            onClick={(event) => onToggleWatchlist(event, symbol)}
            title={isStarred ? 'Remove from Watchlist' : 'Add to Watchlist'}
            aria-label={isStarred ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
            aria-pressed={isStarred}
          >
            <Star size={14} fill={isStarred ? '#f59e0b' : 'none'} />
          </button>
          <Link
            className="company-trade-link"
            to={`/stocks/${encodeURIComponent(symbol)}`}
            onClick={(event) => event.stopPropagation()}
            title={`Open ${symbol} details and paper trade`}
          >
            Trade
          </Link>
        </div>
      </div>
    </div>
  );
};

const CompanyList = ({
  companies = [],
  onSelect,
  selected,
  onAddStock,
  isLoadingCatalog = false,
  catalogError = '',
}) => {
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState('All');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [visibleRange, setVisibleRange] = useState(INITIAL_VISIBLE_RANGE);
  const [showAddModal, setShowAddModal] = useState(false);
  const [watchlist, setWatchlist] = useState(readWatchlistSymbols);

  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [newSector, setNewSector] = useState('Banking');
  const [addSuccess, setAddSuccess] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    const syncWatchlist = (event) => setWatchlist(normalizeWatchlistSymbols(event?.detail ?? readWatchlistSymbols()));
    const syncStorage = (event) => {
      if (event.key === 'sharemarket:watchlist' || event.key === null) setWatchlist(readWatchlistSymbols());
    };
    window.addEventListener('sharemarket:watchlist-updated', syncWatchlist);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener('sharemarket:watchlist-updated', syncWatchlist);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  const toggleWatchlist = useCallback((event, symbol) => {
    event.stopPropagation();
    const normalizedSymbol = String(symbol || '').toUpperCase();
    const updated = watchlist.includes(normalizedSymbol)
      ? watchlist.filter((item) => item !== normalizedSymbol)
      : [normalizedSymbol, ...watchlist];
    try {
      localStorage.setItem('sharemarket:watchlist', JSON.stringify(updated));
    } catch {
      // Keep the current session usable when browser storage is unavailable.
    }
    setWatchlist(updated);
    window.dispatchEvent(new CustomEvent('sharemarket:watchlist-updated', { detail: updated }));
  }, [watchlist]);

  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);
  const baseFiltered = useMemo(() => {
    let result = companies;
    if (filterMode === 'Watchlist') {
      result = result.filter((stock) => watchlistSet.has(String(stock.symbol).toUpperCase()));
    }

    const term = query.trim().toLowerCase();
    if (term) {
      result = result.filter((stock) => (
        `${stock.symbol || ''} ${stock.name || ''} ${stock.sector || ''} ${stock.exchange || ''}`
      ).toLowerCase().includes(term));
    }
    return result;
  }, [companies, filterMode, query, watchlistSet]);

  // Search and watchlist views must request quotes for the rows they actually show.
  // Gainers/Losers scan the corresponding directory range, then sort only quotes
  // the provider has verified; unknown prices are never treated as zero movement.
  const quoteCandidates = useMemo(() => {
    const isMoverFilter = filterMode === 'Gainers' || filterMode === 'Losers';
    const source = isMoverFilter && !query.trim() ? companies : baseFiltered;
    return source.slice(visibleRange.startIndex, visibleRange.stopIndex + 1);
  }, [baseFiltered, companies, filterMode, query, visibleRange]);
  const quoteState = useCatalogQuotes(quoteCandidates);
  const quoteFilterMap = filterMode === 'Gainers' || filterMode === 'Losers' ? quoteState.quotes : null;

  const filtered = useMemo(() => {
    let result = baseFiltered;
    const getChange = (stock) => {
      const quote = quoteFilterMap?.get(String(stock.symbol).toUpperCase());
      if (isVerifiedQuote(quote)) {
        const change = Number(quote.dp ?? quote.changePercent);
        return Number.isFinite(change) ? change : null;
      }
      if (stock.isDemo !== true && (stock.isLive === true || stock.isResearch === true || stock.isStale === true)) {
        const change = Number(stock.changePercent);
        return Number.isFinite(change) ? change : null;
      }
      return null;
    };

    if (filterMode === 'Gainers') {
      result = result.filter((stock) => (getChange(stock) ?? -Infinity) > 0)
        .sort((first, second) => getChange(second) - getChange(first));
    } else if (filterMode === 'Losers') {
      result = result.filter((stock) => (getChange(stock) ?? Infinity) < 0)
        .sort((first, second) => getChange(first) - getChange(second));
    }
    return result;
  }, [baseFiltered, filterMode, quoteFilterMap]);

  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return companies
      .filter((stock) => `${stock.symbol || ''} ${stock.name || ''} ${stock.sector || ''}`.toLowerCase().includes(term))
      .sort((first, second) => {
        const firstSymbol = String(first.symbol || '').toLowerCase();
        const secondSymbol = String(second.symbol || '').toLowerCase();
        const firstName = String(first.name || '').toLowerCase();
        const secondName = String(second.name || '').toLowerCase();
        const rank = (symbol, name) => symbol === term ? 0 : symbol.startsWith(term) ? 1 : name.startsWith(term) ? 2 : 3;
        return rank(firstSymbol, firstName) - rank(secondSymbol, secondName)
          || firstName.localeCompare(secondName);
      })
      .slice(0, 6);
  }, [companies, query]);

  useEffect(() => {
    setVisibleRange(INITIAL_VISIBLE_RANGE);
  }, [filterMode, query, companies.length]);

  const handleRowsRendered = useCallback(({ startIndex, stopIndex }) => {
    setVisibleRange((current) => (
      current.startIndex === startIndex && current.stopIndex === stopIndex
        ? current
        : { startIndex, stopIndex }
    ));
  }, []);

  const selectSuggestion = (stock) => {
    setQuery(stock.symbol);
    setShowSuggestions(false);
    setActiveSuggestionIndex(0);
    onSelect?.(stock.symbol);
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'Escape') {
      setShowSuggestions(false);
      return;
    }
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setShowSuggestions(true);
      setActiveSuggestionIndex((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setShowSuggestions(true);
      setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && showSuggestions && suggestions[activeSuggestionIndex]) {
      event.preventDefault();
      selectSuggestion(suggestions[activeSuggestionIndex]);
    }
  };

  const handleAddStockSubmit = (event) => {
    event.preventDefault();
    const symbol = newSymbol.trim().toUpperCase();
    const name = newName.trim();
    if (!/^[A-Z0-9][A-Z0-9.&_-]{0,19}$/.test(symbol)) {
      setAddError('Enter a valid exchange symbol using letters and numbers.');
      return;
    }
    if (!name) {
      setAddError('Enter the company name.');
      return;
    }
    const existing = companies.find((stock) => String(stock.symbol).toUpperCase() === symbol);
    if (existing) {
      setAddError(`${symbol} is already in the listed companies directory.`);
      return;
    }

    const newStock = createCatalogStock(symbol, name, newSector);
    if (onAddStock) onAddStock(newStock);
    else saveCustomStock(newStock);
    setAddError('');
    setAddSuccess(true);
    window.setTimeout(() => {
      setAddSuccess(false);
      setShowAddModal(false);
      setNewSymbol('');
      setNewName('');
      if (onSelect) onSelect(symbol);
    }, 700);
  };

  const resetSearch = () => {
    setQuery('');
    setFilterMode('All');
    setShowSuggestions(false);
  };

  return (
    <div className="company-list-wrapper">
      <div className="company-list-header">
        <div className="company-list-search">
          <Search size={14} className="company-search-icon" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search companies by name or symbol"
            value={query}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls="company-search-suggestions"
            aria-activedescendant={showSuggestions && suggestions[activeSuggestionIndex]
              ? `company-suggestion-${activeSuggestionIndex}` : undefined}
            onFocus={() => { if (query.trim()) setShowSuggestions(true); }}
            onBlur={() => setShowSuggestions(false)}
            onKeyDown={handleSearchKeyDown}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveSuggestionIndex(0);
              setShowSuggestions(Boolean(event.target.value.trim()));
            }}
          />
          {query && (
            <button type="button" className="clear-search-btn" onClick={resetSearch} aria-label="Clear company search" title="Clear search">
              <X size={14} />
            </button>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <div id="company-search-suggestions" className="company-suggestion-list" role="listbox" aria-label="Matching companies">
              {suggestions.map((stock, index) => (
                <button
                  type="button"
                  id={`company-suggestion-${index}`}
                  role="option"
                  aria-selected={index === activeSuggestionIndex}
                  className={index === activeSuggestionIndex ? 'is-active' : ''}
                  key={`${stock.exchange || 'NSE'}:${stock.symbol}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onClick={() => selectSuggestion(stock)}
                >
                  <span><strong>{stock.symbol}</strong><small>{stock.name}</small></span>
                  <small>{stock.exchange || 'NSE'}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="company-add-btn"
          onClick={() => { setAddError(''); setAddSuccess(false); setShowAddModal(true); }}
          title="Add a custom company to your directory"
        >
          <Plus size={15} /> Add Stock
        </button>
      </div>

      <div className="company-filter-chips" role="tablist" aria-label="Company filters">
        {['All', 'Gainers', 'Losers', 'Watchlist'].map((filter) => (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={filterMode === filter}
            className={`company-chip ${filterMode === filter ? 'active' : ''}`}
            onClick={() => { setFilterMode(filter); setShowSuggestions(false); }}
          >
            {filter === 'Watchlist' && <Star size={11} className="chip-star" />}
            {filter}{filter === 'Watchlist' ? ` (${watchlist.length})` : ''}
          </button>
        ))}
      </div>

      <div className="company-list-status" role="status" aria-live="polite">
        {catalogError
          ? `${catalogError} Showing ${companies.length.toLocaleString('en-IN')} available companies.`
          : isLoadingCatalog
            ? `Loading the full listed-company directory · ${companies.length.toLocaleString('en-IN')} available so far.`
            : `${companies.length.toLocaleString('en-IN')} companies in the directory.`}
        {' '}
        {quoteState.quoteError
          ? 'Latest quote request failed; unavailable prices are not estimated.'
          : quoteState.providerState === 'research'
            ? 'Research quotes may be delayed and are not live.'
            : quoteState.providerState === 'unavailable'
              ? 'Current prices require a configured market provider.'
              : quoteState.isLoading
                ? 'Loading published quotes for visible rows…'
                : ''}
      </div>

      {showAddModal && (
        <div className="company-add-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="company-add-modal" role="dialog" aria-modal="true" aria-labelledby="company-add-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 id="company-add-title">Add a company</h3>
              <button type="button" className="modal-close-btn" onClick={() => setShowAddModal(false)} aria-label="Close add company dialog">
                <X size={18} />
              </button>
            </div>
            {addSuccess ? (
              <div className="modal-success-msg" role="status">
                <Check size={28} className="text-emerald" />
                <p><b>{newSymbol.toUpperCase()}</b> added to your directory. Its price remains unavailable until a provider returns a verified quote.</p>
              </div>
            ) : (
              <form onSubmit={handleAddStockSubmit} className="modal-form">
                <label>
                  Stock symbol *
                  <input
                    type="text"
                    required
                    maxLength={20}
                    autoComplete="off"
                    placeholder="e.g. ZOMATO"
                    value={newSymbol}
                    onChange={(event) => { setNewSymbol(event.target.value.toUpperCase()); setAddError(''); }}
                  />
                </label>
                <label>
                  Company name *
                  <input
                    type="text"
                    required
                    maxLength={100}
                    placeholder="e.g. Zomato Limited"
                    value={newName}
                    onChange={(event) => { setNewName(event.target.value); setAddError(''); }}
                  />
                </label>
                <label>
                  Sector
                  <select value={newSector} onChange={(event) => setNewSector(event.target.value)}>
                    {SECTORS.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
                  </select>
                </label>
                {addError ? <p className="company-add-error" role="alert">{addError}</p> : null}
                <p className="company-add-note">Custom entries contain company details only. A price appears only after a market provider verifies it.</p>
                <div className="modal-form-actions">
                  <button type="button" className="secondary-button" onClick={() => setShowAddModal(false)}>Cancel</button>
                  <button type="submit" className="primary-button"><Plus size={16} /> Add to directory</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="company-list">
        {!filtered.length ? (
          <div className="company-list-empty">
            <p>{query.trim() ? `No companies found matching “${query.trim()}”.` : filterMode === 'Watchlist' ? 'Your watchlist is empty.' : `No verified ${filterMode.toLowerCase()} quotes are available yet.`}</p>
            <button type="button" className="secondary-button" onClick={resetSearch}>
              {query.trim() || filterMode !== 'All' ? 'Reset filters' : 'Clear search'}
            </button>
          </div>
        ) : (
          <List
            key={`${filterMode}:${query}`}
            defaultHeight={Math.min(480, filtered.length * COMPANY_ROW_HEIGHT)}
            rowComponent={CompanyRow}
            rowCount={filtered.length}
            rowHeight={COMPANY_ROW_HEIGHT}
            rowProps={{
              companies: filtered,
              onSelect,
              onToggleWatchlist: toggleWatchlist,
              quotes: quoteState.quotes,
              quotesLoading: quoteState.isLoading,
              selected,
              watchlist,
            }}
            onRowsRendered={handleRowsRendered}
            overscanCount={4}
            style={{ height: Math.min(480, filtered.length * COMPANY_ROW_HEIGHT), width: '100%' }}
          />
        )}
      </div>

      <div className="company-list-count">
        Showing {filtered.length.toLocaleString('en-IN')} of {companies.length.toLocaleString('en-IN')} companies
      </div>
    </div>
  );
};

export default CompanyList;
