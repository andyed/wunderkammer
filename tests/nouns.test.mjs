import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectionNouns, counted, plural, NEUTRAL_NOUNS } from '../wall/nouns.mjs';
import { comparisonCopy } from '../wall/comparison-copy.mjs';

const albums = [{ kind: 'album' }, { kind: 'album' }];

test('a collection names its items: ui.nouns first, then a music library, then neutral nouns', () => {
  assert.deepEqual({ ...collectionNouns({ clips: albums, ui: { nouns: { item: 'cat', items: 'cats' } } }) }, { item: 'cat', items: 'cats', custom: true });
  assert.deepEqual({ ...collectionNouns({ clips: albums }) }, { item: 'album', items: 'albums', custom: false });
  assert.equal(collectionNouns({ clips: [{ kind: 'image' }] }), NEUTRAL_NOUNS);
  assert.equal(collectionNouns(), NEUTRAL_NOUNS);
  // A server payload is not validated, so malformed nouns fall through.
  assert.equal(collectionNouns({ ui: { nouns: { item: '', items: 'cats' } } }), NEUTRAL_NOUNS);
  assert.equal(collectionNouns({ ui: { nouns: { item: 'cat' } } }), NEUTRAL_NOUNS);
});

test('counts agree in number with their noun', () => {
  const cats = collectionNouns({ ui: { nouns: { item: 'cat', items: 'cats' } } });
  assert.equal(counted(1, cats), '1 cat');
  assert.equal(counted(0, cats), '0 cats');
  assert.equal(counted(128, cats), '128 cats');
  assert.equal(counted(1), '1 item');
  assert.equal(plural(2, 'group', 'groups'), 'groups');
});

test('the comparison page reads the same nouns as the wall', () => {
  const ui = { nouns: { item: 'cat', items: 'cats' } };
  assert.equal(comparisonCopy({ clips: albums, ui }).wallLabel('1890s', 1), '1890s · 1 cat');
  assert.equal(comparisonCopy({ clips: albums }).wallLabel('1970s', 1), '1970s · 1 album');
});
