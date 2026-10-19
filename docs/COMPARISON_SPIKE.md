# Comparison in depth

Local spike, 2026-10-17. Entry: `/wall/compare.html` on any Wunderkammer instance,
or on a static host with `?collection=<collection.json>`.
The exercised instance is the cached Music Atlas on `http://127.0.0.1:4196`.
This is an experimental route, with no change to the existing wall or its saved
piles. Source data, audio tags and original artwork are read-only.

## Question and design decision

Can a small, agent-authored comparison help a person notice a difference,
inspect its exact contributors, and ask a better next question? The concrete
first question is how genre incidence differs across tagged release decades
in the music collection.

**Muriel synthesis — Probe, revised after user review:** the primary view is
an aisle of tall album-art racks, following the user's Matrix reference. Each
cohort occupies a successive bay with inward-facing covers on both sides.
Every cohort identity has a stable place; genre selection highlights its albums
without moving them. Walk aisle brings later bays within reach. Exact counts,
shares and signed differences remain in the linked matrix below.

The earlier chart stays available as Depth chart, Aligned, and Terraces. Those
modes align categories and use a common metric scale. Slice hides other groups
without changing membership or denominators. The representation is reversible;
artwork placement does not encode share or imply chronological order within a
bay. Covers are ordered by stable identity.

The design follows the linked-view identity and preview/selection separation
in Muriel's multiscale guidance. Those are design foundations. This spike has
not demonstrated better comprehension or reasoning in a human study.

## Implemented

- Two to six named cohorts, categorical comparison, counts or within-cohort
  shares, category ordering and a bounded category count.
- Canonical Wunderkammer query/facet scope through `filterScope()`, and URL identity
  through `clipKey()`. Grouping, metric, camera, preview and selection retain
  their separate meanings.
- Full-width album walls, now the default for new links (`view=walls`). Eight
  rows on each side of the aisle represent every selected cohort member, with
  repeat appearances for multi-cohort albums explicitly counted. Individual
  covers open exact source identity; keyboard users have the item list below.
  Selection/hover dims nonmatching covers without reflow. `travel=0..1` records
  aisle progress; `spread` changes aisle width. Search/group controls initially
  fold to reserve screen space for artwork.
