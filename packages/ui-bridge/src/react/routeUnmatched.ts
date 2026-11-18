/**
 * The "unmatched route" signal — how a not-found boundary tells the ONE
 * `useRouteAwareness` call that this render is a 404, in time.
 *
 * Why it is a signal and not a second `useRouteAwareness` call: React runs a
 * child's passive effects BEFORE its parent's, so a not-found component's own
 * `useRouteAwareness({ pattern: null })` is overwritten in the same commit by
 * the layout's call — which, for a 404, carries the concrete path. And why the
 * layout cannot just pass `matched: false`: its render (where `pattern` is
 * computed) runs before the not-found component exists, so it cannot know.
 *
 * The mechanism: the layout owns a signal (`useRouteUnmatchedSignal`) and
 * provides it through `RouteUnmatchedContext`; the not-found boundary calls
 * `useMarkRouteUnmatched()`, which raises it in `useLayoutEffect`. All layout
 * effects of a commit run before any passive effect, so when the layout's
 * `useRouteAwareness(info, { unmatched })` effect runs it already sees the
 * signal and reports `pattern: null` instead of whatever was computed.
 *
 * Why a LAYOUT effect: for a marker that is a descendant of the hook's host,
 * plain passive-effect ordering (children first) would already suffice, so
 * there it is belt-and-braces. It is load-bearing wherever the marker is NOT
 * a descendant: in the SAME component as the hook (an `errorElement` that
 * hosts both — its passive effects run in declaration order, hook first), or
 * in a later sibling. Pinned by `useRouteAwareness.unmatched.test.tsx`.
 *
 * A marker that does not sit below the provider — the `errorElement` that
 * itself creates the signal and calls `useRouteAwareness` — must pass the
 * signal explicitly: `useMarkRouteUnmatched(unmatched)`. The context-read form
 * reads the context ABOVE that component, finds none, and silently no-ops.
 *
 * Precondition: the not-found boundary must mount in the SAME commit as the
 * navigation that reached it (Next.js `not-found.tsx` does). One that mounts
 * later (behind a Suspense boundary that resolves afterwards) re-reports
 * `pattern: null` when it mounts, but the layout's earlier report has already
 * been made.
 */

import { createContext, use, useLayoutEffect, useState } from 'react';

/** A provider-owned counter of mounted not-found boundaries. */
export interface RouteUnmatchedSignal {
  /** Number of not-found boundaries currently mounted; > 0 means unmatched. */
  readonly count: number;
  /** Raise (mount) — returns the matching lower (unmount) function. */
  raise(): () => void;
  /** Subscribe to raises; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Create a signal. Prefer `useRouteUnmatchedSignal` inside a component. */
export function createRouteUnmatchedSignal(): RouteUnmatchedSignal {
  let count = 0;
  const listeners = new Set<() => void>();
  return {
    get count() {
      return count;
    },
    raise() {
      count += 1;
      for (const listener of Array.from(listeners)) {
        try {
          listener();
        } catch {
          // A listener error must not break the not-found render.
        }
      }
      let lowered = false;
      return () => {
        if (lowered) return;
        lowered = true;
        count -= 1;
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A signal that is stable for the component's lifetime. */
export function useRouteUnmatchedSignal(): RouteUnmatchedSignal {
  const [signal] = useState(createRouteUnmatchedSignal);
  return signal;
}

/**
 * Carries the layout's signal down to the not-found boundary. Provide the same
 * signal you pass to `useRouteAwareness(info, { unmatched })`.
 */
export const RouteUnmatchedContext = createContext<RouteUnmatchedSignal | null>(null);

/**
 * Call from the not-found boundary (Next.js `app/not-found.tsx`, a React
 * Router `path="*"` element, or a 404 `errorElement`). Raises the signal from
 * `RouteUnmatchedContext` (or the one passed) for as long as it is mounted.
 * A no-op when there is no signal — so a component that OWNS the signal
 * (it is not below its own provider) must pass it: `useMarkRouteUnmatched(unmatched)`.
 */
export function useMarkRouteUnmatched(signal?: RouteUnmatchedSignal | null): void {
  const fromContext = use(RouteUnmatchedContext);
  const target = signal ?? fromContext;
  useLayoutEffect(() => {
    if (!target) return;
    return target.raise();
  }, [target]);
}
