/**
 * UI Bridge Core Types
 *
 * Defines the fundamental types used throughout the UI Bridge framework,
 * plus ui-bridge-specific types (WebSocket protocol, accessibility, extended workflow types).
 */

import type { CapturedError, AnyCapturedEvent } from '../debug/browser-capture-types';
export type { CapturedError } from '../debug/browser-capture-types';
import type { ErrorSeverity } from '../debug/error-severity';
import type { ErrorImpact } from '../debug/error-impact';
import type { SnapshotPageContext } from '../navigation/types';
import type { SnapshotModalContext } from '../modal/types';
import type { SnapshotToastContext } from '../toast/types';
import type { SnapshotRelationshipContext } from '../relationships/types';
import type { SnapshotDragDropContext } from '../drag-drop/types';
import type { SnapshotUndoContext } from '../undo/types';
import type { SnapshotShortcutContext } from '../shortcuts/types';

// ============================================================================
// Core Element Types
// ============================================================================

/**
 * Resolution-independent coordinates normalized to 0–1 range relative to the viewport.
 * Inspired by AirtestProject/Poco's coordinate system for cross-resolution targeting.
 *
 * Values are computed as: rect.{x,y,width,height} / viewport.{width,height}
 * so (0,0) is top-left and (1,1) is bottom-right of the viewport.
 */
export interface NormalizedRect {
  /** Normalized left edge (0–1) */
  x: number;
  /** Normalized top edge (0–1) */
  y: number;
  /** Normalized width (0–1) */
  width: number;
  /** Normalized height (0–1) */
  height: number;
}

/**
 * Element identification using multiple strategies
 */
export interface ElementIdentifier {
  /** @deprecated No longer set. Elements are identified through the bridge registry. */
  uiId?: string;
  /** Testing library convention (data-testid attribute) */
  testId?: string;
  /** Legacy AWAS support (data-awas-element attribute) */
  awasId?: string;
  /** HTML id attribute */
  htmlId?: string;
  /** Generated XPath selector */
  xpath: string;
  /** Generated CSS selector */
  selector: string;
}

/**
 * Current state of a UI element
 */
export interface ElementState {
  /** Whether the element is visible in the viewport */
  visible: boolean;
  /** Whether the element is enabled (not disabled) */
  enabled: boolean;
  /** Whether the element has focus */
  focused: boolean;
  /** ARIA role attribute value (e.g. "tablist", "tab", "button") */
  role?: string;
  /** Computed accessible name (aria-label > aria-labelledby > associated label > title > text) */
  accessibleName?: string;
  /** Bounding rectangle of the element */
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  /** Resolution-independent bounding rect normalized to 0–1 viewport coordinates */
  normalizedRect?: NormalizedRect;
  /** Current value for inputs */
  value?: string;
  /** Checked state for checkboxes/radios */
  checked?: boolean;
  /** Selected options for select elements */
  selectedOptions?: string[];
  /** Full option list for <select> elements — value/label/selected per option */
  availableOptions?: Array<{ value: string; label: string; selected: boolean }>;
  /** Text content of the element */
  textContent?: string;
  /** Inner HTML of the element (sanitized) */
  innerHTML?: string;
  /** href for anchor elements */
  href?: string;
  /** Route path from data-route attribute (navigation elements) */
  dataRoute?: string;
  /** Whether element has opacity 0 (visually hidden but in DOM) */
  opacityHidden?: boolean;
  /** ARIA selected state (tabs, list items) */
  ariaSelected?: boolean;
  /** ARIA pressed state (toggle buttons) */
  ariaPressed?: boolean | 'mixed';
  /** ARIA current state (navigation) */
  ariaCurrent?: string;
  /** ARIA expanded state (expandable elements) */
  ariaExpanded?: boolean;
  /** ARIA checked state (switches, checkboxes with role="switch"/"checkbox", can be true/false/'mixed') */
  ariaChecked?: boolean | 'mixed';
  /** Computed styles relevant for automation and visual debugging */
  computedStyles?: {
    // Visibility & interaction
    display: string;
    visibility: string;
    opacity: string;
    pointerEvents: string;
    cursor: string;
    // Color & theming
    color: string;
    backgroundColor: string;
    colorScheme: string;
    // Typography
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    // Overflow & clipping
    overflow: string;
    textOverflow: string;
    whiteSpace: string;
    // Layout & layering
    position: string;
    zIndex: string;
    // Spacing
    padding: string;
    margin: string;
    // Borders
    borderColor: string;
    borderWidth: string;
    borderRadius: string;
  };
  /** Whether the element is required (form controls only) */
  required?: boolean;
  /** HTML5 constraint validation state (form controls only) */
  validationState?: {
    valid: boolean;
    validationMessage?: string;
    valueMissing?: boolean;
    typeMismatch?: boolean;
    patternMismatch?: boolean;
    tooShort?: boolean;
    tooLong?: boolean;
    rangeUnderflow?: boolean;
    rangeOverflow?: boolean;
    stepMismatch?: boolean;
    customError?: boolean;
  };
  /** HTML5 constraint attributes (form controls only) */
  constraints?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: string;
    max?: string;
    step?: string;
  };
  /** Media metadata for images, video, canvas, SVG elements */
  mediaMetadata?: MediaMetadata;
  /** Whether this element is within the viewport bounds (separate from `visible` which also checks display/opacity) */
  inViewport?: boolean;
  /** Scroll container info — only present if this element has overflowing scrollable content */
  scrollInfo?: {
    /** Current vertical scroll offset */
    scrollTop: number;
    /** Current horizontal scroll offset */
    scrollLeft: number;
    /** Total scrollable height */
    scrollHeight: number;
    /** Total scrollable width */
    scrollWidth: number;
    /** Visible (client) height */
    clientHeight: number;
    /** Visible (client) width */
    clientWidth: number;
    /** Whether more content exists above */
    canScrollUp: boolean;
    /** Whether more content exists below */
    canScrollDown: boolean;
    /** Whether more content exists to the left */
    canScrollLeft: boolean;
    /** Whether more content exists to the right */
    canScrollRight: boolean;
  };
}

/**
 * Types of UI elements that can be registered
 */
export type ElementType =
  | 'button'
  | 'input'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'link'
  | 'form'
  | 'textarea'
  | 'menu'
  | 'menuitem'
  | 'tab'
  | 'dialog'
  | 'disclosure'
  | 'custom'
  | 'switch'
  | 'slider'
  | 'combobox'
  | 'listbox'
  | 'option'
  | 'textbox'
  | 'generic'
  | 'image'
  | 'video'
  | 'canvas'
  | 'svg'
  | 'picture';

/**
 * Types of static content elements (non-interactive)
 */
export type ContentType =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'table-cell'
  | 'table-header'
  | 'label'
  | 'caption'
  | 'blockquote'
  | 'code-block'
  | 'badge'
  | 'status-message'
  | 'metric-value'
  | 'description-text'
  | 'nav-text'
  | 'content-generic';

/**
 * Semantic role of content elements
 */
export type ContentRole =
  | 'heading'
  | 'body-text'
  | 'list-item'
  | 'table-cell'
  | 'table-header'
  | 'label'
  | 'caption'
  | 'quote'
  | 'code'
  | 'badge'
  | 'status'
  | 'metric'
  | 'description'
  | 'navigation'
  | 'generic';

/**
 * Metadata for content elements
 */
export interface ContentMetadata {
  /** Semantic role of the content */
  contentRole: ContentRole;
  /** Heading level (1-6) for heading content */
  headingLevel?: number;
  /** Whether the content is dynamically updated */
  dynamic?: boolean;
  /** Stable text prefix for identification when full text changes */
  stableTextPrefix?: string;
  /** Structural context (e.g., "table > tbody > tr:nth-child(2)") */
  structuralContext?: string;
}

/**
 * Types of media elements
 */
export type MediaType = 'image' | 'video' | 'canvas' | 'svg' | 'picture' | 'background-image';

/**
 * Metadata for media elements (images, video, canvas, SVG, etc.)
 */
export interface MediaMetadata {
  /** Type of media element */
  mediaType: MediaType;
  /** Source URL */
  src?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Whether the image is decorative (empty alt or role="presentation") */
  isDecorative: boolean;
  /** Natural (intrinsic) width in pixels */
  naturalWidth?: number;
  /** Natural (intrinsic) height in pixels */
  naturalHeight?: number;
  /** Rendered width in pixels */
  renderedWidth: number;
  /** Rendered height in pixels */
  renderedHeight: number;
  /** Ratio of natural to rendered size (> 2.0 indicates oversized) */
  oversizeRatio?: number;
  /** Current loading state */
  loadingState: 'pending' | 'loaded' | 'error' | 'lazy';
  /** Whether the element uses lazy loading */
  lazyLoading: boolean;
  /** Image format (e.g., 'png', 'jpg', 'webp', 'svg+xml') */
  format?: string;
  /** Transfer size in bytes (from Performance API) */
  transferSize?: number;
  /** srcset attribute value */
  srcset?: string;
  /** sizes attribute value */
  sizes?: string;
  /** Source elements from <picture> */
  sources?: Array<{ srcset: string; media?: string; type?: string }>;
  /** SVG viewBox attribute */
  svgViewBox?: string;
  /** Video-specific state */
  videoState?: {
    poster?: string;
    currentTime: number;
    duration: number;
    paused: boolean;
    muted: boolean;
  };
}

