import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Star, ArrowUpRight, TrendingUp, TrendingDown, X, Check } from 'lucide-react';
import { createCatalogStock, saveCustomStock } from '../hooks/useStockCatalog';
import CompanyLogo from './CompanyLogo';

const SECTORS = [
  'Banking', 'IT', 'Auto', 'Pharma', 'Energy', 'FMCG',
  'Metals', 'Financial Services', 'Defense & Engineering', 'Telecom', 'Diversified'
];

const getAvatarColor = (symbol = '') => {
  const colors = [
    'linear-gradient(135deg, #0d6f4e, #10b981)',
    'linear-gradient(135deg, #1e40af, #3b82f6)',
    'linear-gradient(135deg, #6d28d9, #8b5cf6)',
    'linear-gradient(135deg, #b45309, #f59e0b)',
    'linear-gradient(135deg, #0f766e, #14b8a6)',
    'linear-gradient(135deg, #be123c, #f43f5e)',
    'linear-gradient(135deg, #374151, #4b5563)',
  ];
  const charCode = (symbol.charCodeAt(0) || 65) + (symbol.charCodeAt(1) || 66);
  return colors[charCode % colors.length];
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
          filtered.map((s) => {
            const hasQuote = Number(s.price) > 0;
            const hasLiveQuote = hasQuote && s.isLive === true;
            const hasDemoQuote = hasQuote && s.isDemo === true;
            const isGain = Number(s.change) >= 0;
            const isStarred = watchlist.includes(s.symbol);
            const priceDisplay = Number(s.price).toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });

            return (
              <div
                key={s.symbol}
                className={`company-item ${selected === s.symbol ? 'active' : ''}`}
                onClick={() => onSelect && onSelect(s.symbol)}
              >
                <CompanyLogo symbol={s.symbol} name={s.name} size={38} />

                <div className="company-info-col">
                  <span className="symbol">{s.symbol}</span>
                  <div className="company-meta-sub">
                    <span className="name" title={s.name}>{s.name}</span>
                    {s.sector && <span className="company-sector-badge">{s.sector}</span>}
                  </div>
                </div>

                <div className="company-price-col">
                  <span className="company-price-tag">{hasDemoQuote ? 'Simulated demo price · not real' : hasLiveQuote ? `Current price · ${s.dataSource || 'Upstox'}` : hasQuote ? 'Last quote · stale' : 'Live quote required'}</span>
                  <div className="company-price">{hasQuote ? `₹${priceDisplay}` : 'Quote unavailable'}</div>
                  <div className={`company-change ${hasLiveQuote ? isGain ? 'gain' : 'loss' : ''}`}>
                    {(hasLiveQuote || hasDemoQuote) && s.changePercent !== null && s.changePercent !== undefined
                      ? `${isGain ? '+' : ''}${Number(s.changePercent).toFixed(2)}%`
                      : hasDemoQuote ? 'Demo change · simulated' : hasQuote ? 'Stale quote' : 'Add free Upstox token'}
                  </div>
                </div>

                <div className="company-item-actions">
                  <button
                    type="button"
                    className={`watchlist-star-btn ${isStarred ? 'starred' : ''}`}
                    onClick={(e) => toggleWatchlist(e, s.symbol)}
                    title={isStarred ? 'Remove from Watchlist' : 'Add to Watchlist'}
                  >
                    <Star size={14} fill={isStarred ? '#f59e0b' : 'none'} />
                  </button>
                  <Link
                    className="company-trade-link"
                    to={`/stocks/${s.symbol}`}
                    onClick={(e) => e.stopPropagation()}
                    title={`Trade ${s.symbol}`}
                  >
                    Trade
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="company-list-count">
        Showing {filtered.length} of {companies.length} companies
      </div>
    </div>
  );
};

export default CompanyList;
