import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gate = fileURLToPath(new URL('../scripts/check-public.mjs', import.meta.url));
async function tree(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'check-public-'));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), body);
  }
  return dir;
}
const run = dir => spawnSync(process.execPath, [gate, dir], { encoding: 'utf8' });
// Built by concatenation, so the gate can scan this file without an exemption.
const j = (...parts) => parts.join('');
const clean = {
  'README.md': '# wunderkammer\n\nSee [the contract](docs/CONTRACT.md) and [a section](docs/CONTRACT.md#observations).\n',
  'docs/CONTRACT.md': 'Format `wunderkammer.collection`.\n',
  'wall/x.mjs': "export const format = 'wunderkammer.collection';\n",
};

test('a clean tree passes and says how much it read', async () => {
  const dir = await tree(clean);
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 files, 3 text files scanned, no findings/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an empty tree is not a pass', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'check-public-'));
  try { assert.equal(run(dir).status, 2); } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [name, files, pattern] of [
  ['a home path in a doc', { 'docs/a.md': j('Run it from /Us', 'ers/someone/code.\n') }, /docs\/a\.md:1: absolute home path/],
  ['a mounted volume in a config', { 'examples/x.json': j('{"path": "/Vol', 'umes/drive/Music"}\n') }, /mounted-volume path/],
  ['one machine\'s folder layout', { 'scripts/s.sh': j('cd ~/Documents', '/dev/thing\n') }, /folder layout/],
  ['a pre-release contract name in code', { 'wall/y.mjs': j("if (data.type === 'clip", "wall:ready') {}\n") }, new RegExp(j('pre-release contract name — clip', 'wall:ready'))],
  ['the old window global', { 'tests/t.mjs': j('window.clip', 'wall.export();\n') }, /pre-release contract name — window\.clipwall/],
  ['local instance state', { '.local/music/index.json': '{}\n' }, /\.local\/music\/index\.json: private path/],
  ['an instance config', { 'myinstance.config.json': '{}\n' }, /private path/],
  ['media nobody chose', { 'docs/shot.png': 'not really a png' }, /docs\/shot\.png: media not on the allowlist/],
  ['a link to a missing file', { 'docs/b.md': 'See [the handoff](HANDOFF.md).\n' }, /link to a missing file — HANDOFF\.md/],
]) {
  test(`the gate fails on ${name}`, async () => {
    const dir = await tree({ ...clean, ...files });
    try {
      const r = run(dir);
      assert.equal(r.status, 1, `expected a finding\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, pattern);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test('the naming record may quote the old contract names', async () => {
  const dir = await tree({ ...clean, 'docs/NAMING.md': j('Renamed `clip', 'wall.collection` to `wunderkammer.collection`.\n') });
  try { assert.equal(run(dir).status, 0); } finally { await rm(dir, { recursive: true, force: true }); }
});
