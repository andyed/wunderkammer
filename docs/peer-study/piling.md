# Peer study: Piling.js

Peer key `piling`. Read and run 2026-10-13. All citations are `piling.js@9983067` unless named
otherwise; `lib.js` below means `src/library.js`.

## Pin, licence, notices

- Repo: https://github.com/flekschas/piling.js, cloned to `<peer-study workspace>/piling.js`.
  `git rev-parse --short HEAD` = `9983067` (tag 0.10.0, 2022-02-12). The npm tarball
  `piling.js@0.10.0` records `gitHead 9983067f…`, so it is the same build. I built from source anyway.
- Licence: MIT, `LICENSE`, "Copyright (c) 2019 Xinyi Zhou and Fritz Lekschas". To copy code, keep that
  copyright line and the permission notice in a NOTICE file or a file header. The host instances also
  vendor PixiJS 5.1.6 (MIT, its own header in `pixi.min.js`).
- Paper: Lekschas, Zhou, Chen, Gehlenborg, Bach, Pfister, *A Generic Framework and Library for
  Exploration of Small Multiples through Interactive Piling*, IEEE TVCG 27(2) 358–368, 2021
  (`CITATION.bib`; already in wunderkammer `docs/PRECEDENTS.md`).

## Build and run recipe

- Build: `npm ci` fails because the lockfile is out of sync (eslint-plugin-react and others are missing
  from it). Use `npm install --ignore-scripts --legacy-peer-deps --no-save` with Node 26, then
  `./node_modules/.bin/rollup -c`. This writes `dist/piling.min.js` (UMD, global `pilingJs`; PixiJS is
  external as `PIXI`) and the ESM builds. It ran on Node 26 with no old-Node shim. The only noise is
  a "Bad CPU type" from an x86 `term-size` binary that `rollup-plugin-filesize` calls; it is harmless.
- Converter: `wunderkammer/scripts/peer-perf/convert-piling.mjs <corpus> <instance> --arrange <facet> --group <facet>`.
  It writes `data.json` and `config.json`, copies the host page from `scripts/peer-perf/piling-host/`
  and `vendor/` (piling.min.js, pixi.min.js, LICENSE), and symlinks `images/`. It also copies
  `config.json` to `wunderkammer/.local/peer-study/piling/<corpus>/`.
  - Facets used: music grids by `decade`; psychodeli and synth10k grid by `kaleido`. Every corpus
    groups by `complexity` (3 values).
- Host page (`index.html` + `host.js`, about 60 lines): `createLibrary(el, { renderer:
  createImageRenderer(), items, columns, cellPadding: 2, navigationMode: 'panZoom', zoomScale: s => s,
  pileLabel: 'groupValue', pileSizeBadge })`. A 32 px button bar calls `arrangeBy('index','arrangeRank')`,
  `arrangeBy('data',['px','py'])`, `groupBy('category','groupValue')` and `splitAll()`. It follows
  `examples/photos.js`. There are two deliberate departures, both documented options:
  - `navigationMode: 'panZoom'`: in grid mode the default `'auto'` scrolls and cannot zoom (`lib.js:3138-3160`).
  - `zoomScale: s => s`: as in the photos example; by default piles do not scale with zoom (DOCS.md "zoomScale").
- Serve: `wunderkammer/.local/peer-study/piling/serve.sh`. It is idempotent: it kills its own ports, then
  starts `npx http-server … -c 3600` per corpus. Ports: **music 4350, psychodeli 4351, synth10k 4352**,
  all running.
- Driver: `wunderkammer/scripts/peer-perf/drivers/piling.mjs`.

### What the converter maps and loses

| Wunderkammer corpus field | Piling.js item field | How it is used |
|---|---|---|
| `id` | `id` | Item id and initial pile id |
| `image` | `src` | `createImageRenderer` loads it with `new Image()`, `image-renderer.js:6-26` |
| facet A, first value | `arrangeValue`, `arrangeRank` | Grid order |
| facet B, first value | `groupValue` | `groupBy('category')` and `pileLabel` |
| `projection.json` | `px`, `py` | y flipped so the map reads like the other peers |

