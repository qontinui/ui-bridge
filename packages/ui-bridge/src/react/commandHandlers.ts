/**
 * Command Handlers for the browser-side Command Relay
 *
 * Maps every relay command action to a browser-side implementation.
 * Commands access the UIBridgeRegistry, trackers on window.__UI_BRIDGE__,
 * and DOM APIs to fulfill server-side relay requests.
 */

import type { RegisteredElement } from '../core/types';
import { getGlobalRegistry } from '../core/registry';

// ============================================================================
// Types
// ============================================================================

/** Registry interface for state management access */
export interface RegistryAccess {
  getAllStates?: () => unknown[];
  getState?: (id: string) => unknown;
  getActiveStates?: () => string[];
  activateState?: (id: string) => void;
  deactivateState?: (id: string) => void;
  getAllStateGroups?: () => unknown[];
  getStateGroup?: (id: string) => unknown;
  activateStateGroup?: (id: string) => void;
  deactivateStateGroup?: (id: string) => void;
  getAllTransitions?: () => unknown[];
  getTransition?: (id: string) => unknown;
  canExecuteTransition?: (id: string) => boolean;
  executeTransition?: (id: string) => Promise<unknown>;
  findPath?: (targets: string[]) => unknown;
  navigateTo?: (targets: string[]) => Promise<unknown>;
  getStateSnapshot?: () => unknown;
  find?: (criteria: unknown) => unknown;
}

/** Minimal interface for what useUIBridge() + context provides */
export interface BridgeAccess {
  elements: RegisteredElement[];
  getElement: (id: string) => RegisteredElement | undefined;
  components: Array<{ id: string; name: string; description?: string; actions?: Array<{ id: string; name: string; description?: string }>; elementIds?: string[]; getState?: () => unknown }>;
  workflows: Array<{ id: string; name: string; description?: string; steps?: unknown[] }>;
  executeAction?: (elementId: string, request: unknown) => Promise<unknown>;
  executeComponentAction?: (componentId: string, request: unknown) => Promise<unknown>;
  runWorkflow?: (workflowId: string, request?: unknown) => Promise<unknown>;
  getWorkflowStatus?: (runId: string) => Promise<unknown>;
  captureRenderLog?: () => Promise<void>;
  getRenderLogEntries?: () => Promise<unknown[]>;
  clearRenderLog?: () => Promise<void>;
  getMetrics?: () => unknown;
  getActionHistory?: () => unknown[];
  find?: (options?: unknown) => Promise<unknown>;
  registry?: RegistryAccess;
}

/** Browser-side global __UI_BRIDGE__ */
interface UIBridgeGlobal {
  browserCapture?: BrowserCapture;
  consoleCapture?: BrowserCapture;
  navigationTracker?: NavigationTracker;
  shortcutTracker?: ShortcutTracker;
  modalDetector?: ModalDetector;
  toastCapture?: ToastCapture;
  relationshipTracker?: RelationshipTracker;
  dragDropDetector?: DragDropDetector;
  undoTracker?: UndoTracker;
  specs?: { getGlobalSpecStore: () => SpecStore };
}

interface BrowserCapture {
  getSince: (ts: number) => unknown[];
  getRecent: (n: number) => unknown[];
  getByType: (type: string) => unknown[];
  getConsoleSince: (ts: number) => unknown[];
  getConsoleRecent: (n: number) => unknown[];
  getFrameworkOverlays: () => unknown;
  getMemoryTrend: () => unknown;
  clear: () => void;
}
interface NavigationTracker {
  getCurrentPage: () => unknown;
  getRecentNavigations: () => unknown[];
}
interface ShortcutTracker {
  getSince?: (ts: number) => unknown[];
  getRecent?: (n: number) => unknown[];
}
interface ModalDetector { detect: () => unknown }
interface ToastCapture {
  getRecent: (n: number) => unknown[];
  getSince: (ts: number) => unknown[];
}
interface RelationshipTracker {
  declare: (source: string, target: string, type: string) => void;
  getRelationships: () => unknown[];
}
interface DragDropDetector {
  getSources: () => unknown[];
  getZones: () => unknown[];
}
interface UndoTracker {
  getState: () => unknown;
  setDeclaredState?: (state: unknown) => void;
}
interface SpecStore {
  load?: (id: string, config: unknown) => void;
  get?: (id: string) => unknown;
  getAll?: () => unknown[];
}

// Intent store (globalThis-backed for HMR persistence)
function getIntentStore(): Map<string, unknown> {
  const g = globalThis as unknown as { __UI_BRIDGE_INTENTS__?: Map<string, unknown> };
  if (!g.__UI_BRIDGE_INTENTS__) g.__UI_BRIDGE_INTENTS__ = new Map();
  return g.__UI_BRIDGE_INTENTS__;
}

// Payload type alias
type P = Record<string, unknown>;

// ============================================================================
// Helpers
// ============================================================================

function getBridge(): UIBridgeGlobal {
  return (globalThis as unknown as { __UI_BRIDGE__?: UIBridgeGlobal }).__UI_BRIDGE__ ?? {};
}

function getRecoverySuggestions(errorCode: string) {
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

function createActionFailure(id: string, errorCode: string, message: string, startTime: number, elementState?: unknown) {
  return {
    success: false, error: message,
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
  };
}

function elementToSnapshot(e: RegisteredElement) {
  const state = e.getState();
  return { id: e.id, type: e.type, label: e.label, actions: e.actions, state };
}

function elementToFindResult(e: RegisteredElement) {
  const state = e.getState();
  return {
    id: e.id, type: e.type, label: e.label,
    tagName: e.element.tagName.toLowerCase(),
    role: e.element.getAttribute('role') ?? undefined,
    accessibleName: e.element.getAttribute('aria-label') ?? e.label,
    actions: e.actions, state, registered: true,
  };
}

function getComputedStylesSafe(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const keys = [
    'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight',
    'padding', 'margin', 'border', 'borderRadius', 'display', 'position',
    'width', 'height', 'opacity', 'overflow', 'textAlign', 'lineHeight',
    'boxShadow', 'cursor', 'zIndex',
  ];
  const styles: Record<string, string> = {};
  for (const k of keys) styles[k] = cs.getPropertyValue(k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)) || (cs as unknown as Record<string, string>)[k] || '';
  return styles;
}

// Idle detector singleton (lazy-initialized)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let idleDetector: any = null;

async function getIdleDetector() {
  if (idleDetector) return idleDetector;
  try {
    const { CompositeIdleDetector } = await import('../idle');
    const detector = new CompositeIdleDetector();
    detector.installAll();
    idleDetector = detector;
    return detector;
  } catch {
    return null;
  }
}

// Annotation store singleton (lazy-initialized)
async function getAnnotationStore() {
  try {
    const { getGlobalAnnotationStore } = await import('../annotations/store');
    return getGlobalAnnotationStore();
  } catch {
    return null;
  }
}

// Network request tracking (via fetch interception)
interface TrackedRequest {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  headers?: Record<string, string>;
  error?: string;
  inFlight: boolean;
}

const networkRequests: TrackedRequest[] = [];
let networkIntercepted = false;
const MAX_TRACKED_REQUESTS = 500;

