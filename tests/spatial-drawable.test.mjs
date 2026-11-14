// Acceptance for the drawable-card tile path (docs/HTML_IN_CANVAS_EXPERIMENT.md
// Phase 2). Chrome-only and flag-only, so this file SKIPS unless a Chrome with
// the CanvasDrawElement feature is available:
//
//   node --test tests/spatial-drawable.test.mjs
//   CHROME_CANARY=/path/to/binary node --test tests/spatial-drawable.test.mjs
//
// A skip here is not a pass. tests/spatial-view.test.mjs covers the flag-off
// path in ordinary Chromium and must keep passing unchanged — that is A1.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { chromium } from 'playwright';
import { crc32, deflateSync } from 'node:zlib';

/** A flat-colour PNG, for a sprite-sheet page the fixture server can hold back. */
function png(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head.set([8, 2, 0, 0, 0], 8);   // 8-bit RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

const root = new URL('../', import.meta.url);
const colors = { alpha: '#ed2525', beta: '#20e040', gamma: '#2449ef', delta: '#ecd322' };
const CANARY = process.env.CHROME_CANARY
  || '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';

let server, browser, origin, available = false;

before(async () => {
  try { await access(CANARY); available = true; } catch { available = false; }

  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://fixture.test').pathname;
    const image = path.match(/^\/fixtures\/(alpha|beta|gamma|delta)\.svg$/);
    if (image) {
      const held = Number(new URL(req.url, 'http://fixture.test').searchParams.get('delay')) || 0;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${colors[image[1]]}"/></svg>`);
      }, held);
      return;
    }
    if (path === '/fixtures/pulse.svg') {
      // A cover that animates by itself, as a GIF or an animated PNG does: its
      // card repaints on every frame with nobody asking. Optionally held back.
      const delay = Number(new URL(req.url, 'http://fixture.test').searchParams.get('delay')) || 0;
      const body = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#20e040">'
        + '<animate attributeName="fill" values="#20e040;#ecd322;#20e040" dur="0.4s" repeatCount="indefinite"/></rect></svg>';
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(body); }, delay);
      return;
    }
    if (path === '/fixtures/foreign.svg') {
      // Same-origin, and still not origin-clean: Chrome and Safari taint a
      // canvas for any SVG image that holds a foreignObject. Mermaid and
      // draw.io exports do.
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#20e040"/>'
        + '<foreignObject x="20" y="20" width="200" height="60"><div xmlns="http://www.w3.org/1999/xhtml">label</div></foreignObject></svg>');
      return;
    }
    const sheet = path.match(/^\/fixtures\/sheet-(a|b)\.png$/);
    if (sheet) {
      const delay = Number(new URL(req.url, 'http://fixture.test').searchParams.get('delay')) || 0;
      const body = sheet[1] === 'a' ? png(256, 192, [237, 37, 37]) : png(512, 192, [32, 224, 64]);
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(body); }, delay);
      return;
    }
    if (!/^\/(wall\/|tests\/fixtures\/)/.test(path)) { res.writeHead(404); res.end(); return; }
    try {
      const body = await readFile(new URL(`.${path}`, root));
      const type = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript';
      res.writeHead(200, { 'Content-Type': type }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;

  if (available) {
    browser = await chromium.launch({
      executablePath: CANARY,
      headless: true,
      args: ['--enable-blink-features=CanvasDrawElement'],
    });
  }
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function fixture(t, query = 'initial=full', { waitUntil = 'load' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no page errors'); });
  // 'load' waits for every image in the page, a held-back cover included.
  await page.goto(`${origin}/tests/fixtures/spatial-view.html?${query}`, { waitUntil });
  await page.waitForFunction(() => window.fixtureReady);
  const supported = await page.evaluate(() =>
    typeof CanvasRenderingContext2D.prototype.drawElementImage === 'function');
  assert.ok(supported, 'the flag did not take: drawElementImage is missing in this build');
  return page;
}

/**
 * Read the bottom third of a rendered near-tier tile out of the atlas bitmap.
 *
 * The discriminator is deliberately not "are there pixels" — a thumbnail has
 * pixels too. The fixture's hero is ONE flat colour, so a tile sourced from an
 * image has no light-on-dark pair anywhere. A tile sourced from a card has the
 * #0d1017 body and the #e8e6da title on top of it. Ink against its own ground
 * is the thing being asserted.
 */
async function titleBand(page, index) {
  return page.evaluate((i) => {
    const pair = view.field.atlases;
    const slot = pair.nearSlot[i];
    if (slot < 0) return { slot: -1 };
    const atlas = pair.near;
    const { x, y, w, h } = atlas.slotRect(slot);
    const fitW = atlas.fits[slot * 2] * w;
    const fitH = atlas.fits[slot * 2 + 1] * h;
    const bx = Math.round(x + (w - fitW) / 2);
    const by = Math.round(y + (h - fitH) / 2 + fitH * 0.62);
    const bh = Math.max(1, Math.round(fitH * 0.36));
    const d = atlas.ctx.getImageData(bx, by, Math.round(fitW), bh).data;
    let dark = 0; let light = 0; let opaque = 0;
    for (let k = 0; k < d.length; k += 4) {
      if (d[k + 3] === 0) continue;
      opaque++;
      const lum = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
      if (lum < 40) dark++;
      else if (lum > 170) light++;
    }
    return { slot, opaque, dark, light, blankPath: pair.sourcePathBlank };
  }, index);
}

const gate = (t) => {
  if (!available) { t.skip(`no Chrome Canary at ${CANARY}`); return true; }
  return false;
};

test('A3 — one drawable card per clip, and the DOM overlay pool is untouched', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  const counts = await page.evaluate(() => ({
    clips: view.clips.length,
    drawables: document.querySelectorAll('[drawable]').length,
    dcards: document.querySelectorAll('.sp-dcard').length,
    hosts: document.querySelectorAll('canvas.card-host').length,
    pool: view.hybrid.pool.length,
    overlayCards: document.querySelectorAll('.sp-card').length,
  }));
  assert.equal(counts.drawables, counts.clips, 'one drawable per clip');
  assert.equal(counts.dcards, counts.clips);
  assert.equal(counts.hosts, 1, 'exactly one host canvas — it is also the near atlas');
  assert.equal(counts.pool, 14, 'the 14-card DOM pool is unchanged');
  assert.ok(counts.overlayCards <= 14, 'drawable cards must not be counted as overlay cards');
});

test('A3b — the card host is a card-sized staging canvas, separate from both atlases', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  const shape = await page.evaluate(() => ({
    hostBitmap: [view.cardHost.canvas.width, view.cardHost.canvas.height],
    nearIsHost: view.field.atlases.near.canvas === view.cardHost.canvas,
    farIsHost: view.field.atlases.far.canvas === view.cardHost.canvas,
  }));
  // drawElementImage paints across the whole canvas whatever the CTM says, so
  // the host bitmap must be exactly one card and the atlas must stay separate.
  assert.deepEqual(shape.hostBitmap, [340, 255], 'the host bitmap is one card');
  assert.equal(shape.nearIsHost, false, 'the atlas is a plain canvas, blitted into');
  assert.equal(shape.farIsHost, false);
});

test('A2 — a near tile carries its title band as ink on the card ground', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  // Ask for the near tile directly: promotion by camera distance is
  // spatial-view.test.mjs's subject, and this test is about where the pixels
  // in a near tile come from.
  await page.evaluate(() => view.field.atlases.request(1, 'near'));
  await page.waitForFunction(() => view.field.atlases.nearSlot[1] >= 0, null, { timeout: 5000 });
  await page.waitForTimeout(600);
  const band = await titleBand(page, 1);

  assert.equal(band.blankPath, false, 'the element path did not fall back to images');
  assert.ok(band.opaque > 0, 'the tile has pixels at all');
  assert.ok(band.dark > 20, `the card ground is present (dark px ${band.dark})`);
  assert.ok(band.light > 20, `the title ink is present (light px ${band.light})`);
});