Lost:
- All other facets (Piling.js has no facet UI).
- Multi-valued facets beyond their first value.
- Title, text, palette and date. Nothing displays text: there is no caption, tooltip or detail view.
- `features.npy`. `arrangeBy('data', 'src', { forceDimReduction: true })` could run its own UMAP in a
  worker, but we used the shared projection.

## Pipeline

```
data in   items [{src, ...anything}] via createLibrary/set('items')                 lib.js:3640-3700, DOCS.md "Data"
  → index   redux store (items, piles as {id, items[], x, y}); RBush spatial index of pile bboxes   store.js:816, lib.js:491-536
  → layout  grid (row-major cells) | 1-D order | 2-D data scale | UMAP worker | xy/uv/ij   grid.js:13-140, lib.js:1265-1320, 3308-3420
  → render  ALL item images loaded (Promise.all), one PIXI.Texture each, sprite per item, PIXI.Container per pile,
            camera applied by moving every pile on the CPU                         lib.js:1015-1031, 1140-1171, 540-545, 932-933
  → interaction dom-2d-camera pan/zoom; drag pile-onto-pile merge; lasso; context menu (depile, temp depile,
            browse separately, magnify); double-click temp depile; alt+wheel magnify   lib.js:4489, 2212-2252, 4966+, 4811-4842, 4844-4866
```

## Part 4 answers

### 1. Renderer abstraction and public API: is it a declarative spec? *(LLM direction)*

**Renderer abstraction.** A renderer is a function from an array of `src` values to a Promise of an array
of displayable things. That means textures, or anything `toDisplayObject` can turn into a PIXI object:
an `HTMLImageElement`, a canvas, an ndarray, a `PIXI.Graphics`, or a `Mesh`
(`image-renderer.js:20-26`, `utils/to-display-object.js:5-23`).

- **Three slots:**
  - `itemRenderer`, set via the `renderer` property (`lib.js:313-316`);
  - `previewRenderer`;
  - `coverRenderer`.
- **Two aggregators** feed them: `previewAggregator` and `coverAggregator` (`lib.js:1015-1083, 1562-1619`).
- **Built-ins** (`src/renderer.js:1-7`): image, matrix (regl shaders), SVG, D3, Vega-Lite, Observable Plot and
  representative. The SVG, D3, Vega-Lite and Plot renderers rasterise to an image and then become one
  texture each.
- **Single type per instance.** Every item uses the same renderer: DOCS.md "Data" says mixed types are
  unsupported, and the code calls `itemRenderer(itemList.map(src))` once (`lib.js:1029`).
- **Not renderer-agnostic in the substrate sense.** The README's "renderer-agnostic" means agnostic about
  *what draws an item*. The scene, piles, camera and interaction are fixed to PixiJS 5
  (`lib.js:1, 138-150`).

**Public API.** The API is imperative with declarative arguments. You call:
- `createLibrary(el, props)`;
- `set(prop, value)`;
- `arrangeBy(type, objective, options)`;
- `groupBy(type, objective, options)`;
- `splitBy`;
- `subscribe`;
- `exportState` / `importState` (DOCS.md "Methods", `lib.js:4189-4232, 2693-2766, 4078-4104`).

Objectives accept a property-name string, an object `{property, aggregator, scale, inverse}`, a
function, or an array of these (`lib.js:4106-4187`). So `arrangeBy('data', ['px','py'])` and
`groupBy('category', 'groupValue')` are pure JSON. Of about 104 state keys, most can be JSON: colours,
numbers, and property strings for `pileLabel` and similar.

It is **not a declarative spec end to end**, for these reasons:
- The renderer is a function and is required.
- Styling callbacks are functions (`pileItemOffset`, `pileBorderSize`, `previewItemOffset`, …).
- The arrangement and grouping you see are the result of *calls*, not of state keys you could hand in
  whole. `arrangementType` and `arrangementObjective` are stored, but after `expandArrangementObjective*`
  the objective holds functions (`lib.js:4145-4187`).
