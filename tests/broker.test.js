import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-broker-'));
process.env.CORE_DATA_DIR = tempDir;
process.env.CORE_DB_PATH = path.join(tempDir, 'platform.sqlite');
process.env.BROKER_TOKEN_KEY = 'test-broker-token-key-with-more-than-32-characters';
delete process.env.LIVE_TRADING_ENABLED;

const store = await import('../serverBrokerStore.js');
const dbModule = await import('../serverDb.js');
const { getAdapter } = await import('../serverBrokers/index.js');

dbModule.openDatabase({ file: process.env.CORE_DB_PATH });

test.after(() => {
  dbModule.closeDatabase();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const user = { id: 'USR-BROKER', phone: '9000000009', name: 'Broker Test', role: 'trader', kycStatus: 'active' };
store.syncUser(user);

test('tokens are encrypted at rest and decrypt only with the server key', () => {
  const cipher = store.encryptToken('upstox-secret-token');
  assert.match(cipher, /^v1:/);
  assert.ok(!cipher.includes('upstox-secret-token'));
  assert.equal(store.decryptToken(cipher), 'upstox-secret-token');
  const tampered = `${cipher.slice(0, -4)}AAAA`;
  assert.throws(() => store.decryptToken(tampered));
});

test('broker accounts persist with encrypted tokens and connection state', () => {
  const saved = store.saveBrokerAccount({
    userId: user.id,
    broker: 'upstox',
    clientId: 'UP123',
    accessToken: 'access-plain',
    refreshToken: 'refresh-plain',
    expiresInSeconds: 3600,
    mode: 'sandbox',
  });
  assert.equal(saved.status, 'connected');
  assert.equal(saved.mode, 'sandbox');
  assert.equal(saved.accessToken, 'access-plain');
  assert.equal(saved.refreshToken, 'refresh-plain');

  const raw = dbModule.getDatabase().get('SELECT access_token_cipher, refresh_token_cipher FROM broker_accounts WHERE user_id = ?', user.id);
  assert.ok(!raw.access_token_cipher.includes('access-plain'));
  assert.ok(!raw.refresh_token_cipher.includes('refresh-plain'));
});

test('live consent is off by default, can be granted, and is cleared on disconnect', () => {
  const initial = store.getBrokerAccount(user.id, 'upstox');
  assert.equal(initial.liveAuthorized, false);

  const granted = store.setLiveConsent(user.id, 'upstox', true);
  assert.equal(granted.liveAuthorized, true);
  assert.ok(granted.liveAuthorizedAt);

  const revoked = store.setLiveConsent(user.id, 'upstox', false);
  assert.equal(revoked.liveAuthorized, false);

  store.setLiveConsent(user.id, 'upstox', true);
  assert.equal(store.disconnectBrokerAccount(user.id, 'upstox'), true);
  const disconnected = store.getBrokerAccount(user.id, 'upstox');
  assert.equal(disconnected.accessToken, null);
  assert.equal(disconnected.liveAuthorized, false);
  assert.equal(disconnected.status, 'disconnected');
});

test('oauth login URLs are generated from configuration, never from client input', () => {
  process.env.UPSTOX_CLIENT_ID = 'upstox-client-id';
  process.env.UPSTOX_CLIENT_SECRET = 'upstox-client-secret';
  process.env.UPSTOX_REDIRECT_URI = 'http://localhost:4000/api/brokers/upstox/callback';
  process.env.ZERODHA_API_KEY = 'kite-key';
  process.env.ZERODHA_API_SECRET = 'kite-secret';

  const upstox = getAdapter('upstox');
  const upstoxUrl = new URL(upstox.getLoginUrl('signed-state'));
  assert.equal(upstoxUrl.origin, 'https://api.upstox.com');
  assert.equal(upstoxUrl.searchParams.get('client_id'), 'upstox-client-id');
  assert.equal(upstoxUrl.searchParams.get('state'), 'signed-state');

  const zerodha = getAdapter('zerodha');
  const kiteUrl = new URL(zerodha.getLoginUrl('signed-state'));
  assert.equal(kiteUrl.origin, 'https://kite.zerodha.com');
  assert.equal(kiteUrl.searchParams.get('api_key'), 'kite-key');
  assert.match(kiteUrl.searchParams.get('redirect_params'), /signed-state/);

  delete process.env.UPSTOX_CLIENT_ID;
  delete process.env.UPSTOX_CLIENT_SECRET;
  delete process.env.UPSTOX_REDIRECT_URI;
  delete process.env.ZERODHA_API_KEY;
  delete process.env.ZERODHA_API_SECRET;
});

test('adapters report honest capabilities and refuse orders in paper mode', async () => {
  const upstox = getAdapter('upstox');
  const zerodha = getAdapter('zerodha');
  assert.equal(upstox.capabilities().marketDataFeed.supported, false);
  assert.equal(zerodha.capabilities().marketDataFeed.supported, false);
  assert.match(upstox.capabilities().marketDataFeed.reason, /decoder/i);
  assert.equal(upstox.capabilities().orderPlacement, false);
  assert.equal(zerodha.capabilities().orderPlacement, false);
  assert.equal(upstox.capabilities().instruments.supported, false, 'no instrument downloader is bundled');
  assert.equal(zerodha.capabilities().gtt.supported, false, 'GTT must not be claimed before it is wired');

  await assert.rejects(
    upstox.placeOrder('token', { instrumentToken: 'NSE_EQ|INE002A01018', side: 'BUY', quantity: 1 }),
    (error) => error.code === 'live_trading_disabled',
  );
  await assert.rejects(
    zerodha.placeOrder('token', { tradingsymbol: 'RELIANCE', side: 'BUY', quantity: 1 }),
    (error) => error.code === 'live_trading_disabled',
  );
});

test('order submission cannot be forced on by client configuration alone', async () => {
  process.env.UPSTOX_TRADING_MODE = 'sandbox';
  delete process.env.UPSTOX_SANDBOX_API_BASE;
  const upstox = getAdapter('upstox');
  assert.equal(upstox.capabilities().orderPlacement, false);
  await assert.rejects(
    upstox.placeOrder('token', { instrumentToken: 'NSE_EQ|INE002A01028', side: 'SELL', quantity: 1 }),
    (error) => error.code === 'sandbox_not_configured',
  );
  delete process.env.UPSTOX_TRADING_MODE;
});

test('unknown brokers are rejected by the registry', () => {
  assert.equal(getAdapter('angel'), null);
  assert.equal(getAdapter(''), null);
});
