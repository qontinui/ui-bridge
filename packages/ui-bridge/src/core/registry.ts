/**
 * Element and Component Registry
 *
 * Central registry for all UI elements and components registered with UI Bridge.
 * Provides methods for registration, lookup, and lifecycle management.
 */

import type {
  RegisteredElement,
  RegisteredComponent,
  Workflow,
  ElementState,
  ElementType,
  StandardAction,
  CustomAction,
  BridgeEvent,
  BridgeEventType,
  BridgeEventListener,
  BridgeSnapshot,
  UIState,
  UIStateGroup,
  UITransition,
  PathResult,
  TransitionResult,
  NavigationResult,
  StateSnapshot,
  ComponentStateResponse,
  StateGetter,
  ContentMetadata,
  MediaMetadata,
  ElementLogLevel,
  ElementHistoryOptions,
  ElementLogEntry,
} from './types';
import type { ElementEventLog } from '../debug/element-event-log';
import { createElementIdentifier } from './element-identifier';
import { computeElementFingerprint } from './element-fingerprint';
import { createStableRef } from './stable-ref';
import { fuzzyMatch } from '../ai/fuzzy-matcher';
import { generateAliases, generateDescription } from '../ai/alias-generator';
import type { SearchCriteria, SearchResult, AIDiscoveredElement } from '../ai/types';

/**
 * Single source of truth for serializing a `RegisteredElement` to a snapshot
 * entry. Used by `createSnapshot`/`createSnapshotAsync` here AND by the
 * runner's `serializeElement` helper so the two paths cannot drift. When you
 * add a field to `RegisteredElement` that should appear in serialized form,
 * add it here only.
 *
 * Returns the snapshot-shape (no `registeredAt`/`mounted`/`element`). Wrappers
 * that need additional fields can spread and extend.
 *
 * @param options.componentBasePath  Prefix for `componentActionBasePath`. Defaults
 *   to `/control/component` (correct for the standalone ui-bridge server).
 *   The runner mounts routes under `/ui-bridge/...` so it should pass
 *   `/ui-bridge/control/component`.
 */
export function serializeRegisteredElement(
  el: RegisteredElement,
  options: { componentBasePath?: string } = {}
): BridgeSnapshot['elements'][number] {
  const componentBasePath = options.componentBasePath ?? '/control/component';
  // High-level `kind` — mirrors `category` for the "interactive" / "content"
  // split so snapshot filters (?interactiveOnly=true) don't have to branch
  // on the richer `category` enum. Media elements keep `kind` undefined;
  // clients that care specifically about media filter on `category`.
  const kind: 'interactive' | 'content' | undefined =
    el.category === 'content'
      ? 'content'
      : el.category === 'interactive'
        ? 'interactive'
        : undefined;
  return {
    id: el.id,
    type: el.type,
    tagName: el.element.tagName.toLowerCase(),
    label: el.label,
    identifier: el.getIdentifier(),
    state: el.getState(),
    actions: el.actions,
    customActions: el.customActions ? Object.keys(el.customActions) : undefined,
    category: el.category,
    kind,
    content: el.content,
    role: el.role,
    contentMetadata: el.contentMetadata,
    mediaMetadata: el.mediaMetadata,
    ownedByComponent: el.ownedByComponent,
    componentActionBasePath: el.ownedByComponent
      ? `${componentBasePath}/${el.ownedByComponent}`
      : undefined,
    // Live bbox/visibility maintained by `useUIElement`. Present for elements
    // whose hook attached a ref (or that matched via `[data-ui-bridge-id]`).
    // Runners use this to dispatch clicks via DOM coords without VLM grounding.
    bbox: el.bbox,
    visible: el.visible,
    // `'hook'` for explicit useUIElement registrations, `'auto'` for
    // DOM-walker entries from useAutoRegister. Snapshot consumers that care
    // about developer-instrumented vs. scanner-discovered elements filter here.
    origin: el.origin,
    // Structured disambiguation metadata (all optional). Passthrough of the
    // four hints the consumer set on `useUIElement` so NL queries can rank
    // candidates without VLM grounding. Absent fields keep today's behavior.
    variant: el.variant,
    position: el.position,
    color: el.color,
    contextPath: el.contextPath,
    stableRef: el.element?.isConnected
      ? (() => {
          const ref = createStableRef(el);
          return {
            id: ref.id,
            fingerprint: ref.fingerprint,
            semanticPath: ref.semanticPath,
            stableId: ref.stableId,
          };
        })()
      : undefined,
    // Route captured at registration time. Mirrored on the snapshot element
    // so consumers can cross-check `registration.byRoute` against individual
    // entries without a second call.
    route: el.route,
  };
}

/**
 * Capture form-specific state (required, validation, constraints) for a form control element.
 */
function captureFormControlState(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  state: ElementState
): void {
  // Required
  if (element.required || element.getAttribute('aria-required') === 'true') {
    state.required = true;
  }

  // HTML5 Constraint Validation API
  if ('validity' in element) {
    const v = element.validity;
    if (!v.valid || element.validationMessage) {
      state.validationState = {
        valid: v.valid,
        validationMessage: element.validationMessage || undefined,
        valueMissing: v.valueMissing || undefined,
        typeMismatch: v.typeMismatch || undefined,
        patternMismatch: v.patternMismatch || undefined,
        tooShort: v.tooShort || undefined,
        tooLong: v.tooLong || undefined,
        rangeUnderflow: v.rangeUnderflow || undefined,
        rangeOverflow: v.rangeOverflow || undefined,
        stepMismatch: v.stepMismatch || undefined,
        customError: v.customError || undefined,
      };
    }
  }

  // Constraint attributes
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const constraints: ElementState['constraints'] = {};
    let hasConstraint = false;

    if (element instanceof HTMLInputElement) {
      if (element.pattern) {
        constraints.pattern = element.pattern;
        hasConstraint = true;
      }
      if (element.min) {
        constraints.min = element.min;
        hasConstraint = true;
      }
      if (element.max) {
        constraints.max = element.max;
        hasConstraint = true;
      }
      if (element.step && element.step !== 'any') {
        constraints.step = element.step;
        hasConstraint = true;
      }
    }
    if (element.minLength > 0) {
      constraints.minLength = element.minLength;
      hasConstraint = true;
    }
    if (element.maxLength >= 0 && element.maxLength < 524288) {
      constraints.maxLength = element.maxLength;
      hasConstraint = true;
    }

    if (hasConstraint) {
      state.constraints = constraints;
    }
  }
}

/**
 * Compute the accessible name for an element (aria-label > aria-labelledby
 * > associated <label for=""> > title attribute > short text content fallback).
 */
function computeAccessibleName(element: HTMLElement): string | undefined {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter((t): t is string => !!t);
    if (parts.length > 0) return parts.join(' ');
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.id) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${element.id}"]`);
      const labelText = label?.textContent?.trim();
      if (labelText) return labelText;
    }
  }

  const title = element.getAttribute('title');
  if (title) return title;

  const rawText = element.textContent?.trim();
  if (rawText) {
    return rawText.length <= 80 ? rawText : rawText.slice(0, 80);
  }

  return undefined;
}

/**
 * Get the current state of an element
 */
