import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

delete process.env.LIVE_TRADING_ENABLED;
process.env.UPSTOX_CLIENT_SECRET = 'super-secret-value-that-must-not-leak';

const compliance = await import('../serverCompliance.js');

test('market-data server never synthesises price movement', () => {
  const sources = ['server.js', 'yfinanceResearchProvider.js', 'nseIndexProvider.js', 'kunDataProvider.js'];
  for (const file of sources) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Math\.random\s*\(/, `${file} must not randomise market data`);
    assert.doesNotMatch(source, /microTick|liveTickState/i, `${file} must not apply synthetic ticks`);
  }
});

test('compliance status reports gated live trading and both broker adapters', () => {
  const status = compliance.complianceStatus();
  assert.equal(status.liveTrading.enabled, false);
  assert.equal(status.liveTrading.ordersRouted, false);
  assert.deepEqual(status.brokers.map((broker) => broker.id).sort(), ['upstox', 'zerodha']);
  assert.ok(status.brokers.every((broker) => broker.orderPlacement === false));
});

test('data sources are labelled honestly, including the missing Investing.com API', () => {
  const sources = compliance.complianceStatus().dataSources;
  const byId = Object.fromEntries(sources.map((source) => [source.id, source]));
  assert.equal(byId.investing_com.status, 'not_integrated');
  assert.match(byId.investing_com.detail, /No official public API/);
  assert.equal(byId.yahoo_research.status, 'available');
  assert.equal(byId.nse_index_feed.status, 'available');
  assert.equal(byId.bse_index_feed.status, 'not_connected');
  assert.ok(['configured', 'not_connected'].includes(byId.nse_live.status));
  assert.ok(byId.economic_calendar.status === 'not_configured' || byId.economic_calendar.status === 'configured');
});

test('compliance payload never contains server secrets', () => {
  const serialized = JSON.stringify(compliance.complianceStatus());
  assert.ok(!serialized.includes('super-secret-value-that-must-not-leak'));
  for (const value of Object.values(process.env)) {
    if (typeof value === 'string' && value.length >= 12 && /secret|token|key/i.test(value)) {
      assert.ok(!serialized.includes(value), 'compliance payload leaked an environment value');
    }
  }
});

test('compliance disclosures cover broker, algo and market-data obligations', () => {
  const status = compliance.complianceStatus();
  const ids = status.disclosures.map((item) => item.id);
  for (const required of ['not-a-broker', 'broker-authorization', 'algo-rules', 'market-data', 'no-secrets']) {
    assert.ok(ids.includes(required), `missing disclosure ${required}`);
  }
});

test('compliance route is registered', () => {
  const registered = [];
  compliance.registerComplianceRoutes({ get: (route) => registered.push(route) });
  assert.deepEqual(registered, ['/api/compliance/status']);
});
