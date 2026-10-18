# Context: the background plane, and cluster scope pivots

Local prototype, 2026-09-07. Filtered content stays in the compact foreground.
Zooming out below Fit reveals the **whole corpus on a background plane**, framed
around the working subset; nothing contextual enters the matching count or the
camera's Fit bounds. The earlier screen-space row of up to three cluster
suggestions was judged not to work as the zoom-out reveal. Its scope mechanics
(switch, Shift-add, union branches) are retained but the panel has no placement
yet; the detail pane footer is the leading candidate.

## Zooming out shows the full canvas that filtering hid

The background plane is the unfiltered wall — the same layout the corpus has
with no filter, for the current grouping, sort and viewport aspect — so places
stay recognisable across filters. `frameAround()` in `wall/layout.mjs` opens a
gap at the cleanest row or block boundary nearest the plane's middle, wide
enough for the foreground plus a margin, centres the plane on the foreground
and translates it; the plane is never repacked and never overlaps a foreground
tile. When no clean boundary exists the whole plane sits below.

Items that were lifted into the foreground stay marked in place (accent outline,
55% image opacity); everything else dims to 38%. Group headings and no-media
titles keep full contrast; tile captions are withheld on the plane rather than
dimmed below the 8:1 floor. Hover restores full opacity; click Dives into that
item without changing scope. Background tiles are not in the tab order — the
facet rail remains the keyboard route to excluded material.

The plane is a sibling layer of the canvas under a stage perspective. It
shares the camera transform (`Viewport.mirror`) plus a depth push and a 10°
tilt about the foreground's centre line, both in world units so they scale
with the camera: above the foreground it recedes and foreshortens, below it
comes forward but stays behind the foreground, and panning parallaxes it. The
foreground stays a flat, untouched layer; no tile carries a 3D transform. The
framing clearance scales with the foreground (20% of its height) so parallax
does not slide the plane under it, and background culling grows the visible
rect because perspective shrinks the plane toward the stage centre.

**Search is the first focus.** When a search begins, the working set at that
moment (the place you searched from) becomes the context plane instead of the
whole corpus; results are the focus, and matches light up where they were
(`.search-context`, 90% opacity, accent ring). Results that share nothing with
that place have no context there, so the plane is not shown. Clearing the
search drops the pre-search place and the plane is the corpus again. This is
`state.contextBase` in `wall/wall.mjs`; it is not part of the permalink, so a
restored link uses the corpus plane.

The reveal **latches** once the camera is below 90% of Fit scale, so zooming
back in to inspect a background item keeps the plane. Only Fit, a scope change
or switching to 3D dismiss it, and dismissal removes the plane's DOM. The stage,
foreground layout and Fit content never change; while revealed, bounded and
edge pan may travel the whole plane. The latch persists as `ui.context` in
permalinks. With no filter active there is nothing hidden, so zooming out shows
no plane.

## Cluster suggestions (mechanics retained, placement open)

- Click a cluster to replace the working subset with its exact previewed members.
- Shift-click or Shift-Enter/Space adds those members to the current subset.
  The explicit Add button provides the same operation for touch and keyboard.
- Hover or focus previews the replacement count and deduplicated union count.
- Scope branches are joined by OR and can be removed individually. Search and
  ordinary facets subsequently refine the entire union. Facets retain OR within
  one property and AND between properties.
- Adding after a refinement freezes the currently visible subset as the base
  branch and clears the consumed filters, so they cannot exclude the new branch.
- Back restores previous query, facets, scope membership, grouping, and flat
  camera position/scale. All content clears scope and refinements. Removing the
  last branch yields an empty scope, not a silent reset to the whole corpus.

The clusters are membership snapshots, including all their counted items, not
just the six example images. Scope uses URL identity (ID fallback), never tile
occurrences. Scope snapshots now persist through [permalinks](PERMALINKS.md), independently
of clip records and mutable saved piles. In-app Back and browser Back use the
same history; edge gesture Undo remains a separate transient recovery.

## Cluster selection and visual grammar

`wall/context-clusters.mjs` derives candidates from excluded items using the
existing adapter properties. Temporal alternatives, shared colors, and shared
kaleido/detail/repetition estimates supply the first three families. Tags and
sources are a fallback. Ranking favors shared attributes and active-facet
alternatives, with date proximity and attribute specificity as tie-breaking
signals. Near-universal structural attributes are omitted unless actively
filtered. Identical candidate memberships are not shown twice.

Labels state the property/value and total membership; the context row explicitly
says these items are outside the current scope. This is explainable facet
clustering, not a trained visual or semantic similarity model. Estimated source
attributes retain their estimated labels. Images use 65% opacity, recovering full
opacity on hover/focus; text uses the existing opaque high-contrast tokens.
Images are contained, not cropped. Samples are distributed through the existing
corpus order and do not claim to be representative centroids.

The cluster panel sits outside the transformed canvas so selection does not
inherit drag/zoom handlers; it is currently never shown by the app, and tests
expose it directly to exercise the mechanics. The same canonical filtered
membership drives the flat view and 3D; the background plane appears only in
flat view and shares tile construction with the foreground.

## Proof and next questions

Unit coverage proves the framing math (no overlap, no torn rows, centred,
translated not repacked). Real-browser coverage exercises reveal on one zoom
step, an unchanged count and stage, no background tile under a foreground tile,
the latch surviving zoom-in, Dive from a background item, Fit dismissal with
DOM removal, and the permalink round trip of the latch. Cluster mechanics keep
their coverage: exact replacement, union deduplication, refinement, branch
removal, empty/full states, mouse/keyboard/touch selection and exact
flat-camera Back recovery. Mutations that turn union into intersection, drop
the Shift modifier, or reveal the plane with no filter active must fail these checks.

Rendered checks use the actual Psychodeli Atlas 2026 subset (108 of 406 images)
at wide and narrow stage sizes. The interface mechanics are verified; cluster
ranking, the context row's salience, and its value during exploration remain
human-use questions. Compare whether pivots reveal useful alternatives without
confusing context with matching content. Future spatial placement should preserve
foreground readability and useful camera boundaries.
