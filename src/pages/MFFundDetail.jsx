import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ArrowLeft,
  Bookmark,
  GitCompareArrows,
  Repeat,
  DollarSign,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import './MFFundDetail.css';

function RiskStat({ label, value, foot, tone }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 6, color: tone === 'loss' ? 'var(--loss)' : 'var(--text)' }}>{value}</div>
      {foot && <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 4 }}>{foot}</div>}
    </div>
  );
}

export default function MFFundDetail() {
  const { schemeCode } = useParams();

  const [meta, setMeta] = useState(null);
  const [navHistory, setNavHistory] = useState([]);
  const [risk, setRisk] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('1Y'); // '1M' | '6M' | '1Y' | '3Y' | '5Y' | 'Max'
  const [isWatchlisted, setIsWatchlisted] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setRisk(null);

    Promise.all([
      fetch(`/api/mutual-funds/${encodeURIComponent(schemeCode)}/latest`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/mutual-funds/${encodeURIComponent(schemeCode)}/nav`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/mf/risk/${encodeURIComponent(schemeCode)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([latestData, historyData, riskData]) => {
        if (!latestData && !historyData) {
          throw new Error('Scheme details not found.');
        }

        const combinedMeta = latestData?.meta || historyData?.meta || {};
        const points = historyData?.data || latestData?.data || [];
        setMeta(combinedMeta);
        setNavHistory(points);
        setRisk(riskData?.risk || null);
      })
      .catch((err) => setError(err.message || 'Could not load fund details'))
      .finally(() => setLoading(false));

    // Check if watchlisted
    fetch('/api/mf/watchlist')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const found = (data?.watchlist || []).some(
          (w) => String(w.scheme_code) === String(schemeCode)
        );
        setIsWatchlisted(found);
      })
      .catch(() => {});
  }, [schemeCode]);

  // Live NAV: re-check the latest AMFI point every minute
  useEffect(() => {
    let active = true;
    const intervalId = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/mutual-funds/${encodeURIComponent(schemeCode)}/latest`);
        if (!res.ok) return;
        const json = await res.json();
        const point = json?.data?.[0];
        if (!active || !point) return;
        setNavHistory((prev) => {
          if (!prev.length) return prev;
          if (prev[0].date === point.date) {
            if (prev[0].nav === point.nav) return prev;
            return [{ ...prev[0], nav: point.nav }, ...prev.slice(1)];
          }
          return [point, ...prev];
        });
      } catch {}
    }, 60000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [schemeCode]);

  // Daily change & latest NAV
  const latestNav = navHistory[0] ? parseFloat(navHistory[0].nav) : null;
  const latestDate = navHistory[0]?.date || '';
  const priorNav = navHistory[1] ? parseFloat(navHistory[1].nav) : null;

  const dailyChange =
    latestNav && priorNav
      ? {
          amount: latestNav - priorNav,
          percent: ((latestNav - priorNav) / priorNav) * 100,
        }
      : null;

  // Compute returns table
  const returnsData = useMemo(() => {
    if (!latestNav || navHistory.length < 2) return [];

    const getNavAgo = (days) => {
      if (navHistory.length <= days) return null;
      const target = navHistory[days];
      return target ? parseFloat(target.nav) : null;
    };

    const calcReturn = (pastNav, years) => {
      if (!pastNav) return null;
      if (years <= 1) {
        return ((latestNav - pastNav) / pastNav) * 100;
      }
      return (Math.pow(latestNav / pastNav, 1 / years) - 1) * 100;
    };

    const nav1M = getNavAgo(22);
    const nav3M = getNavAgo(66);
    const nav6M = getNavAgo(130);
    const nav1Y = getNavAgo(250);
    const nav3Y = getNavAgo(750);
    const nav5Y = getNavAgo(1250);

    return [
      { period: '1 Month', returnPct: calcReturn(nav1M, 1 / 12) },
      { period: '3 Months', returnPct: calcReturn(nav3M, 3 / 12) },
      { period: '6 Months', returnPct: calcReturn(nav6M, 6 / 12) },
      { period: '1 Year (CAGR)', returnPct: calcReturn(nav1Y, 1) },
      { period: '3 Years (CAGR)', returnPct: calcReturn(nav3Y, 3) },
      { period: '5 Years (CAGR)', returnPct: calcReturn(nav5Y, 5) },
    ];
  }, [latestNav, navHistory]);

  // Chart data filtering
  const chartData = useMemo(() => {
    if (!navHistory.length) return [];

    const daysMap = {
      '1M': 22,
      '6M': 130,
      '1Y': 250,
      '3Y': 750,
      '5Y': 1250,
      Max: navHistory.length,
    };

    const count = daysMap[timeRange] || 250;
    const slice = navHistory.slice(0, count).reverse();

    return slice.map((item) => ({
      date: item.date,
      nav: parseFloat(item.nav),
    }));
  }, [navHistory, timeRange]);

  // Toggle watchlist
  const handleToggleWatchlist = async () => {
    if (isWatchlisted) {
      await fetch(`/api/mf/watchlist/${schemeCode}`, { method: 'DELETE' });
      setIsWatchlisted(false);
    } else {
      await fetch('/api/mf/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheme_code: schemeCode,
          scheme_name: meta?.scheme_name || `Scheme ${schemeCode}`,
          fund_house: meta?.fund_house || 'AMC',
          category: meta?.scheme_category || 'Equity',
        }),
      });
      setIsWatchlisted(true);
    }
  };

  const schemeName = meta?.scheme_name || `Mutual Fund Scheme ${schemeCode}`;
  const fundHouse = meta?.fund_house || 'Fund House';
  const category = meta?.scheme_category || 'Equity';
  const plan = /\bdirect\b/i.test(schemeName) ? 'Direct' : 'Regular';
  const option = /\bidcw\b|dividend/i.test(schemeName) ? 'IDCW' : 'Growth';

  return (
    <div className="mffd-page">
      {/* ── BREADCRUMB ── */}
      <div className="mffd-breadcrumb">
        <Link to="/mutual-funds">Mutual Funds</Link>
        <span>/</span>
        <Link to="/mutual-funds/explore">Explore</Link>
        <span>/</span>
        <span>{schemeName}</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-3)' }}>
          Loading scheme profile and historical NAV records from AMFI...
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--loss)' }}>
          <p>{error}</p>
          <Link to="/mutual-funds/explore" style={{ color: 'var(--brand)', textDecoration: 'none' }}>
            ← Back to Explore
          </Link>
        </div>
      ) : (
        <>
          {/* ── HEADER ── */}
          <div className="mffd-header">
            <div>
              <h1 className="mffd-title">{schemeName}</h1>
              <p className="mffd-sub">
                {fundHouse} · Scheme Code: <strong>{schemeCode}</strong>
              </p>
              <div className="mffd-tags">
                <span className="mffd-tag">{category}</span>
                <span className="mffd-tag">{plan} Plan</span>
                <span className="mffd-tag">{option} Option</span>
              </div>
            </div>

            <div className="mffd-cta-group">
              <button
                className="mffd-btn-outline"
                onClick={handleToggleWatchlist}
                title={isWatchlisted ? 'Remove from Watchlist' : 'Add to Watchlist'}
              >
                <Bookmark size={16} fill={isWatchlisted ? 'currentColor' : 'none'} />
                {isWatchlisted ? 'Saved' : 'Save'}
              </button>

              <Link
                to={`/mutual-funds/compare?codes=${schemeCode}`}
                className="mffd-btn-outline"
              >
                <GitCompareArrows size={16} /> Compare
              </Link>

              <Link
                to={`/mutual-funds/sip?code=${schemeCode}&name=${encodeURIComponent(schemeName)}`}
                className="mffd-btn-primary"
              >
                <Repeat size={16} /> Start SIP
              </Link>
            </div>
          </div>

          {/* ── METRICS ROW ── */}
          <div className="mffd-metrics-grid">
            <div className="mffd-metric-card">
              <div className="mffd-metric-label">Latest NAV</div>
              <div className="mffd-metric-val">
                {latestNav ? `₹${latestNav.toFixed(2)}` : '—'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 4 }}>
                {latestDate ? `As of ${latestDate}` : 'AMFI Daily NAV'}
              </div>
            </div>

            <div className="mffd-metric-card">
              <div className="mffd-metric-label">1-Day Change</div>
              <div
                className={`mffd-metric-val ${
                  (dailyChange?.percent || 0) >= 0 ? 'gain' : 'loss'
                }`}
              >
                {dailyChange
                  ? `${dailyChange.amount >= 0 ? '+' : ''}₹${dailyChange.amount.toFixed(2)}`
                  : '—'}
              </div>
              <div
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: (dailyChange?.percent || 0) >= 0 ? 'var(--gain)' : 'var(--loss)',
                  marginTop: 4,
                }}
              >
                {dailyChange
                  ? `${dailyChange.percent >= 0 ? '+' : ''}${dailyChange.percent.toFixed(2)}%`
                  : 'vs prior published NAV'}
              </div>
            </div>

            <div className="mffd-metric-card">
              <div className="mffd-metric-label">1Y Return (CAGR)</div>
              <div className="mffd-metric-val gain">
                {returnsData.find((r) => r.period.startsWith('1 Year'))?.returnPct != null
                  ? `${returnsData.find((r) => r.period.startsWith('1 Year')).returnPct.toFixed(2)}%`
                  : '—'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 4 }}>
                Annualised return
              </div>
            </div>

            <div className="mffd-metric-card">
              <div className="mffd-metric-label">3Y Return (CAGR)</div>
              <div className="mffd-metric-val gain">
                {returnsData.find((r) => r.period.startsWith('3 Year'))?.returnPct != null
                  ? `${returnsData.find((r) => r.period.startsWith('3 Year')).returnPct.toFixed(2)}%`
                  : '—'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 4 }}>
                Compound growth
              </div>
            </div>

            <div className="mffd-metric-card">
              <div className="mffd-metric-label">5Y Return (CAGR)</div>
              <div className="mffd-metric-val gain">
                {returnsData.find((r) => r.period.startsWith('5 Year'))?.returnPct != null
                  ? `${returnsData.find((r) => r.period.startsWith('5 Year')).returnPct.toFixed(2)}%`
                  : '—'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 4 }}>
                Long term track
              </div>
            </div>
          </div>

          {/* ── CHART CARD ── */}
          <div className="mffd-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                NAV Performance History
              </h2>
              <div style={{ display: 'flex', gap: 6 }}>
                {['1M', '6M', '1Y', '3Y', '5Y', 'Max'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setTimeRange(r)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      border: timeRange === r ? '1px solid var(--brand)' : '1px solid var(--line)',
                      background: timeRange === r ? 'var(--brand-soft)' : 'transparent',
                      color: timeRange === r ? 'var(--brand)' : 'var(--text-2)',
                      fontSize: '0.78rem',
                      fontWeight: 650,
                      cursor: 'pointer',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mfNavGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="var(--text-3)" fontSize={11} minTickGap={40} />
                  <YAxis
                    stroke="var(--text-3)"
                    fontSize={11}
                    domain={['auto', 'auto']}
                    tickFormatter={(v) => `₹${v}`}
                  />
                  <Tooltip
                    formatter={(val) => [`₹${Number(val).toFixed(2)}`, 'NAV']}
                    labelFormatter={(d) => `Date: ${d}`}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="nav"
                    stroke="var(--brand)"
                    strokeWidth={2.5}
                    fill="url(#mfNavGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── RISK METRICS ── */}
          {risk && (
            <div className="mffd-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                    Risk Metrics
                  </h2>
                  <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--text-3)' }}>
                    {risk.status === 'ok'
                      ? `Computed from ${risk.samplePoints} AMFI NAV records over ${risk.periodYears} years · risk-free rate ${risk.riskFreeRate}%`
                      : risk.reason}
                  </p>
                </div>
                {risk.status === 'ok' && risk.riskGrade && (
                  <span
                    style={{
                      padding: '5px 12px',
                      borderRadius: 999,
                      fontSize: '0.76rem',
                      fontWeight: 750,
                      background: 'var(--brand-soft)',
                      color: 'var(--brand)',
                    }}
                  >
                    {risk.riskGrade} risk
                  </span>
                )}
              </div>

              {risk.status === 'ok' ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                    <RiskStat
                      label="Annualised Volatility"
                      value={risk.volatilityPercent != null ? `${risk.volatilityPercent.toFixed(2)}%` : '—'}
                      foot="Trailing 252 daily NAV returns"
                    />
                    <RiskStat
                      label="Max Drawdown"
                      value={risk.maxDrawdownPercent != null ? `${risk.maxDrawdownPercent.toFixed(2)}%` : '—'}
                      foot="Peak-to-trough, full history"
                      tone="loss"
                    />
                    <RiskStat
                      label="Sharpe Ratio"
                      value={risk.sharpe != null ? risk.sharpe.toFixed(2) : '—'}
                      foot="Return per unit of total risk"
                    />
                    <RiskStat
                      label="Sortino Ratio"
                      value={risk.sortino != null ? risk.sortino.toFixed(2) : '—'}
                      foot="Return per unit of downside risk"
                    />
                    <RiskStat
                      label="Rolling 1Y Positive"
                      value={risk.rollingOneYearPositivePercent != null ? `${risk.rollingOneYearPositivePercent.toFixed(1)}%` : '—'}
                      foot={`${risk.rollingOneYearSamples} one-year windows`}
                    />
                  </div>
                  <p style={{ margin: '14px 0 0', fontSize: '0.74rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
                    Volatility is the standard deviation of daily NAV returns annualised by √252. Sharpe and Sortino use the trailing 1Y CAGR and a {risk.riskFreeRate}% risk-free rate. Rolling consistency samples overlapping 1-year holding periods across the available history. All values come from published AMFI NAVs.
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-3)' }}>
                  Risk metrics are withheld rather than estimated because the published NAV history is too short.
                </p>
              )}
            </div>
          )}

          {/* ── RETURNS TABLE ── */}
          <div className="mffd-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text)', margin: '0 0 16px' }}>
              Historical Returns Breakdown
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-3)', fontSize: '0.76rem', textTransform: 'uppercase' }}>Period</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-3)', fontSize: '0.76rem', textTransform: 'uppercase' }}>Return (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {returnsData.map((row) => (
                    <tr key={row.period} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 650 }}>{row.period}</td>
                      <td
                        style={{
                          padding: '12px 14px',
                          textAlign: 'right',
                          fontWeight: 750,
                          color:
                            row.returnPct == null
                              ? 'var(--text-3)'
                              : row.returnPct >= 0
                              ? 'var(--gain)'
                              : 'var(--loss)',
                        }}
                      >
                        {row.returnPct != null
                          ? `${row.returnPct >= 0 ? '+' : ''}${row.returnPct.toFixed(2)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── TRANSPARENCY NOTICE ── */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '20px 24px', marginBottom: 28 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 750, display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={18} style={{ color: 'var(--brand)' }} /> Data Verification & Source Transparency
            </h3>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
              The daily Net Asset Value (NAV) records for <strong>{schemeName}</strong> are fetched directly from the official Association of Mutual Funds in India (AMFI) database via the <a href="https://www.mfapi.in" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>mfapi.in</a> infrastructure. Risk metrics are calculated from that NAV history. Metrics that need proprietary paid feeds, such as AUM and expense ratio, are transparently omitted rather than estimated.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
