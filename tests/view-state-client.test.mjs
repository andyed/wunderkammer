import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewStateStore, mergePileState } from '../wall/view-state.mjs';

test('filtered saves retain hidden and unresolved pile keys', () => {
  const old = { version: 1, piles: [{ label: 'Research', u: 1, v: 2, keys: ['a', 'b', 'missing'] }] };
  const next = { version: 1, piles: [{ label: 'New group', u: 3, v: 4, keys: ['a'] }] };
  const merged = mergePileState(next, old, new Set(['a']));
  assert.deepEqual(merged.piles, [next.piles[0], { ...old.piles[0], keys: ['b', 'missing'] }]);
  assert.deepEqual(old.piles[0].keys, ['a', 'b', 'missing']);
});

test('failed load prevents any PUT of a replacement document', async () => {
  const calls = [];
  const store = new ViewStateStore(async (...args) => { calls.push(args); return new Response('broken state', { status: 500 }); });
  await assert.rejects(store.load(), /HTTP 500/);
  await assert.rejects(store.save({}), /not loaded/);
  assert.equal(calls.length, 1);
  assert.equal(store.doc, null);
});

test('client saves are ordered, failures propagate and the queue recovers', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const store = new ViewStateStore(async (_, options) => {
    if (!options) return new Response('{}');
    const body = JSON.parse(options.body); calls.push(body);
    if (calls.length === 1) { await gate; return new Response('failed', { status: 500 }); }
    return new Response('{"ok":true}');
  });
  await store.load();
  const first = store.save({ version: 1, piles: [], choice: 'first' });
  const second = store.save({ version: 1, piles: [], choice: 'second' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  const rejected = assert.rejects(first, /HTTP 500/);
  release(); await rejected; await second;
  assert.deepEqual(calls.map((c) => c.choice), ['first', 'second']);
  assert.equal(store.doc.choice, 'second');
});
