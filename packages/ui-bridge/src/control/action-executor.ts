/**
 * Action Executor
 *
 * Executes actions on registered elements and components.
 *
 * When @qontinui/ui-bridge-auto is available (optional peer dep), DOM action
 * execution delegates to its canonical perform* functions. This ensures a
 * single source of truth for action semantics across the ecosystem.
 * When ui-bridge-auto is not installed, falls back to inline implementations.
 */

// When @qontinui/ui-bridge-auto is available (optional peer dep), DOM action
// execution delegates to its canonical performAction function.
// Lazy-resolved on first use to avoid top-level import issues.
type PerformActionFn = (
  element: HTMLElement,
  action: string,
  params?: Record<string, unknown>
) => Promise<void>;
let _canonicalPerformAction: PerformActionFn | null | undefined;

function getCanonicalPerformAction(): PerformActionFn | null {
  if (_canonicalPerformAction !== undefined) return _canonicalPerformAction;
  try {
    // Dynamic require — ui-bridge-auto is marked external in tsup, so this
    // resolves at runtime only when the peer dependency is installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@qontinui/ui-bridge-auto') as Record<string, unknown>;
    _canonicalPerformAction =
      typeof mod.performAction === 'function' ? (mod.performAction as PerformActionFn) : null;
  } catch {
    _canonicalPerformAction = null;
  }
  return _canonicalPerformAction;
}

import type { UIBridgeRegistry } from '../core/registry';
import type {
  WaitOptions,
  ElementState,
  StandardAction,
  ActionBrowserEvent,
  ActionErrorDiff,
  FillResult,
  FillFieldResult,
} from '../core/types';
import type { CapturedError, AnyCapturedEvent } from '../debug/browser-capture-types';
import type { BrowserEventCapture } from '../debug/browser-capture';
import { classifyEvent, filterBySeverity } from '../debug/error-severity';
import { computeFingerprint, extractSourceLocation } from '../debug/error-fingerprint';
import { fillSingleField } from './fill-form';
import { ErrorImpactAssessor, type UIStateSnapshot } from '../debug/error-impact';
import type { CompositeIdleDetector } from '../idle/composite-idle';
import { findElementByIdentifier } from '../core/element-identifier';
import { classString } from '../core/class-name';
import { getGlobalCtr } from '../ctr/registry';
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  BatchActionRequest,
  BatchActionResponse,
  BatchActionStepResult,
  WaitResult,
  FindRequest,
  FindResponse,
  DiscoveredElement,
  ControlSnapshot,
  ActionExecutor,
  TypeAction,
  SendKeysAction,
  SelectAction,
  ScrollAction,
  MouseAction,
  DragAction,
  ScrollIntoViewAction,
  FillFormRequest,
  ReactStateInfo,
  ServerBatchOperation,
  ServerBatchOptions,
  ServerBatchResponse,
  ControlBatchStep,
  ControlBatchResponse,
} from './types';

/**
 * Detects regex patterns with nested quantifiers that can cause catastrophic
 * backtracking (ReDoS). Matches constructs like (a+)+, (a*)+, (a+)*, etc.
 */
function hasNestedQuantifiers(pattern: string): boolean {
  // Matches a group containing a quantifier (+, *, {n,}) followed by another quantifier
  return /(\((?:[^()]*[+*}])[^()]*\))[+*?]|\(\?:[^()]*[+*}][^()]*\)[+*?]/.test(pattern);
}

/**
 * Set of supported built-in action names for early validation.
 */
const SUPPORTED_ACTIONS = new Set<string>([
  'click',
  'doubleClick',
  'rightClick',
  'middleClick',
  'type',
  'sendKeys',
  'clear',
  'select',
  'focus',
  'blur',
  'hover',
  'scroll',
  'scrollIntoView',
  'check',
  'uncheck',
  'toggle',
  'drag',
  'setValue',
  'submit',
  'reset',
  'autocomplete',
]);

/**
 * Default wait options
 */
const DEFAULT_WAIT_OPTIONS: Required<WaitOptions> = {
  visible: true,
  enabled: true,
  focused: false,
  state: {},
  timeout: 10000,
  interval: 100,
};

/**
 * Get element state for an HTML element
 */
function getElementState(element: HTMLElement): ElementState {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  const state: ElementState = {
    visible: isVisible(element, rect, style),
    enabled: !isDisabled(element),
    focused: document.activeElement === element,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    },
    computedStyles: {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      cursor: style.cursor,
      color: style.color,
      backgroundColor: style.backgroundColor,
      colorScheme: style.colorScheme,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      position: style.position,
      zIndex: style.zIndex,
      padding: style.padding,
      margin: style.margin,
      borderColor: style.borderColor,
      borderWidth: style.borderWidth,
      borderRadius: style.borderRadius,
    },
  };

  // Normalized 0–1 viewport coordinates for resolution-independent targeting
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw > 0 && vh > 0) {
    state.normalizedRect = {
      x: rect.x / vw,
      y: rect.y / vh,
      width: rect.width / vw,
      height: rect.height / vh,
    };
  }

  // Populate textContent from the element's visible text
  const rawText = element.textContent?.trim();
  if (rawText) {
    // Collapse whitespace and truncate to avoid storing huge text
    state.textContent = rawText.replace(/\s+/g, ' ').slice(0, 500);
  }

  // Fallback for icon-only elements (no textContent but has aria-label/title)
  if (!state.textContent) {
    state.textContent =
      element.getAttribute('aria-label') || element.getAttribute('title') || undefined;
  }

  // Opacity hidden detection
  const opacityVal = parseFloat(style.opacity);
  if (opacityVal === 0) {
    state.opacityHidden = true;
  }

  // ARIA state attributes
  const ariaSelected = element.getAttribute('aria-selected');
  if (ariaSelected !== null) {
    state.ariaSelected = ariaSelected === 'true';
  }
  const ariaPressed = element.getAttribute('aria-pressed');
  if (ariaPressed !== null) {
    state.ariaPressed = ariaPressed === 'mixed' ? 'mixed' : ariaPressed === 'true';
  }
  const ariaCurrent = element.getAttribute('aria-current');
  if (ariaCurrent !== null && ariaCurrent !== 'false') {
    state.ariaCurrent = ariaCurrent;
  }
  const ariaExpanded = element.getAttribute('aria-expanded');
  if (ariaExpanded !== null) {
    state.ariaExpanded = ariaExpanded === 'true';
  }
  // Capture aria-checked for role="switch" and similar toggle elements
  const ariaCheckedAttr = element.getAttribute('aria-checked');
  if (ariaCheckedAttr !== null) {
    state.ariaChecked = ariaCheckedAttr === 'mixed' ? 'mixed' : ariaCheckedAttr === 'true';
    // Also populate checked for switch/checkbox roles so callers get a consistent boolean
    const role = element.getAttribute('role');
    if (
      role === 'switch' ||
      role === 'checkbox' ||
      role === 'menuitemcheckbox' ||
      role === 'menuitemradio' ||
      role === 'radio'
    ) {
      state.checked = ariaCheckedAttr === 'true';
    }
  }

  if (element instanceof HTMLInputElement) {
    state.value = element.value;
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    }
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = element.value;
  } else if (element instanceof HTMLSelectElement) {
    state.value = element.value;
    state.selectedOptions = Array.from(element.selectedOptions).map((opt) => opt.value);
    state.availableOptions = Array.from(element.options).map((opt) => ({
      value: opt.value,
      label: opt.text,
      selected: opt.selected,
    }));
  }

  return state;
}

function isVisible(element: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  // Note: opacity: 0 elements are NOT excluded. They are interactive elements
  // (e.g., close buttons revealed on hover) that should be discoverable.
  // They are marked with opacityHidden: true in getElementState() instead.
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

function isDisabled(element: HTMLElement): boolean {
  if ('disabled' in element && (element as HTMLInputElement).disabled) return true;
  if (element.getAttribute('aria-disabled') === 'true') return true;
  return false;
}

/**
 * Sleep for a duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mouse event relative to an element's bounding rect
 */
function createMouseEvent(type: string, element: HTMLElement, options?: MouseAction): MouseEvent {
  const rect = element.getBoundingClientRect();
  const x = options?.position?.x ?? rect.width / 2;
  const y = options?.position?.y ?? rect.height / 2;

  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    button: options?.button === 'right' ? 2 : options?.button === 'middle' ? 1 : 0,
    clientX: rect.left + x,
    clientY: rect.top + y,
  });
}

/**
 * Safe wrapper around document.elementFromPoint that returns null if unavailable.
 * (elementFromPoint is not implemented in some test environments like jsdom.)
 */
function elementFromPointSafe(x: number, y: number): HTMLElement | null {
  if (typeof document.elementFromPoint === 'function') {
    return document.elementFromPoint(x, y) as HTMLElement | null;
  }
  return null;
}

/**
 * Create a mouse event at absolute client coordinates
 */
function createMouseEventAt(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
}

/**
 * Default action executor implementation
 */
export class DefaultActionExecutor implements ActionExecutor {
  private idleDetector?: CompositeIdleDetector;
  private impactAssessor?: ErrorImpactAssessor;
  /**
   * Cache of DOM elements found during discover/find that aren't in the
   * registry.  Keyed by the deterministic ID returned to the caller so that
   * a subsequent executeAction(id, …) can resolve the same element.
   * Cleared at the start of each find() call so stale references don't
   * accumulate.
   */
  private discoveryCache = new Map<string, HTMLElement>();
  private maxDiscoveryCacheSize: number;

  constructor(
    private registry: UIBridgeRegistry,
    private consoleCapture?: BrowserEventCapture,
    options?: { maxDiscoveryCacheSize?: number }
  ) {
    this.maxDiscoveryCacheSize = options?.maxDiscoveryCacheSize ?? 500;
    // Initialize impact assessor if we're in a browser environment
    if (typeof document !== 'undefined') {
      this.impactAssessor = new ErrorImpactAssessor({
        captureUIState: () => this.captureUIStateSnapshot(),
      });
    }
  }

