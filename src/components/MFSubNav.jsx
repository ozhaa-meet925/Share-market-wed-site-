import { NavLink, useLocation } from 'react-router-dom';
import {
  House,
  Search,
  Repeat,
  Briefcase,
  GitCompareArrows,
  Calculator,
  Star,
  Bot,
} from 'lucide-react';
import './MFSubNav.css';

const MF_NAV = [
  { to: '/mutual-funds', label: 'Overview', icon: House, end: true },
  { to: '/mutual-funds/explore', label: 'Explore', icon: Search },
  { to: '/mutual-funds/sip', label: 'SIP & Invest', icon: Repeat },
  { to: '/mutual-funds/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/mutual-funds/compare', label: 'Compare', icon: GitCompareArrows },
  { to: '/mutual-funds/calculator', label: 'Calculators', icon: Calculator },
  { to: '/mutual-funds/watchlist', label: 'Watchlist', icon: Star },
  { to: '/mutual-funds/ai-advisor', label: 'AI Advisor', icon: Bot, isAI: true },
];

export default function MFSubNav() {
  const location = useLocation();

  if (!location.pathname.startsWith('/mutual-funds')) {
    return null;
  }

  return (
    <nav className="mfnav-bar" aria-label="Mutual Funds sub-navigation">
      <div className="mfnav-inner">
        {MF_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `mfnav-link ${isActive ? 'active' : ''}`
              }
            >
              <Icon size={16} />
              <span>{item.label}</span>
              {item.isAI && <span className="mfnav-ai-badge">AI</span>}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
