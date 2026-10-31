import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Building2, CalendarDays, Search, SlidersHorizontal, TrendingUp } from 'lucide-react';
import IpoCard from '../components/IpoCard';
import { useIpoFeed } from '../hooks/useIpoFeed';
import { useIpoApplications } from '../hooks/useIpoApplications';
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
  const allKnownIpos = [...ipos, ...(feed.history || [])];
  const { trackedIpos, toggleTrackedIpo, isTracked } = useTrackedIpos();
  const applications = useIpoApplications(activeStatus === 'applications');
  const trackedItems = trackedIpos
    .map((tracked) => allKnownIpos.find((ipo) => ipo.id === tracked.id)
      || { ...tracked, status: tracked.status || 'Tracking', segment: tracked.segment || 'Mainboard', isLive: false, stale: true });
  const [selectedSegments, setSelectedSegments] = useState(['Mainboard', 'SME']);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('latest');
  const [historyPage, setHistoryPage] = useState(0);

  useEffect(() => setHistoryPage(0), [activeStatus, query, selectedSegments, sort]);

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
      return (activeStatus === 'tracked'
        ? isTracked(ipo.id)
        : matchesStatus(ipo, activeStatus))
        && selectedSegments.includes(segment)
        && (!term || ipo.company.toLowerCase().includes(term));
    });

    return [...result].sort((first, second) => {
      if (sort === 'company') return first.company.localeCompare(second.company);
      if (sort === 'subscription') return Number.parseFloat(second.subscription) - Number.parseFloat(first.subscription);
      return 0;
    });
  }, [activeStatus, history, ipos, isTracked, query, selectedSegments, sort]);

  const pageIpos = activeStatus === 'tracked'
    ? trackedItems.filter((ipo) => {
      const segment = ipo.segment || 'Mainboard';
      const term = query.trim().toLowerCase();
      return selectedSegments.includes(segment) && (!term || ipo.company.toLowerCase().includes(term));
    })
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
            <option value="latest">Latest</option>
            <option value="company">Company (A-Z)</option>
            <option value="subscription">Subscription (High to Low)</option>
          </select>
        </label>
      </section>

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
                {openIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} isTracked={isTracked(ipo.id)} onToggleTracked={toggleTrackedIpo} />)}
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
                {upcomingIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} isTracked={isTracked(ipo.id)} onToggleTracked={toggleTrackedIpo} />)}
              </div>
            </section>
          )}
        </div>
      ) : pageIpos.length ? (
        <>
          <div className="ipo-list">
            {visibleIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} isTracked={isTracked(ipo.id)} onToggleTracked={toggleTrackedIpo} />)}
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
