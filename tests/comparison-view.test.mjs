import assert from 'node:assert/strict';
import { test, before, after, afterEach } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const corpus = { id: 'comparison-fixture', revision: 'r1' };
const album = (id, title, decade, genre, color, cover = '/covers/album.svg') => ({
  id, url: `urn:album:${id}`, title, source: 'Music fixture', captured: '', tags: [], cover,
  props: { decade, genre, color: [color], artist: ['Fixture artist'] },
});
const clips = [
  album('alpha', 'Alpha Blue', ['1970s'], ['Jazz', 'Blues', 'Jazz'], 'blue'),
  album('beta', 'Beta Brass', ['1970s'], ['Jazz'], 'gold'),
  album('gamma', 'Gamma Guitar', ['1970s'], ['Rock'], 'red'),
  album('shared', 'Shared Edition', ['1970s', '1990s'], ['Rock'], 'blue'),
  album('delta', 'Delta Distortion', ['1990s'], ['Rock'], 'red'),
  album('epsilon', 'Epsilon Fusion', ['1990s'], ['Jazz', 'Rock'], 'blue'),
  album('missing', 'Unclassified Album', ['1990s'], [], 'gray', ''),
];
let browser, server, origin;
const errors = [];
// Observations written against this fixture. Arithmetic: 1970s = alpha, beta,
// gamma, shared (4); 1990s = shared, delta, epsilon, missing (4).
const observedComparison = { version: 1, question: 'How does genre change from the 1970s to the 1990s?', corpus,
  scope: { query: '', facets: {} }, groupBy: 'decade', groups: ['1970s', '1990s'], measure: 'genre', metric: 'share', categoryLimit: 8, sort: 'name' };
const observations = {
  format: 'wunderkammer.observations', version: 1, comparison: observedComparison,
  observations: [
    { id: 'jazz-falls', text: 'Jazz is half of the 1970s albums and a quarter of the 1990s ones.', evidence: { cells: [{ value: 'Jazz', cohort: '1970s' }, { value: 'Jazz', cohort: '1990s' }] } },
    { id: 'rock', text: 'Rock spans both decades; the untagged album is worth a look too.', evidence: { cells: [{ value: 'Rock' }], items: ['urn:album:missing'] } },
    { id: 'typo', text: 'Electronica appears late.', evidence: { cells: [{ value: 'Electronica' }] } },
    { id: 'markup', text: 'Blues <img src=x onerror="window.pwned=1"> only in the 1970s.', evidence: { cells: [{ value: 'Blues', cohort: '1970s' }] } },
  ],
};
before(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/api/clips') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ clips, corpus, facets: {}, ui: { title: 'Comparison fixture' } }));
    }
    if (pathname === '/data/obs.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(observations)); }
    if (pathname === '/data/bad-obs.json') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ...observations, observations: [{ id: 'x', text: '', evidence: { cells: [{ value: 'Jazz', cohort: '2000s' }] } }] }));
    }
    if (pathname === '/covers/album.svg') {
      res.setHeader('content-type', 'image/svg+xml');
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#607e90"/><circle cx="64" cy="64" r="36" fill="#efd9a4"/></svg>');
    }
    if (/^\/wall\/[\w./-]+$/.test(pathname) && !pathname.includes('..')) {
      try {
        const data = await readFile(new URL('..' + pathname, import.meta.url));
        res.setHeader('content-type', pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
        return res.end(data);
      } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
afterEach(() => assert.deepEqual(errors.splice(0), [], 'no uncaught browser errors'));

test('a targeted URL retains a selected category beyond the visible category budget', async () => {
  const p=await open({url:`${origin}/wall/compare.html?groupBy=decade&group=1970s&group=1990s&measure=title&limit=4&sort=name&category=Unclassified+Album`});
  try {
    const view=await p.evaluate(()=>window.comparisonDebug());
    assert.equal(view.rows.length,4);
    assert.equal(view.rows[0].value,'Unclassified Album');
    assert.deepEqual(view.evidenceKeys,['urn:album:missing']);
    await p.locator('#clear-selection').click();
    const cleared=await p.evaluate(()=>window.comparisonDebug());
    assert.equal(cleared.rows[0].value,'Alpha Blue');
    assert.equal(cleared.rows.some(r=>r.value==='Unclassified Album'),false);
  } finally {await p.close();}
});

async function open({ url = `${origin}/wall/compare.html`, mobile = false, renderer = false } = {}) {
  const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000 }, hasTouch: mobile });
  page.on('pageerror', error => errors.push(error.message));
  // This fixture also proves that exact comparison and evidence survive an
  // unavailable optional renderer. Renderer geometry has its own live proof;
  // the observation highlight test loads the renderer.
  if (!renderer) await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.goto(url);
  await page.waitForSelector('body[data-comparison-ready="true"]');
  // Most interaction fixtures exercise scope controls; the artwork-first view
  // initially folds them so the collection owns the screen.
  await page.locator('#scope-panel').evaluate(node=>{node.open=true;});
  return page;
}
const state = page => page.evaluate(() => window.comparisonDebug());
const cell = (page, value, cohort) => page.locator('#comparison-matrix .cell-button').and(page.getByRole('button', { name: new RegExp(`${value}.*${cohort}|${cohort}.*${value}`) }));
const evidence = page => page.locator('#evidence-items .item-name').allTextContents();
const waitForState = (page, predicate) => page.waitForFunction(predicate);

