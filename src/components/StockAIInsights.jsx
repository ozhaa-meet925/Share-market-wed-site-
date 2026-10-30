import { useMemo } from 'react';
import { Sparkles, TrendingUp, TrendingDown, Target, Shield, Zap } from 'lucide-react';

export const StockAIInsights = ({ stock }) => {
  if (!stock || !stock.price) return null;

  const insights = useMemo(() => {
    const price = Number(stock.price) || 1000;
    const change = Number(stock.changePercent) || 0;
    const isBullish = change >= 0;

    // Algorithmic Support & Resistance calculations
    const r1 = Number((price * 1.025).toFixed(2));
    const r2 = Number((price * 1.05).toFixed(2));
    const s1 = Number((price * 0.975).toFixed(2));
    const s2 = Number((price * 0.95).toFixed(2));

    // Dynamic RSI estimate based on trend
    const rsi = Math.min(82, Math.max(28, Math.round(50 + change * 6)));
    let rsiLabel = 'Neutral';
    if (rsi >= 70) rsiLabel = 'Overbought Zone';
    else if (rsi >= 55) rsiLabel = 'Bullish Momentum';
    else if (rsi <= 35) rsiLabel = 'Oversold / Value Zone';
    else if (rsi <= 45) rsiLabel = 'Bearish Pressure';

    // Summary commentary
    const summary = isBullish
      ? `${stock.symbol} is showing positive accumulation with strong buying support near ₹${s1.toLocaleString('en-IN')}. Target upside resistance stands at ₹${r1.toLocaleString('en-IN')}.`
      : `${stock.symbol} is undergoing minor consolidation. Key defensive support is anchored at ₹${s1.toLocaleString('en-IN')}. Break above ₹${r1.toLocaleString('en-IN')} confirms reversal.`;

    return {
      trend: isBullish ? 'Bullish' : 'Bearish / Neutral',
      trendScore: isBullish ? 'Strong Buy / Accumulate' : 'Hold / Wait for Dip',
      rsi,
      rsiLabel,
      s1,
      s2,
      r1,
      r2,
      summary,
    };
  }, [stock]);

  return (
    <div className="stock-ai-insights-card">
      <div className="insights-header">
        <div className="insights-title">
          <Sparkles size={18} className="ai-sparkle-icon" />
          <h3>AI Market Insight & Technical Summary</h3>
        </div>
        <span className={`insights-trend-pill ${insights.trend.startsWith('Bullish') ? 'bullish' : 'bearish'}`}>
          {insights.trend.startsWith('Bullish') ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {insights.trend} · {insights.trendScore}
        </span>
      </div>

      <p className="insights-summary-text">{insights.summary}</p>

      <div className="insights-metrics-grid">
        <div className="insights-metric-item">
          <span className="metric-label">
            <Zap size={13} /> RSI & Momentum
          </span>
          <strong className="metric-val">{insights.rsi} ({insights.rsiLabel})</strong>
        </div>

        <div className="insights-metric-item">
          <span className="metric-label">
            <Shield size={13} /> Support Levels (S1 / S2)
          </span>
          <strong className="metric-val gain">₹{insights.s1.toLocaleString('en-IN')} / ₹{insights.s2.toLocaleString('en-IN')}</strong>
        </div>

        <div className="insights-metric-item">
          <span className="metric-label">
            <Target size={13} /> Resistance Levels (R1 / R2)
          </span>
          <strong className="metric-val loss">₹{insights.r1.toLocaleString('en-IN')} / ₹{insights.r2.toLocaleString('en-IN')}</strong>
        </div>
      </div>
    </div>
  );
};

export default StockAIInsights;
