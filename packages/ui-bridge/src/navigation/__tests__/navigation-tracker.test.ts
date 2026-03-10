import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NavigationTracker } from '../navigation-tracker';

describe('NavigationTracker', () => {
  let tracker: NavigationTracker;

  beforeEach(() => {
    tracker = new NavigationTracker();
  });

  afterEach(() => {
    tracker.uninstall();
  });

  describe('getCurrentPage', () => {
    it('returns current page info from window.location', () => {
      const page = tracker.getCurrentPage();
      expect(page).toHaveProperty('url');
      expect(page).toHaveProperty('pathname');
      expect(page).toHaveProperty('search');
      expect(page).toHaveProperty('hash');
      expect(page).toHaveProperty('title');
      expect(typeof page.url).toBe('string');
    });
  });

  describe('install / uninstall', () => {
    it('records initial navigation on install', () => {
      tracker.install();
      const navs = tracker.getRecentNavigations();
      expect(navs.length).toBe(1);
      expect(navs[0].trigger).toBe('initial');
      expect(navs[0].from).toBe('');
    });

    it('is idempotent — double install does not duplicate', () => {
      tracker.install();
      tracker.install();
      const navs = tracker.getRecentNavigations();
      expect(navs.length).toBe(1);
    });

    it('intercepts history.pushState', () => {
      tracker.install();

      // pushState triggers a navigation record
      history.pushState({}, '', '/test-push');
      const navs = tracker.getRecentNavigations();

      // initial + push
      expect(navs.length).toBe(2);
      expect(navs[1].trigger).toBe('push');
      expect(navs[1].to).toContain('/test-push');

      // Clean up URL
      history.replaceState({}, '', '/');
    });

    it('intercepts history.replaceState', () => {
      tracker.install();
      const beforeCount = tracker.getRecentNavigations().length;

      history.replaceState({}, '', '/test-replace');
      const navs = tracker.getRecentNavigations();

      expect(navs.length).toBe(beforeCount + 1);
      expect(navs[navs.length - 1].trigger).toBe('replace');

      // Clean up URL
      history.replaceState({}, '', '/');
    });

    it('skips duplicate URLs on replaceState', () => {
      tracker.install();
      const currentUrl = window.location.href;

      // replaceState with same URL — should be skipped
      history.replaceState({}, '', currentUrl);
      const navs = tracker.getRecentNavigations();

      // Should only have the initial entry
      expect(navs.length).toBe(1);
    });

    it('restores original History API on uninstall', () => {
      tracker.install();

      // After install, pushState is intercepted — navigations are tracked
      history.pushState({}, '', '/before-uninstall');
      const countBefore = tracker.getRecentNavigations().length;

      tracker.uninstall();

      // After uninstall, pushState should no longer be tracked
      history.pushState({}, '', '/after-uninstall');
      const countAfter = tracker.getRecentNavigations().length;
      expect(countAfter).toBe(countBefore);

      // Clean up
      history.replaceState({}, '', '/');
    });

    it('fires onNavigation callback', () => {
      const callback = vi.fn();
      tracker.install(callback);

      history.pushState({}, '', '/callback-test');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'push',
          to: expect.objectContaining({ pathname: '/callback-test' }),
        })
      );

      // Clean up
      history.replaceState({}, '', '/');
    });
  });

  describe('history buffer', () => {
    it('trims to maxHistory', () => {
      const small = new NavigationTracker({ maxHistory: 3 });
      small.install();

      // 1 initial + 5 pushes = 6 entries, trimmed to 3
      for (let i = 0; i < 5; i++) {
        history.pushState({}, '', `/trim-${i}`);
      }

      const navs = small.getRecentNavigations();
      expect(navs.length).toBe(3);

      small.uninstall();
      history.replaceState({}, '', '/');
    });
  });

  describe('developer context', () => {
    it('stores and returns page context', () => {
      tracker.setPageContext({ name: 'Dashboard', section: 'main' });
      expect(tracker.getDeveloperContext()).toEqual({ name: 'Dashboard', section: 'main' });
    });

    it('stores and returns route info', () => {
      tracker.setRouteInfo({ pattern: '/tasks/:id', params: { id: '123' } });
      expect(tracker.getRouteInfo()).toEqual({ pattern: '/tasks/:id', params: { id: '123' } });
    });

    it('clears context', () => {
      tracker.setPageContext({ name: 'Test' });
      tracker.setPageContext(undefined);
      expect(tracker.getDeveloperContext()).toBeUndefined();
    });
  });

  describe('getSnapshotPageContext', () => {
    it('includes all fields', () => {
      tracker.install();
      tracker.setPageContext({ name: 'Settings', section: 'admin' });
      tracker.setRouteInfo({ pattern: '/settings', params: {} });

      const ctx = tracker.getSnapshotPageContext();

      expect(ctx.url).toBeTruthy();
      expect(ctx.pathname).toBeTruthy();
      expect(typeof ctx.title).toBe('string');
      expect(ctx.recentNavigations.length).toBeGreaterThan(0);
      expect(ctx.pageContext).toEqual({ name: 'Settings', section: 'admin' });
      expect(ctx.route).toEqual({ pattern: '/settings', params: {} });
    });

    it('works without install (no history, but still has page info)', () => {
      const ctx = tracker.getSnapshotPageContext();
      expect(ctx.url).toBeTruthy();
      expect(ctx.recentNavigations).toEqual([]);
      expect(ctx.route).toBeUndefined();
      expect(ctx.pageContext).toBeUndefined();
    });
  });
});
