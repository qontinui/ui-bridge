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
import {
  BRIDGE_REDACT_ATTR,
  closestRedactionBoundary,
  hasRedactionBoundaryBelow,
  REDACTED_VALUE,
  textExcludingBoundaries,
  textOutsideBoundaries,
  touchesRedactionBoundary,
  truncateKeepingSentinel,
  type RedactionVerdict,
} from './redaction';

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
    // §4.6: the referenced element's text, with any boundary it holds (or sits
    // in) replaced by the sentinel — the labelled node's verdict says nothing
    // about the label's.
    const text = referenced ? textExcludingBoundaries(referenced)?.trim() : undefined;
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
  let normalized: string | undefined;
  try {
    const name = computeAccessibleName(node);
    if (!name) return undefined;
    normalized = normalizeWhitespace(name) || undefined;
  } catch {
    return undefined;
  }
  if (!normalized) return undefined;
  try {
    return boundarySafeName(node, normalized);
  } catch {
    // Fail closed: a name we could not prove boundary-free is not emitted.
    return undefined;
  }
}

/** The `aria-labelledby` targets and associated `<label>`s a name may come from. */
function nameSourceElements(node: Element): { labelledBy: Element[]; labels: Element[] } {
  const doc = node.ownerDocument;
  const labelledBy = (readAriaLabelledbyAttr(node) ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => doc?.getElementById(id))
    .filter((el): el is HTMLElement => !!el);
  const labels: Element[] = [];
  const id = (node as HTMLElement).id;
  if (id && doc) {
    // Every associated label: accname joins them all, so one holding a
    // boundary must be seen even when it is not the first.
    labels.push(...Array.from(doc.querySelectorAll(`label[for="${CSS.escape(id)}"]`)));
  }
  // A node whose `closest` fails is treated as having no wrapping label, the
  // same degradation `attributeNameSource` applies; the subtree and the other
  // sources are still checked.
  let wrapping: Element | null;
  try {
    wrapping = node.closest?.('label') ?? null;
  } catch {
    wrapping = null;
  }
  if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
  return { labelledBy, labels };
}

/** Elements that cannot hold a child, so a boundary placeholder is a `<span>`. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

type StyleReader = (el: Element, pseudo?: string | null) => CSSStyleDeclaration;

/**
 * Clone `root` (detached) with every `data-bridge-redact="true"` descendant
 * replaced by an attribute-free placeholder holding `REDACTED_VALUE`, so the
 * W3C algorithm sees the sentinel and none of the boundary's text, `alt`,
 * `aria-label`, `title` or value. Every clone element is recorded in `origin`
 * (clone to live element) so style lookups reach the live cascade, and in
 * `cloneOf` (live to clone) so the named element can be found. The live DOM is
 * only read. `root` itself is cloned even when it is a boundary (its own
 * verdict is the caller's); the marker is stripped from the clone.
 */
function cloneWithoutBoundaries(
  root: Element,
  doc: Document,
  origin: Map<Element, Element>,
  cloneOf: Map<Element, Element>
): Element {
  const shallow = (el: Element): Element => {
    // Imported into the inert document: no browsing context, so no custom
    // element upgrade and no resource fetch (`<img src>`, `<video>`), and the
    // live DOM is untouched. The clone steps carry an edited control's value,
    // which the accname algorithm reads for an embedded textbox/combobox.
    const clone = doc.importNode(el, false) as Element;
    clone.removeAttribute(BRIDGE_REDACT_ATTR);
    origin.set(clone, el);
    cloneOf.set(el, clone);
    // A password is never carried over: its value is redacted unconditionally.
    if (el.localName === 'input' && (el as HTMLInputElement).type === 'password') {
      clone.removeAttribute('value');
      (clone as HTMLInputElement).value = '';
    }
    return clone;
  };
  const placeholder = (el: Element): Element => {
    const ph = doc.createElement(VOID_ELEMENTS.has(el.localName) ? 'span' : el.localName);
    ph.textContent = REDACTED_VALUE;
    origin.set(ph, el);
    return ph;
  };
  const top = shallow(root);
  const stack: Array<[Element, Element]> = [[root, top]];
  while (stack.length > 0) {
    const [live, copy] = stack.pop() as [Element, Element];
    for (const child of Array.from(live.childNodes)) {
      if (child.nodeType === 1) {
        const el = child as Element;
        if (el.getAttribute(BRIDGE_REDACT_ATTR) === 'true') {
          copy.appendChild(placeholder(el));
        } else {
          const clone = shallow(el);
          copy.appendChild(clone);
          stack.push([el, clone]);
        }
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        copy.appendChild(child.cloneNode(false));
      }
    }
  }
  return top;
}

