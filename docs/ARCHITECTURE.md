# Wunderkammer architecture and product contracts

**Updated 2026-10-17.** [PRODUCT.md](PRODUCT.md) is the product direction.
This document separates current integration points from intended contracts.

## Current paths

| Responsibility | Canonical path |
|---|---|
| Capture and preservation | `clip.mjs`, `lib/capture-store.mjs`, `lib/frontmatter.mjs` |
| Image archive indexing and feature extraction | `scripts/index-images.py`, `scripts/image_features.py`, `adapters/images.mjs` |
| Music cover indexing | `scripts/index-music.py`, `adapters/music.mjs`; [album identity and provenance](MUSIC_CORPORA.md) |
| Instance configuration | `lib/instance-config.mjs`; `serve.mjs --config <path>` |
| Corpus normalization | `adapters/`, served by `serve.mjs` at `/api/clips` |
| Search, facets, active subset, presentation choice and item focus | `wall/wall.mjs` |
| Contextual facet counts and value discovery | `wall/facet-model.mjs`, using canonical `filterScope()` / `matchesFacet()` from `wall/context-clusters.mjs` |
| Facet controls and transient value search | `wall/facet-rail.mjs`; scope-changing callbacks remain in `wall/wall.mjs` |
| Flat layout and camera | `wall/layout.mjs` (similarity map: `wall/similarity-layout.mjs`), `wall/viewport.mjs`, bounded transitions in `wall/layout-motion.mjs` |
| Similarity coordinates (index time) | `scripts/projection.py`, called by both indexers; exposed as `clip.projection` |
| Flat overview and image scheduling | `wall/overview-surface.mjs`, `wall/image-work.mjs` |
| Spatial presentation | `wall/spatial/spatial-view.mjs`; vendored renderer described in [SPATIAL.md](SPATIAL.md) |
| Item detail | `openDetail()` in `wall/wall.mjs`; sizing/input in `wall/detail-pane.mjs`; artwork continuity in `wall/reader-lift.mjs` |
| Persisted pile state | `wall/view-state.mjs` → `/api/view-state` → `lib/view-state.mjs` |
| Attribute ordering and preview | `wall/attributes.mjs`, `wall/attribute-brush.mjs`; `state.sort` orders a copy |
| Versioned view links | `wall/permalink.mjs`, `captureView()` / `restoreView()`, `lib/permalinks.mjs`; separate immutable snapshot store |

`state.query`, `state.active` and optional union branches feed `filterScope()` and `applyFilters()` to derive
`state.filtered` from `state.clips`. Both renderers consume that filtered set.
Current text search is case-insensitive substring matching across title, note,
source, URL, and tags; every whitespace-separated term must appear. It is not
fuzzy or semantic retrieval. Facets support OR within a key and AND across keys;
captured-date choices use prefix matching.
An instance may set `ui.hiddenFacets` to omit selected fields from the filter rail,
grouping, sort, and lens controls while retaining their values on the clips. A
derived period property can then provide broad date buckets without discarding
the exact `captured` date used in each clip's detail.

Facet-local search matches value labels, including arbitrary properties outside
the global text index. It owns only rail browsing state; it does not change
scope, camera, or saved links. The rail retains selected values and offers 24
more values at a time. Counts show **In view / available**: current membership
and membership with only that facet's own restriction omitted. Other facets,
global text and frozen branches still apply. Counts assume normalized unique
corpus records and deduplicate repeated values within each record. They never
count rendered occurrences. Preview uses the same value predicate as filtering,
including restored captured-year prefixes. Per-facet clearing and scope-summary
removal use the existing history path. See [FACETING.md](FACETING.md) for exact
semantics, examples, evidence and recovery behavior.

The flat layout provides justified rows, grouped blocks and a similarity map.
The spatial view maps the same subset into the field (rows or the similarity
map) or facet-derived piles. The artwork aisle uses the same canonical groups,
sort and attribute brush through `wall/aisle-view.mjs` and shared
`wall/album-walls.mjs`. Readable URL intent feeds the existing ViewSpec/history
path; see [AISLE.md](AISLE.md) for the integration boundary. The detail panel
displays an item; it does not currently implement relationship navigation.

