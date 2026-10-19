# HTML-in-Canvas: drawable cards for the spatial field

Spec written 2026-09-08. **Amended 2026-09-08 after Phase 0 ran** — Phase 0 is
complete, 7 of 8 probes pass, and three of this spec's assumptions turned out to
be wrong. The amendments are inline below, each marked
**[amended after Phase 0]**; the evidence is in
[HTML_IN_CANVAS_RESULTS.md](HTML_IN_CANVAS_RESULTS.md) and, with the
measurement tables, in `muriel/render_assets/html-in-canvas-probe/RESULTS.md`.
Status: **Phase 0 done, Phase 1 in progress.** This is a bounded experiment,
not a release feature. It is written for an agent that has not seen either
repo; every path is absolute and every gate has a pass/fail you can record.

## The one-paragraph brief

Chrome's HTML-in-Canvas API (`<canvas layoutsubtree>`, `drawable` descendants,
`drawElementImage()`, the `paint` event) lets a real DOM element be painted
into a canvas while staying in the accessibility tree, in find-in-page and in
text selection. Wunderkammer's spatial view paints every clip as a GPU quad from a
texture atlas and lends a pool of 14 real DOM cards to whatever is close
enough to read (`wall/spatial/lib/hybrid.js`). The experiment: source atlas
tiles from one persistent drawable card per clip instead of from a raw image,
so the near tier carries the title band, and wire the browser's own Cmd+F to
the camera so a find match flies the camera to the tile. Andy, 2026-09-08:
"this is key for feeling like you're navigating the information landscape."

Source: https://developer.chrome.com/blog/html-in-canvas-origin-trial and the
explainer at https://github.com/WICG/html-in-canvas. Read both before Phase 0.

## Repos, ownership, and the rule you must not break

| | path | role |
|---|---|---|
| muriel | `../muriel`, branch `feat/hybrid-tile-field` | owns the renderer library at `render_assets/_lib/` |
| wunderkammer | `the repository root`, branch `feat/background-plane` | consumer; `wall/spatial/lib/` is a **vendored copy** of muriel's `_lib/` |

**Never edit `wunderkammer/wall/spatial/lib/` directly.** Edit
`muriel/render_assets/_lib/`, run muriel's tests, then from wunderkammer run
`node wall/spatial/lib/sync.mjs --pull`. `sync.mjs` without `--pull` reports
drift. Read `wunderkammer/docs/SPATIAL.md` § "What's ours and what's vendored".

Other standing rules, from `wunderkammer/docs/SPATIAL.md` § Invariants and
`wunderkammer/docs/ARCHITECTURE.md`:

- **No `innerHTML` for clip-derived data.** Titles, notes, tags and facet values
  are scraped from third-party pages. Build cards with `textContent` and
  `createElement` only. `SpatialView._buildCard()` is the pattern.
- **The wall never edits a clip.** Nothing here writes notes, media,
  `view-state.json` or permalink snapshots.
- **Find never changes membership.** `state.filtered`, `applyFilters()`,
  permalinks, piles and sort are untouched by anything in this spec. Find moves
  the camera; search changes scope. Keep them separate.
- **Every clip keeps its Obsidian link** (`clip.editUri`) on any card that
  reaches the DOM.
- **Do not commit.** Leave changes in the working tree and write the report
  described at the end. Andy reviews and commits.
- Log with `console` is fine in these repos (this is not Psychodeli).

## Environment facts, checked 2026-09-08

- Google Chrome stable **152.0.7977.77** and Chrome Canary **155.0.8046.0**
  are installed in `/Applications`.
- **[amended after Phase 0]** The trial has not lapsed. The flag string
  `canvas-draw-element` and the blink feature `CanvasDrawElement` are present in
  the framework binaries of BOTH installed builds. Launch with
  `--enable-blink-features=CanvasDrawElement`; no origin-trial token is needed
  locally. The spec's proposed feature detection
  (`typeof CanvasRenderingContext2D.prototype.drawElementImage === 'function'`)
  is the right one and returns true under the flag.
