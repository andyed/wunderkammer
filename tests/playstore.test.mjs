import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clipOne } from '../clip.mjs';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { playId, sizedPlayShot, installsFloor, parsePlayPage, lookupPlay } from '../lib/playstore.mjs';

const defaults = { tags: [], title: '', kind: '', note: '', shot: false, allImages: false };
const PKG = 'com.example.visualizer';
const PLAY_URL = `https://play.google.com/store/apps/details?id=${PKG}`;

async function vault(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-play-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'clips'));
  await mkdir(path.join(dir, 'attachments'));
  return { vault: dir, clipsDir: 'clips', attachmentsDir: 'attachments' };
}

function png(marker, w = 720, h = 1600) {
  const buf = Buffer.alloc(8192, marker);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf);
  buf.writeUInt32BE(w, 16); buf.writeUInt32BE(h, 20);
  return buf;
}

// The shape of a real details page, trimmed: schema.org block, an icon, two
// screenshots (one repeated, as Play does for the lightbox), description,
// install band and update date.
const LD = {
  '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Example Visualizer &amp; Lights',
  description: 'Short tagline.', applicationCategory: 'MUSIC_AND_AUDIO',
  author: { '@type': 'Person', name: 'Example Studio' },
  aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.072932720184326', ratingCount: '1381917' },
  offers: [{ '@type': 'Offer', price: '0', priceCurrency: 'USD' }],
};
const shot = (n) => `<img src="https://play-lh.googleusercontent.com/shot${n}=w526-h296-rw" srcset="https://play-lh.googleusercontent.com/shot${n}=w1052-h592-rw 2x" alt="Screenshot image" data-screenshot-index="${n}">`;
const PAGE = `<html><head><meta property="og:image" content="https://play-lh.googleusercontent.com/icon=w240">
<script type="application/ld+json">${JSON.stringify(LD)}</script></head><body>
<img src="https://play-lh.googleusercontent.com/icon=s64" alt="Icon image">
${shot(1)}${shot(2)}${shot(1)}
<div data-g-id="description">Full description line one.<br>Line two &amp; more.</div>
<div class="a">50M+</div><div class="b">Downloads</div>
<div class="c">Updated on</div><div class="d">Sep 15, 2026</div>
</body></html>`;

function network(t, { page = PAGE, status = 200 } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    calls.push(url);
    const m = url.match(/shot(\d)=w1600-h1600-rw$/);
    if (m) return new Response(png(Number(m[1])), { headers: { 'content-type': 'image/png' } });
    if (url.includes('icon=')) return new Response(png(9, 512, 512), { headers: { 'content-type': 'image/png' } });
    return new Response(page, { status, headers: { 'content-type': 'text/html' } });
  });
  return calls;
}

test('playId accepts Play details URLs and rejects everything else', () => {
  assert.equal(playId(`${PLAY_URL}&hl=de&gl=DE`), PKG);
  assert.equal(playId('https://play.google.com/store/apps/developer?id=Example'), null);
  assert.equal(playId('https://example.com/store/apps/details?id=x.y'), null);
  assert.equal(playId('https://play.google.com/store/apps/details?id=bad id'), null);
});

test('sizing and install bands', () => {
  assert.equal(sizedPlayShot('https://play-lh.googleusercontent.com/abc=w526-h296-rw'), 'https://play-lh.googleusercontent.com/abc=w1600-h1600-rw');
  assert.equal(installsFloor('50M+'), 50_000_000);
  assert.equal(installsFloor('1,000+'), 1000);
  assert.equal(installsFloor('500K+'), 500_000);
  assert.equal(installsFloor(undefined), undefined);
});

test('a details page parses to screenshots and store fields', () => {
  const rec = parsePlayPage(PAGE, PKG);
  assert.equal(rec.title, 'Example Visualizer & Lights');
  assert.equal(rec.shots.length, 2, 'icon excluded, repeated screenshot deduplicated');
  assert.match(rec.description, /line one\.\nLine two & more\./);
  assert.deepEqual(
    { ...rec.fields },
    { appId: PKG, store: 'Google Play', storefront: 'us', platform: 'android', shotDevice: 'android', seller: 'Example Studio',
      price: 'Free', ratings: 1381917, stars: 4.07, installs: '50M+', installsMin: 50_000_000, genre: 'Music & Audio', updated: '2026-09-15' },
  );
  assert.equal(parsePlayPage('<html>no structured data</html>', PKG), null);
});

test('a Play clip carries the screenshots and store fields, not the icon', async (t) => {
  const cfg = await vault(t);
  const calls = network(t);
  const { data, body } = parseFrontmatter(await readFile(await clipOne(PLAY_URL, { ...defaults }, cfg), 'utf8'));
  assert.equal(data.media.length, 2);
  assert.deepEqual(data.mediaSource, ['playstore-screenshot']);
  assert.equal(data.store, 'Google Play');
  assert.equal(data.installsMin, 50000000);
  assert.ok(calls.some((u) => u.includes('hl=en&gl=US')), 'the listing is read in English, US storefront');
  assert.ok(!calls.some((u) => u.includes('icon=')), 'the icon is not downloaded');
  assert.match(body, /Full description/);
});

test('a throttled Play page waits and retries; a missing listing falls back', async () => {
  let n = 0;
  const flaky = async () => (++n === 1 ? new Response('', { status: 429 }) : new Response(PAGE));
  const rec = await lookupPlay(PLAY_URL, flaky, async () => {});
  assert.equal(n, 2);
  assert.equal(rec.fields.ratings, 1381917);
  assert.equal(await lookupPlay(PLAY_URL, async () => new Response('', { status: 404 }), async () => {}), null);
});
