import { describe, it, expect } from 'vitest';
import {
  expoRouterPattern,
  isExpoRouterUnmatched,
  reactNavigationPattern,
  type NavigationStateLike,
} from '../routePattern';

/**
 * Pure route-pattern helpers for React Native routers (plan
 * `2026-10-10-ui-bridge-native-exports-no-use-route-awareness`, Phase 1).
 *
 * Every expected value is a spelled-out literal: a pattern is persisted as a
 * template by the runner's journey ledger, so the exact string is the
 * contract, and a `null` is the fail-closed answer that keeps user input out.
 */

describe('expoRouterPattern', () => {
  it('maps an empty segment list to the root', () => {
    expect(expoRouterPattern([])).toBe('/');
  });

  it('keeps a dynamic segment as its file-route name', () => {
    expect(expoRouterPattern(['profile', '[user]'])).toBe('/profile/[user]');
  });

  it('keeps layout groups', () => {
    expect(expoRouterPattern(['(tabs)', 'runs'])).toBe('/(tabs)/runs');
  });

  it('keeps a catch-all segment', () => {
    expect(expoRouterPattern(['[...slug]'])).toBe('/[...slug]');
  });

  it('returns null for the top-level not-found route', () => {
    expect(expoRouterPattern(['+not-found'])).toBeNull();
  });

  it('returns null for a nested not-found route', () => {
    expect(expoRouterPattern(['(tabs)', '+not-found'])).toBeNull();
  });

  it('returns null for any other +-prefixed system route', () => {
    expect(expoRouterPattern(['+html'])).toBeNull();
  });

  it('returns null for an empty segment', () => {
    expect(expoRouterPattern(['a', ''])).toBeNull();
  });

  it('returns null for a segment carrying a path separator', () => {
    expect(expoRouterPattern(['a/b'])).toBeNull();
  });

  it('returns null for a segment carrying a query', () => {
    expect(expoRouterPattern(['a?x'])).toBeNull();
  });

  it('returns null for a segment carrying a fragment', () => {
    expect(expoRouterPattern(['a#x'])).toBeNull();
  });

  it('returns null for a non-string segment', () => {
    expect(expoRouterPattern([42 as unknown as string])).toBeNull();
  });

  it('is pure: the same input twice gives an equal result', () => {
    const segments = ['(tabs)', 'profile', '[user]'];
    expect(expoRouterPattern(segments)).toBe('/(tabs)/profile/[user]');
    expect(expoRouterPattern(segments)).toBe('/(tabs)/profile/[user]');
    expect(segments).toEqual(['(tabs)', 'profile', '[user]']);
  });

  /**
   * The D3 premise, pinned: on a not-found render expo-router 6.0.23's
   * `getRouteInfoFromState` (`build/global-state/routeInfo.js:22-30`) returns
   * `segments: [route.name]` for the top-level `+not-found` route, and puts
   * the concrete path only into `params['not-found']` (`:96-99`). This fixture
   * is typed after that output; the concrete path must not reach the pattern.
   */
  it('yields null for the shape getRouteInfoFromState returns on a not-found render', () => {
    const notFoundRouteInfo = {
      segments: ['+not-found'],
      pathname: '/search/secret-sentinel',
      params: { 'not-found': ['search', 'secret-sentinel'] },
    };
    expect(expoRouterPattern(notFoundRouteInfo.segments)).toBeNull();
    expect(isExpoRouterUnmatched(notFoundRouteInfo.segments)).toBe(true);
  });
});

describe('isExpoRouterUnmatched', () => {
  it('is false for an ordinary screen', () => {
    expect(isExpoRouterUnmatched(['(tabs)', 'runs'])).toBe(false);
  });

  it('is false for the root', () => {
    expect(isExpoRouterUnmatched([])).toBe(false);
  });

  it('is true for a nested not-found route', () => {
    expect(isExpoRouterUnmatched(['(tabs)', '+not-found'])).toBe(true);
  });
});

describe('reactNavigationPattern', () => {
  const threeLevels: NavigationStateLike = {
    index: 0,
    routes: [
      {
        name: 'Root',
        state: {
          index: 1,
          routes: [
            { name: 'Login' },
            {
              name: 'HomeTabs',
              state: {
                index: 2,
                routes: [{ name: 'Feed' }, { name: 'Search' }, { name: 'Profile' }],
              },
            },
          ],
        },
      },
    ],
  };

  it('joins the focused route-name chain, root to leaf', () => {
    expect(reactNavigationPattern(threeLevels)).toBe('/Root/HomeTabs/Profile');
  });

  it('follows a non-zero index to the focused route', () => {
    const state: NavigationStateLike = {
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Settings' }],
    };
    expect(reactNavigationPattern(state)).toBe('/Settings');
  });

  it('treats an absent index as the first route', () => {
    expect(reactNavigationPattern({ routes: [{ name: 'Home' }] })).toBe('/Home');
  });

  it('returns null for an out-of-range index', () => {
    expect(reactNavigationPattern({ index: 2, routes: [{ name: 'A' }, { name: 'B' }] })).toBeNull();
  });

  it('returns null for a negative index', () => {
    expect(reactNavigationPattern({ index: -1, routes: [{ name: 'A' }] })).toBeNull();
  });

  it('returns null for an out-of-range index at a nested level', () => {
    const state: NavigationStateLike = {
      routes: [{ name: 'Root', state: { index: 5, routes: [{ name: 'A' }] } }],
    };
    expect(reactNavigationPattern(state)).toBeNull();
  });

  it('returns null for empty routes', () => {
    expect(reactNavigationPattern({ routes: [] })).toBeNull();
  });

  it('returns null for a missing state', () => {
    expect(reactNavigationPattern(undefined)).toBeNull();
    expect(reactNavigationPattern(null)).toBeNull();
  });

  it('returns null for a malformed route name', () => {
    expect(reactNavigationPattern({ routes: [{ name: 'a/b' }] })).toBeNull();
    expect(reactNavigationPattern({ routes: [{ name: '' }] })).toBeNull();
    expect(
      reactNavigationPattern({ routes: [{ name: 'Root', state: { routes: [{ name: 'x?y' }] } }] })
    ).toBeNull();
  });

  it('returns null when the focused leaf is a not-found screen', () => {
    const state: NavigationStateLike = {
      routes: [
        { name: 'Root', state: { index: 1, routes: [{ name: 'Home' }, { name: 'NotFound' }] } },
      ],
    };
    expect(reactNavigationPattern(state, { notFoundRouteNames: ['NotFound'] })).toBeNull();
    expect(reactNavigationPattern(state)).toBe('/Root/NotFound');
  });

  it('does not null a not-found name that is not the leaf', () => {
    const state: NavigationStateLike = {
      routes: [{ name: 'NotFound', state: { routes: [{ name: 'Inner' }] } }],
    };
    expect(reactNavigationPattern(state, { notFoundRouteNames: ['NotFound'] })).toBe(
      '/NotFound/Inner'
    );
  });

  it('never reads route params', () => {
    const state = {
      routes: [{ name: 'Profile', params: { id: 'secret-sentinel' } }],
    } as NavigationStateLike;
    const result = reactNavigationPattern(state);
    expect(result).toBe('/Profile');
    expect(result).not.toContain('secret-sentinel');
  });

  it('is pure: the same input twice gives an equal result', () => {
    expect(reactNavigationPattern(threeLevels)).toBe('/Root/HomeTabs/Profile');
    expect(reactNavigationPattern(threeLevels)).toBe('/Root/HomeTabs/Profile');
  });
});
