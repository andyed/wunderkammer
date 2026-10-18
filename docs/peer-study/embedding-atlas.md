# Peer study: Embedding Atlas (Apple)

Peer key `embedding-atlas`. All citations are `apple/embedding-atlas@f2fff54` paths relative to the repo
root (`packages/...`) unless marked otherwise. "Smoke" numbers come from the single headless `--chrome`
smoke run and gesture checks on 2026-10-13; they show the gestures work and are not timed measurements.

## Pin, licence, build and run

- **Clone:** `<peer-study workspace>/embedding-atlas`, `git rev-parse --short HEAD` = `f2fff54`
  (2026-10-08, "fix: check readonly query for the MCP query tool"). That is `v0.25.0` plus 6 commits
  (`git describe` = `v0.25.0-6-gf2fff54`). PyPI `embedding-atlas` 0.25.0 is the nearest release, but
  **everything below runs from the pinned source**, not PyPI.
- **Licence:** MIT, `LICENSE` at the repo root, "Copyright (c) 2025 Apple Inc.". Every source file
  carries the header `Copyright (c) 2025 Apple Inc. Licensed under MIT License.` There is no NOTICE
  file. **Obligation:** anything copied keeps that copyright line and the MIT permission notice (a
  file header or a wunderkammer `NOTICE` entry). Third-party bundles (DuckDB-WASM, Mosaic, FlexSearch,
  transformers.js) have their own licences; nothing here proposes vendoring them.
- **Build** (log: `.local/peer-study/embedding-atlas/build5.log`). This was harder than the docs say:
  - `npm run build` needs Rust with the `wasm32-unknown-unknown` target plus `wasm-bindgen-cli`, to
    build `density-clustering` and `umap-wasm`.
  - Andy's `~/.rustup` stable toolchain is broken: `~/.cargo/bin/cargo` links to a missing `rustup`,
    so Homebrew's rust 1.98.1 (no wasm std) shadows it, and its `rust-lld` cannot find
    `libLLVM.dylib`. I left it untouched and installed an **isolated** toolchain in
    `<peer-study workspace>/.rust` (`RUSTUP_HOME`/`CARGO_HOME` there, `--profile minimal --target
    wasm32-unknown-unknown`). The fresh toolchain's `rust-lld` has the same rpath problem, fixed with
    one symlink inside the isolated copy:
    `lib/rustlib/aarch64-apple-darwin/lib/libLLVM.dylib -> ../../../libLLVM.dylib`.
  - **The docs contradict the lockfile.** `packages/docs/develop.md` says
    `wasm-bindgen-cli --version 0.2.114`, but `Cargo.lock` pins `wasm-bindgen 0.2.121`, so the bindgen
    step fails with a schema mismatch. 0.2.121 is installed in the isolated `CARGO_HOME`.
  - After those fixes, `npm install && npm run build` passes and writes the viewer to
    `packages/backend/embedding_atlas/static/` (87 MB; the DuckDB-WASM `duckdb-eh.wasm` alone is 34 MB).
- **Run:** `uv run embedding-atlas <parquet> --text text --image image --x x --y y --neighbors neighbors
  --state state.json --static <dir> --host 127.0.0.1 --port N --no-auto-port`, run in
  `packages/backend` (uv resolves the pinned `uv.lock`, torch included). This is the default
  `--duckdb server` mode. Recipe: `.local/peer-study/embedding-atlas/serve.sh`
  (idempotent; kills its own ports; logs `<corpus>.log` beside it). **Servers left running.**