test('exact cells expose denominators, linked evidence and overlapping tags without double counting', async () => {
  const page = await open();
  try {
    const model = await state(page);
    assert.deepEqual(model.cohorts.map(c => [c.key, c.count]), [['1970s', 4], ['1990s', 4]]);
    const jazz = model.rows.find(row => row.value === 'Jazz');
    assert.deepEqual(jazz.cells.map(c => [c.count, c.share]), [[2, .5], [1, .25]]);
    assert.match(await cell(page, 'Jazz', '1970s').getAttribute('aria-label'), /2.*4/);
    assert.match(await cell(page, 'Jazz', '1970s').getAttribute('aria-label'), /50/);
    await cell(page, 'Jazz', '1970s').click();
    assert.deepEqual(await evidence(page), ['Alpha Blue', 'Beta Brass']);
    assert.deepEqual((await state(page)).evidenceKeys, ['urn:album:alpha', 'urn:album:beta']);
    await page.selectOption('#metric', 'count');
    assert.equal((await state(page)).spec.metric, 'count');
    assert.deepEqual(await evidence(page), ['Alpha Blue', 'Beta Brass'], 'normalizing does not change evidence membership');
    assert.match(await cell(page, 'Jazz', '1970s').innerText(), /2/);
    await page.click('#clear-selection');
    assert.deepEqual(await evidence(page), clips.map(clip => clip.title));
    assert.match(await page.locator('#data-notes').textContent(), /overlap|more than one/i);
  } finally { await page.close(); }
});

test('zero-result scope recovers when search clears, including an album with no cover', async () => {
  const page = await open();
  try {
    await page.fill('#compare-search', 'nothing-matches-this-fixture');
    await waitForState(page, () => window.comparisonDebug().evidenceKeys.length === 0);
    assert.equal(await page.locator('#evidence-items .evidence-item').count(), 0);
    assert.match(await page.locator('#evidence-items').textContent(), /no|clear|matching|empty/i);
    await page.fill('#compare-search', '');
    await waitForState(page, () => window.comparisonDebug().evidenceKeys.length === 7);
    assert.deepEqual(await evidence(page), clips.map(clip => clip.title));
    assert.equal(await page.locator('#evidence-items .no-art').count(), 1);
  } finally { await page.close(); }
});

