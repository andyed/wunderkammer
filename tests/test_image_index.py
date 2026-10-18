import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('index_images', ROOT / 'scripts/index-images.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImageIndexTests(unittest.TestCase):
    def test_filename_dates_and_labeled_fallback(self):
        image = Image.new('RGB', (32, 32))
        self.assertEqual(module.capture_date('Screenshot 2026-04-11 at 8.38.01\u202fAM.png', image, 0)[0], '2026-04-11T08:38:01')
        self.assertEqual(module.capture_date('Screenshot 2026-04-11 at 12.38.01 PM.png', image, 0)[0], '2026-04-11T12:38:01')
        self.assertEqual(module.capture_date('Screenshot 2026-04-11 at 12.38.01 AM.png', image, 0)[0], '2026-04-11T00:38:01')
        self.assertEqual(module.capture_date('render-2025-12-24.png', image, 0)[:2], ('2025-12-24', 'filename'))
        self.assertEqual(module.capture_date('unknown.png', image, 0)[1], 'filesystem-mtime-fallback')

    def test_index_preserves_originals_reuses_derivatives_and_keeps_last_good_snapshot_offline(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'; root.mkdir()
            files = [root / 'Screenshot 2026-04-11 at 8.38.01 AM.png', root / 'Screenshot 2025-12-24.png']
            for file in files: Image.new('RGB', (320, 180), '#d02090').save(file)
            (root / 'movie.mov').write_bytes(b'not an image')
            original = {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
            config = Path(tmp) / 'instance/config.json'; config.parent.mkdir()
            config.write_text(json.dumps({'imageRoots': [{'id': 'test', 'path': str(root)}], 'imageIndex': 'index.json', 'imageCache': 'cache'}))
            self.assertEqual(module.run(config, workers=2), 0)
            index_file = config.parent / 'index.json'
            first = json.loads(index_file.read_text())
            self.assertEqual(len(first['images']), 2)
            self.assertEqual(len(list((config.parent / 'cache/thumbs').glob('*.webp'))), 1)
            self.assertNotEqual(first['images'][0]['id'], first['images'][1]['id'])
            self.assertEqual(first['images'][0]['sha256'], first['images'][1]['sha256'])
            overview = config.parent / 'cache' / first['images'][0]['overview']
            with Image.open(overview) as small:
                self.assertEqual(small.size, (128, 72))
            self.assertEqual(module.run(config, workers=2), 0)
            self.assertEqual(first['images'], json.loads(index_file.read_text())['images'])
            # Upgrade an older index using cached derivatives only. A missing
            # overview file must also be regenerated without rereading originals.
            overview.unlink()
            legacy = json.loads(index_file.read_text())
            del legacy['images'][0]['overview']
            index_file.write_text(json.dumps(legacy))
            with patch.object(Path, 'read_bytes', side_effect=AssertionError('original reread')):
                self.assertEqual(module.run(config, workers=1), 0)
            self.assertEqual(first['images'], json.loads(index_file.read_text())['images'])
            self.assertTrue(overview.exists())
            self.assertEqual(original, {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in files})
            snapshot = index_file.read_bytes()
            root.rename(root.with_name('offline'))
            with self.assertRaises(FileNotFoundError): module.run(config)
            self.assertEqual(snapshot, index_file.read_bytes())

if __name__ == '__main__': unittest.main()
