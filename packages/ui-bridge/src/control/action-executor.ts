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

type PerformActionFn = (
  element: HTMLElement,
  action: string,
  params?: Record<string, unknown>
) => Promise<void>;
let _canonicalPerformAction: PerformActionFn | null | undefined;

interface UIBridgeAutoModule {
  performAction?: PerformActionFn;
}

function getCanonicalPerformAction(): PerformActionFn | null {
  if (_canonicalPerformAction !== undefined) return _canonicalPerformAction;
  let mod: UIBridgeAutoModule | undefined;
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const direct = g.__QONTINUI_UI_BRIDGE_AUTO__;
    if (direct && typeof direct === 'object') {
      mod = direct as UIBridgeAutoModule;
    } else {
      const loader = g.__QONTINUI_UI_BRIDGE_AUTO_LOADER__;
      if (typeof loader === 'function') {
        try {
          const loaded = (loader as () => unknown)();
          if (loaded && typeof loaded === 'object') {
            mod = loaded as UIBridgeAutoModule;
          }
        } catch {
          mod = undefined;
        }
      }
    }
  }
  _canonicalPerformAction =
    mod && typeof mod.performAction === 'function' ? mod.performAction : null;
  return _canonicalPerformAction;
}

import type { UIBridgeRegistry } from '../core/registry';
import { serializeRegisteredElement, serializeRegisteredComponent } from '../core/registry';
import type {
  WaitOptions,
  ElementState,
  StandardAction,
  ActionBrowserEvent,
  ActionErrorDiff,
  FillResult,
  FillFieldResult,
  RegisteredElement,
} from '../core/types';
import type { CapturedError, AnyCapturedEvent } from '../debug/browser-capture-types';
import type { BrowserEventCapture } from '../debug/browser-capture';
import { classifyEvent, filterBySeverity } from '../debug/error-severity';
import { computeFingerprint, extractSourceLocation } from '../debug/error-fingerprint';
import { fillSingleField } from './fill-form';
import { applyValueMutation, readLiveValue } from './value-mutation';
import {
  readAriaLabelAttr,
  readAriaLabelledbyAttr,
  readTitleAttr,
  isInteractionBlocked,
  readInteractionBlockers,
} from '../core/a11y';
import { ErrorImpactAssessor, type UIStateSnapshot } from '../debug/error-impact';
import type { CompositeIdleDetector } from '../idle/composite-idle';
import { findElementByIdentifier } from '../core/element-identifier';
// Phase 1/2 of plan `2026-08-20-ui-bridge-snapshot-identity-and-selector-candidates`:
// the snapshot-identity fold — used here to PARSE a caller-cited id, to compare
// it against the registry's cheap live mount fold, and to stamp `find()`'s own
// payload so an off-process driver folding it can tell whether its comparison
// could see a remount at all.
import {
  computeSnapshotSignature,
  evaluateSnapshotFreshness,
  supersededSnapshotMessage,
  type SnapshotFreshness,
} from '../core/snapshot-signature';
// Phase 3: the ONE ordinal vocabulary both element-resolution chains report in.
import {
  buildElementResolution,
  scoreResolution,
  type ElementResolution,
  type ElementResolutionCandidate,
  type ElementResolutionStrategy,
} from '../core/resolution-score';
import { classString } from '../core/class-name';
// Phase 3: the executor races every action handler against its abort signal,
// so a handler that ignores the signal is still abandonable at the caller.
// `normalizeActionTimeoutMs` is the wire-boundary guard: `timeoutMs` arrives
// from an HTTP/WS body, so it is validated and clamped here — the one place
// every transport funnels through — rather than reaching `setTimeout` raw.
import { runAbortable, normalizeActionTimeoutMs, inertAbortSignal } from '../core/abortable';
// Phase 2: the executor validates action params against the action's published
// `paramSchema` before the handler runs. See `core/param-schema.ts` for the
// documented subset and for why `warn` is the default mode.
import {
  validateActionParams,
  formatParamValidationFailure,
  getDefaultParamValidationMode,
} from '../core/param-schema';
// Shared key grammar — the ONE copy, also behind the document-scoped
// `sendKeysToPage` page primitive. Keeping a private copy here is how the two
// key paths would drift.
import { NON_PRINTABLE_KEYS, buildKeyboardEventInit } from '../core/key-events';
import {
  elementRedaction,
  verdictOf,
  scrubContent,
  scrubContentByVerdict,
  scrubSelectState,
  scrubReactProps,
  scrubMediaMetadata,
  isContentRedacted,
  readScrubbedValue,
  readScrubbedText,
} from '../core/redaction';
import { getGlobalCtr } from '../ctr/registry';
import { buildActionFailureDetails } from '../diagnostics';
import { EffectVerifier } from './effect-verifier';
import { getGlobalEffectStore } from './effect-store';
import { createDefaultSignatureRegistry } from './effect-signatures';
import { createSnapshotManager } from '../ai/semantic-snapshot';
import type { SemanticSnapshotManager } from '../ai/semantic-snapshot';
import type { SignatureLookup } from './effect-signatures';
import type { ActionParams, EffectVerification, ObservabilityScope } from './effect-types';
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  ComponentActionInvokeOptions,
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
export function hasNestedQuantifiers(pattern: string): boolean {
  // Matches a group containing a quantifier (+, *, {n,}) followed by another quantifier
  return /(\((?:[^()]*[+*}])[^()]*\))[+*?]|\(\?:[^()]*[+*}][^()]*\)[+*?]/.test(pattern);
}

/**
 * Set of supported built-in action names for early validation.
 */
