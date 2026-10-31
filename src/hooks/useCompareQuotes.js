import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const QUOTE_REFRESH_MS = 5000;

export const useCompareQuotes = (symbols) => {
  const symbolsKey = symbols.join(',');
  const [quoteState, setQuoteState] = useState({
    quotes: new Map(),
    provider: 'upstox',
    lastUpdated: null,
    isLoading: true,
    hasError: false,
    setupMessage: '',
  });

  useEffect(() => {
    const requestedSymbols = symbolsKey.split(',').filter(Boolean);
    if (!requestedSymbols.length) {
      setQuoteState({ quotes: new Map(), provider: 'upstox', lastUpdated: null, isLoading: false, hasError: false, setupMessage: '' });
      return undefined;
    }

    let active = true;
    let requestPending = false;
    let intervalId;
    let configuredProvider = 'Market provider';
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
          provider: payload?.provider || configuredProvider,
          lastUpdated: quotes.size ? new Date() : null,
          isLoading: false,
          hasError: false,
          setupMessage: '',
        });
      } catch (error) {
        if (!active) return;
        setQuoteState((previous) => ({
          ...previous,
          isLoading: false,
          hasError: true,
          setupMessage: error.message || 'The configured market provider could not return quotes.',
        }));
      } finally {
        requestPending = false;
      }
    };

    const start = async () => {
      try {
        const health = await marketApi.getHealth();
        if (!active) return;
        configuredProvider = health.configuredProvider || health.provider || configuredProvider;
        if (!health.realTimeAvailable) {
          setQuoteState({
            quotes: new Map(),
            provider: configuredProvider,
            lastUpdated: null,
            isLoading: false,
            hasError: false,
            setupMessage: health.setupRequired || 'Configure a live market provider to compare current prices.',
          });
          return;
        }

        setQuoteState((previous) => ({ ...previous, provider: configuredProvider, setupMessage: '' }));
        refresh();
        intervalId = window.setInterval(refresh, QUOTE_REFRESH_MS);
      } catch (error) {
        if (!active) return;
        setQuoteState((previous) => ({
          ...previous,
          isLoading: false,
          hasError: true,
          setupMessage: error.message || 'The market API is unavailable.',
        }));
      }
    };

    start();
    return () => {
      active = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [symbolsKey]);

  return quoteState;
};
