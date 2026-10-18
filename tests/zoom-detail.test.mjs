// Details on zoom (peer-study ledger idea 27): zooming in until one cover
// dominates the free view previews it with no click, zooming out hides it,
// and none of that commits a selection, moves the camera or reaches ViewSpec.
import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPermalinkHandler } from '../lib/permalinks.mjs';
import { decodeView } from '../wall/permalink.mjs';
import { zoomDetailCandidate, ZOOM_DETAIL_OPEN, ZOOM_DETAIL_CLOSE } from '../wall/zoom-detail.mjs';

/* ---------------------------------------------------------------- rule --- */

const square = (id, x, y, size = 100) => ({ clip: { id }, x, y, w: size, h: size });
const stage = { width: 1000, height: 800 };

test('rule: opens above half the free view, closes only below the close threshold', () => {
  const tiles = [square('a', 0, 0)];
  // Free width 1000 - 400 = 600; an item 0.55 of 600 wide opens, 0.45 does not.
  const at = ratio => ({ tiles, stage, rail: 400, pose: { x: 0, y: 0, scale: ratio * 600 / 100 } });
  assert.equal(zoomDetailCandidate(at(0.55))?.id, 'a');
  assert.equal(zoomDetailCandidate(at(0.45)), null, 'not yet open: 0.45 is below the open threshold');
  assert.equal(zoomDetailCandidate({ ...at(0.45), open: true, current: 'a' })?.id, 'a', 'already open: 0.45 holds');
  assert.equal(zoomDetailCandidate({ ...at(0.35), open: true, current: 'a' }), null, 'below the close threshold');
  assert.ok(ZOOM_DETAIL_CLOSE < ZOOM_DETAIL_OPEN);
});

test('rule: the item nearest the centre of the uncovered view wins, and a held item stays while it covers that centre', () => {
  // Two 400px items side by side; the free centre (x 300) lies in the left one,
  // the full-stage centre (x 500) on their shared edge.
  const tiles = [square('left', 100, 200, 400), square('right', 500, 200, 400)];
  const pose = { x: 0, y: 0, scale: 1 };
  assert.equal(zoomDetailCandidate({ tiles, stage, pose, rail: 400 })?.id, 'left');
  // A big item still covering the free centre (x 300), a small one nearer it.
  const uneven = [square('big', -250, 100, 600), square('small', 350, 300, 200)];
  assert.equal(zoomDetailCandidate({ tiles: uneven, stage, pose, rail: 400 })?.id, 'small');
  assert.equal(zoomDetailCandidate({ tiles: uneven, stage, pose, rail: 400, open: true, current: 'big' })?.id, 'big', 'the held item keeps it');
});

test('rule: off-screen items and broken geometry never decide', () => {
  assert.equal(zoomDetailCandidate({ tiles: [square('far', 5000, 0, 900)], stage, pose: { x: 0, y: 0, scale: 1 } }), null);
  assert.equal(zoomDetailCandidate({ tiles: [square('a', 0, 0)], stage, pose: { x: NaN, y: 0, scale: 9 } }), null);
  assert.equal(zoomDetailCandidate({ tiles: [square('a', 0, 0)], stage: { width: 0, height: 0 }, pose: { x: 0, y: 0, scale: 9 } }), null);
});

/* ------------------------------------------------------------- browser --- */

const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#607e90"/></svg>');
const clips = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, url: `urn:item:${i}`, title: `Album ${String(i).padStart(2, '0')}`, source: i % 2 ? 'B' : 'A', captured: '', tags: [], cover, props: {} }));
const facets = { source: { A: 15, B: 15 } };
let browser, server, origin, dir;
const pageErrors = [];
afterEach(() => { assert.deepEqual(pageErrors.splice(0), [], 'no uncaught browser errors'); });

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'zoom-detail-'));
  const snapshots = createPermalinkHandler(path.join(dir, 'links'));
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/api/permalinks')) return snapshots(req, res, url.pathname.split('/')[3]);
    if (url.pathname === '/api/clips') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ clips, facets, corpus: { id: 'zoom', revision: 'r1' }, ui: { defaultGroup: 'none', facetOrder: ['source'], facetLabels: {} } })); return; }
    if (url.pathname === '/api/view-state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'none', piles: [] })); return; }
    if (url.pathname === '/' || /^\/wall\/[\w.-]+$/.test(url.pathname)) {
      try { const file = url.pathname === '/' ? 'wall/index.html' : url.pathname.slice(1); const data = await readFile(new URL('../' + file, import.meta.url)); res.setHeader('content-type', file.endsWith('html') ? 'text/html' : file.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(data); return; } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); await rm(dir, { recursive: true, force: true }); });