/**
 * The W3C accessible name of `node` computed over a boundary-free CLONE of
 * everything the algorithm may read (the element's subtree, its `<label>`s and
 * its `aria-labelledby` targets): each redaction boundary is replaced by
 * `REDACTED_VALUE`, so `aria-hidden`, descendant `<img alt>` and embedded
 * control values follow the real algorithm. Styles are answered from the live
 * element each clone element came from. Returns `undefined` when the name
 * cannot be proven boundary-free.
 */
function boundaryFreeName(
  node: Element,
  labelledBy: Element[],
  labels: Element[]
): string | undefined {
  const doc = node.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || !view) return undefined;
  // An INERT document (no browsing context): cloned custom elements are never
  // upgraded (no constructor runs) and cloned media never fetches. The
  // algorithm insists on a window (`safeWindow`), so the inert document is
  // given the live one as its `defaultView`; styles are still answered from
  // the live elements below. The fragment is the root `aria-labelledby` and
  // `<label for>` ids resolve in.
  const inert = doc.implementation.createHTMLDocument('');
  Object.defineProperty(inert, 'defaultView', { value: view });
  const sandbox = inert.createDocumentFragment();
  const origin = new Map<Element, Element>();
  const cloneOf = new Map<Element, Element>();
  const sources = Array.from(new Set<Element>([node, ...labelledBy, ...labels]));
  const roots = sources.filter((s) => !sources.some((o) => o !== s && o.contains(s)));
  for (const root of roots) {
    if (root !== node && closestRedactionBoundary(root as HTMLElement) !== null) {
      // The whole source sits inside a boundary: it reads as the sentinel.
      if (root.contains(node)) return undefined;
      const ph = inert.createElement('span');
      ph.textContent = REDACTED_VALUE;
      for (const attr of Array.from(root.attributes)) {
        if (attr.name === 'id') ph.setAttribute('id', attr.value);
      }
      origin.set(ph, root);
      sandbox.appendChild(ph);
    } else {
      sandbox.appendChild(cloneWithoutBoundaries(root, inert, origin, cloneOf));
    }
  }
  const target = cloneOf.get(node);
  if (!target) return undefined;
  const liveStyle: StyleReader = (el, pseudo) =>
    view.getComputedStyle(origin.get(el) ?? el, pseudo);
  const name = computeAccessibleName(target, {
    getComputedStyle: liveStyle,
    computedStyleSupportsPseudoElements: false,
  });
  return normalizeWhitespace(name) || undefined;
}

/**
 * §4.6: the accname algorithm reads text from the element's subtree, its
 * `<label>`s and its `aria-labelledby` targets, boundaries included, while the
 * element's own verdict only looks UP. When any of those sources touches a
 * `data-bridge-redact` boundary, a name that did not come from the element's
 * own `aria-label` / `title` attribute is recomputed by the same algorithm
 * over a clone with every boundary replaced by `REDACTED_VALUE`
 * ({@link boundaryFreeName}). With no boundary in reach the W3C answer is
 * returned untouched.
 */
