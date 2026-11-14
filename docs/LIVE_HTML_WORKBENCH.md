# Live HTML design workbench

Status: specification, not an implemented feature. Requested by Andy, November 2026.

## Product decision

Build a small, local-first design table in Wunderkammer: live HTML variants beside
one another, precise visual feedback, and an evidence packet an independent coding
agent can use. Muriel supplies design judgment; Scrutinizer supplies perceptual
inspection; Wunderkammer supplies spatial comparison and durable context. Do not
build another chat app, general IDE, or cloud design service.

The first useful loop is **open two variants → interact → compare → pin a finding
→ ask an agent to revise → compare the new revision against the old**. A beautiful
canvas is useful only if that loop preserves the exact artifact being discussed.

Local files and a loopback web server are the default delivery. No account, upload,
telemetry, model provider, or network connection is required to review bundled work.
Local-first does not mean no possible egress: explicitly enabled external assets or
an external agent can transmit data, and must be described as such.

## Fit with the existing system

This extends the corpus/view separation in [PHILOSOPHY](PHILOSOPHY.md),
[ARCHITECTURE](ARCHITECTURE.md), and [CONTRACT](CONTRACT.md). The wall never edits an
item. Artifact source remains in its owning repository/editor. Workbench persistence
holds arrangement, comparisons, captures, and annotations, not a hidden fork of the
source. An agent's patch creates a new artifact revision; it does not silently change
what an earlier review meant.

There is already substantial [HTML-in-Canvas research](HTML_IN_CANVAS_RESULTS.md)
and a [Phase 3 plan](HTML_IN_CANVAS_PHASE3.md). Reuse that knowledge, not its results
outside their measured scope. The probes exercise controlled DOM cards. They do not
prove full application iframes, cross-origin capture, or arbitrary WebGL applications
can be drawn through `drawElementImage` with the same fidelity or performance.

The workbench is initially a **2D camera with live DOM iframe surfaces**, not a
requirement to rasterize every document into a canvas. Keep stable viewport sizes
inside each surface; apply camera transforms outside them. Overview uses captured
covers. Native HTML-in-Canvas is an optional capability-gated renderer after parity
is demonstrated. Unsupported browsers must retain a usable DOM-based comparison.
Do not couple delivery to the existing spatial Phase 3 renderer replacement.

Do not add raw HTML or arbitrary launch commands to the strict collection clip
schema. Use a separately validated workbench-session contract. A future collection
adapter may expose artifact covers and stable links, with the current collection
validator and `wall/embed.mjs` message checks unchanged. Vendored
`wall/spatial/lib/` remains Muriel-owned; changes there go upstream before syncing.

## MVP interface

A quiet shell, generous visual area, readable text at the repo's 8:1 contrast target.
Start with two side-by-side variants; allow six on a board, but only two live surfaces
by default. Parked surfaces show an honest last-captured cover and timestamp, not a
pretend live state. Focus can promote one and park another. Do not silently reset a
form or animation on parking: retain the iframe when affordable, otherwise mark it
suspended and require explicit reload. A crashed preview must not lose the board.

- Header: project, comparison/revision selector, Add, Inspect, Export.
- Each frame: short name, revision, viewport preset, live/suspended status.
- Viewport presets: phone, tablet, desktop plus exact editable CSS width/height.
- Comparison: aligned frames, linked viewport dimensions, optional synchronized
  scroll only when both artifacts support it. Never imply semantic synchronization
  between unrelated documents. Changes to viewport and scroll are view state.
- Inspection rail: findings and selected evidence, normally collapsed.
- Color tools: inspect foreground/background, preview token alternatives and
  perceptual views. Preview changes are reversible and explicitly unsaved. Export
  a proposed patch/constraint for the owning editor; never rewrite source on hover.
- Return/Back restores comparison, camera, selected finding, and revision context.

### Input ownership

Navigate and Interact are explicit modes. Navigate pans/zooms the board; Interact
routes pointer, wheel, keyboard, selection, and form input to one active frame.
Clicking an inactive cover focuses it without firing the control underneath. A
visible frame-level exit returns to Navigate; Escape works where the preview bridge
supports it, and the shell exit always works even without bridge cooperation.

Annotation mode intercepts a click to place a pin; it must not submit a form. Pin
coordinates are document CSS coordinates, not transformed board pixels. Keyboard
users can enter/leave a frame and reach a nonspatial list of variants and findings.
No offscreen iframe or parked card may trap Tab. Respect reduced motion. Touch pan,
iframe scroll, pinch, and selection need explicit tests, not desktop assumptions.

## Artifact, revision, and session contract

Proposed version 1 contract, separate from collection/ViewSpec version 1:

