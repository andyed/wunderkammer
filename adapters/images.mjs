/** Read a derived image index; never scan or write the network corpus on requests. */
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadSheetSlots } from '../lib/sheets.mjs';
export const id = 'images';
export const mediaRoot = config => config.imageCache;
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');

/** Rendered width of a derivative whose longest side is `size`, in source pixels. */
const widthAt = (image, size) => Math.max(1, Math.round(image.width * Math.min(1, size / Math.max(image.width, image.height))));

export async function loadClips(config) {
  const index = JSON.parse(await readFile(config.imageIndex, 'utf8'));
  const sheets = await loadSheetSlots(config.imageCache);
  return index.images.map(image => {
    const original = `/original/${encodeURIComponent(image.rootId)}/${encodePath(image.relativePath)}`;
    const k = image.features.kaleido;
    const v = image.features.visualAttributes;
    const palette = image.features.palette.map(c => c.hex);
    const props = {
      corpus: config.corpusName || 'image archive',
      dims: [`${image.width}x${image.height}`],
      year: image.captured.slice(0, 4),
      dateSource: image.dateSource,
      kaleido: k.label,
      color: image.features.colorFamilies.filter(c => c.fraction >= 0.08).map(c => c.name),
      complexity: v?.detail.label || 'unknown',
      repetition: v?.repetition.label || 'unknown',
      compression: !v ? 'unknown' : v.compression.rawSavings < 0.2 ? 'under 20%'
        : v.compression.rawSavings < 0.5 ? '20–50%' : v.compression.rawSavings < 0.8 ? '50–80%' : '80% or more',
    };
    const notes = [
      `Color families: ${props.color.join(', ')}`, 
      `Original: ${image.relativePath}`,
      `Capture date: ${image.captured} (${image.dateSource}; ${image.datePrecision})`,
      `Palette: ${palette.join(' · ')}`,
      `Kaleido estimate: ${k.label}. ${k.reason}`,
    ];
    if (v) notes.push(
      `Visual detail: ${v.detail.label} (${v.detail.score.toFixed(3)}). ${v.detail.reason}`,
      `Repetition: ${v.repetition.label} (${v.repetition.score.toFixed(3)}). ${v.repetition.reason}`,
      `Compression savings: ${(100 * v.compression.rawSavings).toFixed(1)}% vs raw; ${(100 * v.compression.shuffleSavings).toFixed(1)}% vs shuffled pixels.`,
      'These are inferred visual attributes, not reviewed labels or measures of artistic quality.'
    );
    return {
      id: image.id, title: image.captured.slice(0, 19).replace('T', ' · '),
      url: `urn:clipwall:image:${image.id}`, sourceUrl: original, sourceLabel: 'Open original ↗',
      source: image.rootId, captured: image.captured, kind: 'image', tags: [], props,
      // Overview first: the flat wall picks by screen width through srcset and
      // the spatial atlas by tier, so an overview never decodes a 640 px file.
      cover: `/media/${encodePath(image.overview || image.thumbnail)}`,
      coverVariants: image.overview ? [
        { src: `/media/${encodePath(image.overview)}`, width: widthAt(image, 128) },
        { src: `/media/${encodePath(image.thumbnail)}`, width: widthAt(image, 640) },
      ] : [],
      media: [{ src: `/media/${encodePath(image.preview)}` }],
      // Where this cover sits in the baked overview pages (lib/sheets.mjs).
      ...(sheets?.has(image.sha256) ? { sheetSlots: sheets.get(image.sha256) } : {}),
      detailCover: `/media/${encodePath(image.preview)}`,
      // Similarity-map point in [-1, 1] (scripts/projection.py); the wall's
      // similarity arrangement reads x and y (map) and col and row (grid), whatever method made them.
      ...(image.projection ? { projection: { x: image.projection.x, y: image.projection.y, col: image.projection.col, row: image.projection.row } } : {}),
      palette, note: notes.join('\n'),
    };
  }).sort((a, b) => b.captured.localeCompare(a.captured) || a.id.localeCompare(b.id));
}

/** Only configured image roots, image extensions, and resolved in-root files. */
export async function originalPath(config, route) {
  const slash = route.indexOf('/');
  if (slash < 0) return null;
  const rootId = decodeURIComponent(route.slice(0, slash));
  const root = config.imageRoots?.find(r => r.id === rootId);
  if (!root) return null;
  const relative = decodeURIComponent(route.slice(slash + 1));
  if (!/\.(png|jpe?g|webp|gif|avif|tiff?|bmp)$/i.test(relative)) return null;
  const base = await realpath(root.path);
  const file = await realpath(path.resolve(base, relative));
  return file.startsWith(base + path.sep) ? file : null;
}
