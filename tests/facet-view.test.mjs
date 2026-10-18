import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPermalinkHandler } from '../lib/permalinks.mjs';
import { encodeView, decodeView } from '../wall/permalink.mjs';

// Every value in artist is metadata only: global title/note search cannot
// rescue a truncated facet. The small core has independent hand-checkable
// membership and a duplicated tag to expose occurrence/record count confusion.
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#304a50"/></svg>');
const core = [
  ['Needle alpha', 'A', ['Jazz', 'Fusion']],
  ['Needle beta', 'A', ['Rock']],
  ['Needle gamma', 'B', ['Jazz']],
  ['Needle delta', 'B', ['Rock', 'Fusion']],
  ['Other epsilon', 'A', ['Classical']],
  ['Other zeta', 'B', ['Rock', 'Jazz']],
  ['Needle eta', 'A', ['Classical', 'Jazz', 'Jazz']],
  ['Needle theta', 'B', ['Classical']],
];
const clips = [
  ...core.map(([title, source, genre], i) => ({ id: `c${i}`, title, source, props: { genre, artist: `Core ${i}` } })),
  ...Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, title: `Archive ${String(i).padStart(2, '0')}`, source: 'Archive',
    props: { genre: ['Ambient'], artist: i === 39 ? 'Zzyzx Ensemble' : `Rare ${String(i).padStart(2, '0')}` } })),
].map(clip => ({ ...clip, url: `urn:facet:${clip.id}`, note: 'Synthetic fixture note',
  captured: clip.id.startsWith('r') ? '2024-01-01' : Number(clip.id.slice(1)) < 4 ? `2026-0${Number(clip.id.slice(1)) < 2 ? 3 : 4}-01` : '2025-11-01', tags: [], cover }));
const facets = {};
for (const clip of clips) {
  for (const [key, raw] of Object.entries({ ...clip.props, source: clip.source, captured: clip.captured.slice(0, 7) })) {
    for (const value of new Set(Array.isArray(raw) ? raw : [raw])) {
      facets[key] ||= {}; facets[key][value] = (facets[key][value] || 0) + 1;
    }
  }
}
const corpus = { id: 'facets-synthetic', revision: 'r1' };
let browser, server, origin, dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-facet-view-'));
  const snapshots = createPermalinkHandler(path.join(dir, 'links'));
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/api/permalinks')) return snapshots(req, res, url.pathname.split('/')[3]);
    if (url.pathname === '/api/clips') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ clips, facets, corpus, title: 'Synthetic facet proof', ui: { defaultGroup: 'none', facetOrder: ['genre', 'source', 'artist'], facetLabels: { artist: 'Artist' } } })); return;
    }
    if (url.pathname === '/api/view-state') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'none', piles: [] })); return;
    }
    if (url.pathname === '/' || /^\/wall\/[\w./-]+$/.test(url.pathname)) {
      try {
        const file = url.pathname === '/' ? 'wall/index.html' : url.pathname.slice(1);
        if (file.includes('..')) throw new Error('Invalid fixture path');
        const bytes = await readFile(new URL('../' + file, import.meta.url));
        res.setHeader('content-type', file.endsWith('html') ? 'text/html' : file.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(bytes); return;
      } catch {}
    }
    res.writeHead(404).end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  if (dir) await rm(dir, { recursive: true, force: true });
});

