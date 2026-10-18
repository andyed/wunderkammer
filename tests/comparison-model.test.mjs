import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComparison, comparisonEvidence, defaultComparison, selectEvidence, validateComparison, UNKNOWN } from '../wall/comparison-model.mjs';

const album = (id, decade, genre, extra = {}) => ({ url: `urn:album:${id}`, title: `Album ${id}`,
  source: 'Fixture artist', captured: '2026-01-15', tags: [], props: { decade, genre }, ...extra });
const records = [
  album('a', ['1970s', '1970s'], ['Rock', 'Rock', 'Jazz']),
  album('b', ['1970s', '1980s'], ['Rock']),
  album('c', ['1980s'], ['Jazz']),
  album('d', ['1980s'], []),
  album('e', [], ['Folk']),
];
const recipe = extra => ({ version: 1, question: 'What changed?', corpus: { id: 'fixture', revision: 'one' },
  scope: { query: '', facets: {} }, groupBy: 'decade', groups: ['1970s', '1980s'],
  measure: 'genre', metric: 'share', categoryLimit: 8, sort: 'difference', ...extra });

test('counts unique identities and tag incidence with per-cohort denominators and overlap', () => {
  const source = structuredClone(records);
  const model = buildComparison([...source, structuredClone(source[0])], recipe());
  assert.deepEqual(model.cohorts.map(({ count }) => count), [2, 3]);
  assert.equal(model.scopedCount, 5);
  assert.equal(model.uniqueCount, 4);
  assert.equal(model.overlapCount, 1);
  assert.equal(model.missingGroupCount, 1);
  assert.equal(model.missingValueCount, 1);
  assert.equal(model.multiValueCount, 1);
  const rock = model.rows.find(row => row.value === 'Rock');
  assert.deepEqual(rock.cells.map(cell => cell.count), [2, 1]);
  assert.deepEqual(rock.cells.map(cell => cell.share), [1, 1 / 3]);
  assert.equal(rock.total, 2, 'row total deduplicates overlap across cohorts');
  assert.ok(Math.abs(rock.delta - (-2 / 3)) < 1e-12);
  assert.deepEqual(rock.cells[0].keys, ['urn:album:a', 'urn:album:b']);
  assert.equal(model.rows[0].value, 'Rock', 'largest absolute first/last difference first');
  assert.ok(model.warnings.some(warning => warning.includes('duplicate record')));
  assert.ok(model.warnings.some(warning => warning.includes('100%')));
  assert.deepEqual(source, records, 'analysis does not mutate source records');
});

test('scope uses canonical AND, OR, word search, and captured-prefix semantics', () => {
  const model = buildComparison(records, recipe({ scope: { query: 'Album urn:album:b', facets: { captured: ['2026'], genre: ['Rock', 'Folk'] } } }));
  assert.equal(model.scopedCount, 1);
  assert.deepEqual(model.cohorts.map(cohort => cohort.keys), [['urn:album:b'], ['urn:album:b']]);
  const none = buildComparison(records, recipe({ scope: { query: 'Album urn:album:b', facets: { genre: ['Jazz'] } } }));
  assert.equal(none.scopedCount, 0);
  assert.deepEqual(none.rows, []);
});

test('missing data is explicit, authored unknown strings stay authored, and empty cohorts stay finite', () => {
  const model = buildComparison([...records, album('f', '1980s', 'unknown')], recipe({ groups: [UNKNOWN, '1980s', '2090s'] }));
  assert.deepEqual(model.cohorts.map(cohort => cohort.count), [1, 4, 0]);
  assert.equal(model.rows.find(row => row.value === 'Folk').cells[0].count, 1);
  assert.equal(model.rows.find(row => row.value === UNKNOWN).cells[1].count, 1);
  assert.equal(model.rows.find(row => row.value === 'unknown').cells[1].count, 1);
  assert.ok(model.rows.every(row => row.cells.every(cell => Number.isFinite(cell.share))));
  assert.ok(model.warnings.some(warning => warning.includes('2090s has no items')));
});

test('ranking is metric-specific and category truncation never discards selected evidence', () => {
  const many = [album('base', '1970s', ['A', 'B', 'C', 'D', 'E'])];
  for (let i = 0; i < 10; i++) many.push(album(String(i), '1980s', i < 5 ? ['A'] : ['B']));
  const share = buildComparison(many, recipe({ categoryLimit: 4 }));
  assert.equal(share.rows[0].value, 'C', '100% to 0% outranks 100% to 50%');
  const counts = buildComparison(many, recipe({ metric: 'count', categoryLimit: 4 }));
  assert.equal(counts.rows[0].value, 'A', 'one to five is largest count difference');
  assert.equal(counts.categoryCount, 5);
  assert.equal(counts.omittedCategoryCount, 1);
  assert.equal(selectEvidence(counts, { value: 'E' }).length, 1, 'hidden row remains exactly selectable');
  assert.deepEqual(buildComparison(many, recipe({ sort: 'name' })).rows.map(row => row.value), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(buildComparison(many, recipe({ sort: 'total' })).rows[0].total, 6);
});

test('evidence selection is an exact stable union and export includes counting policy and denominators', () => {
  const model = buildComparison(records, recipe());
  assert.deepEqual(selectEvidence(model, { value: 'Rock' }).map(clip => clip.url), ['urn:album:a', 'urn:album:b']);
  assert.deepEqual(selectEvidence(model, { value: 'Rock', cohort: '1980s' }).map(clip => clip.url), ['urn:album:b']);
  assert.equal(selectEvidence(model).length, 4);
  assert.deepEqual(selectEvidence(model, { value: 'Not a genre' }), []);
  const exported = comparisonEvidence(model, { value: 'Rock', cohort: '1980s' });
  assert.equal(exported.evidenceCount, 1);
  assert.deepEqual(exported.evidence, [{ key: 'urn:album:b', title: 'Album b' }]);
  assert.deepEqual(exported.cohorts.map(cohort => cohort.denominator), [2, 3]);
  assert.deepEqual(exported.rows[0].cells[1].keys, ['urn:album:b']);
  assert.equal(exported.corpus.revision, 'one');
  assert.match(exported.countingPolicy.denominator, /including items missing/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(exported)));
});

