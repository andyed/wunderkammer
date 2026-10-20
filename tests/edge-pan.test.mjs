import test from 'node:test';
import assert from 'node:assert/strict';
import { EdgePan, boundPan, DEAD_ZONE } from '../wall/edge-pan.mjs';

const bounds = { x: 0, y: 0, w: 1600, h: 1200 };
const options = { area: { w: 800, h: 600 }, bounds, items: [bounds], point: { x: 400, y: 300 }, zoom: true, maxScale: 6 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('edge zoom latches one anchor, caps growth, and reversal restores pan scale', () => {
  const edge = new EdgePan();
  const start = { x: 24, y: -200, scale: 1 };
  let view = edge.move(start, 20, 0, options);
  assert.equal(view.phase, 'edge'); assert.equal(view.scale, 1);
  view = edge.move(view, 200, 0, options);
  assert.ok(view.scale > 1); assert.equal(view.phase, 'zoom');
  close(view.x, 24); // left image edge stays anchored at its screen margin
  const enlarged = view.scale;
  view = edge.move(view, -50, 0, options);
  assert.ok(view.scale < enlarged && view.scale > 1);
  view = edge.move(view, -170, 0, options);
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

test('edge zoom has to be pushed for: a dead zone of real push, and drift along an edge never adds up', () => {
  // Pushing straight into the left edge in 10 px events: the cue holds through
  // the whole dead zone and scaling starts only past it.
  const push = new EdgePan();
  let view = { x: 24, y: -200, scale: 1 }, travelled = 0;
  while (travelled + 10 <= DEAD_ZONE) {
    view = push.move(view, 10, 0, options); travelled += 10;
    assert.equal(view.phase, 'edge', `the edge cue shows at ${travelled} px of push`); assert.equal(view.scale, 1);
  }
  view = push.move(view, 40, 0, options);
  assert.equal(view.phase, 'zoom'); assert.ok(view.scale > 1, 'pushing past the dead zone zooms');

  // The collection fits vertically here (400 tall on a 600 stage), so y is frozen
  // and every pixel of vertical drift is blocked. A long horizontal pan that
  // drifts 3 px down for every 8 across blocks 180 px, past the dead zone, and
  // must still pan, never zoom.
  const drift = new EdgePan(), fits = { x: 0, y: 0, w: 1600, h: 400 };
  const along = { ...options, bounds: fits, items: [fits] };
  view = { x: -100, y: 100, scale: 1 };
  for (let i = 0; i < 60; i++) {
    view = drift.move(view, -8, 3, along);
    assert.equal(view.phase, '', `drift at event ${i} is a pan: no edge cue, no zoom`); assert.equal(view.scale, 1);
  }
  assert.equal(view.y, 100, 'the frozen axis did not move');
  assert.ok(view.x < -100 - 480 + 1, 'the pan travelled along the edge');
  // After a short push against the left edge, sliding along it with a slight
  // lean into it holds the cue and does not zoom.
  const slide = new EdgePan();
  view = slide.move({ x: 24, y: -200, scale: 1 }, 60, 0, options);
  for (let i = 0; i < 30; i++) {
    view = slide.move(view, 3, -8, options);
    assert.equal(view.phase, 'edge', `sliding along the edge at event ${i} keeps the cue`); assert.equal(view.scale, 1);
  }
  close(view.x, 24); close(view.y, -440);
  // Push that wobbles off-axis between events still builds: jitter costs only its own events.
  const wobble = new EdgePan();
  view = { x: 24, y: -200, scale: 1 };
  for (let i = 0; i < 30; i++) view = wobble.move(view, i % 3 ? 10 : 2, i % 3 ? 2 : -9, options);
  assert.equal(view.phase, 'zoom', 'a push with an off-axis wobble still zooms');

  // A corner reached by a diagonal drag still needs the full dead zone of push.
  const corner = new EdgePan();
  view = corner.move({ x: 24, y: 24, scale: 1 }, 40, 40, options);
  assert.equal(view.scale, 1, 'arriving in a corner is not a zoom'); assert.equal(view.phase, 'edge');
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
