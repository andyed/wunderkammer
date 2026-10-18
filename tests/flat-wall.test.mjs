import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { clips } from './fixtures/layout-clips.mjs';

let server, browser, origin;
before(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://fixture.test').pathname;
    if (pathname === '/test-image-small.svg' || pathname === '/test-image-large.svg') {
      const size = pathname.includes('small') ? 128 : 640;
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#508eae"/></svg>`);
    } else if (pathname === '/api/clips') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ clips, facets: { source: { large: 385, other: 343 },
        tags: { shared: 728, second: 364 } } }));
    } else if (pathname === '/' || /^\/wall\/[\w.-]+$/.test(pathname)) {
      try {
        const file = pathname === '/' ? 'wall/index.html' : pathname.slice(1);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../${file}`, import.meta.url)));
      } catch { res.writeHead(404); res.end(); }
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});
async function settled(page) {
  await page.waitForTimeout(400); // Includes canonical tile transitions and ResizeObserver.
  // Under load, transitions can outlast 400ms: wait until tile geometry stops moving (bounded).
  await page.waitForFunction(() => {
    const now = [...document.querySelectorAll('#canvas > .tile')].slice(0, 200).map(t => { const r = t.getBoundingClientRect(); return `${r.x | 0},${r.y | 0},${r.width | 0}`; }).join(';');
    const same = now === window.__settleSig; window.__settleSig = now; return same;
  }, null, { polling: 120, timeout: 3000 }).catch(() => {});
}
async function geometry(page) {
  return page.evaluate(() => {
    const r = document.querySelector('#stage').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.tile')].map(el => el.getBoundingClientRect());
    const canvas = document.querySelector('#canvas').getBoundingClientRect();
    return { count: boxes.length,
      outside: boxes.filter(t=>t.left<r.left-1||t.right>r.right+1||t.top<r.top-1||t.bottom>r.bottom+1).slice(0,2).map(t=>({x:t.x,y:t.y,w:t.width,h:t.height})),
      stage: {x:r.x,y:r.y,w:r.width,h:r.height},
      fill: boxes.reduce((sum, t) => sum + Math.max(0, Math.min(t.right, r.right) - Math.max(t.left, r.left)) *
        Math.max(0, Math.min(t.bottom, r.bottom) - Math.max(t.top, r.top)), 0) / (r.width * r.height),
      framed: boxes.every(t => t.left >= r.left - 1 && t.right <= r.right + 1 && t.top >= r.top - 1 && t.bottom <= r.bottom + 1),
      aspect: canvas.width / canvas.height,
      minHeight: Math.min(...boxes.map(t => t.height)),
      transform: document.querySelector('#canvas').style.transform };
  });
}

test('rendered overview fills available space after grouping, resizing, filtering and rail changes', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(origin);
    await page.locator('.tile').first().waitFor();
    await page.selectOption('#group', 'source');
    await settled(page);
    let g = await geometry(page);
    assert.ok(g.fill > 0.5 && g.framed, JSON.stringify(g));
    assert.equal(g.count, 728);
    for (const size of [{ width: 800, height: 1000 }, { width: 1920, height: 900 }]) {
      await page.setViewportSize(size); await settled(page);
      g = await geometry(page);
      assert.ok(g.fill > 0.5 && g.framed, JSON.stringify({ size, ...g }));
    }
    await page.click('#toggle-rail'); await settled(page);
    g = await geometry(page);
    assert.ok(g.fill > 0.5 && g.framed, JSON.stringify(g));
    await page.fill('#search', 'Research 727'); await settled(page);
    g = await geometry(page);
    assert.equal(g.count, 1); assert.ok(g.minHeight > 200 && g.framed, JSON.stringify(g));
    await page.fill('#search', 'no-such-research'); await settled(page);
    assert.equal((await geometry(page)).count, 0);
    assert.equal(await page.locator('#empty').isVisible(), true);
    await page.fill('#search', ''); await settled(page);
    assert.ok((await geometry(page)).fill > 0.5);
    await page.click('#zoom-in'); await settled(page);
    const zoomed = (await geometry(page)).transform;
    await page.setViewportSize({ width: 1600, height: 900 }); await settled(page);
    assert.equal((await geometry(page)).transform, zoomed, 'manual exploration survives resize');
    await page.click('#zoom-fit'); await settled(page);
    assert.ok((await geometry(page)).framed, 'Fit recomposes after manual zoom and resize');
  } finally { await page.close(); }
});

test('every tag occurrence renders and pointer, keyboard and touch open the same clip', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 }, hasTouch: true, reducedMotion: 'reduce' });
  try {
    await page.goto(origin);
    await page.fill('#search', 'Research 727');
    await page.selectOption('#group', 'tags'); await settled(page);
    const tiles = page.locator('.tile');
    assert.equal(await tiles.count(), 2);
    assert.equal(await page.locator('#count b').textContent(), '1');
    const captionSize = await page.locator('.cap .t').first().evaluate(el => {
      const scale = new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform).a;
      return parseFloat(getComputedStyle(el).fontSize) * scale;
    });
    assert.ok(captionSize >= 12.4, `caption shrank to ${captionSize}px`);
    await tiles.first().tap();
    assert.equal(await page.locator('#detail.open h2').textContent(), 'Research 727');
    await page.keyboard.press('Escape'); await settled(page);
    await tiles.last().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#detail.open h2').textContent(), 'Research 727');
    assert.equal(await page.locator('.tile.selected').count(), 2);
    await page.keyboard.press('Escape'); await settled(page);
    await tiles.last().click();
    assert.equal(await page.locator('#detail.open h2').textContent(), 'Research 727');
    await page.keyboard.press('Escape');
    await page.fill('#search', ''); await settled(page);
    assert.equal(await tiles.count(), 1092);
    assert.ok((await geometry(page)).fill > 0.65);
  } finally { await page.close(); }
});

test('detail scales and resizes over a stable collection without repacking it', async () => {
  const page = await browser.newPage({ viewport: { width: 3840, height: 770 }, reducedMotion: 'reduce', hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#22cc55"/></svg>');
    await page.route('**/api/clips', route => route.fulfill({ json: {
      clips: [{ ...clips[727], cover: svg, note: 'Long research note\n'.repeat(100) }], facets: {},
    }}));
    await page.goto(origin); await settled(page); await page.locator('.tile').click(); await settled(page);
    const panel = page.locator('#detail'), handle = page.getByRole('separator', { name: 'Resize detail pane' });
    const size = () => panel.boundingBox();
    assert.equal(Math.round((await size()).width), 1536, 'wide display gets a proportional inspector');
    const stage = await page.locator('#stage').boundingBox();
    assert.equal(Math.round(stage.x + stage.width), 3840, 'reader overlays the unchanged desk width');
    const img = await panel.locator('img').boundingBox();
    assert.ok(img.height <= 610 && img.height > 500, 'large image fits short wide window');
    assert.equal(await panel.locator('img').evaluate(n => getComputedStyle(n).objectFit), 'contain');
    await page.setViewportSize({ width: 1600, height: 950 }); await settled(page);
    assert.equal(Math.round((await size()).width), 640, 'default follows window size');
    const beforeResize = await page.locator('.tile').first().evaluate(n => [n.style.width, n.style.height, n.style.transform]);
    const h = await handle.boundingBox();
    await page.mouse.move(h.x + 6, h.y + 180); await page.mouse.down();
    await page.mouse.move(h.x - 154, h.y + 180, { steps: 8 }); await page.mouse.up(); await settled(page);
    assert.equal(Math.round((await size()).width), 800, 'left-edge drag enlarges detail');
    assert.deepEqual(await page.locator('.tile').first().evaluate(n => [n.style.width, n.style.height, n.style.transform]), beforeResize, 'reader resizing preserves item geometry');
    await handle.focus(); await page.keyboard.press('ArrowRight'); await settled(page);
    assert.equal(Math.round((await size()).width), 768, 'keyboard narrows by 32px');
    assert.equal(await handle.getAttribute('aria-valuenow'), '768');
    await page.keyboard.press('Escape'); await settled(page);
    assert.ok(await panel.evaluate(n => n.inert), 'closed pane leaves keyboard navigation');
    await page.locator('.tile').click(); await settled(page);
    assert.equal(Math.round((await size()).width), 768, 'chosen width survives opening another item');
    await page.setViewportSize({ width: 390, height: 844 }); await settled(page);
    assert.equal(Math.round((await size()).width), 390, 'phone gets a full-width inspector');
    assert.equal(await handle.isVisible(), false);
    await page.setViewportSize({ width: 1600, height: 950 }); await settled(page);
    assert.equal(Math.round((await size()).width), 768, 'desktop preference survives phone-sized window');
    // Actual touch input on the same separator, with pointer capture.
    const touch = await handle.boundingBox(), x = touch.x + 6, y = touch.y + 120;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 64, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settled(page);
    assert.equal(Math.round((await size()).width), 832, 'touch drag resizes');
    await handle.dblclick({ position: { x: 6, y: 180 } }); await settled(page);
    assert.equal(Math.round((await size()).width), 640, 'double click restores proportional default');
    await page.locator('#detail-content').evaluate(n => { n.scrollTop = n.scrollHeight; });
    await panel.locator('.close').click();
    assert.equal(await panel.getAttribute('class'), 'detail');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('edge-pan prototype enlarges rendered tiles, reverses the drag, and offers exact recovery', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#40dd70"/></svg>');
    await page.route('**/api/clips', route => route.fulfill({ json: {
      clips: clips.map(c => ({ ...c, cover })), facets: {},
    }}));
    await page.goto(origin); await page.locator('.tile').first().waitFor(); await settled(page);
    const scale = () => page.locator('#canvas').evaluate(n => new DOMMatrix(getComputedStyle(n).transform).a);
    let dragStart = { x: 600, y: 400 };
    const pan = async (distance, reverse = 0) => {
      dragStart = await page.evaluate(() => {
        const points = [...document.querySelectorAll('.tile img')].filter(n => n.checkVisibility())
          .map(n => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })
          .filter(p => p.x > 400 && p.x < 750 && p.y > 120 && p.y < 700);
        points.sort((a, b) => Math.hypot(a.x - 600, a.y - 400) - Math.hypot(b.x - 600, b.y - 400));
        return points[0] || { x: 600, y: 400 };
      });
      if (await page.locator('.tile').count()) assert.equal(await page.evaluate(p => {
        const hit = document.elementFromPoint(p.x, p.y), tile = hit.closest('.tile');
        return !!tile && (hit.tagName === 'IMG' || tile.classList.contains('overview-painted'));
      }, dragStart), true, 'start on rendered artwork with its canonical tile hit target');
      await page.mouse.move(dragStart.x, dragStart.y); await page.mouse.down();
      await page.mouse.move(dragStart.x + distance, dragStart.y, { steps: 12 });
      await page.waitForTimeout(100);
      const peak = await scale();
      if (reverse) await page.mouse.move(dragStart.x + distance - reverse, dragStart.y, { steps: 12 });
      return peak;
    };
    const setPan = mode => page.evaluate(m => { const s = document.getElementById('pan-behavior'); s.value = m; s.dispatchEvent(new Event('change')); }, mode);
    await setPan('bounded'); await settled(page);
    const bounded = await scale(); await pan(400); await page.mouse.up();
    assert.equal(await scale(), bounded);
    await page.mouse.wheel(0, 1800); await settled(page); assert.equal(await scale(), bounded);
    await setPan('edge'); await settled(page);
    const before = await geometry(page), initial = await scale();
    const peak = await pan(260);
    assert.ok(peak > initial * 1.1, 'continuing a drag past the outer edge enlarges the tiles');
    assert.ok((await geometry(page)).minHeight > before.minHeight * 1.1, 'visible tile geometry grows');
    assert.match(await page.locator('#edge-feedback').textContent(), /reverse this drag/);
    await page.mouse.move(dragStart.x, dragStart.y, { steps: 12 }); await page.waitForTimeout(100);
    assert.ok(Math.abs(await scale() - initial) < 0.0002, 'reversal unwinds zoom within the gesture');
    await page.mouse.up();
    assert.equal(await page.locator('#detail.open').count(), 0, 'drag does not activate a tile');
    await page.click('#zoom-fit'); await settled(page);
    const original = (await geometry(page)).transform;
    await pan(450); await page.mouse.up(); await settled(page);
    assert.ok(await page.locator('#edge-undo').isVisible());
    await page.locator('#edge-undo').click(); await settled(page);
    assert.equal((await geometry(page)).transform, original, 'Undo restores the exact pre-gesture view');
    await pan(300); await page.mouse.up(); await page.keyboard.press('Escape'); await settled(page);
    assert.equal((await geometry(page)).transform, original, 'Escape provides the same recovery');
    await page.mouse.move(700, 400); await page.mouse.wheel(0, 2400); await settled(page);
    assert.equal(await scale(), initial, 'wheel momentum cannot become edge zoom');
    await page.keyboard.down('Meta'); await page.mouse.wheel(0, -50); await page.keyboard.up('Meta'); await settled(page);
    assert.ok(await scale() > initial, 'explicit Command-scroll still zooms');
    await pan(260); await page.mouse.up();
    await page.fill('#search', 'no-such-research'); await settled(page);
    assert.equal(await page.locator('.tile').count(), 0);
    assert.equal(await page.locator('#edge-undo').isVisible(), false, 'filter changes retire stale undo');
    await pan(200); await page.mouse.up();
    assert.ok(Number.isFinite(await scale()), 'empty results stay finite');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

/** Sixteen items: half 2026, half 2025; colours and kaleido cut across the years. */
function contextFixture(page) {
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#73c198"/></svg>');
  const items = Array.from({ length: 16 }, (_, i) => ({ id: String(i), url: `urn:fixture:${i}`, title: `Picture ${i}`,
    captured: i < 8 ? '2026-01-01' : '2025-12-01', cover: svg,
    props: { year: i < 8 ? '2026' : '2025', color: i % 8 < 5 ? ['red'] : ['blue'], kaleido: i % 2 ? 'kaleido' : 'non-kaleido' } }));
  return page.route('**/api/clips', route => route.fulfill({ json: { clips: items,
    facets: { year: { 2026: 8, 2025: 8 }, color: { red: 10, blue: 6 }, kaleido: { kaleido: 8, 'non-kaleido': 8 } } } }));
}
const revealed = page => page.evaluate(() => document.getElementById('canvas').classList.contains('bg-revealed'));

test('zooming out reveals the whole corpus framed behind the filtered foreground; Fit dismisses it', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await contextFixture(page);
    await page.goto(origin); await settled(page);
    // Nothing is hidden when nothing is filtered: zooming out shows no plane.
    await page.click('#zoom-out'); await settled(page);
    assert.equal(await revealed(page), false); assert.equal(await page.locator('#bg-plane .tile').count(), 0);
    await page.click('#zoom-fit'); await settled(page);

    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '8');
    assert.equal(await page.locator('#canvas > .tile').count(), 8);
    assert.equal(await revealed(page), false, 'a fitted filtered overview has no background');
    assert.equal(await page.locator('#bg-plane').isHidden(), true);
    const stageBefore = await page.locator('#stage').boundingBox();
    const fitTransform = (await geometry(page)).transform;

    await page.click('#zoom-out'); await settled(page);
    assert.equal(await revealed(page), true, 'one zoom-out step below Fit reveals the plane');
    assert.equal(await page.locator('#bg-plane .tile').count(), 16, 'the plane holds the whole corpus');
    assert.equal(await page.locator('#bg-plane .tile.in-scope').count(), 8, 'lifted items stay marked in place');
    assert.equal(await page.locator('#count b').textContent(), '8', 'context never changes membership');
    assert.deepEqual(await page.locator('#stage').boundingBox(), stageBefore, 'revealing never resizes the stage');
    const overlap = await page.evaluate(() => {
      const fg = [...document.querySelectorAll('#canvas > .tile')].map(t => t.getBoundingClientRect());
      return [...document.querySelectorAll('#bg-plane .tile')].filter(b => { const r = b.getBoundingClientRect();
        return fg.some(f => r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top); }).length;
    });
    assert.equal(overlap, 0, 'background tiles never sit under foreground tiles');
    const bgHidden = await page.$$eval('#bg-plane .tile', ts => ts.filter(t => getComputedStyle(t).visibility === 'hidden').length);
    assert.equal(bgHidden, 0, 'the whole plane is on screen after one step out at this size');

    // The latch survives zooming back in, so a background item can be inspected.
    await page.click('#zoom-in'); await settled(page);
    assert.equal(await revealed(page), true);
    // Dive from a background item opens that identity without changing scope.
    const title = await page.evaluate(() => { const t = document.querySelector('#bg-plane .tile:not(.in-scope)'); t.click(); return t.getAttribute('aria-label'); });
    await settled(page);
    assert.equal(await page.locator('#detail.open h2').textContent(), title);
    assert.equal(await page.locator('#bg-plane .tile.selected').count(), 1);
    assert.equal(await page.locator('#count b').textContent(), '8');

    await page.click('#detail .close'); await settled(page);
    await page.click('#zoom-fit'); await settled(page);
    assert.equal(await revealed(page), false, 'Fit dismisses the plane');
    assert.equal(await page.locator('#bg-plane .tile').count(), 0, 'dismissed tiles leave the DOM');
    assert.equal((await geometry(page)).transform, fitTransform, 'Fit returns to the same foreground framing');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('zoom eases toward its target about the cursor and lands exactly; reduced motion snaps', async () => {
  const eased = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const snap = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
  try {
    // The eased camera lives in the compositor: read the computed matrix, not the style string.
    const read = page => page.evaluate(() => {
      const m = new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform);
      const r = document.querySelector('#stage').getBoundingClientRect();
      const [x, y, s] = [m.e, m.f, m.a];
      // Canvas point under the stage centre: this must not drift while zooming about the centre.
      return { s, cx: (r.width / 2 - x) / s, cy: (r.height / 2 - y) / s };
    });
    // The engine's own scale, unrounded. The transform string carries four decimals, so
    // comparing two roundings of the same product can disagree in the last place.
    const exact = page => page.evaluate(() => window.wunderkammerAisleDebug().view.flat.view.scale);
    for (const page of [eased, snap]) { await page.goto(origin); await page.locator('.tile').first().waitFor(); await settled(page); }
    const before = await read(eased), target = (await exact(eased)) * 1.3;
    await eased.click('#zoom-in');
    // Poll for an interpolated frame: the first animation frame can be late on a page still painting.
    let mid = before;
    for (let i = 0; i < 40 && !(mid.s > before.s + 1e-6 && mid.s < target - 1e-6); i++) { await eased.waitForTimeout(8); mid = await read(eased); }
    assert.ok(mid.s > before.s && mid.s < target, `eased frame is between start and target (${before.s} < ${mid.s} < ${target})`);
    // Compare in screen pixels: the transform string carries scale to four decimals.
    assert.ok(Math.abs(mid.cx - before.cx) * mid.s < 1 && Math.abs(mid.cy - before.cy) * mid.s < 1, 'anchor stays pinned mid-flight');
    await settled(eased);
    const after = await read(eased);
    const landed = await exact(eased);
    assert.ok(Math.abs(landed - target) < 1e-9, `lands exactly on the requested scale (${landed} vs ${target})`);
    assert.ok(Math.abs(after.cx - before.cx) * after.s < 1 && Math.abs(after.cy - before.cy) * after.s < 1, 'anchor stays pinned at rest');
    // Rapid ticks compose: three clicks land on 1.3^3, not on a partially eased value.
    await eased.click('#zoom-in'); await eased.click('#zoom-in'); await eased.click('#zoom-in'); await settled(eased);
    assert.ok(Math.abs((await exact(eased)) - target * 1.3 ** 3) < 1e-9, 'ticks compose onto one target');

    const s0 = await exact(snap);
    await snap.click('#zoom-in'); await snap.waitForTimeout(40);
    assert.ok(Math.abs((await exact(snap)) - s0 * 1.3) < 1e-9, 'reduced motion snaps immediately');
    assert.ok(Math.abs((await read(snap)).s - s0 * 1.3) < 1e-4, 'and the compositor shows it at once');
  } finally { await eased.close(); await snap.close(); }
});

test('a search makes the pre-search place its context; matches light up there; clearing restores the corpus plane', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  try {
    await contextFixture(page);
    await page.goto(origin); await settled(page);
    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settled(page);
    await page.fill('#search', 'Picture 1'); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '1', 'search refines the 2026 subset');
    await page.click('#zoom-out'); await settled(page);
    assert.equal(await revealed(page), true);
    assert.equal(await page.locator('#bg-plane .tile').count(), 8, 'context is the eight items searched from, not the corpus');
    assert.equal(await page.locator('#bg-plane .tile.in-scope').count(), 1, 'the match lights up in place');
    assert.equal(await page.evaluate(() => document.getElementById('bg-plane').classList.contains('search-context')), true);
    await page.fill('#search', ''); await settled(page);
    await page.click('#zoom-out'); await settled(page);
    assert.equal(await page.locator('#bg-plane .tile').count(), 16, 'without a search the plane is the whole corpus again');
    assert.equal(await page.locator('#bg-plane .tile.in-scope').count(), 8);
  } finally { await page.close(); }
});

test('arrow keys and the detail buttons traverse the review order and the wall follows', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await contextFixture(page);
    await page.goto(origin); await settled(page);
    const titles = await page.$$eval('#canvas > .tile', ts => ts.map(t => t.getAttribute('aria-label')));
    await page.locator('#canvas > .tile').first().click(); await settled(page);
    assert.equal(await page.locator('#detail h2').textContent(), titles[0]);
    await page.keyboard.press('ArrowRight'); await settled(page);
    assert.equal(await page.locator('#detail h2').textContent(), titles[1]);
    await page.locator('.detail-nav .btn').last().click(); await settled(page);
    assert.equal(await page.locator('#detail h2').textContent(), titles[2]);
    assert.equal(await page.locator('#canvas > .tile.selected').getAttribute('aria-label'), titles[2], 'selection follows');
    const centred = await page.evaluate(() => { const st = document.querySelector('#stage').getBoundingClientRect(), pane = document.querySelector('#detail').getBoundingClientRect(), t = document.querySelector('#canvas > .tile.selected').getBoundingClientRect();
      return Math.abs(t.x + t.width / 2 - (st.x + (pane.left - st.x) / 2)) < 2 && Math.abs(t.y + t.height / 2 - (st.y + st.height / 2)) < 2; });
    assert.ok(centred, 'the wall brings the stepped tile under the camera');
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await settled(page);
    assert.equal(await page.locator('#detail h2').textContent(), titles[titles.length - 1], 'wraps at the ends');
  } finally { await page.close(); }
});

test('with a detail open, Up and Down move to the neighbouring tile in the grid', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await contextFixture(page);
    await page.goto(origin); await settled(page);
    const box = async () => page.evaluate(() => { const t = document.querySelector('#canvas > .tile.selected').getBoundingClientRect();
      return { label: document.querySelector('#canvas > .tile.selected').getAttribute('aria-label'), x: t.x, y: t.y, w: t.width, h: t.height }; });
    await page.locator('#canvas > .tile').first().click(); await settled(page);
    const start = await box();
    await page.keyboard.press('ArrowDown'); await settled(page);
    const below = await box();
    assert.notEqual(below.label, start.label, 'Down changes the selection');
    assert.equal(await page.locator('#detail h2').textContent(), below.label, 'the detail follows the selection');
    // Screen positions move with the camera, so compare layout in the canvas's own frame.
    const layout = await page.evaluate(() => [...document.querySelectorAll('#canvas > .tile')].map(t => {
      const [x, y] = (t.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/) || []).slice(1).map(Number);
      return { label: t.getAttribute('aria-label'), x, y, w: parseFloat(t.style.width), h: parseFloat(t.style.height) };
    }));
    const a = layout.find(t => t.label === start.label), b = layout.find(t => t.label === below.label);
    assert.ok(b.y >= a.y + a.h - 1, 'the new tile lies below the old one');
    assert.ok(Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w), 'and shares its column');
    await page.keyboard.press('ArrowUp'); await settled(page);
    assert.equal((await box()).label, start.label, 'Up returns to the tile above');
    await page.keyboard.press('ArrowUp'); await settled(page);
    assert.equal((await box()).label, start.label, 'Up at the top edge stays put');
  } finally { await page.close(); }
});

test('a tile that absorbed duplicates lists them, with only web links, in its detail', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#73c198"/></svg>');
    const items = [{ id: 'keep', url: 'https://example.test/keep', title: 'Survivor', cover: svg, props: { duplicates: 2 },
      alsoAt: [{ title: 'Copy one', url: 'https://example.test/one', source: 'example.test', captured: '2026-09-01' },
        { title: 'Hostile', url: 'javascript:alert(1)' }, { title: 'Copy two', url: 'https://example.test/two' }] },
      { id: 'plain', url: 'https://example.test/plain', title: 'Plain', cover: svg }];
    await page.route('**/api/clips', route => route.fulfill({ json: { clips: items, facets: {} } }));
    await page.goto(origin); await settled(page);
    await page.locator('#canvas > .tile[aria-label="Survivor"]').click(); await settled(page);
    assert.equal(await page.locator('#detail .also-at summary').textContent(), '3 more with the same page or image');
    assert.deepEqual(await page.$$eval('#detail .also-at a', as => as.map(a => a.getAttribute('href'))),
      ['https://example.test/one', 'https://example.test/two'], 'non-web URLs are not linked');
    await page.keyboard.press('ArrowRight'); await settled(page);
    assert.equal(await page.locator('#detail h2').textContent(), 'Plain');
    assert.equal(await page.locator('#detail .also-at').count(), 0, 'no list without duplicates');
  } finally { await page.close(); }
});

test('group approach preserves scope and explicit filtering or context headings narrow it', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  try {
    await contextFixture(page);
    await page.goto(origin); await settled(page);
    await page.selectOption('#group', 'color'); await settled(page);
    const heading = page.locator('#canvas .block h2[role="button"]').first();
    const label = (await heading.evaluate(h => h.firstChild.textContent));
    await heading.click(); await settled(page);
    assert.equal(Number(await page.locator('#count b').textContent()), 16, 'approach retains all identities');
    await page.click('#tray-filter'); await settled(page);
    assert.equal(await page.locator(`[data-facet="color"][data-value="${label}"][aria-pressed="true"]`).count(), 1, 'explicit filter applies its facet value');
    const count = Number(await page.locator('#count b').textContent());
    assert.ok(count > 0 && count < 16, `narrowed to the group (${count})`);
    await page.click('#zoom-out'); await settled(page);
    assert.equal(await revealed(page), true);
    const other = page.locator('#bg-plane .block h2[role="button"]').filter({ hasNotText: label }).first();
    const otherLabel = await other.evaluate(h => h.firstChild.textContent);
    await other.evaluate(h => h.click()); await settled(page);
    assert.equal(await page.locator(`[data-facet="color"][data-value="${otherLabel}"][aria-pressed="true"]`).count(), 1, 'a context-plane heading pivots the scope');
    assert.equal(await page.locator(`[data-facet="color"][data-value="${label}"][aria-pressed="true"]`).count(), 0, 'plain click replaces the value');
    await page.click('#scope-back'); await settled(page);
    assert.equal(Number(await page.locator('#count b').textContent()), count, 'Back restores the previous group');
  } finally { await page.close(); }
});

test('on a phone the wall takes the width, the rail is an overlay that closes after a choice, and pinch zooms', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await contextFixture(page);
    await page.goto(origin); await page.locator('.tile').first().waitFor(); await settled(page);
    const stage = await page.locator('#stage').boundingBox();
    assert.equal(stage.width, 390, 'the wall has the whole width');
    assert.ok(stage.y < 130, `header is compact (stage starts at ${stage.y})`);
    assert.equal(await page.locator('#rail').isVisible(), false, 'rail starts closed');
    assert.equal(await page.locator('#attribute-lens').isVisible(), false, 'hover-only controls are dropped');
    await page.locator('#toggle-rail').tap(); await settled(page);
    assert.equal(await page.locator('#rail').isVisible(), true, 'the ☰ button opens the rail');
    assert.equal((await page.locator('#stage').boundingBox()).width, 390, 'the rail overlays rather than squeezing the wall');
    await page.locator('[data-facet="year"][data-value="2026"]').tap(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '8');
    assert.equal(await page.locator('#rail').isVisible(), false, 'choosing a filter closes the rail');
    // Pinch: two touch pointers spreading apart about the stage centre.
    const before = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform).a);
    await page.evaluate(() => { const st = document.getElementById('stage'), r = st.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ev = (type, id, x, y) => st.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
      ev('pointerdown', 1, cx - 40, cy); ev('pointerdown', 2, cx + 40, cy);
      for (let i = 1; i <= 8; i++) { ev('pointermove', 1, cx - 40 - i * 10, cy); ev('pointermove', 2, cx + 40 + i * 10, cy); }
      ev('pointerup', 1, cx - 120, cy); ev('pointerup', 2, cx + 120, cy); });
    await settled(page);
    const after = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform).a);
    assert.ok(after > before * 1.8 && after < before * 3.2, `pinch spread 80→240px zooms about 3x (${(after / before).toFixed(2)}x)`);
    assert.equal(await page.locator('#detail.open').count(), 0, 'a pinch never opens a tile');
    // A tap still Dives (Fit first: the pinch carried the first tile off-screen).
    await page.locator('#zoom-fit').tap(); await settled(page);
    await page.locator('#canvas > .tile').first().tap(); await settled(page);
    assert.equal(await page.locator('#detail.open').count(), 1);
    // Swipe left across the detail steps to the next item in review order; swipe right returns.
    const titles = await page.$$eval('#canvas > .tile', ts => ts.map(t => t.getAttribute('aria-label')));
    assert.equal(await page.locator('#detail h2').textContent(), titles[0]);
    const swipe = dir => page.evaluate(dir => { const d = document.getElementById('detail'), r = d.getBoundingClientRect(); const y = r.top + r.height / 2, x0 = r.left + r.width / 2;
      const ev = (type, x) => d.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      ev('pointerdown', x0); ev('pointermove', x0 + dir * 60); ev('pointerup', x0 + dir * 120); }, dir);
    await swipe(-1); await settled(page);
    assert.equal(await page.locator('#detail h2').textContent(), titles[1], 'swipe left → next item');
    assert.match(await page.locator('.detail-nav .pos').textContent(), /^2 of 8$/);
    await swipe(1); await settled(page);
    assert.equal(await page.locator('#detail h2').textContent(), titles[0], 'swipe right → previous item');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('showcase flows the rest of the collection through the visible slots and leaves the wall untouched', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await contextFixture(page);
    await page.goto(origin + '/?flow=120'); await settled(page);
    for (let i = 0; i < 2; i++) { await page.click('#zoom-in'); await settled(page); }
    const tilesBefore = await page.$$eval('#canvas > .tile', ts => ts.map(t => t.getAttribute('aria-label') + '@' + t.style.transform));
    const visibleTiles = await page.$$eval('#canvas > .tile', ts => { const st = document.querySelector('#stage').getBoundingClientRect(); return ts.filter(t => { const r = t.getBoundingClientRect(); return r.height >= 80 && r.left >= st.left - r.width / 4 && r.right <= st.right + r.width / 4 && r.top >= st.top - r.height / 4 && r.bottom <= st.bottom + r.height / 4; }).map(t => t.getAttribute('aria-label')); });
    assert.ok(visibleTiles.length > 0 && visibleTiles.length < 16, `some slots are on screen and some items are not (${visibleTiles.length})`);
    await page.click('#showcase'); await page.waitForTimeout(700);
    const cards = await page.$$eval('.flow-card', cs => cs.map(c => c.getAttribute('aria-label')));
    assert.ok(cards.length >= 1 && cards.length <= visibleTiles.length, `cards sit only on visible slots (${cards.length} of ${visibleTiles.length})`);
    for (const label of cards) assert.ok(!visibleTiles.includes(label), `a flowing item is not one already on screen (${label})`);
    assert.equal(new Set(cards).size, cards.length, 'no item flows into two slots at once');
    const shown = cards[0];
    await page.locator('.flow-card').first().click(); await settled(page);
    assert.equal(await page.locator('#detail h2').textContent(), shown, 'a card click Dives into what it shows');
    await page.click('#detail .close'); await settled(page);
    await page.click('#showcase'); await settled(page);
    assert.equal(await page.locator('.flow-card').count(), 0, 'off removes every card');
    const tilesAfter = await page.$$eval('#canvas > .tile', ts => ts.map(t => t.getAttribute('aria-label') + '@' + t.style.transform));
    assert.deepEqual(tilesAfter, tilesBefore, 'the wall itself is untouched');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('the detail lists the item\'s facet values as chips; click filters by example, Shift-click adds', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await contextFixture(page);
    await page.goto(origin); await settled(page);
    await page.locator('#canvas > .tile').first().click(); await settled(page);
    const chip = page.locator('#detail .attrs [data-example-facet="color"]').first();
    const value = await chip.getAttribute('data-example-value');
    assert.ok(['red', 'blue'].includes(value), `the item's colour is a chip (${value})`);
    assert.ok((await page.$$eval('#detail .attrs dt', ds => ds.map(d => d.textContent))).includes('color'), 'the facet is labelled');
    await chip.click(); await settled(page);
    const expected = value === 'red' ? 10 : 6;
    assert.equal(await page.locator('#count b').textContent(), String(expected), 'click narrows to items sharing the value');
    assert.equal(await page.locator(`[data-facet="color"][data-value="${value}"][aria-pressed="true"]`).count(), 1, 'the rail agrees');
    assert.equal(await page.locator('#detail.open').count(), 1, 'the detail stays open');
    const other = value === 'red' ? 'blue' : 'red';
    await page.locator('#canvas > .tile').first().click(); await settled(page); // any visible item; then Shift-add via the rail-equivalent chip
    await page.locator(`[data-facet="color"][data-value="${other}"]`).click({ modifiers: [] }); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '16', 'both colour values selected shows everything');
  } finally { await page.close(); }
});

