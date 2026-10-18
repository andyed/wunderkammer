#!/usr/bin/env node
/**
 * wunderkammer server — serves the wall and the vault's media on localhost.
 *
 * Exists only because a page loaded from file:// cannot read a vault folder.
 * It is read-only and binds to the loopback interface: the vault is edited in
 * Obsidian, never through here.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns';
import { promisify } from 'node:util';
import { createPermalinkHandler, instanceIdentity, digest } from './lib/permalinks.mjs';
import { canonical } from './wall/permalink.mjs';
import { buildFacets } from './wall/facet-counts.mjs';
import { createViewStateHandler } from './lib/view-state.mjs';
import { loadInstanceConfig } from './lib/instance-config.mjs';
import { suppressClips } from './lib/suppress.mjs';
import { dedupeClips } from './lib/dedupe.mjs';
import { internSheets } from './lib/sheets.mjs';

const dnsLookup = promisify(lookup);

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** View state lives beside the config, not in the vault — it annotates the
 *  corpus rather than belonging to it. */
const { config, file: configFile } = await loadInstanceConfig(path.join(HERE, 'wunderkammer.config.json'));
const handleViewState = createViewStateHandler(config.viewStatePath);
const corpusId = await instanceIdentity(config.viewStatePath + '.instance-id', config.corpusId);
const handlePermalink = createPermalinkHandler(config.viewStatePath + '.permalinks');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm'
};


// Several corpora can share one wall. `adapters: []` is the current form;
// a bare `adapter:` string still works so existing configs keep running.
const adapterNames = Array.isArray(config.adapters) && config.adapters.length
  ? config.adapters
  : [config.adapter].filter(Boolean);
const adapters = await Promise.all(
  adapterNames.map(async (name) => ({ name, mod: await import(`./adapters/${name}.mjs`) }))
);
// Media routes resolve against the FIRST adapter that claims a local root.
// Adapters serving remote URLs (interests) return null and own no route.
const localMediaAdapter = adapters.find((a) => a.mod.mediaRoot?.(config));

/**
 * Load every adapter and stamp each clip with the corpus it came from, so a
 * curated competitive vault stays distinguishable from a harvested reading
 * corpus instead of being silently blended into it.
 */
async function loadAllClips() {
  const all = [];
  for (const { name, mod } of adapters) {
    let clips = [];
    try {
      clips = await mod.loadClips(config);
    } catch (err) {
      // One unreadable corpus must not blank the whole wall.
      console.error(`adapter ${name} failed: ${err.message}`);
      continue;
    }
    for (const c of clips) {
      c.props = { corpus: name === 'interests' ? 'read' : 'curated', ...(c.props || {}) };
      all.push(c);
    }
  }
  return dedupeClips(suppressClips(all, config), config);
}

/**
 * Resolve a URL path inside a root, refusing anything that escapes it.
 * Returns null rather than throwing so callers answer 403 uniformly.
 */
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const abs = path.resolve(root, decoded);
  const bounded = path.resolve(root) + path.sep;
  return abs.startsWith(bounded) ? abs : null;
}

/** Derived media is named by content hash, so its bytes can never go stale. */
const CONTENT_ADDRESSED = /^[0-9a-f]{64}\.[a-z0-9]+$/i;

async function sendFile(res, abs, { stream = false, req = null } = {}) {
  let info;
  try {
    info = await stat(abs);
  } catch {
    return send(res, 404, 'not found');
  }
  if (!info.isFile()) return send(res, 404, 'not found');

  // Validators, so a reload revalidates instead of re-downloading. Without
  // them `no-cache` meant every cover came back down the wire on every load:
  // 1,800 thumbnails for the music atlas, none of which had changed.
  const mtime = Math.floor(info.mtimeMs);
  const etag = `W/"${info.size.toString(16)}-${mtime.toString(16)}"`;
  const since = Date.parse(req?.headers['if-modified-since'] || '');
  const tags = req?.headers['if-none-match'];
  // RFC 9110: If-None-Match takes precedence over the less precise date,
  // and GET/HEAD validators use weak comparison (including lists and '*').
  const fresh = ['GET', 'HEAD'].includes(req?.method) && (tags !== undefined
    ? tags.split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.slice(2))
    : Number.isFinite(since) && since >= mtime - mtime % 1000);
  const headers = {
    'etag': etag,
    'last-modified': new Date(mtime).toUTCString(),
    // The vault changes under the wall constantly; a cached tile is a stale
    // tile — so vault files must revalidate. Content-addressed derivatives
    // cannot change without changing their name, and are cached outright.
    'cache-control': CONTENT_ADDRESSED.test(path.basename(abs)) ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (fresh) { res.writeHead(304, headers); return res.end(); }

  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { ...headers, 'content-type': type, 'content-length': info.size });
  if (stream) {
    const file = createReadStream(abs);
    // A disconnected share or cancelled original preview must not kill the server.
    file.on('error', () => res.destroy());
    res.on('close', () => file.destroy());
    file.pipe(res);
  } else res.end(await readFile(abs));
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(body);
}

