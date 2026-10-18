# Peer study plan: what the open-licence collection explorers know that we don't

Status: executed 2026-10-13; results, corrections and the technique ledger are in
[PEER_STUDY.md](PEER_STUDY.md). The plan below is kept as written (it lists seajax as BSD-3; the
licence file says BSD-2). Original status: plan, 2026-10-13. Nothing here had been run yet. Claims about peers are
from READMEs, entry files and licence files read on the scan date
([PRECEDENTS.md](PRECEDENTS.md), "Image-collection explorers"). Every
architecture judgement below marked *(hypothesis)* is a question the study must
answer, not a finding.

## Why study them, and what "uptake" means here

Wunderkammer is not looking for a renderer to adopt. It is looking for **technique**:
how peers solved problems we have measured and not solved (the open items in
TODO.md), and how they shaped their product for use cases we want
(Andy's direction: a collection explorer an LLM can hand to a person). Uptake
comes in four grades, recorded per finding:

| Grade | Meaning | Licence consequence |
|---|---|---|
| **Copy** | Lift code | MIT/BSD: keep the copyright and permission notice in a `NOTICE` or file header |
| **Port** | Reimplement an algorithm from reading it | Credit in the commit and the doc; no notice needed |
| **Borrow the idea** | A design or interaction we adapt | Cite in PRECEDENTS.md |
| **Rule out** | Studied and rejected, with the reason | Record so it is not re-studied |

## Subjects (pinned 2026-10-13)

| Peer | Commit | Licence | Why it is in scope |
|---|---|---|---|
| [VIKUS Viewer](https://github.com/cpietsch/vikus-viewer) | `ccb4e7e` (2026-08-18) | MIT (GitHub mislabels it) | Closest relative: configured collection, keyword crossfilter, timeline + similarity layouts, PixiJS overview, DOM sidebar detail, tiered textures |
| [vikus-viewer-script](https://github.com/cpietsch/vikus-viewer-script) | `c171633` (2026-03-22) | **No licence file** | Its sprite and texture pipeline. **Read only; no copying, no porting of non-trivial code.** Ask the author if we need more |
| [Collection Space Navigator](https://github.com/Collection-Space-Navigator/CSN) | `96147ee` (2025-11-11) | MIT | Projection navigation plus range and text filters; research onboarding via Colab |
| [umap-explorer](https://github.com/GrantCuster/umap-explorer) | `d31e3de` (2020-07-28) | MIT | CSN's rendering ancestor; small enough to read whole |
| [PixPlot](https://github.com/pleonard212/pix-plot) | `3afce47` (2026-03-18) | MIT | WebGL image atlases and level-of-detail at tens to hundreds of thousands of images |
| [Embedding Atlas](https://github.com/apple/embedding-atlas) | `f2fff54` (2026-10-08) | MIT | Cross-filtering at millions of rows, WebGPU, npm + PyPI packaging |
| [Piling.js](https://github.com/flekschas/piling.js) | `9983067` (2022-02-12) | MIT | Piles, previews, a renderer-agnostic library API |
| [seajax / PivotViewer](https://github.com/seajax/seajax) | `0293770` (2017-10-31) | BSD-3 (Microsoft) | The faceted-zoom ancestor: sort/filter choreography over a deep-zoom collection |

Out of scope for code study, kept as reference points: Plotlas (PolyForm
Noncommercial), deepscatter (CC BY-NC-SA), the GPL/AGPL apps. Reading their
public docs for ideas is fine; reading their source to reimplement it is not.

---

## Part 1 — The architecture space

Each axis lists the range of solutions, who uses which, and the trade-offs as
we understand them today. The study confirms or corrects every row.

### 1.1 Rendering substrate

| Option | Used by | For | Against |
|---|---|---|---|
| **DOM tiles** (`<img>` per item, CSS transforms) | Wunderkammer flat wall, most galleries | Accessibility tree, find-in-page, links, selectable text, CSS; zero GPU code | Style and layout scale with item count (our filter restyle: 177 ms at 1.8k); per-element raster memory; the 2k-item ceiling we measured |
| **Canvas 2D** | Wunderkammer overview surface, seajax PivotViewer | Simple, one surface, no shaders | Draws are recorded cheaply but flushed in lumps (our 517 ms `fillRect` finding); no instancing |
| **WebGL via a scene library** (PixiJS, three.js) | VIKUS (Pixi), Piling.js (Pixi), PixPlot and umap-explorer (three.js), Wunderkammer 3D (three.js) | Instancing, atlases, 100k+ sprites at 60 fps | No accessibility or text selection; texture memory must be managed by hand; context loss |
| **WebGPU** | Embedding Atlas *(per README; fallback path to verify)* | Compute for layout and density; millions of points | Browser coverage; another code path; harder to debug |
| **Hybrid: GPU overview + DOM detail panel** | VIKUS, Embedding Atlas *(hypothesis)*, Mapbox, Figma | Gets both, simply: detail is ordinary HTML | The jump from picture to page is a context switch; the item you were looking at is not the thing you read |
| **Hybrid with per-item promotion** (GPU quad becomes live DOM in place as the camera nears) | Wunderkammer 3D (bounded pool of 14 cards) | Continuity: the tile you approached *becomes* the readable card; a11y and find for what is near | Two representations to keep in sync; identity bugs (we fixed index-reuse in Sept); pool sizing |

Study questions: how VIKUS keeps Pixi and its DOM sidebar coherent on selection;
whether anyone else promotes per item; how each handles WebGL context loss.

### 1.2 Image delivery and level of detail

| Option | Used by | For | Against |
|---|---|---|---|
| **One file per item per size** (`srcset`) | Wunderkammer reading tier | HTTP caching per item; browser picks size | N requests and N decodes (our 5–8 s to all-visible before sheets) |
| **Fixed sprite sheets per tier** | VIKUS (256 px), PixPlot (cell atlases), Wunderkammer overview sheets (2026-10-13) | One decode per few hundred items; instant overview | Sheet rebuild on corpus change; wasted cells; a sheet's first GPU upload is large (our suspected zoom-out regression) |
| **Runtime atlas from decoded images** | Wunderkammer overview atlas, Wunderkammer 3D far/near atlases | No preprocessing step; adapts to what is visible | Main-thread blits; eviction policy; memory accounting |
| **Tile pyramid / deep zoom (DZI, DZC)** | seajax PivotViewer (Deep Zoom Collections), OpenSeadragon, Plotlas *(per its docs)* | Constant memory at any zoom; proven at very large scale | Heavy preprocessing; pyramids per *layout* if items move, unless pyramids are per item |
| **Per-item progressive tiers** (flat: 128 → 640 → 1920 px by projected width; 3D: 64 px far, 256 px near) | Wunderkammer, VIKUS (256 → 1024 → 4096), PixPlot *(LOD, to verify)* | Sharp where you look, cheap elsewhere | Choice heuristic matters: distance vs projected size (our 3D near-tier finding: only 51 of 256 slots on visible faces) |

Study questions: PixPlot's LOD swap rule and texture budget; VIKUS's tier
switch thresholds and whether it ever unloads 4096 px textures; how
PivotViewer's DZC addresses a collection whose layout changes on every filter.

### 1.3 Filter and query engine

| Option | Used by | For | Against |
|---|---|---|---|
| **Plain JS predicate over arrays** | Wunderkammer `filterScope` | Simple, transparent, fast enough to ~10k (filter/scope 3–16 ms at 1.8k) | Re-scans everything; no incremental counts |
| **crossfilter.js** (sorted dimensions, incremental groups) | VIKUS | Fast incremental facet counts as filters change | Library is old; memory per dimension; awkward multi-valued facets *(hypothesis)* |
| **SQL in the browser (DuckDB-WASM / Mosaic)** | Embedding Atlas *(hypothesis: verify the stack)* | Millions of rows, arbitrary aggregates, linked views | WASM download size; async everywhere; harder to reason about latency |
| **Server-side query** | Wunderkammer `/api/clips` builds facets; most photo apps | Thin client | Round trip per interaction; no offline/artifact use |
| **GPU-side membership mask** | Wunderkammer 3D `setActive`; PixPlot *(hypothesis)* | Filter is an attribute write, no rebuild | Only hides; counts still need a CPU path |

Our measured problem is not the predicate (3–16 ms) but what follows it: DOM
restyle and re-render. So the study should weigh "how they avoid re-rendering
on filter" above "how they compute the filter".

### 1.4 Layout

| Option | Used by | For | Against |
|---|---|---|---|
| Justified rows / masonry | Wunderkammer, galleries | Preserves aspect; flush edges | One axis carries no meaning |
| Grouped blocks (skyline, strip treemap) | Wunderkammer (strip treemap since 2026-10-13: 79–83% screen fill) | Facet structure is visible as territory | Long tails of tiny groups (65% fill at 104 genres) |
| Timeline / histogram stacks | VIKUS, PivotViewer ("histogram view") | Time and quantity read at a glance | Needs a numeric or date axis |
| Embedding projection (t-SNE/UMAP) | PixPlot, CSN, VIKUS, Embedding Atlas | Similarity becomes place | Overplotting; axes are meaningless; needs preprocessing |
| Piles / stacks | Piling.js, Wunderkammer 3D | Many items in little space; group previews | Hidden members; pile previews are a design problem |
| Animated transitions between layouts | PivotViewer, VIKUS, CSN, Wunderkammer `layout-motion` | Object constancy: you can follow an item | Per-item tween cost at scale; motion sickness if long |

### 1.5 State, sharing and packaging

| Option | Used by | For | Against |
|---|---|---|---|
| Static site + data files (`config.json`, CSV) | VIKUS, PixPlot output, CSN build | Hosts anywhere; archivable; artifact-friendly | Preprocessing burden on the author |
| Node server + adapters | Wunderkammer | Live corpora (Obsidian, music library), permalinks, view state | Not embeddable as-is; not artifact-friendly |
| npm component + Python widget + CLI | Embedding Atlas | Meets developers in notebooks and apps | Several surfaces to maintain |
| Notebook (Colab/Jupyter) build step | CSN | Researchers' native environment | Version pinning (CSN requires Node 16) |
| URL-encoded view state | Wunderkammer permalinks | Reproducible views, shareable | URL length; schema migration |

This axis matters most for the LLM direction (Andy, 2026-10-13: Wunderkammer as a
way for an LLM to show a person an image collection, distributed inside muriel):
the question is which
packaging lets an agent emit a small declarative spec and get a working
explorer first try.

---

## Part 2 — The feature space

Rows are capabilities; the study fills each cell with **yes / partial / no**
plus a file:line citation or a demo observation. Wunderkammer's column is filled
from our own docs today.

| Capability | Wunderkammer | VIKUS | CSN | PixPlot | Emb. Atlas | Piling.js | PivotViewer |
|---|---|---|---|---|---|---|---|
| Survey: whole collection at once | yes (Fit, overview surface, sheets) | | | | | | |
| Continuous pan/zoom | yes (flat + 3D) | | | | | | |
| Semantic zoom (content changes with scale) | partial (caption tiers, context plane) | | | | | | |
| Facets, multi-valued, OR within / AND across | yes | | | | | | |
| Facet counts that react to scope | yes (share fill) | | | | | | |
| Numeric range filters | no | | | | | | |
| Free-text search | yes (substring) | | | | | | |
| Semantic / embedding search | no (TODO inquiry) | | | | | | |
| Find without changing scope (fly to match) | partial (3D, drawable cards) | | | | | | |
| Group by facet as territory | yes | | | | | | |
| Sort within groups; attribute lens/brush | yes | | | | | | |
| Timeline layout | no | | | | | | |
| Similarity layout (UMAP/t-SNE) | no | | | | | | |
| Geographic layout | no | | | | | | |
| Piles | yes (3D) | | | | | | |
| Animated layout transitions | yes (bounded) | | | | | | |
| Rich detail view (text, links, media) | yes (detail pane, reader lift) | | | | | | |
| Reading traversal (next/prev) | yes (Dive, arrows) | | | | | | |
| Selection of a subset; export it | partial (piles) | | | | | | |
| Shareable URL of the exact view | yes (permalinks) | | | | | | |
| Keyboard and screen-reader access | partial (DOM tier) | | | | | | |
| Live corpus (source changes under the wall) | yes (adapters, ETag) | | | | | | |
| No-server deployment | partial (static demo build) | | | | | | |
| Embeddable component / API | no | | | | | | |
| Preprocessing pipeline included | yes (indexers, sheets) | | | | | | |
| Documented scale | 25k measured (sweep) | | | | | | |

## Part 3 — Use cases and who serves them

| Use case | What it needs most | Peers that target it | Wunderkammer today |
|---|---|---|---|
| **Museum / cultural collection** | Time, themes, high-res detail, static hosting, curator-authored config | VIKUS, PivotViewer, Surprise Machines (PixPlot) | Capable; lacks timeline and no-server packaging |
| **Embedding / ML dataset research** | Projections, numeric filters, cross-filter at scale, notebook entry | CSN, Embedding Atlas, PixPlot, Spotlight, FiftyOne | Weak: no projections or range filters |
| **Competitive and market research wall** (Wunderkammer's origin) | Capture from the web, downloaded media, facets from frontmatter, live edits in Obsidian | none found | Strong: this is the home use case |
| **Personal media library** (music covers, screenshots) | Local files, tags read from media, colour and date facets, play/open actions | PhotoPrism, Immich (AGPL) | Strong (Music and Psychodeli atlases) |
| **Design inspiration / mood board** | Piles, arrangement, colour lenses, quick capture | Piling.js (library), commercial tools | Partial |
| **LLM-communicated collection** (Andy's direction) | A tiny declarative spec, first-try success, selection flows back to the conversation, artifact-safe packaging | none found | Not yet: needs a spec, an embeddable build and selection callbacks |

The study should score each peer against the two use cases nobody serves well
(research wall, LLM-communicated collection), because that is where technique
transfers into differentiation rather than parity.

---

## Part 4 — Per-peer question lists, tied to our open problems

Each question names the TODO item or direction it serves.

**VIKUS Viewer**
1. Texture tiers: when does it switch 256 → 1024 → 4096, does it unload, what is the GPU budget? *(page blink under GPU pressure; zoom-out max frame with sheets)*
2. Layout transitions across thousands of Pixi sprites: per-sprite tweens or a shader? *(scale ceiling; filter restyle)*
3. How crossfilter feeds keyword counts and hides sprites without a rebuild. *(scope-change restyle)*
4. `config.json` as a collection spec: what an author must declare; how close it is to an LLM-emittable spec. *(LLM direction)*
5. Detail sidebar ↔ canvas selection sync. *(detail close INP)*

**CSN and umap-explorer**
1. How projections animate: CPU tween or GPU attribute interpolation? *(transitions at scale)*
2. Filter hiding: shader attribute, index buffer rebuild, or opacity? *(scope change without re-render)*
3. Atlas construction in umap-explorer (size, count, packing). *(3D far tier from sheets)*
4. Dataset config and Colab pipeline as onboarding. *(release readiness)*

**PixPlot**
1. LOD: which cells get high-res textures, chosen by distance or by projected size? *(3D near tier by projected size)*
2. Texture budget and the `cell_size` knob's effect on GPU RAM. *(page blink)*
3. Picking: GPU colour picking or raycast? *(hover and click at 25k)*
4. Hotspots/cluster labels and layout switching.

**Embedding Atlas**
1. The real stack (WebGPU and fallback; Mosaic/DuckDB-WASM or not) and where filter latency goes at a million rows. *(scale ceiling; filter latency)*
2. Semantic zoom: density/contours far out, points near. *(overview at 10k+)*
3. Packaging: npm component API surface, Python widget, CLI, and how a host passes data in. *(LLM direction; muriel vendor)*
4. Automatic cluster labels and their placement. *(group headings at scale)*

**Piling.js**
1. Renderer abstraction and the public API: is it a declarative spec? *(LLM direction)*
2. Pile preview designs and their measured costs. *(3D piles)*

**seajax / PivotViewer**
1. Sort and filter choreography: staging, durations, how items leave and arrive. *(transitions; object constancy)*
2. Deep Zoom Collection format: how a collection-wide pyramid survives layout change. *(sheets vs pyramids)*
3. Facet panel semantics: numeric histograms, string facets, counts. *(range filters)*

---

## Part 5 — Method

**Phase 0 — Setup (½ day).** Clone each subject at its pinned commit into
`<peer-study workspace>/<name>` (outside the wunderkammer repo). Record licence
and notice requirements. Write converters from our two real corpora (Music
Atlas 1,793 covers, Psychodeli Atlas 406 screenshots) plus the synthetic 10k
corpus (`scripts/perf-scale.mjs`) into each tool's input format, so every tool
sees the same images.

**Phase 1 — Run and measure (1 day).** Serve each tool on its own port. Drive
the same scenario set with an adapted copy of `scripts/perf.mjs`: boot, idle,
pan, zoom in/out, filter on/off, layout switch, open detail. Record frame
p95/max, long animation frames with script attribution, input-to-paint per
interaction, heap and DOM nodes, time to all images visible cold and warm.
Add the **GPU-pressure probe** that reproduced our page blink: screencast every
composited frame under `--force-gpu-mem-available-mb` at 96 / 192 / default and
count frames where chrome or content drops out. That one number compares
memory robustness across tools directly.

**Phase 2 — Read (1–2 days).** Answer Part 4 with file:line citations at the
pinned commit. Draw each tool's pipeline (data in → index → layout → render →
interaction) in the same notation so the diagrams compare.

**Phase 3 — Synthesise (½ day).** Fill Part 2's matrix, rescore Part 1's
rows, and produce a ranked **technique ledger**: technique, source, grade
(copy / port / idea / rule out), the wunderkammer file it would change, the
metric it should move, and its budget in `perf-budgets.json`.

**Parallelism.** Phases 0–2 split cleanly by peer: one read-only session per
peer, each on its own port range, no writes to wunderkammer. Phase 3 is one
session reading their reports.

## Deliverables

- `docs/PEER_STUDY.md`: findings per peer, the filled feature matrix, revised
  architecture tables, and the technique ledger.
- `scripts/peer-perf/`: converters and the adapted harness, so any later peer
  can be measured the same way.
- New TODO items for each **copy** or **port** grade, each with its target
  metric.
- PRECEDENTS.md updated with anything ruled out, so it is not re-studied.

## Licence hygiene

- MIT and BSD code may be copied with its notice; prefer porting small
  algorithms with credit over vendoring.
- `vikus-viewer-script` has no licence: read it, do not copy or closely port it.
- Do not read Plotlas or deepscatter source with intent to reimplement.
- Record the commit for every citation so a later reader can verify it.
