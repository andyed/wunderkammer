# Peer report: Collection Space Navigator (CSN) and umap-explorer

Peer keys `csn` and `umap-explorer`. Study date 2026-10-13. One report, two columns: CSN is a
React port of umap-explorer (`CSN@96147ee README.md:8`), and most answers are the same code path
seen twice. Citations are `CSN@96147ee path:line` (github.com/Collection-Space-Navigator/CSN, commit
96147ee, 2025-11-11) and `UE@d31e3de path:line` (github.com/GrantCuster/umap-explorer, commit d31e3de,
2020-07-28). umap-explorer line numbers are from the **pinned, unpatched** files. Library citations
name the installed version (`three@0.100.0`, `tween.js@18.6.4` in CSN, `tween.js@17.2.0` in
umap-explorer). Anything without a citation or a measurement is marked *(inferred)*.

Every measurement here is from a headless smoke run or a counting probe, not a timed run. The
coordinator owns timed numbers.

## 1. Pin, licence, build, ports

| | CSN | umap-explorer |
|---|---|---|
| Clone | `<peer-study workspace>/csn`, HEAD `96147ee` | `<peer-study workspace>/umap-explorer`, HEAD `d31e3de` |
| Licence | MIT, `LICENSE` ("Copyright (c) 2022 MAR CANET SOLA AND TILLMANN OHM") | MIT, `LICENSE` ("Copyright (c) 2020 Grant Custer") |
| Notice if we copy | Keep the CSN notice. CSN's `src/Projection.js` is derived from umap-explorer's, for example `CSN@96147ee src/Projection.js:96-188` matches `UE@d31e3de src/Projection.js:109-207`, and CSN's LICENSE does not carry Grant Custer's notice. Copying from that file should carry **both** notices *(inferred: code similarity plus README.md:8)* | Keep the Custer notice |
| Stack | React 17, CRA `react-scripts` 4.0.3, three 0.100, tween.js 18.6.4, d3 5, Material-UI 4, react-pro-sidebar, react-compound-slider, react-filter-box, chart.js (`package.json`) | React 16, CRA `react-scripts` 2.1.3, three 0.100, tween.js 17.2, d3 5 (`package.json`) |
| Node | README: "`node 16.16.0` is required" for development. Used `npx -y -p node@16 -p npm@8` (Node 16.20.2, npm 8.19.4). System Node 26 untouched | Not stated. react-scripts 2.1.3 (webpack 4) needs Node ≤ 16. Same npx recipe |
| Build used | **From source**: `BUILD_PATH=build-src … react-scripts build` (build 0 errors, eslint warnings only). The committed `build/` is from `6ff99b2` (2023-05-20) and predates three src fixes (see Part 4 Q4). The Colab path ships that stale build | `PUBLIC_URL=. … react-scripts build` (`homepage` in package.json would otherwise prefix every URL with `/umap-explorer`) |
| Ports | music **4320**, psychodeli **4321**, synth10k **4322** | music **4325**, psychodeli **4326**, synth10k **4327** |
| Serve | `.local/peer-study/csn/serve.sh` (idempotent, `npx http-server -c 3600`, logs beside it). **Running.** | `.local/peer-study/umap-explorer/serve.sh`. **Running.** |
| Converter | `scripts/peer-perf/convert-csn.py` | `scripts/peer-perf/convert-umap-explorer.py` |
| Driver | `scripts/peer-perf/drivers/csn.mjs` | `scripts/peer-perf/drivers/umap-explorer.mjs` |
| Instances | `<peer-study workspace>/instances/csn/<corpus>/build` | `<peer-study workspace>/instances/umap-explorer/<corpus>` |
| Authored configs | `.local/peer-study/csn/<corpus>/{config.json,datasets_config.json}` | `.local/peer-study/umap-explorer/<corpus>/dataset.js` |

### CSN converter: what maps, what is lost

`convert-csn.py` runs **CSN's own pipeline code**, `CSN_utils.py` (`ImageSpriteGenerator`,
`PCAGenerator`, `HistogramGenerator`, `Utils.normalize/center/write_metadata/write_config`). It passes
the Colab's arguments (`CSN_colab.ipynb` cells 9, 18, 26, 27: 2048 px sheets, 32 rows, 64 px cells, 50
histogram buckets). The instance is what an author following the Colab gets. Only the inputs are ours,
and our shared `projection.json` replaces the UMAP step.