- **[amended after Phase 0]** The real API surface on
  `HTMLCanvasElement.prototype` is wider than the explainer describes:
  `layoutSubtree`, `requestPaint`, `onpaint`, `updateElementGeometry`,
  `clearElementGeometry`, `onelementgeometryupdate`, `getElementTransform`,
  `captureElementImage`. The paint event's element list is **`e.changedElements`**.
- Wunderkammer instances (`wunderkammer/docs/HANDOFF.md`): research wall on 4173,
  **Psychodeli Atlas on 4174** (`.local/psychodeli-atlas/wunderkammer.config.json`,
  406 same-origin images; use this one), Music Atlas on 4175. Check listeners
  before starting one: `lsof -iTCP:4174 -sTCP:LISTEN`. Start with
  `node serve.mjs --config .local/psychodeli-atlas/wunderkammer.config.json`.
- Three.js is loaded from a CDN importmap in `wunderkammer/index.html`
  (`three@0.186.1`). Muriel demo pages use their own importmap.
- Muriel lib tests: `node --test tests/spatial-hybrid.test.mjs` and
  `node --test tests/spatial-piles.test.mjs`, run from the muriel root. They
  stub `three` and test policy, not pixels.
- Wunderkammer tests: `node check.mjs` (flat wall, Playwright) plus the spatial
  tests under `wunderkammer/tests/`. Run `ls tests` and read the header of each
  file for its run command before assuming.

## Known API constraints that shape the design

From the explainer, unverified until Phase 0:

1. A drawable element must be a **descendant of the `<canvas layoutsubtree>`**
   it is drawn into, and must carry the `drawable` attribute. Drawing throws
   for elements with a different canvas ancestor. `drawable` implies
   `isolation: isolate` and makes the element a containing block.
   **[amended after Phase 0 — CONFIRMED, and it is the nearest ancestor, not
   any ancestor.]** Verbatim: `InvalidStateError: The element can only be drawn
   into its nearest ancestor <canvas>`, and on a canvas without the attribute,
   `DrawElementImage requires the canvas to have the layoutsubtree attribute`.
   `captureElementImage(el)` is not an escape hatch: it returns an
   `ElementImage`, which `drawImage` and `createImageBitmap` both reject, and
   which another `layoutsubtree` canvas refuses with `The source was captured
   from a different canvas`. So the atlas canvas MUST be the card host — the
   first of the two branches this spec designed for, and the only one on offer.
2. **Cross-origin content inside a drawable does not render** (images, iframes,
   canvases with cross-origin data). Wunderkammer already routes remote heroes
   through `/api/proxy` for exactly this reason (`proxied()` in
   `wall/spatial/spatial-view.mjs`). Vault media and the Psychodeli Atlas
   derivatives are same-origin. The GitHub Pages demo has no proxy; remote
   heroes there would render blank. This experiment does not fix that.
3. Snapshots are "read-back-allowed": no subpixel text antialiasing, no system
   colors, no visited-link state. Grayscale AA at 256px is acceptable.
   **[amended after Phase 0 — confirmed legible.]** The title band carries
   7,862 dark pixels at 256px and still 516 at 64px, so the far tier is not the
   blur this spec assumed. `getImageData` on the host canvas is unrestricted (a
   `fillRect` control read back 1,600/1,600 px).
4. **[added after Phase 0] A drawable has a paint record only while its host is
   actually painted, and drawing without one is a SILENT NO-OP.**
   `drawElementImage` on an unpainted element returns a `DOMMatrix` and paints
   nothing — no exception. Measured, one card, identical code path:

   | host placement | opaque px of 86,700 |
   |---|---|
   | in normal flow, visible | 86,700 |
   | `opacity: 0.01` | 86,700 |
   | `transform: scale(0)` | 86,700 |
   | `opacity: 0` | **0**, no error |
   | `position: fixed; left: -100vw` | **0**, no error |
   | `clip-path: inset(100%)` | **0**, no error |
   | `visibility: hidden` | throws `No cached paint record` |

   Both placements this spec proposed in P0.5 are in the silent-zero column.
   Drawing before any record exists throws `No cached paint record`; two
   `requestAnimationFrame`s after append is enough, `requestPaint()` + the
   `paint` event is the explicit form.
