import { useEffect, useRef, useState } from 'react';
import { marketApi } from '../services/api';

const DEFAULT_REFRESH_MS = 5000;
const RESEARCH_REFRESH_MS = 60_000;
const roundPrice = (value) => Number(Number(value).toFixed(2));

const waitingForQuote = (stock) => ({
  ...stock,
  price: null,
  previousClose: null,
  change: null,
  changePercent: null,
  high: null,
  low: null,
  history: [],
  lastTick: null,
  flash: null,
  isLive: false,
  isResearch: false,
  isDemo: false,
  marketOpen: false,
  isStale: false,
  dataSource: 'Waiting for a market quote',
});

export const useLiveStocks = (initialStocks, refreshMs = DEFAULT_REFRESH_MS) => {
  const [liveStocks, setLiveStocks] = useState(() => initialStocks.map(waitingForQuote));
  const [lastUpdated, setLastUpdated] = useState(null);
  const stocksRef = useRef(liveStocks);
  stocksRef.current = liveStocks;

  useEffect(() => {
    let active = true;
    let intervalId;
    let requestPending = false;

    const refresh = async () => {
      if (requestPending) return;
      requestPending = true;
      const symbols = stocksRef.current.map((stock) => stock.symbol);
      try {
        const payload = await marketApi.getBatchQuotes(symbols);
        if (!active) return;
        const quoteMap = new Map(
          Object.entries(payload?.quotes || {}).map(([symbol, quote]) => [symbol.toUpperCase(), quote]),
        );
        const foundDisplayQuote = [...quoteMap.values()].some(
          (quote) => Number(quote?.c) > 0 && (quote?.isLive === true || quote?.isResearch === true),
        );
        setLiveStocks((current) => current.map((stock) => {
          const quote = quoteMap.get(stock.symbol);
          const hasLiveQuote = Number(quote?.c) > 0 && quote?.isLive === true;
          const hasResearchQuote = Number(quote?.c) > 0 && quote?.isResearch === true;
          if (!hasLiveQuote && !hasResearchQuote) {
            return stock.isLive || stock.isResearch
              ? {
                ...stock,
                isLive: false,
                isResearch: stock.isResearch,
                isDemo: false,
                isStale: true,
                flash: null,
                lastTick: null,
                dataSource: `${quote?.provider || 'Market provider'} quote · refresh failed`,
              }
              : stock;
          }

          const isResearch = !hasLiveQuote && hasResearchQuote;
          const price = roundPrice(quote.c);
          const previousClose = Number(quote.pc) > 0 ? Number(quote.pc) : null;
          const change = quote.d !== null && quote.d !== undefined && Number.isFinite(Number(quote.d))
            ? roundPrice(quote.d)
            : null;
          const changePercent = quote.dp !== null && quote.dp !== undefined && Number.isFinite(Number(quote.dp))
            ? Number(quote.dp)
            : null;
          const direction = isResearch || stock.price === null || price === stock.price
            ? stock.lastTick
            : price > stock.price ? 'up' : 'down';
          const history = stock.history || [];
          const nextHistory = history.at(-1) === price ? history : [...history.slice(-59), price];
          const marketOpen = quote.marketOpen === true;
          const shouldFlash = hasLiveQuote;

          return {
            ...stock,
            price,
            previousClose,
            change,
            changePercent,
            high: Number(quote.h) > 0 ? Number(quote.h) : null,
            low: Number(quote.l) > 0 ? Number(quote.l) : null,
            history: nextHistory,
            lastTick: shouldFlash ? direction : null,
            flash: shouldFlash && stock.price !== null && price !== stock.price ? direction : null,
            isLive: hasLiveQuote,
            isResearch,
            isDemo: false,
            marketOpen,
            isStale: quote.isStale === true,
            dataSource: isResearch
              ? `${quote.provider || 'Yahoo Finance research feed'} research quote · not live`
              : `${quote.provider || 'Market provider'} live quote`,
            quoteUpdatedAt: quote.timestamp || new Date().toISOString(),
          };
        }));
        if (foundDisplayQuote) setLastUpdated(new Date());
      } catch {
        if (!active) return;
        setLiveStocks((current) => current.map((stock) => (
          stock.isLive || stock.isResearch
            ? {
              ...stock,
              isLive: false,
              isResearch: stock.isResearch,
              isDemo: false,
              isStale: true,
              flash: null,
              lastTick: null,
              dataSource: `${stock.dataSource} · refresh failed`,
            }
            : stock
        )));
      } finally {
        requestPending = false;
      }
    };

    const start = async () => {
      try {
        const health = await marketApi.getHealth();
        if (!active) return;
        if (!health.realTimeAvailable && !health.researchDataAvailable) {
          setLiveStocks((current) => current.map((stock) => ({ ...stock, dataSource: health.setupRequired || 'Connect a live market provider' })));
          return;
        }
        refresh();
        intervalId = window.setInterval(refresh, health.realTimeAvailable ? refreshMs : Math.max(refreshMs, RESEARCH_REFRESH_MS));
      } catch {
        if (active) setLiveStocks((current) => current.map((stock) => ({ ...stock, dataSource: 'Live provider unavailable' })));
      }
    };

    start();
    return () => {
      active = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [initialStocks, refreshMs]);

  return { stocks: liveStocks, lastUpdated };
};
