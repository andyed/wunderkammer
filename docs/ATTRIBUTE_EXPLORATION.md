# Attribute exploration demo

## Build plan

Keep filter membership, grouping, sort order and attribute preview separate.
Implement one shared attribute model for sort comparisons, ordered color scales,
missing values and multi-value policy. Add a reversible flat-canvas brush using
that model, then integrate sort and pinned-lens controls into the current state
and versioned permalink. Verify against synthetic edge cases and the actual
Music Atlas corpus. Work is local; no source corpus edits or publication.

Two Luna agents own the attribute model/tests and brushing surface. The parent
owns main-state integration, controls, permalink compatibility and browser proof.

## Muriel synthesis

**Mode: Compare.** The question is how to reveal an attribute's distribution
without confusing it with a committed sort. Prior discussion establishes hover
preview, low-to-high scales, retained artwork and unchanged membership.

A full opaque recoloring would make the attribute conspicuous but hide the
covers. Reordering on hover would reveal order but violate stable preview
geometry. The selected design uses a translucent color wash and edge treatment,
with a compact legend, and reserves movement for an explicit Sort action.
The legend is docked in a reserved toolbar readout so it neither covers art nor
changes the stage size on hover. Ordered lenses show readable value badges on
the existing tiles. Their scale uses the representative values actually shown,
so a later tag on a multi-year album does not stretch the legend beyond its
sort value. The year lens explicitly says it uses the earliest tagged year.
Nominal categories receive discrete colors; numeric/date/ordinal attributes
receive a gradient. Unknown values remain neutral. Category colors are cues,
not unique identifiers for the entire vocabulary.

The shared attribute model keeps the sort and legend's interpretation aligned.
The brush joins existing tile nodes, while the sort joins layout input and the
permalink presentation state. A pinned lens is durable UI state; pointer and
keyboard hover are transient. The visual proof must show recognizable artwork,
legible preview/current-sort labels, stable geometry during brushing, and a
fresh-link restoration of actual sort order and pinned lens.

## Interaction contract

- Hover or keyboard-focus a facet value to highlight its matches in the current
  subset. Gently dim other images while retaining captions and layout.
- Hover/focus an attribute heading to see its distribution. Click/activate the
  heading to pin it, or use the Attribute lens select. Escape clears the lens.
- A transient preview takes precedence over the pinned lens; leaving returns
  to the pin. Hover never writes a view state or changes membership.
- Sort within groups changes the item order, with ascending/descending control.
  Original order restores adapter order. Unknown values stay last in either
  direction. Group membership and group order remain unchanged.
- The legend distinguishes the attribute being previewed from the current sort.
  An active sort remains explicitly visible even when previewing another field.
- New sort and pinned-lens fields are optional additions to version-1 links;
  existing links default to original order and no lens. Hover is never captured.
- This prototype targets the flat canvas. Switching to 3D suppresses its overlays
  and disables its controls while retaining the flat configuration for return.

## Try it in Music Atlas

1. Hover **release decade**, then a particular decade chip. Observe distribution
   versus membership without moving the covers.
2. Filter an artist or genre to obtain a readable subset.
3. Set grouping to **no grouping**, sort by **release year (tagged)**, and pin
   the same lens. Reverse the sort and watch the low-to-high progression reverse.
4. Preview **color family** while the year sort remains active. The legend must
   say which is the current sort and which is the preview.
5. Copy the URL and open it in a fresh context. Sort and pin should return;
   transient hovering should not.

Tagged music years can disagree across tracks/releases; the model states its
representative-value policy. This does not turn archive tags into verified
release chronology. Complexity and related structural attributes remain estimates.

## Rendered proof, 2026-09-07

The local [Music Atlas demo](http://127.0.0.1:4175/#v=1&ref=5832554bedd2d60239b2b9d24cc1383386c79c6f563a3578591a48d18fd6ae25)
contains 69 albums matching Classic Rock and the 1970s, ordered by tagged year
and showing a pinned year lens. Hover Color family to compare its distribution;
hover blue to brush the eight matching albums without changing the year sort.
All 69 images decoded successfully. The link refers to an immutable snapshot on
this local instance; the server and its corpus must be available to open it.

`node scripts/check-attributes.mjs` recreates the demo through real controls,
checks unchanged geometry and URL during previews, restores the pin after
hover, reverses the sort and uses Back, and verifies identical geometry in a
fresh context opened from the immutable link. It also checks 700px controls.
It writes screenshots and `proof.json` under `.local/attribute-demo/`.

The inspected screenshots include the year lens, categorical preview, blue
membership brush and narrow layout. The toolbar readout stays outside the
canvas. Readout text measures 16.96:1, muted readout text 11.63:1, and value
badges 15.30:1 against the worst-case white image through the caption scrim.

`npm test` covers model edge cases, pointer/keyboard operation, sorting within
groups, permalink restoration and existing canvas workflows. Run
`MUTATION_FILTER=attribute node scripts/check-mutations.mjs` to prove the checks
reject lost sort state and an accidental pin on hover.
Final verification passed all 63 repository tests and both attribute mutations.
The delivered view was also inspected in the Codex in-app browser.

**Muriel delta:** the chosen preview/pin grammar is integrated into canonical
scope and presentation state. Visual proof changed the legend from a floating
panel to a compact toolbar readout, preserving the space-filling canvas. Two
Luna-agent slices were integrated and verified together; this work and the
pre-existing project changes remain uncommitted.