```json
{
  "schemaVersion": 1,
  "sessionId": "design-table-example",
  "artifacts": [{
    "id": "checkout-a",
    "revision": "r3",
    "contentHash": "sha256:<manifest-and-content-digest>",
    "entry": "variants/a/index.html",
    "assetManifest": "variants/a/manifest.json",
    "viewport": {"width": 390, "height": 844},
    "trustProfile": "isolated-local"
  }],
  "board": {"camera": {"x": 0, "y": 0, "scale": 1}, "placements": []},
  "findings": []
}
```

This is an illustrative shape, not an existing API. Implement a strict versioned
validator before accepting sessions: reject unknown keys, duplicate IDs, unsupported
versions, traversal, nonfinite geometry, oversized strings/arrays, and unapproved
schemes. Bound the MVP to six artifacts and 1,000 findings. IDs survive rearrangement;
array positions are never identities. Relative entry paths resolve within an
explicitly selected project root. Export portable relative paths, never workstation
home paths, credentials, or private launch arguments.

A revision digest covers HTML and its declared local dependencies, not just the
entry file. Missing/unversioned resources make reproducibility explicitly incomplete.
File watchers announce a new revision, offer reload, and preserve the reviewed old
capture. They never auto-retarget existing findings. Store session state atomically
with a revision token and conflict detection; a failed read must not overwrite the
existing file with defaults. Reuse the repo's persistence discipline.

### Findings and handoff

Each finding records stable ID, artifact ID/revision/hash, author/source (human,
Muriel, measurement), severity, intent, suggested change, and acceptance criterion.
Anchor with a stable test ID or selector when available, semantic label, document
CSS rectangle, and screenshot fallback. Capture viewport, DPR, scroll, camera,
interaction state description, timestamp, browser, fonts/resource readiness, and
capture hash. Animated evidence includes a time/frame or short clip, not a claim of
repeatability based on a still image alone.

On revision change, mark the finding stale until re-anchored or verified. Matching a
selector alone is not proof the same component exists. Never attach an unresolved
pin to the nearest element without disclosure. Statuses: open, proposed fix,
addressed by agent, verified, dismissed. **Addressed is not accepted.** Keep rationale
and who verified it. Human acceptance is separate from generated critique.

Export Markdown plus JSON plus selected captures to a local folder. Include the
brief, constraints, exact revision, chosen findings, reproduction steps, acceptance
checks, and original-vs-new comparison. Exclude unrelated artifacts by default.
Independent agents consume ordinary files; no proprietary orchestration is needed.
Import their response as a proposed revision/finding disposition, not authority to
execute commands or accept the design. Support a static HTML review index, served
locally; it need not pretend to contain fully functioning live apps.

## Muriel and Scrutinizer adapters

Adapters are proposed integration work, not already-shipped Wunderkammer APIs.
Both must report tool version, capabilities, inputs, outputs, and failures.

**Muriel:** use its existing brand/geometry/contrast vocabulary and review workflow.
Its redline review already binds findings to exact PNGs and hashes with revision
navigation; reuse that evidence discipline rather than inventing another ambiguous
screenshot-comment format. Initially export a compatible evidence folder and import
structured findings. Do not require Muriel to become an embedded chat pane. A later
adapter may automate critique, but the human must explicitly choose what is sent to
any external model. Cross-agent notes are untrusted content, not executable commands.

**Scrutinizer:** target the modern `andyed/scrutinizer2025`, not the historical AIR
repository. It already exposes CLI/MCP inspection including `analyze_url`,
`compare_pages`, `capture_vision`, congestion scoring, saliency, and capture tooling.
First discover and validate its actual input/output schemas and local URL access;
wrap them rather than inventing a second foveation engine. Show original and
perceptual views at matched viewport/state. Record calibration and simulation mode;
these are approximations, not a claim to reproduce every person's vision.

**Rendered color/contrast is a distinct measurement lane.** Pair DOM foreground and
composited-background information with actual capture evidence. Gradients, imagery,
transparency, blend modes, and animated backgrounds require sampled regions/states
and uncertainty reporting. Antialiased edge pixels are not automatically the text's
specified foreground. Record method, color space, threshold, and sampled state;
label unsupported or uncertain cases instead of issuing a false pass. The shell's
8:1 target is separate from the artifact's declared accessibility criteria. Neither
foveation nor a congestion score is WCAG certification. Never evaluate only token
pairs while calling the result rendered contrast.

## Isolation and local serving

Treat imported HTML as untrusted executable content. Serve shell and previews from
separate origins. Default preview sandbox allows the minimum scripting needed, with
no same-origin privilege, top navigation, popups, camera/microphone, downloads, or
host file APIs. Script execution itself is explicit when importing an untrusted
artifact. An opaque sandbox origin requires careful bridge validation: validate the
exact iframe `contentWindow` plus a per-load capability token and strict message
schema, not a generic acceptance of all `null` origins. Reset capabilities on reload.

