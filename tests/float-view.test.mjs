import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { WORLD, RADIUS } from '../wall/float-space.mjs';

// Every cover is a flat field of its own palette colour, so a frame pixel can
// be checked against the colour that placed the item.
const colours = [
  ['Red', 'ff0000', 'warm'], ['Green', '00ff00', 'cool'], ['Blue', '0000ff', 'cool'], ['White', 'ffffff', 'neutral'],
  ['Black', '000000', 'neutral'], ['Grey', '808080', 'neutral'], ['Yellow', 'ffff00', 'warm'], ['Magenta', 'ff00ff', 'warm'],
  ['Cyan', '00ffff', 'cool'], ['Orange', 'ff8000', 'warm'], ['Navy', '1a2a6c', 'cool'], ['Teal', '2a9d8f', 'cool'],
  ['Salmon', 'fa8072', 'warm'], ['Olive', '808000', 'warm'], ['Purple', '800080', 'cool'], ['Dark slate', '333333', 'neutral'],
  ['Light grey', 'cccccc', 'neutral'], ['Pink', 'ffc0cb', 'warm'], ['Brown', '8b4513', 'warm'], ['2 Fast lime', '32cd32', 'cool'],
  ['Éclair', 'f3e5ab', 'warm'],
];
const clips = colours.map(([title, hex, family], i) => ({ id: `f${i}`, url: `urn:float:${hex}`, title, source: 'Fixture', tags: [], captured: '2025-01-14',
  cover: `/covers/${hex}.svg`, palette: [`#${hex}`, '#123456'], props: { family: [family], dims: ['160x120'] } }));
clips.push({ id: 'nopal', url: 'urn:float:nopalette', title: 'Unpainted', source: 'Fixture', tags: [], captured: '2025-01-14', cover: '/covers/445566.svg', props: { family: ['neutral'], dims: ['120x120'] } });
const facets = {}; for (const clip of clips) for (const [key, values] of Object.entries(clip.props)) for (const value of values) { facets[key] ??= {}; facets[key][value] = (facets[key][value] || 0) + 1; }
const key = hex => `urn:float:${hex}`;
const coolCount = clips.filter(c => c.props.family.includes('cool')).length;
// Ottosson's published OKLab coordinates for sRGB primaries: an oracle
// independent of the code under test.
const OKLAB = { ff0000: [0.627955, 0.224863, 0.125846], '00ff00': [0.866440, -0.233888, 0.179498], '0000ff': [0.452014, -0.032457, -0.311528],
  ffff00: [0.967983, -0.071369, 0.198570], ff00ff: [0.701674, 0.274566, -0.169156], '00ffff': [0.905399, -0.149444, -0.039398], ffffff: [1, 0, 0], '000000': [0, 0, 0] };

let browser, server, origin; const errors = [], writes = [];
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (req.method !== 'GET') writes.push([req.method, url.pathname]);
    if (url.pathname === '/api/clips') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ clips, facets, corpus: { id: 'float-fixture', revision: 'r1' }, ui: { title: 'Float fixture', defaultGroup: 'family' } })); return; }
    if (url.pathname === '/api/view-state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'family', piles: [] })); return; }
    const cover = /^\/covers\/([0-9a-f]{6})\.svg$/.exec(url.pathname);
    if (cover) { res.setHeader('content-type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#${cover[1]}"/></svg>`); return; }
    if (url.pathname === '/' || /^\/wall\/[\w./-]+$/.test(url.pathname) && !url.pathname.includes('..')) {
      try { const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(new URL('../' + file, import.meta.url))); return; } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); });
afterEach(() => { assert.deepEqual(errors.splice(0), []); assert.equal(writes.splice(0).some(([, p]) => p === '/api/view-state'), false, 'the floating space never writes pile state'); });

