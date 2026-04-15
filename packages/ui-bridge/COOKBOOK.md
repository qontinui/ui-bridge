# UI Bridge SDK Cookbook

Fast-path recipes for the endpoints added in the recent plan, plus the
pre-existing natural-language finder (`ai/find`). This is not a full API
reference — it's a set of copy-pasteable curl calls with enough "why/when"
context to pick the right tool.

All examples assume:

```bash
BASE=http://localhost:9877/ui-bridge
```

`BASE` is the UI Bridge HTTP root. In the runner this is mounted under
`/ui-bridge/` on the runner's MCP port; in the standalone SDK, it defaults to
`/ui-bridge` on whatever port you configured.

---

## 1. Discover what's on a page

Start here. Before you click anything you need to know what the registry
currently sees. `GET /control/elements` returns every registered element;
the query-string filters narrow it down to what you care about.

```bash
# Everything
curl -s "$BASE/control/elements"

# Narrow by visible title / button text
curl -s "$BASE/control/elements?title=Save"

# Narrow by aria-label specifically
curl -s "$BASE/control/elements?aria_label=Close%20dialog"

# Narrow by label/id substring
curl -s "$BASE/control/elements?text=zone-profile"
```

**Why:** These filters run through `matchesElementSelector` in
`src/server/selector-match.ts`, which uses case-insensitive substring matching.
`title` has an accessible-name fallback chain: it tries `title` → `ariaLabel`
→ `label`, so you don't need to know which attribute the developer used.
`aria_label` falls back `ariaLabel` → `label`. `text` matches against `label`
or `id`.

**When to use what:** If you know roughly what word appears on the thing,
`title=` is the most forgiving. If you have a stable `aria-label`, prefer
`aria_label=`. Everything is an AND across filters.

---

## 2. Find an element by natural language

When substring filters aren't enough — fuzzy phrasing, spatial descriptions
("the save button near the header"), or you just want the SDK to pick the
best candidate — use `POST /ai/find`. This endpoint has been around for a
while and is underused.

```bash
curl -s -X POST "$BASE/ai/find" \
  -H 'Content-Type: application/json' \
  -d '{"query": "save button", "confidenceThreshold": 0.6}'
```

Response (happy path):

```json
{
  "success": true,
  "data": {
    "found": true,
    "ambiguous": false,
    "element": { "id": "save-btn", "label": "Save", "type": "button" },
    "elementId": "save-btn",
    "confidence": 0.92,
    "matchReasons": ["label matches 'save'", "type=button"],
    "alternatives": [],
    "decomposed": { "target": "save button" },
    "durationMs": 7
  }
}
```

The response is a discriminated union — the three shapes are `{found:true,
ambiguous:false, ...}`, `{found:true, ambiguous:true, candidates:[...]}`,
and `{found:false, reason, partialMatches, consideredCount}`. Always branch
on `found` and `ambiguous` before using `elementId`.

**When to use `/ai/find` vs attribute filters:**

- `/control/elements?title=...` — you know the literal text. Fast, exact.
- `/ai/find` — the query is fuzzy, descriptive, or phrased like a human
  ("the red X at the top right", "confirm button in the modal"). It also
  auto-scopes to the active modal if one is detected.

---

## 3. Wait for an element to appear

After triggering navigation or opening a modal, poll for the element to
exist / become visible / become clickable before acting on it. Beats
sprinkling `sleep`s.

```bash
curl -s -X POST "$BASE/ai/wait-for-element-condition" \
  -H 'Content-Type: application/json' \
  -d '{
    "selector": { "aria_label": "Confirm deletion" },
    "condition": "visible",
    "timeout_ms": 3000
  }'
```

Conditions:

- `present` — element is registered (exists in the registry).
- `visible` — attached, non-zero size, `offsetParent !== null`.
- `clickable` — visible AND not `disabled` AND not `aria-disabled="true"`.
- `text-matches` — element exists AND its label/aria-label/title/textContent
  contains `text_match` (pass as a sibling field).

Success (HTTP 200):

```json
{
  "success": true,
  "data": {
    "matched": true,
    "element": { "id": "confirm-btn", "label": "Confirm" },
    "waited_ms": 240
  }
}
```

**Timeout:** when polling exhausts `timeout_ms` the **Rust proxy returns HTTP
408** (Request Timeout) with the `waited_ms` in the body. In pure-JS SDK
mode the handler returns 200 with `matched:false`, but agents talking to
the runner should branch on status code.

**Example — wait for a modal after a click:**

```bash
curl -s -X POST "$BASE/control/element/delete-btn/action" \
  -H 'Content-Type: application/json' -d '{"action":"click"}'

curl -s -X POST "$BASE/ai/wait-for-element-condition" \
  -H 'Content-Type: application/json' \
  -d '{"selector":{"title":"Confirm"},"condition":"clickable","timeout_ms":2000}'
```

---

## 4. Invoke a component action

Components are higher-level than elements — they expose named actions with
typed parameters (e.g. `load-profile`, `save-as`). `GET /control/components`
now returns, for each component, an `actionInvocationPath` like
`/control/component/<id>/action/{actionId}` and a `path` on each action.
Agents can discover the URL directly rather than hard-coding it.

```bash
# Discover
curl -s "$BASE/control/components" | jq '.data.components[] |
  {id, actions: [.actions[] | {id, path}], actionInvocationPath}'
```

Example fragment:

