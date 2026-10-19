# Breadth of use and a first release

Assessment: 2026-09-07. Proposed release scope and gates; no release has been
prepared or published by this document. Package metadata says `0.1.0`, `private:
true`, MIT; the checkout has no configured Git remote and substantial uncommitted
work. A version string is not an artifact or a support promise.

## Recommended first boundary

Start with a **single-user local preview**: a browser UI backed by a loopback
Node service, explicit source roots, local derived caches and view snapshots.
Make flat Survey/Review/Dive access complete enough to remain useful if WebGL
is unavailable. Treat spatial browsing and edge zoom as labelled experiments
until their corresponding hardening and input checks pass.

This recommendation does not select a final name, version, distribution channel
or installer technology. “Wunderkammer” underspecifies the image/music use cases.
Choose naming separately from identity: renaming the UI must not regenerate
corpus IDs, change album URNs or invalidate existing view links.

## What changes as the audience broadens

| Use case | Already available locally | Work needed before promising support |
|---|---|---|
| Web research / Obsidian | Preserving re-capture, notes/source links, shared filters | Explicit refresh-versus-preserve UX; harvested-image durability; dimensions; adapter failure reporting; capture time/size limits |
| Screenshot / image archive | Derived previews, date provenance, estimated visual attributes | Broader formats/EXIF orientation and timezone cases; calibrated attributes with versioning/correction; changed/moved source identity policy; resumable progress |
| Music covers | Embedded/sidecar extraction, tags, local preview ladder, track-title search | Release/edition disambiguation; tag alias normalization; missing-art inventory UI; additional formats; no claim of audio playback |
| Another person's computer | Config-file-based instances | A starter that contains no personal paths; runtime/browser installation; folder selection/help; writable cache choice; actionable mount/permission errors |
| Another device with the same corpus | Inline or immutable-reference ViewSpec | Instance export/import with media/index/identity/snapshots, root remapping, revision retention, deterministic migration and verified restore |
| Keyboard/touch/screen reader | Native controls, flat tile activation, some spatial navigation | No-hover exploration equivalents, Tab exit, focused GPU semantics, dense rail navigation, small-screen inspector/legend behavior |
| Large or slow collections | Small overview derivatives, atlas/DOM promotion pools | Explicit support envelope; >4096 behavior; bounded downloads/decodes/DOM; context-loss recovery; real-device profiling |
| LAN, teams or hosted service | No supported deployment path | Separate authentication, authorization, isolation, request/origin protections, quotas, TLS, observability and backup design before changing the bind |

## Local security is still part of a local release

`serve.mjs` binds to `127.0.0.1` and contains path-containment and proxy checks.
Do not describe this as authenticated or as safe to expose with a reverse proxy.
Loopback reduces reach; it is not authorization between a browser page and a
local write endpoint.

Before distributing a local preview, exercise untrusted-web-origin requests to
the mutable pile and immutable-snapshot APIs, including rejected mutations.
`lib/view-state.mjs` currently accepts PUT without an Origin check;
`lib/permalinks.mjs` has an Origin check when the header is present. Review Host,
Content-Type and method handling together, with local CLI compatibility explicit.
Adapter failures can currently log an error and still produce an HTTP 200 partial
or empty corpus; distinguish “empty” from “unavailable” in startup and UI checks.

The image proxy validates scheme, image Content-Type, selected private addresses
and each redirect. Its 12 MiB body limit is checked after buffering, and fetch has
no deadline. DNS validation is separate from connection resolution. Establish
streaming byte/time limits and complete address handling before using arbitrary
remote media as a release input. Do not equate existing checks with a complete
SSRF defense. Hosting also requires removing unnecessary filesystem paths from
API output, plus authentication and instance isolation.

## Release gates in order

