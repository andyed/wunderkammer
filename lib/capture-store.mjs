import { readdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

// URL parsing normalizes the host/scheme without lowercasing case-sensitive
// paths, query values or fragments. The note remains the source of truth.
function sourceKey(url) {
  try { return new URL(String(url)).href; } catch { return String(url); }
}

/** Locate a prior capture even after an Obsidian rename or folder move. */
export async function findExistingClip(clipsDir, url) {
  const wanted = sourceKey(url);
  async function visit(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await visit(abs);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Fail closed on unreadable notes: failure to inspect a prior capture
        // is not permission to replace it or create a second copy.
        const { data } = parseFrontmatter(await readFile(abs, 'utf8'));
        if (data.url && sourceKey(data.url) === wanted) return abs;
      }
    }
    return null;
  }
  return visit(clipsDir);
}

/** Publish a complete new file atomically, never replacing an existing path. */
export async function writeNewFile(file, bytes) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, bytes, { flag: 'wx' });
    // Same-directory hard link is an atomic create-if-absent. Unlike rename,
    // it cannot replace a note created/edited after the initial duplicate scan.
    await link(tmp, file);
  } finally {
    await unlink(tmp).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  }
}

/** Immutable media names depend on bytes, so a changing hero URL cannot erase
 *  evidence referenced by an older clip. Existing URL-hash files stay intact. */
export async function storeMedia(bytes, extension, dir, relDir) {
  const name = `${createHash('sha256').update(bytes).digest('hex')}${extension}`;
  const file = path.join(dir, name);
  try { await writeNewFile(file, bytes); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // An attachment may have been edited by the user. Never overwrite it or
    // silently claim the new capture contains different bytes.
    if (!(await readFile(file)).equals(bytes)) {
      throw new Error(`Existing attachment differs; kept unchanged: ${file}`);
    }
  }
  return path.posix.join(relDir, name);
}
