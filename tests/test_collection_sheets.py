from hashlib import sha256
from importlib import util
from pathlib import Path
import json
import tempfile
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = util.spec_from_file_location('collection_sheets', ROOT / 'scripts' / 'collection-sheets.py')
collection_sheets = util.module_from_spec(spec)
spec.loader.exec_module(collection_sheets)

COLORS = [(200, 30, 30), (30, 200, 30), (30, 30, 200), (220, 220, 40), (40, 220, 220)]
SIZES = [(480, 270), (480, 302), (270, 480), (100, 60), (480, 270)]


def collection(tmp):
    (tmp / 'covers').mkdir()
    clips = []
    for i, (color, size) in enumerate(zip(COLORS, SIZES)):
        Image.new('RGB', size, color).save(tmp / f'covers/{i}.png')
        clip = {'id': f'c{i}', 'title': f'Cover {i}', 'cover': f'covers/{i}.png', 'props': {'n': str(i)}}
        if i == 1: clip.update(detailCover=f'covers/{i}.png', media=[{'src': f'covers/{i}.png'}])
        if i == 2: clip['media'] = [{'src': f'covers/{i}.png'}, {'src': 'covers/other.png'}]  # a gallery stays
        clips.append(clip)
    clips.append({'id': 'nocover', 'title': 'No image'})
    doc = {'format': 'wunderkammer.collection', 'version': 1, 'corpus': {'id': 'fixture'}, 'clips': clips}
    (tmp / 'collection.json').write_text(json.dumps(doc))
    return tmp / 'collection.json'


class CollectionSheetsTests(unittest.TestCase):
    def test_build_packs_every_cover_into_content_named_pages_and_drops_the_files_it_replaces(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            out = collection_sheets.build(collection(tmp), levels=(64, 480), drop_covers=True, cache=tmp / 'cache')
            self.assertEqual(json.loads((tmp / 'collection.json').read_text()), out)
            self.assertEqual(sorted({s['edge'] for s in out['sheets']}), [64, 480])
            for sheet in out['sheets']:
                self.assertRegex(sheet['src'], r'^sheets/[0-9a-f]{64}\.webp$')
                data = (tmp / sheet['src']).read_bytes()
                self.assertEqual(sha256(data).hexdigest(), Path(sheet['src']).stem, 'named by its bytes')
                with Image.open(tmp / sheet['src']) as page: self.assertEqual(page.size, (sheet['width'], sheet['height']))
            clips = {c['id']: c for c in out['clips']}
            self.assertNotIn('sheetSlots', clips['nocover'])
            for i, (color, size) in enumerate(zip(COLORS, SIZES)):
                clip = clips[f'c{i}']
                self.assertNotIn('cover', clip)
                self.assertEqual(len(clip['sheetSlots']), 2, 'one cell per level')
                for index, x, y, w, h in clip['sheetSlots']:
                    sheet = out['sheets'][index]
                    self.assertLessEqual(max(w, h), sheet['edge'])
                    # Aspect kept; never enlarged past the cover's own size.
                    scale = min(1, sheet['edge'] / max(size))
                    self.assertEqual((w, h), (round(size[0] * scale), round(size[1] * scale)))
                    self.assertTrue(x + w <= sheet['width'] and y + h <= sheet['height'])
                    with Image.open(tmp / sheet['src']) as page:
                        rgb = page.convert('RGB')
                        # Centre and the gutter just outside carry the cover's colour, not a neighbour's.
                        for px in [(x + w // 2, y + h // 2), (x - 1, y), (x + w, y + h - 1)]:
                            got = rgb.getpixel(px)
                            self.assertTrue(all(abs(a - b) < 24 for a, b in zip(got, color)), (i, px, got))
            self.assertNotIn('detailCover', clips['c1'], 'a detail image equal to the packed cover goes')
            self.assertNotIn('media', clips['c1'])
            self.assertEqual(len(clips['c2']['media']), 2, 'a gallery the sheets do not replace stays')
            self.assertNotIn('images', out, 'no files left, so no role to declare')

    def test_by_default_covers_stay_as_the_fallback_and_full_size_cells_are_the_covers(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            staging = tmp / 'staging' / 'sheets'
            out = collection_sheets.build(collection(tmp), cache=tmp / 'cache', sheets_dir=staging,
                                          sheets_url='https://pages.example/demo/sheets/')
            # "full" is the largest cover's own edge (480), so no cover is downscaled there.
            self.assertEqual(sorted({s['edge'] for s in out['sheets']}), [64, 160, 480])
            self.assertEqual(out['images'], {'sheets': 'covers'})
            for sheet in out['sheets']:
                self.assertRegex(sheet['src'], r'^https://pages\.example/demo/sheets/[0-9a-f]{64}\.webp$')
                self.assertTrue((staging / Path(sheet['src']).name).exists(), 'pages are written to the staging folder')
            self.assertFalse((tmp / 'sheets').exists(), 'nothing beside the document')
            clips = {c['id']: c for c in out['clips']}
            self.assertEqual(clips['c0']['cover'], 'covers/0.png', 'the file stays for a page that fails')
            for i, size in enumerate(SIZES):
                *_, w, h = clips[f'c{i}']['sheetSlots'][-1]
                self.assertEqual((w, h), size, 'the largest cell is the cover at full size')

    def test_a_level_smaller_than_some_cover_leaves_the_cells_to_the_overview(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            out = collection_sheets.build(collection(tmp), levels=(64, 160), cache=tmp / 'cache')
            self.assertNotIn('images', out, 'downscaled cells are previews; the files serve reading views')

    def test_rebuilding_from_the_files_removes_unreachable_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source = collection(tmp)
            first = collection_sheets.build(source, levels=(64,), cache=tmp / 'cache')
            self.assertEqual(first['clips'][0]['cover'], 'covers/0.png')
            old = {Path(s['src']).name for s in first['sheets']}
            Image.new('RGB', (480, 270), (250, 250, 250)).save(tmp / 'covers/0.png')
            second = collection_sheets.build(source, levels=(64,), cache=tmp / 'cache')
            now = {Path(s['src']).name for s in second['sheets']}
            self.assertNotEqual(old, now)
            self.assertEqual({p.name for p in (tmp / 'sheets').glob('*.webp')}, now)

    def test_a_document_without_its_files_is_left_as_it_is(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source = collection(tmp)
            first = collection_sheets.build(source, levels=(64,), drop_covers=True, cache=tmp / 'cache')
            again = collection_sheets.build(source, levels=(64,), drop_covers=True, cache=tmp / 'cache')
            self.assertEqual(first, again)


if __name__ == '__main__':
    unittest.main()
