/**
 * useUIElement Hook
 *
 * Register a DOM element with UI Bridge for control and observation.
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import type {
  ElementType,
  StandardAction,
  CustomAction,
  ElementState,
  ElementIdentifier,
  RegisteredElement,
  ElementLogLevel,
  ElementHistoryOptions,
  ElementLogEntry,
} from '../core/types';
import type { RelationshipType } from '../relationships/types';
import { useUIBridgeOptional } from './UIBridgeProvider';
import { useOwningComponent } from './UIBridgeComponentScope';
import { useUIBridgeWindowLabel } from './UIBridgeWindowContext';
import { pollForTaggedElement, trackElementBbox, UI_BRIDGE_ID_ATTR } from './bbox-tracker';
import { UI_BRIDGE_PERSIST_ATTR } from './useAutoRegister';

/**
 * useUIElement options
 */
export interface UseUIElementOptions {
  /** Unique identifier for the element */
  id: string;
  /** Element type (auto-detected if not provided) */
  type?: ElementType;
  /** Human-readable label */
  label?: string;
  /** Override available actions */
  actions?: StandardAction[];
  /** Custom actions */
  customActions?: Record<string, CustomAction>;
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
  /** Callback when state changes */
  onStateChange?: (state: ElementState) => void;
  /** Log level override for element-scoped event logging */
  logLevel?: ElementLogLevel;
  /** Declare relationships from this element to other elements */
  relationships?: Array<{
    targetId: string;
    type: RelationshipType;
    bidirectional?: boolean;
    metadata?: Record<string, unknown>;
  }>;

  // --- Structured disambiguation metadata (all optional) --------------
  // Consumers opt in to help NL queries ("the red Save button at the bottom
  // right", "the destructive Confirm") rank candidates without VLM pixel
  // grounding. Each field is an open-ended string — design systems can use
  // their own tokens. Snapshots pass them through verbatim.
  /**
   * Semantic role / intent. Common values: `"primary"`, `"secondary"`,
   * `"destructive"`, `"ghost"`, `"link"`, `"success"`, `"warning"`.
   */
  variant?: string;
  /**
   * Positional hint. Common values: `"top"`, `"bottom"`, `"left"`, `"right"`,
   * `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`, `"center"`.
   */
  position?: string;
  /**
   * Dominant color as seen by the user — CSS color name (`"red"`), hex
   * (`"#ef4444"`), or design-token alias (`"accent"`, `"danger"`).
   */
  color?: string;
  /**
   * Hierarchical semantic path for ranking across duplicate labels, e.g.
   * `"settings-modal > theme-section > accent-color"`.
   */
  contextPath?: string;

  /**
   * If true, this element stays registered in the UI Bridge registry for the
   * entire lifetime of its mount, even if surrounding visibility changes
   * (opacity:0 during a collapse animation, ancestor scroll container,
   * max-height:0 on a hidden group) would normally cause the auto-scanner
   * to skip or drop it. `useUIElement` itself already binds registration to
   * mount lifecycle, but when this flag is set the hook also stamps
   * `data-ui-bridge-persist="true"` on the DOM node so the auto-scanner
   * treats neighbouring/duplicate passes the same way.
   *
   * Use for logically-persistent elements like sidebar navigation items
   * that live inside a collapsible group but should remain discoverable for
   * UI Bridge clients regardless of the group's expanded/collapsed state.
   *
   * Default: false.
   */
  persistWhileMounted?: boolean;

  /**
   * Phase 3.2 (plan 2026-05-03) — element ids (or simple `*`-glob patterns)
   * that this control unhides / reveals when activated. Lets clients answer
   * "which control unhides element X" via
   * `GET /control/elements?revealsAny=<id-or-glob>` without grepping source.
   *
   * Example: a sidebar toggle that exposes session cards might declare
   * `reveals: ["session-card-*", "promote-to-worktree-*"]`. The query side
   * matches in either direction — the query value can be a concrete id
   * matched against a glob entry, or a glob matched against concrete entries.
   */
  reveals?: string[];

  /**
   * Window this element registers under (multi-window hosts only). When
   * omitted, the hook falls back to the nearest `UIBridgeWindowProvider`
   * context, and finally to the registry's default `"main"` window — so
   * single-window callers (web, mobile) that pass neither behave exactly as
   * before. A non-default value is the real Tauri webview label
   * (`getCurrentWindow().label`); it isolates this element's registry bucket
   * so two windows can register the same id without collision. See plan
   * `2026-06-03-runner-popout-terminal-windows.md` Phase 0.
   */
  windowLabel?: string;
}