function getElementState(element: HTMLElement): ElementState {
  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);

  const inViewport =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0;

  const roleAttr = element.getAttribute('role') || undefined;
  const accessibleName = computeAccessibleName(element);

  const state: ElementState = {
    visible: isElementVisible(element, rect, computedStyle, inViewport),
    enabled: !isElementDisabled(element),
    focused: document.activeElement === element,
    role: roleAttr,
    accessibleName,
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
    textContent: element.textContent?.trim() || undefined,
    computedStyles: {
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      opacity: computedStyle.opacity,
      pointerEvents: computedStyle.pointerEvents,
      cursor: computedStyle.cursor,
      color: computedStyle.color,
      backgroundColor: computedStyle.backgroundColor,
      colorScheme: computedStyle.colorScheme,
      fontSize: computedStyle.fontSize,
      fontWeight: computedStyle.fontWeight,
      lineHeight: computedStyle.lineHeight,
      overflow: computedStyle.overflow,
      textOverflow: computedStyle.textOverflow,
      whiteSpace: computedStyle.whiteSpace,
      position: computedStyle.position,
      zIndex: computedStyle.zIndex,
      padding: computedStyle.padding,
      margin: computedStyle.margin,
      borderColor: computedStyle.borderColor,
      borderWidth: computedStyle.borderWidth,
      borderRadius: computedStyle.borderRadius,
    },
    inViewport,
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

  // Scroll container info — only for elements with overflowing scrollable content
  if (isScrollContainer(element, computedStyle)) {
    state.scrollInfo = {
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      canScrollUp: element.scrollTop > 0,
      canScrollDown: element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      canScrollLeft: element.scrollLeft > 0,
      canScrollRight: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
    };
  }

  // Fallback for icon-only elements (no textContent but has aria-label/title)
  if (!state.textContent) {
    state.textContent =
      element.getAttribute('aria-label') || element.getAttribute('title') || undefined;
  }

  // Opacity hidden detection
  const opacityVal = parseFloat(computedStyle.opacity);
  if (opacityVal === 0) {
    state.opacityHidden = true;
  }

  // data-content-* attributes — surfaced so agents can address elements
  // by semantic labels (e.g., data-content-label="save wsv settings")
  // and verification workflows can match spec assertion targets.
  const contentLabel = element.getAttribute('data-content-label');
  if (contentLabel) {
    (state as unknown as Record<string, unknown>).dataContentLabel = contentLabel;
  }
  const contentRole = element.getAttribute('data-content-role');
  if (contentRole) {
    (state as unknown as Record<string, unknown>).dataContentRole = contentRole;
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
  const ariaCheckedAttr = element.getAttribute('aria-checked');
  if (ariaCheckedAttr !== null) {
    state.ariaChecked = ariaCheckedAttr === 'mixed' ? 'mixed' : ariaCheckedAttr === 'true';
    // Also populate checked for switch/checkbox roles so callers get a boolean
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

  // Add input-specific state
  if (element instanceof HTMLInputElement) {
    state.value = element.value;
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    }
    captureFormControlState(element, state);
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = element.value;
    captureFormControlState(element, state);
  } else if (element instanceof HTMLSelectElement) {
    state.value = element.value;
    state.selectedOptions = Array.from(element.selectedOptions).map((opt) => opt.value);
    state.availableOptions = Array.from(element.options).map((opt) => ({
      value: opt.value,
      label: opt.label || opt.textContent?.trim() || opt.value,
      selected: opt.selected,
    }));
    captureFormControlState(element, state);
  }

  // Capture href for anchor elements
  if (element instanceof HTMLAnchorElement && element.href) {
    state.href = element.href;
  }

  // Capture data-route for navigation elements
  const dataRoute = element.getAttribute('data-route');
  if (dataRoute) {
    state.dataRoute = dataRoute;
  }

  return state;
}

/**
 * Check if an element is truly visible — not just in the viewport, but
 * actually reachable (not clipped by ancestor overflow, not covered by
 * another element in a higher stacking context).
 *
 * Uses `elementFromPoint` as a hit-test: if the element (or one of its
 * descendants) is at its own centre point, it's genuinely visible.
 */
function isElementVisible(
  element: HTMLElement,
  rect: DOMRect,
  style: CSSStyleDeclaration,
  inViewport: boolean
): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;
  if (!inViewport) return false;

  // Hit-test: check if the element is actually rendered at its centre.
  // This catches elements hidden by ancestor overflow:hidden, scroll
  // clipping, clip-path, or z-index occlusion.
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // Centre must be within the viewport for elementFromPoint to work
  if (cx >= 0 && cx < window.innerWidth && cy >= 0 && cy < window.innerHeight) {
    const hit = document.elementFromPoint(cx, cy);
    if (hit !== null && hit !== element && !element.contains(hit)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if an element is a scroll container (has overflowing scrollable content).
 * Reuses the already-computed style to avoid an extra getComputedStyle call.
 */
function isScrollContainer(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  // Quick check: if content doesn't overflow, skip
  if (element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth) {
    return false;
  }

  const oy = style.overflowY;
  const ox = style.overflowX;
  return oy === 'auto' || oy === 'scroll' || ox === 'auto' || ox === 'scroll';
}

/**
 * Check if an element is disabled
 */
function isElementDisabled(element: HTMLElement): boolean {
  if ('disabled' in element && (element as HTMLButtonElement).disabled) {
    return true;
  }
  if (element.getAttribute('aria-disabled') === 'true') {
    return true;
  }
  return false;
}

/**
 * Infer available actions based on element type
 */
function inferActions(type: ElementType): StandardAction[] {
  const baseActions: StandardAction[] = ['focus', 'blur', 'hover', 'scroll', 'scrollIntoView'];

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
    case 'form':
      return ['focus', 'blur'];
    case 'menu':
    case 'menuitem':
      return [...baseActions, 'click'];
    case 'tab':
      return [...baseActions, 'click', 'middleClick'];
    case 'dialog':
      return ['focus', 'blur'];
    case 'custom':
    default:
      return [...baseActions, 'click'];
  }
}

/**
 * Infer element type from HTML element
 */
function inferElementType(element: HTMLElement): ElementType {
  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute('role');

  // Check role first
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

  // Check tag name
  switch (tagName) {
    case 'button':
      return 'button';
    case 'input': {
      const inputType = (element as HTMLInputElement).type;
      if (inputType === 'checkbox') return 'checkbox';
      if (inputType === 'radio') return 'radio';
      if (inputType === 'submit' || inputType === 'button') return 'button';
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

/**
 * Registry options
 */
/**
 * Duration (ms) to keep recently-unmounted element refs for fingerprint-based
 * ID preservation across React re-renders. Tunable per-registry via
 * `RegistryOptions.remountCacheWindowMs`.
 */
export const DEFAULT_REMOUNT_CACHE_WINDOW_MS = 2000;

export interface RegistryOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Callback when an event occurs */
  onEvent?: BridgeEventListener;
  /** Element event log for per-element observability */
  elementEventLog?: ElementEventLog;
  /** Preserve element IDs across React remounts by fingerprint matching (default: false) */
  preserveIdAcrossRemount?: boolean;
  /** How long (ms) to keep recently-unmounted refs for remount matching (default: 2000) */
  remountCacheWindowMs?: number;
}

/**
 * UI Bridge Registry
 *
 * Central registry for managing elements, components, and workflows.
 */
export interface RegistrySnapshot {
  elements: RegisteredElement[];
  components: RegisteredComponent[];
  workflows: Workflow[];
  version: number;
}

export class UIBridgeRegistry {
  private elements = new Map<string, RegisteredElement>();
  private components = new Map<string, RegisteredComponent>();
  private workflows = new Map<string, Workflow>();
  private eventListeners = new Map<BridgeEventType, Set<BridgeEventListener>>();
  private options: RegistryOptions;

  // State management
  private states = new Map<string, UIState>();
  private stateGroups = new Map<string, UIStateGroup>();
  private transitions = new Map<string, UITransition>();
  private activeStates = new Set<string>();

  // Recently removed elements for remount ID preservation
  private recentlyRemoved = new Map<
    string,
    { id: string; fingerprint: string; removedAt: number }
  >();

  // ── F3: Snapshot registration metadata ────────────────────────────────────
  // Sticky latch: flips true the first time any element registers and stays
  // true for the rest of this registry instance's lifetime, including across
  // unregister cycles. Lets snapshot consumers distinguish "bridge has never
  // seen a registration" (no SDK coverage on this page) from "registrations
  // happened but are all unmounted now". Never reset except on `clear()`.
  private everHadRegistrationsFlag = false;

  // Per-route tally of currently-registered elements. Mirrors
  // `elements.size` partitioned by `RegisteredElement.route`. Incremented on
  // register, decremented on unregister, and a zero count is dropped from
  // the map so `byRoute` never emits `{ "/foo": 0 }`. Elements registered
  // without a route (non-DOM environment) are tracked under the empty-string
  // key `""` — snapshot serialization filters that bucket out.
  private routeCounts = new Map<string, number>();

  // External store pattern for useSyncExternalStore
  private storeVersion = 0;
  private storeListeners = new Set<() => void>();
  private cachedSnapshot: RegistrySnapshot | null = null;
  private notifyScheduled = false;

  constructor(options: RegistryOptions = {}) {
    this.options = options;
  }

  /**
   * Subscribe to registry changes (for useSyncExternalStore).
   * Returns an unsubscribe function.
   */
  subscribe(callback: () => void): () => void {
    this.storeListeners.add(callback);
    return () => {
      this.storeListeners.delete(callback);
    };
  }

  /**
   * Get a stable snapshot reference that changes only when the registry mutates.
   * Designed for useSyncExternalStore.
   */
  getSnapshot(): RegistrySnapshot {
    if (!this.cachedSnapshot || this.cachedSnapshot.version !== this.storeVersion) {
      this.cachedSnapshot = {
        elements: Array.from(this.elements.values()),
        components: Array.from(this.components.values()),
        workflows: Array.from(this.workflows.values()),
        version: this.storeVersion,
      };
    }
    return this.cachedSnapshot;
  }

  private notifyStoreListeners(): void {
    this.storeVersion++;
    this.cachedSnapshot = null;
    // Defer listener invocation to a microtask so a burst of
    // register/unregister calls during a React commit phase only wakes
    // subscribers once, after commit. Calling listeners synchronously from
    // within a ref callback causes useSyncExternalStore consumers to
    // re-render mid-commit, which can cascade into React error #185
    // (maximum update depth exceeded).
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of this.storeListeners) {
        listener();
      }
    });
  }

  /**
   * Emit an event
   */
  private emit<T>(type: BridgeEventType, data: T): void {
    const event: BridgeEvent<T> = {
      type,
      timestamp: Date.now(),
      data,
    };

    // Call global handler
    this.options.onEvent?.(event);

    // Call specific listeners
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${type}:`, error);
        }
      }
    }

    if (this.options.verbose) {
      console.log('[UIBridge]', type, data);
    }

    // Notify external store subscribers on mutation events
    if (
      typeof type === 'string' &&
      (type.startsWith('element:') || type.startsWith('component:') || type.startsWith('workflow:'))
    ) {
      this.notifyStoreListeners();
    }

    this.options.elementEventLog?.ingest(event as BridgeEvent);
  }

  /**
   * Register an event listener
   */
  on<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): () => void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener as BridgeEventListener);

    // Return unsubscribe function
    return () => {
      this.eventListeners.get(type)?.delete(listener as BridgeEventListener);
    };
  }

  /**
   * Dispatch an event from external sources (e.g., NavigationTracker).
   * Prefer using registry methods (registerElement, etc.) for internal events.
   */
  dispatchEvent<T>(type: BridgeEventType, data: T): void {
    this.emit(type, data);
  }

  /**
   * Remove an event listener
   */
  off<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): void {
    this.eventListeners.get(type)?.delete(listener as BridgeEventListener);
  }

  /**
   * Register an element
   */
  /**
   * Update a registered element's metadata/options in place.
   * See `updateComponent` for rationale. Does not replace the DOM element
   * reference — use `registerElement` if the element itself changed.
   */
  updateElement(
    id: string,
    options: {
      type?: ElementType;
      label?: string;
      actions?: StandardAction[];
      customActions?: Record<string, CustomAction>;
      category?: 'interactive' | 'content' | 'media';
      contentMetadata?: ContentMetadata;
      mediaMetadata?: MediaMetadata;
      /** Disambiguation hint — semantic role/intent. See RegisteredElement.variant. */
      variant?: string;
      /** Disambiguation hint — positional. See RegisteredElement.position. */
      position?: string;
      /** Disambiguation hint — dominant color. See RegisteredElement.color. */
      color?: string;
      /** Disambiguation hint — hierarchical semantic path. See RegisteredElement.contextPath. */
      contextPath?: string;
    }
  ): boolean {
    const existing = this.elements.get(id);
    if (!existing) return false;
    if (options.type !== undefined) existing.type = options.type;
    if (options.label !== undefined) existing.label = options.label;
    if (options.actions !== undefined) existing.actions = options.actions;
    if (options.customActions !== undefined) existing.customActions = options.customActions;
    if (options.category !== undefined) existing.category = options.category;
    if (options.contentMetadata !== undefined) existing.contentMetadata = options.contentMetadata;
    if (options.mediaMetadata !== undefined) existing.mediaMetadata = options.mediaMetadata;
    // Disambiguation metadata — mirror consumer updates verbatim.
    if (options.variant !== undefined) existing.variant = options.variant;
    if (options.position !== undefined) existing.position = options.position;
    if (options.color !== undefined) existing.color = options.color;
    if (options.contextPath !== undefined) existing.contextPath = options.contextPath;
    return true;
  }

  /**
   * Update the live viewport-relative bounding box and visibility for a
   * registered element. Called by `useUIElement`'s ResizeObserver + scroll
   * listeners and MUST NOT emit events or bump `storeVersion` — bbox updates
   * fire on every scroll/resize and would cause `useSyncExternalStore`
   * consumers to re-render continuously (React error #185).
   *
   * Returns `false` if the element is not registered.
   */
  updateElementBbox(
    id: string,
    bbox: { x: number; y: number; width: number; height: number } | undefined,
    visible: boolean | undefined
  ): boolean {
    const existing = this.elements.get(id);
    if (!existing) return false;
    existing.bbox = bbox;
    existing.visible = visible;
    return true;
  }

  /**
   * Action-driven state refresh.
   *
   * Action handlers (`type`, `clear`, `setValue`, `check`, `uncheck`, `toggle`,
   * `select`, `sendKeys`, `focus`, `blur`) call this after mutating the DOM so
   * subsequent `getElement(id)` / snapshot reads see the post-action state
   * even when React detaches/re-creates the underlying DOM node between the
   * action and the next read.
   *
   * The fields in `updates` overlay the live `getElementState(element)` read
   * (cached values win for `value`, `checked`, `focused`, etc.). Other fields
   * (rect, computedStyles, scrollInfo) keep flowing from the live DOM read so
   * layout stays accurate. Pass `undefined` for `updates` to clear the
   * overlay.
   *
   * Returns `false` if `id` is not registered.
   */
  refreshElement(id: string, updates: Partial<ElementState> | undefined): boolean {
    const existing = this.elements.get(id) as
      | (RegisteredElement & {
          __stateOverridesRef?: { value: Partial<ElementState> | undefined };
        })
      | undefined;
    if (!existing) return false;
    const ref = existing.__stateOverridesRef;
    if (!ref) {
      // Older entry (registered before this slot existed) — fall back to
      // setting the public field. Without the closure ref, getState() won't
      // pick this up, but at least serializers that read `cachedStateOverrides`
      // directly stay consistent.
      existing.cachedStateOverrides = updates;
      return true;
    }
    if (updates === undefined) {
      ref.value = undefined;
      existing.cachedStateOverrides = undefined;
    } else {
      // Merge so partial refreshes (e.g. focus() updates only `focused`)
      // don't clobber a prior `value` overlay from a `type` action.
      const merged: Partial<ElementState> = { ...(ref.value ?? {}), ...updates };
      ref.value = merged;
      existing.cachedStateOverrides = merged;
    }
    return true;
  }

  registerElement(
    id: string,
    element: HTMLElement,
    options: {
      type?: ElementType;
      label?: string;
      actions?: StandardAction[];
      customActions?: Record<string, CustomAction>;
      category?: 'interactive' | 'content' | 'media';
      contentMetadata?: ContentMetadata;
      mediaMetadata?: MediaMetadata;
      /** Component that owns this element (set by <UIBridgeComponentScope>). */
      ownedByComponent?: string;
      /**
       * How this registration happened — `'hook'` (explicit useUIElement /
       * useUIComponent) or `'auto'` (DOM walker in useAutoRegister). Defaults
       * to `'hook'` so any programmatic caller that doesn't know about this
       * field is treated as a developer-instrumented registration. The
       * auto-register path overrides to `'auto'`.
       */
      origin?: 'hook' | 'auto';
      /** Disambiguation hint — semantic role/intent. See RegisteredElement.variant. */
      variant?: string;
      /** Disambiguation hint — positional. See RegisteredElement.position. */
      position?: string;
      /** Disambiguation hint — dominant color. See RegisteredElement.color. */
      color?: string;
      /** Disambiguation hint — hierarchical semantic path. See RegisteredElement.contextPath. */
      contextPath?: string;
      /**
       * Page route the element is registered under. Defaults to
       * `window.location.pathname` when available; used to populate
       * `BridgeSnapshot.registration.byRoute`. Pass `null` to explicitly
       * opt out of route tracking; pass a string (e.g. a framework router's
       * matched pattern) to override the `pathname` default.
       */
      route?: string | null;
      /**
       * Normalized text content for `data-ui-bridge-content` semantic
       * elements (cards/badges/pills). Surfaced on the snapshot element
       * as `content`.
       */
      content?: string;
      /**
       * ARIA/semantic role hint for content elements (e.g. `"article"`,
       * `"listitem"`, `"status"`). Surfaced on the snapshot element as
       * `role`. Sourced from `data-ui-bridge-role` with a fallback to
       * the DOM `role` attribute.
       */
      role?: string;
    } = {}
  ): RegisteredElement {
    const type = options.type ?? inferElementType(element);
    const actions = options.actions ?? inferActions(type);

    // Elements are identified through the internal bridge registry, not DOM attributes
    let actualId = id;

    // Preserve ID across remounts: match by fingerprint against recently-removed elements
    if (this.options.preserveIdAcrossRemount) {
      const now = Date.now();
      const cacheWindow = this.options.remountCacheWindowMs ?? DEFAULT_REMOUNT_CACHE_WINDOW_MS;
      const fp = computeElementFingerprint(element).hash;
      for (const [key, entry] of this.recentlyRemoved) {
        if (now - entry.removedAt > cacheWindow) {
          this.recentlyRemoved.delete(key);
          continue;
        }
        if (entry.fingerprint === fp) {
          actualId = entry.id;
          this.recentlyRemoved.delete(key);
          break;
        }
      }
    }

    // Fallback: if the caller didn't pass ownedByComponent (e.g. auto-scanned
    // elements outside the React hook path), walk up the DOM looking for a
    // `<UIBridgeComponentScope>` marker attribute.
    let ownedByComponent = options.ownedByComponent;
    if (!ownedByComponent && element && typeof element.closest === 'function') {
      const scope = element.closest('[data-ui-bridge-component]');
      const attr = scope?.getAttribute('data-ui-bridge-component');
      if (attr) ownedByComponent = attr;
    }

    // Resolve the route to tag this element with for registration
    // diagnostics. `route === null` explicitly opts out (stays undefined).
    // Any string (even empty) is taken as-is. When the option is absent,
    // fall back to `window.location.pathname` in DOM environments;
    // otherwise leave undefined (SSR, tests without jsdom).
    let route: string | undefined;
    if (options.route === null) {
      route = undefined;
    } else if (typeof options.route === 'string') {
      route = options.route;
    } else if (typeof window !== 'undefined' && window.location?.pathname) {
      route = window.location.pathname;
    }

    // Captured in `computeState` so action-executor's `refreshElement(id,
    // state)` can push post-action state into the same closure the registry
    // returns from `getState()`. Mutated through the registered entry's
    // `cachedStateOverrides` field for external consumers; this local lets
    // the closure stay O(1) without re-resolving via `this.elements`.
    const stateOverridesRef: { value: Partial<ElementState> | undefined } = {
      value: undefined,
    };
    const computeState = (): ElementState => {
      const live = getElementState(element);
      const overlay = stateOverridesRef.value;
      if (!overlay) return live;
      // Shallow-merge: cached overlay wins for fields the action wrote
      // (value, checked, focused, ...). Live read still provides rect,
      // computedStyles, scrollInfo, etc. so layout stays accurate.
      return { ...live, ...overlay } as ElementState;
    };
    const registered: RegisteredElement & {
      __stateOverridesRef?: { value: Partial<ElementState> | undefined };
    } = {
      id: actualId,
      element,
      type,
      label: options.label,
      actions,
      customActions: options.customActions,
      getState: computeState,
      getIdentifier: () => createElementIdentifier(element),
      registeredAt: Date.now(),
      mounted: true,
      category: options.category ?? 'interactive',
      contentMetadata: options.contentMetadata,
      mediaMetadata: options.mediaMetadata,
      ownedByComponent,
      // Default programmatic registrations to `'hook'` — only the DOM walker
      // in useAutoRegister passes `'auto'`. Tests and external callers that
      // pre-date this field stay on the `'hook'` side of any filter.
      origin: options.origin ?? 'hook',
      // Structured disambiguation metadata (all optional). Snapshots echo
      // these through verbatim so NL queries can rank candidates without
      // VLM pixel grounding.
      variant: options.variant,
      position: options.position,
      color: options.color,
      contextPath: options.contextPath,
      route,
      // Content/role fields for data-ui-bridge-content semantic elements.
      // Undefined for interactive elements and for content registered via
      // the heading/paragraph/table-cell content-discovery path.
      content: options.content,
      role: options.role,
    };
    // Hidden non-enumerable hook so `refreshElement` can mutate the same
    // closure-captured ref. Stored on the entry rather than via a side map
    // so re-registering an id with a fresh DOM node automatically resets
    // the ref (the new closure carries its own).
    Object.defineProperty(registered, '__stateOverridesRef', {
      value: stateOverridesRef,
      enumerable: false,
      writable: false,
      configurable: true,
    });

    // If this id is already registered, reverse the previous entry's
    // route bookkeeping so we don't double-count an overwrite.
    const prior = this.elements.get(actualId);
    if (prior) {
      this.decrementRouteCount(prior.route);
    }
    this.elements.set(actualId, registered);
    // F3: sticky latch + per-route tally
    this.everHadRegistrationsFlag = true;
    this.incrementRouteCount(route);
    this.emit('element:registered', { id: actualId, type, label: options.label });

    return registered;
  }

  private incrementRouteCount(route: string | undefined): void {
    // Use `""` as the key for undefined-route elements so the map stays
    // typed as `Map<string, number>`; snapshot serialization filters this
    // bucket out.
    const key = route ?? '';
    this.routeCounts.set(key, (this.routeCounts.get(key) ?? 0) + 1);
  }

  private decrementRouteCount(route: string | undefined): void {
    const key = route ?? '';
    const next = (this.routeCounts.get(key) ?? 0) - 1;
    if (next <= 0) {
      this.routeCounts.delete(key);
    } else {
      this.routeCounts.set(key, next);
    }
  }

  /**
   * Register a content (non-interactive) element
   */
  registerContentElement(
    id: string,
    element: HTMLElement,
    options: {
      contentType: string;
      contentMetadata: ContentMetadata;
      label?: string;
      /** Defaults to `'auto'` — content elements only flow from the DOM scanner. */
      origin?: 'hook' | 'auto';
    }
  ): RegisteredElement {
    return this.registerElement(id, element, {
      type: options.contentType as ElementType,
      label: options.label,
      actions: [],
      category: 'content',
      contentMetadata: options.contentMetadata,
      origin: options.origin ?? 'auto',
    });
  }

  /**
   * Get all content (non-interactive) elements
   */
  getAllContentElements(): RegisteredElement[] {
    return Array.from(this.elements.values()).filter((el) => el.category === 'content');
  }

  /**
   * Register a media element (image, video, canvas, SVG, etc.)
   *
   * If a `refreshMetadata` callback is provided, mediaMetadata is re-captured
   * on every `getState()` call so loading transitions and video state stay fresh.
   */
  registerMediaElement(
    id: string,
    element: HTMLElement,
    options: {
      mediaType: string;
      mediaMetadata: MediaMetadata;
      label?: string;
      refreshMetadata?: (el: HTMLElement) => MediaMetadata;
      /** Defaults to `'auto'` — media elements only flow from the DOM scanner. */
      origin?: 'hook' | 'auto';
    }
  ): RegisteredElement {
    const registered = this.registerElement(id, element, {
      type: options.mediaType as ElementType,
      label: options.label,
      actions: [],
      category: 'media',
      mediaMetadata: options.mediaMetadata,
      origin: options.origin ?? 'auto',
    });

    // Override getState to re-capture media metadata on each call
    if (options.refreshMetadata) {
      const originalGetState = registered.getState;
      const refreshFn = options.refreshMetadata;
      registered.getState = () => {
        const state = originalGetState();
        const freshMeta = refreshFn(element);
        registered.mediaMetadata = freshMeta;
        state.mediaMetadata = freshMeta;
        return state;
      };
    }

    return registered;
  }

  /**
   * Get all interactive elements
   */
  getAllInteractiveElements(): RegisteredElement[] {
    return Array.from(this.elements.values()).filter(
      (el) => el.category !== 'content' && el.category !== 'media'
    );
  }

  /**
   * Get all media elements
   */
  getAllMediaElements(): RegisteredElement[] {
    return Array.from(this.elements.values()).filter((el) => el.category === 'media');
  }

  /**
   * Unregister an element
   */
  unregisterElement(id: string): boolean {
    const registered = this.elements.get(id);
    if (registered) {
      // Track recently removed for remount ID preservation
      if (this.options.preserveIdAcrossRemount && registered.element) {
        const fp = computeElementFingerprint(registered.element).hash;
        this.recentlyRemoved.set(fp, { id, fingerprint: fp, removedAt: Date.now() });
        // Bound the map at 100 entries
        if (this.recentlyRemoved.size > 100) {
          const firstKey = this.recentlyRemoved.keys().next().value;
          if (firstKey !== undefined) {
            this.recentlyRemoved.delete(firstKey);
          }
        }
      }
      registered.mounted = false;
      this.elements.delete(id);
      // F3: drop this element from the per-route tally. Note we do NOT
      // clear `everHadRegistrationsFlag` — it's a one-way latch that stays
      // true for the rest of the registry's lifetime so callers can tell
      // "had coverage, all unmounted" from "never had coverage".
      this.decrementRouteCount(registered.route);
      this.emit('element:unregistered', { id });
      this.options.elementEventLog?.removeElement(id);
      return true;
    }
    return false;
  }

  /**
   * Get a registered element
   */
  getElement(id: string): RegisteredElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Get all registered elements
   */
  getAllElements(): RegisteredElement[] {
    return Array.from(this.elements.values());
  }

  /**
   * Find element by DOM element reference
   */
  findByDOMElement(element: HTMLElement): RegisteredElement | undefined {
    for (const registered of this.elements.values()) {
      if (registered.element === element) {
        return registered;
      }
    }
    return undefined;
  }

  /**
   * Get element event history from the element event log.
   */
  getElementHistory(elementId: string, options?: ElementHistoryOptions): ElementLogEntry[] {
    return this.options.elementEventLog?.getHistory(elementId, options) ?? [];
  }

  /**
   * Set the log level override for a specific element.
   */
  setElementLogLevel(elementId: string, level: ElementLogLevel): void {
    this.options.elementEventLog?.setElementLogLevel(elementId, level);
  }

  /**
   * Get the effective log level for an element.
   */
  getElementLogLevel(elementId: string): ElementLogLevel {
    return this.options.elementEventLog?.getElementLogLevel(elementId) ?? 'silent';
  }

  /**
   * Search for elements using AI search criteria
   */
  searchElements(criteria: SearchCriteria): SearchResult[] {
    const results: SearchResult[] = [];
    const threshold = criteria.fuzzyThreshold ?? 0.7;

    for (const element of this.elements.values()) {
      if (!element.mounted) continue;

      const state = element.getState();

      // Skip hidden elements if not explicitly requested
      if (!criteria.fuzzy && !state.visible) continue;

      // Build searchable text from element
      const aliases = element.aliases ?? this.generateElementAliases(element);
      const textContent = state.textContent?.trim() || '';
      const label = element.label || '';

      let maxScore = 0;
      const matchReasons: string[] = [];
      const scores: SearchResult['scores'] = {};

      // Text matching
      if (criteria.text) {
        // Exact match
        if (
          textContent.toLowerCase() === criteria.text.toLowerCase() ||
          label.toLowerCase() === criteria.text.toLowerCase()
        ) {
          maxScore = 1.0;
          matchReasons.push('exact text match');
          scores.text = 1.0;
        } else if (criteria.fuzzy !== false) {
          // Fuzzy match
          const textResult = fuzzyMatch(criteria.text, textContent, { threshold });
          const labelResult = fuzzyMatch(criteria.text, label, { threshold });
          const bestResult =
            textResult.similarity > labelResult.similarity ? textResult : labelResult;

          if (bestResult.isMatch) {
            scores.text = bestResult.similarity;
            if (bestResult.similarity > maxScore) {
              maxScore = bestResult.similarity;
              matchReasons.push(`text similarity: ${(bestResult.similarity * 100).toFixed(0)}%`);
            }
          }
        }
      }

      // Text contains
      if (criteria.textContains) {
        if (
          textContent.toLowerCase().includes(criteria.textContains.toLowerCase()) ||
          label.toLowerCase().includes(criteria.textContains.toLowerCase())
        ) {
          const containsScore = 0.85;
          scores.text = Math.max(scores.text ?? 0, containsScore);
          if (containsScore > maxScore) {
            maxScore = containsScore;
            matchReasons.push('text contains');
          }
        }
      }

      // Accessible name matching
      if (criteria.accessibleName) {
        const ariaLabel = element.element.getAttribute('aria-label') || '';
        const accessibleName = ariaLabel || label || textContent;

        if (accessibleName.toLowerCase() === criteria.accessibleName.toLowerCase()) {
          scores.accessibility = 1.0;
          if (1.0 > maxScore) {
            maxScore = 1.0;
            matchReasons.push('accessible name match');
          }
        } else if (criteria.fuzzy !== false) {
          const result = fuzzyMatch(criteria.accessibleName, accessibleName, { threshold });
          if (result.isMatch) {
            scores.accessibility = result.similarity;
            if (result.similarity > maxScore) {
              maxScore = result.similarity;
              matchReasons.push(
                `accessible name similarity: ${(result.similarity * 100).toFixed(0)}%`
              );
            }
          }
        }
      }

      // Role matching
      if (criteria.role) {
        const role = element.element.getAttribute('role') || this.inferRole(element.type);
        if (role?.toLowerCase() === criteria.role.toLowerCase()) {
          scores.role = 1.0;
          if (1.0 > maxScore) {
            maxScore = 1.0;
            matchReasons.push(`role: ${criteria.role}`);
          }
        }
      }

      // Type matching
      if (criteria.type) {
        if (element.type === criteria.type) {
          const typeScore = 0.9;
          scores.role = Math.max(scores.role ?? 0, typeScore);
          if (typeScore > maxScore) {
            maxScore = typeScore;
            matchReasons.push(`type: ${criteria.type}`);
          }
        }
      }

      // Alias matching
      for (const alias of aliases) {
        const searchText = criteria.text || criteria.textContains || criteria.accessibleName;
        if (searchText) {
          if (alias.toLowerCase() === searchText.toLowerCase()) {
            scores.fuzzy = 1.0;
            if (1.0 > maxScore) {
              maxScore = 1.0;
              matchReasons.push(`alias: "${alias}"`);
            }
          } else if (criteria.fuzzy !== false) {
            const result = fuzzyMatch(searchText, alias, { threshold });
            if (result.isMatch && result.similarity > (scores.fuzzy ?? 0)) {
              scores.fuzzy = result.similarity;
              if (result.similarity > maxScore) {
                maxScore = result.similarity;
                matchReasons.push(`fuzzy alias: "${alias}"`);
              }
            }
          }
        }
      }

      // Add result if above threshold
      if (maxScore >= threshold) {
        const aiElement: AIDiscoveredElement = {
          id: element.id,
          type: element.type,
          label: element.label,
          tagName: element.element.tagName.toLowerCase(),
          role: element.element.getAttribute('role') || undefined,
          accessibleName: element.element.getAttribute('aria-label') || element.label,
          actions: element.actions,
          state,
          registered: true,
          description:
            element.description ||
            generateDescription({
              textContent,
              ariaLabel: element.element.getAttribute('aria-label'),
              elementType: element.type,
              id: element.id,
              labelText: element.label,
            }),
          aliases,
          purpose: element.purpose,
          suggestedActions: [],
          semanticType: element.semanticType,
        };

        results.push({
          element: aiElement,
          confidence: maxScore,
          matchReasons,
          scores,
        });
      }
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    return results;
  }

  /**
   * Find element by visible text
   */
  findByText(text: string, fuzzy: boolean = true): RegisteredElement | undefined {
    const results = this.searchElements({ text, fuzzy, fuzzyThreshold: fuzzy ? 0.7 : 1.0 });
    if (results.length > 0) {
      return this.elements.get(results[0].element.id);
    }
    return undefined;
  }

  /**
   * Find element by accessible name
   */
  findByAccessibleName(name: string): RegisteredElement | undefined {
    const results = this.searchElements({ accessibleName: name, fuzzy: true });
    if (results.length > 0) {
      return this.elements.get(results[0].element.id);
    }
    return undefined;
  }

  /**
   * Generate aliases for an element
   */
  private generateElementAliases(element: RegisteredElement): string[] {
    const state = element.getState();
    return generateAliases({
      textContent: state.textContent,
      ariaLabel: element.element.getAttribute('aria-label'),
      placeholder: element.element.getAttribute('placeholder'),
      title: element.element.getAttribute('title'),
      elementType: element.type,
      tagName: element.element.tagName.toLowerCase(),
      id: element.id,
      labelText: element.label,
    });
  }

  /**
   * Infer ARIA role from element type
   */
  private inferRole(type: ElementType): string | undefined {
    const roleMap: Record<ElementType, string | undefined> = {
      button: 'button',
      input: 'textbox',
      select: 'combobox',
      checkbox: 'checkbox',
      radio: 'radio',
      link: 'link',
      form: undefined,
      textarea: 'textbox',
      menu: 'menu',
      menuitem: 'menuitem',
      tab: 'tab',
      dialog: 'dialog',
      custom: undefined,
      switch: 'switch',
      slider: 'slider',
      combobox: 'combobox',
      listbox: 'listbox',
      option: 'option',
      textbox: 'textbox',
      generic: undefined,
      image: 'img',
      video: undefined,
      canvas: undefined,
      svg: 'img',
      picture: 'img',
    };
    return roleMap[type];
  }

  /**
   * Update a component's options in place, without emitting a
   * `component:registered` event. Returns `false` if the component is not
   * currently registered — callers should fall back to `registerComponent`.
   *
   * Preserves `registeredAt` and `mounted`. Intended for React hooks that
   * want to reflect option changes on the same mounted consumer without
   * firing a full re-register (which would churn `useSyncExternalStore`
   * subscribers).
   */
  updateComponent(
    id: string,
    options: {
      name?: string;
      description?: string;
      actions?: Array<{
        id: string;
        label?: string;
        description?: string;
        paramSchema?: Record<string, unknown>;
        handler: (params?: unknown) => unknown | Promise<unknown>;
      }>;
      elementIds?: string[];
      getState?: StateGetter<Record<string, unknown>>;
      getComputed?: () => Record<string, unknown>;
    }
  ): boolean {
    const existing = this.components.get(id);
    if (!existing) return false;
    if (options.name !== undefined) existing.name = options.name;
    if (options.description !== undefined) existing.description = options.description;
    if (options.actions !== undefined) {
      existing.actions = options.actions.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        paramSchema: a.paramSchema,
        handler: a.handler,
      }));
    }
    if (options.elementIds !== undefined) existing.elementIds = options.elementIds;
    if (options.getState !== undefined) existing.getState = options.getState;
    if (options.getComputed !== undefined) existing.getComputed = options.getComputed;
    return true;
  }

  /**
   * Register a component
   */
  registerComponent(
    id: string,
    options: {
      name: string;
      description?: string;
      actions?: Array<{
        id: string;
        label?: string;
        description?: string;
        paramSchema?: Record<string, unknown>;
        handler: (params?: unknown) => unknown | Promise<unknown>;
      }>;
      elementIds?: string[];
      getState?: StateGetter<Record<string, unknown>>;
      getComputed?: () => Record<string, unknown>;
    }
  ): RegisteredComponent {
    const registered: RegisteredComponent = {
      id,
      name: options.name,
      description: options.description,
      actions:
        options.actions?.map((a) => ({
          id: a.id,
          label: a.label,
          description: a.description,
          paramSchema: a.paramSchema,
          handler: a.handler,
        })) ?? [],
      elementIds: options.elementIds,
      registeredAt: Date.now(),
      mounted: true,
      getState: options.getState,
      getComputed: options.getComputed,
    };

    this.components.set(id, registered);
    this.emit('component:registered', { id, name: options.name });

    return registered;
  }

  /**
   * Unregister a component
   */
  unregisterComponent(id: string): boolean {
    const component = this.components.get(id);
    if (component) {
      component.mounted = false;
      this.components.delete(id);
      this.emit('component:unregistered', { id });
      return true;
    }
    return false;
  }

  /**
   * Get a registered component
   */
  getComponent(id: string): RegisteredComponent | undefined {
    return this.components.get(id);
  }

  /**
   * Get all registered components
   */
  getAllComponents(): RegisteredComponent[] {
    return Array.from(this.components.values());
  }

  /**
   * Get the current state and computed properties of a component
   */
  getComponentState(id: string): ComponentStateResponse | null {
    const component = this.components.get(id);
    if (!component || !component.mounted) {
      return null;
    }

    return {
      state: component.getState?.() ?? {},
      computed: component.getComputed?.() ?? {},
      timestamp: Date.now(),
    };
  }

  /**
   * Register a workflow
   */
  registerWorkflow(workflow: Workflow): Workflow {
    this.workflows.set(workflow.id, workflow);
    this.notifyStoreListeners();
    return workflow;
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(id: string): boolean {
    const deleted = this.workflows.delete(id);
    if (deleted) this.notifyStoreListeners();
    return deleted;
  }

  /**
   * Get a workflow
   */
  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Register a state
   */
  registerState(state: UIState): UIState {
    this.states.set(state.id, state);
    this.emit('element:registered', { id: state.id, type: 'state', name: state.name });
    return state;
  }

  /**
   * Update a state's stored options in place. See `updateComponent` for
   * rationale — avoids re-emitting `element:registered`/`unregistered`
   * pairs on every option change so `useSyncExternalStore` consumers don't
   * re-render on minor metadata edits.
   */
  updateState(state: UIState): boolean {
    if (!this.states.has(state.id)) return false;
    this.states.set(state.id, state);
    return true;
  }

  /**
   * Unregister a state
   */
  unregisterState(id: string): boolean {
    const state = this.states.get(id);
    if (state) {
      this.activeStates.delete(id);
      this.states.delete(id);
      this.emit('element:unregistered', { id, type: 'state' });
      return true;
    }
    return false;
  }

  /**
   * Get a registered state
   */
  getState(id: string): UIState | undefined {
    return this.states.get(id);
  }

  /**
   * Get all registered states
   */
  getAllStates(): UIState[] {
    return Array.from(this.states.values());
  }

  /**
   * Register a state group
   */
  registerStateGroup(group: UIStateGroup): UIStateGroup {
    this.stateGroups.set(group.id, group);
    return group;
  }

  /** In-place update — see `updateComponent`. */
  updateStateGroup(group: UIStateGroup): boolean {
    if (!this.stateGroups.has(group.id)) return false;
    this.stateGroups.set(group.id, group);
    return true;
  }

  /**
   * Unregister a state group
   */
  unregisterStateGroup(id: string): boolean {
    return this.stateGroups.delete(id);
  }

  /**
   * Get a state group
   */
  getStateGroup(id: string): UIStateGroup | undefined {
    return this.stateGroups.get(id);
  }

  /**
   * Get all state groups
   */
  getAllStateGroups(): UIStateGroup[] {
    return Array.from(this.stateGroups.values());
  }

  /**
   * Register a transition
   */
  registerTransition(transition: UITransition): UITransition {
    this.transitions.set(transition.id, transition);
    return transition;
  }

  /** In-place update — see `updateComponent`. */
  updateTransition(transition: UITransition): boolean {
    if (!this.transitions.has(transition.id)) return false;
    this.transitions.set(transition.id, transition);
    return true;
  }

  /**
   * Unregister a transition
   */
  unregisterTransition(id: string): boolean {
    return this.transitions.delete(id);
  }

  /**
   * Get a transition
   */
  getTransition(id: string): UITransition | undefined {
    return this.transitions.get(id);
  }

  /**
   * Get all transitions
   */
  getAllTransitions(): UITransition[] {
    return Array.from(this.transitions.values());
  }

  /**
   * Get currently active states
   */
  getActiveStates(): string[] {
    return Array.from(this.activeStates);
  }

  /**
   * Check if a state is active
   */
  isStateActive(id: string): boolean {
    return this.activeStates.has(id);
  }

  /**
   * Activate a state
   */
  activateState(id: string): boolean {
    const state = this.states.get(id);
    if (!state) {
      return false;
    }

    // Check if blocked by another state
    for (const activeId of this.activeStates) {
      const activeState = this.states.get(activeId);
      if (activeState?.blocking && activeState.id !== id) {
        // Blocked by a modal/blocking state
        return false;
      }
      if (activeState?.blocks?.includes(id)) {
        // Specifically blocked by this state
        return false;
      }
    }

    const wasActive = this.activeStates.has(id);
    this.activeStates.add(id);

    if (!wasActive) {
      this.emit('element:stateChanged', {
        stateId: id,
        active: true,
        activeStates: this.getActiveStates(),
      });
    }

    return true;
  }

  /**
   * Deactivate a state
   */
  deactivateState(id: string): boolean {
    const wasActive = this.activeStates.has(id);
    this.activeStates.delete(id);

    if (wasActive) {
      this.emit('element:stateChanged', {
        stateId: id,
        active: false,
        activeStates: this.getActiveStates(),
      });
    }

    return wasActive;
  }

  /**
   * Activate multiple states
   */
  activateStates(ids: string[]): string[] {
    const activated: string[] = [];
    for (const id of ids) {
      if (this.activateState(id)) {
        activated.push(id);
      }
    }
    return activated;
  }

  /**
   * Deactivate multiple states
   */
  deactivateStates(ids: string[]): string[] {
    const deactivated: string[] = [];
    for (const id of ids) {
      if (this.deactivateState(id)) {
        deactivated.push(id);
      }
    }
    return deactivated;
  }

  /**
   * Activate a state group (all states in the group)
   */
  activateStateGroup(groupId: string): string[] {
    const group = this.stateGroups.get(groupId);
    if (!group) return [];
    return this.activateStates(group.states);
  }

  /**
   * Deactivate a state group (all states in the group)
   */
  deactivateStateGroup(groupId: string): string[] {
    const group = this.stateGroups.get(groupId);
    if (!group) return [];
    return this.deactivateStates(group.states);
  }

  /**
   * Check if a transition can be executed from current state
   */
  canExecuteTransition(transitionId: string): boolean {
    const transition = this.transitions.get(transitionId);
    if (!transition) return false;

    // At least one fromState must be active
    return transition.fromStates.some((stateId) => this.activeStates.has(stateId));
  }

  /**
   * Execute a transition
   */
  async executeTransition(transitionId: string): Promise<TransitionResult> {
    const startTime = performance.now();
    const transition = this.transitions.get(transitionId);

    if (!transition) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: `Transition not found: ${transitionId}`,
        durationMs: performance.now() - startTime,
      };
    }

    if (!this.canExecuteTransition(transitionId)) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: 'Precondition not met: none of the fromStates are active',
        failedPhase: 'precondition',
        durationMs: performance.now() - startTime,
      };
    }

    try {
      // Phase 1: Deactivate exit states
      const deactivated = this.deactivateStates(transition.exitStates);

      // Phase 2: Deactivate exit groups
      if (transition.exitGroups) {
        for (const groupId of transition.exitGroups) {
          deactivated.push(...this.deactivateStateGroup(groupId));
        }
      }

      // Phase 3: Execute actions (if any)
      // Note: Actual action execution happens in the workflow engine
      // Here we just track that the transition occurred

      // Phase 4: Activate states
      const activated = this.activateStates(transition.activateStates);

      // Phase 5: Activate groups
      if (transition.activateGroups) {
        for (const groupId of transition.activateGroups) {
          activated.push(...this.activateStateGroup(groupId));
        }
      }

      return {
        success: true,
        activatedStates: activated,
        deactivatedStates: deactivated,
        durationMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: error instanceof Error ? error.message : String(error),
        failedPhase: 'execution',
        durationMs: performance.now() - startTime,
      };
    }
  }

  /**
   * Find a path from current state to target states
   *
   * Uses a simple BFS algorithm for pathfinding.
   * For more advanced pathfinding (Dijkstra, A*), use the Python state manager service.
   */
  findPath(targetStates: string[]): PathResult {
    // Check if already at target
    if (targetStates.every((t) => this.activeStates.has(t))) {
      return {
        found: true,
        transitions: [],
        totalCost: 0,
        targetStates,
        estimatedSteps: 0,
      };
    }

    // BFS to find path
    const queue: { activeStates: Set<string>; path: string[]; cost: number }[] = [
      { activeStates: new Set(this.activeStates), path: [], cost: 0 },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const stateKey = Array.from(current.activeStates).sort().join(',');

      if (visited.has(stateKey)) continue;
      visited.add(stateKey);

      // Check if target reached
      if (targetStates.every((t) => current.activeStates.has(t))) {
        return {
          found: true,
          transitions: current.path,
          totalCost: current.cost,
          targetStates,
          estimatedSteps: current.path.length,
        };
      }

      // Try each transition
      for (const transition of this.transitions.values()) {
        // Check if transition can be executed from current state
        const canExecute = transition.fromStates.some((s) => current.activeStates.has(s));
        if (!canExecute) continue;

        // Calculate new state after transition
        const newActive = new Set(current.activeStates);
        for (const s of transition.exitStates) newActive.delete(s);
        for (const s of transition.activateStates) newActive.add(s);

        const newCost = current.cost + (transition.pathCost ?? 1);

        queue.push({
          activeStates: newActive,
          path: [...current.path, transition.id],
          cost: newCost,
        });
      }
    }

    return {
      found: false,
      transitions: [],
      totalCost: 0,
      targetStates,
      estimatedSteps: 0,
    };
  }

  /**
   * Navigate to target states using pathfinding
   */
  async navigateTo(targetStates: string[]): Promise<NavigationResult> {
    const startTime = performance.now();
    const path = this.findPath(targetStates);

    if (!path.found) {
      return {
        success: false,
        path,
        executedTransitions: [],
        finalActiveStates: this.getActiveStates(),
        error: `No path found to target states: ${targetStates.join(', ')}`,
        durationMs: performance.now() - startTime,
      };
    }

    const executedTransitions: string[] = [];

    for (const transitionId of path.transitions) {
      const result = await this.executeTransition(transitionId);
      if (!result.success) {
        return {
          success: false,
          path,
          executedTransitions,
          finalActiveStates: this.getActiveStates(),
          error: result.error,
          durationMs: performance.now() - startTime,
        };
      }
      executedTransitions.push(transitionId);
    }

    return {
      success: true,
      path,
      executedTransitions,
      finalActiveStates: this.getActiveStates(),
      durationMs: performance.now() - startTime,
    };
  }

  /**
   * Create a state snapshot
   */
  createStateSnapshot(): StateSnapshot {
    return {
      timestamp: Date.now(),
      activeStates: this.getActiveStates(),
      states: this.getAllStates(),
      groups: this.getAllStateGroups(),
      transitions: this.getAllTransitions(),
    };
  }

  /**
   * Whether this registry instance has ever had an element register in its
   * lifetime. Sticky — flips true on first `registerElement` and stays true
   * until `clear()`.  Exposed primarily for tests; production code should
   * read `BridgeSnapshot.registration.everHadRegistrations`.
   */
  hasEverHadRegistrations(): boolean {
    return this.everHadRegistrationsFlag;
  }

  /**
   * Per-route counts of currently-registered elements. Returns a plain
   * object copy so callers can't mutate the internal map. Elements with
   * an undefined route are omitted. Exposed primarily for tests; production
   * code should read `BridgeSnapshot.registration.byRoute`.
   */
  getCountsByRoute(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [route, count] of this.routeCounts) {
      // Empty-string key = undefined-route bucket — exclude from the
      // user-visible map so it never shows up as `"": N`.
      if (route === '') continue;
      if (count > 0) out[route] = count;
    }
    return out;
  }

  /**
   * Build the F3 registration-diagnostics metadata for a snapshot. Shared
   * by `createSnapshot` and `createSnapshotAsync` so both paths emit the
   * same shape.
   */
  private buildRegistrationMetadata(): {
    totalRegistered: number;
    everHadRegistrations: boolean;
    byRoute: Record<string, number>;
  } {
    return {
      totalRegistered: this.elements.size,
      everHadRegistrations: this.everHadRegistrationsFlag,
      byRoute: this.getCountsByRoute(),
    };
  }

  /**
   * Best-effort read of the current page route. Matches the default source
   * `registerElement` uses, so the snapshot's top-level `route` lines up
   * with the `byRoute` keys under normal operation.
   */
  private currentRoute(): string | undefined {
    if (typeof window !== 'undefined' && window.location?.pathname) {
      return window.location.pathname;
    }
    return undefined;
  }

  /**
   * Resolve the optional `activeTab` field for a snapshot. Applications that
   * decouple their visible pane from `window.location` (e.g. the runner's
   * tab-based shell) supply a `getActiveTab` callback in the snapshot options;
   * the SDK itself has no concept of "tab", so without a provider the field
   * stays undefined and non-tab-based consumers are unaffected. Errors thrown
   * by the provider are swallowed so a buggy host can never break the rest of
   * the snapshot.
   */
  private resolveActiveTab(getActiveTab?: () => string | null | undefined): string | undefined {
    if (!getActiveTab) return undefined;
    try {
      const value = getActiveTab();
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Create a snapshot of the current state
   */
  createSnapshot(
    options: {
      componentBasePath?: string;
      /**
       * Optional provider for the snapshot's `activeTab` field. Apps that
       * own their own tab system (the runner) inject the active tab id here.
       * Returning a falsy value or omitting the provider leaves the field
       * undefined.
       */
      getActiveTab?: () => string | null | undefined;
    } = {}
  ): BridgeSnapshot {
    const takenAt = Date.now();
    const activeTab = this.resolveActiveTab(options.getActiveTab);
    return {
      timestamp: takenAt,
      snapshotTakenAtMs: takenAt,
      route: this.currentRoute(),
      ...(activeTab !== undefined ? { activeTab } : {}),
      registration: this.buildRegistrationMetadata(),
      elements: this.getAllElements().map((el) => serializeRegisteredElement(el, options)),
      components: this.getAllComponents().map((comp) => ({
        id: comp.id,
        name: comp.name,
        description: comp.description,
        actions: comp.actions.map((a) => a.id),
        // Tell the caller exactly how to invoke any action on this component
        // without having to grep docs or guess the route shape.
        actionInvocationPath: `/control/component/${comp.id}/action/{actionId}`,
        elementIds: comp.elementIds,
      })),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length,
      })),
    };
  }

  /**
   * Create a snapshot asynchronously, processing elements in batches to avoid
   * blocking the main thread. This prevents "Page Unresponsive" dialogs when
   * there are many registered elements (200-500+), since getState() and
   * getIdentifier() force layout/style recalculation for each element.
   */
  async createSnapshotAsync(
    batchSize = 50,
    options: {
      componentBasePath?: string;
      /**
       * Optional provider for the snapshot's `activeTab` field — see
       * {@link createSnapshot}. The provider is invoked once at the end of
       * the snapshot build so it observes the same wall-clock as the
       * registration metadata.
       */
      getActiveTab?: () => string | null | undefined;
    } = {}
  ): Promise<BridgeSnapshot> {
    const allElements = this.getAllElements();
    const elementSnapshots: BridgeSnapshot['elements'] = [];

    for (let i = 0; i < allElements.length; i += batchSize) {
      const batch = allElements.slice(i, i + batchSize);
      for (const el of batch) {
        elementSnapshots.push(serializeRegisteredElement(el, options));
      }
      // Yield to main thread between batches to keep UI responsive
      if (i + batchSize < allElements.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Capture registration metadata AFTER the element loop so counts
    // reflect any (un)registrations that happened during yields — the map
    // is always authoritative.
    const takenAt = Date.now();
    const activeTab = this.resolveActiveTab(options.getActiveTab);
    return {
      timestamp: takenAt,
      snapshotTakenAtMs: takenAt,
      route: this.currentRoute(),
      ...(activeTab !== undefined ? { activeTab } : {}),
      registration: this.buildRegistrationMetadata(),
      elements: elementSnapshots,
      components: this.getAllComponents().map((comp) => ({
        id: comp.id,
        name: comp.name,
        description: comp.description,
        actions: comp.actions.map((a) => a.id),
        // Tell the caller exactly how to invoke any action on this component
        // without having to grep docs or guess the route shape.
        actionInvocationPath: `/control/component/${comp.id}/action/{actionId}`,
        elementIds: comp.elementIds,
      })),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length,
      })),
    };
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.elements.clear();
    this.components.clear();
    this.workflows.clear();
    this.eventListeners.clear();
    this.states.clear();
    this.stateGroups.clear();
    this.transitions.clear();
    this.activeStates.clear();
    // F3: a full `clear()` is an explicit teardown — unlike per-element
    // unregister it resets the route tally AND the sticky latch, matching
    // the lifetime semantics expected after `resetGlobalRegistry()`.
    this.routeCounts.clear();
    this.everHadRegistrationsFlag = false;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    elementCount: number;
    componentCount: number;
    workflowCount: number;
    mountedElementCount: number;
    mountedComponentCount: number;
    stateCount: number;
    stateGroupCount: number;
    transitionCount: number;
    activeStateCount: number;
  } {
    const elements = this.getAllElements();
    const components = this.getAllComponents();

    return {
      elementCount: elements.length,
      componentCount: components.length,
      workflowCount: this.workflows.size,
      mountedElementCount: elements.filter((e) => e.mounted).length,
      mountedComponentCount: components.filter((c) => c.mounted).length,
      stateCount: this.states.size,
      stateGroupCount: this.stateGroups.size,
      transitionCount: this.transitions.size,
      activeStateCount: this.activeStates.size,
    };
  }
}

/**
 * Default global registry instance
 */
let globalRegistry: UIBridgeRegistry | null = null;

/**
 * Get or create the global registry
 */
export function getGlobalRegistry(): UIBridgeRegistry {
  if (!globalRegistry) {
    globalRegistry = new UIBridgeRegistry();
  }
  return globalRegistry;
}

/**
 * Set the global registry
 */
export function setGlobalRegistry(registry: UIBridgeRegistry): void {
  globalRegistry = registry;
}

/**
 * Reset the global registry
 */
export function resetGlobalRegistry(): void {
  globalRegistry?.clear();
  globalRegistry = null;
}
