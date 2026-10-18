/** Album covers and metadata from a local derived index. No audio/library writes. */
import { readFile } from 'node:fs/promises';
import { loadSheetSlots } from '../lib/sheets.mjs';
export const id = 'music';
export const mediaRoot = config => config.imageCache;
const media = relative => '/media/' + relative.split('/').map(encodeURIComponent).join('/');

export async function loadClips(config) {
  const index = JSON.parse(await readFile(config.imageIndex, 'utf8'));
  const sheets = await loadSheetSlots(config.imageCache);
  return index.albums.map(album => {
    const cover = album.cover, features = album.features;
    const widthAt = size => Math.max(1, Math.round(cover.width * Math.min(1, size / Math.max(cover.width, cover.height))));
    const props = {
      corpus: config.corpusName || 'Music library', artist: album.artist,
      genre: album.genres, year: album.years,
      decade: [...new Set(album.years.map(year => `${Math.floor(Number(year) / 10) * 10}s`))],
      color: features.colorFamilies.filter(c => c.fraction >= 0.08).map(c => c.name),
      complexity: features.visualAttributes?.detail.label || 'unknown',
      artworkSource: cover.provenance,
      dims: [`${cover.width}x${cover.height}`],
    };
    return {
      id: album.id, url: `urn:clipwall:album:${album.id}`,
      title: `${album.artist} — ${album.album}`, source: album.artist,
      kind: 'album', captured: '', tags: [], props,
      // Structured identity for listening links and, later, local playback.
      artist: album.artist, album: album.album, tracks: album.tracks.slice(), locations: album.locations.slice(),
      cover: media(cover.overview || cover.thumbnail), detailCover: media(cover.preview),
      coverVariants: cover.overview ? [
        { src: media(cover.overview), width: widthAt(128) },
        ...(widthAt(640) > widthAt(128) ? [{ src: media(cover.thumbnail), width: widthAt(640) }] : []),
      ] : [],
      media: [{ src: media(cover.preview) }],
      // Where this cover sits in the baked overview pages (lib/sheets.mjs).
      ...(sheets?.has(cover.sha256) ? { sheetSlots: sheets.get(cover.sha256) } : {}),
      sourceUrl: media(cover.original), sourceLabel: 'Open cover artwork ↗',
      // Similarity-map point in [-1, 1] and grid cell (scripts/projection.py).
      ...(album.projection ? { projection: { x: album.projection.x, y: album.projection.y, col: album.projection.col, row: album.projection.row } } : {}),
      palette: features.palette.map(color => color.hex),
      note: [
        `Artist: ${album.artist}`, `Album: ${album.album}`,
        `Tagged release year: ${album.years.join(', ') || 'unknown'}`,
        `Genre: ${album.genres.join(', ') || 'unknown'}`,
        `Track artists: ${album.trackArtists.join(', ')}`,
        `${album.fileCount} audio files; ${album.tracks.length} distinct track titles.`,
        `Artwork: ${cover.provenance} · ${cover.width}×${cover.height}`,
        `Artwork source: ${cover.source}`,
        `Metadata: ${album.metadataSources.join(', ')}`,
        `Locations:\n${album.locations.join('\n')}`,
        `Tracks:\n${album.tracks.join('\n')}`,
        'Color and visual detail are estimates. Release years come from tags, not file dates.',
      ].join('\n'),
    };
  }).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
