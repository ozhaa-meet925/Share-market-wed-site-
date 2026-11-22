import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Calculator,
  Check, CircleHelp, Clock3, ExternalLink, GitCompareArrows, Landmark,
  LineChart, Newspaper, RefreshCw, Search, ShieldCheck, SlidersHorizontal,
  Sparkles, X,
} from 'lucide-react';
import { marketApi } from '../services/api';
import './MutualFunds.css';

const PAGE_SIZE = 8;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const CATEGORY_FILTERS = [
  { key: 'all', label: 'All schemes', query: '' },
  { key: 'equity', label: 'Equity', query: 'Equity' },
  { key: 'debt', label: 'Debt', query: 'Debt' },
  { key: 'large-cap', label: 'Large cap', query: 'Large Cap' },
  { key: 'mid-cap', label: 'Mid cap', query: 'Mid Cap' },
  { key: 'small-cap', label: 'Small cap', query: 'Small Cap' },
  { key: 'flexi-cap', label: 'Flexi cap', query: 'Flexi Cap' },
  { key: 'multi-cap', label: 'Multi cap', query: 'Multi Cap' },
  { key: 'elss', label: 'ELSS tax saver', query: 'ELSS' },
  { key: 'index', label: 'Index', query: 'Index' },
  { key: 'sectoral', label: 'Sectoral', query: 'Sectoral' },
  { key: 'hybrid', label: 'Hybrid', query: 'Hybrid' },
  { key: 'liquid', label: 'Liquid', query: 'Liquid' },
  { key: 'international', label: 'International', query: 'International' },
];
const RANGE_OPTIONS = [1, 3, 5, 10];

const safeRead = (key, fallback) => {
  try {
    const value = JSON.parse(window.localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
};

const toDate = (value) => {
  const raw = String(value || '').trim();
  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const displayDate = (value) => {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date) : 'Date unavailable';
};

const displayCheckedTime = (value) => value
  ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(value)
  : '';

const asIsoDate = (date) => date.toISOString().slice(0, 10);

const getHistoryStart = (years = 10) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return asIsoDate(date);
};

const normalizePoints = (data) => (Array.isArray(data) ? data : [])
  .map((point) => ({
    date: String(point?.date || ''),
    timestamp: toDate(point?.date)?.getTime() ?? null,
    nav: Number(point?.nav),
  }))
  .filter((point) => point.timestamp != null && Number.isFinite(point.nav) && point.nav > 0)
  .reduce((pointsByDate, point) => pointsByDate.set(point.date, point), new Map())
  .values();

const orderedPoints = (points) => [...points].sort((first, second) => first.timestamp - second.timestamp);

const returnForYears = (points, years) => {
  if (points.length < 2) return null;
  const latest = points.at(-1);
  const target = latest.timestamp - years * YEAR_MS;
  const reference = [...points].reverse().find((point) => point.timestamp <= target);
  if (!reference || reference.nav <= 0) return null;
  const actualYears = (latest.timestamp - reference.timestamp) / YEAR_MS;
  if (actualYears < years * 0.94) return null;
  return ((latest.nav / reference.nav) ** (1 / actualYears) - 1) * 100;
};

const derivePerformance = (points) => Object.fromEntries(
  RANGE_OPTIONS.map((years) => [years, returnForYears(points, years)]),
);

const deriveDailyChange = (points) => {
  if (points.length < 2) return null;
  const latest = points.at(-1);
  const prior = points.at(-2);
  return {
    amount: latest.nav - prior.nav,
    percent: ((latest.nav / prior.nav) - 1) * 100,
    priorDate: prior.date,
  };
};

const extractRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.schemes)) return payload.schemes;
  return [];
};

const schemeCodeOf = (scheme) => String(scheme?.schemeCode ?? scheme?.scheme_code ?? scheme?.code ?? '').trim();
const schemeNameOf = (scheme) => String(scheme?.schemeName ?? scheme?.scheme_name ?? scheme?.name ?? '').trim();
const slugifyFund = (name) => String(name || 'mutual-fund').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fundUrl = (fund) => `/mutual-funds/${slugifyFund(fund.name)}-${fund.code}/${encodeURIComponent(fund.code)}`;
const planFor = (name) => /\bdirect\b/i.test(name) ? 'Direct' : /\bregular\b/i.test(name) ? 'Regular' : 'Plan not specified';
const optionFor = (name) => /\bidcw\b|dividend|payout/i.test(name) ? 'IDCW' : /growth/i.test(name) ? 'Growth' : 'Option not specified';
const rupees = (value, digits = 2) => Number.isFinite(Number(value))
  ? `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
  : '—';
const percent = (value, digits = 2) => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}%` : '—';
const compactRupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const makeFund = (scheme, payload) => {
  const code = schemeCodeOf(scheme) || String(payload?.meta?.scheme_code || '');
  const name = payload?.meta?.scheme_name || schemeNameOf(scheme) || 'Mutual fund scheme';
  const points = orderedPoints(normalizePoints(payload?.data));
  const latest = points.at(-1) || null;
  return {
    code,
    name,
    meta: payload?.meta || {},
    points,
    latest,
    daily: deriveDailyChange(points),
    returns: derivePerformance(points),
    category: payload?.meta?.scheme_category || '',
    plan: planFor(name),
    option: optionFor(name),
    historyAvailable: points.length > 0,
  };
};

const applyLatestPayload = (fund, payload) => makeFund(
  { schemeCode: fund.code, schemeName: fund.name },
  {
    meta: payload?.meta || fund.meta,
    data: [...fund.points.map((point) => ({ date: point.date, nav: String(point.nav) })), ...(payload?.data || [])],
  },
);

const compactFund = (fund) => ({
  code: fund.code,
  name: fund.name,
  category: fund.category,
  plan: fund.plan,
  option: fund.option,
  latest: fund.latest,
  daily: fund.daily,
  returns: fund.returns,
});

const categoryMatches = (fund, activeCategory) => {
  if (activeCategory === 'all') return true;
  const category = `${fund.category} ${fund.name}`.toLowerCase();
  const aliases = {
    equity: ['equity'], debt: ['debt', 'income'], 'large-cap': ['large cap', 'large-cap'],
    'mid-cap': ['mid cap', 'mid-cap'], 'small-cap': ['small cap', 'small-cap'],
    'flexi-cap': ['flexi cap', 'flexi-cap'], 'multi-cap': ['multi cap', 'multi-cap'],
    elss: ['elss', 'tax saver', 'tax saving'], index: ['index'], sectoral: ['sectoral', 'thematic'],
    hybrid: ['hybrid', 'balanced', 'aggressive allocation', 'conservative allocation'],
    liquid: ['liquid'], international: ['international', 'overseas', 'global'],
  };
  return (aliases[activeCategory] || []).some((term) => category.includes(term));
};