test('tour flies the camera through the groups and any input takes control back', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await contextFixture(page);
    await page.goto(origin); await settled(page);
    await page.selectOption('#group', 'color'); await settled(page);
    const fit = (await geometry(page)).transform, fitScale = Number(fit.match(/scale\(([\d.]+)/)[1]);
    await page.evaluate(() => { window.__samples = []; setInterval(() => window.__samples.push(document.getElementById('tour').getAttribute('aria-pressed') + '/' + document.querySelector('#canvas').style.transform), 500); });
    await page.click('#tour');
    assert.equal(await page.locator('#tour').getAttribute('aria-pressed'), 'true');
    // First step holds Fit; the next enters a group (a scale at or above Fit, a new position) and sweeps it.
    await page.waitForFunction(([f, fs]) => { const t = document.querySelector('#canvas').style.transform; return t !== f && Number(t.match(/scale\(([\d.]+)/)[1]) >= fs * 0.999; }, [fit, fitScale], { timeout: 8000 })
      .catch(async () => { throw new Error(`the tour never left Fit within 8s: ${JSON.stringify(await page.evaluate(() => window.__samples))}`); });
    assert.equal(await page.locator('#count b').textContent(), '16', 'the tour never changes scope');
    await page.mouse.move(700, 500); await page.mouse.wheel(0, 40); await settled(page);
    assert.equal(await page.locator('#tour').getAttribute('aria-pressed'), 'false', 'a wheel tick takes control back');
    const t1 = (await geometry(page)).transform; await page.waitForTimeout(2500);
    assert.equal((await geometry(page)).transform, t1, 'the camera stays where the user left it');
  } finally { await page.close(); }
});

