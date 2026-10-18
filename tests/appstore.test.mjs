import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clipOne } from '../clip.mjs';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { appStoreId, sizedShot, lookupApp } from '../lib/appstore.mjs';

const defaults = { tags: [], title: '', kind: '', note: '', shot: false, allImages: false };
const APP_URL = 'https://apps.apple.com/gb/app/some-visualizer/id1234567890';

async function vault(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-appstore-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'clips'));
  await mkdir(path.join(dir, 'attachments'));
  return { vault: dir, clipsDir: 'clips', attachmentsDir: 'attachments' };
}

// Distinct bytes per image so content addressing yields distinct attachments.
function png(marker, w = 640, h = 1386) {
  const buf = Buffer.alloc(8192, marker);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf);
  buf.writeUInt32BE(w, 16); buf.writeUInt32BE(h, 20);
  return buf;
}

const LOOKUP_APP = {
  trackId: 1234567890,
  trackName: 'Some Visualizer',
  sellerName: 'Example Studio',
  formattedPrice: 'Free',
  userRatingCount: 7181,
  averageUserRating: 4.58123,
  primaryGenreName: 'Music',
  version: '3.2.4',
  releaseDate: '2017-06-25T12:32:13Z',
  currentVersionReleaseDate: '2026-08-20T10:20:44Z',
  description: 'Full store description, the copy that drifts between versions.',
  screenshotUrls: [
    'https://is1-ssl.mzstatic.com/image/thumb/A/v4/shot_1.png/392x696bb.png',
    'https://is1-ssl.mzstatic.com/image/thumb/A/v4/shot_2.png/392x696bb.png',
  ],
  ipadScreenshotUrls: ['https://is1-ssl.mzstatic.com/image/thumb/A/v4/pad_1.png/576x768bb.png'],
};

/** Page HTML with only the icon card as og:image, the shape apps.apple.com serves. */
function network(t, { lookup = { resultCount: 1, results: [LOOKUP_APP] }, lookupStatus = 200 } = {}) {
  const calls = [];
  const mock = t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://itunes.apple.com/lookup')) {
      return new Response(JSON.stringify(lookup), { status: lookupStatus, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/og-icon-card.png')) return new Response(png(9, 1200, 630), { headers: { 'content-type': 'image/png' } });
    const shot = url.match(/shot_(\d)\.png\/1242x0w\.jpg$/);
    if (shot) return new Response(png(Number(shot[1])), { headers: { 'content-type': 'image/png' } });
    if (url.includes('pad_1')) return new Response(png(7), { headers: { 'content-type': 'image/png' } });
    return new Response('<title>Some Visualizer App - App Store</title><meta property="og:image" content="/og-icon-card.png">', {
      headers: { 'content-type': 'text/html' },
    });
  });
  return { mock, calls };
}

test('appStoreId accepts app URLs with their storefront and rejects everything else', () => {
  assert.deepEqual(appStoreId(APP_URL), { id: '1234567890', country: 'gb' });
  assert.deepEqual(appStoreId('https://apps.apple.com/app/x/id1234567890?pt=1&ct=site'), { id: '1234567890', country: 'us' });
  assert.deepEqual(appStoreId('https://itunes.apple.com/us/app/old/id1217138942?mt=12'), { id: '1217138942', country: 'us' });
  assert.equal(appStoreId('https://apps.apple.com/us/developer/someone/id376551726x'), null);
  assert.equal(appStoreId('https://example.com/us/app/x/id1234567890'), null);
  assert.equal(appStoreId('not a url'), null);
});

test('sizedShot requests a legible JPEG and leaves unrecognised URLs alone', () => {
  assert.equal(sizedShot('https://is1-ssl.mzstatic.com/a/b.png/392x696bb.png'), 'https://is1-ssl.mzstatic.com/a/b.png/1242x0w.jpg');
  assert.equal(sizedShot('https://example.com/plain.png'), 'https://example.com/plain.png');
});

