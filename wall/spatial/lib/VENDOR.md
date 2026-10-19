# Vendored from muriel

These files are **copies**, not the source. Edit them upstream and re-sync;
edits made here are lost on the next sync and, worse, silently diverge from a
library that other consumers are still tracking.

| | |
|---|---|
| upstream | [muriel](https://github.com/andyed/muriel) `render_assets/_lib/`, from a checkout beside this repository (or `MURIEL_ROOT`) |
| commit | `03d71b94b9f27302dcfeb9526d13af0a4e428174` |
| verified | 2026-10-19 |
| branch | main (pushed) |

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
2026-10-18: pulled the TileField fragment-shader fixes (upstream `99ea62b` on `fix/tilefield-shader`): both outputs are encoded with `linearToOutputTexel`, so tiles no longer draw about 2.2 gamma dark, and the slot index is rounded before the row and column are derived, so a slot at a multiple of the column count no longer samples its neighbour. Only `instanced.js` changed; the other eight files were already byte-identical to upstream main. Upstream test: `tests/spatial-tile-pixels.test.mjs` (new) plus the existing spatial tests, 23 passing. Until that branch merges, the commit above is reachable only on it.
2026-10-19: pulled the card-host opt-in fix (upstream `1e99163` on `fix/cards-content-drawable`). Chrome Canary 158 renamed `<canvas layoutsubtree>` to `<canvas content="drawable">`, so under the old name alone no card ever drew and A2 in `tests/spatial-drawable.test.mjs` failed on every run. `CardHost` now sets both attributes. Only `cards.js` changed. It was copied from that commit with `git show`, not with `--pull`: `--pull` copies muriel's main working tree, which would put `instanced.js` back to its pre-shader-fix bytes until `fix/tilefield-shader` merges. Until both branches merge, `sync.mjs` reports `cards.js` and `instanced.js` as drift against muriel main, which is expected. Upstream test: the 20 spatial tests pass on that branch.
2026-10-19 (later): both upstream branches merged into muriel main and pushed: `5052f61` (fix/tilefield-shader), `b629f4a` (fix/cards-content-drawable), then the docs bot's `03d71b9`. All nine vendored JS/CSS files match `git show 03d71b9:render_assets/_lib/…` byte for byte, and `sync.mjs` reports no drift. Upstream tests on the merged commit: 23 spatial tests pass, including both tiers of `spatial-tile-pixels`.
2026-10-19 (three 0.186.1): three is upgraded from r169 to 0.186.1 here and upstream (muriel `9c4d5c2` on `build/three-r186`), for the `copyTextureToTexture` texture-unit fix (mrdoob/three.js#33153), which lost far tiles copied in by `TileAtlas`'s per-slot upload. That commit changes only importmaps, docs and a test, not `render_assets/_lib/`. So `sync.mjs --pull` had nothing to copy, and all nine vendored files match `git show 9c4d5c2:render_assets/_lib/…` byte for byte, as they match `03d71b9`. The commit line above stays at `03d71b9` because `9c4d5c2` is not pushed yet. Upstream's new per-slot upload test, run against this copy with `MURIEL_SPATIAL_LIB=wall/spatial/lib`, passes on 0.186.1 (4 of 4). On r169 it fails: all 50 samples keep the old colour.
