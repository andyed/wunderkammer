import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonical, validateView, MAX_VIEW_BYTES } from '../wall/permalink.mjs';
export const digest = data => createHash('sha256').update(data).digest('hex');
async function publish(file, body) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
    try { await fs.link(temp, file); } catch (err) { if (err.code !== 'EEXIST') throw err; }
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fs.unlink(temp).catch(() => {}); }
}
export async function instanceIdentity(file, configured) {
  if (configured) return String(configured);
  await publish(file, randomUUID());
  return (await fs.readFile(file, 'utf8')).trim();
}
export function createPermalinkHandler(directory) {
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  return async (req, res, id) => {
    try {
      if (req.method === 'GET' && /^[a-f0-9]{64}$/.test(id || '')) {
        const body = await fs.readFile(path.join(directory, `${id}.json`), 'utf8');
        if (digest(body) !== id) throw new Error('Snapshot integrity failure');
        return send(res, 200, validateView(JSON.parse(body)));
      }
      if (req.method !== 'POST' || id) return send(res, 405, { error: 'POST collection or GET snapshot' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: 'Origin mismatch' });
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Expected JSON' });
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > MAX_VIEW_BYTES) return send(res, 413, { error: 'Snapshot too large' }); chunks.push(chunk); }
      let view; try { view = validateView(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { return send(res, 400, { error: err.message }); }
      const body = canonical(view), key = digest(body), file = path.join(directory, `${key}.json`);
      await publish(file, body);
      if (await fs.readFile(file, 'utf8') !== body) throw new Error('Snapshot readback mismatch');
      return send(res, 201, { id: key });
    } catch (err) { return send(res, err.code === 'ENOENT' ? 404 : 500, { error: err.message }); }
  };
}
