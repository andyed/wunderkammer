import test from 'node:test';
import assert from 'node:assert/strict';
import { OverviewSurface, backingSize, imageRect, overviewEligible, overviewSource, pictureTransform } from '../wall/overview-surface.mjs';

function node(image = null) {
  const classes = new Set();
  return { classes, classList: { add: v => classes.add(v), remove: v => classes.delete(v) },
    querySelector: () => image };
}

function fixture(options = {}) {
  let id = 0;
  const frames = new Map(), draws = [], clears = [];
  const canvas = { style: {}, width: 0, height: 0, setAttribute() {}, remove() {},
    getContext: () => ({ setTransform() {}, fillRect() {}, clearRect: (...args) => clears.push(args), drawImage: (...args) => draws.push(args) }) };
  const surface = new OverviewSurface({ prepend() {} }, { canvas,
    requestFrame: fn => { frames.set(++id, fn); return id; }, cancelFrame: id => frames.delete(id), now: () => 0, ...options });
  const flush = () => {
    for (let n = 0; frames.size && n < 100; n++) {
      const batch = [...frames.values()]; frames.clear(); for (const frame of batch) frame();
    }
    assert.equal(frames.size, 0, 'surface must finish finite work and become idle');
  };
  const move = (pose = {}, area = {}) => surface.setViewport({ x: 0, y: 0, scale: 0.2, ...pose }, { width: 500, height: 400, dpr: 2, ...area });
  return { surface, frames, draws, clears, flush, move };
}
const tile = (id, x = 0, extra = {}) => ({ key: id, x, y: 0, w: 240, h: 240, clip: { cover: `${id}.jpg` }, ...extra });
const resource = (width = 96, height = 96) => ({ image: { width, height }, width, height, closed: false, close() { this.closed = true; } });
const microtasks = () => new Promise(resolve => setImmediate(resolve));

test('overview uses hysteresis; backing pixels stay bounded even on a high-DPR large display', () => {
  assert.equal(overviewEligible(false, 75), false);
  assert.equal(overviewEligible(true, 75), true);
  assert.equal(overviewEligible(true, 97), false);
  assert.equal(overviewEligible(false, 120, true), true);
  assert.equal(overviewEligible(true, 161, true), false);
  assert.equal(overviewEligible(true, NaN), false);
  const small = backingSize(800, 600, 3);
  assert.deepEqual(small, { width: 1600, height: 1200, dpr: 2 });
  const large = backingSize(6000, 4000, 3);
  assert.ok(large.width * large.height <= 4_194_304);
});

test('contain preserves arbitrary aspect and cover crops symmetrically; smallest valid variant wins', () => {
  assert.deepEqual(imageRect(100, 200, 10, 20, 100, 100, 'contain'), [0, 0, 100, 200, 35, 20, 50, 100]);
  assert.deepEqual(imageRect(200, 100, 10, 20, 100, 100, 'cover'), [50, 0, 100, 100, 10, 20, 100, 100]);
  assert.equal(imageRect(0, 10, 0, 0, 10, 10), null);
  assert.equal(overviewSource({ cover: 'full', coverVariants: [{ src: 'bad', width: 0 }, { src: 'read', width: 640 }, { src: 'small', width: 64 }] }), 'small');
});

test('already decoded DOM imagery draws at the authoritative pose before its image is hidden', () => {
  const image = { complete: true, naturalWidth: 200, naturalHeight: 100 };
  const control = node(image), f = fixture({ loadImage: () => { throw new Error('must reuse image'); } });
  f.surface.setTiles([tile('one', 50, { node: control, fit: 'contain', border: 0 })]);
  f.move({ x: 10, y: 20 });
  assert.equal(control.classes.size, 0, 'DOM remains visible before first pixels');
  f.flush();
  assert.equal(f.draws.length, 1);
  assert.deepEqual(f.draws[0].slice(1), [0, 0, 200, 100, 20, 32, 48, 24]);
  assert.ok(control.classes.has('overview-painted'));
  assert.equal(f.surface.stats.pending, 0);
  const draws = f.surface.stats.draws;
  f.move({ x: 10, y: 20 }); f.flush();
  assert.equal(f.surface.stats.draws, draws, 'unchanged settled pose never repaints');
  f.move({ scale: 1 });
  assert.equal(control.classes.size, 0, 'reading scale immediately restores the DOM image');
  assert.equal(f.surface.canvas.hidden, true);
  f.surface.dispose();
});

