# Peer study: what the open-licence collection explorers know that we don't

> The measurement harness (`scripts/peer-perf/`) depends on a local workspace of the peers' checkouts and is not part of this repository. The pinned commits, scenarios and results below are.

Status: done 2026-10-13, executing [PEER_STUDY_PLAN.md](PEER_STUDY_PLAN.md) (`4813722`).
Six peers (seven repositories) were cloned at their pinned commits. Each was fed the same three
corpora, served, measured with one harness in one serial pass, and read for the plan's Part 4
questions. This file is the synthesis. The per-peer reports in [peer-study/](peer-study/) carry
the full citations, and every peer claim below links to one of them.

**Evidence rules.**
- A peer claim carries `repo@commit path:line`, either here or in its report.
- A number is a measurement from this study's pass unless it is labelled otherwise.
- *(inferred)* marks a claim that neither a citation nor a measurement settles.
- Eight citations were spot-checked against the pinned sources by the coordinator. All matched:
  PixPlot's mix shader, seajax's 300 ms stagger, seajax's 700 ms duration, seajax's tile-priority
  comparator, umap-explorer's cell offsets, CSN's per-frame `BufferAttribute`, Embedding Atlas's
  label-placement header, and VIKUS's hand-written `Crossfilter()`.

## Headline findings

1. **Only wunderkammer loses content under GPU memory pressure.** Each tool ran the same zoom gesture
   with the screencast probe under `--force-gpu-mem-available-mb`:
   - Wunderkammer's dropped screen cells rise as memory falls: 431 → 666 → 983 at default, 192 MB and
     96 MB (three runs each).
   - Every peer is flat across the three caps.
   - PixPlot allocates 512 MiB of textures and runs at a 96 MB cap with no context loss, which
     suggests the flag limits compositor tile memory rather than WebGL allocations *(inferred)*.
   - So the blink is a property of a DOM wall rasterised as compositor tiles. It points at the
     TODO's own hypothesis, the world-sized `will-change` layer on `#canvas`, and is not
     something a canvas peer solved.
   - [Details below](#gpu-pressure-probe).
2. **At 10,000 items wunderkammer's DOM wall is the slowest surface measured for discrete
   operations**, and every single-canvas peer stays near the frame floor.

   | Synth10k, medians | Wunderkammer | VIKUS | CSN | Embedding Atlas | seajax |
   |---|---:|---:|---:|---:|---:|
   | Filter-on INP | 712 ms | 72 ms | 24 ms | 24 ms | 40 ms |
   | Search INP | 664 ms | — | — | — | — |
   | Detail-open INP | 488 ms | — | — | — | — |
   | Zoom-out max frame | 210 ms | — | — | — | — |

   - VIKUS pays 668 ms of script for its filter but spreads it across animation frames (no long
     animation frame), so its INP stays low.
   - This is the measured case for the TODO "Scale ceiling". The peers' answer is the substrate,
     not a trick wunderkammer can borrow inside the DOM wall.
3. **Layout transitions on the GPU cost about 2–5× less script at 10k than CPU tweens.** Measured
   layout-switch script on synth10k:

   | Tool | Mechanism | Script |
   |---|---|---:|
   | PixPlot | Two position attributes, one tweened uniform | 76 ms |
   | umap-explorer | Per-coordinate tween.js | 197 ms |
   | CSN | Per-coordinate tween.js | 431 ms |
   | VIKUS | Per-frame easing of every sprite | 611 ms |

   - CSN and umap-explorer also allocate a fresh GL buffer every frame: 390 and 840 buffers per
     switch, never freed.
   - PixPlot's method is the top **port** for wunderkammer's 3D regroup.
4. **The best ideas for the LLM direction are packaging, not rendering.**
   - Embedding Atlas offers an npm component at three levels, an anywidget whose `selection()`
     hands rows back, a static export, and a hosted viewer that takes data plus settings from a
     compressed URL hash.
   - It also ships an MCP server, about 30 tools, that lets an agent query, filter and
     screenshot the live view. Its pinned commit is itself an MCP security fix.
   - No peer has a schema-validated, image-native spec an agent can emit and get right first
     time. That gap is wunderkammer's to fill.
5. **No peer promotes a GPU tile to live DOM in place.** The PRECEDENTS scan was right, now on
   source evidence:
   - VIKUS comes closest: it swaps in a big texture in the canvas and fills a text-only sidebar.
   - Embedding Atlas pins a tooltip card at the point.
   - Wunderkammer's per-item promotion remains unmatched.
6. **The plan had five factual errors:**
   - VIKUS has **no crossfilter.js**: its "crossfilter" is a hand-written full scan.
   - seajax is **BSD-2**, not BSD-3.
   - Embedding Atlas has **no WebGPU fallback**, and by default runs DuckDB **in Python**, not
     WASM.
   - PixPlot's `cell_size` does not lower GPU memory below a fixed **512 MiB floor**.
   - CSN's Node 16 pin does not burden Colab users. Their real cost is a **2023 prebuilt bundle**
     that misses later fixes.

## Subjects as studied

| Peer | Commit | Licence (from the licence file) | Report |
|---|---|---|---|
| VIKUS Viewer | `ccb4e7e` | MIT, © 2017 Christopher Pietsch | [vikus.md](peer-study/vikus.md) |
| vikus-viewer-script | `c171633` | **none** (package.json says ISC; no licence text). Read only, nothing copied | in vikus.md |
| Collection Space Navigator | `96147ee` | MIT, © 2022 Mar Canet Sola and Tillmann Ohm. `src/Projection.js` derives from umap-explorer, so copying from it needs both notices *(inferred)* | [csn.md](peer-study/csn.md) |
| umap-explorer | `d31e3de` | MIT, © 2020 Grant Custer. Four files patched in our clone to load non-MNIST data; the patch is not a finding | in csn.md |
| PixPlot | `3afce47` | MIT, © 2020 Yale University. Its vendored GSAP is **not** MIT | [pixplot.md](peer-study/pixplot.md) |
| Embedding Atlas | `f2fff54` | MIT, © 2025 Apple Inc. | [embedding-atlas.md](peer-study/embedding-atlas.md) |
| Piling.js | `9983067` | MIT, © 2019 Xinyi Zhou and Fritz Lekschas | [piling.md](peer-study/piling.md) |
| seajax / PivotViewer | `0293770` | **BSD-2-Clause**, © Microsoft (the plan said BSD-3) | [seajax.md](peer-study/seajax.md) |

Clones are in `<peer-study workspace>/<name>`. Built instances are in
`<peer-study workspace>/instances/<peer>/<corpus>/`. Authored configs and serve scripts are in
`.local/peer-study/<peer>/`, outside the repository. Each serve script is idempotent.

| Peer | Music | Psychodeli | Synth10k |
|---|---:|---:|---:|
| Wunderkammer reference | 4302 | 4303 | 4304 |
| VIKUS | 4310 | 4311 | 4312 |
| CSN | 4320 | 4321 | 4322 |
| umap-explorer | 4325 | 4326 | 4327 |
| PixPlot | 4330 | 4331 | 4332 |
| Embedding Atlas | 4340 | 4341 | 4342 |
| Piling.js | 4350 | 4351 | 4352 |
| seajax | 4360 | 4361 | 4362 |

## Method

**Corpora.** All tools see the same items and pixels.
- `scripts/peer-perf/normalize.py` turns a wunderkammer `/api/clips` dump into `items.json` plus 640 px
  JPEGs:
  - Music Atlas: 1,793 covers.
  - Psychodeli Atlas: 406 screenshots.
  - The 10,000-item synthetic corpus from `perf-scale.mjs`. As in wunderkammer's own sweep, its 9,594
    copies are symlinks to the 406 originals, so HTTP caching flatters image arrival there.
- `scripts/peer-perf/project.py` computes one UMAP of cheap pixel features (`projection.json`).
  Every projection-based peer therefore draws the same map. It compares renderers, not embeddings.
- One converter per peer (`scripts/peer-perf/convert-<peer>.*`) writes that tool's own format:
  - CSN, PixPlot and Embedding Atlas run their own pipeline code, with our features and projection
    swapped in.
  - seajax gets CXML plus a real Deep Zoom Collection.
  - VIKUS gets our own sprite sheets.

**Harness.**
- `scripts/peer-perf/peer-perf.mjs` is `scripts/perf.mjs` made tool-agnostic. It records:
  - an in-page rAF frame sampler;
  - long animation frames with script attribution;
  - Event Timing grouped by `interactionId` (INP);
  - CDP script, layout and style deltas, plus nodes and heap;
  - boot time to ready, FCP, and "images shown", defined per tool in each driver with citations;
  - image request counts and bytes.
- Each peer has a driver (`scripts/peer-perf/drivers/<peer>.mjs`) that supplies the gestures
  through shared input helpers. A scenario a tool lacks is recorded as **absent**.
- `run-all.sh` ran every driver × corpus serially, three runs each:
  - headed Google Chrome 155.0.8059.79;
  - Apple M3 Max;
  - 1440×900 @2×.
- `summarize.mjs` prints the medians below, with the range in brackets in the raw tables
  (`.local/peer-study/perf/pass-tables.md`).

**GPU-pressure probe.**
- `scripts/peer-perf/gpu-probe.mjs` launches headed Chrome with `--force-gpu-mem-available-mb` at
  96, 192 and default. It screencasts every composited frame through an eased zoom in and out,
  twice.
- `dropout.py` cuts each frame into a 16×10 grid. It counts a cell as **dropped** when it is flat
  (luma σ < 2) while textured (σ > 8) in both a frame before and a frame after, within ±2 frames.
- Calibrated on wunderkammer first. 96 MB reproduces the TODO's whole-wall blink (frame 95 of run 1
  is nearly empty).

