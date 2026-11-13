/**
 * Request-scoped style and attribute projection — THE one read behind the
 * `properties` / `attributes` options of `POST /control/find`,
 * `POST /control/discover` and `GET /control/element/:id/state`, on every
 * transport (the in-page executor, the in-process server handlers and the
 * relay's browser-side command handlers), and behind the `cssProperty*` /
 * `attribute` checks of `POST /ai/assert` and `/ai/assert/batch`.
 *
 * Why a projection instead of a wider `ElementState.computedStyles`: that
 * object is computed for EVERY element of EVERY snapshot, so it is kept to a
 * fixed, light set (`core/types.ts`, "Extended styles kept out of snapshots").
 * A check that needs `border-inline-start-color`, `outline-offset`, `hyphens`
 * or a design token (`--color-accent`) asks for exactly those names on the
 * request that needs them, and nothing else pays for it.
 *
 * The request is validated before anything is read:
 *   - a property name must be a CSS ident — a standard name (`border-top-color`,
 *     `-webkit-line-clamp`, or its CSSOM camel-cased attribute,
 *     `borderTopColor`) or a custom property (`--color-accent`);
 *   - an attribute name must be on the allow-list: `lang`, `dir`, `id`, `role`,
 *     `title`, `alt`, `href` or an `aria-*` name. Anything else (`onclick`,
 *     `style`, `data-*`, `value`) is refused rather than read;
 *   - each list holds at most {@link MAX_PROJECTED_NAMES} names of at most
 *     {@link MAX_PROJECTION_NAME_LENGTH} characters.
 * A request that breaks any of these is refused whole with
 * `UB-VALIDATION-ERROR` ({@link ProjectionRequestError}); nothing is measured on
 * it.
 *
 * What a read answers, per name:
 *   - a property: its COMPUTED value, read with
 *     `getComputedStyle(el).getPropertyValue(name)`, so a `var()` reference is
 *     already resolved (prior art: `ai/design-inspector.ts`
 *     `getCSSCustomProperties`). A custom property's value is trimmed.
 *   - an attribute: its value, or `null` when the element does not carry it —
 *     a measured absence, not an unknown.
 *   - a name the read could not answer goes to `unmeasured` with a typed
 *     {@link UnknownCode} and is left out of the value map: no DOM node behind
 *     the row (`capability_unavailable_in_build`), an element not in the
 *     document, or a custom property the element does not set
 *     (`input_missing`), an engine that computes no value for the name
 *     (`capability_unavailable_in_build`: an unsupported or misspelled
 *     property, or a shorthand it does not serialize). An empty string is never
 *     reported as a value: "could not look" must not read as "looked, and it
 *     was empty".
 *
 * §4.6 redaction. Inside a `data-bridge-redact` boundary the CONTENT axis of
 * the element's verdict scrubs every value that can carry page content, through
 * the package's one scrub shape (`scrubContentByVerdict`):
 *   - attributes: everything except the structural ones — `lang`, `dir`,
 *     `role`, `id` and the token-, boolean- and number-valued ARIA states. Free
 *     text (`title`, `alt`, `aria-label`, `aria-valuetext`, …), URLs (`href`),
 *     ID references (`aria-labelledby`, …) and any ARIA name not known to be a
 *     token are scrubbed. A structural ARIA value passes only while it has a
 *     token's shape — lower-case words, or a number: anything else an author
 *     put in that slot (`aria-current="Order 4711"`) is text, and is scrubbed;
 *   - properties: a custom property (author data of any shape), any value
 *     carrying a `<string>` or a `url()` (`content`, `background-image`, …),
 *     and every property whose value names something the author chose — a
 *     font, a counter, an animation, an anchor, a container, a view transition
 *     — as an unquoted ident (`AUTHOR_NAMED_PROPERTIES`). The style vocabulary
 *     itself — colours, lengths, keywords, numbers — carries no page content
 *     and passes, so a contrast or border check still works inside a boundary.
 *
 * This module is enrolled in the redaction-surface projection list
 * (`eslint.config.js`, `redaction-surface.manifest.json`).
 */

import type { UnknownCode } from '../observation/observation';
import { scrubContentByVerdict, verdictOf } from './redaction';

