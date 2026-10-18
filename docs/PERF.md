# Performance: the envelope, the pass, and where the hybrid earns its keep

Status, 2026-10-13: an instrumentation suite (in-app probe, scenario harness,
budgets, scale sweep) and the first audit against it are below, preceded by
the fixes for the audit's first finding (the overview flush) and eighth
(boot images, via baked overview sheets). Older sections are kept as the
historical record.

Status, 2026-09-20: the six spatial interaction directions are implemented;
uniformly smooth dense transitions are not established. Stable reader geometry,
reversible approach/return, bounded animation and image queues, and the flat
overview picture are described in [SMOOTH_SPATIAL.md](SMOOTH_SPATIAL.md).

## Overview sheets: boot images 4.6 s → 0.1 s (2026-10-13)

**Problem.** HTTP caching already worked: on a warm reload 1,659 of the Music
Atlas's 1,667 cover requests came from the browser cache. Showing every image
still took 4.8–6.4 s warm and 5.7–8.3 s cold, because the overview needed one
request and one decode per cover. Caching saves bytes; it does not save
decodes.

**Lesson taken from Scrutinizer's mip chain** ([explainer](https://andyed.github.io/scrutinizer-www/blog/mip-chain-explainer.html)):
keep every level in one texture and choose the level per pixel. The flat
overview now does the same with a few baked pages instead of 1,800 files.

**What was built.**

| Part | Where | What it does |
|---|---|---|
| Baker | `scripts/sheets.py` (run by both indexers, or alone) | Packs every cover at 32, 64 and 128 px into 2048-px WebP pages with 2-px edge-replicated gutters; pages are named by their SHA-256 and served `immutable`; `sheets.json` maps cover hash → (page, x, y, w, h) per level |
| Server | `lib/sheets.mjs`, adapters, `serve.mjs` | Each clip carries `sheetSlots`; `/api/clips` interns the pages into one `sheets` list. Slots stay out of the corpus revision, so a rebake does not change saved permalinks |
| Client | `wall/overview-sheets.mjs` | Fetches pages and decodes them off-thread (`createImageBitmap`), coarsest level first; a larger level only when a draw needs it and the decoded total stays under 16 Mpx |
| Overview | `wall/overview-surface.mjs` | Baked slots are a second slot source beside the runtime atlas: a tile draws with no DOM image at all, and a sharp-enough baked slot is preferred over copying the DOM image |
| Wall | `wall/wall.mjs` `revealTiles` | Leaves a tile's `<img>` unloaded while the overview would show it and a baked level holds it at ≤ 2× upsampling. Zooming to the reading tier loads files through the existing warming handoff; a failed level withdraws its cover and the tiles load their files |

Per-file variants stay for the reading tiers. The Music Atlas bakes 1,667
covers into 1 + 2 + 8 pages (8.1 MB) in 4 s; the client uses the 32 and 64 px
levels (3 requests, 3.1 MB, 10 Mpx decoded).

**Metric change.** `imagesMs` used to wait for every visible `<img>` to
decode. A tile now counts as shown when its `<img>` decoded *or* the overview
painted it (`.overview-painted`, set only once pixels exist at the current
pose). The baseline below was re-measured with the new definition. Boot rows
also record image requests by route, and `--warm` measures a boot against a
primed cache.

**Result, boot** (headed Chrome, 1440×900 @2×, Music Atlas, 3 runs each, time
from ready to all 1,803 images shown):

| | before (`39d5e9c` client) | after (`40dee33`) |
|---|---:|---:|
| cold | 5,659–8,317 ms · 1,667 file requests | 108–210 ms · 3 sheets + 8 files |
| warm | 4,848–6,409 ms · 1,667 requests, 1,659 cached | 210–231 ms · 3 sheets + 16 files |

Budget: 3,000 ms. The 8 files are covers without a baked slot (the warm run also lists the 8 its priming load cached).

**Paired gate, everything else** (headed, cold, median of 3; HEAD `52b68e7`,
which already has the runtime atlas, vs this work on the same machine and
instance):

| Scenario | HEAD | sheets |
|---|---:|---:|
| session retained nodes (budget 2,000) | 4,196 | 1,198 |
| zoom out script | 73 ms | 52 ms |
| zoom out frame p95 / max | 43 / 133 ms | 43 / 209 ms |
| filter on INP / input block | 328 / 69 ms | 248 / 67 ms |
| filter on script | 81 ms | 150 ms |
| search clear frame p95 | 41 ms | 10 ms |
| pan, zoom in, detail open/walk/close, search type | — | within noise |

Three regressions in the first sheets build were found by this pairing and
fixed: (1) zoom-out repainted the whole overview every tick (50 paints vs 2),
because a newly exposed tile had no decoded `<img>` to show under the
transformed picture; a tile the sheets hold now shows its dominant-colour
placeholder for the rest of the gesture and is painted at rest. (2) 4096-px
pages are one GPU texture each, uploaded whole on first draw and after
eviction; 2048-px pages took zoom-out p95 from 83 to 43 ms. (3) A handoff
assigned `src` to every unloaded `<img>` in one handler (chip-hover brush
57 ms); it now starts 128 per frame (21–27 ms, HEAD 20–27 ms). The 128 px
level is excluded by the 16 Mpx budget: admitting it doubled filter-on input
delay through first-use uploads, and it only serves tiles 128–192 device px
wide, where the tile's own file is cheap.

**Open.** Zoom-out max frame 183–266 ms vs HEAD 127–150 ms, a GPU frame with
no script. Filter on now pays for the files it needs (a scoped view leaves the
overview range, and those `<img>`s were not loaded at boot): script 81 → 150
ms, with INP and p95 better.

**Scale sweep** (`npm run perf:scale`, headless, one run per size; sheets are
baked per instance with a distinct digest per copy, so page count and decoded
pixels grow with n):

| n | sheet pages (32 / 64 / 128) | images shown after ready | pan p95 | zoom in / out script | filter render |
|---:|---|---:|---:|---:|---:|
| 2,000 | 1 / 3 / 9 | 119 ms | 9.8 ms | 164 / 288 ms | 49 ms |
| 5,000 | 2 / 6 / 23 | 8 ms | 9.8 ms | 83 / 173 ms | 110 ms |
| 10,000 | 4 / 12 / 45 | 16 ms | 16.1 ms | 218 / 1,138 ms | 237 ms |
| 25,000 | 8 / 28 / 111 | 1,543 ms | 58.1 ms | 1,072 / 924 ms | 626 ms |

Paired headless HEAD at 10,000: pan p95 40.9 ms, zoom in / out 381 / 760 ms,
filter render 288 ms; at 2,000: zoom in / out 38 / 51 ms. The audit's 25,000
run never finished its images (2,696 decoded in 30 s); it now finishes in
1.5 s. Single headless runs are noisy here: a repeat at 2,000 measured zoom
out at 69 ms with all 76 moving ticks on the composite path (the
`overview/moving-*` counters). Zoom at 10,000 is still over budget either way;
the DOM wall, not the overview, is the limit there (finding 4 and the scale
ceiling item in TODO).

### The 3D view: what the mip lesson says there

**Far atlas.** The 3D far tier loads one 64 px image per item (1,793 requests
on the Music Atlas) into 64-px slots. The 64 px sheet level holds exactly those
pixels in 2–3 pages. The field already reaches full residency in ~1.3 s and
meets its budgets, so the gain is requests and decodes, not a failing budget.
The hook exists without touching the vendored lib: `AtlasPair` accepts a
synchronous `resolveSource(index, tier)`, which `spatial-view.mjs` uses for
near-tier card captures and could use for far tiles cropped from a decoded
sheet. Its shared `sourceDrawsPerPump` cap (16, sized for card captures)
would make that slower than today, ~112 frames for 1,793 tiles. Recommended
upstream change in muriel: a per-tier cap, or a `blit(index, tier, source,
sx, sy, sw, sh)` that takes a sub-rectangle, so a sheet fills the far tier in
a few frames. Not implemented in this pass.