test('zooming out stops at Fit of what there is to show: the collection, or the context plane when filtered', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  try {
    await contextFixture(page);
    await page.goto(origin); await settled(page);
    const scale = () => page.evaluate(() => Number(document.querySelector('#canvas').style.transform.match(/scale\(([\d.]+)/)[1]));
    const fit = await scale();
    for (let i = 0; i < 5; i++) { await page.click('#zoom-out'); await settled(page); }
    assert.ok(Math.abs(await scale() - fit) < 1e-4, 'unfiltered, zoom-out never goes below Fit');
    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settled(page);
    const fgFit = await scale();
    for (let i = 0; i < 8; i++) { await page.click('#zoom-out'); await settled(page); }
    const floor = await scale();
    assert.ok(floor < fgFit * 0.9, 'filtered, zoom-out goes far enough to reveal the plane');
    assert.equal(await revealed(page), true);
    const planeFits = await page.evaluate(() => { const st = document.querySelector('#stage').getBoundingClientRect();
      return [...document.querySelectorAll('#bg-plane .tile')].every(t => { const r = t.getBoundingClientRect(); return r.left >= st.left - 2 && r.right <= st.right + 2 && r.top >= st.top - 2 && r.bottom <= st.bottom + 2; }); });
    assert.ok(planeFits, 'and stops once the whole plane is on screen');
    await page.click('#zoom-out'); await settled(page);
    assert.ok(Math.abs(await scale() - floor) < 1e-4, 'no further');
  } finally { await page.close(); }
});

