/**
 * Command Handlers for the browser-side Command Relay
 *
 * Maps every relay command action to a browser-side implementation.
 * Commands access the UIBridgeRegistry, trackers on window.__UI_BRIDGE__,
 * and DOM APIs to fulfill server-side relay requests.
 */

import type {
  RegisteredElement,
  ElementAssertionSpec,
  ElementAssertionFailure,
  ElementAssertionResult,
} from '../core/types';
import {
  captureDocumentVisibility,
  getGlobalRegistry,
  serializeRegisteredElement,
  serializeRegisteredComponent,
} from '../core/registry';
import { applyCanonicalFindFilter, type CanonicalFindCriteria } from '../core/find-filter';
import { truncateCodePoints } from '../core/text';
import { parseNLAssertion } from '../ai/nl-assertion-parser';
import { getGlobalStubRegistry, validateStubRequest, type StubRequestSpec } from '../network/stubs';
import { getGlobalBookmarkStore } from '../ai/bookmarks';
import type { SemanticSnapshot } from '../ai/types';
import { computeFingerprint, extractSourceLocation } from '../debug/error-fingerprint';
import {
  hasNestedQuantifiers,
  findHoverableAncestor,
  dispatchHoverEnter,
  nextAnimationFrame,
  DefaultActionExecutor,
} from '../control/action-executor';
import type { ComponentActionRequest } from '../control/types';
import { applyValueMutation } from '../control/value-mutation';
import { getEventStack } from '../debug/shared-utils';
import { createStableRef, resolveStableRef } from '../core/stable-ref';
import type { StableElementRef } from '../core/stable-ref';
import type { AnyCapturedEvent } from '../debug/browser-capture-types';
import { buildComponentNotFoundError } from '../server/component-not-found';
import {
  readValuePrimitive,
  findByTextPrimitive,
  clickByTextPrimitive,
  clickBySelectorPrimitive,
  typeIntoPrimitive,
  sendKeysToPagePrimitive,
} from '../server/page-primitives';
import {
  isContentRedacted,
  verdictOf,
  scrubContent,
  scrubContentRequired,
  trustDeveloperContent,
  readScrubbedValue,
  readScrubbedText,
  REDACTED_VALUE,
} from '../core/redaction';
import { readAriaLabelAttr, readTitleAttr, computeVisibleText } from '../core/a11y';
import { readLiveValue, readLiveText } from '../control/value-mutation';
import {
  pollWaitForElement,
  snapshotFromRegisteredElement,
  WAIT_FOR_ELEMENT_STATES,
  type WaitForElementState,
  type ElementSnapshot,
} from '../ai/wait-for-element';

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
  components: Array<{
    id: string;
    name: string;
    description?: string;
    actions?: Array<{ id: string; name: string; description?: string }>;
    elementIds?: string[];
    getState?: () => unknown;
  }>;
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
  /** Optional client-side navigation handler (e.g., Next.js router.push) */
  navigateHandler?: (url: string) => void;
  /** Render log access for getRenderLog relay command */
  renderLog?: { getEntries?: () => unknown[] };
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
interface ModalDetector {
  detect: () => unknown;
}
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
        {
          suggestion: 'Wait for the page to fully load',
          command: 'wait for page to load',
          confidence: 0.7,
          retryable: true,
        },
        {
          suggestion: 'Use a different description for the element',
          confidence: 0.8,
          retryable: false,
        },
      ];
    case 'ELEMENT_NOT_VISIBLE':
      return [
        {
          suggestion: 'Scroll to make the element visible',
          command: 'scroll to element',
          confidence: 0.9,
          retryable: true,
        },
        {
          suggestion: 'Close any blocking modals or popups',
          command: 'click close button',
          confidence: 0.8,
          retryable: true,
        },
      ];
    case 'ELEMENT_NOT_ENABLED':
      return [
        { suggestion: 'Fill in required fields first', confidence: 0.8, retryable: false },
        { suggestion: 'Wait for the element to become enabled', confidence: 0.6, retryable: true },
      ];
    default:
      return [
        {
          suggestion: 'Try a different approach or check the page state',
          confidence: 0.5,
          retryable: false,
        },
      ];
  }
}

function createActionFailure(
  id: string,
  errorCode: string,
  message: string,
  startTime: number,
  elementState?: unknown
) {
  return {
    success: false,
    error: message,
    failureDetails: {
      errorCode,
      message,
      elementId: id,
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

/**
 * Fallback resolution chain for stale element IDs.
 *
 * When an action targets an element ID that no longer exists in the registry
 * (e.g., after a React re-render replaced the DOM node), this chain tries
 * progressively less precise strategies to find the replacement element:
 *
 *   1. data-ui-bridge-id DOM attribute match
 *   2. Fingerprint match via resolveStableRef (checks current registry + semantic path)
 *   3. If a match is found, transparently returns the new RegisteredElement
 *   4. If not, returns undefined (caller should return the existing "element not found" error)
 */
function resolveElementWithFallback(id: string): RegisteredElement | undefined {
  const registry = getGlobalRegistry();

  // Strategy 1: Direct registry lookup (already tried by caller, but cheap)
  const direct = registry.getElement(id);
  if (direct) return direct;

  // Strategy 2: data-ui-bridge-id DOM attribute match
  if (typeof document !== 'undefined') {
    try {
      const byAttr = document.querySelector(
        `[data-ui-bridge-id="${CSS.escape(id)}"]`
      ) as HTMLElement | null;
      if (byAttr) {
        const registered = registry.findByDOMElement(byAttr);
        if (registered && registered.mounted) return registered;
      }
    } catch {
      // Invalid selector — skip
    }
  }

  // Strategy 3: Fingerprint match via resolveStableRef
  // Build a minimal StableElementRef from just the ID and attempt resolution
  // through the full resolution chain (fingerprint + semantic path)
  const syntheticRef: StableElementRef = {
    id,
    idStrategy: 'prefer-existing',
    primaryId: id,
    fingerprint: '', // unknown — resolveStableRef will skip fingerprint match with empty hash
    semanticPath: '',
    lastSeenAt: 0,
  };
  const resolved = resolveStableRef(syntheticRef);
  if (resolved) return resolved.element;

  return undefined;
}

function elementToSnapshot(e: RegisteredElement) {
  const state = e.getState();
  return { id: e.id, type: e.type, label: e.label, actions: e.actions, state };
}

/**
 * The ONE `DefaultActionExecutor` behind the Tauri IPC channel.
 *
 * Plan `2026-08-20-ui-bridge-action-declaration-shape`. The two
 * component-action commands below used to resolve the action off the registry
 * and call `action.handler(params)` **directly**, bypassing the executor
 * entirely — so on this channel there was no `paramSchema` validation, no
 * `runAbortable` race, no `signal` and no `timeoutMs`. That made it a FOURTH
 * invocation seam the plan's census missed, and it is not a marginal one: the
 * Tauri IPC channel is half of UI Bridge's dual-channel design and the half a
 * Tauri app actually uses.
 *
 * Routing through the executor rather than re-implementing the three guards
 * inline is the point — a fourth inline copy is how the first three drifted.
 *
 * Memoized per registry instance (a `WeakMap`, so a discarded registry in a
 * test does not pin an executor). `DefaultActionExecutor`'s constructor is
 * cheap; it builds an `ErrorImpactAssessor` only when a `document` exists.
 */
const IPC_EXECUTORS = new WeakMap<object, DefaultActionExecutor>();

function ipcActionExecutor(registry: ReturnType<typeof getGlobalRegistry>): DefaultActionExecutor {
  const existing = IPC_EXECUTORS.get(registry);
  if (existing) return existing;
  const created = new DefaultActionExecutor(registry);
  IPC_EXECUTORS.set(registry, created);
  return created;
}

/**
 * Invoke a component action through {@link ipcActionExecutor} and reshape the
 * response into this channel's `{ success, result?, error?, timestamp }`
 * envelope.
 *
 * The extra fields the executor produces (`failureDetails`, `durationMs`) are
 * passed through additively — `JSON.stringify` drops the undefined ones, so an
 * ordinary success is byte-identical to what this seam emitted before.
 */
async function runComponentActionViaExecutor(
  registry: ReturnType<typeof getGlobalRegistry>,
  componentId: string,
  request: ComponentActionRequest
): Promise<Record<string, unknown>> {
  const response = await ipcActionExecutor(registry).executeComponentAction(componentId, request);
  return {
    success: response.success,
    result: response.result,
    error: response.error,
    failureDetails: response.failureDetails,
    durationMs: response.durationMs,
    timestamp: response.timestamp,
  };
}

/**
 * Phase 1.1 (plan 2026-05-03) — enriched component-not-found message for
 * the four in-process call sites. Uses the global registry to source
 * available components, route, and Phase-1.2 byRoute metadata, then
 * defers to `buildComponentNotFoundError` so every site emits the same
 * shape (with cross-route hint when applicable).
 */
function inProcessComponentNotFoundMessage(id: string): string {
  let available: string[] = [];
  let byRoute:
    | Record<string, { count: number; ids: string[] }>
    | undefined;
  let currentRoute: string | undefined;
  try {
    const reg = getGlobalRegistry();
    available = reg.getAllComponents().map((c) => c.id);
    try {
      byRoute = reg.getCountsByRoute();
    } catch {
      byRoute = undefined;
    }
  } catch {
    // Registry probe failed — fall through with empties.
  }
  if (typeof window !== 'undefined' && window.location?.pathname) {
    currentRoute = window.location.pathname;
  }
  return buildComponentNotFoundError(id, available, byRoute, currentRoute);
}

function elementToFindResult(e: RegisteredElement) {
  const state = e.getState();
  return {
    id: e.id,
    type: e.type,
    label: e.label,
    tagName: e.element.tagName.toLowerCase(),
    role: e.element.getAttribute('role') ?? undefined,
    // §4.6: accessibleName reaches the client — scrub the scraped aria-label
    // (and the label fallback) against the element's boundary.
    accessibleName: scrubContent(readAriaLabelAttr(e.element) ?? e.label, e.element),
    actions: e.actions,
    state,
    registered: true,
    stableRef: createStableRef(e),
  };
}

function getComputedStylesSafe(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const keys = [
    'color',
    'backgroundColor',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'padding',
    'margin',
    'border',
    'borderRadius',
    'display',
    'position',
    'width',
    'height',
    'opacity',
    'overflow',
    'textAlign',
    'lineHeight',
    'boxShadow',
    'cursor',
    'zIndex',
    'colorScheme',
    'appearance',
  ];
  const styles: Record<string, string> = {};
  for (const k of keys)
    styles[k] =
      cs.getPropertyValue(k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)) ||
      (cs as unknown as Record<string, string>)[k] ||
      '';
  return styles;
}

/**
 * Contrast ratio below this means foreground and background are nearly identical,
 * making text effectively invisible (WCAG contrast ratio scale starts at 1:1).
 */
const NEARLY_INVISIBLE_CONTRAST_THRESHOLD = 1.15;

/**
 * Linearize a single sRGB channel value (0–1) per WCAG 2.1 spec.
 */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Parse an rgb/rgba or hex color string and return WCAG 2.1 relative luminance (0–1).
 * Supports: rgb(r,g,b), rgba(r,g,b,a), #rgb, #rgba, #rrggbb, #rrggbbaa.
 * Returns -1 if unparseable.
 */
function parseLuminance(color: string): number {
  let r: number, g: number, b: number;

  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    r = parseInt(rgbMatch[1]) / 255;
    g = parseInt(rgbMatch[2]) / 255;
    b = parseInt(rgbMatch[3]) / 255;
  } else {
    const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/);
    if (!hexMatch) return -1;
    const hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      // #rgb or #rgba — expand each digit
      r = parseInt(hex[0] + hex[0], 16) / 255;
      g = parseInt(hex[1] + hex[1], 16) / 255;
      b = parseInt(hex[2] + hex[2], 16) / 255;
    } else if (hex.length === 6 || hex.length === 8) {
      // #rrggbb or #rrggbbaa
      r = parseInt(hex.slice(0, 2), 16) / 255;
      g = parseInt(hex.slice(2, 4), 16) / 255;
      b = parseInt(hex.slice(4, 6), 16) / 255;
    } else {
      return -1;
    }
  }

  // WCAG 2.1 relative luminance
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function isLikelyDarkColor(color: string): boolean {
  const l = parseLuminance(color);
  return l >= 0 && l < 0.4;
}

function isLikelyLightColor(color: string): boolean {
  const l = parseLuminance(color);
  return l >= 0 && l > 0.6;
}

// Idle detector singleton (lazy-initialized)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let idleDetector: any = null;

async function getIdleDetector() {
  if (idleDetector) return idleDetector;
  try {
    const { CompositeIdleDetector } = await import('../idle');
    const detector = CompositeIdleDetector.create();
    idleDetector = detector;
    return detector;
  } catch {
    return null;
  }
}

/**
 * Wait briefly for the DOM idle signal so the registry settles before a
 * read. Mirrors the standalone server's `awaitDOMSettled` so the relay
 * path's aiFind/aiExecute/aiAssert see the same element set as
 * `/control/snapshot` (which already settles inside `getControlSnapshot`).
 * Without this, navigation-triggered re-renders register elements
 * lazily and the relay's `registry.getAllElements()` snapshot can be
 * strictly smaller than what the snapshot endpoint returned moments
 * earlier — the long-standing 193-vs-118 divergence symptom.
 */
async function awaitDOMSettledRelay(timeout = 500): Promise<void> {
  const detector = await getIdleDetector();
  if (!detector) return;
  const domSignal = detector.getSignal?.('dom');
  if (!domSignal || domSignal.isIdle?.()) return;
  try {
    await domSignal.waitForIdle({ timeout, minStableMs: 0 });
  } catch {
    /* timeout — return whatever is registered now */
  }
}

/**
 * Dispatch a realistic pointer + mouse + click sequence on an element so
 * pointer-event-driven libraries (Radix UI Tabs/menus/dialogs, Reach,
 * Headless UI, etc.) respond. A bare `element.click()` fires only the
 * synthetic `click` MouseEvent — Radix triggers listen on `pointerdown`
 * (and never see `click` for their open/select logic), so the relay would
 * return success while nothing happened and the transition's `waitAfter`
 * would time out.
 *
 * Sequence (mirrors a real user tap/click):
 *   focus → pointerdown → mousedown → pointerup → mouseup → click
 *
 * Each event is `{ bubbles, cancelable, composed }` with primary-pointer /
 * left-button coordinates so capturing listeners on ancestors (Radix uses
 * capture-phase + bubbling) and `composed` shadow-DOM boundaries both see
 * it. A native `.click()` runs ONLY when the synthetic sequence could not
 * be dispatched (environments without event constructors): exactly one
 * `click` event ever reaches the element per relay click, never two.
 */
function dispatchRealClick(el: HTMLElement): void {
  try {
    (el as HTMLElement).focus?.();
  } catch {
    /* focus can throw on detached / non-focusable nodes — ignore */
  }

  const rect = (() => {
    try {
      return el.getBoundingClientRect();
    } catch {
      return { left: 0, top: 0, width: 0, height: 0 } as DOMRect;
    }
  })();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const pointerInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 1,
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerType: 'mouse',
    clientX,
    clientY,
  };
  const mouseInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX,
    clientY,
  };

  // PointerEvent may be undefined in older jsdom — fall back to MouseEvent
  // so the pointerdown/pointerup still bubble (Radix accepts either as long
  // as the event type matches).
  const makePointer = (type: string): Event => {
    try {
      if (typeof PointerEvent === 'function') {
        return new PointerEvent(type, pointerInit);
      }
    } catch {
      /* fall through to MouseEvent */
    }
    return new MouseEvent(type, mouseInit);
  };
  const makeMouse = (type: string): Event => new MouseEvent(type, mouseInit);

  let sequenceDispatched = false;
  try {
    el.dispatchEvent(makePointer('pointerdown'));
    el.dispatchEvent(makeMouse('mousedown'));
    el.dispatchEvent(makePointer('pointerup'));
    el.dispatchEvent(makeMouse('mouseup'));
    el.dispatchEvent(makeMouse('click'));
    sequenceDispatched = true;
  } catch {
    /* event construction unsupported — fall back to native click below */
  }

  // Native-click FALLBACK — only when the synthetic sequence could not be
  // dispatched. Running it unconditionally delivered a SECOND `click` event
  // on every relay click (the synthetic one above + this native one), which
  // double-fired React onClick handlers: non-idempotent submits POSTed twice
  // (duplicate coord policy rows ~8ms apart) and checkbox/switch controls
  // double-toggled back to their original state, reading as "the click did
  // nothing". A dispatched untrusted `click` runs standard activation
  // behavior (form submit, checkbox toggle, label forwarding), so the plain
  // controls the fallback was guarding keep working without it.
  if (!sequenceDispatched) {
    try {
      el.click();
    } catch {
      /* native click unavailable — nothing more we can do */
    }
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
  /** F2: present when the request was served from the stub registry. */
  stubId?: string;
}

