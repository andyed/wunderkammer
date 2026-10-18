import test from 'node:test';
import assert from 'node:assert/strict';
import { containedRect, createReaderLift, createReaderMedia } from '../wall/reader-lift.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const box = (left = 0, top = 0, width = 100, height = 100) => ({ left, top, width, height });
function image(src = 'thumbnail', rect = box()) {
  return {
    src, currentSrc: '', naturalWidth: 100, naturalHeight: 100, complete: true, isConnected: true,
    style: { visibility: '' }, rect, attributes: {}, removed: false,
    getBoundingClientRect() { return this.rect; },
    setAttribute(key, value) { this.attributes[key] = value; },
    remove() { this.removed = true; this.isConnected = false; },
    decode: () => Promise.resolve(),
    animate(frames, options) {
      const done = defer();
      this.animation = { frames, options, finished: done.promise, finish: done.resolve, cancel: () => done.reject(new Error('cancelled')) };
      return this.animation;
    },
  };
}
function documentFixture() {
  const ghosts = [];
  return { ghosts, doc: { createElement: () => image(), body: { append(node) { ghosts.push(node); } } } };
}

test('contain geometry travels with the artwork rather than the letterbox', () => {
  assert.deepEqual(containedRect(box(10, 20, 200, 100), 100, 100), box(60, 20, 100, 100));
  assert.deepEqual(containedRect(box(10, 20, 100, 200), 200, 100), box(10, 95, 100, 50));
  assert.equal(containedRect(box(0, 0, 0, 100), 100, 100), null);
});

test('close reverses from the visible interrupted pose, removes ghosts and restores visibility', async () => {
  const { doc, ghosts } = documentFixture();
  const lift = createReaderLift({ document: doc, reducedMotion: () => false });
  const source = image('thumbnail', box(10, 20, 100, 100));
  const reader = image('thumbnail', box(400, 50, 300, 300));
  const opening = lift.open({ source, image: reader });
  assert.equal(reader.style.visibility, 'hidden');
  assert.equal(lift.transitioning, true);
  assert.equal(ghosts[0].attributes['aria-hidden'], 'true');
  assert.equal(ghosts[0].draggable, false);
  // Browser geometry during WAAPI motion is the authority for interrupted return.
  ghosts[0].rect = box(200, 35, 200, 200);
  const closing = lift.close();
  assert.equal(ghosts[0].removed, true);
  assert.equal(ghosts[1].style.left, '200px');
  assert.equal(ghosts[1].animation.frames[1].transform, 'translate(-190px, -15px) scale(0.5, 0.5)');
  ghosts[1].animation.finish();
  await Promise.all([opening, closing]);
  assert.equal(reader.style.visibility, '');
  assert.equal(lift.transitioning, false);
  assert.ok(ghosts.every(ghost => ghost.removed));
});

test('spatial source rectangles work without promoted DOM, close may resolve current origin', async () => {
  const { doc, ghosts } = documentFixture();
  const lift = createReaderLift({ document: doc, reducedMotion: () => false });
  const reader = image('detail', box(400, 50, 300, 300));
  const opening = lift.open({ sourceRect: box(5, 10, 80, 80), sourceSrc: 'atlas-cover', image: reader });
  assert.equal(ghosts[0].src, 'atlas-cover');
  ghosts[0].animation.finish(); await opening;
  const closing = lift.close({ sourceRect: box(20, 30, 60, 60) });
  assert.equal(ghosts[1].animation.frames[1].transform, 'translate(-380px, -20px) scale(0.2, 0.2)');
  lift.cancel(); await closing;
  assert.equal(reader.style.visibility, '');
});

test('reduced motion and missing origins snap without ghosts or a competing selection', async () => {
  const { doc, ghosts } = documentFixture();
  const reader = image();
  const reduced = createReaderLift({ document: doc, reducedMotion: () => true });
  await reduced.open({ sourceRect: box(), image: reader }); await reduced.close();
  const normal = createReaderLift({ document: doc, reducedMotion: () => false });
  await normal.open({ image: reader }); await normal.close();
  assert.equal(ghosts.length, 0);
  assert.equal(reader.style.visibility, '');
});

test('close can use the current reader after preview rerender replaces its image', async () => {
  const { doc, ghosts } = documentFixture();
  const lift = createReaderLift({ document: doc, reducedMotion: () => false });
  const old = image('thumbnail', box(400, 50, 300, 300));
  const opening = lift.open({ sourceRect: box(), image: old });
  lift.cancel(); await opening; old.remove();
  const current = image('current-full', box(400, 50, 300, 300));
  const closing = lift.close({ image: current, sourceRect: box(10, 20, 100, 100) });
  assert.equal(ghosts.at(-1).src, 'current-full');
  assert.equal(current.style.visibility, 'hidden');
  lift.cancel(); await closing;
  assert.equal(current.style.visibility, '');
});

test('closing before an unmeasured reader decodes cancels delayed travel', async () => {
  const { doc, ghosts } = documentFixture();
  const lift = createReaderLift({ document: doc, reducedMotion: () => false });
  const reader = image('thumbnail', box(0, 0, 0, 0));
  const decoded = defer(); reader.decode = () => decoded.promise;
  const opening = lift.open({ sourceRect: box(), image: reader });
  assert.equal(lift.transitioning, true);
  await lift.close(); await opening;
  reader.rect = box(400, 50, 300, 300); decoded.resolve(); await tick();
  assert.equal(ghosts.length, 0);
  assert.equal(lift.transitioning, false);
});

