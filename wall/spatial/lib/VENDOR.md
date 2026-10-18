# Vendored from muriel

These files are **copies**, not the source. Edit them upstream and re-sync;
edits made here are lost on the next sync and, worse, silently diverge from a
library that other consumers are still tracking.

| | |
|---|---|
| upstream | [muriel](https://github.com/andyed/muriel) `render_assets/_lib/`, from a checkout beside this repository (or `MURIEL_ROOT`) |
| commit | `6cc2bc945900f589051509d4ee957b1766cd2b36` |
| verified | 2026-09-20 |
| branch | main (also contained in feat/html-in-canvas-probe) |

Every vendored byte matches that commit exactly — checked file by file against
`git show 6cc2bc9:render_assets/_lib/…`, not against the upstream working tree.
That distinction is the one `sync.mjs` cannot make: it compares working trees,
so an upstream whose changes are real but uncommitted reports as a clean match
while the copy is the more durable of the two. It said "matches upstream" for
three days in exactly that state.

Vendored rather than imported because wunderkammer has no build step and no
dependency on muriel's checkout being present. The cost is staleness, which is
why the commit is recorded above and `sync.mjs` checks it.

```bash
node wall/spatial/lib/sync.mjs          # report drift
node wall/spatial/lib/sync.mjs --pull   # re-copy and update this file
```

2026-09-07: pulled upstream contact-sheet pile face (`PileLayout.faceOf`, `faceCount`); the app promotes face members and skips them in its contain pass.
2026-09-07: pulled square-grid face and empty-pile guard (upstream 5778a5c); the app places each clip in its smallest group, keeps true counts, and a spread pile borrows shared members.
2026-09-10: upstream committed and pushed (muriel 9c70231, 3f288f6); the drawable card source (`cards.js`, `AtlasPair.resolveSource`, `RETRY`, `slotCoverage`) is now vendored from a real revision rather than from someone's working tree.
2026-09-10 (perf pass): pulled upstream **working-tree** changes that are not yet committed in muriel — `TileField.update` now budgets the near tier to the nearest `capacity` instances via quickselect (no per-instance eviction scans), `takeDirty()` / `flush()` / `setRenderer()` support render-on-demand consumers, `HybridField.update` is allocation-free and returns whether the pool changed, `HybridField.sort` skips redundant z-index writes, and `TileAtlas` uploads dirty slots through `WebGLRenderer.copyTextureToTexture` instead of re-uploading the whole canvas. Upstream tests: `tests/spatial-field-select.test.mjs` (new) plus the existing hybrid/piles/cards tests, 19 passing. The commit hash above is the last committed base; the vendored bytes are ahead of it until muriel commits.
2026-09-11: pulled the membership mask (`TileField.setActive/isActive/activeCount`, honoured by `HybridField.update`, `pickAt` and `FieldNavigator`), complete far residency (near residents also hold a far tile), and `HybridField._demote` clearing the element. Upstream tests: 20 passing. Still uncommitted upstream.
2026-09-20: upstream recorded those changes in `6cc2bc9`. All nine vendored JS/CSS files were compared byte-for-byte with that immutable commit; all match, so no re-copy was needed. The read-only sync check and all 20 upstream spatial tests pass. The earlier working-tree-only notes above are historical.
