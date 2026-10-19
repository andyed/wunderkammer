#!/usr/bin/env node
/**
 * Build a static, server-less demo of one running instance for GitHub Pages.
 *
 *   node scripts/build-demo.mjs --from http://127.0.0.1:4174 --out dist-demo [--width 480] [--drop examples/psychodeli-demo-exclude.json]
 *   node scripts/build-demo.mjs --reuse-corpus dist-demo --out .local/demo-preview/clipwall-demo
 *
 * Reads /api/clips from the running instance, re-encodes each cover as a
 * low-res WebP, strips filesystem paths, and writes the corpus as one
 * collection document (wall/collection.mjs) that the copied wall loads through
 * a meta tag. Piles are kept for the visit only and links carry the full view:
 * both stores need a server.
 *
 * The build fails, writing no collection.json, when the collection names a
 * file on the demo's site (--site) that the output lacks, or names none.
 */
import { mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { toCollection, validateCollection, collectionImages } from '../wall/collection.mjs';
const run = promisify(execFile);
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const from = arg('--from', 'http://127.0.0.1:4174'), out = path.resolve(arg('--out', 'dist-demo')), width = Number(arg('--width', 480));
const reuse = arg('--reuse-corpus', null);
// Where the demo is served from: the page reads collection.json there, so the
// collection's relative images resolve against it, as do absolute ones on it.
const site = new URL(arg('--site', 'https://andyed.github.io/clipwall-demo/')).href.replace(/\/?$/, '/');
const published = reuse ? path.resolve(reuse) : null;
if (published && !path.relative(out, published).startsWith(`..${path.sep}`)) {
  throw new Error('--reuse-corpus must be outside the output directory; build to a separate staging folder');
}

// A published build is read in either layout: one collection.json, or the
// earlier data/clips.json + api/view-state.json pair it replaces.
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
const publishedCollection = published ? await readJSON(path.join(published, 'collection.json')).catch(() => null) : null;
const publishedData = published && !publishedCollection ? await readJSON(path.join(published, 'data', 'clips.json')) : null;
const api = publishedCollection || publishedData || await (await fetch(`${from}/api/clips`)).json();
// Overview sheets name the instance's private /media/sheets pages (see below).
if (!published) delete api.sheets;
// Optional exclusion list ({ exclude: [{ id }] }): frames that must not be published.
const dropFile = arg('--drop', null);
if (published && dropFile) throw new Error('--reuse-corpus preserves the published data exactly; --drop requires a fresh instance build');
if (dropFile) {
  const drop = new Set(JSON.parse(await readFile(dropFile, 'utf8')).exclude.map(e => e.id));
  const before = api.clips.length;
  api.clips = api.clips.filter(c => !drop.has(c.id));
  console.log(`dropped ${before - api.clips.length} of ${before} per ${dropFile}`);
}
// Clear the output but keep its .git: the folder doubles as the demo repo's checkout.
const { readdir } = await import('node:fs/promises');
await mkdir(out, { recursive: true });
for (const entry of await readdir(out)) if (entry !== '.git') await rm(path.join(out, entry), { recursive: true, force: true });
await mkdir(path.join(out, 'media'), { recursive: true });

const local = p => !p || p.startsWith('/') || p.startsWith('file:');
let n = 0;
const sheets = published && existsSync(path.join(published, 'sheets'));
if (published) {
  // App-only updates reuse the already published corpus and derivatives byte
  // for byte. They never consult a private instance or add newly indexed media.
  await cp(path.join(published, 'media'), path.join(out, 'media'), { recursive: true });
  // sheets/ holds the sprite-sheet pages a collection's sheetSlots point into.
  if (sheets) await cp(path.join(published, 'sheets'), path.join(out, 'sheets'), { recursive: true });
}
for (const clip of published ? [] : api.clips) {
  const src = clip.cover || clip.media?.[0]?.src;
  if (src && src.startsWith('/media/')) {
    const name = `${clip.id}.webp`.replace(/[^\w.-]/g, '_');
    const buf = Buffer.from(await (await fetch(from + src)).arrayBuffer());
    const tmp = path.join(out, 'media', `${name}.src`);
    await writeFile(tmp, buf);
    await run('cwebp', ['-quiet', '-q', '72', '-resize', String(width), '0', tmp, '-o', path.join(out, 'media', name)]);
    await rm(tmp);
    const rel = `media/${name}`;
    clip.cover = rel; clip.detailCover = rel; clip.media = [{ src: rel }];
    delete clip.coverVariants;
    // The demo re-encodes its own covers and does not ship the instance's
    // baked overview pages; it loads covers per file.
    delete clip.sheetSlots;
    n++;
  }
  if (local(clip.sourceUrl)) delete clip.sourceUrl;
  // An opaque urn keeps identity without a path; collection urls are http(s) or urn.
  if (local(clip.url)) clip.url = `urn:clipwall:demo:${encodeURIComponent(clip.id)}`;
  for (const m of clip.media || []) if (local(m.src) && !m.src.startsWith('media/')) delete m.src;
}
let collection = publishedCollection;
if (!collection) {
  const viewState = publishedData
    ? await readJSON(path.join(published, 'api', 'view-state.json')).catch(() => null)
    : null;
  const converted = toCollection(api, { viewState: viewState || { version: 1, mode: 'mountain', groupKey: api.ui?.defaultGroup || 'none', piles: [] } });
  collection = converted.collection;
  const removed = Object.entries(converted.removed);
  if (removed.length) console.log(`not published (outside the collection format): ${removed.map(([k, n]) => `${k} ×${n}`).join(', ')}`);
}
// Fail the build, not the visitor's page, on a document the wall would refuse.
const { warnings, collection: resolved } = validateCollection(collection, { baseUrl: new URL('collection.json', site).href });
for (const warning of warnings) console.warn(`collection: ${warning}`);
// The output is synced to the site with --delete, so an image the collection
// names on the site but the output lacks is one the sync deletes from the live
// demo. Images on other hosts are not the build's to check.
// Two clips may share a file, so files are counted once; each reference is listed.
const named = new Set(), lacking = new Set(), missing = [];
for (const [where, src] of collectionImages(resolved)) {
  if (!src.startsWith(site)) continue;
  const encoded = new URL(src).pathname.slice(new URL(site).pathname.length);
  let rel = encoded;
  try { rel = decodeURIComponent(encoded); } catch { /* a malformed escape names no file; reported as missing */ }
  const file = path.resolve(out, rel);
  named.add(rel);
  if (!file.startsWith(out + path.sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) { lacking.add(rel); missing.push(`${where} ${rel}`); }
}
if (missing.length || !named.size) {
  console.error(missing.length
    ? `build-demo: collection.json names ${lacking.size} of ${named.size} files on ${site} that the output lacks:`
    : `build-demo: collection.json names no file on ${site}, so the output cannot be checked against it; pass --site with the address the demo is served from.`);
  for (const m of missing.slice(0, 10)) console.error(`  missing: ${m}`);
  if (missing.length > 10) console.error(`  missing: …and ${missing.length - 10} more`);
  console.error(`build-demo: FAILED. ${out} has no collection.json and is not a demo; do not sync it.`);
  process.exit(1);
}
await writeFile(path.join(out, 'collection.json'), JSON.stringify(collection));

// The public app includes the shared artwork renderer and main aisle view.
// The comparison workbench remains a local spike, outside the demo bundle.
// comparison-copy.mjs ships: album-walls.mjs, the aisle's renderer, takes its
// neutral wall labels from it. tests/demo-bundle.test.mjs follows the bundle's imports.
const workbench = name => ['compare.html', 'comparison.css'].includes(name) || name.startsWith('comparison-') && name !== 'comparison-copy.mjs';
await cp('wall', path.join(out, 'wall'), { recursive: true, filter: source => !workbench(path.basename(source)) });
const rewrite = async (file, pairs) => { let s = await readFile(file, 'utf8'); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(`${file}: expected ${a}`); s = s.split(a).join(b); } await writeFile(file, s); };
await cp('index.html', path.join(out, 'index.html'));
// The served page loads its collection; ?collection= on the URL still overrides it.
await rewrite(path.join(out, 'index.html'), [['<head>', '<head>\n<meta name="wunderkammer-collection" content="collection.json">']]);
// Analytics belong to the published demo, not the engine: wall/ and index.html
// carry none, so a page that embeds wunderkammer reports to nobody.
// docs/DEMO_ANALYTICS.md lists the events; the script gates itself to the demo host.
const version = await run('git', ['describe', '--tags', '--always', '--dirty']).then(r => r.stdout.trim(), () => 'unknown');
await writeFile(path.join(out, 'analytics.js'),
  (await readFile('scripts/demo-analytics.js', 'utf8')).replace("'__WUNDERKAMMER_DEMO_VERSION__'", JSON.stringify(version)));
// Ahead of wall.mjs, so it sees the URL the visitor opened and the wall's boot errors.
await rewrite(path.join(out, 'index.html'), [['</head>', '<script type="module" src="analytics.js"></script>\n</head>']]);
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'README.md'), `# wunderkammer demo\n\n**Open the demo: ${site}**\n\nA pan/zoom wall of ${api.clips.length} ${api.ui?.title || 'corpus'} frames. Approach a group without changing the collection, lift an image into the reader, then close and return to your place. The separate filter control changes membership. In 3D, open a stack to spread its contents and return to the original view. Search and zoom-out retain the surrounding collection as context.\n\nStatic build for GitHub Pages generated by \`scripts/build-demo.mjs\` in the wunderkammer repo; images are low-resolution derivatives. Piles last for the visit and links carry the full view; saving either needs the wunderkammer server. This is an experimental demo; dense transitions and cold atlas-loading performance remain work in progress.\n\nThe demo counts visits with PostHog: cookieless, no session replay, no search text, and no ids from a collection you load yourself. \`?ph=0\` turns it off. The events are listed in the wunderkammer repo's \`docs/DEMO_ANALYTICS.md\`.\n`);
console.log(`built ${out}: ${collection.clips.length} clips in collection.json, ${published ? `published corpus, media${sheets ? ' and sheets' : ''} preserved` : `${n} covers at ${width}px`}; all ${named.size} files it names on ${site} are present`);
