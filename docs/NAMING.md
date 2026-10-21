# Naming: Wunderkammer

**Decided by Andy, 2026-10-17.** The public engine is named **Wunderkammer**:

- npm package `wunderkammer`
- GitHub repository `andyed/wunderkammer`
- format prefix `wunderkammer.`, so `wunderkammer.collection`,
  `wunderkammer.observations` and `wunderkammer.export`

Clipwall stays the name of the private repository (`andyed/clipwall`) and of
the local workspace over personal clippings, archives and music artwork.

Because the public repository takes a new name, nothing is renamed on GitHub
and no checkout's remote changes. That removes a release hazard: a public repository taking the old name while
existing checkouts still push to it.

## What changes before release

Not done yet. These are the names a producer, an embedding page or an agent
writes or reads. A day after they were introduced, nothing outside this
repository depends on them. After release, prompts, artifacts and collection
files will.

| Now | At release |
|---|---|
| `clipwall.collection`, `clipwall.observations`, `clipwall.export` | `wunderkammer.collection`, `wunderkammer.observations`, `wunderkammer.export` |
| postMessage `clipwall:ready`, `clipwall:collection`, `clipwall:view-ready`, `clipwall:error` | `wunderkammer:…` |
| `window.clipwall.export()` | `window.wunderkammer.export()` |
| `<meta name="clipwall-collection">` | `<meta name="wunderkammer-collection">` |
| `import * as Clipwall from './wall/embed.mjs'` | `import * as Wunderkammer from 'wunderkammer'` |
| README, docs and page titles | Wunderkammer |

## What keeps the old name

- **`urn:clipwall:` item identities.** Saved piles and permalinks are keyed on
  them, and the published demo carries 289 of them. Renaming them would change
  every item's identity, so they stay as an internal namespace.
- The private repository, its history, and the local instance configurations.
- The `clipwall-demo` repository until the public demo moves.

## Where the name comes from

A *Wunderkammer* ("wonder room") is one of the collection rooms, also called
cabinets of curiosities, that European collectors kept from the sixteenth
century on. They predate the public museum, and their objects were arranged
and shown to visitors. *Kunstkammer* is the related term. The
harvest behind the long list is in
[naming/jx-1017-t5/harvest.md](naming/jx-1017-t5/harvest.md).

## Evidence (2026-10-17)

- **npm:** `wunderkammer` was unregistered (registry 404).
- **GitHub:** the highest-starred repository with this exact name is
  maciekglowka/wunderkammer, with 19 stars.
- **USPTO** (tmsearch, wordmark and pseudo-text): there is no live
  WUNDERKAMMER mark. Four live marks contain the word, none of them in
  software classes 9 or 42:
  - WNDERKAMMER (class 25, clothing)
  - WUNDERKAMMER STUDIO (class 16, art prints)
  - KIDDO: WUNDERKAMMER (classes 19 and 21, stone tiles)
  - WUNDERKAMMER BIER (class 32, beer)

  No lawyer has reviewed this.
- **Domains** (RDAP): wunderkammer.com and wunderkammer.app are registered;
  wunderkammer.dev and wunderkammer.io were not.

## How it was chosen

Sitting `jx-1017-t5` followed the first steps of muriel's naming protocol
(`references/jury.md` § Naming decisions):

1. A use statement was written once for this product
   ([use-statement.md](naming/jx-1017-t5/use-statement.md)).
2. Sources were harvested and cited: the product's own text, the history of
   showing and comparing images, and the technical vocabulary.
3. A long list of 69 names was generated from the harvest
   ([longlist.txt](naming/jx-1017-t5/longlist.txt)).
4. npm and GitHub were checked for every name, and USPTO and domains for the
   leading ones ([longlist-facts.md](naming/jx-1017-t5/longlist-facts.md)).
   29 names passed npm and GitHub.
5. The proposed seating was clipwall, wunderkammer, bilderatlas and preparator.

Andy chose Wunderkammer from that list. **The jury was not convened**: no
Pedant, Forger or Thumbnail ballot exists, and the name has no ranking or
findings. Those seats would have judged:

- the name against the product's own vocabulary, which speaks of evidence,
  scope and exact counts (Pedant);
- whether a generic template reaches it (Forger);
- legibility at 12 characters in a browser tab, a repository list and a
  format identifier (Thumbnail).

The seats can still be run on the name alone, as a single-artifact sitting,
before release.

## Names considered and dropped

| Name | Why |
|---|---|
| docent | npm taken; TransluceAI/docent is an AI tool (142★) |
| mnemosyne | npm taken; mnemosyne-oss/mnemosyne (3.4k★) |
| memex | npm taken; WorldBrain/Memex (4.7k★) |
| lighttable | LightTable IDE (11.7k★) |
| imaginaire | NVlabs/imaginaire (4k★) |
| ekphrasis | cbaziotis/ekphrasis, an NLP library (673★) |
| diptych | live class 9 marks DIPTYQUE and DIPTIC, the same sound |
| selects | live MAGNOLIA SELECTS (classes 9 and 42) |
| bilderatlas, preparator | proposed for seating; not chosen |
| clipwall | the incumbent; kept for the private workspace |

The other names that passed, and why the rest failed, are in
[longlist-facts.md](naming/jx-1017-t5/longlist-facts.md).