test('A2b — with the flag off the same region is flat, so A2 is testing the card', async (t) => {
  if (gate(t)) return;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  await page.addInitScript(() => { window.__cwDrawable = false; });
  await page.goto(`${origin}/tests/fixtures/spatial-view.html?initial=full`);
  await page.waitForFunction(() => window.fixtureReady);
  const off = await page.evaluate(() => ({
    host: !!view.cardHost,
    drawables: document.querySelectorAll('[drawable]').length,
  }));
  assert.equal(off.host, false, 'the flag gates the whole feature');
  assert.equal(off.drawables, 0);

  await page.evaluate(() => view.field.atlases.request(1, 'near'));
  await page.waitForFunction(() => view.field.atlases.nearSlot[1] >= 0, null, { timeout: 5000 });
  await page.waitForTimeout(600);
  const band = await titleBand(page, 1);
  assert.ok(band.light < 20 || band.dark < 20,
    `a flat hero cannot show ink on a ground (dark ${band.dark}, light ${band.light}) — if this fails, A2 proves nothing`);
});

test('A4/A5 — a find match set moves the camera and leaves scope alone', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 8000 });

  const before = await page.evaluate(() => ({
    lastFind: view._lastFind,
    basePos: view.basePos.toArray(),
    clips: view.clips.length,
    titles: view.clips.map((c) => c.title),
    url: location.href,
  }));

  // Playwright cannot open Chrome's find bar, so replay what the real bar
  // emits: a `paint` whose changedElements is exactly the matching cards.
  // Measured on a 60-card page — "meridian" produced [0,12,24,36,48] and
  // narrowed from [0,2,4,5,6,8,…] as the query was typed. The find bar leaves
  // NO DOM selection, which is why the match set is the only signal.
  const fired = await page.evaluate(() => {
    const host = document.querySelector('canvas.card-host');
    const cards = [...host.querySelectorAll('[drawable]')];
    const ev = new Event('paint');
    Object.defineProperty(ev, 'changedElements', { value: [cards[2]] });
    host.dispatchEvent(ev);
    return { selectionWasEmpty: String(window.getSelection() ?? '') === '' };
  });
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => ({
    lastFind: view._lastFind,
    lastFindKey: view._lastFindKey,
    basePos: view.basePos.toArray(),
    clips: view.clips.length,
    titles: view.clips.map((c) => c.title),
    url: location.href,
    selection: view.nav?.selection,
  }));

  assert.ok(fired.selectionWasEmpty, 'no selection was involved — the match set is the signal');
  assert.equal(after.lastFind, 2, 'the match set identified Gamma, index 2');
  assert.equal(after.lastFindKey, '2');
  assert.equal(after.selection, 2, 'and selection followed');
  assert.notDeepEqual(after.basePos, before.basePos, 'the camera moved');

  // A5: find is navigation, never scope.
  assert.equal(after.clips, before.clips, 'membership is unchanged');
  assert.deepEqual(after.titles, before.titles);
  assert.equal(after.url, before.url, 'the URL is unchanged');
});

