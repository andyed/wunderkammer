import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createViewStateHandler, createViewStateStore } from '../lib/view-state.mjs';

const document = (label) => ({
  version: 1,
  piles: [{ label, u: -12.3, v: 456.7, keys: ['https://example.test/clip', 'missing:retained'] }],
});

async function fixture(t, options) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wunderkammer-view-state-'));
  const file = path.join(dir, 'view-state.json');
  const server = http.createServer(createViewStateHandler(file, options));
  t.after(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/view-state`;
  return {
    dir, file,
    get: () => fetch(url),
    put: (body) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body }),
  };
}

test('GET and PUT preserve the existing API, empty state and unknown metadata', async (t) => {
  const f = await fixture(t);
  const absent = await f.get();
  assert.equal(absent.status, 200);
  assert.deepEqual(await absent.json(), {});
  const state = { ...document('research'), layout: { mode: 'piles' } };
  state.piles[0].custom = 'preserve this';
  const body = JSON.stringify(state);
  const saved = await f.put(body);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true });
  assert.equal(await (await f.get()).text(), body);
  assert.equal(await fs.readFile(f.file, 'utf8'), body);
  assert.equal((await f.put('{}')).status, 200);
  assert.deepEqual(await (await f.get()).json(), {});
});

test('twelve simultaneous HTTP saves all succeed and leave one complete document', async (t) => {
  const f = await fixture(t);
  const bodies = Array.from({ length: 12 }, (_, i) => JSON.stringify(document(`${i}:` + 'x'.repeat(i * 7901))));
  const responses = await Promise.all(bodies.map((body) => f.put(body)));
  for (const response of responses) {
    assert.equal(response.status, 200, await response.text());
  }
  const actual = await fs.readFile(f.file, 'utf8');
  assert.ok(bodies.includes(actual), 'the final file must exactly equal one accepted body');
  assert.equal(await (await f.get()).text(), actual);
  assert.deepEqual(await fs.readdir(f.dir), ['view-state.json']);
});

test('accepted saves replace the document in queue order', async (t) => {
  const f = await fixture(t);
  const committed = [];
  const store = createViewStateStore(f.file, { io: {
    ...fs,
    async rename(from, to) {
      committed.push(JSON.parse(await fs.readFile(from, 'utf8')).piles[0].label);
      return fs.rename(from, to);
    },
  } });
  const labels = Array.from({ length: 12 }, (_, i) => `accepted ${i}`);
  await Promise.all(labels.map((label) => store.save(JSON.stringify(document(label)))));
  assert.deepEqual(committed, labels);
  assert.equal(JSON.parse(await store.read()).piles[0].label, labels.at(-1));
});

test('the previous document remains readable until the complete replacement is renamed', async (t) => {
  const f = await fixture(t);
  const before = JSON.stringify(document('before'));
  const after = JSON.stringify(document('after'));
  await fs.writeFile(f.file, before);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let prepared;
  const ready = new Promise((resolve) => { prepared = resolve; });
  const store = createViewStateStore(f.file, { io: {
    ...fs,
    async rename(from, to) {
      prepared(from);
      await gate;
      return fs.rename(from, to);
    },
  } });
  const saved = store.save(after);
  const tmp = await ready;
  try {
    assert.equal(await fs.readFile(f.file, 'utf8'), before);
    assert.equal(await fs.readFile(tmp, 'utf8'), after);
  } finally {
    release();
  }
  await saved;
  assert.equal(await fs.readFile(f.file, 'utf8'), after);
  assert.deepEqual(await fs.readdir(f.dir), ['view-state.json']);
});

test('a partial write failure returns 500, preserves research and permits the next save', async (t) => {
  let fail = true;
  const f = await fixture(t, { io: {
    ...fs,
    async open(...args) {
      const handle = await fs.open(...args);
      return {
        async writeFile(body, encoding) {
          if (fail) {
            fail = false;
            await handle.writeFile(body.slice(0, 20), encoding);
            throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
          }
          return handle.writeFile(body, encoding);
        },
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
  } });
  const before = JSON.stringify(document('keep my research'));
  await fs.writeFile(f.file, before);
  const failed = await f.put(JSON.stringify(document('failed save')));
  assert.equal(failed.status, 500);
  assert.match(await failed.text(), /fixture disk full/);
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
  assert.deepEqual(await fs.readdir(f.dir), ['view-state.json']);
  const after = JSON.stringify(document('retry succeeds'));
  assert.equal((await f.put(after)).status, 200);
  assert.equal(await fs.readFile(f.file, 'utf8'), after);
});

test('a failed rename preserves the old file, cleans its temp file and does not poison later saves', async (t) => {
  const f = await fixture(t);
  let fail = true;
  const store = createViewStateStore(f.file, { io: {
    ...fs,
    async rename(...args) {
      if (fail) {
        fail = false;
        throw Object.assign(new Error('fixture rename denied'), { code: 'EACCES' });
      }
      return fs.rename(...args);
    },
  } });
  const before = JSON.stringify(document('original'));
  await fs.writeFile(f.file, before);
  await assert.rejects(store.save(JSON.stringify(document('failed'))), /fixture rename denied/);
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
  assert.deepEqual(await fs.readdir(f.dir), ['view-state.json']);
  const after = JSON.stringify(document('subsequent save'));
  await store.save(after);
  assert.equal(await store.read(), after);
});

test('invalid JSON, invalid state shapes and oversized requests never replace the last valid document', async (t) => {
  const f = await fixture(t);
  const before = JSON.stringify(document('preserved'));
  await fs.writeFile(f.file, before);
  const invalid = [
    '{', 'null', '[]', '{"piles":[]}', '{"version":2,"piles":[]}',
    JSON.stringify({ version: 1, piles: [null] }),
    JSON.stringify({ version: 1, piles: [{ label: 'bad', u: 0, v: 0, keys: [12] }] }),
    JSON.stringify({ version: 1, piles: [{ label: 'bad', u: null, v: 0, keys: [] }] }),
  ];
  for (const body of invalid) {
    const response = await f.put(body);
    assert.equal(response.status, 400, body);
    await response.text();
    assert.equal(await fs.readFile(f.file, 'utf8'), before);
  }
  const tooLarge = await f.put(JSON.stringify(document('x'.repeat(4 << 20))));
  assert.equal(tooLarge.status, 413);
  await tooLarge.text();
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
  assert.deepEqual(await fs.readdir(f.dir), ['view-state.json']);
});

test('GET reports existing unreadable or malformed documents instead of pretending they are empty', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.file, '{"broken"');
  const malformed = await f.get();
  assert.equal(malformed.status, 500);
  assert.match(await malformed.text(), /could not read saved view state/);
  await fs.unlink(f.file);
  await fs.mkdir(f.file);
  const unreadable = await f.get();
  assert.equal(unreadable.status, 500);
  await unreadable.text();
});
