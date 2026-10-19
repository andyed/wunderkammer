import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPermalinkHandler, instanceIdentity } from '../lib/permalinks.mjs';
import { encodeView, decodeView, canonical, validateView, viewDigest } from '../wall/permalink.mjs';
let dir, server, origin, browser, puts = 0, failSnapshots = false;
const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#508eae"/></svg>');
const clips = Array.from({ length: 80 }, (_, i) => ({ id: String(i), title: `Image ${String(i).padStart(3, '0')}`, tags: [], note: 'Research',
  url: `https://fixture.test/image/${i}?stable=${'a'.repeat(280)}`, cover: svg, source: i < 40 ? 'new' : 'old',
  captured: i < 40 ? '2026-01-01' : '2025-12-01', props: { year: i < 40 ? '2026' : '2025', color: i % 2 ? 'blue' : 'red', kaleido: i % 3 ? 'non-kaleido' : 'kaleido' } }));
clips[3].media = [{ src: svg }, { src: svg.replace('508eae', 'ad5840') }];
// Index-time similarity points (scripts/projection.py writes them; here a fixed spiral).
clips.forEach((c, i) => { c.projection = { x: Math.cos(i * 0.7) * i / 80, y: Math.sin(i * 0.7) * i / 80, col: i % 10, row: Math.floor(i / 10) }; });
const specimen = () => ({ v: 1, layoutVersion: 1, corpus: { id: 'fixture', revision: 'r1' },
  scope: { query: '', facets: [], branches: null }, presentation: { mode: 'flat', group: 'none', pan: 'edge' },
  flat: { view: { x: 0, y: 0, scale: 1, fitted: true }, stage: { w: 1200, h: 800 }, aspect: 1.5 }, spatial: null,
  ui: { rail: true, context: false, focus: null, detailWidth: null } });
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-links-'));
  const snapshots = createPermalinkHandler(path.join(dir, 'snapshots'));
  server = createServer(async (req, res) => {
    const p = new URL(req.url, 'http://fixture').pathname;
    if (p.startsWith('/api/permalinks')) {
      if (failSnapshots && req.method === 'POST') { res.writeHead(failSnapshots === true ? 503 : failSnapshots); res.end(); return; }
      return snapshots(req, res, p.split('/')[3]);
    }
    if (p === '/api/clips') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ clips, corpus: { id: 'fixture', revision: 'r1' },
      facets: { source: { new: 40, old: 40 }, year: { 2026: 40, 2025: 40 }, color: { red: 40, blue: 40 }, kaleido: { kaleido: 27, 'non-kaleido': 53 } } })); return; }
    if (p === '/api/view-state') { if (req.method === 'PUT') puts++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'source', piles: [] })); return; }
    if (p === '/' || p.startsWith('/wall/')) {
      try { const file = p === '/' ? 'index.html' : p.slice(1); const data = await readFile(new URL(`../${file}`, import.meta.url));
        res.setHeader('content-type', file.endsWith('html') ? 'text/html' : file.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(data); return;
      } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); await rm(dir, { recursive: true, force: true }); });
const settle = page => page.waitForTimeout(750);
const newPage = () => browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
// Cluster suggestions have no placed panel yet; tests expose it to exercise scope mechanics.
const exposeClusters = page => page.evaluate(() => {
  const host = document.getElementById('context-clusters');
  host.hidden = false; host.style.top = '160px'; host.style.height = '240px'; // clear of the fixed header
});
const fromURL = async url => { const p = new URLSearchParams(new URL(url).hash.slice(1)); return p.has('s') ? decodeView(p.get('s')) : (await fetch(`${origin}/api/permalinks/${p.get('ref')}`)).json(); };

