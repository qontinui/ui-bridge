# Component State Exposure

An element registration tells a driver *what is on the page*. Component state
tells it *what the app thinks is true* — the cart total, the form's validity,
which tab is selected — without scraping it back out of the DOM.

You expose it with `useUIComponent`, and read it over
`GET /control/component/:id/state`.

## Basic State Exposure

`useUIComponent` registers a component. Two of its options carry state: `state`
is a getter for the raw values, and `computed` is a map of derived values.

```tsx
import { useState } from 'react';
import { useUIComponent } from '@qontinui/ui-bridge';

function Counter() {
  const [count, setCount] = useState(0);

  useUIComponent({
    id: 'counter',
    name: 'Counter',
    state: () => ({ count }),
    computed: {
      isEven: () => count % 2 === 0,
    },
  });

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
    </div>
  );
}
```

`state` is a **function**, not a value — it is called at read time, so the
driver always sees the current render's values rather than a snapshot taken at
registration.

There is no `useExposeState` hook. State exposure is a property of a registered
component, which is what gives it an id, a name, actions and a lifecycle.

## Reading Exposed State

```http
GET /control/component/counter/state
```

```json
{
  "success": true,
  "data": {
    "state": { "count": 5 },
    "computed": { "isEven": false },
    "timestamp": 1717171717171
  }
}
```

`state` and `computed` come back as separate maps — a `ComponentStateResponse`.
The route returns `NOT_FOUND` when no component with that id is registered, and
an empty pair when the component is registered but exposes no state getter.

Related reads: `GET /control/components` lists every registered component with
its state keys and actions, and `GET /control/component/:id` returns one
component's descriptor.

## Form State

A form is the case this was built for — values, errors and validity in one
read:

```tsx
import { useState } from 'react';
import { useUIComponent } from '@qontinui/ui-bridge';

function LoginForm() {
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    state: () => ({ values, errors }),
    computed: {
      isValid: () => Object.keys(errors).length === 0,
      isDirty: () => values.email !== '' || values.password !== '',
    },
    actions: [
      {
        id: 'submit',
        label: 'Submit login',
        paramSchema: { email: 'string', password: 'string' },
        handler: async (params: { email: string; password: string }) => submitLogin(params),
      },
    ],
  });

  return <form>…</form>;
}
```

Actions declared alongside the state are callable over
`POST /control/component/login-form/action/submit`, so a driver can read the
state, decide, and act through the same component.

For DOM-level form analysis that needs no registration at all, use
`GET /control/forms` (plus `POST /control/forms/snapshot` and
`/control/forms/diff`), or `GET /ai/snapshot?includeForms=true` — see
[Visual Context](../ai/visual-context.md).

## Namespacing

Component ids are flat strings, so namespace by convention with a separator you
choose. Each namespace is a separate component with its own lifecycle:

```tsx
useUIComponent({ id: 'user-profile.details', name: 'Profile details', state: () => ({ name, email }) });
useUIComponent({ id: 'user-profile.preferences', name: 'Profile preferences', state: () => ({ theme }) });
```

```http
GET /control/component/user-profile.details/state
```

There is no hierarchy in the registry: `user-profile.details` is an opaque id,
not a path, and reading `user-profile` will not aggregate its children.

## UI States vs Component State

These are two different mechanisms and it is worth not confusing them:

- **Component state** — arbitrary app values, per component, read with
  `GET /control/component/:id/state`.
- **UI states** — named conditions of the interface (`logged-out`,
  `cart-open`), registered with `useUIState`, used for pathfinding and
  navigation.

```tsx
import { useUIState } from '@qontinui/ui-bridge';

function CartDrawer({ open }: { open: boolean }) {
  const { isActive } = useUIState({
    id: 'cart-open',
    name: 'Cart Open',
    activeWhen: () => open,
    blocking: true,
  });

  return isActive ? <aside>…</aside> : null;
}
```

`GET /control/states/snapshot` returns a `StateSnapshot`
(`{ timestamp, activeStates, states, groups, transitions }`) — the state-machine
picture, not a dump of every component's state. See
[State Machine Integration](../state/state-machine-integration.md).

## Watching for Changes

There is no `watchState` / `waitForState` / `diffState` on the client. Component
state is read on demand, and change detection is a separate, semantic
mechanism:

- **`POST /ai/wait-for-change`** — block until a predicate is satisfied, and get
  the semantic diff that satisfied it:

  ```http
  POST /ai/wait-for-change
  {
    "predicate": { "textContains": { "elementId": "cart-total", "text": "$42" } },
    "options": { "timeout": 10000, "interval": 200 }
  }
  ```

  A `ChangePredicate` can be `elementAppeared`, `elementDisappeared`,
  `propertyChanged`, `textContains`, `category` or `anySignificantChange`.

- **`GET /ai/diff`** — the semantic diff since the previous call.

- **`GET /control/changes/since`** — the push-based change log.

- **WebSocket events** — subscribe to `element:stateChanged`,
  `action:completed` and the rest. Note that there is **no**
  `component:stateChanged` event: components emit `component:registered` and
  `component:unregistered` only, so a component whose state changes without
  re-registering will not push a notification. Poll
  `GET /control/component/:id/state`, or watch the element-level signals that
  the state change causes. See
  [WebSocket Communication](./websocket-communication.md).

To compare two points in time, take a snapshot before and after and diff those:

```typescript
import { createSnapshotManager, createDiffManager, getGlobalRegistry } from '@qontinui/ui-bridge';

const registry = getGlobalRegistry();
const snapshots = createSnapshotManager();
const diffs = createDiffManager();

diffs.update(snapshots.createSnapshot(registry.createSnapshot()));
await doSomething();
const diff = diffs.update(snapshots.createSnapshot(registry.createSnapshot()));
```
