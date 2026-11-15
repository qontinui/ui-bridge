/**
 * The not-found signal: a layout's single useRouteAwareness call must NEVER
 * report the concrete path of a 404, even though it computes its pattern at
 * render time with `matched: true` and the router's params are `{}` there.
 * Every assertion is over EVERY setRouteInfo call, not only the last.
 */

import React, { Suspense, startTransition, use, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRouteAwareness } from '../useRouteAwareness';
import { routePatternFromParams } from '../routePatternFromParams';
import {
  RouteUnmatchedContext,
  createRouteUnmatchedSignal,
  useMarkRouteUnmatched,
  useRouteUnmatchedSignal,
} from '../routeUnmatched';
import type { UIBridgeContextValue } from '../UIBridgeProvider';
import type { RouteInfo } from '../../navigation/types';

const setRouteInfo = vi.fn<(info: RouteInfo | undefined) => void>();
const bridge = { navigationTracker: { setRouteInfo } } as unknown as UIBridgeContextValue;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => bridge,
}));

const SENTINEL = 'JP2SENTINELw4r8mv';

function reported(): (RouteInfo | undefined)[] {
  return setRouteInfo.mock.calls.map((c) => c[0]);
}

function expectNoConcretePattern(): void {
  for (const info of reported()) {
    expect(info?.pattern ?? '').not.toContain(SENTINEL);
  }
}

/** The documented Next.js shape: one hook in the layout, the signal below it. */
function Layout({
  pathname,
  params,
  children,
}: {
  pathname: string;
  params: Record<string, string | string[]>;
  children: React.ReactNode;
}) {
  const unmatched = useRouteUnmatchedSignal();
  useRouteAwareness(
    {
      pattern: routePatternFromParams(pathname, params, { matched: true }),
      patternSource: 'router',
    },
    { unmatched }
  );
  return <RouteUnmatchedContext value={unmatched}>{children}</RouteUnmatchedContext>;
}

function NotFound() {
  useMarkRouteUnmatched();
  return <p>Not found</p>;
}

function Page() {
  return <p>page</p>;
}

