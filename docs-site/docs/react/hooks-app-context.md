---
sidebar_position: 2.6
---

# App-Context Hooks

Four hooks from `@qontinui/ui-bridge/react` describe the application around the
elements: which page you are on, what the router thinks, which keyboard
shortcuts exist, and whether undo is available. All four are declarations into a
tracker — they take a value and return `void`.

Each resolves the bridge with `useUIBridgeOptional()` and no-ops without a
provider.

## usePageContext

```typescript
function usePageContext(context: DeveloperPageContext): void
```

Names the current page semantically, so a snapshot says "Task Detail" rather
than only `/tasks/123`.

```tsx
import { usePageContext } from '@qontinui/ui-bridge/react';

function TaskDetailPage({ id }: { id: string }) {
  usePageContext({
    name: 'Task Detail',
    section: 'tasks',
    breadcrumb: ['Tasks', `Task ${id}`],
  });

  return <div>…</div>;
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `name` | `string` | **Required.** Semantic page name (`"Task Detail"`, `"Dashboard"`) |
| `section` | `string` | Application area (`"tasks"`, `"settings"`, `"admin"`) |
| `breadcrumb` | `string[]` | Breadcrumb trail |
| `meta` | `Record<string, unknown>` | Arbitrary metadata |

:::warning One page context exists at a time, and unmount clears it

The tracker holds a single value. Calling this hook from two mounted components
means the later effect wins, and when *either* unmounts it sets the page context
to `undefined` — clearing the other component's value as well.

Call it from exactly one component per route: the page component itself.

:::

The effect re-fires on changes to `name`, `section`, the joined `breadcrumb`, or
the serialised `meta`, so inline object literals are safe.

## useRouteAwareness

```typescript
function useRouteAwareness(info: RouteInfo): void
```

Feeds structured router information into the navigation tracker. This is the
adapter layer between your router and the bridge — the hook is
framework-agnostic and you supply whatever your router exposes.

| Field | Type | Meaning |
|-------|------|---------|
| `pattern` | `string \| null` | Route pattern — a TEMPLATE such as `"/tasks/[id]"`, never the concrete pathname; `null` when unknown (a 404) |
| `patternSource` | `'router'` | Asserts the pattern came from the router and carries no user input; consumers that persist templates drop a pattern without it |
| `params` | `Record<string, string>` | Extracted route params, e.g. `{ id: "123" }` |
| `queryParams` | `Record<string, string>` | Query string as key/value pairs |
| `routeStack` | `string[]` | Matched route stack / breadcrumb |

Every field is optional, but the argument itself is required — pass `{}` to
declare nothing.

Never pass the concrete pathname as `pattern`: `/search/<what the user typed>`
reported as a pattern leaks user input into everything that stores route
templates. Derive the pattern with `routePatternFromParams`, below.

### React Router

```tsx
import { useLocation, useParams, useMatches, Outlet } from 'react-router-dom';
import { routePatternFromParams, useRouteAwareness } from '@qontinui/ui-bridge/react';

function App() {
  const location = useLocation();
  const params = useParams();
  const matches = useMatches();

  useRouteAwareness({
    pattern: routePatternFromParams(location.pathname, params, {
      matched: matches.length > 0,
    }),
    patternSource: 'router',
    queryParams: Object.fromEntries(new URLSearchParams(location.search)),
  });

  return <Outlet />;
}
```

### Next.js

Pass `useParams()` raw — flattening a catch-all array destroys its
`[...slug]` run. Next.js renders a 404 inside the root layout with
`useParams()` returning `{}`, so report `matched: false` from your not-found
boundary; the pattern is then `null` instead of the concrete path.

```tsx
import { usePathname, useParams, useSearchParams } from 'next/navigation';
import { routePatternFromParams, useRouteAwareness } from '@qontinui/ui-bridge/react';

