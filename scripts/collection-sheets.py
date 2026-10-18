#!/usr/bin/env python3
"""Pack a collection document's covers into a few sprite sheets, so the
document ships a handful of images instead of one file per item.

Reads a `wunderkammer.collection`, fetches or reads each clip's cover, packs
every cover at a few sizes into WebP pages, and writes the document back with
top-level `sheets` and per-clip `sheetSlots` (docs/CONTRACT.md, "Sprite
sheets"). Each clip keeps its `cover`, which the wall loads only if a cell's
page fails, so a document works before its pages are published. When the
largest level holds every cover at full size, the document is marked
`images.sheets: "covers"` and every view reads cells; otherwise the cells feed
only the overview. --drop-covers removes the cover files instead.

Pages go in sheets/ beside the document, or in --sheets-dir, and the document
names them relative to itself, or under --sheets-url when they will be hosted
elsewhere.

Shares sheets.py's page rules: an edge-replicated gutter around each cell, so
sampling at a cell's edge never reads a neighbour; 2048-px pages, one GPU
texture each; pages named by the SHA-256 of their bytes, so a rebuild never
serves a stale page. Unlike sheets.py, cells keep their cover's aspect (shelf
packing), because a collection of screenshots is landscape and square cells
would leave 44% of every page empty but still decoded.

  python3 scripts/collection-sheets.py site/collection.json
  python3 scripts/collection-sheets.py examples/psychodeli/collection.json \
      --sheets-dir ../staging/sheets --sheets-url https://example.org/demo/sheets/
"""

import argparse
import base64
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import urllib.parse
import urllib.request

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sheets import GUTTER, PAGE_MAX, QUALITY, _atomic_write, _padded  # noqa: E402

# Longest cell edge per level, in pixels. 64 and 160 hold the overview (its
# tiles are at most 72-160 CSS px, 2x upsampling allowed) and the 3D atlases;
# "full" is each cover at its own size, what reading zooms, the detail pane and
# 3D cards crop from. A cover is never enlarged to fill a level.
LEVELS = (64, 160, 'full')
FULL_MAX = PAGE_MAX - 2 * GUTTER
GROUND = (5, 5, 16)


def _publish(file, data):
    """Write atomically, readable by a static server (mkstemp creates 0600)."""
    _atomic_write(file, data)
    umask = os.umask(0); os.umask(umask)
    os.chmod(file, 0o666 & ~umask)


def cover_source(clip):
    """The largest file a clip names for its cover."""
    variants = sorted((v for v in clip.get('coverVariants') or [] if isinstance(v, dict) and v.get('src')),
                      key=lambda v: v.get('width') or 0)
    if variants: return variants[-1]['src']
    for key in ('cover', 'detailCover'):
        if clip.get(key): return clip[key]
    media = clip.get('media') or []
    return media[0].get('src') if media and isinstance(media[0], dict) else None


def read_cover(src, base, cache):
    """Bytes of a cover: http(s) through a download cache, data:image/, or a
    path relative to the document."""
    if src.startswith('data:image/'):
        header, _, data = src.partition(',')
        return base64.b64decode(data) if header.endswith(';base64') else urllib.parse.unquote_to_bytes(data)
    if src.startswith(('http://', 'https://')):
        cached = cache / sha256(src.encode()).hexdigest()
        if cached.exists(): return cached.read_bytes()
        request = urllib.request.Request(src, headers={'User-Agent': 'wunderkammer-collection-sheets'})
        with urllib.request.urlopen(request, timeout=30) as response: data = response.read()
        _atomic_write(cached, data)
        return data
    if '://' in src or src.startswith(('blob:', '//')):
        raise ValueError(f'cannot read {src[:60]}')
    return (base / urllib.parse.unquote(src.split('#')[0].split('?')[0])).read_bytes()


