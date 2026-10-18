"""Small, deterministic image descriptors; never edits source media.

The kaleido label is a provisional geometry heuristic, not semantic recognition.
It examines a centered disk, excluding the outer 7% of the shorter dimension.
Off-center art, UI overlays and ordinary symmetric designs can fool it. Scores
and the analysis region are retained so a later classifier can replace it.
"""

import colorsys
import zlib

import numpy as np
from PIL import Image, ImageFilter, ImageOps


METHOD_VERSION = "palette-symmetry-detail-v3"
ROTATION_ORDERS = (2, 3, 4, 5, 6, 8, 10, 12)


def _family(rgb):
    r, g, b = (v / 255 for v in rgb)
    hue, saturation, value = colorsys.rgb_to_hsv(r, g, b)
    if value < 0.16:
        return "black"
    if saturation < 0.16:
        return "white" if value > 0.85 else "gray"
    degrees = hue * 360
    for boundary, name in ((15, "red"), (45, "orange"), (70, "yellow"),
                           (165, "green"), (195, "cyan"), (255, "blue"),
                           (285, "purple"), (345, "magenta"), (361, "red")):
        if degrees < boundary:
            return name


def _palette(image):
    thumb = image.copy()
    thumb.thumbnail((160, 160), Image.Resampling.LANCZOS)
    # Median cut is deterministic, small and does not need a clustering package.
    quantized = thumb.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
    colors = quantized.getpalette()
    counts = sorted(quantized.getcolors(), key=lambda row: (-row[0], row[1]))
    total = thumb.width * thumb.height
    palette, families = [], {}
    for count, index in counts:
        rgb = colors[index * 3:index * 3 + 3]
        family = _family(rgb)
        fraction = count / total
        palette.append({"hex": "#%02x%02x%02x" % tuple(rgb),
                        "fraction": round(fraction, 4), "family": family})
        families[family] = families.get(family, 0) + fraction
    return palette, [{"name": name, "fraction": round(fraction, 4)}
                     for name, fraction in sorted(families.items(),
                                                  key=lambda row: (-row[1], row[0]))]


def _correlation(a, b):
    norm = np.sqrt(np.sum(a * a) * np.sum(b * b))
    return float(np.clip(np.sum(a * b) / max(float(norm), 1e-12), 0, 1))


