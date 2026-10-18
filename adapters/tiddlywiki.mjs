/**
 * TiddlyWiki adapter — reads a tiddler JSON export.
 *
 * Exists to keep the store swappable rather than because the wall needs two.
 * Produce the input with TiddlyWiki's own export: filter `[all[tiddlers]tag[clip]]`
 * → "Export tiddlers" → JSON, saved to `config.tiddlers`.
 *
 * A tiddler's custom fields are already a flat string map, so the mapping is
 * near-identity; the only real work is TiddlyWiki's space-delimited tag syntax
 * and its own date format.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const id = 'tiddlywiki';

/** TiddlyWiki tags: space-delimited, with [[double bracketed]] for multiword. */
function parseTags(raw) {
  const s = String(raw || '');
  const out = [];
  const re = /\[\[([^\]]+)\]\]|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] || m[2]);
  return out;
}

/** TiddlyWiki stamps are YYYYMMDDhhmmssmmm. */
function parseDate(raw) {
  const s = String(raw || '');
  if (/^\d{8}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const KNOWN = new Set(['title', 'url', 'source', 'captured', 'kind', 'tags', 'media', 'text', 'created', 'modified', 'type', 'cover']);

export async function loadClips(config) {
  let tiddlers;
  try {
    tiddlers = JSON.parse(await readFile(config.tiddlers, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  if (!Array.isArray(tiddlers)) return [];

  return tiddlers.map((t) => {
    const media = String(t.media || '')
      .split(/\s+/)
      .filter(Boolean);
    const url = String(t.url || '');
    const props = {};
    for (const [k, v] of Object.entries(t)) {
      if (!KNOWN.has(k)) props[k] = v;
    }
    return {
      id: String(t.title || ''),
      title: String(t.title || ''),
      url,
      source: String(t.source || hostOf(url)),
      captured: parseDate(t.captured || t.created),
      kind: String(t.kind || (media.length ? 'image' : 'page')),
      tags: parseTags(t.tags),
      media: media.map((src) => ({ src: `/media/${encodeURI(src)}`, path: src })),
      cover: t.cover ? `/media/${encodeURI(String(t.cover))}` : '',
      note: String(t.text || '').trim(),
      props,
      // TiddlyWiki's permalink is a fragment on the wiki file itself.
      editUri: config.wikiUrl ? `${config.wikiUrl}#${encodeURIComponent(String(t.title || ''))}` : ''
    };
  });
}

export function mediaRoot(config) {
  return config.mediaRoot || path.dirname(config.tiddlers || '.');
}