test('A4b — a whole-corpus repaint is ignored, so opening the bar moves nothing', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 8000 });
  const before = await page.evaluate(() => view.basePos.toArray());

  const seen = await page.evaluate(() => {
    const host = document.querySelector('canvas.card-host');
    const cards = [...host.querySelectorAll('[drawable]')];
    const ev = new Event('paint');
    Object.defineProperty(ev, 'changedElements', { value: cards });  // all of them
    host.dispatchEvent(ev);
    return cards.length;
  });
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => ({ basePos: view.basePos.toArray(), lastFind: view._lastFind }));
  assert.equal(seen, 3, 'the fixture has three cards');
  assert.equal(after.lastFind, -1, 'an everything-changed paint carries no information');
  assert.deepEqual(after.basePos, before, 'and the camera stayed put');
});

test('A6 — a filter change retires the whole card host, leaving no stale index', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  const first = await page.evaluate(() => {
    window.__hostBefore = view.cardHost.canvas;
    return document.querySelectorAll('[drawable]').length;
  });
  assert.equal(first, 3);

  await page.click('#narrow');            // Gamma only
  await page.waitForTimeout(400);

  const next = await page.evaluate(() => ({
    drawables: document.querySelectorAll('[drawable]').length,
    hosts: document.querySelectorAll('canvas.card-host').length,
    sameCanvas: view.cardHost.canvas === window.__hostBefore,
    oldStillInDom: window.__hostBefore.isConnected,
    title: view.cardHost.elementFor(0)?.querySelector('.sp-t')?.textContent,
    lastFind: view._lastFind,
  }));
  assert.equal(next.drawables, 1, 'one clip, one card');
  assert.equal(next.hosts, 1, 'the old host is gone, not orphaned alongside the new one');
  assert.equal(next.sameCanvas, false, 'a new snapshot gets a new host');
  assert.equal(next.oldStillInDom, false, 'and the old canvas left the DOM');
  assert.equal(next.title, 'Gamma', 'index 0 now means Gamma, not Alpha');
  assert.equal(next.lastFind, -1, 'the find cursor resets with the snapshot');
});

test('A7 — the resource cost of one card per clip is recorded', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  const cost = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    drawables: document.querySelectorAll('[drawable]').length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  }));
  // Not a threshold: three clips is not a budget test. It records the shape so
  // a regression at corpus scale has something to be compared against, and the
  // real figures live in the probe's RESULTS.md (2,500 cards, +10,001 nodes).
  assert.ok(cost.drawables === 3 && cost.domNodes > 0);
  console.log('[A7] drawable cards %d, DOM nodes %d, JS heap %s MB',
    cost.drawables, cost.domNodes, cost.heapMB ?? 'n/a');
});