function installNetworkInterceptor() {
  if (networkIntercepted) return;
  networkIntercepted = true;

  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const req = new Request(...args);
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tracked: TrackedRequest = {
      id, url: req.url, method: req.method,
      startTime: Date.now(), inFlight: true,
    };
    networkRequests.push(tracked);
    if (networkRequests.length > MAX_TRACKED_REQUESTS) networkRequests.shift();

    try {
      const response = await originalFetch.apply(this, args);
      tracked.status = response.status;
      tracked.statusText = response.statusText;
      tracked.endTime = Date.now();
      tracked.duration = tracked.endTime - tracked.startTime;
      tracked.inFlight = false;
      return response;
    } catch (err) {
      tracked.error = (err as Error).message;
      tracked.endTime = Date.now();
      tracked.duration = tracked.endTime - tracked.startTime;
      tracked.inFlight = false;
      throw err;
    }
  };
}

// Change buffer
interface ChangeEntry { timestamp: number; type: string; detail: unknown }
let changeBufferEnabled = false;
const changeBuffer: ChangeEntry[] = [];
let changeObserver: MutationObserver | null = null;

function enableChangeTracking() {
  if (changeObserver) return;
  changeObserver = new MutationObserver((mutations) => {
    if (!changeBufferEnabled) return;
    for (const m of mutations) {
      changeBuffer.push({
        timestamp: Date.now(),
        type: m.type,
        detail: {
          target: (m.target as HTMLElement).tagName,
          attributeName: m.attributeName,
          addedNodes: m.addedNodes.length,
          removedNodes: m.removedNodes.length,
        },
      });
    }
  });
  changeObserver.observe(document.body, {
    childList: true, subtree: true, attributes: true, characterData: true,
  });
}

// Snapshot bookmarks
const bookmarks = new Map<string, { name: string; timestamp: number; snapshot: unknown }>();

// Error sessions
interface ErrorSession {
  id: string;
  label?: string;
  startTime: number;
  endTime?: number;
  errors: unknown[];
}
let currentErrorSession: ErrorSession | null = null;
const errorSessions: ErrorSession[] = [];
const errorBaselines = new Map<string, { label: string; timestamp: number; errors: unknown[] }>();

// Style guide
let loadedStyleGuide: unknown = null;

// ============================================================================
// Main Command Executor
// ============================================================================

