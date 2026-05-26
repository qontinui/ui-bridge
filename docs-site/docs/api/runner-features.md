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

## Breaking changes since previous release

Surfaced up top so existing scripts can be audited at a glance:

- **`GET /control/console-errors` filters by level by default.** Default
  response now includes only `error`-level and `unhandledrejection` entries.
  Pass `?level=all` (or `?level=*`) to restore the previous unfiltered shape.
  See "Console & network monitoring" below.
- **`GET /control/components` envelope (Direction B).** The direct path now
  returns `{success:true, data:{components:[...]}, components:[...]}` — the
  top-level `components` is **deprecated** and will be removed next release.
  The `/sdk/` relay now matches the direct path's `data:{components:[...]}`
  shape. Migrate readers to `data.components`. See "Components" below.
- **`wait-for-element` predicate/state-form timeouts default to HTTP 200
  with `found:false`.** Pass `?strictTimeout=true` to flip to HTTP 408 +
  flat-error today; `strictTimeout=true` will become the default in a future
  release. NL-form (`{query}` / `{elementId}`) timeouts already return HTTP
  408. See "Wait-for-element" below.
- **`wait-for-element` duration key is now `durationMs` everywhere.** The
  NL/id happy path still emits `elapsed_ms` for one release of backward
  compatibility (removed after 2026-06); new code should read `durationMs`.

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

**Snapshot, not the DOM, is the authoritative source of element existence.**
Elements are tracked in an in-memory SDK registry populated by `useUIElement`
(and similar hooks). They do NOT necessarily appear as `data-uib-id`
attributes on DOM nodes — running `document.querySelectorAll("[data-uib-id]")`
from `/control/page/evaluate` may return zero matches even when the snapshot
shows hundreds of registered elements. Always use `/control/snapshot` (or the
element-specific endpoints) to verify element existence and state; reach for
DOM queries only as a last-resort fallback for elements you know are
DOM-attribute-marked.

**Dotted ids need attribute-quoted CSS selectors.** Namespaced ids like
`productivity.file-activity-yield` are valid as `data-ui-bridge-id`
attribute values, but a bare `[data-ui-bridge-id=productivity.file-activity-yield]`
selector is a CSS parse error — the dot is read as a class delimiter.
Always quote the value: `[data-ui-bridge-id="productivity.file-activity-yield"]`.
When embedding inside JSON-encoded `/control/page/evaluate` expressions,
the quotes need an extra layer of JSON escaping
(`\\\"productivity.file-activity-yield\\\"`).

**Element ids are derived, not named after the React component.** Buttons
without an explicit `useUIElement` name get a slugified id from their
accessible label — `aria-label`, then `<label for>`, then the title attribute, then visible text
(`getAccessibleLabel` in `packages/ui-bridge/src/react/useAutoRegister.ts:280`,
slugged to 30 chars via `slugify` at `:367`). A `<button title="Promote this
session into an isolated git worktree">` lands in the snapshot as
`button-promote-this-session-into-an-i-1`, NOT `button-promote-to-worktree-*`.
When grepping snapshot output, search by partial visible text or icon rather
than a hardcoded prefix; for stable test ids, set an explicit `useUIElement`
name on the component.

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
# NOTE: `type` takes `{text: "string"}`; `setValue` / `select` take `{value: "string"}`. Not interchangeable.
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

> **Field name: `type` takes `text:`, not `value:`.** Sending
> `{"action":"type","params":{"value":"foo"}}` returns a recoverable HTTP
> 400 with `type: 'value' is unknown; did you mean 'text'?`. Skip the
> round-trip — use `{"action":"type","params":{"text":"foo"}}` directly.
> `value` is for `select` / `setValue`; `type` is for `type` / `clear`'s
> input fields.

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

### Mobile transport paths — required reading before testing

> **Precondition.** Installing and launching the qontinui-mobile app on a
> phone is necessary but **not sufficient** for the runner to see the
> device. A transport must also be active before `localhost:8087`
> resolves to the device's UI Bridge or `GET /control/devices` returns a
> non-empty list. Set up one of:
>
> - **USB:** `adb forward tcp:8087 tcp:8087` from the host. Verify with
>   `adb forward --list | grep tcp:8087`.
> - **LAN/cloud relay:** pair via the in-app Connection Wizard. Verify
>   with `GET /control/devices` returning at least one entry.
> - **Local dev server:** `npx expo start` with the mobile app running
>   in dev mode. Verify the same way.
>
> If `/control/devices` returns `count: 0`, no transport is active —
> driving the mobile app via UI Bridge will fail with empty snapshots
> regardless of how the app appears on the phone screen.