/**
 * Standard actions available on elements
 */
export type StandardAction =
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'middleClick'
  | 'type'
  | 'sendKeys'
  | 'clear'
  | 'select'
  | 'focus'
  | 'blur'
  | 'hover'
  | 'scroll'
  | 'scrollIntoView'
  | 'check'
  | 'uncheck'
  | 'toggle'
  | 'setValue'
  | 'drag'
  | 'submit'
  | 'reset'
  | 'autocomplete';

/**
 * Handler for custom actions
 */
export type ActionHandler<TParams = unknown, TResult = unknown> = (
  params?: TParams
) => TResult | Promise<TResult>;

/**
 * Custom action definition
 */
export interface CustomAction<TParams = unknown, TResult = unknown> {
  /** Action identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Description of what the action does */
  description?: string;
  /** Action handler function */
  handler: ActionHandler<TParams, TResult>;
}

/**
 * Live bounding box (viewport-relative, CSS pixels) for a registered element.
 *
 * Maintained by the `useUIElement` hook via `ResizeObserver` + scroll/resize
 * listeners — it's always fresh without a `getBoundingClientRect()` call at
 * snapshot time. Used by the runner's bbox-first click provider to skip VLM
 * pixel grounding for SDK-registered elements.
 */
export interface ElementBbox {
  /** Viewport-relative left edge in CSS pixels */
  x: number;
  /** Viewport-relative top edge in CSS pixels */
  y: number;
  /** Width in CSS pixels */
  width: number;
  /** Height in CSS pixels */
  height: number;
}

/**
 * A UI element registered with the bridge
 */
export interface RegisteredElement {
  /** Unique identifier for this element */
  id: string;
  /** The DOM element reference */
  element: HTMLElement;
  /** Type of UI element */
  type: ElementType;
  /** Human-readable label */
  label?: string;
  /** Available standard actions for this element */
  actions: StandardAction[];
  /** Custom actions specific to this element */
  customActions?: Record<string, CustomAction>;
  /** Function to get the current state */
  getState: () => ElementState;
  /** Function to get the element identifier */
  getIdentifier: () => ElementIdentifier;
  /** Timestamp when the element was registered */
  registeredAt: number;
  /** Whether this element is currently mounted */
  mounted: boolean;

  /**
   * Live viewport-relative bounding box in CSS pixels. Maintained by
   * `useUIElement` via ResizeObserver + scroll/resize listeners so snapshots
   * can expose it without recomputing layout. Undefined if the element is not
   * DOM-attached yet or the hook couldn't resolve a node.
   */
  bbox?: ElementBbox;
  /**
   * Live visibility signal (`bbox.width > 0 && bbox.height > 0`). Undefined
   * when `bbox` is undefined. A "rendered" hint only — it does not include
   * the hit-test/occlusion checks that `getState().visible` performs.
   */
  visible?: boolean;

  // Category
  /** Whether this is an interactive element, static content, or media */
  category?: 'interactive' | 'content' | 'media';
  /** Metadata for content elements */
  contentMetadata?: ContentMetadata;
  /** Metadata for media elements */
  mediaMetadata?: MediaMetadata;
  /**
   * Normalized text content of a content element (whitespace collapsed,
   * trimmed). Populated by the auto-register scanner for plain content
   * elements tagged with `data-ui-bridge-content` AND for elements found via
   * the heading/paragraph/table-cell content-discovery path (B1 —
   * manual-test remediation 2026-05-10). Lets snapshots expose the full text
   * of a heading without relying on the 50-char `label` truncation. Absent
   * for interactive elements; live DOM text is still exposed via
   * `state.textContent`.
   */
  content?: string;
  /**
   * ARIA role / semantic role of a content element, populated from
   * `data-ui-bridge-role` on the element (falls back to `role` attribute).
   * Lets callers filter semantic content by role (e.g. `role: "article"`,
   * `role: "listitem"`, `role: "status"`) without DOM traversal.
   */
  role?: string;

  // AI-Native metadata
  /** Alternative names for natural language matching */
  aliases?: string[];
  /** Human-readable description for AI agents */
  description?: string;
  /** Semantic type (more descriptive than ElementType) */
  semanticType?: string;
  /** Purpose of the element */
  purpose?: string;

  /**
   * ID of a `useUIComponent` that owns/renders this element. Set automatically
   * when the element is registered inside a `<UIBridgeComponentScope>`, so
   * snapshot consumers can discover that higher-level actions exist (e.g.
   * `POST /control/component/<ownedByComponent>/action/load-profile`) rather
   * than driving the flow through raw element clicks.
   */
  ownedByComponent?: string;
  /**
   * How this element entered the registry.
   *
   * - `'hook'`  — registered explicitly via `useUIElement` / `useUIComponent`
   *   (i.e. a developer wired it up).
   * - `'auto'`  — registered by the DOM walker in `useAutoRegister` based on
   *   tag/role selectors. Downstream consumers (snapshot filters, spec
   *   emitters, test tooling) can use this to skip or prioritize
   *   developer-instrumented elements.
   *
   * Defaults to `'hook'` when not specified so programmatic callers that
   * preceded this field behave as before.
   */
  origin?: 'hook' | 'auto';

  // ------------------------------------------------------------------
  // Structured disambiguation metadata (all optional).
  //
  // Consumers set these on `useUIElement` so NL queries like "the red Save
  // button at the bottom right" or "the destructive Confirm" can be ranked
  // without pixel-grounding via a VLM. They are open-ended strings so design
  // systems can use their own tokens; see the SDK docs for common values.
  // Snapshots pass them through verbatim.
  // ------------------------------------------------------------------
  /**
   * Semantic role / intent. Common values: `"primary"`, `"secondary"`,
   * `"destructive"`, `"ghost"`, `"link"`, `"success"`, `"warning"`.
   * Open-ended — consumers may use their own design-system tokens.
   */
  variant?: string;
  /**
   * Positional hint for disambiguation. Common values: `"top"`, `"bottom"`,
   * `"left"`, `"right"`, `"top-left"`, `"top-right"`, `"bottom-left"`,
   * `"bottom-right"`, `"center"`. Open-ended string.
   */
  position?: string;
  /**
   * Dominant color hint as seen by the user. Accepts CSS color names
   * (`"red"`, `"blue"`), hex (`"#ef4444"`), or design-token aliases
   * (`"accent"`, `"danger"`). Open-ended string.
   */
  color?: string;
  /**
   * Hierarchical semantic path, e.g.
   * `"settings-modal > theme-section > accent-color"`. Helps rank
   * "the Save button" when multiple forms each have one. Open-ended string.
   */
  contextPath?: string;

  /**
   * Element ids (or simple `*` glob patterns) that this control unhides /
   * reveals when activated (Phase 3.2, plan 2026-05-03).
   *
   * Example: a "Browse sessions" sidebar toggle might declare
   * `reveals: ["session-card-*", "promote-to-worktree-*"]` so callers can
   * answer "which control unhides element X" via
   * `GET /control/elements?revealsAny=<id-or-glob>` without grepping source.
   *
   * Each entry is matched literally or as a `*`-wildcard glob. The
   * `revealsAny` query supports both directions — the query value can be a
   * concrete id matched against a glob entry, or a glob matched against
   * concrete entries.
   */
  reveals?: string[];

  /**
   * The page route this element was registered under.
   *
   * Captured at `registerElement` time from `window.location.pathname` when
   * not provided explicitly. Used to group elements by page in snapshot
   * registration metadata so callers can confirm a tab switch actually
   * re-registered the target page's elements. Undefined in non-DOM
   * environments (SSR, tests without jsdom).
   */
  route?: string;

  /**
   * Action-driven cached state overlays.
   *
   * After a mutation action (`type`, `clear`, `setValue`, `check`, `uncheck`,
   * `toggle`, `select`, `sendKeys`, `focus`, `blur`) executes, the action
   * executor pushes the freshly-computed `ElementState` here via
   * `registry.refreshElement(id, state)`. The element's `getState()` overlays
   * these fields on top of the live DOM read so subsequent
   * `/control/element/:id` and `/control/snapshot` calls reflect the action
   * outcome even when the registered DOM node has been detached/re-rendered
   * by React between the action and the read.
   *
   * Cleared on re-registration (the new entry starts with no overrides).
   */
  cachedStateOverrides?: Partial<ElementState>;
}

