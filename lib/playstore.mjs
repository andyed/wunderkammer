/**
 * Google Play capture — the listing's own screenshots and store data, the
 * Android counterpart of lib/appstore.mjs.
 *
 * Play has no public lookup API, but its details page carries what we need:
 * a schema.org SoftwareApplication block (name, developer, rating, price,
 * category), the screenshots as `alt="Screenshot image"` images, the full
 * description, the install band and the update date. The page's og:image is
 * the icon. The fetch pins `hl=en&gl=US` so labels parse and match the App
 * Store's US storefront.
 *
 * Everything returned is scraped third-party DATA, like any page.
 */

const DETAILS = 'https://play.google.com/store/apps/details';
const MAX_SHOTS = 10;
const RETRY_DELAYS = [5000, 20000, 60000];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

/** Package id for a Play listing URL, or null for anything else. */
export function playId(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.hostname !== 'play.google.com' || !u.pathname.startsWith('/store/apps/details')) return null;
  const id = u.searchParams.get('id');
  return id && /^[A-Za-z0-9_.]+$/.test(id) ? id : null;
}

/** The URL a Play clip is keyed by: the package, without locale or tracking params. */
export function canonicalPlayUrl(pkg) {
  return `${DETAILS}?id=${pkg}`;
}

/** Ask Play's image server for a legible size, preserving aspect (portrait or landscape). */
export function sizedPlayShot(url, box = 1600) {
  const base = String(url).replace(/=[^=/]*$/, '');
  return `${base}=w${box}-h${box}-rw`;
}

const decode = (s) => String(s)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .trim();

/** "50M+" → 50000000, for a sortable lens beside the categorical band. */
export function installsFloor(band) {
  const m = String(band || '').replace(/,/g, '').match(/^([\d.]+)\s*([KMB])?\+?$/i);
  if (!m) return undefined;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  return Math.round(Number(m[1]) * scale);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoDay(text) {
  const m = String(text || '').match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})$/);
  const mo = m && MONTHS[m[1].toLowerCase()];
  return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}` : undefined;
}

/** MUSIC_AND_AUDIO → "Music & Audio", matching how the store labels it. */
const genreLabel = (cat) => (typeof cat === 'string' && cat
  ? cat.toLowerCase().split('_').map((w) => (w === 'and' ? '&' : w[0].toUpperCase() + w.slice(1))).join(' ')
  : undefined);

/** Parse a details page. Exported for tests; returns null if it isn't one. */
export function parsePlayPage(html, pkg) {
  let app = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d?.['@type'] === 'SoftwareApplication') { app = d; break; }
    } catch { /* another block, or malformed: keep looking */ }
  }
  if (!app) return null;

  const shots = [];
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    if (!/alt="Screenshot image"/.test(tag)) continue;
    const src = tag.match(/\ssrc="([^"]+)"/)?.[1];
    if (src && /^https:\/\/play-lh\.googleusercontent\.com\//.test(src)) {
      const sized = sizedPlayShot(decode(src));
      if (!shots.includes(sized)) shots.push(sized);
    }
    if (shots.length >= MAX_SHOTS) break;
  }

  const description = decode(html.match(/data-g-id="description"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '') || String(app.description || '');
  const band = html.match(/>([\d.,]+[KMB]?\+)<\/div><div[^>]*>Downloads</)?.[1];
  const updated = isoDay(decode(html.match(/Updated on<\/div><div[^>]*>([^<]+)</)?.[1] || ''));
  const offer = Array.isArray(app.offers) ? app.offers[0] : app.offers;
  const price = offer && Number(offer.price) > 0
    ? `${offer.priceCurrency === 'USD' ? '$' : `${offer.priceCurrency || ''} `}${Number(offer.price).toFixed(2)}`
    : (offer ? 'Free' : undefined);
  const count = Number(app.aggregateRating?.ratingCount);
  const stars = Number(app.aggregateRating?.ratingValue);

  return {
    title: decode(app.name || ''),
    description,
    shots,
    fields: {
      appId: pkg,
      store: 'Google Play',
      storefront: 'us',
      platform: 'android',
      shotDevice: shots.length ? 'android' : undefined,
      seller: app.author?.name || undefined,
      price,
      ratings: Number.isFinite(count) ? count : undefined,
      stars: Number.isFinite(stars) ? Number(stars.toFixed(2)) : undefined,
      installs: band,
      installsMin: installsFloor(band),
      genre: genreLabel(app.applicationCategory),
      updated,
    },
  };
}

/**
 * Store record for a Play listing URL, or null when the URL is not one or the
 * page has nothing usable. Null means "use the ordinary page path".
 */
export async function lookupPlay(url, fetchImpl = globalThis.fetch, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const pkg = playId(url);
  if (!pkg) return null;
  const q = `${DETAILS}?id=${encodeURIComponent(pkg)}&hl=en&gl=US`;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(q, { headers: { 'user-agent': UA, 'accept-language': 'en-US' } });
    } catch {
      return null;
    }
    if (res.status !== 429) {
      if (!res.ok) return null;
      return parsePlayPage(await res.text(), pkg);
    }
    if (attempt >= RETRY_DELAYS.length) return null;
    await sleepImpl(RETRY_DELAYS[attempt]);
  }
}
