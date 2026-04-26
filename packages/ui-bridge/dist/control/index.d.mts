import { b9 as ActionExecutor, ar as UIBridgeRegistry, u as ControlActionRequest, C as ControlActionResponse, v as ComponentActionRequest, g as ComponentActionResponse, ek as WaitOptions, el as WaitResult, w as FindRequest, x as FindResponse, o as ControlSnapshot, F as FillFormRequest, j as FillResult, k as BatchActionRequest, l as BatchActionResponse, dk as ServerBatchOperation, dm as ServerBatchOptions, dn as ServerBatchResponse, bG as ControlBatchStep, bF as ControlBatchResponse, d4 as ReactStateInfo, eo as WorkflowEngine, y as WorkflowRunRequest, z as WorkflowRunResponse } from '../types-X8pyInrK.mjs';
export { b6 as ActionChanges, be as AutocompleteAction, bf as BatchActionStep, bg as BatchActionStepResult, bH as ControlBatchStepResult, am as DiscoveredElement, bT as DiscoveryRequest, bU as DiscoveryResponse, bW as DragAction, c5 as ElementFieldChange, ci as FallbackScreenshot, cC as KeyboardAction, cS as MouseAction, af as PageNavigateRequest, ae as PageNavigationResponse, de as ScrollAction, df as ScrollIntoViewAction, dg as ScrollLogicalPosition, dh as SelectAction, dj as SendKeysAction, dl as ServerBatchOperationResult, ds as SnapshotErrorSummary, du as SnapshotViewportContext, dH as TypeAction, ep as WorkflowRunStatus, h as WorkflowStepResult } from '../types-X8pyInrK.mjs';
import { B as BrowserEventCapture } from '../browser-capture-Da337fUf.mjs';
import { C as CompositeIdleDetector } from '../composite-idle-D2i_8D8R.mjs';
import '../types-CNyrSSSQ.mjs';
import '../tracker-DpZSyunJ.mjs';

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

/**
 * Default action executor implementation
 */
declare class DefaultActionExecutor implements ActionExecutor {
    private registry;
    private consoleCapture?;
    private idleDetector?;
    private impactAssessor?;
    /**
     * Cache of DOM elements found during discover/find that aren't in the
     * registry.  Keyed by the deterministic ID returned to the caller so that
     * a subsequent executeAction(id, …) can resolve the same element.
     * Cleared at the start of each find() call so stale references don't
     * accumulate.
     */
    private discoveryCache;
    private maxDiscoveryCacheSize;
    constructor(registry: UIBridgeRegistry, consoleCapture?: BrowserEventCapture | undefined, options?: {
        maxDiscoveryCacheSize?: number;
    });
    /**
     * Set the idle detector for waitAfter support on actions.
     */
    setIdleDetector(detector: CompositeIdleDetector): void;
    /**
     * Evict oldest entries from the discovery cache when it exceeds the size limit.
     * Map iterates in insertion order, so the first entries are the oldest.
     */
    private evictDiscoveryCache;
    /**
     * Capture a lightweight UI state snapshot for error impact assessment.
     */
    private captureUIStateSnapshot;
    /**
     * Execute an action on an element
     */
    executeAction(elementId: string, request: ControlActionRequest): Promise<ControlActionResponse>;
    /**
     * Execute an action on a component
     */
    executeComponentAction(componentId: string, request: ComponentActionRequest): Promise<ComponentActionResponse>;
    /**
     * Wait for a condition on an element
     */
    waitFor(elementId: string, options: WaitOptions): Promise<WaitResult>;
    /**
     * Find controllable elements
     */
    find(options?: FindRequest): Promise<FindResponse>;
    /**
     * Discover controllable elements
     * @deprecated Use find() instead
     */
    discover(options?: FindRequest): Promise<FindResponse>;
    /**
     * Get control snapshot
     */
    getSnapshot(): Promise<ControlSnapshot>;
    /**
     * Fill multiple form fields atomically.
     *
     * For each field entry, finds the element by registered ID or DOM query,
     * sets the value based on element type, dispatches proper events, and
     * optionally triggers validation.
     */
    fillForm(request: FillFormRequest): Promise<FillResult>;
    /**
     * Wait for element conditions
     */
    private waitForElement;
    /**
     * Wait for idle after an action based on the waitAfter specification.
     */
    private waitAfterAction;
    /**
     * Perform an action on an element
     */
    private performAction;
    private performClick;
    private performDoubleClick;
    private performRightClick;
    private performMiddleClick;
    private performType;
    /**
     * Dispatch real KeyboardEvent sequences on an element.
     *
     * For each key descriptor, fires keydown → keypress → keyup (keypress is
     * skipped for non-printable keys like Enter, Escape, Arrow*, etc.).
     * This is the correct way to interact with elements that consume raw
     * keyboard events (xterm.js terminals, CodeMirror, Monaco, canvas games).
     */
    private performSendKeys;
    /**
     * Map a key name to a KeyboardEvent.code value.
     */
    private keyToCode;
    private performClear;
    private performSelect;
    /**
     * Handle select on combobox elements (Radix, headless UI, MUI, Select2, Ant Design, etc.)
     * Strategy: click to open → find listbox/dropdown → find option → click option
     */
    private performComboboxSelect;
    /**
     * Find the open dropdown/listbox associated with an element.
     * Supports: ARIA listbox, Radix, MUI, Select2, Ant Design, Headless UI.
     */
    private findOpenDropdown;
    /**
     * Find a matching option element within a dropdown container.
     * Handles various option patterns across frameworks.
     */
    private findDropdownOption;
    /**
     * Handle autocomplete inputs: type search text, wait for suggestions,
     * then click the matching suggestion.
     */
    private performAutocomplete;
    private performFocus;
    private performBlur;
    private performHover;
    private performScroll;
    private findScrollableElement;
    private performCheck;
    private performToggle;
    private performSetValue;
    private performSubmit;
    private performReset;
    /**
     * Perform a drag operation by dispatching a sequence of mouse events.
     *
     * Follows the same composite pattern as the qontinui core library:
     * mousedown on source → wait → mousemove × N along path → mouseup on target.
     *
     * Optionally dispatches HTML5 drag events (dragstart/dragover/drop/dragend)
     * for apps that use the HTML5 Drag and Drop API instead of mouse events.
     */
    private performDrag;
    /**
     * Resolve a drag target element from a target descriptor.
     */
    private resolveTargetElement;
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
    private getElementId;
    private getElementLabel;
    private getAccessibleName;
    private inferElementType;
    private inferActions;
    /**
     * Execute multiple actions sequentially in a single call, reducing IPC round-trips.
     */
    executeBatch(request: BatchActionRequest): Promise<BatchActionResponse>;
}
/**
 * Extract React state from a DOM element's React fiber internals.
 *
 * Walks the `__reactFiber$` key to extract `memoizedState` (useState values)
 * and the `__reactProps$` key for current props.
 */