5. **[added after Phase 0] A host taller than the viewport loses paint records
   for its WHOLE subtree**, not just the offscreen part — all-or-nothing.
   Cards laid out in a column therefore fail at any count past ~5, which first
   read as a cap on drawables and is not one. Stack every card at the host's
   origin so the host is one card in size at any count: verified 64/64 at
   N=64, 500/500 at N=500, 2,500/2,500 at N=2,500.
6. **[added after Phase 0] `drawElementImage` cannot place a tile.** It is not
   `drawImage`. Whatever scale is on the context, the paint covers the WHOLE
   canvas — measured `canvasSize × scale` every time (1024→1024, ×0.75→768,
   ×0.5→512, ×0.25→256) — and the `DOMMatrix` it returns centres the element in
   its own box rather than describing the destination you asked for.

   So a tile is never produced by scaling at draw time. The card host's bitmap
   is sized to exactly ONE card, the card is drawn into it at scale 1, and that
   canvas is letterboxed into an atlas slot by an ordinary `drawImage` —
   `TileAtlas.draw()` already accepts a canvas, so no new atlas method is
   needed and **the atlas stays a plain canvas**, which dissolves constraint 1's
   "the atlas must be the host" consequence entirely.

   An earlier reading of this ("an 8px opaque bleed, fix it with a clip") was
   wrong: clipping to the destination made the measured bounding box exactly
   right while the content inside stayed a magnified crop. The probe was
   measuring its own clip.
4. Painting is **main-thread and JavaScript-driven.** The `paint` event fires
   after intersection-observer steps with the list of changed drawables;
   `requestPaint()` asks for one. Nothing repaints on its own. This is fine for
   the spatial view, which owns a `requestAnimationFrame` loop. It is the wrong
   trade for the flat wall, whose zoom is a compositor-driven CSS transition.
   **The flat wall is out of scope.**
7. Hit testing is delegated back to the browser per element with
   `updateElementGeometry(el, { canvasTransform: DOMMatrix })`. Whether that
   works when the hosting canvas is not the visible WebGL canvas is unknown.
   See P0.8. **[amended after Phase 0 — UNRESOLVED, and it is a method on the
   CANVAS, not the element.]** `canvas.updateElementGeometry(el, {
   canvasTransform, preserveHitTestOrder })` accepted identity, the
   draw-returned matrix, and `preserveHitTestOrder: true` without throwing, and
   a real click at the host's screen rect reached neither the card nor the
   canvas. `getElementTransform(card)` throws `Overload resolution failed`, so
   at least one signature here is not the obvious one. Phase 3 stays blocked.

## Architecture of the experiment

Today, `AtlasPair._load()` in `render_assets/_lib/atlas.js` creates an
`Image`, waits for `load`, and calls `TileAtlas.draw(slot, img)`, which
`drawImage`s into the atlas's own 2D canvas, letterboxed. That canvas is a
`THREE.CanvasTexture`. The experiment adds a second source to the same path:

```
resolve(index, tier) -> url            (today; unchanged)
resolveElement(index, tier) -> element  (new, optional)
```

When `resolveElement` returns an element, the job draws it synchronously with
`drawElementImage` scaled into the slot. No `Image`, no network. Ownership
checks (`slots[index] === slot`) and failure accounting stay identical so the
hardening plan in `wunderkammer/docs/HYBRID_HARDENING.md` still applies.

The cards live in a **card host**: one `<canvas layoutsubtree>` element that
holds one `drawable` card per clip. Constraint 1 says the cards must be
descendants of the canvas they are drawn into. The atlas canvas today is
detached (`document.createElement('canvas')`, never appended). So either the
atlas canvas becomes the host and is inserted into the document, or the host
is a different canvas and Phase 0 shows that drawing into a *different* canvas
is allowed. **P0.1 decides this.** Design for the first case: `TileAtlas` gets
an optional `host` element; when given, the atlas canvas is that element.

The card host must be laid out and CSS-visible for find-in-page to see its
text (find skips `display:none` and `visibility:hidden`), yet must not be seen
by the user.

**[amended after Phase 0]** Both original candidates are dead: `opacity: 0` and
`position: fixed; left: -100vw` are findable and paint nothing (constraint 4).
The host must be *painted*, so the placement is `opacity: 0.01` under the WebGL
canvas with `pointer-events: none`, and the cards inside it are absolutely
positioned at its origin so the host stays one card in size at any count
(constraint 5). Stacking costs nothing on the find side: at N=500 with the
target at index 317, `window.find` matched and the `paint` event carried
exactly `[317]`.

