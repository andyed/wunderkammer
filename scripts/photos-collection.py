#!/usr/bin/env python3
"""A wall from Apple Photos: a tidy set of one subject's photos as a collection document.

    python3 scripts/photos-collection.py --caption dog --label Dog --since 2022-02 \\
        --title 'The dog' --limit 150 --out ~/dog-wall
    node scripts/show-collection.mjs ~/dog-wall/collection.json

Reads the Photos library read-only, through the osxphotos command line
(`uv tool install osxphotos`; macOS only). A photo is wanted when it matches
any of --label (Photos' own image labels), --caption (words in the caption
Photos writes for each photo, macOS 27 and later), --person (named people and
pets), --album or --keyword. Then it tidies:

- leaves out screenshots, photos shared with you rather than taken by you,
  pictures with no camera behind them (saved, downloaded or generated), ones
  with no image on this Mac, and ones under Photos' own quality score floor;
- with --animal dog (or cat), keeps only photos where the animal can be seen:
  Apple's Vision framework, on this Mac, finds it at --min-area of the frame or
  more, or, where Vision finds none, Photos' caption calls it a close-up of the
  animal or Photos labelled one (Vision misses a face that fills the frame).
  --alone also leaves out photos with more than one. Needs Swift (Xcode or its
  command line tools);
- keeps one photo of each run taken within --gap seconds, the favourite, else
  the best scored;
- takes --limit of what is left, a round at a time across the months, so every
  stretch of time is there, best first.

It writes `covers/` (480 px), `photos/` (1600 px), `collection.json` and
`selection.json`, which says why each matching photo was left out. The images
carry no metadata: no location, no camera, no faces. Place names go in only
with --places. Nothing leaves this Mac.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date, datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
from image_features import analyze_image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
COVER, PHOTO = 480, 1600
SEASONS = ['winter', 'spring', 'summer', 'autumn']
DAYPARTS = ['morning', 'afternoon', 'evening', 'night']
# Photos' labels, gathered into settings; the first that matches wins.
SETTINGS = [
    ('beach', {'Beach', 'Shore', 'Sand', 'Coast', 'Ocean', 'Sea'}),
    ('water', {'Creek', 'River', 'Lake', 'Waterways', 'Pond', 'Pool', 'Water Body'}),
    ('snow', {'Snow', 'Winter'}),
    ('woods', {'Forest', 'Woodland', 'Trail', 'Hiking'}),
    ('car', {'Car', 'Vehicle', 'Vehicle Interior', 'Car Seat'}),
    ('couch and bed', {'Sofa', 'Couch', 'Bed', 'Bedroom', 'Pillow', 'Blanket', 'Armchair'}),
    ('indoors', {'Interior Room', 'Living Room', 'Kitchen', 'Floor', 'Rug', 'Furniture', 'Door', 'Window', 'Cabinet', 'Chair'}),
    ('grass and garden', {'Grass', 'Lawn', 'Yard', 'Garden', 'Park', 'Meadow', 'Field', 'Shrub', 'Foliage'}),
    ('street', {'Sidewalk', 'Path', 'Street', 'Road', 'Asphalt'}),
]
PEOPLE = {'People', 'Adult', 'Child', 'Baby', 'Selfie', 'Portrait', 'Crowd'}
# What Vision calls the animal, the words Photos' captions use for one and for several, and Photos' labels for it.
ANIMALS = {
    'dog': {'one': ('dog', 'puppy'), 'several': ('dogs', 'puppies'), 'labels': {'Dog', 'Canine', 'Puppy'}},
    'cat': {'one': ('cat', 'kitten'), 'several': ('cats', 'kittens'), 'labels': {'Cat', 'Feline', 'Kitten'}},
}


def osxphotos_binary(given):
    for candidate in [given, shutil.which('osxphotos'), str(Path.home() / '.local/bin/osxphotos')]:
        if candidate and Path(candidate).exists():
            return candidate
    sys.exit('photos-collection: needs the osxphotos command line. Install it with `uv tool install osxphotos` '
             '(or `pipx install osxphotos`), then run this again.')


def query_expression(args):
    """One osxphotos --query-eval expression: a photo matching any criterion is wanted."""
    parts = []
    if args.label:
        parts.append(f'any(l in {set(args.label)!r} for l in photo.labels)')
    if args.caption:
        words = tuple(sorted({w.lower() for w in args.caption} | {w.lower() + 's' for w in args.caption}))
        # Whole words of the caption, punctuation spaced out, so "dog's" matches dog and "hotdog" does not.
        parts.append("any(w in ''.join(c if c.isalnum() else ' ' for c in (getattr(photo, 'ai_caption', None) or '').lower()).split() "
                     f'for w in {words!r})')
    if args.person:
        parts.append(f'any(p in {set(args.person)!r} for p in photo.persons)')
    if args.album:
        parts.append(f'any(a in {set(args.album)!r} for a in photo.albums)')
    if args.keyword:
        parts.append(f'any(k in {set(args.keyword)!r} for k in photo.keywords)')
    if not parts:
        sys.exit('photos-collection: say what to look for: --label, --caption, --person, --album or --keyword')
    return ' or '.join(parts)


def month_start(value, end=False):
    """YYYY, YYYY-MM or YYYY-MM-DD to the first (or, with end, the last) day it names."""
    m = re.fullmatch(r'(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?', value or '')
    if not m:
        sys.exit(f'photos-collection: dates are YYYY, YYYY-MM or YYYY-MM-DD (got {value})')
    year, month, day = int(m[1]), int(m[2] or (12 if end else 1)), m[3]
    if day:
        return f'{year:04d}-{month:02d}-{int(day):02d}'
    if not end:
        return f'{year:04d}-{month:02d}-01'
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return (nxt.fromordinal(nxt.toordinal() - 1)).isoformat()


def run_query(args, binary):
    command = [binary, 'query', '--only-photos', '--not-hidden', '--json', '--query-eval', query_expression(args)]
    if args.library:
        command += ['--library', args.library]
    if args.since:
        command += ['--from-date', month_start(args.since)]
    if args.until:
        command += ['--to-date', month_start(args.until, end=True) + 'T23:59:59']
    done = subprocess.run(command, capture_output=True, text=True)
    if done.returncode:
        tail = '\n'.join(line for line in done.stderr.splitlines() if 'WARNING' not in line)[-1500:]
        sys.exit(f'photos-collection: osxphotos could not read the library:\n{tail}\n'
                 'If it names a missing table, upgrade it (`uv tool upgrade osxphotos`). If it cannot open the '
                 'library, give your terminal Full Disk Access in System Settings > Privacy & Security.')
    return json.loads(done.stdout or '[]')


def when(photo):
    return datetime.fromisoformat(photo['date'])


def local_image(photo):
    """The best local picture of a photo, edits included: its edited version, else Photos' largest preview, else the original."""
    candidates = [photo.get('path_edited'), *(photo.get('path_derivatives') or []), photo.get('path')]
    return next((p for p in candidates if p and Path(p).is_file()), None)


