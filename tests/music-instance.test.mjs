import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadClips } from '../adapters/music.mjs';
import { filterScope } from '../wall/context-clusters.mjs';
import { groupBy } from '../wall/layout.mjs';

test('music covers expose tagged years, album identity, local artwork and searchable track metadata', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'music-instance-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const imageIndex = path.join(dir, 'index.json');
  const album = { id: 'stable', artist: 'Artist', album: 'First album', years: ['1997', '2001'], genres: ['Rock'],
    trackArtists: ['Guest'], tracks: ['A remembered song'], fileCount: 12, locations: ['music/Artist/First album'], metadataSources: ['audio-tags'],
    cover: { width: 600, height: 600, original: 'artwork/hash #1.jpg', overview: 'thumbs-small/hash.webp', thumbnail: 'thumbs/hash.webp', preview: 'previews/hash.webp', provenance: 'embedded-front', source: 'Artist/01.mp3' },
    features: { palette: [{ hex: '#1100ff' }], colorFamilies: [{ name: 'blue', fraction: 0.9 }] } };
  await writeFile(imageIndex, JSON.stringify({ albums: [album, { ...album, id: 'second', album: 'Second album', years: [], tracks: ['Another song'] }] }));
  const clips = await loadClips({ imageIndex });
  assert.equal(clips.length, 2);
  assert.equal(clips[0].cover, '/media/thumbs-small/hash.webp');
  assert.deepEqual(clips[0].coverVariants.map(v => v.width), [128, 600]);
  assert.equal(clips[0].url, 'urn:clipwall:album:stable');
  assert.equal(clips[0].sourceUrl, '/media/artwork/hash%20%231.jpg');
  assert.equal(clips[0].captured, '', 'must not fabricate a capture date from a release year');
  assert.deepEqual([clips[0].artist, clips[0].album, clips[0].tracks, clips[0].locations], ['Artist', 'First album', ['A remembered song'], ['music/Artist/First album']], 'structured identity for listening and playback');
  assert.deepEqual(clips[0].props.decade, ['1990s', '2000s']);
  assert.deepEqual(clips[1].props.year, []);
  assert.equal(filterScope(clips, { query: 'remembered', active: new Map(), branches: null }).length, 1);
  assert.equal(filterScope(clips, { query: '', active: new Map([['year', new Set(['1997'])]]), branches: null }).length, 1);
  assert.deepEqual(groupBy([clips[0]], 'decade').map(g => g.label), ['1990s', '2000s']);
});
