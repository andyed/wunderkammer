// The sphere: Fibonacci seats (sphereSlots), the card orientation that lays a
// card on the surface (faceQuaternion), the link shape (validSphere), and the
// Sphere arrangement's claim that latitude is lightness order and longitude hue
// order. Pure functions from wall/float-space.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, sphereSlots, faceQuaternion, sphereRadius, seatGap, validSphere, oklab, oklch, parseHex, GREY_CHROMA, MAX_CAP, SEAT_GAP, SPHERE_FILL } from '../wall/float-space.mjs';

/** Rotate v by unit quaternion q = [x, y, z, w]: v + 2w(u × v) + 2u × (u × v). */
function rotate(q, v) {
  const [x, y, z, w] = q, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const t = cross([x, y, z], v).map(c => 2 * c), u = cross([x, y, z], t);
  return [0, 1, 2].map(k => v[k] + w * t[k] + u[k]);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const at = (array, i, size) => Array.from(array.subarray(i * size, i * size + size));
const minGap = positions => {
  const n = positions.length / 3; let min = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(...[0, 1, 2].map(k => positions[i * 3 + k] - positions[j * 3 + k])));
  return min;
};

test('faceQuaternion turns a card face to the direction asked, top toward up, as a proper rotation', () => {
  assert.deepEqual(faceQuaternion([0, 0, 1]), [0, 0, 0, 1], 'a card already facing +z is not turned');
  for (const dir of [[0, 0, -1], [1, 0, 0], [-0.3, 0.5, 0.8], [0, 1, 0], [0, -1, 0], [0.001, -1, 0]]) {
    const q = faceQuaternion(dir), len = Math.hypot(...dir);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9, `unit quaternion for ${dir}`);
    rotate(q, [0, 0, 1]).forEach((c, k) => assert.ok(Math.abs(c - dir[k] / len) < 1e-9, `face along ${dir}`));
    // Right-handed: the turned x × y is the turned z, so the image is not mirrored.
    const x = rotate(q, [1, 0, 0]), y = rotate(q, [0, 1, 0]), z = rotate(q, [0, 0, 1]);
    assert.ok(Math.abs(dot([x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], z) - 1) < 1e-9, `proper rotation for ${dir}`);
    if (Math.abs(dir[1] / len) < 0.99) assert.ok(rotate(q, [0, 1, 0])[1] > 0, `top leans up for ${dir}`);
  }
  assert.deepEqual(faceQuaternion([0, 0, 0]), [0, 0, 0, 1], 'no direction, no turn');
});

test('sphereSlots seats n cards evenly on the sphere, outside the cap, each lying on the surface', () => {
  for (const [n, cap] of [[1, 0], [12, 0], [297, 0], [297, 60], [500, 120]]) {
    const radius = 700, centre = [10, -20, 30], { positions, quaternions, normals } = sphereSlots(n, { radius, cap, centre });
    assert.equal(positions.length, n * 3); assert.equal(quaternions.length, n * 4); assert.equal(normals.length, n * 3);
    for (let k = 0; k < n; k++) {
      const p = at(positions, k, 3), u = at(normals, k, 3), d = p.map((v, j) => v - centre[j]);
      assert.ok(Math.abs(Math.hypot(...d) - radius) < 1e-2, `seat ${k} is on the sphere`);
      d.forEach((v, j) => assert.ok(Math.abs(v / radius - u[j]) < 1e-5, `normal ${k} points from the centre`));
      // The cap: no seat within `cap` degrees of +z, the axis the camera looks along.
      assert.ok(u[2] <= Math.cos(cap * Math.PI / 180) + 1e-6, `seat ${k} is outside the ${cap}° opening`);
      const face = rotate(at(quaternions, k, 4), [0, 0, 1]);
      assert.ok(dot(face, u) > 0.99999, `card ${k} faces out`);
    }
    // Evenly spread: no two seats closer than the lattice's measured minimum.
    if (n > 1) assert.ok(minGap(positions) >= seatGap(n, radius, cap) - 1e-3, `${n} seats, ${cap}° cap: min gap ${minGap(positions)} vs ${seatGap(n, radius, cap)}`);
  }
  const inward = sphereSlots(40, { facing: 'in', cap: 45 });
  for (let k = 0; k < 40; k++) assert.ok(dot(rotate(at(inward.quaternions, k, 4), [0, 0, 1]), at(inward.normals, k, 3)) < -0.99999, `card ${k} faces in`);
  // Another axis: the opening looks up.
  const up = sphereSlots(60, { cap: 50, axis: [0, 1, 0], up: [0, 0, -1] });
  for (let k = 0; k < 60; k++) assert.ok(up.normals[k * 3 + 1] <= Math.cos(50 * Math.PI / 180) + 1e-6, 'no seat inside an opening along +y');
  assert.deepEqual(sphereSlots(5), sphereSlots(5), 'the same seats on every call');
  assert.equal(sphereSlots(0).positions.length, 0); assert.equal(sphereSlots(-3).positions.length, 0); assert.equal(sphereSlots(NaN).positions.length, 0);
});

