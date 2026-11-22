import { useEffect, useState } from 'react';
import { LayoutGrid, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import './SectorHeatmap.css';

const SectorHeatmap = () => {
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchHeatmap = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analytics/sector-heatmap');
      const data = await res.json();
      setSectors(data);
    } catch (err) {
      console.error('Heatmap fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHeatmap();
  }, []);

  const getIntensityColor = (change) => {
    if (change > 1.5) return '#15803d'; // dark green
    if (change > 0.5) return '#16a34a'; // medium green
    if (change > 0) return '#4ade80';   // light green
    if (change === 0) return '#64748b'; // neutral
    if (change > -0.5) return '#f87171'; // light red
    if (change > -1.5) return '#dc2626'; // medium red
    return '#991b1b'; // dark red
  };

  return (
    <div className="heatmap-widget-container">
      <div className="heatmap-header">
        <div>
          <h2>Sector Market Heatmap</h2>
          <p>Real-time sector performance &amp; top constituent movement</p>
        </div>
        <button type="button" className="refresh-btn" onClick={fetchHeatmap}>
          <RefreshCw size={14} className={loading ? 'spinning' : ''} /> Refresh
        </button>
      </div>

      <div className="heatmap-grid">
        {sectors.map((sec) => (
          <div
            key={sec.sector}
            className="sector-card"
            style={{ borderTop: `4px solid ${getIntensityColor(sec.change)}` }}
          >
            <div className="sector-card-header">
              <span className="sector-name">{sec.sector}</span>
              <span
                className="sector-badge"
                style={{
                  background: sec.change >= 0 ? 'rgba(22, 163, 74, 0.15)' : 'rgba(220, 38, 38, 0.15)',
                  color: sec.change >= 0 ? '#16a34a' : '#dc2626',
                }}
              >
                {sec.change >= 0 ? '+' : ''}{sec.change.toFixed(2)}%
              </span>
            </div>

            <div className="sector-stocks-grid">
              {sec.stocks.map((stk) => (
                <Link
                  key={stk.symbol}
                  to={`/stocks/${stk.symbol}`}
                  className="stock-heatmap-tile"
                  style={{ backgroundColor: getIntensityColor(stk.change) }}
                >
                  <span className="stk-sym">{stk.symbol}</span>
                  <span className="stk-chg">{stk.change >= 0 ? '+' : ''}{stk.change.toFixed(1)}%</span>
                  <span className="stk-price">₹{stk.price}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SectorHeatmap;
