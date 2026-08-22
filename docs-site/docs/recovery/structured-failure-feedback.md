# Structured Failure Feedback

When a UI Bridge action fails, it does not throw a string. It returns a
**stable machine-readable code**, the context the failure happened in, and a
ranked list of recovery suggestions — so an agent can decide what to do next
without parsing prose.

The code vocabulary is generated from `diagnostics/codes.json` into
`packages/ui-bridge/src/diagnostics/codes.generated.ts`. That file is the
single source of truth for the codes, their descriptions, their common causes
and their recovery templates.

## Error Codes

Every code is `UB-`-prefixed and belongs to one of five categories: `element`,
`action`, `assertion`, `network`, `system`. There are 41:

| Code | Category | Description |
| ---- | -------- | ----------- |
| `UB-ACTION-FAILED` | action | The action could not be completed. |
| `UB-ACTION-REJECTED` | action | The action was rejected before execution (e.g. by a guard, policy, or validation gate). |
| `UB-ACTION-TIMEOUT` | action | The action timed out waiting for a condition to be met. |
| `UB-AMBIGUOUS-MATCH` | element | Multiple elements match with similar confidence; a single best match could not be chosen. |
| `UB-ASSERT-CONTRAST` | assertion | A color-contrast (accessibility) assertion failed. |
| `UB-ASSERT-ELEMENT-MISSING` | assertion | An assertion targeted an element that does not exist. |
| `UB-ASSERT-LAYOUT` | assertion | A layout/geometry assertion failed (position, size, alignment, overlap). |
| `UB-ASSERT-TEXT-MISMATCH` | assertion | An assertion about element text content failed (exact/contains/regex mismatch). |
| `UB-ASSERT-TIMEOUT` | assertion | An assertion timed out waiting for its condition. |
| `UB-ASSERT-VISIBILITY` | assertion | An assertion about element visibility failed. |
| `UB-ELEM-BLOCKED` | element | The element is blocked by another element such as a modal, overlay, or popup. |
| `UB-ELEM-DISABLED` | element | The element is disabled and cannot be interacted with. |
| `UB-ELEM-NOT-ENABLED` | element | The element is present and visible but disabled, so it cannot be interacted with. |
| `UB-ELEM-NOT-FOUND` | element | No element matching the target description or selector could be found. |
| `UB-ELEM-NOT-INTERACTABLE` | element | The element is visible and enabled but cannot receive the interaction (e.g. covered, animating, or pointer-events:none). |
| `UB-ELEM-NOT-VISIBLE` | element | The element exists in the DOM but is not currently visible. |
| `UB-HEALTH-EMPTY-CONTENT-AREA` | system | Page health: the main content area is nearly empty while the sidebar/left region has content. |
| `UB-HEALTH-EMPTY-TEXT-SIGNAL` | system | Page health: empty-state text was detected (e.g. "no results", "nothing here"). |
| `UB-HEALTH-ERROR-TEXT-SIGNAL` | system | Page health: error-indicating text was detected on the page. |
| `UB-HEALTH-LOADING-CLASS-SIGNAL` | system | Page health: a loading/skeleton/spinner CSS class was detected on a visible element. |
| `UB-HEALTH-LOADING-TEXT-SIGNAL` | system | Page health: loading-indicating text was detected, suggesting the page is not settled. |
| `UB-HEALTH-LOW-ELEMENT-DIVERSITY` | system | Page health: all visible elements are navigation-type, suggesting the content body is missing. |
| `UB-HEALTH-LOW-SPATIAL-COVERAGE` | system | Page health: rendered elements occupy a critically/abnormally small fraction of the viewport. |
| `UB-HEALTH-MANY-DISABLED-INTERACTIVE` | system | Page health: over half of interactive elements are disabled. |
| `UB-HEALTH-NO-CONTENT-ELEMENTS` | system | Page health: no elements were found in the content region. |
| `UB-HEALTH-OFF-SCREEN-ELEMENT` | system | Page health: a visible element is positioned entirely off-screen. |
| `UB-HEALTH-SPARSE-CONTENT` | system | Page health: the content region has very few elements. |
| `UB-HEALTH-ZERO-SIZE-ELEMENT` | system | Page health: a visible element has zero width or height. |
| `UB-LOW-CONFIDENCE` | element | The best matching element has confidence below the acceptance threshold. |
| `UB-MULTIPLE-ELEMENTS` | element | Multiple elements match the description; the target is ambiguous. |
| `UB-NAVIGATION-ERROR` | network | Navigation to the target page failed. |
| `UB-NET-ERROR` | network | A network error occurred while performing the action or loading data. |
| `UB-PAGE-LOAD-ERROR` | network | The page failed to load correctly. |
| `UB-PARSE-ERROR` | system | Could not parse the natural language instruction. |
| `UB-STALE-ELEMENT` | element | The element reference is no longer attached to the DOM. |
| `UB-STATE-NOT-REACHED` | system | The expected post-action state was not reached. |
| `UB-UNEXPECTED-STATE` | system | The element or page is in an unexpected state. |
| `UB-UNKNOWN-ERROR` | system | An unknown or uncategorized error occurred. |
| `UB-UNSUPPORTED-ACTION` | action | The requested action type is not supported for this element or surface. |
| `UB-VALIDATION-ERROR` | system | The parsed action failed validation. |
| `UB-VLM-STRUCTURED-PARSE-FAIL` | system | The VLM Describe response could not be parsed into the closed structured schema; the prose-only response was returned with structured=null. |

The twelve `UB-HEALTH-*` codes are emitted by the page-health diagnostic
(`POST /control/page-health`) rather than by an action, but they share the same
vocabulary and the same recovery machinery.

To iterate the vocabulary or look a code up at runtime:

```typescript
import { UI_BRIDGE_ERROR_CODES, DIAGNOSTICS } from '@qontinui/ui-bridge/diagnostics';

for (const code of UI_BRIDGE_ERROR_CODES) {
  const entry = DIAGNOSTICS[code];
  console.log(code, entry.category, entry.description, entry.commonCauses);
}
```

`DIAGNOSTICS` is also re-exported from the package root; the array and the
`DiagnosticEntry` / `DiagnosticCategory` types are on the `/diagnostics`
subpath only.

## Reading a Failure

Actions do **not** throw a typed error class. There is no `UIBridgeError`.
Failure is reported in the response value, which keeps a failed action
distinguishable from a genuine exception:

```typescript
const result = await executor.execute({ instruction: 'click the checkout button' });

if (!result.success) {
  result.errorCode; // 'UB-ELEM-NOT-FOUND'
  result.error; // human-readable message
  result.suggestions; // string[] — legacy flat form
  result.alternatives; // SearchResult[] — candidates that scored too low
  result.failureInfo; // the structured form, below
}
```

`failureInfo` is a `StructuredFailureInfo`:

```typescript
interface StructuredFailureInfo {
  errorCode: string;
  message: string;
  elementId?: string;
  selectorsTried?: string[];
  partialMatches?: PartialMatchInfo[];
  elementState?: ElementState;
  screenshotContext?: string; // a capture id/path, not an inline image
  suggestedActions?: RecoverySuggestion[];
  retryRecommended: boolean;
  context?: Record<string, unknown>;
  durationMs?: number;
  timeoutMs?: number;
}
```

`retryRecommended` is derived from the catalog — it is true when any recovery
template entry for that code is `retryable` — so an agent can decide to retry
without a hand-maintained table of which codes are transient.

## Recovery Suggestions

Every code carries a ranked recovery template. `getRecoverySuggestions` renders
it, substituting `${…}` placeholders from a context map:

```typescript
import { getRecoverySuggestions } from '@qontinui/ui-bridge';

const suggestions = getRecoverySuggestions('UB-ACTION-TIMEOUT', {
  waitDurationMs: 5000,
  waitCondition: 'results table visible',
});

for (const s of suggestions) {
  console.log(s.priority, s.suggestion, s.command, s.confidence, s.retryable);
}
// 1 'Increase the timeout duration (the wait gave up after 5000ms)' … 0.8 true
// 2 "Check if the condition 'results table visible' can ever be met" … 0.7 false
// 3 'Verify the page is responding' 'check page status' 0.6 true
```

A `RecoverySuggestion` is
`{ suggestion, command?, confidence, retryable, priority? }` — one shape across
every failure surface. Unknown placeholders are left verbatim rather than
rendered as `undefined`.

`ERROR_SUGGESTIONS` is the same catalog pre-rendered without a context map, keyed
by code.

## Building Error Context

When you produce a failure yourself, build the context rather than assembling a
message by hand. `createErrorContext` inspects the available elements, detects
possible blockers (modals, overlays), counts what was visible and enhances the
suggestion list with what it found:

```typescript
import { createErrorContext, formatErrorContext } from '@qontinui/ui-bridge';

const context = createErrorContext(
  'UB-ELEM-NOT-FOUND',
  'click the checkout button',
  availableElements,
  searchCriteria,
  nearestMatch
);

console.log(context.pageContext.possibleBlockers); // e.g. ['modal: Confirm delete']
console.log(formatErrorContext(context)); // LLM-ready prose rendering
```

An `AIErrorContext` carries `code`, `message`, `attemptedAction`,
`searchCriteria?`, `searchResults` (candidate count plus the nearest match and
why it was rejected), `pageContext` (url, title, visible element count,
possible blockers), `suggestions` and an optional `stack`.

For the minimal case — a code and a message with no element context — use
`createSimpleError`:

```typescript
import { createSimpleError } from '@qontinui/ui-bridge';

const err = createSimpleError('UB-UNSUPPORTED-ACTION');
// { code: 'UB-UNSUPPORTED-ACTION', message: '…' }
```

Two more helpers make triage cheap:

```typescript
import { isRecoverableError, getBestRecoverySuggestion } from '@qontinui/ui-bridge';

isRecoverableError('UB-PAGE-LOAD-ERROR'); // false
getBestRecoverySuggestion(context); // highest-confidence suggestion, or null
```

## Automated Recovery

`POST /ai/recovery/attempt` takes a structured failure and retries it under the
catalog's strategies:

```http
POST /ai/recovery/attempt
Content-Type: application/json

{
  "failure": { "errorCode": "UB-ELEM-NOT-VISIBLE", "message": "…", "retryRecommended": true },
  "instruction": "click the checkout button",
  "elementId": "checkout-btn",
  "maxRetries": 3
}
```

The response is a `RecoveryAttemptResult`:
`{ recovered, strategiesAttempted, finalResult?, error?, durationMs }` —
`strategiesAttempted` names what was tried, so a failed recovery is still
diagnostic rather than opaque.

## Server-Side Codes

Handlers built with `@qontinui/ui-bridge-server` map their internal error
strings onto the same vocabulary via `mapInternalErrorCode`, and
`buildActionFailureDetails` assembles the `failureDetails` field carried on
component-action and workflow-step results:

```typescript
import { buildActionFailureDetails } from '@qontinui/ui-bridge/diagnostics';

const details = buildActionFailureDetails('UB-ELEM-NOT-VISIBLE', 'Submit is off-screen', {
  elementId: 'submit-btn',
  visibilityReason: 'off-screen',
  durationMs: 120,
});
// details.suggestedActions and details.retryRecommended come from the catalog
```

This is why an HTTP error body and an in-process failure agree on the code: both
render from the generated catalog, and neither hand-maintains a table.