- **Measured round trip** (psychodeli, headless):
  - `exportState({serialize:true})` is 134 KB of JSON over 104 keys.
  - It silently drops the five function-valued keys: `easing`, `itemRenderer`, `orderer`,
    `pileSizeBadge`, `zoomScale`.
  - Feeding it to `createLibraryFromState(el, state, {deserialize:true})` throws
    `Cannot read properties of null (reading 'constructor')`.
  - Serialisation is a bare `JSON.stringify` with an Infinity replacer (`utils/serialize-state.js:1-16`).
    Import only warns on a version mismatch (`store.js:829-844`).

For an LLM, the closest thing to "a small spec, first try" is the **objective grammar**: property
strings plus named aggregators plus a named type. That part is worth borrowing as an idea. The
function-typed slots and call-order dependence are the part to avoid.

**Two hazards** found while writing the host:
- **The halt popup blocks input after "ready".** It still swallows input for its 250 ms fade after
  `resume()` (`popup.js:118-139`). Its root element ends up classed `pilingjs-popup-icon` because
  `popup.js:39-87` assigns `className` to `rootElement` five times instead of to each child.
- **Host once-subscriptions can be skipped.** A host `subscribe('itemUpdate', fn, 1)` never fired. The
  library's own once-subscriber for `whenInit` (`lib.js:364-368`) runs first. pub-sub-es 1.2.2 then
  splices the listener array inside `forEach` (`node_modules/pub-sub-es/dist/pub-sub-es.js:70-77`), which
  skips the next listener. The host uses `piling.whenInit` instead. An LLM-written host would hit both.

### 2. Pile preview designs and their measured costs *(3D piles)*

The paper's design space is in the code as five independent mechanisms. Costs are from the code path,
plus our measurements where noted.

| Design | Mechanism | Cost per the code |
|---|---|---|
| **Stack/offset** (the default) | Every member is a full sprite with `pileItemOffset` (default `[5,5]`, `store.js:225`) and `pileItemRotation` (`pile.js:877-970`) | One sprite per member, all drawn. With the default offset a 900-item pile is a 4,500 px diagonal streak. That is what `groupBy` on complexity produced for music and psychodeli (screenshots in the session; it is not a compact preview). A scatter offset like `examples/photos.js` needs a per-item callback. |
| **Item previews** (strips beside a cover) | `previewAggregator` → `previewRenderer` → `createImageWithBackground`, stacked top/left/right/bottom by `previewAlignment`, `previewSpacing`, `previewOffset`, `previewScaling`, or per item by `previewItemOffset` (`pile.js:730-875`) | Rendered **eagerly for every item at load**, not per pile: `createImagesAndPreviews` runs the preview renderer over the whole item list (`lib.js:1053-1083`). That is a second texture per item. Positioning loops over every preview child on each pile update (`pile.js:799-871`). |
| **Cover** (a synthesized pile face) | `coverAggregator(items on pile)` → `coverRenderer` → one scaled image (`lib.js:1562-1619`) | Recomputed **on every pile membership change**. Each change is an async aggregator call plus a new texture. Built-ins: matrix mean or std cover in a worker (`matrix-cover-aggregator*.js`), and the representative aggregator. |
| **Representative** | k-means over item values; the nearest item to each of k centroids becomes the cover or previews (`representative-aggregator.js:1-60`, `representative-renderer.js`) | k-means in a worker per pile change; returns all items when the pile has k or fewer (`:49`). |
| **Label strip and size badge** | `pileLabel` draws per-category colour bars, widths optionally `'histogram'` by category share (`lib.js:3519-3593`, `pile.js:1394-1513`); `pileSizeBadge` (`pile.js:247-308`) | Label textures are cached per label (`lib.js:3436-3517`). Cheap. |

The browse gestures are designs too:
- **Temp depile.** Double-click fans a pile out in place, in 1-D (`tempDepileOneD`, `lib.js:2089-2137`) or
  2-D (`tempDepileTwoD`, `lib.js:2139-2169`). Background items dim under `filterLayer` (`lib.js:2042-2051`).