/**
 * At most this many names per list (`properties`, `attributes`).
 *
 * Why 32: every check the vision DSL and the `ai/assert` style checks make
 * reads well under a dozen values per element — colour and background, the
 * four `border-*-color` sides, `outline-color` / `-style` / `-width` /
 * `-offset`, `hyphens`, font size and weight — so 32 leaves room for a whole
 * border-and-outline set (16 longhands) plus the design tokens a page checks.
 * The bound is the response, not the read: a find answers one projection per
 * returned row, so 32 names over a few hundred rows stays at a few hundred KB,
 * well inside the relay's command budget and its 10 MB body ceiling. A caller
 * that needs more asks again with the next names.
 */
export const MAX_PROJECTED_NAMES = 32;

/**
 * At most this many characters per name. The longest standard property is
 * under 40 characters; 128 leaves room for long design-token names while
 * keeping a refused request's echo short.
 */
export const MAX_PROJECTION_NAME_LENGTH = 128;

/** The attributes a projection may read, besides the `aria-*` family. */
export const PROJECTABLE_ATTRIBUTES: readonly string[] = [
  'lang',
  'dir',
  'id',
  'role',
  'title',
  'alt',
  'href',
];

/** A validated projection request. Both lists hold no duplicates. */
export interface ElementProjectionRequest {
  /** CSS property names: standard (`border-top-color`, `borderTopColor`) or custom (`--brand`). */
  properties?: readonly string[];
  /** Allow-listed attribute names (see {@link PROJECTABLE_ATTRIBUTES}, plus `aria-*`). */
  attributes?: readonly string[];
}

/** A requested name the read could not answer, and why. */
export interface ProjectionUnmeasured {
  /** Which list the name came from. */
  kind: 'property' | 'attribute';
  /** The name as requested. */
  name: string;
  /** Why it could not be read. */
  code: UnknownCode;
  /** The same, for a reader. */
  detail: string;
}

/**
 * The answer for one element. A requested name appears in exactly one place:
 * its value map, or `unmeasured`.
 */
export interface ElementProjection {
  /** Requested property → computed value (`var()` resolved). Present iff properties were requested. */
  properties?: Record<string, string>;
  /**
   * Requested attribute → its value, or `null` when the element does not carry
   * it. Content-bearing values are §4.6-scrubbed. Present iff attributes were
   * requested.
   */
  attributes?: Record<string, string | null>;
  /** Requested names the read could not answer. `[]` says every name was read. */
  unmeasured: ProjectionUnmeasured[];
}

/**
 * Thrown by {@link parseProjectionRequest} for a request it refuses. Each
 * transport answers it with `UB-VALIDATION-ERROR` (the find filter re-throws it
 * as a `FindRefusalError`).
 */
export class ProjectionRequestError extends Error {
  readonly code = 'UB-VALIDATION-ERROR' as const;
  /** The request option at fault. */
  readonly option: 'properties' | 'attributes';

  constructor(option: 'properties' | 'attributes', detail: string) {
    super(detail);
    this.name = 'ProjectionRequestError';
    this.option = option;
  }
}

/** Is `err` a {@link ProjectionRequestError}? Checks the name, so it is bundle-safe. */
export function isProjectionRequestError(err: unknown): err is ProjectionRequestError {
  return err instanceof Error && err.name === 'ProjectionRequestError';
}

/** A standard property name, or its CSSOM camel-cased attribute: ASCII ident, no escapes. */
const STANDARD_PROPERTY = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;
/**
 * A custom property: `--` then one or more ident code points (non-ASCII
 * included — an astral one is its two surrogate units), no escapes.
 */
const CUSTOM_PROPERTY = /^--[A-Za-z0-9_\-\u0080-\uffff]+$/;
/** An ARIA attribute name. */
const ARIA_ATTRIBUTE = /^aria-[a-z]+$/;

/**
 * Attributes whose values are structure, not page content, so §4.6 leaves them
 * readable inside a boundary: the ones a redacted element already ships (`id`,
 * `role`), the language and direction, and the ARIA states and properties whose
 * values are tokens, booleans or numbers — the ARIA ones only while the value
 * has that shape ({@link STRUCTURAL_ARIA_VALUE}). Every other projectable
 * attribute is scrubbed.
 */
const STRUCTURAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'lang',
  'dir',
  'id',
  'role',
  'aria-atomic',
  'aria-autocomplete',
  'aria-busy',
  'aria-checked',
  'aria-colcount',
  'aria-colindex',
  'aria-colspan',
  'aria-current',
  'aria-disabled',
  'aria-dropeffect',
  'aria-expanded',
  'aria-grabbed',
  'aria-haspopup',
  'aria-hidden',
  'aria-invalid',
  'aria-level',
  'aria-live',
  'aria-modal',
  'aria-multiline',
  'aria-multiselectable',
  'aria-orientation',
  'aria-posinset',
  'aria-pressed',
  'aria-readonly',
  'aria-relevant',
  'aria-required',
  'aria-rowcount',
  'aria-rowindex',
  'aria-rowspan',
  'aria-selected',
  'aria-setsize',
  'aria-sort',
  'aria-valuemax',
  'aria-valuemin',
]);

/**
 * The shape a structural ARIA value has: one or more lower-case tokens
 * (`true`, `page`, `additions text`) or a number (`3`, `-0.5`). The attribute
 * name says the slot holds a token; the value is what the author put there,
 * so a value of any other shape is read as the text it is.
 */
const STRUCTURAL_ARIA_VALUE = /^(?:[a-z]+(?:\s+[a-z]+)*|-?\d+(?:\.\d+)?)$/;

/** Is `raw`, the value of `attr` (lower-case), structure that passes a boundary? */
function isStructuralValue(attr: string, raw: string): boolean {
  if (!STRUCTURAL_ATTRIBUTES.has(attr)) return false;
  return !attr.startsWith('aria-') || STRUCTURAL_ARIA_VALUE.test(raw);
}

/** Is `name` (any case) an attribute a projection may read? */
export function isProjectableAttribute(name: string): boolean {
  const lc = name.toLowerCase();
  return PROJECTABLE_ATTRIBUTES.includes(lc) || ARIA_ATTRIBUTE.test(lc);
}

/** Is `name` a CSS property name a projection accepts (standard or custom)? */
export function isProjectablePropertyName(name: string): boolean {
  return (
    name.length <= MAX_PROJECTION_NAME_LENGTH &&
    (CUSTOM_PROPERTY.test(name) || STANDARD_PROPERTY.test(name))
  );
}

/**
 * The CSS name to read for a requested property name. A custom property and a
 * hyphenated name are read as written. A name with an upper-case letter is read
 * as a CSSOM camel-cased attribute, the spelling `ElementState.computedStyles`
 * uses: `borderTopColor` → `border-top-color`, `webkitLineClamp` →
 * `-webkit-line-clamp`, `cssFloat` → `float`.
 */
export function cssPropertyName(name: string): string {
  if (name.startsWith('--') || !/[A-Z]/.test(name)) return name;
  if (name === 'cssFloat') return 'float';
  const kebab = name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  return kebab.startsWith('webkit-') ? `-${kebab}` : kebab;
}

/**
 * Normalise one list from a request. `form: 'body'` takes an array of strings
 * (a JSON body); `form: 'query'` also takes the URL-query encoding of the same
 * list — a comma-separated string, or an array of them (a repeated key) — and
 * trims each entry. `null` / `undefined` is "not asked".
 */
function readNameList(
  option: 'properties' | 'attributes',
  raw: unknown,
  form: 'body' | 'query'
): string[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  let names: string[];
  if (form === 'query' && typeof raw === 'string') {
    names = raw.split(',');
  } else if (Array.isArray(raw)) {
    names = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        throw new ProjectionRequestError(
          option,
          `\`${option}\` must be an array of strings, got an entry of type ${typeof entry}`
        );
      }
      if (form === 'query') names.push(...entry.split(','));
      else names.push(entry);
    }
  } else {
    throw new ProjectionRequestError(
      option,
      form === 'query'
        ? `\`${option}\` must be a comma-separated list of names, got ${typeof raw}`
        : `\`${option}\` must be an array of strings, got ${typeof raw}`
    );
  }
  if (form === 'query') names = names.map((n) => n.trim()).filter((n) => n !== '');
  const unique = [...new Set(names)];
  if (unique.length > MAX_PROJECTED_NAMES) {
    throw new ProjectionRequestError(
      option,
      `\`${option}\` names ${unique.length} entries; at most ${MAX_PROJECTED_NAMES} are read per request`
    );
  }
  return unique;
}

/**
 * Validate the projection options of a request (`properties`, `attributes`)
 * and return what to read, or `undefined` when neither was asked for (or both
 * lists are empty).
 *
 * @throws {ProjectionRequestError} for a request that breaks the grammar, the
 *   allow-list or a bound — see the module doc.
 */
