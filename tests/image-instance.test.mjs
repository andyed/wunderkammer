import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, mkdir, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadInstanceConfig } from '../lib/instance-config.mjs';
import { loadClips, originalPath } from '../adapters/images.mjs';
import { groupBy } from '../wall/layout.mjs';

test('instance configs resolve separate state and derived data beside their own config', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'image-instance-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'second'));
  const first = path.join(dir, 'first.json'), second = path.join(dir, 'second/config.json');
  await writeFile(first, '{}');
  await writeFile(second, JSON.stringify({ imageIndex: 'index.json', imageCache: 'cache' }));
  const a = await loadInstanceConfig(first, [], {});
  const b = await loadInstanceConfig(first, ['--config', second], {});
  assert.notEqual(a.config.viewStatePath, b.config.viewStatePath);
  assert.equal(b.config.imageIndex, path.join(dir, 'second/index.json'));
  assert.equal(b.config.imageCache, path.join(dir, 'second/cache'));
  await assert.rejects(loadInstanceConfig(first, ['--config'], {}), /requires a path/);
});

test('image original routes reject traversal, sibling roots, symlinks and non-images', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'image-routes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'images'); await mkdir(root);
  await writeFile(path.join(root, 'shot #1.png'), 'image');
  await writeFile(path.join(dir, 'outside.png'), 'outside');
  await symlink(path.join(dir, 'outside.png'), path.join(root, 'escape.png'));
  const config = { imageRoots: [{ id: 'one', path: root }] };
  assert.equal(await originalPath(config, 'one/shot%20%231.png'), await realpath(path.join(root, 'shot #1.png')));
  for (const route of ['one/../outside.png', 'one/%2e%2e%2foutside.png', 'one/escape.png', 'one/secrets.json', 'two/shot.png']) {
    assert.equal(await originalPath(config, route), null, route);
  }
});

test('image metadata gives stable identity, local previews, chronological order and month groups', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'image-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const index = path.join(dir, 'index.json');
  const image = { id: 'stable', rootId: 'one', relativePath: 'Shot #1.png', captured: '2026-04-12T08:10:00',
    dateSource: 'filename', datePrecision: 'second', width: 1000, height: 500,
    thumbnail: 'thumbs/hash.webp', preview: 'previews/hash.webp',
    features: { kaleido: { label: 'uncertain', reason: 'mixed' }, palette: [{ hex: '#ff0000' }], colorFamilies: [{ name: 'red', fraction: 0.9 }] } };
  await writeFile(index, JSON.stringify({ images: [{ ...image, id: 'older', captured: '2025-11-12' }, image] }));
  const clips = await loadClips({ imageIndex: index });
  assert.equal(clips[0].id, 'stable');
  assert.equal(clips[0].sourceUrl, '/original/one/Shot%20%231.png');
  assert.equal(clips[0].cover, '/media/thumbs/hash.webp');
  assert.equal(clips[0].detailCover, '/media/previews/hash.webp');
  assert.equal(clips[0].props.kaleido, 'uncertain');
  assert.deepEqual(groupBy([...clips, { ...clips[0], id: 'same-month', captured: '2026-04-15' }], 'captured').map(g => [g.label, g.clips.length]), [['2026-04', 2], ['2025-11', 1]]);
  await writeFile(index, JSON.stringify({ images: [{ ...image, width: 500, height: 1000, overview: 'thumbs-small/hash.webp' }] }));
  const [portrait] = await loadClips({ imageIndex: index });
  assert.equal(portrait.cover, '/media/thumbs-small/hash.webp');
  assert.deepEqual(portrait.coverVariants, [
    { src: '/media/thumbs-small/hash.webp', width: 64 },
    { src: '/media/thumbs/hash.webp', width: 320 },
  ], 'srcset widths describe the actual portrait derivatives, not their longest side');
  assert.equal(portrait.detailCover, clips[0].detailCover, 'overview tiers do not reduce detail quality');
});