### What stays exactly as it is

- The 14-card `HybridField` pool, promotion, demotion, `aria-activedescendant`,
  and `field.pickAt()` raycast hit testing. Phase 2 does not retire them.
  Retiring the pool is Phase 3 and is gated on P0.8.
- `TileAtlas.draw()`, `AtlasPair.request()`, the queues, LRU eviction, the
  far-tier 4096-slot cap, `flush()`.
- Everything in `wall/wall.mjs`.

## Phase 0: feasibility probe (gates everything) — **DONE, no stop condition fired**

Probe lives at `muriel/render_assets/html-in-canvas-probe/` (branch
`feat/html-in-canvas-probe`), results in its `RESULTS.md` / `RESULTS.json`.
P0.1–P0.7 PASS; P0.8 FAIL, which blocks Phase 3 only. The original instructions
are kept below for provenance.



Build one standalone page in muriel:
`../muriel/render_assets/html-in-canvas-probe/index.html`
plus `probe.mjs` beside it, and a results file `RESULTS.md` in the same folder.
Serve the folder with any static server (`npx http-server -p 8093 -c-1` from
`render_assets/`). No three.js needed for P0.1–P0.7; P0.6 uses a plain 2D
canvas turned into a texture only if it is cheap to do so.

Open it in **Chrome Canary** with the flag enabled. First record, in
`RESULTS.md`, the exact `chrome://version` line and whether
`chrome://flags/#canvas-draw-element` exists in Canary 155 and in stable 152.
Also record the command-line switch equivalent if you can find it (look at the
flag's description; `--enable-blink-features=CanvasDrawElement` is a guess,
verify). Playwright can launch Canary with
`chromium.launch({ executablePath: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', args: [...] })`.

Feature detection to use everywhere:
`typeof CanvasRenderingContext2D.prototype.drawElementImage === 'function'`.
Record whether this is true; if not, find the detection that is and record it.

Each probe writes its result to a `<pre id="results">` and to `console` so
Playwright can read it. Record each as PASS / FAIL / BLOCKED with the evidence.

| id | question | method | pass condition |
|---|---|---|---|
| P0.1 | Can a 2D canvas draw a `drawable` descendant of a *different* `layoutsubtree` canvas? | Two canvases; card under canvas A; `ctxB.drawElementImage(card, 0, 0)` inside a `paint` handler and outside one | Record which throws. Either answer is fine; it decides whether the atlas canvas must be the host. |
| P0.2 | Pixels land | Card = 340×255px div with a same-origin `<img>` and a title `<p>`. Draw into a 512px canvas. `getImageData`, count alpha>0 pixels | > 50% of the card area non-transparent; the title row has dark pixels |
| P0.3 | Scaled draw is legible | `ctx.save(); ctx.scale(64/340, 64/340); drawElementImage(card,0,0); restore()` and the same at 256/340 | Both produce a tile at the expected size (measure bounding box of non-transparent pixels, ±2px); at 256 the title row has ≥ 20 dark pixels |
| P0.4 | Cross-origin image inside the card | Same card with `<img src="https://picsum.photos/300/200">` (no CORS) | Record exactly what happens: blank image region, whole element blank, or throw. Then repeat with the same URL through a local proxy stub or a same-origin copy and confirm P0.2 passes again |
| P0.5 | **Find-in-page reaches the card and reports it** | Host canvas positioned (a) `opacity:0` under another element and (b) `position:fixed; left:-100vw`. Card text contains a unique word. Attach `canvas.addEventListener('paint', e => log(e.changedElements ?? e))` (record the real property name from the explainer/IDL). Manual: press Cmd+F, type the word, press Enter. Automated approximation: `window.find('uniqueword')` | A `paint` event fires naming the card for at least one of (a)/(b). Record which. Record whether the find bar shows a match count, and whether the page scrolled. **This is the gate for the whole feature; if it fails in both placements, stop after P0.7 and report.** |
| P0.6 | Text selection and screen-reader name | Drag-select across the card title via Playwright mouse; read `getSelection().toString()`. Check the card has an accessible name via `page.accessibility.snapshot()` or the a11y panel | Selection string equals the title; a11y node exists |
| P0.7 | **Cost** | Build N cards (N = 256 and N = 2500, each with a same-origin 256px image). Measure: time to append; `performance.now()` around drawing all N at 64px into one atlas canvas; DOM node count; `performance.memory.usedJSHeapSize` before/after if available; Chrome Task Manager memory for the tab (manual, record) | Record numbers. Soft gate: 2500 draws at 64px under 500 ms total on this Mac, and the tab under 400 MB. If over, note it and still continue to Phase 1 with N = 256 only |
| P0.8 | Browser hit testing through a hidden host | With placement from P0.5, call `updateElementGeometry(card, { canvasTransform })` (record the real method name/signature from the explainer) with a matrix that puts the card over a visible region of the page; Playwright real click there; card `click` listener counts | Click reaches the card. Record PASS/FAIL. **Failure does not block Phase 1 or 2**; it blocks Phase 3 |

