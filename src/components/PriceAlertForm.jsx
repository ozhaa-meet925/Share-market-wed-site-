import { useEffect, useState } from 'react';
import { BellPlus, Trash2 } from 'lucide-react';
import { createAlert, evaluateAlerts, getAlerts, removeAlert } from '../services/alerts';

const PriceAlertForm = ({ stock, evaluateCurrentPrice = true }) => {
  const [direction, setDirection] = useState('above');
  const [target, setTarget] = useState(stock.isLive && stock.price ? stock.price.toFixed(2) : '');
  const [alerts, setAlerts] = useState(() => getAlerts().filter((alert) => alert.symbol === stock.symbol));
  const [message, setMessage] = useState('');

  useEffect(() => {
    const currentAlerts = evaluateCurrentPrice ? evaluateAlerts([stock]) : getAlerts();
    setAlerts(currentAlerts.filter((alert) => alert.symbol === stock.symbol));
  }, [stock, evaluateCurrentPrice]);

  const submit = (event) => {
    event.preventDefault();
    const numericTarget = Number(target);
    if (!numericTarget || numericTarget <= 0) {
      setMessage('Enter a valid target price.');
      return;
    }
    createAlert({ symbol: stock.symbol, target: numericTarget, direction });
    setAlerts(getAlerts().filter((alert) => alert.symbol === stock.symbol));
    setMessage('Price alert saved.');
  };

  const deleteAlert = (id) => setAlerts(removeAlert(id).filter((alert) => alert.symbol === stock.symbol));

  return (
    <section className="price-alert-section">
      <div className="section-heading">
        <div>
          <span>Personal alert</span>
          <h2>Price alert</h2>
        </div>
        <BellPlus size={20} />
      </div>
      <form className="price-alert-form" onSubmit={submit}>
        <select value={direction} onChange={(event) => setDirection(event.target.value)} aria-label="Alert condition">
          <option value="above">Goes above</option>
          <option value="below">Goes below</option>
        </select>
        <input type="number" min="0.01" step="0.01" value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Target price" />
        <button className="secondary-button" type="submit"><BellPlus size={16} /> Add</button>
      </form>
      {message ? <p className="alert-form-message">{message}</p> : null}
      {alerts.map((alert) => (
        <div className="price-alert-row" key={alert.id}>
          <span>{alert.direction === 'above' ? 'Above' : 'Below'} Rs {alert.target.toLocaleString('en-IN')}</span>
          <span className={alert.triggered ? 'gain' : ''}>{alert.triggered ? 'Triggered' : 'Waiting'}</span>
          <button type="button" aria-label={`Delete ${stock.symbol} price alert`} onClick={() => deleteAlert(alert.id)}><Trash2 size={16} /></button>
        </div>
      ))}
    </section>
  );
};

export default PriceAlertForm;
