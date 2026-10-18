#!/usr/bin/env node
/**
 * clip — turn a URL into a vault note plus locally downloaded media.
 *
 *   node clip.mjs <url…> [--tags govee,game-room] [--shot] [--all-images]
 *
 * The point of downloading rather than hot-linking: a competitive corpus whose
 * images 404 when the source post is deleted is worthless six months later,
 * which is exactly when you want it. Media lands in the vault; the note is
 * plain Markdown that Obsidian can edit without knowing this tool exists.
 *
 * App Store and Google Play listings take the screenshots, description and
 * store numbers from Apple's lookup API or the Play details page instead of
 * the page's icon card (lib/appstore.mjs, lib/playstore.mjs).
 *
 * Fetched page content is DATA. Nothing in it is interpreted as an instruction;
 * it is only ever scraped for metadata and written to disk.
 */

import { mkdir, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { imageSize } from './lib/imagesize.mjs';
import { stringifyFrontmatter } from './lib/frontmatter.mjs';
import { findExistingClip, writeNewFile, storeMedia } from './lib/capture-store.mjs';
import { lookupApp } from './lib/appstore.mjs';
import { lookupPlay } from './lib/playstore.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const MIN_BYTES = 6 * 1024;   // below this it is a tracking pixel or a sprite
const MIN_EDGE = 200;         // below this it is an avatar or an icon
const MAX_IMAGES = 12;

function parseArgs(argv) {
  const opts = { urls: [], tags: [], shot: false, allImages: false, title: '', kind: '', note: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tags') opts.tags = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--title') opts.title = String(argv[++i] || '');
    else if (a === '--kind') opts.kind = String(argv[++i] || '');
    else if (a === '--note') opts.note = String(argv[++i] || '');
    else if (a === '--shot') opts.shot = true;
    else if (a === '--all-images') opts.allImages = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    else opts.urls.push(a);
  }
  return opts;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'clip';
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Pull a <meta> value by property or name, tolerating attribute order. */
function meta(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1].trim()) return decodeEntities(m[1].trim());
  }
  return '';
}

/**
 * Candidate images, hero-first, each tagged with HOW it was chosen.
 *
 * The priority ladder (og → twitter → largest in markup) matches
 * `findBestHeroImage()` in an earlier browser-extension tracker; keeping the
 * same ladder and the same `source` vocabulary means a clip and a browsing
 * capture can be compared rather than merely coexisting. Provenance is worth
 * recording because a `heuristic-largest` pick is materially less trustworthy
 * than a publisher-declared `meta-og` one — and since unknown frontmatter keys
 * become facets, it lands in the wall's filter rail for free.
 */
function extractImages(html, baseUrl, allImages) {
  const out = [];
  const seen = new Set();
  const push = (raw, source) => {
    if (!raw) return;
    try {
      const abs = new URL(decodeEntities(raw), baseUrl).href;
      if (/^https?:/.test(abs) && !seen.has(abs)) {
        seen.add(abs);
        out.push({ url: abs, source });
      }
    } catch { /* a malformed src is not worth aborting the clip over */ }
  };

  push(meta(html, 'og:image:secure_url'), 'meta-og');
  push(meta(html, 'og:image'), 'meta-og');
  push(meta(html, 'twitter:image'), 'meta-twitter');
  push(meta(html, 'twitter:image:src'), 'meta-twitter');
  const linkRel = html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i);
  if (linkRel) push(linkRel[1], 'link-image-src');

  if (allImages) {
    // srcset first — its largest candidate beats the src fallback.
    for (const m of html.matchAll(/<img[^>]*\ssrcset=["']([^"']+)["'][^>]*>/gi)) {
      const best = m[1].split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean).pop();
      push(best, 'heuristic-largest');
    }
    for (const m of html.matchAll(/<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi)) push(m[1], 'heuristic-largest');
  }
  return out.slice(0, MAX_IMAGES);
}

function extOf(contentType, url) {
  const ct = String(contentType || '').split(';')[0].trim();
  const byType = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg',
    'video/mp4': '.mp4', 'video/webm': '.webm'
  }[ct];
  if (byType) return byType;
  const m = String(url).match(/\.(jpe?g|png|gif|webp|avif|mp4|webm)(?:\?|$)/i);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '.bin';
}

async function fetchBuf(url, referer) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*', ...(referer ? { referer } : {}) },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
}

/**
 * Download one image into the vault. Content-addressed by its bytes so
 * a changed image at an old URL never overwrites another clip's evidence.
 */
async function saveMedia(url, dir, relDir, referer, source = 'unknown') {
  let got;
  try {
    got = await fetchBuf(url, referer);
  } catch (err) {
    return { skipped: `fetch failed (${err.message})`, url };
  }
  const { buf, type } = got;

  if (buf.length < MIN_BYTES) return { skipped: `too small (${buf.length}B)`, url };
  const dims = imageSize(buf);
  if (dims && (dims.w < MIN_EDGE || dims.h < MIN_EDGE)) {
    return { skipped: `too small (${dims.w}x${dims.h})`, url };
  }

  const rel = await storeMedia(buf, extOf(type, url), dir, relDir);
  return { rel, w: dims?.w || 0, h: dims?.h || 0, bytes: buf.length, source };
}