test('A8 — covers that land after the cards are built are not read as a find', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t, 'initial=full&covers=sheets');
  // Record every paint set from before the first page arrives (900 ms).
  const before = await page.evaluate(() => {
    window.paintSets = [];
    view.cardHost.onPaint((indices) => window.paintSets.push(indices.slice()));
    return { basePos: view.basePos.toArray(), covered: document.querySelectorAll('.sp-dcard img[src]').length };
  });
  assert.equal(before.covered, 0, 'no card has its cover yet: the pages are still held');

  // Nobody touches the page while both pages arrive, at 900 and 1800 ms.
  await page.waitForFunction(() => document.querySelectorAll('.sp-dcard img[src^="blob:"]').length === 3, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    paintSets: window.paintSets, clips: view.clips.length,
    lastFind: view._lastFind, lastFindKey: view._lastFindKey,
    selection: view.nav?.selection, basePos: view.basePos.toArray(),
  }));

  // The control that gives the rest its meaning: the covers did repaint some
  // cards and not all of them, which is the shape a find match has.
  assert.ok(after.paintSets.some((set) => set.length > 0 && set.length < after.clips),
    `a cover arrival repainted a partial set of cards; saw ${JSON.stringify(after.paintSets)}`);
  assert.equal(after.lastFind, -1, 'no find was recorded');
  assert.equal(after.lastFindKey, '');
  assert.equal(after.selection, -1, 'nothing was selected');
  assert.deepEqual(after.basePos, before.basePos, 'the camera did not move');

  // And find still works once the cards have settled.
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 8000 });
  await page.evaluate(() => {
    const host = document.querySelector('canvas.card-host');
    const ev = new Event('paint');
    Object.defineProperty(ev, 'changedElements', { value: [host.querySelectorAll('[drawable]')[1]] });
    host.dispatchEvent(ev);
  });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => view._lastFind), 1, 'a find after settling selects its match');
});

// What a find match looks like to the page: a paint naming exactly those cards.
const paintOf = (page, cards) => page.evaluate((which) => {
  const host = document.querySelector('canvas.card-host');
  const all = [...host.querySelectorAll('[drawable]')];
  const ev = new Event('paint');
  Object.defineProperty(ev, 'changedElements', { value: which.map((i) => all[i]) });
  host.dispatchEvent(ev);
}, cards);
const pose = (page) => page.evaluate(() => ({
  armed: view._findArmed, lastFind: view._lastFind, selection: view.nav?.selection,
  basePos: view.basePos.toArray().map(Math.round).join(' '), restless: [...view._restless],
}));

test('A9 — a card that keeps repainting by itself is set aside: find arms without it and it never answers', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  // A repaint nobody asked for: restyle one card every 150 ms, from the moment
  // the fixture is up. The browser reports each one as a paint naming that
  // card alone, which is exactly what a one-card find match looks like, and
  // what every frame of an animated cover looks like.
  await page.evaluate(() => {
    window.paintSets = [];
    view.cardHost.onPaint((indices) => window.paintSets.push(indices.slice()));
    const card = document.querySelectorAll('.sp-dcard')[1];
    let on = false;
    window.restyle = setInterval(() => { on = !on; card.style.outline = on ? '2px solid #ffd166' : ''; }, 150);
  });
  t.after(() => page.evaluate(() => clearInterval(window.restyle)).catch(() => {}));
  // It used to hold find off for as long as it went on. Now find arms around it.
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 6000 });
  const armed = await pose(page);
  assert.deepEqual(armed.restless, [1], 'the repainting card is marked restless, and only that one');
  assert.equal(armed.lastFind, -1, 'no repaint was recorded as a find on the way');

  // Armed, and the card is still repainting: two more seconds of it move nothing.
  await page.evaluate(() => { window.paintSets.length = 0; });
  await page.waitForTimeout(2000);
  const during = await pose(page);
  const alone = await page.evaluate(() => window.paintSets.filter((set) => set.length === 1 && set[0] === 1).length);
  assert.ok(alone >= 5, `card 1 went on repainting by itself; saw ${alone} such paints`);
  assert.equal(during.lastFind, -1, 'none of them was read as a find');
  assert.equal(during.selection, -1);
  assert.equal(during.basePos, armed.basePos, 'and the camera did not move');

  // The other cards still answer, and a match set that includes the restless card fits the rest.
  await paintOf(page, [1, 2]);
  await page.waitForTimeout(300);
  const found = await pose(page);
  assert.equal(found.lastFind, 2, 'a match on another card is found');
  assert.equal(found.selection, 2);
  assert.notEqual(found.basePos, armed.basePos, 'and the camera goes to it');
});

