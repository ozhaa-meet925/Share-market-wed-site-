import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BellRing, Building2, CalendarDays, Search, SlidersHorizontal, TrendingUp, X } from 'lucide-react';
import IpoCard from '../components/IpoCard';
import { useIpoFeed } from '../hooks/useIpoFeed';
import { useIpoApplications } from '../hooks/useIpoApplications';
import { useIpoAlerts } from '../hooks/useIpoAlerts';
import { useTrackedIpos } from '../hooks/useTrackedIpos';
import { marketApi } from '../services/api';
const statusTabs = [
  { key: 'open', label: 'OPEN' },
  { key: 'upcoming', label: 'UPCOMING' },
  { key: 'all', label: 'ALL ACTIVE' },
  { key: 'closed', label: 'LISTED / CLOSED' },
  { key: 'tracked', label: 'TRACKED' },
  { key: 'applications', label: 'MY APPLICATIONS' },
];

const matchesStatus = (ipo, status) => {
  const currentStatus = String(ipo.status || '').toLowerCase();
  if (status === 'all') return ['open', 'upcoming', 'open soon'].includes(currentStatus);
  if (status === 'upcoming') return ['upcoming', 'open soon'].includes(currentStatus);
  if (status === 'closed') return ['closed', 'listed'].includes(currentStatus);
  return currentStatus === 'open';
};

const labelStatus = (value) => String(value || 'Unknown')
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatRupees = (value) => Number(value || 0).toLocaleString('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
const numericValue = (value) => {
  const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const compareNumberDescending = (firstValue, secondValue) => {
  const first = numericValue(firstValue);
  const second = numericValue(secondValue);
  if (first == null && second == null) return 0;
  if (first == null) return 1;
  if (second == null) return -1;
  return second - first;
};
const compareDate = (firstValue, secondValue, descending = false) => {
  const first = dateValue(firstValue);
  const second = dateValue(secondValue);
  if (first == null && second == null) return 0;
  if (first == null) return 1;
  if (second == null) return -1;
  return descending ? second - first : first - second;
};
const sortIpos = (items, sort) => [...items].sort((first, second) => {
  if (sort === 'company') return String(first.company || '').localeCompare(String(second.company || ''));
  if (sort === 'subscription') return compareNumberDescending(first.subscription, second.subscription);
  if (sort === 'gmp') return compareNumberDescending(first.gmpValue || first.gmp, second.gmpValue || second.gmp);
  if (sort === 'issue-size') return compareNumberDescending(first.issueSize, second.issueSize);
  if (sort === 'closing') return compareDate(first.closeDate, second.closeDate);
  return compareDate(first.openDate, second.openDate, true);
});
const dateValue = (value) => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
};
const dateKey = (value) => {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const timestamp = dateValue(raw);
  return timestamp == null ? '' : new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp));
};
const getPriceBand = (ipo) => {
  const matches = String(ipo.priceBand || '').match(/[\d,]+(?:\.\d+)?/g) || [];
  const bandLow = numericValue(ipo.minimumPrice ?? ipo.minPrice) ?? numericValue(matches[0]);
  const bandHigh = numericValue(ipo.maximumPrice) ?? numericValue(matches.at(-1)) ?? bandLow;
  return [bandLow, bandHigh];
};
const rangeHasValue = (value, minimum, maximum) => {
  if (minimum === '' && maximum === '') return true;
  if (value == null || !Number.isFinite(Number(value))) return false;
  return (minimum === '' || Number(value) >= Number(minimum))
    && (maximum === '' || Number(value) <= Number(maximum));
};
const financialEntries = (financials) => {
  if (Array.isArray(financials)) {
    return financials.map((item, index) => Array.isArray(item)
      ? [String(item[0] ?? index + 1), item[1]]
      : [String(item?.name || item?.label || index + 1), item?.value ?? item]);
  }
  if (financials && typeof financials === 'object') return Object.entries(financials);
  if (typeof financials === 'string' && financials.trim()) return [['Reported financials', financials]];
  return [];
};
const displayMetric = (value) => {
  if (value == null || value === '') return 'Not reported';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};
const maskUpi = (value) => {
  const [name, domain] = String(value || '').split('@');
  return name && domain ? `${name.slice(0, 2)}•••@${domain}` : 'Not available';
};

