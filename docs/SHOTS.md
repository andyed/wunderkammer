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
| **Caption** | The page's own counts, a legend for the lit set, and an optional title marked as the model's. | Planned |
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
| `render` | ms waited, undrawn tiles, any link notice, Wunderkammer version and commit, browser version, time |
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
- A pinned lens shows its legend, including the words "Esc to clear".
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
- On the fixture, a framed floating-space shot rebuilt from its exact link is
  byte-identical.
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
3. **The figure layer.** This is a DOM overlay drawn only under `chrome=none`:
   - a caption from the page's counts ("89 of 297 frames · kaleidoscopic");
   - a legend for the lit set, replacing the lens legend and its "Esc to
     clear";
   - group names on wall shots at overview zoom;
   - an optional `title=`, marked as the model's (an open decision, below).

   Measure contrast on the rendered pixels: sample the screenshot behind each
   text box, record it in the sidecar, and refuse a shot under 8:1.
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

## Open questions

- **Single-item shots.** Frame one item no closer than the near atlas can fill
  sharply, or let a single-item shot open the detail pane, which shows the
  full image?
- **Model-written titles.** Allowed on a shot when marked as the model's, or
  never?
- **The flat wall in perspective.** Tilt the wall plane as a perspective wall
  (Mackinlay, Robertson and Card, 1991) for shots, or keep perspective to the
  3D views? This is new rendering; muriel's `render_assets/perspective-wall`
  is the reference.
- **WebP.** An encoder dependency, or leave conversion to the caller?
  Playwright writes PNG and JPEG.
- **Caption placement.** Where the caption sits when it would cover an axis
  label or the lit items, and whether a shot may reserve a band for it.

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
