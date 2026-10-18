# Peer report: seajax / PivotViewer

Peer key `seajax`. Study date 2026-10-13. All citations are `seajax@0293770` (github.com/seajax/seajax,
commit 0293770ea947, 2017-10-31). In this report, `PV` is `v2/app/pivot/PivotViewer.js`, `PView` is
`v2/app/pivot/PivotView.js`, and `img/` is `v2/src/image/`. Every citation still names the repo and commit.
Statements without a citation or measurement are marked *(inferred)*.

## 1. Pin, licence, build, ports

- **Clone:** `<peer-study workspace>/seajax`, `git rev-parse --short HEAD` = `0293770`.
- **Licence: BSD-2-Clause, not BSD-3 as the plan says.** `seajax@0293770 LICENSE.md:1-20` has two
  conditions (retain the notice in source; reproduce it in binary documentation) and no non-endorsement
  clause. `package.json` declares `"BSD-2-Clause"` (`seajax@0293770 package.json:43-46`). Every source
  file repeats the notice (for example `seajax@0293770 v2/app/pivot/PivotViewer.js:1-20`).
  **Notice obligation if we copy:** keep the "Copyright (c) Microsoft Corporation … BSD License" block in
  the file header or a `NOTICE`. A port needs only credit.
- **Build:** there is no bundler. `seajax@0293770 Build/Scripts/seajax_v2.py:70-92` concatenates
  `v2/src/_pre/standalone.txt`, the file list in `v2/build/pivot/standalone.txt`, and `_post`, joined by
  newlines. That produces `bin/v2/seadragon-pivot-standalone.js` (624 KB, 61 files, one IIFE). It then
  calls `node_modules/.bin/uglifyjs`. Uglify was not installed here, so the script printed its own error
  and **we serve the unminified build**, which also gives readable LoAF attributions. The script imports a
  sibling module, so under `python3 -I` it runs through runpy (the command is in `serve.sh`). README
  mentions `ajaxmin` (README.md:43). The Makefile and CHANGELOG say UglifyJS (`CHANGELOG.md:15`). The code
  uses UglifyJS.
- **Run:** a static page with `<div class="pivot_ajax_viewer" data-collection="collection.cxml">` plus
  the built JS and `PivotView.css` (and `search.gif`). On window `load` it calls `Pivot.init` and
  `CxmlLoader.load` (`PView:1159-1172`).
- **Ports and servers:** music **4360**, psychodeli **4361**, synth10k **4362**. Recipe:
  `.local/peer-study/seajax/serve.sh` (idempotent; `npx http-server -c 3600`;
  logs beside it). **Running now.**
- **Converter:** `scripts/peer-perf/convert-seajax.py` plus the host page
  `scripts/peer-perf/seajax-host.html`. Instances are in `<peer-study workspace>/instances/seajax/<corpus>/`.
  Authored copies (`index.html`, `collection.cxml`, `collection.dzc`) are in
  `.local/peer-study/seajax/<corpus>/`.
- **Driver:** `scripts/peer-perf/drivers/seajax.mjs`.

### What the converter writes

It writes the **faithful path**: CXML whose items point into a **Deep Zoom Collection**, with a
per-image DZI for zoom beyond the collection's MaxLevel. This is the original Silverlight data model. An
`img` template type (a plain image URL drawn on canvas) also exists (`PV:2494-2498`, quickstart
"img and color"), but it skips the whole deep-zoom machinery Part 4 asks about.

| Output | Format | Read by |
|---|---|---|
| `collection.cxml` | `<Items ImgBase="collection.dzc">`, each `<Item Img="#i">` | `PView`-side loader `v2/app/pivot/CxmlLoader.js:180-247` |
| `collection.dzc` | `MaxLevel=8 TileSize=256 Format=jpg`; `<I Id N Source="dzi/<k>.dzi">` | `img/DeepZoom.js:76-130` |
| `collection_files/L/c_r.jpg` | mosaic: 2^L px cells, (256/2^L)² per tile, Morton order | `img/DzcTileSource.js:86-107` |
| `dzi/<k>.dzi` + `_files` | per-image pyramid, 256 px tiles, overlap 1 | `img/DziTileSource.js`, via expansion `img/DzcTileSource.js:180-195` |

