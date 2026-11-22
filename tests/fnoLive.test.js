import test from 'node:test';
import assert from 'node:assert/strict';
import { nseDateToIso, isoToNseDate, parseLiveOptionChain, parseLiveFutures, createFnoLiveService } from '../serverFnoLive.js';

const leg = (overrides) => ({
  strikePrice: 25000,
  expiryDates: '27-Nov-2026',
  lastPrice: 120.5,
  change: 8.25,
  pChange: 7.35,
  openInterest: 45000,
  changeinOpenInterest: 3200,
  totalTradedVolume: 125000,
  impliedVolatility: 12.4,
  buyPrice1: 120.4,
  sellPrice1: 120.6,
  identifier: 'OPTIDX',
  underlyingValue: 25200,
  ...overrides,
});

const chainPayload = () => ({
  records: {
    timestamp: '19-Nov-2026 11:23:14',
    underlyingValue: 25215.4,
    expiryDates: ['27-Nov-2026', '04-Dec-2026'],
    data: [
      {
        expiryDates: '27-Nov-2026',
        CE: leg({ strikePrice: 25000, identifier: 'NIFTY27NOV2625000CE' }),
        PE: leg({ strikePrice: 25000, identifier: 'NIFTY27NOV2625000PE', lastPrice: 95.2, openInterest: 61000 }),
      },
      {
        expiryDates: '27-Nov-2026',
        CE: leg({ strikePrice: 25300, identifier: 'NIFTY27NOV2625300CE', lastPrice: 78.1, openInterest: 30000 }),
        PE: leg({ strikePrice: 25300, identifier: 'NIFTY27NOV2625300PE', lastPrice: 148.6, openInterest: 52000 }),
      },
      {
        expiryDates: '04-Dec-2026',
        CE: leg({ strikePrice: 25500, identifier: 'NIFTY04DEC2625500CE', lastPrice: 240.9, openInterest: 99999 }),
        PE: leg({ strikePrice: 25500, identifier: 'NIFTY04DEC2625500PE', lastPrice: 260.1, openInterest: 99999 }),
      },
    ],
  },
});

test('nseDateToIso and isoToNseDate round trip NSE expiry formats', () => {
  assert.equal(nseDateToIso('27-Nov-2026'), '2026-11-27');
  assert.equal(nseDateToIso('09-03-2027'), '2027-03-09');
  assert.equal(nseDateToIso('2026-11-27'), '2026-11-27');
  assert.equal(nseDateToIso('garbage'), null);
  assert.equal(isoToNseDate('2026-11-27'), '27-Nov-2026');
  assert.equal(isoToNseDate('27-11-2026'), null);
});

test('parseLiveOptionChain maps the exchange snapshot to the desk shape', () => {
  const chain = parseLiveOptionChain(chainPayload(), { ticker: 'NIFTY', now: new Date('2026-11-19T06:00:00Z') });
  assert.ok(chain);
  assert.equal(chain.underlying, 'NIFTY');
  assert.equal(chain.isLive, true);
  assert.equal(chain.underlyingPrice, 25215.4);
  assert.equal(chain.expiry, '2026-11-27');
  assert.deepEqual(chain.expiries, ['2026-11-27', '2026-12-04']);
  assert.equal(chain.asOf, '2026-11-19T11:23:14+05:30');
  assert.equal(chain.exchangeTimestamp, '19-Nov-2026 11:23:14');
  assert.equal(chain.tradeDate, '2026-11-19');
  assert.equal(chain.strikes.length, 2);
  assert.equal(chain.atmStrike, 25300);

  const atm = chain.strikes.find((row) => row.isAtm);
  assert.equal(atm.strike, 25300);
  assert.equal(atm.call.ltp, 78.1);
  assert.equal(atm.call.oi, 30000);
  assert.equal(atm.call.oiChange, 3200);
  assert.equal(atm.call.volume, 125000);
  assert.equal(atm.call.bid, 120.4);
  assert.equal(atm.call.ask, 120.6);
  assert.equal(atm.call.iv, 12.4);
  assert.ok(atm.call.delta > 0.3 && atm.call.delta < 0.65);
  assert.ok(atm.call.theta < 0);
  assert.ok(atm.put.delta < 0);
  assert.ok(atm.put.delta > -0.7);

  assert.equal(chain.totalCallOi, 45000 + 30000);
  assert.equal(chain.totalPutOi, 61000 + 52000);
  assert.equal(chain.pcr, Math.round((113000 / 75000) * 100) / 100);
  assert.equal(chain.pcrSentiment, 'Call-heavy · bullish tilt');
  assert.ok([25000, 25300].includes(chain.maxPain));
});