const SUPPORTED_ACTIONS = new Set<string>([
  'click',
  'hoverClick',
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

  // The interaction blockers, unfolded once (`enabled` below is the derived
  // fold). Same helper in every serializer AND in `getClickDisabledSignals`
  // below — see `core/a11y` — so this reader publishes exactly the verdict the
  // click path will reach.
  const disabledSignals = readInteractionBlockers(element, style);

  const state: ElementState = {
    visible: isVisible(element, rect, style),
    enabled: !isInteractionBlocked(disabledSignals),
    disabled: disabledSignals.disabled,
    ariaDisabled: disabledSignals.ariaDisabled,
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

  // §4.6 two-axis verdict, computed once — this control-side builder (#5 in
  // the plan) now SCRUBS through the choke point, not just stamps.
  const verdict = verdictOf(element);

  // Populate textContent from the element's visible text (CONTENT axis).
  // Reads textContent internally, trims, collapses whitespace, truncates to 500,
  // then scrubs the CONTENT axis through the choke point.
  state.textContent = readScrubbedText(element, verdict, {
    normalizeWhitespace: true,
    maxLen: 500,
  });

  // Fallback for icon-only elements (no textContent but has aria-label/title).
  // §4.6: re-reads raw aria-label/title — must scrub or the boundary's secret
  // is resurrected here.
  if (!state.textContent) {
    state.textContent = scrubContentByVerdict(
      readAriaLabelAttr(element) || readTitleAttr(element) || undefined,
      verdict
    );
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
  } else if (element instanceof HTMLDetailsElement) {
    state.ariaExpanded = element.open;
  } else if (element.tagName === 'SUMMARY') {
    const parentDetails = element.closest('details');
    if (parentDetails instanceof HTMLDetailsElement) {
      state.ariaExpanded = parentDetails.open;
    }
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
    state.value = readScrubbedValue(element, verdict);
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    }
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = readScrubbedValue(element, verdict);
  } else if (element instanceof HTMLSelectElement) {
    // §4.6: shared option-list scrub — uniform COUNT-collapse-when-redacted
    // across all three builders (was: preserved count + selected index here,
    // under-redacting cardinality on the /control/discover path).
    const sel = scrubSelectState(element, verdict);
    state.value = sel.value;
    state.selectedOptions = sel.selectedOptions;
    state.availableOptions = sel.availableOptions;
  }

  // §4.6 provenance — stamp the redaction verdict as DATA (behaviour-neutral;
  // an optional field). NOTE: this control-side `getElementState` does not yet
  // SCRUB `state.value`/`state.textContent` — that is builder #5 in the plan
  // and is closed in Phase 3. Stamping the verdict now is what lets the Phase-3
  // brand/`verdictFromState` wiring see this producer at all; it does not
  // change any wire bytes today.
  const redaction = elementRedaction(element);
  if (redaction) state.redaction = redaction;

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

/**
 * The folded "anything blocks interaction" predicate, for the interactability
 * pre-checks. `ElementState` carries the signals UNFOLDED (`disabled` /
 * `ariaDisabled`, plus the computed `pointerEvents` under `computedStyles`);
 * this is the one place that still wants the OR. It is exactly
 * `!ElementState.enabled` because both derive from `isInteractionBlocked`.
 */
function isDisabled(element: HTMLElement): boolean {
  return isInteractionBlocked(readInteractionBlockers(element));
}

/**
 * Click-time disabled signals.
 *
 * The SAME predicate the `ElementState` readers fold into `state.enabled`
 * (`core/a11y`'s `readInteractionBlockers` / `isInteractionBlocked`) — a
 * second, click-only copy is precisely how the reader and the actor drifted
 * apart before (a `pointer-events: none` control read `enabled: true` and then
 * had its click refused). This wrapper only RESHAPES that verdict into the
 * per-signal envelope the error surfaces so callers can disambiguate, and
 * returns `null` when nothing blocks interaction.
 */
interface ClickDisabledSignals {
  disabled: true;
  ariaDisabled: boolean;
  nativeDisabled: boolean;
  pointerEvents: string;
}

function getClickDisabledSignals(element: HTMLElement): ClickDisabledSignals | null {
  const blockers = readInteractionBlockers(element);
  if (!isInteractionBlocked(blockers)) return null;
  return {
    disabled: true,
    ariaDisabled: blockers.ariaDisabled,
    nativeDisabled: blockers.disabled,
    pointerEvents: blockers.pointerEvents,
  };
}

/**
 * Click-like actions that should be blocked when the target is disabled.
 * Includes `toggle`/`check`/`uncheck` because they call into click handlers
 * underneath in many component libraries.
 */
const CLICK_LIKE_ACTIONS = new Set<string>([
  'click',
  'hoverClick',
  'doubleClick',
  'rightClick',
  'middleClick',
  'check',
  'uncheck',
  'toggle',
]);

/**
 * Click-like actions for which a base-state `pointer-events: none` is NOT a
 * blocking signal. `hoverClick` exists specifically to drive a control whose
 * `pointer-events` are gated behind a CSS `:hover`/`group-hover` rule
 * (e.g. the runner's `ZoneHoverActions` toolbar buttons): it synthesizes the
 * hover that flips `pointer-events` to `auto` and only then clicks. Refusing
 * it on the un-hovered `pointer-events: none` reading would defeat its whole
 * purpose. A genuine `aria-disabled`/native `disabled` still blocks it — only
 * the pointer-events discriminator is waived.
 */
const POINTER_EVENTS_TOLERANT_ACTIONS = new Set<string>(['hoverClick']);

/**
 * Error subclass used to carry structured disabled-state details out through
 * the throw → catch path in `executeAction` without changing every other
 * error site. The catch block reads `.elementState` off the error and
 * forwards it onto the response when present.
 */
class ElementDisabledError extends Error {
  readonly elementState: ClickDisabledSignals;
  constructor(message: string, elementState: ClickDisabledSignals) {
    super(message);
    this.name = 'ElementDisabledError';
    this.elementState = elementState;
  }
}

/**
 * Why a click-like action's visibility pre-check refused the element.
 * Maps 1:1 onto `ActionFailureDetails.visibilityReason`.
 */
type VisibilityReason = 'hidden' | 'off-screen' | 'occluded' | 'no-layout';

/**
 * Inspect a click-like target for the "visible enough to interact" signals.
 * Returns `null` when the element is interactable; otherwise the specific
 * `VisibilityReason`.
 *
 * Detection is **signal-driven, not measurement-driven**: it keys off
 * environment-independent CSS facts (`display:none`,
 * `visibility:hidden|collapse`, an ancestor `display:none` collapsing
 * `offsetParent`) rather than `getBoundingClientRect()` geometry. jsdom (the
 * test environment) returns an all-zero rect *and* a zero viewport for every
 * element regardless of CSS, so any rect/viewport heuristic would
 * false-positive on every element. Real browsers honour the CSS facts used
 * here, so the check is meaningful in production without being a no-op or a
 * jsdom landmine. Occlusion (`occluded`) needs an `elementFromPoint`
 * hit-test that is unreliable mid-animation and is intentionally not probed
 * here; it remains a valid discriminator populated by other paths.
 * Precedence: hidden > no-layout > off-screen.
 */
function getClickVisibilityReason(element: HTMLElement): VisibilityReason | null {
  let style: CSSStyleDeclaration;
  try {
    style = window.getComputedStyle(element);
  } catch {
    // Without computed style we cannot make a confident call — don't block.
    return null;
  }

  // display:none / visibility:hidden|collapse — the strongest, fully
  // portable hiddenness signals (jsdom honours these via getComputedStyle).
  if (style.display === 'none') return 'hidden';
  if (style.visibility === 'hidden' || style.visibility === 'collapse') {
    return 'hidden';
  }

  // A zero-size box is `no-layout` — but ONLY when the environment actually
  // computes layout. jsdom returns an all-zero rect for every element
  // regardless of CSS, so a bare `width===0` test would false-positive
  // universally. Gate on an explicit, environment-independent zero-size CSS
  // declaration instead of the measured rect.
  const w = element.style.width;
  const h = element.style.height;
  if (w === '0px' || w === '0' || h === '0px' || h === '0') {
    return 'no-layout';
  }

  // Explicit off-screen positioning via inline style (a common "visually
  // hide" technique, e.g. left:-9999px). Only inspects the inline style so
  // it is deterministic and environment-independent.
  const inline = element.style;
  const offsetLeft = parseFloat(inline.left || '');
  const offsetTop = parseFloat(inline.top || '');
  if (
    (inline.position === 'absolute' || inline.position === 'fixed') &&
    ((Number.isFinite(offsetLeft) && offsetLeft <= -9999) ||
      (Number.isFinite(offsetTop) && offsetTop <= -9999))
  ) {
    return 'off-screen';
  }

  return null;
}

/**
 * Error subclass carrying the visibility discriminator out through the
 * throw → catch path in `executeAction`, mirroring `ElementDisabledError`.
 */
class ElementNotVisibleError extends Error {
  readonly visibilityReason: VisibilityReason;
  constructor(message: string, visibilityReason: VisibilityReason) {
    super(message);
    this.name = 'ElementNotVisibleError';
    this.visibilityReason = visibilityReason;
  }
}

/**
 * `Error` own-properties that carry no handler-domain meaning and must never
 * be copied into the failure context. `message`/`stack` already have dedicated
 * response fields; `name`/`cause` are plumbing.
 */
const RESERVED_ERROR_FIELDS = new Set(['name', 'message', 'stack', 'cause']);

/**
 * The typed payload a custom-action handler attached to the error it threw.
 */
interface HandlerErrorEnvelope {
  /** The handler's own machine-readable code, propagated verbatim. */
  code: string;
  /** Every other own enumerable property the handler attached. */
  fields: Record<string, unknown>;
}

/**
 * Read a typed handler-error envelope off a thrown value.
 *
 * THE DEFECT this closes: throwing is the only way a custom-action handler can
 * make `executeAction` report `success: false` (a resolved handler is a success
 * no matter what it resolved WITH), so handlers encode the machine-readable
 * reason on the thrown `Error` — `Object.assign(err, { code, terminalId,
 * exitCode })`. The outer catch used to keep `error.message` and nothing else,
 * so a dead-terminal write minted as `TERMINAL_EXITED` reached the caller as a
 * bare `UB-ACTION-FAILED` and the only remaining signal was prose.
 *
 * Returns `undefined` unless the value carries a non-empty **string** `code`,
 * which keeps ordinary `Error`s (and `DOMException`, whose `code` is a number)
 * on the historical generic shape.
 */
function readHandlerErrorEnvelope(error: unknown): HandlerErrorEnvelope | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || code.length === 0) return undefined;

  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(error as Record<string, unknown>)) {
    if (key === 'code' || RESERVED_ERROR_FIELDS.has(key)) continue;
    fields[key] = (error as Record<string, unknown>)[key];
  }
  return { code, fields };
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

  // NOTE: do NOT pass `view: window` here. Newer jsdom versions (>=23) reject
  // a cross-realm `window` reference on the MouseEvent constructor with
  // "member view is not of type Window", silently failing the dispatch chain.
  // Real browsers don't need `view` for click delivery — this was a latent
  // bug masked by tests that didn't assert `success` on click responses.
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options?.button === 'right' ? 2 : options?.button === 'middle' ? 1 : 0,
    clientX: rect.left + x,
    clientY: rect.top + y,
  });
}

/**
 * Create a pointer event relative to an element's bounding rect.
 *
 * Mirrors `createMouseEvent` so the dispatch path stays symmetric. Used for the
 * Radix-style pointer-only handler fallback: components like
 * `<Tabs.Trigger>` listen for `pointerdown`/`pointerup` rather than
 * `mousedown`/`mouseup` + `click`, and a click sequence without pointer events
 * silently no-ops on them.
 *
 * In environments without a global `PointerEvent` constructor (older jsdom
 * versions), falls back to a `MouseEvent` of the same type — pointer-only
 * handlers won't fire there, but neither will they crash, which preserves the
 * existing test surface.
 */
function createPointerEvent(type: string, element: HTMLElement, options?: MouseAction): Event {
  const rect = element.getBoundingClientRect();
  const x = options?.position?.x ?? rect.width / 2;
  const y = options?.position?.y ?? rect.height / 2;
  const button = options?.button === 'right' ? 2 : options?.button === 'middle' ? 1 : 0;
  // `buttons` mask: 1=primary, 2=right, 4=middle. For "down" events the
  // pressed button is set; for "up" events it's cleared. We mirror Playwright
  // and keep it simple: down = button mask, up/other = 0.
  const downBit = button === 2 ? 2 : button === 1 ? 4 : 1;
  const buttons = type === 'pointerdown' ? downBit : 0;

  if (typeof PointerEvent === 'function') {
    // NOTE: do NOT pass `view: window` here. jsdom's PointerEvent constructor
    // is stricter than its MouseEvent counterpart and rejects the cross-realm
    // `window` reference with "member view is not of type Window". Native
    // browsers don't need it for the event to dispatch correctly.
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      button,
      buttons,
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerType: 'mouse',
      isPrimary: true,
    });
  }
  // Fallback: synthesize as a MouseEvent so environments without
  // PointerEvent at least don't throw. Radix-style pointer handlers won't
  // fire here, but the chain remains idempotent.
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    clientX: rect.left + x,
    clientY: rect.top + y,
  });
}

/**
 * Resolve the nearest hover-revealing ancestor of a control so a `hoverClick`
 * can activate the CSS rule that flips the control interactive.
 *
 * Strategy, in priority order:
 *   1. The nearest ancestor that carries the Tailwind `group` marker class
 *      (`group`, `group/<name>`) — `group-hover:` utilities are scoped to it.
 *      This is exactly the `ZoneHoverActions` pattern.
 *   2. Otherwise the nearest ancestor whose own computed style declares
 *      `pointer-events: none` (a hover-gated container that re-enables itself
 *      on `:hover`), which is the non-Tailwind equivalent.
 *
 * Walks at most `MAX_HOVER_ANCESTOR_DEPTH` levels so a deeply-nested control
 * never triggers an unbounded climb. Returns `null` when no hoverable
 * container is found (the target is then hovered directly, which still
 * activates a `:hover` rule on the element itself).
 */
