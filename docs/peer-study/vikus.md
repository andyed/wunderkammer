# Peer study: VIKUS Viewer

Peer key `vikus`. Study date 2026-10-13. Citations use `vikus-viewer@ccb4e7e path:line` for the viewer
and `vikus-viewer-script@c171633 path:line` for the preprocessing script. "Observed" means a headless run
against our instances (untimed functional checks, not perf numbers). *(inferred)* marks claims I could
not tie to a line.

## Pin, licence, build and run

| | |
|---|---|
| Viewer | https://github.com/cpietsch/vikus-viewer, `ccb4e7e` (2026-08-18), clone at `<peer-study workspace>/vikus-viewer` |
| Licence | MIT, `vikus-viewer@ccb4e7e LICENSE.md:1-9` ("Copyright (c) 2017 Christopher Pietsch"). The README restates MIT with "2017-2021 Christopher Pietsch, and contributors" (`README.md`, "License"). |
| Notice obligation | Any copied code must carry that copyright line plus the MIT permission notice (a `NOTICE` entry or file header). This study grades nothing as **copy**, so no notice is owed today. |
| Bundled third-party code | Pixi.js **5.2.2**, the one actually loaded (`index.html:25`, `js/pixi.min.js:2`). `pixi.8.min.js` and `pixi-legacy.js` are vendored but unused. d3 v3, Vue 2, marked and lodash are all MIT. |
| Script | https://github.com/cpietsch/vikus-viewer-script, `c171633`, clone at `<peer-study workspace>/vikus-viewer-script`. **No licence file.** `package.json:18` declares `"license": "ISC"`, but with no licence text and no grant in the repo we treated it as all-rights-reserved and read it only. |

**Build.** There is no build step. The viewer is a static page that fetches `data/config.json` (`js/viz.js:59`) or `?config=<url>` (`js/utils.js:13-25`). Each corpus instance in `<peer-study workspace>/instances/vikus/<corpus>/` holds symlinks to the pinned clone's `index.html`, `css/`, `js/`, `img/` and `font/`, so the clone itself is never modified, plus a generated `data/` folder.

**Converter.** `scripts/peer-perf/convert-vikus.py` (run with `python3 -I`, needs Pillow). Its header lists every mapping and loss. In summary:

- **Maps:**
  - `facets` become VIKUS `keywords` written `name=value`. The prefix avoids collisions: psychodeli has both kaleido=uncertain and repetition=uncertain.
  - `year` becomes `year`.
  - Other fields become `_title`, `_text`, `_source`, `_kind`, `_date`, `_width`, `_height`, `_palette`, and `_f_<facet>`.
  - `projection.json` becomes `tsne.csv`, which drives the "Similarity" layout.
  - The medium tier is built as 2048 px JPEG sprite sheets: 128 px sprites, or 90 px for synth10k, per the script README's advice for collections over 5,000 (`vikus-viewer-script@c171633 README.md:57`).
  - The detail tier is `data/1024/<id>.jpg`, exactly 1024 px on the long side.
  - The big tier is a symlink to the corpus's 640 px JPEGs.
- **Loses or changes:**
  - Undated items get year `0`. Without that they vanish: see "Surprising".
  - Multi-valued facets survive only as keywords, so OR within a facet is not expressible.
  - The tag cloud shows only the top ~58 keywords at 1440 px, so most artists and minor genres cannot be clicked.
  - The palette is kept as text only; VIKUS has no colour lens.
  - The 1024 tier is upscaled from 640 px sources, because VIKUS requires exactly 1024 there.
- **Also written per corpus:**
  - `config-crossfilter.json`, which uses the crossfilter UI over single-valued facets.
  - For psychodeli, `config-min.json`: the smallest config that boots (Q4).

The authored configs are copied to `.local/peer-study/vikus/<corpus>/`.

**What I learned from reading the script (no code copied or ported):**
- Sheets are 2048 px (`src/textures.js:127-131`).
- Each tier is resized "fit inside" (`src/cascade.js:42`).
- Sprites default to 128 px and are PNG intermediates (`src/textures.js:40,76-82`).
- Sheet quality is 70 (`src/textures.js:46`).
- Packing is delegated to the external `sharpsheet` package (`src/textures.js:4,127`).

The manifest *format* I took from the viewer's own parser, `vikus-viewer@ccb4e7e js/pixi-packer-parser.js:22-123`:
- `meta.type` is `"sharpsheet"` or `"pixi-packer"`, with `version <= 1`.
- `spritesheets[]` holds `{image, sprites:[{name, position:{x,y}, dimension:{w,h}}]}`.

Our packer (height-sorted shelves) is our own code.

