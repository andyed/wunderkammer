import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpriteCovers, spriteSource, isSpriteSource } from '../wall/sprite-covers.mjs';
import { overviewSource } from '../wall/overview-surface.mjs';

// Pages are fake images; canvases record what was drawn from where.
const sheets = [
  { src: 'p64', edge: 64, width: 140, height: 40 },
  { src: 'p160', edge: 160, width: 330, height: 100 },
  { src: 'p480a', edge: 480, width: 484, height: 274 },
  { src: 'p480b', edge: 480, width: 484, height: 274 },
];
const clips = [
  { id: 'a', sheetSlots: [[0, 2, 2, 64, 36], [1, 2, 2, 160, 90], [2, 2, 2, 480, 270]] },
  { id: 'b', url: 'urn:x:b', sheetSlots: [[0, 70, 2, 64, 36], [1, 166, 2, 160, 90], [3, 2, 2, 480, 270]] },
  // Its own cover file serves the reading tiers; cells would serve only the overview.
  { id: 'c', cover: 'c.webp', sheetSlots: [[0, 2, 2, 64, 36]] },
  { id: 'd', sheetSlots: [[0, 100, 2, 64, 36]] }, // runs off its page: dropped
];
function harness({ fail = new Set(), maxPixels, covers: role = false, extra = [] } = {}) {
  const loads = [], draws = [], encodes = [], closed = [];
  let urls = 0;
  const covers = new SpriteCovers({
    ...(maxPixels ? { maxPixels } : {}),
    loadPage: async src => { loads.push(src); if (fail.has(src)) throw new Error('404'); return { src, close: () => closed.push(src) }; },
    createCanvas: (w, h) => ({ width: w, height: h, getContext: () => ({ drawImage: (img, ...a) => draws.push([img.src, ...a]) }) }),
    encode: async canvas => { encodes.push([canvas.width, canvas.height]); return { type: 'image/webp' }; },
    createUrl: () => `blob:cell-${++urls}`, revokeUrl: () => {},
  });
  covers.setCorpus(sheets, [...clips, ...extra], { covers: role });
  return { covers, loads, draws, encodes, closed };
}

test('by default only clips without a cover file are read from cells; "covers" takes the rest', () => {
  const { covers } = harness();
  assert.equal(covers.has(clips[0]), true);
  assert.equal(covers.has(clips[1]), true);
  assert.equal(covers.has(clips[2]), false, 'its cells feed only the overview; the file serves every other view');
  assert.equal(covers.has(clips[3]), false, 'a cell outside its page is refused');
  assert.equal(covers.maxEdge(clips[1]), 480);
  assert.equal(harness({ covers: true }).covers.has(clips[2]), true, 'images.sheets "covers": cells first, the file as fallback');
});

test('a draw takes the smallest level that holds it, else the largest', () => {
  const { covers } = harness();
  assert.equal(covers.cellFor(clips[0], 40).edge, 64);
  assert.equal(covers.cellFor(clips[0], 64).edge, 64);
  assert.equal(covers.cellFor(clips[0], 65).edge, 160);
  assert.equal(covers.cellFor(clips[0], 300).edge, 480);
  assert.equal(covers.cellFor(clips[0], 5000).edge, 480);
  assert.equal(covers.cellFor(clips[0]).edge, 480, 'no size asked: the largest');
});

test('a cell becomes one blob URL, cropped from its own rectangle, shared by every caller', async () => {
  const { covers, loads, draws, encodes } = harness();
  const [first, again] = await Promise.all([covers.url(clips[1], 300), covers.url(clips[1], 480)]);
  assert.equal(first, 'blob:cell-1');
  assert.equal(again, first, 'one encode per cell');
  assert.deepEqual(encodes, [[480, 270]]);
  assert.deepEqual(loads, ['p480b']);
  assert.deepEqual(draws, [['p480b', 2, 2, 480, 270, 0, 0, 480, 270]]);
  assert.equal(covers.peekUrl(clips[1]), first);
  assert.equal(await covers.url({ id: 'nobody' }, 64), null);
});

