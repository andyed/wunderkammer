from pathlib import Path
import json
import sys
import tempfile
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import sheets


class SheetTests(unittest.TestCase):
    def test_bake_packs_every_level_with_content_named_pages_and_edge_gutters(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp); (cache / 'thumbs-small').mkdir()
            colors = {'a' * 64: (200, 30, 30), 'b' * 64: (30, 200, 30), 'c' * 64: (30, 30, 200)}
            entries = []
            for digest, color in colors.items():
                # A portrait, so a slot keeps its aspect inside a square cell.
                Image.new('RGB', (64, 128), color).save(cache / f'thumbs-small/{digest}.webp', quality=100)
                entries.append((digest, f'thumbs-small/{digest}.webp'))
            entries.append(('d' * 64, 'thumbs-small/missing.webp'))
            result = sheets.bake(cache, entries)
            self.assertEqual(json.loads((cache / 'sheets.json').read_text()), result)
            self.assertEqual(result['count'], 3)
            self.assertEqual([l['edge'] for l in result['levels']], list(sheets.LEVELS))
            for level in result['levels']:
                self.assertEqual(set(level['slots']), set(colors))
                for page in level['sheets']:
                    self.assertRegex(page['file'], r'^sheets/[0-9a-f]{64}\.webp$')
                    self.assertTrue((cache / page['file']).exists())
                for digest, (page, x, y, w, h) in level['slots'].items():
                    self.assertEqual((w, h), (level['edge'] // 2, level['edge']))
                    with Image.open(cache / level['sheets'][page]['file']) as image:
                        rgb = image.convert('RGB')
                        # The slot centre and the gutter pixel beside it both
                        # carry the cover's own colour, not a neighbour's.
                        for px in [(x + w // 2, y + h // 2), (x - 1, y), (x + w, y + h - 1)]:
                            got = rgb.getpixel(px)
                            self.assertTrue(all(abs(a - b) < 24 for a, b in zip(got, colors[digest])), (digest, px, got))

    def test_rebake_removes_unreachable_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp); (cache / 'thumbs-small').mkdir()
            Image.new('RGB', (128, 128), 'red').save(cache / 'thumbs-small/a.webp')
            Image.new('RGB', (128, 128), 'blue').save(cache / 'thumbs-small/b.webp')
            sheets.bake(cache, [('a' * 64, 'thumbs-small/a.webp')])
            first = set((cache / 'sheets').glob('*.webp'))
            sheets.bake(cache, [('a' * 64, 'thumbs-small/a.webp'), ('b' * 64, 'thumbs-small/b.webp')])
            second = set((cache / 'sheets').glob('*.webp'))
            self.assertEqual(len(second), len(sheets.LEVELS))
            self.assertFalse(first & second)


if __name__ == '__main__':
    unittest.main()
