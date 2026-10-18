/**
 * Positions for the floating space. Pure: no DOM, no three.js, no camera.
 *
 * Every position means something. In the colour arrangements an item sits at
 * its dominant colour (`palette[0]`, the largest median-cut cluster), so
 * nearness is colour similarity; in A–Z it sits in reading order. HotSauce
 * floated a folder tree in 3D and the depth restated what the tree already
 * said. Here the third axis is a third colour coordinate, or, for A–Z, absent:
 * an alphabetical order has one dimension and the wall says so.
 */

/** World units per OKLab unit of lightness. */
export const WORLD = 2000;
/** Upper bound on the a/b stretch (see chromaStretch). */
export const MAX_STRETCH = 4;
/** Cylinder radius for OKLCH and HSL. */
export const RADIUS = 700;
export const ARRANGEMENTS = Object.freeze(['oklab', 'oklch', 'hsl', 'az']);
export const ARRANGEMENT_LABELS = Object.freeze({ oklab: 'OKLab', oklch: 'OKLCH', hsl: 'HSL', az: 'A–Z' });
export const isArrangement = value => ARRANGEMENTS.includes(value);

const HEX = /^#([0-9a-f]{6})$/i;
/** `#rrggbb` → [r, g, b] in 0..1, or null. */
export function parseHex(hex) {
  const m = typeof hex === 'string' ? HEX.exec(hex) : null;
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
/** The colour an item is placed by: its palette's first (dominant) entry. */
export const dominantColor = clip => Array.isArray(clip?.palette) ? parseHex(clip.palette[0]) : null;

const linear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
/** sRGB (0..1) → OKLab [L, a, b] (Ottosson 2020). */
export function oklab([r, g, b]) {
  const R = linear(r), G = linear(g), B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
/** OKLab → [L, C, h°]. Hue is meaningless below a chroma of ~0.02; callers
 * that order by hue put those first. */
export function oklch(lab) {
  const [L, a, b] = lab, C = Math.hypot(a, b);
  return [L, C, (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}
/** sRGB (0..1) → [h°, s, l]. */
export function hsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, Math.min(1, s), l];
}

/** Same fallback as layout.mjs: a clip with no usable dims is assumed 4:3. */
export function aspectOf(clip) {
  const m = String(clip?.props?.dims?.[0] || clip?.props?.dims || '').match(/^(\d+)x(\d+)$/);
  const w = Number(m?.[1]), h = Number(m?.[2]);
  return w > 0 && h > 0 ? Math.min(4, Math.max(0.3, w / h)) : 4 / 3;
}

/** The A–Z shelf a title belongs on. */
export function shelfOf(title) {
  const c = String(title || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : /[0-9]/.test(c) ? '0–9' : '#';
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const SHELF_ORDER = shelf => shelf === '0–9' ? -1 : shelf === '#' ? 99 : shelf.charCodeAt(0);

/**
 * Tile edge for a space of `n` items: the square side a tile would have if the
 * items shared the colour volume evenly, shrunk so neighbours rarely touch.
 * Tiles keep this AREA whatever their aspect, so a panorama is not ten times
 * the presence of a portrait.
 */
export function tileEdge(n) { return Math.min(150, Math.max(30, WORLD * 0.34 / Math.cbrt(Math.max(1, n)))); }
const sized = (aspect, edge) => [edge * Math.sqrt(aspect), edge / Math.sqrt(aspect)];
const quantile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) * p)] : 0; };

/**
 * One factor applied to both a and b, so hue angles stay exact and only the
 * chroma-to-lightness proportion changes. Collections of covers and
 * screenshots span four times as much lightness as chroma (measured: 0.51 vs
 * 0.21 for the Psychodeli example, 0.90 vs 0.18 for a 1,793-album library),
 * and unstretched they stand in a needle down the middle of the stage. The
 * factor is rounded to a half and printed on the axis label; 1 means true
 * OKLab proportions.
 */
export function chromaStretch(labs) {
  if (labs.length < 2) return 1;
  const span = axis => quantile(labs.map(l => l[axis]), 0.95) - quantile(labs.map(l => l[axis]), 0.05);
  const ab = Math.max(span(1), span(2), 1e-3);
  return Math.min(MAX_STRETCH, Math.max(1, Math.round(0.8 * span(0) / ab * 2) / 2));
}

