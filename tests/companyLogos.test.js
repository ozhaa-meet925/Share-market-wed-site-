import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCompanyLogoService, detectImage, domainForSymbol, extractIconLinks, resolveBestLogo } from '../serverCompanyLogos.js';
import { companyDomains, getCompanyLogoUrls } from '../src/data/companyLogos.js';

const png = (width, height) => {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
};

const ico = (...edges) => {
  const buf = Buffer.alloc(6 + edges.length * 16);
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(edges.length, 4);
  edges.forEach((edge, i) => { buf[6 + i * 16] = edge % 256; buf[7 + i * 16] = edge % 256; });
  return buf;
};

const noDiscovery = async () => [];

const candidate = (body, source) => {
  const image = detectImage(body);
  return { body, image, source, score: Math.min(image.width, image.height) };
};

test('detectImage reads PNG, ICO and SVG dimensions and rejects non-images', () => {
  assert.deepEqual(detectImage(png(180, 120)), { type: 'image/png', width: 180, height: 120 });
  assert.deepEqual(detectImage(ico(16, 32, 256)), { type: 'image/x-icon', width: 256, height: 256 });
  assert.equal(detectImage(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')).type, 'image/svg+xml');
  assert.equal(detectImage(Buffer.from('<!doctype html><html><body>not found</body></html>')), null);
  assert.equal(detectImage(Buffer.alloc(0)), null);
});

test('resolveBestLogo keeps the sharpest real image and ignores failed sources', async () => {
  const bodies = [null, candidate(png(16, 16), 'small'), candidate(png(192, 192), 'large'), candidate(ico(48), 'mid')];
  let i = 0;
  const best = await resolveBestLogo('example.com', async () => bodies[i++], noDiscovery);
  assert.equal(best.source, 'large');
  assert.equal(await resolveBestLogo('example.com', async () => null, noDiscovery), null);
});

test('logo service caches results on disk, shares in-flight work and remembers misses', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-test-'));
  try {
    let calls = 0;
    const service = createCompanyLogoService({ cacheDir, discover: noDiscovery, fetcher: async () => { calls += 1; return candidate(png(128, 128), 'stub'); } });
    const [a, b] = await Promise.all([service.getLogo('TCS'), service.getLogo('tcs')]);
    assert.equal(a.type, 'image/png');
    assert.equal(b.edge, 128);
    const perResolve = calls;
    const again = await createCompanyLogoService({ cacheDir, discover: noDiscovery, fetcher: async () => { calls += 1; return null; } }).getLogo('TCS');
    assert.equal(again.edge, 128);
    assert.equal(calls, perResolve);

    let missCalls = 0;
    const missing = createCompanyLogoService({ cacheDir, discover: noDiscovery, fetcher: async () => { missCalls += 1; return null; } });
    assert.equal(await missing.getLogo('INFY'), null);
    const afterFirst = missCalls;
    assert.equal(await missing.getLogo('INFY'), null);
    assert.equal(missCalls, afterFirst);

    assert.equal(await service.getLogo('NOT-A-MAPPED-SYMBOL'), null);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('only mapped symbols resolve, so arbitrary input never reaches an upstream host', () => {
  assert.equal(domainForSymbol('reliance'), 'ril.com');
  assert.equal(domainForSymbol('__proto__'), null);
  assert.equal(domainForSymbol('constructor'), null);
  assert.deepEqual(getCompanyLogoUrls('M&M'), ['/api/logos/M%26M']);
  assert.deepEqual(getCompanyLogoUrls('UNKNOWNCO'), []);
});

test('domain map has valid hostnames and no known-wrong mappings', () => {
  for (const [symbol, domain] of Object.entries(companyDomains)) {
    assert.match(domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `${symbol} -> ${domain}`);
  }
  assert.notEqual(companyDomains.BAJAJHLDNG, 'bajajauto.com');
  for (const bad of ['aaboron.com', 'aboron.com', 'sfruttobykama.com', 'vfrmart.in']) {
    assert.ok(!Object.values(companyDomains).includes(bad), bad);
  }
});

test("extractIconLinks resolves declared icons and drops private or non-http targets", () => {
  const html = `<head>
    <link rel="icon" href="/img/fav-32.png">
    <link href="https://cdn.example.com/apple.png" rel="apple-touch-icon">
    <link rel="stylesheet" href="/site.css">
    <link rel="shortcut icon" href="javascript:alert(1)">
    <link rel="icon" href="http://127.0.0.1/admin.png">
    <link rel="icon" href="http://localhost/x.png">
  </head>`;
  assert.deepEqual(extractIconLinks(html, "https://www.example.com/home"), [
    "https://www.example.com/img/fav-32.png",
    "https://cdn.example.com/apple.png",
  ]);
});
