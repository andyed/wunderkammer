# Details on zoom

**Added 2026-10-14.** Peer-study ledger idea 27. Zooming into an item on the flat
wall shows its details without a click; zooming back out hides them.

## Rule

Ported from PivotViewer (`seajax@0293770 v2/app/pivot/PivotViewer.js:1618-1650`,
BSD-2-Clause, © Microsoft Corporation) into `wall/zoom-detail.mjs`:

- The view counts as zoomed in when any visible item is wider than half the
  *free* width (the stage minus the detail pane's width) or taller than half
  the stage.
- The item whose centre is nearest the centre of the free area gets the details.
  The free area is the stage shifted left by half the pane, so the item shown
  is one the pane does not cover.

Wunderkammer adds three things PivotViewer does not have:

| Addition | Why |
|---|---|
| Hysteresis: open above 0.5, close only when every item is below 0.4 | PivotViewer opens and closes at one threshold, so a landing near it flaps |
| Stickiness: the shown item keeps the details while its rectangle still covers the free centre | Two near-equal neighbours cannot trade the pane on a small pan |
| Zoomed fully out (Fit, or the zoom-out floor) never counts as zoomed in | With a handful of items, Fit alone can exceed 0.4 and the pane could never close |

The pane width used is the pane's width whether it is open or not, so opening
it changes neither the threshold nor the centre.

## When it is decided

`wall.mjs` asks the rule once the camera has been still for 120 ms after a zoom
lands (`viewport.settlesAt`); a pinch or edge-zoom drag is decided at its end.
Nothing is decided per frame, so a wheel run that passes the threshold and
comes back does not open the pane.

## Contract

- It drives the **preview** path (`state.preview`), not `openDetail()`. It
  commits no selection, scope, saved view state or permalink focus. Only the
  zoom itself changes the URL, through the camera.
- It never moves the camera. The pane overlays a fixed stage (`.stage` keeps
  `right: 0` with the pane open), and the rule centres on the uncovered part
  instead of panning the item into view.
- With no selection, the pane opens for the preview alone and closes with it.
  With a selection, a zoom onto another item previews it over the selection,
  exactly like a hover dwell; zooming out returns the pane to the selection.
- A click still opens and selects. Clicking the pane commits the preview, as it
  does for a hover preview.
- Escape (or ×) puts a zoom preview away. That item stays dismissed until the
  view zooms out below the close threshold or centres a different item, so the
  next landing does not reopen it. Closing a selection while zoomed in is
  treated the same way.
- Leaving a tile with the pointer does not end a zoom preview.
- Off at 800 px and below, where the pane is a full-window modal reader.

## The 3D view

The spatial view does not get this rule. Approaching items there already
promotes them from the atlas to DOM cards that carry the title, source, date,
tags and the edit link (`spatial-view.mjs`, card promotion), which is the 3D
view's semantic zoom; full detail stays a click. A second, zoom-triggered pane
on top of promotion would show the same fields twice. `applyZoomDetail` returns
early while `state.spatialOn`.

## Tests

`tests/zoom-detail.test.mjs`: the rule as pure geometry, then in Chromium open
on zoom-in, close on zoom-out, hysteresis and a mid-gesture wheel run, no
selection or permalink focus, no camera move when the pane appears, click and
Escape. `npm run test:mutations` has seven `zoom detail` cases that each trip
one of them.