/** Rendered screenshot, only when playwright is present. Optional by design. */
async function screenshot(url, dir, relDir) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.warn('  --shot skipped: playwright not installed here (npm i -D playwright)');
    return null;
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const buf = await page.screenshot({ type: 'jpeg', quality: 82 });
    const rel = await storeMedia(buf, '.jpg', dir, relDir);
    const dims = imageSize(buf);
    return { rel, w: dims?.w || 0, h: dims?.h || 0 };
  } finally {
    await browser.close();
  }
}

export async function clipOne(url, opts, config) {
  console.log(`\n▸ ${url}`);
  const attachDir = path.join(config.vault, config.attachmentsDir);
  const clipsDir = path.join(config.vault, config.clipsDir);
  await mkdir(attachDir, { recursive: true });
  await mkdir(clipsDir, { recursive: true });

  const keepExisting = (file) => {
    console.log(`  → kept existing clip: ${path.relative(config.vault, file)} (notes and media unchanged)`);
    return file;
  };
  const existing = await findExistingClip(clipsDir, url);
  if (existing) return keepExisting(existing);

  const head = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  if (!head.ok) throw new Error(`HTTP ${head.status} fetching page`);
  const contentType = head.headers.get('content-type') || '';

  let title = opts.title;
  let description = '';
  let candidates = [];
  let kind = opts.kind || 'page';
  let storeFields = {};

  if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
    // The URL is the asset itself.
    candidates = [{ url, source: 'direct-url' }];
    kind = opts.kind || (contentType.startsWith('video/') ? 'video' : 'image');
    title = title || decodeURIComponent(url.split('/').pop().split('?')[0]);
  } else {
    const html = await head.text();
    title = title || meta(html, 'og:title') || decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
    description = meta(html, 'og:description') || meta(html, 'description');
    candidates = extractImages(html, url, opts.allImages);
    if (meta(html, 'og:video') || meta(html, 'og:type') === 'video.other') kind = opts.kind || 'video';
    else if (candidates.length) kind = opts.kind || 'image';

    // App Store and Google Play listings: the screenshots and store numbers are
    // the evidence; the og:image is only the icon. A failed lookup keeps the
    // page result above. Each lookup returns null at once for other URLs.
    const store = (await lookupApp(url)) || (await lookupPlay(url));
    if (store) {
      title = opts.title || store.title || title;
      description = store.description || description;
      if (store.shots.length) {
        const source = store.fields.platform === 'android' ? 'playstore-screenshot' : 'appstore-screenshot';
        candidates = store.shots.map((u) => ({ url: u, source }));
        kind = opts.kind || 'image';
      }
      storeFields = store.fields;
      console.log(`  ${store.fields.store} ${store.fields.appId}: ${store.shots.length} screenshots, ${store.fields.ratings ?? 'unknown'} ratings`);
    }
  }

  const id = `${slug(title || hostOf(url))}-${createHash('sha1').update(url).digest('hex').slice(0, 6)}`;
  const media = [];
  for (const c of candidates) {
    const r = await saveMedia(c.url, attachDir, config.attachmentsDir, url, c.source);
    if (r.rel) {
      media.push(r);
      console.log(`  ✓ ${r.rel} ${r.w}x${r.h} (${r.source})`);
    } else {
      console.log(`  – ${r.skipped}`);
    }
  }

  if (opts.shot) {
    // A screenshot is an enhancement, never a precondition. Letting a browser
    // launch failure throw would discard media that already downloaded and
    // leave no note at all — the worst outcome of the three.
    try {
      const s = await screenshot(url, attachDir, config.attachmentsDir);
      if (s) { media.push({ ...s, source: 'screenshot' }); console.log(`  ✓ ${s.rel} (screenshot)`); }
    } catch (err) {
      console.warn(`  ! screenshot failed, keeping the rest: ${String(err.message).split('\n')[0]}`);
    }
  }

  if (!media.length) console.warn('  ! no media captured — the note will be text-only');

  const note = stringifyFrontmatter(
    {
      title: title || url,
      url,
      source: hostOf(url),
      captured: new Date().toISOString().slice(0, 10),
      kind,
      tags: opts.tags,
      media: media.map((m) => m.rel),
      dims: media.map((m) => `${m.w}x${m.h}`),
      mediaSource: [...new Set(media.map((m) => m.source))],
      cover: media[0]?.rel || '',
      ...storeFields
    },
    `${opts.note || description || ''}\n`
  );

  const notePath = path.join(clipsDir, `${id}.md`);
  // Another capture may have finished while this one fetched its media.
  const concurrent = await findExistingClip(clipsDir, url);
  if (concurrent) return keepExisting(concurrent);
  try { await writeNewFile(notePath, note); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const prior = await findExistingClip(clipsDir, url);
    if (prior) return keepExisting(prior);
    throw new Error(`Note already exists; kept unchanged: ${notePath}`);
  }
  console.log(`  → ${path.relative(config.vault, notePath)}`);
  return notePath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.urls.length) {
    console.error('usage: node clip.mjs <url…> [--tags a,b] [--title "…"] [--kind image|video|page] [--note "…"] [--shot] [--all-images]');
    process.exit(1);
  }
  const config = JSON.parse(await readFile(new URL('./wunderkammer.config.json', import.meta.url), 'utf8'));

  let failed = 0;
  for (const url of opts.urls) {
    try {
      await clipOne(url, opts, config);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${url}: ${err.message}`);
    }
  }
  console.log(`\n${opts.urls.length - failed}/${opts.urls.length} processed (new or already captured).`);
  process.exit(failed && failed === opts.urls.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === await realpath(process.argv[1]).catch(() => null)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
