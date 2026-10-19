import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateCollection } from '../wall/collection.mjs';
import { validateObservations } from '../wall/observations.mjs';

// The skill's examples are what an agent copies first, so they must pass the
// validators the pages use, and agree with each other on the corpus.
const skill = await readFile(new URL('../skills/wunderkammer/SKILL.md', import.meta.url), 'utf8');
const blocks = [...skill.matchAll(/```json\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));

test('the skill\'s example collection and observations pass the page validators', () => {
  assert.equal(blocks.length, 2);
  const [doc, envelope] = blocks;
  const { collection } = validateCollection(doc, { baseUrl: 'https://example.org/cats/collection.json' });
  const { comparison } = validateObservations(envelope);
  assert.deepEqual(comparison.corpus, { id: collection.corpus.id, revision: collection.corpus.revision });
  assert.ok(Object.keys(collection.facets).includes(comparison.groupBy));
  assert.ok(Object.keys(collection.facets).includes(comparison.measure));
});

test('the skill names a validator script and contract that exist', async () => {
  for (const file of ['../scripts/validate-collection.mjs', '../scripts/collection-sheets.py', '../scripts/still.mjs', '../docs/CONTRACT.md', '../docs/SHOTS.md', '../wall/embed.mjs', '../wall/compare.html'])
    await readFile(new URL(file, import.meta.url));
});
