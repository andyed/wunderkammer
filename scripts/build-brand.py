#!/usr/bin/env python3
"""Build Wunderkammer's mark, lockups and favicon into wall/brand/.

The mark is one wall of the comparison page's aisle: a rack four tiles high
and three deep in one-point perspective, receding toward the word, with one
tile lit and the rest dim, as the walls show a selection.

The word is Geist (SIL Open Font License 1.1) at weight 640, shaped with
HarfBuzz so the font's kerning applies, then outlined to paths, so no file
needs the font to render. Output is deterministic.

    python3 scripts/build-brand.py --font /path/to/Geist-Variable.woff2

Needs fonttools, uharfbuzz and brotli (for a .woff2 font).
"""
import argparse, io
from pathlib import Path
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

WORD, WEIGHT, TRACK = 'wunderkammer', 640, 0.035  # tracking in em: a run of minims needs air small

# On dark grounds (the pages' #050510 and #0d0d16): word 17.8:1, lit tile 17.0:1,
# dim tiles 3.2:1, lit against dim 5.3:1. On white: word 20.3:1, lit tile 4.4:1;
# dim tiles stay pale (2.1:1) so the lit tile keeps its lead (lit against dim 2.1:1).
DARK = dict(word='#f0f0f0', dim='#5c5c80', lit='#aaffaa')
LIGHT = dict(word='#050510', dim='#b0b0c4', lit='#1d8a3a')
FAVICON_GROUND = '#050510'

# The rack: one wall, three columns of tiles deep and four rows high, on a
# 50 x 64 grid. Equal real tile widths foreshorten toward the vanishing point
# at x = VX; the wall ends at x = 47, short of a point, so small sizes do not
# read as an arrow.
VX, VY, NEAR, FAR, HALF = 91.0, 32.0, 3.0, 47.0, 30.0
COLS, ROWS, GAP_Y, GAP_Z, MARK_W = 3, 4, 1.6, 0.05, 50.0
LIT = (1, 1)  # (column, row): the middle column, second row


def f(n):
    return f'{n:.2f}'.rstrip('0').rstrip('.')


def rack(colors):
    k = VX - NEAR
    depth = k / (VX - FAR)
    zs = [1 + i * (depth - 1) / COLS for i in range(COLS + 1)]
    band = (2 * HALF - GAP_Y * (ROWS - 1)) / ROWS
    tiles = []
    for c in range(COLS):
        z0, z1 = zs[c] + GAP_Z, zs[c + 1] - GAP_Z
        for r in range(ROWS):
            y0 = -HALF + r * (band + GAP_Y)
            y1 = y0 + band
            pts = [(VX - k / z0, VY + y0 / z0), (VX - k / z1, VY + y0 / z1),
                   (VX - k / z1, VY + y1 / z1), (VX - k / z0, VY + y1 / z0)]
            fill = colors['lit'] if (c, r) == LIT else colors['dim']
            tiles.append(f'<polygon fill="{fill}" points="{" ".join(f"{f(x)},{f(y)}" for x, y in pts)}"/>')
    return ''.join(tiles)


class Word:
    def __init__(self, font_path):
        font = instantiateVariableFont(TTFont(font_path), {'wght': WEIGHT})
        font.flavor = None
        buf = io.BytesIO()
        font.save(buf)
        self.hb = hb.Font(hb.Face(hb.Blob(buf.getvalue())))
        self.glyphs, self.order = font.getGlyphSet(), font.getGlyphOrder()
        self.upm = font['head'].unitsPerEm
        b = BoundsPen(self.glyphs)
        self.glyphs['k'].draw(b)
        self.ascender = b.bounds[3]  # the word has no descenders; k and d set its height

    def paths(self, size, x0, baseline, color):
        buf = hb.Buffer()
        buf.add_str(WORD)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, {'liga': False})
        s, x, out = size / self.upm, 0, []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            pen = SVGPathPen(self.glyphs, ntos=f)
            self.glyphs[self.order[info.codepoint]].draw(
                TransformPen(pen, (s, 0, 0, -s, x0 + (x + pos.x_offset) * s, baseline)))
            out.append(pen.getCommands())
            x += pos.x_advance + TRACK * self.upm
        return f'<path fill="{color}" d="{" ".join(out)}"/>', (x - TRACK * self.upm) * s


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" width="{f(w)}" height="{f(h)}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n')


def lockup(word, colors, size=100):
    """The rack beside the word: 1.2 times the word's height, centred on it."""
    asc = word.ascender / word.upm * size
    mark_h = 1.2 * asc
    scale = mark_h / 64
    gap = 0.42 * asc
    top = (mark_h - asc) / 2           # the rack rises this far above the ascender
    text, advance = word.paths(size, MARK_W * scale + gap, top + asc, colors['word'])
    body = f'<g transform="scale({f(scale)})">{rack(colors)}</g>{text}'
    return svg(MARK_W * scale + gap + advance, mark_h, body, WORD)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--font', required=True, help='Geist variable font (.ttf or .woff2)')
    ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'wall' / 'brand'))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    word = Word(args.font)
    files = {
        'mark.svg': svg(MARK_W, 64, rack(DARK), WORD),
        'lockup-dark.svg': lockup(word, DARK),
        'lockup-light.svg': lockup(word, LIGHT),
        # A ground of its own, so the tab strip's colour cannot swallow the tiles.
        'favicon.svg': svg(64, 64, f'<rect width="64" height="64" rx="12" fill="{FAVICON_GROUND}"/>'
                                   f'<g transform="translate(11.69 6) scale(0.8125)">{rack(DARK)}</g>', WORD),
    }
    for name, text in files.items():
        (out / name).write_text(text)
        print(f'{out / name} ({len(text):,} bytes)')


if __name__ == '__main__':
    main()
