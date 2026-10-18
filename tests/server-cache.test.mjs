import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

let dir, child, origin;
const hashName = `${'a'.repeat(64)}.webp`;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wunderkammer-cache-'));
  await mkdir(path.join(dir, 'cache'));
  await writeFile(path.join(dir, 'index.json'), JSON.stringify({ images: [] }));
  await writeFile(path.join(dir, 'cache', 'mutable.txt'), 'fixture');
  await writeFile(path.join(dir, 'cache', hashName), 'immutable fixture');
  await writeFile(path.join(dir, 'config.json'), JSON.stringify({
    adapters: ['images'], imageIndex: 'index.json', imageCache: 'cache',
  }));
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['serve.mjs', '--config', path.join(dir, 'config.json')], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server startup timeout: ${output}`)), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exit ${code}: ${output}`)); });
    child.stderr.on('data', data => { output += data; });
    child.stdout.on('data', data => {
      output += data;
      if (output.includes(`wunderkammer → ${origin}`)) { clearTimeout(timer); resolve(); }
    });
  });
});
after(async () => {
  if (child && child.exitCode === null) {
    const closed = once(child, 'exit'); child.kill(); await closed;
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});

function request(route, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${origin}${route}`, { headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

test('file validators revalidate unchanged data and give ETags precedence over dates', async () => {
  const first = await request('/media/mutable.txt');
  assert.equal(first.status, 200);
  assert.equal(first.headers['cache-control'], 'no-cache');
  const tag = first.headers.etag, date = first.headers['last-modified'];
  const changed = await request('/media/mutable.txt', {
    'if-none-match': 'W/"outdated"', 'if-modified-since': date,
  });
  assert.equal(changed.status, 200, 'a date match cannot override a stale ETag');
  assert.equal(changed.body.toString(), 'fixture');
  for (const headers of [{ 'if-none-match': tag }, { 'if-modified-since': date },
    { 'if-none-match': `"other", ${tag.replace(/^W\//, '')}` }, { 'if-none-match': '*' }]) {
    const response = await request('/media/mutable.txt', headers);
    assert.equal(response.status, 304, JSON.stringify(headers));
    assert.equal(response.body.length, 0);
  }
  assert.match((await request(`/media/${hashName}`)).headers['cache-control'], /immutable/);
});

test('clip index compression respects quality weights and exclusions and preserves the JSON', async () => {
  const plain = await request('/api/clips', { 'accept-encoding': 'identity' });
  assert.equal(plain.status, 200);
  assert.deepEqual(JSON.parse(plain.body).clips, []);
  const stable = body => { const { generated, ...data } = JSON.parse(body); assert.ok(Number.isFinite(Date.parse(generated))); return data; };
  for (const [accept, encoding] of [
    ['br, gzip', 'br'], ['br;q=0, gzip', 'gzip'], ['br;q=0.2, gzip;q=0.8', 'gzip'],
    ['br;q=0, gzip;q=0', undefined], ['gzip;q=0.5, identity;q=1', undefined],
    ['*;q=0.5, br;q=0', 'gzip'],
  ]) {
    const response = await request('/api/clips', { 'accept-encoding': accept });
    assert.equal(response.status, 200, accept);
    assert.equal(response.headers['content-encoding'], encoding, accept);
    assert.equal(response.headers.vary, 'accept-encoding');
    const body = encoding === 'br' ? brotliDecompressSync(response.body)
      : encoding === 'gzip' ? gunzipSync(response.body) : response.body;
    assert.deepEqual(stable(body), stable(plain.body), accept);
    assert.equal(Number(response.headers['content-length']), response.body.length);
  }
  assert.equal((await request('/api/clips', { 'accept-encoding': '*;q=0' })).status, 406);
});

test('clip index answers 304 to its own ETag and stays stable across requests', async () => {
  const first = await request('/api/clips', { 'accept-encoding': 'br' });
  assert.equal(first.status, 200);
  const etag = first.headers.etag;
  assert.match(etag, /^W\/"[0-9a-f]{32}"$/);
  // The body carries a fresh timestamp; the validator must not.
  const again = await request('/api/clips', { 'accept-encoding': 'gzip' });
  assert.equal(again.headers.etag, etag);
  const cached = await request('/api/clips', { 'accept-encoding': 'br', 'if-none-match': etag });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  const stale = await request('/api/clips', { 'accept-encoding': 'br', 'if-none-match': 'W/"0000"' });
  assert.equal(stale.status, 200);
});
