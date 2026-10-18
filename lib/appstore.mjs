/**
 * App Store capture — the product's own screenshots and store data instead of
 * the page's og:image.
 *
 * An apps.apple.com page declares its icon (on a white card) as og:image, and
 * its screenshots load lazily, so the generic HTML path clips an icon and
 * skips the evidence. Apple's public lookup API returns the screenshot URLs,
 * the full description and the store numbers as plain JSON: no key, stable
 * for a decade, the same endpoint `tools/store-reviews` uses elsewhere.
 *
 * Everything returned is scraped third-party DATA, like any page.
 */

const LOOKUP = 'https://itunes.apple.com/lookup';
const MAX_SHOTS = 10;          // the App Store allows 10 per device class
const SHOT_WIDTH = 1242;       // mzstatic resizes on request; this keeps text legible
const RETRY_DELAYS = [5000, 20000, 60000];

/** `{ id, country }` for an App Store app URL, or null for anything else. */
export function appStoreId(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/^(apps|itunes)\.apple\.com$/.test(u.hostname)) return null;
  const id = u.pathname.match(/\/id(\d{5,})(?:\/|$)/)?.[1];
  if (!id) return null;
  // The storefront is the first path segment when it is a 2-letter code.
  const country = u.pathname.match(/^\/([a-z]{2})\//i)?.[1]?.toLowerCase() || 'us';
  return { id, country };
}

/**
 * Ask mzstatic for a JPEG at a legible width. Lookup URLs end in a size
 * component such as `/392x696bb.png`; anything unrecognised passes through.
 */
export function sizedShot(url, width = SHOT_WIDTH) {
  return String(url).replace(/\/\d+x\d+[a-z]*\.(?:png|jpe?g|webp)$/i, `/${width}x0w.jpg`);
}

const day = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined);

/**
 * Store record for an App Store URL, or null when the URL is not one or the
 * lookup has nothing (wrong storefront, pulled app, network failure). Null
 * means "use the ordinary page path", never "fail the clip".
 */
export async function lookupApp(url, fetchImpl = globalThis.fetch, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const ref = appStoreId(url);
  if (!ref) return null;
  const q = new URL(LOOKUP);
  q.search = new URLSearchParams({ id: ref.id, country: ref.country, entity: 'software' });
  let app;
  // Apple throttles the lookup (~20 calls/min) with a 403/429 or a plain-text
  // "Rate limit has been exceeded" body. Falling back on a throttle would write
  // an icon-card clip that a re-run never refreshes, so wait and retry first.
  for (let attempt = 0; ; attempt++) {
    let throttled = false;
    try {
      const res = await fetchImpl(q.href, { headers: { accept: 'application/json' } });
      const text = await res.text();
      throttled = res.status === 403 || res.status === 429 || /rate limit/i.test(text.slice(0, 200));
      if (!throttled) {
        if (!res.ok) return null;
        app = JSON.parse(text)?.results?.find((r) => String(r.trackId) === ref.id);
        break;
      }
    } catch {
      return null;
    }
    if (attempt >= RETRY_DELAYS.length) return null;
    await sleepImpl(RETRY_DELAYS[attempt]);
  }
  if (!app) return null;

  // iPhone first: it is the device class every app ships and the one buyers
  // see. iPad, then Apple TV, stand in only when an app has none (iPad-only
  // and tvOS-only apps). A Mac app's screenshots arrive in `screenshotUrls`.
  const list = (k) => (Array.isArray(app[k]) ? app[k] : []);
  const mac = app.kind === 'mac-software';
  const [shotDevice, raw] = [
    [mac ? 'mac' : 'iphone', list('screenshotUrls')],
    ['ipad', list('ipadScreenshotUrls')],
    ['appletv', list('appletvScreenshotUrls')],
  ].find(([, urls]) => urls.length) || ['', []];
  const shots = raw.slice(0, MAX_SHOTS).map((s) => sizedShot(s));

  const num = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : undefined);
  return {
    title: app.trackName || '',
    description: String(app.description || '').trim(),
    shots,
    icon: app.artworkUrl512 || '',
    // Frontmatter keys become wall facets; numbers become sortable lenses.
    fields: {
      appId: String(app.trackId),
      store: mac ? 'Mac App Store' : 'App Store',
      storefront: ref.country,
      platform: mac ? 'macos' : 'ios',
      shotDevice: shotDevice || undefined,
      seller: app.sellerName || undefined,
      price: app.formattedPrice || undefined,
      // Absent (Mac apps, very new apps) is unknown, not zero: the wall sorts
      // unknowns last, while a 0 would read as a measured lack of traction.
      ratings: Number.isFinite(app.userRatingCount) ? app.userRatingCount : undefined,
      stars: num(app.averageUserRating, 2),
      genre: app.primaryGenreName || undefined,
      version: app.version || undefined,
      released: day(app.releaseDate),
      updated: day(app.currentVersionReleaseDate),
    },
  };
}
