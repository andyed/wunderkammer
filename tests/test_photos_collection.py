from argparse import Namespace
from datetime import datetime, timedelta
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location('photos_collection', ROOT / 'scripts/photos-collection.py')
pc = module_from_spec(spec); spec.loader.exec_module(pc)

START = datetime.fromisoformat('2022-03-12T14:00:00-08:00')


def photo(n, *, seconds=0, score=.5, favorite=False, path=None, **extra):
    """An osxphotos --json record, as much of one as the script reads."""
    record = {'uuid': f'U{n}', 'date': (START + timedelta(seconds=seconds)).isoformat(), 'favorite': favorite,
              'score': {'overall': score}, 'exif_info': {'camera_make': 'Apple'}, 'labels': [], 'persons': [],
              'path_derivatives': [path] if path else [], 'width': 4032, 'height': 3024, 'ai_caption': 'a dog on a couch'}
    record.update(extra)
    return record


def args(**extra):
    base = dict(exclude=set(), min_score=.2, animal='dog', alone=True, min_area=.03, gap=90, limit=150,
                label=[], caption=[], person=[], album=[], keyword=[])
    base.update(extra)
    return Namespace(**base)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.image = str(Path(self.tmp.name) / 'a.jpg')
        Image.new('RGB', (64, 48), (180, 120, 60)).save(self.image)

    def tearDown(self):
        self.tmp.cleanup()

    def test_photos_that_are_not_yours_or_not_photos_are_left_out_with_a_reason(self):
        a = args(exclude={'photos:U9'})
        cases = {'screenshot': photo(1, path=self.image, screenshot=True),
                 'shared with you': photo(2, path=self.image, syndicated=True),
                 'no camera behind it (saved, downloaded or generated)': photo(3, path=self.image, exif_info={}),
                 'excluded by --exclude': photo(9, path=self.image),
                 'no image on this Mac': photo(4, path=str(Path(self.tmp.name) / 'gone.jpg')),
                 'quality score under 0.2': photo(5, path=self.image, score=.1)}
        for reason, record in cases.items():
            self.assertEqual(pc.left_out(record, a), reason)
        self.assertIsNone(pc.left_out(photo(6, path=self.image), a))

    def test_a_run_of_shots_keeps_one_favourite_first_then_best_scored(self):
        run = [photo(1, seconds=0, score=.9), photo(2, seconds=20, score=.4, favorite=True), photo(3, seconds=50, score=.7)]
        later = photo(4, seconds=50 + 91, score=.3)
        kept, dropped = pc.tidy(run + [later], 90)
        self.assertEqual([p['uuid'] for p in kept], ['U2', 'U4'])
        self.assertEqual(sorted(p['uuid'] for p in dropped), ['U1', 'U3'])

    def test_the_limit_takes_every_month_before_a_second_from_any(self):
        busy = [photo(i, seconds=i * 3600, score=.9) for i in range(10)]
        quiet = [photo(20, seconds=40 * 86400, score=.3), photo(21, seconds=80 * 86400, score=.25)]
        chosen = pc.spread(busy + quiet, 3)
        self.assertEqual(len(chosen), 3)
        self.assertEqual(len({p['date'][:7] for p in chosen}), 3, 'one from each month')
        self.assertEqual(pc.spread(busy + quiet, 50), sorted(busy + quiet, key=pc.when), 'under the limit, all of them, in time order')

    def test_the_animal_must_be_seen_and_a_close_up_vision_misses_still_counts(self):
        a = args()
        seen = lambda area, count=1: {'area': area, 'count': count}
        self.assertIsNone(pc.animal_reason(photo(1), seen(.2), a))
        self.assertEqual(pc.animal_reason(photo(1), seen(.01), a), 'the dog is too small to see')
        self.assertEqual(pc.animal_reason(photo(1), seen(.2, 2), a), 'more than one dog')
        self.assertEqual(pc.animal_reason(photo(1, ai_caption='two dogs playing on a beach'), seen(.2), a), 'more than one dog')
        self.assertIsNone(pc.animal_reason(photo(1, ai_caption='two dogs playing on a beach'), seen(.2), args(alone=False)))
        self.assertIsNone(pc.animal_reason(photo(1, ai_caption="a close up of a dog's face"), seen(0, 0), a))
        self.assertIsNone(pc.animal_reason(photo(1, ai_caption='a man on a couch', labels=['Canine']), seen(0, 0), a))
        self.assertEqual(pc.animal_reason(photo(1, ai_caption='a close up of a lemon hanging from a branch with a dog walking in the background'), seen(0, 0), a),
                         'no dog to be seen')

    def test_caption_words_match_whole_words_and_plurals(self):
        expression = pc.query_expression(args(caption=['dog'], label=['Canine']))
        fake = lambda caption, labels=(): SimpleNamespace(ai_caption=caption, labels=list(labels), persons=[], albums=[], keywords=[])
        match = lambda p: eval(expression, {'photo': p})  # noqa: S307 - our own expression; osxphotos also passes photo as a global
        self.assertTrue(match(fake("a dog's toy on the floor")))
        self.assertTrue(match(fake('two dogs on a beach')))
        self.assertFalse(match(fake('a hotdog stand')))
        self.assertTrue(match(fake(None, ['Canine'])))
        self.assertFalse(match(fake(None)))

    def test_dates_name_whole_months_and_years(self):
        self.assertEqual(pc.month_start('2022-02'), '2022-02-01')
        self.assertEqual(pc.month_start('2024-02', end=True), '2024-02-29')
        self.assertEqual(pc.month_start('2022', end=True), '2022-12-31')
        self.assertEqual(pc.month_start('2023-07-04', end=True), '2023-07-04')


class DocumentTests(unittest.TestCase):
    def test_the_document_validates_and_its_images_carry_no_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp); records = []
            for i in range(3):
                source = tmp / f'src{i}.jpg'
                exif = Image.Exif(); exif[0x010F] = 'Apple'; exif[0x8825] = {2: (37.0, 0.0, 0.0)}  # make, GPS latitude
                Image.new('RGB', (900, 600), (40 * i, 120, 60)).save(source, exif=exif)
                records.append(photo(i, seconds=i * 86400, path=str(source), labels=['Beach', 'Dog'],
                                     place={'names': {'city': ['Santa Cruz']}}))
            out = tmp / 'wall'
            a = args(animal=None, alone=False, out=str(out), title='The dog', item='photo', items='photos', places=False,
                     osxphotos='/bin/echo', library=None, since=None, until=None, caption=['dog'])
            with mock.patch.object(pc, 'run_query', return_value=records):
                pc.build(a)
            document = json.loads((out / 'collection.json').read_text())
            self.assertEqual(len(document['clips']), 3)
            self.assertEqual(document['ui']['nouns'], {'item': 'photo', 'items': 'photos'})
            self.assertTrue(all(c['props']['setting'] == 'beach' for c in document['clips']))
            self.assertTrue(all('place' not in c['props'] and 'Santa Cruz' not in c['note'] for c in document['clips']), 'no place names unless --places')
            for clip in document['clips']:
                for name in (clip['cover'], clip['detailCover']):
                    with Image.open(out / name) as image:
                        self.assertEqual(dict(image.getexif()), {}, f'{name} carries no camera, location or other metadata')
            selection = json.loads((out / 'selection.json').read_text())
            self.assertEqual((selection['matched'], selection['chosen']), (3, 3))


if __name__ == '__main__':
    unittest.main()
