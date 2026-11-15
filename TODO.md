# TODO

- **Live HTML design workbench (specified; not implemented).** Start with the
  two-application capability spike in [the spec](docs/LIVE_HTML_WORKBENCH.md),
  then local side-by-side previews and revision-bound agent feedback.
  Keep this separate from the spatial HTML-in-Canvas Phase 3 renderer work.

- **Details on zoom: off by default, to revisit.** Switched off by Andy,
  2026-11-14: "the auto-detail view on zoom in isn't working, can we disable
  that and todo revisiting".
  - **What it is.** On the flat wall, zooming in until one cover fills more
    than half the free view opened that item in the detail pane as a preview,
    with no click ([docs/ZOOM_DETAIL.md](docs/ZOOM_DETAIL.md)). On since 0.1.0.
  - **Where it stands.** The code and its tests are kept. `?zoomdetail=on`
    switches it on; without that, a zoom opens nothing and a click opens an
    item as before.
  - **Not yet known.** What went wrong was not recorded or reproduced when it
    was switched off: which wall (an embedded one, such as Session
    Cartographer's image wall, or a full page), and whether the pane opened
    when it was not wanted, opened on the wrong item, covered what was being
    looked at, or failed to open. Find that out first, on the wall where it
    happened, before changing the rule.
  - **To bring it back.** Fix what that turns up, then decide whether it
    returns as the default or as a setting.
  - **Where it lives.** `wall/zoom-detail.mjs` (the rule), the "Details on
    zoom" block and the `ZOOM_DETAIL` switch in `wall/wall.mjs`,
    `tests/zoom-detail.test.mjs`.

- **Showcase: the collection flows through the visible slots (backlog).**
  Parked by Andy, 2026-10-18, when its ▶ button left the header: "nice idea,
  can go in backlog".
  - **The idea.** A presentation mode. On a zoomed-in wall, cards overlay the
    visible tiles and crossfade through the rest of the collection in review
    order, one slot at a time, never repeating an item already on screen. The
    wall beneath is untouched: pan and zoom keep working, a card click opens
    the item, and switching it off removes every card. With Tour (⟳), which
    moves only the camera, it makes a kiosk.
  - **Why it was parked.** It ran only on the flat wall with no item open. In
    3D, the hallway, or with the detail pane open, ▶ became ⏸ and nothing
    moved, which reads as broken.
  - **To bring it back.**
    - Make it work wherever its button shows, or show the button only where it works.
    - Make the start visible: the first crossfade came one interval (1.6 s) after the press.
    - Give it a place that does not cost a header slot on phones.
  - **The last implementation is in commit 226c446.**
    - `wall/wall.mjs`: the `showcase` block and the `p` key.
    - `wall/wall.css`: the `.flow-plane` and `.flow-card` rules.
    - `index.html`: the `#flow-plane` element.
    - `tests/flat-wall.test.mjs`: the test "showcase flows the rest of the collection through the visible slots and leaves the wall untouched".
    - `?flow=<ms>` set the interval.
