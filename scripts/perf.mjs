#!/usr/bin/env node
/**
 * Performance envelope for a running wunderkammer instance.
 *
 * Every number in docs/PERF.md comes from this script, so a change to the
 * renderer is judged against the same scenarios on the same instance rather
 * than against a feeling. It drives a real browser through the flat wall and
 * the spatial view and reads Chrome's own counters (layout, style recalc,
 * script time, DOM nodes, heap) through CDP around each interaction, plus an
 * in-page requestAnimationFrame sampler for frame times.
 *
 *   node scripts/perf.mjs --url http://127.0.0.1:4175 [--headed] [--chrome]
 *        [--scenario boot|flat|interact|spatial|float|all] [--label before] [--out .local/perf]
 *        [--warm] [--runs 3] [--check] [--budgets perf-budgets.json] [--atlas-timeout 60000] [--profile]
 *
 * The page's own probe (wall/instrument.mjs) is switched on for every run, so
 * each scenario row also carries `app`: the wall's named phases (filter,
 * render/layout, overview/paint, spatial/pass …), Long Animation Frame script
 * attribution, and input→paint latency per interaction (the INP definition).
 *
 * --runs N repeats the whole session in fresh browser contexts and writes a
 * summary with the median and range of each headline metric, because single
 * runs on a laptop differ by more than most changes do (docs/PERF.md, Sept 20).
 * --check compares those medians with perf-budgets.json and exits 1 on a miss.
 *
 * Headless Chromium rasterises on SwiftShader, so its frame times are a
 * software floor: use --chrome --headed on the target machine for GPU-side
 * numbers, and headless for the CPU/DOM counters, which are the same either way.
 * Nothing here writes to the instance: no piles, no permalinks, no view state.
 */

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);
const URL_ = arg('--url', 'http://127.0.0.1:4175');
const SCENARIO = arg('--scenario', 'all');
const LABEL = arg('--label', 'run');
const OUT = arg('--out', '.local/perf');
const HEADED = flag('--headed');
const CHROME = flag('--chrome');
const VIEWPORT = { width: Number(arg('--width', 1440)), height: Number(arg('--height', 900)) };
const DPR = Number(arg('--dpr', 2));
const RUNS = Math.max(1, Number(arg('--runs', 1)));
const CHECK = flag('--check');
const BUDGETS = arg('--budgets', path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'perf-budgets.json'));
const ATLAS_TIMEOUT = Number(arg('--atlas-timeout', 60000));
// Sampled CPU profile per scenario: finds cost in code no span covers (the way
// the overview's canvas flush was found, 2026-10-13). Writes .cpuprofile files
// that open in DevTools ▸ Performance, plus a self-time table on each row.
const PROFILE = flag('--profile');
// Warm boot: load the wall once in the run's context and let every image land,
// then measure a second navigation against that HTTP cache. Without it every
// run is a cold boot (a fresh context has an empty cache).
const WARM = flag('--warm');
const RUN_FLAT = SCENARIO === 'all' || SCENARIO === 'flat';
const RUN_INTERACT = SCENARIO === 'all' || SCENARIO === 'flat' || SCENARIO === 'interact';
const RUN_SPATIAL = SCENARIO === 'all' || SCENARIO === 'spatial';
const RUN_FLOAT = SCENARIO === 'all' || SCENARIO === 'float';

const round = (v, d = 1) => Number.isFinite(v) ? Number(v.toFixed(d)) : v;
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const summary = (frames) => ({
  n: frames.length, p50: round(pct(frames, 0.5)), p95: round(pct(frames, 0.95)), max: round(Math.max(0, ...frames)),
  over16: frames.filter(f => f > 16.7).length, over33: frames.filter(f => f > 33).length,
});

/** CDP Performance.getMetrics as a flat object. */
async function metrics(cdp) {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map(m => [m.name, m.value]));
}
/** Layout/style/script deltas between two metric snapshots, in ms and counts. */
function delta(a, b) {
  return {
    layouts: b.LayoutCount - a.LayoutCount, layoutMs: round((b.LayoutDuration - a.LayoutDuration) * 1000),
    restyles: b.RecalcStyleCount - a.RecalcStyleCount, restyleMs: round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
    scriptMs: round((b.ScriptDuration - a.ScriptDuration) * 1000), taskMs: round((b.TaskDuration - a.TaskDuration) * 1000),
    nodes: b.Nodes, heapMB: round(b.JSHeapUsedSize / 1048576),
  };
}

/** In-page frame sampler and long-task observer. */
const SAMPLER = () => {
  const s = window.__perf = { frames: [], long: [], on: false, last: 0 };
  const tick = (now) => { if (s.on) { if (s.last) s.frames.push(now - s.last); s.last = now; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (s.on) s.long.push(e.duration); }).observe({ type: 'longtask', buffered: false }); } catch {}
  s.start = () => { s.frames = []; s.long = []; s.last = 0; s.on = true; };
  s.stop = () => { s.on = false; return { frames: s.frames.slice(), long: s.long.slice() }; };
};

