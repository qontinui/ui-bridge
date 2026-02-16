/**
 * Action Executor
 *
 * Executes actions on registered elements and components.
 */

import type { UIBridgeRegistry } from '../core/registry';
import type { WaitOptions, ElementState, StandardAction } from '../core/types';
import type { CapturedError } from '../debug/browser-capture-types';
import type { BrowserEventCapture } from '../debug/browser-capture';
import { findElementByIdentifier } from '../core/element-identifier';
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  WaitResult,
  FindRequest,
  FindResponse,
  DiscoveredElement,
  ControlSnapshot,
  ActionExecutor,
  TypeAction,
  SelectAction,
  ScrollAction,
  MouseAction,
  DragAction,
} from './types';

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
    },
  };

  // Populate textContent from the element's visible text
  const rawText = element.textContent?.trim();
  if (rawText) {
    // Collapse whitespace and truncate to avoid storing huge text
    state.textContent = rawText.replace(/\s+/g, ' ').slice(0, 500);
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
  }

  return state;
}

function isVisible(element: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;
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
  constructor(
    private registry: UIBridgeRegistry,
    private consoleCapture?: BrowserEventCapture
  ) {}

  /**
   * Execute an action on an element
   */
  async executeAction(
    elementId: string,
    request: ControlActionRequest
  ): Promise<ControlActionResponse> {
    const startTime = performance.now();
    let waitDurationMs = 0;

    try {
      // Find the element
      const registered = this.registry.getElement(elementId);
      let element: HTMLElement | null = registered?.element ?? null;

      // If not registered, try to find by identifier
      if (!element) {
        element = findElementByIdentifier(elementId);
      }

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${elementId}`,
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

      // Execute the action
      const actionStartTime = Date.now();
      const result = await this.performAction(element, request.action, request.params);

      // Brief wait to catch immediate async errors (promise rejections from click handlers)
      let consoleErrors: CapturedError[] | undefined;
      if (this.consoleCapture) {
        await sleep(50);
        const errors = this.consoleCapture.getConsoleSince(actionStartTime);
        if (errors.length > 0) consoleErrors = errors;
      }

      return {
        success: true,
        elementState: getElementState(element),
        result,
        consoleErrors,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
        waitDurationMs,
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
          error: `Component not found: ${componentId}`,
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
        '[data-ui-id]',
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

        // Check if registered
        const registered = this.registry.findByDOMElement(el);

        elements.push({
          id: registered?.id || this.getElementId(el),
          type: registered?.type || this.inferElementType(el),
          label: registered?.label || this.getElementLabel(el),
          tagName: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          accessibleName: this.getAccessibleName(el),
          actions: registered?.actions || this.inferActions(el),
          state,
          registered: !!registered,
          category: registered?.category || 'interactive',
          contentMetadata: registered?.contentMetadata,
        });
      }
    }

    // Include content elements from registry when requested
    if (options?.includeContent || options?.contentOnly) {
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
          contentMetadata: el.contentMetadata,
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
   * Perform an action on an element
   */
  private async performAction(
    element: HTMLElement,
    action: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    switch (action as StandardAction) {
      case 'click':
        return this.performClick(element, params as MouseAction);
      case 'doubleClick':
        return this.performDoubleClick(element, params as MouseAction);
      case 'rightClick':
        return this.performRightClick(element, params as MouseAction);
      case 'type':
        return this.performType(element, params as unknown as TypeAction);
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
    element.dispatchEvent(createMouseEvent('mousedown', element, options));
    element.dispatchEvent(createMouseEvent('mouseup', element, options));
    element.dispatchEvent(createMouseEvent('click', element, options));
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

    element.focus();

    if (options?.clear) {
      if (nativeSetter) {
        nativeSetter.call(element, '');
      } else {
        element.value = '';
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
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
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (delay > 0) {
        await sleep(delay);
      }
    }

    if (options?.triggerEvents !== false) {
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  private performClear(element: HTMLElement): void {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
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
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  private performSelect(element: HTMLElement, options?: SelectAction): void {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error('Select action requires a select element');
    }

    const values = Array.isArray(options?.value) ? options.value : [options?.value];

    if (!options?.additive) {
      // Clear existing selection for single select or when not additive
      for (const option of element.options) {
        option.selected = false;
      }
    }

    for (const option of element.options) {
      const matchValue = options?.byLabel ? option.text : option.value;
      if (values.includes(matchValue)) {
        option.selected = true;
      }
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
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

  private performScroll(element: HTMLElement, options?: ScrollAction): void {
    if (options?.toElement) {
      const target = document.querySelector<HTMLElement>(options.toElement);
      if (target) {
        target.scrollIntoView({ behavior: options.smooth ? 'smooth' : 'auto' });
        return;
      }
    }

    if (options?.position) {
      element.scrollTo({
        left: options.position.x,
        top: options.position.y,
        behavior: options.smooth ? 'smooth' : 'auto',
      });
      return;
    }

    const amount = options?.amount || 100;
    const direction = options?.direction || 'down';

    switch (direction) {
      case 'up':
        element.scrollBy({ top: -amount, behavior: options?.smooth ? 'smooth' : 'auto' });
        break;
      case 'down':
        element.scrollBy({ top: amount, behavior: options?.smooth ? 'smooth' : 'auto' });
        break;
      case 'left':
        element.scrollBy({ left: -amount, behavior: options?.smooth ? 'smooth' : 'auto' });
        break;
      case 'right':
        element.scrollBy({ left: amount, behavior: options?.smooth ? 'smooth' : 'auto' });
        break;
    }
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
    }
  }

  private performToggle(element: HTMLElement): void {
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      element.checked = !element.checked;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  private performSetValue(element: HTMLElement, params?: Record<string, unknown>): void {
    const value = params?.value as string | undefined;
    if (value === undefined) {
      throw new Error('setValue requires a "value" parameter');
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
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
      element.dispatchEvent(new Event('input', { bubbles: true }));
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
  private async performDrag(sourceElement: HTMLElement, options?: DragAction): Promise<void> {
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

  private getElementId(element: HTMLElement): string {
    return (
      element.getAttribute('data-ui-id') ||
      element.getAttribute('data-testid') ||
      element.id ||
      `${element.tagName.toLowerCase()}-${Math.random().toString(36).substr(2, 8)}`
    );
  }

  private getElementLabel(element: HTMLElement): string | undefined {
    return (
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.textContent?.trim().substring(0, 50) ||
      undefined
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
    const baseActions = ['focus', 'blur', 'hover'];

    switch (type) {
      case 'button':
        return [...baseActions, 'click', 'doubleClick', 'rightClick'];
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
      default:
        return [...baseActions, 'click'];
    }
  }
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
