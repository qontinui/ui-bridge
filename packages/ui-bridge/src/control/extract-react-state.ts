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
import {
  hasRedactionBoundaryBelow,
  isValueRedacted,
  scrubReactProps,
  verdictOf,
} from '../core/redaction';
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

type Fiber = Record<string, unknown>;

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
  // `children` (and any render prop) of a NON-redacted wrapper — a `<label>`,
  // a `<form>`, a `<div>` — can be a React element for a redacted child, and
  // that element's own `props.value` is the child's cleartext secret. The
  // wrapper's verdict says nothing about it, so elements are COLLAPSED to
  // `<type>` here and never walked.
  const props = scrubReactProps(
    safeSerialize(rawProps, undefined, 0, true) as Record<string, unknown>,
    reactVerdict
  );

  // Walk the memoizedState linked list to extract useState/useReducer values
  const fiberState: unknown[] = [];
  let componentName: string | undefined;

  // ONE walk up to the nearest function/class component: its hooks are the
  // state read below, and its rendered subtree is what the withholding check
  // walks.
  const hostFiber = reactFiberKey ? (el[reactFiberKey] as Fiber | undefined) : undefined;
  const component = componentFiberOf(hostFiber);
  if (component) {
    const type = component.type as { displayName?: string; name?: string };
    componentName = type.displayName || type.name || undefined;
  }
  // The memoizedState chain of the component fiber (not the DOM fiber), else
  // of the host fiber itself.
  let stateNode = (component ?? hostFiber)?.memoizedState as Record<string, unknown> | null;
  let stateCount = 0;
  const maxStates = 20; // Safety limit
  while (stateNode && stateCount < maxStates) {
    fiberState.push(safeSerialize(stateNode.memoizedState, undefined, 0, true));
    stateNode = stateNode.next as Record<string, unknown> | null;
    stateCount++;
  }

  if (reactVerdict.value) {
    return { props, fiberState: [], componentName: undefined };
  }
  // The same leak through STATE: the nearest component of a non-redacted
  // wrapper is often the one holding the secret (`const [pw, setPw] =
  // useState('')` in the form that renders the password input). A raw string
  // cannot be told from any other, so when that component — or the wrapper
  // itself — renders a value-redacted element, its state is withheld whole.
  if (fiberState.length > 0 && rendersRedactedElement(element, component)) {
    return { props, fiberState: [], componentName, note: FIBER_STATE_WITHHELD_NOTE };
  }
  return { props, fiberState, componentName };
}

/** The `note` an answer carries when its `fiberState` was withheld. */
export const FIBER_STATE_WITHHELD_NOTE =
  "fiberState withheld: this component renders a redacted element (a password input or a data-bridge-redact boundary), so its state may hold that element's value";

/**
 * How many fibers {@link rendersRedactedElement} visits before it gives up and
 * answers "renders one" — a walk it could not finish is not evidence of absence.
 */
const RENDERED_SUBTREE_FIBER_CAP = 10_000;

/** The nearest function/class component fiber at or above `hostFiber`. */
function componentFiberOf(hostFiber: Fiber | undefined): Fiber | null {
  let current = hostFiber;
  while (current) {
    if (typeof current.type === 'function') return current;
    current = current.return as Fiber | undefined;
  }
  return null;
}

/** Is `node` an element (realm-safe: no `instanceof`)? */
function isDomElement(node: unknown): node is HTMLElement {
  return (
    node !== null &&
    typeof node === 'object' &&
    (node as { nodeType?: unknown }).nodeType === 1 &&
    typeof (node as { querySelectorAll?: unknown }).querySelectorAll === 'function'
  );
}

/** Does `root`, or anything in its DOM subtree, carry a VALUE redaction? */
function domSubtreeIsValueRedacted(root: HTMLElement): boolean {
  if (isValueRedacted(root) || hasRedactionBoundaryBelow(root)) return true;
  for (const input of Array.from(root.querySelectorAll('input'))) {
    if (isValueRedacted(input)) return true;
  }
  return false;
}

/**
 * Does `element`'s own DOM subtree, or any host node the component fiber
 * renders, carry a VALUE redaction? Fails closed past
 * {@link RENDERED_SUBTREE_FIBER_CAP} fibers.
 */
function rendersRedactedElement(element: HTMLElement, component: Fiber | null): boolean {
  if (domSubtreeIsValueRedacted(element)) return true;
  if (!component) return false;
  const stack: Fiber[] = [];
  const first = component.child as Fiber | undefined;
  if (first) stack.push(first);
  let visited = 0;
  while (stack.length > 0) {
    const fiber = stack.pop()!;
    if (++visited > RENDERED_SUBTREE_FIBER_CAP) return true;
    if (isDomElement(fiber.stateNode) && domSubtreeIsValueRedacted(fiber.stateNode)) return true;
    const sibling = fiber.sibling as Fiber | undefined;
    if (sibling) stack.push(sibling);
    const child = fiber.child as Fiber | undefined;
    if (child) stack.push(child);
  }
  return false;
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
