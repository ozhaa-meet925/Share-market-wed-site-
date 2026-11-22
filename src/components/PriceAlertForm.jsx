import { useEffect, useState } from 'react';
import { BellPlus, Trash2 } from 'lucide-react';
import { notificationsApi } from '../services/notifications';

const PriceAlertForm = ({ stock, unitLabel = '₹' }) => {
  const [purpose, setPurpose] = useState('target');
  const [direction, setDirection] = useState('above');
  const [target, setTarget] = useState(stock.price ? Number(stock.price).toFixed(2) : '');
  const [alerts, setAlerts] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setAlerts([]);
    notificationsApi.list(1)
      .then((payload) => {
        if (active) setAlerts((payload.priceAlerts || []).filter((alert) => alert.symbol === stock.symbol));
      })
      .catch((error) => {
        if (active) setMessage(error.status === 401 ? 'Sign in to save account price alerts.' : error.message);
      });
    return () => { active = false; };
  }, [stock.symbol]);

  const submit = async (event) => {
    event.preventDefault();
    const numericTarget = Number(target);
    if (!numericTarget || numericTarget <= 0) {
      setMessage('Enter a valid target price.');
      return;
    }
    setBusy(true);
    try {
      const payload = await notificationsApi.createPriceAlert({ symbol: stock.symbol, target: numericTarget, direction, purpose });
      setAlerts((payload.priceAlerts || []).filter((alert) => alert.symbol === stock.symbol));
      setMessage('Price alert saved to your account. The server evaluates it against verified provider quotes.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAlert = async (id) => {
    try {
      const payload = await notificationsApi.deletePriceAlert(id);
      setAlerts((payload.priceAlerts || []).filter((alert) => alert.symbol === stock.symbol));
      setMessage('Price alert removed.');
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <section className="price-alert-section" id="price-alerts">
      <div className="section-heading">
        <div>
          <span>Personal alert</span>
          <h2>Price alert</h2>
        </div>
        <BellPlus size={20} />
      </div>
      <form className="price-alert-form" onSubmit={submit}>
        <select
          value={purpose}
          onChange={(event) => {
            const nextPurpose = event.target.value;
            setPurpose(nextPurpose);
            if (nextPurpose === 'stop_loss') setDirection('below');
            if (nextPurpose === 'take_profit') setDirection('above');
          }}
          aria-label="Alert purpose"
        >
          <option value="target">Target</option>
          <option value="stop_loss">Stop-loss</option>
          <option value="take_profit">Take-profit</option>
        </select>
        <select value={direction} onChange={(event) => setDirection(event.target.value)} aria-label="Alert condition">
          <option value="above">Goes above</option>
          <option value="below">Goes below</option>
        </select>
        <input type="number" min="0.01" step="0.01" value={target} onChange={(event) => setTarget(event.target.value)} aria-label={`Target price in ${unitLabel}`} />
        <button className="secondary-button" type="submit" disabled={busy}><BellPlus size={16} /> {busy ? 'Saving…' : 'Add'}</button>
      </form>
      {message ? <p className="alert-form-message" role="status">{message}</p> : null}
      {alerts.map((alert) => (
        <div className="price-alert-row" key={alert.id}>
          <span>{alert.direction === 'above' ? 'Above' : 'Below'} ₹{Number(alert.target).toLocaleString('en-IN')}</span>
          <span className={alert.triggered ? 'gain' : ''}>{alert.triggered ? `Triggered at ₹${Number(alert.triggeredPrice).toLocaleString('en-IN')}` : 'Waiting'}</span>
          <button type="button" aria-label={`Delete ${stock.symbol} price alert`} onClick={() => deleteAlert(alert.id)}><Trash2 size={16} /></button>
        </div>
      ))}
    </section>
  );
};

export default PriceAlertForm;
