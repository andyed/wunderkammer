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
| **Brushing** | In the floating space, the scope (`q`, `facet.*`) lights its items and dims the rest in place. On the wall, a pinned lens value highlights its items. Brushing by identity, `items=` or `observation=`, is planned. | Partly built |
| **Frame** | What the camera fits. Today that is the view's own Fit: the whole collection. Framing on the evidence, `frame=evidence`, is planned. | Partly built |
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
- On the wall, a highlight tints its items, but the rest do not recede far
  enough to read as context at a glance.
- There is no caption, no framing on evidence, and no camera choice beyond the
  view's own Fit.
- The output is PNG or JPEG; there is no WebP.

## Build order for the rest of shots

This is the recommended order. Each step ships with tests in
`tests/still.test.mjs` and a mutation case per protection, as phase 1 did.

1. **Brushing by identity.** `items=<key,key>` lights exactly the named items,
   and `observation=<id>` with `observations=<url>` lights an observation's
   cited items. Both go through the observations contract
   (`wall/observations.mjs`). `dim=<0..1>` sets how far the rest recede.
   - Recommendation: make the lit set part of the ViewSpec, as an optional
     field validated in `wall/view-schema.mjs`, so the sidecar's exact link
     reproduces it. The version stays 1, because links without it mean what
     they always did.
   - The floating space can dim with `FLOAT_DIM` and its shader patch. The
     wall needs a real recede for the unlit items, not only the lens tint.
   - The sidecar gains `lit`: the keys lit, and the source (`items`,
     `observation`, `facet`, `highlight`).
2. **Frame on the evidence.** `frame=evidence` fits the camera to the lit
   items, with the rest dimmed but in view.
   - Floating space: generalise `fitView()` to a subset of the items. Today
     Fit frames everything and fly-to frames one item.
   - Wall: zoom to the bounding box of the lit tiles.
   - Make it a shot parameter applied after the link is restored. The
     resulting camera then lands in the exact link as an unfitted camera, so
     the link reproduces the frame without a new schema field.
   - Refuse an empty lit set. Give a single item fly-to's framing.
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

- **Where the lit set lives.** A ViewSpec field (recommended: the exact link
  reproduces the shot), or a shot-only parameter recorded in the sidecar?
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
