import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Info,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import { TickArrow, tickToneClass } from '../components/PriceChange';
import { companyCatalog } from '../data/companyCatalog';
import { createCatalogStock } from '../hooks/useStockCatalog';
import { marketApi } from '../services/api';
import {
  WATCHLIST_EVENT,
  readWatchlistSymbols,
  saveActiveWatchlistSymbols,
} from '../utils/watchlist';

const CHUNK_SIZE = 130;
const PAGE_SIZE = 25;

const UNIVERSE = [...new Map(companyCatalog.map(({ description, symbol }) => {
  const stock = createCatalogStock(symbol, description);
  return [symbol, { symbol, name: stock.name, sector: stock.sector }];
})).values()];

const SORT_OPTIONS = [
  ['change-desc', 'Change: high to low'],
  ['change-asc', 'Change: low to high'],
  ['volume-desc', 'Volume: high to low'],
  ['price-desc', 'Price: high to low'],
  ['price-asc', 'Price: low to high'],
  ['name', 'Company name'],
];

const PRESETS = [
  { id: 'all', label: 'All stocks', filters: {} },
  { id: 'gainers', label: 'Gainers', filters: { minChange: '0.01' } },
  { id: 'losers', label: 'Losers', filters: { maxChange: '-0.01' } },
  { id: 'movers', label: 'Up 2%+', filters: { minChange: '2' } },
  { id: 'heavy', label: 'High volume', filters: { minVolume: '1000000' } },
];

