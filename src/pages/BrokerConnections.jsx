import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  ListOrdered,
  Lock,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Wallet,
  XCircle,
} from 'lucide-react';
import { brokersApi } from '../services/brokers';
import './BrokerConnections.css';

const STATUS_LABELS = {
  connected: 'Connected',
  token_invalid: 'Token expired',
  error: 'Connection error',
};

const statusOf = (connection) => {
  if (!connection.connected) {
    return connection.configured
      ? { tone: 'warn', label: 'Configured · Not connected' }
      : { tone: 'off', label: 'Not Connected' };
  }
  const probe = connection.lastProbeStatus;
  return {
    tone: probe === 'token_invalid' || probe === 'error' ? 'bad' : 'good',
    label: STATUS_LABELS[probe] || 'Connected',
  };
};

const OPEN_STATUS = /open|pending|trigger|modif|validation|put order|requested/i;
const randomKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const EMPTY_TICKET = {
  side: 'BUY',
  orderType: 'MARKET',
  product: 'CNC',
  exchange: 'NSE',
  instrumentToken: '',
  tradingsymbol: '',
  quantity: '',
  price: '',
  triggerPrice: '',
  liveConfirmed: false,
  idempotencyKey: '',
};

const openOrdersOf = (rows) => (Array.isArray(rows) ? rows : []).filter((order) => order && order.order_id && OPEN_STATUS.test(String(order.status || '')));

const orderLabel = (order) => order?.tradingsymbol || order?.trading_symbol || order?.tradingSymbol || order?.order_id;

const formatCell = (value) => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 60);
  return String(value).slice(0, 80);
};

