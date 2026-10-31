import { useCallback, useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const APPLICATION_REFRESH_MS = 30_000;

export const useIpoApplications = (enabled = true) => {
  const [state, setState] = useState({
    connected: false,
    configured: false,
    loading: false,
    orders: [],
    error: '',
    lastUpdated: null,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let requestPending = false;

    const refresh = async () => {
      if (requestPending) return;
      requestPending = true;
      setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        const auth = await marketApi.getIpoAuthStatus();
        if (!active) return;
        if (!auth.connected) {
          setState({
            connected: false,
            configured: auth.configured,
            loading: false,
            orders: [],
            error: auth.configured
              ? ''
              : 'Secure Upstox OAuth credentials are required to enable applications and account tracking.',
            lastUpdated: null,
          });
          return;
        }
        const response = await marketApi.getIpoOrders();
        if (active) {
          setState({
            connected: true,
            configured: true,
            loading: false,
            orders: Array.isArray(response.data) ? response.data : [],
            error: '',
            lastUpdated: response.lastUpdated || new Date().toISOString(),
          });
        }
      } catch (error) {
        if (active) {
          setState((current) => ({
            ...current,
            connected: error.status === 401 ? false : current.connected,
            orders: error.status === 401 ? [] : current.orders,
            loading: false,
            error: error.message || 'Could not refresh IPO application tracking.',
          }));
        }
      } finally {
        requestPending = false;
      }
    };

    refresh();
    const interval = window.setInterval(refresh, APPLICATION_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [enabled]);

  const disconnect = useCallback(async () => {
    await marketApi.disconnectIpoBroker();
    setState((current) => ({
      ...current,
      connected: false,
      orders: [],
      error: '',
    }));
  }, []);

  return { ...state, disconnect };
};
