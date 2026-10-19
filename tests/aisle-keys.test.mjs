// Where an arrow key goes in the aisle (wall/aisle-keys.mjs): the rack walks as a
// U that matches the screen, rows change on one wall, Page keys change rack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aisleMove } from '../wall/aisle-keys.mjs';

// A wall's columns, each with `rows` places, filled from the top.
const wall = (rack, side, heights) => heights.map((rows, column) => Array.from({ length: rows }, (_, row) => ({ rack, side, column, row })));
const racks = [
  { visible: true, grid: { [-1]: wall(0, -1, [8, 3]), [1]: wall(0, 1, [8, 2]) } },
  { visible: false, grid: { [-1]: wall(1, -1, [8]), [1]: wall(1, 1, [8]) } },
  { visible: true, grid: { [-1]: wall(2, -1, [3]), [1]: [] } },
];
const at = (rack, side, column, row) => racks[rack].grid[side][column][row];
const go = (from, direction) => { const p = aisleMove(racks, from, direction); return p && [p.rack, p.side, p.column, p.row]; };

test('→ walks the rack as a U: deeper along the left wall, across the far end, back along the right', () => {
  assert.deepEqual(go(at(0, -1, 0, 5), 'right'), [0, -1, 1, 2], 'into a short column at the nearest row above');
  assert.deepEqual(go(at(0, -1, 1, 2), 'right'), [0, 1, 1, 1], 'past the deepest column, across to the far end of the right wall');
  assert.deepEqual(go(at(0, 1, 1, 1), 'right'), [0, 1, 0, 1], 'back toward the entrance along the right wall');
  assert.equal(go(at(0, 1, 0, 1), 'right'), null, 'the U ends at the right wall\'s front');
});

test('← runs the U backwards and ends at the left wall\'s front', () => {
  assert.deepEqual(go(at(0, 1, 0, 4), 'left'), [0, 1, 1, 1]);
  assert.deepEqual(go(at(0, 1, 1, 1), 'left'), [0, -1, 1, 1], 'across the far end to the left wall');
  assert.deepEqual(go(at(0, -1, 1, 1), 'left'), [0, -1, 0, 1]);
  assert.equal(go(at(0, -1, 0, 1), 'left'), null);
});

test('↑ and ↓ change row on the same wall and stop at the column\'s ends', () => {
  assert.deepEqual(go(at(0, -1, 0, 3), 'up'), [0, -1, 0, 2]);
  assert.deepEqual(go(at(0, -1, 0, 3), 'down'), [0, -1, 0, 4]);
  assert.equal(go(at(0, -1, 0, 0), 'up'), null, 'top row');
  assert.equal(go(at(0, -1, 1, 2), 'down'), null, 'a short column ends early');
});

test('Page Up and Page Down change rack, skip hidden racks and keep wall, row and column where they can', () => {
  assert.deepEqual(go(at(0, -1, 0, 6), 'away'), [2, -1, 0, 2], 'the hidden rack is skipped; row clamps into a short column');
  assert.deepEqual(go(at(0, 1, 1, 1), 'away'), [2, -1, 0, 1], 'a rack with an empty right wall takes the left');
  assert.deepEqual(go(at(2, -1, 0, 1), 'toward'), [0, -1, 0, 1]);
  assert.equal(go(at(0, -1, 0, 0), 'toward'), null, 'first rack');
  assert.equal(go(at(2, -1, 0, 0), 'away'), null, 'last rack');
});

test('every place in a rack is reachable from any other by arrows alone', () => {
  const places = Object.values(racks[0].grid).flatMap(cols => cols.flat());
  for (const start of places) {
    const seen = new Set([start]), queue = [start];
    while (queue.length) { const p = queue.shift(); for (const d of ['right', 'left', 'up', 'down']) { const q = aisleMove(racks, p, d); if (q && !seen.has(q)) { seen.add(q); queue.push(q); } } }
    assert.equal(seen.size, places.length, `from ${[start.side, start.column, start.row]}`);
  }
});
