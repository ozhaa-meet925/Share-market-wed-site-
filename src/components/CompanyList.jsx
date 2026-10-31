import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { List } from 'react-window';
import { Search, Plus, Star, X, Check } from 'lucide-react';
import { createCatalogStock, saveCustomStock } from '../hooks/useStockCatalog';
import CompanyLogo from './CompanyLogo';

const COMPANY_ROW_HEIGHT = 82;

const SECTORS = [
  'Banking', 'IT', 'Auto', 'Pharma', 'Energy', 'FMCG',
  'Metals', 'Financial Services', 'Defense & Engineering', 'Telecom', 'Diversified'
];

const CompanyRow = ({ ariaAttributes, companies, index, onSelect, onToggleWatchlist, selected, style, watchlist }) => {
  const stock = companies[index];
  if (!stock) return null;

  const hasQuote = Number(stock.price) > 0;
  const hasLiveQuote = hasQuote && stock.isLive === true;
  const hasDemoQuote = hasQuote && stock.isDemo === true;
  const hasResearchQuote = hasQuote && stock.isResearch === true;
  const isGain = Number(stock.change) >= 0;
  const isStarred = watchlist.includes(stock.symbol);
  const priceDisplay = Number(stock.price).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div {...ariaAttributes} style={{ ...style, boxSizing: 'border-box', paddingBottom: 7, paddingRight: 4 }}>
      <div
        className={`company-item ${selected === stock.symbol ? 'active' : ''}`}
        onClick={() => onSelect?.(stock.symbol)}
      >
        <CompanyLogo symbol={stock.symbol} name={stock.name} size={38} />

        <div className="company-info-col">
          <span className="symbol">{stock.symbol}</span>
          <div className="company-meta-sub">
            <span className="name" title={stock.name}>{stock.name}</span>
            {stock.sector && <span className="company-sector-badge">{stock.sector}</span>}
          </div>
        </div>

        <div className="company-price-col">
          <span className="company-price-tag">
            {hasDemoQuote ? 'Simulated demo price · not real' : hasLiveQuote ? `Current price · ${stock.dataSource || 'Live provider'}` : hasResearchQuote ? `Research quote · not live${stock.isStale ? ' · stale' : ''}` : hasQuote ? 'Last quote · stale' : 'Live quote required'}
          </span>
          <div className="company-price">{hasQuote ? `₹${priceDisplay}` : 'Quote unavailable'}</div>
          <div className={`company-change ${hasLiveQuote ? isGain ? 'gain' : 'loss' : ''}`}>
            {(hasLiveQuote || hasDemoQuote) && stock.changePercent !== null && stock.changePercent !== undefined
              ? `${isGain ? '+' : ''}${Number(stock.changePercent).toFixed(2)}%`
              : hasDemoQuote ? 'Demo change · simulated' : hasResearchQuote ? 'Research change · not live' : hasQuote ? 'Stale quote' : 'Live quote required'}
          </div>
        </div>

        <div className="company-item-actions">
          <button
            type="button"
            className={`watchlist-star-btn ${isStarred ? 'starred' : ''}`}
            onClick={(event) => onToggleWatchlist(event, stock.symbol)}
            title={isStarred ? 'Remove from Watchlist' : 'Add to Watchlist'}
            aria-label={isStarred ? `Remove ${stock.symbol} from watchlist` : `Add ${stock.symbol} to watchlist`}
          >
            <Star size={14} fill={isStarred ? '#f59e0b' : 'none'} />
          </button>
          <Link
            className="company-trade-link"
            to={`/stocks/${stock.symbol}`}
            onClick={(event) => event.stopPropagation()}
            title={`Trade ${stock.symbol}`}
          >
            Trade
          </Link>
        </div>
      </div>
    </div>
  );
};

