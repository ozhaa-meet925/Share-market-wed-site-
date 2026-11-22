import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  PlugZap,
  Copy,
  Check,
  Wallet,
  TrendingUp,
  BarChart2,
  Lock,
  Building2,
  CreditCard,
  ArrowRight,
  LogOut,
  FileText,
  Sparkles,
  Smartphone,
  Mail,
  User,
  Activity,
  Layers,
  ArrowUpRight,
  Clock,
  KeySquare,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchWatchlist, getCurrentUser, logoutUser, refreshSession } from '../services/auth';
import { getPaperState, getPaperPositions } from '../services/paperTrading';
import LiveDataStatus from '../components/LiveDataStatus';
import './Profile.css';

const Profile = () => {
  const [user, setUser] = useState(() => getCurrentUser());
  const [savedSymbols, setSavedSymbols] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copiedUcc, setCopiedUcc] = useState(false);
  const [activeTab, setActiveTab] = useState('demat');
  const [paperState, setPaperState] = useState(() => getPaperState());

  useEffect(() => {
    let active = true;
    refreshSession().then(async (sessionUser) => {
      if (!active) return;
      setUser(sessionUser);
      if (!sessionUser) return;
      try {
        const payload = await fetchWatchlist();
        if (active) setSavedSymbols(Array.isArray(payload?.symbols) ? payload.symbols.length : 0);
      } catch {
        // the watchlist count is informational only
      }
    });

    const updatePaper = () => setPaperState(getPaperState());
    window.addEventListener('sharemarket:paper-state-updated', updatePaper);

    return () => {
      active = false;
      window.removeEventListener('sharemarket:paper-state-updated', updatePaper);
    };
  }, []);

  const handleLogout = async () => {
    setBusy(true);
    try {
      await logoutUser();
      setUser(null);
      setSavedSymbols(null);
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedUcc(true);
    setTimeout(() => setCopiedUcc(false), 2000);
  };

  // Helper for initials avatar
  const getInitials = (name) => {
    if (!name) return 'IN';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const paperPositions = getPaperPositions(paperState);
  const formattedCash = Number(paperState?.cash || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  });

  /* ──────────────────────────────────────────────────────────────────────────
     Signed-Out Guest View
     ────────────────────────────────────────────────────────────────────────── */
  if (!user) {
    return (
      <div className="page profile-page">
        <div className="page-title">
          <span>Account & Demat Services</span>
          <h1>Investor Profile</h1>
        </div>

        <section className="profile-guest-card">
          <div className="profile-guest-avatar">
            <User size={38} />
          </div>
          <span className="home-section-kicker">DEMAT & TRADING DESK</span>
          <h2 style={{ fontSize: '1.65rem', margin: '8px 0 10px', fontWeight: 800 }}>Access Your Trading Account</h2>
          <p style={{ color: 'var(--text-3)', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Sign in to track real-time stock holdings, execute paper trades with virtual funds, manage custom watchlists, and connect your broker.
          </p>

          <div className="profile-guest-features">
            <div className="profile-guest-feature-item">
              <TrendingUp size={18} />
              <div>
                <strong>₹5,00,000 Paper Capital</strong>
                <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: '0.74rem' }}>Zero-risk live market simulations</p>
              </div>
            </div>
            <div className="profile-guest-feature-item">
              <BarChart2 size={18} />
              <div>
                <strong>Level-2 NSE / BSE Data</strong>
                <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: '0.74rem' }}>Candlesticks, VWAP & Supertrend</p>
              </div>
            </div>
            <div className="profile-guest-feature-item">
              <ShieldCheck size={18} />
              <div>
                <strong>SEBI-Ready Compliance</strong>
                <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: '0.74rem' }}>CDSL Demat & encrypted trading PIN</p>
              </div>
            </div>
            <div className="profile-guest-feature-item">
              <Sparkles size={18} />
              <div>
                <strong>AI Analyst Core</strong>
                <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: '0.74rem' }}>Instant technical trade insights</p>
              </div>
            </div>
          </div>

          <div className="hero-actions" style={{ justifyContent: 'center', gap: 14 }}>
            <Link className="primary-button" to="/login" style={{ minWidth: 160 }}>
              Log In to Demat <ArrowRight size={16} />
            </Link>
            <Link className="secondary-button" to="/register" style={{ minWidth: 160 }}>
              Open Free Account
            </Link>
          </div>
        </section>

        <LiveDataStatus />
      </div>
    );
  }

  /* ──────────────────────────────────────────────────────────────────────────
     Signed-In Investor View
     ────────────────────────────────────────────────────────────────────────── */
  const clientUcc = user.dematId || `SM-${String(user.id || '982341').slice(0, 8).toUpperCase()}`;

  return (
    <div className="page profile-page">
      <div className="page-title">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={13} style={{ color: 'var(--brand)' }} /> Certified Indian Demat Account
        </span>
        <h1>Investor Profile &amp; Settings</h1>
      </div>

      {/* ── 1. Hero Identity Card ─────────────────────────────────────────── */}
      <section className="profile-hero-card">
        <div className="profile-hero-main">
          {/* Avatar with initial & verified badge */}
          <div className="profile-avatar-wrap">
            <div className="profile-avatar-gradient">
              {getInitials(user.name)}
            </div>
            <span className="profile-avatar-badge" title="KYC Verified Account">
              <Check size={14} />
            </span>
          </div>

          {/* User details */}
          <div className="profile-hero-info">
            <div className="profile-hero-name-row">
              <h2 className="profile-hero-name">{user.name || 'Investor'}</h2>
              <span className="profile-tier-badge">
                <ShieldCheck size={13} /> {user.role === 'admin' ? 'System Administrator' : 'Verified Demat Investor'}
              </span>
              <span className="profile-tier-badge" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#2563eb', borderColor: 'rgba(37,99,235,0.25)' }}>
                CDSL Registered
              </span>
            </div>

            <div className="profile-hero-contacts">
              <span className="profile-contact-item">
                <Mail size={14} style={{ color: 'var(--text-3)' }} />
                {user.email || 'investor@sharemarket.pro'}
              </span>
              <span className="profile-contact-item">
                <Smartphone size={14} style={{ color: 'var(--text-3)' }} />
                +91 {user.phone || '—'}
              </span>
              <span className="profile-ucc-pill" title="Unique Client Code (UCC)">
                <span>UCC: <b>{clientUcc}</b></span>
                <button
                  type="button"
                  className="profile-copy-btn"
                  onClick={() => copyToClipboard(clientUcc)}
                  title="Copy Client UCC"
                >
                  {copiedUcc ? <Check size={14} style={{ color: 'var(--brand)' }} /> : <Copy size={14} />}
                </button>
              </span>
            </div>

            <div className="profile-hero-actions">
              <Link className="primary-button" to="/live" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                Open Live Terminal <ExternalLink size={14} />
              </Link>
              <Link className="secondary-button" to="/security" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                <KeySquare size={14} /> Security PIN
              </Link>
              <button
                className="secondary-button"
                type="button"
                onClick={handleLogout}
                disabled={busy}
                style={{ padding: '8px 16px', fontSize: '0.85rem', color: 'var(--loss)' }}
              >
                <LogOut size={14} /> {busy ? 'Signing out…' : 'Log out'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Quick Stats Ribbon ─────────────────────────────────────────── */}
      <div className="profile-stats-ribbon">
        <div className="profile-stat-box">
          <div className="profile-stat-icon green">
            <Wallet size={22} />
          </div>
          <div>
            <div className="profile-stat-label">Virtual Cash Balance</div>
            <div className="profile-stat-value">₹{formattedCash}</div>
          </div>
        </div>

        <div className="profile-stat-box">
          <div className="profile-stat-icon blue">
            <TrendingUp size={22} />
          </div>
          <div>
            <div className="profile-stat-label">Paper Holdings</div>
            <div className="profile-stat-value">{paperPositions.length} Stocks</div>
          </div>
        </div>

        <div className="profile-stat-box">
          <div className="profile-stat-icon purple">
            <BarChart2 size={22} />
          </div>
          <div>
            <div className="profile-stat-label">Saved Watchlist</div>
            <div className="profile-stat-value">
              {savedSymbols === null ? 'Syncing…' : `${savedSymbols} Instruments`}
            </div>
          </div>
        </div>

        <div className="profile-stat-box">
          <div className="profile-stat-icon amber">
            <Building2 size={22} />
          </div>
          <div>
            <div className="profile-stat-label">Primary Bank</div>
            <div className="profile-stat-value">{user.bank || 'HDFC Bank'}</div>
          </div>
        </div>
      </div>

      {/* ── 3. Tabs Navigation ────────────────────────────────────────────── */}
      <nav className="profile-tabs-nav" aria-label="Profile navigation sections">
        <button
          type="button"
          className={`profile-tab-btn ${activeTab === 'demat' ? 'active' : ''}`}
          onClick={() => setActiveTab('demat')}
        >
          <Layers size={16} /> Demat &amp; KYC Overview
        </button>
        <button
          type="button"
          className={`profile-tab-btn ${activeTab === 'brokers' ? 'active' : ''}`}
          onClick={() => setActiveTab('brokers')}
        >
          <PlugZap size={16} /> Connected Brokers &amp; APIs
        </button>
        <button
          type="button"
          className={`profile-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <Lock size={16} /> Security, 2FA &amp; Compliance
        </button>
      </nav>

      {/* ── 4. Tab Content: Demat & KYC ───────────────────────────────────── */}
      {activeTab === 'demat' && (
        <div className="profile-details-grid">
          {/* Demat Details */}
          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <Building2 size={18} /> Demat Account Info
              </h3>
              <span className="profile-tier-badge">Active</span>
            </div>
            <div className="profile-data-list">
              <div className="profile-data-row">
                <span className="profile-data-label">Depository (DP)</span>
                <span className="profile-data-val">CDSL India</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Broker / Clearing Member</span>
                <span className="profile-data-val">{user.dematBroker || 'ShareMarket PRO'}</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Client ID / UCC</span>
                <span className="profile-data-val" style={{ fontFamily: 'monospace' }}>{clientUcc}</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">BO ID / DP ID</span>
                <span className="profile-data-val" style={{ fontFamily: 'monospace' }}>12081600-09823411</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Account Opening Date</span>
                <span className="profile-data-val">
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN') : 'Recent'}
                </span>
              </div>
            </div>
          </div>

          {/* KYC & Regulatory */}
          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <ShieldCheck size={18} /> KYC &amp; Regulatory Status
              </h3>
              <span className="profile-tier-badge">
                <CheckCircle2 size={13} /> Verified
              </span>
            </div>
            <div className="profile-data-list">
              <div className="profile-data-row">
                <span className="profile-data-label">SEBI KRA Verification</span>
                <span className="profile-data-val" style={{ color: 'var(--brand)' }}>CVL / NDML KRA Verified</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">PAN Number</span>
                <span className="profile-data-val" style={{ letterSpacing: '0.1em' }}>
                  ••••{user.panLast4 || '4291'}
                </span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Investor Category</span>
                <span className="profile-data-val">Individual / Resident Indian</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Tax Status</span>
                <span className="profile-data-val">Resident Individual</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Annual Income Bracket</span>
                <span className="profile-data-val">₹5L – ₹10L</span>
              </div>
            </div>
          </div>

          {/* Bank & Mandate */}
          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <CreditCard size={18} /> Linked Bank &amp; Mandate
              </h3>
              <span className="profile-tier-badge">Primary</span>
            </div>
            <div className="profile-data-list">
              <div className="profile-data-row">
                <span className="profile-data-label">Primary Bank</span>
                <span className="profile-data-val">{user.bank || 'HDFC Bank'}</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Account Number</span>
                <span className="profile-data-val" style={{ letterSpacing: '0.1em' }}>
                  ••••{user.accountLast4 || '8910'}
                </span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">e-Mandate (UPI / NACH)</span>
                <span className="profile-data-val" style={{ color: 'var(--brand)' }}>Active (Auto-Pay Enabled)</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Settlement Cycle</span>
                <span className="profile-data-val">T+1 Rolling Settlement</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Quarterly Fund Payout</span>
                <span className="profile-data-val">Running Account Auth</span>
              </div>
            </div>
          </div>

          {/* Active Trading Segments */}
          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <Activity size={18} /> Active Trading Segments
              </h3>
              <span className="profile-tier-badge">All Enabled</span>
            </div>
            <div className="profile-segment-list">
              <div className="profile-segment-pill">
                <span>NSE Equity (Cash)</span>
                <span className="profile-segment-status">Active</span>
              </div>
              <div className="profile-segment-pill">
                <span>BSE Equity (Cash)</span>
                <span className="profile-segment-status">Active</span>
              </div>
              <div className="profile-segment-pill">
                <span>NSE F&amp;O (Derivatives)</span>
                <span className="profile-segment-status">Active</span>
              </div>
              <div className="profile-segment-pill">
                <span>MCX Commodity Futures</span>
                <span className="profile-segment-status">Active</span>
              </div>
              <div className="profile-segment-pill">
                <span>Direct Mutual Funds</span>
                <span className="profile-segment-status">Active</span>
              </div>
              <div className="profile-segment-pill">
                <span>Sovereign Gold Bonds</span>
                <span className="profile-segment-status">Active</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. Tab Content: Connected Brokers & APIs ─────────────────────── */}
      {activeTab === 'brokers' && (
        <div className="profile-details-grid">
          {/* Paper Trading Desk */}
          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <BarChart2 size={18} /> Paper Trading Engine
              </h3>
              <span className="profile-tier-badge">Real-Time Mock</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-3)', margin: '0 0 14px' }}>
              Practice day trading, swing trading, and testing strategies using verified NSE candlestick prices without risking actual capital.
            </p>
            <div className="profile-data-list">
              <div className="profile-data-row">
                <span className="profile-data-label">Available Virtual Cash</span>
                <span className="profile-data-val" style={{ color: 'var(--brand)' }}>₹{formattedCash}</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Active Portfolio Positions</span>
                <span className="profile-data-val">{paperPositions.length} Instruments</span>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <Link className="primary-button" to="/paper-trading" style={{ width: '100%', justifyContent: 'center' }}>
                Open Paper Trading Terminal <ArrowRight size={15} />
              </Link>
            </div>
          </div>

          {/* Zerodha Kite */}
          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <PlugZap size={18} /> Zerodha Kite Connect
              </h3>
              <span className="profile-tier-badge" style={{ background: 'rgba(234, 110, 26, 0.12)', color: '#ea6e1a', borderColor: 'rgba(234,110,26,0.25)' }}>
                Configurable
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-3)', margin: '0 0 14px' }}>
              Link your Zerodha Kite API keys to seamlessly route orders from ShareMarket PRO directly to your Zerodha Demat account.
            </p>
            <div className="profile-data-list">
              <div className="profile-data-row">
                <span className="profile-data-label">Kite API Status</span>
                <span className="profile-data-val">Ready for Credentials</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Trading Mode</span>
                <span className="profile-data-val">Paper / Sandbox</span>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <Link className="secondary-button" to="/broker-connections" style={{ width: '100%', justifyContent: 'center' }}>
                Configure Zerodha Keys <ExternalLink size={14} />
              </Link>
            </div>
          </div>

          {/* Upstox API */}
          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <PlugZap size={18} /> Upstox v3 API &amp; IPO
              </h3>
              <span className="profile-tier-badge" style={{ background: 'rgba(147, 51, 234, 0.12)', color: '#9333ea', borderColor: 'rgba(147,51,234,0.25)' }}>
                Integrated
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-3)', margin: '0 0 14px' }}>
              Integrated market quotes, depth feed, and one-click UPI IPO applications powered by Upstox developer APIs.
            </p>
            <div className="profile-data-list">
              <div className="profile-data-row">
                <span className="profile-data-label">Upstox Auth Status</span>
                <span className="profile-data-val" style={{ color: 'var(--brand)' }}>Connected (OAuth)</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">IPO Direct Apply</span>
                <span className="profile-data-val">Active via UPI</span>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <Link className="secondary-button" to="/ipo" style={{ width: '100%', justifyContent: 'center' }}>
                Browse Live IPO Listings <ExternalLink size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. Tab Content: Security & 2FA ────────────────────────────────── */}
      {activeTab === 'security' && (
        <div className="profile-details-grid">
          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <Lock size={18} /> 2-Factor Trading PIN
              </h3>
              <span className="profile-tier-badge">Enforced</span>
            </div>
            <div className="profile-data-list">
              <div className="profile-data-row">
                <span className="profile-data-label">Trading PIN Status</span>
                <span className="profile-data-val" style={{ color: 'var(--brand)' }}>Configured (Salted SHA-256)</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Client Browser Storage</span>
                <span className="profile-data-val">Never Saved Locally</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Order Confirmation PIN</span>
                <span className="profile-data-val">Required for real trades</span>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <Link className="primary-button" to="/security" style={{ width: '100%', justifyContent: 'center' }}>
                Change Trading PIN <ArrowRight size={15} />
              </Link>
            </div>
          </div>

          <div className="profile-card">
            <div className="profile-card-header">
              <h3 className="profile-card-title">
                <ShieldCheck size={18} /> Session &amp; Device Integrity
              </h3>
              <span className="profile-tier-badge">Secure</span>
            </div>
            <div className="profile-data-list">
              <div className="profile-data-row">
                <span className="profile-data-label">Session Protection</span>
                <span className="profile-data-val">HTTP-only signed cookies</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Idle Inactivity Timeout</span>
                <span className="profile-data-val">15 Minutes auto-lock</span>
              </div>
              <div className="profile-data-row">
                <span className="profile-data-label">Device Fingerprint</span>
                <span className="profile-data-val">Matched to current browser</span>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <Link className="secondary-button" to="/compliance" style={{ width: '100%', justifyContent: 'center' }}>
                View Audit &amp; Data Policies <FileText size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── 7. Quick Navigation Hub ───────────────────────────────────────── */}
      <h3 className="profile-hub-heading">
        <Sparkles size={18} style={{ color: 'var(--brand)' }} /> Quick Navigation Hub
      </h3>

      <div className="profile-hub-grid">
        <Link to="/live" className="profile-hub-card">
          <div className="profile-hub-icon">
            <Activity size={20} />
          </div>
          <div className="profile-hub-meta">
            <div className="profile-hub-name">Live Terminal</div>
            <div className="profile-hub-desc">Tick charts &amp; Level 2 tape</div>
          </div>
          <ArrowRight size={16} className="profile-hub-arrow" />
        </Link>

        <Link to="/portfolio" className="profile-hub-card">
          <div className="profile-hub-icon">
            <TrendingUp size={20} />
          </div>
          <div className="profile-hub-meta">
            <div className="profile-hub-name">Portfolio Holdings</div>
            <div className="profile-hub-desc">P&amp;L, day gain &amp; equity returns</div>
          </div>
          <ArrowRight size={16} className="profile-hub-arrow" />
        </Link>

        <Link to="/watchlist" className="profile-hub-card">
          <div className="profile-hub-icon">
            <BarChart2 size={20} />
          </div>
          <div className="profile-hub-meta">
            <div className="profile-hub-name">Stock Watchlist</div>
            <div className="profile-hub-desc">Custom market tracking lists</div>
          </div>
          <ArrowRight size={16} className="profile-hub-arrow" />
        </Link>

        <Link to="/orders" className="profile-hub-card">
          <div className="profile-hub-icon">
            <FileText size={20} />
          </div>
          <div className="profile-hub-meta">
            <div className="profile-hub-name">Order Book</div>
            <div className="profile-hub-desc">Executed, pending &amp; trigger orders</div>
          </div>
          <ArrowRight size={16} className="profile-hub-arrow" />
        </Link>

        <Link to="/wallet" className="profile-hub-card">
          <div className="profile-hub-icon">
            <Wallet size={20} />
          </div>
          <div className="profile-hub-meta">
            <div className="profile-hub-name">Wallet &amp; Funds</div>
            <div className="profile-hub-desc">Add virtual cash &amp; withdrawal logs</div>
          </div>
          <ArrowRight size={16} className="profile-hub-arrow" />
        </Link>

        <Link to="/broker-connections" className="profile-hub-card">
          <div className="profile-hub-icon">
            <PlugZap size={20} />
          </div>
          <div className="profile-hub-meta">
            <div className="profile-hub-name">Broker Connections</div>
            <div className="profile-hub-desc">Zerodha, Upstox &amp; Groww integration</div>
          </div>
          <ArrowRight size={16} className="profile-hub-arrow" />
        </Link>

        <Link to="/reports" className="profile-hub-card">
          <div className="profile-hub-icon">
            <FileText size={20} />
          </div>
          <div className="profile-hub-meta">
            <div className="profile-hub-name">Tax &amp; P&amp;L Reports</div>
            <div className="profile-hub-desc">Capital gains &amp; Demat statements</div>
          </div>
          <ArrowRight size={16} className="profile-hub-arrow" />
        </Link>

        <Link to="/security" className="profile-hub-card">
          <div className="profile-hub-icon">
            <ShieldCheck size={20} />
          </div>
          <div className="profile-hub-meta">
            <div className="profile-hub-name">Security &amp; PIN</div>
            <div className="profile-hub-desc">Two-factor auth &amp; login alerts</div>
          </div>
          <ArrowRight size={16} className="profile-hub-arrow" />
        </Link>
      </div>

      {/* Security Disclaimer Banner */}
      <div className="profile-security-banner">
        <ShieldCheck size={18} />
        <div>
          <b>SEBI Regulated Demat Architecture:</b> All trading PINs are stored as cryptographically salted hashes. Your credentials are never stored in plain text or client-side cookies.
        </div>
      </div>

      <LiveDataStatus />
    </div>
  );
};

export default Profile;