/**
 * Send a large text body compressed when the client accepts it. The clip index
 * is repetitive JSON — the music atlas's 3.8 MB shrinks to about 0.5 MB — and
 * it is fetched on every load, so the cost of compressing it once per request
 * (~30 ms) is repaid before the first tile draws.
 */
function sendCompressed(req, res, body, type, extra = {}) {
  const accept = String(req.headers['accept-encoding'] || '');
  const headers = { 'content-type': type, 'cache-control': 'no-cache', 'vary': 'accept-encoding', ...extra };
  const weights = new Map();
  for (const entry of accept.toLowerCase().split(',')) {
    const [coding, ...params] = entry.trim().split(';');
    if (!coding) continue;
    const weight = params.map(p => p.trim()).find(p => p.startsWith('q='));
    const q = weight === undefined ? 1 : Number(weight.slice(2));
    weights.set(coding.trim(), Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0);
  }
  const quality = coding => weights.get(coding) ?? weights.get('*') ?? 0;
  const encoding = ['br', 'gzip'].sort((a, b) => quality(b) - quality(a))[0];
  const encodedQuality = quality(encoding);
  const identityQuality = weights.get('identity') ?? (weights.get('*') === 0 ? 0 : 1);
  const compress = encodedQuality > 0 && (!weights.has('identity') || encodedQuality >= identityQuality);
  if (!compress && identityQuality === 0) {
    res.writeHead(406, { ...headers, 'content-length': 0 });
    return res.end();
  }
  if (compress && encoding === 'br') {
    const out = brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(body) } });
    res.writeHead(200, { ...headers, 'content-encoding': 'br', 'content-length': out.length });
    return res.end(out);
  }
  if (compress && encoding === 'gzip') {
    const out = gzipSync(body, { level: 6 });
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': out.length });
    return res.end(out);
  }
  res.writeHead(200, { ...headers, 'content-length': Buffer.byteLength(body) });
  return res.end(body);
}

/** Reject anything that is not a public, routable host. */
async function assertPublicHost(hostname) {
  const { address } = await dnsLookup(hostname).catch(() => ({ address: null }));
  if (!address) throw Object.assign(new Error('cannot resolve host'), { status: 400 });
  const priv = [
    /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
  ];
  if (priv.some((re) => re.test(address))) {
    throw Object.assign(new Error('private address'), { status: 403 });
  }
  const v6 = address.toLowerCase();
  if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) {
    throw Object.assign(new Error('private address'), { status: 403 });
  }
}

const PROXY_MAX_BYTES = 12 << 20;

