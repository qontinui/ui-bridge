/**
 * UIBridgeWindowContext
 *
 * Lets a multi-window host (the qontinui runner's pop-out terminal windows)
 * declare, once at each window's React root, which window the subtree's
 * `useUIElement` registrations belong to. Every `useUIElement` inside reads
 * the context and registers under that `windowLabel`, so the windowed registry
 * keeps each window's elements in its own bucket (no cross-window id
 * collisions) without threading a `windowLabel` prop through every call site.
 *
 * ADDITIVE / OPT-IN: single-window hosts (web, mobile, the runner's main
 * window today) never wrap their tree in this provider, so the context value
 * stays `undefined`, `useUIElement` passes no `windowLabel`, and the registry
 * uses the default `"main"` window — byte-identical to the pre-window-aware
 * behavior. The canonical value to pass is the real Tauri webview label read
 * via `getCurrentWindow().label` (Tauri v2).
 *
 * @example
 * ```tsx
 * import { getCurrentWindow } from '@tauri-apps/api/window';
 *
 * function WindowRoot({ children }: { children: ReactNode }) {
 *   const label = getCurrentWindow().label; // "main" | "term-1" | ...
 *   return <UIBridgeWindowProvider windowLabel={label}>{children}</UIBridgeWindowProvider>;
 * }
 * ```
 *
 * See plan `2026-06-03-runner-popout-terminal-windows.md` Phase 0.
 */

import { createContext, use, type ReactNode } from 'react';

const WindowLabelContext = createContext<string | undefined>(undefined);

export interface UIBridgeWindowProviderProps {
  /**
   * The window this subtree's elements register under — the real Tauri webview
   * label (`getCurrentWindow().label`). Omit/leave undefined for the default
   * `"main"` window.
   */
  windowLabel: string | undefined;
  children: ReactNode;
}

export function UIBridgeWindowProvider({ windowLabel, children }: UIBridgeWindowProviderProps) {
  return <WindowLabelContext value={windowLabel}>{children}</WindowLabelContext>;
}

/**
 * Read the enclosing window label, or `undefined` if not inside a
 * `UIBridgeWindowProvider` (the single-window default). `useUIElement` calls
 * this and falls back to it when no explicit `windowLabel` option is passed.
 */
export function useUIBridgeWindowLabel(): string | undefined {
  return use(WindowLabelContext);
}
