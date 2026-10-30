import { useEffect, useState } from 'react';
import { marketNews as fallbackNews } from '../data/marketNews';
import { marketApi } from '../services/api';

const REFRESH_MS = 15000;

const ageToMinutes = (time) => {
  const match = time?.match(/(\d+)\s*(min|hr|day)/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (match[2].toLowerCase() === 'hr') return amount * 60;
  if (match[2].toLowerCase() === 'day') return amount * 1440;
  return amount;
};

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
    summary: item.summary || 'Market news update from the live news feed.',
    time: relativeTime(item.datetime),
    publishedAt: item.datetime,
    source: item.source || 'Market feed',
    url: item.url,
  }));

export const useMarketNews = (refreshMs = REFRESH_MS) => {
  const [news, setNews] = useState(() => fallbackNews.map((item) => {
    const publishedAt = Math.floor(Date.now() / 1000) - ageToMinutes(item.time) * 60;
    return { ...item, id: item.id || item.title, publishedAt, time: relativeTime(publishedAt) };
  }));
  const [isLive, setIsLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const liveNews = normalizeNews(await marketApi.getMarketNews());
        if (!active || !liveNews.length) return;
        setNews(liveNews);
        setIsLive(true);
        setLastUpdated(new Date());
      } catch {
        if (active) setIsLive(false);
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

  return { news, isLive, lastUpdated };
};
