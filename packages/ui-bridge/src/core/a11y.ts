/**
 * Structural-accessibility helpers for the SDK populate path.
 *
 * These produce the canonical wire-fields consumed by Spec-Check's matcher
 * (`UIBridgeElement.role`, `ariaLabel`, `accessibleName`, `text`). The SDK
 * is the single source of truth — every consumer reads these directly.
 *
 * Implementation backed by `dom-accessibility-api` for:
 *   - `getRole(el)` — explicit `role=` + implicit W3C ARIA-in-HTML mapping
 *     (knows that `input[type=submit]` is `button`, `<select multiple>` is
 *     `listbox`, etc.). The reference implementation used by
 *     `@testing-library/dom`'s `getByRole`.
 *   - `computeAccessibleName(el)` — the W3C accessible-name algorithm
 *     (https://w3c.github.io/accname/), consulting `aria-label`,
 *     `aria-labelledby`, associated `<label>`, `title`, and descendant
 *     text content per the role.
 *
 * All helpers are best-effort and never throw — they return `undefined` on
 * any error so the snapshot stays serializable in degraded environments
 * (older jsdom, exotic DOM-like shims).
 */
// `dom-accessibility-api` ships type definitions at `dist/index.d.ts` but its
// `package.json` `exports` field doesn't include a `types` condition, so
// `moduleResolution: bundler` won't auto-resolve them. The ambient declaration
// for our use is in `dom-accessibility-api.d.ts` next to this file.
import { computeAccessibleName, getRole } from 'dom-accessibility-api';

/**
 * Collapse runs of whitespace to a single space and trim. Matches the
 * normalization Spec-Check's matcher will run against the matcher input,
 * so equality comparisons are exact.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Canonical ARIA role per W3C ARIA-in-HTML mapping. Returns the explicit
 * `role=` attribute if set and valid; otherwise the implicit role for the
 * tag (e.g. `<button>` → `"button"`, `<input type="checkbox">` →
 * `"checkbox"`). Returns `undefined` if the element has no applicable role
 * (e.g. plain `<div>`).
 */
export function computeRoleSafe(node: Element): string | undefined {
  try {
    const role = getRole(node);
    return role || undefined;
  } catch {
    // `getRole` can throw on detached / synthetic DOM in jsdom variants —
    // fall back to the explicit attribute so we still emit something useful.
    const explicit = node.getAttribute?.('role');
    return explicit && explicit.trim() ? explicit.trim() : undefined;
  }
}

/**
 * Computed `aria-label` per the schema contract: explicit `aria-label`
 * attribute, with `aria-labelledby` reference resolution as fallback
 * (multiple ids joined by single spaces). Returns `undefined` if neither
 * is set.
 *
 * This is intentionally narrower than `computeAccessibleNameSafe`. The
 * accessible-name algorithm may also consult `<label for>`, `title`,
 * descendant text, etc. — this helper produces just the explicit ARIA
 * labelling for callers that need to distinguish the two.
 */
export function computeAriaLabel(node: Element): string | undefined {
  const explicit = node.getAttribute?.('aria-label');
  if (explicit && explicit.trim()) return normalizeWhitespace(explicit);

  const labelledBy = node.getAttribute?.('aria-labelledby');
  if (!labelledBy) return undefined;

  const ownerDocument = node.ownerDocument;
  if (!ownerDocument) return undefined;

  const ids = labelledBy.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (const id of ids) {
    const referenced = ownerDocument.getElementById(id);
    const text = referenced?.textContent?.trim();
    if (text) parts.push(text);
  }
  if (parts.length === 0) return undefined;
  return normalizeWhitespace(parts.join(' '));
}

/**
 * W3C accessible-name algorithm (https://w3c.github.io/accname/) output.
 * Wraps `computeAccessibleName` from `dom-accessibility-api` to never
 * throw and to coerce the empty string to `undefined` so the schema
 * field is omitted rather than serialized as `""`.
 */
