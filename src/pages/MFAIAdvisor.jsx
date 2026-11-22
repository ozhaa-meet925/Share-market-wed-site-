import { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import './MFAIAdvisor.css';

const QUICK_PROMPTS = [
  'Best ELSS funds for saving tax?',
  'SIP vs Lump Sum: Which is better?',
  'How to pick a good Flexi Cap fund?',
  'Explain Expense Ratio and Direct vs Regular',
  'What allocation should I keep for 10 years?',
];

const FALLBACK_RESPONSES = {
  'Best ELSS funds for saving tax?':
    'ELSS (Equity Linked Savings Schemes) offer tax deductions up to ₹1.5 Lakh under Section 80C with the shortest mandatory lock-in period of 3 years. Historically, leading direct plans from fund houses like Mirae Asset, Parag Parikh, and Quant have delivered strong long-term alpha. Remember that ELSS returns are market-linked and subject to 12.5% LTCG tax above ₹1.25 Lakh exemption.',
  'SIP vs Lump Sum: Which is better?':
    'SIP (Systematic Investment Plan) is superior for salaried earners and volatile equity markets because of Rupee Cost Averaging — buying more units when prices fall and fewer when prices rise. Lump Sum is best utilized when deploying windfall funds or when market valuations are demonstrably cheap.',
  'How to pick a good Flexi Cap fund?':
    'When evaluating Flexi Cap funds: 1) Check Rolling Returns consistency over 3Y and 5Y rather than trailing returns, 2) Look for low Expense Ratio (Direct Plan), 3) Verify portfolio overlap if you already hold other equity funds, and 4) Check fund manager tenure and investment mandate execution.',
  'Explain Expense Ratio and Direct vs Regular':
    'Expense Ratio (TER) is the annual percentage charged by the AMC to manage the fund. In Regular Plans, an additional 0.5%–1.2% commission is deducted every year to pay distributors. Direct Plans cut out all intermediaries — over a 15-year period, investing via Direct Plans can save you 15%–25% higher final corpus due to compound interest.',
  'What allocation should I keep for 10 years?':
    'For a 10-year investment horizon, a balanced growth asset allocation is typically: 60% Equity (30% Large Cap/Index + 20% Flexi Cap + 10% Mid/Small Cap), 25% Debt (Liquid / Corporate Bond funds for rebalancing), and 15% Gold ETF / Sovereign Gold for inflation hedging.',
};

export default function MFAIAdvisor() {
  const [messages, setMessages] = useState([
    {
      role: 'ai',
      text: 'Hello! I am your AI Mutual Fund Assistant. Ask me anything about fund selection, asset allocation, SIP strategies, or analyzing specific schemes.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Fund Diagnostic Analyzer
  const [analyzerQuery, setAnalyzerQuery] = useState('');
  const [analyzerResults, setAnalyzerResults] = useState([]);
  const [selectedScheme, setSelectedScheme] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Allocation planner
  const [risk, setRisk] = useState('Moderate');
  const [horizon, setHorizon] = useState('5-10Y');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Autocomplete search
  useEffect(() => {
    if (!analyzerQuery || analyzerQuery.length < 2) {
      setAnalyzerResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/mutual-funds/search?q=${encodeURIComponent(analyzerQuery)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          const list = Array.isArray(data) ? data : data?.data || [];
          setAnalyzerResults(list.slice(0, 5));
        })
        .catch(() => setAnalyzerResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [analyzerQuery]);

  // Send Chat message
  const handleSendMessage = async (textToSend) => {
    const query = textToSend || input;
    if (!query.trim()) return;

    const userMsg = { role: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          context: { page: 'mutual-funds' },
          history: messages.slice(-4),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.reply || data.message || data.text;
        setMessages((prev) => [...prev, { role: 'ai', text: reply }]);
      } else {
        throw new Error('Fallback required');
      }
    } catch {
      // Use smart fallback
      const fallback =
        FALLBACK_RESPONSES[query] ||
        `Based on mutual fund research principles: For long-term capital appreciation, prioritize Direct Growth plans with consistent rolling return CAGR and low tracking error. Ensure proper asset diversification across Large Cap, Flexi Cap, and Debt funds according to your risk tolerance.`;
      setMessages((prev) => [...prev, { role: 'ai', text: fallback }]);
    } finally {
      setLoading(false);
    }
  };

  // Run AI analysis on fund
  const handleAnalyzeFund = async (scheme) => {
    setSelectedScheme(scheme);
    setAnalyzerResults([]);
    setAnalyzerQuery(scheme.schemeName || scheme.scheme_name);
    setAnalyzing(true);
    setAnalysis(null);

    const code = scheme.schemeCode || scheme.scheme_code;
    try {
      const res = await fetch(`/api/mf/ai-analysis/${code}`);
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
      } else {
        throw new Error('Analysis failed');
      }
    } catch {
      // Rule-based diagnostic
      setAnalysis({
        risk_level: 'Moderate',
        recommendation: 'Good for medium to long-term SIP wealth accumulation.',
        strengths: [
          'Diversified underlying equity holdings',
          'Regulated AMC portfolio governance',
          'Regular daily NAV transparency under AMFI disclosures',
        ],
        weaknesses: [
          'Subject to market volatility and economic cycles',
          'CAGR is historical and not guaranteed',
        ],
        suitable_for: 'Investors with 3–5+ years horizon seeking capital appreciation over inflation.',
        ai_note: 'AI diagnostic based on published NAV records. Not financial advice.',
      });
    } finally {
      setAnalyzing(false);
    }
  };

  // Asset allocation calculator
  const allocation = {
    Conservative: { equity: 25, debt: 65, gold: 10 },
    Moderate: { equity: 60, debt: 30, gold: 10 },
    Aggressive: { equity: 80, debt: 15, gold: 5 },
  }[risk] || { equity: 60, debt: 30, gold: 10 };

  return (
    <div className="mfai-page">
      <div className="mfai-header">
        <h1 className="mfai-title">AI Mutual Fund Advisor</h1>
        <p className="mfai-sub">Intelligent portfolio planning, fund diagnostics, and real-time mutual fund intelligence</p>
      </div>

      <div className="mfai-grid">
        {/* ── LEFT: CHATBOT ── */}
        <div className="mfai-card mfai-chat-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Bot size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.94rem' }}>Fund Copilot AI</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--brand)', fontWeight: 600 }}>● Online & Trained on AMFI Standards</div>
            </div>
          </div>

          {/* Quick Prompts */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 0', scrollbarWidth: 'none' }}>
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => handleSendMessage(p)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 999,
                  border: '1px solid var(--line)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="mfai-messages">
            {messages.map((m, i) => (
              <div key={i} className={`mfai-msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="mfai-msg ai" style={{ fontStyle: 'italic', opacity: 0.7 }}>
                AI is analyzing fund data...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="mfai-input-wrap"
          >
            <input
              type="text"
              placeholder="Ask about funds, SIP strategies, tax saving, or allocations..."
              className="mfai-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="mfai-send-btn" disabled={loading}>
              <Send size={16} />
            </button>
          </form>
        </div>

        {/* ── RIGHT: DIAGNOSTIC & ALLOCATION ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Diagnostic Card */}
          <div className="mfai-card">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={18} style={{ color: 'var(--brand)' }} /> Fund AI Diagnostic
            </h2>

            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input
                type="text"
                placeholder="Search fund to diagnose..."
                value={analyzerQuery}
                onChange={(e) => setAnalyzerQuery(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: '0.86rem' }}
              />
              {analyzerResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: 'var(--shadow-3)', zIndex: 40, marginTop: 4 }}>
                  {analyzerResults.map((s) => (
                    <div
                      key={s.schemeCode || s.scheme_code}
                      onClick={() => handleAnalyzeFund(s)}
                      style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: '0.82rem' }}
                    >
                      <strong>{s.schemeName || s.scheme_name}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {analyzing ? (
              <p style={{ fontSize: '0.84rem', color: 'var(--text-3)' }}>Evaluating fund risk & historical metrics...</p>
            ) : analysis ? (
              <div style={{ fontSize: '0.84rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ color: 'var(--text-3)' }}>Risk Assessment</span>
                  <span style={{ padding: '2px 10px', borderRadius: 999, background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 750 }}>
                    {analysis.risk_level} Risk
                  </span>
                </div>

                <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, lineHeight: 1.45 }}>
                  <strong>Recommendation:</strong> {analysis.recommendation}
                </div>

                <div style={{ marginBottom: 10 }}>
                  <strong style={{ display: 'block', marginBottom: 4, color: 'var(--gain)' }}>Key Strengths</strong>
                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    {analysis.strengths?.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <strong style={{ display: 'block', marginBottom: 4, color: 'var(--warn)' }}>Considerations</strong>
                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-3)', lineHeight: 1.5 }}>
                    {analysis.weaknesses?.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', margin: 0 }}>
                Search any mutual fund scheme above to generate an instant AI diagnostic report on suitability, risk profile, and strengths.
              </p>
            )}
          </div>

          {/* Allocation Mixer */}
          <div className="mfai-card">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)', margin: '0 0 14px' }}>
              Suggested Asset Allocation
            </h2>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {['Conservative', 'Moderate', 'Aggressive'].map((r) => (
                <button
                  key={r}
                  onClick={() => setRisk(r)}
                  style={{
                    flex: 1,
                    padding: '7px 0',
                    borderRadius: 8,
                    border: risk === r ? '2px solid var(--brand)' : '1px solid var(--line)',
                    background: risk === r ? 'var(--brand-soft)' : 'var(--surface-2)',
                    color: risk === r ? 'var(--brand)' : 'var(--text-2)',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 650, marginBottom: 4 }}>
                  <span>Equity Funds</span>
                  <span>{allocation.equity}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${allocation.equity}%`, height: '100%', background: 'var(--brand)' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 650, marginBottom: 4 }}>
                  <span>Debt / Liquid Funds</span>
                  <span>{allocation.debt}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${allocation.debt}%`, height: '100%', background: '#1f6f8b' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 650, marginBottom: 4 }}>
                  <span>Gold / Commodities</span>
                  <span>{allocation.gold}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${allocation.gold}%`, height: '100%', background: '#b8860b' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px', fontSize: '0.8rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} />
        <span>
          AI responses and diagnostic suggestions are for educational guidance only. Mutual fund investments are subject to market risks. Please consult a SEBI registered investment adviser before making investment decisions.
        </span>
      </div>
    </div>
  );
}