test('sphereRadius gives the cards SPHERE_FILL of the surface left by the cap', () => {
  const area = 297 * 100 * 100;
  for (const cap of [0, 60, 90]) {
    const r = sphereRadius(area, cap), surface = 2 * Math.PI * r * r * (1 + Math.cos(cap * Math.PI / 180));
    assert.ok(Math.abs(area / surface - SPHERE_FILL) < 1e-9, `${cap}° cap`);
  }
  assert.equal(sphereRadius(-5), 0);
  assert.ok(Math.abs(seatGap(100, 10) - SEAT_GAP) < 1e-12, 'the gap scales as R / √n');
});

test('validSphere takes a facing and a whole-degree cap up to MAX_CAP, nothing else', () => {
  for (const ok of [{}, { facing: 'out' }, { facing: 'in' }, { cap: 0 }, { cap: MAX_CAP }, { facing: 'in', cap: 60 }]) assert.ok(validSphere(ok), JSON.stringify(ok));
  for (const bad of [null, [], 'in', { facing: 'sideways' }, { cap: -1 }, { cap: MAX_CAP + 1 }, { cap: 12.5 }, { cap: '60' }, { cap: NaN }, { facing: 'in', spin: 1 }, { ['__proto__']: 1 }])
    assert.equal(validSphere(bad), false, JSON.stringify(bad));
});

// A colour fixture: every combination of lightness step and hue, plus greys and one item with no palette.
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
function hsl2rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const clips = [];
for (const l of [0.2, 0.35, 0.5, 0.65, 0.8]) for (let h = 0; h < 360; h += 15) clips.push({ title: `h${h} l${l}`, palette: [hex(hsl2rgb(h, 0.8, l))], props: { dims: ['1920x1080'] } });
for (const g of [0.1, 0.3, 0.5, 0.7, 0.9]) clips.push({ title: `grey ${g}`, palette: [hex([g, g, g])], props: { dims: ['160x120'] } });
clips.push({ title: 'Unpainted', props: { dims: ['120x120'] } });
const lch = clips.map(c => c.palette ? oklch(oklab(parseHex(c.palette[0]))) : null);

