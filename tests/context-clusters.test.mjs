import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipKey, filterScope, chooseCluster, contextClusters } from '../wall/context-clusters.mjs';
const clips = Array.from({ length: 12 }, (_, i) => ({ id: String(i), url: `urn:${i}`, title: `Image ${i}`,
  captured: i < 4 ? '2026-01-01' : '2025-12-01', props: { year: i < 4 ? '2026' : '2025', color: i % 2 ? ['red', 'blue'] : ['red'], kaleido: 'kaleido' } }));
test('cluster scope switches or unions exact members and refinements never change OR semantics', () => {
  const active = new Map([['year', new Set(['2026'])]]);
  const selected = filterScope(clips, { query: '', active, branches: null });
  const clusters = contextClusters(clips, selected, {}, active);
  assert.equal(clusters[0].id, 'year:2025');
  assert.ok(clusters.every(c => c.keys.every(k => !selected.some(s => clipKey(s) === k))));
  const cluster = { label: 'Red neighbour', keys: ['urn:3', 'urn:6', 'urn:7'] };
  const scope = { query: '', active: new Map(), branches: chooseCluster(selected, cluster, true, '2026') };
  assert.equal(filterScope(clips, scope).length, 6, 'union deduplicates overlapping membership');
  scope.query = 'Image 7'; assert.deepEqual(filterScope(clips, scope).map(c => c.id), ['7']);
  scope.query = ''; scope.branches = chooseCluster(selected, cluster, false);
  assert.deepEqual(filterScope(clips, scope).map(c => c.id), ['3', '6', '7']);
  scope.branches = []; assert.equal(filterScope(clips, scope).length, 0, 'removing all branches does not widen to corpus');
});
test('context is bounded, deterministic, and absent for empty or full scope', () => {
  assert.deepEqual(contextClusters(clips, []), []);
  assert.deepEqual(contextClusters(clips, clips), []);
  const a = contextClusters(clips, clips.slice(0, 4));
  assert.ok(a.length <= 3);
  assert.equal(new Set(a.map(c => [...c.keys].sort().join('|'))).size, a.length);
  assert.deepEqual(a, contextClusters(clips, clips.slice(0, 4)));
});