// ============================================================================
// Component Types
// ============================================================================

/**
 * Generic state getter function
 */
export type StateGetter<T = unknown> = () => T;

/**
 * Component action definition
 */
export interface ComponentAction<TParams = unknown, TResult = unknown> {
  /** Action identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Description of what the action does */
  description?: string;
  /** Parameter schema (for documentation/validation) */
  paramSchema?: Record<string, unknown>;
  /** Action handler function */
  handler: ActionHandler<TParams, TResult>;
}

/**
 * A component registered with the bridge (higher-level than elements)
 */
export interface RegisteredComponent {
  /** Unique identifier for this component */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the component's purpose */
  description?: string;
  /** Available actions on this component */
  actions: ComponentAction[];
  /** Child element IDs owned by this component */
  elementIds?: string[];
  /** Timestamp when the component was registered */
  registeredAt: number;
  /** Whether this component is currently mounted */
  mounted: boolean;
  /** State getter function */
  getState?: StateGetter<Record<string, unknown>>;
  /** Computed properties getter function */
  getComputed?: () => Record<string, unknown>;
  /**
   * Discoverability scope (Phase 3.1, plan 2026-05-03).
   *
   * - `'route'` (or undefined — the default): the component only shows up in
   *   listings while the page that mounted it is active. Mirrors today's
   *   behavior: components mount/unmount with route changes.
   * - `'global'`: the component is intended to be available regardless of the
   *   current route (e.g. a permanent search overlay or app-shell control).
   *
   * This field is currently a discoverability annotation only — listings echo
   * it through to clients so they can distinguish intent without driving the
   * runtime mount lifecycle. Future work may use it to alter mount semantics.
   */
  scope?: 'global' | 'route';
}

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Workflow step types
 */
export type WorkflowStepType =
  | 'element-action'
  | 'component-action'
  | 'wait'
  | 'assert'
  | 'navigate'
  | 'branch'
  | 'loop'
  | 'extract'
  | 'log'
  | 'custom';

/**
 * Branch condition for conditional workflow execution
 */
export interface BranchCondition {
  /** State IDs that must be active */
  activeStates?: string[];
  /** State IDs that must be inactive */
  inactiveStates?: string[];
  /** Element ID to check state of */
  elementId?: string;
  /** Expected element state */
  elementState?: Partial<ElementState>;
  /** Custom condition function */
  condition?: () => boolean | Promise<boolean>;
}

/**
 * Loop configuration for repeated workflow steps
 */
export interface LoopConfig {
  /** Maximum number of iterations */
  maxIterations?: number;
  /** Continue while these states are active */
  whileStatesActive?: string[];
  /** Continue while these states are inactive */
  whileStatesInactive?: string[];
  /** Custom continue condition */
  whileCondition?: () => boolean | Promise<boolean>;
  /** Delay between iterations in ms */
  delayMs?: number;
}

/**
 * Extract configuration for data extraction
 */
export interface ExtractConfig {
  /** Element ID to extract from */
  elementId: string;
  /** Property to extract (value, textContent, innerHTML, attribute) */
  property: 'value' | 'textContent' | 'innerHTML' | 'attribute' | 'state';
  /** Attribute name (if property is 'attribute') */
  attributeName?: string;
  /** Variable name to store extracted value */
  variableName: string;
  /** Optional transformation function */
  transform?: (value: unknown) => unknown;
}

/**
 * Log configuration for debugging
 */
export interface LogConfig {
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Message to log */
  message: string;
  /** Additional data to include */
  data?: Record<string, unknown>;
  /** Include current active states */
  includeStates?: boolean;
  /** Include element state */
  elementId?: string;
}

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  /** Step identifier */
  id: string;
  /** Type of step */
  type: WorkflowStepType;
  /** Target element or component ID */
  target?: string;
  /** Action to execute */
  action?: string;
  /** Action parameters */
  params?: Record<string, unknown>;
  /** Wait conditions */
  waitOptions?: WaitOptions;
  /** Expected state for assertions */
  expectedState?: Partial<ElementState>;
  /** Custom step handler */
  handler?: () => unknown | Promise<unknown>;
  /** Target states for navigation (type: 'navigate') */
  targetStates?: string[];
  /** Branch condition (type: 'branch') */
  branchCondition?: BranchCondition;
  /** Steps to execute if branch condition is true */
  thenSteps?: WorkflowStep[];
  /** Steps to execute if branch condition is false */
  elseSteps?: WorkflowStep[];
  /** Loop configuration (type: 'loop') */
  loopConfig?: LoopConfig;
  /** Steps to execute in loop */
  loopSteps?: WorkflowStep[];
  /** Extract configuration (type: 'extract') */
  extractConfig?: ExtractConfig;
  /** Log configuration (type: 'log') */
  logConfig?: LogConfig;
}

/**
 * Extended workflow step with additional branch/loop/extract support
 */
export interface ExtendedWorkflowStep extends WorkflowStep {
  /** Branch condition (type: 'branch') */
  branchCondition?: BranchCondition;
  /** Steps to execute if branch condition is true */
  thenSteps?: ExtendedWorkflowStep[];
  /** Steps to execute if branch condition is false */
  elseSteps?: ExtendedWorkflowStep[];
  /** Loop configuration (type: 'loop') */
  loopConfig?: LoopConfig;
  /** Steps to execute in loop */
  loopSteps?: ExtendedWorkflowStep[];
  /** Extract configuration (type: 'extract') */
  extractConfig?: ExtractConfig;
  /** Log configuration (type: 'log') */
  logConfig?: LogConfig;
}

/**
 * Workflow definition
 */
export interface Workflow {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the workflow does */
  description?: string;
  /** Steps to execute */
  steps: WorkflowStep[];
  /** Default parameters for the workflow */
  defaultParams?: Record<string, unknown>;
}

/**
 * Wait options for actions
 */
export interface WaitOptions {
  /** Wait for element to be visible */
  visible?: boolean;
  /** Wait for element to be enabled */
  enabled?: boolean;
  /** Wait for element to have focus */
  focused?: boolean;
  /** Wait for element state to match */
  state?: Partial<ElementState>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Polling interval in milliseconds */
  interval?: number;
}

/**
 * Action request sent to the control API
 */
export interface ActionRequest {
  /** Action to execute */
  action: StandardAction | string;
  /** Action parameters */
  params?: {
    /** Text to type */
    text?: string;
    /** Value to select */
    value?: string;
    /** Scroll offset */
    offset?: { x: number; y: number };
    /** Key modifiers */
    modifiers?: {
      ctrl?: boolean;
      shift?: boolean;
      alt?: boolean;
      meta?: boolean;
    };
    /** Additional custom parameters */
    [key: string]: unknown;
  };
  /** Wait options before executing */
  waitOptions?: WaitOptions;
}

/**
 * Response from an action execution
 */
export interface ActionResponse {
  /** Whether the action succeeded */
  success: boolean;
  /** Element state after the action */
  elementState?: ElementState;
  /** Result of the action (for custom actions) */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Stack trace if failed */
  stack?: string;
  /** Duration of the action in milliseconds */
  durationMs: number;
  /** Timestamp when the action completed */
  timestamp: number;
  /** Console errors/warnings captured during action execution */
  consoleErrors?: CapturedError[];
  /** All browser events captured during action execution, enriched with severity and source info */
  browserEvents?: ActionBrowserEvent[];
  /** Error diff: what changed as a result of this action */
  errorDiff?: ActionErrorDiff;
  /** Error impact assessment: how errors affected the UI (only present when significant errors occurred) */
  errorImpact?: ErrorImpact;
}

/**
 * An enriched browser event captured during action execution.
 * Includes classification metadata that the raw CapturedError lacks.
 */
export interface ActionBrowserEvent {
  /** The raw captured event */
  event: AnyCapturedEvent;
  /** Classified severity */
  severity: ErrorSeverity;
  /** Reason for the classification */
  reason: string;
  /** Stable fingerprint for deduplication */
  fingerprint: string;
  /** Extracted source file:line, if available */
  sourceLocation?: string;
}

/**
 * Error diff: what changed as a result of an action.
 * Compares browser events before vs after the action.
 */
export interface ActionErrorDiff {
  /** Events that appeared after the action (new fingerprints) */
  newErrors: ActionBrowserEvent[];
  /** Events present before that disappeared after */
  resolvedErrors: ActionBrowserEvent[];
  /** Net change: positive means more errors, negative means fewer */
  errorDelta: number;
}