describe('useRouteAwareness with the not-found signal', () => {
  beforeEach(() => {
    setRouteInfo.mockClear();
  });

  it('a 404 on first mount reports pattern null, never the concrete path', () => {
    render(
      <Layout pathname={`/search/${SENTINEL}`} params={{}}>
        <NotFound />
      </Layout>
    );
    expect(setRouteInfo).toHaveBeenCalled();
    expect(setRouteInfo).toHaveBeenLastCalledWith({ pattern: null, patternSource: 'router' });
    expectNoConcretePattern();
  });

  it('a client navigation from a matched page to a 404 never reports the concrete path', () => {
    const { rerender } = render(
      <Layout pathname="/marketplace/widget" params={{ slug: 'widget' }}>
        <Page />
      </Layout>
    );
    expect(setRouteInfo).toHaveBeenLastCalledWith({
      pattern: '/marketplace/[slug]',
      patternSource: 'router',
    });
    rerender(
      <Layout pathname={`/search/${SENTINEL}`} params={{}}>
        <NotFound />
      </Layout>
    );
    expect(setRouteInfo).toHaveBeenLastCalledWith({ pattern: null, patternSource: 'router' });
    expectNoConcretePattern();
  });

  it('leaving a 404 for a matched page reports the new template', () => {
    const { rerender } = render(
      <Layout pathname={`/search/${SENTINEL}`} params={{}}>
        <NotFound />
      </Layout>
    );
    rerender(
      <Layout pathname={`/marketplace/${SENTINEL}`} params={{ slug: SENTINEL }}>
        <Page />
      </Layout>
    );
    expect(setRouteInfo).toHaveBeenLastCalledWith({
      pattern: '/marketplace/[slug]',
      patternSource: 'router',
    });
    expectNoConcretePattern();
  });

  it('unmounting the whole tree on a 404 never reports the concrete path', () => {
    const { unmount } = render(
      <Layout pathname={`/search/${SENTINEL}`} params={{}}>
        <NotFound />
      </Layout>
    );
    unmount();
    expect(setRouteInfo).toHaveBeenLastCalledWith(undefined);
    expectNoConcretePattern();
  });

  it('a not-found boundary mounting after the last report re-reports pattern null', () => {
    let show: (v: boolean) => void = () => {};
    function Late() {
      const [visible, setVisible] = useState(false);
      show = setVisible;
      return visible ? <NotFound /> : null;
    }
    render(
      <Layout pathname="/login" params={{}}>
        <Late />
      </Layout>
    );
    expect(setRouteInfo).toHaveBeenLastCalledWith({ pattern: '/login', patternSource: 'router' });
    act(() => show(true));
    expect(setRouteInfo).toHaveBeenLastCalledWith({ pattern: null, patternSource: 'router' });
  });

  it('control: WITHOUT the signal, the same 404 reports the concrete path', () => {
    // Pins why the signal exists: matched:true in a layout leaks on a 404.
    function Bare() {
      useRouteAwareness({
        pattern: routePatternFromParams(`/search/${SENTINEL}`, {}, { matched: true }),
        patternSource: 'router',
      });
      return null;
    }
    render(<Bare />);
    expect(setRouteInfo).toHaveBeenLastCalledWith({
      pattern: `/search/${SENTINEL}`,
      patternSource: 'router',
    });
  });

  it('control: a second useRouteAwareness in the not-found child is overwritten by the layout', () => {
    // Pins why the docs forbid it: child passive effects run before the parent's.
    function NaiveNotFound() {
      useRouteAwareness({ pattern: null, patternSource: 'router' });
      return null;
    }
    function NaiveLayout({ children }: { children: React.ReactNode }) {
      useRouteAwareness({
        pattern: routePatternFromParams(`/search/${SENTINEL}`, {}, { matched: true }),
        patternSource: 'router',
      });
      return <>{children}</>;
    }
    render(
      <NaiveLayout>
        <NaiveNotFound />
      </NaiveLayout>
    );
    expect(setRouteInfo).toHaveBeenLastCalledWith({
      pattern: `/search/${SENTINEL}`,
      patternSource: 'router',
    });
  });

  // A component that OWNS the signal (e.g. a React Router errorElement hosting
  // the hook itself) is not below its own provider. The pattern is computed
  // with matched:true here so that ONLY the signal stands between it and a leak.
  function SelfHosted({ explicit }: { explicit: boolean }) {
    const unmatched = useRouteUnmatchedSignal();
    useRouteAwareness(
      {
        pattern: routePatternFromParams(`/search/${SENTINEL}`, {}, { matched: true }),
        patternSource: 'router',
      },
      { unmatched }
    );
    useMarkRouteUnmatched(explicit ? unmatched : undefined);
    return null;
  }

  it('a component owning the signal marks it with the explicit form', () => {
    // Also pins useLayoutEffect: marker and hook share a component, and its
    // passive effects run in declaration order (hook first).
    render(<SelfHosted explicit />);
    expect(setRouteInfo).toHaveBeenLastCalledWith({ pattern: null, patternSource: 'router' });
    expectNoConcretePattern();
  });

  it('control: the context-read form no-ops in a component owning the signal', () => {
    render(<SelfHosted explicit={false} />);
    expect(setRouteInfo).toHaveBeenLastCalledWith({
      pattern: `/search/${SENTINEL}`,
      patternSource: 'router',
    });
  });

  it('a marker in a LATER SIBLING of the host still reports null first', () => {
    // Pins useLayoutEffect: a sibling's passive effect runs after the host's,
    // so a passive-effect marker would let the concrete path through first.
    const signal = createRouteUnmatchedSignal();
    function Host() {
      useRouteAwareness(
        {
          pattern: routePatternFromParams(`/search/${SENTINEL}`, {}, { matched: true }),
          patternSource: 'router',
        },
        { unmatched: signal }
      );
      return null;
    }
    function SiblingMarker() {
      useMarkRouteUnmatched(signal);
      return null;
    }
    render(
      <>
        <Host />
        <SiblingMarker />
      </>
    );
    expect(setRouteInfo).toHaveBeenLastCalledWith({ pattern: null, patternSource: 'router' });
    expectNoConcretePattern();
  });

  it('a raise in the same commit as a navigation reports that navigation, not the last one', () => {
    // Pins useInsertionEffect for the ref the subscription reads. A child's
    // layout effect runs BEFORE its parent's, so a ref refreshed in the
    // layout's own layout effect would still hold the previous route here.
    // (A render-phase write was early enough too; that write is the defect the
    // abandoned-render case below pins.)
    function QueryLayout({ q, children }: { q: string; children: React.ReactNode }) {
      const unmatched = useRouteUnmatchedSignal();
      useRouteAwareness(
        { pattern: '/search', patternSource: 'router', queryParams: { q } },
        { unmatched }
      );
      return <RouteUnmatchedContext value={unmatched}>{children}</RouteUnmatchedContext>;
    }
    const { rerender } = render(
      <QueryLayout q="before">
        <Page />
      </QueryLayout>
    );
    setRouteInfo.mockClear();
    rerender(
      <QueryLayout q="after">
        <NotFound />
      </QueryLayout>
    );
    // The raise reports first, from the boundary's layout effect.
    expect(reported()[0]).toEqual({
      pattern: null,
      patternSource: 'router',
      queryParams: { q: 'after' },
    });
    for (const info of reported()) {
      if (info) expect(info.queryParams).toEqual({ q: 'after' });
    }
  });

  it('the signal counts raises and lowers each raise once', () => {
    const signal = createRouteUnmatchedSignal();
    const lowerA = signal.raise();
    const lowerB = signal.raise();
    expect(signal.count).toBe(2);
    lowerA();
    lowerA();
    expect(signal.count).toBe(1);
    lowerB();
    expect(signal.count).toBe(0);
  });

  it('useMarkRouteUnmatched is a no-op with no signal', () => {
    expect(() => render(<NotFound />)).not.toThrow();
  });
});

