import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A --reuse-corpus build is synced into the demo's checkout with --delete, so
// any file the published collection names but the build leaves out is deleted
// from the live site. The build once copied media/ and not sheets/, the sprite
// pages the covers come from, and still reported success.
const root = fileURLToPath(new URL('../', import.meta.url));
const SITE = 'https://demo.example/sub/';
const doc = {
  format: 'wunderkammer.collection', version: 1, corpus: { id: 'fixture:build-demo', revision: 'r1' },
  ui: { title: 'Build fixture' }, images: { sheets: 'covers' },
  // One page named on the site by absolute URL, as the live demo names them; one relative.
  sheets: [
    { src: `${SITE}sheets/aaa.webp`, edge: 64, width: 192, height: 64 },
    { src: 'sheets/bbb.webp', edge: 160, width: 480, height: 160 },
  ],
  clips: [
    { id: 'd0', cover: 'media/c0.webp' },
    // The same file twice is one file.
    { id: 'd1', cover: `${SITE}media/c1.webp`, detailCover: 'media/c1.webp' },
    // Another host's image is not the build's to check.
    { id: 'd2', cover: 'https://images.example/c2.webp' },
  ].map((clip, i) => ({ ...clip, sheetSlots: [[0, 64 * i, 0, 64, 64], [1, 160 * i, 0, 160, 160]] })),
};
const FILES = ['media/c0.webp', 'media/c1.webp', 'sheets/aaa.webp', 'sheets/bbb.webp'];

let dir;
before(async () => { dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-build-demo-')); });
after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

async function publish(name, collection, files) {
  const folder = path.join(dir, name);
  await mkdir(path.join(folder, 'media'), { recursive: true });
  await writeFile(path.join(folder, 'collection.json'), JSON.stringify(collection));
  for (const file of files) {
    await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await writeFile(path.join(folder, file), randomBytes(64));
  }
  return folder;
}
const build = (published, out) => spawnSync(process.execPath,
  ['scripts/build-demo.mjs', '--reuse-corpus', published, '--out', out, '--site', SITE],
  { cwd: root, encoding: 'utf8' });

test('a reused corpus carries its sheet pages and media into the build byte for byte', async () => {
  const published = await publish('complete', doc, FILES);
  const out = path.join(dir, 'complete-out');
  const r = build(published, out);
  assert.equal(r.status, 0, `build failed:\n${r.stderr}`);
  for (const file of FILES) {
    assert.ok(existsSync(path.join(out, file)), `${file} is missing from the build`);
    assert.deepEqual(await readFile(path.join(out, file)), await readFile(path.join(published, file)), `${file} changed`);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(out, 'collection.json'), 'utf8')), doc);
  assert.match(r.stdout, /media and sheets preserved; all 4 files it names on https:\/\/demo\.example\/sub\/ are present/);
});

test('a build fails, writing no collection.json, when the collection names a file the output lacks', async () => {
  const published = await publish('lacking', doc, FILES.filter(file => file !== 'sheets/bbb.webp'));
  const out = path.join(dir, 'lacking-out');
  const r = build(published, out);
  assert.notEqual(r.status, 0, `build passed:\n${r.stdout}`);
  assert.match(r.stderr, /names 1 of 4 files on https:\/\/demo\.example\/sub\/ that the output lacks/);
  assert.match(r.stderr, /missing: sheets\[1\]\.src sheets\/bbb\.webp/);
  assert.match(r.stderr, /FAILED/);
  assert.ok(!existsSync(path.join(out, 'collection.json')), 'a failed build wrote collection.json');
});

test('a build fails when the collection names no file on the demo site', async () => {
  const elsewhere = { ...doc, sheets: undefined, images: undefined, clips: doc.clips.map(({ id }) => ({ id, cover: `https://images.example/${id}.webp` })) };
  // A media/ folder with files in it proves nothing when the collection names none of them.
  const published = await publish('elsewhere', JSON.parse(JSON.stringify(elsewhere)), ['media/c0.webp']);
  const r = build(published, path.join(dir, 'elsewhere-out'));
  assert.notEqual(r.status, 0, `build passed:\n${r.stdout}`);
  assert.match(r.stderr, /names no file on https:\/\/demo\.example\/sub\//);
});
