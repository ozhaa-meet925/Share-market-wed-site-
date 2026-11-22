import { useState } from 'react';
import { X, CheckCircle2, Shield, Info, ShoppingBag } from 'lucide-react';
import { getHoldingQuantity, placePaperOrder, getPaperState } from '../services/paperTrading';
import { soundEffects } from '../services/sounds';
import CompanyLogo from './CompanyLogo';
import { TickArrow, priceDirection, signedChange, signedPercent, tickToneClass, useTickFlash } from './PriceChange';
import { estimateOrderCharges } from '../utils/indianCharges';

export const QuickTradeModal = ({ stock, initialSide = 'Buy', onClose, onOrderPlaced }) => {
  const tickPrice = Number(stock?.price) > 0 ? Number(stock.price) : null;
  const { flash: tickFlash } = useTickFlash(tickPrice, stock?.changePercent);

  const [side, setSide] = useState(initialSide); // 'Buy' | 'Sell'
  const [productType, setProductType] = useState('Delivery'); // 'Delivery' | 'Intraday' (MIS)
  const [orderType, setOrderType] = useState('Market'); // 'Market' | 'Limit'
  const [qty, setQty] = useState(1);
  const [limitPrice, setLimitPrice] = useState(stock?.isLive && stock?.price ? Number(stock.price).toFixed(2) : '');
  const [statusMessage, setStatusMessage] = useState(null);

  if (!stock) return null;

  const paperState = getPaperState();
  const currentPrice = stock.isLive === true && Number(stock.price) > 0 ? Number(stock.price) : 0;
  const tradingEnabled = currentPrice > 0;
  const disabledReason = stock.isResearch
    ? 'Trading is disabled: this is a delayed Yahoo Finance research quote, not a live price.'
    : stock.isStale
      ? 'Trading is disabled: the last provider quote is stale.'
      : 'Trading is disabled until a live market provider quote is available.';
  const priceCaption = stock.isDemo
    ? 'DEMO PRICE · NOT REAL'
    : stock.isLive
      ? 'CURRENT PRICE · LIVE'
      : stock.isResearch
        ? 'RESEARCH QUOTE · DELAYED, NOT LIVE'
        : stock.isStale
          ? 'LAST QUOTE · STALE'
          : 'QUOTE UNAVAILABLE';
  const displayPrice = Number(stock.price) > 0 ? Number(stock.price) : 0;
  const hasChangeValue = stock.change !== null && stock.change !== undefined
    && stock.changePercent !== null && stock.changePercent !== undefined
    && Number.isFinite(Number(stock.changePercent));
  const direction = priceDirection(stock.change, stock.changePercent, tickFlash, stock.lastTick);
  const priceTone = displayPrice ? tickToneClass(direction, tickFlash) : '';
  const executionPrice = orderType === 'Limit' ? (Number(limitPrice) || currentPrice) : currentPrice;
  const quantity = Math.max(1, Number(qty) || 1);
  const totalAmount = Number((quantity * executionPrice).toFixed(2));
  const chargeEstimate = estimateOrderCharges(side.toUpperCase(), totalAmount,
    productType === 'Intraday' ? 'intraday' : 'delivery');

  const canAfford = side === 'Sell' || paperState.cash >= totalAmount;
  const heldQty = getHoldingQuantity(paperState, stock.symbol);
  const canSell = heldQty >= quantity;

  const handleExecute = (e) => {
    e.preventDefault();
    if (!tradingEnabled) {
      soundEffects.playOrderCancel();
      setStatusMessage({ type: 'error', text: disabledReason });
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

    if (side === 'Sell' && heldQty < quantity) {
      soundEffects.playOrderCancel();
      setStatusMessage({
        type: 'error',
        text: heldQty > 0
          ? `You hold ${heldQty} ${stock.symbol} share${heldQty === 1 ? '' : 's'}. You can sell up to ${heldQty}.`
          : `You do not hold any ${stock.symbol} shares to sell.`,
      });
      return;
    }

    let updatedState;
    try {
      updatedState = placePaperOrder({
        symbol: stock.symbol,
        side,
        qty: quantity,
        price: executionPrice,
        orderType,
        productType,
      });
    } catch (error) {
      soundEffects.playOrderCancel();
      setStatusMessage({ type: 'error', text: error.message });
      return;
    }

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
            <CompanyLogo symbol={stock.symbol} name={stock.name} size={44} />
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
            <span className="label-caption">{priceCaption}</span>
            <div key={tickFlash ? `${stock.symbol}-${tickFlash}` : 'steady'} className={`trade-modal-live-price ${priceTone}`}>
              {displayPrice ? `₹${displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Quote unavailable'}
            </div>
          </div>
          <div className={`trade-price-change ${direction === 'up' ? 'gain' : direction === 'down' ? 'loss' : 'price-flat'}`}>
            {displayPrice ? <TickArrow direction={direction} /> : null}
            <span>{displayPrice && hasChangeValue
              ? `${signedChange(stock.change)} (${signedPercent(stock.changePercent)})`
              : 'Change unavailable'}</span>
          </div>
        </div>

        {/* Form */}
        {!tradingEnabled && (
          <div className="trade-feedback-banner error trade-disabled-banner" role="status">
            <Info size={16} />
            <span>{disabledReason}</span>
          </div>
        )}
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
              SELL
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
              <span>Est. Brokerage &amp; Taxes ({chargeEstimate?.product === 'intraday' ? 'intraday' : 'delivery'})</span>
              <span>{chargeEstimate ? `₹${chargeEstimate.total.toFixed(2)}` : '—'}</span>
            </div>
            {chargeEstimate ? (
              <div className="calc-breakdown">
                {[
                  ['Brokerage', chargeEstimate.brokerage],
                  ['Exchange turnover', chargeEstimate.exchangeTurnover],
                  ['SEBI + stamp', chargeEstimate.sebi + chargeEstimate.stampDuty],
                  ['STT', chargeEstimate.stt],
                  ['GST', chargeEstimate.gst],
                ].map(([label, value]) => (
                  <div className="calc-break-row" key={label}>
                    <span>{label}</span>
                    <span>₹{value.toFixed(2)}</span>
                  </div>
                ))}
                <p className="calc-break-note">Modelled from the published statutory + discount-broker schedule; the executing broker&apos;s slab is the final debit.</p>
              </div>
            ) : null}
            <div className="calc-row sub-row">
              <span>Available Virtual Balance</span>
              <span className={canAfford ? 'balance-ok' : 'balance-low'}>
                ₹{paperState.cash.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            {side === 'Sell' && (
              <div className="calc-row sub-row">
                <span>Shares held</span>
                <span className={canSell ? 'balance-ok' : 'balance-low'}>
                  {heldQty} {stock.symbol}
                </span>
              </div>
            )}
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
            disabled={!tradingEnabled || (!canAfford && side === 'Buy') || (side === 'Sell' && !canSell)}
          >
            <ShoppingBag size={18} />
            {side === 'Buy' ? `Place Buy Order · ₹${totalAmount.toLocaleString('en-IN')}` : `Place Sell Order · ₹${totalAmount.toLocaleString('en-IN')}`}
          </button>
        </form>

        <div className="trade-modal-footer-note">
          <Shield size={13} />
          <span>{stock.isDemo ? 'Simulated demo price · market execution disabled' : tradingEnabled ? 'Paper Trading Sandbox · No real exchange order is placed' : 'Paper trading paused · live market quote required'}</span>
        </div>
      </div>
    </div>
  );
};

export default QuickTradeModal;
