import assert from 'node:assert/strict';
import test from 'node:test';
import { layout, frameAround, groupBy } from '../wall/layout.mjs';

// Same stress shape as the reported view: a dominant 385-item source, several
// medium groups, and a long tail of tiny groups. No personal corpus in tests.
import { clips } from './fixtures/layout-clips.mjs';

const fill = (result, aspect) => {
  const scale = Math.min(aspect / result.width, 1 / result.height);
  return result.tiles.reduce((sum, t) => sum + t.w * t.h, 0) * scale ** 2 / aspect;
};

for (const aspect of [0.6, 1.5, 2.4]) {
  test(`large grouped collection fills a ${aspect}:1 viewport without overlap`, () => {
    const result = layout(clips, 'source', { viewportAspect: aspect });
    assert.ok(fill(result, aspect) > 0.55, `tile fill ${fill(result, aspect)}`);
    assert.equal(result.tiles.length, clips.length);
    assert.equal(new Set(result.tiles.map(t => t.clip.id)).size, clips.length);
    for (let i = 0; i < result.blocks.length; i++) {
      const a = result.blocks[i];
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= result.width + 0.01 && a.y + a.h <= result.height + 0.01);
      for (const b of result.blocks.slice(i + 1)) {
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
          `overlap: ${a.label} / ${b.label}`);
      }
      for (const t of result.tiles.filter(t => t.group === a.label)) {
        assert.ok(t.x >= a.x && t.y >= a.y && t.x + t.w <= a.x + a.w + 0.01 && t.y + t.h <= a.y + a.h + 0.01);
        const [w, h] = t.clip.props.dims[0].split('x').map(Number);
        assert.ok(Math.abs(t.w / t.h - w / h) < 0.001, 'media proportions preserved');
      }
    }
  });
}

test('tiny and empty subsets have finite tight bounds', () => {
  for (const n of [0, 1, 3, 12]) for (const group of ['none', 'source']) {
    const result = layout(clips.slice(0, n), group, { viewportAspect: 1.5 });
    assert.equal(result.tiles.length, n);
    assert.ok(result.width > 0 && Number.isFinite(result.width));
    assert.ok(result.height > 0 && Number.isFinite(result.height));
    // Tiny mixed-aspect sets have unavoidable ragged rows and header overhead.
    if (n) assert.ok(fill(result, 1.5) > 0.45);
  }
});

test('tag occurrences preserve identities and do not repeat duplicate facet values', () => {
  const input = [{ ...clips[0], tags: ['a', 'a', 'b'] }, { ...clips[1], tags: ['b'] }];
  const result = layout(input, 'tags');
  assert.equal(result.tiles.length, 3);
  assert.deepEqual(result.blocks.map(b => [b.label, b.count]), [['b', 2], ['a', 1]]);
  assert.deepEqual(new Set(result.tiles.map(t => t.clip.id)), new Set(input.map(c => c.id)));
});

test('publication periods read chronologically despite uneven group counts', () => {
  const input = [
    { id: 'later', props: { publication_period: '1900–1920' } },
    { id: 'early', props: { publication_period: '1800–1885' } },
    { id: 'later-2', props: { publication_period: '1900–1920' } },
    { id: 'middle', props: { publication_period: '1886–1895' } },
  ];
  assert.deepEqual(groupBy(input, 'publication_period').map(g => g.label),
    ['1800–1885', '1886–1895', '1900–1920']);
});

test('frameAround opens a clean gap for the foreground, centres on it, and never overlaps it', () => {
  for (const group of ['none', 'source']) for (const n of [1, 12, 120]) {
    const full = layout(clips, group, { viewportAspect: 1.5 });
    const fg = layout(clips.slice(0, n), group, { viewportAspect: 1.5 });
    const framed = frameAround(full, { w: fg.width, h: fg.height });
    assert.equal(framed.tiles.length, full.tiles.length);
    assert.equal(framed.blocks.length, full.blocks.length);
    const clear = r => r.x + r.w <= 0.01 || r.x >= fg.width - 0.01 || r.y + r.h <= 0.01 || r.y >= fg.height - 0.01;
    for (const t of framed.tiles) assert.ok(clear(t), `tile ${t.clip.id} overlaps the foreground (${group}, n=${n})`);
    for (const b of framed.blocks) assert.ok(clear(b), `block ${b.label} overlaps the foreground (${group}, n=${n})`);
    // Every tile sits wholly above or wholly below the gap: no row is torn in two.
    for (const t of framed.tiles) assert.ok(t.y + t.h <= framed.gap.y + 0.01 || t.y >= framed.gap.y + framed.gap.h - 0.01, 'tile straddles the gap');
    assert.ok(Math.abs(framed.bounds.x + framed.bounds.w / 2 - fg.width / 2) < 1, 'background is centred on the foreground');
    if (framed.split > 0) {
      assert.ok(framed.bounds.y < 0 && framed.bounds.y + framed.bounds.h > fg.height, 'background continues above and below');
    }
    // Relative geometry is preserved: the background is translated, never repacked.
    const above = full.tiles.map((t, i) => [t, framed.tiles[i]]).filter(([t]) => t.y < framed.split - 0.01);
    const dx = new Set(above.map(([a, b]) => (b.x - a.x).toFixed(3))), dy = new Set(above.map(([a, b]) => (b.y - a.y).toFixed(3)));
    assert.ok(dx.size <= 1 && dy.size <= 1, 'uniform offset above the gap');
  }
  const empty = frameAround({ tiles: [], blocks: [], width: 1, height: 1 }, { w: 100, h: 50 });
  assert.deepEqual(empty.bounds, { x: 0, y: 0, w: 0, h: 0 });
});