export async function executeCommand(
  action: string,
  payload: P,
  bridge: BridgeAccess,
): Promise<unknown> {
  const g = getBridge();

  // Read elements, components, and workflows from the live global registry
  // instead of the stale memoized bridge arrays. The bridge collections are
  // captured via useMemo in useUIBridge and never update when
  // AutoRegisterProvider registers elements, because registry mutations
  // don't trigger React re-renders.
  const registry = getGlobalRegistry();
  const elements = registry.getAllElements();
  const components = registry.getAllComponents();
  const workflows = registry.getAllWorkflows();
  const getElement = (id: string) => registry.getElement(id);

  switch (action) {
    // ======================================================================
    // Control — Snapshot & Elements
    // ======================================================================

    case 'getControlSnapshot':
      return {
        timestamp: Date.now(),
        elements: elements.map(elementToSnapshot),
        components: components.map(c => ({
          id: c.id, name: c.name, description: c.description,
          actions: c.actions, elementIds: c.elementIds,
          state: c.getState?.() ?? {},
        })),
        workflows: workflows.map(w => ({ id: w.id, name: w.name, description: w.description, steps: w.steps })),
        activeRuns: [],
      };

    case 'getElementState': {
      const el = getElement(payload.id as string);
      if (!el) throw new Error(`Element ${payload.id} not found`);
      const state = el.getState();
      return { id: el.id, isVisible: state.visible, isEnabled: state.enabled, text: state.textContent, value: state.value, checked: state.checked, rect: state.rect };
    }

    case 'executeElementAction': {
      const startTime = performance.now();
      const { id, request } = payload as { id: string; request: { action: string; value?: string; params?: P; text?: string; clear?: boolean } };
      const el = getElement(id);
      if (!el) return createActionFailure(id, 'ELEMENT_NOT_FOUND', `Element ${id} not found`, startTime);
      const dom = (el.element ?? null) as HTMLElement | null;
      if (!dom) return createActionFailure(id, 'ELEMENT_NOT_FOUND', `DOM element for ${id} not found`, startTime, el);
      const isVis = dom.offsetParent !== null && getComputedStyle(dom).visibility !== 'hidden' && getComputedStyle(dom).display !== 'none';
      if (!isVis) return createActionFailure(id, 'ELEMENT_NOT_VISIBLE', `Element ${id} exists but is not visible`, startTime);
      if ((dom as HTMLButtonElement).disabled) return createActionFailure(id, 'ELEMENT_NOT_ENABLED', `Element ${id} is disabled`, startTime);

      try {
        switch (request.action) {
          case 'click': dom.click(); break;
          case 'focus': dom.focus(); break;
          case 'blur': dom.blur(); break;
          case 'hover': dom.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); dom.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); break;
          case 'scrollIntoView': dom.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
          case 'doubleClick': dom.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); break;
          case 'type': {
            if (dom instanceof HTMLInputElement || dom instanceof HTMLTextAreaElement) {
              const proto = dom instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              const text = (request.params?.text as string) || request.text || '';
              if (request.params?.clear || request.clear) {
                if (setter) setter.call(dom, ''); else dom.value = '';
                dom.dispatchEvent(new Event('input', { bubbles: true }));
              }
              dom.focus();
              const cur = dom.value;
              if (setter) setter.call(dom, cur + text); else dom.value = cur + text;
              dom.dispatchEvent(new Event('input', { bubbles: true }));
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            } else return createActionFailure(id, 'UNSUPPORTED_ACTION', `Cannot type into ${dom.tagName}`, startTime);
            break;
          }
          case 'clear': {
            if (dom instanceof HTMLInputElement || dom instanceof HTMLTextAreaElement) {
              const proto = dom instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(dom, ''); else dom.value = '';
              dom.dispatchEvent(new Event('input', { bubbles: true }));
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            } else return createActionFailure(id, 'UNSUPPORTED_ACTION', `Cannot clear ${dom.tagName}`, startTime);
            break;
          }
          case 'setValue': {
            if (dom instanceof HTMLInputElement || dom instanceof HTMLTextAreaElement) {
              const proto = dom instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              const val = request.value || (request.params?.value as string) || '';
              if (setter) setter.call(dom, val); else dom.value = val;
              dom.dispatchEvent(new Event('input', { bubbles: true }));
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            } else return createActionFailure(id, 'UNSUPPORTED_ACTION', `Cannot set value on ${dom.tagName}`, startTime);
            break;
          }
          case 'select': {
            if (dom instanceof HTMLSelectElement) {
              dom.value = request.value || '';
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            } else return createActionFailure(id, 'UNSUPPORTED_ACTION', `Cannot select on ${dom.tagName}`, startTime);
            break;
          }
          case 'check': {
            if (dom instanceof HTMLInputElement) { dom.checked = true; dom.dispatchEvent(new Event('change', { bubbles: true })); }
            else return createActionFailure(id, 'UNSUPPORTED_ACTION', `Cannot check ${dom.tagName}`, startTime);
            break;
          }
          case 'uncheck': {
            if (dom instanceof HTMLInputElement) { dom.checked = false; dom.dispatchEvent(new Event('change', { bubbles: true })); }
            else return createActionFailure(id, 'UNSUPPORTED_ACTION', `Cannot uncheck ${dom.tagName}`, startTime);
            break;
          }
          case 'submit': {
            const form = dom.closest('form');
            if (form) form.requestSubmit(); else dom.click();
            break;
          }
          case 'reset': {
            const form = dom.closest('form');
            if (form) form.reset();
            break;
          }
          case 'sendKeys': {
            const keys = (request.params?.keys as string) || (request.params?.text as string) || '';
            dom.focus();
            for (const key of keys) {
              dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
              dom.dispatchEvent(new KeyboardEvent('keypress', { key, bubbles: true }));
              dom.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
            }
            break;
          }
          case 'drag': {
            const { targetId } = request.params as { targetId?: string } ?? {};
            const targetEl = targetId ? (getElement(targetId)?.element as HTMLElement) : null;
            const srcRect = dom.getBoundingClientRect();
            dom.dispatchEvent(new DragEvent('dragstart', { bubbles: true, clientX: srcRect.x + srcRect.width / 2, clientY: srcRect.y + srcRect.height / 2 }));
            if (targetEl) {
              const tgtRect = targetEl.getBoundingClientRect();
              targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: tgtRect.x + tgtRect.width / 2, clientY: tgtRect.y + tgtRect.height / 2 }));
              targetEl.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: tgtRect.x + tgtRect.width / 2, clientY: tgtRect.y + tgtRect.height / 2 }));
            }
            dom.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
            break;
          }
          default:
            return createActionFailure(id, 'UNSUPPORTED_ACTION', `Unknown action: ${request.action}`, startTime);
        }
      } catch (err) {
        return createActionFailure(id, 'ACTION_REJECTED', `Action failed: ${(err as Error).message}`, startTime);
      }
      return { success: true, action: request.action, elementId: id, durationMs: performance.now() - startTime, timestamp: Date.now() };
    }

    case 'highlightElement': {
      const dom = (getElement(payload.id as string)?.element ?? null) as HTMLElement | null;
      if (dom) {
        const origOutline = dom.style.outline;
        const origTransition = dom.style.transition;
        dom.style.transition = 'outline 0.2s';
        dom.style.outline = '3px solid #ff6b00';
        setTimeout(() => { dom.style.outline = origOutline; dom.style.transition = origTransition; }, 2000);
      }
      return { success: true };
    }

    case 'find':
    case 'discover': {
      const { interactive_only, include_hidden, type: filterType, text: filterText } = payload as {
        interactive_only?: boolean; include_hidden?: boolean; type?: string; text?: string;
      };
      let filtered = elements;
      if (interactive_only) {
        const interactiveTypes = new Set(['button', 'input', 'select', 'textarea', 'link', 'checkbox', 'radio']);
        filtered = filtered.filter(e => interactiveTypes.has(e.type) || e.actions.length > 0);
      }
      if (!include_hidden) {
        filtered = filtered.filter(e => {
          const dom = e.element as HTMLElement;
          return dom.offsetParent !== null || getComputedStyle(dom).position === 'fixed';
        });
      }
      if (filterType) filtered = filtered.filter(e => e.type === filterType);
      if (filterText) {
        const lc = filterText.toLowerCase();
        filtered = filtered.filter(e => (e.label ?? '').toLowerCase().includes(lc) || (e.element.textContent ?? '').toLowerCase().includes(lc));
      }
      return { elements: filtered.map(elementToFindResult), total: filtered.length, durationMs: 0, timestamp: Date.now() };
    }

    case 'getElementTree':
      return {
        root: document.title, elements: elements.length,
        tree: elements.slice(0, 50).map(e => ({ id: e.id, tag: e.element.tagName.toLowerCase(), text: (e.label ?? e.element.textContent ?? '').slice(0, 50) })),
      };

    case 'getTabInfo':
      return { url: window.location.href, pathname: window.location.pathname, title: document.title, timestamp: Date.now() };

    // ======================================================================
    // Control — Components
    // ======================================================================

    case 'getComponentState': {
      const compId = payload.id as string;
      const comp = registry.getComponent(compId);
      if (!comp) {
        return {
          success: false,
          error: `Component "${compId}" not found. Components are only available when their page is active.`,
          timestamp: Date.now(),
        };
      }
      return {
        success: true,
        state: comp.getState?.() ?? {},
        computed: comp.getComputed?.() ?? {},
        timestamp: Date.now(),
      };
    }

    case 'executeComponentAction': {
      const { id, request } = payload as { id: string; request: { action: string; actionId?: string; params?: P } };
      const actionId = request.actionId ?? request.action;
      const comp = registry.getComponent(id);
      if (!comp) {
        return {
          success: false,
          error: `Component "${id}" not found. Components are only available when their page is active.`,
          timestamp: Date.now(),
        };
      }
      const action = comp.actions.find(a => a.id === actionId);
      if (!action) {
        return {
          success: false,
          error: `Action "${actionId}" not found on component "${id}". Available actions: ${comp.actions.map(a => a.id).join(', ')}`,
          timestamp: Date.now(),
        };
      }
      try {
        const result = await action.handler(request.params);
        return { success: true, result, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    // ======================================================================
    // Control — Workflows
    // ======================================================================

    case 'runWorkflow': {
      const { id, request } = payload as { id: string; request?: unknown };
      if (bridge.runWorkflow) {
        try { return await bridge.runWorkflow(id, request); }
        catch (err) { return { success: false, error: (err as Error).message }; }
      }
      return { success: false, error: 'Workflows not available' };
    }

    case 'getWorkflowStatus': {
      const statusRunId = payload.runId as string;
      if (bridge.getWorkflowStatus) {
        try {
          const status = await bridge.getWorkflowStatus(statusRunId);
          if (status) return status;
          return { success: false, error: `Run not found: ${statusRunId}` };
        } catch (err) { return { success: false, error: (err as Error).message }; }
      }
      return { success: false, error: 'Workflow status not available' };
    }

    // ======================================================================
    // Render Log
    // ======================================================================

    case 'captureSnapshot':
      if (bridge.captureRenderLog) await bridge.captureRenderLog();
      return { captured: true, timestamp: Date.now() };

    // ======================================================================
    // Debug — Action History & Metrics
    // ======================================================================

    case 'getActionHistory':
      return bridge.getActionHistory?.() ?? [];

    case 'getMetrics':
      return bridge.getMetrics?.() ?? { timestamp: Date.now() };

    // ======================================================================
    // AI — Search, Execute, Assert
    // ======================================================================

    case 'aiSearch': {
      const { createSearchEngine } = await import('../ai');
      const engine = createSearchEngine({ includeHidden: true });
      engine.updateElements(elements);
      const resp = engine.search({ fuzzy: true, ...(payload as Parameters<typeof engine.search>[0]) });
      return { results: resp.results, total: resp.results.length, scannedCount: resp.scannedCount, timestamp: Date.now() };
    }

    case 'aiFind': {
      const { createSearchEngine } = await import('../ai');
      const engine = createSearchEngine({ includeHidden: true });
      engine.updateElements(elements);
      const { query, type, context: ctx } = payload as { query?: string; type?: string; context?: string };
      const resp = engine.search({ text: query, type: type as never, fuzzy: true });
      return { results: resp.results, total: resp.results.length, query, context: ctx, timestamp: Date.now() };
    }

    case 'aiExecute': {
      const t0 = performance.now();
      const { parseNLInstruction, createSearchEngine } = await import('../ai');
      const { instruction, confidenceThreshold = 0.7 } = payload as { instruction: string; confidenceThreshold?: number };
      const parsed = parseNLInstruction(instruction);
      if (!parsed) return { success: false, executedAction: instruction, error: `Could not parse: "${instruction}"`, errorCode: 'PARSE_ERROR', durationMs: performance.now() - t0, timestamp: Date.now() };
      const engine = createSearchEngine({ includeHidden: true });
      engine.updateElements(elements);
      const resp = engine.search({ text: parsed.targetDescription, fuzzy: true });
      if (!resp.results.length) return { success: false, executedAction: instruction, error: `No element matching: "${parsed.targetDescription}"`, errorCode: 'ELEMENT_NOT_FOUND', durationMs: performance.now() - t0, timestamp: Date.now() };
      const best = resp.results[0];
      if (!best || best.confidence < confidenceThreshold) return { success: false, executedAction: instruction, error: 'Best match confidence too low', errorCode: 'LOW_CONFIDENCE', confidence: best?.confidence || 0, durationMs: performance.now() - t0, timestamp: Date.now() };
      const dom = (getElement(best.element.id)?.element ?? null) as HTMLElement | null;
      if (!dom) return { success: false, executedAction: instruction, error: `DOM not found for ${best.element.id}`, errorCode: 'ELEMENT_NOT_FOUND', durationMs: performance.now() - t0, timestamp: Date.now() };
      try {
        switch (parsed.action) {
          case 'click': dom.click(); break;
          case 'type': if (dom instanceof HTMLInputElement || dom instanceof HTMLTextAreaElement) {
            const proto = dom instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(dom, parsed.value || ''); else dom.value = parsed.value || '';
            dom.dispatchEvent(new Event('input', { bubbles: true }));
            dom.dispatchEvent(new Event('change', { bubbles: true }));
          } break;
          case 'select': if (dom instanceof HTMLSelectElement) { dom.value = parsed.value || ''; dom.dispatchEvent(new Event('change', { bubbles: true })); } break;
          default: break;
        }
      } catch (err) { return { success: false, executedAction: instruction, error: `Action failed: ${(err as Error).message}`, errorCode: 'ACTION_REJECTED', durationMs: performance.now() - t0, timestamp: Date.now() }; }
      return { success: true, executedAction: `${parsed.action} on ${best.element.id}`, elementUsed: best.element, confidence: best.confidence, durationMs: performance.now() - t0, timestamp: Date.now() };
    }

    case 'aiAssert': {
      const { createAssertionExecutor } = await import('../ai');
      type AT = import('../ai').AssertionType;
      const exec = createAssertionExecutor({});
      exec.updateElements(elements as unknown as Parameters<typeof exec.updateElements>[0]);
      const r = payload as { target: string; type: string; expected?: unknown };
      return exec.assert({ target: r.target, type: r.type as AT, expected: r.expected });
    }

    case 'aiAssertBatch': {
      const { createAssertionExecutor } = await import('../ai');
      type AT = import('../ai').AssertionType;
      const exec = createAssertionExecutor({});
      exec.updateElements(elements as unknown as Parameters<typeof exec.updateElements>[0]);
      const r = payload as { assertions: Array<{ target: string; type: string; expected?: unknown }>; mode?: 'all' | 'any' };
      return exec.assertBatch({ assertions: r.assertions.map(a => ({ target: a.target, type: a.type as AT, expected: a.expected })), mode: r.mode || 'all' });
    }

    case 'getSemanticSnapshot': {
      const { createSnapshotManager } = await import('../ai');
      const mgr = createSnapshotManager({});
      const snap = { timestamp: Date.now(), elements: elements.map(elementToSnapshot), components: [], workflows: [], activeRuns: [] };
      return mgr.createSnapshot(snap);
    }

    case 'getSemanticDiff':
      return { changes: [], since: payload.since, timestamp: Date.now() };

    case 'getPageSummary': {
      const { generatePageSummary } = await import('../ai');
      const aiEls = elements.map(e => ({
        id: e.id, type: e.type, label: e.label,
        tagName: e.element.tagName.toLowerCase(),
        actions: e.actions as string[], state: e.getState(),
        registered: true, description: e.description || e.label || e.id,
        aliases: e.aliases || [], suggestedActions: [],
      }));
      return generatePageSummary(aiEls as Parameters<typeof generatePageSummary>[0]);
    }

    case 'aiSemanticSearch': {
      const { createSearchEngine } = await import('../ai');
      const engine = createSearchEngine({ includeHidden: true });
      engine.updateElements(elements);
      const resp = engine.search({ fuzzy: true, ...(payload as Parameters<typeof engine.search>[0]) });
      return { results: resp.results, total: resp.results.length, timestamp: Date.now() };
    }

    // ======================================================================
    // Change Tracking & Buffer
    // ======================================================================

    case 'executeWithDiff': {
      const { elementId, action: act, params } = payload as { elementId: string; action: string; params?: P };
      const before = elements.map(elementToSnapshot);
      // Execute the action
      const actionResult = await executeCommand('executeElementAction', { id: elementId, request: { action: act, ...params } }, bridge);
      await new Promise(r => setTimeout(r, 100)); // Brief wait for DOM to settle
      const after = elements.map(elementToSnapshot);
      return { actionResult, diff: { before: before.length, after: after.length, timestamp: Date.now() } };
    }

    case 'waitForChange': {
      const opts = payload as { predicate?: unknown; options?: { timeout?: number }; timeout?: number };
      const timeout = opts.timeout ?? opts.options?.timeout ?? 5000;
      return new Promise(resolve => {
        const observer = new MutationObserver(() => { observer.disconnect(); resolve({ changed: true, timestamp: Date.now() }); });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        setTimeout(() => { observer.disconnect(); resolve({ changed: false, timedOut: true, timestamp: Date.now() }); }, timeout as number);
      });
    }

    case 'categorizeLastDiff':
      return { category: 'unknown', timestamp: Date.now() };

    case 'getScopedDiff':
      return { changes: [], scope: payload.scope, timestamp: Date.now() };

    case 'summarizeDiff':
      return { summary: 'No diff data available', timestamp: Date.now() };

    case 'analyzeStructuredChanges':
      return { changes: [], timestamp: Date.now() };

    case 'enableChangeBuffer':
      changeBufferEnabled = true;
      enableChangeTracking();
      return { enabled: true, timestamp: Date.now() };

    case 'disableChangeBuffer':
      changeBufferEnabled = false;
      return { enabled: false, timestamp: Date.now() };

    case 'drainChangeBuffer': {
      const drained = [...changeBuffer];
      changeBuffer.length = 0;
      return { changes: drained, count: drained.length, timestamp: Date.now() };
    }

    case 'getChangeBufferSize':
      return { size: changeBuffer.length, enabled: changeBufferEnabled, timestamp: Date.now() };

    // ======================================================================
    // Snapshot Bookmarks
    // ======================================================================

    case 'saveBookmark': {
      const { name } = payload as { name: string };
      const snapshot = { timestamp: Date.now(), elements: elements.map(elementToSnapshot) };
      bookmarks.set(name, { name, timestamp: Date.now(), snapshot });
      return { success: true, name, timestamp: Date.now() };
    }

    case 'getBookmark': {
      const bm = bookmarks.get(payload.name as string);
      if (!bm) return { success: false, error: `Bookmark '${payload.name}' not found` };
      return bm;
    }

    case 'deleteBookmark': {
      const deleted = bookmarks.delete(payload.name as string);
      return { success: deleted, name: payload.name, timestamp: Date.now() };
    }

    case 'listBookmarks':
      return { bookmarks: Array.from(bookmarks.values()).map(b => ({ name: b.name, timestamp: b.timestamp })), timestamp: Date.now() };

    case 'diffFromBookmark': {
      const bm = bookmarks.get(payload.name as string);
      if (!bm) return { success: false, error: `Bookmark '${payload.name}' not found` };
      const current = elements.map(elementToSnapshot);
      const prev = (bm.snapshot as { elements: unknown[] }).elements;
      return { bookmarkTimestamp: bm.timestamp, currentTimestamp: Date.now(), beforeCount: (prev as unknown[]).length, afterCount: current.length };
    }

    // ======================================================================
    // State Management (via registry)
    // ======================================================================

    case 'getStates':
      return bridge.registry?.getAllStates?.() ?? [];

    case 'getState':
      return bridge.registry?.getState?.(payload.id as string) ?? null;

    case 'getActiveStates':
      return bridge.registry?.getActiveStates?.() ?? [];

    case 'activateState': {
      if (!bridge.registry?.activateState) return { success: false, error: 'State management not available' };
      try { bridge.registry.activateState(payload.id as string); return { success: true, id: payload.id, timestamp: Date.now() }; }
      catch (err) { return { success: false, error: (err as Error).message, timestamp: Date.now() }; }
    }

    case 'deactivateState': {
      if (!bridge.registry?.deactivateState) return { success: false, error: 'State management not available' };
      try { bridge.registry.deactivateState(payload.id as string); return { success: true, id: payload.id, timestamp: Date.now() }; }
      catch (err) { return { success: false, error: (err as Error).message, timestamp: Date.now() }; }
    }

    case 'getStateGroups':
      return bridge.registry?.getAllStateGroups?.() ?? [];

    case 'activateStateGroup': {
      if (!bridge.registry?.activateStateGroup) return { success: false, error: 'State groups not available' };
      try { bridge.registry.activateStateGroup(payload.id as string); return { success: true, id: payload.id, timestamp: Date.now() }; }
      catch (err) { return { success: false, error: (err as Error).message, timestamp: Date.now() }; }
    }

    case 'deactivateStateGroup': {
      if (!bridge.registry?.deactivateStateGroup) return { success: false, error: 'State groups not available' };
      try { bridge.registry.deactivateStateGroup(payload.id as string); return { success: true, id: payload.id, timestamp: Date.now() }; }
      catch (err) { return { success: false, error: (err as Error).message, timestamp: Date.now() }; }
    }

    case 'getTransitions':
      return bridge.registry?.getAllTransitions?.() ?? [];

    case 'canExecuteTransition': {
      if (!bridge.registry?.canExecuteTransition) return { canExecute: false, error: 'Transitions not available' };
      try {
        const canExec = bridge.registry.canExecuteTransition(payload.id as string);
        return { canExecute: canExec, transitionId: payload.id, timestamp: Date.now() };
      } catch (err) { return { canExecute: false, error: (err as Error).message, timestamp: Date.now() }; }
    }

    case 'executeTransition': {
      if (!bridge.registry?.executeTransition) return { success: false, error: 'Transitions not available', timestamp: Date.now() };
      try { const result = await bridge.registry.executeTransition(payload.id as string); return { success: true, result, timestamp: Date.now() }; }
      catch (err) { return { success: false, error: (err as Error).message, timestamp: Date.now() }; }
    }

    case 'findPath': {
      if (!bridge.registry?.findPath) return { path: [], found: false, error: 'Pathfinding not available', timestamp: Date.now() };
      const { targetStates } = payload as { targetStates: string[] };
      try { return bridge.registry.findPath(targetStates); }
      catch (err) { return { path: [], found: false, error: (err as Error).message, timestamp: Date.now() }; }
    }

    case 'navigateTo': {
      if (!bridge.registry?.navigateTo) return { success: false, error: 'Navigation not available', timestamp: Date.now() };
      const { targetStates } = payload as { targetStates: string[] };
      try { return await bridge.registry.navigateTo(targetStates); }
      catch (err) { return { success: false, error: (err as Error).message, timestamp: Date.now() }; }
    }

    case 'getStateSnapshot':
      return bridge.registry?.getStateSnapshot?.() ?? {
        timestamp: Date.now(), activeStates: [], states: [], groups: [], transitions: [],
      };

    // ======================================================================
    // Intent System
    // ======================================================================

    case 'listIntents': {
      const intents = getIntentStore();
      return Array.from(intents.values());
    }

    case 'executeIntent':
    case 'executeIntentFromQuery':
      return { success: false, error: 'Intent execution not available without app-level intent registration', timestamp: Date.now() };

    case 'findIntent': {
      const intents = getIntentStore();
      const query = ((payload as { query?: string }).query ?? '').toLowerCase();
      const matches = Array.from(intents.values()).filter((i) => {
        const intent = i as { name?: string; description?: string };
        return (intent.name ?? '').toLowerCase().includes(query) || (intent.description ?? '').toLowerCase().includes(query);
      });
      return { results: matches, timestamp: Date.now() };
    }

    case 'registerIntent': {
      const intents = getIntentStore();
      const intent = payload as { id: string; [k: string]: unknown };
      intents.set(intent.id, intent);
      return { success: true, id: intent.id, timestamp: Date.now() };
    }

    // ======================================================================
    // Recovery
    // ======================================================================

    case 'attemptRecovery':
      return { success: false, error: 'Recovery not implemented for generic relay', suggestions: getRecoverySuggestions('UNKNOWN_ERROR'), timestamp: Date.now() };

    // ======================================================================
    // Cross-App Analysis
    // ======================================================================

    case 'analyzePageData': {
      const tables: unknown[] = [];
      document.querySelectorAll('table').forEach(t => {
        const headers = Array.from(t.querySelectorAll('th')).map(h => h.textContent?.trim());
        const rows = Array.from(t.querySelectorAll('tbody tr')).map(r => Array.from(r.querySelectorAll('td')).map(c => c.textContent?.trim()));
        tables.push({ headers, rowCount: rows.length, rows: rows.slice(0, 10) });
      });
      const forms = Array.from(document.querySelectorAll('form')).map(f => ({
        id: f.id, action: f.action, method: f.method,
        fields: Array.from(f.querySelectorAll('input, select, textarea')).map(i => ({
          name: (i as HTMLInputElement).name, type: (i as HTMLInputElement).type, value: (i as HTMLInputElement).value,
        })),
      }));
      return { url: window.location.href, title: document.title, tables, forms, timestamp: Date.now() };
    }

    case 'analyzePageRegions': {
      const regions: Array<{ role: string; tag: string; text: string }> = [];
      const landmarkRoles = ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form'];
      for (const role of landmarkRoles) {
        document.querySelectorAll(`[role="${role}"]`).forEach(el => {
          regions.push({ role, tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').slice(0, 100) });
        });
      }
      // Also check semantic HTML
      const semanticMap: Record<string, string> = { header: 'banner', nav: 'navigation', main: 'main', aside: 'complementary', footer: 'contentinfo' };
      for (const [tag, role] of Object.entries(semanticMap)) {
        document.querySelectorAll(tag).forEach(el => {
          if (!el.getAttribute('role')) regions.push({ role, tag, text: (el.textContent ?? '').slice(0, 100) });
        });
      }
      return { regions, timestamp: Date.now() };
    }

    case 'analyzeStructuredData': {
      const tables: unknown[] = [];
      document.querySelectorAll('table').forEach(t => {
        const headers = Array.from(t.querySelectorAll('th')).map(h => h.textContent?.trim());
        const rows = Array.from(t.querySelectorAll('tbody tr')).map(r => Array.from(r.querySelectorAll('td')).map(c => c.textContent?.trim()));
        tables.push({ headers, rowCount: rows.length, rows: rows.slice(0, 20) });
      });
      const lists = Array.from(document.querySelectorAll('ul, ol')).slice(0, 10).map(l => ({
        type: l.tagName.toLowerCase(), items: Array.from(l.querySelectorAll(':scope > li')).map(li => (li.textContent ?? '').slice(0, 100)),
      }));
      return { tables, lists, timestamp: Date.now() };
    }

    case 'crossAppCompare':
      return { comparison: 'Cross-app comparison requires snapshots from both apps', timestamp: Date.now() };

    // ======================================================================
    // Page Navigation
    // ======================================================================

    case 'pageRefresh':
      window.location.reload();
      return { success: true, timestamp: Date.now() };

    case 'pageNavigate': {
      const { url } = payload as { url: string };
      window.location.href = url;
      return { success: true, url, timestamp: Date.now() };
    }

    case 'pageGoBack':
      window.history.back();
      return { success: true, timestamp: Date.now() };

    case 'pageGoForward':
      window.history.forward();
      return { success: true, timestamp: Date.now() };

    // ======================================================================
    // Annotations
    // ======================================================================

    case 'getAnnotations': {
      const store = await getAnnotationStore();
      if (!store) return {};
      return (store as unknown as { getAll: () => unknown }).getAll();
    }

    case 'getAnnotation': {
      const store = await getAnnotationStore();
      if (!store) return null;
      return (store as unknown as { get: (id: string) => unknown }).get(payload.id as string);
    }

    case 'setAnnotation': {
      const store = await getAnnotationStore();
      if (!store) return { success: false, error: 'Annotation store not available' };
      (store as unknown as { set: (id: string, ann: unknown) => void }).set(payload.id as string, payload.annotation);
      return { success: true, id: payload.id, timestamp: Date.now() };
    }

    case 'deleteAnnotation': {
      const store = await getAnnotationStore();
      if (!store) return { success: false, error: 'Annotation store not available' };
      (store as unknown as { delete: (id: string) => void }).delete(payload.id as string);
      return { success: true, id: payload.id, timestamp: Date.now() };
    }

    case 'importAnnotations': {
      const store = await getAnnotationStore();
      if (!store) return { success: false, error: 'Annotation store not available' };
      (store as unknown as { importConfig: (config: unknown) => void }).importConfig(payload);
      return { success: true, timestamp: Date.now() };
    }

    case 'exportAnnotations': {
      const store = await getAnnotationStore();
      if (!store) return {};
      return (store as unknown as { exportConfig: () => unknown }).exportConfig();
    }

    case 'getAnnotationCoverage': {
      const store = await getAnnotationStore();
      if (!store) return { total: 0, annotated: 0, coverage: 0 };
      return (store as unknown as { getCoverage: () => unknown }).getCoverage();
    }

    // ======================================================================
    // Performance & Browser Events
    // ======================================================================

    case 'getPerformanceEntries': {
      const entries = performance.getEntriesByType('navigation')
        .concat(performance.getEntriesByType('resource').slice(-50))
        .concat(performance.getEntriesByType('measure'));
      return { entries: entries.map(e => ({ name: e.name, entryType: e.entryType, startTime: e.startTime, duration: e.duration })), timestamp: Date.now() };
    }

    case 'clearPerformanceEntries':
      performance.clearResourceTimings();
      performance.clearMeasures();
      performance.clearMarks();
      return { success: true, timestamp: Date.now() };

    case 'getBrowserEvents': {
      const { type, since, limit = 100 } = payload as { type?: string; since?: number; limit?: number };
      const cap = g.browserCapture;
      if (!cap) return { events: [], timestamp: Date.now() };
      let events: unknown[];
      if (type) events = cap.getByType(type);
      else if (since) events = cap.getSince(since);
      else events = cap.getRecent(limit);
      return { events: events.slice(0, limit), timestamp: Date.now() };
    }

    case 'getTimeline': {
      const { since, limit = 100 } = payload as { since?: number; limit?: number };
      const cap = g.browserCapture;
      if (!cap) return { events: [], timestamp: Date.now() };
      const events = since ? cap.getSince(since) : cap.getRecent(limit);
      return { events: events.slice(0, limit), timestamp: Date.now() };
    }

    case 'getHealthReport': {
      const cap = g.browserCapture;
      const errors = cap ? cap.getConsoleRecent(50) : [];
      const memTrend = cap?.getMemoryTrend?.() ?? null;
      const overlays = cap?.getFrameworkOverlays?.() ?? null;
      return {
        healthy: errors.length === 0,
        errorCount: errors.length,
        recentErrors: errors.slice(0, 10),
        memoryTrend: memTrend,
        frameworkOverlays: overlays,
        timestamp: Date.now(),
      };
    }

    // ======================================================================
    // Console Errors
    // ======================================================================

    case 'getConsoleErrors': {
      const { limit = 50, since } = payload as { limit?: number; since?: number };
      const cap = g.browserCapture;
      if (!cap) return { errors: [], timestamp: Date.now() };
      const errors = since ? cap.getConsoleSince(since) : cap.getConsoleRecent(limit);
      return { errors: errors.slice(0, limit), timestamp: Date.now() };
    }

    case 'clearConsoleErrors':
      g.browserCapture?.clear();
      return { success: true, timestamp: Date.now() };

    // ======================================================================
    // Network
    // ======================================================================

    case 'getNetworkRequests': {
      installNetworkInterceptor();
      const { status, method, urlPattern, failuresOnly, since, limit = 50 } = payload as {
        status?: number; method?: string; urlPattern?: string; failuresOnly?: boolean; since?: number; limit?: number;
      };
      let filtered = [...networkRequests];
      if (since) filtered = filtered.filter(r => r.startTime >= since);
      if (status) filtered = filtered.filter(r => r.status === status);
      if (method) filtered = filtered.filter(r => r.method.toLowerCase() === method.toLowerCase());
      if (urlPattern) { const re = new RegExp(urlPattern); filtered = filtered.filter(r => re.test(r.url)); }
      if (failuresOnly) filtered = filtered.filter(r => r.error || (r.status && r.status >= 400));
      return { requests: filtered.slice(-limit), total: filtered.length, timestamp: Date.now() };
    }

    case 'getNetworkRequestsInFlight': {
      installNetworkInterceptor();
      const inFlight = networkRequests.filter(r => r.inFlight);
      return { requests: inFlight, count: inFlight.length, timestamp: Date.now() };
    }

    case 'waitForNetworkRequest': {
      installNetworkInterceptor();
      const { url: urlMatch, method: methodMatch, timeout = 10000 } = payload as { url?: string; method?: string; timeout?: number };
      const waitStartTime = Date.now();
      return new Promise(resolve => {
        const check = () => {
          // Only match requests initiated after the wait started
          const match = networkRequests.find(r =>
            !r.inFlight &&
            r.startTime >= waitStartTime &&
            (!urlMatch || r.url.includes(urlMatch)) &&
            (!methodMatch || r.method.toLowerCase() === methodMatch.toLowerCase())
          );
          if (match) { resolve({ request: match, timestamp: Date.now() }); return true; }
          return false;
        };
        const interval = setInterval(() => { if (check()) clearInterval(interval); }, 200);
        setTimeout(() => { clearInterval(interval); resolve({ timedOut: true, timestamp: Date.now() }); }, timeout);
      });
    }

    case 'getNetworkRequest': {
      installNetworkInterceptor();
      const req = networkRequests.find(r => r.id === (payload.id as string));
      return req ?? { error: `Request ${payload.id} not found` };
    }

    case 'getNetworkChains': {
      const cap = g.browserCapture;
      if (!cap) return { chains: [], timestamp: Date.now() };
      const events = cap.getByType('network');
      return { chains: events.slice(-(payload.limit as number || 50)), timestamp: Date.now() };
    }

    // ======================================================================
    // Error Sessions
    // ======================================================================

    case 'startErrorSession': {
      const { label } = payload as { label?: string };
      currentErrorSession = { id: `session-${Date.now()}`, label, startTime: Date.now(), errors: [] };
      // Capture current errors as starting point
      const cap = g.browserCapture;
      if (cap) currentErrorSession.errors = [...cap.getConsoleRecent(100)] as unknown[];
      return { sessionId: currentErrorSession.id, startTime: currentErrorSession.startTime, timestamp: Date.now() };
    }

    case 'endErrorSession': {
      if (!currentErrorSession) return { success: false, error: 'No active error session' };
      currentErrorSession.endTime = Date.now();
      const cap = g.browserCapture;
      const currentErrors = cap ? cap.getConsoleSince(currentErrorSession.startTime) : [];
      const session = { ...currentErrorSession, newErrors: currentErrors, duration: currentErrorSession.endTime - currentErrorSession.startTime };
      errorSessions.push(session);
      currentErrorSession = null;
      return { session, timestamp: Date.now() };
    }

    case 'getErrorSessions':
      return { sessions: errorSessions, activeSession: currentErrorSession, timestamp: Date.now() };

    case 'captureErrorBaseline': {
      const { label } = payload as { label: string };
      const cap = g.browserCapture;
      const errors = cap ? cap.getConsoleRecent(200) : [];
      errorBaselines.set(label, { label, timestamp: Date.now(), errors: errors as unknown[] });
      return { success: true, label, errorCount: errors.length, timestamp: Date.now() };
    }

    case 'compareErrorBaseline': {
      const { label } = payload as { label: string };
      const baseline = errorBaselines.get(label);
      if (!baseline) return { success: false, error: `Baseline '${label}' not found` };
      const cap = g.browserCapture;
      const current = cap ? cap.getConsoleRecent(200) : [];
      return { baseline: { label, errorCount: baseline.errors.length, timestamp: baseline.timestamp }, current: { errorCount: current.length, timestamp: Date.now() }, newErrors: current.length - baseline.errors.length };
    }

    case 'getErrorSnapshots': {
      const { limit = 10 } = payload as { limit?: number };
      const cap = g.browserCapture;
      const errors = cap ? cap.getConsoleRecent(limit) : [];
      return { snapshots: errors, timestamp: Date.now() };
    }

    case 'getErrorReport': {
      const cap = g.browserCapture;
      const errors = cap ? cap.getConsoleRecent(50) : [];
      const overlays = cap?.getFrameworkOverlays?.() ?? null;
      return {
        healthy: errors.length === 0,
        recentErrors: errors.slice(0, 20),
        frameworkOverlays: overlays,
        activeSession: currentErrorSession ? { id: currentErrorSession.id, label: currentErrorSession.label, startTime: currentErrorSession.startTime } : null,
        sessionCount: errorSessions.length,
        timestamp: Date.now(),
      };
    }

    // ======================================================================
    // Design Review
    // ======================================================================

    case 'getElementStyles': {
      const el = getElement(payload.id as string);
      if (!el) return { error: `Element ${payload.id} not found` };
      const dom = el.element as HTMLElement;
      return { id: payload.id, styles: getComputedStylesSafe(dom), rect: dom.getBoundingClientRect(), timestamp: Date.now() };
    }

    case 'getElementStateStyles': {
      const { id, states = ['hover', 'focus', 'active'] } = payload as { id: string; states?: string[] };
      const el = getElement(id);
      if (!el) return { error: `Element ${id} not found` };
      const dom = el.element as HTMLElement;
      const base = getComputedStylesSafe(dom);
      return { id, baseStyles: base, stateStyles: states.reduce<Record<string, string>>((acc, s) => { acc[s] = 'Requires interaction'; return acc; }, {}), timestamp: Date.now() };
    }

    case 'getDesignSnapshot': {
      const { elementIds } = payload as { elementIds?: string[] };
      const targetEls = elementIds ? elements.filter(e => elementIds.includes(e.id)) : elements.slice(0, 50);
      const designs = targetEls.map(e => ({
        id: e.id, label: e.label, type: e.type,
        styles: getComputedStylesSafe(e.element as HTMLElement),
        rect: (e.element as HTMLElement).getBoundingClientRect(),
      }));
      return { elements: designs, timestamp: Date.now() };
    }

    case 'getResponsiveSnapshots':
      return { error: 'Responsive snapshots require server-side viewport manipulation', timestamp: Date.now() };

    case 'runDesignAudit': {
      const issues: Array<{ element: string; issue: string; severity: string }> = [];
      elements.slice(0, 100).forEach(e => {
        const dom = e.element as HTMLElement;
        const cs = getComputedStyle(dom);
        // Check contrast (simplified)
        if (cs.color === cs.backgroundColor && cs.color !== 'rgba(0, 0, 0, 0)') {
          issues.push({ element: e.id, issue: 'Text color matches background', severity: 'warning' });
        }
        // Check font size
        if (parseFloat(cs.fontSize) < 12) {
          issues.push({ element: e.id, issue: `Font size too small: ${cs.fontSize}`, severity: 'info' });
        }
        // Check interactive element size
        if (e.type === 'button' || e.type === 'link') {
          const rect = dom.getBoundingClientRect();
          if (rect.width < 44 || rect.height < 44) {
            issues.push({ element: e.id, issue: `Touch target too small: ${Math.round(rect.width)}x${Math.round(rect.height)}px (min 44x44)`, severity: 'warning' });
          }
        }
      });
      return { issues, checkedElements: Math.min(elements.length, 100), timestamp: Date.now() };
    }

    case 'loadStyleGuide':
      loadedStyleGuide = payload;
      return { success: true, timestamp: Date.now() };

    case 'getStyleGuide':
      return loadedStyleGuide ?? { loaded: false };

    case 'clearStyleGuide':
      loadedStyleGuide = null;
      return { success: true, timestamp: Date.now() };

    // ======================================================================
    // Quality Evaluation
    // ======================================================================

    case 'evaluateQuality': {
      const total = elements.length;
      const withLabels = elements.filter(e => e.label).length;
      const withActions = elements.filter(e => e.actions && e.actions.length > 0).length;
      const visibleCount = elements.filter(e => {
        const dom = e.element as HTMLElement;
        return dom.offsetParent !== null;
      }).length;
      return {
        score: total > 0 ? Math.round(((withLabels / total) * 50 + (withActions / total) * 30 + (visibleCount / total) * 20)) : 0,
        totalElements: total,
        labelCoverage: total > 0 ? Math.round((withLabels / total) * 100) : 0,
        actionCoverage: total > 0 ? Math.round((withActions / total) * 100) : 0,
        visibilityRate: total > 0 ? Math.round((visibleCount / total) * 100) : 0,
        timestamp: Date.now(),
      };
    }

    case 'getQualityContexts':
      return { contexts: ['elements', 'accessibility', 'design'], timestamp: Date.now() };

    case 'saveBaseline': {
      const snapshot = elements.map(e => ({ id: e.id, label: e.label, type: e.type, state: e.getState() }));
      bookmarks.set('__quality_baseline__', { name: '__quality_baseline__', timestamp: Date.now(), snapshot });
      return { success: true, elementCount: snapshot.length, timestamp: Date.now() };
    }

    case 'diffBaseline': {
      const baseline = bookmarks.get('__quality_baseline__');
      if (!baseline) return { success: false, error: 'No baseline saved' };
      return { baselineTimestamp: baseline.timestamp, currentElements: elements.length, baselineElements: ((baseline.snapshot as unknown[]) ?? []).length, timestamp: Date.now() };
    }

    // ======================================================================
    // Forms
    // ======================================================================

    case 'getForms': {
      const forms = Array.from(document.querySelectorAll('form')).map((f, i) => ({
        id: f.id || `form-${i}`,
        action: f.action,
        method: f.method,
        fields: Array.from(f.querySelectorAll('input, select, textarea')).map(inp => {
          const el = inp as HTMLInputElement;
          return { name: el.name, type: el.type, value: el.value, required: el.required, disabled: el.disabled, id: el.id };
        }),
      }));
      return { forms, timestamp: Date.now() };
    }

    case 'fillForm': {
      const { formId, fields } = payload as { formId?: string; fields: Record<string, string> };
      const form = formId ? document.getElementById(formId) as HTMLFormElement : document.querySelector('form');
      if (!form) return { success: false, error: 'Form not found' };
      const filled: string[] = [];
      for (const [name, value] of Object.entries(fields)) {
        const field = form.querySelector(`[name="${name}"]`) as HTMLInputElement;
        if (field) {
          const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(field, value); else field.value = value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push(name);
        }
      }
      return { success: true, filledFields: filled, totalFields: Object.keys(fields).length, timestamp: Date.now() };
    }

    case 'snapshotForms': {
      const forms = Array.from(document.querySelectorAll('form')).map((f, i) => ({
        id: f.id || `form-${i}`,
        fields: Array.from(f.querySelectorAll('input, select, textarea')).reduce<Record<string, unknown>>((acc, inp) => {
          const el = inp as HTMLInputElement;
          acc[el.name || el.id || `field-${i}`] = { value: el.value, checked: el.checked, type: el.type };
          return acc;
        }, {}),
      }));
      return { forms, timestamp: Date.now() };
    }

    case 'diffForms': {
      const { before, after } = payload as { before: { forms: Array<{ id: string; fields: Record<string, { value: string }> }> }; after: { forms: Array<{ id: string; fields: Record<string, { value: string }> }> } };
      const changes: Array<{ formId: string; field: string; before: unknown; after: unknown }> = [];
      if (before?.forms && after?.forms) {
        for (const bf of before.forms) {
          const af = after.forms.find(f => f.id === bf.id);
          if (!af) continue;
          for (const [name, bv] of Object.entries(bf.fields)) {
            const av = af.fields[name];
            if (av && bv.value !== av.value) changes.push({ formId: bf.id, field: name, before: bv.value, after: av.value });
          }
        }
      }
      return { changes, timestamp: Date.now() };
    }

    // ======================================================================
    // Clipboard
    // ======================================================================

    case 'getClipboard':
      try {
        const text = await navigator.clipboard.readText();
        return { text, timestamp: Date.now() };
      } catch {
        return { error: 'Clipboard access denied', timestamp: Date.now() };
      }

    case 'setClipboard': {
      const { text, html } = payload as { text: string; html?: string };
      try {
        if (html && navigator.clipboard.write) {
          const blob = new Blob([html], { type: 'text/html' });
          const textBlob = new Blob([text], { type: 'text/plain' });
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })]);
        } else {
          await navigator.clipboard.writeText(text);
        }
        return { success: true, timestamp: Date.now() };
      } catch {
        return { success: false, error: 'Clipboard write denied', timestamp: Date.now() };
      }
    }

    // ======================================================================
    // Idle Detection
    // ======================================================================

    case 'getIdleStatus': {
      const detector = await getIdleDetector();
      if (!detector) return { idle: true, signals: {}, timestamp: Date.now() };
      return detector.getStatus();
    }

    case 'getIdleSignalStatus': {
      const detector = await getIdleDetector();
      if (!detector) return { idle: true, timestamp: Date.now() };
      return detector.getSignalStatus(payload.signal as string);
    }

    case 'waitForIdle': {
      const detector = await getIdleDetector();
      if (!detector) return { idle: true, timestamp: Date.now() };
      return detector.waitForIdle(payload);
    }

    case 'waitForSignalIdle': {
      const detector = await getIdleDetector();
      if (!detector) return { idle: true, timestamp: Date.now() };
      const { signal, ...opts } = payload;
      if (detector.waitForSignal) return detector.waitForSignal(signal as string, opts);
      return { idle: true, timestamp: Date.now() };
    }

    case 'waitForTargets': {
      const detector = await getIdleDetector();
      if (!detector) return { idle: true, timestamp: Date.now() };
      const { targets, ...opts } = payload as { targets: unknown[]; [k: string]: unknown };
      if (detector.waitFor) return detector.waitFor(targets as never[], opts);
      return { idle: true, timestamp: Date.now() };
    }

    // ======================================================================
    // Undo/Redo
    // ======================================================================

    case 'getUndoState':
      return g.undoTracker?.getState() ?? { canUndo: false, canRedo: false, undoStack: [], redoStack: [] };

    case 'executeUndo': {
      // Try keyboard shortcut as undo trigger
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      return { success: true, method: 'keyboard', timestamp: Date.now() };
    }

    case 'executeRedo': {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
      return { success: true, method: 'keyboard', timestamp: Date.now() };
    }

    // ======================================================================
    // Fallback
    // ======================================================================

    default:
      throw new Error(`Unknown command action: ${action}`);
  }
}