const debug = p => p.evaluate(() => window.wunderkammerFloatDebug());
async function open(query = '?view=float&rail=0', { mobile = false, motion = false } = {}) {
  const p = await browser.newPage({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000 }, isMobile: mobile, hasTouch: mobile, reducedMotion: motion ? 'no-preference' : 'reduce' });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(query.startsWith('http') ? query : `${origin}/${query}`);
  await p.waitForSelector('body[data-view-ready=true]');
  await settled(p);
  return p;
}
/** Every tile loaded, nothing travelling, no flight in progress. */
const settled = p => p.waitForFunction(() => { const s = window.wunderkammerFloatDebug?.().scene; return s && s.built && s.loading === 0 && s.farResident === s.itemCount && !s.moving && !s.flying; }, null, { timeout: 15000 });
const near = (a, b, tolerance, message) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= tolerance), `${message}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
async function clickItem(p, scene, k) {
  const [x, y] = scene.screen[k], box = await p.locator('.float-canvas').boundingBox();
  await p.mouse.click(box.x + (x + 1) / 2 * box.width, box.y + (1 - y) / 2 * box.height);
}

test('float arrangement places each item at its dominant colour in OKLab, OKLCH and HSL, and in title order for A–Z', async () => {
  const p = await open(); try {
    let { scene } = await debug(p);
    assert.equal(scene.arrangement, 'oklab'); assert.equal(scene.itemCount, 22); assert.equal(scene.dimMode, 'brightness');
    const k = scene.stretch; assert.ok(k >= 1 && k <= 4 && Number.isInteger(k * 2), `a/b stretch is a half step in [1, 4], got ${k}`);
    for (const [hex, [L, a, b]] of Object.entries(OKLAB)) near(scene.exact[key(hex)], [a * WORLD * k, (L - 0.5) * WORLD, b * WORLD * k], 2 * k, `OKLab #${hex}`);
    // Declumping may separate near-identical colours, but never by more than 0.6 of a tile edge.
    for (const [id, exact] of Object.entries(scene.exact)) assert.ok(Math.hypot(...exact.map((v, i) => v - scene.targets[id][i])) <= scene.edge * 0.6 + 1e-3, `${id} stays near its colour`);
    for (const [id, target] of Object.entries(scene.targets)) near(scene.positions[id], target, 0.01, `${id} is drawn where it is placed`);
    const colourBottom = Math.min(...Object.entries(scene.targets).filter(([id]) => id !== key('nopalette')).map(([, t]) => t[1]));
    assert.ok(scene.targets[key('nopalette')][1] < colourBottom, 'an item without a palette waits on a shelf below the space');
    assert.ok(scene.labels.includes('No palette · 1')); assert.ok(scene.labels.some(l => l.startsWith('L 1.00')));

    await p.locator('.float-arrange input[value=hsl]').check(); await settled(p); ({ scene } = await debug(p));
    assert.equal(scene.arrangement, 'hsl');
    const deg = d => d * Math.PI / 180;
    near(scene.exact[key('ff0000')], [RADIUS, 0, 0], 0.01, 'HSL red');
    near(scene.exact[key('0000ff')], [RADIUS * Math.cos(deg(240)), 0, RADIUS * Math.sin(deg(240))], 0.01, 'HSL blue');
    near(scene.exact[key('ffff00')], [RADIUS * Math.cos(deg(60)), 0, RADIUS * Math.sin(deg(60))], 0.01, 'HSL yellow');
    near(scene.exact[key('ffffff')], [0, WORLD / 2, 0], 0.01, 'HSL white'); near(scene.exact[key('808080')], [0, (128 / 255 - 0.5) * WORLD, 0], 0.01, 'HSL grey');
    // A bicone: navy's radius is its HSL chroma, (108 − 26) / 255, not its saturation (0.61).
    const navyHue = ((26 - 42) / (108 - 26) + 4) * 60;
    near(scene.exact[key('1a2a6c')], [RADIUS * 82 / 255 * Math.cos(deg(navyHue)), ((108 + 26) / 2 / 255 - 0.5) * WORLD, RADIUS * 82 / 255 * Math.sin(deg(navyHue))], 0.01, 'HSL navy');
    near(scene.exact[key('000000')], [0, -WORLD / 2, 0], 0.01, 'HSL black sits on the axis');
    for (const [id, target] of Object.entries(scene.targets)) near(scene.positions[id], target, 0.01, `${id} moved to its HSL place`);

    await p.locator('.float-arrange input[value=oklch]').check(); await settled(p); ({ scene } = await debug(p));
    for (const [hex, [L, a, b]] of Object.entries(OKLAB)) {
      const [x, y, z] = scene.exact[key(hex)];
      near([y], [(L - 0.5) * WORLD], 2, `OKLCH lightness #${hex}`);
      if (Math.hypot(a, b) > 0.02) near([Math.atan2(z, x)], [Math.atan2(b, a)], 0.002, `OKLCH hue angle #${hex}`);
    }

    await p.locator('.float-arrange input[value=az]').check(); await settled(p); ({ scene } = await debug(p));
    const byTitle = clips.map(c => [c.title, c.url]).sort(([a], [b]) => {
      const shelf = t => /^[0-9]/.test(t) ? '0' : t.normalize('NFD')[0].toUpperCase();
      return shelf(a).localeCompare(shelf(b)) || a.localeCompare(b);
    });
    const rows = byTitle.map(([, id]) => scene.targets[id]);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i][1] < rows[i - 1][1] - 1e-6 || rows[i][1] === rows[i - 1][1] && rows[i][0] > rows[i - 1][0], `A–Z reading order at ${byTitle[i][0]}`);
    assert.ok(rows.every(t => t[2] === 0), 'A–Z is a flat wall');
    for (const shelf of ['0–9', 'B', 'E', 'R', 'W']) assert.ok(scene.labels.includes(shelf), `shelf ${shelf}`);
    near(scene.screen[key('ff0000')].slice(2, 3), [scene.screen[key('0000ff')][2]], 1, 'Fit sees the flat wall square on');
  } finally { await p.close(); }
  // Without reduced motion, items travel to their new places rather than jumping.
  const m = await open('?view=float&rail=0', { motion: true }); try {
    // Count animation frames alongside renders: a transition draws at most once per frame.
    await m.evaluate(() => { window.__frames = 0; const count = () => { window.__frames++; requestAnimationFrame(count); }; requestAnimationFrame(count); window.__renders0 = window.__cwFloat.renderCount; });
    await m.locator('.float-arrange input[value=hsl]').check();
    const mid = await m.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.wunderkammerFloatDebug().scene)))));
    assert.ok(mid.moving > 0, 'the arrangement change animates');
    const red = mid.positions[key('ff0000')], target = mid.targets[key('ff0000')];
    assert.ok(Math.hypot(...red.map((v, i) => v - target[i])) > 1, 'red is still on its way');
    await settled(m); const done = (await debug(m)).scene;
    const { frames, renders } = await m.evaluate(() => ({ frames: window.__frames, renders: window.__cwFloat.renderCount - window.__renders0 }));
    assert.ok(renders <= frames + 2, `${renders} renders in ${frames} animation frames: one render loop, not several`);
    for (const [id, t] of Object.entries(done.targets)) near(done.positions[id], t, 0.01, `${id} arrived`);
  } finally { await m.close(); }
});