- Sideways scroll on the album walls is a walk along the aisle, shared with the
  wall page's aisle (`wall/aisle-wheel.mjs`; details in
  [AISLE.md](AISLE.md#sideways-scroll)). `travel` is written as the Walk aisle
  slider writes it, with `replaceState`, so it is kept in the URL and across
  Back/Forward. A fitted camera takes the pose at the new travel and the URL
  needs no `camera`. A turned or zoomed camera slides along the aisle at its
  angle, and that `camera` is written to the URL with the new `travel`.
  Vertical scroll and pinch stay a zoom, and each gesture keeps the axis it
  starts on. In the chart views sideways scroll does nothing.
- Shared 128px artwork atlases, eight concurrent loads, and instanced drawing.
  The exercised collection uses four 2048px atlas pages (64 MiB of texture
  storage), 939 decoded covers and 949 cover positions. Metric/ranking changes
  reuse decoded textures and geometry. Membership/source changes cancel stale
  loads and rebuild. Atlas memory still scales with unique identities; larger
  corpus paging and a higher-resolution near tier are future work.
- Real Three.js cohort planes, shared bars and grid, depth spread, front view,
  terraces, slicing, bounded orbit/zoom, Fit and keyboard camera controls.
  Aggregate rendering is bounded to 120 bars. A maximum of six artwork samples
  per cohort provides visual context in the chart modes only; these are samples, not the exact evidence
  population. The evidence strip pages through the complete selected population.
- A linked exact matrix. Hover/focus previews without changing the recipe,
  evidence or URL. Activating a category selects it across groups; activating a
  cell selects one category in one group. Changing counts/shares preserves it.
- Album inspection using existing metadata and local artwork, exact evidence
  export, and JSON recipe validation/application/download.
- Readable URL parameters, browser history, fresh-context restoration, and
  explicit corpus-revision mismatch reporting.
- Responsive stacking, phone touch activation, keyboard alternatives, 16px
  scene labels, high-contrast existing Wunderkammer colors, no automatic motion.
  Exact comparison remains available if WebGL/CDN loading fails.

## URL composition

An LLM can emit a short URL without knowing the local corpus revision. It is
a live query against whatever index the addressed instance currently serves:

```text
/wall/compare.html?groupBy=decade&group=1970s&group=1990s&measure=genre&metric=share&category=Jazz&view=depth
```

Repeated `group` parameters avoid ambiguity for names containing commas.
Encode values with `URLSearchParams`, rather than concatenating unescaped text.

| Parameter | Meaning |
| --- | --- |
| `groupBy` | Attribute supplying comparison groups, such as `decade` |
| `group` (repeat) | Two to six distinct group values, in comparison order |
| `measure` | Categorical attribute to compare, such as `genre` or `color` |
| `metric` | `share` or `count` |
| `q` | Canonical all-words query within the collection |
| `facet.genre=Jazz` (repeat) | Canonical facet scope; OR within a key, AND across keys |
| `sort` | `difference`, `total`, or `name` |
| `limit` | Four to twenty displayed categories |
| `category`, `within` | Selected category, optionally restricted to one group |
| `view` | `walls` (new-link default), `depth`, `front`, or `terraces` |
| `travel` | Aisle progress from 0 (entrance) to 1 (last bay) |
| `spread` | Aisle width or chart depth separation, from 0 to 1 |
| `slice` | Show one group's plane; leaves population and counts unchanged |
| `question` | Authored question; otherwise inferred from the named dimensions |
| `corpus`, `revision` | Expected source identity; mismatches remain visible |
| `camera` | Six finite numbers: position xyz, target xyz |
| `focus` | Stable item identity to inspect |

`Copy view` records source identity/revision and the deliberate camera and
selection. The recipe dialog also offers `Copy live URL`, which omits source
revision, camera and focused item. Both feed the same validated state and scope
model. Legacy spike hash links remain readable. No new server write endpoint
or mutable pile-state format is introduced.

A saved URL is not a retained corpus snapshot. When the source has changed,
the view says results are recomputed from the current index. Evidence exports
carry both the actual source and the requested source, with an explicit warning.

## Counting and evidence

One URL identity contributes once per cohort and category. Duplicate records
retain the first occurrence and produce a warning. Multi-valued years can put
an album in several decades. Multi-valued genre tags can make shares sum above
100%; this is tag incidence, not a partition. Unknown attributes remain
explicit. Empty-cohort shares and percentage-point differences show `—`.

The difference column is last cohort minus first cohort. For shares its unit
is percentage points; for counts it is items. It is descriptive, with no
statistical-significance or causal claim. Category truncation is labeled and
never changes the underlying denominator or exact evidence membership.

The live index contains 1,793 album identities with artwork. Its index report
also lists 777 without usable artwork, which the existing music adapter does
not expose as tiles. The scope is therefore the cover-art collection, not the
whole library. Tagged release chronology is not listening/acquisition history.

## Code ownership and verification

| Responsibility | Source |
| --- | --- |
| Recipe validation, membership, aggregates, evidence | `wall/comparison-model.mjs` |
| URL/view validation and serialization | `wall/comparison-view.mjs`, reusing canonical JSON from `wall/permalink.mjs` |
| Host state, exact matrix, controls and inspection | `wall/comparison-app.mjs` |
| WebGL view and camera | `wall/comparison-scene.mjs` |
| Album racks, atlas, exact picking and highlighting | `wall/album-walls.mjs` |
| Sideways scroll as a walk along the aisle (shared with the wall page's aisle) | `wall/aisle-wheel.mjs`, `tests/aisle-side-scroll.test.mjs` |
| Experimental route and existing-theme styling | `wall/compare.html`, `wall/comparison.css` |
| Isolated correctness and interaction checks | `tests/comparison-{model,state,view}.test.mjs` |
| Explicit-target rendered proof | `scripts/check-comparison.mjs`, `scripts/check-comparison-walls.mjs` |

The renderer imports the same pinned Three.js 0.169.0 version as the existing
spatial view. Vendored Muriel files are unchanged.

```sh
node --test --test-concurrency=1 tests/comparison-model.test.mjs tests/comparison-state.test.mjs tests/comparison-view.test.mjs
COMPARISON_URL=http://127.0.0.1:4196/wall/compare.html node scripts/check-comparison.mjs
COMPARISON_URL=http://127.0.0.1:4196/wall/compare.html node scripts/check-comparison-walls.mjs
node wall/spatial/lib/sync.mjs
npm test
```

Browser launch needs normal host permission in the restricted Codex runtime.
The fixture tests deliberately block the optional graphics CDN, proving that
comparison, evidence, history and keyboard/touch inspection still work. The
explicit-target script separately requires working WebGL, checks real artwork
and exact fresh-camera restoration, and writes screenshots plus a JSON receipt
under ignored `.local/comparison-spike/proof/`.

**Muriel delta:** album walls, cohort charts and an exact matrix share canonical scope,
stable evidence identities, and a readable URL recipe. The final focused
suite passes 28/28. Live desktop/phone checks verify all 939 covers decode,
exact cover picking, selection, aisle travel, and fresh camera restoration.
The proof is in `.local/comparison-spike/walls-proof/`. The full application suite passed
289/290 with the previously documented Canary A2 card-ink failure; see the
handoff for timing and final-change coverage. Human reasoning benefit remains
an evaluation question.

## Observations

An observations envelope (`wunderkammer.observations`, see
[CONTRACT.md](CONTRACT.md#observations)) adds
authored claims to a comparison. Each claim cites cells or items. The panel
shows the author's text beside figures computed from `comparisonEvidence()`.
Selecting an observation lights its cited cells and wall places and lists
their items. Load one with `?observations=<url>` or paste it into the recipe
dialog. Copy view keeps it in the link.

## Boundaries and next decisions

This slice implements comparisons across categorical subsets of one current
corpus. It does not yet implement retained before/after revisions, matched-item
changes, arbitrary numerical distribution bins, selection-versus-complement
sets, or a Cartographer adapter. A validated recipe and readable URL provide
an agent authoring surface; no live LLM or MCP connection was added.

The next comparison should evaluate task outcomes in Depth versus Aligned:
finding a difference, identifying its contributors, correcting a denominator
mistake, and recovering the original context. Record errors and useful new
questions as well as completion time. Screen and browser checks establish
rendering and interaction behavior, not that the representation improves
intelligence.
