import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectionImages } from '../wall/collection.mjs';

// video-tiles.mjs imports three from the page's import map; the pure helpers
// are tested through a copy of the module with that import stubbed.
const source = await (await import('node:fs/promises')).readFile(new URL('../wall/video-tiles.mjs', import.meta.url), 'utf8');
const { coverFit, phaseOf } = await import(`data:text/javascript,${encodeURIComponent(source.replace(/^import \* as THREE from 'three';$/m, 'const THREE = {};'))}`);

test('cover fit crops the overflowing axis and centres the rest', () => {
  assert.deepEqual(coverFit(1, 1), { rx: 1, ry: 1, ox: 0, oy: 0 });
  const wide = coverFit(1, 2);          // a 2:1 video on a square tile: half its width shows
  assert.equal(wide.rx, 0.5); assert.equal(wide.ox, 0.25); assert.equal(wide.ry, 1);
  const tall = coverFit(16 / 9, 9 / 16); // portrait video on a landscape tile
  assert.ok(Math.abs(tall.ry - (9 / 16) / (16 / 9)) < 1e-12); assert.ok(Math.abs(tall.oy - (1 - tall.ry) / 2) < 1e-12);
  assert.deepEqual(coverFit(0, 1), { rx: 1, ry: 1, ox: 0, oy: 0 });
  assert.deepEqual(coverFit(1, NaN), { rx: 1, ry: 1, ox: 0, oy: 0 });
});

test('phases are stable per key and spread across the loop', () => {
  assert.equal(phaseOf('urn:clipwall:video:a'), phaseOf('urn:clipwall:video:a'));
  const phases = Array.from({ length: 200 }, (_, i) => phaseOf(`urn:clipwall:video:${i}`));
  assert.ok(phases.every(p => p >= 0 && p < 1));
  // Tenths of the loop: none empty across 200 keys, so a wall does not pulse in step.
  const tenths = new Set(phases.map(p => Math.floor(p * 10)));
  assert.equal(tenths.size, 10);
});

test('a file-existence check walks each clip\'s video', () => {
  const found = collectionImages({ clips: [{ cover: 'a.webp', video: 'a.mp4' }, { cover: 'b.webp' }] });
  assert.deepEqual(found, [['clips[0].cover', 'a.webp'], ['clips[0].video', 'a.mp4'], ['clips[1].cover', 'b.webp']]);
});
