# The agent contract

How a language model, or any other producer, shows a person a visual
collection, makes checkable claims about it, and reads back what the person
selected. Four parts:

- a **collection document**, the data;
- a **comparison recipe**, the question;
- **observations**, the claims;
- the **hand-back**, the evidence.

All of them run from static files with no server.

Four parts. Two exist, one is a formalization of what the wall already reads,
and one is new.

## Collection document

The wall boots from a single JSON response. `boot()` in `wall/wall.mjs` reads
`clips`, `facets`, `ui.{title, facetOrder, facetLabels, hiddenFacets}`,
`corpus` and `sheets` from `/api/clips`. That undocumented response was close
to a collection format already, so the format is a name, a version and a
validator for it:

```json
{
  "format": "wunderkammer.collection",
  "version": 1,
  "corpus": { "id": "example:album-covers", "revision": "2026-10-17" },
  "ui": { "title": "Album covers", "defaultGroup": "decade",
          "facetOrder": ["decade", "genre"],
          "facetLabels": { "decade": "release decade" } },
  "facetTypes": { "decade": { "type": "ordinal", "order": ["1970s", "1980s", "1990s"] },
                  "genre": { "type": "categorical" } },
  "images": { "cors": true },
  "clips": [
    { "id": "a1", "title": "Example title",
      "cover": "https://example.org/a1-256.webp",
      "coverVariants": [{ "src": "https://example.org/a1-128.webp", "width": 128 },
                        { "src": "https://example.org/a1-640.webp", "width": 640 }],
      "props": { "decade": "1980s", "genre": ["electronic", "pop"] },
      "sourceUrl": "https://example.org/a1", "note": "Plain text, never HTML." }
  ]
}
```

**Checking a document before sharing it:** `scripts/validate-collection.mjs`
runs the same validator from the command line, reports local cover and sheet
files that do not exist, and, given `--observations`, prints each
observation's computed figures and every citation that does not resolve. Exit
0 means the pages will load the document and every claim resolves; `--json`
gives the full report. `tests/validate-collection.test.mjs` covers it, and
four mutations (`MUTATION_FILTER=validate-collection`) show those tests
failing when a check is removed.

**Validation** (`wall/collection.mjs`, `validateCollection()`): unknown keys
are refused with the list of supported ones, and every problem is reported
with its path in one error, up to 25. Server-only keys (`vault`, `adapters`,
`generated`) are refused by name. `toCollection()` converts a server payload
and reports each field it leaves out, including a server's `sheetSlots`, which
index its private `/media/sheets` pages. `collectionImages()` lists every media
source a document names (covers, variants, media, videos and sheet pages) with
its path; `scripts/validate-collection.mjs` and `scripts/build-demo.mjs` check that
files exist through it.

- **Required:** `format`, `version`, `corpus.id` and `clips` (1 to 50,000).
  50,000 is the validator's limit, not a size the pages handle well: the
  README's size guidance puts the best range under about 2,000 items, the 3D
  stacks and the floating space at most 4,096, and the flat wall to about
  10,000. Each clip needs a non-empty `id`.
- **Identity:** `url`, falling back to `id`, as `clipKey()` defines it.
  Repeated identities are an error. `url` is an http(s) URL or an opaque
  `urn:`.
- **Links:** `sourceUrl` is http(s) only. **Images:** `cover`, `detailCover`,
  `coverVariants[].src` and `media[].src` may be http(s), `data:image/` or
  `blob:`. Relative URLs resolve against the document's URL, as CSS URLs do.
- **Video:** `video` (optional) is one http(s) or `blob:` URL, never `data:`.
  The 3D views (the wall, Stacks, the floating space) and the aisle play it,
  muted and looping, over the clip's cover, which stays the poster and the
  only picture in the flat wall. The detail pane plays it with controls. Give
  the clip a `cover` and `props.dims` of the video's own size: the cover is
  what shows before the first frame and whenever a video is paused for the
  play budget (the nearest 24 in view play), and the dims shape its tile.
- **Attributes** go in `props`: strings, finite numbers, booleans or arrays of
  them. A props key that names a clip field (`title`, `source` …) is refused,
  because `valuesOf()` reads the clip's own field first.
