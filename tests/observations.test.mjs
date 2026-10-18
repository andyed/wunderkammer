import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildComparison, comparisonEvidence } from '../wall/comparison-model.mjs';
import { validateObservations, resolveObservation, observationEvidence, observationPacket, ObservationError, OBSERVATION_LIMITS } from '../wall/observations.mjs';

const corpus = { id: 'observation-fixture', revision: 'r1' };
const album = (id, decade, genre) => ({ id, url: `urn:album:${id}`, title: `Album ${id}`, tags: [], props: { decade, genre } });
const clips = [
  album('alpha', ['1970s'], ['Jazz', 'Blues']),
  album('beta', ['1970s'], ['Jazz']),
  album('gamma', ['1970s'], ['Rock']),
  album('shared', ['1970s', '1990s'], ['Rock']),
  album('delta', ['1990s'], ['Rock']),
  album('epsilon', ['1990s'], ['Jazz', 'Rock']),
];
const comparison = { version: 1, question: 'How does genre change from the 1970s to the 1990s?', corpus,
  scope: { query: '', facets: {} }, groupBy: 'decade', groups: ['1970s', '1990s'], measure: 'genre',
  metric: 'share', categoryLimit: 8, sort: 'name' };
const envelope = (observations, over = {}) => ({ format: 'wunderkammer.observations', version: 1, comparison, observations, ...over });
const problemsOf = input => { try { validateObservations(input); } catch (e) { assert.ok(e instanceof ObservationError, String(e)); return e.problems; } assert.fail('expected an ObservationError'); };

test('an envelope validates its comparison and keeps observations in order', () => {
  const { comparison: spec, observations } = validateObservations(envelope([
    { id: 'jazz-falls', text: 'Jazz is less common in the 1990s.', evidence: { cells: [{ value: 'Jazz', cohort: '1970s' }, { value: 'Jazz', cohort: '1990s' }] } },
    { id: 'rock', text: 'Rock appears in both decades.', evidence: { cells: [{ value: 'Rock' }], items: ['urn:album:shared'] } },
  ]));
  assert.equal(spec.measure, 'genre');
  assert.deepEqual(observations.map(o => o.id), ['jazz-falls', 'rock']);
  assert.deepEqual(observations[1].evidence.cells, [{ value: 'Rock', cohort: null }]);
});

test('every envelope problem is reported with its path', () => {
  const problems = problemsOf(envelope([
    { id: 'Bad id!', text: '', evidence: { cells: [] } },
    { id: 'x', text: 'Fine text', evidence: { cells: [{ value: 'Jazz', cohort: '2000s' }], items: [] }, numbers: [1] },
    { id: 'x', text: 'Duplicate id', evidence: { cells: [{ value: 'Rock' }] } },
  ], { format: 'observations', comparison: { ...comparison, metric: 'ratio' } }));
  const has = (start, fragment) => assert.ok(problems.some(p => p.startsWith(start) && p.includes(fragment)), `${start} … ${fragment}\n${problems.join('\n')}`);
  has('format', 'wunderkammer.observations');
  has('comparison', 'metric');
  has('observations[0].id', 'letters, digits');
  has('observations[0].text', 'non-empty');
  has('observations[0].evidence', 'at least one cell or item');
  has('observations[1].numbers', 'not supported');
  has('observations[2].id', 'repeats observations[1].id');
  // A cohort outside the groups is only checkable against a valid comparison.
  assert.ok(problemsOf(envelope([{ id: 'x', text: 't', evidence: { cells: [{ value: 'Jazz', cohort: '2000s' }] } }]))
    .some(p => p.includes('"2000s" is not one of the comparison\'s groups')));
});

