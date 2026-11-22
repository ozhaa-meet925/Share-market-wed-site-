import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  GitCompareArrows,
  Search,
  X,
  Plus,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';
import './MFCompare.css';

const FUND_COLORS = ['#0d6f4e', '#1f6f8b', '#b8860b', '#7c3aed', '#db2777'];

export default function MFCompare() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCodes = searchParams.get('codes')
    ? searchParams.get('codes').split(',').filter(Boolean)
    : [];

  const [selectedCodes, setSelectedCodes] = useState(initialCodes);
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(false);

  // Search input
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Fetch comparison data when selectedCodes change
  useEffect(() => {
    if (selectedCodes.length === 0) {
      setFunds([]);
      return;
    }

    setLoading(true);
    fetch(`/api/mf/compare?codes=${selectedCodes.join(',')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = data?.comparison || data?.funds || (Array.isArray(data) ? data : []);
        setFunds(list.filter((fund) => fund && !fund.error && fund.name));
      })
      .catch(() => setFunds([]))
      .finally(() => setLoading(false));

    setSearchParams({ codes: selectedCodes.join(',') }, { replace: true });
  }, [selectedCodes]);

  // Autocomplete search
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

  const handleAddCode = (code) => {
    const sCode = String(code);
    if (selectedCodes.includes(sCode)) return;
    if (selectedCodes.length >= 5) {
      alert('You can compare a maximum of 5 mutual funds.');
      return;
    }
    setSelectedCodes([...selectedCodes, sCode]);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemoveCode = (code) => {
    setSelectedCodes(selectedCodes.filter((c) => c !== String(code)));
  };

  // Prepare chart data for returns
  const barChartData = [
    {
      period: '1 Year',
      ...Object.fromEntries(
        funds.map((f, i) => [`fund_${i}`, f.returns?.y1 ?? 0])
      ),
    },
    {
      period: '3 Years',
      ...Object.fromEntries(
        funds.map((f, i) => [`fund_${i}`, f.returns?.y3 ?? 0])
      ),
    },
    {
      period: '5 Years',
      ...Object.fromEntries(
        funds.map((f, i) => [`fund_${i}`, f.returns?.y5 ?? 0])
      ),
    },
  ];

  return (
    <div className="mfc-page">
      <div className="mfc-header">
        <h1 className="mfc-title">Compare Mutual Funds</h1>
        <p className="mfc-sub">Analyze up to 5 funds side-by-side on returns, category, and NAV trends</p>
      </div>

      {/* ── SELECTOR CARD ── */}
      <div className="mfc-card">
        <div style={{ position: 'relative', maxWidth: 600 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 14px' }}>
            <Search size={18} style={{ color: 'var(--text-3)' }} />
            <input
              type="text"
              placeholder="Search mutual fund to add (e.g. Nippon India, Parag Parikh, HDFC)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: '0.9rem' }}
            />
          </div>

          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-3)', zIndex: 40, marginTop: 4 }}>
              {searchResults.map((s) => {
                const code = String(s.schemeCode || s.scheme_code);
                const name = s.schemeName || s.scheme_name;
                const isSelected = selectedCodes.includes(code);
                return (
                  <div
                    key={code}
                    onClick={() => !isSelected && handleAddCode(code)}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--line)',
                      cursor: isSelected ? 'default' : 'pointer',
                      opacity: isSelected ? 0.5 : 1,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.86rem' }}>{name}</strong>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Code: {code}</div>
                    </div>
                    {isSelected ? (
                      <span style={{ fontSize: '0.74rem', color: 'var(--brand)' }}>Added</span>
                    ) : (
                      <Plus size={16} style={{ color: 'var(--brand)' }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected chips */}
        <div className="mfc-fund-chips">
          {funds.map((f, idx) => (
            <div key={f.code} className="mfc-fund-chip" style={{ borderColor: FUND_COLORS[idx % FUND_COLORS.length] }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: FUND_COLORS[idx % FUND_COLORS.length] }} />
              <span>{f.name.slice(0, 30)}...</span>
              <button className="mfc-chip-remove" onClick={() => handleRemoveCode(f.code)}>
                <X size={14} />
              </button>
            </div>
          ))}
          {selectedCodes.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: '0.84rem', margin: '8px 0 0' }}>
              Search and add 2 or more funds to compare them side-by-side.
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mfc-card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-3)' }}>
          Loading comparison data from AMFI NAV feed...
        </div>
      ) : funds.length > 0 ? (
        <>
          {/* ── COMPARISON TABLE ── */}
          <div className="mfc-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="mfc-table-wrap">
              <table className="mfc-table">
                <thead>
                  <tr>
                    <th className="metric-col">Metric</th>
                    {funds.map((f, idx) => (
                      <th key={f.code} style={{ minWidth: 220 }}>
                        <div style={{ borderLeft: `3px solid ${FUND_COLORS[idx % FUND_COLORS.length]}`, paddingLeft: 8 }}>
                          <Link
                            to={`/mutual-funds/fund/${f.code}`}
                            style={{ fontWeight: 800, color: 'var(--text)', textDecoration: 'none', fontSize: '0.92rem' }}
                          >
                            {f.name}
                          </Link>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-3)', marginTop: 4 }}>
                            Code: {f.code}
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th className="metric-col">Category</th>
                    {funds.map((f) => (
                      <td key={f.code}>
                        <span style={{ fontSize: '0.78rem', padding: '3px 8px', borderRadius: 6, background: 'var(--surface-3)', fontWeight: 650 }}>
                          {f.category || 'Equity'}
                        </span>
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Plan & Option</th>
                    {funds.map((f) => (
                      <td key={f.code}>
                        {f.plan || 'Direct'} · {f.option || 'Growth'}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Latest NAV</th>
                    {funds.map((f) => (
                      <td key={f.code}>
                        <strong style={{ fontSize: '1.05rem' }}>
                          {f.latest_nav ? `₹${Number(f.latest_nav).toFixed(2)}` : '—'}
                        </strong>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                          {f.latest_date ? `As of ${f.latest_date}` : ''}
                        </div>
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">1 Year Return (CAGR)</th>
                    {funds.map((f) => {
                      const y1 = f.returns?.y1;
                      return (
                        <td key={f.code} style={{ color: y1 >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 750, fontSize: '1rem' }}>
                          {y1 != null ? `${y1 >= 0 ? '+' : ''}${y1.toFixed(2)}%` : '—'}
                        </td>
                      );
                    })}
                  </tr>

                  <tr>
                    <th className="metric-col">3 Year Return (CAGR)</th>
                    {funds.map((f) => {
                      const y3 = f.returns?.y3;
                      return (
                        <td key={f.code} style={{ color: y3 >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 750, fontSize: '1rem' }}>
                          {y3 != null ? `${y3 >= 0 ? '+' : ''}${y3.toFixed(2)}%` : '—'}
                        </td>
                      );
                    })}
                  </tr>

                  <tr>
                    <th className="metric-col">5 Year Return (CAGR)</th>
                    {funds.map((f) => {
                      const y5 = f.returns?.y5;
                      return (
                        <td key={f.code} style={{ color: y5 >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 750, fontSize: '1rem' }}>
                          {y5 != null ? `${y5 >= 0 ? '+' : ''}${y5.toFixed(2)}%` : '—'}
                        </td>
                      );
                    })}
                  </tr>

                  <tr>
                    <th className="metric-col">Fund House (AMC)</th>
                    {funds.map((f) => (
                      <td key={f.code}>{f.fund_house || f.meta?.fund_house || 'Mutual Fund AMC'}</td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Risk Grade</th>
                    {funds.map((f) => (
                      <td key={f.code}>
                        {f.risk?.status === 'ok' && f.risk.riskGrade ? (
                          <span style={{ fontSize: '0.76rem', padding: '3px 8px', borderRadius: 6, background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 700 }}>
                            {f.risk.riskGrade}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-3)', fontSize: '0.78rem' }}>Not enough NAV history</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Volatility (1Y, annualised)</th>
                    {funds.map((f) => (
                      <td key={f.code} style={{ fontWeight: 700 }}>
                        {f.risk?.volatilityPercent != null ? `${f.risk.volatilityPercent.toFixed(2)}%` : '—'}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Max Drawdown</th>
                    {funds.map((f) => (
                      <td key={f.code} style={{ fontWeight: 700, color: f.risk?.maxDrawdownPercent != null ? 'var(--loss)' : 'var(--text-3)' }}>
                        {f.risk?.maxDrawdownPercent != null ? `${f.risk.maxDrawdownPercent.toFixed(2)}%` : '—'}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Sharpe / Sortino</th>
                    {funds.map((f) => (
                      <td key={f.code}>
                        {f.risk?.sharpe != null || f.risk?.sortino != null
                          ? `${f.risk?.sharpe != null ? f.risk.sharpe.toFixed(2) : '—'} / ${f.risk?.sortino != null ? f.risk.sortino.toFixed(2) : '—'}`
                          : '—'}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Rolling 1Y Positive</th>
                    {funds.map((f) => (
                      <td key={f.code}>
                        {f.risk?.rollingOneYearPositivePercent != null ? (
                          <>
                            <strong>{f.risk.rollingOneYearPositivePercent.toFixed(1)}%</strong>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                              of {f.risk.rollingOneYearSamples} one-year windows
                            </div>
                          </>
                        ) : '—'}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Data Basis</th>
                    {funds.map((f) => (
                      <td key={f.code} style={{ color: 'var(--text-3)', fontSize: '0.76rem' }}>
                        {f.risk?.status === 'ok'
                          ? `${f.risk.samplePoints} AMFI NAV records · ${f.risk.periodYears} yrs`
                          : 'AMFI NAV history too short'}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th className="metric-col">Action</th>
                    {funds.map((f) => (
                      <td key={f.code}>
                        <Link
                          to={`/mutual-funds/sip?code=${f.code}&name=${encodeURIComponent(f.name)}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '7px 14px',
                            borderRadius: 8,
                            background: 'var(--brand)',
                            color: '#fff',
                            textDecoration: 'none',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                          }}
                        >
                          Start SIP <ArrowRight size={13} />
                        </Link>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── BAR CHART ── */}
          <div className="mfc-card">
            <h2 style={{ fontSize: '1.15rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 16px' }}>
              Annualised Returns Comparison (CAGR %)
            </h2>
            <div className="mfc-chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                  <XAxis dataKey="period" stroke="var(--text-3)" fontSize={12} />
                  <YAxis stroke="var(--text-3)" fontSize={11} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(val, name) => {
                      const idx = parseInt(name.replace('fund_', ''), 10);
                      return [`${Number(val).toFixed(2)}%`, funds[idx]?.name || name];
                    }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
                  />
                  <Legend
                    formatter={(name) => {
                      const idx = parseInt(name.replace('fund_', ''), 10);
                      return funds[idx]?.name ? funds[idx].name.slice(0, 24) + '...' : name;
                    }}
                  />
                  {funds.map((_, idx) => (
                    <Bar
                      key={idx}
                      dataKey={`fund_${idx}`}
                      fill={FUND_COLORS[idx % FUND_COLORS.length]}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : null}

      <div style={{ background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px', fontSize: '0.8rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} />
        <span>
          Data sourced from official AMFI daily NAV disclosures. Returns are historical CAGR. Risk statistics (volatility, drawdown, Sharpe/Sortino, rolling 1Y consistency) are computed from the same NAV history using a 6.5% risk-free rate. Past performance is not a guarantee of future returns.
        </span>
      </div>
    </div>
  );
}
