import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const colors = { alpha: '#ed2525', beta: '#20e040', gamma: '#2449ef', delta: '#ecd322' };
let server, browser, origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://fixture.test').pathname;
    const image = path.match(/^\/fixtures\/(alpha|beta|gamma|delta)\.svg$/);
    if (image) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${colors[image[1]]}"/></svg>`);
      return;
    }
    if (!/^\/(wall\/|tests\/fixtures\/)/.test(path)) {
      res.writeHead(404); res.end(); return;
    }
    try {
      // An alternate source file permits proving these tests fail against the
      // audited implementation without overwriting the working checkout.
      const source = path === '/wall/spatial/spatial-view.mjs' && process.env.WUNDERKAMMER_SPATIAL_SOURCE;
      const body = await readFile(source || new URL(`.${path}`, root));
      const type = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript';
      res.writeHead(200, { 'Content-Type': type }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function fixture(t, initial = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no page errors'); });
  await page.goto(`${origin}/tests/fixtures/spatial-view.html?initial=${initial}`);
  await page.waitForFunction(() => window.fixtureReady);
  return page;
}

async function titles(page, expected) {
  await page.waitForFunction((want) => {
    const actual = [...document.querySelectorAll('.sp-card')]
      .filter((el) => el.checkVisibility())
      .map((el) => el.querySelector('.sp-t')?.textContent).sort();
    return JSON.stringify(actual) === JSON.stringify(want.slice().sort());
  }, expected, { timeout: 5000 });
  const nodes = await page.locator('.sp-card .sp-t').allTextContents();
  assert.deepEqual(nodes.sort(), expected.slice().sort(), 'retired cards are removed, including hidden old contents');
}

async function expectRenderedColor(page, index, expected) {
  // Read pixels from Chromium's screenshot, not atlas bookkeeping: a healthy
  // cache or a correct DOM src does not prove the GPU drew the right image.
  let actual;
  for (let attempt = 0; attempt < 20; attempt++) {
    const point = await page.evaluate((i) => {
      const p = view.field.worldCentre(i, view.camera.position.clone()).project(view.camera);
      const r = view.webglRenderer.domElement.getBoundingClientRect();
      return { x: Math.round(r.x + (p.x + 1) * r.width / 2), y: Math.round(r.y + (1 - p.y) * r.height / 2) };
    }, index);
    const shot = await page.screenshot();
    actual = await page.evaluate(async ({ png, point }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(point.x, point.y, 1, 1).data].slice(0, 3);
    }, { png: shot.toString('base64'), point });
    // The custom shader's output transfer differs from DOM image output;
    // accept either transfer while still requiring the source's actual color.
    const linear = expected.map((value) => Math.round(255 * (value / 255 <= 0.04045
      ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)));
    if ([expected, linear].some((color) => actual.every((value, i) => Math.abs(value - color[i]) < 8))) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`rendered tile ${index}: expected RGB ${expected}, got ${actual}`);
}

async function useGPU(page) {
  await page.evaluate(() => {
    view.hybrid.setFocus(-1);
    view.hybrid.promoteDistance = 0;
    view.hybrid.update(view.camera);
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.sp-card')].every((el) => !el.checkVisibility()));
}

test('filter changes keep rendered cards, activation, and images bound to the same source', async (t) => {
  const page = await fixture(t);
  await titles(page, ['Alpha', 'Beta', 'Gamma']);
  await page.click('#narrow');
  await titles(page, ['Gamma']);
  const card = page.locator('.sp-card').filter({ hasText: 'Gamma' });
  await card.click();
  assert.equal(await page.locator('#opened').textContent(), 'Gamma|https://example.test/gamma');
  assert.match(await card.locator('img').getAttribute('src'), /gamma\.svg$/);
  assert.match(await card.locator('a').getAttribute('href'), /file=Gamma$/);
  await page.click('#replace');
  await titles(page, ['Delta']);
  await page.locator('.sp-card').filter({ hasText: 'Delta' }).click();
  assert.equal(await page.locator('#opened').textContent(), 'Delta|https://example.test/delta');
  await page.click('#retitle');
  await titles(page, ['Delta edited']);
  assert.match(await page.locator('.sp-card img').getAttribute('src'), /beta\.svg$/);
  if (process.env.WUNDERKAMMER_SPATIAL_SHOT_PREFIX) {
    await page.screenshot({ path: `${process.env.WUNDERKAMMER_SPATIAL_SHOT_PREFIX}-card.png` });
  }
});

test('GPU pixels refresh after an index is reused and after the same id changes cover', async (t) => {
  const page = await fixture(t);
  await titles(page, ['Alpha', 'Beta', 'Gamma']);
  await useGPU(page);
  await expectRenderedColor(page, 0, [237, 37, 37]);
  await page.click('#narrow');
  await useGPU(page);
  await expectRenderedColor(page, 0, [36, 73, 239]);
  await page.click('#replace');
  await useGPU(page);
  await expectRenderedColor(page, 0, [236, 211, 34]);
  await page.click('#retitle');
  await useGPU(page);
  await expectRenderedColor(page, 0, [32, 224, 64]);
  if (process.env.WUNDERKAMMER_SPATIAL_SHOT_PREFIX) {
    await page.screenshot({ path: `${process.env.WUNDERKAMMER_SPATIAL_SHOT_PREFIX}-gpu.png` });
  }
});

test('a narrow or empty first view can grow, shrink to zero, and restore the full field', async (t) => {
  for (const initial of ['narrow', 'empty']) {
    const page = await fixture(t, initial);
    await titles(page, initial === 'empty' ? [] : ['Gamma']);
    await page.click('#full');
    await titles(page, ['Alpha', 'Beta', 'Gamma']);
    assert.equal(await page.evaluate(() => view.field.count), 3);
    await page.click('#empty');
    await titles(page, []);
    assert.equal(await page.evaluate(() => view.field.count), 0);
    assert.equal(await page.evaluate(() => view.field.mesh.count), 0);
    await page.locator('#sp-css3d').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#opened').textContent(), '');
    await page.click('#full');
    await titles(page, ['Alpha', 'Beta', 'Gamma']);
    assert.equal(await page.locator('canvas').count(), 1, 'scene renderer is reused');
    assert.equal(await page.locator('[aria-live]').count(), 1, 'navigator is reused');
  }
});

async function survey(page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const counts = [42, 7, 59, 155, 143];
    const colors = ['alpha', 'beta', 'gamma'];
    const clips = counts.flatMap((n, g) => Array.from({ length: n }, (_, k) => ({
      id: `${g}-${k}`, url: `https://example.test/${g}/${k}`, title: `Group ${g} item ${k}`,
      source: `Group ${g}`, cover: `/fixtures/${colors[g % 3]}.svg`,
      props: { dims: [k % 5 ? '400x300' : '900x300'] }
    })));
    view.setClips(clips, 'source'); view.showPiles('source');
  });
  // Every group cover has loaded before assessing rendered pixels.
  await page.waitForFunction(() => view.field.atlases._inflight === 0
    && view.field.atlases._nearQueue.length === 0 && view.field.atlases._farQueue.length === 0);
  await page.waitForTimeout(400);
}

async function coverage(page) {
  const png = await page.locator('#host').screenshot();
  return page.evaluate(async data => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
      if (Math.max(...rgb) > 120 && Math.max(...rgb) - Math.min(...rgb) > 80) count++;
    }
    return count / (img.width * img.height);
  }, png.toString('base64'));
}

