#!/usr/bin/env node
/**
 * Interaction + contrast checks for the wall, driven with real mouse input.
 *
 * A screenshot proves the wall PAINTED; it does not prove a tile can be
 * clicked, that a drag pans instead of selecting, or that text clears the
 * contrast floor. Those need a real pointer, so they live here.
 *
 *   node check.mjs [--url http://127.0.0.1:4173] [--headed] [--shot out.png]
 */

import { chromium } from 'playwright';
import process from 'node:process';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const URL_ = arg('--url', 'http://127.0.0.1:4173');
const SHOT = arg('--shot', '');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/* ---- contrast, computed the same way the WCAG formula defines it ---- */

function relLuminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  const a = relLuminance(fg);
  const b = relLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function parseRGB(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v.trim()));
  return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
}

/** Composite a possibly-translucent colour over an opaque backdrop. */
function over(fg, bg) {
  return fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
}

async function main() {
  const browser = await chromium.launch({ headless: !args.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Harvested clips hotlink their hero images, so a dead remote asset is an
  // expected cost of not downloading — not a defect. Count those separately;
  // fail only on script errors and on anything the app itself serves.
  const errors = [];
  const remoteAssetFailures = [];
  const isRemoteAsset = (t) => /Failed to load resource/i.test(t)
    && !/127\.0\.0\.1|localhost/.test(t);
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (isRemoteAsset(text)) remoteAssetFailures.push(text);
    else errors.push(text);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) return;
    remoteAssetFailures.push(url);
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log(`\nwunderkammer check → ${URL_}\n`);
  // Remote heroes may never settle; UI readiness must not wait for the network.
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tile', { timeout: 10000 });
  await page.waitForTimeout(700);

  const tileCount = await page.locator('.tile').count();
  check(`wall renders tiles (${tileCount})`, tileCount > 0);
  check('no script or local-resource errors on boot', errors.length === 0, errors[0]);
  const loaded = await page.evaluate(() =>
    [...document.querySelectorAll('.tile img')].filter((i) => i.currentSrc || i.src).length);
  console.log(`  · ${remoteAssetFailures.length} remote hero image(s) failed to load of ${loaded} attempted — link rot, the cost of harvesting instead of downloading`);

  /* --- a click on a tile opens the detail panel --- */
  const box = await page.locator('.tile').first().boundingBox();
  check('first tile has a layout box', !!box);
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(350);
    const open = await page.locator('#detail.open').count();
    check('click on a tile opens the detail panel', open === 1);

    const hasEdit = await page.locator('#detail a[href^="obsidian://"]').count();
    check('detail offers an Obsidian edit deep link', hasEdit === 1);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('Escape closes the detail panel', (await page.locator('#detail.open').count()) === 0);
  }

  /* --- a drag pans the canvas and must NOT open the panel --- */
  const before = await page.evaluate(() => document.getElementById('canvas').style.transform);
  const t2 = await page.locator('.tile').nth(1).boundingBox();
  if (t2) {
    await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(t2.x + t2.width / 2 - i * 14, t2.y + t2.height / 2 - i * 6);
    }
    await page.mouse.up();
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => document.getElementById('canvas').style.transform);
    check('dragging from a tile pans the canvas', before !== after);
    check('a drag does not open the detail panel', (await page.locator('#detail.open').count()) === 0);
  }

  /* --- zoom --- */
  const s0 = await page.evaluate(() => document.getElementById('canvas').style.transform);
  await page.keyboard.press('=');
  await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => document.getElementById('canvas').style.transform);
  check('keyboard zoom changes the transform', s0 !== s1);

  await page.keyboard.press('0');
  await page.waitForTimeout(400);
  check('fit reframes the canvas', (await page.evaluate(() => document.getElementById('canvas').style.transform)) !== s1);

  /* --- semantic zoom --- */
  await page.evaluate(() => {
    const c = document.getElementById('canvas');
    return c.classList.contains('z-far') || c.classList.contains('z-near') || true;
  });
  const zoomClassWorks = await page.evaluate(async () => {
    const stage = document.getElementById('stage');
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, ctrlKey: true, clientX: 700, clientY: 400, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
    return document.getElementById('canvas').classList.contains('z-near');
  });
  check('ctrl+wheel zooms in and triggers near-zoom detail', zoomClassWorks);

  /* --- filtering --- */
  const total = await page.locator('.tile').count();
  const chip = page.locator('.rail .chip').first();
  const chipLabel = (await chip.textContent()) || '';
  await chip.click();
  await page.waitForTimeout(400);
  const filtered = await page.locator('.tile').count();
  check(`facet chip filters the wall (${total} → ${filtered} on "${chipLabel.trim()}")`, filtered < total && filtered > 0);
  check('active chip reports pressed state', (await page.locator('.chip[aria-pressed="true"]').count()) === 1);
  await chip.click();
  await page.waitForTimeout(400);
  check('deselecting the chip restores the wall', (await page.locator('.tile').count()) === total);

  /* --- grouping --- */
  await page.selectOption('#group', 'source');
  await page.waitForTimeout(500);
  const blocks = await page.locator('.block').count();
  check(`grouping renders labelled blocks (${blocks})`, blocks > 1);
  const fill = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const canvas = document.getElementById('canvas').getBoundingClientRect();
    const area = [...document.querySelectorAll('.tile')].reduce((sum, tile) => {
      const r = tile.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, stage.right) - Math.max(r.left, stage.left));
      const h = Math.max(0, Math.min(r.bottom, stage.bottom) - Math.max(r.top, stage.top));
      return sum + w * h;
    }, 0);
    return { tiles: area / (stage.width * stage.height), width: canvas.width / stage.width,
      height: canvas.height / stage.height };
  });
  check('source overview fills the stage with content', fill.tiles > 0.45 && fill.width > 0.8 && fill.height > 0.8,
    JSON.stringify(fill));
  await page.selectOption('#group', 'none');
  await page.waitForTimeout(400);
  check('ungrouping removes the blocks', (await page.locator('.block').count()) === 0);

  /* --- search --- */
  await page.fill('#search', 'nanoleaf');
  await page.waitForTimeout(400);
  const searched = await page.locator('.tile').count();
  check(`search narrows the wall (${total} → ${searched})`, searched > 0 && searched < total);
  await page.fill('#search', '');
  await page.waitForTimeout(400);

  /* --- contrast floor on every readable string --- */
  // Group first: block headings only exist in the grouped state, and an
  // unsampled string is an unverified string.
  await page.selectOption('#group', 'source');
  await page.waitForTimeout(500);

  const samples = await page.evaluate(() => {
    const out = [];
    const sel = ['.cap .t', '.cap .m', '.chip', '.count', '.brand', '.block h2', '.hint', '.bar label', '.search'];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out.push({ sel: s, color: cs.color, size: parseFloat(cs.fontSize), weight: cs.fontWeight });
    }
    return out;
  });

  // Worst realistic backdrop for each surface, as documented in wall.css.
  const CAPTION_BACKDROP = [25, 25, 35];  // 0.92 scrim over a pure-white photo
  const PANEL = [13, 13, 22];
  const backdropFor = (sel) => (sel.startsWith('.cap') ? CAPTION_BACKDROP : PANEL);

  console.log('\n  contrast (floor 8:1):');
  for (const s of samples) {
    const fg = parseRGB(s.color);
    if (!fg) continue;
    const bg = backdropFor(s.sel);
    const ratio = contrast(over(fg, bg), bg);
    const ok = ratio >= 8;
    if (!ok) fail++; else pass++;
    console.log(`  ${ok ? '✓' : '✗'} ${s.sel.padEnd(14)} ${ratio.toFixed(2)}:1  ${s.color}`);
  }

  if (SHOT) {
    // Blur first: a focused search field swallows the fit key and the shot
    // would show a filtered wall with a stray character in the box.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('0');
    await page.waitForTimeout(600);
    await page.screenshot({ path: SHOT });
    console.log(`\n  screenshot → ${SHOT}`);
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
