# Faceting: reachable values, contextual counts, reversible scope

Design and evidence note · 16 October 2026

Wunderkammer's Muriel showcase should let someone find an uncommon attribute value,
combine it with another dimension, understand the remaining alternatives, and
recover without restarting their exploration. The bounded upgrade is facet-local
value search, contextual counts, explicit removal controls, and zero-state
recovery. It uses the existing scope evaluator and stable clip identity.

This note specifies the contract for the upgrade; implementation and test
results are separate evidence. It contains no private corpus examples.

## What the baseline is missing

Source inspection at `6ac1e70` established three gaps:

| Baseline behavior | Consequence | Upgrade |
|---|---|---|
| `buildFacetRailNow()` in `wall/wall.mjs` retains the top 24 values plus active values; its tail button focuses the global search box. `matchesFilters()` in `wall/context-clusters.mjs` searches title, note, source, URL, and tags, but not arbitrary `props`. | A rare property value can be a valid facet choice yet unreachable through the offered search route. | Search the complete value catalog of that facet; retain incremental expansion for browsing. |
| Visible chip numbers are corpus totals. `updateFacetShares()` computes a current-scope fraction against that corpus total, including the facet's own restriction. | The numeric label does not describe contextual alternatives. A sibling value can look absent even though adding it would widen an OR selection. | Show **In view / available**, with the facet's own restriction omitted only from the available count. |
| The scope bar names frozen branches, but replaces query/facet detail with a generic refinement message when branches exist. Rail toggles, Back, and All content exist; per-facet clearing and active-value removal in the summary do not. | Removing one constraint requires finding its rail entry or undoing broader work. | Keep each active value removable, expose per-facet clearing, and preserve the remaining scope. |

