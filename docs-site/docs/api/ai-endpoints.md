# AI API Endpoints

REST API endpoints for AI-native UI automation.

> **See also:** [Runner Features](runner-features.md) is the canonical
> reference for HTTP-API behavior on the qontinui-runner. It covers
> `ai/find` scoring, `ai/wait-for-element`, idle-status signals, and the
> response-envelope contract in detail. This page documents the
> framework-agnostic AI endpoints exposed by every UI Bridge host.

> **URL prefix.** The path family below is rendered as `/ai/...` for
> brevity. Real prefixes vary by host:
>
> | Host                                        | Effective prefix        |
> | ------------------------------------------- | ----------------------- |
> | qontinui-runner (Tauri)                     | `/ui-bridge/ai/...`     |
> | qontinui-runner SDK proxy                   | `/ui-bridge/sdk/ai/...` |
> | Headless `@qontinui/ui-bridge/server` embed | `/__ui-bridge__/ai/...` |
>
> Substitute the prefix appropriate to the host you are calling. The
> body and response shapes are identical across prefixes — only the
> envelope differs (the runner wraps every response in
> `{ success, data }`; the headless embed returns the same body
> directly).

## Search Elements

```http
POST /ai/search
{
  "text": "Home",
  "fuzzy": true
}
```

Multi-strategy element search across the registered + discovered
element set. The closest cousin of [`/ai/find`](runner-features.md#aifind--natural-language-element-lookup),
but search-shaped (returns a ranked list, not a single best match).
Use `/ai/find` when you want one element to act on; use `/ai/search`
when you want every element matching a criterion (e.g. "list all
buttons in the nav").

### Request body — `SearchCriteria`

The body is a `SearchCriteria` object. **At least one criterion** is
required; all are optional and combined with AND.

| Field            | Type                    | Notes                                                                 |
| ---------------- | ----------------------- | --------------------------------------------------------------------- |
| `text`           | `string`                | Exact visible-text match (e.g. `"Start Extraction"`).                 |
| `textContains`   | `string`                | Partial visible-text match (substring).                               |
| `accessibleName` | `string`                | Accessible-name match (`aria-label`, associated `<label>`).           |
| `placeholder`    | `string`                | Input placeholder text.                                               |
| `role`           | `string`                | ARIA role: `"button"`, `"link"`, `"textbox"`, etc.                    |
| `type`           | `ElementType`           | Element type — narrower than `role` (e.g. `"input"`, `"select"`).     |
| `idPattern`      | `string`                | Element-id pattern, supports `*` wildcards.                           |
| `selector`       | `string`                | CSS selector applied to the rendered DOM.                             |
| `xpath`          | `string`                | XPath expression.                                                     |
| `dataAttributes` | `Record<string,string>` | Match `data-*` attributes by exact value.                             |
| `near`           | `string`                | Spatial proximity hint (e.g. `"near the URL input"`).                 |
| `within`         | `string`                | Container hint (e.g. `"within the login form"`).                      |
| `fuzzy`          | `boolean`               | Enable fuzzy matching. Default `true` when `text`/`textContains` set. |
| `fuzzyThreshold` | `number`                | Confidence floor for fuzzy matches, `0..1`. Default `0.7`.            |
| `includeContent` | `boolean`               | Include non-interactive content elements in results.                  |
| `contentOnly`    | `boolean`               | Restrict to content elements (paragraphs, headings, etc.).            |

> **Common mistake:** the documented `{ query, filters, limit }`
> envelope from earlier docs is **partially wired**. `query` is mapped
> to `text` for back-compat, but `filters` and `limit` are silently
> ignored. Use real `SearchCriteria` keys instead — `text`/`textContains`
> for content, `role`/`type` for shape, and post-filter the `results`
> array client-side if you need a result cap.

### Response shape

The response is the runner's standard `{ success, data }` envelope
wrapping a `SearchResponse`:

```json
{
  "success": true,
  "data": {
    "results": [
      {
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
            "rect": { "x": 7, "y": 114, "width": 173.3, "height": 36, "...": "..." },
            "computedStyles": { "...": "..." },
            "visible": true,
            "enabled": true,
            "focused": false,
            "textContent": "Home"
          },
          "suggestedActions": ["click \"home\""]
        },
        "confidence": 0.8,
        "matchReasons": ["inferred role: button"],
        "scores": { "role": 0.8 }
      }
    ],
    "bestMatch": {
      /* same shape as results[0], or null when empty */
    },
    "scannedCount": 64,
    "criteria": { "text": "Home", "fuzzy": true },
    "durationMs": 0.3,
    "timestamp": 1777305207125
  }
}
```

Fields under `data`:

- `results: SearchResult[]` — every element that matched, sorted by
  `confidence` descending. Each entry carries the full
  `AIDiscoveredElement` plus `confidence`, `matchReasons`, and
  per-strategy `scores` (`text`, `accessibility`, `role`, `spatial`,
  `fuzzy`).
- `bestMatch: SearchResult | null` — the highest-confidence entry, or
  `null` when `results` is empty. Identical reference to `results[0]`
  on a non-empty match.
- `scannedCount: number` — how many elements were considered. Use this
  to spot empty-registry conditions (`scannedCount: 0` ⇒ the page
  hasn't registered any elements yet — call `/control/discover` or wait
  for `frontendReady`).
- `criteria: SearchCriteria` — the (possibly-rewritten) criteria the
  engine actually evaluated. The legacy `query` field is rewritten to
  `text` here, so `criteria.query` won't appear in the echo.
- `durationMs: number` — server-side match time.
- `timestamp: number` — `Date.now()` when the response was built.

### Search vs. find

Pick `/ai/find` when the natural-language phrasing is "the X" or "the
X with Y" and you'll act on exactly one element. Pick `/ai/search`
when you'd act on a list — for example collecting every button in a
toolbar to assert their order, or every input in a form to clear them.

```bash
# All buttons in the current page
curl -s -X POST "$BASE/ui-bridge/ai/search" \
  -H "Content-Type: application/json" \
  -d '{"role":"button"}' \
  | jq '.data.results[].element.label'

# First button matching "Save"
curl -s -X POST "$BASE/ui-bridge/ai/search" \
  -H "Content-Type: application/json" \
  -d '{"text":"Save","role":"button"}' \
  | jq '.data.bestMatch.element.id'
```

## Execute Instruction

```http
POST /ai/execute
{
  "instruction": "click the submit button"
}
```

Parses a natural-language instruction (`"click the X"`, `"type Y into
Z"`, `"check the Q box"`), resolves the target via the same matcher
`/ai/find` uses, and dispatches the action. Returns `{ confidence,
durationMs, elementState, ... }` on success. Pass
`"confidenceThreshold": 0.7` (default) to tighten / loosen the
acceptance bar before the action fires.

## Assert

```http
POST /ai/assert
{
  "assertion": "the home button is visible"
}
```

Single assertion in natural-language form. Resolves the implied
target, evaluates the predicate, returns `{ actual, durationMs,
elementState, ... }`. Used as the building block for
`/ai/assert-batch`.

## Assert (batch)

```http
POST /ai/assert-batch
{
  "assertions": [
    { "assertion": "the home button is visible" },
    { "assertion": "the error banner is hidden" }
  ],
  "mode": "all"
}
```

Each entry accepts either NL form (`{ assertion: "..." }`) or
structured form (`{ target, type, expected }`). `mode` is `"all"`
(default — all must pass) or `"any"` (one is enough).

> **Note:** the batch endpoint is also exposed at the alias path
> `/ai/assert/batch`.

## Page summary

```http
POST /ai/page-summary
```

Returns a structured snapshot of "what's on the page right now" —
buttons, headings, inputs, link counts, and visible errors. Useful as
a cheap first-pass before deciding whether to issue more targeted
inspection calls. Empty body `{}` is fine.
