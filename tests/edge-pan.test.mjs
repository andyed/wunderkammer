import test from 'node:test';
import assert from 'node:assert/strict';
import { EdgePan, boundPan } from '../wall/edge-pan.mjs';

const bounds = { x: 0, y: 0, w: 1600, h: 1200 };
const options = { area: { w: 800, h: 600 }, bounds, items: [bounds], point: { x: 400, y: 300 }, zoom: true, maxScale: 6 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('edge zoom latches one anchor, caps growth, and reversal restores pan scale', () => {
  const edge = new EdgePan();
  const start = { x: 24, y: -200, scale: 1 };
  let view = edge.move(start, 20, 0, options);
  assert.equal(view.phase, 'edge'); assert.equal(view.scale, 1);
  view = edge.move(view, 100, 0, options);
  assert.ok(view.scale > 1); assert.equal(view.phase, 'zoom');
  close(view.x, 24); // left image edge stays anchored at its screen margin
  const enlarged = view.scale;
  view = edge.move(view, -50, 0, options);
  assert.ok(view.scale < enlarged && view.scale > 1);
  view = edge.move(view, -70, 0, options);
  close(view.scale, 1); close(view.x, 24); close(view.y, -200);
  view = edge.move(view, -80, 0, options);
  close(view.scale, 1); close(view.x, -56);
  view = edge.move(view, 2000, 0, options);
  close(view.scale, 2);
  view = edge.move(view, -10, 0, options);
  assert.ok(view.scale < 2, 'reverse responds immediately after hitting zoom cap');
});

test('gaps, bounded wheel input, diagonal edges, and maximum scale stay predictable', () => {
  const gap = new EdgePan();
  const items = [{ x: 0, y: 0, w: 200, h: 1200 }, { x: 1400, y: 0, w: 200, h: 1200 }];
  const v = gap.move({ x: -400, y: -200, scale: 1 }, -100, 0, { ...options, items });
  assert.equal(v.scale, 1); assert.equal(v.phase, '', 'interior blank space does not trigger zoom');
  const wheel = new EdgePan().move({ x: 24, y: 24, scale: 1 }, 2000, 2000, { ...options, zoom: false });
  assert.equal(wheel.scale, 1); assert.equal(wheel.x, 24); assert.equal(wheel.y, 24);
  const diagonal = new EdgePan();
  const start = { x: 24, y: 24, scale: 1 };
  let d = diagonal.move(start, 100, 100, options);
  assert.ok(d.scale > 1 && d.scale < 2); close(d.x, 24); close(d.y, 24);
  d = diagonal.move(d, -100, -100, options);
  close(d.scale, 1); close(d.x, 24); close(d.y, 24);
  const corner = new EdgePan();
  const firstCorner = corner.move(start, 100, 100, options);
  const turn = corner.move(firstCorner, 20, 0, options);
  close(turn.x, 24); close(turn.y, 24); // horizontal input must not invent a vertical pan
  const cap = new EdgePan().move({ x: 24, y: 24, scale: 6 }, 1000, 0, options);
  assert.equal(cap.scale, 6);
});

test('pan only reveals clipped content: a fitting axis is frozen, a clipped one may only return into view', () => {
  const area = { w: 1000, h: 800 }, margin = 24;
  // The collection is 400 wide (fits) and 2000 tall (overflows) at scale 1.
  const bounds = { x: 0, y: 0, w: 400, h: 2000 };
  const from = { x: 300, y: -500, scale: 1 };            // fully visible on x; scrolled 500 into y
  const next = boundPan({ x: 340, y: -560, scale: 1 }, area, bounds, from);
  assert.equal(next.x, 300, 'a wholly visible axis does not slide');
  assert.equal(next.y, -560, 'an overflowing axis pans freely within its edges');
  // Overflow clamps at the far edge: the bottom of the collection meets the bottom margin.
  assert.equal(boundPan({ x: 300, y: -5000, scale: 1 }, area, bounds, from).y, area.h - margin - 2000);
  // A fitting axis that is partly off-stage may come back, but not go past fully visible.
  const clipped = { x: -100, y: 0, scale: 1 };            // left edge 100px off the stage
  assert.equal(boundPan({ x: -150, y: 0, scale: 1 }, area, bounds, clipped).x, -100, 'cannot clip further');
  assert.equal(boundPan({ x: 500, y: 0, scale: 1 }, area, bounds, clipped).x, margin, 'returns up to fully visible, then stops');
  // Without a starting position (an anchored zoom) the plain clamp still applies.
  assert.equal(boundPan({ x: 900, y: 0, scale: 1 }, area, bounds).x, area.w - margin - 400);
});
