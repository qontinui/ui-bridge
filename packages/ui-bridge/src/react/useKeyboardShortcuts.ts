/**
 * useKeyboardShortcuts Hook
 *
 * Allows developers to register keyboard shortcuts with the UI Bridge
 * so AI agents can discover and use them.
 *
 * Usage:
 *   useKeyboardShortcuts([
 *     { combo: 'Ctrl+S', description: 'Save workflow', scope: 'editor' },
 *     { combo: 'Ctrl+Shift+N', description: 'New workflow' },
 *   ]);
 */

import { useEffect } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { KeyboardShortcut } from '../shortcuts/types';

/**
 * Shortcut definition for the hook (source is always 'developer').
 */
export type ShortcutDef = Omit<KeyboardShortcut, 'source'>;

/**
 * Register keyboard shortcuts with the UI Bridge.
 * Shortcuts are automatically unregistered when the component unmounts.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDef[]): void {
  const bridge = useUIBridgeOptional();

  useEffect(() => {
    if (!bridge || shortcuts.length === 0) return;

    const registered: KeyboardShortcut[] = shortcuts.map((s) => ({
      ...s,
      source: 'developer' as const,
    }));

    bridge.shortcutTracker.registerShortcuts(registered);

    return () => {
      bridge.shortcutTracker.unregisterShortcuts(registered.map((s) => s.combo));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, JSON.stringify(shortcuts)]);
}
