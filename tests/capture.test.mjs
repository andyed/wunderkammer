import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { clipOne } from '../clip.mjs';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.mjs';
import { writeNewFile, storeMedia } from '../lib/capture-store.mjs';

const defaults = { tags: [], title: '', kind: '', note: '', shot: false, allImages: false };
async function vault(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-capture-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'clips'));
  await mkdir(path.join(dir, 'attachments'));
  return { vault: dir, clipsDir: 'clips', attachmentsDir: 'attachments' };
}

// Minimal header fixture: capture reads dimensions without a browser decode.
function png(marker = 1) {
  const buf = Buffer.alloc(8192, marker);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf);
  buf.writeUInt32BE(640, 16); buf.writeUInt32BE(480, 20);
  return buf;
}

function network(t, { title = 'Original title', bytes = png() } = {}) {
  return t.mock.method(globalThis, 'fetch', async (url) => String(url).endsWith('/hero.png')
    ? new Response(bytes, { headers: { 'content-type': 'image/png' } })
    : new Response(`<title>${title}</title><meta property="og:image" content="/hero.png">`, {
      headers: { 'content-type': 'text/html' },
    }));
}

test('re-clipping preserves edited research and all prior media, before any network call', async (t) => {
  const cfg = await vault(t), url = 'https://capture.test/article';
  network(t);
  const notePath = await clipOne(url, { ...defaults }, cfg);
  const generated = await readFile(notePath, 'utf8');
  const authored = generated.replace('title: "Original title"', 'title: "My corrected title"\nverdict: keep\ntags:\n  - hand-tag')
    + '\nHandwritten analysis, citations, and [[linked notes]].\n';
  await writeFile(notePath, authored);
  const mediaName = (await readdir(path.join(cfg.vault, 'attachments')))[0];
  const mediaPath = path.join(cfg.vault, 'attachments', mediaName);
  const originalMedia = await readFile(mediaPath);
  const before = await readdir(path.dirname(notePath));
  t.mock.restoreAll();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch a captured URL'); });

  const kept = await clipOne(url, { ...defaults, title: 'Changed publisher title', note: 'new scrape', tags: ['new'], shot: true }, cfg);
  assert.equal(kept, notePath);
  assert.equal(await readFile(notePath, 'utf8'), authored);
  assert.deepEqual(await readFile(mediaPath), originalMedia);
  assert.deepEqual(await readdir(path.dirname(notePath)), before);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('URL identity survives a note rename and move inside the clips folder', async (t) => {
  const cfg = await vault(t), url = 'https://capture.test/CaseSensitive?token=Aa';
  const dir = path.join(cfg.vault, 'clips', 'reviewed'); await mkdir(dir);
  const file = path.join(dir, 'my-renamed-research.md');
  const authored = `---\nurl: "${url}"\ntitle: My own title\ncustom:\n  nested: untouched\n---\nPrivate research\n`;
  await writeFile(file, authored);
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  assert.equal(await clipOne(url, { ...defaults }, cfg), file);
  assert.equal(await readFile(file, 'utf8'), authored);
  assert.equal(mock.mock.callCount(), 0);
});

test('changed bytes at a shared image URL preserve the older clip and attachment', async (t) => {
  const cfg = await vault(t);
  const legacy = path.join(cfg.vault, 'attachments', 'old-url-hash.png');
  await writeFile(legacy, png(9));
  network(t, { bytes: png(1) });
  const first = await clipOne('https://capture.test/first', { ...defaults }, cfg);
  const oldNote = await readFile(first, 'utf8');
  const oldCover = parseFrontmatter(oldNote).data.cover;
  t.mock.restoreAll(); network(t, { bytes: png(2) });
  const second = await clipOne('https://capture.test/second', { ...defaults }, cfg);
  const newCover = parseFrontmatter(await readFile(second, 'utf8')).data.cover;
  assert.notEqual(oldCover, newCover);
  assert.deepEqual(await readFile(path.join(cfg.vault, oldCover)), png(1));
  assert.deepEqual(await readFile(path.join(cfg.vault, newCover)), png(2));
  assert.equal(await readFile(first, 'utf8'), oldNote);
  assert.deepEqual(await readFile(legacy), png(9));
});

test('a note that appears during capture cannot be overwritten', async (t) => {
  const cfg = await vault(t), url = 'https://capture.test/new';
  const id = `collision-${createHash('sha1').update(url).digest('hex').slice(0, 6)}`;
  const file = path.join(cfg.vault, 'clips', `${id}.md`);
  const authored = '---\nurl: https://capture.test/other\n---\nConcurrent user work\n';
  t.mock.method(globalThis, 'fetch', async () => {
    await writeFile(file, authored);
    return new Response('<title>Collision</title>', { headers: { 'content-type': 'text/html' } });
  });
  await assert.rejects(clipOne(url, { ...defaults }, cfg), /Note already exists; kept unchanged/);
  assert.equal(await readFile(file, 'utf8'), authored);
  assert.deepEqual(await readdir(path.dirname(file)), [`${id}.md`]);
});

test('concurrent file creation publishes one complete winner without replacement', async (t) => {
  const cfg = await vault(t), file = path.join(cfg.vault, 'clips', 'race.md');
  const documents = Array.from({ length: 12 }, (_, i) => `${i}: ${'research '.repeat(8192)}`);
  const results = await Promise.allSettled(documents.map((body) => writeNewFile(file, body)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results.filter((r) => r.status === 'rejected')) assert.equal(r.reason.code, 'EEXIST');
  assert.ok(documents.includes(await readFile(file, 'utf8')));
  assert.deepEqual(await readdir(path.dirname(file)), ['race.md']);
});

test('existing content-addressed attachments are reused, never replaced after manual editing', async (t) => {
  const cfg = await vault(t), dir = path.join(cfg.vault, 'attachments');
  const bytes = png();
  const paths = await Promise.all(Array.from({ length: 6 }, () => storeMedia(bytes, '.jpg', dir, 'attachments')));
  assert.equal(new Set(paths).size, 1);
  const file = path.join(cfg.vault, paths[0]);
  await writeFile(file, 'User-replaced attachment');
  await assert.rejects(storeMedia(bytes, '.jpg', dir, 'attachments'), /Existing attachment differs; kept unchanged/);
  assert.equal(await readFile(file, 'utf8'), 'User-replaced attachment');
});

test('capture frontmatter preserves ordinary strings and array values exactly', () => {
  const strings = ['A "quoted" title', '0012', 'false', 'null', 'two\nlines', 'C:\\notes\\title', '', 'tabs\there', 'emoji 🗃️'];
  for (const title of strings) {
    const data = { title, url: 'https://capture.test/quote?x="a"', tags: ['0012', 'false', 'a "quote", b', 'two\nlines'] };
    assert.deepEqual(parseFrontmatter(stringifyFrontmatter(data, 'Authored body\n')), { data, body: 'Authored body\n' });
  }
  assert.deepEqual(parseFrontmatter('---\ntags: ["a \\"quote\\", b", "false", "0012"]\n---\n').data.tags,
    ['a "quote", b', 'false', '0012']);
  assert.equal(parseFrontmatter("---\ntitle: 'O''Reilly'\n---\n").data.title, "O'Reilly");
});