Stop conditions after Phase 0:
- P0.2 FAIL → stop, report. The API does not do what the post says on this build.
- P0.5 FAIL in both placements → stop, report. Without find there is no product
  reason to proceed.
- Everything else records and continues.

Budget: Phase 0 should take under half a day. If the flag does not exist in
either installed Chrome, that is the report; do not go hunting for builds.

## Phase 1: muriel library changes (additive) — **DONE, on the amended design**

> **[amended after Phase 0] The API sketch below is SUPERSEDED and kept for
> provenance.** `TileAtlas` gained no `host` option and no `drawElement()`,
> because constraint 6 means an element is never drawn into an atlas at all.
> What shipped: `AtlasPair` takes `resolveSource(index, tier)` returning an
> image source, `null`, or the exported `RETRY` sentinel; `cards.js` exports
> `CardHost` with `capture(index)`, `ready()`, `settled()`, `onPaint()`, and
> `supported()`; `TileField` passes `resolveSource`/`sourceDrawsPerPump`
> through; `TileAtlas` gained only `slotCoverage()`, used for the blank canary.
> Read `render_assets/_lib/cards.js` and the `resolveSource` JSDoc in
> `atlas.js` for the real contract, and
> [HTML_IN_CANVAS_RESULTS.md](HTML_IN_CANVAS_RESULTS.md) § 4 for the summary.

All edits in `../muriel/render_assets/_lib/`.
Keep existing exports and signatures. New behaviour is opt-in via new options.

### `atlas.js`

1. `TileAtlas` constructor gains `host = null`. When `host` is an
   `HTMLCanvasElement`, use it as `this.canvas` instead of creating one. Do not
   resize a host that already has the right size; do set width/height as today.
2. New method `drawElement(slot, el, cssW, cssH)`:
   - same slot bounds check and `clearRect` as `draw()`;
   - letterbox exactly like `draw()` using `cssW`/`cssH` as the source size;
   - `ctx.save(); ctx.translate(x + (w-dw)/2, y + (h-dh)/2); ctx.scale(dw/cssW, dh/cssH); ctx.drawElementImage(el, 0, 0); ctx.restore();`
   - inside `try`; on throw return `false` (mirrors the CORS comment in `draw()`);
   - set `this.fits[slot*2]`, `this.fits[slot*2+1]`, `_dirty = true`, return `true`.
   If P0.1 showed drawing must happen inside a `paint` handler, `drawElement`
   still does the draw; the *caller* is responsible for being inside one. Say
   so in the JSDoc.
3. `AtlasPair` constructor gains `resolveElement = null` and
   `elementDrawsPerPump = 16`. Document both in the JSDoc block.
4. `_pump()`: for a popped job, if `this.resolveElement` returns an element for
   `(job.index, job.tier)`, call a new `_drawElementJob(job)` instead of
   `_load(job)`. Count element jobs drawn in this `_pump()` call; stop after
   `elementDrawsPerPump` so a 2500-card first frame cannot stall. Because
   element jobs are synchronous they must **not** touch `_inflight`.