const chip = (page, facet, value) => page.locator(`.chip[data-facet=${JSON.stringify(facet)}][data-value=${JSON.stringify(value)}]`);
const facetSearch = (page, key) => page.locator(`input[data-facet-search=${JSON.stringify(key)}]`);
const sorted = values => [...values].sort();
async function open(url = origin, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce', ...options });
  const errors = []; page.on('pageerror', error => errors.push(error.stack || error.message));
  page.fixtureErrors = errors;
  await page.goto(url);
  await page.waitForSelector('body[data-view-ready=true]');
  await page.waitForFunction(() => location.hash.includes('s=') || location.hash.includes('ref='));
  return page;
}
async function close(page) {
  const errors = page.fixtureErrors;
  await page.close(); assert.deepEqual(errors, [], 'fixture page has no script errors');
}
async function membership(page, ids) {
  const titles = sorted(ids.map(id => clips.find(c => c.id === id).title));
  await page.waitForFunction(titles => JSON.stringify([...document.querySelectorAll('#canvas > .tile')].map(el => el.getAttribute('aria-label')).sort()) === JSON.stringify(titles), titles);
  assert.equal(Number(await page.locator('#count b').textContent()), ids.length);
}
async function view(page) {
  const hash = new URLSearchParams(new URL(page.url()).hash.slice(1));
  return hash.has('s') ? decodeView(hash.get('s')) : (await fetch(`${origin}/api/permalinks/${hash.get('ref')}`)).json();
}
async function persisted(page, predicate) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const spec = await view(page);
    if (predicate(spec)) return spec;
    await page.waitForTimeout(40);
  }
  assert.fail('Expected scope was not persisted in the permalink');
}
async function counts(page, facet, value, inView, available, total) {
  const node = chip(page, facet, value);
  assert.deepEqual(await node.evaluate(el => ({ inView: Number(el.dataset.inView), available: Number(el.dataset.available), total: Number(el.dataset.total) })), { inView, available, total });
  assert.equal((await node.locator('.n').innerText()).replace(/\s/g, ''), `${inView}/${available}`, 'visible count names the actual current and available populations');
}
async function geometry(page) {
  return page.evaluate(() => ({ transform: document.querySelector('#canvas').style.transform,
    tiles: [...document.querySelectorAll('#canvas > .tile')].map(el => [el.getAttribute('aria-label'), el.style.transform]), count: document.querySelector('#count').textContent }));
}
async function auditFacetContrast(page) {
  // Read computed text colors, then sample the actual painted background at
  // glyph pixels. This includes selected-chip fills and partial-share gradients.
  // Scope is the visible facet rail / active-value summary, not image captions.
  const targets = await page.evaluate(() => {
    const targets = [];
    function add(element, rects, label, placeholder = false) {
      if (element.closest('[aria-hidden=true]')) return;
      const closedDetails = element.closest('details:not([open])');
      if (closedDetails && !closedDetails.querySelector(':scope > summary')?.contains(element)) return;
      const style = getComputedStyle(element, placeholder ? '::placeholder' : null);
      if (style.visibility !== 'visible' || style.display === 'none') return;
      const color = style.color.match(/^rgba?\(([^)]+)\)$/);
      if (!color) throw new Error(`Unsupported facet text color ${style.color}`);
      const rgba = color[1].split(/[\s,/]+/).filter(Boolean).map(Number); rgba[3] ??= 1;
      let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      for (let node = element; node; node = node.parentElement) {
        const cs = getComputedStyle(node); rgba[3] *= Number(cs.opacity);
        if (cs.display === 'none' || cs.visibility !== 'visible') return;
        const box = node.getBoundingClientRect();
        if (/hidden|auto|scroll|clip/.test(cs.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
        if (/hidden|auto|scroll|clip/.test(cs.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
      }
      const boxes = rects.map(r => ({ left: Math.max(clip.left, r.left), right: Math.min(clip.right, r.right), top: Math.max(clip.top, r.top), bottom: Math.min(clip.bottom, r.bottom) }))
        .filter(r => r.right - r.left > 2 && r.bottom - r.top > 2)
        .filter(r => [.25, .5, .75].some(fraction => {
          const painted = document.elementFromPoint(r.left + (r.right - r.left) * fraction, (r.top + r.bottom) / 2);
          return painted && (painted === element || element.contains(painted));
        }));
      if (boxes.length && rgba[3]) targets.push({ label, color: rgba, boxes });
    }
    for (const root of document.querySelectorAll('#rail,#scope-summary')) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        if (!node.data.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        add(node.parentElement, [...range.getClientRects()], node.data.trim());
      }
    }
    for (const input of document.querySelectorAll('#rail input')) add(input, [input.getBoundingClientRect()], input.value || input.placeholder, !input.value);
    return targets;
  });
  const before = await page.screenshot({ scale: 'css' });
  const mask = await page.addStyleTag({ content: '#rail,#rail *,#scope-summary,#scope-summary *{color:transparent!important;text-shadow:none!important} #rail input::placeholder{color:transparent!important}' });
  let under;
  try { under = await page.screenshot({ scale: 'css' }); }
  finally { await mask.evaluate(el => el.remove()); }
  const result = await page.evaluate(async ({ before, under, targets }) => {
    async function decode(base64) {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
    }
    const [actual, background] = await Promise.all([decode(before), decode(under)]);
    function luminance(rgb) { const v = rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return v[0] * .2126 + v[1] * .7152 + v[2] * .0722; }
    const failures = []; let minimum = Infinity, measured = 0;
    for (const target of targets) {
      let samples = 0, lowest = Infinity;
      for (const box of target.boxes) for (let y = Math.max(0, Math.floor(box.top)); y < Math.min(actual.height, Math.ceil(box.bottom)); y++) {
        for (let x = Math.max(0, Math.floor(box.left)); x < Math.min(actual.width, Math.ceil(box.right)); x++) {
          const at = (y * actual.width + x) * 4;
          if (Math.max(...[0, 1, 2].map(c => Math.abs(actual.data[at + c] - background.data[at + c]))) < 8) continue;
          const bg = [background.data[at], background.data[at + 1], background.data[at + 2]];
          const fg = bg.map((v, c) => target.color[c] * target.color[3] + v * (1 - target.color[3]));
          const a = luminance(fg), b = luminance(bg);
          lowest = Math.min(lowest, (Math.max(a, b) + .05) / (Math.min(a, b) + .05)); samples++;
        }
      }
      if (!samples) failures.push({ text: target.label, reason: 'No visible glyph paint' });
      else { measured++; minimum = Math.min(minimum, lowest); if (lowest < 8) failures.push({ text: target.label, contrast: Number(lowest.toFixed(3)) }); }
    }
    return { measured, minimum: Number(minimum.toFixed(3)), failures };
  }, { before: before.toString('base64'), under: under.toString('base64'), targets });
  assert.ok(result.measured > 0, 'contrast audit measures rendered facet text');
  assert.deepEqual(result.failures, [], 'facet text maintains 8:1 against actual painted backgrounds');
  return result;
}
async function capture(page, name) {
  const contrast = await auditFacetContrast(page);
  if (!process.env.FACET_SCREENSHOT_DIR) return;
  await mkdir(process.env.FACET_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.resolve(process.env.FACET_SCREENSHOT_DIR, `${name}.png`), fullPage: true });
  return contrast;
}
function unionSpec() {
  return { v: 1, layoutVersion: 1, corpus,
    scope: { query: 'Needle', facets: [['source', ['A']], ['genre', ['Jazz']]], branches: [
      { label: 'First set', keys: ['urn:facet:c0', 'urn:facet:c1'] },
      { label: 'Second set', keys: ['urn:facet:c1', 'urn:facet:c2', 'urn:facet:c4'] },
    ] },
    presentation: { mode: 'flat', group: 'none', pan: 'edge' },
    flat: { view: { x: 0, y: 0, scale: 1, fitted: true }, stage: { w: 1200, h: 800 }, aspect: 1.5 }, spatial: null,
    ui: { rail: true, context: false, focus: null, detailWidth: null } };
}

test('facet-local search reaches prop-only values beyond the first 24 without changing global scope', async () => {
  const page = await open();
  try {
    assert.equal(Object.keys(facets.artist).length, 48);
    assert.ok(clips.every(c => ![c.title, c.note, c.source, c.url, ...c.tags].join(' ').includes('Zzyzx Ensemble')));
    assert.equal(await chip(page, 'artist', 'Zzyzx Ensemble').count(), 0, 'rare value starts outside the bounded list');
    await capture(page, 'desktop-facet-overview');
    const before = await geometry(page), url = page.url();
    const search = facetSearch(page, 'artist');
    await search.fill('zzyzx');
    await chip(page, 'artist', 'Zzyzx Ensemble').waitFor({ state: 'visible' });
    assert.equal(await search.evaluate(el => el === document.activeElement), true, 'local search keeps focus while results change');
    assert.equal(await page.locator('#search').inputValue(), '');
    assert.deepEqual(await geometry(page), before);
    await page.waitForTimeout(300); assert.equal(page.url(), url, 'facet-list search is transient, not scope');
    await chip(page, 'artist', 'Zzyzx Ensemble').focus(); await page.keyboard.press('Enter');
    await membership(page, ['r39']);
    await persisted(page, spec => spec.scope.facets.some(([key, values]) => key === 'artist' && values.includes('Zzyzx Ensemble')));
    await search.fill('Core');
    assert.equal(await chip(page, 'artist', 'Zzyzx Ensemble').getAttribute('aria-pressed'), 'true', 'active value remains removable when it does not match local search');
    await capture(page, 'desktop-rare-selected');
    await chip(page, 'artist', 'Zzyzx Ensemble').focus(); await page.keyboard.press('Enter');
    await membership(page, clips.map(c => c.id));
    assert.equal(await page.evaluate(() => document.activeElement === document.body), false, 'removing a now-hidden value leaves usable focus');
  } finally { await close(page); }
});

test('keyboard expansion reaches the remaining facet values without changing membership', async () => {
  const page = await open();
  try {
    assert.equal(await page.locator('.chip[data-facet=artist]').count(), 24);
    await page.locator('button[data-facet-more=artist]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.chip[data-facet=artist]').count(), 48);
    assert.equal(await chip(page, 'artist', 'Zzyzx Ensemble').count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.facet), 'artist', 'focus continues into newly revealed values');
    await membership(page, clips.map(c => c.id));
    const bad = await page.addStyleTag({ content: '.rail .chip .n{color:#595959!important}' });
    try { await assert.rejects(() => auditFacetContrast(page), error => error.actual?.some(failure => failure.contrast < 8)); }
    finally { await bad.evaluate(el => el.remove()); }
  } finally { await close(page); }
});