function boundarySafeName(node: Element, name: string): string | undefined {
  const { labelledBy, labels } = nameSourceElements(node);
  const touched =
    hasRedactionBoundaryBelow(node) ||
    labelledBy.some(touchesRedactionBoundary) ||
    labels.some(touchesRedactionBoundary);
  if (!touched) return name;
  const own = (v: string | null): boolean => !!v && normalizeWhitespace(v) === name;
  if (own(readAriaLabelAttr(node)) || own(readTitleAttr(node))) return name;
  return boundaryFreeName(node, labelledBy, labels);
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
 *
 * `'placeholder'` is HTML-AAM 4.1.1's final steps for a text-like `<input>` or
 * a `<textarea>`: the element's own `placeholder`, then its `aria-placeholder`,
 * names it when every rung before it (including `title`) yields nothing.
 */
export type AccessibleNameSource =
  | 'aria-label'
  | 'aria-labelledby'
  | 'label'
  | 'title'
  | 'placeholder'
  | 'text'
  | 'derived'
  | 'none';

/** An accessible name together with the rung that produced it. */
export interface ResolvedAccessibleName {
  /** The name. Absent only when `source` is `'none'`. */
  name?: string;
  source: AccessibleNameSource;
}

/** `<input>` types whose `placeholder` HTML-AAM maps to an accessible name. */
const PLACEHOLDER_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
]);

/**
 * HTML-AAM 4.1.1's last two steps, for a `<textarea>` or a text-like
 * `<input>`: the element's own `placeholder`, else its `aria-placeholder`,
 * normalized; `undefined` otherwise. Only reached when the W3C algorithm
 * (which does not consult either here) produced no name.
 */
