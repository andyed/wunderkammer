import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// The mark, lockups and favicon in wall/brand/, built by scripts/build-brand.py.
const root = fileURLToPath(new URL('../', import.meta.url));
const brand = path.join(root, 'wall', 'brand');
const GROUND = { dark: ['#050510', '#0d0d16'], light: ['#ffffff'] };

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const fills = (svg, tag) => [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*\\bfill="(#[0-9a-f]{6})"`, 'gi'))].map(m => m[1].toLowerCase());
/** The rack's tiles: every fill but one is the dim colour, and that one is lit. */
function tiles(svg) {
  const all = fills(svg, 'polygon'), counts = new Map();
  for (const fill of all) counts.set(fill, (counts.get(fill) || 0) + 1);
  const [dim] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { count: all.length, dim, lit: all.filter(fill => fill !== dim) };
}

test('brand files are outlined, self-contained and keep one lit tile at legible contrast', async () => {
  const names = (await readdir(brand)).filter(name => name.endsWith('.svg')).sort();
  assert.deepEqual(names, ['favicon.svg', 'lockup-dark.svg', 'lockup-light.svg', 'mark.svg']);
  for (const name of names) {
    const svg = await readFile(path.join(brand, name), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d. ]+"/, name);
    assert.match(svg, /<title>wunderkammer<\/title>/, `${name} names itself`);
    // Outlined: no text to fall back to another font, and nothing fetched.
    assert.doesNotMatch(svg, /<text\b|<image\b|\bhref=|url\(|@import|@font-face/i, name);
    const rack = tiles(svg);
    assert.equal(rack.count, 12, `${name}: a rack of 3 by 4 tiles`);
    assert.equal(rack.lit.length, 1, `${name}: exactly one lit tile`);
    const theme = name.includes('light') ? 'light' : 'dark';
    const grounds = name === 'favicon.svg' ? fills(svg, 'rect') : GROUND[theme];
    for (const ground of grounds) {
      assert.ok(ratio(rack.lit[0], ground) >= 3, `${name}: lit tile ${rack.lit[0]} on ${ground}`);
      // Dark grounds keep dim tiles visible; on white they stay pale so the lit tile leads.
      if (theme === 'dark') assert.ok(ratio(rack.dim, ground) >= 3, `${name}: dim tiles ${rack.dim} on ${ground}`);
    }
    if (name.startsWith('lockup')) {
      const [word] = fills(svg, 'path');
      for (const ground of GROUND[theme]) assert.ok(ratio(word, ground) >= 8, `${name}: word ${word} on ${ground} is readable text`);
    }
  }
});

test('the README heading shows the lockup for each colour scheme', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const heading = readme.split('\n')[0];
  assert.match(heading, /<source media="\(prefers-color-scheme: dark\)" srcset="wall\/brand\/lockup-dark\.svg">/);
  assert.match(heading, /<img alt="wunderkammer" src="wall\/brand\/lockup-light\.svg"/);
});

// Pages served from a sub-path, as a CDN serves the package: an asset named from
// the server root misses.
const PKG = '/pkg/';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const doc = () => ({ format: 'wunderkammer.collection', version: 1, corpus: { id: 'fixture:brand', revision: 'r1' },
  ui: { title: 'Brand fixture' },
  clips: Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, title: `Item ${i}`, props: { year: i % 2 ? '2025' : '2026' } })) });
let server, origin, browser;
const misses = [];
before(async () => {
  server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/data/c.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(doc())); return; }
    if (p.startsWith(PKG) && !p.includes('..')) {
      try {
        const file = p.slice(PKG.length) || 'index.html';
        const data = await readFile(path.join(root, file));
        res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream'); res.end(data); return;
      } catch {}
    }
    misses.push(p); res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

const decoded = (page, selector) => page.locator(selector).evaluate(img => img.complete && img.naturalWidth > 0);
async function icon(page) {
  const href = await page.locator('link[rel="icon"]').evaluate(link => link.href);
  const response = await page.request.get(href);
  return [response.status(), response.headers()['content-type']];
}

test('both pages show the mark and the favicon from paths inside the package', async () => {
  misses.length = 0;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${origin}${PKG}index.html?collection=/data/c.json`);
    await page.waitForFunction(() => document.body.dataset.viewReady === 'true', null, { timeout: 15000 });
    assert.equal(await decoded(page, '.brand-mark'), true, 'the rack beside the collection title');
    assert.equal(await page.locator('.brand').textContent(), 'Brand fixture', 'the title stays the collection\'s');
    assert.deepEqual(await icon(page), [200, 'image/svg+xml']);

    await page.goto(`${origin}${PKG}wall/compare.html?collection=/data/c.json`);
    await page.waitForFunction(() => document.body.dataset.comparisonReady === 'true', null, { timeout: 20000 });
    assert.equal(await decoded(page, '.wordmark img'), true, 'the lockup in the comparison header');
    assert.equal(await page.getByRole('link', { name: 'wunderkammer / compare', exact: true }).count(), 1);
    assert.deepEqual(await icon(page), [200, 'image/svg+xml']);
    assert.deepEqual(misses, [], 'no request leaves the package');
  } finally { await page.close(); }
});