const DataTable = ({ rows }) => {
  if (!Array.isArray(rows) || rows.length === 0) return <p className="broker-empty">The broker returned no rows.</p>;
  const columns = [...new Set(rows.flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : [])))].slice(0, 7);
  return (
    <div className="broker-table-wrap">
      <table className="broker-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row?.id || row?.order_id || index}>
              {columns.map((column) => <td key={column}>{formatCell(row?.[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const DataObject = ({ value }) => {
  if (!value || typeof value !== 'object') return <p className="broker-empty">No data returned.</p>;
  const entries = Object.entries(value).slice(0, 20);
  return (
    <dl className="broker-kv">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{key.replace(/_/g, ' ')}</dt>
          <dd>{typeof item === 'object' ? formatCell(item) : formatCell(item)}</dd>
        </div>
      ))}
    </dl>
  );
};

const BrokerConnections = () => {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [panels, setPanels] = useState({});
  const [tickets, setTickets] = useState({});
  const [quotes, setQuotes] = useState({});
  const [deskErrors, setDeskErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await brokersApi.list());
    } catch (err) {
      setError(err.status === 401 ? 'Sign in to manage broker connections.' : err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const connected = params.get('connected');
    const failure = params.get('error');
    if (connected) setNotice({ tone: 'good', text: `${connected} connected. Tokens are stored encrypted on the server.` });
    if (failure) setNotice({ tone: 'bad', text: `Broker authorization failed: ${failure.replace(/_/g, ' ')}.` });
    if (connected || failure) {
      const next = new URLSearchParams(params);
      next.delete('connected');
      next.delete('error');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const run = async (key, action) => {
    setBusy(key);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  };

  const connect = (broker) => run(`${broker.id}:connect`, async () => {
    const { url } = await brokersApi.loginUrl(broker.id);
    window.location.assign(url);
  });

  const probe = (broker) => run(`${broker.id}:probe`, async () => {
    const result = await brokersApi.probe(broker.id);
    setNotice({ tone: 'good', text: `${broker.name} responded in ${result.latencyMs} ms.` });
    load();
  });

  const disconnect = (broker) => run(`${broker.id}:disconnect`, async () => {
    if (!window.confirm(`Disconnect ${broker.name}? Stored tokens will be deleted and live consent revoked.`)) return;
    await brokersApi.disconnect(broker.id);
    setNotice({ tone: 'good', text: `${broker.name} disconnected.` });
    load();
  });

  const toggleConsent = (broker) => run(`${broker.id}:consent`, async () => {
    const enabling = !broker.connection.liveAuthorized;
    let confirmation;
    if (enabling) {
      confirmation = window.prompt(`Type ENABLE LIVE TRADING to allow ${broker.name} order routing for this account.`);
      if (confirmation === null) return;
    }
    const result = await brokersApi.setLiveConsent(broker.id, enabling, confirmation);
    setNotice({
      tone: 'good',
      text: enabling
        ? `Live consent recorded for ${broker.name}. Orders still require LIVE_TRADING_ENABLED=1 on the server.`
        : `Live consent revoked for ${broker.name}.`,
    });
    setData((current) => current ? {
      ...current,
      brokers: current.brokers.map((item) => item.id === broker.id
        ? { ...item, connection: { ...item.connection, liveAuthorized: result.liveAuthorized } }
        : item),
    } : current);
  });

  const loadPanel = (broker, panel) => run(`${broker.id}:${panel}`, async () => {
    const value = await brokersApi[panel](broker.id);
    setPanels((current) => ({ ...current, [`${broker.id}:${panel}`]: { value, at: new Date().toLocaleTimeString('en-IN') } }));
  });

  const ticketFor = (brokerId) => tickets[brokerId] || { ...EMPTY_TICKET, product: brokerId === 'upstox' ? 'D' : 'CNC' };
  const updateTicket = (brokerId, field, value) => {
    setTickets((current) => ({ ...current, [brokerId]: { ...(current[brokerId] || EMPTY_TICKET), [field]: value } }));
  };
  const clearDeskError = (brokerId) => setDeskErrors((current) => {
    if (!current[brokerId]) return current;
    const next = { ...current };
    delete next[brokerId];
    return next;
  });

  const checkQuote = (broker) => run(`${broker.id}:quote`, async () => {
    const key = ticketFor(broker.id).instrumentToken.trim();
    if (!key) throw new Error('Enter the broker instrument key before requesting a quote.');
    const result = await brokersApi.quotes(broker.id, key);
    const first = result.quotes?.[key] || Object.values(result.quotes || {})[0] || null;
    setQuotes((current) => ({
      ...current,
      [broker.id]: { at: new Date().toLocaleTimeString('en-IN'), source: result.source, lastPrice: first?.lastPrice ?? null },
    }));
  });

  const placeOrder = (broker) => run(`${broker.id}:place`, async () => {
    const ticket = ticketFor(broker.id);
    clearDeskError(broker.id);
    if (!ticket.instrumentToken.trim() && !ticket.tradingsymbol.trim()) throw new Error('Enter the broker instrument key or trading symbol.');
    if (!(Number(ticket.quantity) > 0)) throw new Error('Enter a quantity greater than zero.');
    if (['LIMIT', 'SL'].includes(ticket.orderType) && !(Number(ticket.price) > 0)) throw new Error('Enter a limit price greater than zero.');
    if (['SL', 'SL-M'].includes(ticket.orderType) && !(Number(ticket.triggerPrice) > 0)) throw new Error('Enter a trigger price greater than zero.');
    if (!ticket.liveConfirmed) throw new Error('Tick the live-order confirmation before submitting.');
    const label = ticket.tradingsymbol.trim() || ticket.instrumentToken.trim();
    if (!window.confirm(`Send a LIVE ${ticket.side} order for ${ticket.quantity} × ${label} to ${broker.name}?`)) return;

    const idempotencyKey = ticket.idempotencyKey || randomKey();
    setTickets((current) => ({ ...current, [broker.id]: { ...ticket, idempotencyKey } }));
    try {
      const result = await brokersApi.placeOrder(broker.id, {
        side: ticket.side,
        quantity: Number(ticket.quantity),
        price: Number(ticket.price) || 0,
        triggerPrice: Number(ticket.triggerPrice) || 0,
        orderType: ticket.orderType,
        product: ticket.product,
        validity: 'DAY',
        exchange: ticket.exchange,
        instrumentToken: ticket.instrumentToken.trim(),
        tradingsymbol: ticket.tradingsymbol.trim(),
        live: true,
        idempotencyKey,
      });
      setTickets((current) => ({ ...current, [broker.id]: { ...EMPTY_TICKET, product: broker.id === 'upstox' ? 'D' : 'CNC', idempotencyKey: randomKey() } }));
      setNotice({ tone: 'good', text: `${broker.name} accepted order ${result.orderId} (${result.status}${result.brokerOrderId ? ` · broker id ${result.brokerOrderId}` : ''}).` });
      await loadPanel(broker, 'orders');
    } catch (err) {
      setDeskErrors((current) => ({ ...current, [broker.id]: { message: err.message, checks: err.payload?.checks || [] } }));
      throw err;
    }
  });

  const cancelOrder = (broker, order) => run(`${broker.id}:cancel`, async () => {
    const label = orderLabel(order);
    if (!window.confirm(`Cancel the live broker order for ${label}?`)) return;
    await brokersApi.cancelOrder(broker.id, order.order_id, order.variety);
    setNotice({ tone: 'good', text: `Cancel request sent for ${label}. The broker order book is the source of truth.` });
    await loadPanel(broker, 'orders');
  });

  const modifyOrder = (broker, order) => run(`${broker.id}:modify`, async () => {
    const label = orderLabel(order);
    const priceRaw = window.prompt(`New price for ${label} (current ${order.price ?? '—'}). Leave blank to keep.`, '');
    if (priceRaw === null) return;
    const quantityRaw = window.prompt(`New quantity for ${label} (current ${order.quantity ?? '—'}). Leave blank to keep.`, '');
    if (quantityRaw === null) return;
    const patch = {};
    if (priceRaw.trim() !== '') patch.price = Number(priceRaw);
    if (quantityRaw.trim() !== '') patch.quantity = Number(quantityRaw);
    if (!Object.keys(patch).length) return;
    if (!window.confirm(`Modify ${label}? The exchange may reject changes to an order that is already executing.`)) return;
    await brokersApi.modifyOrder(broker.id, order.order_id, patch);
    setNotice({ tone: 'good', text: `Modification request sent for ${label}. Verify the broker order book.` });
    await loadPanel(broker, 'orders');
  });

  if (loading) return <div className="page"><div className="broker-loading" role="status">Checking broker connections…</div></div>;

  if (error) {
    return (
      <div className="page">
        <div className="page-title"><span>Broker integrations</span><h1>Broker Connections</h1></div>
        <div className="broker-error">
          <AlertTriangle size={18} />
          <div>
            <strong>{error}</strong>
            {error.startsWith('Sign in') ? <p><Link to="/login">Sign in</Link> to continue.</p> : <p><button type="button" className="link-button" onClick={load}>Retry</button></p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page broker-page">
      <div className="page-title"><span>Broker integrations</span><h1>Broker Connections</h1></div>

      <div className={`broker-master ${data.liveTradingEnabled ? 'is-on' : ''}`}>
        <Lock size={18} />
        <div>
          <strong>{data.liveTradingEnabled ? 'Live order routing is enabled on this server' : 'Live order routing is disabled'}</strong>
          <p>{data.liveTradingRequirement}</p>
        </div>
      </div>

      {notice ? (
        <div className={`broker-notice ${notice.tone}`} role="status">
          {notice.tone === 'good' ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
          <span>{notice.text}</span>
        </div>
      ) : null}

      <div className="broker-grid">
        {data.brokers.map((broker) => {
          const status = statusOf(broker.connection);
          const loadingKey = (suffix) => busy === `${broker.id}:${suffix}`;
          return (
            <section className="broker-card" key={broker.id}>
              <header>
                <div>
                  <h2>{broker.name}</h2>
                  <a href={broker.docsUrl} target="_blank" rel="noreferrer">API documentation</a>
                </div>
                <span className={`broker-badge ${status.tone}`}>{status.label}</span>
              </header>

              {!broker.connection.configured ? (
                <p className="broker-hint" id={`broker-setup-${broker.id}`}>
                  Server setup required. Add {broker.connection.missing.join(', ')} to the server environment, register
                  {' '}{`${window.location.origin}/api/brokers/${broker.id}/callback`} as the OAuth callback, then restart.
                  Secrets are entered only on the server, never in this browser.
                </p>
              ) : null}
              {broker.connection.lastError ? <p className="broker-hint bad">Last error: {broker.connection.lastError}</p> : null}

              <div className="broker-capabilities">
                <span className={broker.capabilities.profile ? 'on' : 'off'}>Profile</span>
                <span className={broker.capabilities.funds ? 'on' : 'off'}>Funds</span>
                <span className={broker.capabilities.quotes ? 'on' : 'off'}>Quotes</span>
                <span className={broker.capabilities.history ? 'on' : 'off'}>History</span>
                <span className={broker.capabilities.orders ? 'on' : 'off'}>Orders</span>
                <span className={broker.capabilities.orderPlacement ? 'on' : 'off'}>Execution</span>
              </div>
              <p className="broker-feed">
                <AlertTriangle size={13} /> Market feed: {broker.capabilities.marketDataFeed.supported ? 'supported' : broker.capabilities.marketDataFeed.reason}
              </p>

              <div className="broker-actions">
                {!broker.connection.connected ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => connect(broker)}
                    disabled={!broker.connection.configured || loadingKey('connect')}
                    title={!broker.connection.configured
                      ? `Connect is unavailable until the server has ${broker.connection.missing.join(', ')}.`
                      : undefined}
                    aria-describedby={!broker.connection.configured ? `broker-setup-${broker.id}` : undefined}
                  >
                    <PlugZap size={15} /> {loadingKey('connect') ? 'Opening…' : 'Connect'}
                  </button>
                ) : (
                  <>
                    <button type="button" className="secondary-button" onClick={() => probe(broker)} disabled={loadingKey('probe')}>
                      <RefreshCw size={15} className={loadingKey('probe') ? 'spin' : ''} /> Probe
                    </button>
                    <button type="button" className="secondary-button danger" onClick={() => disconnect(broker)} disabled={loadingKey('disconnect')}>
                      <Unplug size={15} /> Disconnect
                    </button>
                  </>
                )}
                <span className="broker-mode">Mode: {broker.connection.mode}</span>
              </div>

              <>
                  {broker.connection.connected ? (
                  <div className="broker-live">
                    <div>
                      <strong><ShieldCheck size={15} /> Live order consent</strong>
                      <p>
                        {broker.connection.liveAuthorized
                          ? 'Consent is recorded for this account. Server routing must also be enabled.'
                          : data.liveTradingEnabled
                            ? 'Not granted. Orders remain blocked until you confirm below.'
                            : 'Blocked by the server master switch (LIVE_TRADING_ENABLED=0).'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`toggle ${broker.connection.liveAuthorized ? 'on' : ''}`}
                      aria-pressed={broker.connection.liveAuthorized}
                      onClick={() => toggleConsent(broker)}
                      disabled={(!data.liveTradingEnabled && !broker.connection.liveAuthorized) || loadingKey('consent')}
                    >
                      <span />
                    </button>
                  </div>
                  ) : null}

                  {(() => {
                    const ticket = ticketFor(broker.id);
                    const quote = quotes[broker.id];
                    const deskError = deskErrors[broker.id];
                    const gate = !broker.connection.connected
                      ? `Connect ${broker.name} before trading.`
                      : !data.liveTradingEnabled
                        ? 'Server live routing is disabled (LIVE_TRADING_ENABLED=0). Orders cannot be submitted.'
                        : !broker.connection.liveAuthorized
                          ? 'Grant live order consent above before submitting.'
                          : !broker.capabilities.orderPlacement
                            ? `Order placement is unavailable while ${broker.name} is in ${broker.connection.mode} mode.`
                            : '';
                    const products = broker.id === 'upstox'
                      ? [{ value: 'D', label: 'Delivery (D)' }, { value: 'I', label: 'Intraday (I)' }]
                      : [{ value: 'CNC', label: 'CNC' }, { value: 'MIS', label: 'MIS' }, { value: 'NRML', label: 'NRML' }];
                    return (
                      <details className="broker-desk">
                        <summary>
                          <span>Live order desk</span>
                          <span className={`broker-badge ${gate ? 'off' : 'good'}`}>{gate ? 'Gated' : 'Ready'}</span>
                        </summary>
                        <p className={`broker-desk-gate ${gate ? 'off' : 'on'}`}>
                          {gate ? <Lock size={13} /> : <ShieldCheck size={13} />} {gate || 'Live routing, consent and Risk Shield are satisfied. The broker still validates every order.'}
                        </p>
                        <fieldset className="broker-desk-grid" disabled={Boolean(gate)}>
                          <label>
                            <span>Side</span>
                            <select value={ticket.side} onChange={(event) => updateTicket(broker.id, 'side', event.target.value)}>
                              <option value="BUY">BUY</option>
                              <option value="SELL">SELL</option>
                            </select>
                          </label>
                          <label>
                            <span>Order type</span>
                            <select value={ticket.orderType} onChange={(event) => updateTicket(broker.id, 'orderType', event.target.value)}>
                              <option value="MARKET">MARKET</option>
                              <option value="LIMIT">LIMIT</option>
                              <option value="SL">SL</option>
                              <option value="SL-M">SL-M</option>
                            </select>
                          </label>
                          <label>
                            <span>Product</span>
                            <select value={ticket.product} onChange={(event) => updateTicket(broker.id, 'product', event.target.value)}>
                              {products.map((product) => <option key={product.value} value={product.value}>{product.label}</option>)}
                            </select>
                          </label>
                          <label>
                            <span>Exchange</span>
                            <select value={ticket.exchange} onChange={(event) => updateTicket(broker.id, 'exchange', event.target.value)}>
                              {['NSE', 'BSE', 'NFO', 'BFO'].map((exchange) => <option key={exchange} value={exchange}>{exchange}</option>)}
                            </select>
                          </label>
                          <label>
                            <span>Instrument key</span>
                            <input value={ticket.instrumentToken} placeholder={broker.id === 'upstox' ? 'NSE_EQ|INE002A01018' : '738561'} onChange={(event) => updateTicket(broker.id, 'instrumentToken', event.target.value)} />
                          </label>
                          <label>
                            <span>Trading symbol</span>
                            <input value={ticket.tradingsymbol} placeholder="RELIANCE" onChange={(event) => updateTicket(broker.id, 'tradingsymbol', event.target.value)} />
                          </label>
                          <label>
                            <span>Quantity</span>
                            <input type="number" min="1" step="1" value={ticket.quantity} onChange={(event) => updateTicket(broker.id, 'quantity', event.target.value)} />
                          </label>
                          <label>
                            <span>Price</span>
                            <input type="number" min="0" step="0.05" value={ticket.price} onChange={(event) => updateTicket(broker.id, 'price', event.target.value)} />
                          </label>
                          <label>
                            <span>Trigger price</span>
                            <input type="number" min="0" step="0.05" value={ticket.triggerPrice} onChange={(event) => updateTicket(broker.id, 'triggerPrice', event.target.value)} />
                          </label>
                        </fieldset>

                        <div className="broker-desk-actions">
                          <button type="button" className="secondary-button" onClick={() => checkQuote(broker)} disabled={!broker.connection.connected || loadingKey('quote')}>
                            <RefreshCw size={14} className={loadingKey('quote') ? 'spin' : ''} /> {loadingKey('quote') ? 'Checking…' : 'Quote check'}
                          </button>
                          <button type="button" className="primary-button" onClick={() => placeOrder(broker)} disabled={Boolean(gate) || loadingKey('place')}>
                            <PlugZap size={14} /> {loadingKey('place') ? 'Submitting…' : 'Place live order'}
                          </button>
                          <label className="broker-desk-confirm">
                            <input type="checkbox" checked={ticket.liveConfirmed} disabled={Boolean(gate)} onChange={(event) => updateTicket(broker.id, 'liveConfirmed', event.target.checked)} />
                            <span>I understand this sends a live order to my broker.</span>
                          </label>
                        </div>

                        {quote ? (
                          <p className="broker-desk-quote">
                            {quote.lastPrice === null
                              ? 'The broker returned no last price for that instrument.'
                              : `Broker REST quote: ₹${Number(quote.lastPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
                            <span> · {quote.source} · {quote.at}</span>
                          </p>
                        ) : null}
                        {deskError ? (
                          <div className="broker-desk-error">
                            <strong>{deskError.message}</strong>
                            {deskError.checks?.length ? (
                              <ul>
                                {deskError.checks.map((check) => <li key={check.id} className={check.status}>{check.label}: {check.detail}</li>)}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                        <p className="broker-desk-note">
                          Risk Shield runs before every live order. Timeouts are marked unverified and reconciled against the broker order book — never resubmitted automatically.
                        </p>
                      </details>
                    );
                  })()}

                  {broker.connection.connected ? (
                    <>
                  <div className="broker-panels">
                    <button type="button" onClick={() => loadPanel(broker, 'account')} disabled={loadingKey('account')}>
                      <KeyRound size={14} /> {loadingKey('account') ? 'Loading…' : 'Account & funds'}
                    </button>
                    <button type="button" onClick={() => loadPanel(broker, 'portfolio')} disabled={loadingKey('portfolio')}>
                      <Wallet size={14} /> {loadingKey('portfolio') ? 'Loading…' : 'Holdings & positions'}
                    </button>
                    <button type="button" onClick={() => loadPanel(broker, 'orders')} disabled={loadingKey('orders')}>
                      <ListOrdered size={14} /> {loadingKey('orders') ? 'Loading…' : 'Orders & trades'}
                    </button>
                  </div>

                  {['account', 'portfolio', 'orders'].map((panel) => {
                    const entry = panels[`${broker.id}:${panel}`];
                    if (!entry) return null;
                    return (
                      <div className="broker-panel" key={panel}>
                        <h3>{panel === 'account' ? 'Account & funds' : panel === 'portfolio' ? 'Holdings & positions' : 'Orders & trades'} <small>{entry.at}</small></h3>
                        {entry.value.errors?.length ? <p className="broker-hint bad">{entry.value.errors.join(' · ')}</p> : null}
                        {panel === 'account' ? (
                          <>
                            <DataObject value={entry.value.profile} />
                            <DataObject value={entry.value.funds} />
                          </>
                        ) : panel === 'portfolio' ? (
                          <>
                            <h4>Holdings</h4>
                            <DataTable rows={entry.value.holdings} />
                            <h4>Positions</h4>
                            <DataTable rows={entry.value.positions} />
                          </>
                        ) : (
                          <>
                            {openOrdersOf(entry.value.orders).length ? (
                              <div className="broker-open-orders">
                                <h4>Open orders</h4>
                                {openOrdersOf(entry.value.orders).slice(0, 6).map((order) => (
                                  <div className="broker-open-order" key={order.order_id}>
                                    <div>
                                      <strong>{orderLabel(order)}</strong>
                                      <span>{order.transaction_type || order.side || '—'} {order.quantity ?? ''} · {order.status}</span>
                                    </div>
                                    <div className="broker-open-order-actions">
                                      <button
                                        type="button"
                                        onClick={() => modifyOrder(broker, order)}
                                        disabled={!data.liveTradingEnabled || !broker.connection.liveAuthorized || !broker.capabilities.orderPlacement || loadingKey('modify')}
                                      >
                                        Modify
                                      </button>
                                      <button
                                        type="button"
                                        className="danger"
                                        onClick={() => cancelOrder(broker, order)}
                                        disabled={!data.liveTradingEnabled || !broker.connection.liveAuthorized || !broker.capabilities.orderPlacement || loadingKey('cancel')}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <h4>Order book</h4>
                            <DataTable rows={entry.value.orders} />
                            <h4>Trade book</h4>
                            <DataTable rows={entry.value.trades} />
                          </>
                        )}
                      </div>
                    );
                  })}
                    </>
                  ) : null}
              </>
            </section>
          );
        })}
      </div>

      <p className="broker-footnote">
        Broker tokens are encrypted at rest and never returned to the browser. Market data is shown only from the connected broker
        or an authorized provider; unavailable feeds are labelled instead of simulated. Live order routing stays disabled until the
        server flag and per-account consent are both enabled. Orders that the broker does not confirm are marked unverified and
        reconciled against the broker order book, never blindly resubmitted
        {data.reconciliation?.lastRunAt ? ` · Last reconciliation ${new Date(data.reconciliation.lastRunAt).toLocaleTimeString('en-IN')}` : ''}.
      </p>
    </div>
  );
};

export default BrokerConnections;
