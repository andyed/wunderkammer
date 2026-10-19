import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyViewIntent, targetedViewURL, stripViewIntent } from '../wall/view-intent.mjs';
import { encodeView, decodeView, validateView } from '../wall/permalink.mjs';
const specimen = () => ({ v: 1, layoutVersion: 1, corpus: { id: 'fixture', revision: 'r1' },
  scope: { query: '', facets: [], branches: null }, presentation: { mode: 'flat', group: 'none', pan: 'edge' },
  flat: { view: { x: 0, y: 0, scale: 1, fitted: true }, stage: { w: 1200, h: 800 }, aspect: 1.5 }, spatial: null,
  ui: { rail: true, context: false, focus: null, detailWidth: null } });
const base = 'https://example.test/wall/?flow=vertical&pan=edge';

test('readable intent projects Unicode and repeated facets into canonical scope without mutating defaults', () => {
  const defaults = specimen(), original = structuredClone(defaults);
  const v = applyViewIntent(base + '&view=aisle&group=decade&q=紫色+🌀&facet.genre=Jazz&facet.genre=Rock&facet.genre=Jazz&facet.year=1990&lens=genre&highlight.genre=Jazz&travel=0.4&spread=0.8&rail=0&focus=urn%3A紫色&sort=year&direction=desc', defaults);
  assert.deepEqual(defaults, original);
  assert.equal(v.scope.query, '紫色 🌀');
  assert.deepEqual(v.scope.facets, [['genre', ['Jazz', 'Rock']], ['year', ['1990']]]);
  assert.equal(v.presentation.mode, 'aisle'); assert.equal(v.presentation.group, 'decade');
  assert.deepEqual(v.presentation.sort, { key: 'year', direction: 'desc' });
  assert.deepEqual(v.ui.highlight, { key: 'genre', value: 'Jazz' });
  assert.equal(v.ui.lens, 'genre'); assert.equal(v.ui.rail, false); assert.equal(v.ui.focus, 'urn:紫色');
  assert.equal(v.aisle.travel, .4); assert.equal(v.aisle.spread, .8); assert.equal(v.aisle.fitted, true);
  assert.deepEqual(decodeView(encodeView(v)), v);
});

test('legacy ViewSpecs stay accepted and aisle cameras require finite sane bounds', () => {
  const legacy = specimen(); assert.deepEqual(decodeView(encodeView(legacy)), legacy);
  const v = applyViewIntent(base + '&view=aisle', legacy);
  for (const patch of [{ version: 2 }, { travel: -1 }, { spread: 2 }, { position: [0, NaN, 0] },
    { target: v.aisle.position }, { position: [1e7, 0, 0] }, { target: [0, 4, -2000] }, { selection: {} }]) {
    assert.throws(() => validateView({ ...v, aisle: { ...v.aisle, ...patch } }));
  }
  assert.throws(() => validateView({ ...legacy, presentation: { ...legacy.presentation, mode: 'aisle' } }));
  assert.throws(() => validateView({ ...legacy, ui: { ...legacy.ui, highlight: { key: 'genre', value: 3 } } }));
  assert.equal(applyViewIntent(base + '&view=3d', legacy).spatial.fitted, true);
});

test('malformed recognized parameters fail explicitly; unrelated configuration is ignored', () => {
  assert.equal(applyViewIntent(base, specimen()), null);
  for (const query of ['view=vr', 'view=flat&view=aisle', 'travel=', 'travel=NaN', 'travel=1.1', 'spread=-.1',
    'direction=sideways', 'direction=', 'rail=true', 'facet.=Jazz', 'facet.genre=', 'facet.__proto__=x', 'highlight.genre=',
    'highlight.genre=Jazz&highlight.year=1990', 'lens=year&highlight.genre=Jazz', 'lens=none&highlight.genre=Jazz', 'lens=', 'group=', 'q=' + 'a'.repeat(20001)]) {
    assert.throws(() => applyViewIntent(base + '&' + query, specimen()), /Invalid targeted view/);
  }
});

test('saved inline or reference hash is authoritative even over malformed intent', () => {
  for (const hash of ['v=1&s=malformed', 'v=1&ref=bad', 's=' + encodeView(specimen())]) {
    assert.equal(applyViewIntent(base + '&view=not-valid#' + hash, specimen()), null);
  }
});