- **What maps:** title becomes Name. `text` becomes Description. Every `items.json` facet becomes a
  String facet (all three flags on). `year` becomes a **Number** facet "Year". `date` (psychodeli and
  synth10k) becomes a **DateTime** facet "Date". The image becomes the DZI plus the DZC cells, with sizes
  read from the JPEG.
- **What is lost:** palette, source, kind, projection.json and features.npy. PivotViewer has no
  similarity layout and no colour type. Href is also lost: no per-item page exists, so the details title
  is not a link.
- **One trap, found in code:** `#i` is the item's **position** in the DZC `<I>` list, not its `Id`
  (`img/DeepZoom.js:192-196`, `info = info[i]`). The converter keeps Id = N = position.
- **synth10k:** its 9,594 symlinked images resolve to 406 files. Each distinct file gets one DZI, shared
  through `Source=`, and its level-8 mosaic tile is written once and symlinked. Bytes served are unchanged.
- **Size:** music 258 MB (1,986 mosaic plus 26,243 DZI tiles); psychodeli 78 MB; synth10k 133 MB (13,238
  mosaic tiles; the CXML is 12 MB). Conversion took about 2 s, 20 s and 40 s.

## 2. Pipeline

```
data in    → CXML parsed by XHR into item objects; facets typed String/Number/DateTime/Link   (v2/app/pivot/CxmlLoader.js:180-247)
             each item's sdimg fetches the DZC once; addItems waits for every sdimg "load"     (PV:2626-2640, img/DeepZoom.js:243-281)
index      → none: items[] array; filters are an array of predicate closures                   (PV:208-222, PView:364-445)
layout     → sort by first value of one facet, then a square-ish grid fitted to the container  (PV:1108-1162, 948-976, 539-675)
             or "graph view": ≤12 buckets of the sort facet, each a bottom-up grid              (PV:1163-1331, 703-942)
render     → one 2D canvas at CSS resolution; per item, Seadragon2.Image.drawImage composites  (PV:1628-1697, img/Image.js:519-654)
             tiles from shared mosaic <img>s (DZC cell crop) or per-item DZI tiles; optional
             HTML front layer for "html" templates                                             (PV:991-1064)
interaction→ spring viewport (wheel/drag/click-to-zoom), keyboard arrows, details pane on      (v2/src/zoomcontainer/Viewer.js, PV:1753-1928, 1706-1723)
             zoom-in; every filter/sort/view change runs the staged rearrange                   (PV:1345-1370)
```

## 3. Part 4 answers

### Q1. Sort and filter choreography: staging, durations, how items leave and arrive

Every `filter()`, `sortBy()`, `gridView()` and `graphView()` calls `rearrange()` (`PV:2143-2180`). So
does `addItems` at load (`PV:2623`) and window resize (`PV:1941`). The choreography is a chain of steps
joined by the viewer's `animationfinish` event:

0. **Freeze and go home** (`PV:1345-1370`). Mouse tracking turns off (`innerTracker.setTracking(false)`,
   `:1347`). The viewport springs home (`viewport.goHome()`, `:1350`). The selection and highlights are
   cleared. **Any rearrange still in flight is abandoned** (`self.clearListeners("animationfinish")`,
   `:1366`). Part 1 waits for the home animation to finish. The zoom spring defaults to 1.5 s and the pan
   springs to 0.35 s (`v2/src/zoomcontainer/Spring.js:47-49`, `Viewport.js:86`). If the view is already
   home, a fake `animating = true` lets the next tick fire `animationfinish` (`:1358-1360`).
