import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { animateLayout, captureLayoutMotion } from '../wall/layout-motion.mjs';

const view = { x: 0, y: 0, scale: 1 }, stage = { width: 1000, height: 800 };
const rect = (x, y = 0, w = 100, h = 100) => ({ x, y, w, h });
function tile(name, events = []) {
  const node = { isConnected: true, animations: [], transform: 'none',
    animate(keyframes, timing) {
      const animation = { playState: 'running', keyframes, timing, cancelled: false,
        cancel() { events.push(`cancel:${name}`); this.cancelled = true; this.playState = 'idle'; this.oncancel?.(); } };
      this.animations.push(animation); return animation;
    } };
  return node;
}
afterEach(() => captureLayoutMotion(new Map()));

test('interrupted regroup begins at the visible midpoint, including its current size', () => {
  const node = tile('a'), nodes = new Map([['a', node]]);
  const first = new Map([['a', rect(0, 0, 100, 80)]]), second = new Map([['a', rect(200, 100, 200, 160)]]);
  assert.equal(animateLayout(first, second, nodes, view, stage), 1);
  const old = node.animations[0];
  // A genuine visible intermediate matrix; canonical second remains destination.
  node.transform = 'matrix(0.75, 0, 0, 0.75, 100, 50)';
  const captured = captureLayoutMotion(second, { readTransform: n => n.transform });
  assert.deepEqual(captured.get('a'), rect(100, 50, 150, 120));
  assert.deepEqual(second.get('a'), rect(200, 100, 200, 160), 'canonical geometry is never mutated');
  assert.equal(old.cancelled, true);
  const third = new Map([['a', rect(400, 150, 300, 240)]]);
  assert.equal(animateLayout(captured, third, nodes, view, stage), 1);
  assert.equal(node.animations[1].keyframes[0].transform, 'translate(100px, 50px) scale(0.5, 0.5)');
  assert.equal(node.animations[1].keyframes[1].transform, 'translate(400px, 150px) scale(1, 1)');
});

test('all active reads precede cancellation and old hidden/removed effects are cancelled too', () => {
  const events = [], a = tile('a', events), b = tile('b', events), gone = tile('gone', events);
  const nodes = new Map([['a', a], ['b', b], ['gone', gone]]);
  const from = new Map([...nodes].map(([key], i) => [key, rect(i * 150)]));
  const to = new Map([...nodes].map(([key], i) => [key, rect(i * 150 + 50)]));
  animateLayout(from, to, nodes, view, stage);
  gone.isConnected = false;
  const captured = captureLayoutMotion(to, { readTransform: node => { events.push(node === a ? 'read:a' : 'read:b'); return 'matrix(1,0,0,1,30,10)'; } });
  assert.deepEqual(events, ['read:a', 'read:b', 'cancel:a', 'cancel:b', 'cancel:gone']);
  const outside = new Map([['a', rect(1500)], ['b', rect(2000)]]);
  assert.equal(animateLayout(captured, outside, nodes, view, stage), 0);
  assert.ok([...nodes.values()].every(n => n.animations[0].cancelled));
});

test('capture measures at most64 previous animated nodes in a1793-item corpus', () => {
  const from = new Map(), to = new Map(), nodes = new Map();
  for (let i = 0; i < 1793; i++) {
    from.set(i, rect(0)); to.set(i, rect(10)); nodes.set(i, tile(String(i)));
  }
  assert.equal(animateLayout(from, to, nodes, view, stage, { limit: 1000 }), 64);
  let reads = 0;
  const captured = captureLayoutMotion(to, { readTransform: () => { reads++; return 'matrix(1,0,0,1,5,0)'; } });
  assert.equal(reads, 64);
  assert.equal(captured.size, 1793);
  assert.equal([...captured.values()].filter(r => r.x === 5).length, 64);
  assert.equal([...captured.values()].filter(r => r.x === 10).length, 1729);
});

test('finished animation releases its measurement slot; invalid matrices keep canonical geometry', () => {
  const a = tile('a'), b = tile('b'), nodes = new Map([['a', a], ['b', b]]);
  const from = new Map([['a', rect(0)], ['b', rect(100)]]), to = new Map([['a', rect(50)], ['b', rect(150)]]);
  animateLayout(from, to, nodes, view, stage);
  a.animations[0].playState = 'finished'; a.animations[0].onfinish();
  let reads = 0;
  const captured = captureLayoutMotion(to, { readTransform: () => { reads++; return 'matrix(NaN,0,0,1,10,10)'; } });
  assert.equal(reads, 1);
  assert.deepEqual(captured, to);
  assert.equal(a.animations[0].cancelled, false);
  assert.equal(b.animations[0].cancelled, true);
});

test('3D-serialized local translation/scale is captured without mixing in camera coordinates', () => {
  const node = tile('a'), nodes = new Map([['a', node]]);
  const from = new Map([['a', rect(0)]]), to = new Map([['a', rect(100, 100, 200, 100)]]);
  animateLayout(from, to, nodes, { x: 20, y: 40, scale: 0.4 }, stage);
  const captured = captureLayoutMotion(to, { readTransform: () => 'matrix3d(0.75,0,0,0,0,1,0,0,0,0,1,0,50,50,0,1)' });
  assert.deepEqual(captured.get('a'), rect(50, 50, 150, 100));
});
