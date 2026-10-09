/**
 * The not-found signal: a layout's single useRouteAwareness call must NEVER
 * report the concrete path of a 404, even though it computes its pattern at
 * render time with `matched: true` and the router's params are `{}` there.
 * Every assertion is over EVERY setRouteInfo call, not only the last.
 */

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
