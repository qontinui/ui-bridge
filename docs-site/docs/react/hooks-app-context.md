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
function useRouteAwareness(
  info: RouteInfo,
  options?: { unmatched?: RouteUnmatchedSignal | null },
): void
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

`routePatternFromParams` is only as safe as the `matched` its caller reports.
On a 404 the router's params are `{}`, so `matched: true` there returns the
concrete path unchanged.

### The not-found signal

A layout cannot pass `matched: false` for a 404. Its render, where `pattern`
is computed, runs before the not-found component exists. A second
`useRouteAwareness({ pattern: null })` call inside the not-found component
does not help either. React runs a child's passive effects before its
parent's, so the layout's call overwrites it in the same commit, with the
concrete path.

The mechanism is a provider-owned signal:

1. The layout creates it with `useRouteUnmatchedSignal()`.
2. The layout provides it through `RouteUnmatchedContext`.
3. The layout passes it to its single call: `useRouteAwareness(info, { unmatched })`.
4. The not-found boundary calls `useMarkRouteUnmatched()`. That raises the
   signal in `useLayoutEffect`.

Every layout effect in a commit runs before any passive effect, so the
layout's report already sees the signal. While a not-found boundary is
mounted, the hook reports `pattern: null`, whatever `info.pattern` says.

Precondition: the not-found boundary mounts in the same commit as the
navigation that reached it. Next.js `not-found.tsx` does. A boundary that
mounts later re-reports `pattern: null`, but by then the layout has already
reported once.

### Next.js

Pass `useParams()` raw. Flattening a catch-all array destroys its
`[...slug]` run.

```tsx
// app/RouteAwareness.tsx: mounted once, in the root layout
import { usePathname, useParams, useSearchParams } from 'next/navigation';
import {
  RouteUnmatchedContext,
  routePatternFromParams,
  useRouteAwareness,
  useRouteUnmatchedSignal,
} from '@qontinui/ui-bridge/react';

export function RouteAwareness({ children }) {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const unmatched = useRouteUnmatchedSignal();

  useRouteAwareness(
    {
      // matched: true is safe ONLY because `unmatched` overrides it on a 404.
      pattern: routePatternFromParams(pathname, params, { matched: true }),
      patternSource: 'router',
      queryParams: Object.fromEntries(searchParams),
    },
    { unmatched },
  );

  return (
    <RouteUnmatchedContext.Provider value={unmatched}>{children}</RouteUnmatchedContext.Provider>
  );
}
```

```tsx
// app/not-found.tsx. Do NOT call useRouteAwareness here.
import { useMarkRouteUnmatched } from '@qontinui/ui-bridge/react';

export default function NotFound() {
  useMarkRouteUnmatched();
  return <p>Not found</p>;
}
```

### React Router

`useMatches()` is not a 404 test. In a data router an unmatched URL still
yields `matches = [root]`, so `matches.length > 0` is always true.

A data router renders the root's `errorElement` instead of its element on a
404. A hook hosted in the root element therefore unmounts, and the tracker is
cleared: nothing is reported, and nothing leaks. Wherever the hook IS rendered
for an unmatched URL, mark the 404 with `useMarkRouteUnmatched()`. That means
a `path="*"` route under it, or an `errorElement` that hosts it. In an
`errorElement`, mark it when `isRouteErrorResponse(error) && error.status === 404`.

```tsx
import { useLocation, useParams, Outlet } from 'react-router-dom';
import {
  RouteUnmatchedContext,
  routePatternFromParams,
  useMarkRouteUnmatched,
  useRouteAwareness,
  useRouteUnmatchedSignal,
} from '@qontinui/ui-bridge/react';

function App() {
  const location = useLocation();
  const params = useParams();
  const unmatched = useRouteUnmatchedSignal();

  useRouteAwareness(
    {
      pattern: routePatternFromParams(location.pathname, params, { matched: true }),
      patternSource: 'router',
      queryParams: Object.fromEntries(new URLSearchParams(location.search)),
    },
    { unmatched },
  );

  return (
    <RouteUnmatchedContext.Provider value={unmatched}>
      <Outlet />
    </RouteUnmatchedContext.Provider>
  );
}

// The `path="*"` route's element
function NoMatch() {
  useMarkRouteUnmatched();
  return <p>Not found</p>;
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

Derives the pattern by value substitution:

- A path segment equal to a param value becomes `[name]`. That includes a
  value with a `/` in it that sits in one segment as `%2F`.
- A catch-all array's run of segments becomes `[...name]`. So does a React
  Router splat string that spans several segments.
- Segments and values are compared raw and after each successive
  `decodeURIComponent`, on both sides.

It then fails closed and returns `null` when:

- `matched` is `false`;
- the pathname contains `?` or `#`;
- a segment or value is still changing after four decodes;
- any decoded form of a non-template output segment CONTAINS any decoded form
  of a param value or of one of its pieces. This catches `/files/abc.json`
  for `:id.json`. It also nulls some legitimate paths when a value is short:
  `{ id: '1' }` nulls `/v1/items/1`. That is the intended direction.

The guarantee is that a non-null result contains no value from `params`. It
holds for user input only when two things are true:

- `params` is the router's complete, raw params for the route that matched;
- `matched` is `false`, or the not-found signal is raised, whenever no route
  matched.

Text the router never reported as a param is not checked.

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
