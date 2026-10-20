<h1><picture><source media="(prefers-color-scheme: dark)" srcset="wall/brand/lockup-dark.svg"><img alt="wunderkammer" src="wall/brand/lockup-light.svg" width="420"></picture></h1>

[![Cats. Lots of cats.: one cat in the detail view, then racks of cats rush out of a white void and lock into a hallway in Wunderkammer's aisle view](docs/screenshots/cats-reel.webp)](docs/screenshots/cats-reel.mp4)

**Cats. Lots of cats.** 489 cats in one collection document, shown in the wall,
the hallway, a facet, the colour space and a comparison. The cats were generated
with Adobe Firefly. [Watch the full reel (28 s, MP4)](docs/screenshots/cats-reel.mp4).

A collection explorer for people and language models. A model writes a
collection of images as one JSON document. A person pans, zooms, filters by
facets, groups, compares groups side by side, and opens any item. The model can
attach claims about a comparison, each pointing at the exact items behind it,
and can read back what the person selected as exact evidence. It runs from
static files with no server.

**[Open the live demo →](https://andyed.github.io/clipwall-demo/)** 297 frames from the Psychodeli
visualizer, served as static files from GitHub Pages. Each link opens a
different view of the same collection:

- **[The wall](https://andyed.github.io/clipwall-demo/)**: every frame, grouped by capture month. The overview
  paints from 3 sprite-sheet images instead of 297 files.
- **[One facet](https://andyed.github.io/clipwall-demo/?facet.kaleido=kaleido&group=year)**: the 89 kaleidoscopic
  frames, grouped by year. The rest stay reachable as context when you zoom
  out.
- **[The hallway](https://andyed.github.io/clipwall-demo/?view=aisle&group=year)**: one rack per year. Walk it
  with the slider, drag to look around, and select a frame to open it.
- **[The warehouse](https://andyed.github.io/clipwall-demo/?view=warehouse&group=color)**: the hallway arriving.
  Rows of racks, one per colour family, rush out of a white void; then the
  lights go down and you are in the hallway, ready to browse.
- **[In 3D](https://andyed.github.io/clipwall-demo/?view=float&arrange=axes&across=captured&up=lightness&depth=hue)**:
  what the **3D** button opens. Capture date runs across, lightness up and hue
  in depth, so each frame's colour sits on the collection's timeline. Change
  any axis from the menus.
- **[The colour space](https://andyed.github.io/clipwall-demo/?view=float&arrange=oklch)**: every frame floats at
  its dominant colour, with hue around the ring and lightness up. Click one
  to fly to it.
- **[Stacks](https://andyed.github.io/clipwall-demo/?view=3d&group=year)**: each year as a stack you can
  open and spread. Stacks is the last arrangement under 3D.

> [!TIP]
> **Your own photos.** On a Mac, two commands turn an Apple Photos library
> into a wall of one subject: a pet, a person, a trip. It reads Photos
> read-only, keeps a tidy 150 and arrives as the image warehouse ("Biscuit.
> Lots of Biscuit."). See [Try it with your own photos](#try-it-with-your-own-photos).

**Status: early public release (0.2).** The interfaces below are versioned and
validated. The renderer is tested in desktop and mobile Chromium; physical
devices and other browsers have had less coverage.

## What it's for

### 1. A model makes a claim you can check

The model writes a collection and a comparison, and attaches observations that
cite exact cells. The page shows each claim's text beside figures it computes
itself. Selecting one lights its evidence in the matrix and on the walls.

![Two observations about kaleidoscopic frames in 2025 and 2026. The selected one cites 89 items, which stay lit on the walls while the rest dim.](docs/screenshots/1-claims.webp)

### 2. Explore a large image collection

Survey everything at once, filter with facets that show their counts, then
open an item and come back to where you were.

![297 frames grouped by capture month, with facet counts in the rail.](docs/screenshots/2-explore.webp)

### 3. Keep a reference board for a creative project

Clippings and captures sit together, faceted by what they're evidence of. Open
one and read its notes without losing the board.

![Renderer captures and simulation fields grouped by evidence type, with one capture open in the detail pane.](docs/screenshots/3-reference.webp)

### 4. Browse your own library at scale

`serve.mjs` reads a music or photo folder and serves it as a live collection,
with saved piles and links.

![A music library of 1,793 albums at overview scale, grouped by release decade.](docs/screenshots/4-library.webp)

### 5. Work through an archive

Documents rather than art: clippings grouped by publication period, filtered
to the years in question.

![153 newspaper clippings from 1819 to 1920, grouped by publication period.](docs/screenshots/5-archive.webp)

### 6. Pivot a collection on the dimension you choose

Choose a dimension and every image floats in 3D at its place along it.
Choose another and the same images travel to their new places, so one item
can be followed from arrangement to arrangement. **3D** opens Axes, where each
axis takes a dimension of its own: the lightness, chroma or hue of the
colour, or an attribute such as capture date, year or a facet. It starts with
the collection's time across, lightness up and hue in depth, which the wall's
groups do not show. The other arrangements place an image by its dominant
colour (OKLab, OKLCH or HSL) or its title (A–Z), and Stacks piles each group.
With a search or facets set, the images outside the scope dim in place and
nothing moves. Click an image to fly to it and open it.

![The bundled example's 297 frames pivoted on colour, in OKLCH: hue around a ring labelled from red to magenta, lightness from 0.00 at the bottom to 0.85 at the top.](docs/screenshots/6-colour.webp)

Live link, with the example served as in [Try it](#try-it):
`http://localhost:8080/?collection=/examples/psychodeli/collection.json&view=float&arrange=oklch`

Shots 1, 2 and 6 show the bundled example; 3–5 are local collections run on
the same engine.

## Try it

```bash
git clone https://github.com/andyed/wunderkammer && cd wunderkammer
npx http-server -p 8080 .
```

Then open:

- `http://localhost:8080/?collection=/examples/psychodeli/collection.json`
  for the wall. Search, choose facets, group, press **3D**, or open an item.
- `http://localhost:8080/wall/compare.html?collection=/examples/psychodeli/collection.json&observations=/examples/psychodeli/observations.json`
  for a comparison with two observations. Select one to see the items behind
  it.

To take a still of a view for a slide or a document, after `npm install`:

```bash
node scripts/still.mjs --collection examples/psychodeli/collection.json --view 'view=float&arrange=axes' --out axes.png
```

It writes `axes.png` and `axes.json`, which records the exact link, the
camera and the items shown. [SHOTS.md](docs/SHOTS.md) has the details and
the roadmap.

To render the warehouse as a video, the same frames `?view=warehouse` plays
(it needs ffmpeg):

```bash
node scripts/warehouse-video.mjs --collection examples/psychodeli/collection.json --view 'group=color' --walk 3 --out warehouse.mp4
```

[AISLE.md](docs/AISLE.md#the-warehouse) has the options.

### Try it with your own photos

On a Mac, a wall of your dog, your kids or a trip takes two commands. With
[osxphotos](https://github.com/RhetTbull/osxphotos) installed
(`uv tool install osxphotos`):

```bash
python3 scripts/photos-collection.py --caption dog --label Dog --animal dog --alone --title 'Biscuit' --item Biscuit --items Biscuit --out ~/biscuit-wall
node scripts/show-collection.mjs ~/biscuit-wall/collection.json
```

It reads the Photos library read-only and keeps about 150 photos. It leaves
out screenshots, photos other people shared and pictures where the dog is a
speck, and keeps one of each burst. Every stretch of time stays represented.
The images it writes carry no location. `show-collection.mjs` prints the
wall's link and the warehouse's ("Biscuit. Lots of Biscuit."). [APPLE_PHOTOS.md](docs/APPLE_PHOTOS.md)
has the options.

The example's 297 images are low-resolution screenshots from the Psychodeli
visualizer, served from the public demo site with CORS. The collection
document names 16 sprite-sheet pages there, of which the overview needs
three, and keeps each image's own file as the fallback. The repository holds
only the document.

## For language models

Wunderkammer is best used from [muriel](https://github.com/andyed/muriel),
a design skill for coding agents. muriel decides when a collection explorer
is the right way to show something, builds the document from a folder or a
CSV, and reviews the result for exploration quality and contrast.

Without muriel, agents start with the skill,
[skills/wunderkammer/SKILL.md](skills/wunderkammer/SKILL.md): when to use
Wunderkammer, the steps from document to link, and the traps. Install it with
`npx skills add andyed/wunderkammer`, or copy the folder into your agent's
skills directory. Either way, before handing over a link, check the
document, and any observations, the way the pages will read them:

```bash
node scripts/validate-collection.mjs collection.json --observations observations.json
```

It lists every problem with its path, every local cover file that is missing,
and the figures each observation will show, and exits 1 when anything needs
fixing.

The full contract is in [docs/CONTRACT.md](docs/CONTRACT.md). In short:

1. **Collection document** (`wunderkammer.collection`, version 1): items with
   an id, title, cover image, and attributes in `props`. A strict validator
   lists every problem with its path, so a model's first draft fails loudly.
   Covers can be one file each or cells of a few sprite sheets;
   `python3 scripts/collection-sheets.py <collection.json>` packs them.
2. **Comparison recipe**: 2–6 groups, a measured attribute, and counts or
   shares.
3. **Observations** (`wunderkammer.observations`): claims that cite matrix
   cells or items. The page shows the claim's text beside figures it computes
   itself. A claim cannot supply its own numbers.
4. **Hand-back**: `window.wunderkammer.export()` returns the person's scope,
   focus, highlight and the exact items, as identities and titles.

To embed the wall in another page:

```js
import * as Wunderkammer from './wall/embed.mjs';
const wall = Wunderkammer.mount(element, collection);   // an object or a URL
await wall.ready;
```

## Running it over your own files

`serve.mjs` serves a live collection from an Obsidian vault, a TiddlyWiki, an
image folder or a music library, with saved piles and compact links. Copy a
template from `examples/` to `wunderkammer.config.json`, fill in your paths,
and run:

```bash
npm install
npm start            # http://127.0.0.1:4173
```

Image and music collections need the Python indexers in `scripts/`
(`scripts/music-requirements.txt`). See [docs/IMAGE_CORPORA.md](docs/IMAGE_CORPORA.md)
and [docs/MUSIC_CORPORA.md](docs/MUSIC_CORPORA.md).

## How it renders

The 3D view (Stacks in 3D) splits the work between WebGL and HTML, by what
each item needs at its distance:

| Tier | Items | Drawn as | Carries |
|---|---|---|---|
| Far | the whole collection | instanced GPU quads from one atlas of 64-px tiles | colour and shape |
| Near | a pool of about 256 | larger atlas slots | a recognizable image |
| Promoted | a pool of about 14 | real HTML cards over the canvas | selectable text, links, keyboard focus |

The GPU carries the crowd and HTML carries the few items you are reading, so
the number of live HTML cards in the 3D view stays fixed as the collection
grows. In the floating space, items are drawn from the same two kinds of
atlas, with 64 near slots, and none is promoted: an item opens in the detail
pane. A search or facet is a mask over the field: items outside it dim or
hide in place, and the far atlas is kept.

The flat wall paints its overview from a few sprite-sheet images (3 pages
instead of 297 files for the demo) and switches to HTML tiles at a reading
zoom. Its HTML tiles are not pooled, so its page cost still grows with the
collection. The trade-offs, limits and measured numbers are in
[docs/SPATIAL.md](docs/SPATIAL.md#why-a-hybrid-renderer) and
[docs/PERF.md](docs/PERF.md).

**How big a collection.** Wunderkammer is at its best under about 2,000
items. There, filtering and regrouping the flat wall take under 50 ms and
zooming out about a quarter of a second, and the floating space's median
frame at 1,793 items is 8.3 ms (120 fps). The 3D stacks and the floating
space draw from a far atlas of 4,096 tiles, so past 4,096 items the rest get
no tile. The flat wall still pans smoothly at 10,000, but zooming out takes
about a second and a filter about a fifth of one. Above about 10,000, split
the collection into several documents. The validator accepts up to 50,000
items; that is a format limit, not a recommendation. The measurements are in
[docs/PERF.md](docs/PERF.md#scale-sweep-synthetic-corpora-from-the-psychodeli-index-headless).

## Design

- [Philosophy](docs/PHILOSOPHY.md): useful motion, trustworthy context.
- [Product](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md),
  [precedents](docs/PRECEDENTS.md).
- [Peer study](docs/PEER_STUDY.md): measured comparisons with six open-source
  collection explorers.
- [Naming](docs/NAMING.md).

Three.js loads from jsDelivr.

## Related projects

[muriel](https://github.com/andyed/muriel), a design skill for coding agents by
the same author, supplies the spatial view's rendering primitives. They are
vendored in `wall/spatial/lib/`; see its `VENDOR.md`.

Other open-source collection explorers, compared in the
[peer study](docs/PEER_STUDY.md). Licences were read from each project's
LICENSE file in October 2026.

- [VIKUS Viewer](https://github.com/cpietsch/vikus-viewer) (MIT): timeline and
  similarity layouts for cultural collections, as a static site.
- [PixPlot](https://github.com/pleonard212/pix-plot) (MIT): WebGL atlases of
  large image collections laid out by similarity.
- [Collection Space Navigator](https://github.com/Collection-Space-Navigator/CSN)
  (MIT): projections with range and text filters over image collections.
- [Embedding Atlas](https://github.com/apple/embedding-atlas) (MIT):
  cross-filtered views of millions of points, with an MCP server for agents.
- [Piling.js](https://github.com/flekschas/piling.js) (MIT): interactive piles
  of small multiples.
- [seajax](https://github.com/seajax/seajax) (BSD), an open-source clone of
  Microsoft's PivotViewer and the ancestor of faceted zooming over image
  collections.

## Tests

```bash
npx playwright install chromium
npm test                          # unit and browser tests
node scripts/check-public.mjs     # the public-tree gate
npm run test:mutations            # proves selected checks fail when their protection is removed
```

One browser test, Canary A2 in `tests/spatial-drawable.test.mjs`, fails. It
covers an experimental HTML-in-canvas path behind a flag. CI runs the gate
until it is fixed.

## License

MIT. See [LICENSE](LICENSE).