/**
 * Place every clip. Returns typed arrays indexed like `clips`:
 *   positions  — the arranged centre, after declumping
 *   exact      — the arranged centre before declumping (what the colour says)
 *   sizes      — tile width and height
 *   order      — indices in the arrangement's own reading order (hue, or title)
 * plus bounds, labels and guide geometry for the renderer.
 */
export function arrange(clips, arrangement, { edge = tileEdge(clips.length) } = {}) {
  if (!isArrangement(arrangement)) throw new Error(`Unknown arrangement: ${arrangement}`);
  const n = clips.length, positions = new Float32Array(n * 3), sizes = new Float32Array(n * 2);
  const labels = [], guides = [];
  let order, unplaced = [], stretch = 1;
  for (let i = 0; i < n; i++) { const [w, h] = sized(aspectOf(clips[i]), edge); sizes[i * 2] = w; sizes[i * 2 + 1] = h; }
  if (arrangement === 'az') {
    order = alphabetical(clips, positions, sizes, edge, labels);
  } else {
    const colors = clips.map(dominantColor), keys = new Array(n), labs = colors.filter(Boolean).map(oklab);
    // Chroma reference for OKLCH: the 95th percentile, so one neon outlier does
    // not press every muted cover against the axis.
    const cref = Math.max(0.04, quantile(labs.map(l => Math.hypot(l[1], l[2])), 0.95) || 0.2);
    if (arrangement === 'oklab') stretch = chromaStretch(labs);
    for (let i = 0; i < n; i++) {
      const rgb = colors[i];
      if (!rgb) { unplaced.push(i); continue; }
      const lab = oklab(rgb), [L, C, h] = oklch(lab);
      let x, y, z;
      if (arrangement === 'oklab') { x = lab[1] * WORLD * stretch; y = (L - 0.5) * WORLD; z = lab[2] * WORLD * stretch; }
      else if (arrangement === 'oklch') {
        // Same hue angle as OKLab's a/b plane, so switching between the two
        // moves items only radially. Radius is chroma relative to the
        // collection, which spreads muted covers out where hue can be read.
        const r = RADIUS * Math.sqrt(Math.min(1, C / cref)), t = h * Math.PI / 180;
        x = r * Math.cos(t); y = (L - 0.5) * WORLD; z = r * Math.sin(t);
      } else {
        // The HSL bicone: radius is HSL chroma (max − min), not saturation.
        // Saturation is unstable at the ends: #010300 has S = 1, and on a
        // cylinder it would sit at full radius beside the vivid colours.
        const [H, S, Lh] = hsl(rgb), r = RADIUS * S * (1 - Math.abs(2 * Lh - 1)), t = H * Math.PI / 180;
        x = r * Math.cos(t); y = (Lh - 0.5) * WORLD; z = r * Math.sin(t);
      }
      positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
      // Reading order around the wheel: achromatic first by lightness, then by hue.
      const hue = arrangement === 'hsl' ? hsl(rgb)[0] : h;
      keys[i] = [C < 0.02 ? -1 : hue, L];
    }
    order = [...Array(n).keys()].filter(i => keys[i]).sort((a, b) => keys[a][0] - keys[b][0] || keys[a][1] - keys[b][1] || a - b);
    colourGuides(arrangement, positions, order, stretch, labels, guides);
  }
  const exact = positions.slice();
  const declumped = arrangement === 'az' ? { moved: 0, maxShift: 0, meanShift: 0 }
    : declump(positions, order, edge * 0.6, edge * 0.6);
  if (unplaced.length) shelve(clips, unplaced, positions, exact, sizes, edge, labels);
  order = order.concat(unplaced);
  return { arrangement, edge, stretch, positions, exact, sizes, order, labels, guides, unplaced: unplaced.length,
    declumped, bounds: boundsOf(positions, sizes, n) };
}

