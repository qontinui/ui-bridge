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
interface NavigationRoute {
    name: string;
    path: string;
}
interface NavigationAdapter {
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
declare class WindowLocationAdapter implements NavigationAdapter {
    getRoutes(): NavigationRoute[];
    navigate(target: string): Promise<void>;
    getCurrentRoute(): NavigationRoute;
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
declare function createReactRouterAdapter(router: {
    navigate: (path: string) => void | Promise<void>;
    state?: {
        location?: {
            pathname: string;
        };
    };
    routes?: Array<{
        path?: string;
        id?: string;
        children?: unknown[];
    }>;
}): NavigationAdapter;
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
declare function createNextjsAdapter(router: {
    push: (url: string) => void;
    replace?: (url: string) => void;
    back?: () => void;
}): NavigationAdapter;

export { type NavigationAdapter as N, WindowLocationAdapter as W, type NavigationRoute as a, createReactRouterAdapter as b, createNextjsAdapter as c };