- `projection.json` → `UMAP.json`, through CSN's `Utils.normalize` + `center` (→ ±25 units, `CSN@96147ee CSN_utils.py:13-30`).
- `features.npy` → `PCA.json` through CSN's `PCAGenerator` (StandardScaler + PCA, 2 components, `CSN_utils.py:174-205`). This is the second projection for `layoutSwitch`. In synth10k the 25 copies of an image share a feature row, so they share a PCA point. The UMAP map has jitter.
- `year` → numeric slider (range filter + histogram). `width/height` → second slider `aspect`.
- Each facet → one string column with values joined by ", ". These are search fields and info fields. `contains` works. `==` cannot match one value of a multi-valued facet.
- Two small facets → `clusterList` (music: decade, complexity; psychodeli and synth10k: kaleido, complexity).
- The image → `url_prefix` `datasets/<corpus>/images/` (a symlink to the corpus).
- **Lost:** multi-valued facet semantics, palette, text, source, kind.
- **Pipeline bugs hit:** `HistogramGenerator` crashes on a pandas NA (`CSN_utils.py:288` `if (e == MAX)` → "boolean value of NA is ambiguous"). Music has 249 items with no year, so the converter passes year to that one call as float NaN, which the generator's try/except skips. Items with no year are filtered out as soon as the year slider moves, and they stay out when it returns to full range (`CSN@96147ee src/Sliders/Sliders.js:43-48`: `values[0] > null` is true).

### umap-explorer converter and the code patch (not findings about the tool)

umap-explorer hard-codes MNIST in four places: the sprite geometry (`UE@d31e3de src/Projection.js:8-18`), three embedding files (`src/Data.js:6-11, 37-70`), a digit shader that discards `r < 0.5` and tints the label colour (`src/Projection.js:307-320`, highlight `:372-384`), and 28/2048 literals in `highlightPoint` (`:415-416`). The clone carries this patch (full diff: `.local/peer-study/umap-explorer/umap-explorer-patch.diff`, 4 files, +37/−47):

1. `public/index.html`: loads `%PUBLIC_URL%/dataset.js`, which sets `window.__UMAP_DATASET`.
2. `src/Projection.js`: sprite constants come from that config (MNIST values are the defaults). The two shaders show the photo's own RGB (the point shader discards alpha < 0.5 so the letterbox is invisible). `highlightPoint` uses the constants.
3. `src/Data.js`: embedding names and files come from config. The three MNIST state keys are reused as slots, so `Layout.js` and `Projection.js` props are unchanged.
4. `src/Sidebar.js`: shows a label's name when config provides names.

Interaction, zoom, tween and raycast code are untouched. `convert-umap-explorer.py` writes `dataset.js`, `embedding_umap.json` (projection.json), `embedding_pca.json` (sklearn PCA of features.npy), `labels.json` and `tile_N.png`. The labels are ints 0–9: the top 9 values of one facet (music genre; psychodeli and synth10k kaleido), with 9 = other. The atlases use **the same geometry as CSN** (2048 px RGBA PNG, 32×32 cells of 64 px, row-major in item order), so the two peers compare like for like. **Lost:** everything except one facet, because umap-explorer has no filters, search or metadata panel.

## 2. Pipelines

**CSN**
```
data in   datasets_config.json → config.json, barData.json, metadata.json, one JSON per mapping, tile_N.png   CSN@96147ee src/Data.js:45-59, 61-87, 140-217; src/Projection.js:27-37
index     none: rows addressed by position; one Float32Array(total) per mask (filter, search, combined)        src/Layout.js:19-31, 91-112
layout    precomputed 2-D mappings in ±25 units (Python); client only fits the camera                         CSN_utils.py:13-30, 174-266; src/Projection.js:140-188
render    three r100: one THREE.Points per tile (gl.POINTS sprite, offset attr into the atlas), 2 passes/frame  src/Projection.js:190-373, 677-689
interact  d3-zoom → perspective camera z; raycast hover → preview pane; sliders/query → mask attribute;
          projection select → 1 s CPU tween                                                                    src/Projection.js:125-138, 174-186, 575-650, 434-456, 40-85
```

**umap-explorer**
```
data in   3 embedding JSONs + labels JSON + 14 PNG atlases                                                     UE@d31e3de src/Data.js:37-70; src/Projection.js:15-24
index     none: slice into 14 chunks of 73² by position                                                         src/Projection.js:212-225
layout    precomputed, rescaled client-side to ±20                                                             src/Data.js:23-35
render    three r100: one THREE.Points per atlas, one pass                                                      src/Projection.js:237-336, 527-531
interact  d3-zoom → camera; raycast hover → 56 px highlight sprite + sidebar canvas crop; select → 1 s CPU tween  src/Projection.js:138-154, 193-206, 435-497, 61-107
```

## 3. Part 4 answers

### Q1. How do projections animate: CPU tween or GPU attribute interpolation?

