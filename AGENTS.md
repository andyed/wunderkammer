# Agent guide

Read [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) and the contract that applies to
your change before changing behaviour:

- [docs/CONTRACT.md](docs/CONTRACT.md): the collection document,
  observations and hand-back.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): state and transitions.
- [docs/PERMALINKS.md](docs/PERMALINKS.md): URL restoration.

## Invariants

- **The wall never edits an item.** Editing happens in the owning store.
  View state and permalink snapshots annotate the corpus; they are not part
  of it.
- **No `innerHTML` for item-derived text, anywhere.** Titles, notes, tags,
  facet values and observation text come from third parties or models, and
  reach the DOM through `textContent` only.
- **A collection document is untrusted input.** `wall/collection.mjs`
  validates it, including link and image schemes. Do not widen a scheme
  without a test that the dangerous one is still refused.
- **Item identity is `url`, then `id`** (`clipKey()`). Saved piles and links
  key on it. `urn:clipwall:` identities are stable on purpose; do not rename
  them.
- **8:1 contrast floor on readable text.** Compute it; don't eyeball it.
- **`wall/spatial/lib/` is vendored from muriel.** Edit upstream and run
  `node wall/spatial/lib/sync.mjs --pull`.

## Before you push

```bash
node scripts/check-public.mjs
npm test
```

A check that has never failed has not been shown to work. When you add a
safety check, add a case to `scripts/check-mutations.mjs` that removes the
protection and shows the test failing.