test('A13 — an animated cover that arrives after find is armed moves nothing', async (t) => {
  if (gate(t)) return;
  // Beta's cover is held back 6.5 s, past the 4 s the card host waits for
  // images, so find is armed by the time it lands. Then it animates: every
  // frame repaints the card. A late cover is on trial from the moment it
  // loads; one that keeps repainting never answers.
  const page = await fixture(t, 'initial=full&pulse=6500', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.paintSets = [];
    view.cardHost.onPaint((indices) => window.paintSets.push(indices.slice()));
  });
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 6000 });
  const armed = await pose(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sp-dcard img')[1].complete), false, 'armed before the late cover is in');

  await page.waitForFunction(() => { const img = document.querySelectorAll('.sp-dcard img')[1]; return img.complete && img.naturalWidth > 0; }, null, { timeout: 9000 });
  await page.evaluate(() => { window.paintSets.length = 0; });
  await page.waitForTimeout(3000);
  const after = await pose(page);
  const alone = await page.evaluate(() => window.paintSets.filter((set) => set.includes(1)).length);
  assert.ok(alone >= 5, `the cover animates: its card repainted ${alone} times in 3 s`);
  assert.equal(after.lastFind, -1, 'no frame of it was read as a find');
  assert.equal(after.selection, -1);
  assert.equal(after.basePos, armed.basePos, 'the camera did not move');
  assert.deepEqual(after.restless, [1], 'and the card ends up restless');

  await paintOf(page, [0]);
  await page.waitForTimeout(300);
  assert.equal((await pose(page)).lastFind, 0, 'a real match elsewhere is still found');
});

test('A15 — a still cover that arrives late is not a find, and its card answers again afterwards', async (t) => {
  if (gate(t)) return;
  // Beta's cover is held back 6.5 s, so find is armed first. A card paints as
  // its cover arrives and again when it lands; neither is a match.
  const page = await fixture(t, 'initial=full&late=6500', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 6000 });
  const armed = await pose(page);
  const loaded = () => page.evaluate(() => { const img = document.querySelectorAll('.sp-dcard img')[1]; return img.complete && img.naturalWidth > 0; });
  assert.equal(await loaded(), false, 'armed before the late cover is in');

  // Still loading: a paint of that card is the image arriving, not a match.
  await paintOf(page, [1]);
  await page.waitForTimeout(200);
  assert.equal((await pose(page)).lastFind, -1, 'a card whose cover is still loading does not answer');

  await page.waitForFunction(() => { const img = document.querySelectorAll('.sp-dcard img')[1]; return img.complete && img.naturalWidth > 0; }, null, { timeout: 9000 });
  await page.waitForTimeout(600);
  const landed = await pose(page);
  assert.equal(landed.lastFind, -1, 'the cover landing was not read as a find');
  assert.equal(landed.basePos, armed.basePos, 'and the camera did not move');
  assert.deepEqual(landed.restless, [], 'a still cover leaves its card in good standing');

  // Off trial a few seconds later, the card answers like any other.
  await page.waitForTimeout(3200);
  await paintOf(page, [1]);
  await page.waitForTimeout(300);
  assert.equal((await pose(page)).lastFind, 1, 'after its trial the card is found again');
});

test('A16 — a card repainting just after we captured it is not a find', async (t) => {
  if (gate(t)) return;
  // Capturing a card whose cover is not decoded yet decodes it, and the card
  // repaints with it a moment later, well after the capture call returned.
  const page = await fixture(t);
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 8000 });
  // The wall captures Beta for its near tile, as it does when the camera brings it close.
  const captured = await page.evaluate(() => { view._labelled[1] = 1; return view._nearSource(1) != null; });
  assert.equal(captured, true, 'the card was captured');
  await page.waitForTimeout(400);
  await paintOf(page, [1]);
  await page.waitForTimeout(200);
  assert.equal((await pose(page)).lastFind, -1, 'its repaint 0.4 s later is the capture, not a match');
  // Another card, not captured, answers in the meantime.
  await paintOf(page, [2]);
  await page.waitForTimeout(200);
  assert.equal((await pose(page)).lastFind, 2, 'a card we did not capture is found');
  await page.waitForTimeout(3000);
  await paintOf(page, [1]);
  await page.waitForTimeout(200);
  assert.equal((await pose(page)).lastFind, 1, 'three seconds on, the captured card answers again');
});