  /**
   * Set the idle detector for waitAfter support on actions.
   */
  setIdleDetector(detector: CompositeIdleDetector): void {
    this.idleDetector = detector;
  }

  /**
   * Evict oldest entries from the discovery cache when it exceeds the size limit.
   * Map iterates in insertion order, so the first entries are the oldest.
   */
  private evictDiscoveryCache(): void {
    if (this.discoveryCache.size <= this.maxDiscoveryCacheSize) return;
    const excess = this.discoveryCache.size - this.maxDiscoveryCacheSize;
    const iter = this.discoveryCache.keys();
    for (let i = 0; i < excess; i++) {
      const key = iter.next().value;
      if (key !== undefined) this.discoveryCache.delete(key);
    }
  }

  /**
   * Capture a lightweight UI state snapshot for error impact assessment.
   */
  private captureUIStateSnapshot(): UIStateSnapshot {
    const allElements = this.registry.getAllElements() as Array<{
      id: string;
      element?: HTMLElement;
    }>;

    const elementIds = new Set<string>();
    const disabledIds = new Set<string>();
    const errorBoundaryElements = new Set<string>();

    for (const el of allElements) {
      elementIds.add(el.id);
      if (el.element) {
        if (isDisabled(el.element)) {
          disabledIds.add(el.id);
        }
        // Detect error boundary fallback patterns
        if (
          el.element.getAttribute('role') === 'alert' ||
          el.element.dataset.errorBoundary !== undefined ||
          el.element.classList.contains('error-boundary')
        ) {
          errorBoundaryElements.add(el.id);
        }
      }
    }

    return {
      elementIds,
      disabledIds,
      errorBoundaryElements,
      url: typeof window !== 'undefined' ? window.location.href : '',
      timestamp: Date.now(),
    };
  }

