import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import TopTicker from './components/TopTicker';
import MobileNav from './components/MobileNav';
import Footer from './components/Footer';
import AICopilotWidget from './components/AICopilotWidget';
import Home from './pages/Home';
import AllStocks from './pages/AllStocks';
import Markets from './pages/Markets';
import Nifty from './pages/Nifty';
import Sensex from './pages/Sensex';
import Stocks from './pages/Stocks';
import StockDetails from './pages/StockDetails';
import IPO from './pages/IPO';
import IPODetails from './pages/IPODetails';
import Gold from './pages/Gold';
import Silver from './pages/Silver';
import Commodities from './pages/Commodities';
import News from './pages/News';
import NewsDetails from './pages/NewsDetails';
import Portfolio from './pages/Portfolio';
import Watchlist from './pages/Watchlist';
import Orders from './pages/Orders';
import Learn from './pages/Learn';
import Calculator from './pages/Calculator';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Security from './pages/Security';
import TopGainers from './pages/TopGainers';
import TopLosers from './pages/TopLosers';
import PaperTrading from './pages/PaperTrading';
import AITrading from './pages/AITrading';
import AICore from './pages/AICore';
import Wallet from './pages/Wallet';
import Notifications from './pages/Notifications';
import Register from './pages/Register';
import Calendar from './pages/Calendar';
import Feedback from './pages/Feedback';
import LiveTerminal from './pages/LiveTerminal';
import Compare from './pages/Compare';
import Screener from './pages/Screener';
import Reports from './pages/Reports';
import BrokerConnections from './pages/BrokerConnections';
import Compliance from './pages/Compliance';
import Admin from './pages/Admin';
import OptionsChain from './pages/OptionsChain';
import useAccountSync from './hooks/useAccountSync';
import MFSubNav from './components/MFSubNav';
const MFHome = lazy(() => import('./pages/MFHome'));
const MFExplore = lazy(() => import('./pages/MFExplore'));
const MFSip = lazy(() => import('./pages/MFSip'));
const MFPortfolio = lazy(() => import('./pages/MFPortfolio'));
const MFCompare = lazy(() => import('./pages/MFCompare'));
const MFCalculator = lazy(() => import('./pages/MFCalculator'));
const MFWatchlist = lazy(() => import('./pages/MFWatchlist'));
const MFAIAdvisor = lazy(() => import('./pages/MFAIAdvisor'));
const MFFundDetail = lazy(() => import('./pages/MFFundDetail'));
const MutualFunds = lazy(() => import('./pages/MutualFunds'));

const App = () => {
  const [theme, setTheme] = useState(() => localStorage.getItem('sharemarket:theme') || 'light');
  useAccountSync();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sharemarket:theme', theme);
  }, [theme]);

  return (
    <div className="app-shell">
      <TopTicker />
      <Navbar theme={theme} onToggleTheme={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))} />
      <MFSubNav />
    <main>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/live" element={<LiveTerminal />} />
        <Route path="/options" element={<OptionsChain />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/nifty" element={<Nifty />} />
        <Route path="/sensex" element={<Sensex />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/stocks" element={<Stocks />} />
        <Route path="/screener" element={<Screener />} />
      <Route path="/all-stocks" element={<AllStocks />} />
        <Route path="/stocks/:symbol" element={<StockDetails />} />
        <Route path="/ipo" element={<IPO />} />
        <Route path="/ipo/:company" element={<IPODetails />} />
        <Route path="/mutual-funds" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading mutual funds…</div>}><MFHome /></Suspense>} />
        <Route path="/mutual-funds/explore" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading explore…</div>}><MFExplore /></Suspense>} />
        <Route path="/mutual-funds/sip" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading SIP…</div>}><MFSip /></Suspense>} />
        <Route path="/mutual-funds/portfolio" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading portfolio…</div>}><MFPortfolio /></Suspense>} />
        <Route path="/mutual-funds/compare" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading compare…</div>}><MFCompare /></Suspense>} />
        <Route path="/mutual-funds/calculator" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading calculators…</div>}><MFCalculator /></Suspense>} />
        <Route path="/mutual-funds/watchlist" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading watchlist…</div>}><MFWatchlist /></Suspense>} />
        <Route path="/mutual-funds/ai-advisor" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading AI advisor…</div>}><MFAIAdvisor /></Suspense>} />
        <Route path="/mutual-funds/fund/:schemeCode" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading fund details…</div>}><MFFundDetail /></Suspense>} />
        <Route path="/mutual-funds/:fundSlug/:schemeCode" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading fund details…</div>}><MFFundDetail /></Suspense>} />
        <Route path="/mutual-funds/:schemeCode" element={<Suspense fallback={<div role="status" style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>Loading fund details…</div>}><MFFundDetail /></Suspense>} />
        <Route path="/gold" element={<Gold />} />
        <Route path="/silver" element={<Silver />} />
        <Route path="/commodities" element={<Commodities />} />
        <Route path="/news/:id" element={<NewsDetails />} />
        <Route path="/news" element={<News />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/watchlist" element={<Watchlist />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/top-gainers" element={<TopGainers />} />
        <Route path="/top-losers" element={<TopLosers />} />
        <Route path="/paper-trading" element={<PaperTrading />} />
        <Route path="/broker-connections" element={<BrokerConnections />} />
        <Route path="/ai-trading" element={<AITrading />} />
        <Route path="/ai-core" element={<AICore />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/calculators" element={<Calculator />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/security" element={<Security />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
    <MobileNav />
    <Footer />
    <AICopilotWidget />
    </div>
  );
};

export default App;
