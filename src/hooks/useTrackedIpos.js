import { useCallback, useEffect, useState } from 'react';

const TRACKED_IPOS_KEY = 'sharemarket-tracked-ipos-v1';

const readTrackedIpos = () => {
  try {
    const value = JSON.parse(window.localStorage.getItem(TRACKED_IPOS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item?.id === 'string') : [];
  } catch {
    return [];
  }
};

const trackedSnapshotFields = [
  'company', 'symbol', 'status', 'segment', 'priceBand', 'minimumPrice', 'maximumPrice', 'lotSize', 'issueSize', 'minInvestment',
  'openDate', 'closeDate', 'allotmentDate', 'listingDate', 'subscription', 'gmp',
  'gmpValue', 'retailFormatted', 'qibFormatted', 'totalApplications', 'financials', 'listingPrice',
  'listingGainPercent', 'gainFromIssuePercent', 'industry', 'competitors', 'rating', 'recommendation',
];

export const useTrackedIpos = () => {
  const [trackedIpos, setTrackedIpos] = useState(readTrackedIpos);

  useEffect(() => {
    const sync = (event) => {
      if (event.key === TRACKED_IPOS_KEY) setTrackedIpos(readTrackedIpos());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const toggleTrackedIpo = useCallback((ipo) => {
    if (!ipo?.id) return;
    setTrackedIpos((current) => {
      const next = current.some((item) => item.id === ipo.id)
        ? current.filter((item) => item.id !== ipo.id)
        : [...current, {
          id: ipo.id,
          ...Object.fromEntries(trackedSnapshotFields
            .filter((field) => ipo[field] !== undefined && ipo[field] !== null)
            .map((field) => [field, ipo[field]])),
        }];
      window.localStorage.setItem(TRACKED_IPOS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isTracked = useCallback(
    (ipoId) => trackedIpos.some((item) => item.id === ipoId),
    [trackedIpos],
  );

  return { trackedIpos, toggleTrackedIpo, isTracked };
};