test('hover and keyboard preview preserve scope, evidence and URL until activation', async () => {
  const page = await open();
  try {
    const before = await state(page), url = page.url();
    await cell(page, 'Jazz', '1990s').hover();
    assert.equal(page.url(), url);
    const hovered = await state(page);
    for (const key of ['spec', 'selection', 'presentation', 'evidenceKeys']) assert.deepEqual(hovered[key], before[key], key);
    await cell(page, 'Jazz', '1990s').focus();
    assert.equal(page.url(), url);
    assert.deepEqual((await state(page)).selection, before.selection);
    await page.keyboard.press('Enter');
    assert.deepEqual(await evidence(page), ['Epsilon Fusion']);
    assert.deepEqual((await state(page)).selection, { value: 'Jazz', cohort: '1990s' });
    assert.notEqual(page.url(), url);
    await page.waitForFunction(() => document.querySelector('#comparison-stage').textContent.includes('Depth view unavailable'));
    assert.equal(await page.locator('#comparison-stage canvas').count(), 0, 'exact evidence remains interactive without the optional CDN renderer');
  } finally { await page.close(); }
});

test('recipe validation is atomic and a valid question changes scope and measurement together', async () => {
  const page = await open();
  try {
    const before = (await state(page)).spec;
    await page.click('#recipe-open');
    await page.fill('#recipe-text', JSON.stringify({ ...before, metric: 'invented-metric' }));
    await page.click('#apply-recipe');
    assert.deepEqual((await state(page)).spec, before);
    assert.match(await page.locator('#recipe-error').textContent(), /metric/i);
    assert.equal(await page.locator('#recipe-dialog').evaluate(dialog => dialog.open), true);
    const recipe = { ...before, question: 'Which genres occur on blue artwork?', scope: { query: 'Alpha', facets: {} }, groupBy: 'color', groups: ['blue', 'red'], measure: 'genre', metric: 'count' };
    await page.fill('#recipe-text', JSON.stringify(recipe));
    await page.click('#apply-recipe');
    assert.deepEqual((await state(page)).spec, recipe);
    assert.equal(await page.locator('#compare-search').inputValue(), 'Alpha');
    assert.equal(await page.locator('#group-by').inputValue(), 'color');
    assert.equal(await page.locator('#measure').inputValue(), 'genre');
    assert.deepEqual(await evidence(page), ['Alpha Blue']);
    assert.equal(await page.locator('#question').textContent(), recipe.question);
  } finally { await page.close(); }
});

test('fresh permalink and browser Back restore selected evidence and depth presentation', async () => {
  const page = await open();
  let restored;
  try {
    await cell(page, 'Rock', '1990s').click();
    await page.click('[data-view="terraces"]');
    await page.locator('#depth-spread').fill('80');
    await page.locator('#depth-spread').dispatchEvent('change');
    await page.selectOption('#depth-slice', '1990s');
    const expected = await state(page);
    restored = await open({ url: page.url() });
    const actual = await state(restored);
    for (const key of ['spec', 'selection', 'presentation', 'evidenceKeys']) assert.deepEqual(actual[key], expected[key], key);
    const savedUrl = page.url();
    await page.selectOption('#metric', 'count');
    assert.notEqual(page.url(), savedUrl);
    await page.goBack();
    await waitForState(page, () => window.comparisonDebug().spec.metric === 'share');
    const back = await state(page);
    for (const key of ['spec', 'selection', 'presentation', 'evidenceKeys']) assert.deepEqual(back[key], expected[key], `Back: ${key}`);
  } finally { await restored?.close(); await page.close(); }
});

test('recipe and evidence dialogs close by keyboard and return focus to their opener', async () => {
  const page = await open();
  try {
    await page.click('#recipe-open');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#recipe-dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'recipe-open');
    const first = page.locator('#evidence-items .evidence-item').first();
    await first.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#item-dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('#item-title').textContent(), 'Alpha Blue');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#item-dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await first.evaluate(el => document.activeElement === el), true);
  } finally { await page.close(); }
});