**Near tier: choose by visible on-screen size, not distance.** Measured at the
Music Atlas's 3D overview (pile layout, headed): the 256 near slots are all
held, but only 51 of them are on the 73 cards visible on pile faces; 22
visible face cards (116–364 device px) draw from 64 px far tiles, upsampled
2–6×, while 205 near slots go to cards buried inside the stacks. Distance is
the wrong key because the stack cards behind a face are as near as the face.
Scrutinizer's rule (pick the level each pixel needs) translates to ranking
near candidates by visible projected size: face cards and spread cards first,
occluded stack members last. That is a change to `instanced.js`
(`TileField.update`), so it belongs upstream in muriel.

## Finding 1 fixed: overview atlas and warming handoff (2026-10-13)

**Mechanism, measured.** The audit's reading (Chrome uploading and
rasterising ~1,800 small images in one flush) holds, with one correction:
image size is not the cost. At Fit the DOM covers are 18–36 px (a few 128 px
after a zoom). Three probes inside the real `_paint`, each run through the
harness:

| Variant of `_paint` | detail close script |
|---|---:|
| as committed | 416 ms |
| no `roundRect` clip | 398 ms |
| no background `fillRect` | 399 ms |
| neither | ~400 ms |

So neither the clip nor the fill is the cost. The cost is per distinct
source: ~0.06 ms per `<img>` per flush, ~100 ms per dirty repaint of the
Music Atlas. A painted tile's `<img>` is `visibility: hidden`, so Chrome keeps
no GPU copy of it, and every repaint uploads every cover again. The same draw
loop over *visible* `<img>`s flushes in ~20 ms. The cost surfaces as `fillRect`
self time only because that is the call that trips the flush.

**Fix.** `wall/overview-atlas.mjs` copies each source once, while its pixels
are decoded, into shelf-packed 1024-px pages. Slots are sized to the drawn
size (next power of two, capped at 128 px) and re-copied only when they would
upsample by more than 2×. Copies are capped per frame (160), because their cost
lands at flush, after any elapsed-time check has already passed. A repaint now
draws from a few resident textures: ~5 ms for the whole Music Atlas.

**What the old cost was also doing.** Re-uploading every hidden `<img>` on each
repaint kept them warm. With the atlas they go cold, and the first version made
filter on worse: INP 272 → 708–768 ms, a 500 ms frame when ~1,700 hidden
`<img>`s were shown at once. To confirm, drawing the hidden `<img>`s into a
scratch canvas just before the click brought it back to 336 ms. Four changes
handle the hand-back to the DOM:

- The overview stays on through a layout change. Only the ≤64 cards in layout
  motion go to the DOM (`setDomOnly`); before, the whole overview switched off
  for 250 ms.
- `setTiles` no longer unhides every tile before the next paint.
- An atlas-only repaint gets a 12 ms slice, so it finishes in one frame. A tile
  left for a later slice would show its cold `<img>` in the meantime.
- **Warming handoff.** When tiles must go back to the DOM (leaving the
  overview range, or a lens), the canvas keeps covering them. Each frame it
  draws 64 of their own `<img>`s (one unclipped draw at native size, under the
  atlas copy), then reveals all loaded tiles together. Revealing in batches
  re-rasterised the whole tile layer each frame (~100 ms per frame).

The 3D view disables the overview abruptly (`gradual: false`), because the flat
stage is hidden and nothing will be rasterised.

**Before → after.** Paired runs at the same time and on the same server code:
`2fe99ae` (HEAD, served from a worktree) vs this change. Headed Chrome,
1440×900 at 2×, Music Atlas, median [range] of 3 fresh-context runs.
Summaries: `.local/perf/*head-2fe99ae-summary.json`,
`*overview-fix-final-summary.json`.

| Scenario | Metric | Before | After |
|---|---|---:|---:|
| flat zoom out | script ms | 365 [363–475] | 52 [48–79] |
| | frame p95 ms | 75 [58–85] | 42 [33–50] |
| | longest task ms | 147 [140–185] | 79 [61–117] |
| | LoAF blocking ms | 235 [139–301] | 0 [0–0] |
| detail close | script ms | 255 [253–326] | 15 [14–16] |
| | frame p95 ms | 132 [51–133] | 17 [16–33] |
| | longest task ms | 133 [132–134] | 0 [0–0] |
| | INP ms | 184 [168–368] | 208 [168–208] (overlaps) |
| search type | script ms | 449 [436–516] | 134 [133–137] |
| | INP ms | 352 [336–360] | 144 [120–160] |
| | input delay ms | 140 [61–140] | 0.5 [0.3–0.6] |
| search clear | INP ms | 168 [168–168] | 144 [144–152] |
| flat filter on | INP ms | 296 [288–304] | **328 [320–344]** |
| | frame max ms | 183 [175–183] | **366 [192–368]** |
| boot | script ms | 27 [27–28] | 50 [46–52] (atlas copies) |
| budgets | pass / fail | 41 / 23 | 45 / 19 |

Against the audit baseline (`ddaca97`, before other commits landed), the three
target rows move as follows. Zoom out: script 538 → 52 ms, p95 85 → 42 ms.
Detail close: script 390 → 15 ms. Search type: script 545 → 134 ms, INP
360 → 144 ms. All have non-overlapping ranges, except detail close INP. That
INP is not script (its longest task is now 0 ms) and is a separate
presentation cost.

**Not fixed: filter on.** The hand-back now reveals in one cheap frame, but a
~360 ms frame follows 3–4 frames later, spent in the GPU process
(`SkiaOutputSurfaceImplOnGpu::SwapBuffers → ScheduleOverlays`, waiting on
`IOSurfaceImageBacking::WaitForCommandsToBeScheduled`). Two explanations were
tested and refuted. OffscreenCanvas atlas pages change nothing. Holding srcset
upgrades until the handoff ends changes nothing (360 and 475 ms). Net effect:
+32 ms INP and one long frame, against −208 ms INP on search typing and a zoom
out without long tasks. Filter off and group changes are unchanged.

## Findings 2, 3, 6 (part) and 7 fixed: four small costs (2026-10-13)

Four commits on `perf/small-audit-fixes`, plus one harness fix. **Paired
runs**: `52b68e7` (base, a detached worktree on ports 4178/4179) against the
branch (4176/4177), same server configs, same hour, both arms driven by the
branch's `scripts/perf.mjs`. Headed Chrome, 1440×900 at 2×, median [range].
Summaries: `.local/perf/*small4-{base,fix}-{music,psy}-summary.json` (full
session, 3 runs, `--check`), `*small4i-*` (interact only, 5 runs),
`*small4s-*` (spatial only, 5 runs).

| Fix | Mechanism | Direct evidence |
|---|---|---|
| Scope bar refit (finding 3) | `renderScope()` shows the bar before `render()` measures, so the stage `ResizeObserver`'s `fitWall()` repeated an identical layout. It now skips when the stage size equals the size the last render measured. | Music, one scoped filter: `render` 2 → 1, `resize/stage` 15 → 0 ms |
| Search coalescing (finding 2) | The `input` handler schedules one frame; the frame reads the latest value, keeps the `rememberScope` / `contextBase` rules, and does nothing if a restore already set the query. | Music, three keys back to back: `filter` 3 → 1 (160 → 75 ms), `render` 4 → 1 |
| `syncOverview` rect (finding 6) | Stage width and height are cached; `render()` seeds the cache from the bounds it already measures and the stage `ResizeObserver` clears it. | Boot: the first sync no longer forces the initial layout (`overview/sync` 86 → 0 ms, `render` 140 → 54 ms of script) |
| 3D idle (finding 7) | Two causes, neither the frame loop's checks. (a) The settled branch tested `field.flush() \|\| field.takeDirty()`; an upload also marks the field dirty, so the short circuit drew the same pixels again next frame: two renders per upload. (b) The permalink poller ran `document.querySelector('.dragging, .detail-resizing')` every 120 ms over ~9,600 nodes with the 3D cards mounted; it now checks `#stage` and `<body>` directly. | (a) Psychodeli, a trailing far upload: 2 renders → 1. (b) Music 3D idle, in-page: 17 scans = 10 ms per 2 s → 0 |

