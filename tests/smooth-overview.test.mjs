import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const color = i => [40 + i * 29 % 180, 40 + i * 47 % 180, 40 + i * 67 % 180];
const clips = Array.from({ length: 200 }, (_, i) => ({
  id: `overview-${i}`, url: `urn:overview:${i}`, title: `Overview ${i}`, source: 'Collection',
  captured: '', tags: [i % 2 ? 'Warm' : 'Cool'], props: { year: [String(1980 + i % 40)], dims: ['128x128'] },
  cover: `/thumb/${i}/128.svg`, coverVariants: [{ src: `/thumb/${i}/128.svg`, width: 128 }, { src: `/thumb/${i}/640.svg`, width: 640 }],
}));
let server, browser, origin;
const delayedUpgrades = new Set();
let notifyHeldUpgrade, holdAllUpgrades = false;
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), pathname = url.pathname;
    const thumb = /^\/thumb\/(\d+)\/(128|640)\.svg$/.exec(pathname);
    if (thumb) {
      const [, id, size] = thumb;
      const send = () => {
        delayedUpgrades.delete(send);
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="rgb(${color(Number(id)).join(',')})"/></svg>`);
      };
      if (size === '640' && (holdAllUpgrades || url.searchParams.has('hold-upgrade'))) { delayedUpgrades.add(send); notifyHeldUpgrade?.(); }
      else send();
    } else if (pathname === '/api/clips') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ clips, facets: { source: { Collection: 200 }, tags: { Warm: 100, Cool: 100 },
        year: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(1980 + i), 5])) },
      corpus: { id: 'smooth-overview-fixture', revision: 'v1' }, ui: { defaultGroup: 'source', facetOrder: ['tags', 'year', 'source'] } }));
    } else if (pathname === '/api/view-state') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ version: 1, mode: 'mountain', groupKey: 'source', piles: [] }));
    } else if (pathname === '/' || /^\/wall\/[\w.-]+$/.test(pathname)) {
      try {
        const file = pathname === '/' ? 'index.html' : pathname.slice(1);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../${file}`, import.meta.url)));
      } catch { res.writeHead(404); res.end(); }
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function open({ reducedMotion = 'no-preference' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2, reducedMotion });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    window.overviewDraws = 0; window.overviewLastDraw = 0;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.classList.contains('overview-surface')) {
        window.overviewDraws++; window.overviewLastDraw = performance.now();
      }
      return draw.apply(this, args);
    };
  });
  await page.goto(origin);
  await page.waitForSelector('body[data-view-ready=true]');
  await page.waitForFunction(() => document.querySelectorAll('#canvas > .overview-painted').length === 200);
  await page.waitForFunction(() => [...document.querySelectorAll('#canvas > .tile img')].every(img => img.complete && img.naturalWidth > 0));
  await page.waitForFunction(() => performance.now() - window.overviewLastDraw > 120);
  return { page, errors };
}

async function agreement(page) {
  return page.evaluate(() => {
    const surface = document.querySelector('.overview-surface'), stage = document.querySelector('#stage').getBoundingClientRect();
    const context = surface.getContext('2d'), bitmap = surface.getBoundingClientRect(), failures = [], samples = [];
    for (const tile of document.querySelectorAll('#canvas > .overview-painted')) {
      const r = tile.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      // elementFromPoint rounds to whole CSS pixels at any DPR (Chromium 148):
      // a centre in the stage's last half pixel is tested at the stage's edge,
      // here also the viewport's, and returns null. Skip points it cannot address.
      if (x <= stage.left || Math.round(x) >= stage.right || y <= stage.top || Math.round(y) >= stage.bottom) continue;
      const id = Number(tile.getAttribute('aria-label').split(' ').at(-1));
      const actual = [...context.getImageData(Math.floor((x - bitmap.left) * surface.width / bitmap.width),
        Math.floor((y - bitmap.top) * surface.height / bitmap.height), 1, 1).data];
      const expected = [40 + id * 29 % 180, 40 + id * 47 % 180, 40 + id * 67 % 180, 255];
      const hitElement = document.elementFromPoint(x, y), hit = hitElement?.closest('.tile');
      // The existing sticky group control deliberately covers a few tiles
      // after zoom. Its own hit target is checked separately below.
      const groupControl = hitElement?.closest('#row-title');
      if (actual.some((n, i) => Math.abs(n - expected[i]) > 2) || (hit !== tile && !groupControl)) failures.push({ id, actual, expected, hit: hit?.getAttribute('aria-label'), element: hitElement?.outerHTML.slice(0, 250) });
      samples.push(id);
    }
    return { failures, samples, pixels: surface.width * surface.height, surfaces: document.querySelectorAll('.overview-surface').length,
      semanticCount: document.querySelectorAll('#canvas > .tile[role=button][tabindex="0"]').length };
  });
}

