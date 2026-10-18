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
    name: 'cluster union silently becomes intersection', file: 'wall/context-clusters.mjs',
    from: 'new Set(branches.flatMap(branch => branch.keys))',
    to: 'new Set(branches[0]?.keys.filter(key => branches.every(branch => branch.keys.includes(key))))',
    test: 'tests/context-clusters.test.mjs', pattern: 'cluster scope switches or unions exact members',
  },
  {
    name: 'Shift-click replaces instead of adding', file: 'wall/wall.mjs',
    from: 'selectCluster(cluster, e.shiftKey)', to: 'selectCluster(cluster, false)',
    test: 'tests/flat-wall.test.mjs', pattern: 'cluster suggestions switch scope',
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
    // Anchored on the main layout call: the same option now also appears earlier,
    // in the background plane's layout, which this test does not measure.
    from: '// The similarity map places the corpus once; a filter hides, never re-projects.\n    viewportAspect: state.renderAspect',
    to: '// The similarity map places the corpus once; a filter hides, never re-projects.\n    wallWidth: 2500',
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
    name: 'wall page loads its assets by root path', file: 'index.html',
    from: '<script type="module" src="wall/wall.mjs"></script>', to: '<script type="module" src="/wall/wall.mjs"></script>',
    test: 'tests/cdn-subpath.test.mjs', pattern: 'the wall boots from a CDN sub-path',
  },
  {
    name: 'mount() defaults to a directory URL a CDN does not serve as the page', file: 'wall/embed.mjs',
    from: "new URL('../index.html', import.meta.url)", to: "new URL('../', import.meta.url)",
    test: 'tests/cdn-subpath.test.mjs', pattern: 'from a CDN finds the wall page',
  },
  {
    name: 'npm package leaves out the wall page', file: 'package.json',
    from: '    "index.html",\n', to: '',
    test: 'tests/cdn-subpath.test.mjs', pattern: 'the published package includes the wall page',
  },
  {
    name: 'comparison page links back to the package folder', file: 'wall/comparison-app.mjs',
    from: "const wall=new URL('../index.html',location.href);", to: "const wall=new URL('../',location.href);",
    test: 'tests/cdn-subpath.test.mjs', pattern: 'the comparison page links back to the wall page',
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
  // The flat wall's cached overview picture during a zoom-out: MUTATION_FILTER=zoom-out
  {
    name: 'zoom-out painted tiles hide their hit targets', file: 'wall/overview-surface.css',
    from: '.tile.overview-painted > img { visibility: hidden; }', to: '.tile.overview-painted { visibility: hidden; }',
    test: 'tests/smooth-overview.test.mjs', pattern: 'zoom-out exposes decoded DOM at cached-picture edges',
  },
  {
    name: 'zoom-out repaints instead of showing decoded DOM at picture edges', file: 'wall/overview-surface.mjs',
    from: 'if (!covered && !(tile.image?.complete && tile.image.naturalWidth > 0) && !this.sheets?.slot(tile.source)) return false;',
    to: 'if (!covered) return false;',
    test: 'tests/smooth-overview.test.mjs', pattern: 'zoom-out exposes decoded DOM at cached-picture edges',
  },
  {
    name: 'zoom-out keeps exposed tiles hidden under a blank picture edge', file: 'wall/overview-surface.mjs',
    from: "else { this.painted.delete(node); node.classList.remove('overview-painted'); }", to: 'else {}',
    test: 'tests/smooth-overview.test.mjs', pattern: 'zoom-out exposes decoded DOM at cached-picture edges',
  },
  // Sprite sheets (docs/CONTRACT.md, "Sprite sheets"): MUTATION_FILTER=sprite
  {
    name: 'sprite cells accepted outside their sheet', file: 'wall/collection.mjs',
    from: 'if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > sheet.width || y + h > sheet.height) {', to: 'if (false) {',
    test: 'tests/collection.test.mjs', pattern: 'every sheet cell is checked against the sheet',
  },
  {
    name: 'sprite sheet sources skip the image scheme rule', file: 'wall/collection.mjs',
    from: 'const src = image(sheet.src, `${p}.src`);', to: 'const src = sheet.src;',
    test: 'tests/collection.test.mjs', pattern: 'sheet sources follow the image scheme rule',
  },
  {
    name: 'sprite sheets dropped by the collection loader', file: 'wall/collection-source.mjs',
    from: 'return { data: { clips, corpus, facets, ui, ...(sheets ? { sheets } : {}),', to: 'return { data: { clips, corpus, facets, ui,',
    test: 'tests/collection-view.test.mjs', pattern: 'shows them on the wall and in the detail pane',
  },
  {
    name: 'sprite tiles never get their cell', file: 'wall/wall.mjs',
    from: 'if (spriteCovers.serves(p.clip, devicePx(Math.max(p.w, p.h) * viewport.scale))) { revealSprite(node, id, p, positions); continue; }', to: '',
    test: 'tests/collection-view.test.mjs', pattern: 'shows them on the wall and in the detail pane',
  },
  {
    name: 'sprite detail pane shows no cover', file: 'wall/wall.mjs',
    from: 'const sprite = !clip.detailCover && spriteCovers.has(clip);', to: 'const sprite = false;',
    test: 'tests/collection-view.test.mjs', pattern: 'shows them on the wall and in the detail pane',
  },
  {
    name: 'sprite crops read the wrong cell', file: 'wall/sprite-covers.mjs',
    from: 'drawImage(image, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);\n      let blob',
    to: 'drawImage(image, 0, 0, cell.w, cell.h, 0, 0, cell.w, cell.h);\n      let blob',
    test: 'tests/sprite-covers.test.mjs', pattern: 'cropped from its own rectangle',
  },
  {
    name: 'sprite overview keys miss cells-only clips', file: 'wall/overview-surface.mjs',
    from: 'if (Array.isArray(clip.sheetSlots) && clip.sheetSlots.length) return spriteSource(clip);', to: '',
    test: 'tests/sprite-covers.test.mjs', pattern: 'the overview keys a cells-only clip by identity',
  },
  {
    name: 'sprite 3D atlas ignores cells', file: 'wall/spatial/spatial-view.mjs',
    from: 'return spriteCovers.serves(clips[i], need) ? spriteCovers.source(clips[i], need) ?? RETRY : null;', to: 'return null;',
    test: 'tests/collection-view.test.mjs', pattern: 'the 3D view draws sprite-sheet cells',
  },
  {
    name: 'sprite album walls ignore cells', file: 'wall/album-walls.mjs',
    from: 'const coverSource = clip => spriteCovers.has(clip) ? spriteSource(clip) : fileSource(clip);', to: 'const coverSource = clip => fileSource(clip);',
    test: 'tests/collection-view.test.mjs', pattern: 'compare.html shows sprite-sheet cells',
  },
  {
    name: 'sprite evidence thumbnails ignore cells', file: 'wall/comparison-app.mjs',
    from: 'const sprite=spriteCovers.has(clip),src=safeMedia(', to: 'const sprite=false,src=safeMedia(',
    test: 'tests/collection-view.test.mjs', pattern: 'compare.html shows sprite-sheet cells',
  },
  {
    name: 'sprite failed page keeps its cells, so nothing falls back', file: 'wall/sprite-covers.mjs',
    from: "const ok = cell => this.pages[cell.page].state !== 'failed';", to: 'const ok = () => true;',
    test: 'tests/collection-view.test.mjs', pattern: 'when a sheet page is missing, the wall',
  },
  {
    name: 'sprite fallback skips clips that have a file', file: 'wall/sprite-covers.mjs',
    from: 'if (larger || this.files.has(key)) return larger || null;', to: 'if (larger) return larger;',
    test: 'tests/sprite-covers.test.mjs', pattern: 'a failed page sends a clip with a file back to its file',
  },
  {
    name: 'sprite compare walls drop the file fallback', file: 'wall/album-walls.mjs',
    from: 'if (!bitmap && item.file) { loadFile(item, item.file); return; }', to: '',
    test: 'tests/collection-view.test.mjs', pattern: 'when a sheet page is missing, compare.html falls back',
  },
  {
    name: 'sprite cells win only where no file exists', file: 'wall/sprite-covers.mjs',
    from: "if (!Array.isArray(clip?.sheetSlots) || (hasFile(clip) && !covers)) continue;", to: "if (!Array.isArray(clip?.sheetSlots) || hasFile(clip)) continue;",
    test: 'tests/collection-view.test.mjs', pattern: 'cells serve every view even where a cover file exists',
  },
  {
    name: 'sprite failed overview level leaves the next one idle', file: 'wall/overview-sheets.mjs',
    from: "if (level.state === 'failed' && pending === 0 && this._lastNeed !== undefined) { this._next = null; this.ensure(this._lastNeed); }", to: '',
    test: 'tests/overview-sheets.test.mjs', pattern: 'a failed level starts the next one without waiting for the camera',
  },
  {
    name: 'sprite gate admits a sheet page no collection names', file: 'scripts/check-public.mjs',
    from: 'if (!page || !sheetPages.has(file))', to: 'if (!page)',
    test: 'tests/check-public.test.mjs', pattern: 'a sheet page no collection names',
  },
  {
    name: 'sprite gate skips the content hash', file: 'scripts/check-public.mjs',
    from: ".digest('hex') !== page[2])", to: ".digest('hex') === null)",
    test: 'tests/check-public.test.mjs', pattern: 'whose bytes changed under its name',
  },
  {
    name: 'float positions swap OKLab a and b', file: 'wall/float-space.mjs',
    from: 'x = lab[1] * WORLD * stretch; y = (L - 0.5) * WORLD; z = lab[2] * WORLD * stretch;',
    to: 'x = lab[2] * WORLD * stretch; y = (L - 0.5) * WORLD; z = lab[1] * WORLD * stretch;',
    test: 'tests/float-view.test.mjs', pattern: 'float arrangement places each item',
  },
  {
    name: 'float HSL radius uses saturation (a cylinder)', file: 'wall/float-space.mjs',
    from: 'r = RADIUS * S * (1 - Math.abs(2 * Lh - 1))', to: 'r = RADIUS * S',
    test: 'tests/float-view.test.mjs', pattern: 'float arrangement places each item',
  },
  {
    name: 'float arrangement change leaves items where they were', file: 'wall/float-view.mjs',
    from: 'if (still) { this.field.place(i, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], s[i * 2], s[i * 2 + 1], q); continue; }',
    to: 'if (still) continue;',
    test: 'tests/float-view.test.mjs', pattern: 'float arrangement places each item',
  },
  {
    name: 'float arrangement change jumps instead of travelling', file: 'wall/float-view.mjs',
    from: 'this.field.moveTo(i, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], s[i * 2], s[i * 2 + 1], q);',
    to: 'this.field.place(i, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], s[i * 2], s[i * 2 + 1], q);',
    test: 'tests/float-view.test.mjs', pattern: 'float arrangement places each item',
  },
  {
    name: 'float click opens without flying', file: 'wall/float-view.mjs',
    from: 'if (fly) this.flyTo(key);', to: '',
    test: 'tests/float-view.test.mjs', pattern: 'float fly-to',
  },
  {
    name: 'float fly-to lands under the detail pane', file: 'wall/float-view.mjs',
    from: 'const obscured = clamp(this.callbacks.obscuredRight?.() || 0, 0, this.width * 0.7);', to: 'const obscured = 0;',
    test: 'tests/float-view.test.mjs', pattern: 'float fly-to',
  },
  {
    name: 'float scope hides instead of dimming', file: 'wall/float-view.mjs',
    from: "dim = this.dimMode === 'brightness' ? FLOAT_DIM : 0;", to: 'dim = 0;',
    test: 'tests/float-view.test.mjs', pattern: 'float scope dims',
  },
  {
    name: 'float scope never dims', file: 'wall/float-view.mjs',
    from: 'opacity[i] = this.inScope[i] ? 1 : dim;', to: 'opacity[i] = 1;',
    test: 'tests/float-view.test.mjs', pattern: 'float scope dims',
  },
  {
    name: 'float scope re-places the space around the scope', file: 'wall/wall.mjs',
    from: 'state.float.setClips(state.clips,state.filtered);', to: 'state.float.setClips(state.filtered,state.filtered);',
    test: 'tests/float-view.test.mjs', pattern: 'float scope dims',
  },
  {
    name: 'float dimming never reaches the GPU', file: 'wall/float-view.mjs',
    from: 'gl_FragColor = vec4(shown * vOpacity, 1.0);', to: 'gl_FragColor = vec4(shown, 1.0);',
    test: 'tests/float-view.test.mjs', pattern: 'float scope dims',
  },
  {
    // Upstream TileField encodes its output. The float view's dim patch is
    // anchored on those output lines, so reverting their text would also trip
    // the anchor guard (dimMode 'hidden') and prove nothing about the pixel
    // check. A macro turns the encoder into the identity instead: the anchors
    // still match, the dim patch still applies, and only encoding is gone.
    name: 'float frames skip sRGB output encoding', file: 'wall/spatial/lib/instanced.js',
    from: 'const FRAG = /* glsl */`\n', to: 'const FRAG = /* glsl */`\n#define linearToOutputTexel(value) (value)\n',
    test: 'tests/float-view.test.mjs', pattern: 'float scope dims',
  },
  {
    name: 'float slot lookup floors an interpolated index', file: 'wall/spatial/lib/instanced.js',
    from: 'float slotIndex = floor(vSlot + 0.5);\n  float row = floor((slotIndex + 0.5) / grid.x);\n  float col = slotIndex - row * grid.x;',
    to: 'float col = mod(vSlot, grid.x);\n  float row = floor(vSlot / grid.x);',
    test: 'tests/float-view.test.mjs', pattern: 'float scope dims',
  },
  {
    // The 3D view draws the upstream shader unpatched, so the plain revert to
    // the old output lines is the honest mutation here.
    name: 'spatial 3D tiles skip sRGB output encoding', file: 'wall/spatial/lib/instanced.js',
    change: source => source
      .replace('gl_FragColor = linearToOutputTexel(vec4(emptyColor, 1.0));', 'gl_FragColor = vec4(emptyColor, 1.0);')
      .replace('gl_FragColor = linearToOutputTexel(vec4(c.rgb, c.a * vOpacity));', 'gl_FragColor = vec4(c.rgb, c.a * vOpacity);'),
    test: 'tests/spatial-view.test.mjs', pattern: '3D tiles draw their cover colour',
  },
  {
    name: 'spatial 3D slot lookup floors an interpolated index', file: 'wall/spatial/lib/instanced.js',
    from: 'float slotIndex = floor(vSlot + 0.5);\n  float row = floor((slotIndex + 0.5) / grid.x);\n  float col = slotIndex - row * grid.x;',
    to: 'float col = mod(vSlot, grid.x);\n  float row = floor(vSlot / grid.x);',
    test: 'tests/spatial-view.test.mjs', pattern: '3D tiles draw their cover colour',
  },
  {
    name: 'float dimmed items take clicks', file: 'wall/float-view.mjs',
    from: '      if (!this.inScope[i]) continue;\n      this.centreOf(i, v);\n      const depth', to: '      this.centreOf(i, v);\n      const depth',
    test: 'tests/float-view.test.mjs', pattern: 'float scope dims',
  },
  {
    name: 'float camera lost from permalink', file: 'wall/wall.mjs',
    from: '    ...((state.floatSnapshot || state.float?.captureView()) ? {float:state.floatSnapshot || state.float?.captureView()} : {}),\n', to: '',
    test: 'tests/float-view.test.mjs', pattern: 'float arrangement and camera survive',
  },
  {
    name: 'float live link drops the arrangement', file: 'wall/view-intent.mjs',
    from: "  if (view.presentation.mode === 'float') p.set('arrange', view.float.arrangement);", to: '',
    test: 'tests/float-view.test.mjs', pattern: 'float arrangement and camera survive',
  },
  {
    name: 'float flight starts a second render loop', file: 'wall/float-view.mjs',
    from: 'if (this.frame || this.ticking || this.disposed', to: 'if (this.frame || this.disposed',
    test: 'tests/float-view.test.mjs', pattern: 'float arrangement places each item',
  },
  {
    name: 'float Axes declumps items off their attribute planes', file: 'wall/float-space.mjs',
    from: "let free = coords.map(c => c.free);", to: "let free = [true, true, true];",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Axes moves planes when no colour axis is left', file: 'wall/float-space.mjs',
    from: "  if (!free.some(Boolean)) free = coords.map(c => c.kind === 'continuous');\n", to: "",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Axes parks missing values at the axis start', file: 'wall/float-space.mjs',
    from: "slot(`No ${label}`, -MISSING_GAP, missing);", to: "slot(`No ${label}`, 0, missing);",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Axes hue axis always starts at 0°', file: 'wall/float-space.mjs',
    from: "hueStart = hueCut(placed.filter(c => c[1] >= GREY_CHROMA).map(c => c[2]));", to: "hueStart = 0;",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Axes spaces dates by rank', file: 'wall/float-space.mjs',
    from: "else u[i] = mark.rank; });", to: "else u[i] = model.domain.indexOf(mark.valueLabel) / (model.domain.length - 1); });",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Axes gives greys a hue', file: 'wall/float-space.mjs',
    from: "if (c && c[1] < GREY_CHROMA) greys.push(i);", to: "if (c && c[1] < 0) greys.push(i);",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Axes choice duplicates instead of swapping', file: 'wall/float-view.mjs',
    from: "    if (other) next[other] = next[axis];\n", to: "",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Axes lost from permalink', file: 'wall/float-view.mjs',
    from: "...(this.axes ? { axes: { ...this.axes } } : {}), ", to: "",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes choices survive',
  },
  {
    name: 'float live link drops the axes', file: 'wall/view-intent.mjs',
    from: "  if (view.presentation.mode === 'float' && view.float.arrangement === 'axes') for (const axis of AXES) if (view.float.axes?.[axis]) p.set(axis, view.float.axes[axis]);\n", to: "",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes choices survive',
  },
  {
    name: 'float link with an impossible axis falls back silently', file: 'wall/wall.mjs',
    from: "    if (bad) throw new Error(", to: "    if (false) throw new Error(",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes choices survive',
  },
  {
    name: 'float intent accepts two axes on one dimension', file: 'wall/view-intent.mjs',
    from: "if (new Set(Object.values(axes)).size !== axisParams.length) invalid(", to: "if (false) invalid(",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes choices survive',
  },
  {
    name: 'float view schema accepts two axes on one dimension', file: 'wall/float-space.mjs',
    from: "return new Set(keys.map(k => axes[k])).size === keys.length;", to: "return true;",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes choices survive',
  },
  {
    name: 'float intent applies axes to another arrangement', file: 'wall/view-intent.mjs',
    from: "if (p.has('arrange') && p.get('arrange') !== 'axes') invalid(", to: "if (false) invalid(",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes choices survive',
  },
  {
    name: 'float Axes greys stand between the camera and the data', file: 'wall/float-space.mjs',
    from: "  depth.u = depth.u.map(behind); for (const s of depth.slots) s.u = behind(s.u);\n", to: "",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Fit ignores where labels are drawn', file: 'wall/float-view.mjs',
    from: "      }) && ndc.every(([a, ox, oy, hw, hh]) => {", to: "      }) || ndc.every(([a, ox, oy, hw, hh]) => {",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Axes Depth title covers its slots', file: 'wall/float-space.mjs',
    from: "[Math.max(1, ...depth.slots.map(s => s.u)) + 0.08, 'above', 24]];", to: "[1, 'above', 12]];",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float labels centre on their anchors', file: 'wall/float-view.mjs',
    from: "      const [ox, oy] = labelOffset(label); x += ox; y += oy;", to: "",
    test: 'tests/float-view.test.mjs', pattern: 'float Axes places each item',
  },
  {
    name: 'float Fit shrinks the space until wide labels fit', file: 'wall/float-view.mjs',
    from: "        return Math.abs(nx) <= 0.98 && Math.abs(ny + oy) + hh <= half;", to: "        return Math.abs(nx + ox) + hw <= 0.98 && Math.abs(ny + oy) + hh <= half;",
    test: 'tests/float-view.test.mjs', pattern: 'float phone layout',
  },
  {
    name: 'sprite floating space ignores cells', file: 'wall/float-view.mjs',
    from: 'return spriteCovers.serves(clips[i], need) ? spriteCovers.source(clips[i], need) ?? RETRY : null;', to: 'return null;',
    test: 'tests/collection-view.test.mjs', pattern: 'the floating space draws sprite-sheet cells',
  },
];

const selectedCases = cases.filter(c => c.name.includes(process.env.MUTATION_FILTER || ''));
if (!selectedCases.length) throw new Error('No mutation matched MUTATION_FILTER');
for (const mutation of selectedCases) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-mutation-'));
  try {
    for (const file of ['clip.mjs', 'index.html', 'lib', 'wall', 'tests', 'scripts', 'package.json']) {
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
