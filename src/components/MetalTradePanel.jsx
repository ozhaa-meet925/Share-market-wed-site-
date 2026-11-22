import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Info,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Wallet,
  X,
} from 'lucide-react';
import { isLiveMetalQuote, metalPricePerGram } from '../data/metals';
import { marketApi } from '../services/api';
import { soundEffects } from '../services/sounds';
import { useMetalPaperState } from '../hooks/useMetalPaperState';
import { estimateMetalCharges } from '../../metalCharges.js';
import { TickArrow, tickToneClass, useTickFlash } from './PriceChange';

const formatCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${amount < 0 ? '-' : ''}₹${Math.abs(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatNumber = (value, digits = 2) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatQuoteTime = (value) => {
  if (value === null || value === undefined || value === '') return 'Provider time unavailable';
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value);
  if (!Number.isFinite(date.getTime())) return 'Provider time unavailable';
  return `Provider time ${date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })} IST`;
};

const statusLabel = (quote) => {
  if (!quote) return 'Unavailable';
  if (quote.liveFeed === 'upstox') {
    if (quote.isStale === true) return 'MCX stale';
    return quote.isLive === true ? 'Live MCX' : 'MCX delayed';
  }
  if (quote.isLive === true && quote.isStale !== true) return 'Live';
  if (quote.isStale === true) return 'Stale';
  if (quote.isDelayed === true || quote.isResearch === true) return 'Delayed';
  return 'Published';
};

const MetalTradePanel = ({ metal, quote }) => {
  const [side, setSide] = useState('Buy');
  const [orderType, setOrderType] = useState('Market');
  const [qty, setQty] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const {
    state: paperState,
    signedIn,
    isLoading: accountLoading,
    error: accountError,
    applyState: setPaperState,
  } = useMetalPaperState();

  const quotePrice = Number(quote?.c) > 0 ? Number(quote.c) : null;
  const marketPricePerGram = Number(quote?.inrPerGram) > 0 ? Number(quote.inrPerGram) : metalPricePerGram(metal, quotePrice);
  const liveQuote = isLiveMetalQuote(quote);
  const quoteIsFresh = Boolean(quote)
    && quote.isReal === true
    && quote.isDemo !== true
    && quote.isStale !== true;
  const tradingEnabled = quoteIsFresh;
  const priceBasis = liveQuote ? 'Live Upstox MCX' : `${quote?.provider || 'Verified provider'} · paper reference`;
  const quoteHasVerifiedPrice = quotePrice !== null && quoteIsFresh;
  const change = quote?.d !== null && quote?.d !== undefined && Number.isFinite(Number(quote.d))
    ? Number(quote.d)
    : null;
  const changePercent = quote?.dp !== null && quote?.dp !== undefined && Number.isFinite(Number(quote.dp))
    ? Number(quote.dp)
    : null;
  const dayDirection = change === null ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const positive = dayDirection === 'up';
  const { flash: tickFlash } = useTickFlash(quoteHasVerifiedPrice ? quotePrice : null, null, metal?.symbol || 'METAL');
  const quotePriceTone = quoteHasVerifiedPrice ? tickToneClass(tickFlash || dayDirection, tickFlash) : '';

  useEffect(() => {
    if (orderType !== 'Limit') return;
    if (limitPrice !== '') return;
    if (marketPricePerGram === null) return;
    setLimitPrice(marketPricePerGram.toFixed(2));
  }, [limitPrice, marketPricePerGram, orderType]);

  const quantity = Math.max(1, Math.floor(Number(qty) || 0));
  const limitPriceValue = Number(limitPrice);
  const executionPricePerGram = orderType === 'Limit'
    ? (Number.isFinite(limitPriceValue) && limitPriceValue > 0 ? Number(limitPriceValue.toFixed(2)) : null)
    : marketPricePerGram;
  const orderValue = executionPricePerGram === null
    ? null
    : Number((quantity * executionPricePerGram).toFixed(2));
  const estimatedCharges = orderValue === null ? null : estimateMetalCharges({ side, turnover: orderValue });
  const estimatedDebit = orderValue === null ? null : Number((orderValue + (estimatedCharges?.total || 0)).toFixed(2));
  const estimatedSettlement = orderValue === null
    ? null
    : Number((orderValue + (side === 'Buy' ? estimatedCharges?.total || 0 : -(estimatedCharges?.total || 0))).toFixed(2));
  const holding = paperState?.holdings?.find((item) => item.symbol === metal.symbol) || null;
  const heldGrams = Number(holding?.availableGrams || 0);
  const position = holding && Number(holding.quantityGrams) > 0 ? {
    qty: Number(holding.quantityGrams),
    avgBuyPrice: Number(holding.avgPricePerGram),
  } : null;
  const holdingValue = marketPricePerGram === null || !position
    ? null
    : Number((position.qty * marketPricePerGram).toFixed(2));
  const holdingPnl = marketPricePerGram === null || !position
    ? null
    : Number(((marketPricePerGram - position.avgBuyPrice) * position.qty).toFixed(2));
  const recentOrders = useMemo(
    () => (paperState?.orders || []).filter((order) => order.symbol === metal.symbol).slice(0, 6),
    [metal.symbol, paperState?.orders],
  );
  const availableCash = Number(paperState?.account?.availableCash || 0);
  const canAfford = estimatedDebit !== null && availableCash >= estimatedDebit;
  const canSell = heldGrams >= quantity;
  const priceReady = signedIn && tradingEnabled && executionPricePerGram !== null;
  const canReview = priceReady && quantity > 0 && (side === 'Buy' ? canAfford : canSell);
  const blockedReason = !signedIn
    ? 'Sign in to use the authenticated metals paper account.'
    : accountError && !paperState
      ? accountError
      : accountLoading || !paperState
        ? 'Loading your secure paper account.'
      : !tradingEnabled
        ? 'Paper orders pause when the authentic provider quote is unavailable or stale.'
        : !priceReady
          ? orderType === 'Market'
            ? 'A verified metals quote is required for market orders.'
            : 'Enter a valid limit price per gram.'
          : quantity <= 0
            ? 'Enter at least 1 gram.'
            : side === 'Buy' && !canAfford
              ? 'Not enough available paper cash, including estimated charges.'
              : side === 'Sell' && !canSell
                ? `You have ${heldGrams} available grams of ${metal.name}.`
                : '';

  const resetFeedback = () => setStatus(null);

  const handleReview = (event) => {
    event.preventDefault();
    resetFeedback();
    if (!canReview) {
      soundEffects.playOrderCancel();
      setStatus({ type: 'error', text: blockedReason || 'This order cannot be placed.' });
      return;
    }
    setConfirming(true);
  };

  const handleConfirm = async () => {
    if (!canReview || !executionPricePerGram) {
      setConfirming(false);
      setStatus({ type: 'error', text: blockedReason || 'This paper order cannot be placed.' });
      return;
    }
    try {
      const payload = await marketApi.placeMetalPaperOrder({
        mode: 'paper',
        symbol: metal.symbol,
        side: side.toUpperCase(),
        orderType: orderType.toUpperCase(),
        quantityGrams: quantity,
        limitPricePerGram: orderType === 'Limit' ? executionPricePerGram : undefined,
        idempotencyKey: `metal-ui:${crypto.randomUUID()}`,
      });
      setPaperState(payload);
      setConfirming(false);
      setQty('1');
      soundEffects.playOrderSuccess();
      setStatus({
        type: 'success',
        text: orderType === 'Limit'
          ? `Limit ${side.toLowerCase()} accepted · ${quantity} g ${metal.name} @ ${formatCurrency(executionPricePerGram)}/g. Cash or holdings are reserved and the server will match it against verified quotes.`
          : `${side} filled in authenticated paper mode · ${quantity} g ${metal.name} @ ${formatCurrency(payload.order?.executionPricePerGram)}/g · charges ${formatCurrency(payload.order?.charges)}. No broker order was placed.`,
      });
    } catch (error) {
      soundEffects.playOrderCancel();
      setConfirming(false);
      setStatus({ type: 'error', text: error.message });
    }
  };

  const handleCancelOrder = async (order) => {
    setCancellingOrderId(order.id);
    resetFeedback();
    try {
      const payload = await marketApi.cancelMetalPaperOrder(order.id);
      setPaperState(payload);
      soundEffects.playOrderCancel();
      setStatus({
        type: 'success',
        text: `${order.side} limit order cancelled. Its paper cash or holdings reservation was released.`,
      });
    } catch (error) {
      setStatus({ type: 'error', text: error.message });
    } finally {
      setCancellingOrderId(null);
    }
  };

  return (
    <section className="panel metal-trade-panel" id="metal-trade" aria-label={`${metal.name} paper trading panel`}>
      <div className="metal-trade-heading">
        <div>
          <span className="card-topline"><ShieldCheck size={14} /> Paper trading sandbox</span>
          <h2>Trade {metal.name}</h2>
          <p>{metal.symbol} · {metal.exchange} · quoted in ₹ / {metal.quoteUnit}</p>
        </div>
        <span className={`metal-quote-chip ${liveQuote ? 'is-live' : quoteIsFresh ? 'is-delayed' : 'is-error'}`}>
          <span className="live-dot" /> {statusLabel(quote)}
        </span>
      </div>

      <div className="metal-quote-summary">
        <div className="metal-quote-main">
          <span>{priceBasis} · ₹ / {metal.quoteUnit}</span>
          <strong key={tickFlash ? `metal-${tickFlash}` : 'metal'} className={quotePriceTone}>{quoteHasVerifiedPrice ? formatCurrency(quotePrice) : 'Quote unavailable'}</strong>
          <small>≈ {marketPricePerGram === null ? '—' : `${formatCurrency(marketPricePerGram)} / g`}</small>
          <small>{formatQuoteTime(quote?.priceTimestamp || quote?.timestamp)}</small>
        </div>
        <div className={`metal-quote-change ${dayDirection === 'up' ? 'gain' : dayDirection === 'down' ? 'loss' : 'price-flat'}`}>
          {change === null ? null : <TickArrow direction={dayDirection} />}
          <b>{change === null || changePercent === null
            ? 'Change unavailable'
            : `${positive ? '+' : ''}${formatNumber(change)} (${positive ? '+' : ''}${formatNumber(changePercent)}%)`}</b>
          <span>Day change</span>
        </div>
      </div>

      {!liveQuote && quote?.liveFallbackReason && (
        <p className="metal-quote-feed-note"><Info size={13} /> {quote.liveFallbackReason}</p>
      )}

      {(!signedIn || !tradingEnabled) && (
        <p className="metal-trade-warning" role="status">
          <Info size={14} /> {!signedIn ? 'Sign in to use the server-persisted metals paper account.' : 'Paper orders are paused because the authentic provider quote is unavailable or stale.'}
        </p>
      )}

      <div className="metal-trade-balance">
        <span><Wallet size={14} /> Available paper cash <b>{formatCurrency(availableCash)}</b></span>
        <span><ShoppingBag size={14} /> Value <b>{formatCurrency(orderValue)}</b></span>
        <span>Estimated charges <b>{formatCurrency(estimatedCharges?.total)}</b></span>
      </div>

      <form className="metal-trade-form" onSubmit={handleReview}>
        <div className="metal-side-toggle" role="group" aria-label="Order side">
          <button
            type="button"
            className={`metal-side-btn buy ${side === 'Buy' ? 'active' : ''}`}
            aria-pressed={side === 'Buy'}
            onClick={() => { setSide('Buy'); resetFeedback(); setConfirming(false); }}
          >
            Buy
          </button>
          <button
            type="button"
            className={`metal-side-btn sell ${side === 'Sell' ? 'active' : ''}`}
            aria-pressed={side === 'Sell'}
            onClick={() => { setSide('Sell'); resetFeedback(); setConfirming(false); }}
          >
            Sell
          </button>
        </div>

        <div className="metal-order-type" role="group" aria-label="Order type">
          {['Market', 'Limit'].map((type) => (
            <button
              key={type}
              type="button"
              className={orderType === type ? 'active' : ''}
              aria-pressed={orderType === type}
              onClick={() => { setOrderType(type); resetFeedback(); setConfirming(false); }}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="metal-trade-grid">
          <div className="trade-input-group">
            <label htmlFor="metal-order-qty">Quantity (grams)</label>
            <div className="qty-stepper">
              <button type="button" onClick={() => setQty(String(Math.max(1, quantity - 1)))} aria-label="Decrease quantity">-</button>
              <input
                id="metal-order-qty"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={qty}
                onChange={(event) => { setQty(event.target.value); resetFeedback(); }}
              />
              <button type="button" onClick={() => setQty(String(quantity + 1))} aria-label="Increase quantity">+</button>
            </div>
          </div>

          <div className="trade-input-group">
            <label htmlFor="metal-order-price">
              {orderType === 'Limit' ? 'Limit price (₹ / g)' : 'Market price (₹ / g)'}
            </label>
            <input
              id="metal-order-price"
              type="number"
              min="0.01"
              step="0.01"
              readOnly={orderType === 'Market'}
              className={orderType === 'Market' ? 'readonly-price' : ''}
              value={orderType === 'Market'
                ? (marketPricePerGram === null ? '' : marketPricePerGram.toFixed(2))
                : limitPrice}
              placeholder={orderType === 'Market' && marketPricePerGram === null ? 'Unavailable' : undefined}
              onChange={(event) => { setLimitPrice(event.target.value); resetFeedback(); }}
            />
          </div>
        </div>

        <div className="metal-order-estimate">
          <span>{side} {quantity} g × {executionPricePerGram === null ? '—' : formatCurrency(executionPricePerGram)} / g</span>
          <strong>{formatCurrency(orderValue)}</strong>
        </div>

        {orderType === 'Market' && quote?.isStale === true && (
          <p className="metal-trade-warning"><Info size={14} /> The latest metals quote is stale, so market orders are paused. Use a limit order or retry the quote.</p>
        )}
        {orderType === 'Limit' && (
          <p className="metal-trade-warning"><Info size={14} /> Limit orders reserve paper cash or holdings and automatically fill only when a fresh verified quote reaches the limit.</p>
        )}

        {status && (
          <div className={`trade-feedback-banner ${status.type}`} role="status">
            {status.type === 'success' ? <CheckCircle2 size={16} /> : <Info size={16} />}
            <span>{status.text}</span>
          </div>
        )}

        {blockedReason && !status && <p className="metal-trade-blocked">{blockedReason}</p>}

        {!confirming ? (
          <button type="submit" className={`metal-review-button ${side === 'Buy' ? 'buy' : 'sell'}`} disabled={!canReview}>
            <ShoppingBag size={17} /> Review {side.toLowerCase()} order
          </button>
        ) : (
          <div className="metal-order-confirm" aria-label="Order confirmation">
            <div className="metal-confirm-header">
              <div>
                <span>Order summary</span>
                <h3>{side} {quantity} g {metal.name}</h3>
              </div>
              <button type="button" className="metal-confirm-close" onClick={() => setConfirming(false)} aria-label="Cancel order summary">
                <X size={17} />
              </button>
            </div>
            <dl className="metal-confirm-list">
              <div><dt>Instrument</dt><dd>{metal.symbol} · {metal.exchange}</dd></div>
              <div><dt>Order type</dt><dd>{orderType} · authenticated paper</dd></div>
              <div><dt>Quantity</dt><dd>{quantity} g</dd></div>
              <div><dt>Price</dt><dd>{formatCurrency(executionPricePerGram)} / g</dd></div>
              <div><dt>Reference</dt><dd>{quoteHasVerifiedPrice ? `${formatCurrency(quotePrice)} / ${metal.quoteUnit}` : 'Unavailable'}</dd></div>
              <div><dt>Gross value</dt><dd>{formatCurrency(orderValue)}</dd></div>
              <div><dt>Estimated charges</dt><dd>{formatCurrency(estimatedCharges?.total)}</dd></div>
              <div><dt>{side === 'Buy' ? 'Estimated debit' : 'Estimated proceeds'}</dt><dd>{formatCurrency(estimatedSettlement)}</dd></div>
              <div><dt>Available cash</dt><dd>{formatCurrency(availableCash)}</dd></div>
              <div><dt>Available holdings after</dt><dd>{side === 'Sell' ? Math.max(0, heldGrams - quantity) : orderType === 'Market' ? heldGrams + quantity : heldGrams} g</dd></div>
            </dl>
            <div className="metal-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>Cancel</button>
              <button
                type="button"
                className={`primary-button metal-confirm-submit ${side === 'Buy' ? 'buy' : 'sell'}`}
                onClick={handleConfirm}
              >
                {orderType === 'Market' ? `Confirm paper ${side.toLowerCase()}` : `Queue ${side.toLowerCase()} limit`}
              </button>
            </div>
            <p className="metal-confirm-note">
              {orderType === 'Market'
                ? `Executes at the latest ${priceBasis} price. No broker order is placed.`
                : 'Saved as a pending paper order. Paper cash or holdings are reserved until it fills or you cancel it.'}
            </p>
          </div>
        )}
      </form>

      <div className="metal-holdings-strip">
        <div>
          <span>Your holding</span>
          <strong>{heldGrams} g</strong>
        </div>
        <div>
          <span>Average price</span>
          <strong>{position ? `${formatCurrency(position.avgBuyPrice)} / g` : '—'}</strong>
        </div>
        <div>
          <span>Holding value</span>
          <strong>{formatCurrency(holdingValue)}</strong>
        </div>
        <div>
          <span>Unrealised P&L</span>
          <strong className={holdingPnl === null ? '' : holdingPnl > 0 ? 'gain' : holdingPnl < 0 ? 'loss' : 'price-flat'}>
            {holdingPnl === null ? '—' : `${holdingPnl > 0 ? '+' : ''}${formatCurrency(holdingPnl)}`}
          </strong>
        </div>
        <div>
          <span>Realised P&L</span>
          <strong className={Number(holding?.realizedPnl || 0) > 0 ? 'gain' : Number(holding?.realizedPnl || 0) < 0 ? 'loss' : 'price-flat'}>
            {formatCurrency(holding?.realizedPnl || 0)}
          </strong>
        </div>
      </div>

      <div className="metal-recent-orders">
        <div className="metal-recent-heading">
          <h4>Recent {metal.name} orders</h4>
          {!quoteIsFresh && <button type="button" onClick={() => window.location.reload()}><RefreshCw size={13} /> Retry quote</button>}
        </div>
        {recentOrders.length ? (
          <ul>
            {recentOrders.map((order) => {
              const displayPrice = order.executionPricePerGram || order.limitPricePerGram;
              return (
                <li key={order.id}>
                  <span className={`metal-order-side ${order.side.toLowerCase()}`}>{order.side}</span>
                  <span>{order.quantityGrams} g @ {formatCurrency(displayPrice)}/g</span>
                  <span className="metal-order-actions">
                    <span className={`metal-order-status ${order.status.toLowerCase()}`}>{order.status}</span>
                    {order.status === 'PENDING' && (
                      <button
                        type="button"
                        className="metal-order-cancel"
                        onClick={() => handleCancelOrder(order)}
                        disabled={cancellingOrderId === order.id}
                      >
                        {cancellingOrderId === order.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No {metal.name.toLowerCase()} paper orders yet.</p>
        )}
      </div>

      <p className="metal-trade-footer">
        <ShieldCheck size={13} /> Paper trading only. {liveQuote
          ? 'The price is a live Upstox MCX quote'
          : quote?.marketType === 'benchmark'
            ? 'The price is a delayed futures reference, not a live MCX exchange tick'
            : 'The price is a delayed spot reference, not a live MCX exchange tick'}, and no real broker order is placed.
      </p>
    </section>
  );
};

export default MetalTradePanel;
