/**
 * React fiber STRUCTURE helpers — resolving a DOM node's current fiber,
 * walking to its owning component, naming that component and enumerating the
 * host nodes under a fiber.
 *
 * §4.6: nothing here reads props or state. Props leave the fiber only through
 * `extractOwnerComponentProps` / `extractReactState` (control/action-executor.ts),
 * which scrub them through `scrubReactProps`.
 *
 * Why "current": React stores ONE fiber on each host DOM node (the
 * `__reactFiber$` key) and does not refresh it on every commit, so after an
 * odd number of updates that stored fiber is the ALTERNATE — the stale tree
 * whose child pointers predate the last render. {@link currentFiber} ports
 * React's own `findCurrentFiberUsingSlowPath` (ReactFiberTreeReflection) to
 * pick the live one, as React DevTools does.
 */

/** The fiber fields these helpers read. */
export interface FiberLike {
  tag?: number;
  type?: unknown;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  return?: FiberLike | null;
  alternate?: FiberLike | null;
  stateNode?: unknown;
}

/** React work tags (stable across React 16-19). */
export const FIBER_TAG = {
  FunctionComponent: 0,
  ClassComponent: 1,
  HostRoot: 3,
  HostPortal: 4,
  ForwardRef: 11,
  MemoComponent: 14,
  SimpleMemoComponent: 15,
} as const;

const COMPONENT_TAGS: ReadonlySet<number> = new Set([
  FIBER_TAG.FunctionComponent,
  FIBER_TAG.ClassComponent,
  FIBER_TAG.ForwardRef,
  FIBER_TAG.MemoComponent,
  FIBER_TAG.SimpleMemoComponent,
]);

/** The fiber React stored on a DOM node, as stored (possibly the alternate). */
export function storedFiberOf(el: Element): FiberLike | undefined {
  const rec = el as unknown as Record<string, unknown>;
  const key = Object.keys(rec).find((k) => k.startsWith('__reactFiber$'));
  return key ? (rec[key] as FiberLike | undefined) : undefined;
}

/** `true` when React manages this DOM node. */
export function isReactManaged(el: Element): boolean {
  return storedFiberOf(el) !== undefined;
}

/** The CURRENT host fiber of a DOM node, or `undefined` (not React / unmounted). */
export function hostFiberOf(el: Element): FiberLike | undefined {
  const stored = storedFiberOf(el);
  return stored ? currentFiber(stored) : undefined;
}

/**
 * Port of React's `findCurrentFiberUsingSlowPath`: of a fiber and its
 * alternate, the one in the committed tree. `undefined` when the structure
 * says the fiber is unmounted (React throws there).
 */
export function currentFiber(fiber: FiberLike): FiberLike | undefined {
  const alternate = fiber.alternate ?? null;
  if (!alternate) return fiber;
  let a: FiberLike = fiber;
  let b: FiberLike = alternate;
  for (let guard = 0; guard < 10_000; guard++) {
    const parentA = a.return ?? null;
    if (!parentA) break;
    const parentB = parentA.alternate ?? null;
    if (!parentB) {
      const nextParent = parentA.return ?? null;
      if (nextParent) {
        a = b = nextParent;
        continue;
      }
      break;
    }
    if (parentA.child === parentB.child) {
      for (let child = parentA.child ?? null; child; child = child.sibling ?? null) {
        if (child === a) return fiber;
        if (child === b) return alternate;
      }
      return undefined;
    }
    if (a.return !== b.return) {
      a = parentA;
      b = parentB;
    } else {
      let found = false;
      for (let child = parentA.child ?? null; child; child = child.sibling ?? null) {
        if (child === a) {
          found = true;
          a = parentA;
          b = parentB;
          break;
        }
        if (child === b) {
          found = true;
          b = parentA;
          a = parentB;
          break;
        }
      }
      if (!found) {
        for (let child = parentB.child ?? null; child; child = child.sibling ?? null) {
          if (child === a) {
            found = true;
            a = parentB;
            b = parentA;
            break;
          }
          if (child === b) {
            found = true;
            b = parentB;
            a = parentA;
            break;
          }
        }
        if (!found) return undefined;
      }
    }
  }
  if (a.tag !== FIBER_TAG.HostRoot) return undefined;
  const root = a.stateNode as { current?: unknown } | null | undefined;
  return root?.current === a ? fiber : alternate;
}

/** `true` for a function / class / forwardRef / memo component fiber. */
export function isComponentFiber(f: FiberLike): boolean {
  if (typeof f.tag === 'number' && COMPONENT_TAGS.has(f.tag)) return true;
  return typeof f.type === 'function';
}

/** The nearest component fiber at or above `fiber`. */
export function owningComponentFiber(fiber: FiberLike): FiberLike | undefined {
  for (let f: FiberLike | null | undefined = fiber; f; f = f.return) {
    if (isComponentFiber(f)) return f;
  }
  return undefined;
}

/**
 * A component fiber's display name: `displayName`, else the function name,
 * unwrapping forwardRef (`type.render`) and memo (`type.type`) objects.
 */
export function componentNameOf(fiber: FiberLike): string | undefined {
  return nameOfType(fiber.type, 0);
}

function nameOfType(type: unknown, depth: number): string | undefined {
  if (depth > 5 || type === null || type === undefined) return undefined;
  if (typeof type === 'function') {
    const fn = type as { displayName?: unknown; name?: unknown };
    if (typeof fn.displayName === 'string' && fn.displayName) return fn.displayName;
    return typeof fn.name === 'string' && fn.name ? fn.name : undefined;
  }
  if (typeof type === 'object') {
    const obj = type as { displayName?: unknown; render?: unknown; type?: unknown };
    if (typeof obj.displayName === 'string' && obj.displayName) return obj.displayName;
    return nameOfType(obj.render, depth + 1) ?? nameOfType(obj.type, depth + 1);
  }
  return undefined;
}

/**
 * Connected host DOM nodes at or under `fiber` (portals included), at most
 * `budget` fibers visited. `exhausted` says the walk stopped early, so the
 * list is incomplete.
 */
export function hostElementsUnder(
  fiber: FiberLike,
  budget: number
): { elements: Element[]; exhausted: boolean } {
  const elements: Element[] = [];
  let left = budget;
  const visit = (f: FiberLike | null | undefined, includeSiblings: boolean): void => {
    for (let cur = f; cur; cur = includeSiblings ? cur.sibling : null) {
      if (left <= 0) return;
      left--;
      if (isElement(cur.stateNode) && cur.stateNode.isConnected) elements.push(cur.stateNode);
      visit(cur.child, true);
      if (!includeSiblings) return;
    }
  };
  visit(fiber, false);
  return { elements, exhausted: left <= 0 };
}

export function isElement(value: unknown): value is Element {
  return typeof Element !== 'undefined' && value instanceof Element;
}
