import { validateView } from './view-schema.mjs';

// A readable live intent projects into the same ViewSpec as an exact permalink.
// It does not evaluate collection membership or carry frozen corpus revisions.
const SINGLE = new Set(['view', 'q', 'group', 'sort', 'direction', 'lens', 'travel', 'spread', 'focus', 'rail']);
const recognized = key => SINGLE.has(key) || key.startsWith('facet.') || key.startsWith('highlight.');
const invalid = message => { throw new Error(`Invalid targeted view: ${message}`); };
const field = value => {
  if (!value || value.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(value)) invalid('invalid attribute name');
  return value;
};
const bounded = value => {
  if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) invalid('travel and spread must be between 0 and 1');
  return Number(value);
};
export function stripViewIntent(url) {
  const result = new URL(url);
  for (const key of [...result.searchParams.keys()]) if (recognized(key)) result.searchParams.delete(key);
  return result;
}
export function applyViewIntent(url, defaultView) {
  const u = new URL(url), hash = new URLSearchParams(u.hash.slice(1));
  // The saved view is authoritative even if its fragment is malformed: let the
  // permalink reader report that failure, never silently replace it with intent.
  if (hash.has('s') || hash.has('ref')) return null;
  const entries = [...u.searchParams].filter(([key]) => recognized(key));
  if (!entries.length) return null;
  if (entries.length > 1000 || entries.some(([key, value]) => key.length > 160 || value.length > 20000)) invalid('link is too large');
  if (!defaultView) invalid('the wall is not measurable yet');
  const view = structuredClone(validateView(defaultView)), p = u.searchParams;
  for (const key of SINGLE) if (p.getAll(key).length > 1) invalid(`${key} may appear only once`);
  if (p.has('view')) {
    const mode = p.get('view');
    if (!['flat', '3d', 'aisle'].includes(mode)) invalid('unknown view');
    view.presentation.mode = mode;
  }
  if (p.has('q')) view.scope.query = p.get('q');
  if (p.has('group')) view.presentation.group = field(p.get('group'));
  const facets = new Map();
  for (const [key, value] of entries) if (key.startsWith('facet.')) {
    const name = field(key.slice(6));
    if (!value) invalid('facet values must not be empty');
    if (!facets.has(name)) facets.set(name, new Set());
    facets.get(name).add(value);
  }
  if (facets.size) view.scope.facets = [...facets].map(([key, values]) => [key, [...values].sort()]).sort(([a], [b]) => a.localeCompare(b));
  if (p.has('sort') || p.has('direction')) {
    const key = p.has('sort') ? field(p.get('sort')) : view.presentation.sort?.key || 'none';
    const direction = p.has('direction') ? p.get('direction') : view.presentation.sort?.direction || 'asc';
    if (!['asc', 'desc'].includes(direction)) invalid('direction must be asc or desc');
    view.presentation.sort = { key, direction };
  }
  if (p.has('lens')) {
    view.ui.lens = p.get('lens') === 'none' ? null : field(p.get('lens'));
    if (view.ui.highlight?.key !== view.ui.lens) delete view.ui.highlight;
  }
  const highlights = entries.filter(([key]) => key.startsWith('highlight.'));
  if (highlights.length > 1) invalid('only one highlighted value is supported');
  if (highlights.length) {
    const [key, value] = highlights[0];
    if (!value) invalid('highlight must name a value');
    const name = field(key.slice(10));
    if (p.has('lens') && view.ui.lens !== name) invalid('highlight must use the selected lens');
    view.ui.lens = name; view.ui.highlight = { key: name, value };
  }
  if (p.has('focus')) view.ui.focus = p.get('focus') || null;
  if (p.has('rail')) {
    if (!['0', '1'].includes(p.get('rail'))) invalid('rail must be 0 or 1');
    view.ui.rail = p.get('rail') === '1';
  }
  if (view.presentation.mode === 'aisle' || p.has('travel') || p.has('spread')) {
    view.aisle ??= { version: 1, travel: 0, spread: .65, position: [0, 4, 4], target: [0, 4, -6], fitted: true, selection: null };
    for (const key of ['travel', 'spread']) if (p.has(key)) { view.aisle[key] = bounded(p.get(key)); view.aisle.fitted = true; }
  }
  if (view.presentation.mode === '3d' && !view.spatial) view.spatial = {
    mode: 'mountain', arrangement: { version: 1, piles: [] }, spread: -1,
    position: [0, 4, 4], target: [0, 4, -6], fitted: true, aspect: view.flat.aspect, selection: null,
  };
  return validateView(view);
}

/** A compact, live collection link. Exact cameras and frozen member selections
 * belong to Copy view's permalink; rejecting branches prevents scope widening. */
export function targetedViewURL(view, base) {
  validateView(view);
  if (view.scope.branches !== null) throw new Error('This view contains a frozen selection. Use Copy view to preserve its exact members.');
  const u = stripViewIntent(base); u.hash = '';
  const p = u.searchParams;
  p.set('view', view.presentation.mode);
  p.set('group', field(view.presentation.group));
  if (view.scope.query) p.set('q', view.scope.query);
  for (const [key, values] of view.scope.facets) for (const value of values) {
    field(key); if (!value) invalid('facet values must not be empty'); p.append(`facet.${key}`, value);
  }
  if (view.presentation.sort?.key && view.presentation.sort.key !== 'none') {
    p.set('sort', view.presentation.sort.key); p.set('direction', view.presentation.sort.direction);
  }
  if (view.ui.lens) p.set('lens', view.ui.lens);
  if (view.ui.highlight) p.set(`highlight.${view.ui.highlight.key}`, view.ui.highlight.value);
  if (view.ui.focus) p.set('focus', view.ui.focus);
  if (!view.ui.rail) p.set('rail', '0');
  if (view.presentation.mode === 'aisle') {
    p.set('travel', String(view.aisle.travel)); p.set('spread', String(view.aisle.spread));
  }
  return u;
}
