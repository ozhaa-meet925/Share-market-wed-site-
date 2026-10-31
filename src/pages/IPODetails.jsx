import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bell, BellRing, Bookmark, Building2, CalendarDays, CheckCircle2, CircleDollarSign, FileText, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { marketApi } from '../services/api';
import { useIpoAlerts } from '../hooks/useIpoAlerts';
import { useTrackedIpos } from '../hooks/useTrackedIpos';

const detailRows = [
  ['Price band', 'priceBand'],
  ['Lot size', 'lotSize'],
  ['Issue size', 'issueSize'],
  ['Fresh issue', 'freshIssue'],
  ['Offer for sale (OFS)', 'offerForSale'],
  ['Face value', 'faceValue'],
  ['Minimum investment', 'minInvestment'],
  ['Overall Subscription', 'subscription'],
  ['GMP', 'gmp'],
];

const IPO_REFRESH_MS = 60_000;
const formatUpdatedTime = (value) => value
  ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  : '—';
const displayDate = (value) => {
  if (!value || value === '—') return '—';
  return /\b20\d{2}\b/.test(value) ? value : `${value} ${new Date().getFullYear()}`;
};
const formatFactLabel = (value) => String(value).replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (letter) => letter.toUpperCase());
const factEntries = (value) => {
  if (Array.isArray(value)) return value.map((item, index) => [String(index + 1), item]);
  if (value && typeof value === 'object') return Object.entries(value);
  if (typeof value === 'string' && value.trim()) return [['Details', value]];
  return [];
};
const formatFactValue = (value) => {
  if (value == null || value === '') return 'Not provided by the IPO data provider';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
const disclosureItems = (value) => {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : formatFactValue(item));
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
};
const toIpoDateKey = (value) => {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (!raw || /^(—|not provided|n\/a)$/i.test(raw)) return '';
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(timestamp))
    : '';
};
const escapeCalendarText = (value) => String(value || '')
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,');
const foldCalendarLine = (line) => {
  const folded = [];
  let current = '';
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      folded.push(current);
      current = ` ${character}`;
      bytes = 1 + size;
    } else {
      current += character;
      bytes += size;
    }
  }
  folded.push(current);
  return folded.join('\r\n');
};
const getFutureCalendarEvents = (ipo) => {
  if (!ipo) return [];
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return [
    ['openDate', 'Issue opens'],
    ['closeDate', 'Issue closes'],
    ['allotmentDate', 'Allotment date'],
    ['listingDate', 'Listing date'],
  ].map(([field, title]) => ({ field, title, date: toIpoDateKey(ipo[field]) }))
    .filter((event) => event.date && event.date >= today);
};
const toIcsDate = (dateKey) => dateKey.replaceAll('-', '');
const nextIcsDate = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return toIcsDate(date.toISOString().slice(0, 10));
};

