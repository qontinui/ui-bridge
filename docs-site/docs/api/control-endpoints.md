---
sidebar_position: 2
---

# Control Endpoints

Element and component control API endpoints.

> **See also:** [Runner Features](runner-features.md) covers the
> qontinui-runner's HTTP-API extensions in one place — soft-nav modes,
> tab activation, network stubs, snapshot metadata
> (`activeTab` / `availableTabs` / `registration`), `state.value` shape,
> the F2 error-envelope contract, page playbook, component-tree
> introspection. This page documents the cross-host element + component
> primitives every UI Bridge implementation supports.

## Elements

### List Elements

```http
GET /control/elements
```

Returns all registered elements.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "submit-btn",
      "type": "button",
      "label": "Submit Button",
      "actions": ["click", "focus", "blur", "hover"],
      "state": {
        "visible": true,
        "enabled": true,
        "focused": false
      }
    }
  ]
}
```

### Get Element

```http
GET /control/element/:id
```

Get details for a specific element.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "email-input",
    "type": "input",
    "label": "Email Input",
    "actions": ["click", "type", "clear", "focus", "blur"],
    "identifier": {
      "uiId": "email-input",
      "xpath": "/html/body/form/input",
      "selector": "[data-ui-id=\"email-input\"]"
    },
    "state": {
      "visible": true,
      "enabled": true,
      "focused": false,
      "value": ""
    }
  }
}
```

### Get Element State

```http
GET /control/element/:id/state
```

Get current state of an element.

**Response:**

```json
{
  "success": true,
  "data": {
    "visible": true,
    "enabled": true,
    "focused": false,
    "rect": {
      "x": 100,
      "y": 200,
      "width": 300,
      "height": 40,
      "top": 200,
      "right": 400,
      "bottom": 240,
      "left": 100
    },
    "value": "user@example.com",
    "textContent": ""
  }
}
```

### Execute Element Action

```http
POST /control/element/:id/action
```

Execute an action on an element.

**Request Body:**

```json
{
  "action": "type",
  "params": {
    "text": "Hello World",
    "clear": true
  },
  "waitOptions": {
    "visible": true,
    "enabled": true,
    "timeout": 5000
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "success": true,
    "durationMs": 150.5,
    "timestamp": 1234567890,
    "elementState": {
      "visible": true,
      "enabled": true,
      "value": "Hello World"
    }
  }
}
```

**Failure response:**

An action that could not be performed is an **outer** failure. The envelope's
`success` is `false`, `code` carries the machine-readable reason, and the full
executor payload (including `failureDetails`) is preserved under `data`:

```json
{
  "success": false,
  "error": "Element terminal-pane exists but is not visible",
  "code": "UB-ELEM-NOT-VISIBLE",
  "data": {
    "success": false,
    "error": "Element terminal-pane exists but is not visible",
    "failureDetails": {
      "errorCode": "UB-ELEM-NOT-VISIBLE",
      "elementId": "terminal-pane",
      "suggestedActions": [],
      "retryRecommended": true
    }
  }
}
```

Branch on the **envelope**. A failure is never reported as
`{"success": true, "data": {"success": false}}` — that shape told every caller
that checks the envelope (which is all of them) that a refused action had
completed. It is identical on every transport: direct, relay, and the
`@qontinui/ui-bridge-server` adapters all emit the same verdict.

When a custom action handler throws with its own `code` (e.g.
`TERMINAL_EXITED`), that code is propagated **verbatim** rather than mapped into
the `UB-*` family — a handler's vocabulary is not the SDK taxonomy.

#### Action Types

**click**

```json
{ "action": "click" }
```

**type**

```json
{
  "action": "type",
  "params": {
    "text": "Hello",
    "clear": true,
    "delay": 50
  }
}
```

**select**

```json
{
  "action": "select",
  "params": {
    "value": "option-1",
    "byLabel": false
  }
}
```

**scroll**

```json
{
  "action": "scroll",
  "params": {
    "direction": "down",
    "amount": 200,
    "smooth": true
  }
}
```

## Components

### List Components

```http
GET /control/components
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "login-form",
      "name": "Login Form",
      "description": "User authentication form",
      "actions": ["login", "reset"]
    }
  ]
}
```

### Get Component

```http
GET /control/component/:id
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "login-form",
    "name": "Login Form",
    "description": "User authentication form",
    "actions": [
      {
        "id": "login",
        "label": "Login",
        "description": "Authenticate user"
      },
      {
        "id": "reset",
        "label": "Reset Form"
      }
    ],
    "elementIds": ["login-email", "login-password", "login-submit"]
  }
}
```

### Execute Component Action

```http
POST /control/component/:id/action/:actionId
```

**Request Body:**

```json
{
  "params": {
    "email": "user@example.com",
    "password": "secret123"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "success": true,
    "durationMs": 250.0,
    "timestamp": 1234567890,
    "result": {
      "userId": "123",
      "token": "abc..."
    }
  }
}
```

## Snapshot

### Get Control Snapshot

```http
GET /control/snapshot
```

Get a full snapshot of all controllable UI.

**Response:**

```json
{
  "success": true,
  "data": {
    "timestamp": 1234567890,
    "elements": [...],
    "components": [...],
    "workflows": [...],
    "activeRuns": []
  }
}
```

## Diagnostics