// ============================================================================
// Form Fill Types
// ============================================================================

/**
 * Fill multiple form fields atomically
 */
export interface FillAction {
  type: 'fill';
  /** Map of element ID (or selector) to value */
  fields: Record<string, string | boolean | string[]>;
  /** Whether to trigger validation after filling (default: true) */
  triggerValidation?: boolean;
  /** Whether to clear existing values first (default: true) */
  clearFirst?: boolean;
}

/**
 * Result of filling a single form field
 */
export interface FillFieldResult {
  /** Whether this field was filled successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Validation error message if validation failed */
  validationError?: string;
}

/**
 * Result of filling multiple form fields
 */
export interface FillResult {
  /** Whether all fields were filled successfully */
  success: boolean;
  /** Number of fields that were filled */
  filledCount: number;
  /** Number of fields that encountered errors */
  errorCount: number;
  /** Per-field results keyed by field ID */
  fields: Record<string, FillFieldResult>;
}

// ============================================================================
// Action Failure Types
// ============================================================================

/**
 * Machine-readable error codes for action failures
 */
export type ActionErrorCode =
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_NOT_VISIBLE'
  | 'ELEMENT_NOT_ENABLED'
  | 'ELEMENT_NOT_INTERACTABLE'
  | 'ACTION_TIMEOUT'
  | 'ACTION_REJECTED'
  | 'STATE_NOT_REACHED'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'AMBIGUOUS_MATCH'
  | 'LOW_CONFIDENCE'
  | 'UNSUPPORTED_ACTION'
  | 'UNKNOWN_ERROR';

/**
 * Partial element match found during search
 */
export interface PartialMatch {
  /** Element ID of the partial match */
  elementId: string;
  /** Match confidence score (0-1) */
  confidence: number;
  /** Reason for partial match */
  reason: string;
  /** Type of match */
  type: string;
  /** Description of the match */
  description?: string;
}

/**
 * Suggested recovery action
 */
export interface RecoveryAction {
  /** Human-readable suggestion */
  suggestion: string;
  /** Optional command to execute */
  command?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether the original action can be retried */
  retryable: boolean;
}

/**
 * Structured error details for action failures
 */
export interface ActionFailureDetails {
  /** Machine-readable error code */
  errorCode: ActionErrorCode;
  /** Human-readable error message */
  message: string;
  /** Element ID that was targeted */
  elementId?: string;
  /** CSS selectors that were tried */
  selectorsTried?: string[];
  /** Partial matches found during element search */
  partialMatches?: PartialMatch[];
  /** Element state at time of failure */
  elementState?: ElementState;
  /** Screenshot context (base64 or URL) */
  screenshotContext?: string;
  /** Suggested recovery actions */
  suggestedActions: RecoveryAction[];
  /** Whether retrying is recommended */
  retryRecommended: boolean;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Duration of the action in milliseconds */
  durationMs?: number;
  /** Timeout that was configured in milliseconds */
  timeoutMs?: number;
}

// ============================================================================
// Element Assertion Types
// ============================================================================

/**
 * Declarative spec for asserting properties of a registered element.
 * Passed as the JSON body to `POST /ui-bridge/control/element/{id}/assert`.
 */
export interface ElementAssertionSpec {
  /** Assert the element is visible (or not) */
  visible?: boolean;
  /** Assert the element is enabled (or not) */
  enabled?: boolean;
  /** Assert the element has focus (or not) */
  focused?: boolean;
  /** Assert exact text content */
  text?: string;
  /** Assert text content contains this substring */
  textContains?: string;
  /** Assert text content matches this regex (capped at 500 chars) */
  textMatches?: string;
  /** Assert exact input/textarea value */
  value?: string;
  /** Assert checked state (checkboxes, radios) */
  checked?: boolean;
  /** Assert HTML attributes by name → expected value */
  attributes?: Record<string, string>;
  /** Assert CSS class presence / absence */
  classList?: { has?: string[]; missing?: string[] };
  /** Assert bounding-box dimensions (px) */
  boundingBox?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  };
}

/**
 * A single failed predicate within an element assertion.
 */
export interface ElementAssertionFailure {
  /** The spec field that failed (e.g. "visible", "classList.has", "boundingBox.minWidth") */
  field: string;
  /** The value the spec expected */
  expected: unknown;
  /** The actual value observed on the element */
  actual: unknown;
  /** Comparison kind */
  kind: 'exact' | 'contains' | 'regex' | 'min' | 'max' | 'absent' | 'error';
}

/**
 * Structured result of a declarative element assertion.
 * Returned by `POST /ui-bridge/control/element/{id}/assert`.
 */
export interface ElementAssertionResult {
  /** True when every checked predicate passed */
  passed: boolean;
  /** Total number of predicates evaluated */
  checked: number;
  /** Number of predicates that passed */
  passedCount: number;
  /** Details for each failing predicate (empty when `passed` is true) */
  failures: ElementAssertionFailure[];
  /** Snapshot of the element's state at assertion time */
  elementSnapshot?: {
    id: string;
    visible: boolean;
    enabled: boolean;
    focused: boolean;
    textContent?: string;
    value?: string;
    checked?: boolean;
    rect?: { x: number; y: number; width: number; height: number };
  };
}

// ============================================================================
// Bridge Snapshot & Event Types
// ============================================================================

/**
 * Registration-diagnostics metadata for a bridge snapshot.
 *
 * Lets callers distinguish the three cases that all look like
 * `elements: []` on the wire:
 *   1. "Bridge has never seen any registration" — page has no `useUIElement`
 *      coverage, or the SDK isn't wired up at all.
 *   2. "Registrations happened but are all unmounted now" — page mounted
 *      its elements earlier then tore them down (e.g. route switched).
 *   3. "Registrations happened and some are still live" — normal operation;
 *      `elements` is empty only if the caller filtered it out.
 *
 * Always present on `BridgeSnapshot`. Additive to the pre-F3 shape: legacy
 * readers of `elements` continue to work unchanged.
 */
export interface SnapshotRegistrationMetadata {
  /** Number of elements currently in the registry at snapshot time. */
  totalRegistered: number;
  /**
   * Flips `true` the first time any element registers in this SDK
   * instance's lifetime, and stays `true` for the rest of its lifetime —
   * even after every element unmounts. Use this to distinguish "bridge has
   * never seen any registration" from "registrations happened but are all
   * unmounted now".
   */
  everHadRegistrations: boolean;
  /**
   * Per-route counts and element ids of currently-registered elements,
   * keyed by the route string captured when the element was registered
   * (same semantics as the snapshot's top-level `route` field). Elements
   * drop out of the map when they unmount; a route with zero live elements
   * is omitted entirely rather than kept as `route: { count: 0, ids: [] }`.
   * Useful for confirming a tab switch actually re-registered the target
   * page's elements.
   *
   * Each entry is `{ count, ids }` — `count` mirrors the pre-Phase-1.2
   * scalar shape so existing consumers keep working unchanged, and `ids`
   * enumerates the element ids on that route so cross-route 404 messages
   * can suggest where to navigate.
   */
  byRoute: Record<string, { count: number; ids: string[] }>;
  /**
   * Mirror of the snapshot's top-level `activeTab`. The runner's
   * `/ui-bridge/control/snapshot` handler copies this in so callers reading
   * `registration.activeTab` see the same value `/ui-bridge/control/tabs`
   * reports without an extra round-trip. Absent for non-runner consumers
   * (the SDK itself has no tab system).
   */
  activeTab?: string;
  /**
   * Mirror of the snapshot's top-level `route`. Populated alongside
   * `activeTab` by the runner's snapshot handler for the same reason.
   */
  route?: string;
}

/**
 * Snapshot of the entire UI bridge state
 */
