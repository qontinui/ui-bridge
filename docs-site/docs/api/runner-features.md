---
sidebar_position: 6
---

# Runner Features (HTTP API)

UI Bridge primitives shipped specifically for the qontinui-runner Tauri app
and any consumer driving it via HTTP. The SDK pieces are framework-agnostic;
the runner-only sections are called out.

This page is the **single source of truth** for the endpoints below — slash
commands, internal docs, and agent test rigs should link here rather than
duplicate the content.

## First probe: page playbook

```http
GET /control/page/playbook
```

The "what can I do here?" call. Stitches data the bridge already has into
one envelope agents can read at the start of a task to skip a couple of
trial-and-error round-trips:

```json
{
  "route": "/specs",
  "activeTab": "specs",
  "tabs": [{ "id": "specs", "label": "Specs", "active": true }, ...],
  "components": [{ "id": "...", "actions": [...], "actionInvocationPath": "..." }],
  "intents": [...],
  "recipes": {
    "tab-activate": "POST /control/tab/activate {tabId}",
    "ai-find": "POST /ai/find {query}",
    "element-action": "POST /control/element/:id/action {action,params}"
  }
}
```

Use it as the first call after spawning a temp runner. For deeper inspection,
fall through to `/control/snapshot` and `/control/components`.

## Inspection & discovery

### Snapshot

```http
GET /control/snapshot
GET /control/snapshot?visibleOnly=true
GET /control/snapshot?currentRouteOnly=true
GET /control/snapshot?visibleOnly=true&currentRouteOnly=true
```

Returns elements + components + page state. Each element carries its
dynamic state under `state` (see "Reading element state" below).

The response also includes:

- `route` — `window.location.pathname`
- `activeTab` — runner-only; reflects the current tab id (e.g. `"specs"`).
  Decoupled from `route` because tab-based apps can switch tabs without
  changing the URL. Populated when the host supplies a `getActiveTab`
  callback (the runner does this automatically).
- `availableTabs` — runner-only; full tab catalogue:
  `[{ id, label, alias?, active }]`. Lets you switch tabs without a
  separate `/control/tabs` round-trip.
- `tabActivation` — runner-only; static hint object describing how to
  switch tabs (`{ method: "POST", path: "/control/tab/activate", body: {tabId} }`).
- `registration: { totalRegistered, everHadRegistrations, byRoute }` —
  metadata for distinguishing "page has no `useUIElement` coverage" from
  "bridge is broken / not yet mounted." `everHadRegistrations` is a
  sticky latch: it flips `true` on first register and never flips back.
- `snapshotTakenAtMs` — server epoch ms when the snapshot was built.

**Filtering tips:**

Elements registered via `useUIElement` linger in the registry across tab
switches because React Navigation keeps inactive tabs mounted. Their last
measured `layout` sticks around too. So a raw snapshot returns a mix of
on-screen and off-screen elements. Use:

- `visibleOnly=true` — only elements with a layout AND `visible: true`.
- `currentRouteOnly=true` — only elements registered on the current
  route (filters out cross-route persistence).
- Both together — tightest "what is the user seeing right now" snapshot.

When verifying "did the tab switch and did my new component render?",
always use at least `visibleOnly=true`. Offscreen-marking fires
synchronously via `RouteProvider.subscribe()`, so a snapshot taken
immediately after `/control/page/navigate` already reflects cleared
layouts for the departed route.

### Snapshot field provenance

`/control/snapshot` is served by three different code paths depending
on the host: the canonical SDK registry (`registry.createSnapshot`,
shared by every wrapper and SPA), the React/IPC relay handler
(`commandHandlers.ts:getControlSnapshot`, used when a CommandRelay sits
between HTTP and the page — supervisor dashboard, Next.js host), and
the Tauri runner's discovery enrichment
(`useDiscoveryEvents.ts: enrichedSnapshot`). Each path adds different
top-level keys, so the supervisor dashboard's snapshot has a strict
subset of the runner's keys. Tests that assume a single shape will
miss data on lean hosts or fail on rich ones — target the union and
branch on `appType` (or feature-detect the field) when a probe is
host-specific.

