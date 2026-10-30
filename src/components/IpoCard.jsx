import { CalendarDays, Eye, Share2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const getSegment = (ipo) => ipo.segment || 'Mainboard';
const displayDate = (value) => {
  if (!value || value === '—') return '—';
  return /\b20\d{2}\b/.test(value) ? value : `${value} ${new Date().getFullYear()}`;
};

const IpoCard = ({ ipo, compact = false }) => {
  const statusClass = `ipo-status-${ipo.status.toLowerCase().replace(/\s+/g, '-')}`;
  const issuePeriod = `${displayDate(ipo.openDate)} - ${displayDate(ipo.closeDate)}`;

  if (compact) {
    return (
      <article className="ipo-card">
        <div className="stock-header">
          <div>
            <strong>{ipo.company}</strong>
            <span>{ipo.priceBand}</span>
          </div>
          <span className={`status-badge ${statusClass}`}>{ipo.status}</span>
        </div>
        <div className="ipo-grid">
          <span>Lot Size <b>{ipo.lotSize}</b></span>
          <span>Issue Size <b>{ipo.issueSize}</b></span>
          <span>Subscription <b>{ipo.subscription}</b></span>
          <span><CalendarDays size={15} /> {issuePeriod}</span>
        </div>
      </article>
    );
  }

  const shareIpo = () => {
    if (navigator.share) {
      navigator.share({ title: `${ipo.company} IPO`, text: `${ipo.company} IPO details` }).catch(() => {});
    }
  };

  return (
    <article className="ipo-card ipo-card-expanded">
      <div className="ipo-card-heading">
        <div>
          <h2>{ipo.company}</h2>
          <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {getSegment(ipo)} Issue
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`status-badge ${statusClass}`}>{ipo.status}</span>
        </div>
      </div>

      <div className="ipo-primary-details">
        <div className="ipo-logo" aria-hidden="true">{ipo.company.slice(0, 1)}</div>
        <div className="ipo-summary-grid">
          <span>Date <b>{issuePeriod}</b></span>
          <span>Price Band <b>{ipo.priceBand.replaceAll('Rs ', '₹')}</b></span>
          <span>Lot Size <b>{ipo.lotSize ? `${ipo.lotSize} shares` : 'Not provided'}</b></span>
          <span>Issue Size <b>{ipo.issueSize}</b></span>
        </div>
      </div>

      <div className="ipo-divider" />

      <div className="ipo-detail-rows">
        <span>GMP <b className={ipo.gmpValue === 'Not provided' ? '' : 'gain'}>{ipo.gmpValue || ipo.gmp || 'Not provided by API'}</b></span>
        <span>Min Investment <b>{ipo.minInvestment ? ipo.minInvestment.replace('Rs ', '₹') : 'Not provided'}</b></span>
        <span>Allotment Date <b>{displayDate(ipo.allotmentDate)}</b></span>
        <span>Listing Date <b>{displayDate(ipo.listingDate)}</b></span>
        <span>
          Subscription{' '}
          {ipo.status === 'Open' && <span className="live-dot" style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#00D09C', marginLeft: '4px' }} />}
          <b className="gain">{ipo.subscription}</b>
        </span>
        {ipo.totalApplications ? (
          <span>Applications <b>{Number(ipo.totalApplications).toLocaleString('en-IN')}</b></span>
        ) : (ipo.retailFormatted || ipo.qibFormatted) ? (
          <span>Retail / QIB <b>{ipo.retailFormatted || '0.00x'} / {ipo.qibFormatted || '0.00x'}</b></span>
        ) : null}
      </div>

      <div className="ipo-actions">
        <Link
          className="ipo-view-button"
          to={`/ipo/${encodeURIComponent(ipo.id || ipo.company)}`}
          aria-label={`View ${ipo.company} IPO`}
        >
          <Eye size={17} /> View
        </Link>
        <button className="ipo-share-button" type="button" aria-label={`Share ${ipo.company} IPO`} onClick={shareIpo}><Share2 size={18} /></button>
      </div>
    </article>
  );
};

export default IpoCard;
