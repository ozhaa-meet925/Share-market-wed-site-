import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Shield,
  Zap,
  RefreshCw,
  Info,
  History,
  ListChecks,
} from 'lucide-react';
import { marketApi } from '../services/api';

const numberFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const barsFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (value) => (Number.isFinite(Number(value)) && Number(value) > 0
  ? `₹${numberFormat.format(Number(value))}`
  : 'Unavailable');
const percent = (value) => (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`
  : 'Unavailable');

const trendMeta = {
  bullish: { label: 'Bullish', icon: TrendingUp, tone: 'bullish' },
  bearish: { label: 'Bearish', icon: TrendingDown, tone: 'bearish' },
  neutral: { label: 'Neutral', icon: Minus, tone: 'neutral' },
};

const biasLabel = { up: 'Up bias', down: 'Down bias', sideways: 'Sideways' };

const clampPercent = (value) => Math.min(100, Math.max(0, Number(value)));

const StockAIInsights = ({ stock, exchange = 'NSE' }) => {
  const symbol = stock?.symbol;
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const retry = useCallback(() => setRetryKey((current) => current + 1), []);

  useEffect(() => {
    if (!symbol) return undefined;
    let active = true;
    setStatus('loading');
    setError('');
    marketApi.getAIStockAnalysis(symbol, exchange)
      .then((data) => {
        if (!active) return;
        setAnalysis(data);
        setStatus('ready');
      })
      .catch((requestError) => {
        if (!active) return;
        setAnalysis(null);
        setError(requestError.message || 'Verified research data could not be loaded.');
        setStatus(requestError.code === 'research_data_unavailable' ? 'unavailable' : 'error');
      });
    return () => { active = false; };
  }, [symbol, exchange, retryKey]);

  if (!symbol) return null;

  const meta = trendMeta[analysis?.trend] || trendMeta.neutral;
  const TrendIcon = meta.icon;
  const longTerm = analysis?.longTerm;
  const ltMeta = trendMeta[longTerm?.trend] || trendMeta.neutral;
  const LtIcon = ltMeta.icon;
  const ltYears = Number(longTerm?.years);
  const windowLabel = !Number.isFinite(ltYears)
    ? 'History'
    : ltYears >= 9.5 ? '10-year' : ltYears >= 1.5 ? `${Math.round(ltYears)}-year` : 'Since-listing';

  return (
    <div className="stock-ai-insights-card">
      <div className="insights-header">
        <div className="insights-title">
          <Sparkles size={18} className="ai-sparkle-icon" />
          <h3>Technical Analysis</h3>
        </div>
        {status === 'ready' && (
          <span className={`insights-trend-pill ${meta.tone}`}>
            <TrendIcon size={14} />
            {meta.label} · {analysis.trendScore > 0 ? '+' : ''}{analysis.trendScore} checks
          </span>
        )}
      </div>

      {status === 'loading' && (
        <p className="insights-summary-text">Computing indicators from verified OHLC history…</p>
      )}

      {(status === 'unavailable' || status === 'error') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <p className="insights-summary-text" style={{ margin: 0, flex: '1 1 240px' }}>
            {status === 'unavailable'
              ? `Verified research history is unavailable for ${symbol}, so no technical levels are shown.`
              : error}
          </p>
          <button type="button" className="ai-prompt-chip" onClick={retry}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {status === 'ready' && analysis && (
        <>
          <p className="insights-summary-text">
            20-day trend is {meta.label.toLowerCase()} on {analysis.historyBars} verified daily bars.
            Price {money(analysis.price)} ({Number(analysis.changePercent) >= 0 ? '+' : ''}{analysis.changePercent}%).
          </p>

          <div className="insights-metrics-grid">
            <div className="insights-metric-item">
              <span className="metric-label"><Zap size={13} /> RSI(14)</span>
              <strong className="metric-val">
                {analysis.indicators.rsi14 ?? 'Unavailable'}
              </strong>
            </div>

            <div className="insights-metric-item">
              <span className="metric-label"><Shield size={13} /> Support (swing low)</span>
              <strong className="metric-val gain">
                {money(analysis.levels.support ?? analysis.levels.twentyDayLow)}
              </strong>
            </div>

            <div className="insights-metric-item">
              <span className="metric-label"><Target size={13} /> Resistance (swing high)</span>
              <strong className="metric-val loss">
                {money(analysis.levels.resistance ?? analysis.levels.twentyDayHigh)}
              </strong>
            </div>

            <div className="insights-metric-item">
              <span className="metric-label">MACD histogram</span>
              <strong className="metric-val">{analysis.indicators.macd?.histogram ?? 'Unavailable'}</strong>
            </div>

            <div className="insights-metric-item">
              <span className="metric-label">SMA 20 / 50</span>
              <strong className="metric-val">
                {money(analysis.indicators.sma20)} / {money(analysis.indicators.sma50)}
              </strong>
            </div>

            <div className="insights-metric-item">
              <span className="metric-label">ATR(14)</span>
              <strong className="metric-val">
                {money(analysis.indicators.atr14)}
                {analysis.indicators.atrPercent != null ? ` (${analysis.indicators.atrPercent}%)` : ''}
              </strong>
            </div>

            <div className="insights-metric-item">
              <span className="metric-label">20-day volatility</span>
              <strong className="metric-val">
                {analysis.indicators.volatility20Annualised != null
                  ? `${analysis.indicators.volatility20Annualised}% annualised`
                  : 'Unavailable'}
              </strong>
            </div>

            <div className="insights-metric-item">
              <span className="metric-label">Volume vs 20-day avg</span>
              <strong className="metric-val">
                {analysis.indicators.volumeRatio != null ? `${analysis.indicators.volumeRatio}×` : 'Unavailable'}
              </strong>
            </div>
          </div>

          {longTerm?.trend ? (
            <div className="insights-longterm">
              <div className="insights-longterm-head">
                <h4 className="insights-subhead"><History size={14} /> Long-term view</h4>
                <span className={`insights-trend-pill ${ltMeta.tone}`}>
                  <LtIcon size={14} /> {ltMeta.label} · {biasLabel[longTerm.bias] || 'No bias'}
                </span>
              </div>
              <p className="insights-window">
                {longTerm.firstBar} – {longTerm.lastBar} · {barsFormat.format(longTerm.bars)} verified daily bars
                {longTerm.years != null ? ` (${longTerm.years}y)` : ''}
              </p>
              {longTerm.windowHigh != null && longTerm.windowLow != null && (
                <div className="insights-range">
                  <div className="insights-range-head">
                    <span><b>{money(longTerm.windowLow)}</b> low</span>
                    <span className="insights-range-position">
                      {longTerm.rangePositionPercent != null
                        ? `Price at ${longTerm.rangePositionPercent}% of range`
                        : 'Range position unavailable'}
                    </span>
                    <span><b>{money(longTerm.windowHigh)}</b> high</span>
                  </div>
                  {longTerm.rangePositionPercent != null && (
                    <div
                      className="insights-range-track"
                      role="img"
                      aria-label={`Price is at ${longTerm.rangePositionPercent}% of the ${windowLabel} range between ${money(longTerm.windowLow)} and ${money(longTerm.windowHigh)}`}
                    >
                      <span
                        className="insights-range-marker"
                        style={{ left: `${clampPercent(longTerm.rangePositionPercent)}%` }}
                      />
                    </div>
                  )}
                  <div className="insights-range-dates">
                    <span>{longTerm.windowLowDate || ''}</span>
                    <span>{longTerm.windowHighDate || ''}</span>
                  </div>
                </div>
              )}
              <div className="insights-metrics-grid">
                <div className="insights-metric-item">
                  <span className="metric-label">{windowLabel} high</span>
                  <strong className="metric-val">{money(longTerm.windowHigh)}</strong>
                  {longTerm.windowHighDate && <small className="metric-sub">{longTerm.windowHighDate}</small>}
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">{windowLabel} low</span>
                  <strong className="metric-val">{money(longTerm.windowLow)}</strong>
                  {longTerm.windowLowDate && <small className="metric-sub">{longTerm.windowLowDate}</small>}
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">Total change (window)</span>
                  <strong className="metric-val">{percent(longTerm.totalReturnPercent)}</strong>
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">CAGR</span>
                  <strong className="metric-val">
                    {longTerm.cagrPercent != null ? `${percent(longTerm.cagrPercent)}/yr` : 'Unavailable'}
                  </strong>
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">5-year change</span>
                  <strong className="metric-val">{percent(longTerm.fiveYearReturnPercent)}</strong>
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">3-year change</span>
                  <strong className="metric-val">{percent(longTerm.threeYearReturnPercent)}</strong>
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">Max drawdown</span>
                  <strong className="metric-val">{percent(longTerm.maxDrawdownPercent)}</strong>
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">From {windowLabel} high</span>
                  <strong className="metric-val">{percent(longTerm.fromHighPercent)}</strong>
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">From {windowLabel} low</span>
                  <strong className="metric-val">{percent(longTerm.fromLowPercent)}</strong>
                </div>
                <div className="insights-metric-item">
                  <span className="metric-label">200-day SMA</span>
                  <strong className="metric-val">
                    {money(longTerm.sma200)}
                    {longTerm.priceVsSma200Percent != null ? ` (${percent(longTerm.priceVsSma200Percent)})` : ''}
                  </strong>
                </div>
              </div>
              <p className="insights-longterm-note">
                Rules-based trend read from {barsFormat.format(longTerm.bars)} daily bars. Not a prediction, target or probability.
              </p>
            </div>
          ) : (
            <p className="insights-summary-text" style={{ marginTop: 12 }}>
              Only {barsFormat.format(longTerm?.bars || analysis.historyBars || 0)} verified daily bars are available,
              so 200-day and multi-year checks were not computed.
            </p>
          )}

          {Array.isArray(analysis.suggestions) && analysis.suggestions.length > 0 && (
            <div className="insights-suggestions">
              <h4 className="insights-subhead">
                <ListChecks size={14} /> Suggestion read
                <span className="insights-suggestions-tag">rules-based, not advice</span>
              </h4>
              <ul>
                {analysis.suggestions.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="insights-disclaimer" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: '0.78rem' }}>
            <Info size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
            <span>
              {analysis.dataProvider} research data · delayed, not live · {analysis.asOf || 'time unavailable'} IST.
              {' '}Computed from verified OHLC, not a price forecast. Not investment advice.
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default StockAIInsights;