/** Rows of a flat wall, one shelf per initial, alphabetical within it. */
function alphabetical(clips, positions, sizes, edge, labels) {
  const order = [...clips.keys()].sort((a, b) => SHELF_ORDER(shelfOf(clips[a].title)) - SHELF_ORDER(shelfOf(clips[b].title))
    || collator.compare(String(clips[a].title || ''), String(clips[b].title || '')) || a - b);
  const cellW = edge * 1.55, cellH = edge * 1.15, n = clips.length;
  const cols = Math.max(6, Math.ceil(Math.sqrt(n * 1.6 * cellH / cellW)));
  const rows = [];
  let shelf = null, col = cols, row = -1;
  for (const i of order) {
    const s = shelfOf(clips[i].title);
    if (s !== shelf || col >= cols) {
      row += s !== shelf && shelf !== null ? 1.35 : 1; col = 0;
      if (s !== shelf) { labels.push({ text: s, kind: 'shelf', row }); shelf = s; }
    }
    rows.push([i, col++, row]);
    // Contain the tile in its cell: the wall is a grid, so sizes may shrink.
    const w = sizes[i * 2], h = sizes[i * 2 + 1], k = Math.min(1, cellW * 0.92 / w, cellH * 0.9 / h);
    sizes[i * 2] = w * k; sizes[i * 2 + 1] = h * k;
  }
  const width = cols * cellW, height = (row + 1) * cellH;
  for (const [i, c, r] of rows) {
    positions[i * 3] = -width / 2 + (c + 0.5) * cellW;
    positions[i * 3 + 1] = height / 2 - (r + 0.5) * cellH;
    positions[i * 3 + 2] = 0;
  }
  for (const label of labels) label.point = [-width / 2 - cellW * 0.45, height / 2 - (label.row + 0.5) * cellH, 0];
  return order;
}

/** Items with no palette cannot be placed by colour. They wait on a shelf below
 * the space, named, rather than being dropped or parked at the origin. */
function shelve(clips, indices, positions, exact, sizes, edge, labels) {
  let minY = Infinity, minYSet = false;
  for (let i = 0; i < clips.length; i++) if (!indices.includes(i)) { minY = Math.min(minY, positions[i * 3 + 1]); minYSet = true; }
  if (!minYSet) minY = -WORLD / 2;
  const cell = edge * 1.6, cols = Math.max(4, Math.ceil(Math.sqrt(indices.length * 2.5)));
  const top = minY - edge * 3;
  indices.forEach((i, k) => {
    const c = k % cols, r = Math.floor(k / cols);
    positions[i * 3] = exact[i * 3] = (c - (cols - 1) / 2) * cell;
    positions[i * 3 + 1] = exact[i * 3 + 1] = top - r * cell * 0.8;
    positions[i * 3 + 2] = exact[i * 3 + 2] = 0;
    const w = sizes[i * 2], h = sizes[i * 2 + 1], k2 = Math.min(1, cell * 0.9 / w, cell * 0.7 / h);
    sizes[i * 2] = w * k2; sizes[i * 2 + 1] = h * k2;
  });
  labels.push({ text: `No palette · ${indices.length}`, kind: 'shelf', point: [-(cols / 2 + 0.6) * cell, top, 0] });
}

const OKLCH_HUES = [['red', 29], ['yellow', 110], ['green', 142], ['cyan', 195], ['blue', 264], ['magenta', 328]];
const HSL_HUES = [['red', 0], ['yellow', 60], ['green', 120], ['cyan', 180], ['blue', 240], ['magenta', 300]];
/**
 * Axis and hue-ring labels, and the line segments drawn under them. They span
 * the collection's own range and print its extremes, so the guides say where
 * this collection sits, not where colour space could reach.
 */
function colourGuides(arrangement, positions, placed, stretch, labels, guides) {
  if (!placed.length) return;
  const range = axis => { let lo = Infinity, hi = -Infinity; for (const i of placed) { lo = Math.min(lo, positions[i * 3 + axis]); hi = Math.max(hi, positions[i * 3 + axis]); } return [lo, hi]; };
  const [bottom, top] = range(1), mid = (bottom + top) / 2, lightness = y => (y / WORLD + 0.5).toFixed(2);
  const name = arrangement === 'hsl' ? 'HSL lightness' : 'L';
  guides.push([[0, bottom, 0], [0, top, 0]]);
  labels.push({ text: `${name} ${lightness(top)} · lightest`, kind: 'axis', point: [0, top + 50, 0] },
    { text: `${name} ${lightness(bottom)} · darkest`, kind: 'axis', point: [0, bottom - 50, 0] });
  if (arrangement === 'oklab') {
    const [a0, a1] = range(0), [b0, b1] = range(2), times = stretch === 1 ? '' : ` (a, b ×${stretch})`;
    guides.push([[a0, mid, 0], [a1, mid, 0]], [[0, mid, b0], [0, mid, b1]]);
    labels.push({ text: `+a · red${times}`, kind: 'axis', point: [a1 + 40, mid, 0] }, { text: '−a · green', kind: 'axis', point: [a0 - 40, mid, 0] },
      { text: '+b · yellow', kind: 'axis', point: [0, mid, b1 + 40] }, { text: '−b · blue', kind: 'axis', point: [0, mid, b0 - 40] });
    return;
  }
  const ring = [], steps = 72;
  for (let k = 0; k <= steps; k++) { const t = k / steps * Math.PI * 2; ring.push([RADIUS * Math.cos(t), mid, RADIUS * Math.sin(t)]); }
  for (let k = 0; k < steps; k++) guides.push([ring[k], ring[k + 1]]);
  for (const [hue, deg] of arrangement === 'hsl' ? HSL_HUES : OKLCH_HUES) {
    const t = deg * Math.PI / 180, r = RADIUS + 70;
    labels.push({ text: `${hue} · ${deg}°`, kind: 'hue', point: [r * Math.cos(t), mid, r * Math.sin(t)] });
  }
  labels.push({ text: arrangement === 'hsl' ? 'radius · HSL chroma' : 'radius · relative chroma', kind: 'axis', point: [RADIUS * 0.5, mid - 40, 0] });
}

