# A stable light table

Implementation brief, 2026-09-20. The six directions in the spatial assessment
are approved. This pass joins the existing scope, item identity, camera,
reader, and renderer paths; it does not introduce a second collection model.

## Interaction contract

Approach a tray without filtering. Spread its contents, lift one item to read,
step through the existing review order, put it back, then return to the exact
prior camera. Explicit facet/filter controls alone change membership. Depth
means containment and attention. Pointer, keyboard and touch have equivalent
routes; reduced motion removes travel without removing state or recovery.

## Six implementation slices

1. Preserve geometry when detail opens; require fresh pointer movement and
   dwell after camera/layout changes before a hover preview.
2. Lift the same decoded artwork to the reader, reverse it on close, retain a
   thumbnail until full detail is decoded, and prepare immediate neighbours.
3. Calculate layout once; animate a bounded set of visible transforms, hold
   image upgrades during travel, and materialize hidden presentations on entry.
4. Use pointer-anchored, interruptible cameras in both views, with reversible
   pile approach/spread/return and reduced-motion snapping.
5. Keep a bounded canvas overview available while preserving DOM identity,
   keyboard routes, and item hit targets; use hysteresis for representation.
6. Prioritize visible/current/next images with bounded decoding work, preserve
   spatial promotion incumbents only while they remain eligible, and avoid
   unnecessary work when settled.

## Implemented mechanisms and budgets

- `reader-lift.mjs`: one travelling artwork ghost, thumbnail-to-detail decode
  handoff, two media workers (one reserved for demand), six-entry working set,
  current item plus immediate neighbours, and stale-generation rejection.
- `layout-motion.mjs`: at most 64 visible card animations. A rapid subsequent
  edit reads only those active local transforms, then cancels them together,
  so interpolation continues from the visible rectangle rather than jumping.
- `overview-surface.mjs`: viewport-sized canvas capped at 4,194,304 backing
  pixels, DPR at most 2, decoded cache capped at 16,777,216 pixels / 4,096
  entries, three loaders, and 4 ms paint slices. Arrivals paint incrementally;
  decoded edge images support cached-picture motion beyond the old viewport.
  Pixels come from a runtime sprite atlas (`overview-atlas.mjs`: 1024-px
  pages, slots sized to the drawn size up to 128 px, at most 160 copies a
  frame). A repaint therefore never re-uploads each hidden `<img>`. Tiles go
  back to the DOM through a warming handoff: the canvas keeps covering them,
  draws 64 of their own images per frame, and reveals all loaded tiles
  together. During layout motion only the travelling cards leave the canvas.
  These bound this module's own
  work, not the browser's total DOM/image or GPU memory.
- `image-work.mjs`: eight visible-image decode slots, largest projected area
  first, with queued scope work retired on layout changes. Detail media and
  overview work have their own bounded queues. Responsive upgrades decode a
  replacement off the desk before exchanging the image; the tile, artwork and
  hit target stay in place while that request is pending.
- `spatial-view.mjs`: one existing animation loop for camera and field,
  reversible tray geometry, a retained rim/name, pointer-anchored zoom,
  midpoint touch pan/pinch, and visible-size DOM eligibility with hysteresis.

The flat desk retains its DOM semantics throughout. Reader opening no longer
introduces a scope bar or a stage resize; actual filtering still exposes scope
history. Mobile detail contains keyboard focus and restores the prior inert
state of outside controls on close. Foreground approach, explicit scope change,
transient preview, committed focus and persisted pile state remain separate.

## Muriel synthesis

Mode: Direct implementation of the user-approved direction, with empirical
validation still required for its usability claims. Retained origin geometry
is the common mechanism: it supports orientation, exact return, presentational
image lift, and less layout work. A free-flying gallery adds navigation cost
without advancing this task. Proof is the integrated approach/open/step/close/
return journey, render inspection, intent guards, reduced motion, and bounded
resource checks. Passing correctness tests is not proof of silky frame timing.

## Explicit follow-up boundary

- Dense zoom-out, filtering and regrouping still have measured frame-time
  tails. Their profiling and acceptance criteria remain first in TODO.md;
  implementing all six mechanisms does not close the smoothness goal.
- Manual pile creation, drag-to-assign, and saved hand arrangement.
- Large-pile fan/scrub exploration and partial spread virtualization.
- Persistent spatial filtering with excluded ghost context and an explicit
  gather-matches action; compare sparse results before choosing a default.
- Upstream atlas region batching/upload thresholds, context-loss recovery,
  capacity beyond 4,096, and decoded-memory accounting across GPU families.
- Remote-source derivative capture, cold-offline packaging, release work.
- Comparative refinding study and controlled 60/120 Hz input-to-photon timing;
  diagnostic rAF intervals on a busy desktop are not that evidence.

These remain TODOs with acceptance criteria in the main TODO and hardening
documents. They are not claimed as delivered by this interaction pass.
