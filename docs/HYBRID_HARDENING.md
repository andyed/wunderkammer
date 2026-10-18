# Hardening the DOM/pixel boundary

Source review: 2026-09-07. This is a work plan, not a patch or a claim of measured
production reliability. Read [SPATIAL.md](SPATIAL.md) for current behavior and
[PHILOSOPHY.md](PHILOSOPHY.md) for why representation continuity matters.

## Preserve the architecture; make its obligations explicit

The far atlas carries collection context, the near atlas spends resolution on
nearby/exposed items, and a small promoted DOM pool carries text and interaction.
Keep one canonical clip identity and scope above all three. A renderer index is
an address within a particular field generation; a texture slot is a temporary
allocation. Neither is a durable item identity.

Existing protections are substantial: missing slots propagate as `-1` instead
of aliasing slot zero; near-slot ownership is checked when loads finish; pool
membership uses hysteresis; collapsed piles only promote exposed covers; filtered
fields are rebuilt; DOM and GPU rectangles are aligned; autonomous camera motion
was removed. Tests read actual screenshot pixels after index reuse and cover
changes, not only DOM URLs or atlas bookkeeping.

These protections do not yet constitute complete lifecycle management. The
flat DOM remains allocated beside the spatial renderer, candidate scans grow
with the field, the far atlas has a ceiling, and hidden-pane animation callbacks
continue scheduling even though the hidden renderer skips its drawing work.

## Concrete findings and acceptance gates

P1 below means resolve before presenting the affected spatial capability as
supported in a preview. A flat-only preview can explicitly defer spatial gates.
Line numbers are a checkpoint; use the named functions when they drift.
In this table, `lib/` means `wall/spatial/lib/`.

| Priority / finding | Current evidence | Required result |
|---|---|---|
| P1: failed draw can retain a blank allocated slot | `lib/atlas.js`, `TileAtlas.draw()` (~135) can return false; `AtlasPair._load()` (~314) frees on image error but not a false draw. An absent resolved URL also marks failure without releasing its allocated slot. | Every unsuccessful load/draw follows one cleanup path, releases its ownership, reports failure and can be retried without consuming capacity forever. Force false draw and absent URL in a fixture. |
| P1: pending image work outlives field disposal | `AtlasPair.dispose()` disposes textures and clears queues; active `Image` handlers have no generation/disposed guard and can call `_pump()` later. `SpatialView.setClips()` replaces the field. | Late completions from a retired generation cannot publish readiness, mutate current ownership or restart work. Resources settle after rapid A→B→empty→A scope changes. Cancellation must still settle accounting exactly once. |
| P1: context loss and teardown have no application recovery path | `lib/spatial.js:createWorld()` installs renderers, window listener and observer without a returned disposer. `SpatialView` schedules an ongoing RAF; no application context-loss/recovery handler was found. | A failed/unsupported WebGL initialization or forced context loss leaves flat access usable and scope intact. Restore reconstructs resources from canonical state or offers an explicit retry. Repeated mount/teardown does not multiply listeners, RAFs or textures. |
| P1: far capacity is a product boundary | `TileAtlas` caps dimension at 4096; 64px far tiles yield 4096 slots. `instanced.js` correctly preserves slot `-1` as a placeholder. | At 4095/4096/4097 items, never repeat another item's pixels. Either surface a measured supported limit with a complete flat path, or implement atlas paging/residency before claiming larger spatial support. |
| P1: keyboard escape from the field | `lib/navigate.js:handleKey()` handles Tab whenever `onGroupStep` exists; the app supplies that callback even for an ungrouped field. | Tab and Shift-Tab can leave the field. Group traversal has explicit bounds and does not trap users. Test through the whole app, with an empty and ungrouped subset. |
| P1: accessible focus under DOM-pool pressure | `navigate.js:select()` removes `aria-activedescendant` when no promoted node exists. A live announcement remains, so this is not proof that activation always fails. | Each selected GPU item has a stable accessible name and working activation, even with a saturated pool or a retired DOM node. Reserve/pin focus or provide a semantic proxy; test with keyboard and a screen reader. |
| P2: hung and failed images have no recovery policy | `_failed` is permanent within the pair; active images have no timeout or bounded retry. | Bound concurrency, time and retry count. Prioritize visible content, expose failures separately from missing media, and offer explicit retry. Slow or broken sources cannot monopolize every slot. |
| P2: thumbnail tiers do not select distinct assets in the spatial resolver | The flat wall uses `coverVariants`; the spatial resolver currently uses the cover URL for both tiers. | Select source size from tier/projected need and validate actual decoded memory and image quality. Do not assume a small texture means a small download/decode. |

