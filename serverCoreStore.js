import fs from 'node:fs';
import path from 'node:path';

export const CORE_DIR = path.resolve(process.cwd(), process.env.CORE_DATA_DIR || path.join('data', 'core'));

const ensureDir = () => {
  fs.mkdirSync(CORE_DIR, { recursive: true });
};

const filePath = (name) => path.join(CORE_DIR, name);
const backupPath = (name) => `${filePath(name)}.bak`;
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

const parseFile = (target) => {
  const raw = fs.readFileSync(target, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Store payload is not an object');
  return parsed;
};

export const readStore = (name, fallback) => {
  try {
    return parseFile(filePath(name));
  } catch {
    try {
      return parseFile(backupPath(name));
    } catch {
      return clone(fallback);
    }
  }
};

export const writeStore = (name, data) => {
  ensureDir();
  const target = filePath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    if (fs.existsSync(target)) fs.copyFileSync(target, backupPath(name));
    const payload = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, payload, 'utf8');
    let renamed = false;
    for (let attempt = 0; attempt < 8 && !renamed; attempt += 1) {
      try {
        fs.renameSync(tmp, target);
        renamed = true;
      } catch {
        // Antivirus/OneDrive/another writer can hold the target briefly; retry immediately.
      }
    }
    if (!renamed) fs.writeFileSync(target, payload, 'utf8');
    return { ok: true, file: name, bytes: fs.statSync(target).size, updatedAt: new Date().toISOString() };
  } catch (error) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
    return { ok: false, file: name, error: error.message };
  }
};

const inspectFile = (target) => {
  try {
    const stats = fs.statSync(target);
    const parsed = parseFile(target);
    return {
      ok: true,
      bytes: stats.size,
      updatedAt: stats.mtime.toISOString(),
      records: Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length,
    };
  } catch (error) {
    return { ok: false, error: error.code === 'ENOENT' ? 'missing' : error.message };
  }
};

export const storeHealth = (names = []) => {
  ensureDir();
  return names.map((name) => ({
    name,
    primary: inspectFile(filePath(name)),
    backup: inspectFile(backupPath(name)),
  }));
};

export const probeWrite = () => {
  ensureDir();
  const probe = filePath('.write-probe');
  const startedAt = Date.now();
  try {
    fs.writeFileSync(probe, `${Date.now()}`, 'utf8');
    const value = fs.readFileSync(probe, 'utf8');
    fs.unlinkSync(probe);
    return { ok: value === String(startedAt) || Number(value) > 0, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, error: error.message, latencyMs: Date.now() - startedAt };
  }
};
