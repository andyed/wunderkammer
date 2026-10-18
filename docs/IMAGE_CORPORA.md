# Image archive instances

**Psychodeli Atlas** is the working title for the first imagery instance. The
broader product name remains open. It shares Wunderkammer's viewing code while using
its own configuration, metadata index, thumbnail cache and saved view state.

## Current local instance

- URL: `http://127.0.0.1:4174` (the original research wall stays on port 4173).
- Config: `.local/psychodeli-atlas/wunderkammer.config.json`.
- Source: `<image root>`.
- First inventory: 406 still images (405 PNG, one WebP), plus four excluded MOV
  files. Filename dates span November 2025 through April 2026.
- This is a Psychodeli-era desktop archive, **not a curated set consisting only
  of Psychodeli output**. It includes general browser and desktop screenshots.
  Other screenshot folders can be added as explicit roots after identification.

Originals remain on the mounted share, read-only. The generated index, 640-pixel
thumbnails and 1920-pixel detail previews live locally under `.local/` and are
ignored by Git. Opening an original reads it from the configured source root.
Cached browsing does not need the share; original access and rescanning do.

## Run and refresh

Copy the example config into its own
local instance directory and set the roots, title and port. Each root has a
stable id and an absolute path. Index/cache paths resolve beside the config.
Do not place derived output inside a source root.

```sh
# Pillow and numpy are required; use a Python environment containing both.
python3 scripts/index-images.py --config .local/psychodeli-atlas/wunderkammer.config.json
node serve.mjs --config .local/psychodeli-atlas/wunderkammer.config.json
```

The similarity map needs `umap-learn` at index time only (the indexer skips the
step and keeps the last coordinates without it). Re-project an existing index
from its cached overviews, without the source roots:

```sh
~/.local/bin/uv run --with umap-learn --with pillow --with numpy \
    python -I scripts/projection.py --config .local/psychodeli-atlas/wunderkammer.config.json
```

On Andy's machine the bundled Python is:
`python3`.

The indexer publishes atomic progress snapshots every 20 images. Reload the
browser to see the latest snapshot. Re-running uses size/mtime fingerprints and
cached previews; a changed analysis version can refresh attributes from the
local previews without re-reading full originals. Preview names are SHA-256
content hashes. Identical bytes share derivatives but retain separate file
occurrences. Stable item ids use root id plus relative path: a source edit keeps
its identity; a rename/move currently creates a new identity.

An unavailable root fails before replacing the last good index. Unreadable
images are reported; previously indexed records remain available. Missing files
are not automatically pruned, and old cached derivatives are not deleted.
Metadata is a scan-time snapshot, not a live filesystem monitor. There are no
writes to originals, EXIF or source sidecars, and no external classification API.

## Date is the primary navigation metadata

The adapter orders newest first; the initial grouping and first facet use
capture month. Year remains separately filterable. Dates are selected in order:

1. Embedded EXIF original capture date.
2. Explicit date/time in the filename, including macOS screenshot filenames and
   their narrow spaces before AM/PM.
3. Filesystem modification time, explicitly marked as an unverified fallback.

Precision and provenance are retained per image. A filename or EXIF time with
no timezone does not acquire an invented UTC offset. Modification time can
reflect a copy or export rather than capture. Month groups use chronological
order, not the number of items in each month.

## Inferred visual attributes

All inferred labels are provisional estimates. The complete scores, method
version and analysis region stay in `index.json`; the detail panel gives the
palette and a readable explanation. No labels are written back to source files.

| Attribute | Calculation | Interpretation / limit |
|---|---|---|
| Palette and color family | Six-color median-cut palette, color-family proportions | Includes UI and borders; families occupying at least 8% become facets |
| Kaleido | Centered polar RGB correlation at rotation orders 2, 3, 4, 5, 6, 8, 10 and 12, plus reflection | Kaleido / non-kaleido / uncertain; strong higher-order rotational evidence can qualify without reflection |
| Visual detail / complexity | Weighted edge density, luminance entropy and coarse RGB entropy | Low / medium / high sampled detail; not artistic complexity or quality |
| Compression savings | zlib level 6 over normalized RGB bytes versus raw bytes | Shows compressibility, not original PNG/JPEG file savings |
| Spatial compression gain | Same compression versus deterministically shuffled RGB pixels | Keeps color distribution while destroying spatial arrangement; a structure/redundancy cue |
| Pattern repetition | High-pass luminance autocorrelation over bounded horizontal, vertical and diagonal offsets | Weak / moderate / strong / uncertain translational evidence; distinct from rotational symmetry |

Feature analysis reads the cached 1920-pixel WebP preview. Palette sampling uses
at most 160 pixels per side, symmetry 320, and detail/compression/repetition 256.
Every resize preserves aspect ratio; smaller images are not upscaled. Compression
compares identical normalized pixel counts and palette distributions, with
`1 - compressedBytes / baselineBytes`; negative savings remain visible.

Smooth gradients can compress strongly without repeated motifs. Noisy images
can have high edge/entropy detail and little compressibility. A kaleidoscopic
image may show rotational repetition but weak translation. UI layouts may
repeat or appear symmetric; overlays, off-center artwork, untested symmetry
orders, aspect ratio and sampling resolution can affect the estimates.
Uniform/low-information images are uncertain rather than automatically kaleido.
Confidence is heuristic evidence strength, **not a calibrated probability**.

These heuristics need a representative human-labelled sample before any claim
of corpus-level classification accuracy. The first implementation provides
useful filters and evidence for that review, not ground-truth annotation.

## Checks

```sh
node --test tests/image-instance.test.mjs
python3 -m unittest discover -s tests -p 'test_image*.py'
npm test
```

Checks cover per-instance state paths, original-route containment and symlinks,
chronological month grouping, filename/AM-PM parsing, unchanged source bytes,
cache reuse, offline-index preservation, palette/color, blank and tiny images,
rotational patterns, smooth gradients, random noise and translational patterns.

## First-run evidence (2026-09-07)

All 406 images indexed with zero read errors. The final cache occupies about
164 MB. All records use `palette-symmetry-detail-v3` on cached previews; refreshing
the feature method reused all 406 cached records and finished in about 24 seconds.
The current inferred split is 101 kaleido candidates, 116 uncertain and 189
non-kaleido; this is algorithm output, not an accuracy result. 405 dates came from
filenames and one from filesystem mtime.

The JavaScript suite passed 34 tests and the Python image suite passed 16. After
sharing month grouping between flat and spatial views, six spatial/persistence
regressions passed. Live checks confirmed the 42-image April subset, 101-image
kaleido subset, visual-detail/color filtering, palette explanations, original
image HTTP 200, month-labelled spatial piles and no browser script errors.
The original research instance still serves 728 clips on port 4173.
