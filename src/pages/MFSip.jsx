import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Repeat,
  DollarSign,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Pause,
  Play,
  Trash2,
  Search,
  Sparkles,
} from 'lucide-react';
import './MFSip.css';

const FREQUENCIES = ['Monthly', 'Weekly', 'Quarterly'];
const SIP_DATES = [1, 5, 10, 15, 25];
const DURATIONS = [
  { label: '1 Year', years: 1 },
  { label: '3 Years', years: 3 },
  { label: '5 Years', years: 5 },
  { label: '10 Years', years: 10 },
];

export default function MFSip() {
  const [searchParams] = useSearchParams();
  const prefillCode = searchParams.get('code') || '';
  const prefillName = searchParams.get('name') || '';

  const [activeTab, setActiveTab] = useState('start'); // 'start' | 'mysips' | 'lumpsum'

  // Start SIP Form
  const [schemeCode, setSchemeCode] = useState(prefillCode);
  const [schemeName, setSchemeName] = useState(prefillName);
  const [fundSearch, setFundSearch] = useState(prefillName);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [sipAmount, setSipAmount] = useState(5000);
  const [frequency, setFrequency] = useState('Monthly');
  const [sipDate, setSipDate] = useState(5);
  const [durationYears, setDurationYears] = useState(5);
  const [expectedReturn, setExpectedReturn] = useState(12);

  // My SIPs
  const [sipList, setSipList] = useState([]);
  const [loadingSips, setLoadingSips] = useState(false);

  // Lumpsum Form
  const [lumpAmount, setLumpAmount] = useState(25000);
  const [lumpDurationYears, setLumpDurationYears] = useState(5);
  const [lumpReturn, setLumpReturn] = useState(12);

  // Success message toast
  const [toast, setToast] = useState('');

  // Fund search autocomplete
  useEffect(() => {
    if (!fundSearch || fundSearch.length < 2 || fundSearch === schemeName) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/mutual-funds/search?q=${encodeURIComponent(fundSearch)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          const list = Array.isArray(data) ? data : data?.data || [];
          setSearchResults(list.slice(0, 5));
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 280);

    return () => clearTimeout(timer);
  }, [fundSearch, schemeName]);

  // Load My SIPs
  const loadSips = (silent = false) => {
    if (!silent) setLoadingSips(true);
    fetch('/api/mf/sip')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSipList(Array.isArray(data) ? data : data?.sips || []))
      .catch(() => {
        if (!silent) setSipList([]);
      })
      .finally(() => setLoadingSips(false));
  };

  useEffect(() => {
    loadSips();
    const intervalId = window.setInterval(() => loadSips(true), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const sipReminders = useMemo(() => {
    const now = new Date();
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDays = new Map();
    const active = [];
    for (const sip of sipList) {
      const due = sip.next_due ? new Date(sip.next_due) : null;
      const days = due && !Number.isNaN(due.getTime())
        ? Math.round((due.getTime() - todayUtc) / 86400000)
        : null;
      dueDays.set(sip.id, days);
      if (sip.status === 'active') active.push({ sip, days });
    }
    const overdue = active.filter((item) => item.days != null && item.days < 0);
    const upcoming = active
      .filter((item) => item.days != null && item.days >= 0)
      .sort((a, b) => a.days - b.days);
    return {
      dueDays,
      overdue,
      next: upcoming[0] || null,
      dueThisWeek: upcoming.filter((item) => item.days <= 7),
      paused: sipList.filter((sip) => sip.status !== 'active').length,
      overdueAmount: overdue.reduce((sum, item) => sum + Number(item.sip.amount || 0), 0),
    };
  }, [sipList]);

  // SIP Projection calculation
  const sipProjection = useMemo(() => {
    const monthlyRate = expectedReturn / 12 / 100;
    const totalMonths = durationYears * 12;
    let currentVal = 0;
    const chartData = [];

    for (let m = 1; m <= totalMonths; m++) {
      currentVal = (currentVal + sipAmount) * (1 + monthlyRate);
      if (m % 6 === 0 || m === totalMonths) {
        chartData.push({
          month: `${(m / 12).toFixed(1)}Y`,
          invested: Math.round(sipAmount * m),
          value: Math.round(currentVal),
        });
      }
    }

    const totalInvested = sipAmount * totalMonths;
    const maturityValue = Math.round(currentVal);
    const estimatedReturns = maturityValue - totalInvested;

    return { totalInvested, estimatedReturns, maturityValue, chartData };
  }, [sipAmount, durationYears, expectedReturn]);

  // Lumpsum Projection calculation
  const lumpProjection = useMemo(() => {
    const totalInvested = lumpAmount;
    const maturityValue = Math.round(lumpAmount * Math.pow(1 + lumpReturn / 100, lumpDurationYears));
    const estimatedReturns = maturityValue - totalInvested;
    return { totalInvested, estimatedReturns, maturityValue };
  }, [lumpAmount, lumpDurationYears, lumpReturn]);

  // Handle Create SIP
  const handleCreateSip = async (e) => {
    e.preventDefault();
    if (!schemeCode || !schemeName) {
      alert('Please select a valid mutual fund scheme.');
      return;
    }

    try {
      const installmentsPerYear = frequency === 'Weekly' ? 52 : frequency === 'Quarterly' ? 4 : 12;
      const res = await fetch('/api/mf/sip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheme_code: schemeCode,
          scheme_name: schemeName,
          fund_house: 'Mutual Fund AMC',
          amount: sipAmount,
          frequency,
          sip_date: sipDate,
          start_date: new Date().toISOString().slice(0, 10),
          total_installments: durationYears * installmentsPerYear,
        }),
      });

      if (res.ok) {
        const created = await res.json().catch(() => null);
        const dueText = created?.next_due ? `Next deduction on ${created.next_due}.` : 'Next deduction date is being scheduled.';
        setToast(`DEMO SIP created for ${schemeName}. ${dueText}`);
        setActiveTab('mysips');
      } else {
        alert('Could not create SIP. Please try again.');
      }
    } catch {
      alert('Network error while creating SIP.');
    }
  };

  // Handle Lumpsum Investment
  const handleLumpsumInvest = async (e) => {
    e.preventDefault();
    if (!schemeCode || !schemeName) {
      alert('Please select a mutual fund scheme first.');
      return;
    }

    try {
      const navRes = await fetch(`/api/mutual-funds/${encodeURIComponent(schemeCode)}/latest`);
      const navJson = navRes.ok ? await navRes.json() : null;
      const latestPoint = navJson?.data?.[0];
      const latestNav = latestPoint ? parseFloat(latestPoint.nav) : null;
      if (!latestNav || !(latestNav > 0)) {
        alert('Latest published NAV for this scheme is unavailable, so the transaction cannot be recorded at a real NAV.');
        return;
      }

      const res = await fetch('/api/mf/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'Lumpsum',
          scheme_code: schemeCode,
          scheme_name: schemeName,
          amount: lumpAmount,
          units: +(lumpAmount / latestNav).toFixed(3),
          nav: latestNav,
          transaction_date: new Date().toISOString().slice(0, 10),
        }),
      });

      if (res.ok) {
        setToast(`DEMO Lump sum order of ₹${lumpAmount.toLocaleString('en-IN')} recorded at AMFI NAV ₹${latestNav.toFixed(2)} (${latestPoint.date}) for ${schemeName}.`);
      } else {
        alert('Could not record transaction.');
      }
    } catch {
      alert('Network error placing lumpsum order.');
    }
  };

  // Toggle SIP Pause/Resume
  const handleToggleSip = async (id, currentStatus) => {
    const nextStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch(`/api/mf/sip/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        loadSips();
      }
    } catch {}
  };

  // Cancel SIP
  const handleCancelSip = async (id) => {
    if (!window.confirm('Are you sure you want to cancel this SIP mandate?')) return;
    try {
      const res = await fetch(`/api/mf/sip/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadSips();
      }
    } catch {}
  };

  const fmtCurrency = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  return (
    <div className="mfsip-page">
      <div className="mfsip-header">
        <h1 className="mfsip-title">Mutual Fund Investments</h1>
        <p className="mfsip-sub">Automate your wealth building with SIP or invest one-time with Lump Sum</p>
      </div>

      <div className="mfsip-demo-banner">
        <AlertCircle size={18} style={{ color: 'var(--brand)' }} />
        <div>
          <strong>DEMO Transactions Mode:</strong> Real SIP mandates require BSE StAR MF / NSE NMF II broker credentials and SEBI e-mandate (NACH/NPCI) registration. All SIPs and orders here are simulated with live NAV tracking.
        </div>
      </div>

      {toast && (
        <div style={{ background: 'var(--gain-soft)', border: '1px solid var(--gain)', color: 'var(--gain)', padding: '12px 16px', borderRadius: 10, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={18} />
            <span>{toast}</span>
          </div>
          <button onClick={() => setToast('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* ── TABS ── */}
      <div className="mfsip-tabs">
        <button
          className={`mfsip-tab-btn ${activeTab === 'start' ? 'active' : ''}`}
          onClick={() => setActiveTab('start')}
        >
          <Repeat size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Start SIP
        </button>
        <button
          className={`mfsip-tab-btn ${activeTab === 'mysips' ? 'active' : ''}`}
          onClick={() => setActiveTab('mysips')}
        >
          <Calendar size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} /> My SIPs ({sipList.length})
        </button>
        <button
          className={`mfsip-tab-btn ${activeTab === 'lumpsum' ? 'active' : ''}`}
          onClick={() => setActiveTab('lumpsum')}
        >
          <DollarSign size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Lump Sum Investment
        </button>
      </div>

      {/* ── 1. START SIP TAB ── */}
      {activeTab === 'start' && (
        <div className="mfsip-grid-layout">
          {/* Form */}
          <div className="mfsip-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 18px' }}>
              Create SIP Mandate
            </h2>

            <form onSubmit={handleCreateSip}>
              {/* Fund Search */}
              <div className="mfsip-form-group" style={{ position: 'relative' }}>
                <label className="mfsip-form-label">Select Mutual Fund Scheme</label>
                <input
                  type="text"
                  className="mfsip-input"
                  placeholder="Type to search fund by name or code..."
                  value={fundSearch}
                  onChange={(e) => setFundSearch(e.target.value)}
                  required
                />
                {searchResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-3)', zIndex: 30, maxHeight: 220, overflowY: 'auto' }}>
                    {searchResults.map((s) => {
                      const code = s.schemeCode || s.scheme_code;
                      const name = s.schemeName || s.scheme_name;
                      return (
                        <div
                          key={code}
                          onClick={() => {
                            setSchemeCode(code);
                            setSchemeName(name);
                            setFundSearch(name);
                            setSearchResults([]);
                          }}
                          style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: '0.84rem' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-3)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <strong>{name}</strong>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Code: {code}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {schemeCode && (
                  <div style={{ fontSize: '0.74rem', color: 'var(--gain)', marginTop: 4 }}>
                    ✓ Selected Scheme Code: {schemeCode}
                  </div>
                )}
              </div>

              {/* Monthly Amount */}
              <div className="mfsip-form-group">
                <label className="mfsip-form-label">SIP Amount (₹)</label>
                <input
                  type="number"
                  min="500"
                  step="500"
                  className="mfsip-input"
                  value={sipAmount}
                  onChange={(e) => setSipAmount(Math.max(500, Number(e.target.value)))}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {[1000, 2500, 5000, 10000, 25000].map((amt) => (
                    <button
                      type="button"
                      key={amt}
                      className="mfsip-chip-btn"
                      onClick={() => setSipAmount(amt)}
                    >
                      ₹{amt.toLocaleString('en-IN')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Frequency */}
              <div className="mfsip-form-group">
                <label className="mfsip-form-label">Frequency</label>
                <div className="mfsip-chips">
                  {FREQUENCIES.map((freq) => (
                    <button
                      type="button"
                      key={freq}
                      className={`mfsip-chip-btn ${frequency === freq ? 'active' : ''}`}
                      onClick={() => setFrequency(freq)}
                    >
                      {freq}
                    </button>
                  ))}
                </div>
              </div>

              {/* SIP Date */}
              <div className="mfsip-form-group">
                <label className="mfsip-form-label">SIP Deduction Date</label>
                <div className="mfsip-chips">
                  {SIP_DATES.map((day) => (
                    <button
                      type="button"
                      key={day}
                      className={`mfsip-chip-btn ${sipDate === day ? 'active' : ''}`}
                      onClick={() => setSipDate(day)}
                    >
                      {day}th of month
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div className="mfsip-form-group">
                <label className="mfsip-form-label">Investment Period</label>
                <div className="mfsip-chips">
                  {DURATIONS.map((d) => (
                    <button
                      type="button"
                      key={d.years}
                      className={`mfsip-chip-btn ${durationYears === d.years ? 'active' : ''}`}
                      onClick={() => setDurationYears(d.years)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <button type="submit" className="mfsip-submit-btn">
                Confirm & Start SIP (DEMO)
              </button>
            </form>
          </div>

          {/* Live Preview */}
          <div className="mfsip-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 18px' }}>
              Growth Projection (12% CAGR)
            </h2>

            <div className="mfsip-stats-row">
              <div className="mfsip-stat-box">
                <div className="mfsip-stat-title">Total Investment</div>
                <div className="mfsip-stat-val">{fmtCurrency(sipProjection.totalInvested)}</div>
              </div>
              <div className="mfsip-stat-box">
                <div className="mfsip-stat-title">Estimated Gains</div>
                <div className="mfsip-stat-val gain">+{fmtCurrency(sipProjection.estimatedReturns)}</div>
              </div>
            </div>

            <div className="mfsip-stat-box" style={{ marginBottom: 20 }}>
              <div className="mfsip-stat-title">Expected Maturity Value</div>
              <div className="mfsip-stat-val" style={{ fontSize: '1.6rem', color: 'var(--brand)' }}>
                {fmtCurrency(sipProjection.maturityValue)}
              </div>
            </div>

            {/* Growth Curve */}
            <div style={{ width: '100%', height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sipProjection.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sipGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" stroke="var(--text-3)" fontSize={11} />
                  <YAxis
                    stroke="var(--text-3)"
                    fontSize={10}
                    tickFormatter={(v) => (v >= 100000 ? `₹${(v / 100000).toFixed(0)}L` : `₹${Math.round(v / 1000)}k`)}
                  />
                  <Tooltip
                    formatter={(val) => [fmtCurrency(val), 'Value']}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--brand)" strokeWidth={2.5} fill="url(#sipGrad)" />
                  <Area type="monotone" dataKey="invested" stroke="#718096" strokeWidth={1.5} fill="none" strokeDasharray="3 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ textAlign: 'center', fontSize: '0.74rem', color: 'var(--text-3)', marginTop: 8 }}>
              Green solid line: Projected Value · Gray dashed line: Invested Capital
            </div>
          </div>
        </div>
      )}

      {/* ── 2. MY SIPS TAB ── */}
      {activeTab === 'mysips' && (
        <div className="mfsip-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: 0 }}>
              Active SIP Mandates
            </h2>
            <button
              onClick={() => setActiveTab('start')}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                background: 'var(--brand)',
                color: '#fff',
                border: 'none',
                fontWeight: 650,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              + New SIP
            </button>
          </div>

          {sipList.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
              <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px', background: 'var(--surface-2)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Next installment</div>
                {sipReminders.next ? (
                  <>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: 6 }}>{sipReminders.next.sip.next_due}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-3)', marginTop: 3 }}>
                      {sipReminders.next.days === 0 ? 'Due today' : `In ${sipReminders.next.days} day${sipReminders.next.days === 1 ? '' : 's'}`} · {fmtCurrency(sipReminders.next.sip.amount)}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '0.84rem', color: 'var(--text-3)', marginTop: 6 }}>No upcoming date recorded</div>
                )}
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px', background: 'var(--surface-2)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Due this week</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: 6 }}>{sipReminders.dueThisWeek.length} mandate{sipReminders.dueThisWeek.length === 1 ? '' : 's'}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-3)', marginTop: 3 }}>
                  {sipReminders.dueThisWeek.length
                    ? sipReminders.dueThisWeek.map((item) => item.sip.scheme_name.split(' ').slice(0, 2).join(' ')).join(', ')
                    : 'Nothing falls due in the next 7 days'}
                </div>
              </div>
              <div style={{ border: `1px solid ${sipReminders.overdue.length ? 'var(--loss)' : 'var(--line)'}`, borderRadius: 12, padding: '12px 16px', background: 'var(--surface-2)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Overdue</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: 6, color: sipReminders.overdue.length ? 'var(--loss)' : 'var(--text)' }}>
                  {sipReminders.overdue.length} mandate{sipReminders.overdue.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-3)', marginTop: 3 }}>
                  {sipReminders.overdue.length
                    ? `${fmtCurrency(sipReminders.overdueAmount)} recorded as unpaid past the due date`
                    : 'No recorded due date has passed'}
                </div>
              </div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px', background: 'var(--surface-2)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Paused</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: 6 }}>{sipReminders.paused}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-3)', marginTop: 3 }}>Paused mandates are excluded from due counts</div>
              </div>
            </div>
          )}

          {loadingSips ? (
            <p style={{ color: 'var(--text-3)', padding: 20 }}>Loading SIP orders...</p>
          ) : sipList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-3)' }}>
              <p>No active SIP mandates found.</p>
              <button
                onClick={() => setActiveTab('start')}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  background: 'var(--brand)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 650,
                  cursor: 'pointer',
                }}
              >
                Start your first SIP
              </button>
            </div>
          ) : (
            <div className="mfsip-table-wrap">
              <table className="mfsip-table">
                <thead>
                  <tr>
                    <th>Fund Scheme</th>
                    <th>Amount</th>
                    <th>Frequency</th>
                    <th>SIP Date</th>
                    <th>Next Due</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sipList.map((sip) => (
                    <tr key={sip.id}>
                      <td>
                        <strong>{sip.scheme_name}</strong>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Code: {sip.scheme_code}</div>
                        {sip.total_installments > 0 && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                            {sip.completed_installments || 0} of {sip.total_installments} installments recorded
                          </div>
                        )}
                      </td>
                      <td><strong>{fmtCurrency(sip.amount)}</strong></td>
                      <td>{sip.frequency}</td>
                      <td>{sip.sip_date}th of month</td>
                      <td>
                        {sip.next_due ? (
                          <>
                            <div>{sip.next_due}</div>
                            {(() => {
                              const days = sipReminders.dueDays.get(sip.id);
                              if (days == null) return null;
                              const overdue = days < 0;
                              const label = overdue
                                ? `Overdue by ${-days} day${days === -1 ? '' : 's'}`
                                : days === 0 ? 'Due today' : `In ${days} day${days === 1 ? '' : 's'}`;
                              return (
                                <div style={{ fontSize: '0.72rem', color: overdue ? 'var(--loss)' : 'var(--text-3)', fontWeight: overdue ? 700 : 500 }}>
                                  {sip.status === 'active' ? label : 'Paused'}
                                </div>
                              );
                            })()}
                          </>
                        ) : 'Pending'}
                      </td>
                      <td>
                        <span className={`mfsip-status-badge ${sip.status === 'active' ? 'active' : 'paused'}`}>
                          {sip.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => handleToggleSip(sip.id, sip.status)}
                            title={sip.status === 'active' ? 'Pause SIP' : 'Resume SIP'}
                            style={{ background: 'none', border: '1px solid var(--line)', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)' }}
                          >
                            {sip.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                          <button
                            onClick={() => handleCancelSip(sip.id)}
                            title="Cancel SIP"
                            style={{ background: 'none', border: '1px solid var(--line)', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', color: 'var(--loss)' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 3. LUMPSUM TAB ── */}
      {activeTab === 'lumpsum' && (
        <div className="mfsip-grid-layout">
          <div className="mfsip-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 18px' }}>
              One-Time Lump Sum Investment
            </h2>

            <form onSubmit={handleLumpsumInvest}>
              {/* Scheme Search */}
              <div className="mfsip-form-group" style={{ position: 'relative' }}>
                <label className="mfsip-form-label">Select Mutual Fund Scheme</label>
                <input
                  type="text"
                  className="mfsip-input"
                  placeholder="Type to search fund by name or code..."
                  value={fundSearch}
                  onChange={(e) => setFundSearch(e.target.value)}
                  required
                />
                {searchResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-3)', zIndex: 30, maxHeight: 200, overflowY: 'auto' }}>
                    {searchResults.map((s) => {
                      const code = s.schemeCode || s.scheme_code;
                      const name = s.schemeName || s.scheme_name;
                      return (
                        <div
                          key={code}
                          onClick={() => {
                            setSchemeCode(code);
                            setSchemeName(name);
                            setFundSearch(name);
                            setSearchResults([]);
                          }}
                          style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: '0.84rem' }}
                        >
                          <strong>{name}</strong>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Code: {code}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {schemeCode && (
                  <div style={{ fontSize: '0.74rem', color: 'var(--gain)', marginTop: 4 }}>
                    ✓ Selected Scheme Code: {schemeCode}
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="mfsip-form-group">
                <label className="mfsip-form-label">Lump Sum Amount (₹)</label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  className="mfsip-input"
                  value={lumpAmount}
                  onChange={(e) => setLumpAmount(Math.max(1000, Number(e.target.value)))}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {[10000, 25000, 50000, 100000, 250000].map((amt) => (
                    <button
                      type="button"
                      key={amt}
                      className="mfsip-chip-btn"
                      onClick={() => setLumpAmount(amt)}
                    >
                      ₹{amt.toLocaleString('en-IN')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div className="mfsip-form-group">
                <label className="mfsip-form-label">Holding Period</label>
                <div className="mfsip-chips">
                  {DURATIONS.map((d) => (
                    <button
                      type="button"
                      key={d.years}
                      className={`mfsip-chip-btn ${lumpDurationYears === d.years ? 'active' : ''}`}
                      onClick={() => setLumpDurationYears(d.years)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <button type="submit" className="mfsip-submit-btn">
                Invest Now (DEMO)
              </button>
            </form>
          </div>

          <div className="mfsip-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 18px' }}>
              Estimated Returns ({lumpReturn}% CAGR)
            </h2>

            <div className="mfsip-stats-row">
              <div className="mfsip-stat-box">
                <div className="mfsip-stat-title">Invested Amount</div>
                <div className="mfsip-stat-val">{fmtCurrency(lumpProjection.totalInvested)}</div>
              </div>
              <div className="mfsip-stat-box">
                <div className="mfsip-stat-title">Estimated Gains</div>
                <div className="mfsip-stat-val gain">+{fmtCurrency(lumpProjection.estimatedReturns)}</div>
              </div>
            </div>

            <div className="mfsip-stat-box">
              <div className="mfsip-stat-title">Expected Corpus Value</div>
              <div className="mfsip-stat-val" style={{ fontSize: '1.6rem', color: 'var(--brand)' }}>
                {fmtCurrency(lumpProjection.maturityValue)}
              </div>
            </div>

            <div style={{ marginTop: 24, fontSize: '0.8rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
              💡 Lump sum investing is effective when market valuations are attractive or when deploying bonus / surplus funds. For volatile equity funds, phased deployment via Systematic Transfer Plan (STP) or SIP is recommended by financial planners.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
