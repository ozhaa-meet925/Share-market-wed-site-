import { Link } from 'react-router-dom';
import { ShieldCheck, Clock, Radio, ArrowUpRight, Heart } from 'lucide-react';
import BrandLogo from './BrandLogo';

const Footer = () => (
  <footer className="main-footer">
    <div className="footer-top-grid">
      {/* Brand Column */}
      <div className="footer-brand-column">
        <BrandLogo size="medium" />
        <p className="footer-desc">
          State-of-the-art market intelligence, real-time analytics, Level-2 depth, and paper trading for Indian capital markets (NSE & BSE).
        </p>
        <div className="footer-market-hours">
          <Clock size={15} />
          <span>NSE / BSE Trading Hours: <b>9:15 AM – 3:30 PM IST</b></span>
        </div>
      </div>

      {/* Column 1: Markets & Terminal */}
      <div className="footer-links-column">
        <h4>Markets & Terminal</h4>
        <ul>
          <li><Link to="/live">🔴 Live Terminal</Link></li>
          <li><Link to="/markets">Index Overview</Link></li>
          <li><Link to="/nifty">NIFTY 50 Analysis</Link></li>
          <li><Link to="/sensex">BSE SENSEX</Link></li>
          <li><Link to="/top-gainers">Top Gainers</Link></li>
          <li><Link to="/top-losers">Top Losers</Link></li>
        </ul>
      </div>

      {/* Column 2: Trading & Tools */}
      <div className="footer-links-column">
        <h4>Trading & Portfolio</h4>
        <ul>
          <li><Link to="/portfolio">My Portfolio</Link></li>
          <li><Link to="/watchlist">My Watchlist</Link></li>
          <li><Link to="/orders">Order Book</Link></li>
          <li><Link to="/paper-trading">Paper Trading Simulator</Link></li>
          <li><Link to="/wallet">Wallet & Payments</Link></li>
          <li><Link to="/calculators">SIP & Brokerage Calculators</Link></li>
        </ul>
      </div>

      {/* Column 3: Insights & Learning */}
      <div className="footer-links-column">
        <h4>Insights & Academy</h4>
        <ul>
          <li><Link to="/ipo">IPO Calendar & Grey Market</Link></li>
          <li><Link to="/commodities">Gold & Silver Rates</Link></li>
          <li><Link to="/news">Financial News & Filings</Link></li>
          <li><Link to="/learn">ShareMarket Academy</Link></li>
          <li><Link to="/calendar">Economic Calendar</Link></li>
          <li><Link to="/feedback">User Feedback</Link></li>
        </ul>
      </div>
    </div>

    {/* Regulatory Risk Disclaimer Bar */}
    <div className="footer-disclaimer-bar">
      <div className="disclaimer-badge">
        <ShieldCheck size={16} />
        <strong>SEBI & Regulatory Risk Disclosure:</strong>
      </div>
      <p>
        Securities market investments are subject to market risks. Read all scheme and offer documents carefully before investing. Virtual paper trading balances represent simulated educational capital and do not constitute actual monetary liability or investment advice.
      </p>
    </div>

    {/* Copyright & Sub-footer */}
    <div className="footer-bottom-bar">
      <span>© {new Date().getFullYear()} ShareMarket Pro. All rights reserved.</span>
      <div className="footer-bottom-links">
        <span>Built with Precision for Indian Traders</span>
        <span className="live-status-mini">
          <span className="live-dot" /> All Systems Operational
        </span>
      </div>
    </div>
  </footer>
);

export default Footer;