| Field               | Source             | What it carries                                                                                          |
| ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `timestamp`         | registry-native    | `Date.now()` when the snapshot was built (legacy alias of `snapshotTakenAtMs`).                          |
| `snapshotTakenAtMs` | registry-native    | Server epoch ms when the snapshot was built — same value as `timestamp`, kept for forward-compat.        |
| `route`             | registry-native    | `window.location.pathname` at snapshot time. Optional — omitted when `window` is absent (SSR/tests).     |
| `activeTab`         | registry-native\*  | Active tab id when the host supplies a `getActiveTab` callback. \*Runner is the only current provider.   |
| `registration`      | registry-native    | `{ totalRegistered, everHadRegistrations, byRoute }` — bridge-coverage diagnostics for the F3 contract.  |
| `elements`          | registry-native    | All registered `useUIElement` records (each with nested `state`, `bbox`, `identifier`, etc.).            |
| `components`        | registry-native    | Registered components, each with `id`/`name`/`actions`/`elementIds`/`actionInvocationPath`.              |
| `workflows`         | registry-native    | Registered workflows. Shape differs by source — see "Shape drift" below.                                 |
| `activeRuns`        | relay-handler-only | Always `[]` from the relay path; the workflow-engine populates this on hosts that own a runtime.         |
| `availableTabs`     | runner-only        | `[{ id, label, canonical, active }]` — full tab catalogue, lets you switch tabs without `/control/tabs`. |
| `tabActivation`     | runner-only        | Static hint object — `{ description, method, path, bodyExample }` for `POST /control/tab/activate`.      |
| `page`              | runner-only        | `NavigationTracker.getSnapshotPageContext()` — current page metadata (title, route history, etc.).       |
| `modalStack`        | runner-only        | `ModalDetector.getSnapshotModalContext()` — active modals/dialogs/drawers in z-order.                    |
| `toasts`            | runner-only        | `ToastCapture.getSnapshotToastContext()` — active and recently dismissed toasts.                         |
| `relationships`     | runner-only        | `RelationshipTracker.getSnapshotRelationshipContext()` — declared + ARIA-derived element relationships.  |
| `dragDrop`          | runner-only        | `DragDropDetector.getSnapshotDragDropContext()` — drag sources and drop zones detected in the UI.        |
| `undoRedo`          | runner-only        | `UndoTracker.getSnapshotUndoContext()` — undo/redo availability and stack depth.                         |
| `shortcuts`         | runner-only        | `ShortcutTracker.getSnapshotShortcutContext()` — keyboard shortcuts discovered in the application.       |

**Shape drift on shared fields.** Even when a field name appears in
both paths, the shape is not always identical:

- `workflows[].steps` (relay) vs `workflows[].stepCount` (registry).
  The relay path keeps the full `steps` array because existing
  relay-driven callers read it directly; `createSnapshot` returns the
  leaner shape with just a count.
- `components[].state` (relay) is `c.getState?.() ?? {}`; the registry
  path omits `state` from the snapshot-level component summary
  entirely (state is read per-component via `/control/component/:id`).

**Optional fields not currently emitted by the runner enrichment** but
declared on the `ControlSnapshot` type for future use:
`viewport`, `errorSummary`, `fallbackScreenshot`. Tests should treat
their absence as "feature not on this build," not "bug."

### Discover

```http
POST /control/discover
{ "interactive_only": false }
```

Forces a re-scan of the page for unregistered elements. Useful when
`useUIElement` coverage is incomplete and elements are reachable only
via DOM walk.

### Get element

```http
GET /control/element/:id
GET /control/element/:id/tree?depth=N
```

`/element/:id` returns the registered element record (state under
`state`). `/element/:id/tree` BFS-walks the rendered DOM subtree, useful
for "where exactly does this element sit?" answers in one call:

```json
{
  "tagName": "div",
  "attributes": {
    "class": "...",
    "data-testid": "...",
    "role": "...",
    "aria-label": "...",
    "name": "...",
    "type": "..."
  },
  "childCount": 4,
  "children": [
    /* recursive same shape */
  ],
  "truncated": false
}
```

`depth` accepts `1..6` (default 2). 200-node cap; `truncated: true` when
hit. Class attribute trimmed to 80 chars; only `data-*`, `role`, `title`,
`aria-label`, `name`, `type` are surfaced.

The bare `/element/:id`:

```json
{
  "id": "input-foo",
  "type": "input",
  "actions": ["focus", "blur", "type", "clear", "click"],
  "state": {
    "value": "user@example.com",
    "visible": true,
    "enabled": true,
    "focused": false,
    "rect": { "x": 100, "y": 200, "width": 300, "height": 40 }
  }
}
```

## Reading element state — `state.value`, not top-level

The dynamic state lives at `data.state.value`, NOT `data.value`. Inputs'
typed text, checkboxes' checked, focused/enabled/visible flags, and the
element's bounding rect are all under `state`.

```bash
# Correct
curl -s $BASE/control/element/input-foo | jq '.data.state.value'

# Wrong — returns null on inputs even when typed
curl -s $BASE/control/element/input-foo | jq '.data.value'
```

Snapshot elements use the same nested shape. After a `type` / `clear` /
`setValue` action, `state.value` is updated synchronously by the SDK's
action-driven registry refresh — no polling needed.

