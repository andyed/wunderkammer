/**
 * Intrinsic dimensions from an image buffer's header bytes.
 *
 * The wall lays out justified rows, which needs an aspect ratio BEFORE the
 * image loads — without it every tile reflows on load and the whole canvas
 * shudders. Reading four container formats here is cheaper than a dependency
 * and cheaper than the reflow.
 *
 * Returns null for anything unrecognized; callers fall back to measuring the
 * decoded image in the browser.
 */

/** @returns {{w:number,h:number}|null} */
export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  return png(buf) || gif(buf) || webp(buf) || jpeg(buf) || null;
}

function png(b) {
  // \x89PNG\r\n\x1a\n then IHDR at byte 16
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function gif(b) {
  if (b.toString('ascii', 0, 3) !== 'GIF') return null;
  return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
}

function webp(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fmt = b.toString('ascii', 12, 16);
  if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (fmt === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fmt === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
  return null;
}

function jpeg(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0-SOF15, excluding the non-frame markers DHT(c4), JPG(c8), DAC(cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    const len = b.readUInt16BE(i + 2);
    if (!Number.isFinite(len) || len < 2) return null;
    i += 2 + len;
  }
  return null;
}
