import { useEffect, useState } from 'react';
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
import TopGainers from './pages/TopGainers';
import TopLosers from './pages/TopLosers';
import PaperTrading from './pages/PaperTrading';
import Wallet from './pages/Wallet';
import Notifications from './pages/Notifications';
import Register from './pages/Register';
import Calendar from './pages/Calendar';
import Feedback from './pages/Feedback';
import LiveTerminal from './pages/LiveTerminal';
import Compare from './pages/Compare';

const App = () => {
  const [theme, setTheme] = useState(() => localStorage.getItem('sharemarket:theme') || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sharemarket:theme', theme);
  }, [theme]);

  return (
    <div className="app-shell">
      <TopTicker />
      <Navbar theme={theme} onToggleTheme={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))} />
    <main>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/live" element={<LiveTerminal />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/nifty" element={<Nifty />} />
        <Route path="/sensex" element={<Sensex />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/stocks" element={<Stocks />} />
      <Route path="/all-stocks" element={<AllStocks />} />
        <Route path="/stocks/:symbol" element={<StockDetails />} />
        <Route path="/ipo" element={<IPO />} />
        <Route path="/ipo/:company" element={<IPODetails />} />
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
        <Route path="/top-gainers" element={<TopGainers />} />
        <Route path="/top-losers" element={<TopLosers />} />
        <Route path="/paper-trading" element={<PaperTrading />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/calculators" element={<Calculator />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/profile" element={<Profile />} />
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