test('an album detail offers YouTube Music and Apple Music for the album and every track', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#335"/></svg>');
    const album = { id: 'a1', url: 'urn:clipwall:album:a1', title: 'Pink Floyd — Animals', kind: 'album', cover: svg, artist: 'Pink Floyd', album: 'Animals',
      tracks: ['Pigs on the Wing (Part One)', 'Dogs', 'Sheep'], props: { artist: 'Pink Floyd', year: '1977' } };
    await page.route('**/api/clips', route => route.fulfill({ json: { clips: [album, { ...album, id: 'a2', url: 'urn:clipwall:album:a2', title: 'Other — Thing', artist: 'Other', album: 'Thing', tracks: [] }], facets: { artist: { 'Pink Floyd': 1, Other: 1 }, year: { 1977: 2 } } } }));
    await page.goto(origin); await settled(page);
    await page.locator('#canvas > .tile').first().click(); await settled(page);
    const hrefs = await page.$$eval('#detail .listen a', as => as.map(a => a.href));
    assert.equal(hrefs[0], 'https://music.youtube.com/search?q=Pink%20Floyd%20Animals');
    assert.equal(hrefs[1], 'https://music.apple.com/us/search?term=Pink%20Floyd%20Animals');
    assert.equal(await page.locator('#detail .tracks li').count(), 3);
    const dogs = page.locator('#detail .tracks li').nth(1);
    assert.equal(await dogs.locator('.track').textContent(), 'Dogs');
    assert.equal(await dogs.locator('a').first().getAttribute('href'), 'https://music.youtube.com/search?q=Pink%20Floyd%20Dogs');
    assert.equal(await dogs.locator('a').last().getAttribute('aria-label'), 'Play Dogs on Apple Music');
    assert.equal(await page.$$eval('#detail .listen a, #detail .tracks a', as => as.every(a => a.target === '_blank' && a.rel.includes('noopener'))), true, 'external links open in a new tab safely');
  } finally { await page.close(); }
});

