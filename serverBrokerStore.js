import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './serverDb.js';

const KEY_CONTEXT = 'sharemarket-broker-token-v1';

const readServerSecret = () => {
  if (process.env.BROKER_TOKEN_KEY) return process.env.BROKER_TOKEN_KEY;
  if (process.env.AUTH_SESSION_SECRET) return process.env.AUTH_SESSION_SECRET;
  try {
    const saved = fs.readFileSync(path.join(process.cwd(), 'data', 'auth-secret'), 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    // fall through to configuration error
  }
  throw new Error('Broker token encryption is not configured. Set BROKER_TOKEN_KEY or AUTH_SESSION_SECRET (32+ characters).');
};

const encryptionKey = () => crypto.scryptSync(readServerSecret(), KEY_CONTEXT, 32);

export const brokerStateKey = () => crypto.createHash('sha256').update(`oauth-state:${readServerSecret()}`).digest();

export const encryptToken = (plain) => {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

export const decryptToken = (stored) => {
  if (!stored) return null;
  const [version, ivPart, tagPart, dataPart] = String(stored).split(':');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) throw new Error('Unsupported broker token format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
};

const nowIso = () => new Date().toISOString();

export const syncUser = (user) => {
  if (!user?.id || !user?.phone) return;
  const timestamp = nowIso();
  getDatabase().run(
    `INSERT INTO users (id, phone, name, email, role, kyc_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       email = excluded.email,
       role = excluded.role,
       kyc_status = excluded.kyc_status,
       updated_at = excluded.updated_at`,
    user.id, user.phone, user.name || null, user.email || null, user.role || 'trader', user.kycStatus || null, timestamp, timestamp,
  );
};

export const saveBrokerAccount = ({
  userId,
  broker,
  clientId = null,
  accessToken,
  refreshToken = null,
  expiresInSeconds = null,
  mode = 'paper',
  externalUserId = null,
  userName = null,
}) => {
  const db = getDatabase();
  const timestamp = nowIso();
  const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null;
  const existing = db.get('SELECT id FROM broker_accounts WHERE user_id = ? AND broker = ?', userId, broker);
  const id = existing?.id || `BRK-${crypto.randomUUID()}`;
  db.run(
    `INSERT INTO broker_accounts (id, user_id, broker, client_id, status, access_token_cipher, refresh_token_cipher, token_expires_at, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, broker) DO UPDATE SET
       client_id = excluded.client_id,
       status = 'connected',
       access_token_cipher = excluded.access_token_cipher,
       refresh_token_cipher = COALESCE(excluded.refresh_token_cipher, broker_accounts.refresh_token_cipher),
       token_expires_at = excluded.token_expires_at,
       mode = excluded.mode,
       last_error = NULL,
       updated_at = excluded.updated_at`,
    id, userId, broker, clientId || externalUserId, encryptToken(accessToken), encryptToken(refreshToken), expiresAt, mode, timestamp, timestamp,
  );
  return getBrokerAccount(userId, broker);
};

export const getBrokerAccount = (userId, broker) => {
  const row = getDatabase().get('SELECT * FROM broker_accounts WHERE user_id = ? AND broker = ?', userId, broker);
  if (!row) return null;
  let accessToken = null;
  let refreshToken = null;
  let tokenError = null;
  try {
    accessToken = decryptToken(row.access_token_cipher);
    refreshToken = decryptToken(row.refresh_token_cipher);
  } catch (error) {
    tokenError = error.message;
  }
  return {
    id: row.id,
    userId: row.user_id,
    broker: row.broker,
    clientId: row.client_id,
    status: row.status,
    mode: row.mode,
    accessToken,
    refreshToken,
    tokenError,
    tokenExpiresAt: row.token_expires_at,
    liveAuthorized: Boolean(row.live_authorized),
    liveAuthorizedAt: row.live_authorized_at,
    lastProbeAt: row.last_probe_at,
    lastProbeStatus: row.last_probe_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const listBrokerAccounts = (userId) => getDatabase()
  .query('SELECT broker, status, mode, live_authorized, token_expires_at, last_probe_at, last_probe_status, last_error FROM broker_accounts WHERE user_id = ? ORDER BY broker', userId);

export const listAllBrokerAccounts = () => getDatabase()
  .query("SELECT user_id, broker FROM broker_accounts WHERE status = 'connected' ORDER BY updated_at DESC LIMIT 50");

export const recordProbe = (userId, broker, { status, message = null }) => {
  getDatabase().run(
    'UPDATE broker_accounts SET last_probe_at = ?, last_probe_status = ?, last_error = ?, updated_at = ? WHERE user_id = ? AND broker = ?',
    nowIso(), status, message, nowIso(), userId, broker,
  );
};

export const setLiveConsent = (userId, broker, enabled) => {
  const result = getDatabase().run(
    'UPDATE broker_accounts SET live_authorized = ?, live_authorized_at = ?, updated_at = ? WHERE user_id = ? AND broker = ?',
    enabled ? 1 : 0, enabled ? nowIso() : null, nowIso(), userId, broker,
  );
  return result.changes > 0 ? getBrokerAccount(userId, broker) : null;
};

export const disconnectBrokerAccount = (userId, broker) => {
  const result = getDatabase().run(
    `UPDATE broker_accounts SET status = 'disconnected', access_token_cipher = NULL, refresh_token_cipher = NULL,
       token_expires_at = NULL, live_authorized = 0, live_authorized_at = NULL, updated_at = ?
     WHERE user_id = ? AND broker = ?`,
    nowIso(), userId, broker,
  );
  return result.changes > 0;
};
