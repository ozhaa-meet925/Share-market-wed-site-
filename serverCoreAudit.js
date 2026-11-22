import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CORE_DIR } from './serverCoreStore.js';

const AUDIT_FILE = 'core-audit.jsonl';
const LOCK_FILE = 'core-audit.lock';
const MAX_DETAIL_DEPTH = 4;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;
const TAIL_BYTES = 64 * 1024;
const SENSITIVE_KEY = /pass(word)?|pin|token|secret|api[_-]?key|authorization|cookie/i;

const auditPath = () => path.join(CORE_DIR, AUDIT_FILE);
const lockPath = () => path.join(CORE_DIR, LOCK_FILE);

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

const sanitize = (value, depth = 0) => {
  if (depth > MAX_DETAIL_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      clean[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return clean;
  }
  if (typeof value === 'string') return value.slice(0, 300);
  return value;
};

const normalizeActor = (actor) => {
  if (!actor || typeof actor !== 'object') return { id: 'system', role: 'system', name: 'System' };
  return {
    id: String(actor.id || 'system').slice(0, 64),
    role: String(actor.role || 'system').slice(0, 24),
    name: String(actor.name || actor.id || 'System').slice(0, 80),
  };
};

const hashEntry = (prevHash, entry) => crypto.createHash('sha256')
  .update(`${prevHash}|${stableStringify(entry)}`)
  .digest('hex');

const readLines = () => {
  try {
    return fs.readFileSync(auditPath(), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

const readEntries = () => {
  const entries = [];
  for (const line of readLines()) {
    try { entries.push(JSON.parse(line)); } catch { /* keep the chain readable */ }
  }
  return entries;
};

const readLastEntry = () => {
  let fd;
  try {
    fd = fs.openSync(auditPath(), 'r');
    const { size } = fs.fstatSync(fd);
    if (size === 0) return null;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n').filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const entry = JSON.parse(lines[index]);
        if (Number.isInteger(entry.seq) && typeof entry.hash === 'string') return entry;
      } catch { /* skip a partially written line */ }
    }
    return null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

const sleepSync = (ms) => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* spin as a fallback */ }
  }
};

const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const lockIsStale = (file) => {
  let holder = null;
  try {
    holder = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* the holder may still be writing its lock file */ }
  if (holder && holder.pid) return !isProcessAlive(holder.pid);
  try {
    return Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
};

// Both the dev proxy and the production server can share one data directory, so the
// append must be serialised across processes or their hash chains fork.
const acquireLock = () => {
  const file = lockPath();
  const startedAt = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      return file;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (lockIsStale(file)) {
        try { fs.unlinkSync(file); } catch { /* another process may have released it */ }
        continue;
      }
      if (Date.now() - startedAt > LOCK_WAIT_MS) throw new Error('audit lock wait timed out');
      sleepSync(10 + Math.floor(Math.random() * 15));
    }
  }
};

const releaseLock = (file) => {
  if (!file) return;
  try { fs.unlinkSync(file); } catch { /* already released or stale-cleared */ }
};

export const recordAudit = ({ actor, action, resource, outcome = 'success', detail = {} }) => {
  let heldLock = null;
  try {
    fs.mkdirSync(CORE_DIR, { recursive: true });
    heldLock = acquireLock();
    const previous = readLastEntry();
    const entry = {
      seq: previous ? previous.seq + 1 : 1,
      at: new Date().toISOString(),
      actor: normalizeActor(actor),
      action: String(action || 'unknown').slice(0, 80),
      resource: String(resource || 'core').slice(0, 120),
      outcome: outcome === 'failure' || outcome === 'denied' ? outcome : 'success',
      detail: sanitize(detail),
    };
    const prevHash = previous ? previous.hash : 'GENESIS';
    const hash = hashEntry(prevHash, entry);
    const persisted = { ...entry, prevHash, hash };
    fs.appendFileSync(auditPath(), `${JSON.stringify(persisted)}\n`, 'utf8');
    return persisted;
  } catch (error) {
    console.warn('Core audit write failed:', error.message);
    return null;
  } finally {
    releaseLock(heldLock);
  }
};

export const readAudit = (limit = 40) => {
  const entries = readEntries();
  return entries.slice(-Math.max(1, Math.min(200, limit))).reverse();
};

export const verifyAudit = () => {
  const entries = readEntries();
  let prevHash = 'GENESIS';
  for (const [index, entry] of entries.entries()) {
    if (Number(entry.seq) !== index + 1) return { ok: false, entries: entries.length, brokenAt: entry.seq, reason: 'sequence gap' };
    if (entry.prevHash !== prevHash) return { ok: false, entries: entries.length, brokenAt: entry.seq, reason: 'previous hash mismatch' };
    const { hash, prevHash: storedPrev, ...rest } = entry;
    if (hashEntry(storedPrev, rest) !== hash) return { ok: false, entries: entries.length, brokenAt: entry.seq, reason: 'hash mismatch' };
    prevHash = hash;
  }
  return {
    ok: true,
    entries: entries.length,
    lastHash: prevHash,
    lastAt: entries.length ? entries[entries.length - 1].at : null,
  };
};

export const auditStatus = () => {
  const verification = verifyAudit();
  const last = readLastEntry();
  return { ...verification, file: AUDIT_FILE, seq: last ? last.seq : 0 };
};

export const auditFilePath = auditPath;