def shelf_pack(sizes):
    """Place (w, h) cells, gutters included, in order on 2048-px pages: rows
    left to right, a new row when one is full, a new page when rows run out.
    Order is kept, so neighbours in the document share a page. Returns pages
    as (width, height, [(index, x, y)])."""
    pages, placed, x, y, row = [], [], 0, 0, 0
    for i, (w, h) in enumerate(sizes):
        if x + w > PAGE_MAX: x, y, row = 0, y + row, 0
        if y + h > PAGE_MAX:
            pages.append(placed); placed, x, y, row = [], 0, 0, 0
        placed.append((i, x, y))
        x += w; row = max(row, h)
    if placed: pages.append(placed)
    out = []
    for cells in pages:
        width = max(cx + sizes[i][0] for i, cx, _ in cells)
        height = max(cy + sizes[i][1] for i, _, cy in cells)
        out.append((width, height, cells))
    return out


def pack_level(covers, edge, quality):
    """One level: every cover fitted inside edge x edge (never enlarged), packed
    into pages. Returns ([page dict with bytes], {cover index: (page, x, y, w, h)})."""
    smalls = []
    for image in covers:
        small = image.copy()
        small.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        smalls.append(small)
    sizes = [(s.width + 2 * GUTTER, s.height + 2 * GUTTER) for s in smalls]
    pages, slots = [], {}
    for width, height, cells in shelf_pack(sizes):
        page = Image.new('RGB', (width, height), GROUND)
        for i, x, y in cells:
            page.paste(_padded(smalls[i]), (x, y))
            slots[i] = (len(pages), x + GUTTER, y + GUTTER, smalls[i].width, smalls[i].height)
        buffer = BytesIO()
        page.save(buffer, 'WEBP', quality=quality, method=6)
        data = buffer.getvalue()
        pages.append({'name': f'{sha256(data).hexdigest()}.webp', 'width': width, 'height': height, 'edge': edge, 'data': data})
    return pages, slots


