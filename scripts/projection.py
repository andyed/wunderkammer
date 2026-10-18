#!/usr/bin/env python3
"""2-D similarity coordinates for an image or music index, from cached derivatives only.

Each item gets a point so that images that look alike sit near each other; the
wall's similarity arrangement (wall/layout.mjs) turns the points into a map.

Method `pixels-umap-v1`, the model-free recipe the peer study used
(scripts/peer-perf/project.py): a 12x12 RGB thumbnail plus a 4x4x4 colour
histogram per image (432 + 64 = 496 dims), standardised, PCA to 50, then UMAP to 2-D
(cosine, n_neighbors 15, min_dist 0.1, seed 42), rescaled to [-1, 1]. These are
look-and-colour neighbourhoods, not semantic ones. A later CLIP embedding can
replace `features()` and write a different `method` into the same fields;
the wall reads only x and y.

A second step snaps the map to a lattice (the similarity grid): every record
gets its own cell, near points get near cells. Cells come from an exact
linear assignment (scipy, BSD) inside blocks of at most GRID_LEAF cells; above
that, the lattice is first split by recursive bisection along its longer side,
each half taking the points on its side in proportion to its cells. Exact for
both atlases; near-exact and O(n log n) between blocks at 10k.

Writes, into the index it reads:
  record['projection'] = {'x', 'y', 'col', 'row'}      (per image / album cover)
  index['projection']  = {'method', 'params', 'grid', 'items', 'generated'}

Index-time only. UMAP, scikit-learn and numba never reach the browser or the
Node server. Neither indexer requires them: without them the projection step is
skipped and the previous coordinates are kept. Run alone, without the source roots:

  ~/.local/bin/uv run --with umap-learn --with pillow --with numpy \\
      python -I scripts/projection.py --config .local/music-atlas/wunderkammer.config.json
"""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile

import numpy as np
from PIL import Image

METHOD = 'pixels-umap-v1'
PARAMS = {'features': '12x12 rgb + 4x4x4 histogram', 'pca': 50, 'metric': 'cosine',
          'n_neighbors': 15, 'min_dist': 0.1, 'seed': 42}


class ProjectionUnavailable(RuntimeError):
    """UMAP / scikit-learn are not installed in this interpreter."""


