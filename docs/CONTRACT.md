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

**Validation** (`wall/collection.mjs`, `validateCollection()`): unknown keys
are refused with the list of supported ones, and every problem is reported
with its path in one error, up to 25. Server-only keys (`vault`, `adapters`,
`generated`, `sheets`) are refused by name. `toCollection()` converts a server
payload and reports each field it leaves out.

- **Required:** `format`, `version`, `corpus.id` and `clips` (1 to 50,000).
  Each clip needs a non-empty `id`.
- **Identity:** `url`, falling back to `id`, as `clipKey()` defines it.
  Repeated identities are an error. `url` is an http(s) URL or an opaque
  `urn:`.
- **Links:** `sourceUrl` is http(s) only. **Images:** `cover`, `detailCover`,
  `coverVariants[].src` and `media[].src` may be http(s), `data:image/` or
  `blob:`. Relative URLs resolve against the document's URL, as CSS URLs do.
- **Attributes** go in `props`: strings, finite numbers, booleans or arrays of
  them. A props key that names a clip field (`title`, `source` …) is refused,
  because `valuesOf()` reads the clip's own field first.
- **`facets`** is derived from the clips. Supplied counts are replaced, with
  a warning when they disagree.
- **`facetTypes`** (categorical, ordinal with `order`, numeric, date) is
  validated and carried. The wall does not use it yet.
- **`images.cors`** declares that covers on other origins send CORS headers.
  Without it, the loader warns that such covers stay blank in the 3D views. A
  DOM-tile fallback for them is not built.
- **`viewState`** (optional) is the document's starting piles and grouping.

**Loading** (`wall/collection-source.mjs`). The first match wins:

| Source | Use |
|---|---|
| `?collection=<url>` | The wall or `wall/compare.html`, including when a wunderkammer instance serves them |
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
const wall = Wunderkammer.mount(element, collectionObjectOrUrl, { wallUrl: './' });
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
the details. Artifact hosts are untested. Checked 2026-10-17 on an npm package's
`index.html`: jsDelivr serves HTML as `text/plain` and unpkg as `text/html`.
A CDN-hosted wall page could therefore be framed from unpkg, if the artifact
host allows framing it. That is untested.

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