const performanceHistory = (fund, years) => {
  if (!fund?.points?.length) return [];
  const end = fund.points.at(-1).timestamp;
  if (years === 'max') return fund.points;
  const start = end - Number(years) * YEAR_MS;
  const firstAfterStart = fund.points.findIndex((point) => point.timestamp >= start);
  const startIndex = Math.max(0, firstAfterStart - 1);
  return fund.points.slice(startIndex);
};

const makeProjection = (monthlyAmount, years, annualReturn) => {
  const count = Number(years) * 12;
  const monthlyRate = Number(annualReturn) / 1200;
  let value = 0;
  const series = [{ month: 0, invested: 0, value: 0 }];
  for (let month = 1; month <= count; month += 1) {
    value = (value + Number(monthlyAmount)) * (1 + monthlyRate);
    series.push({ month, invested: Number(monthlyAmount) * month, value });
  }
  const invested = Number(monthlyAmount) * count;
  return { invested, value, gain: value - invested, series };
};

const makeLumpSumProjection = (amount, years, annualReturn) => {
  const value = Number(amount) * ((1 + Number(annualReturn) / 100) ** Number(years));
  return { invested: Number(amount), value, gain: value - Number(amount) };
};

const historicalSip = (points, monthlyAmount = 5000, years = 5) => {
  if (points.length < 2) return null;
  const latest = points.at(-1);
  const firstTarget = new Date(latest.timestamp - years * YEAR_MS);
  if (points[0].timestamp > firstTarget.getTime() + (years * YEAR_MS * 0.08)) return null;
  let units = 0;
  let installments = 0;
  for (let month = 0; month < years * 12; month += 1) {
    const date = new Date(Date.UTC(firstTarget.getUTCFullYear(), firstTarget.getUTCMonth() + month, firstTarget.getUTCDate()));
    const point = points.find((item) => item.timestamp >= date.getTime());
    if (!point) continue;
    units += monthlyAmount / point.nav;
    installments += 1;
  }
  if (!installments) return null;
  const invested = monthlyAmount * installments;
  const value = units * latest.nav;
  return { invested, value, gain: value - invested, installments };
};

const PUBLISHED_NOTE = 'Mutual fund NAV is published periodically. Values shown here are the latest date returned by the source, not a real-time price. IDCW returns use NAV movement only and exclude distributions.';

function DataSourceNote({ detail = false }) {
  return (
    <div className={`mf-source-note${detail ? ' is-detail' : ''}`}>
      <span className="mf-source-icon"><ShieldCheck size={17} /></span>
      <div>
        <strong>Published NAV, with its date</strong>
        <p>{PUBLISHED_NOTE} NAV publication time is not included in the connected feed.</p>
      </div>
      <a href="https://www.amfiindia.com/net-asset-value/nav-download" target="_blank" rel="noreferrer">Verify with AMFI <ArrowUpRight size={14} /></a>
    </div>
  );
}

function FundCard({ fund, saved, compared, compareDisabled, onSave, onCompare }) {
  const daily = fund.daily;
  const annual = fund.returns?.[1];
  return (
    <article className="mf-fund-card">
      <div className="mf-fund-card-topline">
        <span className="mf-fund-symbol"><Landmark size={18} /></span>
        <div className="mf-fund-title-wrap">
          <h3><Link to={fundUrl(fund)}>{fund.name}</Link></h3>
          <p>{fund.meta.fund_house || 'Fund house not provided'}{fund.category ? ` · ${fund.category}` : ''}</p>
        </div>
        <button className={`mf-icon-button${saved ? ' is-active' : ''}`} onClick={() => onSave(fund)} type="button" aria-label={saved ? 'Remove saved fund' : 'Save fund'} title={saved ? 'Remove from saved funds' : 'Save fund'}>
          {saved ? <Bookmark size={17} fill="currentColor" /> : <Bookmark size={17} />}
        </button>
      </div>
      <div className="mf-fund-tags">
        <span>{fund.plan}</span><span>{fund.option}</span>
        {fund.category && <span>{fund.category}</span>}
      </div>
      <div className="mf-fund-numbers">
        <div>
          <small>Latest NAV</small>
          <strong>{fund.latest ? rupees(fund.latest.nav) : 'Unavailable'}</strong>
          <span>{fund.latest ? `As of ${displayDate(fund.latest.date)}` : 'No NAV returned'}</span>
        </div>
        <div className={daily?.percent >= 0 ? 'is-positive' : 'is-negative'}>
          <small>Change vs prior published NAV</small>
          <strong>{daily ? `${daily.amount >= 0 ? '+' : '−'}${rupees(Math.abs(daily.amount))}` : '—'}</strong>
          <span>{daily ? `${percent(daily.percent)} · previous ${displayDate(daily.priorDate)}` : 'History unavailable'}</span>
        </div>
      </div>
      <div className="mf-card-return-row">
        <span>1Y annualised return</span>
        <strong className={annual == null ? '' : annual >= 0 ? 'is-positive' : 'is-negative'}>{percent(annual)}</strong>
      </div>
      <div className="mf-card-actions">
        <Link to={fundUrl(fund)} className="mf-card-primary">View fund <ArrowRight size={15} /></Link>
        <button className={`mf-compare-button${compared ? ' is-active' : ''}`} type="button" onClick={() => onCompare(fund)} disabled={compareDisabled && !compared}>
          {compared ? <Check size={15} /> : <GitCompareArrows size={15} />}{compared ? 'Added' : 'Compare'}
        </button>
      </div>
    </article>
  );
}