const IPODetails = () => {
  const { company } = useParams();
  const decodedName = decodeURIComponent(company || '');
  const [ipo, setIpo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState('');
  const [brokerState, setBrokerState] = useState({ configured: false, connected: false });
  const [applyOpen, setApplyOpen] = useState(false);
  const [upi, setUpi] = useState('');
  const [lots, setLots] = useState(1);
  const [category, setCategory] = useState('IND');
  const [bidPrice, setBidPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [applicationResult, setApplicationResult] = useState(null);
  const [calendarMessage, setCalendarMessage] = useState('');
  const { isTracked, toggleTrackedIpo } = useTrackedIpos();
  const notificationIpos = useMemo(() => (ipo ? [ipo] : []), [ipo]);
  const ipoAlerts = useIpoAlerts(notificationIpos);
  const calendarEvents = useMemo(() => getFutureCalendarEvents(ipo), [ipo]);

  const downloadIpoCalendar = () => {
    if (!ipo || calendarEvents.length === 0) {
      setCalendarMessage('No future IPO dates are available from the provider to export.');
      return;
    }

    const timeStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const sourceUrl = ipo.sourceUrl || `${window.location.origin}${window.location.pathname}`;
    const events = calendarEvents.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${String(ipo.id || decodedName).replace(/[^a-zA-Z0-9-]/g, '-')}-${event.field}-${event.date}@sharemarket.app`,
      `DTSTAMP:${timeStamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(event.date)}`,
      `DTEND;VALUE=DATE:${nextIcsDate(event.date)}`,
      `SUMMARY:${escapeCalendarText(`${ipo.company || 'IPO'} · ${event.title}`)}`,
      `DESCRIPTION:${escapeCalendarText(`Provider-reported IPO date. Review the latest issue details at ${sourceUrl}`)}`,
      `URL:${sourceUrl}`,
      'END:VEVENT',
    ]);
    const calendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ShareMarket//IPO Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      ...events,
      'END:VCALENDAR',
      '',
    ].map(foldCalendarLine).join('\r\n');
    const blob = new Blob([calendar], { type: 'text/calendar;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileName = String(ipo.company || 'ipo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    link.href = downloadUrl;
    link.download = `${fileName || 'ipo'}-dates.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setCalendarMessage(`${calendarEvents.length} provider-reported date${calendarEvents.length === 1 ? '' : 's'} added to the calendar file.`);
  };

  useEffect(() => {
    let active = true;
    setIpo(null);
    setLoading(true);
    setDetailError('');
    setCalendarMessage('');

    const fetchLiveDetails = async () => {
      try {
        const live = await marketApi.getIpoDetails(decodedName);
        if (active && live) {
          setIpo(live);
          setDetailError('');
          setLoading(false);
        }
      } catch (error) {
        if (active) {
          setDetailError(error.message || 'Could not load live IPO details.');
          setIpo((current) => current ? { ...current, isLive: false, stale: true } : null);
          setLoading(false);
        }
      }
    };

    fetchLiveDetails();
    const interval = setInterval(fetchLiveDetails, IPO_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [decodedName]);

  useEffect(() => {
    let active = true;
    marketApi.getIpoAuthStatus().then((state) => {
      if (!active) return;
      setBrokerState(state);
      const authResult = new URLSearchParams(window.location.search).get('ipo_auth');
      if (authResult === 'connected') setApplyOpen(true);
      if (authResult) {
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ipo) return;
    const minimumLots = ipo.lotSize && ipo.minimumQuantity
      ? Math.max(1, Math.ceil(ipo.minimumQuantity / ipo.lotSize))
      : 1;
    setLots(minimumLots);
    setBidPrice(String(ipo.cutOffPrice || ipo.maximumPrice || ipo.minimumPrice || ''));
  }, [ipo?.id]);

  const startBrokerLogin = () => {
    if (!brokerState.configured) return;
    marketApi.connectIpoBroker(`${window.location.pathname}#apply`);
  };

  const submitApplication = async (event) => {
    event.preventDefault();
    if (!ipo?.id || !brokerState.connected || submitting) return;
    const quantity = Number(ipo.lotSize) * Number(lots);
    const amount = quantity * Number(bidPrice);
    const confirmed = window.confirm(
      `Submit ${ipo.company} IPO application to Upstox?\n\n${quantity.toLocaleString('en-IN')} shares at ₹${Number(bidPrice).toLocaleString('en-IN')}\nMaximum mandate amount: ₹${amount.toLocaleString('en-IN')}\nUPI: ${upi}\n\nUpstox will request a UPI mandate. You must separately approve it in your UPI app.`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    setApplicationResult(null);
    try {
      const result = await marketApi.applyIpo({
        id: ipo.id,
        upi,
        category,
        lots: Number(lots),
        price: Number(bidPrice),
      });
      setApplicationResult({ success: true, ...result });
    } catch (error) {
      if (error.status === 401) setBrokerState((current) => ({ ...current, connected: false }));
      setApplicationResult({ success: false, message: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !ipo) {
    return (
      <div className="page ipo-page ipo-detail-page">
        <Link className="back-link ipo-detail-back" to="/ipo"><ArrowLeft size={18} /> Back to IPOs</Link>
        <section className="panel ipo-detail-empty" role="status">Loading live IPO details…</section>
      </div>
    );
  }

  if (!ipo) {
    return (
      <div className="page ipo-page ipo-detail-page">
        <Link className="back-link ipo-detail-back" to="/ipo"><ArrowLeft size={18} /> Back to IPOs</Link>
        <section className="panel ipo-detail-empty">
          <h1>Live IPO details unavailable</h1>
          <p>{detailError || 'This issue is no longer in the current open/upcoming IPO feed.'}</p>
        </section>
      </div>
    );
  }

  const currentIpo = ipo;
  const statusClass = `ipo-status-${(currentIpo.status || 'open').toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="page ipo-page ipo-detail-page">
      <Link className="back-link ipo-detail-back" to="/ipo"><ArrowLeft size={18} /> Back to IPOs</Link>

      <section className="ipo-detail-hero">
        <div>
          <span className="ipo-detail-kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {currentIpo.isLive && currentIpo.status === 'Open' && <span className="live-dot" style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#00D09C' }} />}
            {currentIpo.segment || 'Mainboard'} IPO · {currentIpo.source === 'nse' ? 'NSE India' : currentIpo.isLive ? 'Upstox Live API' : 'Last provider update'}
          </span>
          <h1>{currentIpo.company}</h1>
          <p>{currentIpo.status === 'Listed'
            ? `Listing information from the official ${currentIpo.source === 'nse' ? 'NSE India' : 'IPO'} tracker. Updated ${formatUpdatedTime(currentIpo.lastUpdate)}.`
            : `Issue status, subscription figures, and important dates refresh from the IPO provider. Updated ${formatUpdatedTime(currentIpo.lastUpdate)}.`}</p>
        </div>
        <span className={`status-badge ${statusClass}`}>{currentIpo.status}</span>
      </section>
      {detailError && <p className="ipo-detail-refresh-note" role="status">{detailError} Showing the last successful update.</p>}

      <div className="ipo-detail-primary-actions">
        <button
          className={`ipo-track-button${isTracked(currentIpo.id) ? ' is-tracked' : ''}`}
          type="button"
          aria-pressed={isTracked(currentIpo.id)}
          onClick={() => toggleTrackedIpo(currentIpo)}
        >
          <Bookmark size={17} fill={isTracked(currentIpo.id) ? 'currentColor' : 'none'} />
          {isTracked(currentIpo.id) ? 'Tracking this IPO' : 'Track this IPO'}
        </button>
        <button
          className={`ipo-track-button${ipoAlerts.isAlerted(currentIpo.id) ? ' is-tracked' : ''}`}
          type="button"
          aria-pressed={ipoAlerts.isAlerted(currentIpo.id)}
          onClick={() => ipoAlerts.toggleAlert(currentIpo)}
        >
          {ipoAlerts.isAlerted(currentIpo.id) ? <BellRing size={17} /> : <Bell size={17} />}
          {ipoAlerts.isAlerted(currentIpo.id) ? 'Date alerts on' : 'Remind me'}
        </button>
        <button
          className="ipo-calendar-download"
          type="button"
          onClick={downloadIpoCalendar}
          disabled={calendarEvents.length === 0}
          title={calendarEvents.length ? 'Download future IPO dates as a calendar file' : 'No future dates are available from the provider'}
        >
          <CalendarDays size={17} />
          Add to calendar
        </button>
        {currentIpo.status === 'Open' && currentIpo.source === 'upstox' && currentIpo.isLive === true && (
          <button id="apply" className="ipo-apply-button" type="button" onClick={() => setApplyOpen((open) => !open)}>
            {applyOpen ? 'Close application' : 'Apply via Upstox'}
          </button>
        )}
        <Link className="ipo-view-button" to="/ipo?ipo_view=applications">My applications</Link>
      </div>
      {(calendarMessage || calendarEvents.length === 0) && (
        <p className="ipo-calendar-message" role="status">
          {calendarMessage || 'No future IPO dates are available from the provider to export.'}
        </p>
      )}

      <section className="panel ipo-detail-panel ipo-company-overview">
        <div className="section-heading">
          <div>
            <span className="ipo-detail-kicker">Company profile</span>
            <h2>Company overview</h2>
          </div>
          <Building2 size={22} />
        </div>
        <p>{currentIpo.companyOverview
          ? formatFactValue(currentIpo.companyOverview)
          : 'A company overview was not included in this live IPO feed. Open the official prospectus for issuer background.'}</p>
      </section>

      {applyOpen && currentIpo.status === 'Open' && currentIpo.source === 'upstox' && currentIpo.isLive === true && (
        <section className="panel ipo-detail-panel ipo-apply-panel" aria-labelledby="ipo-apply-heading">
          <div className="section-heading">
            <div>
              <span className="ipo-detail-kicker">Upstox IPO application</span>
              <h2 id="ipo-apply-heading">Review your bid</h2>
            </div>
            <CircleDollarSign size={22} />
          </div>
          {brokerState.connected ? (
            <form className="ipo-apply-form" onSubmit={submitApplication}>
              <label>UPI ID
                <input value={upi} onChange={(event) => setUpi(event.target.value)} autoComplete="off" required placeholder="name@bank" />
              </label>
              <label>Investor category
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {(currentIpo.investors?.length
                    ? currentIpo.investors.map((investor) => String(investor.category).toUpperCase())
                    : ['IND', 'HNI'])
                    .filter((value, index, values) => values.indexOf(value) === index)
                    .filter((value) => ['IND', 'HNI'].includes(value))
                    .map((value) => <option key={value} value={value}>{value === 'IND' ? 'Individual' : 'HNI'}</option>)}
                </select>
              </label>
              <label>Lots
                <input type="number" min={1} max={100} step={1} value={lots} onChange={(event) => setLots(event.target.value)} required />
              </label>
              <label>Bid price per share (₹)
                <input type="number" min={currentIpo.minimumPrice || undefined} max={currentIpo.maximumPrice || undefined} step="0.05" value={bidPrice} onChange={(event) => setBidPrice(event.target.value)} required />
              </label>
              <p className="ipo-apply-summary">
                Bid: {((Number(lots) || 0) * (Number(currentIpo.lotSize) || 0)).toLocaleString('en-IN')} shares ·
                Maximum mandate: ₹{(((Number(lots) || 0) * (Number(currentIpo.lotSize) || 0)) * (Number(bidPrice) || 0)).toLocaleString('en-IN')}
              </p>
              <p className="ipo-apply-disclaimer">Submitting sends this bid to Upstox. The UPI mandate will block funds only after you approve it in your UPI app. The review prompt asks you to confirm the amount before submission.</p>
              <button className="ipo-apply-button" type="submit" disabled={submitting || !upi || !Number(lots) || !Number(bidPrice)}>
                {submitting ? 'Submitting to Upstox…' : 'Review and submit application'}
              </button>
            </form>
          ) : (
            <div className="ipo-apply-connect">
              <p>{brokerState.configured
                ? 'Connect your own Upstox account using its secure login before preparing a bid.'
                : 'Set up Upstox OAuth credentials on the server to enable personal, secure applications. IPO listing access alone cannot submit bids.'}</p>
              {brokerState.configured && <button className="ipo-apply-button" type="button" onClick={startBrokerLogin}>Connect Upstox</button>}
            </div>
          )}
          {applicationResult && (
            <div className={`ipo-application-result${applicationResult.success ? ' is-success' : ' is-error'}`} role="status">
              <strong>{applicationResult.success ? `Submitted to Upstox · ${applicationResult.orderId}` : 'Application not submitted'}</strong>
              <p>{applicationResult.message}</p>
              {applicationResult.success && <Link to="/ipo?ipo_view=applications">Track application status</Link>}
            </div>
          )}
        </section>
      )}

      <div className="ipo-detail-overview">
        <article className="ipo-detail-highlight">
          <CircleDollarSign size={22} />
          <span>Price band</span>
          <strong>{currentIpo.priceBand}</strong>
        </article>
        <article className="ipo-detail-highlight">
          <CalendarDays size={22} />
          <span>Issue period</span>
          <strong>{currentIpo.openDate} - {currentIpo.closeDate}</strong>
        </article>
        <article className="ipo-detail-highlight">
          <CheckCircle2 size={22} />
          <span>{currentIpo.status === 'Listed' ? 'Return since issue' : 'Overall Subscription'}</span>
          <strong className={currentIpo.status === 'Listed' ? (Number(currentIpo.gainFromIssuePercent) >= 0 ? 'gain' : 'loss') : 'gain'}>
            {currentIpo.status === 'Listed' && currentIpo.gainFromIssuePercent != null
              ? `${Number(currentIpo.gainFromIssuePercent) > 0 ? '+' : ''}${Number(currentIpo.gainFromIssuePercent).toFixed(2)}%`
              : currentIpo.subscription}
          </strong>
        </article>
      </div>

      {currentIpo.qibFormatted && (
        <section className="panel ipo-detail-panel">
          <div className="section-heading">
            <div>
              <span className="ipo-detail-kicker">Live Bidding Breakdown</span>
              <h2>Subscription By Category</h2>
            </div>
            <Users size={22} />
          </div>
          <div className="ipo-detail-table">
            <div><span>Qualified Institutional (QIB)</span><strong className="gain">{currentIpo.qibFormatted}</strong></div>
            <div><span>Non-Institutional (NII / HNI)</span><strong className="gain">{currentIpo.niiFormatted}</strong></div>
            <div><span>Retail Individual (RII)</span><strong className="gain">{currentIpo.retailFormatted}</strong></div>
            {currentIpo.totalApplications != null && <div><span>Total Applications Received</span><strong>{Number(currentIpo.totalApplications).toLocaleString('en-IN')}</strong></div>}
          </div>
        </section>
      )}

      <section className="panel ipo-detail-panel">
        <div className="section-heading">
          <div>
            <span className="ipo-detail-kicker">IPO information</span>
            <h2>Issue details</h2>
          </div>
          <FileText size={22} />
        </div>
        <div className="ipo-detail-table">
          {detailRows.map(([label, key]) => (
            <div key={key}><span>{key === 'issueSize' ? currentIpo.issueSizeLabel || label : label}</span><strong>{currentIpo[key] || 'Not provided'}</strong></div>
          ))}
          {[
            ['Industry', currentIpo.industry],
            ['Lead manager(s)', currentIpo.leadManagers],
            ['Competitors', currentIpo.competitors],
            ['Ticker symbol', currentIpo.symbol],
            ['ISIN', currentIpo.isin],
            ['Issue segment', currentIpo.segment],
            ['Listing exchange', currentIpo.listingExchange],
            ['Minimum bid quantity', currentIpo.minimumQuantity],
            ['Daily bid window', currentIpo.dailyBidTimings],
            ['Registrar', currentIpo.registrar?.name || currentIpo.registrar?.registrar],
            ['Registrar contact', currentIpo.registrar?.contact_number],
            ['Registrar email', currentIpo.registrar?.email],
          ].filter(([, value]) => value != null && value !== '').map(([label, value]) => (
            <div key={label}><span>{label}</span><strong>{formatFactValue(value)}</strong></div>
          ))}
          {currentIpo.status === 'Listed' && [
            ['Issue price', currentIpo.minPrice],
            ['Listing day close', currentIpo.listingPrice],
            ['Current tracker price', currentIpo.currentPrice],
            ['Listing day gain', currentIpo.listingGain],
            ['Listing day return', currentIpo.listingGainPercent == null ? '' : `${Number(currentIpo.listingGainPercent).toFixed(2)}%`],
            ['Current gain from issue', currentIpo.gainFromIssue],
          ].filter(([, value]) => value != null && value !== '').map(([label, value]) => (
            <div key={label}><span>{label}</span><strong>{typeof value === 'number' ? `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : value}</strong></div>
          ))}
        </div>
      </section>

      <section className="panel ipo-detail-panel ipo-company-disclosures">
        <div className="section-heading">
          <div>
            <span className="ipo-detail-kicker">Issuer disclosures</span>
            <h2>Company financials, proceeds and risks</h2>
          </div>
          <FileText size={22} />
        </div>
        {factEntries(currentIpo.financials).length > 0 ? (
          <>
            <h3>Reported financials</h3>
            <div className="ipo-detail-table">
              {factEntries(currentIpo.financials).map(([label, value]) => (
                <div key={label}><span>{formatFactLabel(label)}</span><strong>{formatFactValue(value)}</strong></div>
              ))}
            </div>
          </>
        ) : (
          <p>Structured company financial statements are not included in this IPO feed. See the issuer’s official offer document below for audited figures.</p>
        )}
        <h3>Use of issue proceeds</h3>
        {factEntries(currentIpo.useOfProceeds).length > 0 ? (
          <div className="ipo-detail-table">
            {factEntries(currentIpo.useOfProceeds).map(([label, value]) => (
              <div key={label}><span>{formatFactLabel(label)}</span><strong>{formatFactValue(value)}</strong></div>
            ))}
          </div>
        ) : <p>Proceeds allocation is disclosed in the Red Herring Prospectus and is not supplied as structured data by the live IPO provider.</p>}
        <div className="ipo-disclosure-columns">
          <div>
            <h3>Strengths</h3>
            {disclosureItems(currentIpo.strengths).length
              ? <ul>{disclosureItems(currentIpo.strengths).map((item, index) => <li key={index}>{item}</li>)}</ul>
              : <p>Review the company overview and competitive strengths in its official prospectus.</p>}
          </div>
          <div>
            <h3>Risk factors</h3>
            {disclosureItems(currentIpo.risks).length
              ? <ul>{disclosureItems(currentIpo.risks).map((item, index) => <li key={index}>{item}</li>)}</ul>
              : <p>The provider does not return structured risk summaries. Read the risk factors in the official prospectus before applying.</p>}
          </div>
          <div>
            <h3>Weaknesses</h3>
            {disclosureItems(currentIpo.weaknesses || currentIpo.cons).length
              ? <ul>{disclosureItems(currentIpo.weaknesses || currentIpo.cons).map((item, index) => <li key={index}>{item}</li>)}</ul>
              : <p>Structured weaknesses are not included in this provider feed.</p>}
          </div>
        </div>
        <div className="ipo-prospectus-links">
          {currentIpo.prospectusUrl && <a href={currentIpo.prospectusUrl} target="_blank" rel="noreferrer">Open Red Herring Prospectus</a>}
          {currentIpo.draftProspectusUrl && <a href={currentIpo.draftProspectusUrl} target="_blank" rel="noreferrer">Open Draft Prospectus</a>}
          {currentIpo.registrar?.website && <a href={currentIpo.registrar.website} target="_blank" rel="noreferrer">Registrar website</a>}
          {currentIpo.sourceUrl && <a href={currentIpo.sourceUrl} target="_blank" rel="noreferrer">Open official {currentIpo.source === 'nse' ? 'NSE' : 'IPO'} source</a>}
          {!currentIpo.prospectusUrl && !currentIpo.draftProspectusUrl && <span>Prospectus link is not available from the provider yet.</span>}
        </div>
      </section>

      <section className="panel ipo-detail-panel ipo-review-panel">
        <div className="section-heading">
          <div>
            <span className="ipo-detail-kicker">Provider research</span>
            <h2>IPO review and industry analysis</h2>
          </div>
          <FileText size={22} />
        </div>
        <div className="ipo-disclosure-columns">
          <div>
            <h3>Review</h3>
            <p>{currentIpo.review ? formatFactValue(currentIpo.review) : 'No independent IPO review is supplied by the connected provider.'}</p>
            <h3>Expert analysis</h3>
            <p>{currentIpo.expertAnalysis ? formatFactValue(currentIpo.expertAnalysis) : 'Expert analysis is not available in the provider response.'}</p>
          </div>
          <div>
            <h3>Industry analysis</h3>
            <p>{currentIpo.industryAnalysis ? formatFactValue(currentIpo.industryAnalysis) : 'Industry analysis is not available in the provider response.'}</p>
            <h3>Competitors</h3>
            {disclosureItems(currentIpo.competitors).length
              ? <ul>{disclosureItems(currentIpo.competitors).map((item, index) => <li key={index}>{item}</li>)}</ul>
              : <p>Competitor data is not supplied by the provider.</p>}
          </div>
        </div>
        <div className="ipo-provider-assessment" role="note">
          <span>Provider rating</span><strong>{currentIpo.rating ? formatFactValue(currentIpo.rating) : 'Not provided'}</strong>
          <span>Apply / Avoid / Neutral</span><strong>{currentIpo.recommendation ? formatFactValue(currentIpo.recommendation) : 'No provider recommendation'}</strong>
        </div>
        <p className="ipo-detail-disclaimer">These fields only display provider-supplied information. Missing research is not inferred by the app.</p>
      </section>

      <section className="panel ipo-detail-panel">
        <div className="section-heading">
          <div>
            <span className="ipo-detail-kicker">Timeline</span>
            <h2>Important dates</h2>
          </div>
          <CalendarDays size={22} />
        </div>
        <div className="ipo-timeline">
          {[
            ['Issue opens', displayDate(currentIpo.openDate)],
            ['Issue closes', displayDate(currentIpo.closeDate)],
            ['Allotment', displayDate(currentIpo.allotmentDate)],
            ['Listing', displayDate(currentIpo.listingDate)],
          ].map(([label, date]) => (
            <div key={label}><span>{label}</span><strong>{date}</strong></div>
          ))}
        </div>
      </section>

      <p className="ipo-detail-disclaimer">* Info is indicative, not an investment advice.</p>
    </div>
  );
};

export default IPODetails;
