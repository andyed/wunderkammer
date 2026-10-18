// Hover preview in Dive: the pane shows the clip under the pointer, the
// SELECTION does not move, and nothing transient reaches the permalink.
// PERMALINKS.md: "Do not record hover ... in ViewSpec."
import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPermalinkHandler } from '../lib/permalinks.mjs';
import { decodeView } from '../wall/permalink.mjs';

const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#607e90"/></svg>');
const clips = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, url: `urn:item:${i}`, title: `Album ${String(i).padStart(2, '0')}`, source: i % 2 ? 'B' : 'A', captured: '', tags: [], cover, props: {} }));
const facets = { source: { A: 6, B: 6 } };
let browser, server, origin, dir;
const pageErrors = [];
afterEach(() => { assert.deepEqual(pageErrors.splice(0), [], 'no uncaught browser errors'); });

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'detail-preview-'));
  const snapshots = createPermalinkHandler(path.join(dir, 'links'));
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/api/permalinks')) return snapshots(req, res, url.pathname.split('/')[3]);
    if (url.pathname === '/api/clips') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ clips, facets, corpus: { id: 'preview', revision: 'r1' }, ui: { defaultGroup: 'source', facetOrder: ['source'], facetLabels: {} } })); return; }
    if (url.pathname === '/api/view-state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'source', piles: [] })); return; }
    if (url.pathname === '/' || /^\/wall\/[\w.-]+$/.test(url.pathname)) {
      try { const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const data = await readFile(new URL('../' + file, import.meta.url)); res.setHeader('content-type', file.endsWith('html') ? 'text/html' : file.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(data); return; } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); await rm(dir, { recursive: true, force: true }); });

const settle = p => p.waitForTimeout(500);
async function open() {
  const p = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(origin);
  await p.waitForSelector('body[data-view-ready=true]');
  await settle(p);
  return p;
}
// A tile click settles in two stages: the permalink is written, then the scope
// bar appears and resizes the stage, which rewrites it again. Snapshot only
// once it has stopped moving, or the baseline is a frame that never existed.
// Two matching reads are not enough: the second write lands ~500ms after the
// click, so a poll that samples either side of it sees a false quiet. Require
// the URL to hold still for a run of checks that outlasts that gap.
async function stable(p, quiet = 5, step = 150) {
  let last = null, held = 0;
  for (let i = 0; i < 60; i++) {
    const now = p.url();
    held = now === last ? held + 1 : 0;
    last = now;
    if (held >= quiet) return;
    await p.waitForTimeout(step);
  }
  throw new Error('the view never stopped rewriting its URL');
}
const previewed = (p, title) => p.waitForFunction(
  (want) => document.querySelector('.detail[data-preview]') && document.querySelector('.detail-content h2')?.textContent === want,
  title, { timeout: 5000 });
const settledOn = (p, title) => p.waitForFunction(
  (want) => !document.querySelector('.detail[data-preview]') && document.querySelector('.detail-content h2')?.textContent === want,
  title, { timeout: 5000 });
const tile = (p, title) => p.locator(`.tile:not(.bg)[aria-label="${title}"]`);
const paneTitle = p => p.locator('.detail-content h2').textContent();
const selectedLabels = p => p.locator('.tile:not(.bg).selected').evaluateAll(ts => ts.map(t => t.getAttribute('aria-label')));
// The reader overlays a stable desk, so a fixed neighbour may sit under the
// pane, where no real pointer can hover it. Pick a genuinely exposed one.
const exposed = p => p.evaluate(() => {
  const stage = document.querySelector('#stage').getBoundingClientRect();
  const pane = document.querySelector('.detail').getBoundingClientRect();
  return [...document.querySelectorAll('.tile:not(.bg):not(.selected)')].find(node => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return x > stage.left && x < pane.left && y > stage.top && y < stage.bottom
      && document.elementFromPoint(x, y)?.closest('.tile') === node;
  })?.getAttribute('aria-label');
});
async function geometry(p) { return p.evaluate(() => ({ count: document.querySelector('#count').textContent, canvas: document.querySelector('#canvas').style.transform, tiles: [...document.querySelectorAll('.tile')].map(t => [t.getAttribute('aria-label'), t.style.transform]) })); }
async function view(p) { const hash = new URLSearchParams(new URL(p.url()).hash.slice(1)); return hash.has('s') ? decodeView(hash.get('s')) : (await fetch(`${origin}/api/permalinks/${hash.get('ref')}`)).json(); }