test('Sphere places items by lightness from the top down and by hue around, in bands, greys first', () => {
  for (const sphere of [undefined, { facing: 'in', cap: 60 }]) {
    const layout = arrange(clips, 'sphere', { sphere }), n = clips.length, { radius, bands, hueCut, facing } = layout.sphere;
    assert.equal(layout.arrangement, 'sphere'); assert.equal(facing, sphere?.facing ?? 'out');
    assert.equal(layout.order.length, n); assert.deepEqual([...layout.order].sort((a, b) => a - b), [...Array(n).keys()], 'order holds every item once');
    const placed = [...Array(n).keys()].filter(i => lch[i]);
    for (const i of placed) {
      const p = at(layout.positions, i, 3), face = rotate(at(layout.rotations, i, 4), [0, 0, 1]);
      assert.ok(Math.abs(Math.hypot(...p) - radius) < 1e-2, `${clips[i].title} is on the sphere`);
      assert.ok(dot(face, p.map(v => v / radius)) * (facing === 'in' ? -1 : 1) > 0.99999, `${clips[i].title} faces ${facing}`);
      if (sphere?.cap) assert.ok(p[2] / radius <= Math.cos(sphere.cap * Math.PI / 180) + 1e-6, `${clips[i].title} is outside the opening`);
    }
    // Reading order walks the bands from the top, each around from the seam. Band b holds the
    // placed items from round(b·m / bands) to round((b + 1)·m / bands) in that order.
    const order = layout.order.filter(i => lch[i]), m = order.length;
    const rings = [...Array(bands).keys()].map(b => order.slice(Math.round(b * m / bands), Math.round((b + 1) * m / bands)));
    assert.ok(bands >= 3, `${bands} bands`);
    const seam = facing === 'in' ? 1 : -1;
    const around = i => (Math.atan2(-layout.positions[i * 3], seam * layout.positions[i * 3 + 2]) + 2 * Math.PI) % (2 * Math.PI);
    const hueKey = i => lch[i][1] < GREY_CHROMA ? -1 : (lch[i][2] - hueCut + 360) % 360;
    const y = i => layout.positions[i * 3 + 1];
    rings.forEach((ring, b) => {
      // Latitude is lightness order: each band is lighter, and sits higher, than every band below it.
      if (b + 1 < bands) {
        const next = rings[b + 1];
        assert.ok(Math.min(...ring.map(i => lch[i][0])) >= Math.max(...next.map(i => lch[i][0])), `band ${b} is lighter than band ${b + 1}`);
        assert.ok(Math.min(...ring.map(y)) >= Math.max(...next.map(y)) - 1e-3, `band ${b} sits above band ${b + 1}`);
      }
      // Longitude is hue order: around the band from the seam, hue from hueCut rises, greys first.
      for (let r = 1; r < ring.length; r++) {
        assert.ok(around(ring[r]) > around(ring[r - 1]), `band ${b} runs around from the seam`);
        assert.ok(hueKey(ring[r]) >= hueKey(ring[r - 1]), `hue order around band ${b} at ${clips[ring[r]].title}`);
      }
    });
    assert.ok(rings[0].every(i => lch[i][0] >= lch[rings.at(-1)[0]][0]), 'the top is lighter than the bottom');
    // The item without a palette waits on a shelf below the sphere, facing the camera.
    const shelf = clips.findIndex(c => !c.palette);
    assert.ok(layout.positions[shelf * 3 + 1] < -radius, 'no palette waits below');
    assert.deepEqual(at(layout.rotations, shelf, 4), [0, 0, 0, 1]);
    assert.ok(layout.labels.some(l => l.text === 'No palette · 1'));
    assert.ok(layout.labels.some(l => /^L \d\.\d\d · lightest$/.test(l.text)) && layout.labels.some(l => /· darkest$/.test(l.text)));
    assert.ok(layout.labels.some(l => l.text === `around · OKLCH hue from ${hueCut}° · greys first`));
    // Cards clear their nearest neighbour side by side: the radius grows for them.
    const seats = new Float32Array(placed.flatMap(i => at(layout.positions, i, 3)));
    const widest = Math.max(...placed.map(i => layout.sizes[i * 2]));
    assert.ok(minGap(seats) >= widest, `nearest seats ${minGap(seats)} apart, widest card ${widest}`);
    // The sphere grows for its cards; it does not shrink them. Nine in ten keep a tile's area.
    const kept = placed.filter(i => Math.abs(layout.sizes[i * 2] * layout.sizes[i * 2 + 1] / layout.edge ** 2 - 1) < 1e-3).length;
    assert.ok(kept >= 0.9 * placed.length, `${kept} of ${placed.length} cards keep their area`);
  }
});

test('Sphere with no palettes at all shelves every item and still returns a layout', () => {
  const layout = arrange([{ title: 'A' }, { title: 'B' }], 'sphere');
  assert.equal(layout.unplaced, 2); assert.equal(layout.order.length, 2);
  assert.ok([...layout.positions].every(Number.isFinite));
  assert.ok(arrange([], 'sphere').positions.length === 0);
});
