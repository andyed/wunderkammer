// The floating space's keyboard path: which item an arrow reaches, and how the
// callout describes where an item sits. Pure functions from wall/float-space.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestAlong, describeItem, hueName, attributeAxis } from '../wall/float-space.mjs';

test('nearestAlong walks the row: the next item along the axis that stays close on the others', () => {
  // 0 at the origin; 1 a little to the right but far above; 2 further right on the row; 3 to the left.
  const P = new Float64Array([0, 0, 0, 10, 100, 0, 60, 0, 0, -40, 0, 0]);
  assert.equal(nearestAlong(P, [0, 1, 2, 3], 0, 0, 1), 2, 'stays on the row rather than leaping to the item far above');
  assert.equal(nearestAlong(P, [0, 1, 2, 3], 0, 0, -1), 3);
  assert.equal(nearestAlong(P, [0, 1, 2, 3], 2, 0, 1), -1, 'nothing further right');
  assert.equal(nearestAlong(P, [0, 2, 3], 0, 1, 1), -1, 'only candidates count');
  assert.equal(nearestAlong(P, [0, 1, 2, 3], 0, 1, 1), 1, 'up reaches the item above');
});

test('hueName names the nearest OKLCH hue the axis labels use', () => {
  assert.equal(hueName(142), 'green'); assert.equal(hueName(20), 'red'); assert.equal(hueName(350), 'magenta'); assert.equal(hueName(250), 'blue');
});

test('describeItem says where an item sits in the arrangement\'s own terms', () => {
  const clips = [
    { title: 'Leaf', palette: ['#00ff00'], captured: '2026-04-11T08:00:00Z' },
    { title: '2026-04-12 · 09:00:00', palette: ['#808080'], captured: '2026-04-12T09:00:00Z' },
    { title: 'Blank', captured: '2026-04-13T10:00:00Z' },
  ];
  assert.deepEqual(describeItem(clips[0], 'oklch'), { short: ['L 0.87', 'green', 'C 0.29'], spoken: 'lightness 0.87, hue green, chroma 0.29' });
  assert.deepEqual(describeItem(clips[1], 'oklab').short, ['L 0.60', 'grey', 'C 0.00'], 'a grey has no hue');
  assert.deepEqual(describeItem(clips[2], 'hsl').short, ['no palette']);
  assert.deepEqual(describeItem({ title: 'Éclair' }, 'az').short, ['shelf E']);
  const model = attributeAxis(clips, 'captured').model, axes = { across: 'captured', up: 'lightness', depth: 'hue' };
  assert.deepEqual(describeItem(clips[0], 'axes', { axes, modelFor: id => id === 'captured' ? model : null }),
    { short: ['2026-04-11', 'L 0.87', 'green'], spoken: 'capture date 2026-04-11, lightness 0.87, hue green' });
  assert.deepEqual(describeItem(clips[1], 'axes', { axes, modelFor: () => model }).short, ['L 0.60', 'grey'], 'a reading the title already starts with is said once');
});