**Caveats that bound every comparison.**
- Frame p95 ≈ 10 ms is the display's refresh interval, so a p95 at that value means "no worse than
  vsync".
- The same input does not do the same thing everywhere:
  - PixPlot's wheel moves the camera only from z 2 to 1.86 over 20 ticks, so its zoom rows
    barely zoom.
  - Embedding Atlas clamps zoom within those ticks.
  - seajax pans only after a jump to 4×.
  - seajax's filter and layout gestures wait for its full 1–3 s choreography.
  - "Filter" means a facet chip, a range slider, a tag, a SQL count plot or `groupBy`, depending
    on the tool.
- INP is input → next paint. Work a tool defers to later frames shows up in script ms and frame
  max, not in INP. Read the two together.
- PixPlot's `ready` includes its loader, an Enter click and about 2.5 s of fixed animation.
- Embedding Atlas downloads a 34 MB DuckDB-WASM in a worker, unused in server mode. Page resource
  timing does not see it, so its byte counts are understated.
- One machine, one browser, three runs. Treat differences under about 20% as noise.

## Measurements

### Boot (medians of 3)

| Tool | Music ready / images ms | Music requests, KB | Synth10k ready / images ms | Synth10k requests, KB | Synth10k DOM nodes / heap MB |
|---|---|---|---|---|---|
| **wunderkammer** | 567 / 112 | 11, 3,097 | 2,072 / 11 | 9, 3,767 | 71,183 / 45 |
| VIKUS | 111 / 154 | 7, 6,002 | 206 / 271 | 12, 15,689 | 344 / 60 |
| CSN | 375 / 104 | 4, 19,270 | 393 / 299 | 20, 43,923 | 698 / 19 |
| umap-explorer | 278 / 104 | 4, 30,830 | 297 / 303 | 20, 85,114 | 107 / 5 |
| PixPlot | 4,715 / 1 | 36, 807 | 4,820 / 1 | 54, 6,262 | 1,351 / 15 |
| Embedding Atlas | 636 / 104 | 69, 2,510 | 631 / 104 | 75, 4,509 | 13,412 / 17 |
| Piling.js | 100 / 2,517 | 1,793, 76,973 | 130 / 16,896 | 10,000, 683,720 | 99 / 14 |
| seajax | 1,087 / 311 | 581, 10,003 | 1,319 / 8,188 | 838, 11,491 | 20,290 / 86 |

How to read this table:
- **Every atlas peer reaches all images about as fast as wunderkammer's sheets**, though with more
  pages: VIKUS uses 7–12 sheet pages against wunderkammer's 3. CSN and umap-explorer use 2–10
  atlases but download each one twice, once as an `<img>` and once as a texture: 85 MB at 10k
  for umap-explorer.
- **Piling.js** loads every full-size image before its first frame: 684 MB and 16.9 s at 10k.
- **seajax** fetches tiles one level sharper than its CSS-pixel canvas can show at DPR 2 (see
  [seajax.md](peer-study/seajax.md) Q2), and takes 8.2 s at 10k.
- **Wunderkammer's 2.1 s ready at 10k** is its 71k DOM nodes: the scale-ceiling item again.

### Interactions: synth10k (frame max ms · script ms · INP ms; medians)

| Tool | Pan | Zoom out | Filter on | Filter off | Search | Layout switch | Detail open |
|---|---|---|---|---|---|---|---|
| **wunderkammer** | 25 · 142 · — | 210 · 286 · 264 | 684 · 420 · 712 | 575 · 370 · 648 | 308 · 683 · 664 | 300 · 249 · — | 267 · 232 · 488 |
| VIKUS | 10 · 456 · 32 | 10 · 114 · — | 42 · 668 · 72 | 17 · 665 · 40 | 27 · 1,343 · 40 | 10 · 611 · 32 | 10 · 709 · 24 |
| CSN | 10 · 52 · 24 | 10 · 24 · — | 10 · 90 · 24 | 10 · 87 · 24 | 242 · 359 · 432 | 10 · 431 · — | 10 · 23 · — |
| umap-explorer | 10 · 38 · 24 | 10 · 21 · — | absent | absent | absent | 10 · 197 · — | 33 · 6 · — |
| PixPlot | 10 · 59 · 32 | 10 · 31 · — | 10 · 13 · 32 | 10 · 11 · 32 | absent | 10 · 76 · 32 | 10 · 58 · 32 |
| Embedding Atlas | 10 · 94 · 32 | 10 · 31 · — | 17 · 16 · 24 | 25 · 13 · 48 | 49 · 106 · 32 | 10 · 7 · — | 17 · 20 · 24 |
| Piling.js | 392 · 5,704 · 576 | 43 · 265 · — | 2,467 · 2,221 · 272 | 7,358 · 7,840 · 3,088 | absent | 5,767 · 6,186 · 472 | 100 · 464 · 264 |
| seajax | 150 · 1,585 · 176 | 158 · 2,065 · — | 26 · 2,083 · 40 | 25 · 2,028 · 32 | 43 · 1,829 · 72 | 42 · 947 · 56 | 25 · 636 · 48 |