const IPO = () => {
  const feed = useIpoFeed();
  const ipos = feed.data || [];
  const history = feed.history || [];
  const [activeStatus, setActiveStatus] = useState(() => {
    const requestedView = new URLSearchParams(window.location.search).get('ipo_view');
    return statusTabs.some((tab) => tab.key === requestedView) ? requestedView : 'all';
  });
  const allKnownIpos = useMemo(() => [...ipos, ...history], [history, ipos]);
  const { trackedIpos, toggleTrackedIpo, isTracked } = useTrackedIpos();
  const ipoAlerts = useIpoAlerts(allKnownIpos);
  const applications = useIpoApplications(activeStatus === 'applications');
  const trackedItems = trackedIpos
    .map((tracked) => allKnownIpos.find((ipo) => ipo.id === tracked.id)
      || { ...tracked, status: tracked.status || 'Tracking', segment: tracked.segment || 'Mainboard', isLive: false, stale: true });
  const [selectedSegments, setSelectedSegments] = useState(['Mainboard', 'SME']);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('latest');
  const [filters, setFilters] = useState({
    priceMin: '', priceMax: '', issueMin: '', issueMax: '', listingFrom: '', listingTo: '',
  });
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const [historyPage, setHistoryPage] = useState(0);
  const [compareIds, setCompareIds] = useState([]);
  const compareIpos = compareIds
    .map((id) => allKnownIpos.find((ipo) => String(ipo.id) === id))
    .filter(Boolean);
  const toggleCompare = (ipo) => {
    const id = String(ipo?.id || '');
    if (!id) return;
    setCompareIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < 3 ? [...current, id] : current);
  };
  const isCompared = (ipo) => compareIds.includes(String(ipo?.id || ''));

  useEffect(() => setHistoryPage(0), [activeStatus, filters, query, selectedSegments, sort]);

  const toggleSegment = (segment) => {
    setSelectedSegments((current) => (
      current.includes(segment)
        ? current.filter((item) => item !== segment)
        : [...current, segment]
    ));
  };

  const filteredIpos = useMemo(() => {
    const term = query.trim().toLowerCase();
    const sourceIpos = activeStatus === 'closed' ? history : ipos;
    const result = sourceIpos.filter((ipo) => {
      const segment = ipo.segment || 'Mainboard';
      const searchText = `${ipo.company || ''} ${ipo.symbol || ''}`.toLowerCase();
      const [priceLow, priceHigh] = getPriceBand(ipo);
      const issueSize = numericValue(ipo.issueSize);
      const listingDate = dateKey(ipo.listingDate);
      const listingFrom = filters.listingFrom;
      const listingTo = filters.listingTo;
      const priceRangeMatches = (filters.priceMin === '' && filters.priceMax === '')
        || (priceLow != null && priceHigh != null
          && (filters.priceMax === '' || priceLow <= Number(filters.priceMax))
          && (filters.priceMin === '' || priceHigh >= Number(filters.priceMin)));
      const listingDateMatches = (!listingFrom && !listingTo)
        || (listingDate && (!listingFrom || listingDate >= listingFrom)
          && (!listingTo || listingDate <= listingTo));
      return (activeStatus === 'tracked'
        ? isTracked(ipo.id)
        : matchesStatus(ipo, activeStatus))
        && selectedSegments.includes(segment)
        && (!term || searchText.includes(term))
        && priceRangeMatches
        && rangeHasValue(issueSize, filters.issueMin, filters.issueMax)
        && listingDateMatches;
    });

    return sortIpos(result, sort);
  }, [activeStatus, filters, history, ipos, isTracked, query, selectedSegments, sort]);

  const pageIpos = activeStatus === 'tracked'
    ? sortIpos(trackedItems.filter((ipo) => {
      const segment = ipo.segment || 'Mainboard';
      const searchText = `${ipo.company || ''} ${ipo.symbol || ''}`.toLowerCase();
      const term = query.trim().toLowerCase();
      const [priceLow, priceHigh] = getPriceBand(ipo);
      const issueSize = numericValue(ipo.issueSize);
      const listingDate = dateKey(ipo.listingDate);
      const listingFrom = filters.listingFrom;
      const listingTo = filters.listingTo;
      const priceRangeMatches = (filters.priceMin === '' && filters.priceMax === '')
        || (priceLow != null && priceHigh != null
          && (filters.priceMax === '' || priceLow <= Number(filters.priceMax))
          && (filters.priceMin === '' || priceHigh >= Number(filters.priceMin)));
      const listingDateMatches = (!listingFrom && !listingTo)
        || (listingDate && (!listingFrom || listingDate >= listingFrom)
          && (!listingTo || listingDate <= listingTo));
      return selectedSegments.includes(segment)
        && (!term || searchText.includes(term))
        && priceRangeMatches
        && rangeHasValue(issueSize, filters.issueMin, filters.issueMax)
        && listingDateMatches;
    }), sort)
    : filteredIpos;
  const historyPageSize = 24;
  const historyPageCount = Math.max(1, Math.ceil(pageIpos.length / historyPageSize));
  const currentHistoryPage = Math.min(historyPage, historyPageCount - 1);
  const visibleIpos = activeStatus === 'closed'
    ? pageIpos.slice(currentHistoryPage * historyPageSize, (currentHistoryPage + 1) * historyPageSize)
    : pageIpos;

  const openIpos = pageIpos.filter((ipo) => String(ipo.status).toLowerCase() === 'open');
  const upcomingIpos = pageIpos.filter((ipo) => ['upcoming', 'open soon'].includes(String(ipo.status).toLowerCase()));
  const totalOpen = ipos.filter((ipo) => String(ipo.status).toLowerCase() === 'open').length;
  const totalUpcoming = ipos.filter((ipo) => ['upcoming', 'open soon'].includes(String(ipo.status).toLowerCase())).length;
  const updatedLabel = feed.lastUpdated
    ? new Date(feed.lastUpdated).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '—';
  const sourceLabel = feed.loading
    ? 'Connecting to IPO feed'
    : feed.source === 'nse'
      ? 'NSE India Live Feed'
    : feed.source === 'upstox'
      ? (feed.live ? 'Upstox Live API' : 'Upstox Cached Feed')
      : feed.configured ? 'Upstox API Error' : 'Live Feed Required';
  const upstoxRejected = feed.source === 'nse' && /\b401\b/.test(String(feed.message || ''));
  const feedDescription = upstoxRejected
    ? 'NSE India refreshes current and upcoming IPOs automatically. Closed issues leave the active list. Upstox rejected its token; replace UPSTOX_ACCESS_TOKEN to restore Upstox.'
    : feed.source === 'upstox'
    ? (feed.live
      ? 'Open and upcoming IPOs refresh automatically. New issues appear when Upstox publishes them; issues that close or list are removed from this active calendar.'
      : feed.message || 'The latest successful Upstox data is being shown while the provider refreshes.')
    : feed.message || 'Configure UPSTOX_ACCESS_TOKEN on the server to show current IPO listings.';
  const emptyMessage = feed.loading
    ? 'Loading current and upcoming IPOs…'
    : activeStatus === 'closed' && history.length === 0
      ? 'No listed or closed IPO records are available from the exchange feed yet.'
    : ipos.length === 0 && feed.source !== 'upstox'
      ? feedDescription
      : ipos.length === 0 && feed.live
        ? 'Upstox currently reports no open or upcoming IPOs.'
        : 'No active IPOs match the selected filters.';
  const compareFinancialLabels = [...new Set(compareIpos.flatMap((ipo) => financialEntries(ipo.financials).map(([label]) => label)))];

  return (
    <div className="page ipo-page">
      <header className="ipo-hero">
        <div className="ipo-hero-copy">
          <div className="ipo-hero-eyebrow">
            <span className="ipo-hero-eyebrow-dot" />
            <span>PRIMARY MARKET</span>
            <span className="ipo-hero-eyebrow-divider" />
            <span>INDIA IPO CALENDAR</span>
          </div>
          <h1>IPO <span>Calendar</span></h1>
          <p>Track live open and upcoming IPOs, subscription figures, and important issue dates. Listings refresh automatically.</p>
          <div className="ipo-hero-stats">
            <div className="ipo-hero-stat">
              <span className="ipo-hero-stat-icon is-open"><Building2 size={17} /></span>
              <span><strong>{totalOpen}</strong><small>Open now</small></span>
            </div>
            <div className="ipo-hero-stat">
              <span className="ipo-hero-stat-icon is-upcoming"><CalendarDays size={17} /></span>
              <span><strong>{totalUpcoming}</strong><small>Upcoming</small></span>
            </div>
            <div className="ipo-hero-updated">Updated <strong>{updatedLabel}</strong></div>
          </div>
        </div>

        <div className="ipo-hero-visual" aria-hidden="true">
          <span className="ipo-hero-orbit ipo-hero-orbit-outer" />
          <span className="ipo-hero-orbit ipo-hero-orbit-inner" />
          <div className="ipo-hero-emblem"><TrendingUp size={38} strokeWidth={1.8} /></div>
          <div className="ipo-hero-summary-card">
            <span className="ipo-hero-summary-label">ACTIVE CALENDAR</span>
            <strong>{ipos.length}<small> issues</small></strong>
            <span className="ipo-hero-summary-note"><span /> Open + upcoming</span>
          </div>
          <span className={`ipo-live-pill ${feed.live ? 'is-live' : 'is-demo'}`}>
            <span className="live-dot" />{sourceLabel}<ArrowUpRight size={14} />
          </span>
        </div>
      </header>

      <div className={`ipo-feed-notice ${feed.live ? 'is-connected' : ''}`} role="status">
        <div>
          <strong>{feed.loading ? 'Connecting to live IPO data' : feed.live ? 'Live IPO feed connected' : feed.stale ? 'Showing last successful IPO update' : 'Live IPO feed unavailable'}</strong>
          <p>{feedDescription}</p>
        </div>
        <span>{feed.source === 'nse' ? 'NSE INDIA' : feed.source === 'upstox' ? 'UPSTOX' : feed.configured ? 'UPSTOX ERROR' : 'SETUP'}</span>
      </div>

      <section className="ipo-alert-center" aria-labelledby="ipo-alerts-heading">
        <div className="ipo-alert-center-copy">
          <span className="ipo-alert-icon"><BellRing size={17} /></span>
          <div>
            <strong id="ipo-alerts-heading">IPO date reminders</strong>
            <p>Enable browser alerts, then select “Alert me” on an IPO for opening, closing, allotment and listing dates.</p>
          </div>
        </div>
        <div className="ipo-alert-center-actions">
          <span>{ipoAlerts.alertIpos.length} IPO{ipoAlerts.alertIpos.length === 1 ? '' : 's'} selected</span>
          <button type="button" onClick={ipoAlerts.enableBrowserAlerts}>
            {ipoAlerts.permission === 'granted' ? 'Browser alerts enabled' : 'Enable browser alerts'}
          </button>
        </div>
        {(ipoAlerts.message || ipoAlerts.permission === 'denied' || ipoAlerts.permission === 'unsupported') && (
          <p className="ipo-alert-status" role="status">
            {ipoAlerts.message || (ipoAlerts.permission === 'denied'
              ? 'Browser alerts are blocked in site settings.'
              : 'This browser does not support notifications.')}
          </p>
        )}
        <p className="ipo-alert-delivery-note">Browser reminders run while this page is open. Email and background push delivery need a secure notification service, which is not configured.</p>
      </section>

      <nav className="ipo-status-tabs" aria-label="IPO status">
        {statusTabs.map((tab) => {
          const count = tab.key === 'tracked'
            ? trackedIpos.length
            : tab.key === 'applications'
              ? applications.orders.length
              : tab.key === 'closed'
                ? history.length
              : ipos.filter((ipo) => matchesStatus(ipo, tab.key)).length;
          return (
            <button
              className={activeStatus === tab.key ? 'active' : ''}
              key={tab.key}
              type="button"
              onClick={() => setActiveStatus(tab.key)}
            >
              {tab.label}<small>{count}</small>
            </button>
          );
        })}
      </nav>

      <section className="ipo-list-controls">
        <div className="ipo-list-control-search">
          <label className="ipo-search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by company name..." />
          </label>
          <div className="ipo-segment-filters" aria-label="IPO segment">
            {['Mainboard', 'SME'].map((segment) => (
              <label key={segment}>
                <input
                  type="checkbox"
                  checked={selectedSegments.includes(segment)}
                  onChange={() => toggleSegment(segment)}
                />
                <span>{segment}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="ipo-sort-control">
          <SlidersHorizontal size={18} />
          <span>Sort By</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort IPOs">
            <option value="latest">Opening date (latest)</option>
            <option value="closing">Closing soon</option>
            <option value="company">Company (A-Z)</option>
            <option value="gmp">GMP (High to Low)</option>
            <option value="subscription">Subscription (High to Low)</option>
            <option value="issue-size">Issue size (High to Low)</option>
          </select>
        </label>

        <details className="ipo-advanced-filters">
          <summary>Price, issue size & listing date {activeFilterCount > 0 && <span>{activeFilterCount} active</span>}</summary>
          <div className="ipo-advanced-filter-grid">
            <label>Price band from (₹)
              <input type="number" min="0" step="0.01" value={filters.priceMin} onChange={(event) => setFilters((current) => ({ ...current, priceMin: event.target.value }))} placeholder="Any" />
            </label>
            <label>Price band to (₹)
              <input type="number" min="0" step="0.01" value={filters.priceMax} onChange={(event) => setFilters((current) => ({ ...current, priceMax: event.target.value }))} placeholder="Any" />
            </label>
            <label>Issue size minimum
              <input type="number" min="0" step="any" value={filters.issueMin} onChange={(event) => setFilters((current) => ({ ...current, issueMin: event.target.value }))} placeholder="Any" />
            </label>
            <label>Issue size maximum
              <input type="number" min="0" step="any" value={filters.issueMax} onChange={(event) => setFilters((current) => ({ ...current, issueMax: event.target.value }))} placeholder="Any" />
            </label>
            <label>Listing date from
              <input type="date" value={filters.listingFrom} onChange={(event) => setFilters((current) => ({ ...current, listingFrom: event.target.value }))} />
            </label>
            <label>Listing date to
              <input type="date" value={filters.listingTo} onChange={(event) => setFilters((current) => ({ ...current, listingTo: event.target.value }))} />
            </label>
          </div>
          <div className="ipo-advanced-filter-footer">
            <p>Price bands are matched by overlap. Issue-size values use the unit supplied by the feed.</p>
            <button type="button" onClick={() => {
              setFilters({ priceMin: '', priceMax: '', issueMin: '', issueMax: '', listingFrom: '', listingTo: '' });
              setQuery('');
              setSelectedSegments(['Mainboard', 'SME']);
              setSort('latest');
            }}>Clear filters</button>
          </div>
        </details>
      </section>

      {compareIpos.length > 0 && (
        <section className="ipo-compare-panel" aria-labelledby="ipo-compare-heading">
          <div className="ipo-compare-heading">
            <div>
              <span>SIDE-BY-SIDE REVIEW · {compareIpos.length}/3</span>
              <h2 id="ipo-compare-heading">Compare IPOs</h2>
            </div>
            <button type="button" onClick={() => setCompareIds([])}>
              <X size={16} /> Clear comparison
            </button>
          </div>
          <div className="ipo-compare-table-wrap">
            <table className="ipo-compare-table">
              <thead>
                <tr>
                  <th scope="col">Issue detail</th>
                  {compareIpos.map((ipo) => (
                    <th scope="col" key={ipo.id}>
                      <span>{ipo.company}</span>
                      <button type="button" aria-label={`Remove ${ipo.company} from comparison`} onClick={() => toggleCompare(ipo)}>
                        <X size={15} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Status', (ipo) => labelStatus(ipo.status)],
                  ['Segment', (ipo) => ipo.segment || 'Mainboard'],
                  ['Industry', (ipo) => ipo.industry],
                  ['Price band', (ipo) => ipo.priceBand],
                  ['Lot size', (ipo) => ipo.lotSize ? `${Number(ipo.lotSize).toLocaleString('en-IN')} shares` : 'Not reported'],
                  ['Minimum investment', (ipo) => ipo.minInvestment],
                  ['Issue size', (ipo) => ipo.issueSize],
                  ['Fresh issue', (ipo) => ipo.freshIssue],
                  ['Offer for sale (OFS)', (ipo) => ipo.offerForSale],
                  ['Subscription', (ipo) => ipo.subscription],
                  ['GMP (unofficial)', (ipo) => ipo.gmpValue || ipo.gmp],
                  ['Opens', (ipo) => ipo.openDate],
                  ['Closes', (ipo) => ipo.closeDate],
                  ['Allotment', (ipo) => ipo.allotmentDate],
                  ['Listing', (ipo) => ipo.listingDate],
                  ['Listing price', (ipo) => ipo.listingPrice == null ? '' : `₹${Number(ipo.listingPrice).toLocaleString('en-IN')}`],
                  ['Listing return', (ipo) => ipo.listingGainPercent == null ? '' : `${Number(ipo.listingGainPercent).toFixed(2)}%`],
                  ['Return since issue', (ipo) => ipo.gainFromIssuePercent == null ? '' : `${Number(ipo.gainFromIssuePercent).toFixed(2)}%`],
                  ['Provider rating', (ipo) => ipo.rating],
                  ['Provider recommendation', (ipo) => ipo.recommendation],
                  ['Competitors', (ipo) => ipo.competitors],
                ].map(([label, readValue]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {compareIpos.map((ipo) => (
                      <td key={ipo.id}>{displayMetric(readValue(ipo))}</td>
                    ))}
                  </tr>
                ))}
                {compareFinancialLabels.map((label) => (
                  <tr key={`financial-${label}`}>
                    <th scope="row">Financial · {label}</th>
                    {compareIpos.map((ipo) => (
                      <td key={ipo.id}>{displayMetric(financialEntries(ipo.financials).find(([key]) => key === label)?.[1])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Figures come from the IPO feed. GMP is unofficial; “Not reported” means the provider did not supply that field.</p>
        </section>
      )}

      <div className="section-heading ipo-results-heading">
        <h2>{activeStatus === 'all' ? 'All Active IPOs' : activeStatus === 'closed' ? 'Listed & Closed IPOs' : statusTabs.find((tab) => tab.key === activeStatus).label}</h2>
        <span>{activeStatus === 'applications'
          ? `${applications.orders.length} applications`
          : activeStatus === 'closed' && pageIpos.length
            ? `${currentHistoryPage * historyPageSize + 1}–${Math.min((currentHistoryPage + 1) * historyPageSize, pageIpos.length)} of ${pageIpos.length}`
            : `${pageIpos.length} shown`}</span>
      </div>

      {activeStatus === 'applications' ? (
        <section className="ipo-applications-list" aria-live="polite">
          {applications.loading ? (
            <div className="panel ipo-empty">Loading your Upstox application status…</div>
          ) : !applications.configured ? (
            <div className="panel ipo-empty">
              <strong>Secure Upstox login is not configured.</strong>
              <p>{applications.error}</p>
            </div>
          ) : !applications.connected ? (
            <div className="panel ipo-empty">
              <strong>Connect your Upstox account to track applications.</strong>
              <p>Login uses Upstox’s secure authorization screen. The app never stores your Upstox password.</p>
              {applications.error && <p className="ipo-detail-refresh-note" role="status">{applications.error}</p>}
              <button className="ipo-apply-button" type="button" onClick={() => marketApi.connectIpoBroker('/ipo?ipo_view=applications')}>
                {applications.error ? 'Reconnect Upstox' : 'Connect Upstox'}
              </button>
            </div>
          ) : applications.orders.length ? (
            <div className="ipo-application-cards">
              {applications.orders.map((order) => (
                <article className="panel ipo-application-card" key={order.order_id}>
                  <div className="ipo-application-card-heading">
                    <div>
                      <h3>{order.name || order.company || order.id || order.symbol || 'IPO application'}</h3>
                      <span>Application {order.order_id} · {String(order.issue_type || '').toUpperCase()}</span>
                    </div>
                    <strong className="ipo-application-status">{labelStatus(order.status)}</strong>
                  </div>
                  <div className="ipo-application-details">
                    <span>UPI mandate <b>{labelStatus(order.payment_status)}</b></span>
                    <span>Exchange status <b>{labelStatus(order.order_status)}</b></span>
                    <span>Amount blocked <b>{formatRupees(order.upi_amount_blocked)}</b></span>
                    <span>Allotted shares <b>{Number(order.units_allotted || 0).toLocaleString('en-IN')}</b></span>
                    <span>UPI ID <b>{maskUpi(order.upi)}</b></span>
                    <span>Last updated <b>{order.last_updated_at || order.created_at || '—'}</b></span>
                  </div>
                  {order.reason && <p className="ipo-application-reason">{order.reason}</p>}
                  {Array.isArray(order.bids) && <p className="ipo-application-bids">{order.bids.map((bid) => `${Number(bid.quantity).toLocaleString('en-IN')} shares @ ${formatRupees(bid.price)}`).join(' · ')}</p>}
                </article>
              ))}
            </div>
          ) : (
            <div className="panel ipo-empty">No IPO applications were found on this Upstox account.</div>
          )}
          {applications.error && applications.connected && <p className="ipo-detail-refresh-note" role="status">{applications.error}</p>}
          {applications.connected && <div className="ipo-application-footer">
            <p className="ipo-application-refresh-note">Application statuses refresh automatically every 30 seconds.</p>
            <button type="button" className="ipo-track-button" onClick={() => applications.disconnect().catch(() => {})}>Disconnect Upstox</button>
          </div>}
        </section>
      ) : activeStatus === 'all' && !query && pageIpos.length > 0 ? (
        <div style={{ display: 'grid', gap: '36px' }}>
          {openIpos.length > 0 && (
            <section>
              <div className="ipo-group-heading">
                <span className="ipo-group-icon is-open"><Building2 size={17} /></span>
                <h3>Open IPOs</h3>
                <span className="ipo-group-count is-open">
                  {openIpos.length} Active
                </span>
              </div>
              <div className="ipo-list">
                {openIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} isTracked={isTracked(ipo.id)} onToggleTracked={toggleTrackedIpo} isCompared={isCompared(ipo)} compareDisabled={compareIds.length >= 3 && !isCompared(ipo)} onToggleCompare={toggleCompare} isAlerted={ipoAlerts.isAlerted(ipo.id)} onToggleAlert={ipoAlerts.toggleAlert} />)}
              </div>
            </section>
          )}

          {upcomingIpos.length > 0 && (
            <section>
              <div className="ipo-group-heading">
                <span className="ipo-group-icon is-upcoming"><CalendarDays size={17} /></span>
                <h3>Upcoming IPOs</h3>
                <span className="ipo-group-count is-upcoming">
                  {upcomingIpos.length} Upcoming
                </span>
              </div>
              <div className="ipo-list">
                {upcomingIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} isTracked={isTracked(ipo.id)} onToggleTracked={toggleTrackedIpo} isCompared={isCompared(ipo)} compareDisabled={compareIds.length >= 3 && !isCompared(ipo)} onToggleCompare={toggleCompare} isAlerted={ipoAlerts.isAlerted(ipo.id)} onToggleAlert={ipoAlerts.toggleAlert} />)}
              </div>
            </section>
          )}
        </div>
      ) : pageIpos.length ? (
        <>
          <div className="ipo-list">
            {visibleIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} isTracked={isTracked(ipo.id)} onToggleTracked={toggleTrackedIpo} isCompared={isCompared(ipo)} compareDisabled={compareIds.length >= 3 && !isCompared(ipo)} onToggleCompare={toggleCompare} isAlerted={ipoAlerts.isAlerted(ipo.id)} onToggleAlert={ipoAlerts.toggleAlert} />)}
          </div>
          {activeStatus === 'closed' && historyPageCount > 1 && (
            <nav className="ipo-history-pagination" aria-label="Listed and closed IPO pages">
              <button type="button" onClick={() => setHistoryPage((page) => Math.max(0, page - 1))} disabled={currentHistoryPage === 0}>Previous</button>
              <span>Page {currentHistoryPage + 1} of {historyPageCount}</span>
              <button type="button" onClick={() => setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1))} disabled={currentHistoryPage >= historyPageCount - 1}>Next</button>
            </nav>
          )}
        </>
      ) : (
        <section className="panel ipo-empty" role="status">
          {activeStatus === 'tracked' && !feed.loading
            ? 'No IPOs tracked yet. Use the bookmark button on any IPO to follow its status.'
            : emptyMessage}
        </section>
      )}
    </div>
  );
};

export default IPO;
