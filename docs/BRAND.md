# Mark and wordmark

The mark is one wall of the comparison page's aisle: a rack four tiles high
and three deep, in one-point perspective, receding toward the word. Each tile
has its own hue, as a wall of covers does. All but one are dimmed, as the
walls dim around a selection, and the lit one is gold. The word is
lowercase `wunderkammer`, as the package, repository and format prefix spell
it.

| File | Use |
|---|---|
| `wall/brand/mark.svg` | The rack alone, for dark grounds. The wall page shows it before the collection's own title. |
| `wall/brand/lockup-dark.svg` | Rack and word for dark grounds: the comparison page's header and the README in dark mode. |
| `wall/brand/lockup-light.svg` | Rack and word for light grounds: the README in light mode and npm. |
| `wall/brand/favicon.svg` | The rack on its own near-black ground, so a light or dark tab strip cannot swallow it. |

All four are outlined paths with no text, fonts or external references, so
they render the same wherever they are served. They ship in the npm package
under `wall/`.

## Colour

Tiles are chosen in OKLCH, lightness first: the dim tiles share one
lightness, so no hue jumps forward, and the lit tile sits far above them.
Their twelve hues are a golden angle (137.5°) apart, starting at 25°.

| | Dark ground (`#050510`, `#0d0d16`) | White |
|---|---|---|
| Word | `#f0f0f0`, 17.8:1 | `#050510`, 20.3:1 |
| Lit tile | gold `#ffd96c` (OKLCH 0.90 0.135 88°), 14.2:1 or more | amber `#a16100` (0.55 0.13 70°), 5.0:1 |
| Dim tiles | OKLCH 0.52 0.095, 3.4 to 3.9:1 | OKLCH 0.88 0.055, 1.4 to 1.5:1 |
| Lit against dim | 3.8:1 or more | 3.4:1 or more |

On white the dim tiles stay pale on purpose. A darker tile would come within
3:1 of the amber, and the one lit tile would stop leading. The word is set
in light grey, not a hue, so the tiles carry all of the mark's colour. The
mark no longer uses the interface's green accent, which belongs to controls.

## Type

[Geist](https://vercel.com/font) at weight 640 with +0.035 em tracking. The
word is a long run of minims (`u n m m`), and the tracking keeps them apart
at small sizes. Geist is licensed under the SIL Open Font License 1.1. The
glyphs are outlined into the SVGs, and no font file is distributed.

## Rebuilding

```bash
python3 scripts/build-brand.py --font /path/to/Geist-Variable.woff2
```

The script needs `fonttools`, `uharfbuzz` and `brotli`. Its output is
byte-identical from run to run. `tests/brand.test.mjs` checks the files and
both pages. Eight mutations in `scripts/check-mutations.mjs`
(`MUTATION_FILTER=brand`) each show a check failing.

The directions considered were a cabinet of unequal compartments, the full
hallway, an arched niche in the word's `m`, and three single-wall variants.
The full hallway read as ▶◀ at header size. A single wall with its tallest
edge beside the word resembled the Windows logo. The rack was chosen
(2026-10-18) for holding up from 128 px down to a 16 px favicon.

The first rack was grey with one green tile. Two other palettes were
considered: walnut and oxblood with a brass tile, after a curiosity
cabinet's wood, whose tiles fell to 2.7:1 on the page; and the comparison
page's six group colours.
