import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const IPO_REFRESH_MS = 30_000;
const IPO_RETRY_MS = 30_000;

const emptyFeed = {
  data: [],
  history: [],
  source: 'unavailable',
  live: false,
  configured: false,
  loading: true,
  lastUpdated: null,
  message: 'Loading live IPO listings…',
};

const nextRefreshDelay = (response) => {
  const serverInterval = Number(response.autoRefreshIntervalMs || response.refreshIntervalMs || IPO_REFRESH_MS * 2);
  if (!Number.isFinite(serverInterval) || serverInterval <= 0) return IPO_REFRESH_MS;
  if (response.stale || response.live === false) return IPO_RETRY_MS;
  return Math.max(20_000, Math.min(60_000, Math.round(serverInterval / 2)));
};

export const useIpoFeed = () => {
  const [feed, setFeed] = useState(emptyFeed);

  useEffect(() => {
    let active = true;
    let requestPending = false;
    let timer = null;

    const scheduleRefresh = (delayMs) => {
      if (!active) return;
      timer = window.setTimeout(refresh, delayMs);
    };

    const refresh = async () => {
      if (!active || requestPending) return;
      requestPending = true;

      try {
        const response = await marketApi.getIpos();
        if (!response?.success || !Array.isArray(response.data)) {
          throw new Error('The IPO provider returned an invalid response.');
        }
        if (active) setFeed({ ...response, loading: false });
        scheduleRefresh(nextRefreshDelay(response));
      } catch (error) {
        if (active) {
          setFeed((current) => {
            const hasLastGoodFeed = current.data.length > 0 || (current.history || []).length > 0;
            return {
              ...current,
              data: hasLastGoodFeed
                ? current.data.map((ipo) => ({ ...ipo, isLive: false, stale: true }))
                : [],
              history: hasLastGoodFeed
                ? (current.history || []).map((ipo) => ({ ...ipo, isLive: false, stale: true }))
                : [],
              source: hasLastGoodFeed ? current.source : 'unavailable',
              live: false,
              stale: hasLastGoodFeed,
              loading: false,
              message: hasLastGoodFeed
                ? 'IPO refresh failed. Showing the last successful provider data.'
                : error.message || 'The live IPO provider could not be reached.',
            };
          });
          scheduleRefresh(IPO_RETRY_MS);
        }
      } finally {
        requestPending = false;
      }
    };

    refresh();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return feed;
};
