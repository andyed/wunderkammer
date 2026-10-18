/**
 * Obsidian adapter — reads clip notes out of a vault folder.
 *
 * Obsidian owns editing, tagging and sync; this only ever READS. Every tile in
 * the wall carries an `obsidian://` deep link so a correction is made in the
 * real editor rather than in a half-built one here.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../lib/frontmatter.mjs';

export const id = 'obsidian';

/** Fields we lift into the normalized shape; everything else lands in `props`. */
const KNOWN = new Set(['title', 'url', 'source', 'captured', 'kind', 'tags', 'media', 'note', 'cover']);

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [v];
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Obsidian's own URI scheme. Encoding matters: vault and file names routinely
 * contain spaces, and an unencoded link silently opens the wrong note.
 */
function editUri(vaultName, relPath) {
  const v = encodeURIComponent(vaultName);
  const f = encodeURIComponent(relPath.replace(/\.md$/, ''));
  return `obsidian://open?vault=${v}&file=${f}`;
}

export async function loadClips(config) {
  const clipsRoot = path.join(config.vault, config.clipsDir);
  let entries = [];
  try {
    entries = await readdir(clipsRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const clips = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const abs = path.join(clipsRoot, entry.name);
    let raw;
    try {
      raw = await readFile(abs, 'utf8');
    } catch {
      continue; // a note being written right now is not a reason to fail the wall
    }

    const { data, body } = parseFrontmatter(raw);
    const rel = path.join(config.clipsDir, entry.name);
    const stamp = await stat(abs).catch(() => null);

    const props = {};
    for (const [k, v] of Object.entries(data)) {
      if (!KNOWN.has(k)) props[k] = v;
    }

    const media = asArray(data.media).map((m) => String(m)).filter(Boolean);
    const url = data.url ? String(data.url) : '';

    clips.push({
      id: entry.name.replace(/\.md$/, ''),
      title: String(data.title || entry.name.replace(/\.md$/, '')),
      url,
      source: String(data.source || hostOf(url)),
      captured: String(data.captured || (stamp ? new Date(stamp.mtime).toISOString().slice(0, 10) : '')),
      kind: String(data.kind || (media.length ? 'image' : 'page')),
      tags: asArray(data.tags).map((t) => String(t)),
      media: media.map((src) => ({ src: `/media/${encodeURI(src)}`, path: src })),
      cover: data.cover ? `/media/${encodeURI(String(data.cover))}` : '',
      note: String(data.note || '').trim() || body.trim(),
      props,
      editUri: editUri(config.vaultName, rel)
    });
  }

  clips.sort((a, b) => String(b.captured).localeCompare(String(a.captured)));
  return clips;
}

/** Media requests resolve against the vault root, since paths are vault-relative. */
export function mediaRoot(config) {
  return config.vault;
}
