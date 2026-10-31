import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const IPO_REFRESH_MS = 30_000; // refresh every 30 seconds

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

export const useIpoFeed = () => {
  const [feed, setFeed] = useState(emptyFeed);

  useEffect(() => {
    let active = true;
    let requestPending = false;

    const refresh = async () => {
      if (requestPending) return;
      requestPending = true;

      try {
        const response = await marketApi.getIpos();
        if (!response?.success || !Array.isArray(response.data)) {
          throw new Error('The IPO provider returned an invalid response.');
        }
        if (active) setFeed({ ...response, loading: false });
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
        }
      } finally {
        requestPending = false;
      }
    };

    refresh();
    const interval = window.setInterval(refresh, IPO_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return feed;
};