test('a page that fails withdraws its level and the next one serves', async () => {
  const { covers, loads } = harness({ fail: new Set(['p480a']) });
  const url = await covers.url(clips[0], 480);
  assert.ok(url, 'falls back to the 160 px cell');
  assert.deepEqual(loads, ['p480a', 'p160']);
  assert.equal(covers.cellFor(clips[0], 480).edge, 160);
});

test('the synchronous 3D source waits for its page, then crops it', async () => {
  const { covers, draws } = harness();
  assert.equal(covers.source(clips[0], 64), null, 'not decoded yet');
  assert.equal(covers.pages[0].state, 'loading', 'asking started the load');
  await covers.page(0);
  const canvas = covers.source(clips[0], 64);
  assert.deepEqual([canvas.width, canvas.height], [64, 36]);
  assert.deepEqual(draws.at(-1), ['p64', 2, 2, 64, 36, 0, 0, 64, 36]);
});

test('decoded pages stay inside the pixel budget, least recently used first', async () => {
  // Room for the two 480 px pages but not for the 160 px one as well.
  const { covers, closed } = harness({ maxPixels: 484 * 274 * 2 });
  await covers.page(2); await covers.page(3); await covers.page(2);
  await covers.page(1);
  assert.deepEqual(closed, ['p480b']);
  assert.equal(covers.pages[3].state, 'idle', 'an evicted page reloads on demand');
  assert.ok(await covers.url(clips[1], 480), 'and still serves its cells');
});

test('the overview keys a cells-only clip by identity, and a file-backed clip by its file', () => {
  assert.equal(overviewSource(clips[0]), 'sheet:a');
  assert.equal(overviewSource(clips[1]), 'sheet:urn:x:b');
  assert.equal(overviewSource(clips[2]), 'c.webp');
  assert.equal(overviewSource({ id: 'e', media: [{ src: 'e.webp' }] }), 'e.webp');
  assert.equal(spriteSource(clips[1]), 'sheet:urn:x:b');
  assert.ok(isSpriteSource('sheet:a') && !isSpriteSource('c.webp'));
});

test('the overview loader crops a cells-only clip at the size it asks for', async () => {
  const { covers, loads } = harness();
  globalThis.createImageBitmap = undefined;
  const entry = await covers.overviewImage('sheet:urn:x:b', { maxEdge: 96 });
  assert.deepEqual([entry.width, entry.height], [160, 90]);
  assert.deepEqual(loads, ['p160']);
  await assert.rejects(covers.overviewImage('sheet:nobody'));
});

test('a failed page sends a clip with a file back to its file, and a clip without one to another level', async () => {
  // e has a file and cells at 64 and 480; a has no file and cells on every level.
  const e = { id: 'e', cover: 'e.webp', sheetSlots: [[0, 2, 2, 64, 36], [2, 2, 2, 480, 270]] };
  const full = harness({ fail: new Set(['p480a']), covers: true, extra: [e] }).covers;
  assert.equal(full.cellFor(e, 300).edge, 480, 'before it fails, the full-size cell serves');
  assert.equal(await full.coverUrl(e, 300, 'e.webp'), 'e.webp', 'its page failed: the file, not an enlarged 64 px cell');
  assert.equal(full.serves(e, 300), false);
  assert.equal(full.cellFor(clips[0], 480).edge, 160, 'no file: the largest level that loads');
  const small = harness({ fail: new Set(['p64']), covers: true, extra: [e] }).covers;
  await small.page(0);
  assert.equal(small.cellFor(e, 40).edge, 480, 'a larger cell that loads beats the file');
  assert.equal(small.cellFor(clips[0], 40).edge, 160, 'no file: the next level up');
  assert.ok((await small.coverUrl(clips[0], 40, null)).startsWith('blob:'));
});