Serve only approved project roots, reject traversal and symlink escape, bind to
loopback, validate Host/Origin, and protect any state-changing endpoint against
cross-origin requests. Never expose an arbitrary filesystem reader or URL-fetch
proxy. Default CSP blocks external connections and resources; local resources are
bundled/allowlisted. Legitimate network-dependent previews require an explicit
per-artifact policy and a visible network-enabled indicator. Do not silently relax
isolation when an app fails; show the blocked capability and offer a narrower trust
choice. Native file access, signed-in sessions, and provider credentials stay out of
preview frames. Test isolation with malicious fixtures before enabling the workflow.

Screenshot/DOM extraction must use a controlled local capture process or an
instrumented trusted bridge. Cross-origin iframe pixels/DOM are not assumed readable
by the parent. If capture is unavailable, say so and retain the live comparison.

## Implementation sequence and release gates

1. **Capability spike, before product polish.** Two actual full HTML applications,
   not simple cards: form/input, overflowing panel, animation/WebGL, responsive
   viewport. Prove camera transforms, input routing, capture, iframe isolation, and
   suspension behavior in Chromium and Safari. Measure against direct-page baseline.
   Report native HTML-in-Canvas separately as optional experimental evidence.
2. **Local board MVP.** Strict manifest/session loader, loopback server, two live
   frames/six covers, persistence, keyboard-accessible comparison, revision detection.
   Keep existing collection modes and exports unchanged.
3. **Evidence loop.** Pins, captures/sidecars, stale-anchor handling, local Markdown /
   JSON / review-index export, agent response import. Demonstrate one real revision
   roundtrip with no manual reconstruction of which screenshot was meant.
4. **Inspection.** Muriel evidence compatibility, Scrutinizer adapter, explicit
   rendered-contrast method and uncertainty. Optional palette previews after the
   evidence loop is reliable. Review the shell itself with both tools.

Initial performance budget: two ordinary static UI previews should sustain 60 Hz
board navigation on the reference desktop without introducing more than 5 ms p95
shell overhead versus a direct-page baseline. Publish device/browser/DPR and frame
percentiles; do not hide preview-app cost in an average. At six artifacts only two
are live; background work stops when hidden. Under load, degrade to covers with clear
status, not stale interactive surfaces. Measure memory after repeated revision swaps;
unbounded retained frames/listeners fail the gate. Heavy WebGL examples get their own
measured budget rather than a universal 60 fps promise.

### Acceptance matrix

- Open two local variants; switch viewport; type/select/scroll; leave Interact;
  pan and return without accidental form submission or lost context.
- Pin at DPR 1, 2, and fractional scale; resize/scroll; verify the documented anchor.
- Edit source externally; new revision appears; old findings become stale; accept a
  fix only after comparison, with original evidence preserved.
- Export locally; an independent agent can reproduce the finding from the packet;
  another checkout can load relative paths or clearly report missing assets.
- Test gradients, transparency, and animation; uncertain contrast never gets a
  green pass solely from theme tokens.
- Malicious iframe attempts shell DOM/file access, forged messages, navigation,
  external fetch, traversal, and state-write CSRF fail. Mutation tests removing the
  safety checks must make these tests fail.
- Reload during write, corrupt session, and concurrent saves preserve recoverable
  state rather than silently overwriting it.
- Keyboard-only and touch review, reduced motion, parked-frame Tab traversal, and
  a crashed preview remain usable. Shell text meets 8:1.
- Existing `node scripts/check-public.mjs` and `npm test` remain green; add focused
  workbench tests, do not rewrite the collection contract to accommodate previews.

Not MVP: cloud accounts/sync, simultaneous multiplayer/CRDT, a full code editor,
arbitrary remote-site embedding, unrestricted agent execution, 3D authoring, or a
replacement for Muriel/Scrutinizer. Shipping this spec does not authorize those.

## Sources and implementation handoff

Grounded in Wunderkammer main `510dd15` and its architecture, collection/embed,
shots, HTML-in-Canvas results, and Phase 3 documents. Inspect latest source again
before implementation: renderer work is active and these are not frozen APIs.

- [Muriel redline workflow](https://github.com/andyed/muriel/blob/main/plugins/muriel/skills/compose/references/redline-review.md)
- [Muriel redline implementation](https://github.com/andyed/muriel/blob/main/muriel/redline.py)
- [Scrutinizer current tools and limits](https://github.com/andyed/scrutinizer2025/blob/main/README.md)
- [Scrutinizer CLI contracts](https://github.com/andyed/scrutinizer2025/blob/main/cli/README.md)
- [Open Design](https://github.com/nexu-io/open-design): workspace precedent, not a
  dependency or a commitment to clone its architecture.

First implementer deliverable: the two-application spike, measured findings, and a
small proposed module map. Keep this a workbench, and keep the artifacts independent.