/**
 * Pull apart tiles that would sit on top of each other: identical dominant
 * colours are common (black covers, white screenshots) and would z-fight.
 * Bounded so a tile never leaves the neighbourhood its colour gives it:
 * no tile moves more than `cap` from its exact position.
 */
export function declump(positions, indices, minDist, cap, iterations = 4) {
  if (!(minDist > 0) || indices.length < 2) return { moved: 0, maxShift: 0, meanShift: 0 };
  const origin = new Map(indices.map(i => [i, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]]));
  const cell = minDist, keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let pass = 0; pass < iterations; pass++) {
    const grid = new Map();
    for (const i of indices) {
      const k = keyOf(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
    }
    let pushed = 0;
    for (const i of indices) {
      const cx = Math.floor(positions[i * 3] / cell), cy = Math.floor(positions[i * 3 + 1] / cell), cz = Math.floor(positions[i * 3 + 2] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
          if (j <= i) continue;
          let vx = positions[i * 3] - positions[j * 3], vy = positions[i * 3 + 1] - positions[j * 3 + 1], vz = positions[i * 3 + 2] - positions[j * 3 + 2];
          let d = Math.hypot(vx, vy, vz);
          if (d >= minDist) continue;
          if (d < 1e-6) {
            // Coincident: a fixed direction from the pair, so the result is
            // the same on every load.
            const a = (i * 12.9898 + j * 78.233) % (Math.PI * 2);
            vx = Math.cos(a); vy = Math.sin(a) * 0.5; vz = Math.sin(a); d = Math.hypot(vx, vy, vz);
            vx /= d; vy /= d; vz /= d; d = 0;
          } else { vx /= d; vy /= d; vz /= d; }
          const push = (minDist - d) / 2;
          positions[i * 3] += vx * push; positions[i * 3 + 1] += vy * push; positions[i * 3 + 2] += vz * push;
          positions[j * 3] -= vx * push; positions[j * 3 + 1] -= vy * push; positions[j * 3 + 2] -= vz * push;
          pushed++;
        }
      }
    }
    for (const i of indices) {
      const o = origin.get(i), dx = positions[i * 3] - o[0], dy = positions[i * 3 + 1] - o[1], dz = positions[i * 3 + 2] - o[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > cap) { const k = cap / d; positions[i * 3] = o[0] + dx * k; positions[i * 3 + 1] = o[1] + dy * k; positions[i * 3 + 2] = o[2] + dz * k; }
    }
    if (!pushed) break;
  }
  let moved = 0, maxShift = 0, total = 0;
  for (const i of indices) {
    const o = origin.get(i), d = Math.hypot(positions[i * 3] - o[0], positions[i * 3 + 1] - o[1], positions[i * 3 + 2] - o[2]);
    if (d > 1e-3) moved++; maxShift = Math.max(maxShift, d); total += d;
  }
  return { moved, maxShift, meanShift: total / indices.length };
}

function boundsOf(positions, sizes, n) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const half = k === 2 ? 0 : sizes[i * 2 + k] / 2;
    min[k] = Math.min(min[k], positions[i * 3 + k] - half); max[k] = Math.max(max[k], positions[i * 3 + k] + half);
  }
  if (!n) { min.fill(-WORLD / 2); max.fill(WORLD / 2); }
  const centre = min.map((v, k) => (v + max[k]) / 2);
  const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  return { min, max, centre, radius };
}
