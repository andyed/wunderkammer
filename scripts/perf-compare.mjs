#!/usr/bin/env node
/**
 * Side-by-side of two perf.mjs runs as a Markdown table.
 *
 *   node scripts/perf-compare.mjs .local/perf/<before>.json .local/perf/<after>.json
 *
 * Rows are matched by scenario name (facet values in a name are ignored, so
 * "filter on (2020s)" pairs with "filter on (1990s)"). Each cell shows
 * before → after. Frame times are milliseconds; a run in headless Chromium
 * rasterises in software, so compare like with like.
 */
import { readFile } from 'node:fs/promises';

const [a, b] = await Promise.all(process.argv.slice(2, 4).map(async f => JSON.parse(await readFile(f, 'utf8'))));
if (!a || !b) { console.error('usage: perf-compare.mjs before.json after.json'); process.exit(2); }

const key = name => name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/→ \S+/, '→').trim();
const rowsOf = run => new Map(run.rows.map(r => [key(r.name), r]));
const A = rowsOf(a), B = rowsOf(b);
const fmt = v => v == null || Number.isNaN(v) ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1);
const pair = (x, y) => `${fmt(x)} → ${fmt(y)}`;

console.log(`| scenario | script ms | layout ms (n) | style ms (n) | frame p95 ms | frame max ms | frames >33 ms |`);
console.log(`|---|---|---|---|---|---|---|`);
for (const [k, ra] of A) {
  const rb = B.get(k);
  if (!rb || !ra.frames) continue;
  console.log(`| ${k} | ${pair(ra.scriptMs, rb.scriptMs)} | ${pair(ra.layoutMs, rb.layoutMs)} (${pair(ra.layouts, rb.layouts)}) | ${pair(ra.restyleMs, rb.restyleMs)} (${pair(ra.restyles, rb.restyles)}) | ${pair(ra.frames.p95, rb.frames?.p95)} | ${pair(ra.frames.max, rb.frames?.max)} | ${pair(ra.frames.over33, rb.frames?.over33)} |`);
}
const boot = k => [A.get(k), B.get(k)];
{
  const [x, y] = boot('boot');
  if (x && y) console.log(`\nBoot: ready ${pair(x.readyMs, y.readyMs)} ms · clips on the wire ${pair(x.clips?.bytes, y.clips?.bytes)} B · images decoded in ${pair(x.images?.ms, y.images?.ms)} ms · DOM nodes ${pair(x.nodes, y.nodes)}`);
}
{
  const [x, y] = boot('spatial atlas load');
  if (x && y) console.log(`Spatial streaming: ${pair(x.drawn, y.drawn)} tiles drawn · ${pair(x.uploads, y.uploads)} uploads = ${pair(Math.round(x.uploadMB), Math.round(y.uploadMB))} MB · ${pair(x.renders, y.renders)} renders in ${pair(Math.round(x.ms / 1000), Math.round(y.ms / 1000))} s`);
}
{
  const [x, y] = boot('spatial idle 2s');
  if (x?.spatial && y?.spatial) console.log(`Spatial idle (2 s): ${pair(x.spatial.renders, y.spatial.renders)} renders · ${pair(x.scriptMs, y.scriptMs)} ms script`);
}
for (const k of ['spatial filter on', 'spatial filter off']) {
  const [x, y] = boot(k);
  if (x?.reload && y?.reload) console.log(`${k}: field ${fmt(y.reload.count)} · tiles drawn ${pair(x.reload.drawn, y.reload.drawn)} · uploads ${pair(Math.round(x.reload.uploadMB), Math.round(y.reload.uploadMB))} MB · resident again in ${pair(x.reload.ms, y.reload.ms)} ms`);
}