test('the facet rail keeps frequent values and reaches the long tail through local discovery', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#73c198"/></svg>');
    // 60 artists: two frequent, the rest one album each.
    const items = Array.from({ length: 70 }, (_, i) => ({ id: String(i), url: `urn:a:${i}`, title: `Album ${i}`, cover: svg,
      props: { artist: i < 6 ? 'Big One' : i < 12 ? 'Big Two' : `Solo ${i}` } }));
    const facets = { artist: {} }; for (const c of items) facets.artist[c.props.artist] = (facets.artist[c.props.artist] || 0) + 1;
    await page.route('**/api/clips', route => route.fulfill({ json: { clips: items, facets } }));
    await page.goto(origin); await settled(page);
    const chips = await page.locator('[data-facet="artist"]').count();
    assert.equal(chips, 24, 'at most 24 chips per facet');
    assert.match(await page.locator('.chip-more').textContent(), /^Show 24 more \(36 remaining\)$/);
    await page.locator('.chip-more').click();
    assert.equal(await page.locator('[data-facet="artist"]').count(), 48);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.facet), 'artist', 'expansion continues focus into the values');
    await page.locator('[data-facet-search="artist"]').fill('Solo 69');
    assert.equal(await page.locator('[data-facet="artist"]').count(), 1);
    assert.equal(await page.locator('#search').inputValue(), '', 'facet-local discovery leaves global search alone');
    assert.equal(await page.locator('#count b').textContent(), '70', 'finding a value does not yet refine scope');
    await page.locator('[data-facet="artist"][data-value="Solo 69"]').click(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '1', 'choosing the property-only value refines scope');
    await page.fill('#search', 'Album 69'); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '1');
  } finally { await page.close(); }
});

