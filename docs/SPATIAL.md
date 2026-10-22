# The spatial view

> Since 2026-10-18 the **3D** button opens [the floating space](#the-floating-space)
> in Axes. This renderer draws its last arrangement, **Stacks**, and still
> answers `?view=3d` links and version-1 saved piles.

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

The **3D** button, or `?view=float&arrange=axes|oklab|oklch|hsl|az`, floats the
whole corpus in 3D. The model is meodai's 32,000 colour names
([names.color.pizza](https://names.color.pizza/), MIT): each name sits at its
colour, and the page switches between colour models. Apple's HotSauce (1996)
is the warning. It floated a folder tree in 3D, and the depth restated the
hierarchy the tree already showed. So every position here means something,
and the arrangement that has no third dimension (A–Z) gets none.

Source: `wall/float-space.mjs` (positions, pure), `wall/float-view.mjs`
(renderer and navigation), `wall/arrange-menu.mjs` (the Arrange by menu it
shares with the stacks), `wall/float.css`. The view is built the way
`wall/aisle-view.mjs` is. `spatial-view.mjs` changed by two `export`
keywords (`sourceFor`, `proxied`).

### The 3D entry

The 3D button used to open the stacks: facet groups as piles on an upright
plane. Their positions restate group membership, which the flat wall's group
headings already show. The button now opens the floating space in **Axes**, so
the first 3D view carries information the wall does not.

- **Default axes.** `resolveAxes` picks them, with no special case: Across
  takes the collection's time (`captured`, then `year`, then `decade`), Up takes
  lightness, Depth takes hue. On the demo collection, the Psychodeli example
  with 289 frames and 12 video loops, Across is the capture date. It runs from
  2025-11-03 to 2026-09-07; the loops, recorded later, carry it past April.
  Lightness and hue, which no grouping shows, take the other two axes.
- **Alternatives rejected on the demo.**
  - `year` across collapses to two slabs, 2025 and 2026.
  - `complexity` across gives three planes that restate a facet.
  - Hue across with capture date in depth reads hue well, but foreshortens
    the timeline into the receding axis.
- **The stacks are the last entry** in Arrange by: Axes, OKLab, OKLCH, HSL,
  A–Z, Stacks. They are drawn by `spatial-view.mjs`, not by moving these
  tiles, so choosing Stacks hands over to that renderer. A strip along the
  stage's foot then carries the same menu, with the menu where the floating
  space's toolbar puts it, and any other entry hands back. The stacks host
  ends above the strip, and the stacks fit there.
- **The 3D button and the `3` key** reopen the last 3D presentation: the
  floating space, until a reader chooses Stacks.
- **Links keep their meaning.**
  - `view=3d` still opens the stacks, and saved `mountain`/`piles` state
    restores as before.
  - `view=float&arrange=…` opens what it names.
  - A link that names no arrangement now opens Axes; it used to open OKLab.
    No link the page writes omits it.
- **The ✺ button is gone.** On a 390 px phone, where pinch replaces − and +,
  the header's view strip held six 40 px buttons spanning 260 px of its
  282 px. It now holds five, spanning 216 px, which frees a slot.

### What a position means

An item is placed by `palette[0]`, its largest median-cut colour cluster;
`scripts/image_features.py` sorts the palette by pixel count.

| Arrangement | Across | Up | Depth |
|---|---|---|---|
| OKLab | a × k | L | b × k |
| OKLCH | hue angle, radius = relative chroma | L | (cylinder) |
| HSL | hue angle, radius = HSL chroma (max − min) | HSL lightness | (bicone) |
| A–Z | reading order within a shelf | shelf (0–9, A … Z, #) | none: a flat wall |
| Axes | a chosen dimension | a chosen dimension | a chosen dimension |

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

### Axes: a chosen dimension on each axis

Axes puts one dimension on each of Across (x), Up (y) and Depth (z). Three
menus labelled Across, Up and Depth appear in the toolbar while Axes is
chosen. Picking a dimension that another axis already holds swaps the two, so
the three axes always differ and no axis restates another. Every axis is
2,000 world units long, the same as lightness in the colour arrangements.

**What an axis can carry.**

| Dimension | Position along the axis |
|---|---|
| Lightness | OKLab L, absolute 0–1, the same as `y` in the colour arrangements, so OKLab ↔ Axes with lightness up moves no item vertically |
| Chroma | √(C / C_max), relative to the collection's most saturated item |
| Hue | one turn of OKLCH hue, starting at the centre of the collection's emptiest 30° window, so no populated hue family is split across the two ends |
| Ordered attribute with a range (capture date, year, decade, numbers) | linear from the collection's minimum to its maximum |
| Ranked attribute (complexity, compression) | evenly spaced planes, in rank order |
| Categorical attribute, single-valued, 2–12 values | evenly spaced planes, in alphabetical order |

- **Where the values come from.**
  - Colour dimensions use `palette[0]`.
  - Attributes use `attributes.mjs` `attributeModel`, over the wall's own facet keys (the keys the sort and lens menus offer).
- **What is not offered.**
  - A multi-valued categorical, such as colour family or genre: an item can stand in only one plane, and picking one of its values would be arbitrary.
  - A categorical with more than 12 values: its planes would be thinner than a tile.
  - An attribute with a single value.
  - A facet whose key is `lightness`, `chroma` or `hue`, because those names are reserved.
- **Several values on an ordered attribute.** The axis takes the earliest or lowest, as the lens does, and its title says so ("release year, earliest of several").
- **Defaults.**
  - Across is time: capture date, then year, then decade, then any other ordered attribute, then a categorical, then chroma.
  - Up is lightness, and Depth is hue.
  - The Psychodeli example opens as capture date × lightness × hue, and a 1,793-album music library as release year × lightness × hue.

**Missing values.** An item without a value waits in a labelled slot 12% of the axis length outside the axis.
- **Across and Up:** the slot is before the axis start.
- **Depth:** the slot is beyond the far end, behind the data. A large missing group must not stand between the camera and everything else. In the music library, 808 of 1,793 covers (45%) have no hue.
- **Hue:**
  - Greys (OKLCH chroma below 0.02, the threshold the reading order already uses) wait in "Grey, no hue · n".
  - Items with no palette wait one slot further out.
- **Other colour axes:** items with no palette wait in "No palette · n".
- **Attributes:** the slot reads "No ‹attribute› · n", for example "No release year · 249" in the music library. As in the lens, `unknown` and `uncertain` count as missing.

**Collisions.**
- **Declumping** stays bounded: items closer than 0.6 of a tile edge are pushed apart, never more than 0.6 of an edge from their place, with no jitter.
- **Direction.** It moves items only along colour axes, so an item never leaves its date, year or category plane.
  - With no colour axis, it moves them along continuous attribute axes (time, numbers).
  - With only planes, it moves them along all three axes.
- **Measured:**
  - Psychodeli, capture date × lightness × hue: 156 of 297 items moved, by 11.6 world units on average and 61 at most. The cap is 61.2.
  - Music, year × lightness × hue: 851 of 1,793 moved, by 7.2 on average and 33.6 at most. The cap is 33.6.

**Guides and labels.**
- **Axis lines** run along the box edges that face the camera:
  - Across along the front-bottom edge;
  - Up up the front-left edge;
  - Depth back along the right-bottom edge.
- **Ticks** sit beside the line, away from the cloud, a fixed number of pixels off it:
  - dates show the first and last day, then month or year starts ("Dec", "Jan 2026");
  - numbers with up to 12 values show each value, and others show round numbers;
  - planes show "value · count";
  - hue shows the six hue names at their OKLCH angles, and the start angle at both ends.
- **Overlap.** Labels are drawn in priority order (titles, then slots, then ticks), and a label that would touch an earlier one, or the toolbar, hides until the camera comes closer.
- **Fit** looks from 20° right and 16° above, more nearly frontal than the colour arrangements, so Across reads level and long. It frames each label's drawn box as well as the tiles.

### Scope dims; nothing moves

The field is built once per corpus. Search and facets only change each item's
brightness: out of scope drops to 25%, with most of its saturation removed, so
that in a space arranged by colour a dimmed item does not compete on colour.
Dimmed items are not picked, not reached by arrow keys and not matched by jump,
so a click passes through them. A placed camera stays where it is. A fitted
camera refits only when the stage resizes, as when the scope bar appears.

### Reaching an item

PHILOSOPHY.md requires that reaching an item never takes camera skill. Fly-to,
the arrow keys and jump are the ways in; free flight is for looking around.

- **Click** flies to the item and opens the detail pane. The camera travels
  along the line from where it is, so it does not turn. The item lands at 38%
  of the stage height, in the middle of the stage left of the detail pane.
- **Arrow keys** move the selection through the space along its own axes.
  Each arrow maps to the arrangement axis that points that way on screen from
  the current camera (across, up, then depth for Page Up and Page Down), and
  moves to the next in-scope item that way, preferring one that stays close on
  the other two axes (`nearestAlong`: distance along the axis plus twice the
  distance off it). The first press takes the item nearest the point the camera
  looks at. Each move flies to the item without opening it; Enter opens it.
  Isolated items can have no arrow path in (3 of the demo's 297); jump and click
  reach them.
- **Callout.** Beside a keyboard-chosen item, on whichever side has room (below
  or above it on a narrow stage), a callout in the selection ring's green gives
  its title and where it sits in the arrangement's terms (`describeItem`): the
  Axes dimensions, or lightness, hue and chroma, or the A–Z shelf. A hidden
  live region says the same to a screen reader. Neither takes room in the
  toolbar, so no control moves when focus comes and goes.
- **Jump.** `/` opens a box at the top of the stage; type part of a title,
  ignoring case and punctuation, and Enter flies to the first match (titles
  that start with it, then titles that contain it). Focus returns to the space,
  so the arrows carry on from there.
- **Without 3D graphics** the status offers the flat wall, which holds every item.
- **Fit** (Home, 0 or ⊡) shows the whole space above the toolbar, from the
  front, above and to the right. A–Z is seen square on.
- **Free flight.** Drag orbits. The wheel dollies toward the pointer
  (OrbitControls `zoomToCursor`). Shift+arrow keys orbit, W A S D fly, Q and E move
  down and up, and + and − dolly.
- **Reduced motion.** Flights and arrangement changes jump instead of animating.

### State and links

The ViewSpec gains `presentation.mode: 'float'` and
`float: { version: 1, arrangement, axes?, front?, position, target, fitted, selection }`.
`front` orders a cloud (`arrange=cloud`; [SHOTS.md](SHOTS.md#the-cloud-phase-2c)): a dimension id, with a leading `-` for lowest first.
These are validated in `wall/view-schema.mjs`, which the snapshot endpoint
shares.
- **Axes state.** `axes` is `{ across?, up?, depth? }`: dimension ids, distinct, each a colour name or a facet key. Any slot left out takes the collection's default. The version stays 1, since links without `axes` mean what they always did.
- **Copy view** carries the camera and the axes.
- **The live link (↗)** carries `view=float&arrange=…`, plus `across`, `up` and `depth` for Axes, and the receiver fits. A hand-written link may name only some of the axes (`?view=float&depth=complexity`); the axis parameters imply `arrange=axes`.
- **Errors.** A link is refused with a message, never ignored, when:
  - its `arrange` value is unknown;
  - it puts one dimension on two axes;
  - it gives axis parameters with another arrangement;
  - it names an axis the collection cannot carry ("across=genre is not a dimension this collection can place on an axis").
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

- **Dimming.** TileField writes per-instance opacity as 0 or 1 and draws
  with the depth buffer, not blending. The view patches the vendored fragment
  shader on its own material, leaving `lib/` unedited, to read the value as
  brightness. The step runs after each of the shader's two output lines (the
  sampled tile and the `emptyColor` placeholder), on the colour upstream has
  already encoded, so `FLOAT_DIM` is a share of displayed brightness. If the
  output lines it anchors on are missing, the patch fails loudly: `dimMode`
  becomes `hidden`, a status line appears and the tests fail.
- **Fixed upstream.** The float view used to patch two more shader bugs,
  which the 3D view shared. muriel fixed both in `99ea62b`, and `lib/` now
  vendors that commit.
  - **Output encoding.** The shader sampled the sRGB-tagged atlas, which the
    GPU decodes to linear, and wrote the result without re-encoding. Covers
    drew about 2.2 gamma dark, and dark covers turned black. In the
    Psychodeli 3D view, atlas 215, 0, 9 rendered as 172, 0, 1. Both outputs
    now pass through `linearToOutputTexel`.
  - **Slot lookup.** The slot index arrives as an interpolated float. At an
    exact multiple of the atlas's column count it could arrive as 4.9999…, and
    `floor` then picked the previous row: slot 5 of a 5-column atlas drew a
    band of slot 4. The index is now rounded before the row and column are
    derived.

### Proof

- `tests/float-view.test.mjs` places items against Ottosson's published OKLab
  coordinates for the sRGB primaries, and checks HSL, OKLCH angles and A–Z
  order. It also covers fly-to landing and size; dimming with no movement of
  items or camera; per-tile GPU pixels (sRGB, no slot bleed, dimmed colour);
  one render per animation frame; permalinks, live links and refused intent;
  and the phone layout.
- `tests/collection-view.test.mjs` checks that the float atlas draws
  sprite-sheet cells.
- The 3D entry test ("the 3D button opens the floating space in Axes…") opens
  the default axes from the flat wall and checks the menu order. It then
  checks the hand-over to the stacks and back, and that the stacks fit above
  their strip. It also checks the button and `3` returning to the last 3D
  view, an exact link made in the stacks, a live link after handing back, and
  that `?view=3d&group=year` and a bare `?view=float` open what they name.
- The Axes tests check positions against independently computed expectations:
  - capture time, linear (the fixture's dates are unevenly spaced, so rank spacing would fail);
  - lightness from Ottosson's table;
  - hue from a second transcription of OKLab, checked against that table, with the emptiest-window start found by brute force;
  - ranked and categorical planes;
  - the grey, no-palette and missing-year slots and their labels;
  - plane exactness under declumping, using a three-shot burst that shares one place;
  - swapping, label placement after Fit, and the phone toolbar and fill.
  - Link tests cover exact and live round trips, partial links, and the four refusals.
- `tests/spatial-view.test.mjs` "3D tiles draw their cover colour…" does the
  same per-tile check on the 3D view, which draws the shader unpatched. 25
  flat covers fill both atlases so slots at a multiple of the column count
  are drawn (5, 10, 15, 20 in the far atlas; 16 in the near one), a 404 and a
  missing cover take the two `emptyColor` paths, and 25 points per tile are
  read in both tiers, 1,250 samples in all. The old shader failed 961 of
  them. With only the encoding fix reverted, 950 failed. With only the slot
  fix reverted, 13 failed: far slots 5 and 15, and near slot 16.
- **On real covers** (the Psychodeli example in the 3D view, 400 points over
  80 tiles, frame pixel against the atlas texel it samples), the old shader
  drew the frame at 0.43× the atlas's brightness, a bias of about −40 per
  channel. The fixed one draws it at 1.01×, a bias under 1.
- `scripts/check-mutations.mjs` has 35 float cases, 4 for the 3D entry and 2
  for the 3D view's shader, all detected. The two float shader cases now mutate the vendored
  upstream file, not a patch in the float view.
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
- **Phone header.** On a touch phone, pinch replaces − and +, and the rest
  of the row fits a 375 px screen without scrolling.
- **Stacks hand over, they do not travel.** Choosing Stacks swaps renderers,
  so items do not move from their Axes places into piles the way they move
  between the other arrangements.
- **Axes depth reads least.** From Fit, Depth recedes and its ticks crowd at
  the far end; orbit to read it. This is the cost of keeping Across level and
  long.
- **Axes scales are collection-relative** (time, numbers, chroma and the hue
  start), so an Axes position cannot be compared across collections. Only
  lightness is absolute.
- **The hue axis is cut.** Hue is a circle laid on a line. The start is chosen
  where the collection is emptiest and printed at both ends, but the two ends
  are neighbours in colour.

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