test('float fly-to: clicking an item flies to it and opens the detail pane; the item menu, keys and Fit reach every item', async () => {
  const p = await open(); try {
    let { scene, view } = await debug(p);
    const id = key('fa8072');
    await clickItem(p, scene, id); await p.waitForSelector('#detail.open'); await settled(p);
    ({ scene, view } = await debug(p));
    assert.equal(view.ui.focus, id); assert.equal(scene.selection, id); assert.equal(scene.state.fitted, false);
    const stage = await p.locator('.float-canvas').boundingBox(), pane = await p.locator('#detail').boundingBox();
    const [x, y, , share] = scene.screen[id], visibleCentre = ((pane.x - stage.x) / 2) / stage.width * 2 - 1;
    near([x], [visibleCentre], 0.03, 'the item lands in the middle of the stage left of the detail pane');
    near([y], [0], 0.03, 'and level with the stage centre');
    near([share], [0.38], 0.03, 'large enough to read');
    await p.keyboard.press('Escape'); await p.waitForSelector('#detail.open', { state: 'hidden' });

    // The item menu flies without opening; Inspect opens.
    await p.selectOption('.float-items select', key('0000ff')); await settled(p); ({ scene } = await debug(p));
    near(scene.screen[key('0000ff')].slice(0, 2), [0, 0], 0.03, 'the menu flies to the chosen item');
    assert.equal(await p.locator('#detail.open').count(), 0);
    await p.locator('.float-toolbar button').click(); await p.waitForSelector('#detail.open');
    assert.equal((await debug(p)).view.ui.focus, key('0000ff'));
    await p.keyboard.press('Escape'); await p.waitForSelector('#detail.open', { state: 'hidden' });

    // ] steps to the next item in the arrangement's order, and flies there.
    await p.locator('.float-canvas').focus(); await p.keyboard.press(']'); await settled(p); ({ scene } = await debug(p));
    assert.notEqual(scene.selection, key('0000ff')); near(scene.screen[scene.selection].slice(0, 2), [0, 0], 0.03, '] flies to the next item');

    // Free flight changes the camera; Home returns to the whole space.
    await p.keyboard.press('w'); await p.keyboard.press('ArrowLeft'); assert.equal((await debug(p)).scene.state.fitted, false);
    await p.keyboard.press('Home'); await settled(p); ({ scene } = await debug(p));
    assert.equal(scene.state.fitted, true);
    for (const [k2, [sx, sy, depth]] of Object.entries(scene.screen)) assert.ok(depth > 0 && Math.abs(sx) <= 1 && Math.abs(sy) <= 1, `${k2} is on screen after Fit`);
  } finally { await p.close(); }
});