def left_out(photo, args):
    if photo.get('screenshot') or photo.get('screen_recording'):
        return 'screenshot'
    if photo.get('syndicated') or photo.get('shared') or photo.get('shared_moment'):
        return 'shared with you'
    if not (photo.get('exif_info') or {}).get('camera_make'):
        return 'no camera behind it (saved, downloaded or generated)'
    if photo['uuid'] in args.exclude or f"photos:{photo['uuid']}" in args.exclude:
        return 'excluded by --exclude'
    if not local_image(photo):
        return 'no image on this Mac'
    if ((photo.get('score') or {}).get('overall') or 0) < args.min_score:
        return f'quality score under {args.min_score}'
    return None


def words(text):
    return ''.join(c if c.isalnum() else ' ' for c in (text or '').lower()).split()


def find_animals(photos, animal):
    """Vision's boxes for `animal` in each photo's local image, by uuid: the largest box's share of the frame, and how many there are."""
    if not shutil.which('swift'):
        sys.exit('photos-collection: --animal needs Swift, which comes with Xcode or its command line tools (xcode-select --install)')
    by_path = {local_image(p): p['uuid'] for p in photos}
    done = subprocess.run(['swift', str(ROOT / 'scripts/animal-boxes.swift')], input='\n'.join(by_path) + '\n',
                          capture_output=True, text=True)
    if done.returncode:
        sys.exit(f'photos-collection: Vision could not run:\n{done.stderr[-1500:]}')
    found = {}
    for line in done.stdout.splitlines():
        record = json.loads(line)
        boxes = [a['area'] for a in record.get('animals', []) if a['label'] == animal]
        found[by_path[record['path']]] = {'area': max(boxes, default=0), 'count': sum(area >= .01 for area in boxes)}
    return found