## Interaction actions

```bash
# Click variants
$BASE/control/element/<id>/action  body:{"action":"click"}
                                       {"action":"doubleClick"}
                                       {"action":"rightClick"}
                                       {"action":"middleClick"}

# Type / Clear / SetValue / Select
{"action":"type","params":{"text":"value","clear":true,"delay":50}}
{"action":"clear"}
{"action":"setValue","params":{"value":"new-value"}}
{"action":"select","params":{"value":"option1","byLabel":false}}

# Focus / Blur / Hover
{"action":"focus"} | {"action":"blur"} | {"action":"hover"}

# Scroll
{"action":"scrollIntoView"}
{"action":"scroll","params":{"direction":"down","amount":300,"smooth":true}}

# Checkbox
{"action":"check"} | {"action":"uncheck"} | {"action":"toggle"}

# Drag
{"action":"drag","params":{"target":{"elementId":"target-id"},"steps":20}}

# Submit / Reset
{"action":"submit"} | {"action":"reset"}

# Keyboard events (for terminals, canvas, etc.)
{"action":"sendKeys","params":{"keys":[{"key":"Enter"},{"key":"v","modifiers":{"ctrl":true}}]}}
```

Mutation actions (`type`, `sendKeys`, `clear`, `setValue`, `select`,
`check`, `uncheck`, `toggle`, `submit`, `reset`, `autocomplete`) push
the post-action `elementState` into the registry's overlay, so subsequent
reads (`/control/element/{id}`, `/control/snapshot`) reflect the new
value immediately. Click/hover/scroll do not write to the cache; the
live DOM stays authoritative there.

### Per-action param names (the easy mistakes)

Each action defines its own param shape — the names are NOT interchangeable.
Sending the wrong key now returns `success: false` with a descriptive error;
prior to v0.x.y the action returned silent success, which was an invisible
failure mode.

