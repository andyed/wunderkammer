# The spatial view

The current foundation for **Survey** in the
[survey / review / dive product model](PRODUCT.md). Search and faceting select
the working subset for every activity. This renderer reads the same index,
adapters, and filter state as the flat Review wall and item-detail Dive panel.

Survey's intended feature set includes large-scale z-order, layers, and stack
interaction. Current facet-derived piles are a starting point. Layer meaning,
occlusion-revealing gestures, and persistent rearrangement are still open design
work. The [architecture contracts](ARCHITECTURE.md) require shared scope,
stable identity, and preserved return context across presentations; the complete
cross-activity navigation is not implemented yet.

## Stationary, content-fitted browsing

The application owns its camera loop; it no longer uses the library's demo
parallax, row panning, wraparound, or idle orbit. The default presentation is an
upright reading plane with real Z separation within stacks. The unused mountain,
floor and horizon grids are removed. The legacy `mountain` value in version-1
saved state still means the ungrouped field; saved URL membership is unchanged.

Generated stacks pack for the usable viewport aspect. Covers define their
footprints; other members fit inside those footprints without changing image
proportions. Counts convey membership. Fit uses actual card corners and labels,
including stack depth, rather than a fixed camera position. Saved stack anchors
are retained; automatic repacking applies to newly generated arrangements.

Click or press Enter on a stack to spread its members into a fitted, justified
composition. Activate an exposed item to open its detail panel. **All stacks**
or Escape returns to the stacks; Escape first closes an open detail panel.
Scroll/drag pans, Command/Ctrl-scroll (trackpad pinch) zooms, and the shared
+/−/Fit controls operate on the active view. A fitted overview adapts to window
and rail changes; a deliberate camera position stays put until Fit is requested.

Automatic DOM promotion in collapsed piles is restricted to exposed covers;
hidden members cannot become foreground DOM cards. Explicit focus still wins.
The app keeps promoted-card image geometry aligned with GPU tiles by overlaying
captions within the existing rectangle. Upstream pile fixes assign unique depth
to cards below the visible fan and account for actual image widths in spreads.
These changes address geometric shimmer and promotion jumps separately from
image loading, which can still visibly sharpen a newly loaded preview.

Rendered regressions use 406 synthetic items in five uneven stacks, with normal
motion preferences, landscape/portrait panes, real pointer/keyboard activation,
and idle screenshots taken beyond the former six-second orbit trigger. Coverage
checks require over 40% of the landscape pane for collapsed covers and over 65%
for an expanded stack. Deliberately restoring a fixed camera or autonomous
camera movement must fail those checks. Real-corpus proof uses the local
406-image Psychodeli Atlas instance; hardware frame-rate profiling remains open.

## Why a hybrid renderer

The spatial renderer bounds the number of rich, individually updated DOM cards
while using GPU quads for the wider field. This avoids making every spatial
item a per-frame style-update target. It is a design tradeoff, not evidence that
DOM becomes unsuitable at a universal item count. The retained flat wall still
contributes DOM and decoded-image cost.

Focus/context and spatial document-management systems are useful precedents;
[PRECEDENTS.md](PRECEDENTS.md) gives verified references and their limits,
including Data Mountain's fixed-viewpoint, user-arranged documents. Those
results do not establish that our dynamic layout or hybrid renderer is better.
The current implementation splits into three tiers:

| tier | population | backing | carries |
|---|---|---|---|
| far | the whole corpus, every instance, near residents included | one atlas, 64px/tile, from the 128px derivative | colour and shape |
| near | a fixed LRU pool (~256) | 256px atlas slots, from the 640px derivative | a recognizable image |
| DOM | a fixed pool (~14) | real elements | title, available source/editor links, keyboard focus |

