# Wunderkammer product requirements

**Direction agreed 2026-09-07.** This document defines the intended feature set.
Implementation status below describes the current local code, not a release.
See [ARCHITECTURE.md](ARCHITECTURE.md) for state and integration contracts and
[SPATIAL.md](SPATIAL.md) for the current spatial renderer. The expanded
[philosophy](PHILOSOPHY.md) records the reasoning and tensions behind these
requirements; HANDOFF.md is the next agent's starting point.

Wunderkammer supports **survey / review / dive** over visual research collections.
**Search and faceting** are the shared functions for selecting the subset of
content to work with. They are available across all three activities; they are
not a fourth viewing mode or a new selection product.

## The four functions

| Function | User intent | Required experience |
|---|---|---|
| Search + facets | Define and refine the working subset | Search the indexed content, narrow by properties, see the active scope and matching count, and widen or clear it without losing orientation |
| Survey | Orient and explore at collection scale | Use spatial depth, z-order, layers, and stacks to find promising material and expose what is buried |
| Review | Examine and compare a subset | Choose grid layouts, grouping, and explicit sorts suited to the current material; keep the subset and reading position clear |
| Dive | Engage with an individual item and follow connections | Inspect available media, notes, metadata, and provenance; open the source or owning editor; pivot to related items or subsets |

These are activities over one corpus. They need not become three separate
pages. The existing flat wall, spatial view, and detail panel are their starting
points, not final definitions of the interaction.

## Philo: prevent unhelpful navigation

**Product philosophy, recorded 2026-09-07:** pan, zoom, and other navigation
controls should not do un-useful things. Prevent interaction errors at the
point of action, rather than making the user recover after losing the content.
Judge a navigation operation by whether it helps someone survey, review, or
dive—not merely by whether the camera can perform it.

Panning into empty space, zooming until nothing is recognizable, and losing
one's place are examples of technically valid operations that can defeat the
task. Keep content reachable and orientation recoverable. When an action stops
being useful, constrain it or offer a predictable, useful continuation. Any
change in gesture meaning must be apparent, controllable, and reversible;
preventing error must not introduce surprising camera motion or change scope.

[Edge pan-to-zoom](EDGE_PAN_PROTOTYPE.md) is the first instantiation: when
outward dragging reaches the collection edge, further travel can enlarge the
content instead of moving it offscreen. Reversing the gesture or using Undo
restores context. Initial user feedback was positive ("pretty cool"); the
broader principle is adopted, while the gesture and its tuning remain a
prototype to evaluate against bounded panning.

Apply this principle across pan, zoom, Fit, layout changes, and transitions
between Survey / Review / Dive. It is a design criterion, not a claim that all
current controls already satisfy it or that every boundary should cause zoom.

## Space filling is a UX constraint

Use the available viewport for content. A fitted collection must not collapse
into a thin strip surrounded by unused canvas. Match the composition to the
usable stage aspect, compact groups into available space, and preserve media
proportions. Reframe when the subset changes so a few matches do not retain the
zoom of a much larger collection. An overview should reflow when the window or
filter rail changes; deliberate pan/zoom exploration must remain stable.

Fit is a collection overview, not a promise that hundreds of item captions can
be read simultaneously. Review needs recognizable thumbnails and readable
content at the working scale; search/facets and zoom must make that scale easy
to reach. Future Survey stacks and layers should expose recognizable covers,
labels and counts rather than shrinking every item into visual noise. Space
filling must not conceal clips, crop away evidence, or distort their geometry.

## Search and facets define scope

- Preserve the existing semantics: all search terms must match; facet choices
  are OR within a facet and AND across facets. Search and facets combine by AND.
- Make the query, active facets, and matching count understandable in every
  activity. Changing the presentation does not clear or reinterpret them.
- Let people search within a facet's complete value list and remove selected
  values even when the list is truncated or the working subset is empty.
  **In view / available** distinguishes current membership from alternatives
  under the other constraints. Removing one facet preserves text, other facets,
  and frozen branches; **All content** explicitly clears the whole scope.
  See [FACETING.md](FACETING.md) for the implemented contract and its limits.
- Grouping and sorting arrange the subset; neither changes membership.
- Distinguish the working subset from the currently focused item and from the
  items visible through the viewport or an overlapping stack.
- A relationship pivot must explain its relation and whether it searches within
  the current subset or across the corpus. Its new scope must be visible and
  reversible.

Lasso selection, a set-algebra interface, and saved live/fixed subsets were
discussed as possibilities. The context-cluster prototype now supports explicit
OR unions of membership snapshots, without requiring a general set-algebra interface. The fourth
function is the search and faceting Wunderkammer already has.

## Survey: depth and layers as working controls

Large-scale z-order and layer-stack interaction is a central product direction.
Depth must help someone explore and reach content. It must be possible to expose
occluded items, inspect a stack, bring material into focus, and recover the
surrounding context. Hidden material must remain discoverable and reachable.

Working vocabulary, with exact behavior still to be designed:

- **Layer:** a plane or set of material with a place in an ordered composition.
- **Stack/pile:** a group of overlapping items that can be inspected together.
- **Depth/z-order:** how those items and groups are presented and exposed.

Whether layers primarily represent sources/topics/time slices or a user's
working arrangement remains open. Bringing forward, peeling, fanning, spreading,
and depth scrubbing are candidate gestures, not committed features. Preview,
focus, and persistent rearrangement must have distinct effects.

Large scale is a requirement to establish with corpus and device measurements,
not an unbounded item-count claim. Keyboard access, reduced-motion behavior,
readable text, and a usable flat presentation must preserve access to content.

## Review: layouts and sorts for subsets