/**
 * useUIElement return value
 */
export interface UseUIElementReturn {
  /** Ref to attach to the element */
  ref: React.RefCallback<HTMLElement>;
  /** Current element reference */
  element: HTMLElement | null;
  /** Whether the element is registered */
  registered: boolean;
  /** Get current state */
  getState: () => ElementState | null;
  /** Get element identifier */
  getIdentifier: () => ElementIdentifier | null;
  /** Trigger an action on this element */
  trigger: (action: StandardAction | string, params?: Record<string, unknown>) => Promise<void>;
  /** Manually register the element */
  register: () => void;
  /** Manually unregister the element */
  unregister: () => void;
  /** The registered element info */
  registeredElement: RegisteredElement | null;
  /** Get element event history */
  getHistory: (options?: ElementHistoryOptions) => ElementLogEntry[];
  /** Set log level for this element */
  setLogLevel: (level: ElementLogLevel) => void;
}

/**
 * useUIElement hook
 *
 * Registers a DOM element with UI Bridge for programmatic control.
 *
 * @example
 * ```tsx
 * function SubmitButton() {
 *   const { ref, trigger } = useUIElement({
 *     id: 'submit-btn',
 *     type: 'button',
 *     label: 'Submit Form',
 *   });
 *
 *   return (
 *     <button ref={ref}>
 *       Submit
 *     </button>
 *   );
 * }
 * ```
 */