5. `_drawElementJob({ index, tier, slot })`: re-check `slots[index] === slot`;
   call `atlas.drawElement(slot, el, w, h)` where `w`/`h` come from
   `el.offsetWidth`/`offsetHeight` (record in the JSDoc that a card in a
   `display:none` host has zero size and will fail here). On success call
   `onTileReady(index, tier)`. On failure follow the **same** cleanup as the
   image error path: add to `_failed`, free the slot, reset owner. One path.
6. `flush(now)`: after flushing, call `this._pump()` once so element jobs left
   by the per-pump cap drain across frames.

### `hybrid.js`

No change in Phase 1. The pool keeps working. (If Phase 3 happens, this is
where the pool is retired.)

### New `cards.js`

A small helper the consumer can use, so wunderkammer does not hand-roll the host:

```js
export class CardHost {
  constructor({ container, count, build, className = 'drawable-card', width = 340 })
  // creates <canvas layoutsubtree> inside container with class 'card-host',
  // one <div drawable> per index, each filled by build(index, el) (never innerHTML),
  // each with el.dataset.index = String(index).
  elementFor(index)   // the card, or null
  indexOf(el)         // reverse lookup via a WeakMap
  onPaint(fn)         // subscribes to the canvas 'paint' event; fn(indices: number[])
  dispose()           // removes listeners and the host subtree
  get canvas()        // the host canvas, to hand to TileAtlas as `host`
}
```

Placement CSS (put in `spatial.css`, class `card-host`) is whichever P0.5
placement passed. Include `pointer-events: none` unless P0.8 passed.

### Tests (muriel)

Add `tests/spatial-cards.test.mjs` (node:test, same stubbing style as
`tests/spatial-hybrid.test.mjs`):

- `AtlasPair` with a `resolveElement` that returns a fake element and a stubbed
  `TileAtlas.drawElement` returning true: the job never increments `_inflight`,
  `onTileReady` fires once, slot ownership is set.
- Same with `drawElement` returning false: `_failed` has the key, the slot is
  freed, `nearSlot[index]` is -1, `_nearOwner[slot]` is -1.
- Per-pump cap: 40 element jobs queued, `elementDrawsPerPump: 16`, one
  `_pump()` draws exactly 16; a following `flush()` draws 16 more.
- A stale job (slot reassigned while queued) is skipped, exactly like the image
  path.
- Existing `spatial-hybrid` and `spatial-piles` tests still pass unchanged.

Add a **pixel** test only if the probe page is reusable: a Playwright script
against the probe page that draws one card into a 256px slot and asserts the
title row has dark pixels. If Canary cannot be launched headless with the
flag, mark this manual and record the screenshot path instead.

Update `muriel/CHANGELOG.md` with one entry under the unreleased heading:
what was added, what is opt-in, what is Chrome-only.

## Phase 2: wunderkammer pull-through — **DONE**

> **[amended after Phase 0]** Wired as described, with `resolveSource` in place
> of `resolveElement` and no `host` argument. Two departures worth knowing:
> drawable cards carry `sp-dcard`, NOT `sp-card` (that class is the overlay
> pool, which both the CSS3D layer and the existing tests select on), and the
> find handler ignores the paint event's element list — Chrome repaints every
> drawable around a find — **corrected 2026-09-08 after driving the real find
> bar**: `changedElements` from the actual bar is *exactly* the matching set and
> narrows as you type (`meridian` → `[0,12,24,36,48]` on a 60-card page), and
> the bar leaves no DOM selection at all. `window.find()` behaves the opposite
> way on both counts, which is why the scriptable path misled the first design.
> A find answers with a set; the camera fits it. A whole-corpus repaint is
> ignored, and the handler stays disarmed until `CardHost.settled()`, because a
> hero image finishing load repaints its card the same way a find does.


1. From wunderkammer: `node wall/spatial/lib/sync.mjs --pull`. Confirm `cards.js`
   arrived and `VENDOR.md` updated.
