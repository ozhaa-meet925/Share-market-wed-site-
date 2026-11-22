import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Briefcase,
  TrendingUp,
  AlertCircle,
  Plus,
  RefreshCw,
  Trash2,
  X,
  ArrowUpRight,
  ExternalLink,
} from 'lucide-react';
import './MFPortfolio.css';

const PIE_COLORS = ['#0d6f4e', '#1f6f8b', '#b8860b', '#7c3aed', '#db2777', '#f97316'];

export default function MFPortfolio() {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [txTab, setTxTab] = useState('All');

  // Add Holding Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [addName, setAddName] = useState('');
  const [addCategory, setAddCategory] = useState('Equity');
  const [addUnits, setAddUnits] = useState('');
  const [addAvgNav, setAddAvgNav] = useState('');
  const [addInvested, setAddInvested] = useState('');
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
  const [addSipId, setAddSipId] = useState('');
  const [sips, setSips] = useState([]);

  // Autocomplete search inside modal
  const [modalSearch, setModalSearch] = useState('');
  const [modalResults, setModalResults] = useState([]);

  // Load portfolio
  const loadPortfolio = (silent = false) => {
    if (!silent) setLoading(true);
    fetch('/api/mf/portfolio')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setPortfolio(data);
        else if (!silent) setPortfolio(null);
      })
      .catch(() => {
        if (!silent) setPortfolio(null);
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  // Load transactions
  const loadTransactions = (silent = false) => {
    if (!silent) setLoadingTx(true);
    fetch('/api/mf/transactions')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTransactions(Array.isArray(data) ? data : data?.transactions || []))
      .catch(() => {
        if (!silent) setTransactions([]);
      })
      .finally(() => {
        if (!silent) setLoadingTx(false);
      });
  };

  const loadSipOptions = () => {
    fetch('/api/mf/sip')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSips(Array.isArray(data?.sips) ? data.sips : []))
      .catch(() => {});
  };

  useEffect(() => {
    loadPortfolio();
    loadTransactions();
    loadSipOptions();
    const intervalId = window.setInterval(() => {
      loadPortfolio(true);
      loadTransactions(true);
      loadSipOptions();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Modal search
  useEffect(() => {
    if (!modalSearch || modalSearch.length < 2 || modalSearch === addName) {
      setModalResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/mutual-funds/search?q=${encodeURIComponent(modalSearch)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          const list = Array.isArray(data) ? data : data?.data || [];
          setModalResults(list.slice(0, 5));
        })
        .catch(() => setModalResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [modalSearch, addName]);

  // Handle Add Holding
  const handleAddHolding = async (e) => {
    e.preventDefault();
    if (!addCode || !addName) {
      alert('Please search and select a scheme.');
      return;
    }

    const units = parseFloat(addUnits) || 0;
    const avgNav = parseFloat(addAvgNav) || 0;
    const invested = parseFloat(addInvested) || units * avgNav;

    try {
      const res = await fetch('/api/mf/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheme_code: addCode,
          scheme_name: addName,
          fund_house: 'Mutual Fund AMC',
          category: addCategory,
          units,
          avg_nav: avgNav,
          invested_amount: invested,
          purchase_date: addDate,
          sip_id: addSipId ? Number(addSipId) : null,
        }),
      });

      if (res.ok) {
        setShowAddModal(false);
        setAddCode('');
        setAddName('');
        setModalSearch('');
        setAddUnits('');
        setAddAvgNav('');
        setAddInvested('');
        setAddSipId('');
        loadPortfolio();
      } else {
        alert('Could not save holding.');
      }
    } catch {
      alert('Network error adding holding.');
    }
  };

  // Delete holding
  const handleDeleteHolding = async (id) => {
    if (!window.confirm('Remove this holding from your portfolio?')) return;
    try {
      const res = await fetch(`/api/mf/portfolio/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadPortfolio();
      }
    } catch {}
  };

  // Pie chart data
  const pieData = useMemo(() => {
    const serverAllocation = portfolio?.allocation;
    if (Array.isArray(serverAllocation) && serverAllocation.length) {
      return serverAllocation.map((entry) => ({
        name: entry.category,
        value: Math.round(entry.current_value),
        weight: entry.weight_percent,
        holdings: entry.holdings,
      }));
    }
    if (!portfolio?.holdings?.length) return [];
    const catMap = {};
    let total = 0;
    for (const h of portfolio.holdings) {
      const cat = h.category || 'Other';
      const value = h.current_value || h.invested_amount || 0;
      catMap[cat] = (catMap[cat] || 0) + value;
      total += value;
    }
    return Object.entries(catMap).map(([name, value]) => ({
      name,
      value: Math.round(value),
      weight: total ? +((value / total) * 100).toFixed(2) : 0,
    }));
  }, [portfolio]);

  const investmentSplit = portfolio?.investment_split;
  const tax = portfolio?.tax;
  const splitTotalInvested = investmentSplit
    ? (investmentSplit.sip_linked.invested || 0) + (investmentSplit.lumpsum.invested || 0)
    : 0;

  const fmtCurrency = (val) => `₹${Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const filteredTx = useMemo(() => {
    if (txTab === 'All') return transactions;
    return transactions.filter((t) => t.type?.toLowerCase() === txTab.toLowerCase());
  }, [transactions, txTab]);

  return (
    <div className="mfp-page">
      {/* ── HEADER ── */}
      <div className="mfp-header">
        <div>
          <h1 className="mfp-title">My Mutual Fund Portfolio</h1>
          <p className="mfp-sub">Track real-time valuation, profits & losses, and asset allocation</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={loadPortfolio}
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.86rem',
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="mfp-add-btn" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> Add Holding
          </button>
        </div>
      </div>

      <div style={{ background: 'var(--surface-3)', border: '1px dashed var(--line)', borderRadius: 10, padding: '10px 16px', marginBottom: 24, fontSize: '0.8rem', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertCircle size={16} style={{ color: 'var(--brand)' }} />
        <span>
          <strong>DEMO Portfolio:</strong> Holdings are tracked against live daily AMFI NAV prices. Connect an authorized broker (Zerodha Coin, Groww, Upstox) to automatically sync actual CAS (Consolidated Account Statement) folio holdings.
        </span>
      </div>

      {/* ── SUMMARY STATS ── */}
      <div className="mfp-summary-grid">
        <div className="mfp-stat-card">
          <div className="mfp-stat-label">Total Invested</div>
          <div className="mfp-stat-val">{fmtCurrency(portfolio?.total_invested)}</div>
        </div>

        <div className="mfp-stat-card">
          <div className="mfp-stat-label">Current Value</div>
          <div className="mfp-stat-val">{fmtCurrency(portfolio?.total_current_value)}</div>
        </div>

        <div className="mfp-stat-card">
          <div className="mfp-stat-label">Total P&L</div>
          <div className={`mfp-stat-val ${(portfolio?.total_pnl || 0) >= 0 ? 'gain' : 'loss'}`}>
            {(portfolio?.total_pnl || 0) >= 0 ? '+' : ''}{fmtCurrency(portfolio?.total_pnl)}
          </div>
          <div style={{ fontSize: '0.78rem', color: (portfolio?.total_pnl_percent || 0) >= 0 ? 'var(--gain)' : 'var(--loss)', marginTop: 4, fontWeight: 700 }}>
            {(portfolio?.total_pnl_percent || 0) >= 0 ? '+' : ''}{Number(portfolio?.total_pnl_percent || 0).toFixed(2)}%
          </div>
        </div>

        <div className="mfp-stat-card">
          <div className="mfp-stat-label">Portfolio Return (XIRR)</div>
          {portfolio?.xirr != null ? (
            <>
              <div className={`mfp-stat-val ${portfolio.xirr >= 0 ? 'gain' : 'loss'}`}>
                {portfolio.xirr >= 0 ? '+' : ''}{portfolio.xirr.toFixed(1)}% p.a.
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 4 }}>
                Money-weighted return on recorded cash flows
              </div>
            </>
          ) : (
            <>
              <div className="mfp-stat-val" style={{ color: 'var(--text-3)' }}>—</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 4 }}>
                {portfolio?.holdings?.length
                  ? 'Purchase dates are needed on every holding to compute XIRR'
                  : 'Add a holding to compute XIRR'}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── ALLOCATION & HOLDINGS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: pieData.length > 0 ? '1fr 340px' : '1fr', gap: 24, marginBottom: 28 }}>
        {/* Holdings Table */}
        <div className="mfp-card" style={{ margin: 0 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 16px' }}>
            Current Holdings ({portfolio?.holdings?.length || 0})
          </h2>

          {loading ? (
            <p style={{ color: 'var(--text-3)', padding: 20 }}>Loading holdings...</p>
          ) : !portfolio?.holdings?.length ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-3)' }}>
              <Briefcase size={36} style={{ opacity: 0.4, marginBottom: 12 }} />
              <p>No holdings in your mutual fund portfolio yet.</p>
              <button className="mfp-add-btn" style={{ margin: '12px auto 0' }} onClick={() => setShowAddModal(true)}>
                + Record Existing Holding
              </button>
            </div>
          ) : (
            <div className="mfp-table-wrap">
              <table className="mfp-table">
                <thead>
                  <tr>
                    <th>Scheme Name</th>
                    <th>Units</th>
                    <th>Avg NAV</th>
                    <th>Current NAV</th>
                    <th>Invested</th>
                    <th>Current Value</th>
                    <th>P&L</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.holdings.map((h) => {
                    const pnl = h.pnl != null ? h.pnl : (h.current_value || 0) - (h.invested_amount || 0);
                    const pnlPct = h.invested_amount > 0 ? (pnl / h.invested_amount) * 100 : 0;
                    return (
                      <tr key={h.id}>
                        <td>
                          <Link
                            to={`/mutual-funds/fund/${h.scheme_code}`}
                            style={{ fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}
                          >
                            {h.scheme_name}
                          </Link>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                            {h.category} · Code: {h.scheme_code}
                          </div>
                        </td>
                        <td>{Number(h.units || 0).toFixed(3)}</td>
                        <td>₹{Number(h.avg_nav || 0).toFixed(2)}</td>
                        <td>
                          <strong>{h.current_nav ? `₹${h.current_nav.toFixed(2)}` : '—'}</strong>
                        </td>
                        <td>{fmtCurrency(h.invested_amount)}</td>
                        <td>
                          <strong>{fmtCurrency(h.current_value)}</strong>
                        </td>
                        <td style={{ color: pnl >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>
                          {pnl >= 0 ? '+' : ''}{fmtCurrency(pnl)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                        </td>
                        <td>
                          <button
                            onClick={() => handleDeleteHolding(h.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}
                            title="Delete Holding"
                          >
                            <Trash2 size={15} />
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

        {/* Allocation & split column */}
        {(pieData.length > 0 || investmentSplit) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {pieData.length > 0 && (
              <div className="mfp-card" style={{ margin: 0 }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 16px' }}>
                  Asset Allocation
                </h2>
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={78}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {pieData.map((_, index) => (
                          <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val, name, entry) => [`${fmtCurrency(val)} · ${entry?.payload?.weight ?? 0}%`, name]}
                        contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {pieData.map((slice, index) => (
                    <div key={slice.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: PIE_COLORS[index % PIE_COLORS.length], flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slice.name}</span>
                      <strong style={{ color: 'var(--text)' }}>{Number(slice.weight || 0).toFixed(1)}%</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {investmentSplit && splitTotalInvested > 0 && (
              <div className="mfp-card" style={{ margin: 0 }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 6px' }}>
                  SIP vs One-time
                </h2>
                <p style={{ margin: '0 0 14px', fontSize: '0.74rem', color: 'var(--text-3)' }}>
                  Invested capital split by how each holding was recorded
                </p>
                {[
                  { key: 'sip_linked', label: 'SIP-linked holdings', color: 'var(--brand)' },
                  { key: 'lumpsum', label: 'One-time / lumpsum', color: '#1f6f8b' },
                ].map(({ key, label, color }) => {
                  const bucket = investmentSplit[key] || { invested: 0, current_value: 0, holdings: 0 };
                  const share = splitTotalInvested ? (bucket.invested / splitTotalInvested) * 100 : 0;
                  return (
                    <div key={key} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-2)' }}>{label} ({bucket.holdings})</span>
                        <strong>{share.toFixed(1)}%</strong>
                      </div>
                      <div style={{ height: 7, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                        <div style={{ width: `${share}%`, height: '100%', background: color }} />
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 3 }}>
                        {fmtCurrency(bucket.invested)} invested · {fmtCurrency(bucket.current_value)} current
                      </div>
                    </div>
                  );
                })}
                {investmentSplit.sip_linked.holdings === 0 && (
                  <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--text-3)' }}>
                    No holding is linked to a SIP mandate yet. Link one from “Add Holding” to track SIP-funded units separately.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── CAPITAL GAINS TAX ESTIMATE ── */}
      {portfolio?.holdings?.length > 0 && tax && (
        <div className="mfp-card" style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 750, color: 'var(--text)', margin: 0 }}>
                Capital Gains Tax — If Sold Today
              </h2>
              <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--text-3)' }}>
                Unrealised estimate on equity holdings. Not a tax filing; actual liability depends on your full-year gains and income.
              </p>
            </div>
            {tax.status === 'ok' && (
              <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: 'var(--gain-soft)', color: 'var(--gain)' }}>
                Equity holdings only
              </span>
            )}
          </div>

          {tax.status === 'ok' || tax.status === 'partial' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Estimated tax</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: 6 }}>{fmtCurrency(tax.estimatedTax)}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 4 }}>Cess and surcharge excluded</div>
                </div>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Short-term @ 20%</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: 6 }}>{fmtCurrency(tax.shortTermTax)}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 4 }}>
                    Gain {fmtCurrency(tax.equityShortTermGain)} · {tax.equityShortTermCount} holding(s)
                  </div>
                </div>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Long-term @ 12.5%</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: 6 }}>{fmtCurrency(tax.longTermTax)}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 4 }}>
                    Gain {fmtCurrency(tax.equityLongTermGain)} · {tax.equityLongTermCount} holding(s)
                  </div>
                </div>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>LTCG exemption</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: 6 }}>{fmtCurrency(tax.ltcgExemption)}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 4 }}>
                    Taxable after exemption {fmtCurrency(tax.taxableLongTermAfterExemption)}
                  </div>
                </div>
              </div>

              {tax.equityLoss > 0 && (
                <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-2)' }}>
                  Unrealised losses of {fmtCurrency(tax.equityLoss)} are assumed to offset long-term gains, which keeps this estimate conservative.
                </p>
              )}
              {tax.notEstimated.length > 0 && (
                <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-2)' }}>
                  Not estimated: {[...new Set(tax.notEstimated.map((item) => item.category))].join(', ')}. Debt and unclassified funds are taxed at your income slab.
                </p>
              )}
              {tax.unknownPurchaseDate > 0 && (
                <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-2)' }}>
                  {tax.unknownPurchaseDate} holding(s) skipped because the purchase date is missing, so the holding period is unknown.
                </p>
              )}
            </>
          ) : (
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-3)' }}>
              No equity holding has both a purchase date and a current valuation, so tax is not estimated rather than guessed.
            </p>
          )}

          <p style={{ margin: '10px 0 0', fontSize: '0.72rem', color: 'var(--text-3)', lineHeight: 1.6 }}>{tax.note}</p>
        </div>
      )}

      {/* ── TRANSACTION HISTORY ── */}
      <div className="mfp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 750, color: 'var(--text)', margin: 0 }}>
            Transaction History
          </h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {['All', 'SIP', 'Lumpsum', 'Redemption'].map((tab) => (
              <button
                key={tab}
                onClick={() => setTxTab(tab)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 999,
                  border: '1px solid var(--line)',
                  background: txTab === tab ? 'var(--brand)' : 'var(--surface)',
                  color: txTab === tab ? '#fff' : 'var(--text-2)',
                  fontSize: '0.78rem',
                  fontWeight: 650,
                  cursor: 'pointer',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {loadingTx ? (
          <p style={{ color: 'var(--text-3)', padding: 16 }}>Loading transactions...</p>
        ) : filteredTx.length === 0 ? (
          <p style={{ color: 'var(--text-3)', padding: 16 }}>No transactions recorded yet.</p>
        ) : (
          <div className="mfp-table-wrap">
            <table className="mfp-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Scheme</th>
                  <th>Amount</th>
                  <th>Units</th>
                  <th>NAV</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTx.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.transaction_date || tx.created_at?.slice(0, 10)}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: tx.type === 'SIP' ? 'var(--brand)' : 'var(--text)' }}>
                        {tx.type}
                      </span>
                    </td>
                    <td>{tx.scheme_name}</td>
                    <td><strong>{fmtCurrency(tx.amount)}</strong></td>
                    <td>{tx.units ? Number(tx.units).toFixed(3) : '—'}</td>
                    <td>{tx.nav ? `₹${Number(tx.nav).toFixed(2)}` : '—'}</td>
                    <td>
                      <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 999, background: 'var(--gain-soft)', color: 'var(--gain)', fontWeight: 700 }}>
                        {tx.status || 'DEMO'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── ADD HOLDING MODAL ── */}
      {showAddModal && (
        <div className="mfp-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="mfp-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Record Existing Mutual Fund</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddHolding}>
              <div style={{ marginBottom: 14, position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 650, marginBottom: 6 }}>Search Scheme</label>
                <input
                  type="text"
                  placeholder="e.g. Parag Parikh Flexi Cap..."
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)' }}
                  required
                />
                {modalResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: 'var(--shadow-3)', zIndex: 40, maxHeight: 180, overflowY: 'auto' }}>
                    {modalResults.map((s) => {
                      const code = s.schemeCode || s.scheme_code;
                      const name = s.schemeName || s.scheme_name;
                      return (
                        <div
                          key={code}
                          onClick={() => {
                            setAddCode(code);
                            setAddName(name);
                            setModalSearch(name);
                            setModalResults([]);
                          }}
                          style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: '0.82rem' }}
                        >
                          <strong>{name}</strong>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>Code: {code}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {addCode && (
                  <div style={{ fontSize: '0.74rem', color: 'var(--gain)', marginTop: 4 }}>
                    ✓ Scheme Code: {addCode}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 650, marginBottom: 6 }}>Units</label>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="e.g. 150.25"
                    value={addUnits}
                    onChange={(e) => setAddUnits(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 650, marginBottom: 6 }}>Avg Purchase NAV (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 58.40"
                    value={addAvgNav}
                    onChange={(e) => setAddAvgNav(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)' }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 650, marginBottom: 6 }}>Purchase Date</label>
                  <input
                    type="date"
                    value={addDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setAddDate(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 650, marginBottom: 6 }}>Link to SIP (optional)</label>
                  <select
                    value={addSipId}
                    onChange={(e) => setAddSipId(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)' }}
                  >
                    <option value="">One-time purchase</option>
                    {sips.map((sip) => (
                      <option key={sip.id} value={sip.id}>
                        {sip.scheme_name} — ₹{Number(sip.amount || 0).toLocaleString('en-IN')}/{sip.frequency}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 650, marginBottom: 6 }}>Total Invested (₹)</label>
                  <input
                    type="number"
                    placeholder="Leave empty to auto-calculate"
                    value={addInvested}
                    onChange={(e) => setAddInvested(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 650, marginBottom: 6 }}>Category</label>
                  <select
                    value={addCategory}
                    onChange={(e) => setAddCategory(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)' }}
                  >
                    <option value="Equity">Equity</option>
                    <option value="Debt">Debt</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Index">Index</option>
                    <option value="ELSS">ELSS Tax Saver</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#fff', fontWeight: 700, fontSize: '0.92rem', cursor: 'pointer' }}
              >
                Save Holding to Portfolio
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