test('visible center decodes first, concurrency is bounded, failure keeps DOM and stale scope cannot paint', async () => {
  const requests = [], f = fixture({ concurrency: 2, loadImage: (source, options) => new Promise((resolve, reject) => requests.push({ source, ...options, resolve, reject })) });
  const controls = [node(), node(), node()];
  f.surface.setTiles([tile('left', 0, { node: controls[0] }), tile('center', 1000, { node: controls[1] }), tile('right', 2000, { node: controls[2] }), tile('offscreen', 5000)]);
  f.move(); f.flush(); await microtasks();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].source, 'center.jpg');
  assert.equal(f.surface.stats.pending, 2);
  assert.equal(controls[1].classes.size, 0);
  requests[0].resolve(resource()); await microtasks(); f.flush(); await microtasks();
  assert.ok(controls[1].classes.has('overview-painted'));
  assert.equal(requests.length, 3);
  requests[1].reject(new Error('bad image')); await microtasks(); f.flush();
  assert.equal(controls[0].classes.size, 0);
  f.surface.setTiles([tile('new', 0)]);
  assert.ok(requests[2].signal.aborted);
  const stale = resource(); requests[2].resolve(stale); await microtasks();
  assert.equal(stale.closed, true, 'late old-scope decode is released');
  assert.equal(f.surface.cache.has('right.jpg'), false);
  f.surface.dispose();
});

test('pixel budget evicts resources and an oversubscribed view settles without a reload loop', async () => {
  const assets = [], f = fixture({ maxImages: 1, concurrency: 1, loadImage: async () => { const r = resource(); assets.push(r); return r; } });
  f.surface.setTiles([tile('a'), tile('b', 260)]); f.move();
  for (let i = 0; i < 8; i++) { f.flush(); await microtasks(); }
  assert.equal(assets.length, 2, 'each source is requested at most once for this layout');
  assert.equal(f.surface.stats.images, 1);
  assert.equal(f.surface.stats.pending, 0);
  assert.equal(f.surface.stats.scheduled, false);
  assert.equal(assets.filter(a => a.closed).length, 1);
  f.surface.dispose();
  assert.equal(assets.filter(a => a.closed).length, 2);
});

test('a frame budget yields partial paint without hiding imagery that was not drawn', () => {
  let time = 0;
  const f = fixture({ frameBudgetMs: 3, now: () => time++ });
  const image = { complete: true, naturalWidth: 100, naturalHeight: 100 };
  const nodes = Array.from({ length: 10 }, () => node(image));
  f.surface.setTiles(nodes.map((n, i) => tile(`${i}`, i * 240, { node: n })));
  f.move();
  const first = [...f.frames.values()][0]; f.frames.clear(); first();
  const painted = nodes.filter(n => n.classes.has('overview-painted')).length;
  assert.ok(painted > 0 && painted < nodes.length);
  f.flush();
  assert.equal(nodes.filter(n => n.classes.has('overview-painted')).length, 10);
  f.surface.setEnabled(false);
  assert.equal(nodes.filter(n => n.classes.has('overview-painted')).length, 0);
  f.surface.dispose();
});

test('zooming into reading scale keeps painted pixels until the DOM image can take over', async () => {
  const listeners = new Map();
  const image = { complete: false, naturalWidth: 0, naturalHeight: 0, dataset: { src: 'reading.jpg' },
    getAttribute: () => null, addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name) };
  const control = node(image), f = fixture({ loadImage: async () => resource() });
  f.surface.setTiles([tile('one', 0, { node: control })]);
  f.move(); f.flush(); await microtasks(); f.flush();
  assert.ok(control.classes.has('overview-painted'));
  f.move({ scale: 1 }); f.flush();
  assert.equal(f.surface.active, true, 'the fallback picture survives while reading image loads');
  assert.equal(image.src, 'reading.jpg');
  assert.ok(control.classes.has('overview-painted'));
  assert.equal(f.surface.stats.scheduled, false, 'waiting for an image does not poll animation frames');
  image.complete = true; image.naturalWidth = image.naturalHeight = 640;
  listeners.get('load')({ type: 'load' });
  assert.equal(f.surface.active, false);
  assert.equal(control.classes.size, 0);
  assert.equal(listeners.size, 0);
  f.surface.dispose();
});

