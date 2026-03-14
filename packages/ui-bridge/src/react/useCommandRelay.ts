'use client';

/**
 * useCommandRelay — Browser-side hook for the SDK command relay
 *
 * Connects to the server's command relay via SSE, receives commands,
 * executes them using the UIBridgeRegistry, and POSTs results back.
 * Also sends periodic heartbeats to signal app responsiveness.
 *
 * This is the SDK equivalent of qontinui-web's useUIBridgeCommandHandler,
 * but portable to any app using @qontinui/ui-bridge.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useUIBridge } from './useUIBridge';

// SSE reconnection delay (10s to avoid Next.js route recompilation cascades)
const SSE_RECONNECT_DELAY_MS = 10_000;

// Heartbeat interval — kept alive even when tab is hidden
const HEARTBEAT_INTERVAL_MS = 10_000;

interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

export interface UseCommandRelayOptions {
  /** Whether the relay is enabled (default: true) */
  enabled?: boolean;
  /** Base path for UI Bridge API routes (default: '/api/ui-bridge') */
  basePath?: string;
  /** Heartbeat interval in ms (default: 10000) */
  heartbeatInterval?: number;
}

/**
 * Get recovery suggestions based on error code
 */
function getRecoverySuggestions(errorCode: string): Array<{
  suggestion: string;
  command?: string;
  confidence: number;
  retryable: boolean;
}> {
  switch (errorCode) {
    case 'ELEMENT_NOT_FOUND':
      return [
        { suggestion: 'Wait for the page to fully load', command: 'wait for page to load', confidence: 0.7, retryable: true },
        { suggestion: 'Use a different description for the element', confidence: 0.8, retryable: false },
      ];
    case 'ELEMENT_NOT_VISIBLE':
      return [
        { suggestion: 'Scroll to make the element visible', command: 'scroll to element', confidence: 0.9, retryable: true },
        { suggestion: 'Close any blocking modals or popups', command: 'click close button', confidence: 0.8, retryable: true },
      ];
    case 'ELEMENT_NOT_ENABLED':
      return [
        { suggestion: 'Fill in required fields first', confidence: 0.8, retryable: false },
        { suggestion: 'Wait for the element to become enabled', confidence: 0.6, retryable: true },
      ];
    default:
      return [
        { suggestion: 'Try a different approach or check the page state', confidence: 0.5, retryable: false },
      ];
  }
}

/**
 * Hook that connects the browser to the server's command relay.
 *
 * 1. Connects to `{basePath}/commands/stream` via SSE
 * 2. Receives commands, executes via UIBridge registry
 * 3. POSTs results back to `{basePath}/commands`
 * 4. Sends heartbeat every 10s to `{basePath}/heartbeat`
 * 5. Handles reconnection on visibility change
 */