test('figures beside an observation equal the comparison evidence for its cells', () => {
  const model = buildComparison(clips, comparison);
  const [obs] = validateObservations(envelope([{ id: 'jazz', text: 'Jazz falls.', evidence: { cells: [{ value: 'Jazz', cohort: '1970s' }, { value: 'Jazz', cohort: '1990s' }] } }])).observations;
  const resolved = resolveObservation(model, obs);
  const packet = comparisonEvidence(model, { value: 'Jazz' });
  const denominators = new Map(packet.cohorts.map(c => [c.key, c.denominator]));
  assert.deepEqual(resolved.figures, packet.rows[0].cells.map(c => ({ value: 'Jazz', cohort: c.cohort, count: c.count, denominator: denominators.get(c.cohort), share: c.share })));
  // Fixture arithmetic: 1970s has alpha, beta, gamma, shared (4); Jazz in alpha, beta.
  assert.deepEqual(resolved.figures.map(f => [f.cohort, f.count, f.denominator]), [['1970s', 2, 4], ['1990s', 1, 3]]);
  assert.deepEqual(resolved.unresolved, []);
});

test('a cell without a cohort cites every group; the evidence is the union in corpus order', () => {
  const model = buildComparison(clips, comparison);
  const [obs] = validateObservations(envelope([{ id: 'rock', text: 'Rock spans both.', evidence: { cells: [{ value: 'Rock' }], items: ['urn:album:alpha'] } }])).observations;
  const resolved = resolveObservation(model, obs);
  assert.deepEqual(resolved.figures.map(f => f.cohort), ['1970s', '1990s']);
  assert.deepEqual(resolved.keys, ['urn:album:alpha', 'urn:album:gamma', 'urn:album:shared', 'urn:album:delta', 'urn:album:epsilon']);
  // "shared" sits in both decades' racks, so it is cited in two places.
  assert.ok(resolved.places.has('1970s\u0000urn:album:shared') && resolved.places.has('1990s\u0000urn:album:shared'));
  assert.deepEqual(observationEvidence(model, resolved).map(c => c.id), ['alpha', 'gamma', 'shared', 'delta', 'epsilon']);
});

test('what the model does not contain is reported as unresolved, not dropped', () => {
  const model = buildComparison(clips, { ...comparison, groups: ['1970s', '1990s'] });
  const resolved = resolveObservation(model, { id: 'typo', text: 'Electronica rises.', evidence: {
    cells: [{ value: 'Electronica', cohort: null }, { value: 'Jazz', cohort: '2010s' }, { value: 'Rock', cohort: '1990s' }], items: ['urn:album:nope'] } });
  assert.deepEqual(resolved.unresolved, ['“Electronica” is not among the measured values', '“2010s” is not a group in this comparison', 'item “urn:album:nope” is not in this collection']);
  assert.equal(resolved.figures.length, 1, 'the resolvable cell still computes');
});

test('the observation packet carries the authored text, computed figures and exact evidence', () => {
  const model = buildComparison(clips, comparison);
  const [obs] = validateObservations(envelope([{ id: 'jazz', text: 'Jazz falls.', evidence: { cells: [{ value: 'Jazz' }] } }])).observations;
  const packet = observationPacket(model, resolveObservation(model, obs));
  assert.deepEqual(packet.selection, { observation: 'jazz' });
  assert.equal(packet.observation.authored, true);
  assert.equal(packet.observation.text, 'Jazz falls.');
  assert.deepEqual(packet.rows.map(r => r.value), ['Jazz']);
  assert.deepEqual(packet.evidence.map(e => e.key), ['urn:album:alpha', 'urn:album:beta', 'urn:album:epsilon']);
  assert.equal(packet.evidenceCount, 3);
  assert.ok(packet.countingPolicy.denominator);
});

test('limits are enforced', () => {
  const many = Array.from({ length: OBSERVATION_LIMITS.observations + 1 }, (_, i) => ({ id: `o${i}`, text: 't', evidence: { cells: [{ value: 'Jazz' }] } }));
  assert.ok(problemsOf(envelope(many)).some(p => p.startsWith('observations must be an array of 1 to')));
  assert.ok(problemsOf(envelope([{ id: 'long', text: 'x'.repeat(OBSERVATION_LIMITS.text + 1), evidence: { cells: [{ value: 'Jazz' }] } }])).some(p => p.startsWith('observations[0].text')));
});