```json
{
  "id": "zone-profile-picker",
  "actionInvocationPath": "/control/component/zone-profile-picker/action/{actionId}",
  "actions": [
    { "id": "load-profile", "path": "/control/component/zone-profile-picker/action/load-profile" },
    { "id": "save-as", "path": "/control/component/zone-profile-picker/action/save-as" }
  ]
}
```

Invoke:

```bash
curl -s -X POST "$BASE/control/component/zone-profile-picker/action/load-profile" \
  -H 'Content-Type: application/json' \
  -d '{"params": {"name": "mobile"}}'
```

**Gotcha:** Components are registered by the React tree, so they only exist
while their page is mounted. If `load-profile` returns a "component not
found" error, navigate to the page that owns it first (e.g. the Terminal
page for terminal-related components).

---

## 5. Run a Tauri command over HTTP (runner only)

This endpoint exists only when UI Bridge is hosted inside the qontinui
runner (Tauri). It lets an external agent call a curated subset of Tauri
commands directly over HTTP — no `page/evaluate` + `__TAURI_INTERNALS__`
trick needed.

```bash
# Read a setting
curl -s -X POST "$BASE/tauri/invoke" \
  -H 'Content-Type: application/json' \
  -d '{"command":"setting_get","args":{"key":"zone-profiles"}}'

# Create a terminal (no UI click needed)
curl -s -X POST "$BASE/tauri/invoke" \
  -H 'Content-Type: application/json' \
  -d '{"command":"terminal_create","args":{"title":"agent-shell","cols":120,"rows":40}}'
```

Response envelope:

```json
{
  "success": true,
  "data": {
    /* command-specific */
  }
}
```

**Safelist** (verbatim from `qontinui-runner/src-tauri/src/mcp/tauri_proxy.rs`):

- `setting_get`
- `setting_set`
- `terminal_create`
- `terminal_write`
- `terminal_close`
- `list_terminals`
- `get_claude_config_dirs`
- `check_accounts_usage`

Anything else returns **HTTP 403** with the full safelist in the body:

```json
{
  "error": "command not in safelist",
  "command": "evil_command",
  "allowed": ["setting_get", "setting_set", "terminal_create", "..."]
}
```

Use `list_terminals` to check what you've opened, and `terminal_write` with
base64-encoded `data` to send keystrokes.

---

## 6. Batch-execute actions

When you need to do several things in sequence — click, wait, click, capture
a snapshot — one request beats N round-trips and gives you a structured
per-step result.

```bash
curl -s -X POST "$BASE/control/batch-execute" \
  -H 'Content-Type: application/json' \
  -d '{
    "stop_on_error": true,
    "actions": [
      { "type": "action", "element_id": "login-username", "action": "type", "params": {"text": "alice"} },
      { "type": "action", "element_id": "login-password", "action": "type", "params": {"text": "hunter2"} },
      { "type": "action", "element_id": "login-submit",   "action": "click" },
      { "type": "wait",   "ms": 500 },
      { "type": "snapshot" }
    ]
  }'
```

Supported step types:

- `action` — `{ type:"action", element_id, action, params? }`. Dispatched
  through the same executor as `POST /control/element/:id/action`.
- `wait` — `{ type:"wait", ms }`. Plain `setTimeout`.
- `snapshot` — `{ type:"snapshot" }`. Captures the current registry snapshot
  and returns it as that step's `data`.

Response:

```json
{
  "success": true,
  "data": {
    "results": [
      { "index": 0, "success": true, "data": { "...": "..." } },
      { "index": 1, "success": true, "data": { "...": "..." } },
      { "index": 2, "success": false, "error": "Element disabled" }
    ],
    "completed": 3,
    "total": 5
  }
}
```

With `stop_on_error: true` (the default) the loop halts on the first
failure and `completed < total`. Set it to `false` to power through and get
a full per-step report.

---

## 7. Track what changed

Wrap a sequence of actions in a change-buffer session to get a structured
log of DOM mutations, console errors, and network requests that fired —
useful for post-hoc debugging and for detecting "did my click actually do
anything?".

```bash
# 1. Turn it on
curl -s -X POST "$BASE/ai/change-buffer/enable"

# 2. Do stuff
curl -s -X POST "$BASE/control/element/save-btn/action" \
  -H 'Content-Type: application/json' -d '{"action":"click"}'

# 3. Drain and inspect
curl -s -X POST "$BASE/ai/change-buffer/drain"
```

Drain response:

```json
{
  "success": true,
  "data": {
    "changes": [
      /* registry-level diffs + SPA route changes */
    ],
    "dom": [
      /* MutationObserver entries, cap 500 */
    ],
    "console_errors": [
      /* console.error/warn, cap 100 */
    ],
    "network_requests": [
      /* fetch/XHR started, cap 200 */
    ],
    "count": 12,
    "enabled_at": 1713000000000,
    "fromTimestamp": 1713000001000,
    "toTimestamp": 1713000002500
  }
}
```

Each array drains independently — so a quiet click that still fired a
network request shows up in `network_requests` even if `changes` is empty.
Caps are per-drain: once you hit them, older entries are dropped.

Use `GET /ai/change-buffer/size` to poll without draining, and
`POST /ai/change-buffer/disable` to turn tracking off.

**Example — verify a Save actually hit the backend:**

```bash
curl -s -X POST "$BASE/ai/change-buffer/enable"
curl -s -X POST "$BASE/control/element/save-btn/action" -d '{"action":"click"}' \
  -H 'Content-Type: application/json'
sleep 1
curl -s -X POST "$BASE/ai/change-buffer/drain" \
  | jq '.data.network_requests[] | select(.url | contains("/api/save"))'
```

If that filter is empty, the click was cosmetic — no request fired.
