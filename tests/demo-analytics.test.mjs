import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyticsGate, collectionKind, viewSummary, viewEvents, errorReason, ignoredError, Visit,
} from '../scripts/demo-analytics.js';

// The published demo's analytics (scripts/demo-analytics.js, shipped by
// scripts/build-demo.mjs as analytics.js). These cover what may leave the page;
// the PostHog wiring itself is checked against a routed endpoint by hand
// (docs/DEMO_ANALYTICS.md, "Checking the wiring").

test('the gate reports only from the demo host, and never from an automated browser', () => {
  assert.deepEqual(analyticsGate('', 'andyed.github.io'), { enabled: true, env: 'production', reason: 'on' });
  assert.equal(analyticsGate('', 'ANDYED.GITHUB.IO').enabled, true);
  for (const host of ['localhost', '127.0.0.1', '192.168.1.20', 'wall.local', 'someone.github.io', 'cdn.jsdelivr.net', '']) {
    assert.equal(analyticsGate('', host).enabled, false, host);
  }
  assert.equal(analyticsGate('', 'someone.github.io').reason, 'not the demo host');
  assert.equal(analyticsGate('', 'andyed.github.io', true).reason, 'automated browser');
  assert.equal(analyticsGate('?perf=hud', 'andyed.github.io').reason, 'perf build');
  assert.equal(analyticsGate('?ph=0', 'andyed.github.io').reason, 'ph=0');
  // ?ph=1 is the switch for checking the wiring; it wins over webdriver so a routed test can run.
  assert.deepEqual(analyticsGate('?ph=1', 'localhost', true), { enabled: true, env: 'dev', reason: 'ph=1' });
});

test('a collection named on the URL is the visitor\'s own', () => {
  assert.equal(collectionKind(''), 'bundled');
  assert.equal(collectionKind('?perf'), 'bundled');
  assert.equal(collectionKind('?collection=https%3A%2F%2Fexample.org%2Fmine.json'), 'custom');
  assert.equal(collectionKind('?collection=parent'), 'custom');
});

const exported = (over = {}) => ({
  format: 'wunderkammer.export', version: 1,
  scope: { label: 'All', query: '', facets: {}, branches: null, ...over.scope },
  view: { mode: 'flat', group: 'month', ...over.view },
  focus: over.focus ?? null,
  count: over.count ?? 297, total: 297, evidence: [],
});

test('view summaries read the export defensively', () => {
  assert.equal(viewSummary(null), null);
  assert.equal(viewSummary('nope'), null);
  const s = viewSummary(exported({ scope: { query: '  cats ', facets: { tag: ['b', 'a'], empty: [] } } }));
  assert.equal(s.query, 'cats');
  assert.deepEqual(s.facets, { tag: 'a\u0000b' });
  assert.deepEqual(s.facetCounts, { tag: 2 });
  assert.equal(s.branches, 0);
  assert.equal(viewSummary({ count: NaN, total: 'x' }).count, 0);
});

test('search events send the query length, never its text', () => {
  const before = viewSummary(exported());
  const after = viewSummary(exported({ scope: { query: 'my secret words' }, count: 12 }));
  const events = viewEvents(before, after);
  assert.deepEqual(events, [['searched', { query_length: 15, results: 12 }]]);
  assert.ok(!JSON.stringify(events).includes('secret'));
  assert.deepEqual(viewEvents(after, before), [['search_cleared', { results: 297 }]]);
});

test('a custom collection\'s item keys and attribute names never leave the page', () => {
  const before = viewSummary(exported());
  const after = viewSummary(exported({
    view: { mode: 'aisle', group: 'private_field' },
    scope: { facets: { private_field: ['x'] } },
    focus: { key: 'https://example.org/private/item-7', title: 'Mine' },
    count: 3,
  }));
  const custom = viewEvents(before, after, false);
  const text = JSON.stringify(custom);
  assert.ok(!text.includes('private'), text);
  assert.ok(!text.includes('example.org'), text);
  assert.deepEqual(custom.map(([name]) => name), ['view_changed', 'group_changed', 'facet_filtered', 'item_opened']);
  assert.deepEqual(custom.find(([n]) => n === 'item_opened')[1], { item: null, results: 3 });
  assert.deepEqual(custom.find(([n]) => n === 'view_changed')[1], { mode: 'aisle', from: 'flat', results: 3 });
  // The engine's own 'none' grouping is not the visitor's vocabulary.
  assert.deepEqual(viewEvents(before, viewSummary(exported({ view: { group: 'none' } })), false),
    [['group_changed', { group: 'none', from: 'custom', results: 297 }]]);
  // The bundled demo sends its own ids and attribute names.
  const bundled = viewEvents(before, after, true);
  assert.deepEqual(bundled.find(([n]) => n === 'item_opened')[1], { item: 'https://example.org/private/item-7', results: 3 });
});

test('facet events fire on a changed selection, not only a changed count', () => {
  const a = viewSummary(exported({ scope: { facets: { decade: ['1970s'] } } }));
  const b = viewSummary(exported({ scope: { facets: { decade: ['1990s'] } } }));
  assert.deepEqual(viewEvents(a, b), [['facet_filtered', { facet: 'decade', values: 1, results: 297 }]]);
  assert.deepEqual(viewEvents(a, a), []);
  assert.deepEqual(viewEvents(null, a), []);
});

test('errors carry the engine\'s message without URLs', () => {
  assert.equal(errorReason('Failed to fetch https://andyed.github.io/x.json?collection=y'), 'Failed to fetch <url>');
  assert.equal(errorReason(undefined), 'unknown');
  assert.equal(errorReason('x'.repeat(500)).length, 160);
  assert.ok(ignoredError('ResizeObserver loop completed with undelivered notifications.'));
  assert.ok(ignoredError('Script error.'));
  assert.ok(!ignoredError('Cannot read properties of null (reading \'x\')'));
});

test('visit summaries count since the previous summary, so a visit sums exactly', () => {
  let t = 0;
  const sent = [];
  const visit = new Visit((event, props, beacon) => sent.push([event, props, beacon]), () => t);
  visit.gesture('tap'); // before the wall is ready: counted, but no first interaction
  t = 1200; visit.ready('flat');
  t = 1500; visit.gesture('wheel');
  assert.deepEqual(sent[0], ['first_interaction', { gesture: 'wheel', ms_to_first: 300 }, undefined]);
  visit.event('view_changed', { mode: 'aisle' });
  visit.event('item_opened', { item: null });
  t = 5000; visit.hidden({ mode: 'aisle' });
  const [, first, beacon] = sent[1];
  assert.equal(sent[1][0], 'visit_summary');
  assert.equal(beacon, true);
  assert.equal(first.g_tap, 1); assert.equal(first.g_wheel, 1); assert.equal(first.gestures, 2);
  assert.equal(first.n_views, 1); assert.equal(first.n_items, 1);
  assert.equal(first.seconds_visible, 5);
  assert.equal(first.views_seen, 2);
  assert.equal(first.summary_index, 0);
  assert.equal(first.mode, 'aisle');
  // pagehide after visibilitychange: nothing new, nothing sent.
  visit.hidden();
  assert.equal(sent.length, 2);
  t = 9000; visit.visible(); visit.gesture('drag');
  t = 11000; visit.hidden();
  assert.equal(sent[2][1].gestures, 1);
  assert.equal(sent[2][1].g_drag, 1);
  assert.equal(sent[2][1].n_items, 0);
  assert.equal(sent[2][1].seconds_visible, 2);
  assert.equal(sent[2][1].summary_index, 1);
});
