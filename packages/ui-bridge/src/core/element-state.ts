/**
 * The ONE `ElementState` reader.
 *
 * The registry (`core/registry.ts`, every registered element's `getState()`
 * and so every snapshot entry), the action executor
 * (`control/action-executor.ts`, action responses, find/discover rows and the
 * wait loop), the render-log capture (`render-log/dom-capture.ts`), the
 * debug inspector (`debug/inspector.tsx`), the un-registered DOM-fallback
 * scan (`server/dom-fallback.ts`) and the find filter's `include_hidden: false`
 * arm (`core/find-filter.ts`, through {@link readElementVisibility}) all
 * delegate here. Before this
 * module existed each of those carried its own copy, with four different
 * `visible` algorithms behind one field name (plan
 * `2026-11-08-ui-bridge-element-state-has-two-readers-and-no-aria-busy`, D1).
 * A second reader is the defect class; extend this one instead.
 *
 * Moved out of `core/registry.ts`. §4.6: every DOM-derived TEXT field —
 * `accessibleName`, `textContent`, `value`, the option lists, `href`,
 * `constraints.pattern/min/max/step` and `validationState.validationMessage` —
 * is minted through the `core/redaction` choke point (the branded `Scrubbed<T>`
 * types make a raw assignment a compile error), and `dataset` is omitted on
 * the VALUE axis. The fields left raw are structural tokens rather than page
 * text: `role` and `ariaCurrent` (ARIA tokens), `nameSource` (an enum),
 * `occludedBy` (a registry id or a tag/id/class descriptor) and
 * `computedStyles` (CSS values).
 */

import type { ElementState } from './types';
import { projectComputedStyles } from './computed-styles';
import { clipBoxOf, clipScrollableAt, insideClip, type ClipBox } from './clip-box';
import {
  readAriaLabelAttr,
  readTitleAttr,
  isInteractionBlocked,
  readInteractionBlockers,
  resolveAccessibleName,
} from './a11y';
import { classList } from './class-name';
import {
  verdictOf,
  elementRedaction,
  readScrubbedText,
  scrubContentByVerdict,
  readScrubbedValue,
  scrubValueByVerdict,
  scrubSelectState,
  type RedactionVerdict,
} from './redaction';

/**
 * Capture form-specific state (required, validation, constraints) for a form control element.
 */
