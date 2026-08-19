---
sidebar_position: 2.7
---

# Bridge-Access Hooks

Five hooks from `@qontinui/ui-bridge/react` reach the
[`UIBridgeProvider`](./provider.md)'s context from anywhere below it. Two are the
façade you normally use; three are the raw context readers the SDK itself is
built on.

## useUIBridge

```typescript
function useUIBridge(): UseUIBridgeReturn
```

The main entry point. Takes no arguments; returns a façade over the registry,
the executor and the workflow engine. It subscribes to registry mutations via
`useSyncExternalStore`, so `elements`, `components` and `workflows` are live and
re-render the caller when the registry changes.

```tsx
import { useUIBridge } from '@qontinui/ui-bridge/react';

function AutomationController() {
  const bridge = useUIBridge();

  const handleSubmit = async () => {
    await bridge.executeAction('submit-btn', { action: 'click' });

    await bridge.executeComponentAction('login-form', {
      action: 'login',
      params: { email: 'user@example.com', password: 'secret' },
    });
  };

  return (
    <div>
      <p>{bridge.elements.length} elements registered</p>
      <button onClick={handleSubmit}>Automate login</button>
    </div>
  );
}
```

:::warning Actions take a request object, not a bare action name

`executeAction(elementId, request)` takes a `ControlActionRequest` —
`{ action: 'click', params?: … }` — as its second argument, not a string.
`executeComponentAction(componentId, request)` likewise takes
`{ action, params }`.

Neither throws. Without a provider they resolve to
`{ success: false, error: 'UI Bridge not available', durationMs: 0, timestamp }`,
so check `success` on the response rather than wrapping the call in `try`. That
is the opposite convention from the per-element
[`useUIElement().trigger`](./hooks-registration.md#useuielement) and
[`useUIComponent().executeAction`](./hooks-registration.md#useuicomponent),
which both throw.

:::

### Return value

```typescript
interface UseUIBridgeReturn {
  available: boolean;      // a provider is present
  initialized: boolean;    // the provider finished initialising

  // Live registry views (subscribed)
  elements: RegisteredElement[];
  components: RegisteredComponent[];
  workflows: Workflow[];

  // Snapshots
  createSnapshot: () => BridgeSnapshot;
  createSnapshotAsync: (
    batchSize?: number,
    options?: { componentBasePath?: string; getActiveTab?: () => string | null | undefined }
  ) => Promise<BridgeSnapshot>;

  // Execution
  executeAction: (elementId: string, request: ControlActionRequest) => Promise<ControlActionResponse>;
  executeComponentAction: (componentId: string, request: ComponentActionRequest) => Promise<ComponentActionResponse>;
  find: (options?: FindRequest) => Promise<FindResponse>;
  discover: (options?: FindRequest) => Promise<FindResponse>;   // deprecated alias for find

  // Workflows
  runWorkflow: (workflowId: string, request?: WorkflowRunRequest) => Promise<WorkflowRunResponse>;
  getWorkflowStatus: (runId: string) => Promise<WorkflowRunResponse | null>;
  registerWorkflow: (workflow: Workflow) => void;
  unregisterWorkflow: (id: string) => void;

  // Lookups
  getElement: (id: string) => RegisteredElement | undefined;
  getComponent: (id: string) => RegisteredComponent | undefined;
  getElementState: (id: string) => ElementState | undefined;

  // Render log (when enabled)
  captureRenderLog: () => Promise<void>;
  getRenderLogEntries: () => Promise<unknown[]>;
  clearRenderLog: () => Promise<void>;

  // Debug (when enabled)
  getMetrics: () => unknown | undefined;
  getActionHistory: () => unknown[] | undefined;

  registry: UIBridgeRegistry | null;
}
```

Notes drawn from the implementation:

- **`createSnapshot` is the method name.** There is no `captureSnapshot`.
  Without a provider it returns a well-formed empty snapshot whose
  `registration.everHadRegistrations` is `false` — which is how a caller
  distinguishes "no bridge" from "bridge present, empty page".
- **`createSnapshotAsync`** yields between batches so a large page does not block
  the main thread. `batchSize` is optional.
- **`discover` is deprecated** and simply forwards to `find`.
- **Render-log and metrics methods are safe to call when disabled**: they
  optional-chain through the absent subsystem and return `[]` / `undefined`
  rather than throwing.
- **`registry`** is the escape hatch for anything the façade does not wrap —
  event subscriptions, `createStateSnapshot()`, `getAllTransitions()`. It is
  `null` when there is no provider.

## useUIBridgeRequired

```typescript
function useUIBridgeRequired(): UseUIBridgeReturn
```

Identical to [`useUIBridge`](#useuibridge), except it calls
[`useUIBridgeContext`](#useuibridgecontext) first, so it **throws** when there is
no `UIBridgeProvider` above it:

```
Error: useUIBridgeContext must be used within a UIBridgeProvider
```

Use it in code that has no meaningful degraded behaviour, so a missing provider
fails loudly at mount instead of silently returning `available: false`.

## useUIBridgeContext

```typescript
function useUIBridgeContext(): UIBridgeContextValue
```

The raw context value. Throws the error above when used outside a provider.

`UIBridgeContextValue` is the provider's internals rather than a curated API —
`features`, `config`, `registry`, `executor`, `workflowEngine`, the optional
`renderLog` / `metrics` / `wsClient`, `wsConnectionState`, and the provider's own
`getElements` / `getComponents` / `createSnapshot`. Prefer
[`useUIBridge`](#useuibridge) unless you specifically need one of the subsystems
the façade does not expose.

## useUIBridgeOptional

```typescript
function useUIBridgeOptional(): UIBridgeContextValue | null
```

The same raw context value, returning `null` outside a provider instead of
throwing.

This is what nearly every hook in the SDK is built on, and it is why they all
degrade quietly rather than crashing an app that has not mounted a provider. Use
it when writing your own bridge-aware hook that must stay optional.

## useUIBridgeWindowLabel

```typescript
function useUIBridgeWindowLabel(): string | undefined
```

Reads the window label declared by the nearest `UIBridgeWindowProvider`, or
`undefined` when there is none.

Multi-window hosts — the qontinui runner's pop-out terminal windows are the
motivating case — declare the label once at each window's React root, and every
[`useUIElement`](./hooks-registration.md#useuielement) inside registers into that
window's bucket. Two windows can then register the same element id without
colliding.

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UIBridgeWindowProvider } from '@qontinui/ui-bridge/react';

function WindowRoot({ children }: { children: ReactNode }) {
  const label = getCurrentWindow().label; // "main" | "term-1" | …
  return <UIBridgeWindowProvider windowLabel={label}>{children}</UIBridgeWindowProvider>;
}
```

The canonical value is the real Tauri webview label from
`getCurrentWindow().label` (Tauri v2). The provider's `windowLabel` prop is typed
`string | undefined`, so passing `undefined` explicitly is legal and means the
default window.

The whole mechanism is **additive and opt-in**: single-window apps (web, mobile,
the runner's main window) never mount the provider, this hook returns
`undefined`, `useUIElement` passes no `windowLabel`, and the registry uses its
default `"main"` bucket — byte-identical to the pre-window-aware behaviour. You
rarely call this hook directly; `useUIElement` already consults it.
