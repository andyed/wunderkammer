import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodeView } from '../wall/permalink.mjs';
import { measureText, contrastVerdict } from '../scripts/still.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
// Sixteen flat-colour covers with capture dates, so the floating space can
// place them on Axes and the wall can group them.
const hexes = ['e63946', 'f1a208', '2a9d8f', '264653', 'e9c46a', '8ab17d', '6d597a', 'b56576',
  '355070', 'eaac8b', '0b6e4f', 'c9184a', '7209b7', '4cc9f0', 'ffd166', '06d6a0'];
const warm = hex => ['e63946', 'f1a208', 'e9c46a', 'b56576', 'eaac8b', 'c9184a', 'ffd166'].includes(hex);
const doc = () => ({
  format: 'wunderkammer.collection', version: 1, corpus: { id: 'fixture:still', revision: 'r1' },
  ui: { title: 'Still fixture', defaultGroup: 'family' },
  clips: hexes.map((hex, i) => ({
    id: `s${i}`, url: `urn:still:${hex}`, title: `Item ${String(i).padStart(2, '0')}`,
    captured: new Date(Date.UTC(2025, 0, 5) + i * 9 * 86400000).toISOString().slice(0, 10),
    cover: `covers/${hex}.svg`, palette: [`#${hex}`], props: { family: warm(hex) ? 'warm' : 'cool', dims: ['160x120'] },
  })),
});
const svg = hex => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#${hex}"/></svg>`;

// The page-level tests serve the app with covers that arrive late (/c/), so a
// whenStill that does not wait for them resolves with tiles missing, and with
// covers that arrive at once (/fast/), where the wall settles before its
// reveal pass has asked for every tile in view.
let server, origin, browser;
const COVER_DELAY = 500;
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (/^\/(c|fast)\/collection\.json$/.test(url.pathname)) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(doc())); return; }
    const cover = /^\/(c|fast)\/covers\/([0-9a-f]{6})\.svg$/.exec(url.pathname);
    if (cover) { if (cover[1] === 'c') await new Promise(r => setTimeout(r, COVER_DELAY)); res.setHeader('content-type', 'image/svg+xml'); res.end(svg(cover[2])); return; }
    if (url.pathname === '/' || /^\/wall\/[\w./-]+$/.test(url.pathname) && !url.pathname.includes('..')) {
      try { const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(path.join(ROOT, file))); return; } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); });