1. **Plan** (`rearrangePart1`, `PV:1066-1343`). The details pane is hidden (`:1070-1071`).
   `resetRearrangingItems()` (`:1077`) runs, which turns every in-flight item's *destination* into its
   new *source* (`:334-374`). **An interrupted animation therefore snaps to where it was going**, not to
   where it was on screen. The step snapshots `prevActiveItems` (`:1081`), runs the predicates (`:1084`),
   and computes every destination rect at home-zoom canvas coordinates (`:1108-1331`).
2. **Leave** (`rearrangePart2`, `PV:518-537`). Items filtered out get a destination off-screen from
   `getLocationOutside` (`:246-262`). That function takes the item centre relative to the container
   centre and scales it to length W+H, giving a 1.2× size and a radial "burst outward". It drops the
   container-centre offset when it builds the rect, so the burst is radial about the top-left origin
   rather than the centre *(code reading)*. The step waits for all of them.
3. **Move** (`rearrangePart3`, `PV:446-515`). Items in both the old and new sets animate from source to
   destination. An item can occupy several rects (graph view puts a multi-valued item in every bucket it
   belongs to, `PV:717-729`). In that case source and destination arrays are padded by duplicating entry
   0 (`:480-500`), so copies **split out of one place or merge into one**. The step waits.
4. **Arrive** (`rearrangePart4`, `PV:402-443`). Newcomers start at `getLocationOutside(destination)` and
   fly inward. The step waits.
5. **Finish** (`PV:386-399`): tracking back on, `finishedRearrange` fires (`PView:1143-1145` writes the
   hash there).

**Per-item timing** (`beginAnimate`, `PV:283-332`, and the rearranging branch of `updateOnce`,
`PV:1444-1539`):
- start time = `now + Math.random() * 300` ms per rect (`:305`): a uniform **0–300 ms random stagger**,
  not ordered by position.
- duration **700 ms** (`:1506`, `(now - start) / 700`).
- easing: a symmetric exponential ease-in-out with `stiffness = 8`, `k = 1 / (2(e^4 - 1))`. For p < 0.5
  the value is `(e^(8p) - 1)·k`, otherwise `1 - (e^(8(1-p)) - 1)·k` (`:112-113, 1513-1515`). x, y, width
  and height are interpolated linearly in that eased parameter (`:1518-1521`).
- So each stage lasts at most about **1.0 s**, and stages run **in sequence**. Remove → move → arrive is
  up to about 3.0 s after the home animation. The driver's functional check on psychodeli measured
  filter on 2.1 s (leave + move), filter off 2.0 s, graph↔grid 1.0 s (move only), and search on+off
  2.6 s (wall time with `finishedRearrange` waits, not a timed perf run).
- Draw order: stationary items first, moving items on top (`:1464-1533`). While rearranging, the viewport
  cannot move and the canvas is redrawn every frame (`:1444-1447`).
- `sdimg.update` is called with the **destination** size at the start of each move (`:319-326`). Tiles
  for the arrival resolution therefore start loading while the item is still flying.
- Input is ignored for the whole sequence (tracking off at `:1347` until `:388`). The UI also cannot
  start a second filter that the first would finish: a new `rearrange()` drops the old chain (`:1366`).

**What wunderkammer does instead:** one 220 ms FLIP, bounded to 64 nodes, with mid-flight capture
(`wall/layout-motion.mjs:3, 44, 60`). PivotViewer's staging is the "object constancy at any cost" end
of the axis: every item is tweened on the canvas each frame, and the user waits 2–3 s per filter.

### Q2. Deep Zoom Collection format, and how a collection-wide pyramid survives layout change

The DZC is **not a picture of the layout**. It is a layout-independent **texture atlas pyramid
addressed by item number**:

- `collection.dzc` lists items `<I Id N Source>` with their pixel size (`img/DeepZoom.js:76-130`).
  `MaxLevel` (8 here) is the highest level stored in shared tiles (`img/DzcTileSource.js:109-111`).