**Idle profile, Music Atlas 3D, base.** Of ~32 ms script per 2 s: permalink
poller ~18 ms (`querySelector` 9.4, `captureView` 2.9, `canonical` of a
155 KB view 3.3), frame loop ~7 ms of which most is the probe's and the
harness's own `atlas.flush` wrappers, the frame body itself ~1 ms. With no
`?perf` and no harness hooks the field renders 0 times in 2 s on both atlases.

**Harness fix.** `waitAtlas` returned once nothing was queued or in flight,
while up to ~126 drawn far slots could still wait on the 120 ms upload
throttle. That upload and its render then landed in `spatial idle 2s`: the
audit's "2 idle renders on the Psychodeli Atlas" was this plus cause (a). It
now also waits for `pendingUpload` to clear. Both arms below use it.

| Instance | Scenario | Metric | Audit (`ddaca97`) | Base (`52b68e7`) | Branch |
|---|---|---|---:|---:|---:|
| Music | flat filter on | script ms | 69.6 [66.9–73] | 84.9 [82.1–90.4] | **70.9 [67.4–76.4]** |
| | | INP ms | 232 [232–672] | 416 [344–424] | 320 [312–408] |
| | flat filter off | script ms | 49.7 [47–50.3] | 56.2 [53.1–58.3] | **51.1 [49.8–51.8]** |
| | | INP ms | 160 [160–408] | 336 [224–352] | 184 [168–352] |
| | search type (3 keys) | script ms | 545 [533–552] | 132.6 [129.1–139] | 128.8 [125.1–128.9] |
| | | INP ms | 360 [352–360] | 128 [120–160] | 144 [136–224] |
| | — interact only, 5 runs | INP ms | | 176 [168–192] | **128 [120–136]** |
| | | script ms | | 154.9 [146.1–155.8] | **129.7 [127–134.4]** |
| | flat pan | script ms | 56.9 [53.2–57.2] | 47.9 [46.8–54.7] | **41.2 [40.8–43.6]** |
| | flat zoom in | script ms | 37.4 [36.6–39.3] | 37.9 [36.5–38.1] | **29.9 [29.8–31.1]** |
| | spatial idle 2s (5 runs) | script ms | 56.9 [54.9–58] | 29.6 [28.5–58.3] | **23.6 [22.1–24.1]** |
| | | renders | 0 | 0 | 0 |
| | budgets | pass / fail | 40 / 23 | 46 / 18 | 46 / 18 |
| Psychodeli | flat filter on | script ms | 25.8 [24–28] | 21.5 [21–22.8] | 20 [19.4–20.5] |
| | | frames > 33 ms | 2 [2–4] | 2 [1–2] | 1 [1–2] |
| | flat filter off | script ms | 20.8 [15.5–21.2] | 15.5 [15.1–17.5] | 15.2 [14.9–21.2] |
| | search type (3 keys) | INP ms | 80 [72–88] | 64 [56–64] | 96 [72–104] |
| | — interact only, 5 runs | INP ms | | 72 [72–80] | **56 [56–64]** |
| | spatial idle 2s (5 runs) | script ms | 27.9 [24.5–28.8] | 16.6 [16.1–31.3] | 22.2 [15.4–25.8] |
| | | renders | 2 [0–2] | 0 | 0 |
| | budgets | pass / fail | 55 / 8 | 59 / 5 | **61 / 3** |

Bold: ranges do not overlap with base. Reading it:

- **Filter on/off** (Music): script down 14 and 5 ms with separated ranges,
  from the removed second render. INP medians drop 96 and 152 ms, but the
  ranges overlap; the remaining filter-on cost is the GPU frame described
  under "Not fixed: filter on" above and the restyle in finding 4.
- **Search typing** at the harness's 180 ms key spacing gives each key its
  own frame anyway, so coalescing changes little there. Its win is keys
  closer than a frame (3 filters → 1). INP disagrees between the two
  designs: the interact-only runs improve on both atlases with separated
  ranges, the full sessions are flat (Music) or worse (Psychodeli, 64 → 96).
  The full-session worst interaction is the `pointerdown` that focuses the
  box 3 ms before the first key, so the first filter's frame is charged to
  it. Treat search INP as unresolved, not as a win.
- **Pan and zoom script** (Music) fell 7–8 ms with separated ranges: the
  cached stage size removed the per-frame forced layout in `syncOverview`.
- **3D idle**: Music 29.6 → 23.6 ms with every branch run below every base
  run. Psychodeli is unchanged within its bimodal noise (~16 or ~25–30 in
  both arms); its DOM is ~2,400 nodes, so the selector scan was never large.
  Most of the drop from the audit's 57 ms came before this branch, with the
  overview fix and the harness fix.
- Streaming renders (`spatial atlas load`) are unchanged: during the open
  animation the camera is moving, so frames take the full-pass branch and
  cause (a) does not occur. It applies to tiles landing on a settled field.

