import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileCheck2,
  Fingerprint,
  FlaskConical,
  Gauge,
  HeartPulse,
  History,
  Info,
  Layers,
  LineChart,
  Loader2,
  Lock,
  Network,
  Play,
  Power,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  Unlock,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { coreApi } from '../services/core';
import { getCurrentUser } from '../services/auth';
import './AICore.css';

const money = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number < 0 ? '-' : ''}₹${Math.abs(number).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const signedMoney = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number >= 0 ? '+' : '-'}₹${Math.abs(number).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const percent = (value, digits = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}%`;
};

const plainPercent = (value, digits = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number.toFixed(digits)}%`;
};

const number = (value, digits = 2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return parsed.toFixed(digits);
};

const istTime = (value, withDate = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const ago = (value) => {
  if (!value) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
};

const titleCase = (value) => String(value || '—').replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());

const STATUS_TONE = {
  healthy: 'good',
  online: 'good',
  pass: 'good',
  held_up: 'good',
  idle: 'neutral',
  neutral: 'neutral',
  watch: 'neutral',
  mixed: 'warn',
  inconclusive: 'warn',
  degraded: 'warn',
  attention: 'warn',
  warn: 'warn',
  halted: 'bad',
  down: 'bad',
  fail: 'bad',
  degraded_data: 'bad',
  insufficient_edge: 'neutral',
};

const DECISION_META = {
  strong_buy_candidate: { label: 'Strong buy candidate', tone: 'good' },
  buy_candidate: { label: 'Buy candidate', tone: 'good' },
  watch: { label: 'Watch', tone: 'neutral' },
  insufficient_edge: { label: 'Insufficient edge', tone: 'neutral' },
  avoid: { label: 'Avoid', tone: 'warn' },
  strong_avoid: { label: 'Strong avoid', tone: 'bad' },
  insufficient_data: { label: 'Data unavailable', tone: 'bad' },
};

const topicTone = (topic) => {
  if (!topic) return 'neutral';
  if (topic.includes('kill') || topic.includes('alert') || topic.includes('error')) return 'bad';
  if (topic.includes('walkforward') || topic.includes('decision')) return 'warn';
  if (topic.includes('executed') || topic.includes('evaluated') || topic.includes('updated')) return 'good';
  return 'neutral';
};

const StatusPill = ({ status, label }) => (
  <span className={`core-pill tone-${STATUS_TONE[status] || 'neutral'}`}>
    <span className="core-pill-dot" />
    {label || titleCase(status)}
  </span>
);

