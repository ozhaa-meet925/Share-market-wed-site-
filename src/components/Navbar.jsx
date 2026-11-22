import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Bell, Moon, ShieldCheck, Sun, UserCircle, Activity, Cpu, PlugZap, Users } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { getCurrentUser } from '../services/auth';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/live', label: 'Live Terminal', isLive: true },
  { to: '/options', label: 'F&O Desk' },
  { to: '/ai-trading', label: 'AI Trader', isAI: true },
  { to: '/ai-core', label: 'AI Core', isCore: true },
  { to: '/markets', label: 'Markets' },
  { to: '/stocks', label: 'Stocks' },
  { to: '/screener', label: 'Screener' },
  { to: '/compare', label: 'Compare' },
  { to: '/gold', label: 'Gold' },
  { to: '/silver', label: 'Silver' },
  { to: '/mutual-funds', label: 'Mutual Funds' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/orders', label: 'Orders' },
  { to: '/reports', label: 'Reports' },
  { to: '/paper-trading', label: 'Paper Trading' },
  { to: '/ipo', label: 'IPO' },
  { to: '/calendar', label: 'Calendars' },
  { to: '/commodities', label: 'Commodities' },
  { to: '/news', label: 'News' },
  { to: '/calculators', label: 'Calculators' },
  { to: '/learn', label: 'Academy' },
];

const Navbar = ({ theme, onToggleTheme }) => {
  const [user, setUser] = useState(() => getCurrentUser());
  useEffect(() => {
    const onChange = (event) => setUser(event.detail || null);
    window.addEventListener('sharemarket:session-changed', onChange);
    return () => window.removeEventListener('sharemarket:session-changed', onChange);
  }, []);
  const isAdmin = user?.role === 'admin';

  return (
  <header className="navbar">
    <NavLink className="brand-logo-link" to="/" aria-label="ShareMarket Pro Home">
      <BrandLogo size="medium" />
    </NavLink>

    <nav aria-label="Primary navigation">
      {navLinks.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''} ${item.isLive ? 'nav-live-item' : ''} ${item.isAI || item.isCore ? 'nav-ai-item' : ''}`
          }
        >
          {item.isLive && <span className="live-dot" />}
          {item.isAI && <Activity size={14} />}
          {item.isCore && <Cpu size={14} />}
          {item.label}
        </NavLink>
      ))}
    </nav>

    <div className="nav-actions">
      <button
        className="theme-toggle"
        type="button"
        onClick={onToggleTheme}
        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      >
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>
      <NavLink className="nav-icon-link" aria-label="Broker connections" to="/broker-connections" title="Broker connections">
        <PlugZap size={19} />
      </NavLink>
      <NavLink className="nav-icon-link" aria-label="Security settings" to="/security" title="Security settings">
        <ShieldCheck size={19} />
      </NavLink>
      <NavLink className="nav-icon-link" aria-label="Notifications" to="/notifications" title="Notifications">
        <Bell size={19} />
      </NavLink>
      {isAdmin ? (
        <NavLink className="nav-icon-link" aria-label="Admin console" to="/admin" title="Admin console">
          <Users size={19} />
        </NavLink>
      ) : null}
      <NavLink className="nav-icon-link" aria-label="Profile" to="/profile" title="My Profile">
        <UserCircle size={21} />
      </NavLink>
    </div>
  </header>
  );
};

export default Navbar;