// A transition render that suspends runs the layout's render and never
// commits. A raise that arrives afterwards, from an URGENT commit the layout
// does not re-render in, must report the info the layout last COMMITTED.
// `act` is off: it would drive the suspended transition and the urgent update
// together. Every expectation is a literal.
describe('useRouteAwareness after an abandoned transition render, outside act', () => {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let savedAct: boolean | undefined;
  beforeAll(() => {
    savedAct = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterAll(() => {
    g.IS_REACT_ACT_ENVIRONMENT = savedAct;
  });
  beforeEach(() => {
    setRouteInfo.mockClear();
  });

  // A PRECONDITION wait: React renders and commits on its own schedule here.
  // Never used for the property under test.
  const until = (pred: () => boolean, what: string) =>
    vi.waitFor(
      () => {
        if (!pred()) throw new Error(`timed out waiting for: ${what}`);
      },
      { timeout: 2000, interval: 10 }
    );

  it('a not-found raise from an urgent commit publishes the COMMITTED route info', async () => {
    const never = new Promise<never>(() => {});
    let suspends = 0;
    function Never(): React.ReactNode {
      suspends += 1;
      return use(never);
    }
    const layoutRenders: string[] = [];
    function QueryLayout({ q, children }: { q: string; children: React.ReactNode }) {
      layoutRenders.push(q);
      const unmatched = useRouteUnmatchedSignal();
      useRouteAwareness(
        { pattern: '/search', patternSource: 'router', queryParams: { q } },
        { unmatched }
      );
      return (
        <RouteUnmatchedContext value={unmatched}>
          <span>{q}</span>
          {children}
        </RouteUnmatchedContext>
      );
    }
    let show: (v: boolean) => void = () => {};
    function Late() {
      const [visible, setVisible] = useState(false);
      show = setVisible;
      return visible ? <NotFound /> : null;
    }
    function App({ q, suspend }: { q: string; suspend: boolean }) {
      return (
        <Suspense fallback={<i>fallback</i>}>
          <QueryLayout q={q}>
            <Late />
            {suspend ? <Never /> : null}
          </QueryLayout>
        </Suspense>
      );
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<App q="committed" suspend={false} />);
    await until(() => setRouteInfo.mock.calls.length > 0, 'the first report');
    expect(reported()).toEqual([
      { pattern: '/search', patternSource: 'router', queryParams: { q: 'committed' } },
    ]);

    // The transition renders the layout with a new query, then suspends.
    setRouteInfo.mockClear();
    const before = layoutRenders.length;
    startTransition(() => {
      root.render(<App q="abandoned" suspend />);
    });
    await until(() => suspends > 0, 'the transition render to suspend');
    expect(layoutRenders.slice(before)).toContain('abandoned');
    // It never committed: nothing was reported and the DOM is unchanged.
    expect(setRouteInfo).not.toHaveBeenCalled();
    expect(container.textContent).toBe('committed');

    // The urgent commit: a not-found boundary mounts BELOW the layout, which
    // does not re-render, and raises the signal from its layout effect.
    const atRaise = layoutRenders.length;
    show(true);
    await until(() => setRouteInfo.mock.calls.length > 0, 'the raise to report');

    expect(container.textContent).toBe('committedNot found');
    // Precondition: the layout rendered only the abandoned query since (React
    // retries the transition), never the committed one, so nothing but the
    // committed ref can have supplied 'committed' below.
    expect(layoutRenders.slice(atRaise).every((q) => q === 'abandoned')).toBe(true);
    expect(reported()).toEqual([
      { pattern: null, patternSource: 'router', queryParams: { q: 'committed' } },
    ]);

    root.unmount();
    container.remove();
  });
});