- **Browse separately.** A pile opens as its own level, with a breadcrumb back (`levels.js:78-275`).
- **Hover preview.** Hovering a preview item shows a clone of the full item over the cover
  (`pile.js:143-175`).
- **Magnify.** Alt+wheel or the context menu, up to 3× (`pile.js:25, 1053-1079`).

**Measured costs.** Groups and splits are headless functional runs, not timed perf runs.
- Grouping by a 3-value facet and waiting for the piles to settle:
  - psychodeli 406 items: about 0.97 s;
  - music 1,793 items: about 1.2 s;
  - split back: 0.9 s and 1.6 s.
- The library's own numbers (`examples/performance-analysis.ipynb` cell 9 output, "photos"
  initialisation) are 1.2 s at 200 items, 5.3 s at 1,000, 11.1 s at 2,000 and about 42 s at 5,000. They
  publish no per-preview-design cost; the notebook only covers init and pan/zoom/scroll fps.

## Part 1 corrections

- **1.1 "WebGL via a scene library … Piling.js (Pixi)": confirmed**, PixiJS 5.1.6 `PIXI.Renderer`
  (`lib.js:138-150`). The "For" column needs correcting for Piling.js:
  - **No instancing or atlas.** Each item is a separate sprite with its own texture
    (`utils/to-display-object.js:19`, `image.js:12-21`).
  - **No culling.** Nothing in `lib.js` toggles `visible` by viewport *(inferred from grep; Pixi 5 has
    no built-in culling)*.
  - **The camera moves every pile on the CPU** on each pan or zoom tick (`lib.js:540-545, 547-557, 932-933, 1322-1328`).
  - "100k+ sprites at 60 fps" is not true of this design. Measured on the headless smoke, drag pan:
    - script 267 ms at 406 items, 1,299 ms at 1,793, 6,763 ms at 10,000;
    - frame p95 75, 92 and 168 ms (SwiftShader);
    - pan input-to-paint (INP) 80, 88 and 176 ms.
  - Context loss: no `webglcontextlost` handler anywhere in `src/` *(grep)*.
- **1.2 Image delivery:** Piling.js belongs in a row the table lacks: **every item at full source size,
  all loaded before the first frame**. `Promise.all` over `new Image()` per item (`image-renderer.js:20-26`)
  gates `createItemsAndPiles` behind a modal spinner (`lib.js:1140-1171, 778-790`).
  - Measured (smoke):
    - music 1,793 requests, 77 MB, 3.2 s to first view;
    - psychodeli 406 requests, 28 MB, 1.4 s;
    - synth10k 10,000 requests, 684 MB, 21.8 s.
  - No tiers and no level of detail (LOD). The only GPU memory management is `renderer.textureGC.run()`
    after item updates (`lib.js:3619`).
- **1.3 Filter:** Piling.js has **no filter**; it should not appear in any filter row. The nearest is
  `groupBy('category')`, a plain JS reduce over piles (`lib.js:2611-2639`), and `set('items', subset)`,
  which deletes and recreates items and textures.
- **1.4 Layout, "Piles / stacks — Piling.js": confirmed.** Also present:
  - grid (`grid.js`), 1-D ordering, 2-D data scatter and UMAP (`umap.js`, worker), all in
    `lib.js:1176-1320`;
  - automatic re-grouping on zoom for `distance` and `overlap` grouping only, despite DOCS.md saying
    `onZoom` applies to all types (`lib.js:2753, 3102`; zoom handler `lib.js:570-596`).
- **1.4 "Animated transitions": Piling.js should be listed.** Transitions are per-pile CPU tweeners in
  one rAF animator (`animator.js:11-60`, `pile.js:1081-1132`).
- **1.5:** Piling.js is an **npm component** (UMD + ESM, `package.json` "files"). There is no Python widget
  or CLI; the Jupyter notebooks in `examples/` only prepare data. State is a redux store with
  export/import (`store.js:816-857`). It has no URL state.

## Part 2 column (Piling.js)

