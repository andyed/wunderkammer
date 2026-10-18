import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCollection, toCollection, CollectionError, COLLECTION_LIMITS } from '../wall/collection.mjs';
import { buildFacets } from '../wall/facet-counts.mjs';

const doc = (over = {}) => ({
  format: 'wunderkammer.collection', version: 1, corpus: { id: 'example:covers' },
  ui: { title: 'Covers', defaultGroup: 'decade', facetOrder: ['decade', 'genre'], facetLabels: { decade: 'release decade' } },
  clips: [
    { id: 'a', title: 'A', cover: 'https://img.example/a.webp', props: { decade: '1980s', genre: ['pop', 'electronic'] }, sourceUrl: 'https://example.org/a' },
    { id: 'b', title: 'B', cover: 'covers/b.webp', props: { decade: '1990s', genre: 'pop' }, captured: '1994-05' },
  ],
  ...over,
});
const problemsOf = input => {
  try { validateCollection(input, { baseUrl: 'https://host.example/c/collection.json' }); } catch (err) {
    assert.ok(err instanceof CollectionError, String(err)); return err.problems;
  }
  assert.fail('expected a CollectionError');
};

test('a minimal collection validates, derives facet counts and defaults tags', () => {
  const { collection, warnings } = validateCollection(doc());
  assert.deepEqual(warnings, []);
  assert.equal(collection.clips.length, 2);
  assert.deepEqual(collection.clips[1].tags, []);
  assert.deepEqual(collection.facets.decade, { '1980s': 1, '1990s': 1 });
  assert.deepEqual(collection.facets.genre, { pop: 2, electronic: 1 });
  assert.deepEqual(collection.facets.captured, { '1994-05': 1 });
});

test('every problem is reported with its path in one error', () => {
  const bad = doc({ format: 'wunderkammer', vault: '/private/vault', extra: 1 });
  delete bad.corpus;
  bad.clips[0].sourceUrl = 'javascript:alert(1)';
  bad.clips[1].cover = 'data:text/html,<script>alert(1)</script>';
  bad.clips[1].captured = 'May 1994';
  bad.clips.push({ id: 'a', image: 'x.png' });
  const problems = problemsOf(bad);
  const has = (start, fragment) => assert.ok(problems.some(p => p.startsWith(start) && p.includes(fragment)), `${start} … ${fragment}\n${problems.join('\n')}`);
  has('format', 'wunderkammer.collection');
  has('collection.vault', 'server response');
  has('collection.extra', 'supported: format');
  has('corpus', 'must be an object');
  has('clips[0].sourceUrl', 'http(s)');
  has('clips[1].cover', 'data:image/');
  has('clips[1].captured', 'ISO date');
  has('clips[2]', 'repeats the identity of clips[0]');
  has('clips[2].image', 'put other attributes in props');
});

test('link schemes are http(s) only; url may be an opaque urn identity', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'obsidian://open?vault=x']) {
    assert.ok(problemsOf(doc({ clips: [{ id: 'a', sourceUrl }] })).some(p => p.startsWith('clips[0].sourceUrl')), sourceUrl);
  }
  assert.ok(problemsOf(doc({ clips: [{ id: 'a', url: 'javascript:alert(1)' }] })).some(p => p.startsWith('clips[0].url')));
  const { collection } = validateCollection(doc({ clips: [{ id: 'a', url: 'urn:clipwall:image:abc' }] }));
  assert.equal(collection.clips[0].url, 'urn:clipwall:image:abc');
});

test('relative media and links resolve against the document URL', () => {
  const { collection } = validateCollection(doc({ clips: [
    { id: 'a', cover: 'covers/a.webp', coverVariants: [{ src: '../small/a.webp', width: 128 }], media: [{ src: '/full/a.png' }], sourceUrl: 'about.html' },
  ] }), { baseUrl: 'https://host.example/c/collection.json' });
  const c = collection.clips[0];
  assert.equal(c.cover, 'https://host.example/c/covers/a.webp');
  assert.equal(c.coverVariants[0].src, 'https://host.example/small/a.webp');
  assert.equal(c.media[0].src, 'https://host.example/full/a.png');
  assert.equal(c.sourceUrl, 'https://host.example/c/about.html');
  // Without a base, a relative image stays page-relative and a relative link is refused.
  assert.equal(validateCollection(doc()).collection.clips[1].cover, 'covers/b.webp');
  assert.throws(() => validateCollection(doc({ clips: [{ id: 'a', sourceUrl: 'about.html' }] })), /sourceUrl must be an absolute/);
});

test('props are scalars or arrays of scalars, and cannot be hidden by clip fields', () => {
  const problems = problemsOf(doc({ clips: [{ id: 'a', props: { title: 'x', score: Infinity, nested: { a: 1 }, ok: [1, 'two', true] } }] }));
  assert.ok(problems.some(p => p.startsWith('clips[0].props.title') && p.includes('hidden')));
  assert.ok(problems.some(p => p.startsWith('clips[0].props.score')));
  assert.ok(problems.some(p => p.startsWith('clips[0].props.nested')));
  assert.ok(!problems.some(p => p.startsWith('clips[0].props.ok')));
});

test('supplied facet counts are replaced, with a warning only when they disagree', () => {
  const derived = validateCollection(doc()).collection.facets;
  assert.deepEqual(validateCollection(doc({ facets: derived })).warnings, []);
  const { collection, warnings } = validateCollection(doc({ facets: { decade: { '1980s': 99 } } }));
  assert.equal(warnings.length, 1);
  assert.deepEqual(collection.facets, derived);
});

test('problem lists are capped and say how many were left out', () => {
  const clips = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, sourceUrl: 'ftp://x' }));
  const err = (() => { try { validateCollection(doc({ clips })); } catch (e) { return e; } })();
  assert.equal(err.problems.length, COLLECTION_LIMITS.problems);
  assert.match(err.message, /\(40 problems\)/);
  assert.match(err.message, /and 15 more/);
});

test('a server payload converts to a valid collection without server-only or private fields', () => {
  const payload = { clips: [{ id: 'a', title: 'A', url: 'urn:clipwall:image:a', tags: [], props: { year: '2026' }, cover: 'media/a.webp', sheetSlots: [1], editUri: 'obsidian://x', palette: ['#112233'] }],
    corpus: { id: 'demo', revision: 'r1' }, facets: {}, vault: '/srv/private/vault', adapters: ['images'], generated: 'now', ui: { title: 'Demo', corpusName: 'x' } };
  const { collection, removed } = toCollection(payload, { viewState: { version: 1, mode: 'mountain', groupKey: 'year', piles: [] } });
  assert.deepEqual(removed, { sheetSlots: 1, editUri: 1, 'ui.corpusName': 1 });
  assert.equal(JSON.stringify(collection).includes('/srv/private'), false);
  const { collection: valid } = validateCollection(collection);
  assert.equal(valid.viewState.groupKey, 'year');
});

test('the shared facet counter matches the server shape and tolerates clips without tags', () => {
  const clips = [{ tags: ['x', 'y'], source: 's', kind: 'page', captured: '2026-01-02', props: { color: ['red', 'blue'], empty: '' } }, { props: { color: 'red' } }];
  assert.deepEqual(buildFacets(clips), { tags: { x: 1, y: 1 }, source: { s: 1 }, kind: { page: 1 }, captured: { '2026-01': 1 }, color: { red: 2, blue: 1 } });
});