export function useUIElement(options: UseUIElementOptions): UseUIElementReturn {
  const bridge = useUIBridgeOptional();
  const ownedByComponent = useOwningComponent();
  const contextWindowLabel = useUIBridgeWindowLabel();
  const elementRef = useRef<HTMLElement | null>(null);
  const registeredRef = useRef(false);

  const {
    id,
    type,
    label,
    actions,
    customActions,
    autoRegister = true,
    logLevel,
    relationships,
    variant,
    position,
    color,
    contextPath,
    persistWhileMounted,
    reveals,
  } = options;

  // Explicit option wins; otherwise inherit the nearest window provider; the
  // registry resolves `undefined` to its default "main" window. Single-window
  // callers pass neither, so this stays `undefined` (byte-identical behavior).
  const windowLabel = options.windowLabel ?? contextWindowLabel;

  // See useUIState for rationale on capturing id at register time.
  const registeredElementIdRef = useRef<string | null>(null);

  // Tear-down function for the live bbox tracker (ResizeObserver + shared
  // scroll/resize listeners). Null when we aren't tracking an element —
  // e.g. before first attach, or when the hook fell back to attribute-
  // lookup and couldn't find a match.
  const untrackBboxRef = useRef<(() => void) | null>(null);

  // Helper: attach the bbox tracker to a live DOM element, stamping the
  // fallback attribute so runners (or future fallback polls) can resolve
  // the same node without holding the React ref.
  const startBboxTracking = useCallback(
    (node: HTMLElement) => {
      if (!bridge) return;
      untrackBboxRef.current?.();
      // Stamp the fallback attribute on the element so runners and the
      // poll-fallback path can resolve it by id without the ref.
      if (node.getAttribute(UI_BRIDGE_ID_ATTR) !== id) {
        node.setAttribute(UI_BRIDGE_ID_ATTR, id);
      }
      // Stamp the persist marker so the auto-scanner skips its visibility
      // gate on this node even if it happens to be re-scanned (e.g. when a
      // parent's class/style mutation triggers a rescan pass). Safe to
      // leave on mount forever — the attribute is inert without the
      // scanner.
      if (persistWhileMounted && node.getAttribute(UI_BRIDGE_PERSIST_ATTR) !== 'true') {
        node.setAttribute(UI_BRIDGE_PERSIST_ATTR, 'true');
      }
      untrackBboxRef.current = trackElementBbox(bridge.registry, id, node);
    },
    [bridge, id, persistWhileMounted]
  );

  const stopBboxTracking = useCallback(() => {
    untrackBboxRef.current?.();
    untrackBboxRef.current = null;
  }, []);

  // Register the element
  const register = useCallback(() => {
    if (!bridge || !elementRef.current || registeredRef.current) return;

    bridge.registry.registerElement(id, elementRef.current, {
      type,
      label,
      actions,
      customActions,
      ownedByComponent: ownedByComponent ?? undefined,
      origin: 'hook',
      // Structured disambiguation metadata — passed through verbatim. Absent
      // fields keep today's behavior (no ranking hint emitted).
      variant,
      position,
      color,
      contextPath,
      reveals,
      windowLabel,
    });
    registeredRef.current = true;
    registeredElementIdRef.current = id;

    if (logLevel) {
      bridge.registry.setElementLogLevel(id, logLevel);
    }

    // Start live bbox tracking so snapshots expose DOM coordinates without
    // a per-snapshot getBoundingClientRect() call.
    startBboxTracking(elementRef.current);
  }, [
    bridge,
    id,
    type,
    label,
    actions,
    customActions,
    logLevel,
    ownedByComponent,
    variant,
    position,
    color,
    contextPath,
    reveals,
    windowLabel,
    startBboxTracking,
  ]);

  // Unregister the element
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterElement(registeredElementIdRef.current ?? id, windowLabel);
    registeredRef.current = false;
    registeredElementIdRef.current = null;
    stopBboxTracking();
  }, [bridge, id, windowLabel, stopBboxTracking]);

  // Keep latest register/unregister in refs so the ref callback doesn't
  // churn identity when consumers pass inline `actions`/`customActions`
  // options. A churning ref callback causes React to call ref(null) then
  // ref(node) every render, which unregister/registers each render and
  // emits `element:registered` — waking all useSyncExternalStore consumers
  // (e.g., AppContent via useUIBridge) and re-rendering this component
  // in an infinite loop (React error #185).
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Ref callback — stable identity (deps: [autoRegister]). Uses latest
  // register/unregister via refs.
  //
  // We deliberately do NOT unregister when called with `null`. React calls
  // the previous ref with `null` whenever the ref callback's own identity
  // changes (e.g., Radix `useComposedRefs` rebuilds its wrapper every
  // render), even though the DOM node is still mounted. Treating that as
  // an unmount would fire unregister/register per render, bumping the
  // registry's storeVersion and re-rendering any `useSyncExternalStore`
  // consumer (e.g., AppContent via `useUIBridge`) in an infinite loop
  // (React error #185). Real unmounts are handled by the cleanup effect
  // below, which only runs when this component unmounts.
  //
  // If the DOM element truly swaps to a different node (rare — React reuses
  // nodes aggressively), unregister the old one before pointing elementRef
  // at the new one so the registry doesn't hold a dangling reference.
  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (node === null) {
        // Identity churn or transient detach — don't unregister; cleanup
        // effect will handle real unmount.
        return;
      }

      if (elementRef.current && elementRef.current !== node) {
        unregisterRef.current();
      }

      elementRef.current = node;

      if (autoRegister) {
        registerRef.current();
      }
    },
    [autoRegister]
  );

  // Fallback: if the consumer didn't attach the ref (e.g. portaled or
  // headless component), try to locate an element by `[data-ui-bridge-id]`
  // soon after mount. This keeps live bbox tracking working for sites that
  // can't easily thread a ref through. If the poll succeeds, we register
  // the found element like any other; if not, registration is skipped and
  // the entry stays bbox-less (backward compatible).
  useEffect(() => {
    if (!autoRegister) return;
    if (!bridge) return;

    let cancelled = false;
    // Delay 1 microtask so attached refs get a chance to register first.
    queueMicrotask(() => {
      if (cancelled) return;
      if (registeredRef.current || elementRef.current) return;
      void pollForTaggedElement(id).then((node) => {
        if (cancelled) return;
        if (registeredRef.current || elementRef.current) return;
        if (!node) return;
        elementRef.current = node;
        registerRef.current();
      });
    });

    return () => {
      cancelled = true;
    };
    // Intentionally keyed on bridge/id/autoRegister only — re-polling on
    // every option tweak is wasteful and would fight the register effect.
  }, [bridge, id, autoRegister]);

  // Cleanup on unmount — runs once.
  useEffect(() => {
    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
      }
      // Belt-and-braces: ensure bbox tracker is torn down even if unregister
      // didn't run (e.g. StrictMode double-invocation edge cases).
      untrackBboxRef.current?.();
      untrackBboxRef.current = null;
      elementRef.current = null;
    };
  }, []);

  // In-place option sync — see useUIState for rationale. Treats an `id`
  // change as a re-registration (registry is keyed by id); all other
  // changes go through `updateElement` which skips the re-register emit.
  // `customActions` holds function references; we exclude it from the key
  // and mirror the latest object into the registry on each sync.
  const elementKey =
    bridge && registeredRef.current
      ? JSON.stringify({
          id,
          type: type ?? null,
          label: label ?? null,
          actions: actions ?? null,
          logLevel: logLevel ?? null,
          // Disambiguation hints are plain strings — include them so mid-
          // lifecycle updates (e.g. variant flipping from "primary" to
          // "destructive") propagate into the registry via `updateElement`.
          variant: variant ?? null,
          position: position ?? null,
          color: color ?? null,
          contextPath: contextPath ?? null,
          // Reveals is a plain string array — include it so mid-lifecycle
          // updates (e.g. dynamic reveal targets) propagate into the registry.
          reveals: reveals ?? null,
        })
      : null;
  useEffect(() => {
    if (!bridge || !registeredRef.current || !elementRef.current || elementKey === null) return;
    const registeredElementId = registeredElementIdRef.current;
    if (registeredElementId === null) return;
    if (registeredElementId !== id) {
      // Re-register under new id. Also re-point the bbox tracker at the
      // new registry key so updates land on the right entry.
      stopBboxTracking();
      bridge.registry.unregisterElement(registeredElementId);
      registeredElementIdRef.current = id;
      bridge.registry.registerElement(id, elementRef.current, {
        type,
        label,
        actions,
        customActions,
        origin: 'hook',
        variant,
        position,
        color,
        contextPath,
        reveals,
      });
      if (logLevel) bridge.registry.setElementLogLevel(id, logLevel);
      startBboxTracking(elementRef.current);
      return;
    }
    bridge.registry.updateElement(id, {
      type,
      label,
      actions,
      customActions,
      variant,
      position,
      color,
      contextPath,
      reveals,
    });
    if (logLevel) bridge.registry.setElementLogLevel(id, logLevel);
    // customActions excluded from key — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, elementKey]);

  // Declare relationships when registered
  const serializedRelationships = JSON.stringify(relationships);
  useEffect(() => {
    if (!bridge || !relationships || relationships.length === 0) return;

    for (const rel of relationships) {
      const opts =
        rel.bidirectional !== undefined || rel.metadata !== undefined
          ? { bidirectional: rel.bidirectional, metadata: rel.metadata }
          : undefined;
      bridge.relationshipTracker.declare(id, rel.targetId, rel.type, opts);
    }

    return () => {
      bridge.relationshipTracker.undeclareAll(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, id, serializedRelationships]);

  // Get state
  const getState = useCallback((): ElementState | null => {
    if (!bridge) return null;
    const registered = bridge.registry.getElement(id);
    return registered?.getState() || null;
  }, [bridge, id]);

  // Get identifier
  const getIdentifier = useCallback((): ElementIdentifier | null => {
    if (!bridge) return null;
    const registered = bridge.registry.getElement(id);
    return registered?.getIdentifier() || null;
  }, [bridge, id]);

  // Trigger action
  const trigger = useCallback(
    async (action: StandardAction | string, params?: Record<string, unknown>) => {
      if (!bridge) {
        throw new Error('UI Bridge not available');
      }

      const response = await bridge.executor.executeAction(id, {
        action,
        params,
      });

      if (!response.success) {
        throw new Error(response.error || 'Action failed');
      }
    },
    [bridge, id]
  );

  // Get element history
  const getHistory = useCallback(
    (historyOptions?: ElementHistoryOptions): ElementLogEntry[] => {
      if (!bridge) return [];
      return bridge.registry.getElementHistory(id, historyOptions);
    },
    [bridge, id]
  );

  // Set log level
  const setLogLevel = useCallback(
    (level: ElementLogLevel): void => {
      bridge?.registry.setElementLogLevel(id, level);
    },
    [bridge, id]
  );

  // Get registered element
  const registeredElement = useMemo(() => {
    if (!bridge) return null;
    return bridge.registry.getElement(id) || null;
  }, [bridge, id]);

  return {
    ref,
    element: elementRef.current,
    registered: registeredRef.current,
    getState,
    getIdentifier,
    trigger,
    register,
    unregister,
    registeredElement,
    getHistory,
    setLogLevel,
  };
}

/**
 * useUIElementRef hook
 *
 * @deprecated data-ui-id is no longer used. Elements are identified through
 * the bridge registry. Use useUIElement() for full registration instead.
 * This hook is a no-op and will be removed in a future version.
 */
export function useUIElementRef(_id: string): React.RefCallback<HTMLElement> {
  return useCallback((_node: HTMLElement | null) => {
    // No-op: data-ui-id is no longer set on DOM elements.
    // Elements are identified through the internal bridge registry.
  }, []);
}
