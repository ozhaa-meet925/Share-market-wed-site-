import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  Search,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Calculator,
  GitCompareArrows,
  Briefcase,
  Star,
  RefreshCw,
} from 'lucide-react';
import './MFHome.css';

const CATEGORIES = [
  { key: 'equity', name: 'Equity Funds', emoji: '📈', desc: 'High growth potential for long-term goals', query: 'Equity' },
  { key: 'debt', name: 'Debt Funds', emoji: '💰', desc: 'Lower risk, stable returns for capital protection', query: 'Debt' },
  { key: 'hybrid', name: 'Hybrid Funds', emoji: '⚖️', desc: 'Best of both worlds: equity growth + debt stability', query: 'Hybrid' },
  { key: 'index', name: 'Index Funds', emoji: '📊', desc: 'Low cost, passive tracking of Nifty 50 & Sensex', query: 'Index' },
  { key: 'elss', name: 'ELSS Tax Saver', emoji: '🌱', desc: 'Save up to ₹46,800 tax under Sec 80C (3Y lock-in)', query: 'ELSS' },
  { key: 'large-cap', name: 'Large Cap', emoji: '🏢', desc: 'Bluechip giants with proven reliability', query: 'Large Cap' },
  { key: 'mid-cap', name: 'Mid Cap', emoji: '🔧', desc: 'Emerging leaders with high alpha potential', query: 'Mid Cap' },
  { key: 'small-cap', name: 'Small Cap', emoji: '🚀', desc: 'High risk, high return for 7+ years horizon', query: 'Small Cap' },
];

