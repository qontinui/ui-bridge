/**
 * UIBridgeComponentScope
 *
 * Wraps a subtree so that every `useUIElement` inside it auto-registers with
 * `ownedByComponent: <componentId>`. Lets snapshot consumers discover that a
 * button belongs to a higher-level component and that a named component
 * action may be a cleaner call path than driving the DOM.
 *
 * @example
 * ```tsx
 * useUIComponent({ id: 'zone-profile-picker', ... actions: [...] });
 * return (
 *   <UIBridgeComponentScope componentId="zone-profile-picker">
 *     <button ref={picker.ref}>...</button>
 *     <div>...</div>
 *   </UIBridgeComponentScope>
 * );
 * ```
 */

import { createContext, useContext, type ReactNode } from 'react';

const ComponentScopeContext = createContext<string | null>(null);

export interface UIBridgeComponentScopeProps {
  /** ID of the `useUIComponent` that owns elements in this subtree. */
  componentId: string;
  children: ReactNode;
}

export function UIBridgeComponentScope({ componentId, children }: UIBridgeComponentScopeProps) {
  return (
    <ComponentScopeContext.Provider value={componentId}>{children}</ComponentScopeContext.Provider>
  );
}

/**
 * Read the enclosing component scope ID, or `null` if not inside one.
 * `useUIElement` calls this to populate `ownedByComponent` automatically.
 */
export function useOwningComponent(): string | null {
  return useContext(ComponentScopeContext);
}
