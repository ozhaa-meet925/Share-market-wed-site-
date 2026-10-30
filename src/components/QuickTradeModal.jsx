import { useState, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, CheckCircle2, Shield, Info, ShoppingBag } from 'lucide-react';
import { placePaperOrder, getPaperState } from '../services/paperTrading';
import { soundEffects } from '../services/sounds';
import CompanyLogo from './CompanyLogo';

export const QuickTradeModal = ({ stock, initialSide = 'Buy', onClose, onOrderPlaced }) => {
  if (!stock) return null;

  const [side, setSide] = useState(initialSide); // 'Buy' | 'Sell'
  const [productType, setProductType] = useState('Delivery'); // 'Delivery' | 'Intraday' (MIS)
  const [orderType, setOrderType] = useState('Market'); // 'Market' | 'Limit'
  const [qty, setQty] = useState(1);
  const [limitPrice, setLimitPrice] = useState(stock.isLive && stock.price ? stock.price.toFixed(2) : '');
  const [statusMessage, setStatusMessage] = useState(null);

  const paperState = getPaperState();
  const currentPrice = stock.isLive === true && Number(stock.price) > 0 ? Number(stock.price) : 0;
  const displayPrice = currentPrice || (stock.isDemo ? Number(stock.price) : 0);
  const executionPrice = orderType === 'Limit' ? (Number(limitPrice) || currentPrice) : currentPrice;
  const quantity = Math.max(1, Number(qty) || 1);
  const totalAmount = Number((quantity * executionPrice).toFixed(2));
  const estimatedCharges = Number((totalAmount * 0.0005 + 20).toFixed(2)); // Brokerage & taxes estimate

  const canAfford = side === 'Sell' || paperState.cash >= totalAmount;

  const handleExecute = (e) => {
    e.preventDefault();
    if ((!currentPrice || stock.isLive !== true) && orderType === 'Market') {
      soundEffects.playOrderCancel();
      setStatusMessage({ type: 'error', text: 'Live market price unavailable for market execution.' });
      return;
    }

    if (side === 'Buy' && paperState.cash < totalAmount) {
      soundEffects.playOrderCancel();
      setStatusMessage({
        type: 'error',
        text: `Insufficient virtual cash balance (₹${paperState.cash.toLocaleString('en-IN')}) for ₹${totalAmount.toLocaleString('en-IN')}.`,
      });
      return;
    }

    const updatedState = placePaperOrder({
      symbol: stock.symbol,
      side,
      qty: quantity,
      price: executionPrice,
      orderType,
      productType,
    });

    soundEffects.playOrderSuccess();
    setStatusMessage({
      type: 'success',
      text: `✓ ${side.toUpperCase()} executed: ${quantity} shares of ${stock.symbol} @ ₹${executionPrice.toLocaleString('en-IN')}!`,
    });

    if (onOrderPlaced) onOrderPlaced(updatedState);

    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <div className="trade-modal-overlay" onClick={onClose}>
      <div className="trade-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="trade-modal-header">
          <div className="trade-modal-stock-info">
            <CompanyLogo symbol={stock.symbol} name={stock.name} size="medium" />
            <div>
              <div className="trade-modal-symbol-row">
                <h3>{stock.symbol}</h3>
                <span className="trade-tag-pill">{stock.sector || 'NSE/BSE'}</span>
              </div>
              <p className="trade-modal-company-name">{stock.name}</p>
            </div>
          </div>
          <button type="button" className="trade-modal-close" onClick={onClose} aria-label="Close trade modal">
            <X size={20} />
          </button>
        </div>

        {/* Live Price Strip */}
        <div className="trade-modal-price-strip">
          <div>
            <span className="label-caption">{stock.isDemo ? 'DEMO PRICE · NOT REAL' : 'CURRENT PRICE'}</span>
            <div className="trade-modal-live-price">
              {displayPrice ? `₹${displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Quote unavailable'}
            </div>
          </div>
          <div className={`trade-price-change ${(stock.change || 0) >= 0 ? 'gain' : 'loss'}`}>
            {stock.isLive ? (stock.change >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />) : null}
            <span>{stock.isLive && stock.change !== null && stock.changePercent !== null
              ? `${stock.change >= 0 ? '+' : ''}${Number(stock.change).toFixed(2)} (${Number(stock.changePercent).toFixed(2)}%)`
              : 'Change unavailable'}</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleExecute} className="trade-modal-body">
          {/* Buy / Sell Selector */}
          <div className="trade-segmented-side">
            <button
              type="button"
              className={`side-btn buy-btn ${side === 'Buy' ? 'active' : ''}`}
              onClick={() => setSide('Buy')}
            >
              BUY / LONG
            </button>
            <button
              type="button"
              className={`side-btn sell-btn ${side === 'Sell' ? 'active' : ''}`}
              onClick={() => setSide('Sell')}
            >
              SELL / SHORT
            </button>
          </div>

          {/* Product Type (Delivery vs Intraday) */}
          <div className="trade-row-split">
            <div className="trade-input-group">
              <label>Product</label>
              <div className="trade-segmented-product">
                <button
                  type="button"
                  className={productType === 'Delivery' ? 'active' : ''}
                  onClick={() => setProductType('Delivery')}
                >
                  Delivery (CNC)
                </button>
                <button
                  type="button"
                  className={productType === 'Intraday' ? 'active' : ''}
                  onClick={() => setProductType('Intraday')}
                >
                  Intraday (MIS)
                </button>
              </div>
            </div>

            <div className="trade-input-group">
              <label>Order Type</label>
              <div className="trade-segmented-product">
                <button
                  type="button"
                  className={orderType === 'Market' ? 'active' : ''}
                  onClick={() => setOrderType('Market')}
                >
                  Market
                </button>
                <button
                  type="button"
                  className={orderType === 'Limit' ? 'active' : ''}
                  onClick={() => setOrderType('Limit')}
                >
                  Limit
                </button>
              </div>
            </div>
          </div>

          {/* Quantity & Price */}
          <div className="trade-row-split">
            <div className="trade-input-group">
              <label htmlFor="order-qty">Quantity (Shares)</label>
              <div className="qty-stepper">
                <button type="button" onClick={() => setQty((q) => Math.max(1, (Number(q) || 1) - 1))}>-</button>
                <input
                  id="order-qty"
                  type="number"
                  min="1"
                  step="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <button type="button" onClick={() => setQty((q) => (Number(q) || 1) + 1)}>+</button>
              </div>
            </div>

            <div className="trade-input-group">
              <label htmlFor="order-price">Execution Price (₹)</label>
              <input
                id="order-price"
                type="number"
                step="0.05"
                min="0.05"
                readOnly={orderType === 'Market'}
                className={orderType === 'Market' ? 'readonly-price' : ''}
                value={orderType === 'Market' ? (currentPrice ? currentPrice.toFixed(2) : 'Market') : limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
              />
            </div>
          </div>

          {/* Financial Calculation Summary */}
          <div className="trade-order-calc-card">
            <div className="calc-row">
              <span>Required Margin / Value</span>
              <strong>₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div className="calc-row sub-row">
              <span>Est. Brokerage & Taxes</span>
              <span>₹{estimatedCharges.toFixed(2)}</span>
            </div>
            <div className="calc-row sub-row">
              <span>Available Virtual Balance</span>
              <span className={canAfford ? 'balance-ok' : 'balance-low'}>
                ₹{paperState.cash.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Feedback status message */}
          {statusMessage && (
            <div className={`trade-feedback-banner ${statusMessage.type}`}>
              {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : <Info size={16} />}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Action button */}
          <button
            type="submit"
            className={`trade-execute-button ${side === 'Buy' ? 'execute-buy' : 'execute-sell'}`}
            disabled={(!canAfford && side === 'Buy') || (!currentPrice && orderType === 'Market')}
          >
            <ShoppingBag size={18} />
            {side === 'Buy' ? `Place Buy Order · ₹${totalAmount.toLocaleString('en-IN')}` : `Place Sell Order · ₹${totalAmount.toLocaleString('en-IN')}`}
          </button>
        </form>

        <div className="trade-modal-footer-note">
          <Shield size={13} />
          <span>{stock.isDemo ? 'Simulated demo price · market execution disabled' : 'Paper Trading Sandbox · No real exchange order is placed'}</span>
        </div>
      </div>
    </div>
  );
};

export default QuickTradeModal;
