/**
 * Demo analytics: what the published demo reports to PostHog (project 673826, US Cloud).
 *
 * This file ships in the static demo only. scripts/build-demo.mjs copies it to
 * analytics.js and adds one script tag to the demo page. The engine (wall/ and
 * index.html) carries no analytics, so a page that embeds wunderkammer reports
 * to nobody.
 *
 * Posture, the same as Protoplasm and the Mind Bending Pixels sites:
 *   - Cookieless: persistence 'memory', so every page load is a new anonymous
 *     visitor. No identify, no person profiles.
 *   - No autocapture, replay, heatmaps or web vitals; the events are named ones.
 *   - Nothing the visitor typed: a search sends its length, never its text.
 *     URL hashes are not captured, because the wall's view links carry the
 *     search query in theirs.
 *   - A collection the visitor brings with ?collection= stays theirs: its URL is
 *     masked, and its title, item ids and attribute names are never sent.
 *   - PostHog's script loads async at low fetch priority, so the wall's own
 *     requests go first. It loads at once rather than after the wall is ready,
 *     so a visitor who leaves during a slow boot is still counted.
 *
 * Off on any host but andyed.github.io, in automated browsers
 * (navigator.webdriver), with ?perf (the instrumented build), and with ?ph=0.
 * ?ph=1 turns it on anywhere; events from a local host carry env: 'dev'.
 *
 * Events and properties: docs/DEMO_ANALYTICS.md.
 */

/** Project API key: public by design (it can only write events). */
const POSTHOG_KEY = 'phc_yuvWuYwKci8a2kK5kHecbqkFKun7tBJ5Qv25ghWBu8Ag';
const POSTHOG_HOST = 'https://us.i.posthog.com';
/** build-demo.mjs replaces this with `git describe` at build time. */
const APP_VERSION = '__WUNDERKAMMER_DEMO_VERSION__';

export const DEMO_HOST = 'andyed.github.io';
/** Backstop against a looping caller, per page load. A visitor cannot reach it; a bug can. */
const EVENT_CAP = 300;
const ERROR_CAP = 3;
/** The wall has this long to show a collection before the visit counts as a failed boot. */
const BOOT_TIMEOUT_MS = 30000;
/** A wheel or typing burst counts as one gesture until it rests this long. */
const BURST_REST_MS = 700;
/** How long after an input the view is read back, so a transition has settled. */
const SETTLE_MS = 500;
const TYPING_SETTLE_MS = 900;
/** Pointer travel beyond this is a drag, not a tap. */
const DRAG_PX = 8;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)$|\.localhost$|\.local$|\.test$|^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./;
const ON = ['1', 'true', 'yes', 'on'];
const OFF = ['0', 'false', 'no', 'off'];

export function hostEnv(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === DEMO_HOST) return 'production';
  if (!h || LOCAL_HOST.test(h)) return 'dev';
  return 'other';
}

/** Whether this page load reports, and why not when it does not. */
export function analyticsGate(search, hostname, webdriver = false) {
  const q = new URLSearchParams(search);
  const env = hostEnv(hostname);
  const ph = (q.get('ph') || '').toLowerCase();
  const off = reason => ({ enabled: false, env, reason });
  if (OFF.includes(ph)) return off('ph=0');
  if (ON.includes(ph)) return { enabled: true, env, reason: 'ph=1' };
  if (webdriver) return off('automated browser');
  if (q.has('perf')) return off('perf build');
  if (env === 'dev') return off('local host');
  // A copy of the demo on someone else's host is their page, not this project's traffic.
  if (env !== 'production') return off('not the demo host');
  return { enabled: true, env, reason: 'on' };
}

/** The collection is the one the demo ships unless the URL or an embedding page supplies another. */
export function collectionKind(search) {
  return new URLSearchParams(search).has('collection') ? 'custom' : 'bundled';
}

/**
 * The parts of window.wunderkammer.export() that events compare. The query is
 * kept here to detect a change and is never sent.
 */
