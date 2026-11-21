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
`action`, `assertion`, `network`, `system`. There are 65:

| Code                                      | Category  | Description                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UB-ACTION-FAILED`                        | action    | The action could not be completed.                                                                                                                                                                                                                                                                                                       |
| `UB-ACTION-REJECTED`                      | action    | The action was rejected before execution (e.g. by a guard, policy, or validation gate).                                                                                                                                                                                                                                                  |
| `UB-ACTION-TIMEOUT`                       | action    | The action timed out waiting for a condition to be met.                                                                                                                                                                                                                                                                                  |
| `UB-AMBIGUOUS-MATCH`                      | element   | Multiple elements match with similar confidence; a single best match could not be chosen.                                                                                                                                                                                                                                                |
| `UB-ASSERT-CONTRAST`                      | assertion | A color-contrast (accessibility) assertion failed.                                                                                                                                                                                                                                                                                       |
| `UB-ASSERT-ELEMENT-MISSING`               | assertion | An assertion targeted an element that does not exist.                                                                                                                                                                                                                                                                                    |
| `UB-ASSERT-LAYOUT`                        | assertion | A layout/geometry assertion failed (position, size, alignment, overlap).                                                                                                                                                                                                                                                                 |
| `UB-ASSERT-TEXT-MISMATCH`                 | assertion | An assertion about element text content failed (exact/contains/regex mismatch).                                                                                                                                                                                                                                                          |
| `UB-ASSERT-TIMEOUT`                       | assertion | An assertion timed out waiting for its condition.                                                                                                                                                                                                                                                                                        |
| `UB-ASSERT-VISIBILITY`                    | assertion | An assertion about element visibility failed.                                                                                                                                                                                                                                                                                            |
| `UB-CAPABILITY-UNAVAILABLE`               | system    | The running build does not serve this capability (e.g. a runner-direct `/vision/*` route called on an SDK-only bridge). Nothing was attempted; this is not an action rejection.                                                                                                                                                          |
| `UB-ELEM-BLOCKED`                         | element   | The element is blocked by another element such as a modal, overlay, or popup.                                                                                                                                                                                                                                                            |
| `UB-ELEM-DISABLED`                        | element   | The element is disabled and cannot be interacted with.                                                                                                                                                                                                                                                                                   |
| `UB-ELEM-NOT-ENABLED`                     | element   | The element is present and visible but disabled, so it cannot be interacted with.                                                                                                                                                                                                                                                        |
| `UB-ELEM-NOT-FOUND`                       | element   | No element matching the target description or selector could be found.                                                                                                                                                                                                                                                                   |
| `UB-ELEM-NOT-INTERACTABLE`                | element   | The element is visible and enabled but cannot receive the interaction (e.g. covered, animating, or pointer-events:none).                                                                                                                                                                                                                 |
| `UB-ELEM-NOT-VISIBLE`                     | element   | The element exists in the DOM but is not currently visible.                                                                                                                                                                                                                                                                              |
| `UB-HEALTH-EMPTY-CONTENT-AREA`            | system    | Page health: the main content area is nearly empty while the sidebar/left region has content.                                                                                                                                                                                                                                            |
| `UB-HEALTH-EMPTY-TEXT-SIGNAL`             | system    | Page health: empty-state text was detected (e.g. "no results", "nothing here").                                                                                                                                                                                                                                                          |
| `UB-HEALTH-ERROR-TEXT-SIGNAL`             | system    | Page health: error-indicating text was detected on the page.                                                                                                                                                                                                                                                                             |
| `UB-HEALTH-LOADING-CLASS-SIGNAL`          | system    | Page health: a loading/skeleton/spinner CSS class was detected on a visible element.                                                                                                                                                                                                                                                     |
| `UB-HEALTH-LOADING-TEXT-SIGNAL`           | system    | Page health: loading-indicating text was detected, suggesting the page is not settled.                                                                                                                                                                                                                                                   |
| `UB-HEALTH-LOW-ELEMENT-DIVERSITY`         | system    | Page health: all visible elements are navigation-type, suggesting the content body is missing.                                                                                                                                                                                                                                           |
| `UB-HEALTH-LOW-SPATIAL-COVERAGE`          | system    | Page health: rendered elements occupy a critically/abnormally small fraction of the viewport.                                                                                                                                                                                                                                            |
| `UB-HEALTH-MANY-DISABLED-INTERACTIVE`     | system    | Page health: over half of interactive elements are disabled.                                                                                                                                                                                                                                                                             |
| `UB-HEALTH-NO-CONTENT-ELEMENTS`           | system    | Page health: no elements were found in the content region.                                                                                                                                                                                                                                                                               |
| `UB-HEALTH-OFF-SCREEN-ELEMENT`            | system    | Page health: a visible element is positioned entirely off-screen.                                                                                                                                                                                                                                                                        |
| `UB-HEALTH-SPARSE-CONTENT`                | system    | Page health: the content region has very few elements.                                                                                                                                                                                                                                                                                   |
| `UB-HEALTH-ZERO-SIZE-ELEMENT`             | system    | Page health: a visible element has zero width or height.                                                                                                                                                                                                                                                                                 |
| `UB-LOW-CONFIDENCE`                       | element   | The best matching element has confidence below the acceptance threshold.                                                                                                                                                                                                                                                                 |
| `UB-MULTIPLE-ELEMENTS`                    | element   | Multiple elements match the description; the target is ambiguous.                                                                                                                                                                                                                                                                        |
| `UB-NAVIGATION-ERROR`                     | network   | Navigation to the target page failed.                                                                                                                                                                                                                                                                                                    |
| `UB-NET-ERROR`                            | network   | A network error occurred while performing the action or loading data.                                                                                                                                                                                                                                                                    |
| `UB-OBS-APP-UNREACHABLE`                  | network   | The bridge, the runner, or the app behind it could not be reached, so nothing was attempted or observed (an observation carrying it is unknown, not empty).                                                                                                                                                                              |
| `UB-OBS-BELOW-CONFIDENCE-FLOOR`           | system    | Observation unknown: observations existed but every one fell under the caller's confidence floor.                                                                                                                                                                                                                                        |
| `UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD`  | system    | Observation unknown: the running build does not serve the capability this observation needs.                                                                                                                                                                                                                                             |
| `UB-OBS-FRONTIER-OPEN`                    | system    | Observation unknown: the answer depends on frontier entries (declared affordances never yet activated) that are still open, so a negative answer would be a claim about unexplored territory.                                                                                                                                            |
| `UB-OBS-HIT-TEST-UNMEASURABLE`            | system    | Observation unknown: the hit-test looked and cannot tell whether a pointer reaches the target (a null hit, a hit on a shadow host on the target's composed path, a cross-origin frame, no `document.elementFromPoint`, or a target computing `pointer-events: none`), so the target is neither reachable nor blocked as far as is known. |
| `UB-OBS-INPUT-MISSING`                    | system    | Observation unknown: a required input was absent (no `elements` array, no geometry/bbox, no frame, no viewport). This says nothing about the page itself.                                                                                                                                                                                |
| `UB-OBS-LEDGER-SCHEMA-ABSENT`             | system    | Observation unknown: the observation ledger's storage does not exist in this deployment, so nothing could be recorded or read.                                                                                                                                                                                                           |
| `UB-OBS-LEDGER-WRITE-FAILING`             | system    | Observation unknown: the observation ledger exists but its writes are failing, so recent observations are missing from it.                                                                                                                                                                                                               |
| `UB-OBS-MODEL-REPLY-UNPARSEABLE`          | system    | Observation unknown: a model reply could not be parsed or failed strict validation.                                                                                                                                                                                                                                                      |
| `UB-OBS-NEEDS-MULTI-FRAME-INPUT`          | system    | Observation unknown: the question needs more than one frame (e.g. animation_settled) and only one was available.                                                                                                                                                                                                                         |
| `UB-OBS-NO-EVENT-BEFORE-TIMEOUT`          | system    | Observation unknown: the awaited event did not occur before the observation window closed, so the timing it would have measured does not exist for this run.                                                                                                                                                                             |
| `UB-OBS-NO-EXPECTATION`                   | system    | Verdict unknown: there was no usable expectation to judge against (assertion criteria that do not parse, an empty `activateStates`), so the result can be called neither passed nor failed.                                                                                                                                              |
| `UB-OBS-NO-OBSERVATIONS`                  | system    | Observation unknown: the ledger holds no observations at all for the question asked, so nothing can be said either way.                                                                                                                                                                                                                  |
| `UB-OBS-NO-RESULTS`                       | system    | Verdict unknown: there was nothing to judge — zero results or assertions were folded, so the verdict is unknown, never passed. An empty set is not a pass.                                                                                                                                                                               |
| `UB-OBS-NOT-ATTEMPTED-BY-POLICY`          | system    | Verdict unknown: a policy withheld the attempt (e.g. `stopOnFailure` after an earlier failure, an effects allow-list), so the check never ran — skipped is not passed.                                                                                                                                                                   |
| `UB-OBS-NOT-ATTEMPTED-DESTRUCTIVE`        | system    | Verdict unknown: the check was deliberately not attempted because performing it would be a destructive action, so nothing was observed and nothing passed.                                                                                                                                                                               |
| `UB-OBS-NOT-ATTEMPTED-WRITE`              | system    | Verdict unknown: the check was deliberately not attempted because performing it would be a write, so nothing was observed and nothing passed.                                                                                                                                                                                            |
| `UB-OBS-NOT-REPORTED`                     | system    | Verdict unknown: the producer ran but reported no result for this item, so the missing result is unknown, never passed.                                                                                                                                                                                                                  |
| `UB-OBS-PERFORMANCE-OBSERVER-UNSUPPORTED` | system    | Observation unknown: the webview's PerformanceObserver does not support the entry type this measurement needs (e.g. layout-shift, longtask), so the value was not measured — it is not zero.                                                                                                                                             |
| `UB-OBS-PRODUCER-FAILED`                  | system    | The producer (an observation producer, or the runner answering a proxied call) ran and failed: transport error, HTTP error status, timeout, or a thrown exception. An observation carrying it is unknown — nothing is known about the page.                                                                                              |
| `UB-OBS-PRODUCER-NOT-RUN`                 | system    | Observation unknown: the producer did not run because there was nothing to look at yet (e.g. zero registered elements and components).                                                                                                                                                                                                   |
| `UB-OBS-STALE-INPUT`                      | system    | Observation unknown: the input is known to be stale, so an answer over it would describe a page that no longer exists.                                                                                                                                                                                                                   |
| `UB-OBS-TO-NODE-UNOBSERVED`               | system    | Observation unknown: the query's destination node has never been observed, so whether it is reachable is not known.                                                                                                                                                                                                                      |
| `UB-PAGE-LOAD-ERROR`                      | network   | The page failed to load correctly.                                                                                                                                                                                                                                                                                                       |
| `UB-PARSE-ERROR`                          | system    | Could not parse the natural language instruction.                                                                                                                                                                                                                                                                                        |
| `UB-STALE-ELEMENT`                        | element   | The element reference is no longer attached to the DOM.                                                                                                                                                                                                                                                                                  |
| `UB-STATE-NOT-REACHED`                    | system    | The expected post-action state was not reached.                                                                                                                                                                                                                                                                                          |
| `UB-UNEXPECTED-STATE`                     | system    | The element or page is in an unexpected state.                                                                                                                                                                                                                                                                                           |
| `UB-UNKNOWN-ERROR`                        | system    | An unknown or uncategorized error occurred.                                                                                                                                                                                                                                                                                              |
| `UB-UNSUPPORTED-ACTION`                   | action    | The requested action type is not supported for this element or surface.                                                                                                                                                                                                                                                                  |
| `UB-VALIDATION-ERROR`                     | system    | The parsed action failed validation.                                                                                                                                                                                                                                                                                                     |
| `UB-VLM-STRUCTURED-PARSE-FAIL`            | system    | The VLM Describe response could not be parsed into the closed structured schema; the prose-only response was returned with structured=null.                                                                                                                                                                                              |

The twelve `UB-HEALTH-*` codes are emitted by the page-health diagnostic
(`POST /control/page-health`) rather than by an action, but they share the same
vocabulary and the same recovery machinery.

The twenty-three `UB-OBS-*` codes are the diagnostic names of the observation
envelope's `unknown.code` values (`input_missing` → `UB-OBS-INPUT-MISSING`, and
so on — `UNKNOWN_CODE_DIAGNOSTICS` in `@qontinui/ui-bridge/diagnostics` is the
map). An observation that could not look answers `status: "unknown"` with one
of those codes rather than an empty result. Six of them (`UB-OBS-NO-RESULTS`,
`UB-OBS-NO-EXPECTATION`, `UB-OBS-NOT-ATTEMPTED-DESTRUCTIVE`,
`UB-OBS-NOT-ATTEMPTED-WRITE`, `UB-OBS-NOT-ATTEMPTED-BY-POLICY`,
`UB-OBS-NOT-REPORTED`) name why a verdict could say neither passed nor failed,
and `UB-OBS-HIT-TEST-UNMEASURABLE` why a hit-test could not tell whether a
pointer reaches its target; nothing emits any of the seven yet.
`UB-CAPABILITY-UNAVAILABLE` is what a runner-direct route (`/vision/*`) answers
on a bridge that has no runner: the build does not serve it, which is not the
same fact as an action a guard rejected.

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

The response data is a `RecoveryAttemptResult`:
`{ attemptSucceeded, originalActionPerformed, originalActionAttempted, strategiesAttempted, finalResult?, error?, durationMs }` —
`strategiesAttempted` names what was tried, so a failed recovery is still
diagnostic rather than opaque.

Two limits bound one attempt:

- `maxRetries` is its **action budget**. The attempt performs at most
  `maxRetries` executions, and the direct-instruction fallback counts against
  it.
- The **original instruction runs at most once**. A commandless suggestion, a
  suggestion whose `command` equals `instruction`, and the direct-instruction
  fallback all run it. Commands are compared as PARSED actions: same action,
  same target (ignoring case, whitespace and filler words, so
  `Click the Submit button` is `click Submit`), and the same typed or selected
  value, compared case-sensitively because typed text is case-significant. A
  command that does not parse is compared as text, with whitespace trimmed and
  collapsed, ignoring case. The comparison is on the instruction text, not on the element it
  resolves to: two differently worded targets that resolve to the same element
  are different here, and both can run.
  Once one of them has run it (whatever it reported), every later one is
  skipped, the fallback included. The guard is per server attempt. It does not
  count the client's own earlier failed execution of the original, the one
  that led the client to ask for recovery: the attempt may run the original
  once more.

`attemptSucceeded` is the verdict. Where each server states it:

- **The `createHandlers` server** (`POST /ai/recovery/attempt`) states it on
  every answer, at `data.attemptSucceeded`.
- **The generic relay's in-page stub** (`executeCommand('attemptRecovery')`)
  answers `success: false` with `data: {attemptSucceeded: false,
originalActionPerformed: false, originalActionAttempted: false,
strategiesAttempted: []}`. Recovery is not implemented there, so no strategy
  runs. Over the relay server, that in-page answer is an inner failure, which
  the relay nests whole under the outer envelope's `data` (outer
  `success: false`). The verdict therefore sits at `data.data.attemptSucceeded`.

From the `createHandlers` server: when a strategy's action reported success,
the envelope is `success: true` (HTTP 200) with `attemptSucceeded: true`.
Otherwise the envelope is `success: false` with `attemptSucceeded: false` still
under `data`:

- HTTP 400 (code `UB-ACTION-FAILED`, error `RECOVERY_FAILED: …`) when the
  attempt ran and no strategy reported success;
- HTTP 400 `UB-VALIDATION-ERROR` when it was refused for the caller's payload:
  - a missing or malformed `failure`, `instruction`, `maxRetries` (not a
    positive integer: a budget below 1 runs no strategy, not even the
    direct-instruction fallback) or `suggestedActions`. An optional field set
    to `null` counts as absent;
  - or an operator-contract failure (`failure.errorCode` `WRONG_TYPE_PARAM` or
    `MISSING_PARAM`), which no strategy can fix: fix the request at the call
    site;
- HTTP 500 (code `UB-UNKNOWN-ERROR`) when the server itself failed;
  `strategiesAttempted` names what already ran.

`attemptSucceeded: false` means no strategy reported success, not that the UI
is unchanged: an action that reported failure may have partly applied. The
runner's own `/ai/recovery/attempt` uses the same field name, and its 200 / 400
`RECOVERY_FAILED` split.

`attemptSucceeded: true` says a recovery strategy's action reported success.
Whether the original action now succeeds depends on `originalActionPerformed`,
which the `createHandlers` server states on every answer:

- `true`: the acting strategy executed the original instruction itself (the
  direct-instruction fallback, a commandless suggestion, or a command equal to
  the instruction), and it reported success; `finalResult` is its result. The
  original action has already happened, so do NOT perform it again. The Python
  clients return success without another execution.
- `false` with `attemptSucceeded: true`: a different command acted (scroll,
  wait, dismiss). What to do next depends on `originalActionAttempted`:
  - `false`: the original did not run in this attempt. Retry it to find out
    whether it now succeeds.
  - `true`: the original already ran in this attempt and reported failure
    before the other command succeeded. Do NOT re-run it, because a failed
    action may have partly applied. The Python clients stop and report the
    original as not succeeded.
  - unstated (a server that does not send it, such as the runner, whose
    scoped recovery runs the original instruction itself): UNKNOWN. Do NOT
    re-run it. The Python clients stop with `ORIGINAL_OUTCOME_UNKNOWN_ERROR`.

`originalActionPerformed` is `false` on every answer whose `attemptSucceeded`
is `false`; there, `originalActionAttempted` still says whether the original
ran. `originalActionAttempted` is `false` on every refusal (nothing runs).

If the server fails while building a success answer, it answers HTTP 500
(`success: false`) and still states `attemptSucceeded: true`, together with
what acted. Treat that as UNKNOWN: neither retry the original nor report it as
succeeded.

### Python client stop codes

When a recovery attempt's answer makes the Python clients'
`execute_with_recovery` stop without retrying the original, the returned
`ExecuteWithRecoveryResult` carries `success: False` and one of these
`error_code` values. Other stops (recovery disabled, no retry recommended, the
retry budget spent, or a recovery that reported no success and did not re-run
the original) keep the client's own `error_code`. Each constant is exported
from `ui_bridge`, so a caller compares against it rather than a string literal:

| Constant                           | `error_code`                           | When                                                                                                        |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ORIGINAL_ALREADY_ATTEMPTED_CODE`  | `RECOVERY_ORIGINAL_ALREADY_ATTEMPTED`  | The recovery acted, but it already ran the original and the original reported failure.                      |
| `ORIGINAL_OUTCOME_UNKNOWN_CODE`    | `RECOVERY_ORIGINAL_OUTCOME_UNKNOWN`    | The recovery acted and did not state `originalActionAttempted` (for example, the runner).                   |
| `ORIGINAL_RETRIED_AND_FAILED_CODE` | `RECOVERY_ORIGINAL_RETRIED_AND_FAILED` | The recovery did not act; it re-ran the original and the original failed again.                             |
| `VERDICT_UNKNOWN_CODE`             | `RECOVERY_VERDICT_UNKNOWN`             | The recovery stated no verdict (a transport error, a verdict-less answer, or a 5xx that states no failure). |

`result.recovery_result` holds the parsed `RecoveryExecutorResult` behind each
stop.

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