export function computeAccessibleNameSafe(node: Element): string | undefined {
  try {
    const name = computeAccessibleName(node);
    if (!name) return undefined;
    const normalized = normalizeWhitespace(name);
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which rung of the naming chain produced an element's accessible name.
 *
 * `'none'` is a STATEMENT, not an absence. Before this existed, an icon-only
 * `<button>` with no `aria-label` and no `title` came back with `label`,
 * `text`, `ariaLabel` and `accessibleName` all missing, and a reader could not
 * tell "this element has no name" from "the name was not computed". Four
 * silent nulls are the shape of an instrument that does not know what it does
 * not know [`ux-priorities` `no-widget-may-hide-identifying-text`].
 *
 * `'derived'` says the name did NOT come from the accessibility tree at all —
 * it was built from developer affordances already on the node (a `data-testid`,
 * a bridge id, an icon token). Useful for addressing the element; NOT evidence
 * that a screen-reader user can name it. Keeping the two distinguishable is the
 * entire point of reporting the rung.
 */
export type AccessibleNameSource =
  | 'aria-label'
  | 'aria-labelledby'
  | 'label'
  | 'title'
  | 'text'
  | 'derived'
  | 'none';

/** An accessible name together with the rung that produced it. */
export interface ResolvedAccessibleName {
  /** The name. Absent only when `source` is `'none'`. */
  name?: string;
  source: AccessibleNameSource;
}

/** Attributes a developer stamps for addressing, in the order we prefer them. */
const DERIVED_NAME_ATTRS = ['data-testid', 'data-test-id', 'data-cy', 'data-ui-bridge-id', 'name'];

/** Icon-library class prefixes worth stripping to leave a readable token. */
const ICON_CLASS_PREFIX = /^(?:lucide|icon|fa|fas|far|mdi|bi|material-icons)[-_]/;

/**
 * Build a name for an element the accessibility tree cannot name, from the
 * developer affordances already present on the node.
 *
 * This is not an accessibility fix and must never be mistaken for one — an
 * element that reaches this rung IS an a11y finding the page owner should act
 * on. It exists so that such an element is still addressable and still
 * REPORTABLE, instead of being invisible to every discovery path that does not
 * already know its id.
 */
function deriveStructuralName(node: Element): string | undefined {
  for (const attr of DERIVED_NAME_ATTRS) {
    const value = node.getAttribute(attr)?.trim();
    if (value) return value;
  }

  const id = (node as HTMLElement).id?.trim();
  if (id) return id;

  // An inline icon often carries the only human-meaningful token on the node.
  const svgTitle = node.querySelector('svg > title')?.textContent?.trim();
  if (svgTitle) return svgTitle;

  const iconHost = node.matches('svg') ? node : node.querySelector('svg');
  if (iconHost) {
    // `SVGElement.className` is an SVGAnimatedString, not a string — read the
    // attribute so both HTML and SVG hosts behave the same.
    const classes = (iconHost.getAttribute('class') ?? '').split(/\s+/);
    for (const token of classes) {
      if (ICON_CLASS_PREFIX.test(token)) {
        const stripped = token.replace(ICON_CLASS_PREFIX, '');
        if (stripped) return stripped;
      }
    }
  }

  return undefined;
}

/**
 * Resolve an element's accessible name AND say which rung produced it.
 *
 * The name itself is still the W3C algorithm's answer
 * ({@link computeAccessibleNameSafe}) — this does not re-implement accname.
 * The rung is then attributed by testing the standard inputs in W3C order and
 * matching the one that produced the answer, so an authored `aria-label` is
 * reported as authored and a name scraped out of descendant text is reported
 * as scraped. When the algorithm yields nothing, {@link deriveStructuralName}
 * gets one attempt, and failing that the answer is the explicit `'none'`.
 */
export function resolveAccessibleName(node: Element): ResolvedAccessibleName {
  const name = computeAccessibleNameSafe(node);

  if (name) {
    // Attribution is a NICETY; the name is not. `CSS.escape`, a malformed
    // `label[for]` selector, or an exotic node must never take a snapshot read
    // down — degrade to the catch-all rung instead. `computeAccessibleNameSafe`
    // is already fault-isolated the same way.
    try {
      return { name, source: attributeNameSource(node, name) };
    } catch {
      return { name, source: 'text' };
    }
  }

  let derived: string | undefined;
  try {
    derived = deriveStructuralName(node);
  } catch {
    derived = undefined;
  }
  if (derived) return { name: derived, source: 'derived' };

  return { source: 'none' };
}

/**
 * Which standard input produced `name`? Tested in W3C order, matching on the
 * normalized value. Never called with an empty `name`.
 */
function attributeNameSource(node: Element, name: string): AccessibleNameSource {
  const matches = (candidate: string | undefined | null): boolean =>
    !!candidate && normalizeWhitespace(candidate) === name;

  if (matches(readAriaLabelAttr(node))) return 'aria-label';

  const labelledBy = readAriaLabelledbyAttr(node);
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => node.ownerDocument?.getElementById(id)?.textContent ?? '')
      .filter((t) => t.trim().length > 0);
    if (parts.length > 0 && matches(parts.join(' '))) {
      return 'aria-labelledby';
    }
  }

  const id = (node as HTMLElement).id;
  if (id) {
    const labelEl = node.ownerDocument?.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (matches(labelEl?.textContent)) return 'label';
  }
  const wrappingLabel = node.closest?.('label');
  if (wrappingLabel && matches(wrappingLabel.textContent)) {
    return 'label';
  }

  if (matches(readTitleAttr(node))) return 'title';

  // Everything left is the algorithm reading content out of the subtree.
  return 'text';
}

