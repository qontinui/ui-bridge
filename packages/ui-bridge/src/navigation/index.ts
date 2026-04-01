/**
 * Navigation Module
 *
 * Provides page/route awareness for the UI Bridge:
 * - Automatic navigation tracking via History API interception
 * - Document title observation
 * - Developer-provided route and page context
 */

export { NavigationTracker } from './navigation-tracker';
export type {
  PageNavigationEntry,
  NavigationTrigger,
  PageInfo,
  RouteInfo,
  DeveloperPageContext,
  SnapshotPageContext,
  NavigationTrackerOptions,
  NavigationEventData,
} from './types';

export {
  WindowLocationAdapter,
  createReactRouterAdapter,
  createNextjsAdapter,
} from './navigation-adapter';
export type { NavigationAdapter, NavigationRoute } from './navigation-adapter';
