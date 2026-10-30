import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';
import { Radio, Wifi, WifiOff } from 'lucide-react';

const providerLabels = {
  groww: { label: 'Groww Live', color: '#00d09c' },
  upstox: { label: 'Upstox Live', color: '#6236ff' },
  zerodha: { label: 'Zerodha Kite', color: '#387ed1' },
  alpha_vantage: { label: 'Alpha Vantage', color: '#f5a623' },
  live_engine: { label: 'Live Engine', color: '#10b981' },
};

const DataSourceBadge = () => {
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    let active = true;
    const fetchProvider = async () => {
      try {
        const info = await marketApi.getProviderInfo();
        if (active) setProvider(info);
      } catch {
        if (active) setProvider(null);
      }
    };
    fetchProvider();
    const id = setInterval(fetchProvider, 30000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (!provider) return null;

  const active = provider.active;
  if (!active) {
    return (
      <div className="data-source-badge" style={{ '--badge-color': '#d97706' }}>
        <WifiOff size={13} />
        <span className="data-source-label">Add free Upstox token</span>
      </div>
    );
  }
  const meta = providerLabels[active] || providerLabels.live_engine;
  const isLiveAPI = active !== 'live_engine';

  return (
    <div className="data-source-badge" style={{ '--badge-color': meta.color }}>
      <span className="data-source-dot" />
      {isLiveAPI ? <Wifi size={13} /> : <Radio size={13} />}
      <span className="data-source-label">{meta.label}</span>
      {Object.entries(provider.configured || {}).filter(([, v]) => v).length > 1 && (
        <span className="data-source-count">
          {Object.values(provider.configured).filter(Boolean).length} sources
        </span>
      )}
    </div>
  );
};

export default DataSourceBadge;
