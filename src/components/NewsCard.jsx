import { ArrowUpRight, Clock, Newspaper } from 'lucide-react';
import { Link } from 'react-router-dom';

const getTagClass = (tag) => {
  const t = (tag || '').toLowerCase();
  if (t === 'stocks') return 'news-tag-stocks';
  if (t === 'ipo') return 'news-tag-ipo';
  if (t === 'gold') return 'news-tag-gold';
  if (t === 'silver') return 'news-tag-silver';
  if (t === 'mutual funds') return 'news-tag-mf';
  return 'news-tag-market';
};

const NewsCard = ({ item }) => {
  if (!item) return null;
  const tagClass = getTagClass(item.tag);

  return (
    <Link className={`news-card upgraded-news-card ${tagClass}`} to={`/news/${encodeURIComponent(item.id || item.title)}`}>
      <div className="news-card-header">
        <span className={`news-tag ${tagClass}`}>{item.tag || 'Market'}</span>
        {item.source ? (
          <span className="news-source-badge">
            <Newspaper size={12} />
            {item.source}
          </span>
        ) : null}
      </div>
      <h3>{item.title}</h3>
      <p>{item.summary}</p>
      <div className="news-card-footer">
        <time>
          <Clock size={12} />
          {item.time}
        </time>
        <span className="news-card-detail-link">
          Read details <ArrowUpRight size={14} />
        </span>
      </div>
    </Link>
  );
};

export default NewsCard;
