import hashlib
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave
from PIL import Image
from mutagen.wave import WAVE
from mutagen.id3 import APIC, TALB, TPE1, TPE2, TIT2, TDRC, TCON

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('index_music', ROOT / 'scripts/index-music.py')
music = importlib.util.module_from_spec(spec)
spec.loader.exec_module(music)


def artwork(color):
    out = BytesIO(); Image.new('RGB', (80, 80), color).save(out, 'PNG'); return out.getvalue()


def track(file, album, artist, cover=True):
    file.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(file), 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(8000); out.writeframes(b'\0' * 160)
    audio = WAVE(file); audio.add_tags()
    for frame in [TALB(text=album), TPE1(text=artist), TPE2(text=artist), TIT2(text=file.stem), TDRC(text='1997'), TCON(text='Rock')]: audio.tags.add(frame)
    if cover:
        audio.tags.add(APIC(mime='image/png', type=4, desc='back', data=artwork('red')))
        audio.tags.add(APIC(mime='image/png', type=3, desc='front', data=artwork('blue')))
    audio.save()


class MusicIndexTests(unittest.TestCase):
    def test_album_identity_front_cover_cache_and_readonly_library(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); source = base / 'library'; source.mkdir()
            track(source / 'first/01.wav', 'Album One', 'A')
            track(source / 'copy/01.wav', ' Album One ', 'a')
            track(source / 'second/01.wav', 'Album Two', 'A')
            track(source / 'other/01.wav', 'Album One', 'B')
            track(source / 'sidecar/01.wav', 'Sidecar Album', 'C', False)
            (source / 'sidecar/cover.png').write_bytes(artwork('green'))
            (source / 'sidecar/back.png').write_bytes(artwork('red'))
            track(source / 'missing/01.wav', 'Missing Art', 'D', False)
            before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
            config = base / 'config.json'
            config.write_text(json.dumps({'musicRoots': [{'id': 'test', 'path': str(source)}], 'imageIndex': 'index.json', 'imageCache': 'cache'}))
            self.assertEqual(music.run(config), 0)
            index = json.loads((base / 'index.json').read_text())
            self.assertEqual(index['audioFiles'], 6)
            self.assertEqual(len(index['albums']), 4)
            self.assertEqual(len(index['withoutArtwork']), 1)
            merged = next(a for a in index['albums'] if a['fileCount'] == 2)
            self.assertEqual(merged['years'], ['1997'])
            self.assertEqual(merged['cover']['sha256'], hashlib.sha256(artwork('blue')).hexdigest())
            self.assertEqual(len(list((base / 'cache/thumbs').glob('*'))), 2)
            side = next(a for a in index['albums'] if a['album'] == 'Sidecar Album')
            self.assertEqual(side['cover']['provenance'], 'cover-file')
            self.assertEqual(side['cover']['sha256'], hashlib.sha256(artwork('green')).hexdigest())
            self.assertEqual(music.run(config), 0)
            self.assertEqual(index['albums'], json.loads((base / 'index.json').read_text())['albums'])
            self.assertEqual(before, {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()})
            snapshot = (base / 'index.json').read_bytes()
            source.rename(base / 'offline')
            with self.assertRaises(FileNotFoundError): music.run(config)
            self.assertEqual(snapshot, (base / 'index.json').read_bytes())

    def test_truncated_art_is_reported_and_cached_candidate_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); source = base / 'library'; source.mkdir()
            track(source / 'album/01.wav', 'Album', 'Artist')
            (source / 'album/cover.png').write_bytes(artwork('green'))
            config = base / 'config.json'
            config.write_text(json.dumps({'musicRoots': [{'id': 'test', 'path': str(source)}], 'imageIndex': 'index.json', 'imageCache': 'cache'}))
            self.assertEqual(music.run(config), 0)
            raw = BytesIO(); Image.new('RGB', (1000, 1000), 'red').save(raw, 'JPEG')
            truncated = raw.getvalue()[:-100]
            with self.assertRaises(OSError): music.store_art(truncated, base / 'cache')
            # A previous indexer could accept a JPEG header without decoding pixels.
            (base / 'cache/artwork/broken.jpg').write_bytes(truncated)
            track_file = base / 'index-tracks.json'; cached = json.loads(track_file.read_text())
            row = next(iter(cached['tracks'].values()))
            row['art'] = {'sha256': 'broken', 'original': 'artwork/broken.jpg', 'width': 1000, 'height': 1000, 'provenance': 'embedded-front', 'source': 'album/01.wav'}
            track_file.write_text(json.dumps(cached))
            self.assertEqual(music.run(config), 1)
            index = json.loads((base / 'index.json').read_text())
            self.assertEqual(index['status'], 'complete')
            self.assertEqual(index['albums'][0]['cover']['provenance'], 'cover-file')
            self.assertEqual(len(index['errors']), 1)

    def test_ambiguous_folder_art_and_symlinks_are_not_assigned(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); source = base / 'library'; source.mkdir()
            track(source / 'mixed/01.wav', 'Album A', 'Artist', False)
            track(source / 'mixed/02.wav', 'Album B', 'Artist', False)
            (source / 'mixed/cover.png').write_bytes(artwork('green'))
            track(base / 'outside/private.wav', 'Outside', 'Artist')
            (source / 'escape').symlink_to(base / 'outside', target_is_directory=True)
            (source / 'escape.wav').symlink_to(base / 'outside/private.wav')
            config = base / 'config.json'
            config.write_text(json.dumps({'musicRoots': [{'id': 'test', 'path': str(source)}], 'imageIndex': 'index.json', 'imageCache': 'cache'}))
            self.assertEqual(music.run(config), 0)
            index = json.loads((base / 'index.json').read_text())
            self.assertEqual(index['audioFiles'], 2)
            self.assertEqual(index['albums'], [])
            self.assertEqual(len(index['withoutArtwork']), 2)

    def test_mp4_cover_and_metadata(self):
        from mutagen.mp4 import MP4, MP4Cover
        audio = MP4()
        audio.tags = {'\xa9alb': ['Cosmic Thing'], '\xa9ART': ["The B-52's"], '\xa9day': ['1989-06-27'], '\xa9gen': ['Rock'], 'covr': [MP4Cover(artwork('yellow'))]}
        metadata = music.metadata(audio, Path('Artist/Album/song.m4a'))
        self.assertEqual(metadata['year'], '1989')
        self.assertEqual(metadata['album'], 'Cosmic Thing')
        self.assertEqual(music.embedded_cover(audio)[0], artwork('yellow'))


if __name__ == '__main__': unittest.main()