The stale-load observation is a lifecycle risk established by source inspection;
it is not a claim that a reproduced old request already corrupted a replacement
field. The missing cleanup and Tab branches are concrete implementation findings.
Add adversarial reproductions before editing their owning code.

## Suggested implementation sequence

1. **Make the lifecycle observable.** Add a debug snapshot with field generation,
   live/free slots by tier, queue/in-flight counts, decoded/failed/timed-out counts,
   promoted-node count and active RAF state. Keep diagnostics off the product's
   normal surface except actionable failures. Never include private source paths
   in exported telemetry by default.
2. **Unify completion and disposal upstream.** One load job owns one generation,
   item key, source revision, tier and slot lease. Success validates all ownership
   before publishing. Error, timeout, stale completion and disposal settle once.
   Prefer explicit leases/generation checks over more array-index exceptions.
3. **Recover through the existing app state.** Add a context-loss/init-failure path
   and a complete disposer, then integrate visible recovery in `SpatialView`.
   Keep scope, focus and permalink state; texture residency is recreated, never
   serialized. Returning to flat must not overwrite the saved spatial arrangement.
4. **Prove keyboard continuity and capacity.** Fix Tab behavior and focused-item
   semantics, then make overflow explicit. A static poster image is not an
   accessible fallback for the collection.
5. **Spend resources according to use.** Suspend hidden/idle work where possible,
   bound pixel ratio and decoded-image residency, use tier-specific derivatives,
   and consider releasing/virtualizing the inactive flat DOM. Measure before
   choosing pagination, multiple atlases or a replacement renderer.

Steps 2–4 change vendored code upstream in
`../muriel/render_assets/_lib`, with upstream tests,
then an intentional sync and downstream browser checks. The app-specific
failure message/state transition belongs in `wall/spatial/spatial-view.mjs`.
Do not use `--pull` as an unexplained repair: review both working trees first.

## A renderer proof has four parts

| Evidence | What it answers | What it does not answer |
|---|---|---|
| State and identity assertions | Did scope, focus, source and slot owner remain correct? | Whether those pixels appeared |
| DOM geometry and activation | Does the promoted card match its GPU rectangle and open the right item? | Whether the GPU sampled the correct atlas region |
| Rendered pixels | Does the frame contain the intended image, orientation and crop? | Whether all offscreen items remain reachable or memory is bounded |
| Device profiling and accessibility | Is the whole experience responsive and usable on a named device/input? | Universal scale or usability claims |

Build a diagnostic atlas with distinct numbered/color-coded tiles, transparent
edges, wide/tall images and missing media. Sample every resident slot and slot
boundaries, including the last row/column, under far→near→DOM→near→far changes.
Test slow A completing after B reuses a slot, the same ID with changed artwork,
pool saturation, resize/DPR changes, fast filter churn, network disconnect and
context loss. Assert the activated URL as well as displayed pixels.

Existing fixtures require exact idle pixel equality. The historical real-corpus
antialias allowance is at most 2/255 per channel on less than 0.01% of the pane;
do not enlarge it to hide movement. DPR/browser-specific pixel comparison needs
an explicit rationale and should retain strict identity/geometry checks.

## Measure a support envelope, not an impressive maximum

Use 0, 1, small, 406, ~1,800 and 4,096/4,097 items. Larger 10k/25k collections
are stress targets, not advertised capability. Record named hardware, OS,
browser, GPU/software rendering, DPR, viewport, index composition and cache state.

Measure p50/p95 input-to-visible-update, frame time during pan/zoom, first useful
overview, settled decode time, long tasks, whole-page DOM, decoded image memory,
atlas bytes, renderer texture/draw counts, requests, errors and memory after
repeated corpus replacement. Warm/cold and local/remote media are different runs.
Set release budgets after a baseline on the target devices; no FPS target here
has been met merely because a headless test passed.

Manual coverage still needed: Safari/WebKit and Chromium on a named MacBook,
an integrated-GPU Windows/Linux machine before supporting it, touch without
hover, reduced motion, keyboard-only use and VoiceOver. The current DOM pool
size and atlas memory counters exclude other page allocations.