  /**
   * Execute an action on an element
   */
  async executeAction(
    elementId: string,
    request: ControlActionRequest
  ): Promise<ControlActionResponse> {
    const startTime = performance.now();
    let waitDurationMs = 0;

    // Validate action name early — check built-in actions first
    const actionName = request.action;
    if (!SUPPORTED_ACTIONS.has(actionName)) {
      // Check if it could be a custom action (we'll verify on the element later).
      // Skip this check for CTR logical names since the element isn't resolved yet.
      const registered = this.registry.getElement(elementId);
      const isCtrTarget = !registered && getGlobalCtr().has(elementId);
      if (!registered?.customActions?.[actionName] && !isCtrTarget) {
        return {
          success: false,
          error: `Unsupported action: '${actionName}'. Supported: ${Array.from(SUPPORTED_ACTIONS).join(', ')}`,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }
    }

    try {
      // Find the element
      const registered = this.registry.getElement(elementId);
      let element: HTMLElement | null = registered?.element ?? null;

      // Verify element is still in the live DOM (React re-renders can detach elements)
      if (element && !element.isConnected) {
        element = null;
      }

      // If not registered or detached, try to find by identifier
      if (!element) {
        element = findElementByIdentifier(elementId);
      }

      // Try CTR (Central Target Registry) — resolves logical names to DOM
      // elements via self-healing selector fallback chains
      if (!element) {
        const ctr = getGlobalCtr();
        if (ctr.has(elementId)) {
          const result = ctr.resolveInDOM(elementId);
          if (result.resolved && result.element) {
            element = result.element;
          }
        }
      }

      // If still not found, check the discovery cache (elements found via
      // find()/discover() that weren't in the registry)
      if (!element) {
        const cached = this.discoveryCache.get(elementId);
        if (cached && cached.isConnected) {
          element = cached;
        } else if (cached) {
          // Clean up stale entry
          this.discoveryCache.delete(elementId);
        }
      }

      // Resolve page-level sentinel IDs for scroll actions.
      // "document", "body", and "window" are virtual element IDs that target
      // the page scroll container directly, without requiring a registered element.
      if (!element && request.action === 'scroll') {
        const sentinel = elementId.toLowerCase();
        if (sentinel === 'document' || sentinel === 'body' || sentinel === 'window') {
          element = document.documentElement;
        }
      }

      if (!element) {
        // Build diagnostic hint for AI consumers
        const wasRegistered = this.registry.getElement(elementId);
        const wasInCache = this.discoveryCache.has(elementId);
        let hint: string;
        if (wasRegistered && !wasRegistered.element?.isConnected) {
          hint = `Element '${elementId}' was registered but is no longer in the DOM (component may have unmounted). Try re-discovering with find() or navigate to the page containing this element.`;
        } else if (wasInCache) {
          hint = `Element '${elementId}' was previously discovered but its DOM node was detached. Run find() again to get a fresh reference.`;
        } else {
          hint = `Element '${elementId}' was never registered or discovered. Check the ID is correct, ensure the page containing it is mounted, or use find()/discover() to locate it first.`;
        }
        return {
          success: false,
          error: `Element not found: ${elementId}. ${hint}`,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      // Wait for conditions if specified
      if (request.waitOptions) {
        const waitResult = await this.waitForElement(element, request.waitOptions);
        waitDurationMs = waitResult.waitedMs;
        if (!waitResult.met) {
          return {
            success: false,
            error: waitResult.error || 'Wait condition not met',
            durationMs: performance.now() - startTime,
            timestamp: Date.now(),
            requestId: request.requestId,
            waitDurationMs,
          };
        }
      }

      // Capture browser events snapshot BEFORE the action (for diff)
      const actionStartTime = Date.now();
      const eventsBefore = this.consoleCapture ? this.consoleCapture.getRecent(100) : [];
      const fingerprintsBefore = new Set(eventsBefore.map(computeFingerprint));

      // Capture UI state before action for impact assessment
      this.impactAssessor?.captureBeforeState();

      // Execute the action.
      // For drag, accept params from either request.params or the request root (flat format).
      // Other actions already use flat params at the root, so drag should be consistent.
      let actionParams = request.params;
      if (request.action === 'drag') {
        const req = request as unknown as Record<string, unknown>;
        const dragRootFields: Record<string, unknown> = {};
        for (const key of [
          'targetPosition',
          'target',
          'targetOffset',
          'sourceOffset',
          'steps',
          'holdDelay',
          'releaseDelay',
          'html5',
        ]) {
          if (req[key] !== undefined) {
            dragRootFields[key] = req[key];
          }
        }
        if (Object.keys(dragRootFields).length > 0) {
          actionParams = { ...dragRootFields, ...request.params };
        }
      }
      const result = await this.performAction(element, request.action, actionParams);

      // Visual click feedback — show a brief highlight at the action location
      // for observability during automation (TuriX-CUA inspired pattern)
      try {
        const { showElementHighlight, HIGHLIGHT_COLORS } = await import('../debug/click-highlight');
        const highlightAction = request.action as keyof typeof HIGHLIGHT_COLORS;
        const color = HIGHLIGHT_COLORS[highlightAction] ?? HIGHLIGHT_COLORS.click;
        showElementHighlight(element, { color, duration: 600 });
      } catch {
        // Non-fatal — highlight is purely visual feedback
      }

      // Brief wait to catch immediate async errors (promise rejections from click handlers)
      let consoleErrors: CapturedError[] | undefined;
      let browserEvents: ActionBrowserEvent[] | undefined;
      let errorDiff: ActionErrorDiff | undefined;
      let errorImpact: import('../debug/error-impact').ErrorImpact | undefined;
      if (this.consoleCapture) {
        await sleep(50);

        // Legacy: console errors only (backward compat)
        const errors = this.consoleCapture.getConsoleSince(actionStartTime);
        if (errors.length > 0) consoleErrors = errors;

        // Enhanced: all browser events since action, enriched
        const allEventsSince = this.consoleCapture.getSince(actionStartTime);
        if (allEventsSince.length > 0) {
          // Filter out noise, enrich with severity/fingerprint/source
          const significantEvents = filterBySeverity(allEventsSince, 'warning');
          if (significantEvents.length > 0) {
            browserEvents = enrichEvents(significantEvents);
          }
        }

        // Compute error diff: what changed because of this action
        const eventsAfter = this.consoleCapture.getRecent(100);
        errorDiff = computeActionErrorDiff(fingerprintsBefore, eventsBefore, eventsAfter);

        // Assess error impact on UI state if significant errors occurred
        if (this.impactAssessor && errorDiff && errorDiff.newErrors.length > 0) {
          // Use the most significant new error for impact assessment
          const topNewError = errorDiff.newErrors[0];
          errorImpact = this.impactAssessor.assessImpact(topNewError.event);
        }
      }

      // Wait for idle after action if requested
      let idleWaitMs: number | undefined;
      if (request.waitAfter && this.idleDetector) {
        const idleWaitStart = performance.now();
        const waitTimeout = request.waitAfterTimeout ?? 10000;
        const waitMinStable = request.waitAfterMinStable ?? 300;

        try {
          await this.waitAfterAction(request.waitAfter, waitTimeout, waitMinStable);
        } catch {
          // Idle wait timeout is non-fatal — the action itself succeeded
        }
        idleWaitMs = performance.now() - idleWaitStart;
      }

      return {
        success: true,
        elementState: getElementState(element),
        result,
        consoleErrors,
        browserEvents,
        errorDiff,
        errorImpact,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
        waitDurationMs,
        idleWaitMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
        waitDurationMs,
      };
    }
  }

  /**
   * Execute an action on a component
   */
  async executeComponentAction(
    componentId: string,
    request: ComponentActionRequest
  ): Promise<ComponentActionResponse> {
    const startTime = performance.now();

    try {
      const component = this.registry.getComponent(componentId);
      if (!component) {
        return {
          success: false,
          error: `Component "${componentId}" not found. Components are only available when their page is active.`,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      const action = component.actions.find((a) => a.id === request.action);
      if (!action) {
        return {
          success: false,
          error: `Action not found: ${request.action}`,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      const result = await action.handler(request.params);

      return {
        success: true,
        result,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
      };
    }
  }

  /**
   * Wait for a condition on an element
   */
  async waitFor(elementId: string, options: WaitOptions): Promise<WaitResult> {
    const registered = this.registry.getElement(elementId);
    let element: HTMLElement | null = registered?.element ?? null;

    if (!element) {
      element = findElementByIdentifier(elementId);
    }

    if (!element) {
      return {
        met: false,
        waitedMs: 0,
        error: `Element not found: ${elementId}`,
      };
    }

    return this.waitForElement(element, options);
  }

  /**
   * Find controllable elements
   */
  async find(options?: FindRequest): Promise<FindResponse> {
    // Clear the discovery cache so IDs are re-generated deterministically
    // from the current DOM state and stale element references are dropped.
    this.discoveryCache.clear();

    const startTime = performance.now();
    const elements: DiscoveredElement[] = [];

    // Get root element
    let root: HTMLElement = document.body;
    if (options?.root) {
      const rootEl = document.querySelector<HTMLElement>(options.root);
      if (rootEl) root = rootEl;
    }

    // Find interactive elements (unless contentOnly is set)
    if (!options?.contentOnly) {
      const interactiveSelectors = [
        'a[href]',
        'button',
        'input',
        'select',
        'textarea',
        '[onclick]',
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[role="switch"]',
        '[tabindex]:not([tabindex="-1"])',
        '[contenteditable="true"]',
        '[data-ui-element]',
        '[data-testid]',
      ];

      const selector = options?.selector || interactiveSelectors.join(', ');
      const foundElements = root.querySelectorAll<HTMLElement>(selector);

      for (const el of foundElements) {
        if (options?.limit && elements.length >= options.limit) break;

        const state = getElementState(el);

        // Filter by visibility
        if (!options?.includeHidden && !state.visible) continue;

        // Filter by type
        if (options?.types) {
          const type = this.inferElementType(el);
          if (!options.types.includes(type)) continue;
        }

        // Filter by element_type (single string alias for types)
        if (options?.element_type) {
          const type = this.inferElementType(el);
          if (type !== options.element_type) continue;
        }

        // Filter by role (match ARIA role attribute OR inferred UI Bridge type)
        if (options?.role) {
          const roleLc = options.role.toLowerCase();
          const elRole = el.getAttribute('role')?.toLowerCase();
          const inferredType = this.inferElementType(el).toLowerCase();
          if (elRole !== roleLc && inferredType !== roleLc) continue;
        }

        // Filter by text (matches label, textContent, or accessible name)
        if (options?.text) {
          const searchText = options.text.toLowerCase();
          const label = this.getElementLabel(el)?.toLowerCase() || '';
          const textContent = (state.textContent || '').toLowerCase();
          const accessibleName = this.getAccessibleName(el)?.toLowerCase() || '';
          if (
            !label.includes(searchText) &&
            !textContent.includes(searchText) &&
            !accessibleName.includes(searchText)
          ) {
            continue;
          }
        }

        // Filter by label (case-insensitive partial match)
        if (options?.label) {
          const labelLc = options.label.toLowerCase();
          const elLabel = (this.getElementLabel(el) || '').toLowerCase();
          if (!elLabel.includes(labelLc)) continue;
        }

        // Filter by exact_text (case-insensitive exact match on label or textContent)
        if (options?.exact_text) {
          const exactLc = options.exact_text.toLowerCase();
          const elLabel = (this.getElementLabel(el) || '').toLowerCase();
          const elText = (state.textContent || '').trim().toLowerCase();
          if (elLabel !== exactLc && elText !== exactLc) continue;
        }

        // Filter by interactiveOnly — keep only elements that are interactive by type or have actions
        if (options?.interactiveOnly) {
          const interactiveTypes = new Set([
            'button',
            'input',
            'select',
            'textarea',
            'link',
            'checkbox',
            'radio',
          ]);
          const elType = this.inferElementType(el);
          const elActions = this.inferActions(el);
          if (!interactiveTypes.has(elType) && elActions.length === 0) continue;
        }

        // Check if registered
        const registered = this.registry.findByDOMElement(el);

        const id = registered?.id || this.getElementId(el);

        // Cache unregistered elements so executeAction can resolve them later
        if (!registered) {
          this.discoveryCache.set(id, el);
          this.evictDiscoveryCache();
        }

        elements.push({
          id,
          type: registered?.type || this.inferElementType(el),
          label: registered?.label || this.getElementLabel(el),
          tagName: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          accessibleName: this.getAccessibleName(el),
          actions: registered?.actions || this.inferActions(el),
          state,
          registered: !!registered,
          category: registered?.category || 'interactive',
          className: classString(el) || undefined,
          classes: el.classList?.length > 0 ? Array.from(el.classList) : undefined,
          contentMetadata: registered?.contentMetadata,
        });
      }
    }

    // Include content elements when explicitly requested or when interactiveOnly is false
    if (options?.includeContent || options?.contentOnly || options?.interactiveOnly === false) {
      const contentElements = this.registry.getAllContentElements();
      for (const el of contentElements) {
        if (options?.limit && elements.length >= options.limit) break;

        const state = el.getState();

        // Filter by visibility
        if (!options?.includeHidden && !state.visible) continue;

        // Filter by content role
        if (options?.contentRole && el.contentMetadata?.contentRole !== options.contentRole) {
          continue;
        }

        // Filter by label (case-insensitive partial match)
        if (options?.label) {
          const labelLc = options.label.toLowerCase();
          const elLabel = (el.label || '').toLowerCase();
          if (!elLabel.includes(labelLc)) continue;
        }

        // Filter by exact_text (case-insensitive exact match on label or textContent)
        if (options?.exact_text) {
          const exactLc = options.exact_text.toLowerCase();
          const elLabel = (el.label || '').toLowerCase();
          const elText = (state.textContent || '').trim().toLowerCase();
          if (elLabel !== exactLc && elText !== exactLc) continue;
        }

        elements.push({
          id: el.id,
          type: el.type,
          label: el.label,
          tagName: el.element.tagName.toLowerCase(),
          role: el.element.getAttribute('role') || undefined,
          accessibleName: el.label || state.textContent?.trim(),
          actions: [],
          state,
          registered: true,
          category: 'content',
          className: classString(el.element) || undefined,
          classes: el.element.classList?.length > 0 ? Array.from(el.element.classList) : undefined,
          contentMetadata: el.contentMetadata,
        });
      }
    }

    // Include media elements from registry when requested
    if (options?.includeMedia || options?.mediaOnly) {
      const mediaElements = this.registry.getAllMediaElements();
      for (const el of mediaElements) {
        if (options?.limit && elements.length >= options.limit) break;

        const state = el.getState();

        // Filter by visibility
        if (!options?.includeHidden && !state.visible) continue;

        // Re-capture media metadata to detect loading transitions
        const meta = el.mediaMetadata;

        // Filter by media type
        if (options?.mediaType && meta?.mediaType !== options.mediaType) continue;

        // Filter broken only
        if (options?.brokenOnly && meta?.loadingState !== 'error') continue;

        // Filter missing alt only
        if (options?.missingAltOnly) {
          if (meta?.altText !== undefined && meta?.altText !== null) continue;
          if (meta?.isDecorative) continue; // decorative images intentionally have no alt
        }

        // Filter by source pattern (with ReDoS protection)
        if (options?.srcPattern && meta?.src) {
          if (options.srcPattern.length > 200 || hasNestedQuantifiers(options.srcPattern)) {
            // Pattern too long or has nested quantifiers (ReDoS risk) — fall back to substring match
            if (!meta.src.includes(options.srcPattern)) continue;
          } else {
            try {
              const regex = new RegExp(options.srcPattern);
              if (!regex.test(meta.src)) continue;
            } catch {
              // Invalid regex — fall back to substring match
              if (!meta.src.includes(options.srcPattern)) continue;
            }
          }
        }

        // Filter oversized
        if (options?.oversizeThreshold && meta?.oversizeRatio) {
          if (meta.oversizeRatio < options.oversizeThreshold) continue;
        }

        // Filter by label (case-insensitive partial match)
        if (options?.label) {
          const labelLc = options.label.toLowerCase();
          const elLabel = (el.label || '').toLowerCase();
          if (!elLabel.includes(labelLc)) continue;
        }

        // Filter by exact_text (case-insensitive exact match on label or alt text)
        if (options?.exact_text) {
          const exactLc = options.exact_text.toLowerCase();
          const elLabel = (el.label || '').toLowerCase();
          const altText = (meta?.altText || '').toLowerCase();
          if (elLabel !== exactLc && altText !== exactLc) continue;
        }

        elements.push({
          id: el.id,
          type: el.type,
          label: el.label,
          tagName: el.element.tagName.toLowerCase(),
          role: el.element.getAttribute('role') || undefined,
          accessibleName: el.label || meta?.altText,
          actions: [],
          state,
          registered: true,
          category: 'media',
          className: classString(el.element) || undefined,
          classes: el.element.classList?.length > 0 ? Array.from(el.element.classList) : undefined,
          mediaMetadata: meta,
        });
      }
    }

    return {
      elements,
      total: elements.length,
      durationMs: performance.now() - startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * Discover controllable elements
   * @deprecated Use find() instead
   */
  async discover(options?: FindRequest): Promise<FindResponse> {
    return this.find(options);
  }

  /**
   * Get control snapshot
   */
  async getSnapshot(): Promise<ControlSnapshot> {
    const elements = this.registry.getAllElements();
    const components = this.registry.getAllComponents();
    const workflows = this.registry.getAllWorkflows();

    return {
      timestamp: Date.now(),
      elements: elements.map((el) => ({
        id: el.id,
        type: el.type,
        label: el.label,
        actions: [...el.actions, ...(el.customActions ? Object.keys(el.customActions) : [])],
        state: el.getState(),
        category: el.category,
        contentMetadata: el.contentMetadata,
        mediaMetadata: el.mediaMetadata,
      })),
      components: components.map((comp) => ({
        id: comp.id,
        name: comp.name,
        actions: comp.actions.map((a) => a.id),
      })),
      workflows: workflows.map((wf) => ({
        id: wf.id,
        name: wf.name,
        stepCount: wf.steps.length,
      })),
      activeRuns: [], // Workflow engine manages this
    };
  }

  /**
   * Fill multiple form fields atomically.
   *
   * For each field entry, finds the element by registered ID or DOM query,
   * sets the value based on element type, dispatches proper events, and
   * optionally triggers validation.
   */
  async fillForm(request: FillFormRequest): Promise<FillResult> {
    const fields: Record<string, FillFieldResult> = {};
    let filledCount = 0;
    let errorCount = 0;

    const triggerValidation = request.triggerValidation !== false;
    const clearFirst = request.clearFirst !== false;

    for (const [fieldId, value] of Object.entries(request.fields)) {
      try {
        // Resolve element: try registry first, then DOM query
        const registered = this.registry.getElement(fieldId);
        let element: HTMLElement | null = registered?.element ?? null;
        if (!element) {
          element = findElementByIdentifier(fieldId);
        }

        if (!element) {
          fields[fieldId] = { success: false, error: `Element not found: ${fieldId}` };
          errorCount++;
          continue;
        }

        // Fill based on element type and value type
        fillSingleField(element, value, clearFirst);

        // Trigger validation if requested
        let validationError: string | undefined;
        if (triggerValidation && 'reportValidity' in element) {
          const isValid = (element as HTMLInputElement).reportValidity();
          if (!isValid) {
            validationError =
              (element as HTMLInputElement).validationMessage || 'Validation failed';
          }
        }

        fields[fieldId] = { success: true, validationError };
        filledCount++;
      } catch (err) {
        fields[fieldId] = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
        errorCount++;
      }
    }

    return {
      success: errorCount === 0,
      filledCount,
      errorCount,
      fields,
    };
  }

  /**
   * Wait for element conditions
   */
  private async waitForElement(element: HTMLElement, options: WaitOptions): Promise<WaitResult> {
    const opts = { ...DEFAULT_WAIT_OPTIONS, ...options };
    const startTime = performance.now();
    const deadline = startTime + opts.timeout;

    while (Date.now() < deadline) {
      const state = getElementState(element);

      // Check conditions
      let allMet = true;

      if (opts.visible && !state.visible) allMet = false;
      if (opts.enabled && !state.enabled) allMet = false;
      if (opts.focused && !state.focused) allMet = false;

      // Check custom state conditions
      if (opts.state) {
        for (const [key, value] of Object.entries(opts.state)) {
          if (state[key as keyof ElementState] !== value) {
            allMet = false;
            break;
          }
        }
      }

      if (allMet) {
        return {
          met: true,
          waitedMs: performance.now() - startTime,
          state,
        };
      }

      await sleep(opts.interval);
    }

    return {
      met: false,
      waitedMs: performance.now() - startTime,
      state: getElementState(element),
      error: `Timeout waiting for conditions after ${opts.timeout}ms`,
    };
  }

  /**
   * Wait for idle after an action based on the waitAfter specification.
   */
  private async waitAfterAction(
    waitAfter: NonNullable<ControlActionRequest['waitAfter']>,
    timeout: number,
    minStableMs: number
  ): Promise<void> {
    if (!this.idleDetector) return;

    if (waitAfter === 'idle') {
      // Wait for composite idle
      await this.idleDetector.waitForIdle({ timeout, minStableMs });
    } else if (typeof waitAfter === 'string') {
      // Wait for a specific signal
      await this.idleDetector.waitForSignal(waitAfter, { timeout, minStableMs });
    } else if (Array.isArray(waitAfter)) {
      // Wait for multiple signals
      await this.idleDetector.waitFor(waitAfter, { timeout, minStableMs });
    } else if ('indicator' in waitAfter) {
      // Wait for a CSS selector to disappear
      await this.idleDetector.waitFor([waitAfter], { timeout, minStableMs });
    }
  }

  /**
   * Perform an action on an element
   */
  private async performAction(
    element: HTMLElement,
    action: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    // Delegate to ui-bridge-auto's canonical action implementation if available.
    // This ensures a single source of truth for action semantics.
    const canonical = getCanonicalPerformAction();
    if (canonical) {
      // Inject a resolver so ui-bridge-auto can look up target.elementId via our
      // registry (drag actions take { target: { elementId } } descriptors).
      const enriched =
        action === 'drag' && params && !('resolveElement' in params)
          ? {
              ...params,
              resolveElement: (id: string): HTMLElement | null => {
                const reg = this.registry.getElement(id);
                return reg?.element ?? findElementByIdentifier(id);
              },
            }
          : params;
      return canonical(element, action, enriched);
    }

    // Fallback: inline implementations (used when ui-bridge-auto is not installed)
    // Auto-hover parent if element is opacity-hidden (e.g., close button revealed on hover)
    const computedStyle = window.getComputedStyle(element);
    if (parseFloat(computedStyle.opacity) === 0 && element.parentElement) {
      this.performHover(element.parentElement);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    switch (action as StandardAction) {
      case 'click':
        return this.performClick(element, params as MouseAction);
      case 'doubleClick':
        return this.performDoubleClick(element, params as MouseAction);
      case 'rightClick':
        return this.performRightClick(element, params as MouseAction);
      case 'middleClick':
        return this.performMiddleClick(element, params as MouseAction);
      case 'type':
        return this.performType(element, params as unknown as TypeAction);
      case 'sendKeys':
        return this.performSendKeys(element, params as unknown as SendKeysAction);
      case 'clear':
        return this.performClear(element);
      case 'select':
        return this.performSelect(element, params as unknown as SelectAction);
      case 'focus':
        return this.performFocus(element);
      case 'blur':
        return this.performBlur(element);
      case 'hover':
        return this.performHover(element);
      case 'scroll':
        return this.performScroll(element, params as ScrollAction);
      case 'scrollIntoView': {
        const scrollParams = params as ScrollIntoViewAction | undefined;
        return element.scrollIntoView({
          behavior: scrollParams?.smooth ? 'smooth' : 'auto',
          block: scrollParams?.block || 'center',
          inline: scrollParams?.inline || 'nearest',
        });
      }
      case 'check':
        return this.performCheck(element, true);
      case 'uncheck':
        return this.performCheck(element, false);
      case 'toggle':
        return this.performToggle(element);
      case 'drag':
        return this.performDrag(element, params as unknown as DragAction);
      case 'setValue':
        return this.performSetValue(element, params);
      case 'autocomplete':
        return this.performAutocomplete(
          element,
          params as unknown as import('./types').AutocompleteAction
        );
      case 'submit':
        return this.performSubmit(element);
      case 'reset':
        return this.performReset(element);
      default: {
        // Check for custom actions
        const registered = this.registry.findByDOMElement(element);
        if (registered?.customActions?.[action]) {
          return registered.customActions[action].handler(params);
        }
        throw new Error(`Unknown action: ${action}`);
      }
    }
  }

  private performClick(element: HTMLElement, options?: MouseAction): void {
    // Dispatch mouse events for listeners that depend on the full sequence
    element.dispatchEvent(createMouseEvent('mousedown', element, options));
    element.dispatchEvent(createMouseEvent('mouseup', element, options));

    // Use native click() which works with React's event delegation.
    // dispatchEvent(new MouseEvent('click')) does NOT trigger React onClick
    // because React 17+ delegates events at the root and doesn't intercept
    // programmatically dispatched events.
    element.click();

    // Anchor navigation fallback (native click already handles this,
    // but keep for elements inside anchors where element !== anchor)
    const anchor = element.closest('a');
    if (anchor && anchor !== element && anchor.hasAttribute('href')) {
      anchor.click();
    }
  }

  private performDoubleClick(element: HTMLElement, options?: MouseAction): void {
    this.performClick(element, options);
    this.performClick(element, options);
    element.dispatchEvent(createMouseEvent('dblclick', element, options));
  }

  private performRightClick(element: HTMLElement, options?: MouseAction): void {
    const opts = { ...options, button: 'right' as const };
    element.dispatchEvent(createMouseEvent('mousedown', element, opts));
    element.dispatchEvent(createMouseEvent('mouseup', element, opts));
    element.dispatchEvent(createMouseEvent('contextmenu', element, opts));
  }

  private performMiddleClick(element: HTMLElement, options?: MouseAction): void {
    const opts = { ...options, button: 'middle' as const };
    element.dispatchEvent(createMouseEvent('mousedown', element, opts));
    element.dispatchEvent(createMouseEvent('mouseup', element, opts));
    // Browsers fire 'auxclick' (not 'click') for non-primary button clicks.
    // React's onAuxClick handler listens for this event type.
    element.dispatchEvent(createMouseEvent('auxclick', element, opts));
  }

  private async performType(element: HTMLElement, options?: TypeAction): Promise<void> {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error('Type action requires an input or textarea element');
    }

    // Use the native value setter to bypass React's synthetic event system.
    // React overrides the value property; setting .value directly doesn't
    // trigger onChange. The native setter + dispatched 'input' event does.
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    // React 17+ stores props directly on the DOM node under __reactProps$<key>.
    // In embedded WebViews (e.g. Tauri), React's event delegation may not receive
    // bubbled synthetic events because the React root is mounted differently.
    // Directly invoking the onChange prop is the most reliable way to notify
    // React of value changes in these environments.
    const el = element as unknown as Record<string, unknown>;
    const reactPropsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    const reactProps = reactPropsKey
      ? (el[reactPropsKey] as Record<string, unknown> | undefined)
      : undefined;

    /**
     * Notify React of a value change on the element.
     * Strategy:
     * 1. Reset _valueTracker so React detects old !== new when it processes
     *    the event (React skips onChange when tracker value === new value).
     * 2. Dispatch a native 'input' event — React's event delegation picks this
     *    up in normal browser contexts.
     * 3. Also call __reactProps$.onChange directly — this is the reliable path
     *    in embedded WebViews (Tauri) where event delegation may be bypassed.
     */
    const notifyReact = (oldValue: string) => {
      // Step 1: Reset _valueTracker to the old value so React detects the change
      const tracker = (element as unknown as { _valueTracker?: { setValue(v: string): void } })
        ._valueTracker;
      if (tracker) tracker.setValue(oldValue);

      // Step 2: Dispatch native input event (works in standard browser contexts)
      element.dispatchEvent(new Event('input', { bubbles: true }));

      // Step 3: Directly invoke React's onChange prop if available (Tauri WebView fix)
      if (reactProps?.onChange && typeof reactProps.onChange === 'function') {
        const syntheticEvent = {
          target: element,
          currentTarget: element,
          type: 'change',
          bubbles: true,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new Event('input'),
        };
        (reactProps.onChange as (e: unknown) => void)(syntheticEvent);
      }
    };

    element.focus();

    if (options?.clear) {
      const prevClear = element.value;
      if (nativeSetter) {
        nativeSetter.call(element, '');
      } else {
        element.value = '';
      }
      notifyReact(prevClear);
    }

    const text = options?.text || '';
    const delay = options?.delay || 0;

    for (const char of text) {
      const current = element.value;
      if (nativeSetter) {
        nativeSetter.call(element, current + char);
      } else {
        element.value = current + char;
      }
      if (options?.triggerEvents !== false) {
        notifyReact(current);
      }
      if (delay > 0) {
        await sleep(delay);
      }
    }

    if (options?.triggerEvents !== false) {
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /**
   * Dispatch real KeyboardEvent sequences on an element.
   *
   * For each key descriptor, fires keydown → keypress → keyup (keypress is
   * skipped for non-printable keys like Enter, Escape, Arrow*, etc.).
   * This is the correct way to interact with elements that consume raw
   * keyboard events (xterm.js terminals, CodeMirror, Monaco, canvas games).
   */
  private async performSendKeys(element: HTMLElement, options?: SendKeysAction): Promise<void> {
    if (!options?.keys?.length) return;

    element.focus();
    const delay = options.delay || 0;

    // Keys where browsers don't fire keypress
    const NON_PRINTABLE = new Set([
      'Enter',
      'Tab',
      'Escape',
      'Backspace',
      'Delete',
      'Insert',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
      'F10',
      'F11',
      'F12',
      'Control',
      'Shift',
      'Alt',
      'Meta',
      'CapsLock',
      'NumLock',
      'ScrollLock',
    ]);

    for (const keyDesc of options.keys) {
      const { key } = keyDesc;
      if (!key || typeof key !== 'string') continue;
      const mods = keyDesc.modifiers || {};
      const eventInit: KeyboardEventInit = {
        key,
        code: this.keyToCode(key),
        bubbles: true,
        cancelable: true,
        ctrlKey: mods.ctrl || false,
        shiftKey: mods.shift || false,
        altKey: mods.alt || false,
        metaKey: mods.meta || false,
      };

      element.dispatchEvent(new KeyboardEvent('keydown', eventInit));

      // Fire keypress for printable characters only (no modifiers except shift)
      const isInputElement =
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      if (key.length === 1 && !NON_PRINTABLE.has(key) && !mods.ctrl && !mods.alt && !mods.meta) {
        element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
        // Insert character into input/textarea value (keypress alone doesn't update .value)
        if (isInputElement) {
          const start = element.selectionStart ?? element.value.length;
          const end = element.selectionEnd ?? start;
          element.value = element.value.slice(0, start) + key + element.value.slice(end);
          element.selectionStart = element.selectionEnd = start + 1;
          element.dispatchEvent(
            new InputEvent('input', { bubbles: true, data: key, inputType: 'insertText' })
          );
        }
      } else if (key === 'Backspace' && isInputElement && !mods.ctrl && !mods.alt && !mods.meta) {
        // Handle Backspace: remove character before cursor
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? start;
        if (start !== end) {
          element.value = element.value.slice(0, start) + element.value.slice(end);
          element.selectionStart = element.selectionEnd = start;
        } else if (start > 0) {
          element.value = element.value.slice(0, start - 1) + element.value.slice(start);
          element.selectionStart = element.selectionEnd = start - 1;
        }
        element.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
        );
      } else if (key === 'Delete' && isInputElement && !mods.ctrl && !mods.alt && !mods.meta) {
        // Handle Delete: remove character after cursor (or selection)
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? start;
        if (start !== end) {
          element.value = element.value.slice(0, start) + element.value.slice(end);
          element.selectionStart = element.selectionEnd = start;
        } else if (start < element.value.length) {
          element.value = element.value.slice(0, start) + element.value.slice(start + 1);
          element.selectionStart = element.selectionEnd = start;
        }
        element.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'deleteContentForward' })
        );
      }

      element.dispatchEvent(new KeyboardEvent('keyup', eventInit));

      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  /**
   * Map a key name to a KeyboardEvent.code value.
   */
  private keyToCode(key: string): string {
    if (!key || typeof key !== 'string') return '';
    if (key.length === 1) {
      const upper = key.toUpperCase();
      if (upper >= 'A' && upper <= 'Z') return `Key${upper}`;
      if (upper >= '0' && upper <= '9') return `Digit${upper}`;
    }
    // Named keys map to themselves as code
    const codeMap: Record<string, string> = {
      Enter: 'Enter',
      Tab: 'Tab',
      Escape: 'Escape',
      Backspace: 'Backspace',
      Delete: 'Delete',
      ' ': 'Space',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
    };
    return codeMap[key] || key;
  }

  private performClear(element: HTMLElement): void {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const previousValue = element.value;

      const proto =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(element, '');
      } else {
        element.value = '';
      }

      // Reset _valueTracker so React detects old !== new
      const tracker = (element as unknown as { _valueTracker?: { setValue(v: string): void } })
        ._valueTracker;
      if (tracker) tracker.setValue(previousValue);

      element.dispatchEvent(new Event('input', { bubbles: true }));

      // Also invoke __reactProps$.onChange directly for embedded WebViews (Tauri)
      const el = element as unknown as Record<string, unknown>;
      const reactPropsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
      const reactProps = reactPropsKey
        ? (el[reactPropsKey] as Record<string, unknown> | undefined)
        : undefined;
      if (reactProps?.onChange && typeof reactProps.onChange === 'function') {
        (reactProps.onChange as (e: unknown) => void)({
          target: element,
          currentTarget: element,
          type: 'change',
          bubbles: true,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new Event('input'),
        });
      }

      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  private async performSelect(element: HTMLElement, options?: SelectAction): Promise<void> {
    // Handle Radix/headless combobox elements (render as <button> with role="combobox")
    if (!(element instanceof HTMLSelectElement)) {
      const role = element.getAttribute('role');
      if (role === 'combobox' || element.hasAttribute('aria-expanded')) {
        await this.performComboboxSelect(element, options);
        return;
      }
      throw new Error(
        `Cannot select on ${element.tagName}. Use a <select> element or a combobox (role="combobox").`
      );
    }

    const values = Array.isArray(options?.value) ? options.value : [options?.value];

    // Save the old value before any changes — needed for React's value tracker
    const previousValue = element.value;

    if (!options?.additive) {
      for (const option of element.options) {
        option.selected = false;
      }
    }

    let selectedValue: string | undefined;
    for (const option of element.options) {
      const matchValue = options?.byLabel ? option.text : option.value;
      if (values.includes(matchValue)) {
        option.selected = true;
        selectedValue = option.value;
      }
    }

    // React uses _valueTracker to compare old vs new values when handling
    // change events. Setting option.selected updates the DOM value through
    // React's intercepted setter, which also updates the tracker — making
    // React think old === new and skip the onChange call.
    // Fix: reset the tracker to the previous value so React detects the diff.
    const tracker = (element as unknown as { _valueTracker?: { setValue(v: string): void } })
      ._valueTracker;
    if (tracker) {
      tracker.setValue(previousValue);
    }
    // Also try calling React's onChange handler directly via internal props.
    // React 18+ stores event handlers on __reactProps$<key> on the DOM element.
    const el = element as unknown as Record<string, unknown>;
    const reactPropsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    if (reactPropsKey) {
      const props = el[reactPropsKey] as Record<string, unknown> | undefined;
      if (props?.onChange && typeof props.onChange === 'function') {
        const syntheticEvent = {
          target: element,
          currentTarget: element,
          type: 'change',
          bubbles: true,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new Event('change'),
        };
        (props.onChange as (e: unknown) => void)(syntheticEvent);
        return; // React handler called directly, no need for native events
      }
    }

    // Use the native setter as well, for non-React environments
    if (selectedValue !== undefined) {
      const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value'
      )?.set;
      if (nativeSelectValueSetter) {
        nativeSelectValueSetter.call(element, selectedValue);
      }
    }

    // Dispatch events — React's event delegation will pick these up
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Handle select on combobox elements (Radix, headless UI, MUI, Select2, Ant Design, etc.)
   * Strategy: click to open → find listbox/dropdown → find option → click option
   */
  private performComboboxSelect(element: HTMLElement, options?: SelectAction): Promise<void> {
    const targetValue = Array.isArray(options?.value) ? options.value[0] : options?.value;
    if (!targetValue) {
      throw new Error('Select action on combobox requires a value');
    }

    // Click to open the combobox dropdown
    element.click();

    // Wait for the dropdown to render, then find and click the option.
    // Use a retry loop because some frameworks (MUI, Ant Design) render
    // the dropdown asynchronously after a paint cycle.
    return new Promise<void>((resolve) => {
      let attempts = 0;
      const maxAttempts = 5;
      const attemptInterval = 50; // ms

      const tryFindOption = (): void => {
        attempts++;
        const dropdown = this.findOpenDropdown(element);

        if (!dropdown && attempts < maxAttempts) {
          setTimeout(tryFindOption, attemptInterval);
          return;
        }

        if (!dropdown) {
          console.warn(
            `[ui-bridge] performComboboxSelect: dropdown not found after ${maxAttempts} attempts for value "${targetValue}"`
          );
          resolve();
          return;
        }

        // Find matching option across various frameworks
        const matched = this.findDropdownOption(dropdown, targetValue, options?.byLabel);
        if (matched) {
          matched.click();
        } else {
          console.warn(
            `[ui-bridge] performComboboxSelect: option "${targetValue}" not found in dropdown`
          );
        }
        resolve();
      };

      requestAnimationFrame(tryFindOption);
    });
  }

  /**
   * Find the open dropdown/listbox associated with an element.
   * Supports: ARIA listbox, Radix, MUI, Select2, Ant Design, Headless UI.
   */
  private findOpenDropdown(trigger: HTMLElement): Element | null {
    // 1. ARIA listbox via aria-controls/aria-owns
    const listboxId = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns');
    if (listboxId) {
      const el = document.getElementById(listboxId);
      if (el) return el;
    }

    // 2. Radix / shadcn popper
    const radixListbox = document.querySelector(
      '[data-radix-popper-content-wrapper] [role="listbox"], [data-state="open"] [role="listbox"]'
    );
    if (radixListbox) return radixListbox;

    // 3. Generic ARIA listbox
    const ariaListbox = document.querySelector('[role="listbox"]');
    if (ariaListbox) return ariaListbox;

    // 4. MUI Select (renders a popover with role="presentation" containing <ul role="listbox">)
    const muiListbox = document.querySelector(
      '.MuiPopover-root [role="listbox"], .MuiPopper-root [role="listbox"], .MuiMenu-list'
    );
    if (muiListbox) return muiListbox;

    // 5. Select2 (jQuery-based, renders .select2-results__options)
    const select2Dropdown = document.querySelector(
      '.select2-container--open .select2-results__options'
    );
    if (select2Dropdown) return select2Dropdown;

    // 6. Ant Design (renders .ant-select-dropdown with .ant-select-item)
    const antDropdown = document.querySelector(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden)'
    );
    if (antDropdown) return antDropdown;

    // 7. Headless UI listbox
    const headlessListbox = document.querySelector(
      '[data-headlessui-state~="open"] [role="listbox"]'
    );
    if (headlessListbox) return headlessListbox;

    // 8. Generic open dropdown (last resort)
    const generic = document.querySelector('[role="menu"][data-state="open"], .dropdown-menu.show');
    return generic;
  }

  /**
   * Find a matching option element within a dropdown container.
   * Handles various option patterns across frameworks.
   */
  private findDropdownOption(
    dropdown: Element,
    targetValue: string,
    byLabel?: boolean
  ): HTMLElement | null {
    const targetLower = targetValue.toLowerCase();

    // Selector patterns for option elements across frameworks
    const optionSelectors = [
      '[role="option"]', // ARIA standard
      '.ant-select-item-option', // Ant Design
      '.select2-results__option', // Select2
      '.MuiMenuItem-root', // MUI
      '[data-headlessui-state] [role="option"]', // Headless UI
      'li[data-value]', // Generic data-value
    ];

    for (const selector of optionSelectors) {
      const options = dropdown.querySelectorAll<HTMLElement>(selector);
      if (options.length === 0) continue;

      for (const opt of options) {
        const optDataValue = opt.getAttribute('data-value') ?? '';
        const optText = opt.textContent?.trim() ?? '';

        // Match by data-value, text content, or aria-label
        if (byLabel || !optDataValue) {
          if (optText === targetValue || optText.toLowerCase() === targetLower) {
            return opt;
          }
        } else {
          if (optDataValue === targetValue || optDataValue.toLowerCase() === targetLower) {
            return opt;
          }
        }

        // Fallback: check aria-label
        const ariaLabel = opt.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.toLowerCase() === targetLower) {
          return opt;
        }
      }
    }

    return null;
  }

  /**
   * Handle autocomplete inputs: type search text, wait for suggestions,
   * then click the matching suggestion.
   */
  private async performAutocomplete(
    element: HTMLElement,
    options?: import('./types').AutocompleteAction
  ): Promise<void> {
    if (!options?.searchText) {
      throw new Error('Autocomplete action requires searchText parameter');
    }

    const timeout = options.suggestionTimeout ?? 2000;
    const selectValue = options.selectValue || options.searchText;

    // Clear and type the search text
    if (options.clear !== false) {
      await this.performClear(element);
    }
    await this.performType(element, { text: options.searchText });

    // Wait for suggestions to appear by polling for dropdown/listbox
    const startTime = Date.now();
    const pollInterval = 100;

    while (Date.now() - startTime < timeout) {
      await new Promise((r) => setTimeout(r, pollInterval));

      // Look for suggestion containers
      const dropdown = this.findOpenDropdown(element);
      if (!dropdown) continue;

      const match = this.findDropdownOption(dropdown, selectValue);
      if (match) {
        match.click();
        return;
      }
    }

    throw new Error(
      `Autocomplete: no matching suggestion for "${selectValue}" within ${timeout}ms`
    );
  }

  private performFocus(element: HTMLElement): void {
    element.focus();
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  }

  private performBlur(element: HTMLElement): void {
    element.blur();
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  private performHover(element: HTMLElement): void {
    element.dispatchEvent(createMouseEvent('mouseenter', element));
    element.dispatchEvent(createMouseEvent('mouseover', element));
  }

  private async performScroll(
    element: HTMLElement,
    options?: ScrollAction
  ): Promise<{
    scrollInfo: {
      before: { scrollTop: number; scrollLeft: number };
      after: { scrollTop: number; scrollLeft: number };
      changed: boolean;
    };
  }> {
    const scrollTarget = this.findScrollableElement(element);
    const isSmooth = !!options?.smooth;

    // Capture pre-scroll state
    const before = { scrollTop: scrollTarget.scrollTop, scrollLeft: scrollTarget.scrollLeft };

    if (options?.toElement) {
      const target = document.querySelector<HTMLElement>(options.toElement);
      if (target) {
        target.scrollIntoView({ behavior: isSmooth ? 'smooth' : 'auto' });
      }
    } else if (options?.position) {
      scrollTarget.scrollTo({
        left: options.position.x,
        top: options.position.y,
        behavior: isSmooth ? 'smooth' : 'auto',
      });
    } else if (options?.deltaY !== undefined || options?.deltaX !== undefined) {
      // deltaY/deltaX use wheel-event semantics: positive = down/right, negative = up/left.
      const dx = options.deltaX ?? 0;
      const dy = options.deltaY ?? 0;
      scrollTarget.scrollBy({ left: dx, top: dy, behavior: isSmooth ? 'smooth' : 'auto' });
    } else {
      const amount = options?.amount || 100;
      const direction = options?.direction || 'down';

      switch (direction) {
        case 'up':
          scrollTarget.scrollBy({ top: -amount, behavior: isSmooth ? 'smooth' : 'auto' });
          break;
        case 'down':
          scrollTarget.scrollBy({ top: amount, behavior: isSmooth ? 'smooth' : 'auto' });
          break;
        case 'left':
          scrollTarget.scrollBy({ left: -amount, behavior: isSmooth ? 'smooth' : 'auto' });
          break;
        case 'right':
          scrollTarget.scrollBy({ left: amount, behavior: isSmooth ? 'smooth' : 'auto' });
          break;
      }
    }

    // For smooth scrolling, wait for the animation to complete before capturing
    if (isSmooth) {
      await new Promise<void>((resolve) => {
        let lastTop = scrollTarget.scrollTop;
        let lastLeft = scrollTarget.scrollLeft;
        let stableFrames = 0;
        const check = () => {
          if (scrollTarget.scrollTop === lastTop && scrollTarget.scrollLeft === lastLeft) {
            stableFrames++;
            if (stableFrames >= 3) {
              resolve();
              return;
            }
          } else {
            stableFrames = 0;
            lastTop = scrollTarget.scrollTop;
            lastLeft = scrollTarget.scrollLeft;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
        // Safety timeout: don't wait more than 1s
        setTimeout(resolve, 1000);
      });
    }

    // For non-smooth (instant) scrolls, yield one frame so the browser
    // applies the scroll position before we read it
    if (!isSmooth) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }

    // Capture post-scroll state
    const after = { scrollTop: scrollTarget.scrollTop, scrollLeft: scrollTarget.scrollLeft };

    return {
      scrollInfo: {
        before,
        after,
        changed: before.scrollTop !== after.scrollTop || before.scrollLeft !== after.scrollLeft,
      },
    };
  }

  private findScrollableElement(element: HTMLElement): HTMLElement {
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
      const style = getComputedStyle(current);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      const isScrollable =
        (overflowY === 'auto' ||
          overflowY === 'scroll' ||
          overflowX === 'auto' ||
          overflowX === 'scroll') &&
        (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth);
      if (isScrollable) return current;
      current = current.parentElement;
    }
    // Check body first — many Tauri/SPA apps make body the scroll container
    if (
      document.body.scrollHeight > document.body.clientHeight ||
      document.body.scrollWidth > document.body.clientWidth
    ) {
      return document.body;
    }
    return document.documentElement;
  }

  private performCheck(element: HTMLElement, checked: boolean): void {
    if (
      element instanceof HTMLInputElement &&
      (element.type === 'checkbox' || element.type === 'radio')
    ) {
      if (element.checked !== checked) {
        element.checked = checked;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (element.getAttribute('role') === 'switch') {
      // React switch components toggle via click
      const isChecked = element.getAttribute('aria-checked') === 'true';
      if (isChecked !== checked) {
        element.click();
      }
    }
  }

  private performToggle(element: HTMLElement): void {
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      element.checked = !element.checked;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.getAttribute('role') === 'switch') {
      element.click();
    }
  }

  private performSetValue(element: HTMLElement, params?: Record<string, unknown>): void {
    const value = params?.value as string | undefined;
    if (value === undefined) {
      throw new Error('setValue requires a "value" parameter');
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const previousValue = element.value;

      // Use native setter to work with React controlled inputs
      const nativeSetter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }

      // Reset _valueTracker so React detects old !== new
      const tracker = (element as unknown as { _valueTracker?: { setValue(v: string): void } })
        ._valueTracker;
      if (tracker) tracker.setValue(previousValue);

      element.dispatchEvent(new Event('input', { bubbles: true }));

      // Also invoke __reactProps$.onChange directly for embedded WebViews (Tauri)
      const el = element as unknown as Record<string, unknown>;
      const reactPropsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
      const reactProps = reactPropsKey
        ? (el[reactPropsKey] as Record<string, unknown> | undefined)
        : undefined;
      if (reactProps?.onChange && typeof reactProps.onChange === 'function') {
        (reactProps.onChange as (e: unknown) => void)({
          target: element,
          currentTarget: element,
          type: 'change',
          bubbles: true,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new Event('input'),
        });
      }

      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  private performSubmit(element: HTMLElement): void {
    const form = element instanceof HTMLFormElement ? element : element.closest('form');
    if (form) {
      // Dispatch submit event first (allows preventDefault)
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
      if (form.dispatchEvent(submitEvent)) {
        form.requestSubmit();
      }
    } else {
      throw new Error('No form found for submit action');
    }
  }

  private performReset(element: HTMLElement): void {
    const form = element instanceof HTMLFormElement ? element : element.closest('form');
    if (form) {
      form.reset();
      form.dispatchEvent(new Event('reset', { bubbles: true }));
    } else {
      throw new Error('No form found for reset action');
    }
  }

  /**
   * Perform a drag operation by dispatching a sequence of mouse events.
   *
   * Follows the same composite pattern as the qontinui core library:
   * mousedown on source → wait → mousemove × N along path → mouseup on target.
   *
   * Optionally dispatches HTML5 drag events (dragstart/dragover/drop/dragend)
   * for apps that use the HTML5 Drag and Drop API instead of mouse events.
   */
  private async performDrag(
    sourceElement: HTMLElement,
    options?: DragAction
  ): Promise<{ warning?: string }> {
    // Check if element appears to be draggable
    const computedStyle = window.getComputedStyle(sourceElement);
    const isDraggable =
      sourceElement.draggable ||
      sourceElement.getAttribute('aria-grabbed') !== null ||
      sourceElement.getAttribute('role') === 'slider' ||
      computedStyle.cursor === 'grab' ||
      computedStyle.cursor === 'move' ||
      computedStyle.cursor === 'grabbing';

    const sourceRect = sourceElement.getBoundingClientRect();
    const sourceX = sourceRect.left + (options?.sourceOffset?.x ?? sourceRect.width / 2);
    const sourceY = sourceRect.top + (options?.sourceOffset?.y ?? sourceRect.height / 2);

    // Resolve target position
    let targetX: number;
    let targetY: number;

    if (options?.targetPosition) {
      targetX = options.targetPosition.x;
      targetY = options.targetPosition.y;
    } else if (options?.target) {
      const targetElement = this.resolveTargetElement(options.target);
      if (!targetElement) {
        throw new Error(`Drag target element not found: ${JSON.stringify(options.target)}`);
      }
      const targetRect = targetElement.getBoundingClientRect();
      targetX = targetRect.left + (options?.targetOffset?.x ?? targetRect.width / 2);
      targetY = targetRect.top + (options?.targetOffset?.y ?? targetRect.height / 2);
    } else {
      throw new Error('Drag requires either target or targetPosition');
    }

    const steps = options?.steps ?? 10;
    const holdDelay = options?.holdDelay ?? 100;
    const releaseDelay = options?.releaseDelay ?? 50;

    // 1. Dispatch mousedown on source
    sourceElement.dispatchEvent(createMouseEventAt('mousedown', sourceX, sourceY));

    // 2. Optionally dispatch dragstart (HTML5 mode, requires DragEvent support)
    const canHTML5 = options?.html5 && typeof DragEvent !== 'undefined';
    if (canHTML5) {
      sourceElement.dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          clientX: sourceX,
          clientY: sourceY,
        })
      );
    }

    // 3. Wait hold delay (matches qontinui core's delay_between_mouse_down_and_move)
    if (holdDelay > 0) {
      await sleep(holdDelay);
    }

    // 4. Dispatch intermediate mousemove events along the path
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const currentX = sourceX + (targetX - sourceX) * progress;
      const currentY = sourceY + (targetY - sourceY) * progress;

      // Find the element under the cursor (falls back to source if unavailable)
      const dispatchTarget = elementFromPointSafe(currentX, currentY) || sourceElement;

      dispatchTarget.dispatchEvent(createMouseEventAt('mousemove', currentX, currentY));

      if (canHTML5) {
        dispatchTarget.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: currentX,
            clientY: currentY,
          })
        );
      }
    }

    // 5. Dispatch mouseup on the element under the final position
    const dropTarget = elementFromPointSafe(targetX, targetY) || sourceElement;

    dropTarget.dispatchEvent(createMouseEventAt('mouseup', targetX, targetY));

    // 6. Optionally dispatch drop + dragend (HTML5 mode)
    if (canHTML5) {
      dropTarget.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: targetX,
          clientY: targetY,
        })
      );
      sourceElement.dispatchEvent(
        new DragEvent('dragend', {
          bubbles: true,
          cancelable: true,
          clientX: targetX,
          clientY: targetY,
        })
      );
    }

    // 7. Wait release delay (matches qontinui core's delay_after_drag)
    if (releaseDelay > 0) {
      await sleep(releaseDelay);
    }

    return {
      warning: isDraggable
        ? undefined
        : 'Element does not appear to be draggable (no draggable attribute, aria-grabbed, or grab/move cursor). Drag events were dispatched but may have no effect.',
    };
  }