`MOBILE_BASE=http://localhost:8087/ui-bridge` only works *after* a
transport has been established. The mobile app does NOT bind to
`localhost:8087` on the host machine on its own — it binds on the
device, and one of three transports has to bridge that to localhost
before any UI Bridge endpoint becomes reachable. Skipping this step is
the #1 cause of "the mobile app is running but I can't reach the
bridge".

| Transport | Setup | When to use |
|-----------|-------|-------------|
| **USB** | `adb forward tcp:8087 tcp:8087` after a USB debug-enabled device is connected. Verify with `adb devices` (must show your device) and `adb forward --list` (must show the forward). | Device is wired in, fastest, most reliable. |
| **LAN, mDNS** | Mobile app announces over mDNS; the runner's discovery service picks it up. From the host, proxy through the runner: `curl http://localhost:9876/ui-bridge/devices/<deviceId>/control/snapshot`. | Phone on the same Wi-Fi as the dev box; can't or don't want to plug in USB. |
| **LAN, direct IP** | The mobile UI Bridge server binds `0.0.0.0:8087`, so any same-LAN host can reach it via the phone's LAN IP directly: `curl http://<phone-lan-ip>:8087/ui-bridge/control/snapshot`. Find the IP via `Get-NetNeighbor` (Windows) / `arp -a`, or fall back to a fast parallel TCP scan (`for ip in 192.168.x.{1..254}: probe :8087`) which finds the phone in seconds. No runner involvement. | Same-LAN phone when adb is dark and mDNS isn't registering — bypasses both `adb` and the runner relay entirely. |
| **Cloud relay** | Mobile app paired via the in-app Connection Wizard. Visible in `GET http://localhost:9876/ui-bridge/devices` with `transport: "cloud"`. Proxy through the runner same as LAN. | Phone is remote (different network); use sparingly — round-trip latency dominates. |

**One-shot detection** — which transport is active?

```bash
echo "USB:"
adb forward --list | grep -q "tcp:8087" && echo "  forwarded — try localhost:8087" || echo "  not forwarded"
echo "Runner-relayed (LAN or cloud):"
curl -s http://localhost:9876/ui-bridge/devices | python -c "import sys,json; d=json.load(sys.stdin)['data']; print(f\"  {d['count']} device(s)\"); [print(f\"  - {x.get('id')} via {x.get('transport')}\") for x in d.get('devices',[])]"
```

If both show empty: the device isn't reachable from this machine. The
mobile app may still be running and connected to qontinui-web's
backend (via HTTPS, not the bridge) — that login channel doesn't
expose UI Bridge state. Either set up one of the three transports
above, or limit testing to server-side artifact verification (AAB
manifest grep, `eas-cli channel:view`, backend logs).

### Mobile→Runner transports

The reverse direction — the mobile app's API client calling the
runner's HTTP API — uses one of three transports. Selection logic
lives in `qontinui-mobile/src/api/core/HttpTransport.ts` (constructor
L88-100 chooses cloud-relay vs direct; `fetch<T>` L188-195 handles the
adb-reverse fallback).

1. **Cloud relay** (default when a `proxyBaseUrl` is configured):
   requests go to `{apiUrl}/api/v1/device-bridge/runner-proxy/*`,
   where `apiUrl` is the mobile's configured backend URL. The backend
   forwards through the device WebSocket to the runner co-located with
   the backend. Note the literal path segment is
   `device-bridge/runner-proxy` — other plausible-looking variants
   under `/api/v1/devices/{id}/*` return 404.

2. **Direct LAN**: the mobile hits the runner's HTTP API directly
   (e.g. `http://192.168.x.x:9876/*`) when on the same LAN and the
   runner accepts unauthenticated LAN requests. Selected by passing a
   LAN host/port to the `HttpTransport` constructor with no
   `proxyBaseUrl`.

