#!/usr/bin/env python3
"""Bake overview sprite sheets: every cover at a few coarse sizes, packed into
a handful of large WebP pages, plus a slot map from cover hash to rectangle.

Why (docs/PERF.md, "Overview sheets"): HTTP caching already serves ~97% of
covers from the browser cache on a warm reload, yet showing every image on the
Music Atlas took 5-8 s, because the overview still asked for ~1,800 separate
files and decoded each one. Scrutinizer's mip chain keeps every level in one
texture and picks per pixel; this is the same idea for the flat overview. The
wall decodes two or three pages instead of 1,800 files, and the per-file
variants stay for the reading tiers.

Pages are named by the SHA-256 of their bytes, so the server marks them
immutable and a rebake can never serve a stale page. Slots are keyed by the
cover's own content hash, so a cover that changed since the last bake simply
has no slot and falls back to its per-file variant.

Run after indexing (both indexers call bake()), or alone:
  python3 scripts/sheets.py --config .local/music-atlas/wunderkammer.config.json
"""

import argparse
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import tempfile

import numpy as np
from PIL import Image

VERSION = 1
# Longest edge per level, in pixels. 32 carries a 10k-item overview (tiles
# ~22 device px), 64 the Music Atlas at fit (~54), 128 the overview's largest
# tiles before the DOM reading tier takes over.
LEVELS = (32, 64, 128)
# Edge-replicated border around each cover, so bilinear and mipmapped sampling
# at a slot's edge reads the cover's own edge pixels, never a neighbour's.
GUTTER = 2
# Page edge. 4096 is the largest every implementation accepts, but a page is
# one GPU texture, uploaded whole on first draw and again after eviction: with
# 4096-px pages a Music Atlas zoom-out had frame p95 83 ms, with 2048-px pages
# 43 ms (HEAD without sheets: 43 ms). Headed Chrome, median of 3, 2026-10-13.
PAGE_MAX = 2048
QUALITY = 82


def _atomic_write(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=file.parent, suffix=file.suffix)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, file)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def _padded(image):
    """The cover with GUTTER pixels of its own edge replicated on every side."""
    return Image.fromarray(np.pad(np.asarray(image), ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode='edge'))


def _level(covers, edge):
    """Pack one level. Cells are square (edge + gutter) so packing is a grid;
    a non-square cover leaves part of its cell unused, which costs pixels but
    keeps every slot addressable from its index alone."""
    cell = edge + 2 * GUTTER
    per_row = PAGE_MAX // cell
    per_page = per_row * per_row
    pages, slots = [], {}
    for first in range(0, len(covers), per_page):
        chunk = covers[first:first + per_page]
        rows = -(-len(chunk) // per_row)
        width = min(len(chunk), per_row) * cell
        page = Image.new('RGB', (width, rows * cell), (5, 5, 16))
        placed = []
        for i, (digest, image) in enumerate(chunk):
            small = image.copy()
            small.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            x, y = (i % per_row) * cell, (i // per_row) * cell
            page.paste(_padded(small), (x, y))
            placed.append((digest, x + GUTTER, y + GUTTER, small.width, small.height))
        buffer = BytesIO()
        page.save(buffer, 'WEBP', quality=QUALITY, method=4)
        data = buffer.getvalue()
        name = f'{sha256(data).hexdigest()}.webp'
        pages.append({'file': f'sheets/{name}', 'width': page.width, 'height': page.height, 'bytes': len(data), 'data': data})
        for digest, x, y, w, h in placed: slots[digest] = [len(pages) - 1, x, y, w, h]
    return pages, slots


def bake(cache, entries):
    """entries: (cover sha256, path of its overview thumbnail relative to cache).
    Writes cache/sheets/*.webp and cache/sheets.json; returns the map."""
    cache = Path(cache)
    covers, seen = [], set()
    for digest, relative in sorted(entries):
        if digest in seen or not relative: continue
        seen.add(digest)
        try:
            with Image.open(cache / relative) as source: covers.append((digest, source.convert('RGB')))
        except Exception as error:
            print(f'sheets: skipped {relative}: {error}', flush=True)
    result = {'version': VERSION, 'gutter': GUTTER, 'count': len(covers), 'levels': []}
    keep = set()
    for edge in LEVELS:
        pages, slots = _level(covers, edge)
        for page in pages:
            target = cache / page['file']
            if not target.exists(): _atomic_write(target, page.pop('data'))
            else: page.pop('data')
            keep.add(target.name)
        result['levels'].append({'edge': edge, 'sheets': pages, 'slots': slots})
    _atomic_write(cache / 'sheets.json', json.dumps(result, separators=(',', ':')).encode())
    # Pages from earlier bakes are unreachable once the map is replaced. A
    # browser that cached one still holds its own copy; the server need not.
    for old in (cache / 'sheets').glob('*.webp'):
        if old.name not in keep: old.unlink()
    total = sum(p['bytes'] for level in result['levels'] for p in level['sheets'])
    print(f"Sheets: {len(covers)} covers; " + ', '.join(f"{l['edge']}px {len(l['sheets'])} page(s)" for l in result['levels'])
          + f'; {total / 1048576:.1f} MB', flush=True)
    return result


def entries_from_index(index):
    """Cover hashes and overview thumbnails from either indexer's output."""
    if 'albums' in index:
        return [(a['cover']['sha256'], a['cover'].get('overview') or a['cover'].get('thumbnail')) for a in index['albums']]
    return [(i['sha256'], i.get('overview') or i.get('thumbnail')) for i in index.get('images', [])]


def bake_config(config_file):
    config_file = Path(config_file).resolve()
    config = json.loads(config_file.read_text())
    cache = (config_file.parent / config['imageCache']).resolve()
    index = json.loads((config_file.parent / config['imageIndex']).resolve().read_text())
    return bake(cache, entries_from_index(index))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--config', type=Path, help='an instance config (imageIndex + imageCache)')
    parser.add_argument('--index', type=Path, help='an index file, with --cache; for fixtures such as perf-scale')
    parser.add_argument('--cache', type=Path)
    args = parser.parse_args()
    if args.config: bake_config(args.config)
    elif args.index and args.cache: bake(args.cache, entries_from_index(json.loads(args.index.read_text())))
    else: parser.error('give --config, or --index and --cache')
