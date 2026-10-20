#!/usr/bin/env node
/**
 * The image warehouse as a video: "Cats. Lots of cats." Rows of a
 * collection's racks rush out of a white void, the camera drops into the
 * aisle, and the lights go down on the aisle the wall opens to. The same
 * frames ?view=warehouse plays live (wall/warehouse.mjs), seeked one at a
 * time, so no frame is dropped however slow the machine.
 *
 *   node scripts/warehouse-video.mjs --collection cats.collection.json \
 *     --view 'group=decade' --size 1920x1080 --fps 30 --walk 3 --out cats-warehouse.mp4
 *
 * --view takes a live link's keys (group, q, facet.<key>, sort, spread, ...);
 * the tool sets view=warehouse. --walk turns to the left wall once the lights
 * are down and slides along it for that many seconds. --tour, instead, pans
 * over every cover: along the left wall to the far end, round, and back along
 * the right; 30 seconds suits a pet's 150 photos. --hold keeps the last frame. The aisle's
 * rack labels, which come up with the lights, are left out unless --labels. The sidecar
 * JSON beside the video records what it shows and the exact link of its last
 * frame, which opens the wall right there to browse.
 *
 * Needs Playwright (a dev dependency) and ffmpeg on the PATH. It fails, writing
 * nothing, when the collection or the link is refused, the page throws, or the
 * warehouse does not play (no WebGL, an empty scope).
 */
