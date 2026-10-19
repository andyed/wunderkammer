import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const origin = 'http://wunderkammer.persistence';
const clips = ['Alpha', 'Beta', 'Gamma'].map((title, i) => ({
  id: String(i), title, url: `https://example.test/${title.toLowerCase()}`,
  cover: `/fixtures/${i}.svg`, source: 'Fixture',
  tags: [i < 2 ? 'Research' : 'Review'], props: { dims: ['400x300'] },
  editUri: `obsidian://open?vault=fixture&file=${title}`,
}));
const orphan = 'https://example.test/missing-note';
const saved = () => ({
  version: 1, mode: 'piles', groupKey: 'none',
  piles: [
    { label: 'Research', u: -240, v: 0, keys: [clips[0].url, clips[1].url] },
    { label: 'Review', u: 240, v: 0, keys: [clips[2].url, orphan] },
  ],
});
let browser;

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const transport = { doc: saved(), getStatus: 200, putStatus: 200, puts: [], ...options };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Serve the actual app, with only its data boundary replaced. No live
  // server, vault, remote hero, or production view-state document is touched.
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/clips') return route.fulfill({ json: {
      clips, facets: { tags: { Research: 2, Review: 1 }, source: { Fixture: 3 } },
    } });
    if (path === '/api/view-state') {
      if (request.method() === 'PUT') {
        const next = request.postDataJSON();
        transport.puts.push(next);
        if (transport.putStatus === 200) transport.doc = structuredClone(next);
        return route.fulfill({ status: transport.putStatus, json: { ok: transport.putStatus === 200 } });
      }
      return route.fulfill({ status: transport.getStatus, json: transport.doc });
    }
    const image = path.match(/^\/fixtures\/([0-2])\.svg$/);
    if (image) return route.fulfill({ contentType: 'image/svg+xml', body:
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${['#ed2525', '#20e040', '#2449ef'][image[1]]}"/></svg>`,
    });
    const file = path === '/' ? '/index.html' : path;
    if (file !== '/index.html' && !file.startsWith('/wall/')) return route.fulfill({ status: 404 });
    try {
      // Supply a prior source file to demonstrate failure without reverting
      // shared work: WUNDERKAMMER_WALL_SOURCE=/tmp/audited-wall.mjs.
      const alternate = file === '/wall/wall.mjs' && process.env.WUNDERKAMMER_WALL_SOURCE;
      const body = await readFile(alternate || new URL(`.${file}`, root));
      return route.fulfill({ body, contentType: file.endsWith('.html') ? 'text/html'
        : file.endsWith('.css') ? 'text/css' : 'text/javascript' });
    } catch { return route.fulfill({ status: 404 }); }
  });
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'whole app has no script errors'); });
  await page.goto(origin);
  await page.waitForFunction(() => document.body.dataset.viewReady === 'true');
  return { page, transport };
}

// The 3D button opens the floating space, or the stacks once a reader has
// chosen them; the stacks are the last entry in the space's menu.
async function openSpatial(page) {
  if (await page.locator('#view-3d').getAttribute('aria-pressed') !== 'true') await page.evaluate(() => document.getElementById('view-3d').click());
  await page.waitForFunction(() => ['3d', 'float'].includes(document.body.dataset.viewMode) && (window.__cwFloat?.built || window.__cwSpatial?.built));
  if (await page.evaluate(() => document.body.dataset.viewMode === 'float')) await page.locator('.float-arrange label:has(input[value=stacks])').click();
  await page.waitForFunction(() => window.__cwSpatial?.built && !document.querySelector('#sp-host').hidden);
}

async function expectPiles(page, expected) {
  if (!page.__errors) { page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message.slice(0, 240))); }
  await page.waitForFunction((want) => {
    const labels = [...document.querySelectorAll('.sp-pile-label')]
      .filter((el) => el.checkVisibility())
      .map((el) => `${el.querySelector('.n').textContent}:${el.querySelector('.c').textContent}`).sort();
    return JSON.stringify(labels) === JSON.stringify(want.slice().sort());
  }, expected, { timeout: 5000 }).catch(async () => {
    const labels = await page.$$eval('.sp-pile-label', els => els.map(el => `${el.querySelector('.n').textContent}:${el.querySelector('.c').textContent}` + (el.checkVisibility() ? '' : ' (hidden)')));
    throw new Error(`piles ${JSON.stringify(expected)} not seen; labels ${JSON.stringify(labels)}; errors ${JSON.stringify(page.__errors)}`);
  });
}