**At music scale (1,793)** wunderkammer is inside most budgets:
- filter on INP 184 ms;
- filter off 168 ms;
- search 568 ms (the 180 ms key spacing in the gesture; see the existing TODO);
- zoom-out max frame 100 ms.

Canvas peers sit at the frame floor except where noted:
- Piling.js: pan script 1,224 ms; filter off 375 ms max frame.
- seajax: 450–1,400 ms of script per gesture, spread over its choreography.

Full tables for all three corpora are in `.local/peer-study/perf/pass-tables.md`.

### GPU-pressure probe

Music corpus, zoom gesture in and out twice. Each cell is frames with a drop-out over frames
captured, for each of three runs, then dropped cells summed over the three runs.

| Tool | 96 MB | 192 MB | default |
|---|---|---|---|
| **wunderkammer** | 35/167, 32/175, 33/180 (**983** cells) | 36/195, 35/188, 37/190 (**666**) | 32/218, 30/214, 22/217 (**431**) |
| VIKUS | 0, 0, 0 (0) | 0, 0, 0 (0) | 0, 0, 0 (0) |
| CSN | 0, 1, 1 (2) | 1, 0, 3 (4) | 0, 0, 2 (2) |
| umap-explorer | 2, 1, 3 (6) | 2, 2, 2 (6) | 1, 1, 4 (6) |
| PixPlot | 0, 0, 0 (0) | 0, 0, 0 (0) | 0, 0, 0 (0) |
| Embedding Atlas | 14, 14, 15 (63) | 14, 14, 14 (62) | 13, 14, 13 (62) |
| Piling.js | 0, 0, 0 (0) | 0, 0, 0 (0) | 0, 0, 0 (0) |
| seajax | 30, 35, 31 (177) | 27, 26, 31 (150) | 30, 32, 29 (168) |

How to read it:
- **Only wunderkammer's count moves with the cap.**
- Embedding Atlas and seajax register a constant 20–60 cells per run at every cap. Inspecting
  their flagged frames shows the detector catching intrinsic cross-fades, not blank tiles:
  - Embedding Atlas: label fades.
  - seajax: its 500 ms tile blend-in.
- **Wunderkammer drops content even at default memory.** In the default-run frames, area newly
  exposed by zoom-out is blank for one frame before the overview fills it (run 1, frame 209). A
  96 MB cap adds whole-wall blanks (run 1, frame 95). These are two problems, and both are now
  countable with one script.
- **PixPlot did not enter a reload loop**, though its report predicted one. It allocates two
  8192² textures (512 MiB) and its context-loss handler reloads the page, yet at 96 MB it never
  lost context. So the flag does not cap WebGL texture memory on this machine *(inferred)*. It
  caps what Chrome's tile manager may keep for rastered layers, which is where a DOM wall lives.

## Per-peer findings

Each block lists what matters for wunderkammer. The reports have the Part 4 answers in full.

### VIKUS Viewer ([report](peer-study/vikus.md))

**Texture tiers.** Sprite sheets are 128 px (90 above 5k), not the README's 256, in 2048 px
pages, and stay resident all session (`js/viz.js:134-149`).
- The 1024 px tier loads only when **fewer than 40 items are in view** after a zoom ends, one
  per frame, paused mid-gesture (`js/canvas.js:1644-1682, 1800-1811`).
- The big tier loads on focus.
- Nothing is ever unloaded. The only reclamation is Pixi 5's texture GC, which counts *rendered*
  frames, and VIKUS stops rendering when converged *(inferred from minified Pixi)*.
- The 0 drop-outs above therefore show that its working set is small (7–12 pages). They do not
  show a budget.

**Filter.**
- **Filter = relayout**: non-matches are stacked inverted below the timeline axis at alpha 0.2,
  off screen at Fit (`js/canvas.js:1630-1641`).
- Hovering a keyword previews the match set by alpha alone (`js/tags.js:352-386`).
- The keyword-count engine re-nests every active row on every change.

**Transitions.** Per-frame CPU easing of every sprite, 6% of the remaining distance per frame:
frame-rate dependent, with no staging (`js/canvas.js:995-1037`).

**Spec.** `config.json` boots from six keys, but it has no schema, a missing key gives a blank
page, and the `function` field type runs `eval` (`js/sidebars.js:29-34`).
- Six README values do not match the code; for example `alphabetical-reverse` is checked as
  `alfabetical-reverse`.

**Selection.**
- Zoom-through opens detail and zooming out past 0.8× closes it (`js/canvas.js:1244-1265`).
- The URL hash is the only channel out. It encodes the viewport as the ids of its extreme items
  (`js/canvas.js:273-334`).

### Collection Space Navigator and umap-explorer ([report](peer-study/csn.md))

**Atlases are fixed-cell grids addressed by index arithmetic.**
- umap-explorer uses a 73×73 grid of 28 px cells; CSN 32×32 of 64 px.
- **The PNG page is the texture**: a per-vertex offset plus one `repeat` uniform address the
  cell (`UE@d31e3de src/Projection.js:270-278, 288-292`).

**Projection switch.**
- A 1 s linear tween.js over the raw position array, on the main thread.
- A **new `BufferAttribute` every frame** (`CSN@96147ee src/Projection.js:76-82`) leaks one GL
  buffer per chunk per frame: +390 (CSN) and +840 (umap-explorer) per switch at 10k, 0 deleted.
- CSN runs one such tween at every page load.

**CSN filter.**
- A JS loop builds a per-point mask, uploaded as a new attribute per tile.
- Excluded items draw as **grey ghosts** in a second full pass, a user toggle that defaults on
  below 20k (`src/Projection.js:350-353, 458-474`; `src/Layout.js:58-64`).
- Range sliders sit over in-scope histograms; hovering a bar previews that bucket on the map
  (`src/Sliders/BarChart.js:66-89`).
- Its query box is the slowest gesture at 10k: search INP 432 ms.

**Onboarding.**
- The Colab writes data into a committed `build/` from 2023-05-20, so it never builds JS.
- Items with a null numeric value drop out on the first slider move and never return
  (`src/Sliders/Sliders.js:43-48`).

### PixPlot ([report](peer-study/pixplot.md))

**Layout transition (the model to port).**
- Two instanced position (and scale) attributes; one `transitionPercent` uniform tweened over
  2 s. The vertex shader `mix`es them (`pixplot/web/index.html:93-130`).
- On completion the targets are committed in one CPU pass (`tsne.js:718-745, 814-835`).
- No per-item JS runs per frame: measured 76 ms of layout-switch script at 10k.

**LOD (the model to avoid).**
- High-res cells are chosen by distance in a 100×100 camera grid, gated by camera z < 0.8. There
  is no frustum or projected-size test (`tsne.js:2742-2898`).
- 561 cells activated while about 50 were on screen (deep-zoom probe). That is the failure
  wunderkammer measured in its 3D near tier.
- At the overview it calls `lod.clear()` every frame, re-flagging two attributes for upload.