Since 2026-09-11 the field is allocated for the corpus and the working subset
is a membership mask: a hidden instance keeps its placement and its tiles, is
not drawn, picked, promoted or navigated. Narrowing and widening scope preserves
the far atlas; near tiles can refill after cache eviction ([PERF.md](PERF.md)).
The far atlas grows only up to its
4096-pixel dimension cap: at 64px per tile, that is 4096 slots. The near and promoted-DOM pools are bounded, but this does
not demonstrate support for 25,000 clips. The flat wall also retains its DOM
tiles, so whole-page DOM cost still grows with the corpus.

Promoted cards provide selectable text, editor links, and keyboard focus.
Reachability of occluded items and accessibility across the intended layer
interactions remain acceptance requirements, not consequences of using a pool.

## What's ours and what's vendored

`wall/spatial/lib/` is a **copy** of muriel's `render_assets/_lib/`. Edit it
upstream and re-sync; edits made there are lost and, worse, silently diverge
from a library other consumers still track.

```bash
node wall/spatial/lib/sync.mjs          # report drift
node wall/spatial/lib/sync.mjs --pull   # re-copy, update VENDOR.md
```

Drift is checked on **content**, not mtime — a re-copy or a checkout resets
mtimes while leaving bytes stale, and an mtime fingerprint calls that fresh.

`wall/spatial/spatial-view.mjs` is wunderkammer's own: mapping clips onto the field,
facets into piles, the deep link on every promoted card, and the view-state
plumbing.

## Invariants

**No innerHTML for clip-derived data.** Every string — titles, notes, tags,
facet values — comes from scraped third-party pages. `wall.mjs` says this and
the spatial view inherits it: the hybrid's `build(index, el)` hook is a
node-filling callback precisely so there is no string path to escape.

**The wall never edits a clip.** It writes mutable `view-state.json` and separate
immutable permalink snapshots. Neither changes notes or image/music originals.
[PERMALINKS.md](PERMALINKS.md) specifies restoration without mutable pile writes.

**Promotion must preserve the available source/editor actions.** Obsidian-backed
items retain their `obsidian://` link; other adapters expose their appropriate
source/original action. DOM promotion must not silently change an item's identity
or make it a dead end. Keyboard reachability under pool pressure remains a gate.

## Piles are view state

Pile membership persists to `view-state.json` beside the config, never into the
notes. Piles are an annotation *over* the corpus rather than a property of any
clip in it — which is what lets several views hold different piles over the same
notes. “The wall never edits source data” is the ownership rule.

It is keyed by **clip URL, not clip id**:

| adapter | `clip.id` | breaks when |
|---|---|---|
| `obsidian.mjs` | the `.md` filename | you rename the note |
| `tiddlywiki.mjs` | the tiddler title | you retitle the tiddler |
| `interests.mjs` | upstream id | upstream reindexes |

`clip.mjs` builds the filename as `slug(title)-sha1(url)[0:6]`, so the id
carries a *title slug* — exactly the thing you correct three weeks later. The
URL is what was actually clipped: stable across renames, retitles, and swapping
the adapter underneath.

Keys that stop resolving are reported to the console, never dropped. A pile
quietly shedding members looks like nothing at all until it is empty.

## Why remote heroes are proxied

A texture atlas is a canvas, so a cross-origin image needs the publisher to send
CORS headers — the loader must request `crossOrigin="anonymous"`, and every
publisher that doesn't send `Access-Control-Allow-Origin` fails **silently**,
leaving a blank tile. Historical session measurement on the same 60 corpus URLs (not a current
network-health check):

| | loads |
|---|---|
| plain `<img>` (the flat wall) | 90% |
| `crossOrigin="anonymous"` (required to atlas) | 63% |
| **lost purely to CORS** | **27%** |

`/api/proxy` serves them from wunderkammer's own origin, which sidesteps it and
stops leaking a referrer to each publisher on every render. Atlas failures fell
from **179/688 to 44/688**, and that remainder matches the genuine link rot the
README's harvest section already documents.

This is a sharper argument for CAPTURE_EXTENSION_SPEC.md
than link rot alone: owned local media gives atlas rendering a predictable
same-origin input, without depending on each publisher's CORS policy.

