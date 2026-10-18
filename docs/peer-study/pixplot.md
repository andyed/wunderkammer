# PixPlot — peer study report

Peer key `pixplot` · study date 2026-10-13 · author: peer agent (read-only on wunderkammer code).

**Citation shorthand.** Every citation is at `pix-plot@3afce47`:
`T:n` = `pixplot/web/assets/js/tsne.js:n` (the whole viewer, 4,214 lines; despite the name it has no t-SNE code),
`H:n` = `pixplot/web/index.html:n`, `P:n` = `pixplot/pixplot.py:n` (the whole pipeline, 1,382 lines),
`CSS:n` = `pixplot/web/assets/css/style.css:n`, `TB:n` = `pixplot/web/assets/vendor/src/trackball-controls.js:n`.
"Measured" means a headless Chromium (SwiftShader) probe in this session; those numbers are functional
evidence, not timed perf results (the coordinator runs those).

## 1. Pin, licence, recipe, converter, ports

| | |
|---|---|
| Repo | https://github.com/pleonard212/pix-plot (fork of YaleDHLab/pix-plot) |
| Clone | `<peer-study workspace>/pixplot`, `git rev-parse --short HEAD` = `3afce47` (2026-03-18, "Merge pull request #286 from duhaime/canvas-security") |
| Licence | MIT, `LICENSE` (Copyright 2020 Yale University). `setup.py` also says `license='MIT'`. |
| Notice obligation | Copying code requires keeping the Yale copyright line and the MIT permission notice. Vendored files carry their own licences (three.js r121 `vendor/dist/three.min.js` MIT; TrackballControls is three.js example code, MIT, **modified** in-repo for zoom-to-cursor TB:211-225; GSAP `gsap.min.js` is under GreenSock's own standard licence, not MIT: do not copy it). |
| Viewer stack | three.js r121 (`three.min.js` header), RawShaderMaterial + InstancedBufferGeometry, lodash templates, GSAP TweenMax/TweenLite, noUiSlider, JSZip, PapaParse, d3 (geographic only). No bundler, no modules: 18 globals created at T:4197-4214. |

**Path taken: the tool's own pipeline, with two substitutions.** The pinned pipeline installs and runs on this
Mac: `uv venv --python 3.10` + `uv pip install -e <clone>` (setup.py pins TF 2.13, numpy 1.24, umap-learn 0.5.1,
scipy 1.15.3, …), then two fixes: scipy 1.15.3's wheel is rejected by dyld on Darwin 27 (`_spropack…so:
section '__DATA/__thread_bss' has a zero-fill section type, but offset field is not zero`) so scipy 1.14.1 is
substituted; and `setuptools<70` restores `pkg_resources` (P:11, umap/numba). With that, the **unmodified**
`pixplot --images … --metadata …` CLI ran end to end on psychodeli (406 images: InceptionV3 on CPU + UMAP +
KMeans) in 45 s wall (measured; scratch output, not served). The served instances are produced by
`scripts/peer-perf/convert-pixplot.py`, which imports `pixplot.pixplot` and calls its stage functions in
`process_images` order (P:153-165) — so atlases, LOD thumbs, cell sizes, metadata files, alphabetic / rasterfairy /
categorical / date layouts, pointgrid jitter, hotspots and the manifest are produced by PixPlot's own code —
except: (1) `features.npy` replaces InceptionV3 vectors (P:571-591) as the hotspot clustering input; (2)
`projection.json` replaces UMAP (P:594-645) as the "umap" layout, so PixPlot shows the study's shared map.
Hotspots use KMeans(12) because hdbscan is not installed (P:88-94).

**Recipe.** `.local/peer-study/pixplot/serve.sh` restarts the three static servers
(idempotent, kills its own ports first; `npx -y http-server <dir> -p <port> -a 127.0.0.1 -c 3600 --silent`, logs
beside it). `serve.sh --build` additionally creates the venv (`<peer-study workspace>/instances/pixplot/_pipeline/.venv`,
1.5 GB) and regenerates all three instances (~30 s, ~30 s, ~60 s). Instances: `<peer-study workspace>/instances/pixplot/{music,psychodeli,synth10k}/`
(104 MB / 51 MB / 1.1 GB — the pipeline writes a 600 px-tall "original" per image, P:1281-1298, upscaling 640×360
sources to 1066×600, and symlinked synth copies become real files). Authored inputs (metadata.csv,
convert-args.json) are copied to `wunderkammer/.local/peer-study/pixplot/<corpus>/`.

**Ports.** 4330 music · 4331 psychodeli · 4332 synth10k. All three run, including 10k.

**Converter mapping** (full detail in the script header). metadata.csv columns: `filename`←`<id>.jpg`;
`category`←one single-valued facet (music `decade`, psychodeli/synth10k `kaleido`), drives the categorical layout
(P:983-1037); `tags`←pipe-joined values of `genre,color,complexity` (music) or `color,complexity,year`
(others), which become PixPlot's single filter list; `description`←title + text with `%` escaped (the lightbox runs
`decodeURIComponent` over it, H:524, and a bare `%` throws); `year`←year (date layout, date slider).
**Lost:** titles (lightbox shows the filename, H:523), palettes, all other facets, facet *names* (tags are one
flat list, so a colour and a complexity value sit side by side), multi-valued category, source/kind. Tag values
have `/` replaced by `-` because `write_metadata` uses the tag as a file name (P:370) and the viewer rewrites `/`
to `-` when fetching it (T:3081). The Google Analytics snippet (H:639-646) is stripped from the copied
index.html so runs make no third-party request; nothing else in `web/` is changed.

## 2. Pipeline

```
data in   images glob + metadata CSV (filename,category,tags,description,permalink,year,label,lat,lng)   P:198-263, P:327-347, P:1352-1379
index     InceptionV3 avg_pool vectors → PCA(100); metadata → per-file JSON, per-tag option lists, dates.json   P:571-591, P:597, P:350-392
layout    UMAP (single or AlignedUMAP grid of n_neighbors×min_dist) + pointgrid jitter; rasterfairy grid;
          filename grid; categorical boxes; year bars; lat/lng; custom x,y — all written as JSON in [-1,1]     P:552-568, P:594-861, P:869-933, P:983-1132
          atlases: cell_size-tall rows packed into atlas_size² JPEGs; LOD thumbs (longest side 128);
          600-px originals; hotspots = HDBSCAN/KMeans on the HIGH-DIM vectors                              P:488-539, P:1281-1298, P:1203-1237
render    loader fetches every atlas, draws 16 atlases into each 8192² 2D canvas → THREE.Texture;
          one InstancedBufferGeometry quad per image, RawShaderMaterial picks the texture via a
          generated if-chain; LOD 128-px thumbs blitted into one 8192² texture near the camera            T:249-322, T:1112-1245, T:1463-1495, H:15-279, T:2696-2937
interaction  TrackballControls pan/zoom-to-cursor; GPU colour-ID picking on click; fly-to then lightbox;
          single-select tag filter + year slider dim cells via an opacity attribute; layout icons tween
          two position attributes on the GPU; lasso select → export / save as hotspot                   T:927-945, T:2242-2341, T:2594-2633, T:2943-3094, T:686-835, T:1754-2110
```

## 3. Part 4 answers (PixPlot questions, numbered as in the plan)

### Q1. LOD: which cells get high-res textures — by distance or by projected size?

**By distance in a quantised grid around the camera's x,y, gated by camera height. Not projected size, not the
view frustum.**

- Two image tiers on the canvas: the atlas cell (`cell_size`, default 32 px tall, P:130, P:508) and the LOD
  cell (longest side `lod_cell_height`, default 128, P:131, P:1297). A third, the 600-px original, is DOM-only
  in the lightbox (T:2603, T:2624-2632).
- All cells are bucketed into a uniform grid over the layout's bounding box with
  `max(100, ceil(n/100))` buckets per axis (T:2742-2772); 100×100 for all three corpora.
- Every frame (T:1624 → T:2779-2786): if the camera is not flying or transitioning, compute the camera's grid
  bucket from `camera.position.x/y` (T:2788-2803). When the bucket changes, cells outside the radius are unloaded
  and the bucket's own cells are queued. When the queue is empty, the neighbourhood
  `x ∈ [−1.5r, 1.5r], y ∈ [−r, r]` buckets is queued and the radius grows by one, up to 30 (T:2833-2847).
  The radius shrinks to `ceil(0.6r)` on each bucket change (T:2793-2795).
- Admission to the LOD texture happens only while `camera.position.z < lod.minZ = 0.8` (T:2702, T:2783-2785),
  and only for cells still `inRadius` (T:2863, T:2893-2898). The z threshold is the only "zoom" term; there is
  no screen-size computation anywhere in the LOD code.
- **One thumb request per frame** (`fetchNextImage` takes one index per call, T:2807-2831).
- Measured (music, headless, deep wheel zoom to z ≈ 0.1): LOD cells activated 0 at z 0.94, 44 at z 0.44,
  151 at z 0.10, then still climbing with the camera at rest — 405 after 8 s, 561 after a further zoom-out,
  while the viewport shows roughly 50 covers (screenshot). Most LOD slots go to off-screen cells around the
  camera, the same failure wunderkammer measured in its 3D near tier (51 of 256 slots on visible faces, TODO.md:14).
- At the overview (z ≥ 0.8) `lod.clear()` runs **every frame** (T:2785, T:2932-2937): it resets `camPos` to
  infinity, so the next frame re-enters the "new bucket" branch, re-queues neighbours and flags the `offset` and
  `textureIndex` instanced attributes for re-upload on every frame. Thumbs are prefetched even at the overview
  (measured: 10–14 thumbs cached at z = 2 with zero activated). *(The per-frame attribute re-upload is read from
  the code; not separately timed.)*
- Unloading: slots return to `openCoords` when their grid bucket leaves the radius (T:2905-2929); the whole LOD
  is cleared on a layout switch (T:721). The decoded `Image` objects are cached forever in `lod.cellIdxToImage`
  (T:2700, T:2825) — measured `cached` always equals activated + prefetched; nothing evicts them.
- Upload path: each thumb is drawn into a 128² 2D canvas, wrapped in a fresh `THREE.Texture`, and copied with
  `renderer.copyTextureToTexture` (T:2878-2881). In three r121 that is a `texSubImage2D` from the source
  canvas into the LOD texture, so no per-thumb GL texture is created (measured: `renderer.info.memory.textures`
  stays at 3 through 443 activations). I had suspected a texture leak; it is not one.
- The README's description ("higher detail images are requested for the images that are proximate to the
  user's camera position", T:16-19) matches the code.

### Q2. Texture budget, and what `cell_size` does to GPU RAM

**The GPU texture budget is fixed by the device, not by the collection.** On desktop PixPlot allocates two
8192² RGBA textures before showing a single image, whatever `cell_size` is.

- `webgl.limits.textureSize = min(MAX_TEXTURE_SIZE, 8192)` (T:3508). Desktop: `config.size.texture` = that
  (8192); touch devices: 2048 (T:53-62). The LOD texture is `min(8192, MAX_TEXTURE_SIZE)` on desktop, 2048 on
  touch (T:56, T:62).
- Each "texture" is a 2D canvas of `config.size.texture`² (T:261-268) into which `atlasesPerTex =
  (texture/atlas)² = 16` atlases are drawn (T:81, T:299-312), uploaded without mipmaps (T:1309-1319). The LOD
  canvas is `lodTexture`² (T:2698, T:2721-2728). Measured on all three corpora: one texture canvas
  `8192×8192`, LOD canvas `8192`, 3 GL textures, 2 draw calls; picker render target `2910×1940`.
- So on desktop: **256 MiB for the atlas texture + 256 MiB for the LOD texture = 512 MiB of RGBA texture
  for 406 images**, the same for 10,000, plus the picker render target (~22 MB at 1440×900@2x) and the 2D
  canvases backing both (Chrome may GPU-back large 2D canvases too *(inferred, not measured)*).
- `cell_size` sets cells per atlas: rows of `cell_size` px height, width by aspect (P:506-534). Note the row-wrap
  test `y + 2*cell_size <= atlas_size` (P:513) leaves the last row empty: 63 rows at 32 px. Measured atlas
  counts at 32 px: music 1 (square covers, 64×63 = 4,032/atlas), psychodeli 1, synth10k 5 (16:9, ~36×63 =
  2,268/atlas).
- GPU RAM therefore moves in **256 MiB steps of `ceil(atlases / 16)`**: at `cell_size` 32 one 8192² texture
  holds ~64k square or ~36k 16:9 images. Below that, `cell_size` changes nothing on desktop; halving it to 16
  quadruples capacity per step. It never affects the LOD texture. The README ("smaller values require fewer
  textures… decreases the GPU RAM", README "Creating Massive Plots") is right in direction but omits that it is
  stepwise, that a minimum of 512 MiB is always allocated, and that LOD is untouched.
- On touch devices (2048 textures) every atlas is its own texture, so `cell_size` matters per atlas. All cells
  live in one mesh unless `n` exceeds the index limit (T:443-450, T:3498-3502), and that one material declares
  `sampler2D textures[N_TEXTURES]` for every texture (T:1477-1483) — past `MAX_TEXTURE_IMAGE_UNITS` (16 on many
  phones) the shader would not compile *(inferred)*. `textureIndex` is an `Int8Array` (T:1262), capping
  textures at 127 *(inferred)*; LOD `width/height` are `Uint8Array` (T:1256-1257), so `lod_cell_height` > 255
  would wrap *(inferred)*.
- Context loss is handled by `window.location.reload()` (T:1064-1069). Under the plan's GPU-pressure probe this
  predicts a reload loop rather than a blink: a 512 MiB floor cannot fit in the 96 or 192 MB caps. The
  coordinator's `gpu-probe.mjs` run should confirm.

### Q3. Picking: GPU colour picking or raycast?

**GPU colour-ID picking, on click only.**

- Each instance gets `color = setHex(idx + 1)` (T:1170-1180). `Picker.init` clones every cell mesh with a
  `useColor` material whose fragment shader writes `vColor` (T:2309-2321; H:190-193; texture lookups stripped,
  T:1469-1472).
- On mouseup, `select()` renders the whole picker scene into a full-canvas render target, then reads one pixel
  with `readRenderTargetPixels` and decodes `(r<<16 | g<<8 | b) − 1` (T:2324-2341). The off-screen render covers
  the full canvas, not a 1-pixel scissor. Chrome logs "GPU stall due to ReadPixels" on every pick (measured).
- There is no hover picking: nothing shows on hover. Lasso selection is CPU point-in-polygon over every cell
  (T:2058-2068), on mousemove (T:1812-1817).
- At the scatter point size a cell is 2–3 CSS px, so a click must land on the exact integer pixel (measured: an
  off-by-one at 726,392 vs 726.5,392.9 misses). A far click flies the camera to the cell (2 s); only a click with
  the camera below `pickerMaxZ` 0.4 opens the lightbox (T:80, T:2289-2293). The driver's `detailOpen` therefore
  clicks twice.

### Q4. Hotspots / cluster labels and layout switching

**Hotspots** are clusters, not labels on the map.
- Computed once in the pipeline on the high-dimensional vectors (`use_high_dimensional_vectors=True`), by
  HDBSCAN if installed, else KMeans (P:1203-1252). Clusters holding >50% of images are dropped, the rest sorted
  by size, named "Cluster 1…N", truncated to `max_clusters` = 10 (P:1219-1234). The representative image is
  whichever member came **last** (`d[i]['img']` is overwritten on every member, P:1217).
- Shown as a DOM sidebar (lodash template H:465-486): thumbnail, a size bar (% of collection, T:3260), label.
  Click the thumbnail: fly to the representative (T:3262-3264, via `flyToCellImage`, which fails for index 0
  because of `if (!idx)`, T:1590). Hover: rewrite the whole `clusterSelected` attribute (T:3384-3396) so members
  draw a white border plus a 30% white wash (H:262-274). The `this.mesh` convex hull the hover handlers remove
  is never built (T:3249, T:3275; no assignment). `Hotspots.showHide` (disable outside UMAP, T:3345-3349) is
  never called.
- Curation on localhost only (`config.isLocalhost`, T:82-85): rename (contenteditable), drag to reorder, delete,
  re-pick the representative at random, create a hotspot from a lasso selection, and download
  `user_hotspots.json`, which the viewer prefers over the defaults on next load (T:3161-3167, T:3175-3245,
  T:3290-3304). Curated clusters persist as a file the author commits. (This is the only authoring loop.)
- No text labels are placed in the map for clusters. Text is drawn in-scene only as point sprites from a
  monospace glyph atlas (T:2453-2492, H:320-357), and the text mesh is created only when a **date** layout exists
  (T:2434). `setText` then loads the labels for any layout that has them (T:802-811), so categorical group names
  depend on the date layout existing. In our music build (which has both) no categorical labels were visible at
  the overview (screenshot) *(cause not established: the label size is scaled for date bars, T:2497-2498,
  T:2563-2565)*.

**Layout switching.**
- Icons for alphabetic, umap, grid, date, categorical, geographic, custom; conditional ones hide when the
  manifest lacks them (H:385-393, T:570-583). Switching is refused while a transition runs (T:691).
- `Layout.set` (T:687-745): if the camera is zoomed in, it first flies back to the start (2 s, T:1099-1106), then
  fetches the layout JSON (each switch re-fetches it; no client cache), clears LOD, writes each cell's target
  into `targetTranslation` through a per-cell `setBuffer` call, and tweens one uniform `transitionPercent` 0→1
  over 2 s, Power1.easeOut (T:72-79, T:736-740). The vertex shader mixes `translation` and `targetTranslation`
  and also `scale` → `targetScale`, so point size changes with the layout (H:93-130, T:758-771). On completion
  the CPU copies targets into `translation` and re-uploads (T:814-835).
- So the per-frame cost of a transition is zero JS per item: one uniform per mesh. The CPU work is two full
  passes over the cells (target write, then commit), at the start and at the end.
- UMAP variants: if the pipeline ran a grid of `n_neighbors × min_dist` (AlignedUMAP, P:647-704), two sliders
  pick the variant (T:585-639); a "jitter" checkbox swaps in the pointgrid version (T:774-792, P:827-837).

## 4. Part 1 corrections (rows that mention PixPlot, or should)

| Axis / row | Plan says | Finding |
|---|---|---|
| 1.1 WebGL via a scene library | PixPlot uses three.js | **Confirmed**: three.js r121, but only as a GL wrapper — PixPlot writes its own RawShaderMaterial vertex/fragment shaders (H:15-279) and instanced geometry (T:1112-1245). One mesh, one draw call for all cells (measured: 2 calls incl. text). No accessibility; context loss = page reload (T:1064-1069). |
| 1.1 Hybrid GPU overview + DOM detail | (PixPlot not listed) | **Add PixPlot**: the lightbox is a DOM modal (H:500-546) with a 600-px original. Selection is not synced back into the canvas while it is open; the canvas only flew to the cell first. |
| 1.2 Fixed sprite sheets per tier | PixPlot (cell atlases) | **Confirmed, with a twist**: atlases are pre-baked 2048² JPEGs (P:488-545), but at load they are re-composited into 8192² canvases, 16 per texture (T:299-312), so the upload unit is 256 MiB. Packing is row-based with variable width (aspect preserved, no padding cells), unlike fixed-cell sheets. |
| 1.2 Per-item progressive tiers | PixPlot *(LOD, to verify)* | **Verified**: two GPU tiers (32-px atlas cell, 128-px LOD thumb) plus a DOM 600-px original. Choice heuristic = camera-grid distance + a z gate (Q1), not projected size. |
| 1.2 Runtime atlas from decoded images | (not listed) | **Add PixPlot's LOD tier**: a runtime 8192² atlas of 4,096 slots of 128², filled from per-image JPEGs with `texSubImage2D` (T:2855-2890). Eviction by grid radius; the decoded-image cache is unbounded. |
| 1.3 GPU-side membership mask | PixPlot *(hypothesis)* | **Partly right**: filters write an `opacity` attribute (0.35 for excluded, 1 for kept) over all cells (T:1444-1449, T:2959-2973). It dims rather than hides; no re-layout. Each change rebuilds the full typed array on the CPU and re-uploads it (T:1424-1432). There are no counts. |
| 1.3 Plain JS predicate | (not listed) | Also PixPlot: the predicate is a JS loop over all images (T:2959-2973) using per-tag membership lists fetched per selection (T:3076-3094). |
| 1.4 Embedding projection | PixPlot | **Confirmed** (UMAP + optional pointgrid jitter + rasterfairy grid). |
| 1.4 Grouped blocks | (not listed) | **Add PixPlot**: categorical layout packs square boxes by group size (P:1040-1095), from one single-valued `category` column. |
| 1.4 Timeline / histogram stacks | (not listed) | **Add PixPlot**: date layout = year bars of `cols` columns (P:869-933), with glyph-sprite year labels (T:2431-2578). |
| 1.4 Animated transitions | PivotViewer, VIKUS, CSN, Wunderkammer | **Add PixPlot**: GPU interpolation between two position attributes under one tweened uniform (Q4). This answers "per-item tween cost at scale": none per frame. |
| 1.5 Static site + data files | PixPlot output | **Confirmed**: output is a static folder (HTTP needed for XHR, T:3713-3738). Preprocessing burden is real: TF 2.13 + pinned numpy/scipy need Python ≤3.11 and, on this Mac, two dependency fixes. |

## 5. Part 2 column (PixPlot)

| Capability | PixPlot | Evidence |
|---|---|---|
| Survey: whole collection at once | yes | Initial camera z = 2 frames the whole [-1,1] layout (T:1599-1605); all cells drawn from atlases at once (T:1112-1145). |
| Continuous pan/zoom | yes | TrackballControls, left-drag pan, wheel zoom toward cursor (T:927-945, TB:211-225). Wheel is slow: 20 ticks × 30 px moved z 2 → 1.86 (measured). |
| Semantic zoom | partial | Only texture resolution changes (atlas → LOD under z 0.8). Click semantics change with z (fly vs open, T:2291-2293). No caption or content tiers. |
| Facets, multi-valued, OR within / AND across | partial | One flat tag list (values from a pipe-joined column, P:361), single-select (T:3045-3054); AND with the year range (T:2959-2973). No per-facet lists, no OR. |
| Facet counts that react to scope | no | Options carry no counts (T:2994-3014). |
| Numeric range filters | partial | Year only (noUiSlider, T:2405-2425; domain trimmed at 4σ, P:378-387). |
| Free-text search | no | `#image-search` is in the markup (H:375-378) but `display:none` (CSS:293-298) and `Search()` is empty (T:3135-3137). |
| Semantic / embedding search | no | Similarity exists only as layout. |
| Find without changing scope | partial | Hotspot click flies to a representative (T:3262-3264); `flyToCellImage` exists (T:1585) with no UI beyond hotspots. |
| Group by facet as territory | partial | Categorical layout from one build-time column (P:983-1037); group names not visible in our build. |
| Sort within groups; attribute lens/brush | no | Alphabetic = filename order (P:811-824). Lasso is spatial selection, not an attribute brush. |
| Timeline layout | yes | Date layout (P:869-933). |
| Similarity layout | yes | UMAP, variants and jitter (P:594-704, T:585-639). |
| Geographic layout | yes | lat/lng layout with continent shapes (P:1113-1132, T:3402-3468); not exercised here. |
| Piles | no | |
| Animated layout transitions | yes | 2 s GPU tween (H:93-130, T:718-745). |
| Rich detail view | partial | Lightbox: 600-px image, filename as title, description, date, category/tag chips, permalink and download icons (H:500-546). Not linked to text or other media. |
| Reading traversal (next/prev) | partial | Arrow keys/swipes within the set the lightbox opened (T:2665-2690); a single click opens a set of one, so traversal works over a lasso selection (T:1845-1853). |
| Selection of a subset; export | yes | Lasso + shift/cmd toggles, "View Selected", download CSV/JSON/ZIP with images (T:1754-2110); save as hotspot on localhost. |
| Shareable URL of the exact view | no | URL flags only: `fly=true`, `stats=true`, `demo` (T:928, T:1514, T:3817). |
| Keyboard and screen-reader access | no | Canvas only, no ARIA. Space toggles lasso mode (T:1672-1683). |
| Live corpus | no | Static rebuild. |
| No-server deployment | yes | Static folder on any HTTP server. |
| Embeddable component / API | no | Page-level globals and fixed DOM ids (T:4197-4214); manifest path hard-coded to `data/manifest.json` (T:44-49). |
| Preprocessing pipeline included | yes | `pixplot` CLI (P:1352-1379). |
| Documented scale | README: >100k with smaller `cell_size`; demos at 24k and 31k | Measured here: 10k boots and runs headless; ready 5.4 s, including ~2.5 s of fixed loader choreography. |

Other capabilities the matrix lacks: **attract mode** (unattended kiosk tour of hotspots, `?demo`,
T:3808-3911); **curated clusters as a committed file** (`user_hotspots.json`).

## 6. Part 3 scores (0–5)

| Use case | Score | Why |
|---|---|---|
| Competitive / market research wall | 1 | Static rebuild per change, no capture, no text search, one flat single-select tag list, filename as title, no URLs to items beyond one `permalink`. Useful parts: lasso to export a subset, hand-curated named clusters, the date layout. |
| LLM-communicated collection | 2 | The input spec is the easiest of any peer for an LLM to emit: a folder of images plus a CSV with nine fixed column names (README "Adding Metadata"). But building needs TF + UMAP (or a converter like ours), the output is a page rather than a component, and a selection leaves only as a file download, with no callback. A 512 MiB GPU floor rules out artifact or phone contexts. |

## 7. Technique ledger

| technique | source (file:line) | grade | wunderkammer file it would change | metric it should move | perf-budgets.json key |
|---|---|---|---|---|---|
| Layout transition as two instanced position attributes plus one tweened uniform; the vertex shader mixes them, so a transition costs no per-item JS per frame. Ties to TODO "Dense zoom-out and regrouping stalls" and the scale ceiling. | H:93-130, T:718-745, T:814-835 | port (small, standard; MIT would allow copy, but there is nothing worth vendoring) | `wall/spatial/lib/instanced.js` (row motion), `wall/spatial/lib/motion.js` | script ms and frames >33 during a 3D regroup at 10k | `spatial filter on` / `spatial filter off` (scriptMs); no 3D group key exists yet |
| Filter = per-instance opacity attribute (dim excluded to 0.35, keep place). Supports TODO "Place-preserving filters and Gather" (dimmed context). Wunderkammer 3D `setActive` already does the GPU part; the idea worth taking is dim-in-place as the default filter presentation. | T:1444-1449, T:2959-2973 | idea | `wall/spatial/spatial-view.mjs:659` (setActive loop) | INP on filter; no relayout | `spatial filter on` / `spatial filter off` |
| GPU colour-ID picking (instance id → RGB; off-screen render + 1-px readback). Wunderkammer picks CPU-side (`instanced.js:406`, `pickAt`). At 25k this trades a CPU scan for a GPU stall; PixPlot renders the full canvas per pick and stalls on ReadPixels. Worth it only with a 1×1 scissored render, and only for click, not hover. Ties to "hover and click at 25k". | T:1170-1180, T:2242-2341, H:190-193 | idea (measure before porting) | `wall/spatial/lib/instanced.js` (`pickAt`) | pick ms at 25k; INP on 3D click | `spatial open` (no pick key; add one) |
| Row-packed atlases with variable cell width (fixed height, aspect preserved, no padding). Ties to TODO "3D far tier from the 64 px sheet" and sheet waste. | P:488-539 | port (trivial algorithm) | `lib/sheets.mjs`, `wall/overview-sheets.mjs` | sheet pages per corpus; decoded px per image | `boot` (imagesMs) |
| Hotspots: clusters from high-dim vectors, a DOM list with representative thumbnail + share bar, fly-to, rename/reorder/delete/save as a committed JSON that overrides the defaults. Ties to TODO "Place the cluster suggestions" and the research-wall curation loop. | P:1203-1237, T:3143-3396 | idea | `wall/context-clusters.mjs` | (UX; no perf metric) | — |
| Lasso → named subset → export CSV/JSON/ZIP or save as a cluster. Ties to the LLM direction "selection flows back to the conversation". | T:1754-2110, T:3177-3201 | idea | new: selection export in `wall/wall.mjs` / piles | (UX) | — |
| Attract mode: an idle timer tours clusters, zooms, opens the lightbox. Kiosk use; low priority. | T:3808-3911 | idea | — | — | — |
| LOD by camera-grid neighbourhood with a z gate. Rule out: it loads by distance in a quantised grid, ignores frustum and projected size (measured 561 activated vs ~50 visible), and fetches one image per frame. This is the opposite of TODO "3D near tier by visible projected size". | T:2742-2898 | rule out | — (confirms the projected-size plan for `instanced.js`) | near slots on visible faces | `spatial zoom in/out` |
| `lod.clear()` every frame at the overview, flagging two instanced attributes for re-upload each frame. Rule out as an anti-pattern: an idle frame should upload nothing. | T:2783-2785, T:2932-2937 | rule out | — | idle script / GPU upload | `spatial idle 2s` |
| Fixed device-max textures (two 8192² = 512 MiB) allocated regardless of n, and reload on context loss. Rule out: this is the failure mode behind TODO "page blinks under GPU memory pressure", taken to the extreme. Wunderkammer should keep sizing atlases to the visible need. | T:53-62, T:81, T:261-268, T:2698, T:3508, T:1064-1069 | rule out | — | GPU-pressure dropout count | (gpu-probe) |
| Gate the scene behind a loader until every atlas is loaded, then an Enter click and ~2.5 s of fixed animation. Rule out: wunderkammer's boot budget is ready ≤ 1 s with progressive images. | T:3629-3657, CSS:914-942 | rule out | — | readyMs | `boot` (readyMs) |
| Fragment-shader `if` chain over a sampler array to choose the atlas texture. Rule out in favour of WebGL2 texture arrays if wunderkammer ever needs multi-page sampling in one draw. | T:1463-1495, H:261 | rule out | — | — | — |

## 8. Driver and smoke

- Driver: `scripts/peer-perf/drivers/pixplot.mjs`. Offers `ready`, `imagesShown`, `surface`,
  `pan` (left-drag; wheel is zoom here), `zoomIn`/`zoomOut` (standard 20 × 30 px wheel ticks), `filterOn`/`filterOff`
  (first tag in the Category dropdown, then the same tag again), `layoutSwitch` (rasterfairy grid) / `layoutBack`
  (scatter) waiting for the 2 s tween, `detailOpen` (click a pickable cell → 2 s flight → click again → wait for the
  600-px image) / `detailClose` (× button), and `gpuGesture`. **`search` is absent** (the tool has none).
- `imagesShown` definition: at the initial camera (z = 2) LOD is off, so the first view's images are exactly the
  atlas cells; shown = all cells once every atlas texture has loaded (`data.loadedTextures`), and the world is
  displayed. That is already true when the Enter button activates, so imagesMs is ~40–180 ms after ready.
- **The standard zoom gesture never reaches the LOD tier** (z 2 → 1.86; LOD needs z < 0.8). Equal input across tools
  was kept; the LOD behaviour in Q1 comes from a separate deep-zoom probe (`.local/peer-study/pixplot/probe3.mjs`,
  300-px ticks).
- `readyMs` includes the Enter click and ~2.5 s of fixed choreography (1.5 s timeout + 1 s CSS transform); the
  loader intercepts clicks until it has slid away, so the driver waits for that.
- Smoke (`--scenarios idle,pan`, headless): all three corpora pass; results in `.local/peer-study/perf/`
  (`2026-10-14T04-41-51-786Z-pixplot-music.json`, `…04-42-08-400Z-pixplot-psychodeli.json`,
  `…04-42-56-405Z-pixplot-synth10k.json`). A functional (untimed) pass of every scenario on all three corpora also
  succeeded, written to scratch only. The one console error per run is the expected 404 for
  `user_hotspots.json` before the fallback to default hotspots (T:3161-3166).

## 9. Surprises, and what I could not establish

- **The pipeline ran.** Despite TF 2.13 on an Apple-silicon Mac on Darwin 27, the full unmodified CLI ran on
  psychodeli in 45 s after the two dependency fixes. The scipy wheel failure is an OS-level dyld rejection, not a
  PixPlot bug.
- **512 MiB of textures for 406 images.** The README presents `cell_size` as the memory knob, but on desktop the
  floor is fixed by `MAX_TEXTURE_SIZE` and does not depend on the collection.
- **Search is a dead control** shipped hidden; the README never claims search, so there is no contradiction, only
  leftover markup.
- **The hotspot convex hull is dead code**, and `Hotspots.showHide` is never called.
- **`flyToCellImage` cannot fly to image 0** (`if (!idx)`, T:1590).
- **Categorical labels**: a code path exists (gated on the date layout), but I saw no labels at the overview in
  the music build. I did not establish whether they are too small, off-screen, or unrendered.
- **Not measured**: GPU memory actually resident (vs allocated canvas sizes), behaviour under
  `--force-gpu-mem-available-mb` (prediction: context loss → reload loop), headed frame times. All are for the
  coordinator's serial runs.
- Headless numbers in §8 are functional evidence only (SwiftShader).
