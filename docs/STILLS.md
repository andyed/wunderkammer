# Stills and small 3D pieces

**The goal.** An agent that writes a collection document should also be able to
produce two more things from it. The first is a still image of a view, for a
slide, a post or a document. The second is a small interactive piece to embed,
such as a carousel with a 3D layout. Both are for informing a reader, not for
exploring. Andy's direction, 2026-10-19: "for LLM communication, in some cases,
the most compelling visual is a cut to the punchline still."

## Principles

- **A shot is a view link plus what an image needs.** A still is described with
  the keys an agent already writes for a live link (`view`, `arrange`,
  `across`, `up`, `depth`, `q`, `facet.<key>`, `group`, `lens`,
  `highlight.<key>`, `focus`). A shot adds the image size, and in later phases
  a camera, a frame and a caption. The image's sidecar carries the exact link
  back to the live view.
- **The punchline first.** The still that answers the question is usually
  framed on the evidence of one claim, with the rest of the collection dimmed
  around it as context. A tour of the whole collection is rarely that still.
- **The page's figures, not the model's prose.** Counts and captions on a
  still come from what the page computes, as observations already do on the
  comparison page. Words the model writes are a separate title, marked as such.
- **A still can be checked.** Its sidecar lists the items in scope and the
  items lit, the exact link, the camera and the versions that drew it. A
  reader can reopen the view and count.
- **Wunderkammer owns the renderer, and muriel wraps it.** The views live
  here, so the still contract and the command do too. muriel calls them, as
  `muriel.collection` already wraps the collection format, and its jury audits
  the images.

## Phase 1: the still contract (built)

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
ready" with three covers missing.
The rule now reads the tiles' pixels.

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

**Measured on the demo collection (297 frames).**
- A float Axes still at 1600×900 is byte-identical across runs, and when
  rebuilt from its exact link.
- Two flat-wall stills differ by about one pixel (ImageMagick AE 1.1 of
  1,440,000).
- `tests/still.test.mjs` checks the floating space's bytes and both ways the
  wall can settle early. Four mutation cases (`MUTATION_FILTER=still:`) remove
  each protection and are detected.

**Limits of phase 1.**
- Stills cover the flat wall and the floating space only.
- At overview zoom the wall shows no group names. The pinned row title is a
  control and is hidden.
- A pinned lens shows its legend, including the words "Esc to clear".
- There is no caption, no framing on evidence and no camera choice beyond the
  view's own Fit.
- There is no WebP output; Playwright writes PNG and JPEG.

## Phase 2: the punchline still

- **Frame on the evidence (`frame=evidence`).** The camera fits the lit items
  rather than the whole collection, with the rest dimmed but in view:
  - in the floating space, Fit over a subset (today Fit frames everything and
    fly-to frames one item);
  - on the wall, the bounding box of the lit tiles.
- **Brushing by identity.**
  - `items=<key,key>`, or `observation=<id>` with an observations file, lights
    exactly the cited items, using the observations contract the comparison
    page already enforces.
  - `dim=<0..1>` sets how far the rest recede.
- **A figure layer.**
  - A caption with the page's own counts ("19 of 489 cats · ginger · 1970s"),
    and a legend for the lit set.
  - A model-written title, marked as the model's.
  - Group names on wall stills at overview zoom.
  - Contrast measured on the rendered pixels, into the sidecar, against the
    8:1 floor.
- **Stills of the stacks and the hallway,** with their own `whenStill`
  conditions.

## Phase 3: perspective skew

- **Named angles for the 3D views.** `camera=front|three-quarter|top|iso`,
  plus `yaw` and `pitch` in degrees, set the direction Fit looks from. Fit
  stays collection-relative, so an angle frames any collection whole. The
  floating space already fits from a fixed direction per arrangement; this
  exposes it.
- **The flat wall in perspective** (open). The wall plane tilted as a
  perspective wall (Mackinlay, Robertson and Card, 1991), with the near edge
  readable. This is new rendering. muriel's `render_assets/perspective-wall`
  is the reference.

## Phase 4: small interactive pieces

- **A carousel mode for the embed.** `mount(element, collection, {
  presentation: 'carousel', layout: 'ring' | 'coverflow' | 'axes', items,
  highlight })`:
  - no app header;
  - drag or the arrow keys rotate;
  - a click opens a compact card;
  - targets of at least 44 px and text at 8:1.
- **Ring and coverflow become arrangements in `float-space.mjs`** (pure
  positions), so they get the floating space's fly-to, dimming and permalinks.
- **A poster from the same spec.** Each embed ships its punchline still,
  shown:
  - before WebGL loads;
  - under reduced motion;
  - as the page's social-preview image.

  The embed then needs `whenStill` as a message (`wunderkammer:still-ready`),
  not only a function.
- **Autoplay** is the parked Showcase ([TODO.md](../TODO.md)), off under
  reduced motion.

## Phase 5: muriel wraps it

- `muriel still` calls `scripts/still.mjs`.
- The Squinter and Thumbnail seats of muriel's jury audit stills at full size,
  1/8 and 16 px.
- A brand file sets the caption type.

## Open decisions

- Tilting the flat wall into a perspective wall: build it, or keep
  perspective to the 3D views?
- Model-written titles on a still: allowed when marked as the model's, or
  never?
- WebP output: an encoder dependency, or leave conversion to the caller?
