#!/usr/bin/env node
/**
 * Scale sweep: how the wall's costs grow with corpus size.
 *
 * docs/PERF.md says the architecture's bounds "do not establish support for
 * 25,000 clips". This measures it instead. It multiplies a real image index
 * (default: the Psychodeli Atlas, 406 screenshots) into synthetic corpora of
 * N items, serves each from a throwaway instance, and runs scripts/perf.mjs
 * against it. Each copy gets a unique id and a shifted capture date, so
 * grouping, faceting and layout see N distinct items.
 *
 *   node scripts/perf-scale.mjs [--sizes 406,2000,5000,10000,25000]
 *        [--source .local/psychodeli-atlas/wunderkammer.config.json]
 *        [--scenario flat] [--headed --chrome] [--runs 1] [--port 4300] [--no-sheets]
 *
 * Caveat, stated in every report: copies share their image files, so the
 * browser's HTTP cache serves repeats. Decode and DOM costs scale with N;
 * network and disk do not. Treat image-arrival numbers as a floor.
 *
 * Overview sheets, by contrast, are baked per instance with a distinct digest
 * per copy (scripts/sheets.py), so page count, page bytes and decoded pixels
 * grow with N as they would for N distinct covers. Each instance gets its own
 * cache directory: symlinks to the source's media folders plus its own sheets.
 * --no-sheets serves the source cache as before, without sheets.
 *
 * Writes only under .local/perf-scale/ (instances) and .local/perf/ (runs).
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, symlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);
const SIZES = arg('--sizes', '406,2000,5000,10000,25000').split(',').map(Number).filter(n => n > 0);
const SOURCE = path.resolve(ROOT, arg('--source', '.local/psychodeli-atlas/wunderkammer.config.json'));
const SCENARIO = arg('--scenario', 'flat');
const RUNS = arg('--runs', '1');
// Not 4190: that port is on the Fetch standard's blocked list (sieve), so Chrome and node refuse it.
const BASE_PORT = Number(arg('--port', 4300));
const OUT = path.join(ROOT, '.local/perf');
const WORK = path.join(ROOT, '.local/perf-scale');
const passthrough = ['--headed', '--chrome'].filter(flag);
const SHEETS = !flag('--no-sheets');

const DAY = 86400000;

async function buildInstance(n, sourceConfig, sourceIndex) {
  const dir = path.join(WORK, `n${n}`);
  await mkdir(dir, { recursive: true });
  const base = sourceIndex.images;
  const images = [];
  for (let i = 0; i < n; i++) {
    const src = base[i % base.length], copy = Math.floor(i / base.length);
    // Shift each copy back by ~5 weeks so capture-month groups multiply too,
    // rather than piling N/406 items into the original months.
    // Partial dates ("2014", "2014-06") cannot shift; they keep their bucket.
    const t = Date.parse(String(src.captured).length >= 19 ? src.captured + 'Z' : src.captured);
    const when = copy && Number.isFinite(t) ? new Date(t - copy * 37 * DAY).toISOString().slice(0, 19) : src.captured;
    // A copy is a distinct cover as far as the sheets are concerned; its media
    // paths still name the source's files.
    const sha256 = copy && SHEETS ? createHash('sha256').update(`${src.sha256}:${copy}`).digest('hex') : src.sha256;
    images.push({ ...src, id: copy ? `${src.id}-x${copy}` : src.id, captured: when, sha256 });
  }
  await writeFile(path.join(dir, 'index.json'), JSON.stringify({ ...sourceIndex, images }));
  const sourceCache = path.resolve(path.dirname(SOURCE), sourceConfig.imageCache);
  let imageCache = sourceCache;
  if (SHEETS) {
    imageCache = path.join(dir, 'cache');
    await rm(imageCache, { recursive: true, force: true });
    await mkdir(imageCache, { recursive: true });
    for (const folder of ['thumbs', 'thumbs-small', 'previews']) await symlink(path.join(sourceCache, folder), path.join(imageCache, folder));
    await run('python3', [path.join(HERE, 'sheets.py'), '--index', path.join(dir, 'index.json'), '--cache', imageCache]);
  }
  const config = { ...sourceConfig, imageIndex: 'index.json',
    imageCache,
    corpusName: `scale fixture n=${n}`, ui: { ...(sourceConfig.ui || {}), title: `Scale ${n}` } };
  delete config.viewStatePath; delete config.port;
  const file = path.join(dir, 'wunderkammer.config.json');
  await writeFile(file, JSON.stringify(config, null, 2));
  return file;
}

function run(cmd, argv, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; process.stdout.write(d); });
    child.stderr.on('data', d => { out += d; process.stderr.write(d); });
    child.on('exit', code => code === 0 || code === 1 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`)));
  });
}

async function waitUp(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`no server at ${url}`);
}

async function newestRun(label) {
  const files = (await readdir(OUT)).filter(f => f.includes(`-${label}`) && f.endsWith('.json') && !f.endsWith('-summary.json')).sort();
  return JSON.parse(await readFile(path.join(OUT, files.at(-1)), 'utf8'));
}

const pick = (rows, prefix) => rows.find(r => r.name.startsWith(prefix));
const span = (row, name) => row?.app?.spans?.[name]?.maxMs ?? null;

async function main() {
  const sourceConfig = JSON.parse(await readFile(SOURCE, 'utf8'));
  const sourceIndex = JSON.parse(await readFile(path.resolve(path.dirname(SOURCE), sourceConfig.imageIndex), 'utf8'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const table = [];
  for (const [k, n] of SIZES.entries()) {
    const file = await buildInstance(n, sourceConfig, sourceIndex);
    const port = BASE_PORT + k;
    const server = spawn(process.execPath, ['serve.mjs', '--config', file], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    try {
      await waitUp(`http://127.0.0.1:${port}/api/clips`);
      const label = `scale-n${n}-${stamp}`;
      console.log(`\n=== n=${n} on :${port} ===`);
      await run(process.execPath, ['scripts/perf.mjs', '--url', `http://127.0.0.1:${port}`, '--scenario', SCENARIO,
        '--label', label, '--runs', RUNS, '--atlas-timeout', '90000', ...passthrough]);
      const r = await newestRun(label);
      const boot = pick(r.rows, 'boot'), pan = pick(r.rows, 'flat pan ('), zin = pick(r.rows, 'flat zoom in'),
        zout = pick(r.rows, 'flat zoom out'), fon = pick(r.rows, 'flat filter on'), grp = pick(r.rows, 'flat group'),
        sp = pick(r.rows, 'spatial atlas load'), spPan = pick(r.rows, 'spatial pan');
      table.push({ n, readyMs: boot?.readyMs, wireKB: Math.round((boot?.clips?.bytes || 0) / 1024),
        jsonKB: Math.round((boot?.clips?.decodedBytes || 0) / 1024), nodes: r.final?.nodes, heapMB: r.final?.heapMB,
        bootRenderMs: span(boot, 'render'), panP95: pan?.frames?.p95, panScriptMs: pan?.scriptMs,
        zoomInScriptMs: zin?.scriptMs, zoomOutScriptMs: zout?.scriptMs, zoomOutMaxFrame: zout?.frames?.max,
        filterRenderMs: span(fon, 'render'), filterLayoutMs: span(fon, 'render/layout'), filterTilesMs: span(fon, 'render/tiles'),
        groupRenderMs: span(grp, 'render'), spatialResident: sp ? `${sp.resident}/${sp.count}` : null, spatialPanScriptMs: spPan?.scriptMs,
        errors: r.errors?.length ?? 0 });
    } finally { server.kill(); }
  }
  const md = ['| n | ready ms | /api/clips wire KB (JSON KB) | DOM nodes | heap MB | boot render ms | pan p95 ms | pan script ms | zoom in / out script ms | zoom out max frame | filter render ms (layout · tiles) | group render ms |' + (SCENARIO !== 'flat' ? ' 3D resident | 3D pan script ms |' : ''),
    '|---|---|---|---|---|---|---|---|---|---|---|---|' + (SCENARIO !== 'flat' ? '---|---|' : '')];
  for (const t of table) md.push(`| ${t.n} | ${t.readyMs} | ${t.wireKB} (${t.jsonKB}) | ${t.nodes} | ${t.heapMB} | ${t.bootRenderMs} | ${t.panP95} | ${t.panScriptMs} | ${t.zoomInScriptMs} / ${t.zoomOutScriptMs} | ${t.zoomOutMaxFrame} | ${t.filterRenderMs} (${t.filterLayoutMs} · ${t.filterTilesMs}) | ${t.groupRenderMs} |` + (SCENARIO !== 'flat' ? ` ${t.spatialResident} | ${t.spatialPanScriptMs} |` : ''));
  const report = { when: new Date().toISOString(), source: SOURCE, scenario: SCENARIO, mode: passthrough.join(' ') || 'headless chromium',
    caveat: 'copies share image files; HTTP cache serves repeats, so network/disk do not scale with n'
      + (SHEETS ? '; overview sheets are baked per instance with one distinct slot per copy, so sheets do scale with n' : '; no sheets'), table };
  const file = path.join(OUT, `${stamp}-scale-sweep.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(`\n${md.join('\n')}\n\n  → ${file}`);
}

main().catch(err => { console.error(err); process.exit(1); });