def _symmetry(image):
    # Check the original dimensions before any polar indexing. In particular,
    # a one-pixel dimension cannot support bilinear sampling around a disk.
    if min(image.size) < 48:
        return {
            "label": "uncertain", "provisional": True, "confidence": 0.0,
            "confidenceKind": "heuristic-evidence-strength-not-probability",
            "rotationScores": {str(order): 0.0 for order in ROTATION_ORDERS},
            "bestRotationOrder": None, "reflectionScore": 0.0,
            "angularContrast": 0.0,
            "reason": "Image too small for reliable symmetry evidence; polar sampling skipped.",
            "analyzedRegion": {"shape": "centered-disk", "analyzed": False,
                               "radiusOfShortSide": 0.43, "innerRadiusFraction": 0.12,
                               "aspectPreserved": True,
                               "uniformBorderCropNormalized": [0.0, 0.0, 1.0, 1.0]},
        }
    # Aspect is preserved. Equal pixel radii on x/y, not a square-stretched image.
    thumb = image.copy()
    thumb.thumbnail((320, 320), Image.Resampling.LANCZOS)
    if min(thumb.size) < 48:
        # Extreme aspect ratios may become too narrow only after downsampling;
        # reuse the early insufficient-evidence result, without sampling them.
        return _symmetry(thumb)
    pixels = np.asarray(thumb, dtype=np.float64) / 255
    original_height, original_width = pixels.shape[:2]
    crop = (0, 0, original_width, original_height)
    corners = pixels[[0, 0, -1, -1], [0, -1, 0, -1]]
    # Only trim a uniformly colored surrounding frame. Never infer a content
    # rectangle from busy UI, nor stretch a crop into a different aspect ratio.
    background = np.median(corners, axis=0)
    if np.max(np.abs(corners - background)) < 0.02:
        foreground = np.max(np.abs(pixels - background), axis=2) > 0.025
        rows, columns = np.where(foreground)
        if len(rows):
            left, top, right, bottom = (int(columns.min()), int(rows.min()),
                                        int(columns.max()) + 1, int(rows.max()) + 1)
            if min(right - left, bottom - top) >= 24:
                crop = (left, top, right, bottom)
                pixels = pixels[top:bottom, left:right]
    height, width = pixels.shape[:2]
    radius = min(width, height) * 0.43
    angles = np.arange(240) * (2 * np.pi / 240)
    radii = np.linspace(radius * 0.12, radius, 36)
    x = (width - 1) / 2 + radii[:, None] * np.cos(angles)
    y = (height - 1) / 2 + radii[:, None] * np.sin(angles)
    # Bilinear sampling avoids nearest-pixel artifacts under rotations.
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = np.minimum(x0 + 1, width - 1), np.minimum(y0 + 1, height - 1)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    polar = ((1 - fy) * ((1 - fx) * pixels[y0, x0] + fx * pixels[y0, x1])
             + fy * ((1 - fx) * pixels[y1, x0] + fx * pixels[y1, x1]))
    # Remove each ring's mean: a blank, radial gradient or concentric rings must
    # not count as kaleido merely because they are rotationally invariant.
    angular = polar - polar.mean(axis=1, keepdims=True)
    contrast = float(np.sqrt(np.mean(angular ** 2)))
    rotations = {str(order): _correlation(angular, np.roll(angular, 240 // order, axis=1))
                 for order in ROTATION_ORDERS}
    reflection = max(_correlation(angular, np.roll(angular[:, ::-1], shift, axis=1))
                     for shift in range(0, 240, 5))
    best_order = max(ROTATION_ORDERS, key=lambda order: rotations[str(order)])
    best_rotation = rotations[str(best_order)]
    high_order = max(rotations[str(order)] for order in ROTATION_ORDERS if order >= 3)
    if contrast < 0.035:
        label, confidence, reason = "uncertain", 0.0, "Too little angular structure; blank or radial imagery is inconclusive."
    elif high_order >= 0.96:
        label, confidence, reason = "kaleido", high_order, "Exceptionally strong repeated rotation of order 3 or higher; reflection is not required for this provisional label."
    elif high_order >= 0.86 and reflection >= 0.82:
        label, confidence, reason = "kaleido", min(high_order, reflection), "Strong repeated rotation of order 3 or higher and reflection in the centered region."
    elif best_rotation < 0.45 and reflection < 0.75:
        label, confidence, reason = "non-kaleido", 1 - max(best_rotation, reflection), "No strong centered rotational or reflection symmetry detected."
    else:
        label, confidence, reason = "uncertain", 0.0, "Mixed symmetry evidence; bilateral or partial symmetry is not sufficient."
    return {
        "label": label, "provisional": True, "confidence": round(confidence, 4),
        "confidenceKind": "heuristic-evidence-strength-not-probability",
        "rotationScores": {key: round(value, 4) for key, value in rotations.items()},
        "bestRotationOrder": best_order, "reflectionScore": round(reflection, 4),
        "angularContrast": round(contrast, 4), "reason": reason,
        "analyzedRegion": {"shape": "centered-disk", "radiusOfShortSide": 0.43,
                           "innerRadiusFraction": 0.12, "aspectPreserved": True,
                           "uniformBorderCropNormalized": [
                               round(crop[0] / original_width, 4),
                               round(crop[1] / original_height, 4),
                               round(crop[2] / original_width, 4),
                               round(crop[3] / original_height, 4)]},
    }


def _entropy(values, bins):
    counts = np.bincount(values.ravel(), minlength=bins)
    probabilities = counts[counts > 0] / values.size
    return float(-np.sum(probabilities * np.log2(probabilities)) / np.log2(bins))


def _repetition(luminance):
    """Axis/diagonal translation peaks after removing smooth local variation.

    This detects some repeated motifs, not arbitrary tilings or semantic reuse.
    A lag must be a local peak and exceed its half-lag correlation by 0.2;
    simple smoothness or invariance along one axis is not repetition evidence.
    """
    height, width = luminance.shape
    if min(height, width) < 32:
        return {"label": "uncertain", "score": 0.0, "bestOffset": None,
                "reason": "Too few analysis pixels for translation evidence."}
    low_pass = np.asarray(Image.fromarray(np.uint8(luminance * 255)).filter(
        ImageFilter.GaussianBlur(radius=2)), dtype=np.float64) / 255
    signal = (luminance - low_pass)[6:-6, 6:-6]
    signal -= signal.mean()
    rms = float(np.sqrt(np.mean(signal ** 2)))
    if rms < 0.01:
        return {"label": "uncertain", "score": 0.0, "bestOffset": None,
                "highPassRms": round(rms, 4),
                "reason": "Too little high-pass detail; smooth gradients and flat frames are inconclusive."}
    height, width = signal.shape
    best, best_offset = 0.0, None
    for dx_unit, dy_unit in ((1, 0), (0, 1), (1, 1), (1, -1)):
        limit = min(64, width // 3 if dx_unit else 64,
                    height // 3 if dy_unit else 64)
        scores = [1.0]
        for lag in range(1, limit + 1):
            dx, dy = lag * dx_unit, lag * abs(dy_unit)
            if dy_unit >= 0:
                a = signal[:height - dy, :width - dx]
                b = signal[dy:, dx:]
            else:
                a = signal[dy:, :width - dx]
                b = signal[:height - dy, dx:]
            scores.append(_correlation(a - a.mean(), b - b.mean()))
        for lag in range(6, limit):
            score = scores[lag]
            if (score >= scores[lag - 1] and score >= scores[lag + 1]
                    and score - scores[lag // 2] >= 0.2 and score > best):
                best = score
                best_offset = {"dx": lag * dx_unit, "dy": lag * dy_unit}
    label = "strong" if best >= 0.8 else "moderate" if best >= 0.5 else "weak"
    return {"label": label, "score": round(best, 4), "bestOffset": best_offset,
            "highPassRms": round(rms, 4),
            "reason": "High-pass translational correlation peaks at axis/diagonal offsets of 6–63 analysis pixels; weak evidence does not exclude other repetition."}


def _visual_attributes(image):
    """Fixed maximum-side analysis; preserve aspect, never upscale or crop.

    Compression compares unfiltered row-major RGB8 bytes with zlib level 6, then
    with the exact same RGB tuples in a fixed-seed random pixel order. Savings
    are 1-compressed/raw and 1-compressed/shuffledCompressed (may be negative).
    Shape and resolution still influence scores; normalization is recorded.
    These metrics measure sampled detail and redundancy, not artistic quality.
    """
    thumb = image.copy()
    thumb.thumbnail((256, 256), Image.Resampling.LANCZOS)
    pixels = np.asarray(thumb, dtype=np.uint8)
    luminance = np.sum(pixels.astype(np.float64) / 255 * [0.2126, 0.7152, 0.0722], axis=2)
    if min(thumb.size) >= 2:
        dx = luminance[:-1, 1:] - luminance[:-1, :-1]
        dy = luminance[1:, :-1] - luminance[:-1, :-1]
        edge_density = float(np.mean(np.hypot(dx, dy) > 0.08))
    else:
        edge_density = 0.0
    luminance_entropy = _entropy(np.minimum((luminance * 32).astype(int), 31), 32)
    quantized = pixels.astype(np.uint16) // 16
    color_entropy = _entropy(quantized[:, :, 0] * 256 + quantized[:, :, 1] * 16 + quantized[:, :, 2], 4096)
    detail_score = 0.6 * edge_density + 0.2 * luminance_entropy + 0.2 * color_entropy
    detail_label = "high" if detail_score >= 0.6 else "medium" if detail_score >= 0.3 else "low"
    raw = pixels.tobytes()
    compressed_bytes = len(zlib.compress(raw, level=6))
    rng = np.random.default_rng(0)
    shuffled = pixels.reshape(-1, 3)[rng.permutation(pixels.shape[0] * pixels.shape[1])]
    shuffled_bytes = len(zlib.compress(shuffled.tobytes(), level=6))
    return {
        "method": "sampled-detail-and-translational-structure-v1", "provisional": True,
        "normalization": {"maxSide": 256, "width": thumb.width, "height": thumb.height,
                          "aspectPreserved": True, "upscaled": False, "resample": "Lanczos"},
        "detail": {"label": detail_label, "score": round(detail_score, 4),
                   "edgeDensity": round(edge_density, 4),
                   "luminanceEntropy": round(luminance_entropy, 4),
                   "colorEntropy": round(color_entropy, 4),
                   "reason": "Sampled visual detail, not artistic complexity: 0.6 × edge density (luminance gradient > .08) + 0.2 × normalized 32-bin luminance entropy + 0.2 × normalized 4096-bin RGB entropy."},
        "compression": {"codec": "zlib-6-rgb8", "shuffleSeed": 0,
                        "rawBytes": len(raw), "compressedBytes": compressed_bytes,
                        "shuffledCompressedBytes": shuffled_bytes,
                        "rawSavings": round(1 - compressed_bytes / len(raw), 4),
                        "shuffleSavings": round(1 - compressed_bytes / shuffled_bytes, 4),
                        "reason": "Savings = 1 - compressed/baseline bytes. The shuffled baseline retains all RGB pixels but destroys their positions. Compressibility measures redundancy, not necessarily repeated motifs; negative savings are retained."},
        "repetition": _repetition(luminance),
    }


def analyze_image(image):
    """Return JSON-safe color and provisional symmetry metadata for one PIL image.

    EXIF orientation is honored. Transparent pixels are composited over black;
    palette describes the full frame, including UI and borders. No file I/O.
    Confidence expresses heuristic evidence strength, not calibrated accuracy.
    """
    oriented = ImageOps.exif_transpose(image)
    rgba = oriented.convert("RGBA")
    rgb = Image.alpha_composite(Image.new("RGBA", rgba.size, (0, 0, 0, 255)), rgba).convert("RGB")
    palette, families = _palette(rgb)
    return {"methodVersion": METHOD_VERSION, "width": rgb.width, "height": rgb.height,
            "palette": palette, "colorFamilies": families, "kaleido": _symmetry(rgb),
            "visualAttributes": _visual_attributes(rgb)}