// Longer than a wheel landing (140 ms) plus the zoom-detail quiet (120 ms).
const land = p => p.waitForTimeout(600);
async function open() {
  const p = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(origin);
  await p.waitForSelector('body[data-view-ready=true]');
  await land(p);
  // Count every time the pane opens or closes, and the camera at each toggle.
  await p.evaluate(() => {
    const detail = document.querySelector('.detail'), canvas = document.querySelector('#canvas');
    window.__paneLog = [];
    let was = detail.classList.contains('open');
    new MutationObserver(() => {
      const now = detail.classList.contains('open');
      if (now !== was) window.__paneLog.push({ open: now, camera: canvas.style.transform, stage: JSON.stringify(document.querySelector('#stage').getBoundingClientRect()) });
      was = now;
    }).observe(detail, { attributes: true, attributeFilter: ['class'] });
  });
  return p;
}

/** The free view the rule measures against: the stage minus the pane's width. */
const freeView = p => p.evaluate(() => {
  const s = document.querySelector('#stage').getBoundingClientRect();
  const rail = s.right - (window.innerWidth - document.querySelector('.detail').offsetWidth);
  return { left: s.left, top: s.top, width: s.width - rail, height: s.height, cx: s.left + (s.width - rail) / 2, cy: s.top + s.height / 2 };
});
/** The largest share of the free view any visible tile occupies (the rule's measure). */
const dominance = p => p.evaluate(() => {
  const s = document.querySelector('#stage').getBoundingClientRect();
  const freeW = s.width - (s.right - (window.innerWidth - document.querySelector('.detail').offsetWidth));
  let best = 0;
  for (const t of document.querySelectorAll('.tile:not(.bg)')) {
    const r = t.getBoundingClientRect();
    if (r.right <= s.left || r.left >= s.right || r.bottom <= s.top || r.top >= s.bottom) continue;
    best = Math.max(best, r.width / freeW, r.height / s.height);
  }
  return best;
});
/** The tile nearest the centre of the free view; a zoom anchored there keeps it there. */
const central = p => p.evaluate(() => {
  const s = document.querySelector('#stage').getBoundingClientRect();
  const freeW = s.width - (s.right - (window.innerWidth - document.querySelector('.detail').offsetWidth));
  const cx = s.left + freeW / 2, cy = s.top + s.height / 2;
  let best = null, dist = Infinity;
  for (const t of document.querySelectorAll('.tile:not(.bg)')) {
    const r = t.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (d < dist) { dist = d; best = t.getAttribute('aria-label'); }
  }
  return best;
});
/** Ctrl+wheel (a trackpad pinch) anchored on the free centre until the view reaches `target` dominance. */
async function zoomTo(p, target, { settle = true } = {}) {
  const v = await freeView(p);
  await p.mouse.move(v.cx, v.cy);
  const now = await dominance(p);
  // viewport.mjs: factor = exp(-deltaY * 0.01).
  await p.keyboard.down('Control');
  await p.mouse.wheel(0, -Math.log(target / now) / 0.01);
  await p.keyboard.up('Control');
  if (settle) await land(p);
  if (process.env.ZOOM_DEBUG) console.log('zoomTo', target, 'from', now.toFixed(3), 'got', (await dominance(p)).toFixed(3));
}
const state = p => p.evaluate(() => ({
  open: document.querySelector('.detail').classList.contains('open'),
  preview: !!document.querySelector('.detail[data-preview]'),
  title: document.querySelector('.detail.open .detail-content h2')?.textContent ?? null,
  selected: [...document.querySelectorAll('.tile:not(.bg).selected')].map(t => t.getAttribute('aria-label')),
  log: window.__paneLog.slice(),
}));
async function view(p) {
  const hash = new URLSearchParams(new URL(p.url()).hash.slice(1));
  if (hash.has('s')) return decodeView(hash.get('s'));
  if (hash.has('ref')) return (await fetch(`${origin}/api/permalinks/${hash.get('ref')}`)).json();
  return null;
}
const withoutCamera = spec => spec && { ...spec, flat: { ...spec.flat, view: undefined } };

