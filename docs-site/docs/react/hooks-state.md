---
sidebar_position: 2.2
---

# State Hooks

Four hooks from `@qontinui/ui-bridge/react` register and observe **UI states** —
the nodes of the model UI Bridge navigates. What a state *is*, and why an app is
modelled as one, is covered in
[State Machine Integration](../state/state-machine-integration.md). States are
declared explicitly by the app rather than inferred: `useUIState` and
`useUIStateGroup` register them, and `useActiveStates` / `useStateSnapshot` read
back what is currently registered and active. This page is the reference for
the hooks.

All four require a `UIBridgeProvider` above them: they resolve the bridge with
`useUIBridgeOptional()` and degrade quietly to a no-op (`false` / `[]` / `null`)
when there is none, rather than throwing.

The edges between states are on the [transition hooks](./hooks-transitions.md)
page, and pathfinding across them on the
[navigation hooks](./hooks-navigation.md) page.

## useUIState

Registers one state and gives you its activation controls.

```tsx
import { useUIState } from '@qontinui/ui-bridge/react';

function LoginModal() {
  const { isActive, activate, deactivate } = useUIState({
    id: 'login-modal',
    name: 'Login Modal',
    blocking: true,
    elements: ['login-email', 'login-password', 'login-submit'],
  });

  if (!isActive) return null;

  return (
    <div className="modal">
      <button onClick={deactivate}>Close</button>
    </div>
  );
}
```

### Options

`UseUIStateOptions`:

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `id` | `string` | — | **Required.** Unique state identifier; the registry keys on it |
| `name` | `string` | — | **Required.** Human-readable name |
| `elements` | `string[]` | `[]` | Element ids belonging to this state |
| `activeWhen` | `() => boolean` | — | Predicate the registry can call to detect activity |
| `blocking` | `boolean` | — | If true, blocks other state activations (modal behaviour) |
| `blocks` | `string[]` | — | Specific state ids this state blocks |
| `group` | `string` | — | Group membership |
| `pathCost` | `number` | `1.0` (registry default) | Cost used by pathfinding |
| `metadata` | `IRMetadata \| Record<string, unknown>` | — | Custom metadata; see the annotation note below |
| `requiredElements` | `IRElementCriteria[]` | — | IR-canonical element criteria; **wins over `elements`** when both are given |
| `provenance` | `IRProvenance` | — | Where the declaration came from; set by build plugins |
| `autoRegister` | `boolean` | `true` | Register on mount |
| `initialActive` | `boolean` | `false` | Activate immediately after registering |

:::note `requiredElements` supersedes `elements`

When `requiredElements` is non-empty the hook ignores `elements` entirely and
builds the element list from the `id` field of each criteria object. Criteria
without an `id` are descriptive-only — they contribute nothing to the runtime
element list, because they are meant to be resolved by the build plugin at IR
time, not by this hook.

:::

:::note `metadata` only becomes an annotation when it is IR-shaped

The hook mirrors `metadata` into the global annotation store — keyed by each of
this state's element ids — **only** when every key of the object is one of
`description`, `purpose`, `tags`, `relatedElements`, `notes`. The check is
deliberately conservative: one unknown key and the object is treated as opaque
legacy metadata, stored on the state but written to no annotation. An empty
object also fails the check. To attach semantics to a single element instead,
use [`useUIAnnotation`](./hooks-semantics.md#useuiannotation).

:::

### Return value

```typescript
interface UseUIStateReturn {
  registered: boolean;          // registration has happened
  isActive: boolean;            // this state is currently active
  activate: () => boolean;      // returns whether the registry accepted it
  deactivate: () => boolean;
  toggle: () => boolean;        // deactivate() if active, else activate()
  activeStates: string[];       // all active state ids, as of the last event
  register: () => void;         // manual registration (for autoRegister: false)
  unregister: () => void;
  state: UIState | undefined;   // the registry's copy of this state
}
```

`activate` / `deactivate` / `toggle` return `false` when there is no bridge, and
otherwise return whatever the registry decided — an activation blocked by
another state's `blocking` flag returns `false`.

### Reacting to option changes

Changing options on a mounted hook does **not** re-register: the hook writes the
new values into the registry in place, so subscribers are not woken by a
spurious `element:registered` event. The exception is `id` — the registry keys
on it, so changing `id` unregisters the old id and registers the new one.

`activeWhen` is excluded from the change key (function identity is unstable),
but the latest closure is written into the registry copy on every sync, so the
predicate never goes stale.

## useUIStateGroup

Registers a set of states that activate and deactivate together.

```tsx
import { useUIStateGroup } from '@qontinui/ui-bridge/react';

function NavigationSection() {
  const { activate, deactivate } = useUIStateGroup({
    id: 'nav-group',
    name: 'Navigation',
    states: ['nav-home', 'nav-about', 'nav-contact'],
  });
}
```

### Options

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `id` | `string` | — | **Required.** Unique group identifier |
| `name` | `string` | — | **Required.** Human-readable name |
| `states` | `string[]` | — | **Required.** State ids in this group |
| `autoRegister` | `boolean` | `true` | Register on mount |

### Return value

```typescript
interface UseUIStateGroupReturn {
  registered: boolean;
  activate: () => string[];      // ids the registry actually activated
  deactivate: () => string[];    // ids the registry actually deactivated
  register: () => void;
  unregister: () => void;
  group: UIStateGroup | undefined;
}
```

Both `activate` and `deactivate` return `[]` when no bridge is present. Unlike
`useUIState`, this hook exposes no `isActive` — a group has no activation state
of its own, only its member states do.

## useActiveStates

Subscribes to the ids of every currently active state.

```tsx
import { useActiveStates } from '@qontinui/ui-bridge/react';

function StateBadge() {
  const active = useActiveStates();
  return <span>{active.join(', ') || 'no active state'}</span>;
}
```

Takes no arguments and returns `string[]`. It is built on
`useSyncExternalStore` over the registry's `element:stateChanged` event, and
caches the array between notifications so the identity is stable across renders
(the registry hands back a fresh array on every call). Returns `[]` when there
is no bridge.

This is the hook to reach for when you want a component to **re-render** on
state changes. `useUIState().activeStates` carries the same information but only
for a component that already registers a state.

## useStateSnapshot

Reads everything the state manager knows, in one object.

```tsx
import { useStateSnapshot } from '@qontinui/ui-bridge/react';

function StateDebugPanel() {
  const snapshot = useStateSnapshot();
  if (!snapshot) return <p>UI Bridge not available</p>;

  return (
    <pre>
      {snapshot.states.length} states · {snapshot.transitions.length} transitions
      {'\n'}active: {snapshot.activeStates.join(', ')}
    </pre>
  );
}
```

Returns `StateSnapshot | null` — `null` when there is no bridge.

```typescript
interface StateSnapshot {
  timestamp: number;
  activeStates: string[];
  states: UIState[];
  groups: UIStateGroup[];
  transitions: UITransition[];
}
```

:::warning This snapshot does not refresh on state changes

The value is memoized on the bridge context alone. It is computed on the first
render and then returned unchanged for the lifetime of the provider — a
re-render caused by anything else will **not** recompute it, and the hook
subscribes to no registry event, so activating a state neither refreshes the
object nor re-renders the component.

Treat it as a one-shot read taken at mount. For a live view, call
`useUIBridge().registry.createStateSnapshot()` at the moment you need it, driven
by a hook that does subscribe — [`useActiveStates`](#useactivestates) or
[`useAvailableTransitions`](./hooks-transitions.md#useavailabletransitions).

:::