**Texture budget.**
- Two 8192² textures (512 MiB) whatever the collection size (`tsne.js:53-62, 261-268`).
- `cell_size` moves GPU RAM only in 256 MiB steps.
- Context loss reloads the page.

**Other.**
- Picking is GPU colour-ID on click: a full off-screen render plus a `readPixels` stall.
- Hotspots are KMeans/HDBSCAN clusters with a curation loop (rename, reorder, save as a committed
  `user_hotspots.json`) on localhost.
- Search is dead markup.
- Atlases are **row-packed with variable width**, so aspect is kept and there are no padding
  cells (`pixplot.py:488-539`).

### Embedding Atlas ([report](peer-study/embedding-atlas.md))

**Rendering.**
- WebGPU with `shader-f16` or nothing (`webgpu_renderer/utils.ts:4-24`). It fails in Playwright's
  Chromium and in SwiftShader.
- It recovers from device loss (`EmbeddingViewImpl.svelte:323-331`).

**Data and filtering.**
- Mosaic over DuckDB in **Python** by default (`server.py:130-206`). Each chart is one SQL query
  per selection change, about 10 per filter click here, and hover is a nearest-point SQL query.
- Filtered points are **dropped and re-uploaded**, not dimmed.

**Semantic zoom.** Density mode only, which is not the default. Contours cross-fade to points
across one e-fold of scale around the zoom where the densest region falls below 1/16 point per
px² (`EmbeddingViewImpl.svelte:45-89`).

**Labels.**
- Clusters come from a GPU density map segmented in Rust/WASM.
- Each label is c-TF-IDF text or the highest-PageRank member's image.
- Placement is **Been, Daiches & Yap 2006 dynamic map labelling**: each label gets a precomputed
  visible-scale interval (`dynamic_label_placement.ts:3-120`).

**Images.** They are never the points. On the map they appear only as 20–29 cluster-label
thumbnails.

**Packaging.** This is the strongest of any peer.
- An npm component at three levels, plus React and Streamlit wrappers.
- An anywidget with `selection()`, so the brushed rows come back to the host.
- `--export-application`, a static DuckDB-WASM site.
- A hosted file viewer with data URL, settings and state in a deflate+base64 hash
  (`viewer/src/utils/query_payload.ts:7-90`).
- An MCP server with about 30 tools (`model_context.ts:66-338`).

### Piling.js ([report](peer-study/piling.md))

**Images and camera.**
- Every item is a full-size texture, all loaded behind a modal spinner before the first frame
  (`image-renderer.js:20-26`, `src/library.js:1140-1171`).
- The camera moves every pile on the CPU per tick (`src/library.js:540-557`).
- Measured: pan script 347 ms → 1,224 ms → 5,704 ms at 406, 1,793 and 10,000 items.

**API.**
- Imperative calls with JSON-able *objectives* (`arrangeBy('data', ['px','py'])`,
  `groupBy('category', 'genre')`, `src/library.js:4106-4187`).
- Renderers and styling are functions.
- `exportState({serialize:true})` drops five function-valued keys, and `createLibraryFromState`
  throws on the result (measured).

**Pile designs.** Offset stack, item previews, synthesised cover, k-means **representative**
cover (`src/representative-aggregator.js:1-60`), and a category-share label strip.
- Temp depile fans a pile in place over a dimming layer (`src/library.js:2089-2205`).
- Previews are built eagerly for every item. With the default `[5,5]` offset, piles of hundreds
  render as long diagonal streaks.

### seajax / PivotViewer ([report](peer-study/seajax.md))

**Choreography.** Every filter, sort or view change:
1. Freezes input.
2. Springs home (1.5 s zoom spring).
3. Runs **leave → move → arrive** in sequence. Each item has a uniform 0–300 ms random start
   (`PivotViewer.js:305`), 700 ms of motion (`:1506`) and an exponential ease-in-out with k = 8
   (`:1513-1515`).

That totals up to about 3 s with input blocked. An interrupting filter snaps in-flight items to
their destinations (`:1077, 1366`).

**Deep Zoom Collection.** A layout-independent atlas pyramid addressed by Morton index: shared
tiles up to MaxLevel, per-item DZI above (`v2/src/image/DzcTileSource.js:86-195`). Sorting and
filtering never touch it.

**Tile requests.** Ranked by summed on-screen area, then distance to centre, then lower level
(`TileLoader.js:62-80`). The decoded-tile LRU is bounded by **count** (1,000), not bytes.

**Facets.**
- OR within, AND across.
- **Counts exclude the facet's own filter** (`PivotViewer.js:2777-2786`), so a sibling value shows
  what adding it would give.
- Number facets get an 11-bin histogram and a range slider that filters on release. The bins use
  only an item's first value, while the filter matches any value (`NumberPicker.js:72, 109`).
- Graph view is a histogram layout whose bars filter on click.

**Canvas resolution.** The canvas is CSS-pixel sized while tile levels are chosen for DPR.

## Part 2 — the feature matrix, filled

Citations are `path:line` at each peer's pinned commit. Each report's Part 2 table has the full
evidence. "obs." means observed in a run.

| Capability | Wunderkammer | VIKUS | CSN (umap-explorer) | PixPlot | Emb. Atlas | Piling.js | PivotViewer |
|---|---|---|---|---|---|---|---|
| Survey: whole collection at once | yes | yes, Fit (`canvas.js:1605-1628`) | yes (yes) | yes (`tsne.js:1599-1605`) | yes, fit to data | yes, grid | yes, home view |
| Continuous pan/zoom | yes | yes, d3 zoom | yes (yes) | yes, Trackball | yes, clamped | yes, `panZoom` mode only | yes, springs |
| Semantic zoom | partial | partial: 1024 tier < 40 in view; zoom-through detail | no (no) | partial: LOD texture under z 0.8 | partial: density→points, density mode only | partial: re-pile on zoom, 2 group types | partial: template levels, DZI sharpening |
| Facets, multi-valued, OR within / AND across | yes | partial: keywords AND-only (`tags.js:72-76`) | partial: query box, joined strings (no) | partial: one flat single-select tag list | yes: list columns, shift-click OR | no | yes (`PivotView.js:380-392`) |
| Facet counts that react to scope | yes (share fill, own filter included: `wall.mjs:390-398`) | partial: font size only | partial: numeric histograms (no) | no | yes: selected/total per bar | no | partial: open facet only, excludes own filter |
| Numeric range filters | **no** | no | yes: slider + histogram (no) | partial: year only | yes: histogram brush | no | yes: 11-bin histogram + slider |
| Free-text search | yes | yes, substring | partial: query language (no) | no (dead markup) | yes, FlexSearch | no | yes, word wheel |
| Semantic / embedding search | no | no | no (no) | no | partial: host-supplied | no | no |
| Find without changing scope | partial | partial: hover preview | no (no) | partial: hotspot fly-to | yes: result click flies | no | partial: `setCenterItem` |
| Group by facet as territory | yes | partial: group bands | no (no) | partial: categorical boxes | no | partial: one pile per value | partial: graph view, ≤ 12 buckets |
| Sort within groups; attribute lens/brush | yes | no | partial: histogram brushing (no) | no | partial: colour-by | partial | partial: one sort facet |
| Timeline layout | **no** | yes | partial: 2-D plot (no) | yes, year bars | no | partial | partial: graph of DateTime |
| Similarity layout | **no** (yes from 2026-10-14: index-time pixel UMAP + spacing pass, `wall/similarity-layout.mjs`) | yes, CSV x/y | yes (yes) | yes | yes | yes, UMAP worker | no |
| Geographic layout | no | partial | no (no) | yes | no | partial | no |
| Piles | yes (3D) | no | no (no) | no | no | **yes, the core** | no |
| Animated layout transitions | yes, bounded | yes, CPU easing | yes, CPU tween (yes) | yes, **GPU mix** | no: viewport only | yes, per-pile tweens | yes, 3-stage, ~3 s |
| Rich detail view | yes | yes, Vue sidebar | partial: hover preview (partial) | partial: lightbox | partial: pinned card | no | partial |
| Reading traversal | yes | no | no (no) | partial: within a lasso | partial: table pages | no | yes, arrows |
| Selection of a subset; export it | partial | partial: shift-click borders | partial: export filtered CSV/PNG (no) | yes: lasso → CSV/JSON/ZIP | yes: lasso → parquet/CSV; `selection()` | partial: lasso → pile | no |
| Shareable URL of the exact view | yes | yes, hash (ids) | partial: dataset + projection (no) | no | partial: hosted viewer hash | no: state does not reload | partial: no zoom or selection |
| Keyboard and screen-reader access | partial | no; disabled below 500 px | no (no) | no | no on the map | no | partial: arrows |
| Live corpus | yes | no | no (no) | no | no | partial: `set('items')` diff | partial: full rearrange per update |
| No-server deployment | partial | yes | yes (yes) | yes | yes: export or hosted | yes | yes |
| Embeddable component / API | **no** | partial: iframe + hash | no (no) | no | **yes**: npm ×3, React, widget, MCP | **yes**: npm | yes: `Pivot.init`, `addItems` |
| Preprocessing pipeline included | yes | partial: separate unlicensed repo | yes: Colab (partial) | yes: CLI | yes: embed, UMAP, kNN | no | no |
| Documented scale | 25k measured | ~5k advised; 10k obs. | > 20k by code default; 10k obs. (70k MNIST) | > 100k claimed; 10k obs. | millions claimed (4M downsample); 10k obs. | 5k own bench; 10k obs. (16.9 s first view) | none; 10k obs. |

