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
 * Under the picture goes the figure: the page's own counts, a legend and a note
 * on the view. --title and --label override its words, never its numbers, and
 * the sidecar records whose words are whose; --no-figure leaves it out.
 *
 * It fails, writing nothing, when the collection or the link is refused, the
 * page throws, the view never settles, flat-wall tiles are left undrawn
 * (--allow-undrawn accepts them), figure text does not fit, or any readable
 * text measures under 8:1 against the pixels behind it in the shot itself
 * (--allow-low-contrast records it instead). See docs/SHOTS.md.
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
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm' };
const USAGE = `usage: node scripts/still.mjs --collection <file or URL> [--view '<link keys>'] [--size 1600x900] [--scale 2] [--out still.png]
  [--title '<headline>'] [--label lit='<words>'] [--label rest|across|up|depth|group.<name>='<words>'] [--no-figure]
  [--timeout 60000] [--allow-undrawn] [--allow-low-contrast]`;
/** The 8:1 floor for readable text, measured on the shot's own pixels. */
export const CONTRAST_FLOOR = 8;

class StillError extends Error {}
const fail = message => { throw new StillError(message); };

function options(argv) {
  const { values } = parseArgs({ args: argv, options: {
    collection: { type: 'string' }, view: { type: 'string', default: '' }, size: { type: 'string', default: '1600x900' },
    scale: { type: 'string', default: '2' }, out: { type: 'string', default: 'still.png' }, timeout: { type: 'string', default: '60000' },
    'allow-undrawn': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    title: { type: 'string' }, label: { type: 'string', multiple: true, default: [] },
    'no-figure': { type: 'boolean', default: false }, 'allow-low-contrast': { type: 'boolean', default: false },
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
  const labels = values.label.map(pair => {
    const at = pair.indexOf('=');
    if (at < 1) fail(`--label takes key=words, e.g. --label lit='Ginger cats' (got ${pair})`);
    return [`label.${pair.slice(0, at)}`, pair.slice(at + 1)];
  });
  return { ...values, labels, width: Number(size[1]), height: Number(size[2]), scale, timeout, type };
}

/**
 * The checkout at /, and a local collection's folder at /__collection/, so its
 * relative covers and sheet pages resolve as they would on a static host.
 * GET only; nothing outside those two folders is served. warehouse-video.mjs serves the same way.
 */
export async function serve(collectionDir, port = 0) {
  const inside = (base, rel) => { const full = path.resolve(base, '.' + path.posix.normalize('/' + rel)); return full === base || full.startsWith(base + path.sep) ? full : null; };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://still.local');
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = req.method !== 'GET' ? null
      : collectionDir && pathname.startsWith('/__collection/') ? inside(collectionDir, pathname.slice('/__collection'.length))
      : inside(ROOT, pathname === '/' ? '/index.html' : pathname);
    try {
      const info = file && await stat(file);
      if (!info?.isFile()) throw new Error('not found');
      res.setHeader('content-type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('accept-ranges', 'bytes');
      // A video seeks by byte range; answered with the whole file instead, the
      // browser marks it unseekable and every seek lands back at the start.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        const size = info.size;
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
        res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
        res.end((await readFile(file)).subarray(start, end + 1));
        return;
      }
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

function pageUrl(origin, collection, view, { title, labels = [], figure = true } = {}) {
  const remote = /^https?:\/\//i.test(collection);
  const exact = view.startsWith('#');
  const query = new URLSearchParams(exact ? '' : view.replace(/^\?/, ''));
  for (const key of ['collection', 'chrome', 'figure']) if (query.has(key)) fail(`--view may not set ${key}; the tool sets it`);
  if (title !== undefined) query.set('title', title);
  for (const [key, words] of labels) query.append(key, words);
  if (!figure) query.set('figure', 'none');
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

/**
 * Runs in the page. Every readable text box in the shot (the figure, the
 * floating space's axis labels, tile captions), with the ground behind it read
 * from the screenshot's own pixels: the colour that fills most of the box. The
 * text's colour is its computed colour, faded by any opacity on its way to the
 * root. Returns `{ kind, text, ratio, ink, ground }` per box.
 */
export async function measureText({ png, scale }) {
  const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
  const luminance = rgb => { const [r, g, b] = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const opacityOf = node => { let o = 1; for (let n = node; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const kinds = [['figure', '.figure-band [data-figure], .figure-groups [data-figure]'], ['axis', '.float-label:not([hidden])'], ['caption', '#canvas > .tile .cap .t, #canvas > .tile .cap .m']];
  const out = [];
  for (const [kind, selector] of kinds) for (const node of document.querySelectorAll(selector)) {
    const text = node.textContent.trim(), style = getComputedStyle(node), r = node.getBoundingClientRect();
    if (!text || style.visibility !== 'visible' || r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
    const opacity = opacityOf(node);
    if (opacity < 0.05) continue;
    const x0 = Math.max(0, Math.floor(r.left * scale)), y0 = Math.max(0, Math.floor(r.top * scale));
    const x1 = Math.min(canvas.width, Math.ceil(r.right * scale)), y1 = Math.min(canvas.height, Math.ceil(r.bottom * scale));
    const data = context.getImageData(x0, y0, x1 - x0, y1 - y0).data, bins = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | data[i + 2] >> 3, bin = bins.get(key) || [0, 0, 0, 0];
      bin[0] += data[i]; bin[1] += data[i + 1]; bin[2] += data[i + 2]; bin[3]++; bins.set(key, bin);
    }
    let best = null; for (const bin of bins.values()) if (!best || bin[3] > best[3]) best = bin;
    const ground = best.slice(0, 3).map(v => Math.round(v / best[3]));
    const parts = (style.color.match(/[\d.]+/g) || ['0', '0', '0']).map(Number), alpha = (parts[3] ?? 1) * opacity;
    const ink = parts.slice(0, 3).map((v, i) => Math.round(v * alpha + ground[i] * (1 - alpha)));
    out.push({ kind, text: text.slice(0, 120), ratio: Math.round(ratio(ink, ground) * 100) / 100, ink, ground });
  }
  return out;
}
/** The measured boxes against the floor: the lowest ratio, and the boxes under it. */
export function contrastVerdict(items, floor = CONTRAST_FLOOR) {
  const below = items.filter(item => item.ratio < floor);
  return { floor, min: items.length ? Math.min(...items.map(item => item.ratio)) : null, below, items };
}

export async function still(argv) {
  const opts = options(argv);
  const remote = /^https?:\/\//i.test(opts.collection);
  const collectionFile = remote ? null : path.resolve(opts.collection);
  if (collectionFile && !(await stat(collectionFile).catch(() => null))?.isFile()) fail(`No collection file at ${collectionFile}`);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { fail('scripts/still.mjs needs Playwright: run npm install (it is a dev dependency) and npx playwright install chromium'); }
  const server = await serve(collectionFile && path.dirname(collectionFile));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = pageUrl(origin, opts.collection, opts.view, { title: opts.title, labels: opts.labels, figure: !opts['no-figure'] });
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
    if (settled.figure?.clipped.length) fail(`Figure text does not fit; shorten it or widen the shot: ${settled.figure.clipped.join(' | ')}`);
    if (errors.length) fail(`The page threw: ${errors.join(' | ')}`);
    // Contrast is read from the shot itself: the ground behind each text box is
    // whatever the renderer actually drew there, image, scrim or band.
    const png = await page.screenshot({ type: 'png' });
    const contrast = contrastVerdict(await page.evaluate(measureText, { png: png.toString('base64'), scale: opts.scale }));
    if (contrast.below.length && !opts['allow-low-contrast'])
      fail(`${contrast.below.length} text boxes measure under ${CONTRAST_FLOOR}:1 on the shot (lowest ${contrast.min}:1): ${contrast.below.slice(0, 5).map(i => `${i.kind} "${i.text}" ${i.ratio}:1`).join(' | ')} (--allow-low-contrast records it instead)`);
    const out = path.resolve(opts.out);
    if (opts.type === 'png') await writeFile(out, png);
    else await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
    // The exact link the page wrote for this view: it reopens the same camera and scope.
    const hash = await page.waitForFunction(() => /[#&]s=/.test(location.hash) && location.hash, null, { timeout: 5000 })
      .then(h => h.jsonValue()).catch(() => '');
    const exported = await page.evaluate(() => window.wunderkammer.export());
    const atlas = await page.evaluate(() => { const d = window.__cwFloat?.getDiagnostics(); return d && document.body.dataset.viewMode === 'float' ? { items: d.itemCount, resident: d.farResident, failed: d.failed, loading: d.loading } : null; });
    const spec = hash ? decodeView(new URLSearchParams(hash.slice(1)).get('s')) : null;
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const sidecar = out.replace(/\.(png|jpe?g)$/i, '.json');
    const record = {
      format: 'wunderkammer.still', version: 1,
      image: { file: path.basename(out), type: opts.type, width: opts.width, height: opts.height, scale: opts.scale },
      collection: { source: opts.collection, corpus: exported.corpus },
      view: { requested: opts.view, mode: settled.mode, link: hash || null, spec },
      figure: settled.figure,
      contrast,
      render: { waitedMs: settled.waitedMs, undrawn: settled.undrawn, atlas, notice: notice || null,
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
