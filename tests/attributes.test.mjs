import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeMark, attributeModel, sortClips } from '../wall/attributes.mjs';

const clip = (id, props = {}, extra = {}) => ({ id, url: `https://test/${id}`, props, ...extra });

test('ordered models expose bounded low-to-high gradient stops and mark ranks', () => {
  const clips = [clip('low', { complexity: 'low' }), clip('high', { complexity: 'high' }), clip('mid', { complexity: 'medium' })];
  const model = attributeModel(clips, 'complexity', 'Complexity');
  assert.deepEqual(model.domain, ['low', 'medium', 'high']);
  assert.deepEqual(model.stops.map(stop => stop.label), model.domain);
  assert.equal(model.kind, 'ordered');
  assert.equal(model.stops[0].color, '#22d3ee');
  assert.equal(model.stops[1].color, '#8b5cf6');
  assert.equal(model.stops[2].color, '#f59e0b');
  assert.equal(attributeMark(clips[0], model).rank, 0);
  assert.equal(attributeMark(clips[2], model).rank, 0.5);
});

test('categorical colors are stable across scopes and preserve multi-value membership', () => {
  const broad = attributeModel([clip('a', { artist: 'Alpha' }), clip('b', { artist: 'Beta' })], 'artist');
  const narrow = attributeModel([clip('a', { artist: 'Alpha' })], 'artist');
  assert.equal(broad.kind, 'categorical');
  assert.equal(broad.stops.find(stop => stop.label === 'Alpha').color,
    narrow.stops.find(stop => stop.label === 'Alpha').color);
  const marked = attributeMark(clip('both', { color: ['red', 'blue'] }), attributeModel([clip('x', { color: ['red', 'blue'] })], 'color'));
  assert.equal(marked.colors.length, 2);
  assert.equal(marked.valueLabel, 'red · blue');
  assert.equal(marked.missing, false);
});

test('color-family categories use recognizable swatches while staying stable', () => {
  const broad = attributeModel([clip('r', { color: 'red' }), clip('b', { color: 'blue' })], 'color');
  const narrow = attributeModel([clip('r', { color: 'red' })], 'color');
  assert.equal(broad.stops.find(stop => stop.label === 'red').color, '#ef4444');
  assert.equal(broad.stops.find(stop => stop.label === 'blue').color, '#3b82f6');
  assert.equal(narrow.stops.find(stop => stop.label === 'red').color, '#ef4444');
  assert.deepEqual(attributeMark(clip('both', { color: ['red', 'blue'] }), broad).colors,
    ['#ef4444', '#3b82f6']);
});

test('minimum and earliest multi-values drive ordered marks and sorts', () => {
  const dates = [
    clip('late', {}, { captured: ['2026-03-02', '2025-12-10'] }),
    clip('early', {}, { captured: '2026-01-01' }),
    clip('missing', {}, { captured: 'unknown' }),
  ];
  const model = attributeModel(dates, 'captured');
  assert.deepEqual(model.domain, ['2025-12-10', '2026-01-01']);
  assert.equal(model.max, Date.parse('2026-01-01'));
  assert.equal(attributeMark(dates[0], model).valueLabel, '2025-12-10');
  assert.deepEqual(sortClips(dates, { key: 'captured', direction: 'asc' }, model).map(c => c.id), ['late', 'early', 'missing']);
  assert.deepEqual(sortClips(dates, { key: 'captured', direction: 'desc' }, model).map(c => c.id), ['early', 'late', 'missing']);
});

test('continuous gradients use value distance and captured marks retain timestamps', () => {
  const years = [clip('a', { year: '1970' }), clip('b', { year: '1971' }), clip('c', { year: '2020' })];
  const yearModel = attributeModel(years, 'year');
  assert.deepEqual(yearModel.gradient, [{color:'#22d3ee',rank:0},{color:'#8b5cf6',rank:.5},{color:'#f59e0b',rank:1}]);
  const single = attributeModel([years[0]], 'year');
  assert(single.gradient.every(stop => stop.color === attributeMark(years[0], single).color));
  assert.ok(attributeMark(years[1], yearModel).rank < 0.1, '1971 is close to 1970, not the midpoint');
  assert.ok(attributeMark(years[2], yearModel).rank > 0.9);

  const captures = [
    clip('late', {}, { captured: '2026-04-20T12:00:00Z' }),
    clip('early', {}, { captured: '2026-04-03T12:00:00Z' }),
    clip('bad', {}, { captured: 'not-a-date' }),
  ];
  const model = attributeModel(captures, 'captured');
  assert.deepEqual(model.domain, ['2026-04-03T12:00:00Z', '2026-04-20T12:00:00Z']);
  assert.deepEqual(sortClips(captures, { key: 'captured', direction: 'asc' }, model).map(c => c.id), ['early', 'late', 'bad']);
  assert.equal(attributeMark(captures[2], model).missing, true);
  assert.equal(attributeMark(captures[0], model).valueLabel, '2026-04-20T12:00:00Z');
});

test('missing values stay last in both directions and tie-breaks use URL/id', () => {
  const clips = [
    clip('z', { year: '2024' }, { url: 'https://test/z' }),
    clip('a', { year: '2024' }, { url: 'https://test/a' }),
    clip('missing', { year: null }),
  ];
  const asc = sortClips(clips, { key: 'year', direction: 'asc' });
  const desc = sortClips(clips, { key: 'year', direction: 'desc' });
  assert.deepEqual(asc.map(c => c.id), ['a', 'z', 'missing']);
  assert.deepEqual(desc.map(c => c.id), ['a', 'z', 'missing']);
  assert.equal(attributeMark(clips[2], attributeModel(clips, 'year')).missing, true);
});

test('none sorting returns a new array without changing adapter order or input', () => {
  const clips = [clip('one'), clip('two')];
  const sorted = sortClips(clips, { key: 'none', direction: 'desc' });
  assert.deepEqual(sorted, clips);
  assert.notEqual(sorted, clips);
});

test('invalid ordinal values remain missing in the lens and in descending sort', () => {
  const clips = [clip('bad', {complexity:'not-classified'}), clip('low', {complexity:'low'})];
  const model = attributeModel(clips, 'complexity');
  assert.deepEqual(model.domain, ['low']);
  assert.equal(attributeMark(clips[0], model).missing, true);
  assert.deepEqual(sortClips(clips, {key:'complexity',direction:'desc'}, model).map(c=>c.id), ['low','bad']);
});
