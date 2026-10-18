#!/usr/bin/env python3
"""Index configured image roots read-only; keep previews and inferred data locally.
Requires Pillow and numpy. Re-run to add/change files; cached records survive a
missing source file. An unavailable root fails before replacing the local index.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re
import tempfile
import time

from PIL import Image, ImageOps
from image_features import analyze_image
import projection
import sheets

EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tif', '.tiff', '.bmp'}
INDEX_VERSION = 1


def capture_date(name, image, mtime):
    """Return local/unspecified capture time without inventing a UTC offset."""
    try:
        exif = image.getexif()
        original = exif.get(36867)
        if not original and 34665 in exif:
            original = exif.get_ifd(34665).get(36867)
        if original:
            stamp = datetime.strptime(str(original), '%Y:%m:%d %H:%M:%S')
            return stamp.isoformat(), 'exif-original', 'second; timezone unspecified'
    except (ValueError, KeyError, TypeError, OSError):
        pass
    match = re.search(r'(20\d{2}-\d{2}-\d{2})(?:[ T_-]+(?:at\s+)?(\d{1,2})[.:_-](\d{2})[.:_-](\d{2})\s*(AM|PM)?)?', name, re.I)
    if match:
        try:
            date, hour, minute, second, period = match.groups()
            stamp = datetime.strptime(date, '%Y-%m-%d')
            if hour:
                h = int(hour)
                if period:
                    if not 1 <= h <= 12: raise ValueError('invalid 12-hour time')
                    h = h % 12 + (12 if period.upper() == 'PM' else 0)
                stamp = stamp.replace(hour=h, minute=int(minute), second=int(second))
                return stamp.isoformat(), 'filename', 'second; timezone unspecified'
            return stamp.date().isoformat(), 'filename', 'day'
        except ValueError:
            pass
    return datetime.fromtimestamp(mtime).astimezone().isoformat(timespec='seconds'), 'filesystem-mtime-fallback', 'second; not verified capture time'


def atomic_json(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=file.name + '.', dir=file.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, file)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def save_preview(image, dest, size, quality):
    if dest.exists(): return
    preview = image.copy()
    preview.thumbnail((size, size), Image.Resampling.LANCZOS)
    # Composite alpha over the wall background; never change the original.
    if preview.mode in ('RGBA', 'LA') or 'transparency' in preview.info:
        rgba = preview.convert('RGBA')
        background = Image.new('RGBA', rgba.size, (5, 5, 16, 255))
        preview = Image.alpha_composite(background, rgba).convert('RGB')
    else:
        preview = preview.convert('RGB')
    fd, tmp = tempfile.mkstemp(suffix='.webp', dir=dest.parent)
    os.close(fd)
    try:
        preview.save(tmp, 'WEBP', quality=quality, method=4)
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def run(config_file, workers=2, limit=None):
    config_file = config_file.resolve()
    config = json.loads(config_file.read_text())
    cache = (config_file.parent / config['imageCache']).resolve()
    index_file = (config_file.parent / config['imageIndex']).resolve()
    roots = config['imageRoots']
    if not roots or len({r['id'] for r in roots}) != len(roots):
        raise ValueError('imageRoots must have distinct ids')
    for root in roots:
        if not Path(root['path']).is_dir():
            raise FileNotFoundError(f"Source unavailable; existing index retained: {root['path']}")
    cache.mkdir(parents=True, exist_ok=True)
    for folder in ['thumbs', 'thumbs-small', 'previews']: (cache / folder).mkdir(exist_ok=True)
    old = json.loads(index_file.read_text()) if index_file.exists() else {'images': []}
    records = {record['id']: record for record in old['images']}
    jobs = []
    for root in roots:
        base = Path(root['path'])
        for directory, dirs, files in os.walk(base, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
            for name in sorted(files):
                file = Path(directory) / name
                if name.startswith('.') or file.suffix.lower() not in EXTENSIONS or file.is_symlink(): continue
                relative = file.relative_to(base).as_posix()
                key = sha256((root['id'] + '\0' + relative).encode()).hexdigest()
                jobs.append((root, file, relative, key))
    # Most recent filename dates appear first in the pilot while indexing runs.
    jobs.sort(key=lambda job: job[2], reverse=True)
    if limit is not None: jobs = jobs[:limit]
    errors = []
    completed, reused = 0, 0
    start = time.monotonic()
    method = analyze_image(Image.new('RGB', (16, 16)))['methodVersion']

    def process(job):
        root, file, relative, key = job
        info = file.stat()
        signature = {'size': info.st_size, 'mtimeNs': info.st_mtime_ns}
        previous = records.get(key)
        if previous and previous['signature'] == signature and all((cache / previous[k]).exists() for k in ['thumbnail', 'preview']):
            if previous['features']['methodVersion'] != method or previous.get('analysisInput') != 'cached-preview-webp-1920':
                with Image.open(cache / previous['preview']) as preview_image:
                    previous = {**previous, 'features': analyze_image(preview_image), 'analysisInput': 'cached-preview-webp-1920'}
            # Backfill the 128 px overview from the cached thumbnail: no need to
            # reread a 20 MB original to make a tile a few pixels wide.
            if not previous.get('overview') or not (cache / previous['overview']).exists():
                overview = f"thumbs-small/{previous['sha256']}.webp"
                with Image.open(cache / previous['thumbnail']) as thumb_image:
                    save_preview(thumb_image, cache / overview, 128, 80)
                previous = {**previous, 'overview': overview}
            return previous, True
        raw = file.read_bytes()
        digest = sha256(raw).hexdigest()
        with Image.open(BytesIO(raw)) as source:
            captured, date_source, precision = capture_date(file.name, source, info.st_mtime)
            image = ImageOps.exif_transpose(source)
            # Path id separates repeated occurrences; hash names immutable derivatives.
            thumbnail, preview = f'thumbs/{digest}.webp', f'previews/{digest}.webp'
            # Three tiers: 128 for overview and far-atlas tiles, 640 for review
            # tiles and near-atlas slots, 1920 for the detail pane.
            overview = f'thumbs-small/{digest}.webp'
            save_preview(image, cache / thumbnail, 640, 82)
            save_preview(image, cache / overview, 128, 80)
            save_preview(image, cache / preview, 1920, 90)
            with Image.open(cache / preview) as analysis_image:
                features = analyze_image(analysis_image)
            record = {'id': key, 'rootId': root['id'], 'relativePath': relative,
                      'signature': signature, 'sha256': digest, 'captured': captured,
                      'dateSource': date_source, 'datePrecision': precision,
                      'width': image.width, 'height': image.height, 'thumbnail': thumbnail,
                      'overview': overview, 'preview': preview, 'features': features,
                      'analysisInput': 'cached-preview-webp-1920'}
            return record, False

    projected = old.get('projection')

    def publish(done):
        atomic_json(index_file, {'version': INDEX_VERSION, 'generated': datetime.now().astimezone().isoformat(),
            'status': 'complete' if done else 'indexing', 'sourceRoots': roots,
            'discovered': len(jobs), 'processed': completed, 'errors': errors,
            **({'projection': projected} if projected else {}),
            'images': sorted(records.values(), key=lambda r: (r['captured'], r['id']), reverse=True)})

    print(f'Indexing {len(jobs)} images into {index_file}', flush=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, job): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            try:
                record, cached = future.result()
                records[record['id']] = record
                reused += int(cached)
            except Exception as error:
                errors.append({'rootId': job[0]['id'], 'path': job[2], 'error': str(error)})
                print(f'Cannot index {job[2]}: {error}', flush=True)
            completed += 1
            if completed % 20 == 0 or completed == len(jobs):
                publish(False)
                print(f'{completed}/{len(jobs)} processed; {reused} cached; {len(errors)} errors; {time.monotonic()-start:.1f}s', flush=True)
    # Similarity coordinates for the whole set, from the cached overviews.
    projected = projection.refresh(list(records.values()), cache, projection.image_record, old)
    publish(True)
    sheets.bake(cache, sheets.entries_from_index({'images': list(records.values())}))
    print(f'Ready: {len(records)} indexed images. Originals untouched.', flush=True)
    return len(errors)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--limit', type=int, help='bounded pilot; retain previously indexed records')
    args = parser.parse_args()
    raise SystemExit(1 if run(args.config, args.workers, args.limit) else 0)
