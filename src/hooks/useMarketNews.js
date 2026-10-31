import { useEffect, useState } from 'react';
import { marketApi } from '../services/api';

const REFRESH_MS = 2 * 60 * 1000;

const relativeTime = (timestamp) => {
  if (!timestamp) return 'Recently';
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp * 1000) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

const normalizeNews = (items) => items
  .filter((item) => item.headline)
  .slice(0, 20)
  .map((item) => ({
    id: String(item.id || item.headline),
    tag: (!item.category || item.category.toLowerCase() === 'general') ? 'Market' : (item.category[0].toUpperCase() + item.category.slice(1)),
    title: item.headline,
    summary: item.summary || 'Open the publisher link to read the full story.',
    time: relativeTime(item.datetime),
    publishedAt: item.datetime,
    source: item.source || 'Market feed',
    url: item.url,
  }));

export const useMarketNews = (refreshMs = REFRESH_MS) => {
  const [news, setNews] = useState([]);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [provider, setProvider] = useState(null);
  const [statusMessage, setStatusMessage] = useState('Connecting to live market news…');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const payload = await marketApi.getMarketNews();
        const feed = Array.isArray(payload) ? { data: payload, live: false } : payload;
        const articles = normalizeNews(Array.isArray(feed?.data) ? feed.data : []);
        if (!active) return;
        setNews(articles);
        setIsLive(feed?.live === true && articles.length > 0);
        setLastUpdated(feed?.lastUpdated ? new Date(feed.lastUpdated) : null);
        setProvider(feed?.provider || null);
        setStatusMessage(feed?.note || (articles.length ? '' : 'No live market headlines are available right now.'));
      } catch (error) {
        if (!active) return;
        setIsLive(false);
        setStatusMessage(error.message || 'Could not connect to the live market news feed.');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    refresh();
    const intervalId = window.setInterval(refresh, refreshMs);
    const clockId = window.setInterval(() => {
      setNews((current) => current.map((item) => (
        item.publishedAt ? { ...item, time: relativeTime(item.publishedAt) } : item
      )));
    }, 60000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.clearInterval(clockId);
    };
  }, [refreshMs]);

  return { news, isLive, lastUpdated, provider, statusMessage, isLoading };
};