## Required state boundaries

Extend these existing paths as capabilities land. The following are conceptual
contracts, not a new implemented schema or a requirement to adopt a framework.

| State | Responsibility and boundary |
|---|---|
| Corpus | Adapter-backed clip records; independent of presentation |
| Scope | Search query and active facets; a future committed relation pivot must describe its anchor, relation, and search boundary |
| Working subset | Derived matching identities; shared by Survey, Review, and Dive |
| Presentation | Survey arrangement or Review layout/grouping/sort; must not change membership |
| Focus | The current item; distinct from subset membership, viewport visibility, and transient hover |
| Return context | Prior scope, presentation/order, focused identity, and view position needed to undo navigation |

Keep one authoritative scope evaluator. A renderer or related-items panel must
not quietly maintain a different interpretation of the active query/facets.
Renderers may cull content for performance; culling does not remove it from the
subset or its count. If grouping displays a multi-valued clip in several groups,
those occurrences remain one clip identity.

## Transition contract

- Presentation switch: retain scope and focused identity; preserve each
  presentation's position so returning does not start over.
- Search/facet edit: derive the subset once and update participating views.
  Handle a focused item outside the new scope explicitly. Hidden presentations
  are marked dirty and materialized when entered, rather than laid out twice.
- Layout/group/sort edit: change presentation only. Keep sort order explicit
  and deterministic so Dive can traverse it without rebuilding a different list.
- Item preview: temporary; does not commit a new query or rearrangement.
  A hover dwell (with a selection) or zooming in until one item dominates the
  free view ([ZOOM_DETAIL.md](ZOOM_DETAIL.md)) both preview; neither selects,
  moves the camera or writes focus.
- Relationship pivot: describe why results are related and whether the search
  is within the current subset or corpus-wide; record prior context before
  committing the new scope. Back restores that context.

Versioned permalinks now restore current scope, grouping, focus, UI geometry and
flat/spatial cameras; browser and in-app Back share that restoration path.
Broader relation providers and retained historical corpus revisions remain open.

## Identity and durable view state

Existing durable pile keys use clip URL because adapter ids can change on note
rename or reindex. Keep that distinction for future saved context; do not use
array indices, atlas slots, or transient DOM elements as persistent identity.
Define migration or disambiguation explicitly before changing the identity rule.

There are two persistence contracts: mutable version-1 pile state, and version-1
ViewSpec in inline URLs or immutable permalink snapshots. ViewSpec already
captures scope, sort, lens, cameras, focus and UI configuration. It does not
archive the corpus or an entire browsing session. Do not expand the pile file
into a competing view schema. Preserve hidden and unresolved pile keys when
saving a filtered view. Current saves are serialized, atomically
replace the document, surface failures, and use last-successful-save semantics
across tabs. A failed initial read blocks subsequent saving.

Wunderkammer never edits notes from the wall. Layouts, layers, sorting, and
pivots must preserve that ownership boundary and capture's non-overwrite rules.

## Layout and scale decisions

Group headings and counts follow the canonical viewport zoom callback. Their
screen sizes grow gently with zoom: headings stay between 14 and 28px, and
counts stay at least 12px. CSS converts these sizes back into world units, so
zoom does not repack the collection. Headings disappear when their reserved screen-space band or width cannot fit
readable text. The screen-space group control preserves an approach route at
overview scale; it does not overlap neighbouring trays with enlarged labels.

The flat wall passes the usable stage aspect to `layout()`. A bounded search
across candidate widths selects the composition with the greatest projected
tile area after Fit. Justified rows retain media proportions; grouped blocks
are packed as an order-preserving strip treemap: rows of blocks that each span
the wall, every block as wide as its share of the row's area.
The layout stays deterministic for a given subset, grouping and viewport.