| Capability | Piling.js |
|---|---|
| Survey: whole collection at once | yes: a grid sized to the viewport shows all 10k (observed) |
| Continuous pan/zoom | yes with `navigationMode:'panZoom'` (`lib.js:666-688`); the default grid mode scrolls only |
| Semantic zoom | partial: `groupBy('distance'/'overlap', …, {onZoom:true})` piles and splits on zoom (`lib.js:570-596, 2753`); content does not otherwise change with scale |
| Facets, multi-valued, OR/AND | no |
| Facet counts reacting to scope | no (the `'histogram'` label strip shows category share *per pile*, `lib.js:3519`) |
| Numeric range filters | no |
| Free-text search | no |
| Semantic / embedding search | no |
| Find without changing scope | no |
| Group by facet as territory | partial: `groupBy('category')` makes one pile per value; `arrangeBy('ij')` can place piles by category (examples/photos.js) |
| Sort within groups; attribute lens | partial: `pileOrderItems` callback (DOCS.md); `arrangeBy('data', prop)` 1-D order |
| Timeline layout | partial: `arrangeBy('data', ['date'])` gives a 1-D order or scatter, with no axis |
| Similarity layout (UMAP/t-SNE) | yes: UMAP in a worker (`umap.js`), or precomputed coords via `'data'`/`'uv'` |
| Geographic layout | partial: `arrangeBy('xy'/'uv')` with your coords; no basemap |
| Piles | **yes, the core**: drag-merge, lasso, group/split by grid, row, column, overlap, distance, category, cluster; depile, temp depile, browse separately |
| Animated layout transitions | yes, per-pile tweens |
| Rich detail view | no: magnify and hover-clone only; no text |
| Reading traversal (next/prev) | no |
| Select a subset; export it | partial: focus/multi-select (shift-click), lasso → pile; `exportState` has pile membership |
| Shareable URL of exact view | no: `exportState` exists, but the serialized form does not reload (measured above) |
| Keyboard and screen reader | no: a single canvas with no ARIA; modifiers alt/shift only |
| Live corpus | partial: `set('items')` diffs added, changed and deleted items (`lib.js:3640-3700`) but re-halts |
| No-server deployment | yes (static files) |
| Embeddable component / API | **yes**, its form factor |
| Preprocessing pipeline included | no (example notebooks only) |
| Documented scale | 5,000 items in its own init benchmark (notebook cell 3/9: 42 s for "photos"); we ran 10,000 (21.8 s headless to first view) |

## Part 3 scores (0–3)

- **Competitive / market-research wall: 1.** It has no text, captions, links, facets, filter, search or
  live source. Manual piling (drag one card onto another, lasso into a pile) is the one transferable
  research-wall act: sorting captures into piles by hand is exactly what an analyst does. It runs on
  a canvas with no persistence beyond a state blob that does not reload.
- **LLM-communicated collection: 1.5.**
  - For: the embeddable npm form; `createLibrary(el, {items, renderer})` gets a working piling surface
    in about 10 lines; objective strings (`arrangeBy('data', ['px','py'])`, `groupBy('category','genre')`)
    are an LLM-friendly grammar.
  - Against: a required function renderer; callback styling; a serialized state that does not
    round-trip; an all-images-before-first-frame load with a modal spinner; no selection callback
    beyond pub-sub events (`pileFocus`, `pileActive`); and the two pitfalls in Q1. These cost first-try
    success.

## Technique candidates