const Stat = ({ label, value, sub, tone = '' }) => (
  <div className={`core-stat ${tone ? `tone-${tone}` : ''}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {sub ? <small>{sub}</small> : null}
  </div>
);

const Panel = ({ id, icon: Icon, title, subtitle, aside, children, className = '' }) => (
  <section className={`core-panel ${className}`} id={id}>
    <header className="core-panel-head">
      <div className="core-panel-title">
        <span className="core-icon-badge"><Icon size={18} /></span>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {aside ? <div className="core-panel-aside">{aside}</div> : null}
    </header>
    {children}
  </section>
);

const EquityCurve = ({ points }) => {
  const curve = Array.isArray(points) ? points.filter((point) => Number.isFinite(Number(point.equity))) : [];
  if (curve.length < 2) {
    return (
      <div className="core-chart-empty">
        <LineChart size={22} />
        <span>The cost-adjusted equity curve appears after at least two closed paper trades.</span>
      </div>
    );
  }
  const values = curve.map((point) => Number(point.equity));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 320;
  const height = 84;
  const path = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 8) - 4;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const area = `${path} L${width} ${height} L0 ${height} Z`;
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg className="core-equity" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Realised equity curve">
      <defs>
        <linearGradient id="coreEquityFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rising ? '#6ee7b7' : '#fca5a5'} stopOpacity="0.35" />
          <stop offset="100%" stopColor={rising ? '#6ee7b7' : '#fca5a5'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#coreEquityFill)" />
      <path d={path} fill="none" stroke={rising ? '#6ee7b7' : '#fca5a5'} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
};

const ConfidenceRing = ({ confidence }) => (
  <div className="core-ring" style={{ '--fill': `${Math.max(0, Math.min(100, Number(confidence) || 0)) * 3.6}deg` }}>
    <div className="core-ring-inner">
      <strong>{Number.isFinite(Number(confidence)) ? Math.round(confidence) : '—'}%</strong>
      <span>confidence</span>
    </div>
  </div>
);

const AICore = () => {
  const [authRequired, setAuthRequired] = useState(!getCurrentUser());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');

  const [overview, setOverview] = useState(null);
  const [risk, setRisk] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [health, setHealth] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [audit, setAudit] = useState(null);
  const [costBps, setCostBps] = useState(12);

  const [symbol, setSymbol] = useState('RELIANCE');
  const [evalResult, setEvalResult] = useState(null);
  const [evalError, setEvalError] = useState('');
  const [watchlistResult, setWatchlistResult] = useState(null);
  const [walkResult, setWalkResult] = useState(null);
  const [walkError, setWalkError] = useState('');

  const [killModal, setKillModal] = useState(null);
  const [killReason, setKillReason] = useState('');

  const [events, setEvents] = useState([]);
  const [live, setLive] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  const refreshTimer = useRef(null);
  const signedIn = !authRequired;

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    const settled = await Promise.allSettled([
      coreApi.overview(),
      coreApi.riskStatus(),
      coreApi.recovery(),
      coreApi.performance(costBps),
      coreApi.health(),
      coreApi.incidents(30),
      coreApi.audit(25),
    ]);
    const [overviewResult, riskResult, recoveryResult, performanceResult, healthResult, incidentsResult, auditResult] = settled;
    if (overviewResult.status === 'rejected' && overviewResult.reason?.status === 401) {
      setAuthRequired(true);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (overviewResult.status === 'fulfilled') {
      setAuthRequired(false);
      setOverview(overviewResult.value);
    } else setError(overviewResult.reason?.message || 'The AI Core overview is unavailable.');
    if (riskResult.status === 'fulfilled') setRisk(riskResult.value);
    if (recoveryResult.status === 'fulfilled') setRecovery(recoveryResult.value);
    if (performanceResult.status === 'fulfilled') setPerformance(performanceResult.value);
    if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
    if (incidentsResult.status === 'fulfilled') setIncidents(incidentsResult.value.incidents || []);
    if (auditResult.status === 'fulfilled') setAudit(auditResult.value);
    setLoading(false);
    setRefreshing(false);
  }, [costBps]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (authRequired) return undefined;
    const timer = setInterval(() => loadAll({ silent: true }), 10_000);
    return () => clearInterval(timer);
  }, [authRequired, loadAll]);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleSession = () => {
      const signedInNow = Boolean(getCurrentUser());
      setAuthRequired(!signedInNow);
      if (signedInNow) loadAll({ silent: true });
    };
    window.addEventListener('sharemarket:session-changed', handleSession);
    return () => window.removeEventListener('sharemarket:session-changed', handleSession);
  }, [loadAll]);

  useEffect(() => {
    if (!signedIn) return undefined;
    const source = new EventSource(coreApi.streamUrl);
    source.onopen = () => setLive(true);
    source.addEventListener('core', (event) => {
      try {
        const payload = JSON.parse(event.data);
        setEvents((current) => [payload, ...current].slice(0, 40));
        if (['health.alert', 'risk.killSwitch', 'risk.decision', 'order.executed', 'recovery.alert', 'performance.walkforward'].includes(payload.topic)) {
          clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => loadAll({ silent: true }), 1200);
        }
      } catch {
        // Ignore malformed frames; the stream keeps running.
      }
    });
    source.onerror = () => setLive(false);
    return () => {
      clearTimeout(refreshTimer.current);
      source.close();
    };
  }, [signedIn, loadAll]);

  useEffect(() => {
    if (!overview || walkResult) return;
    const list = overview?.account?.watchlist;
    if (Array.isArray(list) && list.length && symbol === 'RELIANCE' && !list.includes('RELIANCE')) setSymbol(list[0]);
  }, [overview, symbol, walkResult]);

  const watchlist = overview?.account?.watchlist || [];

  const runEvaluation = async (preflight = false) => {
    const cleaned = symbol.trim().toUpperCase();
    if (!cleaned) return;
    setBusy(preflight ? 'preflight' : 'evaluate');
    setEvalError('');
    setActionError('');
    try {
      const result = await coreApi.evaluate(cleaned, preflight);
      setEvalResult(result);
      if (result.status === 'unavailable') setEvalError(result.explanation || 'Verified data is unavailable.');
    } catch (requestError) {
      setEvalError(requestError.message);
    } finally {
      setBusy('');
    }
  };

  const runWatchlist = async () => {
    setBusy('watchlist');
    setActionError('');
    try {
      const result = await coreApi.evaluateWatchlist();
      setWatchlistResult(result);
      setNotice(`Evaluated ${result.symbolsEvaluated} symbol(s). Average confidence ${result.averageConfidence ?? 0}%.`);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBusy('');
    }
  };

  const submitKillSwitch = async () => {
    const activate = killModal === 'activate';
    if (killReason.trim().length < 4) {
      setActionError('Enter a reason of at least 4 characters.');
      return;
    }
    setBusy('kill');
    setActionError('');
    try {
      await coreApi.setKillSwitch(activate, killReason.trim());
      setKillModal(null);
      setKillReason('');
      setNotice(activate ? 'Kill switch activated. Automated entries are blocked.' : 'Kill switch released. Automated entries can be risk-approved again.');
      await loadAll({ silent: true });
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBusy('');
    }
  };

  const reconcileRecovery = async () => {
    setBusy('reconcile');
    setActionError('');
    try {
      const result = await coreApi.reconcile();
      setNotice(result.summary || 'Paper ledger reconciled against pending intents.');
      await loadAll({ silent: true });
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBusy('');
    }
  };

  const runWalkForward = async () => {
    setBusy('walkforward');
    setWalkError('');
    setNotice('');
    try {
      const result = await coreApi.walkForward({ days: 500, costBps });
      setWalkResult(result);
      setNotice(`Out-of-sample run finished: ${titleCase(result.verdict)}.`);
    } catch (requestError) {
      setWalkError(requestError.message);
    } finally {
      setBusy('');
    }
  };

  const verifyChain = async () => {
    setBusy('audit');
    setActionError('');
    try {
      const result = await coreApi.verifyAudit();
      setAudit((current) => ({ ...(current || {}), verification: result }));
      setNotice(result.ok ? `Audit chain verified across ${result.entries} entr${result.entries === 1 ? 'y' : 'ies'}.` : `Audit chain broken at sequence ${result.brokenAt}.`);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBusy('');
    }
  };

  const acknowledgeIncident = async (id) => {
    setBusy(`incident-${id}`);
    try {
      await coreApi.acknowledgeIncident(id);
      const payload = await coreApi.incidents(30);
      setIncidents(payload.incidents || []);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBusy('');
    }
  };

  const acknowledgeRecovery = async (id) => {
    setBusy(`alert-${id}`);
    try {
      await coreApi.acknowledgeRecoveryAlert(id);
      await loadAll({ silent: true });
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBusy('');
    }
  };

  const liveEvents = useMemo(
    () => (events.length ? events : overview?.communication?.recentEvents || []),
    [events, overview],
  );

  const modules = overview?.modules || [];
  const riskActive = risk?.killSwitch?.active === true;
  const paper = performance?.paper;
  const components = health?.components || {};
  const openIncidents = incidents.filter((incident) => !incident.resolvedAt);
  const unreconciled = recovery?.counts?.unresolved || 0;

  if (authRequired) {
    return (
      <div className="ai-core ai-core-auth">
        <div className="core-auth-card">
          <span className="core-icon-badge"><Lock size={20} /></span>
          <h1>AI Core requires a session</h1>
          <p>Sign in to view the orchestration dashboard, risk decisions, recovery state and the audit chain. Live trading stays disabled after sign-in as well.</p>
          <Link className="core-btn core-btn-gold" to="/login">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-core">
      <header className="core-hero">
        <div className="core-hero-copy">
          <span className="core-eyebrow"><Sparkles size={14} /> Ultimate AI Core Infrastructure</span>
          <h1>Autonomous intelligence.<br /><em>Institutional guardrails.</em></h1>
          <p>
            Five connected services share one event bus, one audit chain and one hard rule: no AI decision can bypass the Risk Shield.
            Market reads use verified delayed research data — never fabricated prices or forecasts.
          </p>
          <div className="core-hero-badges">
            <span className={`core-live ${live ? 'is-live' : ''}`}><Radio size={14} /> {live ? 'Live stream connected' : 'Stream reconnecting'}</span>
            <span className="core-badge"><Lock size={13} /> Live trading disabled</span>
            <span className="core-badge"><ShieldCheck size={13} /> Paper-only</span>
            <span className={`core-badge ${audit?.verification?.ok ? 'is-good' : 'is-warn'}`}>
              <FileCheck2 size={13} /> {audit?.verification?.ok ? `Audit chain verified · ${audit.verification.entries}` : 'Audit chain unverified'}
            </span>
          </div>
        </div>
        <div className="core-console">
          <div className="core-console-row">
            <span><Clock size={14} /> IST session clock</span>
            <strong>{clock.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}</strong>
          </div>
          <div className="core-console-row">
            <span><Activity size={14} /> Market session</span>
            <strong className={overview?.market?.marketOpen ? 'up' : 'muted'}>{overview?.market?.marketOpen ? 'Open' : 'Closed'}</strong>
          </div>
          <div className="core-console-row">
            <span><Cpu size={14} /> Engine</span>
            <strong className="muted">Deterministic ensemble</strong>
          </div>
          <div className="core-console-row">
            <span><History size={14} /> Last sync</span>
            <strong className="muted">{ago(overview?.generatedAt)}</strong>
          </div>
          <button type="button" className="core-btn core-btn-ghost core-refresh" onClick={() => loadAll({ silent: true })} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing' : 'Refresh state'}
          </button>
          <small>Paper capital {money(overview?.account?.equity)} · {overview?.account?.openPositions || 0} open position(s)</small>
        </div>
      </header>

      {loading ? (
        <div className="core-loading"><Loader2 size={22} className="spin" /> Connecting to the core services…</div>
      ) : null}
      {error ? <div className="core-alert bad"><XCircle size={16} /> {error}</div> : null}
      {actionError ? <div className="core-alert bad"><AlertTriangle size={16} /> {actionError}</div> : null}
      {notice ? <div className="core-alert good"><CheckCircle2 size={16} /> {notice}</div> : null}

      <div className="core-safety-strip">
        <ShieldAlert size={18} />
        <div>
          <strong>Independent authority.</strong> The Risk Shield validates every automated and preflight order. Analysis never places a trade, broker routing is not configured, and every decision is appended to a hash-chained audit log.
        </div>
        <span className="core-badge"><Lock size={13} /> No broker orders</span>
      </div>

      <section className="core-modules" aria-label="AI Core modules">
        {modules.map((module) => {
          const meta = {
            brain: { icon: Brain, href: '#core-brain' },
            risk: { icon: ShieldCheck, href: '#core-risk' },
            recovery: { icon: RefreshCw, href: '#core-recovery' },
            performance: { icon: Gauge, href: '#core-performance' },
            health: { icon: HeartPulse, href: '#core-health' },
          }[module.id] || { icon: Layers, href: '#core-health' };
          const Icon = meta.icon;
          return (
            <a className="core-module" href={meta.href} key={module.id}>
              <div className="core-module-top">
                <span className="core-icon-badge"><Icon size={18} /></span>
                <StatusPill status={module.status} />
              </div>
              <strong>{module.name}</strong>
              <p>{module.summary}</p>
              <span className="core-module-foot">
                {module.id === 'brain' ? `${module.metrics?.watchlist ?? 0} watchlist symbols` : null}
                {module.id === 'risk' ? `${module.metrics?.today?.blocked ?? 0} blocked today` : null}
                {module.id === 'recovery' ? `${module.metrics?.unresolved ?? 0} unresolved` : null}
                {module.id === 'performance' ? `${module.metrics?.snapshots ?? 0} snapshots` : null}
                {module.id === 'health' ? `${module.metrics?.activeIncidents ?? 0} open incidents` : null}
                <ArrowUpRight size={13} />
              </span>
            </a>
          );
        })}
      </section>

      <div className="core-layout">
        <div className="core-main">
          <Panel
            id="core-brain"
            icon={Brain}
            title="AI Super Brain"
            subtitle="Strategy comparison, market context and explained confidence — never a black box."
            aside={<span className="core-badge"><Sparkles size={13} /> {overview?.mode?.llmConfigured ? 'LLM layer configured' : 'Deterministic explanations'}</span>}
          >
            <div className="core-eval-controls">
              <label className="core-symbol-input">
                <Search size={16} />
                <input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  onKeyDown={(event) => { if (event.key === 'Enter') runEvaluation(false); }}
                  placeholder="NSE symbol, e.g. RELIANCE"
                  aria-label="Symbol to evaluate"
                />
              </label>
              <button type="button" className="core-btn core-btn-silver" onClick={() => runEvaluation(false)} disabled={busy === 'evaluate'}>
                {busy === 'evaluate' ? <Loader2 size={15} className="spin" /> : <Play size={15} />} Evaluate
              </button>
              <button type="button" className="core-btn core-btn-gold" onClick={() => runEvaluation(true)} disabled={busy === 'preflight'}>
                {busy === 'preflight' ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} Risk preflight
              </button>
              <button type="button" className="core-btn core-btn-ghost" onClick={runWatchlist} disabled={busy === 'watchlist'}>
                {busy === 'watchlist' ? <Loader2 size={15} className="spin" /> : <Layers size={15} />} Scan watchlist
              </button>
            </div>
            {watchlist.length ? (
              <div className="core-chips">
                {watchlist.slice(0, 8).map((item) => (
                  <button type="button" key={item} className={`core-chip ${symbol === item ? 'active' : ''}`} onClick={() => setSymbol(item)}>{item}</button>
                ))}
              </div>
            ) : null}
            {evalError ? <div className="core-inline-warn"><AlertTriangle size={15} /> {evalError}</div> : null}

            {evalResult ? (
              <div className="core-eval-result">
                <div className="core-eval-head">
                  <div>
                    <span className="core-kicker">Consensus for {evalResult.symbol}</span>
                    <h3>{evalResult.symbol} <span className={`core-pill tone-${DECISION_META[evalResult.decision]?.tone || 'neutral'}`}>{DECISION_META[evalResult.decision]?.label || titleCase(evalResult.decision)}</span></h3>
                    <small>{evalResult.signal ? `Composite score ${evalResult.signal.score}/100 · ${evalResult.signal.action} · ${evalResult.signal.trend}` : titleCase(evalResult.status)}</small>
                  </div>
                  <ConfidenceRing confidence={evalResult.confidence} />
                </div>
                <div className="core-eval-grid">
                  <div className="core-eval-explanation">
                    <p>{evalResult.explanation}</p>
                    <div className="core-uncertainty">
                      <div className="core-uncertainty-head">
                        <span>Confidence {Math.round(evalResult.confidence)}%</span>
                        <span>Uncertainty {Math.round(evalResult.uncertainty)}% · {titleCase(evalResult.uncertaintyBand)}</span>
                      </div>
                      <div className="core-meter"><span style={{ width: `${evalResult.confidence}%` }} /></div>
                    </div>
                    {evalResult.dataQuality ? (
                      <ul className="core-facts">
                        <li><span>Quote basis</span><strong>{titleCase(evalResult.dataQuality.basis)}</strong></li>
                        <li><span>Quote age</span><strong>{evalResult.dataQuality.ageSeconds === null ? 'unavailable' : `${evalResult.dataQuality.ageSeconds}s`}</strong></li>
                        <li><span>Data quality</span><strong>{Math.round((evalResult.dataQuality.score || 0) * 100)}%</strong></li>
                        {evalResult.context?.breadthPercent !== undefined ? <li><span>Watchlist breadth</span><strong>{plainPercent(evalResult.context.breadthPercent, 0)}</strong></li> : null}
                      </ul>
                    ) : null}
                  </div>
                  <div className="core-models">
                    <span className="core-kicker">Model comparison</span>
                    {(evalResult.models || []).map((model) => (
                      <div className="core-model" key={model.id}>
                        <div className="core-model-row">
                          <span>{model.name}</span>
                          <span className={`core-vote ${model.vote > 0 ? 'up' : model.vote < 0 ? 'down' : 'flat'}`}>
                            {model.vote > 0 ? <ArrowUpRight size={13} /> : model.vote < 0 ? <ArrowDownRight size={13} /> : <Activity size={13} />}
                            {model.vote > 0 ? 'Bullish' : model.vote < 0 ? 'Bearish' : 'Neutral'}
                          </span>
                        </div>
                        <div className="core-meter thin"><span style={{ width: `${Math.round((model.strength || 0) * 100)}%` }} /></div>
                        <small>{model.evidence}</small>
                      </div>
                    ))}
                  </div>
                </div>

                {evalResult.riskPreview ? (
                  <div className={`core-preflight ${evalResult.riskPreview.allowed ? 'is-approved' : 'is-blocked'}`}>
                    <div className="core-preflight-head">
                      <div>
                        <span className="core-kicker">Risk Shield preflight · advisory only</span>
                        <strong>{evalResult.riskPreview.allowed ? 'Structure would pass' : 'Order would be blocked'}</strong>
                      </div>
                      <StatusPill status={evalResult.riskPreview.allowed ? 'pass' : 'fail'} label={evalResult.riskPreview.allowed ? 'Approved' : 'Blocked'} />
                    </div>
                    <p>{evalResult.riskPreview.reason}</p>
                    <div className="core-preflight-stats">
                      <Stat label="Suggested qty" value={evalResult.riskPreview.qty ?? '—'} />
                      <Stat label="Notional" value={money(evalResult.riskPreview.value)} />
                      <Stat label="Stop-loss" value={money(evalResult.riskPreview.stopLoss)} />
                      <Stat label="Target" value={money(evalResult.riskPreview.target)} />
                    </div>
                    <div className="core-checks">
                      {(evalResult.riskPreview.checks || []).map((check) => (
                        <span key={check.id} className={`core-check tone-${STATUS_TONE[check.status] || 'neutral'}`} title={check.detail}>
                          {check.status === 'pass' ? <CheckCircle2 size={12} /> : check.status === 'warn' ? <AlertTriangle size={12} /> : <XCircle size={12} />}
                          {check.label}
                        </span>
                      ))}
                    </div>
                    <small className="core-muted-note">Preflight never places an order. The same gate runs again for any automated entry, and the idempotency key prevents duplicate execution.</small>
                  </div>
                ) : null}
                <p className="core-disclaimer"><Info size={13} /> {evalResult.execution?.reason || 'Analysis never places an order.'}</p>
              </div>
            ) : (
              <div className="core-empty">
                <Brain size={26} />
                <strong>No evaluation yet</strong>
                <span>Choose a symbol and run an evaluation. Each result lists every model vote, confidence, uncertainty and data-quality limit.</span>
              </div>
            )}

            {watchlistResult ? (
              <div className="core-watchtable">
                <div className="core-table-head">
                  <span>Watchlist scan · {watchlistResult.symbolsEvaluated} evaluated · breadth {plainPercent(watchlistResult.market?.breadthPercent, 0)}</span>
                  <StatusPill status={watchlistResult.market?.regime === 'risk-on' ? 'healthy' : watchlistResult.market?.regime === 'risk-off' ? 'degraded' : 'neutral'} label={titleCase(watchlistResult.market?.regime)} />
                </div>
                <div className="core-table-scroll">
                  <table>
                    <thead><tr><th>Symbol</th><th>Decision</th><th>Confidence</th><th>Score</th><th>Quote</th></tr></thead>
                    <tbody>
                      {watchlistResult.evaluations.map((row) => (
                        <tr key={row.symbol}>
                          <td><strong>{row.symbol}</strong></td>
                          <td><span className={`core-pill tone-${DECISION_META[row.decision]?.tone || 'neutral'}`}>{DECISION_META[row.decision]?.label || titleCase(row.decision)}</span></td>
                          <td>{row.confidence === undefined ? '—' : `${Math.round(row.confidence)}%`}</td>
                          <td>{row.signal?.score ?? '—'}</td>
                          <td>{row.quote?.price ? money(row.quote.price) : '—'} <small>{row.quote ? titleCase(row.quote.basis) : ''}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel
            id="core-risk"
            icon={ShieldCheck}
            title="AI Risk Shield"
            subtitle="Independent pre-trade validation, risk-based sizing and an emergency kill switch."
            aside={<StatusPill status={riskActive ? 'halted' : 'online'} label={riskActive ? 'Trading halted' : 'Armed'} />}
          >
            <div className="core-risk-grid">
              <div className={`core-kill ${riskActive ? 'is-active' : ''}`}>
                <div className="core-kill-head">
                  <span className="core-icon-badge">{riskActive ? <Lock size={18} /> : <Unlock size={18} />}</span>
                  <div>
                    <strong>{riskActive ? 'Kill switch active' : 'Kill switch armed'}</strong>
                    <small>{riskActive ? (risk.killSwitch?.reason || 'Automated entries are blocked.') : 'Automated entries still require every risk check to pass.'}</small>
                  </div>
                </div>
                <button
                  type="button"
                  className={`core-btn ${riskActive ? 'core-btn-gold' : 'core-btn-danger'}`}
                  onClick={() => { setKillModal(riskActive ? 'release' : 'activate'); setKillReason(''); setActionError(''); }}
                >
                  <Power size={15} /> {riskActive ? 'Release switch' : 'Activate kill switch'}
                </button>
                <small className="core-muted-note">Activation and release are audited. Automated entries fail closed while active.</small>
              </div>
              <div className="core-stats four">
                <Stat label="Peak equity" value={money(risk?.peakEquity)} />
                <Stat label="Current equity" value={money(risk?.currentEquity)} />
                <Stat label="Drawdown" value={plainPercent(risk?.drawdownPercent, 2)} tone={Number(risk?.drawdownPercent) >= 10 ? 'bad' : 'good'} />
                <Stat label="Blocked today" value={risk?.today?.blocked ?? 0} sub={`${risk?.today?.approved ?? 0} approved / ${risk?.today?.evaluated ?? 0} evaluated`} />
              </div>
            </div>

            <div className="core-facts-grid">
              <div className="core-facts-card">
                <span className="core-kicker">Authoritative limits</span>
                <ul className="core-facts">
                  <li><span>Max drawdown</span><strong>{plainPercent(risk?.config?.maxDrawdownPercent, 0)}</strong></li>
                  <li><span>Risk per trade</span><strong>{plainPercent(risk?.config?.riskPerTradePercent, 2)}</strong></li>
                  <li><span>Minimum reward:risk</span><strong>{number(risk?.config?.minRewardRiskRatio, 1)} : 1</strong></li>
                  <li><span>Authority</span><strong>Final gate</strong></li>
                </ul>
              </div>
              <div className="core-facts-card">
                <span className="core-kicker">Guardrails enforced on every entry</span>
                <div className="core-guardrails">
                  {['Funds & margin', 'Daily loss limit', 'Max drawdown', 'Exposure cap', 'Position slots', 'Stop-loss & target', 'Reward:risk', 'Duplicate & idempotency', 'Kill switch', 'Signal quality'].map((item) => (
                    <span key={item}><CheckCircle2 size={13} /> {item}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="core-table-head spaced">
              <span>Recent decisions</span>
              <span>{risk?.recentDecisions?.length || 0} of {risk?.today?.evaluated || 0} today</span>
            </div>
            {risk?.recentDecisions?.length ? (
              <div className="core-table-scroll">
                <table>
                  <thead><tr><th>Time</th><th>Symbol</th><th>Source</th><th>Outcome</th><th>Reason</th></tr></thead>
                  <tbody>
                    {risk.recentDecisions.map((decision) => (
                      <tr key={decision.id}>
                        <td>{istTime(decision.at)}</td>
                        <td><strong>{decision.symbol || '—'}</strong></td>
                        <td>{titleCase(decision.source)}</td>
                        <td><span className={`core-pill tone-${decision.allowed ? 'good' : 'bad'}`}>{decision.allowed ? 'Approved' : 'Blocked'}</span></td>
                        <td className="core-reason">{decision.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="core-empty slim"><ShieldCheck size={22} /><span>No risk decisions recorded yet. Automated entries and preflights appear here with the full check list.</span></div>
            )}
          </Panel>

          <Panel
            id="core-recovery"
            icon={RefreshCw}
            title="Smart Recovery Engine"
            subtitle="Fault detection, exponential backoff, idempotent reconciliation — never a blind resubmit."
            aside={<StatusPill status={unreconciled ? 'attention' : recovery?.provider?.status || 'online'} />}
          >
            <div className="core-recovery-top">
              <div className="core-stats four">
                <Stat label="Research provider" value={titleCase(recovery?.provider?.status)} sub={`${recovery?.provider?.attempts || 0} failed attempt(s)`} />
                <Stat label="Next probe" value={recovery?.provider?.nextProbeAt ? ago(recovery.provider.nextProbeAt).replace(' ago', '') : '—'} sub="exponential backoff" />
                <Stat label="Pending intents" value={recovery?.counts?.pending ?? 0} sub="in flight or unverified" />
                <Stat label="Unresolved" value={unreconciled} tone={unreconciled ? 'bad' : 'good'} sub="never resubmitted" />
              </div>
              <div className="core-recovery-actions">
                <button type="button" className="core-btn core-btn-silver" onClick={reconcileRecovery} disabled={busy === 'reconcile'}>
                  {busy === 'reconcile' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Reconcile ledger
                </button>
                <span className="core-badge"><Fingerprint size={13} /> {recovery?.intents?.length || 0} stored intent(s)</span>
              </div>
            </div>
            <div className="core-note-line">
              <Network size={15} />
              <span><strong>Broker routing:</strong> {recovery?.broker?.configured ? 'configured' : 'not configured'} · {recovery?.broker?.reason}</span>
            </div>
            <div className="core-note-line">
              <Timer size={15} />
              <span><strong>Retry policy:</strong> {recovery?.provider?.retryPolicy || 'exponential backoff'} · <strong>Resubmit:</strong> never. A timed-out order is verified against the paper ledger first.</span>
            </div>
            {recovery?.alerts?.length ? (
              <div className="core-alert-list">
                {recovery.alerts.map((alert) => (
                  <div className={`core-alert-row ${alert.resolved ? 'is-resolved' : ''}`} key={alert.id}>
                    <AlertTriangle size={15} />
                    <div>
                      <strong>{alert.title}</strong>
                      <span>{alert.message}</span>
                      <small>{istTime(alert.at, true)} · {alert.severity}</small>
                    </div>
                    {alert.resolved ? <span className="core-pill tone-good">Resolved</span> : (
                      <button type="button" className="core-btn core-btn-ghost small" onClick={() => acknowledgeRecovery(alert.id)} disabled={busy === `alert-${alert.id}`}>
                        {busy === `alert-${alert.id}` ? <Loader2 size={13} className="spin" /> : 'Acknowledge'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="core-empty slim"><CheckCircle2 size={22} /><span>No recovery alerts. Provider probes and ledger reconciliation are running.</span></div>
            )}
            {recovery?.intents?.length ? (
              <div className="core-table-scroll">
                <table>
                  <thead><tr><th>Intent</th><th>Symbol</th><th>Qty</th><th>Status</th><th>Created</th></tr></thead>
                  <tbody>
                    {recovery.intents.map((intent) => (
                      <tr key={intent.id}>
                        <td className="mono">{String(intent.idempotencyKey || '').slice(0, 14)}…</td>
                        <td><strong>{intent.symbol}</strong></td>
                        <td>{intent.qty}</td>
                        <td><StatusPill status={intent.status === 'confirmed' ? 'healthy' : intent.status === 'unresolved' ? 'down' : 'warn'} label={titleCase(intent.status)} /></td>
                        <td>{istTime(intent.createdAt, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Panel>

          <Panel
            id="core-performance"
            icon={Gauge}
            title="AI Performance Score"
            subtitle="Cost-aware evaluation. Win rate alone never ranks a strategy."
            aside={(
              <label className="core-cost">
                Cost/side
                <select value={costBps} onChange={(event) => setCostBps(Number(event.target.value))}>
                  <option value={0}>0 bps</option>
                  <option value={12}>12 bps</option>
                  <option value={25}>25 bps</option>
                  <option value={50}>50 bps</option>
                </select>
              </label>
            )}
          >
            <div className="core-effects">
              <span><Info size={13} /> The paper ledger itself is cost-free; every metric below applies a modelled round-trip cost of {costBps} bps per side.</span>
              <span>{performance?.sample?.complete ? 'Full stored ledger' : `Stored history covers ${performance?.sample?.storedTrades || 0} of ${performance?.sample?.lifetimeTrades || 0} trades`}</span>
            </div>
            <div className="core-stats six">
              <Stat label="Net P&L (after costs)" value={paper?.netPnl == null ? '—' : signedMoney(paper.netPnl)} tone={Number(paper?.netPnl) >= 0 ? 'good' : 'bad'} sub={paper?.netReturnPercent == null ? 'no closed trades' : plainPercent(paper.netReturnPercent, 2)} />
              <Stat label="Win rate" value={paper?.winRatePercent == null ? '—' : plainPercent(paper.winRatePercent)} sub={`${paper?.winCount ?? 0}W / ${paper?.lossCount ?? 0}L`} />
              <Stat label="Profit factor" value={number(paper?.profitFactor)} sub="gross win ÷ gross loss" />
              <Stat label="Max drawdown" value={paper?.maxDrawdownPercent == null ? '—' : plainPercent(paper.maxDrawdownPercent)} tone={Number(paper?.maxDrawdownPercent) > 15 ? 'bad' : 'good'} />
              <Stat label="Sharpe (annualised)" value={number(paper?.riskAdjusted?.sharpe)} sub="trade-day returns" />
              <Stat label="Expectancy / trade" value={paper?.expectancy == null ? '—' : signedMoney(paper.expectancy)} sub={`avg win ${paper?.averageWin == null ? '—' : money(paper.averageWin)} · avg loss ${paper?.averageLoss == null ? '—' : money(paper.averageLoss)}`} />
            </div>

            <div className="core-perf-grid">
              <div className="core-facts-card">
                <div className="core-table-head"><span>Cost-adjusted equity</span><span>{paper?.tradeCount || 0} closed trade(s)</span></div>
                <EquityCurve points={paper?.equityCurve} />
                <ul className="core-facts tight">
                  <li><span>Modeled costs</span><strong>{money(paper?.modeledCosts)}</strong></li>
                  <li><span>Largest win</span><strong className="up">{paper?.largestWin == null ? '—' : signedMoney(paper.largestWin)}</strong></li>
                  <li><span>Largest loss</span><strong className="down">{paper?.largestLoss == null ? '—' : signedMoney(paper.largestLoss)}</strong></li>
                  <li><span>Average holding</span><strong>{paper?.averageHoldingHours == null ? '—' : `${number(paper.averageHoldingHours, 1)}h`}</strong></li>
                </ul>
              </div>
              <div className="core-facts-card">
                <div className="core-table-head"><span>Paper vs live</span><StatusPill status={performance?.paperVsLive?.live?.available ? 'healthy' : 'neutral'} label={performance?.paperVsLive?.mode || 'paper-only'} /></div>
                <p className="core-note">{performance?.paperVsLive?.live?.reason || 'Live comparison is unavailable.'}</p>
                <div className="core-compare">
                  <div>
                    <span>Paper</span>
                    <strong>{paper?.tradeCount ?? 0} trades</strong>
                    <small>{paper?.netPnl == null ? 'no closed P&L' : signedMoney(paper.netPnl)}</small>
                  </div>
                  <div className="is-muted">
                    <span>Live</span>
                    <strong>Unavailable</strong>
                    <small>broker routing disabled</small>
                  </div>
                </div>
                <p className="core-disclaimer"><Lock size={13} /> No live fills exist, so none are estimated or invented.</p>
              </div>
            </div>

            <div className="core-table-head spaced"><span>Strategy comparison</span><span>Ranked by composite, not win rate</span></div>
            {performance?.strategies?.length ? (
              <div className="core-table-scroll">
                <table>
                  <thead><tr><th>#</th><th>Strategy</th><th>Score</th><th>Trades</th><th>Net P&L</th><th>Win rate</th><th>Profit factor</th><th>Max DD</th></tr></thead>
                  <tbody>
                    {performance.strategies.map((strategy) => (
                      <tr key={strategy.id}>
                        <td>{strategy.rank}</td>
                        <td><strong>{strategy.name}</strong><small className="block">{strategy.source}</small></td>
                        <td><span className="core-score">{number(strategy.score?.score, 1)}</span></td>
                        <td>{strategy.metrics.tradeCount}</td>
                        <td className={Number(strategy.metrics.netPnl) >= 0 ? 'up' : 'down'}>{strategy.metrics.netPnl === null ? '—' : signedMoney(strategy.metrics.netPnl)}</td>
                        <td>{plainPercent(strategy.metrics.winRatePercent)}</td>
                        <td>{number(strategy.metrics.profitFactor)}</td>
                        <td>{plainPercent(strategy.metrics.maxDrawdownPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="core-empty slim"><Gauge size={22} /><span>No closed paper trades yet, so no strategy can be scored. Metrics appear after the first exit.</span></div>
            )}
            <p className="core-note">{performance?.ranking?.strategy}</p>

            <div className="core-walkforward">
              <div className="core-walkforward-head">
                <div>
                  <span className="core-kicker"><FlaskConical size={13} /> Out-of-sample validation</span>
                  <h3>70 / 30 walk-forward test</h3>
                  <p>Select target and stop-loss values on the first 70% of verified daily bars, then evaluate once on the untouched remainder. Costs and drawdown are included.</p>
                </div>
                <button type="button" className="core-btn core-btn-gold" onClick={runWalkForward} disabled={busy === 'walkforward'}>
                  {busy === 'walkforward' ? <Loader2 size={15} className="spin" /> : <FlaskConical size={15} />} Run out-of-sample test
                </button>
              </div>
              {walkError ? <div className="core-inline-warn"><AlertTriangle size={15} /> {walkError}</div> : null}
              {walkResult ? (
                <div className="core-walkresult">
                  <div className="core-walkresult-head">
                    <StatusPill status={walkResult.verdict === 'held_up' ? 'held_up' : walkResult.verdict} />
                    <span>{walkResult.testedSymbols} symbol(s) tested · {walkResult.costBpsPerSide} bps/side · average OOS return {walkResult.summary?.averageOutOfSampleReturnPercent === null ? 'n/a' : percent(walkResult.summary.averageOutOfSampleReturnPercent, 2)}</span>
                  </div>
                  <div className="core-table-scroll">
                    <table>
                      <thead><tr><th>Symbol</th><th>Status</th><th>Target / stop</th><th>In-sample</th><th>Out-of-sample</th><th>OOS drawdown</th></tr></thead>
                      <tbody>
                        {walkResult.results.map((row) => (
                          <tr key={row.symbol}>
                            <td><strong>{row.symbol}</strong></td>
                            <td><StatusPill status={row.status === 'held_up' ? 'held_up' : row.status === 'degraded' ? 'degraded' : 'neutral'} label={titleCase(row.status)} /></td>
                            <td>{row.selectedParameters ? `${row.selectedParameters.targetPercent}% / ${row.selectedParameters.stopLossPercent}%` : '—'}</td>
                            <td>{row.inSample ? `${row.inSample.tradeCount} trades · ${percent(row.inSample.netReturnPercent, 2)}` : '—'}</td>
                            <td>{row.outOfSample ? `${row.outOfSample.tradeCount} trades · ${percent(row.outOfSample.netReturnPercent, 2)}` : '—'}</td>
                            <td>{row.outOfSample ? plainPercent(row.outOfSample.maxDrawdownPercent, 2) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="core-disclaimer"><Info size={13} /> {(walkResult.assumptions || [])[1]} Historical simulation is not a forecast.</p>
                </div>
              ) : (
                <div className="core-empty slim"><FlaskConical size={22} /><span>No walk-forward run yet. The test uses your watchlist (up to 8 symbols) and writes results to the audit trail.</span></div>
              )}
            </div>
          </Panel>

          <Panel
            id="core-health"
            icon={HeartPulse}
            title="24/7 System Health"
            subtitle="Always-on monitoring, API latency, resources, incidents and error logging."
            aside={<StatusPill status={health?.status || 'healthy'} label={`Checked ${ago(health?.checkedAt)}`} />}
          >
            <div className="core-health-grid">
              {[
                ['api', 'API availability', Activity, health?.components?.api?.detail || `${health?.components?.api?.requests ?? 0} requests in window · p95 ${health?.components?.api?.p95LatencyMs ?? '—'} ms`],
                ['database', 'Store & audit DB', Database, health?.components?.database?.detail || 'Atomic JSON document store'],
                ['marketFeed', 'Market data feed', Radio, health?.components?.marketFeed?.detail || 'Feed monitoring armed'],
                ['realtime', 'Realtime transport', Network, health?.components?.realtime?.detail || 'SSE and WebSocket status'],
                ['system', 'Process & event loop', Cpu, `${health?.components?.system?.memory?.rssMb ?? '—'} MB RSS · loop p95 ${health?.components?.system?.eventLoop?.p95Ms ?? '—'} ms`],
              ].map(([key, label, Icon, detail]) => {
                const component = components[key] || {};
                return (
                  <div className={`core-health-card tone-${STATUS_TONE[component.status] || 'neutral'}`} key={key}>
                    <div className="core-health-head">
                      <span className="core-icon-badge"><Icon size={16} /></span>
                      <StatusPill status={component.status || 'neutral'} />
                    </div>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </div>
                );
              })}
            </div>

            <div className="core-stats four">
              <Stat label="Uptime" value={components.system?.uptimeSeconds ? `${Math.floor(components.system.uptimeSeconds / 3600)}h ${Math.floor((components.system.uptimeSeconds % 3600) / 60)}m` : '—'} sub={components.system?.platform} />
              <Stat label="CPU" value={components.system?.cpuPercent === undefined ? '—' : plainPercent(components.system.cpuPercent, 1)} sub={`${components.system?.cores ?? '—'} core(s) · load ${number(components.system?.loadAverage?.[0], 2)}`} />
              <Stat label="Memory" value={components.system?.memory?.rssMb === undefined ? '—' : `${Math.round(components.system.memory.rssMb)} MB`} sub={`${plainPercent(components.system?.memory?.systemUsedPercent, 1)} of system memory`} />
              <Stat label="API errors" value={plainPercent(components.api?.errorRatePercent, 1)} tone={Number(components.api?.errorRatePercent) > 5 ? 'bad' : 'good'} sub={`p50 ${components.api?.p50LatencyMs ?? '—'} ms · p95 ${components.api?.p95LatencyMs ?? '—'} ms`} />
            </div>

            <div className="core-note-line">
              <Server size={15} />
              <span><strong>Audit chain:</strong> {health?.components?.database?.auditChain?.ok ? `verified · ${health.components.database.auditChain.entries} entries` : 'verification failed'} · <strong>Monitor:</strong> every {health?.metadata?.intervalSeconds || 30}s, outside market hours too.</span>
            </div>

            {health?.components?.database?.stores?.length ? (
              <div className="core-store-row">
                {health.components.database.stores.map((store) => (
                  <span className={`core-store ${store.primary.ok ? 'ok' : store.backup.ok ? 'warn' : 'missing'}`} key={store.name}>
                    <Database size={12} /> {store.name} <small>{store.primary.ok ? `${store.primary.bytes} B` : store.backup.ok ? 'backup' : 'pending'}</small>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="core-table-head spaced"><span>Incidents</span><span>{openIncidents.length} open · {incidents.length} stored</span></div>
            {incidents.length ? (
              <div className="core-incident-list">
                {incidents.slice(0, 8).map((incident) => (
                  <div className={`core-incident ${incident.resolvedAt ? 'is-resolved' : ''}`} key={incident.id}>
                    <span className={`core-severity tone-${incident.severity === 'critical' ? 'bad' : 'warn'}`}>{incident.severity}</span>
                    <div>
                      <strong>{incident.title}</strong>
                      <span>{incident.detail}</span>
                      <small>{istTime(incident.openedAt, true)}{incident.resolvedAt ? ` · resolved in ${incident.durationSeconds}s` : ' · open'}{incident.acknowledgedAt ? ' · acknowledged' : ''}</small>
                    </div>
                    {incident.resolvedAt ? <StatusPill status="healthy" label="Resolved" /> : (
                      <button type="button" className="core-btn core-btn-ghost small" onClick={() => acknowledgeIncident(incident.id)} disabled={busy === `incident-${incident.id}`}>
                        {busy === `incident-${incident.id}` ? <Loader2 size={13} className="spin" /> : 'Acknowledge'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="core-empty slim"><CheckCircle2 size={22} /><span>No incidents stored. Threshold breaches open and resolve incidents automatically.</span></div>
            )}

            {health?.recentErrors?.length ? (
              <details className="core-errors">
                <summary>Recent error log · {health.recentErrors.length}</summary>
                <div className="core-table-scroll">
                  <table>
                    <thead><tr><th>Time</th><th>Scope</th><th>Message</th></tr></thead>
                    <tbody>
                      {health.recentErrors.map((entry) => (
                        <tr key={entry.id}><td>{istTime(entry.at)}</td><td>{entry.scope}</td><td className="core-reason">{entry.message}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </Panel>

          <Panel
            id="core-audit"
            icon={FileCheck2}
            title="Audit Trail"
            subtitle="Hash-chained record of every AI, risk, recovery and performance action."
            aside={(
              <button type="button" className="core-btn core-btn-ghost small" onClick={verifyChain} disabled={busy === 'audit'}>
                {busy === 'audit' ? <Loader2 size={13} className="spin" /> : <FileCheck2 size={13} />} Verify chain
              </button>
            )}
          >
            <div className={`core-chain ${audit?.verification?.ok ? 'is-verified' : 'is-broken'}`}>
              {audit?.verification?.ok ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
              <div>
                <strong>{audit?.verification?.ok ? 'Chain integrity verified' : 'Chain integrity check required'}</strong>
                <span>{audit?.verification?.entries || 0} entries · last hash {String(audit?.verification?.lastHash || '—').slice(0, 16)}… · {audit?.verification?.lastAt ? istTime(audit.verification.lastAt, true) : 'no entries'}</span>
              </div>
            </div>
            {audit?.entries?.length ? (
              <div className="core-table-scroll">
                <table>
                  <thead><tr><th>Seq</th><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Outcome</th></tr></thead>
                  <tbody>
                    {audit.entries.map((entry) => (
                      <tr key={entry.seq}>
                        <td className="mono">{entry.seq}</td>
                        <td>{istTime(entry.at, true)}</td>
                        <td>{entry.actor?.name || entry.actor?.id} <small className="block">{entry.actor?.role}</small></td>
                        <td className="mono">{entry.action}</td>
                        <td className="core-reason">{entry.resource}</td>
                        <td><span className={`core-pill tone-${entry.outcome === 'success' ? 'good' : entry.outcome === 'denied' ? 'bad' : 'warn'}`}>{titleCase(entry.outcome)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="core-empty slim"><FileCheck2 size={22} /><span>No audit entries yet. Reading the overview, preflights and kill-switch changes are recorded.</span></div>
            )}
          </Panel>
        </div>

        <aside className="core-side">
          <div className="core-side-card">
            <span className="core-kicker"><Wallet size={13} /> Paper account</span>
            <div className="core-account-value">{money(overview?.account?.equity)}</div>
            <small>Total paper equity</small>
            <div className="core-account-grid">
              <div><span>Cash</span><strong>{money(overview?.account?.cash)}</strong></div>
              <div><span>Invested</span><strong>{money(overview?.account?.investedValue)}</strong></div>
              <div><span>Day P&L</span><strong className={Number(overview?.account?.dayPnl) >= 0 ? 'up' : 'down'}>{signedMoney(overview?.account?.dayPnl)}</strong></div>
              <div><span>Open</span><strong>{overview?.account?.openPositions ?? 0}</strong></div>
            </div>
            <div className={`core-side-kill ${riskActive ? 'is-active' : ''}`}>
              {riskActive ? <Lock size={14} /> : <Unlock size={14} />}
              {riskActive ? 'Kill switch active' : 'Risk Shield armed'}
            </div>
            <Link className="core-side-link" to="/ai-trading">Open AI Auto Trading <ArrowUpRight size={14} /></Link>
          </div>

          <div className="core-side-card">
            <span className="core-kicker"><Radio size={13} /> Live module events</span>
            <div className="core-stream-state">
              <span className={`core-live ${live ? 'is-live' : ''}`}><span className="core-pill-dot" /> {live ? 'SSE connected' : 'SSE reconnecting'}</span>
              <small>{overview?.communication?.transport || 'event bus'}</small>
            </div>
            <div className="core-eventlist">
              {liveEvents.length ? liveEvents.slice(0, 14).map((event) => (
                <div className="core-event" key={event.id}>
                  <span className={`core-event-dot tone-${topicTone(event.topic)}`} />
                  <div>
                    <strong>{titleCase(event.topic)}</strong>
                    <small>{istTime(event.at)}</small>
                  </div>
                </div>
              )) : (
                <div className="core-empty slim"><Activity size={18} /><span>Events appear as modules communicate. The stream is connected when signed in.</span></div>
              )}
            </div>
            <small className="core-muted-note">SSE and WebSocket share the same event bus; no polling is required for alerts.</small>
          </div>

          <div className="core-side-card core-guardrail-card">
            <span className="core-kicker"><ShieldCheck size={13} /> Guardrails</span>
            <ul>
              <li><CheckCircle2 size={14} /> Live broker orders disabled</li>
              <li><CheckCircle2 size={14} /> Risk Shield can veto the AI</li>
              <li><CheckCircle2 size={14} /> Idempotency keys on automated entries</li>
              <li><CheckCircle2 size={14} /> Hash-chained audit trail</li>
              <li><CheckCircle2 size={14} /> Timeouts are verified, never resubmitted</li>
              <li><CheckCircle2 size={14} /> Delayed feeds labelled honestly</li>
            </ul>
            <p>Paper results are not indicative of live trading. Nothing here is investment advice.</p>
          </div>
        </aside>
      </div>

      {killModal ? (
        <div className="core-modal-backdrop" role="dialog" aria-modal="true" aria-label={killModal === 'activate' ? 'Activate kill switch' : 'Release kill switch'}>
          <div className="core-modal">
            <button type="button" className="core-modal-close" onClick={() => setKillModal(null)} aria-label="Close">
              <X size={17} />
            </button>
            <span className="core-icon-badge">{killModal === 'activate' ? <Lock size={19} /> : <Unlock size={19} />}</span>
            <h3>{killModal === 'activate' ? 'Stop all automated entries?' : 'Release the kill switch?'}</h3>
            <p>
              {killModal === 'activate'
                ? 'The Risk Shield will reject every new automated and preflight order until the switch is released. Existing paper positions still follow their exits.'
                : 'Automated entries can pass the Risk Shield again once a new decision clears every check. The release is audited.'}
            </p>
            <label className="core-field">
              Reason (required)
              <input value={killReason} onChange={(event) => setKillReason(event.target.value)} placeholder="e.g. verifying a risk anomaly" maxLength={240} autoFocus />
            </label>
            <div className="core-modal-actions">
              <button type="button" className="core-btn core-btn-ghost" onClick={() => setKillModal(null)}>Cancel</button>
              <button type="button" className={`core-btn ${killModal === 'activate' ? 'core-btn-danger' : 'core-btn-gold'}`} onClick={submitKillSwitch} disabled={busy === 'kill'}>
                {busy === 'kill' ? <Loader2 size={15} className="spin" /> : <Power size={15} />}
                {killModal === 'activate' ? 'Activate kill switch' : 'Release switch'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AICore;
