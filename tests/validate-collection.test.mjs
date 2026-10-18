import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/validate-collection.mjs'), ...args], { cwd: root, encoding: 'utf8' });
let dir;
const doc = (clips, extra = {}) => ({ format: 'wunderkammer.collection', version: 1, corpus: { id: 'fixture:cli', revision: 'r1' },
  ui: { nouns: { item: 'cat', items: 'cats' } }, clips, ...extra });
const cats = n => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `Cat ${i}`, cover: `media/${i}.png`, props: { era: i % 2 ? '1890s' : '1650s', coat: i % 3 ? 'black' : 'ginger' } }));

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wk-validate-'));
  await mkdir(path.join(dir, 'media'));
  for (let i = 0; i < 6; i++) await writeFile(path.join(dir, 'media', `${i}.png`), '');
  await writeFile(path.join(dir, 'good.json'), JSON.stringify(doc(cats(6))));
  await writeFile(path.join(dir, 'missing.json'), JSON.stringify(doc(cats(8))));
  const bad = doc(cats(2)); bad.format = 'wunderkammer'; bad.clips[0].sourceUrl = 'javascript:alert(1)'; bad.clips[1].props.source = 'x';
  await writeFile(path.join(dir, 'bad.json'), JSON.stringify(bad));
  const comparison = { version: 1, question: 'Is ginger commoner in the 1650s?', corpus: { id: 'fixture:cli', revision: 'r1' },
    scope: { query: '', facets: {} }, groupBy: 'era', groups: ['1650s', '1890s'], measure: 'coat', metric: 'share', categoryLimit: 8, sort: 'name' };
  const envelope = observations => ({ format: 'wunderkammer.observations', version: 1, comparison, observations });
  await writeFile(path.join(dir, 'obs.json'), JSON.stringify(envelope([{ id: 'ginger', text: 'Ginger in both eras.', evidence: { cells: [{ value: 'ginger', cohort: '1650s' }], items: [] } }])));
  await writeFile(path.join(dir, 'obs-unresolved.json'), JSON.stringify(envelope([{ id: 'tabby', text: 'Tabbies too.', evidence: { cells: [{ value: 'tabby' }], items: ['c99'] } }])));
  await writeFile(path.join(dir, 'obs-other-corpus.json'), JSON.stringify({ ...envelope([{ id: 'ginger', text: 'Ginger.', evidence: { cells: [{ value: 'ginger' }], items: [] } }]),
    comparison: { ...comparison, corpus: { id: 'fixture:other', revision: 'r1' } } }));
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('a valid local collection with its files present passes, counted in its own nouns', () => {
  const r = cli(path.join(dir, 'good.json'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /valid · 6 cats/);
});

test('an invalid collection exits 1 and lists every problem with its path', () => {
  const r = cli(path.join(dir, 'bad.json'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const where of ['format', 'clips[0].sourceUrl', 'clips[1].props.source']) assert.ok(r.stdout.includes(where), `${where} missing from:\n${r.stdout}`);
});

test('a local cover the page would request but cannot find fails the check', () => {
  const r = cli(path.join(dir, 'missing.json'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /missing: clips\[6\]\.cover .*media\/6\.png does not exist/);
  const json = JSON.parse(cli(path.join(dir, 'missing.json'), '--json').stdout);
  assert.equal(json.collection.missing.length, 2);
});

test('observations print the figures the page will compute', () => {
  const r = cli(path.join(dir, 'good.json'), '--observations', path.join(dir, 'obs.json'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // Six cats: the 1650s are i = 0, 2 and 4, and ginger is i % 3 === 0, so 1 of 3.
  assert.match(r.stdout, /ginger: ginger · 1650s: 1 of 3 · 33\.3%/);
});

test('a citation the page cannot resolve, or observations for another corpus, fail the check', () => {
  const unresolved = cli(path.join(dir, 'good.json'), '--observations', path.join(dir, 'obs-unresolved.json'));
  assert.equal(unresolved.status, 1, unresolved.stdout + unresolved.stderr);
  assert.match(unresolved.stdout, /unresolved: “tabby” is not among the measured values/);
  assert.match(unresolved.stdout, /unresolved: item “c99” is not in this collection/);
  const other = cli(path.join(dir, 'good.json'), '--observations', path.join(dir, 'obs-other-corpus.json'));
  assert.equal(other.status, 1, other.stdout + other.stderr);
  assert.match(other.stdout, /names a different corpus/);
});

test('usage and unreadable input exit 2', () => {
  assert.equal(cli().status, 2);
  assert.equal(cli(path.join(dir, 'nope.json')).status, 2);
});
