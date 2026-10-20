#!/usr/bin/env node
/**
 * Show a collection document from anywhere on this machine in the wall:
 *
 *   node scripts/show-collection.mjs ~/dog-wall/collection.json [--view 'view=warehouse&group=year'] [--port 8080]
 *
 * Serves this checkout at / and the document's folder at /__collection/, as
 * scripts/still.mjs does, on 127.0.0.1 only, and prints the wall's link (and
 * the comparison page's). Covers and photos named relative to the document
 * resolve as they would on a static host. Stop it with Ctrl-C.
 */
import { stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { serve } from './still.mjs';

const USAGE = "usage: node scripts/show-collection.mjs <collection.json> [--view '<link keys>'] [--port 8080]";
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  view: { type: 'string', default: '' }, port: { type: 'string', default: '0' }, help: { type: 'boolean', default: false } } });
if (values.help || positionals.length !== 1) { console.log(USAGE); process.exit(values.help ? 0 : 1); }
const file = path.resolve(positionals[0]);
if (!(await stat(file).catch(() => null))?.isFile()) { console.error(`show-collection: no file at ${file}`); process.exit(1); }
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error(`show-collection: --port is 0 to 65535 (got ${values.port})`); process.exit(1); }

const server = await serve(path.dirname(file), port);
const origin = `http://127.0.0.1:${server.address().port}`;
const wall = new URL('/index.html', origin);
wall.searchParams.set('collection', `/__collection/${encodeURIComponent(path.basename(file))}`);
for (const [key, value] of new URLSearchParams(values.view.replace(/^\?/, ''))) wall.searchParams.append(key, value);
const compare = new URL('/wall/compare.html', origin);
compare.searchParams.set('collection', wall.searchParams.get('collection'));
console.log(`${path.basename(file)} from ${path.dirname(file)}\n\nWall:        ${wall.href}\nWarehouse:   ${wall.href}${wall.searchParams.has('view') ? '' : '&view=warehouse'}\nComparison:  ${compare.href}\n\nCtrl-C stops it.`);