def animal_reason(photo, seen, args):
    """Why a photo does not show `args.animal` well enough, or None."""
    names, caption = ANIMALS[args.animal], words(photo.get('ai_caption'))
    if args.alone and (seen['count'] >= 2 or any(w in caption for w in names['several'])):
        return f'more than one {args.animal}'
    if seen['area'] >= args.min_area:
        return None
    if seen['area'] > 0:
        return f'the {args.animal} is too small to see'
    # Vision misses an animal whose face fills the frame; the caption and Photos' labels do not.
    text = ' '.join(caption)
    close_up = re.search(r'close up of (?:\w+ ){0,3}(?:' + '|'.join(names['one']) + r')\b', text)
    if close_up or names['labels'] & set(photo.get('labels') or []):
        return None
    return f'no {args.animal} to be seen'


def rank(photo):
    score = (photo.get('score') or {}).get('overall') or 0
    return (bool(photo.get('favorite')), score, (photo.get('width') or 0) * (photo.get('height') or 0))


def tidy(photos, gap):
    """One photo of each run taken within `gap` seconds of the last; the rest are near-duplicates."""
    keep, dropped, run = [], [], []
    for photo in sorted(photos, key=when):
        if run and (when(photo) - when(run[-1])).total_seconds() > gap:
            best = max(run, key=rank); keep.append(best); dropped += [p for p in run if p is not best]; run = []
        run.append(photo)
    if run:
        best = max(run, key=rank); keep.append(best); dropped += [p for p in run if p is not best]
    return keep, dropped


def spread(photos, limit):
    """Up to `limit`, a round at a time across the months: each round takes every month's best remaining photo."""
    months = defaultdict(list)
    for photo in photos:
        months[photo['date'][:7]].append(photo)
    queues = sorted((sorted(v, key=rank, reverse=True) for v in months.values()), key=lambda q: rank(q[0]), reverse=True)
    chosen = []
    while len(chosen) < limit and any(queues):
        for queue in queues:
            if queue and len(chosen) < limit:
                chosen.append(queue.pop(0))
    return sorted(chosen, key=when)