async function open(query, { folder = 'c', width = 1000, height = 700, scale = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/?collection=/${folder}/collection.json&${query}`);
  await page.waitForSelector('body[data-view-ready=true]');
  return { page, errors };
}

test('whenStill waits for every cover in the floating space, and chrome=none shows the stage alone', async () => {
  const { page, errors } = await open('view=float&arrange=axes&chrome=none'); try {
    const still = await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    const { scene } = await page.evaluate(() => window.wunderkammerFloatDebug());
    assert.equal(still.mode, 'float');
    assert.ok(scene.loading === 0 && scene.farResident === scene.itemCount, `every cover is in the atlas (${scene.farResident} of ${scene.itemCount}, ${scene.loading} loading)`);
    assert.ok(!scene.moving && !scene.flying, 'nothing travels and the camera rests');
    for (const selector of ['.bar', '#rail', '.float-toolbar', '.float-help']) assert.equal(await page.locator(selector).isVisible(), false, `${selector} is hidden`);
    // The stage fills the page down to the figure band (its own test is below).
    const stage = await page.locator('#stage').boundingBox(), band = await page.locator('.figure-band').boundingBox();
    assert.deepEqual([stage.x, stage.y, stage.width, stage.y + stage.height], [0, 0, 1000, band.y], 'the stage fills the page above the band');
    assert.ok(await page.locator('.float-label:not([hidden])').count() > 0, 'axis labels stay: they belong to the figure');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('whenStill waits until every flat-wall tile in view is drawn, whether its cover is late or not yet asked for', async () => {
  for (const options of [{ folder: 'c' }, { folder: 'fast', width: 800, height: 500, scale: 2 }]) {
    const { page, errors } = await open('chrome=none', options); try {
      const still = await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
      assert.equal(still.mode, 'flat'); assert.equal(still.undrawn, 0);
      // Checked here too, not only by the count it returns: a tile in view shows its image or the overview's pixels.
      const undrawn = await page.evaluate(() => [...document.querySelectorAll('#canvas > .tile')].filter(node => {
        const r = node.getBoundingClientRect(); if (!r.width || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
        const img = node.querySelector(':scope > img');
        return !node.classList.contains('overview-painted') && !(img?.complete && img.naturalWidth > 0);
      }).map(node => node.getAttribute('aria-label')));
      assert.deepEqual(undrawn, [], `every tile in view is drawn (/${options.folder}/)`);
      assert.equal(await page.locator('.bar').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test('whenStill refuses a view it cannot judge yet', async () => {
  const { page } = await open('view=3d&chrome=none'); try {
    const message = await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 5000 }).then(() => 'resolved', e => e.message));
    assert.match(message, /Stills support the flat wall and the floating space so far, not view=3d/);
  } finally { await page.close(); }
});

/* ------------------------------------------------------------- lit sets --- */

// Three cool items, lit by identity; the other thirteen recede.
const LIT = ['2a9d8f', '264653', '355070'].map(hex => `urn:still:${hex}`);
const litQuery = LIT.map(key => `lit=${encodeURIComponent(key)}`).join('&');
const cameraDistance = f => Math.hypot(...f.position.map((n, i) => n - f.target[i]));

test('lit lights exactly the named items in the floating space, frame=evidence frames them, and the exact link keeps both', async () => {
  const fitted = await open('view=float&arrange=axes&chrome=none');
  let fitDistance; try {
    await fitted.page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    fitDistance = cameraDistance((await fitted.page.evaluate(() => window.wunderkammerFloatDebug())).view.float);
  } finally { await fitted.page.close(); }
  const { page, errors } = await open(`view=float&arrange=axes&${litQuery}&frame=evidence&chrome=none`); try {
    await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    const { scene, view } = await page.evaluate(() => window.wunderkammerFloatDebug());
    for (const [key, opacity] of Object.entries(scene.opacity)) assert.equal(opacity, LIT.includes(key) ? 1 : 0.25, `${key} brightness`);
    assert.deepEqual(view.ui.lit, LIT, 'the exact link names the lit items');
    assert.equal(view.float.fitted, false, 'a framed camera is not Fit');
    assert.ok(cameraDistance(view.float) < fitDistance * 0.9, `the camera comes in on the evidence (${cameraDistance(view.float).toFixed(0)} vs Fit ${fitDistance.toFixed(0)})`);
    for (const key of LIT) { const [x, y] = scene.screen[key]; assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1, `${key} is on screen`); }
    const exported = await page.evaluate(() => window.wunderkammer.export());
    assert.deepEqual({ count: exported.lit.count, keys: [...exported.lit.keys].sort(), unresolved: exported.lit.unresolved }, { count: 3, keys: [...LIT].sort(), unresolved: 0 });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a framed wall shot opens no detail pane of its own', async () => {
  const { page, errors } = await open(`${litQuery}&frame=evidence&chrome=none`); try {
    await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    await page.waitForTimeout(600); // the zoom preview waits for the camera to rest
    assert.equal(await page.locator('#detail.open').count(), 0, 'no pane covers the shot');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('on the wall, unlit tiles recede, frame=evidence zooms to the lit tiles, and Esc puts the lit set out', async () => {
  const { page, errors } = await open(`${litQuery}&frame=evidence&rail=0`); try {
    await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    const tiles = await page.evaluate(() => [...document.querySelectorAll('#canvas > .tile')].map(n => {
      const r = n.getBoundingClientRect(), img = n.querySelector(':scope > img');
      return { label: n.getAttribute('aria-label'), unlit: n.classList.contains('unlit'), opacity: img ? Number(getComputedStyle(img).opacity) : null, box: [r.left, r.top, r.right, r.bottom] };
    }));
    const litLabels = LIT.map(key => `Item ${String(hexes.indexOf(key.slice(10))).padStart(2, '0')}`);
    for (const t of tiles) {
      const lit = litLabels.some(label => t.label?.startsWith(label));
      assert.equal(t.unlit, !lit, `${t.label} ${lit ? 'is lit' : 'recedes'}`);
      if (!lit && t.opacity !== null) assert.ok(t.opacity <= 0.3, `${t.label} image dims to ${t.opacity}`);
    }
    // Framed: the lit tiles span the stage, inside it.
    const stage = await page.locator('#stage').boundingBox(), lit = tiles.filter(t => !t.unlit);
    const box = [Math.min(...lit.map(t => t.box[0])), Math.min(...lit.map(t => t.box[1])), Math.max(...lit.map(t => t.box[2])), Math.max(...lit.map(t => t.box[3]))];
    assert.ok(box[0] >= stage.x - 1 && box[1] >= stage.y - 1 && box[2] <= stage.x + stage.width + 1 && box[3] <= stage.y + stage.height + 1, `the lit tiles are on the stage: ${box}`);
    assert.ok(box[2] - box[0] >= stage.width * 0.8 || box[3] - box[1] >= stage.height * 0.8, `and fill it: ${box} in ${JSON.stringify(stage)}`);
    let { view } = await page.evaluate(() => window.wunderkammerFloatDebug());
    assert.equal(view.flat.view.fitted, false); assert.deepEqual(view.ui.lit, LIT);
    assert.match(await page.locator('#count').textContent(), /· 3 lit/);
    // Framed this close, the live wall previews the centred item in the detail
    // pane. Esc closes that first, then puts out the lit set.
    await page.locator('#count').click();
    if (await page.locator('#detail.open').count()) {
      await page.keyboard.press('Escape'); await page.waitForSelector('#detail.open', { state: 'detached' });
      assert.equal(await page.locator('#canvas > .tile.unlit').count(), 13, 'closing the pane leaves the lit set lit');
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#canvas > .tile.unlit'));
    ({ view } = await page.evaluate(() => window.wunderkammerFloatDebug()));
    assert.equal(view.ui.lit, undefined, 'Esc puts the lit set out, and the link forgets it');
    assert.doesNotMatch(await page.locator('#count').textContent(), /lit/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

/* -------------------------------------------------------------- figure --- */

test('the figure band says what the page counts, under a stage that ends above it', async () => {
  const { page, errors } = await open(`view=float&arrange=axes&${litQuery}&chrome=none`); try {
    const { figure } = await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    assert.equal(figure.headline, '3 of 16 items lit'); assert.equal(figure.headlineSource, 'page');
    assert.deepEqual(figure.legend, [{ role: 'lit', label: 'Lit', count: 3, source: 'page' }, { role: 'rest', label: 'Receded', count: 13, source: 'page' }]);
    assert.match(figure.note, /^Still fixture · Axes: across capture date · up lightness/);
    assert.equal(figure.note, figure.noteFull, 'at 1000 px the whole note fits');
    assert.deepEqual(figure.clipped, []);
    const stage = await page.locator('#stage').boundingBox(), band = await page.locator('.figure-band').boundingBox();
    assert.ok(Math.abs(stage.y + stage.height - band.y) <= 1 && band.y + band.height <= 700 + 1, `the stage ends where the band starts (${JSON.stringify({ stage, band })})`);
    assert.equal(await page.locator('.figure-headline').textContent(), '3 of 16 items lit');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('overrides change the figure\'s words, never its numbers, and say which words are whose', async () => {
  const words = 'title=Three+cool+ones&label.lit=Cool+picks&label.rest=Everything+else&label.across=When';
  const { page, errors } = await open(`view=float&arrange=axes&${litQuery}&${words}&chrome=none`); try {
    const { figure } = await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    assert.equal(figure.headline, 'Three cool ones'); assert.equal(figure.headlineSource, 'override');
    assert.equal(figure.counts, '3 of 16 items lit', 'the count line is the page\'s');
    assert.deepEqual(await page.locator('.figure-counts').allTextContents(), ['3 of 16 items lit'], 'and it stays on the shot under an overridden headline');
    assert.deepEqual(figure.legend, [{ role: 'lit', label: 'Cool picks', count: 3, source: 'override' }, { role: 'rest', label: 'Everything else', count: 13, source: 'override' }]);
    assert.deepEqual(figure.axes, { across: 'override', up: 'page', depth: 'page' });
    assert.equal(await page.locator('.float-label', { hasText: 'Across · When' }).count(), 1, 'the axis is renamed on the shot');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  for (const [query, message] of [['label.bogus=x', /label.bogus is not a label a shot can override/], ['title=a&title=b', /title may appear only once/], ['label.lit=', /label.lit must not be empty/]]) {
    const bad = await open(`view=float&arrange=axes&${query}&chrome=none`); try {
      assert.match(await bad.page.evaluate(() => window.wunderkammer.whenStill({ timeout: 5000 }).then(() => 'resolved', e => e.message)), message, query);
    } finally { await bad.page.close(); }
  }
});

test('wall shots name their groups over the blocks, renamed when asked, and figure=none leaves the stage alone', async () => {
  const { page, errors } = await open('label.group.warm=Warm+colours&chrome=none'); try {
    const { figure } = await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    const byLabel = Object.fromEntries(figure.groups.map(g => [g.label, g]));
    assert.deepEqual(byLabel.warm, { label: 'warm', text: 'Warm colours', count: 7, source: 'override' });
    assert.deepEqual(byLabel.cool, { label: 'cool', text: 'cool', count: 9, source: 'page' });
    assert.equal(await page.locator('.figure-group', { hasText: 'Warm colours · 7' }).isVisible(), true);
    assert.equal(await page.locator('.block h2').first().isVisible(), false, 'the native headings give way, so a name is not drawn twice');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  const bare = await open('figure=none&chrome=none'); try {
    const { figure } = await bare.page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    assert.equal(figure, null); assert.equal(await bare.page.locator('.figure-band').count(), 0);
    const stage = await bare.page.locator('#stage').boundingBox();
    assert.equal(stage.y + stage.height, 700, 'without a figure the stage takes the whole page');
  } finally { await bare.page.close(); }
});

test('contrast is read from the shot\'s pixels: the ground behind a text box is what was drawn there', async () => {
  const page = await browser.newPage({ viewport: { width: 400, height: 200 } }); try {
    await page.setContent(`<style>body{margin:0;background:#050510;font:600 20px system-ui} p{margin:0;padding:10px 12px;width:max-content}</style>
      <div class="figure-band">
        <p data-figure="good" style="color:#f0f0f0">Readable on the band</p>
        <p data-figure="bad" style="color:#777777;background:#666666">Grey on grey</p>
        <div style="background:#f0f0f0"><p data-figure="hidden-ground" style="color:#eeeeee">Its own ground is transparent</p></div>
      </div>`);
    const png = (await page.screenshot({ type: 'png' })).toString('base64');
    const items = await page.evaluate(measureText, { png, scale: 1 });
    const by = Object.fromEntries(items.map(i => [i.text, i]));
    assert.ok(by['Readable on the band'].ratio >= 17, JSON.stringify(by['Readable on the band']));
    assert.deepEqual(by['Readable on the band'].ground, [5, 5, 16]);
    assert.ok(by['Grey on grey'].ratio < 1.5, JSON.stringify(by['Grey on grey']));
    // A transparent element over a light parent: CSS says nothing about its ground, the pixels do.
    assert.ok(by['Its own ground is transparent'].ratio < 1.1, JSON.stringify(by['Its own ground is transparent']));
    const verdict = contrastVerdict(items);
    assert.deepEqual(verdict.below.map(i => i.text).sort(), ['Grey on grey', 'Its own ground is transparent']);
    assert.equal(verdict.min, Math.min(...items.map(i => i.ratio)));
  } finally { await page.close(); }
});

/* --------------------------------------------------------------- cloud --- */

/** Front to back, by depth toward the camera: the cloud's order as drawn. */
const frontToBack = scene => Object.entries(scene.targets).sort((a, b) => b[1][2] - a[1][2]).map(([key]) => key);

test('the cloud puts the lit items in front, nearest the middle and largest, and says what decided the order', async () => {
  const { page, errors } = await open(`view=float&arrange=cloud&${litQuery}&chrome=none`); try {
    const { figure } = await page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    const { scene } = await page.evaluate(() => window.wunderkammerFloatDebug());
    assert.equal(scene.arrangement, 'cloud');
    const order = frontToBack(scene);
    assert.deepEqual([...order.slice(0, 3)].sort(), [...LIT].sort(), `the lit items stand in front: ${order.slice(0, 5)}`);
    const radius = key => Math.hypot(scene.targets[key][0], scene.targets[key][1]), share = key => scene.screen[key][3];
    const rest = order.slice(3);
    assert.ok(Math.max(...LIT.map(radius)) < Math.min(...rest.slice(3).map(radius)), 'and nearest the middle');
    assert.ok(Math.min(...LIT.map(share)) > Math.max(...rest.map(share)), 'and largest on screen');
    assert.equal(figure.note.endsWith('Cloud: the lit items in front, the rest behind'), true, figure.note);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  // Without a lit set, the scope stands in front; the cloud re-forms when the scope changes.
  const warmKeys = hexes.filter(warm).map(hex => `urn:still:${hex}`);
  const scoped = await open('view=float&arrange=cloud&facet.family=warm&chrome=none'); try {
    await scoped.page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    const { scene } = await scoped.page.evaluate(() => window.wunderkammerFloatDebug());
    assert.deepEqual(frontToBack(scene).slice(0, warmKeys.length).sort(), [...warmKeys].sort(), 'the warm scope stands in front');
    // The view on its own: a new scope re-forms the cloud, with or without a lit set to set.
    await scoped.page.evaluate(() => { const f = window.__cwFloat; f.setScope(f.clips.filter(c => c.props.family === 'cool')); });
    const after = (await scoped.page.evaluate(() => window.wunderkammerFloatDebug())).scene;
    const coolKeys = hexes.filter(hex => !warm(hex)).map(hex => `urn:still:${hex}`);
    assert.deepEqual(frontToBack(after).slice(0, coolKeys.length).sort(), [...coolKeys].sort(), 'the cool scope now stands in front');
  } finally { await scoped.page.close(); }
});

test('front= orders the cloud by a dimension, within the lit tier and the rest, and the exact link keeps it', async () => {
  const byIndex = hexes.map(hex => `urn:still:${hex}`);       // the fixture's capture dates rise with the index
  const latest = await open('view=float&arrange=cloud&front=captured&chrome=none'); try {
    const { figure } = await latest.page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    const { scene, view } = await latest.page.evaluate(() => window.wunderkammerFloatDebug());
    assert.deepEqual(frontToBack(scene), [...byIndex].reverse(), 'the latest capture first');
    assert.equal(view.float.front, 'captured', 'the exact link keeps the order');
    assert.ok(figure.note.endsWith('Cloud: by capture date, latest first'), figure.note);
  } finally { await latest.page.close(); }
  const earliest = await open('view=float&arrange=cloud&front=-captured&chrome=none'); try {
    await earliest.page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    assert.deepEqual(frontToBack((await earliest.page.evaluate(() => window.wunderkammerFloatDebug())).scene), byIndex, 'the earliest capture first');
  } finally { await earliest.page.close(); }
  const lit = await open(`view=float&arrange=cloud&front=captured&${litQuery}&chrome=none`); try {
    const { figure } = await lit.page.evaluate(() => window.wunderkammer.whenStill({ timeout: 20000 }));
    const order = frontToBack((await lit.page.evaluate(() => window.wunderkammerFloatDebug())).scene);
    const litByDate = byIndex.filter(key => LIT.includes(key)).reverse(), restByDate = byIndex.filter(key => !LIT.includes(key)).reverse();
    assert.deepEqual(order, [...litByDate, ...restByDate], 'the lit tier first, each tier latest first');
    assert.ok(figure.note.endsWith('Cloud: the lit items in front, the rest behind; each by capture date, latest first'), figure.note);
  } finally { await lit.page.close(); }
  const bad = await open('view=float&arrange=cloud&front=nosuch'); try {
    assert.match(await bad.page.locator('#link-message').textContent(), /front=nosuch is not a dimension this collection can order by/);
  } finally { await bad.page.close(); }
});

/* ------------------------------------------------------------ the tool --- */

const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/still.mjs'), ...args], { encoding: 'utf8', timeout: 120000 });
const pngSize = bytes => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
async function fixtureDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-still-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'covers'));
  for (const hex of hexes) await writeFile(path.join(dir, 'covers', `${hex}.svg`), svg(hex));
  await writeFile(path.join(dir, 'collection.json'), JSON.stringify(doc()));
  return dir;
}

test('scripts/still.mjs writes a still and a sidecar that says what it shows, the same pixels every time', async t => {
  const dir = await fixtureDir(t), collection = path.join(dir, 'collection.json');
  const first = run('--collection', collection, '--view', 'view=float&arrange=axes&facet.family=warm', '--size', '640x400', '--scale', '1', '--out', path.join(dir, 'a.png'));
  assert.equal(first.status, 0, first.stderr);
  const png = await readFile(path.join(dir, 'a.png'));
  assert.deepEqual(pngSize(png), [640, 400]);
  const sidecar = JSON.parse(await readFile(path.join(dir, 'a.json'), 'utf8'));
  assert.equal(sidecar.format, 'wunderkammer.still'); assert.equal(sidecar.version, 1);
  assert.deepEqual(sidecar.image, { file: 'a.png', type: 'png', width: 640, height: 400, scale: 1 });
  assert.equal(sidecar.view.mode, 'float'); assert.equal(sidecar.view.spec.float.arrangement, 'axes');
  assert.deepEqual(sidecar.view.spec.scope.facets, [['family', ['warm']]]);
  assert.equal(sidecar.render.undrawn, 0);
  assert.deepEqual(sidecar.collection.corpus, { id: 'fixture:still', revision: 'r1' });
  // At 640 px the note on the view shortens to fit; the sidecar keeps it whole.
  assert.ok(sidecar.figure.noteFull.startsWith('Still fixture · Axes:') && sidecar.figure.note.length < sidecar.figure.noteFull.length, JSON.stringify(sidecar.figure));
  assert.deepEqual(sidecar.figure.clipped, []);
  // The evidence is the exact set in scope, by identity.
  assert.deepEqual(sidecar.export.evidence.map(e => e.key).sort(), hexes.filter(warm).map(h => `urn:still:${h}`).sort());
  // The link reopens the same view.
  assert.deepEqual(decodeView(new URLSearchParams(sidecar.view.link.slice(1)).get('s')).float, sidecar.view.spec.float);

  const again = run('--collection', collection, '--view', sidecar.view.link, '--size', '640x400', '--scale', '1', '--out', path.join(dir, 'b.png'));
  assert.equal(again.status, 0, again.stderr);
  assert.ok((await readFile(path.join(dir, 'b.png'))).equals(png), 'the exact link renders the same pixels');

  const wall = run('--collection', collection, '--size', '800x500', '--scale', '2', '--out', path.join(dir, 'wall.jpg'));
  assert.equal(wall.status, 0, wall.stderr);
  const flat = JSON.parse(await readFile(path.join(dir, 'wall.json'), 'utf8'));
  assert.equal(flat.view.mode, 'flat'); assert.equal(flat.image.type, 'jpeg'); assert.equal(flat.export.count, hexes.length);
  assert.equal(flat.render.undrawn, 0, 'every tile in view was drawn');
});

test('scripts/still.mjs frames lit items, and the sidecar\'s exact link reproduces the framed shot', async t => {
  const dir = await fixtureDir(t), collection = path.join(dir, 'collection.json');
  const first = run('--collection', collection, '--view', `view=float&arrange=axes&${litQuery}&frame=evidence`, '--size', '640x400', '--scale', '1', '--out', path.join(dir, 'lit.png'));
  assert.equal(first.status, 0, first.stderr);
  const sidecar = JSON.parse(await readFile(path.join(dir, 'lit.json'), 'utf8'));
  assert.equal(sidecar.export.lit.count, 3); assert.deepEqual(sidecar.view.spec.ui.lit, LIT);
  assert.equal(sidecar.view.spec.float.fitted, false, 'the framing is a camera in the link, not a Fit');
  const again = run('--collection', collection, '--view', sidecar.view.link, '--size', '640x400', '--scale', '1', '--out', path.join(dir, 'lit2.png'));
  assert.equal(again.status, 0, again.stderr);
  // The camera and framing must match exactly. The pixels are compared with a
  // small allowance until three.js is upgraded past r169: its
  // copyTextureToTexture can lose a far tile's upload under load, leaving that
  // tile's placeholder (docs/SHOTS.md, open defects). 0.2% is twice what the
  // observed case differed by. After the upgrade this should demand identical bytes.
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'lit2.json'), 'utf8')).view.spec.float, sidecar.view.spec.float, 'the same camera from the exact link');
  const differ = await pixelShare(await readFile(path.join(dir, 'lit.png')), await readFile(path.join(dir, 'lit2.png')));
  assert.ok(differ <= 0.002, `the same pixels from the exact link, all but ${(differ * 100).toFixed(3)}%`);
});

/** The share of pixels that differ between two PNGs, decoded in a page. */
async function pixelShare(a, b) {
  const page = await browser.newPage(); try {
    return await page.evaluate(async ([x, y]) => {
      const pixels = async b64 => {
        const image = new Image(); image.src = `data:image/png;base64,${b64}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [p, q] = await Promise.all([pixels(x), pixels(y)]);
      if (p.length !== q.length) return 1;
      let n = 0; for (let k = 0; k < p.length; k += 4) if (Math.abs(p[k] - q[k]) + Math.abs(p[k + 1] - q[k + 1]) + Math.abs(p[k + 2] - q[k + 2]) > 6) n++;
      return n / (p.length / 4);
    }, [a.toString('base64'), b.toString('base64')]);
  } finally { await page.close(); }
}

