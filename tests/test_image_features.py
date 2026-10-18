"""Synthetic, geometry-based checks; no corpus/network access required."""

import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location(
    "image_features", Path(__file__).resolve().parents[1] / "scripts" / "image_features.py")
features = importlib.util.module_from_spec(spec)
spec.loader.exec_module(features)


def polar_pattern(width=320, height=240, order=6):
    y, x = np.indices((height, width))
    x, y = x - (width - 1) / 2, y - (height - 1) / 2
    theta, radius = np.arctan2(y, x), np.sqrt(x * x + y * y)
    signal = (0.5 + 0.5 * np.cos(order * theta)) * (0.5 + 0.5 * np.cos(radius / 9))
    return Image.fromarray(np.uint8(np.stack([signal, signal ** 2, 1 - signal], axis=-1) * 255))


class ImageFeaturesTests(unittest.TestCase):
    def test_symmetric_pattern_requires_angular_detail(self):
        result = features.analyze_image(polar_pattern())
        self.assertEqual(result["kaleido"]["label"], "kaleido")
        self.assertGreater(result["kaleido"]["rotationScores"]["6"], 0.90)
        self.assertTrue(result["kaleido"]["provisional"])
        json.dumps(result, allow_nan=False)

    def test_widescreen_letterbox_keeps_geometry(self):
        core = polar_pattern(240, 240)
        widescreen = Image.new("RGB", (640, 320))
        widescreen.paste(core, (200, 40))
        result = features.analyze_image(widescreen)
        self.assertEqual((result["width"], result["height"]), (640, 320))
        self.assertEqual(result["kaleido"]["label"], "kaleido")

    def test_fivefold_and_tenfold_patterns(self):
        for order in (5, 10):
            with self.subTest(order=order):
                result = features.analyze_image(polar_pattern(order=order))["kaleido"]
                self.assertEqual(result["label"], "kaleido")
                self.assertGreater(result["rotationScores"][str(order)], 0.96)

    def test_asymmetric_texture(self):
        rng = np.random.default_rng(42)
        # Smooth random blocks have visible structure and no repeated sectors.
        image = Image.fromarray(rng.integers(0, 256, (32, 40, 3), dtype=np.uint8))
        image = image.resize((400, 320), Image.Resampling.BICUBIC)
        result = features.analyze_image(image)["kaleido"]
        self.assertEqual(result["label"], "non-kaleido")
        self.assertLess(max(result["rotationScores"].values()), 0.45)

    def test_blank_and_radial_gradient_are_uncertain(self):
        y, x = np.indices((256, 256))
        radius = np.sqrt((x - 127.5) ** 2 + (y - 127.5) ** 2)
        radial = Image.fromarray(np.uint8(np.clip(radius, 0, 255))).convert("RGB")
        for image in (Image.new("RGB", (256, 256), "red"), radial):
            with self.subTest(image=image):
                result = features.analyze_image(image)["kaleido"]
                self.assertEqual(result["label"], "uncertain")
                self.assertEqual(result["confidence"], 0)

    def test_twofold_pattern_is_conservative(self):
        self.assertEqual(features.analyze_image(polar_pattern(order=2))["kaleido"]["label"],
                         "uncertain")

    def test_rotational_swirl_without_mirror_symmetry(self):
        y, x = np.indices((320, 320))
        x, y = x - 159.5, y - 159.5
        theta, radius = np.arctan2(y, x), np.sqrt(x * x + y * y)
        signal = 0.5 + 0.5 * np.cos(3 * theta + radius / 13)
        image = Image.fromarray(np.uint8(signal * 255)).convert("RGB")
        result = features.analyze_image(image)["kaleido"]
        self.assertEqual(result["label"], "kaleido")
        self.assertGreater(result["rotationScores"]["3"], 0.96)
        self.assertLess(result["reflectionScore"], 0.82)

    def test_color_fractions_and_source_unchanged(self):
        image = Image.new("RGB", (200, 100), "red")
        image.paste((0, 0, 255), (100, 0, 200, 100))
        before = image.tobytes()
        result = features.analyze_image(image)
        families = {entry["name"]: entry["fraction"] for entry in result["colorFamilies"]}
        self.assertAlmostEqual(families["red"], 0.5, delta=0.02)
        self.assertAlmostEqual(families["blue"], 0.5, delta=0.02)
        self.assertAlmostEqual(sum(entry["fraction"] for entry in result["palette"]), 1, places=3)
        self.assertEqual(before, image.tobytes())

    def test_tiny_transparent_image_is_json_safe_uncertain(self):
        result = features.analyze_image(Image.new("RGBA", (1, 1)))
        self.assertEqual(result["kaleido"]["label"], "uncertain")
        self.assertEqual(result["palette"][0]["hex"], "#000000")
        self.assertFalse(result["kaleido"]["analyzedRegion"]["analyzed"])
        self.assertIsNone(result["kaleido"]["bestRotationOrder"])
        json.dumps(result, allow_nan=False)

    def test_narrow_images_skip_polar_sampling(self):
        for size in ((1, 100), (100, 1), (2, 200), (200, 2), (47, 300), (8000, 64)):
            with self.subTest(size=size):
                result = features.analyze_image(Image.new("RGB", size, "blue"))
                self.assertEqual(result["kaleido"]["label"], "uncertain")
                self.assertFalse(result["kaleido"]["analyzedRegion"]["analyzed"])
                json.dumps(result, allow_nan=False)

    def test_flat_and_gradient_have_low_detail_not_repetition(self):
        gradient = Image.fromarray(np.tile(np.arange(256, dtype=np.uint8), (128, 1))).convert("RGB")
        for image in (Image.new("RGB", (256, 128), "red"), gradient):
            with self.subTest(image=image):
                result = features.analyze_image(image)["visualAttributes"]
                self.assertEqual(result["detail"]["label"], "low")
                self.assertEqual(result["repetition"]["label"], "uncertain")
                self.assertGreater(result["compression"]["rawSavings"], 0.95)
        # Gradient compresses well because of structure, but is not a tiling.
        self.assertGreater(features.analyze_image(gradient)["visualAttributes"]["compression"]["shuffleSavings"], 0.9)

    def test_noise_has_detail_but_little_compression_or_repetition(self):
        rng = np.random.default_rng(91)
        image = Image.fromarray(rng.integers(0, 256, (192, 256, 3), dtype=np.uint8))
        result = features.analyze_image(image)["visualAttributes"]
        self.assertEqual(result["detail"]["label"], "high")
        self.assertEqual(result["repetition"]["label"], "weak")
        self.assertLess(result["compression"]["rawSavings"], 0.01)
        self.assertLess(abs(result["compression"]["shuffleSavings"]), 0.01)

    def test_repeated_tile_compresses_and_has_translation_peak(self):
        rng = np.random.default_rng(92)
        tile = rng.integers(0, 256, (16, 16, 3), dtype=np.uint8)
        image = Image.fromarray(np.tile(tile, (12, 16, 1)))
        result = features.analyze_image(image)["visualAttributes"]
        self.assertEqual(result["repetition"]["label"], "strong")
        self.assertGreater(result["repetition"]["score"], 0.99)
        self.assertGreater(result["compression"]["shuffleSavings"], 0.9)

    def test_detail_normalization_and_shuffle_are_deterministic(self):
        image = polar_pattern(800, 400)
        first = features.analyze_image(image)["visualAttributes"]
        second = features.analyze_image(image)["visualAttributes"]
        self.assertEqual(first, second)
        self.assertEqual(first["normalization"]["width"], 256)
        self.assertEqual(first["normalization"]["height"], 128)
        self.assertEqual(first["compression"]["rawBytes"], 256 * 128 * 3)
        json.dumps(first, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