- **`facets`** is derived from the clips. Supplied counts are replaced, with
  a warning when they disagree.
- **`facetTypes`** (categorical, ordinal with `order`, numeric, date) is
  validated and carried. The wall does not use it yet.
- **`ui.nouns`** (optional) names one item and several,
  `{ "item": "frame", "items": "frames" }`, each 1 to 40 characters. Every
  count uses them, singular for one: the wall's count ("128 of 128 frames"),
  the aisle's rack labels ("2025 · 1 frame"), the floating space's status
  line and the comparison page's walls ("Frame walls", "2025 · 206 frames").
  Without them the pages say "item" and "items". A music library, whose clips
  are all `kind: "album"` as the music adapter writes them, says "albums" and
  keeps its cover and rack wording on the comparison page. The rule is in
  `wall/nouns.mjs`.
- **`images.cors`** declares that covers on other origins send CORS headers.
  Without it, the loader warns that such covers stay blank in the 3D views. A
  DOM-tile fallback for them is not built. **`images.sheets`** says what
  sprite-sheet cells are for clips that also name a file (below).
- **`viewState`** (optional) is the document's starting piles and grouping.
- **`sheets`** and per-clip **`sheetSlots`** (optional) ship covers as cells
  of a few sprite-sheet images; see [Sprite sheets](#sprite-sheets).

### Sprite sheets

A collection of a few hundred covers is a few hundred files to host and a few
hundred requests to open. A document can instead ship its covers packed into
a few large images, and point each clip at its cell:

```json
{
  "sheets": [
    { "src": "sheets/9f…e1.webp", "edge": 64,  "width": 2040, "height": 564 },
    { "src": "sheets/b4…72.webp", "edge": 480, "width": 1936, "height": 1918 }
  ],
  "clips": [
    { "id": "a1", "title": "Example title", "sheetSlots": [[0, 2, 2, 64, 36], [1, 2, 2, 480, 270]] }
  ]
}
```

- **`sheets`**: 1 to 4,096 pages, each `{ src, edge, width, height }`. `src`
  follows the image rule above (http(s), `data:image/` or `blob:`, relative
  to the document). `edge` names the page's level: the longest edge a cell
  on it may have, 1 to 4,096 px. `width` and `height` are the page's pixel
  size, up to 16,384.
- **`sheetSlots`**: 1 to 8 cells per clip, each `[sheet, x, y, w, h]` in
  integer pixels: an index into `sheets`, then the cover's rectangle on that
  page. A cell must lie inside its page, may not be larger than its page's
  `edge`, and a clip has at most one cell per level. Cells without a
  `sheets` list are an error; a page no cell uses is a warning.
- **Which cell a view uses.** Each view asks for the size it draws, in device
  pixels, and takes the cell of the smallest level at least that large, else
  the largest. The overview and the 3D atlases draw from the small levels
  (the near atlas asks for 160 px, so its working set stays decoded); a
  reading zoom, the detail pane and 3D cards crop from the largest. A tile
  moves up a level as a zoom needs more pixels, never down. Pages load when
  a cell on them is first needed, so the overview waits only for its own
  level.
- **Cells and files together.** A clip with cells and no file (`cover`,
  `coverVariants` or `media`) reads every view from its cells. For a clip
  with both, `images.sheets` decides:
  - `"overview"` (the default, and what a wunderkammer server's baked pages
    are): the cells feed only the overview canvas, and the file serves every
    other view. Small sheets beside full-size files work this way.
  - `"covers"`: the cells serve every view, and the file loads only for a
    cell whose page fails. Use it when the largest level holds each cover at
    full size.

  A `detailCover` still wins in the detail pane, so a document can pair
  sheets with larger files that load only when someone opens an item.
- **A page that fails** (missing, unpublished, refused) withdraws its cells.
  A clip with a file falls back to the file in every view: the flat wall and
  overview, the detail pane, the 3D atlases and cards, the album walls and the
  comparison evidence. A clip without one takes another level that loaded. A
  document can therefore name pages before they are published: until they
  are, it loads one file per item as before, after one failed request per
  page.
- **How each view draws a cell.** The flat overview paints straight from the
  decoded page (`wall/overview-sheets.mjs`). Views that need an `<img>` (wall
  tiles at a reading zoom, the detail pane, 3D cards, comparison evidence)
  get the cell cropped on a canvas and encoded once as a `blob:` URL, shared
  by every view that asks (`wall/sprite-covers.mjs`). The 3D atlases and the
  album walls draw the crop into their own textures. No item text is
  involved, so the `textContent`-only rule is unaffected.
- **Pages are opaque and need CORS off-origin.** Pages are fetched and
  cropped, so a page on another origin must send CORS headers or its covers
  stay blank in every view; the loader warns when `images.cors` is not true.
  At most 32 Mpx of pages stay decoded (eight 2,048-px pages); others reload
  from the HTTP cache.
- **Building sheets:** `scripts/collection-sheets.py` reads a document,
  fetches or reads each clip's cover, packs every cover at 64 and 160 px and
  at its own size (`--levels 64,160,full`) into 2,048-px WebP pages, and
  writes the document back with `sheets` and `sheetSlots`. It reuses
  `sheets.py`'s page rules (2-px edge-replicated gutters, pages named by the
  SHA-256 of their bytes) but keeps each cover's aspect, and never enlarges a
  cover to fill a level. Each clip keeps its `cover` as the fallback; a
  `detailCover` or `media` that only repeats it is removed. When the largest
  level holds every cover at full size, the document gets
  `images.sheets: "covers"`. Pages go in `sheets/` beside the document, or in
  `--sheets-dir`, named relative to the document or under `--sheets-url` when
  they will be hosted elsewhere. `--drop-covers` removes the files instead,
  leaving cells as the only source.
