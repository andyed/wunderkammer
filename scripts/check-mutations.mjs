#!/usr/bin/env node
// Prove safety checks fail with the protections removed, in disposable copies.
import { cp, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  {
    name: 'facet availability incorrectly keeps its own restriction', file: 'wall/facet-model.mjs',
    from: 'failed.length === 0 || failed.length === 1 && failed[0] === key',
    to: 'failed.length === 0',
    test: 'tests/facet-model.test.mjs', pattern: 'contextual availability omits only its own facet',
  },
  {
    name: 'facet local search loses active values outside its result', file: 'wall/facet-model.mjs',
    from: 'for (const row of facet.values) if (row.active) visible.add(row.value);', to: '',
    test: 'tests/facet-model.test.mjs', pattern: 'stable ordering and local value search retain active tail values',
  },
  {
    name: 'attribute sort lost from permalink', file: 'wall/wall.mjs',
    from: 'sort: { ...state.sort }', to: "sort: { key: 'none', direction: 'asc' }",
    test: 'tests/attribute-view.test.mjs', pattern: 'sort reverses within groups',
  },
  {
    name: 'attribute hover commits a pin', file: 'wall/attribute-brush.mjs',
    from: 'const preview = (key, value = null) => show(key, value);',
    to: 'const preview = (key, value = null) => { setPinned(key); show(key, value); };',
    test: 'tests/attribute-view.test.mjs', pattern: 'attribute hover previews preserve',
  },
  {
    name: 'responsive cover ignores transformed screen size', file: 'wall/wall.mjs',
    from: 'img.sizes = sizes;', to: 'img.sizes = \"100vw\";',
    test: 'tests/flat-wall.test.mjs', pattern: 'responsive cover images use screen size',
  },
  {
    name: 'permalink camera silently replaced by Fit', file: 'wall/viewport.mjs',
    from: 'restore(view) {', to: 'restore(view) { this.fit(); return;',
    test: 'tests/permalinks.test.mjs', pattern: 'address bar round-trips filters',
  },
  {
    name: 'permalink reference content silently replaced', file: 'lib/permalinks.mjs',
    from: 'return send(res, 200, validateView(JSON.parse(body)));',
    to: "return send(res, 200, { ...validateView(JSON.parse(body)), scope: { query: '', facets: [], branches: null } });",
    test: 'tests/permalinks.test.mjs', pattern: 'view codec validates versions',
  },
  {
    name: 'context appears at ordinary overview zoom', file: 'wall/wall.mjs',
    from: 'visible > 0 && distant && sparse && (topFits || bottomFits)',
    to: 'visible > 0',
    test: 'tests/flat-wall.test.mjs', pattern: 'context clusters switch scope',
  },
  {
    name: 'cluster union silently becomes intersection', file: 'wall/context-clusters.mjs',
    from: 'new Set(branches.flatMap(branch => branch.keys))',
    to: 'new Set(branches[0]?.keys.filter(key => branches.every(branch => branch.keys.includes(key))))',
    test: 'tests/context-clusters.test.mjs', pattern: 'cluster scope switches or unions exact members',
  },
  {
    name: 'Shift-click replaces instead of adding', file: 'wall/wall.mjs',
    from: 'selectCluster(cluster, e.shiftKey)', to: 'selectCluster(cluster, false)',
    test: 'tests/flat-wall.test.mjs', pattern: 'context clusters switch scope',
  },
  {
    name: 'native image drag cancels canvas gesture', file: 'wall/wall.mjs',
    from: 'img.draggable = false; // native image dragging', to: 'img.draggable = true; // native image dragging',
    test: 'tests/flat-wall.test.mjs', pattern: 'edge-pan prototype enlarges rendered tiles',
  },
  {
    name: 'edge drag silently stays bounded', file: 'wall/viewport.mjs',
    from: "zoom: drag && this.panMode === 'edge'", to: 'zoom: false',
    test: 'tests/flat-wall.test.mjs', pattern: 'edge-pan prototype enlarges rendered tiles',
  },
  {
    name: 'revealed tile keeps a stale caption tier', file: 'wall/wall.mjs',
    from: 'if (visible && tileEls === state.tileEls && !(travelling && p.shown)) applyCaptionTier(node, tier);', to: '',
    test: 'tests/flat-wall.test.mjs', pattern: 'a landed zoom restyles only on-screen captions',
  },
  {
    name: 'zoom landing sweeps every caption', file: 'wall/wall.mjs',
    from: 'if (state.positions.get(id)?.shown) applyCaptionTier(node);', to: 'if (state.positions.get(id)) applyCaptionTier(node);',
    test: 'tests/flat-wall.test.mjs', pattern: 'a landed zoom restyles only on-screen captions',
  },
  {
    name: 'pinch loads images mid-gesture', file: 'wall/wall.mjs',
    from: 'const zooming = viewport.zooming;', to: 'const zooming = false;',
    test: 'tests/flat-wall.test.mjs', pattern: 'a pinch defers caption tiers',
  },
  {
    name: 'fixed-width detail pane', file: 'wall/wall.css',
    from: 'width: var(--detail-size);', to: 'width: 380px;',
    test: 'tests/flat-wall.test.mjs', pattern: 'detail scales and resizes over a stable collection',
  },
  {
    name: 'spatial fixed camera framing', file: 'wall/spatial/spatial-view.mjs',
    from: 'position: [centre.x, centre.y, z], target: [centre.x, centre.y, 0]',
    to: 'position: [0, 820, 3000], target: [0, 0, 0]',
    test: 'tests/spatial-view.test.mjs', pattern: 'spatial overview fills the pane',
  },
  {
    name: 'spatial autonomous camera movement', file: 'wall/spatial/spatial-view.mjs',
    from: 'this.camera.position.copy(this.basePos);',
    to: 'this.basePos.x += 0.2; this.camera.position.copy(this.basePos);',
    test: 'tests/spatial-view.test.mjs', pattern: 'spatial overview fills the pane',
  },
  {
    name: 'fixed-width overview collapse', file: 'wall/wall.mjs',
    from: 'viewportAspect: state.renderAspect',
    to: 'wallWidth: 2500',
    test: 'tests/flat-wall.test.mjs', pattern: 'rendered overview fills available space',
  },
  {
    name: 'collapsed tag occurrences', file: 'wall/wall.mjs',
    from: "const key = JSON.stringify([t.group ?? '', clip.id]);", to: 'const key = clip.id;',
    test: 'tests/flat-wall.test.mjs', pattern: 'every tag occurrence renders',
  },
  {
    name: 'duplicate-capture guard', file: 'lib/capture-store.mjs',
    from: 'export async function findExistingClip(clipsDir, url) {',
    to: 'export async function findExistingClip(clipsDir, url) { return null;',
    test: 'tests/capture.test.mjs', pattern: 're-clipping preserves edited research',
  },
  {
    name: 'atomic no-replace note publication', file: 'lib/capture-store.mjs',
    from: 'await link(tmp, file);', to: 'await writeFile(file, bytes);',
    test: 'tests/capture.test.mjs', pattern: 'concurrent file creation publishes one complete winner',
  },
  {
    name: 'quoted-string preservation', file: 'lib/frontmatter.mjs',
    from: 'return JSON.stringify(s);', to: 'return s;',
    test: 'tests/capture.test.mjs', pattern: 'capture frontmatter preserves ordinary strings',
  },
  {
    name: 'concurrent view-state writes', file: 'lib/view-state.mjs',
    change: (source) => source
      .replace('${file}.${process.pid}.${randomUUID()}.tmp', '${file}.${process.pid}.tmp')
      .replace('const saved = pending.then(() => replace(body));', 'const saved = replace(body);'),
    test: 'tests/view-state.test.mjs', pattern: 'twelve simultaneous HTTP saves',
  },
  {
    name: 'similarity spacing pass skipped', file: 'wall/similarity-layout.mjs',
    from: 'if (!free(r)) {', to: 'if (false) {',
    test: 'tests/similarity-layout.test.mjs', pattern: 'similarity map has no overlapping tiles',
  },
  {
    name: 'similarity filter re-projects survivors', file: 'wall/similarity-layout.mjs',
    from: 'let u = placeUniverse(o.universe || clips, o, justify);', to: 'let u = placeUniverse(clips, o, justify);',
    test: 'tests/similarity-layout.test.mjs', pattern: 'a filter hides tiles in place',
  },
  {
    name: 'similarity spread ignores the screen-size band', file: 'wall/spatial/spatial-view.mjs',
    from: ': spreadScale(natural);', to: ': 1;',
    test: 'tests/spatial-view.test.mjs', pattern: 'similarity map spreads on zoom',
  },
  {
    name: 'similarity grid re-packs survivors', file: 'wall/similarity-layout.mjs',
    from: 'x: clip.projection.col * (cw + o.gap) + (cw - w) / 2, y: clip.projection.row * (ch + o.gap) + (ch - h) / 2',
    to: 'x: (tiles.length % 30) * (cw + o.gap) + (cw - w) / 2, y: Math.floor(tiles.length / 30) * (ch + o.gap) + (ch - h) / 2',
    test: 'tests/similarity-layout.test.mjs', pattern: 'a filter leaves holes',
  },
  {
    name: 'spatial cache identity', file: 'wall/spatial/spatial-view.mjs',
    from: 'if (replace) this._replaceField();', to: 'if (false) this._replaceField();',
    test: 'tests/spatial-view.test.mjs', pattern: 'GPU pixels refresh after an index is reused',
  },
  {
    name: 'zoom detail never opens on zoom-in', file: 'wall/zoom-detail.mjs',
    from: 'export const ZOOM_DETAIL_OPEN = 0.5;', to: 'export const ZOOM_DETAIL_OPEN = 5;',
    test: 'tests/zoom-detail.test.mjs', pattern: 'zooming into a cover shows its details',
  },
  {
    name: 'zoom detail commits a selection', file: 'wall/wall.mjs',
    from: 'if (clip) showZoomPreview(clip);', to: 'if (clip) openDetail(clip);',
    test: 'tests/zoom-detail.test.mjs', pattern: 'zooming into a cover shows its details',
  },
  {
    name: 'zoom detail ignores the pane when choosing the centre', file: 'wall/wall.mjs',
    from: 'rail: stage.right - (window.innerWidth - el.detail.offsetWidth),', to: 'rail: 0,',
    test: 'tests/zoom-detail.test.mjs', pattern: 'zooming into a cover shows its details',
  },
  {
    name: 'zoom detail survives zooming out', file: 'wall/wall.mjs',
    from: 'if (!pick) { zoomDismissed = null; if (previewByZoom) endPreview(); return; }',
    to: 'if (!pick) { zoomDismissed = null; return; }',
    test: 'tests/zoom-detail.test.mjs', pattern: 'zooming back out hides the details',
  },
  {
    name: 'zoom detail closes at the open threshold', file: 'wall/zoom-detail.mjs',
    from: 'export const ZOOM_DETAIL_CLOSE = 0.4;', to: 'export const ZOOM_DETAIL_CLOSE = 0.5;',
    test: 'tests/zoom-detail.test.mjs', pattern: 'no flapping near the threshold',
  },
  {
    name: 'zoom detail decided mid-gesture', file: 'wall/wall.mjs',
    from: 'const wait = Math.max(0, viewport.settlesAt - performance.now()) + ZOOM_DETAIL_QUIET;', to: 'const wait = 0;',
    test: 'tests/zoom-detail.test.mjs', pattern: 'no flapping near the threshold',
  },
  {
    name: 'Escape on a zoom preview is undone by the next landing', file: 'wall/wall.mjs',
    from: 'if (state.preview) { dismissZoomPreview(); endPreview(); }', to: 'if (state.preview) { endPreview(); }',
    test: 'tests/zoom-detail.test.mjs', pattern: 'Escape puts a zoom preview away',
  },
  {
    name: 'collection accepts any link scheme', file: 'wall/collection.mjs',
    from: "if (!['http:', 'https:'].includes(url.protocol)) { problem(path, 'must be an http(s) URL'); return null; }", to: '',
    test: 'tests/collection.test.mjs', pattern: 'link schemes are http',
  },
  {
    name: 'collection media resolve against the page instead of the document', file: 'wall/collection-source.mjs',
    from: 'validateCollection(input, { baseUrl })', to: 'validateCollection(input, { baseUrl: null })',
    test: 'tests/collection-view.test.mjs', pattern: 'boots the wall from one document',
  },
  {
    name: 'collection 3D view still routes covers through the instance proxy', file: 'wall/wall.mjs',
    from: 'if (collection) setProxyAvailable(false);', to: '',
    test: 'tests/collection-view.test.mjs', pattern: 'loads remote covers directly with CORS',
  },
  {
    name: 'collection problem text reaches any embedder', file: 'wall/wall.mjs',
    from: 'message: collection === FROM_PARENT', to: 'message: true',
    test: 'tests/collection-view.test.mjs', pattern: 'tells its parent only that loading failed',
  },
  {
    name: 'collection loader skips validation', file: 'wall/collection-source.mjs',
    from: 'const { collection, warnings } = validateCollection(input, { baseUrl });',
    to: 'const { collection, warnings } = { collection: { ...input, facets: {}, ui: input.ui || {} }, warnings: [] };',
    test: 'tests/collection-view.test.mjs', pattern: 'an invalid collection shows every problem',
  },
  {
    name: 'observation figures use the wrong denominator', file: 'wall/observations.mjs',
    from: 'denominator: denominators.get(c.cohort), share: c.share });', to: 'denominator: model.uniqueCount, share: c.share });',
    test: 'tests/observations.test.mjs', pattern: 'figures beside an observation equal',
  },
  {
    name: 'observation selection falls back to the plain evidence', file: 'wall/comparison-app.mjs',
    from: 'evidence=cited?observationEvidence(model,cited):selectEvidence(model,state.selection);', to: 'evidence=selectEvidence(model,state.selection);',
    test: 'tests/comparison-view.test.mjs', pattern: 'selecting an observation shows exactly the union',
  },
  {
    name: 'observation text rendered as markup', file: 'wall/comparison-app.mjs',
    from: 'text.textContent=o.text;', to: 'text.innerHTML=o.text;',
    test: 'tests/comparison-view.test.mjs', pattern: 'authored observation text is shown as text',
  },
  {
    name: 'observations never go stale', file: 'wall/comparison-app.mjs',
    from: 'function observationsStale(){return !!state.observations && canonical(state.observations.comparison)!==canonical(state.spec);}',
    to: 'function observationsStale(){return false;}',
    test: 'tests/comparison-view.test.mjs', pattern: 'observations go stale when the comparison changes',
  },
  {
    name: 'observation selection ignored by the album walls', file: 'wall/album-walls.mjs',
    change: source => source.replace(/if \(pick\?\.observation\) \{[^\n]*\}\n/, 'if (pick?.observation) return null;\n'),
    test: 'tests/comparison-view.test.mjs', pattern: 'album walls highlight exactly the places',
  },
  {
    name: 'export highlight ignores the pinned value', file: 'wall/wall.mjs',
    from: 'state.filtered.filter(clip => matchesFacet(clip, key, new Set([String(value)])))', to: 'state.filtered.filter(() => true)',
    test: 'tests/collection-view.test.mjs', pattern: 'reports scope, highlight, focus',
  },
  {
    name: 'compare collection is ignored for the server', file: 'wall/comparison-app.mjs',
    from: '  if(collection){const loaded=await loadCollection(collection);', to: '  if(false){const loaded=await loadCollection(collection);',
    test: 'tests/collection-view.test.mjs', pattern: 'compare.html runs a collection, its comparison',
  },
  {
    name: 'compare collection dropped from comparison links', file: 'wall/comparison-app.mjs',
    from: 'function withCollection(url){if(collection)url.searchParams.set', to: 'function withCollection(url){if(false)url.searchParams.set',
    test: 'tests/collection-view.test.mjs', pattern: 'compare.html runs a collection, its comparison',
  },
  {
    name: 'compare collection thumbnails limited to the same origin', file: 'wall/comparison-app.mjs',
    from: "    if(collection)return u.protocol==='data:'", to: "    if(false)return u.protocol==='data:'",
    test: 'tests/collection-view.test.mjs', pattern: 'compare.html shows remote CORS covers',
  },
  {
    name: 'compare collection walls still use the instance proxy', file: 'wall/comparison-app.mjs',
    from: 'if (collection) setProxyAvailable(false);', to: '',
    test: 'tests/collection-view.test.mjs', pattern: 'compare.html shows remote CORS covers',
  },
];