test('zooming into a cover shows its details with no click, and the camera does not move when they appear', async () => {
  const p = await open();
  try {
    const item = await central(p);
    const before = await view(p);
    await zoomTo(p, 0.62);
    const s = await state(p);
    assert.ok(s.open && s.preview, 'the pane opens as a preview');
    assert.equal(s.title, item, 'the item at the centre of the uncovered view, not the one under the pane');
    assert.deepEqual(s.selected, [], 'no selection is committed');
    assert.equal(s.log.length, 1);
    const camera = await p.evaluate(() => document.querySelector('#canvas').style.transform);
    assert.equal(s.log[0].camera, camera, 'the camera is where it landed before the pane opened');
    await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => document.querySelector('#canvas').style.transform), camera, 'and stays there');
    const after = await view(p);
    assert.equal(after?.ui?.focus ?? null, before?.ui?.focus ?? null, 'focus does not reach ViewSpec');
    assert.deepEqual(withoutCamera(after), withoutCamera(before), 'only the zoom itself reaches the permalink');
  } finally { await p.close(); }
});

test('zooming back out hides the details', async () => {
  const p = await open();
  try {
    const item = await central(p);
    await zoomTo(p, 0.62);
    assert.equal((await state(p)).open, true);
    await zoomTo(p, 0.3);
    const s = await state(p);
    assert.equal(s.open, false, 'the pane closes');
    assert.equal(s.preview, false);
    assert.deepEqual(s.log.map(e => e.open), [true, false]);
    assert.equal(s.log[0].stage, s.log[1].stage, 'the stage box never changes');
  } finally { await p.close(); }
});

test('no flapping near the threshold: hysteresis holds, and a wheel run is decided only where it lands', async () => {
  const p = await open();
  try {
    const item = await central(p);
    await zoomTo(p, 0.45);
    assert.equal((await state(p)).open, false, 'below the open threshold nothing opens');
    await zoomTo(p, 0.58);
    assert.equal((await state(p)).open, true);
    await zoomTo(p, 0.45);
    assert.equal((await state(p)).open, true, 'between the thresholds an open preview holds');
    await zoomTo(p, 0.52);
    await zoomTo(p, 0.44);
    assert.equal((await state(p)).title, item, 'the same item throughout');
    await zoomTo(p, 0.32);
    assert.equal((await state(p)).open, false);

    // One continuous run: in past the threshold and back out, ticks 30 ms apart.
    const v = await freeView(p);
    await p.mouse.move(v.cx, v.cy);
    await p.keyboard.down('Control');
    for (const dy of [-20, -20, -20, -20, -20, 20, 20, 20, 20, 20]) { await p.mouse.wheel(0, dy); await p.waitForTimeout(30); }
    await p.keyboard.up('Control');
    await land(p);
    const s = await state(p);
    assert.deepEqual(s.log.map(e => e.open), [true, false], 'the run passed 0.5 mid-gesture but landed below it: no toggle');
  } finally { await p.close(); }
});

test('a click still selects, and Escape puts a zoom preview away until the view zooms out', async () => {
  const p = await open();
  try {
    const item = await central(p);
    await zoomTo(p, 0.62);
    await p.keyboard.press('Escape');
    await land(p);
    assert.equal((await state(p)).open, false, 'Escape closes the zoom preview');
    await zoomTo(p, 0.66);
    assert.equal((await state(p)).open, false, 'a further zoom on the same item does not reopen it');
    await zoomTo(p, 0.3);
    await zoomTo(p, 0.62);
    assert.equal((await state(p)).open, true, 'zooming out and back in again does');

    const v = await freeView(p);
    await p.mouse.click(v.cx, v.cy);
    await land(p);
    const s = await state(p);
    assert.equal(s.preview, false, 'a click commits');
    assert.deepEqual(s.selected, [item]);
    assert.ok((await view(p))?.ui?.focus?.includes(`urn:item:${Number(item.slice(6))}`), 'and the commit reaches ViewSpec');
    await p.keyboard.press('Escape');
    await land(p);
    assert.equal((await state(p)).open, false, 'Escape closes the selection as before');
  } finally { await p.close(); }
});