test('phone layout contains horizontal scrolling and touch drills through exact evidence', async () => {
  const page = await open({ mobile: true });
  try {
    const width = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
    assert.ok(width.body <= width.viewport + 1, JSON.stringify(width));
    await cell(page, 'Jazz', '1990s').tap();
    assert.deepEqual(await evidence(page), ['Epsilon Fusion']);
    await page.locator('#evidence-items .evidence-item').tap();
    assert.equal(await page.locator('#item-title').textContent(), 'Epsilon Fusion');
    await page.getByRole('button', { name: 'Close item', exact: true }).tap();
    assert.deepEqual((await state(page)).selection, { value: 'Jazz', cohort: '1990s' });
    const after = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
    assert.ok(after.body <= after.viewport + 1, JSON.stringify(after));
  } finally { await page.close(); }
});

test('concise URL parameters open exact selected evidence and survive a fresh copied view', async () => {
  const page = await open({ url: `${origin}/wall/compare.html?groupBy=decade&group=1970s&group=1990s&measure=genre&metric=count&category=Jazz&within=1970s&view=front&spread=0.4` });
  let fresh;
  try {
    const expected = await state(page);
    assert.deepEqual(expected.selection, { value: 'Jazz', cohort: '1970s' });
    assert.deepEqual(expected.presentation, { view: 'front', spread: .4, slice: null });
    assert.equal(expected.spec.metric, 'count');
    assert.deepEqual(expected.spec.corpus, corpus);
    assert.deepEqual(await evidence(page), ['Alpha Blue', 'Beta Brass']);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#copy-link');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, page.url());
    assert.equal(new URL(copied).searchParams.get('category'), 'Jazz');
    fresh = await open({ url: copied });
    for (const key of ['spec', 'selection', 'presentation', 'evidenceKeys']) assert.deepEqual((await state(fresh))[key], expected[key], key);
  } finally { await fresh?.close(); await page.close(); }
});

test('one-value grouping rejection restores the controls to the still-active comparison', async () => {
  const page = await open();
  try {
    const before = await state(page);
    await page.selectOption('#group-by', 'source');
    assert.deepEqual((await state(page)).spec, before.spec);
    assert.equal(await page.locator('#group-by').inputValue(), 'decade');
    assert.match(await page.locator('#notice').textContent(), /groups|distinct/i);
  } finally { await page.close(); }
});

test('empty cohort shares are unavailable and stale-revision exports identify actual evidence provenance', async () => {
  const page = await open({ url: `${origin}/wall/compare.html?group=1970s&group=2050s&revision=old-revision` });
  try {
    assert.match(await cell(page, 'Jazz', '2050s').innerText(), /—/);
    assert.match(await cell(page, 'Jazz', '2050s').getAttribute('aria-label'), /unavailable/i);
    assert.ok((await page.locator('#comparison-matrix .difference').allTextContents()).every(value => value === '—'));
    assert.match(await page.locator('#notice').textContent(), /different corpus|revision|current-index/i);
    await cell(page, 'Jazz', '1970s').click();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#copy-evidence');
    const packet = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    assert.deepEqual(packet.corpus, corpus);
    assert.deepEqual(packet.comparison.corpus, corpus);
    assert.deepEqual(packet.requestedCorpus, { id: corpus.id, revision: 'old-revision' });
    assert.deepEqual(packet.evidence.map(item => item.title), ['Alpha Blue', 'Beta Brass']);
    assert.ok(packet.warnings.some(warning => /historical membership is not reproduced/.test(warning)));
  } finally { await page.close(); }
});

test('album walls and aisle position survive a fresh URL without changing evidence', async () => {
  const page=await open();
  let fresh;
  try {
    const before=await state(page);
    assert.equal(before.presentation.view,'walls');
    assert.equal(await page.locator('body').getAttribute('data-gallery'),'true');
    await page.locator('#aisle-travel').fill('65');
    await page.locator('#aisle-travel').dispatchEvent('input');
    const after=await state(page);
    assert.equal(after.presentation.travel,.65);
    assert.deepEqual(after.evidenceKeys,before.evidenceKeys);
    assert.equal(new URL(page.url()).searchParams.get('travel'),'0.65');
    fresh=await open({url:page.url()});
    assert.deepEqual((await state(fresh)).presentation,after.presentation);
    await page.locator('[data-view=depth]').click();
    assert.equal(await page.locator('#walk-control').isVisible(),false);
    assert.deepEqual((await state(page)).evidenceKeys,before.evidenceKeys);
    await page.locator('[data-view=walls]').click();
    assert.equal((await state(page)).presentation.travel,.65);
  } finally {await fresh?.close();await page.close();}
});

