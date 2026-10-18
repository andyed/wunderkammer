import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import projection  # noqa: E402

HAVE_SKLEARN = importlib.util.find_spec('sklearn') is not None


class ProjectionTests(unittest.TestCase):
    def test_features_ignore_aspect_and_have_fixed_length(self):
        wide, tall = Image.new('RGB', (300, 100), '#d02090'), Image.new('RGB', (100, 300), '#d02090')
        self.assertEqual(len(projection.features(wide)), 12 * 12 * 3 + 64)
        self.assertTrue((projection.features(wide) == projection.features(tall)).all())

    @unittest.skipUnless(HAVE_SKLEARN, 'scipy not installed (index-time dependency)')
    def test_grid_cells_are_distinct_in_bounds_and_keep_order_through_bisection(self):
        import numpy as np
        rng = np.random.default_rng(3)
        points = np.concatenate([rng.normal(c, 0.05, (300, 2)) for c in [(-0.7, -0.7), (0.7, 0.7)]])
        cols, rows = projection.grid_shape(len(points))
        for leaf in (projection.GRID_LEAF, 64):   # exact, and bisected into small blocks
            cells = projection.snap_to_grid(points, cols, rows, leaf=leaf)
            self.assertEqual(len({tuple(c) for c in cells}), len(points))
            self.assertTrue((cells[:, 0] < cols).all() and (cells[:, 1] < rows).all() and (cells >= 0).all())
            # The lower-left clump (y up) lands left of and below the upper-right one (row 0 at the top).
            self.assertLess(cells[:300, 0].mean(), cells[300:, 0].mean())
            self.assertGreater(cells[:300, 1].mean(), cells[300:, 1].mean())

    def test_carry_over_keeps_points_for_unchanged_images_only(self):
        old = {'images': [{'sha256': 'a', 'thumbnail': 't', 'projection': {'x': 0.5, 'y': -0.5}}],
               'projection': {'method': projection.METHOD}}
        records = [{'sha256': 'a', 'thumbnail': 't'}, {'sha256': 'b', 'thumbnail': 'u'}]
        meta = projection.carry_over(old, records, projection.image_record)
        self.assertEqual(records[0]['projection'], {'x': 0.5, 'y': -0.5})
        self.assertNotIn('projection', records[1])
        self.assertEqual(meta['method'], projection.METHOD)

    @unittest.skipUnless(HAVE_SKLEARN, 'scikit-learn not installed (index-time dependency)')
    def test_assign_is_deterministic_shares_duplicates_and_skips_unreadable(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            colors = ['#d02090', '#2090d0', '#90d020', '#202020', '#f0f0f0', '#d0d020']
            records = []
            for i, color in enumerate(colors):
                Image.new('RGB', (64, 48), color).save(cache / f'{i}.webp')
                records.append({'sha256': f'h{i}', 'overview': f'{i}.webp'})
            records.append({'sha256': 'h0', 'overview': '0.webp'})            # same image again
            records.append({'sha256': 'gone', 'overview': 'missing.webp'})    # no derivative
            first = projection.assign([dict(r) for r in records], cache, projection.image_record)
            again = [dict(r) for r in reversed(records)]
            projection.assign(again, cache, projection.image_record)
            projected = [dict(r) for r in records]
            projection.assign(projected, cache, projection.image_record)
            self.assertEqual(first['items'], 7)
            self.assertEqual(first['unique'], 6)
            self.assertEqual(len(first['unreadable']), 1)
            same = lambda r: (r['projection']['x'], r['projection']['y'])
            self.assertEqual(same(projected[0]), same(projected[6]), 'duplicates share a map point')
            cells = {(r['projection']['col'], r['projection']['row']) for r in projected[:7]}
            self.assertEqual(len(cells), 7, 'every record gets its own grid cell')
            self.assertEqual((first['grid']['cols'], first['grid']['rows']), projection.grid_shape(7))
            self.assertNotIn('projection', projected[7])
            by_hash = {r['sha256']: r.get('projection') for r in again}
            self.assertEqual(by_hash['h3'], projected[3]['projection'], 'order-independent')
            for r in projected[:7]:
                self.assertTrue(-1 <= r['projection']['x'] <= 1 and -1 <= r['projection']['y'] <= 1)


if __name__ == '__main__':
    unittest.main()