test('zooming in past a group heading pins a row title that steps between groups', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(origin); await page.locator('.tile').first().waitFor();
    await page.selectOption('#group', 'source'); await settled(page);
    assert.ok(await page.locator('#canvas .block:not(.tight)').count() || await page.locator('#row-title').isVisible(), 'overview keeps a readable group navigation route');
    // Long-tail blocks too narrow for a label show covers only; the label returns on zoom.
    // Text-to-image ratio: a heading taller than 1.2x its covers, or a block too narrow for a label, hides the heading.
    const tight = await page.$$eval('.block', bs => { const s = new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform).a;
      const text = Math.min(28, 14 + 5 * Math.log2(1 + s));
      return bs.map(b => ({ w: b.getBoundingClientRect().width, coverPx: Number(b.dataset.tileH) * s, band: 52 * s, text, tight: b.classList.contains('tight'), h2: getComputedStyle(b.querySelector('h2')).display })); });
    assert.ok(tight.length > 1, 'the fixture exercises multiple tray sizes');
    for (const b of tight) {
      assert.equal(b.tight, b.w < 96 || b.text > b.coverPx * 1.2 || b.band < b.text * 1.25 + 8, `tight iff narrow or text taller than covers (w ${b.w.toFixed(0)}, covers ${b.coverPx.toFixed(0)}px, text ${b.text.toFixed(0)}px)`);
      assert.equal(b.h2 === 'none', b.tight);
    }
    for (let i = 0; i < 10 && (await page.locator('.block.tight').count()) >= tight.filter(b => b.tight).length; i++) {
      await page.click('#zoom-in'); await settled(page);
    }
    assert.ok((await page.locator('.block.tight').count()) < tight.filter(b => b.tight).length, 'zooming in restores labels once their reserved band can contain readable text');
    // Pan down until some block's heading has left the top of the stage.
    const stage = await page.locator('#stage').boundingBox();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    for (let i = 0; i < 12 && !(await page.locator('#row-title').isVisible()); i++) { await page.mouse.wheel(0, 120); await settled(page); }
    assert.equal(await page.locator('#row-title').isVisible(), true, 'a cropped heading pins the row title');
    const labels = await page.$$eval('.block h2', hs => hs.map(h => h.firstChild.textContent));
    const shown = await page.locator('#row-title strong').textContent();
    assert.ok(labels.includes(shown), `row title names a real group (${shown})`);
    assert.match(await page.locator('#row-title .pos').textContent(), /^\d+ of \d+$/);
    // The title must sit inside the stage and never over the stage edge.
    const pill = await page.locator('#row-title').boundingBox();
    assert.ok(pill.x >= stage.x && pill.x + pill.width <= stage.x + stage.width, 'row title stays on stage');
    const before = (await geometry(page)).transform;
    await page.click('#row-title .rt-next'); await settled(page);
    assert.notEqual((await geometry(page)).transform, before, 'activation moves the camera');
    const headingTop = await page.evaluate(() => { const stage = document.querySelector('#stage').getBoundingClientRect();
      return Math.min(...[...document.querySelectorAll('.block')].map(b => b.getBoundingClientRect().top - stage.top).filter(t => t >= 0)); });
    assert.ok(headingTop >= 0 && headingTop < 40, `the next group's heading lands just below the top (${headingTop})`);
    assert.equal(await page.locator('#row-title').isVisible(), false, 'a visible heading needs no pinned title');
    await page.keyboard.press(']'); await settled(page);
    // Approach is spatial; the separate filter commits scope.
    for (let i = 0; i < 12 && !(await page.locator('#row-title').isVisible()); i++) { await page.mouse.wheel(0, 120); await settled(page); }
    const named = await page.locator('#row-title strong').textContent();
    await page.click('#row-title .rt-focus'); await settled(page);
    await page.click('#tray-filter'); await settled(page);
    const members = clips.filter(c => c.source === named).map(c => c.title).sort();
    assert.ok(members.length > 0 && members.length < clips.length);
    assert.deepEqual(await page.locator('#canvas > .tile').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')).sort()), members,
      'explicit tray filter narrows to the named group identities');
    await page.click('#scope-back'); await settled(page);
    await page.click('#zoom-fit'); await settled(page);
    assert.equal(await page.locator('#tray-return').isVisible(), false, 'Fit ends tray approach');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

