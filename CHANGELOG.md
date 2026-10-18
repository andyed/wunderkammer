# Changelog

## Unreleased

- **Floating space** (✺, `?view=float&arrange=oklab|oklch|hsl|az`). The whole
  corpus floats in 3D, placed by each item's dominant colour in OKLab, OKLCH
  or HSL, or shelved A–Z. Search and facets dim items in place. Click flies to
  an item and opens it; the item menu, `[ ]` and Fit reach everything without
  camera skill. Permalinks carry the arrangement and the camera.
  [SPATIAL.md](docs/SPATIAL.md#the-floating-space).

## 0.1.0 — 2026-10-18

First public release.

- **Collection document** (`wunderkammer.collection`, version 1). A strict
  validator lists every problem with its path. The wall loads a document
  from `?collection=<url>`, from a `wunderkammer-collection` meta tag, or
  through `mount(element, collection)`, and needs no server.
- **Sprite-sheet covers.** A collection can name a few sheet pages instead of
  one file per image, with each image's own file as the fallback.
  `scripts/collection-sheets.py` packs them.
- **Comparison** (`wall/compare.html`). It compares two to six groups, shows
  counts or shares in an exact matrix, and walks the groups as racks of
  album walls.
- **Observations** (`wunderkammer.observations`). Claims cite matrix cells or
  items, the page computes their figures, and selecting a claim lights its
  evidence. Citations that do not resolve are shown, not dropped.
- **Hand-back.** `window.wunderkammer.export()` returns scope, focus,
  highlight and the exact items on the wall, or the evidence packet on the
  comparison page.
- **Loads from a CDN.** The wall is `index.html` at the package root, with
  relative asset paths, so it runs from a CDN sub-path such as unpkg's. Pages
  need HTML served as `text/html`, which jsDelivr does not do; modules load
  from either. `mount()` finds the page with no `wallUrl`, and the comparison
  page links back to it.
- **Local server.** `serve.mjs` serves Obsidian vaults, TiddlyWiki, image
  folders and music libraries, with saved piles and compact links.
- **Public-tree gate.** `scripts/check-public.mjs` checks the tree in CI.

Known issue: one experimental browser test, Canary A2 (HTML-in-canvas behind
a flag), fails. All other tests pass, and all 70 mutation cases are detected.
