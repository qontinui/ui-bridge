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
 *     document (`input_missing`, for properties and attributes alike: it has
 *     no computed style, and the redaction boundary it sat in can no longer be
 *     seen from it), a custom property the element does not set
 *     (`input_missing`), an engine that computes no value for the name
 *     (`capability_unavailable_in_build`: an unsupported or misspelled
 *     property, or a shorthand it does not serialize). An empty string is never
 *     reported as a value: "could not look" must not read as "looked, and it
 *     was empty".
 *
 * §4.6 redaction. Inside a `data-bridge-redact` boundary the CONTENT axis of
 * the element's verdict scrubs every value that can carry page content, through
 * the package's one scrub shape (`scrubContentByVerdict`):
 *   - attributes: everything except a structural value — `id`, `role`, a
 *     language tag in `lang`, `ltr` / `rtl` / `auto` in `dir`, and an ARIA
 *     state or property holding one of its own tokens (`aria-invalid` →
 *     `true`, `false`, `grammar` or `spelling`) or, for a numeric one
 *     (`aria-level`, `aria-setsize`, …), a number. The shape is checked, not
 *     just the name: `aria-invalid="Card 4111 declined"` is scrubbed like free
 *     text. Free text (`title`, `alt`, `aria-label`, `aria-valuetext`, …),
 *     URLs (`href`), ID references (`aria-labelledby`, …) and any ARIA name
 *     not known to be a token are scrubbed. So are the range values
 *     `aria-valuenow`, `aria-valuemin` and `aria-valuemax`, numbers or not: a
 *     range bound can be page data (an available balance, a credit limit);
 *   - properties: a custom property (author data of any shape), any value
 *     carrying a `<string>` or a `url()` (`content`, `background-image`, …),
 *     and every property whose value names something the author chose — a
 *     font, a counter, an animation, an anchor, a container, a view transition
 *     — as an unquoted ident (`AUTHOR_NAMED_PROPERTIES`). The style vocabulary
 *     itself — colours, lengths, keywords, numbers — carries no page content
 *     and passes, so a contrast or border check still works inside a boundary.
 * Every name whose value was scrubbed is listed in the projection's `redacted`,
 * so no reader has to tell the sentinel from a page that literally says
 * `[REDACTED]`.
 *
 * This module is enrolled in the redaction-surface projection list
 * (`eslint.config.js`, `redaction-surface.manifest.json`).
 */

import type { UnknownCode } from '../observation/observation';
import { scrubContentByVerdict, verdictOf } from './redaction';

/**
 * At most this many names per list (`properties`, `attributes`).
 *
 * Why 32: an `ai/assert` style or attribute check reads one name, so the cap
 * is not sized to a check; it bounds the RESPONSE. A find answers one
 * projection per returned row, so 32 names over a few hundred rows stays at a
 * few hundred KB, well inside the relay's command budget and its 10 MB body
 * ceiling. A caller that needs more asks again with the next names.
 */
export const MAX_PROJECTED_NAMES = 32;

/**
 * At most this many characters per name. The longest standard property is
 * under 40 characters; 128 leaves room for long design-token names while
 * keeping a refused request's echo short.
 */
export const MAX_PROJECTION_NAME_LENGTH = 128;

/**
 * The attributes a projection may read, besides the `aria-*` family. Frozen:
 * this list IS the allow-list {@link isProjectableAttribute} checks, so a
 * consumer that pushed onto it would widen what every transport reads.
 */
export const PROJECTABLE_ATTRIBUTES: readonly string[] = Object.freeze([
  'lang',
  'dir',
  'id',
  'role',
  'title',
  'alt',
  'href',
]);

/**
 * The request options that ask for a projection. Over HTTP they are also the
 * query keys of `GET /control/element/:id/state`, where each is a LIST: a
 * comma-separated value, a repeated key, or both (`server/request-query.ts`).
 */
export const PROJECTION_OPTIONS: readonly ('properties' | 'attributes')[] = Object.freeze([
  'properties',
  'attributes',
] as const);

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

