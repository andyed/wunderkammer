// End-to-end contracts for the origin-preserving reader. The fixture is small:
// this tests interaction and image identity, not corpus-scale performance.
import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPermalinkHandler } from '../lib/permalinks.mjs';

const clips = Array.from({ length: 18 }, (_, i) => ({
  id: `reader-${i}`, url: `urn:reader:${i}`, title: `Reader ${String(i).padStart(2, '0')}`,
  source: i < 9 ? 'A' : 'B', captured: '', tags: [], props: {},
  cover: `/reader/thumb/${i}.svg`, detailCover: `/reader/full/${i}.svg`,
}));
let browser, server, origin, dir;
const errors = [];
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'smooth-reader-'));
  const snapshots = createPermalinkHandler(path.join(dir, 'links'));
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/api/permalinks')) return snapshots(req, res, url.pathname.split('/')[3]);
    if (url.pathname === '/api/clips') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ clips, facets: { source: { A: 9, B: 9 } }, corpus: { id: 'smooth-reader', revision: 'r1' },
        ui: { defaultGroup: 'source', facetOrder: ['source'], facetLabels: {} } })); return;
    }
    if (url.pathname === '/api/view-state') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'source', piles: [] })); return;
    }
    const media = url.pathname.match(/^\/reader\/(thumb|full)\/(\d+)\.svg$/);
    if (media) {
      const size = media[1] === 'full' ? 640 : 128;
      if (media[1] === 'full' && media[2] === '0') await new Promise(resolve => setTimeout(resolve, 350));
      res.setHeader('content-type', 'image/svg+xml');
      res.setHeader('cache-control', 'public, max-age=3600');
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="hsl(${Number(media[2]) * 20},40%,45%)"/><text x="10" y="40" fill="white" font-size="30">${media[2]}</text></svg>`); return;
    }
    if (url.pathname === '/' || /^\/wall\/[\w.-]+$/.test(url.pathname)) {
      try {
        const file = url.pathname === '/' ? 'wall/index.html' : url.pathname.slice(1);
        res.setHeader('content-type', file.endsWith('html') ? 'text/html' : file.endsWith('css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL('../' + file, import.meta.url))); return;
      } catch { /* Respond with a visible fixture failure. */ }
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
  await rm(dir, { recursive: true, force: true });
});
afterEach(() => assert.deepEqual(errors.splice(0), [], 'no uncaught browser errors'));

const title = page => page.locator('.detail-content h2').textContent();
const tile = (page, name) => page.locator(`.tile:not(.bg)[aria-label="${name}"]`);
const settle = page => page.waitForTimeout(650);
async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, ...options });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  await page.waitForSelector('body[data-view-ready=true]');
  await page.waitForFunction(() => [...document.querySelectorAll('#canvas > .tile img')].every(img => img.complete && img.naturalWidth));
  await settle(page);
  return page;
}
async function desk(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    return {
      stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
      camera: document.querySelector('#canvas').style.transform,
      tiles: [...document.querySelectorAll('#canvas > .tile')].map(node => [
        node.getAttribute('aria-label'), node.style.transform, node.style.width, node.style.height,
      ]),
    };
  });
}
async function exposedTile(page, exclude) {
  return page.evaluate(excluded => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const pane = document.querySelector('#detail').getBoundingClientRect();
    for (const node of document.querySelectorAll('#canvas > .tile')) {
      const r = node.getBoundingClientRect(), name = node.getAttribute('aria-label');
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (name !== excluded && x > stage.left + 10 && x < pane.left - 10 && y > stage.top + 10 && y < stage.bottom - 10 && document.elementFromPoint(x, y)?.closest('.tile') === node) return { name, x, y };
    }
    return null;
  }, exclude);
}

test('desktop lift and stepping preserve tile geometry and stage, then restore the exact camera', async () => {
  const page = await open();
  try {
    const before = await desk(page);
    const rightmost = await page.locator('#canvas > .tile').evaluateAll(nodes => nodes.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0].getAttribute('aria-label'));
    await tile(page, rightmost).click(); await settle(page);
    assert.equal(await title(page), rightmost);
    const opened = await desk(page);
    assert.deepEqual(opened.stage, before.stage, 'reader overlays the existing desk');
    assert.deepEqual(opened.tiles, before.tiles, 'opening never recomputes tile geometry');
    await page.getByRole('button', { name: 'Next item', exact: true }).click(); await settle(page);
    assert.notEqual(await title(page), rightmost);
    assert.deepEqual((await desk(page)).tiles, before.tiles, 'review steps preserve every origin slot');
    await page.keyboard.press('Escape'); await settle(page);
    assert.deepEqual(await desk(page), before, 'close restores geometry and the precise entry camera');
    assert.equal(await page.locator('.reader-lift-ghost').count(), 0);
  } finally { await page.close(); }
});

test('stationary pointers and camera movement cannot preview; new movement plus dwell can', async () => {
  const page = await open();
  try {
    await tile(page, 'Reader 00').click(); await settle(page);
    assert.equal(await title(page), 'Reader 00');
    assert.equal(await page.locator('.detail[data-preview]').count(), 0);
    let candidate = await exposedTile(page, 'Reader 00'); assert.ok(candidate, 'an exposed neighbour exists');
    // Re-layout can generate enter without a hand moving. That is not intent.
    await tile(page, candidate.name).dispatchEvent('pointerenter', { clientX: candidate.x, clientY: candidate.y, pointerType: 'mouse', buttons: 0 });
    await page.waitForTimeout(650);
    assert.equal(await title(page), 'Reader 00');
    await page.mouse.move(candidate.x, candidate.y);
    // Cancel the pending dwell without changing pointer coordinates.
    await page.locator('#stage').dispatchEvent('wheel', { clientX: candidate.x, clientY: candidate.y, deltaY: -35, ctrlKey: true, bubbles: true, cancelable: true });
    await page.waitForTimeout(850);
    assert.equal(await title(page), 'Reader 00', 'camera motion cancels stale hover intent');
    assert.equal(await page.locator('.detail[data-preview]').count(), 0);
    candidate = await exposedTile(page, 'Reader 00'); assert.ok(candidate);
    await page.mouse.move(candidate.x - 4, candidate.y);
    await page.mouse.move(candidate.x, candidate.y);
    await page.waitForFunction(name => document.querySelector('.detail[data-preview] h2')?.textContent === name, candidate.name);
    assert.deepEqual(await page.locator('.tile.selected').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label'))), ['Reader 00']);
    await page.keyboard.press('Escape'); assert.equal(await title(page), 'Reader 00');
    await page.keyboard.press('Escape'); await settle(page);
    assert.equal(await page.locator('.reader-lift-ghost').count(), 0, 'hover rerenders leave no orphaned lift');
  } finally { await page.close(); }
});

test('the thumbnail stays painted until full decode, and only immediate review neighbours prefetch', async () => {
  const page = await open();
  const requested = [];
  try {
    page.on('request', request => {
      if (request.url().includes('/reader/full/')) requested.push(new URL(request.url()).pathname);
    });
    await page.evaluate(() => {
      window.readerPaint = [];
      const started = performance.now();
      function sample() {
        if (document.querySelector('.detail.open')) {
          const target = document.querySelector('.detail-content > img');
          const painted = image => image?.complete && image.naturalWidth > 0 && getComputedStyle(image).visibility !== 'hidden';
          window.readerPaint.push({ src: target?.getAttribute('src'), painted: !!painted(target) || [...document.querySelectorAll('.reader-lift-ghost')].some(painted) });
        }
        if (performance.now() - started < 1500) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await tile(page, 'Reader 00').click();
    await page.waitForFunction(() => document.querySelector('.detail-content > img')?.getAttribute('src')?.includes('/thumb/0.svg'));
    assert.equal(await title(page), 'Reader 00');
    await page.waitForFunction(() => document.querySelector('.detail-content > img')?.getAttribute('src')?.includes('/full/0.svg'));
    await settle(page);
    assert.ok(requested.includes('/reader/full/1.svg'), 'immediate next item is decoded ahead');
    assert.ok(requested.includes('/reader/full/17.svg'), 'immediate previous item is decoded ahead');
    assert.ok(requested.every(src => /\/(0|1|17)\.svg$/.test(src)), `no distant media preload: ${requested}`);
    const samples = await page.evaluate(() => window.readerPaint);
    assert.ok(samples.length > 5);
    assert.ok(samples.every(sample => sample.painted), `blank reader frames: ${JSON.stringify(samples.filter(s => !s.painted))}`);
    await page.getByRole('button', { name: 'Next item', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.detail-content > img')?.getAttribute('src')?.includes('/full/1.svg'));
    assert.equal(await title(page), 'Reader 01', 'predecode preserves identity');
  } finally { await page.close(); }
});

test('reduced-motion keyboard traversal snaps, preserves identity and returns focus', async () => {
  const page = await open({ reducedMotion: 'reduce' });
  try {
    const before = await desk(page);
    await tile(page, 'Reader 00').focus(); await page.keyboard.press('Enter');
    assert.equal(await title(page), 'Reader 00');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    assert.equal(await title(page), 'Reader 02');
    assert.equal(await page.locator('.reader-lift-ghost').count(), 0, 'reduced motion never creates travel or crossfade clones');
    await page.keyboard.press('Escape'); await settle(page);
    assert.deepEqual(await desk(page), before);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Reader 00');
  } finally { await page.close(); }
});

test('mobile touch open and swipe share the keyboard review order and recover the desk', async () => {
  const page = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    const before = await desk(page);
    await page.locator('#scope-bar').evaluate(node => { node.inert = true; });
    await tile(page, 'Reader 00').tap(); await settle(page);
    assert.equal(await title(page), 'Reader 00');
    assert.deepEqual((await desk(page)).stage, before.stage);
    assert.equal(await page.locator('#stage').evaluate(node => node.inert), true, 'the covered mobile desk cannot receive focus or taps');
    assert.equal(await page.locator('#detail').getAttribute('aria-modal'), 'true');
    assert.equal(await page.locator('header.bar').evaluate(node => node.inert), true, 'toolbar is outside the modal focus surface');
    const next = page.getByRole('button', { name: 'Next item', exact: true });
    await next.focus(); await page.keyboard.press('Enter');
    assert.equal(await title(page), 'Reader 01');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Next item', 'repainting preserves the focused review action');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('#detail').contains(document.activeElement)), true);
    await page.getByRole('button', { name: 'Previous item', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await title(page), 'Reader 00');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Previous item');
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('#detail').contains(document.activeElement)), true, 'mobile keyboard focus stays in the reader');
    }
    await page.evaluate(() => {
      window.readerTouches = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        document.querySelector('#detail').addEventListener(type, event => window.readerTouches.push({
          type, pointerType: event.pointerType, x: event.clientX, y: event.clientY, target: event.target.tagName,
        }), true);
      }
    });
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 300 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 302 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 90, y: 303 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('.detail-content h2')?.textContent === 'Reader 01').catch(async error => {
      throw new Error(`${error.message}; touch trace: ${JSON.stringify(await page.evaluate(() => window.readerTouches))}; title: ${await title(page)}`);
    });
    await page.keyboard.press('ArrowLeft'); assert.equal(await title(page), 'Reader 00');
    await page.keyboard.press('Escape'); await settle(page);
    assert.deepEqual(await desk(page), before);
    assert.equal(await page.locator('.detail.open').count(), 0);
    assert.equal(await page.locator('#stage').evaluate(node => node.inert), false);
    assert.equal(await page.locator('header.bar').evaluate(node => node.inert), false, 'closing restores toolbar access');
    assert.equal(await page.locator('#scope-bar').evaluate(node => node.inert), true, 'closing preserves an existing inert state');
    assert.equal(await page.locator('.reader-lift-ghost').count(), 0);
  } finally { await page.close(); }
});

test('a repeated item lifts from and exposes the occurrence that was actually activated', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.route('**/api/clips', route => route.fulfill({ json: {
      clips: clips.map((c, i) => ({ ...c, tags: i === 13 ? ['North', 'South'] : i < 12 ? ['North'] : ['South'] })),
      facets: { tags: { North: 13, South: 6 } }, corpus: { id: 'repeat-reader', revision: 'r1' },
      ui: { defaultGroup: 'tags', facetOrder: ['tags'] },
    } }));
    await page.goto(origin); await page.waitForSelector('body[data-view-ready=true]');
    await page.waitForFunction(() => [...document.querySelectorAll('#canvas > .tile img')].every(i => i.complete && i.naturalWidth > 0));
    await settle(page);
    const occurrences = page.locator('#canvas > .tile[aria-label="Reader 13"]');
    assert.equal(await occurrences.count(), 2);
    const source = occurrences.last().locator('img'), before = await source.boundingBox();
    const tileBefore = await occurrences.last().boundingBox();
    const first = await occurrences.first().boundingBox();
    assert.ok(Math.abs(first.x - tileBefore.x) > 40, 'unequal trays put this repeated identity at different horizontal positions');
    await occurrences.last().click();
    await page.waitForSelector('.reader-lift-ghost');
    const liftOrigin = await page.locator('.reader-lift-ghost').first().evaluate(n => ({ x: parseFloat(n.style.left), y: parseFloat(n.style.top) }));
    assert.ok(Math.abs(liftOrigin.x - before.x) < 0.1 && Math.abs(liftOrigin.y - before.y) < 0.1,
      `the lift began at another occurrence: ${JSON.stringify({ before, liftOrigin })}`);
    assert.equal(await page.locator('#detail h2').textContent(), 'Reader 13');
    await settle(page);
    const stage = await page.locator('#stage').boundingBox(), pane = await page.locator('#detail').boundingBox();
    const after = await occurrences.last().boundingBox();
    const needsExposure = tileBefore.x < stage.x + 16 || tileBefore.x + tileBefore.width > pane.x - 16;
    const expectedCentre = needsExposure ? (stage.x + pane.x) / 2 : tileBefore.x + tileBefore.width / 2;
    assert.ok(Math.abs(after.x + after.width / 2 - expectedCentre) < 1,
      `reader camera followed another occurrence: ${JSON.stringify({ first, tileBefore, after, expectedCentre })}`);
  } finally { await page.close(); }
});