function captureFormControlState(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  state: ElementState,
  verdict: RedactionVerdict
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
        // §4.6 VALUE axis: a browser's message can quote the entered value.
        validationMessage: scrubValueByVerdict(element.validationMessage || undefined, verdict),
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
        constraints.pattern = scrubContentByVerdict(element.pattern, verdict);
        hasConstraint = true;
      }
      if (element.min) {
        constraints.min = scrubContentByVerdict(element.min, verdict);
        hasConstraint = true;
      }
      if (element.max) {
        constraints.max = scrubContentByVerdict(element.max, verdict);
        hasConstraint = true;
      }
      if (element.step && element.step !== 'any') {
        constraints.step = scrubContentByVerdict(element.step, verdict);
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
 * `ElementState.ariaBusy`'s rule, in one place: `true` only when the element's
 * OWN `aria-busy` attribute is the literal `"true"`; every other value and
 * absence read `false` (WAI-ARIA's default for this global state). An
 * ancestor's `aria-busy` is not inherited — see the field's doc comment in
 * `core/types.ts` for why.
 */
function readAriaBusy(element: Element): boolean {
  return element.getAttribute('aria-busy') === 'true';
}

/** The visibility family of {@link ElementState}: what {@link readElementVisibility} returns. */
export type ElementVisibility = Pick<
  ElementState,
  'visible' | 'visibilityReason' | 'occludedBy' | 'occludedPct' | 'clippedPct' | 'clipScrollable'
>;

/** The layout reads the visibility verdict is built from, taken once per element. */
interface LayoutReads {
  rect: DOMRect;
  computedStyle: CSSStyleDeclaration;
  inViewport: boolean;
}

function readLayout(element: HTMLElement): LayoutReads {
  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);
  const inViewport =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0;
  return { rect, computedStyle, inViewport };
}

function visibilityFields(element: HTMLElement, layout: LayoutReads): ElementVisibility {
  const v = computeVisibilityVerdict(element, layout.rect, layout.computedStyle, layout.inViewport);
  return {
    visible: v.visible,
    visibilityReason: v.reason,
    occludedBy: v.occludedBy,
    occludedPct: v.occludedPct,
    clippedPct: v.clippedPct,
    clipScrollable: v.clipScrollable,
  };
}

/**
 * The canonical visibility verdict ALONE — the exact `visible`,
 * `visibilityReason`, `occludedBy`, `occludedPct`, `clippedPct` and
 * `clipScrollable` {@link getElementState} reports (it delegates here), without
 * the accessible name, text, style projection and form state a full read also
 * builds. For a caller that needs only "is this element visible", such as the
 * find filter's `include_hidden: false` arm over a live node (plan
 * `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`,
 * D1). One algorithm: do not derive `visible` any other way.
 */
export function readElementVisibility(element: HTMLElement): ElementVisibility {
  return visibilityFields(element, readLayout(element));
}

/**
 * Is the node rendered at all — the check an ACTION is gated on, not the
 * visibility verdict a row reports. True when the node is connected, has no
 * `display: none` on itself or any ancestor, and is not `visibility: hidden`
 * (computed, so an inherited value counts).
 *
 * Deliberately NOT {@link readElementVisibility}: an off-screen target is
 * scrolled into view by the action, an occluded one is the caller's concern,
 * and an `opacity: 0` control (a styled file input) still takes input, so the
 * canonical verdict would refuse actions that dispatch. Used by the relay's
 * `executeElementAction` dispatch gate and by the wait-for-element
 * `clickable` condition on both arms, so "clickable" means "the next action
 * would not be refused as not rendered".
 *
 * It replaced an `offsetParent !== null` test, which a browser also fails for
 * a control that is itself `position: fixed` (plan-library edge e11dd943).
 */
export function isRenderedForAction(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (window.getComputedStyle(el).visibility === 'hidden') return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

/**
 * Get the current state of an element
 */
export function getElementState(element: HTMLElement): ElementState {
  const layout = readLayout(element);
  const { rect, computedStyle, inViewport } = layout;

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
  // ONE accessible-name algorithm for the whole package. This used to be a
  // second, hand-rolled chain that truncated at 80 code points, so
  // `state.accessibleName` and the snapshot entry's `accessibleName` — two
  // fields with the same name, read by the same consumers — could disagree on
  // the same element. That is the defect class this plan exists to close.
  const resolvedName = resolveAccessibleName(element);
  const accessibleName = scrubContentByVerdict(resolvedName.name, verdict);

  // The interaction blockers, unfolded once (`enabled` below is the derived
  // fold). Same helper in every serializer AND in the click-path pre-check —
  // see `core/a11y` — so the reader and the actor cannot disagree about
  // whether this element can be clicked.
  const disabledSignals = readInteractionBlockers(element, computedStyle);

  // Occlusion is computed once here and carried on the state, so every
  // consumer — discover, snapshot, page-health, the CI style gate, the
  // vision-core projection — sees the same verdict AND the same occluder.
  const visibility = visibilityFields(element, layout);

  const state: ElementState = {
    visible: visibility.visible,
    visibilityReason: visibility.visibilityReason,
    occludedBy: visibility.occludedBy,
    occludedPct: visibility.occludedPct,
    clippedPct: visibility.clippedPct,
    clipScrollable: visibility.clipScrollable,
    // Content width vs. box width is what makes horizontal truncation
    // MEASURABLE. Captured for every element, not just scroll containers:
    // a `truncate`d label is `overflow: hidden` with no scrollbar, so it
    // never qualified as one and its overflow went unrecorded.
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    enabled: !isInteractionBlocked(disabledSignals),
    disabled: disabledSignals.disabled,
    ariaDisabled: disabledSignals.ariaDisabled,
    focused: document.activeElement === element,
    role: roleAttr,
    accessibleName,
    nameSource: resolvedName.source,
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
    textContent: readScrubbedText(element, verdict),
    computedStyles: projectComputedStyles(computedStyle),
    inViewport,
    // Required and always set; assigned from the element's own attribute in
    // the ARIA block below.
    ariaBusy: false,
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
  state.ariaBusy = readAriaBusy(element);
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
    state.value = readScrubbedValue(element, verdict);
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    }
    captureFormControlState(element, state, verdict);
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = readScrubbedValue(element, verdict);
    captureFormControlState(element, state, verdict);
  } else if (element instanceof HTMLSelectElement) {
    // §4.6: single shared option-list scrub — the COUNT-collapse-when-redacted
    // decision lives in `scrubSelectState` so all three builders cannot diverge.
    const sel = scrubSelectState(element, verdict);
    state.value = sel.value;
    state.selectedOptions = sel.selectedOptions;
    state.availableOptions = sel.availableOptions;
    captureFormControlState(element, state, verdict);
  }

  // Capture href for anchor elements. §4.6 CONTENT axis — the same axis the
  // render-log's `attributes.href` collapses on: a URL can carry a secret
  // (`/reset?token=…`), so inside a boundary it is the sentinel.
  if (element instanceof HTMLAnchorElement && element.href) {
    state.href = scrubContentByVerdict(element.href, verdict);
  }

  return state;
}

/**
 * Sample points used by the occlusion hit-test, as fractions of the
 * element's own box. The centre is FIRST and is always probed; the eight
 * perimeter points are added only for elements large enough that partial
 * occlusion is a distinct outcome (see `OCCLUSION_PERIMETER_MIN_PX`).
 *
 * A single centre probe — which is all this used to do — cannot see PARTIAL
 * occlusion, and partial is the common shape: a floating widget parked in a
 * corner clips the end of a wide label while its centre stays clear, so the
 * element reported `visible: true` while a human could not read its name.
 *
 * Inset from the true edges so a 1px border or a neighbour's touching box
 * doesn't register as covering this one.
 */
const OCCLUSION_SAMPLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.06, 0.06],
  [0.94, 0.06],
  [0.06, 0.94],
  [0.94, 0.94],
  [0.5, 0.06],
  [0.5, 0.94],
  [0.06, 0.5],
  [0.94, 0.5],
];