declare function extractReactState(element: HTMLElement): ReactStateInfo | null;
/**
 * Create an action executor
 */
declare function createActionExecutor(registry: UIBridgeRegistry, consoleCapture?: BrowserEventCapture): ActionExecutor;
/** Maximum batch size accepted by the server. */
declare const MAX_BATCH_SIZE = 50;
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
declare function batch(baseUrl: string, operations: ServerBatchOperation[], options?: ServerBatchOptions): Promise<ServerBatchResponse>;
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
declare function controlBatch(baseUrl: string, steps: ControlBatchStep[], options?: {
    stopOnError?: boolean;
}): Promise<ControlBatchResponse>;

/**
 * Form Fill Utility
 *
 * Standalone function to fill multiple form fields atomically.
 * Works directly with the DOM, dispatching proper events so that
 * frameworks (React, Vue, Angular) detect the changes.
 */

/**
 * Options for fillFormFields
 */
interface FillFormFieldsOptions {
    /** Whether to trigger validation after filling (default: true) */
    triggerValidation?: boolean;
    /** Whether to clear existing values first (default: true) */
    clearFirst?: boolean;
}
/**
 * Fill multiple form fields atomically.
 *
 * For each field entry, finds the element by ID (HTML id, data-testid, or
 * CSS selector) and sets the value based on element type:
 * - `<input type="checkbox/radio">`: sets `.checked` for boolean values
 * - `<select>`: sets `.value` or selected options for string[] values
 * - `<select multiple>`: sets multiple selected options for string[] values
 * - `<input>/<textarea>`: sets `.value` for string values
 *
 * Dispatches proper events (focus, input, change, blur) so that framework
 * state management (React, Vue, Angular) detects the changes.
 *
 * @param fields - Map of element ID (or CSS selector) to value
 * @param options - Optional configuration for validation and clearing
 * @returns Result summary with per-field status
 */
declare function fillFormFields(fields: Record<string, string | boolean | string[]>, options?: FillFormFieldsOptions): FillResult;

/**
 * Workflow Engine
 *
 * Executes multi-step workflows with error handling and state tracking.
 */

/**
 * Default workflow engine implementation
 */
declare class DefaultWorkflowEngine implements WorkflowEngine {
    private registry;
    private executor;
    private activeRuns;
    constructor(registry: UIBridgeRegistry, executor: ActionExecutor);
    /**
     * Run a workflow
     */
    run(workflowId: string, request?: WorkflowRunRequest): Promise<WorkflowRunResponse>;
    /**
     * Get workflow run status
     */
    getRunStatus(runId: string): Promise<WorkflowRunResponse | null>;
    /**
     * Cancel a running workflow
     */
    cancel(runId: string): Promise<boolean>;
    /**
     * List active runs
     */
    listActiveRuns(): Promise<WorkflowRunResponse[]>;
    /**
     * Execute a workflow
     */
    private executeWorkflow;
    /**
     * Execute a single step
     */
    private executeStep;
    /**
     * Execute step internal logic
     */
    private executeStepInternal;
    /**
     * Perform state assertion
     */
    private performAssertion;
    /**
     * Interpolate parameters with {{param}} syntax
     */
    private interpolateParams;
    /**
     * Build response from state
     */
    private buildResponse;
}
/**
 * Create a workflow engine
 */
declare function createWorkflowEngine(registry: UIBridgeRegistry, executor: ActionExecutor): WorkflowEngine;

export { ActionExecutor, BatchActionRequest, BatchActionResponse, ComponentActionRequest, ComponentActionResponse, ControlActionRequest, ControlActionResponse, ControlBatchResponse, ControlBatchStep, ControlSnapshot, DefaultActionExecutor, DefaultWorkflowEngine, FillFormRequest, FindRequest, FindResponse, MAX_BATCH_SIZE, ReactStateInfo, ServerBatchOperation, ServerBatchOptions, ServerBatchResponse, WaitResult, WorkflowEngine, WorkflowRunRequest, WorkflowRunResponse, batch, controlBatch, createActionExecutor, createWorkflowEngine, extractReactState, fillFormFields };