export function useCommandRelay(options?: UseCommandRelayOptions): void {
  const enabled = options?.enabled ?? true;
  const basePath = options?.basePath ?? '/api/ui-bridge';
  const heartbeatIntervalMs = options?.heartbeatInterval ?? HEARTBEAT_INTERVAL_MS;

  const { elements, getElement } = useUIBridge();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ========================================================================
  // Command Execution
  // ========================================================================

  const executeCommand = useCallback(
    async (action: string, payload: Record<string, unknown>): Promise<unknown> => {
      switch (action) {
        case 'getControlSnapshot': {
          return {
            timestamp: Date.now(),
            elements: elements.map((e) => {
              const state = e.getState();
              return {
                id: e.id,
                type: e.type,
                label: e.label,
                actions: e.actions,
                state,
              };
            }),
            components: [],
            workflows: [],
            activeRuns: [],
          };
        }

        case 'getElementState': {
          const { id } = payload;
          const element = getElement(id as string);
          if (!element) throw new Error(`Element ${id} not found`);
          const state = element.getState();
          return {
            id: element.id,
            isVisible: state.visible,
            isEnabled: state.enabled,
            text: state.textContent,
            value: state.value,
            checked: state.checked,
            rect: state.rect,
          };
        }

        case 'executeElementAction': {
          const startTime = performance.now();
          const { id, request } = payload as {
            id: string;
            request: { action: string; value?: string; params?: Record<string, unknown>; text?: string; clear?: boolean };
          };

          const createFailure = (errorCode: string, message: string, elementState?: unknown) => ({
            success: false,
            error: message,
            failureDetails: {
              errorCode, message, elementId: id,
              selectorsTried: [`registry:${id}`],
              elementState,
              suggestedActions: getRecoverySuggestions(errorCode),
              retryRecommended: ['ELEMENT_NOT_VISIBLE', 'ACTION_TIMEOUT'].includes(errorCode),
              durationMs: performance.now() - startTime,
            },
            durationMs: performance.now() - startTime,
            timestamp: Date.now(),
          });

          const element = getElement(id);
          if (!element) return createFailure('ELEMENT_NOT_FOUND', `Element ${id} not found`);

          const domElement = (element.element ?? null) as HTMLElement | null;
          if (!domElement) return createFailure('ELEMENT_NOT_FOUND', `DOM element for ${id} not found`, element);

          const isVisible = domElement.offsetParent !== null &&
            getComputedStyle(domElement).visibility !== 'hidden' &&
            getComputedStyle(domElement).display !== 'none';
          if (!isVisible) return createFailure('ELEMENT_NOT_VISIBLE', `Element ${id} exists but is not visible`);
          if ((domElement as HTMLButtonElement).disabled) return createFailure('ELEMENT_NOT_ENABLED', `Element ${id} is disabled`);

          const actionType = request.action;
          try {
            switch (actionType) {
              case 'click': domElement.click(); break;
              case 'focus': domElement.focus(); break;
              case 'blur': domElement.blur(); break;
              case 'type': {
                if (domElement instanceof HTMLInputElement || domElement instanceof HTMLTextAreaElement) {
                  const proto = domElement instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  const text = request.params?.text as string || request.text || '';
                  if (request.params?.clear || request.clear) {
                    if (nativeSetter) nativeSetter.call(domElement, ''); else domElement.value = '';
                    domElement.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  domElement.focus();
                  const current = domElement.value;
                  if (nativeSetter) nativeSetter.call(domElement, current + text); else domElement.value = current + text;
                  domElement.dispatchEvent(new Event('input', { bubbles: true }));
                  domElement.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  return createFailure('UNSUPPORTED_ACTION', `Cannot type into ${domElement.tagName} element`);
                }
                break;
              }
              case 'clear': {
                if (domElement instanceof HTMLInputElement || domElement instanceof HTMLTextAreaElement) {
                  const proto = domElement instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  if (setter) setter.call(domElement, ''); else domElement.value = '';
                  domElement.dispatchEvent(new Event('input', { bubbles: true }));
                  domElement.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  return createFailure('UNSUPPORTED_ACTION', `Cannot clear ${domElement.tagName} element`);
                }
                break;
              }
              case 'setValue': {
                if (domElement instanceof HTMLInputElement || domElement instanceof HTMLTextAreaElement) {
                  const proto = domElement instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  const val = request.value || (request.params?.value as string) || '';
                  if (setter) setter.call(domElement, val); else domElement.value = val;
                  domElement.dispatchEvent(new Event('input', { bubbles: true }));
                  domElement.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  return createFailure('UNSUPPORTED_ACTION', `Cannot set value on ${domElement.tagName} element`);
                }
                break;
              }
              case 'select': {
                if (domElement instanceof HTMLSelectElement) {
                  domElement.value = request.value || '';
                  domElement.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  return createFailure('UNSUPPORTED_ACTION', `Cannot select on ${domElement.tagName} element`);
                }
                break;
              }
              case 'check': {
                if (domElement instanceof HTMLInputElement) {
                  domElement.checked = true;
                  domElement.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  return createFailure('UNSUPPORTED_ACTION', `Cannot check ${domElement.tagName} element`);
                }
                break;
              }
              case 'uncheck': {
                if (domElement instanceof HTMLInputElement) {
                  domElement.checked = false;
                  domElement.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  return createFailure('UNSUPPORTED_ACTION', `Cannot uncheck ${domElement.tagName} element`);
                }
                break;
              }
              default:
                return createFailure('UNSUPPORTED_ACTION', `Unknown action: ${actionType}`);
            }
          } catch (actionError) {
            return createFailure('ACTION_REJECTED', `Action failed: ${(actionError as Error).message}`);
          }

          return { success: true, action: actionType, elementId: id, durationMs: performance.now() - startTime, timestamp: Date.now() };
        }

        case 'highlightElement': {
          const { id } = payload;
          const domElement = (getElement(id as string)?.element ?? null) as HTMLElement | null;
          if (domElement) {
            const originalOutline = domElement.style.outline;
            const originalTransition = domElement.style.transition;
            domElement.style.transition = 'outline 0.2s';
            domElement.style.outline = '3px solid #ff6b00';
            setTimeout(() => {
              domElement.style.outline = originalOutline;
              domElement.style.transition = originalTransition;
            }, 2000);
          }
          return { success: true };
        }

        case 'find':
        case 'discover': {
          return {
            elements: elements.map((e) => {
              const state = e.getState();
              return {
                id: e.id, type: e.type, label: e.label,
                tagName: e.element.tagName.toLowerCase(),
                role: e.element.getAttribute('role') ?? undefined,
                accessibleName: e.element.getAttribute('aria-label') ?? e.label,
                actions: e.actions, state, registered: true,
              };
            }),
            total: elements.length,
            durationMs: 0,
            timestamp: Date.now(),
          };
        }

        case 'aiSearch': {
          const { createSearchEngine } = await import('../ai');
          const searchEngine = createSearchEngine({ includeHidden: true });
          searchEngine.updateElements(elements);
          const searchCriteria = { fuzzy: true, ...(payload as Parameters<typeof searchEngine.search>[0]) };
          const searchResponse = searchEngine.search(searchCriteria);
          return {
            results: searchResponse.results,
            total: searchResponse.results.length,
            scannedCount: searchResponse.scannedCount,
            timestamp: Date.now(),
          };
        }

        case 'aiExecute': {
          const startTime = performance.now();
          const { parseNLInstruction, createSearchEngine } = await import('../ai');
          const { instruction, confidenceThreshold = 0.7 } = payload as { instruction: string; confidenceThreshold?: number };

          const parsed = parseNLInstruction(instruction);
          if (!parsed) {
            return { success: false, executedAction: instruction, error: `Could not parse instruction: "${instruction}"`, errorCode: 'PARSE_ERROR', durationMs: performance.now() - startTime, timestamp: Date.now() };
          }

          const searchEngine = createSearchEngine({ includeHidden: true });
          searchEngine.updateElements(elements);
          const searchResponse = searchEngine.search({ text: parsed.targetDescription, fuzzy: true });

          if (searchResponse.results.length === 0) {
            return { success: false, executedAction: instruction, error: `No element found matching: "${parsed.targetDescription}"`, errorCode: 'ELEMENT_NOT_FOUND', durationMs: performance.now() - startTime, timestamp: Date.now() };
          }

          const firstResult = searchResponse.results[0];
          if (!firstResult || firstResult.confidence < confidenceThreshold) {
            return { success: false, executedAction: instruction, error: `Best match confidence too low`, errorCode: 'LOW_CONFIDENCE', confidence: firstResult?.confidence || 0, durationMs: performance.now() - startTime, timestamp: Date.now() };
          }

          const targetElement = firstResult.element;
          const domElement = (getElement(targetElement.id)?.element ?? null) as HTMLElement | null;
          if (!domElement) {
            return { success: false, executedAction: instruction, error: `DOM element not found for ${targetElement.id}`, errorCode: 'ELEMENT_NOT_FOUND', durationMs: performance.now() - startTime, timestamp: Date.now() };
          }

          try {
            switch (parsed.action) {
              case 'click': domElement.click(); break;
              case 'type':
                if (domElement instanceof HTMLInputElement || domElement instanceof HTMLTextAreaElement) {
                  domElement.value = parsed.value || '';
                  domElement.dispatchEvent(new Event('input', { bubbles: true }));
                  domElement.dispatchEvent(new Event('change', { bubbles: true }));
                }
                break;
              case 'select':
                if (domElement instanceof HTMLSelectElement) {
                  domElement.value = parsed.value || '';
                  domElement.dispatchEvent(new Event('change', { bubbles: true }));
                }
                break;
              default: break;
            }
          } catch (actionError) {
            return { success: false, executedAction: instruction, error: `Action failed: ${(actionError as Error).message}`, errorCode: 'ACTION_REJECTED', durationMs: performance.now() - startTime, timestamp: Date.now() };
          }

          return { success: true, executedAction: `${parsed.action} on ${targetElement.id}`, elementUsed: targetElement, confidence: firstResult.confidence, durationMs: performance.now() - startTime, timestamp: Date.now() };
        }

        case 'aiAssert': {
          const { createAssertionExecutor } = await import('../ai');
          type AssertionType = import('../ai').AssertionType;
          const executor = createAssertionExecutor({});
          executor.updateElements(elements as unknown as Parameters<typeof executor.updateElements>[0]);
          const req = payload as { target: string; type: string; expected?: unknown };
          return executor.assert({ target: req.target, type: req.type as AssertionType, expected: req.expected });
        }

        case 'aiAssertBatch': {
          const { createAssertionExecutor } = await import('../ai');
          type AssertionType = import('../ai').AssertionType;
          const executor = createAssertionExecutor({});
          executor.updateElements(elements as unknown as Parameters<typeof executor.updateElements>[0]);
          const req = payload as { assertions: Array<{ target: string; type: string; expected?: unknown }>; mode?: 'all' | 'any' };
          return executor.assertBatch({
            assertions: req.assertions.map((a) => ({ target: a.target, type: a.type as AssertionType, expected: a.expected })),
            mode: req.mode || 'all',
          });
        }

        case 'getSemanticSnapshot': {
          const { createSnapshotManager } = await import('../ai');
          const manager = createSnapshotManager({});
          const controlSnapshot = {
            timestamp: Date.now(),
            elements: elements.map((e) => ({ id: e.id, type: e.type, label: e.label, actions: e.actions, state: e.getState() })),
            components: [], workflows: [], activeRuns: [],
          };
          return manager.createSnapshot(controlSnapshot);
        }

        case 'getSemanticDiff': return null;

        case 'getPageSummary': {
          const { generatePageSummary } = await import('../ai');
          const aiElements = elements.map((e) => ({
            id: e.id, type: e.type, label: e.label,
            tagName: e.element.tagName.toLowerCase(),
            actions: e.actions as string[], state: e.getState(),
            registered: true, description: e.description || e.label || e.id,
            aliases: e.aliases || [], suggestedActions: [],
          }));
          return generatePageSummary(aiElements as Parameters<typeof generatePageSummary>[0]);
        }

        case 'getTabInfo': {
          return { url: window.location.href, pathname: window.location.pathname, title: document.title, timestamp: Date.now() };
        }

        case 'getElementTree': {
          return {
            root: document.title, elements: elements.length,
            tree: elements.slice(0, 50).map((e) => ({ id: e.id, tag: e.element.tagName.toLowerCase(), text: (e.label ?? e.element.textContent ?? '').slice(0, 50) })),
          };
        }

        case 'captureSnapshot': return { captured: true, timestamp: Date.now() };

        case 'getComponentState': return { state: {}, computed: {}, timestamp: Date.now() };

        case 'getActionHistory': return [];

        default:
          throw new Error(`Unknown command action: ${action}`);
      }
    },
    [elements, getElement]
  );

  // ========================================================================
  // Response Sender
  // ========================================================================

  const sendResponse = useCallback(
    async (commandId: string, ok: boolean, result: unknown) => {
      try {
        await fetch(`${basePath}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandId, success: ok, result,
            error: ok ? undefined : (result as { error?: string })?.error,
          }),
        });
      } catch (e) {
        console.error('[UIBridge] Failed to send command response:', e);
      }
    },
    [basePath]
  );

  // ========================================================================
  // Command Processor
  // ========================================================================

  const processCommand = useCallback(
    async (command: QueuedCommand) => {
      try {
        const result = await executeCommand(command.action, command.payload as Record<string, unknown>);
        const resultObj = result as { success?: boolean };
        if (resultObj && resultObj.success === false) {
          await sendResponse(command.commandId, false, result);
          return;
        }
        await sendResponse(command.commandId, true, result);
      } catch (e: unknown) {
        const errorMessage = (e as Error).message;
        let errorCode = 'UNKNOWN_ERROR';
        if (errorMessage.includes('not found')) errorCode = 'ELEMENT_NOT_FOUND';
        else if (errorMessage.includes('timeout')) errorCode = 'ACTION_TIMEOUT';

        await sendResponse(command.commandId, false, {
          success: false, error: errorMessage,
          failureDetails: {
            errorCode, message: errorMessage,
            suggestedActions: getRecoverySuggestions(errorCode),
            retryRecommended: ['ACTION_TIMEOUT', 'ELEMENT_NOT_VISIBLE'].includes(errorCode),
            timestamp: Date.now(),
          },
          durationMs: 0, timestamp: Date.now(),
        });
      }
    },
    [executeCommand, sendResponse]
  );

  // ========================================================================
  // SSE Connection
  // ========================================================================

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      return;
    }

    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      const es = new EventSource(`${basePath}/commands/stream`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') return;
          if (data.commandId && data.action) processCommand(data as QueuedCommand);
        } catch (e) {
          console.error('[UIBridge] Failed to parse SSE message:', e);
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        if (isMounted && document.visibilityState === 'visible') {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMounted) connect();
          }, SSE_RECONNECT_DELAY_MS);
        }
      };
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (!eventSourceRef.current) connect();
      } else {
        if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
        if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      }
    };

    if (document.visibilityState === 'visible') connect();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, basePath, processCommand]);

  // ========================================================================
  // Heartbeat
  // ========================================================================

  useEffect(() => {
    if (!enabled) return;

    const sendHeartbeat = () => {
      fetch(`${basePath}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: Date.now() }),
      }).catch(() => { /* non-fatal */ });
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, heartbeatIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, basePath, heartbeatIntervalMs]);
}
