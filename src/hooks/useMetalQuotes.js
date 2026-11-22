import { useEffect, useState } from 'react';
import { metals } from '../data/metals';
import { marketApi } from '../services/api';

const REFRESH_MS = 1_000;

const isVerifiedMetalQuote = (quote) => (
  Number(quote?.c) > 0
  && (quote?.isLive === true || quote?.isResearch === true || quote?.isReal === true)
);

export const useMetalQuotes = () => {
  const [quotes, setQuotes] = useState(() => new Map());
  const [spotReferences, setSpotReferences] = useState(() => new Map());
  const [fx, setFx] = useState(null);
  const [market, setMarket] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let requestPending = false;
    let intervalId;

    const refresh = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const payload = await marketApi.getMetalsOverview();
        if (!active) return;
        const fresh = new Map();
        const freshSpotReferences = new Map();
        for (const metal of metals) {
          const quote = payload?.quotes?.[metal.symbol];
          const spot = payload?.spotReferences?.[metal.symbol];
          if (isVerifiedMetalQuote(quote)) fresh.set(metal.symbol, quote);
          if (isVerifiedMetalQuote(spot)) freshSpotReferences.set(metal.symbol, spot);
        }
        setSpotReferences(freshSpotReferences);
        setFx(payload?.fx || null);
        setMarket(payload?.market || null);
        setQuotes((previous) => {
          const next = new Map(previous);
          for (const [symbol, quote] of next) {
            if (fresh.has(symbol)) continue;
            next.set(symbol, { ...quote, isStale: true });
          }
          for (const [symbol, quote] of fresh) next.set(symbol, quote);
          return next;
        });
        if (fresh.size) {
          setLastUpdated(new Date());
          setError('');
        } else {
          setError('The metals feed returned no verified price.');
        }
      } catch (requestError) {
        if (!active) return;
        setError(requestError.message || 'The metals feed is unavailable.');
        setQuotes((previous) => new Map([...previous].map(([symbol, quote]) => [symbol, {
          ...quote,
          isStale: true,
        }])));
      } finally {
        requestPending = false;
        if (active) setIsLoading(false);
      }
    };

    refresh();
    intervalId = window.setInterval(refresh, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return { quotes, spotReferences, fx, market, isLoading, lastUpdated, error };
};