def features(image):
    """496 numbers describing layout and colour; aspect is ignored on purpose."""
    rgb = image.convert('RGB')
    small = np.asarray(rgb.resize((12, 12), Image.BILINEAR), dtype=np.float32).ravel() / 255
    q = (np.asarray(rgb.resize((64, 64)), dtype=np.int32) // 64).reshape(-1, 3)
    hist = np.bincount(q[:, 0] * 16 + q[:, 1] * 4 + q[:, 2], minlength=64).astype(np.float32) / len(q)
    return np.concatenate([small, hist * 4])


def embed(vectors, seed=PARAMS['seed']):
    """n x d features -> n x 2 in [-1, 1]. Deterministic for a given input order."""
    X = np.asarray(vectors, dtype=np.float32)
    n = len(X)
    if n == 0: return np.zeros((0, 2))
    if n == 1: return np.zeros((1, 2))
    X = (X - X.mean(0)) / (X.std(0) + 1e-6)
    try:
        from sklearn.decomposition import PCA
    except ImportError as error:
        raise ProjectionUnavailable(str(error)) from error
    P = PCA(n_components=min(PARAMS['pca'], n - 1, X.shape[1]), random_state=seed).fit_transform(X)
    if n <= PARAMS['n_neighbors'] + 1 or P.shape[1] < 2:
        # Too few points for a neighbour graph: the first two principal axes will do.
        Y = np.pad(P[:, :2], ((0, 0), (0, max(0, 2 - P.shape[1]))))
    else:
        try:
            import umap
        except ImportError as error:
            raise ProjectionUnavailable(str(error)) from error
        Y = umap.UMAP(n_neighbors=PARAMS['n_neighbors'], min_dist=PARAMS['min_dist'],
                      metric=PARAMS['metric'], random_state=seed, n_jobs=1).fit_transform(P)
    lo, span = Y.min(0), Y.max(0) - Y.min(0)
    return (Y - lo) / np.where(span > 0, span, 1) * 2 - 1


GRID_ASPECT = 1.6   # columns / rows; the wall stretches, never re-solves
GRID_LEAF = 2048    # largest block solved exactly (an n x n cost matrix)


def grid_shape(n, aspect=GRID_ASPECT):
    cols = max(1, int(np.ceil(np.sqrt(n * aspect))))
    return cols, max(1, int(np.ceil(n / cols)))


def _ranks(v):
    r = np.empty(len(v)); r[np.argsort(v, kind='stable')] = np.arange(len(v))
    return (r + 0.5) / max(1, len(v))


def snap_to_grid(points, cols, rows, leaf=GRID_LEAF):
    """n x 2 points (y up) -> n x 2 integer (col, row) cells, distinct, row 0 at the top."""
    try:
        from scipy.optimize import linear_sum_assignment
    except ImportError as error:
        raise ProjectionUnavailable(str(error)) from error
    n = len(points)
    # Rank-equalised coordinates in lattice units: clumps spread before they compete for cells.
    gx = _ranks(points[:, 0]) * cols
    gy = (1 - _ranks(points[:, 1])) * rows
    out = np.zeros((n, 2), dtype=int)

    def solve(idx, c0, r0, c1, r1):
        w, h = c1 - c0, r1 - r0
        if not len(idx): return
        if w * h <= leaf:
            cc, rr = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
            cells = np.stack([cc.ravel() + 0.5, rr.ravel() + 0.5], 1)
            # Points are scaled into this block so its own spread fills it.
            px, py = gx[idx], gy[idx]
            sx = (px - px.min()) / max(px.max() - px.min(), 1e-9) * (w - 1) + c0 + 0.5 if len(idx) > 1 else np.full(1, c0 + w / 2)
            sy = (py - py.min()) / max(py.max() - py.min(), 1e-9) * (h - 1) + r0 + 0.5 if len(idx) > 1 else np.full(1, r0 + h / 2)
            cost = (sx[:, None] - cells[None, :, 0]) ** 2 + (sy[:, None] - cells[None, :, 1]) ** 2
            rows_i, cols_i = linear_sum_assignment(cost)
            out[idx[rows_i]] = np.floor(cells[cols_i]).astype(int)
            return
        if w >= h:
            k = c0 + w // 2; first = (k - c0) * h; coord = gx
            a, b = (c0, r0, k, r1), (k, r0, c1, r1)
        else:
            k = r0 + h // 2; first = (k - r0) * w; coord = gy
            a, b = (c0, r0, c1, k), (c0, k, c1, r1)
        total = w * h
        m = int(round(len(idx) * first / total))
        m = min(first, max(len(idx) - (total - first), m))
        order = idx[np.argsort(coord[idx], kind='stable')]
        solve(order[:m], *a); solve(order[m:], *b)

    solve(np.arange(n), 0, 0, cols, rows)
    return out


def assign(records, cache, image_of):
    """Project `records` in place. image_of(record) -> (content hash, cache-relative path).

    Identical images share one point (the wall's spacing pass separates them).
    Records whose derivative cannot be read keep no projection and are listed
    in the returned metadata. Raises ProjectionUnavailable before touching any
    record when the dependencies are missing.
    """
    digests, vectors, unreadable = [], [], []
    seen = {}
    for record in records:
        digest, relative = image_of(record)
        if digest in seen: continue
        try:
            with Image.open(Path(cache) / relative) as image:
                vectors.append(features(image))
            seen[digest] = len(digests); digests.append(digest)
        except Exception as error:  # a missing derivative must not abort the index
            unreadable.append({'path': relative, 'error': str(error)})
    # Sort by hash so the result does not depend on index order or thread timing.
    order = sorted(range(len(digests)), key=lambda i: digests[i])
    points = embed([vectors[i] for i in order]) if order else np.zeros((0, 2))
    point_of = {digests[i]: points[k] for k, i in enumerate(order)}
    # One cell per record, not per image: duplicates share a point but each
    # needs its own cell, and the assignment puts them side by side. Records
    # are ordered by (hash, id) so the grid does not depend on index order.
    placed = sorted((r for r in records if image_of(r)[0] in point_of),
                    key=lambda r: (image_of(r)[0], str(r.get('id', ''))))
    cols, rows = grid_shape(len(placed))
    cells = snap_to_grid(np.array([point_of[image_of(r)[0]] for r in placed]), cols, rows) \
        if placed else np.zeros((0, 2), dtype=int)
    for record in records:
        if image_of(record)[0] not in point_of: record.pop('projection', None)
    for record, cell in zip(placed, cells):
        p = point_of[image_of(record)[0]]
        record['projection'] = {'x': round(float(p[0]), 5), 'y': round(float(p[1]), 5),
                                'col': int(cell[0]), 'row': int(cell[1])}
    projected = len(placed)
    return {'method': METHOD, 'params': PARAMS, 'items': projected,
            'grid': {'cols': cols, 'rows': rows, 'aspect': GRID_ASPECT, 'leaf': GRID_LEAF,
                     'method': 'bisection + linear_sum_assignment'}, 'unique': len(digests),
            'unreadable': unreadable, 'generated': datetime.now().astimezone().isoformat()}


def image_record(record):
    return record['sha256'], record.get('overview') or record['thumbnail']


def album_record(album):
    cover = album['cover']
    return cover['sha256'], cover.get('overview') or cover['thumbnail']


def project_index(index, cache):
    """Project an index dict in place (images or albums); return its metadata."""
    if 'albums' in index: meta = assign(index['albums'], cache, album_record)
    else: meta = assign(index['images'], cache, image_record)
    index['projection'] = meta
    return meta


def carry_over(old_index, records, image_of):
    """Keep previous coordinates for unchanged images when projection is unavailable."""
    old = old_index.get('albums') or old_index.get('images') or []
    previous = {image_of(r)[0]: r['projection'] for r in old if r.get('projection')}
    for record in records:
        p = previous.get(image_of(record)[0])
        if p: record['projection'] = p
    return old_index.get('projection')


def refresh(records, cache, image_of, old_index):
    """The indexers' step: project, or keep the last coordinates if UMAP is absent."""
    try:
        return assign(records, cache, image_of)
    except ProjectionUnavailable as error:
        print(f'Similarity projection skipped ({error}); previous coordinates kept. '
              'See scripts/projection.py for the uv command.', flush=True)
        return carry_over(old_index, records, image_of)


def _atomic_json(file, data):
    fd, tmp = tempfile.mkstemp(prefix=file.name + '.', dir=file.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, file)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def run(config_file):
    config_file = Path(config_file).resolve()
    config = json.loads(config_file.read_text())
    cache = (config_file.parent / config['imageCache']).resolve()
    index_file = (config_file.parent / config['imageIndex']).resolve()
    index = json.loads(index_file.read_text())
    meta = project_index(index, cache)
    _atomic_json(index_file, index)
    print(f"Projected {meta['items']} items ({meta['unique']} distinct images; "
          f"{len(meta['unreadable'])} unreadable) with {METHOD} -> {index_file}", flush=True)
    return len(meta['unreadable'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(1 if run(args.config) else 0)
