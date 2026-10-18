#!/usr/bin/env node
/**
 * The public-tree gate. Fails when a tree that is meant to be published
 * carries local instance state, a machine's own paths, a pre-release contract
 * name, media nobody chose to publish, or a link to a file that is not there.
 * It holds generic rules only; checks that would have to name private material
 * belong to whatever produces the tree, not to the public tree itself.
 *
 *   node scripts/check-public.mjs [dir]      # default: the repository root
 *
 * Exits 1 on any finding and 2 when nothing was scanned: a gate that read no
 * files has checked nothing, and must not report a pass.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** Local instance state, never published whatever its content. */
const PRIVATE_PATHS = [
  /^\.local\//, /^dist-demo\//, /(^|\/)view-state\.json$/, /\.instance-id$/, /\.permalinks\//, /^[\w-]+\.config\.json$/,
];
/** Text that identifies one machine. */
const PRIVATE_TEXT = [
  [/\/Users\/[A-Za-z][\w.-]*/, 'absolute home path'],
  [/\/Volumes\/[\w.-]+/, 'mounted-volume path'],
  [/\/home\/[a-z][\w.-]*\//, 'absolute home path'],
  [/Documents\/dev\b/, 'one machine\'s folder layout'],
];
/** Contract names from before the release; the naming record may quote them. */
const LEGACY_CONTRACT = /clipwall\.(collection|observations|export)\b|clipwall:(ready|collection|view-ready|error)\b|window\.clipwall\b|clipwall-collection\b/;
const LEGACY_ALLOWED = [/^docs\/NAMING\.md$/, /^docs\/naming\//, /^scripts\/check-public\.mjs$/];
/** The only media that may be published, by path. */
const MEDIA = /\.(png|jpe?g|webp|gif|avif|mp3|m4a|flac|wav|mp4|mov|pdf)$/i;
const MEDIA_ALLOWED = new Set(['docs/wall.png', 'docs/wall-overview.png']);
/** Sprite-sheet pages are published by naming them: a collection document in
 * the tree lists the page in its `sheets`, and the page is named by the
 * SHA-256 of its bytes, as scripts/collection-sheets.py writes it. A page no
 * document names, or whose bytes have changed under its name, is a finding. */
const SHEET_PAGE = /(^|\/)([0-9a-f]{64})\.(webp|png|jpe?g|avif)$/;
const TEXT = /\.(m?js|cjs|json|md|html|css|py|sh|txt|tsv|ya?ml|toml)$|(^|\/)(LICENSE|\.gitignore)$/;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

async function walk(dir, rel = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), r));
    else if (entry.isFile() || entry.isSymbolicLink()) out.push(r);
  }
  return out;
}

const findings = [];
const note = (file, rule, detail) => findings.push(`${file}: ${rule}${detail ? ` — ${detail}` : ''}`);

let files;
try { files = await walk(root); } catch (error) { console.error(`check-public: cannot read ${root}: ${error.message}`); process.exit(2); }
const present = new Set(files);
const sheetPages = new Set();
for (const file of files.filter(f => f.endsWith('.json'))) {
  let doc;
  try { doc = JSON.parse(await readFile(path.join(root, file), 'utf8')); } catch { continue; }
  if (doc?.format !== 'wunderkammer.collection' || !Array.isArray(doc.sheets)) continue;
  for (const sheet of doc.sheets) {
    if (typeof sheet?.src !== 'string' || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(sheet.src)) continue;
    sheetPages.add(path.posix.normalize(path.posix.join(path.posix.dirname(file), sheet.src.split(/[?#]/)[0])));
  }
}
let scanned = 0;
for (const file of files) {
  if (PRIVATE_PATHS.some(re => re.test(file))) note(file, 'private path');
  if (MEDIA.test(file) && !MEDIA_ALLOWED.has(file)) {
    const page = file.match(SHEET_PAGE);
    if (!page || !sheetPages.has(file)) note(file, 'media not on the allowlist');
    else if (createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') !== page[2]) note(file, 'sheet page bytes do not match its content-hash name');
  }
  if (!TEXT.test(file)) continue;
  const text = await readFile(path.join(root, file), 'utf8');
  scanned++;
  text.split('\n').forEach((line, i) => {
    for (const [re, rule] of PRIVATE_TEXT) { const m = line.match(re); if (m) note(`${file}:${i + 1}`, rule, m[0]); }
    if (!LEGACY_ALLOWED.some(re => re.test(file))) { const m = line.match(LEGACY_CONTRACT); if (m) note(`${file}:${i + 1}`, 'pre-release contract name', m[0]); }
  });
  if (file.endsWith('.md')) {
    // Relative links must land on a file in this tree.
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#|data:)/.test(target)) continue;
      const clean = decodeURIComponent(target.split('#')[0].split('?')[0]);
      if (!clean) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), clean)).replace(/\/$/, '');
      const ok = present.has(resolved) || files.some(f => f.startsWith(`${resolved}/`));
      if (!ok) note(file, 'link to a missing file', target);
    }
  }
}

if (!scanned) { console.error(`check-public: no text files under ${root}; nothing was checked`); process.exit(2); }
if (findings.length) {
  console.error(`check-public: ${findings.length} finding${findings.length === 1 ? '' : 's'} in ${root}`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(`check-public: ${files.length} files, ${scanned} text files scanned, no findings`);
