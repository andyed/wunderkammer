# Changelog

## Unreleased

- **The image warehouse.** `?view=warehouse` opens the aisle with "Cats.
  Lots of cats." played over it once: rows of the aisle's racks, five lanes
  wide, rush out of a white void while the camera drops into the entrance;
  then the lights go down, the extra rows sink through the floor, and the
  aisle is exactly as `view=aisle` opens it, ready to browse. The caption
  uses the collection's nouns. It plays once (the address becomes the exact
  aisle link), any touch or key ends it, and reduced motion skips it. The
  skill names it for agents, with "matrix guns view".
  - `scripts/warehouse-video.mjs` renders the same frames, seeked one by
    one, to an MP4, with an optional walk down the aisle and a sidecar
    holding the exact link of the last frame.
  - The aisle's scene now carries a fog too far away to show, so the show
    can pull it in without recompiling every material.
  - `MUTATION_FILTER=warehouse` holds seven mutations, each caught.
- **The arrow keys walk an item opened from the context plane.** Left and
  Right step through the plane's items outside the scope, Up and Down move
  through its grid, and the camera brings each one under the pane. The pane's
  ‹ › bar counts the item's place in that walk.
- **A far tile no longer draws its placeholder after its cover loaded.** When
  four or fewer covers landed between atlas uploads, three.js r169's
  `copyTextureToTexture` could write a far tile into the near atlas, or into
  no texture, so the tile showed its placeholder until a later whole-atlas
  upload repaired it (mrdoob/three.js#33153, fixed in r184). `index.html` and
  `wall/compare.html` now load three 0.186.1. The vendored muriel lib is
  unchanged: r170–r186 needed no code changes in it or in the 3D views.
- **Stills.** `node scripts/still.mjs --collection <doc> --view '<link keys>'
  --size 1600x900 --out view.png` takes a still of a view, for a slide, a
  post or a document. It also writes a sidecar JSON with the exact link, the
  camera, the items in scope and lit, and the versions that drew it. It
  refuses, writing nothing, when the collection or the link is refused or
  the view never settles.
  - `?chrome=none` shows the stage alone.
  - `window.wunderkammer.whenStill()` resolves when the picture is final:
    every cover landed, nothing moving, every flat-wall tile in view drawn.
    "View ready" only meant the link was restored.
  - It covers the flat wall and the floating space so far.
  - `lit=<key>`, repeated once per item, lights exactly those items. The rest
    of the scope recedes in place, in the floating space and on the wall, and
    Esc puts the set out. The set is kept in the view (`ui.lit`), so exact and
    live links carry it.
  - `frame=evidence` brings the camera in on the lit items, a narrowed scope
    or a pinned highlight. The exact link keeps the camera it made, and a link
    with nothing to frame is refused.
  - The figure: a band under the stage with the page's counts as the
    headline, a legend with counts and a note on the view, and group names
    on the wall.
    - `--title` and `--label` (`title=`, `label.lit=`, `label.rest=`,
      `label.group.<name>=`, `label.across=`…) override its words, never its
      numbers, and the sidecar records whose words are whose.
    - Text that does not fit fails the shot, except the note on the view,
      which shortens.
  - Every readable text box is measured against the shot's own pixels; under
    8:1 the shot is refused (`--allow-low-contrast` records it instead).
  - `arrange=cloud`: the collection as a cloud with the evidence in front.
    - The lit items, else the scope, spiral out from the middle, closest and
      largest.
    - The rest recede behind, smaller and dimmed.
    - The figure's note says what decided the order.
    - `front=<dimension>` orders it within those tiers: `front=captured`
      latest first, `front=chroma` most saturated first, `front=-captured`
      earliest first. Exact and live links keep the order.
  - [SHOTS.md](docs/SHOTS.md) has the shot model and the build order:
    brushing by identity, framing on the evidence, captions from the page's
    counts, and camera angles. Interactive embeds are deferred.
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
- **Drawable cards draw again in Chrome Canary.** With the experimental
  `CanvasDrawElement` flag on, the near tiles are meant to be drawn from live
  cards, so their titles stay findable. Canary 158 renamed the canvas opt-in
  from `layoutsubtree` to `content="drawable"`, and under the old name no card
  ever drew: the tiles fell back to cover images after about two seconds. The
  card host now sets both, which works on builds from either side of the
  rename. [HTML_IN_CANVAS_RESULTS.md](docs/HTML_IN_CANVAS_RESULTS.md).
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
- **A mark and wordmark.** One wall of the aisle, a rack of tiles each in its
  own hue, dimmed but for one gold tile, beside the lowercase word in Geist. The wall page shows the rack before
  the collection's title, the comparison page's header shows the full
  wordmark, both pages have a favicon, and the README leads with it. Outlined
  SVGs in `wall/brand/`, rebuilt by `scripts/build-brand.py`.
  [BRAND.md](docs/BRAND.md).
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
- **A reused demo build keeps its sprite-sheet pages.** `scripts/build-demo.mjs
  --reuse-corpus` copied the published `media/` but not `sheets/`, the pages
  the covers come from, and still reported success; a sync with `--delete`
  would have removed them from the live demo. It now copies `sheets/` too, and
  the build fails, writing no `collection.json`, when the collection names a
  file on the demo's site (`--site`) that the output lacks, or names none.
  `collectionImages()` in `wall/collection.mjs` lists the files it checks,
  and `scripts/validate-collection.mjs` now reads the same list.
- **A facet value that slides under a still pointer no longer replaces the
  pinned lens.** Typing in a facet's search box re-renders its values, and
  Chrome sends `pointerenter` to whichever one lands under a parked mouse.
  The brush took that as a hover and showed the new value until the pointer
  moved away. Previews from the pointer now start on its first move or press
  inside a value. The facet-view test that checks this read the lens before
  Chrome's hover update and failed about 1 run in 30.

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
