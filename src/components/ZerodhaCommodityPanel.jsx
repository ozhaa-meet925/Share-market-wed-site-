import { useState, useMemo } from 'react';
import { ShoppingCart, ShieldCheck, Zap, Info, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { getPaperState, savePaperState } from '../services/paperTrading';
import './ZerodhaCommodityPanel.css';

const CONTRACT_SPECS = {
  GOLD: [
    { id: 'GOLD', name: 'GOLD (Standard)', unit: '1 Kg', multiplier: 100, lotQty: 1, marginPercent: 9, description: '100 units of 10g (Main Institutional Lot)' },
    { id: 'GOLDM', name: 'GOLDM (Mini)', unit: '100 Grams', multiplier: 10, lotQty: 1, marginPercent: 9, description: '10 units of 10g (Retail Favorite)' },
    { id: 'GOLDGUINEA', name: 'GOLDGUINEA', unit: '8 Grams', multiplier: 0.8, lotQty: 1, marginPercent: 9, description: '8 Grams sovereign weight' },
    { id: 'GOLDPETAL', name: 'GOLDPETAL', unit: '1 Gram', multiplier: 0.1, lotQty: 1, marginPercent: 9, description: '1 Gram micro contract' },
  ],
  SILVER: [
    { id: 'SILVER', name: 'SILVER (Standard)', unit: '30 Kg', multiplier: 30, lotQty: 1, marginPercent: 11, description: '30 Kg primary MCX contract' },
    { id: 'SILVERM', name: 'SILVERM (Mini)', unit: '5 Kg', multiplier: 5, lotQty: 1, marginPercent: 11, description: '5 Kg popular swing lot' },
    { id: 'SILVERMIC', name: 'SILVERMIC (Micro)', unit: '1 Kg', multiplier: 1, lotQty: 1, marginPercent: 11, description: '1 Kg retail entry contract' },
  ],
};

const ZerodhaCommodityPanel = ({ metal = 'GOLD', currentPrice = 76500 }) => {
  const metalKey = metal.toUpperCase().includes('SILVER') ? 'SILVER' : 'GOLD';
  const contracts = CONTRACT_SPECS[metalKey];

  const [selectedContract, setSelectedContract] = useState(contracts[1] || contracts[0]); // default to Mini
  const [productType, setProductType] = useState('NRML'); // 'NRML' (Overnight) or 'MIS' (Intraday)
  const [orderType, setOrderType] = useState('MARKET'); // 'MARKET', 'LIMIT', 'SL', 'GTT'
  const [lots, setLots] = useState(1);
  const [customPrice, setCustomPrice] = useState(currentPrice);
  const [triggerPrice, setTriggerPrice] = useState(Math.round(currentPrice * 0.98));
  const [orderSide, setOrderSide] = useState('BUY'); // 'BUY' or 'SELL'
  const [orderStatus, setOrderStatus] = useState(null);

  // Zerodha Margin Calculations
  const calculations = useMemo(() => {
    const priceToUse = orderType === 'LIMIT' ? Number(customPrice) || currentPrice : currentPrice;
    const contractValue = priceToUse * selectedContract.multiplier * Number(lots);
    
    // MIS gives 40% margin discount over NRML in Zerodha
    const baseMarginRate = selectedContract.marginPercent / 100;
    const effectiveRate = productType === 'MIS' ? baseMarginRate * 0.6 : baseMarginRate;
    const marginRequired = Math.round(contractValue * effectiveRate);
    const leverage = Math.round(1 / effectiveRate);

    return {
      priceToUse,
      contractValue,
      marginRequired,
      leverage,
      brokerage: 20, // Zerodha flat ₹20 per executed order
      exchangeCharges: Math.round(contractValue * 0.000026 * 100) / 100,
      gst: 3.60,
    };
  }, [currentPrice, selectedContract, productType, orderType, customPrice, lots]);

  const handleExecute = (e) => {
    e.preventDefault();
    const newOrderId = `MCX-${Date.now().toString(36).toUpperCase()}`;
    const executedOrder = {
      success: true,
      time: new Date().toLocaleTimeString('en-IN'),
      orderId: newOrderId,
      side: orderSide,
      contract: selectedContract.id,
      lots,
      price: calculations.priceToUse,
      product: productType,
      type: orderType,
      marginUsed: calculations.marginRequired,
    };

    setOrderStatus(executedOrder);

    // Synchronize into Global Orders Book (paper trading)
    try {
      const currentPaper = getPaperState();
      const orderEntry = {
        id: newOrderId,
        symbol: `MCX:${selectedContract.id}`,
        side: orderSide === 'BUY' ? 'Buy' : 'Sell',
        orderType: orderType,
        product: productType,
        qty: lots,
        price: calculations.priceToUse,
        totalValue: calculations.contractValue,
        marginUsed: calculations.marginRequired,
        status: orderType === 'LIMIT' || orderType === 'GTT' || orderType === 'SL' ? 'Pending' : 'Executed',
        date: new Date().toLocaleString('en-IN'),
        isCommodity: true,
      };

      const updatedOrders = [orderEntry, ...(currentPaper.orders || [])];
      savePaperState({
        ...currentPaper,
        orders: updatedOrders,
      });
    } catch (err) {
      console.warn('Could not sync to paper trade book:', err.message);
    }
  };

  return (
    <div className="zerodha-commodity-panel">
      {/* Panel Top Header */}
      <div className="z-panel-header">
        <div className="z-header-left">
          <div className="z-brand-badge">ZERODHA KITE STYLE</div>
          <h3>MCX {metalKey} Futures &amp; Options Desk</h3>
          <span className="z-sub-info">Exchange: MCX · Tick Size: ₹1.00 · Session: 09:00 - 23:30 IST</span>
        </div>
        <div className="z-live-quote">
          <span className="z-quote-label">Current MCX Reference</span>
          <strong className="z-quote-val">₹{currentPrice.toLocaleString('en-IN')}{metalKey === 'GOLD' ? ' / 10g' : ' / Kg'}</strong>
        </div>
      </div>

      {/* Contract Selector Tabs (Standard, Mini, Micro) */}
      <div className="z-contract-selector">
        <span className="z-selector-label">Contract:</span>
        <div className="z-contract-tabs">
          {contracts.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`z-contract-tab ${selectedContract.id === c.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedContract(c);
                setOrderStatus(null);
              }}
            >
              <strong>{c.id}</strong>
              <small>{c.unit}</small>
            </button>
          ))}
        </div>
      </div>

      {/* Order Side Toggle (BUY / SELL) */}
      <div className="z-side-tabs">
        <button
          type="button"
          className={`z-side-btn z-buy ${orderSide === 'BUY' ? 'active' : ''}`}
          onClick={() => setOrderSide('BUY')}
        >
          BUY (LONG)
        </button>
        <button
          type="button"
          className={`z-side-btn z-sell ${orderSide === 'SELL' ? 'active' : ''}`}
          onClick={() => setOrderSide('SELL')}
        >
          SELL (SHORT)
        </button>
      </div>

      <form onSubmit={handleExecute} className="z-order-form">
        {/* Product Type (MIS vs NRML) */}
        <div className="z-form-group">
          <label className="z-group-label">Product Type</label>
          <div className="z-radio-row">
            <label className={`z-radio-pill ${productType === 'MIS' ? 'active' : ''}`}>
              <input
                type="radio"
                name="productType"
                value="MIS"
                checked={productType === 'MIS'}
                onChange={() => setProductType('MIS')}
              />
              <strong>MIS</strong>
              <span>Intraday (Square-off 23:15)</span>
            </label>

            <label className={`z-radio-pill ${productType === 'NRML' ? 'active' : ''}`}>
              <input
                type="radio"
                name="productType"
                value="NRML"
                checked={productType === 'NRML'}
                onChange={() => setProductType('NRML')}
              />
              <strong>NRML</strong>
              <span>Overnight (Hold till Expiry)</span>
            </label>
          </div>
        </div>

        {/* Order Type (MARKET, LIMIT, SL, GTT) */}
        <div className="z-form-group">
          <label className="z-group-label">Order Type</label>
          <div className="z-type-pills">
            {['MARKET', 'LIMIT', 'SL', 'GTT'].map((t) => (
              <button
                key={t}
                type="button"
                className={`z-pill ${orderType === t ? 'active' : ''}`}
                onClick={() => setOrderType(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Inputs Grid */}
        <div className="z-inputs-grid">
          <div className="z-input-cell">
            <label>Lots (Multiplier: {selectedContract.multiplier})</label>
            <div className="z-number-box">
              <button type="button" onClick={() => setLots(Math.max(1, lots - 1))}>-</button>
              <input
                type="number"
                min="1"
                max="50"
                value={lots}
                onChange={(e) => setLots(Math.max(1, Number(e.target.value) || 1))}
              />
              <button type="button" onClick={() => setLots(lots + 1)}>+</button>
            </div>
            <small className="z-cell-hint">{selectedContract.unit} × {lots}</small>
          </div>

          <div className="z-input-cell">
            <label>Price (₹)</label>
            <input
              type="number"
              step="1"
              disabled={orderType === 'MARKET'}
              value={orderType === 'MARKET' ? currentPrice : customPrice}
              onChange={(e) => setCustomPrice(Number(e.target.value))}
              className={orderType === 'MARKET' ? 'disabled' : ''}
            />
            <small className="z-cell-hint">{orderType === 'MARKET' ? 'Market Execution' : 'Limit Target'}</small>
          </div>

          {(orderType === 'SL' || orderType === 'GTT') && (
            <div className="z-input-cell highlight">
              <label>Trigger Price (₹)</label>
              <input
                type="number"
                step="1"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(Number(e.target.value))}
              />
              <small className="z-cell-hint">Trigger activation point</small>
            </div>
          )}
        </div>

        {/* Live Margin Calculation Summary */}
        <div className="z-margin-summary-box">
          <div className="z-margin-row">
            <span>Contract Turnover Value:</span>
            <strong>₹{calculations.contractValue.toLocaleString('en-IN')}</strong>
          </div>
          <div className="z-margin-row highlight">
            <span>Margin Required ({productType}):</span>
            <strong className="z-margin-val">₹{calculations.marginRequired.toLocaleString('en-IN')}</strong>
          </div>
          <div className="z-margin-breakdown">
            <span>Brokerage: Flat ₹{calculations.brokerage}</span> · 
            <span>Exch Turn: ₹{calculations.exchangeCharges}</span> · 
            <span>Leverage: ~{calculations.leverage}x</span>
          </div>
        </div>

        {/* Submit Execution Button */}
        <button
          type="submit"
          className={`z-submit-btn ${orderSide === 'BUY' ? 'z-buy-btn' : 'z-sell-btn'}`}
        >
          {orderSide} {lots} Lot ({selectedContract.id}) @ {orderType}
        </button>
      </form>

      {/* Instant Order Confirmation Notification */}
      {orderStatus && (
        <div className="z-order-toast">
          <div className="z-toast-header">
            <CheckCircle2 size={18} color="#16a34a" />
            <strong>Order Placed Successfully! (Zerodha MCX Paper Mode)</strong>
          </div>
          <p>
            {orderStatus.side} {orderStatus.lots} Lot of <b>{orderStatus.contract}</b> filled at ₹{orderStatus.price.toLocaleString('en-IN')} ({orderStatus.product} · {orderStatus.type}).
          </p>
          <div className="z-toast-meta">
            <span>Order ID: {orderStatus.orderId}</span>
            <span>Margin Utilized: ₹{orderStatus.marginUsed.toLocaleString('en-IN')}</span>
            <span>Time: {orderStatus.time}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZerodhaCommodityPanel;