/** The page probe's view of one scenario, trimmed to what a row needs. */
const APP_SNAPSHOT = () => {
  const s = window.__cwPerf?.snapshot(); if (!s) return null;
  const spans = Object.entries(s.spans).sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 24);
  return { spans: Object.fromEntries(spans), counters: s.counters, gauges: s.gauges,
    loaf: { n: s.loaf.n, blockingMs: s.loaf.blockingMs, worst: s.loaf.worst.slice(0, 3) },
    interactions: { n: s.interactions.n, p75: s.interactions.p75, inp: s.interactions.inp, max: s.interactions.max, worst: s.interactions.worst.slice(0, 3) } };
};
/** Self time per function (with its first callers), from a CDP CPU profile. */
function selfTime(profile, n = 12) {
  const byId = new Map(profile.nodes.map(x => [x.id, x]));
  const parent = new Map(); for (const x of profile.nodes) for (const c of x.children || []) parent.set(c, x.id);
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0)));
  const label = f => `${f.functionName || '(anonymous)'} ${f.url ? f.url.split('/').pop() + ':' + (f.lineNumber + 1) : '(native)'}`;
  const agg = new Map();
  for (const [id, us] of self) {
    const node = byId.get(id), f = node.callFrame;
    if (['(idle)', '(program)', '(root)'].includes(f.functionName)) continue;
    const callers = []; let p = byId.get(parent.get(id));
    for (let k = 0; k < 3 && p && p.callFrame.functionName !== '(root)'; k++) { callers.push(label(p.callFrame)); p = byId.get(parent.get(p.id)); }
    const key = `${label(f)}${callers.length ? '  ⇐ ' + callers.join(' ⇐ ') : ''}`;
    agg.set(key, (agg.get(key) || 0) + us);
  }
  return [...agg].sort((a, b) => b[1] - a[1]).slice(0, n).map(([fn, us]) => ({ ms: round(us / 1000), fn }));
}
const profileFile = name => path.join(OUT, `${LABEL}-${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.cpuprofile`);

const topSpans = (app, n = 4) => app ? Object.entries(app.spans).slice(0, n).map(([k, v]) => `${k} ${v.totalMs}`).join(' · ') : '';

async function measure(page, cdp, name, action, { settle = 400 } = {}) {
  const before = await metrics(cdp);
  await page.evaluate(() => window.__cwPerf?.reset());
  await page.evaluate(() => window.__perf.start());
  if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const t0 = Date.now();
  await action();
  await page.waitForTimeout(settle);
  const wall = Date.now() - t0 - settle;
  const { frames, long } = await page.evaluate(() => window.__perf.stop());
  const after = await metrics(cdp);
  let cpu = null;
  if (PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    cpu = selfTime(profile);
    await mkdir(OUT, { recursive: true });
    await writeFile(profileFile(name), JSON.stringify(profile));
  }
  const app = await page.evaluate(APP_SNAPSHOT);
  const row = { name, wallMs: wall, ...delta(before, after), frames: summary(frames), longTasks: long.length, longestTaskMs: round(Math.max(0, ...long)), app };
  if (app && app.interactions.n) {
    row.inpMs = app.interactions.inp;
    // The main-thread share of the worst interaction: queueing plus handlers.
    // Presentation is excluded because headless paints on SwiftShader.
    row.inputBlockMs = round(Math.max(...app.interactions.worst.map(w => w.delayMs + w.processMs)));
  }
  console.log(`  ${name.padEnd(28)} script ${String(row.scriptMs).padStart(7)}ms  layout ${String(row.layouts).padStart(4)}× ${String(row.layoutMs).padStart(6)}ms  style ${String(row.restyles).padStart(4)}× ${String(row.restyleMs).padStart(6)}ms  frames p50 ${row.frames.p50} p95 ${row.frames.p95} max ${row.frames.max} (${row.frames.over33} >33ms)  long ${row.longTasks}${row.inpMs != null ? `  inp ${row.inpMs}ms` : ''}`);
  if (cpu) { row.cpu = cpu; for (const c of cpu.slice(0, 3)) console.log(`  ${''.padEnd(28)} ⌁ ${String(c.ms).padStart(6)}ms ${c.fn}`); }
  if (app) console.log(`  ${''.padEnd(28)} ↳ ${topSpans(app) || 'no app spans'}${app.loaf.n ? ` · LoAF ${app.loaf.n} (${app.loaf.blockingMs}ms blocking)` : ''}`);
  return row;
}

async function stageCentre(page) {
  const r = await page.locator('#stage').boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, r };
}

/** All visible image slots, including work still queued before src assignment.
 * A tile shows its image when its own <img> has decoded OR the overview canvas
 * has painted it (`.overview-painted`, set only once pixels exist at the
 * current pose). Since overview sheets (docs/PERF.md, "Overview sheets"), the
 * overview paints from a few baked pages and the per-file <img> stays unloaded
 * until a reading zoom, so counting <img> decodes alone would wait for work
 * the wall deliberately no longer does. `domDecoded` keeps the old count. */