export interface BridgeSnapshot {
  /**
   * Timestamp of the snapshot (ms since epoch).
   *
   * @deprecated Prefer `snapshotTakenAtMs` — same value, clearer name.
   *   Both fields are emitted for back-compat; `timestamp` will be removed
   *   in a future major.
   */
  timestamp: number;
  /** Snapshot capture timestamp in milliseconds since epoch. */
  snapshotTakenAtMs: number;
  /**
   * Current page route at snapshot time. Captured from
   * `window.location.pathname` when available. Undefined in non-DOM
   * environments. Matches the `route` keys used in `registration.byRoute`.
   */
  route?: string;
  /**
   * Currently-active tab id for tab-based apps that decouple their visible
   * pane from `route`. The SDK does not own a tab system itself; this field
   * is populated only when the snapshot caller supplies a `getActiveTab`
   * provider on `createSnapshot` / `createSnapshotAsync`. The runner wires
   * this to its `qontinui-main-active-tab` instance-storage key (the same
   * value the `tabs_list` IPC handler returns), so cross-tab automation can
   * read `route` + `activeTab` from a single snapshot rather than calling
   * `/control/tabs` separately. Absent for non-runner consumers.
   */
  activeTab?: string;
  /**
   * Registration-diagnostics metadata — lets callers tell "no coverage"
   * from "coverage but all unmounted" without an extra probe round-trip.
   * See {@link SnapshotRegistrationMetadata}.
   */
  registration: SnapshotRegistrationMetadata;
  /**
   * Document visibility at snapshot time. Mirrors `document.hidden` /
   * `document.visibilityState`. Components that gate work on visibility
   * (WS subscriptions, polling loops, idle observers) silently no-op when
   * `hidden` is true; tests running in headless Chromium will see
   * `hidden: true` by default and need to flip it before exercising
   * those code paths. Undefined in non-DOM environments.
   */
  visibility?: {
    hidden: boolean;
    state: 'visible' | 'hidden' | 'prerender' | 'unloaded';
  };
  /** All registered elements */
  elements: Array<{
    id: string;
    /**
     * Mirror of the developer-supplied `data-ui-bridge-id` attribute when
     * present. For elements registered via `useUIElement` or stamped
     * manually in markup the registry id IS the bridge id, so `id` and
     * `uiBridgeId` are identical strings. For auto-instrumented elements
     * that were never given a stamp this is undefined. Lets consumers
     * filter by "developer-stamped only" without DOM round-trips.
     */
    uiBridgeId?: string;
    type: ElementType | string;
    tagName: string;
    label?: string;
    identifier: ElementIdentifier;
    state: ElementState;
    actions: StandardAction[];
    customActions?: string[];
    category?: 'interactive' | 'content' | 'media';
    /**
     * High-level element kind — `"interactive"` for clickable/typeable/etc.
     * elements, `"content"` for semantic plain-content elements (cards,
     * badges, pills) emitted via `data-ui-bridge-content`. Mirrors
     * `category` when set; callers can filter with `?interactiveOnly=true`
     * to exclude content entries. Absent for `"media"` (use `category`).
     */
    kind?: 'interactive' | 'content';
    /**
     * Normalized text content of a content element (whitespace-collapsed,
     * trimmed). Populated for `data-ui-bridge-content` semantic elements AND
     * for heading/paragraph/table-cell elements discovered by the auto-register
     * scanner (B1 — manual-test remediation 2026-05-10). Lets snapshot
     * consumers assert on the full text directly without relying on the
     * 50-char `label` truncation. Undefined for interactive elements.
     */
    content?: string;
    /**
     * Canonical ARIA role per the W3C ARIA-in-HTML mapping. Resolves the
     * explicit `role=` attribute when set, otherwise the implicit role for
     * the tag (e.g. `<button>` → `"button"`, `<input type="checkbox">` →
     * `"checkbox"`). Source of truth for `IrElementCriteria.role` consumed
     * by Spec-Check's matcher. Falls back to `data-ui-bridge-role` for
     * legacy content-tagged elements when the ARIA mapping returns nothing.
     */
    role?: string;
    /**
     * Explicit `aria-label` attribute, with `aria-labelledby` reference
     * resolution as fallback (multiple ids joined by spaces). Distinct from
     * `accessibleName` which runs the full W3C accessible-name algorithm.
     * Source of truth for `IrElementCriteria.aria_label`.
     */
    ariaLabel?: string;
    /**
     * W3C accessible-name algorithm output (https://w3c.github.io/accname/).
     * May consult `aria-label`, `aria-labelledby`, associated `<label>`,
     * `title`, or descendant text content depending on the role. Source
     * of truth for `IrElementCriteria.accessible_name`.
     */
    accessibleName?: string;
    /**
     * Visible text content with whitespace collapsed and trimmed.
     * `innerText`-equivalent on web (respects CSS visibility), falling
     * back to `textContent` when `innerText` isn't available. Source of
     * truth for `IrElementCriteria.text` / `text_contains`. Distinct from
     * `state.textContent` which is a snapshot of the form-control value.
     */
    text?: string;
    contentMetadata?: ContentMetadata;
    mediaMetadata?: MediaMetadata;
    /** Component (if any) that owns/renders this element. Prefer component actions for automation. */
    ownedByComponent?: string;
    /** Base URL template for the owning component, if present. */
    componentActionBasePath?: string;
    /**
     * Live viewport-relative bounding box tracked by `useUIElement`. Present
     * for SDK-registered elements whose ref has attached (or that resolved
     * via the `[data-ui-bridge-id]` fallback). Undefined for elements that
     * didn't wire up live tracking.
     */
    bbox?: ElementBbox;
    /** Live visibility (`bbox.width > 0 && bbox.height > 0`). Paired with `bbox`. */
    visible?: boolean;
    /** Stable reference that survives React re-renders */
    stableRef?: {
      id: string;
      fingerprint: string;
      semanticPath: string;
      stableId?: string;
    };
    /**
     * How this element got into the registry.
     * `'hook'` = explicit `useUIElement`/`useUIComponent`; `'auto'` = DOM-walker
     * auto-instrumentation (`useAutoRegister`). Consumers that want to ignore
     * auto-tagged entries can filter on this field.
     */
    origin?: 'hook' | 'auto';
    /**
     * Semantic role / intent hint for disambiguation (e.g. `"primary"`,
     * `"destructive"`). Passthrough from `useUIElement` options. See
     * `RegisteredElement.variant` for common values.
     */
    variant?: string;
    /**
     * Positional hint for disambiguation (e.g. `"bottom-right"`).
     * Passthrough from `useUIElement` options.
     */
    position?: string;
    /**
     * Dominant color hint as seen by the user (CSS name / hex / token).
     * Passthrough from `useUIElement` options.
     */
    color?: string;
    /**
     * Hierarchical semantic path for ranking across duplicate labels.
     * Passthrough from `useUIElement` options.
     */
    contextPath?: string;
    /**
     * The page route this element was registered under (captured from
     * `window.location.pathname` at registration time, or provided
     * explicitly by framework hooks). Matches the keys in
     * `BridgeSnapshot.registration.byRoute`. Undefined in non-DOM
     * environments.
     */
    route?: string;
    /**
     * Phase 3.2: element ids (or `*`-glob patterns) this control unhides.
     * Echoed verbatim from `useUIElement({ reveals: [...] })`. Powers
     * `GET /control/elements?revealsAny=<id-or-glob>` queries.
     */
    reveals?: string[];
  }>;
  /** All registered components */
  components: Array<{
    id: string;
    name: string;
    description?: string;
    actions: string[];
    elementIds?: string[];
    /**
     * Phase 3.1 discoverability scope (plan 2026-05-03). Echoed verbatim from
     * the registration. Undefined ≡ `'route'` (the historical default —
     * components mount/unmount with route changes). Clients use this to tell
     * whether a component is intended for cross-route availability without
     * having to grep the source.
     */
    scope?: 'global' | 'route';
  }>;
  /** Available workflows */
  workflows: Array<{
    id: string;
    name: string;
    description?: string;
    stepCount: number;
  }>;
  /** Page/route context (populated when a navigationTracker enricher is registered) */
  page?: SnapshotPageContext;
  /** Modal/dialog/popover context (populated when a modalDetector enricher is registered) */
  modalStack?: SnapshotModalContext;
  /** Toast/notification context (populated when a toastCapture enricher is registered) */
  toasts?: SnapshotToastContext;
  /** Element-relationship context (populated when a relationshipTracker enricher is registered) */
  relationships?: SnapshotRelationshipContext;
  /** Drag-and-drop context (populated when a dragDropDetector enricher is registered) */
  dragDrop?: SnapshotDragDropContext;
  /** Undo/redo context (populated when an undoTracker enricher is registered) */
  undoRedo?: SnapshotUndoContext;
  /** Keyboard shortcut context (populated when a shortcutTracker enricher is registered) */
  shortcuts?: SnapshotShortcutContext;
}

/**
 * Canonical enricher slot. Each tracker exposes a `getSnapshot*Context()` method
 * that the registry calls during `createSnapshot`/`createSnapshotAsync`. Slots
 * that take element pairs receive them from the registry — callers don't have
 * to wire that themselves.
 */
export interface SnapshotEnrichers {
  navigationTracker?: { getSnapshotPageContext(): SnapshotPageContext };
  modalDetector?: { getSnapshotModalContext(): SnapshotModalContext };
  toastCapture?: { getSnapshotToastContext(): SnapshotToastContext };
  relationshipTracker?: {
    getSnapshotRelationshipContext(
      elements?: Array<{ id: string; element: Element }>
    ): SnapshotRelationshipContext;
  };
  dragDropDetector?: {
    getSnapshotDragDropContext(
      elements?: Array<{ id: string; element: Element }>
    ): SnapshotDragDropContext;
  };
  undoTracker?: { getSnapshotUndoContext(): SnapshotUndoContext };
  shortcutTracker?: { getSnapshotShortcutContext(): SnapshotShortcutContext };
}

