import test from 'node:test';
import assert from 'node:assert/strict';
import { OverviewAtlas, slotSize } from '../wall/overview-atlas.mjs';
import { OverviewSurface } from '../wall/overview-surface.mjs';

function pages() {
  const made = [];
  const create = (width, height) => {
    const copies = [];
    const canvas = { width, height, copies, getContext: () => ({ imageSmoothingQuality: 'low', clearRect() {}, drawImage: (...args) => copies.push(args) }) };
    made.push(canvas);
    return canvas;
  };
  return { made, create };
}

test('slots keep aspect, cap the long edge and never upscale', () => {
  assert.deepEqual(slotSize(640, 320, 128), { w: 128, h: 64 });
  assert.deepEqual(slotSize(18, 18, 128), { w: 18, h: 18 });
  assert.equal(slotSize(0, 10), null);
});

test('one copy per source; only a sharper variant earns a new slot', () => {
  const p = pages(), atlas = new OverviewAtlas({ createCanvas: p.create, pageSize: 256 });
  const image = {};
  const first = atlas.put('a', image, 18, 18);
  assert.equal(atlas.lookup('a', 18, 18), first);
  assert.equal(atlas.lookup('a', 16, 16), first, 'a smaller image reuses resident pixels');
  assert.equal(atlas.lookup('a', 128, 128), null, 'a srcset upgrade is copied again');
  const sharper = atlas.put('a', image, 128, 128);
  assert.equal(sharper.w, 128);
  assert.equal(atlas.lookup('a', 18, 18), sharper);
  assert.equal(atlas.stats.uploads, 2);
  assert.equal(p.made.length, 1);
});

test('shelves pack without overlap, add pages, then report full instead of growing', () => {
  const p = pages(), atlas = new OverviewAtlas({ createCanvas: p.create, pageSize: 64, maxPages: 2, gutter: 2 });
  const placed = [];
  for (let i = 0; i < 40; i++) { const s = atlas.put(String(i), {}, 14, 14); if (!s) break; placed.push(s); }
  assert.equal(atlas.full, true);
  assert.equal(p.made.length, 2);
  for (const a of placed) for (const b of placed) {
    if (a === b || a.page !== b.page) continue;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'slots never overlap');
  }
  for (const s of placed) assert.ok(s.x + s.w <= 64 && s.y + s.h <= 64);
  atlas.reset();
  assert.equal(atlas.full, false);
  assert.ok(atlas.put('again', {}, 14, 14));
  assert.equal(p.made.length, 2, 'reset reuses existing pages');
});

test('without canvas support the atlas disables itself and callers draw directly', () => {
  const atlas = new OverviewAtlas({ createCanvas: () => null });
  assert.equal(atlas.put('a', {}, 10, 10), null);
  assert.equal(atlas.disabled, true);
});

function surface(options = {}) {
  let id = 0;
  const frames = new Map(), draws = [];
  const canvas = { style: {}, width: 0, height: 0, setAttribute() {}, remove() {},
    getContext: () => ({ setTransform() {}, fillRect() {}, clearRect() {}, drawImage: (...args) => draws.push(args) }) };
  const p = pages();
  const s = new OverviewSurface({ prepend() {} }, { canvas, createAtlasCanvas: p.create,
    requestFrame: fn => { frames.set(++id, fn); return id; }, cancelFrame: id => frames.delete(id), now: () => 0, ...options });
  const step = () => { const batch = [...frames.values()]; frames.clear(); for (const f of batch) f(); };
  const flush = () => { for (let n = 0; frames.size && n < 200; n++) step(); };
  const node = image => { const classes = new Set(); return { classes, classList: { add: v => classes.add(v), remove: v => classes.delete(v) }, querySelector: () => image }; };
  return { s, draws, flush, step, frames, node, pages: p };
}

test('repaints draw from atlas pages and copy each source only once', () => {
  const f = surface();
  const controls = Array.from({ length: 30 }, (_, i) => f.node({ complete: true, naturalWidth: 18, naturalHeight: 18, i }));
  f.s.setTiles(controls.map((n, i) => ({ key: String(i), x: (i % 10) * 250, y: Math.floor(i / 10) * 250, w: 240, h: 240, clip: { cover: `${i}.jpg` }, node: n })));
  f.s.setViewport({ x: 0, y: 0, scale: 0.2 }, { width: 500, height: 400, dpr: 2 }); f.flush();
  assert.equal(f.s.atlas.stats.uploads, 30);
  assert.ok(f.draws.every(d => d[0] === f.pages.made[0]), 'the overview canvas samples only atlas pages');
  f.s.setViewport({ x: 3, y: 0, scale: 0.2 }, { width: 500, height: 400, dpr: 2 }); f.flush();
  assert.equal(f.s.atlas.stats.uploads, 30, 'a dirty repaint copies nothing new');
  assert.equal(f.draws.length, 60);
  f.s.setTiles(f.s.tiles.slice(0, 10).map(t => ({ ...t, image: undefined })));
  f.flush();
  assert.equal(f.s.atlas.stats.uploads, 30, 'a new layout over the same sources reuses their slots');
  f.s.dispose();
  assert.equal(f.pages.made[0].width, 0, 'dispose releases page backing stores');
});

test('the per-frame copy allowance defers tiles without hiding their DOM images', () => {
  const f = surface({ atlasUploadsPerFrame: 4 });
  const controls = Array.from({ length: 10 }, (_, i) => f.node({ complete: true, naturalWidth: 18, naturalHeight: 18 }));
  f.s.setTiles(controls.map((n, i) => ({ key: String(i), x: i * 250, y: 0, w: 240, h: 240, clip: { cover: `${i}.jpg` }, node: n })));
  f.s.setViewport({ x: 0, y: 0, scale: 0.2 }, { width: 500, height: 400, dpr: 2 });
  f.step();
  assert.equal(f.s.atlas.stats.uploads, 4);
  assert.equal(controls.filter(n => n.classes.has('overview-painted')).length, 4, 'only drawn tiles hide their DOM image');
  f.flush();
  assert.equal(f.s.atlas.stats.uploads, 10);
  assert.ok(controls.every(n => n.classes.has('overview-painted')));
  assert.equal(f.s.stats.scheduled, false);
  f.s.dispose();
});

test('a full atlas draws the overflow directly and resets at the next layout', () => {
  const f = surface({ atlas: new OverviewAtlas({ createCanvas: pages().create, pageSize: 40, maxPages: 1 }) });
  const controls = Array.from({ length: 6 }, () => f.node({ complete: true, naturalWidth: 18, naturalHeight: 18 }));
  const tiles = controls.map((n, i) => ({ key: String(i), x: i * 250, y: 0, w: 240, h: 240, clip: { cover: `${i}.jpg` }, node: n }));
  f.s.setTiles(tiles);
  f.s.setViewport({ x: 0, y: 0, scale: 0.2 }, { width: 2000, height: 400, dpr: 1 }); f.flush();
  assert.equal(f.s.atlas.full, true);
  assert.ok(controls.every(n => n.classes.has('overview-painted')), 'overflow still paints, from its own source');
  assert.ok(f.draws.some(d => d[0] === controls[5].querySelector()), 'overflow drew directly');
  f.s.setTiles(tiles.slice(0, 2));
  assert.equal(f.s.atlas.full, false);
  f.s.dispose();
});