- At level L each item occupies a 2^L px cell, and a TileSize tile holds (TileSize/2^L)² cells. N is a
  Morton (z-order) index: even bits give the column and odd bits the row (`img/DzcTileSource.js:86-107`,
  `v2/src/utils/Math_morton.js` reverseMorton, plus the comment "DZC mortons are reversed"). The cell
  holds the item's own DZI level-L image at its top-left. The tile URL is
  `collection_files/L/<tileCol>_<tileRow>.jpg`, and the crop is
  `floor(scale·w) × floor(scale·h)` (`:96-105`).
- Each item is its own `DzcTileSource`. Drawing an item crops its cell from the shared tile `<img>` with
  `ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)` (`img/Image.js:612-621`). **Layout is entirely
  client-side** (dest rects, `PV:1630-1662`), so sorting, filtering and switching to graph view never
  touch the pyramid.
- Above MaxLevel the item **expands** to a per-item DZI named by `Source` (`img/DzcTileSource.js:113-135,
  140-195`). `ImageState.update` calls `expand()` when the needed level exceeds `dzcMaxLevel` and
  `contract()` when it drops back (`img/ImageState.js:259-279`). Pyramids are therefore **shared at the
  low end and per item at the high end**. That is the answer to the plan's "pyramids per layout unless
  per item".
- Level choice per item is `ceil(log2(max on-screen w, h) − blur + sharpen)`, clamped (`img/ImageState.js:259-271`).
- One tile `<img>` serves every item whose cell it holds. The loader keys by URL and fans out to all
  owners (`img/TileLoader.js:100-125`). Nominations are ranked by **summed on-screen area, then distance
  to centre, then lower level first** (`img/TileLoader.js:62-80`). Network caps are 6 per host and 30
  total (`img/Network.js:42-47`). The decoded-tile LRU holds **1,000 tiles by count, not bytes**
  (`img/TileLoader.js:44`, `img/TileCache.js`).
- New tiles blend in over 500 ms. Levels that fall out fade over 500 ms (`img/Image.js:111, 118`), and
  both are skipped when frames exceed 67 ms (`img/ImageState.js:106, 159`).
- Measured on our corpora: music needs 1 + 1 + 1 + 2 + 8 + 29 + 113 + 449 + 1,382 mosaic tiles for
  levels 0–8 (conversion log). At home zoom the boot fetched 581 image files for 1,793 items, 10 MB
  (smoke, headless, DPR 2).

**One finding that matters if we port any of this.** The viewer canvas is sized in CSS pixels
(`PView:63-64`, `PV:1936-1937`), with no devicePixelRatio scaling. The image level choice *does* add
log2(DPR) (`img/Image.js:96-97, 361`). On a DPR 2 screen it therefore fetches tiles one level sharper
than the canvas can show. Smoke at DPR 2 measured boot image completion at 12.0 s for music and 40.3 s
for synth10k. A DPR 1 check of the same pages showed every item fully drawn at 1.1 s and 4.9 s. Tile
requests were not network-bound (median 1.6 ms each); they were *issued* slowly, at about 25–40 per
second. **Why the issue rate is that low is not established.**

### Q3. Facet panel semantics: numeric histograms, string facets, counts

- **Logic:** OR within a facet (`values.some`) and AND across facets (`filters.every`) (`PView:380-392`,
  `PV:216-218`). A missing facet value matches the synthetic "(no info)" value (`PView:388-389`).
- **Counts:** shown **only for the open facet** (accordion, one open at a time; `PView:555-655`). They are
  computed over items passing **every filter except this facet's own** (`viewer.runFiltersWithout`,
  `PV:2777-2786`, `PView:573`). This is disjunctive faceting: you can see what adding another value
  would give. Counts refresh when a facet is (re)opened or `refreshFilterPane` runs (`PView:657-664`).
  Each refresh is a full rescan.
- **String facets:** a checkbox list with a count per value. The sort cycles through a custom CXML
  `SortOrder` if present, then **Quantity**, then **A-Z** (`PView:1089-1110`, `PV:2253-2283`). Clicking
  a *label* selects only that value; clicking a *checkbox* toggles it (`PView:449-504`).
