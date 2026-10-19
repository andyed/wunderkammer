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
    assert.deepEqual(await page.locator('#stage').boundingBox(), { x: 0, y: 0, width: 1000, height: 700 }, 'the stage fills the page');
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

test('scripts/still.mjs refuses, and writes nothing, when the link or the collection is refused', async t => {
  const dir = await fixtureDir(t), collection = path.join(dir, 'collection.json');
  for (const [args, message] of [
    [['--view', 'view=float&arrange=rgb'], /The view was refused: .*arrange must be one of/],
    [['--view', 'chrome=full'], /--view may not set chrome/],
    [['--size', 'big'], /--size must be WIDTHxHEIGHT/],
  ]) {
    const result = run('--collection', collection, ...args, '--out', path.join(dir, 'x.png'));
    assert.equal(result.status, 1, `${args.join(' ')} fails`);
    assert.match(result.stderr, message);
    assert.equal(await stat(path.join(dir, 'x.png')).then(() => true, () => false), false, 'no image is written');
  }
  const missing = run('--collection', path.join(dir, 'nope.json'), '--out', path.join(dir, 'x.png'));
  assert.equal(missing.status, 1); assert.match(missing.stderr, /No collection file at/);
});
