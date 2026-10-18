# Precedents and useful comparisons

Source check: 2026-09-07; image-collection explorers rechecked 2026-10-13. A short reading map, not a novelty claim or a library
selection. Repository descriptions below are documented capabilities; we did
not install, benchmark or audit those projects in this wrapup. Recheck a pinned
version and its license before adopting code.

## Interaction lineage

| Source | Relevant idea | Implication for Wunderkammer; limit of the comparison |
|---|---|---|
| Ben Shneiderman, **The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations** (1996), [author's paper](https://www.cs.umd.edu/users/ben/papers/Shneiderman1996eyes.pdf), [DOI](https://doi.org/10.1109/VL.1996.545307) | Overview, zoom, filter, details, relate, history and extract as distinct tasks | Survey / review / dive plus shared scope fits an established task vocabulary. Relate, history and extract expose remaining work; the paper does not validate our particular navigation gestures. |
| George Robertson, Mary Czerwinski, Kevin Larson, Daniel C. Robbins, David Thiel and Maarten van Dantzich, **Data Mountain: Using Spatial Memory for Document Management** (1998), [Microsoft Research paper](https://www.microsoft.com/en-us/research/wp-content/uploads/1998/01/p153-robertson.pdf) | User-arranged documents on an inclined plane with a fixed viewpoint and simple 2D interaction | Spatial placement can be part of retrieval, so rearrangement has a cognitive cost. Its study does not establish that our automatically repacked stacks or perspective view outperform a grid. Earlier Wunderkammer notes incorrectly included Dumais in the author list. |
| **Pad++ semantic zoom**, [author project documentation](https://www.cs.umd.edu/projects/hcil/pad%2B%2B/papers/jvlc-96-pad/zoom-4.html) | Changing the information shown with scale, illustrated by changing clock/date detail | Our caption levels and context reveal can change what is useful at a scale. Scaling heading fonts alone is geometric scaling; it is not the whole semantic-zoom idea. |

These are conceptual precedents. Our proposed edge pan-to-zoom behavior is an
experiment implementing the local principle “prevent unhelpful navigation.”
Neither its usability nor its novelty is established by the references above.
Evaluate intent, discoverability, reversal and reachability with users.

## Projects worth studying narrowly

| Project / source | What the project documents | What to borrow or test next |
|---|---|---|
| [egjs Grid](https://github.com/naver/egjs-grid) — MIT | Masonry, Justified, Frame and Packing layout classes; image-size hints and resize handling | Candidate engines for additional Review layouts. Compare mixed aspect ratios, uneven groups and resize stability behind `layout.mjs`; preserve our scope, identity and camera contracts. No adoption yet. |
| [egjs InfiniteGrid](https://github.com/naver/egjs-infinitegrid) | Grid presentation for an expanding collection of cards | Study view recycling for a bounded DOM budget. A scrolling collection library does not by itself supply our two-axis camera, layer semantics or DOM/GPU handoff. Verify these integration costs before choosing it. |
| [Piling.js](https://github.com/flekschas/piling.js) — MIT | Interactive visual piling for small multiples, using PixiJS/WebGL | Compare pile previews, organization and inspection gestures. This is a closer piling precedent than a general note editor; do not infer a safe item count for our renderer from another implementation. |
| [Linklore](https://github.com/gabriele-mastrapasqua/linklore) — MIT | Local Go/SQLite bookmark library; several collection views; full-text search with optional semantic/LLM features; a seeded public demo | Study onboarding, an inspectable local data store and usefulness without inference. A portable demo is especially relevant to release readiness. This is a reference, not a decision to replace our adapters or Node server. |

Piling.js also links its research paper, **A Generic Framework and Library for
Exploration of Small Multiples through Interactive Piling**, by Fritz Lekschas,
Xinyi Zhou, Wei Chen, Nils Gehlenborg, Benjamin Bach and Hanspeter Pfister,
IEEE TVCG 27(2), 358–368 (2021),
[DOI 10.1109/TVCG.2020.3028948](https://doi.org/10.1109/TVCG.2020.3028948).
The [authors' preprint](https://arxiv.org/abs/2005.00595) is a useful route into
the design space; a literature survey is outside this checkpoint.

## Image-collection explorers (scan 2026-10-13)

A survey of tools that put a whole image collection on one navigable surface.
Licences were read from each repository's licence file, because GitHub's label
was wrong three times (VIKUS Viewer reads "NOASSERTION" but is MIT; Plotlas and
deepscatter read "NOASSERTION" but are non-commercial). Features are from READMEs
and entry files, not from running the projects. Stars and activity as of the
scan date.

**Permissive licence, closest to Wunderkammer**

| Project | Licence | What it documents | Nearest overlap; difference |
|---|---|---|---|
| [VIKUS Viewer](https://github.com/cpietsch/vikus-viewer) (150★, active) | MIT | Static app; `data.csv` + `config.json`; keyword crossfilter, timeline and t-SNE/UMAP layouts; PixiJS canvas with a DOM detail sidebar; image tiers as sprite sheets (128 px by default, 90 px above 5k, per the code; the README's 256 is a config value) then 1024 px and a full-size focus texture | The closest relative: a configured collection, facets, a WebGL overview and the same mip-style image tiers Wunderkammer adopted on 2026-10-13. Detail is a sidebar; tiles do not become DOM in place. |
| [Collection Space Navigator](https://github.com/Collection-Space-Navigator/CSN) (68★) | MIT | React port of umap-explorer; 2D projections with zoom, transitions between projections, range-slider and text filters; Colab or Jupyter preprocessing; pins Node 16 | Same pairing of spatial navigation with filters, aimed at embeddings research. Projection-first rather than group-and-facet layout. |
| [PixPlot](https://github.com/pleonard212/pix-plot) (654★) | MIT | Python pipeline (Inception features, UMAP) into a custom WebGL viewer with image atlases; metadata CSV; `cell_size` to fit GPU memory | The atlas technique Wunderkammer's 3D far tier and overview sheets also use. Harvard's Surprise Machines is a PixPlot deployment, not a separate engine. |
| [Embedding Atlas](https://github.com/apple/embedding-atlas) (4,987★, Apple) | MIT | WebGPU scatter for millions of points; linked charts with cross-filtering; search; npm and PyPI packages; image, text and audio column viewers | The most polished cross-filter toolkit and a packaging model (npm + PyPI) worth copying. Points first; images are a column viewer, not a wall. |
| [Piling.js](https://github.com/flekschas/piling.js) (255★, idle since 2023) | MIT | PixiJS piles of small multiples, layout by attributes or UMAP | Already listed above as the piling precedent. |
| [seajax](https://github.com/seajax/seajax) (Microsoft, idle since 2021) | BSD-2-Clause (corrected 2026-10-13 from the licence file; earlier listed as BSD-3) | Seadragon Ajax deep zoom plus a JavaScript clone of Silverlight **PivotViewer**: filter and sort a deep-zoom collection | The historical ancestor of faceted zooming collections. Worth reading for its sort/filter transitions, not as a dependency. |

Adjacent and permissive, but dataset-QA tools rather than walls:
[FiftyOne](https://github.com/voxel51/fiftyone) (Apache-2.0),
[Renumics Spotlight](https://github.com/Renumics/spotlight) (MIT). Deep zoom only:
[OpenSeadragon](https://github.com/openseadragon/openseadragon) (BSD-3).

**Not permissive; study, do not borrow code**

| Project | Licence |
|---|---|
| [Plotlas](https://github.com/Plotlas/plotlas) (grid, timeline, scatter and map layouts; tile pyramids; claims a million images) | PolyForm Noncommercial; commercial licence sold separately |
| [deepscatter](https://github.com/nomic-ai/deepscatter) (Nomic; billion-point zoomable scatter) | CC BY-NC-SA 4.0 |
| [OpenLink HTML5 PivotViewer](https://github.com/openlink/html5pivotviewer) | GPL |
| [PhotoPrism](https://github.com/photoprism/photoprism), [Immich](https://github.com/immich-app/immich) (faceted photo libraries) | AGPL-3.0 |

**Source study, 2026-10-13.** All six permissive peers were cloned at pinned commits, run on the
same corpora and read: [PEER_STUDY.md](PEER_STUDY.md). It confirms on source evidence that none
promotes a GPU tile to live DOM in place. It corrects three lines above: VIKUS has no crossfilter.js
(its "crossfilter" is a hand-written full scan), Embedding Atlas has no WebGPU fallback and runs
DuckDB in Python by default, and seajax is BSD-2.

### Studied and ruled out (peer study, 2026-10-13)

Do not re-study these without a new reason. Evidence and citations are in
[PEER_STUDY.md](PEER_STUDY.md#ruled-out-also-recorded-in-precedentsmd).

| Technique | Where | Why not |
|---|---|---|
| CPU tween of the position array with a new GL buffer per frame | CSN, umap-explorer | +390 / +840 GL buffers per switch at 10k, none freed |
| Per-frame easing of every sprite without `dt` | VIKUS | 611 ms layout-switch script at 10k; frame-rate dependent |
| Three-stage filter choreography with input blocked (~3 s) | PivotViewer | Wunderkammer budgets filter INP ≤ 100 ms |
| LOD by camera-grid distance or by a count-in-view threshold | PixPlot, VIKUS | Loads off-screen cells (561 vs ~50 visible); projected size is the rule |
| Fixed device-max textures (512 MiB) whatever the collection | PixPlot | GPU memory must follow need |
| Texture tiers never evicted; caches bounded by count | VIKUS, PivotViewer | Budgets must be in bytes |
| Every full-size image loaded before the first frame | Piling.js | 684 MB and 16.9 s at 10k |
| Camera applied by moving every item on the CPU | Piling.js | Pan script 347 → 5,704 ms from 406 to 10k |
| Mosaic/DuckDB crossfilter; filter by dropping points; hover by query | Embedding Atlas | Our predicate is 3–16 ms; the cost is restyle, which this does not touch |
| `gl.POINTS` sprites for images; two downloads per atlas | CSN, umap-explorer | Square, screen-sized, capped; double bytes |
| Canvas at CSS resolution with tiles fetched for DPR | PivotViewer | Fetches pixels it cannot show (12 s vs 1.1 s to fully drawn) |
| Spec fields or templates that `eval`; state with function-valued keys | VIKUS, PivotViewer, Piling.js | Unsafe or non-round-tripping for an agent-emitted spec |
| vikus-viewer-script's sprite pipeline | vikus-viewer-script | No licence file; read only |

**What the scan does and does not establish.** None of these documents a tile
that moves from a GPU quad to live DOM as the camera approaches it, which is
Wunderkammer's promotion contract (see PERF.md, "Is the DOM + three.js hybrid a
unique approach?"). That is a reading of READMEs and entry files, not an audit
of their renderers; CSN's internals in particular were not read. The
WebGL-overview-plus-DOM-detail split itself is common (VIKUS, Mapbox, Figma).
Plotlas is the most ambitious overlap and is the one to watch; its licence rules
out reuse.

## Decisions to preserve, not overstate

- **Tapestry:** the user ruled it out as preferred infrastructure because of
  AGPL. The exact repository/version discussed earlier was not re-established
  in this wrapup. Preserve that preference; recover the exact source before
  making a new licensing or technical comparison. Do not substitute an unrelated
  project with the same name.
- **tldraw:** previously considered and not adopted. The local decision favored
  an exploration surface with external editing ownership and a custom hybrid
  renderer. Historical licensing concerns are not a current license analysis.
  Recheck the [project's current terms](https://github.com/tldraw/tldraw) if the
  requirements change; do not turn an earlier preference into a ban on learning
  from its interaction design.

The next implementation should address the measured gaps in
[HYBRID_HARDENING.md](HYBRID_HARDENING.md). A library comparison becomes useful
when it can answer a specific missing capability and be judged against the same
fixture, input paths and resource budget.
