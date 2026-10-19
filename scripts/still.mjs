#!/usr/bin/env node
/**
 * One still of a collection view, for slides, posts and documents, plus a
 * sidecar JSON that says exactly what the image shows.
 *
 *   node scripts/still.mjs --collection cats.collection.json \
 *     --view 'view=float&arrange=axes&across=decade' --size 1600x900 --scale 2 --out axes.png
 *
 * --view takes the same keys as a live link (view, arrange, across, up, depth,
 * q, facet.<key>, group, lens, highlight.<key>, focus, ...), or an exact link's
 * fragment ('#v=1&s=...') to reproduce a still from its sidecar. The page runs
 * with ?chrome=none, so the image is the stage alone, and the shot is taken
 * only when window.wunderkammer.whenStill() says the pixels are final.
 *
 * It fails, writing nothing, when the collection or the link is refused, the
 * page throws, the view never settles, or flat-wall tiles are left undrawn
 * (--allow-undrawn accepts them). See docs/STILLS.md.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeView } from '../wall/permalink.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
const USAGE = `usage: node scripts/still.mjs --collection <file or URL> [--view '<link keys>'] [--size 1600x900] [--scale 2] [--out still.png] [--timeout 60000] [--allow-undrawn]`;

class StillError extends Error {}
const fail = message => { throw new StillError(message); };

function options(argv) {
  const { values } = parseArgs({ args: argv, options: {
    collection: { type: 'string' }, view: { type: 'string', default: '' }, size: { type: 'string', default: '1600x900' },
    scale: { type: 'string', default: '2' }, out: { type: 'string', default: 'still.png' }, timeout: { type: 'string', default: '60000' },
    'allow-undrawn': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  if (!values.collection) fail(`--collection is required\n${USAGE}`);
  const size = /^(\d{2,5})x(\d{2,5})$/.exec(values.size);
  if (!size) fail(`--size must be WIDTHxHEIGHT in CSS pixels, e.g. 1600x900 (got ${values.size})`);
  const scale = Number(values.scale), timeout = Number(values.timeout);
  if (!(scale >= 1 && scale <= 4)) fail(`--scale must be between 1 and 4 (got ${values.scale})`);
  if (!(timeout >= 1000)) fail(`--timeout is in milliseconds, at least 1000 (got ${values.timeout})`);
  const type = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg' }[path.extname(values.out).toLowerCase()];
  if (!type) fail(`--out must end in .png, .jpg or .jpeg (got ${values.out})`);
  return { ...values, width: Number(size[1]), height: Number(size[2]), scale, timeout, type };
}

/**
 * The checkout at /, and a local collection's folder at /__collection/, so its
 * relative covers and sheet pages resolve as they would on a static host.
 * GET only; nothing outside those two folders is served.
 */