test('A14 — the browser repainting many cards together marks none of them restless', async (t) => {
  if (gate(t)) return;
  // While a wall loads, the browser repaints nearly every card at once, many
  // times over. Each card is in every one of those paints, exactly as an
  // animated card is in its own. Only a paint of a few cards is an animation.
  const page = await fixture(t);
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 8000 });
  const result = await page.evaluate(() => {
    const host = document.querySelector('canvas.card-host');
    const cards = [...host.querySelectorAll('[drawable]')];
    const paint = (which) => {
      const ev = new Event('paint');
      Object.defineProperty(ev, 'changedElements', { value: which.map((i) => cards[i]) });
      host.dispatchEvent(ev);
    };
    // Watched as before arming, when every card is. Synchronous, so nothing arms in between.
    view._findArmed = false;
    // Ten cards' worth in one paint (the fixture has three, so they repeat), eight times.
    for (let n = 0; n < 8; n++) paint([0, 2, 0, 2, 0, 2, 0, 2, 0, 2]);
    const afterMany = [...view._restless];
    for (let n = 0; n < 8; n++) paint([0]);
    const afterAlone = [...view._restless];
    view._findArmed = true;
    return { afterMany, afterAlone };
  });
  assert.deepEqual(result.afterMany, [], 'cards repainted together, however often, are not restless');
  assert.deepEqual(result.afterAlone, [0], 'the control: a card repainting alone that often is');
});

test('A10 — a pool card shows its title band while tiles are drawn from cards, and only then', async (t) => {
  if (gate(t)) return;
  const read = (page) => page.evaluate(() => {
    const card = [...document.querySelectorAll('.sp-card')].find((el) => el.querySelector('.sp-body'));
    const style = (sel) => card?.querySelector(sel) ? getComputedStyle(card.querySelector(sel)) : null;
    return {
      cards: document.querySelectorAll('.sp-card .sp-body').length,
      hovered: card?.matches(':hover') ?? null, selected: card?.getAttribute('aria-selected'),
      body: style('.sp-body')?.visibility ?? null, edit: style('.sp-edit')?.display ?? null,
      hostClass: document.querySelector('#host').classList.contains('sp-cards'),
    };
  });

  const page = await fixture(t);
  await page.mouse.move(2, 2);                       // off every card
  const on = await read(page);
  assert.ok(on.cards > 0, 'the fixture has promoted pool cards');
  assert.equal(on.hovered, false);
  assert.equal(on.hostClass, true, 'the host says its tiles come from cards');
  assert.equal(on.body, 'visible', 'an unhovered pool card shows its title band');
  assert.equal(on.edit, 'none', 'and keeps the editor link for hover or selection');
  await page.evaluate(() => view.nav.select(view.hybrid.live.keys().next().value));
  const selected = await page.evaluate(() => {
    const card = document.querySelector('.sp-card[aria-selected="true"]');
    return card ? getComputedStyle(card.querySelector('.sp-edit')).display : null;
  });
  assert.notEqual(selected, null, 'a pool card is selected');
  assert.notEqual(selected, 'none', 'the selected card shows its editor link');

  // The control: with tiles drawn from plain covers, the band is still a disclosure.
  const plain = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  t.after(() => plain.close());
  await plain.addInitScript(() => { window.__cwDrawable = false; });
  await plain.goto(`${origin}/tests/fixtures/spatial-view.html?initial=full`);
  await plain.waitForFunction(() => window.fixtureReady);
  await plain.mouse.move(2, 2);
  const off = await read(plain);
  assert.ok(off.cards > 0);
  assert.equal(off.hostClass, false);
  assert.equal(off.body, 'hidden', 'without cards behind the tiles, an unhovered pool card hides its band');
});

test('A11 — a sheet-covered near tile is drawn from its card once the cover is in', async (t) => {
  if (gate(t)) return;
  // A sheet cover reaches its card long after the card is built (the pages are
  // held 900 and 1800 ms). Until then the near tile is the bare cell; after,
  // it is the card: the cover on top and the title band under it. A band over
  // an empty hero would mean the capture was taken before the cover.
  const page = await fixture(t, 'initial=full&covers=sheets');
  await page.evaluate(() => view.field.atlases.request(1, 'near'));   // Beta, on the later page
  await page.waitForFunction(() => view._cardCovered.has(1), null, { timeout: 10000 });
  await page.waitForFunction(() => view.field.atlases.nearSlot[1] >= 0, null, { timeout: 5000 });
  await page.waitForTimeout(600);
  const band = await titleBand(page, 1);
  assert.equal(band.blankPath, false, 'the element path did not fall back to images');
  assert.ok(band.dark > 20, `the card ground is present (dark px ${band.dark})`);
  assert.ok(band.light > 20, `the title ink is present (light px ${band.light})`);
  const hero = await page.evaluate(() => {
    const atlas = view.field.atlases.near, slot = view.field.atlases.nearSlot[1];
    const { x, y, w, h } = atlas.slotRect(slot);
    const fitH = atlas.fits[slot * 2 + 1] * h;
    return [...atlas.ctx.getImageData(Math.round(x + w / 2), Math.round(y + (h - fitH) / 2 + fitH * 0.25), 1, 1).data];
  });
  assert.ok(hero[3] > 0 && hero[1] > 150 && hero[0] < 100, `the cover is in the tile, the sheet's green (${hero})`);

  // The pool cards agree with the tiles around them: band on, unhovered.
  await page.mouse.move(2, 2);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.sp-card')]
    .filter((el) => el.querySelector('.sp-body'))
    .map((el) => ({ hovered: el.matches(':hover'), body: getComputedStyle(el.querySelector('.sp-body')).visibility })));
  assert.ok(cards.length > 0, 'the fixture has promoted pool cards');
  for (const card of cards) {
    assert.equal(card.hovered, false);
    assert.equal(card.body, 'visible', 'a sheet-covered pool card shows its band like the tiles');
  }
});