function Layout({ children }) {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();

  useRouteAwareness({
    pattern: routePatternFromParams(pathname, params, { matched: true }),
    patternSource: 'router',
    queryParams: Object.fromEntries(searchParams),
  });

  return <>{children}</>;
}
```

### routePatternFromParams

```typescript
function routePatternFromParams(
  pathname: string | null | undefined,
  params: Record<string, string | string[] | undefined> | null | undefined,
  options: { matched: boolean },
): string | null
```

Derives the pattern by value substitution, failing closed:

- every path segment equal to a param value becomes `[name]`;
- a catch-all array's run of segments (or a React Router splat string spanning
  several segments) becomes `[...name]`;
- segments and values are compared raw and `decodeURIComponent`-decoded, so an
  encoded/decoded mismatch still substitutes;
- if any param value still appears as a segment afterwards, the result is `null`;
- `matched: false` returns `null`.

Over-templating (a static segment that happens to equal a param value is
templated too) is harmless; under-templating cannot happen.

The same single-holder caveat as `usePageContext` applies: the tracker stores one
`RouteInfo`, and unmount clears it. Call this once, from the layout or app root.

## useKeyboardShortcuts

```typescript
function useKeyboardShortcuts(shortcuts: ShortcutDef[]): void
```

Publishes the shortcuts your app implements so an agent can use them instead of
hunting for the equivalent button.

```tsx
import { useKeyboardShortcuts } from '@qontinui/ui-bridge/react';

useKeyboardShortcuts([
  { combo: 'Ctrl+S', description: 'Save workflow', scope: 'editor' },
  { combo: 'Ctrl+Shift+N', description: 'New workflow' },
]);
```

`ShortcutDef` is a `KeyboardShortcut` minus its `source` field, which the hook
always fills in as `'developer'` — that is how these are distinguished from
shortcuts the tracker discovered by scanning the DOM.

| Field | Type | Meaning |
|-------|------|---------|
| `combo` | `string` | **Required.** Normalised combo: `"Ctrl+Shift+T"`, `"Alt+N"`, `"Escape"` |
| `description` | `string` | What the shortcut does |
| `elementId` | `string` | Associated element id in the registry |
| `scope` | `string` | Where it applies, e.g. `"global"`, `"editor"` |

:::warning Declaring a shortcut does not implement it

The hook registers metadata with the shortcut tracker. It installs no key
listener and invokes nothing. Your app must already handle the key combination;
this only makes it discoverable.

:::

An empty array is a no-op — the effect returns early, so it neither registers nor
unregisters anything. Unmount unregisters by `combo`, which means two components
declaring the same combo will have the first unmount remove it for both.

The array is compared by serialised value, so an inline literal is fine.

## useUndoRedo

```typescript
function useUndoRedo(options: DeclaredUndoState): void
```

Declares your app's real undo/redo state. UI Bridge otherwise guesses at undo
availability from DOM buttons, `document.execCommand` probes and keyboard
shortcuts; a declaration **overrides all of that heuristic detection**.

```tsx
import { useUndoRedo } from '@qontinui/ui-bridge/react';

function MyEditor() {
  const { canUndo, canRedo, undo, redo, undoStack } = useMyUndoSystem();

  useUndoRedo({
    canUndo,
    canRedo,
    undoDescription: undoStack[0]?.description,
    undoStack: undoStack.map((e) => e.description),
    onUndo: undo,
    onRedo: redo,
  });

  return <div>…</div>;
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `canUndo` | `boolean` | **Required.** Undo currently available |
| `canRedo` | `boolean` | **Required.** Redo currently available |
| `undoDescription` | `string` | What the next undo would reverse |
| `redoDescription` | `string` | What the next redo would restore |
| `undoStack` | `string[]` | Full undo stack descriptions, most recent first |
| `redoStack` | `string[]` | Full redo stack descriptions, most recent first |
| `onUndo` | `() => void` | Perform undo programmatically |
| `onRedo` | `() => void` | Perform redo programmatically |

The declaration is cleared (set to `null`) on unmount.

:::note Only four fields re-fire the update

The hook re-declares when `canUndo`, `canRedo`, `undoDescription` or
`redoDescription` changes. `undoStack`, `redoStack`, `onUndo` and `onRedo` are
deliberately excluded from the dependency list to avoid re-running on every
render — but the effect always re-reads the **whole current options object** from
a ref, so their latest values do ride along with the next update.

The consequence: a change to `undoStack` alone, with all four trigger fields
unchanged, does not push a new declaration. In practice a stack change moves
`canUndo` or a description too, so this is rarely visible.

:::
