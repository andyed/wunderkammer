import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium } from 'playwright';

// A static host: the wall's files and some JSON, no wunderkammer API. Every /api/
// request is recorded, because a collection must never reach for a server.
let server, origin, browser, mediaServer, mediaOrigin;
const apiHits = [], mediaHits = [], remoteHits = [], sheetHits = [];
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
// Like the Psychodeli example: years and colour families, no decade or genre,
// so no music starting point applies. 2025 is even i, 2026 odd i: 15 each.
const framesDoc = (nouns = null) => ({
  format: 'wunderkammer.collection', version: 1, corpus: { id: 'fixture:frames', revision: 'r1' },
  ui: { title: 'Fixture frames', ...(nouns ? { nouns } : {}) },
  clips: Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`, title: `Frame ${String(i).padStart(2, '0')}`, kind: 'image', cover: `media/${i % 3}.svg`,
    props: { year: i % 2 ? '2026' : '2025', color: [['green', 'purple', 'blue'][i % 3]] },
  })),
});
const FRAMES = '/wall/compare.html?groupBy=year&group=2025&group=2026&measure=color&collection=';
const MUSIC_WORDS = /\balbums?\b|\bcovers?\b|\bracks?\b|\bartists?\b|\bgenres?\b|\bdecades?\b|\bspike\b/i;
const bad = () => {
  const d = doc(); d.format = 'wunderkammer'; d.clips[0].sourceUrl = 'javascript:alert(1)'; d.clips[4].captured = 'May 1994';
  return d;
};
// A collection that names its items, with one group of exactly one: 30
// clips in three decades of ten, plus one in the 2000s.
const nounsDoc = () => {
  const d = doc(); d.ui.nouns = { item: 'cat', items: 'cats' };
  d.clips.push({ id: 'c30', title: 'Cover 30', cover: 'media/0.svg', props: { decade: '2000s', genre: 'pop' } });
  return d;
};
// A music library: every clip an album, as adapters/music.mjs marks them, and no ui.nouns.
const albumsDoc = () => { const d = doc(); d.clips.forEach(clip => { clip.kind = 'album'; }); return d; };
// Sprite sheets: each cover is a solid colour of its own, so a crop from the
// wrong cell, or one that bleeds into a neighbour, shows as the wrong colour.
const spriteColor = i => [40 + (i * 53) % 200, 40 + (i * 97) % 200, 40 + (i * 151) % 200];
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]), tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Two levels, as scripts/collection-sheets.py lays them out: cells in rows,
// a 2-px gutter of the cell's own colour around each.
const SPRITE_LEVELS = [{ name: 'small', edge: 32, w: 32, h: 18, perRow: 10 }, { name: 'large', edge: 120, w: 120, h: 68, perRow: 8 }];
const spriteSheets = Object.fromEntries(SPRITE_LEVELS.map(l => {
  const cw = l.w + 4, ch = l.h + 4, rows = Math.ceil(30 / l.perRow);
  return [l.name, png(cw * l.perRow, ch * rows, (x, y) => {
    const i = Math.floor(y / ch) * l.perRow + Math.floor(x / cw);
    return i < 30 ? spriteColor(i) : [5, 5, 16];
  })];
}));
const spriteDoc = () => {
  const d = doc(); d.corpus.revision = 'r1';
  d.sheets = SPRITE_LEVELS.map(l => ({ src: `sheets/${l.name}.png`, edge: l.edge, width: (l.w + 4) * l.perRow, height: (l.h + 4) * Math.ceil(30 / l.perRow) }));
  d.clips.forEach((c, i) => {
    delete c.cover;
    c.sheetSlots = SPRITE_LEVELS.map((l, s) => [s, (i % l.perRow) * (l.w + 4) + 2, Math.floor(i / l.perRow) * (l.h + 4) + 2, l.w, l.h]);
  });
  return d;
};
// The same cells beside per-file covers: "covers" makes the cells serve every
// view, and the files stand in when a sheet page fails (here: never published).
const spriteWithFiles = ({ missing = false } = {}) => {
  const d = spriteDoc(); d.images = { sheets: 'covers' };
  d.clips.forEach((c, i) => { c.cover = `media/${i % 3}.svg`; });
  if (missing) d.sheets.forEach(s => { s.src = s.src.replace('sheets/', 'sheets/unpublished-'); });
  return d;
};
const fileColor = n => ({ 0: [0x50, 0x8e, 0xae], 1: [0xad, 0x58, 0x40], 2: [0x6a, 0x5a, 0xcd] })[n % 3];
/** The centre pixel of each decoded <img>, keyed by the "Cover NN" its tile or item names. */
const PIXELS = selector => [...document.querySelectorAll(selector)].filter(img => img.complete && img.naturalWidth > 0).map(img => {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const label = img.closest('[aria-label]')?.getAttribute('aria-label') || img.alt || '';
  return { n: Number(label.match(/Cover (\d+)/)?.[1]), src: img.src.slice(0, 5), w: img.naturalWidth, rgb: [...ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3)] };
});
const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= 10);

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
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
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
    if (p === '/data/frames.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(framesDoc())); return; }
    if (p === '/data/frames-nouns.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(framesDoc({ item: 'frame', items: 'frames' }))); return; }
    if (p === '/data/bad.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(bad())); return; }
    if (p === '/data/nouns.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(nounsDoc())); return; }
    if (p === '/data/albums.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(albumsDoc())); return; }
    if (p === '/data/sprite.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(spriteDoc())); return; }
    if (p === '/data/sprite-files.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(spriteWithFiles())); return; }
    if (p === '/data/sprite-missing.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(spriteWithFiles({ missing: true }))); return; }
    if (p.startsWith('/data/sheets/')) {
      sheetHits.push(p);
      const sheet = spriteSheets[p.slice('/data/sheets/'.length, -'.png'.length)];
      if (!sheet) { res.writeHead(404); res.end(); return; }
      res.setHeader('content-type', 'image/png'); res.end(sheet); return;
    }
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
        const file = p === '/' ? 'index.html' : p.slice(1);
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

// The 3D button opens the floating space; the stacks are the last entry in its menu.
async function openStacks(page) {
  await page.locator('#view-3d').click();
  await page.locator('.float-arrange label:has(input[value=stacks])').click();
  await page.waitForFunction(() => window.__cwSpatial?.built && document.body.dataset.viewMode === '3d', null, { timeout: 20000 });
}

test('the 3D view of a collection loads remote covers directly with CORS, without the instance proxy', async () => {
  apiHits.length = 0; remoteHits.length = 0;
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}/?collection=/data/remote.json`);
    await ready(page);
    await openStacks(page);
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

test('compare.html gives a collection without music attributes neutral nouns, no badge and no starting points', async () => {
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}${FRAMES}/data/frames.json`);
    await page.waitForSelector('body[data-comparison-ready="true"]');
    assert.equal(await page.locator('.compare-header .experiment').count(), 0, 'no prototype badge');
    assert.equal(await page.locator('#preset-control').isHidden(), true, 'no starting point applies');
    assert.equal(await page.locator('#preset option').count(), 0);
    assert.equal(await page.locator('#scene-title').textContent(), 'Walls');
    assert.equal(await page.locator('[data-view="walls"]').textContent(), 'Walls');
    assert.equal(await page.locator('#scene-summary').textContent(), '30 items · 2 groups');
    assert.equal(await page.locator('#compare-search').getAttribute('placeholder'), 'Search titles, sources, notes…');
    await page.waitForSelector('body[data-scene-ready="true"]', { timeout: 20000 });
    assert.deepEqual(await page.locator('.comparison-scene-label--wall').allTextContents(), ['2025 · 15 items', '2026 · 15 items']);
    assert.doesNotMatch(await page.locator('#comparison-stage canvas').getAttribute('aria-label'), MUSIC_WORDS);
    for (const selector of ['.compare-header', '.question-bar', '.depth-panel']) {
      assert.doesNotMatch(await page.locator(selector).innerText(), MUSIC_WORDS, selector);
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('compare.html names the items with ui.nouns and offers only the starting points a collection has', async () => {
  const page = await newPage();
  try {
    await page.goto(`${origin}${FRAMES}/data/frames-nouns.json`);
    await page.waitForSelector('body[data-comparison-ready="true"]');
    assert.equal(await page.locator('#scene-title').textContent(), 'Frame walls');
    assert.equal(await page.locator('[data-view="walls"]').textContent(), 'Frame walls');
    assert.equal(await page.locator('#scene-summary').textContent(), '30 frames · 2 groups');
    await page.waitForSelector('body[data-scene-ready="true"]', { timeout: 20000 });
    assert.deepEqual(await page.locator('.comparison-scene-label--wall').allTextContents(), ['2025 · 15 frames', '2026 · 15 frames']);
    assert.match(await page.locator('#comparison-stage canvas').getAttribute('aria-label'), /^Frame walls\. .*Select any frame to inspect it/);
    // Decades and genres, in lowercase and without jazz, and no colour: only the genre comparison.
    await page.goto(`${origin}/wall/compare.html?collection=/data/cmp.json`);
    await page.waitForSelector('body[data-comparison-ready="true"]');
    assert.equal(await page.locator('#preset-control').isVisible(), true);
    assert.deepEqual(await page.locator('#preset option').allTextContents(), ['Genre across decades']);
    assert.equal(await page.locator('#scene-summary').textContent(), '30 items · 3 groups');
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

test('a collection whose covers are sprite-sheet cells shows them on the wall and in the detail pane, from two requests', async () => {
  apiHits.length = 0; mediaHits.length = 0; sheetHits.length = 0;
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}/?collection=/data/sprite.json`);
    await ready(page);
    assert.equal(await page.locator('#canvas > .tile').count(), 30);
    // Every tile in view takes its cell as a blob: URL, cropped at the level its size needs.
    await page.waitForFunction(() => {
      const shown = [...document.querySelectorAll('#canvas > .tile')].filter(t => t.style.visibility !== 'hidden').map(t => t.querySelector('img'));
      return shown.length && shown.every(img => img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0);
    }, null, { timeout: 15000 });
    const tiles = await page.evaluate(PIXELS, '#canvas > .tile img');
    assert.ok(tiles.length >= 6, `${tiles.length} tiles in view`);
    for (const t of tiles) assert.ok(near(t.rgb, spriteColor(t.n)), `Cover ${t.n} shows ${t.rgb}, its cell is ${spriteColor(t.n)}`);
    // The detail pane shows the largest cell.
    await page.locator('#canvas > .tile[aria-label="Cover 07"]').click();
    await page.waitForFunction(() => { const img = document.querySelector('.detail-content > img'); return img?.src.startsWith('blob:') && img.naturalWidth === 120; }, null, { timeout: 10000 });
    const [detail] = await page.evaluate(PIXELS, '.detail-content > img');
    assert.ok(near(detail.rgb, spriteColor(7)), `detail shows ${detail.rgb}`);
    assert.deepEqual(mediaHits, [], 'no per-item files');
    assert.deepEqual(apiHits, []);
    assert.ok(sheetHits.length >= 1 && sheetHits.every(p => /^\/data\/sheets\/(small|large)\.png$/.test(p)), sheetHits.join(','));
    assert.ok(new Set(sheetHits).size <= 2 && sheetHits.length <= 4, `each page is fetched about once: ${sheetHits.join(',')}`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('the 3D view draws sprite-sheet cells into its atlas', async () => {
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}/?collection=/data/sprite.json`);
    await ready(page);
    await openStacks(page);
    await page.waitForFunction(() => {
      const v = window.__cwSpatial, a = v?.field?.atlases;
      if (!v?.built || !a) return false;
      let far = 0; for (let i = 0; i < v.field.count; i++) if (a.farSlot[i] >= 0) far++;
      return far === v.field.count && !a._farQueue.length;
    }, null, { timeout: 20000 });
    const atlas = await page.evaluate(() => {
      const v = window.__cwSpatial, a = v.field.atlases, out = [];
      for (let i = 0; i < v.field.count; i++) {
        const r = a.far.slotRect(a.farSlot[i]);
        out.push({ n: Number(v.clips[i].title.match(/Cover (\d+)/)[1]), rgb: [...a.far.ctx.getImageData(r.x + (r.w >> 1), r.y + (r.h >> 1), 1, 1).data.slice(0, 3)] });
      }
      return { failed: a._failed.size, out };
    });
    assert.equal(atlas.failed, 0);
    assert.equal(atlas.out.length, 30);
    for (const t of atlas.out) assert.ok(near(t.rgb, spriteColor(t.n)), `atlas tile for Cover ${t.n} is ${t.rgb}, its cell is ${spriteColor(t.n)}`);
    assert.deepEqual(mediaHits, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('the floating space draws sprite-sheet cells into its atlas', async () => {
  apiHits.length = 0; mediaHits.length = 0;
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}/?collection=/data/sprite.json&view=float`);
    await ready(page);
    await page.waitForFunction(() => { const s = window.wunderkammerFloatDebug?.().scene; return s?.built && s.farResident === s.itemCount && s.loading === 0; }, null, { timeout: 20000 });
    const atlas = await page.evaluate(() => {
      const v = window.__cwFloat, a = v.field.atlases, out = [];
      for (let i = 0; i < v.count; i++) {
        const r = a.far.slotRect(a.farSlot[i]);
        out.push({ n: Number(v.clips[i].title.match(/Cover (\d+)/)[1]), rgb: [...a.far.ctx.getImageData(r.x + (r.w >> 1), r.y + (r.h >> 1), 1, 1).data.slice(0, 3)] });
      }
      return { failed: a._failed.size, out };
    });
    assert.equal(atlas.failed, 0);
    assert.equal(atlas.out.length, 30);
    for (const t of atlas.out) assert.ok(near(t.rgb, spriteColor(t.n)), `atlas tile for Cover ${t.n} is ${t.rgb}, its cell is ${spriteColor(t.n)}`);
    assert.deepEqual(mediaHits, [], 'no per-item files');
    assert.deepEqual(apiHits, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('compare.html shows sprite-sheet cells as evidence thumbnails and on the album walls', async () => {
  apiHits.length = 0; mediaHits.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}/wall/compare.html?collection=/data/sprite.json`);
    await page.waitForSelector('body[data-comparison-ready="true"]');
    await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('#evidence-items img')]; return imgs.length && imgs.every(img => img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0); }, null, { timeout: 10000 });
    const thumbs = await page.evaluate(PIXELS, '#evidence-items img');
    assert.ok(thumbs.length >= 6);
    for (const t of thumbs) assert.ok(near(t.rgb, spriteColor(t.n)), `thumbnail for Cover ${t.n} is ${t.rgb}`);
    await page.waitForSelector('body[data-scene-ready="true"]', { timeout: 20000 });
    await page.waitForFunction(() => { const d = window.comparisonDebug().scene; return d && d.loadedArtwork > 0 && !d.pendingArtwork; }, null, { timeout: 10000 });
    const scene = await page.evaluate(() => window.comparisonDebug().scene);
    assert.equal(scene.failedArtwork, 0, 'every cover on the walls came from a cell');
    assert.ok(scene.loadedArtwork >= 20, `${scene.loadedArtwork} covers on the walls`);
    assert.deepEqual(mediaHits, []);
    assert.deepEqual(apiHits, []);
  } finally { await page.close(); }
});

test('the overview canvas paints sprite-sheet cells', async () => {
  sheetHits.length = 0;
  // A small stage makes 30 tiles overview-sized at Fit.
  const page = await browser.newPage({ viewport: { width: 520, height: 420 }, reducedMotion: 'reduce' });
  try {
    await page.goto(`${origin}/?collection=/data/sprite.json`);
    await ready(page);
    for (let i = 0; i < 6 && !(await page.evaluate(() => !document.querySelector('canvas.overview-surface')?.hidden)); i++) {
      await page.locator('#zoom-out').click(); await page.waitForTimeout(250);
    }
    await page.waitForFunction(() => {
      const shown = [...document.querySelectorAll('#canvas > .tile')].filter(t => t.style.visibility !== 'hidden');
      return shown.length && shown.every(t => t.classList.contains('overview-painted'));
    }, null, { timeout: 10000 });
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.overview-surface'), box = canvas.getBoundingClientRect(), ctx = canvas.getContext('2d');
      return [...document.querySelectorAll('#canvas > .tile')].filter(t => t.style.visibility !== 'hidden').map(t => {
        const r = t.getBoundingClientRect(), sx = canvas.width / box.width, sy = canvas.height / box.height;
        const x = Math.round((r.left + r.width / 2 - box.left) * sx), y = Math.round((r.top + r.height / 2 - box.top) * sy);
        return { n: Number(t.getAttribute('aria-label').match(/Cover (\d+)/)[1]), rgb: [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)] };
      });
    });
    assert.ok(painted.length >= 20, `${painted.length} tiles painted`);
    for (const t of painted) assert.ok(near(t.rgb, spriteColor(t.n)), `overview paints Cover ${t.n} as ${t.rgb}, its cell is ${spriteColor(t.n)}`);
    assert.ok(sheetHits.includes('/data/sheets/small.png'), sheetHits.join(','));
  } finally { await page.close(); }
});

test('with images.sheets "covers", cells serve every view even where a cover file exists', async () => {
  mediaHits.length = 0; sheetHits.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}/?collection=/data/sprite-files.json`);
    await ready(page);
    await page.waitForFunction(() => {
      const shown = [...document.querySelectorAll('#canvas > .tile')].filter(t => t.style.visibility !== 'hidden').map(t => t.querySelector('img'));
      return shown.length && shown.every(img => img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0);
    }, null, { timeout: 15000 });
    for (const t of await page.evaluate(PIXELS, '#canvas > .tile img')) assert.ok(near(t.rgb, spriteColor(t.n)), `Cover ${t.n} shows ${t.rgb}`);
    await page.locator('#canvas > .tile[aria-label="Cover 04"]').click();
    await page.waitForFunction(() => { const img = document.querySelector('.detail-content > img'); return img?.src.startsWith('blob:') && img.naturalWidth === 120; }, null, { timeout: 10000 });
    assert.deepEqual(mediaHits, [], 'the files are only a fallback');
  } finally { await page.close(); }
});