const CompanyList = ({ companies = [], onSelect, selected, onAddStock }) => {
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const saved = localStorage.getItem('sharemarket:watchlist');
      return saved ? JSON.parse(saved) : ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY'];
    } catch {
      return ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY'];
    }
  });

  // Add stock form state
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [newSector, setNewSector] = useState('Banking');
  const [addSuccess, setAddSuccess] = useState(false);

  const toggleWatchlist = (e, symbol) => {
    e.stopPropagation();
    setWatchlist((prev) => {
      const updated = prev.includes(symbol)
        ? prev.filter((s) => s !== symbol)
        : [...prev, symbol];
      try {
        localStorage.setItem('sharemarket:watchlist', JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  };

  const handleAddStockSubmit = (e) => {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    const name = newName.trim() || sym;
    if (!sym) return;

    const newStockObj = createCatalogStock(sym, name, newSector);
    saveCustomStock(newStockObj);
    if (onAddStock) onAddStock(newStockObj);

    setAddSuccess(true);
    setTimeout(() => {
      setAddSuccess(false);
      setShowAddModal(false);
      setNewSymbol('');
      setNewName('');
      if (onSelect) onSelect(sym);
    }, 700);
  };

  const filtered = useMemo(() => {
    let result = companies;

    // Filter modes
    if (filterMode === 'Gainers') {
      result = result.filter((s) => (s.changePercent || 0) > 0);
    } else if (filterMode === 'Losers') {
      result = result.filter((s) => (s.changePercent || 0) < 0);
    } else if (filterMode === 'Watchlist') {
      result = result.filter((s) => watchlist.includes(s.symbol));
    }

    // Search query
    const term = query.trim().toLowerCase();
    if (term) {
      result = result.filter((s) => `${s.symbol} ${s.name} ${s.sector || ''}`.toLowerCase().includes(term));
    }

    return result;
  }, [companies, query, filterMode, watchlist]);

  return (
    <div className="company-list-wrapper">
      {/* Top search & Add Button */}
      <div className="company-list-header">
        <div className="company-list-search">
          <Search size={14} className="company-search-icon" />
          <input
            placeholder="Search companies by name or symbol..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="clear-search-btn" onClick={() => setQuery('')}>
              ✕
            </button>
          )}
        </div>
        <button
          type="button"
          className="company-add-btn"
          onClick={() => setShowAddModal(true)}
          title="Add a new share to website"
        >
          <Plus size={15} /> Add Stock
        </button>
      </div>

      {/* Filter Chips */}
      <div className="company-filter-chips">
        {['All', 'Gainers', 'Losers', 'Watchlist'].map((f) => (
          <button
            key={f}
            type="button"
            className={`company-chip ${filterMode === f ? 'active' : ''}`}
            onClick={() => setFilterMode(f)}
          >
            {f === 'Watchlist' && <Star size={11} className="chip-star" />}
            {f} {f === 'Watchlist' ? `(${watchlist.length})` : ''}
          </button>
        ))}
      </div>

      {/* Add Stock Modal */}
      {showAddModal && (
        <div className="company-add-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="company-add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New Share to Website</h3>
              <button type="button" className="modal-close-btn" onClick={() => setShowAddModal(false)}>
                <X size={18} />
              </button>
            </div>
            {addSuccess ? (
              <div className="modal-success-msg">
                <Check size={28} className="text-emerald" />
                <p>Stock <b>{newSymbol.toUpperCase()}</b> added successfully!</p>
              </div>
            ) : (
              <form onSubmit={handleAddStockSubmit} className="modal-form">
                <label>
                  Stock Symbol *
                  <input
                    type="text"
                    required
                    placeholder="e.g. ZOMATO, PAYTM, JIO"
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  Company Name *
                  <input
                    type="text"
                    required
                    placeholder="e.g. Zomato Limited"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
                <div className="modal-form-row">
                  <label>
                    Sector
                    <select value={newSector} onChange={(e) => setNewSector(e.target.value)}>
                      {SECTORS.map((sec) => (
                        <option key={sec} value={sec}>{sec}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="modal-form-actions">
                  <button type="button" className="secondary-button" onClick={() => setShowAddModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-button">
                    <Plus size={16} /> Add to Website
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Company List */}
      <div className="company-list">
        {filtered.length === 0 ? (
          <div className="company-list-empty">
            <p>No companies found matching "{query}".</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => { setQuery(''); setFilterMode('All'); }}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <List
            defaultHeight={Math.min(480, filtered.length * COMPANY_ROW_HEIGHT)}
            rowComponent={CompanyRow}
            rowCount={filtered.length}
            rowHeight={COMPANY_ROW_HEIGHT}
            rowProps={{
              companies: filtered,
              onSelect,
              onToggleWatchlist: toggleWatchlist,
              selected,
              watchlist,
            }}
            overscanCount={4}
            style={{ height: Math.min(480, filtered.length * COMPANY_ROW_HEIGHT), width: '100%' }}
          />
        )}
      </div>

      <div className="company-list-count">
        Showing {filtered.length} of {companies.length} companies
      </div>
    </div>
  );
};

export default CompanyList;
