import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Database, KeyRound, Lock, Scale, ServerOff } from 'lucide-react';
import './Compliance.css';

const TONE = {
  available: 'good',
  configured: 'good',
  not_connected: 'off',
  not_configured: 'warn',
  not_available: 'bad',
  not_integrated: 'off',
};

const LABEL = {
  available: 'Available',
  configured: 'Configured',
  not_connected: 'Not Connected',
  not_configured: 'Not Configured',
  not_available: 'Unavailable',
  not_integrated: 'Not Integrated',
};

const Compliance = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/compliance/status', { credentials: 'same-origin' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
        return payload;
      })
      .then((payload) => { if (active) setData(payload); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <div className="page"><div className="compliance-loading" role="status">Checking compliance and data-source status…</div></div>;

  if (error) {
    return (
      <div className="page">
        <div className="page-title"><span>Transparency</span><h1>Compliance &amp; Data Sources</h1></div>
        <div className="compliance-error"><AlertTriangle size={18} /><span>{error}</span></div>
      </div>
    );
  }

  return (
    <div className="page compliance-page">
      <div className="page-title"><span>Transparency</span><h1>Compliance &amp; Data Sources</h1></div>

      <div className={`compliance-master ${data.liveTrading.enabled ? 'is-on' : ''}`}>
        {data.liveTrading.enabled ? <CheckCircle2 size={18} /> : <Lock size={18} />}
        <div>
          <strong>{data.liveTrading.enabled ? 'Live order routing is enabled on this server' : 'Live order routing is disabled'}</strong>
          <p>{data.liveTrading.requirement}</p>
        </div>
      </div>

      <section className="compliance-section">
        <h2><AlertTriangle size={17} /> Before enabling live trading</h2>
        <p className="compliance-checklist-intro">
          These are operator checks, not certifications. This page cannot verify a broker sandbox, a successful stop order, production readiness, or regulatory approval.
        </p>
        <ol className="compliance-checklist">
          <li>
            <div>
              <strong>Connect and verify the broker account</strong>
              <p>Authorize through the broker’s official login, then verify the account, funds, positions, quotes, and order book. Never share credentials or access tokens.</p>
              <Link to="/broker-connections">Open Broker Connections</Link>
            </div>
            <span className="compliance-checklist-status">Manual verification required</span>
          </li>
          <li>
            <div>
              <strong>Test broker-side stop-loss protection</strong>
              <p>Confirm stop submission, modification, cancellation, and session-expiry handling for the broker, instrument, and product. Zerodha has no official sandbox; do not treat an isolated mock as broker verification.</p>
            </div>
            <span className="compliance-checklist-status">Not verified here</span>
          </li>
          <li>
            <div>
              <strong>Review production safeguards</strong>
              <p>Verify HTTPS, persistent server and worker health, fresh market data, risk limits, kill switch, recovery procedures, and alert delivery. In-app alerts cannot detect a fully offline host; use external uptime monitoring.</p>
            </div>
            <span className="compliance-checklist-status">Operator review required</span>
          </li>
          <li>
            <div>
              <strong>Confirm regulatory and broker requirements</strong>
              <p>Ask the broker and a qualified compliance adviser about applicable exchange/SEBI approvals, algo-trading rules, API terms, and permissions for your intended use. This website does not certify compliance.</p>
            </div>
            <span className="compliance-checklist-status">External confirmation required</span>
          </li>
        </ol>
        <p className="compliance-checklist-warning">
          Keep live order routing disabled until every applicable check is completed and documented. Turning on the server switch alone does not make live trading safe or compliant.
        </p>
      </section>

      <section className="compliance-section">
        <h2><KeyRound size={17} /> Broker connectivity</h2>
        <div className="compliance-brokers">
          {data.brokers.map((broker) => {
            const status = broker.configured ? 'configured' : 'not_connected';
            return (
              <div className="compliance-broker" key={broker.id}>
                <div>
                  <strong>{broker.name}</strong>
                  <span>Mode: {broker.mode} · Execution: {broker.orderPlacement ? 'available' : 'gated'}</span>
                  {!broker.configured ? <span className="compliance-missing">Missing: {broker.missing.join(', ')}</span> : null}
                </div>
                <span className={`compliance-badge ${TONE[status]}`}>{LABEL[status]}</span>
              </div>
            );
          })}
        </div>
        <p className="compliance-note">
          Streaming feeds are not bundled: {data.brokers.map((broker) => `${broker.name} — ${broker.streamingReason}`).join(' ')}
        </p>
      </section>

      <section className="compliance-section">
        <h2><Database size={17} /> Data sources</h2>
        <div className="compliance-sources">
          {data.dataSources.map((source) => (
            <article className="compliance-source" key={source.id}>
              <header>
                <strong>{source.label}</strong>
                <span className={`compliance-badge ${TONE[source.status] || 'off'}`}>{LABEL[source.status] || source.status}</span>
              </header>
              <p>{source.detail}</p>
              <footer><Scale size={13} /> {source.licensing}</footer>
            </article>
          ))}
        </div>
      </section>

      <section className="compliance-section">
        <h2><Lock size={17} /> Compliance disclosures</h2>
        <div className="compliance-disclosures">
          {data.disclosures.map((item) => (
            <div key={item.id}>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="compliance-footnote">
        <ServerOff size={14} /> Status is computed live from server configuration; credentials are never exposed. Connect a broker from{' '}
        <Link to="/broker-connections">Broker Connections</Link>. Markets close at 15:30 IST and live orders are rejected outside the session.
        <span> Last checked {new Date(data.generatedAt).toLocaleString('en-IN')}.</span>
      </p>
    </div>
  );
};

export default Compliance;
