import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The static demo copies wall/ through a filter that leaves the comparison
// workbench out. A module the demo loads that imports a filtered file 404s on
// the published site, and nothing else in the suite builds the demo to notice:
// the aisle failed to start that way when album-walls.mjs began importing
// comparison-copy.mjs. This builds the real bundle from a fixture corpus and
// follows every relative import the shipped pages can reach.
const root = fileURLToPath(new URL('../', import.meta.url));
const doc = {
  format: 'wunderkammer.collection', version: 1, corpus: { id: 'fixture:demo', revision: 'r1' },
  ui: { title: 'Demo fixture', defaultGroup: 'decade' },
  clips: Array.from({ length: 6 }, (_, i) => ({
    id: `d${i}`, title: `Cover ${i}`, cover: `media/d${i}.webp`, props: { decade: ['1970s', '1990s'][i % 2] },
  })),
};
let dir, out;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-demo-'));
  const published = path.join(dir, 'published');
  out = path.join(dir, 'out');
  await mkdir(path.join(published, 'media'), { recursive: true });
  await writeFile(path.join(published, 'collection.json'), JSON.stringify(doc));
  // --reuse-corpus builds from a published corpus, with no running instance or cwebp.
  execFileSync(process.execPath, ['scripts/build-demo.mjs', '--reuse-corpus', published, '--out', out], { cwd: root, stdio: 'pipe' });
});
after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

async function files(folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await files(full)); else found.push(full);
  }
  return found;
}
// `from './x'`, `import './x'` and `import('./x')`; bare and URL specifiers go to the import map or the network.
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*(['"])(\.\.?\/[^'"]+)\1/g;
// What a page loads itself: scripts and stylesheets, not links a visitor follows.
const RESOURCE = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]+)"/g;
const local = ref => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
// Usage examples in doc comments are not imports.
const code = source => source.split('\n').filter(line => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join('\n');
const exists = file => access(file).then(() => true, () => false);

test('every relative import the demo pages can reach resolves inside the bundle', async () => {
  const pages = (await files(out)).filter(file => file.endsWith('.html'));
  // The pages' own scripts and stylesheets, then embed.mjs, the module a host page imports.
  const edges = [];
  for (const page of pages) {
    for (const [, ref] of (await readFile(page, 'utf8')).matchAll(RESOURCE)) if (local(ref)) edges.push([page, ref]);
  }
  edges.push([path.join(out, 'index.html'), 'wall/embed.mjs']);
  const missing = [], checked = [], read = new Set();
  while (edges.length) {
    const [from, ref] = edges.shift();
    const target = path.resolve(path.dirname(from), ref.split(/[?#]/)[0]);
    const edge = `${path.relative(out, from)} → ${ref}`;
    checked.push(edge);
    if (!target.startsWith(out + path.sep) || !await exists(target)) { missing.push(edge); continue; }
    if (!/\.m?js$/.test(target) || read.has(target)) continue;
    read.add(target);
    for (const [, , spec] of code(await readFile(target, 'utf8')).matchAll(IMPORT)) edges.push([target, spec]);
  }
  assert.deepEqual(missing, []);
  // A crawl that follows nothing passes everything: the aisle must have been reached and read.
  for (const module of ['wall/wall.mjs', 'wall/aisle-view.mjs', 'wall/album-walls.mjs']) {
    assert.ok(read.has(path.join(out, module)), `${module} was not reached from the demo page`);
  }
  assert.ok(checked.length > 50, `only ${checked.length} references followed`);
});

test('the demo bundle leaves the comparison workbench out', async () => {
  const names = (await files(path.join(out, 'wall'))).map(file => path.relative(out, file));
  assert.ok(names.includes('wall/aisle-view.mjs'), 'the aisle is not shipped');
  for (const workbench of ['wall/compare.html', 'wall/comparison.css', 'wall/comparison-app.mjs', 'wall/comparison-scene.mjs', 'wall/comparison-view.mjs', 'wall/comparison-model.mjs']) {
    assert.ok(!names.includes(workbench), `${workbench} is in the demo`);
  }
});

test('analytics ship with the demo page, stamped, and nowhere in the engine', async () => {
  const script = await readFile(path.join(out, 'analytics.js'), 'utf8');
  assert.ok(!script.includes('__WUNDERKAMMER_DEMO_VERSION__'), 'the build did not stamp a version');
  assert.match(script, /const APP_VERSION = "[^"]+";/);
  const page = await readFile(path.join(out, 'index.html'), 'utf8');
  assert.equal(page.match(/<script type="module" src="analytics\.js"><\/script>/g)?.length, 1);
  // Ahead of the wall, so it reads the URL before the wall writes its view into the hash.
  assert.ok(page.indexOf('src="analytics.js"') < page.indexOf('src="wall/wall.mjs"'), 'analytics.js loads after the wall');
  // A page that embeds wunderkammer from the package or a CDN must report to nobody.
  const engine = (await files(path.join(out, 'wall'))).filter(file => /\.(m?js|html)$/.test(file));
  for (const file of [...engine, path.join(root, 'index.html')]) {
    assert.ok(!/posthog|phc_/i.test(await readFile(file, 'utf8')), `${path.relative(out, file)} carries analytics`);
  }
});
