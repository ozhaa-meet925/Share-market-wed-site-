import { useCallback, useEffect, useState } from 'react';
import { marketApi } from '../services/api';
import { getStockCardHistory } from '../services/stockHistory';

const LIVE_REFRESH_MS = 1000;
const RESEARCH_REFRESH_MS = 1_500;
const INDEX_REFRESH_MS = 1_000;
const HISTORICAL_INDEX_SYMBOLS = new Set(['NIFTY', 'SENSEX', 'BANKNIFTY', 'NIFTYIT', 'NIFTYMIDCAP']);
const HISTORICAL_COMMODITY_SYMBOLS = new Set(['CRUDEOIL', 'NATURALGAS', 'COPPER', 'ALUMINIUM', 'ZINC']);

export const useMarketIndices = (symbols) => {
  const symbolsKey = [...new Set(symbols.filter(Boolean))].join(',');
  const [quotes, setQuotes] = useState(new Map());
  const [histories, setHistories] = useState(new Map());
  const [historyMeta, setHistoryMeta] = useState(new Map());
  const [lastUpdated, setLastUpdated] = useState(null);
  const [historyRetryKey, setHistoryRetryKey] = useState(0);
  const retryHistory = useCallback(() => setHistoryRetryKey((current) => current + 1), []);

  useEffect(() => {
    const historySymbols = [...new Set(symbolsKey.split(',')
      .map((symbol) => symbol.replace(/^(NSE|BSE|MCX|GLOBAL):/i, '').toUpperCase())
      .filter((symbol) => HISTORICAL_INDEX_SYMBOLS.has(symbol) || HISTORICAL_COMMODITY_SYMBOLS.has(symbol)))];
    if (!historySymbols.length) return undefined;

    let active = true;
    setHistoryMeta((previous) => {
      const next = new Map(previous);
      historySymbols.forEach((symbol) => next.set(symbol, { status: 'loading', error: '' }));
      return next;
    });

    Promise.all(historySymbols.map(async (symbol) => {
      try {
        const result = await getStockCardHistory(symbol, 'NSE');
        if (!active) return;
        const candles = Array.isArray(result?.candles) ? result.candles : [];
        setHistories((previous) => new Map(previous).set(symbol, candles));
        setHistoryMeta((previous) => new Map(previous).set(symbol, {
          status: candles.length >= 2 ? 'ready' : 'unavailable',
          error: candles.length >= 2 ? '' : 'The history provider returned no verified candles for this range.',
          provider: result?.provider || '',
          isResearch: result?.isResearch === true,
        }));
      } catch (error) {
        if (!active) return;
        setHistoryMeta((previous) => new Map(previous).set(symbol, {
          status: 'error',
          error: error.message || 'The history provider could not return this index range.',
        }));
      }
    }));

    return () => { active = false; };
  }, [historyRetryKey, symbolsKey]);

  useEffect(() => {
    const requestedSymbols = symbolsKey.split(',').filter(Boolean);
    if (!requestedSymbols.length) return undefined;

    let active = true;
    let requestPending = false;
    let intervalId;
    let quotesEnabled = false;
    const refresh = async () => {
      if (!quotesEnabled || requestPending) return;
      requestPending = true;
      try {
        const payload = await marketApi.getBatchQuotes(requestedSymbols);
        if (!active) return;
        const fresh = new Map(
          Object.entries(payload?.quotes || {})
            .map(([symbol, quote]) => [symbol.toUpperCase(), quote])
            .filter(([, quote]) => (
              quote?.isLive === true || quote?.isReal === true || quote?.isResearch === true || quote?.isClose === true
            ) && Number(quote.c) > 0),
        );
        setQuotes((previous) => {
          const next = new Map(previous);
          for (const rawSymbol of requestedSymbols) {
            const symbol = rawSymbol.replace(/^(NSE|BSE|MCX|GLOBAL):/i, '').toUpperCase();
            const quote = fresh.get(symbol);
            if (quote) next.set(symbol, quote);
            else if (next.has(symbol)) next.set(symbol, { ...next.get(symbol), isLive: false, isStale: true });
          }
          return next;
        });
        if (fresh.size) setLastUpdated(new Date());
      } catch {
        if (active) setQuotes((previous) => new Map([...previous].map(([symbol, quote]) => [symbol, { ...quote, isLive: false, isStale: true }])));
      } finally {
        requestPending = false;
      }
    };

    const start = async () => {
      try {
        const health = await marketApi.getHealth();
        if (!active) return;

        const hasCommodityFallback = requestedSymbols.some((symbol) => /^(MCX:)?(GOLD|SILVER|COPPER)$/i.test(symbol));
        if (!health.realTimeAvailable && !health.researchDataAvailable && !hasCommodityFallback) return;

        quotesEnabled = true;
        refresh();
        const hasIndexSymbol = requestedSymbols
          .some((symbol) => HISTORICAL_INDEX_SYMBOLS.has(symbol.replace(/^(NSE|BSE|MCX|GLOBAL):/i, '').toUpperCase()));
        const refreshMs = hasCommodityFallback
          ? 1000
          : health.realTimeAvailable
            ? LIVE_REFRESH_MS
            : hasIndexSymbol ? INDEX_REFRESH_MS : RESEARCH_REFRESH_MS;
        intervalId = window.setInterval(refresh, refreshMs);
      } catch {
        // Keep the market page readable when the provider health endpoint is unavailable.
      }
    };

    start();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [symbolsKey]);

  return { quotes, histories, historyMeta, lastUpdated, retryHistory };
};
