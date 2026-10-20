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
 * the tool sets view=warehouse. --walk walks on down the aisle for that many
 * seconds once the lights are down; --hold keeps the last frame. The aisle's
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
  [--walk <seconds>] [--hold <seconds>] [--labels] [--out warehouse.mp4] [--timeout 60000]`;
/** World units a second for --walk, as the long reel's side scroll. */
const WALK_SPEED = 4.5;

class VideoError extends Error {}
const fail = message => { throw new VideoError(message); };

function options(argv) {
  const { values } = parseArgs({ args: argv, options: {
    collection: { type: 'string' }, view: { type: 'string', default: '' }, size: { type: 'string', default: '1920x1080' },
    fps: { type: 'string', default: '30' }, walk: { type: 'string', default: '0' }, hold: { type: 'string', default: '1' },
    out: { type: 'string', default: 'warehouse.mp4' }, timeout: { type: 'string', default: '60000' }, labels: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  if (!values.collection) fail(`--collection is required\n${USAGE}`);
  const size = /^(\d{2,5})x(\d{2,5})$/.exec(values.size);
  if (!size || size[1] % 2 || size[2] % 2) fail(`--size must be WIDTHxHEIGHT with even numbers, e.g. 1920x1080 (got ${values.size})`);
  const fps = Number(values.fps), walk = Number(values.walk), hold = Number(values.hold), timeout = Number(values.timeout);
  if (![24, 25, 30, 50, 60].includes(fps)) fail(`--fps must be 24, 25, 30, 50 or 60 (got ${values.fps})`);
  if (!(walk >= 0 && walk <= 30)) fail(`--walk is seconds, 0 to 30 (got ${values.walk})`);
  if (!(hold >= 0 && hold <= 10)) fail(`--hold is seconds, 0 to 10 (got ${values.hold})`);
  if (!(timeout >= 1000)) fail(`--timeout is in milliseconds, at least 1000 (got ${values.timeout})`);
  if (path.extname(values.out).toLowerCase() !== '.mp4') fail(`--out must end in .mp4 (got ${values.out})`);
  const view = new URLSearchParams(values.view.replace(/^\?/, ''));
  for (const key of ['view', 'collection', 'chrome', 'figure']) if (view.has(key)) fail(`--view may not set ${key}; the tool sets it`);
  return { ...values, width: Number(size[1]), height: Number(size[2]), fps, walk, hold, timeout, viewKeys: view };
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
    if (walkFrames) {
      const span = await page.evaluate(() => { const a = window.__cwAisle; return { from: a.travel, length: a.art.travelSpan().length }; });
      const to = span.length > 0 ? Math.min(1, span.from + WALK_SPEED * opts.walk / span.length) : span.from;
      for (let i = 1; i <= walkFrames; i++) {
        const travel = span.from + (to - span.from) * cubicInOut(i / walkFrames);
        await shoot(new Function(`const a = window.__cwAisle; a.travel = ${travel}; a.slider.value = String(${travel}); a.fitted = true; a.applyPose(); return a.renderCount || 0;`));
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
      shot: { show: TIMING.end, walk: opts.walk, hold: opts.hold, labels: opts.labels, caption: shown.show.caption, rows: shown.show.rows, lanes: shown.show.lanes },
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