Two page-level diagnostic routes share the `diagnostics` category in
`GET /capabilities`. [`POST /control/page-health`](runner-features.md#page-health-diagnostics)
is documented with the runner features, because the runner and the web SDK both
implement it. The occlusion sweep below is **web-SDK only** — see
[Availability](#availability).

### Occlusion Sweep

```http
POST /control/visibility
```

Reports **what is covering what**, page-wide.

`/control/page-health` and `/control/find` both report per-element visibility,
but neither answers the question asked after a layout regression: *is a floating
widget hiding something?* That needs the **directed** relation — occluder over
occluded — rather than a per-element boolean. "These two boxes intersect" does
not tell you which one the user can actually read.

**Request body** (all fields optional; send `{}` for defaults):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `minRatio` | number | `0.02` | Drop occlusions covering less than this fraction of the covered element. Filters hairline overlaps. |
| `includeExpected` | boolean | `false` | Keep occlusions caused by a tracked modal. See [Expected overlays](#expected-overlays). |
| `recency` | string | relay cache TTL (5 s) | **Relay transport only.** How fresh the backing snapshot must be: `"any"` (accept any non-empty cache), `"current"` (always refetch), or a max age in ms. Omitted, it falls back to the relay's configured `cacheTtlMs`. Ignored by the in-page handler, which always reads the live registry. |

**Response:**

```json
{
  "success": true,
  "data": {
    "occlusions": [
      {
        "element": "checkout-submit",
        "label": "Place order",
        "text": "Place order",
        "occludedBy": "cookie-banner",
        "ratio": 0.72,
        "isExpectedOverlay": false,
        "hidesText": true,
        "source": "hit-test"
      }
    ],
    "elementCount": 184,
    "minRatio": 0.02,
    "includeExpected": false,
    "expectedOverlayDetection": "modal-stack",
    "expectedOverlaysFiltered": 0,
    "verdict": "occlusions_found"
  }
}
```

Occlusions are sorted worst-first, with text-hiding entries ranked above blank
ones: a covered label destroys information the reader cannot recover.

`source` is always `hit-test` from this package — the sweep reads the registry's
`elementFromPoint` result, which observes what the compositor actually painted
and so catches `clip-path`, transformed ancestors and scroll clipping that a
bounding-box model cannot derive. The field is a union (`"geometry" | "hit-test"`)
because a consumer merging these findings with `@qontinui/ui-bridge-auto`'s
geometric z-order model needs to say which probe produced which entry.

#### Verdicts

| `verdict` | Meaning |
|---|---|
| `clear` | Elements were swept and nothing (unexpected) is covered. |
| `occlusions_found` | At least one entry in `occlusions`. |
| `unknown_empty_registry` | The registry held no elements, so nothing could be swept. |

`unknown_empty_registry` exists so an empty `occlusions` list is never mistaken
for a pass. **It means UNKNOWN, not "nothing is covered."**

#### Expected overlays

An open dialog covering the page it opened over is the UI working, not a layout
regression. Occluders that are **tracked modals** are therefore classified as
expected and, by default, dropped from the response.

Classification runs against the snapshot's `modalStack`, populated by the
`modalDetector` enricher (registered automatically by `UIBridgeProvider`).
Matching is deliberately narrow: only identity-bearing forms count — the
occluder registered under the modal's own id, or an unregistered occluder whose
DOM id is the modal's. Class and bare-tag descriptors are not identities and
never match, because an entry marked expected is *removed* from the default
response, and a loose rule would hide the very regressions this endpoint exists
to surface.

| `expectedOverlayDetection` | Meaning |
|---|---|
| `modal-stack` | A modal stack was available and used to classify every occluder. An empty stack is still `modal-stack` — that genuinely means no modals are open. |
| `unavailable` | No `modalDetector` enricher, so nothing could be classified: every `isExpectedOverlay` is `false` and nothing was filtered. |

`unavailable` is **UNKNOWN, not "no expected overlays"** — the same
absence-is-not-zero distinction `unknown_empty_registry` draws. `includeExpected`
has no effect in this state.

`expectedOverlaysFiltered` counts what was dropped, so a filtered list stays
distinguishable from a genuinely clean one. It is always `0` when
`includeExpected` is `true` or detection is `unavailable`. Pass
`includeExpected: true` to see expected overlays in place, each flagged with
`isExpectedOverlay: true`.

#### Snapshot freshness (relay transport)

Over the relay, the sweep reads a cached snapshot and refreshes it first
according to `recency`. The response carries a `_meta` block reporting which
snapshot the finding came from:

```json
{
  "success": true,
  "data": { "verdict": "clear", "...": "..." },
  "_meta": { "stale": true, "staleSinceMs": 12000, "cacheAgeMs": 31000 }
}
```

Check it. A `clear` derived from a snapshot the relay could not refresh is
exactly the UNKNOWN-reading-as-a-PASS trap the `verdict` field exists to
prevent, and `stale` is the only thing that distinguishes the two.

#### Availability

This route is implemented by the **web SDK only** (`@qontinui/ui-bridge`), on
both the in-page and relay transports. qontinui-runner does not expose it, and
`@qontinui/ui-bridge-native` returns a route miss for it. Discover it at runtime
under the `diagnostics` category of `GET /capabilities` rather than assuming it
is present.

```bash
curl -sX POST http://localhost:3001/api/ui-bridge/control/visibility \
  -H 'Content-Type: application/json' -d '{"minRatio":0.1}' \
  | jq '.data.verdict, .data.expectedOverlayDetection, (.data.occlusions | length)'
# "occlusions_found"
# "modal-stack"
# 3
```

Every field is optional: a request with an empty body, `{}`, or no body at all
returns the defaults.