test('float scope dims items outside the search and facets in place, without moving any item or the camera', async () => {
  const p = await open('?view=float'); try {
    // A fitted camera refits when the stage resizes (the scope bar appears with
    // a filter), so step off Fit first: a placed camera must not move at all.
    if (await p.locator('#rail.hidden').count()) { await p.locator('#toggle-rail').click(); await settled(p); }
    await p.locator('.float-canvas').focus(); await p.keyboard.press('ArrowLeft'); await settled(p);
    const before = (await debug(p)).scene; assert.equal(before.state.fitted, false);
    const sample = id => p.evaluate(k => window.__cwFloat.samplePixel(k), id);
    // Every tile draws its own flat colour across its whole face, as sRGB: mid
    // grey stays mid grey, and no tile borrows part of a neighbouring slot.
    for (const clip of clips) {
      const hex = /([0-9a-f]{6})\.svg$/.exec(clip.cover)[1], rgb = [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16));
      const grid = await p.evaluate(k => window.__cwFloat.isolatedSamples(k), clip.url);
      for (const [k, pixel] of grid.entries()) near(pixel, rgb, 4, `${clip.title} sample ${k}`);
    }
    await p.locator('.chip[data-facet=family][data-value=cool]').click();
    await p.waitForFunction(n => window.wunderkammerFloatDebug().scene.scopeCount === n, coolCount); await settled(p);
    const scoped = (await debug(p)).scene;
    assert.deepEqual(scoped.positions, before.positions, 'no item moved');
    assert.deepEqual(scoped.targets, before.targets, 'no item was re-placed');
    assert.deepEqual(scoped.state.position, before.state.position); assert.deepEqual(scoped.state.target, before.state.target);
    const cool = new Set(clips.filter(c => c.props.family.includes('cool')).map(c => c.url));
    for (const [id, opacity] of Object.entries(scoped.opacity)) assert.equal(opacity, cool.has(id) ? 1 : 0.25, `${id} brightness`);
    assert.deepEqual(new Set(scoped.inScope), cool);
    // Dimmed: a quarter of the brightness, most of the saturation gone.
    const red = await sample(key('ff0000')), luma = 0.2126 * 255;
    near(red, [(luma + 0.35 * (255 - luma)) * 0.25, luma * 0.65 * 0.25, luma * 0.65 * 0.25], 4, 'dimmed red pixel');
    near(await sample(key('00ff00')), [0, 255, 0], 4, 'in-scope green keeps its colour');
    // A click on a dimmed item passes through it; the menu lists only the scope.
    await clickItem(p, scoped, key('ff0000')); await p.waitForTimeout(300);
    assert.equal(await p.locator('#detail.open').count(), 0, 'dimmed items do not take clicks');
    assert.equal(await p.locator('.float-items select option[value]:not([value=""])').count(), coolCount);
    await p.locator('.chip[data-facet=family][data-value=cool]').click();
    await p.waitForFunction(() => window.wunderkammerFloatDebug().scene.scopeCount === 22); await settled(p);
    const widened = (await debug(p)).scene;
    assert.deepEqual(widened.positions, before.positions); assert.ok(Object.values(widened.opacity).every(o => o === 1));
  } finally { await p.close(); }
});

