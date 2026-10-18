import assert from 'node:assert/strict';
import test from 'node:test';
import { validateComparisonView, encodeComparisonView, decodeComparisonView, comparisonURL, comparisonFromURL } from '../wall/comparison-view.mjs';

const specimen = () => ({
  v: 1,
  spec: {
    version: 1, question: 'Where does Jazz / 日本語 differ?',
    corpus: { id: 'fixture', revision: 'r1' },
    scope: { query: 'Björk 🎵', facets: { color: ['blue'] } },
    groupBy: 'decade', groups: ['1970s', '1990s'], measure: 'genre',
    metric: 'share', categoryLimit: 10, sort: 'difference',
  },
  presentation: { view: 'terraces', spread: 0.8, slice: '1990s' },
  selection: { value: 'Jazz', cohort: '1990s' },
  focus: null, camera: null,
});

test('comparison view codec preserves Unicode, scope, selection and presentation independently', () => {
  const input = specimen();
  assert.deepEqual(decodeComparisonView(encodeComparisonView(input)), input);
  const validated = validateComparisonView(input);
  assert.deepEqual(validated, input);
  validated.spec.scope.facets.color.push('red');
  assert.deepEqual(input.spec.scope.facets.color, ['blue'], 'validated views do not alias mutable recipe input');
});

test('comparison view rejects invalid versions, non-finite depth and unsupported views', () => {
  const input = specimen();
  assert.throws(() => validateComparisonView({ ...input, v: 2 }));
  assert.throws(() => validateComparisonView({ ...input, spec: { ...input.spec, metric: 'sum' } }));
  for (const spread of [NaN, Infinity, -Infinity, -1, 2]) {
    assert.throws(() => validateComparisonView({ ...input, presentation: { ...input.presentation, spread } }));
  }
  assert.throws(() => validateComparisonView({ ...input, presentation: { ...input.presentation, view: 'invented' } }));
  assert.throws(() => decodeComparisonView('bad%input'));
});

test('empty selections and all-group slicing round-trip without becoming restrictions', () => {
  const input = { ...specimen(), presentation: { view: 'depth', spread: 0.65, slice: null }, selection: { value: null, cohort: null } };
  assert.deepEqual(decodeComparisonView(encodeComparisonView(input)), input);
});

test('custom camera links retain finite coordinates and reject malformed or non-finite transforms', () => {
  const input = { ...specimen(), camera: { position: [2, 8, 15], target: [0, 1, -2] } };
  assert.deepEqual(decodeComparisonView(encodeComparisonView(input)), input);
  for (const camera of [
    { position: [2, Infinity, 15], target: [0, 1, -2] },
    { position: [2, 8], target: [0, 1, -2] },
    { position: [2, 8, 15], target: [0, NaN, -2] },
    { position: [2, 8, 15], target: [0, 1, -1e10] },
    { position: [0, 0, 0], target: [0, 0, 0] },
  ]) assert.throws(() => validateComparisonView({ ...input, camera }));
  assert.throws(() => validateComparisonView({ ...input, presentation: { ...input.presentation, slice: 'not-a-cohort' } }));
  assert.throws(() => validateComparisonView({ ...input, selection: { value: 'Jazz', cohort: 'not-a-cohort' } }));
});

test('readable parameters round-trip repeated facets, corpus provenance, Unicode and camera', () => {
  const input = specimen();
  input.spec.scope.facets = { genre: ['Jazz', 'Rock'], color: ['blue'] };
  input.focus = 'urn:album:日本語';
  input.camera = { position: [2.12345, 8, 15], target: [0, 1, -2] };
  const url = comparisonURL(input, 'http://localhost:4175/wall/compare.html?unrelated=old#legacy');
  assert.equal(url.hash, '');
  assert.deepEqual(url.searchParams.getAll('facet.genre'), ['Jazz', 'Rock']);
  assert.equal(url.searchParams.get('corpus'), 'fixture');
  assert.equal(url.searchParams.get('revision'), 'r1');
  assert.equal(url.searchParams.has('unrelated'), false);
  const defaults = specimen();
  defaults.spec.scope = { query: '', facets: {} };
  defaults.selection = { value: null, cohort: null };
  defaults.presentation = { view: 'depth', spread: .65, slice: null };
  assert.deepEqual(comparisonFromURL(url.href, defaults), input);
  assert.deepEqual(defaults.spec.scope, { query: '', facets: {} }, 'reading a URL does not mutate host defaults');
});

test('concise parameter links use host defaults and reject malformed membership and camera', () => {
  const defaults = specimen();
  defaults.spec.scope = { query: '', facets: {} };
  defaults.selection = { value: null, cohort: null };
  defaults.presentation = { view: 'depth', spread: .65, slice: null };
  const url = 'http://localhost/wall/compare.html?groupBy=decade&group=1970s&group=1990s&measure=genre&metric=count&category=Jazz&within=1970s&view=front&spread=0.4';
  const result = comparisonFromURL(url, defaults);
  assert.deepEqual(result.selection, { value: 'Jazz', cohort: '1970s' });
  assert.deepEqual(result.presentation, { view: 'front', spread: .4, slice: null });
  assert.deepEqual(result.spec.corpus, defaults.spec.corpus);
  assert.equal(result.spec.metric, 'count');
  for (const query of ['compare=2', 'group=1970s', 'spread=Infinity', 'camera=1,2,3', 'camera=,,,,,', 'camera=1,2,3,4,NaN,6', 'facet.__proto__=pollution']) {
    assert.throws(() => comparisonFromURL(`http://localhost/wall/compare.html?${query}`, defaults), query);
  }
});

test('album-wall URLs retain aisle position and reject invalid travel', () => {
  const input=specimen();input.presentation={view:'walls',spread:.65,slice:null,travel:.75};
  const url=comparisonURL(input,'http://localhost/wall/compare.html');
  assert.equal(url.searchParams.get('travel'),'0.75');
  const defaults=specimen();defaults.presentation.slice=null;
  assert.deepEqual(comparisonFromURL(url,defaults),input);
  for(const travel of [-.1,1.1,NaN,Infinity])assert.throws(()=>validateComparisonView({...input,presentation:{...input.presentation,travel}}));
  for(const travel of ['', '-1','2','NaN'])assert.throws(()=>comparisonFromURL(`http://localhost/wall/compare.html?travel=${travel}`,specimen()));
});