**CPU, per element, and it leaks GPU buffers.** Both tools hand tween.js the geometry's position
`Float32Array` as the object to tween, with a target `Float32Array` of the new positions. They use one
tween per atlas chunk, linear, 1000 ms (`UE@d31e3de src/Projection.js:79-106`; `CSN@96147ee
src/Projection.js:56-84`). tween.js interpolates "properties" with `for (property in _valuesEnd)`. On a
typed array that walks every index as a string key, 3 per point per frame, on the main thread
(`tween.js@18.6.4 dist/tween.esm.js:703-729`; `tween.js@17.2.0 src/Tween.js:354-382`). The `onUpdate`
callback then wraps the same array in a **new** `THREE.BufferAttribute` on every frame
(`UE src/Projection.js:98-104`, `CSN src/Projection.js:76-82`). three keys GL buffers by attribute object
(`three@0.100.0 src/renderers/webgl/WebGLAttributes.js:7, 124-132`), and frees them only on geometry
dispose (`WebGLGeometries.js:21-39`). So each tick creates and uploads a fresh buffer per chunk and
orphans the old one.

**Measured** (headless, synth10k, counting `createBuffer` / `deleteBuffer` / `bufferData` bytes with an init script):

| | boot | after one projection switch | deleteBuffer |
|---|---|---|---|
| umap-explorer | 30 buffers, 0.32 MB | 870 buffers (+840), 10.4 MB uploaded | 0 |
| CSN | 300 buffers, 3.5 MB | 690 (+390), 8.2 MB | 0 |

CSN's 300 at boot come from `init()` calling `changeEmbeddings` once (`CSN src/Projection.js:674`). It
runs a 1 s tween from the positions to the same positions on every page load. umap-explorer's own
changelog describes the method accurately ("updating the position attribute of the points",
`UE src/Content.js:8`) but not the allocation. No GPU interpolation exists in either tool: no
second position attribute, no mix uniform. z stays 0. Point size does not animate.

### Q2. Filter hiding: shader attribute, index buffer rebuild, or opacity?

- **umap-explorer:** no filtering of any kind.
- **CSN: a per-point shader attribute, computed on the CPU, re-uploaded as a new buffer per tile.** There is no index rebuild, and hidden points stay in every draw call.
  1. **Mask.** Each slider move loops over all of `metadata` (`CSN src/Sliders/Sliders.js:35-48`). It then sums every slider's mask element by element with `reduce` (`:50-52`). Search runs react-filter-box's row processor over all rows (`src/QueryFilter.js:46-53`). `Layout.calculateProjection` adds the filter and search masks (`src/Layout.js:91-112`).
  2. **Upload.** `updateProjection` slices the mask per tile and assigns a **new** `BufferAttribute` named `filteredActive` (`src/Projection.js:434-456`). Measured: +10 `createBuffer` per filter change at 10 tiles, never deleted.
  3. **Shader.** A filtered point is mixed to grey `(0.3, 0.3, 0.3, greyTransparency)` (`src/Projection.js:350-353`).
  4. **Two passes per frame.** Pass 1 sets `greyTransparency` 0.1 and `imageTransparency` 1. Unfiltered images become transparent black and filtered ones become faint grey ghosts. Pass 2 sets both to 0: images draw, and filtered points get alpha 0. `animate()` rewrites both uniforms on every tile on every frame, filter or not (`src/Projection.js:458-474, 677-689`). The ghost pass is the "show filtered-out items (slower)" checkbox (`src/ViewPane.js:71-78`). It defaults on below 20,000 items and off above (`src/Layout.js:58-64`).
  5. **Picking.** Hidden points are still raycast. Hover ignores them through a mask check (`src/Projection.js:602-603`).
  6. **React re-render.** The `setState` re-renders the whole Layout. It loops `total` for "showing N / total" (`src/Layout.js:255-260`). Every slider's BarChart recomputes its histogram over all items **inside `render()`** (`src/Sliders/BarChart.js:18-26, 103`). Each hover also sets Layout state (`src/Layout.js:158-162`), so every hovered point re-runs those loops *(inferred from code; the coordinator may want a hover-sweep scenario to measure it)*.