const networkRequests: TrackedRequest[] = [];
let networkIntercepted = false;
const MAX_TRACKED_REQUESTS = 500;

/**
 * Install the fetch interceptor used for both request tracking and the F2
 * stub registry. Idempotent — safe to call on every relay command.
 *
 * The interceptor checks the global stub registry BEFORE calling the real
 * fetch. Matched stubs produce a synthetic `Response` and are recorded in
 * `networkRequests` with `stubId` set so callers can audit. Unmatched
 * requests pass through to the real network.
 */
function installNetworkInterceptor() {
  if (networkIntercepted) return;
  networkIntercepted = true;

  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    // Extract URL + method WITHOUT constructing a `new Request(...)` because
    // jsdom (and some older runtimes) reject relative URLs there even though
    // real browsers accept them via fetch. Mirror what `network/tracker.ts`
    // does.
    const [input, init] = args;
    let reqUrl: string;
    if (typeof input === 'string') reqUrl = input;
    else if (input instanceof URL) reqUrl = input.href;
    else if (typeof Request !== 'undefined' && input instanceof Request) reqUrl = input.url;
    else reqUrl = String(input);
    let reqMethod = 'GET';
    if (init?.method) reqMethod = init.method.toUpperCase();
    else if (typeof Request !== 'undefined' && input instanceof Request)
      reqMethod = input.method.toUpperCase();

    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tracked: TrackedRequest = {
      id,
      url: reqUrl,
      method: reqMethod,
      startTime: Date.now(),
      inFlight: true,
    };
    networkRequests.push(tracked);
    if (networkRequests.length > MAX_TRACKED_REQUESTS) networkRequests.shift();

    // F2: check the stub registry first. A hit short-circuits the network.
    const stubMatch = getGlobalStubRegistry().match(reqUrl, reqMethod);
    if (stubMatch) {
      try {
        const response = stubMatch.buildResponse();
        tracked.status = response.status;
        tracked.statusText = response.statusText;
        tracked.endTime = Date.now();
        tracked.duration = tracked.endTime - tracked.startTime;
        tracked.inFlight = false;
        tracked.stubId = stubMatch.id;
        return response;
      } catch (err) {
        tracked.error = (err as Error).message;
        tracked.endTime = Date.now();
        tracked.duration = tracked.endTime - tracked.startTime;
        tracked.inFlight = false;
        tracked.stubId = stubMatch.id;
        throw err;
      }
    }

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
interface ChangeEntry {
  timestamp: number;
  type: string;
  detail: unknown;
}
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
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
}

// Internal quality-baseline store. Distinct from the user-visible bookmark
// registry: `saveBaseline` / `diffBaseline` (below) own their own shape
// (raw element-state arrays, not full `SemanticSnapshot`s) and never need
// to interop with `/ai/bookmarks`. Keeping a private Map here avoids
// pollution of the singleton's typed snapshot contract.
const qualityBaselines = new Map<string, { timestamp: number; snapshot: unknown }>();

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

/**
 * React-aware value fill for the app-agnostic `typeInto` relay command.
 *
 * The standalone-server `typeInto` (server/handlers.ts) sets `el.value += text`
 * raw, which does NOT update React's internal `_valueTracker`, so controlled
 * inputs silently revert on the next render. The element-registry `type`
 * action (in `executeElementAction`) already does this correctly; this helper
 * factors out that React-fidelity logic so the relay `typeInto` case behaves
 * identically to the registry path (native setter + tracker reset + input/
 * change dispatch + direct `__reactProps$.onChange` invocation for embedded
 * WebViews). Falls back to `textContent` / `execCommand` for contenteditable.
 */
function reactAwareFill(el: HTMLElement, text: string, clear: boolean): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    const domEl = el as unknown as Record<string, unknown>;
    const rPropsKey = Object.keys(domEl).find((k) => k.startsWith('__reactProps$'));
    const rProps = rPropsKey
      ? (domEl[rPropsKey] as Record<string, unknown> | undefined)
      : undefined;

    const notifyReact = (oldValue: string) => {
      const tracker = (el as unknown as { _valueTracker?: { setValue(v: string): void } })
        ._valueTracker;
      if (tracker) tracker.setValue(oldValue);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (rProps?.onChange && typeof rProps.onChange === 'function') {
        (rProps.onChange as (e: unknown) => void)({
          target: el,
          currentTarget: el,
          type: 'change',
          bubbles: true,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new Event('input'),
        });
      }
    };

    if (clear) {
      const prevClear = readLiveValue(el);
      if (setter) setter.call(el, '');
      else el.value = '';
      notifyReact(prevClear);
    }
    el.focus();
    const cur = readLiveValue(el);
    if (setter) setter.call(el, cur + text);
    else el.value = cur + text;
    notifyReact(cur);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  // contenteditable / non-input fallback
  el.focus();
  if (clear) el.textContent = '';
  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
  } else {
    el.textContent = readLiveText(el) + text;
  }
}

// ============================================================================
// Main Command Executor
// ============================================================================

// Actions whose result depends on the registry being settled — they read
// `elements` and dispatch matchers that fail silently when registrations
// are still in flight. We DOM-settle once up front for these so the
// `registry.getAllElements()` read below sees the same element set the
// snapshot endpoint would see.
const SETTLE_BEFORE_READ_ACTIONS: ReadonlySet<string> = new Set([
  'aiFind',
  'aiSearch',
  'aiExecute',
  'aiAssert',
  'aiAssertBatch',
  'executeElementAction',
]);