| Action     | Required param              | Common mistake                                                               |
| ---------- | --------------------------- | ---------------------------------------------------------------------------- |
| `type`     | `text: string`              | Sending `value` (used by `select`/`setValue`)                                |
| `select`   | `value: string \| string[]` | Sending `text` (used by `type`)                                              |
| `setValue` | `value: string`             | Sending `text`                                                               |
| `sendKeys` | `keys: [{key, modifiers?}]` | Sending `value: "Enter"` (it's an array of descriptors, not a single string) |

If an action returns `success: false` with `error: "... requires a 'X' parameter ..."`, the param key was wrong or missing. Sending the wrong key for `type` triggers a hint pointing at the correct one.

## Page navigation

### Soft vs hard

```bash
# Hard (default, back-compat) — full webview reload on real SPAs.
# Wipes injected globals (test mocks, fetch patches, bookmarks).
curl -X POST $BASE/control/page/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"/fleet"}'

# Soft — history.pushState + popstate, preserves window.<globals>
# and SDK state (network stubs, bookmarks).
curl -X POST $BASE/control/page/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"/fleet","mode":"soft"}'
```

Default `mode` is `"hard"` for back-compat with the pre-2026-04-23
`{url}`-only envelope. On the runner specifically, "hard" still uses
`pushState` (a full webview reload would kill the Tauri session) — the
distinction there is which event fires (`popstate` for soft only). On
real SPAs (supervisor dashboard, Next.js), hard does reload.

Response shape: `{ url, hard, mode, clientSideNavigation }`. Invalid
`mode` returns HTTP 400.

### Refresh

```http
POST /control/page/refresh
```

### Close-request (runner only)

```http
POST $RUNNER_BASE/control/page/close-request
```

Simulates a user clicking the window's X button. Fires Tauri's native
`WindowEvent::CloseRequested` on the main webview, which is the only
reliable way to exercise the runner's shutdown path through UI Bridge.
`window.close()` via `/control/page/evaluate` is a no-op for top-level
webviews, and Win32 `WM_CLOSE` messages don't consistently reach Tao's
event pump.

### Mobile route navigation

```bash
curl -X POST $MOBILE_BASE/control/page/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"/"}'        # dashboard
  -d '{"url":"/settings"}'
  -d '{"url":"/processes"}'
```

Uses Expo Router's `router.push()` via UIBridgeNativeProvider's
navigationProvider. Prefer this over clicking tab buttons: React
Navigation's `tabBarButton onPress` is wired through internal gesture
state, so calling it via UI Bridge press often no-ops.

**NOTE:** use plain routes like `/`, `/settings`. Do NOT use
`/(tabs)/index` — the explicit index segment can crash Expo Router and
take down the UI Bridge server.

## Tab activation (runner only)

```http
GET /control/tabs
POST /control/tab/activate { "tabId": "specs" }
```

`GET /control/tabs` returns `{ activeTab, tabs: [{id, label}] }`.
`POST /control/tab/activate` fires the same `ui-bridge-set-tab` event a
user click dispatches — lazy-mounts and URL-state-sync fire as usual.

Unknown `tabId` returns HTTP 400 with `{ error: "unknown_tab",
knownTabs: [...] }` so you don't have to guess.

The snapshot response also surfaces `activeTab` alongside `route` so
you can confirm a tab activation without a separate `/control/tabs`
call.

## Network stubs (fetch short-circuit)

Prefer this over monkey-patching `window.fetch` via `page/evaluate`.
Stubs live in a module-level SDK singleton — they survive React
re-renders and soft navigations; they clear on hard reload.

```bash
# Install — substring URL match, first-registered wins on overlaps.
curl -X POST $BASE/control/network/stubs \
  -H "Content-Type: application/json" \
  -d '{
    "urlPattern": "/api/v1/runners",
    "method": "GET",
    "response": { "status": 200, "bodyJson": [{"id":"fake","name":"e2e"}] },
    "times": "always"
  }'
# → {"success":true,"data":{"id":"stub_abc"}}

# List active stubs (shows hitCount + timesRemaining)
curl $BASE/control/network/stubs

# Remove one or all
curl -X DELETE $BASE/control/network/stubs/stub_abc
curl -X DELETE $BASE/control/network/stubs

# Verify match without consuming (peek)
curl -X POST $BASE/control/network/verify-stub \
  -H "Content-Type: application/json" \
  -d '{"urlPattern":"/api/v1/runners","method":"GET"}'
# → {"matched":true,"stubId":"stub_abc","response":{...},"stubEntry":{hitCount,timesRemaining}}
```

`times: 1` stubs are consumed on the first matched fetch. `verify-stub`
is non-consuming — `hitCount` and `timesRemaining` stay unchanged.

**Triggering the stubbed fetch from `page/evaluate`:** the evaluator
blocks the literal `fetch(` token. Dodge via indirect access:

```bash
curl -X POST $BASE/control/page/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression":"(async()=>{const f=window[\"fet\"+\"ch\"];const r=await f(\"/api/v1/runners\");return r.status+\" \"+(await r.text()).length})()"}'
```

## Wait-for-element (state predicates)

Element-level wait primitive — replaces the snapshot-poll-in-a-loop
pattern. Resolves the moment the predicate flips, or returns
`found: false` after `timeoutMs`.

```http
POST /ai/wait-for-element
{
  "elementId": "input-foo",
  "state": "value-not-empty",
  "timeoutMs": 5000,
  "pollMs": 50
}
```

Response:

```json
{
  "success": true,
  "data": {
    "found": true,
    "durationMs": 123,
    "finalState": { "value": "hi", "visible": true, ... }
  }
}
```

States: `present`, `visible`, `enabled`, `disabled`, `value-not-empty`,
`value-empty`, `checked`, `unchecked`, `absent`. Default timeout
5000ms (max 30000ms); default poll 50ms (min 10ms).

`value-not-empty` also returns true for a checked checkbox.

### Predicate-shape (registry-driven)

Same path; selected when the body has a `predicate` key. Resolves on
the first registered element that matches `id` / `label` / `testId` /
CSS `selector`, or returns `reason: "timeout"` after `timeoutMs`.

```http
POST /ai/wait-for-element
{
  "predicate": { "label": "Save" },
  "requirement": "visible",
  "pollMs": 100,
  "timeoutMs": 5000
}
```

`requirement`: `"registered"` (default) | `"visible"` | `"has-layout"`.
`predicate.selector` falls back to `document.querySelector` per poll;
the other keys hit the registry directly. Defaults: `pollMs` 100
(clamped `[50,1000]`), `timeoutMs` 5000 (clamped `[100,60000]`).

Response on match: `{ element: {id, label, type, ...}, elapsedMs }`.
Response on timeout: `{ reason: "timeout", elapsedMs, closestMatch? }`
where `closestMatch` is populated when a predicate-matching element
exists but fails the `requirement` filter.

The legacy state-shape above (with `elementId` + `state`) and the
predicate-shape are routed by body shape on the same path — both keep
working.

## Wait-for-route-change

Drop-in for `sleep 2` after a click that triggers SPA navigation.
Resolves on the first matching `navigation:change` from the
ChangeTracker. Has a recent-buffer fast-path: if a matching transition
fired within the last `timeoutMs` ms, returns immediately with
`elapsedMs: 0`.

```http
POST /ai/wait-for-route-change
{
  "fromRoute": "/settings",
  "toRoute": "^/dashboard(/.*)?$",
  "matchMode": "regex",
  "timeoutMs": 5000
}
```

`matchMode`: `"exact"` (default) | `"prefix"` | `"regex"`. Invalid
regex returns 400. Defaults: `timeoutMs` 5000 (clamped `[100,60000]`).
`fromRoute` and `toRoute` are both optional — omit either to wildcard
that side.

Response on match: `{ from, to, elapsedMs }`.
Response on timeout: `{ reason: "timeout", lastKnownRoute?, elapsedMs }`.

Aliased at `/control/wait-for-route-change` for symmetry with the rest
of the `/control/` path family.

## ai/find — natural-language element lookup

Resolves a free-form query (`"home button"`, `"the email field"`) to a
single best-match registered element. This is the workhorse for
"click the X" agent steps — it's a level above `/control/snapshot` +
client-side filtering because it knows the host's labels, aliases, and
synonym table.

```http
POST /ai/find
{
  "query": "home button"
}
```

The body is `{ query: string, includeHidden?: bool }`.

- `includeHidden` (bool, optional, **default true**): match elements regardless of visibility — preserves historical front-end behaviour (the registry contains hidden elements like collapsed-sidebar children). Pass `false` to opt into the visibility filter.

### Response shape

The response is **single-best-match**, not a list. The chosen element
lives at `data.element`; runner-up candidates (if any) live at
`data.alternatives`.

```json
{
  "success": true,
  "data": {
    "found": true,
    "elementId": "button-home-0",
    "element": {
      "id": "button-home-0",
      "label": "Home",
      "tagName": "button",
      "type": "button",
      "semanticType": "action-button",
      "actions": ["focus", "blur", "click", "hover", "middleClick"],
      "aliases": ["btn", "home", "main", "click", "start", "button", "dashboard"],
      "description": "\"Home\" button",
      "labelText": "Home",
      "parentContext": "nav[Main navigation]",
      "registered": true,
      "state": {
        "accessibleName": "Home",
        "rect": {
          /* ... */
        },
        "computedStyles": {
          /* ... */
        }
      }
    },
    "confidence": 1,
    "matchReasons": [
      "exact label match",
      "alias match: \"home\"",
      "synonym match: \"home\" ~ \"main\""
    ],
    "decomposed": {
      "ariaLabel": "Home",
      "elementText": "Home",
      "label": "Home",
      "name": "Home",
      "placeholder": "Home"
    },
    "suggestedActions": ["click \"home\""],
    "alternatives": [],
    "ambiguous": false,
    "durationMs": 5.2
  }
}
```

Fields under `data`:

- `found: bool` — cheap success check. `false` means nothing scored
  above the match threshold; `element` and `elementId` will be absent
  or null.
- `elementId: string` — id of the chosen element. Pass straight to
  `/control/element/:id/action`.
- `element: ElementSummary` — the full chosen element, including its
  registered actions, aliases, semantic type, and dynamic `state`
  (rect, computed styles, accessibleName, etc.). **Single object,
  not an array.**
- `confidence: number` — 0..1 score for the chosen element. `1` is an
  exact label/alias hit; lower scores typically come from synonym or
  partial-text matches. Treat anything below ~0.6 as worth confirming.
- `matchReasons: string[]` — human-readable explanations for _why_
  this element won (e.g. `"exact label match"`, `"alias match: \"home\""`,
  `"synonym match: \"home\" ~ \"main\""`). Useful for logs and for
  surfacing "did the agent click the right thing" diagnostics.
- `alternatives: ElementSummary[]` — runner-up candidates that also
  scored. Empty when the win was unambiguous. Look here when you want
  the "all reasonable matches" list a `matches[]` field would have
  given you.
- `ambiguous: bool` — `true` when the top score isn't a clear winner
  over `alternatives[0]`. Pair with `alternatives` to disambiguate.
- `suggestedActions: string[]` — natural-language hints like
  `click "home"` you can pipe back into a higher-level planner.
- `decomposed: object` — the parsed query terms broken out by signal
  source (`label`, `ariaLabel`, `placeholder`, `name`, `elementText`).
  Reflects what the matcher actually searched for.
- `durationMs: number` — server-side match time.

> **Common mistake:** `data.element` is a single object, not an array.
> Earlier docs and some cheatsheets imply a `matches[]` list — that's
> wrong. Use `data.alternatives` if you need the runner-up list, and
> `data.found` to gate "did we find anything at all."

### What gets matched

The query is matched against the following element signals, in
precedence order:

1. associated `<label>` text (via `htmlFor` or wrapping ancestor)
2. visible `textContent`
3. input `value`
4. `aria-label`
5. `placeholder`
6. `name` attribute

So an `<input placeholder="What would you like to do?">` matches
`query: "What would you like"` (substring of placeholder) but NOT
`query: "prompt"` (no signal contains "prompt"). **Use phrases the
user actually sees** — labels, button text, placeholders. Don't search
by abstract concepts unless the abstract word literally appears
on-screen.

### Using the response

Gate downstream logic on `data.found`:

```bash
RESP=$(curl -s -X POST $BASE/ai/find \
  -H "Content-Type: application/json" \
  -d '{"query":"home button"}')

if [ "$(echo "$RESP" | jq -r '.data.found')" = "true" ]; then
  ID=$(echo "$RESP" | jq -r '.data.elementId')
  curl -X POST "$BASE/control/element/$ID/action" \
    -H "Content-Type: application/json" \
    -d '{"action":"click"}'
fi
```

Handle ambiguity by checking `confidence` and `alternatives`:

```bash
CONF=$(echo "$RESP" | jq -r '.data.confidence')
AMBIG=$(echo "$RESP" | jq -r '.data.ambiguous')

if [ "$AMBIG" = "true" ] || awk "BEGIN { exit !($CONF < 0.6) }"; then
  # Top match is shaky — surface alternatives to the planner / user
  echo "$RESP" | jq '.data.alternatives[] | {id, label, semanticType}'
fi
```

## Change tracking & bookmarks

```bash
# Buffer DOM mutations between two interactions
curl -X POST $BASE/ai/change-buffer/enable
# ... perform actions ...
curl -X POST $BASE/ai/change-buffer/drain
curl -X POST $BASE/ai/change-buffer/disable

# One-shot diff against the previous implicit baseline
curl $BASE/ai/diff

# Bookmark + diff
curl -X POST $BASE/ai/bookmarks \
  -H "Content-Type: application/json" \
  -d '{"name":"before-test"}'
# ... perform actions ...
curl $BASE/ai/bookmarks/before-test/diff
```

Bookmarks live in a process-wide singleton — `save` and `list` always
agree, regardless of which dispatcher path served the request.

**Path naming.** The list/save endpoints use the plural `/ai/bookmarks`;
the per-resource endpoints historically used the singular
`/ai/bookmark/:name` and `/ai/bookmark/:name/diff`. As of 2026-05-01 the
plural variants are also accepted (`/ai/bookmarks/:name`,
`/ai/bookmarks/:name/diff`) for symmetry with list/save. Both forms hit
the same handlers; prefer the plural for new code.

## Forms

```bash
# Discover all forms on the page
curl $BASE/ai/forms

# Multi-field fill
curl -X POST $BASE/ai/fill-form \
  -H "Content-Type: application/json" \
  -d '{
    "fields": [
      {"elementId":"input-name","value":"Test"},
      {"elementId":"input-email","value":"test@example.com"}
    ]
  }'
```

`ai/forms` walks the DOM and finds inputs even when `ai/find` cannot
reach them by element-text matching — useful as a fallback for
form-heavy pages.

## Idle status

```bash
curl $BASE/ai/idle-status
curl -X POST $BASE/ai/wait-for-idle \
  -H "Content-Type: application/json" \
  -d '{"timeout": 5000}'
```

Returns weighted signals across `dom`, `form-mutation`,
`loading-indicators`, and `network` with per-signal `idle: bool` plus
an aggregate `idleScore`. `wait-for-idle` resolves when all signals
settle or after the timeout.

## Console & network monitoring

```http
GET /control/console-errors                  # legacy: { errors, count }
GET /control/console-errors?sinceId=N&limit=M # cursor form
GET /sdk/network-requests
```

`console-errors` returns the captured browser-console error buffer.
Each entry has a monotonic `id`. The cursor form (when `sinceId` is
present) returns:

```json
{
  "errors": [...],          // entries with id > sinceId, up to limit
  "nextSinceId": 42,         // pass back as sinceId on the next call
  "droppedCount": 3,         // running total of evictions; growth between
                             // calls means you fell behind the buffer
  "bufferedCount": 250,      // current buffer size
  "count": 9                 // legacy, still present
}
```

Default limit 50, max 500; buffer capacity 250 by default
(`QONTINUI_UI_BRIDGE_ERROR_BUFFER_CAPACITY` env var to tune).
Without `sinceId`, the response keeps the legacy `{errors, count}`
shape verbatim.

`sdk/network-requests` is populated when an SDK is connected;
otherwise empty.

## JavaScript evaluation (runner only)

```bash
curl -X POST $BASE/control/page/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression":"document.title"}'
```

Returns the value of the expression. Async expressions are awaited.

The default response shape is conditional: scalars come back as
`{ result: { value } }`, objects as `{ result }`. Pass `unwrap: true`
for a uniform shape that doesn't depend on the expression's return
type — preferred for new code.

```bash
curl -X POST $BASE/control/page/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression":"document.title","unwrap":true}'
```

`unwrap=true` response: `{ value: <result>, type: "scalar" | "object" | "undefined" | "function" | "null" }`. The legacy
conditional shape is still emitted when `unwrap` is omitted or false.

**Security filter:** the evaluator rejects expressions matching
`\bfetch\s*\(`. Use `window["fet"+"ch"]("/url")` for fetch tests
(see "Network stubs" above).

## Components (preferred over button clicks)

```http
GET /control/components
GET /control/component/:id
POST /control/component/:id/action/:actionName
```

⭐ **Prefer component actions over button clicks.** Before driving an
interactive flow by fighting `button-*` element IDs in the snapshot,
list `/control/components`. Features like `zone-profile-picker`,
`zone-layout-picker`, and `terminal-page` register high-level actions
(`load-profile`, `select-layout`, `create-terminal`) that invoke the
React handler directly — no dropdown state dance, no ordering bugs,
and each action exposes a `paramSchema` so you know exactly what to
POST.

```bash
# Invoke
curl -X POST $BASE/control/component/zone-profile-picker/action/load-profile \
  -H "Content-Type: application/json" \
  -d '{"params":{"name":"mobile"}}'
```

Each component detail also includes `actionInvocationPath` templates
and per-action `path` fields — the response itself tells you how to
call it.

## Design audit

```http
POST /ai/design-audit
```

Runs the accessibility / visual audit pass. Requires a style guide to
be loaded first (`design_load_style_guide`). Returns HTTP 400 with a
flat `{success:false, error}` envelope when no guide is loaded.

## Error envelopes (response contract)

Every IPC-backed UI Bridge handler funnels through a single unwrapper
(`wrap_ipc_result`). The wire shape:

- **Success:** HTTP 200 with `{ success: true, data: <result> }`.
- **Soft failure** (operation rejected the request — bad input, missing
  preconditions, element not found, etc.): HTTP 400 with a flat
  `{ success: false, error: "..." }` body. **No nested `data`, no inner
  `success` field.** This is the F2 contract — agents check the outer
  status code and the outer `error` string.
- **Transport failure** (frontend not mounted yet, IPC timeout): HTTP
  503 / 500 with `{ success: false, error_detail: { code, message,
recovery } }` so the caller can branch on whether to retry.

Three high-friction errors carry `hint` objects to short-circuit
trial-and-error:

```json
// element-not-found 404
{
  "success": false,
  "error": "Element not found: foo-btn",
  "hint": { "closestMatches": ["foo-button-0", "fooBtn", ...] }
}

// action-not-allowed
{
  "success": false,
  "error": "Action 'check' not allowed on this element",
  "hint": { "allowedActions": ["click", "focus", "blur", "hover"] }
}

// page/evaluate rejected by the security guard
{
  "success": false,
  "error": "Expression rejected: contains prohibited pattern",
  "hint": "Use indirect access for fetch: window['fet'+'ch']('/url')"
}
```

`closestMatches` is Levenshtein-ranked, capped at 5, edit-distance ≤ 50%
of element-id length.

## Health (Tauri runner)

```http
GET /health
```

Returns runner liveness signals. Three booleans worth knowing:

- `responsive` — IPC round-trip succeeds (the React side is alive
  enough to acknowledge a ping).
- `ready` — the runner has completed its bootstrap routine.
- `frontendReady` — flips `true` the first time any UI Bridge IPC
  response comes back from the React frontend, meaning the app has
  rendered past `App.tsx`'s loading-screen branch and registered its
  ui-bridge-response listener. **One-way transition** — once true, it
  stays true for the rest of the process lifetime.

Use `frontendReady` to distinguish "Tauri shell is up but the React
app is still loading" from "the app is fully usable." External
pollers spawning a temp runner should wait until `frontendReady: true`
before issuing UI Bridge calls — otherwise the first few requests may
hit the 503 transport-failure path until the React listener attaches.

## Health stream (SSE — supervisor only)

```http
GET http://localhost:9875/health/stream
```

Server-Sent Events stream of supervisor-aggregated health snapshots.
**This endpoint lives on the supervisor (port 9875), not the runner.**
The Tauri runner exposes only the one-shot `GET /health` documented
above.

- **Event name:** `health`. Each non-empty frame is wire-encoded as
  `event: health\ndata: <json>\n\n`.
- **Cadence:** ticks every 3 seconds. The supervisor diffs the JSON
  against the previous tick — if nothing changed, it emits an SSE
  comment (`: keepalive`) instead of a `health` event, so consumers
  only see frames when state actually moved.
- **Keep-alive:** the underlying `Sse` writer also injects a comment
  every 15 seconds via `KeepAlive::interval`. The server does not set
  an explicit `retry:` directive — clients use the EventSource default
  (~3s).
- **Reconnection:** standard `EventSource` auto-reconnect. Because the
  payload always includes the full snapshot (not a delta), a missed
  tick is harmless: the next emitted event is fully self-describing.

Top-level payload fields (sample taken from a live supervisor,
truncated for readability):

```json
{
  "status": "healthy",
  "runner": { "running": true, "pid": 23036, "api_responding": true, "started_at": null },
  "ports": { "api_port": { "port": 9876, "in_use": true } },
  "watchdog": { "enabled": false, "restart_attempts": 0, ... },
  "build": {
    "in_progress": false,
    "available_slots": 3,
    "error_detected": false,
    "last_build_at": "2026-04-26T19:02:29.267175100+00:00",
    "frontend_stale_any": false,
    "lkg": { "built_at": "2026-04-26T19:07:30.711213500+00:00", "source_slot": 0, "exe_size": 243111424 }
  },
  "expo": { "running": false, "pid": null, "port": 8081, "configured": false },
  "supervisor": { "version": "0.1.0", "project_dir": "..." },
  "runners": [
    { "id": "primary", "name": "Primary", "port": 9876, "is_primary": true,
      "running": true, "pid": 23036, "api_responding": true,
      "derived_status": { "kind": "healthy" }, ... },
    { "id": "test-19dcb32b9d2-e", "name": "test-9877", "port": 9877,
      "is_primary": false, "running": true, "api_responding": true,
      "derived_status": { "kind": "healthy" }, ... }
  ],
  "sdkFeatures": ["softNavigate", "snapshotActiveTab", "waitForElement", ...],
  "sdkFeaturesDocUrl": "https://github.com/qontinui/ui-bridge/blob/main/docs-site/docs/api/runner-features.md",
  "buildId": "2026-04-26T18:21:02+00:00"
}
```

The `runners[]` shape mirrors `RunnerInstanceHealth` from
`GET /health` — same fields, same `derived_status` enum
(`healthy` / `degraded` / `errored` / `offline` / `starting`).

**Use cases.**

- **Build-id watcher.** Pair the stream's `buildId` field with the
  `<meta name="build-id">` tag the supervisor injects into every HTML
  serve. When the streamed value diverges from the meta tag, the
  supervisor binary has been rebuilt and the open dashboard tab is
  serving a stale bundle — prompt the user to refresh. The reference
  consumer is the `useBuildIdWatcher` hook in
  `@qontinui/ui-bridge/react` (`packages/ui-bridge/src/react/useBuildIdWatcher.ts`)
  which the dashboard's `BootIdWatcher` mounts at the root.
- **Live fleet status.** Subscribe to `runners[]` instead of polling
  `GET /runners` every few seconds. The supervisor's background
  health-cache refresher feeds this array, so it carries the same
  `api_responding` / `derived_status` data without the per-tick HTTP
  cost.

Quick smoke-test:

```bash
curl -s -N -m 3 http://localhost:9875/health/stream | head -5
```

## Multi-instance registry

Endpoints for the runner's view of every other runner that's been
spawned, registered, or saved as a slot.

```http
GET    /runners                       # supervisor-compatible listing
GET    /instances                     # in-memory registered map
POST   /instances/register            # external runner reports in
POST   /instances/{id}/heartbeat      # external runner pulses
DELETE /instances/{id}                # deregister immediately
POST   /instances/purge-stale         # heartbeat-based sweep
```

`GET /runners` merges the primary's self-view, the Postgres
`runner_instances` table, and the in-memory `registered` map into one
list with `running`/`api_responding` flags. The runner UI's
Orchestration Loop and Settings → Runner Instances panels go through
the Tauri command `get_runner_instances` instead, which adds a live
`/status` probe per row and tags each entry with
`source: "configured" | "discovered"`. The HTTP endpoint reflects DB
heartbeat status, the Tauri command reflects current liveness — prefer
the Tauri command when accuracy matters more than cross-process reach.

**Polling cadence is a consumer concern.** Both the HTTP endpoint and
the Tauri command answer on demand — they don't push. The OL panel
re-polls `get_runner_instances` every 5s, the run-status pane every 3s.
External pollers should pick a cadence matched to how stale they can
tolerate the data; under the hood each call costs one DB read plus a
parallel sweep of `/status` probes (1s timeout each, but run via
`join_all` so the wall time is bounded by the slowest single probe).

`DELETE /instances/{id}` reclaims a slot immediately rather than
waiting on `purge-stale` to mark it unhealthy. Returns 200 with
`{removed_in_memory, removed_db}` flags, or 404 if the id wasn't
known on either side. Use this to clean up after a crashed external
runner that didn't get a chance to deregister itself.
