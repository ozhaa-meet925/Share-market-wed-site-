import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Bot,
  Briefcase,
  CheckCircle2,
  Clock,
  Cpu,
  Gauge,
  History,
  Info,
  LineChart,
  Lock,
  Pause,
  Play,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { autoTradeApi } from '../services/autoTrade';
import { brokersApi } from '../services/brokers';
import { marketApi } from '../services/api';
import { TickArrow, TickPrice } from '../components/PriceChange';
import LiveChart from '../components/LiveChart';
import { coreApi } from '../services/core';
import { forecastsApi } from '../services/forecasts';
import { getCurrentUser } from '../services/auth';
import { stocks as stockSeed } from '../data/stocks';
import { forecastFromDailyCandles } from '../utils/marketForecast';
import './AITrading.css';

const money = (value, digits = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number < 0 ? '-' : ''}₹${Math.abs(number).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

const signedMoney = (value, digits = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : number < 0 ? '-' : ''}₹${Math.abs(number).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

const signedPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
};

const pnlClass = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'price-flat';
  return number > 0 ? 'ai-gain' : number < 0 ? 'ai-loss' : 'price-flat';
};

const istTime = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const istClock = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const istDate = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
};

const forecastOutcomeLabel = (item) => {
  if (item.status === 'pending') return 'Waiting for target bar';
  if (item.status === 'unscorable') return 'Neutral · not scored';
  const close = Number.isFinite(Number(item.resolvedClose))
    ? ` at ₹${Number(item.resolvedClose).toLocaleString('en-IN')}`
    : '';
  return `${item.status === 'correct' ? 'Hit' : 'Miss'}${close}`;
};

const STATUS_META = {
  running: { label: 'Agent running', className: 'is-running', icon: Activity },
  paused: { label: 'Paused · exits only', className: 'is-paused', icon: Pause },
  stopped: { label: 'Agent stopped', className: 'is-stopped', icon: Square },
};

const BASIS_LABEL = {
  live: 'Live provider quotes',
  delayed: 'Delayed research quotes',
  unavailable: 'No verified quotes',
  unknown: 'Quote basis unknown',
};

// Per-position / per-signal quote badge. 'unknown' is kept distinct from
// 'delayed' so an undated price is never presented as a normal delayed quote.
const BASIS_CHIP_LABEL = {
  live: 'Live',
  delayed: 'Delayed',
  unknown: 'Unclassified · unverified',
  unavailable: 'No quote',
};

const ACTION_CLASS = { Buy: 'is-buy', Watch: 'is-watch', Avoid: 'is-avoid', Unavailable: 'is-unavailable' };

const RiskField = ({ label, suffix, value, onChange, min, max, step = 1, hint }) => (
  <label className="ai-field">
    <span>{label}{suffix ? <em>{suffix}</em> : null}</span>
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
    {hint ? <small>{hint}</small> : null}
  </label>
);

