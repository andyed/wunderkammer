# HTML-in-Canvas: Phase 0 report

Phases 0, 1 and 2 of [HTML_IN_CANVAS_EXPERIMENT.md](HTML_IN_CANVAS_EXPERIMENT.md),
run 2026-09-08. The spec is amended inline with everything below. Phase 3 stays
blocked on P0.8 and on your go.

**2026-11-13: P0.8 passes on re-run.** On Chrome 157 and 160 a real click
reaches a drawable card, provided the card host sits above the WebGL canvas.
[Section 7](#7-p08-re-run-2026-11-13) has the measurements. Phase 3 is no
longer blocked on the API; it still needs its own spec and your go. The same
run found the API on by default in stable Chrome 157, so the drawable-card
path is no longer behind a flag there.

Probe: `muriel/render_assets/html-in-canvas-probe/` on branch
`feat/html-in-canvas-probe`. Full write-up with the measurement tables in that
folder's `RESULTS.md`; machine output in `RESULTS.json`.

## 1. Chrome versions and flag status, verbatim

```
$ "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
Google Chrome 152.0.7977.77

$ "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" --version
Google Chrome 155.0.8046.0 canary
```

The flag string `canvas-draw-element` and the blink feature name
`CanvasDrawElement` are present in the framework binaries of **both** builds.
The spec expected the trial to have lapsed (the blog post says Chrome 148–150,
stable is past 150); it has not. Launch switch:
`--enable-blink-features=CanvasDrawElement`, verified working. No origin-trial
token needed locally.

Feature detection: the spec's proposed check is the right one.
`typeof CanvasRenderingContext2D.prototype.drawElementImage === 'function'`
returns `true` under the flag.

Actual API surface, wider than the explainer describes — `layoutSubtree`,
`requestPaint`, `onpaint`, `updateElementGeometry`, `clearElementGeometry`,
`onelementgeometryupdate`, `getElementTransform`, `captureElementImage`. The
paint event's element list is **`e.changedElements`**.

**2026-10-19: Canary renamed the opt-in.** On `Google Chrome 158.0.8110.5
canary` the host needs `content="drawable"` (the `canvas.content` IDL
attribute, default `"fallback"`). `layoutsubtree` alone no longer lays the
children out: every card read `offsetWidth` 0, so `CardHost.capture()` returned
`RETRY` until the field fell back to images, and a direct draw threw
`DrawElementImage requires the canvas to have the content=drawable attribute`.
A2 caught it, failing on every run. `CardHost` now sets both attributes (muriel
`1e99163`). With `content="drawable"` set, a card draws 86,700 / 86,700 opaque
px and the host fires a real `paint` event. The `drawable` attribute on the
children is unchanged. P0.1's third error string below is the pre-rename
wording.

## 2. Phase 0 table

| id | verdict | evidence |
|---|---|---|
| P0.1 | PASS | Own canvas: draws, returns `DOMMatrix`. Different `layoutsubtree` canvas: `InvalidStateError: The element can only be drawn into its nearest ancestor <canvas>`. Plain canvas: `InvalidStateError: DrawElementImage requires the canvas to have the layoutsubtree attribute`. Same inside and outside a `paint` handler. **The atlas canvas must be the host.** |
| P0.2 | PASS | 86,700 / 86,700 opaque px; title band 13,839 dark px. Only after the host-placement fix below — the first three runs read 0 px with no error. `fillRect` control on the same context read back 1,600/1,600, so readback is not the variable. |
| P0.3 | PASS | Only via capture-then-blit — see finding 3. A scaled `drawElementImage` cannot place a tile: coverage is `canvasSize × scale`, not `elementSize × scale`. Through the shipped path, 64×48 and 256×192 exactly; title-band dark px 29 @64, 654 @256. |
| P0.4 | PASS | Cross-origin `picsum.photos` hero: loads, draws, hero region blank, title band intact — content dropped, element survives, no throw. Through `/proxy?url=…` the hero returns and the card passes P0.2 again. |
| P0.5 | PASS | N=12, target index 7: `window.find` matched and `paint` fired with `changedElements` naming index 7. Re-confirmed at N=500 with the target at index 317 — paint event carried exactly `[317]`. |
| P0.6 | PASS | Programmatic selection returns the title exactly; CDP `Accessibility.getFullAXTree` contains the card. Playwright drag-select returned empty under `pointer-events: none`, non-empty once the host takes pointer events. |
| P0.7 | PASS | 2,500 tiles at 64px, clipped: append 12.5 ms, layout+snapshot 104.1 ms, draw 13.4 ms (0.005 ms/tile), +10,001 DOM nodes, JS heap +0.4 MB. Soft gate was <500 ms — met by 37×. |
| P0.8 | **FAIL** on 152 and 155; **PASS** on 157 and 160, [section 7](#7-p08-re-run-2026-11-13) | `updateElementGeometry(el, {canvasTransform})` lives on the canvas and accepts identity, the draw-returned matrix, and `preserveHitTestOrder: true` without throwing. A real click at the host's screen rect reached neither card nor canvas. `getElementTransform(card)` throws `Overload resolution failed`. |

## 3. Stop conditions

None fired. P0.2 passes and P0.5 passes in two of four placements, so both hard
gates are clear. P0.8's failure blocks Phase 3 only, per the spec.

## 4. Phase 1 and 2 — done

Both landed, on the amended design. What Phase 0 established, and what Phase 1
and 2 were built against:

1. **The card host cannot be hidden.** Both placements the spec proposed for
   P0.5 — `opacity: 0; pointer-events: none` and `position: fixed; left: -100vw`
   — produce **silent blank tiles**: `drawElementImage` returns a matrix and
   paints nothing, with no exception. So does `clip-path: inset(100%)`;
   `visibility: hidden` at least throws `No cached paint record`. What works is
   a host that is genuinely painted and in the viewport: `opacity: 0.01` and
   `transform: scale(0)` both give the full 86,700 px. Proposed
   `spatial.css` rule for `.card-host` is `opacity: 0.01; z-index: -1;
   pointer-events: none`, positioned under the WebGL canvas, which is opaque
   anyway. **This needs one more check before it ships: verified in isolation,
   not under wunderkammer's real canvas.**

2. **Cards must be stacked, not stacked up.** A host taller than the viewport
   loses paint records for its entire subtree — all-or-nothing, not just the
   offscreen part. Absolutely position every card at the host's origin so the
   host is one card in size at any count. Verified 2,500/2,500 tiles drawn, and
   find still reaches a card buried at index 317 of 500. `CardHost` in the
   spec's new `cards.js` should own this; it is not optional styling.

3. **`drawElementImage` cannot place a tile, so the card is captured first.**
   (True on 152 and 155. On 157 the draw honours the context transform; see
   [section 7](#7-p08-re-run-2026-11-13).)
   Whatever scale is on the context, the paint covers the whole canvas —
   measured `canvasSize × scale` at every scale tried — and the returned
   `DOMMatrix` centres the element in its own box. The shipped path never
   scales at draw time: the card host's bitmap is one card, the card is drawn
   into it at scale 1, and that canvas is letterboxed into an atlas slot by
   `TileAtlas.draw()`, which already accepts a canvas.

   Consequence: **the atlas stays a plain canvas.** The "atlas must be the
   host" conclusion from P0.1 is true of `drawElementImage` but never binds,
   because nothing draws an element into an atlas. `TileAtlas` needs no `host`
   option and gains no new draw method.

   I got this wrong first. I read the oversized raster as an 8px opaque bleed
   and "fixed" it with a clip to the destination rect, which made the measured
   bounding box exactly 64×48 while the content stayed a magnified crop of the
   card's corner. It survived a probe, a unit test and a mutation check,
   because all three measured the frame I had drawn rather than the picture
   inside it; what caught it was rendering a tile and looking at it.

Also: `captureElementImage(el)` returns an `ElementImage`
(`width`/`height`/`close`) and is **not** a portable escape hatch — `drawImage`
and `createImageBitmap` reject it, and another `layoutsubtree` canvas refuses
it with `The source was captured from a different canvas`.

### What Phase 1 added (muriel, `render_assets/_lib/`)

- `atlas.js`: `AtlasPair` gains `resolveSource(index, tier)`, tried before
  `resolve`. It returns an image source (drawn synchronously into the slot),
  `null` (fall through to the image path, per tier), or the new exported
  `RETRY` sentinel (requeue for the next frame). Plus `sourceDrawsPerPump`
  (default 16 — synchronous jobs never wait on `_inflight`, so they need their
  own budget or a 2,500-card first frame draws the corpus in one task) and
  `sourceRetries` (default 120 frames). `TileAtlas` gains `slotCoverage()`.
- `cards.js` (new): `CardHost` owns the host canvas and one drawable card per
  item, plus `capture(index)`, `ready()`, `settled()`, `onPaint()`, and
  `supported()`.
- `instanced.js`: `TileField` passes `resolveSource` / `sourceDrawsPerPump`
  through.
- `spatial.css`: the `.card-host` placement, with the reasoning inline.

Two defences are load-bearing, because the failure modes here are all silent:
`AtlasPair` reads back its **first** source draw and permanently falls back to
images if it came back blank (a bad host placement degrades to today's
behaviour, not to an empty field), and `RETRY` keeps a startup race from being
recorded as a permanent failure.

### What Phase 2 wired (wunderkammer)

`_replaceField()` builds a `CardHost` when the feature is present and the host
is visible, passes `resolveSource` for the near tier only, disposes the host
with the rest of the snapshot, and subscribes to `onPaint`. `_buildCard` gained
a `proxyHero` option — cross-origin content inside a drawable is dropped, so
the drawable copy proxies its hero while the DOM overlay keeps using the direct
URL. Drawable cards are `.sp-dcard`, never `.sp-card`: that class is the
overlay pool and both the CSS3D layer and the existing tests select on it.

**Find-in-page: what the real bar actually does.** This took two wrong turns
and was only settled by Andy pressing ⌘F with the page instrumented, because
Playwright cannot open Chrome's find bar and `window.find()` is not a
substitute for it — the two paths give *opposite* evidence:

| | real find bar | `window.find()` |
|---|---|---|
| DOM selection | **none**, ever | sets one |
| `changedElements` | **exactly the matching cards**, narrowing as you type | repaints far more than it matched |

Measured on a 60-card page: typing `m` repainted 40 cards (every card
containing an "m"), and `meridian` narrowed to `[0,12,24,36,48]` — precisely
the five Meridian cards. Opening and closing the bar repaints all 60.

So the match set is the signal, and the selection — which is what I built
first, because `window.find()` was the only thing I could automate — is the
misleading one. A find now answers with a SET: the camera fits all matches
rather than flying to a guessed single one, which is also the better
interaction for a spatial view. A whole-corpus repaint carries no information
and is ignored, which covers both the bar opening and our own capture pass;
`_capturing` brackets our `drawElementImage` calls for the same reason, and the
handler stays disarmed until `CardHost.settled()` because a hero `<img>`
landing repaints its card indistinguishably.

### Tests

| | |
|---|---|
| `muriel/tests/spatial-cards.test.mjs` (new) | 9 pass — queueing, the per-pump budget, slot ownership, the failure contract, `RETRY`, and the blank canary |
| `muriel` spatial suite | 15 pass, 0 fail |
| `wunderkammer/tests/spatial-view.test.mjs` (A1, flag off) | 6 pass, 0 fail, unchanged |
| `wunderkammer/tests/spatial-drawable.test.mjs` (new, Canary-gated) | 8 pass — A2, A2b, A3, A3b, A4/A5, A4b, A6, A7 |
| `wall/spatial/lib/sync.mjs` | vendored lib matches upstream |

Five mutations were injected to confirm the new unit tests actually trip:
removing the per-pump cap, disabling the blank canary, removing the `RETRY`
requeue, making `RETRY` never give up, and letting a source job consume an
`_inflight` slot. Each failed at least one test; the restored tree passes all.

`A2b` is the control that gives `A2` its meaning: with the flag off, the same
region of the same tile is flat, because the fixture's hero is one colour. If
`A2b` ever passes trivially, `A2` proves nothing.

Files changed — nothing committed, both repos on `feat/html-in-canvas-probe`:

```
muriel      M CHANGELOG.md
            M render_assets/_lib/atlas.js
            M render_assets/_lib/instanced.js
            M render_assets/_lib/spatial.css
           ?? render_assets/_lib/cards.js
           ?? render_assets/html-in-canvas-probe/
           ?? tests/spatial-cards.test.mjs
wunderkammer    M TODO.md                            (pre-existing, from the spec)
            M wall/spatial/spatial-view.mjs
            M wall/spatial/spatial.css
            M wall/spatial/lib/                  (vendored pull)
           ?? docs/HTML_IN_CANVAS_EXPERIMENT.md  (pre-existing, the spec, now amended)
           ?? docs/HTML_IN_CANVAS_RESULTS.md     (this file)
           ?? tests/spatial-drawable.test.mjs
```

## 5. The three things I am least sure about

1. **Whether the viewport rule is a rule or today's heuristic.** "Host taller
   than the viewport ⇒ no paint records for the whole subtree" is an inference
   from behaviour across ~40 configurations, not from any documentation. It was
   stable across every run, but the stacked-card design leans on it entirely,
   and it is exactly the sort of thing that changes between Canary builds. If
   it does change, the blank canary turns it into a fallback rather than an
   empty field — which is why the canary exists.

2. **The find handler on a real corpus.** The real bar has now been driven
   once, by hand, on the 60-card demo — that is where the match-set behaviour
   above comes from — but never on wunderkammer itself. A4/A5 replays the exact
   `changedElements` shape the bar produced rather than opening the bar, so it
   tests my handler against measured input, not the browser. What is still
   unverified end to end: whether the bar behaves the same at 406 cards, and
   whether fitting the camera to a 40-tile match set is useful or dizzying.

3. **Cost at corpus scale in the app.** The 2,500-card figures are the probe's
   bare page: +10,001 DOM nodes, 13.4 ms of draws, +0.4 MB JS heap. Wunderkammer
   adds real card content, an active WebGL context and the DOM pool on top, and
   `A7` records only three clips. Tab memory from Chrome's Task Manager is
   still not measured anywhere.

`P0.8` is no longer on this list only because it is unresolved rather than
uncertain: three plausible argument shapes were accepted without throwing and
no click landed, and `getElementTransform` throws `Overload resolution failed`,
so at least one signature there is not what I assumed. Phase 3 stays blocked.
(2026-11-13: resolved on 157 and 160, [section 7](#7-p08-re-run-2026-11-13).
The failure on 152 and 155 is still unexplained.)

## 6. Open questions

- Is `opacity: 0.01` under the WebGL canvas acceptable, given a colour-managed
  display could in principle show a 1% ghost? `transform: scale(0)` measured
  equally well and leaks nothing, at the cost of a stranger rule.
- A find now fits the camera to the WHOLE match set. Is that right, or should
  it step through matches one at a time? The API gives us the set and no way to
  tell which match is Chrome's active one, so stepping would need our own
  next/previous UI — which starts competing with the find bar.
- Should the far tier come from cards too? At 64px the title band still carries
  29 dark pixels — legible-ish, and it would put one code path everywhere.
- Do you want the 2,500-clip cost measured on a real instance (the Psychodeli
  Atlas on 4174) before this goes further than a flag?
- Is Phase 3 worth scheduling at all, given P0.8 did not resolve?
  (2026-11-13: P0.8 resolved, [section 7](#7-p08-re-run-2026-11-13). The
  question is now whether Phase 3 is worth its own spec.)

## 7. P0.8 re-run, 2026-11-13

Chrome stable 157.0.8103.52 and Canary 160.0.8160.0, **no feature flags**,
headless, real pointer clicks from Playwright 1.60.0. 32 conditions, one page
load each. Stable and Canary agree on all 32.

Probe: `p08-rerun.html`, `p08-rerun-page.mjs` and the driver `p08-rerun.mjs` in
`muriel/render_assets/html-in-canvas-probe/`, with machine output in
`P08_RERUN.json` and `P08_RERUN.canary.json`. That folder is git-ignored in
muriel, so the tables below are the committed record.

Setup: a 600 × 400 px 2D host canvas with `content="drawable"`, over an opaque
element that stands in for the WebGL canvas. One 340 × 255 px card holding a
button. The target rect is the card at half size: 300,200, 170 × 127.5 px.
Each condition takes three clicks: the target's body, the target's button, and
the card's box at the host origin.

### 7.1 Where the host has to sit

| host placement | click on the target | a miss goes to |
|---|---|---|
| above the stand-in, opacity 1 | card, button | host |
| above the stand-in, `opacity: 0.01` | card, button | host |
| above the stand-in, `opacity: 0.01`, host `pointer-events: none`, card `pointer-events: auto` | card, button | the stand-in |
| beneath the stand-in at `z-index: -1`, which is what `.card-host` ships | the stand-in | the stand-in |

A click on the button also moves focus to it. Tab order was not tested.

### 7.2 What positions the hit area on a 2D host

| card drawn at | then | hit area ends at | click on the target |
|---|---|---|---|
| target | nothing | target | card |
| target | `updateElementGeometry(card, {})` | target | card |
| origin, scale 1 | nothing | origin | the stand-in |
| origin, scale 1 | `updateElementGeometry(card, { canvasTransform: target })` | **target** | card |
| origin, scale 1 | the same, then one more draw at the origin | origin | the stand-in |
| origin, scale 1 | `card.style.transform = getElementTransform(card, target)` | origin | the stand-in |
| target | `card.style.transform = getElementTransform(card, target)` | 492.5,331.9, 85 × 63.8 px | the stand-in |

1. **A 2D draw moves the hit area by itself.** After `ctx.setTransform(m)` and
   `ctx.drawElementImage(card, 0, 0)`, the card's `getBoundingClientRect()` is
   the drawn rect and clicks there reach it. No geometry call is needed.
2. **`updateElementGeometry(card, { canvasTransform })` moves the hit area
   without a draw.** This is the call the September run made.
3. **The last write wins.** A later draw puts the hit area back where that draw
   put the card, so a capture refresh undoes a `canvasTransform`.
4. **`getElementTransform` ignores its second argument on a 2D host.** Given
   the same matrix both times, it returned `matrix(0.5, 0, 0, 0.5, 300, 200)`
   after a draw at the target and the identity after a draw at the origin: the
   last draw's matrix. Set as a CSS transform it stacks on the automatic one,
   which is the doubled box in the last row. Registering with empty options and
   then setting that CSS transform is what
   [gpucanvas](https://github.com/berkantay/gpucanvas) (MIT) does on a WebGPU
   host, where the browser does not know the draw transform. It does not carry
   over to a 2D host.

### 7.3 Chrome 157 against the September findings

- **`drawElementImage` places a tile.** The draw honours the context
  transform: the drawn bounding box is 300,200, 170 × 128 px, and the rendered
  frame shows the whole card at half size, not a magnified crop. Capturing the
  card and blitting it still works; it is no longer the only way.
- **`layoutsubtree` is gone.** `'layoutSubtree' in HTMLCanvasElement.prototype`
  is false. `content="drawable"` is the only opt-in. `CardHost` sets both.
- **No flag.** `CanvasRenderingContext2D.prototype.drawElementImage` exists in
  stable 157 as shipped, so `supported()` in `wall/spatial/lib/cards.js` is
  true and the spatial view builds a card host. `tests/spatial-drawable.test.mjs`
  passes 8 of 8 on stable 157 with its `--enable-blink-features` argument
  removed, and 8 of 8 on Canary 160.
- **WebGL takes no element.** `WebGL2RenderingContext.prototype` has no
  `texElementImage2D`. `GPUQueue.prototype.drawElementImageToTexture` exists.

### 7.4 What this settles for Phase 3, and what it leaves

Settled: a veiled host above the WebGL canvas, itself transparent to the
pointer, delivers clicks and focus to a card at a rect chosen by
`canvasTransform`, and lets a miss through to the canvas beneath.

Not settled:

- The September failure is unexplained. That run used Chrome 152 and 155 with
  the flag, and a host whose CSS box was resized to the hit zone. Neither
  build was run again.
- `CardHost` is one card in size and sits beneath the WebGL canvas. Phase 3
  needs a host the size of the view, above it. Whether the stacked 2,500-card
  host keeps its paint records at that size was not tested.
- A capture draw resets the hit area, so geometry has to be written after a
  frame's captures, on every frame where the camera or the near set changes.
  The cost at about 256 near cards was not measured.
- `canvasTransform` took a 2D affine matrix here. A tilted tile needs a 3D
  matrix or an affine approximation. Not tested.
- Headless only: no headed run, no trackpad, no hover, no text selection, no
  Tab order.

Later the same day a second set of probes measured the view-sized host, live
draws at scale, per-frame cost, hover, text selection and Tab order. Those
tables are in [HTML_IN_CANVAS_PHASE3.md](HTML_IN_CANVAS_PHASE3.md#measured),
the Phase 3 spec.
