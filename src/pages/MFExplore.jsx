import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  SlidersHorizontal,
  RefreshCw,
  GitCompareArrows,
  Bookmark,
  Check,
  ArrowRight,
  TrendingUp,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import './MFExplore.css';

const CATEGORIES = [
  'All',
  'Equity',
  'Debt',
  'Hybrid',
  'Index',
  'ELSS',
  'Large Cap',
  'Mid Cap',
  'Small Cap',
  'Liquid',
  'Sectoral',
];

const PLANS = ['All', 'Direct', 'Regular'];
const OPTIONS = ['All', 'Growth', 'IDCW'];
const PAGE_SIZE = 8;

export default function MFExplore() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQuery = searchParams.get('q') || '';
  const initialCategory = searchParams.get('category') || 'All';

  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [selectedPlan, setSelectedPlan] = useState('All');
  const [selectedOption, setSelectedOption] = useState('All');
  const [sort, setSort] = useState('returns');
  const [minReturn, setMinReturn] = useState('');
  const [offset, setOffset] = useState(0);

  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Compare selection (up to 5)
  const [compareList, setCompareList] = useState([]);
  // Watchlist stored in memory / local state
  const [watchlistCodes, setWatchlistCodes] = useState(new Set());

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Load existing watchlist from API on mount
  useEffect(() => {
    fetch('/api/mf/watchlist')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.watchlist) {
          setWatchlistCodes(new Set(data.watchlist.map((w) => String(w.scheme_code))));
        }
      })
      .catch(() => {});
  }, []);

  // Fetch schemes
  const fetchSchemes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let rawList = [];

      if (debouncedQuery.length >= 2) {
        const res = await fetch(`/api/mutual-funds/search?q=${encodeURIComponent(debouncedQuery)}`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        rawList = Array.isArray(data) ? data : data?.data || [];
      } else if (selectedCategory !== 'All') {
        const res = await fetch(`/api/mutual-funds/search?q=${encodeURIComponent(selectedCategory)}`);
        if (!res.ok) throw new Error('Category fetch failed');
        const data = await res.json();
        rawList = Array.isArray(data) ? data : data?.data || [];
      } else {
        const res = await fetch(`/api/mutual-funds/schemes?limit=${PAGE_SIZE * 2}&offset=${offset}`);
        if (!res.ok) throw new Error('Failed to load schemes');
        const data = await res.json();
        rawList = Array.isArray(data) ? data : data?.data || [];
      }

      const sliced = rawList.slice(0, PAGE_SIZE);

      // Enrich with latest NAV & history in parallel
      const enriched = await Promise.all(
        sliced.map(async (item) => {
          const code = String(item.schemeCode || item.scheme_code || item.code || '');
          const name = String(item.schemeName || item.scheme_name || item.name || '');

          try {
            const navRes = await fetch(`/api/mutual-funds/${encodeURIComponent(code)}/latest`);
            const navData = navRes.ok ? await navRes.json() : null;

            const latestPoint = navData?.data?.[0];
            const currentNav = latestPoint?.nav ? parseFloat(latestPoint.nav) : null;
            const date = latestPoint?.date || null;
            const category = navData?.meta?.scheme_category || 'Equity';
            const fundHouse = navData?.meta?.fund_house || 'Mutual Fund';

            // compute 1Y approx return
            const historyRes = await fetch(`/api/mutual-funds/${encodeURIComponent(code)}/nav`);
            const historyData = historyRes.ok ? await historyRes.json() : null;
            let y1Return = null;
            let dailyChange = null;

            if (historyData?.data && historyData.data.length > 1) {
              const pts = historyData.data;
              const p0 = parseFloat(pts[0].nav);
              const p1 = parseFloat(pts[1].nav);
              if (p0 && p1) {
                dailyChange = {
                  amount: p0 - p1,
                  percent: ((p0 - p1) / p1) * 100,
                };
              }
              // rough 1Y (365 days ago)
              if (pts.length > 250) {
                const p365 = parseFloat(pts[Math.min(250, pts.length - 1)].nav);
                if (p365 > 0) {
                  y1Return = ((p0 - p365) / p365) * 100;
                }
              }
            }

            return {
              code,
              name,
              category,
              fundHouse,
              nav: currentNav,
              date,
              dailyChange,
              returns: { y1: y1Return },
              plan: /\bdirect\b/i.test(name) ? 'Direct' : 'Regular',
              option: /\bidcw\b|dividend/i.test(name) ? 'IDCW' : 'Growth',
            };
          } catch {
            return {
              code,
              name,
              category: 'Equity',
              fundHouse: 'AMC',
              nav: null,
              date: null,
              dailyChange: null,
              returns: { y1: null },
              plan: 'Direct',
              option: 'Growth',
            };
          }
        })
      );

      setFunds(enriched);
    } catch (err) {
      setError(err.message || 'Could not load mutual funds');
      setFunds([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [debouncedQuery, selectedCategory, offset]);

  useEffect(() => {
    fetchSchemes();
  }, [fetchSchemes]);

  // Client-side filtering
  const filteredFunds = useMemo(() => {
    let result = funds;

    if (selectedPlan !== 'All') {
      result = result.filter((f) => f.plan.toLowerCase() === selectedPlan.toLowerCase());
    }

    if (selectedOption !== 'All') {
      result = result.filter((f) => f.option.toLowerCase() === selectedOption.toLowerCase());
    }

    if (minReturn !== '') {
      const min = parseFloat(minReturn);
      result = result.filter((f) => f.returns?.y1 != null && f.returns.y1 >= min);
    }

    return [...result].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'nav-desc') return (b.nav || 0) - (a.nav || 0);
      if (sort === 'nav-asc') return (a.nav || 0) - (b.nav || 0);
      return (b.returns?.y1 || -999) - (a.returns?.y1 || -999);
    });
  }, [funds, selectedPlan, selectedOption, minReturn, sort]);

  // Toggle watchlist
  const handleToggleWatchlist = async (fund) => {
    const code = String(fund.code);
    const inWatchlist = watchlistCodes.has(code);

    if (inWatchlist) {
      // remove
      try {
        await fetch(`/api/mf/watchlist/${code}`, { method: 'DELETE' });
        setWatchlistCodes((prev) => {
          const next = new Set(prev);
          next.delete(code);
          return next;
        });
      } catch {}
    } else {
      // add
      try {
        await fetch('/api/mf/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheme_code: code,
            scheme_name: fund.name,
            fund_house: fund.fundHouse,
            category: fund.category,
          }),
        });
        setWatchlistCodes((prev) => new Set([...prev, code]));
      } catch {}
    }
  };

  // Toggle compare
  const handleToggleCompare = (fund) => {
    const exists = compareList.some((item) => item.code === fund.code);
    if (exists) {
      setCompareList((prev) => prev.filter((item) => item.code !== fund.code));
    } else {
      if (compareList.length < 5) {
        setCompareList((prev) => [...prev, fund]);
      } else {
        alert('You can compare a maximum of 5 mutual funds at a time.');
      }
    }
  };

  return (
    <div className="mfe-page">
      {/* ── HEADER ── */}
      <div className="mfe-header">
        <div className="mfe-header-left">
          <h1 className="mfe-title">Explore Mutual Funds</h1>
          <div className="mfe-meta">
            <span>Official AMFI registered schemes</span> · <span>Updated daily</span>
          </div>
        </div>
        <button
          className={`mfe-refresh-btn ${refreshing ? 'spinning' : ''}`}
          onClick={() => {
            setRefreshing(true);
            fetchSchemes();
          }}
          disabled={loading || refreshing}
        >
          <RefreshCw size={14} /> Refresh NAV
        </button>
      </div>

      {/* ── SEARCH BAR ── */}
      <div className="mfe-search-bar">
        <div className="mfe-search-wrap">
          <Search size={18} className="mfe-search-icon" />
          <input
            type="text"
            className="mfe-search-input"
            placeholder="Search by fund name, AMC, code (e.g. Parag Parikh Flexi Cap, SBI Bluechip, 119598)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="mfe-search-clear" onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── FILTERS ── */}
      <div className="mfe-filters">
        {/* Categories */}
        <div className="mfe-filter-row">
          <span className="mfe-filter-label">Category:</span>
          <div className="mfe-chips">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`mfe-chip ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => {
                  setSelectedCategory(cat);
                  setOffset(0);
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Plan & Option & Sort */}
        <div className="mfe-filter-row" style={{ marginTop: 8 }}>
          <span className="mfe-filter-label">Plan:</span>
          <div className="mfe-chips">
            {PLANS.map((p) => (
              <button
                key={p}
                className={`mfe-chip ${selectedPlan === p ? 'active' : ''}`}
                onClick={() => setSelectedPlan(p)}
              >
                {p}
              </button>
            ))}
          </div>

          <span className="mfe-filter-sep">|</span>

          <span className="mfe-filter-label">Option:</span>
          <div className="mfe-chips">
            {OPTIONS.map((o) => (
              <button
                key={o}
                className={`mfe-chip ${selectedOption === o ? 'active' : ''}`}
                onClick={() => setSelectedOption(o)}
              >
                {o}
              </button>
            ))}
          </div>

          <span className="mfe-filter-sep">|</span>

          <label className="mfe-min-return-wrap">
            <span className="mfe-min-return-label">Min 1Y Return:</span>
            <input
              type="number"
              className="mfe-min-return-input"
              placeholder="e.g. 15%"
              value={minReturn}
              onChange={(e) => setMinReturn(e.target.value)}
            />
          </label>

          <span className="mfe-filter-sep">|</span>

          <span className="mfe-filter-label">Sort:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '0.82rem',
            }}
          >
            <option value="returns">Highest 1Y Return</option>
            <option value="nav-desc">Highest NAV</option>
            <option value="nav-asc">Lowest NAV</option>
            <option value="name">Name (A-Z)</option>
          </select>
        </div>
      </div>

      {/* ── FUND CARDS GRID ── */}
      {loading ? (
        <div className="mfe-grid">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="mfe-card" style={{ height: 210 }}>
              <div className="mfh-shimmer" style={{ width: '80%', height: 20, marginBottom: 12, borderRadius: 6 }} />
              <div className="mfh-shimmer" style={{ width: '50%', height: 14, marginBottom: 20, borderRadius: 6 }} />
              <div className="mfh-shimmer" style={{ width: '100%', height: 40, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--loss)' }}>
          <p>{error}</p>
          <button
            onClick={fetchSchemes}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--brand)',
              color: '#fff',
              marginTop: 12,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      ) : filteredFunds.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-3)' }}>
          <p>No mutual funds match the selected filters or search query.</p>
          <button
            onClick={() => {
              setQuery('');
              setSelectedCategory('All');
              setSelectedPlan('All');
              setSelectedOption('All');
              setMinReturn('');
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--text)',
              marginTop: 10,
              cursor: 'pointer',
            }}
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="mfe-grid">
          {filteredFunds.map((fund) => {
            const isCompared = compareList.some((item) => item.code === fund.code);
            const isWatchlisted = watchlistCodes.has(String(fund.code));
            const y1 = fund.returns?.y1;
            const daily = fund.dailyChange;

            return (
              <div key={fund.code} className="mfe-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <Link
                      to={`/mutual-funds/fund/${fund.code}`}
                      style={{
                        fontWeight: 700,
                        fontSize: '0.98rem',
                        color: 'var(--text)',
                        textDecoration: 'none',
                        lineHeight: 1.3,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {fund.name}
                    </Link>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 4 }}>
                      {fund.fundHouse} · {fund.category}
                    </div>
                  </div>

                  <button
                    onClick={() => handleToggleWatchlist(fund)}
                    title={isWatchlisted ? 'Remove from Watchlist' : 'Add to Watchlist'}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: isWatchlisted ? 'var(--brand)' : 'var(--text-3)',
                      cursor: 'pointer',
                      padding: 4,
                    }}
                  >
                    <Bookmark size={18} fill={isWatchlisted ? 'currentColor' : 'none'} />
                  </button>
                </div>

                {/* Tags */}
                <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 6, background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                    {fund.plan}
                  </span>
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 6, background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                    {fund.option}
                  </span>
                </div>

                {/* Metrics */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Latest NAV</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>
                      {fund.nav != null ? `₹${fund.nav.toFixed(2)}` : '—'}
                    </div>
                    {daily && (
                      <div style={{ fontSize: '0.72rem', color: daily.amount >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                        {daily.amount >= 0 ? '+' : ''}₹{daily.amount.toFixed(2)} ({daily.percent >= 0 ? '+' : ''}{daily.percent.toFixed(2)}%)
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>1Y Return</div>
                    <div
                      style={{
                        fontSize: '1.05rem',
                        fontWeight: 700,
                        color: y1 == null ? 'var(--text-3)' : y1 >= 0 ? 'var(--gain)' : 'var(--loss)',
                      }}
                    >
                      {y1 != null ? `${y1 >= 0 ? '+' : ''}${y1.toFixed(1)}%` : '—'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
                      {fund.date ? `As of ${fund.date}` : ''}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                  <button
                    onClick={() => handleToggleCompare(fund)}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: isCompared ? '1px solid var(--brand)' : '1px solid var(--line)',
                      background: isCompared ? 'var(--brand-soft)' : 'transparent',
                      color: isCompared ? 'var(--brand)' : 'var(--text-2)',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      cursor: 'pointer',
                    }}
                  >
                    {isCompared ? <Check size={13} /> : <GitCompareArrows size={13} />}
                    {isCompared ? 'Added' : 'Compare'}
                  </button>

                  <Link
                    to={`/mutual-funds/sip?code=${fund.code}&name=${encodeURIComponent(fund.name)}`}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--brand)',
                      color: '#fff',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      textAlign: 'center',
                      textDecoration: 'none',
                    }}
                  >
                    Invest / SIP
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PAGINATION ── */}
      {!debouncedQuery && selectedCategory === 'All' && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 32 }}>
          <button
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: offset === 0 ? 'not-allowed' : 'pointer',
              opacity: offset === 0 ? 0.5 : 1,
            }}
          >
            <ChevronLeft size={16} /> Previous
          </button>

          <span style={{ fontSize: '0.86rem', color: 'var(--text-3)' }}>
            Page {Math.floor(offset / PAGE_SIZE) + 1}
          </span>

          <button
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            disabled={loading || funds.length < PAGE_SIZE}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: funds.length < PAGE_SIZE ? 'not-allowed' : 'pointer',
              opacity: funds.length < PAGE_SIZE ? 0.5 : 1,
            }}
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* ── FIXED COMPARE TRAY ── */}
      {compareList.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
            borderRadius: 16,
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            zIndex: 100,
            maxWidth: 640,
            width: 'calc(100% - 32px)',
          }}
        >
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)' }}>
              Compare Funds ({compareList.length}/5)
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, overflowX: 'auto' }}>
              {compareList.map((f) => (
                <span
                  key={f.code}
                  style={{
                    fontSize: '0.72rem',
                    background: 'var(--surface-3)',
                    padding: '2px 8px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                    color: 'var(--text-2)',
                  }}
                >
                  {f.name.slice(0, 20)}...
                </span>
              ))}
            </div>
          </div>

          <button
            onClick={() => setCompareList([])}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-3)',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>

          <button
            onClick={() => {
              const codes = compareList.map((f) => f.code).join(',');
              navigate(`/mutual-funds/compare?codes=${codes}`);
            }}
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--brand)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Compare Now →
          </button>
        </div>
      )}
    </div>
  );
}