/** Fetch a remote image, re-validating the host at every redirect hop. */
async function fetchImage(target, hops = 3) {
  let current = target;
  for (let i = 0; i <= hops; i++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      throw Object.assign(new Error('bad url'), { status: 400 });
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw Object.assign(new Error('scheme not allowed'), { status: 400 });
    }
    // Checked on EVERY hop: a public host that 302s to 127.0.0.1 would
    // otherwise walk straight past a check done only on the first URL.
    await assertPublicHost(u.hostname);

    const r = await fetch(u, { redirect: 'manual', headers: { accept: 'image/*' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = new URL(r.headers.get('location'), u).toString();
      continue;
    }
    if (!r.ok) throw Object.assign(new Error(`upstream ${r.status}`), { status: 502 });

    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\//.test(type)) {
      throw Object.assign(new Error(`not an image (${type || 'unknown'})`), { status: 415 });
    }
    const declared = Number(r.headers.get('content-length') || 0);
    if (declared > PROXY_MAX_BYTES) {
      throw Object.assign(new Error('too large'), { status: 413 });
    }
    const body = Buffer.from(await r.arrayBuffer());
    // Re-checked after reading: content-length is a claim, not a guarantee.
    if (body.length > PROXY_MAX_BYTES) {
      throw Object.assign(new Error('too large'), { status: 413 });
    }
    return { body, type };
  }
  throw Object.assign(new Error('too many redirects'), { status: 502 });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    if (p === '/' || p === '/index.html') {
      return sendFile(res, path.join(HERE, 'index.html'), { req });
    }

    if (p === '/api/clips') {
      const clips = await loadAllClips();
      // The revision names the corpus a permalink was made against. Sheet
      // slots are a delivery detail that a rebake changes, so they stay out of
      // it: rebaking must not make every saved link report a changed corpus.
      const revision = digest(canonical(clips.map(({ sheetSlots, ...clip }) => clip)));
      const sheets = internSheets(clips);
      const payload = {
        clips,
        corpus: { id: corpusId, revision },
        // Baked overview pages (scripts/sheets.py); clips index into this list.
        ...(sheets.length ? { sheets } : {}),
        facets: buildFacets(clips),
        vault: config.vault,
        adapters: adapterNames,
        ui: config.ui || {},
      };
      // The index is no-cache because the vault changes under the wall, but
      // without a validator "revalidate" meant "download again": 0.5 MB of
      // brotli and a 3.7 MB parse on every boot of the Music Atlas, cold or
      // warm (measured 2026-10-13). The ETag hashes everything except the
      // timestamp, so an unchanged corpus answers 304 and skips compression.
      // Weak, because the bytes differ per content-encoding.
      const body = JSON.stringify(payload);
      const etag = `W/"${digest(body).slice(0, 32)}"`;
      const match = String(req.headers['if-none-match'] || '').split(',').map(t => t.trim());
      if (match.includes(etag) || match.includes(etag.slice(2))) {
        res.writeHead(304, { etag, 'cache-control': 'no-cache', vary: 'accept-encoding' });
        return res.end();
      }
      return sendCompressed(req, res, JSON.stringify({ ...payload, generated: new Date().toISOString() }), MIME['.json'], { etag });
    }

    // View state — pile membership and layout choices.
    //
    // Mutable view state and immutable permalink snapshots are deliberately not writes
    // to the corpus. Piles are an annotation OVER the clips, not a property of
    // any clip, which is what lets several views hold different piles over the
    // same notes. Both view stores live beside the config; neither modifies
    // notes or captured media.
    //
    // Keyed by clip URL, not clip id — ids are filenames and titles, and those
    // get renamed. See keyOfClip() in wall/spatial/spatial-view.mjs.
    if (p === '/api/permalinks' || p.startsWith('/api/permalinks/')) {
      return handlePermalink(req, res, p.split('/')[3]);
    }
    if (p === '/api/view-state') {
      return handleViewState(req, res);
    }

    // Same-origin proxy for remote hero images.
    //
    // Not a convenience. A texture atlas is a canvas, and drawing a
    // cross-origin image into a canvas requires the publisher to send CORS
    // headers — so the loader must request crossOrigin="anonymous", and every
    // publisher that does not send Access-Control-Allow-Origin fails. Measured
    // on this corpus: a plain <img> loads 90% of harvested heroes, the same
    // URLs with crossOrigin load 63%. 27% are lost to CORS alone, and they are
    // lost SILENTLY — the tile is simply blank.
    //
    // Serving them from here makes them same-origin, which sidesteps CORS
    // entirely. It also stops the browser leaking a referrer to each publisher
    // on every render, which the README lists as a real cost of harvesting.
    //
    // This is still a fetch of an arbitrary URL on behalf of a page, so it is
    // deliberately narrow: http/https only, no private address space, image
    // content types only, capped size, redirects re-validated at every hop.
    if (p === '/api/proxy') {
      const target = url.searchParams.get('url') || '';
      try {
        const buf = await fetchImage(target);
        res.writeHead(200, {
          'content-type': buf.type,
          'content-length': buf.body.length,
          // Long cache: these are archival excerpts, and re-fetching a remote
          // hero on every reload is both slow and rude to the publisher.
          'cache-control': 'public, max-age=86400',
        });
        return res.end(buf.body);
      } catch (err) {
        return send(res, err.status || 502, `proxy: ${err.message}`);
      }
    }

    if (p.startsWith('/original/')) {
      const imageAdapter = adapters.find(a => a.mod.originalPath);
      if (!imageAdapter) return send(res, 404, 'no image archive');
      const abs = await imageAdapter.mod.originalPath(config, p.slice('/original/'.length));
      if (!abs) return send(res, 403, 'forbidden');
      return sendFile(res, abs, { stream: true, req });
    }

    if (p.startsWith('/media/')) {
      if (!localMediaAdapter) return send(res, 404, 'no local media');
      const abs = safeJoin(localMediaAdapter.mod.mediaRoot(config), p.slice('/media/'.length));
      if (!abs) return send(res, 403, 'forbidden');
      return sendFile(res, abs, { stream: true, req });
    }

    if (p.startsWith('/wall/')) {
      const abs = safeJoin(path.join(HERE, 'wall'), p.slice('/wall/'.length));
      if (!abs) return send(res, 403, 'forbidden');
      return sendFile(res, abs, { req });
    }

    return send(res, 404, 'not found');
  } catch (err) {
    return send(res, 500, `error: ${err.message}`);
  }
});

const port = Number(process.env.PORT) || config.port || 4173;
server.listen(port, '127.0.0.1', () => {
  console.log(`wunderkammer → http://127.0.0.1:${port}`);
  console.log(`corpora  → ${adapterNames.join(' + ')}`);
  console.log(`config   → ${configFile}`);
});
