# Album aisle and targeted views

The main wall now has an artwork aisle alongside the flat wall and existing
spatial piles. It uses the current scope, grouping, sort, attribute brush and
item detail pane. This is a local integration; it has not been published.

## Open a targeted view

Readable parameters describe a live view of the receiving instance's current
corpus. For example:

```text
/?view=aisle&group=decade&highlight.genre=Jazz&rail=0
/?view=aisle&group=decade&facet.genre=Jazz&sort=year&direction=asc
/?view=aisle&q=Coltrane&travel=0.4&spread=0.65
```

Highlight keeps the other items in place; a facet changes membership. Repeated
`facet.KEY` values retain the canonical OR-within/AND-across semantics. Supported
parameters are `view=flat|3d|aisle|float`, `arrange=oklab|oklch|hsl|az` (floating space), `q`, `group`, `sort`, `direction=asc|desc`,
`lens`, one `highlight.KEY`, repeated `facet.KEY`, `travel`, `spread`, `focus`
(stable item URL), and `rail=0|1`. Travel and spread range from zero to one.

The ↗ button copies a readable live link. The existing ⎘ button copies the
versioned exact view with corpus identity/revision, scope, focus and camera.
An existing `#s`/`#ref` view takes precedence over query intent, even when invalid;
intent must never silently replace a failed saved view. On successful restoration,
consumed intent parameters are removed as the canonical hash is written. Live
links cannot represent union branches and report that limitation rather than
widening them. Use an exact link for unions.

## Interaction and state

- Grouping builds opposing cover racks from canonical `groupBy`; every group
  occurrence is represented. Multi-valued albums can appear more than once,
  but share one stable identity and one artwork allocation.
- Sorting changes order inside each rack. Attribute previews and pinned values
  recolor existing instances without changing scope or camera. The value menu
  sits beside the overlay legend so pinning cannot resize the stage. It
  uses the same `valuesOf`/`matchesFacet` semantics as filtering, including months.
- Drag/orbit, walk slider, wheel and keyboard navigation move through the aisle.
  Vertical scroll is a zoom; sideways scroll is a walk (see below).
  `[` and `]` step through every item in aisle order, walking to its rack, and
  Enter opens it, so no item needs precise camera control. While the scene has
  keyboard focus a live readout names the item and its place; a pointer visitor
  never sees it. Cover picks open the existing detail pane.
- Each presentation retains its camera. Scope/group/sort changes mark hidden
  presentations dirty. A hidden restored aisle pose remains pending until the
  corresponding scope has been installed. Aisle interactions never save mutable
  pile state or edit source material.
- When graphics fail, the status offers the flat wall, which holds every item. Reduced motion
  does not trigger automatic travel. Phone controls wrap within the viewport.

## Sideways scroll

A sideways wheel or trackpad scroll (or Shift+wheel on a mouse) is a walk
along the aisle. The comparison page's album walls behave the same way, from
the same module, `wall/aisle-wheel.mjs`.

- **It is the slider's walk.** Travel changes as the Walk aisle slider changes
  it, so it is kept in the saved view, in fresh links and across Back/Forward.
  Like the slider, a walk replaces the current history entry rather than
  adding one.
- **The camera keeps its angle.** A fitted view takes the entry pose at the new
  travel. A view that has been turned or zoomed slides along the aisle with its
  target, so a wall seen at an angle stays at that angle as it passes.
- **Direction and speed.** Scrolling right (deltaX > 0) walks deeper, the
  direction the slider increases. 64 px of deltaX walks about one cover column
  (1 world unit; a column is 1.04). Line- and page-mode wheels are scaled as
  OrbitControls scales its zoom (×16, ×100).
- **One axis per gesture.** A gesture is held to the axis it starts on until the
  wheel rests for 200 ms: a vertical swipe that jitters sideways is never a
  walk, and a sideways swipe that jitters vertically is never a zoom. Pinch
  (ctrl+wheel) stays a zoom.
- **The ends.** At the entrance or the last bay a sideways swipe is still
  consumed and does nothing, so it never becomes the browser's Back or Forward
  swipe.

The listener is registered in the capture phase on the canvas, ahead of
OrbitControls, which reads only a wheel's deltaY.

## Source map and limits

`wall/aisle-view.mjs` adapts the shared `wall/album-walls.mjs` artwork renderer to
the main controller. `wall/aisle.css` styles its labels and inspection controls.
`wall/view-intent.mjs` parses/serializes readable intent; `wall/view-schema.mjs`
validates both existing views and optional aisle/highlight fields. Permalink
history remains the only durable view route.

`scripts/build-demo.mjs` includes these main-wall modules while excluding
`compare.html`, `comparison.css` and `comparison-*`. The one exception is
`comparison-copy.mjs`, which supplies `album-walls.mjs`'s neutral wall labels;
`tests/demo-bundle.test.mjs` builds the demo and checks that every import its
page can reach resolves. The experimental comparison route remains
available on local instances; its statistics and recipe machinery are not
required by the main aisle. This does not yet supply a Cartographer adapter.

Artwork uses 128px atlas slots and memory grows with distinct identities; the
1,793-album proof allocated 128 MiB of atlas textures. No arbitrary-size paging
or higher-resolution near-cover promotion is claimed. The detail pane supplies
the inspection path. This verifies implementation, not a human reasoning benefit.

## Verification

`tests/aisle-integration.test.mjs` covers scope/lens agreement, exact picks,
missing-art inspection, sorting, exact restoration, hidden view history,
canonical month values, phone recovery and existing 3D camera continuity.
`tests/view-intent.test.mjs` and `tests/permalinks.test.mjs` cover URL precedence,
validation and fresh-context restoration. `tests/aisle-side-scroll.test.mjs`
covers sideways scroll in both hallways: travel follows deltaX and reaches the
URL and Back, vertical scroll only zooms, a turned or zoomed view slides at its
angle, and each gesture keeps one axis. `MUTATION_FILTER='side scroll' node
scripts/check-mutations.mjs` removes each of those protections in turn and
shows the tests failing.

For rendered proof against an explicitly verified instance:

```sh
WUNDERKAMMER_URL='http://127.0.0.1:4196/?view=aisle&group=decade&rail=0' node scripts/check-aisle.mjs
```

The proof checks artwork completion, exact picking, keyboard inspection,
scope-preserving highlights, fresh exact links, live links, phone containment,
absence of pile writes, and absence of comparison-workbench module requests.
Private data and captures remain in ignored `.local/aisle-integration/`.
