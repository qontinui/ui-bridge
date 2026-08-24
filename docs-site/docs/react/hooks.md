---
sidebar_position: 2
---

# React Hooks

`@qontinui/ui-bridge` exports **33 React hooks** from `@qontinui/ui-bridge/react`.
This page is the index; each family has its own reference page.

Every hook on these pages was written against the implementation in
`packages/ui-bridge/src/react/`. Where a hook's own doc comment and its code
disagree, the pages say so explicitly rather than repeating the comment.

## Hook index

### Element & component registration

Attach a DOM node or a logical component to the registry so automation can see
and drive it. → [Registration hooks](./hooks-registration.md)

| Hook | What it does |
|------|--------------|
| [`useUIElement`](./hooks-registration.md#useuielement) | Register a DOM element and get a `ref`, `trigger`, state accessors |
| [`useUIElementRef`](./hooks-registration.md#useuielementref) | **Deprecated no-op** — kept for source compatibility |
| [`useUIComponent`](./hooks-registration.md#useuicomponent) | Register a component with named, high-level actions |
| [`useUIComponentAction`](./hooks-registration.md#useuicomponentaction) | Memoize an action handler (a typed `useCallback`) |
| [`useOwningComponent`](./hooks-registration.md#useowningcomponent) | Read the enclosing `UIBridgeComponentScope` id |

Auto-registering a whole subtree instead of hook-by-hook is
[`useAutoRegister`](./auto-registration.md), which has its own page.

### The model: states, transitions, navigation

UI Bridge models an app as **states** connected by **transitions**, and
navigates between them by pathfinding. The concepts are explained in
[State Machine Integration](../state/state-machine-integration.md); the pages
below are the reference for the hooks that implement them. States are declared
by the app — [`useUIState`](./hooks-state.md#useuistate) registers one — and
observed at runtime with
[`useActiveStates`](./hooks-state.md#useactivestates) and
[`useStateSnapshot`](./hooks-state.md#usestatesnapshot).

| Hook | What it does |
|------|--------------|
| [`useUIState`](./hooks-state.md#useuistate) | Register one state; activate / deactivate / toggle it |
| [`useUIStateGroup`](./hooks-state.md#useuistategroup) | Register a group of states that activate atomically |
| [`useActiveStates`](./hooks-state.md#useactivestates) | Subscribe to the active-state id list |
| [`useStateSnapshot`](./hooks-state.md#usestatesnapshot) | Read all states, groups and transitions at once |
| [`useUITransition`](./hooks-transitions.md#useuitransition) | Register a transition; `canExecute` + `execute()` |
| [`useTransitions`](./hooks-transitions.md#usetransitions) | Read every registered transition |
| [`useAvailableTransitions`](./hooks-transitions.md#useavailabletransitions) | Subscribe to the transitions executable right now |
| [`useUINavigation`](./hooks-navigation.md#useuinavigation) | `findPath()` / `navigateTo()` across the state graph |
| [`useCanNavigateTo`](./hooks-navigation.md#usecannavigateto) | Boolean "is there a path to these states?" |
| [`useNavigationPath`](./hooks-navigation.md#usenavigationpath) | The `PathResult` for a target, without executing it |

→ [State hooks](./hooks-state.md) · [Transition hooks](./hooks-transitions.md) ·
[Navigation hooks](./hooks-navigation.md)

### Semantic declaration

Tell the bridge things the DOM cannot express — what an element is *for*, how
elements relate, what can be dragged where.
→ [Semantic hooks](./hooks-semantics.md)

| Hook | What it does |
|------|--------------|
| [`useUIAnnotation`](./hooks-semantics.md#useuiannotation) | Attach description / purpose / tags to an element id |
| [`useUIRelationship`](./hooks-semantics.md#useuirelationship) | Declare one typed relationship between two elements |
| [`useUIRelationships`](./hooks-semantics.md#useuirelationships) | Declare many relationships from one source element |
| [`useDragSource`](./hooks-semantics.md#usedragsource) | Mark an element as draggable, with a data type |
| [`useDropZone`](./hooks-semantics.md#usedropzone) | Mark an element as a drop target, with accepted types |

The drag-and-drop model itself is described in
[Drag & Drop](../concepts/drag-drop.md).

### App context & capabilities

Page identity, routing, keyboard shortcuts and undo state — the app-level
context that ends up in a snapshot. → [App-context hooks](./hooks-app-context.md)

| Hook | What it does |
|------|--------------|
| [`usePageContext`](./hooks-app-context.md#usepagecontext) | Name the current page / section / breadcrumb |
| [`useRouteAwareness`](./hooks-app-context.md#userouteawareness) | Feed router pattern, params and query into the tracker |
| [`useKeyboardShortcuts`](./hooks-app-context.md#usekeyboardshortcuts) | Publish the shortcuts your app implements |
| [`useUndoRedo`](./hooks-app-context.md#useundoredo) | Declare authoritative undo/redo state, overriding heuristics |

### Bridge access

Reach the provider's context, registry and executor from anywhere in the tree.
→ [Bridge-access hooks](./hooks-bridge-access.md)

| Hook | What it does |
|------|--------------|
| [`useUIBridge`](./hooks-bridge-access.md#useuibridge) | The main façade: elements, components, workflows, actions, snapshots |
| [`useUIBridgeRequired`](./hooks-bridge-access.md#useuibridgerequired) | Same, but throws when there is no provider |
| [`useUIBridgeContext`](./hooks-bridge-access.md#useuibridgecontext) | Raw context value; throws outside a provider |
| [`useUIBridgeOptional`](./hooks-bridge-access.md#useuibridgeoptional) | Raw context value or `null` |
| [`useUIBridgeWindowLabel`](./hooks-bridge-access.md#useuibridgewindowlabel) | The enclosing window label in multi-window hosts |

### Host integration

Wiring the SDK to a relay, an iframe host, or a deploy that ships new bundles.
→ [Integration hooks](./hooks-integration.md)

| Hook | What it does |
|------|--------------|
| [`useCommandRelay`](./hooks-integration.md#usecommandrelay) | Connect the browser to the server command relay over SSE |
| [`useUIBridgeEcho`](./hooks-integration.md#useuibridgeecho) | Echo arbitrary JSON state into the snapshot via a hidden input |
| [`useBuildIdWatcher`](./hooks-integration.md#usebuildidwatcher) | Detect that the server shipped a new bundle |

## Best practices

### 1. Give elements stable, descriptive ids

The id is the automation contract. Rename a component freely; renaming its
UI Bridge id breaks every script that targeted it.

```tsx
// Good
useUIElement({ id: 'checkout-submit-button' });
useUIComponent({ id: 'user-profile-form', name: 'User Profile Form' });

// Avoid
useUIElement({ id: 'btn1' });
useUIComponent({ id: 'form', name: 'Form' });
```

### 2. Do not hand-write `data-ui-id`

`data-ui-id` is legacy and is no longer read. `useUIElement` stamps
`data-ui-bridge-id` on the node itself once the ref attaches, and identification
otherwise goes through the registry. The hook that used to write the old
attribute, [`useUIElementRef`](./hooks-registration.md#useuielementref), is a
deprecated no-op.

### 3. Let unmount do the cleanup

Nearly every hook here registers on mount and unregisters on unmount. The one
deliberate exception is called out on its page:
[`useUIAnnotation`](./hooks-semantics.md#useuiannotation), which persists across
unmount on purpose.

### 4. Type your action parameters

```tsx
interface LoginParams {
  email: string;
  password: string;
}

useUIComponent({
  id: 'login-form',
  name: 'Login Form',
  actions: [
    {
      id: 'login',
      paramSchema: { email: 'string', password: 'string' },
      handler: async (params?: LoginParams) => login(params!.email, params!.password),
    },
  ],
});
```

`paramSchema` is surfaced verbatim on `/control/component/:id` so a caller can
discover the shape without reading your source, **and the SDK checks `params`
against it before your handler runs**. Two forms are accepted: the map shorthand
above, and a JSON-Schema-subset object (`{ type: 'object', properties, required,
additionalProperties }`) — the shape
`paramSchemaOf()` (`@qontinui/ui-bridge-wrapper`) emits.

The gate starts in **`'warn'`** mode: violations are logged and the handler
still runs. Arm it per deployment with
`setDefaultParamValidationMode('enforce')`, after which a violating call comes
back as `success: false` with `failureDetails.errorCode ===
'UB-ACTION-REJECTED'` and `failureDetails.invalidParams` naming each offending
param. A single call can override the mode through
`executeComponentAction`'s `{ paramValidation }` option bag; the wire cannot,
deliberately — enforcement is the deployment's policy, not the validated
caller's to switch off.

In map form a bare string is read as a type hint **only** when it is one of the
seven JSON Schema primitive names (`string`, `number`, `integer`, `boolean`,
`object`, `array`, `null`). Any other string is prose and constrains nothing, so
`{ count: 'number (>= 1, defaults to 1)' }` stays a human-readable hint rather
than becoming an unsatisfiable rule. Map form also never marks a param
required — it has no way to express optionality. Write the object form if you
need `required`.

### 5. Give a long-running action a timeout

An `AbortSignal` cannot be JSON-serialized, so `timeoutMs` on the request is the
only way an out-of-process caller can call off a hung handler:

```ts
await bridge.executeComponentAction('login-form', {
  action: 'login',
  params: { email, password },
  timeoutMs: 5_000,
});
```

The executor races the handler promise, so abandonment does not depend on your
handler observing the signal it is passed. On abandonment the response is
`success: false` with `failureDetails.errorCode === 'UB-ACTION-TIMEOUT'` and
`failureDetails.cancelReason === 'timeout'`. An in-process caller can pass its
own `{ signal }` instead — that arm reports `'UB-ACTION-FAILED'` with
`cancelReason === 'signal'`, so `cancelReason` rather than the code is the
reliable "was this abandoned?" test.

Your handler receives the signal as the second argument, which is how it
releases its own in-flight work instead of leaving it detached:

```ts
handler: async (params, { signal }) => fetch(url, { signal }),
```
