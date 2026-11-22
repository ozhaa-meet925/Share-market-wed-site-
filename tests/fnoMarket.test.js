import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  parseBhavcopyCsv,
  readZipEntries,
  blackScholes,
  impliedVolatility,
  maxPainFrom,
  buildOptionChain,
  buildFuturesBoard,
  listFnoUnderlyings,
  istDate,
  createFnoMarketService,
} from '../serverFnoMarket.js';

const HEADER = 'TradDt,FinInstrmTp,TckrSymb,XpryDt,StrkPric,OptnTp,FinInstrmNm,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,NewBrdLotQty';

const row = (values) => [
  values.date, values.type, values.ticker, values.expiry,
  values.strike ?? '', values.optionType ?? '', values.name,
  values.close, values.last, values.prev, values.underlying,
  values.settlement, values.oi, values.oiChange, values.volume, values.lot,
].join(',');

const csv = (...lines) => [HEADER, ...lines].join('\n');

const sample = csv(
  row({
    date: '2026-11-18', type: 'IDO', ticker: 'NIFTY', expiry: '2026-11-23', strike: 25100, optionType: 'CE',
    name: 'NIFTY26NOV25100CE', close: 210, last: 210.5, prev: 260, underlying: 25227.95, settlement: 211, oi: 1000, oiChange: 200, volume: 5000, lot: 65,
  }),
  row({
    date: '2026-11-18', type: 'IDO', ticker: 'NIFTY', expiry: '2026-11-23', strike: 25100, optionType: 'PE',
    name: 'NIFTY26NOV25100PE', close: 90, last: 89.5, prev: 70, underlying: 25227.95, settlement: 90, oi: 1500, oiChange: -100, volume: 4000, lot: 65,
  }),
  row({
    date: '2026-11-18', type: 'IDO', ticker: 'NIFTY', expiry: '2026-11-23', strike: 25300, optionType: 'CE',
    name: 'NIFTY26NOV25300CE', close: 60, last: 60, prev: 80, underlying: 25227.95, settlement: 60, oi: 800, oiChange: -50, volume: 2000, lot: 65,
  }),
  row({
    date: '2026-11-18', type: 'IDO', ticker: 'NIFTY', expiry: '2026-11-23', strike: 25300, optionType: 'PE',
    name: 'NIFTY26NOV25300PE', close: 180, last: 181, prev: 200, underlying: 25227.95, settlement: 180, oi: 900, oiChange: 400, volume: 3000, lot: 65,
  }),
  row({
    date: '2026-11-18', type: 'IDF', ticker: 'NIFTY', expiry: '2026-11-23',
    name: 'NIFTY26NOVFUT', close: 25250, last: 25252, prev: 25310, underlying: 25227.95, settlement: 25249, oi: 12000, oiChange: 500, volume: 90000, lot: 65,
  }),
  row({
    date: '2026-11-18', type: 'STO', ticker: 'RELIANCE', expiry: '2026-11-26', strike: 1500, optionType: 'CE',
    name: 'RELIANCE26NOV1500CE', close: 22, last: 22, prev: 19, underlying: 1478.3, settlement: 22, oi: 500, oiChange: 30, volume: 700, lot: 500,
  }),
  row({
    date: '2026-11-18', type: 'STF', ticker: 'RELIANCE', expiry: '2026-11-26',
    name: 'RELIANCE26NOVFUT', close: 1481, last: 1481.5, prev: 1470, underlying: 1478.3, settlement: 1480, oi: 3000, oiChange: 250, volume: 12000, lot: 500,
  }),
  row({
    date: '2026-11-18', type: 'IDO', ticker: 'NIFTY', expiry: '2026-12-01', strike: 25200, optionType: 'CE',
    name: 'NIFTY26DEC25200CE', close: 300, last: 301, prev: 320, underlying: 25227.95, settlement: 300, oi: 250, oiChange: 10, volume: 900, lot: 65,
  }),
);

const makeZip = (name, text) => {
  const data = Buffer.from(text, 'utf8');
  const compressed = zlib.deflateRawSync(data);
  const nameBuffer = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBuffer.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuffer.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBuffer, compressed, central, nameBuffer, eocd]);
};

test('readZipEntries inflates a deflated CSV member', () => {
  const entries = readZipEntries(makeZip('BhavCopy.csv', 'hello,world'));
  assert.equal(entries.size, 1);
  assert.equal(entries.get('BhavCopy.csv').toString('utf8'), 'hello,world');
});

test('readZipEntries rejects data that is not a ZIP archive', () => {
  assert.throws(() => readZipEntries(Buffer.from('not a zip')), /ZIP/);
});

test('parseBhavcopyCsv keeps only derivatives rows and numbers', () => {
  const parsed = parseBhavcopyCsv(sample);
  assert.equal(parsed.tradeDate, '2026-11-18');
  assert.equal(parsed.rows.length, 8);
  const option = parsed.rows.find((item) => item.name === 'NIFTY26NOV25100CE');
  assert.equal(option.strike, 25100);
  assert.equal(option.optionType, 'CE');
  assert.equal(option.underlyingPrice, 25227.95);
  assert.equal(option.lotSize, 65);
});

