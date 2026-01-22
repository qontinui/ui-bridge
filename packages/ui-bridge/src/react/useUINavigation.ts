/**
 * useUINavigation Hook
 *
 * Navigate between UI states using pathfinding with UI Bridge.
 */

import { useCallback, useMemo, useState } from 'react';
import type { PathResult, NavigationResult } from '../core/types';
import { useUIBridgeOptional } from './UIBridgeProvider';

/**
 * useUINavigation return value
 */
export interface UseUINavigationReturn {
  /** Whether UI Bridge is available */
  available: boolean;
  /** Whether navigation is currently in progress */
  isNavigating: boolean;
  /** Last navigation result */
  lastResult: NavigationResult | null;
  /** Find a path to target states (without executing) */
  findPath: (targetStates: string[]) => PathResult;
  /** Navigate to target states */
  navigateTo: (targetStates: string[]) => Promise<NavigationResult>;
  /** Current active states */
  activeStates: string[];
}

/**
 * useUINavigation hook
 *
 * Provides state machine navigation capabilities with pathfinding.
 *
 * @example
 * ```tsx
 * function NavigationController() {
 *   const { navigateTo, findPath, isNavigating, activeStates } = useUINavigation();
 *
 *   const goToDashboard = async () => {
 *     // Find path first to check if navigation is possible
 *     const path = findPath(['dashboard']);
 *     if (!path.found) {
 *       console.log('Cannot reach dashboard from current state');
 *       return;
 *     }
 *
 *     console.log(`Will execute ${path.transitions.length} transitions`);
 *
 *     // Execute navigation
 *     const result = await navigateTo(['dashboard']);
 *     if (result.success) {
 *       console.log('Successfully navigated to dashboard');
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <p>Current states: {activeStates.join(', ')}</p>
 *       <button onClick={goToDashboard} disabled={isNavigating}>
 *         Go to Dashboard
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useUINavigation(): UseUINavigationReturn {
  const bridge = useUIBridgeOptional();
  const [isNavigating, setIsNavigating] = useState(false);
  const [lastResult, setLastResult] = useState<NavigationResult | null>(null);

  const available = !!bridge;

  // Get current active states
  const activeStates = useMemo(() => {
    if (!bridge) return [];
    return bridge.registry.getActiveStates();
  }, [bridge]);

  // Find path to target states
  const findPath = useCallback(
    (targetStates: string[]): PathResult => {
      if (!bridge) {
        return {
          found: false,
          transitions: [],
          totalCost: 0,
          targetStates,
          estimatedSteps: 0,
        };
      }
      return bridge.registry.findPath(targetStates);
    },
    [bridge]
  );

  // Navigate to target states
  const navigateTo = useCallback(
    async (targetStates: string[]): Promise<NavigationResult> => {
      if (!bridge) {
        const result: NavigationResult = {
          success: false,
          path: {
            found: false,
            transitions: [],
            totalCost: 0,
            targetStates,
            estimatedSteps: 0,
          },
          executedTransitions: [],
          finalActiveStates: [],
          error: 'UI Bridge not available',
          durationMs: 0,
        };
        setLastResult(result);
        return result;
      }

      setIsNavigating(true);
      try {
        const result = await bridge.registry.navigateTo(targetStates);
        setLastResult(result);
        return result;
      } finally {
        setIsNavigating(false);
      }
    },
    [bridge]
  );

  return {
    available,
    isNavigating,
    lastResult,
    findPath,
    navigateTo,
    activeStates,
  };
}

/**
 * useCanNavigateTo hook
 *
 * Check if navigation to target states is possible.
 *
 * @example
 * ```tsx
 * function DashboardLink() {
 *   const canNavigate = useCanNavigateTo(['dashboard']);
 *
 *   return (
 *     <button disabled={!canNavigate}>
 *       Dashboard
 *     </button>
 *   );
 * }
 * ```
 */
export function useCanNavigateTo(targetStates: string[]): boolean {
  const bridge = useUIBridgeOptional();

  return useMemo(() => {
    if (!bridge) return false;
    const path = bridge.registry.findPath(targetStates);
    return path.found;
  }, [bridge, targetStates]);
}

/**
 * useNavigationPath hook
 *
 * Get the path to target states (updates when active states change).
 *
 * @example
 * ```tsx
 * function PathDisplay() {
 *   const path = useNavigationPath(['checkout']);
 *
 *   if (!path.found) {
 *     return <p>Cannot reach checkout from here</p>;
 *   }
 *
 *   return (
 *     <p>
 *       Steps to checkout: {path.transitions.join(' -> ')}
 *       (Cost: {path.totalCost})
 *     </p>
 *   );
 * }
 * ```
 */
export function useNavigationPath(targetStates: string[]): PathResult {
  const bridge = useUIBridgeOptional();

  return useMemo(() => {
    if (!bridge) {
      return {
        found: false,
        transitions: [],
        totalCost: 0,
        targetStates,
        estimatedSteps: 0,
      };
    }
    return bridge.registry.findPath(targetStates);
  }, [bridge, targetStates]);
}