def build(collection_file, out_file=None, levels=LEVELS, drop_covers=False, cache=None, quality=QUALITY,
          sheets_dir=None, sheets_url=None):
    collection_file = Path(collection_file).resolve()
    out_file = Path(out_file).resolve() if out_file else collection_file
    doc = json.loads(collection_file.read_text())
    if doc.get('format') != 'wunderkammer.collection':
        raise SystemExit(f'{collection_file} is not a wunderkammer.collection document')
    base = collection_file.parent
    cache = Path(cache) if cache else Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'wunderkammer' / 'covers'
    sheet_dir = Path(sheets_dir).resolve() if sheets_dir else out_file.parent / 'sheets'

    # A document built with --drop-covers no longer names the files its cells
    # came from, so it cannot be repacked; it is left as it is.
    if doc.get('sheets') and any(c.get('sheetSlots') and not (c.get('cover') or c.get('coverVariants')) for c in doc['clips']):
        print('collection-sheets: covers are already in sheets and their files are gone; nothing to pack', flush=True)
        return doc

    covers, owners, sources, skipped = [], [], [], []
    for index, clip in enumerate(doc['clips']):
        src = cover_source(clip)
        if not src: continue
        try:
            with Image.open(BytesIO(read_cover(src, base, cache))) as image:
                image.load()
                rgb = image.convert('RGBA')
                flat = Image.new('RGB', rgb.size, GROUND); flat.paste(rgb, mask=rgb.getchannel('A'))
            covers.append(flat); owners.append(index); sources.append(src)
        except Exception as error:
            skipped.append(f"{clip.get('id')}: {error}")
    if not covers: raise SystemExit('collection-sheets: no cover could be read')

    # "full": the largest cover's own edge, so no cover is downscaled at that
    # level unless it is larger than a page holds.
    largest = max(max(c.size) for c in covers)
    edges = sorted({min(largest, FULL_MAX) if e == 'full' else int(e) for e in levels})
    full_size = all(max(c.size) <= edges[-1] for c in covers)
    sheets, slots = [], {i: [] for i in range(len(covers))}
    for edge in edges:
        pages, placed = pack_level(covers, edge, quality)
        first = len(sheets)
        for page in pages:
            target = sheet_dir / page['name']
            if not target.exists(): _publish(target, page['data'])
            sheets.append({'src': f"sheets/{page['name']}", 'edge': edge, 'width': page['width'], 'height': page['height'],
                           'bytes': len(page['data'])})
        for i, (page, x, y, w, h) in placed.items(): slots[i].append([first + page, x, y, w, h])

    # Pages are named relative to the output document, or under the URL they
    # will be hosted at.
    for sheet in sheets:
        name = Path(sheet['src']).name
        sheet['src'] = (sheets_url.rstrip('/') + '/' + name) if sheets_url \
            else os.path.relpath(sheet_dir / name, out_file.parent).replace(os.sep, '/')
    doc['sheets'] = [{k: s[k] for k in ('src', 'edge', 'width', 'height')} for s in sheets]
    images = doc.setdefault('images', {})
    images.pop('sheets', None)
    # Cells are the covers only when the largest level holds each at full size;
    # otherwise the files stay better and the cells feed only the overview.
    if full_size and not drop_covers: images['sheets'] = 'covers'
    if not images: doc.pop('images')
    # A clip whose cover could not be read keeps no cells from an older build.
    for index in set(range(len(doc['clips']))) - set(owners): doc['clips'][index].pop('sheetSlots', None)
    for i, index in enumerate(owners):
        clip = doc['clips'][index]
        clip['sheetSlots'] = slots[i]
        # Fields that only repeat the packed image go; a gallery or a larger
        # detail image the sheets do not replace stays. The cover stays as the
        # fallback for a page that fails to load, unless --drop-covers.
        if clip.get('detailCover') == sources[i]: clip.pop('detailCover')
        if [m.get('src') for m in clip.get('media') or [] if isinstance(m, dict)] == [sources[i]]: clip.pop('media')
        if drop_covers: clip.pop('cover', None); clip.pop('coverVariants', None)

    # Pages from earlier builds are unreachable once the document is replaced.
    keep = {Path(s['src']).name for s in sheets}
    if sheet_dir.exists():
        for old in sheet_dir.iterdir():
            if old.name not in keep and old.suffix == '.webp' and len(old.stem) == 64: old.unlink()
    _publish(out_file, json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode())

    total = sum(s['bytes'] for s in sheets)
    print(f'collection-sheets: {len(covers)} covers; '
          + ', '.join(f"{e}px {sum(1 for s in sheets if s['edge'] == e)} page(s)" for e in edges)
          + f'; {total / 1e6:.2f} MB in {len(sheets)} files in {sheet_dir}; images.sheets: {images.get("sheets", "overview") if not drop_covers else "(no files)"}', flush=True)
    for line in skipped: print(f'collection-sheets: skipped {line}', flush=True)
    return doc


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('collection', type=Path, help='a wunderkammer.collection JSON file')
    parser.add_argument('--out', type=Path, help='where to write the document (default: in place); sheets go in sheets/ beside it')
    parser.add_argument('--levels', default=','.join(map(str, LEVELS)), help='longest cell edge per level, comma-separated; "full" is each cover at its own size')
    parser.add_argument('--drop-covers', action='store_true', help='remove per-file covers, leaving cells as the only source')
    parser.add_argument('--sheets-dir', type=Path, help='where to write the pages (default: sheets/ beside the document)')
    parser.add_argument('--sheets-url', help='URL prefix the pages will be hosted under (default: their path relative to the document)')
    parser.add_argument('--cache', type=Path, help='download cache for remote covers')
    parser.add_argument('--quality', type=int, default=QUALITY, help='WebP quality of the pages')
    args = parser.parse_args()
    levels = tuple(v.strip() if v.strip() == 'full' else int(v) for v in args.levels.split(',') if v.strip())
    if not levels or any(e != 'full' and not 1 <= e <= FULL_MAX for e in levels):
        parser.error(f'levels are "full" or edges from 1 to {FULL_MAX}')
    build(args.collection, args.out, levels, args.drop_covers, args.cache, args.quality, args.sheets_dir, args.sheets_url)
