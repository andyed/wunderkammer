# Changelog

## Unreleased

- **No item dropdown in the 3D views.** The floating space and the aisle each
  carried an Item dropdown ("Choose an item…") and an Inspect button that every
  visitor saw and almost none needed. Both are gone. When 3D graphics fail, the
  status offers a button to the flat wall, which holds every item.
- **Arrow keys move through the floating space along its axes.** → and ← move
  the selection to the next item along the axis that points that way on
  screen, ↑ and ↓ along the next, Page Up and Page Down in depth; each move
  flies to the item without opening it, and Enter opens it. A callout beside
  the item, in the selection ring's green, gives its title and where it sits
  in the arrangement's terms ("L 0.34 · magenta", or the Axes dimensions), and
  a hidden live region says the same to a screen reader. `/` opens a jump box:
  type part of a title, Enter flies to the first match. Shift+arrows orbit, as
  plain arrows did. On the 297-item demo, best-path arrow presses reach an item
  in a median of 9 (the old `[ ]` stepping: 75); 3 isolated items have no arrow
  path in yet and are reached by jump or click.
- **Arrow keys walk the aisle's racks.** A rack walks as a U that matches the
  screen: → goes deeper along the left wall, crosses at the far end and comes
  back along the right; ← runs it backwards. ↑ and ↓ change row, Page Up and
  Page Down change rack. Each move faces the cover's wall from across the
  aisle; a ring marks the cover and a callout gives its title, rack, wall, row
  and column, and the live region says the same. `/` jumps to a title, Enter
  opens, Shift+arrows turn. Every one of the demo's 297 covers is reachable,
  in a median of 11 best-path presses (`[ ]` stepping: 75).
- **The ▶ showcase button is gone.** It acted only on the flat wall with no
  item open: in 3D, the hallway or beside the detail pane it turned to ⏸ and
  nothing moved. The idea, cards crossfading the rest of the collection
  through the visible tiles, is parked in [TODO.md](TODO.md) with what it
  would take to bring back, and the `p` key and `?flow=` interval go with it.