export function parseProjectionRequest(
  raw: { properties?: unknown; attributes?: unknown } | null | undefined,
  form: 'body' | 'query' = 'body'
): ElementProjectionRequest | undefined {
  if (!raw) return undefined;
  const properties = readNameList('properties', raw.properties, form);
  const attributes = readNameList('attributes', raw.attributes, form);
  for (const [option, names] of [
    ['properties', properties],
    ['attributes', attributes],
  ] as const) {
    for (const name of names ?? []) {
      if (name.length > MAX_PROJECTION_NAME_LENGTH) {
        throw new ProjectionRequestError(
          option,
          `\`${option}\` entry is ${name.length} characters long; at most ${MAX_PROJECTION_NAME_LENGTH} are accepted`
        );
      }
    }
  }
  for (const name of properties ?? []) {
    if (!isProjectablePropertyName(name)) {
      throw new ProjectionRequestError(
        'properties',
        `\`properties\` entry ${JSON.stringify(name)} is not a CSS property name ` +
          '(a CSS ident such as `border-top-color`, or a custom property such as `--brand`)'
      );
    }
  }
  for (const name of attributes ?? []) {
    if (!isProjectableAttribute(name)) {
      throw new ProjectionRequestError(
        'attributes',
        `\`attributes\` entry ${JSON.stringify(name)} is not readable: ` +
          `a projection reads only ${PROJECTABLE_ATTRIBUTES.join(', ')} and aria-* attributes`
      );
    }
  }
  const request: ElementProjectionRequest = {
    ...(properties && properties.length > 0 ? { properties } : {}),
    ...(attributes && attributes.length > 0 ? { attributes } : {}),
  };
  return request.properties || request.attributes ? request : undefined;
}

/** A value that can carry page content: a `<string>` token or a `url()`. */
const CONTENT_BEARING_VALUE = /["']|url\(/i;

/**
 * Properties whose computed value names something the author chose, as an
 * unquoted ident: a font (`font-family: Order4711`), a counter, an animation
 * or a timeline, an anchor, a container, a view transition, a grid area. Such
 * a name is the author's data, not the style vocabulary, and a page that
 * derives it from a record (one `view-transition-name` per order row) puts the
 * record in it. Inside a boundary they are scrubbed whatever the value holds,
 * and so are the shorthands that serialize them (`font`, `animation`,
 * `container`, the timelines) and `quotes`. A vendor alias
 * (`-webkit-animation-name`) reads the same value and is matched without its
 * prefix.
 */
const AUTHOR_NAMED_PROPERTIES: ReadonlySet<string> = new Set([
  'font-family',
  'font',
  'counter-reset',
  'counter-set',
  'counter-increment',
  'animation-name',
  'animation',
  'animation-timeline',
  'scroll-timeline-name',
  'scroll-timeline',
  'view-timeline-name',
  'view-timeline',
  'timeline-scope',
  'view-transition-name',
  'view-transition-class',
  'anchor-name',
  'position-anchor',
  'anchor-scope',
  'container-name',
  'container',
  'grid-template-areas',
  'quotes',
]);

/**
 * Does `cssName` — a standard property as `cssPropertyName` spells it, so
 * lower-case — name author data, with or without a vendor prefix?
 */
function isAuthorNamedProperty(cssName: string): boolean {
  return AUTHOR_NAMED_PROPERTIES.has(cssName.replace(/^-(?:webkit|moz|ms|o)-/, ''));
}

function unmeasuredAll(
  out: ProjectionUnmeasured[],
  kind: ProjectionUnmeasured['kind'],
  names: readonly string[],
  code: UnknownCode,
  detail: string
): void {
  for (const name of names) out.push({ kind, name, code, detail });
}

function readProperties(
  node: Element | null | undefined,
  names: readonly string[],
  values: Record<string, string>,
  unmeasured: ProjectionUnmeasured[],
  redacted: Set<string>
): void {
  if (!node) {
    unmeasuredAll(
      unmeasured,
      'property',
      names,
      'capability_unavailable_in_build',
      'this row carries no DOM node to compute a style from'
    );
    return;
  }
  if (!node.isConnected) {
    unmeasuredAll(
      unmeasured,
      'property',
      names,
      'input_missing',
      'the element is not in the document, so it has no computed style'
    );
    return;
  }
  const view = node.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') {
    unmeasuredAll(
      unmeasured,
      'property',
      names,
      'capability_unavailable_in_build',
      'this environment has no getComputedStyle'
    );
    return;
  }
  let computed: CSSStyleDeclaration;
  try {
    computed = view.getComputedStyle(node);
  } catch (err) {
    unmeasuredAll(
      unmeasured,
      'property',
      names,
      'producer_failed',
      `getComputedStyle threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  const verdict = verdictOf(node as HTMLElement);
  for (const name of names) {
    const cssName = cssPropertyName(name);
    const custom = cssName.startsWith('--');
    const raw = custom
      ? computed.getPropertyValue(cssName).trim()
      : computed.getPropertyValue(cssName);
    if (raw === '') {
      unmeasured.push(
        custom
          ? {
              kind: 'property',
              name,
              code: 'input_missing',
              detail: `custom property \`${cssName}\` is not set on this element`,
            }
          : {
              kind: 'property',
              name,
              code: 'capability_unavailable_in_build',
              detail:
                `the engine computes no value for \`${cssName}\` ` +
                '(an unsupported or misspelled property, or a shorthand it does not serialize)',
            }
      );
      continue;
    }
    if (custom || isAuthorNamedProperty(cssName) || CONTENT_BEARING_VALUE.test(raw)) {
      values[name] = scrubContentByVerdict(raw, verdict)!;
      if (verdict.content) redacted.add(name);
    } else {
      values[name] = raw;
    }
  }
}