// The cluster suggestions keep their scope mechanics while their placement in
// the UI is undecided; the panel is exposed directly here, not by zooming.
const exposeClusters = page => page.evaluate(() => {
  const host = document.getElementById('context-clusters');
  host.hidden = false; host.style.top = '160px'; host.style.height = '240px'; // clear of the fixed header
});

test('cluster suggestions switch scope, Shift-add a union, refine, remove and restore the view', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce', hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await contextFixture(page);
    await page.goto(origin + '/?pan=edge'); await settled(page);
    assert.equal(await page.locator('#context-clusters').isVisible(), false);
    await page.locator('[data-facet="year"][data-value="2026"]').click(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '8');
    assert.equal(await page.locator('.context-cluster').count(), 3);
    assert.equal(await page.locator('#context-clusters').isVisible(), false, 'no placed panel yet');
    await exposeClusters(page);
    const original = (await geometry(page)).transform;
    await page.locator('[data-cluster="color:red"] .cluster-select').focus();
    assert.match(await page.locator('#context-preview').textContent(), /Switch: 5 items · Add: 13 total/);
    await page.locator('[data-cluster="color:red"] .cluster-select').click(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '5');
    assert.equal(await page.locator('.tile').count(), 5);
    assert.equal(await page.locator('[data-facet="year"][aria-pressed="true"]').count(), 0);
    await page.click('#scope-back'); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '8');
    assert.equal((await geometry(page)).transform, original, 'Back restores exact pre-pivot camera');
    await exposeClusters(page);
    await page.locator('[data-cluster="color:red"] .cluster-select').click({ modifiers: ['Shift'] }); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '13');
    assert.equal(await page.locator('.scope-branch').count(), 2);
    await page.locator('[data-facet="color"][data-value="blue"]').click(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '3', 'facets refine the whole union');
    await page.click('#scope-back'); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '13');
    await page.getByRole('button', { name: 'Remove color: red', exact: true }).click(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '8');
    await page.locator('.scope-branch').click(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '0');
    assert.equal(await page.locator('#empty').isVisible(), true);
    await page.click('#scope-back'); await settled(page);
    // Touch has the same add operation without requiring a modifier.
    await exposeClusters(page);
    await page.locator('[data-cluster="color:red"] .cluster-add').tap(); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '13');
    await page.click('#scope-back'); await settled(page);
    await exposeClusters(page);
    await page.locator('[data-cluster="color:red"] .cluster-select').focus(); await page.keyboard.press('Shift+Enter'); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '13');
    await page.click('#scope-clear'); await settled(page);
    assert.equal(await page.locator('#count b').textContent(), '16');
    assert.equal(await page.locator('#context-clusters').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});


test('responsive cover images use screen size at overview and upgrade for review', async () => {
  const clip = clips.at(-1), previous = { cover: clip.cover, coverVariants: clip.coverVariants };
  clip.cover = '/test-image-small.svg';
  clip.coverVariants = [{ src: '/test-image-small.svg', width: 128 }, { src: '/test-image-large.svg', width: 640 }];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(origin);
    await page.waitForSelector('body[data-view-ready="true"]');
    await settled(page);
    const img = page.getByRole('button', { name: clip.title, exact: true }).locator('img');
    assert.match(await img.evaluate(async i => { await i.decode(); return i.currentSrc; }), /test-image-small.svg$/);
    await page.fill('#search', clip.title); await settled(page);
    assert.match(await img.evaluate(async i => { await i.decode(); return i.currentSrc; }), /test-image-large.svg$/);
    const geometry = await img.evaluate(i => ({ sizes: parseFloat(i.sizes), width: i.closest('.tile').getBoundingClientRect().width }));
    assert(Math.abs(geometry.sizes - geometry.width) <= 2, JSON.stringify(geometry));
  } finally { Object.assign(clip, previous); await page.close(); }
});

test('a pan only reveals clipped content: nothing moves at Fit, everything moves once the wall overflows', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await page.goto(origin); await settled(page);
    const r = await page.locator('#stage').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    const camera = () => page.evaluate(() => document.querySelector('#canvas').style.transform);
    const fitted = await camera();
    for (let i = 0; i < 8; i++) await page.mouse.wheel(60, 40);
    await settled(page);
    assert.equal(await camera(), fitted, 'wheel input at Fit has nothing to reveal and does not move the wall');
    // A short drag (inside the edge-zoom dead zone) must not slide the collection either.
    await page.mouse.down(); await page.mouse.move(r.x + r.width / 2 + 20, r.y + r.height / 2 + 12, { steps: 4 }); await page.mouse.up();
    await settled(page);
    assert.equal(await camera(), fitted, 'a drag at Fit does not slide a wholly visible collection');
    await page.keyboard.down('Control'); for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -60); await page.keyboard.up('Control');
    await settled(page);
    const zoomed = await camera();
    assert.notEqual(zoomed, fitted, 'zoom is explicit and always allowed');
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 60);
    await settled(page);
    assert.notEqual(await camera(), zoomed, 'with the wall overflowing the stage, a pan reveals clipped content');
  } finally { await page.close(); }
});


