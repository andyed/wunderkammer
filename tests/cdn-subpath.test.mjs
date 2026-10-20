import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

// A static host serving a release under a versioned sub-path: HTML as
// text/html, and nothing at the host root. Only the files package.json lists
// are served (`npm pack --dry-run` reads that list), so a page that reaches
// outside the release, or a file left out of "files", fails here.
const root = fileURLToPath(new URL('../', import.meta.url));
const PKG = '/wunderkammer@v0.3.0/';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="${color}"/></svg>`;
const doc = () => ({
  format: 'wunderkammer.collection', version: 1, corpus: { id: 'fixture:cdn', revision: 'r1' },
  ui: { title: 'CDN fixture', defaultGroup: 'decade' },
  clips: Array.from({ length: 12 }, (_, i) => ({
    id: `c${i}`, title: `Cover ${i}`, cover: `media/${i % 3}.svg`,
    props: { decade: ['1970s', '1980s', '1990s'][i % 3] },
  })),
});
const host = `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="w" style="width:900px;height:600px"></div>
<script type="module">
import { mount } from '${PKG}wall/embed.mjs';
try { await mount(document.getElementById('w'), '/data/c.json').ready; window.result = 'ready'; }
catch (err) { window.result = err.message; }
</script>`;

let server, origin, browser, published;
const misses = [];

before(async () => {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }));
  published = new Set(pack.files.map(f => f.path));
  server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://cdn').pathname);
    if (p === '/data/c.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(doc())); return; }
    if (p.startsWith('/data/media/')) { res.setHeader('content-type', 'image/svg+xml'); res.end(svg(['#508eae', '#ad5840', '#6a5acd'][Number(p.at(-5))] || '#888')); return; }
    if (p === '/host.html') { res.setHeader('content-type', 'text/html'); res.end(host); return; }
    const file = p.startsWith(PKG) ? p.slice(PKG.length) : null;
    if (file && published.has(file)) {
      res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.end(await readFile(path.join(root, file))); return;
    }
    misses.push(p); res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

const newPage = () => browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });

test('the published package includes the wall page at its root', () => {
  for (const file of ['index.html', 'wall/wall.mjs', 'wall/embed.mjs', 'wall/compare.html']) assert.ok(published.has(file), file);
});

test('the wall boots from a CDN sub-path, with every asset inside the package', async () => {
  misses.length = 0;
  const page = await newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.goto(`${origin}${PKG}index.html?collection=/data/c.json`);
    await page.waitForFunction(() => document.body.dataset.viewReady === 'true', null, { timeout: 15000 });
    assert.equal(await page.locator('.brand').textContent(), 'CDN fixture');
    assert.equal(await page.locator('#canvas > .tile').count(), 12);
    assert.equal(await page.evaluate(() => typeof window.wunderkammer?.export), 'function');
    assert.deepEqual(misses, [], 'no request leaves the package');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('mount() from a CDN finds the wall page with no wallUrl', async () => {
  misses.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}/host.html`);
    await page.waitForFunction(() => window.result, null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => window.result), 'ready');
    assert.equal(new URL(await page.locator('iframe').getAttribute('src')).pathname, `${PKG}index.html`);
    assert.equal(await page.frameLocator('iframe').locator('#canvas > .tile').count(), 12);
    assert.deepEqual(misses, [], 'no request leaves the package');
  } finally { await page.close(); }
});

test('the comparison page links back to the wall page inside the package', async () => {
  misses.length = 0;
  const page = await newPage();
  try {
    await page.goto(`${origin}${PKG}wall/compare.html?collection=/data/c.json`);
    await page.waitForFunction(() => document.body.dataset.comparisonReady === 'true', null, { timeout: 20000 });
    // A host may answer the release's folder with a file listing, so the link names the page.
    const back = new URL(await page.locator('.wordmark').getAttribute('href'), page.url());
    assert.equal(back.pathname, `${PKG}index.html`);
    assert.equal(back.searchParams.get('collection'), `${origin}/data/c.json`);
    assert.deepEqual(misses, [], 'no request leaves the package');
  } finally { await page.close(); }
});
