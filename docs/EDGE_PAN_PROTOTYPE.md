# Edge pan-to-zoom prototype

Status: experimental interaction, 2026-09-07. Mechanical checks and rendered
proof do not establish that it feels better than bounded panning.

Product rationale: [Philo: prevent unhelpful navigation](PRODUCT.md#philo-prevent-unhelpful-navigation).
Initial user feedback on 2026-09-07 was positive: edge zoom is "pretty cool" as
a first instantiation of preventing error. This supports further exploration;
it does not yet establish a general advantage over bounded panning.

## Try it

Edge zoom is the default flat-canvas behaviour since 2026-09-07; `?pan=free`
and `?pan=bounded` remain as comparison conditions and the selector is hidden.
Historically: open `http://127.0.0.1:4174/?pan=edge`, or select **Edge zoom (test)** in the
flat view's Pan behavior selector. Compare **Free pan** and **Bounded pan**.
Switching behavior returns to Fit so comparisons start with the same overview.
The selected experiment is reflected in the URL; corpus and saved piles are
unchanged. The selector is disabled in 3D.

Drag normally through the collection. Once a drag reaches its outer bounds,
120 CSS pixels of further push produce an edge cue before scaling begins.
Continued pushing increases scale exponentially, with a 2× cap per gesture
and the existing absolute maximum scale. Only blocked movement aimed into the
edge contributes: a pointer event counts as push when it is within about 53°
of straight in (`PUSH_ALIGNMENT`, 0.6). Drift along an edge does not add up to
a zoom, which matters most on an axis where the collection fits, since every
pixel of drift on that frozen axis is blocked. Pulling back always counts, so
reversal still unwinds at once. Tangential movement continues along the edge. The zoom anchor is a point on
an actual image at the approached boundary and remains fixed for the gesture.
Reversing unwinds zoom before resuming ordinary pan. Extra travel beyond the
cap is discarded so reversal responds immediately.

Release to keep the view. **Undo edge zoom** or Escape restores the camera from
before the gesture. Another camera gesture, Fit, a layout/subset change, or a
stage resize retires that temporary undo. Escape closes an open detail pane
before it acts on the canvas.

This first prototype converts **pointer dragging only**, including touch
pointer input. Wheel scrolling is bounded in both experimental modes: its
momentum cannot initiate zoom. Command/Ctrl-scroll remains explicit zoom.
Free pan preserves the previous unconstrained behavior. Layout gaps are
navigable; the prototype uses the outer envelope of item rectangles, not image
pixels, texture loading, or a per-pixel density threshold.

## Integration and limits

`wall/viewport.mjs` owns the one flat camera. `wall/edge-pan.mjs` computes
candidate transforms from current geometry and holds only gesture-local latch
state. `wall/wall.mjs` supplies tile rectangles and the existing shared subset;
it also connects comparison controls and recovery. Resizing the detail pane
continues through the existing stage ResizeObservers. Flat pointer handling is
inactive while 3D is open. Native image dragging is disabled on flat tiles so
it cannot cancel the canvas gesture; detail images remain ordinary images.

This is not semantic entry into a stack, a scope change, or related-item
navigation. Geometry can be verified automatically, but anchor choice, the
change from translation to scaling, and the 120px / 320px tuning need human use.

Tuning record: the dead zone was 32 px until 2026-10-20, with every blocked
pixel counted. In use, a drag that only arrived in a corner zoomed, and the
landing opened details on zoom (ZOOM_DETAIL.md). The request was that an edge
zoom should take a real push. The dead zone went to 120 px and drift stopped
counting; details on zoom is unchanged, since an edge zoom is now deliberate.
No automatic zoom from wheel tails and no 3D conversion are implemented.

## Probe and evidence

Compare the same tasks with bounded pan and edge zoom: locate an image, inspect
it, compare it with a neighbour, then recover the overview. Use the full corpus,
the 68-image filtered set, sparse groups and one image. Observe blank-screen
excursions, corrective zoom-outs, target changes, and difficulty returning.
Retain the conversion only if it reduces lost views without increasing those
corrections; otherwise prefer bounded panning or revise the gesture/anchor.

Regression coverage checks anchored scale, the cap and immediate reversal,
diagonal boundaries, internal gaps, wheel isolation, actual image-backed drag
input, rendered tile enlargement, exact Undo/Escape recovery, and empty/filter
transitions. Deliberately disabling the zoom conversion or restoring native
image dragging must fail the image-backed browser check.

The real 68-image Psychodeli Atlas subset grew from scale 0.3314 to 0.6628 during
a drag, with the same membership and exact Undo recovery. Captures are local
under `.local/psychodeli-atlas/edge-pan-{before,drag,after}.png`.

Muriel synthesis — Probe, implemented for comparison; experiential benefit
remains unproven. The shared camera/boundary mechanism supplies bounded panning,
optional edge zoom and reversible recovery without changing corpus scope.