3. **adb-reverse fallback** (USB-tethered dev only): after
   `adb reverse tcp:9876 tcp:9876` on the host, the runner is
   reachable from the device at `http://localhost:9876`. The mobile
   `HttpTransport` flips to this automatically on Android when a
   LAN-host fetch fails with a network-layer error (see
   `enableAndroidLoopbackFallback` / `canAttemptAndroidLoopback`), and
   it sticks for the lifetime of the transport instance.

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
POST /control/page/set-tab  { "tab":   "specs" }
```

`GET /control/tabs` returns `{ activeTab, tabs: [{id, label}] }`.
`POST /control/tab/activate` fires the same `ui-bridge-set-tab` event a
user click dispatches — lazy-mounts and URL-state-sync fire as usual.

`POST /control/page/set-tab` is a sibling that dispatches the same
event via `page/evaluate` and reads back `[data-page-id]` so you get a
verification signal in the response. The `tab` value is the **bare
slug** (`llm-analytics`, `prompt-home`, `specs`, …) matching
`snapshot.activeTab` — NOT a `page-`-prefixed name. Sending
`page-llm-analytics` returns HTTP 400 with the list of valid slugs in
the error body.

Unknown `tabId` / `tab` returns HTTP 400 with `{ error: "unknown_tab",
knownTabs: [...] }` so you don't have to guess.

The snapshot response also surfaces `activeTab` alongside `route` so
you can confirm a tab activation without a separate `/control/tabs`
call.

## Terminal sessions (runner only)

```http
GET /control/terminal-sessions
GET /control/terminal-sessions/{id}
```

Inspect the runner's PTY-backed terminal tabs (plain pwsh + AI
sessions) without screen-scraping. The list endpoint returns
`{ sessions: [{id, title, task_run_id, claude_session_id, working_dir,
state, is_alive, exit_code, type, created_at}] }`. `task_run_id` is
`null` for plain tabs and for AI tabs that haven't yet captured a
Claude session id (the JSONL-capture window — typically `<2s` after
spawn). Per-id GET returns 404 with `{error: "unknown_terminal_session",
knownIds: [...]}` so callers polling a freshly-spawned tab can recover.

Pair with the `terminal-launch-menu` component's `create-best-account`
/ `create-ai-session` / `create-with-command` / `create-plain` actions
— each now returns `{success: true, tab_ids: string[], task_run_ids:
(string | null)[]}` in the action response, so automation can capture
the new `tab_ids[i]` and poll `/control/terminal-sessions/{tab_ids[i]}`
for `state === "idle"`/`"working"` and `task_run_id !== null`.

### Reading rendered terminal output

```http
GET /ui-bridge/sdk/terminal/sessions/{tab_id}/buffer?lines=N
GET /ui-bridge/sdk/terminal/sessions/{tab_id}/grid
GET /ui-bridge/sdk/terminal/sessions/{tab_id}/text
```

The same `tab_id` returned by `terminal-launch-menu` actions also keys
the **VT-parser cell grid** maintained per-session (see the
[grid-snapshot architecture note](#)). `/buffer?lines=N` returns
`{session_id, lines: string[], total_lines, truncated}` — the last N
rendered rows post-ANSI-parsing, capped at `MAX_RETURNED_LINES`.
`/grid` returns the full `GridSnapshot` (cells + cursor + title). Use
these to assert on what's *visibly rendered* in a terminal pane
without screen-scraping or replaying the raw PTY byte stream
(replay-as-bytes is fundamentally lossy for TUI streams — the parser
already collapsed cursor-positioning + DEC 2026 sync-output into the
final frame). Sibling `GET /terminals/{tab_id}/buffer` / `/output`
serves the same data on the runner's non-`/ui-bridge/` route family.

### Auto-yield-on-idle (file-lock policy)

The runner runs an optional background policy that releases held
file locks when their holder has been stdout-idle and another
session has been waiting (lock-yield-protocol-plan §Open Q4).
Configured under `settings.lock_yield_policy`:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Toggle the background task. |
| `idle_threshold_secs` | `60` | Minimum holder idle (no stdout) before yieldable. |
| `min_wait_secs` | `30` | Minimum waiter wait before auto-yield fires. |

Trigger predicate (AND-gated):
`holder_idle_secs >= idle_threshold_secs && waiter_waited_secs >= min_wait_secs`.

When the policy fires, the runner emits two Tauri/SSE events for the
released lock — a new `file-lock-auto-yielded` payload AND a
matching `file-lock-released` event (so existing
`useFileLockTracking` listeners clear waiter banners without any
frontend changes):

```json
{
  "type": "file-lock-auto-yielded",
  "file_path": "src/foo.rs",
  "holder_task_run_id": "task-…",
  "holder_name": "Session alpha",
  "holder_idle_secs": 73,
  "oldest_waiter_task_run_id": "task-…",
  "oldest_waiter_waited_secs": 42,
  "auto_yielded_at": 1715539200000
}
```

The holder-side `HoldingLockBanner` surfaces an advisory countdown
`(auto-yield in Ns)` when the policy is enabled and a waiter is
present, so the holder isn't surprised by the involuntary release.

## Network stubs (fetch short-circuit)

Prefer this over monkey-patching `window.fetch` via `page/evaluate`.
Stubs live in a module-level SDK singleton — they survive React
re-renders and soft navigations; they clear on hard reload.

> **POST body shape** (camelCase over the wire): `{urlPattern, method, response, times: 1|"always"}`. `urlPattern` is required (substring match); `method` defaults to any; `response` carries `{status?, body? | bodyJson?, headers?}`; `times` is either a positive integer (consumed per match) or the string `"always"`.

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

Response on match: `{ element: {id, label, type, ...}, durationMs }`.
Response on timeout: `{ reason: "timeout", durationMs, closestMatch? }`
where `closestMatch` is populated when a predicate-matching element
exists but fails the `requirement` filter. (Pre-2026-05 builds used
`elapsedMs` — see "Duration key — `durationMs` is canonical" below.)

The legacy state-shape above (with `elementId` + `state`) and the
predicate-shape are routed by body shape on the same path — both keep
working.

### Timeout response shape — per body shape

The wire response to a timeout differs across the three body shapes the
endpoint accepts. This is a transitional state — pass `?strictTimeout=true`
to opt every shape into the flat HTTP 408 contract today; that mode will
become the default in a future release.

| Body shape | Timeout response (current default) |
|---|---|
| `{query: "..."}` or `{elementId: "..."}` (NL/id form) | HTTP 408 + `{success: false, error: "wait-for-element: timeout after ..."}`. `data.durationMs` is emitted on the response; `elapsed_ms` is mirrored alongside it for one release of backward compatibility. |
| `{predicate: {...}}` (predicate form) | HTTP 200 + `{success: true, data: {found: false, durationMs, lastObservedState}}`. Pass `?strictTimeout=true` to get HTTP 408 + `{success: false, error: "wait_for_element_timeout", data: {found: false, durationMs, lastObservedState}}` instead. |
| `{state: "...", elementId\|selector: "..."}` (state form) | Same default as predicate — HTTP 200 + `{success: true, data: {found: false, durationMs, lastObservedState}}`. `?strictTimeout=true` is supported on this shape too. |

**Migration window.** New code on predicate / state shapes should pass
`?strictTimeout=true` and treat HTTP 408 as the timeout signal. Existing
callers that branch on `data.found === false` continue to work until the
flip. Plan to flip default-strict in a release once known callers have
migrated.

### Duration key — `durationMs` is canonical

All three body shapes now emit `durationMs` (camelCase) on both the
match-success and timeout responses. The NL/id happy path additionally
emits `elapsed_ms` (snake_case) for one release of backward compatibility;
new code should read `durationMs`. The `elapsed_ms` mirror will be removed
after 2026-06.

```json
// Match (NL/id form) — durationMs canonical; elapsed_ms still mirrored
{"success":true,"data":{"found":true,"durationMs":123,"elapsed_ms":123,"finalState":{...}}}

