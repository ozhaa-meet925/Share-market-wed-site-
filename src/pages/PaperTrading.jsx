import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, RotateCcw, Activity } from 'lucide-react';
import { stocks as stockSeed } from '../data/stocks';
import { useLiveStocks } from '../hooks/useLiveStocks';
import { getHoldingQuantity, getPaperState, placePaperOrder, resetPaperTrading, PAPER_STATE_EVENT } from '../services/paperTrading';
import { soundEffects } from '../services/sounds';

const PaperTrading = () => {
  const { stocks: liveStocks, lastUpdated } = useLiveStocks(stockSeed, 3000);
  const [state, setState] = useState(getPaperState);
  const [symbol, setSymbol] = useState(stockSeed[0].symbol);
  const [side, setSide] = useState('Buy');
  const [qty, setQty] = useState(1);
  const [orderError, setOrderError] = useState('');

  useEffect(() => {
    const refresh = () => setState(getPaperState());
    window.addEventListener(PAPER_STATE_EVENT, refresh);
    return () => window.removeEventListener(PAPER_STATE_EVENT, refresh);
  }, []);

  useEffect(() => {
    setOrderError('');
  }, [symbol, side, qty]);

  const heldQty = getHoldingQuantity(state, symbol);

  const selectedStock = liveStocks.find((stock) => stock.symbol === symbol) || liveStocks[0];
  const hasCurrentQuote = selectedStock.isLive && Number(selectedStock.price) > 0;
  const hasDemoPrice = selectedStock.isDemo && Number(selectedStock.price) > 0;
  const hasResearchQuote = !hasCurrentQuote && !hasDemoPrice && Number(selectedStock.price) > 0
    && (selectedStock.isResearch === true || selectedStock.isDelayed === true);
  const hasUsableQuote = hasCurrentQuote || hasDemoPrice;
  const priceLabel = (stock) => {
    if (!(Number(stock.price) > 0)) return 'Quote unavailable';
    if (stock.isLive) return `₹${stock.price.toFixed(2)}`;
    if (stock.isDemo) return `₹${stock.price.toFixed(2)} · DEMO`;
    if (stock.isResearch || stock.isDelayed) return `₹${stock.price.toFixed(2)} · delayed`;
    return 'Quote unavailable';
  };
  const orderValue = useMemo(
    () => hasUsableQuote ? selectedStock.price * Math.max(1, Number(qty) || 1) : null,
    [hasUsableQuote, qty, selectedStock.price],
  );

  const submit = () => {
    if (!hasUsableQuote) return;
    try {
      setState(placePaperOrder({ symbol, side, qty, price: selectedStock.price, isDemoPrice: hasDemoPrice }));
      setOrderError('');
      soundEffects.playOrderSuccess();
    } catch (error) {
      setOrderError(error.message);
      soundEffects.playOrderCancel();
    }
  };

  const reset = () => {
    setState(resetPaperTrading());
    soundEffects.playOrderCancel();
  };

  const changeIsPositive = Number(selectedStock.change) >= 0;
  const quoteStatus = hasCurrentQuote
    ? `${selectedStock.dataSource || 'Current provider quote'}${lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}`
    : hasDemoPrice
      ? `Simulated demo price · ${selectedStock.marketOpen ? 'updates 09:00–16:00 IST' : 'session closed'} · virtual practice only`
      : selectedStock.dataSource || 'Waiting for live quote';

  return (
    <div className="page paper-trading-page">
      <header className="paper-trading-header">
        <div className="page-title paper-title">
          <span>MARKET SIMULATOR</span>
          <h1>Paper Trading</h1>
          <p>Practice your strategy with virtual cash and live market quotes.</p>
        </div>
        <div className="paper-simulation-badge"><span /> Virtual account</div>
      </header>

      <p className="paper-note paper-ai-note">
        Testing the AI agent? Its virtual trades run in a separate paper account on the
        {' '}<Link to="/ai-trading">AI Trader page</Link>. This practice wallet stays manual.
      </p>

      <section className="paper-wallet-summary" aria-label="Virtual wallet balance">
        <div className="paper-wallet-icon"><CircleDollarSign size={21} /></div>
        <div className="paper-wallet-label"><span>Available virtual cash</span><small>For practice orders only</small></div>
        <strong>₹{state.cash.toLocaleString('en-IN')}</strong>
      </section>

      <section className="paper-trading-layout">
        <div className="trade-box paper-trade-box">
          <div className="paper-panel-heading">
            <div>
              <span className="paper-panel-kicker">ORDER TICKET</span>
              <h2>Place a practice order</h2>
            </div>
            <span className="paper-ticket-icon"><Activity size={18} /></span>
          </div>

          <label className="paper-field">
            Stock
            <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
              {liveStocks.map((stock) => <option key={stock.symbol} value={stock.symbol}>{stock.symbol} — {priceLabel(stock)}</option>)}
            </select>
          </label>

          <div className={`paper-quote-panel ${hasCurrentQuote ? 'is-live' : hasDemoPrice ? 'is-demo' : 'is-waiting'}`}>
            <div className="paper-quote-main">
              <span>Market price</span>
              <strong className={`stock-price-value ${selectedStock.flash ? `price-flash-${selectedStock.flash}` : ''}`}>
                {Number(selectedStock.price) > 0 ? `₹${selectedStock.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Waiting for quote'}
              </strong>
              <small><span className="paper-quote-dot" />{quoteStatus}</small>
            </div>
            {(hasCurrentQuote || hasDemoPrice) && selectedStock.changePercent !== null && (
              <div className={`paper-quote-change ${changeIsPositive ? 'is-positive' : 'is-negative'}`}>
                <span>{changeIsPositive ? '▲' : '▼'}</span>
                <strong>{selectedStock.change >= 0 ? '+' : ''}{selectedStock.changePercent}%</strong>
                <small>Today</small>
              </div>
            )}
          </div>

          <div className={`segmented paper-side-toggle ${side === 'Buy' ? 'buy-selected' : 'sell-selected'}`}>
            {['Buy', 'Sell'].map((option) => (
              <button className={side === option ? 'active' : ''} type="button" key={option} onClick={() => setSide(option)}>
                {option}
              </button>
            ))}
          </div>

          <label className="paper-field">
            Quantity
            <input min="1" step="1" type="number" value={qty} onChange={(event) => setQty(event.target.value)} />
          </label>

          {side === 'Sell' && (
            <p className="paper-note">
              You hold {heldQty} {symbol} {heldQty === 1 ? 'share' : 'shares'}.
            </p>
          )}

          <div className="order-value paper-order-value">
            <span>Estimated order value</span>
            <strong>{orderValue === null ? 'Waiting for live quote' : `₹${orderValue.toLocaleString('en-IN')}`}</strong>
          </div>

          <button className="primary-button paper-submit-button" type="button" disabled={!hasUsableQuote} onClick={submit}><CircleDollarSign size={17} /> Place Paper Order</button>
          {!hasUsableQuote ? (
            <p className="paper-note paper-quote-gate" role="status">
              {hasResearchQuote
                ? 'Paper orders need a verified live quote. The price shown is delayed research data, so the ticket stays disabled.'
                : 'Waiting for a verified quote before a paper order can be placed.'}
            </p>
          ) : null}
          {orderError ? <p className="error-message" role="alert">{orderError}</p> : null}
          <button className="secondary-button paper-reset-button" type="button" onClick={reset}><RotateCcw size={17} /> Reset demo account</button>
          <p className="paper-disclaimer">Virtual practice only. Demo prices are simulated, not current exchange prices.</p>
        </div>

        <section className="panel table-panel paper-orders-panel">
          <div className="paper-orders-heading">
            <div>
              <span className="paper-panel-kicker">ACTIVITY</span>
              <h2>Recent paper orders</h2>
            </div>
            <span className="paper-order-count">{state.orders.length} {state.orders.length === 1 ? 'order' : 'orders'}</span>
          </div>
          <div className="paper-orders-table-wrap">
            <table className="paper-orders-table">
              <thead>
                <tr><th>Date</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Status</th></tr>
              </thead>
              <tbody>
                {state.orders.length ? state.orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.date}</td>
                    <td className="paper-order-symbol">{order.symbol}</td>
                    <td><span className={`paper-side-badge ${order.side === 'Buy' ? 'is-buy' : 'is-sell'}`}>{order.side}</span></td>
                    <td>{order.qty}</td>
                    <td className="paper-order-price">₹{order.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td><span className="status-badge">{order.status}{order.isDemoPrice ? ' · Demo' : ''}</span></td>
                  </tr>
                )) : (
                  <tr><td colSpan="6">
                    <div className="paper-empty-state">
                      <span><RotateCcw size={18} /></span>
                      <strong>No practice orders yet</strong>
                      <small>Your orders will appear here after placing a trade with a live quote.</small>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
};

export default PaperTrading;
