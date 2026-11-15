// The mountain: a slope the order climbs (wall/float-space.mjs, "Mountain").
// Pure layout and stepping here; the view's hover lift and travel along the
// slope are in tests/float-view.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, mountainStep, isOrdered, ARRANGEMENTS, MOUNTAIN_TILT, MOUNTAIN_BACK, WORLD } from '../wall/float-space.mjs';

const clips = Array.from({ length: 180 }, (_, i) => ({ title: `Item ${i}`, props: { dims: i % 3 ? '1600x900' : '800x1000' } }));
const at = (layout, i) => ({ x: layout.positions[i * 3], y: layout.positions[i * 3 + 1], z: layout.positions[i * 3 + 2], w: layout.sizes[i * 2], h: layout.sizes[i * 2 + 1] });
const TAN = Math.tan(MOUNTAIN_TILT * Math.PI / 180);

test('Mountain is an ordered arrangement: priority first, then collection order, every item once', () => {
  assert.ok(ARRANGEMENTS.includes('mountain')); assert.ok(isOrdered('mountain') && isOrdered('cloud') && !isOrdered('sphere'));
  const layout = arrange(clips, 'mountain', { priority: [7, 3, 7, 999, -1, 3.5, 11] });
  assert.equal(layout.arrangement, 'mountain');
  assert.deepEqual(layout.order.slice(0, 5), [7, 3, 11, 0, 1], 'priority leads, repeats and nonsense dropped');
  assert.deepEqual([...layout.order].sort((a, b) => a - b), [...clips.keys()]);
  assert.equal(layout.unplaced, 0); assert.ok([...layout.positions].every(Number.isFinite));
  assert.deepEqual(layout.mountain.rows.flat(), layout.order, 'the rows read front to back, left to right, in the order');
});

test('Mountain rows are justified: one height, side by side without overlap, inside the slope', () => {
  const layout = arrange(clips, 'mountain'), { rows, width } = layout.mountain;
  assert.ok(rows.length >= 4, `${rows.length} rows`);
  rows.forEach((row, r) => {
    const cards = row.map(i => at(layout, i));
    for (const c of cards) {
      assert.ok(Math.abs(c.h - cards[0].h) < 1e-3 && Math.abs(c.y - cards[0].y) < 1e-3 && Math.abs(c.z - cards[0].z) < 1e-3, `row ${r} stands on one line`);
      assert.ok(c.x - c.w / 2 >= -width / 2 - 1e-2 && c.x + c.w / 2 <= width / 2 + 1e-2, `row ${r} stays on the slope`);
    }
    for (let k = 1; k < cards.length; k++) assert.ok(cards[k].x - cards[k].w / 2 > cards[k - 1].x + cards[k - 1].w / 2, `row ${r}: no overlap at ${k}`);
    // Every row but a short last one fills the width.
    if (r < rows.length - 1) assert.ok(Math.abs(cards.at(-1).x + cards.at(-1).w / 2 - width / 2) < 1e-2 && Math.abs(cards[0].x - cards[0].w / 2 + width / 2) < 1e-2, `row ${r} fills the width`);
  });
});

test('Mountain climbs: each row is further back and higher, the back rows are shorter, and every card stands on the slope', () => {
  const layout = arrange(clips, 'mountain'), { rows } = layout.mountain;
  const first = rows.map(row => at(layout, row[0]));
  for (let r = 1; r < first.length; r++) {
    assert.ok(first[r].z < first[r - 1].z, `row ${r} is further back`);
    assert.ok(first[r].y - first[r].h / 2 > first[r - 1].y - first[r - 1].h / 2, `row ${r} stands higher`);
    // Far enough up the slope that the row in front cannot stand in it.
    assert.ok(first[r - 1].z - first[r].z > first[r - 1].h * Math.cos(MOUNTAIN_TILT * Math.PI / 180) * 0.99, `row ${r} clears the row in front`);
  }
  assert.ok(first[0].h > first.at(-2).h * 1.8, `the front row (${first[0].h.toFixed(0)}) is much taller than a back row (${first.at(-2).h.toFixed(0)})`);
  assert.ok(MOUNTAIN_BACK < 0.5);
  for (const i of clips.keys()) { const c = at(layout, i); assert.ok(Math.abs((c.y - c.h / 2) + c.z * TAN) < 1e-2, `item ${i} stands on the slope`); }
  // The slope's own direction, for a view that travels along it.
  const [ux, uy, uz] = layout.mountain.up; assert.ok(ux === 0 && uy > 0 && uz < 0 && Math.abs(Math.hypot(uy, uz) - 1) < 1e-9);
});

test('Mountain fits a large collection on the slope by shrinking its rows', () => {
  const many = Array.from({ length: 2500 }, (_, i) => ({ title: `Item ${i}` }));
  const layout = arrange(many, 'mountain'), small = arrange(clips.slice(0, 12), 'mountain');
  assert.ok(layout.mountain.depth <= WORLD * 1.4 + 1e-6, `2,500 items use ${layout.mountain.depth.toFixed(0)} of the slope`);
  assert.ok(layout.mountain.depth > WORLD, 'and most of it');
  assert.ok(small.mountain.depth < layout.mountain.depth, 'a dozen items do not stretch to fill it');
  assert.equal(arrange([], 'mountain').positions.length, 0);
  const one = arrange([{ title: 'Only' }], 'mountain'); assert.deepEqual(one.mountain.rows, [[0]]); assert.ok([...one.positions].every(Number.isFinite));
});

test('mountainStep walks a row sideways and the rows front to back, landing nearest across', () => {
  const layout = arrange(clips, 'mountain'), { rows } = layout.mountain;
  const row = rows[2], mid = row[Math.floor(row.length / 2)];
  assert.equal(mountainStep(layout, mid, 'right'), row[row.indexOf(mid) + 1]);
  assert.equal(mountainStep(layout, mid, 'left'), row[row.indexOf(mid) - 1]);
  assert.equal(mountainStep(layout, row[0], 'left'), -1); assert.equal(mountainStep(layout, row.at(-1), 'right'), -1);
  const nearest = (members, x) => members.reduce((a, b) => Math.abs(at(layout, b).x - x) < Math.abs(at(layout, a).x - x) ? b : a);
  assert.equal(mountainStep(layout, mid, 'away'), nearest(rows[3], at(layout, mid).x));
  assert.equal(mountainStep(layout, mid, 'toward'), nearest(rows[1], at(layout, mid).x));
  assert.equal(mountainStep(layout, rows[0][0], 'toward'), -1, 'nothing in front of the front row');
  assert.equal(mountainStep(layout, rows.at(-1)[0], 'away'), -1, 'nothing behind the back row');
  // Items out of scope are stepped over: a whole row of them is passed.
  const closed = new Set(rows[3]);
  assert.equal(mountainStep(layout, mid, 'away', i => !closed.has(i)), nearest(rows[4], at(layout, mid).x));
  const next = row[row.indexOf(mid) + 1];
  assert.equal(mountainStep(layout, mid, 'right', i => i !== next), row[row.indexOf(mid) + 2]);
  assert.equal(mountainStep(layout, mid, 'up'), -1); assert.equal(mountainStep(arrange(clips, 'cloud'), 0, 'away'), -1, 'only a mountain has rows');
});
