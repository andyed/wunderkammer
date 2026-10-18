#!/usr/bin/env python3
"""Read music tags and cover files without writing to the library. Requires
Mutagen, Pillow and numpy. All indexes, extracted artwork and previews are local.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from hashlib import sha256
from io import BytesIO
import importlib.util
import json
import os
from pathlib import Path
import re
import unicodedata

import mutagen
from PIL import Image, ImageOps
from image_features import analyze_image
import projection
import sheets

spec = importlib.util.spec_from_file_location('index_images', Path(__file__).with_name('index-images.py'))
images = importlib.util.module_from_spec(spec)
spec.loader.exec_module(images)
AUDIO = {'.mp3', '.m4a', '.m4p', '.flac', '.ogg', '.opus', '.aif', '.aiff', '.wav', '.wma'}
ART = {'.jpg', '.jpeg', '.png', '.webp'}
VERSION = 1


def normalized(value):
    return ' '.join(unicodedata.normalize('NFC', str(value)).casefold().split())


def metadata(audio, file):
    tags = audio.tags or {}
    id3 = hasattr(tags, 'getall')
    mp4 = type(audio).__name__ == 'MP4'
    asf = type(audio).__name__ == 'ASF'
    def values(generic, frame, atom, windows):
        raw = tags.get(frame if id3 else atom if mp4 else windows if asf else generic, [])
        if hasattr(raw, 'text'): raw = raw.text
        if not isinstance(raw, (list, tuple)): raw = [raw]
        return [str(v).strip() for v in raw if str(v).strip()]
    def first(*keys): return next(iter(values(*keys)), '')
    artist = first('artist', 'TPE1', '\xa9ART', 'Author') or file.parent.parent.name
    album_artist = first('albumartist', 'TPE2', 'aART', 'WM/AlbumArtist')
    compilation = tags.get('TCMP' if id3 else 'cpil' if mp4 else 'compilation', [])
    if str(compilation).lower() in ('1', '[1]', '[true]'): album_artist = album_artist or 'Various Artists'
    album = first('album', 'TALB', '\xa9alb', 'WM/AlbumTitle')
    date = first('date', 'TDRC', '\xa9day', 'WM/Year') or str(tags.get('TYER', ''))
    year = re.search(r'\b(1[0-9]{3}|20[0-9]{2})\b', date)
    return {'album': album or file.parent.name, 'artist': album_artist or artist,
            'trackArtist': artist, 'title': first('title', 'TIT2', '\xa9nam', 'Title') or file.stem,
            'genre': values('genre', 'TCON', '\xa9gen', 'WM/Genre'),
            'year': year.group(1) if year else '', 'date': date,
            'track': first('tracknumber', 'TRCK', 'trkn', 'WM/TrackNumber'),
            'disc': first('discnumber', 'TPOS', 'disk', 'WM/PartOfSet'),
            'metadataSource': 'audio-tags' if album else 'folder-fallback'}


def embedded_cover(audio):
    tags = audio.tags or {}
    pictures = tags.getall('APIC') if hasattr(tags, 'getall') else getattr(audio, 'pictures', [])
    if pictures:
        picture = sorted(pictures, key=lambda p: (int(p.type) != 3, -len(p.data)))[0]
        return picture.data, 'embedded-front' if int(picture.type) == 3 else 'embedded'
    if 'covr' in tags and tags['covr']:
        return bytes(max(tags['covr'], key=len)), 'embedded'
    if 'metadata_block_picture' in tags:
        import base64
        from mutagen.flac import Picture
        pictures = [Picture(base64.b64decode(value)) for value in tags['metadata_block_picture']]
        picture = sorted(pictures, key=lambda p: (int(p.type) != 3, -len(p.data)))[0]
        return picture.data, 'embedded-front' if int(picture.type) == 3 else 'embedded'
    return None, None


def store_art(raw, cache):
    digest = sha256(raw).hexdigest()
    # Validate before accepting bytes from tags as an artwork file.
    with Image.open(BytesIO(raw)) as image:
        width, height = image.size
        extension = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif', 'BMP': 'bmp'}.get(image.format)
        if not extension: raise ValueError(f'Unsupported embedded artwork: {image.format}')
        image.load()  # Header verification alone misses truncated JPEG payloads.
    relative = f'artwork/{digest}.{extension}'
    target = cache / relative
    # Identical bytes may arrive concurrently; each writer publishes atomically.
    if not target.exists():
        import tempfile
        fd, tmp = tempfile.mkstemp(dir=target.parent)
        try:
            with os.fdopen(fd, 'wb') as out: out.write(raw)
            os.replace(tmp, target)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
    return {'sha256': digest, 'original': relative, 'width': width, 'height': height}


def sidecar_priority(file):
    name = file.stem.casefold()
    if re.search(r'back|booklet|inside|inlay|disc|cd[ _.-]*\d*$', name): return 0
    if 'front' in name: return 110
    if name in ('cover', 'folder'): return 100
    if 'cover' in name: return 95
    if 'large' in name: return 80
    if 'small' in name: return 20
    return 50


def run(config_file, workers=4):
    config_file = config_file.resolve()
    config = json.loads(config_file.read_text())
    roots = config['musicRoots']
    if not roots or len({r['id'] for r in roots}) != len(roots): raise ValueError('musicRoots need distinct ids')
    for root in roots:
        if not Path(root['path']).is_dir(): raise FileNotFoundError(f"Source unavailable; local index retained: {root['path']}")
    index_file = (config_file.parent / config['imageIndex']).resolve()
    cache = (config_file.parent / config['imageCache']).resolve()
    for folder in ('artwork', 'thumbs', 'thumbs-small', 'previews'): (cache / folder).mkdir(parents=True, exist_ok=True)
    track_file = index_file.with_name(index_file.stem + '-tracks.json')
    old = json.loads(track_file.read_text()) if track_file.exists() else {'version': VERSION, 'tracks': {}}
    tracks = old['tracks'] if old.get('version') == VERSION else {}
    jobs, sidecars, errors = [], [], []
    directories = 0
    for root in roots:
        base = Path(root['path'])
        pending = [base]
        while pending:
            directory = pending.pop()
            # DirEntry retains file-type metadata returned by the network share;
            # avoid a separate lstat network round-trip for every library file.
            with os.scandir(directory) as iterator:
                entries = sorted(iterator, key=lambda entry: entry.name)
            directories += 1
            for entry in entries:
                if entry.name.startswith('.') or entry.is_symlink(): continue
                file = Path(entry.path)
                if entry.is_dir(follow_symlinks=False):
                    if not entry.name.endswith('.musiclibrary'): pending.append(file)
                    continue
                if file.suffix.lower() not in AUDIO | ART or not entry.is_file(follow_symlinks=False): continue
                relative = file.relative_to(base).as_posix()
                if file.suffix.lower() in ART: sidecars.append((root, file, relative)); continue
                key = sha256((root['id'] + '\0' + relative).encode()).hexdigest()
                jobs.append((root, file, relative, key))
            if directories % 250 == 0:
                print(f'Scanned {directories} folders; {len(jobs)} audio files', flush=True)
    print(f'Found {len(jobs)} audio files and {len(sidecars)} artwork files. Reading tags only.', flush=True)
    current = {}
    def process(job):
        root, file, relative, key = job
        stat = file.stat(); signature = [stat.st_size, stat.st_mtime_ns]
        previous = tracks.get(key)
        if previous and previous['signature'] == signature and (not previous.get('art') or (cache / previous['art']['original']).is_file()):
            return previous, True
        audio = mutagen.File(file)
        if audio is None: raise ValueError('Unrecognized audio container')
        record = {'rootId': root['id'], 'relativePath': relative, 'signature': signature, **metadata(audio, file)}
        raw, kind = embedded_cover(audio)
        if raw:
            try: record['art'] = {**store_art(raw, cache), 'provenance': kind, 'source': relative}
            except Exception as error: record['artError'] = str(error)
        return record, False
    reused = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, job): job for job in jobs}
        for count, future in enumerate(as_completed(futures), 1):
            root, _, relative, key = futures[future]
            try:
                record, cached = future.result(); current[key] = record; tracks[key] = record; reused += cached
                if record.get('artError'): errors.append({'path': relative, 'error': record['artError']})
            except Exception as error:
                errors.append({'path': relative, 'error': str(error)})
                if key in tracks: current[key] = tracks[key]
            if count % 250 == 0 or count == len(jobs):
                images.atomic_json(track_file, {'version': VERSION, 'tracks': tracks})
                print(f'Tags {count}/{len(jobs)}; {reused} cached; {len(errors)} errors', flush=True)
    albums = {}
    directory_albums = defaultdict(set)
    for record in sorted(current.values(), key=lambda t: (t['rootId'], t['relativePath'])):
        identity = normalized(record['artist']) + '\0' + normalized(record['album'])
        key = sha256(identity.encode()).hexdigest()
        album = albums.setdefault(key, {'id': key, 'album': record['album'], 'artist': record['artist'], 'tracks': [], 'candidates': {}})
        album['tracks'].append(record)
        if record.get('art'):
            art = record['art']; album['candidates'][art['sha256']] = {**art, 'priority': 105 if art['provenance'] == 'embedded-front' else 90}
        parent = Path(record['relativePath']).parent
        for folder in (parent, *parent.parents): directory_albums[(record['rootId'], folder.as_posix())].add(key)
    matched_sidecars = 0
    sidecar_candidates = defaultdict(list)
    for root, file, relative in sidecars:
        priority = sidecar_priority(file)
        if not priority: continue
        parent = Path(relative).parent
        for folder in (parent, *parent.parents):
            keys = directory_albums.get((root['id'], folder.as_posix()), set())
            if keys:
                if len(keys) == 1:
                    key = next(iter(keys)); sidecar_candidates[key].append((priority, file, relative)); matched_sidecars += 1
                break
    # Inspect candidates' dimensions, then extract the best sidecar per album.
    # Booklets/discs/back covers never become the main cover by filename alone.
    def choose_sidecar(job):
        key, candidates = job
        ranked, failures = [], []
        for priority, file, relative in candidates:
            try:
                with Image.open(file) as im: ranked.append((priority, min(im.size), im.width * im.height, relative, file))
            except Exception as error: failures.append({'path': relative, 'error': str(error)})
        for priority, _, _, relative, file in sorted(ranked, reverse=True):
            try:
                art = {**store_art(file.read_bytes(), cache), 'provenance': 'cover-file', 'source': relative, 'priority': priority}
                return key, art, failures
            except Exception as error: failures.append({'path': relative, 'error': str(error)})
        return key, None, failures
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(choose_sidecar, job) for job in sidecar_candidates.items()]
        for count, future in enumerate(as_completed(futures), 1):
            key, art, failures = future.result()
            errors.extend(failures)
            if art: albums[key]['candidates'][art['sha256']] = art
            if count % 100 == 0 or count == len(futures):
                print(f'Cover folders {count}/{len(futures)} checked', flush=True)
    old_index = json.loads(index_file.read_text()) if index_file.exists() else {'albums': []}
    old_features = {a['cover']['sha256']: a['features'] for a in old_index['albums']}
    records, missing = [], []
    method = analyze_image(Image.new('RGB', (16, 16)))['methodVersion']
    for number, album in enumerate(sorted(albums.values(), key=lambda a: a['id']), 1):
        candidates = list(album.pop('candidates').values())
        track_records = album.pop('tracks')
        album.update(years=sorted({t['year'] for t in track_records if t['year']}),
                     genres=sorted({g for t in track_records for g in t['genre']}),
                     trackArtists=sorted({t['trackArtist'] for t in track_records}),
                     fileCount=len(track_records),
                     tracks=sorted({t['title'] for t in track_records}),
                     locations=sorted({t['rootId'] + '/' + str(Path(t['relativePath']).parent) for t in track_records}),
                     metadataSources=sorted({t['metadataSource'] for t in track_records}))
        if not candidates:
            missing.append(album); continue
        # Prefer credible fronts/covers over unnamed art, then the best resolution.
        cover = None
        for candidate in sorted(candidates, key=lambda a: (a['priority'] >= 90, min(a['width'], a['height']), a['priority'], a['sha256']), reverse=True):
            try:
                digest = candidate['sha256']
                with Image.open(cache / candidate['original']) as source:
                    image = ImageOps.exif_transpose(source)
                    selected = {**candidate, 'width': image.width, 'height': image.height,
                                'thumbnail': f'thumbs/{digest}.webp', 'overview': f'thumbs-small/{digest}.webp', 'preview': f'previews/{digest}.webp'}
                    images.save_preview(image, cache / selected['overview'], 128, 82)
                    images.save_preview(image, cache / selected['thumbnail'], 640, 82)
                    images.save_preview(image, cache / selected['preview'], 1920, 90)
                cover = selected
                break
            except Exception as error:
                errors.append({'path': candidate['source'], 'error': str(error)})
        if cover is None:
            missing.append(album)
            continue
        features = old_features.get(digest)
        if not features or features.get('methodVersion') != method:
            with Image.open(cache / cover['preview']) as preview: features = analyze_image(preview)
        old_features[digest] = features
        records.append({**album, 'cover': cover, 'features': features})
        if number % 100 == 0: print(f'Albums {number}/{len(albums)}; {len(records)} covers', flush=True)
    # Similarity coordinates for every cover, from the cached overviews.
    projected = projection.refresh(records, cache, projection.album_record, old_index)
    result = {'version': VERSION, 'generated': datetime.now().astimezone().isoformat(), 'status': 'complete',
              'sourceRoots': roots, 'audioFiles': len(jobs), 'artworkFiles': len(sidecars),
              'matchedArtworkFiles': matched_sidecars, 'errors': errors,
              **({'projection': projected} if projected else {}), 'albums': records, 'withoutArtwork': missing}
    images.atomic_json(index_file, result)
    sheets.bake(cache, sheets.entries_from_index(result))
    print(f'Ready: {len(records)} album covers; {len(missing)} albums without art; {len(errors)} errors. Originals untouched.', flush=True)
    return len(errors)


def refresh_overviews(config_file):
    config_file = config_file.resolve()
    config = json.loads(config_file.read_text())
    cache = (config_file.parent / config['imageCache']).resolve()
    index_file = (config_file.parent / config['imageIndex']).resolve()
    index = json.loads(index_file.read_text())
    (cache / 'thumbs-small').mkdir(exist_ok=True)
    for album in index['albums']:
        cover = album['cover']
        cover['overview'] = f"thumbs-small/{cover['sha256']}.webp"
        with Image.open(cache / cover['preview']) as image:
            images.save_preview(image, cache / cover['overview'], 128, 82)
    images.atomic_json(index_file, index)
    sheets.bake(cache, sheets.entries_from_index(index))
    print(f"Refreshed {len(index['albums'])} overview thumbnails from local cache.", flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--workers', type=int, choices=range(1, 9), default=4)
    parser.add_argument('--refresh-overviews', action='store_true', help='build small overview images from local previews, without reading source roots')
    args = parser.parse_args()
    if args.refresh_overviews: refresh_overviews(args.config)
    else: raise SystemExit(1 if run(args.config, args.workers) else 0)