The proxy is deliberately narrow — http/https only, no private address space,
image content-types only, size-capped by header *and* after reading, and the
host re-validated at **every** redirect hop. These checks are incomplete as a
release boundary: buffering precedes the actual-byte check, requests have no
deadline, and address validation and connection resolution can diverge. See
[RELEASE_PLAN.md](RELEASE_PLAN.md); keep the service on loopback.

## Historical decision: tldraw was not adopted

The session chose a visual exploration surface, external editing ownership and
our existing hybrid renderer. tldraw was considered as an interaction toolkit,
but its editor-oriented shape model and the licensing concerns raised then did
not justify replacing this architecture. This records a past decision, not a
current license analysis or a performance comparison. See
[PRECEDENTS.md](PRECEDENTS.md) before reopening a specific capability question.
An exploration tool may still borrow selection, undo or navigation ideas from
editors without taking over the source store.

## The floating space

The ✺ control, or `?view=float&arrange=oklab|oklch|hsl|az`, floats the whole
corpus in 3D. The model is meodai's 32,000 colour names
([names.color.pizza](https://names.color.pizza/), MIT): each name sits at its
colour, and the page switches between colour models. Apple's HotSauce (1996)
is the warning. It floated a folder tree in 3D, and the depth restated the
hierarchy the tree already showed. So every position here means something,
and the arrangement that has no third dimension (A–Z) gets none.

Source: `wall/float-space.mjs` (positions, pure), `wall/float-view.mjs`
(renderer and navigation), `wall/float.css`. The view is built the way
`wall/aisle-view.mjs` is. `spatial-view.mjs` changed by two `export`
keywords (`sourceFor`, `proxied`).

### What a position means

An item is placed by `palette[0]`, its largest median-cut colour cluster;
`scripts/image_features.py` sorts the palette by pixel count.

| Arrangement | Across | Up | Depth |
|---|---|---|---|
| OKLab | a × k | L | b × k |
| OKLCH | hue angle, radius = relative chroma | L | (cylinder) |
| HSL | hue angle, radius = HSL chroma (max − min) | HSL lightness | (bicone) |
| A–Z | reading order within a shelf | shelf (0–9, A … Z, #) | none: a flat wall |

- **OKLab** uses a single stretch k for both a and b, so hue angles and
  lightness stay exact. Covers and screenshots span about four times as much
  lightness as chroma: 0.51 against 0.21 for the Psychodeli example, and 0.90
  against 0.18 for a 1,793-album library. Unstretched, the space stands as a
  needle down the middle of the stage. k is chosen per collection, rounded to a
  half, capped at 4, and printed on the `+a` label (`×2` and `×4` for those two).
- **OKLCH** keeps OKLab's hue angle, so switching between the two moves items
  only outward or inward. The radius is 700 × √(C / C₉₅), where C₉₅ is the
  collection's 95th-percentile chroma. Muted covers move out to where their hue
  can be read, and one neon outlier cannot press the rest against the axis.
- **HSL** is the bicone, not the cylinder. HSL saturation is unstable at the
  ends: #010300 has saturation 1, and on a cylinder it would sit at full radius
  beside the vivid colours.
- **A–Z** sorts by title with numeric collation and folded accents.
- **No palette.** Items without one wait on a labelled shelf below the space
  ("No palette · n"). They are not dropped, and not parked at the origin.
- **Declumping.** Identical colours are common (black covers, white
  screenshots) and would z-fight. Items closer than 0.6 of a tile edge are
  pushed apart, but never further than 0.6 of an edge from their colour. The
  diagnostics report both the exact and the drawn positions. In the Psychodeli
  example, 245 of 297 items moved: by 21 world units on average (0.011 OKLab
  L), and 54 at most.
- **Tiles** have equal area whatever their aspect, so a panorama does not
  outweigh a portrait. The edge is 680 / ∛N world units, kept between 30 and
  150; lightness spans 2,000 units.
- **Guides** (axes, the hue ring and their labels) span the collection's own
  range and print its extremes, for example `L 0.85 · lightest`. They draw
  beneath every tile, so the grey axis never crosses a neutral cover.

### Scope dims; nothing moves

The field is built once per corpus. Search and facets only change each item's
brightness: out of scope drops to 25%, with most of its saturation removed, so
that in a space arranged by colour a dimmed item does not compete on colour.
Dimmed items are not picked, not listed in the item menu and not stepped to,
so a click passes through them. A placed camera stays where it is. A fitted
camera refits only when the stage resizes, as when the scope bar appears.

### Reaching an item

PHILOSOPHY.md requires that reaching an item never takes camera skill. Fly-to
and the menus are the ways in; free flight is for looking around.

- **Click** flies to the item and opens the detail pane. The camera travels
  along the line from where it is, so it does not turn. The item lands at 38%
  of the stage height, in the middle of the stage left of the detail pane.
- **Item menu** lists the scope by title and flies to the chosen item.
  Inspect, or Enter, opens it.
- **[ and ]** step through the scope in the arrangement's own order: around
  the hue wheel with greys first, or by title in A–Z.
- **Fit** (Home, 0 or ⊡) shows the whole space above the toolbar, from the
  front, above and to the right. A–Z is seen square on.
- **Free flight.** Drag orbits. The wheel dollies toward the pointer
  (OrbitControls `zoomToCursor`). Arrow keys orbit, W A S D fly, Q and E move
  down and up, and + and − dolly.
- **Reduced motion.** Flights and arrangement changes jump instead of animating.

### State and links

The ViewSpec gains `presentation.mode: 'float'` and
`float: { version: 1, arrangement, position, target, fitted, selection }`.
These are validated in `wall/view-schema.mjs`, which the snapshot endpoint
shares.
- **Copy view** carries the camera.
- **The live link (↗)** carries `view=float&arrange=…`, and the receiver fits.
- **Errors.** An unknown `arrange` value is refused with a message; it is
  never ignored.
- **Pile state.** The view never writes it.

### Rendering

- **Primitives.** The vendored `TileField` and `AtlasPair` draw the space in
  one instanced draw call; the guides and the selection ring add two more.
- **Sprite sheets.** Collections that name them draw from their cells through
  `sprite-covers.mjs`, as the 3D view does. A failed page falls back to the
  file.
- **Billboards.** Tiles face the camera: each frame of camera motion
  rewrites every instance's rotation, about 0.3 ms at 1,793 items.
- **Motion.** Arrangement changes use `TileField.moveTo`/`tick`, the
  per-instance motion that the 3D view's pile spreads use. The DOM FLIP in
  `layout-motion.mjs` animates DOM nodes, not GPU instances. A change takes
  about a second, and most of the travel happens in the first quarter.
- **Frame loop.** It runs only while a flight, a transition or atlas work
  (fetch or upload) is pending. An idle space draws nothing.
- **Near atlas.** It has 64 slots (2048², 16 MB) rather than the 3D view's
  256. A fly-to frames a few neighbours, and the smaller texture halved the
  arrival hitch (see PERF.md).

The view patches the vendored fragment shader on its own material and leaves
`lib/` unedited. If the source text it expects is missing, the patch fails
loudly: `dimMode` becomes `hidden`, a status line appears and the tests fail.

1. **Output encoding.** The shader samples the sRGB-tagged atlas, which the GPU
   decodes to linear, and writes the result without re-encoding. Covers draw
   about 2.2 gamma dark, and dark covers turn black. Measured: atlas 169
   renders as 96.
2. **Slot lookup.** The slot index arrives as an interpolated float. At an
   exact multiple of the atlas's column count it can arrive as 4.9999…, and
   `floor` then picks the previous row: slot 5 of a 5-column atlas drew a band
   of slot 4.
3. **Dimming.** TileField writes per-instance opacity as 0 or 1 and draws
   with the depth buffer, not blending. The patch reads the value as
   brightness instead.

The 3D view shares the first two bugs. In the Psychodeli 3D view, atlas
215, 0, 9 renders as 172, 0, 1. Both should be fixed upstream in muriel.

### Proof

- `tests/float-view.test.mjs` places items against Ottosson's published OKLab
  coordinates for the sRGB primaries, and checks HSL, OKLCH angles and A–Z
  order. It also covers fly-to landing and size; dimming with no movement of
  items or camera; per-tile GPU pixels (sRGB, no slot bleed, dimmed colour);
  one render per animation frame; permalinks, live links and refused intent;
  and the phone layout.
- `tests/collection-view.test.mjs` checks that the float atlas draws
  sprite-sheet cells.
- `scripts/check-mutations.mjs` has 17 float cases, all detected.
- Frame times are in [PERF.md](PERF.md): 120 fps throughout at 297 items, and
  at 1,793 items apart from the fly-to arrival.

### Limits

- **Occlusion.** A fly-to can land with a neighbour in front of the item. The
  detail pane still shows it.
- **Collection-relative scales.** The OKLab stretch and the OKLCH radius are
  set per collection, so positions cannot be compared across collections.
- **Lens and sort** are disabled here, as in the 3D view.
- **Shelf labels.** In a dense A–Z wall they hide each other until you fly
  closer.
- **Screenshots.** A screenshot's dominant colour includes its UI chrome.
- **Touch** uses OrbitControls' defaults: one finger orbits; two fingers dolly
  and pan.
- **Header width.** On a collection with similarity icons, ✺ makes the
  header wrap one button sooner. It already wrapped at 1,440 px on main.
- **Phone header.** On a phone the view and zoom buttons scroll sideways
  rather than pushing ↗ onto a fourth row, and ▶ starts partly out of view.

## Known gaps

The prioritized [hybrid hardening plan](HYBRID_HARDENING.md) adds concrete
failure/recovery gates for atlas slot release, callbacks after disposal, WebGL
context loss, Tab exit, focus promotion and the 4096-slot ceiling. These are
source-review findings, not fixes delivered by this documentation pass.


- **`dims` is missing for the harvested corpus**, so every interests clip falls
  back to a 4:3 aspect while its hero is 16:9 or 2:1 — cards are shaped wrong
  and `object-fit: cover` crops them. This is gap 1 of
  CAPTURE_EXTENSION_SPEC.md showing up in the
  render.
- **Spatial tiers do not select separate source derivatives.** Both resolve to
  the same cover file before downscaling. The flat music view already has 128px
  and 640px variants; use `resolve(i, tier)` in `spatial-view.mjs` to extend that
  benefit to spatial loading, with separate fetch/decode/texture budgets.
- **Frame rate on real hardware** was first measured 2026-09-10 with
  `scripts/perf.mjs` in headed Chrome ([PERF.md](PERF.md)). The render loop
  now draws on demand: a stationary camera over a settled field renders
  nothing, and the near tier is budgeted to the nearest `capacity` instances
  rather than requested by every instance inside the near band. Decoded-image
  memory and non-Apple GPUs remain unmeasured.
- **Hand-made piles aren't wired to a gesture yet.** `PileLayout.createPile()`
  and `assign()` exist and round-trip through view state, but nothing in the UI
  calls them — piles are currently facet-derived only.

### Verification record — 2026-09-07

At the spatial checkpoint, the integrated application passed 37 tests, including spatial coverage, idle
pixel equality on the 406-item fixture, pointer/keyboard/touch opening, GPU/DOM
rectangle alignment, empty/subset replacement, and existing persistence safety.
All nine mutations available at that checkpoint were detected. Upstream Muriel passes
five pile-depth, spread-width, and DOM-eligibility checks; synced library content
matches the upstream working tree. Both checkouts remain uncommitted.

On the real 406-image instance, Chromium hover rerasterization changed 18 border
pixels out of 1,237,296 by at most 2/255 per channel. The live comparison allows
only this level of antialiasing noise (at most 2/255 on less than 0.01% of the
pane); it does not treat camera movement or image displacement as acceptable.
The fixture still requires exact idle screenshot equality.

See HANDOFF.md for the later integrated test checkpoint and
exact limits of verification after the heading-font change.