Tests: `npm test` on the branch fails the same three tests as `52b68e7`
(`A2` in spatial-drawable; `detail-preview` "leaving the tile…" and "Escape
drops the preview…", both 31 s timeouts, reproduced at the base commit).

## Audit, 2026-10-13

Headed Chrome on the Apple Silicon laptop, 1440×900 at 2×, median of three
fresh-context runs per instance, judged against `perf-budgets.json`. Raw runs
and summaries are the ignored `.local/perf/*audit-1013-*` files; the scale
sweep is `.local/perf/*-scale-sweep.json` (headless, so its frame columns are
SwiftShader floors and its script, DOM and span columns are real).

| Instance | Budgets passed | Failed |
|---|---:|---:|
| Music Atlas, 1,793 albums | 40 | 23 |
| Psychodeli Atlas, 406 screenshots | 55 | 8 |

**What is already exemplary.** The 3D view on a real GPU: pan and zoom hold a
10 ms p95 with no frame over 33 ms on both corpora, the Music Atlas streams
fully resident in about 1.3 s, and a 3D filter answers in 40–48 ms. Flat pan
holds 10 ms p95. Opening a detail answers in 32–40 ms. First paint is 52–60 ms.
The Psychodeli Atlas misses only on zoom-out settle, filter frames and 3D idle.

### Findings, ranked by how much of the failure list each one explains

1. **The overview canvas flushes in one synchronous lump.** *Fixed; see
   "Finding 1 fixed" above. The cost is per distinct hidden source, not
   image size or the clip.* A sampled
   profile of the Music Atlas zoom-out puts **517 ms of self time in
   `fillRect` inside `OverviewSurface._paint`**, while the 2,354 `drawImage`
   calls in the same window total 3.2 ms (timed individually; refutes the
   first hypothesis, synchronous image decode). The paint loop's 4 ms
   frame budget checks elapsed time after each draw, but recording a draw is
   nearly free; the cost lands when Chrome flushes the recorded canvas ops,
   and that flush surfaces on whichever call trips it. Interpretation, not yet
   measured directly: the flush is uploading and rasterising ~1,800 distinct
   small images in one go. One dirty repaint costs 84–124 ms. This one cause
   accounts for the Music Atlas zoom-out (script 538 ms, p95 85 ms), detail
   close (script 390 ms, input→paint 184 ms) and most of search typing (416 ms
   of overview paint). Directions: draw from one pre-built sprite atlas (the
   3D far atlas already solves this), flush incrementally within the budget,
   or paint in a worker through `transferControlToOffscreen`.
2. **Search filters synchronously on every keystroke.** The `input` handler
   runs the whole filter and render (46 ms, 17 ms of it forced layout), and
   the next keystroke queues behind that plus the overview flush: the third
   key waited **137 ms before its handler ran**, 360 ms to paint. Coalesce to
   one filter per frame with the latest query; finding 1 removes the rest.
3. **The scope bar resizes the stage, which re-fits the wall a second time.**
   The first scoped filter shows the bar, the stage shrinks, the stage
   `ResizeObserver` calls `fitWall()`, and the wall renders twice for one
   click (`render` 2×, `resize/stage` 14 ms, `render/measure` a 20 ms forced
   layout). Keep the stage's box fixed when the bar appears.
4. **Scope changes restyle every tile.** Filter input→paint on the Music
   Atlas is 232 ms, of which 177 ms is presentation: style and layout of
   ~1,800 tiles after the handler returns. The sweep shows the slope: filter
   input→paint 56, 128, 288, 688, 2,264 ms at 406, 2k, 5k, 10k, 25k items.
5. **Zoom thresholds restyle the whole canvas.** Crossing the `z-far` /
   `z-near` class thresholds produces a 55 ms style-and-layout frame (LoAF:
   55.6 ms style/layout, no script). Scope the rules so the toggle invalidates
   only what changes, or move the scale-dependent rules to the visible tiles.
6. **Smaller per-gesture costs** found by the profiler: `cloneNode` in the
   srcset upgrade (`wall.mjs` reveal path) 13–26 ms per gesture, and a
   `getBoundingClientRect` in `syncOverview` that forces layout every frame
   of camera motion (9–10 ms).
7. **3D idle is not free.** 57 ms of script per 2 s idle on the Music Atlas
   (budget 20) and two renders in 2 s on the Psychodeli Atlas (budget 0).
   Spans show the field passes and uploads are not the cost; the frame loop's
   own per-frame checks are the remaining suspect, unmeasured.
8. **Boot images.** 1,803 covers take 4.6 s to decode on the Music Atlas
   (budget 3 s); ready is 500 ms and first paint 52 ms.
9. **Retained memory.** After a forced GC, a full session retains +2,620 DOM
   nodes on the Music Atlas and +266 on the Psychodeli Atlas, with ~105
   listeners and 4–6 MB heap. No listener leak. The Music figure is over the
   2,000-node budget; the 3D host keeping its cards by design is the likely
   owner, unverified.

### Finding 5, resolved 2026-10-13

**Change.** The canvas-level `z-far` / `z-near` classes are gone. Each tile
carries its own caption tier (`.tile.z-far`, `.tile.z-near`; the hysteresis
is unchanged, 0.30/0.36 far and 1.10/1.20 near). When a zoom lands,
`applyScaleStyles` gives the new tier only to tiles currently shown;
`revealTiles` gives it to every other tile in the culling pass that reveals
it, before its visibility write, so no tile is seen with a stale tier and
nothing sweeps the wall in the background. A tile that enters view while a
zoom is still travelling takes the tier it will land in, so the landing does
not restyle it twice; tiles already in view keep theirs until the landing.
Background-plane tiles never show captions and are skipped.

**Progressive sharpness.** No filter or blur was added. Eased zooms already
held image loads and the tier until `settlesAt`. Touch pinch and edge-drag
zoom write immediately and had no landing time, so they loaded and upgraded
images every 250 ms mid-gesture. `Viewport.zooming` now reports those
gestures, `updateVisibility` and the overview treat them as motion, and the
gesture's end notifies the camera once more, which is the landing. During any
zoom the overview picture and tile images scale as they are; upgrades start at
landing, largest on-screen area first (`imageWork`).

**Evidence.** Headed Chrome, Music Atlas (1,793 albums), median of 3 fresh
runs, measured on 4a07830 with and without the change (`.local/perf/*zoomtier-*`):

| Flat scenario | Metric | Before | After |
|---|---|---:|---:|
| zoom in | layout ms | 27.7 | 4.8 |
| zoom in | style ms | 93.1 | 73.1 |
| zoom in | longest task ms | 60 | 0 |
| zoom in | worst LoAF style/layout ms | 56–63 | 0.1–0.2 |
| zoom in | frame max ms (budget 50) | 58.9 (58–117) | 66.6 (58–125) |
| zoom out | layout ms | 4.5 | 24.4 |
| zoom out | worst LoAF style/layout ms | 30.1 | 7.9 |
| zoom out | frame max ms (budget 50) | 133.3 | 141.6 |

The 55 ms style/layout frame is gone from both directions. Two budgets still
fail, for other causes. Zoom-in frame max: the remaining worst frame has no
script, 0.1 ms style/layout and 1.2 ms render, and persists with image loads
switched off, so it is neither the tier nor the upgrades; it is present at
HEAD too (TODO, "Landing raster frame"). Zoom-out: every worst frame is
`overview-surface.mjs` blocking (finding 1). Zoom-out layout rose because tiles
that were laid out with their near-tier metadata during the old zoom-in
landing now take their tier when revealed; across an in-and-out pair, layout
is about the same (32 vs 29 ms), spread over the gesture instead of in one
frame.

Captions are unchanged in type and colour. Over the 92% scrim on white
artwork, the title is 15.3:1 and the metadata line 10.5:1.

**Tests.** `flat-wall.test.mjs`: "a landed zoom restyles only on-screen
captions…" (zoom to near, check no on-screen tile has a stale tier and over
100 off-screen tiles still have the old one, then pan four steps and check
again) and "a pinch defers caption tiers and image upgrades until it lands".
Three cases in `scripts/check-mutations.mjs` trip them: dropping the reveal-path
tier write, sweeping all tiles at landing, and loading images mid-pinch.

### Scale sweep (synthetic corpora from the Psychodeli index, headless)

| n | ready ms | /api/clips wire KB (JSON KB) | DOM nodes at end | heap MB | pan p95 ms | zoom out script ms | filter render ms | group render ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 406 | 260 | 76 (851) | 5,281 | 10.6 | 9.0 | 91 | 12 | 11 |
| 2,000 | 401 | 99 (4,195) | 18,122 | 13.9 | 8.9 | 236 | 38 | 45 |
| 5,000 | 1,249 | 140 (10,493) | 42,998 | 40.3 | 9.0 | 341 | 83 | 126 |
| 10,000 | 1,867 | 199 (21,002) | 83,418 | 98.3 | 16.3 | 900 | 184 | 301 |
| 25,000 | 4,153 | 379 (52,520) | 667,727 | 437.5 | 125 | 2,589 | 500 | 1,269 |

Copies share image files, so the HTTP cache serves repeats; DOM, script and
layout scale with n, network and disk do not. Reading it: flat pan survives
to 10,000; every discrete operation is linear in n or worse, and with the
100 ms budget the flat wall is exemplary only below ~2,000 items today. At
25,000 the boot leaves ~7 DOM nodes per tile and images never finish
(2,696 decoded in 30 s). The flat DOM wall is the scaling limit, as the
September hybrid analysis predicted; the 3D field's far atlas caps at 4,096.

### Test-suite state found during the audit