/** A requested name whose value the §4.6 scrub replaced with the redaction sentinel. */
export interface ProjectionRedacted {
  /** Which list the name came from. */
  kind: 'property' | 'attribute';
  /** The name as requested. */
  name: string;
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
  /**
   * Requested names whose value in the maps above is the §4.6 sentinel
   * (`REDACTED_VALUE`, `"[REDACTED]"`) and not the page's own: the element sits
   * in a `data-bridge-redact` boundary and the value can carry page content.
   * The value was read and withheld, so a reader that judges it (the
   * `ai/assert` checks) treats it as unmeasured, never as what the page holds.
   * Present iff at least one value was scrubbed — the omission rule of
   * `ElementState.redaction` (absent = nothing redacted).
   */
  redacted?: ProjectionRedacted[];
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

/** Is a value one of `tokens` (ASCII case-insensitive, surrounding whitespace ignored)? */
function oneOf(...tokens: string[]): (value: string) => boolean {
  const set = new Set(tokens);
  return (value) => set.has(value.trim().toLowerCase());
}

/** Is a value a space-separated list of `tokens` — at least one, and nothing else? */
function listOf(...tokens: string[]): (value: string) => boolean {
  const set = new Set(tokens);
  return (value) => {
    const items = value.trim().toLowerCase().split(/\s+/);
    return items[0] !== '' && items.every((item) => set.has(item));
  };
}

/** A number, as ARIA's numeric states and properties take one (`2`, `-1`, `0.5`, `1e3`). */
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const isNumber = (value: string): boolean => NUMBER.test(value.trim());

/** A BCP 47 language tag's shape: an alphabetic primary subtag, then hyphenated subtags. */
const LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;
const isLanguageTag = (value: string): boolean => LANGUAGE_TAG.test(value.trim());

const BOOLEAN = oneOf('true', 'false');
const BOOLEAN_OR_UNDEFINED = oneOf('true', 'false', 'undefined');
const TRISTATE = oneOf('true', 'false', 'mixed', 'undefined');

/**
 * Attributes whose values are structure, not page content, so §4.6 leaves them
 * readable inside a boundary — each with the SHAPE its value must have to count
 * as structure: the ones a redacted element already ships (`id`, `role`, any
 * value), the language (a language tag) and direction (`ltr`, `rtl`, `auto`),
 * and the ARIA states and properties whose values are tokens, booleans or
 * numbers (ARIA 1.2's value sets). A value of any other shape is scrubbed like
 * free text: the name alone says nothing about what a page put in it
 * (`aria-invalid="Card 4111 declined"`). Every other projectable attribute is
 * scrubbed whatever its value — the range values `aria-valuenow`,
 * `aria-valuemin` and `aria-valuemax` included: they are numbers, but a range
 * bound is page data as readily as the current value (an available balance, a
 * credit limit).
 */
const STRUCTURAL_ATTRIBUTES: ReadonlyMap<string, (value: string) => boolean> = new Map([
  ['id', () => true],
  ['role', () => true],
  ['lang', isLanguageTag],
  ['dir', oneOf('ltr', 'rtl', 'auto')],
  ['aria-atomic', BOOLEAN],
  ['aria-autocomplete', oneOf('inline', 'list', 'both', 'none')],
  ['aria-busy', BOOLEAN],
  ['aria-checked', TRISTATE],
  ['aria-colcount', isNumber],
  ['aria-colindex', isNumber],
  ['aria-colspan', isNumber],
  ['aria-current', oneOf('page', 'step', 'location', 'date', 'time', 'true', 'false')],
  ['aria-disabled', BOOLEAN],
  ['aria-dropeffect', listOf('copy', 'execute', 'link', 'move', 'none', 'popup')],
  ['aria-expanded', BOOLEAN_OR_UNDEFINED],
  ['aria-grabbed', BOOLEAN_OR_UNDEFINED],
  ['aria-haspopup', oneOf('false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog')],
  ['aria-hidden', BOOLEAN_OR_UNDEFINED],
  ['aria-invalid', oneOf('grammar', 'false', 'spelling', 'true')],
  ['aria-level', isNumber],
  ['aria-live', oneOf('assertive', 'off', 'polite')],
  ['aria-modal', BOOLEAN],
  ['aria-multiline', BOOLEAN],
  ['aria-multiselectable', BOOLEAN],
  ['aria-orientation', oneOf('horizontal', 'vertical', 'undefined')],
  ['aria-posinset', isNumber],
  ['aria-pressed', TRISTATE],
  ['aria-readonly', BOOLEAN],
  ['aria-relevant', listOf('additions', 'all', 'removals', 'text')],
  ['aria-required', BOOLEAN],
  ['aria-rowcount', isNumber],
  ['aria-rowindex', isNumber],
  ['aria-rowspan', isNumber],
  ['aria-selected', BOOLEAN_OR_UNDEFINED],
  ['aria-setsize', isNumber],
  ['aria-sort', oneOf('ascending', 'descending', 'none', 'other')],
]);

/** Is `raw` a structural value of attribute `attr` (lower-case) — see {@link STRUCTURAL_ATTRIBUTES}? */
function isStructuralValue(attr: string, raw: string): boolean {
  const shape = STRUCTURAL_ATTRIBUTES.get(attr);
  return shape !== undefined && shape(raw);
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
 * A vendor prefix as the leading word of a CSSOM attribute: `WebkitLineClamp`,
 * `MozAppearance`, `MsTransform`, and the webkit-cased `webkitLineClamp`.
 */
const VENDOR_ATTRIBUTE_PREFIX = /^(Webkit|Moz|Ms|webkit)(?=[A-Z])/;

/**
 * The CSS name to read for a requested property name.
 *   - A custom property is read as written: its name is case-sensitive.
 *   - A hyphenated name is a CSS name, and CSS property names are ASCII
 *     case-insensitive, so it is read lower-cased: `Border-Top-Color` →
 *     `border-top-color`. Camel-converting it would read `-border--top--color`,
 *     a property no engine computes. So is a name with no lower-case letter
 *     (`COLOR` → `color`).
 *   - Only a name with no hyphen can be a CSSOM camel-cased attribute, the
 *     spelling `ElementState.computedStyles` uses, and one with an upper-case
 *     letter is read as one: `borderTopColor` → `border-top-color`,
 *     `cssFloat` → `float`. A leading capital is a vendor prefix only for
 *     `Webkit`, `Moz` and `Ms` (`WebkitLineClamp` → `-webkit-line-clamp`,
 *     `MozAppearance` → `-moz-appearance`, like the webkit-cased
 *     `webkitLineClamp`); any other is a capitalised name, read with its first
 *     letter lower-cased (`Opacity` → `opacity`, `BorderTopColor` →
 *     `border-top-color`) — not `-opacity`, which no engine computes.
 */
export function cssPropertyName(name: string): string {
  if (name.startsWith('--')) return name;
  if (name.includes('-') || !/[a-z]/.test(name)) return name.toLowerCase();
  if (!/[A-Z]/.test(name)) return name;
  const vendor = VENDOR_ATTRIBUTE_PREFIX.exec(name)?.[1];
  const attribute = vendor ? name.slice(vendor.length) : name[0].toLowerCase() + name.slice(1);
  if (!vendor && attribute === 'cssFloat') return 'float';
  const kebab = attribute.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  return vendor ? `-${vendor.toLowerCase()}${kebab}` : kebab;
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
  redacted: ProjectionRedacted[]
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
      // `raw` is non-empty, so a content verdict is exactly what replaced it.
      if (verdict.content) redacted.push({ kind: 'property', name });
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
  redacted: ProjectionRedacted[]
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
  // A node out of the document has lost its ancestors: `verdictOf` walks
  // `parentElement`, so it can no longer see a `data-bridge-redact` boundary
  // the node sat in, and every value would read as unredacted. Not read, as
  // the property arm reads no computed style off such a node.
  if (!node.isConnected) {
    unmeasuredAll(
      unmeasured,
      'attribute',
      names,
      'input_missing',
      'the element is not in the document, so the redaction boundary it sat in cannot be seen from it'
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
      // `raw` is non-empty, so a content verdict is exactly what replaced it.
      if (verdict.content) redacted.push({ kind: 'attribute', name });
    }
  }
}

/**
 * Read `request` off `node` — see the module doc for what each name answers.
 * `node` is the row's live element; `null` / `undefined` (a DOM-less row) puts
 * every requested name in `unmeasured`. A value the §4.6 scrub replaced is
 * named in `redacted`, from the verdict that replaced it — never by comparing
 * the value with the sentinel.
 */
export function projectElement(
  node: Element | null | undefined,
  request: ElementProjectionRequest
): ElementProjection {
  const unmeasured: ProjectionUnmeasured[] = [];
  const redacted: ProjectionRedacted[] = [];
  const projection: ElementProjection = { unmeasured };
  if (request.properties && request.properties.length > 0) {
    const values: Record<string, string> = {};
    readProperties(node, request.properties, values, unmeasured, redacted);
    projection.properties = values;
  }
  if (request.attributes && request.attributes.length > 0) {
    const values: Record<string, string | null> = {};
    readAttributes(node, request.attributes, values, unmeasured, redacted);
    projection.attributes = values;
  }
  if (redacted.length > 0) projection.redacted = redacted;
  return projection;
}

/** `node` as an `Element` when it is one (a registry row's `.element`, a scan row's node). */
export function liveElementOf(node: unknown): Element | undefined {
  return typeof Element !== 'undefined' && node instanceof Element ? node : undefined;
}