- **Number facets:** a mini histogram of **11 equal-width bars** (`v2/app/pivot/NumberPicker.js:84`)
  over min..max, with a two-handle range slider snapped to a power-of-ten step. The filter applies only
  **on release** (`:255-266`) and is inclusive at both ends. **Inconsistency:** the histogram and range
  use only an item's **first** value (`NumberPicker.js:72, 109`). The filter matches **any** value
  (`PView:398-409`), and the graph view buckets **all** values (`PV:836-845, 923-931`). For a
  multi-valued number, the bars, the filter and the graph disagree.
- **DateTime facets:** no slider. A checkbox list of buckets at two granularities: the auto-chosen scale
  (decades, years, months … seconds; `v2/app/pivot/Date.js:57-100`) plus the next finer scale
  (`DatePicker.js:67-71`), each with a count.
- **Search box ("word wheel"):** each keyup scans the name and every facet value of every item for a
  substring, then lists the top 10 by count with prefix matches first (`PV:2811-2855`,
  `PView:810-838, 870-893`). Enter filters on items whose name or word-wheel facet contains every
  space-separated term (`PView:679-707`). Descriptions are never searched.
- **Graph view = facet histogram of items** (`PV:703-942, 1163-1331`). For strings, buckets are values,
  and more than 12 are merged into ranges labelled "A to C" (`:756-794`). For numbers, the bucket width
  is a friendly 1/2.5/5×10^n of (max−min)/4 (`:679-684, 851-875`). Dates use the same bucketing as the
  date picker (`:847-849`). Every graph view carries a "(no info)" bucket. **Clicking a bar asks for a
  filter on it** (`filterrequest`, `PV:1828-1834`, `PView:771-790`). A single-string-value bar also
  flips back to grid.
- **Details pane:** facet values are clickable filters (`PView:215-226`).

## 4. Part 1 corrections

| Row (Part 1) | Status | Evidence |
|---|---|---|
| 1.1 Canvas 2D: "seajax PivotViewer" | **Confirmed**, with nuance: the canvas carries tiles; an optional HTML front layer carries "html" templates at higher zoom | `PV:1977-1997`, `PV:991-1064` |
| 1.1 Canvas 2D "against: no instancing" | Confirmed. Plus: **no DPR scaling of the canvas** while levels are picked for DPR | `PView:63-64`, `img/Image.js:96-97, 361` |
| 1.2 Tile pyramid / DZC: "pyramids per layout unless per item" | **Correct the wording.** DZC is a Morton-addressed atlas pyramid, shared below MaxLevel and per-item DZI above; layout never invalidates it | `img/DzcTileSource.js:86-195` |
| 1.2 "Heavy preprocessing" | Confirmed, and **no preprocessing ships in the repo** (it assumes the Windows tools); our converter is 230 lines of Python | `convert-seajax.py` |
| 1.3 Plain JS predicate over arrays | **Add PivotViewer here.** Closures, a full rescan per filter, counts by a second rescan | `PV:208-222, 2777-2786` |
| 1.4 Timeline / histogram stacks: PivotViewer | Confirmed (graph view on any facet, dates included) | `PV:1163-1331` |
| 1.4 Animated transitions: PivotViewer | Confirmed: 3-stage, 0–300 ms stagger, 700 ms each, input blocked | §3 Q1 |
| 1.5 Static site + data files | **Add PivotViewer** (CXML + DZC + DZI, any static host) | `PView:1159-1172` |
| 1.5 URL-encoded view state | **Add PivotViewer (partial):** hash carries filters, search, sort and view, but not zoom or the selected item | `PView:915-962, 1143-1145` |

## 5. Part 2 column (PivotViewer)