test('complete pictures use the compositor and refresh after geometry or backing size changes', () => {
  const image = { complete: true, naturalWidth: 100, naturalHeight: 100 };
  const control = node(image), f = fixture();
  f.surface.setTiles([tile('one', 0, { node: control })]);
  f.move(); f.flush();
  const initial = f.surface.stats.draws;
  f.surface.setEnabled(true);
  assert.equal(f.frames.size, 0, 'repeated enabled calls do no camera or paint work');
  f.move({ x: -125, y: -100, scale: 0.3 }, { moving: true });
  assert.equal(f.surface.stats.draws, initial, 'covered camera motion scales existing pixels without drawing');
  assert.equal(f.surface.stats.compositing, true);
  assert.equal(f.frames.size, 0);
  assert.notEqual(f.surface.canvas.style.transform, 'none');
  assert.ok(control.classes.has('overview-painted'));
  // Unoccupied newly exposed space needs no imagery; cached pixels stay valid.
  f.move({ x: 10, y: 0, scale: 0.3 }, { moving: true });
  assert.equal(f.surface.stats.compositing, true);
  assert.equal(f.surface.stats.draws, initial);
  f.move({ x: 10, y: 0, scale: 0.3 }, { moving: true, width: 520 });
  assert.equal(f.surface.stats.compositing, false);
  assert.equal(f.surface.stats.domFallback, true);
  assert.equal(f.surface.stats.draws, initial, 'a decoded DOM fallback carries a resizing gesture');
  f.move({ x: 10, y: 0, scale: 0.3 }, { moving: false, width: 520 }); f.flush();
  assert.ok(f.surface.stats.draws > initial);
  assert.equal(f.surface.canvas.style.transform, 'none');
  const fresh = f.surface.stats.draws;
  f.move({ x: -50, y: -50, scale: 0.4 }, { moving: true, width: 520 });
  assert.equal(f.surface.stats.compositing, true);
  f.move({ x: -50, y: -50, scale: 0.4 }, { moving: false, width: 520 }); f.flush();
  assert.ok(f.surface.stats.draws > fresh, 'settle refreshes at the final raster scale');
  assert.equal(f.surface.canvas.style.transform, 'none');
  assert.equal(f.surface.stats.compositing, false);
  f.surface.dispose();
});

test('cached viewport coverage rejects zoom-out, resize, DPR change and newly exposed edges', () => {
  const picture = { pose: { x: 20, y: 40, scale: 0.5 }, width: 500, height: 400, dpr: 2 };
  const area = { width: 500, height: 400, dpr: 2 };
  assert.deepEqual(pictureTransform(picture, { x: -60, y: -20, scale: 1 }, area), { x: -100, y: -100, scale: 2 });
  assert.equal(pictureTransform(picture, { x: 20, y: 40, scale: 0.4 }, area), null);
  assert.equal(pictureTransform(picture, { x: 41, y: -20, scale: 1 }, area), null);
  assert.equal(pictureTransform(picture, { x: -1000, y: -20, scale: 1 }, area), null);
  assert.equal(pictureTransform(picture, picture.pose, { ...area, width: 501 }), null);
  assert.equal(pictureTransform(picture, picture.pose, { ...area, dpr: 1 }), null);
});

test('1793 streamed arrivals draw each image once without repeated scene scans, clears or marker churn', async () => {
  let queries = 0, adds = 0, removes = 0;
  const f = fixture({ concurrency: 1, loadImage: async () => resource() });
  const tiles = Array.from({ length: 1793 }, (_, i) => {
    const control = { querySelector: () => { queries++; return null; }, classList: { add: () => adds++, remove: () => removes++ } };
    return tile(String(i), (i % 50) * 22, { node: control, y: Math.floor(i / 50) * 22, w: 20, h: 20 });
  });
  f.surface.setTiles(tiles); f.move();
  for (let i = 0; i < tiles.length + 2; i++) { f.flush(); await microtasks(); }
  assert.equal(f.surface.stats.draws, 1793, 'arrival work is linear, not a full-prefix redraw per image');
  assert.equal(f.clears.length, 1, 'unchanged geometry never clears existing pixels');
  assert.equal(queries, 1793, 'image DOM references are obtained once per layout');
  assert.equal(adds, 1793);
  assert.equal(removes, 0, 'streaming never uncovers already painted tiles');
  assert.equal(f.surface.stats.pending, 0);
  assert.equal(f.surface.stats.scheduled, false);
  f.surface.dispose();
});

