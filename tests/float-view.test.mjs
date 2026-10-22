import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { WORLD, RADIUS, MISSING_GAP } from '../wall/float-space.mjs';
import { validateView } from '../wall/view-schema.mjs';
import { buildFacets } from '../wall/facet-counts.mjs';

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
// Attributes for the Axes arrangement: capture dates unevenly spaced (so a
// rank-spaced time axis would show), a year missing on three items, and a
// ranked attribute. Dates are date-only, so Node and the page parse them alike.
const DAY = 86400000, captured = i => new Date(Date.UTC(2025, 0, 6) + (i * 9 + (i % 4) * 4) * DAY).toISOString().slice(0, 10);
const attributes = i => ({ ...(i % 7 === 3 ? {} : { year: String(2019 + i % 4) }), complexity: ['low', 'medium', 'high'][i % 3] });
const clips = colours.map(([title, hex, family], i) => ({ id: `f${i}`, url: `urn:float:${hex}`, title, source: 'Fixture', tags: [], captured: captured(i),
  cover: `/covers/${hex}.svg`, palette: [`#${hex}`, '#123456'], props: { family: [family], dims: ['160x120'], ...attributes(i) } }));
// A burst: two shots taken the same day as Teal, in Teal's colour. They
// coincide with it in every arrangement, so declumping has work to do.
for (const n of [1, 2]) clips.push({ ...clips[11], id: `burst${n}`, url: `urn:float:burst${n}`, title: `Burst ${n}`, props: { ...clips[11].props } });
clips.push({ id: 'nopal', url: 'urn:float:nopalette', title: 'Unpainted', source: 'Fixture', tags: [], captured: captured(21), cover: '/covers/445566.svg', props: { family: ['neutral'], dims: ['120x120'], ...attributes(21) } });
// Facets as the server derives them, capture months included.
const facets = buildFacets(clips);
const key = hex => `urn:float:${hex}`;
const coolCount = clips.filter(c => c.props.family.includes('cool')).length;
// Ottosson's published OKLab coordinates for sRGB primaries: an oracle
// independent of the code under test.
const OKLAB = { ff0000: [0.627955, 0.224863, 0.125846], '00ff00': [0.866440, -0.233888, 0.179498], '0000ff': [0.452014, -0.032457, -0.311528],
  ffff00: [0.967983, -0.071369, 0.198570], ff00ff: [0.701674, 0.274566, -0.169156], '00ffff': [0.905399, -0.149444, -0.039398], ffffff: [1, 0, 0], '000000': [0, 0, 0] };