test('an App Store clip carries the screenshots and store fields, not the icon card', async (t) => {
  const cfg = await vault(t);
  const { calls } = network(t);
  const notePath = await clipOne(APP_URL, { ...defaults, tags: ['apple-music'] }, cfg);
  const { data, body } = parseFrontmatter(await readFile(notePath, 'utf8'));

  assert.equal(data.title, 'Some Visualizer');
  assert.equal(data.media.length, 2, 'both iPhone screenshots, no icon card, no iPad fallback');
  assert.deepEqual(data.mediaSource, ['appstore-screenshot']);
  assert.equal(data.cover, data.media[0]);
  assert.ok(!calls.some((u) => u.includes('og-icon-card')), 'the icon card is not downloaded');
  assert.ok(!calls.some((u) => u.includes('pad_1')), 'iPad shots only stand in for missing iPhone shots');
  assert.ok(calls.some((u) => u.includes('country=gb')), 'the lookup uses the URL storefront');

  assert.equal(data.appId, '1234567890');
  assert.equal(data.storefront, 'gb');
  assert.equal(data.shotDevice, 'iphone');
  assert.equal(data.seller, 'Example Studio');
  assert.equal(data.price, 'Free');
  assert.equal(data.ratings, 7181);
  assert.equal(data.stars, 4.58);
  assert.equal(data.updated, '2026-08-20');
  assert.equal(data.released, '2017-06-25');
  assert.match(body, /copy that drifts between versions/);
});

test('an app with no iPhone or iPad screenshots uses its Apple TV screenshots', async (t) => {
  const cfg = await vault(t);
  const tvOnly = { ...LOOKUP_APP, screenshotUrls: [], ipadScreenshotUrls: [],
    appletvScreenshotUrls: ['https://is1-ssl.mzstatic.com/image/thumb/A/v4/shot_3.png/1920x1080bb.png'] };
  network(t, { lookup: { resultCount: 1, results: [tvOnly] } });
  const { data } = parseFrontmatter(await readFile(await clipOne(APP_URL, { ...defaults }, cfg), 'utf8'));
  assert.equal(data.media.length, 1);
  assert.equal(data.shotDevice, 'appletv');
  assert.equal(data.ratings, 7181);
  assert.equal(data.platform, 'ios');
});

test('a failed or empty lookup falls back to the ordinary page capture', async (t) => {
  for (const variant of [{ lookupStatus: 503 }, { lookup: { resultCount: 0, results: [] } }]) {
    const cfg = await vault(t);
    network(t, variant);
    const notePath = await clipOne(APP_URL, { ...defaults }, cfg);
    const { data } = parseFrontmatter(await readFile(notePath, 'utf8'));
    assert.equal(data.title, 'Some Visualizer App - App Store');
    assert.deepEqual(data.mediaSource, ['meta-og']);
    assert.equal(data.appId, undefined);
    t.mock.restoreAll();
  }
});

test('non-App Store URLs never call the lookup API', async (t) => {
  const cfg = await vault(t);
  const { calls } = network(t);
  await clipOne('https://example.com/article', { ...defaults }, cfg);
  assert.ok(!calls.some((u) => u.includes('itunes.apple.com/lookup')));
});

test('a throttled lookup waits and retries instead of falling back to the icon card', async () => {
  let calls = 0;
  const waits = [];
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response('Rate limit has been exceeded for: itunes-apple-com', { status: 200 });
    if (calls === 2) return new Response('', { status: 403 });
    return new Response(JSON.stringify({ resultCount: 1, results: [LOOKUP_APP] }), { status: 200 });
  };
  const store = await lookupApp(APP_URL, fetchImpl, async (ms) => { waits.push(ms); });
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
  assert.equal(store.fields.ratings, 7181);
});

test('a lookup that stays throttled gives up and lets the page path run', async () => {
  const fetchImpl = async () => new Response('', { status: 429 });
  assert.equal(await lookupApp(APP_URL, fetchImpl, async () => {}), null);
});

test('a missing rating count stays unknown rather than becoming zero', async () => {
  const { userRatingCount, averageUserRating, ...unrated } = LOOKUP_APP;
  const fetchImpl = async () => new Response(JSON.stringify({ resultCount: 1, results: [{ ...unrated, kind: 'mac-software' }] }));
  const store = await lookupApp(APP_URL, fetchImpl, async () => {});
  assert.equal(store.fields.ratings, undefined);
  assert.equal(store.fields.stars, undefined);
  assert.equal(store.fields.platform, 'macos');
  assert.equal(store.fields.shotDevice, 'mac');
});
