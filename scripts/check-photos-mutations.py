#!/usr/bin/env python3
"""Prove the Apple Photos collection tests catch a wall that leaks or keeps what it should not."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
cases = [
    ('images keep their camera and location metadata',
     "copy.save(path, 'JPEG', quality=84, optimize=True, progressive=True)",
     "copy.save(path, 'JPEG', quality=84, optimize=True, progressive=True, exif=image.info.get('exif', b''))"),
    ('place names go in without --places', 'where = place(photo) if args.places else None', 'where = place(photo)'),
    ('photos shared with you are kept', "if photo.get('syndicated') or photo.get('shared')", "if photo.get('shared')"),
    ('screenshots are kept', "if photo.get('screenshot') or photo.get('screen_recording'):", "if photo.get('screen_recording'):"),
    ('a close-up of anything with the animal in it counts',
     "close_up = re.search(r'close up of (?:\\w+ ){0,3}(?:'", "close_up = re.search(r'close up of .*(?:'"),
    ('several animals pass --alone', "if args.alone and (seen['count'] >= 2 or", "if args.alone and (seen['count'] >= 3 or"),
]
for label, old, new in cases:
    with tempfile.TemporaryDirectory(prefix='photos-mutation-') as tmp:
        work = Path(tmp)
        shutil.copytree(root / 'scripts', work / 'scripts', ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copytree(root / 'wall', work / 'wall')  # the validator the script runs
        (work / 'tests').mkdir()
        shutil.copy2(root / 'tests/test_photos_collection.py', work / 'tests/test_photos_collection.py')
        target = work / 'scripts/photos-collection.py'; source = target.read_text()
        assert old in source, f'Mutation anchor absent: {label}'
        target.write_text(source.replace(old, new, 1))
        result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_photos_collection.py'], cwd=work, capture_output=True, text=True)
        assert result.returncode != 0 and 'AssertionError' in result.stderr, f'Mutation escaped or infrastructure failed: {label}\n{result.stdout}\n{result.stderr}'
        print('Caught:', label)
