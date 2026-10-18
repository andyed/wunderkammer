# Philosophy: useful motion, trustworthy context

Recorded 2026-09-07. This is the design rationale behind [PRODUCT.md](PRODUCT.md),
not a claim that every interaction already satisfies it. “Wunderkammer” is a working
name: the product now spans web research, image archives and music artwork.

## The unit of value is a useful next action

The user should be able to orient in a collection, find a workable subset,
compare it, inspect an item, and continue from that item. Survey / Review / Dive
describe these activities; search and facets define their common scope. A
renderer is a means of doing the work, not a separate definition of the corpus.

Depth earns its place by exposing relationships or making buried content
reachable. A technically impressive field that leaves most of the screen empty,
or requires camera skill to inspect a cover, has failed the product requirement.
Flat review is an essential access path, not a lesser experience.

## Prevent error without taking away agency

“Pan, zoom etc. should not do un-useful things” is the guiding principle adopted
in this session. A valid camera transform can still strand the user. Constrain
an unhelpful action or offer a useful continuation, while preserving its intent.

Edge zoom is an experiment in this principle: outward drag at an edge can
enlarge the collection. Reversal and Undo make the changed meaning recoverable.
It is not evidence that every edge should trigger zoom. Bounded pan remains a
comparison condition; wheel input, diagonals, tiny subsets and maximum zoom
need their own checks. No interaction should silently change the filter to
manufacture a more attractive screen.

Use these questions when changing a gesture:

- What is the user trying to reveal or reach?
- Where does this motion stop providing useful information?
- Can the user perceive the boundary and predict the continuation?
- Can they reverse it, use a keyboard equivalent, and recover with Fit or Back?
- Does the action preserve membership, identity and any saved arrangement?

## Spend space on information people can use

Space filling means avoiding gratuitous blank canvas while preserving meaningful
structure. It does not mean maximizing an occupancy score at any cost. A screen
of microscopic images can have excellent area coverage and little practical value.

Measure both coverage and recognizability. Count actual decoded imagery as well
as tile rectangles; the music overview looked populated in network/DOM checks
while the browser failed to decode its oversized working set. The 128px overview
tier fixed that failure without changing the user's corpus.

At distant scales, show groups, representative images and counts. At review
scales, reveal recognizable imagery and readable labels. In Dive, provide the
complete source media and provenance. This is semantic zoom when the information
shown changes with scale. The heading-font change supports it through readable
geometry: group labels have a readable floor and bounded growth rather than
inheriting the full scale range of the images.

Context clusters use otherwise unhelpful space only when the user zooms out far
enough. They are visibly outside the current subset. Their count does not inflate
the foreground count, and they do not move the foreground or change its bounds.
Click replaces the scope; Shift-click adds the exact previewed membership.

## Preview, commitment and arrangement are different actions

Hovering an attribute value asks “where are these?” Hovering its heading asks
“how is this attribute distributed?” Neither question should move the evidence,
change membership, alter the camera or write a permalink. Keyboard focus offers
the same preview; a persistent lens is an explicit choice.

Sort changes arrangement inside the groups. Filter changes membership. Pin
changes durable presentation. Dive changes the focused item. Keep these effects
separate in the UI and in state so users can interpret what happened.

The lens legend names the preview and the current sort separately. Ordered
attributes use an ordered scale, categories use discrete cues, and missing values
remain identifiable. Music's multiple year tags use the earliest tagged year for
the sort and lens; that policy must be visible and must not imply historical
verification. Color alone must never carry an essential distinction.

## Preserve places, but make change explicit

Hover keeps geometry stable. A fitted overview may reflow with its available
space; a deliberately positioned camera stays put until Fit. Sorting is an
explicit reason to move items. The tension between reflow and spatial memory is
real: a future manual arrangement must survive automatic layout changes.

A copied URL should reconstruct the deliberate view. Fit is a receiving-viewport
intent; custom framing preserves relative focus and scale. A URL is not a backup
of media and does not make a private network drive public. Changed corpus content
must produce an explicit mismatch, not a convincing but false reconstruction.

## Evidence and ownership remain visible

Original media, research notes and authored tags belong to the source store.
Capture preserves existing research. Derived previews, estimated attributes,
view state and permalink snapshots belong to the viewer's instance. Never erase
the distinction between observed metadata, authored judgment and inference.

Each inferred attribute needs a definition, source/version, uncertainty policy,
and a route to correction or exclusion. Compression savings is a measured image
property under a particular preprocessing pipeline; it is not a synonym for
repetition. Kaleido and complexity labels are estimates, not facts about intent.

## Representation may change; the item must not

Far atlas pixels, near textures and promoted DOM cards are representations of
the same identity. They must agree on image, rectangle, depth, activation target
and selected state. Promotion must not substitute a different item, steal focus,
or appear to move the image. Failure should produce an understandable placeholder
and a usable fallback, not stale pixels that look successful.

The hybrid renderer is an optimization with obligations. A bounded DOM pool is
not proof of bounded whole-page cost or keyboard reachability. A screenshot is
not evidence of correct activation; a correct URL is not evidence of correct GPU
pixels. [HYBRID_HARDENING.md](HYBRID_HARDENING.md) turns these obligations into work.

## What remains open

Layer meaning and gestures; readable-density controls; touch exploration without
hover; relationship pivots and traversal; manual versus automatic placement;
corpus portability and retained revisions; accessibility of large collections;
and a name that fits the broader product. Treat these as design decisions to
test with actual tasks. [PRECEDENTS.md](PRECEDENTS.md) provides starting points,
not borrowed validation of our implementation.
