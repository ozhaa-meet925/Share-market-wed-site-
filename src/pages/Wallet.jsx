import { useState } from 'react';
import { CreditCard, WalletCards } from 'lucide-react';
import { getPaperState } from '../services/paperTrading';

const Wallet = () => {
  const state = getPaperState();
  const [amount, setAmount] = useState('1000');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [payments, setPayments] = useState(() => JSON.parse(localStorage.getItem('sharemarket:payments') || '[]'));

  const savePayment = (payment) => {
    const next = [payment, ...payments].slice(0, 10);
    setPayments(next);
    localStorage.setItem('sharemarket:payments', JSON.stringify(next));
  };

  const updatePayment = (id, changes) => {
    setPayments((current) => {
      const next = current.map((payment) => payment.id === id ? { ...payment, ...changes } : payment);
      localStorage.setItem('sharemarket:payments', JSON.stringify(next));
      return next;
    });
  };

  const startPayment = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus('Creating secure Razorpay order...');
    try {
      const response = await fetch('/api/payments/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: Number(amount) }) });
      const order = await response.json();
      if (!response.ok) throw new Error(order.error || 'Unable to create payment order.');
      if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable. Check your internet connection.');
      savePayment({ id: order.id, amount: Number(amount), orderId: order.id, status: 'Pending', date: new Date().toLocaleString('en-IN') });
      const checkout = new window.Razorpay({ key: order.keyId, amount: order.amount, currency: order.currency, name: 'ShareMarket', description: 'Wallet top-up', order_id: order.id, handler: async (result) => {
        const verification = await fetch('/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: result.razorpay_order_id, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature }) });
        const verified = await verification.json();
        updatePayment(result.razorpay_order_id, { id: result.razorpay_payment_id, status: verified.verified ? 'Verified' : 'Failed' });
        setStatus(verified.verified ? 'Payment verified successfully.' : 'Payment received but verification failed. Funds were not credited.');
      }, theme: { color: '#0d6f4e' } });
      checkout.open();
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-title"><span>Payments</span><h1>Wallet</h1></div>
      <div className="content-grid">
        <section className="panel">
          <div className="portfolio-total wallet-total"><WalletCards size={34} /><span>Available Virtual Cash</span><strong>Rs {state.cash.toLocaleString('en-IN')}</strong></div>
          <div className="compact-list">
            {state.transactions.map((transaction) => <div className="compact-row" key={transaction.id}><div><strong>{transaction.note}</strong><span>{transaction.date} · {transaction.type}</span></div><b className={transaction.amount >= 0 ? 'gain' : 'loss'}>{transaction.amount >= 0 ? '+' : ''}Rs {Math.abs(transaction.amount).toLocaleString('en-IN')}</b></div>)}
          </div>
        </section>
        <form className="panel payment-panel" onSubmit={startPayment}>
          <div className="section-heading"><div><span>Add funds</span><h2>Razorpay checkout</h2></div><CreditCard size={23} /></div>
          <p className="form-help">Use Razorpay test mode to add funds securely. Your card and UPI details never pass through this app.</p>
          <label>Amount in INR<input required min="10" max="10000000" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Preparing...' : 'Pay with Razorpay'}</button>
          {status ? <p className={status.startsWith('Payment received') ? 'success-message' : 'paper-note'}>{status}</p> : null}
          <div className="payment-history"><div className="section-heading"><h3>Payment history</h3><span>{payments.length} records</span></div>{payments.length ? payments.map((payment) => <div className="compact-row" key={payment.id}><div><strong>Rs {payment.amount.toLocaleString('en-IN')}</strong><span>{payment.date} · {payment.id}</span></div><b className={payment.status === 'Verified' ? 'gain' : 'loss'}>{payment.status}</b></div>) : <p className="form-help">Verified Razorpay payments will appear here.</p>}</div>
        </form>
      </div>
    </div>
  );
};

export default Wallet;