test('multi-valued OR and cross-facet AND have independent per-record count denominators', async () => {
  const page = await open();
  try {
    await chip(page, 'genre', 'Jazz').click(); await membership(page, ['c0', 'c2', 'c5', 'c6']);
    await counts(page, 'genre', 'Jazz', 4, 4, 4);
    await counts(page, 'genre', 'Rock', 1, 3, 3);
    await chip(page, 'genre', 'Rock').click(); await membership(page, ['c0', 'c1', 'c2', 'c3', 'c5', 'c6']);
    await chip(page, 'source', 'A').click(); await membership(page, ['c0', 'c1', 'c6']);
    await counts(page, 'genre', 'Jazz', 2, 2, 4);
    await counts(page, 'genre', 'Rock', 1, 1, 3);
    await counts(page, 'source', 'B', 0, 3, 4);
    await page.locator('button[data-facet-clear=genre]').click(); await membership(page, ['c0', 'c1', 'c4', 'c6']);
    assert.equal(await chip(page, 'source', 'A').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.chip[data-facet=genre][aria-pressed=true]').count(), 0);
  } finally { await close(page); }
});

test('available counts omit only their own facet and respect query plus exact union membership', async () => {
  const page = await open(`${origin}/#v=1&s=${encodeView(unionSpec())}`);
  try {
    await membership(page, ['c0']);
    await counts(page, 'genre', 'Jazz', 1, 1, 4);
    await counts(page, 'genre', 'Rock', 0, 1, 3);
    await counts(page, 'genre', 'Fusion', 1, 1, 2);
    await counts(page, 'genre', 'Classical', 0, 0, 3);
    await counts(page, 'source', 'A', 1, 1, 4);
    await counts(page, 'source', 'B', 0, 1, 4);
    await counts(page, 'source', 'Archive', 0, 0, 40);
    assert.equal(await page.locator('.scope-branch').count(), 2);
    await capture(page, 'desktop-union-counts');
    await chip(page, 'genre', 'Rock').focus(); await page.keyboard.press('Enter');
    await membership(page, ['c0', 'c1']);
    const saved = await persisted(page, spec => spec.scope.facets.some(([key, values]) => key === 'genre' && values.includes('Rock')));
    assert.deepEqual(saved.scope.branches, unionSpec().scope.branches);
  } finally { await close(page); }
});

test('zero-result scope retains individual removal, per-facet clear, and browser Back recovery', async () => {
  const page = await open();
  try {
    await chip(page, 'source', 'A').click(); await membership(page, ['c0', 'c1', 'c4', 'c6']);
    await persisted(page, spec => spec.scope.facets.some(([key]) => key === 'source'));
    const beforeEmpty = page.url();
    await chip(page, 'genre', 'Ambient').click(); await membership(page, []);
    await persisted(page, spec => spec.scope.facets.some(([key, values]) => key === 'genre' && values.includes('Ambient')));
    assert.equal(await page.locator('#empty').isVisible(), true);
    assert.equal(await chip(page, 'genre', 'Ambient').getAttribute('aria-pressed'), 'true');
    await page.locator('button[data-scope-facet=genre][data-scope-value=Ambient]').focus(); await page.keyboard.press('Enter');
    await membership(page, ['c0', 'c1', 'c4', 'c6']);
    assert.equal(await chip(page, 'source', 'A').getAttribute('aria-pressed'), 'true');
    await chip(page, 'genre', 'Ambient').click(); await membership(page, []);
    await persisted(page, spec => spec.scope.facets.some(([key]) => key === 'genre'));
    await page.goBack(); await membership(page, ['c0', 'c1', 'c4', 'c6']);
    assert.deepEqual((await view(page)).scope.facets, decodeView(new URLSearchParams(new URL(beforeEmpty).hash.slice(1)).get('s')).scope.facets);
    await page.locator('button[data-facet-clear=source]').click(); await membership(page, clips.map(c => c.id));
  } finally { await close(page); }
});

test('fresh permalink restores rare active values and hover/focus do not mutate scope or placement', async () => {
  const page = await open(); let restored;
  try {
    await facetSearch(page, 'artist').fill('Zzyzx');
    await chip(page, 'artist', 'Zzyzx Ensemble').click(); await membership(page, ['r39']);
    const saved = await persisted(page, spec => spec.scope.facets.some(([key]) => key === 'artist'));
    restored = await open(page.url()); await membership(restored, ['r39']);
    assert.equal(await chip(restored, 'artist', 'Zzyzx Ensemble').getAttribute('aria-pressed'), 'true');
    const before = await geometry(restored), url = restored.url();
    await chip(restored, 'genre', 'Ambient').hover();
    await chip(restored, 'source', 'Archive').focus();
    await restored.waitForTimeout(350);
    assert.deepEqual(await geometry(restored), before);
    assert.deepEqual((await view(restored)).scope, saved.scope);
    assert.equal(restored.url(), url);
    await restored.locator('button[data-scope-facet=artist][data-scope-value="Zzyzx Ensemble"]').click();
    await membership(restored, clips.map(c => c.id));
  } finally { if (restored) await close(restored); await close(page); }
});

test('zero-result recovery follows scope through flat and spatial presentations', async () => {
  const page = await open();
  try {
    await chip(page, 'source', 'A').click(); await membership(page, ['c0', 'c1', 'c4', 'c6']);
    await chip(page, 'genre', 'Ambient').click(); await membership(page, []);
    await page.locator('#view-3d').click();
    await page.waitForFunction(() => document.querySelector('#view-3d').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#sp-host').isVisible(), true);
    assert.equal(await page.locator('#empty').isVisible(), true, 'empty flat scope remains recoverable after switching to spatial');
    const emptySpatial = await persisted(page, spec => spec.presentation.mode === '3d');
    assert.equal(typeof emptySpatial.spatial.fitted, 'boolean', 'an initially empty spatial camera still has a valid portable pose');
    assert.deepEqual(emptySpatial.scope.facets, [['genre', ['Ambient']], ['source', ['A']]]);
    const restored = await open(page.url());
    try {
      assert.equal(await restored.locator('#view-3d').getAttribute('aria-pressed'), 'true');
      assert.equal(await restored.locator('#empty').isVisible(), true);
      assert.equal(Number(await restored.locator('#count b').textContent()), 0);
      assert.equal(await restored.getByRole('button', { name: 'Show all content', exact: true }).isVisible(), true);
    } finally { await close(restored); }
    await page.getByRole('button', { name: 'Show all content', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#count b').textContent === '48');
    assert.equal(await page.locator('#empty').isVisible(), false, 'spatial recovery removes the obsolete empty overlay');
    await chip(page, 'source', 'A').click();
    await page.waitForFunction(() => document.querySelector('#count b').textContent === '4');
    await chip(page, 'genre', 'Ambient').click();
    await page.waitForFunction(() => document.querySelector('#count b').textContent === '0');
    assert.equal(await page.locator('#empty').isVisible(), true, 'a new zero combination in spatial mode exposes recovery');
    await capture(page, 'desktop-spatial-empty');
    const recover = page.getByRole('button', { name: 'Show all content', exact: true });
    await recover.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#count b').textContent === '48');
    assert.equal(await page.locator('#empty').isVisible(), false);
    assert.equal(await page.locator('#view-3d').getAttribute('aria-pressed'), 'true', 'recovery preserves the presentation');
    await persisted(page, spec => spec.scope.facets.length === 0);
    await capture(page, 'desktop-spatial-recovered');
    await page.locator('#view-3d').click(); await membership(page, clips.map(c => c.id));
    assert.equal(await page.locator('#empty').isVisible(), false);
  } finally { await close(page); }
});

test('restored captured-year prefix agrees between membership, facet counts, hover marks and legend', async () => {
  const spec = unionSpec(); spec.scope = { query: '', facets: [['captured', ['2026']]], branches: null };
  const page = await open(`${origin}/#v=1&s=${encodeView(spec)}`);
  try {
    await membership(page, ['c0', 'c1', 'c2', 'c3']);
    await counts(page, 'captured', '2026', 4, 4, 4);
    const before = await geometry(page), url = page.url();
    await chip(page, 'captured', '2026').hover();
    assert.equal(await page.locator('#canvas > .tile.brush-match').count(), 4);
    assert.equal(await page.locator('#canvas > .tile.brush-miss').count(), 0);
    assert.match(await page.locator('.brush-legend-foot').innerText(), /4 matches\s*·\s*4 in view/);
    await page.waitForTimeout(350);
    assert.deepEqual(await geometry(page), before); assert.equal(page.url(), url);
  } finally { await close(page); }
});

test('changing a facet-local query removes stale value preview and restores the pinned lens', async () => {
  const page = await open();
  try {
    await page.locator('#attribute-lens').selectOption('genre');
    await persisted(page, spec => spec.ui.lens === 'genre');
    const before = await geometry(page), url = page.url();
    const search = facetSearch(page, 'artist');
    await search.fill('Rare'); await chip(page, 'artist', 'Rare 00').hover();
    assert.equal(await page.locator('#canvas').getAttribute('data-brush-key'), 'artist');
    await search.fill('Core');
    assert.equal(await page.locator('#canvas').getAttribute('data-brush-key'), 'genre');
    assert.equal(await page.locator('#attribute-lens').inputValue(), 'genre');
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await page.waitForTimeout(350);
    assert.deepEqual(await geometry(page), before); assert.equal(page.url(), url);
  } finally { await close(page); }
});

test('active-value keyboard focus survives permalink settlement and a camera-only write', async () => {
  const page = await open();
  try {
    await chip(page, 'genre', 'Jazz').click(); await membership(page, ['c0', 'c2', 'c5', 'c6']);
    const remove = page.locator('button[data-scope-facet=genre][data-scope-value=Jazz]');
    await remove.focus();
    const original = await remove.elementHandle();
    const before = await persisted(page, spec => spec.scope.facets.some(([key, values]) => key === 'genre' && values.includes('Jazz')));
    assert.equal(await original.evaluate(el => el.isConnected && el === document.activeElement), true, 'settling a permalink preserves the focused DOM control');
    await page.keyboard.press('-'); // Existing camera shortcut leaves focus on the scope control.
    const afterCamera = await persisted(page, spec => Math.abs(spec.flat.view.scale - before.flat.view.scale) > .00001);
    assert.deepEqual(afterCamera.scope, before.scope);
    assert.equal(await original.evaluate(el => el.isConnected && el === document.activeElement), true, 'camera-only URL writes preserve the same focused control');
    await page.keyboard.press('Enter'); await membership(page, clips.map(c => c.id));
  } finally { await close(page); }
});

test('phone touch selection closes to a usable focus target and active values remain removable', async () => {
  const page = await open(origin, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    await page.locator('#toggle-rail').tap();
    const search = facetSearch(page, 'artist');
    await search.fill('Zzyzx');
    const rare = chip(page, 'artist', 'Zzyzx Ensemble');
    const box = await rare.boundingBox();
    assert.ok(box.width >= 40 && box.height >= 40, 'facet touch target is at least 40 CSS px');
    await rare.scrollIntoViewIfNeeded();
    await capture(page, 'phone-facet-search');
    await rare.tap(); await membership(page, ['r39']);
    assert.equal(await page.locator('#rail').isHidden(), true);
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#rail'))), false, 'focus cannot remain inside the closed phone rail');
    const remove = page.locator('button[data-scope-facet=artist][data-scope-value="Zzyzx Ensemble"]');
    await remove.tap(); await membership(page, clips.map(c => c.id));
    await page.locator('#toggle-rail').tap();
    assert.equal(await page.locator('#rail').isVisible(), true);
    const controlBox = await search.boundingBox();
    assert.ok(controlBox.x >= 0 && controlBox.x + controlBox.width <= 390, 'facet search stays within the phone viewport');
    await capture(page, 'phone-recovered');
  } finally { await close(page); }
});