test('sorting after a tray approach clears the return pose for the old arrangement', async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  try {
    await contextFixture(page); await page.goto(origin); await settled(page);
    await page.selectOption('#group', 'color'); await settled(page);
    await page.locator('#canvas .block h2[role="button"]').first().click(); await settled(page);
    assert.equal(await page.locator('#tray-return').isVisible(), true);
    await page.selectOption('#sort-key', 'title'); await settled(page);
    assert.equal(await page.locator('#tray-return').isHidden(), true);
    assert.equal(await page.locator('#tray-filter').isHidden(), true);
    assert.equal(Number(await page.locator('#count b').textContent()), 16);
  } finally { await page.close(); }
});

test('zooming out at Fit is a no-op: the camera does not move and Fit stays responsive', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(origin);
    await page.locator('.tile').first().waitFor();
    await page.click('#zoom-fit'); await settled(page);
    const fitted = (await geometry(page)).transform;
    const r = await page.locator('#stage').boundingBox();
    await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.4);
    await page.keyboard.down('Control');
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(30); }
    await page.keyboard.up('Control');
    await settled(page);
    // Not "close": any write re-anchors by rounding and repaints the overview.
    assert.equal((await geometry(page)).transform, fitted, 'zoom-out at the floor wrote a camera move');
    // Fit is still in force, so a resize recomposes rather than keeping a manual camera.
    await page.setViewportSize({ width: 1100, height: 900 }); await settled(page);
    assert.notEqual((await geometry(page)).transform, fitted);
    assert.ok((await geometry(page)).framed, 'Fit no longer recomposes after a floor zoom-out');
  } finally { await page.close(); }
});

test('a landed zoom restyles only on-screen captions; every other tile takes its tier as it is revealed', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(origin); await settled(page);
    // Tier of every tile, and whether it intersects the stage, with the
    // caption display the reader actually gets.
    const tiers = () => page.evaluate(() => {
      const st = document.getElementById('stage').getBoundingClientRect();
      const scale = new DOMMatrix(getComputedStyle(document.getElementById('canvas')).transform).a;
      return { scale, tiles: [...document.querySelectorAll('#canvas > .tile')].map(t => {
        const r = t.getBoundingClientRect();
        return { tier: t.classList.contains('z-far') ? 'far' : t.classList.contains('z-near') ? 'near' : 'mid',
          onScreen: r.right > st.left && r.left < st.right && r.bottom > st.top && r.top < st.bottom,
          cap: getComputedStyle(t.querySelector('.cap')).display, meta: getComputedStyle(t.querySelector('.cap .m')).display };
      }) };
    });
    const expected = s => s < 0.30 ? 'far' : s > 1.20 ? 'near' : 'mid';
    const stale = ({ scale, tiles }) => tiles.filter(t => t.onScreen && (t.tier !== expected(scale)
      || (t.cap === 'none') !== (expected(scale) === 'far') || (t.meta === 'block') !== (expected(scale) === 'near')));
    let view = await tiers();
    assert.equal(expected(view.scale), 'far', `Fit of 1,092 tiles is a far view (scale ${view.scale})`);
    assert.deepEqual(stale(view), [], 'at Fit every visible caption is withheld');
    while ((view = await tiers()).scale <= 1.20) { await page.click('#zoom-in'); await settled(page); }
    assert.deepEqual(stale(view).length, 0, `landing near (scale ${view.scale.toFixed(2)}) restyles every visible caption`);
    const untouched = view.tiles.filter(t => !t.onScreen && t.tier === 'far').length;
    assert.ok(untouched > 100, `the landing does not sweep off-screen tiles (${untouched} still far)`);
    // Pan well past the reveal margin: each tile entering view must already carry the near tier.
    const r = await page.locator('#stage').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    for (let step = 0; step < 4; step++) {
      for (let i = 0; i < 6; i++) await page.mouse.wheel(200, 120);
      await page.waitForTimeout(16);
      view = await tiers();
      assert.deepEqual(stale(view), [], `pan step ${step}: no tile is seen with a stale caption tier`);
    }
    assert.ok(view.tiles.filter(t => t.onScreen).length > 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a pinch defers caption tiers and image upgrades until it lands', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    // Every cover has a small and a large variant, so a zoom has upgrades to make.
    await page.route('**/api/clips', async route => {
      const body = await (await route.fetch()).json();
      for (const clip of body.clips) { clip.cover = '/test-image-small.svg';
        clip.coverVariants = [{ src: '/test-image-small.svg', width: 128 }, { src: '/test-image-large.svg', width: 640 }]; }
      await route.fulfill({ json: body });
    });
    await page.goto(origin); await page.waitForSelector('body[data-view-ready="true"]'); await settled(page);
    // Let the boot's own loads drain, so anything that changes below is the pinch's doing.
    await page.waitForFunction(() => [...document.querySelectorAll('#canvas > .tile img')].every(i => !i.dataset.src && i.complete), null, { timeout: 15000 });
    const state = () => page.evaluate(() => {
      const tiles = [...document.querySelectorAll('#canvas > .tile')].filter(t => t.style.visibility !== 'hidden');
      return { scale: new DOMMatrix(getComputedStyle(document.getElementById('canvas')).transform).a,
        far: tiles.filter(t => t.classList.contains('z-far')).length, shown: tiles.length,
        images: [...document.querySelectorAll('#canvas > .tile img')].map(i => `${i.getAttribute('src')}|${i.sizes}|${i.srcset}`).join(';') };
    });
    const before = await state();
    assert.equal(before.far, before.shown, 'Fit starts far');
    const touch = (type, id, x, y) => page.evaluate(([type, id, x, y]) => document.getElementById('stage').dispatchEvent(new PointerEvent(type,
      { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 })), [type, id, x, y]);
    const r = await page.locator('#stage').boundingBox(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    await touch('pointerdown', 1, cx - 40, cy); await touch('pointerdown', 2, cx + 40, cy);
    for (let i = 1; i <= 8; i++) { await touch('pointermove', 1, cx - 40 - i * 20, cy); await touch('pointermove', 2, cx + 40 + i * 20, cy); }
    await page.waitForTimeout(400); // the fingers rest: still a gesture, not a landing
    const during = await state();
    assert.ok(during.scale > 0.36, `the pinch zoomed past the far threshold (${during.scale.toFixed(2)})`);
    assert.equal(during.far, during.shown, 'no caption tier changes while the fingers are down');
    { const a = before.images.split(';'), b = during.images.split(';'); const d = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x !== y);
      assert.equal(during.images, before.images, `no image request or upgrade starts mid-pinch: ${d.length} changed, e.g. ${JSON.stringify(d.slice(0, 3))}`); }
    await touch('pointerup', 1, cx - 200, cy); await touch('pointerup', 2, cx + 200, cy);
    await settled(page);
    const after = await state();
    assert.equal(after.far, 0, 'lifting the fingers lands the tier on the tiles in view');
    assert.notEqual(after.images, before.images, 'image upgrades start once the pinch lands');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