Flat tiles are keyed by group occurrence plus clip id so multi-valued facets
render every occurrence; selection and details still refer to the one clip.
Subset edits reframe the result. A ResizeObserver recomposes fitted overviews
when the stage or filter rail changes, but preserves custom pan/zoom positions
until the user requests Fit. Fit uses a modest screen-space margin rather than
a fixed world width. These changes do not modify spatial pile persistence.

### Similarity arrangement (2026-10-14)

`similarity` is offered in the grouping select whenever the corpus carries
projection points; its key `@similarity` is stored in `presentation.group`, so
permalinks and saved view state carry it unchanged. `scripts/projection.py`
writes `projection: {x, y}` per item at index time (method `pixels-umap-v1`: a
12×12 RGB thumbnail plus a 4×4×4 colour histogram, PCA 50, UMAP cosine, seed
42), from the cached 128 px overviews; both indexers call it and keep the last
coordinates when UMAP is not installed. A later CLIP embedding writes a
different `method` into the same field; the wall reads only x and y.

`wall/similarity-layout.mjs` places the whole corpus once (memoised per corpus
array): each axis is replaced by its rank to spread UMAP's clumps, tiles are
equal-area, and a placement sweep moves any tile that would come within the gap
of an earlier one to the nearest free point on growing rings, which is bounded
and guarantees no overlap. The stage aspect only stretches one axis by ≥ 1, so a
resize never re-spaces the map. A filter hides tiles in place: the subset keeps
its universe positions, translated to the origin, and Fit reframes it.
Unprojected items stay in scope in justified rows beneath the map. The 3D field
uses the same places; facet piles are unchanged. The fit pass raises the 3D
camera's far plane when a sparse map needs it. Layout switches use the existing
bounded FLIP in `layout-motion.mjs`; the GPU position blend for 3D is a separate
TODO.

#### Similarity grid, arrangement icons and spread on zoom

