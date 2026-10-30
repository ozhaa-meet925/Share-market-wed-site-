import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const LIVE_REFRESH_MS = 1000;
const RESEARCH_REFRESH_MS = 60_000;

export const useCatalogQuotes = (stocks) => {
  const [quotes, setQuotes] = useState(new Map());
  const [histories, setHistories] = useState(new Map());
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [providerState, setProviderState] = useState('checking');
  const [setupMessage, setSetupMessage] = useState('');
  const [quoteError, setQuoteError] = useState('');

  useEffect(() => {
    let active = true;
    let enabled = false;
    let requestPending = false;

    const refresh = async () => {
      if (!enabled || !stocks.length || requestPending) return;
      requestPending = true;
      try {
        const payload = await marketApi.getBatchQuotes(stocks.map((stock) => (
          stock.exchange === 'BSE' ? `BSE:${stock.symbol}` : stock.symbol
        )));
        if (!active) return;
        const liveQuotes = new Map(
          Object.entries(payload?.quotes || {})
            .map(([symbol, quote]) => [String(quote?.symbol || symbol).replace(/^(NSE|BSE):/i, '').toUpperCase(), quote])
            .filter(([, quote]) => (
              quote?.isLive === true || quote?.isResearch === true
            ) && Number(quote.c) > 0),
        );
        setQuotes((previous) => {
          const next = new Map(previous);
          for (const stock of stocks) {
            const symbol = stock.symbol.toUpperCase();
            const fresh = liveQuotes.get(symbol);
            if (fresh) {
              const previousQuote = previous.get(symbol);
              const previousPrice = Number(previousQuote?.c);
              const currentPrice = Number(fresh.c);
              const moved = previousPrice > 0 && currentPrice !== previousPrice;
              const shouldFlash = fresh.isLive === true;
              const direction = moved
                ? currentPrice > previousPrice ? 'up' : 'down'
                : previousQuote?.lastTick || null;

              next.set(symbol, {
                ...fresh,
                lastTick: shouldFlash ? direction : null,
                flash: shouldFlash && moved ? direction : null,
              });
            } else if (next.has(symbol)) {
              next.set(symbol, {
                ...next.get(symbol),
                isLive: false,
                isDemo: false,
                isStale: true,
                flash: null,
                lastTick: null,
              });
            }
          }
          return next;
        });
        if (liveQuotes.size) setLastUpdated(new Date());
        setQuoteError('');
        setIsLoading(false);
      } catch (error) {
        if (active) {
          setQuotes((previous) => new Map([...previous].map(([symbol, quote]) => [symbol, {
            ...quote,
            isLive: false,
            isDemo: false,
            isStale: true,
            flash: null,
            lastTick: null,
          }])));
          setQuoteError(error.message || 'The live quote request failed.');
          setIsLoading(false);
        }
      } finally {
        requestPending = false;
      }
    };

    let intervalId;
    marketApi.getHealth()
      .then((health) => {
        if (!active) return;
        const researchNote = health.researchDataAvailable
          ? ' Yahoo Finance research quotes may be delayed and are not live.'
          : '';
        setSetupMessage(`${health.setupRequired || 'Configure a live market provider to load current prices.'}${researchNote}`);
        if (!health.realTimeAvailable && !health.researchDataAvailable) {
          setProviderState('unavailable');
          setIsLoading(false);
          return;
        }
        setProviderState(health.realTimeAvailable ? 'ready' : 'research');
        enabled = true;
        refresh();
        intervalId = window.setInterval(refresh, health.realTimeAvailable ? LIVE_REFRESH_MS : RESEARCH_REFRESH_MS);
      })
      .catch((error) => {
        if (!active) return;
        setProviderState('unavailable');
        setSetupMessage(error.message || 'The market API is unavailable.');
        setIsLoading(false);
      });

    return () => {
      active = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [stocks]);

  return { quotes, histories, lastUpdated, isLoading, providerState, setupMessage, quoteError };
};
