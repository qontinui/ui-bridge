# State Machine Integration

UI Bridge models an application as a set of **states** and the **transitions**
between them, so an agent can ask "where am I" and "how do I get to X" instead
of hard-coding a click sequence.

There are two implementations of that idea, and they live in different
packages. Which one you want depends on whether your app can declare its own
states.

| | Registry state model | Standalone `StateMachine` |
| --- | --- | --- |
| Package | `@qontinui/ui-bridge` | `@qontinui/ui-bridge-auto` |
| States come from | your app declaring them (`useUIState`, `<State>`) | element queries evaluated against a registry |
| Active state set | tracked by the registry | tracked by the machine, driven by `StateDetector` |
| HTTP surface | `/control/states/*`, `/control/transitions` | none — it is a library, not a route |
| Needs app changes | yes | no |

The rest of this page covers the registry model first, because it is what the
React hooks and the control API expose. The standalone machine is covered under
[The standalone StateMachine](#the-standalone-statemachine).

:::info Package boundary
`StateMachine` is **not** an export of `@qontinui/ui-bridge`. It ships in the
separately published sibling package `@qontinui/ui-bridge-auto` (0.1.7), which
was extracted from this repository at commit `1499707`. Importing it from
`@qontinui/ui-bridge` will fail at resolution time.
:::

## Basic Setup

### Define States

A state is a named condition of the UI plus a predicate for when it is active.
In React, declare one per component with `useUIState`:

```tsx
import { useUIState } from '@qontinui/ui-bridge';

function LoginForm({ user }: { user: User | null }) {
  const { isActive, activate, deactivate } = useUIState({
    id: 'logged-out',
    name: 'Logged Out',
    activeWhen: () => user === null,
    elements: ['email-input', 'password-input', 'login-btn'],
    group: 'auth',
    pathCost: 1,
  });

  return isActive ? <form>…</form> : null;
}
```

`useUIState` returns `{ registered, isActive, activate, deactivate, toggle,
activeStates, register, unregister, state }`. A `blocking: true` state behaves
as a modal: it suppresses other state activations while it is active.

Several states can be active at once — the model tracks an active **set**, not
a single current state. `useActiveStates()` gives you that set, and
`useStateSnapshot()` gives you the whole picture (states, groups, transitions,
active ids) in one object.

Over HTTP: `GET /control/states`, `GET /control/states/active`,
`GET /control/states/snapshot`, `GET /control/state/:id`,
`POST /control/state/:id/activate`, `POST /control/state/:id/deactivate`.

### Define Transitions

A transition is an edge: which states must be active for it to be available,
which states it activates and exits, what it costs, and the actions that carry
it out.

```tsx
import { useUITransition } from '@qontinui/ui-bridge';

function LoginButton() {
  const { canExecute, execute } = useUITransition({
    id: 'log-in',
    name: 'Log in',
    fromStates: ['logged-out'],
    activateStates: ['logged-in', 'dashboard'],
    exitStates: ['logged-out'],
    pathCost: 1,
    actions: [
      { id: 'fill-email', type: 'element-action', target: 'email-input', action: 'type' },
      { id: 'fill-password', type: 'element-action', target: 'password-input', action: 'type' },
      { id: 'submit', type: 'element-action', target: 'login-btn', action: 'click' },
    ],
  });

  return (
    <button disabled={!canExecute} onClick={() => execute()}>
      Log in
    </button>
  );
}
```

`fromStates` is an **any-of** precondition: the transition is executable when at
least one of them is active. `actions` are `WorkflowStep`s — the same step shape
the workflow engine runs, with `type` one of `element-action`,
`component-action`, `wait`, `assert`, `navigate`, `branch`, `loop`, `extract`,
`log` or `custom`. `execute()` resolves to a `TransitionResult` carrying
`activatedStates`, `deactivatedStates` and any error.

`pathCost` is what pathfinding minimises, so give expensive or destructive
edges a higher cost. `effect` annotates a transition as destructive, which
excludes it from automatic regression walks.

Over HTTP: `GET /control/transitions`,
`GET /control/transition/:id/can-execute`,
`POST /control/transition/:id/execute`.

See [Transition Hooks](../react/hooks-transitions.md) for the full hook
reference, including `useTransitions` and `useAvailableTransitions`.

## State Detection

The active set is derived from each state's `activeWhen` predicate, re-evaluated
as the registry changes. Read it rather than tracking it yourself:

```tsx
import { useActiveStates, useStateSnapshot } from '@qontinui/ui-bridge';

function StatusBar() {
  const active = useActiveStates(); // string[]
  const snapshot = useStateSnapshot(); // StateSnapshot | null

  return <span>{active.join(', ')} ({snapshot?.transitions.length ?? 0} transitions)</span>;
}
```

Over HTTP: `GET /control/states/active` and `GET /control/state-summary`.

## State Navigation

Navigation is pathfinding over the transition graph: give it the states you want
active, and it finds the cheapest chain of transitions that reaches them.

```tsx
import { useUINavigation } from '@qontinui/ui-bridge';

function GoToCheckout() {
  const { findPath, navigateTo, isNavigating } = useUINavigation();

  const go = async () => {
    const path = findPath(['checkout']);
    if (!path.found) return;

    const result = await navigateTo(['checkout']);
    console.log(result.success, result.executedTransitions, result.finalActiveStates);
  };

  return <button onClick={go} disabled={isNavigating}>Checkout</button>;
}
```

`findPath` returns a `PathResult`
(`{ found, transitions, totalCost, targetStates, estimatedSteps }`) without
executing anything; `navigateTo` walks it and returns a `NavigationResult`.
`useCanNavigateTo(['checkout'])` is the boolean-only form.

Targets are always an **array** — reaching several states at once is the native
shape.

Over HTTP:

```http
POST /control/states/find-path
{ "targetStates": ["checkout"] }

POST /control/states/navigate
{ "targetStates": ["checkout"] }
```

Both return `NOT_IMPLEMENTED` if the registry has no pathfinder wired up, rather
than reporting an empty path. See
[Navigation Hooks](../react/hooks-navigation.md) and
[Navigation Assistance](../ai/navigation-assistance.md).

## The Standalone StateMachine

`@qontinui/ui-bridge-auto` takes the opposite approach: instead of the app
declaring its states, you define them as **element queries**, and a detector
evaluates them against a registry. That makes it usable against an app that
ships no UI Bridge code.

```bash
npm install @qontinui/ui-bridge-auto
```

```typescript
import { StateMachine, StateDetector } from '@qontinui/ui-bridge-auto';

const machine = new StateMachine();

machine.defineStates([
  {
    id: 'logged-out',
    name: 'Logged Out',
    requiredElements: [{ id: 'login-form' }],
    excludedElements: [{ id: 'user-menu' }],
  },
  {
    id: 'logged-in',
    name: 'Logged In',
    requiredElements: [{ role: 'button', ariaLabel: 'Account' }],
  },
]);

machine.defineTransitions([
  {
    id: 'log-in',
    name: 'Log in',
    fromStates: ['logged-out'],
    activateStates: ['logged-in'],
    exitStates: ['logged-out'],
    actions: [{ target: { id: 'login-btn' }, action: 'click' }],
  },
]);

const detector = new StateDetector(machine, registry);
detector.evaluate();

machine.getActiveStates(); // Set<string>
machine.isActive('logged-in'); // boolean
```

The machine's surface is `defineStates`, `defineTransitions`,
`getStateDefinition`, `getAllStateDefinitions`, `getTransitionDefinitions`,
`getActiveStates`, `isActive`, `setActiveStates`, `onStateEnter` and
`onStateExit`. It holds no DOM references — `StateDetector` owns the
subscription to the registry and calls `setActiveStates` for it, and
`detector.dispose()` tears that down.

Its pathfinding and visualisation live on the `/runtime` subpath:

```typescript
import { findPath, navigate, getAvailableTransitions, toMermaid } from '@qontinui/ui-bridge-auto/runtime';

const transitions = machine.getTransitionDefinitions();

getAvailableTransitions(machine.getActiveStates(), transitions);
findPath(machine.getActiveStates(), 'checkout', transitions);
navigate(machine.getActiveStates(), 'checkout', transitions);

console.log(toMermaid(machine.getAllStateDefinitions(), transitions));
// stateDiagram-v2 …
```

`toDot` renders the same graph as Graphviz DOT.

:::caution Not wired into injected mode
`packages/ui-bridge/src/injected/index.ts` records the DOM-inferred state
machine (and the structural `ElementQuery` language) from
`@qontinui/ui-bridge-auto` as **Tier 2 — DEFERRED, not silently capped**: it is
deliberately not wired into UI Bridge's injected transport. Tier 1 (find,
click/type/clear/focus, snapshot, visibility reads) is uncrippled by that,
because ranked semantic `find` rides the DOM-seeded registry and does not
depend on the query language. Use the package directly if you need the machine
today.
:::
