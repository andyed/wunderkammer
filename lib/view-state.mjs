import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

const MAX_BYTES = 4 << 20;
const JSON_TYPE = 'application/json; charset=utf-8';

function parseState(body) {
  let state;
  try {
    state = JSON.parse(body);
  } catch (err) {
    throw Object.assign(new Error(`not JSON: ${err.message}`), { status: 400 });
  }
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  // {} is the original empty-state response. Keep it valid for existing callers.
  const empty = object(state) && Object.keys(state).length === 0;
  const valid = object(state) && state.version === 1 && Array.isArray(state.piles)
    && state.piles.every((pile) => object(pile)
      && typeof pile.label === 'string'
      && Number.isFinite(pile.u) && Number.isFinite(pile.v)
      && Array.isArray(pile.keys) && pile.keys.every((key) => typeof key === 'string'));
  if (!empty && !valid) {
    throw Object.assign(new Error('invalid view state: expected version 1 piles with label, u, v and string keys'), { status: 400 });
  }
  return state;
}

/** One queue per document: the last successfully saved, accepted request wins.
 * Acceptance occurs after the complete request body passes validation, not when
 * a connection opens. This is also the policy for saves from different tabs.
 */
export function createViewStateStore(file, { io = fs } = {}) {
  let pending = Promise.resolve();

  async function replace(body) {
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    let created = false;
    let committed = false;
    try {
      // Never share a temporary inode with another request or server process.
      handle = await io.open(tmp, 'wx', 0o600);
      created = true;
      await handle.writeFile(body, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await io.rename(tmp, file);
      committed = true;
    } finally {
      if (handle) await handle.close().catch(() => {});
      // Failed writes must leave the previous document intact and must not
      // poison the queue. Clean up only this request's temporary file.
      if (created && !committed) await io.unlink(tmp).catch(() => {});
    }
  }

  return {
    async read() {
      await pending;
      let body;
      try {
        body = await io.readFile(file, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return '{}';
        throw err;
      }
      try {
        parseState(body);
      } catch (err) {
        // An unreadable saved document is a server error, never an empty wall.
        throw new Error(`could not read saved view state: ${err.message}`);
      }
      return body;
    },
    save(body) {
      parseState(body);
      const saved = pending.then(() => replace(body));
      pending = saved.catch(() => {});
      return saved;
    },
  };
}

/** The production endpoint, separable from corpus loading for fixture tests. */
export function createViewStateHandler(file, options) {
  const store = createViewStateStore(file, options);
  const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache' });
    res.end(body);
  };
  return async (req, res) => {
    try {
      if (req.method === 'GET') return send(res, 200, await store.read(), JSON_TYPE);
      if (req.method !== 'PUT') return send(res, 405, 'GET or PUT');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) return send(res, 413, 'view state too large');
        chunks.push(chunk);
      }
      await store.save(Buffer.concat(chunks).toString('utf8'));
      return send(res, 200, '{"ok":true}', JSON_TYPE);
    } catch (err) {
      return send(res, err.status || 500, `view state: ${err.message}`);
    }
  };
}
