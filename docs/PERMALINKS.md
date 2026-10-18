# Permalink strategy

Implemented locally, 2026-09-07. Copy the address-bar URL after an interaction
settles, or use **Copy link** to flush and verify the current view before copying.
The implementation covers current filtering/union, grouping, pan behavior,
flat/3D presentation, pile arrangement/expansion, camera, focus, inspector sizing
rail state, within-group sort and a pinned attribute lens. Future layout/layer controls must extend the same schema
when those features exist.

## What a link means

A link describes the settled current view of an identified corpus. It includes
scope, presentation, focus and camera, rather than replaying a sequence of UI
commands. A fresh page must restore it without depending on another tab's memory,
localStorage, or the mutable current saved-pile document.

| State | Required representation |
|---|---|
| Corpus | Stable instance/corpus ID; index revision or digest; identity version |
| Scope | Query, active facets, explicit OR branches, labels and exact stable membership keys |
| Presentation | Flat/3D and, as available, Survey/Review mode; grouping, sort and direction, layout choice/version, density, pan behavior |
| Arrangement | Pile/layer membership and transforms, expanded piles, active stack and other settled spatial presentation state |
| Camera | Fit intent or deliberately positioned view; store each renderer's view when available |
| Focus | Selected item identity, selected media source and detail open/closed |
| UI configuration | Filter-rail visibility, detail width as a bounded proportion, and enabled presentation experiments |

Keep source rules for explaining cluster branches, but preserve exact branch
members: rerunning a similarity estimator later must not silently change an
explicit union. Existing query/facet scopes are live rules; the corpus revision
makes changes detectable. An exact historical result requires a retained index
revision, or a frozen membership/arrangement snapshot, as appropriate.

This covers view configuration. A URL names the configured corpus; it does not
contain network-drive paths, credentials, media bytes or server administration
configuration. Recreating a whole instance on another host requires its corpus
and an explicit exported instance configuration as a separate operation.

## One schema, two storage forms

The validated, versioned ViewSpec in `wall/permalink.mjs` provides
capture, encode/decode, validation and restoration around the existing state
owners. Unknown schema/layout versions are rejected explicitly; migrations will
be added when another supported version exists. Do not create another
scope evaluator or renderer-specific interpretation of filters.

- Inline form: `/#v=1&s=<base64url-state>` contains the canonical serialized
  ViewSpec, encoded as UTF-8/base64url without compression in version 1. Small
  links are self-contained with respect
  to view configuration. Readable top-level query parameters can be added later
  as sugar over the same schema, not as competing state.
- Reference form: `/#v=1&ref=<snapshot-digest>` resolves a larger immutable
  ViewSpec from an instance-owned permalink store. Use this for large membership
  unions and arrangements. The digest identifies the actual canonical payload;
  reads verify identity. It must never resolve to mutable `/api/view-state`.

The inline budget is 6,000 encoded characters; larger views use snapshots.
The validated payload limit is 4 MiB. This is a chosen product budget, not a
universal URL-length claim. Bound
decoded payload sizes and validate arrays, strings,
versions, identifiers and finite camera numbers.

Reference snapshots are append-only and need a retention contract: issuing a
permalink promises that its snapshot will not be silently garbage-collected.
Back up or copy the instance identity file and snapshot directory with the
instance configuration; there is no automated export/import UI yet. A missing
snapshot is an
explicit failed restoration, not permission to load some other saved view.

The local URL remains local: another machine must reach an equivalent server
with access to the corpus and any referenced snapshot. A permalink does not
upload imagery or make a network drive accessible to its recipient.

## Keep the address bar current

The controller samples canonical state every 120ms and waits for 180ms of
stability before updating the URL. Active pointer drags are excluded. Commit
pan/zoom at gesture end; coalesce wheel tails and typed-query changes. Use
`replaceState` during continuous adjustments and `pushState` for meaningful
scope, item and presentation navigation. Route browser Back/Forward and the
in-app scope Back through the same restore mechanism; do not keep two histories
with different meanings.

A Copy view link action flushes pending edits and snapshot persistence before
copying. For reference views, the full inline state first goes into the address bar.
It becomes a short reference only after durable acknowledgement and exact hash
readback. A failed snapshot save retains the full inline link with a visible
warning. If the browser itself rejects a very large inline URL, the UI explicitly
says the address bar is not current while the snapshot saves. Copy link verifies
that the resolved URL still matches the current view and refuses stale copying.