test('a stale decode cannot replace a newer selection, gallery choice, or closed reader', async () => {
  const loads = new Map();
  const media = createReaderMedia({ reducedMotion: () => true, loadImage: src => {
    const pending = defer(); loads.set(src, pending); return pending.promise;
  } });
  const target = image();
  const first = media.prepareImage(target, { cover: 'thumb-a', detailCover: 'full-a' });
  assert.equal(target.src, 'thumb-a');
  const second = media.prepareImage(target, { cover: 'thumb-b', detailCover: 'full-b' });
  await tick();
  loads.get('full-a').resolve(image('full-a')); assert.equal(await first, false);
  assert.equal(target.src, 'thumb-b');
  loads.get('full-b').resolve(image('full-b')); assert.equal(await second, true);
  const gallery = media.prepareImage(target, { cover: 'thumb-c', detailCover: 'full-c' });
  await tick(); target.src = 'deliberate-alternate';
  loads.get('full-c').resolve(image('full-c')); assert.equal(await gallery, false);
  assert.equal(target.src, 'deliberate-alternate');
  const closing = media.prepareImage(target, { cover: 'thumb-d', detailCover: 'full-d' });
  await tick(); media.cancel(); loads.get('full-d').resolve(image('full-d'));
  assert.equal(await closing, false); assert.equal(target.src, 'thumb-d');
});

test('decode failure retains the thumbnail and does not poison later attempts', async () => {
  let attempts = 0;
  const media = createReaderMedia({ reducedMotion: () => true, loadImage: async src => {
    if (++attempts === 1) throw new Error('offline'); return image(src);
  } });
  const target = image();
  assert.equal(await media.prepareImage(target, { cover: 'thumb', detailCover: 'large' }), false);
  assert.equal(target.src, 'thumb');
  assert.equal(await media.prepareImage(target, { cover: 'thumb', detailCover: 'large' }), true);
  assert.equal(target.src, 'large');
});

test('speculation reserves a worker for current demand and stays bounded', async () => {
  const starts = [], loads = new Map();
  const media = createReaderMedia({ maxEntries: 3, reducedMotion: () => true, loadImage: (src, priority) => {
    starts.push([src, priority]); const pending = defer(); loads.set(src, pending); return pending.promise;
  } });
  const prefetched = media.prefetch([{ cover: 'next' }, { cover: 'prev' }, { cover: 'too-far' }]);
  await tick(); assert.deepEqual(starts, [['next', 1]]);
  const demanded = media.prepareImage(image(), { cover: 'current' });
  await tick(); assert.deepEqual(starts, [['next', 1], ['current', 0]]);
  loads.get('current').resolve(image('current')); await demanded;
  loads.get('next').resolve(image('next')); await tick();
  assert.deepEqual(starts[2], ['prev', 1]);
  loads.get('prev').resolve(image('prev')); await prefetched;
  for (let i = 0; i < 8; i++) {
    const promise = media.prepareImage(image(), { cover: `more-${i}` });
    await tick(); loads.get(`more-${i}`).resolve(image(`more-${i}`)); await promise;
    assert.ok(media.stats().entries <= 3);
  }
  assert.ok(!starts.some(([src]) => src === 'too-far'));
  media.dispose(); assert.equal(media.stats().entries, 0);
});

test('high-resolution replacement crossfades matching geometry and cancellation clears overlay', async () => {
  const { doc, ghosts } = documentFixture();
  const media = createReaderMedia({ document: doc, reducedMotion: () => false, loadImage: async src => image(src) });
  const target = image('thumb', box(100, 40, 200, 100));
  await media.prepareImage(target, { cover: 'thumb', detailCover: 'full' });
  assert.equal(target.src, 'full');
  assert.equal(ghosts[0].src, 'thumb');
  assert.equal(ghosts[0].style.left, '150px');
  assert.equal(ghosts[0].style.width, '100px');
  media.cancel(); await tick();
  assert.equal(ghosts[0].removed, true);
});

test('an uncached receiving image keeps its decoded thumbnail until its own decode finishes', async () => {
  const { doc, ghosts } = documentFixture();
  const thumbnailDecoded = defer(), targetDecoded = defer();
  doc.createElement = () => { const ghost = image(); ghost.decode = () => thumbnailDecoded.promise; return ghost; };
  const media = createReaderMedia({ document: doc, reducedMotion: () => false, loadImage: async src => image(src) });
  const target = image('thumb'); target.decode = () => targetDecoded.promise;
  const prepared = media.prepareImage(target, { cover: 'thumb', detailCover: 'full' });
  await tick();
  assert.equal(target.src, 'thumb', 'the original stays put while the clone decodes');
  thumbnailDecoded.resolve(); await tick();
  assert.equal(target.src, 'full');
  assert.equal(ghosts[0].removed, false, 'decoded thumbnail covers an uncached receiving element');
  assert.equal(ghosts[0].animation, undefined, 'crossfade waits for the receiving decode');
  targetDecoded.resolve(); assert.equal(await prepared, true);
  assert.ok(ghosts[0].animation);
  media.cancel();
});

test('a failed receiving request restores the thumbnail and clears its overlay', async () => {
  const { doc, ghosts } = documentFixture();
  const media = createReaderMedia({ document: doc, reducedMotion: () => false, loadImage: async src => image(src) });
  const target = image('thumb');
  target.decode = async () => { if (target.src === 'full') throw new Error('second request failed'); };
  assert.equal(await media.prepareImage(target, { cover: 'thumb', detailCover: 'full' }), false);
  assert.equal(target.src, 'thumb');
  assert.equal(ghosts[0].removed, true);
});
