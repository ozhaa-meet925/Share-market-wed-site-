import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Star,
  Search,
  Trash2,
  Bell,
  TrendingUp,
  GitCompareArrows,
  ArrowRight,
  Plus,
  Bookmark,
  Check,
} from 'lucide-react';
import './MFWatchlist.css';

export default function MFWatchlist() {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Alerts in localStorage
  const [alerts, setAlerts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sharemarket:mf_alerts')) || {};
    } catch {
      return {};
    }
  });

  const [activeAlertModal, setActiveAlertModal] = useState(null); // schemeCode
  const [targetNav, setTargetNav] = useState('');

  // Load watchlist
  const loadWatchlist = (silent = false) => {
    if (!silent) setLoading(true);
    fetch('/api/mf/watchlist')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setWatchlist(Array.isArray(data) ? data : data?.watchlist || []))
      .catch(() => {
        if (!silent) setWatchlist([]);
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    loadWatchlist();
    const intervalId = window.setInterval(() => loadWatchlist(true), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Search autocomplete
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/mutual-funds/search?q=${encodeURIComponent(searchQuery)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          const list = Array.isArray(data) ? data : data?.data || [];
          setSearchResults(list.slice(0, 5));
        })
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Add to watchlist
  const handleAdd = async (s) => {
    const code = String(s.schemeCode || s.scheme_code);
    const name = s.schemeName || s.scheme_name;

    try {
      const res = await fetch('/api/mf/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheme_code: code,
          scheme_name: name,
          fund_house: 'Mutual Fund AMC',
          category: 'Equity',
        }),
      });

      if (res.ok) {
        setSearchQuery('');
        setSearchResults([]);
        loadWatchlist();
      }
    } catch {}
  };

  // Remove from watchlist
  const handleRemove = async (code) => {
    try {
      const res = await fetch(`/api/mf/watchlist/${code}`, { method: 'DELETE' });
      if (res.ok) {
        loadWatchlist();
      }
    } catch {}
  };

  // Save alert
  const handleSaveAlert = (code) => {
    if (!targetNav) return;
    const newAlerts = { ...alerts, [code]: parseFloat(targetNav) };
    setAlerts(newAlerts);
    localStorage.setItem('sharemarket:mf_alerts', JSON.stringify(newAlerts));
    setActiveAlertModal(null);
    setTargetNav('');
  };

  const handleRemoveAlert = (code) => {
    const newAlerts = { ...alerts };
    delete newAlerts[code];
    setAlerts(newAlerts);
    localStorage.setItem('sharemarket:mf_alerts', JSON.stringify(newAlerts));
  };

  return (
    <div className="mfwl-page">
      <div className="mfwl-header">
        <h1 className="mfwl-title">Mutual Fund Watchlist</h1>
        <p className="mfwl-sub">Track your shortlisted funds and set price notifications</p>
      </div>

      {/* ── SEARCH & ADD ── */}
      <div className="mfwl-card" style={{ padding: '16px 20px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Search size={18} style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            placeholder="Search mutual fund to add to watchlist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', border: 'none', background: 'none', outline: 'none', color: 'var(--text)', fontSize: '0.92rem' }}
          />
        </div>

        {searchResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-3)', zIndex: 40, marginTop: 6 }}>
            {searchResults.map((s) => {
              const code = String(s.schemeCode || s.scheme_code);
              const name = s.schemeName || s.scheme_name;
              return (
                <div
                  key={code}
                  onClick={() => handleAdd(s)}
                  style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>
                    <strong style={{ fontSize: '0.86rem' }}>{name}</strong>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Code: {code}</div>
                  </div>
                  <Plus size={16} style={{ color: 'var(--brand)' }} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── WATCHLIST TABLE ── */}
      <div className="mfwl-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--text-3)', padding: 24 }}>Loading watchlist...</p>
        ) : watchlist.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 20px', color: 'var(--text-3)' }}>
            <Star size={40} style={{ opacity: 0.35, marginBottom: 12 }} />
            <p style={{ margin: '0 0 14px' }}>Your mutual fund watchlist is empty.</p>
            <Link
              to="/mutual-funds/explore"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                borderRadius: 8,
                background: 'var(--brand)',
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '0.86rem',
              }}
            >
              Explore Funds to Track <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="mfwl-table-wrap">
            <table className="mfwl-table">
              <thead>
                <tr>
                  <th>Scheme Name</th>
                  <th>Category</th>
                  <th>Current NAV</th>
                  <th>NAV Alert</th>
                  <th>Invest</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((item) => {
                  const alertVal = alerts[item.scheme_code];
                  return (
                    <tr key={item.id || item.scheme_code}>
                      <td>
                        <Link
                          to={`/mutual-funds/fund/${item.scheme_code}`}
                          style={{ fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}
                        >
                          {item.scheme_name}
                        </Link>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                          {item.fund_house || 'Mutual Fund'} · Code: {item.scheme_code}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.74rem', padding: '2px 8px', borderRadius: 6, background: 'var(--surface-3)', fontWeight: 650 }}>
                          {item.category || 'Equity'}
                        </span>
                      </td>
                      <td>
                        <strong>{item.nav ? `₹${Number(item.nav).toFixed(2)}` : 'Published daily'}</strong>
                        {item.date && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{item.date}</div>
                        )}
                      </td>
                      <td>
                        {alertVal ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.78rem', color: 'var(--brand)', fontWeight: 650 }}>
                              Target: ₹{alertVal}
                            </span>
                            <button
                              onClick={() => handleRemoveAlert(item.scheme_code)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '0.72rem' }}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setActiveAlertModal(item.scheme_code);
                              setTargetNav(item.nav ? String(item.nav) : '');
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: '1px solid var(--line)',
                              background: 'transparent',
                              color: 'var(--text-2)',
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Bell size={12} /> Set Alert
                          </button>
                        )}
                      </td>
                      <td>
                        <Link
                          to={`/mutual-funds/sip?code=${item.scheme_code}&name=${encodeURIComponent(item.scheme_name)}`}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            background: 'var(--brand)',
                            color: '#fff',
                            textDecoration: 'none',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                          }}
                        >
                          Start SIP
                        </Link>
                      </td>
                      <td>
                        <button
                          onClick={() => handleRemove(item.scheme_code)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}
                          title="Remove from Watchlist"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SET ALERT MODAL ── */}
      {activeAlertModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--surface)', padding: 24, borderRadius: 16, width: 340, border: '1px solid var(--line)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontWeight: 800 }}>Set NAV Target Price</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', margin: '0 0 14px' }}>
              Receive an on-screen alert when this fund's published NAV crosses your target.
            </p>
            <input
              type="number"
              step="0.1"
              placeholder="Target NAV in ₹"
              value={targetNav}
              onChange={(e) => setTargetNav(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setActiveAlertModal(null)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveAlert(activeAlertModal)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >
                Save Alert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