test('when a sheet page is missing, the wall, the detail pane and 3D fall back to each clip\'s own file', async () => {
  mediaHits.length = 0; sheetHits.length = 0;
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}/?collection=/data/sprite-missing.json`);
    await ready(page);
    await page.waitForFunction(() => {
      const shown = [...document.querySelectorAll('#canvas > .tile')].filter(t => t.style.visibility !== 'hidden').map(t => t.querySelector('img'));
      return shown.length && shown.every(img => img.src.includes('/data/media/') && img.complete && img.naturalWidth > 0);
    }, null, { timeout: 15000 });
    const tiles = await page.evaluate(PIXELS, '#canvas > .tile img');
    assert.ok(tiles.length >= 6);
    for (const t of tiles) assert.ok(near(t.rgb, fileColor(t.n)), `Cover ${t.n} shows ${t.rgb}, its file is ${fileColor(t.n)}`);
    assert.ok(sheetHits.some(p => p.includes('unpublished-')), 'the missing page was asked for');
    assert.ok(await page.locator('#canvas > .tile.broken').count() === 0, 'no tile is left broken');
    await page.locator('#canvas > .tile[aria-label="Cover 05"]').click();
    await page.waitForFunction(() => { const img = document.querySelector('.detail-content > img'); return img?.src.includes('/data/media/2.svg') && img.complete && img.naturalWidth > 0; }, null, { timeout: 10000 });
    await page.locator('.detail-content .close').click();
    await openStacks(page);
    await page.waitForFunction(() => {
      const v = window.__cwSpatial, a = v?.field?.atlases;
      if (!v?.built || !a) return false;
      let far = 0; for (let i = 0; i < v.field.count; i++) if (a.farSlot[i] >= 0) far++;
      return far === v.field.count && !a._farQueue.length && !a._inflight;
    }, null, { timeout: 20000 });
    const atlas = await page.evaluate(() => {
      const v = window.__cwSpatial, a = v.field.atlases, out = [];
      for (let i = 0; i < v.field.count; i++) {
        const r = a.far.slotRect(a.farSlot[i]);
        out.push({ n: Number(v.clips[i].title.match(/Cover (\d+)/)[1]), rgb: [...a.far.ctx.getImageData(r.x + (r.w >> 1), r.y + (r.h >> 1), 1, 1).data.slice(0, 3)] });
      }
      return { failed: a._failed.size, out };
    });
    assert.equal(atlas.failed, 0);
    for (const t of atlas.out) assert.ok(near(t.rgb, fileColor(t.n)), `atlas tile for Cover ${t.n} is ${t.rgb}`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('when a sheet page is missing, compare.html falls back to the files in the evidence and on the walls', async () => {
  const page = await newPage();
  try {
    await page.goto(`${origin}/wall/compare.html?collection=/data/sprite-missing.json`);
    await page.waitForSelector('body[data-comparison-ready="true"]');
    await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('#evidence-items img')]; return imgs.length && imgs.every(img => img.src.includes('/data/media/') && img.complete && img.naturalWidth > 0); }, null, { timeout: 10000 });
    await page.waitForSelector('body[data-scene-ready="true"]', { timeout: 20000 });
    await page.waitForFunction(() => { const d = window.comparisonDebug().scene; return d && d.loadedArtwork > 0 && !d.pendingArtwork; }, null, { timeout: 15000 });
    const scene = await page.evaluate(() => window.comparisonDebug().scene);
    assert.equal(scene.failedArtwork, 0, 'every wall cover came from its file');
    assert.ok(scene.loadedArtwork >= 20);
  } finally { await page.close(); }
});

test('the wall, the aisle and the floating space count in the collection\'s own nouns, singular for one', async () => {
  const page = await newPage();
  try {
    await page.goto(`${origin}/?collection=/data/nouns.json`);
    await ready(page);
    assert.equal(await page.locator('#count').textContent(), '31 of 31 cats');
    await page.locator('#view-aisle').click();
    await page.waitForFunction(() => window.wunderkammerAisleDebug().scene?.labels?.some(Boolean), null, { timeout: 15000 });
    const labels = (await page.evaluate(() => window.wunderkammerAisleDebug().scene.labels)).filter(Boolean);
    assert.ok(labels.includes('2000s · 1 cat'), labels.join(' | '));
    assert.ok(labels.includes('1970s · 10 cats'), labels.join(' | '));
    assert.ok(!labels.some(label => / items?$/.test(label)), labels.join(' | '));
    await page.locator('#view-3d').click();
    await page.waitForFunction(() => document.querySelector('.float-scope')?.textContent, null, { timeout: 15000 });
    assert.equal(await page.locator('.float-scope').textContent(), 'All 31 cats');
  } finally { await page.close(); }
});

test('the aisle builds its rack labels in the collection\'s own nouns', async () => {
  // The rack labels come from album-walls.mjs, built after setClips hands the
  // aisle its nouns; the overlay draws them.
  for (const [collection, want] of [['nouns', ['1970s · 10 cats', '2000s · 1 cat']], ['albums', ['1970s · 10 albums', '1990s · 10 albums']]]) {
    const page = await newPage();
    try {
      await page.goto(`${origin}/?collection=/data/${collection}.json`);
      await ready(page);
      await page.locator('#view-aisle').click();
      await page.waitForFunction(() => window.wunderkammerAisleDebug().scene?.labels?.some(Boolean), null, { timeout: 15000 });
      const { racks, drawn } = await page.evaluate(() => ({
        racks: window.__cwAisle.art.labelAnchors.map(anchor => anchor.text),
        drawn: window.wunderkammerAisleDebug().scene.labels,
      }));
      for (const label of want) assert.ok(racks.includes(label), `${collection}: ${racks.join(' | ')}`);
      assert.ok(!racks.some(label => / items?$/.test(label)), `${collection}: ${racks.join(' | ')}`);
      assert.deepEqual(drawn, racks, `${collection}: the overlay draws the rack labels`);
    } finally { await page.close(); }
  }
});
