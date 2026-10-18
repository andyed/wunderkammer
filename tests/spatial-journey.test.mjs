import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
let server, browser, origin;
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://fixture.test').pathname;
    if (path.startsWith('/fixtures/')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#76a9d8"/></svg>');
      return;
    }
    if (!/^\/(wall\/|tests\/fixtures\/)/.test(path)) { res.writeHead(404); res.end(); return; }
    try {
      const body = await readFile(new URL(`.${path}`, root));
      res.writeHead(200, { 'Content-Type': path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function fixture(t, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}/tests/fixtures/spatial-view.html`);
  await page.waitForFunction(() => window.fixtureReady);
  return page;
}

async function piles(page) {
  await page.evaluate(() => {
    const seed = view.clips[0];
    view.setClips(Array.from({ length: 12 }, (_, i) => ({ ...seed, id: String(i),
      url: `https://example.test/${i}`, title: `Cover ${i}`, source: i < 6 ? 'First tray' : 'Second tray' })));
    view.showPiles('source');
  });
}

test('opening a tray interpolates from its footprint and Back restores exact overview pose and placement', async t => {
  const page = await fixture(t);
  await piles(page);
  const before = await page.evaluate(() => {
    // Start from a deliberately framed overview, not a fresh Fit default.
    view.zoomBy(1.15, 400, 350);
    return { pose: view._cameraPose(), placement: Array.from(view.field.centres) };
  });
  const beginning = await page.evaluate(() => {
    view._activate(view.piles.piles[0].indices[0]);
    return { pose: view._cameraPose(), placement: Array.from(view.field.centres), moving: view.field.moving,
      cameraMoving: !!view._cameraMotion, scope: view.active.length,
      rim: view._trayRim?.visible, label: view.labelObjs[view.piles.spreadPile].visible };
  });
  assert.deepEqual(beginning.pose.position, before.pose.position, 'approach starts at visible camera');
  assert.deepEqual(beginning.placement, before.placement, 'spread starts at existing card footprints');
  assert.ok(beginning.moving > 0 && beginning.cameraMoving);
  assert.equal(beginning.scope, 12, 'opening a tray does not filter');
  assert.ok(beginning.rim && beginning.label, 'the open tray retains a visible rim and identity');
  await page.waitForFunction(() => !view._cameraMotion && view.field.moving === 0);
  await page.evaluate(() => view.collapse());
  await page.waitForFunction(() => !view._cameraMotion && view.field.moving === 0);
  const returned = await page.evaluate(() => ({ pose: view._cameraPose(), placement: Array.from(view.field.centres) }));
  assert.deepEqual(returned, before, 'return restores the exact overview, including custom framing');
  assert.equal(await page.evaluate(() => view._trayRim.visible), false);
});

test('reduced motion spreads and returns immediately while preserving identity and camera', async t => {
  const page = await fixture(t, 'reduce');
  await piles(page);
  const result = await page.evaluate(() => {
    const before = view._cameraPose();
    const i = view.piles.piles[0].indices[0];
    view._activate(i);
    const open = { moving: view.field.moving, cameraMoving: !!view._cameraMotion, spread: view.piles.spreadPile };
    view._activate(i);
    const opened = document.querySelector('#opened').textContent;
    view.collapse();
    return { before, after: view._cameraPose(), open, opened, expected: `${view.clips[i].title}|${view.clips[i].url}` };
  });
  assert.deepEqual(result.open, { moving: 0, cameraMoving: false, spread: 0 });
  assert.equal(result.opened, result.expected);
  assert.deepEqual(result.after, result.before);
});

test('shared members return to their own mixed-aspect tray without changing any original rectangle', async t => {
  const page = await fixture(t, 'reduce');
  const result = await page.evaluate(() => {
    const seed = view.clips[0];
    view.setClips(Array.from({ length: 26 }, (_, i) => ({ ...seed, id: String(i),
      url: `https://example.test/shared-${i}`, title: `Shared ${i}`,
      tags: i < 20 ? (i < 5 ? ['large', 'small'] : ['large']) : ['small'],
      props: { dims: [i % 2 ? '300x1000' : '1000x300'] } })));
    view.showPiles('tags');
    const original = { centres: Array.from(view.field.centres), sizes: Array.from(view.field.sizes) };
    const pile = view.piles.piles.find(p => p.all.length > p.exclusive.length);
    view._activate(pile.indices[0]);
    view.collapse();
    return { original, returned: { centres: Array.from(view.field.centres), sizes: Array.from(view.field.sizes) } };
  });
  assert.deepEqual(result.returned, result.original);
});