Static hosts can have no snapshot endpoint. HTTP 403/404/405, or Python's HTTP
501 for an unsupported POST, latch that absence after one probe when the inline
URL succeeded. The complete inline view stays usable without a warning or
repeated requests. A failed inline write still requires a successful snapshot;
that error must remain visible. This fallback does not weaken view validation.

Do not record facet-local value-search text or pagination, hover, an unfinished drag, loading progress, pointer location,
texture residency, or the entire undo stack as view configuration. The
background plane's reveal latch (`ui.context`) is part of the view: a receiving
viewport restores it directly, since the plane is canvas content rather than a
screen-space panel that needs room.

## Restore deliberately

Parse and validate first; resolve the named corpus/index and optional snapshot;
apply scope and presentation; restore arrangement; open detail and size rails;
finish layout; then restore the camera/focus once. Suppress URL writes and
ordinary auto-Fit during hydration. Explicit permalink state takes precedence
over mutable saved preferences; loading a permalink never overwrites saved piles.

Fit is an intent, not a numeric camera position. A fitted view fits the receiving
stage. For custom flat zoom, retain the deterministic layout aspect and camera,
then preserve its world centre and scale relative to the receiving stage. An
item-relative anchor for reflowed custom arrangements remains future work.
Preserve deterministic order and layout version. Same corpus, layout version and
viewport should reproduce the arrangement and camera; a different viewport
preserves content, focal intent and relative scale rather than promising identical
pixels. Spatial camera state needs explicit framing/target and orientation.
An initially empty spatial view still has an explicit boolean Fit intent;
the absence of content to frame must not make its saved view invalid.

If a corpus changed, identify the mismatch and report missing members. Retain
unresolved keys, keep available members, and provide an explicit recovery choice;
never substitute an unrelated item or silently broaden a subset. Exact replay
of removed media is possible only when the underlying assets are retained.

## Implementation and acceptance

- `wall/permalink.mjs`: version-1 codec, validation, URL tracking, browser
  navigation, verified clipboard copy, reference resolution and failure UI.
- `wall/wall.mjs`: captures/restores the existing canonical scope, UI and layout;
  blocks input and ordinary auto-Fit during hydration. In-app Back uses the same
  browser history. Scope-bar presence is retained because it changes stage size.
- `wall/spatial/spatial-view.mjs`: captures exact pile coordinates/dimensions,
  member identities, expansion, navigation selection, camera position and target;
  restores them without writing the mutable saved-pile document.
- `lib/permalinks.mjs`: content-addressed, atomically published, fsynced snapshots
  with exact readback. No overwrite or garbage collection endpoint exists.
- `serve.mjs`: `/api/clips` returns corpus identity/revision; POST `/api/permalinks`
  creates a snapshot, GET `/api/permalinks/<sha256>` reads it.

Unless `config.corpusId` is set, a generated identity persists in
`<viewStatePath>.instance-id`. Snapshots live in `<viewStatePath>.permalinks/`.
These local files are ignored by Git and must be retained for issued reference
links. Mutable `/api/view-state` is a separate store. Corpus/index history and
media export are not implemented: changed data produces a warning, preserves
unresolved identities, and never claims to recreate removed assets.

Acceptance is a fresh browser context with no prior local state: configure a
view, copy the address-bar URL, reopen, and compare scope identities, controls,
focus and rendered framing. Cover a large Shift-added union, 3D expanded piles,
resized detail, distant zoom/context reveal, ordinary browser Back/Forward,
changed corpus, missing members, malformed versions, offline snapshot resolution
and failures while writing a snapshot. Deliberately reintroducing auto-Fit or
resolving a permalink through mutable current state must fail the checks.


Live proof: the Psychodeli Atlas link restored 228 members, the selected image
`2026-04-11 · 08:38:14`, and the exact flat camera in a fresh browser context.
Local evidence: `.local/psychodeli-atlas/permalink-proof.json` and
`permalink-restored.png`. Fixture coverage includes Unicode/malformed versions,
concurrent immutable publication, detail and cross-viewport restoration, clipboard
copy, large unions, browser history, unavailable snapshots, missing members, and
expanded 3D piles without saved-state writes.


### Attribute exploration extension

Version 1 accepts optional `presentation.sort: {key, direction}` (`asc` / `desc`)
and optional `ui.lens: string | null`. Absent fields restore original adapter
order and no pinned lens, preserving existing links. The flat renderer sorts a
copy of the filtered subset; grouping still owns its own membership and block
order. Pinned-lens changes participate in browser history; transient value or
heading hover never enters ViewSpec. See [ATTRIBUTE_EXPLORATION.md](ATTRIBUTE_EXPLORATION.md).