test('parseBhavcopyCsv reports missing columns instead of guessing', () => {
  assert.throws(() => parseBhavcopyCsv('TradDt,FinInstrmTp\n2026-11-18,IDO'), /missing columns/);
});

test('impliedVolatility recovers the volatility used to price an option', () => {
  const spot = 25227.95;
  const strike = 25250;
  const years = 5 / 365;
  const target = 0.16;
  const priced = blackScholes({ spot, strike, years, volatility: target, optionType: 'CE' });
  const recovered = impliedVolatility({ price: priced.price, spot, strike, years, optionType: 'CE' });
  assert.ok(Math.abs(recovered - target) < 0.002, `expected ~${target}, got ${recovered}`);
});

test('impliedVolatility refuses prices below intrinsic value', () => {
  const value = impliedVolatility({ price: 10, spot: 26000, strike: 25000, years: 0.02, optionType: 'CE' });
  assert.equal(value, null);
});

test('maxPainFrom picks the strike with the smallest writer payout', () => {
  const strikes = [
    { strike: 100, call: { oi: 1000 }, put: { oi: 0 } },
    { strike: 110, call: { oi: 500 }, put: { oi: 500 } },
    { strike: 120, call: { oi: 1000 }, put: { oi: 1000 } },
  ];
  assert.equal(maxPainFrom(strikes), 110);
});

test('buildOptionChain aggregates both legs, PCR and ATM for one expiry', () => {
  const { rows } = parseBhavcopyCsv(sample);
  const chain = buildOptionChain(rows, { ticker: 'nifty', expiry: '2026-11-23' });
  assert.equal(chain.underlying, 'NIFTY');
  assert.equal(chain.expiry, '2026-11-23');
  assert.deepEqual(chain.expiries, ['2026-11-23', '2026-12-01']);
  assert.equal(chain.underlyingPrice, 25227.95);
  assert.equal(chain.lotSize, 65);
  assert.equal(chain.strikes.length, 2);
  assert.equal(chain.totalCallOi, 1800);
  assert.equal(chain.totalPutOi, 2400);
  assert.equal(chain.pcr, 1.33);
  assert.equal(chain.pcrSentiment, 'Call-heavy · bullish tilt');
  assert.equal(chain.strikes.find((item) => item.isAtm)?.strike, 25300);
  assert.equal(chain.strikes[0].call.ltp, 210.5);
  assert.equal(chain.strikes[0].call.change, -49.5);
});

test('buildOptionChain defaults to the nearest expiry and can fall back', () => {
  const { rows } = parseBhavcopyCsv(sample);
  const chain = buildOptionChain(rows, { ticker: 'NIFTY' });
  assert.equal(chain.expiry, '2026-11-23');
  const wide = buildOptionChain(rows, { ticker: 'NIFTY', expiry: '2026-12-01' });
  assert.equal(wide.strikes.length, 1);
});

test('buildOptionChain returns null for an underlying without listed options', () => {
  const { rows } = parseBhavcopyCsv(sample);
  assert.equal(buildOptionChain(rows, { ticker: 'INFY' }), null);
});

test('buildFuturesBoard lists every expiry with basis against the underlying', () => {
  const { rows } = parseBhavcopyCsv(sample);
  const board = buildFuturesBoard(rows, { ticker: 'RELIANCE' });
  assert.equal(board.contracts.length, 1);
  const contract = board.contracts[0];
  assert.equal(contract.expiry, '2026-11-26');
  assert.equal(contract.price, 1481.5);
  assert.equal(contract.lotSize, 500);
  assert.equal(contract.basis, 3.2);
});

test('listFnoUnderlyings ranks index symbols first', () => {
  const { rows } = parseBhavcopyCsv(sample);
  const list = listFnoUnderlyings(rows);
  assert.deepEqual(list.slice(0, 2), [
    { symbol: 'NIFTY', kind: 'index' },
    { symbol: 'RELIANCE', kind: 'stock' },
  ]);
});

test('istDate formats dates in India time', () => {
  assert.equal(istDate(new Date('2026-11-18T19:00:00Z')), '2026-11-19');
  assert.equal(istDate(new Date('2026-11-18T10:00:00Z')), '2026-11-18');
});

test('service skips the weekend and loads the latest trading-day archive', async () => {
  const requested = [];
  const service = createFnoMarketService({
    now: () => new Date('2026-11-21T12:00:00+05:30'),
    fetcher: async (url) => {
      requested.push(url);
      return makeZip('BhavCopy_NSE_FO.csv', sample);
    },
  });
  const chain = await service.chain({ ticker: 'NIFTY' });
  assert.equal(chain.underlying, 'NIFTY');
  assert.equal(chain.isLive, false);
  assert.equal(chain.dataQuality, 'End-of-day');
  assert.equal(requested.length, 1);
  assert.match(requested[0], /20261120/);
});

test('service surfaces an explicit unavailable error when every archive fails', async () => {
  const service = createFnoMarketService({
    now: () => new Date('2026-11-18T12:00:00+05:30'),
    fetcher: async () => { throw new Error('network down'); },
  });
  await assert.rejects(() => service.status(), (error) => {
    assert.equal(error.code, 'fno_feed_unavailable');
    return true;
  });
});