const MAX_HOVER_ANCESTOR_DEPTH = 12;

export function findHoverableAncestor(element: HTMLElement): HTMLElement | null {
  let pointerNoneCandidate: HTMLElement | null = null;
  let current = element.parentElement;
  let depth = 0;

  while (current && depth < MAX_HOVER_ANCESTOR_DEPTH) {
    // Tailwind `group` / `group/<name>` marker — the highest-signal match.
    const cls = current.classList;
    for (const token of cls) {
      if (token === 'group' || token.startsWith('group/')) {
        return current;
      }
    }

    // Remember the first pointer-events:none ancestor as a fallback.
    if (!pointerNoneCandidate) {
      try {
        if (window.getComputedStyle(current).pointerEvents === 'none') {
          pointerNoneCandidate = current;
        }
      } catch {
        // getComputedStyle can throw in degraded environments — ignore.
      }
    }

    current = current.parentElement;
    depth += 1;
  }

  return pointerNoneCandidate;
}

/**
 * Fire the hover-enter event quartet on a single element. Pointer events are
 * dispatched alongside their mouse counterparts so both pointer-only
 * (`onPointerEnter`) and mouse-only (`:hover`, `onMouseEnter`) consumers react.
 * `pointerenter`/`mouseenter` do not bubble; `pointerover`/`mouseover` do —
 * dispatching both covers handlers attached either way.
 *
 * Exported so the React IPC command-handler path
 * (`react/commandHandlers.ts`) reuses the exact hover synthesis the HTTP
 * action-executor path uses for `hoverClick`, instead of duplicating it.
 */
export function dispatchHoverEnter(element: HTMLElement): void {
  element.dispatchEvent(createPointerEvent('pointerover', element));
  element.dispatchEvent(createMouseEvent('mouseover', element));
  element.dispatchEvent(createPointerEvent('pointerenter', element));
  element.dispatchEvent(createMouseEvent('mouseenter', element));
}

/**
 * Resolve after the next animation frame so a hover-driven style/layout
 * recomputation is applied before the subsequent action. Falls back to a 0ms
 * timeout where `requestAnimationFrame` is unavailable (jsdom / SSR).
 */
export function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
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
 * Actions that mutate the element's user-visible state (input value, checked,
 * selected option, etc.). After one of these runs we push every state field
 * that could plausibly have changed into the registry overlay so reads after
 * the action match what the user would see.
 */
const MUTATION_ACTIONS = new Set<string>([
  'type',
  'sendKeys',
  'clear',
  'setValue',
  'select',
  'check',
  'uncheck',
  'toggle',
  'submit',
  'reset',
  'autocomplete',
]);

/**
 * Actions that only change focus/hover state without mutating values. After
 * these we refresh the focus-related fields but explicitly NOT `value` or
 * `checked`, so a prior `type` overlay isn't clobbered by a subsequent
 * `focus`.
 */
const STATE_ACTIONS = new Set<string>(['focus', 'blur']);

/**
 * Decide which subset of the freshly-computed post-action `ElementState`
 * should be pushed into the registry overlay for an action. Returns
 * `undefined` for actions that should not refresh anything (click, hover,
 * scroll, drag — these don't have a deterministic post-action state slot
 * the registry needs to cache; live DOM reads stay authoritative).
 */
