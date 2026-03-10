/**
 * usePageContext Hook
 *
 * Allows developers to annotate the current page with semantic context
 * (name, section, breadcrumb, etc.) that gets included in snapshots.
 *
 * Usage:
 *   function TaskDetailPage({ id }: { id: string }) {
 *     usePageContext({
 *       name: 'Task Detail',
 *       section: 'tasks',
 *       breadcrumb: ['Tasks', `Task ${id}`],
 *     });
 *     return <div>...</div>;
 *   }
 */

import { useEffect } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { DeveloperPageContext } from '../navigation/types';

/**
 * Annotate the current page with semantic context for AI automation.
 *
 * The context is cleared when the component unmounts, so it stays
 * in sync with the active page component.
 */
export function usePageContext(context: DeveloperPageContext): void {
  const bridge = useUIBridgeOptional();

  useEffect(() => {
    if (!bridge) return;

    bridge.navigationTracker.setPageContext(context);

    return () => {
      bridge.navigationTracker.setPageContext(undefined);
    };
    // Serialize context for dependency comparison
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bridge,
    context.name,
    context.section,
    context.breadcrumb?.join(','),
    context.meta ? JSON.stringify(context.meta) : '',
  ]);
}