test('dense overview pixels share tile identity and hit geometry and stop drawing at rest', async () => {
  const { page, errors } = await open();
  try {
    const result = await agreement(page);
    assert.equal(result.surfaces, 1);
    assert.ok(result.pixels <= 4_194_304);
    assert.equal(result.semanticCount, 200);
    assert.equal(result.samples.length, 200);
    assert.deepEqual(result.failures, []);
    const draws = await page.evaluate(() => window.overviewDraws);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.overviewDraws), draws, 'settled overview draws no frames');
    await page.evaluate(() => { window.originalTile = document.querySelector('#canvas > .tile'); });
    await page.click('#zoom-in');
    await page.waitForFunction(() => performance.now() - window.overviewLastDraw > 150);
    assert.deepEqual((await agreement(page)).failures, []);
    assert.equal(await page.evaluate(() => window.originalTile === document.querySelector('#canvas > .tile')), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('hover and pinned attribute lenses restore DOM imagery and group headings stay reachable', async () => {
  const { page, errors } = await open();
  try {
    // Dense headings can be intentionally suppressed when their reserved band
    // cannot fit readable text. A zoom exposes the existing sticky group name.
    await page.click('#zoom-in');
    const heading = page.locator('#row-title .rt-focus');
    await heading.waitFor({ state: 'visible' });
    await page.waitForFunction(() => performance.now() - window.overviewLastDraw > 150);
    const headingReachable = await heading.evaluate(node => {
      const r = node.getBoundingClientRect();
      return document.elementFromPoint(r.x + Math.min(30, r.width / 2), r.y + r.height / 2)?.closest('button') === node;
    });
    assert.equal(headingReachable, true, 'the bitmap never intercepts a group control');
    await page.click('#zoom-fit');
    await page.waitForFunction(() => document.querySelectorAll('#canvas > .overview-painted').length === 200);
    await page.locator('.chip[data-facet=tags][data-value=Warm]').hover();
    await page.waitForFunction(() => document.querySelector('#canvas').dataset.brushKey === 'tags');
    await page.waitForFunction(() => document.querySelector('.overview-surface').hidden);
    assert.equal(await page.locator('.overview-painted').count(), 0);
    assert.equal(await page.locator('.tile.brush-miss img').first().evaluate(img => getComputedStyle(img).visibility), 'visible');
    await page.locator('#search').hover();
    await page.waitForFunction(() => document.querySelectorAll('#canvas > .overview-painted').length === 200);
    await page.selectOption('#attribute-lens', 'year');
    await page.waitForFunction(() => document.querySelector('.overview-surface').hidden);
    assert.equal(await page.locator('#canvas').getAttribute('data-brush-key'), 'year');
    await page.selectOption('#attribute-lens', 'none');
    await page.locator('#search').hover();
    await page.waitForFunction(() => document.querySelectorAll('#canvas > .overview-painted').length === 200);
    assert.deepEqual((await agreement(page)).failures, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('reduced motion crosses into readable DOM imagery without replacing semantic tiles', async () => {
  const { page, errors } = await open({ reducedMotion: 'reduce' });
  try {
    await page.evaluate(() => { window.originalTiles = [...document.querySelectorAll('#canvas > .tile')]; });
    for (let i = 0; i < 5; i++) await page.click('#zoom-in');
    await page.waitForFunction(() => document.querySelector('.overview-surface').hidden);
    const reading = await page.evaluate(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const visible = [...document.querySelectorAll('#canvas > .tile')].filter(tile => {
        const r = tile.getBoundingClientRect(); return r.right > stage.left && r.left < stage.right && r.bottom > stage.top && r.top < stage.bottom;
      });
      const probe = document.createElement('canvas'); probe.width = probe.height = 1;
      const context = probe.getContext('2d');
      const blank = visible.filter(tile => {
        const image = tile.querySelector('img');
        if (!image.naturalWidth || getComputedStyle(image).visibility !== 'visible') return true;
        // A srcset upgrade can make complete=false while the previous decoded
        // request is still visible. Verify its actual drawable pixels instead.
        const id = Number(tile.getAttribute('aria-label').split(' ').at(-1));
        const expected = [40 + id * 29 % 180, 40 + id * 47 % 180, 40 + id * 67 % 180, 255];
        try {
          context.clearRect(0, 0, 1, 1); context.drawImage(image, 0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].some((n, i) => Math.abs(n - expected[i]) > 2);
        } catch { return true; }
      }).length;
      return { same: window.originalTiles.every(node => node.isConnected), count: visible.length,
        blank,
        duration: getComputedStyle(document.querySelector('#canvas')).transitionDuration };
    });
    assert.equal(reading.same, true);
    assert.ok(reading.count > 0);
    assert.equal(reading.blank, 0);
    assert.equal(reading.duration, '0s');
    await page.click('#zoom-fit');
    await page.waitForFunction(() => document.querySelectorAll('#canvas > .overview-painted').length === 200);
    assert.deepEqual((await agreement(page)).failures, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a pending wall image upgrade preserves visible thumbnail pixels until atomic replacement', async () => {
  let page, heldTimeout;
  try {
    const opened = await open({ reducedMotion: 'reduce' }); page = opened.page;
    holdAllUpgrades = true;
    const requestHeld = new Promise((resolve, reject) => {
      notifyHeldUpgrade = resolve;
      heldTimeout = setTimeout(() => reject(new Error('No high-resolution upgrade requested')), 10000);
    });
    await page.evaluate(() => {
      window.originalUpgradeImages = new Map([...document.querySelectorAll('#canvas > .tile')].map(tile => [tile, tile.querySelector('img')]));
      window.initialUpgradeSources = new Map([...window.originalUpgradeImages].map(([tile, image]) => [tile, image.currentSrc]));
    });
    for (let i = 0; i < 5; i++) await page.click('#zoom-in');
    await requestHeld;
    clearTimeout(heldTimeout);
    assert.ok(delayedUpgrades.size > 0, 'larger image responses remain explicitly held');
    await page.waitForFunction(() => document.querySelector('.overview-surface').hidden);
    const pending = await page.evaluate(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const probe = document.createElement('canvas'); probe.width = probe.height = 1;
      const context = probe.getContext('2d'), failures = []; let count = 0;
      for (const [tile] of window.originalUpgradeImages) {
        const box = tile.getBoundingClientRect();
        if (box.right <= stage.left || box.left >= stage.right || box.bottom <= stage.top || box.top >= stage.bottom) continue;
        count++;
        const image = tile.querySelector('img'), id = Number(tile.getAttribute('aria-label').split(' ').at(-1));
        if (!image.complete || !image.naturalWidth || getComputedStyle(image).visibility !== 'visible') { failures.push(`missing image ${id}`); continue; }
        context.clearRect(0, 0, 1, 1); context.drawImage(image, 0, 0, 1, 1);
        const expected = [40 + id * 29 % 180, 40 + id * 47 % 180, 40 + id * 67 % 180, 255];
        const actual = [...context.getImageData(0, 0, 1, 1).data];
        if (actual.some((n, i) => Math.abs(n - expected[i]) > 2)) failures.push({ id, actual, expected });
      }
      return { failures, count };
    });
    assert.ok(pending.count > 0); assert.deepEqual(pending.failures, []);
    holdAllUpgrades = false;
    for (const release of [...delayedUpgrades]) release();
    await page.waitForFunction(() => [...window.originalUpgradeImages].some(([tile, original]) => {
      const current = tile.querySelector('img'); return current !== original && current.complete && current.naturalWidth > 0 &&
        current.currentSrc.includes('/640.svg') && !window.initialUpgradeSources.get(tile).includes('/640.svg');
    }));
    assert.equal(await page.evaluate(() => [...window.originalUpgradeImages.keys()].every(tile => tile.isConnected)), true, 'semantic tile identity survives the image swap');
    assert.deepEqual(opened.errors, []);
  } finally {
    clearTimeout(heldTimeout); holdAllUpgrades = false; notifyHeldUpgrade = null;
    for (const release of [...delayedUpgrades]) release();
    await page?.close();
  }
});

test('a held reading-resolution candidate cannot replace an image after returning to Fit scale', async () => {
  let page, heldTimeout;
  try {
    const opened = await open({ reducedMotion: 'reduce' }); page = opened.page;
    holdAllUpgrades = true;
    const requestHeld = new Promise((resolve, reject) => {
      notifyHeldUpgrade = resolve;
      heldTimeout = setTimeout(() => reject(new Error('No reading-resolution candidate requested')), 10000);
    });
    await page.evaluate(() => {
      window.fitImageBaseline = new Map([...document.querySelectorAll('#canvas > .tile')].map(tile =>
        [tile.getAttribute('aria-label').split(' ').at(-1), { tile, image: tile.querySelector('img'), sizes: tile.querySelector('img').sizes }]));
      window.fitScale = new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform).a;
      window.upgradeDecodeProbe = { started: 0, finished: 0, pending: 0, candidates: new Map() };
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (...args) {
        const tracked = !this.isConnected && parseFloat(this.sizes) > 64 && this.srcset.includes('/640.svg');
        if (!tracked) return decode.apply(this, args);
        const probe = window.upgradeDecodeProbe;
        probe.started++; probe.pending++;
        probe.candidates.set(this, new URL(this.src).pathname.split('/')[2]);
        return decode.apply(this, args).finally(() => { probe.finished++; probe.pending--; probe.candidates.delete(this); });
      };
      // One input frame jumps directly to reading scale, leaving the Fit image
      // in place while its larger candidate is decoded off-DOM.
      for (let i = 0; i < 5; i++) document.querySelector('#zoom-in').click();
    });
    await requestHeld; clearTimeout(heldTimeout);
    await page.evaluate(() => { for (let i = 0; i < 5; i++) document.querySelector('#zoom-out').click(); });
    await page.waitForFunction(() => document.querySelectorAll('#canvas > .overview-painted').length === 200);
    const returned = await page.evaluate(() => {
      const scale = new DOMMatrix(getComputedStyle(document.querySelector('#canvas')).transform).a;
      // Some cached candidates legitimately finish at reading scale before the
      // held request starts. Only still-pending work on an already-correct Fit
      // image exercises the obsolete-candidate guard.
      window.pendingFitImages = [...window.upgradeDecodeProbe.candidates.values()].flatMap(id => {
        const baseline = window.fitImageBaseline.get(id), image = baseline.tile.querySelector('img');
        return image.sizes === baseline.sizes ? [{ id, tile: baseline.tile, image, sizes: image.sizes }] : [];
      });
      return { pending: window.upgradeDecodeProbe.pending, count: window.pendingFitImages.length, scale, fitScale: window.fitScale };
    });
    const pendingCount = returned.pending;
    assert.ok(Math.abs(returned.scale - returned.fitScale) < 0.000001, 'reciprocal zoom returns to the same Fit scale');
    assert.ok(returned.count > 0, 'a still-pending candidate targets an already-correct Fit image');
    assert.ok(pendingCount > 0, 'the stale candidate is still decoding after the camera has returned');
    holdAllUpgrades = false;
    for (const release of [...delayedUpgrades]) release();
    await page.waitForFunction(count => window.upgradeDecodeProbe.finished >= count && window.upgradeDecodeProbe.pending === 0, pendingCount);
    const obsolete = await page.evaluate(() => window.pendingFitImages.flatMap(baseline => {
      const { id } = baseline, current = baseline.tile.querySelector('img');
      return current !== baseline.image || current.sizes !== baseline.sizes
        ? [{ id, before: baseline.sizes, after: current.sizes, changed: current !== baseline.image }] : [];
    }));
    assert.deepEqual(obsolete, [], 'completed high-resolution work cannot overwrite the already-correct Fit image');
    assert.deepEqual(opened.errors, []);
  } finally {
    clearTimeout(heldTimeout); holdAllUpgrades = false; notifyHeldUpgrade = null;
    for (const release of [...delayedUpgrades]) release();
    await page?.close();
  }
});

test('covered camera motion transforms a complete picture without repainting and keeps pixels under their hit targets', async () => {
  const { page, errors } = await open();
  try {
    const result = await page.evaluate(async () => {
      const startDraws = window.overviewDraws, canvas = document.querySelector('.overview-surface');
      const context = canvas.getContext('2d'), frames = [], failures = [];
      const started = performance.now();
      document.querySelector('#zoom-in').click();
      await new Promise(resolve => {
        const sample = () => {
          if (!canvas.hidden && canvas.style.transform && canvas.style.transform !== 'none') {
            const rect = canvas.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
            // Any painted tile must still sample its own pixels. Unoccupied
            // viewport edges can be blank; exposed imagery uses decoded DOM.
            let checked = 0;
            for (const tile of document.querySelectorAll('#canvas > .overview-painted')) {
              const box = tile.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
              // Rounded like elementFromPoint (see agreement).
              if (x <= stage.left || Math.round(x) >= stage.right || y <= stage.top + 70 || Math.round(y) >= stage.bottom) continue;
              const id = Number(tile.getAttribute('aria-label').split(' ').at(-1));
              const expected = [40 + id * 29 % 180, 40 + id * 47 % 180, 40 + id * 67 % 180, 255];
              const actual = [...context.getImageData(Math.floor((x - rect.left) * canvas.width / rect.width), Math.floor((y - rect.top) * canvas.height / rect.height), 1, 1).data];
              if (actual.some((n, i) => Math.abs(n - expected[i]) > 2) || document.elementFromPoint(x, y)?.closest('.tile') !== tile) failures.push({ id, actual, expected });
              if (++checked === 5) break;
            }
            frames.push({ draws: window.overviewDraws, checked });
          }
          if (performance.now() - started > 500) resolve(); else requestAnimationFrame(() => setTimeout(sample, 0));
        };
        requestAnimationFrame(() => setTimeout(sample, 0));
      });
      return { startDraws, frames, failures, finalDraws: window.overviewDraws, transform: canvas.style.transform };
    });
    assert.ok(result.frames.length >= 2, JSON.stringify(result));
    // A first-frame raster can be necessary when the browser's rounded visible
    // pose exposes an edge of the old picture. Covered frames then stay free
    // of image draws until their final refresh.
    assert.ok(result.frames[0].draws - result.startDraws <= 200, JSON.stringify(result));
    assert.ok(result.frames.every(f => f.checked > 0 && f.draws === result.frames[0].draws), JSON.stringify(result));
    assert.deepEqual(result.failures, []);
    assert.ok(result.finalDraws > result.frames.at(-1).draws, 'settle refreshes the final resolution');
    assert.equal(result.transform, 'none');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('zoom-out exposes decoded DOM at cached-picture edges without repainting every frame', async () => {
  const { page, errors } = await open();
  try {
    const beforeZoom = await page.evaluate(() => window.overviewDraws);
    await page.click('#zoom-in');
    await page.waitForFunction(before => window.overviewDraws > before && document.querySelector('.overview-surface').style.transform === 'none' && performance.now() - window.overviewLastDraw > 120, beforeZoom);
    const result = await page.evaluate(async () => {
      const canvas = document.querySelector('.overview-surface'), context = canvas.getContext('2d');
      const frames = [], failures = [], started = performance.now();
      document.querySelector('#zoom-out').click();
      await new Promise(resolve => {
        const sample = () => {
          if (!canvas.hidden && canvas.style.transform && canvas.style.transform !== 'none') {
            const bitmap = canvas.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
            let fallback = 0, painted = 0;
            for (const tile of document.querySelectorAll('#canvas > .tile')) {
              const box = tile.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
              // Rounded like elementFromPoint (see agreement). During a zoom-out,
              // columns of tile centres move in across the right edge; in some
              // sampled frames one sits in the last half pixel, and its hit is null.
              if (x <= stage.left || Math.round(x) >= stage.right || y <= stage.top + 70 || Math.round(y) >= stage.bottom) continue;
              const id = Number(tile.getAttribute('aria-label').split(' ').at(-1));
              if (tile.classList.contains('overview-painted')) {
                painted++;
                const expected = [40 + id * 29 % 180, 40 + id * 47 % 180, 40 + id * 67 % 180, 255];
                const actual = [...context.getImageData(Math.floor((x - bitmap.left) * canvas.width / bitmap.width), Math.floor((y - bitmap.top) * canvas.height / bitmap.height), 1, 1).data];
                if (actual.some((n, i) => Math.abs(n - expected[i]) > 2)) failures.push({ id, actual, expected });
                // A tile hidden behind the picture must lie wholly inside it. One
                // that straddles the shrinking picture's edge has a correct centre
                // pixel and a blank outer part, which a centre-only probe never
                // samples. Over 30 runs the worst painted tile sat 0.007 px inside;
                // with the un-paint step removed, stale tiles stuck out 12 px.
                const outside = Math.max(bitmap.left - Math.max(box.left, stage.left), Math.min(box.right, stage.right) - bitmap.right,
                  bitmap.top - Math.max(box.top, stage.top), Math.min(box.bottom, stage.bottom) - bitmap.bottom);
                if (outside > 0.5) failures.push({ straddles: id, outside });
              } else {
                fallback++;
                const image = tile.querySelector('img');
                if (!image.complete || !image.naturalWidth || getComputedStyle(image).visibility !== 'visible' || !image.currentSrc.includes(`/thumb/${id}/`)) failures.push(`blank or wrong fallback ${id}`);
              }
              const hit = document.elementFromPoint(x, y);
              if (hit?.closest('.tile') !== tile) failures.push({ wrongHit: id, x, y, hit: hit?.outerHTML.slice(0, 200), visibility: getComputedStyle(tile).visibility, stageRight: stage.right });
            }
            frames.push({ draws: window.overviewDraws, fallback, painted });
          }
          if (performance.now() - started > 500) resolve(); else requestAnimationFrame(() => setTimeout(sample, 0));
        };
        requestAnimationFrame(() => setTimeout(sample, 0));
      });
      return { frames, failures, finalDraws: window.overviewDraws, transform: canvas.style.transform };
    });
    assert.ok(result.frames.length >= 2, JSON.stringify(result));
    assert.ok(result.frames.some(f => f.fallback > 0 && f.painted > 0), `the proof exercises both cached pixels and newly exposed DOM imagery: ${JSON.stringify(result)}`);
    assert.ok(result.frames.every(f => f.draws === result.frames[0].draws), JSON.stringify(result));
    assert.deepEqual(result.failures, []);
    assert.ok(result.finalDraws > result.frames.at(-1).draws);
    assert.equal(result.transform, 'none');
    assert.deepEqual((await agreement(page)).failures, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('zoom-out reentry after reading scale immediately reuses its retained bitmap', async () => {
  const { page, errors } = await open();
  try {
    for (let i = 0; i < 7; i++) await page.click('#zoom-in');
    await page.waitForFunction(() => document.querySelector('.overview-surface').hidden);
    await page.waitForFunction(() => [...document.querySelectorAll('#canvas > .tile img')].every(img => img.complete && img.naturalWidth > 0));
    assert.equal(await page.locator('.overview-painted').count(), 0);
    const result = await page.evaluate(async () => {
      const canvas = document.querySelector('.overview-surface'), context = canvas.getContext('2d');
      const before = window.overviewDraws, frames = [], failures = [], started = performance.now();
      const clicking = (async () => {
        for (let i = 0; i < 7; i++) { document.querySelector('#zoom-out').click(); await new Promise(resolve => setTimeout(resolve, 35)); }
      })();
      await new Promise(resolve => {
        const sample = () => {
          if (!canvas.hidden && canvas.style.transform && canvas.style.transform !== 'none') {
            const bitmap = canvas.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
            let checked = 0;
            for (const tile of document.querySelectorAll('#canvas > .overview-painted')) {
              const box = tile.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
              // Rounded like elementFromPoint (see agreement).
              if (x <= stage.left || Math.round(x) >= stage.right || y <= stage.top + 70 || Math.round(y) >= stage.bottom) continue;
              const id = Number(tile.getAttribute('aria-label').split(' ').at(-1));
              const expected = [40 + id * 29 % 180, 40 + id * 47 % 180, 40 + id * 67 % 180, 255];
              const actual = [...context.getImageData(Math.floor((x - bitmap.left) * canvas.width / bitmap.width), Math.floor((y - bitmap.top) * canvas.height / bitmap.height), 1, 1).data];
              if (actual.some((n, i) => Math.abs(n - expected[i]) > 2) || document.elementFromPoint(x, y)?.closest('.tile') !== tile) failures.push({ id, actual, expected });
              if (++checked === 5) break;
            }
            frames.push({ draws: window.overviewDraws, checked });
          }
          // A retarget cancels/reschedules the host's rAF. Sample after that
          // frame's callbacks, not before its authoritative pose was applied.
          if (performance.now() - started > 850) resolve(); else requestAnimationFrame(() => setTimeout(sample, 0));
        };
        requestAnimationFrame(() => setTimeout(sample, 0));
      });
      await clicking;
      return { before, frames, failures };
    });
    assert.ok(result.frames.length >= 2, JSON.stringify(result));
    assert.equal(result.frames[0].draws, result.before, 'the first return frame uses existing pixels rather than rebuilding the corpus');
    assert.ok(result.frames.every(f => f.checked > 0), JSON.stringify(result));
    assert.deepEqual(result.failures, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('decoded DOM carries motion when no reusable bitmap exists, then hands off at settle', async () => {
  const { page, errors } = await open();
  try {
    const result = await page.evaluate(async () => {
      const { OverviewSurface } = await import('/wall/overview-surface.mjs');
      const stage = document.createElement('div');
      stage.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:400px;overflow:hidden;z-index:2147480000;background:#050510';
      const world = document.createElement('div'); world.className = 'canvas'; stage.append(world); document.body.append(stage);
      const tiles = [];
      for (let i = 0; i < 12; i++) {
        const node = document.createElement('div'); node.className = 'tile'; node.setAttribute('role', 'button'); node.tabIndex = 0;
        const x = i % 5 * 90, y = Math.floor(i / 5) * 90;
        node.style.cssText = `width:80px;height:80px;transform:translate(${x}px,${y}px)`;
        const image = document.createElement('img'); image.src = `/thumb/${i}/128.svg`; node.append(image); world.append(node); await image.decode();
        tiles.push({ key: String(i), x, y, w: 80, h: 80, node, clip: { cover: image.src } });
      }
      const surface = new OverviewSurface(stage), failures = [];
      try {
        surface.setTiles(tiles);
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const pose = { x: 10 + i, y: 10, scale: 0.8 };
          world.style.transform = `translate(${pose.x}px,${pose.y}px) scale(${pose.scale})`;
          surface.setViewport(pose, { width: 500, height: 400, moving: true, dpr: 2 });
          if (!surface.canvas.hidden || surface.stats.draws || !surface.stats.domFallback) failures.push('motion attempted bitmap work');
          for (const tile of tiles) {
            const box = tile.node.getBoundingClientRect(), image = tile.node.querySelector('img');
            if (!image.complete || !image.naturalWidth || getComputedStyle(image).visibility !== 'visible' ||
              document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.tile') !== tile.node) failures.push(`missing image or hit ${tile.key}`);
          }
        }
        surface.setViewport({ x: 29, y: 10, scale: 0.8 }, { width: 500, height: 400, moving: false, dpr: 2 });
        for (let i = 0; i < 5 && surface.stats.painted !== tiles.length; i++) await new Promise(resolve => requestAnimationFrame(resolve));
        return { failures, stats: surface.stats, hidden: surface.canvas.hidden };
      } finally { surface.dispose(); stage.remove(); }
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.stats.draws, 12);
    assert.equal(result.stats.painted, 12);
    assert.equal(result.stats.domFallback, false);
    assert.equal(result.hidden, false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