const IMAGE_STATE = () => {
  const imgs = [...document.querySelectorAll('#canvas .tile img')];
  const visible = imgs.filter(i => i.closest('.tile').style.visibility !== 'hidden');
  const dom = i => i.complete && i.naturalWidth > 0 && !!(i.src || i.srcset);
  const painted = i => i.closest('.tile').classList.contains('overview-painted');
  const shown = visible.filter(i => dom(i) || painted(i));
  return { tiles: imgs.length, visible: visible.length, shown: shown.length,
    domDecoded: visible.filter(dom).length, overviewPainted: visible.filter(painted).length };
};

async function waitImages(page, timeout = 30000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const s = await page.evaluate(IMAGE_STATE);
    if (s.shown >= s.visible) return { ...s, ms: Date.now() - t0 };
    last = s;
    await page.waitForTimeout(100);
  }
  return { ...last, ms: Date.now() - t0, timedOut: true };
}

/** Spatial atlas residency and render accounting, read off the debug handle. */
const SPATIAL_STATE = () => {
  const v = window.__cwSpatial; if (!v?.built) return null;
  const a = v.field.atlases;
  // A near-tier resident never takes a far slot, so "resident" means either.
  let far = 0, near = 0, resident = 0;
  for (let i = 0; i < v.field.count; i++) { if (a.farSlot[i] >= 0) far++; if (a.nearSlot[i] >= 0) near++; if (a.farSlot[i] >= 0 || a.nearSlot[i] >= 0) resident++; }
  const info = v.webglRenderer.info;
  return {
    count: v.field.count, far, near, resident, failed: a._failed.size, inflight: a._inflight,
    queued: a._farQueue.length + a._nearQueue.length, pendingUpload: !!(a.far._dirty || a.near._dirty), drawn: window.__spDraws ?? null,
    live: v.hybrid.live.size, atlasMB: Math.round(v.field.bytes / 1048576),
    renders: window.__spRenders ?? null, renderMs: window.__spRenderMs ?? null,
    uploads: window.__spUploads ?? null, uploadMB: window.__spUploadMB ?? null,
    calls: info.render.calls, textures: info.memory.textures,
  };
};
/** Wrap the renderer and both atlases so idle cost and upload volume are countable. */
const SPATIAL_HOOKS = () => {
  const v = window.__cwSpatial; if (!v?.built || window.__spHooked === v.field) return;
  window.__spHooked = v.field;
  window.__spRenders = 0; window.__spRenderMs = 0; window.__spUploads = 0; window.__spUploadMB = 0;
  const r = v.webglRenderer, orig = r.render.bind(r);
  r.render = (...a) => { const t = performance.now(); orig(...a); window.__spRenderMs += performance.now() - t; window.__spRenders++; };
  window.__spDraws = 0;
  for (const atlas of [v.field.atlases.far, v.field.atlases.near]) {
    const f = atlas.flush.bind(atlas), d = atlas.draw.bind(atlas);
    atlas.flush = (now) => { const ok = f(now); if (ok) { window.__spUploads++; window.__spUploadMB += (atlas.uploadedBytes ?? atlas.bytes) / 1048576; } return ok; };
    atlas.draw = (slot, image) => { const ok = d(slot, image); if (ok) window.__spDraws++; return ok; };
  }
};
/** The floating space's own counters: renders, per-render CPU (pass + draw), atlas residency. Cheap enough to poll. */
const FLOAT_STATE = () => {
  const v = window.__cwFloat; if (!v?.built || !v.field) return null;
  const a = v.field.atlases; let far = 0, near = 0;
  for (let i = 0; i < v.count; i++) { if (a.farSlot[i] >= 0) far++; if (a.nearSlot[i] >= 0) near++; }
  const work = v.frameTimes.slice(-600), info = v.renderer.info;
  return { count: v.count, far, near, failed: a._failed.size, busy: a._inflight > 0 || a._farQueue.length > 0 || a._nearQueue.length > 0 || a.far._dirty || a.near._dirty,
    moving: v.field.moving, flying: !!v.tween, renders: v.renderCount, work, calls: info.render.calls, atlasMB: Math.round(v.field.bytes / 1048576) };
};
async function waitFloat(page, timeout = ATLAS_TIMEOUT) {
  const t0 = Date.now(); let s;
  for (;;) {
    s = await page.evaluate(FLOAT_STATE);
    if (s && s.far === s.count && !s.busy && !s.moving && !s.flying) break;
    if (Date.now() - t0 > timeout) { s = { ...s, timedOut: true }; break; }
    await page.waitForTimeout(100);
  }
  return { ...s, ms: Date.now() - t0, work: undefined };
}
/** Renders and per-render work (ms) between two FLOAT_STATE readings. */
function floatDelta(a, b) {
  const n = Math.max(0, (b?.renders ?? 0) - (a?.renders ?? 0)), work = n ? b.work.slice(-n) : [];
  return { renders: n, workP50: round(pct(work, 0.5), 2), workP95: round(pct(work, 0.95), 2), workMax: round(Math.max(0, ...work), 2), calls: b?.calls };
}
const SPATIAL_RESET = () => { window.__spRenders = 0; window.__spRenderMs = 0; window.__spUploads = 0; window.__spUploadMB = 0; window.__spDraws = 0; };