test('spatial overview fills the pane and remains pixel-stable through pointer movement and idle', async t => {
  const page = await fixture(t);
  await survey(page);
  assert.ok(await coverage(page) > 0.40, 'recognizable pile covers occupy at least 40% of the pane');
  await page.mouse.move(2, 2);
  const before = await page.locator('#host').screenshot();
  await page.mouse.move(1250, 740);
  await page.mouse.move(2, 2); // leave the intentional hover caption before comparing
  await page.waitForTimeout(7200); // past the former idle-orbit trigger
  const after = await page.locator('#host').screenshot();
  assert.ok(before.equals(after), 'no autonomous tile/camera movement or idle pixel shimmer');
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.waitForTimeout(500);
  assert.ok(await coverage(page) > 0.36, 'portrait overview repacks and fills the pane');
});

test('spatial stack opens to readable items, zoom and drag are deliberate, and return restores context', async t => {
  const page = await fixture(t);
  await survey(page);
  await page.locator('#sp-css3d').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => view.piles.spreadPile >= 0 && view.field.moving === 0);
  assert.ok(await page.locator('.sp-back').isVisible());
  assert.ok(await coverage(page) > 0.65, 'open stack uses the pane');
  const opened = await page.evaluate(() => view.piles.spreadPile);
  // Activate a visible member through the real GPU picking path.
  const point = await page.evaluate(() => {
    const i = view.piles.piles[view.piles.spreadPile].indices[0];
    const p = view.field.worldCentre(i, view.camera.position.clone()).project(view.camera);
    const r = view.host.getBoundingClientRect();
    return { x: r.x + (p.x + 1) * r.width / 2, y: r.y + (1 - p.y) * r.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  assert.match(await page.locator('#opened').textContent(), /^Group \d item 0\|/);
  assert.equal(await page.evaluate(() => view.piles.spreadPile), opened, 'second activation dives without collapsing');
  await page.evaluate(() => view.zoomBy(1.3));
  const zoomed = await page.evaluate(() => view.basePos.toArray());
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => view.basePos.toArray()), zoomed, 'manual camera survives resize');
  await page.mouse.move(800, 740); await page.mouse.down(); await page.mouse.move(870, 700, { steps: 5 }); await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(() => view.basePos.toArray()), zoomed, 'drag pans the spatial camera');
  await page.locator('.sp-back').click();
  assert.equal(await page.evaluate(() => view.piles.spreadPile), -1);
  await page.waitForFunction(() => !view._cameraMotion && view.field.moving === 0);
  assert.ok(await coverage(page) > 0.36);
});