/**
 * Below this size on BOTH axes, only the centre point is probed.
 *
 * `getElementState` is a hot path — it recomputes live on every `getState()`,
 * and callers iterate the whole registry — so going from one probe to nine
 * unconditionally would be a 9x multiplier on every snapshot. It buys nothing
 * for a 24x24 icon: an overlay covering part of it covers essentially all of
 * it, so the centre already answers correctly. The perimeter samples exist for
 * WIDE or TALL elements, where a corner widget can hide the end of a label
 * while the middle stays clear — which is the defect class this is for.
 *
 * 48px is two minimum WCAG touch targets: below it there is no room for a
 * meaningful partial overlap.
 */
const OCCLUSION_PERIMETER_MIN_PX = 48;

/**
 * Why an element is not visible. A superset of `VisibilityReason` in control/:
 * the action pre-check never produces `clipped`, which only the sampled
 * verdict below can tell apart from `occluded`.
 */
type RegistryVisibilityReason = 'hidden' | 'off-screen' | 'occluded' | 'clipped' | 'no-layout';

/**
 * `document.elementFromPoint` guarded for environments that don't implement
 * it. jsdom does not, and an unguarded call would throw during any test that
 * snapshots the registry — which would make the hit-test's absence a crash
 * rather than a missing measurement.
 */
function safeElementFromPoint(x: number, y: number): Element | null {
  try {
    return typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  } catch {
    return null;
  }
}

interface VisibilityVerdict {
  visible: boolean;
  reason?: RegistryVisibilityReason;
  /** Registry id (or a DOM-derived label) of the element painting on top. */
  occludedBy?: string;
  /** Share of the IN-CLIP sampled points that another element owns, 0-100. */
  occludedPct?: number;
  /** Share of the sampled points an ancestor's overflow clips away, 0-100; set only when > 0. */
  clippedPct?: number;
  /** Every clipper that excluded a sample can scroll it back into view. Set with `clippedPct`. */
  clipScrollable?: boolean;
}

/**
 * Best-effort identifier for whatever is covering an element. Prefers the
 * UI Bridge registry id, because that is the name every downstream report
 * and assertion speaks; falls back to a DOM-shaped descriptor so an
 * unregistered overlay is still NAMED rather than reported as an anonymous
 * "something".
 */
function describeOccluder(hit: Element): string {
  const el = hit as HTMLElement;
  const registered = el.closest<HTMLElement>('[data-ui-bridge-id]');
  const id = registered?.getAttribute('data-ui-bridge-id');
  if (id) return id;
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  // `classList(el)`, never raw `.className`: an SVG element's className is an
  // SVGAnimatedString, and the occluder here is very often exactly that — the
  // widget that motivated this work is an <svg>.
  const cls = classList(el)[0] ?? '';
  return cls ? `${tag}.${cls}` : tag;
}

/**
 * Check if an element is truly visible — not just in the viewport, but
 * actually painted (not clipped by ancestor overflow, see `core/clip-box.ts`)
 * and not covered by another element in a higher stacking context — and,
 * when it is covered, WHICH element is responsible.
 *
 * Returning the occluder is the difference between "the session name is
 * not visible" and "the zone minimap is covering the session name". Only
 * the second is actionable, and the identity used to be discarded here.
 */