import { mkdtemp, rm, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './still.mjs';
import { TIMING, cubicInOut } from '../wall/warehouse.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const USAGE = `usage: node scripts/warehouse-video.mjs --collection <file or URL> [--view '<link keys>'] [--size 1920x1080] [--fps 30]
  [--walk <seconds> | --tour <seconds>] [--hold <seconds>] [--labels] [--out warehouse.mp4] [--timeout 60000]`;
/** --walk, as the long reel's side scroll: world units a second, the furthest travel (0..1) and the turn toward the left wall. */
const WALK_SPEED = 4.5, WALK_END = .7, WALK_TURN = 55 * Math.PI / 180;
/** --tour: the fastest it glides past a wall (world units a second), the turn toward each wall, the spread it widens
 * to, and how far across the aisle from the wall it faces the camera stands (world units past the centre). */
const TOUR_SPEED = 2.5, TOUR_TURN = 72 * Math.PI / 180, TOUR_SPREAD = 1, TOUR_STAND = 1;
const clamp01 = x => Math.min(1, Math.max(0, x));
const ease = (x, a, b) => cubicInOut(clamp01((x - a) / (b - a)));
/** 0..1 with a gentle start and stop and a steady speed between, so covers pass at an even pace. */
export function cruise(x, ramp = .15) {
  const t = clamp01(x), v = 1 / (1 - ramp);
  if (t < ramp) return v * t * t / (2 * ramp);
  if (t > 1 - ramp) return 1 - v * (1 - t) ** 2 / (2 * ramp);
  return v * (t - ramp / 2);
}

/**
 * --walk: how far down the aisle it goes. Its pace is WALK_SPEED, but never past
 * WALK_END of the aisle's travel: a short aisle is walked more slowly instead,
 * so the walk ends among the racks, not facing the dark past the last one.
 * `from` and the result are travel (0..1); `length` is travel's span in world units.
 */
export function walkEnd({ from, length, seconds }) {
  if (!(length > 0)) return from;
  return Math.max(from, Math.min(WALK_END, from + WALK_SPEED * seconds / length));
}
/** The walk at k (0..1): travel, and the turn toward the left wall, which comes in over its first 40%. */
export function walkAt(k, { from, to }) {
  return { travel: from + (to - from) * cubicInOut(clamp01(k)), turn: WALK_TURN * cubicInOut(Math.min(1, clamp01(k) / .4)) };
}
/**
 * --tour at k (0..1): out along the left wall from `near` to as far as `reach`
 * goes (never past `farZ`), round through a look back down the hall, and back
 * to `near`. From the camera's `entry` z over the first 10%. z is world units
 * down the hall (negative is deeper); turn is radians from looking down it,
 * positive toward the left wall; side is which side of the centre it stands on.
 */
export function tourAt(k, { near, farZ, entry, spread, seconds }) {
  const reach = Math.min(near - farZ, TOUR_SPEED * .47 * seconds);
  const along = k < .5 ? cruise(k / .47) : 1 - cruise((k - .55) / .45);
  return {
    z: near - reach * along + (entry - near) * (1 - ease(k, 0, .1)),
    turn: TOUR_TURN * ease(k, 0, .1) + (2 * Math.PI - 2 * TOUR_TURN) * ease(k, .45, .57),
    side: ease(k, 0, .1) - 2 * ease(k, .45, .57),
    spread: spread + (TOUR_SPREAD - spread) * ease(k, 0, .1),
  };
}

class VideoError extends Error {}
const fail = message => { throw new VideoError(message); };

function options(argv) {
  const { values } = parseArgs({ args: argv, options: {
    collection: { type: 'string' }, view: { type: 'string', default: '' }, size: { type: 'string', default: '1920x1080' },
    fps: { type: 'string', default: '30' }, walk: { type: 'string', default: '0' }, tour: { type: 'string', default: '0' }, hold: { type: 'string', default: '1' },
    out: { type: 'string', default: 'warehouse.mp4' }, timeout: { type: 'string', default: '60000' }, labels: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  if (!values.collection) fail(`--collection is required\n${USAGE}`);
  const size = /^(\d{2,5})x(\d{2,5})$/.exec(values.size);
  if (!size || size[1] % 2 || size[2] % 2) fail(`--size must be WIDTHxHEIGHT with even numbers, e.g. 1920x1080 (got ${values.size})`);
  const fps = Number(values.fps), walk = Number(values.walk), tour = Number(values.tour), hold = Number(values.hold), timeout = Number(values.timeout);
  if (![24, 25, 30, 50, 60].includes(fps)) fail(`--fps must be 24, 25, 30, 50 or 60 (got ${values.fps})`);
  if (!(walk >= 0 && walk <= 30)) fail(`--walk is seconds, 0 to 30 (got ${values.walk})`);
  if (!(tour >= 0 && tour <= 120)) fail(`--tour is seconds, 0 to 120 (got ${values.tour})`);
  if (walk && tour) fail('--walk and --tour are two endings; choose one');
  if (!(hold >= 0 && hold <= 10)) fail(`--hold is seconds, 0 to 10 (got ${values.hold})`);
  if (!(timeout >= 1000)) fail(`--timeout is in milliseconds, at least 1000 (got ${values.timeout})`);
  if (path.extname(values.out).toLowerCase() !== '.mp4') fail(`--out must end in .mp4 (got ${values.out})`);
  const view = new URLSearchParams(values.view.replace(/^\?/, ''));
  for (const key of ['view', 'collection', 'chrome', 'figure']) if (view.has(key)) fail(`--view may not set ${key}; the tool sets it`);
  return { ...values, width: Number(size[1]), height: Number(size[2]), fps, walk, tour, hold, timeout, viewKeys: view };
}

function pageUrl(origin, collection, viewKeys) {
  const url = new URL('/index.html', origin);
  url.searchParams.set('collection', /^https?:\/\//i.test(collection) ? collection : `/__collection/${encodeURIComponent(path.basename(collection))}`);
  url.searchParams.set('view', 'warehouse');
  for (const [key, value] of viewKeys) url.searchParams.append(key, value);
  // The stage alone (docs/SHOTS.md): no header, rail, toolbars or figure band.
  url.searchParams.set('chrome', 'none'); url.searchParams.set('figure', 'none');
  return url;
}

const revision = () => { try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const probe = file => { try { return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' })); } catch { return null; } };

export async function warehouseVideo(argv) {
  const opts = options(argv);
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { fail('scripts/warehouse-video.mjs needs ffmpeg on the PATH'); }
  const remote = /^https?:\/\//i.test(opts.collection);
  const collectionFile = remote ? null : path.resolve(opts.collection);
  if (collectionFile && !(await stat(collectionFile).catch(() => null))?.isFile()) fail(`No collection file at ${collectionFile}`);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { fail('scripts/warehouse-video.mjs needs Playwright: run npm install (it is a dev dependency) and npx playwright install chromium'); }
  const server = await serve(collectionFile && path.dirname(collectionFile));
  const url = pageUrl(`http://127.0.0.1:${server.address().port}`, opts.collection, opts.viewKeys);
  // WebGL on the GPU where there is one; headless Chromium elsewhere falls back to software, slower but the same frames.
  const browser = await chromium.launch({ args: platform() === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const frames = await mkdtemp(path.join(tmpdir(), 'warehouse-'));
  try {
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const threw = () => (errors.length ? ` (${errors.slice(0, 3).join(' | ')})` : '');
    await page.goto(url.href);
    await page.waitForFunction(() => document.body.dataset.viewReady === 'true' || /^Could not (load|reach)/.test(document.getElementById('empty')?.textContent.trim() || ''),
      null, { timeout: opts.timeout }).catch(() => fail(`The wall did not start within ${opts.timeout} ms${threw()}`));
    const refused = await page.evaluate(() => (document.body.dataset.viewReady === 'true' ? '' : document.getElementById('empty').textContent.trim()));
    if (refused) fail(`The collection was refused: ${refused}`);
    const notice = await page.evaluate(() => { const s = document.getElementById('link-status'); return s && !s.hidden ? document.getElementById('link-message').textContent.trim() : ''; });
    if (/^Could not/.test(notice)) fail(`The view was refused: ${notice}`);
    // The show starts itself; hold it, and seek every frame instead.
    const started = await page.waitForFunction(() => { const a = window.__cwAisle; return a?.show ? 'playing' : a?.lastShow?.reason || false; }, null, { timeout: opts.timeout })
      .then(h => h.jsonValue()).catch(() => fail(`The warehouse never started${threw()}`));
    if (started !== 'playing') fail(`The warehouse did not play: ${started === 'unavailable' ? 'the aisle has nothing to show or no WebGL' : started}`);
    await page.evaluate(() => window.__cwAisle.show.pause());
    if (!opts.labels) await page.addStyleTag({ content: '.aisle-labels { display: none !important; }' });
    await page.waitForFunction(() => window.__cwAisle.art.getDiagnostics().pendingArtwork === 0, null, { timeout: opts.timeout })
      .catch(() => fail(`The covers did not load within ${opts.timeout} ms`));
    const shown = await page.evaluate(() => { const a = window.__cwAisle, d = a.getDiagnostics(); return { show: d.warehouse, covers: { loaded: d.loadedArtwork, failed: d.failedArtwork, total: d.totalTiles } }; });

    let n = 0;
    const shoot = async step => {
      const before = await page.evaluate(step, null);
      await page.waitForFunction(b => (window.__cwAisle.renderCount || 0) > b, before, { timeout: 10000 }).catch(() => fail(`Frame ${n} never rendered${threw()}`));
      await page.screenshot({ path: path.join(frames, `${String(n++).padStart(5, '0')}.png`) });
    };
    const showFrames = Math.ceil(TIMING.end * opts.fps);
    for (let i = 0; i < showFrames; i++) await shoot(new Function(`const a = window.__cwAisle; a.show.seek(${i / opts.fps}); return a.renderCount || 0;`));
    // The lights fully down is the aisle itself, with nothing of the show left in it.
    await shoot(() => { const a = window.__cwAisle; a.show.finish('captured'); return a.renderCount || 0; });
    const walkFrames = Math.round(opts.walk * opts.fps);
    let walked = null;
    if (walkFrames) {
      // The long reel's side scroll: the camera turns toward the left wall and
      // slides along it, so even a short hall shows covers, not its dark far end.
      await page.evaluate(() => {
        window.__warehouseWalk = (travel, turn) => {
          const a = window.__cwAisle, pose = a.art.cameraPose(travel, a.camera.aspect);
          const [px, py, pz] = pose.position, [fx, fy, fz] = pose.target.map((v, i) => v - pose.position[i]);
          const c = Math.cos(turn), s = Math.sin(turn), position = [px + 1.2 * turn, py, pz];
          a.travel = travel; a.slider.value = String(travel); a.fitted = false;
          a.setCamera(position, [position[0] + fx * c + fz * s, position[1] + fy, position[2] - fx * s + fz * c]);
          return a.renderCount || 0;
        };
      });
      const span = await page.evaluate(() => { const a = window.__cwAisle; return { from: a.travel, length: a.art.travelSpan().length }; });
      const to = walkEnd({ from: span.from, length: span.length, seconds: opts.walk });
      walked = { from: span.from, to, capped: to < span.from + WALK_SPEED * opts.walk / Math.max(span.length, 1e-9) };
      for (let i = 1; i <= walkFrames; i++) {
        const { travel, turn } = walkAt(i / walkFrames, { from: span.from, to });
        await shoot(new Function(`return window.__warehouseWalk(${travel}, ${turn});`));
      }
    }
    const tourFrames = Math.round(opts.tour * opts.fps);
    if (tourFrames) {
      // Out along the left wall, round through a look back down the hall, and back
      // along the right. The camera faces each wall from a step past the aisle's
      // centre, at mid-height, so the wall fills the frame top to bottom; it
      // glides by the hall's own extent, so the first and last columns pass too.
      const hall = await page.evaluate(([stand]) => {
        const a = window.__cwAisle, shown = a.art.racks.filter(rack => rack.group.visible);
        const end = shown.length ? shown.at(-1).start + shown.at(-1).length : a.art.totalDepth;
        const from = shown[0]?.start || 0, y = a.art.cameraPose(0, a.camera.aspect).position[1];
        window.__warehouseTour = (z, turn, side, spread) => {
          if (a.spread !== spread) { a.spread = spread; a.art.setPresentation({ spread }); }
          const { start, length } = a.art.travelSpan();
          const travel = length > 0 ? Math.min(1, Math.max(0, (3.9 - start - z) / length)) : 0;
          a.travel = travel; a.slider.value = String(travel); a.fitted = false;
          // Down the hall is -z; a positive turn swings toward the left wall (-x).
          a.setCamera([side * stand, y, z], [side * stand - 10 * Math.sin(turn), y, z - 10 * Math.cos(turn)]);
          return a.renderCount || 0;
        };
        return { spread: a.spread, near: 2 - from, farZ: -end + 2.5 };
      }, [TOUR_STAND]);
      // A long hall is toured as far as a steady glide reaches; a short one, end to end.
      const path = { near: hall.near, farZ: hall.farZ, spread: hall.spread, seconds: opts.tour, entry: await page.evaluate(() => window.__cwAisle.camera.position.z) };
      for (let i = 1; i <= tourFrames; i++) {
        const { z, turn, side, spread } = tourAt(i / tourFrames, path);
        await shoot(new Function(`return window.__warehouseTour(${z}, ${turn}, ${side}, ${spread});`));
      }
    }
    if (errors.length) fail(`The page threw: ${errors.join(' | ')}`);
    const last = path.join(frames, `${String(n - 1).padStart(5, '0')}.png`);
    for (let i = 0; i < Math.round(opts.hold * opts.fps); i++) await copyFile(last, path.join(frames, `${String(n++).padStart(5, '0')}.png`));
    // The exact link the page wrote for its last frame: it opens the wall there, to browse.
    await page.waitForTimeout(500);
    const link = await page.evaluate(() => (/[#&]s=/.test(location.hash) ? location.href : null));
    const exported = await page.evaluate(() => window.wunderkammer.export());

    const out = path.resolve(opts.out);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(opts.fps), '-i', path.join(frames, '%05d.png'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { stdio: 'inherit' });
    const probed = probe(out);
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const sidecar = out.replace(/\.mp4$/i, '.json');
    const record = {
      format: 'wunderkammer.warehouse-video', version: 1,
      video: { file: path.basename(out), width: opts.width, height: opts.height, fps: opts.fps, frames: n, seconds: Math.round(n / opts.fps * 1000) / 1000,
        probed: probed ? { frames: Number(probed.streams?.[0]?.nb_read_frames), seconds: Number(probed.format?.duration) } : null },
      shot: { show: TIMING.end, walk: opts.walk, walked, tour: opts.tour, hold: opts.hold, labels: opts.labels, caption: shown.show.caption, rows: shown.show.rows, lanes: shown.show.lanes },
      covers: shown.covers,
      collection: { source: opts.collection, corpus: exported.corpus },
      view: { requested: opts.view, link: link ? link.slice(link.indexOf('#')) : null },
      render: { wunderkammer: { version: pkg.version, commit: revision() }, browser: browser.version(), created: new Date().toISOString() },
    };
    await writeFile(sidecar, JSON.stringify(record, null, 2) + '\n');
    return { video: out, sidecar, record };
  } finally {
    await browser.close(); server.close();
    await rm(frames, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  warehouseVideo(process.argv.slice(2)).then(({ video, sidecar, record }) => {
    console.log(`${video}\n${sidecar}\n${record.video.frames} frames at ${record.video.fps} fps, ${record.video.seconds} s · ${record.shot.rows} racks in ${record.shot.lanes} lanes · "${record.shot.caption.join(' ')}"`);
  }, error => {
    console.error(error instanceof VideoError ? `warehouse-video: ${error.message}` : error);
    process.exit(1);
  });
}