async function expectStatus(page, text) {
  await page.waitForFunction((message) => document.querySelector('#count').textContent.includes(message), text, { timeout: 5000 });
  assert.equal(await page.locator('#count').isVisible(), true);
}

async function changeAndSave(page, transport, group) {
  const pending = page.waitForResponse((response) => response.url() === `${origin}/api/view-state`
    && response.request().method() === 'PUT');
  await page.selectOption('#group', group);
  assert.equal((await pending).status(), 200);
  assert.equal(transport.doc.groupKey, group);
}

test('whole app restores saved piles, reloads a grouping save, and retains filtered and orphaned keys', async (t) => {
  const { page, transport } = await fixture(t);
  await openSpatial(page);
  await expectPiles(page, ['Research:2', 'Review:1']);
  assert.equal(await page.locator('#group').inputValue(), 'none');
  assert.equal(transport.puts.length, 0, 'opening saved research does not rewrite it');

  await changeAndSave(page, transport, 'tags');
  await expectPiles(page, ['Research:2', 'Review:1']);
  assert.ok(transport.doc.piles.find((p) => p.label === 'Review').keys.includes(orphan));
  await page.waitForTimeout(750); // wait for the settled view to reach the URL
  const reloadErrors = []; page.on('pageerror', e => reloadErrors.push(e.message.slice(0, 300)));
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.viewReady === 'true').catch(() => { throw new Error(`view never ready after reload: ${JSON.stringify(reloadErrors)}`); });
  await openSpatial(page);
  await expectPiles(page, ['Research:2', 'Review:1']);
  assert.equal(await page.locator('#group').inputValue(), 'tags');

  await page.fill('#search', 'Alpha');
  await expectPiles(page, ['Research:1', 'Review:0']);
  assert.equal(transport.puts.length, 1, 'filtering alone must not save a reduced document');
  await changeAndSave(page, transport, 'source');
  assert.deepEqual(new Set(transport.doc.piles.flatMap((p) => p.keys)),
    new Set([...clips.map((clip) => clip.url), orphan]), 'filtered and missing members survive a grouping save');
  await page.fill('#search', '');
  await expectPiles(page, ['Fixture:1', 'Research:1', 'Review:1']);
  await page.waitForTimeout(750); // wait for the settled view to reach the URL
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.viewReady === 'true');
  await openSpatial(page);
  await expectPiles(page, ['Fixture:1', 'Research:1', 'Review:1']);
  assert.equal(await page.locator('#group').inputValue(), 'source');
  if (process.env.WUNDERKAMMER_PERSISTENCE_SHOT) await page.screenshot({ path: process.env.WUNDERKAMMER_PERSISTENCE_SHOT });
});

test('failed saved-state GET is visible and subsequent grouping never issues PUT', async (t) => {
  const { page, transport } = await fixture(t, { getStatus: 500 });
  await openSpatial(page);
  await expectStatus(page, 'Saved piles not loaded');
  await page.selectOption('#group', 'tags');
  await expectStatus(page, 'View not saved');
  assert.equal(transport.puts.length, 0, 'failed load must not authorize overwriting unknown saved research');
  assert.deepEqual(transport.doc, saved());
});

test('failed saved-state PUT shows View not saved and a successful retry clears it', async (t) => {
  const { page, transport } = await fixture(t, { putStatus: 500 });
  await openSpatial(page);
  const failed = page.waitForResponse((response) => response.url() === `${origin}/api/view-state`
    && response.request().method() === 'PUT');
  await page.selectOption('#group', 'tags');
  assert.equal((await failed).status(), 500);
  await expectStatus(page, 'View not saved');
  assert.deepEqual(transport.doc, saved(), 'failed write preserves server state');
  transport.putStatus = 200;
  await changeAndSave(page, transport, 'source');
  await page.waitForFunction(() => !document.querySelector('#count').textContent.includes('View not saved'));
  assert.equal(transport.puts.length, 2);
});
