import axios from 'axios';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { companyDomains } from './src/data/companyLogos.js';

const MAX_LOGO_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MISS_RETRY_MS = 12 * 60 * 60_000;
const MIN_USEFUL_EDGE = 16;
const SVG_SCORE = 1024;

const readUInt24LE = (buf, offset) => buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);

export const detectImage = (input) => {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buf.length < 12) return null;

  if (buf.readUInt32BE(0) === 0x89504e47 && buf.length >= 24) {
    return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.toString('ascii', 0, 3) === 'GIF') {
    return { type: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' && buf.length >= 30) {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'image/webp', width: readUInt24LE(buf, 24) + 1, height: readUInt24LE(buf, 27) + 1 };
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { type: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset += 1; continue; }
      const marker = buf[offset + 1];
      const length = buf.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'image/jpeg', width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
    return { type: 'image/jpeg', width: 0, height: 0 };
  }
  if (buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) {
    const count = buf.readUInt16LE(4);
    let best = 0;
    for (let i = 0; i < count && 6 + i * 16 + 16 <= buf.length; i += 1) {
      const entry = 6 + i * 16;
      best = Math.max(best, buf[entry] || 256, buf[entry + 1] || 256);
    }
    return count > 0 ? { type: 'image/x-icon', width: best, height: best } : null;
  }
  const head = buf.toString('utf8', 0, Math.min(buf.length, 1024)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return { type: 'image/svg+xml', width: SVG_SCORE, height: SVG_SCORE };
  }
  return null;
};

export const scoreLogo = (image) => {
  if (!image) return 0;
  return Math.min(image.width || 0, image.height || 0);
};

export const logoSources = (domain) => [
  `https://unavatar.io/${domain}?fallback=false`,
  `https://icon.horse/icon/${domain}`,
  `https://www.google.com/s2/favicons?domain=${domain}&sz=256`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
];

export const domainForSymbol = (symbol) => {
  const sym = String(symbol || '').toUpperCase().trim();
  return Object.prototype.hasOwnProperty.call(companyDomains, sym) ? companyDomains[sym] : null;
};

const fetchCandidate = async (url) => {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_LOGO_BYTES,
      maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (ShareMarket logo resolver)', Accept: 'image/*' },
      validateStatus: (status) => status === 200,
    });
    const generated = [response.headers['x-icon-fallback'], response.headers['x-icon-stand-in']]
      .some((value) => String(value || '').toLowerCase() === 'true');
    if (generated) return null;
    const body = Buffer.from(response.data);
    const image = detectImage(body);
    if (!image) return null;
    return { body, image, source: new URL(url).hostname, score: scoreLogo(image) };
  } catch {
    return null;
  }
};

export const resolveBestLogo = async (domain, fetcher = fetchCandidate, discover = discoverSiteIcons) => {
  const siteIcons = await discover(domain).catch(() => []);
  const urls = [...logoSources(domain), ...siteIcons];
  const candidates = await Promise.all(urls.map((url) => fetcher(url)));
  const usable = candidates.filter((item) => item && item.score >= MIN_USEFUL_EDGE);
  usable.sort((a, b) => b.score - a.score);
  return usable[0] || null;
};

const isPublicHttpUrl = (value) => {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return host.includes('.') && host !== 'localhost' && !/^[\d.]+$/.test(host) && !host.includes(':');
  } catch {
    return false;
  }
};

export const extractIconLinks = (html, baseUrl) => {
  const links = [];
  for (const tag of String(html || '').match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || !/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/i.test(rel)) continue;
    try {
      const absolute = new URL(href.trim(), baseUrl).toString();
      if (isPublicHttpUrl(absolute)) links.push(absolute);
    } catch { /* ignore malformed href */ }
  }
  return links;
};

const MAX_SITE_ICONS = 5;

export const discoverSiteIcons = async (domain) => {
  for (const origin of [`https://www.${domain}`, `https://${domain}`]) {
    try {
      const response = await axios.get(`${origin}/`, {
        responseType: 'text',
        timeout: FETCH_TIMEOUT_MS,
        maxContentLength: 2 * 1024 * 1024,
        maxRedirects: 4,
        headers: { 'User-Agent': 'Mozilla/5.0 (ShareMarket logo resolver)', Accept: 'text/html' },
        validateStatus: (status) => status === 200,
      });
      const finalUrl = response.request?.res?.responseUrl || `${origin}/`;
      const declared = extractIconLinks(response.data, finalUrl);
      const root = new URL('/', finalUrl);
      return [...new Set([...declared, new URL('/apple-touch-icon.png', root).toString(), new URL('/favicon.ico', root).toString()])]
        .slice(0, MAX_SITE_ICONS);
    } catch { /* try the next origin */ }
  }
  return [];
};

export const createCompanyLogoService = ({ cacheDir, fetcher = fetchCandidate, discover = discoverSiteIcons, now = () => Date.now() } = {}) => {
  fs.mkdirSync(cacheDir, { recursive: true });
  const inflight = new Map();
  const misses = new Map();

  const fileBase = (domain) => path.join(cacheDir, crypto.createHash('sha1').update(domain).digest('hex'));

  const readCached = (domain) => {
    const base = fileBase(domain);
    try {
      const meta = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
      if (meta.missing) return now() - meta.checkedAt < MISS_RETRY_MS ? { missing: true } : null;
      return { ...meta, body: fs.readFileSync(`${base}.bin`) };
    } catch {
      return null;
    }
  };

  const writeCached = (domain, entry) => {
    const base = fileBase(domain);
    if (entry) {
      fs.writeFileSync(`${base}.bin`, entry.body);
      fs.writeFileSync(`${base}.json`, JSON.stringify({ domain, type: entry.image.type, source: entry.source, edge: entry.score, checkedAt: now() }));
    } else {
      fs.writeFileSync(`${base}.json`, JSON.stringify({ domain, missing: true, checkedAt: now() }));
    }
  };

  const getLogo = async (symbol) => {
    const domain = domainForSymbol(symbol);
    if (!domain) return null;
    const cached = readCached(domain);
    if (cached) return cached.missing ? null : cached;
    const missAt = misses.get(domain);
    if (missAt && now() - missAt < MISS_RETRY_MS) return null;
    if (!inflight.has(domain)) {
      const job = resolveBestLogo(domain, fetcher, discover).then((best) => {
        try { writeCached(domain, best); } catch { /* cache is best effort */ }
        if (!best) misses.set(domain, now());
        return best ? { domain, type: best.image.type, source: best.source, edge: best.score, body: best.body } : null;
      }).finally(() => inflight.delete(domain));
      inflight.set(domain, job);
    }
    return inflight.get(domain);
  };

  return { getLogo };
};

export const registerCompanyLogoRoutes = (app, { cacheDir }) => {
  const service = createCompanyLogoService({ cacheDir });
  app.get('/api/logos/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol || '').slice(0, 32);
    if (!domainForSymbol(symbol)) return res.status(404).json({ error: 'No verified company domain is mapped for this symbol.' });
    const logo = await service.getLogo(symbol);
    if (!logo) {
      res.set('Cache-Control', 'public, max-age=3600');
      return res.status(404).json({ error: 'No usable logo was found for this company.' });
    }
    res.set({
      'Content-Type': logo.type,
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Logo-Source': logo.source,
    });
    return res.send(logo.body);
  });
};
