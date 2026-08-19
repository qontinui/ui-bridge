---
sidebar_position: 2.3
---

# Transition Hooks

Three hooks from `@qontinui/ui-bridge/react` register and observe **transitions**
— the edges of the model, describing how the app moves from one set of
[states](./hooks-state.md) to another. The modelling itself is covered in
[State Machine Integration](../state/state-machine-integration.md#define-transitions);
this page is the reference for the hooks.

Executing a transition by name is this page. Getting from wherever you are to a
target state, by pathfinding over these edges, is
[navigation](./hooks-navigation.md).

All three resolve the bridge with `useUIBridgeOptional()` and degrade to a
no-op result when there is no `UIBridgeProvider` above them.

## useUITransition

Registers one transition and tells you whether it can run right now.

```tsx
import { useUITransition } from '@qontinui/ui-bridge/react';

function OpenModalButton() {
  const { canExecute, execute } = useUITransition({
    id: 'open-login-modal',
    name: 'Open Login Modal',
    fromStates: ['dashboard'],
    activateStates: ['login-modal'],
    exitStates: [],
  });

  return (
    <button onClick={execute} disabled={!canExecute}>
      Login
    </button>
  );
}
```

### Options

`UseUITransitionOptions`:

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `id` | `string` | — | **Required.** Unique transition identifier |
| `name` | `string` | — | **Required.** Human-readable name |
| `fromStates` | `string[]` | — | **Required.** Precondition — at least one must be active |
| `activateStates` | `string[]` | — | **Required.** States to activate |
| `exitStates` | `string[]` | — | **Required.** States to deactivate |
| `activateGroups` | `string[]` | — | Groups to activate |
| `exitGroups` | `string[]` | — | Groups to deactivate |
| `actions` | `WorkflowStep[]` | — | Actions executed during the transition |
| `pathCost` | `number` | — | Cost used by pathfinding |
| `staysVisible` | `boolean` | — | Whether source states remain visible during the transition |
| `effect` | `IREffect` | — | Side-effect annotation; see below |
| `metadata` | `IRMetadata` | — | IR-canonical semantic metadata |
| `provenance` | `IRProvenance` | — | Where the declaration came from; set by build plugins |
| `autoRegister` | `boolean` | `true` | Register on mount |

`fromStates`, `activateStates` and `exitStates` are all required by the type —
pass `[]` explicitly for the ones that do not apply, as the example above does
for `exitStates`.

:::note `effect`, `metadata` and `provenance` are authoring-time only

The three IR fields do not change runtime behaviour. When any of them is
supplied, the hook packs them into the registered transition's `metadata` bag
under an `__ir` key, which the registry round-trips untouched. Only the build
plugin and the counterfactual-analysis pipeline read it. In particular, marking
a transition as destructive via `effect` does not stop this hook from executing
it — it gates *automatic* walks, not your own `execute()` call.

:::

### Return value

```typescript
interface UseUITransitionReturn {
  registered: boolean;
  canExecute: boolean;                        // recomputed on every state change
  execute: () => Promise<TransitionResult>;
  register: () => void;
  unregister: () => void;
  transition: UITransition | undefined;
}
```

`execute()` never rejects. Without a bridge it resolves to a failed
`TransitionResult`:

```typescript
{
  success: false,
  activatedStates: [],
  deactivatedStates: [],
  error: 'UI Bridge not available',
  durationMs: 0,
}
```

Otherwise it returns whatever the registry's `executeTransition` produced:

```typescript
interface TransitionResult {
  success: boolean;
  activatedStates: string[];
  deactivatedStates: string[];
  error?: string;
  failedPhase?: string;   // which phase failed, when it did
  durationMs: number;
}
```

`canExecute` is seeded at registration and then refreshed on every
`element:stateChanged` event — but the subscription only attaches once
`registered` is true, so a hook mounted with `autoRegister: false` reports
`false` until you call `register()` yourself.

### Reacting to option changes

Like [`useUIState`](./hooks-state.md#useuistate), changing options on a mounted
hook updates the registry in place rather than re-registering; changing `id`
re-registers under the new id. `actions` is excluded from the change key
(it contains functions) but the latest array is written into the registry on
every sync.

## useTransitions

Reads every registered transition.

```tsx
import { useTransitions } from '@qontinui/ui-bridge/react';

function TransitionList() {
  const transitions = useTransitions();
  return (
    <ul>
      {transitions.map((t) => (
        <li key={t.id}>{t.name}</li>
      ))}
    </ul>
  );
}
```

Takes no arguments, returns `UITransition[]`, and `[]` without a bridge.

:::warning This list does not refresh as transitions register

The value is memoized on the bridge context alone, so it is computed on the
first render and returned unchanged afterwards. A transition registered by a
component that mounts later will not appear, and this hook subscribes to no
registry event, so it never triggers a re-render on its own.

Use it for a one-shot read from a component that mounts after the graph is
built. For a live list, subscribe with
[`useAvailableTransitions`](#useavailabletransitions) (which does), or read
`useUIBridge().registry.getAllTransitions()` at the moment you need it.

:::

## useAvailableTransitions

Subscribes to the transitions whose preconditions are satisfied **right now**.

```tsx
import { useAvailableTransitions } from '@qontinui/ui-bridge/react';

function NextSteps() {
  const available = useAvailableTransitions();

  if (available.length === 0) return <p>Nothing to do from here.</p>;

  return (
    <ul>
      {available.map((t) => (
        <li key={t.id}>{t.name}</li>
      ))}
    </ul>
  );
}
```

Takes no arguments, returns `UITransition[]`, and `[]` without a bridge.

Unlike [`useTransitions`](#usetransitions), this hook is a real subscription: it
uses `useSyncExternalStore` over the registry's `element:stateChanged` event,
and recomputes by filtering every registered transition through
`canExecuteTransition`. The result is cached between notifications so its
identity is stable across renders.

The filtering runs on every state change and touches every registered
transition. On a large graph, prefer a single `useAvailableTransitions()` high
in the tree over one per menu item.
