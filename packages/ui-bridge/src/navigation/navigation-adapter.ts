/**
 * Navigation Adapter Interface
 *
 * Provides an app-agnostic abstraction for page navigation. Each app registers
 * an adapter during SDK initialization, and the UI Bridge protocol uses it to
 * navigate without fragile "find and click nav button" patterns.
 *
 * Built-in adapters: React Router, Next.js.
 * Apps with custom navigation provide their own adapter.
 * Fallback: window.location.href assignment when no adapter is registered.
 */

export interface NavigationRoute {
  name: string;
  path: string;
}

export interface NavigationAdapter {
  /** List available pages/routes. */
  getRoutes(): NavigationRoute[];
  /** Navigate to a named page or path. */
  navigate(target: string): Promise<void>;
  /** Get current page/route. */
  getCurrentRoute(): NavigationRoute;
}

/**
 * Fallback adapter that uses window.location for navigation.
 * Used when no framework-specific adapter is registered.
 */
export class WindowLocationAdapter implements NavigationAdapter {
  getRoutes(): NavigationRoute[] {
    return [
      {
        name: document.title || 'Current Page',
        path: window.location.pathname,
      },
    ];
  }

  async navigate(target: string): Promise<void> {
    if (target.startsWith('/') || target.startsWith('http')) {
      window.location.href = target;
    } else {
      // Treat as relative path
      window.location.href = '/' + target;
    }
  }

  getCurrentRoute(): NavigationRoute {
    return {
      name: document.title || 'Current Page',
      path: window.location.pathname + window.location.search + window.location.hash,
    };
  }
}

/**
 * React Router adapter factory.
 *
 * Usage:
 * ```tsx
 * import { useNavigate, useLocation } from 'react-router-dom';
 * import { createReactRouterAdapter } from '@anthropic-ai/ui-bridge-sdk';
 *
 * const router = createBrowserRouter(routes);
 * <UiBridgeProvider navigation={createReactRouterAdapter(router)}>
 * ```
 */
export function createReactRouterAdapter(router: {
  navigate: (path: string) => void | Promise<void>;
  state?: { location?: { pathname: string } };
  routes?: Array<{ path?: string; id?: string; children?: unknown[] }>;
}): NavigationAdapter {
  function flattenRoutes(
    routes: Array<{ path?: string; id?: string; children?: unknown[] }>,
    prefix = ''
  ): NavigationRoute[] {
    const result: NavigationRoute[] = [];
    for (const route of routes) {
      const fullPath = route.path
        ? prefix + (route.path.startsWith('/') ? route.path : '/' + route.path)
        : prefix;
      if (route.path) {
        result.push({
          name: route.id || route.path,
          path: fullPath,
        });
      }
      if (route.children && Array.isArray(route.children)) {
        result.push(...flattenRoutes(route.children as typeof routes, fullPath));
      }
    }
    return result;
  }

  return {
    getRoutes(): NavigationRoute[] {
      if (router.routes) {
        return flattenRoutes(router.routes);
      }
      return [this.getCurrentRoute()];
    },

    async navigate(target: string): Promise<void> {
      await router.navigate(target);
    },

    getCurrentRoute(): NavigationRoute {
      const pathname = router.state?.location?.pathname ?? window.location.pathname;
      return {
        name: document.title || pathname,
        path: pathname,
      };
    },
  };
}

/**
 * Next.js adapter factory.
 *
 * Usage:
 * ```tsx
 * import { useRouter } from 'next/navigation';
 * import { createNextjsAdapter } from '@anthropic-ai/ui-bridge-sdk';
 *
 * const router = useRouter();
 * <UiBridgeProvider navigation={createNextjsAdapter(router)}>
 * ```
 */
export function createNextjsAdapter(router: {
  push: (url: string) => void;
  replace?: (url: string) => void;
  back?: () => void;
}): NavigationAdapter {
  return {
    getRoutes(): NavigationRoute[] {
      // Next.js doesn't expose route manifests at runtime
      return [this.getCurrentRoute()];
    },

    async navigate(target: string): Promise<void> {
      router.push(target);
    },

    getCurrentRoute(): NavigationRoute {
      return {
        name: document.title || window.location.pathname,
        path: window.location.pathname + window.location.search,
      };
    },
  };
}
