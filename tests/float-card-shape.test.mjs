// A floating card takes its image's shape (wall/float-space.mjs "contained";
// wall/float-view.mjs shapeLayout, noteImageShape). The arrangement shapes a
// card from props.dims; the view draws an image across the whole card, so a
// card of another shape stretches it.
import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { contained, SHAPE_TOLERANCE, aspectOf, statedAspect, imageShape, READING_TOLERANCE } from '../wall/float-space.mjs';
import { buildFacets } from '../wall/facet-counts.mjs';

test('contained: the largest card of the image\'s shape inside the box, and the box itself within tolerance', () => {
  assert.deepEqual(contained(120, 90, 0.5), [45, 90], 'a tall image keeps the box height');
  assert.deepEqual(contained(120, 90, 3), [120, 40], 'a wide image keeps the box width');
  assert.deepEqual(contained(120, 90, 4 / 3), [120, 90], 'the same shape is the box');
  assert.deepEqual(contained(120, 90, 4 / 3 * (1 + SHAPE_TOLERANCE * 0.9)), [120, 90], 'inside the tolerance the card keeps its box');
  assert.notDeepEqual(contained(120, 90, 4 / 3 * (1 + SHAPE_TOLERANCE * 1.5)), [120, 90], 'past the tolerance it does not');
  for (const [w, h, a] of [[120, 90, 0.2], [120, 90, 9], [50, 200, 1], [200, 50, 1]]) {
    const [cw, ch] = contained(w, h, a);
    assert.ok(cw <= w + 1e-9 && ch <= h + 1e-9, `inside the box: ${cw} × ${ch} in ${w} × ${h}`);
    assert.ok(Math.abs(cw - w) < 1e-9 || Math.abs(ch - h) < 1e-9, 'and touching two of its sides');
    assert.ok(Math.abs(cw / ch - a) < 1e-9, 'at the image\'s own ratio');
  }
  for (const bad of [0, -1, NaN, Infinity, undefined]) assert.deepEqual(contained(120, 90, bad), [120, 90], `an unknown shape (${bad}) leaves the box`);
});

test('imageShape: a reading that agrees with the stated shape is the stated shape; one that does not is the image', () => {
  assert.equal(imageShape(64 / 6, 10), 10, 'a 10:1 image read from a 64 px tile is 10.67: the stated 10 is the better number');
  assert.equal(imageShape(10 * (1 + READING_TOLERANCE * 0.9), 10), 10);
  assert.equal(imageShape(0.5, 4 / 3), 0.5, 'dims that are not the image\'s lose to the image');
  assert.equal(imageShape(0.5, 0), 0.5, 'no dims: the reading');
  assert.equal(statedAspect({ props: { dims: ['480x48'] } }), 10, 'stated shape is not clamped');
  assert.equal(statedAspect({ props: { dims: '90x180' } }), 0.5);
  for (const none of [{}, { props: {} }, { props: { dims: ['wide'] } }, { props: { dims: ['0x10'] } }, null]) assert.equal(statedAspect(none), 0);
});

// Covers are SVGs of a stated pixel size. `dims` is what the collection says;
// the cover is what the image is.
const item = (id, cover, dims) => ({ id, url: `urn:shape:${id}`, title: id, source: 'Fixture', tags: [], captured: '2026-01-05',
  cover: `/covers/${cover}.svg`, palette: ['#336699', '#123456'], props: { family: ['x'], ...(dims ? { dims: [dims] } : {}) } });
const cases = {
  tall: { cover: '90x180', dims: null, image: 0.5 },      // no dims: the arrangement assumes 4:3
  wide: { cover: '300x100', dims: null, image: 3 },
  wrong: { cover: '100x200', dims: '160x120', image: 0.5 }, // dims that are not the image's
  pano: { cover: '480x48', dims: '480x48', image: 10 },     // right dims, past the 0.3–4 clamp
  match: { cover: '160x120', dims: '160x120', image: 4 / 3 },
  plain: { cover: '160x120', dims: null, image: 4 / 3 },    // no dims, and the image happens to be 4:3
};
const clips = Object.entries(cases).map(([id, c]) => item(id, c.cover, c.dims));
for (let i = 0; i < 14; i++) clips.push(item(`fill${i}`, '160x120', '160x120'));
const facets = buildFacets(clips), key = id => `urn:shape:${id}`;
const reshaped = ['tall', 'wide', 'wrong', 'pano'], kept = ['match', 'plain'];

let browser, server, origin; const errors = [];
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/api/clips') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ clips, facets, corpus: { id: 'shape-fixture', revision: 'r1' }, ui: { title: 'Shape fixture', defaultGroup: 'family' } })); return; }
    if (url.pathname === '/api/view-state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'family', piles: [] })); return; }
    const cover = /^\/covers\/(\d+)x(\d+)\.svg$/.exec(url.pathname);
    if (cover) { const [, w, h] = cover; res.setHeader('content-type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#336699"/></svg>`); return; }
    if (url.pathname === '/' || /^\/wall\/[\w./-]+$/.test(url.pathname) && !url.pathname.includes('..')) {
      try { const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(new URL('../' + file, import.meta.url))); return; } catch { /* 404 below */ }
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); });
afterEach(() => { assert.deepEqual(errors.splice(0), []); });