/**
 * Pluggable snapshot enricher: receives base context and returns extra fields
 * that get `Object.assign`ed onto the snapshot. Used for ad-hoc/custom trackers
 * (e.g. runner sidebar tabs) without growing the canonical enricher set.
 *
 * `elements` is the live list of registered elements (id + DOM node pairs).
 * `getActiveTab` is the same provider passed to `createSnapshot{,Async}` so
 * enrichers that care about tab state can read it without separate plumbing.
 * `snapshotSoFar` is the in-progress base snapshot — enrichers may inspect it
 * (e.g. read `route` or already-attached canonical fields) but must not mutate
 * it; return new fields instead.
 */
export type SnapshotEnricher = (ctx: {
  elements: Array<{ id: string; element: Element }>;
  getActiveTab?: () => string | null | undefined;
  snapshotSoFar: BridgeSnapshot;
}) => Record<string, unknown>;

/**
 * Event types emitted by the bridge
 */
export type BridgeEventType =
  | 'element:registered'
  | 'element:unregistered'
  | 'element:stateChanged'
  | 'component:registered'
  | 'component:unregistered'
  | 'action:started'
  | 'action:completed'
  | 'action:failed'
  | 'workflow:started'
  | 'workflow:stepCompleted'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'render:snapshot'
  | 'error'
  // Idle detection — composite
  | 'app:busy'
  | 'app:idle'
  // Idle detection — network signal
  | 'network:busy'
  | 'network:idle'
  | 'network:requestStart'
  | 'network:requestEnd'
  // Idle detection — DOM settling signal
  | 'dom:mutating'
  | 'dom:settled'
  // Idle detection — loading indicator signal
  | 'loading:detected'
  | 'loading:cleared'
  // Idle detection — form mutation signal
  | 'form:mutating'
  | 'form:settled'
  // Navigation — page/route changes
  | 'navigation:change'
  // Toast/notification events
  | 'toast:appeared'
  | 'toast:dismissed'
  // Browser event capture — error/warning events
  | 'browser:error'
  | 'browser:warning'
  | 'browser:crash'
  // Push-based change observation (allio-inspired)
  | 'snapshot:changed';

/**
 * Event payload structure
 */
export interface BridgeEvent<T = unknown> {
  type: BridgeEventType;
  timestamp: number;
  data: T;
}

/**
 * Event listener function
 */
export type BridgeEventListener<T = unknown> = (event: BridgeEvent<T>) => void;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * UI Bridge feature flags
 */
export interface UIBridgeFeatures {
  /** Enable render logging (DOM observation) */
  renderLog?: boolean;
  /** Enable HTTP control endpoints */
  control?: boolean;
  /** Enable debug tools (inspector, metrics) */
  debug?: boolean;
}

/**
 * UI Bridge configuration
 */
export interface UIBridgeConfig {
  /** Port for standalone server */
  serverPort?: number;
  /** API path prefix for integrated servers */
  apiPath?: string;
  /** Enable WebSocket for real-time updates */
  websocket?: boolean;
  /** WebSocket port (defaults to serverPort) */
  websocketPort?: number;
  /** Log file path for render logs */
  logFilePath?: string;
  /** Maximum number of render log entries to keep */
  maxLogEntries?: number;
  /** Enable DOM change tracking in render log. Default: true. Disable to reduce memory usage. */
  captureChanges?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Application info for discovery */
  appInfo?: {
    appId: string;
    appName: string;
    appType: 'web' | 'desktop' | 'mobile' | 'other';
    framework?: string;
  };
  /** Element-scoped event log configuration (opt-in) */
  elementLog?: ElementEventLogConfig;
}

// ============================================================================
// Element-Scoped Logging Types
// ============================================================================

/**
 * Log level for element-scoped event logging
 */
export type ElementLogLevel = 'silent' | 'error' | 'info' | 'debug';

/**
 * A single element-scoped log entry
 */
export interface ElementLogEntry {
  /** Unique entry ID */
  id: string;
  /** The element this entry relates to */
  elementId: string;
  /** The bridge event type that produced this entry */
  eventType: BridgeEventType;
  /** Classified log level */
  level: ElementLogLevel;
  /** Timestamp (ms) */
  timestamp: number;
  /** Human-readable summary */
  message: string;
  /** Optional event payload */
  data?: unknown;
}

/**
 * Options for querying element history
 */
export interface ElementHistoryOptions {
  /** Filter by event types */
  eventTypes?: BridgeEventType[];
  /** Minimum log level to include */
  minLevel?: ElementLogLevel;
  /** Only entries after this timestamp */
  since?: number;
  /** Maximum number of entries to return */
  limit?: number;
  /** Sort order (default: 'asc') */
  order?: 'asc' | 'desc';
}

/**
 * Configuration for the element event log
 */
export interface ElementEventLogConfig {
  /** Maximum entries in the shared ring buffer (default: 2000) */
  maxEntries?: number;
  /** Default log level for elements without an explicit override (default: 'error') */
  defaultLogLevel?: ElementLogLevel;
  /** Enable element event logging (default: false — opt-in) */
  enabled?: boolean;
}

// ============================================================================
// Component State Types
// ============================================================================

/**
 * Computed property definition
 */
export interface ComputedProperty<T = unknown> {
  /** Getter function for the computed value */
  getter: () => T;
  /** Description of what the computed property represents */
  description?: string;
}

/**
 * Response from getting component state
 */
export interface ComponentStateResponse {
  /** Current state values */
  state: Record<string, unknown>;
  /** Current computed property values */
  computed: Record<string, unknown>;
  /** Timestamp when the state was captured */
  timestamp: number;
}

// ============================================================================
// State Management Types
// ============================================================================

/**
 * UI State definition
 *
 * Represents a distinct state in the UI (e.g., "LoginForm", "Dashboard", "Modal").
 * States can be active or inactive, and can block other states from activating.
 */
/**
 * State provenance — how a compiled state's identity was decided by the runner-side
 * `compileStateMachineFromSpecs` pipeline (see
 * `qontinui-runner/src/lib/compile-state-machine.ts`). The SDK treats these
 * fields as opaque pass-through: the runner writes them onto the compiled
 * `StateDefinitionWithProvenance` it hands to `loadStateMachine`, and this
 * type lets the SDK round-trip them through `registerState` → snapshot →
 * `/ui-bridge/control/states/snapshot` without stripping.
 *
 * Phase 1 of the D5 Git Supervision Channel plan
 * (`plans/2026-05-13-d5-git-supervision-channel-phase-1.md` §3.3, §4.3)
 * introduces the `"git-supervised"` value; older runners may emit only the
 * other three.
 */
export type UIStateProvenance =
  | 'ai-generated'
  | 'observed'
  | 'ai-fallback'
  | 'git-supervised';

/**
 * Provenance metadata attached to a state explaining *why* the runner-side
 * compiler picked a particular provenance value. Opaque pass-through on the
 * SDK side — mirrors `StateProvenanceMeta` in
 * `qontinui-runner/src/lib/compile-state-machine.ts`.
 *
 * - `support` / `contrast` / `observationCount` / `lastObserved` — populated
 *   when the discovery artifact promoted the state to `observed`.
 * - `invalidatedAt` — populated only when `provenance === "ai-fallback"`
 *   (the observed match was invalidated within the recency window).
 * - `gitProposedAt` / `gitProposalKind` — populated only when
 *   `provenance === "git-supervised"`; identifies the git event that
 *   produced the proposal (commit / branch_switch / tag / spec_changed /
 *   working_tree_drift).
 */
export interface UIStateProvenanceMeta {
  support?: number;
  contrast?: number;
  observationCount?: number;
  lastObserved?: string;
  invalidatedAt?: string;
  gitProposedAt?: string;
  gitProposalKind?: string;
}

export interface UIState {
  /** Unique state identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Element IDs belonging to this state */
  elements: string[];
  /** Optional function to detect if state is active */
  activeWhen?: () => boolean;
  /** If true, blocks other state activations (modal behavior) */
  blocking?: boolean;
  /** Specific state IDs this state blocks */
  blocks?: string[];
  /** State group membership */
  group?: string;
  /** Cost for pathfinding (default: 1.0) */
  pathCost?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /**
   * Compile-time provenance written by the runner-side compiler. Optional
   * because hand-authored states registered via `useUIState` don't carry it
   * — only states produced by `compileStateMachineFromSpecs` and loaded via
   * `loadStateMachine(json)` will. See [`UIStateProvenance`].
   */
  provenance?: UIStateProvenance;
  /**
   * Companion metadata explaining the provenance decision. Optional and
   * shape-correlated with [`provenance`] — see [`UIStateProvenanceMeta`].
   */
  provenanceMeta?: UIStateProvenanceMeta;
}

