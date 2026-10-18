import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const clips = Array.from({ length: 12 }, (_, i) => ({ id: `camera-${i}`, title: `Cover ${i}`,
  url: `https://example.test/camera-${i}`, source: ['North', 'South', 'West'][Math.floor(i / 4)],
  tags: ['fixture'], props: { dims: ['400x300'] }, cover: '/fixture.svg' }));
let server, browser, origin;
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://fixture.test').pathname;
    if (path === '/api/clips') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ clips, facets: { source: { North: 4, South: 4, West: 4 }, tags: { fixture: 12 } } }));
    } else if (path === '/fixture.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#5686ad"/></svg>');
    } else if (path === '/camera') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><style>body{margin:0}#stage{position:relative;width:900px;height:650px;overflow:hidden;touch-action:none}#canvas{transform-origin:0 0;width:1600px;height:1200px;background:#345}</style><div id="stage"><div id="canvas"></div></div><script type="module">import { Viewport } from '/wall/viewport.mjs'; window.camera = new Viewport(document.querySelector('#stage'), document.querySelector('#canvas')); camera.setContent(1600,1200); camera.fit(); window.cameraReady=true;</script>`);
    } else if (path === '/' || /^\/wall\/[\w./-]+$/.test(path)) {
      try {
        const file = path === '/' ? 'wall/index.html' : path.slice(1);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../${file}`, import.meta.url)));
      } catch { res.writeHead(404); res.end(); }
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function pageFor(t, path = '/', reducedMotion = 'reduce', options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion, ...options });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.goto(origin + path);
  if (path === '/camera') await page.waitForFunction(() => window.cameraReady && !camera._frame);
  else { await page.locator('#canvas > .tile').first().waitFor(); await page.selectOption('#group', 'source'); }
  return page;
}

async function settleCanvas(page) {
  await page.waitForFunction(() => !document.querySelector('#canvas').getAnimations().some(a => a.playState === 'running'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function approach(page) {
  const heading = page.locator('#canvas .block h2[role="button"]:visible').first();
  if (await heading.count()) await heading.click();
  else await page.locator('#row-title .rt-focus').click();
  await settleCanvas(page);
}

test('approaching a foreground group preserves membership and Return restores the exact camera', async t => {
  const page = await pageFor(t);
  await settleCanvas(page);
  const before = await page.locator('#canvas').evaluate(el => el.style.transform);
  await approach(page);
  assert.equal(await page.locator('#count b').textContent(), '12');
  assert.equal(await page.locator('#canvas > .tile').count(), 12);
  assert.ok(await page.locator('#tray-return').isVisible());
  assert.notEqual(await page.locator('#canvas').evaluate(el => el.style.transform), before);
  await page.locator('#tray-return').click();
  await settleCanvas(page);
  assert.equal(await page.locator('#canvas').evaluate(el => el.style.transform), before);
  assert.equal(await page.locator('#tray-return').isVisible(), false);
});

test('an explicit group filter is reachable after approach and changes scope', async t => {
  const page = await pageFor(t);
  await settleCanvas(page);
  await approach(page);
  await page.locator('#tray-filter').click();
  await page.waitForFunction(() => document.querySelector('#count b')?.textContent === '4');
  assert.equal(await page.locator('#canvas > .tile').count(), 4);
  assert.equal(await page.locator('#tray-return').isVisible(), false, 'scope change discards stale camera return');
});

test('direct pan interrupts a running approach at its visible pose without jumping to the destination', async t => {
  const page = await pageFor(t, '/camera', 'no-preference');
  await page.evaluate(() => camera.animateTo(-600, -250, 2, { duration: 1000 }));
  await page.waitForFunction(() => performance.now() < camera.settlesAt && getComputedStyle(camera.canvas).transform !== 'none');
  const result = await page.evaluate(() => {
    const visible = camera.visiblePose();
    camera._pan(21, -14);
    return { visible, actual: camera.snapshot(), transition: camera.settlesAt };
  });
  assert.ok(Math.abs(result.actual.x - result.visible.x - 21) < .02);
  assert.ok(Math.abs(result.actual.y - result.visible.y + 14) < .02);
  assert.ok(Math.abs(result.actual.scale - result.visible.scale) < .0001);
  assert.equal(result.transition, 0);
});

test('pointer-anchored zoom retains the same world point when retargeted during motion', async t => {
  const page = await pageFor(t, '/camera', 'no-preference');
  await page.evaluate(() => camera.zoomAt(270, 225, 1.5, { duration: 600 }));
  await page.waitForFunction(() => performance.now() < camera.settlesAt);
  const result = await page.evaluate(() => {
    const visible = camera.visiblePose(), point = { x: 540, y: 350 };
    const world = { x: (point.x - visible.x) / visible.scale, y: (point.y - visible.y) / visible.scale };
    camera.zoomAt(point.x, point.y, 1.3, { duration: 600 });
    return { world, point, target: camera.snapshot() };
  });
  assert.ok(Math.abs(result.target.x + result.world.x * result.target.scale - result.point.x) < .01);
  assert.ok(Math.abs(result.target.y + result.world.y * result.target.scale - result.point.y) < .01);
});

test('input before a scheduled transition starts also uses the visible pose', async t => {
  const page = await pageFor(t, '/camera', 'no-preference');
  const result = await page.evaluate(() => {
    const visible = new DOMMatrixReadOnly(getComputedStyle(camera.canvas).transform);
    camera.animateTo(-600, -250, 2, { duration: 1000 });
    camera._pan(15, 9);
    return { before: { x: visible.e, y: visible.f, scale: visible.a }, actual: camera.snapshot() };
  });
  assert.ok(Math.abs(result.actual.x - result.before.x - 15) < .02);
  assert.ok(Math.abs(result.actual.y - result.before.y - 9) < .02);
  assert.ok(Math.abs(result.actual.scale - result.before.scale) < .0001);
});

test('direct pan deltas before one animation frame accumulate without reading stale rendered geometry', async t => {
  const page = await pageFor(t, '/camera', 'no-preference');
  const result = await page.evaluate(() => {
    const before = camera.snapshot();
    camera._pan(15, 9);
    camera._pan(21, -14);
    return { before, actual: camera.snapshot(), visible: camera.visiblePose() };
  });
  assert.ok(Math.abs(result.actual.x - result.before.x - 36) < .0001);
  assert.ok(Math.abs(result.actual.y - result.before.y + 5) < .0001);
  assert.equal(result.actual.scale, result.before.scale);
  assert.deepEqual(result.visible, result.actual, 'a direct pending write is the latest input pose');
  await page.waitForFunction(() => !camera._frame);
  const painted = await page.evaluate(() => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(camera.canvas).transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
  assert.ok(Math.abs(painted.x - result.actual.x) < .011);
  assert.ok(Math.abs(painted.y - result.actual.y) < .011);
});

test('trusted two-finger flat pinch changes scale and carries its world anchor with the midpoint', async t => {
  const page = await pageFor(t, '/camera', 'no-preference', { hasTouch: true });
  await page.evaluate(() => camera.restore({ x: -150, y: -100, scale: 1, fitted: false }));
  await page.waitForFunction(() => !camera._frame);
  const before = await page.evaluate(() => camera.snapshot());
  const session = await page.context().newCDPSession(page);
  const touches = (left, right, y) => [{ id: 1, x: left, y }, { id: 2, x: right, y }];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(300, 500, 300) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(280, 540, 310) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(270, 590, 330) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => !camera._frame);
  const after = await page.evaluate(() => ({ ...camera.snapshot(), remainingTouches: camera._touches.size, pinch: camera._pinch, transition: camera.settlesAt }));
  assert.ok(Math.abs(after.scale - before.scale * 1.6) < .001, `pinch scale ${after.scale}, expected ${before.scale * 1.6}`);
  const anchor = { x: (400 - before.x) / before.scale, y: (300 - before.y) / before.scale };
  assert.ok(Math.abs(after.x + anchor.x * after.scale - 430) < .1, `midpoint x drift: ${after.x + anchor.x * after.scale - 430}`);
  assert.ok(Math.abs(after.y + anchor.y * after.scale - 330) < .1, `midpoint y drift: ${after.y + anchor.y * after.scale - 330}`);
  assert.equal(after.remainingTouches, 0);
  assert.equal(after.pinch, null);
  assert.equal(after.transition, 0, 'pinch tracks the fingers directly');
});

test('reduced motion cancels an existing transition and lands a subsequent camera action immediately', async t => {
  const page = await pageFor(t, '/camera', 'no-preference');
  await page.evaluate(() => camera.animateTo(-600, -250, 2, { duration: 2000 }));
  await page.waitForFunction(() => performance.now() < camera.settlesAt);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => camera.animateTo(-120, -80, 1.25));
  await page.waitForFunction(() => !camera._frame);
  const actual = await page.evaluate(() => ({ transform: getComputedStyle(camera.canvas).transform,
    transition: getComputedStyle(camera.canvas).transitionDuration, remaining: camera.settlesAt - performance.now() }));
  const pose = await page.evaluate(() => camera.visiblePose());
  assert.ok(Math.abs(pose.x + 120) < .02 && Math.abs(pose.y + 80) < .02);
  assert.equal(pose.scale, 1.25);
  assert.equal(actual.transition, '0s');
  assert.ok(actual.remaining <= 0);
});

test('rapid sort interruption continues from the visible card rectangle', async t => {
  const page = await pageFor(t, '/', 'no-preference');
  await page.waitForTimeout(350);
  await page.selectOption('#sort-key', 'title');
  await page.waitForTimeout(350);
  await page.click('#sort-direction');
  await page.waitForTimeout(70);
  const result = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#canvas > .tile')];
    const node = nodes.find(n => n.getAnimations().some(a => a.playState === 'running'));
    if (!node) throw new Error('No in-flight card to interrupt');
    const rect = n => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
    const before = rect(node);
    document.querySelector('#sort-direction').click();
    return { before, after: rect(node), animated: nodes.filter(n => n.getAnimations().some(a => a.playState === 'running')).length };
  });
  result.after.forEach((n, i) => assert.ok(Math.abs(n - result.before[i]) < 0.1, `card jumped at coordinate ${i}: ${JSON.stringify(result)}`));
  assert.ok(result.animated > 0 && result.animated <= 64);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#sort-direction').getAttribute('aria-label'), 'Sort ascending; reverse to descending');
});
