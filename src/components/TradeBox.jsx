import { useMemo, useState } from 'react';
import { placePaperOrder } from '../services/paperTrading';
import { soundEffects } from '../services/sounds';

const TradeBox = ({ stock }) => {
  const hasPrice = stock.isLive === true && Number.isFinite(stock.price) && stock.price > 0;
  const tradingEnabled = hasPrice;
  const disabledReason = stock.isResearch
    ? 'Trading is disabled: quotes come from the Yahoo Finance research feed, which is delayed and not live.'
    : stock.isStale
      ? 'Trading is disabled: the last provider quote is stale.'
      : 'Trading is disabled until a live market provider quote is available.';
  const [side, setSide] = useState('Buy');
  const [orderType, setOrderType] = useState('Market');
  const [qty, setQty] = useState(1);
  const [limitPrice, setLimitPrice] = useState(hasPrice ? stock.price : '');
  const [message, setMessage] = useState('');
  const executionPrice = orderType === 'Limit' ? Number(limitPrice) || 0 : hasPrice ? stock.price : 0;
  const total = useMemo(() => Math.max(1, Number(qty) || 1) * executionPrice, [executionPrice, qty]);
  const submitOrder = () => {
    if (!tradingEnabled) {
      soundEffects.playOrderCancel();
      setMessage(disabledReason);
      return;
    }
    let state;
    try {
      state = placePaperOrder({ symbol: stock.symbol, side, qty, price: executionPrice, orderType });
    } catch (error) {
      soundEffects.playOrderCancel();
      setMessage(error.message);
      return;
    }
    soundEffects.playOrderSuccess();
    setMessage(`✓ ${side} order executed! Virtual cash: Rs ${state.cash.toLocaleString('en-IN')}`);
  };

  return (
    <section className="trade-box">
      <span className="paper-note">Paper trading only. No real exchange order is placed.</span>
      {!tradingEnabled ? <p className="paper-note trade-disabled-note" role="status">{disabledReason}</p> : null}
      <div className="segmented">
        {['Buy', 'Sell'].map((option) => (
          <button
            className={side === option ? 'active' : ''}
            key={option}
            onClick={() => setSide(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <label>
        Order type
        <select value={orderType} onChange={(event) => setOrderType(event.target.value)}>
          <option>Market</option>
          <option>Limit</option>
        </select>
      </label>
      <label>
        Quantity
        <input min="1" type="number" value={qty} onChange={(event) => setQty(event.target.value)} />
      </label>
      <label>
        Price
        <input type={orderType === 'Limit' ? 'number' : 'text'} min="0.01" step="0.01" readOnly={orderType === 'Market'} value={orderType === 'Limit' ? limitPrice : (hasPrice ? `Rs ${stock.price.toLocaleString('en-IN')}` : stock.isDemo ? `Demo only · Rs ${Number(stock.price).toLocaleString('en-IN')}` : 'Quote unavailable')} onChange={(event) => setLimitPrice(event.target.value)} />
      </label>
      <div className="order-value">
        <span>Estimated Value</span>
        <strong>Rs {total.toLocaleString('en-IN')}</strong>
      </div>
      <button className="primary-button" type="button" onClick={submitOrder} disabled={!tradingEnabled}>{side} {stock.symbol}</button>
      {message ? <p className={message.startsWith('✓') ? 'success-message' : 'error-message'} role="status">{message}</p> : null}
    </section>
  );
};

export default TradeBox;
