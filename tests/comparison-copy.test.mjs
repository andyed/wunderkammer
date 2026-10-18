import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonCopy, startingPoints, NEUTRAL_COPY } from '../wall/comparison-copy.mjs';

const MUSIC_WORDS = /\balbums?\b|\bcovers?\b|\bracks?\b|\bartists?\b/i;
// Every string the copy can produce, sample counts filled in.
const strings = copy => [copy.walls, copy.wallsSummary(297, 2), copy.wallsSummary(1, 2), copy.wallLabel('2025', 206), copy.wallLabel('2026', 1),
  copy.wallsHelp, copy.wallsAria, copy.inspect, copy.search];
const frame = (i, props) => ({ id: `f${i}`, title: `Frame ${i}`, kind: 'image', props });
const album = (i, props) => ({ id: `a${i}`, title: `Album ${i}`, kind: 'album', props });

test('neutral copy names no music noun', () => {
  const copy = comparisonCopy({ clips: [frame(1, { year: '2025' }), frame(2, { year: '2026' })], ui: { title: 'Psychodeli Atlas' } });
  assert.equal(copy, NEUTRAL_COPY);
  assert.equal(copy.walls, 'Walls');
  assert.equal(copy.wallsSummary(297, 2), '297 items · 2 groups');
  assert.equal(copy.wallLabel('2025', 206), '2025 · 206 items');
  assert.equal(copy.wallLabel('2026', 1), '2026 · 1 item');
  for (const text of strings(copy)) assert.doesNotMatch(text, MUSIC_WORDS);
  // A library with some albums among other kinds is not a music library.
  assert.equal(comparisonCopy({ clips: [album(1, {}), frame(2, {})] }), NEUTRAL_COPY);
  assert.equal(comparisonCopy(), NEUTRAL_COPY);
});

test('a music library keeps the album wording word for word', () => {
  const copy = comparisonCopy({ clips: [album(1, {}), album(2, {})], ui: { title: 'Music Atlas' } });
  assert.equal(copy.walls, 'Album walls');
  assert.equal(copy.wallsSummary(297, 2), '297 covers · 2 racks');
  assert.equal(copy.wallLabel('2025', 206), '2025 · 206 albums');
  assert.equal(copy.wallsHelp, 'Walk the aisle to reach deeper racks. Drag to look around; scroll or pinch to zoom. Select a cover to inspect it. Choose a category in the comparison below to highlight its albums. Arrow keys look around; Home returns to the current aisle position.');
  assert.equal(copy.wallsAria, 'Album art walls. Drag or use arrow keys to look around, scroll to zoom. Walk aisle moves through the racks. Select a cover to inspect it; the item list below provides keyboard access.');
  assert.equal(copy.inspect, 'Inspect album');
  assert.equal(copy.search, 'Search titles, artists, notes…');
});

test('ui.nouns names the items; malformed nouns fall through', () => {
  const copy = comparisonCopy({ clips: [album(1, {})], ui: { nouns: { item: 'frame', items: 'frames' } } });
  assert.equal(copy.walls, 'Frame walls');
  assert.equal(copy.wallsSummary(297, 2), '297 frames · 2 groups');
  assert.equal(copy.wallLabel('2025', 206), '2025 · 206 frames');
  assert.equal(copy.wallLabel('2026', 1), '2026 · 1 frame');
  assert.match(copy.wallsHelp, /Select any frame to inspect it\. .* highlight its frames\./);
  assert.equal(copy.inspect, 'Inspect frame');
  for (const text of strings(copy)) assert.doesNotMatch(text, MUSIC_WORDS);
  assert.equal(comparisonCopy({ ui: { nouns: { item: 'élan', items: 'élans' } } }).walls, 'Élan walls');
  // A server payload is not validated; nouns that are not two short words are ignored.
  for (const nouns of ['frames', { item: 'frame' }, { item: '', items: 'frames' }, { item: 'frame', items: 7 }, { item: 'x'.repeat(41), items: 'xs' }]) {
    assert.equal(comparisonCopy({ clips: [frame(1, {})], ui: { nouns } }), NEUTRAL_COPY, JSON.stringify(nouns));
  }
});

test('starting points need the attributes and values they name', () => {
  const ids = clips => startingPoints(clips).map(point => point.id);
  // A Psychodeli-like collection: years and colours, no decade or genre.
  assert.deepEqual(ids([frame(1, { year: '2025', color: ['green'] }), frame(2, { year: '2026', color: ['blue'] })]), []);
  // Genre in lowercase, no colour: only the genre comparison.
  assert.deepEqual(ids([frame(1, { decade: '1970s', genre: 'rock' }), frame(2, { decade: '1990s', genre: ['pop', 'jazz'] })]), ['genre']);
  // One decade is nothing to compare across.
  assert.deepEqual(ids([album(1, { decade: '1970s', genre: ['Rock', 'Jazz'], color: ['red'] })]), []);
  // A decade read from a clip field counts as one from props; blank values do not.
  assert.deepEqual(ids([{ id: 'x', decade: '1970s', props: { color: ' ' } }, { id: 'y', props: { decade: '1980s', color: [''] } }]), []);
  const music = [album(1, { decade: '1970s', genre: ['Rock'], color: ['red'] }), album(2, { decade: ['1990s'], genre: ['Jazz'], color: ['blue'] })];
  assert.deepEqual(ids(music), ['genre', 'color', 'genres']);
  assert.deepEqual(startingPoints(music).map(point => point.label), ['Genre across decades', 'Artwork color across decades', 'Rock and Jazz across decades']);
  assert.deepEqual(ids([...music.slice(0, 1), album(2, { decade: '1990s', genre: ['Blues'] })]), ['genre', 'color']);
  assert.deepEqual(startingPoints([null, 'x', ...music]).length, 3, 'non-object clips are skipped');
});

test('each starting point builds the comparison it names', () => {
  const base = { version: 1, question: '', groupBy: 'decade', groups: ['1970s', '1990s'], measure: 'genre', sort: 'difference' };
  const music = [album(1, { decade: '1970s', genre: ['Rock'], color: ['red'] }), album(2, { decade: '1990s', genre: ['Jazz'], color: ['blue'] })];
  const built = Object.fromEntries(startingPoints(music).map(point => [point.id, point.apply(base)]));
  assert.deepEqual([built.genre.groupBy, built.genre.measure], ['decade', 'genre']);
  assert.deepEqual([built.color.groupBy, built.color.measure], ['decade', 'color']);
  assert.deepEqual([built.genres.groupBy, built.genres.groups, built.genres.measure, built.genres.sort], ['genre', ['Rock', 'Jazz'], 'decade', 'name']);
  assert.equal(base.measure, 'genre', 'the base comparison is not modified');
});