export async function executeCommand(
  action: string,
  payload: P,
  bridge: BridgeAccess
): Promise<unknown> {
  const g = getBridge();

  // For AI actions, wait for the DOM to settle BEFORE reading the registry
  // so we observe the same element set `/control/snapshot` would (which
  // settles inside `getControlSnapshot`). Without this the relay path's
  // `getAllElements()` can run mid-route-change and miss elements still
  // being registered — the 193-vs-118 divergence the previous ai/find
  // commit only partially closed.
  if (SETTLE_BEFORE_READ_ACTIONS.has(action)) {
    const settleTimeout =
      typeof (payload as { settleTimeout?: unknown })?.settleTimeout === 'number'
        ? ((payload as { settleTimeout?: number }).settleTimeout as number)
        : undefined;
    const skipSettle = (payload as { skipSettle?: unknown })?.skipSettle === true;
    if (!skipSettle) {
      await awaitDOMSettledRelay(settleTimeout);
    }
  }

  // Read elements, components, and workflows from the live global registry
  // instead of the stale memoized bridge arrays. The bridge collections are
  // captured via useMemo in useUIBridge and never update when
  // AutoRegisterProvider registers elements, because registry mutations
  // don't trigger React re-renders.
  const registry = getGlobalRegistry();
  const elements = registry.getAllElements();
  const components = registry.getAllComponents();
  const workflows = registry.getAllWorkflows();
  /** Resolve an element by ID, falling back through the stable-ref resolution chain. */
  const getElement = (id: string) => registry.getElement(id) ?? resolveElementWithFallback(id);

  switch (action) {
    // ======================================================================
    // Control — Snapshot & Elements
    // ======================================================================

    case 'getControlSnapshot': {
      // F3: include registration metadata + route so callers can distinguish
      // "no elements on this page" from "this app has no bridge coverage".
      // Computed from public registry APIs; degrades gracefully if the global
      // registry is unavailable for any reason.
      let route: string | undefined;
      let registration: {
        totalRegistered: number;
        everHadRegistrations: boolean;
        byRoute: Record<string, { count: number; ids: string[] }>;
      } = {
        totalRegistered: elements.length,
        everHadRegistrations: false,
        byRoute: {},
      };
      try {
        const reg = getGlobalRegistry();
        registration = {
          totalRegistered: elements.length,
          everHadRegistrations: reg.hasEverHadRegistrations(),
          byRoute: reg.getCountsByRoute(),
        };
      } catch {
        // Fall back to the conservative default above.
      }
      if (typeof window !== 'undefined' && window.location?.pathname) {
        route = window.location.pathname;
      }
      // Document visibility at snapshot time. Components that gate work on
      // `document.hidden` (WS subscriptions, polling loops, idle observers)
      // silently no-op when `hidden=true`; surfacing this in the snapshot
      // lets headless tests detect the gating without an extra evaluate
      // round-trip.
      const visibility = captureDocumentVisibility();
      // Phase 6: relay callers can pin the component-action base path so the
      // serialized `componentActionBasePath` matches the host's mount prefix
      // (e.g. the runner's `/ui-bridge/control/component`). Defaults to the
      // standalone-server prefix when omitted, matching `createSnapshot`'s
      // contract.
      const rawComponentBasePath = (payload as { componentBasePath?: unknown }).componentBasePath;
      const componentBasePath =
        typeof rawComponentBasePath === 'string' && rawComponentBasePath.length > 0
          ? rawComponentBasePath
          : undefined;
      const now = Date.now();
      // Delegate per-element serialization to the canonical
      // `serializeRegisteredElement` so the relay snapshot matches what
      // `registry.createSnapshot()` emits server-side: tagName, identifier,
      // category/kind, role/content/contentMetadata/mediaMetadata,
      // ownedByComponent, componentActionBasePath, bbox, visible, origin,
      // variant/position/color/contextPath, stableRef, route, and
      // customActions all come along automatically when the underlying
      // RegisteredElement carries them. Prior code emitted the much sparser
      // `{id,type,label,actions,state}` shape and dropped every other field.
      const serializeOpts = componentBasePath !== undefined ? { componentBasePath } : {};
      const result: Record<string, unknown> = {
        timestamp: now,
        snapshotTakenAtMs: now,
        ...(route !== undefined ? { route } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
        registration,
        elements: elements.map((el) => serializeRegisteredElement(el, serializeOpts)),
        // Delegate to the canonical `serializeRegisteredComponent` so the
        // relay emits the same shape as `createSnapshot()` — canonical
        // `ComponentActionInfo` action objects (the previous inline map
        // leaked raw `ComponentAction` objects including `handler`),
        // `registeredAt`/`mounted`, and a `componentBasePath`-aware
        // `actionInvocationPath`. The relay-only `state` extra is preserved.
        components: components.map((c) => ({
          ...serializeRegisteredComponent(c, serializeOpts),
          state: c.getState?.() ?? {},
        })),
        // Relay handler keeps the legacy `steps` array (not `stepCount`)
        // alongside `activeRuns: []` because existing relay-driven callers
        // (runner Tauri IPC, command-relay HTTP wrappers) read these fields
        // directly. `createSnapshot()` returns the leaner shape; the relay's
        // workflow shape intentionally stays richer here.
        workflows: workflows.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          steps: w.steps,
        })),
        activeRuns: [],
      };

      // Run the registry's snapshot enrichers (canonical seven + any
      // pluggable extras) so the relay snapshot picks up the same enriched
      // fields as `registry.createSnapshot()`. Without this, fields like
      // `page`, `modalStack`, `toasts`, `relationships`, `dragDrop`,
      // `undoRedo`, `shortcuts` would never reach WS clients — exactly the
      // drift class memory note `proj_issue_snapshot_two_channel_drift.md`
      // is about. The relay shape isn't a `BridgeSnapshot` (workflows have
      // `steps`, components have `state`/`elementIds`), but the enricher
      // helper only mutates known canonical fields plus whatever custom
      // enrichers `Object.assign`, so the cast is safe.
      try {
        const reg = getGlobalRegistry();
        reg.runSnapshotEnrichers(result as unknown as import('../core/types').BridgeSnapshot);
      } catch {
        // Defensive: if the global registry is unavailable for any reason,
        // fall through with the un-enriched relay shape rather than failing
        // the whole snapshot.
      }

      return result;
    }

    case 'getElementState': {
      const el = getElement(payload.id as string);
      if (!el) throw new Error(`Element ${payload.id} not found`);
      const state = el.getState();
      // Spread the full canonical `ElementState` so callers see every field
      // the SDK populates (role, accessibleName, normalizedRect,
      // selectedOptions, availableOptions, textContent, innerHTML, href,
      // dataset, opacityHidden, ariaCurrent, required, validationState,
      // constraints, mediaMetadata, scrollInfo, …). Legacy aliases
      // `isVisible`/`isEnabled`/`text` are preserved for back-compat with
      // existing relay callers that read those names. New code should prefer
      // `visible`/`enabled`/`textContent` from the spread state.
      return {
        id: el.id,
        ...state,
        isVisible: state.visible,
        isEnabled: state.enabled,
        text: state.textContent,
      };
    }

    case 'executeElementAction': {
      const startTime = performance.now();
      const { id, request } = payload as {
        id: string;
        request: { action: string; value?: string; params?: P; text?: string; clear?: boolean };
      };

      // Page-level sentinel IDs ("document", "body", "window") resolve to
      // document.documentElement for scroll actions, bypassing the element registry.
      const isPageScrollSentinel =
        request.action === 'scroll' && (id === 'document' || id === 'body' || id === 'window');

      let dom: HTMLElement;
      if (isPageScrollSentinel) {
        dom = document.documentElement;
      } else {
        const el = getElement(id);
        if (!el)
          return createActionFailure(id, 'ELEMENT_NOT_FOUND', `Element ${id} not found`, startTime);
        const domEl = (el.element ?? null) as HTMLElement | null;
        if (!domEl)
          return createActionFailure(
            id,
            'ELEMENT_NOT_FOUND',
            `DOM element for ${id} not found`,
            startTime,
            el
          );
        const isVis =
          domEl.offsetParent !== null &&
          getComputedStyle(domEl).visibility !== 'hidden' &&
          getComputedStyle(domEl).display !== 'none';
        if (!isVis)
          return createActionFailure(
            id,
            'ELEMENT_NOT_VISIBLE',
            `Element ${id} exists but is not visible`,
            startTime
          );
        if ((domEl as HTMLButtonElement).disabled)
          return createActionFailure(
            id,
            'ELEMENT_NOT_ENABLED',
            `Element ${id} is disabled`,
            startTime
          );
        dom = domEl;
      }

      try {
        switch (request.action) {
          case 'click':
            dispatchRealClick(dom);
            break;
          case 'hoverClick': {
            // Composite reveal-then-click for a control whose interactivity is
            // gated behind a CSS `:hover` / Tailwind `group-hover` rule (the
            // runner's `ZoneHoverActions` toolbar is the canonical case: its
            // buttons are `pointer-events:none` until a `.group` ancestor is
            // hovered). Reuse the exact hover helpers the HTTP action-executor
            // path uses (`findHoverableAncestor` + `dispatchHoverEnter` +
            // `nextAnimationFrame`) so both dispatch paths share one
            // implementation. Hover the nearest hoverable ancestor first so a
            // `group-hover:pointer-events-auto` rule flips the target
            // interactive, then the target itself, then yield one animation
            // frame for the style recomputation before clicking. The hover is
            // intentionally left in place (no `mouseleave`) so the control
            // stays interactive through the click.
            const ancestor = findHoverableAncestor(dom);
            if (ancestor && ancestor !== dom) {
              dispatchHoverEnter(ancestor);
            }
            dispatchHoverEnter(dom);
            await nextAnimationFrame();
            // `dispatchRealClick` ends with a native `dom.click()`, which fires
            // even while the element computes to `pointer-events:none` in jsdom
            // (no real hit-test) — mirroring `performHoverClick` in the HTTP
            // path, so behavior matches regardless of how the CSS recalc lands.
            dispatchRealClick(dom);
            break;
          }
          case 'focus':
            dom.focus();
            break;
          case 'blur':
            dom.blur();
            break;
          case 'hover':
            dom.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            dom.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            break;
          case 'scrollIntoView': {
            type ScrollLogicalPos = 'start' | 'center' | 'end' | 'nearest';
            const sivParams = request.params as
              | { smooth?: boolean; block?: ScrollLogicalPos; inline?: ScrollLogicalPos }
              | undefined;
            const sivBehavior =
              sivParams?.smooth !== false ? ('smooth' as const) : ('auto' as const);
            const sivBlock = sivParams?.block || 'center';
            const sivInline = sivParams?.inline || 'nearest';
            // Already-in-viewport short-circuit: if the element is fully on
            // screen, skip the underlying scroll so a pre-click "scroll into
            // view" doesn't surface as a confusing failure when downstream
            // detectors observe "no change". Mirrors the same shape returned
            // by `performScrollIntoView` in @qontinui/ui-bridge-auto.
            const sivRect = dom.getBoundingClientRect();
            const sivFullyVisible =
              typeof window !== 'undefined' &&
              window.innerWidth > 0 &&
              window.innerHeight > 0 &&
              sivRect.width > 0 &&
              sivRect.height > 0 &&
              sivRect.top >= 0 &&
              sivRect.left >= 0 &&
              sivRect.bottom <= window.innerHeight &&
              sivRect.right <= window.innerWidth;
            if (sivFullyVisible) {
              return {
                success: true,
                action: 'scrollIntoView',
                elementId: id,
                durationMs: performance.now() - startTime,
                alreadyVisible: true,
                scrolled: false,
                timestamp: Date.now(),
              };
            }
            dom.scrollIntoView({ behavior: sivBehavior, block: sivBlock, inline: sivInline });
            // For smooth scrollIntoView, wait for the animation to settle before returning.
            // Use setTimeout instead of rAF — rAF doesn't fire when the tab is backgrounded.
            if (sivBehavior === 'smooth') {
              await new Promise<void>((r) => setTimeout(r, 400));
            } else {
              await new Promise<void>((r) => setTimeout(r, 16));
            }
            return {
              success: true,
              action: 'scrollIntoView',
              elementId: id,
              durationMs: performance.now() - startTime,
              alreadyVisible: false,
              scrolled: true,
              timestamp: Date.now(),
            };
          }
          case 'scroll': {
            type ScrollDir = 'up' | 'down' | 'left' | 'right';
            const scrollParams = request.params as
              | {
                  direction?: ScrollDir;
                  amount?: number;
                  deltaY?: number;
                  deltaX?: number;
                  smooth?: boolean;
                }
              | undefined;
            const behavior = scrollParams?.smooth ? ('smooth' as const) : ('auto' as const);
            // Find scrollable ancestor
            let scrollTarget: HTMLElement = dom;
            let p = dom.parentElement;
            while (p && p !== document.body) {
              const st = getComputedStyle(p);
              if (
                (st.overflowY === 'auto' ||
                  st.overflowY === 'scroll' ||
                  st.overflowX === 'auto' ||
                  st.overflowX === 'scroll') &&
                (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)
              ) {
                scrollTarget = p;
                break;
              }
              p = p.parentElement;
            }
            if (scrollTarget === dom && document.body.scrollHeight > document.body.clientHeight) {
              scrollTarget = document.body;
            }
            const before = {
              scrollTop: scrollTarget.scrollTop,
              scrollLeft: scrollTarget.scrollLeft,
            };
            let dx: number;
            let dy: number;
            if (scrollParams?.deltaY !== undefined || scrollParams?.deltaX !== undefined) {
              // deltaY/deltaX use wheel-event semantics: positive = down/right, negative = up/left.
              dx = scrollParams.deltaX ?? 0;
              dy = scrollParams.deltaY ?? 0;
            } else {
              const direction = scrollParams?.direction || 'down';
              const amount = scrollParams?.amount || 300;
              dx = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
              dy = direction === 'down' ? amount : direction === 'up' ? -amount : 0;
            }
            scrollTarget.scrollBy({ left: dx, top: dy, behavior });
            // Use setTimeout instead of requestAnimationFrame — rAF doesn't fire
            // when the tab is backgrounded, which causes SSE relay timeouts.
            // scrollBy with behavior:'auto' is synchronous, so a minimal yield suffices.
            await new Promise<void>((r) => setTimeout(r, 16));
            const after = {
              scrollTop: scrollTarget.scrollTop,
              scrollLeft: scrollTarget.scrollLeft,
            };
            return {
              success: true,
              action: 'scroll',
              elementId: id,
              durationMs: performance.now() - startTime,
              scrollInfo: {
                before,
                after,
                changed:
                  before.scrollTop !== after.scrollTop || before.scrollLeft !== after.scrollLeft,
              },
              timestamp: Date.now(),
            };
          }
          case 'toggle': {
            if (dom instanceof HTMLInputElement && dom.type === 'checkbox') {
              dom.checked = !dom.checked;
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (dom.getAttribute('role') === 'switch') {
              dispatchRealClick(dom);
            } else {
              dispatchRealClick(dom); // generic toggle via pointer+click
            }
            break;
          }
          case 'doubleClick':
            dom.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            break;
          case 'type': {
            if (dom instanceof HTMLInputElement || dom instanceof HTMLTextAreaElement) {
              const text = (request.params?.text as string) || request.text || '';
              applyValueMutation(dom, {
                value: text,
                mode: request.params?.clear || request.clear ? 'clear-then-append' : 'append',
                blur: false,
              });
            } else
              return createActionFailure(
                id,
                'UNSUPPORTED_ACTION',
                `Cannot type into ${dom.tagName}`,
                startTime
              );
            break;
          }
          case 'clear': {
            if (dom instanceof HTMLInputElement || dom instanceof HTMLTextAreaElement) {
              applyValueMutation(dom, { value: '', mode: 'clear', blur: false });
            } else
              return createActionFailure(
                id,
                'UNSUPPORTED_ACTION',
                `Cannot clear ${dom.tagName}`,
                startTime
              );
            break;
          }
          case 'setValue': {
            if (dom instanceof HTMLInputElement || dom instanceof HTMLTextAreaElement) {
              const val = request.value || (request.params?.value as string) || '';
              applyValueMutation(dom, { value: val, mode: 'replace', blur: false });
            } else
              return createActionFailure(
                id,
                'UNSUPPORTED_ACTION',
                `Cannot set value on ${dom.tagName}`,
                startTime
              );
            break;
          }
          case 'select': {
            if (dom instanceof HTMLSelectElement) {
              dom.value = request.value || '';
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            } else
              return createActionFailure(
                id,
                'UNSUPPORTED_ACTION',
                `Cannot select on ${dom.tagName}`,
                startTime
              );
            break;
          }
          case 'check': {
            if (dom instanceof HTMLInputElement) {
              dom.checked = true;
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            } else
              return createActionFailure(
                id,
                'UNSUPPORTED_ACTION',
                `Cannot check ${dom.tagName}`,
                startTime
              );
            break;
          }
          case 'uncheck': {
            if (dom instanceof HTMLInputElement) {
              dom.checked = false;
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            } else
              return createActionFailure(
                id,
                'UNSUPPORTED_ACTION',
                `Cannot uncheck ${dom.tagName}`,
                startTime
              );
            break;
          }
          case 'submit': {
            const form = dom.closest('form');
            if (form) form.requestSubmit();
            else dispatchRealClick(dom);
            break;
          }
          case 'reset': {
            const form = dom.closest('form');
            if (form) form.reset();
            break;
          }
          case 'sendKeys': {
            dom.focus();
            const rawKeys = request.params?.keys;
            // Helper: determine if a key should produce a keypress event.
            // Only printable characters (single char, no ctrl/alt/meta modifiers) generate keypress.
            const shouldKeypress = (
              key: string,
              mods: { ctrl?: boolean; alt?: boolean; meta?: boolean }
            ) => key.length === 1 && !mods.ctrl && !mods.alt && !mods.meta;

            if (Array.isArray(rawKeys)) {
              // Spec-compliant: array of KeyboardAction objects [{key: "a", modifiers?: {...}}, ...]
              for (const keyDesc of rawKeys) {
                const key = typeof keyDesc === 'string' ? keyDesc : keyDesc?.key;
                if (!key) continue;
                const mods = (typeof keyDesc === 'object' && keyDesc?.modifiers) || {};
                const eventInit: KeyboardEventInit = {
                  key,
                  bubbles: true,
                  cancelable: true,
                  ctrlKey: !!mods.ctrl,
                  shiftKey: !!mods.shift,
                  altKey: !!mods.alt,
                  metaKey: !!mods.meta,
                };
                dom.dispatchEvent(new KeyboardEvent('keydown', eventInit));
                if (shouldKeypress(key, mods)) {
                  dom.dispatchEvent(new KeyboardEvent('keypress', eventInit));
                }
                dom.dispatchEvent(new KeyboardEvent('keyup', eventInit));
              }
            } else {
              // Legacy: string of characters (from text param or keys-as-string)
              const text =
                (typeof rawKeys === 'string' ? rawKeys : (request.params?.text as string)) || '';
              for (const char of text) {
                const eventInit: KeyboardEventInit = { key: char, bubbles: true, cancelable: true };
                dom.dispatchEvent(new KeyboardEvent('keydown', eventInit));
                if (shouldKeypress(char, {})) {
                  dom.dispatchEvent(new KeyboardEvent('keypress', eventInit));
                }
                dom.dispatchEvent(new KeyboardEvent('keyup', eventInit));
              }
            }
            break;
          }
          case 'drag': {
            // Accept params from either request.params or the request root (flat format)
            const req = request as unknown as Record<string, unknown>;
            const dragParams = {
              ...(req.params as Record<string, unknown> | undefined),
              ...Object.fromEntries(
                [
                  'targetPosition',
                  'target',
                  'targetId',
                  'targetOffset',
                  'sourceOffset',
                  'steps',
                  'holdDelay',
                  'releaseDelay',
                  'html5',
                ]
                  .filter((k) => req[k] !== undefined)
                  .map((k) => [k, req[k]])
              ),
            } as { targetId?: string; targetPosition?: { x: number; y: number } };
            const { targetId, targetPosition } = dragParams;
            const targetEl = targetId ? (getElement(targetId)?.element as HTMLElement) : null;
            const srcRect = dom.getBoundingClientRect();
            dom.dispatchEvent(
              new DragEvent('dragstart', {
                bubbles: true,
                clientX: srcRect.x + srcRect.width / 2,
                clientY: srcRect.y + srcRect.height / 2,
              })
            );
            if (targetEl) {
              const tgtRect = targetEl.getBoundingClientRect();
              targetEl.dispatchEvent(
                new DragEvent('dragover', {
                  bubbles: true,
                  clientX: tgtRect.x + tgtRect.width / 2,
                  clientY: tgtRect.y + tgtRect.height / 2,
                })
              );
              targetEl.dispatchEvent(
                new DragEvent('drop', {
                  bubbles: true,
                  clientX: tgtRect.x + tgtRect.width / 2,
                  clientY: tgtRect.y + tgtRect.height / 2,
                })
              );
            } else if (targetPosition) {
              const dropTarget =
                document.elementFromPoint(targetPosition.x, targetPosition.y) || dom;
              dropTarget.dispatchEvent(
                new DragEvent('dragover', {
                  bubbles: true,
                  clientX: targetPosition.x,
                  clientY: targetPosition.y,
                })
              );
              dropTarget.dispatchEvent(
                new DragEvent('drop', {
                  bubbles: true,
                  clientX: targetPosition.x,
                  clientY: targetPosition.y,
                })
              );
            }
            dom.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
            break;
          }
          default:
            return createActionFailure(
              id,
              'UNSUPPORTED_ACTION',
              `Unknown action: ${request.action}`,
              startTime
            );
        }
      } catch (err) {
        return createActionFailure(
          id,
          'ACTION_REJECTED',
          `Action failed: ${(err as Error).message}`,
          startTime
        );
      }
      return {
        success: true,
        action: request.action,
        elementId: id,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
      };
    }

    // Phase 2.1 (plan 2026-05-03) — POST /control/element/:id/expect served
    // by the in-browser SDK runtime. Reuses `pollWaitForElement` so the
    // predicate semantics stay aligned with `/ai/wait-for-element`. The
    // 422 status is stamped by the relay handler upstream — this command
    // returns the data body unchanged.
    case 'expectElement': {
      const { id, request } = payload as {
        id: string;
        request: { state: WaitForElementState; timeout?: number; pollMs?: number };
      };
      const requestedState = request?.state;
      if (typeof requestedState !== 'string') {
        return {
          success: false,
          error: "expectElement: 'state' is required",
          timestamp: Date.now(),
        };
      }
      if (!WAIT_FOR_ELEMENT_STATES.includes(requestedState)) {
        return {
          success: false,
          error: `expectElement: invalid state '${requestedState}', expected one of ${WAIT_FOR_ELEMENT_STATES.join('|')}`,
          timestamp: Date.now(),
        };
      }
      const timeoutMs = Math.min(
        Math.max(typeof request?.timeout === 'number' ? request.timeout : 5000, 0),
        30_000
      );
      const pollMs = Math.max(typeof request?.pollMs === 'number' ? request.pollMs : 100, 10);
      const takeSnapshot = (): ElementSnapshot => {
        try {
          return snapshotFromRegisteredElement(getElement(id));
        } catch {
          return { registered: false, state: null };
        }
      };
      const outcome = await pollWaitForElement({
        takeSnapshot,
        predicate: requestedState,
        timeoutMs,
        pollMs,
      });
      const observedState = outcome.observed
        ? {
            registered: outcome.observed.registered,
            state: (outcome.observed.state as Record<string, unknown> | null) ?? null,
          }
        : null;
      return {
        passed: outcome.found,
        observedState,
        durationMs: outcome.durationMs,
      };
    }

    case 'highlightElement': {
      const dom = (getElement(payload.id as string)?.element ?? null) as HTMLElement | null;
      if (dom) {
        const origOutline = dom.style.outline;
        const origTransition = dom.style.transition;
        dom.style.transition = 'outline 0.2s';
        dom.style.outline = '3px solid #ff6b00';
        setTimeout(() => {
          dom.style.outline = origOutline;
          dom.style.transition = origTransition;
        }, 2000);
      }
      return { success: true };
    }

    // ======================================================================
    // App-agnostic interaction relay commands
    //
    // These mirror the standalone-server convenience endpoints
    // (server/handlers.ts: clickByText/clickBySelector/typeInto/readValue/
    // findByText) so the relay path (web SSE, runner WS) executes the SAME
    // app-agnostic interactions against the connected tab's live DOM instead
    // of hitting `default: throw` and silently falling back to the runner's
    // own webview. Each case returns the bare data object the standalone
    // handler passes to `success(...)`; `relayCommand` re-wraps it. The
    // action strings are pinned canonical in
    // `INTERACTION_RELAY_COMMAND_ACTIONS` (server/types.ts) and guarded by
    // `relay-handlers.contract.test.ts`.
    // ======================================================================

    // clickByText / clickBySelector / typeInto / readValue / findByText share
    // their bodies with the standalone server dispatcher (`server/handlers.ts`)
    // via `server/page-primitives` (browser-safe, zero-dependency), so the
    // §4.6 redaction gates exist exactly once. This relay path supplies only
    // its side-effect adapter (`dispatchRealClick`, `reactAwareFill`) and
    // returns the bare data object (or `{ success: false, error }`) that
    // `relayCommand` re-wraps.
    case 'clickByText': {
      const { text, tag, exact } = payload as {
        text?: string;
        tag?: string;
        exact?: boolean;
      };
      const r = clickByTextPrimitive(text, { tag, exact }, dispatchRealClick);
      return r.ok ? r.data : { success: false, error: r.error };
    }

    case 'clickBySelector': {
      const { selector, index } = payload as { selector?: string; index?: number };
      const r = clickBySelectorPrimitive(selector, index, dispatchRealClick);
      return r.ok ? r.data : { success: false, error: r.error };
    }

    case 'typeInto': {
      const { selector, label, text, clear } = payload as {
        selector?: string;
        label?: string;
        text?: string;
        clear?: boolean;
      };
      const r = typeIntoPrimitive({ selector, label, text, clear }, reactAwareFill);
      return r.ok ? r.data : { success: false, error: r.error };
    }

    case 'readValue': {
      const { selector, index, all } = payload as {
        selector?: string;
        index?: number;
        all?: unknown;
      };
      const r = readValuePrimitive(selector, index, { all });
      return r.ok ? r.data : { success: false, error: r.error };
    }

    // Document-scoped key dispatch. Unlike the element-scoped `sendKeys`
    // action (inside `executeElementAction`), this reaches global
    // `document`/`window` keydown listeners, which is where Escape-to-close
    // behavior actually lives.
    case 'sendKeysToPage': {
      const { keys, target, delay } = payload as {
        keys?: unknown;
        target?: unknown;
        delay?: number;
      };
      const r = await sendKeysToPagePrimitive({ keys, target, delay });
      return r.ok ? r.data : { success: false, error: r.error };
    }

    case 'findByText': {
      const { text, tag, exact } = payload as {
        text?: string;
        tag?: string;
        exact?: boolean;
      };
      const r = findByTextPrimitive(text, { tag, exact });
      return r.ok ? r.data : { success: false, error: r.error };
    }

    case 'find':
    case 'discover': {
      // Canonical filter (src/core/find-filter.ts) — shared with the direct
      // server handlers and the relay handlers so the four historical copies
      // cannot drift again. Handles interactive_only/include_hidden (default
      // TRUE — hidden elements included unless explicitly excluded),
      // type/element_type/types, role, label, text, exact_text, testId.
      const filtered = applyCanonicalFindFilter(elements, payload as CanonicalFindCriteria);
      // F3 readiness signal (plan 2026-06-12 item 5): mirror the snapshot's
      // `registration` block on find/discover so pollers can distinguish
      // "page not hydrated/registered yet" (`everHadRegistrations: false`)
      // from "genuinely zero matches" (`true` + empty). Degrades gracefully
      // to the conservative default if the registry probe throws.
      let registration: {
        totalRegistered: number;
        everHadRegistrations: boolean;
        byRoute: Record<string, { count: number; ids: string[] }>;
      } = {
        totalRegistered: elements.length,
        everHadRegistrations: false,
        byRoute: {},
      };
      try {
        const reg = getGlobalRegistry();
        registration = {
          totalRegistered: elements.length,
          everHadRegistrations: reg.hasEverHadRegistrations(),
          byRoute: reg.getCountsByRoute(),
        };
      } catch {
        // Fall back to the conservative default above.
      }
      return {
        elements: filtered.map(elementToFindResult),
        total: filtered.length,
        durationMs: 0,
        timestamp: Date.now(),
        registration,
      };
    }

    case 'getElementTree':
      return {
        root: document.title,
        elements: elements.length,
        tree: elements.slice(0, 50).map((e) => ({
          id: e.id,
          tag: e.element.tagName.toLowerCase(),
          // §4.6: inside a boundary, both the scraped label and the textContent
          // are the boundary's secret — collapse the whole cell.
          text: isContentRedacted(e.element)
            ? REDACTED_VALUE
            : truncateCodePoints(e.label ?? (readScrubbedText(e.element) ?? ''), 50),
        })),
      };

    case 'getTabInfo':
      return {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
        timestamp: Date.now(),
      };

    // ======================================================================
    // Control — Components
    // ======================================================================

    // Tauri runner sends these command names (snake_case) directly via IPC
    case 'get_components': {
      return {
        count: components.length,
        components: components.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          // Phase 4 carries `effect` onto the Tauri IPC channel too — it is
          // half of UI Bridge's dual-channel design, so a walker driving a
          // Tauri app must be able to exclude destructive actions here as
          // well as over HTTP. `paramSchema` was still absent at this seam
          // when Phase 4 landed; it is emitted below as of 2026-08-23, at the
          // same time the seam started routing through the executor that
          // enforces it.
          actions: c.actions.map((a) => ({
            id: a.id,
            label: a.label,
            description: a.description,
            effect: a.effect,
            // `paramSchema` too, as of 2026-08-23. It is what an agent reads
            // to build conforming params, and the executor now VALIDATES
            // against it on this channel — publishing the enforcement without
            // the declaration would be the same self-contradiction the plan
            // is fixing on the HTTP side.
            paramSchema: a.paramSchema,
          })),
          elementIds: c.elementIds,
          state: c.getState?.() ?? {},
          mounted: true,
        })),
        timestamp: Date.now(),
      };
    }

    case 'get_component': {
      const compId = (payload.componentId ?? payload.id) as string;
      const comp = registry.getComponent(compId);
      if (!comp) {
        return {
          success: false,
          error: inProcessComponentNotFoundMessage(compId),
          timestamp: Date.now(),
        };
      }
      return {
        id: comp.id,
        name: comp.name,
        description: comp.description,
        actions: comp.actions.map((a) => ({
          id: a.id,
          label: a.label,
          description: a.description,
          // Phase 4 — see the `get_components` twin above.
          effect: a.effect,
          // `paramSchema` — see the `get_components` twin above.
          paramSchema: a.paramSchema,
        })),
        elementIds: comp.elementIds,
        state: comp.getState?.() ?? {},
        mounted: true,
        timestamp: Date.now(),
      };
    }

    case 'execute_component_action': {
      const compId = (payload.componentId ?? payload.id) as string;
      const actionId = (payload.actionId ?? payload.action) as string;
      const comp = registry.getComponent(compId);
      if (!comp) {
        return {
          success: false,
          error: inProcessComponentNotFoundMessage(compId),
          timestamp: Date.now(),
        };
      }
      const compAction = comp.actions.find((a) => a.id === actionId);
      if (!compAction) {
        return {
          success: false,
          error: `Action "${actionId}" not found on component "${compId}". Available actions: ${comp.actions.map((a) => a.id).join(', ')}`,
          timestamp: Date.now(),
        };
      }
      // Through the executor, not `compAction.handler(...)` — see
      // `ipcActionExecutor`. The component/action pre-checks above stay only
      // because they produce this channel's richer not-found prose; the
      // executor re-resolves both and would answer identically.
      return await runComponentActionViaExecutor(registry, compId, {
        action: actionId,
        params: payload.params as Record<string, unknown> | undefined,
        timeoutMs: (payload as { timeoutMs?: unknown }).timeoutMs as number | undefined,
      });
    }

    case 'getComponentState': {
      const compId = payload.id as string;
      const comp = registry.getComponent(compId);
      if (!comp) {
        return {
          success: false,
          error: inProcessComponentNotFoundMessage(compId),
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
      const { id, request } = payload as {
        id: string;
        // `timeoutMs` is the wire-reachable half of cancellation — the relay
        // forwards the whole `ComponentActionRequest`, so failing to read it
        // here is what made it unreachable on this channel.
        request: { action: string; actionId?: string; params?: P; timeoutMs?: number };
      };
      const actionId = request.actionId ?? request.action;
      const comp = registry.getComponent(id);
      if (!comp) {
        return {
          success: false,
          error: inProcessComponentNotFoundMessage(id),
          timestamp: Date.now(),
        };
      }
      const action = comp.actions.find((a) => a.id === actionId);
      if (!action) {
        return {
          success: false,
          error: `Action "${actionId}" not found on component "${id}". Available actions: ${comp.actions.map((a) => a.id).join(', ')}`,
          timestamp: Date.now(),
        };
      }
      // Through the executor — see `ipcActionExecutor` and the twin above.
      return await runComponentActionViaExecutor(registry, id, {
        action: actionId,
        params: request.params as Record<string, unknown> | undefined,
        timeoutMs: request.timeoutMs,
      });
    }

    // ======================================================================
    // Control — Workflows
    // ======================================================================

    case 'runWorkflow': {
      const { id, request } = payload as { id: string; request?: unknown };
      if (bridge.runWorkflow) {
        try {
          return await bridge.runWorkflow(id, request);
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
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
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
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
    // Specs
    // ======================================================================

    case 'getSpecs': {
      const g = getBridge();
      const store = g.specs?.getGlobalSpecStore?.();
      const result: Record<string, unknown> = {};
      if (store) {
        const all = store.getAll?.();
        if (all instanceof Map) {
          for (const [specId, config] of all) {
            result[specId] = config;
          }
        } else if (all && typeof all === 'object') {
          for (const [specId, config] of Object.entries(all)) {
            result[specId] = config;
          }
        }
      }
      return result;
    }

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
      const criteria = payload as Parameters<typeof engine.search>[0] & { query?: string };
      // Map 'query' to 'text' for NL-style search requests
      if (criteria.query && !criteria.text) {
        criteria.text = criteria.query;
      }
      const resp = engine.search({
        fuzzy: true,
        ...criteria,
      });
      return {
        results: resp.results,
        total: resp.results.length,
        scannedCount: resp.scannedCount,
        timestamp: Date.now(),
      };
    }

    case 'aiFind': {
      // B0 — Delegate to the canonical `find()` pipeline so the relay path
      // (the runner's primary route) gets exactly the same matcher behavior
      // as the standalone server's `aiFind` handler. Prior to this, the
      // relay implementation here built a fresh SearchEngine and called
      // `engine.search({text, type, fuzzy})` directly, bypassing target
      // decomposition, soft-type fallback, B1 mirror lifting, and the B4
      // hard-pinned synonym fallback — so the two transports diverged
      // sharply on natural-language queries. Now both paths share the same
      // engine + the same `find()` orchestration, and the registry
      // source-of-truth is unambiguously `registry.getAllElements()` for
      // both.
      const { createSearchEngine, find } = await import('../ai');
      const engine = createSearchEngine({ includeHidden: true });
      engine.updateElements(elements);
      const payloadObj = (payload ?? {}) as {
        query?: string;
        type?: string;
        context?: import('../ai/find').FindContext;
        confidenceThreshold?: number;
        debug?: boolean;
      };
      const { query, type, context: ctx, confidenceThreshold, debug } = payloadObj;
      // Some legacy callers still send `{query, type}` as a structured
      // shorthand. Promote that to a SearchCriteria so `find()` can dispatch
      // through its structured-query path; otherwise treat the input as a
      // free-text NL query so target decomposition runs.
      const findInput: string | import('../ai/types').SearchCriteria =
        typeof query === 'string' && query.length > 0
          ? type
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { text: query, type: type as any, fuzzy: true }
            : query
          : { fuzzy: true };
      const result = find(findInput, engine, {
        context: ctx,
        confidenceThreshold,
        pickFirst: true,
        debug: debug === true,
      });
      return result;
    }

    case 'aiExecute': {
      const t0 = performance.now();
      const { parseNLInstruction, createSearchEngine } = await import('../ai');
      const { instruction, confidenceThreshold = 0.7 } = payload as {
        instruction: string;
        confidenceThreshold?: number;
      };
      const parsed = parseNLInstruction(instruction);
      if (!parsed)
        return {
          success: false,
          executedAction: instruction,
          error: `Could not parse: "${instruction}"`,
          errorCode: 'PARSE_ERROR',
          durationMs: performance.now() - t0,
          timestamp: Date.now(),
        };
      const engine = createSearchEngine({ includeHidden: true });
      engine.updateElements(elements);
      const resp = engine.search({ text: parsed.targetDescription, fuzzy: true });
      if (!resp.results.length)
        return {
          success: false,
          executedAction: instruction,
          error: `No element matching: "${parsed.targetDescription}"`,
          errorCode: 'ELEMENT_NOT_FOUND',
          durationMs: performance.now() - t0,
          timestamp: Date.now(),
        };
      const best = resp.results[0];
      if (!best || best.confidence < confidenceThreshold)
        return {
          success: false,
          executedAction: instruction,
          error: 'Best match confidence too low',
          errorCode: 'LOW_CONFIDENCE',
          confidence: best?.confidence || 0,
          durationMs: performance.now() - t0,
          timestamp: Date.now(),
        };
      const dom = (getElement(best.element.id)?.element ?? null) as HTMLElement | null;
      if (!dom)
        return {
          success: false,
          executedAction: instruction,
          error: `DOM not found for ${best.element.id}`,
          errorCode: 'ELEMENT_NOT_FOUND',
          durationMs: performance.now() - t0,
          timestamp: Date.now(),
        };
      try {
        // No `hoverClick` case here: this switch dispatches `parsed.action`
        // from `parseNLInstruction`, whose `ParsedAction['action']` union
        // (ai/types.ts) does not include `hoverClick`, so it is unreachable on
        // this NL-instruction path. `hoverClick` is an explicit element-action
        // verb handled in the `executeElementAction` switch above.
        switch (parsed.action) {
          case 'click':
            dispatchRealClick(dom);
            break;
          case 'type':
            if (dom instanceof HTMLInputElement || dom instanceof HTMLTextAreaElement) {
              applyValueMutation(dom, { value: parsed.value || '', mode: 'replace', blur: false });
            }
            break;
          case 'select':
            if (dom instanceof HTMLSelectElement) {
              dom.value = parsed.value || '';
              dom.dispatchEvent(new Event('change', { bubbles: true }));
            }
            break;
          default:
            break;
        }
      } catch (err) {
        return {
          success: false,
          executedAction: instruction,
          error: `Action failed: ${(err as Error).message}`,
          errorCode: 'ACTION_REJECTED',
          durationMs: performance.now() - t0,
          timestamp: Date.now(),
        };
      }
      return {
        success: true,
        executedAction: `${parsed.action} on ${best.element.id}`,
        elementUsed: best.element,
        confidence: best.confidence,
        durationMs: performance.now() - t0,
        timestamp: Date.now(),
      };
    }

    case 'aiAssert': {
      const { createAssertionExecutor } = await import('../ai');
      type AT = import('../ai').AssertionType;
      const exec = createAssertionExecutor({});
      exec.updateElements(elements as unknown as Parameters<typeof exec.updateElements>[0]);
      const r = payload as {
        target?: string;
        type?: string;
        expected?: unknown;
        assertion?: string;
      };
      // Support NL assertions: {assertion: "a button exists"} → {target, type}
      const parsed = parseNLAssertion(r);
      return exec.assert({
        target: parsed.target,
        type: parsed.type as AT,
        expected: parsed.expected,
      });
    }

    case 'aiAssertBatch': {
      const { createAssertionExecutor } = await import('../ai');
      type AT = import('../ai').AssertionType;
      const exec = createAssertionExecutor({});
      exec.updateElements(elements as unknown as Parameters<typeof exec.updateElements>[0]);
      const r = payload as {
        assertions: Array<{
          target?: string;
          type?: string;
          expected?: unknown;
          assertion?: string;
        }>;
        mode?: 'all' | 'any';
      };
      return exec.assertBatch({
        assertions: r.assertions.map((a) => {
          const parsed = parseNLAssertion(a);
          return { target: parsed.target, type: parsed.type as AT, expected: parsed.expected };
        }),
        mode: r.mode || 'all',
      });
    }

    case 'getSemanticSnapshot': {
      const { createSnapshotManager } = await import('../ai');
      const mgr = createSnapshotManager({
        maxTokens: typeof payload.maxTokens === 'number' ? payload.maxTokens : 0,
      });
      const snap = {
        timestamp: Date.now(),
        elements: elements.map(elementToSnapshot),
        components: [],
        workflows: [],
        activeRuns: [],
      };
      // The semantic-snapshot manager only reads id/type/label/state off the
      // elements; the minimal shape here intentionally omits the canonical
      // lifecycle fields the full ControlSnapshot type now requires.
      return mgr.createSnapshot(snap as unknown as import('../control/types').ControlSnapshot);
    }

    case 'getSemanticDiff':
      return { changes: [], since: payload.since, timestamp: Date.now() };

    case 'getPageSummary': {
      const { generatePageSummary } = await import('../ai');
      const aiEls = elements.map((e) => {
        // §4.6: `e.label` is DOM-scraped on auto-registered elements, and
        // `description` falls back to it — CONTENT-scrub both against the live
        // node (redacted inside a boundary, passthrough out). `e.aliases` is
        // developer-SET on the registration (never scraped), the documented
        // boundary exemption, so it stays branded via `trustDeveloperContent`.
        const verdict = verdictOf(e.element);
        return {
          id: e.id,
          type: e.type,
          label: scrubContent(e.label, e.element),
          tagName: e.element.tagName.toLowerCase(),
          actions: e.actions as string[],
          state: e.getState(),
          registered: true,
          description: scrubContentRequired(e.description || e.label || e.id, verdict),
          aliases: (e.aliases || []).map((a: string) => trustDeveloperContent(a)),
          suggestedActions: [],
        };
      });
      return generatePageSummary(aiEls as Parameters<typeof generatePageSummary>[0]);
    }

    case 'aiSemanticSearch': {
      const { createSearchEngine } = await import('../ai');
      const engine = createSearchEngine({ includeHidden: true });
      engine.updateElements(elements);
      const resp = engine.search({
        fuzzy: true,
        ...(payload as Parameters<typeof engine.search>[0]),
      });
      return { results: resp.results, total: resp.results.length, timestamp: Date.now() };
    }

    // ======================================================================
    // Change Tracking & Buffer
    // ======================================================================

    case 'executeWithDiff': {
      const {
        instruction,
        elementAction,
        elementId,
        action: act,
        params,
      } = payload as {
        instruction?: string;
        elementAction?: { elementId: string; action: string; params?: P };
        elementId?: string;
        action?: string;
        params?: P;
      };
      const before = elements.map(elementToSnapshot);
      let actionResult: unknown;
      if (instruction) {
        // Natural language instruction — resolve via aiExecute
        actionResult = await executeCommand('aiExecute', { instruction }, bridge);
      } else {
        // Direct element action (from elementAction or legacy flat fields)
        const eId = elementAction?.elementId ?? elementId;
        const eAct = elementAction?.action ?? act;
        const eParams = elementAction?.params ?? params;
        actionResult = await executeCommand(
          'executeElementAction',
          { id: eId, request: { action: eAct, ...eParams } },
          bridge
        );
      }
      await new Promise((r) => setTimeout(r, 100)); // Brief wait for DOM to settle
      const after = elements.map(elementToSnapshot);
      return {
        actionResult,
        diff: { before: before.length, after: after.length, timestamp: Date.now() },
      };
    }

    case 'waitForChange': {
      const opts = payload as {
        predicate?: unknown;
        options?: { timeout?: number };
        timeout?: number;
      };
      const timeout = opts.timeout ?? opts.options?.timeout ?? 5000;
      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve({ changed: true, timestamp: Date.now() });
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        setTimeout(() => {
          observer.disconnect();
          resolve({ changed: false, timedOut: true, timestamp: Date.now() });
        }, timeout as number);
      });
    }

    // ======================================================================
    // Wait-for-element / wait-for-route — relay path.
    //
    // The server-side handlers in `src/server/handlers.ts` own the canonical
    // implementations for in-process consumers (the runner). When the bridge
    // is paired to a real browser the server-side relay-handlers
    // (`src/server/relay-handlers.ts:1832-1842`) forward each request through
    // `relayCommand(...)` to this dispatcher.
    //
    // The browser context owns the DOM + the SDK registry, so we re-implement
    // a DOM-driven version here that matches the server-side shape (success
    // payload vs `{reason: 'timeout', ...}` timeout payload). This was an
    // outstanding gap that shipped 2026-04-24 in `0b5b438` — the relay routed
    // the command to the browser but the browser dispatcher threw
    // `Unknown command action: …`, so every web-frontend wait-for-element /
    // wait-for-route call was failing.
    //
    // Wrapping shape: the relay-handlers thread the success envelope around
    // the browser response inside the runner (relayCommand returns
    // `APIResponse<T>` after wrapping a successful dispatch result via
    // `success(...)`), so we return the inner payload here only.
    // ======================================================================

    case 'waitForElementRegistered': {
      const req = (payload ?? {}) as {
        predicate?: {
          id?: string;
          label?: string;
          testId?: string;
          selector?: string;
        };
        requirement?: 'registered' | 'visible' | 'has-layout';
        pollMs?: number;
        timeoutMs?: number;
      };
      const predicate = req.predicate ?? {};
      const requirement = req.requirement ?? 'registered';
      const pollMs = Math.min(
        Math.max(typeof req.pollMs === 'number' ? req.pollMs : 100, 50),
        1000
      );
      const timeoutMs = Math.min(
        Math.max(typeof req.timeoutMs === 'number' ? req.timeoutMs : 5000, 100),
        60_000
      );

      const labelNeedle =
        typeof predicate.label === 'string' && predicate.label.length > 0
          ? predicate.label.toLowerCase()
          : null;

      const predicateMatches = (
        el: RegisteredElement,
        domEl: HTMLElement | null
      ): boolean => {
        if (typeof predicate.id === 'string' && predicate.id.length > 0) {
          if (el.id !== predicate.id) return false;
        }
        if (labelNeedle) {
          const label = typeof el.label === 'string' ? el.label.toLowerCase() : '';
          const ariaLabel = (domEl ? readAriaLabelAttr(domEl) : null)?.toLowerCase() ?? '';
          if (!label.includes(labelNeedle) && !ariaLabel.includes(labelNeedle)) {
            return false;
          }
        }
        if (typeof predicate.testId === 'string' && predicate.testId.length > 0) {
          const testId = domEl?.getAttribute?.('data-testid');
          if (testId !== predicate.testId) return false;
        }
        return true;
      };

      const requirementMet = (
        el: RegisteredElement,
        domEl: HTMLElement | null
      ): boolean => {
        if (requirement === 'registered') return true;

        if (requirement === 'visible') {
          if (typeof el.visible === 'boolean') return el.visible;
          if (!domEl) return false;
          if (domEl.offsetParent === null) return false;
          const rect = domEl.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        if (requirement === 'has-layout') {
          const w = el.bbox?.width ?? 0;
          const h = el.bbox?.height ?? 0;
          if (w > 0 && h > 0) return true;
          if (domEl) {
            const rect = domEl.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          return false;
        }

        return true;
      };

      const started = Date.now();

      type Match = { element: Record<string, unknown>; domEl: HTMLElement | null };

      const attempt = (): Match | null => {
        try {
          // Re-read the registry each tick — the outer `elements` snapshot
          // was captured before the poll started, so elements registered
          // mid-wait would otherwise be invisible. Matches the runner-side
          // handler's behaviour of calling `registry.getAllElements()` on
          // every poll pass.
          const live = registry.getAllElements();
          for (const el of live) {
            const domEl = el.element ?? null;
            if (!predicateMatches(el, domEl)) continue;
            if (!requirementMet(el, domEl)) continue;
            return { element: serializeRegisteredElement(el), domEl };
          }
        } catch {
          // Registry serialization errors are non-fatal; keep polling.
        }

        // DOM-selector fallback — only kicks in when caller supplied one and
        // the registry didn't satisfy the predicate. Matches the
        // server-side handler's behaviour for un-instrumented widgets.
        if (
          typeof predicate.selector === 'string' &&
          predicate.selector.length > 0 &&
          typeof document !== 'undefined'
        ) {
          try {
            const domEl = document.querySelector(predicate.selector) as HTMLElement | null;
            if (domEl) {
              // Internal synthetic shape for requirementMet's interface only —
              // never emitted. Route the raw reads through the a11y choke point.
              const syntheticEl: Record<string, unknown> = {
                id: domEl.id || `dom-${predicate.selector}`,
                label: readAriaLabelAttr(domEl) ?? computeVisibleText(domEl) ?? undefined,
                type: domEl.tagName?.toLowerCase?.(),
                ariaLabel: readAriaLabelAttr(domEl) ?? undefined,
              };
              // Build a minimal RegisteredElement-shaped object purely for
              // requirementMet's interface. Visibility/layout checks fall
              // through to the live DOM since `visible`/`bbox` are absent.
              const reqMet = requirementMet(
                { visible: undefined, bbox: undefined } as unknown as RegisteredElement,
                domEl
              );
              if (!reqMet) return null;
              return { element: syntheticEl, domEl };
            }
          } catch {
            // Invalid selector — treat as no match.
          }
        }

        return null;
      };

      // Fast path — check before scheduling any timers.
      const first = attempt();
      if (first) {
        return {
          element: first.element,
          elapsedMs: Date.now() - started,
        };
      }

      return new Promise((resolve) => {
        let done = false;
        let lastPartial: Record<string, unknown> | undefined;

        const poll = () => {
          if (done) return;
          const elapsed = Date.now() - started;

          const match = attempt();
          if (match) {
            done = true;
            resolve({
              element: match.element,
              elapsedMs: Date.now() - started,
            });
            return;
          }

          // Track "closest match" — predicate-matched but requirement-failed
          // element, so timeouts surface why they failed. Re-read the live
          // registry for the same reason as `attempt()`.
          if (requirement !== 'registered') {
            try {
              for (const el of registry.getAllElements()) {
                const domEl = el.element ?? null;
                if (predicateMatches(el, domEl)) {
                  lastPartial = serializeRegisteredElement(el);
                  break;
                }
              }
            } catch {
              /* ignore */
            }
          }

          if (elapsed >= timeoutMs) {
            done = true;
            resolve({
              reason: 'timeout',
              elapsedMs: elapsed,
              closestMatch: lastPartial,
            });
            return;
          }

          setTimeout(poll, pollMs);
        };

        setTimeout(poll, pollMs);
      });
    }

    case 'waitForElementByCondition': {
      const req = (payload ?? {}) as {
        selector?: {
          id?: string;
          title?: string;
          aria_label?: string;
          text?: string;
          type?: string;
        };
        timeout_ms?: number;
        condition?: 'present' | 'visible' | 'clickable' | 'text-matches';
        text_match?: string;
      };
      const selector = req.selector ?? {};
      const condition = req.condition ?? 'present';
      const text_match = req.text_match;

      const timeoutMs = Math.min(
        Math.max(typeof req.timeout_ms === 'number' ? req.timeout_ms : 5000, 100),
        60_000
      );

      const started = Date.now();
      const POLL_MS = 100;

      const matchesSelector = (el: RegisteredElement): boolean => {
        const domEl = el.element ?? null;
        const elType = typeof el.type === 'string' ? el.type.toLowerCase() : '';
        const elTag = (domEl?.tagName ?? '').toLowerCase();
        if (selector.type) {
          const needle = selector.type.toLowerCase();
          if (!elType.includes(needle) && !elTag.includes(needle)) return false;
        }
        if (selector.id && el.id !== selector.id) return false;

        const ariaLabel = (domEl ? readAriaLabelAttr(domEl) : null) ?? undefined;
        const title = (domEl ? readTitleAttr(domEl) : null) ?? undefined;

        if (selector.title) {
          const needle = selector.title.toLowerCase();
          const t = (title ?? '').toLowerCase();
          const a = (ariaLabel ?? '').toLowerCase();
          const l = (el.label ?? '').toLowerCase();
          if (!t.includes(needle) && !a.includes(needle) && !l.includes(needle)) {
            return false;
          }
        }
        if (selector.aria_label) {
          const needle = selector.aria_label.toLowerCase();
          const a = (ariaLabel ?? '').toLowerCase();
          const l = (el.label ?? '').toLowerCase();
          if (!a.includes(needle) && !l.includes(needle)) return false;
        }
        if (selector.text) {
          const needle = selector.text.toLowerCase();
          const l = (el.label ?? '').toLowerCase();
          const i = el.id.toLowerCase();
          if (!l.includes(needle) && !i.includes(needle)) return false;
        }
        return true;
      };

      const checkCondition = (el: RegisteredElement, domEl: HTMLElement | null): boolean => {
        switch (condition) {
          case 'present':
            return true;
          case 'visible': {
            if (!domEl) return false;
            if (domEl.offsetParent === null) return false;
            const rect = domEl.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          case 'clickable': {
            if (!domEl) return false;
            if (domEl.offsetParent === null) return false;
            const rect = domEl.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            if ((domEl as HTMLButtonElement | HTMLInputElement).disabled) return false;
            if (domEl.getAttribute('aria-disabled') === 'true') return false;
            return true;
          }
          case 'text-matches': {
            if (!text_match) return true;
            const needle = text_match.toLowerCase();
            const label = typeof el.label === 'string' ? el.label.toLowerCase() : '';
            const ariaLabel = ((domEl ? readAriaLabelAttr(domEl) : null) ?? '').toLowerCase();
            const title = ((domEl ? readTitleAttr(domEl) : null) ?? '').toLowerCase();
            const textContent = (domEl ? computeVisibleText(domEl) : undefined)?.toLowerCase() ?? '';
            return (
              label.includes(needle) ||
              ariaLabel.includes(needle) ||
              title.includes(needle) ||
              textContent.includes(needle)
            );
          }
          default:
            return true;
        }
      };

      return new Promise((resolve) => {
        let done = false;

        const poll = () => {
          if (done) return;
          const waited_ms = Date.now() - started;

          try {
            // Re-read the live registry each tick so elements registered
            // mid-wait are visible (the outer `elements` snapshot was
            // captured before the poll started).
            for (const el of registry.getAllElements()) {
              if (!matchesSelector(el)) continue;
              const domEl = el.element ?? null;
              if (checkCondition(el, domEl)) {
                done = true;
                resolve({
                  matched: true,
                  element: serializeRegisteredElement(el),
                  waited_ms,
                });
                return;
              }
            }
          } catch {
            // Registry errors are non-fatal; keep polling.
          }

          if (waited_ms >= timeoutMs) {
            done = true;
            resolve({ matched: false, waited_ms });
            return;
          }

          setTimeout(poll, POLL_MS);
        };

        poll();
      });
    }

    case 'waitForRouteChange': {
      const req = (payload ?? {}) as {
        fromRoute?: string;
        toRoute?: string;
        matchMode?: 'exact' | 'prefix' | 'regex';
        timeoutMs?: number;
      };
      const matchMode = req.matchMode ?? 'exact';
      const timeoutMs = Math.min(
        Math.max(typeof req.timeoutMs === 'number' ? req.timeoutMs : 5000, 100),
        60_000
      );

      // Validate `toRoute` matcher up front so invalid regex surfaces as a
      // synchronous validation error — matches the server-side handler shape.
      let toMatcher: ((candidate: string) => boolean) | null = null;
      if (typeof req.toRoute === 'string' && req.toRoute.length > 0) {
        const needle = req.toRoute;
        if (matchMode === 'exact') {
          toMatcher = (c) => c === needle;
        } else if (matchMode === 'prefix') {
          toMatcher = (c) => c.startsWith(needle);
        } else if (matchMode === 'regex') {
          let re: RegExp;
          try {
            re = new RegExp(needle);
          } catch (err) {
            return {
              success: false,
              error: `Invalid regex toRoute: ${(err as Error).message}`,
              code: 'VALIDATION_ERROR',
            };
          }
          toMatcher = (c) => re.test(c);
        }
      }

      const fromMatcher =
        typeof req.fromRoute === 'string' && req.fromRoute.length > 0
          ? (candidate: string) => candidate === req.fromRoute
          : null;

      const started = Date.now();
      const initialRoute =
        typeof window !== 'undefined' ? window.location.pathname : '';

      return new Promise((resolve) => {
        let settled = false;
        let lastFrom = initialRoute;
        let lastTo: string | undefined;
        const cleanups: Array<() => void> = [];

        const done = (value: unknown) => {
          if (settled) return;
          settled = true;
          for (const c of cleanups) {
            try {
              c();
            } catch {
              /* ignore */
            }
          }
          resolve(value);
        };

        const checkAndFire = (from: string, to: string) => {
          lastTo = to;
          if (from === to) return; // Not a transition.
          if (fromMatcher && !fromMatcher(from)) return;
          if (toMatcher && !toMatcher(to)) return;
          done({ from, to, elapsedMs: Date.now() - started });
        };

        // Hook 1: popstate (covers back/forward + manually-dispatched
        // popstate events that React Router v6 uses).
        const popstateHandler = () => {
          if (typeof window === 'undefined') return;
          const current = window.location.pathname;
          const from = lastFrom;
          lastFrom = current;
          checkAndFire(from, current);
        };
        if (typeof window !== 'undefined') {
          window.addEventListener('popstate', popstateHandler);
          cleanups.push(() => window.removeEventListener('popstate', popstateHandler));
        }

        // Hook 2: history.pushState / replaceState wrap. React Router and
        // every other client-side router calls one of these to mutate
        // location.pathname; the native methods don't dispatch events, so we
        // wrap them with a synchronous tap that fires the matcher. Restores
        // the originals on cleanup.
        if (typeof window !== 'undefined' && window.history) {
          const origPush = window.history.pushState.bind(window.history);
          const origReplace = window.history.replaceState.bind(window.history);

          window.history.pushState = (
            data: unknown,
            unused: string,
            url?: string | URL | null
          ) => {
            const from = window.location.pathname;
            origPush(data as never, unused, url as never);
            const to = window.location.pathname;
            lastFrom = to;
            checkAndFire(from, to);
          };
          window.history.replaceState = (
            data: unknown,
            unused: string,
            url?: string | URL | null
          ) => {
            const from = window.location.pathname;
            origReplace(data as never, unused, url as never);
            const to = window.location.pathname;
            lastFrom = to;
            checkAndFire(from, to);
          };

          cleanups.push(() => {
            window.history.pushState = origPush;
            window.history.replaceState = origReplace;
          });
        }

        // Timeout. Mirror the server-side shape: `{reason: 'timeout',
        // lastKnownRoute, elapsedMs}`.
        const timer = setTimeout(() => {
          done({
            reason: 'timeout',
            lastKnownRoute: lastTo ?? lastFrom,
            elapsedMs: Date.now() - started,
          });
        }, timeoutMs);
        cleanups.push(() => clearTimeout(timer));
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
      // Build a minimal snapshot shaped to fit `SnapshotBookmarkEntry`. The
      // browser dispatcher doesn't have full `SemanticSnapshot` data
      // (no diff manager / page context), so we cast through the loose
      // contract. The store treats the snapshot as opaque and only the
      // diff endpoints actually inspect its structure.
      const snapshot = {
        timestamp: Date.now(),
        elements: elements.map(elementToSnapshot),
      } as unknown as SemanticSnapshot;
      const savedAt = Date.now();
      getGlobalBookmarkStore().save({ name, snapshot, savedAt });
      return { success: true, name, timestamp: savedAt, savedAt };
    }

    case 'getBookmark': {
      const bm = getGlobalBookmarkStore().get(payload.name as string);
      if (!bm) return { success: false, error: `Bookmark '${payload.name}' not found` };
      // Preserve the legacy `timestamp` alias for callers that haven't
      // migrated to `savedAt` yet.
      return { name: bm.name, snapshot: bm.snapshot, savedAt: bm.savedAt, timestamp: bm.savedAt };
    }

    case 'deleteBookmark': {
      const deleted = getGlobalBookmarkStore().delete(payload.name as string);
      return { success: deleted, name: payload.name, timestamp: Date.now() };
    }

    case 'listBookmarks':
      return {
        bookmarks: getGlobalBookmarkStore()
          .list()
          .map((b) => ({ name: b.name, savedAt: b.savedAt, timestamp: b.savedAt })),
        timestamp: Date.now(),
      };

    case 'diffFromBookmark': {
      const bm = getGlobalBookmarkStore().get(payload.name as string);
      if (!bm) return { success: false, error: `Bookmark '${payload.name}' not found` };
      const current = elements.map(elementToSnapshot);
      const prev = (bm.snapshot as unknown as { elements: unknown[] }).elements ?? [];
      return {
        bookmarkTimestamp: bm.savedAt,
        currentTimestamp: Date.now(),
        beforeCount: (prev as unknown[]).length,
        afterCount: current.length,
      };
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
      if (!bridge.registry?.activateState)
        return { success: false, error: 'State management not available' };
      try {
        bridge.registry.activateState(payload.id as string);
        return { success: true, id: payload.id, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    case 'deactivateState': {
      if (!bridge.registry?.deactivateState)
        return { success: false, error: 'State management not available' };
      try {
        bridge.registry.deactivateState(payload.id as string);
        return { success: true, id: payload.id, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    case 'getStateGroups':
      return bridge.registry?.getAllStateGroups?.() ?? [];

    case 'activateStateGroup': {
      if (!bridge.registry?.activateStateGroup)
        return { success: false, error: 'State groups not available' };
      try {
        bridge.registry.activateStateGroup(payload.id as string);
        return { success: true, id: payload.id, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    case 'deactivateStateGroup': {
      if (!bridge.registry?.deactivateStateGroup)
        return { success: false, error: 'State groups not available' };
      try {
        bridge.registry.deactivateStateGroup(payload.id as string);
        return { success: true, id: payload.id, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    case 'getTransitions':
      return bridge.registry?.getAllTransitions?.() ?? [];

    case 'canExecuteTransition': {
      if (!bridge.registry?.canExecuteTransition)
        return { canExecute: false, error: 'Transitions not available' };
      try {
        const canExec = bridge.registry.canExecuteTransition(payload.id as string);
        return { canExecute: canExec, transitionId: payload.id, timestamp: Date.now() };
      } catch (err) {
        return { canExecute: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    case 'executeTransition': {
      if (!bridge.registry?.executeTransition)
        return { success: false, error: 'Transitions not available', timestamp: Date.now() };
      try {
        const result = await bridge.registry.executeTransition(payload.id as string);
        return { success: true, result, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    case 'findPath': {
      if (!bridge.registry?.findPath)
        return {
          path: [],
          found: false,
          error: 'Pathfinding not available',
          timestamp: Date.now(),
        };
      const { targetStates } = payload as { targetStates: string[] };
      try {
        return bridge.registry.findPath(targetStates);
      } catch (err) {
        return { path: [], found: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    case 'navigateTo': {
      if (!bridge.registry?.navigateTo)
        return { success: false, error: 'Navigation not available', timestamp: Date.now() };
      const { targetStates } = payload as { targetStates: string[] };
      try {
        return await bridge.registry.navigateTo(targetStates);
      } catch (err) {
        return { success: false, error: (err as Error).message, timestamp: Date.now() };
      }
    }

    case 'getStateSnapshot':
      return (
        bridge.registry?.getStateSnapshot?.() ?? {
          timestamp: Date.now(),
          activeStates: [],
          states: [],
          groups: [],
          transitions: [],
        }
      );

    // ======================================================================
    // Intent System
    // ======================================================================

    case 'listIntents': {
      const intents = getIntentStore();
      return Array.from(intents.values());
    }

    case 'executeIntent':
    case 'executeIntentFromQuery':
      return {
        success: false,
        error: 'Intent execution not available without app-level intent registration',
        timestamp: Date.now(),
      };

    case 'findIntent': {
      const intents = getIntentStore();
      const query = ((payload as { query?: string }).query ?? '').toLowerCase();
      const matches = Array.from(intents.values()).filter((i) => {
        const intent = i as { name?: string; description?: string };
        return (
          (intent.name ?? '').toLowerCase().includes(query) ||
          (intent.description ?? '').toLowerCase().includes(query)
        );
      });
      return { results: matches, timestamp: Date.now() };
    }

    case 'registerIntent': {
      const intents = getIntentStore();
      const intent = payload as { id: string; [k: string]: unknown };
      intents.set(intent.id, intent);
      return { success: true, id: intent.id, timestamp: Date.now() };
    }

    case 'deleteIntent': {
      const intents = getIntentStore();
      const { name } = payload as { name: string };
      let found = false;
      for (const [id, intent] of intents.entries()) {
        const i = intent as { name?: string };
        if (i.name === name || id === name) {
          intents.delete(id);
          found = true;
          break;
        }
      }
      return { deleted: found };
    }

    // ======================================================================
    // Recovery
    // ======================================================================

    case 'attemptRecovery':
      return {
        success: false,
        error: 'Recovery not implemented for generic relay',
        suggestions: getRecoverySuggestions('UNKNOWN_ERROR'),
        timestamp: Date.now(),
      };

    // ======================================================================
    // Cross-App Analysis
    // ======================================================================

    case 'analyzePageData': {
      const tables: unknown[] = [];
      document.querySelectorAll('table').forEach((t) => {
        // §4.6: table cell text is DOM content — scrub each against its cell so
        // a cell inside a data-bridge-redact boundary ships REDACTED_VALUE.
        const headers = Array.from(t.querySelectorAll('th')).map((h) => readScrubbedText(h));
        const rows = Array.from(t.querySelectorAll('tbody tr')).map((r) =>
          Array.from(r.querySelectorAll('td')).map((c) => readScrubbedText(c))
        );
        tables.push({ headers, rowCount: rows.length, rows: rows.slice(0, 10) });
      });
      const forms = Array.from(document.querySelectorAll('form')).map((f) => ({
        id: f.id,
        action: f.action,
        method: f.method,
        // §4.6 VALUE axis: `input.value` here was the live pre-existing HIGH
        // leak — it shipped password fields and boundary values in cleartext.
        // The reader-minter redacts password/boundary values to the sentinel.
        fields: Array.from(f.querySelectorAll('input, select, textarea')).map((i) => ({
          name: (i as HTMLInputElement).name,
          type: (i as HTMLInputElement).type,
          value: readScrubbedValue(i as HTMLInputElement) ?? '',
        })),
      }));
      return {
        url: window.location.href,
        title: document.title,
        tables,
        forms,
        timestamp: Date.now(),
      };
    }

    case 'analyzePageRegions': {
      const regions: Array<{ role: string; tag: string; text: string }> = [];
      const landmarkRoles = [
        'banner',
        'navigation',
        'main',
        'complementary',
        'contentinfo',
        'search',
        'form',
      ];
      for (const role of landmarkRoles) {
        document.querySelectorAll(`[role="${role}"]`).forEach((el) => {
          regions.push({
            role,
            tag: el.tagName.toLowerCase(),
            text: readScrubbedText(el, undefined, { maxLen: 100 }) ?? '',
          });
        });
      }
      // Also check semantic HTML
      const semanticMap: Record<string, string> = {
        header: 'banner',
        nav: 'navigation',
        main: 'main',
        aside: 'complementary',
        footer: 'contentinfo',
      };
      for (const [tag, role] of Object.entries(semanticMap)) {
        document.querySelectorAll(tag).forEach((el) => {
          if (!el.getAttribute('role'))
            regions.push({ role, tag, text: readScrubbedText(el, undefined, { maxLen: 100 }) ?? '' });
        });
      }
      return { regions, timestamp: Date.now() };
    }

    case 'analyzeStructuredData': {
      const tables: unknown[] = [];
      document.querySelectorAll('table').forEach((t) => {
        // §4.6: scrub each cell against its boundary (see analyzePageData).
        const headers = Array.from(t.querySelectorAll('th')).map((h) => readScrubbedText(h));
        const rows = Array.from(t.querySelectorAll('tbody tr')).map((r) =>
          Array.from(r.querySelectorAll('td')).map((c) => readScrubbedText(c))
        );
        tables.push({ headers, rowCount: rows.length, rows: rows.slice(0, 20) });
      });
      const lists = Array.from(document.querySelectorAll('ul, ol'))
        .slice(0, 10)
        .map((l) => ({
          type: l.tagName.toLowerCase(),
          items: Array.from(l.querySelectorAll(':scope > li')).map(
            (li) => readScrubbedText(li, undefined, { maxLen: 100 }) ?? ''
          ),
        }));
      return { tables, lists, timestamp: Date.now() };
    }

    case 'crossAppCompare':
      return {
        comparison: 'Cross-app comparison requires snapshots from both apps',
        timestamp: Date.now(),
      };

    // ======================================================================
    // Page Navigation
    // ======================================================================

    case 'pageRefresh':
      window.location.reload();
      return { success: true, timestamp: Date.now() };

    case 'pageNavigate': {
      // F1: accept an optional `mode` field ("hard" | "soft") in addition to
      // the legacy `hard` boolean. Back-compat: omitted `mode` + omitted `hard`
      // = default ("hard" behaviour with registered navigate-handler override).
      // `mode: "soft"` forces a `history.pushState` + synthetic `popstate`
      // navigation that preserves injected window state.
      const {
        url,
        hard,
        mode: rawMode,
      } = payload as {
        url: string;
        hard?: boolean;
        mode?: string;
      };
      if (rawMode !== undefined && rawMode !== 'hard' && rawMode !== 'soft') {
        return {
          success: false,
          error: `invalid mode: "${rawMode}" (expected "hard" or "soft")`,
          timestamp: Date.now(),
        };
      }
      // Reject dangerous URL protocols that can execute JS or break the SSE relay.
      // Only allow http:, https:, and relative paths starting with "/".
      try {
        const parsed = new URL(url, window.location.origin);
        const dangerousProtocols = ['javascript:', 'data:', 'blob:', 'vbscript:'];
        if (dangerousProtocols.includes(parsed.protocol)) {
          return {
            success: false,
            error: `Dangerous URL protocol rejected: "${parsed.protocol}". Only http, https, and relative paths are allowed.`,
            timestamp: Date.now(),
          };
        }
        if (!['http:', 'https:'].includes(parsed.protocol) && !url.startsWith('/')) {
          return {
            success: false,
            error: `Invalid URL protocol "${parsed.protocol}". Only http, https, and relative paths are allowed.`,
            timestamp: Date.now(),
          };
        }
      } catch {
        // URL failed to parse — only allow if it looks like a relative path
        if (!url.startsWith('/')) {
          return {
            success: false,
            error:
              'Invalid URL format. Only http, https, and relative paths starting with "/" are allowed.',
            timestamp: Date.now(),
          };
        }
      }

      // Soft mode: pure client-side navigation via pushState + synthetic
      // popstate. React Router v6 subscribes to popstate by default, so this
      // drives the router without destroying window state (fetch patches,
      // spies, `window.__*` globals).
      if (rawMode === 'soft') {
        let pathname = url;
        try {
          const target = new URL(url, window.location.origin);
          if (target.origin === window.location.origin) {
            pathname = target.pathname + target.search + target.hash;
          }
        } catch {
          // Relative URL — use as-is.
        }
        const softBridge = getBridge();
        if (softBridge.navigateHandler) {
          try {
            softBridge.navigateHandler(pathname);
          } catch {
            window.history.pushState(null, '', pathname);
            try {
              window.dispatchEvent(new PopStateEvent('popstate'));
            } catch {
              window.dispatchEvent(new Event('popstate'));
            }
          }
        } else {
          window.history.pushState(null, '', pathname);
          try {
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch {
            window.dispatchEvent(new Event('popstate'));
          }
        }
        window.dispatchEvent(
          new CustomEvent('ui-bridge:navigate', { detail: { url: pathname, mode: 'soft' } })
        );
        return {
          success: true,
          url: pathname,
          hard: false,
          mode: 'soft',
          clientSideNavigation: true,
          timestamp: Date.now(),
        };
      }

      const g = getBridge();
      // Use client-side navigation for same-origin URLs when a handler is
      // registered (e.g., Next.js router.push). This avoids destroying the
      // SSE/WebSocket connection. Callers that need a full, SDK-reinitialising
      // reload (e.g. automation capture loops hitting pages that unmount the
      // UI Bridge provider tree) can pass `hard: true` to bypass the handler.
      if (!hard) {
        try {
          const target = new URL(url, window.location.origin);
          if (target.origin === window.location.origin && g.navigateHandler) {
            g.navigateHandler(target.pathname + target.search + target.hash);
            return {
              success: true,
              url: target.pathname,
              clientSideNavigation: true,
              hard: false,
              mode: 'hard',
              timestamp: Date.now(),
            };
          }
        } catch {
          // Invalid URL — fall through to hard navigation
        }
      }
      window.location.href = url;
      return { success: true, url, hard: true, mode: 'hard', timestamp: Date.now() };
    }

    case 'pageGoBack':
      window.history.back();
      return { success: true, timestamp: Date.now() };

    case 'pageGoForward':
      window.history.forward();
      return { success: true, timestamp: Date.now() };

    case 'pageEvaluate': {
      const evalExpr = (payload as { expression?: string })?.expression;
      if (!evalExpr) {
        return { success: false, error: 'expression is required', timestamp: Date.now() };
      }
      try {
        const evalResult = await Promise.resolve(eval(evalExpr));
        // Ensure the result is JSON-serializable (eval can return DOM nodes, functions, etc.)
        let safeValue: unknown;
        try {
          safeValue = JSON.parse(JSON.stringify(evalResult));
        } catch {
          safeValue =
            typeof evalResult === 'undefined'
              ? undefined
              : typeof evalResult === 'function'
                ? `[Function: ${evalResult.name || 'anonymous'}]`
                : String(evalResult);
        }
        return { success: true, result: { value: safeValue }, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        };
      }
    }

    case 'pageScroll': {
      const scrollReq = payload as { top?: number; left?: number; smooth?: boolean };
      const bX = window.scrollX;
      const bY = window.scrollY;
      const useSmooth = !!scrollReq?.smooth;
      window.scrollBy({
        top: scrollReq?.top ?? 0,
        left: scrollReq?.left ?? 0,
        behavior: useSmooth ? 'smooth' : 'auto',
      });
      // For smooth scrolling, wait for scrollend event before reading final position
      if (useSmooth) {
        await new Promise<void>((resolve) => {
          const onEnd = () => {
            window.removeEventListener('scrollend', onEnd);
            resolve();
          };
          window.addEventListener('scrollend', onEnd, { once: true });
          // Fallback timeout in case scrollend doesn't fire (e.g., already at boundary)
          setTimeout(onEnd, 500);
        });
      }
      return {
        success: true,
        before: { scrollX: bX, scrollY: bY },
        after: { scrollX: window.scrollX, scrollY: window.scrollY },
        changed: window.scrollX !== bX || window.scrollY !== bY,
        timestamp: Date.now(),
      };
    }

    case 'clipboardWrite': {
      const clipText = (payload as { text?: string })?.text ?? '';
      const clipHtml = (payload as { html?: string })?.html;

      // Strategy 1: execCommand with hidden textarea (most reliable, no gesture needed)
      try {
        const ta = document.createElement('textarea');
        ta.value = clipText;
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const execResult = document.execCommand('copy');
        document.body.removeChild(ta);
        if (execResult) {
          return {
            success: true,
            written: true,
            method: 'execCommand',
            formats: ['text/plain'],
            timestamp: Date.now(),
          };
        }
      } catch {
        // execCommand failed, try next strategy
      }

      // Strategy 2: Clipboard API (requires user gesture or permissions)
      try {
        if (clipHtml) {
          const blob = new Blob([clipHtml], { type: 'text/html' });
          const textBlob = new Blob([clipText], { type: 'text/plain' });
          await navigator.clipboard.write([
            new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob }),
          ]);
        } else {
          await navigator.clipboard.writeText(clipText);
        }
        return {
          success: true,
          written: true,
          method: 'clipboardAPI',
          formats: clipHtml ? ['text/html', 'text/plain'] : ['text/plain'],
          timestamp: Date.now(),
        };
      } catch {
        // Clipboard API also failed
      }

      // Strategy 3: Gesture-wrapped Clipboard API
      try {
        const written = await new Promise<boolean>((resolve) => {
          const btn = document.createElement('button');
          btn.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01';
          btn.textContent = '.';
          document.body.appendChild(btn);
          btn.addEventListener('click', () => {
            navigator.clipboard.writeText(clipText).then(
              () => {
                try {
                  document.body.removeChild(btn);
                } catch {
                  /* element may already be removed */
                }
                resolve(true);
              },
              () => {
                try {
                  document.body.removeChild(btn);
                } catch {
                  /* element may already be removed */
                }
                resolve(false);
              }
            );
          });
          btn.focus();
          btn.click();
          // Timeout fallback
          setTimeout(() => {
            try {
              document.body.removeChild(btn);
            } catch {
              /* element may already be removed */
            }
            resolve(false);
          }, 500);
        });
        if (written) {
          return {
            success: true,
            written: true,
            method: 'gestureClick',
            formats: ['text/plain'],
            timestamp: Date.now(),
          };
        }
      } catch {
        // All strategies exhausted
      }

      return {
        success: false,
        error: 'Clipboard write denied by all strategies (execCommand, Clipboard API, gesture)',
        timestamp: Date.now(),
      };
    }

    case 'clipboardRead': {
      // Strategy 1: Clipboard API
      try {
        const readText = await navigator.clipboard.readText();
        return {
          success: true,
          text: readText,
          method: 'clipboardAPI',
          formats: ['text/plain'],
          timestamp: Date.now(),
        };
      } catch {
        // Clipboard API denied
      }

      // Strategy 2: execCommand paste (very limited browser support)
      try {
        const ta = document.createElement('textarea');
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01';
        document.body.appendChild(ta);
        ta.focus();
        const execResult = document.execCommand('paste');
        // Temp off-DOM textarea (no boundary/password) — reader passes it through.
        const pastedText = readScrubbedValue(ta) ?? '';
        document.body.removeChild(ta);
        if (execResult && pastedText) {
          return {
            success: true,
            text: pastedText,
            method: 'execCommand',
            formats: ['text/plain'],
            timestamp: Date.now(),
          };
        }
      } catch {
        // execCommand also failed
      }

      return {
        success: false,
        error:
          'Clipboard read denied. The browser tab must be focused and have clipboard permission.',
        timestamp: Date.now(),
      };
    }

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
      (store as unknown as { set: (id: string, ann: unknown) => void }).set(
        payload.id as string,
        payload.annotation
      );
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
      const allElementIds = elements.map((el: { id: string }) => el.id);
      return (store as unknown as { getCoverage: (ids: string[]) => unknown }).getCoverage(
        allElementIds
      );
    }

    // ======================================================================
    // Performance & Browser Events
    // ======================================================================

    case 'getPerformanceEntries': {
      const entries = performance
        .getEntriesByType('navigation')
        .concat(performance.getEntriesByType('resource').slice(-50))
        .concat(performance.getEntriesByType('measure'));
      return {
        entries: entries.map((e) => ({
          name: e.name,
          entryType: e.entryType,
          startTime: e.startTime,
          duration: e.duration,
        })),
        timestamp: Date.now(),
      };
    }

    case 'clearPerformanceEntries':
      performance.clearResourceTimings();
      performance.clearMeasures();
      performance.clearMarks();
      return { success: true, timestamp: Date.now() };

    case 'getBrowserEvents': {
      const {
        type,
        since,
        limit = 100,
      } = payload as { type?: string; since?: number; limit?: number };
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
    // Render Log
    // ======================================================================

    case 'getRenderLog': {
      const entries = g.renderLog?.getEntries?.() ?? bridge?.getRenderLogEntries?.() ?? [];
      const resolvedEntries = entries instanceof Promise ? await entries : entries;
      const {
        type: filterType,
        since,
        limit,
      } = payload as { type?: string; since?: number; limit?: number };
      let results = [...(resolvedEntries as Array<{ type?: string; timestamp: number }>)];
      if (filterType) results = results.filter((e) => e.type === filterType);
      if (since) results = results.filter((e) => e.timestamp >= since);
      if (limit) results = results.slice(-limit);
      return { count: results.length, entries: results };
    }

    case 'clearRenderLog': {
      const clearFn = bridge?.clearRenderLog;
      if (clearFn) {
        const result = clearFn();
        if (result instanceof Promise) await result;
      }
      return { success: true, timestamp: Date.now() };
    }

    // ======================================================================
    // Console Errors
    // ======================================================================

    case 'getConsoleErrors': {
      const {
        limit = 50,
        since,
        group = false,
        groupBy = 'fingerprint',
      } = payload as {
        limit?: number;
        since?: number;
        group?: boolean;
        groupBy?: 'fingerprint' | 'message' | 'source';
      };
      const cap = g.browserCapture;
      if (!cap) {
        if (group) {
          return { groups: [], totalErrors: 0, totalGroups: 0, timestamp: Date.now() };
        }
        return { errors: [], timestamp: Date.now() };
      }
      const errors = since ? cap.getConsoleSince(since) : cap.getConsoleRecent(limit);

      if (!group) {
        return { errors: errors.slice(0, limit), timestamp: Date.now() };
      }

      // Grouped mode: aggregate errors by the chosen groupBy strategy
      const rawEvents = (
        since
          ? cap.getSince(since).filter((e: unknown) => {
              const ev = e as AnyCapturedEvent;
              return ev.type === 'console' || ev.type === 'hmr';
            })
          : cap.getRecent(limit * 10).filter((e: unknown) => {
              const ev = e as AnyCapturedEvent;
              return ev.type === 'console' || ev.type === 'hmr';
            })
      ) as AnyCapturedEvent[];

      const groupMap = new Map<
        string,
        {
          fingerprint: string;
          count: number;
          firstSeen: number;
          lastSeen: number;
          level: string;
          message: string;
          source: string | undefined;
          sample: unknown;
        }
      >();
      const insertionOrder: string[] = [];

      for (const event of rawEvents) {
        let key: string;
        if (groupBy === 'message') {
          key = `msg:${(event as { message?: string }).message ?? ''}`;
        } else if (groupBy === 'source') {
          key = `src:${extractSourceLocation(getEventStack(event)) ?? 'unknown'}`;
        } else {
          key = computeFingerprint(event);
        }

        const existing = groupMap.get(key);
        if (existing) {
          existing.count += 1;
          existing.lastSeen = event.timestamp;
        } else {
          const msg = (event as { message?: string }).message ?? '';
          const lvl =
            event.type === 'hmr'
              ? (event as { level: string }).level === 'warning'
                ? 'warn'
                : (event as { level: string }).level
              : (event as { level: string }).level;
          const src = extractSourceLocation(getEventStack(event));
          groupMap.set(key, {
            fingerprint: key,
            count: 1,
            firstSeen: event.timestamp,
            lastSeen: event.timestamp,
            level: lvl,
            message: msg,
            source: src,
            sample: {
              timestamp: event.timestamp,
              level: lvl,
              message: msg,
              stack: (event as { stack?: string }).stack,
            },
          });
          insertionOrder.push(key);
        }
      }

      const groups = insertionOrder.map((k) => groupMap.get(k)!);
      return {
        groups,
        totalErrors: rawEvents.length,
        totalGroups: groups.length,
        timestamp: Date.now(),
      };
    }

    case 'clearConsoleErrors':
      g.browserCapture?.clear();
      return { success: true, timestamp: Date.now() };

    // ======================================================================
    // Network
    // ======================================================================

    case 'getNetworkRequests': {
      installNetworkInterceptor();
      const {
        status,
        method,
        urlPattern,
        failuresOnly,
        since,
        limit = 50,
      } = payload as {
        status?: number;
        method?: string;
        urlPattern?: string;
        failuresOnly?: boolean;
        since?: number;
        limit?: number;
      };
      let filtered = [...networkRequests];
      if (since) filtered = filtered.filter((r) => r.startTime >= since);
      if (status) filtered = filtered.filter((r) => r.status === status);
      if (method)
        filtered = filtered.filter((r) => r.method.toLowerCase() === method.toLowerCase());
      if (urlPattern) {
        if (urlPattern.length > 200 || hasNestedQuantifiers(urlPattern)) {
          filtered = filtered.filter((r) => r.url.includes(urlPattern));
        } else {
          try {
            const re = new RegExp(urlPattern);
            filtered = filtered.filter((r) => re.test(r.url));
          } catch {
            // invalid regex — fall back to substring match
            filtered = filtered.filter((r) => r.url.includes(urlPattern));
          }
        }
      }
      if (failuresOnly) filtered = filtered.filter((r) => r.error || (r.status && r.status >= 400));
      return { requests: filtered.slice(-limit), total: filtered.length, timestamp: Date.now() };
    }

    case 'getNetworkRequestsInFlight': {
      installNetworkInterceptor();
      const inFlight = networkRequests.filter((r) => r.inFlight);
      return { requests: inFlight, count: inFlight.length, timestamp: Date.now() };
    }

    case 'waitForNetworkRequest': {
      installNetworkInterceptor();
      const {
        url: urlMatch,
        method: methodMatch,
        timeout = 10000,
      } = payload as { url?: string; method?: string; timeout?: number };
      const waitStartTime = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          // Only match requests initiated after the wait started
          const match = networkRequests.find(
            (r) =>
              !r.inFlight &&
              r.startTime >= waitStartTime &&
              (!urlMatch || r.url.includes(urlMatch)) &&
              (!methodMatch || r.method.toLowerCase() === methodMatch.toLowerCase())
          );
          if (match) {
            resolve({ request: match, timestamp: Date.now() });
            return true;
          }
          return false;
        };
        const interval = setInterval(() => {
          if (check()) clearInterval(interval);
        }, 200);
        setTimeout(() => {
          clearInterval(interval);
          resolve({ timedOut: true, timestamp: Date.now() });
        }, timeout);
      });
    }

    case 'getNetworkRequest': {
      installNetworkInterceptor();
      const req = networkRequests.find((r) => r.id === (payload.id as string));
      return req ?? { error: `Request ${payload.id} not found` };
    }

    case 'getNetworkChains': {
      const cap = g.browserCapture;
      if (!cap) return { chains: [], timestamp: Date.now() };
      const events = cap.getByType('network');
      return { chains: events.slice(-((payload.limit as number) || 50)), timestamp: Date.now() };
    }

    // ======================================================================
    // F2 — Network Stub Registry
    // Module-level registry lives in `../network/stubs`. Stubs survive F1
    // soft navigations (module state is preserved) and clear on hard reload
    // when the SDK reinitialises.
    // ======================================================================

    case 'registerNetworkStub': {
      const validation = validateStubRequest(payload);
      if (validation) {
        return {
          success: false,
          error: `${validation.field}: ${validation.message}`,
          timestamp: Date.now(),
        };
      }
      // Ensure the interceptor is actually attached so the stub fires.
      installNetworkInterceptor();
      const id = getGlobalStubRegistry().register(payload as unknown as StubRequestSpec);
      return { success: true, id, timestamp: Date.now() };
    }

    case 'listNetworkStubs': {
      return { success: true, stubs: getGlobalStubRegistry().list(), timestamp: Date.now() };
    }

    case 'deleteNetworkStub': {
      const { id } = payload as { id?: string };
      if (typeof id !== 'string' || id.length === 0) {
        return { success: false, error: 'id is required', timestamp: Date.now() };
      }
      const removed = getGlobalStubRegistry().delete(id);
      return removed
        ? { success: true, timestamp: Date.now() }
        : {
            success: false,
            error: `stub ${id} not found`,
            code: 'NOT_FOUND',
            timestamp: Date.now(),
          };
    }

    case 'clearNetworkStubs': {
      const cleared = getGlobalStubRegistry().clear();
      return { success: true, cleared, timestamp: Date.now() };
    }

    // ======================================================================
    // N3 — Non-consuming stub verification
    // Returns what `match()` WOULD return for the given url+method pair
    // without decrementing `times: 1` stubs or bumping `hitCount`. Lets
    // tests assert "this stub is still armed" cheaply, and lets them read
    // the hypothetical response body without going through `page/evaluate`.
    // ======================================================================

    case 'verifyNetworkStub': {
      const { urlPattern, method } = payload as { urlPattern?: unknown; method?: unknown };
      if (typeof urlPattern !== 'string' || urlPattern.length === 0) {
        return {
          success: false,
          error: 'urlPattern: urlPattern must be a non-empty string',
          timestamp: Date.now(),
        };
      }
      const methodStr =
        typeof method === 'string' && method.length > 0 ? method.toUpperCase() : '*';

      const registry = getGlobalStubRegistry();
      const hit = registry.peek(urlPattern, methodStr);
      if (!hit) {
        return {
          success: true,
          data: {
            matched: false,
            stubId: null,
            response: null,
            stubEntry: null,
          },
          timestamp: Date.now(),
        };
      }
      const entry = registry.peekEntry(urlPattern, methodStr);
      const resp = hit.buildResponse();
      // Extract headers without consuming the Response stream; peek() returned
      // a freshly-built Response instance, so reading it here is safe.
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const body = await resp.text();

      return {
        success: true,
        data: {
          matched: true,
          stubId: hit.id,
          response: {
            status: resp.status,
            headers,
            body,
          },
          stubEntry: entry,
        },
        timestamp: Date.now(),
      };
    }

    // ======================================================================
    // Error Sessions
    // ======================================================================

    case 'startErrorSession': {
      const { label } = payload as { label?: string };
      currentErrorSession = {
        id: `session-${Date.now()}`,
        label,
        startTime: Date.now(),
        errors: [],
      };
      // Capture current errors as starting point
      const cap = g.browserCapture;
      if (cap) currentErrorSession.errors = [...cap.getConsoleRecent(100)] as unknown[];
      return {
        sessionId: currentErrorSession.id,
        startTime: currentErrorSession.startTime,
        timestamp: Date.now(),
      };
    }

    case 'endErrorSession': {
      if (!currentErrorSession) return { success: false, error: 'No active error session' };
      currentErrorSession.endTime = Date.now();
      const cap = g.browserCapture;
      const currentErrors = cap ? cap.getConsoleSince(currentErrorSession.startTime) : [];
      const session = {
        ...currentErrorSession,
        newErrors: currentErrors,
        duration: currentErrorSession.endTime - currentErrorSession.startTime,
      };
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
      if (!label)
        return { success: false, error: 'Missing required "label" field in request body' };
      const baseline = errorBaselines.get(label);
      if (!baseline) return { success: false, error: `Baseline '${label}' not found` };
      const cap = g.browserCapture;
      const current = cap ? cap.getConsoleRecent(200) : [];
      return {
        baseline: { label, errorCount: baseline.errors.length, timestamp: baseline.timestamp },
        current: { errorCount: current.length, timestamp: Date.now() },
        newErrors: current.length - baseline.errors.length,
      };
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
        activeSession: currentErrorSession
          ? {
              id: currentErrorSession.id,
              label: currentErrorSession.label,
              startTime: currentErrorSession.startTime,
            }
          : null,
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
      return {
        id: payload.id,
        styles: getComputedStylesSafe(dom),
        rect: dom.getBoundingClientRect(),
        timestamp: Date.now(),
      };
    }

    case 'getElementStateStyles': {
      const { id, states = ['hover', 'focus', 'active'] } = payload as {
        id: string;
        states?: string[];
      };
      const el = getElement(id);
      if (!el) return { error: `Element ${id} not found` };
      const dom = el.element as HTMLElement;
      const base = getComputedStylesSafe(dom);
      return {
        id,
        baseStyles: base,
        stateStyles: states.reduce<Record<string, string>>((acc, s) => {
          acc[s] = 'Requires interaction';
          return acc;
        }, {}),
        timestamp: Date.now(),
      };
    }

    case 'getDesignSnapshot': {
      const { elementIds } = payload as { elementIds?: string[] };
      const targetEls = elementIds
        ? elements.filter((e) => elementIds.includes(e.id))
        : elements.slice(0, 50);
      const designs = targetEls.map((e) => ({
        id: e.id,
        label: e.label,
        type: e.type,
        styles: getComputedStylesSafe(e.element as HTMLElement),
        rect: (e.element as HTMLElement).getBoundingClientRect(),
      }));
      return { elements: designs, timestamp: Date.now() };
    }

    case 'getResponsiveSnapshots':
      return {
        error: 'Responsive snapshots require server-side viewport manipulation',
        timestamp: Date.now(),
      };

    case 'setViewportConstraints': {
      const { width, restore } = payload as { width?: number; restore?: boolean };
      const docEl = document.documentElement;

      if (restore) {
        docEl.style.removeProperty('width');
        docEl.style.removeProperty('min-width');
        docEl.style.removeProperty('max-width');
        docEl.style.removeProperty('overflow');
      } else if (width) {
        docEl.style.width = `${width}px`;
        docEl.style.minWidth = `${width}px`;
        docEl.style.maxWidth = `${width}px`;
        docEl.style.overflow = 'hidden';
      }
      // Force reflow so subsequent getControlSnapshot sees updated layout
      void docEl.offsetHeight;

      return {
        success: true,
        viewportWidth: window.innerWidth,
        constrainedWidth: width ?? window.innerWidth,
        timestamp: Date.now(),
      };
    }

    case 'runDesignAudit': {
      const issues: Array<{ element: string; issue: string; severity: string; fix?: string }> = [];
      elements.slice(0, 100).forEach((e) => {
        const dom = e.element as HTMLElement;
        const cs = getComputedStyle(dom);
        // Check contrast using WCAG 2.1 contrast ratio
        const textColor = cs.color;
        const bgColor = cs.backgroundColor;
        if (
          textColor &&
          bgColor &&
          textColor !== 'rgba(0, 0, 0, 0)' &&
          bgColor !== 'rgba(0, 0, 0, 0)'
        ) {
          const fgLum = parseLuminance(textColor);
          const bgLum = parseLuminance(bgColor);
          if (fgLum >= 0 && bgLum >= 0) {
            const lighter = Math.max(fgLum, bgLum);
            const darker = Math.min(fgLum, bgLum);
            // WCAG contrast ratio: (L1 + 0.05) / (L2 + 0.05)
            const ratio = (lighter + 0.05) / (darker + 0.05);
            if (ratio < NEARLY_INVISIBLE_CONTRAST_THRESHOLD) {
              // Nearly identical colors — text is invisible
              issues.push({
                element: e.id,
                issue: `Text nearly invisible: contrast ratio ${ratio.toFixed(2)}:1 (${textColor} on ${bgColor})`,
                severity: 'error',
                fix: `Add explicit text color with sufficient contrast against ${bgColor}`,
              });
            } else if (ratio < 3.0) {
              // Below WCAG AA for large text
              const fontSize = parseFloat(cs.fontSize);
              issues.push({
                element: e.id,
                issue: `Low contrast: ${ratio.toFixed(2)}:1 (${textColor} on ${bgColor}) — fails WCAG AA${fontSize >= 18 ? ' for large text (3:1)' : ' (4.5:1)'}`,
                severity: 'warning',
                fix: `Increase contrast to at least ${fontSize >= 18 ? '3:1' : '4.5:1'} for WCAG AA compliance`,
              });
            } else if (ratio < 4.5) {
              // Passes large text AA but fails normal text AA
              const fontSize = parseFloat(cs.fontSize);
              if (fontSize < 18) {
                issues.push({
                  element: e.id,
                  issue: `Insufficient contrast for normal text: ${ratio.toFixed(2)}:1 (${textColor} on ${bgColor}) — WCAG AA requires 4.5:1`,
                  severity: 'info',
                  fix: `Increase contrast to 4.5:1, or increase font size to 18px+`,
                });
              }
            }
          }
        }
        // Check select elements for dark-mode dropdown visibility issues
        if (dom.tagName === 'SELECT') {
          const scheme = cs.colorScheme || '';
          const isDarkBg = isLikelyDarkColor(bgColor);
          const hasLightText = isLikelyLightColor(textColor);
          if (isDarkBg && hasLightText && !scheme.includes('dark')) {
            issues.push({
              element: e.id,
              issue: `Select has light text (${textColor}) on dark bg (${bgColor}) without color-scheme:dark — native <option> dropdowns may be invisible`,
              severity: 'warning',
              fix: `Add style={{ colorScheme: "dark" }} to the <select> element and set option colors explicitly: [&>option]:text-black [&>option]:bg-white`,
            });
          }
          // Check if options explicitly have styling
          const firstOption = dom.querySelector('option');
          if (firstOption) {
            const optCs = getComputedStyle(firstOption);
            const optFgLum = parseLuminance(optCs.color || '');
            const optBgLum = parseLuminance(optCs.backgroundColor || '');
            if (optFgLum >= 0 && optBgLum >= 0) {
              const optLighter = Math.max(optFgLum, optBgLum);
              const optDarker = Math.min(optFgLum, optBgLum);
              const optRatio = (optLighter + 0.05) / (optDarker + 0.05);
              if (optRatio < 3.0) {
                issues.push({
                  element: e.id,
                  issue: `Select option text has low contrast: ${optRatio.toFixed(2)}:1 (${optCs.color} on ${optCs.backgroundColor})`,
                  severity: 'error',
                  fix: `Add explicit option colors: select option { color: #000; background-color: #fff; } or use [&>option]:text-black [&>option]:bg-white`,
                });
              }
            }
          }
        }
        // Check font size
        if (parseFloat(cs.fontSize) < 12) {
          issues.push({
            element: e.id,
            issue: `Font size too small: ${cs.fontSize}`,
            severity: 'info',
          });
        }
        // Check interactive element size
        if (e.type === 'button' || e.type === 'link') {
          const rect = dom.getBoundingClientRect();
          if (rect.width < 44 || rect.height < 44) {
            issues.push({
              element: e.id,
              issue: `Touch target too small: ${Math.round(rect.width)}x${Math.round(rect.height)}px (min 44x44)`,
              severity: 'warning',
            });
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
      const withLabels = elements.filter((e) => e.label).length;
      const withActions = elements.filter((e) => e.actions && e.actions.length > 0).length;
      const visibleCount = elements.filter((e) => {
        const dom = e.element as HTMLElement;
        return dom.offsetParent !== null;
      }).length;
      return {
        score:
          total > 0
            ? Math.round(
                (withLabels / total) * 50 + (withActions / total) * 30 + (visibleCount / total) * 20
              )
            : 0,
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
      const snapshot = elements.map((e) => ({
        id: e.id,
        label: e.label,
        type: e.type,
        state: e.getState(),
      }));
      qualityBaselines.set('__quality_baseline__', {
        timestamp: Date.now(),
        snapshot,
      });
      return { success: true, elementCount: snapshot.length, timestamp: Date.now() };
    }

    case 'diffBaseline': {
      const baseline = qualityBaselines.get('__quality_baseline__');
      if (!baseline) return { success: false, error: 'No baseline saved' };
      return {
        baselineTimestamp: baseline.timestamp,
        currentElements: elements.length,
        baselineElements: ((baseline.snapshot as unknown[]) ?? []).length,
        timestamp: Date.now(),
      };
    }

    // ======================================================================
    // Forms
    // ======================================================================

    case 'getForms': {
      const forms = Array.from(document.querySelectorAll('form')).map((f, i) => ({
        id: f.id || `form-${i}`,
        action: f.action,
        method: f.method,
        fields: Array.from(f.querySelectorAll('input, select, textarea')).map((inp) => {
          const el = inp as HTMLInputElement;
          // §4.6: this relay `getForms` walks the raw DOM (NOT deduped with the
          // server handler — `find`/`getForms` genuinely diverge) and read
          // `el.value` ungated. Gate the value (VALUE axis — password/boundary)
          // and the name (CONTENT axis — a boundary hides it).
          return {
            name: isContentRedacted(el) ? REDACTED_VALUE : el.name,
            type: el.type,
            value: readScrubbedValue(el) ?? '',
            required: el.required,
            disabled: el.disabled,
            id: el.id,
          };
        }),
      }));
      return { forms, timestamp: Date.now() };
    }

    case 'fillForm': {
      const { formId, fields } = payload as { formId?: string; fields: Record<string, string> };
      const form = formId
        ? (document.getElementById(formId) as HTMLFormElement)
        : document.querySelector('form');
      if (!form) return { success: false, error: 'Form not found' };
      const filled: string[] = [];
      for (const [name, value] of Object.entries(fields)) {
        const field = form.querySelector(`[name="${name}"]`) as HTMLInputElement;
        if (field) {
          const proto =
            field instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(field, value);
          else field.value = value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push(name);
        }
      }
      return {
        success: true,
        filledFields: filled,
        totalFields: Object.keys(fields).length,
        timestamp: Date.now(),
      };
    }

    case 'snapshotForms': {
      const forms = Array.from(document.querySelectorAll('form')).map((f, i) => ({
        id: f.id || `form-${i}`,
        fields: Array.from(f.querySelectorAll('input, select, textarea')).reduce<
          Record<string, unknown>
        >((acc, inp) => {
          const el = inp as HTMLInputElement;
          acc[el.name || el.id || `field-${i}`] = {
            // §4.6 VALUE axis — same leak class as `getForms` above.
            value: readScrubbedValue(el) ?? '',
            checked: el.checked,
            type: el.type,
          };
          return acc;
        }, {}),
      }));
      return { forms, timestamp: Date.now() };
    }

    case 'diffForms': {
      const { before, after } = payload as {
        before: { forms: Array<{ id: string; fields: Record<string, { value: string }> }> };
        after: { forms: Array<{ id: string; fields: Record<string, { value: string }> }> };
      };
      const changes: Array<{ formId: string; field: string; before: unknown; after: unknown }> = [];
      if (before?.forms && after?.forms) {
        for (const bf of before.forms) {
          const af = after.forms.find((f) => f.id === bf.id);
          if (!af) continue;
          for (const [name, bv] of Object.entries(bf.fields)) {
            const av = af.fields[name];
            if (av && bv.value !== av.value)
              changes.push({ formId: bf.id, field: name, before: bv.value, after: av.value });
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
          await navigator.clipboard.write([
            new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob }),
          ]);
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
      return (
        g.undoTracker?.getState() ?? {
          canUndo: false,
          canRedo: false,
          undoStack: [],
          redoStack: [],
        }
      );

    case 'executeUndo': {
      // Try keyboard shortcut as undo trigger
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })
      );
      return { success: true, method: 'keyboard', timestamp: Date.now() };
    }

    case 'executeRedo': {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true })
      );
      return { success: true, method: 'keyboard', timestamp: Date.now() };
    }

    // ======================================================================
    // Element Image Metadata — removed in Phase 2 of the UI Bridge Vision
    // Pipeline (2026-05-13). The legacy `getElementImages` browser-side
    // command was the DOM-img-scan backing for `/control/get-element-images`;
    // both are gone in favor of the runner-direct `/vision/*` routes.
    // ======================================================================

    // ======================================================================
    // Element Assertion
    // ======================================================================

    case 'assert_element': {
      const { elementId, spec } = payload as {
        elementId: string;
        spec: ElementAssertionSpec;
      };

      const el = getElement(elementId);
      if (!el) {
        return {
          passed: false,
          checked: 0,
          passedCount: 0,
          failures: [],
          error: 'ELEMENT_NOT_FOUND',
          errorMessage: `Element '${elementId}' not found in registry`,
        };
      }

      // Detect stale elements (in registry but detached from DOM)
      if (!el.element.isConnected) {
        return {
          passed: false,
          checked: 0,
          passedCount: 0,
          failures: [],
          error: 'ELEMENT_STALE',
          errorMessage: `Element '${elementId}' exists in registry but is detached from DOM`,
        };
      }

      const state = el.getState();
      const htmlEl = el.element;
      const failures: ElementAssertionFailure[] = [];
      let checked = 0;

      // visible
      if (spec.visible !== undefined) {
        checked++;
        if (state.visible !== spec.visible) {
          failures.push({
            field: 'visible',
            expected: spec.visible,
            actual: state.visible,
            kind: 'exact',
          });
        }
      }

      // enabled
      if (spec.enabled !== undefined) {
        checked++;
        if (state.enabled !== spec.enabled) {
          failures.push({
            field: 'enabled',
            expected: spec.enabled,
            actual: state.enabled,
            kind: 'exact',
          });
        }
      }

      // focused
      if (spec.focused !== undefined) {
        checked++;
        if (state.focused !== spec.focused) {
          failures.push({
            field: 'focused',
            expected: spec.focused,
            actual: state.focused,
            kind: 'exact',
          });
        }
      }

      // text (exact match)
      if (spec.text !== undefined) {
        checked++;
        const actualText = state.textContent ?? readScrubbedText(htmlEl) ?? '';
        if (actualText !== spec.text) {
          failures.push({ field: 'text', expected: spec.text, actual: actualText, kind: 'exact' });
        }
      }

      // textContains (substring)
      if (spec.textContains !== undefined) {
        checked++;
        const actualText = state.textContent ?? readScrubbedText(htmlEl) ?? '';
        if (!actualText.includes(spec.textContains)) {
          failures.push({
            field: 'textContains',
            expected: spec.textContains,
            actual: actualText,
            kind: 'contains',
          });
        }
      }

      // textMatches (regex)
      if (spec.textMatches !== undefined) {
        checked++;
        const actualText = state.textContent ?? readScrubbedText(htmlEl) ?? '';
        // Safety: cap pattern length and check for nested quantifiers to prevent ReDoS
        const rawPattern =
          spec.textMatches.length > 500 ? spec.textMatches.slice(0, 500) : spec.textMatches;
        const pattern = hasNestedQuantifiers(rawPattern)
          ? rawPattern.replace(/[+*?{}]/g, '')
          : rawPattern;
        try {
          const re = new RegExp(pattern);
          if (!re.test(actualText)) {
            failures.push({
              field: 'textMatches',
              expected: spec.textMatches,
              actual: actualText,
              kind: 'regex',
            });
          }
        } catch {
          failures.push({
            field: 'textMatches',
            expected: spec.textMatches,
            actual: 'INVALID_REGEX',
            kind: 'error',
          });
        }
      }

      // value
      if (spec.value !== undefined) {
        checked++;
        const actualValue = state.value ?? '';
        if (actualValue !== spec.value) {
          failures.push({
            field: 'value',
            expected: spec.value,
            actual: actualValue,
            kind: 'exact',
          });
        }
      }

      // checked
      if (spec.checked !== undefined) {
        checked++;
        if (state.checked !== spec.checked) {
          failures.push({
            field: 'checked',
            expected: spec.checked,
            actual: state.checked,
            kind: 'exact',
          });
        }
      }

      // attributes
      if (spec.attributes && htmlEl) {
        for (const [attrName, expectedVal] of Object.entries(spec.attributes)) {
          checked++;
          const actualVal = htmlEl.getAttribute(attrName);
          if (actualVal !== expectedVal) {
            failures.push({
              field: `attributes.${attrName}`,
              expected: expectedVal,
              actual: actualVal,
              kind: 'exact',
            });
          }
        }
      }

      // classList
      if (spec.classList && htmlEl) {
        const classes = Array.from(htmlEl.classList);
        if (spec.classList.has) {
          for (const cls of spec.classList.has) {
            checked++;
            if (!classes.includes(cls)) {
              failures.push({
                field: `classList.has`,
                expected: cls,
                actual: classes.join(' '),
                kind: 'contains',
              });
            }
          }
        }
        if (spec.classList.missing) {
          for (const cls of spec.classList.missing) {
            checked++;
            if (classes.includes(cls)) {
              failures.push({
                field: `classList.missing`,
                expected: `not ${cls}`,
                actual: classes.join(' '),
                kind: 'absent',
              });
            }
          }
        }
      }

      // boundingBox
      if (spec.boundingBox) {
        const bb = spec.boundingBox;
        if (bb.minWidth !== undefined) {
          checked++;
          if (state.rect.width < bb.minWidth) {
            failures.push({
              field: 'boundingBox.minWidth',
              expected: bb.minWidth,
              actual: state.rect.width,
              kind: 'min',
            });
          }
        }
        if (bb.maxWidth !== undefined) {
          checked++;
          if (state.rect.width > bb.maxWidth) {
            failures.push({
              field: 'boundingBox.maxWidth',
              expected: bb.maxWidth,
              actual: state.rect.width,
              kind: 'max',
            });
          }
        }
        if (bb.minHeight !== undefined) {
          checked++;
          if (state.rect.height < bb.minHeight) {
            failures.push({
              field: 'boundingBox.minHeight',
              expected: bb.minHeight,
              actual: state.rect.height,
              kind: 'min',
            });
          }
        }
        if (bb.maxHeight !== undefined) {
          checked++;
          if (state.rect.height > bb.maxHeight) {
            failures.push({
              field: 'boundingBox.maxHeight',
              expected: bb.maxHeight,
              actual: state.rect.height,
              kind: 'max',
            });
          }
        }
      }

      // Build element snapshot for context
      const elementSnapshot = {
        id: el.id,
        visible: state.visible,
        enabled: state.enabled,
        focused: state.focused,
        textContent: state.textContent,
        value: state.value,
        checked: state.checked,
        rect: state.rect,
      };

      const result: ElementAssertionResult = {
        passed: failures.length === 0,
        checked,
        passedCount: checked - failures.length,
        failures,
        elementSnapshot,
      };
      return result;
    }

    // ======================================================================
    // Stable Element References
    // ======================================================================

    case 'resolve_stable_ref': {
      const { stableRef, includeAlternates } = payload as {
        stableRef: StableElementRef;
        includeAlternates?: boolean;
      };
      const resolved = resolveStableRef(stableRef, {
        includeAlternates: includeAlternates === true,
      });
      // `resolution` carries which of the four strategies won and how stable
      // that class of evidence is — an exact registry hit and a semantic-path
      // guess used to be indistinguishable on this channel. Ranked alternates
      // are opt-in per call (`includeAlternates`), never a config setting.
      return {
        resolved: !!resolved,
        elementId: resolved?.element.id ?? null,
        resolution: resolved?.resolution,
        timestamp: Date.now(),
      };
    }

    // ======================================================================
    // Tab management
    // ======================================================================

    case 'tabActivate': {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      return { success: true, focused: document.hasFocus(), timestamp: Date.now() };
    }

    case 'tabClose': {
      try {
        window.close();
      } catch {
        /* ignore — only works for script-opened tabs */
      }
      return { success: true, timestamp: Date.now() };
    }

    // ======================================================================
    // Fallback
    // ======================================================================

    default:
      throw new Error(`Unknown command action: ${action}`);
  }
}
