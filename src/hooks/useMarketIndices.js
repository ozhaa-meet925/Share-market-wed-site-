import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const REFRESH_MS = 1000;

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
    const refresh = async () => {
      if (requestPending) return;
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

    refresh();
    const intervalId = window.setInterval(refresh, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [symbolsKey]);

  return { quotes, histories, lastUpdated };
};