Two capability rows the matrix lacked, found in peers:
- **Curated clusters as a committed file:** PixPlot's `user_hotspots.json`.
- **An agent control surface:** Embedding Atlas's MCP.

Both bear on the research-wall and LLM use cases.

## Part 1 — the architecture tables, revised

Changes from the plan are in bold. Rows not listed stand as written.

### 1.1 Rendering substrate

| Option | Used by | For | Against |
|---|---|---|---|
| DOM tiles | Wunderkammer flat wall | (unchanged) | (unchanged), plus **measured: the only surface here that drops content under GPU memory pressure (983 vs 431 cells, 96 MB vs default), and 488–712 ms INP on discrete operations at 10k** |
| Canvas 2D | Wunderkammer overview, **PivotViewer (tiles on one canvas plus an optional HTML layer for `html` templates)** | (unchanged) | (unchanged), plus **PivotViewer sizes its canvas in CSS pixels while choosing tile levels for DPR, so at DPR 2 it fetches pixels it cannot show** |
| WebGL via a scene library | VIKUS (**Pixi 5.2.2**), Piling.js (**Pixi 5.1.6, a sprite and texture per item, no atlas or culling, the camera moves every pile on the CPU**), PixPlot (**three r121 as a GL wrapper over its own instanced shaders, one draw call**), umap-explorer and **CSN (three r100 `gl.POINTS` sprites: square, screen-sized, capped)**, Wunderkammer 3D | Instancing and atlases, **when the tool actually uses them** (PixPlot, CSN, umap-explorer; not Piling.js) | (unchanged), plus **none of VIKUS, CSN, umap-explorer or Piling.js handles context loss; PixPlot reloads the page** |
| WebGPU | Embedding Atlas: **confirmed, with no fallback; requires `shader-f16`** | Compute for KDE, blur and density downsampling (**not layout**); device-loss recovery | **Fails in Playwright Chromium and SwiftShader, so CI needs real Chrome; points are discs, and images cannot be the points** |
| Hybrid: GPU overview + DOM detail | VIKUS (**which first promotes in-canvas: a big texture replaces the sprite and the rest fade**), Embedding Atlas (**three layers: WebGPU, SVG labels, DOM card/table/charts**), **PixPlot (lightbox), CSN (hover preview pane)** | (unchanged) | (unchanged) |
| Hybrid with per-item promotion | Wunderkammer 3D, **still the only one, on source evidence** | (unchanged) | (unchanged) |

### 1.2 Image delivery and level of detail

| Option | Used by | Revised notes |
|---|---|---|
| One file per item per size | Wunderkammer reading tier; **Embedding Atlas (one size, full resolution, labels and table only)**; **Piling.js (full source size, all before the first frame: 684 MB at 10k)** | — |
| Fixed sprite sheets per tier | VIKUS (**128 px, not 256; never evicted**), PixPlot (**2048 px row-packed JPEGs re-composited 16 at a time into 8192² textures; aspect kept**), **CSN and umap-explorer (one tier only; the page is the texture, cell = index arithmetic)**, Wunderkammer overview sheets (**square cells**) | **Measured: every atlas peer has its first view in 104–303 ms at 10k, as wunderkammer's sheets do** |
| Runtime atlas from decoded images | Wunderkammer overview atlas and 3D atlases, **PixPlot LOD (8192² of 128² slots, filled by `texSubImage2D`, evicted by camera-grid radius, decoded images cached forever)** | — |
| Tile pyramid / deep zoom | PivotViewer: **a Morton-addressed atlas pyramid shared below MaxLevel and per-item DZI above. Layout never invalidates it, because layout is client-side cropping** | The plan's "pyramids per layout unless per item" is answered: per item at the high end, shared at the low end |
| Per-item progressive tiers | Wunderkammer; VIKUS (**1024 px tier when < 40 in view, not by size; big tier on focus; no unload**); PixPlot (**grid distance + z gate; measured 561 activated vs ~50 visible**) | **No peer chooses its tier by projected size.** Wunderkammer's planned 3D near-tier fix would be the first here |

### 1.3 Filter and query engine

| Option | Used by | Revised notes |
|---|---|---|
| Plain JS predicate over arrays | Wunderkammer, **VIKUS (both modes), PivotViewer (closures, rescanned for counts), PixPlot, CSN (mask loop + React re-render)** | **The common case. No peer has a faster predicate than wunderkammer's 3–16 ms; their advantage is what follows it (no DOM restyle)** |
| crossfilter.js | **Nobody here.** VIKUS's `js/crossfilter.js` is a hand-written O(dims² × n) full scan | Row withdrawn for VIKUS |
| SQL in the browser (DuckDB-WASM / Mosaic) | Embedding Atlas: **Mosaic always; DuckDB-WASM only in wasm, static-export and hosted modes; CLI default is Python DuckDB over HTTP** | **One query per chart per change (~10 here); hover is a query; the 34 MB WASM loads even when unused** |
| GPU-side membership mask | Wunderkammer 3D `setActive`, **CSN (mask attribute, new buffer per change, excluded drawn as ghosts in a second pass)** | — |
| **Dim in place (opacity attribute)** | **PixPlot (0.35)** | **New row: no relayout, keeps context; no counts** |
| **Filter = relayout with dimmed remainder** | **VIKUS (below the axis, alpha 0.2)** | **New row** |
| **Drop and re-upload survivors** | **Embedding Atlas** | **New row: loses place** |