- **Publishing:** `scripts/check-public.mjs` treats a sheet page as chosen
  media when a collection document in the tree names it in `sheets` and its
  file name is the SHA-256 of its bytes.

The Psychodeli example (`examples/psychodeli/collection.json`) names 16 pages
on the public demo site (`https://andyed.github.io/clipwall-demo/sheets/`)
and keeps its 297 per-file covers there as the fallback. The pages are not in
this repository. Until they are published there, the example loads the
per-file covers. Its numbers are in [PERF.md](PERF.md#collection-sprite-sheets).

**Verification:** `tests/collection.test.mjs` (validation: bounds, schemes,
levels, roles, warnings), `tests/sprite-covers.test.mjs` (level choice, crop
rectangle, one encode per cell, page failure and fallback, the decode
budget), `tests/collection-view.test.mjs` (the flat wall, detail pane,
overview canvas, 3D atlas, album walls and evidence thumbnails each show the
right cell's colour with no per-item request; with `"covers"`, cells win where
files exist; with the sheet pages missing, every view shows the files'
colours instead), `tests/test_collection_sheets.py` (the builder) and
`tests/check-public.test.mjs` (the gate). Sixteen mutations in
`scripts/check-mutations.mjs` (`MUTATION_FILTER=sprite`) each remove one
protection, one view's cell path or one step of the fallback, and show a test
failing.

**Loading** (`wall/collection-source.mjs`). The first match wins:

| Source | Use |
|---|---|
| `?collection=<url>` | The wall (`index.html`) or `wall/compare.html`, including when a wunderkammer instance serves them |
| `?collection=parent` | Set by `mount()`; the embedding page posts the document |
| `<meta name="wunderkammer-collection" content="…">` | A static build's default (`scripts/build-demo.mjs`) |

In collection mode there is no server. `/api/clips` is never requested, and
remote covers load directly with CORS instead of through `/api/proxy`
(`wall/media-policy.mjs`). Piles are kept in memory for the visit. Links carry
the whole view inline, because no snapshot store is used: an instance serving
the page must not store views of someone else's collection. `?collection=` is
not a view-intent key, so it survives permalink rewrites.

**Embedding** (`wall/embed.mjs`):

```js
import * as Wunderkammer from './wall/embed.mjs';
const wall = Wunderkammer.mount(element, collectionObjectOrUrl);   // wallUrl defaults to ../index.html beside embed.mjs
await wall.ready;   // resolves on the wall's own "view ready" message
```

A collection object is validated in the host first, so a bad one throws a
`CollectionError` before any frame exists. It is then posted to the wall's
origin only, and the wall validates it again. The wall reports
`wunderkammer:view-ready` or `wunderkammer:error` to its parent, which also works across
origins. Problem text goes to the parent only when the parent posted the
document. A `?collection=` URL is fetched with the wall's origin. Its problems
could quote a document the embedder cannot read, such as a local instance's
`/api/view-state`, so the parent gets a generic error and the frame shows
the details. Artifact hosts are untested.

**Hosting the page.** Wunderkammer is released as git tags (`v<version>` on
GitHub); no package is published to a registry. The wall is `index.html` at
the repository root and loads its assets by relative path from `wall/`, so it
runs from any directory: `/` on a wunderkammer instance, or a checkout or
static build of a tag at any sub-path, such as a GitHub Pages project site
(the [live demo](https://andyed.github.io/clipwall-demo/) is one).
`tests/cdn-subpath.test.mjs` serves only the files `package.json` lists, under
a versioned sub-path, and boots the wall and `mount()` there. Pages need a host
that serves HTML as `text/html`. jsDelivr's GitHub route
(`https://cdn.jsdelivr.net/gh/andyed/wunderkammer@<tag>/`) serves a tag's
modules as JavaScript but its HTML as `text/plain` (checked 2026-10-18), so
import modules from it only and pass `mount()` a `wallUrl` on a static host.
Framing from an artifact host depends on that host's content security policy
and is untested.

**Facet counting** had two copies, in `serve.mjs` and `scripts/build-demo.mjs`.
They had drifted: the server's copy assumed every clip had `tags`. There is now
one copy, `wall/facet-counts.mjs`. It lives under `wall/` rather than `lib/`
because the browser loader imports it, and only `wall/` is served; `serve.mjs`
already imports `wall/permalink.mjs` the same way.

**Verification:** `tests/collection.test.mjs` (validation) and
`tests/collection-view.test.mjs` (static host with no API: boot, meta tag,
readable errors, `mount()`, withheld error detail, 3D with CORS covers from a
second origin). Five mutations in `scripts/check-mutations.mjs`
(`MUTATION_FILTER=collection`) prove those tests fail when any of these is
removed: the scheme check, document-relative resolution, the proxy bypass,
the error-detail rule or loader validation. The snapshot-store switch has no
test: a view must exceed 6,000 encoded characters before a snapshot is
attempted.

## Comparison recipe

`validateComparison()` in `wall/comparison-model.mjs` accepts a strict v1
recipe: question, corpus identity and revision, scope (query and facets),
`groupBy` with 2–6 groups, a measured attribute, count or share, category limit
and sort. An LLM can author this directly. The host checks corpus identity
before applying it.

**Starting points.** The page's Starting point menu holds the music
library's three comparisons: genre across decades, artwork color across
decades, and Rock and Jazz across decades. Each is listed only when the
collection has a `decade` attribute with at least two values and the
attribute, or both genre values, it names. With none of them, the menu is
hidden. `startingPoints()` in `wall/comparison-copy.mjs` decides.

**Verification:** `tests/comparison-copy.test.mjs` (the three wordings and
the starting-point gates), `tests/collection.test.mjs` (`ui.nouns`
validation), and page tests in `tests/collection-view.test.mjs` (a collection
without music attributes, one with `ui.nouns`) and
`tests/comparison-view.test.mjs` (the music library's wording and menu).
Ten mutations in `scripts/check-mutations.mjs` (`MUTATION_FILTER=wording`)
each restore the badge, a music noun or an ungated starting point, and show
a test failing.

## Observations

An observation is a claim the model makes about a comparison, anchored to
cells or items the person can open. It does not summarize the evidence; it
points into it. Envelope format `wunderkammer.observations`, version 1
(`wall/observations.mjs`):

```json
{
  "format": "wunderkammer.observations", "version": 1,
  "comparison": { "version": 1, "...": "a v1 comparison recipe" },
  "observations": [
    { "id": "jazz-falls",
      "text": "Jazz is less common in the 1990s than in the 1970s.",
      "evidence": { "cells": [{ "value": "Jazz", "cohort": "1970s" },
                              { "value": "Jazz", "cohort": "1990s" }],
                    "items": ["urn:album:alpha"] } }
  ]
}
```

- **Validation:** `validateObservations()` checks the envelope and validates
  the comparison with the unchanged `validateComparison()`. It lists every
  problem with its path. Limits: 12 observations, 600 characters of text, 12
  cells and 200 items each. Ids are 1–40 letters, digits, `-` or `_`. A
  cell's `cohort` must be one of the comparison's groups; without one, the
  cell cites its value in every group.
- **Numbers are computed, not authored.** `resolveObservation()` takes each
  cited cell's count, denominator and share from `comparisonEvidence()`, the
  same rows the evidence export carries. The panel says that the text is the
  author's and the figures are computed. v1 does not parse numbers out of
  the prose.
- **Unresolved citations are shown, never dropped:** a value the measure does
  not contain, a group the comparison lacks, or an item outside the
  collection. An observation with nothing resolvable offers no evidence.
- **Selecting an observation** lights exactly its cited cells in the matrix
  and their places on the album walls. A multi-group album is lit only in
  the racks its cells name. The evidence list shows the union of its items
  in corpus order. `observationPacket()` is the export for that selection.
- **Delivery:** `compare.html?observations=<url>` loads an envelope, and the
  recipe dialog accepts one. Once loaded, the observations travel in the
  link as `obs` (base64url JSON), and the selected one as `observation`, so
  Copy view keeps them. A failed load leaves the comparison usable and keeps
  the address, so a reload retries it.
- **Stale observations:** observations apply only to the comparison they
  were written for. After the person changes the comparison, the panel
  shows them without figures, with a button that returns to that
  comparison.
- Authored text is rendered with `textContent` only.
- **No server needed:** `compare.html` reads a collection document as the
  wall does. A collection, its comparison and observations therefore run from
  two static files:
  `wall/compare.html?collection=<collection.json>&observations=<observations.json>`.
  Give the collection a `corpus.revision` and repeat the corpus `id` and
  `revision` in the comparison. Otherwise the page notes that the recipe names
  a different corpus. Comparison links keep `collection=`, and the wordmark
  links back to the wall with the same collection. In collection mode,
  evidence thumbnails may come from any http(s), `data:image/` or `blob:`
  source the document names; an instance's thumbnails stay same-origin.
  Asset paths in `compare.html` are relative, so the page also works under a
  static sub-path.

## Hand-back

`window.wunderkammer.export()` returns a portable packet on both pages. It
carries identities and titles, never notes or paths.

- **Flat wall** (`format: wunderkammer.export`): corpus, scope (label, query,
  facets, branch counts), mode and grouping, the focused item, the pinned
  highlight with its matching keys, the in-scope count and total, and every
  in-scope item in corpus order.
- **Comparison page:** the evidence packet for the current selection,
  `comparisonEvidence()` or, for an observation, `observationPacket()`.

| Host | Channel | Status |
|---|---|---|
| Claude Code browser pane | `window.wunderkammer.export()`, read by the agent's page-JS tool | implemented |
| Claude artifact | "Copy for the conversation" button that writes the export as text | not built |
| Embedding page | `onSelection(export)` callback through `mount()` | not built |
| Any MCP client | Tools over a live wall (ledger idea 9 in [PEER_STUDY.md](PEER_STUDY.md)) | later, optional |

**Verification:** `tests/observations.test.mjs` (7) and seven new tests in
`tests/comparison-view.test.mjs`. They cover loading, figures agreeing with
the matrix, union selection, link round-trip, text never parsed as markup,
staleness, an invalid file, the recipe dialog and the album-wall highlight.
`tests/collection-view.test.mjs` adds a test for the flat-wall export. Six
mutations (`MUTATION_FILTER=observation`, `MUTATION_FILTER='export highlight'`)
prove these tests fail when a protection is removed. On the 297-image public
demo corpus, the computed figures matched an independent tally. Selecting an
observation dimmed the walls exactly as much as the equivalent category
selection did (mean stage luminance 55.8 → 33.0 for both).
