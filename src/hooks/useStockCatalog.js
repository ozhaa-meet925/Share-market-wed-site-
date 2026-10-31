import { useEffect, useState, useCallback } from 'react';
import { stocks as seededStocks } from '../data/stocks';
import { companyCatalog } from '../data/companyCatalog';
import { marketApi } from '../services/api';

export function getCustomStocks() {
  try {
    const saved = localStorage.getItem('sharemarket:custom_stocks');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveCustomStock(stock) {
  try {
    const list = getCustomStocks();
    const updated = [stock, ...list.filter((s) => s.symbol !== stock.symbol)];
    localStorage.setItem('sharemarket:custom_stocks', JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('sharemarket:catalog-updated', { detail: stock }));
    return updated;
  } catch {
    return [];
  }
}

function detectSector(symbol, name) {
  const sym = symbol.toUpperCase();
  const desc = name.toUpperCase();

  if (sym.includes('BANK') || sym.includes('SBIN') || sym.includes('PNB') || sym.includes('CANBK') || sym === 'YESBANK') return 'Banking';
  if (sym.includes('TCS') || sym.includes('INFY') || sym.includes('WIPRO') || sym.includes('TECHM') || sym.includes('HCL') || sym.includes('ELXSI')) return 'IT';
  if (sym.includes('AUTO') || sym.includes('MOT') || sym.includes('MARUTI') || sym.includes('M&M') || sym.includes('HYUNDAI') || sym.includes('TVS') || sym.includes('TMPV') || sym.includes('TMCV')) return 'Auto';
  if (sym.includes('PHARMA') || sym.includes('CIPLA') || sym.includes('REDDY') || sym.includes('DIVIS') || sym.includes('HOSP') || sym.includes('HEALTH') || sym.includes('TORNT')) return 'Pharma';
  if (sym.includes('POWER') || sym.includes('GREEN') || sym.includes('NTPC') || sym.includes('ONGC') || sym.includes('BPCL') || sym.includes('IOC') || sym.includes('ENERGY') || sym.includes('RELIANCE')) return 'Energy';
  if (sym.includes('FIN') || sym.includes('LIFE') || sym.includes('CAP') || sym.includes('INVEST') || sym.includes('CHOLA')) return 'Financial Services';
  if (sym.includes('STEEL') || sym.includes('COAL') || sym.includes('HINDALCO') || sym.includes('ZINC') || sym.includes('MET')) return 'Metals';
  if (sym.includes('AERO') || sym.includes('HAL') || sym.includes('BEL') || sym.includes('SIEMENS') || sym.includes('ABB') || sym === 'LT') return 'Defense & Engineering';
  if (sym.includes('TEL') || sym.includes('COMM') || sym.includes('AIRTEL')) return 'Telecom';
  if (sym.includes('CONSUM') || sym.includes('FMCG') || sym.includes('INDUNILVR') || sym.includes('NESTLE') || sym.includes('ITC') || sym.includes('DMART') || sym.includes('TITAN') || sym.includes('TRENT') || sym.includes('VBL') || sym.includes('ETERNAL')) return 'FMCG';

  if (desc.includes('BANK')) return 'Banking';
  if (desc.includes('MOTORS') || desc.includes('AUTO')) return 'Auto';
  if (desc.includes('HEALTH') || desc.includes('LAB') || desc.includes('PHARM')) return 'Pharma';
  if (desc.includes('POWER') || desc.includes('ENERGY') || desc.includes('OIL') || desc.includes('GAS')) return 'Energy';
  if (desc.includes('STEEL') || desc.includes('MINING') || desc.includes('COAL')) return 'Metals';
  if (desc.includes('TECHNOLOGIES') || desc.includes('CONSULTANCY') || desc.includes('SOFTWARE')) return 'IT';

  return 'Diversified';
}

const clearCurrentQuote = (stock) => ({
  ...stock,
  price: null,
  previousClose: null,
  change: null,
  changePercent: null,
  high: null,
  low: null,
  week52High: null,
  week52Low: null,
  volume: null,
  history: [],
  isLive: false,
  isDemo: false,
  isStale: false,
  dataSource: 'Live quote required',
});

const toCatalogStock = (item) => {
  const rawSymbol = String(item.symbol || item.displaySymbol || '');
  const exchangePrefix = rawSymbol.match(/^(NSE|BSE):/i)?.[1];
  const symbol = rawSymbol.replace(/^(NSE|BSE):/i, '');
  const exchange = String(item.exchange || exchangePrefix || 'NSE').toUpperCase();
  const seeded = seededStocks.find((stock) => stock.symbol === symbol);
  return clearCurrentQuote({
    ...(seeded || createCatalogStock(symbol, item.description || item.name || item.displaySymbol || symbol)),
    exchange,
  });
};

const baseCatalog = companyCatalog.map(toCatalogStock);

export function createCatalogStock(symbol, name, customSector = null) {
  return {
    symbol,
    exchange: 'NSE',
    name,
    sector: customSector || detectSector(symbol, name),
    price: null,
    change: null,
    changePercent: null,
    previousClose: null,
    high: null,
    low: null,
    week52High: null,
    week52Low: null,
    volume: null,
    history: [],
    isLive: false,
    isDemo: false,
    isStale: false,
    dataSource: 'Live quote required',
  };
}

export const useStockCatalog = () => {
  const [catalog, setCatalog] = useState(() => mergeCatalog(baseCatalog));
  const [isLiveCatalog, setIsLiveCatalog] = useState(false);

  // Listen to custom stock added events
  useEffect(() => {
    const handleCatalogUpdated = (event) => {
      if (event?.detail) {
        setCatalog((prev) => mergeCatalog([event.detail, ...prev]));
      }
    };
    window.addEventListener('sharemarket:catalog-updated', handleCatalogUpdated);
    return () => window.removeEventListener('sharemarket:catalog-updated', handleCatalogUpdated);
  }, []);

  useEffect(() => {
    let active = true;

    // First try the backend API, or directly load /all_companies.json (5700+ companies)
    fetch('/all_companies.json')
      .then((res) => (res.ok ? res.json() : marketApi.getStockCatalog()))
      .then((items) => {
        if (!Array.isArray(items)) return;
        const normalized = mergeCatalog(items.map(toCatalogStock));
        if (active && normalized.length) {
          setCatalog(normalized);
          setIsLiveCatalog(true);
        }
      })
      .catch(() => {
        if (active) setIsLiveCatalog(true);
      });

    return () => { active = false; };
  }, []);

  const addStock = useCallback((newStock) => {
    saveCustomStock(newStock);
    setCatalog((prev) => mergeCatalog([newStock, ...prev]));
  }, []);

  return { catalog, isLiveCatalog, addStock };
};

function mergeCatalog(items = []) {
  const custom = getCustomStocks();
  const unique = new Map();
  [...custom, ...items, ...baseCatalog, ...seededStocks].map(clearCurrentQuote).forEach((stock) => {
    if (stock && stock.symbol && !unique.has(stock.symbol)) {
      unique.set(stock.symbol, stock);
    }
  });
  return [...unique.values()];
}
