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
  SnapshotEnrichers,
  SnapshotEnricher,
  ElementBbox,
  IREffect,
} from './types';
import type { ElementEventLog } from '../debug/element-event-log';
import { createElementIdentifier } from './element-identifier';
import { computeElementFingerprint } from './element-fingerprint';
import {
  readAriaLabelAttr,
  readAriaLabelledbyAttr,
  readTitleAttr,
  readPlaceholderAttr,
  readDisabledSignals,
} from './a11y';
import { createStableRef } from './stable-ref';
import { truncateCodePoints } from './text';
import { fuzzyMatch } from '../ai/fuzzy-matcher';
import {
  verdictOf,
  elementRedaction,
  scrubContentByVerdict,
  scrubValueByVerdict,
  scrubContentRequired,
  scrubMediaMetadata,
  scrubAliases,
  scrubSelectState,
  trustDeveloperContent,
} from './redaction';
// Re-export the sentinel so the historical `from './core/registry'` import
// path keeps resolving; the definition itself lives in the leaf `redaction`
// module (this file imports it above for its own internal scrubbing).
export { REDACTED_VALUE } from './redaction';
import { generateAliases, generateDescription } from '../ai/alias-generator';
import type { SearchCriteria, SearchResult, AIDiscoveredElement } from '../ai/types';
import {
  computeAriaLabel,
  computeAccessibleNameSafe,
  computeRoleSafe,
  computeVisibleText,
} from './a11y';


/**
 * The attribute that opts an element (and its subtree) out of the
 * relay's snapshot. Used by §4.5's "AI in control" banner to make
 * itself unsnapshot-able / unclickable through the bridge.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */
const BRIDGE_INVISIBLE_ATTR = 'data-bridge-invisible';

/**
 * Walk from `el` up until we find `data-bridge-invisible="true"`. Returns
 * true when present. Auto-register checks this BEFORE registering an
 * element — invisible elements never enter the registry, so they don't
 * appear in snapshots and the bridge cannot drive them by id.
 */
export function isBridgeInvisible(el: HTMLElement): boolean {
  let cursor: HTMLElement | null = el;
  while (cursor !== null) {
    if (cursor.getAttribute(BRIDGE_INVISIBLE_ATTR) === 'true') return true;
    cursor = cursor.parentElement;
  }
  return false;
}

/**
 * Re-measure an element's bounding box at snapshot time. The cached
 * `el.bbox` maintained by the bbox tracker can go stale between
 * measurements: a `ResizeObserver` only fires for the element that
 * resized, so a sibling that merely *translates* (flex re-layout when a
 * neighbor grows/shrinks, tab reorder, …) keeps its old `x`/`width` in the
 * registry — which is how a `no_overlap` audit once saw three terminal
 * tabs report `w=260` (the CSS `max-width`) while their real flex-shrunk
 * pitch was ~214px (qontinui-runner#186). Snapshots are the trust boundary
 * for audits, so they must reflect the DOM *now*, not at last observation.
 *
 * Returns `null` when there is no fresh signal — element detached, no
 * `getBoundingClientRect` (non-DOM env), or a zero-size rect (hidden
 * element, or jsdom's stub rect in tests). Callers fall back to the cached
 * tracker value in that case, preserving the lazy-tracking contract that
 * off-screen elements retain their last-known bbox.
 */
export function measureFreshBbox(
  element: HTMLElement | undefined
): { bbox: ElementBbox; visible: true } | null {
  if (!element?.isConnected || typeof element.getBoundingClientRect !== 'function') {
    return null;
  }
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return {
    bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    visible: true,
  };
}

