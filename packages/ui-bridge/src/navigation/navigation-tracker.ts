/**
 * Navigation Tracker
 *
 * Automatically tracks page navigations by intercepting the History API
 * (pushState, replaceState) and listening to popstate/hashchange events.
 * Optionally observes document.title changes via MutationObserver.
 *
 * Works with any SPA framework — no developer configuration required.
 */

import type {
  PageNavigationEntry,
  NavigationTrigger,
  PageInfo,
  SnapshotPageContext,
  RouteInfo,
  DeveloperPageContext,
  NavigationTrackerOptions,
  NavigationEventData,
} from './types';

/**
 * Tracks navigation events and provides current page state.
 */
export class NavigationTracker {
  private history: PageNavigationEntry[] = [];
  private maxHistory: number;
  private installed = false;
  private titleObserver: MutationObserver | null = null;
  private lastTitle = '';
  private currentPageInfo: PageInfo;

  // Developer-provided context (set via setRouteInfo / setPageContext)
  private routeInfo: RouteInfo | undefined;
  private developerContext: DeveloperPageContext | undefined;

  // Event callback for bridge event integration
  private onNavigation: ((data: NavigationEventData) => void) | null = null;

  // Original History API methods (saved for cleanup)
  private origPushState: typeof history.pushState | null = null;
  private origReplaceState: typeof history.replaceState | null = null;
  private boundPopState: (() => void) | null = null;
  private boundHashChange: (() => void) | null = null;

  constructor(options: NavigationTrackerOptions = {}) {
    this.maxHistory = options.maxHistory ?? 20;
    this.currentPageInfo = this.capturePageInfo();
  }

  /**
   * Install History API interception and event listeners.
   * Safe to call in non-browser environments (no-ops).
   */
  install(onNavigation?: (data: NavigationEventData) => void): void {
    if (this.installed) return;
    if (typeof window === 'undefined' || typeof history === 'undefined') return;

    this.onNavigation = onNavigation ?? null;
    this.currentPageInfo = this.capturePageInfo();
    this.lastTitle = this.currentPageInfo.title;

    // Record initial navigation
    this.record('initial', this.currentPageInfo.url);

    // Intercept pushState
    this.origPushState = history.pushState.bind(history);
    history.pushState = (state: unknown, title: string, url?: string | URL | null) => {
      this.origPushState!(state, title, url);
      this.handleNavigation('push');
    };

    // Intercept replaceState
    this.origReplaceState = history.replaceState.bind(history);
    history.replaceState = (state: unknown, title: string, url?: string | URL | null) => {
      this.origReplaceState!(state, title, url);
      this.handleNavigation('replace');
    };

    // Listen for back/forward navigation
    this.boundPopState = () => this.handleNavigation('pop');
    window.addEventListener('popstate', this.boundPopState);

    // Listen for hash changes
    this.boundHashChange = () => this.handleNavigation('hash');
    window.addEventListener('hashchange', this.boundHashChange);

    // Observe document.title changes
    this.installTitleObserver();

    this.installed = true;
  }

  /**
   * Uninstall all interceptions and listeners.
   */
  uninstall(): void {
    if (!this.installed) return;

    // Restore original History API methods
    if (this.origPushState) {
      history.pushState = this.origPushState;
      this.origPushState = null;
    }
    if (this.origReplaceState) {
      history.replaceState = this.origReplaceState;
      this.origReplaceState = null;
    }

    // Remove event listeners
    if (this.boundPopState) {
      window.removeEventListener('popstate', this.boundPopState);
      this.boundPopState = null;
    }
    if (this.boundHashChange) {
      window.removeEventListener('hashchange', this.boundHashChange);
      this.boundHashChange = null;
    }

    // Disconnect title observer
    if (this.titleObserver) {
      this.titleObserver.disconnect();
      this.titleObserver = null;
    }

    this.onNavigation = null;
    this.installed = false;
  }

  // ===========================================================================
  // Public API — Read State
  // ===========================================================================

  /**
   * Get current page info from browser state.
   */
  getCurrentPage(): PageInfo {
    if (typeof window !== 'undefined') {
      this.currentPageInfo = this.capturePageInfo();
    }
    return this.currentPageInfo;
  }

  /**
   * Get recent navigation history (most recent last).
   */
  getRecentNavigations(): PageNavigationEntry[] {
    return [...this.history];
  }

  /**
   * Build the full SnapshotPageContext for inclusion in ControlSnapshot.
   */
  getSnapshotPageContext(): SnapshotPageContext {
    const page = this.getCurrentPage();
    return {
      url: page.url,
      pathname: page.pathname,
      search: page.search,
      hash: page.hash,
      title: page.title,
      recentNavigations: this.getRecentNavigations(),
      route: this.routeInfo,
      pageContext: this.developerContext,
    };
  }

  // ===========================================================================
  // Public API — Developer-Provided Context
  // ===========================================================================

  /**
   * Set framework router info (called by useRouteAwareness or similar).
   */
  setRouteInfo(info: RouteInfo | undefined): void {
    this.routeInfo = info;
  }

  /**
   * Set developer-annotated page context (called by usePageContext).
   */
  setPageContext(context: DeveloperPageContext | undefined): void {
    this.developerContext = context;
  }

  /**
   * Get current developer context (for testing/debugging).
   */
  getDeveloperContext(): DeveloperPageContext | undefined {
    return this.developerContext;
  }

  /**
   * Get current route info (for testing/debugging).
   */
  getRouteInfo(): RouteInfo | undefined {
    return this.routeInfo;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private handleNavigation(trigger: NavigationTrigger): void {
    const prevPage = { ...this.currentPageInfo };
    this.currentPageInfo = this.capturePageInfo();

    // Skip if URL didn't actually change (e.g., replaceState with same URL)
    if (trigger !== 'initial' && prevPage.url === this.currentPageInfo.url) {
      return;
    }

    this.record(trigger, this.currentPageInfo.url, prevPage.url);

    // Emit event
    if (this.onNavigation) {
      this.onNavigation({
        from: prevPage,
        to: this.currentPageInfo,
        trigger,
      });
    }
  }

  private record(trigger: NavigationTrigger, to: string, from?: string): void {
    this.history.push({
      from: from ?? '',
      to,
      trigger,
      timestamp: Date.now(),
    });

    // Trim to max size
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  private capturePageInfo(): PageInfo {
    if (typeof window === 'undefined') {
      return { url: '', pathname: '', search: '', hash: '', title: '' };
    }
    return {
      url: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      title: typeof document !== 'undefined' ? document.title : '',
    };
  }

  private installTitleObserver(): void {
    if (typeof document === 'undefined') return;

    const titleEl = document.querySelector('title');
    if (!titleEl) return;

    this.titleObserver = new MutationObserver(() => {
      const newTitle = document.title;
      if (newTitle !== this.lastTitle) {
        this.lastTitle = newTitle;
        // Update current page info with new title
        this.currentPageInfo = this.capturePageInfo();
      }
    });

    this.titleObserver.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
}