`npm test`: 200 of 202 pass with the instrumentation in place. Both failures
reproduce on the committed code without it: `A2 — a near tile carries its
title band as ink` fails every run, and `zoom-out exposes decoded DOM at
cached-picture edges` flakes about 2 in 12 at HEAD and at the working tree
alike (a tile at the stage's right edge, x = 1099.97 of 1100).

## The instrumentation suite (2026-10-13)

Performance is a product feature here, so it is measured from the inside as
well as the outside, judged against written budgets, and checked at corpus
sizes we do not have yet. Four parts:

| Part | What it answers | Where |
|---|---|---|
| In-app probe | *Which phase* spent the time: scope, layout, tile build, overview paint, 3D pass, atlas upload | `wall/instrument.mjs`, spans wired through `wall.mjs`, `overview-surface.mjs`, `spatial/spatial-view.mjs` |
| Scenario harness | *How long, how smooth*: frames, CDP layout/style/script counters, long tasks, input→paint per interaction, repeated runs | `scripts/perf.mjs` |
| Budgets | *Is that good enough*: per-scenario ceilings, median of N runs, exit 1 on a miss | `perf-budgets.json`, `--check` |
| Scale sweep | *Does it hold at 5k, 10k, 25k*: synthetic corpora built from a real index | `scripts/perf-scale.mjs` |

### The probe

Off by default; when off, every call is a function call and a branch (a few per-frame sites also allocate one small closure). Turn it on with
`?perf` (read `window.__cwPerf.snapshot()` in the console), `?perf=hud` (a
two-line live readout in the corner for demos, black on near-white at 18.8:1),
or `window.__cwPerfEnable = true` before boot, which is what the harness does.

It records:

- **Spans.** Named phases with count, total, p50, p95 and max. Each is also a
  User Timing measure `cw:<name>`, so a DevTools Performance recording shows
  the wall's phases on the Timings track under Chrome's own tasks. Names:
  `filter` (`/scope`, `/clusters`, `/scope-ui`), `render` (`/capture-motion`,
  `/measure`, `/layout`, `/blocks`, `/tiles`, `/motion`, `/overview-tiles`,
  `/background`, `/brush`, `/visibility`), `scale-styles`, `camera/change`,
  `camera/reveal` and `camera/reveal+load`, `overview/sync`, `overview/paint`,
  `rail/build`, `detail/open|step|close`, `resize/stage`, `resize/bar`,
  `spatial/pass`, `spatial/render`, `spatial/upload.far|near`.
- **Frames.** rAF intervals (p50, p95, p99, max, counts over 16.7, 33 and 50 ms).
- **Long Animation Frames.** Chrome's attribution of each slow frame to the
  scripts in it, including forced style and layout time per script. This is
  the step a plain long-task observer cannot take.
- **Interactions.** Event Timing per discrete interaction (the INP
  definition), split into input delay, handler time and presentation, with
  the target element. Wheel and pointermove carry no interaction id, so pan
  and zoom are judged by frames; clicks and keys by latency.
- **Counters and gauges.** `spatial/draws.*`, `spatial/uploads.*`,
  `spatial/uploadMB.*`; gauges for flat tile and DOM counts, the image work
  queue, overview draws, and 3D atlas residency, read only at snapshot time.

### The harness

```bash
npm start                                    # or any instance; the demo atlases are 4174 / 4175
node scripts/perf.mjs --url http://127.0.0.1:4175 --label audit           # one headless run
node scripts/perf.mjs --url http://127.0.0.1:4175 --runs 3 --check --headed --chrome   # the gate
node scripts/perf.mjs --url http://127.0.0.1:4174 --scenario interact      # clicks and keys only
node scripts/perf-scale.mjs --sizes 406,2000,5000,10000,25000 --scenario flat
node scripts/perf-compare.mjs .local/perf/<before>.json .local/perf/<after>.json
```

Scenarios: boot; flat idle, pan, zoom in, pan zoomed, zoom out, filter on/off,
group change; **detail open (click), detail walk (8× →), detail close (Esc),
search typing, search clear** (new); 3D open, atlas streaming, idle, pan,
zoom, filter on/off. Every row now carries `app` (top spans, LoAF,
interactions, counters, gauges), `inpMs` (input→paint, p98 of interactions)
and `inputBlockMs` (the worst interaction's input delay plus handler time,
which excludes presentation and so means the same thing headless).

**Headless versus headed.** Headless Chromium paints with SwiftShader at
2880×1800. Its script, layout and style counters are real; its frame times,
presentation and therefore input→paint latency are not. Budgets marked
`headedOnly` are reported as skipped on a headless run rather than passed.
`npm run perf:check` is the headed gate.

**Repeat.** `--runs N` starts a fresh browser context per run and writes a
`-summary.json` with median, min and max per metric. Single runs on this
laptop have differed by more than the change under test (the September 20
zoom p95 of 150–183 ms versus 16.6 ms on another run), so a claim of
improvement needs N ≥ 3 and non-overlapping ranges.

### Budgets

`perf-budgets.json` holds the bar, not the current state; a FAIL is a work
item. The classes:

| Class | Budget | Why this number |
|---|---|---|
| Continuous gestures (pan, pan zoomed, 3D pan) | frame p95 ≤ 16.7 ms, 0 frames over 33 ms | a missed frame during direct manipulation is the most visible defect a canvas has |
| Zoom | p95 ≤ 16.7 ms, max frame ≤ 50 ms, script ≤ 100 ms | one settle frame is allowed; a stall on landing is not |
| Discrete (filter, group, search key, detail open) | input→paint ≤ 100 ms; handler share ≤ 50 ms | 100 ms is where a response stops reading as instant; web vitals calls ≤ 200 ms "good", and this product aims above "good" |
| Reading (detail walk, close) | input→paint ≤ 50 ms | arrow-key traversal is a rhythm; each step has to land before the next key |
| Idle | 0 layouts, ≤ 20 ms script per second, 0 3D renders | an idle wall costs nothing, by design |
| Boot | ready ≤ 1 s, first paint ≤ 600 ms, visible images ≤ 3 s | |

## September 20 delivery diagnostic

Headed Chrome, Music Atlas on the verified task-owned port 4182, 1,793 item
identities / 1,803 displayed occurrences, 1440×900 CSS px at 2× DPR. The page
became ready in 754 ms; all displayed image occurrences decoded in 7,269 ms.
The harness now includes queued images before declaring loading complete.

| Scenario | Frame p95 ms | Frame max ms | Frames over 33 ms |
|---|---:|---:|---:|
| Flat idle | 10.0 | 10.4 | 0 |
| Flat pan | 10.2 | 10.4 | 0 |
| Zoom in | 16.6 | 150.2 | 7 |
| Pan while zoomed | 9.9 | 10.3 | 0 |
| Zoom out | 157.2 | 233.3 | 19 |
| Filter on | 100.4 | 141.6 | 5 |
| Filter off | 216.4 | 216.4 | 8 |
| Group to none | 251.5 | 251.5 | 2 |
| Group to decade | 226.3 | 226.3 | 2 |

Raw evidence: ignored `.local/assessment-2026-09-20/smooth-perf-verified.log`
and `2026-09-20T15-41-23-770Z-smooth-verified.json` in the same directory.
The console recorded one resource 404; this is
not a zero-error performance run. Separate rendered journey proof records
JavaScript page errors. This diagnostic is not a controlled before/after
comparison or hardware input-to-photon measurement. Earlier September 20 zoom
p95 values were 150–183 ms on the same corpus under different host conditions;
the new run does not establish a zoom performance improvement.

Cold overview arrivals now paint incrementally: the deterministic 1,793-item
fixture requires 1,793 draws and one clear, instead of repainting the growing
prefix. Cached-picture camera motion and a warm DOM fallback avoid per-tile
drawing during eligible gestures. An earlier diagnostic path trace nevertheless found
6,341 additional overview draws across the zoom-out scenario, interleaved with
cached motion, fallback and settle work. Representation changes and repeated
settles remain the next profiling target, alongside dense filter/regroup work.
Keep these stalls as an open acceptance item in TODO.md, rather
than treating resource bounds or correctness tests as a frame-time guarantee.

## September 10–11 historical experiments

Measured 2026-09-10 on the Music Atlas (1,793 albums, port 4175) and the
Psychodeli Atlas (406 images), with `scripts/perf.mjs`. Hardware: Apple
Silicon MacBook, 1440×900 CSS px at 2× DPR. Two conditions: **headless
Chromium** (SwiftShader software raster — a floor for anything GPU-side, but
the same script/layout/style counters as real Chrome) and **headed Chrome
152** on the same machine. Every number below came out of that script, and
the `.local/perf/*.json` files behind each table are the record. Re-run:

```bash
node scripts/perf.mjs --url http://127.0.0.1:4175 --label after            # CPU/DOM counters
node scripts/perf.mjs --url http://127.0.0.1:4175 --label after --chrome --headed   # GPU frame times
```

The script drives boot, a wheel pan, a pinch zoom in and out, a facet filter
on and off, a group change, then the 3D view: open, stream the atlas, idle,
pan, zoom, filter. Around each it reads CDP `Performance.getMetrics`
(layout and style-recalc counts and durations, script time, DOM nodes, heap)
and an in-page rAF sampler (frame p50/p95/max, long tasks). It writes nothing
to the instance.

## Is the DOM + three.js hybrid a unique approach? A good one?

Not unique, and that is a point in its favour. Every serious infinite canvas
splits the same way: a cheap bulk representation for the many, and real DOM
for the few that are being read. Mapbox and Google Maps draw tiles on the
GPU and lift markers and popups into HTML; Figma draws the document on a
canvas and mounts DOM only for text editing and UI; deck.gl composes WebGL
layers under an HTML overlay; three.js itself ships `CSS3DRenderer` for
exactly this pairing. Piling.js, the closest research precedent for the pile
metaphor, is pure PixiJS with no DOM tier at all, which is where it loses
selectable text, links, find-in-page and the accessibility tree.

What wunderkammer adds is not the split but the **promotion contract**: one item
identity, one scope, and a bounded pool of DOM elements lent to whichever
items are close enough to read, with the quad hidden by an attribute write
rather than a scene-graph change. The near atlas has a fixed budget; the far
atlas grows with the corpus up to a 4096-pixel dimension cap (4096 64px slots).
The promoted DOM budget is fourteen, and per-frame work scans typed arrays
over the instance count. These bounds do not establish support for 25,000
clips. The flat DOM wall, retained underneath, also grows with the corpus.

So: a sound, well-precedented architecture. What the measurements showed is
that it was not yet *collecting* on its advantages. Three things were
throwing them away:

1. **It rendered every frame whether or not anything changed.** A
   stationary camera over a settled field cost 18% of a core and a full tier
   pass over all 1,793 instances, 120 times a second. The point of the
   hybrid is that idle costs nothing; this idle cost more than the flat wall.
2. **From an overview, every instance was "near".** The near band is 3,200
   world units and the field sits ~1,650 away, so all 1,793 items asked for a
   near slot every frame against a 256-slot pool, and each refusal scanned
   all 256 slots for something to evict. About 460,000 slot scans per frame
   during a pan; half a second of script per second of gesture on real
   hardware.
3. **Every tile that landed re-uploaded the whole atlas.** `CanvasTexture`
   has one upload primitive, the whole canvas. Streaming 1,536 tiles moved
   5.1 GB through `texImage2D` in headless; in headed Chrome the GPU-canvas
   copy is cheaper but still a 5–25 ms main-thread stall per flush.

And one thing it does by design that costs the most: **a filter change
rebuilds the field**, disposing both atlases and reloading every image.
The audit of 2026-09-06 chose that deliberately (correctness over filtering
performance, after index reuse bound the wrong card to a clip). It is the
right default for a first release and the wrong steady state for the
architecture: the hybrid's whole promise is that membership changes are
attribute writes. That is the investment to make next; it is specified at
the end of this document rather than done, because it changes identity
semantics the audit fought for and deserves its own fixture.

## What changed in this pass

| Layer | Change | Where |
|---|---|---|
| Server | Validators (`ETag`, `Last-Modified`) and 304s on every file; content-addressed derivatives cached immutable; `/api/clips` brotli/gzip | `serve.mjs` |
| Flat | Scale-dependent styles (label sizes, caption tiers, tight blocks) applied once when an eased zoom lands, not per wheel tick | `applyScaleStyles()` in `wall/wall.mjs` |
| Flat | Tiles no longer transition `width`/`height` (layout per frame per tile); `contain: layout paint style` | `wall/wall.css` |
| Flat | One stage measurement per render, threaded through; the stage rect is read before the transform write each frame | `render()`, `Viewport._schedule` |
| Flat | Per-frame culling writes only what changed; no `querySelector` per tile per frame | `revealTiles()` |
| Flat | `aspectOf` memoised per clip (the 25-candidate layout search asked ~150,000 times per render) | `wall/layout.mjs` |
| Flat, 3D | **Pan only reveals clipped content.** A fitting axis is frozen; a partly clipped one may only return into view (Andy, 2026-09-10) | `boundPan()` in `wall/edge-pan.mjs`, `clampPan()` in `spatial-view.mjs` |
| 3D | Render on demand: passes and renders only when the camera, an instance, the pane, an atlas or the selection changed | frame loop in `spatial-view.mjs` |
| 3D (lib) | Near tier budgeted to the nearest `capacity` instances by quickselect; no eviction scans for the rest | `TileField.update` |
| 3D (lib) | DOM-pool selection allocation-free; z-index writes only on change | `HybridField.update`, `sort` |
| 3D (lib) | Atlas flush uploads up to four dirty slots via `copyTextureToTexture`; a burst takes one whole-canvas upload, which is cheaper on the main thread than the copies (measured) | `TileAtlas._upload` |

The lib changes were made upstream in muriel (`render_assets/_lib`, with a
new `tests/spatial-field-select.test.mjs`) and pulled. They were initially
uncommitted upstream; `VENDOR.md` now records the matching commit `6cc2bc9`.

## Numbers

### Headless Chromium (SwiftShader), Music Atlas, before → after

Software raster: frame times here are a floor, not a prediction. Script,
layout and style counters are the comparable columns. The spatial frame
times are what a 2880×1800 MSAA back-buffer costs a software rasteriser, and
they are the reason the old streaming pipeline looked like 25 tiles/s in
headless: the main thread was busy rasterising and image `load` callbacks
had to wait for it. On real hardware the same pipeline streams ~285 tiles/s.

| scenario | script ms | layout ms (n) | style ms (n) | frame p95 ms | frame max ms | frames >33 ms |
|---|---|---|---|---|---|---|
| flat idle 1s | 11.8 → 12.1 | 0 → 0 (0 → 0) | 0 → 0 (0 → 0) | 8.9 → 9.9 | 9.3 → 10.2 | 0 → 0 |
| flat pan | 74.9 → 38.8 | 7.6 → 6.3 (117 → 119) | 66.1 → 53.8 (226 → 180) | 8.8 → 9.9 | 33.3 → 24.9 | 1 → 0 |
| flat zoom in | 60.5 → 40.4 | 344.9 → 32.2 (27 → 11) | 276.1 → 55 (129 → 122) | 50.6 → 17 | 332.7 → 324.8 | 15 → 6 |
| flat pan zoomed | 83.3 → 30.7 | 0 → 0.3 (0 → 4) | 12 → 15.1 (160 → 162) | 8.9 → 9.9 | 9.4 → 10.4 | 0 → 0 |
| flat zoom out | 55.1 → 34.9 | 166.8 → 6.5 (21 → 6) | 271.4 → 43.8 (119 → 115) | 41.5 → 24.9 | 75.1 → 108.6 | 16 → 6 |
| flat filter on | 89.9 → 80.2 | 30.5 → 10.3 (22 → 7) | 105.1 → 101 (26 → 43) | 33.4 → 10.3 | 166.7 → 141.6 | 3 → 2 |
| flat filter off | 91.9 → 86.9 | 38.2 → 12.8 (23 → 9) | 70.1 → 63 (16 → 20) | 116.6 → 74.9 | 125.8 → 107.9 | 11 → 4 |
| flat group → | 123.7 → 121.5 | 13.6 → 10.6 (6 → 5) | 34.5 → 29.4 (7 → 5) | 91.8 → 82.9 | 133.6 → 125.2 | 5 → 4 |
| spatial open | 89.2 → 78 | 6.9 → 7.6 (6 → 6) | 28.2 → 31 (12 → 12) | 8.8 → 10.2 | 33.6 → 33 | 1 → 0 |
| spatial idle 2s | 84.7 → 16.2 | 0 → 0 (0 → 0) | 0 → 0 (0 → 0) | 483.4 → 491.7 | 483.4 → 491.7 | 4 → 4 |
| spatial pan | 1834.1 → 257.6 | 0 → 0 (0 → 0) | 11.3 → 0 (120 → 0) | 556.8 → 541.7 | 601.4 → 649.5 | 120 → 85 |
| spatial zoom in/out | 1648.5 → 1152.1 | 0.9 → 0.7 (5 → 4) | 10.1 → 8.6 (71 → 37) | 1216.8 → 1224.9 | 1541.7 → 1276 | 85 → 72 |
| spatial filter on | 355.7 → 155.3 | 5.1 → 3.4 (10 → 8) | 14.8 → 11.5 (14 → 12) | 1034.6 → 949 | 1034.6 → 949 | 11 → 11 |
| spatial filter off | 264.8 → 181.1 | 15.5 → 12.7 (10 → 16) | 34.5 → 25.4 (11 → 8) | 1058.4 → 866.6 | 1058.4 → 866.6 | 11 → 3 |

Boot: ready 683 → 717 ms · clips on the wire 3776416 → 499558 B · images decoded in 349 → 234 ms · DOM nodes 22675 → 21985
Spatial streaming: — → 1067 tiles drawn · 128 → 134 uploads = 5102 → 83 MB · 127 → 133 renders in 60 → 60 s
Spatial idle (2 s): 7 → 7 renders · 84.7 → 16.2 ms script
spatial filter on: field 408 · tiles drawn — → 382 · uploads 2334 → 62 MB · resident again in 60351 → 37235 ms
spatial filter off: field 1793 · tiles drawn — → 723 · uploads 3136 → 65 MB · resident again in 60131 → 60191 ms

Reading it: on the flat wall, zoom went from 27 full layouts (345 ms) and
276 ms of style recalc per 20 ticks to 11 layouts (32 ms) and 55 ms; the p95
frame during a zoom fell from 51 ms to 17 ms. The remaining max frame is the
one settle pass that re-scales every caption and starts the deferred image
loads, which was there before too. Filter and group changes lost their
per-frame layouts (the tile size transition) but keep their one big restyle:
that is the render itself, ~100 ms of style at 1,800 tiles, and it is the
next thing to attack (see the flat-wall section). Spatial pan script fell
7×; idle script 5× even in headless, where the sampler's own frames dominate.
Atlas streaming moved 83 MB instead of 5.1 GB.

### Headed Chrome 152, Music Atlas, before → after (real GPU)

Baseline is the first headed run, taken before any edit (old wall code, old
server). After is two runs on the private port 4180 instance with every
change. Caveat for anyone re-measuring: the running 4174/4175 instances
serve `wall/` files from disk per request, so they picked up the flat-wall
and vendored-lib edits the moment they were saved; only `serve.mjs` needs a
restart. A "baseline" taken from them after 2026-09-10 is not a baseline.

Flat wall:

| scenario | script ms | layout ms (n) | style ms (n) | frame p95 ms | frame max ms | frames >33 ms |
|---|---|---|---|---|---|---|
| flat idle 1s | 9.7 → 9.7 | 0 → 0 (0 → 0) | 0 → 0 (0 → 0) | 9.9 → 10 | 48.8 → 92.7 | 2 → 1 |
| flat pan | 66.2 → 44.3 | 8.7 → 8.4 (117 → 119) | 62.9 → 67.8 (226 → 180) | 10 → 9.8 | 26.6 → 24.9 | 0 → 0 |
| flat zoom in | 86.4 → 47.6 | 369.6 → 40.2 (27 → 14) | 339.3 → 99 (106 → 118) | 67.7 → 40.4 | 265.7 → 291.2 | 20 → 10 |
| flat pan zoomed | 91.5 → 37.2 | 0 → 0.3 (0 → 4) | 14.7 → 18.7 (160 → 162) | 9.7 → 10 | 10.3 → 10.4 | 0 → 0 |
| flat zoom out | 44.3 → 42.5 | 184.1 → 12.9 (21 → 8) | 355 → 76.8 (91 → 97) | 57.6 → 91.7 | 131.8 → 183 | 17 → 11 |
| flat filter on | 85.3 → 85.5 | 14.1 → 12.1 (9 → 7) | 77.5 → 72.6 (14 → 12) | 167.2 → 500 | 167.2 → 500 | 2 → 3 |
| flat filter off | 92.2 → 77.2 | 18.1 → 14.6 (9 → 7) | 68.6 → 78.6 (12 → 16) | 298.6 → 100.3 | 298.6 → 132.2 | 7 → 3 |
| flat group → | 109.1 → 95.2 | 15.1 → 11.2 (6 → 5) | 45.7 → 41.5 (7 → 5) | 201.2 → 149.6 | 201.2 → 174 | 4 → 4 |
Boot: ready 1570 → 798 ms · clips on the wire 3776416 → 499560 B · images decoded in 5 → 4 ms · DOM nodes 15599 → 15549

Flat zoom is the clear win: 27 → 14 layouts and 370 → 40 ms of layout, 339 →
99 ms of style, half the frames over 33 ms. Filter and group changes are
unchanged in script terms because their cost is the render itself (layout
search plus 1,800 DOM writes plus one full restyle); the 500 ms frame on the
first filter after boot reproduces with and without `contain` and with the
old CSS, so it is not this pass's doing. Pan was already at frame rate.

Spatial view:

| scenario | script ms | layout ms (n) | style ms (n) | frame p95 ms | frame max ms | frames >33 ms |
|---|---|---|---|---|---|---|
| spatial open | 130.9 → 91.3 | 9.8 → 3.7 (6 → 5) | 37.7 → 20.5 (12 → 11) | 191.6 → 15.8 | 191.6 → 141.1 | 3 → 1 |
| spatial idle 2s | 360.4 → 55.5 | 0 → 0 (0 → 0) | 0 → 0 (0 → 0) | 10.2 → 9.8 | 10.4 → 10.2 | 0 → 0 |
| spatial pan | 511.1 → 60.3 | 0.3 → 0 (2 → 0) | 13.8 → 0 (122 → 0) | 10.2 → 9.8 | 10.4 → 10.3 | 0 → 0 |
| spatial zoom in/out | 317.2 → 154.3 | 0.3 → 0.6 (2 → 4) | 9.6 → 9.6 (119 → 37) | 9.7 → 15.1 | 99.8 → 26.6 | 2 → 0 |
| spatial filter on | 94.4 → 92.6 | 16.4 → 5.4 (29 → 9) | 42.2 → 35 (60 → 32) | 9.3 → 25.4 | 74.6 → 75 | 2 → 1 |
| spatial filter off | 187.8 → 118.7 | 26.6 → 11.1 (25 → 10) | 57.1 → 57 (18 → 25) | 57.9 → 66.8 | 166.7 → 99.9 | 4 → 4 |
Spatial streaming: — → 1379 tiles drawn · 8 → 7 uploads = 266 → 272 MB · 7166 → 56 renders in 60 → 60 s
Spatial idle (2 s): 241 → 0 renders · 360.4 → 55.5 ms script
spatial filter on: field 408 · tiles drawn — → 0 · uploads 0 → 0 MB · resident again in 60068 → 0 ms
spatial filter off: field 1793 · tiles drawn — → 1376 · uploads 266 → 144 MB · resident again in 60110 → 616 ms

The spatial view now costs nothing while idle (0 renders, and the 55 ms of
script in 2 s is the permalink poller and the harness), a pan is 60 ms of
script per second of gesture instead of 511, a zoom 154 instead of 317 with
no frame over 33 ms, and a filter to a subset draws no new tiles because the
subset's slots are already resident in the field that was just rebuilt from
the same images — the browser cache and the validators do the rest. The
unfilter still rebuilds and re-streams (1,376 tiles, 0.6 s); that is the
persistent-field spec below.

One more row that matters and is not in the table: streaming the atlas in
headed Chrome moves ~270 MB either way, because the whole-canvas upload is
cheap for the main thread there (it is a GPU-side copy). The per-slot path
exists for the idle case, where one landing tile used to cost a 64 MB upload
and now costs 256 KB.



## What the flat wall is good at, and what to invest in

The flat wall gets raster caching, text, links, focus and the accessibility
tree for free from the browser, and at 1,800 tiles it still pans at frame
rate. Its costs are the ones every DOM canvas has: O(n) nodes (22,675 at
1,793 clips), O(n) style invalidation whenever a stage-level variable
changes, and one image element per tile. After this pass the first two are
paid only when the camera settles, which is the right time to pay them.

Worth doing, in order:

1. **Tier the flat wall's images the way the spatial view tiers its atlas.**
   Done for the image archive on 2026-09-11: `scripts/index-images.py` now
   writes a 128 px `thumbs-small/` overview beside the 640 px thumbnail and
   backfills it from the cached thumbnail for already-indexed files (406
   Psychodeli images in 1.5 s, 2.4 MB, no originals reread); the images
   adapter emits `coverVariants` at 128 and 640; and the spatial resolver
   picks a source per tier (`sourceFor()` in `spatial-view.mjs`: 128 for the
   64 px far slot, 640 for the 256 px near slot, 640 for the 340 px DOM card)
   instead of feeding the same file to both. The interests corpus still has
   remote heroes and no derivative: that needs capture-time download, which
   is the capture-extension work, not an adapter change.
2. **Cap simultaneous image requests at overview.** At Fit every tile is
   visible, so a reload asks for all 1,800 covers at once. With validators
   they are 304s now, but a cold cache still queues 1,800 requests; a
   priority queue by projected screen area (largest first, ~64 in flight)
   would put recognisable imagery on screen sooner without changing what
   loads.
3. **A far tier for the flat wall.** Below a threshold scale (`z-far`,
   captions already hidden) the tiles carry colour and shape only. The
   spatial view's far atlas already holds exactly that for the whole corpus.
   Drawing it into one `<canvas>` behind the tile layer and hiding the tile
   `<img>`s below that scale would take the overview from 1,800 composited
   images to one bitmap, and unify the two views' image pipelines. This is
   the hybrid idea applied to the flat wall; it is a spec, not a promise.

## The persistent corpus field (implemented 2026-09-11)

Goal: a filter or group change in 3D costs what it should in this
architecture — attribute writes and a re-layout — and never a reload.
Implemented on the second day of the pass, to this spec, with the
acceptance fixture as a test (`with a corpus, a filter is membership` in
`tests/spatial-view.test.mjs`). Two things the spec did not foresee and the
fixture found: hiding must not evict (a hidden instance keeps its near slot
and becomes the coldest in the pool, so the LRU takes it only under
pressure), and the far atlas has to hold *every* instance, near residents
included — before, a near-resident item had no far tile, so once eviction
took its near slot it had no picture until it was requested again, which is
exactly a reload. Every instance now costs one 16 KB far load, once.

Measured, headed Chrome, a 3D facet filter on and off:

| | Music Atlas 1,793 (before, rebuild) | Music Atlas (membership) | Psychodeli 406 (membership) |
|---|---|---|---|
| filter on: script | 93 ms | 51 ms | 12 ms |
| filter on: tiles drawn | field rebuilt, 82 drawn (subset already cached) | 251 (near re-tiering only) | 0 |
| filter on: frames >33 ms | 2 | 7 (one 57 ms) | 0 |
| filter off: script | 119 ms | 92 ms | 61 ms |
| filter off: tiles drawn | 1,376 in 616 ms | 512 in 528 ms | 124 in 186 ms |
| far tiles reloaded | all | none | none |

What the remaining draws are: the near tier is a 256-slot cache, and a scope
change changes which items are nearest, so it re-tiers — those are 640 px
files from the browser cache (validators and immutable caching from day one),
decoded and drawn, never re-downloaded. The far atlas, the corpus's actual
picture, is untouched by a filter now. On the Psychodeli atlas the subset's
nearest were already near-resident, so a filter drew nothing at all.

Verification: wunderkammer `npm test` 100/100 (the acceptance fixture is the
100th), muriel spatial tests 20/20.


- **Allocate the field for the corpus, not the subset.** `TileField` count =
  `state.clips.length`; instance index = corpus index for the life of the
  page. Both atlases are keyed on corpus index, so residency survives
  filtering. The near pool keeps whatever it held; the far atlas fills once.
- **Membership is a mask.** A new `TileField.setActive(Uint8Array)` (or
  per-index `setActive(i, on)`) that: skips inactive instances in the tier
  pass, `pickAt`, `HybridField.update` candidates and `FieldNavigator`
  traversal; hides them with the existing opacity attribute (`aOpacity = 0`
  discards in the fragment shader, the same path a promoted card uses).
  Inactive instances keep their far slot and retain their near slot until
  cache pressure evicts it.
- **Layout addresses active instances only.** `_placeField`, `showPiles`,
  `_spread` and `_packPiles` in `spatial-view.mjs` iterate `state.filtered`
  mapped to corpus indices; a hidden instance keeps its last placement,
  which nothing samples.
- **Identity stays URL-keyed for anything durable**, exactly as now. The
  corpus index is a page-lifetime address, and the audit's finding 2 (index
  reuse binding the wrong card) cannot recur because indices are never
  reused: a corpus change (`/api/clips` revision) is the one event that
  rebuilds the field, through `_replaceField()` as today.
