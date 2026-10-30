import { useState } from 'react';
import { CheckCircle2, MessageSquarePlus } from 'lucide-react';

const STORAGE_KEY = 'sharemarket:feedback';

const Feedback = () => {
  const [type, setType] = useState('Feature request');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ type, subject, message, date: new Date().toISOString() }, ...existing]));
    setSubject('');
    setMessage('');
    setSubmitted(true);
  };

  return (
    <div className="page">
      <div className="page-title"><span>Help us improve</span><h1>Suggestions & Feedback</h1></div>
      <section className="auth-panel feedback-panel">
        <div className="section-heading"><div><span>Share your idea</span><h2>Tell us what to build next</h2></div><MessageSquarePlus size={24} /></div>
        <form className="feedback-form" onSubmit={submit}>
          <label>Type<select value={type} onChange={(event) => setType(event.target.value)}><option>Feature request</option><option>Bug report</option><option>General feedback</option></select></label>
          <label>Subject<input required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Example: Add mutual funds" /></label>
          <label>Details<textarea required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tell us more" rows="6" /></label>
          <button className="primary-button" type="submit"><MessageSquarePlus size={17} /> Submit feedback</button>
        </form>
        {submitted ? <p className="success-message"><CheckCircle2 size={16} /> Thanks, your feedback was saved.</p> : null}
      </section>
    </div>
  );
};

export default Feedback;