/**
 * Single source of truth for serializing a `RegisteredElement` to a snapshot
 * entry. Used by `createSnapshot`/`createSnapshotAsync` here AND by the
 * runner's `serializeElement` helper so the two paths cannot drift. When you
 * add a field to `RegisteredElement` that should appear in serialized form,
 * add it here only.
 *
 * Returns the snapshot-shape (no `element`). Wrappers that need additional
 * fields can spread and extend. `registeredAt`/`mounted` are emitted so the
 * wire shape is a strict superset of the canonical
 * `qontinui-types::ui_bridge::UIBridgeElement` (which requires both).
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
  // Surface the developer-stamped `data-ui-bridge-id` attribute as a
  // dedicated `uiBridgeId` field. For stamped elements the registry id
  // already equals this value (see useAutoRegister.ts:819 — existingStamp
  // wins). Echoing it as a named field saves consumers from having to
  // know that `id` IS the bridge id, and lets them filter snapshots to
  // "manually stamped" entries without DOM queries.
  const uiBridgeId =
    typeof el.element?.getAttribute === 'function'
      ? el.element.getAttribute('data-ui-bridge-id') ?? undefined
      : undefined;
  // Structural-accessibility view (Stream-A A.5). Populated from the live
  // DOM node so Spec-Check's matcher reads these directly without rederiving.
  // Falls back to the legacy `el.role` (data-ui-bridge-role attribute) when
  // the ARIA mapping returns nothing — keeps existing content-element
  // callers working while preferring the canonical W3C role.
  const ariaRole = computeRoleSafe(el.element) ?? el.role;
  // §4.6: these a11y projections re-derive content STRAIGHT from the raw DOM
  // (they do not read the already-scrubbed `state`), so they must scrub here
  // too or a `data-bridge-redact` subtree's secret ships on every snapshot.
  // CONTENT axis — a bare password keeps its label; a boundary redacts it.
  const serializeVerdict = verdictOf(el.element);
  const ariaLabel = scrubContentByVerdict(computeAriaLabel(el.element), serializeVerdict);
  const accessibleName = scrubContentByVerdict(
    computeAccessibleNameSafe(el.element),
    serializeVerdict
  );
  const visibleText = scrubContentByVerdict(computeVisibleText(el.element), serializeVerdict);
  // Snapshot-time bbox refresh — see `measureFreshBbox`. Falls back to the
  // tracker's cached value when there's no fresh signal.
  const freshBbox = measureFreshBbox(el.element);
  return {
    id: el.id,
    ...(uiBridgeId !== undefined ? { uiBridgeId } : {}),
    type: el.type,
    tagName: el.element.tagName.toLowerCase(),
    // §4.6: `el.label` is SCRAPED from the DOM on auto-registered elements
    // (`useAutoRegister.getAccessibleLabel`), so route it through the CONTENT
    // scrub keyed on this element's verdict — redacted inside a boundary,
    // passthrough (incl. a bare password field's label) outside one. F7 stops
    // the scrape at the source too; this is the defense-in-depth emission gate.
    label: scrubContentByVerdict(el.label, serializeVerdict),
    identifier: el.getIdentifier(),
    state: el.getState(),
    // Lifecycle fields — required by the canonical UIBridgeElement shape
    // consumed by qontinui-spec-check's strict parse.
    registeredAt: el.registeredAt,
    mounted: el.mounted,
    actions: el.actions,
    customActions: el.customActions ? Object.keys(el.customActions) : undefined,
    category: el.category,
    kind,
    // §4.6: `el.content` is scraped `textContent` on auto-registered content
    // elements — CONTENT-scrub it (redacted inside a boundary, passthrough out).
    content: scrubContentByVerdict(el.content, serializeVerdict),
    role: ariaRole,
    ariaLabel,
    accessibleName,
    text: visibleText,
    contentMetadata: el.contentMetadata,
    // §4.6: a media element inside a boundary can carry the rendered secret in
    // its src/srcset/altText/poster (a `data:` QR code, a token-bearing URL) —
    // scrub those, keep structural fields for oversize/lazy-load audits.
    mediaMetadata: scrubMediaMetadata(el.mediaMetadata, serializeVerdict),
    ownedByComponent: el.ownedByComponent,
    componentActionBasePath: el.ownedByComponent
      ? `${componentBasePath}/${el.ownedByComponent}`
      : undefined,
    // Bbox/visibility: re-measured from the live DOM at snapshot time when
    // possible (audits need *current* geometry — qontinui-runner#186), with
    // the tracker-maintained cache as fallback for detached/hidden elements.
    // Runners use this to dispatch clicks via DOM coords without VLM grounding.
    bbox: freshBbox?.bbox ?? el.bbox,
    visible: freshBbox?.visible ?? el.visible,
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
    // Window the element is registered under — undefined for default-window
    // elements (drops out of JSON, keeping single-window snapshots
    // byte-identical) and the real webview label for multi-window hosts.
    windowLabel: el.windowLabel,
    // Phase 3.2: ids/globs this control reveals. Echoed verbatim so clients
    // can answer "which control unhides element X" without grepping source.
    reveals: el.reveals,
  };
}

/**
 * Single source of truth for serializing a `RegisteredComponent` to a
 * snapshot entry — used by `createSnapshot`/`createSnapshotAsync` and the
 * relay's `getControlSnapshot` handler so the three paths cannot drift.
 *
 * `actions` is emitted as `{ id, label?, description? }` objects (the
 * canonical `ComponentActionInfo` shape) rather than bare id strings, and
 * `registeredAt`/`mounted` are included — both required by the canonical
 * `qontinui-types::ui_bridge::UIBridgeComponent` consumed by
 * qontinui-spec-check's strict parse.
 *
 * Phase 4 added `effect` to this projection — see the inline note at the map.
 * It is the one added field BOTH projections carry, because the snapshot is
 * the surface an autonomous walk reads.
 *
 * This projection drops the action's `handler` and `paramSchema`. Only the
 * `handler` drop generalizes: it is a function, so `JSON.stringify` would
 * strip it from any response. `paramSchema` is **not** runtime-only — the
 * `/control/components` and `/control/component/:id` handlers spread the whole
 * action and do emit it (`server/handlers.ts`
 * `annotateComponentWithInvocationPaths`; see `SerializedComponentAction`),
 * and qontinui-runner reads it off the wire. It is omitted *here* only to keep
 * the snapshot entry byte-identical to the canonical `UIBridgeComponent`. The
 * comment this replaces claimed `paramSchema` "never reaches the wire", which
 * was false.
 */
export function serializeRegisteredComponent(
  comp: RegisteredComponent,
  options: { componentBasePath?: string } = {}
): BridgeSnapshot['components'][number] {
  const componentBasePath = options.componentBasePath ?? '/control/component';
  return {
    id: comp.id,
    name: comp.name,
    description: comp.description,
    actions: comp.actions.map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      // Phase 4 (plan 2026-08-20-ui-bridge-action-declaration-shape): the
      // safety annotation IS projected here, unlike `paramSchema`. The
      // snapshot is what an autonomous walker reads, and excluding
      // destructive actions from an automatic walk is this annotation's only
      // job — omitting it here would make a `'destructive'` declaration
      // invisible on the surface that matters most, i.e. fail open.
      // `undefined` when nothing was declared, and `JSON.stringify` drops
      // undefined keys, so an un-annotated app's snapshot is byte-identical
      // to before.
      effect: a.effect,
    })),
    // Tell the caller exactly how to invoke any action on this component
    // without having to grep docs or guess the route shape.
    actionInvocationPath: `${componentBasePath}/${comp.id}/action/{actionId}`,
    elementIds: comp.elementIds,
    registeredAt: comp.registeredAt,
    mounted: comp.mounted,
    // Phase 3.1: discoverability scope. Pass through verbatim — undefined
    // is the documented default ("route").
    scope: comp.scope,
  };
}

/**
 * Capture `document.hidden` / `document.visibilityState` for the snapshot
 * meta block. Components that gate work on visibility (WS subscriptions,
 * polling loops, idle observers) silently no-op when hidden — surfacing
 * this here lets headless test runners detect the gating without an
 * extra round-trip. Returns undefined in non-DOM environments.
 */