test('scripts/still.mjs records the figure and the contrast it measured, and refuses text that does not fit', async t => {
  const dir = await fixtureDir(t), collection = path.join(dir, 'collection.json');
  const ok = run('--collection', collection, '--view', `view=float&arrange=axes&${litQuery}&frame=evidence`, '--title', 'Three cool ones', '--label', 'lit=Cool picks',
    '--size', '800x500', '--scale', '1', '--out', path.join(dir, 'fig.png'));
  assert.equal(ok.status, 0, ok.stderr);
  const sidecar = JSON.parse(await readFile(path.join(dir, 'fig.json'), 'utf8'));
  assert.equal(sidecar.figure.headline, 'Three cool ones'); assert.equal(sidecar.figure.counts, '3 of 16 items lit');
  assert.equal(sidecar.figure.legend[0].label, 'Cool picks'); assert.equal(sidecar.figure.legend[0].source, 'override');
  assert.equal(sidecar.contrast.floor, 8); assert.deepEqual(sidecar.contrast.below, []);
  assert.ok(sidecar.contrast.min >= 8 && sidecar.contrast.items.some(i => i.kind === 'figure' && i.text === 'Three cool ones'), JSON.stringify(sidecar.contrast).slice(0, 300));
  const long = run('--collection', collection, '--view', 'view=float&arrange=axes', '--title', 'A headline far too long for the band '.repeat(5).trim(),
    '--size', '640x400', '--scale', '1', '--out', path.join(dir, 'long.png'));
  assert.equal(long.status, 1); assert.match(long.stderr, /Figure text does not fit/);
  assert.equal(await stat(path.join(dir, 'long.png')).then(() => true, () => false), false);
  const label = run('--collection', collection, '--label', 'bogus=x', '--out', path.join(dir, 'bogus.png'));
  assert.equal(label.status, 1); assert.match(label.stderr, /label.bogus is not a label a shot can override/);
});

test('scripts/still.mjs refuses, and writes nothing, when the link or the collection is refused', async t => {
  const dir = await fixtureDir(t), collection = path.join(dir, 'collection.json');
  for (const [args, message] of [
    [['--view', 'view=float&arrange=rgb'], /The view was refused: .*arrange must be one of/],
    [['--view', 'chrome=full'], /--view may not set chrome/],
    [['--size', 'big'], /--size must be WIDTHxHEIGHT/],
    [['--view', 'view=float&arrange=axes&frame=evidence'], /frame=evidence has nothing to frame/],
  ]) {
    const result = run('--collection', collection, ...args, '--out', path.join(dir, 'x.png'));
    assert.equal(result.status, 1, `${args.join(' ')} fails`);
    assert.match(result.stderr, message);
    assert.equal(await stat(path.join(dir, 'x.png')).then(() => true, () => false), false, 'no image is written');
  }
  const missing = run('--collection', path.join(dir, 'nope.json'), '--out', path.join(dir, 'x.png'));
  assert.equal(missing.status, 1); assert.match(missing.stderr, /No collection file at/);
});