test('view codec validates versions, Unicode and camera bounds; immutable snapshots survive independent readers', async () => {
  const v = specimen(); v.scope.query = '紫色 🌀'; v.scope.facets = [['color', ['blue', '紫色']]];
  assert.deepEqual(decodeView(encodeView(v)), v);
  assert.throws(() => validateView({ ...v, v: 2 }));
  assert.throws(() => validateView({ ...v, flat: { ...v.flat, view: { ...v.flat.view, scale: Infinity } } }));
  assert.throws(() => decodeView('bad%input'));
  const send = () => fetch(origin + '/api/permalinks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: canonical(v) });
  const receipts = await Promise.all(Array.from({ length: 4 }, async () => (await send()).json()));
  assert.equal(new Set(receipts.map(r => r.id)).size, 1); const id = receipts[0].id;
  assert.equal(id, await viewDigest(v)); assert.deepEqual(await (await fetch(origin + '/api/permalinks/' + id)).json(), v);
  assert.equal((await readdir(path.join(dir, 'snapshots'))).filter(f => f.endsWith('.json')).length, 1);
  assert.equal(await instanceIdentity(path.join(dir, 'identity')), await instanceIdentity(path.join(dir, 'identity')));
  const bad = await fetch(origin + '/api/permalinks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"v":999}' });
  assert.equal(bad.status, 400);
});