for (const [name, query] of [['a file', 'initial=full'], ['a sheet cell', 'initial=full&covers=sheets']]) {
  test(`A12 — a tile too small to read its title drops the band and takes it back (cover from ${name})`, async (t) => {
    if (gate(t)) return;
    // Semantic zoom: the band is drawn while the title reaches 7 CSS px on
    // screen. The same tile is read at three camera distances in a row, with
    // the pool cards beside it, because the complaint this answers was tiles
    // of one size disagreeing about their label.
    const page = await fixture(t, query);
    if (query.includes('sheets')) await page.waitForFunction(() => view._cardCovered.has(1), null, { timeout: 10000 });
    await page.evaluate(() => view.field.atlases.request(1, 'near'));
    await page.waitForFunction(() => view.field.atlases.nearSlot[1] >= 0, null, { timeout: 5000 });
    await page.mouse.move(2, 2);                       // off every card
    const at = async (z, labelled) => {
      // Straight down the camera's own axis, so every tile on the plane is at one depth.
      await page.evaluate((depth) => { view.basePos.set(view.lookTarget.x, view.lookTarget.y, depth); view.invalidate(); }, z);
      await page.waitForFunction((want) => view._labelled[1] === want && view._relabel.size === 0, labelled, { timeout: 5000 });
      await page.waitForTimeout(500);
      const cards = await page.evaluate(() => [...document.querySelectorAll('.sp-card')]
        .filter((el) => el.querySelector('.sp-body'))
        .map((el) => ({ small: el.classList.contains('sp-small'), body: getComputedStyle(el.querySelector('.sp-body')).visibility })));
      const titlePx = await page.evaluate(() => {
        const focal = view.host.clientHeight / (2 * Math.tan(view.camera.fov / 2 * Math.PI / 180));
        return 15 * Math.min(view.field.sizes[2] / 340, view.field.sizes[3] / 255) * focal / view.basePos.z;
      });
      return { band: await titleBand(page, 1), cards, titlePx };
    };
    const banded = (state, where) => {
      assert.ok(state.titlePx >= 7, `${where}: the title is readable (${state.titlePx.toFixed(1)} px)`);
      assert.ok(state.band.dark > 20 && state.band.light > 20,
        `${where}: the tile carries its band (dark ${state.band.dark}, light ${state.band.light})`);
      assert.ok(state.cards.length > 0, `${where}: there are pool cards`);
      for (const card of state.cards) assert.deepEqual(card, { small: false, body: 'visible' }, `${where}: a pool card shows its band`);
    };

    banded(await at(1200, 1), 'near');

    const small = await at(2800, 0);
    assert.ok(small.titlePx < 6.3, `far: the title is too small to read (${small.titlePx.toFixed(1)} px)`);
    assert.equal(small.band.blankPath, false);
    assert.ok(small.band.slot >= 0 && small.band.opaque > 0, 'far: the tile is still a near tile with pixels');
    assert.ok(small.band.dark < 5 && small.band.light < 5,
      `far: the tile is the bare cover, no band (dark ${small.band.dark}, light ${small.band.light})`);
    for (const card of small.cards) assert.deepEqual(card, { small: true, body: 'hidden' }, 'far: a pool card keeps its band for hover');

    banded(await at(1200, 1), 'near again');
  });
}

const readable = (page) => page.evaluate(() => {
  const read = (atlas) => { try { atlas.ctx.getImageData(0, 0, 1, 1); return true; } catch (error) { return error.name; } };
  return { near: read(view.field.atlases.near), far: read(view.field.atlases.far) };
});
const fixtureTaints = (page) => page.evaluate(async () => {
  const img = new Image(); img.src = '/fixtures/foreign.svg'; await img.decode();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 4, 4);
  try { ctx.getImageData(0, 0, 1, 1); return false; } catch { return true; }
});

