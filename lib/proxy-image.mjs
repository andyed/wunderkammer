/**
 * Why an image must not be handed to the wall, or null when it may be.
 *
 * Chrome taints a canvas when it draws an SVG image that contains a
 * <foreignObject>, whatever its origin or CORS headers (measured in Chrome
 * 157 on 2026-11-14; an empty element is enough, and createImageBitmap passes
 * the taint on). The 3D view's tile atlases are canvases uploaded as textures.
 * One tainted draw makes every later upload of that atlas throw, and the
 * spatial view stops for the whole wall, not for the one tile. A harvested
 * page whose cover was a vendor's logo did exactly that to a 544-item wall.
 *
 * A refused cover costs that one item its picture. The check reads the body
 * because the type alone cannot tell: most SVG is harmless.
 *
 * @param {string} type the response's media type, parameters removed
 * @param {Buffer} body the response body
 * @returns {string|null} the reason to refuse, for the error message
 */
export function canvasHazard(type, body) {
  if (!/^image\/svg\+xml$/i.test(type)) return null;
  // Gzip magic: an .svgz body cannot be read here, so it cannot be cleared.
  if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) return 'compressed SVG cannot be checked for foreignObject';
  // Tag names are ASCII in every encoding; dropping NULs reads UTF-16 as well.
  const text = body.toString('latin1').replace(/\0/g, '');
  // With or without a namespace prefix (<svg:foreignObject>).
  if (/<(?:[\w.-]+:)?foreignObject[\s/>]/i.test(text)) return 'SVG with foreignObject taints a canvas';
  return null;
}