function computeVisibilityVerdict(
  element: HTMLElement,
  rect: DOMRect,
  style: CSSStyleDeclaration,
  inViewport: boolean
): VisibilityVerdict {
  if (rect.width === 0 || rect.height === 0) return { visible: false, reason: 'no-layout' };
  if (style.display === 'none') return { visible: false, reason: 'hidden' };
  if (style.visibility === 'hidden') return { visible: false, reason: 'hidden' };
  if (parseFloat(style.opacity) === 0) return { visible: false, reason: 'hidden' };
  if (!inViewport) return { visible: false, reason: 'off-screen' };

  // Hit-test: what the compositor actually painted at each sample point. Two
  // different states reach it and are kept apart: an ancestor's overflow CUT
  // OFF the element there (`clipped` — a scrolled-away nav item, the tail of a
  // `truncate`d label), or another painted element COVERS it (`covered`).
  // Only the second is occlusion; blaming whatever `elementFromPoint` returns
  // under a clipped point manufactured "footer occludes nav item" findings.
  let sampled = 0;
  let covered = 0;
  let clipped = 0;
  const clippedPoints: Array<readonly [number, number]> = [];
  // Computed lazily, on the first sample whose hit is not the element or a
  // descendant: a hit on our own subtree proves the point is painted, so an
  // element with no foreign hit — the common case on a hot path — never pays
  // for the ancestor walk.
  let clip: ClipBox | undefined;
  // Count occluders so the finding names the one doing most of the
  // covering, not whichever point happened to be probed last.
  const blame = new Map<string, number>();

  // Adaptive: the centre alone for small elements, the full perimeter for
  // elements big enough to be partially covered in a way a reader would
  // notice.
  const wide = rect.width >= OCCLUSION_PERIMETER_MIN_PX;
  const tall = rect.height >= OCCLUSION_PERIMETER_MIN_PX;
  const points = wide || tall ? OCCLUSION_SAMPLE_POINTS : OCCLUSION_SAMPLE_POINTS.slice(0, 1);

  for (const [fx, fy] of points) {
    const px = rect.left + rect.width * fx;
    const py = rect.top + rect.height * fy;
    // A point outside the viewport tells us nothing — `elementFromPoint`
    // returns null there, which is not evidence of covering.
    if (px < 0 || px >= window.innerWidth || py < 0 || py >= window.innerHeight) continue;
    sampled++;
    const hit = safeElementFromPoint(px, py);
    // No hit is no measurement (jsdom, an unsupported environment): it is
    // neither covering nor evidence that an ancestor clipped the point.
    if (hit === null) continue;
    if (hit === element || element.contains(hit)) continue;
    // Outside the clip box the element is not painted at all, so whatever
    // the hit-test returns there — an unrelated footer, or our own app-shell
    // ancestor — is not covering it. Checked BEFORE the ancestor rule below:
    // a fully clipped element whose clipped points return its own ancestor
    // used to read `visible: true`.
    clip ??= clipBoxOf(element);
    if (clip.box && !insideClip(clip.box, px, py)) {
      clipped++;
      clippedPoints.push([px, py]);
      continue;
    }
    // An ANCESTOR at the sample point means our own box is transparent
    // there (padding, a gap between children) — not that something is
    // covering us.
    if (hit.contains(element)) continue;
    covered++;
    const who = describeOccluder(hit);
    blame.set(who, (blame.get(who) ?? 0) + 1);
  }

  if (sampled === 0) return { visible: true };

  const clipFields: Pick<VisibilityVerdict, 'clippedPct' | 'clipScrollable'> =
    clipped > 0 && clip
      ? {
          clippedPct: Math.round((clipped / sampled) * 100),
          clipScrollable: clipScrollableAt(clip.clippers, clippedPoints),
        }
      : {};

  // Every sampled point is cut off by an ancestor: nothing of it is painted,
  // and nothing is to blame. `visible: false` keeps the meaning consumers that
  // filter on `visible` already had (this element used to read `occluded`).
  if (clipped === sampled) {
    return { visible: false, reason: 'clipped', ...clipFields };
  }

  if (covered === 0) return { visible: true, ...clipFields };

  // Occlusion is measured over the points the element could paint at all.
  const inClip = sampled - clipped;
  const occludedPct = Math.round((covered / inClip) * 100);
  let occludedBy: string | undefined;
  let worst = 0;
  for (const [who, n] of blame) {
    if (n > worst) {
      worst = n;
      occludedBy = who;
    }
  }

  // Fully covered is not visible. PARTIALLY covered still reports as
  // visible — it is on screen and clickable at some points — but carries
  // the occluder so a report can say what is clipping it. Collapsing
  // partial occlusion into `visible: false` would break every consumer
  // that filters on `visible`, and losing it entirely is the defect.
  return {
    visible: covered < inClip,
    reason: covered >= inClip ? 'occluded' : undefined,
    occludedBy,
    occludedPct,
    ...clipFields,
  };
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