// ---- observations ---------------------------------------------------------
const figureLines = page => page.locator('#observation-list .observation-figures li').allTextContents();
const observationCard = (page, id) => page.locator(`#observation-list .observation[data-id="${id}"]`);

test('observations load from a URL; their figures are computed and agree with the matrix', async () => {
  const p = await open({ url: `${origin}/wall/compare.html?observations=/data/obs.json` });
  try {
    await p.waitForSelector('#observations:not([hidden])');
    assert.equal(await p.locator('#observation-list .observation').count(), 4);
    const jazz = await observationCard(p, 'jazz-falls').locator('.observation-figures li').allTextContents();
    assert.deepEqual(jazz, ['Jazz · 1970s: 2 of 4 · 50.0%', 'Jazz · 1990s: 1 of 4 · 25.0%']);
    // The matrix renders the same cells by its own path; the numbers must agree.
    for (const [cohort, count, share] of [['1970s', 2, '50.0%'], ['1990s', 1, '25.0%']]) {
      const label = await cell(p, 'Jazz', cohort).getAttribute('aria-label');
      assert.match(label, new RegExp(`${count} of 4 items, ${share.replace('.', '\\.')}`));
    }
    // An unresolvable citation is shown, not dropped, and offers no evidence.
    assert.deepEqual(await observationCard(p, 'typo').locator('.observation-figures li').allTextContents(),
      ['Not found: “Electronica” is not among the measured values']);
    assert.equal(await observationCard(p, 'typo').locator('.observation-select').isDisabled(), true);
    // The address now carries the observations themselves, not the file URL.
    const url = new URL(p.url());
    assert.ok(url.searchParams.has('obs') && !url.searchParams.has('observations'));
  } finally { await p.close(); }
});

test('selecting an observation shows exactly the union of its cited evidence, and the link restores it', async () => {
  const p = await open({ url: `${origin}/wall/compare.html?observations=/data/obs.json` });
  try {
    await p.waitForSelector('#observations:not([hidden])');
    await observationCard(p, 'rock').locator('.observation-select').click();
    const view = await state(p);
    // Rock: gamma, shared (1970s) and shared, delta, epsilon (1990s), plus the cited untagged album, in corpus order.
    assert.deepEqual(view.evidenceKeys, ['urn:album:gamma', 'urn:album:shared', 'urn:album:delta', 'urn:album:epsilon', 'urn:album:missing']);
    assert.deepEqual(await evidence(p), ['Gamma Guitar', 'Shared Edition', 'Delta Distortion', 'Epsilon Fusion', 'Unclassified Album']);
    assert.equal(await cell(p, 'Rock', '1970s').getAttribute('aria-pressed'), 'true');
    assert.equal(await cell(p, 'Rock', '1990s').getAttribute('aria-pressed'), 'true');
    assert.equal(await cell(p, 'Jazz', '1970s').getAttribute('aria-pressed'), 'false');
    const packet = await p.evaluate(() => window.wunderkammer.export());
    assert.deepEqual(packet.selection, { observation: 'rock' });
    assert.equal(packet.observation.authored, true);
    assert.deepEqual(packet.evidence.map(e => e.key), view.evidenceKeys);
    assert.deepEqual(packet.observation.figures.map(f => [f.cohort, f.count, f.denominator]), [['1970s', 2, 4], ['1990s', 3, 4]]);
    assert.equal(new URL(p.url()).searchParams.get('observation'), 'rock');
    const copied = p.url();
    const q = await open({ url: copied });
    try {
      assert.equal((await state(q)).selection.observation, 'rock');
      assert.deepEqual((await state(q)).evidenceKeys, view.evidenceKeys);
    } finally { await q.close(); }
  } finally { await p.close(); }
});

