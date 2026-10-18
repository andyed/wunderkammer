# Music cover-art collections

Music Atlas uses the existing Survey / Review / Dive viewer for album artwork.
The local `music` adapter reads a derived index; requests never crawl the music
library. Albums can be searched by artist, album, track title and metadata, and
filtered/grouped by artist, tagged release year/decade, genre, color family,
and estimated visual detail. Existing cameras, detail resizing, context clusters
and permalinks apply to this separate instance.

## Setup

Copy `examples/music-atlas.config.json` into an ignored instance directory,
then adjust `musicRoots` and the port. Index and cache paths are relative to the
configuration. The example reads `<music root>` and serves port 4175.

```sh
python3 -m venv .local/music-env
.local/music-env/bin/pip install -r scripts/music-requirements.txt
mkdir -p .local/music-atlas
cp examples/music-atlas.config.json .local/music-atlas/wunderkammer.config.json
.local/music-env/bin/python scripts/index-music.py --config .local/music-atlas/wunderkammer.config.json
node serve.mjs --config .local/music-atlas/wunderkammer.config.json
```

The optional offline indexer uses Mutagen (GPL-2.0-or-later), Pillow and numpy;
Mutagen is not bundled into the browser or imported by the Node server. In this
workspace the bundled Python already provides Pillow/numpy; the local venv
inherits them via `--system-site-packages` and adds Mutagen 1.47.0.

The similarity map's coordinates come from `scripts/projection.py`, which needs
`umap-learn` (index time only; without it the indexer keeps the last
coordinates). It reads only the cached overviews, so it runs without the share:
`~/.local/bin/uv run --with umap-learn --with pillow --with numpy python -I
scripts/projection.py --config .local/music-atlas/wunderkammer.config.json`.

## Selection and identity

- Read MP3/ID3, MP4 (`.m4a`/`.m4p`), FLAC, Vorbis/Opus, WAV/AIFF and WMA
  metadata through Mutagen. Embedded extraction supports ID3 APIC, MP4 `covr`,
  FLAC pictures and Vorbis picture blocks. Legacy WMA embedded pictures and
  proprietary iTunes `.itc` caches are not decoded.
- Prefer an explicitly tagged front cover within an audio file. Associate
  nearby cover images only when their directory ancestry resolves to one
  album. Ignore obvious back/disc/booklet images as main covers. Inspect
  candidate dimensions; credible cover/front candidates outrank unnamed images,
  then resolution wins. Keep source filename and extraction provenance.
- One tile per normalized album artist + album title, hashed into a stable URN.
  Album artist falls back to track artist; compilation tags supply Various
  Artists when album artist is absent. Missing album names use folder names.
  Whitespace, Unicode normalization and case are ignored for identity.
- Copies and discs with the same identity share a tile; file counts, distinct
  track titles and source folders remain in details. Different releases with
  identical artist/title are currently merged; conflicting tagged years and
  genres remain multi-valued. Changing identity tags changes the URN.
- Identical artwork bytes share content-addressed local files and derivatives,
  even when different albums use the same image. The wall links to the extracted
  original artwork. It does not stream audio or change music tags.
- Years are tagged release years, never filesystem dates. Unknown dates stay
  unknown; no synthetic captured date is assigned. Color/detail are estimates.

## Cache and refresh

The indexer reads source files and writes only beneath the local instance:
`index-tracks.json` checkpoints tag reads, `index.json` contains album records
and the missing-art/error report, and `cache/` contains extracted artwork,
128px overview images, 640px review thumbnails and 1920px previews.
The flat wall supplies the transformed tile width to responsive image selection;
opening an album still uses its large detail preview. Unchanged size/mtime signatures reuse
cached tags and art. Re-run the indexer to refresh, then reload the wall.

An unavailable root or incomplete directory scan fails before replacing the
album index. A complete new index is published atomically; the previous wall
stays usable during indexing. Per-file failures are reported, with last-good
track metadata retained when available. Removed files are omitted on a successful
refresh; cached media is not garbage-collected. The local index/previews remain
browsable with the network drive disconnected. No source images, audio files,
Music databases, iTunes databases, or tags are edited.

Albums with no usable artwork are listed under `withoutArtwork`, not padded
with invented covers. Unmatched artwork and booklet scans do not each become
album tiles. This is a cover-art browser, not a complete media-library catalog.

## Verification

```sh
.local/music-env/bin/python -m unittest discover -s tests -p 'test_music_index.py'
node --test tests/music-instance.test.mjs tests/image-instance.test.mjs
.local/music-env/bin/python scripts/check-music-mutations.py
node scripts/check-music.mjs  # running Music Atlas; screenshots in .local/music-atlas
```

Fixtures exercise actual WAV/ID3 tag containers, front/back selection,
sidecar fallback, duplicate-album identity, shared artwork, read-only source
hashes, cache reuse, unavailable-root preservation, MP4 tag extraction,
release-year facets and track-title search. Live rendered checks use the actual
Music Atlas collection, including fresh-context URL restoration.


## Local library run, 2026-09-07

`<music root>` supplied 11,909 audio files and 3,356 separate images.
The resulting collection has 1,793 album covers across 1,065 tagged album artists;
777 other album identities have no usable cover from supported sources. Artwork
came from 786 explicit embedded fronts, 576 other embedded covers and 431 cover
files. Two MP3 containers could not be parsed and one cached embedded JPEG was
truncated. Details remain in `.local/music-atlas/import-report.md` and the index.

The live browser proof restored a Talking Heads search and focused album in a
fresh context, checked narrow-screen details and keyboard opening, and decoded
all 1,803 rendered image occurrences (multi-year albums can occur in more than
one decade). The initial 640px-only overview exposed decoder failures despite
successful downloads; the small overview tier removed the blank cells. Proof
images and the copied URL are in `.local/music-atlas/`.
