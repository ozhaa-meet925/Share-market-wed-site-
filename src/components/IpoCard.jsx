import { ArrowLeftRight, Bell, BellRing, Bookmark, CalendarDays, Eye, Share2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const getSegment = (ipo) => ipo.segment || 'Mainboard';
const getInitials = (company = '') => String(company)
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0].toUpperCase())
  .join('') || 'IPO';
const getCompanyMark = (company) => {
  const initials = getInitials(company);
  const seed = [...String(company || 'IPO')].reduce((value, character) => value + character.charCodeAt(0), 0);
  const palettes = [
    ['#0b7653', '#42b883'],
    ['#2554a5', '#5b91ed'],
    ['#8d4e16', '#e1a44f'],
    ['#713b89', '#b47acb'],
  ];
  const [start, end] = palettes[seed % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="96" height="96" rx="22" fill="url(#g)"/><text x="48" y="54" fill="white" font-family="Arial,sans-serif" font-size="${initials.length > 1 ? 30 : 40}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};
const displayDate = (value) => {
  if (!value || value === '—') return '—';
  return /\b20\d{2}\b/.test(value) ? value : `${value} ${new Date().getFullYear()}`;
};
const hasDisplayValue = (value) => value != null
  && String(value).trim() !== ''
  && !['—', 'not provided', 'not provided by api'].includes(String(value).trim().toLowerCase());

const IpoCard = ({ ipo, compact = false, isTracked = false, onToggleTracked, isCompared = false, compareDisabled = false, onToggleCompare, isAlerted = false, onToggleAlert }) => {
  const statusClass = `ipo-status-${ipo.status?.toLowerCase().replace(/\s+/g, '-')}`;
  const isClosedIssue = ['closed', 'listed'].includes(String(ipo.status || '').toLowerCase());
  const issuePeriod = isClosedIssue
    ? `${ipo.status === 'Listed' ? 'Listed' : 'Closed'} ${displayDate(ipo.listingDate || ipo.closeDate)}`
    : `${displayDate(ipo.openDate)} - ${displayDate(ipo.closeDate)}`;
  const logoSrc = ipo.logoUrl || ipo.logo || getCompanyMark(ipo.company);
  const summaryItems = [
    [isClosedIssue ? 'Status date' : 'Issue dates', issuePeriod],
    [ipo.priceBandLabel || 'Price band', String(ipo.priceBand || '').replaceAll('Rs ', '₹')],
    ['Lot size', ipo.lotSize ? `${ipo.lotSize} shares` : ''],
    [ipo.issueSizeLabel || 'Issue size', ipo.issueSize],
  ].filter(([, value]) => hasDisplayValue(value));
  const detailItems = [];
  const gmp = ipo.gmpValue || ipo.gmp;
  if (hasDisplayValue(gmp)) detailItems.push(['GMP', gmp, 'gain']);
  if (hasDisplayValue(ipo.minInvestment)) {
    detailItems.push(['Minimum investment', ipo.minInvestment.replace('Rs ', '₹')]);
  }
  if (hasDisplayValue(ipo.allotmentDate)) detailItems.push(['Allotment date', displayDate(ipo.allotmentDate)]);
  if (!isClosedIssue && hasDisplayValue(ipo.listingDate)) detailItems.push(['Listing date', displayDate(ipo.listingDate)]);
  if (ipo.status === 'Listed' && ipo.listingPrice != null) {
    detailItems.push(['Listing day close', `₹${Number(ipo.listingPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`]);
  }
  if (ipo.status === 'Listed' && ipo.gainFromIssuePercent != null) {
    const returnPercent = Number(ipo.gainFromIssuePercent);
    detailItems.push(['Return since issue', `${returnPercent.toFixed(2)}%`, returnPercent >= 0 ? 'gain' : 'loss']);
  }
  if (hasDisplayValue(ipo.subscription)) detailItems.push(['Subscription', ipo.subscription, 'gain']);
  if (Number(ipo.totalApplications) > 0) {
    detailItems.push(['Applications', Number(ipo.totalApplications).toLocaleString('en-IN')]);
  } else if (ipo.retailFormatted || ipo.qibFormatted) {
    detailItems.push(['Retail / QIB', `${ipo.retailFormatted || '0.00x'} / ${ipo.qibFormatted || '0.00x'}`]);
  }

  const liveIndicator = ipo.isLive === true && !ipo.stale
    ? <span className="live-dot" aria-label="Live provider data" title="Live provider data" />
    : null;
  const trackingButton = onToggleTracked && ipo.id ? (
    <button
      className={`ipo-track-button${isTracked ? ' is-tracked' : ''}`}
      type="button"
      aria-pressed={isTracked}
      aria-label={`${isTracked ? 'Stop tracking' : 'Track'} ${ipo.company} IPO`}
      title={`${isTracked ? 'Stop tracking' : 'Track'} this IPO`}
      onClick={() => onToggleTracked(ipo)}
    >
      <Bookmark size={17} fill={isTracked ? 'currentColor' : 'none'} />
    </button>
  ) : null;

  if (compact) {
    return (
      <article className="ipo-card">
        <div className="stock-header">
          <div>
            <strong>{ipo.company}</strong>
            <span>{ipo.priceBand}</span>
          </div>
          <span className={`status-badge ${statusClass}`}>{ipo.status} {liveIndicator}</span>
        </div>
        <div className="ipo-grid">
          <span>Lot Size <b>{ipo.lotSize}</b></span>
          <span>{ipo.issueSizeLabel || 'Issue Size'} <b>{ipo.issueSize}</b></span>
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
        <div className="ipo-company-brand">
          <img
            className="ipo-logo"
            src={logoSrc}
            alt={`${ipo.company} company mark`}
            loading="eager"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = getCompanyMark(ipo.company);
            }}
          />
          <div>
            <h2>{ipo.company}</h2>
            <span className="ipo-company-segment">{getSegment(ipo)} Issue</span>
          </div>
        </div>
        <div className="ipo-card-heading-actions">
          {onToggleAlert && (
            <button
              className={`ipo-alert-toggle${isAlerted ? ' is-selected' : ''}`}
              type="button"
              aria-pressed={isAlerted}
              aria-label={`${isAlerted ? 'Remove' : 'Set'} date reminders for ${ipo.company} IPO`}
              title={isAlerted ? 'Turn off date reminders' : 'Remind me on issue dates'}
              onClick={() => onToggleAlert(ipo)}
            >
              {isAlerted ? <BellRing size={14} /> : <Bell size={14} />}
              <span>{isAlerted ? 'Alert on' : 'Alert me'}</span>
            </button>
          )}
          {onToggleCompare && (
            <button
              className={`ipo-compare-toggle${isCompared ? ' is-selected' : ''}`}
              type="button"
              aria-pressed={isCompared}
              aria-label={`${isCompared ? 'Remove' : 'Add'} ${ipo.company} ${isCompared ? 'from' : 'to'} comparison`}
              title={compareDisabled ? 'Compare up to three IPOs at a time' : isCompared ? 'Remove from comparison' : 'Compare this IPO'}
              disabled={compareDisabled}
              onClick={() => onToggleCompare(ipo)}
            >
              <ArrowLeftRight size={14} />
              <span>{isCompared ? 'Selected' : 'Compare'}</span>
            </button>
          )}
          <span className={`status-badge ${statusClass}`}>{ipo.status} {liveIndicator}</span>
        </div>
      </div>

      <div className="ipo-primary-details">
        <div className="ipo-summary-grid">
          {summaryItems.map(([label, value]) => <span key={label}>{label}<b>{value}</b></span>)}
        </div>
      </div>

      {detailItems.length > 0 && (
        <>
          <div className="ipo-divider" />
          <div className="ipo-detail-rows">
            {detailItems.map(([label, value, valueClass]) => (
              <span key={label}>{label} {label === 'Subscription' && ipo.isLive === true && liveIndicator}<b className={valueClass || ''}>{value}</b></span>
            ))}
          </div>
        </>
      )}

      <div className="ipo-actions">
        <Link
          className="ipo-view-button"
          to={`/ipo/${encodeURIComponent(ipo.id || ipo.company)}`}
          aria-label={`View ${ipo.company} IPO`}
        >
          <Eye size={17} /> View
        </Link>
        {ipo.status === 'Open' && ipo.source === 'upstox' && ipo.isLive === true && !ipo.stale && <Link
          className="ipo-apply-button"
          to={`/ipo/${encodeURIComponent(ipo.id || ipo.company)}#apply`}
          aria-label={`Apply for ${ipo.company} IPO`}
        >
          Apply
        </Link>}
        {trackingButton}
        <button
          className="ipo-share-button"
          type="button"
          aria-label={`Share ${ipo.company} IPO`}
          onClick={shareIpo}
        >
          <Share2 size={18} />
        </button>
      </div>
    </article>
  );
};

export default IpoCard;
