import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Calculator,
  TrendingUp,
  Percent,
  Target,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import './MFCalculator.css';

export default function MFCalculator() {
  const [activeTab, setActiveTab] = useState('sip'); // 'sip' | 'lumpsum' | 'stepup' | 'elss' | 'goal'

  // SIP State
  const [sipMonthly, setSipMonthly] = useState(10000);
  const [sipYears, setSipYears] = useState(10);
  const [sipRate, setSipRate] = useState(12);

  // Lumpsum State
  const [lumpAmount, setLumpAmount] = useState(100000);
  const [lumpYears, setLumpYears] = useState(5);
  const [lumpRate, setLumpRate] = useState(12);

  // Step-up SIP State
  const [stepInitial, setStepInitial] = useState(10000);
  const [stepPercent, setStepPercent] = useState(10);
  const [stepYears, setStepYears] = useState(10);
  const [stepRate, setStepRate] = useState(12);

  // ELSS State
  const [elssAmount, setElssAmount] = useState(150000);
  const [elssTaxSlab, setElssTaxSlab] = useState(30);
  const [elssRate, setElssRate] = useState(13);

  // Goal State
  const [goalTarget, setGoalTarget] = useState(5000000); // 50 Lakhs
  const [goalYears, setGoalYears] = useState(10);
  const [goalRate, setGoalRate] = useState(12);

  const fmtCurrency = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;

  // 1. SIP Math
  const sipResult = useMemo(() => {
    const i = sipRate / 12 / 100;
    const n = sipYears * 12;
    const invested = sipMonthly * n;
    const maturity = sipMonthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
    const gains = maturity - invested;

    // Inflation-adjusted (assume 6% inflation)
    const realRate = (1 + sipRate / 100) / (1 + 0.06) - 1;
    const realMonthlyRate = realRate / 12;
    const inflationAdjusted = sipMonthly * ((Math.pow(1 + realMonthlyRate, n) - 1) / realMonthlyRate) * (1 + realMonthlyRate);

    // Chart
    const series = [];
    let cur = 0;
    for (let m = 1; m <= n; m++) {
      cur = (cur + sipMonthly) * (1 + i);
      if (m % 6 === 0 || m === n) {
        series.push({
          time: `${(m / 12).toFixed(1)}Y`,
          invested: Math.round(sipMonthly * m),
          value: Math.round(cur),
        });
      }
    }

    return { invested, maturity, gains, inflationAdjusted, series };
  }, [sipMonthly, sipYears, sipRate]);

  // 2. Lumpsum Math
  const lumpResult = useMemo(() => {
    const invested = lumpAmount;
    const maturity = lumpAmount * Math.pow(1 + lumpRate / 100, lumpYears);
    const gains = maturity - invested;

    const series = [];
    for (let y = 0; y <= lumpYears; y++) {
      series.push({
        time: `${y}Y`,
        invested: Math.round(invested),
        value: Math.round(lumpAmount * Math.pow(1 + lumpRate / 100, y)),
      });
    }

    return { invested, maturity, gains, series };
  }, [lumpAmount, lumpYears, lumpRate]);

  // 3. Step-up SIP Math
  const stepResult = useMemo(() => {
    const monthlyRate = stepRate / 12 / 100;
    let totalInvested = 0;
    let totalValue = 0;
    let currentSip = stepInitial;

    for (let y = 1; y <= stepYears; y++) {
      for (let m = 1; m <= 12; m++) {
        totalInvested += currentSip;
        totalValue = (totalValue + currentSip) * (1 + monthlyRate);
      }
      currentSip = currentSip * (1 + stepPercent / 100);
    }

    // Normal flat SIP for comparison
    const flatI = stepRate / 12 / 100;
    const flatN = stepYears * 12;
    const flatInvested = stepInitial * flatN;
    const flatMaturity = stepInitial * ((Math.pow(1 + flatI, flatN) - 1) / flatI) * (1 + flatI);

    return {
      stepInvested: Math.round(totalInvested),
      stepMaturity: Math.round(totalValue),
      stepGains: Math.round(totalValue - totalInvested),
      flatInvested: Math.round(flatInvested),
      flatMaturity: Math.round(flatMaturity),
      extraCorpus: Math.round(totalValue - flatMaturity),
    };
  }, [stepInitial, stepPercent, stepYears, stepRate]);

  // 4. ELSS Math
  const elssResult = useMemo(() => {
    const cappedInvested = Math.min(elssAmount, 150000);
    const taxSaved = Math.round(cappedInvested * (elssTaxSlab / 100));
    const effectiveCost = elssAmount - taxSaved;
    const valueAfter3Y = Math.round(elssAmount * Math.pow(1 + elssRate / 100, 3));
    const capitalGains = valueAfter3Y - elssAmount;

    return { taxSaved, effectiveCost, valueAfter3Y, capitalGains };
  }, [elssAmount, elssTaxSlab, elssRate]);

  // 5. Goal SIP Math
  const goalResult = useMemo(() => {
    const i = goalRate / 12 / 100;
    const n = goalYears * 12;
    // target = sip * (( (1+i)^n - 1 ) / i) * (1+i)
    const factor = ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
    const requiredSip = Math.round(goalTarget / factor);
    const requiredLump = Math.round(goalTarget / Math.pow(1 + goalRate / 100, goalYears));

    return { requiredSip, requiredLump };
  }, [goalTarget, goalYears, goalRate]);

  return (
    <div className="mfcalc-page">
      <div className="mfcalc-header">
        <h1 className="mfcalc-title">Mutual Fund Calculators</h1>
        <p className="mfcalc-sub">Plan and visualize your compound wealth creation with dedicated financial models</p>
      </div>

      {/* ── TABS ── */}
      <div className="mfcalc-tabs">
        <button
          className={`mfcalc-tab-btn ${activeTab === 'sip' ? 'active' : ''}`}
          onClick={() => setActiveTab('sip')}
        >
          SIP Calculator
        </button>
        <button
          className={`mfcalc-tab-btn ${activeTab === 'lumpsum' ? 'active' : ''}`}
          onClick={() => setActiveTab('lumpsum')}
        >
          Lump Sum Calculator
        </button>
        <button
          className={`mfcalc-tab-btn ${activeTab === 'stepup' ? 'active' : ''}`}
          onClick={() => setActiveTab('stepup')}
        >
          Step-up (Top-up) SIP
        </button>
        <button
          className={`mfcalc-tab-btn ${activeTab === 'elss' ? 'active' : ''}`}
          onClick={() => setActiveTab('elss')}
        >
          ELSS Tax Saver (80C)
        </button>
        <button
          className={`mfcalc-tab-btn ${activeTab === 'goal' ? 'active' : ''}`}
          onClick={() => setActiveTab('goal')}
        >
          Goal-based Planner
        </button>
      </div>

      {/* ── 1. SIP TAB ── */}
      {activeTab === 'sip' && (
        <div className="mfcalc-grid">
          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              Systematic Investment Plan (SIP)
            </h2>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Monthly Investment</span>
                <span className="mfcalc-val-display">{fmtCurrency(sipMonthly)}</span>
              </div>
              <input
                type="range"
                min="500"
                max="100000"
                step="500"
                className="mfcalc-slider"
                value={sipMonthly}
                onChange={(e) => setSipMonthly(Number(e.target.value))}
              />
              <div className="mfcalc-bounds">
                <span>₹500</span>
                <span>₹1 Lakh</span>
              </div>
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Investment Period</span>
                <span className="mfcalc-val-display">{sipYears} Years</span>
              </div>
              <input
                type="range"
                min="1"
                max="30"
                step="1"
                className="mfcalc-slider"
                value={sipYears}
                onChange={(e) => setSipYears(Number(e.target.value))}
              />
              <div className="mfcalc-bounds">
                <span>1 Year</span>
                <span>30 Years</span>
              </div>
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Expected Annual Return</span>
                <span className="mfcalc-val-display">{sipRate}% p.a.</span>
              </div>
              <input
                type="range"
                min="5"
                max="30"
                step="0.5"
                className="mfcalc-slider"
                value={sipRate}
                onChange={(e) => setSipRate(Number(e.target.value))}
              />
              <div className="mfcalc-bounds">
                <span>5%</span>
                <span>30%</span>
              </div>
            </div>
          </div>

          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              Projected Wealth
            </h2>

            <div className="mfcalc-res-grid">
              <div className="mfcalc-res-box">
                <div className="mfcalc-res-label">Total Invested</div>
                <div className="mfcalc-res-val">{fmtCurrency(sipResult.invested)}</div>
              </div>
              <div className="mfcalc-res-box">
                <div className="mfcalc-res-label">Estimated Returns</div>
                <div className="mfcalc-res-val gain">+{fmtCurrency(sipResult.gains)}</div>
              </div>
            </div>

            <div className="mfcalc-res-box" style={{ marginBottom: 16 }}>
              <div className="mfcalc-res-label">Expected Maturity Corpus</div>
              <div className="mfcalc-res-val" style={{ fontSize: '1.65rem', color: 'var(--brand)' }}>
                {fmtCurrency(sipResult.maturity)}
              </div>
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: 16 }}>
              Purchasing power in today's money (6% inflation): <strong>{fmtCurrency(sipResult.inflationAdjusted)}</strong>
            </div>

            <div style={{ width: '100%', height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sipResult.series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="time" stroke="var(--text-3)" fontSize={11} />
                  <YAxis
                    stroke="var(--text-3)"
                    fontSize={10}
                    tickFormatter={(v) => (v >= 100000 ? `₹${(v / 100000).toFixed(0)}L` : `₹${Math.round(v / 1000)}k`)}
                  />
                  <Tooltip
                    formatter={(val) => [fmtCurrency(val), 'Value']}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--brand)" strokeWidth={2.5} fill="rgba(13, 111, 78, 0.15)" />
                  <Area type="monotone" dataKey="invested" stroke="#718096" strokeWidth={1.5} fill="none" strokeDasharray="3 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. LUMPSUM TAB ── */}
      {activeTab === 'lumpsum' && (
        <div className="mfcalc-grid">
          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              One-Time Lump Sum Investment
            </h2>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Total Investment Amount</span>
                <span className="mfcalc-val-display">{fmtCurrency(lumpAmount)}</span>
              </div>
              <input
                type="range"
                min="5000"
                max="1000000"
                step="5000"
                className="mfcalc-slider"
                value={lumpAmount}
                onChange={(e) => setLumpAmount(Number(e.target.value))}
              />
              <div className="mfcalc-bounds">
                <span>₹5,000</span>
                <span>₹10 Lakhs</span>
              </div>
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Investment Period</span>
                <span className="mfcalc-val-display">{lumpYears} Years</span>
              </div>
              <input
                type="range"
                min="1"
                max="30"
                step="1"
                className="mfcalc-slider"
                value={lumpYears}
                onChange={(e) => setLumpYears(Number(e.target.value))}
              />
              <div className="mfcalc-bounds">
                <span>1 Year</span>
                <span>30 Years</span>
              </div>
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Expected Annual Return</span>
                <span className="mfcalc-val-display">{lumpRate}% p.a.</span>
              </div>
              <input
                type="range"
                min="5"
                max="30"
                step="0.5"
                className="mfcalc-slider"
                value={lumpRate}
                onChange={(e) => setLumpRate(Number(e.target.value))}
              />
              <div className="mfcalc-bounds">
                <span>5%</span>
                <span>30%</span>
              </div>
            </div>
          </div>

          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              Projected Maturity
            </h2>

            <div className="mfcalc-res-grid">
              <div className="mfcalc-res-box">
                <div className="mfcalc-res-label">Invested Capital</div>
                <div className="mfcalc-res-val">{fmtCurrency(lumpResult.invested)}</div>
              </div>
              <div className="mfcalc-res-box">
                <div className="mfcalc-res-label">Wealth Gained</div>
                <div className="mfcalc-res-val gain">+{fmtCurrency(lumpResult.gains)}</div>
              </div>
            </div>

            <div className="mfcalc-res-box">
              <div className="mfcalc-res-label">Total Corpus after {lumpYears} Years</div>
              <div className="mfcalc-res-val" style={{ fontSize: '1.65rem', color: 'var(--brand)' }}>
                {fmtCurrency(lumpResult.maturity)}
              </div>
            </div>

            <div style={{ marginTop: 24, fontSize: '0.8rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
              Rule of 72: At {lumpRate}% annual return, your money will double approximately every <strong>{(72 / lumpRate).toFixed(1)} years</strong>.
            </div>
          </div>
        </div>
      )}

      {/* ── 3. STEP-UP SIP TAB ── */}
      {activeTab === 'stepup' && (
        <div className="mfcalc-grid">
          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              Step-up (Top-up) SIP Inputs
            </h2>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Initial Monthly SIP</span>
                <span className="mfcalc-val-display">{fmtCurrency(stepInitial)}</span>
              </div>
              <input
                type="range"
                min="1000"
                max="50000"
                step="1000"
                className="mfcalc-slider"
                value={stepInitial}
                onChange={(e) => setStepInitial(Number(e.target.value))}
              />
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Annual Step-up %</span>
                <span className="mfcalc-val-display">{stepPercent}% per year</span>
              </div>
              <input
                type="range"
                min="5"
                max="25"
                step="5"
                className="mfcalc-slider"
                value={stepPercent}
                onChange={(e) => setStepPercent(Number(e.target.value))}
              />
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Duration</span>
                <span className="mfcalc-val-display">{stepYears} Years</span>
              </div>
              <input
                type="range"
                min="3"
                max="25"
                step="1"
                className="mfcalc-slider"
                value={stepYears}
                onChange={(e) => setStepYears(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              Step-up vs Flat SIP Comparison
            </h2>

            <div className="mfcalc-res-grid">
              <div className="mfcalc-res-box">
                <div className="mfcalc-res-label">Flat SIP Corpus</div>
                <div className="mfcalc-res-val">{fmtCurrency(stepResult.flatMaturity)}</div>
              </div>
              <div className="mfcalc-res-box" style={{ background: 'var(--gain-soft)' }}>
                <div className="mfcalc-res-label" style={{ color: 'var(--gain)', fontWeight: 700 }}>Step-up Corpus</div>
                <div className="mfcalc-res-val gain">{fmtCurrency(stepResult.stepMaturity)}</div>
              </div>
            </div>

            <div className="mfcalc-res-box" style={{ border: '2px solid var(--brand)' }}>
              <div className="mfcalc-res-label">Extra Wealth Created by {stepPercent}% Annual Step-up</div>
              <div className="mfcalc-res-val" style={{ fontSize: '1.65rem', color: 'var(--brand)' }}>
                +{fmtCurrency(stepResult.extraCorpus)}
              </div>
            </div>

            <div style={{ marginTop: 20, fontSize: '0.8rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
              💡 Increasing your monthly SIP by just 10% each year (aligned with annual salary increments) can multiply your final corpus significantly over a 10-15 year horizon.
            </div>
          </div>
        </div>
      )}

      {/* ── 4. ELSS TAB ── */}
      {activeTab === 'elss' && (
        <div className="mfcalc-grid">
          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              ELSS Tax Saver (Section 80C)
            </h2>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Investment Amount</span>
                <span className="mfcalc-val-display">{fmtCurrency(elssAmount)}</span>
              </div>
              <input
                type="range"
                min="10000"
                max="250000"
                step="5000"
                className="mfcalc-slider"
                value={elssAmount}
                onChange={(e) => setElssAmount(Number(e.target.value))}
              />
              <div className="mfcalc-bounds">
                <span>₹10,000</span>
                <span>₹2.5 Lakhs (80C limit: ₹1.5L)</span>
              </div>
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Income Tax Slab</span>
                <span className="mfcalc-val-display">{elssTaxSlab}%</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {[10, 20, 30].map((slab) => (
                  <button
                    key={slab}
                    type="button"
                    onClick={() => setElssTaxSlab(slab)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: elssTaxSlab === slab ? '2px solid var(--brand)' : '1px solid var(--line)',
                      background: elssTaxSlab === slab ? 'var(--brand-soft)' : 'var(--surface-2)',
                      color: elssTaxSlab === slab ? 'var(--brand)' : 'var(--text)',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {slab}% Slab
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              Tax Savings & Lock-in Value
            </h2>

            <div className="mfcalc-res-grid">
              <div className="mfcalc-res-box" style={{ background: 'var(--gain-soft)' }}>
                <div className="mfcalc-res-label" style={{ color: 'var(--gain)', fontWeight: 700 }}>Tax Saved (Sec 80C)</div>
                <div className="mfcalc-res-val gain">{fmtCurrency(elssResult.taxSaved)}</div>
              </div>
              <div className="mfcalc-res-box">
                <div className="mfcalc-res-label">Net Effective Cost</div>
                <div className="mfcalc-res-val">{fmtCurrency(elssResult.effectiveCost)}</div>
              </div>
            </div>

            <div className="mfcalc-res-box">
              <div className="mfcalc-res-label">Expected Value after 3-Year Mandatory Lock-in (13% CAGR)</div>
              <div className="mfcalc-res-val" style={{ fontSize: '1.65rem', color: 'var(--brand)' }}>
                {fmtCurrency(elssResult.valueAfter3Y)}
              </div>
            </div>

            <div style={{ marginTop: 20, fontSize: '0.8rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
              🔒 ELSS mutual funds have the shortest lock-in period (3 years) among all tax-saving instruments under Section 80C (compared to 5 years for Tax Saver FD and 15 years for PPF).
            </div>
          </div>
        </div>
      )}

      {/* ── 5. GOAL TAB ── */}
      {activeTab === 'goal' && (
        <div className="mfcalc-grid">
          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              Goal Financial Planner
            </h2>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Target Financial Goal</span>
                <span className="mfcalc-val-display">{fmtCurrency(goalTarget)}</span>
              </div>
              <input
                type="range"
                min="500000"
                max="20000000"
                step="500000"
                className="mfcalc-slider"
                value={goalTarget}
                onChange={(e) => setGoalTarget(Number(e.target.value))}
              />
              <div className="mfcalc-bounds">
                <span>₹5 Lakhs</span>
                <span>₹2 Crores</span>
              </div>
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Target Time Horizon</span>
                <span className="mfcalc-val-display">{goalYears} Years</span>
              </div>
              <input
                type="range"
                min="1"
                max="30"
                step="1"
                className="mfcalc-slider"
                value={goalYears}
                onChange={(e) => setGoalYears(Number(e.target.value))}
              />
            </div>

            <div className="mfcalc-field">
              <div className="mfcalc-field-header">
                <span className="mfcalc-label">Expected Annual Return</span>
                <span className="mfcalc-val-display">{goalRate}%</span>
              </div>
              <input
                type="range"
                min="6"
                max="20"
                step="0.5"
                className="mfcalc-slider"
                value={goalRate}
                onChange={(e) => setGoalRate(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="mfcalc-card">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 750, color: 'var(--text)', margin: '0 0 20px' }}>
              Required Investments
            </h2>

            <div className="mfcalc-res-box" style={{ marginBottom: 16, border: '2px solid var(--brand)' }}>
              <div className="mfcalc-res-label">Required Monthly SIP</div>
              <div className="mfcalc-res-val" style={{ fontSize: '1.8rem', color: 'var(--brand)' }}>
                {fmtCurrency(goalResult.requiredSip)} / month
              </div>
            </div>

            <div className="mfcalc-res-box">
              <div className="mfcalc-res-label">OR Required One-time Lump Sum Today</div>
              <div className="mfcalc-res-val">
                {fmtCurrency(goalResult.requiredLump)}
              </div>
            </div>

            <div style={{ marginTop: 24, fontSize: '0.8rem', color: 'var(--text-3)', lineHeight: 1.6 }}>
              🎯 To accumulate <strong>{fmtCurrency(goalTarget)}</strong> in <strong>{goalYears} years</strong> at {goalRate}% return, start a monthly SIP of <strong>{fmtCurrency(goalResult.requiredSip)}</strong> today.
            </div>
          </div>
        </div>
      )}

      {/* ── FOOTER DISCLAIMER ── */}
      <div style={{ marginTop: 28, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px', fontSize: '0.8rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} />
        <span>
          Calculations are for illustrative purposes based on compound growth formulas and historical market performance assumptions. Mutual fund returns fluctuate with market conditions.
        </span>
      </div>
    </div>
  );
}