| Gate | Concrete artifact/evidence | Current status |
|---|---|---|
| R0 — choose the promise | Audience, supported OS/browser/input, flat/spatial scope, maximum tested corpus, name/version/channel | Proposal above; product decisions remain |
| R1 — reproducible source | Reviewed release tree, immutable commits for app and upstream fixes, dependency lock/manifest, clean artifact allowlist | Dirty working trees; vendor bytes match but include uncommitted upstream changes |
| R2 — rights and packaging | License/notice inventory, redistributable demo corpus, no private paths/indexes/caches/snapshots | `package.json` declaration alone is insufficient; no tracked root LICENSE/NOTICE found |
| R3 — fresh install | Documented `npm ci`, browser install where needed, Python extras, runtime matrix, starter config, cold/offline launch from artifact | Current setup depends on personal configs and an installed environment |
| R4 — safety and recovery | Source preservation, API boundary tests, corruption/write-failure handling, explicit adapter errors, relevant hybrid gates | Several fixture protections exist; open gates above and in HYBRID_HARDENING |
| R5 — capability proof | Full Node/browser + separate Python/upstream tests; real-device matrix; synthetic distribution-safe screenshots; reference-link backup/restore | Session evidence exists; no clean-machine/device release certification |
| R6 — issue artifact | Reviewed archive/installer from exact source, checksum and manifest, release notes, upgrade/rollback instructions | Not built; no publish destination selected |
| R7 — publish and verify | Explicit publish authorization, remote commit/tag, downloaded artifact checks, fresh install from distribution URL | Not authorized or performed by this wrapup |

Choose an allowlisted source/archive preview before introducing a desktop shell
unless installation research demonstrates the need. Do not run `npm publish`:
the package is private and an npm release has not been selected. Do not add CI
against a guessed remote or use a neighboring project's deployment credentials.

## Dependency and offline decisions

The Node lock pins Playwright 1.60.0; actual execution also needs its browser
binary. Three.js 0.186.1 and addons are loaded through a jsDelivr import map in
`index.html`, so “cached corpus works offline” does not yet guarantee a
cold offline 3D launch. Choose pinned local assets with notices or declare and
test the network dependency. Test failure to load that dependency explicitly.

The optional Python music indexer uses Mutagen, Pillow and numpy.
`scripts/music-requirements.txt` pins Mutagen 1.47.0 but gives lower bounds for
Pillow/numpy; it is a starting recipe, not a fully reproducible lock. The current
local venv inherits some bundled packages. A release needs a verified clean
environment recipe and dependency/license inventory, including Mutagen's declared
[GPL-2.0-or-later license](https://mutagen.readthedocs.io/en/latest/) and any
bundling choice. This is an inventory gate, not
a conclusion that an optional offline dependency changes all project licensing.

Tapestry remains not preferred under the user's AGPL constraint. egjs/Grid and
Piling.js are references/candidates, not installed dependencies. Recheck exact
versions and licenses before adoption; see [PRECEDENTS.md](PRECEDENTS.md).

## Acceptance recipe and evidence record

Run from the reviewed release tree, without the developer's existing caches:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:mutations
python -m unittest discover -s tests -p 'test_*.py'
node wall/spatial/lib/sync.mjs
```

The Python command assumes the documented isolated environment and all optional
test dependencies; create it first. The vendor check assumes the upstream source
is available; an end-user artifact instead needs a recorded file-hash manifest.
Run upstream pile/hybrid tests when their source changes. None of these commands
alone validates the packaged artifact or real-device performance.

Add a redistributable fixture-backed instance with expected counts. The current
default `npm start` points at personal paths, so it is not a clean-machine smoke
test. Launch the fixture, inspect `/api/clips`, compare expected identities/counts,
then exercise filtering, sort, hover/pin, Dive, zoom, Back and a copied URL in a
fresh context. Repeat with a missing root, failed decode and WebGL unavailable.

Backup/restore must include config, corpus identity file, index and required
media, mutable pile state and immutable permalink directory. Never delete
snapshots merely because a new index exists. Verify an issued link after moving
the instance to a clean directory; retained snapshots alone cannot recreate
deleted assets. Export/import, migration and retention policy are still work.

For each candidate record: source/upstream SHAs, dependency hashes, runtime and
browser versions, artifact checksum, tests and their dates, device/corpus matrix,
known failures, supported boundary and rollback route. Keep synthetic examples
in distributable proof; personal music and research screenshots remain local
unless separately selected for publication.

## Work after the first preview

Relationship pivots and ordered Dive traversal; deliberate hand-made layers and
piles; density/layout options; typed facet semantics across adapters; corpus
export/import and retained revisions; and retrieval backends when substring
search is insufficient. Each should preserve the current identity/scope/ViewSpec
contracts. Broadening to hosted collaboration is a new architecture decision,
not a launch flag on the local server.