export function captureDocumentVisibility():
  | { hidden: boolean; state: 'visible' | 'hidden' | 'prerender' | 'unloaded' }
  | undefined {
  if (typeof document === 'undefined') return undefined;
  const rawState = (document.visibilityState ?? 'visible') as
    | 'visible'
    | 'hidden'
    | 'prerender'
    | 'unloaded';
  return {
    hidden: document.hidden === true,
    state: rawState,
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
  const ariaLabel = readAriaLabelAttr(element);
  if (ariaLabel) return ariaLabel;

  const labelledBy = readAriaLabelledbyAttr(element);
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

  const title = readTitleAttr(element);
  if (title) return title;

  const rawText = element.textContent?.trim();
  if (rawText) {
    return truncateCodePoints(rawText, 80);
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

  // §4.6 redaction boundary — when this element (or an ancestor) carries
  // `data-bridge-redact="true"`, we must scrub not just `state.value` but
  // also the human-readable text fields (`accessibleName`, `textContent`,
  // option labels) so a label like "prod (token: xyz)" doesn't leak the
  // secret it describes. `<input type="password">` is redacted
  // unconditionally — every browser already treats password fields as
  // sensitive at the OS keystroke level, so making them snapshot-visible
  // would be a strictly weaker contract than the browser's own.
  //
  // Two-axis §4.6 verdict, computed once. CONTENT scrubs descriptive text
  // (`accessibleName`, `textContent`); VALUE scrubs the entered value
  // (`value`, option values/labels) AND is the stricter gate `dataset` rides.
  // The split keeps a bare `<input type="password">` addressable — its label
  // is content (kept) while its value is hidden — while a `data-bridge-redact`
  // boundary redacts both. Every field below is minted through the
  // `core/redaction` choke point, so an un-scrubbed DOM string cannot be
  // assigned into the now-branded `ElementState` fields (compile error).
  const verdict = verdictOf(element);

  const roleAttr = element.getAttribute('role') || undefined;
  const accessibleName = scrubContentByVerdict(computeAccessibleName(element), verdict);

  // The two independent disabled signals, unfolded once (`enabled` below is
  // the derived fold). Same helper in every serializer — see `core/a11y`.
  const disabledSignals = readDisabledSignals(element);

  const state: ElementState = {
    visible: isElementVisible(element, rect, computedStyle, inViewport),
    enabled: !(disabledSignals.disabled || disabledSignals.ariaDisabled),
    disabled: disabledSignals.disabled,
    ariaDisabled: disabledSignals.ariaDisabled,
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
    textContent: scrubContentByVerdict(element.textContent?.trim() || undefined, verdict),
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

  // §4.6 provenance — stamp the redaction verdict as DATA so DOM-less wire
  // arms (`DiscoveredElement`, which carries no element ref) can recover it via
  // `verdictFromState` instead of sniffing the forgeable `REDACTED_VALUE`
  // sentinel. Behaviour-neutral: an optional field consumers that don't know it
  // simply ignore; omitted entirely when neither axis applies.
  const redaction = elementRedaction(element);
  if (redaction) state.redaction = redaction;

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

  // Fallback for icon-only elements (no textContent but has aria-label/title).
  // §4.6: this fallback re-reads RAW aria-label/title, so inside a boundary it
  // would RESURRECT the secret the boundary hides — route it through the
  // content scrub too.
  if (!state.textContent) {
    state.textContent = scrubContentByVerdict(
      readAriaLabelAttr(element) || readTitleAttr(element) || undefined,
      verdict
    );
  }

  // Opacity hidden detection
  const opacityVal = parseFloat(computedStyle.opacity);
  if (opacityVal === 0) {
    state.opacityHidden = true;
  }

  // All data-* attributes, keyed camelCase per `HTMLElement.dataset`
  // (data-claude-session-id → claudeSessionId), EXCLUDING the bridge's own
  // control attributes (any data-bridge-*). Lets agents read semantic
  // markers (session ids, content labels, routes) without scraping the DOM
  // via page/evaluate. Omitted entirely inside a §4.6 redaction boundary —
  // data-* values on redacted subtrees can carry the very secrets the
  // boundary protects — and when no qualifying attribute exists. Subsumes
  // the former ad-hoc dataContentLabel / dataContentRole / dataRoute
  // projections (now dataset.contentLabel / contentRole / route).
  if (!verdict.value && element.dataset) {
    const dataset: Record<string, string> = {};
    for (const key of Object.keys(element.dataset)) {
      // camelCase form of data-bridge-*: "bridge" or a "bridge" prefix
      // followed by an uppercase letter (bridgeRedact, bridgeInvisible, …).
      if (key === 'bridge' || /^bridge[A-Z]/.test(key)) continue;
      const value = element.dataset[key];
      if (value !== undefined) dataset[key] = value;
    }
    if (Object.keys(dataset).length > 0) {
      state.dataset = dataset;
    }
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

  // Add input-specific state. VALUE axis (`verdict.value`) governs the entered
  // value + select option values/labels; each is minted through the choke
  // point so an un-scrubbed value cannot reach the branded field.
  if (element instanceof HTMLInputElement) {
    state.value = scrubValueByVerdict(element.value, verdict);
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    }
    captureFormControlState(element, state);
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = scrubValueByVerdict(element.value, verdict);
    captureFormControlState(element, state);
  } else if (element instanceof HTMLSelectElement) {
    // §4.6: single shared option-list scrub — the COUNT-collapse-when-redacted
    // decision lives in `scrubSelectState` so all three builders cannot diverge.
    const sel = scrubSelectState(element, verdict);
    state.value = sel.value;
    state.selectedOptions = sel.selectedOptions;
    state.availableOptions = sel.availableOptions;
    captureFormControlState(element, state);
  }

  // Capture href for anchor elements
  if (element instanceof HTMLAnchorElement && element.href) {
    state.href = element.href;
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
 * Infer available actions based on element type
 */
function inferActions(type: ElementType): StandardAction[] {
  const baseActions: StandardAction[] = ['focus', 'blur', 'hover', 'scroll', 'scrollIntoView'];

  // `hoverClick` rides alongside `click` on every clickable type: a control
  // hidden behind a `group-hover:pointer-events-auto` rule (e.g. the runner's
  // `ZoneHoverActions` toolbar) becomes drivable in a single dispatch instead
  // of via a page/evaluate `.click()` workaround.
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
    case 'form':
      return ['focus', 'blur'];
    case 'menu':
    case 'menuitem':
      return [...baseActions, 'click', 'hoverClick'];
    case 'tab':
      return [...baseActions, 'click', 'hoverClick', 'middleClick'];
    case 'dialog':
      return ['focus', 'blur'];
    case 'custom':
    default:
      return [...baseActions, 'click', 'hoverClick'];
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
  /**
   * Stable per-instance tag assigned at construction time. Used by
   * UI_BRIDGE_DEBUG_FIND diagnostics to detect duplicate registry instances
   * across the React-context path (`bridge.registry`) and the module-level
   * singleton path (`getGlobalRegistry()`). The runner has historically
   * shown a 193-vs-118 element divergence between the two paths; the tag
   * lets a single diagnostic run answer "is this the same registry or two
   * different ones?" empirically without re-deploying instrumentation.
   *
   * Six chars of base-36 entropy — collision-safe within a single page
   * lifetime (~2 billion possible values, dozens of registries at most).
   * Public so external diagnostic tools can read it via reflection without
   * needing a getter call.
   */
  public readonly __instanceTag: string;

  /**
   * Default window label. Single-window hosts (web, mobile, the runner's
   * main window) and any caller that omits `windowLabel` register under this
   * bucket, so every merged accessor returns the exact pre-window-aware
   * result. See plan `2026-06-03-runner-popout-terminal-windows.md` Phase 0.
   */
  private static readonly DEFAULT_WINDOW_LABEL = 'main';

  // Element store partitioned by window label: windowLabel -> (id -> element).
  // A single-window host only ever populates the `"main"` bucket, so the
  // merged accessors below (allElements / elementCount / findElement) behave
  // byte-identically to the old flat `Map<id, element>`. Two windows can
  // register the SAME id without collision because each has its own inner Map.
  private elementsByWindow = new Map<string, Map<string, RegisteredElement>>();
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

  // Per-window, per-route element-id sets: windowLabel -> route -> Set<id>.
  // Single source of truth for BOTH the merged `byRoute` view (union across
  // windows — unchanged top-level semantics) AND the per-window
  // `byRoutePerWindow` view. Within a window `count === ids.size` always
  // holds. Elements registered without a route (non-DOM environment) are
  // tracked under the empty-string key `""`, which serialization filters out.
  // Drop-on-empty semantics keep a route/window with no live elements from
  // lingering. Replaces the pre-window-aware flat `routeCounts`/`routeIds`.
  private routeIdsByWindow = new Map<string, Map<string, Set<string>>>();

  // External store pattern for useSyncExternalStore
  private storeVersion = 0;
  private storeListeners = new Set<() => void>();
  private cachedSnapshot: RegistrySnapshot | null = null;
  private notifyScheduled = false;

  // ── Snapshot enricher slots ───────────────────────────────────────────────
  // Canonical enrichers wire the seven first-party trackers (navigation, modal,
  // toast, relationships, drag-drop, undo, shortcuts) into createSnapshot{,Async}
  // so any caller of those methods gets enriched output without manual glue.
  // `snapshotExtras` is the open-ended escape hatch for ad-hoc trackers (e.g.
  // a runner sidebar tab map) that aren't worth promoting into the canonical
  // set yet.
  private enrichers: SnapshotEnrichers = {};
  private snapshotExtras = new Map<string, SnapshotEnricher>();

  constructor(options: RegistryOptions = {}) {
    this.options = options;
    this.__instanceTag = Math.random().toString(36).slice(2, 8);
  }

  /**
   * Public accessor for the instance tag — equivalent to reading
   * `__instanceTag` directly, but kept as a method so external diagnostic
   * code (which sees the type from `dist/`) can call it without TypeScript
   * complaining about touching internal fields.
   */
  getInstanceTag(): string {
    return this.__instanceTag;
  }

  // ============================================================================
  // Snapshot Enricher Slots
  // ============================================================================

  /**
   * Register/replace canonical enrichers (navigation/modal/toast/relationships/
   * drag-drop/undo/shortcuts). HMR-safe — calling with a partial set merges into
   * existing slots instead of clobbering them, so a remount that re-runs init
   * for one tracker doesn't drop the others.
   */
  setEnrichers(e: Partial<SnapshotEnrichers>): void {
    this.enrichers = { ...this.enrichers, ...e };
  }

  /**
   * Register a custom snapshot enricher. The returned object will be
   * `Object.assign`ed onto the snapshot, so use unique top-level keys to avoid
   * clobbering canonical fields. Returns a disposer.
   */
  registerSnapshotEnricher(name: string, fn: SnapshotEnricher): () => void {
    this.snapshotExtras.set(name, fn);
    return () => this.unregisterSnapshotEnricher(name);
  }

  /** Remove a custom snapshot enricher by name */
  unregisterSnapshotEnricher(name: string): void {
    this.snapshotExtras.delete(name);
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
        elements: this.allElements(),
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
  // ── Windowed element store helpers ─────────────────────────────────────────
  // These keep the multi-window store transparent to every existing accessor:
  // a single-window registry has exactly one ("main") bucket, so each merged
  // helper returns the same result the old flat `Map<id, element>` did.

  /** Get (creating if absent) the element bucket for a window label. */
  private windowBucket(label: string): Map<string, RegisteredElement> {
    let bucket = this.elementsByWindow.get(label);
    if (!bucket) {
      bucket = new Map();
      this.elementsByWindow.set(label, bucket);
    }
    return bucket;
  }

  /** All registered elements across every window (merged union). */
  private allElements(): RegisteredElement[] {
    // Fast path: the single-window common case allocates exactly like the
    // pre-window-aware code (one `Array.from` over the sole bucket).
    if (this.elementsByWindow.size === 1) {
      const only = this.elementsByWindow.values().next().value;
      return only ? Array.from(only.values()) : [];
    }
    const out: RegisteredElement[] = [];
    for (const bucket of this.elementsByWindow.values()) {
      for (const el of bucket.values()) out.push(el);
    }
    return out;
  }

  /** Total registered element count across all windows. */
  private elementCount(): number {
    let n = 0;
    for (const bucket of this.elementsByWindow.values()) n += bucket.size;
    return n;
  }

  /**
   * Look up an element by id. When `windowLabel` is given the lookup is scoped
   * to that window; otherwise the default ("main") window is resolved first so
   * single-window behavior is identical, falling back to other windows only
   * when the id isn't in the default bucket. Multi-window hosts pass an
   * explicit `windowLabel` to avoid the cross-window ambiguity entirely.
   */
  private findElement(id: string, windowLabel?: string): RegisteredElement | undefined {
    if (windowLabel !== undefined) {
      return this.elementsByWindow.get(windowLabel)?.get(id);
    }
    const def = this.elementsByWindow.get(UIBridgeRegistry.DEFAULT_WINDOW_LABEL);
    const hit = def?.get(id);
    if (hit) return hit;
    for (const [label, bucket] of this.elementsByWindow) {
      if (label === UIBridgeRegistry.DEFAULT_WINDOW_LABEL) continue;
      const e = bucket.get(id);
      if (e) return e;
    }
    return undefined;
  }

  /**
   * True when any element is registered under a non-default window. Gates the
   * optional `byRoutePerWindow` snapshot field so single-window hosts keep
   * emitting the byte-identical pre-window-aware registration shape.
   */
  private hasNonDefaultWindow(): boolean {
    for (const [label, bucket] of this.elementsByWindow) {
      if (label !== UIBridgeRegistry.DEFAULT_WINDOW_LABEL && bucket.size > 0) return true;
    }
    return false;
  }

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
      /** Phase 3.2: ids/globs this control reveals. See RegisteredElement.reveals. */
      reveals?: string[];
    }
  ): boolean {
    const existing = this.findElement(id);
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
    if (options.reveals !== undefined) existing.reveals = options.reveals;
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
    const existing = this.findElement(id);
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
    const existing = this.findElement(id) as
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
      /**
       * Phase 3.2 (plan 2026-05-03) — ids or `*`-globs this control unhides.
       * Used by `GET /control/elements?revealsAny=<id-or-glob>`. See
       * `RegisteredElement.reveals`.
       */
      reveals?: string[];
      /**
       * Window this element belongs to (multi-window hosts only). Defaults to
       * `"main"`. A non-default label is the real Tauri webview label
       * (`getCurrentWindow().label`) and isolates this element's bucket so two
       * windows can register the same id without collision. Omit (or pass
       * `"main"`) for single-window hosts — the registry then stores the
       * element with `RegisteredElement.windowLabel` left undefined and the
       * snapshot stays byte-identical to the pre-window-aware shape.
       */
      windowLabel?: string;
    } = {}
  ): RegisteredElement {
    const type = options.type ?? inferElementType(element);
    const actions = options.actions ?? inferActions(type);

    // Resolve the owning window. Default ("main") elements leave the
    // serialized `windowLabel` undefined so single-window snapshots are
    // byte-identical; non-default elements carry the real webview label.
    const windowLabel = options.windowLabel ?? UIBridgeRegistry.DEFAULT_WINDOW_LABEL;

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
      // Undefined for default-window elements (keeps single-window snapshots
      // byte-identical); the real webview label for multi-window hosts.
      windowLabel:
        windowLabel === UIBridgeRegistry.DEFAULT_WINDOW_LABEL ? undefined : windowLabel,
      // Content/role fields for data-ui-bridge-content semantic elements.
      // Undefined for interactive elements and for content registered via
      // the heading/paragraph/table-cell content-discovery path.
      content: options.content,
      role: options.role,
      // Phase 3.2 — ids/globs this control reveals. Undefined for elements
      // that don't gate any visibility (the common case).
      reveals: options.reveals,
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

    // If this id is already registered IN THE SAME WINDOW, reverse the
    // previous entry's route bookkeeping so we don't double-count an
    // overwrite. The same id in a different window is a distinct entry.
    const bucket = this.windowBucket(windowLabel);
    const prior = bucket.get(actualId);
    if (prior) {
      this.decrementRouteCount(windowLabel, prior.route, actualId);
    }
    bucket.set(actualId, registered);
    // F3: sticky latch + per-window/per-route tally
    this.everHadRegistrationsFlag = true;
    this.incrementRouteCount(windowLabel, route, actualId);
    this.emit('element:registered', { id: actualId, type, label: options.label });

    return registered;
  }

  private incrementRouteCount(windowLabel: string, route: string | undefined, id: string): void {
    // Use `""` as the key for undefined-route elements so the inner map stays
    // typed as `Map<string, Set<string>>`; snapshot serialization filters
    // this bucket out. Per-window `count` is derived as the set's size.
    const key = route ?? '';
    let byRoute = this.routeIdsByWindow.get(windowLabel);
    if (!byRoute) {
      byRoute = new Map();
      this.routeIdsByWindow.set(windowLabel, byRoute);
    }
    let ids = byRoute.get(key);
    if (!ids) {
      ids = new Set();
      byRoute.set(key, ids);
    }
    ids.add(id);
  }

  private decrementRouteCount(windowLabel: string, route: string | undefined, id: string): void {
    const key = route ?? '';
    const byRoute = this.routeIdsByWindow.get(windowLabel);
    if (!byRoute) return;
    const ids = byRoute.get(key);
    if (ids) {
      ids.delete(id);
      if (ids.size === 0) {
        byRoute.delete(key);
      }
    }
    // Drop an empty window so it doesn't linger in `byRoutePerWindow`.
    if (byRoute.size === 0) {
      this.routeIdsByWindow.delete(windowLabel);
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
      /**
       * Full normalized text content (whitespace-collapsed, trimmed). Surfaced
       * verbatim on the snapshot element's `content` field. Populated by the
       * heading/paragraph/table-cell auto-register path so consumers can
       * recover the full text without relying on the 50-char `label` truncation
       * (B1 — manual-test remediation 2026-05-10).
       */
      content?: string;
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
      content: options.content,
      origin: options.origin ?? 'auto',
    });
  }

  /**
   * Get all content (non-interactive) elements
   */
  getAllContentElements(): RegisteredElement[] {
    return this.allElements().filter((el) => el.category === 'content');
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
    return this.allElements().filter(
      (el) => el.category !== 'content' && el.category !== 'media'
    );
  }

  /**
   * Get all media elements
   */
  getAllMediaElements(): RegisteredElement[] {
    return this.allElements().filter((el) => el.category === 'media');
  }

  /**
   * Unregister an element.
   *
   * `windowLabel` scopes the removal to one window; when omitted the default
   * ("main") window is resolved first, falling back to whichever window holds
   * the id (so single-window callers — `useUIElement`'s cleanup — behave
   * exactly as before).
   */
  unregisterElement(id: string, windowLabel?: string): boolean {
    // Resolve which window's bucket owns this id.
    let ownerLabel: string | undefined;
    let bucket: Map<string, RegisteredElement> | undefined;
    if (windowLabel !== undefined) {
      bucket = this.elementsByWindow.get(windowLabel);
      if (bucket?.has(id)) ownerLabel = windowLabel;
    } else {
      const def = this.elementsByWindow.get(UIBridgeRegistry.DEFAULT_WINDOW_LABEL);
      if (def?.has(id)) {
        ownerLabel = UIBridgeRegistry.DEFAULT_WINDOW_LABEL;
        bucket = def;
      } else {
        for (const [label, b] of this.elementsByWindow) {
          if (b.has(id)) {
            ownerLabel = label;
            bucket = b;
            break;
          }
        }
      }
    }
    const registered = ownerLabel !== undefined ? bucket?.get(id) : undefined;
    if (registered && ownerLabel !== undefined && bucket) {
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
      bucket.delete(id);
      // F3: drop this element from the per-window/per-route tally. Note we do
      // NOT clear `everHadRegistrationsFlag` — it's a one-way latch that stays
      // true for the rest of the registry's lifetime so callers can tell
      // "had coverage, all unmounted" from "never had coverage".
      this.decrementRouteCount(ownerLabel, registered.route, id);
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
    return this.findElement(id);
  }

  /**
   * Get all registered elements
   */
  getAllElements(): RegisteredElement[] {
    return this.allElements();
  }

  /**
   * Find element by DOM element reference
   */
  findByDOMElement(element: HTMLElement): RegisteredElement | undefined {
    for (const registered of this.allElements()) {
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

    for (const element of this.allElements()) {
      if (!element.mounted) continue;

      const state = element.getState();

      // Skip hidden elements if not explicitly requested
      if (!criteria.fuzzy && !state.visible) continue;

      // §4.6 — this PUBLIC projection matches AND emits DOM-derived content, so
      // gate both. CONTENT axis. `state.textContent` is already scrubbed by
      // `getElementState`; the alias/aria-label inputs are gated here so a
      // redacted element cannot be CONFIRMED by searching its secret (oracle)
      // nor have its secret EMITTED. Developer-SET `element.aliases`/`.label`
      // survive as the documented boundary.
      const redactionVerdict = verdictOf(element.element);
      // §4.6 by-construction alias gate: the GENERATED (DOM-derived) portion
      // routes through the `scrubAliases` minter (→ `[]` when content-redacted,
      // else branded), replacing the open-coded `content ? [] : generate`
      // ternary that had no compile tripwire. Developer-SET `element.aliases`
      // are the documented boundary exemption and survive.
      const aliases: string[] =
        element.aliases ?? scrubAliases(this.generateElementAliases(element), redactionVerdict);
      const textContent = state.textContent?.trim() || '';
      // §4.6 matching-ORACLE closure: `element.label` is DOM-scraped on
      // auto-registered elements, so scoring the raw label lets a client
      // confirm a redacted element's secret by hit-count. Skip label-matching
      // entirely when content-redacted (empty string never matches / fuzzes).
      const label = redactionVerdict.content ? '' : element.label || '';

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
        // §4.6 oracle closure: scrub the DOM aria-label used for MATCHING so a
        // client cannot confirm the secret name by guessing it. Dev `label`
        // and already-scrubbed `textContent` are safe.
        const ariaLabel =
          scrubContentByVerdict(readAriaLabelAttr(element.element) || undefined, redactionVerdict) || '';
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
        // §4.6 EMISSION gating. Per the resolved design decision, `label`
        // scrubs on the CONTENT axis regardless of dev-set-vs-scraped origin
        // (one `label` field cannot discriminate, and a dev who wraps a subtree
        // intends it hidden) — so a content-redacted element's label collapses
        // to the sentinel while a bare password field's survives. `description`
        // is derived from already-gated inputs then routed through the required
        // content scrub.
        const domAriaLabel = readAriaLabelAttr(element.element) || undefined;
        const emittedAccessibleName = domAriaLabel
          ? scrubContentByVerdict(domAriaLabel, redactionVerdict)
          : scrubContentByVerdict(element.label, redactionVerdict);
        const descriptionText =
          element.description ||
          generateDescription({
            textContent,
            ariaLabel: redactionVerdict.content ? undefined : domAriaLabel,
            elementType: element.type,
            id: element.id,
            labelText: element.label,
          });
        const aiElement: AIDiscoveredElement = {
          id: element.id,
          type: element.type,
          label: scrubContentByVerdict(element.label, redactionVerdict),
          tagName: element.element.tagName.toLowerCase(),
          role: element.element.getAttribute('role') || undefined,
          accessibleName: emittedAccessibleName,
          actions: element.actions,
          state,
          registered: true,
          // `element.description` is developer-SET (never DOM-scraped) — the
          // documented boundary exemption, so `trustDeveloperContent` is correct.
          description: element.description
            ? trustDeveloperContent(element.description) ?? scrubContentRequired('', redactionVerdict)
            : scrubContentRequired(descriptionText, redactionVerdict),
          // `aliases` is EITHER dev-set (trusted) OR already gated through
          // `scrubAliases` above (→ `[]` when content-redacted). Brand each for
          // the wire slot; the generated tripwire lives in the local above.
          aliases: aliases.map((a) => trustDeveloperContent(a)),
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
      return this.findElement(results[0].element.id);
    }
    return undefined;
  }

  /**
   * Find element by accessible name
   */
  findByAccessibleName(name: string): RegisteredElement | undefined {
    const results = this.searchElements({ accessibleName: name, fuzzy: true });
    if (results.length > 0) {
      return this.findElement(results[0].element.id);
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
      ariaLabel: readAriaLabelAttr(element.element),
      placeholder: readPlaceholderAttr(element.element),
      title: readTitleAttr(element.element),
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
      disclosure: 'group',
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
        /**
         * Phase 4 (same plan): the safety annotation, overriding the static
         * `STANDARD_ACTION_EFFECTS` verb map. Structural for the same reason
         * `handler` is — this signature inlines the action shape rather than
         * importing `ComponentAction`.
         */
        effect?: IREffect;
        /**
         * Phase 3 (plan 2026-08-20-ui-bridge-action-declaration-shape): the
         * second argument is the `ActionHandlerOptions` bag carrying the
         * cancellation signal. Kept structural (not `ActionHandler`) to match
         * the pre-existing shape of this inlined signature; a 1-arity handler
         * stays assignable.
         */
        handler: (
          params?: unknown,
          options?: { signal?: AbortSignal }
        ) => unknown | Promise<unknown>;
      }>;
      elementIds?: string[];
      getState?: StateGetter<Record<string, unknown>>;
      getComputed?: () => Record<string, unknown>;
      /** Phase 3.1: discoverability scope. See RegisteredComponent.scope. */
      scope?: 'global' | 'route';
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
        // ⚠ CLOSED FIELD LIST. Any field added to `ComponentAction` and not
        // listed here is dropped at registration time, silently: the literal
        // stays assignable, the serializer still runs, the field is simply
        // never there. Phase 3 added no field (it changed `handler`'s arity,
        // and `handler` is already copied); Phase 4's `effect` is the next one
        // and is carried below. Prove additions by round-trip, not typecheck.
        effect: a.effect,
        handler: a.handler,
      }));
    }
    if (options.elementIds !== undefined) existing.elementIds = options.elementIds;
    if (options.getState !== undefined) existing.getState = options.getState;
    if (options.getComputed !== undefined) existing.getComputed = options.getComputed;
    if (options.scope !== undefined) existing.scope = options.scope;
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
        /**
         * Phase 4 (same plan): the safety annotation, overriding the static
         * `STANDARD_ACTION_EFFECTS` verb map. Structural for the same reason
         * `handler` is — this signature inlines the action shape rather than
         * importing `ComponentAction`.
         */
        effect?: IREffect;
        /**
         * Phase 3 (plan 2026-08-20-ui-bridge-action-declaration-shape): the
         * second argument is the `ActionHandlerOptions` bag carrying the
         * cancellation signal. Kept structural (not `ActionHandler`) to match
         * the pre-existing shape of this inlined signature; a 1-arity handler
         * stays assignable.
         */
        handler: (
          params?: unknown,
          options?: { signal?: AbortSignal }
        ) => unknown | Promise<unknown>;
      }>;
      elementIds?: string[];
      getState?: StateGetter<Record<string, unknown>>;
      getComputed?: () => Record<string, unknown>;
      /**
       * Phase 3.1 discoverability scope (plan 2026-05-03). Default behavior
       * is `'route'` (treated as undefined here — component shows up only
       * while its mounting page is active). Pass `'global'` to advertise
       * intended cross-route availability.
       */
      scope?: 'global' | 'route';
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
          // ⚠ CLOSED FIELD LIST — see the note on `updateComponent`'s twin
          // above. A new `ComponentAction` field must be added here too or it
          // never reaches `RegisteredComponent`.
          effect: a.effect,
          handler: a.handler,
        })) ?? [],
      elementIds: options.elementIds,
      registeredAt: Date.now(),
      mounted: true,
      getState: options.getState,
      getComputed: options.getComputed,
      scope: options.scope,
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
   * Per-route counts of currently-registered elements, plus the ids that
   * make up each count. Returns a plain object copy so callers can't mutate
   * internal state. Elements with an undefined route are omitted. Exposed
   * primarily for tests; production code should read
   * `BridgeSnapshot.registration.byRoute`.
   *
   * Each value is `{ count: number; ids: string[] }`. The `count` field
   * mirrors the prior `Record<string, number>` shape (kept verbatim so
   * existing readers like the cross-route 404 hint can detect coverage),
   * and `ids` enumerates the element ids registered on that route at
   * snapshot time. Phase 1.2 — see plan dated 2026-05-03.
   */
  getCountsByRoute(): Record<string, { count: number; ids: string[] }> {
    // Merge across windows: `count` is the SUM of per-window counts, `ids` is
    // their UNION. For a single (default) window this is byte-identical to the
    // pre-window-aware output — one bucket, count === ids.length, same
    // route-insertion and id-insertion order. With multiple windows the same
    // id can appear in two windows, so `count` may exceed `ids.length`.
    const counts = new Map<string, number>();
    const idsByRoute = new Map<string, Set<string>>();
    for (const byRoute of this.routeIdsByWindow.values()) {
      for (const [route, idSet] of byRoute) {
        // Empty-string key = undefined-route bucket — exclude from the
        // user-visible map so it never shows up as `"": { ... }`.
        if (route === '') continue;
        counts.set(route, (counts.get(route) ?? 0) + idSet.size);
        let merged = idsByRoute.get(route);
        if (!merged) {
          merged = new Set();
          idsByRoute.set(route, merged);
        }
        for (const id of idSet) merged.add(id);
      }
    }
    const out: Record<string, { count: number; ids: string[] }> = {};
    for (const [route, count] of counts) {
      if (count > 0) {
        out[route] = { count, ids: Array.from(idsByRoute.get(route) ?? []) };
      }
    }
    return out;
  }

  /**
   * Per-window breakdown of {@link getCountsByRoute}, keyed first by
   * `windowLabel` then by route. Within each window `count === ids.length`.
   * The empty-string (undefined-route) bucket and any window with no routed
   * elements are omitted. Backs `BridgeSnapshot.registration.byRoutePerWindow`.
   */
  getCountsByRoutePerWindow(): Record<string, Record<string, { count: number; ids: string[] }>> {
    const out: Record<string, Record<string, { count: number; ids: string[] }>> = {};
    for (const [windowLabel, byRoute] of this.routeIdsByWindow) {
      const routes: Record<string, { count: number; ids: string[] }> = {};
      for (const [route, idSet] of byRoute) {
        if (route === '') continue;
        if (idSet.size > 0) {
          routes[route] = { count: idSet.size, ids: Array.from(idSet) };
        }
      }
      if (Object.keys(routes).length > 0) out[windowLabel] = routes;
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
    byRoute: Record<string, { count: number; ids: string[] }>;
    byRoutePerWindow?: Record<string, Record<string, { count: number; ids: string[] }>>;
  } {
    const meta: {
      totalRegistered: number;
      everHadRegistrations: boolean;
      byRoute: Record<string, { count: number; ids: string[] }>;
      byRoutePerWindow?: Record<string, Record<string, { count: number; ids: string[] }>>;
    } = {
      totalRegistered: this.elementCount(),
      everHadRegistrations: this.everHadRegistrationsFlag,
      byRoute: this.getCountsByRoute(),
    };
    // Only attach the per-window breakdown when a non-default window is in
    // play, so single-window hosts keep emitting the byte-identical
    // pre-window-aware registration shape (no extra key).
    if (this.hasNonDefaultWindow()) {
      meta.byRoutePerWindow = this.getCountsByRoutePerWindow();
    }
    return meta;
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
   * Run every registered snapshot enricher (canonical + pluggable extras) and
   * mutate `snapshot` in place with their output. Each call is wrapped in its
   * own try/catch so a misbehaving tracker can never break the rest of the
   * snapshot. Shared by `createSnapshot` and `createSnapshotAsync` so both
   * paths emit identically-enriched output.
   *
   * Also exposed as the public {@link runSnapshotEnrichers} entry point for
   * callers that build a snapshot shape outside `createSnapshot{,Async}` (e.g.
   * the relay/WS dispatcher in `commandHandlers.getControlSnapshot`, which
   * keeps a richer workflow + component shape but still wants the seven
   * canonical fields). Routing both shapes through this single helper keeps
   * the snapshot-two-channel-drift class structurally impossible — see
   * memory note `proj_issue_snapshot_two_channel_drift.md`.
   */
  runSnapshotEnrichers(
    snapshot: BridgeSnapshot,
    options: { getActiveTab?: () => string | null | undefined } = {}
  ): void {
    this.runEnrichers(snapshot, options);
  }

  private runEnrichers(
    snapshot: BridgeSnapshot,
    options: { getActiveTab?: () => string | null | undefined } = {}
  ): void {
    // Canonical enrichers — each in its own try/catch so a misbehaving tracker
    // can never break the rest of the snapshot.
    if (this.enrichers.navigationTracker) {
      try {
        snapshot.page = this.enrichers.navigationTracker.getSnapshotPageContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] page enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.modalDetector) {
      try {
        snapshot.modalStack = this.enrichers.modalDetector.getSnapshotModalContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] modalStack enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.toastCapture) {
      try {
        snapshot.toasts = this.enrichers.toastCapture.getSnapshotToastContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] toasts enricher threw:`, error);
        }
      }
    }
    // Element pairs are needed by relationships + drag-drop trackers (web-only
    // pattern — they walk the DOM rooted at registered nodes). Build them lazily
    // so registries with neither enricher pay nothing.
    let elementPairs: Array<{ id: string; element: Element }> | null = null;
    const getElementPairs = (): Array<{ id: string; element: Element }> => {
      if (elementPairs === null) {
        elementPairs = this.getAllElements().map((e) => ({ id: e.id, element: e.element }));
      }
      return elementPairs;
    };
    if (this.enrichers.relationshipTracker) {
      try {
        snapshot.relationships =
          this.enrichers.relationshipTracker.getSnapshotRelationshipContext(getElementPairs());
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] relationships enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.dragDropDetector) {
      try {
        snapshot.dragDrop =
          this.enrichers.dragDropDetector.getSnapshotDragDropContext(getElementPairs());
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] dragDrop enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.undoTracker) {
      try {
        snapshot.undoRedo = this.enrichers.undoTracker.getSnapshotUndoContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] undoRedo enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.shortcutTracker) {
      try {
        snapshot.shortcuts = this.enrichers.shortcutTracker.getSnapshotShortcutContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] shortcuts enricher threw:`, error);
        }
      }
    }

    // Custom enrichers — keys assign-merged onto the snapshot.
    if (this.snapshotExtras.size > 0) {
      const ctx = {
        elements: getElementPairs(),
        getActiveTab: options.getActiveTab,
        snapshotSoFar: snapshot,
      };
      for (const [name, fn] of this.snapshotExtras) {
        try {
          const extra = fn(ctx);
          if (extra && typeof extra === 'object') {
            Object.assign(snapshot, extra);
          }
        } catch (error) {
          if (this.options.verbose) {
            console.warn(`[ui-bridge] snapshot enricher "${name}" threw:`, error);
          }
        }
      }
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
      /**
       * The focused window's label for multi-window hosts. ADDITIVE — when
       * provided it is emitted as `BridgeSnapshot.activeWindowLabel`; omitted
       * entirely otherwise so single-window snapshots stay byte-identical.
       */
      activeWindowLabel?: string;
    } = {}
  ): BridgeSnapshot {
    const takenAt = Date.now();
    const activeTab = this.resolveActiveTab(options.getActiveTab);
    const visibility = captureDocumentVisibility();
    const snapshot: BridgeSnapshot = {
      timestamp: takenAt,
      snapshotTakenAtMs: takenAt,
      route: this.currentRoute(),
      ...(activeTab !== undefined ? { activeTab } : {}),
      ...(options.activeWindowLabel !== undefined
        ? { activeWindowLabel: options.activeWindowLabel }
        : {}),
      ...(visibility !== undefined ? { visibility } : {}),
      registration: this.buildRegistrationMetadata(),
      elements: this.getAllElements().map((el) => serializeRegisteredElement(el, options)),
      components: this.getAllComponents().map((comp) =>
        serializeRegisteredComponent(comp, options)
      ),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length,
      })),
    };
    this.runEnrichers(snapshot, { getActiveTab: options.getActiveTab });
    return snapshot;
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
      /**
       * The focused window's label for multi-window hosts. ADDITIVE — see
       * {@link createSnapshot}. Omitted entirely when not provided.
       */
      activeWindowLabel?: string;
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
    const visibility = captureDocumentVisibility();
    const snapshot: BridgeSnapshot = {
      timestamp: takenAt,
      snapshotTakenAtMs: takenAt,
      route: this.currentRoute(),
      ...(activeTab !== undefined ? { activeTab } : {}),
      ...(options.activeWindowLabel !== undefined
        ? { activeWindowLabel: options.activeWindowLabel }
        : {}),
      ...(visibility !== undefined ? { visibility } : {}),
      registration: this.buildRegistrationMetadata(),
      elements: elementSnapshots,
      components: this.getAllComponents().map((comp) =>
        serializeRegisteredComponent(comp, options)
      ),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length,
      })),
    };
    this.runEnrichers(snapshot, { getActiveTab: options.getActiveTab });
    return snapshot;
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.elementsByWindow.clear();
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
    this.routeIdsByWindow.clear();
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
 * Default global registry instance.
 *
 * ── Why this lives on `globalThis` instead of module scope ────────────────
 *
 * The SDK is published with multiple subpath exports (./, ./core, ./react,
 * ./ai, …) and each subpath is bundled independently by tsup. A consumer
 * that imports `getGlobalRegistry` from `@qontinui/ui-bridge` (root) loads
 * `dist/index.mjs`; an import from `@qontinui/ui-bridge/core` loads
 * `dist/core/index.mjs`; and so on. Each bundle *physically duplicates* the
 * registry module's source — including any `let globalRegistry = null`
 * declaration. With a module-scope binding, every bundle would have its
 * own private slot and `setGlobalRegistry` calls in one bundle would be
 * invisible to `getGlobalRegistry` callers in another. That is exactly the
 * 193-vs-118 element divergence reported between `/control/snapshot` (which
 * iterates the React-context registry) and `/ui-bridge/ai/find` (which
 * reads the global singleton): the runner pulls `useBuildIdWatcher` from
 * `@qontinui/ui-bridge/react` and other code from the root entry, so two
 * different `globalRegistry` slots ended up in flight.
 *
 * Storing the slot on a Symbol-keyed `globalThis` property fixes this:
 * every bundle's `getGlobalRegistry`/`setGlobalRegistry` reads and writes
 * the same global property, no matter how many SDK-bundle copies are loaded.
 * Symbol.for('@qontinui/ui-bridge/registry') is intentionally cross-realm
 * stable so even when two copies of the registry source are bundled into
 * separate vite chunks, they coordinate through the well-known symbol key.
 */