2. In `wall/spatial/spatial-view.mjs`:
   - Add a flag `window.__cwDrawable`; default is the feature detection from
     Phase 0. When false, **nothing below runs** and the view is byte-for-byte
     today's behaviour.
   - In `_replaceField()`, when the flag is on: create a `CardHost` inside
     `this.host` with `count = clips.length`, `build: (i, el) => this._buildCard(i, el)`
     (the existing method; it already uses `textContent` and adds the Obsidian
     link). Image `src` must go through `proxied()`. Pass `host: cardHost.canvas`
     into the near `TileAtlas` and `resolveElement: (i) => cardHost.elementFor(i)`
     into the `AtlasPair`. Leave the far tier on images in this phase (64px of a
     card is a blur; measure in Phase 0 P0.3 and switch far too only if it was
     legible).
   - Dispose the card host in the same place `hybrid.dispose()` and
     `field.dispose()` are called, so indices never outlive their snapshot.
   - Subscribe `cardHost.onPaint(indices => ...)`: ignore indices that are
     currently promoted in `this.hybrid.live` (their DOM twin is what changed);
     for the first remaining index `i`, if `i !== this._lastFind`, set
     `this._lastFind = i`, call `this.field.atlases.request(i, 'near')`,
     `this.hybrid.setFocus(i)`, `this.nav.select(i)`, and `this.fit([i])`.
     Expose `this._lastFind` on `window.__cwSpatial` for tests. Assumption to
     verify and note in the file: the app never mutates a card after build
     except via the atlas draw, so a paint event for a non-promoted card means
     the browser did it (find, selection).
3. Do **not** touch the flat wall, `applyFilters`, permalinks, piles,
   view-state, or `index.html` beyond loading nothing new (the module is
   imported from `spatial-view.mjs`).

### Acceptance (Phase 2), all on the Psychodeli Atlas instance on 4174

| id | check | evidence to record |
|---|---|---|
| A1 | Flag off: all existing wunderkammer tests pass unchanged | test output |
| A2 | Flag on, Canary: open 3D, zoom to a stack, screenshot a near tile. The title band region shows text pixels; the same region with the flag off shows only image pixels | two screenshot paths + the pixel counts |
| A3 | Flag on: `document.querySelectorAll('[drawable]').length === clips.length`, and the `.sp-card` pool count is still 14 | console output |
| A4 | Find flies the camera: manual Cmd+F for a title word present in exactly one clip → `window.__cwSpatial._lastFind` equals that clip's index and the camera moved (record `basePos` before/after) | numbers |
| A5 | Find does not change scope: `state.filtered.length`, the URL, and `view-state.json` mtime are identical before and after A4 | numbers |
| A6 | Filter change while flag on: change a facet, confirm no stale tile from the previous snapshot appears (screenshot a tile whose index now means a different clip; pixels differ from before) | screenshot paths |
| A7 | Resource envelope: DOM node count, Chrome Task Manager memory for the tab, and `performance.now()` frame time over 10 s idle, flag on vs off | a small table |
| A8 | Flag on in stable Chrome 152 without the feature: view behaves exactly as flag off (detection guards everything); no console errors | console output |

## Phase 3 (do not start without Andy's go)

Only if P0.8 passed: retire the `HybridField` pool by giving the browser the
hit-test geometry for near-tier cards each frame and moving focus to the
persistent cards. This dissolves the P1 gates "accessible focus under DOM-pool
pressure" and "Tab exit" in `HYBRID_HARDENING.md`. Write a separate spec
first; it touches `navigate.js` and every consumer of `elementFor()`.

## What this experiment does not do

- Does not lift the 4096-slot far-atlas ceiling.
- Does not fix failed-slot cleanup, stale callbacks after disposal, or
  context-loss recovery. Those remain the hardening plan's P1 items and the
  new element path must follow whatever lifecycle that plan lands.
- Does not work in Safari, Firefox, or Chrome without the feature. The flat
  wall remains the universal path.
- Does not make remote heroes render in the static GitHub Pages demo.

## Report format (write this; do not commit)

Create `docs/HTML_IN_CANVAS_RESULTS.md`:

1. Chrome versions and flag status, verbatim.
2. Phase 0 table with PASS/FAIL/BLOCKED and the evidence column filled.
3. Which stop condition, if any, fired.
4. Phase 1 and 2: files changed (`git status --short` in both repos), test
   output, acceptance table.
5. The three things you were least sure about.
6. Open questions for Andy, each one sentence.

Keep prose terse. Numbers get units. No "remarkably", no "surprisingly".