function CompareDialog({ funds, onClose }) {
  if (!funds.length) return null;
  const metrics = [
    ['Category', (fund) => fund.category || 'Not provided'],
    ['Plan', (fund) => fund.plan || 'Not specified'],
    ['Option', (fund) => fund.option || 'Not specified'],
    ['Latest NAV', (fund) => fund.latest ? `${rupees(fund.latest.nav)} · ${displayDate(fund.latest.date)}` : 'Not provided'],
    ['1 year', (fund) => percent(fund.returns?.[1])],
    ['3 years', (fund) => percent(fund.returns?.[3])],
    ['5 years', (fund) => percent(fund.returns?.[5])],
    ['10 years', (fund) => percent(fund.returns?.[10])],
    ['AUM', () => 'Not provided by NAV source'],
    ['Expense ratio', () => 'Not provided by NAV source'],
    ['Benchmark', () => 'Not provided by NAV source'],
  ];
  return (
    <div className="mf-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="mf-compare-modal" role="dialog" aria-modal="true" aria-labelledby="mf-compare-title">
        <div className="mf-modal-heading"><div><span className="mf-kicker">SIDE BY SIDE</span><h2 id="mf-compare-title">Compare funds</h2></div><button className="mf-icon-button" type="button" onClick={onClose} aria-label="Close comparison"><X size={19} /></button></div>
        <div className="mf-compare-table-wrap"><table className="mf-compare-table"><thead><tr><th>Fund details</th>{funds.map((fund) => <th key={fund.code}><Link to={fundUrl(fund)} onClick={onClose}>{fund.name}</Link></th>)}</tr></thead><tbody>{metrics.map(([label, read]) => <tr key={label}><th>{label}</th>{funds.map((fund) => <td key={fund.code}>{read(fund)}</td>)}</tr>)}</tbody></table></div>
        <p className="mf-fine-print">Returns are calculated from the latest published NAV and available historical NAV records. Past performance does not predict future returns.</p>
      </section>
    </div>
  );
}