async function waitAtlas(page, timeout = ATLAS_TIMEOUT) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const s = await page.evaluate(SPATIAL_STATE);
    // Every instance holds a slot in one tier or has failed, nothing is still
    // queued or in flight, and no drawn slot is waiting on the throttled GPU
    // upload: the field has finished streaming. Without the last condition the
    // final upload (110+ far slots on the Psychodeli Atlas) landed inside the
    // idle window and was counted as idle renders.
    if (s && s.resident + s.failed >= s.count && !s.inflight && !s.queued && !s.pendingUpload) return { ...s, ms: Date.now() - t0 };
    last = s;
    await page.waitForTimeout(150);
  }
  return { ...last, ms: Date.now() - t0, timedOut: true };
}

/** A tile whose centre is on screen and not under the rail, detail or bar. */
const VISIBLE_TILE = () => {
  const stage = document.getElementById('stage').getBoundingClientRect();
  const tiles = [...document.querySelectorAll('#canvas > .tile')].filter(t => t.style.visibility !== 'hidden');
  let best = null, bestD = Infinity;
  for (const t of tiles) {
    const r = t.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (r.width < 24 || x < stage.left || x > stage.right || y < stage.top || y > stage.bottom) continue;
    if (document.elementFromPoint(x, y)?.closest('.tile') !== t) continue;
    const d = Math.hypot(x - (stage.left + stage.width / 2), y - (stage.top + stage.height / 2));
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  return best;
};

async function runOnce(browser, runIndex) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript(() => { window.__cwPerfEnable = true; });
  // The default Resource Timing buffer holds 250 entries; a boot requests ~1,800 covers.
  await page.addInitScript(() => { performance.setResourceTimingBufferSize?.(20000); });
  await page.addInitScript(SAMPLER);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const result = { label: LABEL, run: runIndex + 1, runs: RUNS, url: URL_, when: new Date().toISOString(), headed: HEADED, chrome: CHROME, warm: WARM, viewport: VIEWPORT, dpr: DPR,
    ua: await page.evaluate(() => navigator.userAgent), rows: [] };
  console.log(`wunderkammer perf · ${LABEL} · run ${runIndex + 1}/${RUNS} · ${URL_} · ${HEADED ? 'headed' : 'headless'} ${CHROME ? 'chrome' : 'chromium'}${WARM ? ' · warm cache' : ''} · ${VIEWPORT.width}×${VIEWPORT.height}@${DPR}x`);

  // ---- boot -------------------------------------------------------------
  if (WARM) {
    await page.goto(URL_, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body[data-view-ready="true"]', { timeout: 60000 });
    await waitImages(page);
    await page.waitForTimeout(500);
  }
  const m0 = await metrics(cdp);
  const nav0 = Date.now();
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-view-ready="true"]', { timeout: 60000 });
  const ready = Date.now() - nav0;
  const m1 = await metrics(cdp);
  const res = await page.evaluate(() => {
    const e = performance.getEntriesByType('resource').find(r => r.name.endsWith('/api/clips'));
    return e ? { bytes: e.transferSize, encodedBytes: e.encodedBodySize, decodedBytes: e.decodedBodySize, ms: Math.round(e.duration) } : null;
  });
  const imgs = await waitImages(page);
  // Image requests the boot made, by route: per-file covers versus baked
  // overview pages. transferSize 0 is a browser-cache hit (same origin).
  const imageRequests = await page.evaluate(() => {
    const out = { files: 0, filesCached: 0, sheets: 0, sheetsCached: 0, wireKB: 0 };
    for (const e of performance.getEntriesByType('resource')) {
      if (!/\/media\//.test(e.name)) continue;
      const kind = /\/media\/sheets\//.test(e.name) ? 'sheets' : 'files';
      out[kind]++; if (!e.transferSize) out[`${kind}Cached`]++;
      out.wireKB += e.transferSize / 1024;
    }
    out.wireKB = Math.round(out.wireKB);
    return out;
  });
  const boot = { name: 'boot', readyMs: ready, clips: res, ...delta(m0, m1), images: imgs, imageRequests,
    count: await page.evaluate(() => document.getElementById('count').textContent.trim()),
    app: await page.evaluate(APP_SNAPSHOT),
    marks: await page.evaluate(() => window.__cwPerf?.snapshot()?.marks ?? null),
    paint: await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]))) };
  console.log(`  boot: ready ${ready}ms · /api/clips ${res?.decodedBytes ?? '?'}B (wire ${res?.bytes ?? '?'}B) in ${res?.ms ?? '?'}ms · ${boot.nodes} nodes · heap ${boot.heapMB}MB · ${imgs.shown}/${imgs.visible} images shown (${imgs.domDecoded} <img>, ${imgs.overviewPainted} overview) in ${imgs.ms}ms${imgs.timedOut ? ' (timed out)' : ''} · requests ${imageRequests.files} files (${imageRequests.filesCached} cached) + ${imageRequests.sheets} sheets, ${imageRequests.wireKB} KB · ${boot.count}`);
  result.rows.push(boot);
  await page.waitForTimeout(500);
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  { const g = await metrics(cdp); result.bootGC = { nodes: g.Nodes, heapMB: round(g.JSHeapUsedSize / 1048576), listeners: g.JSEventListeners }; }

  const c = await stageCentre(page);
  await page.mouse.move(c.x, c.y);

  if (RUN_FLAT) {
    // ---- flat: idle -----------------------------------------------------
    result.rows.push(await measure(page, cdp, 'flat idle 1s', async () => { await page.waitForTimeout(1000); }, { settle: 0 }));
    // ---- flat: pan ------------------------------------------------------
    result.rows.push(await measure(page, cdp, 'flat pan (60 wheel ticks)', async () => {
      for (let i = 0; i < 60; i++) { await page.mouse.wheel(i < 30 ? 12 : -12, i < 30 ? 8 : -8); await page.waitForTimeout(16); }
    }));
    // ---- flat: zoom in and out -------------------------------------------
    result.rows.push(await measure(page, cdp, 'flat zoom in (20 ticks)', async () => {
      await page.keyboard.down('Control');
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -30); await page.waitForTimeout(16); }
      await page.keyboard.up('Control');
    }, { settle: 700 }));
    result.rows.push({ name: 'flat zoomed images', ...(await waitImages(page)) });
    result.rows.push(await measure(page, cdp, 'flat pan zoomed (60 ticks)', async () => {
      for (let i = 0; i < 60; i++) { await page.mouse.wheel(i < 30 ? 20 : -20, i < 30 ? 14 : -14); await page.waitForTimeout(16); }
    }));
    result.rows.push(await measure(page, cdp, 'flat zoom out (20 ticks)', async () => {
      await page.keyboard.down('Control');
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 30); await page.waitForTimeout(16); }
      await page.keyboard.up('Control');
    }, { settle: 700 }));
    await page.click('#zoom-fit'); await page.waitForTimeout(500);
    // ---- flat: filter on and off -----------------------------------------
    const chip = page.locator('#rail .chip[data-facet]').first();
    const chipLabel = await chip.getAttribute('data-value');
    result.rows.push(await measure(page, cdp, `flat filter on (${chipLabel})`, async () => { await chip.click(); }, { settle: 600 }));
    result.rows.push(await measure(page, cdp, 'flat filter off', async () => { await chip.click(); }, { settle: 600 }));
    // ---- flat: group change ---------------------------------------------
    const groups = await page.locator('#group option').evaluateAll(o => o.map(x => x.value));
    const current = await page.locator('#group').inputValue();
    const other = groups.find(g => g !== current) || current;
    result.rows.push(await measure(page, cdp, `flat group → ${other}`, async () => { await page.selectOption('#group', other); }, { settle: 600 }));
    result.rows.push(await measure(page, cdp, `flat group → ${current}`, async () => { await page.selectOption('#group', current); }, { settle: 600 }));
    result.rows.push({ name: 'flat regrouped images', ...(await waitImages(page)) });
  }

  if (RUN_INTERACT) {
    // ---- discrete interactions: judged by input → next paint ------------
    await page.click('#zoom-fit'); await page.waitForTimeout(600);
    const at = await page.evaluate(VISIBLE_TILE);
    if (at) {
      result.rows.push(await measure(page, cdp, 'detail open (click tile)', async () => {
        await page.mouse.click(at.x, at.y);
        await page.waitForSelector('#detail.open', { timeout: 5000 }).catch(() => {});
      }, { settle: 600 }));
      result.rows.push(await measure(page, cdp, 'detail walk (8× →)', async () => {
        for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150); }
      }, { settle: 600 }));
      result.rows.push(await measure(page, cdp, 'detail close (Esc)', async () => {
        for (let i = 0; i < 3 && await page.locator('#detail.open').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
      }, { settle: 400 }));
    } else result.rows.push({ name: 'detail open (click tile)', skipped: 'no clickable tile on screen' });
    await page.click('#zoom-fit'); await page.waitForTimeout(500);
    result.rows.push(await measure(page, cdp, 'search type (3 keys)', async () => {
      await page.click('#search');
      for (const ch of 'the') { await page.keyboard.type(ch); await page.waitForTimeout(180); }
    }, { settle: 800 }));
    result.rows.push(await measure(page, cdp, 'search clear', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.press('Backspace');
    }, { settle: 800 }));
    await page.locator('#stage').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.click('#zoom-fit'); await page.waitForTimeout(400);
  }

  if (RUN_FLOAT) {
    // ---- float: open ----------------------------------------------------
    const tf0 = Date.now();
    result.rows.push(await measure(page, cdp, 'float open', async () => {
      await page.click('#view-3d');
      await page.waitForFunction(() => window.__cwFloat?.built && !document.getElementById('float-host').hidden, null, { timeout: 60000 });
    }, { settle: 300 }));
    const fl = await waitFloat(page);
    fl.wallMs = Date.now() - tf0;
    console.log(`  float atlas: ${fl.far}/${fl.count} far, ${fl.near} near, ${fl.failed} failed in ${fl.ms}ms · atlas ${fl.atlasMB}MB · ${fl.calls} draw calls${fl.timedOut ? ' (timed out)' : ''}`);
    result.rows.push({ name: 'float atlas load', ...fl });
    // The space opens in Axes; the rows below were first measured in OKLab
    // (docs/PERF.md), so they start there, unmeasured.
    await page.locator('.float-arrange input[value=oklab]').check(); await waitFloat(page);
    // Each row carries the rAF frame intervals (frames) and the view's own
    // per-render work: billboard + tier pass + draw, measured in the page.
    const floatRow = async (name, action, opts) => {
      const before = await page.evaluate(FLOAT_STATE);
      const row = await measure(page, cdp, name, action, opts);
      row.float = floatDelta(before, await page.evaluate(FLOAT_STATE));
      console.log(`  ${''.padEnd(28)} ✺ ${row.float.renders} renders · work p50 ${row.float.workP50}ms p95 ${row.float.workP95}ms max ${row.float.workMax}ms · ${row.float.calls} draw calls`);
      result.rows.push(row);
    };
    await floatRow('float idle 2s', async () => { await page.waitForTimeout(2000); }, { settle: 0 });
    const box = await page.locator('.float-canvas').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height * 0.4;
    await floatRow('float orbit (60 moves)', async () => {
      await page.mouse.move(cx, cy); await page.mouse.down();
      for (let i = 0; i < 60; i++) { await page.mouse.move(cx + 300 * Math.sin(i / 60 * Math.PI * 2), cy + 60 * Math.sin(i / 30 * Math.PI)); await page.waitForTimeout(16); }
      await page.mouse.up();
    });
    await floatRow('float dolly (40 ticks)', async () => {
      await page.mouse.move(cx + 80, cy);
      for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, i < 20 ? -40 : 40); await page.waitForTimeout(16); }
    });
    await page.keyboard.press('Home'); await waitFloat(page);
    await floatRow('float arrange OKLab → HSL', async () => {
      await page.locator('.float-arrange input[value=hsl]').check(); await waitFloat(page);
    }, { settle: 200 });
    await floatRow('float arrange HSL → A–Z', async () => {
      await page.locator('.float-arrange input[value=az]').check(); await waitFloat(page);
    }, { settle: 200 });
    await page.locator('.float-arrange input[value=oklab]').check(); await waitFloat(page);
    const option = await page.locator('.float-items select option').nth(Math.max(1, Math.floor(await page.locator('.float-items select option').count() / 2))).getAttribute('value');
    await floatRow('float fly-to (item menu)', async () => {
      await page.selectOption('.float-items select', option); await waitFloat(page);
    }, { settle: 200 });
    await page.keyboard.press('Home'); await waitFloat(page);
    const chip = page.locator('#rail .chip[data-facet]').first();
    if (await chip.count() && await chip.isVisible()) {
      const chipLabel = await chip.getAttribute('data-value');
      await floatRow(`float scope on (${chipLabel})`, async () => { await chip.click(); await waitFloat(page); }, { settle: 300 });
      await floatRow('float scope off', async () => { await chip.click(); await waitFloat(page); }, { settle: 300 });
    }
    await page.click('#view-3d'); await page.waitForTimeout(300);
  }

  if (RUN_SPATIAL) {
    // ---- spatial: open --------------------------------------------------
    // The 3D button opens the floating space; the stacks are the last entry
    // in its menu. The space opens unmeasured (the float scenario, which runs
    // first, measures that), so 'spatial open' is the stacks' own cold start.
    await page.click('#view-3d');
    await page.waitForFunction(() => window.__cwFloat?.built && !document.getElementById('float-host').hidden, null, { timeout: 60000 });
    const t3d = Date.now();
    result.rows.push(await measure(page, cdp, 'spatial open', async () => {
      await page.locator('.float-arrange label:has(input[value=stacks])').click();
      await page.waitForFunction(() => window.__cwSpatial?.built && !document.getElementById('sp-host').hidden, null, { timeout: 60000 });
    }, { settle: 300 }));
    await page.evaluate(SPATIAL_HOOKS);
    const load = await waitAtlas(page);
    load.wallMs = Date.now() - t3d;
    console.log(`  spatial atlas: ${load.resident}/${load.count} resident (${load.far} far, ${load.near} near, ${load.failed} failed), ${load.drawn} tiles drawn in ${load.ms}ms · ${load.uploads} texture uploads = ${round(load.uploadMB, 0)}MB · ${load.renders} renders ${round(load.renderMs, 0)}ms · atlas ${load.atlasMB}MB · ${load.live} DOM cards${load.timedOut ? ' (timed out)' : ''}`);
    result.rows.push({ name: 'spatial atlas load', ...load });
    // ---- spatial: idle --------------------------------------------------
    await page.evaluate(SPATIAL_RESET);
    const idle = await measure(page, cdp, 'spatial idle 2s', async () => { await page.waitForTimeout(2000); }, { settle: 0 });
    Object.assign(idle, { spatial: await page.evaluate(SPATIAL_STATE) });
    console.log(`    idle: ${idle.spatial.renders} renders in 2s, ${round(idle.spatial.renderMs, 0)}ms render, ${idle.spatial.calls} draw calls/frame`);
    result.rows.push(idle);
    // ---- spatial: pan and zoom -------------------------------------------
    const sc = await stageCentre(page);
    await page.mouse.move(sc.x, sc.y);
    await page.evaluate(SPATIAL_RESET);
    const pan = await measure(page, cdp, 'spatial pan (60 ticks)', async () => {
      for (let i = 0; i < 60; i++) { await page.mouse.wheel(i < 30 ? 12 : -12, i < 30 ? 8 : -8); await page.waitForTimeout(16); }
    });
    pan.spatial = await page.evaluate(SPATIAL_STATE);
    result.rows.push(pan);
    await page.evaluate(SPATIAL_RESET);
    const zoom = await measure(page, cdp, 'spatial zoom in/out', async () => {
      await page.keyboard.down('Control');
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -30); await page.waitForTimeout(16); }
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 30); await page.waitForTimeout(16); }
      await page.keyboard.up('Control');
    }, { settle: 700 });
    zoom.spatial = await page.evaluate(SPATIAL_STATE);
    result.rows.push(zoom);
    // ---- spatial: filter ------------------------------------------------
    const chip = page.locator('#rail .chip[data-facet]').first();
    const chipLabel = await chip.getAttribute('data-value');
    await page.evaluate(SPATIAL_RESET);
    const tf = Date.now();
    const filt = await measure(page, cdp, `spatial filter on (${chipLabel})`, async () => { await chip.click(); }, { settle: 300 });
    await page.evaluate(SPATIAL_HOOKS);
    const reload = await waitAtlas(page);
    filt.reload = { ...reload, wallMs: Date.now() - tf };
    console.log(`    filter: field ${reload.count} · ${reload.drawn} tiles drawn, resident again in ${reload.ms}ms · ${reload.uploads} uploads = ${round(reload.uploadMB, 0)}MB`);
    result.rows.push(filt);
    const tu = Date.now();
    const unf = await measure(page, cdp, 'spatial filter off', async () => { await chip.click(); }, { settle: 300 });
    await page.evaluate(SPATIAL_HOOKS);
    const reload2 = await waitAtlas(page);
    unf.reload = { ...reload2, wallMs: Date.now() - tu };
    console.log(`    unfilter: field ${reload2.count} · ${reload2.drawn} tiles drawn, resident again in ${reload2.ms}ms · ${reload2.uploads} uploads = ${round(reload2.uploadMB, 0)}MB`);
    result.rows.push(unf);
    await page.click('#view-3d'); await page.waitForTimeout(300);
  }

  // Leak check: what survives a forced GC is retained, not merely unswept.
  // Compare with the same reading taken right after boot.
  const end = await metrics(cdp);
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(200);
  const gc = await metrics(cdp);
  result.final = { nodes: end.Nodes, heapMB: round(end.JSHeapUsedSize / 1048576), documents: end.Documents, listeners: end.JSEventListeners,
    afterGC: { nodes: gc.Nodes, heapMB: round(gc.JSHeapUsedSize / 1048576), listeners: gc.JSEventListeners, documents: gc.Documents },
    afterBootGC: result.bootGC };
  result.errors = errors;
  console.log(`  end: ${result.final.nodes} nodes · heap ${result.final.heapMB}MB · ${result.final.listeners} listeners · ${errors.length} page errors`);
  console.log(`  retained after GC: ${gc.Nodes} nodes · heap ${round(gc.JSHeapUsedSize / 1048576)}MB · ${gc.JSEventListeners} listeners (after boot GC: ${result.bootGC.nodes} · ${result.bootGC.heapMB}MB · ${result.bootGC.listeners})`);
  for (const e of errors.slice(0, 5)) console.log(`    ! ${e}`);

  await mkdir(OUT, { recursive: true });
  const file = path.join(OUT, `${new Date().toISOString().replace(/[:.]/g, '-')}-${LABEL}${RUNS > 1 ? `-r${runIndex + 1}` : ''}.json`);
  await writeFile(file, JSON.stringify(result, null, 2));
  console.log(`  → ${file}`);
  await context.close();
  return result;
}

