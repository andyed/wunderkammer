/**
 * Instance-level source suppression: `"suppressSources": ["github.com"]` in the
 * instance config keeps every clip from those hosts (and their subdomains) out
 * of the served corpus.
 *
 * Why at the corpus and not as a filter: the wall's facets are inclusive (OR
 * within a facet, AND across), so "everything except GitHub" is not
 * expressible as a selection, and a harvested corpus can be dominated by one
 * host whose cards are text-on-white — 423 of 430 GitHub clips in the market
 * instance came from browsing history, not from deliberate clipping. Nothing
 * is deleted: notes and media stay on disk, and removing the entry restores
 * them on the next load.
 */

const hostOf = (clip) => {
  if (clip?.source) return String(clip.source).toLowerCase().replace(/^www\./, '');
  try { return new URL(String(clip?.url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

/** Normalized host list from config; anything that isn't a non-empty string is ignored. */
export function suppressedHosts(config) {
  const list = Array.isArray(config?.suppressSources) ? config.suppressSources : [];
  return list.filter((h) => typeof h === 'string' && h.trim())
    .map((h) => h.trim().toLowerCase().replace(/^www\./, ''));
}

export function suppressClips(clips, config) {
  const hosts = suppressedHosts(config);
  if (!hosts.length) return clips;
  return clips.filter((c) => {
    const host = hostOf(c);
    return !hosts.some((h) => host === h || host.endsWith(`.${h}`));
  });
}