  /**
   * Resolve a drag target element from a target descriptor.
   */
  private resolveTargetElement(target: NonNullable<DragAction['target']>): HTMLElement | null {
    if (target.elementId) {
      const registered = this.registry.getElement(target.elementId);
      if (registered?.element) return registered.element;
      // Fall back to DOM lookup by identifier
      return findElementByIdentifier(target.elementId);
    }
    if (target.selector) {
      return document.querySelector<HTMLElement>(target.selector);
    }
    return null;
  }

  /**
   * Generate a deterministic, semantic ID for an unregistered element.
   *
   * Priority:
   *  1. data-testid attribute
   *  2. HTML id attribute (skip React auto-generated IDs like `:r1a:`)
   *  3. Semantic ID: {tagName}-{slugified label}[-{index}]
   *
   * The semantic fallback produces stable IDs across discover() calls as
   * long as the element's label and DOM position don't change, making
   * them usable with executeAction().
   */
  private getElementId(element: HTMLElement): string {
    const testId = element.getAttribute('data-testid');
    if (testId) return testId;

    const htmlId = element.id;
    if (htmlId && !/^:r[0-9a-z]+:$/i.test(htmlId)) return htmlId;

    // Build a semantic ID from the tag name + accessible label
    const tag = element.tagName.toLowerCase();
    const label =
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.textContent?.trim().slice(0, 40) ||
      '';
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);

