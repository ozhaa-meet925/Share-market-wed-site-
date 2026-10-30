import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(ROOT, 'yfinance_research.py');
const WINDOWS_VENV_PYTHON = path.join(ROOT, '.venv-yfinance', 'Scripts', 'python.exe');
const POSIX_VENV_PYTHON = path.join(ROOT, '.venv-yfinance', 'bin', 'python');
const CACHE_TTL_MS = 60_000;
const quoteCache = new Map();
const pendingRequests = new Map();

const configuredPython = () => {
  const custom = process.env.YFINANCE_PYTHON?.trim();
  if (custom) {
    const looksLikePath = custom.includes('/') || custom.includes('\\');
    return {
      command: looksLikePath ? path.resolve(ROOT, custom) : custom,
      args: [],
    };
  }

  const venvPython = process.platform === 'win32' ? WINDOWS_VENV_PYTHON : POSIX_VENV_PYTHON;
  if (fs.existsSync(venvPython)) return { command: venvPython, args: [] };
  return process.platform === 'win32'
    ? { command: 'py', args: ['-3'] }
    : { command: 'python3', args: [] };
};

export const isYahooResearchEnabled = () => {
  if (String(process.env.YFINANCE_RESEARCH_ENABLED || '').toLowerCase() === 'false') return false;
  const python = configuredPython();
  return process.env.YFINANCE_RESEARCH_ENABLED === 'true'
    || Boolean(process.env.YFINANCE_PYTHON)
    || fs.existsSync(python.command);
};

const normalizeRequest = (rawSymbol) => {
  const value = String(rawSymbol || '').trim().toUpperCase();
  if (!value) return null;
  const match = value.match(/^(NSE|BSE|GLOBAL):(.+)$/);
  const symbol = (match?.[2] || value).trim();
  const exchange = match?.[1] === 'BSE' ? 'BSE' : 'NSE';
  return { symbol, exchange, key: symbol };
};

const runWorker = async (requests) => {
  const python = configuredPython();
  const { stdout } = await execFileAsync(
    python.command,
    [...python.args, SCRIPT, JSON.stringify(requests)],
    { cwd: ROOT, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  );
  const payload = JSON.parse(stdout.trim());
  return payload?.quotes && typeof payload.quotes === 'object' ? payload.quotes : {};
};

const normalizeQuote = (raw) => {
  const timestamp = Number(raw?.timestamp);
  if (!(Number(raw?.c) > 0) || !Number.isFinite(timestamp)) return null;
  const stale = Date.now() - timestamp * 1000 > 30 * 60 * 1000;
  return {
    ...raw,
    provider: 'Yahoo Finance via yfinance',
    isLive: false,
    isDelayed: true,
    isResearch: true,
    isStale: stale,
  };
};

export const getYahooResearchQuotes = async (symbols) => {
  if (!isYahooResearchEnabled()) return {};
  const requests = [...new Map(symbols.map(normalizeRequest).filter(Boolean)
    .map((item) => [`${item.exchange}:${item.key}`, item])).values()];
  if (!requests.length) return {};

  const cacheKey = requests.map((item) => `${item.exchange}:${item.key}`).sort().join(',');
  const cached = quoteCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.quotes;
  if (pendingRequests.has(cacheKey)) return pendingRequests.get(cacheKey);

  const pending = (async () => {
    const quotes = {};
    for (let offset = 0; offset < requests.length; offset += 100) {
      const chunk = requests.slice(offset, offset + 100);
      const fetched = await runWorker(chunk);
      for (const [symbol, rawQuote] of Object.entries(fetched)) {
        const quote = normalizeQuote(rawQuote);
        if (quote) quotes[symbol] = quote;
      }
    }
    quoteCache.set(cacheKey, { quotes, savedAt: Date.now() });
    if (quoteCache.size > 100) quoteCache.delete(quoteCache.keys().next().value);
    return quotes;
  })().finally(() => pendingRequests.delete(cacheKey));

  pendingRequests.set(cacheKey, pending);
  return pending;
};
