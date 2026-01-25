/**
 * AutoRegisterProvider
 *
 * A React component that enables automatic UI Bridge element registration
 * for all interactive elements within its subtree.
 *
 * @example
 * ```tsx
 * // Enable auto-registration for the entire app
 * function App() {
 *   return (
 *     <UIBridgeProvider features={{ control: true }}>
 *       <AutoRegisterProvider enabled={process.env.NODE_ENV === 'development'}>
 *         <YourApp />
 *       </AutoRegisterProvider>
 *     </UIBridgeProvider>
 *   );
 * }
 *
 * // Enable auto-registration for a specific section
 * function Dashboard() {
 *   return (
 *     <AutoRegisterProvider
 *       idStrategy="data-testid"
 *       excludeSelectors={['[data-no-register]']}
 *     >
 *       <DashboardContent />
 *     </AutoRegisterProvider>
 *   );
 * }
 * ```
 */

import React, { type ReactNode, useRef } from 'react';
import { useAutoRegister, type AutoRegisterOptions } from './useAutoRegister';

export interface AutoRegisterProviderProps extends Omit<AutoRegisterOptions, 'root'> {
  /** Children to render */
  children: ReactNode;
  /** Use this element as the observation root instead of document.body */
  scopeToChildren?: boolean;
}

/**
 * Provider component that enables automatic element registration.
 *
 * Features:
 * - Automatically discovers and registers interactive elements
 * - Uses MutationObserver to detect new elements
 * - Smart ID generation based on data-testid, semantic names, etc.
 * - Configurable selectors and ID strategies
 *
 * Place this component at the root of your app (inside UIBridgeProvider)
 * for comprehensive automatic element registration.
 */
export function AutoRegisterProvider({
  children,
  scopeToChildren = false,
  enabled = process.env.NODE_ENV === 'development',
  idStrategy = 'prefer-existing',
  debounceMs = 100,
  includeHidden = false,
  includeSelectors = [],
  excludeSelectors = [],
  generateId,
  onRegister,
  onUnregister,
}: AutoRegisterProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Use the auto-register hook
  useAutoRegister({
    enabled,
    root: scopeToChildren ? containerRef.current : null,
    idStrategy,
    debounceMs,
    includeHidden,
    includeSelectors,
    excludeSelectors,
    generateId,
    onRegister,
    onUnregister,
  });

  // If scoped to children, wrap in a div
  if (scopeToChildren) {
    return (
      <div ref={containerRef} style={{ display: 'contents' }}>
        {children}
      </div>
    );
  }

  // Otherwise, just render children directly
  return <>{children}</>;
}

export default AutoRegisterProvider;
