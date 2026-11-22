import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Info,
  Minus,
  RefreshCw,
  ShieldQuestion,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { marketApi } from '../services/api';
import './MetalAIInsights.css';

const trendMeta = {
  bullish: { label: 'Bullish', icon: TrendingUp, tone: 'bullish' },
  bearish: { label: 'Bearish', icon: TrendingDown, tone: 'bearish' },
  neutral: { label: 'Neutral', icon: Minus, tone: 'neutral' },
};

const price = (value) => (Number.isFinite(Number(value)) && Number(value) > 0
  ? `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  : 'Unavailable');

const signedPercent = (value) => (Number.isFinite(Number(value))
  ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`
  : 'Unavailable');

const signalLabels = {
  bullish: 'Price above rising averages',
  bearish: 'Price below falling averages',
  neutral: 'Averages not aligned',
  'above-sma20': 'Above 20-day average',
  'below-sma20': 'Below 20-day average',
  'above-sma50': 'Above 50-day average',
  'below-sma50': 'Below 50-day average',
  overbought: 'RSI overbought (≥70)',
  oversold: 'RSI oversold (≤30)',
  'near-52w-high': 'Within 2% of 52-week high',
  'near-52w-low': 'Within 2% of 52-week low',
  'above-20-bar-resistance': 'Trading above 20-bar resistance',
  'below-20-bar-support': 'Trading below 20-bar support',
};

const MetalAIInsights = ({ metal = 'GOLD' }) => {
  const [insight, setInsight] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setError('');
    marketApi.getMetalInsight(metal)
      .then((data) => {
        if (!active) return;
        setInsight(data);
        setStatus('ready');
      })
      .catch((requestError) => {
        if (!active) return;
        setInsight(null);
        setError(requestError.message || 'The metals insight could not be loaded.');
        setStatus(requestError.code === 'metals_insight_unavailable' ? 'unavailable' : 'error');
      });
    return () => { active = false; };
  }, [metal, retryKey]);

  const retry = useCallback(() => setRetryKey((current) => current + 1), []);

  const meta = trendMeta[insight?.trend] || trendMeta.neutral;
  const TrendIcon = meta.icon;
  const forecast = insight?.forecast;
  const forecastMeta = forecast?.status === 'ok' ? (trendMeta[forecast.direction] || trendMeta.neutral) : null;
  const ForecastIcon = forecastMeta?.icon || Activity;
  const lastBarDate = insight?.history?.lastBarIso
    ? new Date(insight.history.lastBarIso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  return (
    <section className={`metal-ai-insight ${status === 'ready' ? '' : 'is-loading'}`} aria-labelledby="metal-ai-title">
      <header className="metal-ai-head">
        <div>
          <span className="metal-ai-badge"><Sparkles size={14} /> AI METALS INSIGHT · RULES-BASED</span>
          <h3 id="metal-ai-title">{insight?.name || (metal === 'SILVER' ? 'Silver' : 'Gold')} daily technical read</h3>
          {insight?.basisLabel ? <p className="metal-ai-basis">{insight.basisLabel}</p> : null}
        </div>
        <button type="button" className="metal-ai-refresh" onClick={retry} disabled={status === 'loading'}>
          <RefreshCw size={14} className={status === 'loading' ? 'spinning' : ''} /> Refresh
        </button>
      </header>

      {status === 'loading' && (
        <p className="metal-ai-state" role="status">Computing the read from verified daily bars…</p>
      )}

      {(status === 'error' || status === 'unavailable') && (
        <div className="metal-ai-state is-error" role="status">
          <ShieldQuestion size={16} /> {error || 'Verified metals data is unavailable right now.'}
        </div>
      )}

      {status === 'ready' && insight?.status === 'insufficient_history' && (
        <div className="metal-ai-state" role="status">
          <Info size={16} /> {insight.note}
        </div>
      )}

      {status === 'ready' && insight?.status === 'ok' && (
        <>
          <div className="metal-ai-grid">
            <div className={`metal-ai-trend tone-${meta.tone}`}>
              <span className="metal-ai-trend-label">Daily trend</span>
              <strong><TrendIcon size={18} /> {meta.label}</strong>
              <span className="metal-ai-trend-price">{price(insight.metrics.price)} / {insight.unit === 'INR/kg' ? 'kg' : '10g'}</span>
              {Number.isFinite(insight.quote?.changePercent) ? (
                <span className={insight.quote.changePercent >= 0 ? 'is-gain' : 'is-loss'}>
                  {signedPercent(insight.quote.changePercent)} versus previous close
                </span>
              ) : null}
            </div>

            <div className="metal-ai-metrics">
              <div><span>RSI (14)</span><strong>{insight.metrics.rsi14 ?? 'Unavailable'}</strong></div>
              <div><span>SMA 20</span><strong>{price(insight.metrics.sma20)}</strong></div>
              <div><span>SMA 50</span><strong>{price(insight.metrics.sma50)}</strong></div>
              <div><span>20-bar support</span><strong>{price(insight.metrics.support)}</strong></div>
              <div><span>20-bar resistance</span><strong>{price(insight.metrics.resistance)}</strong></div>
              <div><span>Annualised vol</span><strong>{Number.isFinite(insight.metrics.volatilityPercent) ? `${insight.metrics.volatilityPercent}%` : 'Unavailable'}</strong></div>
            </div>
          </div>

          <div className="metal-ai-range">
            <span>52-week high {price(insight.metrics.week52High)} · {signedPercent(insight.metrics.distanceFromHighPercent)} away</span>
            <span>52-week low {price(insight.metrics.week52Low)} · {signedPercent(insight.metrics.distanceFromLowPercent)} above</span>
          </div>

          {insight.summary ? <p className="metal-ai-summary">{insight.summary}</p> : null}

          <div className="metal-ai-signals">
            {(insight.signals || []).map((signal) => (
              <span key={signal} className={`metal-ai-chip ${signal}`}>{signalLabels[signal] || signal}</span>
            ))}
          </div>

          <div className={`metal-ai-forecast tone-${forecastMeta?.tone || 'neutral'}`}>
            <div className="metal-ai-forecast-head">
              <ForecastIcon size={16} />
              <strong>{forecast?.status === 'ok'
                ? `Model probability ${forecast.probabilityPercent}% ${forecast.direction}`
                : 'Forecast withheld'}</strong>
            </div>
            {forecast?.status === 'ok' ? (
              <>
                <p>{forecast.target}. Sensitivity range {forecast.sensitivityRangePercent?.[0]}%–{forecast.sensitivityRangePercent?.[1]}%.</p>
                {Number.isFinite(forecast.performance?.accuracyPercent) ? (
                  <p className="metal-ai-forecast-perf">
                    <Target size={13} /> Out-of-sample hit rate {forecast.performance.accuracyPercent}% · Brier {forecast.performance.brierScore} on {forecast.performance.sampleCount} holdout calls
                  </p>
                ) : null}
                <p className="metal-ai-forecast-note">{forecast.disclaimer}</p>
              </>
            ) : (
              <p>{forecast?.note || 'A forecast is withheld until enough verified history exists.'}</p>
            )}
          </div>

          <footer className="metal-ai-foot">
            <span>{insight.history.provider} · {insight.history.bars} bars · last bar {lastBarDate}</span>
            <span>{insight.disclaimer}</span>
          </footer>
        </>
      )}
    </section>
  );
};

export default MetalAIInsights;
