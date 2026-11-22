import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { normalizeWatchlistSymbols, readWatchlistSymbols } from '../utils/watchlist';

const MetalWatchlistButton = ({ symbol, name }) => {
  const [watched, setWatched] = useState(() => readWatchlistSymbols().includes(symbol));

  useEffect(() => {
    const sync = () => setWatched(readWatchlistSymbols().includes(symbol));
    window.addEventListener('sharemarket:watchlist-updated', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('sharemarket:watchlist-updated', sync);
      window.removeEventListener('storage', sync);
    };
  }, [symbol]);

  const toggle = () => {
    const current = readWatchlistSymbols();
    const next = normalizeWatchlistSymbols(
      current.includes(symbol)
        ? current.filter((item) => item !== symbol)
        : [...current, symbol],
    );
    localStorage.setItem('sharemarket:watchlist', JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('sharemarket:watchlist-updated', { detail: next }));
    setWatched(next.includes(symbol));
  };

  return (
    <button
      type="button"
      className={`secondary-button metal-watchlist-button ${watched ? 'is-watched' : ''}`}
      onClick={toggle}
      aria-pressed={watched}
      title={watched ? `Remove ${name} from watchlist` : `Add ${name} to watchlist`}
    >
      <Star size={15} fill={watched ? 'currentColor' : 'none'} />
      {watched ? 'In Watchlist' : 'Add to Watchlist'}
    </button>
  );
};

export default MetalWatchlistButton;