test('A17 — a local cover that taints a canvas leaves both atlases usable and is shown through its card', async (t) => {
  if (gate(t)) return;
  // The view stopped responding once such a cover reached an atlas: the canvas
  // was tainted for good and every texture upload after it threw. A page error
  // fails this test through fixture(), so a stopped frame loop cannot pass.
  const page = await fixture(t, 'initial=full&foreign=1');
  assert.equal(await fixtureTaints(page), true, 'the fixture cover taints a canvas in this browser, or the rest proves nothing');
  for (const i of [0, 1]) await page.evaluate((k) => view.field.atlases.request(k, 'near'), i);
  await page.waitForFunction(() => view.field.atlases.nearSlot[1] >= 0, null, { timeout: 5000 });
  await page.mouse.move(2, 2);
  const at = async (z, labelled) => {
    await page.evaluate((depth) => { view.basePos.set(view.lookTarget.x, view.lookTarget.y, depth); view.invalidate(); }, z);
    await page.waitForFunction((want) => view._labelled[1] === want && view._relabel.size === 0, labelled, { timeout: 5000 });
    await page.waitForTimeout(500);
    return { band: await titleBand(page, 1), other: await titleBand(page, 0), atlases: await readable(page) };
  };
  const shown = (state, where) => {
    assert.deepEqual(state.atlases, { near: true, far: true }, `${where}: both atlases can still be read`);
    assert.ok(state.band.slot >= 0 && state.band.opaque > 0, `${where}: the tainting cover's item still has a near tile with pixels`);
    assert.ok(state.band.dark > 20 && state.band.light > 20,
      `${where}: that tile is its card, band included (dark ${state.band.dark}, light ${state.band.light})`);
  };

  shown(await at(1200, 1), 'near');
  const small = await at(2800, 0);
  shown(small, 'far');
  assert.ok(small.other.slot >= 0 && small.other.dark < 5 && small.other.light < 5,
    `far: an ordinary cover beside it is bare, as the cutoff asks (dark ${small.other.dark}, light ${small.other.light})`);
  shown(await at(1200, 1), 'near again');

  // The far tier has no card to fall back on: that one tile fails, alone.
  const far = await page.evaluate(() => ({ slots: Array.from(view.field.atlases.farSlot), failed: [...view.field.atlases._failed] }));
  assert.equal(far.slots[1], -1, 'the tainting cover holds no far slot');
  assert.ok(far.failed.includes('far:1'), 'and is recorded as failed there');
  assert.ok(far.slots.every((slot, i) => i === 1 || slot >= 0), `every other item has its far tile (${far.slots})`);

  // Still drawing: a camera move reaches the camera.
  const before = await page.evaluate(() => view.camera.position.z);
  await page.evaluate(() => { view.basePos.z = 1600; view.invalidate(); });
  await page.waitForFunction((z) => Math.abs(view.camera.position.z - z) > 50, before, { timeout: 3000 });
});

test('A17b — without drawable cards the tainting cover fails its own tiles and nothing else', async (t) => {
  if (gate(t)) return;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no page errors'); });
  await page.addInitScript(() => { window.__cwDrawable = false; });
  await page.goto(`${origin}/tests/fixtures/spatial-view.html?initial=full&foreign=1`);
  await page.waitForFunction(() => window.fixtureReady);
  assert.equal(await fixtureTaints(page), true, 'the fixture cover taints a canvas in this browser');
  for (const i of [0, 1, 2]) await page.evaluate((k) => view.field.atlases.request(k, 'near'), i);
  await page.waitForFunction(() => { const a = view.field.atlases; return a._inflight === 0 && a._nearQueue.length === 0 && a._farQueue.length === 0; }, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  assert.deepEqual(await readable(page), { near: true, far: true }, 'both atlases can still be read');
  const state = await page.evaluate(() => ({ near: Array.from(view.field.atlases.nearSlot), far: Array.from(view.field.atlases.farSlot), failed: [...view.field.atlases._failed].sort() }));
  assert.deepEqual(state.failed, ['far:1', 'near:1'], 'only the tainting cover failed');
  assert.equal(state.near[1], -1); assert.equal(state.far[1], -1);
  assert.ok(state.near[0] >= 0 && state.near[2] >= 0, `the covers beside it have near tiles (${state.near})`);
  assert.ok(state.far.every((slot, i) => i === 1 || slot >= 0), `and every other item has its far tile (${state.far})`);
});