export function viewSummary(exp) {
  if (!exp || typeof exp !== 'object') return null;
  const scope = exp.scope && typeof exp.scope === 'object' ? exp.scope : {};
  const facets = {}, facetCounts = {};
  for (const [key, values] of Object.entries(scope.facets || {})) {
    if (!Array.isArray(values) || !values.length) continue;
    facets[key] = values.map(String).sort().join('\u0000');
    facetCounts[key] = values.length;
  }
  const count = Number(exp.count), total = Number(exp.total);
  return {
    mode: exp.view?.mode ?? null,
    group: exp.view?.group ?? null,
    query: typeof scope.query === 'string' ? scope.query.trim() : '',
    facets, facetCounts,
    branches: Array.isArray(scope.branches) ? scope.branches.length : 0,
    focus: exp.focus?.key ?? null,
    count: Number.isFinite(count) ? count : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

/**
 * The events between two view summaries, as [name, props] pairs. A custom
 * collection's attribute names and item keys are replaced, so only the
 * engine's own vocabulary (modes, 'none') leaves the page.
 */
export function viewEvents(prev, next, bundled = true) {
  const events = [];
  if (!prev || !next) return events;
  const name = value => (bundled || value == null || value === 'none' ? value : 'custom');
  const results = next.count;
  if (next.mode !== prev.mode) events.push(['view_changed', { mode: next.mode, from: prev.mode, results }]);
  if (next.group !== prev.group) events.push(['group_changed', { group: name(next.group), from: name(prev.group), results }]);
  if (next.query !== prev.query) {
    events.push(next.query
      ? ['searched', { query_length: next.query.length, results }]
      : ['search_cleared', { results }]);
  }
  for (const key of new Set([...Object.keys(prev.facets), ...Object.keys(next.facets)])) {
    if (prev.facets[key] !== next.facets[key]) {
      events.push(['facet_filtered', { facet: name(key), values: next.facetCounts[key] || 0, results }]);
    }
  }
  if (next.branches !== prev.branches) events.push(['scope_changed', { branches: next.branches, results }]);
  if (next.focus && next.focus !== prev.focus) events.push(['item_opened', { item: bundled ? next.focus : null, results }]);
  return events;
}

/** Browser noise with nothing to act on; counted, it would use up ERROR_CAP on every visit. */
export function ignoredError(message) {
  return /^ResizeObserver loop|^Script error\.?$/.test(String(message ?? ''));
}

/** The engine's own message, trimmed: never a stack, never a URL. */
export function errorReason(message) {
  return String(message ?? 'unknown').replace(/(?:https?|file|blob):\/\/\S+/g, '<url>').slice(0, 160);
}

const GESTURES = ['tap', 'drag', 'pinch', 'wheel', 'key', 'type'];
const VISIT_COUNTERS = ['views', 'groups', 'searches', 'facets', 'scopes', 'items'];
const COUNTER_FOR = {
  view_changed: 'views', group_changed: 'groups', searched: 'searches',
  facet_filtered: 'facets', scope_changed: 'scopes', item_opened: 'items',
};

/**
 * Counts a visit and reports it in summaries. Each summary carries what
 * happened since the previous one, so a visitor who returns to the tab is
 * added, not counted twice: sums across a visit's summaries are exact.
 */
export class Visit {
  constructor(send, now = () => performance.now(), visible = true) {
    this.send = send;
    this.now = now;
    this.gestures = new Map();
    this.counters = new Map();
    this.modes = new Set();
    this.readyAt = -1;
    this.firstAt = -1;
    this.visibleSince = visible ? now() : null;
    this.visibleMs = 0;
    this.summaries = 0;
  }

  ready(mode) {
    if (this.readyAt < 0) this.readyAt = this.now();
    if (mode) this.modes.add(mode);
  }

  gesture(kind) {
    this.gestures.set(kind, (this.gestures.get(kind) ?? 0) + 1);
    if (this.firstAt >= 0 || this.readyAt < 0) return;
    this.firstAt = this.now();
    this.send('first_interaction', { gesture: kind, ms_to_first: Math.round(this.firstAt - this.readyAt) });
  }

  event(name, props) {
    const counter = COUNTER_FOR[name];
    if (counter) this.counters.set(counter, (this.counters.get(counter) ?? 0) + 1);
    if (name === 'view_changed' && props.mode) this.modes.add(props.mode);
  }

  visible() {
    if (this.visibleSince === null) this.visibleSince = this.now();
  }

  hidden(extra = {}) {
    if (this.visibleSince !== null) {
      this.visibleMs += this.now() - this.visibleSince;
      this.visibleSince = null;
    }
    this.summary(extra);
  }

  summary(extra = {}) {
    const props = {};
    let total = 0;
    for (const g of GESTURES) {
      const n = this.gestures.get(g) ?? 0;
      props[`g_${g}`] = n;
      total += n;
    }
    if (total === 0 && this.visibleMs < 1000) return;
    for (const c of VISIT_COUNTERS) props[`n_${c}`] = this.counters.get(c) ?? 0;
    props.gestures = total;
    props.seconds_visible = Math.round(this.visibleMs / 1000);
    props.views_seen = this.modes.size;
    props.summary_index = this.summaries++;
    this.gestures.clear();
    this.counters.clear();
    this.visibleMs = 0;
    this.send('visit_summary', { ...props, ...extra }, true);
  }
}

// ── PostHog ───────────────────────────────────────────────────────

/**
 * The live client. Looked up on every call, never kept: until array.js loads,
 * window.posthog is the queueing stub, and the SDK then replaces it with the
 * real instance, so a kept reference would queue into an array nobody reads.
 */
function client(win) {
  const ph = win.posthog;
  return ph && typeof ph.capture === 'function' ? ph : null;
}

/** Methods the stub queues until array.js arrives and replays them. */
const STUB_METHODS = ['capture', 'register', 'register_once', 'unregister', 'opt_out_capturing', 'opt_in_capturing', 'debug'];

/** The posthog-js snippet, unminified: a queueing stub and an async array.js from PostHog's asset host. */
function installPostHog(win, config) {
  if (win.posthog?.__SV) return;
  const doc = win.document;
  const stub = win.posthog = win.posthog || [];
  stub._i = [];
  stub.init = (key, cfg) => {
    const s = doc.createElement('script');
    s.type = 'text/javascript';
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.fetchPriority = 'low';
    s.src = POSTHOG_HOST.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
    doc.head.appendChild(s);
    stub.people = stub.people || [];
    for (const m of STUB_METHODS) stub[m] = (...args) => { stub.push([m, ...args]); };
    stub._i.push([key, cfg, 'posthog']);
  };
  stub.__SV = 1;
  stub.init(POSTHOG_KEY, config);
}

// ── The page's wiring ─────────────────────────────────────────────

/** Start reporting on this page if the gate allows. Returns the gate. */
export function start(win) {
  const doc = win.document;
  const gate = analyticsGate(win.location.search, win.location.hostname, !!win.navigator?.webdriver);
  if (!gate.enabled) return gate;

  const bundled = collectionKind(win.location.search) === 'bundled';
  // Read before the wall boots: it writes the current view into the hash at once.
  const fromLink = win.location.hash.length > 1;
  let embedded = false;
  try { embedded = win.top !== win; } catch { embedded = true; }
  const superProps = {
    app_name: 'wunderkammer',
    surface: 'demo',
    env: gate.env,
    app_version: APP_VERSION,
    collection: bundled ? 'bundled' : 'custom',
    embedded,
    touch: !!win.matchMedia?.('(pointer: coarse)').matches,
  };

  let sent = 0;
  try {
    installPostHog(win, {
      api_host: POSTHOG_HOST,
      person_profiles: 'identified_only',
      persistence: 'memory',
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,
      disable_surveys: true,
      // The project's remote config can switch these on; the demo reports named events only.
      capture_dead_clicks: false,
      enable_heatmaps: false,
      capture_performance: false,
      // A visitor's own collection URL stays on the page.
      mask_personal_data_properties: true,
      custom_personal_data_properties: ['collection', 'observations'],
      // View links carry the scope, search query included, in the hash.
      disable_capture_url_hashes: true,
      // A visitor's collection names the page; its title stays on the page too.
      before_send: event => {
        if (!bundled && event?.properties) delete event.properties.title;
        return event;
      },
      loaded: ph => ph.register(superProps),
    });
    client(win)?.register(superProps);
  } catch { /* analytics never breaks the wall */ }
  const send = (event, props = {}, beacon = false) => {
    if (sent >= EVENT_CAP) return;
    const ph = client(win);
    if (!ph) return;
    sent++;
    try {
      // sendBeacon survives the page being torn down; a normal request started in pagehide is cancelled.
      if (beacon) ph.capture(event, props, { transport: 'sendBeacon' });
      else ph.capture(event, props);
    } catch { /* analytics never breaks the wall */ }
  };

  const visit = new Visit(send, () => win.performance.now(), doc.visibilityState !== 'hidden');
  let view = null, ready = false;

  // Errors: the engine's message and file, never a stack. Booting or running.
  let errors = 0;
  const reportError = (message, file, line) => {
    if (errors >= ERROR_CAP || ignoredError(message)) return;
    errors++;
    const source = String(file || '').split(/[?#]/)[0].split('/').pop() || null;
    send('js_error', { message: errorReason(message), source, line: Number.isFinite(line) ? line : null, phase: ready ? 'running' : 'boot' });
  };
  win.addEventListener('error', e => reportError(e.message, e.filename, e.lineno));
  win.addEventListener('unhandledrejection', e => reportError(e.reason?.message ?? e.reason, null, null));

  const read = () => {
    try { return viewSummary(win.wunderkammer?.export?.()); } catch { return null; }
  };
  const check = () => {
    if (!ready) return;
    const next = read();
    if (!next) return;
    for (const [event, props] of viewEvents(view, next, bundled)) { visit.event(event, props); send(event, props); }
    view = next;
  };
  let settle = 0;
  const later = (ms = SETTLE_MS) => { win.clearTimeout(settle); settle = win.setTimeout(check, ms); };

  // Ready: the wall shows a collection.
  const bootStarted = win.performance.now();
  const waitReady = () => {
    const first = win.wunderkammer ? read() : null;
    if (first && first.total > 0) {
      ready = true;
      view = first;
      visit.ready(first.mode);
      send('wall_loaded', {
        items: first.total, results: first.count, mode: first.mode, group: bundled ? first.group : null,
        from_link: fromLink, ms_to_ready: Math.round(win.performance.now()),
      });
      return;
    }
    if (win.performance.now() - bootStarted > BOOT_TIMEOUT_MS) {
      send('wall_boot_failed', { reason: win.wunderkammer ? 'empty collection' : 'no wall', seconds: Math.round(BOOT_TIMEOUT_MS / 1000) });
      return;
    }
    win.setTimeout(waitReady, 250);
  };
  waitReady();

  // Gestures, counted for the summary; each one ends with a read of the view.
  const pointers = new Map();
  let pinching = false, wheelAt = -1e9, typeAt = -1e9;
  const editable = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  doc.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
    if (pointers.size === 2 && !pinching) { pinching = true; visit.gesture('pinch'); }
  }, { capture: true, passive: true });
  doc.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (p && !p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_PX) p.moved = true;
  }, { capture: true, passive: true });
  const pointerEnd = e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (!pinching && e.type === 'pointerup') visit.gesture(p.moved ? 'drag' : 'tap');
    if (pointers.size === 0) pinching = false;
    later();
  };
  doc.addEventListener('pointerup', pointerEnd, { capture: true, passive: true });
  doc.addEventListener('pointercancel', pointerEnd, { capture: true, passive: true });
  doc.addEventListener('wheel', () => {
    const t = win.performance.now();
    if (t - wheelAt >= BURST_REST_MS) visit.gesture('wheel');
    wheelAt = t;
    later(BURST_REST_MS);
  }, { capture: true, passive: true });
  doc.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (editable(e.target)) {
      const t = win.performance.now();
      if (t - typeAt >= BURST_REST_MS) visit.gesture('type');
      typeAt = t;
      later(TYPING_SETTLE_MS);
    } else {
      visit.gesture('key');
      later();
    }
  }, { capture: true });
  doc.addEventListener('change', () => later(), { capture: true });
  win.addEventListener('popstate', () => later());
  win.addEventListener('hashchange', () => later());
  // The mode lands on <body data-view-mode> whichever control changed it.
  if (win.MutationObserver && doc.body) {
    new win.MutationObserver(() => later()).observe(doc.body, { attributes: true, attributeFilter: ['data-view-mode'] });
  }
  // Sharing: the two copy-link buttons.
  doc.addEventListener('click', e => {
    const button = e.target?.closest?.('#copy-view, #copy-live-view');
    if (button) send('link_copied', { kind: button.id === 'copy-live-view' ? 'live' : 'view' });
  }, { capture: true, passive: true });

  const extra = () => {
    const v = view || {};
    return { mode: v.mode ?? null, group: bundled ? v.group ?? null : null, results: v.count ?? null, ready };
  };
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') { check(); visit.hidden(extra()); } else visit.visible();
  });
  // Safari does not always send visibilitychange on close; pagehide covers it.
  win.addEventListener('pagehide', () => { check(); visit.hidden(extra()); });
  return gate;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') start(window);
