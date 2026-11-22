const STORAGE_KEY = 'share-market-paper-state';
export const PAPER_STATE_EVENT = 'sharemarket:paper-state-updated';

export const starterOrders = [
  { id: 'ORD-1024', date: '18 Sep', symbol: 'RELIANCE', side: 'Buy', qty: 5, price: 2920.4, status: 'Executed' },
  { id: 'ORD-1025', date: '18 Sep', symbol: 'TCS', side: 'Sell', qty: 2, price: 4152, status: 'Pending' },
  { id: 'ORD-1026', date: '19 Sep', symbol: 'SBIN', side: 'Buy', qty: 10, price: 810.2, status: 'Executed' },
];

export const starterPositions = [
  { symbol: 'RELIANCE', qty: 12, avgBuyPrice: 2698.5 },
  { symbol: 'HDFCBANK', qty: 40, avgBuyPrice: 1621.0 },
  { symbol: 'INFY', qty: 25, avgBuyPrice: 1565.2 },
  { symbol: 'SBIN', qty: 35, avgBuyPrice: 773.4 },
  { symbol: 'TCS', qty: 6, avgBuyPrice: 4080.0 },
  { symbol: 'BHARTIARTL', qty: 30, avgBuyPrice: 1620.0 },
];

const initialState = {
  cash: 500000,
  positions: starterPositions,
  orders: starterOrders,
  transactions: [
    { id: 'TXN-5001', date: '18 Sep', type: 'Credit', note: 'Virtual cash added', amount: 500000 },
    { id: 'TXN-5002', date: '18 Sep', type: 'Debit', note: 'RELIANCE paper buy', amount: -14602 },
  ],
};

const normalizePositions = (positions) => {
  const merged = new Map();
  for (const position of Array.isArray(positions) ? positions : []) {
    const symbol = String(position?.symbol || '').trim().toUpperCase();
    const qty = Number(position?.qty);
    const avgBuyPrice = Number(position?.avgBuyPrice);
    if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(avgBuyPrice) || avgBuyPrice <= 0) continue;
    const existing = merged.get(symbol);
    if (existing) {
      const totalQty = existing.qty + qty;
      merged.set(symbol, {
        symbol,
        qty: totalQty,
        avgBuyPrice: Number(((existing.qty * existing.avgBuyPrice + qty * avgBuyPrice) / totalQty).toFixed(4)),
      });
    } else {
      merged.set(symbol, { symbol, qty, avgBuyPrice });
    }
  }
  return [...merged.values()];
};

export const getPaperPositions = (state) => normalizePositions(state?.positions);

export const getHoldingQuantity = (state, symbol) => {
  const wanted = String(symbol || '').trim().toUpperCase();
  return getPaperPositions(state).find((position) => position.symbol === wanted)?.qty || 0;
};

const updatePositions = (positions, order) => {
  const next = positions.map((position) => ({ ...position }));
  const index = next.findIndex((position) => position.symbol === order.symbol);

  if (order.side === 'Buy') {
    if (index === -1) {
      next.push({ symbol: order.symbol, qty: order.qty, avgBuyPrice: order.price });
    } else {
      const existing = next[index];
      const totalQty = existing.qty + order.qty;
      next[index] = {
        ...existing,
        qty: totalQty,
        avgBuyPrice: Number(((existing.qty * existing.avgBuyPrice + order.qty * order.price) / totalQty).toFixed(4)),
      };
    }
    return next;
  }

  if (index !== -1) {
    const remaining = next[index].qty - order.qty;
    if (remaining > 0) next[index] = { ...next[index], qty: remaining };
    else next.splice(index, 1);
  }
  return next;
};

export const getPaperState = () => {
  if (typeof window === 'undefined') return initialState;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return initialState;

  try {
    const parsed = JSON.parse(saved);
    return { ...initialState, ...parsed, positions: normalizePositions(parsed?.positions ?? initialState.positions) };
  } catch {
    return initialState;
  }
};

export const savePaperState = (state) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(PAPER_STATE_EVENT, { detail: state }));
  }
  return state;
};

export const applyPaperState = (state) => savePaperState({
  ...initialState,
  ...state,
  positions: normalizePositions(state?.positions ?? initialState.positions),
});

export const placePaperOrder = ({ symbol, side, qty, price, orderType = 'Market', isDemoPrice = false, quantityUnit = 'share' }) => {
  const current = getPaperState();
  const unitName = quantityUnit === 'share' ? 'share' : quantityUnit;
  const unitPlural = quantityUnit === 'share' ? 'shares' : quantityUnit;
  const quantity = Math.max(1, Number(qty) || 1);
  const orderValue = Number((quantity * price).toFixed(2));
  const signedAmount = side === 'Buy' ? -orderValue : orderValue;
  const status = orderType === 'Limit' ? 'Pending' : 'Executed';
  const executed = status === 'Executed';
  const id = `ORD-${Date.now().toString().slice(-6)}`;
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const order = {
    id,
    date,
    symbol,
    side,
    qty: quantity,
    price,
    orderType,
    isDemoPrice,
    status,
  };

  if (executed && side === 'Buy' && current.cash < orderValue) {
    const error = new Error(`Not enough virtual cash. Available ₹${current.cash.toLocaleString('en-IN')}.`);
    error.code = 'insufficient_cash';
    throw error;
  }

  if (executed && side === 'Sell') {
    const held = getHoldingQuantity(current, symbol);
    if (held < quantity) {
      const error = new Error(held > 0
        ? `You hold ${held} ${held === 1 ? unitName : unitPlural} of ${symbol}. You can sell up to ${held}.`
        : `You do not hold any ${symbol} to sell.`);
      error.code = 'insufficient_holdings';
      throw error;
    }
  }

  const transaction = {
    id: `TXN-${Date.now().toString().slice(-6)}`,
    date,
    type: side === 'Buy' ? 'Debit' : 'Credit',
    note: `${symbol} paper ${side.toLowerCase()}`,
    amount: signedAmount,
  };

  return savePaperState({
    cash: executed ? Number((current.cash + signedAmount).toFixed(2)) : current.cash,
    positions: executed ? updatePositions(getPaperPositions(current), order) : getPaperPositions(current),
    orders: [order, ...current.orders],
    transactions: executed ? [transaction, ...current.transactions] : current.transactions,
  });
};

export const resetPaperTrading = () => savePaperState(initialState);
