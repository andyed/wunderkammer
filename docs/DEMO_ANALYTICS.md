# Demo analytics

The published demo (https://andyed.github.io/clipwall-demo/) reports to the
PostHog project **Wunderkammer (673826, US Cloud)**. The engine does not:
`wall/` and `index.html` carry no analytics, so a page that embeds wunderkammer
from the package or a CDN reports to nobody.

`scripts/demo-analytics.js` is the whole of it. `scripts/build-demo.mjs`
copies it into the demo as `analytics.js`, stamps `git describe` into it, and
adds one `<script type="module">` to the demo page's head, ahead of the
wall, so it reads the URL the visitor opened before the wall writes its view
into the hash.

## Posture

The posture is the same as Protoplasm and the Mind Bending Pixels sites:

- **Cookieless.** Persistence is `memory`, so every page load is a new
  anonymous visitor. There is no `identify` call and no person profile.
- **Named events only.** Autocapture, session replay, dead clicks, heatmaps
  and web vitals are off, whatever the project's remote config says.
- **Nothing the visitor typed.** A search sends its length, never its text.
  URL hashes are not captured: the wall's view links carry the scope, search
  query included, in the hash.
- **A visitor's own collection stays theirs.** With `?collection=`, the URL
  parameter is masked in PostHog's URL properties and the page title is
  dropped. Item keys and attribute names (groups, facets) are not sent;
  events carry `custom` or `null` in their place.
- **No SDK in the bundle.** The posthog-js snippet loads `array.js` from
  PostHog's asset host, async, at low fetch priority. An ad blocker costs the
  wall nothing.

## Where it is off

| Condition | Why |
|---|---|
| any host but `andyed.github.io` | local servers, and copies of the demo on other hosts |
| `navigator.webdriver` | Playwright checks; posthog-js also drops these as bots |
| `?perf` | the instrumented build |
| `?ph=0` | anywhere, by hand |

`?ph=1` turns it on anywhere, including a local server. Events from a local
host carry `env: dev`.

## Super properties (on every event)

| Property | Values |
|---|---|
| `app_name` | `wunderkammer` |
| `surface` | `demo` |
| `env` | `production` (andyed.github.io), `dev`, `other` |
| `app_version` | `git describe --tags --always --dirty` at build time |
| `collection` | `bundled`, or `custom` when the URL names one |
| `embedded` | the page is in a frame |
| `touch` | `(pointer: coarse)` |

## Events

| Event | When | Properties |
|---|---|---|
| `$pageview` / `$pageleave` | PostHog's own; one pageview per load, not per view change | |
| `wall_loaded` | the wall shows a collection | `items`, `results`, `mode`, `group`, `from_link` (the URL carried a view), `ms_to_ready` (from navigation start) |
| `wall_boot_failed` | no collection within 30 s | `reason` (`no wall`, `empty collection`), `seconds` |
| `js_error` | an uncaught error or rejection, at most 3 per load; `ResizeObserver loop` and opaque `Script error.` are skipped | `message` (≤160 chars, URLs stripped), `source` (file name), `line`, `phase` (`boot`, `running`) |
| `first_interaction` | the first gesture after the wall is ready | `gesture`, `ms_to_first` (from ready) |
| `view_changed` | flat, aisle, float or another mode | `mode`, `from`, `results` |
| `group_changed` | | `group`, `from`, `results` |
| `searched` | the query settles on new text | `query_length`, `results` |
| `search_cleared` | | `results` |
| `facet_filtered` | a facet's selection changes | `facet`, `values` (selected count), `results` |
| `scope_changed` | a cluster narrows or widens the scope | `branches`, `results` |
| `item_opened` | an item is lifted into the reader | `item` (its key; `null` for a custom collection), `results` |
| `link_copied` | Copy view or Copy live view | `kind` (`view`, `live`) |
| `visit_summary` | the page hides (by beacon) | `g_tap`, `g_drag`, `g_pinch`, `g_wheel`, `g_key`, `g_type`, `gestures`, `n_views`, `n_groups`, `n_searches`, `n_facets`, `n_scopes`, `n_items`, `seconds_visible`, `views_seen`, `summary_index`, plus the state at hide: `mode`, `group`, `results`, `ready` |

View events come from reading `window.wunderkammer.export()` shortly after
each gesture settles, so they report what changed whichever control changed
it. A view restored from a link at load is the baseline, not an event.

Each `visit_summary` counts gestures and events **since the previous
summary**, so a visitor who leaves the tab and returns is added, not counted
twice. Summing the `g_*`, `n_*` and `seconds_visible` across a visit's
summaries is exact. `views_seen` is cumulative. A summary with `ready: false`
is a visitor who left before the wall showed a collection.

Gestures: `tap` and `drag` (any pointer, split at 8 px of travel), `pinch` (a
second pointer down), `wheel` (a burst counts once), `key` (outside a text
field), `type` (a typing burst in a text field counts once).

## Checking the wiring

`tests/demo-analytics.test.mjs` covers the gate and what may leave the page;
`tests/demo-bundle.test.mjs` checks the build ships the script to the demo
page only. `scripts/check-mutations.mjs` shows those tests fail when the search
text, a custom collection's item keys, or a non-demo host get through.

To see real payloads without sending any, serve a build and open it with
`?ph=1` under Playwright:

- Mask `navigator.webdriver` and `navigator.userAgentData`, and use a desktop
  user agent, or posthog-js drops the events as a bot. Headless Chromium
  reports `HeadlessChrome` in `userAgentData.brands` whatever the user agent
  string says.
- Route `us.i.posthog.com` to a handler that decodes the gzip bodies. The
  handler catches every event, so nothing reaches the project.