`similarity grid` (`@similarity-grid`) is the same map snapped to a lattice at
index time (`snap_to_grid` in `scripts/projection.py`, after PixPlot's grid):
one record per cell, cells from an exact linear assignment (scipy) in blocks of
up to 2,048 cells, recursive bisection above that. It keeps more of each item's
ten nearest map neighbours than the spaced map (~0.6 against ~0.5 on the Music
Atlas) and lays out in 15 ms at 10k against 305 ms for the map's first
placement. Cells take the corpus's median aspect; each image is contained in its
cell. **A filter leaves holes; it does not re-pack.** Survivors keep their cells,
so a colour region stays where it was across facet changes (the same contract as
the map and as 3D membership), and re-packing would mean solving an assignment
in the browser. Fit reframes the survivors' bounds, so a narrow filter still
fills the stage.

Three icons beside the grouping select (grouped wall, similarity grid,
similarity map; after PixPlot's layout icons) set that same select, so there is
one value for permalinks, view state and the 3D field. The wall icon returns to
the last facet grouping. The icons are hidden when the index has no projection.
Pressed state is `--accent-on` on solid accent (14.8:1); idle glyphs are `--text`
on `--panel-2` (16.0:1).

**Spread on zoom lives in the 3D field, not the flat wall.** After Collection
Space Navigator (umap-explorer's zoomScaler), the 3D similarity map holds each
tile between 14 and 28 screen pixels while zoom scales only the distances, so a
dense neighbourhood opens instead of its covers growing (`_applySpread` in
`spatial-view.mjs`, `spreadScale` in `similarity-layout.mjs`). Reading size comes
from an explicit act: hover grows that one tile to 96 px and opens the existing
hover preview; a click opens the detail pane. Measured before choosing: holding
DOM tiles at a fixed screen size means rewriting every tile's transform each
zoom frame, which doubled zoom frame time in an unoptimised standalone 1,793-tile page
(p95 76 → 150 ms, headed Chrome @2x) and would also force the flat overview
canvas to repaint every frame; in 3D it is one instance-size write per tile,
only when the camera distance changes. The flat wall therefore keeps
world-sized tiles: the grid is its similarity view, the map is offered too.

Retain the existing layout/renderer boundary while evaluating alternatives.
egjs JustifiedGrid is a candidate for Review; PackingGrid is a candidate for
small grouped compositions, with aspect-ratio tradeoffs to measure. Neither is
adopted. A scrolling collection library is not a ready-made replacement for the
Survey camera. Linklore is an architectural reference, not a selected backend.
[PRECEDENTS.md](PRECEDENTS.md) records primary sources and the user's Tapestry
licensing preference without asserting an unverified repository identity.

The approved spatial metaphor uses depth for containment and attention: a tray
spreads in place, retains its rim/name, and lends an item to the reader. Approach
changes the camera; explicit filtering changes membership. See
[SMOOTH_SPATIAL.md](SMOOTH_SPATIAL.md) for the six-slice contract and open work.
Measure layout time, visible-item reachability, image loading, total DOM count,
GPU memory, and input responsiveness at named corpus sizes on real hardware.
The current far atlas has a 4096-pixel dimension cap: at 64 pixels per tile it
has 4096 slots. A fixed near/DOM pool does not establish unbounded corpus support,
and the flat wall's DOM remains present alongside the spatial view.

## Verification

Use the cross-activity journeys in [PRODUCT.md](PRODUCT.md) as implementation
acceptance criteria. Exercise real pointer and keyboard paths, reduced motion,
empty/tiny subsets, missing media, and return navigation. Keep tests isolated
from the configured vault and real view-state file. Existing regressions run
with `npm test` and `npm run test:mutations`; they do not yet prove the proposed
layer or relation-pivot features. Flat Review sorting, attribute brushing, and
pinned-lens restoration have dedicated coverage in `tests/attribute-view.test.mjs`.

### Attribute exploration

`attributes.mjs` supplies one model for value ordering, missing values and color
encoding. `attribute-brush.mjs` applies transient previews to existing tile nodes
without changing membership, geometry or camera. `state.sort` orders only the
flat layout input, preserving canonical filtered membership. The permalink stores
`presentation.sort` and `ui.lens`; it deliberately excludes transient hover.
See [ATTRIBUTE_EXPLORATION.md](ATTRIBUTE_EXPLORATION.md) for the interaction contract.

### Flat-layout verification (2026-09-07)

With the live 728-clip corpus grouped by source at a 1440×900 browser viewport
(1224×844 usable stage), the old fixed-width layout used 4.0% of the stage width;
the corrected composition uses 94.1%. Projected tile rectangles cover 56.1% of
the stage instead of 1.9%, and mean thumbnail height rises from 4.4 to 24.1 CSS
pixels. This measures layout occupancy, not successfully loaded image pixels:
many harvested remote previews were still pending or unavailable during capture.

The regression suite passed 31 tests; the live interaction/contrast check passed
27 checks. Seven deliberate mutations were detected, including restoring the
fixed-width call and collapsing tag occurrences. Rendered regressions cover
800×1000, 1440×900 and 1920×900 viewports, rail changes, empty/single-item subsets,
manual camera preservation, and pointer/keyboard/touch opening of repeated tags.
The final caption adjustment and layout passed a further seven focused tests.

Image-only instances use a derived local index and previews, with original files
remaining on explicit read-only roots. See [IMAGE_CORPORA.md](IMAGE_CORPORA.md)
for date provenance, heuristic attributes, refresh and cache semantics.


### Detail pane sizing

The inspector defaults to 40% of the window width, bounded to preserve collection
space. Its left-edge separator supports pointer/touch dragging and Left/Right
keyboard resizing (Shift for larger steps, Home/End for bounds). Double-click
restores the proportional default. The chosen width persists between items and restores through ViewSpec; no
corpus or saved-pile data is written. At 800px and
below, the inspector fills the window and restores its previous desktop sizing
when widened. Closed inspectors are inert.

The inspector overlays a stable stage. Opening, resizing, stepping and closing
it do not repack the collection. A minimal camera translation exposes the
selected item beside the desktop reader; closing restores the saved camera
when scope/layout and window geometry remain unchanged. A presentational image
ghost lifts from the source rectangle and returns to it; thumbnail pixels stay
until the larger image decodes. On mobile, the reader makes the stage inert,
contains keyboard focus, and supports horizontal swipe within vertical scroll.
Images use contain sizing bounded by available window height; metadata scrolls
inside the pane and the resize handle remains reachable while scrolling.


The optional [edge-pan prototype](EDGE_PAN_PROTOTYPE.md) uses `edge-pan.mjs`
inside the existing flat `Viewport`; it does not introduce a second camera or
subset. Its geometry envelope comes from rendered tile rectangles. The mode is
opt-in and URL-addressable (`pan=bounded` / `pan=edge`); gesture recovery is
transient and expires when geometry changes. 3D conversion remains unimplemented.

## Context clusters and union scope

`wall/context-clusters.mjs` supplies exact URL-keyed membership selection and
explainable facet candidates. `wall/wall.mjs` owns `branches` (null for the whole
corpus, otherwise an OR union), query/facet refinements, and URL-backed browser
history. `filterScope` produces the single `state.filtered` consumed by
both renderers. Context is the full corpus on a background plane inside the
canvas (`#bg-plane`, `renderBackground()` / `frameAround()`), mounted only while
revealed; it never alters Viewport Fit content or stage geometry, though it
widens the pannable item set through `Viewport.setItems` while mounted. A
viewport callback latches the reveal below 90% of Fit scale; Fit, scope change
and 3D clear it. The cluster suggestion panel is rendered but unplaced. Back
restores a camera snapshot through `Viewport.restore`; saved piles and clip
data remain independent. See
[CONTEXT_CLUSTERS.md](CONTEXT_CLUSTERS.md) for semantics and limitations.

## Permalink implementation

[PERMALINKS.md](PERMALINKS.md) documents the implemented version-1 ViewSpec for
URL-copy restoration of scope, presentation, arrangement, camera, focus and UI
configuration. Small states are inline; large states use immutable snapshot
references. Snapshot storage is separate from mutable saved piles and source
corpora. Only deliberate user changes update the URL; hydration suppresses
ordinary auto-Fit, writes and conflicting input.


### Responsive cover images

Adapters may supply `coverVariants: [{src, width}]` alongside `cover` and
`detailCover`. The flat renderer uses each visible tile's transformed screen
width for source selection, so an overview does not decode a review-size image
for every tiny tile. Music collections provide 128px and 640px tiers; detail
uses the separate large preview. Adapters without variants retain their current
single-cover behavior. Visible image upgrades are prioritized and deferred until
camera/layout travel settles, with bounded concurrency. Each responsive upgrade
decodes a detached replacement before exchanging its image in the existing tile;
the previous pixels remain painted throughout the request. Reader loading prepares
only the current item and immediate neighbours, discarding stale generations.

Dense flat views paint a bounded, viewport-sized overview while retaining the
same DOM hit targets and keyboard identity. Hysteresis prevents representation
flapping; attribute lenses restore the DOM images. A complete cached picture
can move through the compositor, with decoded DOM images at exposed edges.
Its pixels survive a close-reading interval so zoom-out can reuse them; a new
layout invalidates that picture, and settling refreshes it at target resolution.
When reuse is unavailable but visible DOM images are decoded, they carry the
gesture and the overview rebuilds at rest. Cold edges retain the bounded redraw
path. Settled views schedule no
continuous overview frames. Spatial DOM promotion also requires visible,
sufficiently large projected geometry; pool incumbency alone is insufficient.

## Hardening and delivery

[HYBRID_HARDENING.md](HYBRID_HARDENING.md) records current atlas, lifecycle,
focus and capacity risks with source anchors and proposed failure fixtures.
[RELEASE_PLAN.md](RELEASE_PLAN.md) covers dependencies, local API boundaries,
clean installation and artifact provenance. Treat those as open work; the
historical test records above do not certify a release.
