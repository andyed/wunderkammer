import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// The aisle fixture (aisle-integration.test.mjs): 80 albums in two decades.
const clips = Array.from({ length: 80 }, (_, i) => ({ id: `a${i}`, url: `urn:album:${i}`, title: `Album ${String(i).padStart(2, '0')}`, source: 'Fixture', tags: [],
  captured: i < 40 ? '2025-01-14' : '2025-02-20', cover: `/covers/${i % 2}.svg`, props: { decade: [i < 40 ? '1970s' : '1990s'], genre: [i % 3 ? 'Rock' : 'Jazz'] } }));
const facets = {}; for (const clip of clips) for (const [key, values] of Object.entries(clip.props)) for (const value of values) { facets[key] ??= {}; facets[key][value] = (facets[key][value] || 0) + 1; }
let browser, server, origin; const errors = [];
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/api/clips') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ clips, facets, corpus: { id: 'warehouse-fixture', revision: 'r1' }, ui: { title: 'Warehouse fixture', defaultGroup: 'decade', nouns: { item: 'record', items: 'records' } } })); return; }
    if (url.pathname === '/api/view-state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'decade', piles: [] })); return; }
    if (url.pathname.startsWith('/covers/')) { res.setHeader('content-type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="${url.pathname.includes('0') ? '#dc4422' : '#2f85ef'}"/></svg>`); return; }
    if (url.pathname === '/' || /^\/wall\/[\w./-]+$/.test(url.pathname) && !url.pathname.includes('..')) {
      try { const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(new URL('../' + file, import.meta.url))); return; } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); });
afterEach(() => assert.deepEqual(errors.splice(0), []));

async function open(query, { motion = true } = {}) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(origin + '/' + query); await p.waitForSelector('body[data-view-ready=true]');
  return p;
}
const rendered = async (p, fn, arg) => { const before = await p.evaluate(fn, arg); await p.waitForFunction(b => window.__cwAisle.renderCount > b, before); };
/** Everything the show touches, as the aisle holds it. */
const snapshot = p => p.evaluate(() => {
  const a = window.__cwAisle; let nodes = 0, records = 0;
  a.root.traverse(node => { nodes++; if (node.userData?.items) records++; });
  return { state: a.capture(), nodes, records, gap: a.art.gap,
    racks: a.art.racks.map(rack => rack.group.position.toArray()), walls: a.art.racks.flatMap(rack => rack.walls.map(wall => wall.position.x)),
    background: a.scene.background.getHexString(), fog: [a.scene.fog.color.getHexString(), a.scene.fog.near, a.scene.fog.far],
    floor: [a.art.floor.material.color.getHexString(), ...a.art.floor.scale.toArray()], grid: a.art.floorGrid.material.opacity,
    running: a.host.classList.contains('warehouse-running'), caption: !!a.host.querySelector('.warehouse-caption') };
});

test('the warehouse plays over the aisle and leaves it exactly as ?view=aisle opens it; a reload does not replay it', async () => {
  const p = await open('?view=warehouse&group=decade&rail=0'); let plain;
  try {
    await p.waitForFunction(() => window.__cwAisle?.show); await p.evaluate(() => window.__cwAisle.show.pause());
    // The exact link replaces the request at once, so Back, Copy and reload all mean the aisle.
    await p.waitForFunction(() => /[#&]s=/.test(location.hash) && !new URL(location.href).searchParams.has('view'));
    await rendered(p, () => { const a = window.__cwAisle; a.show.seek(2); return a.renderCount; });
    const mid = await snapshot(p), show = await p.evaluate(() => window.__cwAisle.getDiagnostics().warehouse);
    assert.ok(show.copies > 0 && show.lanes === 5, `rows of copies in five lanes (${JSON.stringify(show)})`);
    assert.deepEqual(show.caption, ['Records.', 'Lots of records.'], 'the collection\'s own nouns');
    assert.equal(mid.background, 'ffffff'); assert.equal(mid.running, true);
    assert.equal(mid.records, (await p.evaluate(() => window.__cwAisle.art.meshes.length)), 'copies carry no cover records');
    assert.equal(await p.locator('.aisle-toolbar').evaluate(n => getComputedStyle(n).opacity), '0', 'the aisle\'s controls wait out the show');
    assert.equal(await p.locator('.warehouse-lots').evaluate(n => getComputedStyle(n).opacity), '1');

    await rendered(p, () => { const a = window.__cwAisle; a.show.finish('test'); return a.renderCount; });
    const left = await snapshot(p);
    assert.deepEqual((await p.evaluate(() => window.__cwAisle.getDiagnostics().lastWarehouse)).reason, 'test');
    plain = await open('?view=aisle&group=decade&rail=0');
    await plain.waitForTimeout(300);
    assert.deepEqual(left, await snapshot(plain), 'nothing of the show is left in the aisle');
    await p.waitForFunction(() => getComputedStyle(document.querySelector('.aisle-toolbar')).opacity === '1');
    const idle = await p.evaluate(() => window.__cwAisle.renderCount); await p.waitForTimeout(500);
    assert.ok(await p.evaluate(() => window.__cwAisle.renderCount) - idle <= 1, 'the render loop stops with the show');

    await p.reload(); await p.waitForSelector('body[data-view-ready=true]'); await p.waitForTimeout(400);
    assert.deepEqual(await p.evaluate(() => [window.__cwAisle.show, window.__cwAisle.lastShow]), [null, null], 'a reload opens the aisle without the show');
  } finally { await plain?.close(); await p.close(); }
});

test('a key ends the show at once and then acts on the aisle it leaves', async () => {
  const p = await open('?view=warehouse&group=decade&rail=0');
  try {
    await p.waitForFunction(() => window.__cwAisle?.show?.playing);
    await p.locator('.aisle-canvas').focus(); await p.keyboard.press('ArrowRight');
    const d = await p.evaluate(() => window.__cwAisle.getDiagnostics());
    assert.equal(d.lastWarehouse.reason, 'skipped'); assert.equal(d.warehouse, null);
    assert.ok(d.place, 'the arrow marked a cover');
    assert.equal(d.state.fitted, false, 'the camera turned to the cover');
    const entry = await p.evaluate(() => { const a = window.__cwAisle; return a.art.cameraPose(a.travel, a.camera.aspect).position; });
    assert.ok(Math.hypot(...d.state.position.map((v, i) => v - entry[i])) > .5, 'the camera stands where the arrow put it; the show did not put it back at the entrance');
    assert.ok(Math.abs(d.markScreen.x) < .8 && Math.abs(d.markScreen.y) < .8, `the marked cover is in the frame (${JSON.stringify(d.markScreen)})`);
    assert.equal(await p.locator('.warehouse-caption').count(), 0);
  } finally { await p.close(); }
});

test('reduced motion opens the aisle without the show', async () => {
  const p = await open('?view=warehouse&group=decade&rail=0', { motion: false });
  try {
    await p.waitForFunction(() => window.__cwAisle?.lastShow);
    assert.equal(await p.evaluate(() => window.__cwAisle.lastShow.reason), 'reduced-motion');
    const s = await snapshot(p);
    assert.equal(s.background, '050510'); assert.equal(s.caption, false); assert.equal(s.running, false);
  } finally { await p.close(); }
});
