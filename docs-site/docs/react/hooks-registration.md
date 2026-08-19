---
sidebar_position: 2.1
---

# Registration Hooks

Five hooks from `@qontinui/ui-bridge/react` put things *into* the registry: a DOM
node, a logical component, or the scope that links the two. What the registry
holds and how it is queried is covered in
[The Registry](../concepts/registry.md) and
[Element Identification](../concepts/element-identification.md).

To register a whole subtree by scanning it instead of hook-by-hook, see
[Auto-Registration](./auto-registration.md).

## useUIElement

Registers a DOM element for observation and programmatic control.

```tsx
import { useUIElement } from '@qontinui/ui-bridge/react';

function SubmitButton() {
  const { ref, trigger } = useUIElement({
    id: 'submit-btn',
    type: 'button',
    label: 'Submit Form',
  });

  return <button ref={ref}>Submit</button>;
}
```

Attaching the returned `ref` is what registers the element — the hook has no DOM
node to register before that. It also stamps `data-ui-bridge-id="<your id>"` on
the node so out-of-process runners can resolve it without holding the React ref;
you do not write that attribute yourself.

### Options

`UseUIElementOptions`:

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `id` | `string` | — | **Required.** Unique element identifier |
| `type` | `ElementType` | auto-detected | Element type |
| `label` | `string` | — | Human-readable label |
| `actions` | `StandardAction[]` | derived from the element | Override the available actions |
| `customActions` | `Record<string, CustomAction>` | — | Named handlers callable via `trigger` |
| `autoRegister` | `boolean` | `true` | Register as soon as the ref attaches |
| `onStateChange` | `(state: ElementState) => void` | — | State-change callback |
| `logLevel` | `ElementLogLevel` | — | Per-element event-logging level |
| `relationships` | `Array<{ targetId, type, bidirectional?, metadata? }>` | — | Relationships declared from this element |
| `variant` | `string` | — | Semantic role: `"primary"`, `"destructive"`, `"ghost"`, … |
| `position` | `string` | — | Positional hint: `"top-right"`, `"center"`, … |
| `color` | `string` | — | Dominant colour as the user sees it: `"red"`, `"#ef4444"`, `"danger"` |
| `contextPath` | `string` | — | Hierarchical path, e.g. `"settings-modal > theme-section > accent-color"` |
| `persistWhileMounted` | `boolean` | `false` | Stay registered through visibility changes; see below |
| `reveals` | `string[]` | — | Element ids or `*`-globs this control unhides |
| `windowLabel` | `string` | context, then `"main"` | Registry bucket in multi-window hosts |

`variant`, `position`, `color` and `contextPath` are open-ended strings passed
through to snapshots verbatim — they exist to let a natural-language query
("the red Save button at the bottom right") rank candidates without pixel
grounding. Use your own design-system tokens if you have them.

`persistWhileMounted` additionally stamps `data-ui-bridge-persist="true"` on the
node, which tells the auto-scanner to skip its visibility gate. Use it for
things like sidebar items inside a collapsible group that should stay
discoverable while collapsed.

