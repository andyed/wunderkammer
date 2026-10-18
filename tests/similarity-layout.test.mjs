import assert from 'node:assert/strict';
import test from 'node:test';
import { layout, SIMILARITY, SIMILARITY_GRID, groupBy } from '../wall/layout.mjs';
import { separate, overlaps } from '../wall/similarity-layout.mjs';

// Projection points shaped like a real UMAP run: tight clumps, exact
// duplicates (identical images share a point) and sparse outliers. Seeded so
// every run sees the same map; no personal corpus in tests.
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const random = rng(7);
const dims = ['1200x900', '900x1200', '1600x900', '600x600', '3000x700'];
const centres = [[-0.8, -0.6], [0.1, 0.7], [0.6, -0.2], [0.95, 0.95]];
const corpus = Array.from({ length: 600 }, (_, i) => {
  const [cx, cy] = centres[i % centres.length];
  const spread = i % 9 === 0 ? 0 : i % 50 === 0 ? 0.9 : 0.04;   // every ninth sits exactly on its centre
  return {
    id: `clip-${i}`, url: `https://example.test/${i}`, source: i % 2 ? 'odd' : 'even',
    props: { dims: [dims[i % dims.length]] },
    projection: { x: Math.max(-1, Math.min(1, cx + (random() - 0.5) * spread)), y: Math.max(-1, Math.min(1, cy + (random() - 0.5) * spread)) },
  };
});

const assertNoOverlap = (tiles, label) => {
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    assert.ok(!overlaps(tiles[i], tiles[j]), `${label}: ${tiles[i].clip.id} overlaps ${tiles[j].clip.id}`);
  }
};

for (const aspect of [0.6, 1.6, 2.4]) {
  test(`similarity map has no overlapping tiles at a ${aspect}:1 stage`, () => {
    const result = layout(corpus, SIMILARITY, { viewportAspect: aspect, universe: corpus });
    assert.equal(result.tiles.length, corpus.length);
    assert.deepEqual(new Set(result.tiles.map(t => t.clip)), new Set(corpus));
    assert.deepEqual(result.blocks, []);
    for (const t of result.tiles) {
      assert.ok([t.x, t.y, t.w, t.h].every(Number.isFinite) && t.w > 0 && t.h > 0);
      assert.ok(t.x >= -0.01 && t.y >= -0.01 && t.x + t.w <= result.width + 0.01 && t.y + t.h <= result.height + 0.01);
    }
    assertNoOverlap(result.tiles, `aspect ${aspect}`);
  });
}

test('similarity neighbourhoods survive spacing: clumps stay apart from each other', () => {
  const result = layout(corpus, SIMILARITY, { viewportAspect: 1.6, universe: corpus });
  const centre = k => {
    const ts = result.tiles.filter((t, i) => corpus.indexOf(t.clip) % centres.length === k);
    return [ts.reduce((s, t) => s + t.x, 0) / ts.length, ts.reduce((s, t) => s + t.y, 0) / ts.length];
  };
  // Clump 0 is left of and below clump 1 in projection space; screen y grows downward.
  const [a, b] = [centre(0), centre(1)];
  assert.ok(a[0] < b[0] && a[1] > b[1], `clump order lost: ${a} vs ${b}`);
});

test('a filter hides tiles in place: survivors keep their relative positions', () => {
  const full = layout(corpus, SIMILARITY, { viewportAspect: 1.6, universe: corpus });
  const subset = corpus.filter(c => c.source === 'odd');
  const part = layout(subset, SIMILARITY, { viewportAspect: 1.6, universe: corpus });
  const at = new Map(full.tiles.map(t => [t.clip, t]));
  const dx = at.get(part.tiles[0].clip).x - part.tiles[0].x, dy = at.get(part.tiles[0].clip).y - part.tiles[0].y;
  for (const t of part.tiles) {
    const f = at.get(t.clip);
    assert.ok(Math.abs(f.x - t.x - dx) < 1e-6 && Math.abs(f.y - t.y - dy) < 1e-6, `${t.clip.id} moved`);
  }
  assert.ok(part.tiles.some(t => t.x < 1e-6) && part.tiles.some(t => t.y < 1e-6), 'subset bounds start at the origin');
});