test('an in-flight DOM source is reused and its load paints only that source', async () => {
  const image = { complete: false, naturalWidth: 0, naturalHeight: 0, currentSrc: 'one.jpg' };
  const control = node(image);
  const f = fixture({ loadImage: () => { throw new Error('duplicate image request'); } });
  f.surface.setTiles([tile('one', 0, { node: control })]); f.move(); f.flush(); await microtasks();
  assert.equal(f.surface.stats.pending, 0);
  image.complete = true; image.naturalWidth = image.naturalHeight = 128;
  f.surface._onImageLoad({ target: image }); f.flush();
  assert.equal(f.surface.stats.draws, 1);
  assert.equal(f.clears.length, 1);
  assert.ok(control.classes.has('overview-painted'));
  f.surface.dispose();
});

test('zoom-out uses decoded DOM at exposed bitmap edges and restores coverage markers on return', () => {
  const image = { complete: true, naturalWidth: 128, naturalHeight: 128 };
  const inside = node(image), boundary = node(image), f = fixture();
  f.surface.setTiles([tile('inside', 100, { node: inside }), tile('boundary', 2400, { node: boundary })]);
  f.move(); f.flush();
  assert.ok(boundary.classes.has('overview-painted'), 'initial clipped portion is present in the bitmap');
  const draws = f.surface.stats.draws;
  f.move({ scale: 0.1 }, { moving: true });
  assert.equal(f.surface.stats.compositing, true);
  assert.equal(f.surface.stats.draws, draws);
  assert.ok(inside.classes.has('overview-painted'));
  assert.equal(boundary.classes.has('overview-painted'), false, 'the complete decoded DOM image covers the newly exposed part');
  f.move({ scale: 0.2 }, { moving: true });
  assert.ok(boundary.classes.has('overview-painted'));
  assert.equal(f.surface.stats.draws, draws);
  f.surface.dispose();
});

test('a cached picture with missing pixels cannot hide an unready newly exposed DOM image', () => {
  const ready = { complete: true, naturalWidth: 128, naturalHeight: 128 };
  const absent = { complete: false, naturalWidth: 0, naturalHeight: 0, currentSrc: 'new.jpg' };
  const inside = node(ready), outside = node(absent), f = fixture();
  f.surface.setTiles([tile('inside', 100, { node: inside }), tile('outside', 2800, { node: outside })]);
  f.move(); f.flush();
  f.move({ scale: 0.1 }, { moving: true });
  assert.equal(f.surface.stats.compositing, false, 'cold new imagery uses the bounded draw/load path');
  assert.equal(outside.classes.has('overview-painted'), false);
  assert.equal(f.clears.length, 2);
  f.surface.dispose();
});

test('returning from reading scale reuses the retained complete bitmap before any new draw', () => {
  const ready = { complete: true, naturalWidth: 128, naturalHeight: 128 };
  const control = node(ready), f = fixture();
  f.surface.setTiles([tile('one', 100, { node: control })]); f.move(); f.flush();
  const draws = f.surface.stats.draws, clears = f.clears.length;
  f.move({ scale: 1 });
  assert.equal(f.surface.active, false);
  assert.equal(control.classes.has('overview-painted'), false);
  f.move({ scale: 0.5 }, { moving: true });
  assert.equal(f.surface.active, true);
  assert.equal(f.surface.stats.compositing, true);
  assert.equal(f.surface.stats.draws, draws, 'reentry need not rebuild a picture that still exists');
  assert.equal(f.clears.length, clears);
  assert.ok(control.classes.has('overview-painted'));
  f.move({ scale: 0.5 }, { moving: false }); f.flush();
  assert.equal(f.surface.active, false, 'the motion picture yields back at reading scale');
  f.surface.dispose();
});