### 1.4 Layout

Revised rows only:

- **Timeline / histogram stacks:** VIKUS, PivotViewer graph view (≤ 12 merged buckets; bars filter
  on click), **PixPlot date layout**.
- **Grouped blocks:** add **PixPlot categorical boxes**, built from one build-time column.
- **Embedding projection:** add **umap-explorer**. Embedding Atlas's is its only layout.
- **Piles:** Piling.js, confirmed. **Its default offset turns piles of hundreds into streaks; it
  assumes piles of tens.**
- **Animated transitions**, by cost at 10k:

  | Tool | Mechanism | Layout-switch script |
  |---|---|---:|
  | PixPlot | GPU mix, one uniform | 76 ms |
  | umap-explorer | CPU tween.js + buffer leak | 197 ms |
  | CSN | CPU tween.js + buffer leak | 431 ms |
  | VIKUS | Per-frame easing | 611 ms |
  | Piling.js | Per-pile tweens | 6,186 ms |
  | PivotViewer | Three stages, input blocked | 947 ms |
  | Wunderkammer | Bounded FLIP of 64 nodes | 249 ms (DOM) |

  - Embedding Atlas animates only the viewport.

### 1.5 State, sharing and packaging

- **Static site + data files:** add PivotViewer (CXML + DZC) and umap-explorer. CSN's static
  build is **stale**: its Colab ships the 2023 bundle.
- **Notebook build step:** CSN builds **data only**, so the Node 16 cost is misattributed.
- **npm + widget + CLI:** Embedding Atlas, understated in the plan. It also has React, Streamlit,
  a static export, a hosted viewer with data, settings and state in the hash, and an **MCP tool
  server**. Piling.js is npm-only. PivotViewer has a small imperative JS API (`setFacets`,
  `addItems`).
- **URL-encoded view state:** add VIKUS (**the viewport as the ids of the extreme items, which
  survives a window resize**), PivotViewer (partial), CSN (dataset + projection), and Embedding
  Atlas's hosted viewer.

## Part 3 — use-case scores

Each report scored on its own scale, so here they are normalised to 0–5 by the coordinator:
Embedding Atlas and Piling.js were scored out of 3, and are scaled by 5/3 and rounded.

| Peer | Research wall | LLM-communicated collection | Why, in one line |
|---|---:|---:|---|
| VIKUS | 1 | 2 | Small declarative JSON and static hosting, but no schema, `eval`, and an offline image pipeline |
| CSN | 1 | 2 | `config.json` is near a spec but mixes build outputs; Python preprocessing; no embed API |
| umap-explorer | 0 | 1 | A renderer demo; every dataset change is a code edit |
| PixPlot | 1 | 2 | The easiest input for an LLM to emit (an image folder + a 9-column CSV), but a heavy build and file-download selection |
| Embedding Atlas | 2 | 4 | The best packaging and an agent surface, but images are not the collection |
| Piling.js | 2 | 2–3 | Manual piling is the one research-wall act; the objective grammar is LLM-friendly; state does not round-trip |
| PivotViewer | 2 | 3 spec / 1 packaging | CXML is a small typed spec; images need a DZC preprocessor; templates `eval` data |

Neither use case is served well by any peer, which matches the plan's premise. Pieces that
transfer:

**Research wall:**
- PixPlot's committed-file cluster curation;
- Piling.js's drag-to-pile and lasso-to-pile;
- PivotViewer's disjunctive counts and histogram layout;
- CSN's scope export.

**LLM direction:**
- Embedding Atlas's packaging set and MCP surface;
- the shape of VIKUS's spec (ordered `layouts[]`, typed `detail.structure[]`) **plus** the schema
  it lacks;
- Piling.js's objective grammar.

## The technique ledger

Ranked by expected effect on a wunderkammer problem that is measured and still open. Grades follow
the plan: **copy** (lift code, keep the notice), **port** (reimplement, credit), **idea**,
**rule out**. Nothing is graded copy: the MIT/BSD code worth having is small, and it fits
wunderkammer better re-expressed.

Two notes on the wunderkammer files named below:
- Files under `wall/spatial/lib/` are vendored from muriel. Changes there go upstream first, then
  sync (AGENTS.md).
- A `perf-budgets.json` key in quotes exists today. "(new)" means the change needs a key that
  does not exist yet.

### Copy and port

