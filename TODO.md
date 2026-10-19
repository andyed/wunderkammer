# TODO

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