// A second transcription of Ottosson's sRGB → OKLab, kept in the test and
// checked against the published values above before it is trusted for the
// fixture colours the table does not list.
function testLab(hex) {
  const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4, [r, g, b] = [0, 2, 4].map(k => lin(parseInt(hex.slice(k, k + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const hueOf = ([, a, b]) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;

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
async function open(query = '?view=float&arrange=oklab&rail=0', { mobile = false, motion = false } = {}) {
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
    assert.equal(scene.arrangement, 'oklab'); assert.equal(scene.itemCount, clips.length); assert.equal(scene.dimMode, 'brightness');
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
  const m = await open('?view=float&arrange=oklab&rail=0', { motion: true }); try {
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

test('float Axes places each item by its chosen dimensions, keeps attribute planes exact and gives missing values a labelled slot', async () => {
  const p = await open('?view=float&arrange=axes&rail=0'); try {
    let { scene } = await debug(p);
    const axisOf = (axis, id) => p.selectOption(`.float-axes select[aria-label="${axis} axis"]`, id).then(() => settled(p)).then(() => debug(p)).then(d => d.scene);
    const coord = (u, k) => k === 2 ? (0.5 - u) * WORLD : (u - 0.5) * WORLD, gap = MISSING_GAP;
    const at = (id, k) => scene.exact[id][k], target = (id, k) => scene.targets[id][k];
    // The fixture has capture dates, so time takes Across; lightness and hue follow.
    assert.equal(scene.arrangement, 'axes'); assert.deepEqual(scene.axes, { across: 'captured', up: 'lightness', depth: 'hue' });
    assert.equal(await p.locator('.float-axes').isVisible(), true);
    // Across: capture time, linear (the fixture's dates are unevenly spaced, so rank spacing would fail).
    const times = clips.map(c => Date.parse(c.captured)), t0 = Math.min(...times), t1 = Math.max(...times);
    for (const clip of clips) near([at(clip.url, 0)], [coord((Date.parse(clip.captured) - t0) / (t1 - t0), 0)], 0.01, `${clip.title} capture time`);
    // Up: absolute OKLab lightness, the same height as in the colour arrangements.
    for (const [hex, [L]] of Object.entries(OKLAB)) near([at(key(hex), 1)], [coord(L, 1)], 2, `lightness #${hex}`);
    // Depth: one turn of hue from the centre of the emptiest 30° window of the chromatic items.
    for (const [hex, lab] of Object.entries(OKLAB)) near(testLab(hex), lab, 1e-4, `test transcription of OKLab for #${hex}`);
    const labs = clips.filter(c => c.palette).map(c => [c.url, testLab(c.palette[0].slice(1))]), chromatic = labs.filter(([, l]) => Math.hypot(l[1], l[2]) >= 0.02);
    let best = Infinity, start = 0;
    for (let s0 = 0; s0 < 360; s0++) { const count = chromatic.filter(([, l]) => (hueOf(l) - s0 + 360) % 360 < 30).length; if (count < best) { best = count; start = s0; } }
    const cut = Math.round((start + 15) / 5) * 5 % 360;
    assert.equal(scene.axisInfo.depth.hueCut, cut, 'the hue axis starts in the emptiest 30° window');
    for (const [hex, lab] of Object.entries(OKLAB)) if (Math.hypot(lab[1], lab[2]) >= 0.02) near([at(key(hex), 2)], [coord(((hueOf(lab) - cut + 360) % 360) / 360, 2)], 2, `hue #${hex}`);
    // Greys have no hue: they wait in their own slot beyond the far end of the
    // hue axis (behind, never between camera and data), and the palette-less item one slot further.
    const greys = labs.filter(([, l]) => Math.hypot(l[1], l[2]) < 0.02).map(([id]) => id);
    assert.equal(greys.length, 5);
    for (const id of greys) near([at(id, 2)], [coord(1 + gap, 2)], 0.01, `${id} in the grey slot`);
    near([at(key('nopalette'), 2), at(key('nopalette'), 1)], [coord(1 + 2 * gap, 2), coord(-gap, 1)], 0.01, 'no palette: beyond the greys, below the darkest');
    assert.ok(scene.labels.includes('Grey, no hue · 5') && scene.labels.includes('No palette · 1'), 'both slots are labelled with their counts');
    // Declumping moves items only along colour axes: capture time stays exact.
    for (const clip of clips) assert.equal(target(clip.url, 0), at(clip.url, 0), `${clip.title} keeps its capture time`);
    for (const [id, exact] of Object.entries(scene.exact)) assert.ok(Math.hypot(...exact.map((v, i) => v - scene.targets[id][i])) <= scene.edge * 0.6 + 1e-3, `${id} stays near its place`);
    const burst = ['urn:float:2a9d8f', 'urn:float:burst1', 'urn:float:burst2'];
    assert.ok(burst.every(id => scene.exact[id].join() === scene.exact[burst[0]].join()), 'the burst shares one exact place');
    assert.ok(new Set(burst.map(id => scene.targets[id].join())).size === 3, 'and is drawn as three separate tiles');
    for (const [id, t] of Object.entries(scene.targets)) near(scene.positions[id], t, 0.01, `${id} is drawn where it is placed`);
    // Fit frames the axis titles and the slot labels where they are drawn,
    // beside their axes, on the stage and clear of the toolbar.
    const stage = await p.locator('.float-canvas').boundingBox(), bar = await p.locator('.float-toolbar').boundingBox();
    for (const text of ['Across · capture date', 'Up · lightness (OKLab L)', 'Grey, no hue · 5', 'No palette · 1']) {
      const label = p.locator('.float-label:not([hidden])', { hasText: text });
      assert.equal(await label.count(), 1, `${text} is shown`);
      const b = await label.boundingBox();
      assert.ok(b.x >= stage.x && b.x + b.width <= stage.x + stage.width && b.y >= stage.y && b.y + b.height <= bar.y, `${text} is on the stage above the toolbar`);
    }

    // A ranked attribute is planes: one per value, evenly spaced, exact.
    scene = await axisOf('Across', 'complexity');
    assert.deepEqual(scene.axes, { across: 'complexity', up: 'lightness', depth: 'hue' });
    const rank = { low: 0, medium: 1, high: 2 };
    for (const clip of clips) near([target(clip.url, 0)], [coord((rank[clip.props.complexity] + 0.5) / 3, 0)], 0.001, `${clip.title} stands in its ${clip.props.complexity} plane`);
    for (const label of ['low · 8', 'medium · 7', 'high · 9']) assert.ok(scene.labels.includes(label), label);

    // Choosing a dimension another axis holds swaps the two.
    scene = await axisOf('Across', 'lightness');
    assert.deepEqual(scene.axes, { across: 'lightness', up: 'complexity', depth: 'hue' });
    for (const [hex, [L]] of Object.entries(OKLAB)) near([at(key(hex), 0)], [coord(L, 0)], 2, `lightness across #${hex}`);
    assert.equal(await p.locator('.float-axes select[aria-label="Up axis"]').inputValue(), 'complexity');

    // A missing year waits before the axis, labelled; the rest are linear in year.
    scene = await axisOf('Across', 'year');
    const years = clips.filter(c => c.props.year).map(c => Number(c.props.year)), y0 = Math.min(...years), y1 = Math.max(...years);
    for (const clip of clips) near([at(clip.url, 0)], [coord(clip.props.year ? (Number(clip.props.year) - y0) / (y1 - y0) : -gap, 0)], 0.01, `${clip.title} year`);
    assert.ok(scene.labels.includes('No year · 3'));
    // With no colour axis left, the planes still hold: only the year axis gives way.
    scene = await axisOf('Up', 'complexity'); scene = await axisOf('Depth', 'family');
    assert.deepEqual(scene.axes, { across: 'year', up: 'complexity', depth: 'family' });
    const family = { cool: 0, neutral: 1, warm: 2 };
    for (const clip of clips) {
      near([target(clip.url, 1)], [coord((rank[clip.props.complexity] + 0.5) / 3, 1)], 0.001, `${clip.title} complexity plane`);
      near([target(clip.url, 2)], [coord((family[clip.props.family[0]] + 0.5) / 3, 2)], 0.001, `${clip.title} family plane`);
    }
    assert.deepEqual(Object.values(scene.axisInfo).map(a => a.free), [true, false, false]);
    // The colour arrangements hide the menus.
    await p.locator('.float-arrange input[value=oklab]').check(); await settled(p);
    assert.equal(await p.locator('.float-axes').isVisible(), false);
  } finally { await p.close(); }
});

test('float fly-to: clicking an item flies to it and opens the detail pane; arrows along the axes, / to jump, Enter and Fit reach items without a dropdown', async () => {
  const p = await open(); try {
    let { scene, view } = await debug(p);
    const id = key('fa8072');
    await clickItem(p, scene, id); await p.waitForSelector('#detail.open'); await settled(p);
    assert.equal(await p.locator('.float-callout').isVisible(), false, 'a pointer visitor sees no keyboard callout');
    ({ scene, view } = await debug(p));
    assert.equal(view.ui.focus, id); assert.equal(scene.selection, id); assert.equal(scene.state.fitted, false);
    const stage = await p.locator('.float-canvas').boundingBox(), pane = await p.locator('#detail').boundingBox();
    const [x, y, , share] = scene.screen[id], visibleCentre = ((pane.x - stage.x) / 2) / stage.width * 2 - 1;
    near([x], [visibleCentre], 0.03, 'the item lands in the middle of the stage left of the detail pane');
    near([y], [0], 0.03, 'and level with the stage centre');
    near([share], [0.38], 0.03, 'large enough to read');
    await p.keyboard.press('Escape'); await p.waitForSelector('#detail.open', { state: 'hidden' });

    // No item dropdown: the space is the keyboard path. → moves the selection to the
    // next item along the arrangement's across axis and flies to it without opening
    // it; a callout beside the item and a hidden live region say where it sits.
    assert.equal(await p.getByText(/Choose an item/).count(), 0, 'no item dropdown');
    assert.equal(await p.getByRole('button', { name: 'Inspect', exact: true }).count(), 0, 'no Inspect button');
    await p.locator('.float-canvas').focus(); await p.keyboard.press('ArrowRight'); await settled(p); ({ scene } = await debug(p));
    const first = scene.selection;
    assert.notEqual(first, id); near(scene.screen[first].slice(0, 2), [0, 0], 0.03, '→ flies to the item');
    assert.ok(scene.positions[first][0] > scene.positions[id][0], '→ moves along the across axis, to the right');
    assert.equal(await p.locator('#detail.open').count(), 0, 'moving does not open the item');
    const title = clips.find(c => c.url === first).title;
    assert.equal(scene.callout?.title, title, 'the callout names the item');
    assert.match(scene.callout.where, /^L \d\.\d\d · (grey|red|yellow|green|cyan|blue|magenta)/, 'and says where it sits: lightness, then hue');
    assert.match(scene.announcement, new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. lightness \\d\\.\\d\\d, `), 'the live region says the same');
    const callout = await p.locator('.float-callout').boundingBox(), canvasBox = await p.locator('.float-canvas').boundingBox(), toolbar = await p.locator('.float-toolbar').boundingBox();
    const [sx, sy] = scene.screen[first], itemX = canvasBox.x + (sx + 1) / 2 * canvasBox.width, itemY = canvasBox.y + (1 - sy) / 2 * canvasBox.height;
    assert.ok(callout.width > 60 && callout.y + callout.height <= toolbar.y && Math.abs(callout.y + callout.height / 2 - itemY) < 120 && Math.abs(callout.x - itemX) < 600,
      `the callout is on screen beside the item, above the toolbar (${JSON.stringify(callout)}, item at ${itemX.toFixed(0)},${itemY.toFixed(0)})`);
    assert.equal(await p.locator('.item-readout').evaluate(n => n.getBoundingClientRect().width <= 1), true, 'the live region is never seen');
    // Shift+arrows orbit: the camera turns and the selection stays.
    await p.keyboard.press('Shift+ArrowLeft'); await settled(p); ({ scene } = await debug(p));
    assert.equal(scene.selection, first, 'Shift+← orbits without moving the selection');
    await p.keyboard.press('Enter'); await p.waitForSelector('#detail.open');
    assert.equal((await debug(p)).view.ui.focus, first, 'Enter opens the item the arrows reached');
    await p.keyboard.press('Escape'); await p.waitForSelector('#detail.open', { state: 'hidden' });

    // / jumps to a title: the first match, punctuation and case ignored, then the arrows carry on from there.
    await p.locator('.float-canvas').focus(); await p.keyboard.press('/');
    assert.equal(await p.locator('.float-jump input').evaluate(n => n === document.activeElement), true, '/ opens the jump box');
    await p.keyboard.type('NAVY'); assert.equal(await p.locator('.float-jump-count').textContent(), '1 match');
    await p.keyboard.press('Enter'); await settled(p); ({ scene } = await debug(p));
    assert.equal(scene.selection, key('1a2a6c'), 'Enter flies to the match'); assert.equal(await p.locator('.float-jump').isVisible(), false);
    assert.equal(await p.locator('.float-canvas').evaluate(n => n === document.activeElement), true, 'focus returns to the space');
    near(scene.screen[key('1a2a6c')].slice(0, 2), [0, 0], 0.03, 'the jump flies to the item');

    // Free flight changes the camera; Home returns to the whole space.
    await p.keyboard.press('w'); await p.keyboard.press('Shift+ArrowLeft'); assert.equal((await debug(p)).scene.state.fitted, false);
    await p.keyboard.press('Home'); await settled(p); ({ scene } = await debug(p));
    assert.equal(scene.state.fitted, true);
    for (const [k2, [sx, sy, depth]] of Object.entries(scene.screen)) assert.ok(depth > 0 && Math.abs(sx) <= 1 && Math.abs(sy) <= 1, `${k2} is on screen after Fit`);
  } finally { await p.close(); }
});

test('float scope dims items outside the search and facets in place, without moving any item or the camera', async () => {
  const p = await open('?view=float&arrange=oklab'); try {
    // A fitted camera refits when the stage resizes (the scope bar appears with
    // a filter), so step off Fit first: a placed camera must not move at all.
    if (await p.locator('#rail.hidden').count()) { await p.locator('#toggle-rail').click(); await settled(p); }
    await p.locator('.float-canvas').focus(); await p.keyboard.press('Shift+ArrowLeft'); await settled(p);
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
    // A click on a dimmed item passes through it, and the arrows only ever land in the scope.
    await clickItem(p, scoped, key('ff0000')); await p.waitForTimeout(300);
    assert.equal(await p.locator('#detail.open').count(), 0, 'dimmed items do not take clicks');
    await p.locator('.float-canvas').focus();
    for (const k of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'PageUp', 'ArrowDown', 'PageDown']) {
      await p.keyboard.press(k); const s = (await debug(p)).scene;
      assert.ok(s.inScope.includes(s.selection), `${k} lands on an item in the scope (${s.selection})`);
    }
    await p.locator('.chip[data-facet=family][data-value=cool]').click();
    await p.waitForFunction(n => window.wunderkammerFloatDebug().scene.scopeCount === n, clips.length); await settled(p);
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
    await p.locator('#view-3d').click(); assert.equal((await debug(p)).mode, 'flat');
    await p.locator('#view-3d').click(); s = await debug(p);
    assert.equal(s.mode, 'float'); assert.equal(s.scene.arrangement, 'hsl'); near(s.view.float.position, r.view.float.position, 1e-6, 'camera kept across a flat visit');
  } finally { await fresh?.close(); await p.close(); }
  const bad = await browser.newPage(); try {
    bad.on('pageerror', e => errors.push(e.message));
    await bad.goto(`${origin}/?view=float&arrange=rgb`); await bad.waitForSelector('#link-status:not([hidden])');
    assert.match(await bad.locator('#link-message').textContent(), /arrange must be one of oklab, oklch, hsl, az, axes, cloud/);
  } finally { await bad.close(); }
});

test('float Axes choices survive exact and live links; a link naming an axis the collection cannot carry is refused', async () => {
  const p = await open('?view=float&arrange=axes&across=year&up=hue&depth=family&rail=0'); let fresh; try {
    let s = await debug(p);
    assert.equal(s.scene.arrangement, 'axes'); assert.deepEqual(s.scene.axes, { across: 'year', up: 'hue', depth: 'family' });
    assert.deepEqual(s.view.float.axes, { across: 'year', up: 'hue', depth: 'family' });
    // The exact link carries the axes the reader chose after arriving.
    await p.selectOption('.float-axes select[aria-label="Depth axis"]', 'complexity'); await settled(p);
    await p.waitForFunction(() => location.hash.includes('s=')); await p.waitForTimeout(450);
    fresh = await open(p.url()); s = await debug(fresh);
    assert.deepEqual(s.scene.axes, { across: 'year', up: 'hue', depth: 'complexity' });
    assert.deepEqual(s.scene.targets, (await debug(p)).scene.targets, 'the same positions after a fresh load');
    // The live link names them as across, up and depth.
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await p.locator('#copy-live-view').click();
    const live = new URL(await p.evaluate(() => navigator.clipboard.readText()));
    assert.deepEqual(['arrange', 'across', 'up', 'depth'].map(k => live.searchParams.get(k)), ['axes', 'year', 'hue', 'complexity']);
    // The view schema refuses two axes on one dimension.
    const twice = structuredClone(s.view); twice.float.axes = { across: 'year', up: 'year' };
    assert.throws(() => validateView(twice), /Invalid or unsupported view link/);
  } finally { await fresh?.close(); await p.close(); }
  // A partial link fills the other axes with the collection's defaults.
  const partial = await open('?view=float&depth=complexity&rail=0'); try {
    const { scene } = await debug(partial);
    assert.equal(scene.arrangement, 'axes'); assert.deepEqual(scene.axes, { across: 'captured', up: 'lightness', depth: 'complexity' });
  } finally { await partial.close(); }
  for (const [query, message] of [
    ['?view=float&arrange=axes&across=nosuch', /across=nosuch is not a dimension this collection can place on an axis/],
    ['?view=float&arrange=axes&depth=dims', /depth=dims is not a dimension this collection can place on an axis/],
    ['?view=float&across=year&up=year', /across, up and depth must name different dimensions/],
    ['?view=float&arrange=hsl&across=year', /across, up and depth apply only to arrange=axes/],
  ]) {
    const bad = await browser.newPage(); try {
      bad.on('pageerror', e => errors.push(e.message));
      await bad.goto(`${origin}/${query}`); await bad.waitForSelector('#link-status:not([hidden])');
      assert.match(await bad.locator('#link-message').textContent(), message, query);
    } finally { await bad.close(); }
  }
});

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => { const l = Math.hypot(...v); return v.map(c => c / l); };
/** The way a card that faces the camera points: from the point the camera orbits toward the camera. */
const towardCamera = scene => unit(scene.state.position.map((v, i) => v - scene.state.target[i]));
/** Settled, and the last frame drawn: billboarding happens in the frame, after Fit has moved the camera. */
const drawn = p => settled(p).then(() => p.waitForFunction(() => window.__cwFloat.stillPending().length === 0, null, { timeout: 15000 }));
test('float Sphere lays every card on the surface, out or in; pointer and arrows reach only faces the camera sees; leaving turns cards back to the camera', async () => {
  const p = await open('?view=float&arrange=sphere&rail=0'); let fresh; try {
    let { scene, view } = await debug(p);
    assert.equal(scene.arrangement, 'sphere'); assert.equal(scene.sphere.facing, 'out'); assert.equal(scene.sphere.cap, 0);
    assert.equal(view.float.sphere, undefined, 'the default sphere adds nothing to the link');
    assert.equal(await p.locator('.float-sphere').isVisible(), true); assert.equal(await p.locator('.float-axes').isVisible(), false);
    const onSphere = Object.keys(scene.targets).filter(id => id !== key('nopalette')), { radius } = scene.sphere;
    for (const id of onSphere) {
      near([Math.hypot(...scene.targets[id])], [radius], 0.05, `${id} is on the sphere`);
      assert.ok(dot(scene.normals[id], unit(scene.targets[id])) > 0.999, `${id} faces out`);
    }
    // Latitude is lightness by band (tests/float-sphere.test.mjs); white and black are in the top and bottom bands.
    assert.ok(scene.targets[key('ffffff')][1] > 0 && scene.targets[key('000000')][1] < 0, 'white in the upper half, black in the lower');
    assert.ok(scene.targets[key('nopalette')][1] < -radius, 'an item without a palette waits below the sphere');
    assert.ok(scene.labels.includes('No palette · 1') && scene.labels.some(l => / · lightest$/.test(l)) && scene.labels.some(l => /^around · OKLCH hue from \d+°/.test(l)));
    // Fit looks from the front: the near half shows its faces, the far half its backs, which are not drawn.
    const shown = onSphere.filter(id => scene.facing[id]), backs = onSphere.filter(id => !scene.facing[id]);
    assert.ok(shown.length >= 5 && backs.length >= 5, `${shown.length} faces shown, ${backs.length} turned away`);
    for (const id of onSphere) if (scene.normals[id][2] < 0) assert.equal(scene.facing[id], false, `${id} on the far side is turned away`);
    assert.ok(scene.pickTargets.length && scene.pickTargets.every(t => scene.facing[t.key]), 'no turned-away card is a click target');
    // A click where a turned-away card's centre projects reaches a card in front of it, or nothing; never it.
    const behind = backs.sort((a, b) => Math.hypot(...scene.screen[a].slice(0, 2)) - Math.hypot(...scene.screen[b].slice(0, 2)))[0];
    await clickItem(p, scene, behind); await p.waitForTimeout(200);
    assert.notEqual((await debug(p)).scene.selection, behind, 'a click passes over a card that shows its back');
    if (await p.locator('#detail.open').count()) { await p.keyboard.press('Escape'); await p.waitForSelector('#detail.open', { state: 'hidden' }); }
    await p.locator('.float-canvas').focus(); await p.keyboard.press('Home'); await settled(p);
    // A click on a card that faces the camera flies to it along its face and opens it.
    ({ scene } = await debug(p));
    const front = scene.pickTargets.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0].key;
    await clickItem(p, scene, front); await p.waitForSelector('#detail.open'); await settled(p);
    ({ scene, view } = await debug(p));
    assert.equal(view.ui.focus, front); assert.equal(scene.selection, front);
    assert.ok(dot(scene.normals[front], unit(scene.state.position.map((v, i) => v - scene.positions[front][i]))) > 0.9, 'the camera lands in front of the card face');
    await p.keyboard.press('Escape'); await p.waitForSelector('#detail.open', { state: 'hidden' });
    // Arrows choose only cards whose faces the camera sees.
    await p.locator('.float-canvas').focus(); await p.keyboard.press('Home'); await settled(p);
    for (const arrow of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await p.keyboard.press(arrow); await settled(p); ({ scene } = await debug(p));
      if (!scene.selection) continue;
      const camera = scene.state.position, at = scene.positions[scene.selection];
      assert.ok(dot(scene.normals[scene.selection], camera.map((v, i) => v - at[i])) > 0, `${arrow} chose a card facing the camera`);
    }
    assert.ok(scene.selection, 'the arrows reached a card');

    // Inward: a bowl. Every card faces the centre; Fit sees the inside of the far half.
    await p.keyboard.press('Home'); await settled(p);
    await p.selectOption('.float-sphere select[aria-label="Which way the cards face"]', 'in'); await settled(p);
    ({ scene, view } = await debug(p));
    assert.deepEqual(view.float.sphere, { facing: 'in', cap: 0 });
    for (const id of onSphere) assert.ok(dot(scene.normals[id], unit(scene.targets[id])) < -0.999, `${id} faces in`);
    // The far half shows its inside to the camera; the near half, but for a band by the rim, its backs.
    for (const id of onSphere) {
      const z = scene.targets[id][2] / radius;
      if (z < 0) assert.equal(scene.facing[id], true, `${id} on the far side shows its face`);
      if (z > 0.5) assert.equal(scene.facing[id], false, `${id} on the near side shows its back`);
    }
    // An opening toward the camera: no card within 60° of the view axis.
    await p.selectOption('.float-sphere select[aria-label="Opening toward the camera"]', '60'); await settled(p);
    ({ scene, view } = await debug(p));
    assert.deepEqual(view.float.sphere, { facing: 'in', cap: 60 });
    for (const id of onSphere) assert.ok(scene.targets[id][2] / Math.hypot(...scene.targets[id]) <= 0.5 + 1e-3, `${id} is outside the opening`);
    // The exact link carries the sphere's options; the live link names them.
    await p.waitForFunction(() => location.hash.includes('s=')); await p.waitForTimeout(450);
    fresh = await open(p.url()); const r = (await debug(fresh)).scene;
    assert.deepEqual([r.sphere.facing, r.sphere.cap], ['in', 60]); assert.deepEqual(r.targets, scene.targets, 'the same seats after a fresh load');
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await p.locator('#copy-live-view').click();
    const live = new URL(await p.evaluate(() => navigator.clipboard.readText()));
    assert.deepEqual(['arrange', 'facing', 'cap'].map(k => live.searchParams.get(k)), ['sphere', 'in', '60']);
    // Leaving the sphere, every card faces the camera again.
    await p.locator('.float-arrange input[value=axes]').check(); await drawn(p); ({ scene } = await debug(p));
    assert.equal(await p.locator('.float-sphere').isVisible(), false);
    for (const id of Object.keys(scene.normals)) assert.ok(dot(scene.normals[id], towardCamera(scene)) > 0.999, `${id} faces the camera in Axes`);
  } finally { await fresh?.close(); await p.close(); }
  // With motion, cards turn onto the surface and back off it as they travel, in one render loop.
  const m = await open('?view=float&arrange=oklab&rail=0', { motion: true }); try {
    const mid = async () => m.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.wunderkammerFloatDebug().scene))))));
    await m.evaluate(() => { window.__frames = 0; const count = () => { window.__frames++; requestAnimationFrame(count); }; requestAnimationFrame(count); window.__renders0 = window.__cwFloat.renderCount; });
    await m.locator('.float-arrange input[value=sphere]').check();
    let s = await mid();
    assert.ok(s.moving > 0, 'the change to the sphere animates');
    const turning = id => Math.abs(dot(s.normals[id], towardCamera(s))) < 0.999 && Math.abs(dot(s.normals[id], unit(s.targets[id]))) < 0.999;
    assert.ok(Object.keys(s.normals).some(turning), 'a card is part way between facing the camera and lying on the sphere');
    await settled(m); s = (await debug(m)).scene;
    for (const id of Object.keys(s.targets).filter(id => id !== key('nopalette'))) assert.ok(dot(s.normals[id], unit(s.targets[id])) > 0.999, `${id} came to lie on the sphere`);
    const { frames, renders } = await m.evaluate(() => ({ frames: window.__frames, renders: window.__cwFloat.renderCount - window.__renders0 }));
    assert.ok(renders <= frames + 2, `${renders} renders in ${frames} animation frames`);
    await m.locator('.float-arrange input[value=hsl]').check();
    s = await mid();
    assert.ok(s.moving > 0 && Object.keys(s.normals).some(turning), 'leaving, cards turn on the way rather than snapping to the camera');
    await drawn(m); s = (await debug(m)).scene;
    for (const id of Object.keys(s.normals)) assert.ok(dot(s.normals[id], towardCamera(s)) > 0.999, `${id} turned to the camera`);
  } finally { await m.close(); }
  const bad = await browser.newPage(); try {
    bad.on('pageerror', e => errors.push(e.message));
    await bad.goto(`${origin}/?view=float&arrange=sphere&cap=200`); await bad.waitForSelector('#link-status:not([hidden])');
    assert.match(await bad.locator('#link-message').textContent(), /cap must be whole degrees from 0 to 120/);
  } finally { await bad.close(); }
});

test('the 3D button opens the floating space in Axes; Stacks hands over to the stacks and back; old links still open the stacks', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); let fresh; try {
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(`${origin}/?rail=0`); await p.waitForSelector('body[data-view-ready=true]');
    const button = p.locator('#view-3d'), mode = async () => (await debug(p)).mode;
    // One 3D entry, named for what it does; the colour-only ✺ is gone.
    assert.equal(await p.locator('#view-float').count(), 0);
    assert.match(await button.getAttribute('aria-label'), /three axes/);
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await button.click(); await settled(p);
    let s = await debug(p);
    assert.equal(s.mode, 'float'); assert.equal(s.scene.arrangement, 'axes');
    assert.deepEqual(s.scene.axes, { across: 'captured', up: 'lightness', depth: 'hue' }, 'the collection\'s time, then lightness and hue');
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    // The menu leads with the default and ends with the stacks.
    assert.deepEqual(await p.locator('.float-arrange input').evaluateAll(inputs => inputs.map(i => i.value)), ['axes', 'oklab', 'oklch', 'hsl', 'sphere', 'az', 'stacks']);
    assert.equal(await p.locator('.float-arrange input:checked').inputValue(), 'axes');

    // Stacks hands over to the stacks renderer, which keeps the menu in a strip below it.
    await p.locator('.float-arrange label:has(input[value=stacks])').click();
    await p.waitForFunction(() => window.__cwSpatial?.built && document.body.dataset.viewMode === '3d');
    const strip = p.locator('.sp-arrange');
    assert.equal(await strip.isVisible(), true); assert.equal(await p.locator('#float-host').isVisible(), false);
    assert.equal(await strip.locator('input:checked').inputValue(), 'stacks');
    assert.equal(await button.getAttribute('aria-pressed'), 'true', 'the stacks are 3D too');
    // The stacks end above the strip and fit there: every pile, top to bottom, is in the shortened host.
    const host = await p.locator('#sp-host').boundingBox(), bar = await strip.boundingBox(), stage = await p.locator('#stage').boundingBox();
    assert.ok(Math.abs(host.y + host.height - bar.y) <= 1 && bar.y + bar.height <= stage.y + stage.height + 1, `host ${JSON.stringify(host)} ends at the strip ${JSON.stringify(bar)}`);
    await p.waitForTimeout(400);
    const ys = await p.evaluate(() => {
      const s3 = window.__cwSpatial, box = s3._box, out = [];
      for (const y of [box.min.y, box.max.y]) { const v = box.getCenter(new s3.camera.position.constructor()); v.y = y; v.z = box.max.z; out.push(v.project(s3.camera).y); }
      return out;
    });
    assert.ok(ys.every(y => Math.abs(y) <= 1), `the stacks' top and bottom are inside the host (NDC ${ys})`);

    // The button, and its 3 key, return to the last 3D presentation.
    await button.click(); assert.equal(await mode(), 'flat'); assert.equal(await strip.isVisible(), false);
    await button.click(); await p.waitForFunction(() => document.body.dataset.viewMode === '3d');
    await p.locator('#search').evaluate(n => n.blur()); await p.keyboard.press('3'); assert.equal(await mode(), 'flat');
    await p.keyboard.press('3'); await p.waitForFunction(() => document.body.dataset.viewMode === '3d');

    // An exact link made in the stacks reopens them, piled as they were (view state version 1).
    await p.waitForFunction(() => location.hash.includes('s=')); await p.waitForTimeout(450);
    const stacked = (await debug(p)).view;
    assert.equal(stacked.presentation.mode, '3d'); assert.equal(stacked.spatial.mode, 'piles');
    fresh = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    fresh.on('pageerror', e => errors.push(e.message));
    await fresh.goto(p.url()); await fresh.waitForFunction(() => window.__cwSpatial?.built && document.body.dataset.viewMode === '3d');
    const reopened = await fresh.evaluate(() => window.wunderkammerFloatDebug().view.spatial);
    assert.equal(reopened.mode, 'piles'); assert.deepEqual(reopened.arrangement.piles.map(pile => pile.label), stacked.spatial.arrangement.piles.map(pile => pile.label));

    // Any other arrangement in the strip hands back to the floating space, in that arrangement.
    await strip.locator('label:has(input[value=oklch])').click(); await settled(p);
    s = await debug(p); assert.equal(s.mode, 'float'); assert.equal(s.scene.arrangement, 'oklch');
    assert.equal(await p.locator('.float-arrange input:checked').inputValue(), 'oklch');
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await p.locator('#copy-live-view').click();
    const live = new URL(await p.evaluate(() => navigator.clipboard.readText()));
    assert.deepEqual([live.searchParams.get('view'), live.searchParams.get('arrange')], ['float', 'oklch']);
  } finally { await fresh?.close(); await p.close(); }
  // A link that names the stacks still opens them; one that names no arrangement opens Axes.
  const stacks = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); try {
    stacks.on('pageerror', e => errors.push(e.message));
    await stacks.goto(`${origin}/?view=3d&group=year&rail=0`);
    await stacks.waitForFunction(() => window.__cwSpatial?.built && document.body.dataset.viewMode === '3d');
    const { view } = await stacks.evaluate(() => window.wunderkammerFloatDebug());
    assert.equal(view.presentation.group, 'year'); assert.equal(view.spatial.mode, 'piles');
    assert.equal(await stacks.locator('.sp-arrange input:checked').inputValue(), 'stacks');
  } finally { await stacks.close(); }
  const bare = await open('?view=float&rail=0'); try {
    assert.equal((await debug(bare)).scene.arrangement, 'axes');
  } finally { await bare.close(); }
});

test('float phone layout keeps every control inside the viewport and reachable', async () => {
  const p = await open('?view=float&arrange=oklab', { mobile: true }); try {
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bar = await p.locator('.float-toolbar').boundingBox();
    assert.ok(bar.x >= 0 && bar.x + bar.width <= 390 && bar.y + bar.height <= 844, 'toolbar inside the viewport');
    for (const label of await p.locator('.float-arrange span').all()) { const b = await label.boundingBox(); assert.ok(b.width >= 44 && b.height >= 44, 'arrangement targets are at least 44 px'); }
    await p.locator('.float-arrange label:has(input[value=axes])').tap(); await settled(p);
    for (const select of await p.locator('.float-axes select').all()) {
      const b = await select.boundingBox(); assert.ok(b.x >= 0 && b.x + b.width <= 390 && b.height >= 44, 'axis menus are inside the viewport and at least 44 px tall');
    }
    const axesBar = await p.locator('.float-toolbar').boundingBox(); assert.ok(axesBar.y + axesBar.height <= 844 && axesBar.y > 844 / 2, 'the toolbar with axis menus leaves the upper half of the stage');
    await p.locator('.float-arrange label:has(input[value=sphere])').tap(); await settled(p);
    for (const select of await p.locator('.float-sphere select').all()) {
      const b = await select.boundingBox(); assert.ok(b.x >= 0 && b.x + b.width <= 390 && b.height >= 44, 'sphere menus are inside the viewport and at least 44 px tall');
    }
    await p.locator('.float-arrange label:has(input[value=axes])').tap(); await settled(p);
    // Fit frames the labels without shrinking the space to make wide ones fit the narrow stage.
    const xs = Object.values((await debug(p)).scene.screen).map(([x]) => x);
    assert.ok(Math.max(...xs) - Math.min(...xs) >= 1, `the space spans at least half the phone's width (${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} of 2)`);
    await p.locator('.float-arrange label:has(input[value=az])').tap(); await settled(p);
    assert.equal((await debug(p)).scene.arrangement, 'az');
    assert.equal(await p.locator('.float-toolbar select').count(), 5, 'on a phone the toolbar holds the three axis menus, the sphere\'s two and no item dropdown');
    await clickItem(p, (await debug(p)).scene, key('00ffff')); await p.waitForSelector('#detail.open');
    assert.equal((await debug(p)).view.ui.focus, key('00ffff'), 'a tap reaches an item on a phone');
  } finally { await p.close(); }
});

test('without 3D graphics the floating space offers the flat wall, which holds every item', async () => {
  const p = await open(); try {
    await p.evaluate(() => document.querySelector('.float-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    const status = p.locator('.float-status');
    await status.locator('.view-fallback').waitFor();
    assert.match(await status.textContent(), /^3D graphics are unavailable here\. Show the flat wall$/);
    await status.locator('.view-fallback').click();
    await p.waitForFunction(() => document.body.dataset.viewMode === 'flat');
    assert.equal(await p.locator('#canvas > .tile').count(), clips.length, 'the flat wall shows every item');
  } finally { await p.close(); }
});
