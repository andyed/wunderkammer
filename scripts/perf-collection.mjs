#!/usr/bin/env node
/**
 * Boot cost of a static collection document: image requests, image bytes and
 * time to a complete overview, cold cache, median of several runs.
 *
 *   node scripts/perf-collection.mjs examples/psychodeli/collection.json [--runs 5] [--throttle 4g] [--json out.json]
 *
 * Serves this repository's wall and the document's own folder from one local
 * origin (/c/ is the document's folder), so a document whose covers are local
 * files and one whose covers are sprite sheets are measured the same way.
 * Remote covers are fetched from wherever the document names them.
 *
 * "Overview complete" is perf.mjs's definition: every visible tile shows its
 * image, from its own <img> or painted by the overview canvas. The server is
 * HTTP/1.1, so per-file covers queue on six connections where an HTTP/2 host
 * would multiplex them; compare documents on the same server, not across hosts.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
if (!file) { console.error('usage: perf-collection.mjs <collection.json> [--runs 5] [--throttle 4g] [--json out.json]'); process.exit(2); }
const RUNS = Math.max(1, Number(arg('--runs', 5)));
// Chrome's own throttling: latency is added per request, throughput shared.
const PROFILES = { none: null, '4g': { latency: 60, downloadThroughput: 12e6 / 8, uploadThroughput: 4e6 / 8 } };
const THROTTLE = arg('--throttle', 'none');
if (!(THROTTLE in PROFILES)) { console.error(`--throttle is one of ${Object.keys(PROFILES).join(', ')}`); process.exit(2); }

const root = fileURLToPath(new URL('../', import.meta.url));
const docPath = path.resolve(file), docDir = path.dirname(docPath), docName = path.basename(docPath);
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const target = p === '/' ? path.join(root, 'wall/index.html')
    : p.startsWith('/c/') ? path.join(docDir, p.slice(3))
    : p.startsWith('/wall/') ? path.join(root, p.slice(1)) : null;
  // Nothing outside the two roots.
  if (!target || !(target.startsWith(docDir + path.sep) || target.startsWith(path.join(root, 'wall') + path.sep))) { res.writeHead(404); res.end(); return; }
  try {
    if (!(await stat(target)).isFile()) throw new Error('not a file');
    res.setHeader('content-type', TYPES[path.extname(target)] || 'application/octet-stream');
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/?collection=/c/${encodeURIComponent(docName)}`;

const IMAGE_STATE = () => {
  const imgs = [...document.querySelectorAll('#canvas .tile img')];
  const visible = imgs.filter(i => i.closest('.tile').style.visibility !== 'hidden');
  const shown = visible.filter(i => (i.complete && i.naturalWidth > 0 && !!(i.src || i.srcset)) || i.closest('.tile').classList.contains('overview-painted'));
  return { visible: visible.length, shown: shown.length };
};

async function once(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  if (PROFILES[THROTTLE]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILES[THROTTLE] });
  const requests = new Map();
  cdp.on('Network.requestWillBeSent', e => requests.set(e.requestId, { url: e.request.url, type: e.type, bytes: 0, at: e.timestamp }));
  cdp.on('Network.loadingFinished', e => { const r = requests.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
  const images = () => [...requests.values()].filter(r => /\.(webp|png|jpe?g|avif|gif|svg)(\?|$)/i.test(r.url));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-view-ready="true"]', { timeout: 60000 });
  const readyMs = Date.now() - t0;
  let state, overviewMs = null;
  while (Date.now() - t0 < 60000) {
    state = await page.evaluate(IMAGE_STATE);
    if (state.visible && state.shown >= state.visible) { overviewMs = Date.now() - t0; break; }
    await page.waitForTimeout(50);
  }
  const atOverview = images();
  const doc = [...requests.values()].find(r => new URL(r.url).pathname === `/c/${encodeURIComponent(docName)}`);
  // What else loads once the overview is up (it should be nothing).
  await page.waitForTimeout(2000);
  const settled = images();
  await context.close();
  const kb = list => Math.round(list.reduce((n, r) => n + r.bytes, 0) / 1024);
  return { readyMs, overviewMs, visible: state?.visible, shown: state?.shown,
    imageRequests: atOverview.length, imageKB: kb(atOverview), settledRequests: settled.length, settledKB: kb(settled),
    documentKB: Math.round((doc?.bytes || 0) / 1024) };
}

const median = values => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const browser = await chromium.launch();
const runs = [];
try {
  await once(browser); // warm the server, the CDN's three.js and the OS file cache; not counted
  for (let i = 0; i < RUNS; i++) runs.push(await once(browser));
} finally { await browser.close(); server.close(); }
const summary = Object.fromEntries(Object.keys(runs[0]).map(k => [k, median(runs.map(r => r[k]))]));
summary.overviewRange = [Math.min(...runs.map(r => r.overviewMs ?? Infinity)), Math.max(...runs.map(r => r.overviewMs ?? -1))];
console.log(`perf-collection · ${path.relative(process.cwd(), docPath)} · throttle ${THROTTLE} · median of ${RUNS} cold runs`);
console.log(`  ready ${summary.readyMs} ms · overview complete ${summary.overviewMs} ms (range ${summary.overviewRange.join('–')}) · ${summary.shown}/${summary.visible} tiles`);
console.log(`  at overview: ${summary.imageRequests} image requests, ${summary.imageKB} KB · after 2 s: ${summary.settledRequests} requests, ${summary.settledKB} KB · document ${summary.documentKB} KB`);
const out = arg('--json', null);
if (out) await writeFile(out, JSON.stringify({ document: docName, throttle: THROTTLE, runs, summary }, null, 2));