function placeholderName(node: Element): string | undefined {
  const tag = node.tagName.toLowerCase();
  const applies =
    tag === 'textarea' ||
    // The REFLECTED `type`: an empty or unknown attribute reads as `text`. By
    // tag name, not `instanceof`, so an input from another realm (an iframe)
    // qualifies too.
    (tag === 'input' && PLACEHOLDER_INPUT_TYPES.has((node as HTMLInputElement).type));
  if (!applies) return undefined;
  return (
    normalizeWhitespace(readPlaceholderAttr(node) ?? '') ||
    normalizeWhitespace(readAriaPlaceholderAttr(node) ?? '') ||
    undefined
  );
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
  // §4.6: both icon arms read a DESCENDANT, and the node's own verdict only
  // looks up, so a descendant that touches a redaction boundary (inside one,
  // or holding one) is never read — its `<title>` or class can be the very
  // text the boundary hides.
  const titleEl = node.querySelector('svg > title');
  if (titleEl && !touchesRedactionBoundary(titleEl)) {
    const svgTitle = titleEl.textContent?.trim();
    if (svgTitle) return svgTitle;
  }

  const iconHost = node.matches('svg') ? node : node.querySelector('svg');
  if (iconHost && (iconHost === node || !touchesRedactionBoundary(iconHost))) {
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
 * as scraped. When the algorithm yields nothing, a text-like input's own
 * `placeholder`, else `aria-placeholder`, names it (HTML-AAM 4.1.1's last
 * steps, `'placeholder'`); failing
 * that {@link deriveStructuralName} gets one attempt, and failing that the
 * answer is the explicit `'none'`.
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

  const placeholder = placeholderName(node);
  if (placeholder) return { name: placeholder, source: 'placeholder' };

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
      .map((id) => {
        const target = node.ownerDocument?.getElementById(id);
        return target ? (textExcludingBoundaries(target) ?? '') : '';
      })
      .filter((t) => t.trim().length > 0);
    if (parts.length > 0 && matches(parts.join(' '))) {
      return 'aria-labelledby';
    }
  }

  const id = (node as HTMLElement).id;
  if (id) {
    const labelEl = node.ownerDocument?.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (labelEl && matches(textExcludingBoundaries(labelEl))) return 'label';
  }
  const wrappingLabel = node.closest?.('label');
  if (wrappingLabel && matches(textExcludingBoundaries(wrappingLabel))) {
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
  // §4.6: a container of a `data-bridge-redact` subtree must not read that
  // subtree's text (its own verdict only looks UP). `innerText` cannot exclude
  // a subtree, so such a container reads its text with each boundary replaced
  // by the sentinel. Every visible-text consumer — text matching, the registry
  // snapshot, labels — inherits the exclusion from this one function.
  if (hasRedactionBoundaryBelow(node)) {
    return normalizeWhitespace(textOutsideBoundaries(node) ?? '') || undefined;
  }
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

/** Raw `aria-placeholder` attribute, or `null` when absent. */
export function readAriaPlaceholderAttr(el: Element): string | null {
  return el.getAttribute('aria-placeholder');
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
 * The two INDEPENDENT disabled signals, unfolded. `disabled` is native
 * disabled as the browser applies it: the element's own property or
 * inherited `:disabled` (a disabled fieldset outside its first legend, a
 * disabled optgroup).
 *
 * `ElementState.enabled` folds these into one boolean, which loses the
 * distinction a driver needs: only `disabled` (native disabled) makes
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
    disabled:
      ('disabled' in el && (el as unknown as HTMLInputElement).disabled === true) ||
      matchesDisabledPseudo(el),
    ariaDisabled: el.getAttribute('aria-disabled') === 'true',
  };
}

/**
 * `:disabled` — native disabled as the browser applies it, which the element's
 * own `.disabled` property does not carry: a control inside a
 * `<fieldset disabled>` is disabled (and receives no input) though its own
 * property reads `false`, while one inside that fieldset's first `<legend>` is
 * not; an `<option>` whose parent `<optgroup>` is disabled is disabled too.
 *
 * The optgroup rule is read directly as well as through the selector, because
 * not every selector engine applies it (jsdom's does not). A selector engine
 * that cannot evaluate the pseudo-class (a degraded DOM shim) throws; that is
 * no evidence of `disabled`, so it reads `false`.
 */
function matchesDisabledPseudo(el: Element): boolean {
  if (el.localName === 'option') {
    const group = el.parentElement;
    if (group?.localName === 'optgroup' && group.hasAttribute('disabled')) return true;
  }
  try {
    return typeof el.matches === 'function' && el.matches(':disabled');
  } catch {
    return false;
  }
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
  /** Native disabled: the `disabled` property or inherited `:disabled`. See `readDisabledSignals`. */
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
 * click-path pre-checks (the HTTP action executor and the React IPC relay).
 * `enabled` is `!isInteractionBlocked(...)`.
 *
 * `ignorePointerEvents` waives ONLY the pointer-events discriminator, for an
 * actor that overcomes it itself (`hoverClick` hovers a `group-hover` gate
 * open before clicking). Native `disabled` and `aria-disabled` survive a hover,
 * so they always block. Passing the option — rather than re-folding the struct
 * at the call site — keeps the waiver inside the one predicate.
 */
export function isInteractionBlocked(
  blockers: InteractionBlockers,
  options?: { ignorePointerEvents?: boolean }
): boolean {
  return (
    blockers.disabled ||
    blockers.ariaDisabled ||
    (!options?.ignorePointerEvents && blockers.pointerEventsNone)
  );
}

/** A row label's cap: 200 code points, then `…`. */
export const LABEL_MAX_CODE_POINTS = 200;

/**
 * Cap a name for display as a row `label`. The cut never splits a
 * `REDACTED_VALUE` sentinel the name carries (a boundary inside the named
 * subtree): a sentinel the cut would split is dropped whole.
 */
function capLabel(name: string): string {
  const cut = truncateKeepingSentinel(name, LABEL_MAX_CODE_POINTS);
  return cut === name ? name : cut + '…';
}

/**
 * The ONE row `label` rule, shared by every find/discover arm (the DOM
 * fallback scan, the injected registry seeder and the action executor's
 * `find()`): the element's CANONICAL accessible name — the value
 * {@link resolveAccessibleName} answers, and so the value
 * `state.accessibleName` carries — capped at {@link LABEL_MAX_CODE_POINTS}
 * code points, with the §4.6 CONTENT scrub applied: a content-redacted
 * element's label is `REDACTED_VALUE` whether or not it has a name (a hidden
 * name reads as hidden, never as absent). A non-redacted element with no
 * name yields `''`.
 *
 * Takes the NAME, not the element, so a caller that already resolved it
 * (every `getElementState` read does) never runs the accname algorithm a
 * second time for the same element.
 */
export function canonicalLabelFromName(
  name: string | null | undefined,
  verdict: RedactionVerdict
): string {
  return verdict.content ? REDACTED_VALUE : capLabel(name ?? '');
}
