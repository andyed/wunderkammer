import test from 'node:test';
import assert from 'node:assert/strict';
import { suppressClips, suppressedHosts } from '../lib/suppress.mjs';

const clips = [
  { url: 'https://github.com/a/b', source: 'github.com' },
  { url: 'https://gist.github.com/x', source: 'gist.github.com' },
  { url: 'https://www.github.com/c/d' },
  { url: 'https://notgithub.com/e', source: 'notgithub.com' },
  { url: 'https://apps.apple.com/us/app/id1', source: 'apps.apple.com' },
];

test('suppressed hosts and their subdomains leave the corpus; look-alike hosts stay', () => {
  const kept = suppressClips(clips, { suppressSources: ['GitHub.com'] });
  assert.deepEqual(kept.map((c) => c.url), ['https://notgithub.com/e', 'https://apps.apple.com/us/app/id1']);
});

test('no setting, or a malformed one, returns the corpus unchanged', () => {
  assert.equal(suppressClips(clips, {}), clips);
  assert.equal(suppressClips(clips, { suppressSources: 'github.com' }), clips);
  assert.deepEqual(suppressedHosts({ suppressSources: ['', 3, ' www.Example.com '] }), ['example.com']);
});
