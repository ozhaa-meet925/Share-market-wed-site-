import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const LIVE_REFRESH_MS = 5000;
const RESEARCH_REFRESH_MS = 60_000;

export const useMarketIndices = (symbols) => {
  const symbolsKey = [...new Set(symbols.filter(Boolean))].join(',');
  const [quotes, setQuotes] = useState(new Map());
  const [histories, setHistories] = useState(new Map());
  const [lastUpdated, setLastUpdated] = useState(null);

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
              quote?.isLive === true || quote?.isReal === true || quote?.isResearch === true
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
        if (fresh.size) {
          setHistories((previous) => {
            const next = new Map(previous);
            for (const [symbol, quote] of fresh) {
              const history = next.get(symbol) || [];
              const price = Number(quote.c);
              if (history.at(-1) !== price) {
                next.set(symbol, [...history.slice(-59), price]);
              }
            }
            return next;
          });
          setLastUpdated(new Date());
        }
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
        const refreshMs = health.realTimeAvailable ? LIVE_REFRESH_MS : RESEARCH_REFRESH_MS;
        intervalId = window.setInterval(refresh, refreshMs);
      } catch {
        // Keep the market page readable when the provider health endpoint is unavailable.
      }
    };

    start();
    return () => {
      active = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [symbolsKey]);

  return { quotes, histories, lastUpdated };
};