test('float arrangement and camera survive fresh exact links, live links, URL intent and flat round trips', async () => {
  const p = await open('?view=float&arrange=hsl&rail=0'); let fresh; try {
    let s = await debug(p);
    assert.equal(s.mode, 'float'); assert.equal(s.scene.arrangement, 'hsl'); assert.equal(s.view.float.fitted, true);
    await p.locator('.float-canvas').focus();
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'w', 'w']) await p.keyboard.press(k);
    await p.waitForTimeout(450); s = await debug(p);
    assert.equal(s.view.float.fitted, false); assert.equal(s.view.presentation.mode, 'float');
    await p.waitForFunction(() => location.hash.includes('s='));
    fresh = await open(p.url()); const r = await debug(fresh);
    assert.equal(r.scene.arrangement, 'hsl'); assert.equal(r.view.float.fitted, false);
    near(r.view.float.position, s.view.float.position, 1e-6, 'camera position'); near(r.view.float.target, s.view.float.target, 1e-6, 'camera target');
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await p.locator('#copy-live-view').click();
    const live = new URL(await p.evaluate(() => navigator.clipboard.readText()));
    assert.equal(live.searchParams.get('view'), 'float'); assert.equal(live.searchParams.get('arrange'), 'hsl'); assert.equal(live.hash, '');
    await p.locator('#view-float').click(); assert.equal((await debug(p)).mode, 'flat');
    await p.locator('#view-float').click(); s = await debug(p);
    assert.equal(s.mode, 'float'); assert.equal(s.scene.arrangement, 'hsl'); near(s.view.float.position, r.view.float.position, 1e-6, 'camera kept across a flat visit');
  } finally { await fresh?.close(); await p.close(); }
  const bad = await browser.newPage(); try {
    bad.on('pageerror', e => errors.push(e.message));
    await bad.goto(`${origin}/?view=float&arrange=rgb`); await bad.waitForSelector('#link-status:not([hidden])');
    assert.match(await bad.locator('#link-message').textContent(), /arrange must be one of oklab, oklch, hsl, az/);
  } finally { await bad.close(); }
});

test('float phone layout keeps every control inside the viewport and reachable', async () => {
  const p = await open('?view=float', { mobile: true }); try {
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bar = await p.locator('.float-toolbar').boundingBox();
    assert.ok(bar.x >= 0 && bar.x + bar.width <= 390 && bar.y + bar.height <= 844, 'toolbar inside the viewport');
    for (const label of await p.locator('.float-arrange span').all()) { const b = await label.boundingBox(); assert.ok(b.width >= 44 && b.height >= 44, 'arrangement targets are at least 44 px'); }
    await p.locator('.float-arrange label:has(input[value=az])').tap(); await settled(p);
    assert.equal((await debug(p)).scene.arrangement, 'az');
    await p.selectOption('.float-items select', key('00ffff')); await settled(p);
    near((await debug(p)).scene.screen[key('00ffff')].slice(0, 2), [0, 0], 0.03, 'the menu flies on a phone');
  } finally { await p.close(); }
});