const selectedCases = cases.filter(c => c.name.includes(process.env.MUTATION_FILTER || ''));
if (!selectedCases.length) throw new Error('No mutation matched MUTATION_FILTER');
for (const mutation of selectedCases) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-mutation-'));
  try {
    for (const file of ['clip.mjs', 'lib', 'wall', 'tests', 'package.json']) {
      await cp(path.join(root, file), path.join(dir, file), { recursive: true });
    }
    await symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    const file = path.join(dir, mutation.file);
    const source = await readFile(file, 'utf8');
    const changed = mutation.change ? mutation.change(source) : source.replace(mutation.from, mutation.to);
    if (source === changed) throw new Error(`${mutation.name}: source no longer matches mutation`);
    await writeFile(file, changed);
    const result = spawnSync(process.execPath, [
      '--test', '--test-reporter=tap', `--test-name-pattern=${mutation.pattern}`, mutation.test,
    ], { cwd: dir, encoding: 'utf8', timeout: 60000, maxBuffer: 2 << 20 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    // Environment/syntax failures do not count as caught regressions.
    const assertionFailed = output.split('\n').some((line) => /^not ok \d+ - /.test(line) && line.includes(mutation.pattern));
    if (result.error || !result.status || !assertionFailed) {
      throw new Error(`${mutation.name}: expected assertion failure was not demonstrated\n${output}\n${result.error || ''}`);
    }
    console.log(`✓ detected ${mutation.name}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
console.log(`${selectedCases.length} regression mutations detected.`);