| Capability | PivotViewer | Evidence |
|---|---|---|
| Survey: whole collection at once | **yes** (home view fits every filtered item) | `PV:1141-1159` |
| Continuous pan/zoom | **yes** (spring viewport; wheel = 2^(1/3) per event, sign only) | `Viewer.js:99, 336-340`, `utils/Mouse.js:62-80` |
| Semantic zoom | **partial**: template levels per zoom (color → img → html), DZI sharpening, details pane when an item fills half the view; the CXML path changes resolution only | `PV:991-1064, 1618-1645` |
| Facets, multi-valued, OR within / AND across | **yes** | `PView:380-392`, `PV:216-218` |
| Facet counts that react to scope | **partial** (open facet only, excluding its own filter) | `PView:573` |
| Numeric range filters | **yes** (11-bin histogram + slider; first value only) | `NumberPicker.js` |
| Free-text search | **yes** (substring over name + facet values, word wheel) | `PV:2811-2855` |
| Semantic / embedding search | **no** | |
| Find without changing scope | **partial**: `setCenterItem(id)` API and keyboard arrows fly to items; the search box always filters | `PV:2084-2100, 1880-1928` |
| Group by facet as territory | **partial**: graph view columns, ≤12 merged buckets, one facet | `PV:756-794` |
| Sort within groups; lens/brush | **partial**: one sort facet in grid; no order inside graph bars; no lens | `PV:1114-1136` |
| Timeline layout | **partial** (graph view of a DateTime facet) | `PV:847-849` |
| Similarity layout | **no** | |
| Geographic layout | **no** | |
| Piles | **no** | |
| Animated layout transitions | **yes** (staged) | §3 Q1 |
| Rich detail view | **partial**: name, description (more/less), clickable facet values, copyright link; no media | `PView:125-246` |
| Reading traversal | **yes** (pane arrows, keyboard arrows over grid neighbours) | `PV:607-631, 2065-2077` |
| Selection of a subset; export | **no** (one selected item) | |
| Shareable URL of the exact view | **partial** (no zoom or selection) | `PView:915-962` |
| Keyboard and screen-reader access | **partial / no**: arrows only; canvas content has no ARIA or roles (grep finds none) | |
| Live corpus | **partial**: `addItems` updates, `clearItems`; every update forces a full rearrange | `PV:2594-2674, 2728-2733` |
| No-server deployment | **yes** | |
| Embeddable component / API | **yes**: `Pivot.init(div)`, `setFacets`, `setTemplates`, `addItems`, events | quickstart, `PV:27-59` |
| Preprocessing pipeline included | **no** (DZC/DZI tools external; the "fakehtml" path posts to a server renderer) | `PV:2386-2466` |
| Documented scale | none in repo. **Measured:** 10,000 items boot and lay out; boot images 40.3 s headless DPR 2 (4.9 s at DPR 1) | smoke |

The tool's own UI greys (`#888`, `gray`, links `#36a3d8` on white; `PivotView.css:32, 142, 234`) are
far below wunderkammer's 8:1 floor. We did not restyle the peer.

## 6. Part 3 scores

- **Competitive / market research wall: 2 of 5.** It has the right core: facets with OR/AND, typed
  numbers and dates, histogram-as-layout, click-a-bar-to-filter, and click-to-zoom detail. It cannot
  capture, cannot take live edits without a full 2–3 s rearrange per update (`PV:2617-2623`; the
  quickstart warns about this), has no media in detail, and relies on Windows-era preprocessing.
- **LLM-communicated collection: 3 of 5 on spec, 1 of 5 on packaging.** CXML is a small declarative
  spec an agent can emit: a facet list with types and flags, items with facets. `setFacets` and
  `addItems` are an even smaller JSON API (quickstart "Option 2"). Two things undo it. The image side
  needs a DZC preprocessor, or else `img` templates, which skip deep zoom. And there are no selection
  callbacks beyond `showDetails` (`PV:42-44`), so there is no subset selection to hand back.
  Templates evaluate `<? ?>` code from the data, a trivial XSS that the quickstart admits; that rules
  out agent-supplied templates in an artifact.

## 7. Technique candidates

