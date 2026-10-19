# Shots

**The goal.** An agent that writes a collection document should be able to
produce a still image of a view, for a slide, a post or a document, that
informs a reader at a glance. Andy's direction:

- 2026-10-19: "for LLM communication, in some cases, the most compelling
  visual is a cut to the punchline still."
- Later that day: "focus on shots, leave interactive for future. build it out,
  go big."

Small interactive pieces (3D carousels and embeds) are deferred, not dropped.
[Deferred: small interactive pieces](#deferred-small-interactive-pieces) keeps
their design.

## The shot model

A shot is a view link plus what an image needs. Brushing decides what is lit.

| Part | What decides it | Status |
|---|---|---|
| **View** | The keys an agent already writes for a live link: `view`, `arrange`, `across`, `up`, `depth`, `q`, `facet.<key>`, `group`, `lens`, `highlight.<key>`, `focus`. | Built |
| **Brushing** | `lit=<key>`, repeated, lights exactly the named items, and the rest of the scope recedes in place. In the floating space the scope (`q`, `facet.*`) also lights its items; on the wall a pinned lens value highlights its items. `observation=` and `dim=` are planned. | Mostly built |
| **Frame** | What the camera fits: the view's own Fit (the whole collection), or `frame=evidence` (the lit items, a narrowed scope, or a pinned lens value). It is built for the wall and the floating space. | Mostly built |
| **Camera** | The direction Fit looks from. Today each arrangement has a fixed direction. Named angles are planned. | Partly built |
| **Caption** | The figure: a band under the stage with a headline, the page's own counts, a legend with counts, and a note on the view. On the wall, group names sit over their blocks. Words can be overridden (`title=`, `label.*=`) but numbers cannot, and the sidecar says whose words are whose. | Built |
| **Image** | Size, scale and format: `--size`, `--scale`, PNG or JPEG. | Built |

**Principles.**
- **The punchline first.** The shot that answers the question is framed on the
  evidence of one claim, with the rest of the collection dimmed around it as
  context. A tour of the whole collection is rarely that shot.
- **The page's figures, not the model's prose.** Counts and captions come
  from what the page computes, as observations already do on the comparison
  page. Words the model writes are a separate title, marked as such.
- **A shot can be checked.** Its sidecar lists the items in scope and lit, the
  exact link, the camera, and the versions that drew it. A reader can reopen
  the view and count.
- **A shot can be reproduced.** The sidecar's exact link renders the same
  pixels. Anything that changes the picture (what is lit, the frame, the
  camera) has to reach that link.
- **Wunderkammer owns the renderer, and muriel wraps it.** The views live
  here, so the shot contract and the command do too. muriel calls them, as
  `muriel.collection` already wraps the collection format, and its jury audits
  the images.

## Built and verified (phase 1)

Commit eac15c9 on `feat/stills`, cut from main 6f63fa0. It is not merged or
pushed. `npm test` passed 452 of 452 on that commit.

### `?chrome=none`

The page shows the stage alone. The header, filter rail, scope bar, toolbars,
help lines, link notice and lens value menu are hidden. Axis, shelf and group
labels stay, because they belong to the figure. It is a page parameter, not
view state, so it never enters a permalink.

### `window.wunderkammer.whenStill(options)`

"View ready" (`body[data-view-ready]`, `wunderkammer:view-ready`) means the
link is restored. It does not mean every image has landed. `whenStill()`
resolves once the picture is final:

- **On the flat wall:**
  - the camera is not moving;
  - no tile is travelling to a new layout;
  - the image queue and the overview are idle;
  - every tile in view shows its own image or the overview's pixels.
- **In the floating space:**
  - every cover is in the atlas;
  - nothing travels and the camera is not flying;
  - no frame is waiting to be drawn.

Fonts must be loaded in both. The condition must hold for three frames in a
row.

| Option | Default | Meaning |
|---|---|---|
| `timeout` | 30000 | Milliseconds before it rejects, naming what is still pending. |
| `quietFrames` | 3 | Frames in a row with nothing pending. |
| `allowUndrawn` | false | Settle on the flat wall without every tile in view drawn. |

It resolves to `{ mode, waitedMs, undrawn }`, where `undrawn` is the number of
flat-wall tiles in view still showing only their tint. It is 0 unless
`allowUndrawn` is set. It rejects at once for a view it cannot judge yet (the
stacks and the hallway) and when 3D graphics are unavailable.

The image queues alone were not enough. Right after a layout, a tile in view
may not have been asked for yet. On the 16-item test fixture at 800×500 and
scale 2, a whenStill that read only the queues settled 17 ms after "view
ready" with three covers missing. The rule now reads the tiles' pixels.

### `scripts/still.mjs`

```bash
node scripts/still.mjs --collection cats/collection.json \
  --view 'view=float&arrange=axes&facet.coat=ginger' --size 1600x900 --scale 2 --out ginger.png
```

- **Serving.** It serves the checkout and the collection's folder on a local
  port, so relative covers and sprite sheets resolve as they would on a static
  host. A remote collection URL is passed through and needs CORS, as on any
  host.
- **Shooting.** It opens the view with `chrome=none`, waits for `whenStill()`,
  and screenshots the page. The output is PNG or JPEG.
- **`--view`** takes link keys, or an exact link's fragment (`'#v=1&s=…'`) to
  reproduce a still from its sidecar.
- **It fails, writing nothing,** when:
  - the collection is refused, quoting the wall's reason;
  - the link is refused, quoting the wall's notice;
  - the page throws;
  - the view never settles;
  - flat-wall tiles are left undrawn, unless `--allow-undrawn` is given.

**The sidecar** sits beside the image as `<name>.json`. Its format is
`wunderkammer.still`, version 1:

| Field | Holds |
|---|---|
| `image` | file, type, width and height in CSS pixels, scale |
| `collection` | the source given and the corpus id and revision |
| `view` | the keys requested, the mode, the exact link and its decoded ViewSpec (camera included) |
| `render` | ms waited, undrawn tiles, the floating space's atlas (`{ items, resident, failed, loading }`), any link notice, Wunderkammer version and commit, browser version, time |
| `export` | `window.wunderkammer.export()`: scope, highlight with its item keys, focus, count, total, and every in-scope item by key and title |

### Measured

- **Determinism.**
  - A floating-space Axes still of the demo collection (297 frames) at
    1600×900 is byte-identical across runs, and when rebuilt from its exact
    link.
  - Two flat-wall stills differ by about one pixel (ImageMagick AE 1.1 of
    1,440,000). The test suite therefore checks bytes only for the floating
    space.
- **Brushing through existing keys.**
  - `view=float&arrange=axes&facet.kaleido=kaleido` lights 89 of 297 frames
    and dims the rest in place.
  - `lens=color&highlight.color=green` pins 158 green frames on the wall. The
    sidecar's `export.highlight` lists them by key.
- **Tests.**
  - `tests/still.test.mjs` covers:
    - the floating space;
    - both ways the wall can settle early (a cover arriving late, and a tile
      not yet asked for);
    - the refusals;
    - the sidecar.
  - Four mutation cases (`MUTATION_FILTER=still:`) each remove one protection,
    and each is detected. The race case was detected in three runs out of
    three.

### Limits of phase 1

- Shots cover the flat wall and the floating space only.
- At overview zoom the wall shows no group names. The pinned row title is a
  control and is hidden.
- A pinned lens shows its legend, including the words "Esc to clear". Phase
  2b hides it under the figure band, whose legend replaces it.
- On the wall, a lens highlight tints its items, but the rest do not recede
  far enough to read as context at a glance. A lit set (phase 2a) does
  recede.
- There is no caption and no camera choice beyond the view's own Fit. Phase
  2a added framing on the evidence.
- The output is PNG or JPEG; there is no WebP.

## Brushing by identity and framing on the evidence (phase 2a)

**`lit=<key>`** names one item to light, repeated once per item. A key is
the item's identity (its URL, else `id:<id>`) and may hold a comma, so the key
repeats rather than splitting a list.
- **Storage.** The set becomes `ui.lit` in the ViewSpec: optional, at most
  10,000 keys, no duplicates, validated in `wall/view-schema.mjs`. Links
  without it mean what they always did, so the version stays 1. A live link
  holds at most 1,000 keys in all, so a larger set travels in an exact link.
- **The floating space.** Unlit items dim in place, as items outside the
  scope do: a quarter of their brightness, mostly desaturated. Nothing moves,
  and the scope note adds "· N lit".
- **The wall.** Unlit tiles drop to a fifth of their opacity, at a quarter of
  their saturation, and lose their captions, since dimmed text would fall
  under the 8:1 floor. The overview canvas stands aside while a set is lit, as
  it does for a lens, because its pixels ignore a tile's own dimming. The
  count adds "· N lit".
- **Clearing.** Esc puts the set out, after closing a detail pane.
- **Reading it back.** `window.wunderkammer.export().lit` gives `{ count,
  keys, unresolved }`: the lit items in scope, by key, and the keys that name
  no item. The shot sidecar carries it under `export`.

**`frame=evidence`** points the camera at the evidence. The evidence is the
lit items; failing those, in the floating space, a narrowed scope; failing
that, a pinned lens value.
- **The floating space.** Fit runs over just those items, from the
  arrangement's own direction. The axis labels are not framed, so their titles
  may fall outside the shot. A single item gets fly-to's framing, 0.38 of the
  stage height.
- **The wall.** The camera zooms to the bounding box of those tiles.
- **Once, at restore.** The framing is applied once when the link is
  restored, and the exact link keeps the camera it made (`fitted: false`),
  not the request. A link with nothing to frame is refused with the reason.
- **No pane over the shot.** Under `chrome=none` the wall no longer opens its
  zoom preview: framed close, the live wall previews the centred item in the
  detail pane, and that pane would cover the shot.

**Measured.**
- On the demo collection:
  - 46 lit frames (kaleidoscopic and green, a set no single facet gives) in
    Axes and on the wall;
  - the April 2026 scope (35 frames) framed in its corner of the space;
  - one lit frame framed alone.
- On the fixture, a framed floating-space shot rebuilt from its exact link has
  the same camera and, in all but 2 of about 120 runs under heavy load, the
  same bytes. See [open defects](#open-defects).
- **Tests.**
  - `tests/still.test.mjs` adds four tests:
    - lit and framing in the floating space;
    - the wall's recede, framing and Esc;
    - no pane over a framed wall shot;
    - the command reproducing a framed shot from its exact link.
  - It also adds a refusal of a link with nothing to frame.
  - `tests/view-intent.test.mjs` adds one test: `lit=` parsing, both size
    limits, and round trips through exact and live links.
- Six mutation cases (`MUTATION_FILTER=still:`) each remove one protection,
  and each is detected. With phase 1's four, all ten still cases are detected.

**Limits.**
- A single item framed this close shows the near atlas's 256 px tile, which is
  soft at 1600 px.
- That the overview stands aside is seen on the demo, not proven by a test:
  the 16-item fixture's tiles are large enough that the overview never paints
  them.
- `observation=`, `dim=` and framing in the stacks and the hallway are not
  built.

## The figure layer and overriding its words (phase 2b)

Under `chrome=none` a shot gets a figure (`wall/figure.mjs`), drawn by
`whenStill()` once the picture is final. `figure=none` leaves it out.
- **The caption band** sits below the stage. The stage ends above it from the
  first layout, so every Fit and framing already sees the shorter stage, and
  nothing in the band covers the picture. It holds:
  - **the headline:** the page's count line, for example "3 of 16 items lit",
    "35 of 297 items · capture month: 2026-04" or "158 of 297 items · color
    family: green";
  - **the legend:** a swatch and a count each for what is lit and what
    recedes (in scope and outside it, or a lens value and the other values);
  - **a note** naming the collection and what the view does, such as "Psychodeli
    Atlas · Axes: across capture date · up lightness (OKLab L) · depth hue
    (OKLCH) from 220°".
- **Group names on the wall** sit over their blocks in place of the native
  headings, at any zoom, with their counts.
- **Overrides** change the words, never the numbers. They are page parameters,
  or `--title` and `--label` on the command:

  | Parameter | `--title` / `--label` | Changes |
  |---|---|---|
  | `title=` | `--title 'Ginger cats of the 1970s'` | the headline |
  | `label.lit=` | `--label lit='Ginger cats'` | the legend's lit entry |
  | `label.rest=` | `--label rest='Every other cat'` | the legend's other entry |
  | `label.group.<name>=` | `--label group.1970s='The seventies'` | a group's name on the wall |
  | `label.across=`, `label.up=`, `label.depth=` | `--label across='When'` | an axis title in the floating space |

  - Under an overridden headline the page's count line stays on the shot.
  - A renamed legend entry or group keeps its computed count.
  - The figure records every text's source (`page` or `override`), and the
    sidecar carries it under `figure`.
  - An unknown, repeated, empty or over-long (200 characters) key fails the
    shot and names the keys it takes.
  - An override is untrusted text like any item title, and reaches the DOM as
    plain text.
- **Nothing is clipped silently.** The note on the view may shorten to fit: it
  drops the collection title first, then the axis titles' detail, then
  everything but the arrangement's name. The sidecar keeps the full note as
  `noteFull`. Any other text that does not fit (the headline, the count line,
  a legend entry, a group name) fails the shot with the text named.
- **Contrast measured on the shot.** After the picture is final, the command
  screenshots it. For every readable text box (the figure, the floating
  space's axis labels, tile captions) it reads the colour that fills most of
  the box from those pixels, and measures the text's computed colour against
  it, faded by any opacity on the way.
  - The ratios go into the sidecar as `contrast: { floor: 8, min, below,
    items }`.
  - A shot with any text under 8:1 fails, naming the texts, unless
    `--allow-low-contrast` records it instead.
  - On the demo collection every text box measured at least 12.19:1.

**Measured.**
- **Tests.** `tests/still.test.mjs` adds five tests:
  - what the band says, and the stage ending above it;
  - overrides changing words and not numbers, and the bad keys refused;
  - group names on the wall, renamed, and `figure=none`;
  - the contrast measurement itself, on synthetic pixels, including a text
    whose own CSS ground is transparent over a light parent;
  - the command's sidecar, the shortened note, and the refusals of an
    over-long title and an unknown label.
- **Mutation cases.** Four cases each remove one protection, and each is
  detected: the count line under an overridden headline, the reserved band,
  the clip check, and the contrast floor.

## The cloud (phase 2c)

Andy, 2026-10-19: "a sexy viz might be a cloud of image screenshot with some
prioritization for whos in front."

`arrange=cloud` is an arrangement of the floating space made for shots. Use
it by link; it is not in the Arrange by menu.
- **Order.** Items spiral out from the centre in priority order, each a
  golden angle on from the last, so the front of the order holds the middle.
- **Depth and size.** Rank also sets depth and size. The first items stand
  closest to the camera and largest, at up to 1.9 times a tile's edge, and the
  cloud thins and recedes behind them to 0.7 times.
- **Priority.** The lit items come first, then the rest of the scope, then
  everything outside it. Within each tier, collection order holds.
- **Re-forming.** The cloud re-forms when the lit set or the scope changes. It
  is the one arrangement whose positions do: in the others, scope only dims.
- **Its one claim is the order.** No position encodes a value, so the
  figure's note says what decided the order, for example "Cloud: the lit items
  in front, the rest behind".
- **Shared with the floating space.** Fit looks at it square on. Dimming,
  framing, fly-to, permalinks and the figure work as everywhere else in the
  floating space.

**Measured.**
- On the demo collection, 46 lit frames and the April 2026 scope (35 frames)
  each stand front and centre.
- `tests/still.test.mjs` adds one test, covering both of these:
  - Lit items stand in front, nearest the middle and largest on screen, and
    the note says why.
  - Without a lit set the scope stands in front, and a new scope re-forms the
    cloud.
- Two mutation cases each remove one protection, and each is detected: the
  priority, and the re-forming on a scope change.

**Ordering the cloud: `front=<dimension>`.**
- **What it takes.** `front=` names any dimension Axes can carry: `captured`,
  `year`, a ranked or numeric facet, `lightness`, `chroma` or `hue`. It orders
  the cloud highest first: `front=captured` puts the latest capture first, and
  `front=chroma` the most saturated. A leading `-` reverses it, so
  `front=-captured` puts the earliest first.
- **With the tiers.** It orders the items within each tier (lit, the rest of
  the scope, outside it). Items with no value, such as no date or a grey's
  hue, go last in their tier.
- **The values.** They are the items' places along that dimension's axis, as
  Axes would place them, so dates, numbers, ranks and colour coordinates all
  compare.
- **Links.** It implies `arrange=cloud` and is refused with any other
  arrangement. It is stored as `float.front` in the ViewSpec, so exact links
  reproduce the order. A dimension the collection cannot carry is refused
  with the reason.
- **The note.** The figure's note names the order: "Cloud: the lit items in
  front, the rest behind; each by capture date, latest first".
- **Tests.**
  - `tests/still.test.mjs` adds one test, covering:
    - latest first and earliest first;
    - the order within the lit tier and the rest;
    - the exact link;
    - the note;
    - an unknown dimension refused.
  - `tests/view-intent.test.mjs` adds one test for the link: implying
    `arrange=cloud`, round trips, and the refusals.
- **Mutation cases.** Two cases each remove one protection, and each is
  detected: the order, and its place in the exact link.

**Next for the cloud.**
- A gentler fall-off, or a ring, for small lit sets.

## Build order for the rest of shots

This is the recommended order. Each step ships with tests in
`tests/still.test.mjs` and a mutation case per protection, as phase 1 did.

1. **Brushing by identity: the rest.** `lit=` is built (phase 2a).
   - **`observation=<id>` with `observations=<url>`** lights an observation's
     cited items, through the observations contract
     (`wall/observations.mjs`), and stores them as `ui.lit`.
   - **`dim=<0..1>`** sets how far the rest recede.
   - The sidecar's `lit` gains its source: `lit`, `observation`, `facet` or
     `highlight`.
2. **Frame on the evidence: the rest.** It is built for the wall and the
   floating space (phase 2a). The stacks and the hallway come with step 5.
   Single-item shots need a decision (below).
3. **The figure layer.** Built (phase 2b). Still to come:
   - legend swatches that show the items' own colours;
   - a shot-level choice of band position (above, below or none) for layouts
     that need the full height.
4. **Camera angles.** `camera=front|three-quarter|top|iso`, plus `yaw` and
   `pitch` in degrees, set the floating space's Fit direction
   (`FIT_DIRECTION`, `AXES_DIRECTION` and `fitDirection()` in
   `wall/float-view.mjs`). Fit stays collection-relative, so any collection is
   framed whole. The stacks and the hallway follow once they have a whenStill.
5. **Stacks and hallway shots.** Their whenStill conditions: atlas residency
   and motion for `SpatialView` and `AisleView`, which already expose their
   fields (`window.__cwSpatial`, `window.__cwAisle`).
6. **Shot lists.** `--shots shots.json` renders many shots in one browser
   session, for a deck. Each shot gets its own image and sidecar, and an index
   lists them with a contact sheet. The page is reused per collection and
   restored through links, so a 20-shot deck does not boot the wall 20 times.
7. **muriel wraps it.**
   - `muriel shot` calls the command.
   - The Squinter and Thumbnail jury seats audit shots at full size, 1/8 and
     16 px.
   - A brand file sets the caption type.
8. **Formats.** WebP through an optional encoder; a transparent background, if
   a deck wants it (open).

## Open defects

- **A dimmed tile near the camera can draw its placeholder.** Twice in about
  120 floating-space shots of the 16-item fixture, rendered under heavy load
  (14 other 3200×1800 shots running at once), two dimmed tiles near the camera
  drew their placeholder instead of their cover. The atlas reported all 16
  covers resident, none failed and none loading.
  - It did not recur in 48 more runs, nor in 30 runs that re-rendered after
    `whenStill()` to look for a stale tile slot.
  - The cause is not found. A whenStill that misses an atlas state is the
    leading suspect, since the near tier swaps slots as the camera comes in.
  - Until it is found, the framed-shot test compares pixels with a 0.2%
    allowance, twice the observed case. The unframed floating-space test still
    demands identical bytes, and has not failed.
  - Each sidecar records the atlas's state (`render.atlas`), so a bad shot can
    be told from a good one.

## Open questions

- **Single-item shots.** Frame one item no closer than the near atlas can fill
  sharply, or let a single-item shot open the detail pane, which shows the
  full image?
- **The flat wall in perspective.** Tilt the wall plane as a perspective wall
  (Mackinlay, Robertson and Card, 1991) for shots, or keep perspective to the
  3D views? This is new rendering; muriel's `render_assets/perspective-wall`
  is the reference.
- **WebP.** An encoder dependency, or leave conversion to the caller?
  Playwright writes PNG and JPEG.
- **Decided 2026-10-19.**
  - **Overrides.** Words on a shot may be overridden by whoever makes it, a
    person or a model. Andy: "users are going to want to be able to override
    labeling". The numbers stay the page's, and the sidecar records whose
    words are whose.
  - **Caption placement.** A band below the stage, reserved before the first
    layout, so it never covers the picture.

## Deferred: small interactive pieces

Not in scope now (Andy, 2026-10-19). The design is kept for when it is.

- **A carousel mode for the embed.** `mount(element, collection, {
  presentation: 'carousel', layout: 'ring' | 'coverflow' | 'axes', items,
  highlight })`:
  - no app header;
  - drag or the arrow keys rotate;
  - a click opens a compact card;
  - targets of at least 44 px and text at 8:1.
- **Ring and coverflow as arrangements in `float-space.mjs`** (pure
  positions), so they get the floating space's fly-to, dimming and permalinks.
- **A poster from the same spec.** Each embed ships its punchline shot,
  shown:
  - before WebGL loads;
  - under reduced motion;
  - as the page's social-preview image.

  The embed then needs whenStill as a message (`wunderkammer:still-ready`),
  not only a function.
- **Autoplay** is the parked Showcase ([TODO.md](../TODO.md)), off under
  reduced motion.
