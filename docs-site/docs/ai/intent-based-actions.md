# Intent-Based Actions

UI Bridge lets you drive the UI with a natural language instruction instead of
an element id, and lets you register named **intents** that describe a
high-level goal in the same language.

Those are two related but separate mechanisms, and it is worth being precise
about which does what:

| Mechanism | What it is | Entry point |
| --- | --- | --- |
| **NL actions** | Parse an instruction, resolve the target element, perform the action | `NLActionExecutor` / `POST /ai/execute` |
| **Intent registry** | A named, described, searchable record of a goal, executed by feeding its `description` back through the NL executor | `POST /ai/intents/*` |

## Overview

Instead of writing:

```typescript
await actions.executeAction('ui-login-form-submit-button', { action: 'click' });
```

You can write:

```typescript
await executor.execute({ instruction: 'click the Sign In button' });
```

The parser maps the instruction onto an action verb plus a target description,
and the search engine resolves that description against the registry with a
confidence score.

## Supported Actions

`parseNLInstruction` recognises 13 action verbs. Each is matched by a set of
phrasings, and each phrasing carries its own parse confidence:

| Action        | Example phrasings                                             |
| ------------- | ------------------------------------------------------------- |
| `click`       | "click the Save button", "press Save", "tap Save"             |
| `doubleClick` | "double-click the row"                                        |
| `rightClick`  | "right-click the file", "context click the file"              |
| `type`        | "type \"user@example.com\" into the email field"              |
| `select`      | "select United States from the country dropdown"              |
| `check`       | "check the terms checkbox"                                    |
| `uncheck`     | "uncheck remember me"                                         |
| `clear`       | "clear the search input"                                      |
| `hover`       | "hover over the menu"                                         |
| `focus`       | "focus the email field"                                       |
| `scroll`      | "scroll to the footer"                                        |
| `wait`        | "wait for the results table"                                  |
| `assert`      | "assert the banner is visible"                                |

There is no `submit` or `navigate` verb. Submitting a form is `click` on its
submit control; page navigation is `POST /control/page/navigate`, and state
navigation is `POST /control/states/navigate`.

## Usage

### Basic Execution

```typescript
import { createNLActionExecutor, createActionExecutor, getGlobalRegistry } from '@qontinui/ui-bridge';

const registry = getGlobalRegistry();
const executor = createNLActionExecutor();

executor.setActionExecutor(createActionExecutor(registry));
executor.updateElements(registry.getAllElements());

await executor.execute({ instruction: 'click the login button' });
await executor.execute({ instruction: 'type "user@example.com" into email field' });
await executor.execute({ instruction: 'select "United States" from country dropdown' });
```

`updateElements` must be called whenever the registry changes — the executor
searches a snapshot, not the live DOM. The server handlers do this for you on
every request.

### With Context and a Threshold

`NLActionRequest` accepts three optional fields alongside the instruction:

```typescript
const result = await executor.execute({
  instruction: 'submit the form',
  context: 'the registration form in the main panel',
  timeout: 5000,
  confidenceThreshold: 0.8,
});
```

`context` is free text used to disambiguate; `confidenceThreshold` overrides the
executor default of `0.7`.

### Over HTTP

```http
POST /ai/execute
Content-Type: application/json

{ "instruction": "click the Sign In button", "confidenceThreshold": 0.8 }
```

The handler settles the DOM, refreshes the element set, and runs the same
executor. Passing `withDiff: true` additionally returns the semantic diff the
action produced.

### The Response

`execute` resolves to an `NLActionResponse`:

```typescript
interface NLActionResponse {
  success: boolean;
  executedAction: string; // human-readable description of what was done
  elementUsed: AIDiscoveredElement;
  confidence: number;
  elementState: ElementState;
  durationMs: number;
  timestamp: number;

  // present when success is false
  error?: string;
  errorCode?: string;
  suggestions?: string[];
  alternatives?: SearchResult[];
  failureInfo?: StructuredFailureInfo;
}
```

## Registered Intents

An `Intent` is a **description record**, not a callback. It has no `patterns`
array and no handler function — `handler` is an optional identifier string:

```typescript
interface Intent {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  params?: Record<string, IntentParam>;
  handler?: string;
}
```

Register one over HTTP:

```http
POST /ai/intents/register
Content-Type: application/json

{
  "id": "add-to-cart",
  "name": "Add to cart",
  "description": "click the Add to Cart button",
  "tags": ["commerce", "cart"]
}
```

The other four routes are `GET /ai/intents` (list),
`POST /ai/intents/find` (search by name, description or tag, with a
confidence score), `POST /ai/intents/execute` (by `intentId`) and
`POST /ai/intents/execute-from-query` (best match for a query string).

**How execution actually works** is worth stating plainly, because it bounds
what an intent can express: `executeIntent` looks the intent up, then runs its
`description` through `NLActionExecutor.execute` as if you had typed it. So an
intent's description must be a valid NL instruction, and an intent cannot
orchestrate a multi-step sequence or run arbitrary code. `params` is carried on
the record for callers to read; the executor does not interpolate it.

## Error Handling

Failures are typed. The executor emits a `UiBridgeErrorCode` — for this path
most often `UB-PARSE-ERROR`, `UB-VALIDATION-ERROR`, `UB-ELEM-NOT-FOUND` or
`UB-LOW-CONFIDENCE`:

```typescript
const result = await executor.execute({ instruction: 'click the checkout button' });

if (!result.success) {
  console.log(result.errorCode); // 'UB-ELEM-NOT-FOUND'
  console.log(result.error); // 'Could not find element matching: "checkout button"'
  console.log(result.failureInfo?.suggestedActions); // ranked RecoverySuggestion[]
  console.log(result.alternatives); // candidates that scored below threshold
}
```

See [Structured Failure Feedback](../recovery/structured-failure-feedback.md)
for the full code vocabulary.

## Configuration

`NLActionExecutorConfig` — every field is optional and merges over
`DEFAULT_EXECUTOR_CONFIG`:

```typescript
import { createNLActionExecutor } from '@qontinui/ui-bridge';

const executor = createNLActionExecutor({
  defaultConfidenceThreshold: 0.7, // minimum match confidence
  defaultTimeout: 5000, // default action timeout in ms
  maxAlternatives: 3, // alternatives returned on failure
  searchConfig: { fuzzyThreshold: 0.8 }, // forwarded to the SearchEngine
  verbose: false,
});
```

There is no retry setting: retry policy belongs to the caller, and the
`retryRecommended` flag on a structured failure tells you whether retrying is
worth it.