def season(d):
    return SEASONS[(d.month % 12) // 3]


def daypart(d):
    return 'morning' if 5 <= d.hour < 12 else 'afternoon' if d.hour < 17 else 'evening' if d.hour < 21 else 'night'


def setting(labels):
    present = set(labels)
    return next((name for name, words in SETTINGS if present & words), 'other')


def place(photo):
    names = (photo.get('place') or {}).get('names') or {}
    for key in ('area_of_interest', 'sub_locality', 'city'):
        value = names.get(key)
        value = value[0] if isinstance(value, list) and value else value
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def title(photo, moment):
    caption = (photo.get('title') or photo.get('ai_caption') or '').strip()
    return caption[:1].upper() + caption[1:] if caption else f'Photo, {moment:%B %-d, %Y}'


def save(image, size, path):
    copy = image.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    copy.save(path, 'JPEG', quality=84, optimize=True, progressive=True)  # no exif: no location, no camera
    return copy.size


def open_image(source, scratch):
    try:
        image = Image.open(source); image.load()
    except OSError:
        # HEIC and other formats Pillow cannot read: macOS converts them.
        converted = Path(scratch) / (Path(source).stem + '.jpg')
        subprocess.run(['sips', '-s', 'format', 'jpeg', source, '--out', str(converted)], check=True, capture_output=True)
        image = Image.open(converted); image.load()
    return ImageOps.exif_transpose(image).convert('RGB')


def subject_palette(image):
    """Colours of the middle of the frame, where the subject usually is, dominant first."""
    w, h = image.size
    middle = image.crop((w // 5, h // 5, w - w // 5, h - h // 5))
    return [entry['hex'] for entry in analyze_image(middle)['palette'][:5]]


def frame_colour(image):
    families = analyze_image(image)['colorFamilies']
    return families[0]['name'] if families else 'gray'


def build(args):
    binary = osxphotos_binary(args.osxphotos)
    out = Path(args.out).expanduser().resolve()
    if out.exists() and any(out.iterdir()) and not (out / 'collection.json').exists():
        sys.exit(f'photos-collection: {out} has other files in it; choose an empty folder or one this script wrote')
    print('Reading Photos…', file=sys.stderr)
    matched = run_query(args, binary)
    if not matched:
        sys.exit('photos-collection: no photos matched; try other --label, --caption or --person values, or a wider --since')
    reasons, candidates = {}, []
    for photo in matched:
        reason = left_out(photo, args)
        if reason:
            reasons[photo['uuid']] = reason
        else:
            candidates.append(photo)
    if args.animal:
        print(f'Looking for the {args.animal} in {len(candidates)} photos…', file=sys.stderr)
        found, visible = find_animals(candidates, args.animal), []
        for photo in candidates:
            reason = animal_reason(photo, found.get(photo['uuid'], {'area': 0, 'count': 0}), args)
            if reason:
                reasons[photo['uuid']] = reason
            else:
                visible.append(photo)
        candidates = visible
    kept, duplicates = tidy(candidates, args.gap)
    for photo in duplicates:
        reasons[photo['uuid']] = f'a near-duplicate, taken within {args.gap} s of a better one'
    chosen = spread(kept, args.limit)
    chosen_ids = {p['uuid'] for p in chosen}
    for photo in kept:
        if photo['uuid'] not in chosen_ids:
            reasons[photo['uuid']] = f'over --limit {args.limit}'
    if not chosen:
        sys.exit(f'photos-collection: {len(matched)} photos matched, and every one was left out: {dict(Counter(reasons.values()))}')

    for folder in ('covers', 'photos'):
        if (out / folder).exists():
            shutil.rmtree(out / folder)
        (out / folder).mkdir(parents=True)
    clips = []
    with tempfile.TemporaryDirectory() as scratch:
        for n, photo in enumerate(chosen, 1):
            moment = when(photo)
            image = open_image(local_image(photo), scratch)
            name = f'{n:04d}.jpg'
            save(image, COVER, out / 'covers' / name)
            save(image, PHOTO, out / 'photos' / name)
            labels = photo.get('labels') or []
            props = {
                'year': str(moment.year), 'season': season(moment), 'daypart': daypart(moment), 'setting': setting(labels),
                'people': 'with people' if (photo.get('persons') or set(labels) & PEOPLE) else 'no people',
                'colour': frame_colour(image), 'favourite': 'favourite' if photo.get('favorite') else 'not marked',
                'orientation': 'portrait' if image.height > image.width * 1.05 else 'landscape' if image.width > image.height * 1.05 else 'square',
            }
            where = place(photo) if args.places else None
            if where:
                props['place'] = where
            clips.append({
                'id': f"photos:{photo['uuid']}", 'title': title(photo, moment)[:200],
                'cover': f'covers/{name}', 'detailCover': f'photos/{name}',
                'captured': moment.strftime('%Y-%m-%dT%H:%M:%S'), 'source': 'Apple Photos',
                'palette': subject_palette(image), 'props': props,
                'note': ' · '.join(filter(None, [f'{moment:%A, %B %-d, %Y, %-I:%M %p}', where])),
            })
            if n % 25 == 0:
                print(f'  {n} of {len(chosen)}', file=sys.stderr)

    years = sorted({c['props']['year'] for c in clips})
    facet_order = ['year', 'season', 'setting', 'people', 'daypart', 'colour', 'favourite', 'orientation'] + (['place'] if args.places else [])
    document = {
        'format': 'wunderkammer.collection', 'version': 1,
        'corpus': {'id': f"photos:{re.sub(r'[^a-z0-9]+', '-', args.title.lower()).strip('-') or 'photos'}",
                   'revision': f'{date.today().isoformat()}-{len(clips)}'},
        'ui': {'title': args.title, 'nouns': {'item': args.item, 'items': args.items}, 'defaultGroup': 'year',
               'facetOrder': facet_order, 'facetLabels': {'daypart': 'time of day'}},
        'facetTypes': {'year': {'type': 'ordinal', 'order': years}, 'season': {'type': 'ordinal', 'order': SEASONS},
                       'daypart': {'type': 'ordinal', 'order': DAYPARTS}},
        'clips': clips,
    }
    (out / 'collection.json').write_text(json.dumps(document, indent=1, ensure_ascii=False) + '\n')
    (out / 'selection.json').write_text(json.dumps({
        'matched': len(matched), 'chosen': len(chosen), 'leftOut': dict(Counter(reasons.values())),
        'photos': [{'id': f"photos:{p['uuid']}", 'date': p['date'], 'chosen': p['uuid'] in chosen_ids, 'reason': reasons.get(p['uuid'])}
                   for p in sorted(matched, key=when)],
    }, indent=1) + '\n')
    checked = subprocess.run(['node', str(ROOT / 'scripts/validate-collection.mjs'), str(out / 'collection.json')], capture_output=True, text=True)
    print(f"{len(chosen)} of {len(matched)} matching photos, {years[0]}–{years[-1]}, in {out}")
    for reason, count in Counter(reasons.values()).most_common():
        print(f'  left out {count}: {reason}')
    if checked.returncode:
        sys.exit(f'photos-collection: the document did not validate:\n{checked.stdout}{checked.stderr}')
    print(f'Open it: node {os.path.relpath(ROOT / "scripts/show-collection.mjs")} {out / "collection.json"}')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    find = parser.add_argument_group('what to look for (any match)')
    find.add_argument('--label', action='append', default=[], help="a Photos image label, e.g. Dog, Beach (repeatable)")
    find.add_argument('--caption', action='append', default=[], help="a word in Photos' own caption, e.g. dog (repeatable)")
    find.add_argument('--person', action='append', default=[], help='a named person or pet (repeatable)')
    find.add_argument('--album', action='append', default=[], help='an album (repeatable)')
    find.add_argument('--keyword', action='append', default=[], help='a keyword (repeatable)')
    parser.add_argument('--since', help='YYYY, YYYY-MM or YYYY-MM-DD'); parser.add_argument('--until', help='YYYY, YYYY-MM or YYYY-MM-DD')
    parser.add_argument('--limit', type=int, default=150, help='most photos on the wall (default 150)')
    parser.add_argument('--gap', type=int, default=90, help='seconds within which shots count as one moment (default 90)')
    parser.add_argument('--min-score', type=float, default=.2, help="Photos' own quality score floor, 0 to 1 (default 0.2)")
    parser.add_argument('--animal', choices=sorted(ANIMALS), help='keep only photos where this animal can be seen (Vision, on this Mac)')
    parser.add_argument('--min-area', type=float, default=.03, help='with --animal, the smallest share of the frame it may fill (default 0.03)')
    parser.add_argument('--alone', action='store_true', help='with --animal, leave out photos with more than one')
    parser.add_argument('--exclude', action='append', default=[], help='a photo to leave out, by the id in selection.json (repeatable)')
    parser.add_argument('--title', default='Photos'); parser.add_argument('--item', default='photo'); parser.add_argument('--items', default='photos')
    parser.add_argument('--places', action='store_true', help='add place names from Photos (left out by default)')
    parser.add_argument('--library', help='a .photoslibrary other than the last one Photos opened')
    parser.add_argument('--osxphotos', help='path to the osxphotos command')
    parser.add_argument('--out', required=True, help='the folder to write; empty, or one this script wrote')
    args = parser.parse_args()
    if not 1 <= args.limit <= 2000:
        parser.error('--limit is 1 to 2000')
    args.exclude = set(args.exclude)
    if args.alone and not args.animal:
        parser.error('--alone needs --animal')
    build(args)


if __name__ == '__main__':
    main()
