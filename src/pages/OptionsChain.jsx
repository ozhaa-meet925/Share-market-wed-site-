import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Layers, Activity, Zap, RefreshCw, Info } from 'lucide-react';
import './OptionsChain.css';

const nf = new Intl.NumberFormat('en-IN');
const POLL_MS = 5000;

const formatNumber = (value) => (value == null ? '—' : nf.format(Math.round(value)));

const formatCompact = (value) => {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)} K`;
  return nf.format(Math.round(value));
};

const formatPrice = (value) => (value == null ? '—' : `₹${nf.format(value)}`);

const formatSigned = (value) => {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${nf.format(Math.round(value))}`;
};

const formatPct = (value) => {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const changeClass = (value) => {
  if (value == null || value === 0) return '';
  return value > 0 ? 'text-green' : 'text-red';
};

const formatDate = (iso) => {
  if (!iso) return '—';
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const formatStamp = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const FlashValue = ({ value, format, className = '' }) => {
  const previous = useRef(value);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (before == null || value == null || value === before) return undefined;
    setFlash(value > before ? 'flash-up' : 'flash-down');
    const timer = setTimeout(() => setFlash(''), 900);
    return () => clearTimeout(timer);
  }, [value]);
  return <span className={`flash-value ${className} ${flash}`.trim()}>{format(value)}</span>;
};

