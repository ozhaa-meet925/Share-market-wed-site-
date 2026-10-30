import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MarketLiveProvider } from './context/MarketLiveContext.jsx';
import App from './App.jsx';
import './App.css';
import './pages/IPO.css';
import './pages/Home.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <MarketLiveProvider>
      <App />
    </MarketLiveProvider>
  </BrowserRouter>,
);