/**
 * State group - states that activate/deactivate atomically
 *
 * When a group is activated, all its states are activated together.
 * When deactivated, all states are deactivated together.
 */
export interface UIStateGroup {
  /** Unique group identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** State IDs belonging to this group */
  states: string[];
}

/**
 * State transition definition
 *
 * Defines how to move from one set of states to another,
 * including any actions to execute during the transition.
 */
export interface UITransition {
  /** Unique transition identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Precondition: at least one must be active */
  fromStates: string[];
  /** States to activate */
  activateStates: string[];
  /** States to deactivate */
  exitStates: string[];
  /** Groups to activate */
  activateGroups?: string[];
  /** Groups to deactivate */
  exitGroups?: string[];
  /** Actions to execute during transition */
  actions?: WorkflowStep[];
  /** Cost for pathfinding */
  pathCost?: number;
  /** Whether source states remain visible during transition */
  staysVisible?: boolean;
  /** IR-emitted authoring metadata bag — opaque to runtime behavior.
   *
   * Phase 4 / UI Bridge Redesign Section 1: when a `<TransitionTo>` JSX
   * wrapper or `useUITransition` caller passes `effect`, `metadata`, or
   * `provenance`, those values land here under `__ir`. Counterfactual
   * analysis (section 6) and auto-regression generation (section 9) read
   * this bag to gate destructive transitions and feed semantic context.
   *
   * The exact shape of `__ir` is not part of the runtime contract — only
   * the build plugin / IR adapter consumes it. The runtime registry treats
   * the field as opaque and round-trips it untouched.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Path result from pathfinding
 *
 * Returned when searching for a path to target states.
 */
export interface PathResult {
  /** Whether a path was found */
  found: boolean;
  /** Transition IDs in order to reach target */
  transitions: string[];
  /** Total cost of the path */
  totalCost: number;
  /** Target state IDs */
  targetStates: string[];
  /** Estimated number of steps */
  estimatedSteps: number;
}

/**
 * Transition execution result
 */
export interface TransitionResult {
  /** Whether the transition succeeded */
  success: boolean;
  /** States that were activated */
  activatedStates: string[];
  /** States that were deactivated */
  deactivatedStates: string[];
  /** Error message if failed */
  error?: string;
  /** Phase where failure occurred (if any) */
  failedPhase?: string;
  /** Duration of the transition in milliseconds */
  durationMs: number;
}

/**
 * Navigation result
 *
 * Returned after navigating to target states via pathfinding.
 */
export interface NavigationResult {
  /** Whether navigation succeeded */
  success: boolean;
  /** The path that was followed */
  path: PathResult;
  /** Transitions that were executed */
  executedTransitions: string[];
  /** Final active states after navigation */
  finalActiveStates: string[];
  /** Error message if failed */
  error?: string;
  /** Duration of the navigation in milliseconds */
  durationMs: number;
}

/**
 * State manager snapshot
 */
export interface StateSnapshot {
  /** Timestamp of the snapshot */
  timestamp: number;
  /** Currently active state IDs */
  activeStates: string[];
  /** All registered states */
  states: UIState[];
  /** All registered state groups */
  groups: UIStateGroup[];
  /** All registered transitions */
  transitions: UITransition[];
}

// ============================================================================
// WebSocket Protocol Types
// ============================================================================

/**
 * WebSocket message types from client to server
 */
export type WSClientMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'ping'
  | 'find'
  | 'discover'
  | 'getElement'
  | 'getSnapshot'
  | 'executeAction'
  | 'executeComponentAction'
  | 'executeWorkflow'
  | 'getElementHistory'
  | 'changeEvent'
  | 'recording:start'
  | 'recording:stop'
  | 'recording:status'
  | 'recording:autosave'
  | 'recording:recover';

/**
 * WebSocket message types from server to client
 */
export type WSServerMessageType =
  | 'welcome'
  | 'pong'
  | 'subscribed'
  | 'unsubscribed'
  | 'event'
  | 'response'
  | 'error'
  | 'workflowProgress';

/**
 * Base WebSocket message structure
 */
export interface WSMessageBase {
  /** Unique message ID for request/response correlation */
  id: string;
  /** Message type */
  type: WSClientMessageType | WSServerMessageType;
  /** Timestamp when message was created */
  timestamp: number;
}

/**
 * Client message: Subscribe to events
 */
export interface WSSubscribeMessage extends WSMessageBase {
  type: 'subscribe';
  payload: {
    events?: BridgeEventType[];
    elementIds?: string[];
    componentIds?: string[];
  };
}

/**
 * Client message: Unsubscribe from events
 */
export interface WSUnsubscribeMessage extends WSMessageBase {
  type: 'unsubscribe';
  payload: {
    events?: BridgeEventType[];
  };
}

/**
 * Client message: Ping (keepalive)
 */
export interface WSPingMessage extends WSMessageBase {
  type: 'ping';
}

/**
 * Client message: Find elements
 */
export interface WSFindMessage extends WSMessageBase {
  type: 'find';
  payload?: {
    interactiveOnly?: boolean;
    includeState?: boolean;
    selector?: string;
  };
}

/**
 * Client message: Discover elements (deprecated)
 * @deprecated Use WSFindMessage instead
 */
export interface WSDiscoverMessage extends WSMessageBase {
  type: 'discover';
  payload?: {
    interactiveOnly?: boolean;
    includeState?: boolean;
    selector?: string;
  };
}

/**
 * Client message: Get element details
 */
export interface WSGetElementMessage extends WSMessageBase {
  type: 'getElement';
  payload: {
    elementId: string;
    includeState?: boolean;
  };
}

/**
 * Client message: Get full snapshot
 */
export interface WSGetSnapshotMessage extends WSMessageBase {
  type: 'getSnapshot';
}

/**
 * Client message: Execute action on element
 */
export interface WSExecuteActionMessage extends WSMessageBase {
  type: 'executeAction';
  payload: {
    elementId: string;
    action: {
      action: string;
      params?: Record<string, unknown>;
      waitOptions?: WaitOptions;
    };
  };
}

/**
 * Client message: Execute component action
 */
export interface WSExecuteComponentActionMessage extends WSMessageBase {
  type: 'executeComponentAction';
  payload: {
    componentId: string;
    action: string;
    params?: Record<string, unknown>;
  };
}

/**
 * Client message: Execute workflow
 */
export interface WSExecuteWorkflowMessage extends WSMessageBase {
  type: 'executeWorkflow';
  payload: {
    workflowId: string;
    params?: Record<string, unknown>;
    streamProgress?: boolean;
  };
}

/**
 * Client message: Get element history from the element event log
 */
export interface WSGetElementHistoryMessage extends WSMessageBase {
  type: 'getElementHistory';
  payload: {
    elementId: string;
    options?: ElementHistoryOptions;
  };
}

/**
 * Client message: Push-based change event from browser tab
 */
export interface WSChangeEventMessage extends WSMessageBase {
  type: 'changeEvent';
  payload: {
    added?: string[];
    removed?: string[];
    modified?: string[];
  };
}

/**
 * Union type for all client messages
 */
/** Recording: Start recording session */
export interface WSRecordingStartMessage extends WSMessageBase {
  type: 'recording:start';
  payload?: {
    config?: {
      debounceMs?: number;
      maxCaptures?: number;
      filterUnregistered?: boolean;
      keystrokeCoalesceMs?: number;
      autoSaveIntervalMs?: number;
    };
  };
}

/** Recording: Stop recording session */
export interface WSRecordingStopMessage extends WSMessageBase {
  type: 'recording:stop';
}

/** Recording: Get recording status */
export interface WSRecordingStatusMessage extends WSMessageBase {
  type: 'recording:status';
}

/** Recording: Auto-save partial export data for crash recovery */
export interface WSRecordingAutoSaveMessage extends WSMessageBase {
  type: 'recording:autosave';
  payload?: {
    exportData?: import('../recording/types').CooccurrenceExportData;
  };
}

/** Recording: Recover last auto-saved export data */
export interface WSRecordingRecoverMessage extends WSMessageBase {
  type: 'recording:recover';
}

export type WSClientMessage =
  | WSSubscribeMessage
  | WSUnsubscribeMessage
  | WSPingMessage
  | WSFindMessage
  | WSDiscoverMessage
  | WSGetElementMessage
  | WSGetSnapshotMessage
  | WSExecuteActionMessage
  | WSExecuteComponentActionMessage
  | WSExecuteWorkflowMessage
  | WSGetElementHistoryMessage
  | WSChangeEventMessage
  | WSRecordingStartMessage
  | WSRecordingStopMessage
  | WSRecordingStatusMessage
  | WSRecordingAutoSaveMessage
  | WSRecordingRecoverMessage;

/**
 * Server message: Welcome (sent on connection)
 */
export interface WSWelcomeMessage extends WSMessageBase {
  type: 'welcome';
  payload: {
    version: string;
    features: UIBridgeFeatures;
    clientId: string;
  };
}

/**
 * Server message: Pong (response to ping)
 */
export interface WSPongMessage extends WSMessageBase {
  type: 'pong';
}

/**
 * Server message: Subscription confirmed
 */
export interface WSSubscribedMessage extends WSMessageBase {
  type: 'subscribed';
  payload: {
    events: BridgeEventType[];
  };
}

/**
 * Server message: Unsubscription confirmed
 */
export interface WSUnsubscribedMessage extends WSMessageBase {
  type: 'unsubscribed';
  payload: {
    events: BridgeEventType[];
  };
}

/**
 * Server message: Event notification
 */
export interface WSEventMessage extends WSMessageBase {
  type: 'event';
  payload: BridgeEvent;
}

/**
 * Server message: Response to a request
 */
export interface WSResponseMessage<T = unknown> extends WSMessageBase {
  type: 'response';
  requestId: string;
  payload: {
    success: boolean;
    data?: T;
    error?: string;
  };
}

/**
 * Server message: Error
 */
export interface WSErrorMessage extends WSMessageBase {
  type: 'error';
  requestId?: string;
  payload: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Server message: Workflow progress update
 */
export interface WSWorkflowProgressMessage extends WSMessageBase {
  type: 'workflowProgress';
  requestId: string;
  payload: {
    workflowId: string;
    currentStep: number;
    totalSteps: number;
    step: {
      id: string;
      type: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
    };
    stepResult?: unknown;
    error?: string;
  };
}

/**
 * Union type for all server messages
 */
export type WSServerMessage =
  | WSWelcomeMessage
  | WSPongMessage
  | WSSubscribedMessage
  | WSUnsubscribedMessage
  | WSEventMessage
  | WSResponseMessage
  | WSErrorMessage
  | WSWorkflowProgressMessage;

/**
 * WebSocket connection state
 */
export type WSConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * WebSocket client configuration
 */
export interface WSClientConfig {
  /** WebSocket server URL */
  url: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in milliseconds */
  reconnectDelay?: number;
  /** Maximum reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number;
  /** Ping interval in milliseconds (0 = disabled) */
  pingInterval?: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
}

/**
 * Subscription options for WebSocket client
 */
export interface WSSubscriptionOptions {
  /** Event types to subscribe to */
  events?: BridgeEventType[];
  /** Filter by element IDs */
  elementIds?: string[];
  /** Filter by component IDs */
  componentIds?: string[];
}

// ============================================================================
// Accessibility Types
// ============================================================================

/**
 * ARIA checked state (can be boolean or 'mixed' for indeterminate)
 */
export type AriaCheckedState = boolean | 'mixed';

// ============================================================================
// Design Review Types
// ============================================================================

/**
 * Extended computed styles for design review (~40 design-relevant CSS properties).
 * Separate from ElementState.computedStyles to keep normal snapshots lightweight.
 */
export interface ExtendedComputedStyles {
  // Layout
  display: string;
  position: string;
  boxSizing: string;
  width: string;
  height: string;
  minWidth: string;
  maxWidth: string;
  minHeight: string;
  maxHeight: string;
  margin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  padding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  overflow: string;
  overflowX: string;
  overflowY: string;

