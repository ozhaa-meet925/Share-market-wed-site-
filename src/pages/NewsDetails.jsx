import { ArrowLeft, ExternalLink, Newspaper } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useMarketNews } from '../hooks/useMarketNews';

const NewsDetails = () => {
  const { id } = useParams();
  const { news, isLive } = useMarketNews();
  const decodedId = decodeURIComponent(id || '');
  const item = news.find((entry) => entry.id === decodedId || encodeURIComponent(entry.id) === id) || news[0];

  if (!item) return null;

  return (
    <div className="page news-detail-page">
      <Link className="back-link" to="/news"><ArrowLeft size={18} /> Back to news</Link>
      <article className="news-detail-panel">
        <div className="news-detail-topline"><span>{item.tag}</span><span>{item.time}</span></div>
        <h1>{item.title}</h1>
        <p className="news-detail-summary">{item.summary}</p>
        <div className="news-detail-meta"><Newspaper size={18} /> {item.source || 'ShareMarket news feed'} · {isLive ? 'Live feed' : 'Demo fallback'}</div>
        {item.url ? <a className="primary-button news-source-button" href={item.url} target="_blank" rel="noreferrer">Read original source <ExternalLink size={16} /></a> : null}
      </article>
      <section className="panel news-related-panel">
        <div className="section-heading"><h2>Related market sections</h2></div>
        <div className="news-category-links">
          {['Stocks', 'IPO', 'Gold', 'Silver', 'Mutual Funds'].map((category) => <Link key={category} to={`/news?category=${encodeURIComponent(category)}`}>{category}</Link>)}
        </div>
      </section>
    </div>
  );
};

export default NewsDetails;
