import assert from 'node:assert/strict';
import { test } from 'node:test';
import { walkEnd, walkAt, tourAt, cruise } from '../scripts/warehouse-video.mjs';

test('a walk never passes the end of a short aisle, and keeps its pace in a long one', () => {
  // 100 items in five groups of 20: about 12 world units of travel.
  const short = walkEnd({ from: 0, length: 12, seconds: 3 });
  assert.equal(short, .7, 'a short aisle is walked to .7 of its travel, not past the last rack');
  for (let k = 0; k <= 1.0001; k += .01) assert.ok(walkAt(k, { from: 0, to: short }).travel <= .7 + 1e-12);
  assert.equal(walkEnd({ from: 0, length: 200, seconds: 3 }), 4.5 * 3 / 200, 'a long aisle keeps the walking pace');
  assert.equal(walkEnd({ from: .9, length: 12, seconds: 3 }), .9, 'a walk never goes backwards');
  assert.equal(walkEnd({ from: .2, length: 0, seconds: 3 }), .2, 'an aisle with no travel stays put');
  assert.equal(walkAt(1, { from: 0, to: .7 }).turn, 55 * Math.PI / 180, 'it ends turned to the left wall');
});

test('a tour stays inside the hall, reaches its far end, and comes back to where it began', () => {
  const hall = { near: 2, farZ: -15, entry: 3.9, spread: .65, seconds: 30 };
  let deepest = Infinity;
  for (let i = 0; i <= 900; i++) {
    const { z, side, spread } = tourAt(i / 900, hall);
    assert.ok(z <= hall.entry + 1e-9 && z >= hall.farZ - 1e-9, `z ${z} at frame ${i} stays in the hall`);
    assert.ok(Math.abs(side) <= 1 + 1e-12); assert.ok(spread >= .65 - 1e-12 && spread <= 1 + 1e-12);
    deepest = Math.min(deepest, z);
  }
  assert.ok(Math.abs(deepest - hall.farZ) < 1e-9, 'a short hall is toured end to end');
  const end = tourAt(1, hall);
  assert.ok(Math.abs(end.z - hall.near) < 1e-9 && end.side === -1, 'it ends at the entrance, facing the right wall');
  // A hall longer than a steady glide covers is toured part of the way, at that glide.
  const long = { ...hall, farZ: -400 };
  const far = Math.min(...Array.from({ length: 901 }, (_, i) => tourAt(i / 900, long).z));
  assert.ok(Math.abs(far - (2 - 2.5 * .47 * 30)) < 1e-9, `a long hall is toured ${2 - far} units in`);
  assert.equal(cruise(0), 0); assert.equal(cruise(1), 1); assert.ok(Math.abs(cruise(.5) - .5) < 1e-12);
});
