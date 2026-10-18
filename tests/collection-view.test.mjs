import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// A static host: the wall's files and some JSON, no wunderkammer API. Every /api/
// request is recorded, because a collection must never reach for a server.
let server, origin, browser, mediaServer, mediaOrigin;
const apiHits = [], mediaHits = [], remoteHits = [];
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="${color}"/></svg>`;
const doc = () => ({
  format: 'wunderkammer.collection', version: 1, corpus: { id: 'fixture:collection' },
  ui: { title: 'Fixture covers', defaultGroup: 'decade', facetOrder: ['decade', 'genre'], facetLabels: { decade: 'release decade' } },
  clips: Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`, title: `Cover ${String(i).padStart(2, '0')}`,
    // Relative to the collection document, not to the page.
    cover: `media/${i % 3}.svg`,
    props: { decade: ['1970s', '1980s', '1990s'][i % 3], genre: i % 2 ? 'pop' : ['rock', 'electronic'] },
    sourceUrl: `https://example.org/item/${i}`,
  })),
});
// The comparison route over the same fixture. Arithmetic: 1970s is i % 3 === 0
// (10 items) and 1990s is i % 3 === 2 (10); pop is odd i, five in each.
const cmpDoc = () => { const d = doc(); d.corpus.revision = 'r1'; return d; };
const cmpObservations = () => ({ format: 'wunderkammer.observations', version: 1,
  comparison: { version: 1, question: 'Is pop as common in the 1990s as in the 1970s?', corpus: { id: 'fixture:collection', revision: 'r1' },
    scope: { query: '', facets: {} }, groupBy: 'decade', groups: ['1970s', '1990s'], measure: 'genre', metric: 'share', categoryLimit: 8, sort: 'name' },
  observations: [{ id: 'pop-even', text: 'Pop is half of each decade.', evidence: { cells: [{ value: 'pop', cohort: '1970s' }, { value: 'pop', cohort: '1990s' }] } }] });
const bad = () => {
  const d = doc(); d.format = 'wunderkammer'; d.clips[0].sourceUrl = 'javascript:alert(1)'; d.clips[4].captured = 'May 1994';
  return d;
};
const host = `<!doctype html><meta charset="utf-8"><div id="w" style="height:700px"></div>
<script type="module">
import * as Wunderkammer from '/wall/embed.mjs';
const doc = await (await fetch('/data/c.json')).json();
try { await Wunderkammer.mount(document.getElementById('w'), doc, { wallUrl: '/' }).ready; window.result = 'ready'; }
catch (err) { window.result = 'error: ' + err.message; }
try { const b = structuredClone(doc); b.clips[0].sourceUrl = 'javascript:x'; Wunderkammer.mount(document.body, b); window.badResult = 'mounted'; }
catch (err) { window.badResult = err.name + ': ' + err.message; }
const second = document.createElement('div'); document.body.append(second);
try { await Wunderkammer.mount(second, '/data/bad.json', { wallUrl: '/' }).ready; window.urlResult = 'ready'; }
catch (err) { window.urlResult = err.message; }
</script>`;