test('touch opens a stack and DOM promotion preserves the image rectangle', async t => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 }, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}/tests/fixtures/spatial-view.html`);
  await page.waitForFunction(() => window.fixtureReady);
  await survey(page);
  const geometry = await page.evaluate(() => [...view.hybrid.live].map(([i, entry]) => {
    const centre = view.field.worldCentre(i, view.camera.position.clone()).project(view.camera);
    const r = view.host.getBoundingClientRect(), card = entry.el.getBoundingClientRect();
    return { dx: Math.abs(card.x + card.width / 2 - r.x - (centre.x + 1) * r.width / 2),
      dy: Math.abs(card.y + card.height / 2 - r.y - (1 - centre.y) * r.height / 2),
      ratio: entry.el.offsetWidth / entry.el.offsetHeight, expected: view.field.aspectOf(i) };
  }));
  assert.ok(geometry.length > 0);
  for (const g of geometry) {
    assert.ok(g.dx < 1 && g.dy < 1, 'DOM twin keeps GPU centre');
    assert.ok(Math.abs(g.ratio - g.expected) < 0.02, 'captions do not change card proportions');
  }
  await page.locator('.sp-card:visible').first().tap();
  await page.waitForFunction(() => view.piles.spreadPile >= 0);
  await page.locator('.sp-back').tap();
  assert.equal(await page.evaluate(() => view.piles.spreadPile), -1);
});

test('hover reports the item under the pointer only while previewing is enabled, and agrees with the click', async (t) => {
  const page = await fixture(t, 'full');
  await page.waitForFunction(() => view.field?.count >= 3);

  // Where item 0 actually is on screen, from the GPU's own placement.
  const point = await page.evaluate(() => {
    const p = view.field.worldCentre(0, view.camera.position.clone()).project(view.camera);
    const r = view.host.getBoundingClientRect();
    return { x: Math.round(r.x + (p.x + 1) * r.width / 2), y: Math.round(r.y + (1 - p.y) * r.height / 2) };
  });

  // Disabled: the pointer crosses the item and the field stays silent, which is
  // what keeps a field nobody is previewing from picking on every move.
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.hoverLog), [], 'no hover while disabled');

  await page.evaluate(() => { window.hoverOn = true; window.hoverLog = []; });
  await page.mouse.move(point.x + 3, point.y + 3);
  await page.mouse.move(point.x + 1, point.y + 2);
  await page.waitForFunction(() => document.querySelector('#hovered').textContent !== '', null, { timeout: 5000 });
  const hoveredTitle = await page.locator('#hovered').textContent();
  assert.ok(hoveredTitle, 'an item under the pointer is reported');

  // Repeated movement inside the same item must not re-report it.
  const before = await page.evaluate(() => window.hoverLog.length);
  await page.mouse.move(point.x + 5, point.y + 5);
  await page.mouse.move(point.x + 4, point.y + 6);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.hoverLog.length), before, 'one report per item, not per move');

  // Off every item: the field says so, once.
  const r = await page.evaluate(() => { const b = view.host.getBoundingClientRect(); return { x: Math.round(b.x + 4), y: Math.round(b.bottom - 4) }; });
  await page.mouse.move(r.x, r.y);
  await page.waitForFunction(() => document.querySelector('#hovered').textContent === '', null, { timeout: 5000 });

  // Hover and click must name the same clip, or the preview lies about what a
  // click would do.
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('#hovered').textContent !== '', null, { timeout: 5000 });
  const previewed = await page.locator('#hovered').textContent();
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('#opened').textContent !== '', null, { timeout: 5000 });
  const opened = (await page.locator('#opened').textContent()).split('|')[0];
  assert.equal(opened, previewed, 'the click opens exactly what the hover previewed');
});

test('with a corpus, a filter is membership: narrowing and widening draw no new tiles and repeat the same pixels', async (t) => {
  // The acceptance fixture from docs/PERF.md: A → B → ∅ → A over one corpus.
  // The second A must draw zero tiles and its settled frame must equal the
  // first A's. Draws are counted on the atlases themselves, not inferred.
  const page = await fixture(t);
  const settle = async () => {
    await page.waitForFunction(() => view.field.atlases._inflight === 0 && view.field.atlases._nearQueue.length === 0 && view.field.atlases._farQueue.length === 0);
    await page.waitForTimeout(350);
  };
  const state = (scope) => page.evaluate((scope) => {
    // Use the same corpus object graph throughout, as wall.mjs does.
    window.corpus ||= view.clips;
    if (!window.__draws) { window.__draws = 0; for (const a of [view.field.atlases.far, view.field.atlases.near]) { const d = a.draw.bind(a); a.draw = (s, i) => { const ok = d(s, i); if (ok) window.__draws++; return ok; }; } }
    const before = window.__draws;
    const sets = { A: [corpus[0], corpus[2]], B: [corpus[1]], none: [], all: corpus };
    view.setClips(sets[scope], 'none', { corpus, revision: 'r1' });
    // As the fixture's show() does: a stable camera, and DOM cards for everything in range.
    view.basePos.set(0, 0, 1600); view.lookTarget.set(0, 0, 0);
    view.camera.position.copy(view.basePos); view.camera.lookAt(view.lookTarget);
    view.hybrid.promoteDistance = 10000; view.hybrid.update(view.camera); view.invalidate();
    return { count: view.field.count, active: view.field.activeCount, drawsBefore: before };
  }, scope);
  await titles(page, ['Alpha', 'Beta', 'Gamma']);
  await settle();
  const first = await state('A'); await settle();
  assert.equal(first.count, 3, 'the field is allocated for the corpus, not the subset');
  assert.equal(first.active, 2);
  await titles(page, ['Alpha', 'Gamma']);
  const shotA = await page.locator('#host').screenshot();
  await state('B'); await settle(); await titles(page, ['Beta']);
  await state('none'); await settle(); await titles(page, []);
  const again = await state('A'); await settle(); await titles(page, ['Alpha', 'Gamma']);
  const drawsAfter = await page.evaluate(() => window.__draws);
  assert.equal(drawsAfter, again.drawsBefore, 'returning to a scope draws no new tiles: everything was still resident');
  assert.ok(drawsAfter <= 6, `the whole cycle drew at most one far and one near tile per item (${drawsAfter})`);
  const shotA2 = await page.locator('#host').screenshot();
  assert.ok(shotA.equals(shotA2), 'the second A is pixel-identical to the first');
  // Hidden items are not picked, not navigable, and not the selection.
  await state('B'); await settle();
  const picked = await page.evaluate(() => { const c = view.field.worldCentre(0, view.camera.position.clone()).project(view.camera); return view.field.pickAt(c.x, c.y, view.camera); });
  assert.equal(picked, -1, 'a hidden instance under the pointer is not hit');
  assert.equal(await page.evaluate(() => { view.nav.select(0); return view.nav.selection; }), -1, 'a hidden instance cannot be selected');
});

test('similarity map spreads on zoom: tiles hold a 14-28 px band while distances grow, hover enlarges one', async (t) => {
  const page = await fixture(t);
  const samples = await page.evaluate(async () => {
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // 300 points in four tight clumps: the spacing pass leaves tiles touching inside each clump.
    const clips = Array.from({ length: 300 }, (_, i) => {
      const c = [[-0.7, -0.6], [0.2, 0.7], [0.7, -0.3], [-0.2, 0.1]][i % 4];
      return { id: `s${i}`, title: `S${i}`, url: `https://example.test/s${i}`, cover: '/fixtures/alpha.svg',
        source: 'Fixture', tags: [], props: { dims: ['400x300'] },
        projection: { x: c[0] + Math.sin(i * 12.9898) * 0.05, y: c[1] + Math.cos(i * 78.233) * 0.05 } };
    });
    view.setClips(clips, '@similarity');
    await frame(); await frame();
    const focal = () => view.host.clientHeight / (2 * Math.tan(view.camera.fov * Math.PI / 360));
    const px = i => Math.max(view.field.sizes[i * 2], view.field.sizes[i * 2 + 1]) * focal() / view.basePos.z;
    const gap = (a, b) => Math.hypot(view.field.centres[a * 3] - view.field.centres[b * 3], view.field.centres[a * 3 + 1] - view.field.centres[b * 3 + 1]) * focal() / view.basePos.z;
    const fitZ = view.basePos.z, out = [];
    for (const k of [1, 0.5, 0.2, 0.08, 0.03]) {
      view.basePos.z = fitZ * k; view.invalidate(); await frame(); await frame();
      const sizes = view.active.map(px);
      out.push({ k, min: Math.min(...sizes), max: Math.max(...sizes), gap: gap(view.active[0], view.active[4]) });
    }
    view._hovered = view.active[0]; view._applySpread(true); await frame();
    out.push({ hovered: px(view.active[0]), neighbour: px(view.active[1]) });
    return out;
  });
  const hover = samples.pop();
  for (const s of samples) {
    assert.ok(s.min >= 14 - 0.01 && s.max <= 28 + 0.01, `zoom ${s.k}: tiles ${s.min.toFixed(1)}-${s.max.toFixed(1)} px leave the 14-28 band`);
  }
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].gap > samples[i - 1].gap * 1.5, 'zoom scales the distances between tiles');
  assert.ok(hover.hovered >= 96 - 0.01 && hover.neighbour <= 28 + 0.01, 'hover enlarges only the hovered tile');
});