- **3D opens the floating space in Axes.** The 3D button used to open the
  stacks, facet groups as piles whose positions repeat the flat wall's group
  headings. It now opens Axes with the collection's time across, lightness up
  and hue in depth, so the first 3D view shows each item's colour on the
  timeline. The stacks are the last entry in the Arrange by menu, Axes ·
  OKLab · OKLCH · HSL · A–Z · Stacks. They keep that menu in a strip below
  them, and the 3D button and `3` key reopen whichever 3D view was last used.
  The separate ✺ button is gone, which frees a 40 px slot in the phone
  header row. `?view=3d` links and saved piles still open the stacks; a
  `?view=float` link that names no arrangement now opens Axes instead of
  OKLab.
  [SPATIAL.md](docs/SPATIAL.md#the-3d-entry).
- **Sideways scroll is a walk in the 3D hallways.** In the wall page's aisle and on
  the comparison page's walls, a sideways wheel or trackpad scroll moves along
  the aisle, as the Walk aisle slider does, and the travel is kept in the link
  and across Back/Forward. A view turned toward a wall keeps its angle as it
  passes. Vertical scroll is still a zoom, and each gesture keeps the axis it
  starts on. [AISLE.md](docs/AISLE.md#sideways-scroll).
- **The aisle's rack labels use the collection's nouns.** `album-walls.mjs`
  had kept "items" in the label it builds for each rack; it now reads the
  nouns too, and the overlay and item list show that one label, its count
  grouped as on the comparison page ("1,234 albums").
- **A level button row on phones, with every button in view.** On a touch
  phone the header's view, Fit and link buttons are all 40×44 on
  one centre line; only ▥ and ↗ were 44 px tall before. Pinch zooms in every
  view, so − and + are left off the row there, and every button fits a
  375 px screen without the sideways scroll. Desktop keeps − and +.

## 0.2.0 — 2026-10-18

The collection document gains one optional field, `ui.nouns`, and stays
version 1. A 0.1.0 wall refuses a document that sets it.

- **Get it from the release tag.** No package is published to a registry,
  so the contract, the skill and the 0.1.0 notes below now point at the tag
  on GitHub, a static host serving a checkout of it, or the live demo.
  jsDelivr's GitHub route serves a tag's modules, not its pages.
- **An agent skill and a command-line check.** `skills/wunderkammer/SKILL.md`
  tells an agent when to use Wunderkammer, the steps from document to link,
  and the traps; `npx skills add andyed/wunderkammer` installs it.
  `scripts/validate-collection.mjs` checks a collection, and its
  observations, the way the pages will read them: every problem with its
  path, missing local cover files, and the figures each claim will show.
  `tests/skill-example.test.mjs` keeps the skill's examples valid.
- **Floating space** (✺, `?view=float&arrange=oklab|oklch|hsl|az`). The whole
  corpus floats in 3D, placed by each item's dominant colour in OKLab, OKLCH
  or HSL, or shelved A–Z. Search and facets dim items in place. Click flies to
  an item and opens it; the item menu, `[ ]` and Fit reach everything without
  camera skill. Permalinks carry the arrangement and the camera.
  [SPATIAL.md](docs/SPATIAL.md#the-floating-space).
- **Floating space: Axes** (`?view=float&arrange=axes&across=…&up=…&depth=…`).
  Each axis carries a chosen dimension: lightness, chroma or hue of the
  dominant colour, or an attribute (capture date, year, a ranked or
  categorical facet as labelled planes). Missing values wait in labelled
  slots, greys get their own hue slot, and declumping never moves an item off
  its attribute value. [SPATIAL.md](docs/SPATIAL.md#axes-a-chosen-dimension-on-each-axis).
- **3D covers draw at their real brightness.** The vendored muriel tile
  shader drew every GPU tile about 2.2 gamma dark (on the Psychodeli example,
  0.43× the cover's brightness; dark covers went black), and a tile at a
  multiple of the atlas's column count could show part of its neighbour.
  Both are fixed upstream (muriel `99ea62b`) and re-vendored; the floating
  space no longer patches them itself.
- **The static demo's aisle starts again.** `scripts/build-demo.mjs` left
  out every `comparison-*` file, including `comparison-copy.mjs`, which the
  aisle's wall labels come from since the wording change. The demo's
  `?view=aisle` got a 404 on that import and stayed on the flat wall. The
  build now ships that one file and still leaves the comparison workbench
  out; `tests/demo-bundle.test.mjs` builds the demo and follows every import
  its page can reach.
- **Counts use the collection's own nouns.** The wall's count, the aisle's
  rack labels, the floating space's status line and the group labels read
  for assistive technology now say what the collection calls its items
  (`ui.nouns`, "albums" for a music library, otherwise "items"), singular for
  one: "31 of 31 cats", "2000s · 1 cat". The wall's count used to say "clips"
  for every collection. One rule, in `wall/nouns.mjs`, serves these and the
  comparison page.
- **The comparison page's wording follows the collection.** The "Local
  spike" badge is gone. The walls say "Walls", "items" and "groups" unless
  the collection names its items with the new `ui.nouns` field. A music
  library, whose clips are all `kind: "album"`, keeps "Album walls", covers,
  racks and albums. The Starting point menu lists only the music comparisons
  whose attributes the collection has, and is hidden when none apply.

Known issue, unchanged from 0.1.0: the experimental browser test Canary A2
(HTML-in-canvas behind a flag) fails. The other 417 tests pass, and all 130
mutation cases are detected.

## 0.1.0 — 2026-10-18

First public release.

- **Collection document** (`wunderkammer.collection`, version 1). A strict
  validator lists every problem with its path. The wall loads a document
  from `?collection=<url>`, from a `wunderkammer-collection` meta tag, or
  through `mount(element, collection)`, and needs no server.
- **Sprite-sheet covers.** A collection can name a few sheet pages instead of
  one file per image, with each image's own file as the fallback.
  `scripts/collection-sheets.py` packs them.
- **Comparison** (`wall/compare.html`). It compares two to six groups, shows
  counts or shares in an exact matrix, and walks the groups as racks of
  album walls.
- **Observations** (`wunderkammer.observations`). Claims cite matrix cells or
  items, the page computes their figures, and selecting a claim lights its
  evidence. Citations that do not resolve are shown, not dropped.
- **Hand-back.** `window.wunderkammer.export()` returns scope, focus,
  highlight and the exact items on the wall, or the evidence packet on the
  comparison page.
- **Runs from a sub-path.** The wall is `index.html` at the repository
  root, with relative asset paths, so a static host can serve a checkout of
  the tag at any sub-path. Pages need HTML served as `text/html`, which
  jsDelivr does not do; it serves the modules only. `mount()` finds the page
  with no `wallUrl`, and the comparison page links back to it.
- **Local server.** `serve.mjs` serves Obsidian vaults, TiddlyWiki, image
  folders and music libraries, with saved piles and compact links.
- **Public-tree gate.** `scripts/check-public.mjs` checks the tree in CI.

Known issue: one experimental browser test, Canary A2 (HTML-in-canvas behind
a flag), fails. All other tests pass, and all 70 mutation cases are detected.
