import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createImageWork } from '../wall/image-work.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
test('image work prioritizes visible area, caps concurrency, and drops obsolete queued jobs', async () => {
  const frames = [], started = [], release = [];
  const work = createImageWork({ concurrency: 2, frame: fn => frames.push(fn), now: () => 0 });
  const add = (key, priority, valid = () => true) => work.add(key, priority, valid,
    () => { started.push(key); return new Promise(resolve => release.push(resolve)); });
  add('small', 1); add('large', 100); add('middle', 50); add('stale', 200, () => false);
  frames.shift()(); await tick();
  assert.deepEqual(started, ['large', 'middle']);
  assert.equal(work.running, 2);
  assert.equal(frames.length, 0, 'no frame polling while decode slots are full');
  work.clear(); release.forEach(resolve => resolve()); await tick();
  assert.equal(work.pending, 0); assert.equal(work.running, 0);
  assert.equal(frames.length, 0, 'discarded scope work never restarts');
});

test('an image already decoding gets only its newest requested upgrade afterwards', async () => {
  const frames = [], started = []; let release;
  const work = createImageWork({ frame: fn => frames.push(fn), now: () => 0 });
  work.add('same-image', 1, () => true, () => { started.push('initial'); return new Promise(resolve => { release = resolve; }); });
  frames.shift()(); await tick();
  work.add('same-image', 5, () => true, () => started.push('obsolete'));
  work.add('same-image', 10, () => true, () => started.push('latest'));
  assert.equal(frames.length, 0, 'does not spin while one image is busy');
  release(); await tick(); frames.shift()(); await tick();
  assert.deepEqual(started, ['initial', 'latest']);
  assert.equal(work.running, 0);
});
