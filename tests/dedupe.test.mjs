import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeClips, pageKey, imageKey } from '../lib/dedupe.mjs';

const HASH = 'a'.repeat(64);
const clip = (id, extra) => ({ id, title: id, url: `https://example.test/${id}`, source: 'example.test', tags: [], ...extra });

test('page identity ignores fragments, locale and tracking parameters, not the real query', () => {
  assert.equal(pageKey('https://play.google.com/store/apps/details?id=x.y&hl=en_US'), pageKey('https://play.google.com/store/apps/details?id=x.y'));
  assert.equal(pageKey('https://www.Example.com/a/?utm_source=z#top'), pageKey('https://example.com/a'));
  assert.notEqual(pageKey('https://play.google.com/store/apps/details?id=a.b'), pageKey('https://play.google.com/store/apps/details?id=c.d'));
});

test('image identity is the attachment hash, else the remote image URL', () => {
  assert.equal(imageKey({ cover: `/media/attachments/${HASH}.webp` }), `hash:${HASH}`);
  assert.equal(imageKey({ cover: '/api/proxy?url=https%3A%2F%2Fcdn.test%2Fcard.png' }), 'url:https://cdn.test/card.png');
  assert.equal(imageKey({ cover: '' }), '');
});

test('off unless the instance opts in', () => {
  const clips = [clip('a', { cover: `/media/attachments/${HASH}.jpg` }), clip('b', { cover: `/media/attachments/${HASH}.jpg` })];
  assert.equal(dedupeClips(clips, {}), clips);
});

test('a shared default image collapses to one tile that lists the rest', () => {
  const card = 'https://cdn.test/site-default.png';
  const clips = [
    clip('x1', { cover: card, captured: '2026-09-01', props: { corpus: 'read' } }),
    clip('own', { cover: `/media/attachments/${HASH}.jpg` }),
    clip('x2', { cover: card, captured: '2026-09-20', props: { corpus: 'read' } }),
    clip('x3', { cover: card, captured: '2026-09-10', props: { corpus: 'read' } }),
  ];
  const out = dedupeClips(clips, { dedupe: true });
  assert.deepEqual(out.map((c) => c.id), ['own', 'x2'], 'most recent survives; adapters order otherwise kept');
  const x2 = out[1];
  assert.equal(x2.props.duplicates, 2);
  assert.deepEqual(x2.alsoAt.map((a) => a.url).sort(), ['https://example.test/x1', 'https://example.test/x3']);
  assert.equal(clips[2].alsoAt, undefined, 'input clips are not mutated');
});

test('a curated clip beats its harvested copy, whose generic card does not pull in other pages', async () => {
  const generic = 'https://cdn.test/store-default-card.png';
  const clips = [
    clip('read', { url: 'https://apps.apple.com/us/app/x/id1?uo=4', cover: generic, props: { corpus: 'read' } }),
    clip('curated', { url: 'https://apps.apple.com/us/app/x/id1', cover: `/media/attachments/${HASH}.jpg`, media: [{}, {}], props: { corpus: 'curated' } }),
    clip('other-app', { url: 'https://apps.apple.com/us/app/y/id2', cover: generic, props: { corpus: 'read' } }),
    clip('third-app', { url: 'https://apps.apple.com/us/app/z/id3', cover: generic, props: { corpus: 'read' } }),
  ];
  const out = dedupeClips(clips, { dedupe: true });
  assert.deepEqual(out.map((c) => c.id), ['curated', 'other-app'], 'x stays x; y and z share only a card');
  assert.deepEqual(out[0].alsoAt.map((a) => a.url), ['https://apps.apple.com/us/app/x/id1?uo=4']);
  assert.equal(out[0].props.duplicates, 1);
  assert.equal(out[1].props.duplicates, 1, 'the two harvested pages with the same card still collapse together');
});

test('copies absorbed in the page pass travel with their survivor into the image pass', () => {
  const clips = [
    clip('a1', { url: 'https://s.test/a', cover: 'https://cdn.test/one.png', captured: '2026-09-01', props: { corpus: 'read' } }),
    clip('a2', { url: 'https://s.test/a#x', cover: 'https://cdn.test/one.png', captured: '2026-09-02', props: { corpus: 'read' } }),
    clip('b', { url: 'https://s.test/b', cover: 'https://cdn.test/one.png', captured: '2026-09-03', props: { corpus: 'read' } }),
  ];
  const out = dedupeClips(clips, { dedupe: true });
  assert.deepEqual(out.map((c) => c.id), ['b']);
  assert.deepEqual(out[0].alsoAt.map((a) => a.url).sort(), ['https://s.test/a', 'https://s.test/a#x']);
});
