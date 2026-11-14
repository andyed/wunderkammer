import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasHazard } from '../lib/proxy-image.mjs';

const svg = (inner) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#2449ef"/>${inner}</svg>`);

test('a plain SVG and a raster image pass the proxy', () => {
  assert.equal(canvasHazard('image/svg+xml', svg('')), null);
  assert.equal(canvasHazard('image/svg+xml', svg('<text x="4" y="20">foreignObject is only a word here</text>')), null);
  // Not SVG: the bytes are never read as markup, whatever they spell.
  assert.equal(canvasHazard('image/png', Buffer.from('\x89PNG\r\n\x1a\n<foreignObject>')), null);
  assert.equal(canvasHazard('image/webp', Buffer.alloc(32)), null);
});

test('an SVG with a foreignObject is refused, however it is written', () => {
  const reason = /foreignObject taints a canvas/;
  assert.match(canvasHazard('image/svg+xml', svg('<foreignObject x="1" y="1" width="9" height="9"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>')), reason);
  assert.match(canvasHazard('image/svg+xml', svg('<foreignObject/>')), reason, 'an empty one taints too');
  assert.match(canvasHazard('image/svg+xml', svg('<foreignObject></foreignObject>')), reason);
  assert.match(canvasHazard('image/svg+xml', svg('<svg:foreignObject width="1" height="1"/>')), reason, 'with a namespace prefix');
  assert.match(canvasHazard('IMAGE/SVG+XML', svg('<foreignObject\n width="1"/>')), reason, 'type matched without regard to case');
  assert.match(canvasHazard('image/svg+xml', Buffer.from(svg('<foreignObject/>').toString(), 'utf16le')), reason, 'UTF-16 body');
});

test('a compressed SVG is refused because it cannot be read', () => {
  assert.match(canvasHazard('image/svg+xml', Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0])), /cannot be checked/);
});