test('parseLiveOptionChain honours a requested expiry and ignores other tenors', () => {
  const chain = parseLiveOptionChain(chainPayload(), { ticker: 'NIFTY', expiry: '04-Dec-2026' });
  assert.equal(chain.expiry, '2026-12-04');
  assert.equal(chain.strikes.length, 1);
  assert.equal(chain.strikes[0].strike, 25500);
});

test('parseLiveOptionChain returns null without usable rows', () => {
  assert.equal(parseLiveOptionChain({ records: { data: [] } }, { ticker: 'NIFTY' }), null);
  assert.equal(parseLiveOptionChain(null, { ticker: 'NIFTY' }), null);
});

test('parseLiveFutures keeps one underlying, sorts expiries and computes basis', () => {
  const payload = {
    timestamp: '19-Nov-2026 11:23:14',
    marketStatus: { marketStatusMessage: 'Normal Market is Open' },
    data: [
      {
        underlying: 'NIFTY', contract: 'NIFTY 25 DEC 26', expiryDate: '24-Dec-2026',
        lastPrice: 25410.2, change: 120.4, pChange: 0.48, openInterest: 8123400,
        volume: 152000, underlyingValue: 25215.4, openPrice: 25300, highPrice: 25490, lowPrice: 25260,
        instrument: 'Index Futures',
      },
      {
        underlying: 'NIFTY', contract: 'NIFTY 27 NOV 26', expiryDate: '26-Nov-2026',
        lastPrice: 25268.75, change: 55.1, pChange: 0.22, openInterest: 12340000,
        volume: 980000, underlyingValue: 25215.4, openPrice: 25240, highPrice: 25310, lowPrice: 25190,
        instrument: 'Index Futures',
      },
      {
        underlying: 'BANKNIFTY', contract: 'BANKNIFTY 27 NOV 26', expiryDate: '26-Nov-2026',
        lastPrice: 57400.1, change: -10, pChange: -0.02, openInterest: 1, volume: 1, underlyingValue: 57300,
      },
    ],
  };
  const board = parseLiveFutures(payload, { ticker: 'NIFTY' });
  assert.ok(board);
  assert.equal(board.isLive, true);
  assert.equal(board.contracts.length, 2);
  assert.equal(board.contracts[0].expiry, '2026-11-26');
  assert.equal(board.contracts[1].expiry, '2026-12-24');
  assert.equal(board.underlyingPrice, 25215.4);
  assert.equal(board.contracts[0].basis, Math.round((25268.75 - 25215.4) * 100) / 100);
  assert.equal(board.contracts[0].oiChange, null);
  assert.equal(board.contracts[0].open, 25240);
  assert.equal(board.asOf, '2026-11-19T11:23:14+05:30');
  assert.equal(board.marketStatus.marketStatusMessage, 'Normal Market is Open');
  assert.equal(parseLiveFutures(payload, { ticker: 'RELIANCE' }), null);
});

test('live service caches and de-duplicates concurrent NSE requests', async () => {
  const calls = [];
  let chainHits = 0;
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes('option-chain-contract-info')) {
      return { expiryDates: ['27-Nov-2026', '04-Dec-2026'] };
    }
    if (url.includes('option-chain-v3')) {
      chainHits += 1;
      return chainPayload();
    }
    return { timestamp: '19-Nov-2026 11:23:14', marketStatus: { marketStatusMessage: 'Open' }, data: [] };
  };
  const service = createFnoLiveService({ fetcher });

  const first = await service.chain({ ticker: 'NIFTY' });
  const second = await service.chain({ ticker: 'NIFTY' });
  assert.equal(first.isLive, true);
  assert.equal(second.underlyingPrice, first.underlyingPrice);
  assert.equal(chainHits, 1);
  assert.ok(calls.some((url) => url.includes('expiry=27-Nov-2026')), 'expiry parameter must be sent to NSE');
  assert.ok(calls.every((url) => url.includes('nseindia.in')));

  const [a, b] = await Promise.all([
    service.chain({ ticker: 'BANKNIFTY' }),
    service.chain({ ticker: 'BANKNIFTY' }),
  ]);
  assert.equal(a.underlying, 'BANKNIFTY');
  assert.deepEqual(a.expiries, b.expiries);
  assert.equal(chainHits, 2);
});

test('live service status reports the exchange timestamp and market message', async () => {
  const fetcher = async (url) => {
    assert.ok(url.includes('liveEquity-derivatives?index=nse50_fut'));
    return { timestamp: '19-Nov-2026 11:23:14', marketStatus: { marketStatusMessage: 'Normal Market is Open' }, data: [] };
  };
  const service = createFnoLiveService({ fetcher });
  const status = await service.status();
  assert.equal(status.isLive, true);
  assert.equal(status.asOf, '2026-11-19T11:23:14+05:30');
  assert.equal(status.tradeDate, '2026-11-19');
  assert.equal(status.marketStatus.marketStatusMessage, 'Normal Market is Open');
});
