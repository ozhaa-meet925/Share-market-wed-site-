import { useCallback, useEffect, useState } from 'react';
import { marketApi } from '../services/api';
import { getCurrentUser } from '../services/auth';

const REFRESH_MS = 1_000;

export const useMetalPaperState = () => {
  const [state, setState] = useState(null);
  const [signedIn, setSignedIn] = useState(() => Boolean(getCurrentUser()));
  const [isLoading, setIsLoading] = useState(() => Boolean(getCurrentUser()));
  const [error, setError] = useState('');

  const applyState = useCallback((payload) => {
    setState(payload);
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    let requestPending = false;

    const refresh = async () => {
      const hasSession = Boolean(getCurrentUser());
      if (active) setSignedIn(hasSession);
      if (!hasSession) {
        if (active) {
          setState(null);
          setIsLoading(false);
          setError('');
        }
        return;
      }
      if (requestPending) return;
      requestPending = true;
      try {
        const payload = await marketApi.getMetalPaperState();
        if (active) applyState(payload);
      } catch (requestError) {
        if (active && requestError.status !== 401) {
          setError(requestError.message || 'The metals paper account is unavailable.');
        }
      } finally {
        requestPending = false;
        if (active) setIsLoading(false);
      }
    };

    const handleSessionChange = () => {
      if (active) setIsLoading(Boolean(getCurrentUser()));
      refresh();
    };

    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener('sharemarket:session-changed', handleSessionChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('sharemarket:session-changed', handleSessionChange);
    };
  }, [applyState]);

  return { state, signedIn, isLoading, error, applyState };
};