  // Flex/Grid
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  alignSelf: string;
  gap: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;

  // Typography
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  textTransform: string;
  textDecoration: string;
  color: string;

  // Visual
  backgroundColor: string;
  backgroundImage: string;
  border: string;
  borderRadius: string;
  boxShadow: string;
  opacity: string;
  outline: string;

  // Effects
  transform: string;
  transition: string;
  cursor: string;
  zIndex: string;
  visibility: string;
  pointerEvents: string;
}

/**
 * Interaction state name for state variation capture
 */
export type InteractionStateName = 'default' | 'hover' | 'focus' | 'active' | 'disabled';

/**
 * Style diff entry: a property that changed from default state
 */
export interface StyleDiff {
  property: string;
  defaultValue: string;
  stateValue: string;
}

/**
 * Styles captured in a specific interaction state
 */
export interface StateStyles {
  state: InteractionStateName;
  styles: ExtendedComputedStyles;
  diffFromDefault: StyleDiff[];
}

/**
 * Pseudo-element computed styles
 */
export interface PseudoElementStyles {
  selector: '::before' | '::after';
  content: string;
  styles: Partial<ExtendedComputedStyles>;
}

/**
 * Full design data for a single element
 */
export interface ElementDesignData {
  elementId: string;
  label?: string;
  type: string;
  styles: ExtendedComputedStyles;
  stateVariations?: StateStyles[];
  pseudoElements?: PseudoElementStyles[];
  customProperties?: Record<string, string>;
  className?: string;
  classes?: string[];
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Design snapshot at a specific viewport width
 */
export interface ResponsiveSnapshot {
  viewportWidth: number;
  viewportLabel?: string;
  elements: ElementDesignData[];
  timestamp: number;
}

/**
 * Accessibility information for a UI element
 */
export interface ElementAccessibility {
  /** The element's computed role (explicit or implicit) */
  role: string;
  /** Computed accessible name following ARIA name computation */
  accessibleName?: string;
  /** Computed accessible description */
  accessibleDescription?: string;
  /** Value of aria-label attribute */
  ariaLabel?: string;
  /** Value of aria-labelledby attribute */
  ariaLabelledBy?: string;
  /** Value of aria-describedby attribute */
  ariaDescribedBy?: string;
  /** Whether element is expanded (for expandable elements) */
  ariaExpanded?: boolean;
  /** Whether element is selected (for selectable elements) */
  ariaSelected?: boolean;
  /** Checked state (for checkboxes, can be true/false/'mixed') */
  ariaChecked?: AriaCheckedState;
  /** Whether element is hidden from accessibility tree */
  ariaHidden?: boolean;
  /** Whether element is disabled via aria-disabled */
  ariaDisabled?: boolean;
  /** Whether element is required (for form inputs) */
  ariaRequired?: boolean;
  /** Current aria-live value for live regions */
  ariaLive?: 'off' | 'polite' | 'assertive';
  /** Tab index value */
  tabIndex: number;
  /** Whether element is in the tab order (tabindex >= 0 or naturally focusable) */
  isInTabOrder: boolean;
  /** Whether element can receive keyboard focus */
  isKeyboardAccessible: boolean;
  /** The implicit role based on element type (before explicit role override) */
  implicitRole?: string;
  /** Whether element has an explicit role attribute */
  hasExplicitRole: boolean;
}

/**
 * WCAG conformance level
 */
export type WCAGLevel = 'A' | 'AA' | 'AAA';

/**
 * Accessibility issue severity
 */
export type AccessibilitySeverity = 'critical' | 'serious' | 'moderate' | 'minor';

/**
 * An accessibility issue found during validation
 */
export interface AccessibilityIssue {
  /** Unique identifier for this issue instance */
  id: string;
  /** The WCAG success criterion this issue relates to (e.g., "4.1.2") */
  wcagCriterion: string;
  /** How severe this issue is */
  severity: AccessibilitySeverity;
  /** WCAG conformance level this criterion belongs to */
  level: WCAGLevel;
  /** Human-readable description of the issue */
  message: string;
  /** ID of the element with the issue */
  elementId: string;
  /** Selector to find the element */
  elementSelector?: string;
  /** Suggested fix for the issue */
  suggestion: string;
  /** The rule ID that detected this issue */
  ruleId: string;
}

/**
 * Accessibility validation report
 */
// Re-export fingerprint types for convenience
export type { ElementFingerprintData, RepeatPatternData } from './element-fingerprint';

export interface AccessibilityReport {
  /** When the validation was performed */
  timestamp: number;
  /** URL of the page that was validated */
  url: string;
  /** Number of elements that were scanned */
  elementsScanned: number;
  /** All issues found during validation */
  issues: AccessibilityIssue[];
  /** Number of checks that passed */
  passedCount: number;
  /** Number of checks that failed */
  failedCount: number;
  /** Whether the page meets WCAG 2.1 Level A */
  meetsWCAG_A: boolean;
  /** Whether the page meets WCAG 2.1 Level AA */
  meetsWCAG_AA: boolean;
  /** Human-readable summary of the validation */
  summary: string;
  /** Duration of the validation in milliseconds */
  durationMs: number;
}