const REGISTRY_KEY = Symbol.for('@qontinui/ui-bridge/globalRegistry');

interface GlobalRegistrySlot {
  [REGISTRY_KEY]?: UIBridgeRegistry | null;
}

function getRegistrySlot(): GlobalRegistrySlot {
  return globalThis as GlobalRegistrySlot;
}

/**
 * Get or create the global registry.
 *
 * Reads from the cross-bundle `globalThis[Symbol.for(...)]` slot so every
 * SDK bundle shares one live instance, then lazily creates one if no
 * provider has yet called `setGlobalRegistry`.
 */
export function getGlobalRegistry(): UIBridgeRegistry {
  const slot = getRegistrySlot();
  let current = slot[REGISTRY_KEY] ?? null;
  if (!current) {
    current = new UIBridgeRegistry();
    slot[REGISTRY_KEY] = current;
  }
  return current;
}

/**
 * Set the global registry.
 *
 * Writes the cross-bundle `globalThis[Symbol.for(...)]` slot so subsequent
 * `getGlobalRegistry()` calls — from any bundle — see this exact instance.
 * Called by `UIBridgeProviderInit.initializeUIBridge` and re-asserted on
 * every mount of `UIBridgeProvider` (see the useEffect there) so a remount
 * never strands the global at a torn-down instance.
 */
export function setGlobalRegistry(registry: UIBridgeRegistry): void {
  const slot = getRegistrySlot();
  slot[REGISTRY_KEY] = registry;
}

/**
 * Reset the global registry.
 *
 * Clears the live instance and removes the cross-bundle slot so the next
 * `getGlobalRegistry()` lazily creates a fresh one. Tests use this; the
 * provider deliberately does NOT call this on unmount to avoid stranding
 * sibling consumers at a torn-down singleton mid-lifecycle.
 */
export function resetGlobalRegistry(): void {
  const slot = getRegistrySlot();
  const current = slot[REGISTRY_KEY] ?? null;
  current?.clear();
  slot[REGISTRY_KEY] = null;
}