    const base = slug ? `${tag}-${slug}` : tag;

    // Disambiguate: check how many identical IDs we've already cached
    if (!this.discoveryCache.has(base)) return base;

    // Look for a free numeric suffix
    let i = 1;
    while (this.discoveryCache.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  private getElementLabel(element: HTMLElement): string | undefined {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // Resolve aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const resolved = labelledBy
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean)
        .join(' ');
      if (resolved) return resolved;
    }

    return (
      element.getAttribute('title') || element.textContent?.trim().substring(0, 50) || undefined
    );
  }

  private getAccessibleName(element: HTMLElement): string | undefined {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labels = labelledBy
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      if (labels.length > 0) return labels.join(' ');
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      if (element.id) {
        const label = document.querySelector<HTMLLabelElement>(`label[for="${element.id}"]`);
        if (label) return label.textContent?.trim();
      }
    }

    return (
      element.getAttribute('title') || element.textContent?.trim().substring(0, 50) || undefined
    );
  }

  private inferElementType(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute('role');

    if (role) {
      switch (role) {
        case 'button':
          return 'button';
        case 'textbox':
          return 'input';
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'link':
          return 'link';
        case 'listbox':
        case 'combobox':
          return 'select';
        case 'menu':
          return 'menu';
        case 'menuitem':
          return 'menuitem';
        case 'tab':
          return 'tab';
        case 'dialog':
          return 'dialog';
      }
    }

    switch (tagName) {
      case 'button':
        return 'button';
      case 'input': {
        const type = (element as HTMLInputElement).type;
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        return 'input';
      }
      case 'textarea':
        return 'textarea';
      case 'select':
        return 'select';
      case 'a':
        return 'link';
      case 'form':
        return 'form';
      default:
        return 'custom';
    }
  }

  private inferActions(element: HTMLElement): string[] {
    const type = this.inferElementType(element);
    const baseActions = ['focus', 'blur', 'hover', 'sendKeys', 'scroll', 'scrollIntoView'];

    switch (type) {
      case 'button':
        return [...baseActions, 'click', 'doubleClick', 'rightClick', 'middleClick'];
      case 'input':
        return [...baseActions, 'click', 'type', 'clear'];
      case 'textarea':
        return [...baseActions, 'click', 'type', 'clear'];
      case 'select':
        return [...baseActions, 'click', 'select'];
      case 'checkbox':
        return [...baseActions, 'click', 'check', 'uncheck', 'toggle'];
      case 'radio':
        return [...baseActions, 'click', 'check'];
      case 'link':
        return [...baseActions, 'click'];
      case 'tab':
        return [...baseActions, 'click', 'middleClick'];
      default:
        return [...baseActions, 'click'];
    }
  }

  // ---------------------------------------------------------------------------
  // Batch execution
  // ---------------------------------------------------------------------------

  /**
   * Execute multiple actions sequentially in a single call, reducing IPC round-trips.
   */
  async executeBatch(request: BatchActionRequest): Promise<BatchActionResponse> {
    const startTime = performance.now();
    const { steps, stopOnFailure = true, delayBetweenMs = 0 } = request;
    const results: BatchActionStepResult[] = [];
    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let stopped = false;

    for (let i = 0; i < steps.length; i++) {
      if (stopped) {
        skippedCount++;
        continue;
      }

      const step = steps[i];

      // Inter-step delay (skip before first step)
      if (i > 0 && delayBetweenMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));
      }

      const response = await this.executeAction(step.elementId, step.action);
      const stepResult: BatchActionStepResult = {
        index: i,
        label: step.label,
        elementId: step.elementId,
        response,
      };
      results.push(stepResult);

      if (response.success) {
        succeededCount++;
      } else {
        failedCount++;
        if (stopOnFailure) {
          stopped = true;
        }
      }
    }

    return {
      success: failedCount === 0,
      results,
      succeededCount,
      failedCount,
      skippedCount,
      durationMs: performance.now() - startTime,
      timestamp: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Action-error enrichment helpers
// ---------------------------------------------------------------------------

/**
 * Enrich raw browser events with severity, fingerprint, and source location.
 */
function enrichEvents(events: AnyCapturedEvent[]): ActionBrowserEvent[] {
  return events.map((event) => {
    const { severity, reason } = classifyEvent(event);
    const fingerprint = computeFingerprint(event);
    const stack = 'stack' in event ? (event as { stack?: string }).stack : undefined;
    return {
      event,
      severity,
      reason,
      fingerprint,
      sourceLocation: extractSourceLocation(stack),
    };
  });
}

/**
 * Compute error diff between before and after event snapshots.
 * "New" = fingerprints present after but not before.
 * "Resolved" = fingerprints present before but not after.
 */
function computeActionErrorDiff(
  fingerprintsBefore: Set<string>,
  eventsBefore: AnyCapturedEvent[],
  eventsAfter: AnyCapturedEvent[]
): ActionErrorDiff | undefined {
  const fingerprintsAfter = new Set(eventsAfter.map(computeFingerprint));

  // Find new fingerprints (in after but not in before)
  const newFingerprints = new Set<string>();
  for (const fp of fingerprintsAfter) {
    if (!fingerprintsBefore.has(fp)) newFingerprints.add(fp);
  }

  // Find resolved fingerprints (in before but not in after)
  const resolvedFingerprints = new Set<string>();
  for (const fp of fingerprintsBefore) {
    if (!fingerprintsAfter.has(fp)) resolvedFingerprints.add(fp);
  }

  // No changes — skip the diff entirely
  if (newFingerprints.size === 0 && resolvedFingerprints.size === 0) {
    return undefined;
  }

  // Build enriched lists: pick representative event per fingerprint
  const newErrors = enrichEvents(
    eventsAfter.filter((e) => newFingerprints.has(computeFingerprint(e)))
  );
  const resolvedErrors = enrichEvents(
    eventsBefore.filter((e) => resolvedFingerprints.has(computeFingerprint(e)))
  );

  // Deduplicate: keep one per fingerprint
  const deduped = (list: ActionBrowserEvent[]) => {
    const seen = new Set<string>();
    return list.filter((e) => {
      if (seen.has(e.fingerprint)) return false;
      seen.add(e.fingerprint);
      return true;
    });
  };

  const dedupedNew = deduped(newErrors);
  const dedupedResolved = deduped(resolvedErrors);

  const countErrors = (list: ActionBrowserEvent[]) =>
    list.filter((e) => e.severity === 'crash' || e.severity === 'error').length;

  return {
    newErrors: dedupedNew,
    resolvedErrors: dedupedResolved,
    errorDelta: countErrors(dedupedNew) - countErrors(dedupedResolved),
  };
}

/**
 * Safely serialize a value, replacing functions and handling circular references.
 */
function safeSerialize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return '[Function]';
  if (typeof value !== 'object') return value;

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => safeSerialize(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    try {
      result[key] = safeSerialize((obj as Record<string, unknown>)[key], seen);
    } catch {
      result[key] = '[Error reading property]';
    }
  }
  return result;
}

