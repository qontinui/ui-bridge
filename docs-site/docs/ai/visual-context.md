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
table is the single source of truth, so the SDK ships stubs for all thirteen
`/vision/*` routes that return `RUNNER_REQUIRED` when no runner is mounted:

| Route | Purpose |
| --- | --- |
| `POST /vision/capture` | Capture a screenshot |
| `POST /vision/annotate` | Capture with element overlays drawn |
| `POST /vision/diff` | Pixel diff against a previous capture |
| `POST /vision/raw` | Raw capture, no post-processing |
| `POST /vision/extract` | OCR — visible text with bounding boxes |
| `POST /vision/describe` | VLM caption of the capture |
| `POST /vision/analyze` | Declarative analyzers (layout, typography, colour, …) |
| `POST /vision/assert` | The visual assertion DSL |
| `POST /vision/baseline` | Record a visual baseline |
| `GET /vision/baselines` | List recorded baselines |
| `POST /vision/mutation-occurred` | Frontend → runner mutation signal |
| `GET /vision/cache/:sha256` | Stream a cached capture |
| `GET /vision/health` | Vision pipeline health |

These replaced the older `/control/*screenshot*` and `/ai/media/*` routes.
`POST /vision/describe` can fail its structured-parse step and return prose with
`structured: null`; that case is reported as `UB-VLM-STRUCTURED-PARSE-FAIL`.