test('defaults prefer actual release decades and genre; empty data remains valid and finite', () => {
  const corpus = { id: 'fixture', revision: 'two' };
  const spec = defaultComparison(records, corpus);
  assert.equal(spec.groupBy, 'decade');
  assert.equal(spec.measure, 'genre');
  assert.deepEqual(spec.groups, ['1970s', '1980s']);
  assert.deepEqual(spec.corpus, corpus);
  const empty = buildComparison([], defaultComparison([], corpus));
  assert.equal(empty.uniqueCount, 0);
  assert.deepEqual(empty.cohorts.map(cohort => cohort.count), [0, 0]);
  const single = defaultComparison([album('single', '1980s', 'Jazz')], corpus);
  assert.equal(single.groups.length, 2);
});

test('evidence exports unavailable shares and endpoint share differences as null without changing render aggregates', () => {
  const input = [album('solo', '1970s', 'Jazz')];
  for (const groups of [['1970s', '1980s'], ['1980s', '1970s']]) {
    const model = buildComparison(input, recipe({ groups }));
    const before = structuredClone(model.rows);
    const packet = comparisonEvidence(model, { value: 'Jazz' });
    assert.equal(packet.rows[0].delta, null, 'either empty endpoint makes the share delta unavailable');
    assert.deepEqual(packet.rows[0].cells.map(cell => cell.share), groups.map(group => group === '1970s' ? 1 : null));
    assert.match(packet.countingPolicy.empty, /null/);
    assert.deepEqual(model.rows, before, 'numeric renderer aggregates remain unchanged');
    assert.ok(model.rows[0].cells.every(cell => Number.isFinite(cell.share)));
    assert.ok(packet.warnings.some(warning => warning.includes('share difference against it are unavailable')));
    const countPacket = comparisonEvidence(buildComparison(input, recipe({ groups, metric: 'count' })));
    assert.equal(countPacket.rows[0].delta, groups[0] === '1970s' ? -1 : 1, 'empty cohorts still have a defined zero count');
  }
  const middleEmpty = comparisonEvidence(buildComparison([
    ...input, album('other', '1990s', 'Rock'),
  ], recipe({ groups: ['1970s', '1980s', '1990s'] })), { value: 'Jazz' });
  assert.equal(middleEmpty.rows[0].delta, -1, 'empty interior cohorts do not invalidate nonempty endpoint differences');
  assert.deepEqual(middleEmpty.rows[0].cells.map(cell => cell.share), [1, null, 0], 'observed absence differs from an unavailable denominator');
});

test('strict imported recipes reject malformed, oversized, unsafe, and unsupported fields', () => {
  const cases = [
    null, [], recipe({ version: 2 }), recipe({ categoryLimit: NaN }), recipe({ categoryLimit: Infinity }),
    recipe({ categoryLimit: 4.5 }), recipe({ categoryLimit: 3 }), recipe({ categoryLimit: 21 }),
    recipe({ groups: ['1970s'] }), recipe({ groups: ['1970s', '1970s'] }), recipe({ groups: ['1970s', 2] }),
    recipe({ groups: Array.from({ length: 7 }, (_, i) => String(i)) }),
    recipe({ metric: 'average' }), recipe({ sort: 'magic' }), recipe({ question: 'x'.repeat(1001) }),
    recipe({ groupBy: '__proto__' }), recipe({ measure: 'constructor' }),
    recipe({ corpus: { id: '', revision: 'r' } }), recipe({ corpus: { id: 'f', revision: 123 } }),
    recipe({ scope: { query: '', facets: { genre: 'Rock' } } }),
    recipe({ scope: { query: '', facets: { genre: [null] } } }),
    recipe({ scope: { query: '', facets: JSON.parse('{"__proto__":["bad"]}') } }),
    recipe({ execute: 'arbitrary extra' }), recipe({ scope: { query: [], facets: {} } }),
    recipe({ scope: { query: '', facets: {}, branches: [] } }),
  ];
  for (const value of cases) assert.throws(() => validateComparison(value), /Comparison:/);
  const original = recipe({ scope: { query: 'keep spacing', facets: { genre: ['Rock', 'Rock'] } } });
  const normalized = validateComparison(original);
  assert.deepEqual(normalized.scope.facets.genre, ['Rock']);
  normalized.scope.facets.genre.push('Jazz');
  assert.deepEqual(original.scope.facets.genre, ['Rock', 'Rock'], 'validated scope is independently owned');
});

test('identity fallback and conflicting duplicate policy are explicit; bad identities do not collapse into undefined', () => {
  const model = buildComparison([
    album('a', '1970s', 'Rock'), album('a', '1980s', 'Jazz'),
    { id: 'id-only', title: 'Fallback', props: { decade: '1980s', genre: 'Jazz' } },
    { title: 'No identity' }, null,
  ], recipe());
  assert.equal(model.uniqueCount, 2);
  assert.equal(model.clipsByKey.get('urn:album:a').props.genre, 'Rock');
  assert.deepEqual(model.cohorts[1].keys, ['id-only']);
  assert.ok(model.warnings.some(warning => warning.includes('2 records without stable identity')));
});