/**
 * Extract React state from a DOM element's React fiber internals.
 *
 * Walks the `__reactFiber$` key to extract `memoizedState` (useState values)
 * and the `__reactProps$` key for current props.
 */
export function extractReactState(element: HTMLElement): ReactStateInfo | null {
  const el = element as unknown as Record<string, unknown>;

  // Find React internal keys
  const reactPropsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
  const reactFiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));

  if (!reactPropsKey && !reactFiberKey) {
    return null; // Not a React-managed element
  }

  // Extract props (replace functions with marker strings)
  const rawProps = reactPropsKey
    ? ((el[reactPropsKey] as Record<string, unknown> | undefined) ?? {})
    : {};
  const props = safeSerialize(rawProps) as Record<string, unknown>;

  // Walk the memoizedState linked list to extract useState/useReducer values
  const fiberState: unknown[] = [];
  let componentName: string | undefined;

  if (reactFiberKey) {
    const fiber = el[reactFiberKey] as Record<string, unknown> | undefined;
    if (fiber) {
      // Walk up to find the nearest function/class component
      let current: Record<string, unknown> | undefined = fiber;
      while (current) {
        const type = current.type;
        if (typeof type === 'function') {
          componentName =
            (type as { displayName?: string; name?: string }).displayName ||
            (type as { name?: string }).name ||
            undefined;
          break;
        }
        current = current.return as Record<string, unknown> | undefined;
      }

      // Extract memoizedState chain from the component fiber (not the DOM fiber)
      const componentFiber = current || fiber;
      let stateNode = componentFiber?.memoizedState as Record<string, unknown> | null;
      let stateCount = 0;
      const maxStates = 20; // Safety limit
      while (stateNode && stateCount < maxStates) {
        fiberState.push(safeSerialize(stateNode.memoizedState));
        stateNode = stateNode.next as Record<string, unknown> | null;
        stateCount++;
      }
    }
  }

  return { props, fiberState, componentName };
}

