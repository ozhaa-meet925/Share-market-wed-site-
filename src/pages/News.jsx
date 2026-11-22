import { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Clock,
  Flame,
  Newspaper,
  Radio,
  Search,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import NewsCard from '../components/NewsCard';
import { useMarketNews } from '../hooks/useMarketNews';
import { marketApi } from '../services/api';

const TRENDING_TOPICS = [
  { tag: '#Nifty50', label: 'Nifty 50', query: 'Nifty' },
  { tag: '#RBIPolicy', label: 'RBI Policy', category: 'Market', query: 'RBI' },
  { tag: '#IPO', label: 'IPO Watch', category: 'IPO', query: 'IPO' },
  { tag: '#GoldTrend', label: 'Gold Price Trend', category: 'Gold' },
  { tag: '#SIPInflows', label: 'SIP Inflows', category: 'Mutual Funds', query: 'SIP' },
  { tag: '#ITSector', label: 'IT Sector Deals', category: 'Stocks', query: 'IT' },
  { tag: '#AutoSales', label: 'Auto Sales', category: 'Stocks', query: 'Auto' },
  { tag: '#SilverTrend', label: 'Silver Trend', category: 'Silver' },
  { tag: '#SEBIRegulations', label: 'SEBI Regulations', category: 'Market', query: 'SEBI' },
];

const formatIndexValue = (value) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const formatRupees = (value) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const quoteState = (quote) => {
  if (quote?.isStale) return 'Stale quote';
  if (quote?.isLive) return 'Live';
  if (quote?.isClose) return 'Previous close · delayed feed';
  if (quote?.isDelayed) return 'Delayed feed';
  return 'Provider feed';
};

const CATEGORIES = ['All', 'Market', 'Stocks', 'IPO', 'Gold', 'Silver', 'Mutual Funds'];

const News = () => {
  const { news, isLive, lastUpdated, provider, statusMessage, isLoading, sentimentMethod } = useMarketNews();
  const [searchParams, setSearchParams] = useSearchParams();

  const [category, setCategory] = useState(() => searchParams.get('category') || 'All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState('All');
  const [marketSignals, setMarketSignals] = useState([]);
  const [signalsUpdatedAt, setSignalsUpdatedAt] = useState(null);

  useEffect(() => {
    let active = true;
    const loadSignals = async () => {
      const [benchmarks, metals] = await Promise.allSettled([
        marketApi.getBatchQuotes(['NIFTY', 'SENSEX']),
        marketApi.getMetalsOverview(),
      ]);
      if (!active) return;
      const rows = [];

      if (benchmarks.status === 'fulfilled') {
        for (const symbol of ['NIFTY', 'SENSEX']) {
          const quote = benchmarks.value?.quotes?.[symbol];
          if (!quote || !(Number(quote.c) > 0)) continue;
          const change = Number(quote.dp);
          rows.push({
            key: symbol,
            label: quote.label || symbol,
            value: `${formatIndexValue(quote.c)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`,
            detail: quoteState(quote),
            positive: change >= 0,
          });
        }
      }

      if (metals.status === 'fulfilled') {
        const metalRows = [
          { key: 'GOLD', label: 'Gold (₹/10g)', quote: metals.value?.quotes?.GOLD },
          { key: 'SILVER', label: 'Silver (₹/kg)', quote: metals.value?.quotes?.SILVER },
        ];
        for (const { key, label, quote } of metalRows) {
          if (!quote || !(Number(quote.c) > 0)) continue;
          const change = Number(quote.dp);
          rows.push({
            key,
            label,
            value: `${formatRupees(quote.c)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`,
            detail: `${quoteState(quote)} · COMEX basis, not MCX spot`,
            positive: change >= 0,
          });
        }
      }

      rows.push({
        key: 'flows',
        label: 'FII / DII Flows',
        value: 'Unavailable',
        detail: 'No configured data source',
        muted: true,
      });

      setMarketSignals(rows);
      setSignalsUpdatedAt(new Date());
    };

    loadSignals();
    const intervalId = window.setInterval(loadSignals, 60000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Synchronize category with URL search param
  useEffect(() => {
    const urlCat = searchParams.get('category');
    if (urlCat && CATEGORIES.includes(urlCat)) {
      setCategory(urlCat);
    }
  }, [searchParams]);

  const handleCategoryChange = (newCat) => {
    setCategory(newCat);
    if (newCat === 'All') {
      searchParams.delete('category');
    } else {
      searchParams.set('category', newCat);
    }
    setSearchParams(searchParams, { replace: true });
  };

  // Top 6 breaking headlines for the scrolling ticker
  const breakingNews = useMemo(() => {
    return news.slice(0, 6);
  }, [news]);

  // Available sources list with counts
  const sources = useMemo(() => {
    const counts = {};
    news.forEach((item) => {
      const src = item.source || 'Market feed';
      counts[src] = (counts[src] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [news]);

  // Category counts for pills
  const categoryCounts = useMemo(() => {
    const counts = { All: news.length };
    CATEGORIES.slice(1).forEach((cat) => {
      counts[cat] = news.filter((item) => {
        const itemTag = (item.tag || '').toLowerCase();
        if (cat.toLowerCase() === 'market') {
          return itemTag === 'market' || itemTag === 'general';
        }
        return itemTag === cat.toLowerCase();
      }).length;
    });
    return counts;
  }, [news]);

  // Filtered news items based on category, source, and search
  const filteredNews = useMemo(() => {
    return news.filter((item) => {
      // Category check
      if (category !== 'All') {
        const itemTag = (item.tag || '').toLowerCase();
        if (category.toLowerCase() === 'market') {
          if (itemTag !== 'market' && itemTag !== 'general') return false;
        } else if (itemTag !== category.toLowerCase()) {
          return false;
        }
      }

      // Source check
      if (selectedSource !== 'All' && item.source !== selectedSource) {
        return false;
      }

      // Search query check
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = item.title?.toLowerCase().includes(q);
        const matchesSummary = item.summary?.toLowerCase().includes(q);
        const matchesSource = item.source?.toLowerCase().includes(q);
        const matchesTag = item.tag?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesSummary && !matchesSource && !matchesTag) {
          return false;
        }
      }

      return true;
    });
  }, [news, category, selectedSource, searchQuery]);

  // Lead featured story is the first item if no search is active
  const hasActiveFilter = searchQuery.trim().length > 0 || selectedSource !== 'All';
  const leadStory = !hasActiveFilter && filteredNews.length > 0 ? filteredNews[0] : null;
  const feedStories = leadStory ? filteredNews.slice(1) : filteredNews;

  const handleTrendingClick = (topic) => {
    if (topic.category) {
      handleCategoryChange(topic.category);
    }
    if (topic.query) {
      setSearchQuery(topic.query);
    } else {
      setSearchQuery('');
    }
  };

  const handleClearFilters = () => {
    setCategory('All');
    setSearchQuery('');
    setSelectedSource('All');
    searchParams.delete('category');
    setSearchParams(searchParams, { replace: true });
  };

  return (
    <div className="page news-page">
      {/* 1. SCROLLING BREAKING NEWS TICKER */}
      {breakingNews.length > 0 && (
        <section className="news-breaking-bar" aria-label="Breaking news ticker">
          <div className="news-breaking-pill">
            <Radio size={12} className="live-pulse-icon" />
            Breaking Wire
          </div>
          <div className="news-ticker-container">
            <div className="news-ticker-track">
              {breakingNews.concat(breakingNews).map((item, index) => (
                <Link
                  key={`${item.id || item.title}-ticker-${index}`}
                  className="news-ticker-item"
                  to={`/news/${encodeURIComponent(item.id || item.title)}`}
                >
                  <span className="news-ticker-tag">{item.tag || 'Market'}</span>
                  <span>{item.title}</span>
                  <span className="news-ticker-separator">•</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 2. HEADER AREA WITH LIVE STATUS & TOTAL COUNT */}
      <header className="page-title">
        <div className="eyebrow">
          <Zap size={15} /> Live Indian Market Headlines
        </div>
        <div className="news-header-row">
          <div>
            <h1>Market Headlines & Live Wire</h1>
            <div className="news-header-meta">
              <div className={`news-live-indicator ${isLive ? 'live' : 'offline'}`}>
                {isLive ? (
                  <>
                    <span className="live-dot" />
                    Live news · {provider || 'Market feed'}
                  </>
                ) : (
                  <>
                    <Activity size={13} />
                    {isLoading ? 'Connecting to live market news…' : statusMessage || 'Live market news unavailable'}
                  </>
                )}
                {lastUpdated && (
                  <span>· {lastUpdated.toLocaleTimeString('en-IN')}</span>
                )}
              </div>
              <div className="news-article-count">
                <Newspaper size={13} />
                Showing {filteredNews.length} of {news.length} articles
              </div>
              {sentimentMethod ? (
                <div className="news-sentiment-method" title={sentimentMethod}>
                  Tone badges: headline keyword score · not advice
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {/* 3. CONTROLS BAR: CATEGORY TABS & SEARCH */}
      <section className="news-controls-bar">
        <nav className="news-category-tabs" aria-label="News categories">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              className={category === item ? 'active' : ''}
              onClick={() => handleCategoryChange(item)}
            >
              <span>{item}</span>
              <span className="news-tab-count">{categoryCounts[item] ?? 0}</span>
            </button>
          ))}
        </nav>

        <div className="news-search-box">
          <Search size={16} color="#64748b" />
          <input
            type="text"
            placeholder="Search headlines, sectors, keywords..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="news-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </section>

      {/* 4. MAIN NEWS LAYOUT (FEED + SIDEBAR) */}
      <div className="news-layout">
        {/* LEFT COLUMN: MAIN FEED */}
        <main className="news-main-feed">
          {/* Featured Lead Story (shown when no search filter active) */}
          {leadStory && (
            <Link
              className="news-lead-card"
              to={`/news/${encodeURIComponent(leadStory.id || leadStory.title)}`}
            >
              <div className="news-lead-top">
                <span className="news-lead-badge">
                  <Flame size={12} /> Lead Story
                </span>
                <span className="news-source-badge">
                  <Newspaper size={12} />
                  {leadStory.source || 'Market Desk'}
                </span>
              </div>
              <h2>{leadStory.title}</h2>
              <p>{leadStory.summary}</p>
              <div className="news-lead-footer">
                <div className="news-lead-meta">
                  <span className={`news-tag news-tag-${(leadStory.tag || 'market').toLowerCase().replace(/\s+/g, '')}`}>
                    {leadStory.tag || 'Market'}
                  </span>
                  <span className="news-card-time">
                    <Clock size={12} />
                    {leadStory.time}
                  </span>
                </div>
                <span className="news-lead-cta">
                  Read full analysis <ArrowRight size={15} />
                </span>
              </div>
            </Link>
          )}

          {/* Regular News Grid */}
          {feedStories.length > 0 ? (
            <div className="news-feed-grid">
              {feedStories.map((item, index) => (
                <NewsCard key={`${item.id || item.title}-${index}`} item={item} />
              ))}
            </div>
          ) : (
            <div className="panel news-empty" style={{ padding: '40px 20px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 16px', fontSize: '1.05rem', color: '#64748b' }}>
                {news.length
                  ? 'No news articles match your current filters.'
                  : isLoading
                    ? 'Fetching current headlines from the live news feed…'
                    : statusMessage || 'No live market headlines are available right now.'}
              </p>
              {news.length > 0 && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleClearFilters}
                >
                  Reset All Filters
                </button>
              )}
            </div>
          )}
        </main>

        {/* RIGHT COLUMN: TRENDING TOPICS & SIDEBAR */}
        <aside className="news-sidebar">
          {/* Trending Topics Widget */}
          <section className="news-sidebar-widget">
            <h3 className="news-sidebar-title">
              <Flame size={16} color="#f43f5e" />
              Trending Market Topics
            </h3>
            <div className="news-trending-pills">
              {TRENDING_TOPICS.map((topic) => (
                <button
                  key={topic.tag}
                  type="button"
                  className={`news-trending-pill ${searchQuery === topic.query || category === topic.category ? 'active' : ''}`}
                  onClick={() => handleTrendingClick(topic)}
                >
                  {topic.tag}
                </button>
              ))}
            </div>
          </section>

          {/* Live Market Signals Widget */}
          <section className="news-sidebar-widget">
            <h3 className="news-sidebar-title">
              <TrendingUp size={16} color="#0d6f4e" />
              Key Market Signals
            </h3>
            <div className="news-signals-list">
              {marketSignals.length === 0 ? (
                <div className="news-signal-item">
                  <span className="news-signal-label">Live quotes</span>
                  <span className="news-signal-value">Connecting…</span>
                </div>
              ) : marketSignals.map((signal) => (
                <div key={signal.key} className="news-signal-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="news-signal-label">{signal.label}</span>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-3)', marginTop: 2 }}>{signal.detail}</div>
                  </div>
                  <span
                    className={`news-signal-value ${signal.positive ? 'positive' : ''}`}
                    style={{ textAlign: 'right', color: signal.muted ? 'var(--text-3)' : undefined }}
                  >
                    {signal.value}
                  </span>
                </div>
              ))}
            </div>
            {signalsUpdatedAt && (
              <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: 8 }}>
                Updated {signalsUpdatedAt.toLocaleTimeString('en-IN')} · indices and metals refresh every 60s
              </div>
            )}
          </section>

          {/* Sources Filter Widget */}
          <section className="news-sidebar-widget">
            <h3 className="news-sidebar-title">
              <Newspaper size={16} color="#0284c7" />
              Top News Sources
            </h3>
            <div className="news-source-tags">
              <button
                type="button"
                className={`news-source-tag-btn ${selectedSource === 'All' ? 'active' : ''}`}
                onClick={() => setSelectedSource('All')}
              >
                All Sources
              </button>
              {sources.map(([src, count]) => (
                <button
                  key={src}
                  type="button"
                  className={`news-source-tag-btn ${selectedSource === src ? 'active' : ''}`}
                  onClick={() => setSelectedSource(selectedSource === src ? 'All' : src)}
                >
                  {src} ({count})
                </button>
              ))}
            </div>
          </section>

          {/* Live Feed Note Widget */}
          <section className="news-newsletter-card">
            <h4>Live Headlines, No Sign-up</h4>
            <p>Headlines on this page come from the live news feed and refresh every 2 minutes. Email briefs are not enabled on this deployment.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.82rem', fontWeight: 700 }}>
              <Radio size={16} /> Auto-refresh is on
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default News;
