import { useEffect, useState } from 'react';
import { Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { marketApi } from '../services/api';

const providerLabels = {
  kun: 'Kunpeng Data',
  upstox: 'Upstox',
  groww: 'Groww',
  zerodha: 'Zerodha Kite',
  alpha_vantage: 'Alpha Vantage',
};

const LiveDataStatus = () => {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setInfo(await marketApi.getProviderInfo());
    } catch {
      setError('Could not reach the market API. Start the app with npm run dev.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const configured = Object.entries(info?.configured || {})
    .filter(([key, value]) => value && key !== 'live_engine')
    .map(([key]) => providerLabels[key] || key);
  const upstoxHealth = info?.providerHealth?.upstox;
  const upstoxRejected = upstoxHealth?.tokenValid === false;

  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>Market Data Connection</span>
          <h2 style={{ margin: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            {info?.liveDataAvailable
              ? <><Wifi size={20} color="#10b981" /> Live provider connected</>
              : <><WifiOff size={20} color="#d97706" /> Research fallback active</>}
          </h2>
        </div>
        <button type="button" className="secondary-button" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {loading ? 'Checking…' : 'Refresh status'}
        </button>
      </div>

      {error && <p style={{ margin: '10px 0 0', color: '#ef4444', fontSize: '0.86rem' }}>{error}</p>}

      {!error && info && (
        <>
          <p style={{ margin: '8px 0', fontSize: '0.9rem' }}>
            {info.liveDataAvailable
              ? <>Quotes and charts are streaming from <b>{providerLabels[info.active] || info.active}</b>.</>
              : <>Quotes come from the Yahoo Finance research feed: delayed and labelled “not live”. Trading stays disabled until a live provider is connected.</>}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0', fontSize: '0.8rem' }}>
            {configured.length
              ? configured.map((label) => {
                const rejected = label === 'Upstox' && upstoxRejected;
                return (
                  <span
                    key={label}
                    style={{
                      padding: '3px 9px',
                      borderRadius: 999,
                      background: rejected ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                      color: rejected ? '#ef4444' : '#10b981',
                    }}
                  >
                    {label} {rejected ? 'token rejected (401)' : 'token set'}
                  </span>
                );
              })
              : <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(217,119,6,0.12)', color: '#d97706' }}>No live credentials configured</span>}
            <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(148,163,184,0.14)', color: 'var(--text-muted, #94a3b8)' }}>
              <Radio size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Research feed always available
            </span>
          </div>
          {upstoxRejected && (
            <p style={{ margin: '0 0 8px', fontSize: '0.86rem', color: '#d97706' }}>
              Upstox rejected the saved token (401): {upstoxHealth.reason || 'the access token is expired or invalid.'}
            </p>
          )}
          {!info.liveDataAvailable && (
            <div style={{ fontSize: '0.84rem', lineHeight: 1.7, color: 'var(--text-muted, #94a3b8)' }}>
              Current provider setting: <code>{info.configuredProvider || 'kun'}</code>. To enable live prices, set a valid
              provider in <code>.env</code> and restart the server:
              <br />
              <code>MARKET_DATA_PROVIDER=upstox</code> with a fresh <code>UPSTOX_ACCESS_TOKEN</code> (Upstox OAuth token),
              or <code>MARKET_DATA_PROVIDER=kun</code> with <code>KUN_DATA_API_TOKEN</code>.
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default LiveDataStatus;