before(async () => {
  const index = await readFile(new URL('../wall/index.html', import.meta.url), 'utf8');
  server = createServer(async (req, res) => {
    const p = new URL(req.url, 'http://fixture').pathname;
    if (p.startsWith('/api/')) { apiHits.push(`${req.method} ${p}`); res.writeHead(404); res.end(); return; }
    if (p === '/data/c.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(doc())); return; }
    if (p === '/data/remote.json') {
      // Covers on another origin that sends CORS headers, as a CDN would.
      const d = doc(); d.images = { cors: true };
      d.clips.forEach((c, i) => { c.cover = `${mediaOrigin}/m/${i % 3}.svg`; });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(d)); return;
    }
    if (p === '/data/cmp.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(cmpDoc())); return; }
    if (p === '/data/cmp-obs.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(cmpObservations())); return; }
    if (p === '/data/bad.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(bad())); return; }
    if (p.startsWith('/data/media/')) {
      mediaHits.push(p); res.setHeader('content-type', 'image/svg+xml'); res.end(svg(['#508eae', '#ad5840', '#6a5acd'][Number(p.at(-5))] || '#888')); return;
    }
    if (p === '/static.html') {
      res.setHeader('content-type', 'text/html');
      res.end(index.replace('<head>', '<head>\n<meta name="wunderkammer-collection" content="/data/c.json">')); return;
    }
    if (p === '/host.html') { res.setHeader('content-type', 'text/html'); res.end(host); return; }
    if (p === '/' || p.startsWith('/wall/')) {
      try {
        const file = p === '/' ? 'wall/index.html' : p.slice(1);
        const data = await readFile(new URL(`../${file}`, import.meta.url));
        res.setHeader('content-type', file.endsWith('html') ? 'text/html' : file.endsWith('css') ? 'text/css' : 'text/javascript');
        res.end(data); return;
      } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  mediaServer = createServer((req, res) => {
    remoteHits.push({ path: req.url, cors: !!req.headers.origin });
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('content-type', 'image/svg+xml');
    res.end(svg(['#508eae', '#ad5840', '#6a5acd'][Number(req.url.at(-5))] || '#888'));
  });
  // localhost, not 127.0.0.1: a different origin from the page.
  await new Promise(resolve => mediaServer.listen(0, '127.0.0.1', resolve));
  mediaOrigin = `http://localhost:${mediaServer.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); await new Promise(resolve => mediaServer?.close(resolve)); });

const newPage = () => browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
const ready = page => page.waitForFunction(() => document.body.dataset.viewReady === 'true', null, { timeout: 15000 });

test('?collection= boots the wall from one document with no server API', async () => {
  apiHits.length = 0; mediaHits.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}/?collection=/data/c.json`);
    await ready(page);
    assert.equal(await page.locator('.brand').textContent(), 'Fixture covers');
    assert.equal(await page.locator('#canvas > .tile').count(), 30);
    assert.equal(await page.locator('#group').inputValue(), 'decade', 'ui.defaultGroup applies');
    assert.ok(await page.getByText('release decade', { exact: false }).count(), 'facet label from ui.facetLabels');
    // Covers resolve against the document's URL (/data/), not the page's (/).
    await page.waitForFunction(() => [...document.querySelectorAll('#canvas > .tile img')].some(img => img.complete && img.naturalWidth > 0));
    assert.ok(mediaHits.length > 0 && mediaHits.every(p => p.startsWith('/data/media/')), mediaHits.join(','));
    // A filter, a regroup and a copied link must not touch the absent server either.
    await page.locator('#group').selectOption('genre');
    await page.waitForTimeout(300);
    assert.deepEqual(apiHits, []);
    assert.match(page.url(), /[?&]collection=%2Fdata%2Fc\.json|[?&]collection=\/data\/c\.json/, 'the collection stays in the address after view updates');
  } finally { await page.close(); }
});

test('a meta tag names the default collection for a static build', async () => {
  apiHits.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}/static.html`);
    await ready(page);
    assert.equal(await page.locator('#canvas > .tile').count(), 30);
    assert.deepEqual(apiHits, []);
  } finally { await page.close(); }
});

test('an invalid collection shows every problem with its path instead of a wall', async () => {
  apiHits.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}/?collection=/data/bad.json`);
    await page.waitForFunction(() => !document.getElementById('empty').classList.contains('hidden') && document.getElementById('empty').textContent.includes('problem'));
    const text = await page.locator('#empty').textContent();
    assert.match(text, /Could not load the collection/);
    assert.match(text, /format must be "wunderkammer\.collection"/);
    assert.match(text, /clips\[0\]\.sourceUrl must be an http\(s\) URL/);
    assert.match(text, /clips\[4\]\.captured must be an ISO date/);
    assert.equal(await page.locator('#canvas > .tile').count(), 0);
    assert.deepEqual(apiHits, []);
  } finally { await page.close(); }
});

test('a framed wall loading a collection URL tells its parent only that loading failed', async () => {
  const page = await newPage();
  try {
    await page.goto(`${origin}/host.html`);
    await page.waitForFunction(() => window.urlResult, null, { timeout: 15000 });
    const message = await page.evaluate(() => window.urlResult);
    assert.match(message, /could not be loaded/);
    assert.doesNotMatch(message, /clips\[|sourceUrl|format/, 'no problem text crosses to the embedder');
    // The person still sees every problem inside the frame.
    assert.match(await page.frameLocator('iframe').nth(1).locator('#empty').textContent(), /clips\[0\]\.sourceUrl/);
  } finally { await page.close(); }
});

test('mount() embeds a collection object and reports readiness; a bad object throws in the host', async () => {
  apiHits.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}/host.html`);
    await page.waitForFunction(() => window.result && window.badResult, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.result), 'ready');
    assert.match(await page.evaluate(() => window.badResult), /^CollectionError: .*clips\[0\]\.sourceUrl/s);
    const frame = page.frameLocator('iframe').first();
    assert.equal(await frame.locator('#canvas > .tile').count(), 30);
    await page.waitForFunction(() => window.urlResult);
    assert.equal(await page.locator('iframe').count(), 2, 'the refused object created no frame; the URL mount made the second');
    assert.deepEqual(apiHits, []);
  } finally { await page.close(); }
});

test('the 3D view of a collection loads remote covers directly with CORS, without the instance proxy', async () => {
  apiHits.length = 0; remoteHits.length = 0;
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}/?collection=/data/remote.json`);
    await ready(page);
    await page.locator('#view-3d').click();
    await page.waitForFunction(() => document.getElementById('view-3d').getAttribute('aria-pressed') === 'true');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('canvas').count() > 0, true);
    assert.deepEqual(apiHits, [], 'no /api/proxy, /api/view-state or /api/permalinks request');
    // The atlas requests covers in CORS mode, which a WebGL texture needs.
    assert.ok(remoteHits.some(hit => hit.cors), JSON.stringify(remoteHits.slice(0, 6)));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('window.wunderkammer.export() reports scope, highlight, focus and the exact in-scope items', async () => {
  const page = await newPage();
  try {
    // Fixture arithmetic: decade 1980s is i % 3 === 1 (10 items); pop is odd i, so 5 of them.
    await page.goto(`${origin}/?collection=/data/c.json&facet.decade=1980s&highlight.genre=pop`);
    await ready(page);
    await page.waitForFunction(() => window.wunderkammer.export().count === 10);
    const exported = await page.evaluate(() => window.wunderkammer.export());
    assert.equal(exported.format, 'wunderkammer.export');
    assert.equal(exported.corpus.id, 'fixture:collection');
    assert.deepEqual(exported.scope.facets, { decade: ['1980s'] });
    assert.equal(exported.total, 30);
    assert.equal(exported.evidence.length, 10);
    assert.deepEqual(exported.evidence.map(e => e.key), [1, 4, 7, 10, 13, 16, 19, 22, 25, 28].map(i => `c${i}`));
    assert.equal(await page.locator('#count b').textContent(), '10', 'the export agrees with the rendered count');
    assert.deepEqual(exported.highlight, { key: 'genre', value: 'pop', count: 5, keys: ['c1', 'c7', 'c13', 'c19', 'c25'] });
    assert.equal(exported.focus, null);
    assert.equal(JSON.stringify(exported).includes('example.org'), false, 'identities and titles only, no links or notes');
    await page.locator('#canvas > .tile').first().click();
    await page.waitForFunction(() => window.wunderkammer.export().focus !== null);
    assert.deepEqual((await page.evaluate(() => window.wunderkammer.export())).focus, { key: 'c1', title: 'Cover 01' });
  } finally { await page.close(); }
});

test('compare.html runs a collection, its comparison and observations with no server API', async () => {
  apiHits.length = 0;
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}/wall/compare.html?collection=/data/cmp.json&observations=/data/cmp-obs.json`);
    await page.waitForSelector('body[data-comparison-ready="true"]');
    await page.waitForSelector('#observations:not([hidden])');
    assert.deepEqual(await page.locator('.observation-figures li').allTextContents(), ['pop · 1970s: 5 of 10 · 50.0%', 'pop · 1990s: 5 of 10 · 50.0%']);
    assert.equal(await page.locator('#notice').isHidden(), true, 'the observed corpus and revision match the collection');
    await page.locator('.observation-select').click();
    assert.deepEqual((await page.evaluate(() => window.wunderkammer.export())).evidence.map(e => e.key), ['c3', 'c5', 'c9', 'c11', 'c15', 'c17', 'c21', 'c23', 'c27', 'c29']);
    // The collection stays in the address through the comparison's own URL rewrites.
    const url = new URL(page.url());
    assert.equal(url.searchParams.get('collection'), '/data/cmp.json');
    assert.equal(url.searchParams.get('observation'), 'pop-even');
    assert.equal(new URL(await page.locator('.wordmark').getAttribute('href'), page.url()).searchParams.get('collection'), `${origin}/data/cmp.json`);
    const again = await newPage();
    try {
      await again.goto(page.url());
      await again.waitForSelector('body[data-comparison-ready="true"]');
      assert.equal((await again.evaluate(() => window.comparisonDebug())).selection.observation, 'pop-even');
    } finally { await again.close(); }
    assert.deepEqual(apiHits, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('compare.html shows remote CORS covers from a collection, in the evidence and on the walls, without the proxy', async () => {
  apiHits.length = 0; remoteHits.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}/wall/compare.html?collection=/data/remote.json`);
    await page.waitForSelector('body[data-comparison-ready="true"]');
    await page.waitForFunction(() => [...document.querySelectorAll('#evidence-items img')].some(img => img.complete && img.naturalWidth > 0), null, { timeout: 10000 });
    assert.ok((await page.locator('#evidence-items img').first().getAttribute('src')).startsWith(mediaOrigin));
    await page.waitForSelector('body[data-scene-ready="true"]', { timeout: 20000 });
    await page.waitForFunction(() => window.comparisonDebug().scene?.loadedArtwork > 0, null, { timeout: 10000 });
    assert.ok(remoteHits.some(hit => hit.cors), 'the walls request covers with CORS');
    assert.deepEqual(apiHits, [], 'no /api/clips and no /api/proxy');
  } finally { await page.close(); }
});
