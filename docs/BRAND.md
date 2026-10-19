# Mark and wordmark

The mark is one wall of the comparison page's aisle: a rack four tiles high
and three deep, in one-point perspective, receding toward the word. One tile
is lit and the rest are dim, as the walls show a selection. The word is
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

| | Dark ground (`#050510`, `#0d0d16`) | White |
|---|---|---|
| Word | `#f0f0f0`, 17.8:1 | `#050510`, 20.3:1 |
| Lit tile | `#aaffaa`, 17.0:1 | `#1d8a3a`, 4.4:1 |
| Dim tiles | `#5c5c80`, 3.2:1 on `#050510` and 3.0:1 on `#0d0d16` | `#b0b0c4`, 2.1:1 |

On white the dim tiles stay below 3:1 on purpose. A darker grey would sit
within 1.4:1 of the green, and the one lit tile would stop leading. The word
is set in light grey rather than the accent green, so the lit tile is the
mark's only green.

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
both pages. Seven mutations in `scripts/check-mutations.mjs`
(`MUTATION_FILTER=brand`) each show a check failing.

The directions considered were a cabinet of unequal compartments, the full
hallway, an arched niche in the word's `m`, and three single-wall variants.
The full hallway read as ▶◀ at header size. A single wall with its tallest
edge beside the word resembled the Windows logo. The rack was chosen
(2026-10-18) for holding up from 128 px down to a 16 px favicon.