/* ------------------------------------------------------- summary + budgets --- */

/** Scenario identity across runs and corpora: facet values in names are ignored. */
export const scenarioKey = name => name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/→ \S+/, '→').replace(/\s+/g, ' ').trim();

/** Headline metrics per row, flattened so a budget can name any of them. */
function headline(row) {
  const out = {};
  const put = (k, v) => { if (Number.isFinite(v)) out[k] = v; };
  put('scriptMs', row.scriptMs); put('layoutMs', row.layoutMs); put('restyleMs', row.restyleMs);
  put('framesP95', row.frames?.p95); put('framesMax', row.frames?.max); put('framesOver33', row.frames?.over33);
  put('longestTaskMs', row.longestTaskMs); put('inpMs', row.inpMs); put('inputBlockMs', row.inputBlockMs);
  put('loafBlockingMs', row.app?.loaf?.blockingMs);
  put('readyMs', row.readyMs); put('imagesMs', row.images?.ms); put('fcpMs', row.paint?.['first-contentful-paint']);
  put('renders', row.spatial?.renders); put('residentMs', row.reload?.ms ?? (row.name === 'spatial atlas load' ? row.ms : undefined));
  put('heapMB', row.heapMB); put('nodes', row.nodes); put('listeners', row.listeners);
  return out;
}

