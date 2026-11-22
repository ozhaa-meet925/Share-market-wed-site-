import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  PlusCircle,
  TrendingUp,
  TrendingDown,
  Filter,
} from 'lucide-react';
import { metalBySymbol } from '../data/metals';
import { useMetalPaperState } from '../hooks/useMetalPaperState';
import { marketApi } from '../services/api';
import { getPaperState, savePaperState, PAPER_STATE_EVENT } from '../services/paperTrading';

const formatCurrency = (val) => {
  const amount = Number(val);
  if (!Number.isFinite(amount)) return '—';
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const METAL_STATUS = {
  FILLED: 'Executed',
  PENDING: 'Pending',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

const Orders = () => {
  const [paperState, setPaperState] = useState(getPaperState);
  const { state: metalPaperState, applyState: setMetalPaperState } = useMetalPaperState();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sideFilter, setSideFilter] = useState('ALL');
  const [actionStatus, setActionStatus] = useState('');

  useEffect(() => {
    const refresh = () => setPaperState(getPaperState());
    window.addEventListener(PAPER_STATE_EVENT, refresh);
    return () => window.removeEventListener(PAPER_STATE_EVENT, refresh);
  }, []);

  const equityOrders = (paperState.orders || []).filter((order) => !metalBySymbol.has(order.symbol));
  const metalOrders = (metalPaperState?.orders || []).map((order) => ({
    id: order.id,
    symbol: order.symbol,
    side: order.side === 'BUY' ? 'Buy' : 'Sell',
    orderType: order.orderType === 'LIMIT' ? 'Limit' : 'Market',
    qty: Number(order.quantityGrams),
    price: Number(order.executionPricePerGram || order.limitPricePerGram),
    totalValue: Number(order.grossValue || (order.quantityGrams * (order.executionPricePerGram || order.limitPricePerGram))),
    charges: Number(order.charges || 0),
    status: METAL_STATUS[order.status] || order.status,
    date: new Date(order.createdAt).toLocaleString('en-IN'),
    isMetal: true,
  }));
  const orders = [...metalOrders, ...equityOrders];

  const filteredOrders = orders.filter((order) => {
    if (statusFilter !== 'ALL' && order.status.toUpperCase() !== statusFilter) return false;
    if (sideFilter !== 'ALL' && order.side.toUpperCase() !== sideFilter) return false;
    return true;
  });

  const executedOrders = orders.filter((o) => o.status === 'Executed');
  const pendingOrders = orders.filter((o) => o.status === 'Pending');
  const totalTurnover = executedOrders.reduce((acc, order) => acc + Number(order.totalValue || (order.qty * order.price)), 0);

  const handleCancelOrder = async (order) => {
    setActionStatus('');
    if (order.isMetal) {
      try {
        const payload = await marketApi.cancelMetalPaperOrder(order.id);
        setMetalPaperState(payload);
        setActionStatus(`${order.symbol} limit order cancelled and its reservation was released.`);
      } catch (error) {
        setActionStatus(error.message);
      }
      return;
    }
    const updatedOrders = equityOrders.map((item) =>
      item.id === order.id ? { ...item, status: 'Cancelled' } : item
    );
    const nextState = { ...paperState, orders: updatedOrders };
    savePaperState(nextState);
    setPaperState(nextState);
    setActionStatus(`${order.symbol} paper order cancelled.`);
  };

  return (
    <div className="page orders-page">
      <div className="page-title orders-header-title">
        <div>
          <span>Trade Book & History</span>
          <h1>Orders & Executions</h1>
        </div>
        <div className="orders-header-actions">
          <Link to="/paper-trading" className="primary-button">
            <PlusCircle size={16} /> New Order
          </Link>
        </div>
      </div>

      {actionStatus && <p className="paper-note" role="status">{actionStatus}</p>}

      {/* Orders KPI Metrics */}
      <section className="orders-kpi-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Total Executed Turnover</span>
          <strong className="kpi-value">{formatCurrency(totalTurnover)}</strong>
          <small className="kpi-subtext">Across {executedOrders.length} completed trades</small>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Total Placed Orders</span>
          <strong className="kpi-value">{orders.length}</strong>
          <small className="kpi-subtext">Lifetime trade requests</small>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Pending Limit Orders</span>
          <strong className="kpi-value gain">{pendingOrders.length}</strong>
          <small className="kpi-subtext">Awaiting market price trigger</small>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Execution Success Rate</span>
          <strong className="kpi-value">
            {orders.length ? Math.round((executedOrders.length / orders.length) * 100) : 100}%
          </strong>
          <small className="kpi-subtext">Instant execution fill</small>
        </div>
      </section>

      {/* Filter Tabs */}
      <section className="panel orders-filter-bar">
        <div className="filter-group">
          <span className="filter-label"><Filter size={14} /> Status:</span>
          {['ALL', 'EXECUTED', 'PENDING', 'CANCELLED', 'REJECTED'].map((st) => (
            <button
              key={st}
              className={`filter-btn ${statusFilter === st ? 'active' : ''}`}
              onClick={() => setStatusFilter(st)}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="filter-group">
          <span className="filter-label">Side:</span>
          {['ALL', 'BUY', 'SELL'].map((sd) => (
            <button
              key={sd}
              className={`filter-btn ${sideFilter === sd ? 'active' : ''}`}
              onClick={() => setSideFilter(sd)}
            >
              {sd}
            </button>
          ))}
        </div>
      </section>

      {/* Orders Table */}
      <section className="panel orders-table-panel">
        <div className="table-responsive">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Date / Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Execution Price</th>
                <th>Total Value</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const isBuy = order.side === 'Buy';
                const totalValue = Number(order.totalValue || (order.qty * order.price));
                const symbolRoute = order.isMetal ? metalBySymbol.get(order.symbol)?.route : `/stocks/${order.symbol}`;

                return (
                  <tr key={order.id}>
                    <td><code className="order-id-code">{order.id}</code></td>
                    <td>{order.date}</td>
                    <td>
                      <Link to={symbolRoute} className="order-symbol-link">
                        <b>{order.symbol}</b>
                      </Link>
                    </td>
                    <td>
                      <span className={`side-badge ${isBuy ? 'badge-buy' : 'badge-sell'}`}>
                        {isBuy ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {order.side}
                      </span>
                    </td>
                    <td><span className="type-badge">{order.orderType || 'Market'}</span></td>
                    <td><b>{order.qty} {order.isMetal ? 'g' : ''}</b></td>
                    <td>{formatCurrency(order.price)}{order.isMetal ? '/g' : ''}</td>
                    <td>
                      <strong>{formatCurrency(totalValue)}</strong>
                      {order.isMetal && order.charges > 0 ? <small> + {formatCurrency(order.charges)} estimated charges</small> : null}
                    </td>
                    <td>
                      <span className={`status-badge-custom status-${order.status.toLowerCase()}`}>
                        {order.status === 'Executed' && <CheckCircle2 size={13} />}
                        {order.status === 'Pending' && <Clock size={13} />}
                        {(order.status === 'Cancelled' || order.status === 'Rejected') && <XCircle size={13} />}
                        {order.status}
                      </span>
                    </td>
                    <td>
                      {order.status === 'Pending' ? (
                        <button
                          type="button"
                          className="cancel-order-btn"
                          onClick={() => handleCancelOrder(order)}
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="order-na-text">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredOrders.length === 0 && (
          <div className="empty-orders-state">
            <FileText size={40} className="empty-icon" />
            <h3>No orders matching this filter</h3>
            <p>You can execute simulated paper trades anytime from the Paper Trading page or Live Terminal.</p>
            <Link to="/paper-trading" className="primary-button">
              Go to Paper Trading
            </Link>
          </div>
        )}
      </section>
    </div>
  );
};

export default Orders;