function SchemeExplorer() {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [plan, setPlan] = useState('all');
  const [option, setOption] = useState('all');
  const [sort, setSort] = useState('returns');
  const [minimumReturn, setMinimumReturn] = useState('');
  const [offset, setOffset] = useState(0);
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [lastChecked, setLastChecked] = useState(null);
  const [savedCodes, setSavedCodes] = useState(() => {
    const stored = safeRead('sharemarket:mutual-fund-saved', []);
    return Array.isArray(stored) ? stored : [];
  });
  const [compareFunds, setCompareFunds] = useState(() => {
    const stored = safeRead('sharemarket:mutual-fund-compare', []);
    return Array.isArray(stored) ? stored.slice(0, 4) : [];
  });
  const [showCompare, setShowCompare] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const selectedCategory = CATEGORY_FILTERS.find((item) => item.key === activeCategory) || CATEGORY_FILTERS[0];

  useEffect(() => {
    document.title = 'Mutual Funds | ShareMarket Pro';
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', 'Search Indian mutual fund schemes, inspect dated published NAV history, compare funds, and explore investment calculators.');
  }, []);

  useEffect(() => {
    window.localStorage.setItem('sharemarket:mutual-fund-saved', JSON.stringify(savedCodes));
  }, [savedCodes]);

  useEffect(() => {
    window.localStorage.setItem('sharemarket:mutual-fund-compare', JSON.stringify(compareFunds));
  }, [compareFunds]);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      setRefreshError('');
      setLastChecked(null);
      try {
        if (query.trim().length === 1) {
          if (alive) setFunds([]);
          return;
        }
        const term = query.trim() || selectedCategory.query;
        let directPayload = null;
        let listPayload;
        if (/^\d{1,12}$/.test(term)) {
          directPayload = await marketApi.getMutualFundHistory(term, getHistoryStart());
          listPayload = [{ schemeCode: term, schemeName: directPayload?.meta?.scheme_name || `Scheme ${term}` }];
        } else {
          listPayload = term.length >= 2
            ? await marketApi.searchMutualFunds(term)
            : await marketApi.getMutualFundSchemes(PAGE_SIZE, offset);
        }
        const rows = extractRows(listPayload)
          .filter((row) => /^\d{1,12}$/.test(schemeCodeOf(row)) && schemeNameOf(row))
          .slice(0, PAGE_SIZE);
        if (!rows.length) {
          if (alive) setFunds([]);
          return;
        }
        const enriched = await Promise.all(rows.map(async (row) => {
          if (directPayload && schemeCodeOf(row) === term) return makeFund(row, directPayload);
          try {
            const navPayload = await marketApi.getMutualFundHistory(schemeCodeOf(row), getHistoryStart());
            return makeFund(row, navPayload);
          } catch {
            return makeFund(row, null);
          }
        }));
        if (alive) {
          setFunds(enriched);
          setLastChecked(new Date());
        }
      } catch (loadError) {
        if (alive) {
          setFunds([]);
          setError(loadError.message || 'Mutual fund data could not be loaded.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 280);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [activeCategory, offset, query, reloadKey, selectedCategory.query]);

  useEffect(() => {
    if (!funds.length) return undefined;
    let alive = true;
    const timer = window.setInterval(async () => {
      const results = await Promise.allSettled(funds.map(async (fund) => [
        fund.code,
        applyLatestPayload(fund, await marketApi.getMutualFundLatest(fund.code)),
      ]));
      if (!alive) return;
      const updates = new Map(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
      const failures = results.length - updates.size;
      if (updates.size) {
        setFunds((current) => current.map((fund) => updates.get(fund.code) || fund));
        setLastChecked(new Date());
      }
      if (failures) setRefreshError('Some schemes could not be refreshed. Showing their last available NAV records.');
    }, 30 * 60 * 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [funds]);

  const filteredFunds = useMemo(() => {
    let list = funds.filter((fund) => categoryMatches(fund, activeCategory));
    if (plan !== 'all') list = list.filter((fund) => fund.plan.toLowerCase() === plan);
    if (option !== 'all') list = list.filter((fund) => fund.option.toLowerCase() === option);
    if (minimumReturn !== '') list = list.filter((fund) => Number.isFinite(fund.returns?.[1]) && fund.returns[1] >= Number(minimumReturn));
    return [...list].sort((first, second) => {
      if (sort === 'name') return first.name.localeCompare(second.name);
      if (sort === 'nav-asc') return (first.latest?.nav ?? Infinity) - (second.latest?.nav ?? Infinity);
      if (sort === 'nav-desc') return (second.latest?.nav ?? -Infinity) - (first.latest?.nav ?? -Infinity);
      return (second.returns?.[1] ?? -Infinity) - (first.returns?.[1] ?? -Infinity);
    });
  }, [activeCategory, funds, minimumReturn, option, plan, sort]);

  const toggleSave = (fund) => setSavedCodes((current) => current.includes(fund.code)
    ? current.filter((code) => code !== fund.code)
    : [...current, fund.code]);

  const toggleCompare = (fund) => setCompareFunds((current) => current.some((item) => item.code === fund.code)
    ? current.filter((item) => item.code !== fund.code)
    : current.length < 4 ? [...current, compactFund(fund)] : current);

  const updateCategory = (key) => {
    setActiveCategory(key);
    setOffset(0);
    if (key !== 'all') setQuery('');
  };

  const resetSearch = () => {
    setQuery('');
    setActiveCategory('all');
    setOffset(0);
  };

  const refreshLatestNav = async () => {
    if (!funds.length || refreshing) return;
    setRefreshing(true);
    setRefreshError('');
    const results = await Promise.allSettled(funds.map(async (fund) => [
      fund.code,
      applyLatestPayload(fund, await marketApi.getMutualFundLatest(fund.code, true)),
    ]));
    const updates = new Map(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
    const failures = results.length - updates.size;
    if (updates.size) {
      setFunds((current) => current.map((fund) => updates.get(fund.code) || fund));
      setLastChecked(new Date());
    }
    if (failures) setRefreshError('Some schemes could not be refreshed. Showing their last available NAV records.');
    setRefreshing(false);
  };

  return (
    <div className="mf-page">
      <div className="mf-page-inner">
        <div className="mf-breadcrumb"><span>Markets</span><span>/</span><strong>Mutual funds</strong></div>
        <section className="mf-hero">
          <div className="mf-hero-copy">
            <span className="mf-kicker"><span className="mf-kicker-dot" /> MUTUAL FUND RESEARCH</span>
            <h1>Find funds that fit <em>your goals.</em></h1>
            <p>Explore Indian mutual fund schemes with published NAV history, clear plan details, and practical tools to compare your options.</p>
            <form className="mf-search" onSubmit={(event) => { event.preventDefault(); setOffset(0); }}>
              <Search size={19} aria-hidden="true" />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setActiveCategory('all'); setOffset(0); }} placeholder="Search fund, AMC, category, or AMFI code" aria-label="Search mutual funds by name, category, or AMFI scheme code" />
              {query && <button type="button" onClick={resetSearch} aria-label="Clear search"><X size={16} /></button>}
              <button className="mf-search-submit" type="submit">Search</button>
            </form>
            <div className="mf-search-tip">Enter a scheme name or AMFI scheme code, then save it with the bookmark.</div>
            <div className="mf-hero-tags"><span><Check size={14} /> Dated NAV values</span><span><Check size={14} /> No promised returns</span></div>
          </div>
          <div className="mf-hero-art" aria-hidden="true">
            <div className="mf-art-orbit orbit-one" /><div className="mf-art-orbit orbit-two" />
            <div className="mf-art-card mf-art-main"><span>INVESTING, MADE CLEAR</span><div className="mf-art-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><b>Build with a plan</b><small>Research every scheme at your pace</small></div>
            <div className="mf-art-mini"><Sparkles size={17} /><span>Long term<br /><b>perspective</b></span></div>
            <span className="mf-art-leaf leaf-a" /><span className="mf-art-leaf leaf-b" />
          </div>
        </section>

        <section className="mf-snapshot-grid" aria-label="Mutual fund data coverage">
          <article><span>Industry AUM</span><strong>Not supplied</strong><small>The NAV feed does not include AUM</small></article>
          <article><span>Total scheme count</span><strong>Not reported</strong><small>Directory is paginated without a total</small></article>
          <article><span>Schemes on this page</span><strong>{loading ? '…' : funds.length.toLocaleString('en-IN')}</strong><small>Current catalogue result page</small></article>
          <article><span>NAV publication</span><strong>Per scheme</strong><small>See the published date on each fund</small></article>
        </section>

        <div className="mf-trust-strip">
          <div><span className="mf-trust-icon"><Clock3 size={17} /></span><p><strong>Latest published NAV</strong><small>Each scheme shows its own NAV date</small></p></div>
          <div><span className="mf-trust-icon"><LineChart size={17} /></span><p><strong>Historical returns</strong><small>Calculated from published NAV history</small></p></div>
          <div><span className="mf-trust-icon"><Bookmark size={17} /></span><p><strong>{savedCodes.length} saved schemes</strong><small>Saved on this device</small></p></div>
          <button type="button" className="mf-compare-open" onClick={() => setShowCompare(true)} disabled={!compareFunds.length}><GitCompareArrows size={16} /> Compare {compareFunds.length ? `(${compareFunds.length}/4)` : 'funds'}</button>
        </div>

        <DataSourceNote />

        <section className="mf-category-section" aria-labelledby="mf-categories-heading">
          <div className="mf-section-heading"><div><span className="mf-kicker">EXPLORE BY CATEGORY</span><h2 id="mf-categories-heading">A starting point for every strategy</h2></div><span className="mf-category-count">13 categories</span></div>
          <div className="mf-category-grid">
            {CATEGORY_FILTERS.slice(1).map((category) => (
              <button key={category.key} type="button" className={`mf-category-card${activeCategory === category.key ? ' is-active' : ''}`} onClick={() => updateCategory(category.key)}>
                <span className={`mf-category-mark tone-${category.key}`}><Landmark size={17} /></span><span>{category.label}</span><ArrowRight size={15} />
              </button>
            ))}
          </div>
        </section>

        <section className="mf-explorer" aria-labelledby="mf-explorer-heading">
          <div className="mf-section-heading mf-results-heading">
            <div><span className="mf-kicker">SCHEME EXPLORER</span><h2 id="mf-explorer-heading">{query ? `Results for “${query}”` : activeCategory === 'all' ? sort === 'returns' && funds.length ? 'Top 1Y returns in these results' : 'Browse mutual funds' : `${selectedCategory.label} funds`}</h2><p>Latest available NAV and returns calculated from the provider’s dated history. IDCW calculations exclude distributions.</p>{lastChecked && <small className="mf-last-checked"><Clock3 size={13} /> NAV check completed at {displayCheckedTime(lastChecked)} IST · published dates appear on each scheme</small>}{refreshError && <small className="mf-refresh-error" role="status">{refreshError}</small>}</div>
            <div className="mf-result-actions"><span className="mf-result-count">{loading ? 'Updating…' : `${filteredFunds.length} shown`}</span><button className="mf-refresh-button" type="button" onClick={refreshLatestNav} disabled={loading || refreshing || !funds.length}><RefreshCw size={14} className={refreshing ? 'is-spinning' : ''} />{refreshing ? 'Refreshing' : 'Refresh NAV'}</button></div>
          </div>
          <div className="mf-filter-bar">
            <div className="mf-filter-select"><SlidersHorizontal size={16} /><span>Filters</span></div>
            <label><span>Plan</span><select value={plan} onChange={(event) => setPlan(event.target.value)}><option value="all">All plans</option><option value="direct">Direct</option><option value="regular">Regular</option></select></label>
            <label><span>Option</span><select value={option} onChange={(event) => setOption(event.target.value)}><option value="all">Growth + IDCW</option><option value="growth">Growth</option><option value="idcw">IDCW</option></select></label>
            <label className="mf-min-return"><span>Min. 1Y return</span><div><input type="number" min="-100" max="1000" step="1" value={minimumReturn} onChange={(event) => setMinimumReturn(event.target.value)} placeholder="Any" /><b>%</b></div></label>
            <label className="mf-sort-select"><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="returns">Highest 1Y return</option><option value="name">Fund name</option><option value="nav-asc">Lowest NAV</option><option value="nav-desc">Highest NAV</option></select></label>
            <button className={`mf-advanced-toggle${showAdvanced ? ' is-active' : ''}`} type="button" onClick={() => setShowAdvanced((shown) => !shown)}><CircleHelp size={15} /> Data coverage</button>
          </div>
          {showAdvanced && <div className="mf-data-coverage"><strong>Filters are limited to fields in the connected NAV feed.</strong><span>Category, plan, option, NAV, and calculated historical return are available. Riskometer, fund AUM, expense ratio, exit load, and minimum investment are not supplied, so those filters are not shown as if they worked.</span></div>}

          {loading ? (
            <div className="mf-fund-grid" aria-label="Loading mutual funds">{Array.from({ length: 4 }, (_, index) => <div className="mf-skeleton" key={index}><i /><b /><span /><span /><footer /></div>)}</div>
          ) : error ? (
            <div className="mf-state-card is-error"><div className="mf-state-symbol"><X size={18} /></div><h3>Fund data is temporarily unavailable</h3><p>{error}</p><button type="button" onClick={() => setReloadKey((current) => current + 1)}>Try again <ArrowRight size={15} /></button></div>
          ) : filteredFunds.length ? (
            <div className="mf-fund-grid">{filteredFunds.map((fund) => <FundCard key={fund.code} fund={fund} saved={savedCodes.includes(fund.code)} compared={compareFunds.some((item) => item.code === fund.code)} compareDisabled={compareFunds.length >= 4} onSave={toggleSave} onCompare={toggleCompare} />)}</div>
          ) : query.trim().length === 1 ? (
            <div className="mf-state-card"><div className="mf-state-symbol"><Search size={18} /></div><h3>Keep typing to search schemes</h3><p>Enter at least two characters, such as an AMC name, fund name, or category.</p></div>
          ) : (
            <div className="mf-state-card"><div className="mf-state-symbol"><Search size={18} /></div><h3>No schemes match these filters</h3><p>Try another name or category. This source contains scheme NAV records; it does not provide live quotes or every research metric.</p><button type="button" onClick={() => { setPlan('all'); setOption('all'); setMinimumReturn(''); resetSearch(); }}>Clear filters <ArrowRight size={15} /></button></div>
          )}
          {!query && activeCategory === 'all' && <div className="mf-pagination"><span>Scheme directory · page {Math.floor(offset / PAGE_SIZE) + 1}</span><div><button type="button" onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))} disabled={!offset || loading}><ArrowLeft size={15} /> Previous</button><button type="button" onClick={() => setOffset((current) => current + PAGE_SIZE)} disabled={loading || funds.length < PAGE_SIZE}>More schemes <ArrowRight size={15} /></button></div></div>}
        </section>

        <MutualFundNewsSection />

        <CalculatorSection />

        <section className="mf-unavailable-section">
          <div className="mf-unavailable-icon"><CircleHelp size={19} /></div>
          <div><span className="mf-kicker">DATA TRANSPARENCY</span><h2>Know what this feed can verify</h2><p>The connected source provides scheme names, categories, and NAV history. It does not provide current AUM, TER, fund manager, exit load, holdings, benchmark, riskometer, NFO dates, or minimum investment amounts. Those fields are left out rather than estimated.</p></div>
          <a href="https://www.mfapi.in/docs/" target="_blank" rel="noreferrer">NAV API details <ArrowUpRight size={14} /></a>
        </section>

        <div className="mf-risk-disclaimer"><ShieldCheck size={18} /><p><strong>Mutual funds are subject to market risks.</strong> Read all scheme related documents carefully before investing. Returns shown are historical calculations from NAV records; they do not assure future performance. This research page does not execute purchases or provide personalised investment advice.</p></div>
      </div>
      {showCompare && <CompareDialog funds={compareFunds} onClose={() => setShowCompare(false)} />}
    </div>
  );
}

function MutualFundNewsSection() {
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const payload = await marketApi.getMutualFundNews();
        if (alive) {
          setFeed(payload);
          setError('');
        }
      } catch (loadError) {
        if (alive) setError(loadError.message || 'Mutual fund news could not be loaded.');
      } finally {
        if (alive) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 10 * 60 * 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [reloadKey]);

  const feedArticles = (Array.isArray(feed?.data) ? feed.data : [])
    .filter((article) => article?.headline && article?.url && article.category === 'Mutual Funds');
  const launchArticles = feedArticles.filter((article) => /\bNFO\b|new fund offer|launch/i.test(article.headline)).slice(0, 2);
  const latestArticles = feedArticles.filter((article) => !launchArticles.some((launch) => launch.url === article.url)).slice(0, 4);
  const articles = [...new Map([...latestArticles, ...launchArticles].map((article) => [article.url, article])).values()]
    .sort((first, second) => Number(second.datetime || 0) - Number(first.datetime || 0));
  const updatedAt = feed?.lastUpdated ? new Date(feed.lastUpdated) : null;
  const badge = feed?.stale ? 'Cached headlines' : feed?.live ? 'Updated feed' : 'Feed unavailable';

  return (
    <section className="mf-news-section" id="fund-news" aria-labelledby="mf-news-heading">
      <div className="mf-section-heading mf-news-heading">
        <div><span className="mf-kicker">MUTUAL FUND NEWS</span><h2 id="mf-news-heading">Funds and NFOs in the headlines</h2><p>Recent stories about Indian mutual funds, launches, and SEBI updates, linked to each publisher.</p></div>
        <div className="mf-news-actions"><span className={`mf-news-status${feed?.live && !feed?.stale ? ' is-live' : feed?.stale ? ' is-stale' : ''}`}><i />{badge}</span><button className="mf-refresh-button" type="button" disabled={refreshing} onClick={() => { setRefreshing(true); setReloadKey((current) => current + 1); }}><RefreshCw size={14} className={refreshing ? 'is-spinning' : ''} />Refresh news</button></div>
      </div>
      {updatedAt && <div className="mf-news-updated">Last checked {new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(updatedAt)} IST · {feed?.provider || 'News feed'}</div>}
      {feed?.note && <div className={`mf-news-note${feed?.stale ? ' is-stale' : ''}`} role="status">{feed.note}</div>}
      {error && <div className="mf-news-note is-error" role="status">{error}</div>}
      {loading && !feed ? (
        <div className="mf-news-grid" aria-label="Loading mutual fund headlines">{Array.from({ length: 3 }, (_, index) => <div className="mf-news-skeleton" key={index}><i /><b /><span /></div>)}</div>
      ) : articles.length ? (
        <div className="mf-news-grid">
          {articles.map((article) => {
            const publishedAt = Number(article.datetime) ? new Date(Number(article.datetime) * 1000) : null;
            const isLaunch = /nfo|new fund|launch|launches/i.test(article.headline);
            return (
              <article className="mf-news-card" key={article.id || article.url}>
                <div className="mf-news-card-meta"><span className={isLaunch ? 'is-launch' : ''}><Newspaper size={13} />{isLaunch ? 'NFO / launch' : 'Mutual funds'}</span><time dateTime={publishedAt?.toISOString()}>{publishedAt ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(publishedAt) : 'Recent'}</time></div>
                <h3><a href={article.url} target="_blank" rel="noreferrer">{article.headline}</a></h3>
                <div className="mf-news-card-footer"><span>{article.source || 'Publisher'}</span><a href={article.url} target="_blank" rel="noreferrer" aria-label={`Read ${article.headline}`}><ExternalLink size={15} /></a></div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mf-state-card"><div className="mf-state-symbol"><Newspaper size={18} /></div><h3>No recent mutual fund headlines</h3><p>{feed?.note || 'Try refreshing the feed in a little while.'}</p><button type="button" onClick={() => { setRefreshing(true); setReloadKey((current) => current + 1); }}>Try again <RefreshCw size={14} /></button></div>
      )}
      <p className="mf-news-disclaimer">Headlines and publisher links are provided for news discovery. Confirm offer dates and scheme information with the fund house or regulatory disclosures.</p>
    </section>
  );
}

function CalculatorSection() {
  const [monthlyAmount, setMonthlyAmount] = useState(5000);
  const [duration, setDuration] = useState(10);
  const [expectedReturn, setExpectedReturn] = useState(12);
  const [initialAmount, setInitialAmount] = useState(100000);
  const [lumpYears, setLumpYears] = useState(5);
  const [lumpReturn, setLumpReturn] = useState(10);
  const sip = useMemo(() => makeProjection(monthlyAmount, duration, expectedReturn), [duration, expectedReturn, monthlyAmount]);
  const lump = useMemo(() => makeLumpSumProjection(initialAmount, lumpYears, lumpReturn), [initialAmount, lumpReturn, lumpYears]);
  return (
    <section className="mf-calculators" id="calculators" aria-labelledby="mf-calc-heading">
      <div className="mf-section-heading"><div><span className="mf-kicker">PLAN BEFORE YOU INVEST</span><h2 id="mf-calc-heading">Make the numbers feel tangible</h2><p>Adjust the assumptions to explore possible outcomes. These are illustrations, not forecasts.</p></div><span className="mf-calc-heading-icon"><Calculator size={20} /></span></div>
      <div className="mf-calculator-grid">
        <article className="mf-calculator-card mf-sip-card">
          <div className="mf-calculator-title"><span className="mf-calculator-icon"><LineChart size={18} /></span><div><h3>SIP calculator</h3><p>Monthly investing illustration</p></div></div>
          <div className="mf-calculator-body">
            <div className="mf-range-input"><div><label htmlFor="mf-sip-amount">Monthly investment</label><strong>{compactRupees(monthlyAmount)}</strong></div><input id="mf-sip-amount" type="range" min="500" max="100000" step="500" value={monthlyAmount} onChange={(event) => setMonthlyAmount(Number(event.target.value))} /><div className="mf-range-bounds"><span>₹500</span><span>₹1 lakh</span></div></div>
            <div className="mf-range-input"><div><label htmlFor="mf-sip-duration">Investment period</label><strong>{duration} years</strong></div><input id="mf-sip-duration" type="range" min="1" max="30" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><div className="mf-range-bounds"><span>1 year</span><span>30 years</span></div></div>
            <div className="mf-range-input"><div><label htmlFor="mf-sip-return">Expected annual return</label><strong>{expectedReturn}%</strong></div><input id="mf-sip-return" type="range" min="1" max="30" value={expectedReturn} onChange={(event) => setExpectedReturn(Number(event.target.value))} /><div className="mf-range-bounds"><span>1%</span><span>30%</span></div></div>
          </div>
          <div className="mf-calc-summary"><div><span>Invested</span><strong>{compactRupees(sip.invested)}</strong></div><div><span>Estimated gain</span><strong className="is-positive">{compactRupees(sip.gain)}</strong></div><div className="is-total"><span>Illustrative value</span><strong>{compactRupees(sip.value)}</strong></div></div>
          <div className="mf-projection-chart"><ResponsiveContainer width="100%" height="188"><AreaChart data={sip.series} margin={{ top: 12, right: 2, left: 0, bottom: 0 }}><defs><linearGradient id="mfSipValue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#13a875" stopOpacity={0.24} /><stop offset="95%" stopColor="#13a875" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8edf0" strokeDasharray="3 5" /><XAxis dataKey="month" tickFormatter={(month) => month % 12 === 0 ? `${month / 12}y` : ''} tickLine={false} axisLine={false} fontSize={11} /><YAxis tickFormatter={(value) => value >= 1000000 ? `₹${(value / 1000000).toFixed(0)}L` : `₹${Math.round(value / 1000)}k`} tickLine={false} axisLine={false} width={47} fontSize={10} /><Tooltip formatter={(value) => rupees(value, 0)} labelFormatter={(month) => `${Math.floor(Number(month) / 12)} years, ${Number(month) % 12} months`} /><Area type="monotone" dataKey="value" name="Illustrative value" stroke="#0a9f70" strokeWidth={2.5} fill="url(#mfSipValue)" /><Area type="monotone" dataKey="invested" name="Contributions" stroke="#7daaaa" strokeWidth={1.6} fill="none" /></AreaChart></ResponsiveContainer></div>
        </article>

        <article className="mf-calculator-card mf-lumpsum-card">
          <div className="mf-calculator-title"><span className="mf-calculator-icon is-blue"><Sparkles size={18} /></span><div><h3>Lump sum calculator</h3><p>One time investment illustration</p></div></div>
          <div className="mf-lump-fields"><label>Initial investment<div><span>₹</span><input inputMode="numeric" type="number" min="500" step="500" value={initialAmount} onChange={(event) => setInitialAmount(Math.max(0, Number(event.target.value)))} /></div></label><label>Investment period<div><input type="number" min="1" max="50" value={lumpYears} onChange={(event) => setLumpYears(Math.min(50, Math.max(1, Number(event.target.value))))} /><span>years</span></div></label><label>Expected annual return<div><input type="number" min="0" max="100" step="0.5" value={lumpReturn} onChange={(event) => setLumpReturn(Math.min(100, Math.max(0, Number(event.target.value))))} /><span>%</span></div></label></div>
          <div className="mf-lump-result"><span>Estimated maturity value</span><strong>{compactRupees(lump.value)}</strong><div><span>Invested <b>{compactRupees(lump.invested)}</b></span><span>Estimated gain <b className="is-positive">{compactRupees(lump.gain)}</b></span></div></div>
          <div className="mf-lump-visual"><div className="mf-lump-visual-label"><span>Starting amount</span><b>{compactRupees(lump.invested)}</b></div><div className="mf-lump-bar"><span style={{ width: `${Math.max(10, Math.min(100, (lump.invested / Math.max(lump.value, 1)) * 100))}%` }} /></div><div className="mf-lump-visual-label"><span>Illustrative value after {lumpYears} years</span><b>{compactRupees(lump.value)}</b></div><p>Uses annual compounding and your chosen assumption.</p></div>
        </article>
      </div>
      <p className="mf-calculator-disclaimer">Calculators use the assumptions entered above. Mutual fund returns are market linked and are not guaranteed.</p>
    </section>
  );
}

function FundDetail() {
  const { schemeCode } = useParams();
  const [fund, setFund] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingNav, setRefreshingNav] = useState(false);
  const [navRefreshError, setNavRefreshError] = useState('');
  const [lastChecked, setLastChecked] = useState(null);
  const [range, setRange] = useState('5');
  const [savedCodes, setSavedCodes] = useState(() => {
    const stored = safeRead('sharemarket:mutual-fund-saved', []);
    return Array.isArray(stored) ? stored : [];
  });
  const [monthlyAmount, setMonthlyAmount] = useState(5000);

  useEffect(() => {
    document.title = 'Fund details | Mutual Funds | ShareMarket Pro';
    let alive = true;
    setLoading(true);
    setError('');
    marketApi.getMutualFundHistory(schemeCode)
      .then((payload) => {
        if (alive) {
          const loadedFund = makeFund({ schemeCode, schemeName: payload?.meta?.scheme_name }, payload);
          setFund(loadedFund);
          setLastChecked(new Date());
          document.title = `${loadedFund.name} | Mutual Funds | ShareMarket Pro`;
          const description = document.querySelector('meta[name="description"]');
          if (description) description.setAttribute('content', `Published NAV history and calculated returns for ${loadedFund.name}. NAV values are dated and are not real-time prices.`);
        }
      })
      .catch((loadError) => { if (alive) setError(loadError.message || 'This scheme could not be loaded.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [schemeCode]);

  useEffect(() => { window.localStorage.setItem('sharemarket:mutual-fund-saved', JSON.stringify(savedCodes)); }, [savedCodes]);

  useEffect(() => {
    if (!fund) return undefined;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const payload = await marketApi.getMutualFundLatest(fund.code);
        if (alive) {
          setFund((current) => current ? applyLatestPayload(current, payload) : current);
          setLastChecked(new Date());
          setNavRefreshError('');
        }
      } catch {
        if (alive) setNavRefreshError('NAV refresh could not reach the provider. The displayed value keeps its published date.');
      }
    }, 30 * 60 * 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [fund?.code]);

  const chartData = useMemo(() => performanceHistory(fund, range).map((point) => ({ ...point, displayDate: displayDate(point.date) })), [fund, range]);
  const saved = savedCodes.includes(String(schemeCode));
  const sipBacktest = useMemo(() => historicalSip(fund?.points || [], monthlyAmount, 5), [fund, monthlyAmount]);

  const toggleSave = () => setSavedCodes((current) => saved
    ? current.filter((code) => code !== String(schemeCode))
    : [...current, String(schemeCode)]);

  const refreshNav = async () => {
    if (!fund || refreshingNav) return;
    setRefreshingNav(true);
    setNavRefreshError('');
    try {
      const payload = await marketApi.getMutualFundLatest(fund.code, true);
      setFund((current) => current ? applyLatestPayload(current, payload) : current);
      setLastChecked(new Date());
    } catch (refreshError) {
      setNavRefreshError(refreshError.message || 'NAV refresh could not reach the provider.');
    } finally {
      setRefreshingNav(false);
    }
  };

  if (loading) return <div className="mf-page"><div className="mf-page-inner"><div className="mf-detail-skeleton"><span /><b /><i /><div /></div></div></div>;
  if (error || !fund?.latest) return <div className="mf-page"><div className="mf-page-inner"><Link className="mf-back-link" to="/mutual-funds"><ArrowLeft size={16} /> All mutual funds</Link><div className="mf-state-card is-error"><h2>Scheme data is unavailable</h2><p>{error || 'The provider did not return a published NAV record for this scheme.'}</p><Link to="/mutual-funds" className="mf-card-primary">Return to fund search <ArrowRight size={15} /></Link></div></div></div>;

  const dataCategory = fund.category || 'Category not provided';
  const performance = fund.returns;
  const missing = 'Not provided by the NAV source';
  const dataRows = [
    ['Fund category', dataCategory], ['Plan', fund.plan], ['Option', fund.option],
    ['Fund AUM', missing], ['Expense ratio (TER)', missing], ['Exit load', missing],
    ['Minimum SIP', missing], ['Minimum lump sum', missing], ['Benchmark', missing],
    ['Fund manager', missing], ['Riskometer', missing],
  ];

  return (
    <div className="mf-page mf-detail-page">
      <div className="mf-page-inner">
        <Link className="mf-back-link" to="/mutual-funds"><ArrowLeft size={16} /> All mutual funds</Link>
        <section className="mf-detail-hero">
          <div className="mf-detail-main">
            <div className="mf-detail-eyebrow"><span className="mf-detail-mark"><Landmark size={18} /></span><span>{fund.meta.fund_house || 'Indian mutual fund scheme'}</span></div>
            <h1>{fund.name}</h1>
            <div className="mf-fund-tags"><span>{fund.plan}</span><span>{fund.option}</span><span>{dataCategory}</span></div>
            <p>Scheme code {fund.code} · NAV data via MFapi.in</p>
          </div>
          <div className="mf-detail-nav-card">
            <div><span>Latest available NAV</span><span className="mf-nav-published"><span /> Published value</span></div>
            <strong>{rupees(fund.latest.nav)}</strong>
            <p>As of {displayDate(fund.latest.date)} · source does not provide publication time</p>
            {fund.daily && <span className={`mf-daily-change ${fund.daily.percent >= 0 ? 'is-positive' : 'is-negative'}`}>{fund.daily.percent >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{percent(fund.daily.percent)} vs {displayDate(fund.daily.priorDate)}</span>}
          </div>
        </section>

        <DataSourceNote detail />

        <div className="mf-detail-actions"><button type="button" className={`mf-detail-action${saved ? ' is-active' : ''}`} onClick={toggleSave}>{saved ? <Check size={16} /> : <Bookmark size={16} />}{saved ? 'Saved on this device' : 'Save this fund'}</button><button type="button" className="mf-detail-action" onClick={refreshNav} disabled={refreshingNav}><RefreshCw size={15} className={refreshingNav ? 'is-spinning' : ''} />{refreshingNav ? 'Checking source' : 'Refresh NAV now'}</button><a className="mf-detail-action" href="https://www.amfiindia.com/net-asset-value/nav-download" target="_blank" rel="noreferrer">Check official NAV <ArrowUpRight size={15} /></a><span className="mf-detail-checked">{lastChecked ? `Checked ${displayCheckedTime(lastChecked)} IST` : ''}{navRefreshError && <b role="status">{navRefreshError}</b>}</span></div>

        <section className="mf-detail-panel mf-chart-panel">
          <div className="mf-detail-panel-heading"><div><span className="mf-kicker">NAV HISTORY</span><h2>Track the published value</h2><p>Historical NAV points returned for this scheme. The chart is not an intraday price.</p></div><div className="mf-chart-ranges">{['1', '3', '5', '10', 'max'].map((item) => <button key={item} type="button" className={range === item ? 'is-active' : ''} onClick={() => setRange(item)}>{item === 'max' ? 'MAX' : `${item}Y`}</button>)}</div></div>
          {chartData.length > 1 ? <div className="mf-detail-chart"><ResponsiveContainer width="100%" height="330"><AreaChart data={chartData} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}><defs><linearGradient id="mfHistoryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0a9e70" stopOpacity={0.22} /><stop offset="96%" stopColor="#0a9e70" stopOpacity={0.015} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8edf0" strokeDasharray="3 5" /><XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(value))} tickLine={false} axisLine={false} minTickGap={34} fontSize={11} /><YAxis domain={['auto', 'auto']} tickFormatter={(value) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} tickLine={false} axisLine={false} width={62} fontSize={11} /><Tooltip labelFormatter={(value) => displayDate(new Date(value).toISOString().slice(0, 10))} formatter={(value) => [rupees(value), 'NAV']} /><Area type="monotone" dataKey="nav" name="NAV" stroke="#079469" strokeWidth={2.4} fill="url(#mfHistoryFill)" activeDot={{ r: 5, strokeWidth: 0 }} /></AreaChart></ResponsiveContainer></div> : <div className="mf-state-card"><p>Historical points are not available for this range.</p></div>}
          <div className="mf-chart-footer"><span>{chartData.length.toLocaleString('en-IN')} dated NAV observations</span><span>Latest point: {displayDate(fund.latest.date)}</span></div>
        </section>

        <section className="mf-detail-panel">
          <div className="mf-detail-panel-heading"><div><span className="mf-kicker">PERFORMANCE</span><h2>Historical annualised returns</h2><p>Calculated as CAGR from the closest NAV on or before each period start. IDCW distributions are excluded.</p></div></div>
          <div className="mf-performance-grid">{RANGE_OPTIONS.map((years) => <div key={years} className="mf-performance-tile"><span>{years} year{years > 1 ? 's' : ''}</span><strong className={performance[years] == null ? '' : performance[years] >= 0 ? 'is-positive' : 'is-negative'}>{percent(performance[years])}</strong><small>{performance[years] == null ? 'Insufficient NAV history' : `Through ${displayDate(fund.latest.date)}`}</small></div>)}</div>
        </section>

        <section className="mf-detail-grid">
          <article className="mf-detail-panel mf-data-panel"><div className="mf-detail-panel-heading"><div><span className="mf-kicker">SCHEME OVERVIEW</span><h2>What the source reports</h2></div></div><dl className="mf-fact-list">{dataRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value === missing ? 'is-unavailable' : ''}>{value}</dd></div>)}</dl><p className="mf-coverage-note"><CircleHelp size={15} /> Fields marked unavailable are not present in this NAV dataset.</p></article>
          <article className="mf-detail-panel mf-sip-backtest"><div className="mf-detail-panel-heading"><div><span className="mf-kicker">HISTORICAL SIP ILLUSTRATION</span><h2>What monthly investing would have looked like</h2></div></div><label className="mf-backtest-input">Monthly contribution <div><span>₹</span><input type="number" min="500" step="500" value={monthlyAmount} onChange={(event) => setMonthlyAmount(Math.max(500, Number(event.target.value)))} /></div></label>{sipBacktest ? <div className="mf-backtest-result"><div><span>Contributions</span><strong>{compactRupees(sipBacktest.invested)}</strong></div><div><span>Historical value</span><strong>{compactRupees(sipBacktest.value)}</strong></div><div><span>Historical gain / loss</span><strong className={sipBacktest.gain >= 0 ? 'is-positive' : 'is-negative'}>{compactRupees(sipBacktest.gain)}</strong></div><small>{sipBacktest.installments} monthly NAV observations used · 5 years ending {displayDate(fund.latest.date)}.</small></div> : <p className="mf-backtest-empty">At least five years of dated NAV history is required for this illustration.</p>}<p className="mf-fine-print">This uses past NAV data and assumes a contribution at the next available NAV observation each month. It excludes IDCW distributions and is not a forecast.</p></article>
        </section>

        <section className="mf-unavailable-section"><div className="mf-unavailable-icon"><CircleHelp size={19} /></div><div><span className="mf-kicker">PORTFOLIO DETAILS</span><h2>Holdings and allocation data are not connected</h2><p>The NAV feed does not publish holdings, sector allocation, asset allocation, benchmark composition, scheme documents, or factsheets. Refer to the AMC and AMFI disclosures for this scheme.</p></div><a href="https://www.amfiindia.com/net-asset-value/nav-download" target="_blank" rel="noreferrer">AMFI disclosures <ArrowUpRight size={14} /></a></section>
        <div className="mf-risk-disclaimer"><ShieldCheck size={18} /><p><strong>Mutual funds are subject to market risks.</strong> Read all scheme related documents carefully before investing. Past returns do not assure future performance. This page is for research and education; no investment order is placed.</p></div>
      </div>
    </div>
  );
}

export default function MutualFunds() {
  const { schemeCode } = useParams();
  return schemeCode ? <FundDetail key={schemeCode} /> : <SchemeExplorer />;
}