/**
 * Visible text content with whitespace collapsed and trimmed. Uses
 * `innerText` when available (it respects CSS visibility and
 * `<br>`-to-newline mapping), falling back to `textContent` (which
 * includes all descendant text regardless of CSS).
 *
 * jsdom does not implement `innerText` — there the fallback path always
 * fires. That's fine for our use case: Spec-Check's matcher compares
 * the value after the same normalization on both sides.
 */
export function computeVisibleText(node: Element): string | undefined {
  const inner = (node as HTMLElement).innerText;
  const raw = typeof inner === 'string' && inner.length > 0 ? inner : (node.textContent ?? '');
  const normalized = normalizeWhitespace(raw);
  return normalized || undefined;
}

// ===========================================================================
// Sanctioned raw a11y-attribute readers (the §4.6 lint choke point)
// ---------------------------------------------------------------------------
// `core/a11y.ts` and `core/redaction.ts` are the ONLY two modules the
// redaction CI guard (eslint.config.js, plan Phase 6) permits to read the
// sensitive content attributes raw — everywhere else routes through here (or
// through a scrub minter). These thin wrappers exist so a raw
// `getAttribute('aria-label' | 'aria-labelledby' | 'placeholder' | 'title' |
// 'alt')` read lives behind ONE named function instead of being open-coded at
// 85+ call sites — the same single-choke-point discipline the plan mandates.
//
// They are BEHAVIOUR-NEUTRAL: each returns the exact attribute value. §4.6
// redaction, where the value reaches a client, is applied by the CALLER via
// the `scrubContent` / `isContentRedacted` minters in `core/redaction.ts`.
// Callers that read these attributes for INTERNAL, non-client-facing purposes
// (element fingerprinting, modal/toast/shortcut detection, dedup keys) keep the
// raw value deliberately — routing it through here does not change what they
// see, it only centralises the read so the guard has one place to enforce and a
// future audit has one place to gate.
//
// Presence semantics mirror `getAttribute`: an absent attribute returns `null`,
// so `?? fallback` / `|| fallback` chains at call sites are preserved verbatim.
// ===========================================================================

/** Raw `aria-label` attribute, or `null` when absent. */
export function readAriaLabelAttr(el: Element): string | null {
  return el.getAttribute('aria-label');
}

/** Raw `aria-labelledby` attribute (space-separated id refs), or `null`. */
export function readAriaLabelledbyAttr(el: Element): string | null {
  return el.getAttribute('aria-labelledby');
}

/** Raw `title` attribute, or `null` when absent. */
export function readTitleAttr(el: Element): string | null {
  return el.getAttribute('title');
}

/** Raw `placeholder` attribute, or `null` when absent. */
export function readPlaceholderAttr(el: Element): string | null {
  return el.getAttribute('placeholder');
}

/** Raw `alt` attribute, or `null` when absent. */
export function readAltAttr(el: Element): string | null {
  return el.getAttribute('alt');
}

