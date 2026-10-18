/**
 * Minimal YAML-frontmatter reader.
 *
 * Deliberately NOT a YAML parser. It handles exactly the shapes a clip note
 * uses — scalars, inline arrays, and block lists — because a full YAML
 * dependency would outweigh the schema it is parsing. Anything it cannot
 * understand is preserved verbatim as a string rather than thrown away, so a
 * note hand-edited in Obsidian never silently loses a field.
 */

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Decode quoted strings without coercing their contents to other types. */
function unquote(raw) {
  const s = String(raw).trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
    if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
    try { return JSON.parse(s); }
    catch { return s.slice(1, -1).replace(/\\"/g, '"'); }
  }
  return s;
}

/** Coerce the handful of scalar forms we actually emit. */
function scalar(raw) {
  const s = String(raw).trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0]) return unquote(s);
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  // Only treat as a number when the whole token is numeric — "2026-09-05" and
  // "1.10.2" must stay strings.
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

/** `[a, b, "c d"]` → ['a','b','c d'] */
function inlineArray(raw) {
  const body = raw.trim().slice(1, -1).trim();
  if (!body) return [];
  const out = [];
  let cur = '';
  let quote = null;
  let escaped = false;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (escaped) escaped = false;
      else if (quote === '"' && ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.filter((v) => v !== '').map(scalar);
}

/**
 * @param {string} text full note contents
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
export function parseFrontmatter(text) {
  const src = typeof text === 'string' ? text : '';
  const m = src.match(FM);
  if (!m) return { data: {}, body: src };

  const data = {};
  const lines = m[1].split(/\r?\n/);
  let listKey = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Block-list continuation: "  - value"
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(scalar(item[1]));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    const value = rest.trim();

    if (value === '') {
      // Either an empty scalar or the head of a block list; the next line decides.
      listKey = key;
      data[key] = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      listKey = null;
      data[key] = inlineArray(value);
    } else {
      listKey = null;
      data[key] = scalar(value);
    }
  }

  // A key opened as a block list that never received items is an empty scalar.
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0) data[k] = '';
  }

  return { data, body: src.slice(m[0].length) };
}

/** Serialize back out in the same restricted dialect. */
export function stringifyFrontmatter(data, body = '') {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${quoteIfNeeded(item)}`);
    } else {
      lines.push(`${k}: ${quoteIfNeeded(v)}`);
    }
  }
  lines.push('---', '');
  return `${lines.join('\n')}${body}`;
}

function quoteIfNeeded(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  // JSON strings are also valid YAML double-quoted scalars. Always quote to
  // preserve numeric-looking strings, booleans, escapes and embedded newlines.
  return JSON.stringify(s);
}
