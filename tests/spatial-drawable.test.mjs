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
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${colors[image[1]]}"/></svg>`);
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

async function fixture(t, query = 'initial=full') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no page errors'); });
  await page.goto(`${origin}/tests/fixtures/spatial-view.html?${query}`);
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

test('A9 — find stays off while the cards are still repainting, and arms once they stop', async (t) => {
  if (gate(t)) return;
  const page = await fixture(t);
  // A repaint nobody listed: restyle one card every 150 ms, from the moment
  // the fixture is up. The browser reports each one as a paint naming that
  // card alone, which is exactly what a one-card find match looks like.
  await page.evaluate(() => {
    window.paintSets = [];
    view.cardHost.onPaint((indices) => window.paintSets.push(indices.slice()));
    const card = document.querySelectorAll('.sp-dcard')[1];
    let on = false;
    window.restyle = setInterval(() => { on = !on; card.style.outline = on ? '2px solid #ffd166' : ''; }, 150);
  });
  await page.waitForTimeout(2000);
  const during = await page.evaluate(() => ({
    armed: view._findArmed, lastFind: view._lastFind, selection: view.nav?.selection,
    partial: window.paintSets.filter((set) => set.length === 1 && set[0] === 1).length,
  }));
  assert.ok(during.partial >= 3, `the restyle repainted card 1 by itself; saw ${during.partial} such paints`);
  assert.equal(during.armed, false, 'find is not armed while cards keep repainting');
  assert.equal(during.lastFind, -1, 'and no repaint was recorded as a find');
  assert.equal(during.selection, -1);

  await page.evaluate(() => clearInterval(window.restyle));
  await page.waitForFunction(() => view._findArmed === true, null, { timeout: 4000 });
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
