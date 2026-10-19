// Sideways wheel and trackpad scroll walks both hallways along their length:
// the wall page's aisle and the comparison page's album walls. Vertical scroll
// stays a zoom, and a gesture keeps the axis it starts on.
import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Three decades of 48 albums: three racks of three columns a side, so the
// aisle is long enough to walk (travelLength ≈ 8.56 world units).
const DECADES = ['1970s', '1980s', '1990s'];
const clips = Array.from({ length: 144 }, (_, i) => ({
  id: `a${i}`, url: `urn:album:${i}`, title: `Album ${String(i).padStart(3, '0')}`, source: 'Fixture', kind: 'album', tags: [], captured: '2025-01-14',
  cover: `/covers/${i % 2}.svg`, props: { decade: [DECADES[Math.floor(i / 48)]], genre: [i % 3 ? 'Rock' : 'Jazz'], dims: ['128x128'] },
}));
const facets = {};
for (const clip of clips) for (const [key, values] of Object.entries(clip.props)) for (const value of values) { facets[key] ??= {}; facets[key][value] = (facets[key][value] || 0) + 1; }
const payload = { clips, facets, corpus: { id: 'side-scroll-fixture', revision: 'r1' }, ui: { title: 'Side scroll fixture', defaultGroup: 'decade' } };
// world units per pixel of deltaX, from wall/aisle-wheel.mjs
const WALK_PER_PIXEL = 1 / 64;