`windowLabel` resolves in three steps: the explicit option, then the nearest
[`UIBridgeWindowProvider`](./hooks-bridge-access.md#useuibridgewindowlabel), then
the registry's default `"main"` window. Single-window apps pass neither and get
the historical behaviour exactly.

### Return value

```typescript
interface UseUIElementReturn {
  ref: React.RefCallback<HTMLElement>;
  element: HTMLElement | null;
  registered: boolean;
  getState: () => ElementState | null;
  getIdentifier: () => ElementIdentifier | null;
  trigger: (action: StandardAction | string, params?: Record<string, unknown>) => Promise<void>;
  register: () => void;
  unregister: () => void;
  registeredElement: RegisteredElement | null;
  getHistory: (options?: ElementHistoryOptions) => ElementLogEntry[];
  setLogLevel: (level: ElementLogLevel) => void;
}
```

:::warning `trigger` throws — it does not return a result object

`trigger` rejects with `Error('UI Bridge not available')` when there is no
provider, and rejects with the executor's `error` string when the action fails.
On success it resolves to `undefined`: the executor's response body is
discarded. If you need the returned payload, call
[`useUIBridge().executeAction`](./hooks-bridge-access.md#useuibridge), which
hands back the full `ControlActionResponse` instead of throwing.

:::

`element` and `registered` are read from refs during render, so they reflect the
value at the last render rather than driving one. Do not gate rendering on
`registered` flipping — the ref attaches after the render that created it.

### Custom actions

```tsx
function ColorPicker() {
  const [color, setColor] = useState('#000000');

  const { ref } = useUIElement({
    id: 'color-picker',
    type: 'custom',
    customActions: {
      setColor: {
        id: 'setColor',
        label: 'Set colour',
        handler: async (params?: { color: string }) => {
          setColor(params!.color);
          return { color: params!.color };
        },
      },
    },
  });

  return (
    <div ref={ref}>
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
    </div>
  );
}
```

Each entry is a `CustomAction` **object**, not a bare function:

```typescript
interface CustomAction<TParams = unknown, TResult = unknown> {
  id: string;
  label?: string;
  description?: string;
  handler: (params?: TParams) => TResult | Promise<TResult>;
}
```

`customActions` is deliberately excluded from the hook's internal change key —
handler identity churns on every render, and re-registering per render would
wake every registry subscriber. The registry is still updated in place with the
latest handlers whenever another option changes.

## useUIElementRef

```typescript
function useUIElementRef(id: string): React.RefCallback<HTMLElement>
```

:::danger Deprecated no-op

This hook does nothing. It returns a ref callback with an empty body. It exists
only so that code written against the old `data-ui-id` identification scheme
keeps compiling; that attribute is no longer written or read, and the hook is
slated for removal.

Use [`useUIElement`](#useuielement) — its `ref` performs the real registration.

:::

## useUIComponent

Registers a logical component that exposes **named, high-level actions**, so
automation can call `login` instead of typing into two inputs and clicking a
button.

```tsx
import { useUIComponent } from '@qontinui/ui-bridge/react';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    actions: [
      {
        id: 'login',
        label: 'Submit Login',
        paramSchema: { email: 'string', password: 'string' },
        handler: async (params) => authenticate(params),
      },
      {
        id: 'clear',
        label: 'Clear Form',
        handler: () => {
          setEmail('');
          setPassword('');
        },
      },
    ],
  });

  return <form>{/* … */}</form>;
}
```

Handlers are wrapped at registration time in a stable delegator that looks the
handler up again on each call, so a handler closing over React state always sees
current values rather than the closure captured at registration.

### Options

`UseUIComponentOptions`:

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `id` | `string` | — | **Required.** Unique component identifier |
| `name` | `string` | — | **Required.** Display name |
| `description` | `string` | — | Description |
| `actions` | `ComponentActionDef[]` | `[]` | Actions exposed on this component |
| `elementIds` | `string[]` | `[]` | Child element ids owned by this component |
| `autoRegister` | `boolean` | `true` | Register on mount |
| `state` | `() => Record<string, unknown>` | — | Getter for the component's current state |
| `computed` | `Record<string, ComputedPropertyDef \| (() => unknown)>` | — | Computed properties |
| `scope` | `'global' \| 'route'` | `'route'` | Discoverability hint |

`actions` is **optional** in the type — a component that only exposes `state` or
`computed` is valid.

```typescript
interface ComponentActionDef<TParams = unknown, TResult = unknown> {
  id: string;
  label?: string;
  description?: string;
  paramSchema?: Record<string, unknown>;   // surfaced verbatim; NOT validated
  handler: (params?: TParams) => TResult | Promise<TResult>;
}
```

Each `computed` entry may be either a `{ getter, description }` object or a bare
getter function; both forms are accepted. A getter that throws yields
`undefined` for that key rather than failing the whole read.

`scope: 'global'` advertises the component as intended for cross-route
availability (an app-shell control, a permanent overlay). It is plumbed through
to listings and snapshots for clients to consume — it does **not** change mount
semantics today.

### Return value

```typescript
interface UseUIComponentReturn {
  registered: boolean;
  executeAction: <TParams, TResult>(actionId: string, params?: TParams) => Promise<TResult>;
  register: () => void;
  unregister: () => void;
  updateActions: (actions: ComponentActionDef[]) => void;
  addElement: (elementId: string) => void;
  removeElement: (elementId: string) => void;
  registeredComponent: RegisteredComponent | null;
}
```

`executeAction` throws rather than returning a result envelope: `Error('UI Bridge
not available')` with no provider, and `Error(response.error ?? 'Action failed')`
when the executor reports failure. On success it resolves to `response.result`.

:::warning `addElement` / `removeElement` do not update the registry

Both only mutate the hook's internal `elementIds` list. The registered component
keeps whatever `elementIds` it was registered with until something re-registers
it — `updateActions` does (it unregisters and registers again), and so does an
unmount/remount. If you need the registry to reflect an element-ownership
change immediately, call `unregister()` then `register()`.

:::

`registered` is read from a ref during render, so it is the value as of the last
render and does not itself trigger one.

## useUIComponentAction

```typescript
function useUIComponentAction<TParams, TResult>(
  handler: (params?: TParams) => TResult | Promise<TResult>,
  deps: React.DependencyList
): (params?: TParams) => TResult | Promise<TResult>
```

A typed `useCallback` for component action handlers — it memoizes `handler`
against `deps` and returns it. There is no bridge interaction, no registration,
and no other behaviour.

```tsx
const login = useUIComponentAction(
  async (params?: { email: string }) => authenticate(params!.email),
  [authenticate]
);

useUIComponent({ id: 'login-form', name: 'Login Form', actions: [{ id: 'login', handler: login }] });
```

It is rarely necessary: `useUIComponent` already delegates through a stable
wrapper that reads the latest handler, so inline handlers do not cause
re-registration. Reach for this only when the same handler identity is needed
somewhere else too.

## useOwningComponent

```typescript
function useOwningComponent(): string | null
```

Reads the `componentId` of the nearest enclosing `UIBridgeComponentScope`, or
`null` outside one. Takes no arguments.

```tsx
import { UIBridgeComponentScope, useOwningComponent } from '@qontinui/ui-bridge/react';

function Row() {
  const owner = useOwningComponent(); // 'zone-profile-picker'
  return <div>{owner ?? 'unscoped'}</div>;
}

<UIBridgeComponentScope componentId="zone-profile-picker">
  <Row />
</UIBridgeComponentScope>;
```

`useUIElement` calls this internally to fill in `ownedByComponent`, so wrapping a
subtree in `UIBridgeComponentScope` is enough — you only call this hook directly
when your own code needs to know the owner.

The scope renders a real `<div>` carrying `data-ui-bridge-component`, styled
`display: contents` so it is invisible to layout while still giving the
DOM-scanning auto-registrar an attribute to walk up to.
