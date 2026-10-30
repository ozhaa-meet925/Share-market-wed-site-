import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const QUOTE_REFRESH_MS = 1000;

export const useCompareQuotes = (symbols) => {
  const symbolsKey = symbols.join(',');
  const [quoteState, setQuoteState] = useState({
    quotes: new Map(),
    provider: 'upstox',
    lastUpdated: null,
    isLoading: true,
    hasError: false,
  });

  useEffect(() => {
    const requestedSymbols = symbolsKey.split(',').filter(Boolean);
    if (!requestedSymbols.length) {
      setQuoteState({ quotes: new Map(), provider: 'upstox', lastUpdated: null, isLoading: false, hasError: false });
      return undefined;
    }

    let active = true;
    let requestPending = false;
    const refresh = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const payload = await marketApi.getBatchQuotes(requestedSymbols);
        if (!active) return;

        const quotes = new Map(
          Object.entries(payload?.quotes || {})
            .map(([symbol, quote]) => [symbol.toUpperCase(), quote])
            .filter(([, quote]) => quote?.isLive === true && Number(quote?.c) > 0),
        );
        setQuoteState({
          quotes,
          provider: payload?.provider || 'upstox',
          lastUpdated: quotes.size ? new Date() : null,
          isLoading: false,
          hasError: false,
        });
      } catch {
        if (!active) return;
        setQuoteState((previous) => ({ ...previous, isLoading: false, hasError: true }));
      } finally {
        requestPending = false;
      }
    };

    refresh();
    const intervalId = window.setInterval(refresh, QUOTE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [symbolsKey]);

  return quoteState;
};
