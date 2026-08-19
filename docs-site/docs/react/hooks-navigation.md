---
sidebar_position: 2.4
---

# Navigation Hooks

Three hooks from `@qontinui/ui-bridge/react` drive **pathfinding** over the state
graph: given a set of target [states](./hooks-state.md), find a chain of
[transitions](./hooks-transitions.md) that reaches them, and optionally execute
it. The idea is introduced in
[State Machine Integration](../state/state-machine-integration.md#state-navigation);
this page is the reference for the hooks.

All three resolve the bridge with `useUIBridgeOptional()` and return a
not-found / unavailable result when there is no `UIBridgeProvider` above them.

## useUINavigation

The full navigation surface: inspect a path, then walk it.

```tsx
import { useUINavigation } from '@qontinui/ui-bridge/react';

function NavigationController() {
  const { navigateTo, findPath, isNavigating } = useUINavigation();

  const goToDashboard = async () => {
    const path = findPath(['dashboard']);
    if (!path.found) return;

    const result = await navigateTo(['dashboard']);
    if (!result.success) console.error(result.error);
  };

  return (
    <button onClick={goToDashboard} disabled={isNavigating}>
      Go to Dashboard
    </button>
  );
}
```

Takes no arguments.

### Return value

```typescript
interface UseUINavigationReturn {
  available: boolean;            // a UIBridgeProvider is present
  isNavigating: boolean;         // a navigateTo() call is in flight
  lastResult: NavigationResult | null;
  findPath: (targetStates: string[]) => PathResult;
  navigateTo: (targetStates: string[]) => Promise<NavigationResult>;
  activeStates: string[];
}
```

`findPath` is synchronous and side-effect free — it plans, it does not move.

```typescript
interface PathResult {
  found: boolean;
  transitions: string[];   // transition IDs, in execution order
  totalCost: number;
  targetStates: string[];
  estimatedSteps: number;
}
```

`navigateTo` never rejects; it resolves to a `NavigationResult` in every case,
including a failure result carrying `error: 'UI Bridge not available'` when
there is no provider. `isNavigating` is true for the duration of the call and is
cleared in a `finally`, so a throw inside the registry cannot leave it stuck on.

```typescript
interface NavigationResult {
  success: boolean;
  path: PathResult;               // the path that was followed
  executedTransitions: string[];
  finalActiveStates: string[];
  error?: string;
  durationMs: number;
}
```

:::warning `activeStates` on this hook is a one-shot read

Unlike the rest of the return value, `activeStates` is memoized on the bridge
context alone: it is captured on the first render and never recomputed, and this
hook subscribes to no registry event. It is *not* a live view of the active
states, and after a `navigateTo()` it will still show the pre-navigation set.

Read the fresh set from `result.finalActiveStates` after navigating, or
subscribe with [`useActiveStates`](./hooks-state.md#useactivestates).

:::

## useCanNavigateTo

A boolean "can I get there from here?", for disabling controls.

```tsx
import { useCanNavigateTo } from '@qontinui/ui-bridge/react';

function DashboardLink() {
  const canNavigate = useCanNavigateTo(['dashboard']);

  return <button disabled={!canNavigate}>Dashboard</button>;
}
```

| Parameter | Type | Meaning |
|-----------|------|---------|
| `targetStates` | `string[]` | The states you want to reach |

Returns `boolean` — the `found` field of an internal `findPath`, and `false`
when there is no bridge.

:::warning Recomputation is driven by the array's identity, not by state changes

The result is memoized on `[bridge, targetStates]`. There is no subscription to
`element:stateChanged`, so what decides whether the answer is fresh is the
identity of the array you pass:

- An **inline array literal** (`useCanNavigateTo(['dashboard'])`) is a new array
  on every render, so the path is recomputed on every render of your component —
  correct, but it re-runs pathfinding each time.
- A **memoized or module-level array** is stable, so the value is computed once
  and never refreshed — it will go stale as soon as the active states change.

Pass an inline literal unless you have measured a pathfinding cost, and when you
do hoist the array, drive re-renders yourself with
[`useActiveStates`](./hooks-state.md#useactivestates).

:::

## useNavigationPath

The whole planned path for a target, without executing it.

```tsx
import { useNavigationPath } from '@qontinui/ui-bridge/react';

function PathDisplay() {
  const path = useNavigationPath(['checkout']);

  if (!path.found) return <p>Cannot reach checkout from here</p>;

  return (
    <p>
      {path.transitions.join(' -> ')} (cost {path.totalCost})
    </p>
  );
}
```

| Parameter | Type | Meaning |
|-----------|------|---------|
| `targetStates` | `string[]` | The states you want to reach |

Returns `PathResult` (shape above). Without a bridge it returns a not-found
result that echoes your `targetStates` back:
`{ found: false, transitions: [], totalCost: 0, targetStates, estimatedSteps: 0 }`.

:::warning The doc comment promises live updates; the code does not deliver them

The hook's own source comment says it "updates when active states change". It
does not: like [`useCanNavigateTo`](#usecannavigateto), it is a `useMemo` on
`[bridge, targetStates]` with no event subscription, so the same
array-identity caveat applies — inline literals recompute every render, hoisted
arrays never do.

:::