**Serve.** `.local/peer-study/vikus/serve.sh` is idempotent: it kills its own ports first, then runs `npx http-server … -c 3600`, with logs beside the script.

| Corpus | Port | Items | Sprite px | Sheets | Year groups | Columns |
|---|---|---:|---:|---:|---:|---:|
| music | 4310 | 1,793 | 128 | 7 | 66 (incl. `0`) | 3 |
| psychodeli | 4311 | 406 | 128 | 1 | 2 | 16 |
| synth10k | 4312 | 10,000 | 90 | 12 | 4 | 41 |

The column counts are author choices. VIKUS stacks each group in `projection.columns` columns (`js/canvas.js:899-904`), so the converter picks the smallest count that keeps the tallest stack inside ~80% of a 1440×900 viewport at Fit. A curator would tune this by eye.

**Driver.** `scripts/peer-perf/drivers/vikus.mjs` implements every harness scenario plus `gpuGesture`; none are absent. `imagesShown` counts item sprites whose texture is no longer `PIXI.Texture.WHITE` and whose base texture is valid, against the total item sprites. The citations are in the driver header.

**Smoke test** (`--scenarios idle,pan`, headless, one run each; perf numbers are for the coordinator's serial runs). All three corpora booted with no page errors:

| Corpus | ready | images shown | sheet requests | heap |
|---|---:|---:|---|---:|
| music | 416 ms | 315 ms | 7 requests, 6.0 MB | 12.5 MB |
| psychodeli | 379 ms | 111 ms | 1 request, 1.2 MB | 8.5 MB |
| synth10k | 270 ms | 825 ms | 12 requests, 15.7 MB | 61 MB |

Results are in `.local/peer-study/perf/smoke/`. An untimed functional pass of every gesture succeeded on all three corpora.

## Pipeline

```
data in   → config.json + data.csv (+ timeline.csv, tsne.csv, info.md) via d3.csv; keywords split/uniq'd, a joined
            upper-case `search` string built per row        (js/viz.js:59-67, js/loader.js:8-56, js/utils.js:138-182)
index     → none persistent: keyword counts re-nested from active rows on every change (js/tags.js:88-117);
            "crossfilter" mode = full scans per dimension (js/crossfilter.js:214-264); a d3 quadtree over item
            positions for hover picking, rebuilt after every layout (js/canvas.js:42-49, 1601, 1640)
layout    → group: d3.nest by groupKey → ordinal band per group, N columns, active items stacked up, inactive stacked
            DOWN below the axis (js/canvas.js:883-923, 1630-1641); csv: per-axis [0,1] rescale of x/y into a square
            (js/canvas.js:803-826, 1545-1603); undocumented numeric-y variant (js/canvas.js:925-986)
render    → Pixi 5 WebGL: one Sprite per item on stage3 textured from 2048² sheets; 1024 px sprites on stage4;
            one big sprite on stage5; per-frame CPU easing of every sprite's position/alpha; render skipped when
            all converged (js/canvas.js:591-620, 997-1037, 1068-1074)
interaction → d3 v3 zoom (drag pan, wheel zoom about the hovered item) transforms stage2 (js/canvas.js:55-61,
            1221-1300); hover = quadtree nearest (828-863); click = zoom-to-image then Vue sidebar (1091-1189);
            state ⇄ URL hash: filter, search, mode, ids, borders, vector (js/viz.js:250-289, js/canvas.js:1388-1506)
```

## Part 4 answers

### 1. Texture tiers: when does VIKUS switch 256 → 1024 → 4096, does it unload, and what is the GPU budget?

The README's "256 → 1024 → 4096" describes the config schema, not the code's behaviour. The real tiers are as follows.

**Medium tier (all items, always resident).**
- The whole sprite-sheet manifest loads at boot (`js/viz.js:134-149`). Each sheet's frames are assigned as the sheet arrives (`js/pixi-packer-parser.js:63-125`).
- Sprite pixel size is whatever the script produced: default 128 (`vikus-viewer-script@c171633 src/textures.js:40`), and 90 suggested above 5,000 items.
- `config.loader.textures.medium.size` must equal that pixel size, because it is the unit of the whole coordinate system (`scale1 = imageSize / rangeBandImage`, `js/canvas.js:457, 561`). The README example's `256` is just a number the author has to match.
- There is no unload: sheets live for the session.
- Estimate at 2048²×4 B per sheet: ~117 MB for music (7 sheets) and ~200 MB for synth10k (12 sheets) *(arithmetic, not measured GPU memory)*.

**Detail tier (1024 px, per item).**
- The rule is a count in view, not a distance or a projected size. At every `zoomend`, `filterVisible` tests each sprite against the viewport. If fewer than 40 items are visible, every visible, active, not-yet-loaded item is queued; otherwise every 1024 sprite is hidden (`js/canvas.js:1644-1682`).
- The queue is drained one item per animation frame and is paused while zooming or while zoomed to an image (`js/canvas.js:1800-1811`).
- Each load is `PIXI.Texture.from(url)` on a new sprite in stage4 (`js/canvas.js:1684-1719`). The item's `scaleFactor` is the only scale applied, so the file must be exactly `detail.size` px or it draws at the wrong size.
- Never unloaded: `d.loaded = true` is permanent and the sprite stays in stage4, merely hidden (alpha → 0, `visible = alpha > 0.1`, `js/canvas.js:1024-1031`).
- Observed (psychodeli): after one deep zoom, 9 detail sprites stayed resident through zoom-out, filter, layout switch and detail close. Pixi's managed texture count went 2 → 11 → 15 and never fell during the session.

**Big tier (one item).**
- Loads when a click's zoom-to-image transition ends (`js/canvas.js:1131-1137`), or when a wheel zoom carries the scale past 0.9× the image scale (`js/canvas.js:1244-1256` sets the state; `zoomend` loads it at `1353-1361`).
- The texture is scaled by its own pixel size (`imageSize3 / max(w,h)`, `js/canvas.js:1747-1749`). Any size works; "4096" is nominal.
- On load, the item's medium and detail sprites fade out (`js/canvas.js:1751-1754`). Every other item already went to alpha 0 when the zoom landed (`hideTheRest`, `js/canvas.js:1201-1208`), so the GPU draws one sprite.
- Unload: zooming out below 0.8× the image scale calls `clearBigImages`, which only `removeChild`s the sprite (`js/canvas.js:1258-1264, 1792-1798`). Nothing is destroyed, and `Texture.from` keeps the image in Pixi's URL cache. Observed: the managed GL texture count did not drop after detail close.

**GPU budget.** VIKUS has none of its own. The only reclamation is Pixi 5's automatic texture GC: `GC_MODE` AUTO, `GC_MAX_IDLE` 3600, `GC_MAX_CHECK_COUNT` 600 (`js/pixi.min.js:8`, minified). It deletes the GPU copy of a texture not drawn for 3600 *rendered* frames. VIKUS stops calling `renderer.render` while the scene is converged (`js/canvas.js:1071-1073`), and Pixi's GC counts renders, not time *(inferred from Pixi 5's post-render GC hook; the minified source is not line-citable)*. So an idle VIKUS session never reclaims anything, and an active one reclaims a texture only after ~1 minute of continuous rendering without it.

Relevance to wunderkammer:
- **Page blink under GPU pressure.** VIKUS is no model here: its unbounded detail tier is the kind of growth we suspect.
- **Zoom-out max frame with sheets.** VIKUS dodges this by never evicting its sheets, which is affordable only because one sheet tier is small: 128 px sprites at 7–12 pages.

### 2. Layout transitions across thousands of Pixi sprites: per-sprite tweens or a shader?

Neither: a per-frame CPU loop over every item.
- `imageAnimation` moves each sprite 6% of the remaining distance per frame (`speed = 0.06`) and alpha 20% per frame, and reports "sleep" when every item is within 0.1 px and 0.01 alpha (`js/canvas.js:995-1037`). The `animate` loop skips `renderer.render` when asleep (`js/canvas.js:1068-1074`).
- A layout change only rewrites targets (`d.x1/d.y1`) and wakes the loop: `setMode` → `makeScales` → `project` → `split` / `projectTSNE` (`js/canvas.js:1043-1062, 1516-1543, 1630-1641`).
- Consequences:
  - The motion is frame-rate dependent: no `dt`, so it is slower on a 30 fps device.
  - The loop does O(n) JS work per frame until the farthest item converges. A 500 px move needs ~140 frames, about 2.3 s at 60 fps, a figure that matches the 2–4 s settles observed on our corpora *(observed, untimed)*.
  - There is no stagger and no staging; everything moves at once.
- Sprites are never rebuilt. The quadtree used for hover picking is rebuilt after each layout (`js/canvas.js:1601, 1640`).

### 3. How does crossfilter feed keyword counts and hide sprites without a rebuild?

**There is no crossfilter.js.** `js/crossfilter.js` is a hand-written `Crossfilter()` UI module with no dependency on Square's library. Its counting is a nested scan (`js/crossfilter.js:214-264`): for each dimension, for each row, test every other active dimension. That is O(dims² × n) per update. The Part 1 table's "crossfilter.js (sorted dimensions, incremental groups) | VIKUS" is wrong.

**Default keyword mode (`js/tags.js`).**
1. `tags.filter` sets `d.active` (row matches all selected keywords AND the search substring), or `d.highlight` for a hover preview (`js/tags.js:69-86`).
2. `tags.update` re-nests every active row's keywords with `d3.nest`, sorts by count, keeps the top `sliceScale(width)` (50–200; ~58 at 1440 px) and lays them out (`js/tags.js:88-181`).
3. A keyed d3 join updates or removes the tag divs, sized by count; no number is shown (`js/tags.js:188-259`).

**Canvas side.**
- Nothing is hidden. `canvas.highlight` sets each target alpha to 1 or 0.2 (`js/canvas.js:1508-1513`).
- 50 ms later, `canvas.project` re-runs the layout: matches are stacked above the timeline axis and non-matches are stacked *inverted below it*, off screen at Fit (`js/tags.js:261-270`, `js/canvas.js:1630-1641`, `invert` at `904`).
- In the similarity layout, non-matches go to a ring around the map (`js/canvas.js:1559-1565`).
- Sprites are never created or destroyed, only retargeted, so "without a rebuild" holds for the scene graph. Every filter still costs an O(n) relayout, a quadtree rebuild and a full re-nest.

**Hover preview.** Entering a tag applies the would-be filter as `highlight` only, an alpha change with no relayout (`js/tags.js:352-360, 375-386`). Crossfilter does the same with a deep-copied temporary filter (`js/crossfilter.js:157-173`).

**Crossfilter mode's counts are computed but not displayed.** Items render `d.key` only (`js/crossfilter.js:146-148`); the size-based font is commented out (`175-179`). Values with zero co-occurrence get `.hide`, drawn at opacity 0.3 (`181-184`, `css/style.css:1011-1014`).

Semantics:
- Values within a scalar dimension combine with OR (`indexOf(val)`, `js/crossfilter.js:293`); array dimensions and keywords combine with AND (`every`, `291`; `js/tags.js:72-76`).
- Only `keywords` (and its copy `_keywords`) is ever an array (`js/utils.js:143-168`). A multi-valued CSV column is therefore one opaque string in crossfilter mode.

Observed, psychodeli crossfilter: selecting `complexity=low` left 59 items above the axis and dimmed the other dimension values with no co-occurrence.

### 4. `config.json` as a collection spec: what must an author declare, and how close is it to an LLM-emittable spec?

**Minimum that boots**, found empirically by deleting keys until the page loaded (`data/config-min.json` in the psychodeli instance):

```json
{"project":{"name":"min"},
 "loader":{"items":"data/data.csv",
   "textures":{"medium":{"url":"data/sprites/sprite.json","size":128},"detail":{"url":"data/1024/","size":1024}}},
 "projection":{"columns":16},
 "detail":{"structure":[{"name":"Title","source":"_title","type":"text"}]},
 "style":{"canvasBackground":"#000000"}}
```

There is no schema, no defaults and no error UI. A missing key is an uncaught TypeError and a blank page:
- `project.name`: `js/utils.js:63`, observed.
- `projection.columns`: `js/canvas.js:560`, observed.
- `style.canvasBackground`: `js/canvas.js:582`.
- `detail.structure`: `js/canvas.js:558, 1165`.

A missing `timeline` or `info` only logs a 404 and "error loading /undefined", from `utils.makeUrl` concatenating `undefined` (`js/utils.js:26-32`, `js/loader.js:45-48`).

**Required alongside the JSON:**
- `data.csv` with `id`, `keywords` and `year` (README "data.csv").
- **Preprocessed binaries**: sprite sheets plus a manifest, and one 1024 px file per item. An LLM can write the JSON and CSV; it cannot produce the image pipeline. That pipeline lives in a separate repo with no licence.

**Declarative parts that work well:**
- `loader.layouts`, an ordered list where each entry is `{type:"group", groupKey, columns}` or `{url}` for an x/y CSV (`js/viz.js:210-247`).
- `detail.structure`, a typed field list: text, markdown, keywords, link, function (`index.html:108-130`, `js/sidebars.js:16-38`).
- `filter.dimensions`.
- `sortKeywords`.

**Hazards for an LLM-emitted spec:**
- **The `function` field type is `eval`** (`js/sidebars.js:29-34`). A spec can run arbitrary code in the viewer's origin.
- Six README/code mismatches would break a model that followed the docs:
  1. `sortKeywords: "alphabetical-reverse"` (`README.md:41`) is checked in code as `"alfabetical-reverse"` (`js/tags.js:123`), so the documented value silently does nothing.
  2. "alphabetical" sorts by first character only (`js/tags.js:121`).
  3. The timeline column is documented as `title` (`README.md:61`) but read as `titel` (`js/timeline.js:111, 119, 133`).
  4. `ui=0` is documented as a query-string parameter (`README.md:202`) but read from the hash (`js/viz.js:90-96`).
  5. A layout's `scale` is documented as "scale the spread" (`README.md:122`). In code it is the sprite size factor (`js/canvas.js:1519`); the spread is fixed at 0.8 × min(width, height) (`1557`).
  6. The "spacing step so images don't overlap" (`README.md:101`) is the script's job, not the viewer's; the viewer plots the CSV as given.
- Undocumented features exist: a numeric y layout via `mode.y` (`js/canvas.js:925-986`) and `sortArrays` (`js/crossfilter.js:43-45`).

**Verdict.** VIKUS is about half of an LLM-emittable spec. The JSON layer is small and declarative, but it is brittle and has no validation, and the media layer needs an offline tool. Wunderkammer should keep VIKUS's shape:
- items plus typed facets,
- an ordered layout list,
- a typed detail-field list.

It should add what VIKUS lacks:
- a schema with defaults and readable errors,
- no `eval`,
- images by URL, with any atlas built at runtime.

### 5. How does the detail sidebar stay in sync with canvas selection?

**One owner, one direction.**
- The canvas closure owns `selectedImage`: the hovered item, chosen by quadtree nearest within `cursorCutoff` (`js/canvas.js:80, 828-863`).
- Clicking zooms to that item (`js/canvas.js:662-701, 1091-1142`). When the transition ends, `showDetail` copies the configured fields into a plain object and assigns `detailVue.item`, and the Vue template re-renders (`js/canvas.js:1145-1189`, `js/sidebars.js:1-41`, `index.html:93-134`).

**Sidebar → canvas: only page flips** within a multi-page item (`js/sidebars.js:10-12` → `canvas.changePage`, `js/canvas.js:1193-1199`). Keywords in the sidebar are inert spans (`index.html:112-116`).

**Zoom drives the sidebar.**
- Wheel-zooming past 0.9× the image scale over a hovered item opens the detail with no click (`js/canvas.js:1244-1256`).
- Zooming out below 0.8× closes it, restores every item's alpha and drops the big sprite (`js/canvas.js:1258-1265`).
- This is semantic zoom into the reading view. The "close" action is a zoom gesture, not a button: the sidebar has only a collapse toggle (`js/viz.js:183-186`).

**Escape is a global reset** (`js/viz.js:164-170`): search reset, tag reset, `canvas.split()`, and `location.hash = ""`. That hash change zooms out over 1.5 s and resets the mode (`js/canvas.js:1431-1441, 1605-1628`).

**The URL is the integration bus.**
- `ids=<id>` is written when the zoom lands (`js/canvas.js:1140`).
- After any user zoom, `ids` holds the extreme items of the viewport (`js/canvas.js:273-334, 1363-1383`), debounced 400 ms.
- `iframe.html` is a test page syncing two embedded viewers by polling each other's hash (`iframe.html:42-80`).

Relevance to wunderkammer's **detail close INP**: VIKUS's close has no synchronous work beyond a class toggle and a hash write. The cost lands in transition frames rather than inside the input event.

## Part 1 corrections (rows that mention VIKUS or should)

| Table row | Plan says | Finding |
|---|---|---|
| 1.1 WebGL via scene library | VIKUS (Pixi) | Confirmed: **Pixi 5.2.2** (`index.html:25`, `js/pixi.min.js:2`). A vendored `pixi.8.min.js` is unused. No WebGL context-loss handling anywhere (grep of `js/*.js` for `contextlost`: none). |
| 1.1 Hybrid GPU overview + DOM detail | VIKUS | Confirmed, with a twist: before the sidebar fills, the item is promoted *in the canvas*. A big texture replaces the sprite in place, everything else fades (`js/canvas.js:1201-1208, 1721-1790`), and zoom alone can open or close it. The DOM sidebar carries only text. Sits between "hybrid" and "per-item promotion". |
| 1.2 Fixed sprite sheets per tier | VIKUS (256 px) | Correct the size: sprites default to **128 px** (90 suggested above 5k) in **2048 px** sheets (`vikus-viewer-script@c171633 src/textures.js:40,130`, `README.md:57`). `medium.size` in config must match, whatever it is. Sheets are never evicted. |
| 1.2 Per-item progressive tiers | VIKUS (256 → 1024 → 4096) | Partly wrong: the 1024 tier keys on **"fewer than 40 items in view"** after a zoom ends, loaded one per frame and paused mid-gesture (`js/canvas.js:1644-1682, 1800-1811`). The big tier keys on focus (click or zoom-through) and is size-agnostic. No unload; no budget (Q1). |
| 1.3 crossfilter.js | VIKUS | **Wrong.** VIKUS has no crossfilter.js; its "crossfilter" is a UI mode doing full scans (`js/crossfilter.js:214-308`). VIKUS belongs in the "plain JS predicate over arrays" row, with a full keyword re-nest on top (`js/tags.js:88-117`). |
| 1.3 GPU-side membership mask | — | VIKUS does neither mask nor hide: it re-lays out excluded items below the axis at alpha 0.2 (Q3). Should be a new row: **"filter = relayout with dimmed remainder"**. |
| 1.4 Timeline / histogram stacks | VIKUS | Confirmed. Group layout by any column, N columns per group (`js/canvas.js:482-532, 883-923`). Unknown or empty keys get NaN positions (Surprising, below). Undocumented numeric-y variant (`925-986`). |
| 1.4 Embedding projection | VIKUS | Confirmed, from a provided CSV; the viewer computes no projection. Each axis is rescaled to [0, 1] independently (`js/canvas.js:813-825`), so the aspect ratio of the embedding is not preserved. |
| 1.4 Animated transitions | VIKUS | Confirmed. Per-sprite CPU exponential easing every frame, frame-rate dependent, with no staging (Q2). |
| 1.5 Static site + data files | VIKUS | Confirmed. Note "static" still needs an offline image pipeline (Q4). |
| 1.5 URL-encoded view state | Wunderkammer only | VIKUS too: `filter`, `search`, `mode`, `ids`, `borders`, `vector` in the hash. View position is encoded as **item ids of the viewport's extreme items**, not translate/scale (`js/canvas.js:273-334, 1363-1383`), which survives a different window size. |

## Part 2 column: VIKUS

| Capability | VIKUS | Evidence |
|---|---|---|
| Survey: whole collection at once | yes | Fit = scale 1 shows all items (`js/canvas.js:1605-1628`). Observed at 10k. |
| Continuous pan/zoom | yes | d3 zoom, scale 1–2500 (`js/canvas.js:53-61`). Horizontal pan clamped at the canvas edge (`1231-1238`). |
| Semantic zoom | partial | 1024 tier when < 40 in view (`1644-1682`). Zoom-through opens detail and the big texture (`1244-1256`). Timeline blurbs switch small/middle/large by scale (`js/timeline.js:14-17, 67`). Chrome hides above scale 2 (`js/canvas.js:1270-1292`). |
| Facets, multi-valued, OR within / AND across | partial | Keywords: AND only (`js/tags.js:72-76`). Crossfilter: OR within scalar dims, AND across, AND within arrays (`js/crossfilter.js:288-294`). Multi-valued only via `keywords`. |
| Facet counts that react to scope | partial | Tag cloud re-nested from active rows, count shown as font size only (`js/tags.js:94-117, 200`). Crossfilter counts computed, not displayed (`js/crossfilter.js:146-148`). |
| Numeric range filters | no | Nothing in tags/crossfilter. Numeric-y layout exists but does not filter (`js/canvas.js:925-986`). |
| Free-text search | yes | Substring over all fields joined (`js/utils.js:141`, `js/tags.js:71`). 300 ms debounce (`js/search.js:27-29`). Filters by relayout. |
| Semantic / embedding search | no | — |
| Find without changing scope | partial | Hovering a tag previews the match set as alpha without relayout (`js/tags.js:352-360`). Search itself changes scope. |
| Group by facet as territory | partial | Group layout by any scalar column (`js/canvas.js:482-532`). Bands in sorted order, no labels beyond the timeline row. Multi-valued columns are opaque strings. |
| Sort within groups; attribute lens/brush | no | Fixed sort by keyword count within a group (`js/canvas.js:895-897`). No lens. |
| Timeline layout | yes | Default group-by-year (`js/viz.js:80-88`). Curated blurbs from timeline.csv (`js/timeline.js`). |
| Similarity layout (UMAP/t-SNE) | yes | CSV x/y layout (`js/canvas.js:803-826, 1545-1603`). Projection is offline. |
| Geographic layout | partial | Any x/y CSV works (lon/lat), with no basemap or projection *(inferred from 1545-1603)*. |
| Piles | no | — |
| Animated layout transitions | yes | CPU easing (`js/canvas.js:995-1037`). |
| Rich detail view | yes | Vue sidebar: markdown, links, keywords, computed fields, multi-page items (`index.html:93-134`, `js/sidebars.js`). |
| Reading traversal (next/prev) | no | Only page flips within one item (`js/canvas.js:1193-1199, 1760-1780`). |
| Selection of a subset; export | partial | Shift-click outlines items, kept in `#borders=` (`js/canvas.js:664-668, 749-801`). Freehand annotation paths (`141-256`). No export. |
| Shareable URL of the exact view | yes | Hash state (`js/viz.js:250-289`, `js/canvas.js:1388-1506`). View encoded as item ids. |
| Keyboard and screen-reader access | no | Canvas only. Tags and filters are `div`s with no tabindex or ARIA (grep: none). Only Escape is bound (`js/viz.js:164-170`). **Disabled below 500 px wide** (`js/viz.js:43`, `js/utils.js:33-37`). |
| Live corpus | no | CSV read once at boot. Sprite sheets must be rebuilt offline. |
| No-server deployment | yes | Static files (README "Documentation"). |
| Embeddable component / API | partial | iframe + `?config=` + `ui=0` (in the hash) + the hash as state bus (`iframe.html`). No JS API, no postMessage, globals only. |
| Preprocessing pipeline included | partial | A separate repo with no licence file (`vikus-viewer-script`) plus notebooks. |
| Documented scale | partial | README guidance is "5000+ items" (`vikus-viewer-script@c171633 README.md:57`). Observed: 10,000 items boot (headless ready 270 ms, sheets shown 825 ms, heap 61 MB). |

## Part 3: use-case scores

**Competitive / market research wall: 1 / 5.**
- Against it:
  - The corpus is a static CSV plus sheets baked offline, so every capture or edit means re-running the sprite pipeline. No live corpus, no capture, no frontmatter.
  - Keywords are AND-only.
  - The canvas has no links, find-in-page or text selection.
- For it:
  - The detail sidebar renders markdown and links, so one item's notes read well.
  - Shareable hash state.

**LLM-communicated collection: 2 / 5.**
- For it:
  - A small declarative JSON (Q4: six keys suffice), static hosting, and `?config=` lets one hosted viewer show any collection.
  - Selection flows outward only through the URL hash (`ids`, `borders`), which an embedding page can poll, as `iframe.html` does.
- Against it:
  - First-try success is poor: no schema, blank page on a missing key, and README values that do not work.
  - `eval` in the detail spec.
  - The image pipeline cannot be emitted.
  - No selection callback.
  - Artifact-unsafe binaries are required (sheets and 1024 files).
- The technique worth taking is the spec's *shape*, not its runtime.

## Technique candidates

| Technique | Source (file:line) | Grade | Wunderkammer file it would change | Metric it should move | perf-budgets.json key |
|---|---|---|---|---|---|
| Defer detail-tier loads until the gesture ends, then one decode per frame. Ties TODO "Zoom-out max frame with sheets", "Landing raster frame", page blink. | `vikus-viewer@ccb4e7e js/canvas.js:1644-1682, 1800-1811` | idea (the count-in-view trigger itself is a rule-out; projected size is better, TODO "3D near tier by visible projected size") | `wall/image-work.mjs` | zoom out framesMax; zoom in scriptMs | `flat zoom out`, `flat zoom in` |
| Filter = relayout with the excluded set kept as dimmed territory (inverted stack below the axis, alpha 0.2), sprites never rebuilt. Ties TODO "Place-preserving filters and Gather", "Scope-change restyle of every tile". | `js/canvas.js:1508-1513, 1630-1641`; `js/tags.js:261-270` | idea | `wall/layout.mjs`, `wall/layout-motion.mjs`, `wall/overview-surface.mjs` | filter on INP; restyle ms | `flat filter on`, `flat filter off` |
| Hover a facet value to preview its set as alpha only (no relayout, no count commit) | `js/tags.js:352-386`; `js/crossfilter.js:157-173` | idea | `wall/wall.mjs` (rail chips), `wall/overview-surface.mjs` | none directly (UX). Must keep hover input ≤ 50 ms | `flat filter on` (`inputBlockMs`) |
| Zoom-through opens detail; zoom-out past 0.8× closes it. Close is a gesture whose cost lands in transition frames, not the input event. Ties TODO "Detail close INP ~170–208 ms". | `js/canvas.js:1244-1265` | idea | `wall/reader-lift.mjs`, `wall/detail-pane.mjs` | detail close INP | `detail close` |
| Permalink stores the viewport as the ids of its extreme items, not translate/scale, so it survives another window size | `js/canvas.js:273-334, 1363-1383` | idea | `wall/permalink.mjs`, `lib/permalinks.mjs` | correctness across viewports (no perf metric) | — |
| Sheet manifest maps names → frames, so duplicate images can share one cell (the parser allows any frame per name) | `js/pixi-packer-parser.js:60-124` | idea (check whether `lib/sheets.mjs` already dedupes by digest) | `lib/sheets.mjs`, `wall/overview-sheets.mjs` | boot image bytes and sheet pages at synth scale | `boot` (`imagesMs`) |
| Declarative spec shape: ordered `layouts[]` (`group` by key / `xy` csv), typed `detail.structure[]`, `filter.dimensions[]` — **plus** a schema, defaults and no `eval`. Ties the LLM direction. | `js/viz.js:210-247`; `index.html:108-130`; `js/sidebars.js:16-38`; `js/crossfilter.js:32-50` | idea | `lib/instance-config.mjs` | first-try success of an emitted spec (new acceptance test) | — |
| Quadtree-nearest hover picking with a size-scaled cutoff | `js/canvas.js:42-49, 828-863`; `js/utils.js:190-235` (credited to a Bostock block) | idea | `wall/overview-surface.mjs`, `wall/spatial/*` | hover cost at 10k–25k | `spatial pan` |
| Render loop that sleeps when every target has converged | `js/canvas.js:1068-1074, 997-1037` | rule out (wunderkammer's idle already meets 20 ms script; nothing to gain) | — | — | `flat idle 1s` |
| Per-frame CPU exponential easing of every item | `js/canvas.js:995-1037` | rule out: frame-rate dependent (no dt), O(n) every frame until the farthest item settles (~2.3 s), no staging; wunderkammer's bounded `layout-motion` is already better | — | — | `flat group →` |
| "Crossfilter" full-scan counting | `js/crossfilter.js:214-264` | rule out: O(dims² × n) per update, no faster than our `filterScope` (3–16 ms) | — | — | — |
| Never-evicting texture tiers, relying on Pixi's render-count GC | `js/canvas.js:1717, 1792-1798`; `js/pixi.min.js:8` | rule out as a model: the opposite of what TODO "page blink under GPU memory pressure" needs (an explicit budget) | — | — | — |
| Offline sprite pipeline (vikus-viewer-script) | `vikus-viewer-script@c171633 src/textures.js` | rule out: no licence file (read-only); offline-only conflicts with live corpora; wunderkammer already has `lib/sheets.mjs` | — | — | — |

Nothing was graded **copy** or **port**. The MIT code that was worth having is small and better re-expressed in wunderkammer's architecture.

## Surprising

- **Undated items disappear.**
  - An empty year is filtered out of the group domain (`js/canvas.js:497-500`).
  - d3 v3's ordinal scale returns NaN for unknown keys under `rangeBands` (`js/d3.v3.js:7746`), so those sprites get NaN positions and silently vanish.
  - The converter maps them to year `0`: a 249-item first band in music.
- **Filtering moves excluded items off screen** below the axis rather than hiding them; at Fit they leave the viewport entirely (Q3). On psychodeli, `complexity=low` left 59 of 406 items visible.
- **The crossfilter panel is unreadable on a dark style and partly unclickable.**
  - Its item background comes from the misnamed `style.textShadow` (`js/utils.js:79`).
  - No font colour is applied to it, unlike the tag cloud (`js/tags.js:43`).
  - The `.navi` layout buttons overlap it: Playwright's click was intercepted, and only a dispatched click worked.
- **The viewer refuses to start below 500 px wide** (`js/viz.js:43`). There is no mobile at all, despite mobile-specific zoom limits in `canvas.js:53`.
- **The detail tier must be exactly `detail.size` px** (not normalised), while the big tier may be any size (normalised). The asymmetry is undocumented.
- **The README and the code disagree in six places** (Q4).
- **Contrast in our instances.** The default `css/style.css` sidebar text (grey on our `#111` `detailBackground`) reads far below 8:1. That is our authored style colours combined with VIKUS's defaults. It matters only if someone uses these instances for anything beyond measurement.

## Could not establish

- Actual GPU memory per tier. The sheet figures are arithmetic; headless has no GPU memory counters. The coordinator's `--force-gpu-mem-available-mb` probe is the right test, with `gpuGesture` in the driver.
- Whether Pixi 5's texture GC ever fires in a real VIKUS session, given the render loop sleeps. The source is minified, so the post-render hook is *(inferred)*. A long headed session watching `renderer.texture.managedTextures.length` would settle it.
- Timed numbers for any scenario. Only the idle/pan smoke was run, by design.
- How `sharpsheet` packs, and whether it trims. I did not read it: it is a separate package outside the pin, and our packer is independent.