- **Ports:** music 4340, psychodeli 4341, synth10k 4342. All three corpora run, 10k included.
- **Browser requirement:** WebGPU with `shader-f16`. Playwright's bundled headless Chromium has no
  adapter, and SwiftShader (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`) gives an
  adapter without `shader-f16`. Either way the map shows "WebGPU is unavailable". **Run the harness
  with `--chrome`.** Headless Google Chrome works on this Mac.
- **Persistent label cache:** the CLI stores auto-label results in `~/Library/Caches/embedding_atlas`,
  keyed by the dataset identifier (`backend/embedding_atlas/cache.py:50,89`;
  `data_source.py:78-83`; client side `EmbeddingViewImpl.svelte:585-599`). After the first ever
  load, every "cold" boot skips label generation. For a true cold boot, clear that directory first.

### Converter

`scripts/peer-perf/convert-embedding-atlas.py` (the header has usage and the
full mapping). It writes `data.parquet`, `state.json` and `images/` (hard links) into
`<peer-study workspace>/instances/embedding-atlas/<corpus>/`. `serve.sh` copies `state.json` to
`.local/peer-study/embedding-atlas/<corpus>/`.

What maps:
- **Columns:** id, title, text (the CLI `--text`: tooltip, full-text search, TF-IDF labels), kind,
  source, nullable `year`, and `date` as a timestamp.
- **Facets:** one column per facet. A facet with at most one value per item is a string; otherwise
  it is `list<string>`, which the viewer turns into an `isList` count plot
  (`viewer/src/charts/default_charts.ts:124-140`).
- **Projection:** `projection.json` becomes `x`/`y`, passed as `--x/--y`, so the CLI skips
  embedding (`backend/embedding_atlas/cli.py:493`).
- **Neighbours:** exact cosine kNN (k=15) over `features.npy` becomes the `neighbors` column. With
  `--image` that makes the CLI compute PageRank (`cli.py:578-592`), and PageRank is what picks the
  image labels.
- **Images:** an absolute URL (`http://127.0.0.1:<port>/images/<id>.jpg`). Each corpus gets a
  `--static` dir: an APFS clone of the built viewer with `images/` inside it, because the CLI serves
  its UI with one Starlette `StaticFiles` mount at "/" (`backend/embedding_atlas/server.py:219`).
- **Image rendering:** a plain http URL is auto-detected as a *link*, not an image
  (`viewer/src/renderers/renderer_utils.ts:14-16`). `state.json` therefore sets
  `columnStyles.image = {renderer: "image", display: "full"}`
  (`viewer/src/renderers/renderer_types.ts:143-165`). Without `display: "full"`, the tooltip shows
  the URL as a link.
- **Charts:** `state.json` also authors the chart list. The defaults would add count plots for id,
  title and the image URL on the 406-item corpus, because every string column with 1,000 or fewer
  distinct values gets one (`default_charts.ts:121-131`). Supplying `charts` replaces the defaults
  (`viewer/src/stores/embedding_atlas_store.ts:197-201`).

What is lost:
- **palette:** no swatch renderer.
- **width/height:** the tool never lays out images.
- **Rail order and display names:** wunderkammer's facet ordering and labels are gone.
- **Every layout but the projection:** no grouping, timeline or grid.
- **Bytes as an alternative:** the image column can hold bytes or base64 (`utils/src/media.ts:11-40`),
  but that would put 684 MB of JPEG into the synth10k table, so URLs were used.

## Pipeline

```
data in      parquet/CSV/JSONL or HF dataset → pandas → optional embed+UMAP (Python) → DataSource   backend/embedding_atlas/cli.py:409-493, 646-650
index        DuckDB table, on the Python server ("rest", default) or in DuckDB-WASM ("wasm"/static export);
             Mosaic coordinator issues every chart's SQL                                            backend/embedding_atlas/server.py:74-99,130-155; viewer/src/utils/database.ts:14-30
layout       none at runtime: x,y columns are the layout; the client SELECTs x::FLOAT, y::FLOAT
             (+ category::UTINYINT) WHERE <crossfilter predicate>                                   component/src/lib/embedding_view/EmbeddingViewMosaic.svelte:95-126
render       WebGPU only: points as instanced quads (WGSL), optional KDE density + contours via compute
             (accumulate → Gaussian blur → quantised Sobel contours), density-biased downsampling >4M;
             SVG overlay for labels (text or 48 px images); DOM for tooltip card, table, charts      component/src/lib/webgpu_renderer/renderer.ts:426-525; program.wgsl:96-268; EmbeddingViewImpl.svelte:748-790
interaction  wheel zoom / drag pan in JS → uniforms; hover and click = an SQL nearest-point query;
             brush/lasso/facet clicks = Mosaic selection clauses → every client re-queries          EmbeddingViewImpl.svelte:387-470,478-540; mosaic_client.ts:215-243; viewer/src/charts/basic/CountPlot.svelte:115-170,239-270
```

## Part 4 answers

### 1. The real stack: WebGPU and its fallback; Mosaic/DuckDB-WASM or not; where filter latency goes

- **WebGPU with no fallback.** `requestWebGPUDevice` returns null without `navigator.gpu`, without an
  adapter, or without the `shader-f16` feature (`component/src/lib/webgpu_renderer/utils.ts:4-24`).
  The view then shows "WebGPU is unavailable. This view requires a browser with WebGPU support."
  (`component/src/lib/embedding_view/EmbeddingViewImpl.svelte:300-313`).
  - There is no WebGL or Canvas2D path anywhere in `component/src` (grep for `webgl` finds nothing).
  - The parallel-coordinates view is WebGPU too (`parallel_coordinates_view/ParallelCoordinatesView.svelte:385`).
  - Observed: Playwright Chromium headless shows "No available adapters". With SwiftShader the error
    is "adapter does not support required features: shader-f16".
- **Device loss is handled.** On `device.lost` with a reason other than "destroyed", it destroys the
  renderer, unconfigures the context and creates a new device and renderer
  (`EmbeddingViewImpl.svelte:323-331`). That is more than wunderkammer's three.js view does today
  *(inferred from wunderkammer TODO "Hybrid failure recovery")*.
- **Mosaic yes; DuckDB-WASM depends on the mode.** All charts are Mosaic clients over one
  coordinator (`viewer/src/charts/basic/CountPlot.svelte:125`; `EmbeddingViewMosaic.svelte:95`). The
  database behind the coordinator is chosen from server metadata (`server.py:74-99`):
  - CLI default `--duckdb server`: type `rest`. Each query is an HTTP POST to `/data/query`, run by
    Python DuckDB in a thread pool and returned as Arrow IPC (`server.py:130-155, 193-206`).
  - `--duckdb wasm`, `--export-application` static builds (`data_source.py:98-105, 137`) and the
    hosted file viewer: DuckDB-WASM loads the parquet in the browser (`backend_data_source.ts:66-81`).
  - The Jupyter widget answers Mosaic SQL in the kernel over the comm channel (`widget.py:148-168`).
- **The README framing ("runs in the browser") is only true of the wasm modes.** Also,
  `initializeDatabase` calls `createDuckDB()` before it looks at the type (`viewer/src/utils/database.ts:19`).
  So even in server mode the 34 MB `duckdb-eh.wasm` is downloaded and instantiated, though it is never
  queried. Observed in network logs on every boot. It is fetched by the DuckDB worker, so the
  harness's page resource-timing counts (`otherWireKB` ~3.8 MB) **do not include it**.
- **Where filter latency goes**, from the code. No million-row run was made: no timed runs, and the
  corpora top out at 10k.
  1. **One SQL query per Mosaic client per selection change.** Each count plot runs a GROUP BY with a
     `SUM(predicate)` column and two scalar subqueries (`CountPlot.svelte:128-145`). A list facet
     first UNNESTs into a CTE (`:147-168`). Add the histogram, the instances page (LIMIT 50,
     `Instances.svelte:42,183`), the totals counter and the embedding's x/y select. In rest mode each
     one is an HTTP round trip plus Arrow encode and decode. In our layout one filter click means
     about 10 queries.
  2. **The embedding drops filtered-out points; it does not mask them.** The client re-selects
     `x::FLOAT, y::FLOAT WHERE predicate`, gets fresh typed arrays (`EmbeddingViewMosaic.svelte:98-123`),
     and the dataflow graph re-uploads them into GPU storage buffers (`renderer.ts:270-288`
     `makeDataBuffers` derives buffers from `xData`). That is 8 bytes per row on the wire and in the
     upload, so about 8 MB per filter change at 1M rows *(inferred)*.
  3. **Density work, only in density mode or when downsampling** (more than 4M points by default,
     `viewer/src/charts/embedding/Embedding.svelte:50`): accumulate, Gaussian blur and contour passes
     on the GPU each frame the inputs change (`renderer.ts:497-525`).
  4. **Labels are not recomputed on filter.** Generation runs once per labels prop at the default
     viewport (`EmbeddingViewImpl.svelte:268-278`). Its text query has no WHERE clause
     (`EmbeddingViewMosaic.svelte:357-363`).
  5. **Hover is also a query.** Every throttled hover runs `ORDER BY distance LIMIT 1` inside a box
     (`component/src/lib/embedding_view/mosaic_client.ts:215-243`), and it selects *every* column
     because the viewer passes all columns as `additionalFields` (`Embedding.svelte:284-286`).
     Picking costs one database round trip per hover. There is no GPU picking.
  - Smoke observation: filterOn and filterOff each took about 90–115 ms wall time (click until the
    "N / M points" counter changed) on all three corpora, headless Chrome, rest mode, warm label cache.

### 2. Semantic zoom: density/contours far out, points near

- **It exists, but only in "density" mode.** The default is "points" (`Embedding.svelte:277`,
  `spec.mode ?? "points"`), and the viewer forces "points" when the colour-by column has more than
  20 categories (`Embedding.svelte:48, 99-105`). The mode is a select in the map's settings popover.
- **The blend is a function of zoom scale** (`viewingParameters`, `EmbeddingViewImpl.svelte:45-89`):
  - It computes the scale at which the densest region's on-screen density falls to `minimumDensity`
    (default 1/16 points per CSS px², `:216`). Call that the threshold.
  - A blend factor ramps across one e-fold of scale on either side of it:
    `factor = clamp((ln scale − ln threshold)·2, −1, 1)` mapped to 0..1.
  - Density and contour alpha = 1 − factor. Point alpha = 0.5 + 0.5·factor.
  - Point size follows data density: `0.25/√maxPointDensity`, clamped to 0.2–5 px
    (`:73-76`). It does not follow a fixed pixel size.
- **What the density map is:** a KDE on a quarter-resolution grid (`densityPixelRatio = 4`,
  `renderer.ts:337`), bandwidth 20 px, blurred with a recursive Gaussian
  (`gaussian_blur.ts`, `kde_config.ts`). Contours come from quantised density plus Sobel in the
  fragment shader (`program.wgsl:204-266`). With a colour-by column it keeps one density channel per
  category, up to 32 (`component/src/lib/embedding_view/api.ts:6-10`).
- **Downsampling is a second scale mechanism.** Above `downsampleMaxPoints` (default 4M in the
  viewer), points are kept with probability biased against dense areas, using the blurred density
  buffer (`embedding_view_config.ts:32-42`; `renderer.ts:493-505`).
- **Labels are the third tier.** There are two label levels (KDE bandwidth 10 and 5), each with a
  visible scale range from dynamic label placement (Q4). Far out, the map shows coarse labels; near
  in, finer ones.
- **Observed** on synth10k in density mode: zoomed out, the map is filled contours with no points
  visible; zoomed in, points with image labels. **Images never become the points**; see "How images
  are rendered".

### 3. Packaging: npm component API, Python widget, CLI, and how a host passes data in

- **npm `embedding-atlas`** (`packages/embedding-atlas/package.json`; re-exports in
  `packages/embedding-atlas/src/*.ts`, plus a `react` entry). It has three component levels, each a
  class with `new X(target, props)`, `.update(props)`, `.destroy()`:
  - `EmbeddingView`: bring your own arrays. `data: {x: Float32Array, y: Float32Array, category?:
    Uint8Array}`, and the host supplies `querySelection(x, y, unitDistance)` for picking and
    `queryClusterLabels(rects)` for labels (`component/src/lib/embedding_view/embedding_view_api.ts:14-98`).
    This is the renderer with no database.
  - `EmbeddingViewMosaic`: a Mosaic `coordinator` plus a `table` and column names `x, y, category,
    text, image, importance, identifier`, plus a Mosaic `filter` selection
    (`embedding_view_mosaic_api.ts`).
  - `EmbeddingAtlas`: the whole app. Props are `coordinator`, `data: {table, id, projection: {x, y},
    neighbors, text, image, importance, features}`, `initialState`, `defaultChartsConfig`,
    `embeddingViewLabels`, `searcher` (host full-text or vector search), and callbacks
    `onStateChange`, `onPredicateChange` (SQL WHERE string), `onExportSelection`, `highlight`
    (row ids pushed in) and `modelContext` (`viewer/src/api.ts:19-117`).
  - **The host passes data in by loading a DuckDB table into the coordinator**, not by handing over
    objects.
- **Python:**
  - `EmbeddingAtlasWidget(df, ...)` is an anywidget. It syncs `_props`, `_state` and `_predicate`
    as traitlets, answers the front end's SQL in the kernel (`widget.py:25-35, 148-168`), and
    `widget.selection()` returns the brushed rows as a DataFrame, Arrow table or predicate
    (`widget.py:125-146`). Selection flows back to the host.
  - A Streamlit component also exists (`streamlit.py:15`).
  - Options for both are validated by `make_embedding_atlas_props` (`options.py`).
- **CLI:** `embedding-atlas <files|hf-dataset>`. It can embed and run UMAP itself, or take
  `--x/--y/--neighbors`. Other flags:
  - `--labels` (a table of x, y, text, level, priority)
  - `--state` (initial charts and layouts)
  - `--table`/`--table-relation` (cross-table filtering)
  - `--export-application dir|zip` (a static, server-free site on DuckDB-WASM)
  - `--mcp` (`cli.py:155-407`)
- **MCP, the most relevant surface for the LLM direction.** With `--mcp`, the live page registers
  about 30 tools over a websocket proxy (`backend/embedding_atlas/server.py:295-325`;
  `viewer/src/model_context/model_context.ts:66-338`):
  - `data_schema`, `data_query` (read-only SQL; the pin commit itself is "check readonly query for
    the MCP query tool")
  - `chart_create`/`chart_set_spec`/`chart_set_state` (set filters)
  - `layout_*`, `column_style_set`
  - `chart_screenshot_get`/`app_screenshot_get`
  - `best_practices`

  An agent can query, filter and *look at* the view.
- **Hosted file viewer with state in the URL.** `#/file?data=<parquet url>&settings=…&state=…`,
  where each payload is deflate-raw plus base64 JSON in the hash (`viewer/src/utils/query_payload.ts:7-90`;
  `viewer/src/app/FileViewer.svelte:36-47, 85, 95-154`). Settings can name precomputed x/y columns,
  or ask the browser to embed a column with transformers.js and run UMAP in WASM
  (`FileViewer.svelte:102-125`; `viewer/src/app/compute_projection.ts:96-135`). That makes a
  data URL plus a small JSON spec into a working explorer, which is very close to an
  "LLM-emittable spec".

### 4. Automatic cluster labels and their placement

- **Clusters come from the GPU density map:**
  - The renderer draws a 1000×1000 density map of all points at the default viewport
    (`renderer.densityMap`, `renderer.ts:205`).
  - The Rust/WASM `findClusters` (`packages/density-clustering`) segments it into clusters, each
    with a boundary approximated by rectangles.
  - This runs twice, at KDE bandwidth 10 (level 0) and bandwidth 5 (level 1). Clusters carrying
    less than 0.5% of the top cluster's density are dropped (`EmbeddingViewImpl.svelte:548-579, 601-604`).
- **Label content:**
  - **Image labels** when `image` and `importance` columns both exist. `ImageSummarizer` keeps the
    highest-importance (PageRank) point inside each region, using an XY binning grid
    (`component/src/lib/image_summarizer/image_summarizer.ts:22-76`). Its image is fetched, fitted to
    48 px (`labels.ts:9`, `EmbeddingViewMosaic.svelte:395-476`), and **moved to that point's
    position** rather than the cluster centroid (`EmbeddingViewImpl.svelte:606-615`).
  - **Text labels** otherwise: c-TF-IDF over the text column, in a worker, with stemming and NLTK
    stop words (`text_summarizer/text_summarizer.ts:8`). The top words are joined with hyphens over
    two lines (`EmbeddingViewMosaic.svelte:386-393`).
  - Hosts can pass their own labels (`--labels`, or the `labels` prop with x, y, text, level and
    priority).
- **Placement uses Been, Daiches & Yap, "Dynamic Map Labeling", TVCG 2006**
  (`dynamic_label_placement/dynamic_label_placement.ts:3-4`):
  - For every pair of labels it computes the scale at which their boxes stop overlapping (`:44-60`).
  - It then greedily assigns each label a [minScale, maxScale] interval by priority, where priority
    is the cluster's summed density.
  - Level 0 labels are capped above and level 1 labels below (`labels.ts:20-74`).
  - At render time a label is drawn only when the current scale is inside its interval
    (`EmbeddingViewImpl.svelte:751-757`). Labels never collide, and the set changes with zoom
    without being recomputed.
  - Placement runs in a worker (`embedding_view/worker/`).
  - Cost: the pairwise scan is O(n²) over labels. That is fine for tens of labels and would not be
    for thousands.
- **Labels are computed once** and cached client and server side (`EmbeddingViewImpl.svelte:585-631`).
  They do not follow filters or colour-by.

### Also asked: how images are rendered, and whether images can be the points

- **On the map, images appear only as cluster labels.** They are SVG `<image>` elements in an
  overlay above the WebGPU canvas, at most 48 px, one per cluster per level
  (`EmbeddingViewImpl.svelte:748-768`). Smoke: 20 labels on music, 29 on psychodeli, 27 on synth10k.
  They are fetched at full resolution (640 px JPEGs drawn at 48 px), and labels have no thumbnail tier.
- **Everywhere else, images go through DOM column renderers:**
  - The tooltip or pinned card, which shows every column; with `display: "full"` the image renders
    at up to 160 px.
  - The instances view: a table, or a "Card view" grid (`viewer/src/charts/instances/Cards.svelte`),
    in pages of 50 rows. At boot it fetches the images of all 50 rows on the first page, though only
    3–4 are on screen. The smoke run counted 69–78 image requests, which is 50 table rows plus the
    labels.
- **Images cannot be the points.** The point shader draws flat discs (`program.wgsl:131-160`
  `points_vs`/`points_fs`), and no texture or atlas binding exists in `bind_groups.ts`. Showing
  images as points would need a new renderer.

## Part 1 corrections (rows that mention Embedding Atlas or should)

| Table / row | Plan said | Finding |
|---|---|---|
| 1.1 WebGPU | "Embedding Atlas *(per README; fallback path to verify)*" | **Confirmed, and there is no fallback.** WebGPU plus `shader-f16` is required (`webgpu_renderer/utils.ts:4-24`), otherwise an error message (`EmbeddingViewImpl.svelte:305`). It uses WebGPU compute for KDE, blur and downsampling (`renderer.ts:426-525`), not for layout. Add to "Against": it fails in Playwright's headless Chromium and in SwiftShader, so CI needs real Chrome. Add to "For": device-loss recovery (`EmbeddingViewImpl.svelte:323-331`). |
| 1.1 Hybrid GPU overview + DOM detail | "Embedding Atlas *(hypothesis)*" | **Confirmed, with three layers:** WebGPU canvas (points, density), SVG overlay (labels, selection, lasso; `EmbeddingViewImpl.svelte:740-800`), and DOM (tooltip card, instances table, charts). There is no per-item promotion: the card is a floating tooltip anchored to the point, not the point becoming a card. |
| 1.1 per-item promotion | Wunderkammer 3D only | Still only wunderkammer. The nearest EA has is the pinned tooltip card at the point's screen position. |
| 1.2 image delivery | (EA not listed) | Add EA under "one file per item per size", with a single size: labels and table cells fetch whatever the column holds, at full resolution. No sheets, tiers or LOD. The images are not on the GPU at all. |
| 1.3 SQL in the browser | "Embedding Atlas *(hypothesis: verify the stack)*" | **Mosaic yes. DuckDB-WASM only in wasm mode, static export and the hosted file viewer.** The CLI default runs DuckDB in Python behind `POST /data/query` (`server.py:83, 130-206`), and the widget runs SQL in the Jupyter kernel (`widget.py:148-168`). Add to "Against": in server mode the 34 MB WASM still loads unused (`viewer/src/utils/database.ts:19`); every chart is one query per change; hover is a query. |
| 1.3 GPU-side membership mask | Wunderkammer 3D, PixPlot *(hypothesis)* | EA does **not** mask. It re-queries and re-uploads the surviving x/y (`EmbeddingViewMosaic.svelte:98-123`; `renderer.ts:270-288`), so filtered points vanish rather than dim. |
| 1.4 Embedding projection | lists EA | Confirmed. It is EA's only spatial layout. |
| 1.4 Animated transitions | (EA not listed) | Correct to leave it out. EA animates only the viewport (800 ms cubicOut fly-to, `Embedding.svelte:180-233`); points never move. |
| 1.5 npm + widget + CLI | EA | Confirmed and understated. There are also a React wrapper, a Streamlit component, a static `--export-application`, a hosted file viewer with data, settings and state in a compressed URL hash, and an MCP tool server (`model_context.ts:66-338`). |
| 1.5 URL-encoded view state | Wunderkammer | Add EA's hosted file viewer (`viewer/src/utils/query_payload.ts`). The CLI and server viewer do not write state to the URL; state there is export/import JSON. |

## Part 2 column: Embedding Atlas

| Capability | Emb. Atlas |
|---|---|
| Survey: whole collection at once | yes. Fit-to-data default viewport from median and 3σ (`mosaic_client.ts:97-154`); the counter shows "N / M points" |
| Continuous pan/zoom | yes. Drag pans, wheel zooms about the cursor, scale clamped to 1e-2..1e2 of default (`EmbeddingViewImpl.svelte:387-470`) |
| Semantic zoom | partial. Density and contours cross-fade to points with scale in density mode only (`EmbeddingViewImpl.svelte:45-89`); two label levels with scale ranges; never images as points |
| Facets, multi-valued, OR within / AND across | yes. List columns get UNNEST count plots; shift-click ORs values, other charts AND through the Mosaic crossfilter (`CountPlot.svelte:147-170, 239-270, 315-340`) |
| Facet counts that react to scope | yes. Each bar shows `countSelected` over `count` (`CountPlot.svelte:133-135, 372-399`) |
| Numeric range filters | yes. Histogram brush on x (`default_charts.ts:157-185`); also SQL predicates |
| Free-text search | yes. FlexSearch in a worker over the text column, rebuilt for the current predicate (`viewer/src/search/search.ts:16-76`) |
| Semantic / embedding search | partial. Only if the host supplies `searcher.vectorSearch` (`search.ts:186-188`, `api.ts:170-182`); the precomputed kNN list is reachable from the tooltip ("nearest neighbours", `Embedding.svelte:235-310`) |
| Find without changing scope (fly to match) | yes. Clicking a search result highlights it and animates the viewport to it, tooltip shown (`Embedding.svelte:125-130, 180-199`) |
| Group by facet as territory | no. Colour-by only (`Embedding.svelte:95-106`); positions never change |
| Sort within groups; attribute lens/brush | partial. Colour by any column; table sort; no lens |
| Timeline layout | no. A year histogram chart, but no layout of items by time |
| Similarity layout (UMAP/t-SNE) | yes. This is the tool's purpose; it can compute UMAP in Python or WASM |
| Geographic layout | no |
| Piles | no |
| Animated layout transitions | no. Viewport fly-to only |
| Rich detail view | partial. The pinned tooltip card renders every column with markdown, image, link, audio, JSON or Liquid-template renderers (`viewer/src/renderers/renderer_types.ts`); no reading view |
| Reading traversal (next/prev) | partial. Instances table pages of 50 (`Instances.svelte:42`); clicking a point jumps the table to that row's page (observed: page 8 of 9); no next/prev in the card |
| Selection of a subset; export it | yes. Marquee and lasso (shift / shift+meta drag) become a SQL predicate; export to parquet, JSON, JSONL or CSV (`server.py:156-191`); `widget.selection()` |
| Shareable URL of the exact view | partial. Hosted file viewer only, via the compressed hash payload (`query_payload.ts`); otherwise state JSON export/import |
| Keyboard and screen-reader access | no on the map: no `aria-`/`role` in the embedding chart sources; the canvas is not focusable. DOM charts and table are ordinary buttons |
| Live corpus | no. The CLI snapshots the DataFrame at start |
| No-server deployment | yes. `--export-application` writes a static DuckDB-WASM site (`data_source.py:98-105, 137`); hosted file viewer |
| Embeddable component / API | yes. npm (three levels), React, anywidget, Streamlit, MCP |
| Preprocessing pipeline included | yes. Embedding (sentence-transformers, HF transformers, LiteLLM), UMAP, kNN, PageRank, k-core and other graph metrics (`cli.py:493-640`) |
| Documented scale | Docs claim millions of points; the code backs it with a 4M default downsample threshold (`Embedding.svelte:50`). Smoke here: 10k runs with no issue |

## Part 3: use-case scores (0–3)

- **Competitive / market research wall: 1.**
  - It can show a captured set as a map with facet crossfilter, full-text search and a card per
    item, and it exports a selection.
  - It cannot show the *images* as the collection. You see dots plus about 20–30 representative
    thumbnails.
  - It has no grouping by facet, no live corpus (Obsidian edits never arrive), and no capture.
  - Its similarity map only helps when there is a meaningful embedding.
- **LLM-communicated collection: 2.5. Strongest of the peers I know of on packaging; weakest on
  images.**
  - An agent can emit a parquet file plus a JSON `settings`/`state`, and the hosted file viewer opens
    it from one URL.
  - An agent can drive a running instance through MCP: SQL, chart specs, filters, screenshots to
    check its own work.
  - A notebook host gets the selection back through `widget.selection()`, and a JS host through
    `onPredicateChange`.
  - Costs: WebGPU-only, which rules out artifact sandboxes without WebGPU *(inferred)*; a 34 MB
    DuckDB-WASM payload; and a spec vocabulary (Mosaic chart specs) that is large for a first-try
    emission. The `best_practices` MCP tool exists because it is large.

## Technique candidates

| Technique | Source (file:line) | Grade | Wunderkammer file it would change | Metric it should move | perf-budgets.json key |
|---|---|---|---|---|---|
| Dynamic map labelling (Been et al. 2006): precompute each group heading's visible scale interval once, then show or hide by scale with no per-frame collision work. Ties TODO "Place the cluster suggestions" and group headings at scale (strip treemap long tail, 104 genres). | `component/src/lib/dynamic_label_placement/dynamic_label_placement.ts:36-120`; `embedding_view/labels.ts:20-74` | **port** (small MIT algorithm with a citable paper; credit both). Copy is possible with the Apple notice, but it is ~150 lines and better ported to fit `layout.mjs` geometry | `wall/layout.mjs`, `wall/overview-surface.mjs`, `wall/spatial/` | zoom in/out framesMax (no heading relayout per frame) | `flat zoom in`, `flat zoom out`, `spatial zoom in/out` |
| Representative-image labels: per cluster or group, show the highest-centrality member (PageRank on kNN) at its own position as the group's face | `component/src/lib/image_summarizer/image_summarizer.ts:22-76`; `EmbeddingViewMosaic.svelte:395-476`; `backend/embedding_atlas/graph_metrics.py` | idea | `wall/context-clusters.mjs`, `wall/overview-surface.mjs`, `wall/spatial/` (pile faces) | none directly (UX; pile previews) | — |
| Density/contour ↔ points cross-fade keyed to on-screen density, not raw zoom: a threshold where the densest region falls below k items per px², a one-e-fold ramp | `EmbeddingViewImpl.svelte:45-89` | **port** (formula only) | `wall/overview-surface.mjs`, `wall/spatial/` far tier | zoom out framesMax at 10k+; images drawn at far zoom | `flat zoom out`, `spatial zoom in/out` |
| Density-biased downsampling when over budget: keep sparse outliers, thin dense cores | `embedding_view_config.ts:32-42`; `webgpu_renderer/downsample.ts` | idea | `wall/overview-surface.mjs` (Canvas2D sheet draws at 10k–25k) | zoom out max frame; TODO "Scale ceiling" | `flat zoom out` |
| Device-lost recovery: rebuild renderer and context on loss | `EmbeddingViewImpl.svelte:318-331` | idea (WebGL `webglcontextlost`/`restored` is the analogue) | `wall/spatial/` (three.js) | correctness; TODO "Hybrid failure recovery" | — |
| Agent control surface: an MCP tool set over the live view (schema, read-only query, set filter/state, screenshot) | `viewer/src/model_context/model_context.ts:66-338`; `backend/embedding_atlas/server.py:295-325` | idea, high value | new `lib/` module; `wall/view-state.mjs`, `wall/permalink.mjs` | none (LLM direction: first-try success, self-check by screenshot) | — |
| Whole view spec in the URL hash as deflate-raw + base64 JSON, data by URL | `viewer/src/utils/query_payload.ts:7-90`; `app/FileViewer.svelte:36-154` | idea (wunderkammer permalinks already do view state; the new part is *data + settings* in the hash for a server-free build) | `lib/permalinks.mjs`, static demo build | none (LLM / artifact packaging) | — |
| Mosaic + DuckDB crossfilter (one SQL query per chart per change) | `CountPlot.svelte:115-170`; `viewer/src/utils/database.ts:14-30` | **rule out** for wunderkammer's sizes. Our predicate costs 3–16 ms (plan 1.3); our cost is DOM restyle, and this design adds a 34 MB WASM or a server round trip per chart without touching restyle | — | — | — |
| Filter by re-querying and re-uploading surviving points (dropping, not dimming) | `EmbeddingViewMosaic.svelte:98-123`; `renderer.ts:270-288` | **rule out**. It loses place-preserving context (TODO "Place-preserving filters and Gather"); wunderkammer 3D's `setActive` mask is already cheaper | — | — | — |
| Hover picking by a database nearest-point query | `mosaic_client.ts:215-243` | **rule out**. One async round trip per hover; wunderkammer needs synchronous hit-tests | — | — | — |
| Images only as labels and table cells | `EmbeddingViewImpl.svelte:748-768` | **rule out** as a model. Wunderkammer's premise is the images as the field | — | — | — |

## Surprising

- **There is no fallback at all.** In a WebGPU-less browser the main view is a sentence of text,
  and `shader-f16` is required on top of WebGPU, which excludes SwiftShader.
- **Server mode still downloads and boots DuckDB-WASM** (34 MB, `database.ts:19`). The harness does
  not see it, because the worker fetches it.
- **Labels are computed once** at the default viewport over the unfiltered table and cached on disk
  by dataset hash. "Cold" boots after the first are warm for labels.
- **The pin commit is an MCP security fix** (read-only SQL for agents). Apple is building for agents
  driving the tool.
- **The tooltip ignores the image renderer** unless the column style also sets `display: "full"`; by
  default it shows a link (`resolveColumnStyles`, `embedding_atlas_store.ts:563-576`).
- **The build docs pin the wrong `wasm-bindgen` version** (0.2.114 in docs, 0.2.121 in `Cargo.lock`).
- **The harness wheel gesture saturates.** `h.wheelZoom` (20 ticks × 30) hits EA's zoom clamp: 4
  ticks of 40 already zoom about 5× out (observed). Zoom scenarios here measure a gesture that pins
  at the clamp.
- **Hover selects every column.** It includes the full text, and would include image bytes had we
  used them (`Embedding.svelte:284-286`).

## Could not establish

- **Filter latency at 1M rows.** There is no million-row corpus and no timed runs (brief rule);
  Q1's breakdown is from code.
- **Whether the count plots use Mosaic's pre-aggregation or data-cube indexes** in this
  configuration. I did not trace Mosaic's optimiser.
- **Behaviour on Safari or Firefox WebGPU**, which were not run.
- **The one 404 per boot in the harness error list.** It is likely a `/data/cache/<key>` miss for a
  not-yet-cached entry, since the cache GET returns 404 on a miss (`server.py:112-117`), but I did not
  confirm which key.
- **GPU-pressure robustness.** Probe runs are the coordinator's. `gpuGesture` is implemented in the
  driver.