test('authored observation text is shown as text, never as markup', async () => {
  const p = await open({ url: `${origin}/wall/compare.html?observations=/data/obs.json` });
  try {
    await p.waitForSelector('#observations:not([hidden])');
    assert.match(await observationCard(p, 'markup').locator('.observation-text').textContent(), /<img src=x onerror=/);
    assert.equal(await p.locator('#observations img').count(), 0);
    assert.equal(await p.evaluate(() => window.pwned), undefined);
  } finally { await p.close(); }
});

test('observations go stale when the comparison changes, and can return to it', async () => {
  const p = await open({ url: `${origin}/wall/compare.html?observations=/data/obs.json` });
  try {
    await p.waitForSelector('#observations:not([hidden])');
    await p.locator('#measure').selectOption('color');
    await p.waitForSelector('#observations-stale:not([hidden])');
    assert.equal(await p.locator('#observation-list .observation-figures').count(), 0, 'no figures for a different comparison');
    assert.equal((await state(p)).observationsStale, true);
    await p.locator('#observations-restore').click();
    await p.waitForSelector('#observations-stale', { state: 'hidden' });
    assert.equal((await state(p)).spec.measure, 'genre');
    assert.deepEqual(await observationCard(p, 'jazz-falls').locator('.observation-figures li').allTextContents(), ['Jazz · 1970s: 2 of 4 · 50.0%', 'Jazz · 1990s: 1 of 4 · 25.0%']);
  } finally { await p.close(); }
});

test('an invalid observations file reports every problem and leaves the comparison usable', async () => {
  const p = await open({ url: `${origin}/wall/compare.html?observations=/data/bad-obs.json` });
  try {
    const text = await p.locator('#notice').textContent();
    assert.match(text, /observations\[0\]\.text must be a non-empty string/);
    assert.match(text, /observations\[0\]\.evidence\.cells\[0\]\.cohort "2000s" is not one of the comparison's groups/);
    assert.equal(await p.locator('#observations').isHidden(), true);
    assert.ok((await state(p)).rows.length > 0);
    assert.equal(new URL(p.url()).searchParams.get('observations'), '/data/bad-obs.json', 'the address keeps the file so a reload retries it');
  } finally { await p.close(); }
});

test('the recipe dialog accepts an observations envelope', async () => {
  const p = await open();
  try {
    await p.locator('#recipe-open').click();
    await p.locator('#recipe-text').fill(JSON.stringify(observations));
    await p.locator('#apply-recipe').click();
    await p.waitForSelector('#observations:not([hidden])');
    assert.equal(await p.locator('#observation-list .observation').count(), 4);
    await p.locator('#recipe-open').click();
    const shown = JSON.parse(await p.locator('#recipe-text').inputValue());
    assert.equal(shown.format, 'wunderkammer.observations', 'reopening shows the envelope, so copying keeps the observations');
    await p.locator('#recipe-dialog button[aria-label="Close comparison recipe"]').click();
  } finally { await p.close(); }
});

test('the album walls highlight exactly the places an observation cites', async () => {
  const p = await open({ url: `${origin}/wall/compare.html?observations=/data/obs.json`, renderer: true });
  try {
    await p.waitForSelector('body[data-scene-ready="true"]', { timeout: 20000 });
    await p.waitForSelector('#observations:not([hidden])');
    await observationCard(p, 'jazz-falls').locator('.observation-select').click();
    await p.waitForFunction(() => window.comparisonDebug().scene?.highlightedTiles === 3);
    // alpha and beta on the 1970s rack, epsilon on the 1990s rack; a category
    // selection of Jazz across groups lights the same three places.
    await p.locator('#clear-selection').click();
    await p.locator('#comparison-matrix [data-category="Jazz"]').click();
    await p.waitForFunction(() => window.comparisonDebug().scene?.highlightedTiles === 3);
  } finally { await p.close(); }
});