const OptionsChain = () => {
  const [view, setView] = useState('options');
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [symbol, setSymbol] = useState('NIFTY');
  const [expiry, setExpiry] = useState('');
  const [chain, setChain] = useState(null);
  const [futures, setFutures] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [tick, setTick] = useState(0);
  const [auto, setAuto] = useState(true);
  const hasData = useRef(false);

  const loadStatus = useCallback(async () => {
    setStatusError('');
    try {
      const res = await fetch('/api/fno/status');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'The F&O desk data is unavailable.');
      setStatus(json);
      return json;
    } catch (err) {
      setStatusError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) setTick((value) => value + 1);
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) setTick((value) => value + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [auto]);

  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) loadStatus();
    }, 60000);
    return () => clearInterval(id);
  }, [auto, loadStatus]);

  useEffect(() => {
    if (view !== 'options') return undefined;
    let cancelled = false;
    if (!hasData.current) setLoading(true);
    setError('');
    const query = new URLSearchParams({ underlying: symbol });
    if (expiry) query.set('expiry', expiry);
    fetch(`/api/fno/option-chain?${query.toString()}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'The option chain could not be loaded.');
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        hasData.current = true;
        setChain(json);
        if (!json.expiries?.includes(expiry)) setExpiry(json.expiry || '');
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setChain(null);
          hasData.current = false;
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [view, symbol, expiry, reloadKey, tick]);

  useEffect(() => {
    if (view !== 'futures') return undefined;
    let cancelled = false;
    if (!hasData.current) setLoading(true);
    setError('');
    fetch(`/api/fno/futures?underlying=${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'The futures board could not be loaded.');
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        hasData.current = true;
        setFutures(json);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setFutures(null);
          hasData.current = false;
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [view, symbol, reloadKey, tick]);

  const switchSymbol = (next) => {
    hasData.current = false;
    setSymbol(next);
    setExpiry('');
    setChain(null);
    setFutures(null);
  };

  const groups = useMemo(() => {
    const list = status?.underlyings || [];
    return {
      index: list.filter((item) => item.kind === 'index'),
      stock: list.filter((item) => item.kind === 'stock'),
    };
  }, [status]);

  const refresh = () => {
    loadStatus();
    setReloadKey((key) => key + 1);
  };

  const activeData = view === 'options' ? chain : futures;
  const isLive = Boolean(activeData?.isLive);
  const stamp = formatStamp(activeData?.asOf) || (activeData?.tradeDate ? formatDate(activeData.tradeDate) : null)
    || (status?.asOf ? formatStamp(status.asOf) : null)
    || (status?.tradeDate ? formatDate(status.tradeDate) : null);
  const marketMessage = status?.marketStatus?.marketStatusMessage || null;
  const sourceTitle = isLive ? 'NSE intraday feed' : 'NSE F&O bhavcopy · end-of-day';

  return (
    <div className="options-chain-container">
      <div className="chain-header">
        <div className="chain-title-wrap">
          <div className="chain-badge"><Zap size={14} /> F&amp;O DERIVATIVES DESK</div>
          <h1>NSE Derivatives · Options &amp; Futures</h1>
          <p>Live option premiums, open interest, implied volatility and futures basis from the NSE exchange feed.</p>
        </div>

        <div className="chain-controls">
          <div className="symbol-selector">
            {['options', 'futures'].map((key) => (
              <button
                key={key}
                type="button"
                className={`symbol-btn ${view === key ? 'active' : ''}`}
                onClick={() => { hasData.current = false; setView(key); }}
              >
                {key === 'options' ? 'Options Chain' : 'Futures'}
              </button>
            ))}
          </div>
          <button
            className={`auto-btn ${auto ? 'on' : ''}`}
            type="button"
            onClick={() => setAuto((value) => !value)}
            title="Toggle 5 second auto refresh"
          >
            <span className={`auto-dot ${auto ? 'pulse' : ''}`} /> {auto ? 'Auto 5s' : 'Auto off'}
          </button>
          <button className="refresh-btn" type="button" onClick={refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spinning' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className={`chain-source-bar ${isLive ? 'is-live' : ''}`}>
        {isLive ? <span className="live-dot-fno" /> : <Info size={14} />}
        <span>{sourceTitle}</span>
        <span className="source-sep">·</span>
        <span>as of {stamp || '—'} IST</span>
        {marketMessage && <span className="source-sep">·</span>}
        {marketMessage && <span>{marketMessage}</span>}
        {!isLive && <span className="source-sep">·</span>}
        {!isLive && <span>not a live feed</span>}
        {status?.stale && <span className="stale-tag">Archive is older than expected</span>}
      </div>

      <div className="chain-filters">
        <label className="chain-select">
          <span>Underlying</span>
          <select value={symbol} onChange={(event) => switchSymbol(event.target.value)}>
            {groups.index.length > 0 && (
              <optgroup label="Indices">
                {groups.index.map((item) => (
                  <option key={item.symbol} value={item.symbol}>{item.symbol}</option>
                ))}
              </optgroup>
            )}
            {groups.stock.length > 0 && (
              <optgroup label={`Stocks (${groups.stock.length})`}>
                {groups.stock.map((item) => (
                  <option key={item.symbol} value={item.symbol}>{item.symbol}</option>
                ))}
              </optgroup>
            )}
            {!status && <option value={symbol}>{symbol}</option>}
          </select>
        </label>

        {view === 'options' && chain?.expiries?.length > 0 && (
          <label className="chain-select">
            <span>Expiry</span>
            <select value={chain.expiry} onChange={(event) => setExpiry(event.target.value)}>
              {chain.expiries.map((item) => (
                <option key={item} value={item}>{formatDate(item)}</option>
              ))}
            </select>
          </label>
        )}

        {view === 'options' && chain?.lotSize && (
          <div className="chain-pill">Lot size <strong>{chain.lotSize}</strong></div>
        )}
        {view === 'options' && chain?.atmStrike && (
          <div className="chain-pill">ATM <strong>{formatNumber(chain.atmStrike)}</strong></div>
        )}
      </div>

      {statusError && (
        <div className="chain-error">
          {statusError}
          <button type="button" onClick={loadStatus}>Retry</button>
        </div>
      )}

      {view === 'options' && chain && (
        <div className="chain-metrics-grid">
          <div className="metric-box">
            <span className="metric-label">Underlying Price</span>
            <div className="metric-val highlight">
              <FlashValue value={chain.underlyingPrice} format={formatPrice} />
            </div>
            <span className="metric-sub">
              {chain.instrument} · {chain.isLive ? `exchange snapshot ${formatStamp(chain.asOf) || ''}` : `close of ${formatDate(chain.tradeDate)}`}
            </span>
          </div>
          <div className="metric-box">
            <span className="metric-label">Put-Call Ratio</span>
            <div className="metric-val">
              <FlashValue value={chain.pcr} format={(value) => (value == null ? '—' : value.toFixed(2))} />
            </div>
            <span className="metric-sub">{chain.pcrSentiment}</span>
          </div>
          <div className="metric-box">
            <span className="metric-label">Max Pain</span>
            <div className="metric-val">
              <FlashValue value={chain.maxPain} format={(value) => (value == null ? '—' : formatNumber(value))} />
            </div>
            <span className="metric-sub">Strike with the least OI-weighted payout</span>
          </div>
          <div className="metric-box">
            <span className="metric-label">Total Open Interest</span>
            <div className="metric-val">{formatCompact(chain.totalCallOi + chain.totalPutOi)}</div>
            <span className="metric-sub">Calls {formatCompact(chain.totalCallOi)} · Puts {formatCompact(chain.totalPutOi)}</span>
          </div>
        </div>
      )}

      {loading && !error && !activeData && (
        <div className="chain-loader">
          <Activity size={32} className="spinning" />
          <p>{auto ? 'Connecting to the NSE derivatives feed…' : 'Reading the official NSE F&O bhavcopy…'}</p>
        </div>
      )}

      {error && (
        <div className="chain-error">
          {error}
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
        </div>
      )}

      {view === 'options' && chain && !error && (
        <div className="chain-table-responsive">
          <table className="options-table">
            <thead>
              <tr className="super-header">
                <th colSpan={6} className="calls-side">CALLS (CE)</th>
                <th className="strike-col">STRIKE</th>
                <th colSpan={6} className="puts-side">PUTS (PE)</th>
              </tr>
              <tr className="sub-header">
                <th>OI</th>
                <th>OI Chg</th>
                <th>Volume</th>
                <th>LTP</th>
                <th>IV %</th>
                <th>Δ Delta</th>
                <th className="strike-col">Price</th>
                <th>Δ Delta</th>
                <th>IV %</th>
                <th>LTP</th>
                <th>Volume</th>
                <th>OI Chg</th>
                <th>OI</th>
              </tr>
            </thead>
            <tbody>
              {chain.strikes.map((row) => (
                <tr key={row.strike} className={row.isAtm ? 'atm-row' : ''}>
                  <td className="oi-cell">{formatCompact(row.call?.oi)}</td>
                  <td className={changeClass(row.call?.oiChange)}>{formatSigned(row.call?.oiChange)}</td>
                  <td>{formatCompact(row.call?.volume)}</td>
                  <td className="ltp-cell"><FlashValue value={row.call?.ltp} format={formatPrice} /></td>
                  <td>{row.call?.iv == null ? '—' : `${row.call.iv}%`}</td>
                  <td>{row.call?.delta == null ? '—' : row.call.delta.toFixed(3)}</td>

                  <td className={`strike-cell ${row.isAtm ? 'is-atm' : ''}`}>
                    <strong>{formatNumber(row.strike)}</strong>
                    {row.isAtm && <span className="atm-tag">ATM</span>}
                  </td>

                  <td>{row.put?.delta == null ? '—' : row.put.delta.toFixed(3)}</td>
                  <td>{row.put?.iv == null ? '—' : `${row.put.iv}%`}</td>
                  <td className="ltp-cell"><FlashValue value={row.put?.ltp} format={formatPrice} /></td>
                  <td>{formatCompact(row.put?.volume)}</td>
                  <td className={changeClass(row.put?.oiChange)}>{formatSigned(row.put?.oiChange)}</td>
                  <td className="oi-cell">{formatCompact(row.put?.oi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'options' && chain && (
        <div className="chain-note">
          {chain.isLive
            ? 'Prices and implied volatility are the NSE exchange snapshot and refresh every 5 seconds while this tab is visible. Greeks are model estimates computed with Black-Scholes from the NSE IV (6.5% risk-free rate).'
            : 'IV and Greeks are calculated from the bhavcopy last/settlement prices with the Black-Scholes model (risk-free rate 6.5%). They are model estimates, not exchange-published values, and are hidden where the price sits at or inside intrinsic value.'}
        </div>
      )}

      {view === 'futures' && futures && !error && (
        <div className="futures-grid">
          {futures.contracts.map((contract) => (
            <div key={contract.symbol} className="futures-card">
              <div className="futures-card-head">
                <div>
                  <span className="futures-symbol">{contract.symbol}</span>
                  <span className="futures-expiry">Expiry {formatDate(contract.expiry)}</span>
                </div>
                <span className={`futures-change ${changeClass(contract.change)}`}>
                  {contract.change == null ? '—' : (
                    <>
                      {contract.change > 0 ? <TrendingUp size={14} /> : contract.change < 0 ? <TrendingDown size={14} /> : null}
                      {formatSigned(contract.change)} ({formatPct(contract.changePercent)})
                    </>
                  )}
                </span>
              </div>
              <FlashValue value={contract.price} format={formatPrice} className="futures-price" />
              <div className="futures-stats">
                <div><span>Open Interest</span><strong>{formatCompact(contract.oi)}</strong></div>
                {contract.oiChange != null && (
                  <div><span>OI Change</span><strong className={changeClass(contract.oiChange)}>{formatSigned(contract.oiChange)}</strong></div>
                )}
                <div><span>Volume</span><strong>{formatCompact(contract.volume)}</strong></div>
                {contract.open != null && <div><span>Open</span><strong>{formatPrice(contract.open)}</strong></div>}
                {contract.high != null && <div><span>High</span><strong>{formatPrice(contract.high)}</strong></div>}
                {contract.low != null && <div><span>Low</span><strong>{formatPrice(contract.low)}</strong></div>}
                {contract.settlement != null && <div><span>Settlement</span><strong>{formatPrice(contract.settlement)}</strong></div>}
                {contract.lotSize != null && <div><span>Lot Size</span><strong>{contract.lotSize}</strong></div>}
                <div>
                  <span>Basis vs Spot</span>
                  <strong className={changeClass(contract.basis)}>
                    {contract.basis == null ? '—' : `${formatSigned(contract.basis)} (${formatPct(contract.basisPercent)})`}
                  </strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'futures' && futures && (
        <div className="chain-note">
          {futures.isLive
            ? 'Live watch streams every index futures expiry and the 20 most active stock futures. Basis compares the futures price with the live underlying value; values refresh every 5 seconds.'
            : `Basis compares the futures close with the underlying close on ${formatDate(futures.tradeDate)}. Positive basis (contango) is normal for index futures; stock futures can trade at a discount.`}
        </div>
      )}

      <div className="chain-disclaimer">
        <Layers size={14} />
        <span>
          Source: NSE exchange feed with the official F&amp;O bhavcopy as fallback. This desk shows research data only and does not
          place orders. Broker order routing lives in the Trading Desk and needs a connected broker.
        </span>
      </div>
    </div>
  );
};

export default OptionsChain;
