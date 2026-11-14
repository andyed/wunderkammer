# HTML-in-Canvas Phase 3: live cards on the card host

Spec written 2026-11-13. Status: **not started; needs Andy's go.** It follows
[HTML_IN_CANVAS_EXPERIMENT.md](HTML_IN_CANVAS_EXPERIMENT.md), whose Phase 3 was
gated on a hit-testing probe that now passes
([results, section 7](HTML_IN_CANVAS_RESULTS.md#7-p08-re-run-2026-11-13)). Read
both first, then [SPATIAL.md](SPATIAL.md) and
[HYBRID_HARDENING.md](HYBRID_HARDENING.md).

It is written for an agent that has not seen either repo. Every gate has a
pass or fail to record. Everything under "Measured" was run on 2026-11-13;
everything under "Not measured" is a gate, not an assumption to build on.

## The one-paragraph brief

In Chrome 157 and later the spatial view already keeps one drawable DOM card
per clip and sources its near tiles from them. Reading a card still goes
through a second system: a pool of 14 separate DOM cards in a CSS3D layer,
swapped in over the nearest tiles. Phase 3 removes the second system where the
API exists. The card host becomes a visible canvas the size of the view, above
the WebGL canvas, and the frame loop draws the few cards being read straight
onto it from the persistent cards. A 2D `drawElementImage` puts a card's hit
area where it drew the pixels, so that one call gives sharp text, clicks,
hover, text selection and focus. Every clip then has a permanent element with
a permanent id, which is what the pool could not give keyboard and
screen-reader users.

## This is not the design the parent spec sketched

The parent spec's Phase 3 kept the host veiled at `opacity: 0.01` and steered
each card's hit area with `updateElementGeometry(card, { canvasTransform })`
every frame, leaving the pixels to the GPU atlas. Both designs work at the API.
This spec takes the second.

| | veiled host, geometry only | visible host, live draw (this spec) |
|---|---|---|
| pixels of a card being read | the 256 px atlas slot, stretched | re-rasterized at screen scale |
| hit area | one geometry call per card per frame | follows the draw; no call |
| capture refresh | resets the hit area; must be rewritten after | parked cards take no pointer events, so nothing to rewrite |
| hover, focus ring, selection | not visible: the tile is a stale capture | visible: the browser repaints the card and the loop redraws it |
| cost at 256 cards | 0.6 ms of script, 60 fps | 20 to 30 fps; the live set must stay small |
| a 1% ghost on a colour-managed display | possible | none: the host is not veiled |

The pool exists because a tile cannot be read at 256 px. Geometry-only keeps
that problem and adds a click target to it. Live draw removes it.

## Measured

Chrome stable 157.0.8103.52, no flags, headless, on an Apple M3 Max (ANGLE
Metal). View 1440 × 900 CSS px. Device pixel ratio 2 and a host bitmap of
2880 × 1800 unless a row says otherwise. Real pointer and keyboard input came
from Playwright 1.60.0. The WebGL field was **not** rendering in these runs; an
opaque element stood in for it.

Probe pages and drivers are `p3-forks.html`, `p3-forks-page.mjs`,
`p3-forks.mjs` and the demo `p3-demo.html` in
`muriel/render_assets/html-in-canvas-probe/`, with machine output in
`P3_FORKS.json`. That folder is git-ignored in muriel, so the tables here are
the committed record.

### M1. A view-sized host keeps every card paintable

2,500 cards stacked at the host's origin, host the size of the view. Cards 0,
317 and 2,499 each drew 346,710 of 346,800 px opaque (86,680 of 86,700 at pixel
ratio 1); the remainder is the card's rounded corners. The September rule that
a host taller than the viewport loses its paint records does not bind, because
a host the size of the view is never taller than it.

### M2. A live draw is re-rasterized, not stretched

One card drawn at 3× its size, compared with the same card drawn at 1× and
stretched 3× by `drawImage`. The measure is anti-aliasing pixels per full-ink
pixel in the title band; lower is sharper.

| | pixel ratio 1 | pixel ratio 2 |
|---|---|---|
| drawn at 1× | 0.590 | 0.307 |
| drawn at 1×, stretched to 3× | 1.680 | 0.713 |
| drawn live at 3× | 0.229 | 0.102 |

### M3. What a frame costs

K distinct cards drawn at K transforms, panning 0.7 px a frame, 62 frames
after an 8-frame warm-up. Script time is the draw calls alone. The frame
interval includes the browser's raster of what was drawn.

| per frame | script, median / p95 | frame interval, median / p95 |
|---|---|---|
| 14 live draws | 0.1 / 0.2 ms | 16.7 / 16.7 ms |
| 64 live draws | 0.3 / 0.5 ms | 16.7 / 16.7 ms |
| 256 live draws | 1.1 / 1.6 ms | 33.4 / 50.0 ms |
| 256 `updateElementGeometry` calls, no draw | 0.6 / 0.8 ms | 16.7 / 16.7 ms |

The script time hides the cost. 256 live draws take 1.1 ms of JavaScript and
then miss every second or third frame. **The live set has a ceiling between 64
and 256 on this machine**, and the pool is 14 today.

### M4. The two calls read their matrix in different units

`B` is host bitmap pixels per CSS pixel. A card meant to appear at `k` times
its CSS size, with its corner at CSS `(x, y)`:

| call | matrix | holds across |
|---|---|---|
| `ctx.setTransform(m)` then `ctx.drawElementImage(card, 0, 0)` | `[k, 0, 0, k, x·B, y·B]` | pixel ratio 1 and 2, `B` of 1 and 2, all four pairings |
| `host.updateElementGeometry(card, { canvasTransform: m })` | `[k, 0, 0, k, x, y]` | the same four |

The scale is the on-screen scale in both. Only the offset differs: bitmap
pixels for a draw, CSS pixels for geometry. At pixel ratio 1 with `B` of 1 the
two are identical, which is why a test at pixel ratio 1 cannot catch a mix-up.
Chrome on Andy's display reported a pixel ratio of 1.8, so `B` is not always
an integer.

Both calls accept an in-plane rotation (3° gave the same bounding box from
each). `canvasTransform` also accepts a 3D matrix; a 2D context cannot draw
one.

### M5. Input on a live card

Two cards live at half size, 2,498 parked at the origin with
`pointer-events: none`; live cards set `pointer-events: auto`; the host itself
is `pointer-events: none`.

| input | result |
|---|---|
| click on a live card's body | the card's own child receives it |
| click on a live card's link | the link receives it and takes focus |
| click at the origin, over the parked stack | falls through to the element beneath the host |
| the same after a capture-style draw of a parked card at the origin | still falls through; the parked card's box is 0,0 340 × 255 but it takes no pointer events |
| pointer over a live card | `:hover` matches; a `paint` event names the card; the redraw shows the hover style |
| drag across a live card's title | the selection is the title text |
| Tab, parked cards left focusable | focus goes to card 0, then 1, then 2: the invisible parked stack |
| Tab, parked cards `inert` | focus goes to the two live cards, then leaves |
| Tab, parked links at `tabindex="-1"` (the demo) | focus goes to live cards only |

### M6. Capturing through a view-sized host must be batched

Drawing one card and copying it out, 2,500 times, cost about 0.86 ms a card on
a 2880 × 1800 host: every copy forces the pending draw. Drawing a screenful of
tiles and then copying them out cost 41 ms for all 2,500, about 0.016 ms a
card. `AtlasPair` draws 16 source jobs a pump; unbatched that is about 14 ms of
a 16.7 ms frame.

### M7. Stacks is flat to the camera

`SpatialView` keeps `basePos.x/y` equal to `lookTarget.x/y`
(`panTo()`, the zoom path, and both ends of a camera tween), so the camera
looks straight down −Z. `PileLayout` rotates a tile only about Z, by up to
0.05 rad of jitter. A tile's screen shape is therefore a similarity transform
of its rectangle, which a 2D matrix expresses exactly. This is read from the
source, not from a rendered frame; gate B2 measures it.

### M8. The demo

`p3-demo.html`: 2,500 cards on a 64-column grid, far tiles captured from the
cards, up to 64 live. In stable Chrome 157 at pixel ratio 2, under automation:
zooming to 0.50 made 64 cards live; hover matched; a click on a link reported
the right card and focused the link; a drag selected the title; three Tabs from
the controls reached three live cards; a pan at Fit did not move the camera.
The live pass took 0.2 to 0.5 ms of script for 30 to 64 cards. Its find
handler has not been run against Chrome's real find bar.

### M9. Repaints that are not finds

A `paint` event that names some cards and not all of them is the only signal a
find match gives. Three other things were seen to produce the same event:

- **A cover that lands late.** A sprite-sheet cell reaches its `<img>` after
  its page decodes, long after the card was built. Loading the Psychodeli
  example's Stacks view produced 6 to 9 partial repaints in the first 2.4 s.
  With find armed straight after `CardHost.settled()`, 3 of 3 loads ended with
  an item selected and the camera moved. `SpatialView._armFind` now waits for
  those covers and for 400 ms without a repaint: 0 of 3.
- **Hover, focus and selection** on a card that takes pointer events (M5).
- **A screenshot.** Playwright's `page.screenshot()` repainted a subset of the
  cards (316 of 406 in one run) and the handler read it as a find. A probe on
  the card path must not take a screenshot until its measurement is done.

## Not measured

Each of these is a gate in Phase 3.0. None may be assumed.

- Chrome's real find bar against a host with live cards.
- Whether `inert` takes a card out of find-in-page.
- Frame time with the WebGL field rendering under the host, headed, on a named
  display.
- A fractional pixel ratio.
- A `<video>`, a sprite-cover image, or a proxied hero inside a live card.
- VoiceOver.
- Whether Chrome reports our own writes to a card (class, `tabindex`,
  `aria-selected`, `pointer-events`) in `changedElements`. The gpucanvas
  project reports that it does for `pointer-events` and CSS transforms on a
  WebGPU host.

## Repos and rules

| | path | role |
|---|---|---|
| muriel | `../muriel` | owns the renderer library at `render_assets/_lib/` |
| wunderkammer | the repository root | consumer; `wall/spatial/lib/` is a vendored copy |

The parent spec's rules all stand: never edit `wall/spatial/lib/` directly;
no `innerHTML` for clip-derived data; the wall never edits a clip; find never
changes membership; every clip keeps its source or editor link on any card a
person can reach. Work on a branch in each repo. Do not merge or push without
Andy's go.

## Design

### D1. Layers

| layer | z-index | pointer events | holds |
|---|---|---|---|
| `#sp-webgl` | 1 | auto | the tile field |
| `canvas.card-host` | 2 | none; `.sp-dcard.live` is auto | every card; the live ones drawn |
| `#sp-css3d` | 3 | none | pile labels only |

The host is `position: absolute; inset: 0` in `.sp-host`, not veiled. Its
bitmap is the view's CSS size times `devicePixelRatio`, the ratio the WebGL
renderer is given in `createScene()`, and it resizes with the pane. Cap it
only if B9 needs the headroom. Cards stay stacked at
the origin and keep `pointer-events: none` in the stylesheet. Pan, zoom and
tile picking keep their listeners where they are: a miss on the host reaches
the layer beneath (M5).

### D2. `LiveCards` replaces `HybridField` where the API exists

A new class in muriel's `cards.js` with `HybridField`'s surface, so
`FieldNavigator` and `SpatialView` change their wiring and not their logic:

| member | `HybridField` today | `LiveCards` |
|---|---|---|
| `update(camera)` | choose the pool's tenants, promote and demote | choose the live set with the same policy: `eligible`, `promoteDistance`, hysteresis, the focused item pinned |
| `elementFor(index)` | the pool element, or null when the item is a quad | the item's persistent card, never null |
| `setFocus(index)` | pin to the pool | pin to the live set |
| `live` | `Map` of index to pool entry | `Map` of index to `{ el }` |
| `sort(camera)` | writes z-index on pool elements | sets the draw order, far to near |
| `dispose()` | removes the pool | clears live state; `CardHost` owns the elements |

Promotion sets the class `live` on the card, `tabindex="0"` on its focusable
children and suppresses its quad, as the pool does. Demotion reverses all
three. The cap is a constructor option, 14 by default so the first version
changes one thing; M3 allows raising it toward 64 once B9 passes.

Without the API (Safari, Firefox, Chrome before 157) `SpatialView` builds
`HybridField` exactly as today. The pool is retired where the API exists, not
deleted. Two paths remain to maintain, and A1 is the test that the old one is
unchanged.

### D3. The frame

Inside the existing on-demand tick, in this order:

1. `field.update()`, then the atlas pump. Source jobs for this pump are handed
   to `CardHost.captureBatch(indices)`, which draws them as a grid at the
   host's origin and copies each out to a card-sized scratch canvas (M6).
2. `LiveCards.update(camera)` chooses the live set.
3. `ctx.reset()` on the host, then one `setTransform` and one
   `drawElementImage` per live card, far to near.

Step 3 runs only when the camera moved, the live set changed, or a `paint`
event named a live card. A still view draws nothing, which is what the
existing idle pixel-equality tests require.

The matrix comes from projecting the quad's corners, not from a formula that
assumes M7: project three corners of the tile with the camera, solve the
affine matrix that maps the card's CSS rectangle onto them, multiply the
offset by `B` (M4). Project the fourth corner too. If it lands more than
0.5 px from where the affine map puts it, the tile is not flat to the camera:
leave it a quad that frame.

### D4. Card content

The card a person reads is now the same element the tile was captured from, so
the two cannot disagree. Three things change on the drawable card:

- **Shape.** A drawable card is 340 × 255 for every clip and the pool card
  takes its tile's aspect from `--tile-aspect`. A live card must cover its
  quad's rectangle, so each card is authored at its own tile's aspect.
- **The editor link.** `.sp-dcard .sp-edit` is hidden today because a capture
  cannot be clicked. It becomes visible on `.sp-dcard.live` only, so far tiles
  do not carry a line of link text.
- **Video.** A drawable card holds no `<video>`. For a clip with a video the
  live card leaves its hero area unpainted and the quad beneath, which
  `VideoTiles` already plays, shows through. Gate G0.4 decides whether this
  holds or the clip stays on the pool path.

### D5. Keyboard and assistive technology

Every card has the id `sp-dcard-<index>`, `role="option"`, and its
`aria-label` from `_label(i)`. The host canvas takes `role="listbox"` and the
keyboard focus that `#sp-css3d` holds today, so `aria-activedescendant` names a
descendant. `FieldNavigator.select()` always has an element to name, live or
parked; its branch that removes `aria-activedescendant` goes away. That meets
the gate "accessible focus under DOM-pool pressure" in
[HYBRID_HARDENING.md](HYBRID_HARDENING.md).

Parked cards keep their links at `tabindex="-1"`. `inert` is not used unless
G0.2 shows it leaves find-in-page working.

"Keyboard escape from the field" in the same table, which the parent spec
calls "Tab exit", is a separate fault in `navigate.js`'s Tab branch. Phase 3 does not fix it by itself. It lands in the same change, with
its own gate B8, because this change rewrites that file's contract.

### D6. Find

Today a `paint` event that names some cards, and not all of them, is a find.
With live cards the browser also repaints a card for hover, focus and
selection, and possibly for our own writes. The rule becomes:

- Arm only as `_armFind` does today: after the covers a card receives late
  have landed, and after 400 ms without a repaint (M9).
- Keep the frame number of the last write to each card.
- A `paint` set is a find only if it holds a card that is neither live nor
  written in the last 3 frames, and it is not the whole corpus.
- Anything else that names a live card is a redraw.

A find match on a card that is already live moves nothing, and the card is
already on screen.

### D7. What goes

In the drawable path only: the 14 `CSS3DObject` cards, `_bindCardHover`'s
per-entry listeners (replaced by two delegated listeners on the host), the
`.sp-card` guards in the pointer handlers (they test `.sp-dcard.live`
instead), and `standIns` in `VideoTiles`. `hybrid.js` stays in muriel; other
consumers use it.

## Phase 3.0: the remaining probes (gate everything)

Run these on the demo page and the fork probes before writing library code.

| id | question | how | pass |
|---|---|---|---|
| G0.1 | Does Chrome's find bar move the camera, and does hover not? | Andy opens `p3-demo.html` in Chrome 157, presses ⌘F, types a word on parked cards only, then moves the pointer over live cards | the camera fits the matches; `window.__lastFind` holds their indices; hovering moves nothing |
| G0.2 | Does `inert` hide a card from find? | the same page with parked cards `inert` | record yes or no. Yes keeps `tabindex="-1"`; no allows `inert` |
| G0.3 | Does the frame hold with the field rendering? | headed Chrome on Andy's MacBook, the Psychodeli Atlas instance, 14 then 64 live cards while panning | p95 frame ≤ 16.7 ms at 14. Record 64 |
| G0.4 | Do real card contents draw live? | a card with a proxied hero, one with a sprite-cover image, one for a clip with a video | hero pixels present in the first two; the video's quad visible and playing under the third |
| G0.5 | Is a card aligned at a fractional pixel ratio? | pixel ratio 1.8 and 1.25, live card against its tile | each edge within 1 px |
| G0.6 | Does VoiceOver read and activate the selection? | arrow through the field with VoiceOver on, at a full live set and on a parked card | the name is read each time; Enter opens the right item |
| G0.7 | Does Chrome report our own writes? | set the class, `tabindex`, `aria-selected` on a parked card; log `changedElements` | record which do. D6 already tolerates all of them |

Stop conditions:

- G0.1 fails and no rule separates a find from a hover: stop. Find is the
  reason the cards exist.
- G0.3 fails at 14: stop. The design is slower than the pool it replaces.
- G0.5 fails: fix the matrix before any other work; every later gate reads
  rectangles.

## Phase 3.1: the library (muriel)

- `CardHost`: a `fill: 'view'` mode with the sizing in D1, `resize()`, a
  card-sized scratch canvas, `captureBatch(indices)`, per-card aspect, stable
  ids. The one-card host stays the default, so Phase 2 behaviour does not move
  until a consumer opts in.
- `LiveCards` as in D2 and D3, with the corner-projection matrix.
- `FieldNavigator`: the Tab fix, and `aria-activedescendant` always set.
- `spatial.css`: the `.card-host` placement in D1 and the `.live` rules.
- Unit tests beside `spatial-cards.test.mjs`: the live-set policy against
  `HybridField`'s for the same camera path; the matrix for an upright tile, a
  rotated tile and a tilted tile (which must be refused); `B` of 1, 1.8 and 2;
  the batch capturing each index once; the find rule in D6 against recorded
  `changedElements` shapes.
- Mutations, each of which must fail a test: drop the `B` factor from the
  offset; skip the fourth-corner check; let a parked card keep
  `pointer-events: auto`; treat a hover repaint as a find.

Then `node wall/spatial/lib/sync.mjs --pull` from wunderkammer.

## Phase 3.2: the wiring (wunderkammer)

`_replaceField()` builds `LiveCards` when it built a `CardHost`, and
`HybridField` otherwise. The consumers of `this.hybrid` are the frame loop,
`FieldNavigator`, `_domEligible`, `_activate`, the find handler, the hover
binding and `VideoTiles`' `standIns`; find them with
`grep -n "this.hybrid" wall/spatial/spatial-view.mjs`. The pointer handlers'
`.sp-card` tests gain `.sp-dcard.live`. Nothing in `wall/wall.mjs` changes.

## Phase 3.3: acceptance

Chrome 157 or later, headless Chromium for A1. Extend
`tests/spatial-drawable.test.mjs`; do not weaken an existing assertion.

| id | gate | evidence |
|---|---|---|
| A1 | Without the API the view is its present self: `tests/spatial-view.test.mjs` and `tests/spatial-journey.test.mjs` pass unchanged | test output |
| B1 | With the API there is no `.sp-card` in the document and no `CSS3DObject` card in the scene | counts |
| B2 | A live card covers its quad: each edge within 1 px, for an upright tile, a jittered pile member and a banner-shaped tile, at pixel ratio 1 and 2 | rectangles |
| B3 | A click on a live card opens that clip; a click on its link follows `editUri`; neither pans | the activated URL |
| B4 | A click or drag that misses every live card reaches the field: it picks a tile or pans | camera and selection before and after |
| B5 | Hover on a live card starts the same preview the pool card starts, and agrees with the click | `onHover` argument |
| B6 | Text in a live card can be selected by drag | the selection string |
| B7 | With the live set full, arrowing to an item outside it leaves `aria-activedescendant` naming that item's card | attribute value and the card's `aria-label` |
| B8 | Tab and Shift-Tab leave the field, with an empty, an ungrouped and a grouped subset | `document.activeElement` |
| B9 | With 14 live cards, `spatial pan` and `spatial zoom in/out` stay within their budgets in `perf-budgets.json`; record 32 and 64 | `scripts/perf.mjs` output |
| B10 | An idle view is pixel-identical across 10 s, and draws nothing on the host | screenshots, a draw counter |
| B11 | A filter change disposes every card and leaves no stale index, as A6 does today | A6 extended |
| B12 | A find match set moves the camera and leaves scope alone; hovering, focusing and selecting move nothing | A4/A5 extended with hover and focus shapes |
| B13 | DOM node count and JS heap with the pool gone, against today | a small table |

## What this spec does not do

- It does not change the floating space, the aisle or the flat wall.
- It does not lift the far atlas's 4096-slot ceiling or fix the other
  lifecycle items in the hardening plan.
- It does not make the spatial view work better in Safari or Firefox. They
  keep the pool.
- It does not make remote heroes draw in the static demo, which has no proxy.
- It does not adopt gpucanvas. That library draws through WebGPU, and
  `WebGL2RenderingContext` has no `texElementImage2D` in Chrome 157, so the
  three.js canvas cannot take an element as a texture.

## Open questions for Andy

- Should the cap stay at 14, or rise toward 64 so a whole screen of near cards
  is readable at once?
- A live card always shows its title band, where the pool card shows it on
  hover or selection. Near tiles have shown the band since Phase 2, so the
  live card matches its tile. Is the always-on band the look you want up
  close?
- Is keeping the pool for Safari and Firefox the right cost, or should those
  browsers lose promoted cards and keep tiles plus the detail pane?
- Should the probe pages and the demo move into this repository so the
  evidence is reproducible from a clone?

## Report format

Write `docs/HTML_IN_CANVAS_PHASE3_RESULTS.md`:

1. Chrome versions, pixel ratios and the display, verbatim.
2. The Phase 3.0 table with PASS, FAIL or BLOCKED and the evidence.
3. Which stop condition fired, if any.
4. Phases 3.1 and 3.2: files changed in both repos, test output, the mutation
   results.
5. The acceptance table.
6. The three things you were least sure about.
7. Open questions for Andy, one sentence each.

Numbers get units.
