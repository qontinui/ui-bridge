# AI Features Overview

UI Bridge provides AI-native capabilities for intelligent UI automation: natural
language actions, ranked semantic element search, LLM-readable page snapshots
and diffs, and state-graph navigation.

Everything on this page ships in `@qontinui/ui-bridge` today, and every
capability has a matching HTTP route so an agent driving the bridge over HTTP
gets the same surface as an importer.

## Key Capabilities

### Natural Language Actions

Execute an instruction written in prose — the executor parses it, searches the
registry for the target, and performs the action:

```typescript
import { createNLActionExecutor, createActionExecutor, getGlobalRegistry } from '@qontinui/ui-bridge';

const registry = getGlobalRegistry();
const executor = createNLActionExecutor();

executor.setActionExecutor(createActionExecutor(registry));
executor.updateElements(registry.getAllElements());

const result = await executor.execute({ instruction: 'click the Sign In button' });
// result.success, result.executedAction, result.confidence, result.failureInfo
```

Over HTTP: `POST /ai/execute`.

[Learn more about Natural Language Actions](./intent-based-actions.md)

### Semantic Element Search

Find elements by description rather than by selector. The `SearchEngine` ranks
every registered element against the query and returns confidence-scored
candidates:

```typescript
import { createSearchEngine, find, getGlobalRegistry } from '@qontinui/ui-bridge';

const engine = createSearchEngine();
engine.updateElements(getGlobalRegistry().getAllElements());

const result = find('email input field', engine);
// FindResultMatch | FindResultAmbiguous | FindResultNotFound
```

The engine also exposes narrower entry points — `findByText`, `findByRole`,
`findByAccessibleName`, `findNear`, `findWithin` and `findBest`.

Over HTTP: `POST /ai/find`, `POST /ai/search`, and `POST /ai/semantic-search`
for the similarity-scored variant.

### Visual Context

Generate an LLM-readable snapshot of the current UI, and diff two snapshots to
see what an action changed:

```typescript
import { createSnapshotManager, createDiffManager, getGlobalRegistry } from '@qontinui/ui-bridge';

const registry = getGlobalRegistry();
const snapshots = createSnapshotManager();
const diffs = createDiffManager();

const snapshot = snapshots.createSnapshot(registry.createSnapshot());
const diff = diffs.update(snapshot); // null on the first snapshot
```

Over HTTP: `GET /ai/snapshot`, `GET /ai/diff`, `GET /ai/summary`.

[Learn more about Visual Context](./visual-context.md)

### Navigation Assistance

Ask whether a target state is reachable, get the transition path to it, and
execute that path:

```tsx
import { useUINavigation, useNavigationPath } from '@qontinui/ui-bridge';

function CheckoutButton() {
  const { navigateTo, isNavigating } = useUINavigation();
  const path = useNavigationPath(['checkout']);

  return (
    <button onClick={() => navigateTo(['checkout'])} disabled={!path.found || isNavigating}>
      Checkout ({path.estimatedSteps} steps)
    </button>
  );
}
```

Over HTTP: `POST /control/states/find-path`, `POST /control/states/navigate`.

[Learn more about Navigation Assistance](./navigation-assistance.md)

## Architecture

The AI features are layered on top of the core registry:

1. **Registry snapshot** — `registry.createSnapshot()` is the single source of
   element truth. Every AI module consumes it; none of them touch the DOM
   directly.
2. **Search** — `SearchEngine` scores elements against a `SearchCriteria`,
   producing ranked `SearchResult`s with confidence values.
3. **Action** — `NLActionExecutor` parses an instruction into a `ParsedAction`,
   resolves the target through the search engine, and delegates the actual DOM
   work to an `ActionExecutor`.
4. **Semantics** — `SemanticSnapshotManager` enriches a control snapshot with
   descriptions, aliases and form state; `SemanticDiffManager` turns two of
   those into a change report.
5. **Diagnostics** — every failure carries a `UiBridgeErrorCode` and machine-
   readable recovery suggestions.

## Getting Started

The AI modules are constructed by `createHandlers()` on the server side, so an
app that already serves the control API needs no extra setup. In React, mount
the provider and enable the control feature:

```tsx
import { UIBridgeProvider } from '@qontinui/ui-bridge';

function App({ children }: { children: React.ReactNode }) {
  return (
    <UIBridgeProvider features={{ control: true }} config={{ serverPort: 9876 }}>
      {children}
    </UIBridgeProvider>
  );
}
```

`UIBridgeProvider` takes `features`, `config`, `onEvent`, `onBrowserEvent` and
`browserCaptureConfig`. There is no `enableAI` flag: the AI endpoints are part
of the handler set, not a provider toggle.

## Structured Failures

When an AI action fails, the response carries a stable error code, the
candidates that were considered, and ranked recovery suggestions.

[Learn more about Structured Failure Feedback](../recovery/structured-failure-feedback.md)

## API Reference

See the [AI API Endpoints](../api/ai-endpoints.md) documentation for the
complete REST API reference.