| # | Technique | Source | Grade | Wunderkammer file | Metric it should move | Budget |
|---|---|---|---|---|---|---|
| 1 | Layout transition as two instanced position (and scale) attributes plus one tweened uniform: the vertex shader mixes, the CPU commits once at the end | `pix-plot@3afce47 pixplot/web/index.html:93-130`, `tsne.js:718-745, 814-835` | port | `wall/spatial/lib/instanced.js`, `motion.js` (muriel upstream), `wall/spatial/spatial-view.mjs` | 3D regroup script and frames > 33 ms at 10k. Peers at 10k: GPU mix 76 ms vs CPU tweens 197–611 ms | "spatial filter on" scriptMs; add "spatial group →" (new) |
| 2 | Sample the baked sheet page directly as the 3D far-tier texture: a per-instance cell offset plus one repeat/scale, cell addressed from the sheet slot, no runtime blit | `umap-explorer@d31e3de src/Projection.js:270-278, 288-292`; `CSN@96147ee src/Projection.js:255-263` | port | `wall/spatial/lib/instanced.js` (far-tier UV; muriel upstream), `wall/spatial/spatial-view.mjs`, `wall/overview-sheets.mjs` | 3D far-tier requests 1,793 → 2–3 pages; time to atlas residency | "spatial open" |
| 3 | Dynamic map labelling (Been, Daiches & Yap 2006): give each group heading or cluster label a visible-scale interval once; show or hide by scale with no per-frame collision work | `embedding-atlas@f2fff54 packages/component/src/lib/dynamic_label_placement/dynamic_label_placement.ts:36-120`, `embedding_view/labels.ts:20-74` | port (credit the paper and Apple) | `wall/layout.mjs`, `wall/overview-surface.mjs`, `wall/context-clusters.mjs` | Heading collisions = 0 at every zoom; zoom frame max unchanged | "flat zoom in", "flat zoom out" framesMax |
| 4 | Disjunctive facet counts: count each facet over every filter except its own, so a sibling value in an OR facet shows what adding it gives. Today wunderkammer counts over `state.filtered`, so siblings read as empty | `seajax@0293770 v2/app/pivot/PivotViewer.js:2777-2786`, `PivotView.js:573` | port | `wall/wall.mjs` (`updateFacetShares`, ~390–398) | Correctness; cost must stay inside the filter budget | "flat filter on" inputBlockMs ≤ 50 |
| 5 | Numeric range filter: an 11-bin in-scope histogram with a two-handle slider that filters on release. Bin **all** values, not PivotViewer's first value. Compute bins once per scope change, not in render (CSN's anti-pattern) | `seajax@0293770 v2/app/pivot/NumberPicker.js:84-127, 255-266`; `CSN@96147ee src/Sliders/BarChart.js:18-60` | port | `wall/wall.mjs` (rail), `wall/attributes.mjs` | Fills Part 2 "Numeric range filters: no"; release → paint | "flat filter on" inpMs ≤ 100 |
| 6 | Row-packed sheet cells with variable width (fixed height, aspect kept, no padding). Today wunderkammer's square cells hold a 16:9 screenshot at 32×18 inside 32×32, wasting 44% of the cell *(arithmetic)* | `pix-plot@3afce47 pixplot/pixplot.py:488-539` | port | `scripts/sheets.py`, `lib/sheets.mjs`, `wall/overview-sheets.mjs` | Sheet bytes and decoded px for wide corpora; the 16 Mpx decode budget admits more levels | "boot" imagesMs |
| 7 | Representative pile face: k-means over item features, with the nearest item to each centroid as cover or previews, computed in a worker | `piling.js@9983067 src/representative-aggregator.js:1-60` (Embedding Atlas's PageRank pick is the alternative: `image_summarizer.ts:22-76`) | port | `wall/spatial/lib/piles.js` (muriel upstream), `wall/context-clusters.mjs` | Recognisable large piles; no main-thread cost | "spatial filter on" longestTaskMs |
| 8 | Density ↔ image cross-fade keyed to on-screen density: the scale at which the densest region falls below k items per px², ramped over one e-fold | `embedding-atlas@f2fff54 .../EmbeddingViewImpl.svelte:45-89` | port (formula only) | `wall/overview-surface.mjs` | Zoom-out max frame at 10k–25k (wunderkammer 210 ms at 10k) | "flat zoom out" framesMax |

### Ideas, ranked

| # | Idea | Source | Wunderkammer file | Ties to |
|---|---|---|---|---|
| 9 | **An agent control surface**: MCP tools over the live wall (schema, read-only query, set scope/group/camera, screenshot) | `embedding-atlas@f2fff54 viewer/src/model_context/model_context.ts:66-338`, `backend/embedding_atlas/server.py:295-325` | new `lib/` module; `wall/view-state.mjs`, `wall/permalink.mjs` | LLM direction |
| 10 | **A collection spec with a schema**: VIKUS's shape (items + typed facets, ordered `layouts[]`, typed `detail.structure[]`), Piling.js's objective grammar (`type` + property or `{property, aggregator}`), PivotViewer's typed facet list, every key JSON (no functions, no `eval`), defaults and readable errors | `vikus-viewer@ccb4e7e js/viz.js:210-247`, `index.html:108-130`; `piling.js@9983067 src/library.js:4106-4187`; `seajax@0293770 v2/app/pivot/CxmlLoader.js:180-247` | `lib/instance-config.mjs` | LLM direction: first-try success as an acceptance test |
| 11 | Data + settings + state in a compressed URL hash for a server-free build | `embedding-atlas@f2fff54 viewer/src/utils/query_payload.ts:7-90` | `lib/permalinks.mjs`, static demo build | Portable views; artifact packaging |
| 12 | Selection flows back: lasso or scope → export CSV/JSON, and a host callback | `pix-plot@3afce47 tsne.js:1754-2110`; `CSN@96147ee src/Export.js:16-50`; `embedding-atlas@f2fff54 backend/embedding_atlas/widget.py:125-146` | `wall/wall.mjs`, piles | LLM direction; research wall |
| 13 | Place-preserving filter: keep excluded items as dim ghosts (CSN), dimmed in place (PixPlot 0.35), or as territory below an axis (VIKUS) | csn.md Q2; pixplot.md Part 1 1.3; vikus.md Q3 | `wall/spatial/spatial-view.mjs` (`setActive`), `wall/overview-surface.mjs` | TODO "Place-preserving filters and Gather" |
| 14 | Preview a facet value or histogram bucket as alpha only on hover, without committing scope | `vikus-viewer@ccb4e7e js/tags.js:352-386`; `CSN@96147ee src/Sliders/BarChart.js:66-89` | `wall/attribute-brush.mjs`, rail | Cheap "what lives here" |
| 15 | Decide the detail pane from the zoom **target** at gesture start, and close detail by zooming out past a threshold; the close cost lands in transition frames, not the input event | `seajax@0293770 PivotViewer.js:1638-1645`; `vikus-viewer@ccb4e7e js/canvas.js:1244-1265` | `wall/detail-pane.mjs`, `wall/reader-lift.mjs` | TODO "Detail close INP ~170–208 ms" |
| 16 | Separate leave / move / arrive phases with a radial exit for items crossing the scope boundary, inside wunderkammer's bounded 220 ms FLIP | `seajax@0293770 PivotViewer.js:246-262, 402-537` | `wall/layout-motion.mjs` | Object constancy on filter |
| 17 | Temp depile: double-click fans a pile in place over a dimming layer | `piling.js@9983067 src/library.js:2042-2051, 2089-2205` | `wall/spatial/lib/piles.js` | TODO "Large-pile scrub/fan and partial spread" |
| 18 | Curated clusters as a committed file (rename, reorder, re-pick representative, save) | `pix-plot@3afce47 tsne.js:3143-3396` | `wall/context-clusters.mjs` | TODO "Place the cluster suggestions" |
| 19 | Device- or context-loss recovery: rebuild renderer and atlases | `embedding-atlas@f2fff54 .../EmbeddingViewImpl.svelte:323-331` | `wall/spatial/` | TODO "Hybrid failure recovery" |
| 20 | Permalink stores the viewport as the ids of its extreme items, not translate/scale | `vikus-viewer@ccb4e7e js/canvas.js:273-334, 1363-1383` | `wall/permalink.mjs` | Views across window sizes |
| 21 | Image request tiebreak by distance to centre after on-screen area. Wunderkammer already ranks by area (`wall/wall.mjs:1397`), so the seajax "port" reduces to this | `seajax@0293770 v2/src/image/TileLoader.js:62-80` | `wall/wall.mjs` | Time to all-visible after zoom |
| 22 | Morton power-of-two cells so one pyramid serves every tier. Wunderkammer's levels are separate pages by design, so the gain is unproven | `seajax@0293770 v2/src/image/DzcTileSource.js:86-107` | `scripts/sheets.py` | Zoom-out max frame (first-upload hypothesis) |
| 23 | Debounced full-resolution image on hover (100 ms of rest) | `CSN@96147ee src/PreviewPane.js:19-28` | `wall/detail-pane.mjs` | "detail walk" |
| 24 | Auto pile or split on zoom by screen overlap | `piling.js@9983067 src/library.js:570-596, 2753` | `wall/overview-surface.mjs` | Overplot at 10k+ |
| 25 | **Zoom spreads, it does not enlarge** (a similarity-map mode): items stay a fixed 14–28 screen px while zoom opens the space between neighbours, so a dense cluster becomes legible without any tile growing. Promotion to reading size stays an explicit act (hover or click), not a side effect of zoom. Andy singled this out while dogfooding CSN on 2026-10-14 | `umap-explorer@d31e3de src/Projection.js:26-45, 148-153` (`zoomScaler`); `CSN@96147ee src/Projection.js` (same) | `wall/layout.mjs` similarity arrangement; 3D field | Overplot at 10k+; similarity layout |
| 26 | **Similarity grid beside the similarity map, switched by icons**: the 2-D map snapped to a lattice by an assignment step, so neighbours stay neighbours with zero overlap; scatter and grid are sibling arrangements behind toolbar icons, with a GPU tween between them. Andy singled out the scatter/grid iconography while dogfooding PixPlot on 2026-10-14. Assignment options: scipy `linear_sum_assignment` (BSD) or [lapjv](https://github.com/src-d/lapjv) (MIT) exact; [RasterFairy](https://github.com/Quasimondo/RasterFairy) (BSD-3) approximate at any n | `pix-plot@3afce47 pixplot/pixplot.py` rasterfairy layout; viewer layout icons (H:385-393, T:570-583, T:687-745) | `wall/layout.mjs`, index scripts | Similarity layout without overlap on the DOM wall |
| 27 | **Details on zoom, no click** (built 2026-10-14, see [ZOOM_DETAIL.md](ZOOM_DETAIL.md)): when any visible item's on-screen size exceeds half the free view (width minus the details rail, or height), the item nearest the rail-adjusted centre shows its details; zooming out hides them. Andy singled this out while dogfooding PivotViewer on 2026-10-14. For wunderkammer: drive the existing *preview* path (temporary, commits nothing), evaluate at landing not mid-gesture, add open/close hysteresis, and keep the stage box fixed when the pane opens | `seajax@0293770 v2/app/pivot/PivotViewer.js:1618-1650` (`wideEnough`, `tallEnough`, `adjustedCenter`, `zoomedIn`) | `wall/wall.mjs` preview path, `wall/detail-pane.mjs` | Fewer clicks in Review/Dive; detail reached by zoom alone |

**Harness rule (adopted for future runs).** Count GL buffer and texture create/delete calls
(an init-script wrapper on `createBuffer`, `deleteBuffer`, `createTexture`, `deleteTexture`,
`bufferData` bytes) per gesture. That probe exposed CSN's and umap-explorer's leak, and it costs
nothing (csn.md Q1). Target: `scripts/perf.mjs` and `scripts/peer-perf/peer-perf.mjs`; budget
"session retained" (new: GL objects).

### Ruled out (also recorded in PRECEDENTS.md)

| Technique | Source | Reason (measured where possible) |
|---|---|---|
| CPU tween of a typed array, with a new `BufferAttribute` per frame | CSN, umap-explorer | +390 / +840 GL buffers per switch at 10k, none freed; 197–431 ms script |
| Per-frame CPU easing of every sprite, frame-rate dependent | VIKUS `js/canvas.js:995-1037` | 611 ms layout-switch script at 10k; no `dt`; no staging. Wunderkammer's bounded motion is better |
| 3-stage choreography with a 0–300 ms random stagger and 700 ms per stage, input blocked | PivotViewer | ~3 s per filter with input frozen; wunderkammer budgets filter INP ≤ 100 ms |
| Snap in-flight items to their destination when interrupted | PivotViewer `:1077, 1366` | Wunderkammer's mid-flight capture is already better |
| LOD by camera-grid distance with a z gate | PixPlot `tsne.js:2742-2898` | 561 activated vs ~50 visible; the opposite of the projected-size plan |
| LOD by a count-in-view threshold (< 40) | VIKUS `js/canvas.js:1644-1682` | A count is not a size; projected size is the planned rule |
| `lod.clear()` and an attribute re-upload every overview frame | PixPlot `tsne.js:2783-2785` | An idle frame should upload nothing |
| Fixed device-max textures (2 × 8192² = 512 MiB) whatever the n; reload on context loss | PixPlot | GPU memory must follow need |
| Texture tiers never evicted; relying on Pixi's render-count GC | VIKUS | No budget; idle sessions never reclaim |
| A decoded-tile cache bounded by count | PivotViewer `TileLoader.js:44` | Memory must be budgeted in bytes |
| Fixed 6-per-host / 30-total request caps | PivotViewer `Network.js:42-47` | HTTP/1-era constant |
| Canvas at CSS resolution with tiles fetched for DPR | PivotViewer | Measured 12 s vs 1.1 s to fully drawn at DPR 2 vs 1 (music, smoke) |
| Every full-size image loaded before the first frame | Piling.js | 684 MB and 16.9 s at 10k |
| Camera applied by moving every pile on the CPU | Piling.js | Pan script 347 → 5,704 ms from 406 to 10k |
| Eager per-item preview textures | Piling.js | Doubles textures for every item, not just pile members |
| State with function-valued keys; serialised export that does not reload | Piling.js | Measured throw on reload; every spec key must be JSON |
| `gl.POINTS` sprites for images | CSN, umap-explorer | Square, screen-sized, capped; no world scale or rotation for piles |
| Two downloads per atlas (`<img>` + texture) | CSN, umap-explorer | 91 MB on the wire for 60 MB of atlases at 10k |
| Mosaic + DuckDB crossfilter | Embedding Atlas | Wunderkammer's predicate is 3–16 ms; this adds a query per chart and a 34 MB WASM, and does not touch restyle, which is the measured cost |
| Filter by dropping and re-uploading survivors | Embedding Atlas | Loses place-preserving context |
| Hover picking by a database query | Embedding Atlas | One async round trip per hover |
| GPU colour picking with a full-canvas render per click | PixPlot `tsne.js:2324-2341` | `readPixels` stall per pick. Revisit only as a 1×1 scissored render if CPU picking fails at 25k |
| Fragment-shader `if` chain over a sampler array | PixPlot | Use texture arrays if multi-page sampling is ever needed |
| A loader gate plus 2.5 s of fixed animation before interaction | PixPlot | Wunderkammer's ready budget is 1 s |
| Offline sprite pipeline from vikus-viewer-script | vikus-viewer-script | No licence; offline only; wunderkammer has `scripts/sheets.py` |
| A spec field type that runs `eval`; templates that evaluate data | VIKUS `js/sidebars.js:29-34`; PivotViewer templates | Unsafe for any agent-emitted spec |

## What this study did not establish

- **Why the cap drops wunderkammer's content.** The probe shows that it does and that canvas peers are
  immune. The mechanism, compositor tile memory for the world-sized `#canvas` layer, remains the
  TODO's hypothesis *(inferred)*.
- **Peer GPU memory.** No tool exposed resident GPU bytes. VIKUS, CSN and PixPlot figures are
  arithmetic from texture sizes.
- **Filter latency at a million rows in Embedding Atlas.** The largest corpus here is 10k.
- **Hover cost.** No scenario sweeps the pointer, and CSN's per-hover React re-render (csn.md Q2)
  is untimed.
- **seajax's slow tile issue rate at DPR 2** (25–40 per second, not network-bound).
- **Cross-browser behaviour.** Everything here is Chrome on one Mac.

## Reproduce

```bash
python3 -I scripts/peer-perf/normalize.py --clips <api-clips.json> --cache <instance cache> --out <peer-study workspace>/corpora/<corpus>
uv run --with umap-learn --with pillow --with numpy --with scikit-learn python -I scripts/peer-perf/project.py --corpus <peer-study workspace>/corpora/<corpus>
# per peer: clone at the pinned commit, run scripts/peer-perf/convert-<peer>.*, then .local/peer-study/<peer>/serve.sh
TAG=pass RUNS=3 scripts/peer-perf/run-all.sh
node scripts/peer-perf/summarize.mjs --prefix pass
```
