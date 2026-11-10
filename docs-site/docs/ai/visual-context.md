# Visual Context

Visual Context is UI Bridge's answer to "what is on the screen right now, in a
form an LLM can read". It comes in two layers, and they are answered by
different processes:

| Layer | What it produces | Who answers |
| --- | --- | --- |
| **Semantic** | Structured, text-only snapshots, diffs and summaries of the registry | The SDK, in-page |
| **Pixel** | Screenshots, OCR, VLM captions, visual baselines | The runner, over `/vision/*` |

Everything in the semantic layer works with no runner attached. The pixel layer
needs one — see [Pixel-level vision](#pixel-level-vision) below.

## Semantic Snapshots

`SemanticSnapshotManager` turns a control snapshot into an AI-readable
`SemanticSnapshot`: every element with a generated description and aliases,
plus form state, modal state, focus, and a prose summary.

```typescript
import { createSnapshotManager, getGlobalRegistry } from '@qontinui/ui-bridge';

const registry = getGlobalRegistry();
const snapshots = createSnapshotManager();

const snapshot = snapshots.createSnapshot(registry.createSnapshot());

console.log(snapshot.summary); // LLM-readable prose
console.log(snapshot.elementCounts); // { button: 4, input: 2, link: 7, ... }
console.log(snapshot.focusedElement); // 'email-input'
```

Over HTTP: `GET /ai/snapshot` (add `?includeForms=true` for DOM-level form
detail).

### The Snapshot Shape

```typescript
interface SemanticSnapshot {
  timestamp: number;
  snapshotId: string;
  page: PageContext;
  elements: AIDiscoveredElement[];
  forms: FormState[];
  activeModals: ModalState[];
  focusedElement?: string;
  summary: string;
  elementCounts: Record<string, number>;
  formsDetail?: FormsResponse; // only when includeForms is set
  networkActivity?: { inFlightCount: number /* … */ };
}
```

### Snapshot History

The manager keeps a bounded history so you can diff against an earlier state:

```typescript
snapshots.getLastSnapshot(); // SemanticSnapshot | null
snapshots.getSnapshot(snapshotId); // by id
snapshots.getHistory(); // SemanticSnapshot[]
snapshots.clearHistory();
```

For a named point you want to come back to, the server exposes snapshot
bookmarks: `POST /ai/bookmarks`, `GET /ai/bookmarks`,
`GET /ai/bookmarks/:name`, `GET /ai/bookmarks/:name/diff`,
`DELETE /ai/bookmarks/:name`.

## Page Summary

For prompts where a full snapshot is too much, `generatePageSummary` produces a
compact prose description. It returns **a plain string** — there is no
structured summary object:

```typescript
import { generatePageSummary } from '@qontinui/ui-bridge';

const summary = generatePageSummary(elements, { title: 'Login', pageType: 'form' });
console.log(summary);
// Page: "Login"
// Type: Form
// 2 inputs, 1 button, 1 link
// …
```

Over HTTP: `GET /ai/summary`, whose `data` field is that string. The handler
falls back to a DOM scan when the registry is empty, so an unregistered page
still yields a summary.

`generateSnapshotSummary` does the same for an existing `SemanticSnapshot`, and
`serializeSnapshot` renders one to a compact transport form.

## Semantic Diffs

`SemanticDiffManager` answers "what changed" between two snapshots:

```typescript
import { createSnapshotManager, createDiffManager, getGlobalRegistry } from '@qontinui/ui-bridge';

const registry = getGlobalRegistry();
const snapshots = createSnapshotManager();
const diffs = createDiffManager();

diffs.update(snapshots.createSnapshot(registry.createSnapshot())); // seeds; returns null

await clickSomething();

const diff = diffs.update(snapshots.createSnapshot(registry.createSnapshot()));
console.log(diff?.summary); // prose description of the change
console.log(diff?.changes.appeared, diff?.changes.disappeared, diff?.changes.modified);
```

`diffFrom(snapshot)` diffs an arbitrary earlier snapshot against the latest one,
and `reset()` clears the baseline. Two helpers make the result easy to gate on:

```typescript
import { hasSignificantChanges, describeDiff } from '@qontinui/ui-bridge';

if (hasSignificantChanges(diff)) {
  console.log(describeDiff(diff));
}
```

Over HTTP: `GET /ai/diff` (diff since the previous call),
`POST /ai/scoped-diff`, `POST /ai/summarize-diff`, and
`POST /ai/execute-with-diff` to perform an action and get its diff in one
round trip.

The response's `success` is the action's verdict. A failed action answers
`{ success: false, error, code, data }`, with the inner action's error and
code on the envelope and the full result — `actionSuccess: false`,
`actionResult`, and the diff around the failure — kept under `data`. Both the
in-process server and the relay path answer this way.

## Configuration

`SemanticSnapshotConfig` — merged over `DEFAULT_SNAPSHOT_CONFIG`:

```typescript
import { createSnapshotManager } from '@qontinui/ui-bridge';

const snapshots = createSnapshotManager({
  analyzeForms: true, // detect and summarise forms
  detectModals: true, // detect blocking modals
  inferPageType: true, // classify the page (form, list, detail, …)
  generateDescriptions: true, // generate element descriptions
  useAnnotations: true, // merge in the annotation store
  includeForms: false, // attach DOM-level form discovery detail
  maxElements: 500, // hard element cap
  maxTokens: 0, // token budget; 0 = unlimited
});
```

`SemanticDiffConfig` — merged over `DEFAULT_DIFF_CONFIG`:

```typescript
import { createDiffManager } from '@qontinui/ui-bridge';

const diffs = createDiffManager({
  ignoreInsignificant: true,
  trackedProperties: ['visible', 'enabled', 'focused', 'checked', 'value', 'textContent'],
  generateSuggestions: true,
  maxModifications: 20,
});
```

There is no `includePositions` / `includeBoundingBoxes` / `textFormat` option:
element geometry is already carried on each element, and the output format is
fixed.

## Pixel-Level Vision

Screenshots and anything derived from them are **runner-direct**. The route
table is the single source of truth, so the SDK ships stubs for twelve of the
thirteen `/vision/*` routes that return `RUNNER_REQUIRED` when no runner is
mounted:

| Route | Purpose |
| --- | --- |
| `POST /vision/capture` | Capture a screenshot |
| `POST /vision/annotate` | Capture with element overlays drawn |
| `POST /vision/diff` | Pixel diff against a previous capture |
| `POST /vision/raw` | Raw capture, no post-processing |
| `POST /vision/extract` | OCR — visible text with bounding boxes |
| `POST /vision/describe` | VLM caption of the capture |
| `POST /vision/analyze` | Declarative analyzers (layout, typography, colour, …) |
| `POST /vision/assert` | The visual assertion DSL — evaluated in the tab without a runner (below) |
| `POST /vision/baseline` | Record a visual baseline |
| `GET /vision/baselines` | List recorded baselines |
| `POST /vision/mutation-occurred` | Frontend → runner mutation signal |
| `GET /vision/cache/:sha256` | Stream a cached capture |
| `GET /vision/health` | Vision pipeline health |

### `POST /vision/assert` without a runner

The relay (`createRelayHandlers`) and the in-process handlers
(`createHandlers`) evaluate `/vision/assert` **in the tab**. Five kinds read
only what the page itself can measure, and they get a verdict:

| Kind | What the tab measures |
| --- | --- |
| `contrast_meets_wcag` | The text colour against the backdrop composited under its first rendered text run; WCAG large-text thresholds (AA 3:1 / AAA 4.5:1 at 24px, or 18.66px bold) |
| `text_fits_container` | The nearest block box's `scrollWidth`/`scrollHeight` (borders and scrollbars included) against its border box, rounded up; an element with no text is `unknown` |
| `no_overlap` | Border boxes, after the `tolerance_px` inset |
| `element_above` | Paint order from `document.elementsFromPoint` inside the pair's visible intersection (never scrolls) |
| `no_clipping` | Each registered element against the padding box of its nearest clipping ancestor; no element inside a clipping ancestor is `unknown` |

The evaluator is a port of the runner's (vision-core) and is held to it by
vision-core's own conformance fixture, so both paths give the same answer. Every
other kind answers per result with `outcome: "unknown"` and
`code: "capability_unavailable_in_build"`. A mixed batch still answers what it
can. Anything the page cannot decide is `unknown` with a code, never `passed`:
a gradient or image under the text, a hit test that cannot show both elements,
an element with no box. An empty assertion list is `unknown` with
`unknownCodes: ["no_results"]`. A malformed body is refused with
`UB-VALIDATION-ERROR` before anything reaches the tab, and so is a
caller-supplied `snapshot`: the tab measures the live page.

A capture result (`capture`, `annotate`, `diff`, `raw`) names its bytes by
`url`, whose literal value is the relative HTTP path
`/ui-bridge/vision/cache/<sha256>`, never by a host file path. `sha256` is the
hash of the route's cache key, not of the image bytes (for `capture` and
`annotate` the key is `v=1|mut=<mutation counter>|req=<request>`; `raw` and
`diff` use their own keys).

The runner contract the SDK's types target also accepts `inline: true` on
`capture`, `annotate` or `raw`, which returns the encoded image as `base64` in
the same response. Over the runner's fixed 5 MiB inline cap
(`INLINE_MAX_BYTES`) it answers HTTP 413 `INLINE_TOO_LARGE`, whose `hint`
carries `url`, `bytes` and `maxBytes`, instead of a truncated string. A runner that predates this contract ignores `inline`.

These replaced the older `/control/*screenshot*` routes. The `/ai/media/*`
routes were retired without a successor: image facts arrive on `find`'s media
rows.
`POST /vision/describe` can fail its structured-parse step and return prose with
`structured: null`; that case is reported as `UB-VLM-STRUCTURED-PARSE-FAIL`.
