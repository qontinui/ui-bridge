/**
 * Window-scoped client facade (plan 2026-06-07-multi-window-sdk-automation,
 * Phase 3).
 *
 * `windowScope(bridge, 'term-2')` pre-binds the window-targetable SDK methods to
 * a single runner pop-out window, so a caller driving one window doesn't repeat
 * (and can't typo) `windowLabel` on every call:
 *
 * ```ts
 * const term = windowScope(handlers, 'term-2');
 * await term.evaluate({ expression: 'document.title' });
 * await term.getElements({ text: 'Save' });
 * await term.executeAction('btn-save', { action: 'click' });
 * ```
 *
 * It is pure sugar over the Phase-1 per-call `windowLabel` option — ONE code
 * path. `windowScope(bridge, label).evaluate(req)` is exactly
 * `bridge.pageEvaluate({ ...req, windowLabel: label })`, so there is no
 * divergent behavior to reason about, and not using the scope (or passing a
 * label of `'main'`) is byte-identical to a bare call. Only the window-
 * targetable methods are exposed — you cannot call a non-targetable method on a
 * window scope and get a silent no-op.
 *
 * The read/convenience family (`readValue`/`typeInto`/`clickByText`/…) is
 * intentionally absent until the runner honors `windowLabel` on those routes
 * (Phase 4) — exposing it here would be a dishonest no-op.
 */

import type { ControlActionRequest } from '../control/types';
import type { HandlerContext, UIBridgeServerHandlers } from './types';

/** Options accepted by `getElements`, minus the now-implicit `windowLabel`. */
type ScopedGetElementsOptions = Omit<
  NonNullable<Parameters<UIBridgeServerHandlers['getElements']>[0]>,
  'windowLabel'
>;

/**
 * Args for a scoped `evaluate` — the JS expression plus any extra body fields,
 * minus the now-implicit `windowLabel`. Spelled out rather than
 * `Omit<PageEvaluateRequest, 'windowLabel'>` because `PageEvaluateRequest`'s
 * index signature defeats `Omit` (it would drop the required `expression`).
 */
type ScopedEvaluateRequest = { expression: string; [key: string]: unknown };

/**
 * The window-targetable subset of the SDK, pre-bound to one runner window.
 * Returned by {@link windowScope}.
 */
export interface WindowScopedBridge {
  /** The window label every call on this scope targets. */
  readonly windowLabel: string;

  /**
   * Evaluate a JS expression in the bound window. Delegates to `pageEvaluate`
   * with `windowLabel` injected.
   */
  evaluate(
    request: ScopedEvaluateRequest,
    context?: HandlerContext
  ): ReturnType<UIBridgeServerHandlers['pageEvaluate']>;

  /**
   * Snapshot elements from the bound window. Delegates to `getElements` with
   * `windowLabel` injected.
   */
  getElements(
    options?: ScopedGetElementsOptions,
    context?: HandlerContext
  ): ReturnType<UIBridgeServerHandlers['getElements']>;

  /**
   * Execute an action on an element in the bound window. Delegates to
   * `executeElementAction` with `windowLabel` injected.
   */
  executeAction(
    id: string,
    request: Omit<ControlActionRequest, 'windowLabel'>,
    context?: HandlerContext
  ): ReturnType<UIBridgeServerHandlers['executeElementAction']>;
}

/**
 * Pre-bind the window-targetable methods of a `UIBridgeServerHandlers` to a
 * single runner window. See the module docs for the contract.
 *
 * @param handlers - the bridge handlers (e.g. from `createRelayHandlers`).
 * @param windowLabel - the target window's label (discover via `listWindows()`).
 */
export function windowScope(
  handlers: UIBridgeServerHandlers,
  windowLabel: string
): WindowScopedBridge {
  return {
    windowLabel,
    evaluate: (request, context) =>
      handlers.pageEvaluate({ ...request, windowLabel }, context),
    getElements: (options, context) =>
      handlers.getElements({ ...options, windowLabel }, context),
    executeAction: (id, request, context) =>
      handlers.executeElementAction(id, { ...request, windowLabel }, context),
  };
}
