import { ChartNoAxesCombined, House, UserCircle, WalletCards, Star, Radio } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  ['/', House, 'Home'],
  ['/live', Radio, 'Live'],
  ['/markets', ChartNoAxesCombined, 'Markets'],
  ['/watchlist', Star, 'Watchlist'],
  ['/portfolio', WalletCards, 'Portfolio'],
  ['/profile', UserCircle, 'Profile'],
];

const MobileNav = () => (
  <nav className="mobile-nav" aria-label="Mobile navigation">
    {items.map(([to, Icon, label]) => (
      <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
        <Icon size={20} /><span>{label}</span>
      </NavLink>
    ))}
  </nav>
);

export default MobileNav;
