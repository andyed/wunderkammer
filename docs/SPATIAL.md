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
