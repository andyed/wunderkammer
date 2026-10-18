/** Read the overview sprite-sheet map that scripts/sheets.py bakes beside an
 * image cache, and answer "where is this cover in each level".
 *
 * A missing, unreadable or foreign-version map is not an error: the wall then
 * loads per-file covers exactly as it did before sheets existed. Slots are
 * keyed by the cover's content hash, so a cover re-indexed after the last bake
 * has no slot and falls back on its own. */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const VERSION = 1;
const cache = new Map();

const media = relative => '/media/' + relative.split('/').map(encodeURIComponent).join('/');

/** Returns `sha256 → [[sheet, x, y, w, h], …]` (one entry per level that holds
 * the cover), or null when the cache has no usable map. `sheet` objects are
 * shared between clips so the server can intern them into one list. */
export async function loadSheetSlots(imageCache) {
  if (!imageCache) return null;
  const file = path.join(imageCache, 'sheets.json');
  let info;
  try { info = await stat(file); } catch { return null; }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.lookup;
  let map;
  try { map = JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
  let lookup = null;
  if (map?.version === VERSION && Array.isArray(map.levels)) {
    const bySha = new Map();
    for (const level of map.levels) {
      const sheets = (level.sheets || []).map(s => ({ src: media(s.file), edge: level.edge, width: s.width, height: s.height }));
      for (const [sha, slot] of Object.entries(level.slots || {})) {
        const sheet = sheets[slot[0]];
        if (!sheet) continue;
        if (!bySha.has(sha)) bySha.set(sha, []);
        bySha.get(sha).push([sheet, slot[1], slot[2], slot[3], slot[4]]);
      }
    }
    lookup = bySha;
  }
  cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, lookup });
  return lookup;
}

/** Replace each clip's sheet references with indices into one shared list,
 * so a page's URL and size travel once instead of once per cover. Mutates the
 * clips; returns the list (empty when no clip carries slots). */
export function internSheets(clips) {
  const sheets = [], index = new Map();
  for (const clip of clips) {
    if (!Array.isArray(clip.sheetSlots)) continue;
    clip.sheetSlots = clip.sheetSlots.map(([sheet, x, y, w, h]) => {
      if (typeof sheet === 'number') return [sheet, x, y, w, h];
      if (!index.has(sheet)) { index.set(sheet, sheets.length); sheets.push(sheet); }
      return [index.get(sheet), x, y, w, h];
    });
  }
  return sheets;
}
