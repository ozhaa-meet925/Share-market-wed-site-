import { useState } from 'react';
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
import { getPaperState, resetPaperTrading } from '../services/paperTrading';

const formatCurrency = (val) =>
  `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Orders = () => {
  const [paperState, setPaperState] = useState(getPaperState);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sideFilter, setSideFilter] = useState('ALL');

  const orders = paperState.orders || [];

  const filteredOrders = orders.filter((order) => {
    if (statusFilter !== 'ALL' && order.status.toUpperCase() !== statusFilter) return false;
    if (sideFilter !== 'ALL' && order.side.toUpperCase() !== sideFilter) return false;
    return true;
  });

  const executedOrders = orders.filter((o) => o.status === 'Executed');
  const pendingOrders = orders.filter((o) => o.status === 'Pending');
  const totalTurnover = executedOrders.reduce((acc, o) => acc + (o.qty * o.price), 0);

  const handleCancelOrder = (orderId) => {
    const updatedOrders = orders.map((o) =>
      o.id === orderId ? { ...o, status: 'Cancelled' } : o
    );
    const nextState = { ...paperState, orders: updatedOrders };
    localStorage.setItem('share-market-paper-state', JSON.stringify(nextState));
    setPaperState(nextState);
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
          {['ALL', 'EXECUTED', 'PENDING', 'CANCELLED'].map((st) => (
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
                const totalValue = order.qty * order.price;

                return (
                  <tr key={order.id}>
                    <td><code className="order-id-code">{order.id}</code></td>
                    <td>{order.date}</td>
                    <td>
                      <Link to={`/stocks/${order.symbol}`} className="order-symbol-link">
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
                    <td><b>{order.qty}</b></td>
                    <td>{formatCurrency(order.price)}</td>
                    <td><strong>{formatCurrency(totalValue)}</strong></td>
                    <td>
                      <span className={`status-badge-custom status-${order.status.toLowerCase()}`}>
                        {order.status === 'Executed' && <CheckCircle2 size={13} />}
                        {order.status === 'Pending' && <Clock size={13} />}
                        {order.status === 'Cancelled' && <XCircle size={13} />}
                        {order.status}
                      </span>
                    </td>
                    <td>
                      {order.status === 'Pending' ? (
                        <button
                          type="button"
                          className="cancel-order-btn"
                          onClick={() => handleCancelOrder(order.id)}
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