function pickRefreshFields(action: string, state: ElementState): Partial<ElementState> | undefined {
  if (MUTATION_ACTIONS.has(action)) {
    // Full overlay — every field the action could have written.
    const updates: Partial<ElementState> = {
      visible: state.visible,
      enabled: state.enabled,
      focused: state.focused,
    };
    if (state.value !== undefined) updates.value = state.value;
    if (state.checked !== undefined) updates.checked = state.checked;
    if (state.selectedOptions !== undefined) updates.selectedOptions = state.selectedOptions;
    if (state.availableOptions !== undefined) updates.availableOptions = state.availableOptions;
    if (state.textContent !== undefined) updates.textContent = state.textContent;
    if (state.ariaChecked !== undefined) updates.ariaChecked = state.ariaChecked;
    if (state.ariaPressed !== undefined) updates.ariaPressed = state.ariaPressed;
    if (state.ariaExpanded !== undefined) updates.ariaExpanded = state.ariaExpanded;
    if (state.ariaSelected !== undefined) updates.ariaSelected = state.ariaSelected;
    if (state.validationState !== undefined) updates.validationState = state.validationState;
    return updates;
  }
  if (STATE_ACTIONS.has(action)) {
    // Focus-only refresh — explicitly skip value/checked so we don't blow
    // away a prior mutation overlay.
    return { focused: state.focused };
  }
  return undefined;
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

  // ---- D3 effect calculus (opt-in; default off = zero hot-path cost) ----
  /** When true, actions with a resolvable signature run a predict-then-verify
   *  cycle and attach `effectVerification` to the response. Off by default so
   *  existing action behaviour is byte-identical. */
  private effectVerificationEnabled: boolean;
  /** Signature registry resolving an EffectSignature per (action, element). */
  private signatureRegistry: SignatureLookup;
  /** Lazily built — only constructed when verification first runs. */
  private effectVerifier?: EffectVerifier;
  /** Lazily built — converts a ControlSnapshot into a SemanticSnapshot. */
  private snapshotManager?: SemanticSnapshotManager;

  constructor(
    private registry: UIBridgeRegistry,
    private consoleCapture?: BrowserEventCapture,
    options?: {
      maxDiscoveryCacheSize?: number;
      /** Enable D3 effect-calculus verification (default false). */
      enableEffectVerification?: boolean;
      /** Override the signature registry (default: the Phase 1 defaults). */
      signatureRegistry?: SignatureLookup;
    }
  ) {
    this.maxDiscoveryCacheSize = options?.maxDiscoveryCacheSize ?? 500;
    this.effectVerificationEnabled = options?.enableEffectVerification ?? false;
    this.signatureRegistry = options?.signatureRegistry ?? createDefaultSignatureRegistry();
    // Initialize impact assessor if we're in a browser environment
    if (typeof document !== 'undefined') {
      this.impactAssessor = new ErrorImpactAssessor({
        captureUIState: () => this.captureUIStateSnapshot(),
      });
    }
  }

  /**
   * Toggle D3 effect-calculus verification at runtime. When enabled, any action
   * whose `(action, element)` resolves an {@link EffectSignature} runs a
   * predict-then-verify cycle and returns `effectVerification` on its response.
   */
  setEffectVerificationEnabled(enabled: boolean): void {
    this.effectVerificationEnabled = enabled;
  }

  /**
   * Lazily build the {@link EffectVerifier}. Its snapshot dependency reuses the
   * executor's existing `getSnapshot()` (ControlSnapshot) and the semantic
   * snapshot manager — no parallel capture pipeline. The scope arg is accepted
   * for future scoped capture; Phase 1 captures whole-page (coverage stays 1).
   */
  private getEffectVerifier(): EffectVerifier {
    if (!this.effectVerifier) {
      this.effectVerifier = new EffectVerifier({
        captureSnapshot: async (_scope: ObservabilityScope) => {
          const control = await this.getSnapshot();
          if (!this.snapshotManager) this.snapshotManager = createSnapshotManager();
          return this.snapshotManager.createSnapshot(control);
        },
        settle: (ms: number) => sleep(ms),
      });
    }
    return this.effectVerifier;
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
   * Decide whether a caller-cited snapshot id still describes this UI.
   *
   * A thin adapter over {@link evaluateSnapshotFreshness}, which holds the
   * whole rulebook — the two cheap arms, the three-valued verdict, and why
   * "cannot judge" must never render as "fresh". The evaluation is shared
   * rather than reimplemented because this SDK has a SECOND action path (the
   * injected/relay `executeElementAction` in `react/commandHandlers.ts`, a
   * separate DOM implementation that never touches this executor), and a
   * freshness gate that answers differently depending on which transport the
   * caller reached is worse than one that does not exist.
   */
  private checkSnapshotFreshness(citedSnapshotId: string): SnapshotFreshness {
    return evaluateSnapshotFreshness(citedSnapshotId, {
      liveMountFold: this.registry.computeLiveMountFold?.(),
      lastSnapshotIdentity: this.registry.getLastSnapshotIdentity?.(),
    });
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
    // Declared out here so the failure arm can report it as well: a click that
    // threw on a `weak` semantic-path match is precisely when the caller wants
    // to know the match was weak.
    let elementResolution: ElementResolution | undefined;

    // Validate action name early — check built-in actions first
    const actionName = request.action;
    if (!SUPPORTED_ACTIONS.has(actionName)) {
      // Check if it could be a custom action (we'll verify on the element later).
      // Skip this check for CTR logical names since the element isn't resolved yet.
      const registered = this.registry.getElement(elementId);
      const isCtrTarget = !registered && getGlobalCtr().has(elementId);
      if (!registered?.customActions?.[actionName] && !isCtrTarget) {
        const message = `Unsupported action: '${actionName}'. Supported: ${Array.from(SUPPORTED_ACTIONS).join(', ')}`;
        return {
          success: false,
          error: message,
          failureDetails: buildActionFailureDetails('UB-UNSUPPORTED-ACTION', message, {
            elementId,
            context: { action: actionName },
            durationMs: performance.now() - startTime,
          }),
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }
    }

    // Opt-in stale-snapshot precondition. Runs BEFORE anything is resolved or
    // executed, because the question it answers is about the caller's
    // reasoning, not about the target: an element that resolves perfectly well
    // can still be the wrong element. Omitting `fromSnapshotId` skips this
    // entirely and preserves the pre-plan behaviour exactly.
    let snapshotFreshness: SnapshotFreshness | undefined;
    if (request.fromSnapshotId !== undefined) {
      const freshness = this.checkSnapshotFreshness(request.fromSnapshotId);
      // Reported on EVERY response that opted in, not just the refusals. A
      // caller that asked for a freshness check and got `success: true` needs
      // to see whether the check actually ran — see `checkSnapshotFreshness`.
      snapshotFreshness = freshness;
      if (freshness.verdict === 'superseded') {
        const message = supersededSnapshotMessage(freshness, elementId);
        const details = buildActionFailureDetails('UB-STALE-ELEMENT', message, {
          elementId,
          staleReason: 'snapshot-superseded',
          context: {
            citedSnapshotId: request.fromSnapshotId,
            supersededBy: freshness.supersededBy,
            currentSnapshotId: this.registry.getLastSnapshotIdentity?.()?.snapshotId,
          },
          durationMs: performance.now() - startTime,
        });
        // The shared `UB-STALE-ELEMENT` catalog entry recommends re-FINDING the
        // element. That is the right advice for the other three staleReasons
        // (`unmounted`/`rerendered`/`detached` all mean the element is gone) and
        // the WRONG advice here — re-finding the same id would succeed and click
        // the wrong thing. So the re-snapshot recovery is prepended at this emit
        // site rather than bolted onto a catalog entry three other reasons share.
        details.suggestedActions = [
          {
            suggestion: 'Take a fresh snapshot and re-resolve the target from it',
            command: 'snapshot',
            confidence: 0.95,
            retryable: true,
            priority: 0,
          },
          ...details.suggestedActions,
        ];
        return {
          success: false,
          error: message,
          failureDetails: details,
          snapshotFreshness: freshness,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }
    }

    try {
      // Find the element. Every arm records WHICH strategy produced it, so the
      // response can say what the match is worth — an exact registry hit and a
      // discovery-cache node used to be indistinguishable to the caller. See
      // `core/resolution-score.ts`; the scores are ordinal class labels, not
      // calibrated probabilities.
      const wantAlternates = request.includeResolutionAlternates === true;
      const hits: ElementResolutionCandidate[] = [];
      let element: HTMLElement | null = null;
      const recordHit = (strategy: ElementResolutionStrategy): void => {
        hits.push(scoreResolution(strategy, elementId));
      };

      const registered = this.registry.getElement(elementId);
      // Verify element is still in the live DOM (React re-renders can detach elements)
      if (registered?.element && registered.element.isConnected) {
        element = registered.element;
        recordHit('registry-id');
      }

      // If not registered or detached, try to find by identifier
      if (!element || wantAlternates) {
        const byIdentifier = findElementByIdentifier(elementId);
        if (byIdentifier) {
          element = element ?? byIdentifier;
          recordHit('element-identifier');
        }
      }

      // Try CTR (Central Target Registry) — resolves logical names to DOM
      // elements via self-healing selector fallback chains.
      //
      // The alternates probe deliberately goes through `probeInDOM` instead:
      // `resolveInDOM` self-heals (promotes/demotes selectors, writes the cache,
      // emits resolution events), which is right when the caller is about to act
      // on the result and wrong for a diagnostic probe.
      if (!element) {
        const ctr = getGlobalCtr();
        if (ctr.has(elementId)) {
          const result = ctr.resolveInDOM(elementId);
          if (result.resolved && result.element) {
            element = result.element;
            recordHit('ctr-selector');
          }
        }
      } else if (wantAlternates) {
        const ctr = getGlobalCtr();
        if (ctr.has(elementId) && ctr.probeInDOM(elementId)) {
          recordHit('ctr-selector');
        }
      }

      // If still not found, check the discovery cache (elements found via
      // find()/discover() that weren't in the registry)
      const cached = this.discoveryCache.get(elementId);
      if (cached && cached.isConnected) {
        if (element === null || wantAlternates) {
          element = element ?? cached;
          recordHit('discovery-cache');
        }
      } else if (cached && element === null) {
        // Clean up stale entry
        this.discoveryCache.delete(elementId);
      }

      // Resolve page-level sentinel IDs for scroll actions.
      // "document", "body", and "window" are virtual element IDs that target
      // the page scroll container directly, without requiring a registered element.
      if (!element && request.action === 'scroll') {
        const sentinel = elementId.toLowerCase();
        if (sentinel === 'document' || sentinel === 'body' || sentinel === 'window') {
          element = document.documentElement;
          recordHit('page-sentinel');
        }
      }

      // First hit wins, exactly as before — `hits[0]` is the arm that actually
      // produced `element`. Later entries exist only when the caller asked for
      // alternates.
      elementResolution = hits[0]
        ? buildElementResolution(hits[0], wantAlternates ? hits.slice(1) : undefined)
        : undefined;

      if (!element) {
        // Build diagnostic hint for AI consumers
        const wasRegistered = this.registry.getElement(elementId);
        const wasInCache = this.discoveryCache.has(elementId);
        let hint: string;
        // When the element *was* known to us but is gone, this is a stale
        // reference rather than a never-existed miss — report it as
        // UB-STALE-ELEMENT with the matching `staleReason` discriminator so
        // the runner can re-find instead of re-describing.
        let errorCode: import('../diagnostics').UiBridgeErrorCode = 'UB-ELEM-NOT-FOUND';
        let staleReason: 'unmounted' | 'rerendered' | 'detached' | undefined;
        if (wasRegistered && !wasRegistered.element?.isConnected) {
          hint = `Element '${elementId}' was registered but is no longer in the DOM (component may have unmounted). Try re-discovering with find() or navigate to the page containing this element.`;
          errorCode = 'UB-STALE-ELEMENT';
          staleReason = 'unmounted';
        } else if (wasInCache) {
          hint = `Element '${elementId}' was previously discovered but its DOM node was detached. Run find() again to get a fresh reference.`;
          errorCode = 'UB-STALE-ELEMENT';
          staleReason = 'detached';
        } else {
          hint = `Element '${elementId}' was never registered or discovered. Check the ID is correct, ensure the page containing it is mounted, or use find()/discover() to locate it first.`;
        }
        const message = `Element not found: ${elementId}. ${hint}`;
        return {
          success: false,
          error: message,
          failureDetails: buildActionFailureDetails(errorCode, message, {
            elementId,
            staleReason,
            durationMs: performance.now() - startTime,
          }),
          snapshotFreshness,
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
          const message = waitResult.error || 'Wait condition not met';
          // Describe the awaited condition for the discriminator + template.
          const wo = request.waitOptions;
          const conds: string[] = [];
          if (wo.visible) conds.push('visible');
          if (wo.enabled) conds.push('enabled');
          if (wo.focused) conds.push('focused');
          if (wo.state) {
            for (const [k, v] of Object.entries(wo.state)) {
              conds.push(`${k}=${String(v)}`);
            }
          }
          const waitCondition = conds.length > 0 ? conds.join(', ') : 'element condition';
          const roundedWait = Math.round(waitDurationMs);
          return {
            success: false,
            error: message,
            failureDetails: buildActionFailureDetails('UB-ACTION-TIMEOUT', message, {
              elementId,
              waitCondition,
              waitTimedOutAfterMs: roundedWait,
              timeoutType: 'computation',
              timeoutMs: wo.timeout,
              durationMs: performance.now() - startTime,
              renderContext: {
                waitDurationMs: roundedWait,
                waitCondition,
              },
            }),
            snapshotFreshness,
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
      // D3 effect calculus: when enabled AND a signature resolves for this
      // (action, element), wrap the execution in a predict-then-verify cycle.
      // Default-off and signature-gated, so the common path is unchanged. The
      // verifier never throws on a bad prediction (the outcome is data); only a
      // genuine action failure propagates to the catch below.
      let result: unknown;
      let effectVerification: EffectVerification | undefined;
      // Verify when the executor-wide flag is on OR the caller opted in for this
      // single request via `verifyEffect: true`. The per-request override lets a
      // consumer (e.g. the runner's `effect_check` step) request a verified
      // outcome without flipping a server-wide switch.
      const wantEffectVerification =
        this.effectVerificationEnabled || request.verifyEffect === true;
      const signature = wantEffectVerification
        ? this.signatureRegistry.resolve(
            request.action,
            { id: elementId, reveals: registered?.reveals },
            actionParams as Record<string, unknown> | undefined
          )
        : undefined;
      if (signature) {
        const effectParams: ActionParams = {
          action: request.action,
          elementId,
          params: actionParams as Record<string, unknown> | undefined,
          requestId: request.requestId,
        };
        const verified = await this.getEffectVerifier().verifyAction(effectParams, signature, () =>
          this.performAction(element, request.action, actionParams, registered)
        );
        result = verified.result;
        effectVerification = verified.verification;
        // Phase 2: record the verified cycle into the process-global effect
        // store so the read-only `GET /effects/recent` endpoint can surface it.
        getGlobalEffectStore().record({
          requestId: request.requestId,
          action: request.action,
          elementId,
          outcome: effectVerification.outcome,
          cause: effectVerification.cause,
          verification: effectVerification,
          timestamp: Date.now(),
        });
      } else {
        result = await this.performAction(element, request.action, actionParams, registered);
      }

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

      const elementState = getElementState(element);

      // B1+M2: Push the freshly-computed post-action state into the registry
      // so subsequent `/control/element/:id` and `/control/snapshot` reads
      // reflect the mutation (input value, checked, focus, ...) even when
      // React detaches/re-creates the DOM node between the action and the
      // next read. Only refreshes if `elementId` resolves to a registered
      // entry — find()/discover()-cached IDs won't have one and that's fine.
      try {
        const refreshUpdates = pickRefreshFields(request.action, elementState);
        if (refreshUpdates && this.registry.refreshElement) {
          this.registry.refreshElement(elementId, refreshUpdates);
        }
      } catch {
        // Refresh is best-effort observability — never let it sink an
        // otherwise-successful action.
      }

      return {
        success: true,
        elementState,
        result,
        consoleErrors,
        browserEvents,
        errorDiff,
        errorImpact,
        effectVerification,
        elementResolution,
        snapshotFreshness,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
        waitDurationMs,
        idleWaitMs,
      };
    } catch (error) {
      // For the disabled-state pre-check, surface the live element snapshot
      // alongside the error so callers can see why the click was refused
      // without having to issue a follow-up `/element/:id` read. The
      // `getElementState` snapshot already exposes `enabled` and
      // `computedStyles.pointerEvents`, so no separate field is needed.
      let elementState: ElementState | undefined;
      const message = error instanceof Error ? error.message : String(error);
      // A custom-action handler's typed throw carries its own machine-readable
      // code (+ any fields it attached). Preserve it instead of flattening to
      // the message — see `readHandlerErrorEnvelope`.
      const handlerError = readHandlerErrorEnvelope(error);
      let failureDetails;
      if (error instanceof ElementDisabledError) {
        try {
          const reg = this.registry.getElement(elementId);
          const el = reg?.element ?? findElementByIdentifier(elementId);
          if (el) elementState = getElementState(el);
        } catch {
          // Best-effort — never let snapshot failure mask the original error.
        }
        // Precedence: native > aria > pointer-none (a native `disabled`
        // property is the strongest, most actionable signal).
        const sig = error.elementState;
        const disabledReason: 'native' | 'aria' | 'pointer-none' = sig.nativeDisabled
          ? 'native'
          : sig.ariaDisabled
            ? 'aria'
            : 'pointer-none';
        failureDetails = buildActionFailureDetails('UB-ELEM-DISABLED', message, {
          elementId,
          disabledReason,
          context: {
            ariaDisabled: sig.ariaDisabled,
            nativeDisabled: sig.nativeDisabled,
            pointerEvents: sig.pointerEvents,
          },
          durationMs: performance.now() - startTime,
        });
      } else if (error instanceof ElementNotVisibleError) {
        try {
          const reg = this.registry.getElement(elementId);
          const el = reg?.element ?? findElementByIdentifier(elementId);
          if (el) elementState = getElementState(el);
        } catch {
          // Best-effort snapshot — never mask the original error.
        }
        failureDetails = buildActionFailureDetails('UB-ELEM-NOT-VISIBLE', message, {
          elementId,
          visibilityReason: error.visibilityReason,
          durationMs: performance.now() - startTime,
        });
      } else {
        failureDetails = buildActionFailureDetails('UB-ACTION-FAILED', message, {
          elementId,
          // The canonical `errorCode` stays `UB-ACTION-FAILED` — the handler's
          // vocabulary is not the SDK taxonomy. Its `code` and the fields it
          // attached ride in `context`, which is exactly the untyped bag the
          // other failure paths already use for their discriminators.
          context: handlerError
            ? { action: request.action, code: handlerError.code, ...handlerError.fields }
            : { action: request.action },
          durationMs: performance.now() - startTime,
        });
      }
      return {
        success: false,
        error: message,
        // Hoisted so callers can match on `code` without walking
        // `failureDetails.context` — and so the runner's `data.code` read
        // (mcp/ui_bridge/elements.rs) sees the handler's code rather than
        // nothing. Omitted entirely for untyped errors.
        ...(handlerError ? { code: handlerError.code } : {}),
        failureDetails,
        stack: error instanceof Error ? error.stack : undefined,
        elementState,
        elementResolution,
        snapshotFreshness,
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
    request: ComponentActionRequest,
    options: ComponentActionInvokeOptions = {}
  ): Promise<ComponentActionResponse> {
    const startTime = performance.now();

    try {
      const component = this.registry.getComponent(componentId);
      if (!component) {
        const message = `Component "${componentId}" not found. Components are only available when their page is active.`;
        return {
          success: false,
          error: message,
          failureDetails: buildActionFailureDetails('UB-ELEM-NOT-FOUND', message, {
            elementId: componentId,
            durationMs: performance.now() - startTime,
          }),
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      const action = component.actions.find((a) => a.id === request.action);
      if (!action) {
        const message = `Action not found: ${request.action}`;
        return {
          success: false,
          error: message,
          failureDetails: buildActionFailureDetails('UB-UNSUPPORTED-ACTION', message, {
            elementId: componentId,
            context: { action: request.action },
            durationMs: performance.now() - startTime,
          }),
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      // `timeoutMs` is WIRE data — every HTTP/WS entry point forwards it
      // verbatim from a JSON body — so it is validated and clamped here,
      // before it can reach a timer. See `normalizeActionTimeoutMs` for the
      // full policy (0 abandons on the next tick; negative / NaN / non-numeric
      // are refused; anything above 24h is clamped, because past 2^31-1
      // `setTimeout` wraps negative and fires immediately).
      const timeout = normalizeActionTimeoutMs(request.timeoutMs);
      if (!timeout.ok) {
        const message = `Action "${request.action}" on component "${componentId}" was rejected: ${timeout.reason}.`;
        return {
          success: false,
          error: message,
          failureDetails: buildActionFailureDetails('UB-VALIDATION-ERROR', message, {
            elementId: componentId,
            context: { action: request.action, timeoutMs: request.timeoutMs },
            durationMs: performance.now() - startTime,
          }),
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }
      const timeoutMs = timeout.timeoutMs;

      // Phase 2: `paramSchema` is published to agents, so it has to mean
      // something. Validate BEFORE the handler runs — a rejection after a
      // side-effect is not a rejection.
      const validationMode = options.paramValidation ?? getDefaultParamValidationMode();
      if (validationMode !== 'off' && action.paramSchema !== undefined) {
        // The validator walks AUTHOR-supplied schema data. It is bounded
        // against both known fault routes (`core/param-schema.ts`
        // MAX_SCHEMA_DEPTH / MAX_PATTERN_LENGTH), but it is wrapped anyway:
        // without this, a validator fault would fall into the generic catch
        // below and be reported as `UB-ACTION-FAILED` — "your handler failed"
        // — for a handler that never ran.
        let validation: ReturnType<typeof validateActionParams>;
        try {
          validation = validateActionParams(action.paramSchema, request.params);
        } catch (validatorFault) {
          const detail =
            validatorFault instanceof Error ? validatorFault.message : String(validatorFault);
          const message = `Action "${request.action}" on component "${componentId}": its declared paramSchema could not be evaluated (${detail}).`;
          if (validationMode === 'enforce') {
            // A gate that cannot be evaluated has not been cleared. Refuse —
            // but as UB-VALIDATION-ERROR naming the SCHEMA, never as a
            // handler failure.
            return {
              success: false,
              error: message,
              failureDetails: buildActionFailureDetails('UB-VALIDATION-ERROR', message, {
                elementId: componentId,
                context: { action: request.action, paramSchemaFault: detail },
                durationMs: performance.now() - startTime,
              }),
              durationMs: performance.now() - startTime,
              timestamp: Date.now(),
              requestId: request.requestId,
            };
          }
          console.warn(`[ui-bridge] ${message}`);
          validation = { valid: true, issues: [] };
        }
        if (!validation.valid) {
          const message = formatParamValidationFailure(
            componentId,
            request.action,
            validation.issues
          );
          if (validationMode === 'enforce') {
            return {
              success: false,
              error: message,
              failureDetails: buildActionFailureDetails('UB-ACTION-REJECTED', message, {
                elementId: componentId,
                context: { action: request.action, invalidParams: validation.issues },
                invalidParams: validation.issues,
                durationMs: performance.now() - startTime,
              }),
              durationMs: performance.now() - startTime,
              timestamp: Date.now(),
              requestId: request.requestId,
            };
          }
          // warn: proceed anyway. The default mode — see
          // `DEFAULT_PARAM_VALIDATION_MODE` for why the validator does not get
          // to refuse anything until its violations have been measured.
          console.warn(`[ui-bridge] ${message}`);
        }
      }

      // The handler is *given* a signal (cooperative cancellation) and is
      // *raced* against it (enforced abandonment) — a handler that ignores its
      // signal must still be abandonable at the caller. Phase 3 of plan
      // 2026-08-20-ui-bridge-action-declaration-shape.
      const outcome = await runAbortable((signal) => action.handler(request.params, { signal }), {
        signal: options.signal,
        timeoutMs,
      });

      if (outcome.aborted) {
        // Two arms, two codes. The timeout arm gets the catalog's dedicated
        // `UB-ACTION-TIMEOUT` — it exists, and a consumer matching on it would
        // otherwise never see a component-action timeout. The signal arm has
        // no dedicated code, so it keeps `UB-ACTION-FAILED` and is told apart
        // by `cancelReason`, which BOTH arms carry.
        const message =
          outcome.reason === 'timeout'
            ? `Action "${request.action}" on component "${componentId}" was abandoned after its ${timeoutMs}ms timeout elapsed.`
            : `Action "${request.action}" on component "${componentId}" was cancelled by the caller's abort signal.`;
        return {
          success: false,
          error: message,
          failureDetails: buildActionFailureDetails(
            outcome.reason === 'timeout' ? 'UB-ACTION-TIMEOUT' : 'UB-ACTION-FAILED',
            message,
            {
              elementId: componentId,
              context: { action: request.action, cancelReason: outcome.reason },
              cancelReason: outcome.reason,
              durationMs: performance.now() - startTime,
              timeoutMs,
              // `UB-ACTION-TIMEOUT`'s recovery template renders
              // `${waitDurationMs}` / `${waitCondition}`; without these the
              // agent-facing suggestion would keep the raw placeholders.
              renderContext:
                outcome.reason === 'timeout'
                  ? {
                      waitDurationMs: timeoutMs,
                      waitCondition: `action "${request.action}" to resolve`,
                    }
                  : undefined,
            }
          ),
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      return {
        success: true,
        result: outcome.result,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
        failureDetails: buildActionFailureDetails('UB-ACTION-FAILED', message, {
          elementId: componentId,
          context: { action: request.action },
          durationMs: performance.now() - startTime,
        }),
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
          // §4.6: `label` scrubs on the CONTENT axis regardless of dev-set vs
          // scraped origin (resolved design decision — one field can't
          // discriminate, and a dev who wraps a subtree intends it hidden). A
          // bare password field keeps its label; a boundary redacts it.
          label: scrubContent(registered?.label ?? this.getElementLabel(el), el),
          tagName: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          accessibleName: scrubContent(this.getAccessibleName(el), el),
          actions: registered?.actions || this.inferActions(el),
          state,
          registered: !!registered,
          // WHICH MOUNT this element belongs to — the only field that makes a
          // same-shape remount visible to anything folding this payload. Copied
          // off the registry record, and deliberately left ABSENT for a
          // DOM-scanned node: it has no registration time, and synthesizing one
          // would churn the generation fold on every call. See
          // `DiscoveredElement.registeredAt`.
          registeredAt: registered?.registeredAt,
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

        // Content elements: scrub the label ONCE against the live node
        // (auto-registered content labels can be DOM-derived; a boundary
        // redacts them) and reuse it for `accessibleName`.
        const scrubbedContentLabel = scrubContent(el.label, el.element);
        elements.push({
          id: el.id,
          type: el.type,
          label: scrubbedContentLabel,
          tagName: el.element.tagName.toLowerCase(),
          role: el.element.getAttribute('role') || undefined,
          accessibleName: scrubbedContentLabel ?? state.textContent,
          actions: [],
          state,
          registered: true,
          // See the interactive block above — mount identity, always real here
          // because a content element only reaches this loop via the registry.
          registeredAt: el.registeredAt,
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
          label: scrubContent(el.label, el.element),
          tagName: el.element.tagName.toLowerCase(),
          role: el.element.getAttribute('role') || undefined,
          // altText is CONTENT — a redacted <img>'s alt describes the secret;
          // its src/srcset/poster ARE the rendered secret (scrubbed below).
          accessibleName: scrubContent(el.label || meta?.altText, el.element),
          actions: [],
          state,
          registered: true,
          // See the interactive block above — mount identity, always real here
          // because a media element only reaches this loop via the registry.
          registeredAt: el.registeredAt,
          category: 'media',
          className: classString(el.element) || undefined,
          classes: el.element.classList?.length > 0 ? Array.from(el.element.classList) : undefined,
          mediaMetadata: scrubMediaMetadata(meta, verdictOf(el.element)),
        });
      }
    }

    return {
      elements,
      total: elements.length,
      // The identity fold over exactly the array being returned. Off-process
      // drivers fold this payload themselves to answer "did that click change
      // anything?"; emitting the fold lets them compare instead of
      // re-implementing, and — the load-bearing part — lets them read
      // `mountEvidence` and find out whether their comparison could see a
      // remount at all. See `FindResponse.signature`.
      signature: computeSnapshotSignature(elements),
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
    // Fourth snapshot path — re-derive DOM-scraped labels first, same as
    // `registry.createSnapshot()` does, or this one emits a `label` frozen at
    // first discovery beside an `ariaLabel` read live. See
    // `UIBridgeRegistry.refreshLabels`.
    try {
      this.registry.refreshLabels();
    } catch {
      // Non-fatal: fall through with the labels the registry already holds.
    }
    const elements = this.registry.getAllElements();
    const components = this.registry.getAllComponents();
    const workflows = this.registry.getAllWorkflows();

    return {
      timestamp: Date.now(),
      // Delegate to the canonical serializers so this fourth snapshot path
      // (client-side executor) emits the same canonical-superset shape as
      // the registry, server-fallback, and relay paths. The legacy inline
      // map here merged customActions into `actions`; the canonical shape
      // keeps them in the separate `customActions` field.
      elements: elements.map(
        (el) => serializeRegisteredElement(el) as unknown as ControlSnapshot['elements'][number]
      ),
      components: components.map(
        (comp) =>
          serializeRegisteredComponent(comp) as unknown as ControlSnapshot['components'][number]
      ),
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

    // Use performance.now() for the loop guard to match the time base used
    // for `deadline`. Using Date.now() here would compare epoch-millis
    // (~10¹²) against a page-relative number (~10⁵), making the condition
    // immediately false and short-circuiting the wait — see action-executor
    // wait-precondition regression test.
    while (performance.now() < deadline) {
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
   *
   * `registered` is the id-resolved registration from `executeAction`. It is
   * threaded down so custom-action precedence (below) is decided on the
   * resolved element's OWN registration rather than on a global name check.
   */
  private async performAction(
    element: HTMLElement,
    action: string,
    params?: Record<string, unknown>,
    registered?: RegisteredElement | null
  ): Promise<unknown> {
    // Disabled-state pre-check for click-like actions.
    //
    // Without this, a click on an `aria-disabled="true"` button or a
    // `pointer-events: none` Radix button reports `success: true` because the
    // dispatch sequence "succeeded" — but the React handler is a no-op, so
    // the user-visible state never changes. Surface this as an explicit
    // failure so callers can distinguish a transport success from an
    // effective no-op (the failure mode Phase 3.4's `expectChange` was
    // designed to surface from the observability side).
    if (CLICK_LIKE_ACTIONS.has(action)) {
      // Visibility pre-check first: an element that is not visible cannot be
      // meaningfully clicked, and "make it visible" (scroll/close overlay) is
      // a higher-yield recovery than the disabled-state guidance. Surfacing
      // UB-ELEM-NOT-VISIBLE here means the runner gets the scroll/reveal
      // recovery command instead of a transport-success no-op.
      const visibilityReason = getClickVisibilityReason(element);
      if (visibilityReason) {
        throw new ElementNotVisibleError(
          `element is not visible (${visibilityReason}); click was not dispatched`,
          visibilityReason
        );
      }
      const signals = getClickDisabledSignals(element);
      if (signals) {
        // For pointer-events-tolerant actions (`hoverClick`), a base-state
        // `pointer-events: none` is the very condition the action is built to
        // overcome — don't treat it as a blocker. We still block on a real
        // `aria-disabled`/native `disabled`, both of which survive hover.
        const pointerTolerant = POINTER_EVENTS_TOLERANT_ACTIONS.has(action);
        const blockingDisabled =
          signals.ariaDisabled ||
          signals.nativeDisabled ||
          (!pointerTolerant && signals.pointerEvents === 'none');
        if (blockingDisabled) {
          const reasons: string[] = [];
          if (signals.ariaDisabled) reasons.push('aria-disabled=true');
          if (signals.nativeDisabled) reasons.push('disabled property');
          if (!pointerTolerant && signals.pointerEvents === 'none') {
            reasons.push('pointer-events:none');
          }
          throw new ElementDisabledError(
            `element is disabled (${reasons.join(', ')}); click was not dispatched`,
            signals
          );
        }
      }
    }

    // Custom-action precedence — a registered handler wins over a same-named
    // built-in.
    //
    // THE DEFECT this closes: the custom-action lookup used to live ONLY in the
    // `default:` arm of the built-in switch below, so any `customActions` entry
    // whose name collides with an entry in `SUPPORTED_ACTIONS` was unreachable.
    // The runner's terminal pane registers `sendKeys`, which is also a built-in
    // verb: `performAction` dispatched the SDK's DOM key synthesis, the
    // registered handler never ran, and the call still reported
    // `success: true` — a silent ghost write whose bytes never reached the pty
    // (and which robbed the handler of its chance to return `TERMINAL_EXITED`
    // for a dead terminal).
    //
    // Precedence is decided on THIS element's own registration, never on a
    // global name check: an element that does not register `sendKeys` still
    // gets the built-in. Prefer the id-resolved registration threaded down from
    // `executeAction`; fall back to a DOM lookup for elements resolved by
    // identifier / CTR / discovery cache rather than by registry id.
    const owner = registered ?? this.registry.findByDOMElement(element);
    const customAction = owner?.customActions?.[action];
    if (customAction) {
      // A handler throw propagates to `executeAction`'s outer catch, which
      // preserves the handler's typed `code` via `readHandlerErrorEnvelope`.
      //
      // The options bag is ALWAYS supplied, exactly as the `default:` arm below
      // supplies it — `ActionHandlerOptions` promises it, and a handler written
      // the documented way (`(params, { signal }) => …`) throws on `undefined`.
      // An element action carries no cancellation source, so the signal is
      // inert; see `inertAbortSignal`. This seam MUST keep passing it: it now
      // shadows the `default:` arm for every registered custom action, so
      // dropping the bag here would silently re-open the defect that arm fixed.
      return customAction.handler(params, { signal: inertAbortSignal() });
    }

    // `hoverClick` is a SDK-native composite action (hover-reveal → click).
    // It is intentionally handled here, BEFORE delegating to ui-bridge-auto:
    // ui-bridge-auto's `performAction` has no `hoverClick` case and would throw
    // "Unknown action". Keeping it inline guarantees the behavior regardless of
    // whether the optional auto package is installed.
    if (action === 'hoverClick') {
      return this.performHoverClick(element, params as MouseAction);
    }

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
      case 'hoverClick':
        return this.performHoverClick(element, params as MouseAction);
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
        // Already-in-viewport short-circuit: return success without calling
        // the underlying scroll so a pre-click "scroll into view" never logs
        // as a confusing failure when the element is already on screen.
        // Mirrors `performScrollIntoView` in @qontinui/ui-bridge-auto so both
        // execution paths report the same shape.
        if (
          typeof window !== 'undefined' &&
          window.innerWidth > 0 &&
          window.innerHeight > 0 &&
          typeof element.getBoundingClientRect === 'function'
        ) {
          const rect = element.getBoundingClientRect();
          const fullyVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth;
          if (fullyVisible) {
            return { alreadyVisible: true, scrolled: false };
          }
        }
        element.scrollIntoView({
          behavior: scrollParams?.smooth ? 'smooth' : 'auto',
          block: scrollParams?.block || 'center',
          inline: scrollParams?.inline || 'nearest',
        });
        return { alreadyVisible: false, scrolled: true };
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
          // The options bag is ALWAYS supplied — `ActionHandlerOptions`
          // promises it, and a handler written the documented way
          // (`(params, { signal }) => …`) throws on `undefined`. An element
          // action carries no cancellation source, so the signal is inert;
          // see `inertAbortSignal`.
          return registered.customActions[action].handler(params, {
            signal: inertAbortSignal(),
          });
        }
        throw new Error(`Unknown action: ${action}`);
      }
    }
  }

  private performClick(element: HTMLElement, options?: MouseAction): void {
    // Pointer events fire FIRST so Radix-style pointer-only handlers
    // (e.g. `<Tabs.Trigger>`, `<Switch>`) see them before mouse/click.
    // They're cheap and idempotent on plain buttons that listen for `click`,
    // so dispatching unconditionally is safe.
    element.dispatchEvent(createPointerEvent('pointerdown', element, options));
    element.dispatchEvent(createMouseEvent('mousedown', element, options));
    element.dispatchEvent(createPointerEvent('pointerup', element, options));
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

  /**
   * Hover-reveal click: a single-dispatch composite that drives a control
   * whose interactivity is gated behind a CSS `:hover` / Tailwind
   * `group-hover` rule.
   *
   * Many toolbars keep their buttons `pointer-events: none` (and often
   * `opacity: 0`) in the rest state and only flip them to
   * `pointer-events: auto` when a `.group` ancestor is hovered — the runner's
   * `ZoneHoverActions` (maximize / export / close / "send terminal to a
   * window") is the canonical example. A normal `click` is refused on the
   * un-hovered `pointer-events: none` reading, and a separate one-shot `hover`
   * action doesn't help because the synthetic `:hover` doesn't persist across
   * the next HTTP `click` call.
   *
   * `performHoverClick` resolves that in one call:
   *   1. Synthesize `pointerenter`/`mouseenter`/`pointerover`/`mouseover` on
   *      the target AND its nearest hoverable ancestor (the `.group` /
   *      hover-revealing container), so a `group-hover:pointer-events-auto`
   *      rule activates.
   *   2. Wait one animation frame so the style/layout flip is applied.
   *   3. Perform the normal click dispatch chain.
   *
   * The hover is left in place (no matching `mouseleave`) so the control stays
   * interactive for the duration of the click — mirroring how a real pointer
   * would still be over the toolbar at click time.
   */
  private async performHoverClick(element: HTMLElement, options?: MouseAction): Promise<void> {
    // Hover the nearest hoverable ancestor first (outermost → innermost is
    // irrelevant for `:hover` activation, but ancestor-then-target matches the
    // natural pointer-enter order and lets a `group-hover` rule on the
    // ancestor flip the descendant's pointer-events before we touch it).
    const ancestor = findHoverableAncestor(element);
    if (ancestor && ancestor !== element) {
      this.dispatchHoverEnter(ancestor);
    }
    this.dispatchHoverEnter(element);

    // Wait one animation frame so the browser applies the hover-driven style
    // recomputation (pointer-events / opacity) before we click. Fall back to a
    // microtask-ish 0ms timeout in environments without rAF (e.g. jsdom).
    await nextAnimationFrame();

    this.performClick(element, options);
  }

  /**
   * Fire the hover-enter event quartet on a single element. Pointer events are
   * dispatched alongside their mouse counterparts so both pointer-only
   * (`onPointerEnter`) and mouse-only (`:hover`, `onMouseEnter`) consumers
   * react. `pointerenter`/`mouseenter` do not bubble; `pointerover`/`mouseover`
   * do — dispatching both covers handlers attached either way.
   */
  private dispatchHoverEnter(element: HTMLElement): void {
    dispatchHoverEnter(element);
  }

  private performDoubleClick(element: HTMLElement, options?: MouseAction): void {
    this.performClick(element, options);
    this.performClick(element, options);
    element.dispatchEvent(createMouseEvent('dblclick', element, options));
  }

  private performRightClick(element: HTMLElement, options?: MouseAction): void {
    const opts = { ...options, button: 'right' as const };
    // Pointer pair around mouse pair so pointer-only handlers fire first.
    element.dispatchEvent(createPointerEvent('pointerdown', element, opts));
    element.dispatchEvent(createMouseEvent('mousedown', element, opts));
    element.dispatchEvent(createPointerEvent('pointerup', element, opts));
    element.dispatchEvent(createMouseEvent('mouseup', element, opts));
    element.dispatchEvent(createMouseEvent('contextmenu', element, opts));
  }

  private performMiddleClick(element: HTMLElement, options?: MouseAction): void {
    const opts = { ...options, button: 'middle' as const };
    // Pointer pair around mouse pair so pointer-only handlers fire first.
    element.dispatchEvent(createPointerEvent('pointerdown', element, opts));
    element.dispatchEvent(createMouseEvent('mousedown', element, opts));
    element.dispatchEvent(createPointerEvent('pointerup', element, opts));
    element.dispatchEvent(createMouseEvent('mouseup', element, opts));
    // Browsers fire 'auxclick' (not 'click') for non-primary button clicks.
    // React's onAuxClick handler listens for this event type.
    element.dispatchEvent(createMouseEvent('auxclick', element, opts));
  }

  private async performType(element: HTMLElement, options?: TypeAction): Promise<void> {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error('Type action requires an input or textarea element');
    }

    // Validate that the caller provided the required `text` parameter.
    // Without this guard, a missing/misspelled key (e.g. callers sending
    // `value` instead of `text` because that's what `select`/`setValue` use)
    // produces a silent no-op: `options?.text || ''` was the empty string,
    // the loop typed zero characters, and the action returned success — an
    // invisible failure mode that costs minutes to diagnose. Throw a
    // descriptive error instead so misuse surfaces immediately.
    const optsAsRecord = options as unknown as Record<string, unknown> | undefined;
    if (typeof options?.text !== 'string') {
      const hasValueAlias = optsAsRecord != null && typeof optsAsRecord['value'] === 'string';
      const hint = hasValueAlias
        ? ' Got `value` — the `type` action expects `text` instead. (Tip: `select`/`setValue` use `value`, but `type` uses `text`.)'
        : '';
      throw new Error(
        `Type action requires a 'text' string parameter (the characters to type into the field).${hint}`
      );
    }

    // Route through the single shared value-mutation helper so the full focus →
    // input → onChange → change lifecycle is emitted consistently across every
    // executor surface. `clear` appends after emptying; otherwise we append to
    // the existing value (preserving the prior per-char-append end state).
    applyValueMutation(element, {
      value: options.text,
      mode: options.clear ? 'clear-then-append' : 'append',
      blur: false,
    });
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
    // Validate that the caller provided a non-empty `keys` array. The previous
    // `if (!options?.keys?.length) return;` returned silent success when the
    // caller forgot the array (or sent it as `value: "Enter"` — a common
    // mistake), making the misuse undebuggable.
    if (!Array.isArray(options?.keys) || options.keys.length === 0) {
      throw new Error(
        "sendKeys action requires a non-empty 'keys' array of {key: '<KeyName>', modifiers?} descriptors. (Example: { keys: [{ key: 'Enter' }] }.)"
      );
    }

    element.focus();
    const delay = options.delay || 0;

    for (const keyDesc of options.keys) {
      const { key } = keyDesc;
      if (!key || typeof key !== 'string') continue;
      const mods = keyDesc.modifiers || {};
      // The event init comes from the ONE shared builder so this path carries
      // the legacy `keyCode`/`which`/`charCode` fields too — without them an
      // app handler reading `e.keyCode` sees 0 and silently no-ops. The
      // dispatch LOOP stays local because it interleaves input-value mutation
      // between the events.
      element.dispatchEvent(
        new KeyboardEvent('keydown', buildKeyboardEventInit(key, mods, 'keydown'))
      );

      // Fire keypress for printable characters only (no modifiers except shift)
      const isInputElement =
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      if (
        key.length === 1 &&
        !NON_PRINTABLE_KEYS.has(key) &&
        !mods.ctrl &&
        !mods.alt &&
        !mods.meta
      ) {
        element.dispatchEvent(
          new KeyboardEvent('keypress', buildKeyboardEventInit(key, mods, 'keypress'))
        );
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

      element.dispatchEvent(new KeyboardEvent('keyup', buildKeyboardEventInit(key, mods, 'keyup')));

      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  private performClear(element: HTMLElement): void {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      applyValueMutation(element, { value: '', mode: 'clear', blur: false });
    }
  }

  private async performSelect(element: HTMLElement, options?: SelectAction): Promise<void> {
    // Validate that the caller provided a `value`. Without this guard, a
    // missing or misspelled key produces `[undefined]` below, the loop
    // matches no <option>, and the action returns success with the select
    // unchanged — an invisible failure mode.
    if (options?.value === undefined || options.value === null) {
      throw new Error(
        "select action requires a 'value' parameter (string or string[]) — the option value(s) to select."
      );
    }

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

    // Save the old value before any changes — needed for React's value tracker.
    // Raw live read (written back to the tracker, never emitted to a client).
    const previousValue = readLiveValue(element);

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
        const ariaLabel = readAriaLabelAttr(opt);
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
    // Checkbox: flip the native `checked` property + fire change (legacy path).
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      element.checked = !element.checked;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Item 2: `<details>` — flip the `open` property (not the attribute, so
    // React's controlled pattern doesn't diverge from the DOM) and dispatch
    // the native `toggle` event that any onToggle/onSummaryClick listeners
    // expect. Works whether the <details> is uncontrolled (pure DOM) or
    // React-controlled via a custom onToggle handler.
    if (element instanceof HTMLDetailsElement) {
      element.open = !element.open;
      element.dispatchEvent(new Event('toggle', { bubbles: false }));
      return;
    }

    // Item 2: `<dialog>` — showModal() / close() are the idiomatic API.
    // Guarded because jsdom historically lacked `HTMLDialogElement` support;
    // in that case we fall through to a synthetic click so tests on older
    // environments still exercise the handler.
    if (typeof HTMLDialogElement !== 'undefined' && element instanceof HTMLDialogElement) {
      if (element.open) {
        element.close();
      } else if (typeof element.showModal === 'function') {
        element.showModal();
      } else {
        // Rare: a polyfilled <dialog> without showModal — just flip the
        // attribute so downstream consumers see the state change.
        element.setAttribute('open', '');
        element.dispatchEvent(new Event('close', { bubbles: false }));
      }
      return;
    }

    // Item 2: anything carrying aria-expanded (disclosure buttons) — flip
    // the attribute so screen readers reflect the state, then dispatch a
    // synthetic click so the framework's real click handler (React
    // onClick, etc.) runs and manages any associated visual collapse.
    const ariaExpanded = element.getAttribute('aria-expanded');
    if (ariaExpanded !== null) {
      const next = ariaExpanded === 'true' ? 'false' : 'true';
      element.setAttribute('aria-expanded', next);
      element.click();
      return;
    }

    // Switch role: native path — just click.
    if (element.getAttribute('role') === 'switch') {
      element.click();
      return;
    }

    // Generic fallback: a synthetic click covers the "I forgot to mark this
    // as a disclosure but the click handler does the right thing" case.
    element.click();
  }

  private performSetValue(element: HTMLElement, params?: Record<string, unknown>): void {
    const value = params?.value as string | undefined;
    if (value === undefined) {
      throw new Error('setValue requires a "value" parameter');
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      applyValueMutation(element, { value, mode: 'replace', blur: false });
    } else if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Falling through silently returned success on an element that has no
      // value to set — the caller saw `success: true` and an unchanged page.
      // Throwing matches `performSubmit`'s "no form found" arm and the relay's
      // `UNSUPPORTED_ACTION` for the same case (`react/commandHandlers.ts`).
      throw new Error(
        `setValue is not supported on <${element.tagName.toLowerCase()}> — it applies to input, textarea and select elements.`
      );
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
   *  1. data-ui-bridge-test-id attribute (the Item-10 pinning alias)
   *  2. data-testid attribute
   *  3. HTML id attribute (skip React auto-generated IDs like `:r1a:`)
   *  4. Semantic ID: {tagName}-{slugified label}[-{index}]
   *
   * The semantic fallback produces stable IDs across discover() calls as
   * long as the element's label and DOM position don't change, making
   * them usable with executeAction(). It is only *mostly* stable: the
   * collision counter is first-free-integer in DOM-walk order, so two
   * same-slug siblings swap suffixes when the DOM reorders. Authors who need
   * a genuinely pinned id stamp `data-ui-bridge-test-id` — the same alias
   * `getBestIdentifier` (core/element-identifier.ts) and `useAutoRegister`
   * already honour above `data-testid`, honoured here so it works on the
   * unregistered-element path too.
   *
   * Note `data-ui-bridge-id` is deliberately NOT read here: it is an OUTPUT
   * the SDK stamps onto elements it has registered (see `useUIElement` /
   * `useAutoRegister`), and a registered element never reaches this function —
   * discover() uses its registry id. Reading it as an input would let one
   * verbatim author-supplied value name two elements with no collision
   * counter to separate them.
   */
  private getElementId(element: HTMLElement): string {
    // Item 10 alias — wins over everything, matching `getBestIdentifier`.
    const pinnedId = element.getAttribute('data-ui-bridge-test-id')?.trim();
    if (pinnedId) return pinnedId;

    const testId = element.getAttribute('data-testid');
    if (testId) return testId;

    const htmlId = element.id;
    if (htmlId && !/^:r[0-9a-z]+:$/i.test(htmlId)) return htmlId;

    // Build a semantic ID from the tag name + accessible label.
    // §4.6: the slug is derived from aria-label/title/textContent, so inside a
    // content-redaction boundary it would smuggle the secret out as an id.
    // Suppress the label-derived slug there — the element stays addressable by
    // its structural `tag`(-index) id.
    const tag = element.tagName.toLowerCase();
    const label = isContentRedacted(element)
      ? ''
      : readAriaLabelAttr(element) ||
        readTitleAttr(element) ||
        readScrubbedText(element, undefined, { maxLen: 40 }) ||
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
    // §4.6 oracle closure: this helper is read RAW by the discover text/label/
    // exact_text filters, so a content-redacted element must yield no
    // matchable content. Returning undefined closes the filter oracle AND keeps
    // the emitted label empty (the push wraps it in `scrubContent` too).
    if (isContentRedacted(element)) return undefined;
    const ariaLabel = readAriaLabelAttr(element);
    if (ariaLabel) return ariaLabel;

    // Resolve aria-labelledby
    const labelledBy = readAriaLabelledbyAttr(element);
    if (labelledBy) {
      const resolved = labelledBy
        .split(' ')
        .map((id) => readScrubbedText(document.getElementById(id), undefined, {}))
        .filter(Boolean)
        .join(' ');
      if (resolved) return resolved;
    }

    return (
      readTitleAttr(element) || readScrubbedText(element, undefined, { maxLen: 50 }) || undefined
    );
  }

  private getAccessibleName(element: HTMLElement): string | undefined {
    // §4.6 oracle closure — same rationale as `getElementLabel`: read RAW by
    // the discover `text` filter, so a content-redacted element yields nothing
    // matchable.
    if (isContentRedacted(element)) return undefined;
    const ariaLabel = readAriaLabelAttr(element);
    if (ariaLabel) return ariaLabel;

    const labelledBy = readAriaLabelledbyAttr(element);
    if (labelledBy) {
      const labels = labelledBy
        .split(' ')
        .map((id) => readScrubbedText(document.getElementById(id), undefined, {}))
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
        if (label) return readScrubbedText(label);
      }
    }

    return (
      readTitleAttr(element) || readScrubbedText(element, undefined, { maxLen: 50 }) || undefined
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
    // `hoverClick` is advertised alongside `click` on every clickable type so a
    // hover-gated control (pointer-events:none until group-hover) is drivable
    // in one call without a page/evaluate workaround.
    const baseActions = ['focus', 'blur', 'hover', 'sendKeys', 'scroll', 'scrollIntoView'];

    switch (type) {
      case 'button':
        return [...baseActions, 'click', 'hoverClick', 'doubleClick', 'rightClick', 'middleClick'];
      case 'input':
        return [...baseActions, 'click', 'hoverClick', 'type', 'clear'];
      case 'textarea':
        return [...baseActions, 'click', 'hoverClick', 'type', 'clear'];
      case 'select':
        return [...baseActions, 'click', 'hoverClick', 'select'];
      case 'checkbox':
        return [...baseActions, 'click', 'hoverClick', 'check', 'uncheck', 'toggle'];
      case 'radio':
        return [...baseActions, 'click', 'hoverClick', 'check'];
      case 'link':
        return [...baseActions, 'click', 'hoverClick'];
      case 'tab':
        return [...baseActions, 'click', 'hoverClick', 'middleClick'];
      default:
        return [...baseActions, 'click', 'hoverClick'];
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
/**
 * Recursion depth cap for safeSerialize.
 *
 * Without a cap, walking a useContext-style memoizedState whose value
 * carries DOM-node back-refs (each with `__reactFiber$` back-references
 * into parent fibers) explodes the fanout. The WeakSet eventually
 * terminates the walk via cycle detection, but for a runner UI with a
 * few hundred registered elements the unguarded walk can run for >10s
 * — long enough to blow the 10s IPC timeout in
 * `qontinui-runner/src-tauri/src/mcp/ui_bridge/request.rs` before
 * `extractReactState` ever returns. 6 is empirically deep enough for
 * normal hook state (props/state are rarely nested past 3-4) without
 * letting pathological graphs run away.
 */
const SAFE_SERIALIZE_MAX_DEPTH = 6;

function safeSerialize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > SAFE_SERIALIZE_MAX_DEPTH) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return '[Function]';
  if (typeof value !== 'object') return value;

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  // DOM node short-circuit. React stores DOM refs in fiber.stateNode and
  // useRef hooks; walking them would descend into __reactFiber$/__reactProps$
  // back-references attached as own enumerable properties by React, plus
  // any data-* attributes. The Element/Document/Window guards are
  // typeof-protected so this same module still works in non-DOM
  // environments (the SDK's server-side handlers import from here too).
  if (typeof Element !== 'undefined' && obj instanceof Element) {
    return `[${obj.constructor.name}]`;
  }
  if (typeof Document !== 'undefined' && obj instanceof Document) {
    return '[Document]';
  }
  if (typeof Window !== 'undefined' && obj instanceof Window) {
    return '[Window]';
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => safeSerialize(item, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    try {
      result[key] = safeSerialize((obj as Record<string, unknown>)[key], seen, depth + 1);
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

  // §4.6: this projection reads React INTERNALS, not the DOM — for a controlled
  // `<input type="password">` `props.value` IS the cleartext secret, and the
  // fiber `memoizedState` can hold it too. VALUE axis: collapse every prop
  // VALUE to the sentinel (KEYS survive — they are source identifiers the
  // developer wrote), and drop `fiberState`/`componentName`, while still
  // reporting the element as React-managed (non-null return) so callers can
  // tell "redacted" from "not React".
  const reactVerdict = verdictOf(element);
  // Extract props (replace functions with marker strings)
  const rawProps = reactPropsKey
    ? ((el[reactPropsKey] as Record<string, unknown> | undefined) ?? {})
    : {};
  const props = scrubReactProps(safeSerialize(rawProps) as Record<string, unknown>, reactVerdict);

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

  return {
    props,
    fiberState: reactVerdict.value ? [] : fiberState,
    componentName: reactVerdict.value ? undefined : componentName,
  };
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