async function serve(collectionDir) {
  const inside = (base, rel) => { const full = path.resolve(base, '.' + path.posix.normalize('/' + rel)); return full === base || full.startsWith(base + path.sep) ? full : null; };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://still.local');
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = req.method !== 'GET' ? null
      : collectionDir && pathname.startsWith('/__collection/') ? inside(collectionDir, pathname.slice('/__collection'.length))
      : inside(ROOT, pathname === '/' ? '/index.html' : pathname);
    try {
      if (!file || !(await stat(file)).isFile()) throw new Error('not found');
      res.setHeader('content-type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server;
}

function pageUrl(origin, collection, view) {
  const remote = /^https?:\/\//i.test(collection);
  const exact = view.startsWith('#');
  const query = new URLSearchParams(exact ? '' : view.replace(/^\?/, ''));
  for (const key of ['collection', 'chrome']) if (query.has(key)) fail(`--view may not set ${key}; the tool sets it`);
  const url = new URL('/index.html', origin);
  url.searchParams.set('collection', remote ? collection : `/__collection/${encodeURIComponent(path.basename(collection))}`);
  for (const [key, value] of query) url.searchParams.append(key, value);
  url.searchParams.set('chrome', 'none');
  if (exact) url.hash = view;
  return url;
}

function revision() {
  try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

export async function still(argv) {
  const opts = options(argv);
  const remote = /^https?:\/\//i.test(opts.collection);
  const collectionFile = remote ? null : path.resolve(opts.collection);
  if (collectionFile && !(await stat(collectionFile).catch(() => null))?.isFile()) fail(`No collection file at ${collectionFile}`);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { fail('scripts/still.mjs needs Playwright: run npm install (it is a dev dependency) and npx playwright install chromium'); }
  const server = await serve(collectionFile && path.dirname(collectionFile));
  const origin = `http://127.0.0.1:${server.address().port}`, url = pageUrl(origin, opts.collection, opts.view);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.scale, reducedMotion: 'reduce' });
    // Exceptions fail the still; failed requests only explain a failure.
    const errors = [], missing = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
    const threw = () => [...errors, ...missing].length ? ` (${[...errors, ...missing].slice(0, 5).join(' | ')})` : '';
    await page.goto(url.href);
    // Ready, or the collection was refused: the wall shows why instead of a view.
    // An empty scope also shows #empty, but with the view ready and other words.
    await page.waitForFunction(() => document.body.dataset.viewReady === 'true' || /^Could not (load|reach)/.test(document.getElementById('empty')?.textContent.trim() || ''),
      null, { timeout: opts.timeout }).catch(() => fail(`The wall did not start within ${opts.timeout} ms${threw()}`));
    const refused = await page.evaluate(() => document.body.dataset.viewReady === 'true' ? '' : document.getElementById('empty').textContent.trim());
    if (refused) fail(`The collection was refused: ${refused}`);
    // A link the wall cannot restore leaves a notice and the default view; a still of that would answer another question.
    const notice = await page.evaluate(() => { const s = document.getElementById('link-status'); return s && !s.hidden ? document.getElementById('link-message').textContent.trim() : ''; });
    if (/^Could not/.test(notice)) fail(`The view was refused: ${notice}`);
    const settled = await page.evaluate(o => window.wunderkammer.whenStill(o), { timeout: opts.timeout, allowUndrawn: opts['allow-undrawn'] })
      .catch(e => fail(`${String(e.message).replace(/^Error: /, '')}${/not drawn yet/.test(e.message) ? ' (--allow-undrawn takes the still anyway)' : ''}`));
    if (settled.undrawn && !opts['allow-undrawn']) fail(`${settled.undrawn} tiles in view were still undrawn when the view settled (--allow-undrawn accepts that)`);
    if (errors.length) fail(`The page threw: ${errors.join(' | ')}`);
    const out = path.resolve(opts.out);
    await page.screenshot({ path: out, type: opts.type, ...(opts.type === 'jpeg' ? { quality: 92 } : {}) });
    // The exact link the page wrote for this view: it reopens the same camera and scope.
    const hash = await page.waitForFunction(() => /[#&]s=/.test(location.hash) && location.hash, null, { timeout: 5000 })
      .then(h => h.jsonValue()).catch(() => '');
    const exported = await page.evaluate(() => window.wunderkammer.export());
    const spec = hash ? decodeView(new URLSearchParams(hash.slice(1)).get('s')) : null;
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const sidecar = out.replace(/\.(png|jpe?g)$/i, '.json');
    const record = {
      format: 'wunderkammer.still', version: 1,
      image: { file: path.basename(out), type: opts.type, width: opts.width, height: opts.height, scale: opts.scale },
      collection: { source: opts.collection, corpus: exported.corpus },
      view: { requested: opts.view, mode: settled.mode, link: hash || null, spec },
      render: { waitedMs: settled.waitedMs, undrawn: settled.undrawn, notice: notice || null,
        wunderkammer: { version: pkg.version, commit: revision() }, browser: browser.version(), created: new Date().toISOString() },
      export: exported,
    };
    await writeFile(sidecar, JSON.stringify(record, null, 2) + '\n');
    return { image: out, sidecar, record };
  } finally {
    await browser.close(); server.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  still(process.argv.slice(2)).then(({ image, sidecar, record }) => {
    console.log(`${image}\n${sidecar}\n${record.view.mode} · ${record.export.count} of ${record.export.total} in scope · settled in ${record.render.waitedMs} ms`);
  }, error => {
    console.error(error instanceof StillError ? `still: ${error.message}` : error);
    process.exit(1);
  });
}
