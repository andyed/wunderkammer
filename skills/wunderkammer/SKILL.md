---
name: wunderkammer
description: Show a person a visual collection (dozens to tens of thousands of images with attributes) as a wall they can pan, filter, group and walk through, make claims about it that cite the exact items, and read back what they selected. Use when a set of images is too large to paste and the person needs to browse, filter or compare it; when a claim about a collection should be checkable; or when you need the exact items a person picked. You write one JSON collection document and validate it before handing over a link. If the muriel skill is installed, start from muriel's collections reference instead; it routes here for the engine's details.
---

# Wunderkammer

You write one JSON document; the person gets a wall they can pan, zoom, facet,
group, compare and walk through; you can read back exactly what they selected.
This skill is the procedure. The full field reference is
[docs/CONTRACT.md](../../docs/CONTRACT.md).

**Best used from muriel.** [muriel](https://github.com/andyed/muriel), a
design skill for coding agents, is the intended front door. Its collections
reference decides when an explorer is the right way to show something, its
`muriel.collection` builder writes the document from a folder or a CSV, and
it reviews the result for exploration quality and contrast. Use this skill
on its own when muriel is not installed; muriel points here for the engine's
steps and traps.

## When to use it

- **Use it** for roughly 30 to 50,000 images that carry attributes worth
  filtering on (date, style, category, colour), for a comparison between 2–6
  groups, or for a claim the person should be able to check against the items.
- **Skip it** for a handful of images (show them inline), for data without
  images (a table or chart), or for editing items: the wall never edits.

## Recipe

1. **Get the code.** `git clone https://github.com/andyed/wunderkammer`.
   Viewing needs no install; the validator needs Node 18 or later.

2. **Write `collection.json`** beside the cover images:

   ```json
   {
     "format": "wunderkammer.collection", "version": 1,
     "corpus": { "id": "cats:firefly-2026-10", "revision": "1" },
     "ui": { "title": "Cats", "nouns": { "item": "cat", "items": "cats" },
             "defaultGroup": "era", "facetOrder": ["era", "style", "coat"] },
     "clips": [
       { "id": "c001", "title": "Dutch oil cat 1", "cover": "cats/c001.webp",
         "props": { "era": "1650s", "style": "Dutch oil", "coat": "ginger",
                    "provenance": "Generated with Adobe Firefly" },
         "palette": ["#c8742e", "#2a1d14"],
         "note": "Plain text, never HTML." }
     ]
   }
   ```

   - `id` is required and unique. A `url`, when present, is the identity
     instead.
   - Attributes go in `props`: strings, numbers, booleans or arrays of them.
     An array gives an item several values in one facet.
   - `palette` holds up to 16 hex colours, dominant first. The floating space
     places each item by `palette[0]`, so measure it from the subject, not
     the background.
   - `ui.nouns` names the items in every count: "128 of 128 cats",
     "1890s · 1 cat".

3. **Validate it.** `node scripts/validate-collection.mjs path/to/collection.json`.
   Fix every problem it lists, each with its path. Exit 0 means the page will
   load the document. It also lists local cover files that do not exist.

4. **Over about 200 covers, pack sprite sheets.**
   `python3 scripts/collection-sheets.py path/to/collection.json` (needs
   Pillow) writes a few pages to `sheets/` beside the document and adds
   `sheets` and `sheetSlots`; each clip keeps its `cover` as the fallback.
   Validate again.

5. **Show it.** Serve the checkout and the document from one static server.
   With the document under the checkout, `npx http-server -p 8080 .` then
   open `http://localhost:8080/?collection=/cats/collection.json`.
   - URL keys: `group=era`, `facet.coat=ginger`, `q=<search>`,
     `view=aisle` (a hallway with one rack per group), `view=3d`, and
     `view=float&arrange=oklch` (a colour space; also `oklab`, `hsl`, `az`,
     or `axes&across=era&up=lightness&depth=hue`).
   - Covers on another origin need CORS headers and
     `"images": { "cors": true }`, or they stay blank in the 3D views.
   - To embed the wall in a page:
     `import { mount } from './wall/embed.mjs'; await mount(element, collectionOrUrl).ready;`
   - A CDN can serve the modules, but the page itself needs a host that
     serves HTML as `text/html`. jsDelivr serves it as `text/plain`.

6. **Make a claim the person can check.** Write `observations.json`, then open
   `wall/compare.html?collection=<document>&observations=<observations>`:

   ```json
   {
     "format": "wunderkammer.observations", "version": 1,
     "comparison": {
       "version": 1, "question": "Is ginger commoner among the 1650s cats?",
       "corpus": { "id": "cats:firefly-2026-10", "revision": "1" },
       "scope": { "query": "", "facets": {} },
       "groupBy": "era", "groups": ["1650s", "1890s"], "measure": "coat",
       "metric": "share", "categoryLimit": 8, "sort": "name"
     },
     "observations": [
       { "id": "ginger-1650s", "text": "Ginger coats are more common among the 1650s cats.",
         "evidence": { "cells": [{ "value": "ginger", "cohort": "1650s" },
                                 { "value": "ginger", "cohort": "1890s" }],
                       "items": [] } }
     ]
   }
   ```

   - The comparison's `corpus` repeats the collection's `id` and `revision`.
   - Cite matrix cells (`value`, and `cohort` for one group) or item ids. Do
     not write figures into `text`: the page computes them beside it.
   - Before sharing the link, run the validator with
     `--observations path/to/observations.json`. It prints the figures the page
     will show and every citation that does not resolve. Check that your
     sentence agrees with them.
   - Limits: 12 observations, 600 characters of text, 12 cells and 200 items
     each.

7. **Read back the selection.** In a browser you can script (the Claude Code
   browser pane, for one), `window.wunderkammer.export()` returns the
   person's scope, focus, pinned highlight and in-scope items, as identities
   and titles. On the comparison page it returns the evidence for the selected
   cell or observation.

## Traps

- A `props` key that names a clip field is refused: `title`, `source`,
  `kind`, `tags`, `captured`, `note`, `palette` and the rest of the clip
  fields. Use another name, such as `provenance` instead of `source`.
- Relative URLs resolve against the document's URL, not the page's.
- Titles, notes and observation text always render as plain text, never as
  HTML.
- An Axes dimension needs a single-valued attribute with 2–12 values, or an
  ordered one (dates, numbers). A multi-valued attribute can be a facet but
  not an axis.
- `facets` is derived from the clips. Supplied counts are replaced.
- Label generated or synthetic images in the item itself, for example in a
  `provenance` attribute and the note.
