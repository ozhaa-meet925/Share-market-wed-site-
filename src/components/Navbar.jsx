import { NavLink } from 'react-router-dom';
import { Bell, Moon, Sun, UserCircle, Activity } from 'lucide-react';
import BrandLogo from './BrandLogo';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/live', label: 'Live Terminal', isLive: true },
  { to: '/markets', label: 'Markets' },
  { to: '/stocks', label: 'Stocks' },
  { to: '/compare', label: 'Compare' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/orders', label: 'Orders' },
  { to: '/paper-trading', label: 'Paper Trading' },
  { to: '/ipo', label: 'IPO' },
  { to: '/calendar', label: 'Calendars' },
  { to: '/commodities', label: 'Commodities' },
  { to: '/news', label: 'News' },
  { to: '/calculators', label: 'Calculators' },
  { to: '/learn', label: 'Academy' },
];

const Navbar = ({ theme, onToggleTheme }) => (
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
            `nav-item ${isActive ? 'active' : ''} ${item.isLive ? 'nav-live-item' : ''}`
          }
        >
          {item.isLive && <span className="live-dot" />}
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
      <NavLink className="nav-icon-link" aria-label="Notifications" to="/notifications" title="Notifications">
        <Bell size={19} />
      </NavLink>
      <NavLink className="nav-icon-link" aria-label="Profile" to="/profile" title="My Profile">
        <UserCircle size={21} />
      </NavLink>
    </div>
  </header>
);

export default Navbar;