test('pointer zoom holds the chosen artwork point fixed and interrupts approach at its visible pose', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    const before = view.originRectangle(view.clips[0]);
    const x = before.x + before.width / 2, y = before.y + before.height / 2;
    view.zoomBy(1.4, x, y);
    const after = view.originRectangle(view.clips[0]);
    const destination = { position: [600, 300, 2500], target: [600, 300, 0], fitted: false };
    view._moveCamera(destination, { animate: true });
    view._tickCamera(view._cameraMotion.start + 150);
    const visible = view.basePos.toArray();
    view.zoomBy(1);
    return { x, y, after, visible, interrupted: view.basePos.toArray(), moving: !!view._cameraMotion };
  });
  assert.ok(Math.abs(result.x - result.after.x - result.after.width / 2) < 0.01);
  assert.ok(Math.abs(result.y - result.after.y - result.after.height / 2) < 0.01);
  assert.deepEqual(result.interrupted, result.visible, 'direct manipulation never jumps to the old destination');
  assert.equal(result.moving, false);
});

test('offscreen incumbents release DOM seats and tiny cards remain atlas representations', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    view.hybrid.promoteDistance = Infinity;
    view.hybrid.setFocus(-1);
    view._syncCamera(); view.hybrid.update(view.camera);
    const initial = view.hybrid.live.size;
    view.basePos.x = view.lookTarget.x = 100000;
    view._syncCamera(); view.hybrid.update(view.camera);
    const offscreen = view.hybrid.live.size;
    view.basePos.set(0, 0, 12000); view.lookTarget.set(0, 0, 0);
    view._syncCamera(); view.hybrid.update(view.camera);
    return { initial, offscreen, tiny: view.hybrid.live.size };
  });
  assert.ok(result.initial > 0);
  assert.equal(result.offscreen, 0);
  assert.equal(result.tiny, 0);
});

test('camera motion cancels a pending peek until fresh pointer intent', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { hoverOn = true; view._queueHover(0); view.zoomBy(1.01); });
  await page.waitForTimeout(160);
  assert.deepEqual(await page.evaluate(() => hoverLog), []);
  const rect = await page.evaluate(() => view.originRectangle(view.clips[0]));
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.waitForFunction(() => hoverLog.includes('Alpha'));
});

test('leaving a GPU card before dwell finishes never opens its preview', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    hoverOn = true;
    view.hybrid.setFocus(-1); view.hybrid.promoteDistance = 0; view.hybrid.update(view.camera);
    view._queueHover(0);
    const r = view.host.getBoundingClientRect();
    view._pickHover(r.left + 2, r.top + 2);
  });
  await page.waitForTimeout(160);
  assert.deepEqual(await page.evaluate(() => hoverLog), []);
});

test('two-finger touch zooms around its midpoint and never activates a card', async t => {
  const page = await fixture(t, 'reduce');
  await page.evaluate(() => {
    view.basePos.set(0, 0, 800); view.lookTarget.set(0, 0, 0); view.fitted = false;
    view._syncCamera(); view.hybrid.setFocus(-1);
  });
  const before = await page.evaluate(() => view.basePos.toArray());
  const cdp = await page.context().newCDPSession(page);
  const points = (left, right) => [{ x: left, y: 430, id: 1 }, { x: right, y: 430, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(500, 700) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(460, 740) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  const after = await page.evaluate(() => view.basePos.toArray());
  assert.ok(Math.abs(after[2] - before[2] / 1.4) < 1, `finger spread controls camera distance: ${JSON.stringify({ before, after })}`);
  assert.equal(await page.locator('#opened').textContent(), '', 'pinching is never an item activation');
});