- **Quirks.**
  - `addPoints` declares the attribute as `'filter'` (`src/Projection.js:241`) while the shader reads `filteredActive` (`:304`), so before the first filter the shader's attribute is unbound and reads 0 (visible) *(inferred)*.
  - react-compound-slider `mode={3}` (`src/Sliders/RangeSlider.js:49-50`) keeps handles a step apart. A numeric field with only two values (psychodeli's year, 2025–2026) cannot be filtered at all. Measured: dragging the min handle 60% changed nothing. The driver falls back to the aspect slider there.
  - Float sliders step 0.01 (`RangeSlider.js:51`). Returning the aspect handle to its minimum left 1 psychodeli item (aspect 0.526) filtered.

### Q3. Atlas construction in umap-explorer: size, count, packing

- **Size and count.** 14 PNG atlases of 2048×2048 px ("needs to be power of 2", `UE src/Projection.js:12-13`). Each is a 73×73 grid of 28 px cells, so 73 × 28 = 2044 px are used, leaving a 4 px margin. That holds 5,329 digits per atlas, so 70,000 MNIST digits fill 14 atlases, the last with 724 *(arithmetic)*. On disk: 0.28–2.2 MB each (`public/mnist_tile_solid_*.png`). They were built by `making_mnist_images.ipynb`.
- **Packing.**
  - Row-major by item index. There is no manifest: a per-vertex `offset` = (i mod 73, ⌊i/73⌋) × 28 / 2048 (`:270-278`), and the fragment shader samples `gl_PointCoord * repeat + offset` with `repeat = 1/73` (`:288-292, 313-314`). `1/73` (0.013699) is slightly larger than `28/2048` (0.013672), so each sprite reaches about 0.06 px into its neighbour *(arithmetic)*.
  - Atlas order is data order, so neither a projection switch nor (in CSN) a filter ever re-packs.
  - Cells are square, so non-square images are letterboxed. A point sprite is square and screen-aligned.
- **Size on screen.** Fixed in screen pixels by `zoomScaler`: 14–28 px, never larger (`:26-45`, applied in `:148-153`). Zooming spreads images apart and never enlarges them past 28 CSS px. The renderer never calls `setPixelRatio` (`:511-513`), so at DPR 2 the canvas renders at CSS resolution *(inferred from three r100 defaults)*.
- **Two downloads per atlas.** Each atlas is loaded twice: once as an `<img>` for the sidebar crop (`:20-24`) and once by `TextureLoader` (`:228-235`, which sets crossOrigin). Measured, synth10k: 20 image requests and 91 MB on the wire for 10 atlases that total 60 MB on disk. CSN does the same (`CSN src/Projection.js:32-36` and `:206-216`). Measured, CSN music: 4 requests, 19.3 MB on the wire, for 2 tiles of 12.6 MB.
- **GPU memory.** `magFilter = Nearest`. `minFilter` stays three's default mipmapped filter (`three@0.100.0 src/textures/Texture.js:43, 58`). So about 16 MB per 2048² RGBA atlas plus a third for mips. At 10k items that is about 210 MB of textures for 10 atlases *(inferred)*.
- **CSN generalises this.**
  - The geometry comes from config (`sprite_side`, `sprite_number`, `sprite_image_size`, `sprite_actual_size`; `CSN src/Projection.js:27-37, 255-263`). The Python packer `ImageSpriteGenerator` (`CSN_utils.py:93-151`) defaults to 2048 px with 32 rows, so 64 px cells and 1,024 images per sheet. It letterboxes each image (aspect kept) inside a 4 px border filled with RGBA (1,1,1,1). The cluster shader recolours exactly that near-transparent colour to draw cluster borders (`src/Projection.js:340-345`). The packer can reduce a sheet to the 216-colour web palette (`CSN_utils.py:148-150`).
  - `highlightPoint` still hard-codes `/2048` (`src/Projection.js:555-556`), so a `sprite_actual_size` other than 2048 breaks the hover highlight.
  - Our corpora as CSN tiles: music 2 tiles (7.2 + 5.4 MB), psychodeli 1 (1.8 MB), synth10k 10 (43 MB).
- **For wunderkammer (3D far tier from the 64 px sheet):** neither tool blits into a runtime atlas. **The sheet page is the texture.** A per-instance offset attribute plus one `repeat` uniform address the cell. That is the sub-rect sampling the TODO item asks muriel's `AtlasPair` for. See the ledger.

### Q4. Dataset config and the Colab pipeline as onboarding

**The spec the app reads** (from the code, not the README):

- `datasets/datasets_config.json` = `{default, data: [{name, directory}]}` (`CSN src/Data.js:140-171`).
- Per dataset, `config.json`:
  - `embeddings: [{name, file}]` (`Data.js:61-87`);
  - `sliders: [{id, title, info, typeNumber, color, min, max}]` (`Sliders.js:13-28, 63-85`);
  - `search: [{columnField, type}]` (`QueryFilter.js:39`);
  - `info: [field]` (`Layout.js:383`, `InfoFields.js:23-31`);
  - `clusters: {clusterList, clusterColors}` (`Data.js:177-184`, `ViewPane.js:33-40`);
  - `url_prefix` (`Layout.js:149`);
  - `sprite_side / sprite_number / sprite_dir / sprite_image_size / sprite_actual_size` (`Projection.js:27-37`);
  - `total` (`Layout.js:19, 59`); `datasetInfo` (`Layout.js:292`).
  - `title` is written by the pipeline (`CSN_utils.py:47`) but never read by `src/`.
- `metadata.json` rows must carry `index` (`QueryFilter.js:50`) and `filename`. They may carry `link_URL`, which double-click opens (`Layout.js:168-174`).
- `barData.json` holds each slider's full-collection histogram and the item indices in every bucket (`CSN_utils.py:269-308`). The client draws that histogram behind the in-scope one, which it recomputes on every render (`BarChart.js:99-103, 18-60`). It uses the bucket index lists for a linked brush: hovering a histogram bar shows only that bucket's items on the map, and leaving restores the scope (`BarChart.js:66-89`). The hovered item's own bucket is drawn in pink (`BarChart.js:112-116`).
- Half the spec is build output (sprite geometry, `total`, slider min/max) that an author should not hand-write.

**The Colab** (`CSN_colab.ipynb`, 36 cells):

1. Clone the repo (cell 3).
2. ipywidgets forms for paths and field roles (cells 4–6).
3. Sprites (cell 9).
4. Optional ResNet/Xception/VGG features through TensorFlow (cells 11–12, `feature_extraction.py`).
5. Mappings: PCA, UMAP, t-SNE, or "2D plots" of two metadata fields (cells 16–21).
6. Slider and cluster colours (cells 24–25).
7. Write `metadata.json`, histograms and config (cells 26–27).
8. Zip download, or a Flask / ngrok preview (cells 30–32).

**The Colab never builds JavaScript.** It drops data into the committed prebuilt `build/`, and the README says the same: "Place your prepared dataset folders in the `build/datasets` directory". Node 16 is only for rebuilding. That build is from 2023-05-20 (`6ff99b2`). These `src/` changes since then are not in what Colab users get:

- the `contains` null guard (`b189a12`), whose absence throws on an empty string field;
- the hover-on-index-0 fix (`e5bd6f3`);
- the preview sprite size, 84 → 120.

**Onboarding cost here:**

- Running `CSN_utils` headless needed pandas, tqdm, pillow and scikit-learn (through `uv run --with …`). It hit the NA crash above.
- A two-valued numeric field gives a dead slider.
- Every config change means re-running Python. Any change to collection membership or order rebuilds the sheets, because cell = row index.

## 4. Part 1 corrections

- **1.1 WebGL via a scene library.** Confirm umap-explorer is three.js. **Add CSN** (three 0.100). Both draw **`THREE.Points` (gl.POINTS sprites)**, not instanced quads. That is a distinct sub-option: square, screen-aligned, size in pixels, capped by the GPU's point-size range *(inferred)*. Neither handles WebGL context loss (no `webglcontextlost` anywhere in `src/`), disposes anything, or sets a pixel ratio.
- **1.1 Hybrid GPU overview + DOM detail.**
  - **Add CSN:** hovering shows the atlas crop, then the full original file as a DOM `<img>` after a 100 ms debounce, plus info fields (`CSN src/PreviewPane.js:19-28`, `Layout.js:146-155`). There is no click-to-open and no close: the last hover persists (`Layout.js:158-162`).
  - umap-explorer's detail is a 2D-canvas crop of the atlas plus label and index (`UE src/Projection.js:466-479`).
  - Neither promotes per item.
- **1.2 Fixed sprite sheets per tier.** **Add CSN and umap-explorer (one tier only).** Neither has LOD. The 64 px cell (28 px in MNIST) is the only GPU image at every zoom. CSN's "size (in)" slider goes up to 120 px points, so at DPR 2 a 64 px cell is upsampled about 4× *(inferred)*. The only high-res path is the hover preview file.
- **1.3 GPU-side membership mask.** **Add CSN.** The mask is a GPU attribute, but the predicate is a plain JS loop over everything (Q2). Counts and histograms are CPU loops over all items on every Layout render. So CSN pays the "plain JS predicate" re-scan cost *and* a React re-render, while avoiding a geometry rebuild.
- **1.4 Embedding projection.** Confirm CSN. **Add umap-explorer.** CSN also has "2D plots" of any two numeric metadata fields (`CSN_utils.py:154-172`), so an axis layout such as year × x is possible. It is a scatter, not a histogram stack.
- **1.4 Animated transitions.** Confirm CSN. **Add umap-explorer.** Both use a 1 s linear CPU tween of every coordinate that allocates a GL buffer per frame (Q1). This is the "per-item tween cost at scale" the row warns about, measured.
- **1.5 Static site + data files.** Confirm CSN (prebuilt `build/` + `datasets/`, served by any static server, or `run_local.py` Flask). Add umap-explorer, which is static too.
- **1.5 Notebook build step.** Confirm CSN, with a correction: the notebook builds **data only**. The "Version pinning (CSN requires Node 16)" cost does not fall on notebook users. The real cost is the reverse: they get a stale 2023 JS build.
- **1.5 URL-encoded view state.** CSN is **partial**: `?dataset=…&projection=…` only (`CSN src/Data.js:45-50, 107-112`; `Layout.js:119`). Camera, filters and hover are not encoded. umap-explorer has `#about` only (`UE src/Layout.js:62-87`).

## 5. Part 2 column

| Capability | CSN | umap-explorer |
|---|---|---|
| Survey: whole collection at once | yes: every item drawn at boot, camera fits the extent (`CSN src/Projection.js:140-188`) | yes (`UE src/Projection.js:156-207`) |
| Continuous pan/zoom | yes: d3-zoom drag and wheel drive a perspective camera (`Projection.js:125-138, 174-186`) | yes (`:138-154, 193-206`) |
| Semantic zoom | no: only point size follows zoom (`Projection.js:87-94`), user-set in/out sizes (`ViewPane.js:42-69`); same 64 px cell at all scales | no: size capped 14–28 px (`:26-45`) |
| Facets, multi-valued, OR within / AND across | partial: no facet UI. The query box has AND/OR expressions over flat string fields (`react-filter-box@3.4.3 lib/src/Expression.d.ts:2`; operators `==`, `!=`, `contains`, `!contains`, `QueryFilter.js:16-27`). Multi-valued becomes a joined string | no |
| Facet counts that react to scope | partial: numeric histograms recomputed over the in-scope set (`BarChart.js:18-26`) and "showing N / total" (`Layout.js:255-260, 406`); no categorical counts | no |
| Numeric range filters | yes: range slider + histogram + typed min/max per configured field (`RangeSlider.js:29-190`, `Sliders.js:35-53`). Caveats: nulls, two-valued fields (Q2) | no |
| Free-text search | partial: query language, needs **apply** (`QueryFilter.js:46-53, 111-114`). Measured: `title contains "the"` → 654 / 1,793 shown on music | no |
| Semantic / embedding search | no | no |
| Find without changing scope (fly to match) | no | no |
| Group by facet as territory | no: "clusters" recolours each sprite's border by a categorical field (`Projection.js:476-540, 340-345`); position stays the projection | no (MNIST label tint only, dropped by our patch) |
| Sort within groups; attribute lens/brush | partial: cluster colouring is a categorical lens; hovering a histogram bar brushes that bucket's items on the map (`BarChart.js:66-89`); no sort | no |
| Timeline layout | partial: a "2D plot" mapping of two numeric fields (`CSN_utils.py:154-172`) | no |
| Similarity layout (UMAP/t-SNE) | yes: any number of mappings, PCA/UMAP/t-SNE generators (`CSN_utils.py:174-266`) | yes (3 MNIST maps; ours: UMAP + PCA) |
| Geographic layout | no | no |
| Piles | no | no |
| Animated layout transitions | yes: 1 s linear CPU tween (`Projection.js:40-85`) | yes (`:61-107`) |
| Rich detail view | partial: original image after 100 ms + info fields with link detection (`PreviewPane.js:19-28`, `InfoFields.js:23-31`); double-click opens `link_URL` in a new tab (`Layout.js:168-174, Projection.js:647-649`) | partial: atlas crop + label + index (`Sidebar.js:65-99`) |
| Reading traversal (next/prev) | no | no |
| Selection of a subset; export it | partial: no manual selection; exports the **filtered** metadata as CSV and the canvas as PNG (`Export.js:16-50`) | no |
| Shareable URL of the exact view | partial: dataset + projection only (`Data.js:45-50, 107-112`) | no |
| Keyboard and screen-reader access | no: canvas items are not reachable; only the slider handles carry `role="slider"` with aria values (`Sliders/components.js:79-82`) | no |
| Live corpus | no: static JSON + sheets; cell = row index, so edits rebuild sheets | no |
| No-server deployment | yes: static build + `datasets/` | yes |
| Embeddable component / API | no: a CRA app with no exports, no globals, no events out (the drivers had to walk React fibers) | no |
| Preprocessing pipeline included | yes: `CSN_utils.py`, `feature_extraction.py`, Colab + Jupyter notebooks | partial: two MNIST-specific notebooks |
| Documented scale | Not documented. The code switches defaults at 20,000 items (`Layout.js:58-64`) *(inferred: designed past 20k)*. Measured here: 10,000 boots with all 10 tiles on the GPU 399 ms after ready (headless) | 70,000 (MNIST demo, 14 atlases). Measured: 10,000 boots, 10 atlases on the GPU 485 ms after ready (headless) |

Headless smoke numbers (one run each, `--scenarios idle,pan`, `.local/peer-study/perf/2026-10-14T04-3*-{csn,umap-explorer}-*.json`):

| | ready | images (driver) | image requests / wire | DOM nodes | heap |
|---|---|---|---|---|---|
| CSN music / psychodeli / synth10k | 443 / 462 / 491 ms | 148 / 108 / 399 ms | 4 / 2 / 20 · 19.3 / 1.8 / 43.9 MB | 735 / 739 / 757 | 14 / 14 / 12 MB |
| umap-explorer music / psychodeli / synth10k | 350 / 332 / 364 ms | 147 / 27 / 485 ms | 4 / 2 / 20 · 30.8 / 2.5 / 91.5 MB | 91 / 89 / 107 | 6 / 6 / 5 MB |

umap-explorer's atlases are larger than CSN's for the same geometry. Ours are plain Pillow PNGs with a transparent letterbox; CSN's packer writes an `optimize=True` PNG with near-opaque borders. This is a converter choice, not a tool property.

## 6. Part 3: the two under-served use cases (0–5)

| Use case | CSN | umap-explorer |
|---|---|---|
| **Competitive / market research wall** | **1.** It has range filters, a query box and filtered-CSV export. But there is no capture, no live corpus, and no multi-valued facets; images are 64 px point sprites with no LOD (unreadable screenshots of UIs or text); detail is hover-only with no reading view; and every change to the collection means re-running Python and rebuilding the sheets | **0.** A renderer demo |
| **LLM-communicated collection** | **2.** `config.json` is close to a declarative spec an LLM could emit: fields to filter, search, show and colour by. But it is mixed with build outputs (sprite geometry, totals, slider ranges); it needs a Python preprocessing run for sheets and projections; there is no embed API and no selection callback (the only flow-back is a CSV download); and the static app is not artifact-sized (528 KB gzipped vendor JS) | **1.** Small enough to vendor, but every dataset change is a code edit |

## 7. Technique candidates

| Technique | Source (file:line) | Grade | Wunderkammer file it would change | Metric it should move | perf-budgets.json key |
|---|---|---|---|---|---|
| **Sample the baked sheet page directly as the far-tier texture**: per-instance cell offset + one `repeat` uniform, cell address = index arithmetic, no runtime blit. Serves TODO "3D far tier from the 64 px sheet" (1,793 requests → 2–3 pages) | `UE@d31e3de src/Projection.js:270-278, 288-292, 313-314`; `CSN@96147ee src/Projection.js:255-263, 335-336` | **port** (a few lines; MIT, credit only) | `wall/spatial/lib/instanced.js` (far-tier UV attribute), `wall/spatial/spatial-view.mjs`, `wall/overview-sheets.mjs` (expose page + cell index) | 3D far-tier image requests and decodes; spatial open INP and longest task | `spatial open` |
| **Ghost pass for excluded items**: filtered items drawn as faint grey shapes behind the in-scope ones, a user toggle, default by collection size. Serves TODO "Place-preserving filters and Gather" (dimmed excluded context). Take the look, not the method: CSN draws the whole scene twice per frame and rewrites uniforms every frame. In wunderkammer it is one `aOpacity`/tint value per instance in the existing attribute | `CSN src/Projection.js:350-353, 458-474, 677-689`; default `src/Layout.js:58-64`; toggle `src/ViewPane.js:71-78` | **idea** | `wall/spatial/lib/instanced.js` (`_writeOpacity` → ghost value); flat wall via `wall/wall.css` scope classes | scope change with context kept; spatial filter on/off INP | `spatial filter on`, `spatial filter off` |
| **Range slider with an in-scope histogram** for numeric attributes (year, size, aspect). Fills Part 2 "Numeric range filters: no". Compute histogram buckets once per scope change, not in `render()` | `CSN src/Sliders/RangeSlider.js:29-190`, `src/Sliders/BarChart.js:18-60` (and the anti-pattern at `:103`) | **idea** | `wall/wall.mjs` rail, `wall/attributes.mjs` | flat filter on/off INP while dragging | `flat filter on`, `flat filter off` |
| **Histogram bar brushing**: hovering a bar of a numeric histogram temporarily scopes the map to that bucket's items (precomputed bucket→index lists), and the hovered item's own bucket is marked. A cheap, reversible "what lives here" probe that does not commit a filter | `CSN src/Sliders/BarChart.js:66-89, 112-116`; buckets `CSN_utils.py:276-297` | **idea** | `wall/attribute-brush.mjs`, `wall/attributes.mjs` | brush hover INP (must stay a cheap preview, not a scope change) | `flat filter on` |
| **Export the current scope** (filtered metadata CSV + canvas PNG): the simplest "selection flows back" for the LLM direction and for research walls | `CSN src/Export.js:16-50` | **idea** | `wall/wall.mjs` (scope → JSON/CSV), `lib/view-state.mjs` | (feature; no perf metric) | none |
| **Debounced full-resolution detail on hover**: the atlas crop shows at once, the original file only after 100 ms of rest, so sweeping across items never loads full files | `CSN src/PreviewPane.js:19-28`, `src/Layout.js:146-155` | **idea** | `wall/detail-pane.mjs` (detail walk preloads) | detail walk INP and longest task | `detail walk` |
| **Prebuilt static app + data-folder convention** (`datasets_config.json` lists datasets; authors never build JS). A packaging shape for "repeatable local preview" and the muriel-vendored embed. Pin the build to source in CI: CSN's shipped build is 2.5 years stale | `CSN README.md` "Using the Collection Space Navigator"; `src/Data.js:140-171` | **idea** | `scripts/` static demo build, `lib/instance-config.mjs` | (release readiness) | none |
| CPU tween of a typed array through tween.js, with a new `BufferAttribute` per frame | `UE src/Projection.js:95-105`; `CSN src/Projection.js:73-83` | **rule out**. Measured: +840 GL buffers and 10.4 MB uploaded per switch at 10k, none freed. Wunderkammer's `instanced.js` `tick()` already eases in place and re-uploads one matrix buffer (`wall/spatial/lib/instanced.js:504-536`). The real alternative (two position attributes + a GPU `mix` uniform) comes from neither peer | — | — | `flat group →` |
| Filter by replacing the attribute object (`new BufferAttribute`) per change | `CSN src/Projection.js:446-453` | **rule out**. Wunderkammer's `setActive` writes in place with `needsUpdate` (`wall/spatial/lib/instanced.js:560-574`), which is already better | — | — | — |
| `gl.POINTS` sprites for images | `UE src/Projection.js:294-330`; `CSN src/Projection.js:299-366` | **rule out**: square only (letterboxed covers and screenshots), screen-space pixel size (no world scale, capped point size), no rotation for piles, CPU raycast over every point per mousemove (`CSN :590-595`). Wunderkammer's instanced quads already exceed it | — | — | — |
| Two downloads per atlas (`<img>` for the 2D crop + `TextureLoader` with crossOrigin) | `UE src/Projection.js:20-24, 228-235`; `CSN src/Projection.js:32-36, 206-216` | **rule out**. Measured: 20 requests / 91 MB for 60 MB of atlases. Lesson for wunderkammer: one decode of a sheet should serve both the GPU and any 2D crop (`createImageBitmap` once) | `wall/overview-sheets.mjs` *(check it does not double-fetch)* | boot image wire KB | `boot` |
| **Add GL buffer and texture create/delete counters to the harness**: the init-script probe that exposed Q1's leak (`createBuffer` / `deleteBuffer` / `bufferData` bytes). Cheap, tool-agnostic, and relevant to the GPU-pressure blink | method in this report, Q1 | **rule** (harness practice) | `scripts/perf.mjs`, `scripts/peer-perf/peer-perf.mjs` | GPU objects leaked per gesture (new counter) | `session retained` |

## 8. Surprises, and what could not be established

- **Surprises.**
  - Both tools leak a GL buffer per tile per animation frame during a projection switch, and CSN does it once at every boot (Q1, measured).
  - The Colab ships a 2023 build that misses later fixes (Q4).
  - CSN's year slider cannot filter a field with only two distinct values (Q2, measured).
  - Items with a null numeric value drop out on the first slider move and never come back.
  - `config.title` is written and never read.
- **Not established.**
  - **Hover cost at 10k in CSN.** Every hit re-renders the Layout and recomputes all histograms in render; that cost is *(inferred)*, not timed. Suggest the coordinator add a "hover sweep" gesture (40 mouse moves across a dense area) for CSN, umap-explorer and wunderkammer's 3D view.
  - **The GPU-pressure behaviour** with about 210 MB of mipmapped atlases at 10k (gpu-probe not run, per the brief).
  - **Frame numbers.** The synth10k headless pan p95 (CSN 26 ms, umap-explorer 23 ms) is SwiftShader and says nothing about real GPUs.
  - **The GPU's maximum point size.** CSN's "size (in)" slider allows 120 px points, which at DPR 1 canvases may be clipped by `ALIASED_POINT_SIZE_RANGE`; not tested.
  - **Whether the unbound `filteredActive` before the first filter** behaves identically across drivers *(inferred safe: WebGL's default vertex attribute value is 0)*.
- **Driver notes.** CSN `detailClose` is recorded absent: there is no close, by design. umap-explorer has no filterOn, filterOff or search. Both drivers implement `gpuGesture` (wheel zoom in/out twice, no jump). Both `imagesShown` definitions use `renderer.info.memory.textures` against the tile count (three r100 `WebGLTextures.js:252-275, 511`). The CSN spinner hides one tile early (`CSN src/Projection.js:723-724`, `tileProgress < allTiles-1`), so it is not used.
