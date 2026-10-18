/**
 * Duplicate suppression for the served corpus: `"dedupe": true` in the
 * instance config collapses each group of duplicates to one tile.
 *
 * Two clips are duplicates when they share
 *   - the same page: the URL after dropping the fragment and locale/tracking
 *     parameters (a clipped App Store page also present in browsing history;
 *     the same Play listing with and without `&hl=`), or
 *   - the same image: a vault attachment's content hash (attachments are named
 *     by their SHA-256), or the same remote hero URL. Harvested pages that all
 *     carry a site's default card — X, arXiv, YouTube, a subreddit — would
 *     otherwise repeat one picture across the wall.
 * Page copies collapse before images are compared, so a harvested copy's
 * generic site card cannot chain two different pages together.
 *
 * The survivor prefers curated over harvested, then more media, then the most
 * recent capture. Nothing is dropped from reach: the survivor carries the
 * others in `alsoAt`, which the detail pane lists, and `props.duplicates`
 * counts them. Opt-in per instance, because an archive instance may hold
 * deliberate copies.
 */

const DROP_PARAMS = /^(utm_\w+|hl|gl|uo|pt|ct|mt|ref|fbclid|gclid|si|igshid)$/i;

/** Page identity: scheme-less host + path + remaining query, no fragment. */
export function pageKey(url) {
  try {
    const u = new URL(String(url));
    for (const k of [...u.searchParams.keys()]) if (DROP_PARAMS.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    const q = u.searchParams.toString();
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '') || '/'}${q ? `?${q}` : ''}`;
  } catch {
    return '';
  }
}

/** Image identity: an attachment's content hash, else the remote image URL. */
export function imageKey(clip) {
  const cover = String(clip?.cover || '');
  if (!cover) return '';
  const hashed = cover.match(/attachments\/([0-9a-f]{12,64})\.[a-z0-9]+(?:$|[?#])/i);
  if (hashed) return `hash:${hashed[1].toLowerCase()}`;
  let remote = cover;
  if (cover.startsWith('/api/proxy')) {
    try { remote = new URL(cover, 'http://local').searchParams.get('url') || ''; } catch { remote = ''; }
  }
  return /^https?:\/\//i.test(remote) ? `url:${remote}` : '';
}

const rank = (c) => [
  c.props?.corpus === 'read' ? 0 : 1,             // curated beats harvested
  Array.isArray(c.media) ? c.media.length : 0,    // more evidence
  String(c.captured || ''),                       // more recent
];
function better(a, b) {
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i] ? a : b;
  return String(a.id) <= String(b.id) ? a : b;    // stable
}

export function dedupeClips(clips, config) {
  if (!config?.dedupe) return clips;
  // Two stages, not one transitive pass. A harvested copy of a page usually
  // carries the site's generic card (every apps.apple.com page shares one), so
  // chaining page matches with image matches would merge different apps
  // through that card. Same-page copies collapse first; images are then
  // compared by each survivor's own cover only.
  return collapse(collapse(clips, (c) => pageKey(c.url)), imageKey);
}

/** One pass: group by key, keep the best of each group, carry the rest in alsoAt. */
function collapse(list, keyOf) {
  const groups = new Map();
  const loose = [];
  list.forEach((c, i) => {
    const k = keyOf(c);
    if (!k) { loose.push([i, c]); return; }
    (groups.get(k) || groups.set(k, []).get(k)).push([i, c]);
  });
  const kept = [...loose];
  for (const members of groups.values()) {
    if (members.length === 1) { kept.push(members[0]); continue; }
    const [at, survivor] = members.reduce((a, b) => (better(a[1], b[1]) === a[1] ? a : b));
    const absorbed = members.filter(([, c]) => c !== survivor).flatMap(([, c]) => [
      { title: c.title || c.url, url: c.url, source: c.source || '', captured: c.captured || '' },
      ...(Array.isArray(c.alsoAt) ? c.alsoAt : []),
    ]);
    const alsoAt = [...(Array.isArray(survivor.alsoAt) ? survivor.alsoAt : []), ...absorbed];
    kept.push([at, { ...survivor, alsoAt, props: { ...(survivor.props || {}), duplicates: alsoAt.length } }]);
  }
  // Survivors keep their own position in the adapters' order, so layouts and
  // permalinks stay stable apart from the removed tiles.
  return kept.sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}
