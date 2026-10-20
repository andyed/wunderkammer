import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TIMING, RACK_BUDGET, warehouseRows, warehouseFrame } from '../wall/warehouse.mjs';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const entry = { position: [-.39, 4.08, 3.9], target: [0, 4.16, -6.1] };
const scene = { entry, gap: 8.7, gapSpread: 10.8, height: 8.32 };

test('every rack of the aisle appears once as itself; copies fill five lanes within the budget', () => {
  const rows = warehouseRows({ racks: 12, depth: 21, gap: 8.7 });
  const real = rows.filter(row => row.real);
  assert.deepEqual(real.map(row => row.rack), [...Array(12).keys()], 'the aisle\'s own racks, once each');
  assert.ok(real.every(row => row.lane === 0 && row.copy === 0 && row.x === 0 && row.z === 0), 'the aisle\'s racks land where the aisle keeps them');
  assert.deepEqual([...new Set(rows.map(row => row.lane))].sort((a, b) => a - b), [-2, -1, 0, 1, 2]);
  assert.ok(rows.length > 12 && rows.length <= RACK_BUDGET, `${rows.length} racks`);
  assert.ok(rows.every(row => row.start >= .1 && row.start < 3), 'every rack has left by 3 s');
  // A rack never shares a place with another.
  const places = rows.map(row => `${row.x},${row.z},${row.rack}`);
  assert.equal(new Set(places).size, places.length);
});

test('a large aisle sheds copies and outer rows before the side rows, and never its own racks', () => {
  const wide = warehouseRows({ racks: 40, depth: 160, gap: 8.7 });
  assert.ok(wide.length <= RACK_BUDGET);
  assert.deepEqual([...new Set(wide.map(row => row.lane))].sort((a, b) => a - b), [-1, 0, 1]);
  const huge = warehouseRows({ racks: 400, depth: 900, gap: 8.7 });
  assert.equal(huge.length, 400, 'only the aisle itself flies in');
  assert.ok(huge.every(row => row.real));
  for (const bad of [{ racks: 0, depth: 10, gap: 8 }, { racks: 3, depth: 0, gap: 8 }, { racks: 3, depth: 10, gap: NaN }, { racks: 2.5, depth: 10, gap: 8 }])
    assert.deepEqual(warehouseRows(bad), []);
});

test('the show opens on a white void, ends on the aisle as it opens, and the copies sink out of sight', () => {
  const rows = warehouseRows({ racks: 12, depth: 21, gap: 8.7 });
  const first = warehouseFrame(0, rows, scene);
  assert.ok(first.racks.every((r, i) => near(r.z, rows[i].z - TIMING.far)), 'every rack starts far down the hall');
  assert.equal(first.light, 1); assert.equal(first.caption.name, 1); assert.equal(first.caption.lots, 0);
  assert.equal(first.gap, scene.gapSpread);
  assert.ok(first.position[1] > entry.position[1] + 9, 'the camera starts high above the entrance');

  const landed = Math.max(...rows.map(row => row.start)) + TIMING.fly;
  const locked = warehouseFrame(Math.max(landed, TIMING.drop), rows, scene);
  assert.ok(locked.racks.every((r, i) => near(r.x, rows[i].x) && near(r.z, rows[i].z) && r.y === 0), 'every rack locks into its place');
  assert.equal(locked.gap, scene.gap);
  assert.deepEqual(locked.position, entry.position); assert.deepEqual(locked.target, entry.target);
  assert.ok(warehouseFrame(2, rows, scene).caption.lots === 1, '"Lots of …" is up while the rows lock');

  const end = warehouseFrame(TIMING.end, rows, scene);
  assert.equal(end.done, true); assert.equal(end.light, 0);
  assert.equal(end.caption.name, 0); assert.equal(end.caption.lots, 0);
  end.racks.forEach((r, i) => assert.equal(r.y, rows[i].real ? 0 : -(scene.height + 1), 'copies below the floor, the aisle\'s racks on it'));
  assert.deepEqual(end.position, entry.position);

  let light = 1;
  for (let t = 0; t <= TIMING.end; t += 1 / 30) {
    const f = warehouseFrame(t, rows, scene);
    assert.ok(f.light <= light + 1e-12, `the lights only go down (t=${t})`); light = f.light;
    assert.ok(f.fog.near < f.fog.far);
    assert.ok(f.caption.name >= 0 && f.caption.name <= 1 && f.caption.lots >= 0 && f.caption.lots <= 1);
    assert.ok(!(f.caption.name > 0 && f.caption.lots > 0), 'one caption at a time');
  }
  assert.deepEqual(warehouseFrame(NaN, rows, scene).racks, first.racks, 'a bad time is the first frame');
});
