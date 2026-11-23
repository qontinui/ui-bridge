/**
 * The React-state projection of one DOM element (`extractReactState`), and the
 * bounded serializer it — and the component capture's prop reader in
 * `./action-executor.ts` — walks React internals with.
 *
 * Browser-safe and dependency-light, so the in-page command dispatcher
 * (`react/commandHandlers.ts`) and the in-process handlers
 * (`server/handlers.ts`) serve `getElementReactState` from ONE projection,
 * §4.6 scrub included.
 */
import { scrubReactProps, verdictOf } from '../core/redaction';
import { typeName } from './react-fiber';
import type { ReactStateInfo } from './types';

/**
 * Recursion depth cap for safeSerialize.
 *
 * Without a cap, walking a useContext-style memoizedState whose value
 * carries DOM-node back-refs (each with `__reactFiber$` back-references
 * into parent fibers) explodes the fanout. The WeakSet eventually
 * terminates the walk via cycle detection, but for a runner UI with a
 * few hundred registered elements the unguarded walk can run for >10s
 * — long enough to blow the 10s IPC timeout in
 * `qontinui-runner/src-tauri/src/mcp/ui_bridge/request.rs` before
 * `extractReactState` ever returns. 6 is empirically deep enough for
 * normal hook state (props/state are rarely nested past 3-4) without
 * letting pathological graphs run away.
 */
const SAFE_SERIALIZE_MAX_DEPTH = 6;

/**
 * Safely serialize a value, replacing functions and handling circular
 * references. Exported for the component capture's prop reader
 * (`extractComponentFiberProps`, `./action-executor.ts`).
 */
export function safeSerialize(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
  compactElements = false
): unknown {
  if (depth > SAFE_SERIALIZE_MAX_DEPTH) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return '[Function]';
  if (typeof value !== 'object') return value;

  const obj = value as object;

  // With `compactElements`, React-owned objects never get walked: a React
  // element (`children`, render props) carries the dev-mode `_owner` fiber
  // graph and `_store`, so it collapses to `<Type>`; a memo / forwardRef
  // component TYPE passed as a prop collapses to `[memo Foo]`-style labels,
  // distinct from elements. Checked before the seen-set, so the same element
  // reused in two props prints `<Type>` both times, not `[Circular]`.
  if (compactElements) {
    const compact = compactReactObject(obj);
    if (compact !== undefined) return compact;
  }

  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  // DOM node short-circuit. React stores DOM refs in fiber.stateNode and
  // useRef hooks; walking them would descend into __reactFiber$/__reactProps$
  // back-references attached as own enumerable properties by React, plus
  // any data-* attributes. The Element/Document/Window guards are
  // typeof-protected so this same module still works in non-DOM
  // environments (the SDK's server-side handlers import from here too).
  if (typeof Element !== 'undefined' && obj instanceof Element) {
    return `[${obj.constructor.name}]`;
  }
  if (typeof Document !== 'undefined' && obj instanceof Document) {
    return '[Document]';
  }
  if (typeof Window !== 'undefined' && obj instanceof Window) {
    return '[Window]';
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => safeSerialize(item, seen, depth + 1, compactElements));
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    try {
      result[key] = safeSerialize(
        (obj as Record<string, unknown>)[key],
        seen,
        depth + 1,
        compactElements
      );
    } catch {
      result[key] = '[Error reading property]';
    }
  }
  return result;
}

const REACT_ELEMENT_TYPES: ReadonlySet<symbol> = new Set([
  Symbol.for('react.element'),
  Symbol.for('react.transitional.element'),
]);
const REACT_FRAGMENT_TYPE = Symbol.for('react.fragment');
const REACT_TYPE_LABELS: ReadonlyMap<symbol, string> = new Map([
  [Symbol.for('react.memo'), 'memo'],
  [Symbol.for('react.forward_ref'), 'forwardRef'],
]);