const BacktestCurve = ({ curve }) => {
  if (!Array.isArray(curve) || curve.length < 2) return null;
  const values = curve.map((point) => Number(point.equity)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 30 - ((value - min) / span) * 27;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const rising = values[values.length - 1] >= values[0];
  const fillId = rising ? 'ai-curve-up-fill' : 'ai-curve-down-fill';
  const curveColor = rising ? 'var(--ai-green)' : 'var(--ai-red)';
  return (
    <svg className="ai-curve" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Backtest equity curve">
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={curveColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={curveColor} stopOpacity="0.015" />
        </linearGradient>
      </defs>
      {[10, 20, 30].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="ai-curve-axis" />)}
      <polygon points={`0,30 ${points} 100,30`} fill={`url(#${fillId})`} />
      <polyline points={points} fill="none" stroke={curveColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const AITrading = () => {
  const [account, setAccount] = useState(null);
  const [authRequired, setAuthRequired] = useState(!getCurrentUser());
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const [startModal, setStartModal] = useState(false);
  const [startAck, setStartAck] = useState(false);
  const [startPhrase, setStartPhrase] = useState('');
  const [stopModal, setStopModal] = useState(false);
  const [execModal, setExecModal] = useState(null);
  const [execPhrase, setExecPhrase] = useState('');
  const [execAck, setExecAck] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [brokerOptions, setBrokerOptions] = useState([]);
  const [readinessError, setReadinessError] = useState('');
  const [resumeModal, setResumeModal] = useState(false);
  const [resumePhrase, setResumePhrase] = useState('');
  const [resumeAck, setResumeAck] = useState(false);
  const [syncBusy, setSyncBusy] = useState('');

  const [config, setConfig] = useState(null);
  const [symbolInput, setSymbolInput] = useState('');
  const editingRef = useRef(false);

  const [signals, setSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState('');
  const [signalsGeneratedAt, setSignalsGeneratedAt] = useState(null);
  const [killSwitch, setKillSwitch] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const payload = await coreApi.riskStatus();
        if (active) setKillSwitch(payload?.killSwitch || null);
      } catch {
        // The banner is advisory; leave the last known state on transient failures.
      }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const [explain, setExplain] = useState(null);
  const [backtestSymbol, setBacktestSymbol] = useState('');
  const [backtestDays, setBacktestDays] = useState('250');
  const [backtest, setBacktest] = useState(null);
  const [backtestError, setBacktestError] = useState('');
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [ruleSymbol, setRuleSymbol] = useState('');
  const [ruleDays, setRuleDays] = useState('250');
  const [ruleRules, setRuleRules] = useState(['sma_cross', 'above_sma20', 'momentum_positive', 'rsi_below']);
  const [ruleRsiMax, setRuleRsiMax] = useState('72');
  const [ruleMomentum, setRuleMomentum] = useState('0.5');
  const [ruleTarget, setRuleTarget] = useState('4');
  const [ruleStop, setRuleStop] = useState('2');
  const [ruleResult, setRuleResult] = useState(null);
  const [ruleError, setRuleError] = useState('');
  const [ruleLoading, setRuleLoading] = useState(false);
  const [forecastSymbol, setForecastSymbol] = useState('');
  const [forecast, setForecast] = useState(null);
  const [forecastError, setForecastError] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);
  const [trackRecord, setTrackRecord] = useState([]);
  const [trackStats, setTrackStats] = useState(null);
  const [trackError, setTrackError] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);
  const [savingForecast, setSavingForecast] = useState(false);
  const [forecastSaveNote, setForecastSaveNote] = useState('');
  const [activityTab, setActivityTab] = useState('orders');
  const [selectedChartSymbol, setSelectedChartSymbol] = useState('');

  const initializedRef = useRef(false);
  const seenEventsRef = useRef(new Set());
  const loadRef = useRef(null);
  const reloadTimerRef = useRef(null);

  const statusMeta = STATUS_META[account?.status] || STATUS_META.stopped;
  const StatusIcon = statusMeta.icon;

  const publishAccount = useCallback((nextAccount) => {
    if (!nextAccount) return;
    setAccount(nextAccount);
    const fresh = nextAccount.events.filter((event) => !seenEventsRef.current.has(event.id));
    nextAccount.events.forEach((event) => seenEventsRef.current.add(event.id));
    if (initializedRef.current
      && nextAccount.notifications?.browser
      && typeof window !== 'undefined'
      && 'Notification' in window
      && Notification.permission === 'granted') {
      fresh
        .filter((event) => ['critical', 'warning', 'success'].includes(event.severity))
        .slice(0, 2)
        .forEach((event) => {
          try {
            new Notification(event.title, { body: event.message, icon: '/favicon.svg' });
          } catch {
            // Browser notification delivery is best-effort.
          }
        });
    }
    initializedRef.current = true;
  }, []);

  useEffect(() => {
    let active = true;
    let timer = null;
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const load = async () => {
      if (document.hidden) return;
      try {
        const payload = await autoTradeApi.getStatus();
        if (!active) return;
        publishAccount(payload.account);
        setAuthRequired(false);
        setLoadError('');
      } catch (error) {
        if (!active) return;
        if (error.status === 401) {
          setAuthRequired(true);
          stopPolling();
        } else {
          setLoadError(error.message);
        }
      }
    };
    loadRef.current = load;
    load();
    timer = setInterval(load, 3000);
    const onVisible = () => {
      if (!document.hidden && timer) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      stopPolling();
      loadRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [publishAccount]);

  useEffect(() => {
    const source = new EventSource(coreApi.streamUrl);
    source.addEventListener('core', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!['order.executed', 'risk.killSwitch', 'risk.decision', 'recovery.reconcile', 'recovery.reconciled', 'health.alert'].includes(payload.topic)) return;
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = setTimeout(() => loadRef.current?.(), 300);
      } catch {
        // Ignore malformed frames; the poll keeps running.
      }
    });
    return () => {
      clearTimeout(reloadTimerRef.current);
      source.close();
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!account || editingRef.current) return;
    setConfig({
      risk: Object.fromEntries(Object.entries(account.risk).map(([key, value]) => [key, String(value)])),
      watchlist: [...account.watchlist],
      tradeStyle: account.tradeStyle,
      notifications: { ...account.notifications },
    });
    if (!account.watchlist.includes(backtestSymbol)) setBacktestSymbol(account.watchlist[0] || 'RELIANCE');
    if (!account.watchlist.includes(ruleSymbol)) setRuleSymbol(account.watchlist[0] || 'RELIANCE');
  }, [account?.updatedAt, backtestSymbol, ruleSymbol]);

  useEffect(() => {
    if (account && !account.watchlist.includes(forecastSymbol)) setForecastSymbol(account.watchlist[0] || 'RELIANCE');
  }, [account?.updatedAt, forecastSymbol]);

  const watchlistKey = account?.watchlist?.join(',') || '';

  const refreshSignals = useCallback(async () => {
    setSignalsLoading(true);
    setSignalsError('');
    try {
      const payload = await autoTradeApi.getSignals();
      setSignals(payload.signals || []);
      setSignalsGeneratedAt(payload.generatedAt || null);
    } catch (error) {
      setSignalsError(error.message);
    } finally {
      setSignalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!watchlistKey) return undefined;
    refreshSignals();
    const timer = setInterval(() => {
      if (!document.hidden) refreshSignals();
    }, 60000);
    return () => clearInterval(timer);
  }, [watchlistKey, refreshSignals]);

  const updateRisk = (key, value) => {
    editingRef.current = true;
    setConfig((current) => (current ? { ...current, risk: { ...current.risk, [key]: value } } : current));
  };

  const setTradeStyle = (tradeStyle) => {
    editingRef.current = true;
    setConfig((current) => (current ? { ...current, tradeStyle } : current));
  };

  const setNotification = (key, value) => {
    editingRef.current = true;
    setConfig((current) => (current ? { ...current, notifications: { ...current.notifications, [key]: value } } : current));
  };

  const addWatchlistSymbol = () => {
    if (!config) return;
    const symbol = symbolInput.trim().toUpperCase();
    if (!/^[A-Z0-9&.\-]{1,20}$/.test(symbol)) {
      setActionError('Enter a valid NSE symbol, for example RELIANCE.');
      return;
    }
    if (config.watchlist.includes(symbol)) {
      setActionError(`${symbol} is already in the watchlist.`);
      return;
    }
    if (config.watchlist.length >= 20) {
      setActionError('The AI watchlist can hold up to 20 symbols.');
      return;
    }
    editingRef.current = true;
    setActionError('');
    setSymbolInput('');
    setConfig((current) => ({ ...current, watchlist: [...current.watchlist, symbol] }));
  };

  const removeWatchlistSymbol = (symbol) => {
    if (!config) return;
    if (config.watchlist.length <= 1) {
      setActionError('Keep at least one symbol in the AI watchlist.');
      return;
    }
    editingRef.current = true;
    setConfig((current) => ({ ...current, watchlist: current.watchlist.filter((item) => item !== symbol) }));
  };

  const saveConfig = async () => {
    if (!config) return;
    setBusy('save');
    setActionError('');
    try {
      const payload = await autoTradeApi.saveConfig({
        risk: Object.fromEntries(Object.entries(config.risk).map(([key, value]) => [key, Number(value)])),
        watchlist: config.watchlist,
        tradeStyle: config.tradeStyle,
        notifications: config.notifications,
      });
      editingRef.current = false;
      publishAccount(payload.account);
      setNotice('Settings saved. The agent applies them on the next scan.');
      refreshSignals();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const startAgent = async () => {
    setBusy('start');
    setActionError('');
    try {
      const payload = await autoTradeApi.start(startPhrase, startAck);
      publishAccount(payload.account);
      setStartModal(false);
      setStartAck(false);
      setStartPhrase('');
      setNotice(payload.account.mode === 'live'
        ? `AI auto-trader started in live mode${payload.account.execution?.broker ? ` via ${payload.account.execution.broker}` : ''}. The first scan begins automatically; orders still require a valid signal and all safety checks.`
        : 'AI auto-trader started in paper mode. The first scan begins automatically; a paper trade opens only when a valid signal passes all checks.');
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const stopAgent = async () => {
    setBusy('stop');
    setActionError('');
    try {
      const payload = await autoTradeApi.stop(true);
      publishAccount(payload.account);
      setStopModal(false);
      setNotice(payload.account.positions.length
        ? 'Emergency stop active. New entries are blocked; open paper positions remain monitored for exits.'
        : 'Emergency stop active. The agent is stopped and no new paper trades can open.');
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const pauseAgent = async () => {
    setBusy('pause');
    setActionError('');
    try {
      const payload = await autoTradeApi.pause();
      publishAccount(payload.account);
      setNotice('New entries paused. Open positions keep their stop-loss and target rules.');
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const resumeAgent = async () => {
    setBusy('resume');
    setActionError('');
    try {
      const payload = await autoTradeApi.resume();
      publishAccount(payload.account);
      setNotice('Auto entries resumed.');
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const authorizeResumeAfterHalt = async () => {
    setBusy('resume-halt');
    setActionError('');
    try {
      const payload = await autoTradeApi.resume(resumePhrase, resumeAck);
      publishAccount(payload.account);
      setResumeModal(false);
      setResumePhrase('');
      setResumeAck(false);
      setNotice('Daily risk halt cleared. New entries are authorized from a fresh risk baseline.');
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const checkLiveReadiness = async (broker) => {
    setReadiness({ loading: true, broker });
    setReadinessError('');
    try {
      const payload = await autoTradeApi.getReadiness(broker, true);
      setReadiness(payload.readiness);
    } catch (error) {
      setReadiness({ loading: false, broker, ready: false, blockers: [{ id: 'readiness', detail: error.message }], checks: [] });
      setReadinessError(error.message);
    }
  };

  const openExecutionModal = async (mode) => {
    setExecModal({ mode });
    setExecPhrase('');
    setExecAck(false);
    setReadiness(null);
    setBrokerOptions([]);
    setReadinessError('');
    setActionError('');
    if (mode !== 'live') return;
    try {
      const { brokers = [] } = await brokersApi.list();
      setBrokerOptions(brokers);
      const currentBroker = account?.execution?.broker;
      const preferredBroker = brokers.find((broker) => broker.id === currentBroker)?.id
        || brokers.find((broker) => broker.connection?.connected && broker.connection.mode !== 'paper')?.id
        || brokers.find((broker) => broker.connection?.connected)?.id
        || brokers.find((broker) => broker.connection?.configured)?.id
        || 'zerodha';
      await checkLiveReadiness(preferredBroker);
    } catch (error) {
      setReadiness({ loading: false, broker: '', ready: false, blockers: [{ id: 'readiness', detail: error.message }], checks: [] });
      setReadinessError(error.message);
    }
  };

  const confirmExecutionMode = async () => {
    if (!execModal) return;
    setBusy('execution');
    setActionError('');
    try {
      const broker = execModal.mode === 'live' ? readiness?.broker : null;
      const payload = await autoTradeApi.setExecution(execModal.mode, broker, execPhrase, execAck);
      publishAccount(payload.account);
      setExecModal(null);
      setExecPhrase('');
      setExecAck(false);
      setNotice(execModal.mode === 'live'
        ? `Live execution authorized via ${broker}. Start the agent to scan with broker data.`
        : 'Paper execution restored. No broker orders will be sent.');
    } catch (error) {
      if (error.payload?.readiness) setReadiness(error.payload.readiness);
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const syncBrokerOrders = async () => {
    setSyncBusy('sync');
    setActionError('');
    try {
      const payload = await autoTradeApi.syncBrokerOrders();
      publishAccount(payload.account);
      setNotice(payload.sync?.updated?.length
        ? `Broker sync updated ${payload.sync.updated.length} order(s).`
        : 'Broker order book checked; no AI order changed.');
    } catch (error) {
      setActionError(error.message);
    } finally {
      setSyncBusy('');
    }
  };

  const testEmail = async () => {
    setBusy('email');
    setActionError('');
    try {
      const payload = await autoTradeApi.testEmail();
      setNotice(`Test email sent to ${payload.to}.`);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const scanNow = async () => {
    setBusy('scan');
    setActionError('');
    try {
      const payload = await autoTradeApi.scan();
      publishAccount(payload.account);
      setNotice(payload.account.positions.length
        ? `Scan complete: ${payload.account.positions.length} open position(s), ${payload.account.scan.quoteCount} verified quote(s).`
        : 'Scan complete. No new entry qualified under the current risk settings.');
      refreshSignals();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const exitPosition = async (id, symbol) => {
    setBusy(`exit:${id}`);
    setActionError('');
    try {
      const payload = await autoTradeApi.exitPosition(id);
      publishAccount(payload.account);
      setNotice(account.mode === 'live'
        ? `Sent a ${symbol} sell order to ${account.execution?.broker || 'the broker'}; the position updates only after a verified fill.`
        : `Closed the ${symbol} paper position at the latest verified quote.`);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const explainSignal = async (symbol) => {
    setExplain({ symbol, loading: true, text: '', provider: '' });
    try {
      const payload = await autoTradeApi.explain(symbol);
      setExplain({
        symbol,
        loading: false,
        text: payload.explanation,
        provider: payload.provider,
        llmConfigured: payload.llmConfigured,
        signal: payload.signal,
      });
    } catch (error) {
      setExplain({ symbol, loading: false, text: error.message, provider: 'Error' });
    }
  };

  const runBacktest = async () => {
    if (!account?.watchlist?.includes(backtestSymbol)) {
      setBacktestError('Choose a symbol from your configured AI watchlist.');
      setBacktest(null);
      return;
    }
    setBacktestLoading(true);
    setBacktestError('');
    try {
      const payload = await coreApi.walkForward({
        symbols: [backtestSymbol],
        days: Number(backtestDays),
      });
      setBacktest(payload);
    } catch (error) {
      setBacktestError(error.message);
      setBacktest(null);
    } finally {
      setBacktestLoading(false);
    }
  };

  const runRuleBacktest = async () => {
    if (!account?.watchlist?.includes(ruleSymbol)) {
      setRuleError('Choose a symbol from your configured AI watchlist.');
      setRuleResult(null);
      return;
    }
    if (!ruleRules.length) {
      setRuleError('Enable at least one entry rule.');
      setRuleResult(null);
      return;
    }
    setRuleLoading(true);
    setRuleError('');
    try {
      const payload = await autoTradeApi.runBacktest({
        symbol: ruleSymbol,
        days: Number(ruleDays),
        targetPercent: Number(ruleTarget),
        stopLossPercent: Number(ruleStop),
        rules: ruleRules,
        rsiMax: Number(ruleRsiMax),
        momentumMinPercent: Number(ruleMomentum),
      });
      setRuleResult(payload);
    } catch (error) {
      setRuleError(error.message);
      setRuleResult(null);
    } finally {
      setRuleLoading(false);
    }
  };

  const runForecast = async () => {
    const symbol = forecastSymbol.trim().toUpperCase();
    if (!symbol || !account?.watchlist?.includes(symbol)) {
      setForecastError('Choose a symbol from your configured AI watchlist first.');
      setForecast(null);
      return;
    }
    setForecastLoading(true);
    setForecastError('');
    setForecast(null);
    try {
      const to = Math.floor(Date.now() / 1000);
      const from = to - (3 * 366 * 24 * 60 * 60);
      const payload = await marketApi.getCandles(symbol, from, to, '1d');
      const timestamps = Array.isArray(payload?.t) ? payload.t : [];
      const fields = [payload?.o, payload?.h, payload?.l, payload?.c];
      if (payload?.s !== 'ok' || fields.some((values) => !Array.isArray(values) || values.length !== timestamps.length)) {
        throw new Error(payload?.error || `No verified daily OHLC history was returned for ${symbol}.`);
      }
      const candles = timestamps.map((time, index) => ({
        time: Number(time),
        open: Number(payload.o[index]),
        high: Number(payload.h[index]),
        low: Number(payload.l[index]),
        close: Number(payload.c[index]),
      }));
      const result = forecastFromDailyCandles(candles);
      setForecast({
        ...result,
        symbol,
        provider: payload.provider || 'Unreported provider',
        dataBasis: payload.isResearch === true
          ? 'Delayed / research daily history'
          : 'Provider daily history · historical data, not a live quote',
        latestBarAt: result.latestBarTime ? new Date(result.latestBarTime * 1000).toISOString() : null,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setForecastError(error.message || 'The forecast could not be computed from the available history.');
    } finally {
      setForecastLoading(false);
    }
  };

  const loadTrackRecord = useCallback(async () => {
    setTrackLoading(true);
    setTrackError('');
    try {
      const payload = await forecastsApi.list(50);
      setTrackRecord(payload.forecasts || []);
      setTrackStats(payload.stats || null);
    } catch (error) {
      if (error.status === 401) {
        setTrackRecord([]);
        setTrackStats(null);
      } else {
        setTrackError(error.message || 'The forecast track record could not be loaded.');
      }
    } finally {
      setTrackLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrackRecord();
  }, [loadTrackRecord]);

  const saveForecast = async () => {
    if (!forecast || forecast.status !== 'ok') return;
    setSavingForecast(true);
    setForecastSaveNote('');
    setTrackError('');
    try {
      const payload = await forecastsApi.save(forecast.symbol, 5);
      setTrackRecord(payload.forecasts || []);
      setTrackStats(payload.stats || null);
      setForecastSaveNote(payload.created
        ? 'Saved. The server will score this call once its target daily bar has closed.'
        : 'This call for the latest closed daily bar is already on your track record.');
    } catch (error) {
      if (error.code === 'insufficient_history') {
        setTrackError('The server could not train on enough daily bars to save this forecast.');
      } else {
        setTrackError(error.message || 'The forecast could not be saved.');
      }
    } finally {
      setSavingForecast(false);
    }
  };

  const requestBrowserPermission = async () => {
    if (!('Notification' in window)) {
      setActionError('This browser does not support desktop notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setNotification('browser', true);
      setNotice('Browser notifications allowed. Save settings to keep them enabled.');
    } else {
      setActionError('Browser notifications were not allowed.');
    }
  };

  const testTelegram = async () => {
    setBusy('telegram');
    setActionError('');
    try {
      await autoTradeApi.testNotifications();
      setNotice('Test notification sent through Telegram.');
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy('');
    }
  };

  const watchlistSymbols = useMemo(() => account?.watchlist || [], [account?.watchlist]);
  const symbolCatalog = useMemo(
    () => [...new Set([...watchlistSymbols, ...stockSeed.map((stock) => stock.symbol)])],
    [watchlistSymbols],
  );
  const chartSymbol = account?.watchlist?.includes(selectedChartSymbol)
    ? selectedChartSymbol
    : account?.watchlist?.[0] || 'RELIANCE';
  const backtestResult = backtest?.results?.find((result) => result.symbol === backtestSymbol) || null;
  const chartStock = useMemo(
    () => ({
      symbol: chartSymbol,
      name: stockSeed.find((stock) => stock.symbol === chartSymbol)?.name || chartSymbol,
      price: null,
      isLive: false,
      isResearch: false,
      isStale: false,
    }),
    [chartSymbol],
  );

  if (authRequired) {
    return (
      <div className="page ai-page ai-dark">
        <div className="ai-gate">
          <span className="ai-gate-icon"><Lock size={26} /></span>
          <span className="ai-kicker">AUTOMATION ACCESS</span>
          <h1>Sign in to run the AI auto-trader</h1>
          <p>The agent is tied to your trading account, audit trail and virtual balance. Sign in with the mobile number and PIN you registered.</p>
          <Link className="ai-button ai-button-gold" to="/login">Sign in</Link>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="page ai-page ai-dark">
        <div className="ai-gate">
          <span className="ai-gate-icon"><Bot size={26} /></span>
          <h1>Connecting to the auto-trader</h1>
          <p>{loadError || 'Loading the paper account, risk rules and latest verified quotes…'}</p>
        </div>
      </div>
    );
  }

  const marketLabel = account.market.isOpen ? `Market open · ${account.market.clock} IST` : `Market closed · ${account.market.clock} IST`;
  const basisLabel = BASIS_LABEL[account.scan.dataBasis] || '—';
  const telegram = account.channels.telegram;
  const isLive = account.mode === 'live';
  const execution = account.execution || {};
  const slotCount = isLive && Number.isFinite(Number(execution.brokerPositionCount))
    ? Number(execution.brokerPositionCount)
    : account.positions.length;
  const brokerLabel = execution.broker ? execution.broker.charAt(0).toUpperCase() + execution.broker.slice(1) : null;
  const workerHeartbeatAt = Date.parse(account.automationWorker?.heartbeatAt || '');
  const workerHeartbeatStale = !account.automationWorker?.running
    || !Number.isFinite(workerHeartbeatAt)
    || Date.now() - workerHeartbeatAt > 120_000;
  const usableSignals = signals.filter((signal) => (
    !signal.error
    && signal.score !== null
    && signal.score !== undefined
    && Number.isFinite(Number(signal.score))
  ));
  const qualifyingSignals = usableSignals.filter((signal) => (
    signal.action === 'Buy' && Number(signal.score) >= Number(account.risk.minSignalScore)
  ));

  let signalGateState = 'wait';
  let signalGateDetail = 'Waiting for the first watchlist signal check.';
  if (signalsError) {
    signalGateDetail = 'Signal preview unavailable; check the latest scan events for the agent result.';
  } else if (signalsLoading) {
    signalGateDetail = 'Refreshing scores; automatic entries keep checking every 20 s.';
  } else if (signalsGeneratedAt && !usableSignals.length) {
    signalGateState = 'blocked';
    signalGateDetail = 'No usable daily history for the watchlist, so entries are blocked.';
  } else if (qualifyingSignals.length) {
    signalGateState = 'pass';
    signalGateDetail = `${qualifyingSignals.length} qualifying Buy signal(s); quote and Risk Shield checks run again before entry.`;
  } else if (signalsGeneratedAt) {
    signalGateDetail = `No Buy score ≥ ${account.risk.minSignalScore} in the latest check${signalsGeneratedAt ? ` · ${istClock(signalsGeneratedAt)} IST` : ''}. The agent keeps scanning.`;
  }

  const entryGates = [
    {
      label: 'Agent',
      state: account.status === 'running' ? 'pass' : account.status === 'paused' ? 'wait' : 'blocked',
      detail: account.status === 'running'
        ? 'Running · scans every 20 s'
        : account.status === 'paused'
          ? 'Entries paused · exits only'
          : 'Start the agent to allow entries',
    },
    {
      label: 'NSE session',
      state: account.market.isOpen ? 'pass' : 'wait',
      detail: account.market.isOpen
        ? `Open · ${account.market.clock} IST`
        : `Closed · ${account.market.clock} IST · opens 09:15`,
    },
    {
      label: 'Auto square-off',
      state: account.tradeStyle === 'intraday' ? 'pass' : 'wait',
      detail: account.tradeStyle === 'intraday'
        ? `${account.positions.length} open · every intraday position closes at ${account.market.squareOffAt}, and one carried from an earlier session squares off at the next open${account.market.squareOffActive ? ' · squaring off now' : ''}`
        : 'Swing style · positions are deliberately held past the close',
    },
    {
      label: 'Verified quotes',
      state: account.scan.quoteCount > 0 ? 'pass' : 'wait',
      detail: account.scan.quoteCount > 0
        ? `${account.scan.quoteCount} quotes · ${basisLabel}`
        : account.scan.lastRunAt
          ? 'No usable quotes in the last scan'
          : 'Awaiting the first scan',
    },
    {
      label: 'Daily risk budget',
      state: account.daily.halted ? 'blocked' : account.daily.tradesCount >= account.risk.maxDailyTrades ? 'wait' : 'pass',
      detail: account.daily.halted
        ? account.daily.haltReason
        : `${account.daily.tradesCount}/${account.risk.maxDailyTrades} trades · loss cap ${money(account.risk.maxDailyLoss)}`,
    },
    {
      label: 'Position slots',
      state: slotCount < account.risk.maxOpenPositions ? 'pass' : 'wait',
      detail: `${slotCount}/${account.risk.maxOpenPositions} used · ${execution.slotSource || 'account positions'}`,
    },
    {
      label: 'Risk Shield',
      state: killSwitch === null ? 'wait' : killSwitch.active ? 'blocked' : 'pass',
      detail: killSwitch === null
        ? 'Checking kill-switch status'
        : killSwitch.active
          ? `Kill switch active${killSwitch.reason ? ` · ${killSwitch.reason}` : ''}; exits only`
          : 'Kill switch released · final risk checks still apply',
    },
    {
      label: `Signal ≥ ${account.risk.minSignalScore}/100`,
      state: signalGateState,
      detail: signalGateDetail,
    },
  ];

  const emptyReason = (() => {
    if (account.status === 'stopped') {
      return account.emergencyStopped
        ? 'Emergency stop is active. Review your risk settings, then start the agent again.'
        : 'The agent is stopped, so no automated entries are being opened. Start it to scan your watchlist.';
    }
    if (account.status === 'paused') return 'Entries are paused. Existing positions would still be managed.';
    if (killSwitch?.active) return `Risk Shield kill switch is active${killSwitch.reason ? `: ${killSwitch.reason}` : ''}. Open positions remain managed; new entries resume after release.`;
    if (account.daily.halted) return `${account.daily.haltReason} Entries stay blocked until you authorize a resume.`;
    if (!account.market.isOpen) {
      return `The NSE session is closed (${account.market.clock} IST). Entry checks resume from 09:15 IST on the next trading day.`;
    }
    if (account.daily.tradesCount >= account.risk.maxDailyTrades) {
      return `The daily trade limit of ${account.risk.maxDailyTrades} is used up. Entries resume in the next session.`;
    }
    if (slotCount >= account.risk.maxOpenPositions) {
      return `All ${account.risk.maxOpenPositions} position slots are in use${isLive ? ' according to verified broker net positions' : ''}.`;
    }
    if (!account.scan.quoteCount) return 'The last scan returned no usable verified quotes, so no entry could be sized.';
    if (signalsError) return `The signal preview could not refresh: ${signalsError}. The agent still runs its server-side checks; review recent events for scan errors.`;
    if (signalsGeneratedAt && !usableSignals.length) return 'No usable daily history is available for the watchlist, so the AI cannot qualify an entry yet.';
    if (signalsGeneratedAt && !qualifyingSignals.length) return `No Buy signal has reached ${account.risk.minSignalScore}/100. The AI will open a paper trade automatically when a signal and all risk checks qualify.`;
    if (qualifyingSignals.length) return 'A qualifying Buy signal is available. The agent rechecks the quote and Risk Shield on its next scan before opening a paper trade.';
    if (!account.scan.lastRunAt) return 'The agent has not completed its first scan yet.';
    return 'No watchlist symbol passed every entry check in the latest scan. The agent retries every 20 seconds.';
  })();

  return (
    <div className="page ai-page ai-dark">
      <header className="ai-hero">
        <div className="ai-hero-copy">
          <div className="ai-hero-kickers">
            <span className="ai-kicker"><Sparkles size={13} /> SHAREMARKET PRO · AUTOMATION</span>
            <span className={`ai-status ${statusMeta.className}`}><StatusIcon size={13} /> {statusMeta.label}</span>
            <span className={`ai-pill ${isLive ? 'ai-pill-live' : 'ai-pill-gold'}`}>{isLive ? `LIVE · ${brokerLabel?.toUpperCase() || 'BROKER'}` : 'PAPER ACCOUNT'}</span>
          </div>
          <h1>AI Auto Trading Desk</h1>
          <p>
            {isLive
              ? `A rules-based agent scans live ${brokerLabel} NSE quotes and routes orders only after every gate passes. Verified fills get a broker-side DAY stop-loss; trailing stops and targets still need the backend worker.`
              : 'A rules-based agent scans verified NSE quotes, opens sized paper trades, and manages stop-loss, trailing stop and profit targets every 20 seconds. No broker order is sent in paper mode.'}
          </p>
          <div className="ai-hero-meta">
            <span><span className={`ai-dot ${account.market.isOpen ? 'is-on' : ''}`} />{marketLabel}</span>
            <span><ScanLine size={13} /> {account.scan.lastRunAt ? `Last scan ${istClock(account.scan.lastRunAt)} IST` : 'Awaiting first scan'}</span>
            <span><Gauge size={13} /> {account.scan.quoteCount} quotes · {basisLabel}</span>
            <span><Cpu size={13} /> {account.ai.llmConfigured ? 'LLM connected' : 'Rules-based engine'}</span>
          </div>
        </div>
        <div className="ai-hero-actions">
          {account.status === 'stopped' || account.emergencyStopped ? (
            <button type="button" className="ai-button ai-button-gold" onClick={() => setStartModal(true)} disabled={Boolean(busy)}>
              <Play size={16} /> Start agent
            </button>
          ) : null}
          {account.status === 'running' ? (
            <button type="button" className="ai-button ai-button-ghost" onClick={pauseAgent} disabled={Boolean(busy)}>
              <Pause size={16} /> {busy === 'pause' ? 'Pausing…' : 'Pause entries'}
            </button>
          ) : null}
          {account.status === 'paused' && !account.emergencyStopped ? (
            <button type="button" className="ai-button ai-button-gold" onClick={resumeAgent} disabled={Boolean(busy)}>
              <Play size={16} /> {busy === 'resume' ? 'Resuming…' : 'Resume entries'}
            </button>
          ) : null}
          <button type="button" className="ai-button ai-button-ghost" onClick={scanNow} disabled={account.status === 'stopped' || Boolean(busy)}>
            <RefreshCw size={15} className={busy === 'scan' ? 'ai-spin' : ''} /> {busy === 'scan' ? 'Scanning…' : 'Scan now'}
          </button>
          <button type="button" className="ai-button ai-button-danger" onClick={() => setStopModal(true)} disabled={account.status === 'stopped' || account.emergencyStopped}>
            <Square size={15} /> Emergency stop
          </button>
        </div>
      </header>

      {notice ? <div className="ai-toast is-success" role="status"><CheckCircle2 size={15} /> {notice}</div> : null}
      {actionError ? <div className="ai-toast is-error" role="alert"><AlertTriangle size={15} /> {actionError}<button type="button" onClick={() => setActionError('')} aria-label="Dismiss"><X size={14} /></button></div> : null}
      {account.daily.halted ? (
        <div className="ai-toast is-warning">
          <ShieldCheck size={15} /> {account.daily.haltReason} New entries are blocked.
          <button type="button" className="ai-link-button" onClick={() => setResumeModal(true)}>Authorize resume</button>
        </div>
      ) : null}
      {isLive && workerHeartbeatStale ? (
        <div className="ai-toast is-error" role="alert">
          <AlertTriangle size={15} /> Live worker heartbeat is unavailable or stale. New live entries are blocked; verify open positions and broker stop orders directly.
          {account.automationWorker?.lastError ? ` ${account.automationWorker.lastError}` : ''}
        </div>
      ) : null}
      {account.emergencyStopped ? <div className="ai-toast is-warning"><AlertTriangle size={15} /> Emergency stop is in effect. {account.positions.length ? `New entries are blocked while ${isLive ? 'open live' : 'open paper'} positions remain monitored for exits.` : 'The agent is stopped.'} Review risk settings, then start the agent again to authorize entries.</div> : null}

      <section className="ai-kpis" aria-label="Auto-trading account summary">
        <div className="ai-kpi">
          <span className="ai-kpi-label">Portfolio value</span>
          <strong>{money(account.equity)}</strong>
          <small>Cash + open positions</small>
        </div>
        <div className="ai-kpi">
          <span className="ai-kpi-label">Today's P&L</span>
          <strong className={pnlClass(account.dayPnl)}>{Number(account.dayPnl) !== 0 ? <TickArrow direction={account.dayPnl > 0 ? 'up' : 'down'} /> : null}{signedMoney(account.dayPnl)}</strong>
          <small className={pnlClass(account.dayPnl)}>{signedPercent(account.dayPnlPercent)} vs session open</small>
          <small>Booked {signedMoney(account.daily.realizedPnl)} · open positions {signedMoney(account.unrealizedPnl)}</small>
        </div>
        <div className="ai-kpi">
          <span className="ai-kpi-label">Total P&L</span>
          <strong className={pnlClass(account.totalPnl)}>{Number(account.totalPnl) !== 0 ? <TickArrow direction={account.totalPnl > 0 ? 'up' : 'down'} /> : null}{signedMoney(account.totalPnl)}</strong>
          <small className={pnlClass(account.totalPnl)}>{signedPercent(account.totalPnlPercent)} vs {money(account.startingCapital)}</small>
        </div>
        <div className="ai-kpi">
          <span className="ai-kpi-label">Available cash</span>
          <strong>{money(account.cash)}</strong>
          <small>{isLive ? 'Mirror ledger of verified fills' : 'Virtual funds'}</small>
        </div>
        <div className="ai-kpi">
          <span className="ai-kpi-label">Invested</span>
          <strong>{money(account.investedValue)}</strong>
          <small>{slotCount}/{account.risk.maxOpenPositions} slots · unrealised {signedMoney(account.unrealizedPnl)}</small>
        </div>
        <div className="ai-kpi">
          <span className="ai-kpi-label">Trades today</span>
          <strong>{account.daily.tradesCount}<span className="ai-kpi-sub">/{account.risk.maxDailyTrades}</span></strong>
          <small>Realised {signedMoney(account.daily.realizedPnl)}</small>
        </div>
      </section>

      <section className="ai-chart-section" aria-label={`Verified market chart for ${chartStock.name}`}>
        <div className="ai-chart-toolbar">
          <label className="ai-field">
            <span>Watchlist chart</span>
            <select
              value={chartSymbol}
              onChange={(event) => setSelectedChartSymbol(event.target.value)}
              aria-label="Choose a chart from your AI watchlist"
            >
              {watchlistSymbols.map((symbol) => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
          </label>
          <span className="ai-panel-note">{watchlistSymbols.length} configured symbol{watchlistSymbols.length === 1 ? '' : 's'} · one chart loaded at a time</span>
        </div>
        <LiveChart key={chartSymbol} symbol={chartSymbol} stock={chartStock} />
      </section>

      <div className={`ai-lock-banner ${isLive ? 'is-live-execution' : ''}`}>
        {isLive ? <Activity size={16} /> : <Lock size={16} />}
        <div>
          <strong>{isLive ? `Live execution is ON via ${brokerLabel}` : 'Paper execution · no broker order is sent'}</strong>
          <span>{account.liveTrading.reason}</span>
          {!isLive ? <small className="ai-paper-autostart-note">
            {account.autoStartPaper
              ? account.automationSchedulerAvailable
                ? 'Paper auto-start ON · the local backend worker resumes it after restart.'
                : 'Auto-start preference ON · this serverless deployment needs a persistent trading worker.'
              : 'Paper auto-start OFF · starting the agent enables restart auto-start.'}
          </small> : null}
          <div className="ai-lock-actions">
            <button type="button" className="ai-link-button" onClick={() => openExecutionModal(isLive ? 'paper' : 'live')} disabled={Boolean(busy) || account.status === 'running'}>
              {isLive ? 'Switch to paper mode' : 'Enable live execution'}
            </button>
            {isLive ? (
              <button type="button" className="ai-link-button" onClick={syncBrokerOrders} disabled={Boolean(syncBusy)}>
                {syncBusy ? 'Syncing…' : 'Sync broker orders'}
              </button>
            ) : null}
            <Link className="ai-lock-link" to="/broker-connections">Open Broker Connections</Link>
          </div>
          {isLive ? (
            <small className="ai-exec-meta">
              {execution.lastSyncAt ? `Broker sync ${istClock(execution.lastSyncAt)} IST` : 'No broker sync yet'}
              {execution.syncError ? ` · ${execution.syncError}` : ''}
              {execution.lastEntryError ? ` · last entry: ${execution.lastEntryError}` : ''}
            </small>
          ) : null}
        </div>
        <div className="ai-broker-chips">
          {Object.entries(account.broker?.quoteProviders || {}).map(([key, configured]) => (
            <span key={key} className={`ai-chip ${configured ? 'is-configured' : ''}`} title={configured ? 'Credentials detected; quote health is verified separately' : 'No credentials configured'}>{key} {configured ? 'configured' : 'not set'}</span>
          ))}
        </div>
      </div>

      {killSwitch?.active ? (
        <div className="ai-lock-banner ai-kill-banner" role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>Risk Shield is blocking every automated entry</strong>
            <span>
              Kill switch active{killSwitch.reason ? `: ${killSwitch.reason}` : ''}. The agent can run and manage open positions,
              but no new trade is opened until the switch is released.
            </span>
            <Link className="ai-lock-link" to="/ai-core">Release it in AI Core</Link>
          </div>
        </div>
      ) : null}

      <div className="ai-lock-banner">
        <Activity size={16} />
        <div>
          <strong>{`Agent ${account.status} · scans every 20 s${account.scan.lastRunAt ? ` · last scan ${istClock(account.scan.lastRunAt)} IST` : ''}`}</strong>
          <span>
            {emptyReason} {account.tradeStyle === 'intraday'
              ? account.market.squareOffActive
                ? `Auto square-off is running now: all ${account.positions.length} intraday position(s) are being closed.`
                : `Auto square-off is armed for ${account.market.squareOffAt}${account.positions.length ? ` and will close the ${account.positions.length} open intraday position(s) before 15:30 IST. Anything carried from an earlier session is squared off at the next open, and a missed close is settled at the published day quote until 20:00 IST.` : ' and there is no open position to close.'}`
              : 'Swing style · positions are held past the close on purpose.'}
          </span>
        </div>
      </div>

      <div className="ai-grid">
        <section className="ai-panel ai-positions-panel">
          <div className="ai-panel-head">
            <div>
              <span className="ai-kicker">AUTOMATED TRADES</span>
              <h2><Briefcase size={17} /> Open positions</h2>
            </div>
            <span className="ai-panel-note">{account.positions.length} managed · {account.closedPositions.length} closed</span>
          </div>

          {account.positions.length ? (
            <div className="ai-table-wrap">
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Last</th>
                    <th>Stop / trailing</th>
                    <th>Target</th>
                    <th>Unrealised</th>
                    <th>Basis</th>
                    <th>Execution</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {account.positions.map((position) => {
                    return (
                      <tr key={position.id}>
                        <td>
                          <strong>{position.symbol}</strong>
                          <small className="ai-table-sub">score {position.signalScore ?? '—'}/100{position.recovered ? ' · recovered' : ''}</small>
                        </td>
                        <td>{position.qty}</td>
                        <td>{money(position.entryPrice, 2)}</td>
                        <td><TickPrice as="b" value={position.lastPrice} identity={position.id} format={(value) => money(value, 2)} /></td>
                        <td>
                          <span className="ai-stop">{money(position.stopLoss, 2)}</span>
                          <small className="ai-table-sub">{position.stopLossKind === 'trailing' ? 'trailing · high ' + money(position.highWater, 2) : 'initial'}</small>
                        </td>
                        <td>{money(position.target, 2)}</td>
                        <td className={pnlClass(position.unrealizedPnl)}>
                          <strong>{Number(position.unrealizedPnl) !== 0 ? <TickArrow direction={position.unrealizedPnl > 0 ? 'up' : 'down'} /> : null}{signedMoney(position.unrealizedPnl)}</strong>
                          <small className="ai-table-sub">{signedPercent(position.unrealizedPnlPercent)}</small>
                        </td>
                        <td><span className={`ai-basis is-${position.quoteBasis}`} title={position.quoteBasis === 'unknown' ? 'The provider did not label this quote as live or delayed, so the engine only trades it inside a tight freshness window.' : undefined}>{BASIS_CHIP_LABEL[position.quoteBasis] || position.quoteBasis}</span></td>
                        <td>
                          <span className={`ai-order-status is-${(position.orderStatus || 'executed').toLowerCase().replace(/\s+/g, '-')}`}>{position.orderStatus || 'Executed'}</span>
                          <small className="ai-table-sub">{position.execution === 'live'
                            ? `${position.broker || 'live'}${position.brokerOrderId ? ` · ${position.brokerOrderId}` : ''} · SL ${position.protectionStatus || 'not verified'}`
                            : 'paper'}</small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ai-link-button"
                            onClick={() => exitPosition(position.id, position.symbol)}
                            disabled={Boolean(busy)}
                          >
                            {busy === `exit:${position.id}` ? 'Exiting…' : 'Exit'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="ai-empty ai-empty-entry">
              <Bot size={28} />
              <strong>No open automated positions</strong>
              <span>{emptyReason}</span>
              <div className="ai-entry-gates" aria-label="Entry gate status">
                {entryGates.map((gate) => {
                  const GateIcon = gate.state === 'pass' ? CheckCircle2 : gate.state === 'blocked' ? XCircle : Clock;
                  return (
                    <div className={`ai-entry-gate is-${gate.state}`} key={gate.label}>
                      <GateIcon size={14} />
                      <div>
                        <strong>{gate.label}</strong>
                        <span>{gate.detail}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <small className="ai-entry-scan">
                {account.scan.lastRunAt
                  ? `Last scan ${istClock(account.scan.lastRunAt)} IST · ${account.scan.quoteCount} symbols quoted`
                  : 'No scan has run yet.'}
              </small>
            </div>
          )}

          <div className="ai-panel-head is-compact">
            <div>
              <span className="ai-kicker">EXECUTED ORDERS</span>
              <h2><History size={16} /> Recent orders</h2>
            </div>
          </div>
          {account.orders.length ? (
            <div className="ai-table-wrap ai-table-scroll">
              <table className="ai-table">
                <thead>
                  <tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Status</th><th>Broker order</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {account.orders.slice(0, 8).map((order) => (
                    <tr key={order.id}>
                      <td>{istClock(order.at)}</td>
                      <td><strong>{order.symbol}</strong></td>
                      <td className={order.side === 'Buy' ? 'ai-gain' : 'ai-loss'}>{order.side}</td>
                      <td>{order.qty}</td>
                      <td>{order.price === null ? '—' : money(order.price, 2)}</td>
                      <td>
                        <span className={`ai-order-status is-${(order.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{order.status}</span>
                      </td>
                      <td className="ai-reason">{order.brokerOrderId || '—'}</td>
                      <td className="ai-reason">{order.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="ai-muted-line">No auto orders yet.</p>}
        </section>

        <aside className="ai-panel ai-risk-panel">
          <div className="ai-panel-head">
            <div>
              <span className="ai-kicker">RISK & STRATEGY</span>
              <h2><ShieldCheck size={17} /> Agent controls</h2>
            </div>
          </div>

          <div className="ai-style-toggle" role="group" aria-label="Trading style">
            {['intraday', 'swing'].map((style) => (
              <button
                key={style}
                type="button"
                className={config?.tradeStyle === style ? 'is-active' : ''}
                onClick={() => setTradeStyle(style)}
              >
                {style === 'intraday' ? 'Intraday · square off 15:15' : 'Swing · holds overnight'}
              </button>
            ))}
          </div>

          <div className="ai-risk-grid">
            <RiskField label="Stop-loss" suffix="%" value={config?.risk.stopLossPercent ?? ''} min="0.2" max="20" step="0.1" onChange={(value) => updateRisk('stopLossPercent', value)} hint="Initial exit below entry" />
            <RiskField label="Profit target" suffix="%" value={config?.risk.targetPercent ?? ''} min="0.2" max="40" step="0.1" onChange={(value) => updateRisk('targetPercent', value)} hint="Automatic profit booking" />
            <RiskField label="Trailing stop" suffix="%" value={config?.risk.trailingStopPercent ?? ''} min="0.2" max="15" step="0.1" onChange={(value) => updateRisk('trailingStopPercent', value)} hint="Locks in gains as price rises" />
            <RiskField label="Max loss / day" suffix="₹" value={config?.risk.maxDailyLoss ?? ''} min="1000" max="10000000" step="500" onChange={(value) => updateRisk('maxDailyLoss', value)} hint="Halts new entries" />
            <RiskField label="Max per trade" suffix="₹" value={config?.risk.maxInvestmentPerTrade ?? ''} min="1000" max="50000000" step="1000" onChange={(value) => updateRisk('maxInvestmentPerTrade', value)} hint="Order value cap" />
            <RiskField label="Max trades / day" value={config?.risk.maxDailyTrades ?? ''} min="1" max="50" onChange={(value) => updateRisk('maxDailyTrades', value)} />
            <RiskField label="Max open positions" value={config?.risk.maxOpenPositions ?? ''} min="1" max="20" onChange={(value) => updateRisk('maxOpenPositions', value)} />
            <RiskField label="Portfolio exposure" suffix="%" value={config?.risk.maxPortfolioExposurePercent ?? ''} min="5" max="100" onChange={(value) => updateRisk('maxPortfolioExposurePercent', value)} hint="Cap on invested capital" />
            <RiskField label="Min signal score" value={config?.risk.minSignalScore ?? ''} min="30" max="90" onChange={(value) => updateRisk('minSignalScore', value)} hint="0–100 rules-based score" />
            <RiskField label="Duplicate cooldown" suffix="min" value={config?.risk.duplicateWindowMinutes ?? ''} min="1" max="240" onChange={(value) => updateRisk('duplicateWindowMinutes', value)} hint="Blocks immediate re-entry" />
          </div>

          <div className="ai-watchlist">
            <div className="ai-watchlist-head">
              <span><Zap size={14} /> AI watchlist</span>
              <small>{config?.watchlist.length ?? 0}/20</small>
            </div>
            <div className="ai-chips">
              {(config?.watchlist || []).map((symbol) => (
                <span className="ai-symbol-chip" key={symbol}>
                  {symbol}
                  <button type="button" onClick={() => removeWatchlistSymbol(symbol)} aria-label={`Remove ${symbol}`}><X size={11} /></button>
                </span>
              ))}
            </div>
            <div className="ai-add-symbol">
              <input
                list="ai-symbol-options"
                value={symbolInput}
                onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addWatchlistSymbol(); } }}
                placeholder="Add NSE symbol"
                aria-label="Add symbol to AI watchlist"
              />
              <datalist id="ai-symbol-options">
                {symbolCatalog.map((symbol) => <option key={symbol} value={symbol} />)}
              </datalist>
              <button type="button" onClick={addWatchlistSymbol}>Add</button>
            </div>
          </div>

          <div className="ai-notify-settings">
            <span className="ai-watchlist-head"><Bell size={14} /> Notifications</span>
            <label className="ai-toggle-row">
              <span>Browser alerts<small>BUY/SELL fills, stops, targets and risk limits</small></span>
              <input
                type="checkbox"
                checked={config?.notifications.browser === true}
                onChange={(event) => {
                  setNotification('browser', event.target.checked);
                  if (event.target.checked) requestBrowserPermission();
                }}
              />
            </label>
            <label className={`ai-toggle-row ${telegram.configured ? '' : 'is-disabled'}`}>
              <span>Telegram<small>{telegram.configured ? 'Sends critical events through your bot' : `Not configured · set ${telegram.missing.join(' + ')}`}</small></span>
              <input
                type="checkbox"
                disabled={!telegram.configured}
                checked={config?.notifications.telegram === true}
                onChange={(event) => setNotification('telegram', event.target.checked)}
              />
            </label>
            <div className="ai-channel-status">
              <span className={account.channels.inApp ? 'is-ready' : ''}>In-app · ready</span>
              <span className={account.channels.email.enabled ? 'is-ready' : ''} title={account.channels.email.reason}>
                Email · {account.channels.email.enabled ? 'enabled' : account.channels.email.configured ? 'not enabled' : 'not configured'}
              </span>
              <span className={account.channels.push.enabled ? 'is-ready' : ''} title={account.channels.push.reason}>
                Push · {account.channels.push.enabled ? 'enabled' : account.channels.push.configured ? 'device not linked' : 'not configured'}
              </span>
            </div>
            {account.channels.email.configured ? (
              <button type="button" className="ai-link-button" onClick={testEmail} disabled={Boolean(busy)}>
                {busy === 'email' ? 'Sending…' : 'Send email test'}
              </button>
            ) : null}
            {telegram.configured ? (
              <button type="button" className="ai-link-button" onClick={testTelegram} disabled={Boolean(busy)}>
                {busy === 'telegram' ? 'Sending…' : 'Send Telegram test'}
              </button>
            ) : null}
          </div>

          <button type="button" className="ai-button ai-button-gold ai-save-button" onClick={saveConfig} disabled={Boolean(busy)}>
            {busy === 'save' ? 'Saving…' : 'Save settings'}
          </button>
          <p className="ai-risk-note">
            <Info size={13} /> Every order is validated against cash, per-trade size, exposure, daily trade count,
            duplicate cooldown and the daily loss limit before it is placed.
          </p>
        </aside>
      </div>

      <section className="ai-panel ai-forecast-panel">
        <div className="ai-panel-head">
          <div>
            <span className="ai-kicker">RESEARCH MODEL · DAILY BARS</span>
            <h2><LineChart size={17} /> ML price forecast</h2>
          </div>
          <span className="ai-panel-note">Next 5 daily bars · independent of order signals</span>
        </div>
        <div className="ai-forecast-controls">
          <label className="ai-field">
            <span>Symbol</span>
            <select value={forecastSymbol} onChange={(event) => setForecastSymbol(event.target.value)}>
              {watchlistSymbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </label>
          <button type="button" className="ai-button ai-button-gold" onClick={runForecast} disabled={forecastLoading}>
            <Sparkles size={15} /> {forecastLoading ? 'Training…' : 'Run research forecast'}
          </button>
        </div>
        {forecastError ? <p className="ai-error-line"><AlertTriangle size={14} /> {forecastError}</p> : null}
        {forecast ? (
          <>
            {forecast.status === 'ok' ? (
              <>
                <div className="ai-forecast-summary">
                  <div>
                    <span className="ai-forecast-label">{forecast.symbol} · {forecast.target}</span>
                    <strong>{forecast.probabilityPercent}%</strong>
                  </div>
                  <span className={`ai-trend ${forecast.direction === 'bullish' ? 'is-up' : forecast.direction === 'bearish' ? 'is-down' : 'is-sideways'}`}>
                    {forecast.direction === 'bullish' ? <ArrowUpRight size={15} /> : forecast.direction === 'bearish' ? <ArrowDownRight size={15} /> : <Activity size={15} />}
                    {forecast.direction}
                  </span>
                </div>
                <div className="ai-backtest-metrics ai-forecast-metrics">
                  <div><span>Model sensitivity range</span><strong>{forecast.modelSensitivityRangePercent[0]}–{forecast.modelSensitivityRangePercent[1]}%</strong></div>
                  <div><span>Holdout accuracy</span><strong>{forecast.performance.accuracyPercent}%</strong></div>
                  <div><span>Holdout Brier score</span><strong>{forecast.performance.brierScore}</strong></div>
                  <div><span>Training samples</span><strong>{forecast.trainSamples.toLocaleString('en-IN')}</strong></div>
                  <div><span>Out-of-sample samples</span><strong>{forecast.performance.sampleCount.toLocaleString('en-IN')}</strong></div>
                  <div><span>Holdout up-rate</span><strong>{forecast.performance.testUpRatePercent}%</strong></div>
                </div>
                <div className="ai-forecast-sensitivities">
                  <span className="ai-forecast-label">Largest single-feature neutralization effects</span>
                  <small>Each row resets one input to its training average while holding other inputs fixed; effects are not causal or additive.</small>
                  {forecast.featureSensitivities.slice(0, 4).map((item) => (
                    <div key={item.feature}>
                      <span>{item.feature}</span>
                      <strong className={pnlClass(item.probabilityChangePoints)}>{item.probabilityChangePoints > 0 ? '+' : ''}{item.probabilityChangePoints.toFixed(2)} pp</strong>
                    </div>
                  ))}
                </div>
                <div className="ai-forecast-save">
                  <button type="button" className="ai-button ai-button-gold" onClick={saveForecast} disabled={savingForecast}>
                    <Target size={15} /> {savingForecast ? 'Saving…' : 'Save & track this forecast'}
                  </button>
                  <span>The server retrains on its own daily history before storing the call, so saved numbers can differ slightly from this browser run.</span>
                </div>
              </>
            ) : (
              <div className="ai-forecast-withheld">
                <strong>Forecast withheld · history is too short</strong>
                <span>{forecast.candleCount} daily bars returned · {forecast.trainSamples} training samples · {forecast.testSamples} out-of-sample samples; minimums are {forecast.minimumTrainSamples} and {forecast.minimumTestSamples}.</span>
              </div>
            )}
            <p className="ai-forecast-provenance">
              {forecast.provider} · {forecast.dataBasis} · latest bar {forecast.latestBarAt ? istTime(forecast.latestBarAt) : 'date unavailable'} IST · {forecast.model || 'Model not trained'}
            </p>
            <p className="ai-disclaimer-line">
              <Info size={13} /> {forecast.disclaimer || 'No probability was produced.'} Holdout accuracy and Brier score describe this one chronological evaluation window; they are not a guarantee of future performance. This research forecast never places or changes orders.
            </p>
          </>
        ) : (!forecastLoading && !forecastError ? (
          <p className="ai-muted-line">Run the model on available daily OHLC history. Forecasts are withheld when the training or holdout sample is too small.</p>
        ) : null)}

        <div className="ai-forecast-track">
          <div className="ai-forecast-track-head">
            <span className="ai-forecast-label">Your saved forecast track record</span>
            <button type="button" className="ai-button ai-button-ghost ai-button-small" onClick={loadTrackRecord} disabled={trackLoading}>
              <RefreshCw size={13} /> {trackLoading ? 'Checking…' : 'Refresh'}
            </button>
          </div>
          {forecastSaveNote ? <p className="ai-forecast-save-note"><CheckCircle2 size={13} /> {forecastSaveNote}</p> : null}
          {trackError ? <p className="ai-error-line"><AlertTriangle size={14} /> {trackError}</p> : null}
          {trackStats && trackStats.total > 0 ? (
            <>
              <div className="ai-backtest-metrics ai-forecast-metrics">
                <div><span>Scored calls</span><strong>{trackStats.scored}</strong></div>
                <div><span>Hit rate</span><strong>{trackStats.hitRatePercent == null ? '—' : `${trackStats.hitRatePercent}%`}</strong></div>
                <div><span>Brier score</span><strong>{trackStats.brierScore == null ? '—' : trackStats.brierScore}</strong></div>
                <div><span>Open calls</span><strong>{trackStats.pending}</strong></div>
                <div><span>Neutral (not scored)</span><strong>{trackStats.unscorable}</strong></div>
                <div><span>Saved calls</span><strong>{trackStats.total}</strong></div>
              </div>
              <div className="ai-forecast-track-table">
                {trackRecord.slice(0, 8).map((item) => (
                  <div key={item.id} className={`ai-forecast-track-row is-${item.status}`}>
                    <span className="ai-forecast-track-symbol">{item.symbol} · {item.direction} · {item.horizonBars}d</span>
                    <span>{item.probabilityPercent}% up · base ₹{item.baseClose.toLocaleString('en-IN')}</span>
                    <span>Bar {istDate(new Date(item.baseBarTime * 1000).toISOString())}</span>
                    <span>{forecastOutcomeLabel(item)}</span>
                  </div>
                ))}
              </div>
              <p className="ai-disclaimer-line"><Info size={13} /> {trackStats.note} Scored against the server's own daily history, not a simulated result.</p>
            </>
          ) : (!trackLoading ? (
            <p className="ai-muted-line">No saved forecasts yet. Save a call above to start a verifiable, server-scored record.</p>
          ) : null)}
        </div>
      </section>

      <section className="ai-panel">
        <div className="ai-panel-head">
          <div>
            <span className="ai-kicker">ML + RULES ENGINE</span>
            <h2><Sparkles size={17} /> AI market signals</h2>
          </div>
          <div className="ai-panel-actions">
            <span className="ai-panel-note">Daily bars · SMA, RSI, momentum, volatility, score</span>
            <button type="button" className="ai-button ai-button-ghost ai-button-small" onClick={refreshSignals} disabled={signalsLoading}>
              <RefreshCw size={14} className={signalsLoading ? 'ai-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
        {signalsError ? <p className="ai-error-line"><AlertTriangle size={14} /> {signalsError}</p> : null}
        {signalsLoading && !signals.length ? <p className="ai-muted-line">Computing signals from verified daily history…</p> : null}
        {signals.length ? (
          <div className="ai-table-wrap">
            <table className="ai-table ai-signals-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Price</th>
                  <th>Trend</th>
                  <th>RSI 14</th>
                  <th>Momentum 20d</th>
                  <th>Volatility 20d</th>
                  <th>Signal score</th>
                  <th>Read</th>
                  <th>Basis</th>
                  <th>Explain</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((signal) => (
                  <tr key={signal.symbol}>
                    <td><strong>{signal.symbol}</strong><small className="ai-table-sub">{signal.asOf ? istTime(signal.asOf) : ''}</small></td>
                    <td>{signal.price === null || signal.price === undefined ? '—' : money(signal.price, 2)}{signal.changePercent !== null && signal.changePercent !== undefined ? <small className={`ai-table-sub ${pnlClass(signal.changePercent)}`}>{signedPercent(signal.changePercent)}</small> : null}</td>
                    <td>
                      {signal.error ? '—' : (
                        <span className={`ai-trend is-${signal.trend}`}>
                          {signal.trend === 'up' ? <ArrowUpRight size={13} /> : signal.trend === 'down' ? <ArrowDownRight size={13} /> : <Activity size={13} />}
                          {signal.trend}
                        </span>
                      )}
                    </td>
                    <td>{signal.rsi14 ?? '—'}</td>
                    <td className={pnlClass(signal.momentum20Percent)}>{signal.momentum20Percent === null || signal.momentum20Percent === undefined ? '—' : signedPercent(signal.momentum20Percent)}</td>
                    <td>{signal.volatility20Percent === null || signal.volatility20Percent === undefined ? '—' : `${signal.volatility20Percent}%`}</td>
                    <td>
                      {signal.score === null || signal.score === undefined ? <span className="ai-muted-inline">No data</span> : (
                        <div className="ai-score">
                          <strong>{signal.score}</strong>
                          <span><span style={{ width: `${signal.score}%` }} /></span>
                        </div>
                      )}
                    </td>
                    <td><span className={`ai-action ${ACTION_CLASS[signal.action] || ''}`}>{signal.action}</span></td>
                    <td><span className={`ai-basis is-${signal.quoteBasis || 'unknown'}`}>{signal.quoteLabel || 'Research bars'}</span></td>
                    <td>
                      <button type="button" className="ai-link-button" onClick={() => explainSignal(signal.symbol)}>
                        Why?
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (!signalsLoading ? <p className="ai-muted-line">No signals available. Check that the research data provider is running.</p> : null)}
        <p className="ai-disclaimer-line">
          <Info size={13} /> Scores are computed from delayed daily OHLC data and the latest verified quote. They are
          rules-based technical reads, not predictions, price targets or investment advice.
        </p>
      </section>

      <div className="ai-grid ai-grid-bottom">
        <section className="ai-panel">
          <div className="ai-panel-head">
            <div>
              <span className="ai-kicker">STRATEGY LAB</span>
              <h2><LineChart size={17} /> Walk-forward backtest</h2>
            </div>
            <span className="ai-panel-note">70/30 holdout · 12 bps / side</span>
          </div>
          <div className="ai-backtest-controls">
            <label className="ai-field">
              <span>Symbol</span>
              <select value={backtestSymbol} onChange={(event) => setBacktestSymbol(event.target.value)}>
                {watchlistSymbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
              </select>
            </label>
            <label className="ai-field">
              <span>History</span>
              <select value={backtestDays} onChange={(event) => setBacktestDays(event.target.value)}>
                <option value="180">6 months</option>
                <option value="250">1 year</option>
                <option value="500">2 years</option>
                <option value="750">3 years</option>
              </select>
            </label>
            <button type="button" className="ai-button ai-button-gold" onClick={runBacktest} disabled={backtestLoading}>
              {backtestLoading ? 'Running…' : 'Run walk-forward'}
            </button>
          </div>
          {backtestError ? <p className="ai-error-line"><AlertTriangle size={14} /> {backtestError}</p> : null}
          {backtest && backtestResult ? (
            <>
              <div className="ai-walkforward-summary">
                <strong>{backtestResult.status.replace(/_/g, ' ')}</strong>
                <span>{backtestResult.split
                  ? `${backtestResult.split.trainBars} train bars · ${backtestResult.split.testBars} untouched test bars`
                  : backtestResult.reason || 'Not enough verified daily history to evaluate this rule.'}</span>
              </div>
              <div className="ai-backtest-metrics">
                <div><span>Out-of-sample return</span><strong className={pnlClass(backtestResult.outOfSample?.netReturnPercent)}>{backtestResult.outOfSample?.netReturnPercent == null ? '—' : signedPercent(backtestResult.outOfSample.netReturnPercent)}</strong></div>
                <div><span>Holdout buy &amp; hold</span><strong className={pnlClass(backtestResult.outOfSample?.buyHoldReturnPercent)}>{backtestResult.outOfSample?.buyHoldReturnPercent == null ? '—' : signedPercent(backtestResult.outOfSample.buyHoldReturnPercent)}</strong></div>
                <div><span>In-sample return</span><strong className={pnlClass(backtestResult.inSample?.netReturnPercent)}>{backtestResult.inSample?.netReturnPercent == null ? '—' : signedPercent(backtestResult.inSample.netReturnPercent)}</strong></div>
                <div><span>Holdout win rate</span><strong>{backtestResult.outOfSample?.winRatePercent == null ? '—' : `${backtestResult.outOfSample.winRatePercent}%`}</strong></div>
                <div><span>Holdout trades</span><strong>{backtestResult.outOfSample?.tradeCount ?? '—'}</strong></div>
                <div><span>Holdout max drawdown</span><strong className="ai-loss">{backtestResult.outOfSample?.maxDrawdownPercent == null ? '—' : `${backtestResult.outOfSample.maxDrawdownPercent}%`}</strong></div>
                <div><span>Holdout profit factor</span><strong>{backtestResult.outOfSample?.profitFactor ?? '—'}</strong></div>
              </div>
              <BacktestCurve curve={backtestResult.outOfSampleCurve} />
              {backtestResult.selectedParameters ? (
                <p className="ai-muted-line">Parameters selected on training data: target {backtestResult.selectedParameters.targetPercent}% · stop-loss {backtestResult.selectedParameters.stopLossPercent}%.</p>
              ) : null}
              <ul className="ai-assumptions">
                {backtest.assumptions.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </>
          ) : backtest ? (
            <p className="ai-muted-line">The walk-forward service returned no result for {backtestSymbol}.</p>
          ) : (
            <p className="ai-muted-line">Run a 70/30 walk-forward simulation on a configured watchlist symbol. At least 160 verified daily bars are required.</p>
          )}
        </section>

        <section className="ai-panel">
          <div className="ai-panel-head">
            <div>
              <span className="ai-kicker">STRATEGY LAB</span>
              <h2><LineChart size={17} /> Rule builder backtest</h2>
            </div>
            <span className="ai-panel-note">Next-bar fills · real charges</span>
          </div>
          <div className="ai-rule-controls">
            <label className="ai-field">
              <span>Symbol</span>
              <select value={ruleSymbol} onChange={(event) => setRuleSymbol(event.target.value)}>
                {watchlistSymbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
              </select>
            </label>
            <label className="ai-field">
              <span>History</span>
              <select value={ruleDays} onChange={(event) => setRuleDays(event.target.value)}>
                <option value="120">6 months</option>
                <option value="250">1 year</option>
                <option value="500">2 years</option>
                <option value="750">3 years</option>
              </select>
            </label>
          </div>
          <div className="ai-rule-grid">
            {[
              ['sma_cross', 'SMA20 above SMA50'],
              ['above_sma20', 'Price above SMA20'],
              ['momentum_positive', 'Momentum above minimum'],
              ['rsi_below', 'RSI14 below maximum'],
              ['breakout_20', 'Close above prior 20-bar high'],
              ['volume_surge', 'Volume above 1.5× 20-bar average'],
            ].map(([key, label]) => (
              <label key={key} className="ai-rule-check">
                <input
                  type="checkbox"
                  checked={ruleRules.includes(key)}
                  onChange={(event) => setRuleRules((current) => (event.target.checked
                    ? [...current, key]
                    : current.filter((rule) => rule !== key)))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="ai-rule-controls">
            <label className="ai-field">
              <span>RSI max</span>
              <input type="number" min="20" max="95" value={ruleRsiMax} onChange={(event) => setRuleRsiMax(event.target.value)} />
            </label>
            <label className="ai-field">
              <span>Momentum min %</span>
              <input type="number" step="0.1" min="-10" max="20" value={ruleMomentum} onChange={(event) => setRuleMomentum(event.target.value)} />
            </label>
            <label className="ai-field">
              <span>Target %</span>
              <input type="number" step="0.5" min="0.2" max="40" value={ruleTarget} onChange={(event) => setRuleTarget(event.target.value)} />
            </label>
            <label className="ai-field">
              <span>Stop %</span>
              <input type="number" step="0.5" min="0.2" max="20" value={ruleStop} onChange={(event) => setRuleStop(event.target.value)} />
            </label>
            <button type="button" className="ai-button" onClick={runRuleBacktest} disabled={ruleLoading}>
              {ruleLoading ? 'Running…' : 'Run rule backtest'}
            </button>
          </div>
          {ruleError ? <p className="ai-error-line"><AlertTriangle size={14} /> {ruleError}</p> : null}
          {ruleResult ? (
            <>
              <div className="ai-backtest-metrics">
                <div><span>Total return</span><strong className={pnlClass(ruleResult.metrics.totalReturnPercent)}>{signedPercent(ruleResult.metrics.totalReturnPercent)}</strong></div>
                <div><span>Buy &amp; hold</span><strong className={pnlClass(ruleResult.metrics.buyHoldReturnPercent)}>{ruleResult.metrics.buyHoldReturnPercent == null ? '—' : signedPercent(ruleResult.metrics.buyHoldReturnPercent)}</strong></div>
                <div><span>Trades</span><strong>{ruleResult.metrics.tradeCount}</strong></div>
                <div><span>Win rate</span><strong>{ruleResult.metrics.winRatePercent == null ? '—' : `${ruleResult.metrics.winRatePercent}%`}</strong></div>
                <div><span>Round-trip charges</span><strong>{ruleResult.metrics.costPercentRoundTrip}%</strong></div>
                <div><span>Max drawdown</span><strong className="ai-loss">{ruleResult.metrics.maxDrawdownPercent}%</strong></div>
                <div><span>Profit factor</span><strong>{ruleResult.metrics.profitFactor ?? '—'}</strong></div>
              </div>
              <ul className="ai-assumptions">
                {ruleResult.assumptions.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </>
          ) : (
            <p className="ai-muted-line">Combine up to six entry rules; every enabled rule must hold. Entries fill at the next session open and stop/target levels use each day's high and low.</p>
          )}
        </section>

        <section className="ai-panel">
          <div className="ai-panel-head">
            <div>
              <span className="ai-kicker">AUDIT TRAIL</span>
              <h2><History size={17} /> Activity log</h2>
            </div>
          </div>
          <div className="ai-tabs" role="tablist" aria-label="Activity views">
            {[
              ['orders', 'Orders'],
              ['trades', 'Trades'],
              ['events', 'Events'],
              ['audit', 'Audit'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activityTab === key}
                className={activityTab === key ? 'is-active' : ''}
                onClick={() => setActivityTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {activityTab === 'orders' ? (
            account.orders.length ? (
              <div className="ai-activity-list">
                {account.orders.slice(0, 12).map((order) => (
                  <div className="ai-activity-row" key={order.id}>
                    <span className={`ai-activity-dot ${order.side === 'Buy' ? 'is-buy' : 'is-sell'}`} />
                    <div>
                      <strong>{order.side} {order.symbol} · {order.qty} @ {order.price === null ? '—' : money(order.price, 2)}</strong>
                      <small>{istTime(order.at)} · {order.status} · {order.reason || 'engine'}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="ai-muted-line">No orders recorded yet.</p>
          ) : null}

          {activityTab === 'trades' ? (
            account.trades.length ? (
              <div className="ai-activity-list">
                {account.trades.slice(0, 12).map((trade) => (
                  <div className="ai-activity-row" key={trade.id}>
                    <span className={`ai-activity-dot ${trade.pnl >= 0 ? 'is-buy' : 'is-sell'}`} />
                    <div>
                      <strong>{trade.symbol} · {trade.qty} · {signedMoney(trade.pnl)} ({signedPercent(trade.pnlPercent)})</strong>
                      <small>{istTime(trade.entryAt)} → {istTime(trade.exitAt)} · {String(trade.exitReason).replace(/_/g, ' ')}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="ai-muted-line">No completed trades yet.</p>
          ) : null}

          {activityTab === 'events' ? (
            account.events.length ? (
              <div className="ai-activity-list">
                {account.events.slice(0, 20).map((event) => (
                  <div className={`ai-activity-row is-${event.severity}`} key={event.id}>
                    <span className={`ai-activity-dot is-${event.severity}`} />
                    <div>
                      <strong>{event.title}</strong>
                      <small>{istTime(event.at)} · {event.message}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="ai-muted-line">No events yet.</p>
          ) : null}

          {activityTab === 'audit' ? (
            account.audit.length ? (
              <div className="ai-activity-list">
                {account.audit.slice(0, 20).map((entry) => (
                  <div className="ai-activity-row" key={entry.id}>
                    <span className={`ai-activity-dot ${entry.actor === 'user' ? 'is-user' : 'is-ai'}`} />
                    <div>
                      <strong>{String(entry.action).replace(/_/g, ' ')}</strong>
                      <small>{istTime(entry.at)} · {entry.detail} · {entry.actor}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="ai-muted-line">No audit entries yet.</p>
          ) : null}
        </section>
      </div>

      <footer className="ai-final-notes">
        <div>
          <span className="ai-kicker">IMPORTANT</span>
          <h3><ShieldCheck size={16} /> Safety rails in force</h3>
          <ul>
            <li>{isLive
              ? `Live execution is ON through ${brokerLabel}. A broker order is sent only after the server flag, account consent, instrument mapping, fresh broker quote, verified funds and Risk Shield approval all pass.`
              : 'Live execution is OFF. Only virtual paper orders are created; no broker order API is called.'}</li>
            <li>Starting the agent requires an explicit risk acknowledgement and typed confirmation.</li>
            <li>Every order is validated against cash, per-trade cap, exposure, daily trade count and duplicate cooldown.</li>
            <li>Emergency stop blocks new entries immediately and cancels unfilled live entry orders. Open positions stay monitored for exits.</li>
            <li>Quotes are sampled every 20 seconds; stop-loss and target exits are market orders, so fills can differ from the trigger level.</li>
          </ul>
        </div>
        <div>
          <span className="ai-kicker">DATA BASIS</span>
          <h3><Info size={16} /> {basisLabel}</h3>
          <ul>
            {account.disclaimers.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </footer>

      {startModal ? (
        <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStartModal(false); }}>
          <div className="ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-start-title">
            <button type="button" className="ai-modal-close" onClick={() => setStartModal(false)} aria-label="Close"><X size={17} /></button>
            <span className="ai-modal-icon"><Play size={20} /></span>
            <h2 id="ai-start-title">Authorize AI automation</h2>
            <p>You are about to let the agent place {isLive
              ? <>real market orders through <strong>{brokerLabel}</strong> using the remote broker session.</>
              : <><strong>virtual paper orders</strong> on your AI account. No broker order is sent.</>}
            </p>
            <ul className="ai-modal-list">
              <li>Up to {account.risk.maxOpenPositions} open positions and {account.risk.maxDailyTrades} entries per day.</li>
              <li>Stop-loss {account.risk.stopLossPercent}%, target {account.risk.targetPercent}%, trailing stop {account.risk.trailingStopPercent}%.</li>
              <li>Daily loss cap {money(account.risk.maxDailyLoss)} automatically blocks new entries and cancels unfilled entries.</li>
              {isLive ? <li>Every entry needs a fresh broker quote, verified broker funds, instrument mapping and Risk Shield approval. Broker stop-loss orders are DAY-only and do not persist overnight.</li> : null}
              <li>Signals are rules-based on delayed data, not guarantees. You can stop the agent at any time.</li>
            </ul>
            <label className="ai-ack">
              <input type="checkbox" checked={startAck} onChange={(event) => setStartAck(event.target.checked)} />
              {isLive ? `I understand these are real ${brokerLabel} orders and accept the trading risk.` : 'I understand the risk and want to run paper automation.'}
            </label>
            <label className="ai-field">
              <span>Type <b>START AUTO TRADING</b> to confirm</span>
              <input value={startPhrase} onChange={(event) => setStartPhrase(event.target.value)} placeholder="START AUTO TRADING" autoComplete="off" />
            </label>
            <div className="ai-modal-actions">
              <button type="button" className="ai-button ai-button-ghost" onClick={() => setStartModal(false)}>Cancel</button>
              <button
                type="button"
                className="ai-button ai-button-gold"
                disabled={!startAck || startPhrase.trim().toUpperCase() !== 'START AUTO TRADING' || Boolean(busy)}
                onClick={startAgent}
              >
                {busy === 'start' ? 'Starting…' : 'Authorize and start'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stopModal ? (
        <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStopModal(false); }}>
          <div className="ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-stop-title">
            <button type="button" className="ai-modal-close" onClick={() => setStopModal(false)} aria-label="Close"><X size={17} /></button>
            <span className="ai-modal-icon is-danger"><AlertTriangle size={20} /></span>
            <h2 id="ai-stop-title">Emergency stop?</h2>
            <p>New {isLive ? 'live' : 'paper'} entries stop immediately{isLive ? ' and unfilled broker entry orders are cancelled' : ''}. {account.positions.length
              ? `${account.positions.length} open ${isLive ? 'live' : 'paper'} position(s) stay monitored for stop-loss, trailing stop, target and square-off. They will not be force-closed.`
              : 'There are no open positions, so the agent will stop completely.'}
            </p>
            <div className="ai-modal-actions">
              <button type="button" className="ai-button ai-button-ghost" onClick={() => setStopModal(false)}>Keep running</button>
              <button type="button" className="ai-button ai-button-danger" onClick={stopAgent} disabled={Boolean(busy)}>
                {busy === 'stop' ? 'Stopping…' : 'Confirm emergency stop'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {execModal ? (
        <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExecModal(null); }}>
          <div className="ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-exec-title">
            <button type="button" className="ai-modal-close" onClick={() => setExecModal(null)} aria-label="Close"><X size={17} /></button>
            <span className="ai-modal-icon"><Activity size={20} /></span>
            <h2 id="ai-exec-title">{execModal.mode === 'live' ? 'Enable live automated execution' : 'Switch to paper execution'}</h2>
            {execModal.mode === 'paper' ? (
              <>
                <p>The AI engine stops sending broker orders and returns to the virtual paper ledger. This is possible only with no open live positions and while the agent is not running.</p>
                <div className="ai-modal-actions">
                  <button type="button" className="ai-button ai-button-ghost" onClick={() => setExecModal(null)}>Cancel</button>
                  <button type="button" className="ai-button ai-button-gold" onClick={confirmExecutionMode} disabled={Boolean(busy)}>
                    {busy === 'execution' ? 'Switching…' : 'Switch to paper'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>Live execution needs every gate below. Readiness is checked against your broker session and the server live flag right now.</p>
                {brokerOptions.length > 1 ? (
                  <label className="ai-field">
                    <span>Broker account</span>
                    <select
                      value={readiness?.broker || ''}
                      disabled={Boolean(busy) || readiness?.loading}
                      onChange={(event) => checkLiveReadiness(event.target.value)}
                    >
                      {brokerOptions.map((broker) => (
                        <option key={broker.id} value={broker.id}>
                          {broker.name} · {broker.connection?.connected ? 'Connected' : 'Not connected'}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {readiness?.loading ? <p className="ai-muted-line">Checking {readiness.broker} session and instrument mapping…</p> : null}
                {readiness && !readiness.loading ? (
                  <ul className="ai-modal-list ai-readiness-list">
                    {(readiness.checks || []).map((check) => (
                      <li key={check.id} className={`is-${check.state}`}>
                        {check.state === 'pass' ? <CheckCircle2 size={14} /> : check.state === 'wait' ? <Clock size={14} /> : <XCircle size={14} />}
                        <span><strong>{check.label}</strong> · {check.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {readinessError ? <p className="ai-error-line"><AlertTriangle size={14} /> {readinessError}</p> : null}
                <p className="ai-disclaimer-line">
                  <Info size={13} /> A broker-side SL-M stop with DAY validity is submitted after each verified fill. It is not GTT and expires after the session; targets and trailing-stop updates depend on the backend worker.
                </p>
                <label className="ai-ack">
                  <input type="checkbox" checked={execAck} onChange={(event) => setExecAck(event.target.checked)} />
                  I understand the agent can place real broker orders and accept the trading risk.
                </label>
                <label className="ai-field">
                  <span>Type <b>ENABLE LIVE AUTO TRADING</b> to confirm</span>
                  <input value={execPhrase} onChange={(event) => setExecPhrase(event.target.value)} placeholder="ENABLE LIVE AUTO TRADING" autoComplete="off" />
                </label>
                <div className="ai-modal-actions">
                  <button type="button" className="ai-button ai-button-ghost" onClick={() => setExecModal(null)}>Cancel</button>
                  <button
                    type="button"
                    className="ai-button ai-button-gold"
                    disabled={Boolean(busy) || !readiness?.ready || !execAck || execPhrase.trim().toUpperCase() !== 'ENABLE LIVE AUTO TRADING'}
                    onClick={confirmExecutionMode}
                  >
                    {busy === 'execution' ? 'Enabling…' : 'Enable live execution'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {resumeModal ? (
        <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResumeModal(false); }}>
          <div className="ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-resume-title">
            <button type="button" className="ai-modal-close" onClick={() => setResumeModal(false)} aria-label="Close"><X size={17} /></button>
            <span className="ai-modal-icon is-danger"><ShieldCheck size={20} /></span>
            <h2 id="ai-resume-title">Authorize resuming after the daily risk halt</h2>
            <p>{account.daily.haltReason} The loss limit was reached today. Resuming clears the block and starts a fresh risk baseline at the current equity; the same daily loss cap applies again from there.</p>
            <label className="ai-ack">
              <input type="checkbox" checked={resumeAck} onChange={(event) => setResumeAck(event.target.checked)} />
              I understand the daily loss limit was hit and I accept further trading risk today.
            </label>
            <label className="ai-field">
              <span>Type <b>RESUME AUTO TRADING</b> to confirm</span>
              <input value={resumePhrase} onChange={(event) => setResumePhrase(event.target.value)} placeholder="RESUME AUTO TRADING" autoComplete="off" />
            </label>
            <div className="ai-modal-actions">
              <button type="button" className="ai-button ai-button-ghost" onClick={() => setResumeModal(false)}>Keep entries blocked</button>
              <button
                type="button"
                className="ai-button ai-button-danger"
                disabled={Boolean(busy) || !resumeAck || resumePhrase.trim().toUpperCase() !== 'RESUME AUTO TRADING'}
                onClick={authorizeResumeAfterHalt}
              >
                {busy === 'resume-halt' ? 'Resuming…' : 'Authorize resume'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {explain ? (
        <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExplain(null); }}>
          <div className="ai-modal ai-explain-modal" role="dialog" aria-modal="true" aria-labelledby="ai-explain-title">
            <button type="button" className="ai-modal-close" onClick={() => setExplain(null)} aria-label="Close"><X size={17} /></button>
            <span className="ai-modal-icon"><Sparkles size={20} /></span>
            <h2 id="ai-explain-title">{explain.symbol} trade rationale</h2>
            {explain.loading ? <p className="ai-muted-line">Reading the computed signal and account state…</p> : (
              <>
                <p className="ai-explain-provider">{explain.provider}</p>
                <pre className="ai-explain-text">{explain.text}</pre>
                <p className="ai-disclaimer-line">
                  <Info size={13} /> Narrative explanation of a rules-based read. It is not a prediction, recommendation or guarantee.
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AITrading;