| Technique | Source | Grade | Wunderkammer file it would change | Metric it should move | perf-budgets key | Wunderkammer problem |
|---|---|---|---|---|---|---|
| Objective grammar: a layout or grouping named by `type` + property string or `{property, aggregator, scale}` | `lib.js:4106-4187, 4189-4232, 4253-4314`; DOCS.md arrangeBy/groupBy | idea | `lib/view-state.mjs`, `wall/view-state.mjs` (a spec schema) | first-try success of an LLM-written spec (new acceptance test) | none (product) | LLM-communicated collection (PEER_STUDY_PLAN Part 3) |
| Temp depile: double-click fans a pile in place (1-D strip or 2-D grid) over a dimming layer, double-click again to restore | `lib.js:2042-2051, 2089-2205, 4811-4842` | idea | `wall/spatial/lib/piles.js`, `spatial-view.mjs` | refinding time in a 100-item pile; spread-open INP | `spatial open` (inpMs) | TODO "Large-pile scrub/fan and partial spread" |
| Representative cover/previews: k-means over item features, nearest item per centroid, worker-side | `representative-aggregator.js:1-60` | port (small MIT algorithm; we have `features.npy`-style vectors) | `wall/spatial/lib/piles.js` (pile face), `context-clusters.mjs` | recognisability of large piles (usability); worker keeps main-thread work out | `spatial filter on` (longestTaskMs) | TODO "Layer meaning and manual stacks" |
| Category-share label strip on a pile (`'histogram'`) | `lib.js:3519-3593` | idea | `wall/spatial/lib/piles.js` | glanceable facet mix per pile | none | 3D piles; facet share fill |
| Auto pile/split on zoom by screen distance/overlap | `lib.js:570-596, 2410-2526, 2753` | idea | `wall/overview-surface.mjs` | overplot at 10k zoom-out; draw count | `flat zoom out` (framesMax) | PERF Open "zoom-out max frame", overview at 10k+ |
| Manual pile authoring: drag-onto-pile merge with drop highlight, lasso-to-pile, shift-multiselect then merge | `lib.js:4489-4626, 2212-2252, 4753-4762` | idea | `wall/spatial/lib/piles.js`, `wall.mjs` | task completion (usability) | none | TODO "Manual pile authoring" |
| Camera applied by CPU-transforming every pile per tick | `lib.js:540-557, 932-933, 1322-1328` | rule out: script cost grows with N (pan 267 → 6,763 ms, 406 → 10k); wunderkammer already transforms a stage/instanced buffer | n/a | n/a | `flat pan` | scale ceiling |
| One full-size texture per item, all loaded behind a modal halt before the first frame | `image-renderer.js:20-26`, `lib.js:1140-1171, 778-790` | rule out: 684 MB and 21.8 s to first view at 10k; wunderkammer's sheets and tiers already beat it | n/a | n/a | `boot` (imagesMs) | TODO "Atlas upload/decoded-memory budget" (a cautionary datum) |
| Eager per-item preview textures | `lib.js:1053-1083` | rule out: doubles textures for all items, not just pile members | n/a | n/a | n/a | 3D piles |
| State as one store with export/import | `store.js:816-857`, `utils/serialize-state.js` | rule out *as built* (function-valued keys drop; reload throws); the lesson for our spec is to keep every key JSON | `lib/view-state.mjs` | permalink round-trip | `session retained` | LLM spec; permalinks |

## Surprising, and what I could not establish

**Surprising:**
- The library is fully all-or-nothing at load: nothing draws until the last image of 10,000 decodes.
- `createLibraryFromState` cannot reload its own serialized export.
- Two small library bugs bite a host on day one: the popup className overwrite, and the pub-sub
  once-listener skip.
- DOCS.md says `onZoom` grouping works for all types; the code limits it to distance and overlap.
- With `groupBy('category')` and the default `[5,5]` offset, large piles render as long diagonal streaks
  across the screen, not compact stacks. The library assumes piles of tens, not hundreds.

**Could not establish:**
- GPU memory per corpus, and any context loss at 10k. These are left for the coordinator's headed and
  `gpu-probe` runs; the driver's `gpuGesture` is ready.
- Whether Pixi 5 uploads textures for off-screen sprites lazily. I infer every sprite renders every
  frame because there is no culling.
- The paper's preview-design costs. The repo has no per-design measurements.

**Smoke runs** (headless chromium, `--scenarios idle,pan`): JSON in
`wunderkammer/.local/peer-study/perf/smoke/2026-10-14T04-*-piling-{music,psychodeli,synth10k}.json`. All three
corpora booted and panned with no page errors. A functional pass of every other driver gesture ran on
music and psychodeli with no errors: zoom, group, split, UMAP, back, magnify, close. Synth10k ran the
probe for grid, UMAP, group and split.
