import { useEffect } from 'react';
import {
  fetchPaperState,
  fetchWatchlist,
  getCurrentUser,
  refreshSession,
  savePaperState,
  saveWatchlist,
} from '../services/auth';
import { applyPaperState, getPaperState, PAPER_STATE_EVENT } from '../services/paperTrading';
import { normalizeWatchlistSymbols, readWatchlistSymbols } from '../utils/watchlist';

const applyRemoteWatchlist = (symbols) => {
  localStorage.setItem('sharemarket:watchlist', JSON.stringify(symbols));
  window.dispatchEvent(new CustomEvent('sharemarket:watchlist-updated', { detail: symbols }));
};

const useAccountSync = () => {
  useEffect(() => {
    let active = true;
    let watchlistTimer = null;
    let paperTimer = null;
    let applyingRemote = false;

    const syncWatchlist = async (user) => {
      if (!user) return;
      try {
        const payload = await fetchWatchlist();
        if (!active) return;
        const remote = normalizeWatchlistSymbols(payload?.symbols);
        if (remote.length) {
          applyingRemote = true;
          applyRemoteWatchlist(remote);
          applyingRemote = false;
        } else {
          const local = readWatchlistSymbols();
          if (local.length) await saveWatchlist(local);
        }
      } catch {
        // Offline or signed out mid-sync: keep the local watchlist usable.
      }
    };

    const syncPaperState = async (user) => {
      if (!user) return;
      try {
        const payload = await fetchPaperState();
        if (!active) return;
        if (payload?.state) {
          applyingRemote = true;
          applyPaperState(payload.state);
          applyingRemote = false;
        } else {
          await savePaperState(getPaperState());
        }
      } catch {
        // Keep local paper trading state when the sync request fails.
      }
    };

    const syncAccount = (user) => {
      syncWatchlist(user);
      syncPaperState(user);
    };

    refreshSession().then((user) => {
      if (active) syncAccount(user);
    });

    const handleSessionChange = (event) => {
      syncAccount(event?.detail || getCurrentUser());
    };

    const pushWatchlist = (symbols) => {
      if (applyingRemote || !getCurrentUser()) return;
      clearTimeout(watchlistTimer);
      watchlistTimer = setTimeout(() => {
        saveWatchlist(normalizeWatchlistSymbols(symbols)).catch(() => {});
      }, 700);
    };

    const handleWatchlistUpdate = (event) => {
      pushWatchlist(event?.detail ?? readWatchlistSymbols());
    };

    const handlePaperUpdate = () => {
      if (applyingRemote || !getCurrentUser()) return;
      clearTimeout(paperTimer);
      paperTimer = setTimeout(() => {
        savePaperState(getPaperState()).catch(() => {});
      }, 700);
    };

    const handleStorage = (event) => {
      if (event.key === 'sharemarket:watchlist') pushWatchlist(readWatchlistSymbols());
      if (event.key === 'share-market-paper-state') handlePaperUpdate();
    };

    window.addEventListener('sharemarket:session-changed', handleSessionChange);
    window.addEventListener('sharemarket:watchlist-updated', handleWatchlistUpdate);
    window.addEventListener(PAPER_STATE_EVENT, handlePaperUpdate);
    window.addEventListener('storage', handleStorage);

    return () => {
      active = false;
      clearTimeout(watchlistTimer);
      clearTimeout(paperTimer);
      window.removeEventListener('sharemarket:session-changed', handleSessionChange);
      window.removeEventListener('sharemarket:watchlist-updated', handleWatchlistUpdate);
      window.removeEventListener(PAPER_STATE_EVENT, handlePaperUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);
};

export default useAccountSync;