/**
 * `<Type>` for a real React element, `[memo Foo]` / `[forwardRef Foo]` for a
 * memo / forwardRef component type, else `undefined` (serialize normally).
 */
function compactReactObject(obj: object): string | undefined {
  const tag = (obj as { $$typeof?: unknown }).$$typeof;
  if (typeof tag !== 'symbol') return undefined;
  if (REACT_ELEMENT_TYPES.has(tag)) {
    const type = (obj as { type?: unknown }).type;
    if (type === REACT_FRAGMENT_TYPE) return '<Fragment>';
    if (typeof type === 'string') return `<${type}>`;
    if (typeof type === 'symbol') return `<${type.description ?? 'Unknown'}>`;
    return `<${typeName(type) ?? 'Unknown'}>`;
  }
  const label = REACT_TYPE_LABELS.get(tag);
  return label ? `[${label} ${typeName(obj) ?? 'Anonymous'}]` : undefined;
}

/**
 * Extract React state from a DOM element's React fiber internals.
 *
 * Walks the `__reactFiber$` key to extract `memoizedState` (useState values)
 * and the `__reactProps$` key for current props.
 */
export function extractReactState(element: HTMLElement): ReactStateInfo | null {
  const el = element as unknown as Record<string, unknown>;

  // Find React internal keys
  const reactPropsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
  const reactFiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));

  if (!reactPropsKey && !reactFiberKey) {
    return null; // Not a React-managed element
  }

  // §4.6: this projection reads React INTERNALS, not the DOM — for a controlled
  // `<input type="password">` `props.value` IS the cleartext secret, and the
  // fiber `memoizedState` can hold it too. VALUE axis: collapse every prop
  // VALUE to the sentinel (KEYS survive — they are source identifiers the
  // developer wrote), and drop `fiberState`/`componentName`, while still
  // reporting the element as React-managed (non-null return) so callers can
  // tell "redacted" from "not React".
  const reactVerdict = verdictOf(element);
  // Extract props (replace functions with marker strings)
  const rawProps = reactPropsKey
    ? ((el[reactPropsKey] as Record<string, unknown> | undefined) ?? {})
    : {};
  const props = scrubReactProps(safeSerialize(rawProps) as Record<string, unknown>, reactVerdict);

  // Walk the memoizedState linked list to extract useState/useReducer values
  const fiberState: unknown[] = [];
  let componentName: string | undefined;

  if (reactFiberKey) {
    const fiber = el[reactFiberKey] as Record<string, unknown> | undefined;
    if (fiber) {
      // Walk up to find the nearest function/class component
      let current: Record<string, unknown> | undefined = fiber;
      while (current) {
        const type = current.type;
        if (typeof type === 'function') {
          componentName =
            (type as { displayName?: string; name?: string }).displayName ||
            (type as { name?: string }).name ||
            undefined;
          break;
        }
        current = current.return as Record<string, unknown> | undefined;
      }

      // Extract memoizedState chain from the component fiber (not the DOM fiber)
      const componentFiber = current || fiber;
      let stateNode = componentFiber?.memoizedState as Record<string, unknown> | null;
      let stateCount = 0;
      const maxStates = 20; // Safety limit
      while (stateNode && stateCount < maxStates) {
        fiberState.push(safeSerialize(stateNode.memoizedState));
        stateNode = stateNode.next as Record<string, unknown> | null;
        stateCount++;
      }
    }
  }

  return {
    props,
    fiberState: reactVerdict.value ? [] : fiberState,
    componentName: reactVerdict.value ? undefined : componentName,
  };
}

/**
 * The `getElementReactState` answer for a live element with no React
 * internals: an explicit, typed "not React" rather than `null`, the same on
 * every transport.
 */
export function noReactInternals(): ReactStateInfo {
  return {
    props: {},
    fiberState: [],
    componentName: undefined,
    note: 'No React internals found on this element',
  };
}