- **Acceptance.** The `filter changes keep rendered cards, activation, and
  images bound to the same source` and `GPU pixels refresh after an index is
  reused` tests keep passing unchanged. New fixture: filter A→B→∅→A on the
  406-item atlas with the atlas draw counter from `scripts/perf.mjs`: the
  second A must draw zero new tiles, and its first frame must be pixel-equal
  to the first A's settled frame. Cost target on the Music Atlas: filter
  on/off in 3D under 100 ms of script, no atlas reload, no long task over
  50 ms.
- **Out of scope.** Growing the corpus in place (a new clip appearing) is a
  rebuild; that is what revisions are for. The 4,096-slot far ceiling is
  unchanged by this and remains the documented limit.

## Verification of this pass

- Muriel: `node --test tests/spatial-*.test.mjs` — 19 passing, including the
  new near-budget, quickselect and dirty-flag tests.
- Wunderkammer: `npm test` — 99 passing at the end of the pass: the 97 that
  existed, plus a `boundPan` unit test (`tests/edge-pan.test.mjs`) and a
  browser test in `tests/flat-wall.test.mjs` (nothing moves at Fit, a drag
  inside the dead zone does not slide, an overflowing wall pans).
- Server: a private instance on port 4180 answered `/api/clips` at 499 KB
  brotli (3.78 MB raw), served a content-addressed thumbnail with
  `cache-control: public, max-age=31536000, immutable` and a validator, and
  returned 304 to `If-None-Match` and `If-Modified-Since`.
- The pan rule: `tests/edge-pan.test.mjs` passes unchanged; the flat and
  spatial pan bounds were checked by hand in the browser (see HANDOFF).
