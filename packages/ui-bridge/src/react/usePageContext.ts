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

  // Serialize context for dependency comparison. These derived values
  // are the effect re-fire triggers; the effect reads the context of the
  // committed render that fired it.
  const name = context.name;
  const section = context.section;
  const breadcrumbKey = context.breadcrumb?.join(',');
  const metaKey = context.meta ? JSON.stringify(context.meta) : '';

  useEffect(() => {
    if (!bridge) return;

    bridge.navigationTracker.setPageContext(context);

    return () => {
      bridge.navigationTracker.setPageContext(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, name, section, breadcrumbKey, metaKey]);
}
