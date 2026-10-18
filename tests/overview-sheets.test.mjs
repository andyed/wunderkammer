import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OverviewSheets } from '../wall/overview-sheets.mjs';

const sheets = [
  { src: '/s32.webp', edge: 32, width: 72, height: 36 },
  { src: '/s64.webp', edge: 64, width: 136, height: 68 },
  { src: '/s128a.webp', edge: 128, width: 132, height: 132 },
  { src: '/s128b.webp', edge: 128, width: 132, height: 132 },
];
const clips = [
  { cover: 'a', sheetSlots: [[0, 2, 2, 32, 30], [1, 2, 2, 64, 60], [2, 2, 2, 128, 120]] },
  { cover: 'b', sheetSlots: [[0, 38, 2, 20, 32], [1, 70, 2, 40, 64], [3, 2, 2, 80, 128]] },
  { cover: 'c' },
  { cover: 'd', sheetSlots: [[0, 70, 2, 32, 32]] }, // runs off its page: refused
];
const tick = () => new Promise(r => setTimeout(r, 0));

function harness(options = {}) {
  const loads = [];
  const fail = new Set(options.fail || []);
  const sheetSet = new OverviewSheets({ ...options, loadPage: async src => { loads.push(src); if (fail.has(src)) throw new Error('404'); return { src, close() { this.closed = true; } }; } });
  sheetSet.setCorpus(sheets, clips);
  return { sheetSet, loads };
}

test('levels load coarse first and only as far as a draw needs', async () => {
  const { sheetSet, loads } = harness();
  assert.equal(sheetSet.slot('a', 50), null, 'nothing is drawable before a page decodes');
  sheetSet.ensure(54);
  await tick(); await tick();
  assert.deepEqual(loads, ['/s32.webp', '/s64.webp'], 'the 32 px level first, then the 64 px level a 54 px draw wants');
  assert.equal(sheetSet.slot('a', 54).edge, 64);
  assert.equal(sheetSet.slot('a', 20).edge, 32, 'a smaller draw uses the smaller level');
  assert.equal(sheetSet.slot('c', 20), null);
  assert.equal(sheetSet.slot('d', 20), null, 'an out-of-bounds slot is dropped');
  sheetSet.ensure(200);
  await tick(); await tick();
  assert.deepEqual(loads.slice(2).sort(), ['/s128a.webp', '/s128b.webp']);
  assert.deepEqual(sheetSet.slot('b', 200), { image: sheetSet.pages[3].image, x: 2, y: 2, w: 80, h: 128, edge: 128 });
});

test('covers promises at most 2x upsampling, from levels inside the pixel budget', () => {
  const { sheetSet } = harness({ maxPixels: 72 * 36 + 136 * 68 });
  assert.equal(sheetSet.levels.map(l => l.allowed).join(), 'true,true,false');
  assert.equal(sheetSet.covers('a', 128), true, '64 px level, 2x');
  assert.equal(sheetSet.covers('a', 129), false, 'the 128 px level is over budget');
  assert.equal(sheetSet.covers('c', 10), false);
  const tight = harness({ maxPixels: 1 }).sheetSet;
  assert.equal(tight.levels[0].allowed, true, 'the smallest level is always admitted');
  assert.equal(tight.covers('a', 64), true);
  assert.equal(tight.covers('a', 65), false);
});

test('a failed page withdraws its level so the wall falls back to files', async () => {
  const changes = [];
  const { sheetSet } = harness({ fail: ['/s32.webp'], onChange: level => changes.push(level.state) });
  assert.equal(sheetSet.covers('a', 40), true);
  sheetSet.ensure(40);
  await tick(); await tick();
  assert.deepEqual(changes, ['failed', 'ready'], 'the failed level, then the next one it starts');
  assert.equal(sheetSet.covers('a', 20), true, 'the next level up still covers small draws');
  sheetSet.ensure(20); await tick(); await tick();
  assert.equal(sheetSet.slot('a', 20).edge, 64);
});

test('a failed level starts the next one without waiting for the camera', async () => {
  const { sheetSet, loads } = harness({ fail: ['/s32.webp'] });
  sheetSet.ensure(20);
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(loads, ['/s32.webp', '/s64.webp'], 'no second ensure() was needed');
  assert.equal(sheetSet.slot('a', 20).edge, 64);
  const none = harness({ fail: sheets.map(s => s.src) });
  none.sheetSet.ensure(20);
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(none.sheetSet.covers('a', 20), false, 'with every level failed, nothing is promised and the files load');
});

test('an unchanged page list keeps its decoded pages; a new one releases them', async () => {
  const { sheetSet, loads } = harness();
  sheetSet.ensure(10); await tick(); await tick();
  const page = sheetSet.pages[0].image;
  sheetSet.setCorpus(sheets, clips.slice(0, 1));
  assert.equal(sheetSet.slot('a', 10).image, page);
  assert.equal(sheetSet.slot('b', 10), null, 'slots follow the clips given');
  sheetSet.ensure(10); await tick();
  assert.equal(loads.length, 1);
  sheetSet.setCorpus(sheets.slice(1), []);
  assert.equal(page.closed, true);
  assert.equal(sheetSet.available, false);
});
