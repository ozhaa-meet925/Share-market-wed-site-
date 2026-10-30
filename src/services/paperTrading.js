const STORAGE_KEY = 'share-market-paper-state';

export const starterOrders = [
  { id: 'ORD-1024', date: '18 Sep', symbol: 'RELIANCE', side: 'Buy', qty: 5, price: 2920.4, status: 'Executed' },
  { id: 'ORD-1025', date: '18 Sep', symbol: 'TCS', side: 'Sell', qty: 2, price: 4152, status: 'Pending' },
  { id: 'ORD-1026', date: '19 Sep', symbol: 'SBIN', side: 'Buy', qty: 10, price: 810.2, status: 'Executed' },
];

const initialState = {
  cash: 500000,
  orders: starterOrders,
  transactions: [
    { id: 'TXN-5001', date: '18 Sep', type: 'Credit', note: 'Virtual cash added', amount: 500000 },
    { id: 'TXN-5002', date: '18 Sep', type: 'Debit', note: 'RELIANCE paper buy', amount: -14602 },
  ],
};

export const getPaperState = () => {
  if (typeof window === 'undefined') return initialState;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return initialState;

  try {
    return { ...initialState, ...JSON.parse(saved) };
  } catch {
    return initialState;
  }
};

const savePaperState = (state) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  return state;
};

export const placePaperOrder = ({ symbol, side, qty, price, orderType = 'Market', isDemoPrice = false }) => {
  const current = getPaperState();
  const quantity = Math.max(1, Number(qty) || 1);
  const orderValue = Number((quantity * price).toFixed(2));
  const signedAmount = side === 'Buy' ? -orderValue : orderValue;
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
    status: orderType === 'Limit' ? 'Pending' : 'Executed',
  };
  const transaction = {
    id: `TXN-${Date.now().toString().slice(-6)}`,
    date,
    type: side === 'Buy' ? 'Debit' : 'Credit',
    note: `${symbol} paper ${side.toLowerCase()}`,
    amount: signedAmount,
  };

  return savePaperState({
    cash: Number((current.cash + signedAmount).toFixed(2)),
    orders: [order, ...current.orders],
    transactions: [transaction, ...current.transactions],
  });
};

export const resetPaperTrading = () => savePaperState(initialState);