test('address bar round-trips filters, detail size, rail, pan and exact custom camera in a fresh context', async () => {
  const page = await newPage(), other = await newPage();
  try {
    await page.goto(origin); await settle(page);
    await page.fill('#search', 'Image 003'); await settle(page);
    await page.evaluate(() => { const s = document.getElementById('pan-behavior'); s.value = 'edge'; s.dispatchEvent(new Event('change')); });
    await page.locator('.tile').first().click(); await settle(page);
    await page.locator('#detail .thumbs img').nth(1).click();
    await page.getByRole('separator', { name: 'Resize detail pane' }).focus(); await page.keyboard.press('ArrowLeft');
    await page.click('#toggle-rail'); await settle(page);
    await page.click('#zoom-in'); await settle(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#copy-view');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), page.url());
    const url = page.url(), view = await fromURL(url);
    assert.equal(view.scope.query, 'Image 003'); assert.equal(view.ui.rail, false); assert.equal(view.ui.focus, clips[3].url); assert.equal(view.presentation.pan, 'edge');
    assert.equal(view.ui.mediaSource, clips[3].media[1].src);
    assert.equal(view.flat.view.fitted, false); assert.ok(view.ui.detailWidth > .4);
    const cameraStyle = p => p.locator('#canvas').evaluate(n => ({ transform: n.style.transform, width: n.style.width, height: n.style.height }));
    const before = await cameraStyle(page);
    await other.goto(url); await settle(other);
    assert.equal(await other.locator('#search').inputValue(), 'Image 003');
    assert.equal(await other.locator('#detail.open h2').textContent(), 'Image 003');
    assert.equal(await other.locator('#detail-content > img').getAttribute('src'), clips[3].media[1].src);
    assert.equal(await other.locator('#rail').isVisible(), false);
    assert.deepEqual(await cameraStyle(other), before, 'restoration must not auto-Fit custom camera');
    assert.equal(Math.round((await other.locator('#detail').boundingBox()).width), Math.round((await page.locator('#detail').boundingBox()).width));
    await other.setViewportSize({ width: 1100, height: 900 }); await other.goto(url); await settle(other);
    assert.equal(await other.locator('#count b').textContent(), '1');
    assert.equal(await other.locator('#detail.open h2').textContent(), 'Image 003');
  } finally { await page.close(); await other.close(); }
});

test('similarity arrangement and its filtered places survive a permalink in a fresh context', async () => {
  const page = await newPage(), other = await newPage();
  try {
    await page.goto(origin); await settle(page);
    await page.selectOption('#group', '@similarity'); await settle(page);
    await page.locator('[data-facet="color"][data-value="blue"]').click(); await settle(page);
    const view = await fromURL(page.url());
    assert.equal(view.presentation.group, '@similarity');
    const places = p => p.locator('#canvas > .tile').evaluateAll(nodes => nodes.map(n => n.style.transform).sort());
    const before = await places(page);
    assert.equal(before.length, 40);
    await other.goto(page.url()); await settle(other);
    assert.equal(await other.locator('#group').inputValue(), '@similarity');
    assert.deepEqual(await places(other), before, 'restored similarity places differ');
  } finally { await page.close(); await other.close(); }
});

test('arrangement icons switch wall, grid and map through one control, and the grid survives a permalink', async () => {
  const page = await newPage(), other = await newPage();
  try {
    await page.goto(origin); await settle(page);
    const pressed = p => p.locator('#arrange button[aria-pressed="true"]').getAttribute('aria-label');
    assert.equal(await pressed(page), 'Grouped wall');
    const wallGroup = await page.locator('#group').inputValue();
    await page.getByRole('button', { name: 'Similarity grid' }).click(); await settle(page);
    assert.equal(await page.locator('#group').inputValue(), '@similarity-grid');
    assert.equal(await pressed(page), 'Similarity grid');
    assert.equal((await fromURL(page.url())).presentation.group, '@similarity-grid');
    const places = p => p.locator('#canvas > .tile').evaluateAll(nodes => nodes.map(n => n.style.transform).sort());
    const before = await places(page);
    await other.goto(page.url()); await settle(other);
    assert.equal(await pressed(other), 'Similarity grid');
    assert.deepEqual(await places(other), before, 'restored grid places differ');
    await page.getByRole('button', { name: 'Similarity map' }).click(); await settle(page);
    assert.equal(await page.locator('#group').inputValue(), '@similarity');
    await page.getByRole('button', { name: 'Grouped wall' }).click(); await settle(page);
    assert.equal(await page.locator('#group').inputValue(), wallGroup, 'the wall icon returns to the last facet grouping');
  } finally { await page.close(); await other.close(); }
});

test('large cluster union uses an immutable reference and browser Back and Forward restore membership', async () => {
  const page = await newPage(), other = await newPage();
  try {
    await page.goto(origin); await settle(page);
    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settle(page);
    await exposeClusters(page);
    await settle(page); const previous = page.url();
    await page.locator('[data-cluster="color:blue"] .cluster-add').click();
    await page.waitForFunction(() => location.hash.includes('ref=')); await settle(page);
    const url = page.url(), view = await fromURL(url);
    assert.equal(view.scope.branches.length, 2); assert.equal(await page.locator('#count b').textContent(), '60');
    await other.goto(url); await settle(other);
    assert.equal(await other.locator('#count b').textContent(), '60'); assert.equal(await other.locator('.scope-branch').count(), 2);
    await page.goBack(); await settle(page); assert.equal(await page.locator('#count b').textContent(), '40');
    assert.equal(page.url(), previous);
    await page.goForward(); await settle(page); assert.equal(await page.locator('#count b').textContent(), '60');
    assert.deepEqual((await fromURL(url)).scope, view.scope, 'later views cannot mutate an issued snapshot');
  } finally { await page.close(); await other.close(); }
});

test('a zoomed-out background reveal round-trips through the address bar', async () => {
  const page = await newPage(), other = await newPage();
  try {
    await page.goto(origin); await settle(page);
    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settle(page);
    await page.click('#zoom-out'); await settle(page);
    const revealed = p => p.evaluate(() => document.getElementById('canvas').classList.contains('bg-revealed'));
    assert.equal(await revealed(page), true);
    const url = page.url(), view = await fromURL(url);
    assert.equal(view.ui.context, true, 'the reveal latch is part of the view');
    await other.goto(url); await settle(other);
    assert.equal(await other.locator('#count b').textContent(), '40');
    assert.equal(await revealed(other), true);
    assert.equal(await other.locator('#bg-plane .tile').count(), 80);
    await other.click('#zoom-fit'); await settle(other);
    assert.equal(await revealed(other), false);
    assert.equal((await fromURL(other.url())).ui.context, false);
  } finally { await page.close(); await other.close(); }
});

for (const status of [405, 501]) test(`a static host without a snapshot service (${status}) gets the inline link and no notice`, async () => {
  const page = await newPage();
  let attempts = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/permalinks')) attempts++; });
  try {
    failSnapshots = status;
    await page.goto(origin); await settle(page);
    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settle(page);
    await exposeClusters(page);
    await page.locator('[data-cluster="color:blue"] .cluster-add').click(); await settle(page); await settle(page);
    assert.match(page.url(), /#v=1&s=/, 'the address bar holds the full inline view');
    assert.equal(await page.locator('#link-message').textContent(), '', 'no notice for an absent service');
    assert.equal(await page.locator('#link-status').isHidden(), true);
    const saved = await fromURL(page.url());
    await page.locator('#zoom-in').click(); await settle(page);
    assert.deepEqual((await fromURL(page.url())).scope, saved.scope, 'camera edits preserve the self-contained scope');
    assert.equal(attempts, 1, 'an absent snapshot service is not retried for later views');
  } finally { failSnapshots = false; await page.close(); }
});

test('snapshot failure retains a self-contained URL; invalid or wrong-corpus links stay explicit', async () => {
  const page = await newPage(), other = await newPage();
  try {
    failSnapshots = true;
    await page.goto(origin); await settle(page);
    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settle(page);
    await exposeClusters(page);
    await page.locator('.cluster-select').first().click(); await settle(page);
    assert.match(page.url(), /#v=1&s=/); assert.match(await page.locator('#link-message').textContent(), /Compact link unavailable/);
    await other.goto(page.url()); await settle(other); assert.equal(await other.locator('#count b').textContent(), '40');
    const bad = specimen(); bad.corpus.id = 'another'; const url = `${origin}/#v=1&s=${encodeView(bad)}`;
    await other.goto(url); await settle(other); assert.match(await other.locator('#link-message').textContent(), /different corpus/); assert.equal(other.url(), url);
    await other.goto(origin + '/#v=99&s=bad'); await settle(other); assert.match(await other.locator('#link-message').textContent(), /Unsupported/);
  } finally { failSnapshots = false; await page.close(); await other.close(); }
});

// The 3D button opens the floating space; the stacks are the last entry in its menu.
async function openStacks(page) {
  await page.click('#view-3d');
  await page.locator('.float-arrange label:has(input[value=stacks])').click();
  await page.waitForFunction(() => window.__cwSpatial?.built && document.body.dataset.viewMode === '3d');
}

test('spatial expanded pile and custom camera restore without writing mutable saved piles', async () => {
  const page = await newPage(), other = await newPage();
  try {
    await page.goto(origin); await settle(page); await page.selectOption('#group', 'color');
    await openStacks(page);
    // First normal 3D entry may load the saved grouping; deliberate grouping wins in its permalink.
    await page.selectOption('#group', 'color'); await settle(page);
    await page.evaluate(() => { const s = window.__cwSpatial; s._activate(s.piles.piles[0].indices[0]); s.zoomBy(1.3); s.panBy(30, -10); });
    await settle(page); const url = page.url(), spec = await fromURL(url), writes = puts;
    assert.equal(spec.spatial.mode, 'piles'); assert.equal(spec.spatial.spread, 0); assert.equal(spec.spatial.fitted, false);
    await other.goto(url); await other.waitForFunction(() => window.__cwSpatial?.piles?.spreadPile === 0); await settle(other);
    const restored = await other.evaluate(() => window.__cwSpatial.captureView());
    assert.equal(await other.locator('#group').inputValue(), 'color');
    assert.deepEqual(restored.arrangement, spec.spatial.arrangement);
    assert.deepEqual(restored.position, spec.spatial.position); assert.deepEqual(restored.target, spec.spatial.target);
    assert.equal(puts, writes, 'opening a permalink does not publish its arrangement to mutable saved state');
  } finally { await page.close(); await other.close(); }
});


test('changed corpus reports missing members and preserves identities without silently widening scope', async () => {
  const page = await newPage();
  try {
    const spec = specimen(); spec.corpus.revision = 'older-index';
    spec.scope.branches = [{ label: 'Frozen selection', keys: [clips[0].url, 'urn:missing'] }]; spec.ui.focus = 'urn:missing';
    await page.goto(`${origin}/#v=1&s=${encodeView(spec)}`); await settle(page);
    assert.equal(await page.locator('#count b').textContent(), '1');
    assert.match(await page.locator('#link-message').textContent(), /Corpus changed.*missing item.*Focused item/);
    await page.click('#zoom-in'); await settle(page);
    const saved = await fromURL(page.url());
    assert.deepEqual(saved.scope.branches[0].keys, spec.scope.branches[0].keys);
    assert.equal(saved.ui.focus, 'urn:missing');
    await page.goto(origin + '/#v=1&ref=' + 'f'.repeat(64)); await settle(page);
    assert.match(await page.locator('#link-message').textContent(), /snapshot unavailable/);
  } finally { await page.close(); }
});

test('a static host answering 403 for the snapshot endpoint is an absent service, not a failure', async () => {
  // GitHub Pages serves the site under a sub-path and answers 403 — not 404 —
  // for /api/… above it. Treated as a failure, the latch never sets and every
  // large view retries a POST that cannot succeed.
  const page = await newPage();
  try {
    failSnapshots = 403;
    await page.goto(origin); await settle(page);
    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settle(page);
    await exposeClusters(page);
    await page.locator('[data-cluster="color:blue"] .cluster-add').click(); await settle(page); await settle(page);
    assert.match(page.url(), /#v=1&s=/, 'the address bar holds the full inline view');
    assert.equal(await page.locator('#link-message').textContent(), '', 'no notice for an absent service');
    assert.equal(await page.locator('#link-status').isHidden(), true);
  } finally { failSnapshots = false; await page.close(); }
});

test('a stage with no layout box at boot is "not yet", not an invalid view', async () => {
  // The regression: capture() returned {w:0,h:0}, validateView rejected it as
  // "Invalid or unsupported view link", and the throw escaped start()'s
  // unguarded flush — so viewReady never arrived and the permalink layer was
  // dead for the whole page load, with an unhandled rejection and no recovery.
  const page = await newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.addInitScript(() => {
      const hide = () => { const s = document.createElement('style'); s.id = 'no-stage';
        s.textContent = '.stage{display:none!important}'; document.head.append(s); };
      if (document.head) hide(); else document.addEventListener('DOMContentLoaded', hide, { once: true });
    });
    await page.goto(origin);
    await page.waitForSelector('body[data-view-ready=true]', { timeout: 5000 });
    assert.deepEqual(errors, [], 'an unmeasurable stage raises nothing');
    assert.equal(new URL(page.url()).hash, '', 'and writes no view it could not measure');

    // Self-healing: once the stage has a box, the poller records the view.
    await page.evaluate(() => document.getElementById('no-stage')?.remove());
    await page.waitForFunction(() => location.hash.includes('v=1'), null, { timeout: 5000 });
    assert.match(page.url(), /#v=1&s=/, 'the first measurable view is the one that lands');
    assert.deepEqual(errors, [], 'and still nothing raised');

    const spec = await fromURL(page.url());
    assert.ok(spec.flat.stage.w > 0 && spec.flat.stage.h > 0, 'the recorded stage is a real box');
  } finally { await page.close(); }
});


test('restoring a spatial link refreshes membership in an already built renderer', async () => {
  const page = await newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(origin); await settle(page);
    await openStacks(page);
    await page.locator('[data-facet="source"][data-value="new"]').click(); await settle(page);
    const url = page.url(), writes = puts;
    await page.evaluate(() => { window.savedSpatialInstance = window.__cwSpatial; });
    await page.locator('[data-facet="source"][data-value="new"]').click();
    await page.locator('[data-facet="source"][data-value="old"]').click(); await settle(page);
    const activeKeys = () => page.evaluate(() => {
      const s = window.__cwSpatial;
      return s.active.map(i => s.clips[i].url).sort();
    });
    assert.deepEqual(await activeKeys(), clips.filter(c => c.source === 'old').map(c => c.url).sort());
    // Hash navigation hydrates the existing application; a reload would hide
    // this bug by allocating a fresh renderer.
    await page.evaluate(hash => { location.hash = hash; }, new URL(url).hash);
    await settle(page);
    assert.equal(await page.evaluate(() => window.savedSpatialInstance === window.__cwSpatial), true);
    assert.deepEqual(await activeKeys(), clips.filter(c => c.source === 'new').map(c => c.url).sort());
    assert.equal(await page.evaluate(() => window.__cwSpatial.field.activeCount), 40);
    assert.equal(puts, writes, 'hydration does not save piles');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('switching to spatial hides flat group controls and preserves their return state', async () => {
  const page = await newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(origin); await page.selectOption('#group', 'source'); await settle(page);
    assert.equal(await page.locator('#row-title').isVisible(), true, 'overview uses its readable flat group control');
    // Once chosen, the stacks are what the 3D button reopens.
    await openStacks(page);
    assert.equal(await page.locator('#row-title').isHidden(), true, 'flat group control never overlays the spatial field');
    await page.click('#view-3d'); await settle(page);
    assert.equal(await page.locator('#row-title').isVisible(), true, 'flat group control returns with its presentation');
    const original = await page.locator('#canvas').evaluate(node => node.style.transform);
    await page.click('#row-title .rt-focus'); await settle(page);
    assert.equal(await page.locator('#tray-return').isVisible(), true);
    assert.equal(await page.locator('#tray-filter').isVisible(), true);
    const approached = await page.locator('#canvas').evaluate(node => node.style.transform);
    await page.click('#view-3d'); await settle(page);
    for (const id of ['row-title', 'tray-return', 'tray-filter'])
      assert.equal(await page.locator(`#${id}`).isHidden(), true, `${id} belongs only to the flat view`);
    await page.click('#view-3d'); await settle(page);
    assert.equal(await page.locator('#tray-return').isVisible(), true);
    assert.equal(await page.locator('#tray-filter').isVisible(), true);
    assert.equal(await page.locator('#canvas').evaluate(node => node.style.transform), approached, 'switching does not reset the approached flat camera');
    await page.click('#tray-return'); await settle(page);
    assert.equal(await page.locator('#canvas').evaluate(node => node.style.transform), original, 'return still recovers the original flat camera');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('readable live intent restores canonical scope and becomes an exact hash without stale query overrides', async () => {
  const page = await newPage(), other = await newPage();
  try {
    await page.goto(origin + '/?view=flat&group=color&q=Image&facet.year=2026&lens=color&rail=0&flow=vertical');
    await settle(page);
    const url = new URL(page.url()), spec = await fromURL(url);
    assert.equal(spec.scope.query, 'Image'); assert.deepEqual(spec.scope.facets, [['year', ['2026']]]);
    assert.equal(spec.presentation.group, 'color'); assert.equal(spec.ui.lens, 'color'); assert.equal(spec.ui.rail, false);
    assert.equal(await page.locator('#count b').textContent(), '40');
    assert.equal(url.searchParams.get('flow'), 'vertical', 'unrelated instance options survive');
    for (const key of ['view', 'group', 'q', 'facet.year', 'lens', 'rail']) assert.equal(url.searchParams.has(key), false, `${key} was consumed`);
    const saved = specimen(); saved.scope.query = 'Image 003';
    await other.goto(origin + '/?view=invalid&q=Image+007#v=1&s=' + encodeView(saved)); await settle(other);
    assert.equal(await other.locator('#search').inputValue(), 'Image 003', 'saved hash takes precedence over even malformed query intent');
    assert.equal(await other.locator('#count b').textContent(), '1');
    assert.equal(await other.locator('#link-message').textContent(), '');
  } finally { await page.close(); await other.close(); }
});

test('invalid query intent stays visible with a recoverable error rather than silently widening scope', async () => {
  const page = await newPage();
  try {
    await page.goto(origin + '/?facet.year=&view=flat'); await settle(page);
    assert.match(await page.locator('#link-message').textContent(), /Invalid targeted view/);
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(new URL(page.url()).searchParams.has('facet.year'), true);
  } finally { await page.close(); }
});

test('readable intent waits for a measurable stage instead of losing its requested scope', async () => {
  const page = await newPage();
  try {
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style'); style.id = 'intent-hidden-stage';
      style.textContent = '.stage{display:none!important}'; document.head.append(style);
    }, { once: true }));
    await page.goto(origin + '/?q=Image+003&view=flat');
    await page.waitForSelector('body[data-view-ready=true]');
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(new URL(page.url()).searchParams.get('q'), 'Image 003');
    await page.evaluate(() => document.getElementById('intent-hidden-stage').remove());
    await page.waitForFunction(() => location.hash.includes('v=1'));
    assert.equal(await page.locator('#search').inputValue(), 'Image 003');
    assert.equal(await page.locator('#count b').textContent(), '1');
    assert.equal(await page.locator('#link-message').textContent(), '');
  } finally { await page.close(); }
});