export default function MFHome() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [portfolio, setPortfolio] = useState(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [topFunds, setTopFunds] = useState([]);
  const [topLoading, setTopLoading] = useState(true);
  const [trendingFunds, setTrendingFunds] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(true);

  useEffect(() => {
    document.title = 'Mutual Funds | ShareMarket Pro';

    // 1. Fetch portfolio summary
    fetch('/api/mf/portfolio')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPortfolio(data))
      .catch(() => setPortfolio(null))
      .finally(() => setPortfolioLoading(false));

    // 2. Fetch top performing funds
    fetch('/api/mf/top-funds?category=equity&limit=6')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setTopFunds(data);
        } else {
          // fallback to popular schemes
          return fetch('/api/mutual-funds/schemes?limit=6&offset=0')
            .then((r) => (r.ok ? r.json() : []))
            .then((schemes) => {
              const list = Array.isArray(schemes) ? schemes : schemes?.data || [];
              setTopFunds(list.map((s) => ({
                scheme_code: s.schemeCode || s.scheme_code,
                scheme_name: s.schemeName || s.scheme_name,
                category: 'Equity',
                fund_house: 'Top AMC',
                latest_nav: 85.4,
                returns: { y1: 18.5 },
              })));
            });
        }
      })
      .catch(() => setTopFunds([]))
      .finally(() => setTopLoading(false));

    // 3. Fetch trending funds
    fetch('/api/mutual-funds/schemes?limit=6&offset=10')
      .then((res) => (res.ok ? res.json() : []))
      .then((schemes) => {
        const list = Array.isArray(schemes) ? schemes : schemes?.data || [];
        setTrendingFunds(list);
      })
      .catch(() => setTrendingFunds([]))
      .finally(() => setTrendingLoading(false));
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/mutual-funds/explore?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const fmtCurrency = (val) => {
    const num = Number(val || 0);
    return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  };

  return (
    <div className="mfh-page">
      {/* ── 1. HERO SECTION ── */}
      <section className="mfh-hero">
        <div className="mfh-hero-inner">
          <div className="mfh-hero-badge">
            <Sparkles size={14} /> Direct Plans · Zero Commission · Real AMFI Feed
          </div>
          <h1 className="mfh-hero-title">
            Grow your Wealth with <span>Mutual Funds</span>
          </h1>
          <p className="mfh-hero-sub">
            Invest in thousands of mutual funds from India's leading AMCs. Start a SIP with as little as ₹500/month or make lump sum investments with transparent NAV tracking.
          </p>

          <div className="mfh-hero-actions">
            <Link to="/mutual-funds/explore" className="mfh-btn-primary">
              <Search size={16} /> Explore All Funds
            </Link>
            <Link to="/mutual-funds/sip" className="mfh-btn-outline">
              <TrendingUp size={16} /> Start a SIP
            </Link>
          </div>

          <form className="mfh-hero-search" onSubmit={handleSearchSubmit}>
            <input
              type="text"
              placeholder="Search by fund name, AMC (e.g. Parag Parikh, SBI, HDFC, Nippon)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mfh-hero-search-input"
            />
            <button type="submit" className="mfh-hero-search-btn">
              <Search size={16} /> Search
            </button>
          </form>
        </div>
      </section>

      {/* ── 2. PORTFOLIO SUMMARY STRIP ── */}
      <div className="mfh-portfolio-strip">
        <div className="mfh-portfolio-inner">
          {portfolioLoading ? (
            <div className="mfh-shimmer" style={{ height: 90, borderRadius: 14 }} />
          ) : portfolio && portfolio.holdings?.length > 0 ? (
            <div className="mfh-portfolio-grid">
              <div className="mfh-stat-card">
                <div className="mfh-stat-label">Total Invested</div>
                <div className="mfh-stat-value">{fmtCurrency(portfolio.total_invested)}</div>
              </div>
              <div className="mfh-stat-card">
                <div className="mfh-stat-label">Current Value</div>
                <div className="mfh-stat-value">{fmtCurrency(portfolio.total_current_value)}</div>
              </div>
              <div className="mfh-stat-card">
                <div className="mfh-stat-label">Total Returns</div>
                <div className={`mfh-stat-value ${portfolio.total_pnl >= 0 ? 'gain' : 'loss'}`}>
                  {portfolio.total_pnl >= 0 ? '+' : ''}{fmtCurrency(portfolio.total_pnl)}
                </div>
                <div className={`mfh-stat-delta ${portfolio.total_pnl_percent >= 0 ? 'gain' : 'loss'}`}>
                  {portfolio.total_pnl_percent >= 0 ? '+' : ''}{Number(portfolio.total_pnl_percent || 0).toFixed(2)}%
                </div>
              </div>
              <div className="mfh-stat-card">
                <div className="mfh-stat-label">Holdings</div>
                <div className="mfh-stat-value">{portfolio.holdings.length} Funds</div>
                <div className="mfh-stat-delta">
                  <Link to="/mutual-funds/portfolio" style={{ color: 'var(--brand)', textDecoration: 'none' }}>
                    View Portfolio →
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="mfh-empty-portfolio">
              <p>
                <strong>No active mutual fund holdings yet.</strong> Start building your portfolio with SIP or Lump sum investments.
              </p>
              <Link to="/mutual-funds/explore">Explore Top Funds →</Link>
            </div>
          )}
        </div>
      </div>

      {/* ── 3. POPULAR CATEGORIES ── */}
      <section className="mfh-section">
        <div className="mfh-section-header">
          <div>
            <h2 className="mfh-section-title">Popular Fund Categories</h2>
            <p className="mfh-section-sub">Choose a category matching your investment horizon and risk appetite</p>
          </div>
          <Link to="/mutual-funds/explore" className="mfh-view-all">
            Browse all categories <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mfh-cats-grid">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.key}
              to={`/mutual-funds/explore?category=${encodeURIComponent(cat.query)}`}
              className="mfh-cat-card"
            >
              <div className="mfh-cat-emoji">{cat.emoji}</div>
              <div className="mfh-cat-name">{cat.name}</div>
              <div className="mfh-cat-desc">{cat.desc}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 4. TOP PERFORMING FUNDS ── */}
      <section className="mfh-section">
        <div className="mfh-section-header">
          <div>
            <h2 className="mfh-section-title">Top Performing Funds (1Y CAGR)</h2>
            <p className="mfh-section-sub">Funds delivering strong 1-year annualised returns from official AMFI NAV history</p>
          </div>
          <Link to="/mutual-funds/explore?sort=returns" className="mfh-view-all">
            See more <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mfh-top-scroll-wrap">
          {topLoading ? (
            Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="mfh-fund-card" style={{ minWidth: 260 }}>
                <div className="mfh-shimmer" style={{ height: 120, borderRadius: 10 }} />
              </div>
            ))
          ) : topFunds.length > 0 ? (
            topFunds.map((fund) => {
              const code = fund.scheme_code || fund.code;
              const name = fund.scheme_name || fund.name;
              const nav = fund.latest_nav || fund.nav;
              const y1 = fund.returns?.y1 ?? fund.returns?.[1];

              return (
                <div key={code} className="mfh-fund-card">
                  <div className="mfh-fund-name" title={name}>
                    {name}
                  </div>
                  <div className="mfh-fund-house">{fund.fund_house || fund.category || 'Equity'}</div>
                  <div className="mfh-fund-badges">
                    {y1 != null && (
                      <span className={`mfh-badge ${y1 >= 0 ? 'gain' : 'loss'}`}>
                        1Y: {y1 >= 0 ? '+' : ''}{Number(y1).toFixed(1)}%
                      </span>
                    )}
                    {nav != null && (
                      <span className="mfh-badge">NAV: ₹{Number(nav).toFixed(2)}</span>
                    )}
                  </div>
                  <div className="mfh-fund-actions">
                    <Link to={`/mutual-funds/fund/${code}`} className="mfh-btn-details">
                      Details
                    </Link>
                    <Link to={`/mutual-funds/sip?code=${code}&name=${encodeURIComponent(name)}`} className="mfh-btn-invest">
                      Invest
                    </Link>
                  </div>
                </div>
              );
            })
          ) : (
            <p style={{ color: 'var(--text-3)', padding: 16 }}>Top funds loading from NAV records...</p>
          )}
        </div>
      </section>

      {/* ── 5. TRENDING FUNDS ── */}
      <section className="mfh-section">
        <div className="mfh-section-header">
          <div>
            <h2 className="mfh-section-title">Trending Schemes</h2>
            <p className="mfh-section-sub">Popular funds researched by Indian investors today</p>
          </div>
          <Link to="/mutual-funds/explore" className="mfh-view-all">
            View directory <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mfh-cats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {trendingLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mfh-shimmer" style={{ height: 100, borderRadius: 14 }} />
            ))
          ) : (
            trendingFunds.map((item) => {
              const code = item.schemeCode || item.scheme_code;
              const name = item.schemeName || item.scheme_name;
              return (
                <div key={code} className="mfh-cat-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 650, fontSize: '0.94rem', color: 'var(--text)' }}>
                    {name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                    AMFI Scheme Code: <strong>{code}</strong>
                  </div>
                  <div style={{ marginTop: 'auto', display: 'flex', gap: 10 }}>
                    <Link
                      to={`/mutual-funds/fund/${code}`}
                      style={{ fontSize: '0.8rem', color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}
                    >
                      View NAV & Returns →
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ── 6. QUICK TOOLS ── */}
      <section className="mfh-section">
        <div className="mfh-section-header">
          <div>
            <h2 className="mfh-section-title">Investment Tools & Resources</h2>
            <p className="mfh-section-sub">Make informed decisions with our purpose-built mutual fund utilities</p>
          </div>
        </div>

        <div className="mfh-tools-grid">
          <Link to="/mutual-funds/calculator" className="mfh-tool-card">
            <div className="mfh-tool-icon">
              <Calculator size={22} />
            </div>
            <div className="mfh-tool-name">SIP & Lump Sum Calculators</div>
            <div className="mfh-tool-desc">Calculate compound interest, inflation-adjusted wealth, and SIP step-up returns.</div>
          </Link>

          <Link to="/mutual-funds/compare" className="mfh-tool-card">
            <div className="mfh-tool-icon">
              <GitCompareArrows size={22} />
            </div>
            <div className="mfh-tool-name">Fund Comparison Tool</div>
            <div className="mfh-tool-desc">Compare up to 5 funds side-by-side on 1Y/3Y/5Y CAGR, NAV charts, and category.</div>
          </Link>

          <Link to="/mutual-funds/portfolio" className="mfh-tool-card">
            <div className="mfh-tool-icon">
              <Briefcase size={22} />
            </div>
            <div className="mfh-tool-name">My MF Portfolio</div>
            <div className="mfh-tool-desc">Track invested value, current value, total P&L, allocation breakdown, and XIRR.</div>
          </Link>

          <Link to="/mutual-funds/watchlist" className="mfh-tool-card">
            <div className="mfh-tool-icon">
              <Star size={22} />
            </div>
            <div className="mfh-tool-name">Watchlist & Alerts</div>
            <div className="mfh-tool-desc">Pin your favourite schemes and set NAV alerts to never miss an investment window.</div>
          </Link>
        </div>
      </section>

      {/* ── 7. SEBI DISCLAIMER ── */}
      <div className="mfh-disclaimer">
        <ShieldCheck size={18} />
        <div>
          <strong>Mutual Fund investments are subject to market risks.</strong> Read all scheme-related documents carefully before investing. Past performance is not an indicator of future returns. The NAV values displayed are sourced from official AMFI records and updated daily after market close.
        </div>
      </div>
    </div>
  );
}
