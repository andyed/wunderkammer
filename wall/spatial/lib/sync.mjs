#!/usr/bin/env node
// Report (or repair) drift between the vendored muriel lib and its upstream.
//
// A vendored copy that nobody checks is the failure mode this exists to
// prevent: it keeps working, it keeps being wrong, and nothing says so. The
// check is on CONTENT, not mtime — a re-copy or a checkout resets mtimes while
// leaving the bytes stale, and an mtime fingerprint would call that fresh.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UPSTREAM = process.env.MURIEL_ROOT
  // A muriel checkout beside this repository; set MURIEL_ROOT for any other layout.
  || path.resolve(HERE, '../../../../muriel/render_assets/_lib');
const PULL = process.argv.includes('--pull');

const digest = async (p) => createHash('sha1').update(await readFile(p)).digest('hex').slice(0, 12);

let upstreamFiles;
try {
  upstreamFiles = (await readdir(UPSTREAM)).filter((f) => /\.(js|css)$/.test(f));
} catch {
  console.error(`upstream not found: ${UPSTREAM}`);
  console.error('Set MURIEL_ROOT, or accept the vendored copy as-is.');
  process.exit(2);
}

const drift = [];
for (const f of (await readdir(HERE)).filter((f) => /\.(js|css)$/.test(f) && f !== 'sync.mjs')) {
  if (!upstreamFiles.includes(f)) { drift.push([f, 'gone upstream']); continue; }
  const [a, b] = [await digest(path.join(HERE, f)), await digest(path.join(UPSTREAM, f))];
  if (a !== b) drift.push([f, `${a} vs ${b}`]);
}
for (const f of upstreamFiles) {
  const local = path.join(HERE, f);
  await readFile(local).catch(() => drift.push([f, 'new upstream, not vendored']));
}

if (!drift.length) { console.log('vendored lib matches upstream'); process.exit(0); }

console.log(`${drift.length} file(s) differ from ${UPSTREAM}:`);
for (const [f, why] of drift) console.log(`  ${f.padEnd(16)} ${why}`);

if (!PULL) { console.log('\nre-run with --pull to update'); process.exit(1); }

for (const f of upstreamFiles) {
  await writeFile(path.join(HERE, f), await readFile(path.join(UPSTREAM, f)));
}
const sha = execFileSync('git', ['-C', path.join(UPSTREAM, '../..'), 'rev-parse', 'HEAD']).toString().trim();
const vendorPath = path.join(HERE, 'VENDOR.md');
const doc = (await readFile(vendorPath, 'utf8')).replace(/`[0-9a-f]{40}`/, `\`${sha}\``);
await writeFile(vendorPath, doc);
console.log(`\npulled ${upstreamFiles.length} files at ${sha.slice(0, 12)}`);