Review must support deliberate comparison through grid layout, grouping, sort
field/direction, and readable density. Image proportions and screenshot detail
matter: any cropping must be apparent, and the complete item must remain
accessible in Dive. Sorting a review must not rewrite the survey arrangement.

Justified rows are the baseline. Available flat-view attributes now supply
explicit within-group sorting and pinned/temporary color lenses. Additional
layout choices, multi-key sorts and ordered Dive traversal remain open. Evaluate other layouts on mixed portraits, banners, screenshots,
missing media, and uneven group sizes before adopting them.

## Dive: an item is a place to continue from

Dive should expose the available media and research context, support moving
through the current review order, and provide several intelligible ways to
reach related content. Candidate relation families include shared properties,
source or temporal provenance, authored/spatial relationships, and visual or
semantic similarity. Their priority and computation remain open.

Each result should explain why it is related. Missing metadata or unavailable
similarity services must not prevent opening an item or using search and facets.
Keep a return path to the previous subset, order, focused item, and position.

## Continuity and ownership

The same clip identity, subset, and focus connect all three activities. A
temporary preview does not change scope. A committed pivot does; returning
restores the previous context. If a scope change excludes the focused item,
make that situation explicit rather than silently substituting another item.

Obsidian or the adapter's store owns editing, tags, notes, and sync. Wunderkammer
owns capture and viewing. Spatial arrangements and navigation context belong
to view state, never to clip frontmatter. Re-clipping must preserve existing
research and previously captured media.

## Current implementation versus intended features

| Area | Available in local code | Still required or unresolved |
|---|---|---|
| Search + facets | Shared text filtering, facet-local value search, contextual counts and granular recovery; cluster replacement/union and URL-backed Back in both views | Hierarchies/ranges, broader relationship pivots and retained corpus revisions |
| Survey | Pan/zoom, spatial field, facet-derived piles with expand/collapse, saved pile state | Layer meaning and manipulation; hand-made pile gestures; scale validation |
| Review | Flat justified layout, facet grouping, within-group sorting and attribute brushing/lenses | Additional layout choices and richer review traversal |
| Dive | Detail panel with images, notes, metadata, source and editor links | Related-item pivots, traversal in review order, return-context restoration |

## Acceptance journeys for future implementation

1. Search and facet a collection; switch Survey → Review → Dive without
   changing the subset. Show the same membership and matching count.
2. Expose a buried survey item with pointer and keyboard; open it; return to
   its prior position. Occlusion must not make it unreachable.
3. Review a subset using another grid and sort. Membership stays unchanged;
   returning to Survey restores its arrangement.
4. Dive into an item, pivot via a named relation to a new subset, review it,
   then go back. Restore the original query, facets, order, focus, and position.
5. Repeat with zero, one, few, and many matches, missing media, and a temporarily
   missing clip. No filter or layout operation deletes research or saved piles.

These are acceptance requirements, not claims that these journeys pass today.

## Tour: the camera shows the collection

⟳ (or `t`) flies the camera through the current layout: from Fit into each
group at a readable scale, a sweep across it, back to Fit, and on to the next,
looping. Any input takes control back at once, and a new layout ends it. It
moves only the camera.

## Stacks say what is in them

A collapsed stack in the spatial view wears a contact sheet: four or nine
members sampled evenly through its order, in cells over the cover footprint,
each with its own proportions. A pile that is mostly one thing shows that; a
mixed pile shows the mix. Labels carry the true count even when a member
stands in another pile, since a clip in several groups can occupy one place;
opening a stack shows every member, shared ones included.

## Review at depth: the row title

When zooming in crops a group's heading off the top of the stage, a pinned
row title names the group under the viewport with its count and position,
drifts with the pan (parallax) and is pushed off by the next group's edge.
Click, Shift-click, `]` and `[` ease the camera to the neighbouring group at
the same scale: a way to scroll a collection group by group without leaving
Review. Intended next step: reach this from the very top, so a Dive into a
group from the overview lands here.

## Contextual exploration

Zooming out below Fit reveals the [whole corpus on a background plane](CONTEXT_CLUSTERS.md),
framed around the filtered foreground: lifted items stay marked in place, the
rest dims, and a click Dives into any of them without changing scope. A search
makes the place it was typed from the context and its results the focus, with
matches lit where they were. Fit
dismisses it. The foreground count, layout and Fit bounds never change. Cluster
suggestions (click swaps the working scope; Shift-click or Add unions the exact
previewed members) keep their mechanics but currently have no placement in the
UI; the detail pane footer is the candidate. Item-specific Dive relations and
persistent navigation history remain open.

## Recreate a view by copying its URL

Every settled deliberate view configuration should be recreatable from its URL,
including filtering/union scope, arrangement, camera, focused item and detail
sizing. A fresh tab must not depend on another tab or mutable saved preferences.
See [the permalink contract](PERMALINKS.md) for corpus identity,
inline/immutable snapshot storage, restoration and compatibility requirements.


The flat-canvas [attribute exploration demo](ATTRIBUTE_EXPLORATION.md) now
separates value brushing, heading distribution preview, pinned lenses and
explicit within-group sorting. Transient preview does not move or filter items;
sort and pin restore through permalinks. Spatial brushing remains future work.

## Breadth and release boundary

The next support promise should name devices, inputs, corpus types and scale.
[RELEASE_PLAN.md](RELEASE_PLAN.md) proposes a local preview and separates
installation, safety, recovery, artifact and publishing gates.
[PHILOSOPHY.md](PHILOSOPHY.md) keeps unresolved product choices explicit: layer
meaning, stable placement versus packing, no-hover exploration, inference
correction, related-item traversal and portable views. None is completed merely
because a demo looks convincing.
