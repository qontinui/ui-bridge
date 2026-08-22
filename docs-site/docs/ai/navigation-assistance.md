# Navigation Assistance

Navigation Assistance helps an agent answer three questions: *where am I*,
*can I get to X from here*, and *what does it take*.

UI Bridge answers them with three distinct mechanisms:

| Mechanism | Answers | Entry point |
| --- | --- | --- |
| **State-graph pathfinding** | "Is `checkout` reachable, and via which transitions?" | `useUINavigation`, `useNavigationPath`, `useCanNavigateTo` |
| **Route tracking** | "What page am I on, and how did I get here?" | `NavigationTracker`, `usePageContext`, `useRouteAwareness` |
| **Navigation maps** | "Do these two apps expose the same navigation?" | `buildNavigationMap` |

Note that pathfinding is over the **registered state graph**, not over URLs. It
requires that your app registers states and transitions — see
[State Machine Integration](../state/state-machine-integration.md).

## State-Graph Pathfinding

### Find a Path

`useNavigationPath` computes the path to a target state set without executing
anything. It recomputes when the active states change:

```tsx
import { useNavigationPath } from '@qontinui/ui-bridge';

function CheckoutHint() {
  const path = useNavigationPath(['checkout']);

  if (!path.found) {
    return <p>Cannot reach checkout from here</p>;
  }

  return (
    <p>
      {path.estimatedSteps} steps via {path.transitions.join(' -> ')} (cost {path.totalCost})
    </p>
  );
}
```

A `PathResult` is `{ found, transitions, totalCost, targetStates, estimatedSteps }`
— `transitions` is an array of **transition ids**, not action descriptors.

### Check Reachability

When you only need a boolean, `useCanNavigateTo` is the cheap form:

```tsx
import { useCanNavigateTo } from '@qontinui/ui-bridge';

function DashboardLink() {
  const canNavigate = useCanNavigateTo(['dashboard']);
  return <button disabled={!canNavigate}>Dashboard</button>;
}
```

### Execute the Path

`useUINavigation` bundles pathfinding with execution and exposes the in-flight
state:

```tsx
import { useUINavigation } from '@qontinui/ui-bridge';

function NavigationController() {
  const { navigateTo, findPath, isNavigating, activeStates, lastResult, available } =
    useUINavigation();

  const goToDashboard = async () => {
    const path = findPath(['dashboard']);
    if (!path.found) return;

    const result = await navigateTo(['dashboard']);
    console.log(result.success, result.executedTransitions, result.finalActiveStates);
  };

  return (
    <div>
      <p>Active: {activeStates.join(', ')}</p>
      <button onClick={goToDashboard} disabled={!available || isNavigating}>
        Go to Dashboard
      </button>
      {lastResult?.error && <p role="alert">{lastResult.error}</p>}
    </div>
  );
}
```

A `NavigationResult` is
`{ success, path, executedTransitions, finalActiveStates, error?, durationMs }`.

### Over HTTP

```http
POST /control/states/find-path
{ "targetStates": ["checkout"] }

POST /control/states/navigate
{ "targetStates": ["checkout"] }
```

Both take a `targetStates` **array** — multi-target pathfinding is the native
shape, not a convenience over a single string. If the registry has no
pathfinder wired up, these return `NOT_IMPLEMENTED` rather than an empty path.
Related reads: `GET /control/states`, `GET /control/states/active`,
`GET /control/states/snapshot`, `GET /control/transitions`.

## Route Tracking

`NavigationTracker` intercepts the History API (`pushState` / `replaceState`)
and listens for `popstate` and `hashchange`, so SPA route changes are recorded
with no router integration. `UIBridgeProvider` installs one for you; construct
your own only outside React:

```typescript
import { NavigationTracker } from '@qontinui/ui-bridge';

const tracker = new NavigationTracker({ maxHistory: 20, observeTitle: true });
tracker.install((data) => console.log('navigated', data));

tracker.getCurrentPage(); // { url, pathname, search, hash, title }
tracker.getRecentNavigations(); // PageNavigationEntry[], most recent last
tracker.getSnapshotPageContext(); // what lands on the control snapshot

tracker.uninstall();
```

Each navigation also fires a `navigation:change` bridge event, so a WebSocket
subscriber sees route changes in real time.

### Breadcrumbs and Semantic Page Names

The tracker knows the URL; it does not know that `/tasks/123` is "Task Detail"
inside the "Tasks" section. You supply that, and it is where breadcrumbs live:

```tsx
import { usePageContext, useRouteAwareness } from '@qontinui/ui-bridge';

function TaskDetailPage({ id }: { id: string }) {
  usePageContext({
    name: 'Task Detail',
    section: 'tasks',
    breadcrumb: ['Tasks', `Task #${id}`],
  });

  useRouteAwareness({
    pattern: '/tasks/:id',
    params: { id },
    routeStack: ['/', '/tasks', '/tasks/:id'],
  });

  return <article>…</article>;
}
```

Both hooks write through to the tracker, and both clear themselves on unmount.
The merged result appears as `pageContext` and `route` on
`getSnapshotPageContext()`, and as `pageName` / `section` / `breadcrumb` /
`routePattern` on the semantic snapshot's `PageContext`.

There is no automatic breadcrumb inference and no "navigate back N crumbs"
helper. Browser history navigation is `POST /control/page/back` and
`POST /control/page/forward`.

### Navigation Completion

For flows that need "the route change has finished settling" rather than "the
URL changed", the tracker exposes an explicit completion signal:

```typescript
const unsubscribe = tracker.onNavigationComplete((data) => console.log(data));

// from the app, once the destination has rendered:
tracker.markNavigationComplete('/tasks/:id', { itemCount: 42 });
```

## Navigation Maps

`buildNavigationMap` is a **comparison** tool: given the elements of two pages
or two apps, it matches their navigation elements by label and reports what is
unique to each side. It is the backbone of cross-app parity checks, not a
declaration of your app's structure.

```typescript
import { buildNavigationMap } from '@qontinui/ui-bridge';

const map = buildNavigationMap(sourceElements, targetElements);

console.log(map.pairs); // NavigationPair[] — matched links, with destinationMatch
console.log(map.sourceOnly); // labels present only in the source
console.log(map.targetOnly); // labels present only in the target
```

Each `NavigationPair` carries `sourceId`, `targetId`, `label`, the two hrefs and
a `destinationMatch` flag. `isNavigationElement` is the predicate it filters
with, and is exported if you want to reuse it.
