import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckCircle2, CircleDollarSign, FileText, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ipos as staticIpos } from '../data/ipo';
import { marketApi } from '../services/api';

const detailRows = [
  ['Price band', 'priceBand'],
  ['Lot size', 'lotSize'],
  ['Issue size', 'issueSize'],
  ['Minimum investment', 'minInvestment'],
  ['Overall Subscription', 'subscription'],
  ['GMP', 'gmp'],
];

const IPO_REFRESH_MS = 60_000;
const displayDate = (value) => {
  if (!value || value === '—') return '—';
  return /\b20\d{2}\b/.test(value) ? value : `${value} ${new Date().getFullYear()}`;
};

const IPODetails = () => {
  const { company } = useParams();
  const decodedName = decodeURIComponent(company || '');
  const initialIpo = staticIpos.find((item) => item.company.toLowerCase() === decodedName.toLowerCase());

  const [ipo, setIpo] = useState(initialIpo);
  const [loading, setLoading] = useState(!initialIpo);

  useEffect(() => {
    let active = true;

    const fetchLiveDetails = async () => {
      try {
        const live = await marketApi.getIpoDetails(decodedName);
        if (active && live) {
          setIpo(live);
          setLoading(false);
        }
      } catch {
        if (active) setLoading(false);
      }
    };

    fetchLiveDetails();
    const interval = setInterval(fetchLiveDetails, IPO_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [decodedName]);

  if (!ipo && !loading) {
    return (
      <div className="page ipo-page ipo-detail-page">
        <Link className="back-link ipo-detail-back" to="/ipo"><ArrowLeft size={18} /> Back to IPOs</Link>
        <section className="panel ipo-detail-empty">
          <h1>IPO not found</h1>
          <p>The IPO you are looking for is no longer available.</p>
        </section>
      </div>
    );
  }

  const currentIpo = ipo || initialIpo || {};
  const statusClass = `ipo-status-${(currentIpo.status || 'open').toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="page ipo-page ipo-detail-page">
      <Link className="back-link ipo-detail-back" to="/ipo"><ArrowLeft size={18} /> Back to IPOs</Link>

      <section className="ipo-detail-hero">
        <div>
          <span className="ipo-detail-kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {currentIpo.status === 'Open' && <span className="live-dot" style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#00D09C' }} />}
            {currentIpo.segment || 'Mainboard'} IPO · {currentIpo.source === 'upstox' ? 'Upstox API' : 'Demo data'}
          </span>
          <h1>{currentIpo.company}</h1>
          <p>Issue status and subscription figures from the selected IPO data source.</p>
        </div>
        <span className={`status-badge ${statusClass}`}>{currentIpo.status}</span>
      </section>

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
          <span>Overall Subscription</span>
          <strong className="gain">{currentIpo.subscription}</strong>
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
            <div><span>Total Applications Received</span><strong>{Number(currentIpo.totalApplications || 0).toLocaleString('en-IN')}</strong></div>
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
            <div key={key}><span>{label}</span><strong>{currentIpo[key] || 'Not provided'}</strong></div>
          ))}
        </div>
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
