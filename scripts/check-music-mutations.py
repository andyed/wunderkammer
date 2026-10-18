#!/usr/bin/env python3
"""Prove music regression assertions detect broken cover selection and identity."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
cases = [
    ('truncated artwork accepted', 'image.load()  # Header verification alone misses truncated JPEG payloads.', 'image.verify()'),
    ('back cover wins', "(int(p.type) != 3, -len(p.data))", "(int(p.type) != 4, -len(p.data))"),
    ('album title ignored in identity', "normalized(record['artist']) + '\\0' + normalized(record['album'])", "normalized(record['artist'])"),
]
for label, old, new in cases:
    with tempfile.TemporaryDirectory(prefix='music-mutation-') as tmp:
        work = Path(tmp)
        (work / 'scripts').mkdir(); (work / 'tests').mkdir()
        for name in ('index-music.py', 'index-images.py', 'image_features.py'):
            shutil.copy2(root / 'scripts' / name, work / 'scripts' / name)
        shutil.copy2(root / 'tests/test_music_index.py', work / 'tests/test_music_index.py')
        target = work / 'scripts/index-music.py'; source = target.read_text()
        assert old in source, f'Mutation anchor absent: {label}'
        target.write_text(source.replace(old, new, 1))
        result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_music_index.py'], cwd=work, capture_output=True, text=True)
        assert result.returncode != 0 and 'AssertionError' in result.stderr, f'Mutation escaped or infrastructure failed: {label}\n{result.stdout}\n{result.stderr}'
        print('Caught:', label)