let browser, server, origin;
const errors = [];
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/api/clips') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(payload)); }
    if (url.pathname === '/api/view-state') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'decade', piles: [] })); }
    if (url.pathname.startsWith('/covers/')) {
      res.setHeader('content-type', 'image/svg+xml');
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="${url.pathname.includes('0') ? '#dc4422' : '#2f85ef'}"/></svg>`);
    }
    if (url.pathname === '/' || /^\/wall\/[\w./-]+$/.test(url.pathname) && !url.pathname.includes('..')) {
      try {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
        return res.end(await readFile(new URL('../' + file, import.meta.url)));
      } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
afterEach(() => assert.deepEqual(errors.splice(0), [], 'no uncaught browser errors'));

async function page(url) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  p.on('pageerror', error => errors.push(error.message));
  p.setDefaultTimeout(10000);
  // Every wheel event the page receives, before any listener can change it.
  await p.addInitScript(() => { window.wheels = []; addEventListener('wheel', e => window.wheels.push([e.deltaX, e.deltaY, e.deltaMode]), { capture: true }); });
  await p.goto(url.startsWith('http') ? url : origin + url);
  return p;
}
async function openAisle(url = '/?view=aisle&group=decade&rail=0') {
  const p = await page(url);
  await p.waitForSelector('body[data-view-ready=true]');
  await p.waitForFunction(() => window.wunderkammerAisleDebug().scene?.travelLength > 0);
  return p;
}
async function openWalls(url = '/wall/compare.html') {
  const p = await page(url);
  await p.waitForSelector('body[data-comparison-ready="true"]');
  await p.waitForSelector('body[data-scene-ready="true"]', { timeout: 20000 });
  await p.waitForFunction(() => window.comparisonDebug().scene?.travelLength > 0);
  return p;
}
const aisle = p => p.evaluate(() => window.wunderkammerAisleDebug().scene);
const walls = p => p.evaluate(() => window.comparisonDebug());
/** Put the pointer over the middle of the hallway canvas, where wheel events land. */
async function hover(p, selector) {
  const box = await p.locator(selector).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}
/** Sideways pixels the page received since the last call, as the listener normalizes them. */
async function sideways(p) {
  return p.evaluate(() => window.wheels.splice(0).reduce((sum, [x, , mode]) => sum + x * (mode === 1 ? 16 : mode === 2 ? 100 : 1), 0));
}
/** A whole gesture in one task, so the axis latch sees it as one gesture whatever the machine's speed. */
function gesture(p, selector, deltas) {
  return p.evaluate(([selector, deltas]) => {
    const canvas = document.querySelector(selector), box = canvas.getBoundingClientRect();
    for (const [deltaX, deltaY] of deltas) canvas.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, deltaMode: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true, cancelable: true }));
  }, [selector, deltas]);
}
const minus = (a, b) => a.map((n, i) => n - b[i]);
const distance = ({ position, target }) => Math.hypot(...minus(position, target));
const near = (actual, expected, message, eps = 1e-4) => assert.ok(Math.abs(actual - expected) <= eps, `${message}: ${actual} ≠ ${expected}`);
const nearAll = (actual, expected, message, eps = 1e-4) => actual.forEach((n, i) => near(n, expected[i], `${message}[${i}]`, eps));
const rest = p => p.waitForTimeout(300); // longer than REST_MS, so the next wheel starts a new gesture
/** Wait until the wall page's address bar holds an aisle at `travel` (an inline #v=1&s= view). */
async function linked(p, travel) {
  for (let i = 0; i < 60; i++) {
    const held = await p.evaluate(async () => {
      const { decodeView } = await import('/wall/permalink.mjs');
      const s = new URLSearchParams(location.hash.slice(1)).get('s');
      return s ? decodeView(s).aisle?.travel ?? null : null;
    });
    if (held === travel) return;
    await p.waitForTimeout(100);
  }
  assert.fail(`the address bar never held the aisle at travel ${travel}`);
}

test('sideways scroll walks the wall page aisle and vertical scroll only zooms', async () => {
  const p = await openAisle();
  let fresh;
  try {
    const start = await aisle(p);
    assert.equal(start.state.travel, 0); assert.equal(start.state.fitted, true);
    await hover(p, '.aisle-canvas'); await sideways(p);
    await p.mouse.wheel(120, 0);
    await p.waitForFunction(() => window.wunderkammerAisleDebug().scene.state.travel > 0);
    const pixels = await sideways(p), walked = await aisle(p);
    assert.ok(pixels > 0, 'the page received a sideways wheel');
    near(walked.state.travel, pixels * WALK_PER_PIXEL / start.travelLength, 'travel follows deltaX');
    assert.equal(walked.state.fitted, true, 'a fitted view stays fitted');
    assert.equal(await p.locator('.aisle-travel input').inputValue(), String(Math.round(walked.state.travel * 1000) / 1000), 'the Walk aisle slider follows');
    // Along the aisle (−z), not across it, and without turning.
    const step = walked.state.travel * start.travelLength;
    nearAll(walked.state.position, [start.state.position[0], start.state.position[1], start.state.position[2] - step], 'camera');
    nearAll(minus(walked.state.target, walked.state.position), minus(start.state.target, start.state.position), 'view direction');

    // The settled view reaches the address bar; a fresh page opens on it.
    await linked(p, walked.state.travel);
    fresh = await openAisle(p.url());
    const restored = await aisle(fresh);
    assert.equal(restored.state.travel, walked.state.travel);
    nearAll(restored.state.position, walked.state.position, 'restored camera');

    await rest(p);
    await p.mouse.wheel(0, 120);
    await p.waitForFunction(() => window.wunderkammerAisleDebug().scene.state.fitted === false);
    const zoomed = await aisle(p);
    assert.equal(zoomed.state.travel, walked.state.travel, 'vertical scroll never walks');
    assert.ok(distance(zoomed.state) > distance(walked.state) + 1e-3, 'vertical scroll zoomed out');
  } finally { await fresh?.close(); await p.close(); }
});

test('a turned aisle view slides along the wall at its angle, and Back returns to it', async () => {
  const p = await openAisle();
  try {
    await p.locator('.aisle-canvas').focus();
    for (let i = 0; i < 4; i++) await p.keyboard.press('Shift+ArrowRight');
    const turned = await aisle(p);
    assert.equal(turned.state.fitted, false);
    await hover(p, '.aisle-canvas'); await sideways(p);
    await p.mouse.wheel(150, 0);
    await p.waitForFunction(() => window.wunderkammerAisleDebug().scene.state.travel > 0);
    const pixels = await sideways(p), walked = await aisle(p), step = walked.state.travel * turned.travelLength;
    near(walked.state.travel, pixels * WALK_PER_PIXEL / turned.travelLength, 'travel follows deltaX');
    assert.equal(walked.state.fitted, false, 'walking keeps the turned view');
    nearAll(walked.state.position, minus(turned.state.position, [0, 0, step]), 'camera');
    nearAll(walked.state.target, minus(turned.state.target, [0, 0, step]), 'target');

    // Walking replaces the history entry, as the slider does; Back from a later
    // view returns to the walked position.
    await linked(p, walked.state.travel);
    await p.locator('#view-aisle').click();
    await p.waitForFunction(() => window.wunderkammerAisleDebug().mode === 'flat');
    // The flat view is a new history entry once the permalink poller pushes it.
    await p.waitForFunction(() => history.state?.cwDepth === 1);
    await p.goBack();
    await p.waitForFunction(() => window.wunderkammerAisleDebug().mode === 'aisle' && !document.body.dataset.restoring);
    const back = await aisle(p);
    assert.equal(back.state.travel, walked.state.travel);
    nearAll(back.state.position, walked.state.position, 'camera after Back');
  } finally { await p.close(); }
});

test('a vertical swipe never walks and a sideways swipe never zooms', async () => {
  const p = await openAisle();
  try {
    const start = await aisle(p);
    // Mostly vertical; its tail jitters sideways more than it moves down.
    await gesture(p, '.aisle-canvas', [[6, 40], [8, 40], [5, 30], [4, 20], [5, 1], [3, 0]]);
    const zoomed = await aisle(p);
    assert.equal(zoomed.state.travel, 0, 'the sideways jitter of a vertical swipe stays a zoom');
    assert.ok(distance(zoomed.state) > distance(start.state) + 1e-3, 'the vertical swipe zoomed');
    await rest(p);
    // Mostly sideways; its tail jitters vertically more than it moves across.
    await gesture(p, '.aisle-canvas', [[40, 6], [40, 8], [30, 5], [20, 4], [1, 5], [0, 3]]);
    const walked = await aisle(p);
    near(walked.state.travel, 131 * WALK_PER_PIXEL / start.travelLength, 'the whole sideways swipe walks');
    near(distance(walked.state), distance(zoomed.state), 'the sideways swipe never zooms', 1e-6);
  } finally { await p.close(); }
});

test('sideways scroll walks the comparison walls like the Walk aisle slider', async () => {
  const p = await openWalls();
  let fresh;
  try {
    const start = await walls(p);
    assert.equal(start.presentation.view, 'walls');
    assert.equal(start.presentation.travel ?? 0, 0);
    await p.locator('#comparison-stage').scrollIntoViewIfNeeded();
    await hover(p, '#comparison-stage canvas'); await sideways(p);
    await p.mouse.wheel(120, 0);
    await p.waitForFunction(() => window.comparisonDebug().presentation.travel > 0);
    const pixels = await sideways(p), walked = await walls(p), travel = walked.presentation.travel;
    near(travel, pixels * WALK_PER_PIXEL / start.scene.travelLength, 'travel follows deltaX');
    assert.equal(await p.locator('#aisle-travel').inputValue(), String(Math.round(travel * 100)));
    assert.equal(await p.locator('#aisle-position').textContent(), `${Math.round(travel * 100)}%`);
    const url = new URL(p.url());
    assert.equal(url.searchParams.get('travel'), String(travel), 'the URL carries travel');
    assert.equal(url.searchParams.has('camera'), false, 'a fitted walk needs no camera in the URL');
    const step = travel * start.scene.travelLength;
    nearAll(walked.scene.camera.position, minus(start.scene.camera.position, [0, 0, step]), 'camera');
    nearAll(walked.scene.camera.target, minus(start.scene.camera.target, [0, 0, step]), 'target');
    fresh = await openWalls(p.url());
    nearAll((await walls(fresh)).scene.camera.position, walked.scene.camera.position, 'fresh page camera');
    await fresh.close(); fresh = null;

    // Vertical scroll zooms and leaves travel; a zoomed view then walks at its angle.
    await rest(p);
    await p.mouse.wheel(0, 120);
    await p.waitForFunction(() => new URL(location.href).searchParams.has('camera'));
    const zoomed = await walls(p);
    assert.equal(zoomed.presentation.travel, travel, 'vertical scroll never walks');
    assert.ok(Math.abs(distance(zoomed.scene.camera) - distance(walked.scene.camera)) > 1e-3, 'vertical scroll zoomed');
    await rest(p); await sideways(p);
    await p.mouse.wheel(120, 0);
    await p.waitForFunction(old => window.comparisonDebug().presentation.travel > old, travel);
    const pixels2 = await sideways(p), again = await walls(p), step2 = (again.presentation.travel - travel) * start.scene.travelLength;
    near(again.presentation.travel - travel, pixels2 * WALK_PER_PIXEL / start.scene.travelLength, 'second walk follows deltaX');
    nearAll(again.scene.camera.position, minus(zoomed.scene.camera.position, [0, 0, step2]), 'zoomed camera');
    nearAll(again.scene.camera.target, minus(zoomed.scene.camera.target, [0, 0, step2]), 'zoomed target');
    const camera = new URL(p.url()).searchParams.get('camera').split(',').map(Number);
    nearAll(camera, [...again.scene.camera.position, ...again.scene.camera.target], 'URL camera', 1e-4);
    assert.equal(new URL(p.url()).searchParams.get('travel'), String(again.presentation.travel));

    // Back from a later view returns to the walked position.
    await p.locator('[data-view=depth]').click();
    await p.waitForFunction(() => window.comparisonDebug().presentation.view === 'depth');
    await hover(p, '#comparison-stage canvas');
    await p.mouse.wheel(120, 0);
    await rest(p);
    assert.equal((await walls(p)).presentation.travel, again.presentation.travel, 'the depth view does not walk');
    await p.goBack();
    await p.waitForFunction(() => window.comparisonDebug().presentation.view === 'walls');
    const back = await walls(p);
    assert.equal(back.presentation.travel, again.presentation.travel);
    nearAll(back.scene.camera.position, again.scene.camera.position, 'camera after Back');
  } finally { await fresh?.close(); await p.close(); }
});