test('targeted links round-trip live scope and presentation while omitting exact camera and revision', () => {
  const v = applyViewIntent(base + '&view=aisle&group=decade&q=Jazz&facet.genre=Jazz&facet.genre=Fusion&lens=genre&highlight.genre=Fusion&travel=0.4&spread=0.8&rail=0&focus=urn%3Aone&sort=year&direction=desc', specimen());
  v.aisle.position = [2, 8, 11]; v.aisle.target = [0, 8, -3]; v.aisle.fitted = false;
  const url = targetedViewURL(v, base + '&view=flat&facet.genre=obsolete#v=1&s=old');
  assert.equal(url.hash, ''); assert.equal(url.searchParams.get('flow'), 'vertical');
  assert.equal(url.searchParams.get('pan'), 'edge'); assert.equal(url.searchParams.has('revision'), false);
  assert.equal(url.searchParams.has('camera'), false);
  const next = applyViewIntent(url, specimen());
  assert.deepEqual(next.scope, v.scope); assert.deepEqual(next.presentation, v.presentation);
  assert.deepEqual(next.ui, v.ui); assert.equal(next.aisle.travel, v.aisle.travel); assert.equal(next.aisle.fitted, true);
  assert.equal(stripViewIntent(url).href, base);
  const frozen = { ...v, scope: { ...v.scope, branches: [{ label: 'Only these', keys: ['urn:one'] }] } };
  assert.throws(() => targetedViewURL(frozen, base), /frozen selection.*Copy view/);
});

test('an explicit ungrouped live view overrides a grouped startup default', () => {
  const defaultView = specimen(); defaultView.presentation.group = 'captured';
  const url = targetedViewURL(specimen(), base);
  assert.equal(applyViewIntent(url, defaultView).presentation.group, 'none');
});

test('highlight alone selects its lens and changing lens clears a previous value pin', () => {
  const highlighted = applyViewIntent(base + '&highlight.genre=Jazz', specimen());
  assert.equal(highlighted.ui.lens, 'genre');
  assert.deepEqual(highlighted.ui.highlight, { key: 'genre', value: 'Jazz' });
  const cleared = applyViewIntent(base + '&lens=year', highlighted);
  assert.equal(cleared.ui.lens, 'year'); assert.equal(cleared.ui.highlight, undefined);
  assert.throws(() => validateView({ ...highlighted, ui: { ...highlighted.ui, lens: 'year' } }));
});

test('lit names items one identity per key, round-trips through exact and live links, and is refused when malformed', () => {
  const v = applyViewIntent(base + '&lit=urn%3Aa&lit=https%3A%2F%2Fx.test%2Fp%3Fa%3D1%2C2&lit=urn%3Aa&frame=evidence', specimen());
  // A URL identity may hold a comma, so lit repeats rather than splitting; duplicates collapse.
  assert.deepEqual(v.ui.lit, ['urn:a', 'https://x.test/p?a=1,2']);
  assert.deepEqual(decodeView(encodeView(v)).ui.lit, v.ui.lit);
  const live = targetedViewURL(v, base);
  assert.deepEqual(live.searchParams.getAll('lit'), v.ui.lit);
  assert.equal(live.searchParams.has('frame'), false, 'a framing is applied once, never written back');
  assert.equal(stripViewIntent(base + '&lit=urn%3Aa&frame=evidence').href, base, 'both keys belong to the link, not the instance');
  for (const query of ['lit=', 'frame=all', 'frame=evidence&frame=evidence'])
    assert.throws(() => applyViewIntent(`${base}&${query}`, specimen()), /Invalid targeted view/, query);
  // A live link holds at most 1,000 keys in all; a larger lit set travels in an exact link, up to 10,000.
  assert.throws(() => applyViewIntent(base + '&' + Array.from({ length: 1001 }, (_, i) => `lit=k${i}`).join('&'), specimen()), /link is too large/);
  const many = Array.from({ length: 10000 }, (_, i) => `k${i}`);
  assert.deepEqual(validateView({ ...specimen(), ui: { ...specimen().ui, lit: many } }).ui.lit.length, 10000);
  assert.throws(() => validateView({ ...specimen(), ui: { ...specimen().ui, lit: [...many, 'k10000'] } }), /Invalid or unsupported view link/);
  for (const lit of [[], [''], ['a', 'a'], 'a', [3]])
    assert.throws(() => validateView({ ...specimen(), ui: { ...specimen().ui, lit } }), /Invalid or unsupported view link/, JSON.stringify(lit));
});

test('front orders a cloud: it implies arrange=cloud, round-trips, and is refused anywhere else', () => {
  const v = applyViewIntent(base + '&view=float&front=-captured', specimen());
  assert.equal(v.float.arrangement, 'cloud'); assert.equal(v.float.front, '-captured');
  assert.deepEqual(decodeView(encodeView(v)).float.front, '-captured');
  assert.equal(targetedViewURL(v, base).searchParams.get('front'), '-captured');
  for (const [query, message] of [['front=', /front must name a dimension/], ['front=-', /front must name a dimension/],
    ['arrange=axes&front=captured', /front applies only to arrange=cloud/], ['across=year&front=captured', /front applies only to arrange=cloud/]])
    assert.throws(() => applyViewIntent(`${base}&${query}`, specimen()), message, query);
  assert.throws(() => validateView({ ...v, float: { ...v.float, front: '' } }), /Invalid or unsupported view link/);
});
