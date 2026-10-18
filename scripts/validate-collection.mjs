#!/usr/bin/env node
// Check a collection document, and optionally its observations, the way the
// wall and the comparison page will read them, before a person opens the link.
//
//   node scripts/validate-collection.mjs <collection.json | url> [--observations <file | url>] [--json]
//
// Exit 0: the page will load it and every claim resolves.
// Exit 1: problems, each with its path: an invalid document, a local cover or
//         sheet file that is missing, observations written for another corpus,
//         or a citation the page cannot resolve.
// Exit 2: usage, or a file that cannot be read or parsed.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validateCollection, CollectionError } from '../wall/collection.mjs';
import { validateObservations, resolveObservation, ObservationError } from '../wall/observations.mjs';
import { buildComparison } from '../wall/comparison-model.mjs';
import { collectionNouns, counted } from '../wall/nouns.mjs';

// The validator accepts http(s), data:image/ and blob: media, as a browser
// page would load them. A local document is therefore read under a stand-in
// http origin whose path is the file's own path, so a relative cover resolves
// to a URL that maps straight back to a file on disk.
const LOCAL = 'http://wunderkammer.local';

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/validate-collection.mjs <collection.json | url> [--observations <file | url>] [--json]');
  process.exit(2);
}

function parseArgs(argv) {
  const out = { collection: null, observations: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--observations') { out.observations = argv[++i]; if (!out.observations) usage('--observations needs a file or URL'); }
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else if (!out.collection) out.collection = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!out.collection) usage();
  return out;
}

/** Read JSON from a path or an http(s) URL; returns { json, baseUrl, dir }. */
async function load(source, label) {
  let text, baseUrl, dir = null;
  try {
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text(); baseUrl = source;
    } else {
      const abs = path.resolve(source);
      text = await readFile(abs, 'utf8');
      baseUrl = LOCAL + pathToFileURL(abs).pathname; dir = path.dirname(abs);
    }
  } catch (err) { console.error(`${label}: cannot read ${source}: ${err.message}`); process.exit(2); }
  try { return { json: JSON.parse(text), baseUrl, dir }; }
  catch (err) { console.error(`${label}: not JSON: ${err.message}`); process.exit(2); }
}

/** Local media the page will request: files named relative to a local document. */
function missingLocalMedia(collection) {
  const urls = [];
  for (const [i, clip] of collection.clips.entries()) {
    const at = `clips[${i}]`;
    if (clip.cover) urls.push([`${at}.cover`, clip.cover]);
    if (clip.detailCover) urls.push([`${at}.detailCover`, clip.detailCover]);
    for (const [j, v] of (clip.coverVariants || []).entries()) urls.push([`${at}.coverVariants[${j}].src`, v.src]);
    for (const [j, m] of (clip.media || []).entries()) urls.push([`${at}.media[${j}].src`, m.src]);
  }
  for (const [i, sheet] of (collection.sheets || []).entries()) urls.push([`sheets[${i}].src`, sheet.src]);
  const missing = [];
  for (const [where, url] of urls) {
    if (typeof url !== 'string' || !url.startsWith(`${LOCAL}/`)) continue;
    const file = fileURLToPath('file://' + new URL(url).pathname);
    if (!existsSync(file)) missing.push(`${where} ${file} does not exist`);
  }
  return missing;
}

const args = parseArgs(process.argv.slice(2));
const report = { collection: { source: args.collection, valid: false, problems: [], warnings: [], missing: [] } };
let failed = false;

const doc = await load(args.collection, 'collection');
let collection = null;
try {
  const result = validateCollection(doc.json, { baseUrl: doc.baseUrl });
  collection = result.collection;
  report.collection.warnings = result.warnings || [];
  report.collection.valid = true;
} catch (err) {
  if (!(err instanceof CollectionError)) throw err;
  report.collection.problems = err.problems;
  failed = true;
}

if (collection) {
  report.collection.missing = doc.dir ? missingLocalMedia(collection) : [];
  if (report.collection.missing.length) failed = true;
  const nouns = collectionNouns({ clips: collection.clips, ui: collection.ui });
  report.collection.summary = {
    title: collection.ui?.title || null, items: collection.clips.length, nouns: { item: nouns.item, items: nouns.items },
    corpus: collection.corpus, sheets: (collection.sheets || []).length,
    facets: Object.fromEntries(Object.entries(collection.facets || {}).map(([k, values]) => [k, Object.keys(values).length]).filter(([, n]) => n > 0)),
  };
}

if (args.observations) {
  const obs = await load(args.observations, 'observations');
  const out = report.observations = { source: args.observations, valid: false, problems: [], resolved: [] };
  let envelope = null;
  try { envelope = validateObservations(obs.json); out.valid = true; }
  catch (err) { if (!(err instanceof ObservationError)) throw err; out.problems = err.problems; failed = true; }
  if (envelope && collection) {
    const want = collection.corpus, named = envelope.comparison.corpus || {};
    if (named.id !== want.id || (named.revision ?? null) !== (want.revision ?? null)) {
      out.problems.push(`comparison.corpus names ${JSON.stringify(named)}, but the collection is ${JSON.stringify({ id: want.id, revision: want.revision ?? null })}; the page will say the recipe names a different corpus`);
      failed = true;
    }
    let model = null;
    try { model = buildComparison(collection.clips, envelope.comparison); }
    catch (err) { out.problems.push(`comparison cannot be built from this collection: ${err.message}`); failed = true; }
    if (model) {
      for (const o of envelope.observations) {
        const r = resolveObservation(model, o);
        out.resolved.push({ id: r.id, figures: r.figures, items: r.keys.length, unresolved: r.unresolved });
        if (r.unresolved.length || !r.keys.length) failed = true;
      }
    }
  }
}

if (args.json) {
  console.log(JSON.stringify(report, null, 1));
} else {
  const c = report.collection;
  if (c.valid) {
    const s = c.summary;
    console.log(`${c.source}: valid · ${counted(s.items, s.nouns)}${s.title ? ` · “${s.title}”` : ''} · corpus ${s.corpus.id}${s.corpus.revision ? `@${s.corpus.revision}` : ''}${s.sheets ? ` · ${s.sheets} sheet pages` : ''}`);
    const facets = Object.entries(s.facets).map(([k, n]) => `${k} (${n})`).join(', ');
    if (facets) console.log(`  facets: ${facets}`);
  } else {
    console.log(`${c.source}: not valid`);
  }
  for (const p of c.problems) console.log(`  problem: ${p}`);
  for (const m of c.missing.slice(0, 10)) console.log(`  missing: ${m}`);
  if (c.missing.length > 10) console.log(`  missing: …and ${c.missing.length - 10} more (--json lists every one)`);
  for (const w of c.warnings) console.log(`  warning: ${w}`);
  const o = report.observations;
  if (o) {
    console.log(`${o.source}: ${o.valid ? 'valid' : 'not valid'}`);
    for (const p of o.problems) console.log(`  problem: ${p}`);
    for (const r of o.resolved) {
      const figures = r.figures.map(f => `${f.value} · ${f.cohort}: ${f.count} of ${f.denominator} · ${(f.share * 100).toFixed(1)}%`).join('; ');
      console.log(`  ${r.id}: ${figures || 'no figures'} · ${r.items} cited items`);
      for (const u of r.unresolved) console.log(`    unresolved: ${u}`);
      if (!r.items && !r.unresolved.length) console.log('    unresolved: nothing it cites resolves, so it offers no evidence');
    }
  }
}
process.exitCode = failed ? 1 : 0;