/**
 * Raw `innerText`, or `undefined` when unavailable (jsdom does not implement
 * it). Unlike `computeVisibleText` this does NOT normalize/trim or fall back to
 * `textContent` — it is the verbatim `innerText` read, for callers that layer
 * their own fallback (`readInnerText(el) ?? el.textContent`). Centralised here
 * so the guard's package-wide `innerText`-read ban has a single sanctioned home.
 */
export function readInnerText(el: Element): string | undefined {
  const inner = (el as HTMLElement).innerText;
  return typeof inner === 'string' ? inner : undefined;
}

/**
 * The two INDEPENDENT disabled signals, unfolded.
 *
 * `ElementState.enabled` folds these into one boolean, which loses the
 * distinction a driver needs: only `disabled` (the native IDL property) makes
 * the browser refuse events, while `ariaDisabled` is a pure announcement that
 * still dispatches real clicks. Every `ElementState` producer reads this one
 * helper so the four serializers cannot drift apart again.
 *
 * `enabled` is derived as `!(disabled || ariaDisabled)` — the historical
 * meaning, unchanged.
 */
export function readDisabledSignals(el: Element): {
  disabled: boolean;
  ariaDisabled: boolean;
} {
  return {
    disabled: 'disabled' in el && (el as unknown as HTMLInputElement).disabled === true,
    ariaDisabled: el.getAttribute('aria-disabled') === 'true',
  };
}

/**
 * The FULL interaction-blocking surface: the two DOM disabled signals above
 * plus effective `pointer-events: none`.
 *
 * THE DEFECT this closes: `ElementState.enabled` was derived from
 * `readDisabledSignals` alone, while the click path's own pre-check ALSO
 * refused a target whose computed `pointer-events` is `none`. A caller could
 * therefore read `enabled: true` off `GET /control/element/{id}` and then get
 * `element is disabled (pointer-events:none)` from the very next click — the
 * reader and the actor disagreeing about the same element. Both now consult
 * THIS one function, so they cannot drift again.
 *
 * `pointerEvents` is read from the COMPUTED style, never from an inline
 * `style` attribute: `pointer-events` is a CSS-inherited property, so a
 * control is unclickable whenever an ANCESTOR declares `none`, and only the
 * computed value reflects that (no ancestor walk needed).
 *
 * Pass `computedStyle` when the caller already has one for this element — the
 * `ElementState` serializers all do, and re-reading would double the
 * `getComputedStyle` cost of a full-page snapshot.
 */
export interface InteractionBlockers {
  /** Native DOM `disabled` IDL property. See `readDisabledSignals`. */
  disabled: boolean;
  /** `aria-disabled="true"`. See `readDisabledSignals`. */
  ariaDisabled: boolean;
  /** Effective (computed, therefore inherited-aware) `pointer-events: none`. */
  pointerEventsNone: boolean;
  /**
   * The raw computed `pointer-events` value, `''` when it could not be read
   * (SSR / degraded DOM shims). An unreadable value is never treated as a
   * blocker — absence of evidence is not evidence of `none`.
   */
  pointerEvents: string;
}

export function readInteractionBlockers(
  el: Element,
  computedStyle?: CSSStyleDeclaration
): InteractionBlockers {
  const { disabled, ariaDisabled } = readDisabledSignals(el);

  // `getComputedStyle` is unavailable/throwing in some degraded environments;
  // guard it and fall back to "no pointer-events evidence".
  let pointerEvents: string;
  try {
    const style = computedStyle ?? window.getComputedStyle(el);
    pointerEvents = style.pointerEvents ?? '';
  } catch {
    pointerEvents = '';
  }

  return {
    disabled,
    ariaDisabled,
    pointerEvents,
    pointerEventsNone: pointerEvents === 'none',
  };
}

/**
 * The ONE fold consulted by every `ElementState.enabled` producer AND by the
 * click-path pre-check. `enabled` is `!isInteractionBlocked(...)`.
 */
export function isInteractionBlocked(blockers: InteractionBlockers): boolean {
  return blockers.disabled || blockers.ariaDisabled || blockers.pointerEventsNone;
}