test('hover previews another clip while selection, geometry and the permalink stay put', async () => {
  const p = await open();
  try {
    await tile(p, 'Album 00').click();
    await settle(p);
    assert.equal(await paneTitle(p), 'Album 00');
    await stable(p);
    const before = await geometry(p), url = p.url(), spec = await view(p);

    const alternative = await exposed(p);
    assert.ok(alternative, 'an exposed neighbour is available for a real pointer hover');
    await tile(p, alternative).hover();
    await previewed(p, alternative);
    assert.equal(await paneTitle(p), alternative, 'the pane follows the pointer');
    assert.equal(await p.locator('.detail[data-preview]').count(), 1, 'the pane says it is a preview');
    assert.deepEqual(await selectedLabels(p), ['Album 00'], 'the selected ring does not move');
    assert.deepEqual(await geometry(p), before, 'hover moves no tile');
    assert.equal(p.url(), url, 'hover writes no URL');
    assert.deepEqual(await view(p), spec, 'hover reaches no ViewSpec');
  } finally { await p.close(); }
});

test('leaving the tile returns the pane to the selected clip', async () => {
  const p = await open();
  try {
    await tile(p, 'Album 02').click();
    await settle(p);
    const other = await exposed(p);
    await tile(p, other).hover();
    await previewed(p, other);
    await p.locator('#search').hover();
    await settledOn(p, 'Album 02');
    assert.equal(await paneTitle(p), 'Album 02', 'the pane comes home');
    assert.equal(await p.locator('.detail[data-preview]').count(), 0);
    assert.deepEqual(await selectedLabels(p), ['Album 02']);
  } finally { await p.close(); }
});

test('clicking the previewed tile commits it as the selection', async () => {
  const p = await open();
  try {
    await tile(p, 'Album 01').click();
    await settle(p);
    const url = p.url();
    await tile(p, 'Album 09').hover();
    await previewed(p, 'Album 09');
    await tile(p, 'Album 09').click();
    await settle(p);
    assert.equal(await paneTitle(p), 'Album 09');
    assert.equal(await p.locator('.detail[data-preview]').count(), 0, 'commit clears the preview marker');
    assert.deepEqual(await selectedLabels(p), ['Album 09'], 'exactly one tile is selected, and it is the new one');
    assert.notEqual(p.url(), url, 'commit DOES reach the URL');
    const spec = await view(p);
    assert.ok(spec.ui.focus?.includes('urn:item:9'), `focus follows the commit, got ${spec.ui.focus}`);
  } finally { await p.close(); }
});

test('Escape drops the preview before it closes the pane', async () => {
  const p = await open();
  try {
    await tile(p, 'Album 03').click();
    await settle(p);
    const other = await exposed(p);
    await tile(p, other).hover();
    await previewed(p, other);
    assert.equal(await paneTitle(p), other);
    await p.keyboard.press('Escape');
    await settle(p);
    assert.equal(await paneTitle(p), 'Album 03', 'first Escape unwinds the preview only');
    assert.equal(await p.locator('.detail.open').count(), 1, 'the pane is still open');
    await p.keyboard.press('Escape');
    await settle(p);
    assert.equal(await p.locator('.detail.open').count(), 0, 'second Escape closes it');
  } finally { await p.close(); }
});

test('hover does nothing until the detail view is open', async () => {
  const p = await open();
  try {
    const before = await geometry(p), url = p.url();
    await tile(p, 'Album 04').hover();
    await p.waitForTimeout(900);                      // longer than PREVIEW_DWELL
    assert.equal(await p.locator('.detail.open').count(), 0, 'hover alone never opens Dive');
    assert.equal(await p.locator('.detail[data-preview]').count(), 0);
    assert.deepEqual(await geometry(p), before);
    assert.equal(p.url(), url);
  } finally { await p.close(); }
});

test('crossing tiles on the way to the pane leaves it alone, so its links stay clickable', async () => {
  const p = await open();
  try {
    await tile(p, 'Album 00').click();
    await settle(p);
    await stable(p);
    assert.equal(await paneTitle(p), 'Album 00');

    // The pane is to the right of the wall. Walk the pointer across every tile
    // between the selection and the pane, at the speed of someone reaching for
    // a link rather than reading a tile.
    const path = await p.evaluate(() => {
      const pane = document.querySelector('.detail').getBoundingClientRect();
      const start = document.querySelector('.tile:not(.bg)').getBoundingClientRect();
      const y = Math.round(start.y + start.height / 2);
      const from = Math.round(start.x + start.width / 2), to = Math.round(pane.x + 40);
      return Array.from({ length: 14 }, (_, i) => [Math.round(from + (to - from) * (i / 13)), y]);
    });
    for (const [x, y] of path) await p.mouse.move(x, y);

    // Give any pending dwell the chance to fire it would have had.
    await p.waitForTimeout(900);
    assert.equal(await paneTitle(p), 'Album 00', 'transit never became a preview');
    assert.equal(await p.locator('.detail[data-preview]').count(), 0);

    // And resting on a tile still previews — the dwell is a threshold, not a ban.
    await tile(p, 'Album 06').hover();
    await previewed(p, 'Album 06');
  } finally { await p.close(); }
});