test('unprojected clips stay visible, beneath the map', () => {
  const plain = Array.from({ length: 30 }, (_, i) => ({ id: `plain-${i}`, props: { dims: ['800x600'] } }));
  const mixed = [...corpus.slice(0, 120), ...plain];
  const result = layout(mixed, SIMILARITY, { viewportAspect: 1.6, universe: mixed });
  assert.equal(result.tiles.length, mixed.length);
  const mapBottom = Math.max(...result.tiles.filter(t => t.clip.projection).map(t => t.y + t.h));
  for (const t of result.tiles.filter(t => !t.clip.projection)) assert.ok(t.y > mapBottom, `${t.clip.id} not below the map`);
  assertNoOverlap(result.tiles, 'mixed');
  const none = layout(plain, SIMILARITY, { viewportAspect: 1.6, universe: plain });
  assert.equal(none.tiles.length, plain.length);
  assertNoOverlap(none.tiles, 'unprojected only');
});

test('separate() is bounded and removes overlap even when every rectangle starts at one point', () => {
  const rects = Array.from({ length: 200 }, (_, i) => ({ id: i, x: 0, y: 0, w: 100 + (i % 3) * 40, h: 100 }));
  const { moved } = separate(rects, { gap: 10 });
  assert.equal(moved, 199);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    assert.ok(!overlaps(rects[i], rects[j], 10), `rects ${i} and ${j} closer than the gap`);
  }
});

test('similarity is an arrangement, not a facet grouping', () => {
  assert.deepEqual(groupBy(corpus, SIMILARITY).map(g => g.clips.length), [corpus.length]);
  assert.deepEqual(layout([], SIMILARITY, { universe: corpus }).tiles, []);
});

// Index-time cells (scripts/projection.py): a 30 x 20 lattice, one record per cell, a few empty.
const cellular = corpus.slice(0, 590).map((c, i) => ({ ...c, projection: { ...c.projection, col: i % 30, row: Math.floor(i / 30) } }));

test('similarity grid: one image per cell, contained, never overlapping', () => {
  const result = layout(cellular, SIMILARITY_GRID, { viewportAspect: 1.6, universe: cellular });
  assert.equal(result.tiles.length, cellular.length);
  assertNoOverlap(result.tiles, 'grid');
  const pitchX = (result.width + 14) / 30, pitchY = (result.height + 14) / 20;
  for (const t of result.tiles) {
    const [w, h] = t.clip.props.dims[0].split('x').map(Number);
    assert.ok(Math.abs(t.w / t.h - Math.min(4, Math.max(0.3, w / h))) < 1e-6, 'aspect kept');
    assert.ok(Math.floor((t.x + t.w / 2) / pitchX) === t.clip.projection.col && Math.floor((t.y + t.h / 2) / pitchY) === t.clip.projection.row,
      `${t.clip.id} outside cell ${t.clip.projection.col},${t.clip.projection.row}`);
  }
});

test('similarity grid: a filter leaves holes instead of re-packing', () => {
  const full = layout(cellular, SIMILARITY_GRID, { universe: cellular });
  const subset = cellular.filter((c, i) => i % 3 === 0);
  const part = layout(subset, SIMILARITY_GRID, { universe: cellular });
  const at = new Map(full.tiles.map(t => [t.clip, t]));
  const dx = at.get(part.tiles[0].clip).x - part.tiles[0].x, dy = at.get(part.tiles[0].clip).y - part.tiles[0].y;
  for (const t of part.tiles) assert.ok(Math.abs(at.get(t.clip).x - t.x - dx) < 1e-6 && Math.abs(at.get(t.clip).y - t.y - dy) < 1e-6, `${t.clip.id} moved cell`);
  // Cell-less clips stay in scope beneath the lattice.
  const mixed = [...cellular.slice(0, 40), { id: 'loose', props: { dims: ['800x600'] } }];
  const r = layout(mixed, SIMILARITY_GRID, { universe: mixed });
  assert.ok(r.tiles.at(-1).y > Math.max(...r.tiles.slice(0, -1).map(t => t.y + t.h)));
  assertNoOverlap(r.tiles, 'grid + loose');
});
