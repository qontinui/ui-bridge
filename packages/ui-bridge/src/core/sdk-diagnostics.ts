/**
 * The SDK diagnostics read (`GET /diagnostics`, the `getDiagnostics` command)
 * as ONE builder, served by the in-page command dispatcher
 * (`react/commandHandlers.ts`) and the in-process handlers
 * (`server/handlers.ts`).
 *
 * Everything it reads is page state — `window.__UI_BRIDGE__`, the document,
 * the interactive-element count — plus the few facts only the calling
 * transport knows (its registry's size and which capture/navigation pieces it
 * was given), passed in as {@link SdkDiagnosticsInputs}. Browser-safe, and
 * typeof-guarded so a server runtime answers an empty page rather than
 * throwing.
 */

import { countDOMInteractiveElements } from '../server/dom-fallback';

/** What the calling transport knows and the page cannot tell it. */
export interface SdkDiagnosticsInputs {
  /** Elements in the transport's registry. */
  registeredElements: number;
  /** A console / browser event capture is wired (the `debug` capability). */
  hasConsoleCapture: boolean;
  /** A navigation tracker is wired (the `navigation` capability). */
  hasNavigationTracker: boolean;
  /** An app-supplied navigation adapter is wired, not the window-location default. */
  hasNavigationAdapter: boolean;
}

/** The diagnostics answer — the wire shape both transports serve. */
export interface SdkDiagnostics {
  sdk_initialized: boolean;
  auto_register_active: boolean;
  registered_elements: number;
  dom_interactive_elements: number;
  mutation_observer_active: boolean;
  navigation_adapter: string;
  page_title: string;
  page_url: string;
  page_ready: boolean;
  providers_mounted: string[];
  last_discover_at: string | null;
  capabilities: string[];
}

interface DiagnosticsGlobalBridge {
  autoRegisterActive?: boolean;
  mutationObserverActive?: boolean;
  providers?: string[];
}

export function buildSdkDiagnostics(inputs: SdkDiagnosticsInputs): SdkDiagnostics {
  const globalBridge =
    typeof window !== 'undefined'
      ? (window as unknown as { __UI_BRIDGE__?: DiagnosticsGlobalBridge }).__UI_BRIDGE__
      : undefined;

  return {
    sdk_initialized: !!globalBridge,
    auto_register_active: !!globalBridge?.autoRegisterActive,
    registered_elements: inputs.registeredElements,
    dom_interactive_elements: countDOMInteractiveElements(),
    mutation_observer_active: !!globalBridge?.mutationObserverActive,
    navigation_adapter: inputs.hasNavigationAdapter ? 'custom' : 'window-location',
    page_title: typeof document !== 'undefined' ? document.title : '',
    page_url: typeof window !== 'undefined' ? window.location.href : '',
    page_ready: typeof document !== 'undefined' ? document.readyState === 'complete' : false,
    providers_mounted: globalBridge?.providers ?? [],
    last_discover_at: null,
    capabilities: [
      'control',
      'find',
      'ai',
      ...(inputs.hasConsoleCapture ? ['debug'] : []),
      ...(inputs.hasNavigationTracker ? ['navigation'] : []),
      ...(inputs.hasNavigationAdapter ? ['navigation-adapter'] : []),
    ],
  };
}