| Technique | Source | Grade | Wunderkammer file | Metric it should move | perf-budgets key |
|---|---|---|---|---|---|
| Separate leave / move / arrive phases, with radial off-screen exit and entry for items crossing a scope boundary (ties to the TODO "Place-preserving filters and Gather" and object constancy) | `PV:246-262, 402-537` | **idea** (borrow the phase separation and the radial exit only, keep 220 ms and the bounded FLIP) | `wall/layout-motion.mjs` | filter on/off: object constancy without longer INP | `scenarios.flat filter on.inpMs` |
| Uniform 0–300 ms random per-item stagger on a 700 ms exp ease (k = 8) | `PV:112-113, 305, 1506-1515` | **rule out** as specified: the total is about 1 s per phase, three phases in sequence, and input is blocked throughout (`:1347/:388`); wunderkammer budgets filter INP in the low hundreds of ms | — | — | `scenarios.flat filter on.framesOver33` |
| Snap in-flight items to their destination when a new rearrange interrupts | `PV:1077, 334-374, 1366` | **rule out**: wunderkammer's `captureLayoutMotion` already samples mid-flight transforms, which is better | — | — | — |
| Morton-ordered power-of-two cells, so one pyramid serves every overview tier (cell 2^L px at level L) and a tier is a crop of a shared tile (ties to the TODO "3D far tier from the 64 px sheet" and "Zoom-out max frame with sheets") | `img/DzcTileSource.js:86-107`, `utils/Math_morton.js` | **port** (about 20 lines of addressing; credit seajax) | `lib/sheets.mjs`, `wall/overview-sheets.mjs` | sheet pages per tier; boot images; zoom-out max frame | `scenarios.boot.imagesMs.max`, `scenarios.flat zoom out.framesMax.max` |
| Shared atlas below a threshold, per-item pyramid above it, switched per item by on-screen level (`expand`/`contract`) | `img/DzcTileSource.js:113-195`, `img/ImageState.js:259-279` | **idea**: matches wunderkammer's sheets → per-item `srcset`; confirms the split, and the per-item threshold is its size on screen | `wall/image-work.mjs` | boot images; filter-on script (the TODO "Filter on now loads the files it needs") | `scenarios.boot.imagesMs.max` |
| Request priority = summed on-screen area of all items wanting a URL, then distance to centre, then lower level | `img/TileLoader.js:62-80, 211-235` | **port** | `wall/image-work.mjs` | time to all-visible after filter or zoom | `scenarios.boot.imagesMs.max` |
| Show the detail pane from the zoom **target**, not the current frame | `PV:1638-1645` | **idea** (ties to the TODO "Detail close INP ~170–208 ms": decide pane state at gesture start, animate after) | `wall/detail-pane.mjs` | detail open/close INP | `scenarios.detail open.inpMs.max`, `scenarios.detail close.inpMs.max` |
| Disjunctive counts: count a facet over all filters except its own | `PV:2777-2786`, `PView:573` | **idea** (check wunderkammer's share-fill does the same; if not, adopt) | `wall/wall.mjs` (rail) | correctness, not latency | — |
| Numeric facet = 11-bin mini histogram + range slider, filtering on release (fills wunderkammer's "Numeric range filters: no") | `v2/app/pivot/NumberPicker.js:84-127, 255-266` | **port**, but use **all** values in bins, not the first value (`:72, 109`), or bins and filter disagree | `wall/wall.mjs`, `wall/attributes.mjs` | new capability; filter latency on release only | `scenarios.flat filter on.inpMs` |
| Histogram layout of items by any facet, bars clickable to filter (fills wunderkammer's "Timeline layout: no") | `PV:703-942, 1163-1331, 1828-1834` | **idea** (wunderkammer's grouped territory plus a date bucket axis) | `wall/layout.mjs` | new capability | `scenarios.flat group →.scriptMs` |
| Stop drawing once every item reports fully drawn (anythingChanged gate) | `PV:1549-1551, 1657-1662`, `img/Image.js:654` | **idea**: wunderkammer's overview surface could stop its loop the same way; seajax still runs an empty rAF loop forever (`PV:2027, 1737`) | `wall/overview-surface.mjs` | idle script | `scenarios.flat idle 1s.scriptMs` |
| Canvas at CSS resolution while tiles are fetched for DPR | `PView:63-64`, `img/Image.js:96-97, 361` | **rule out** (anti-pattern: pays for twice the pixels and shows half; measured 12 s vs 1.1 s to fully drawn at DPR 2 vs 1 on music) | — | — | — |
| LRU of decoded tiles by count (1,000) | `img/TileLoader.js:44` | **rule out**: memory must be budgeted in bytes (ties to the TODO "Whole page blinks during zoom under GPU memory pressure" and "Atlas upload/decoded-memory budget") | — | — | — |
| Fixed 6-per-host / 30-total request caps | `img/Network.js:42-47` | **rule out**: an HTTP/1-era constant, and the browser schedules better | — | — | — |

## 8. Smoke test and driver

- `node scripts/peer-perf/peer-perf.mjs --driver seajax --label <corpus> --scenarios idle,pan` passed on
  all three corpora with no page errors. Output is in `.local/peer-study/perf/smoke/*-seajax-*.json`.
  These are smoke numbers only, not the study's timed runs:

| Corpus | Ready | Images shown | Image requests | Pan p95 / max |
|---|---|---|---|---|
| music | 1,151 ms | 12.0 s | 581 (10.0 MB) | 9.2 / 175 ms |
| psychodeli | 1,053 ms | ~0 ms after ready | 530 (5.5 MB) | 9.4 / 109 ms |
| synth10k | 1,360 ms | 40.3 s | 838 (11.5 MB) | 17.1 / 268 ms |

- A one-off functional pass (not timed) exercised every gesture on psychodeli: pan, zoomIn, zoomOut,
  filterOn, filterOff, search, layoutSwitch, layoutBack, detailOpen, detailClose and gpuGesture. All
  succeeded.
- **ready** means a rearrange that drew items has finished. The first `finishedRearrange` runs on the
  empty collection (facetsSet → sortBy) before the DZC loads. The probe's `populated` flag skips it.
- **imagesShown** means the last tick that drew anything drew every item with `drawImage` returning
  true: target level reached, nothing loading, blending or fading (`img/Image.js:519-654`,
  `PV:1657-1662`). It is read through a read-only probe in the host page: a wrapper on
  `Seadragon2.Image.drawImage`, installed before construction because `PV:142` captures the function,
  plus one Timer callback per tick.
- **Gesture differences from wunderkammer:**
  - pan jumps without animation to 4× before dragging, because home zoom is constrained (`PV:1980-1983`).
  - filter, search and layout gestures wait for `finishedRearrange`, so the measurement covers the
    whole choreography.
  - detail close is "click the selected item again", which goes home (`PV:1835-1838`).
  - layoutSwitch is graph view of the default sort facet. That facet is the first CXML facet: `artist`
    for music, `year` (string) for psychodeli and synth10k.

## 9. Surprises, and what is not established

- **Licence:** BSD-2, not BSD-3.
- **Interrupt behaviour:** a filter during a rearrange snaps moving items to their destinations, then
  restarts the choreography.
- **Numeric facets disagree with themselves for multi-valued numbers:** bars use the first value, the
  filter matches any value, and the graph view buckets all values.
- **Not established:** why the tile *issue* rate is about 25–40 per second at DPR 2. Requests completed
  in about 1.6 ms, so it is not the network. The candidate is per-item level progression through
  blending in ImageState *(inferred, not verified)*.
- **Not established:** whether the original Silverlight PivotViewer staged identically. This study read
  only the JS clone.
- **CDP node count at boot:** 4,092 for music and 20,272 for synth10k, against 1,553 for psychodeli at
  the same phase. Most likely the retained CXML `responseXML` document *(inferred)*.
