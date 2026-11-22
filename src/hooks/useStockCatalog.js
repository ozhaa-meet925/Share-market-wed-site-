import { useEffect, useState, useCallback } from 'react';
import { stocks as seededStocks } from '../data/stocks';
import { metalCatalogStocks } from '../data/metals';
import { companyCatalog } from '../data/companyCatalog';
import { marketApi } from '../services/api';
import { detectSector } from '../utils/sector';

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
  vwap: null,
  marketCap: null,
  pe: null,
  eps: null,
  dividendYield: null,
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
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState('');

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
    const loadCatalog = async () => {
      try {
        let items = [];
        try {
          const response = await fetch('/all_companies.json');
          if (response.ok) {
            const publicCatalog = await response.json();
            if (Array.isArray(publicCatalog)) items = publicCatalog;
          }
        } catch {
          // The API catalog remains available if the static directory cannot be read.
        }
        if (!items.length) items = await marketApi.getStockCatalog();
        if (!Array.isArray(items) || !items.length) throw new Error('The company directory returned no listed companies.');

        const normalized = mergeCatalog(items.map(toCatalogStock));
        if (!normalized.length) throw new Error('The company directory could not be normalized.');
        if (active) {
          setCatalog(normalized);
          setCatalogError('');
        }
      } catch (error) {
        if (active) setCatalogError(error.message || 'The company directory could not be loaded.');
      } finally {
        if (active) {
          setIsLiveCatalog(true);
          setIsLoadingCatalog(false);
        }
      }
    };
    loadCatalog();

    return () => { active = false; };
  }, []);

  const addStock = useCallback((newStock) => {
    saveCustomStock(newStock);
    setCatalog((prev) => mergeCatalog([newStock, ...prev]));
  }, []);

  return { catalog, isLiveCatalog, isLoadingCatalog, catalogError, addStock };
};

function mergeCatalog(items = []) {
  const custom = getCustomStocks();
  const unique = new Map();
  [...custom, ...metalCatalogStocks, ...items, ...baseCatalog, ...seededStocks].map(clearCurrentQuote).forEach((stock) => {
    if (stock && stock.symbol && !unique.has(stock.symbol)) {
      unique.set(stock.symbol, stock);
    }
  });
  return [...unique.values()];
}