const debug = p => p.evaluate(() => window.wunderkammerFloatDebug());
/** Every tile loaded and measured, nothing travelling, no flight in progress. */
const settled = p => p.waitForFunction(() => {
  const s = window.wunderkammerFloatDebug?.().scene;
  return s && s.built && s.loading === 0 && s.farResident === s.itemCount && !s.moving && !s.flying && Object.values(s.imageAspect).every(a => a > 0);
}, null, { timeout: 15000 });
async function open(query, { motion = false } = {}) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${origin}/${query}`);
  await p.waitForSelector('body[data-view-ready=true]');
  await settled(p);
  return p;
}
const ratio = ([w, h]) => w / h;
/** A card is its image's shape, to the precision a 64 px tile gives. */
function assertShapes(scene, where) {
  for (const id of reshaped) {
    const size = scene.sizes[key(id)], box = scene.boxes[key(id)], image = cases[id].image;
    assert.ok(Math.abs(ratio(size) / image - 1) <= 0.04, `${where}: ${id} is drawn at its image's ratio ${image}, got ${ratio(size).toFixed(3)} (box ${ratio(box).toFixed(3)})`);
    assert.ok(size[0] <= box[0] + 0.02 && size[1] <= box[1] + 0.02, `${where}: ${id} stays inside the box the arrangement gave it`);
    assert.ok(Math.abs(size[0] - box[0]) <= 0.02 || Math.abs(size[1] - box[1]) <= 0.02, `${where}: ${id} fills its box one way`);
    assert.ok(Math.abs(ratio(box) / image - 1) > 0.2, `${where}: ${id}'s box was another shape, or this checks nothing`);
  }
  for (const id of [...kept, 'fill0', 'fill13']) assert.deepEqual(scene.sizes[key(id)], scene.boxes[key(id)], `${where}: ${id} already had its image's shape and keeps its box`);
}

test('the fixture asks the question: without dims a card is boxed at 4:3, and a ratio past 4 is clamped', () => {
  assert.equal(aspectOf(clips[0]), 4 / 3); assert.equal(aspectOf(clips[1]), 4 / 3);
  assert.equal(aspectOf(clips[3]), 4, 'the panorama\'s 10:1 is clamped');
});

test('on the mountain a card is drawn at its image\'s shape, inside its box, standing on the slope', async () => {
  const p = await open('?view=float&arrange=mountain&rail=0'); try {
    const { scene } = await debug(p);
    assert.equal(scene.arrangement, 'mountain');
    assertShapes(scene, 'mountain');
    for (const id of [...reshaped, ...kept]) {
      const k = key(id), foot = scene.positions[k][1] - scene.sizes[k][1] / 2, slope = scene.exact[k][1] - scene.boxes[k][1] / 2;
      assert.ok(Math.abs(foot - slope) <= 0.05, `${id} stands where its box stood: foot ${foot} vs ${slope}`);
      assert.ok(Math.abs(scene.positions[k][0] - scene.exact[k][0]) <= 0.02 && Math.abs(scene.positions[k][2] - scene.exact[k][2]) <= 0.02, `${id} has not moved along or up the slope`);
    }
  } finally { await p.close(); }
});

test('in a colour arrangement a card is drawn at its image\'s shape about the same centre', async () => {
  const p = await open('?view=float&arrange=oklab&rail=0'); try {
    const { scene } = await debug(p);
    assertShapes(scene, 'oklab');
    for (const id of reshaped) assert.deepEqual(scene.positions[key(id)], scene.targets[key(id)], `${id} is where the arrangement put it`);
  } finally { await p.close(); }
});

test('a new arrangement starts from the shapes already measured', async () => {
  const p = await open('?view=float&arrange=mountain&rail=0'); try {
    await p.locator('.float-arrange input[value=hsl]').check();
    // Read at once, not after tiles could report again: the shapes come from what was measured before.
    const { scene } = await debug(p);
    assert.equal(scene.arrangement, 'hsl');
    assertShapes(scene, 'after re-arranging');
    await p.locator('.float-arrange input[value=mountain]').check(); await settled(p);
    assertShapes((await debug(p)).scene, 'back on the mountain');
  } finally { await p.close(); }
});

test('a card lifted on its stick keeps its image\'s shape', async () => {
  const p = await open('?view=float&arrange=mountain&rail=0'); try {
    let { scene } = await debug(p);
    const k = key('tall'), [x, y] = scene.screen[k], box = await p.locator('.float-canvas').boundingBox();
    await p.mouse.move(box.x + (x + 1) / 2 * box.width, box.y + (1 - y) / 2 * box.height, { steps: 3 });
    await p.waitForFunction(k => window.wunderkammerFloatDebug().scene.stuck === k, k);
    await settled(p); ({ scene } = await debug(p));
    const lifted = scene.sizes[k];
    assert.ok(Math.abs(ratio(lifted) / cases.tall.image - 1) <= 0.04, `lifted at ratio ${ratio(lifted).toFixed(3)}`);
    assert.ok(lifted[1] > scene.boxes[k][1], 'and larger than it stood, as a lifted card is');
  } finally { await p.close(); }
});