These are gaps in the controls and feedback. The existing OR-within,
AND-across evaluator is the foundation to preserve. See
[PRODUCT.md](PRODUCT.md#search-and-facets-define-scope) and
[ARCHITECTURE.md](ARCHITECTURE.md#context-clusters-and-union-scope).

## Evidence and its limits

**Yee, Swearingen, Li, and Hearst (2003), _Faceted Metadata for Image Search and
Browsing_.** Flamenco combines hierarchical category navigation, keyword
search, and query previews. Its design offers multiple entry paths and avoids
navigation links leading to zero results. The comparative study analyzed 32
participants with art-history interests using 35,000 fine-art images. It found
strong preference for the faceted interface; it did **not** produce faster task
times, and response latency and system failures affected timing. This supports
examining guided exploration and understandable alternatives, not claiming that
Wunderkammer will be faster or that its flat OR facets reproduce that interface.
[Primary paper, design and study sections](https://courses.ischool.berkeley.edu/i247/f05/readings/Yee_Flamenco_CHI03.pdf).

**Current implementation precedents.** Elastic's official filter documentation
shows a result set restricted by brand and color while calculating available
colors with the color restriction omitted. Algolia's official faceting guidance
distinguishes conjunctive/disjunctive filtering and supports search within a
facet's values. Its refinement-list documentation also describes how truncation
can hide previously selected values. These establish concrete implementation
patterns and failure modes, not comparative human-outcome evidence.
[Elastic filter semantics](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/filter-search-results),
[Algolia faceting](https://www.algolia.com/doc/guides/managing-results/refine-results/faceting),
[Algolia refinement list](https://www.algolia.com/doc/api-reference/widgets/refinement-list/js).

The decisions below are Wunderkammer's design contract, informed by those sources
and its existing architecture. They do not require adopting either service.

## Scope and count semantics

The visible pair is **In view / available**. Here, “In view” means membership
in the current working subset, including offscreen clips. It never means only
the visible camera rectangle, loaded thumbnails, a pile face, or DOM instances.

Let `U` be the unique clip identities in the loaded corpus, using `clipKey()`.
Let `B` be the union of the exact frozen branch keys intersected with `U`:
`branches === null` means `B = U`; `branches = []` means `B = ∅`.
Let `T` be the items satisfying the global text query. For each facet `f`,
`P_f` matches any of its selected values, or all items if none is selected.
Use the canonical value semantics, including captured-date prefix matching.

```text
Current working subset R = B ∩ T ∩ all P_f
Context for facet f   E_f = B ∩ T ∩ all P_g where g ≠ f
Value membership      V_f,v = items matching value v in facet f

In view(f,v)  = |R ∩ V_f,v|
Available(f,v) = |E_f ∩ V_f,v|
Corpus(f,v)    = |U ∩ V_f,v|
```

Compute both visible counts through the same field interpretation as scope.
Count each clip once per value, even if a multi-valued property repeats a value
or the clip appears in several frozen branches or rendered groups. Facet rows
can overlap, so their counts need not sum to the working-set total.
The host supplies one normalized corpus record per canonical identity; the
facet model does not merge conflicting duplicate records from an adapter.

Available holds global text, every other facet, and the frozen branch union
fixed. It omits **only this facet's own selection**. It is neither the number
newly added by a click nor the total resulting from adding an OR alternative.
The corpus count is additional context in the accessible name, not the visible
denominator. A suitable accessible name identifies the facet, value, both
counts, and the corpus total. Selection remains a separate `aria-pressed` state.

A synthetic example makes the distinction inspectable:

| Clip | Topic values |
|---|---|
| A | Archive, Review |
| B | Archive |
| C | Review |

With `Topic = Archive` and no other restrictions, the working subset is A+B.
Archive shows `2 / 2`; Review shows `1 / 2`. Adding Review produces A+B+C:
three unique clips. Its available count of two was not an increment of two.
If another facet excludes C, Review becomes `1 / 1`. If a frozen branch excludes
C, clearing Topic still cannot reintroduce C. Only an explicit change to the
branch boundary can do that.

The chip fill changes from **current / corpus** to **current / available** so
it agrees with the visible numeric denominator. Treat a zero available count
as an empty fill, never divide by zero. Preserve readable numbers and a
noncolor selection cue; the fill is supplemental feedback. Values selected in
this facet normally have equal current and available counts; unselected values
can still have a positive current count through multi-valued overlap.

## Finding and removing values

- Facet-local search matches that facet's value labels. It changes the options
  being browsed, not the global query, membership, layout, camera, or permalink.
  Applying a value is the explicit scope-changing action.
- Keep a bounded initial list and **Show 24 more** expansion. Search must reach
  values beyond the initial 24; it must not search only the rendered chips.
  Preserve deterministic ordering instead of reranking the list after every
  refinement. Chronological value ordering remains meaningful for date facets.
- Keep active values reachable when local search does not match them, their
  count becomes zero, or the catalog no longer supplies them. The active-scope
  controls provide a removal route independent of the truncated value list.
- Multiple chosen values in one facet mean OR; different facets and global
  search combine by AND. No modifier key is required to add or remove a value.
- Remove one active value without changing sibling values. Clear one facet
  without clearing global search, other facets, or frozen branches. Clearing
  all facets, if offered, still preserves global search and frozen branches.
  **All content** is the separate existing action that clears the entire scope.
- Keep keyboard focus on a surviving logical control after an update. Local
  typing must not rebuild and replace its focused input on every keystroke.
  Expose input labels, pressed states, clear controls, and counts accessibly.

Local value search returning no labels and the wall having no matching clips
are different states. The former offers clearing the local value search. The
latter retains the active query, facets, and branches, with routes to remove a
value, clear a facet, remove a text query, use Back, or explicitly choose All
content. It must not silently clear a constraint or widen a frozen branch to
make the wall look populated. An empty branch union remains empty.

Zero available values remain selectable with an explicit zero count. This keeps
the value catalog stable and supports deliberate combinations; the scope bar,
facet clear control, and empty-state **Show all content** provide recovery.
Active zero-count values remain removable.
Flamenco's prevention strategy does not eliminate the need to recover from
zero results caused by text changes, restored links, or corpus changes here.

## Muriel synthesis

The working-set task is comparison and refinement: discover an uncommon value,
see its relationship to other dimensions, and undo a mistaken constraint.
Facet-local search addresses vocabulary discovery; current/available counts
make alternatives inspectable; retained selections and explicit removal make
recovery possible. The original compact chips were changed to readable rows
with count pairs and a noncolor selection mark. Existing color, typography,
scope history, preview behavior and identity remain the design foundation.

This deliberately adds one number and one short explanation to each facet
system. The tradeoff is a taller rail and a distinction users must learn. The
browser checks establish readable controls and correct mechanics; a human
comparison task must still test whether people understand the denominator.
Hierarchies and numeric ranges remain separate designs, not inferred features.

## Showcase task and acceptance evidence

Use a public or synthetic fixture with more than 24 values in one property,
multi-valued overlap, missing properties, and at least two independent facets.
Include a rare value found only in `props`, outside the fields searched by the
global query. No private collection is required.

1. Find that rare value through its facet and apply it. Explain the scope using
   the active-value control; global search remains unchanged.
2. Add a second value in the same facet, then choose a value in another facet.
   Check the exact resulting identities and both count columns, including an
   overlapping item. Explain why available is not the click's result total.
3. Hover or keyboard-focus a value to preview its members. Preview leaves
   scope unchanged; clicking commits the refinement through the existing model.
4. Switch Survey/Review and inspect an item at detail scale. Scope and counts
   remain the same even though representation, visibility, and camera differ.
5. Create a zero-match combination, remove only the responsible value or facet,
   and recover. Repeat inside a frozen branch union; clearing facets must not
   escape that union. Back restores the prior deliberate scope.

Model checks should independently verify the expected unique IDs, OR/AND
composition, own-facet omission, repeated values, date prefixes, and null versus
empty branches. Browser checks should exercise real controls, a value beyond
the first page, keyboard focus, narrow-screen access, active-value removal,
zero-result recovery, and permalink restoration after scope edits. Local search
text is a transient browsing aid rather than an additional saved filter.

These checks establish the exercised behavior. They do not establish faster
discovery, lower workload, or better understanding. Evaluate those outcomes
with representative tasks and users, checking whether people correctly explain
the counts and can recover from mistakes. This slice does not add hierarchical
facets, numeric range builders, server-side search, arbitrary Boolean queries,
new metadata inference, or a new missing-value classification.

## Implementation verification

The implementation joins the canonical filter predicate and history path;
facet-local text and pagination remain transient. Captured-prefix previews use
the same membership predicate. Scope-summary controls retain their DOM identity
during saved-link updates, and native controls retain Enter when automatic
detail preview is open. Flat and spatial views share the empty-scope recovery
control. The first empty spatial view now initializes its camera's `fitted`
state, so its saved link remains valid before recovery.

The pure model, scope, attribute and permalink pass completed 36 checks.
`MUTATION_FILTER=facet node scripts/check-mutations.mjs` detected both deliberate
defects: applying the counted facet's own restriction and losing selected values
outside a local value search. The focused browser pass completed **15/15** checks
in 25.77 seconds, including rare values, OR/AND counts, frozen unions, retained
selections, captured-prefix previews, keyboard focus, phone input, zero-result
recovery and an initially empty 3D view saved and restored in a fresh context.
These passes overlap and should not be summed.

The full application run completed **263/265** checks in 424.15 seconds. One
failure expected the superseded global-search tail control; that test now
exercises local discovery and passed its targeted rerun. The other was the
existing experimental Canary A2 card-ink check (`band.opaque > 0`). It failed
at the same assertion on both untouched `6ac1e70` and this working tree, using
identical test, fixture and spatial stylesheet files. That rendering failure
remains open; the full suite is not recorded as green.

After the final changes, the combined facet-model, facet-browser,
attribute-browser and permalink run passed **43/43** checks in 112.86 seconds,
with no skips. These checks overlap the earlier passes. Logs are retained in
ignored `.local/facet-proof/`: `full-suite.log`, `legacy-discovery-check.log`,
`a2-baseline.log`, `a2-current.log` and `focused-final.log`.

The public showcase passed five rendered states: desktop overview, year-2026
refinement, the same 91 members in 3D, phone facets, and the phone's refined
summary. There were no script errors or failed asset responses in the final
run. Measured facet/scope text contrast against actual painted backgrounds was
at least **8.528:1**. This audit covers those controls and states, not every text
element in the application. The existing phone sticky group-title clipping was
observed separately and remains outside this facet extension.

Python's static server returns HTTP 501 for the optional snapshot POST. That
response now activates the existing absent-service fallback: the inline URL
retains the complete view, the notice clears, and later views do not repeat the
request. The public smoke checked exactly one probe, inline 3D scope decoding
and a later camera-only write. The 405/501 browser regression checks both hosts;
actual service failures still retain their explicit error behavior.

A local diagnostic measured only `buildFacetModel`, with five warm-up calls and
20 measured calls per size. The public 297-record corpus had median 1.27 ms and
p95 1.36 ms. Synthetic expansions with 13 facets and a unique artist value per
record measured 6.92 / 12.03 ms at 2,000 records and 31.76 / 33.34 ms at 10,000
(median / p95). These are host-specific count-model timings, not full filter
latency, a controlled comparison, or a performance guarantee. Rendering,
layout, metadata shape and input latency still need representative measurement.
Raw results are in ignored `.local/facet-proof/model-timing.json`.

The static showcase was rebuilt under the `/clipwall-demo/` subpath from the
existing public collection. Its data and all 297 image files match the source
demo byte for byte. Generated app modules match this working tree; no private
corpus was copied. This is a local build, not a public deployment.

The October 17 source-landing verification is recorded in
HANDOFF.md: 23/23 pure checks,
30/30 focused browser checks, two detected facet mutations, and **265/266** in
the full application run. The one remaining full-suite failure is the unchanged
Canary A2 baseline rendering assertion; it is not recorded as a green suite.

## Citation verification

| Source | Verification | Evidence role |
|---|---|---|
| Ka-Ping Yee, Kirsten Swearingen, Kevin Li, Marti Hearst. _Faceted Metadata for Image Search and Browsing_. CHI 2003, pp. 401–408. [DOI 10.1145/642611.642681](https://doi.org/10.1145/642611.642681). | Full author list, exact title, venue, year, and pages verified against CrossRef and the primary paper on 16 October 2026. Design, participants, results, and timing limitations read in the paper. | Historical design and bounded comparative evidence. |
| Elastic filter documentation; Algolia faceting and refinement-list documentation, linked above. | Official primary documentation inspected on 16 October 2026. | Current implementation semantics and failure modes; no human-effectiveness claim. |