// Timeout (predicate / state form, default)
{"success":true,"data":{"found":false,"durationMs":5000,"lastObservedState":{...}}}

// Timeout with ?strictTimeout=true (predicate / state form)
// HTTP 408 + flat error envelope, but data is still carried for diagnostics.
{"success":false,"error":"wait_for_element_timeout","data":{"found":false,"durationMs":5000,"lastObservedState":{...}}}
```

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

## Wait-for-idle — the canonical `sleep 2` replacement

The blocking primitive to use after any UI mutation that triggers async
follow-on work (tab switch, route navigation, network-triggering click).
Replaces the `sleep 2` anti-pattern: instead of hoping the UI is settled,
ask the bridge.

```http
POST /control/wait-for-idle
POST /ai/wait-for-idle              # alias
```

Request body:

```json
{
  "timeout": 5000,        // ms — max wall time before resolving (default 5000)
  "minStableMs": 250,     // ms — signals must stay idle this long to count as settled (default 250)
  "exclude": []           // optional string[] — signal names to ignore
}
```

Response: `{success: true, data: <CompositeIdleStatus>}` with `idle: true|false`
and a per-signal breakdown (`dom`, `network`, `loadingIndicators`,
`formMutation`, `animation`). Resolves the moment every non-excluded
signal has been idle for `minStableMs`, or when the `timeout` elapses
(in which case `data.idle` will be `false` and per-signal flags show
which signals never settled).

### Canonical recipe — wait for the UI to settle after a tab switch

```http
POST /control/tab/activate    {"tabId":"productivity"}
POST /control/wait-for-idle   {"timeout":5000,"minStableMs":250}
GET  /control/snapshot
```

This **replaces** the previous `activate → sleep 2 → snapshot` pattern.
The slash-command sweep in this release migrated
`.claude/commands/ufix.md` accordingly; other slash commands and scripts
should follow.

### Per-signal variant

```http
POST /control/wait-for-idle/{signal}
```

Where `{signal}` is one of `dom`, `network`, `loading-indicator`,
`form`, `animation`. Useful when you only care about a specific signal
(e.g. network for a known-fetch click, dom for a known-render
mutation) and don't want to block on the others. Body shape and
response are the same as the composite endpoint, scoped to that signal.

### Instantaneous check

```http
GET /control/idle-status
GET /ai/idle-status              # alias — byte-identical to /control/idle-status
```

Non-blocking — returns the current composite idle state without
waiting. Use this when you want a snapshot of the signal pipeline (e.g.
to log why a previous `wait-for-idle` timed out) rather than to block.
Same `CompositeIdleStatus` payload as the blocking variant.

**Aliasing rule.** `/control/idle-status` is **canonical** (it matches the
`/control/*` family convention). `/ai/idle-status` is a byte-identical
alias kept for semantic-search / AI consumers that already query under
the `/ai/*` namespace — both paths point at the same handler on both
the runner (`add_dual!(router, get, "idle-status", …)` in
`qontinui-runner/src-tauri/src/mcp/ui_bridge/errors.rs`) and the web SDK
(`UI_BRIDGE_ROUTES` in `packages/ui-bridge/src/server/types.ts`). The
two responses are identical modulo per-request `timestamp` (the
`CompositeIdleStatus` body is recomputed each call from live state, so
back-to-back hits can differ on `timestamp` and ms-precision signal
counters — that's expected variance, not aliasing drift). Use
`/control/idle-status` in new code.

## Page health diagnostics

```http
POST /control/page-health
```

Runs a structured health analyzer over the current snapshot and returns a
machine-readable report covering spatial coverage, layout regions, element
diversity, text + CSS class signal scanning, interactive readiness, and
visual anomalies. The same `POST /control/page-health` route is exposed
by both the runner (Rust, `qontinui-runner/src-tauri/src/mcp/ui_bridge/
screenshots.rs::ui_bridge_page_health_handler`) and the web SDK
(TypeScript, `@qontinui/ui-bridge` `packages/ui-bridge/src/server/
page-health.ts`). The output shape is byte-equivalent across both
transports so the `page-health` Claude skill works identically against
either base URL.

Body is optional and reserved for future per-check toggles
(`{ options: { … } }`); current builds accept an empty body or none at
all.

Response shape:

```json
{
  "success": true,
  "data": {
    "summary": "OK" | "WARNING" | "CRITICAL",   // worst severity across findings
    "findings": [
      {
        "check": "spatial_coverage",
        "severity": "OK" | "WARNING" | "CRITICAL",
        "detail": "Elements cover 47% of viewport. Left=58%, Right=36%",
        "data": { "coverage_pct": 47, "left_half_pct": 58, "right_half_pct": 36 }
      },
      { "check": "layout_regions",       ... },
      { "check": "element_diversity",    ... },
      { "check": "text_signals",         ... },
      { "check": "interactive_readiness", ... },
      { "check": "visual_anomalies",     ... }
    ],
    "heatmap": [ "....######....", ... ],         // 20 rows of 20 chars each
    "element_count": 184,
    "visible_count": 117
  }
}
```

**Heuristics.** Both implementations agree on these thresholds:

| Check | Severity rule |
|---|---|
| `spatial_coverage` | CRITICAL when coverage < 15% OR right < 5% with left > 20%; WARNING when coverage < 30%; otherwise OK |
| `layout_regions`   | CRITICAL when content region is empty; WARNING when < 3 elements there |
| `element_diversity`| WARNING when > 5 elements present and *all* types are navigation-only (button / heading / badge / status-message) |
| `text_signals`     | CRITICAL on any error-phrase match; WARNING on loading / empty-state / CSS-class signal matches |
| `interactive_readiness` | WARNING when > 50% of `category: "interactive"` elements are disabled |
| `visual_anomalies` | WARNING on any zero-size or off-viewport visible element |

Smoke test:

```bash
curl -sX POST http://localhost:9876/ui-bridge/control/page-health | jq '.data.summary, (.data.findings | length)'
# OK
# 6

# Web SDK route (after pairing a browser tab)
curl -sX POST http://localhost:3001/api/ui-bridge/control/page-health | jq '.data.summary, (.data.findings | length)'
# OK
# 6
```

The page-health Claude skill (`.claude/skills/page-health/SKILL.md`)
reads the same payload — no transport-aware branching is required.

## Console & network monitoring

```http
GET /control/console-errors                          # default: error + unhandledrejection only
GET /control/console-errors?level=all                # restore legacy unfiltered shape
GET /control/console-errors?level=error,warn         # comma-separated allow-list
GET /control/console-errors?sinceId=N&limit=M        # cursor form (level filter applies)
GET /sdk/network-requests
```

`console-errors` returns the captured browser-console error buffer.
Each entry has a monotonic `id`.

> **As of this release:** the default response includes only `error`-level
> entries and `unhandledrejection`s (previously: every captured entry
> regardless of level). To restore the legacy unfiltered shape, pass
> `?level=all` or `?level=*`.
>
> The `level` query param accepts a single value or a comma-separated
> allow-list. Recognised values: `error`, `warn`, `unhandledrejection`,
> `info`, `log`, `debug`, plus the wildcards `all` and `*`. Unknown
> values return HTTP 400.

The cursor form (when `sinceId` is present) returns:

```json
{
  "errors": [...],          // entries with id > sinceId, up to limit (level-filtered)
  "nextSinceId": 42,         // pass back as sinceId on the next call
  "droppedCount": 3,         // running total of evictions; growth between
                             // calls means you fell behind the buffer
  "bufferedCount": 250,      // current buffer size (PRE-filter — total)
  "count": 9                 // legacy, still present
}
```

Default limit 50, max 500; buffer capacity 250 by default
(`QONTINUI_UI_BRIDGE_ERROR_BUFFER_CAPACITY` env var to tune).
Without `sinceId`, the response keeps the legacy `{errors, count}`
shape verbatim — only the set of entries inside `errors` is affected
by the level filter.

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

### Response-shape gotcha — wrap returns in `JSON.stringify`

The default response shape varies by what the IIFE returns:

- **Primitive** (`document.body.children.length`):
  `{ "data": { "result": { "value": 2 } } }`
- **Object** (`({x:1, y:2})`):
  `{ "data": { "result": { "x": 1, "y": 2 } } }` — the object's keys
  sit directly on `result`; there is no wrapping `value` field.
- **Null / early return**: `{ "data": { "result": null } }` — `value`
  is absent entirely.

Callers that hard-code `data.result.value` get burned the moment an
expression starts returning an object instead of a scalar. The cheap
fix is a convention: **wrap the IIFE return in `JSON.stringify(...)`**
so the response is uniformly `{ result: { value: "<json string>" } }`,
then `JSON.parse(value)` on the client side.

```js
// Avoid: shape varies
"({ phase: r.dataset.pipelinePhase })"
// Prefer: shape uniform — { result: { value: "<json string>" } }
"JSON.stringify({ phase: r.dataset.pipelinePhase })"
```

This is a recommendation, not enforced — old callers continue to work,
and `unwrap: true` (above) is the other way out. Pick one and stick to
it per call site.

### Tauri command errors — JSON.stringify, not String

When you invoke a Tauri command via `evaluate` and wrap the call in a
try/catch, **always serialize the error with `JSON.stringify(e)` and
inspect `e.kind` / `e.message` directly**. The default `String(e)`
returns `"[object Object]"` because Tauri error envelopes (`{kind,
message}` objects) don't have a useful `toString`.

Idiomatic shape that recovers structured errors:

```js
"(async () => {                                                 \
  try {                                                          \
    const out = await window.__TAURI__.core.invoke('cmd', args); \
    return { ok: true, result: out };                            \
  } catch (e) {                                                  \
    return {                                                     \
      ok: false,                                                 \
      error: {                                                   \
        kind: e?.kind,                                           \
        message: e?.message,                                     \
        raw: JSON.stringify(e)                                   \
      }                                                          \
    };                                                           \
  }                                                              \
})()"
```

Tauri error envelopes are stable: every command's `Result<_, E>` Err
arm is serialized with `kind` (string discriminant) and `message`
(human-readable). `raw` is a fallback for commands that emit a
non-standard shape. `String(e)` swallowing this loses both fields.

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

### Listing — envelope shape (Direction B)

The list endpoint has two URLs (direct + SDK relay) and they now share
a `data.components` slot. Read from `data.components` in new code.

| URL | Shape (this release) |
|---|---|
| `GET /control/components` (direct) | `{success: true, data: {components: [...]}, components: [...]}` — top-level `components` is **deprecated** and will be removed next release. Migrate to `data.components`. |
| `GET /sdk/control/components` (SDK relay) | `{success: true, data: {components: [...]}}` — now matches the direct path's `data` slot. Previous shape was `{data: {components: [...]}}` with no `success` field. |

**Deprecation window: one release.** The top-level `components` mirror on
the direct path is a compatibility shim for existing readers that grew up
on the legacy shape; the next release removes it, leaving a single
canonical reader (`data.components`).

**Rationale.** Object-shaped `data` matches every other rich endpoint in
this doc: `ai/find` returns `data: {found, elementId, element, ...}`,
`console-errors` returns `data: {errors, count, droppedCount, ...}`,
`wait-for-element` returns `data: {found, durationMs, finalState}`, and so
on. Returning a bare array under `data` (as the legacy SDK-relay shape
did) is the odd one out — promoting `components` into an object opens the
slot for future top-level fields (`registration`, `byRoute`, etc.) without
another shape break.

```bash
# Canonical read — works on both URLs
curl -s $BASE/control/components | jq '.data.components | length'
curl -s $BASE/sdk/control/components | jq '.data.components | length'
```

### Route scoping — empty list on a route with no components is expected

`GET /control/components` returns the current contents of the in-memory
SDK registry — every component registered via `useUIComponent` that is
**currently mounted**. There is no cross-route catalogue: when the SPA
navigates, React unmounts the departing route's components, which fires
their cleanup effects and calls `registry.unregisterComponent(id)`. The
arriving route's components register on mount. The endpoint always
reflects "what is mounted right now," scoped to the current route.

**Consequence.** A route that doesn't call `useUIComponent` anywhere
(detail pages, landing pages, modals-only views) returns
`data.components: []` — **this is not a bug or a stale cache.** Confirm
your assumption with two cheap probes:

```bash
# 1. What route is the bridge currently on?
curl -s $BASE/control/snapshot | jq '.data.route'

# 2. Has any route ever registered components in this session?
curl -s $BASE/control/snapshot | jq '.data.registration'
# { totalRegistered: N, everHadRegistrations: true|false, byRoute: {...} }
```

If `everHadRegistrations: false`, no `useUIComponent` call has run in
this session — either the host page has no component coverage, or the
SDK hasn't fully mounted yet. If `everHadRegistrations: true` but
`data.components` is empty on the current route, the registry is
working as designed: navigate to a route that owns components, or use
`/control/snapshot` + `byRoute` to see which routes have coverage.

To drive a component, navigate to its owning route first
(`POST /control/page/navigate {url}` or `POST /control/tab/activate
{tabId}`), then re-list. Components are not addressable across routes
in this build.

### Per-component detail & invocation

```bash
# Invoke
curl -X POST $BASE/control/component/zone-profile-picker/action/load-profile \
  -H "Content-Type: application/json" \
  -d '{"params":{"name":"mobile"}}'
```

Each component detail also includes `actionInvocationPath` templates
and per-action `path` fields — the response itself tells you how to
call it.

### JSON field convention (camelCase)

All `/ui-bridge/apps/*` and `/ui-bridge/control/*` endpoints use **camelCase**
JSON field names. The Rust DTOs derive `#[serde(rename_all = "camelCase")]`
so a typo like `keep_alive_secs` is silently dropped without `deny_unknown_fields`
— and on the register endpoint, *with* `deny_unknown_fields` (since 2026-05-03)
typos return HTTP 400 with the offending field name in the error envelope.
Example: pass `keepAliveSecs`, not `keep_alive_secs`. `appId`, not `app_id`.
`baseUrl`, not `base_url`. `pageUrl`, not `page_url`.

**The same camelCase convention applies to runner-internal HTTP endpoints**
under `/coordinator/*`, `/terminals/*`, `/sessions/*`, `/plans/*`, and
`/task-runs/*`. Reading the response, expect `liveSessions` not
`live_sessions`, `taskRunId` not `task_run_id`, `assignedSessionId` not
`assigned_session_id`. The Rust struct fields are snake_case; the wire
representation isn't.

### Driving a specific app (transport-agnostic)

```http
POST /ui-bridge/apps/:appId/dispatch
```

When multiple apps are registered with the runner — wrappers, source-
integrated SDK apps, the runner itself — pick the target explicitly.
Body shape: `{action, params}`. Routing is automatic: HTTP-transport
apps go via `reqwest`, WebSocket-transport wrappers go via the
command relay. Returns the dispatched call's result wrapped in
`ApiResponse::success`.

```bash
curl -X POST $BASE/apps/example.com/dispatch \
  -H "Content-Type: application/json" \
  -d '{"action":"ping","params":{}}'
```

Two related per-app affordances on the existing component-action route:

- `POST /sdk/control/component/:id/action/:actionId?app_id=<id>` —
  the optional `?app_id` query param routes the call to that specific
  registered app instead of relying on the active SDK connection.
  Without it, the dispatcher falls back to whichever app
  `state.sdk_connection` currently has installed (the WS-handshake
  path mirrors WS wrappers into that slot automatically, but only one
  at a time).
- `GET /sdk/control/snapshot?app_id=<id>` — same query-param routing
  for snapshot reads against a specific WS-transport app.

### Wait for an app to (dis)appear

```http
POST /ui-bridge/control/wait-for-app
```

Polling primitive that mirrors the `wait-for-element` shape but checks
the registry instead of the DOM. Body: `{appId, transport?, present?,
timeoutMs?, pollMs?}`. Defaults: `present=true`, `timeoutMs=5000`,
`pollMs=100`. Resolves with `{satisfied, elapsedMs, timedOut?, app?}` —
`200` either way; branch on `satisfied`. When `satisfied:true && present:true`,
the response also carries the matched `app` (a `RegisterAppResponse` with the
flattened `DiscoveredApp` fields plus `transport`) so callers can act on
its url/transport without a follow-up `/apps/registered` round-trip.
Disappearance waits (`present:false`) omit `app` since there's no entry
to surface. Useful in scripts that spawn a wrapper and need to know when
it's actually visible to the runner.

### Pinning an entry past the default TTL

`POST /ui-bridge/apps/register` accepts an optional `keep_alive_secs`
field. Default eviction TTL is 30s; entries that explicitly opt in
stay alive longer without sending heartbeats — useful for tests,
scripted injections, and synthetic UI fixtures. Server-side cap is
24 hours; values over the cap return HTTP 400.

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

### Transport-layer error codes

Beyond the soft-failure `error` string, the runner's HTTP transport layer
emits a top-level SCREAMING_SNAKE_CASE `code` for request-level rejections
that never reach a handler — a malformed body, the wrong `Content-Type`, or
an unmatched route. These originate in the axum JSON extractor and the
router fallback (not in an application handler) but are surfaced through the
same canonical envelope, so callers branch on `code` uniformly:

| `code` | Meaning | HTTP |
|---|---|---|
| `UNSUPPORTED_MEDIA_TYPE` | Body sent with no (or a non-`application/json`) `Content-Type`. | `415` |
| `INVALID_JSON` | Body not parseable as JSON (syntax error), or unreadable. | `400` |
| `INVALID_REQUEST` | Body parsed as JSON but failed to deserialize into the target type (missing/unknown field, wrong type). | `422` |
| `PAYLOAD_TOO_LARGE` | Body exceeded the configured size limit. | `413` |
| `NOT_FOUND` | No route matched the request method + path (router fallback). | `404` |

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