const formatPrice = (value) => (Number(value) > 0
  ? `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—');

const formatVolume = (value) => (Number(value) > 0
  ? Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))
  : '—');

const Screener = () => {
  const mounted = useRef(true);
  const [quotes, setQuotes] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [watchSymbols, setWatchSymbols] = useState(readWatchlistSymbols);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minChange, setMinChange] = useState('');
  const [maxChange, setMaxChange] = useState('');
  const [minVolume, setMinVolume] = useState('');
  const [sort, setSort] = useState('change-desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const sync = () => setWatchSymbols(readWatchlistSymbols());
    window.addEventListener(WATCHLIST_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const loadQuotes = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    const collected = new Map();
    const chunks = [];
    for (let index = 0; index < UNIVERSE.length; index += CHUNK_SIZE) {
      chunks.push(UNIVERSE.slice(index, index + CHUNK_SIZE).map((stock) => stock.symbol));
    }
    let failed = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      if (!mounted.current) return;
      setProgress(`Loading quotes ${index + 1} of ${chunks.length}…`);
      try {
        const payload = await marketApi.getBatchQuotes(chunks[index]);
        for (const [key, quote] of Object.entries(payload?.quotes || {})) {
          const symbol = String(quote?.symbol || key).replace(/^(NSE|BSE|MCX):/i, '').toUpperCase();
          if (Number(quote?.c) > 0 && (quote.isResearch === true || quote.isLive === true)) collected.set(symbol, quote);
        }
      } catch {
        failed += 1;
      }
    }
    if (!mounted.current) return;
    setQuotes(collected);
    setLastUpdated(new Date());
    setProgress('');
    setLoading(false);
    setError(failed
      ? `${failed} of ${chunks.length} quote batches could not be loaded. Filters use the quotes that were received.`
      : '');
  };

  useEffect(() => {
    loadQuotes();
    // The universe loads once; use the refresh button for a new snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => UNIVERSE.map((stock) => {
    const quote = quotes.get(stock.symbol);
    if (!quote) return null;
    const price = Number(quote.c);
    const low = Number(quote.l);
    const high = Number(quote.h);
    const change = Number(quote.d);
    const changePercent = Number(quote.dp);
    const volume = Number(quote.v);
    const rangePosition = low > 0 && high > low && price > 0
      ? Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100))
      : null;
    return {
      ...stock,
      price,
      low: low > 0 ? low : null,
      high: high > 0 ? high : null,
      change: Number.isFinite(change) ? change : null,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
      volume: volume > 0 ? volume : null,
      rangePosition,
      timestamp: Number(quote.timestamp) || null,
    };
  }).filter(Boolean), [quotes]);

  const sectors = useMemo(() => ['All', ...new Set(UNIVERSE.map((stock) => stock.sector).filter(Boolean))].sort(
    (first, second) => (first === 'All' ? -1 : second === 'All' ? 1 : first.localeCompare(second)),
  ), []);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const minP = Number(minPrice);
    const maxP = Number(maxPrice);
    const minC = Number(minChange);
    const maxC = Number(maxChange);
    const minV = Number(minVolume);
    const result = rows.filter((row) => {
      if (text && !`${row.symbol} ${row.name}`.toLowerCase().includes(text)) return false;
      if (sector !== 'All' && row.sector !== sector) return false;
      if (minPrice !== '' && row.price < minP) return false;
      if (maxPrice !== '' && row.price > maxP) return false;
      if (minChange !== '' && (row.changePercent ?? -Infinity) < minC) return false;
      if (maxChange !== '' && (row.changePercent ?? Infinity) > maxC) return false;
      if (minVolume !== '' && (row.volume ?? 0) < minV) return false;
      return true;
    });
    return result.sort((first, second) => {
      if (sort === 'change-desc') return (second.changePercent ?? -Infinity) - (first.changePercent ?? -Infinity);
      if (sort === 'change-asc') return (first.changePercent ?? Infinity) - (second.changePercent ?? Infinity);
      if (sort === 'volume-desc') return (second.volume ?? 0) - (first.volume ?? 0);
      if (sort === 'price-desc') return second.price - first.price;
      if (sort === 'price-asc') return first.price - second.price;
      return first.name.localeCompare(second.name);
    });
  }, [maxChange, maxPrice, minChange, minPrice, minVolume, query, rows, sector, sort]);

  useEffect(() => setPage(1), [maxChange, maxPrice, minChange, minPrice, minVolume, query, sector, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const advancing = rows.filter((row) => (row.changePercent ?? 0) > 0).length;
  const declining = rows.filter((row) => (row.changePercent ?? 0) < 0).length;

  const toggleWatch = (symbol) => {
    const next = watchSymbols.includes(symbol)
      ? watchSymbols.filter((item) => item !== symbol)
      : [symbol, ...watchSymbols];
    setWatchSymbols(next);
    saveActiveWatchlistSymbols(next);
  };

  const resetFilters = () => {
    setQuery('');
    setSector('All');
    setMinPrice('');
    setMaxPrice('');
    setMinChange('');
    setMaxChange('');
    setMinVolume('');
    setSort('change-desc');
  };

  const applyPreset = (id) => {
    const selected = PRESETS.find((item) => item.id === id);
    if (!selected) return;
    setMinChange(selected.filters.minChange || '');
    setMaxChange(selected.filters.maxChange || '');
    setMinVolume(selected.filters.minVolume || '');
  };

  const activePreset = PRESETS.find((item) => item.id !== 'all' && Object.keys(item.filters).every((key) => String({ minChange, maxChange, minVolume }[key] ?? '') === item.filters[key]))?.id || 'all';

  const activeFilterCount = [
    query.trim(),
    sector !== 'All' ? sector : '',
    minPrice,
    maxPrice,
    minChange,
    maxChange,
    minVolume,
  ].filter(Boolean).length;

  const showSkeleton = loading && quotes.size === 0;

  return (
    <div className="page stock-screener-page">
      <div className="page-title screener-header">
        <div>
          <span>Stock Screener</span>
          <h1>Filter the market</h1>
          <p>Screen {UNIVERSE.length} NSE-listed companies by price, daily move and traded volume.</p>
        </div>
        <div className="screener-header-actions">
          {lastUpdated ? <small>Quotes as of {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</small> : null}
          <button type="button" className="secondary-button" onClick={loadQuotes} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'screener-spin' : ''} /> {loading ? 'Refreshing…' : 'Refresh quotes'}
          </button>
        </div>
      </div>

      <div className="screener-source-note" role="status">
        <Info size={15} />
        <span>
          Quotes come from the Yahoo Finance research feed. They are delayed and not live. A symbol without a verified quote is excluded instead of showing a placeholder price.
          {progress ? ` ${progress}` : ''}
        </span>
      </div>
      {error ? <p className="error-message" role="alert">{error}</p> : null}

      <section className="screener-kpi-grid" aria-label="Screener summary">
        <div className="panel kpi-card"><span className="kpi-label">Matched</span><strong className="kpi-value">{filtered.length}</strong><small className="kpi-subtext">of {rows.length} quoted</small></div>
        <div className="panel kpi-card"><span className="kpi-label">Advancing</span><strong className="kpi-value gain">{advancing}</strong><small className="kpi-subtext">positive today</small></div>
        <div className="panel kpi-card"><span className="kpi-label">Declining</span><strong className="kpi-value loss">{declining}</strong><small className="kpi-subtext">negative today</small></div>
        <div className="panel kpi-card"><span className="kpi-label">Universe</span><strong className="kpi-value">{UNIVERSE.length}</strong><small className="kpi-subtext">NSE symbols in catalog</small></div>
      </section>

      <section className="panel screener-filters">
        <div className="section-heading">
          <div>
            <span>Filters</span>
            <h2><SlidersHorizontal size={17} /> Narrow the list</h2>
          </div>
          <div className="screener-filter-actions">
            {activeFilterCount ? <small>{activeFilterCount} active</small> : null}
            <button type="button" className="secondary-button" onClick={resetFilters}>Reset</button>
          </div>
        </div>
        <div className="screener-presets" role="group" aria-label="Quick filters">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`screener-preset ${activePreset === item.id ? 'active' : ''}`}
              aria-pressed={activePreset === item.id}
              onClick={() => applyPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="screener-filter-grid">
          <label>
            Search
            <span className="screener-input-with-icon"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Symbol or company" /></span>
          </label>
          <label>
            Sector
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              {sectors.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Price from (₹)
            <input type="number" min="0" step="0.01" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="0" />
          </label>
          <label>
            Price to (₹)
            <input type="number" min="0" step="0.01" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Any" />
          </label>
          <label>
            Change ≥ (%)
            <input type="number" step="0.01" value={minChange} onChange={(event) => setMinChange(event.target.value)} placeholder="Any" />
          </label>
          <label>
            Change ≤ (%)
            <input type="number" step="0.01" value={maxChange} onChange={(event) => setMaxChange(event.target.value)} placeholder="Any" />
          </label>
          <label>
            Min volume
            <input type="number" min="0" step="1000" value={minVolume} onChange={(event) => setMinVolume(event.target.value)} placeholder="Any" />
          </label>
          <label>
            Sort by
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel screener-results">
        <div className="section-heading">
          <div>
            <span>Results</span>
            <h2>{filtered.length} matching companies</h2>
          </div>
          <span className="screener-page-count">Page {page} of {pageCount}</span>
        </div>
        <div className="table-responsive">
          <table className="screener-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Sector</th>
                <th>Price</th>
                <th>Day change</th>
                <th>Day range</th>
                <th>Volume</th>
                <th>Quote time</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {showSkeleton
                ? Array.from({ length: 8 }, (_, index) => (
                  <tr key={`skeleton-${index}`} className="screener-skeleton-row" aria-hidden="true">
                    <td><span className="screener-skeleton wide" /></td>
                    <td><span className="screener-skeleton short" /></td>
                    <td><span className="screener-skeleton short" /></td>
                    <td><span className="screener-skeleton short" /></td>
                    <td><span className="screener-skeleton medium" /></td>
                    <td><span className="screener-skeleton short" /></td>
                    <td><span className="screener-skeleton medium" /></td>
                    <td />
                  </tr>
                ))
                : visibleRows.map((row) => {
                const isGain = (row.changePercent ?? 0) > 0;
                const isLoss = (row.changePercent ?? 0) < 0;
                const rowDirection = isGain ? 'up' : isLoss ? 'down' : 'flat';
                return (
                  <tr key={row.symbol}>
                    <td data-label="Company">
                      <Link to={`/stocks/${row.symbol}`} className="screener-symbol">
                        <b>{row.symbol}</b>
                        <span>{row.name}</span>
                      </Link>
                    </td>
                    <td data-label="Sector"><span className="badge-sector-mini">{row.sector}</span></td>
                    <td data-label="Price"><strong className={tickToneClass(rowDirection, null)}>{formatPrice(row.price)}</strong></td>
                    <td data-label="Day change">
                      <span className={`screener-change ${isGain ? 'gain' : isLoss ? 'loss' : 'price-flat'}`}>
                        <TickArrow direction={rowDirection} />
                        {row.changePercent === null ? '—' : `${isGain ? '+' : ''}${row.changePercent.toFixed(2)}%`}
                        {row.change === null ? '' : ` (${isGain ? '+' : ''}${row.change.toFixed(2)})`}
                      </span>
                    </td>
                    <td data-label="Day range">
                      {row.rangePosition === null ? '—' : (
                        <div className="screener-range" title={`Low ${formatPrice(row.low)} · High ${formatPrice(row.high)}`}>
                          <div className="screener-range-track"><span style={{ width: `${row.rangePosition}%` }} /></div>
                          <small>{formatPrice(row.low)} – {formatPrice(row.high)}</small>
                        </div>
                      )}
                    </td>
                    <td data-label="Volume">{formatVolume(row.volume)}</td>
                    <td data-label="Quote time">{row.timestamp ? new Date(row.timestamp * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td data-label="Actions">
                      <div className="screener-row-actions">
                        <button
                          type="button"
                          className={`screener-star ${watchSymbols.includes(row.symbol) ? 'is-watched' : ''}`}
                          onClick={() => toggleWatch(row.symbol)}
                          title={watchSymbols.includes(row.symbol) ? 'Remove from active watchlist' : 'Add to active watchlist'}
                          aria-label={watchSymbols.includes(row.symbol) ? `Remove ${row.symbol} from watchlist` : `Add ${row.symbol} to watchlist`}
                        >
                          <Star size={15} fill={watchSymbols.includes(row.symbol) ? 'currentColor' : 'none'} />
                        </button>
                        <Link to={`/stocks/${row.symbol}`} className="screener-open" aria-label={`Open ${row.symbol}`}><ArrowUpRight size={15} /></Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && visibleRows.length === 0 ? (
          <div className="screener-empty">
            <Search size={26} />
            <strong>No companies match these filters</strong>
            <span>Loosen the price or change range, then try again.</span>
          </div>
        ) : null}
        {pageCount > 1 ? (
          <footer className="stocks-pagination screener-pagination">
            <button type="button" className="secondary-button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <button type="button" className="secondary-button" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button>
          </footer>
        ) : null}
      </section>
    </div>
  );
};

export default Screener;