test('without a complete bitmap, decoded DOM carries repeated motion without restarting raster work', () => {
  const ready = { complete: true, naturalWidth: 128, naturalHeight: 128 };
  const controls = Array.from({ length: 20 }, () => node(ready)), f = fixture();
  f.surface.setTiles(controls.map((control, i) => tile(String(i), (i % 5) * 250, { node: control, y: Math.floor(i / 5) * 250 })));
  for (let i = 0; i < 20; i++) {
    f.move({ x: -i, y: -i, scale: 0.2 + i * 0.005 }, { moving: true });
    assert.equal(f.surface.stats.domFallback, true);
    assert.equal(f.surface.canvas.hidden, true);
    assert.equal(f.surface.stats.scheduled, false);
    assert.equal(f.surface.stats.draws, 0);
    assert.equal(f.clears.length, 0);
    assert.ok(controls.every(control => !control.classes.has('overview-painted')));
  }
  f.move({ x: -19, y: -19, scale: 0.295 }, { moving: false }); f.flush();
  assert.equal(f.surface.stats.domFallback, false);
  assert.equal(f.surface.canvas.hidden, false);
  assert.equal(f.surface.stats.draws, 20);
  assert.equal(f.clears.length, 1);
  assert.ok(controls.every(control => control.classes.has('overview-painted')));
  f.surface.dispose();
});

test('atomic decoded image replacement updates one occurrence without clearing its cached pixels', () => {
  const old = { complete: true, naturalWidth: 128, naturalHeight: 128 };
  const replacement = { complete: true, naturalWidth: 640, naturalHeight: 640 };
  const control = node(old), f = fixture();
  f.surface.setTiles([tile('one', 100, { node: control })]); f.move(); f.flush();
  const draws = f.surface.stats.draws, clears = f.clears.length;
  assert.equal(f.surface.replaceImage(control, replacement), true);
  assert.equal(f.surface.tiles[0].image, replacement);
  assert.equal(f.surface._imageSources.has(old), false);
  assert.equal(f.surface._imageSources.get(replacement), 'one.jpg');
  assert.equal(f.surface.stats.draws, draws); assert.equal(f.clears.length, clears);
  assert.equal(f.surface.stats.scheduled, false);
  assert.ok(control.classes.has('overview-painted'));
  assert.equal(f.surface.replaceImage(control, { complete: false, naturalWidth: 0 }), false);
  assert.equal(f.surface.tiles[0].image, replacement);
  assert.equal(f.surface.replaceImage(node(old), replacement), false, 'a removed occurrence cannot update the current scene');
  f.surface.dispose();
});

test('an abrupt disable ends a gradual handoff that is still waiting', () => {
  const listeners = new Map();
  const image = { complete: false, naturalWidth: 0, naturalHeight: 0, dataset: { src: 'slow.jpg' },
    getAttribute: () => null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const control = node(image), f = fixture({ loadImage: async () => resource() });
  f.surface.setTiles([tile('one', 0, { node: control })]);
  f.move(); f.flush();
  return microtasks().then(() => {
    f.flush();
    assert.ok(control.classes.has('overview-painted'));
    f.surface.setEnabled(false);
    assert.equal(f.surface.active, true, 'a lens hands off gradually while the image loads');
    f.surface.setEnabled(false, { gradual: false });
    assert.equal(f.surface.active, false, 'leaving the flat view ends the handoff at once');
    assert.equal(control.classes.size, 0);
    f.surface.dispose();
  });
});

test('each cell is filled with its image\'s dominant colour, else the panel colour', () => {
  const fills = [];
  const ctx = { setTransform() {}, clearRect() {}, fillRect() {}, drawImage() {}, save() {}, restore() {}, beginPath() {}, clip() {},
    set fillStyle(v) { fills.push(v); }, get fillStyle() { return fills.at(-1); } };
  const canvas = { style: {}, width: 0, height: 0, setAttribute() {}, remove() {}, getContext: () => ctx };
  const frames = [];
  const surface = new OverviewSurface({ prepend() {} }, { canvas, atlas: false, sheets: false, background: '#14141f',
    requestFrame: fn => frames.push(fn), cancelFrame() {}, now: () => 0 });
  const image = () => ({ complete: true, naturalWidth: 96, naturalHeight: 96 });
  surface.setTiles([
    tile('tinted', 0, { node: node(image()), clip: { cover: 'a.jpg', palette: ['#c04020', '#000000'] } }),
    tile('plain', 300, { node: node(image()), clip: { cover: 'b.jpg', palette: ['not a colour'] } }),
  ]);
  surface.setViewport({ x: 0, y: 0, scale: 0.2 }, { width: 500, height: 400, dpr: 2 });
  while (frames.length) frames.shift()();
  assert.deepEqual(fills, ['#c04020', '#14141f']);
});