function summarise(runs) {
  const by = new Map();
  for (const run of runs) for (const row of run.rows) {
    const k = scenarioKey(row.name);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(headline(row));
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const out = {};
  for (const [k, list] of by) {
    out[k] = {};
    for (const metric of new Set(list.flatMap(Object.keys))) {
      const vals = list.map(h => h[metric]).filter(Number.isFinite);
      out[k][metric] = { median: round(med(vals)), min: round(Math.min(...vals)), max: round(Math.max(...vals)), n: vals.length };
    }
  }
  return out;
}

/**
 * Budgets name a scenario key and a ceiling per metric. Frame-time budgets
 * mean nothing under SwiftShader, so `headedOnly` budgets are skipped (and
 * reported as skipped) on a headless run rather than passed or failed.
 */
async function check(summary) {
  let budgets;
  try { budgets = JSON.parse(await readFile(BUDGETS, 'utf8')); }
  catch (err) { console.error(`budgets: cannot read ${BUDGETS}: ${err.message}`); return { ok: false, rows: [] }; }
  const rows = []; let notRun = 0;
  for (const [scenario, spec] of Object.entries(budgets.scenarios || {})) {
    const got = summary[scenario];
    if (!got) { notRun++; continue; }
    for (const [metric, rule] of Object.entries(spec)) {
      if (metric.startsWith('_')) continue;   // comments
      const max = typeof rule === 'number' ? rule : rule.max;
      const headedOnly = typeof rule === 'object' && rule.headedOnly;
      if (headedOnly && !HEADED) { rows.push({ scenario, metric, max, status: 'skip (headless)' }); continue; }
      const v = got?.[metric]?.median;
      if (v == null) { rows.push({ scenario, metric, max, status: 'missing' }); continue; }
      rows.push({ scenario, metric, max, value: v, status: v <= max ? 'pass' : 'FAIL' });
    }
  }
  const ok = rows.every(r => r.status !== 'FAIL');
  console.log(`\nbudgets (${path.basename(BUDGETS)}, median of ${RUNS} run${RUNS > 1 ? 's' : ''}):`);
  for (const r of rows) console.log(`  ${r.status.padEnd(15)} ${r.scenario.padEnd(28)} ${r.metric.padEnd(15)} ${String(r.value ?? '—').padStart(8)} ≤ ${r.max}`);
  const failed = rows.filter(r => r.status === 'FAIL').length, passed = rows.filter(r => r.status === 'pass').length;
  console.log(`  ${passed} pass · ${failed} fail · ${rows.length - passed - failed} skipped or missing · ${notRun} budgeted scenarios not in this run`);
  return { ok, rows };
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED, channel: CHROME ? 'chrome' : undefined });
  const runs = [];
  try { for (let i = 0; i < RUNS; i++) runs.push(await runOnce(browser, i)); }
  finally { await browser.close(); }
  for (const r of runs) if (r.final?.afterGC && r.bootGC) r.rows.push({ name: 'session retained',
    nodes: r.final.afterGC.nodes - r.bootGC.nodes, heapMB: round(r.final.afterGC.heapMB - r.bootGC.heapMB),
    listeners: r.final.afterGC.listeners - r.bootGC.listeners });
  const summary = summarise(runs);
  const report = { label: LABEL, url: URL_, when: new Date().toISOString(), headed: HEADED, chrome: CHROME, warm: WARM, viewport: VIEWPORT, dpr: DPR,
    runs: RUNS, errors: runs.flatMap(r => r.errors), summary };
  if (CHECK) report.budgets = await check(summary);
  if (RUNS > 1 || CHECK) {
    const file = path.join(OUT, `${new Date().toISOString().replace(/[:.]/g, '-')}-${LABEL}-summary.json`);
    await writeFile(file, JSON.stringify(report, null, 2));
    console.log(`  → ${file}`);
  }
  if (CHECK && !report.budgets.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(err => { console.error(err); process.exit(1); });