/**
 * Create an action executor
 */
export function createActionExecutor(
  registry: UIBridgeRegistry,
  consoleCapture?: BrowserEventCapture
): ActionExecutor {
  return new DefaultActionExecutor(registry, consoleCapture);
}

// ---------------------------------------------------------------------------
// Server-side batch execution (POST /ui-bridge/batch)
// ---------------------------------------------------------------------------

/** Maximum batch size accepted by the server. */
export const MAX_BATCH_SIZE = 50;

/**
 * Execute multiple UI Bridge operations in a single HTTP round-trip via the
 * server-side batch endpoint (`POST /ui-bridge/batch`).
 *
 * This is distinct from `ActionExecutor.executeBatch()` which executes
 * browser-side actions sequentially in the SDK. This function sends operations
 * to the Rust relay server, which dispatches each operation through its
 * standard IPC path (including circuit breaker, concurrency, and timeout logic).
 *
 * @param baseUrl - Base URL of the UI Bridge server (e.g., "http://localhost:1420")
 * @param operations - Array of operations to execute
 * @param options - Optional settings (stopOnError)
 * @returns The batch response with per-operation results and timing
 *
 * @example
 * ```ts
 * const response = await batch('http://localhost:1420', [
 *   { id: 'op1', operation: 'discover', params: { interactiveOnly: true } },
 *   { id: 'op2', operation: 'get_elements' },
 * ], { stopOnError: true });
 * ```
 */
