import assert from 'node:assert/strict';
import test from 'node:test';

// Two module instances: the probe reads its switch once, at import.
const off = (await import('../wall/instrument.mjs?off')).perf;
globalThis.__cwPerfEnable = true;
const on = (await import('../wall/instrument.mjs?on')).perf;
delete globalThis.__cwPerfEnable;

test('off: every entry point is a pass-through and records nothing', () => {
  assert.equal(off.enabled, false);
  assert.equal(off.span('x', () => 42), 42);
  const end = off.begin('y'); end();
  off.count('z'); off.mark('m'); off.provide('g', () => ({ a: 1 }));
  assert.equal(off.snapshot(), null);
});

test('on: spans count, total and keep the return value', () => {
  on.reset();
  const busy = () => { const t = performance.now(); while (performance.now() - t < 2); return 'done'; };
  assert.equal(on.span('render', busy), 'done');
  on.span('render', busy);
  const end = on.begin('render/layout'); busy(); end();
  const s = on.snapshot();
  assert.equal(s.spans.render.n, 2);
  assert.ok(s.spans.render.totalMs >= 4, `total ${s.spans.render.totalMs}`);
  assert.ok(s.spans.render.maxMs >= s.spans.render.p50);
  assert.equal(s.spans['render/layout'].n, 1);
});

test('on: a throwing phase is still timed, and the error still propagates', () => {
  on.reset();
  assert.throws(() => on.span('boom', () => { throw new Error('x'); }), /x/);
  assert.equal(on.snapshot().spans.boom.n, 1);
});

test('on: counters add, gauges are read at snapshot time, a failing gauge is reported not thrown', () => {
  on.reset();
  on.count('draws'); on.count('draws', 4);
  let live = 1;
  on.provide('queue', () => ({ live }));
  on.provide('broken', () => { throw new Error('nope'); });
  live = 7;
  const s = on.snapshot();
  assert.equal(s.counters.draws, 5);
  assert.deepEqual(s.gauges.queue, { live: 7 });
  assert.match(s.gauges.broken.error, /nope/);
});

test('on: reset clears the window but keeps boot marks', () => {
  on.mark('boot/ready');
  on.span('filter', () => {});
  on.reset();
  const s = on.snapshot();
  assert.deepEqual(Object.keys(s.spans), []);
  assert.ok(s.marks.some(m => m.name === 'boot/ready'));
});
