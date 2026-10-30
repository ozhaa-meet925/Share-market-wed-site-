import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Building2, CalendarDays, Search, SlidersHorizontal, TrendingUp } from 'lucide-react';
import IpoCard from '../components/IpoCard';
import { ipos as defaultIpos } from '../data/ipo';
import { marketApi } from '../services/api';

const IPO_REFRESH_MS = 60_000;
const statusTabs = [
  { key: 'open', label: 'OPEN' },
  { key: 'upcoming', label: 'UPCOMING' },
  { key: 'all', label: 'ALL ACTIVE' },
];

const matchesStatus = (ipo, status) => {
  const currentStatus = String(ipo.status || '').toLowerCase();
  if (status === 'all') return ['open', 'upcoming', 'open soon'].includes(currentStatus);
  if (status === 'upcoming') return ['upcoming', 'open soon'].includes(currentStatus);
  return currentStatus === 'open';
};

const IPO = () => {
  const [ipos, setIpos] = useState(() => defaultIpos.filter((ipo) => matchesStatus(ipo, 'all')));
  const [feed, setFeed] = useState({
    source: 'demo',
    live: false,
    configured: false,
    lastUpdated: null,
    message: 'Loading IPO data…',
  });
  const [activeStatus, setActiveStatus] = useState('open');
  const [selectedSegments, setSelectedSegments] = useState(['Mainboard', 'SME']);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('latest');

  useEffect(() => {
    let active = true;

    const fetchIpos = async () => {
      try {
        const response = await marketApi.getIpos();
        if (!response?.success || !Array.isArray(response.data)) throw new Error('Invalid IPO feed response');
        if (!active) return;
        setIpos(response.data);
        setFeed(response);
      } catch {
        if (active) {
          setFeed({
            source: 'demo',
            live: false,
            configured: false,
            lastUpdated: null,
            message: 'The IPO API server is unavailable. Showing sample IPO data.',
          });
        }
      }
    };

    fetchIpos();
    const interval = setInterval(fetchIpos, IPO_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const toggleSegment = (segment) => {
    setSelectedSegments((current) => (
      current.includes(segment)
        ? current.filter((item) => item !== segment)
        : [...current, segment]
    ));
  };

  const filteredIpos = useMemo(() => {
    const term = query.trim().toLowerCase();
    const result = ipos.filter((ipo) => {
      const segment = ipo.segment || 'Mainboard';
      return matchesStatus(ipo, activeStatus)
        && selectedSegments.includes(segment)
        && (!term || ipo.company.toLowerCase().includes(term));
    });

    return [...result].sort((first, second) => {
      if (sort === 'company') return first.company.localeCompare(second.company);
      if (sort === 'subscription') return Number.parseFloat(second.subscription) - Number.parseFloat(first.subscription);
      return 0;
    });
  }, [activeStatus, ipos, query, selectedSegments, sort]);

  const openIpos = filteredIpos.filter((ipo) => String(ipo.status).toLowerCase() === 'open');
  const upcomingIpos = filteredIpos.filter((ipo) => ['upcoming', 'open soon'].includes(String(ipo.status).toLowerCase()));
  const totalOpen = ipos.filter((ipo) => String(ipo.status).toLowerCase() === 'open').length;
  const totalUpcoming = ipos.filter((ipo) => ['upcoming', 'open soon'].includes(String(ipo.status).toLowerCase())).length;
  const updatedLabel = feed.lastUpdated
    ? new Date(feed.lastUpdated).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '—';
  const sourceLabel = feed.source === 'upstox'
    ? (feed.live ? 'Upstox Live API' : 'Upstox Cached Feed')
    : 'Demo IPO Data';
  const feedDescription = feed.source === 'upstox'
    ? `${feed.message || 'IPO feed refreshes automatically every minute.'} New open/upcoming IPOs appear automatically; closed/listed IPOs leave the active list when Upstox updates their status.`
    : `${feed.message || 'Showing sample IPO records.'} Sample data does not auto-update from the exchange. Add UPSTOX_ACCESS_TOKEN to the server .env file and restart the app for automatic updates.`;

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
          <p>Find current and upcoming public issues, compare their key details, and keep track of important dates.</p>
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

      <div className={`ipo-feed-notice ${feed.source === 'upstox' ? 'is-connected' : 'is-demo'}`} role="status">
        <div>
          <strong>{feed.source === 'upstox' ? 'IPO feed connected to Upstox' : 'Showing demo IPO data'}</strong>
          <p>{feedDescription}</p>
        </div>
        <span>{feed.source === 'upstox' ? 'UPSTOX' : 'SAMPLE'}</span>
      </div>

      <nav className="ipo-status-tabs" aria-label="IPO status">
        {statusTabs.map((tab) => {
          const count = ipos.filter((ipo) => matchesStatus(ipo, tab.key)).length;
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
        <h2>{activeStatus === 'all' ? 'All Active IPOs' : statusTabs.find((tab) => tab.key === activeStatus).label}</h2>
        <span>{filteredIpos.length} shown</span>
      </div>

      {activeStatus === 'all' && !query ? (
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
                {openIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} />)}
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
                {upcomingIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} />)}
              </div>
            </section>
          )}
        </div>
      ) : filteredIpos.length ? (
        <div className="ipo-list">
          {filteredIpos.map((ipo) => <IpoCard key={ipo.id || ipo.company} ipo={ipo} />)}
        </div>
      ) : (
        <section className="panel ipo-empty">No active IPOs match the selected filters.</section>
      )}
    </div>
  );
};

export default IPO;
