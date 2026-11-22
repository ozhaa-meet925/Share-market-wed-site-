export const DEFAULT_WATCHLIST_SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'SBIN', 'ICICIBANK', 'MARUTI', 'BHARTIARTL',
];

export const WATCHLIST_EVENT = 'sharemarket:watchlist-updated';
export const WATCHLIST_LISTS_EVENT = 'sharemarket:watchlists-updated';

const LISTS_STORAGE_KEY = 'sharemarket:watchlists';
const LEGACY_STORAGE_KEY = 'sharemarket:watchlist';
const DEFAULT_LIST_ID = 'default';
const MAX_LISTS = 10;

export const normalizeWatchlistSymbols = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map((item) => String(typeof item === 'string' ? item : item?.symbol || '').trim().toUpperCase())
  .filter(Boolean))];

const createList = (name, symbols = [], id = DEFAULT_LIST_ID) => ({
  id,
  name: String(name || 'Watchlist').trim() || 'Watchlist',
  symbols: normalizeWatchlistSymbols(symbols),
});

const readLegacyStorage = () => {
  try {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved === null ? null : normalizeWatchlistSymbols(JSON.parse(saved));
  } catch {
    return null;
  }
};

const writeLegacySymbols = (symbols) => {
  const normalized = normalizeWatchlistSymbols(symbols);
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable in private mode; the page still works in memory.
  }
  window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT, { detail: normalized }));
  return normalized;
};

const normalizeListsState = (raw) => {
  const lists = (Array.isArray(raw?.lists) ? raw.lists : [])
    .map((list) => createList(list?.name, list?.symbols, String(list?.id || '').trim() || `list-${Date.now().toString(36)}`))
    .slice(0, MAX_LISTS);
  if (!lists.length) return null;
  const activeId = lists.some((list) => list.id === raw?.activeId) ? raw.activeId : lists[0].id;
  return { activeId, lists };
};

export const readWatchlistLists = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(LISTS_STORAGE_KEY) || 'null');
    const saved = normalizeListsState(raw);
    if (saved) return saved;
  } catch {
    // Fall through to the legacy single-list migration.
  }
  const legacy = readLegacyStorage();
  return {
    activeId: DEFAULT_LIST_ID,
    lists: [createList('My Watchlist', legacy ?? DEFAULT_WATCHLIST_SYMBOLS)],
  };
};

const activeListOf = (state) => state.lists.find((list) => list.id === state.activeId) || state.lists[0];

export const getActiveWatchlist = (state = readWatchlistLists()) => activeListOf(state);

const persistLists = (state, { syncLegacy = true } = {}) => {
  try {
    localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the in-memory result usable.
  }
  if (syncLegacy) writeLegacySymbols(activeListOf(state).symbols);
  window.dispatchEvent(new CustomEvent(WATCHLIST_LISTS_EVENT, { detail: state }));
  return state;
};

export const readWatchlistSymbols = () => {
  const state = readWatchlistLists();
  const active = getActiveWatchlist(state);
  const legacy = readLegacyStorage();
  if (legacy && legacy.join(',') !== active.symbols.join(',')) {
    // Another page updated the shared key; adopt it into the active list without
    // dispatching an event from a read path.
    try {
      localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify({
        ...state,
        lists: state.lists.map((list) => (list.id === active.id ? { ...list, symbols: legacy } : list)),
      }));
    } catch {
      // Keep returning the freshly written legacy symbols.
    }
    return legacy;
  }
  return normalizeWatchlistSymbols(active.symbols);
};

export const readLegacyWatchlistSymbols = () => readLegacyStorage();

export const switchWatchlist = (listId) => {
  const state = readWatchlistLists();
  if (!state.lists.some((list) => list.id === listId)) return state;
  return persistLists({ ...state, activeId: listId });
};

export const createWatchlist = (name) => {
  const state = readWatchlistLists();
  if (state.lists.length >= MAX_LISTS) {
    const error = new Error(`You can keep up to ${MAX_LISTS} watchlists. Delete one to create another.`);
    error.code = 'watchlist_limit';
    throw error;
  }
  const base = String(name || '').trim() || `Watchlist ${state.lists.length + 1}`;
  const list = createList(base, [], `list-${Date.now().toString(36)}`);
  return persistLists({ activeId: list.id, lists: [...state.lists, list] });
};

export const renameWatchlist = (listId, name) => {
  const state = readWatchlistLists();
  const cleanName = String(name || '').trim();
  if (!cleanName) return state;
  return persistLists({
    ...state,
    lists: state.lists.map((list) => (list.id === listId ? { ...list, name: cleanName.slice(0, 40) } : list)),
  });
};

export const deleteWatchlist = (listId) => {
  const state = readWatchlistLists();
  if (state.lists.length <= 1) {
    const error = new Error('Keep at least one watchlist.');
    error.code = 'watchlist_minimum';
    throw error;
  }
  const lists = state.lists.filter((list) => list.id !== listId);
  const activeId = state.activeId === listId ? lists[0].id : state.activeId;
  return persistLists({ activeId, lists });
};

export const setActiveWatchlistSymbols = (symbols) => {
  const state = readWatchlistLists();
  const active = activeListOf(state);
  const normalized = normalizeWatchlistSymbols(symbols);
  if (normalized.join(',') === active.symbols.join(',')) return state;
  return persistLists({
    ...state,
    lists: state.lists.map((list) => (list.id === active.id ? { ...list, symbols: normalized } : list)),
  });
};

export const saveActiveWatchlistSymbols = (symbols) => {
  const normalized = normalizeWatchlistSymbols(symbols);
  const state = readWatchlistLists();
  const active = activeListOf(state);
  if (normalized.join(',') === active.symbols.join(',') && readLegacyStorage()?.join(',') === normalized.join(',')) return state;
  return persistLists({
    ...state,
    lists: state.lists.map((list) => (list.id === active.id ? { ...list, symbols: normalized } : list)),
  });
};