function readAttributes(
  node: Element | null | undefined,
  names: readonly string[],
  values: Record<string, string | null>,
  unmeasured: ProjectionUnmeasured[],
  redacted: Set<string>
): void {
  if (!node) {
    unmeasuredAll(
      unmeasured,
      'attribute',
      names,
      'capability_unavailable_in_build',
      'this row carries no DOM node to read an attribute from'
    );
    return;
  }
  const verdict = verdictOf(node as HTMLElement);
  for (const name of names) {
    const attr = name.toLowerCase();
    const raw = node.getAttribute(attr);
    if (raw === null) {
      values[name] = null;
    } else if (raw === '' || isStructuralValue(attr, raw)) {
      // An empty value carries no content (`alt=""` is the decorative-image
      // signal, kept distinct from an absent alt).
      values[name] = raw;
    } else {
      values[name] = scrubContentByVerdict(raw, verdict)!;
      if (verdict.content) redacted.add(name);
    }
  }
}

/**
 * A projection plus which of its values §4.6 replaced. A name in `redacted`
 * reads `REDACTED_VALUE` in the value map: the redaction sentinel, not a
 * reading of the page. The wire carries the sentinel as is; a caller that
 * JUDGES a value (the `ai/assert` checks) must not take it for one.
 */
export interface DetailedElementProjection {
  projection: ElementProjection;
  redacted: {
    /** Requested property names whose value was redacted. */
    properties: ReadonlySet<string>;
    /** Requested attribute names whose value was redacted. */
    attributes: ReadonlySet<string>;
  };
}

/**
 * Read `request` off `node`, and say which values §4.6 redacted — see
 * {@link projectElement}.
 */
export function projectElementDetailed(
  node: Element | null | undefined,
  request: ElementProjectionRequest
): DetailedElementProjection {
  const unmeasured: ProjectionUnmeasured[] = [];
  const projection: ElementProjection = { unmeasured };
  const redacted = { properties: new Set<string>(), attributes: new Set<string>() };
  if (request.properties && request.properties.length > 0) {
    const values: Record<string, string> = {};
    readProperties(node, request.properties, values, unmeasured, redacted.properties);
    projection.properties = values;
  }
  if (request.attributes && request.attributes.length > 0) {
    const values: Record<string, string | null> = {};
    readAttributes(node, request.attributes, values, unmeasured, redacted.attributes);
    projection.attributes = values;
  }
  return { projection, redacted };
}

/**
 * Read `request` off `node` — see the module doc for what each name answers.
 * `node` is the row's live element; `null` / `undefined` (a DOM-less row) puts
 * every requested name in `unmeasured`.
 */
export function projectElement(
  node: Element | null | undefined,
  request: ElementProjectionRequest
): ElementProjection {
  return projectElementDetailed(node, request).projection;
}

/** `node` as an `Element` when it is one (a registry row's `.element`, a scan row's node). */
export function liveElementOf(node: unknown): Element | undefined {
  return typeof Element !== 'undefined' && node instanceof Element ? node : undefined;
}