export async function batch(
  baseUrl: string,
  operations: ServerBatchOperation[],
  options?: ServerBatchOptions
): Promise<ServerBatchResponse> {
  if (operations.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${operations.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/ui-bridge/batch`;
  const body = JSON.stringify({
    operations,
    stopOnError: options?.stopOnError ?? false,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail: string;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error ?? parsed.data?.error ?? text;
    } catch {
      detail = text;
    }
    throw new Error(`Batch request failed (HTTP ${response.status}): ${detail}`);
  }

  const json = await response.json();

  // The server wraps the real payload in ApiResponse { success, data, error }
  const payload = json.data ?? json;
  return {
    success: payload.success,
    results: payload.results,
    totalDurationMs: payload.totalDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Control batch execution (POST /ui-bridge/control/batch)
// ---------------------------------------------------------------------------

/**
 * Execute a sequence of element actions via the control batch endpoint
 * (`POST /ui-bridge/control/batch`).
 *
 * Unlike the lower-level `batch()` helper (which dispatches arbitrary IPC
 * operations), `controlBatch()` accepts simplified action steps with
 * `elementId` / `action` / `params` and returns per-step timing plus a
 * snapshot diff showing which element IDs were added or removed.
 *
 * @param baseUrl - Base URL of the UI Bridge server (e.g., "http://localhost:1420")
 * @param steps - Array of action steps to execute
 * @param options - Optional settings
 * @returns The batch response with per-step results, timing, and snapshot diff
 *
 * @example
 * ```ts
 * const response = await controlBatch('http://localhost:1420', [
 *   { elementId: 'btn-save', action: 'click' },
 *   { elementId: 'input-name', action: 'type', params: { text: 'Alice' } },
 * ], { stopOnError: true });
 * ```
 */
export async function controlBatch(
  baseUrl: string,
  steps: ControlBatchStep[],
  options?: { stopOnError?: boolean }
): Promise<ControlBatchResponse> {
  if (steps.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${steps.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/ui-bridge/control/batch`;
  const body = JSON.stringify({
    steps,
    stopOnError: options?.stopOnError ?? true,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail: string;
    try {
      const parsed = JSON.parse(text);
      // Handle structured batch_size_exceeded error
      const errorData = parsed.error ? JSON.parse(parsed.error) : parsed.data;
      if (errorData?.error === 'batch_size_exceeded') {
        throw new Error(
          `Batch size exceeded: max ${errorData.max}, received ${errorData.received}`
        );
      }
      detail = parsed.error ?? parsed.data?.error ?? text;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Batch size exceeded')) throw e;
      detail = text;
    }
    throw new Error(`Control batch request failed (HTTP ${response.status}): ${detail}`);
  }

  const json = await response.json();
  const payload = json.data ?? json;

  return {
    success: payload.success ?? json.success,
    results: payload.results ?? [],
    totalMs: payload.totalMs ?? 0,
    snapshotDiff: payload.snapshotDiff ?? null,
    stoppedEarly: payload.stoppedEarly ?? false,
  };
}
