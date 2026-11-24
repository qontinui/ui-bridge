/**
 * The density core's documents: `ui-bridge/density-capture@1` (one text-free
 * capture per cell) and `ui-bridge/density-targets@1` (the audience profile
 * made executable). Types, and the parsers that turn untrusted JSON into them.
 *
 * A parser answers the typed value or the list of every problem it found, each
 * naming its JSON path (`$.roles[0].asks[2].weight`). An unknown key is a
 * problem — it is refused, never dropped, because a key the reader does not know
 * is most often a key the writer misspelled, and dropping it would silently
 * change what the document says.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change
 * (Phase 1). The design section "Inputs" is the source of every field.
 */

import { isUnknownCode, type UnknownCode } from '../observation/observation';
import type { DensityShape } from './shape';

// ============================================================================
// Identifiers
// ============================================================================

/** Schema id of a capture document. */
export const DENSITY_CAPTURE_SCHEMA = 'ui-bridge/density-capture@1' as const;
/** Schema id of a targets document. */
export const DENSITY_TARGETS_SCHEMA = 'ui-bridge/density-targets@1' as const;
/** The producer id on every door that runs the density core (D-E). */
export const DENSITY_PRODUCER_ID = 'sdk/density' as const;

/**
 * Who is running the core. Required by every entry point (plan D-E): the core
 * is copied into more than one package, so it cannot know its own version, and
 * must not claim the SDK's when headless ran it.
 */
export interface DensityProducer {
  id: typeof DENSITY_PRODUCER_ID;
  /** The version of the package that ran the core. */
  version: string;
  /** That package's name, e.g. `@qontinui/ui-bridge-headless`. Carried in `provenance.source.package`. */
  package: string;
}

// ============================================================================
// Capture
// ============================================================================

export type DensityLandmark = 'banner' | 'navigation' | 'main' | 'contentinfo' | 'complementary';
const DENSITY_LANDMARKS: readonly DensityLandmark[] = [
  'banner',
  'navigation',
  'main',
  'contentinfo',
  'complementary',
];

/** `null` on an item: not visible, and the snapshot gave no reason. */
export type DensityVisibility = 'rendered' | 'occluded' | 'hidden' | 'no-layout';
const DENSITY_VISIBILITIES: readonly DensityVisibility[] = [
  'rendered',
  'occluded',
  'hidden',
  'no-layout',
];

const DENSITY_SHAPES: readonly DensityShape[] = [
  'number',
  'date',
  'currency',
  'identifier',
  'text',
];

/** A rectangle in DOCUMENT space: `y` is the viewport `y` plus `scrollY`. */
export interface DensityRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One registered element, text-free. Every `null` is a statement that the
 * value is not known, never a zero.
 */
export interface DensityItem {
  id: string;
  /** The registered parent's id; `null` at a root, or while `structureResolved` is false. */
  parent: string | null;
  /**
   * Ancestor tags, outermost first, as far as the xpath knows them: every
   * ancestor for a chain from the document root, those below the anchor for a
   * chain anchored at an unregistered id; `null` when the xpath gives none.
   * `*` stands for an ancestor whose tag the xpath does not name.
   */
  path: string[] | null;
  /**
   * Where `parent` was read from: the xpath chain, or geometry (the smallest
   * registered rect containing the item) when the xpath gives no registered
   * ancestor to anchor on. Before structure is resolved it says only whether
   * the item has an xpath.
   */
  structureBy: 'xpath' | 'geometry';
  /** Lower-cased tag name; `''` when the snapshot carried none (counted under coverage `tag`). */
  tag: string;
  role: string | null;
  interactive: boolean;
  /**
   * Carries an author-declared id: a `hook` registration, `data-ui-bridge-content`
   * or `data-ui-bridge-test-id`. On an `auto` row the `data-ui-bridge-id` stamp is
   * not evidence, because the auto-registrar stamps every element it registers;
   * a row with no `origin` (an older serializer) falls back to the stamp.
   */
  authorId: boolean;
  landmark: DensityLandmark | null;
  /** Document-space rect; `null` when the snapshot carried none (coverage `rect`). */
  rect: DensityRect | null;
  visibility: DensityVisibility | null;
  /** Code points of the whitespace-collapsed text; `null` inside a redaction boundary. */
  chars: number | null;
  /** `chars` minus the registered children's, not below 0; `null` when a term is, or until structure is resolved. */
  ownChars: number | null;
  /**
   * Opaque key of the nearest `section`, `article`, `aside`, `form`,
   * `fieldset`, `table` or `dialog` ancestor-or-self in the xpath chain: items
   * that share it share a block by path. Built from tags, sibling indices and
   * the anchor's id or test id; it holds no page text. `null` when the chain
   * has none, or until structure is resolved.
   */
  blockKey: string | null;
  /**
   * Opaque key of the item's parent ELEMENT in the xpath chain, registered or
   * not: items that share it are DOM siblings. Built from tags, sibling indices
   * and the anchor's id or test id; it holds no page text. `null` for an
   * own-id xpath, a chain of one segment, a chain through a key several items
   * claim, or until structure is resolved. Optional on read, where absence is
   * `null`.
   */
  siblingKey: string | null;
  /**
   * Opaque key shared by items that sit at the same place inside repeated,
   * UNREGISTERED ancestors (`ul > li[k] > a` with only the links registered,
   * `tr[k] > td[j]` with only the cells): the key of the repeated row
   * position (`ul/li[*]`) of its deepest unregistered `li` or `tr` ancestor,
   * for the registered item nearest that row (whatever its tag). Holds no page text. `null` when no such ancestor exists, when that
   * ancestor is registered (its own rows are the repeat), for an own-id xpath
   * or an ambiguous chain, or until structure is resolved. Optional on read.
   */
  cousinKey: string | null;
  /**
   * With `cousinKey`: the key of the repeated row the item sits in (the
   * unregistered `li` / `tr`), so that cousins are counted in their rows rather
   * than by their tops. `null` exactly when `cousinKey` is. Optional on read.
   */
  cousinRowKey: string | null;
  /** SHA-256 hex of the collapsed text; `null` when the text is redacted or empty. */
  textHash: string | null;
  shape: DensityShape | null;
  fontPx: number | null;
  /** `null` for `line-height: normal`, and when no computed style was carried. */
  lineHeightPx: number | null;
  /** Computed `position`. */
  position: string | null;
  /** `scrollWidth > clientWidth + 1` with `overflow` not `visible`; `null` when unmeasurable. */
  truncated: boolean | null;
  /** The full form is reachable (a `title`, an `abbr`, an expansion); `null` when there is no evidence either way. */
  recoverable: boolean | null;
  /** `aria-expanded`, when stated. */
  expanded: boolean | null;
  /** The id this item controls or toggles, from the snapshot's relationships. */
  controls: string | null;
  /**
   * `aria-selected`, when stated (a tab, an option, a list row). `null` when the
   * snapshot does not state it; optional on read, where absence is `null`.
   */
  selected: boolean | null;
  /**
   * The id whose content this item narrows, from a declared `filters` edge of
   * the snapshot's relationships (search -> list). Optional on read, where
   * absence is `null`.
   */
  filters: string | null;
  /** SHA-256 hex of the `href`, never the URL itself. */
  href: string | null;
}

/** The page's viewport block, as the snapshot gave it. */
export interface DensityCaptureViewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  documentWidth: number;
  documentHeight: number;
  /** Which element the scroll fields were read from; `null` when the snapshot predates the field. */
  container: 'viewport' | 'body' | null;
}

/** One combination of role, viewport and fixture. Every quantity belongs to one cell. */
export interface DensityCell {
  role: string | null;
  viewport: { width: number; height: number };
  fixture: string | null;
}

/** `reprojected`: the snapshot was taken scrolled, and the fold is computed from document space. */
export type DensityFoldBasis = 'measured' | 'reprojected';
/** `registered-only`: a pinned bar the app never registered is not in the snapshot. */
export type DensityPinBasis = 'registered-only' | 'measured';
/** `inner-scroller`: the page scrolls inside a nested element, and scroll quantities there are unknown. */
export type DensityScrollBasis = 'page' | 'inner-scroller';

/** Which sign put the capture on `scrollBasis: inner-scroller`. */
export type DensityScrollerEvidence =
  | { by: 'scroll-info'; id: string }
  | { by: 'overflowing-items'; count: number };

/**
 * Whether the snapshot's content cap bound. `unreported` is never "nothing was
 * dropped": the snapshot carried no count, and the number of content rows is
 * beside it so a reader can see how close to the cap it was.
 */
export type DensityContentCap =
  | { status: 'reported'; dropped: number }
  | { status: 'unreported'; contentRows: number };

/** The fields that say when a quantity is wrong. */
export interface DensityCaptureBases {
  foldBasis: DensityFoldBasis;
  pinBasis: DensityPinBasis;
  scrollBasis: DensityScrollBasis;
  /** `null` exactly when `scrollBasis` is `page`. */
  scroller: DensityScrollerEvidence | null;
  contentCap: DensityContentCap;
}

/** One dimension the adapter could not measure, how many items lacked it, and why. */
export interface DensityUnmeasured {
  dimension: string;
  count: number;
  code: UnknownCode;
}

/** The capture's coverage; the same shape as the `Observation` envelope's. */
export interface DensityCoverage {
  considered: number;
  measured: number;
  unmeasured: DensityUnmeasured[];
}

/** The role probe, as evaluated at capture time. */
export interface DensityProbeResult {
  role: string;
  id: string;
  matched: boolean;
}

/** What one `text` matcher matched at capture time. */
export interface DensityTextMatchRecord {
  /** Ids whose text satisfies the matcher's `text` field (its other fields are applied at resolution). */
  ids: string[];
  /** Items whose text could not be read (redacted), so a zero here is not an absence. */
  unevaluated: number;
}

/** The whole capture: one cell, text-free. */
export interface DensityCapture {
  schema: typeof DENSITY_CAPTURE_SCHEMA;
  /** `registered`: built from a snapshot of registered elements; `document` is the in-page walk (release 3). */
  scope: 'registered' | 'document';
  cell: DensityCell;
  viewport: DensityCaptureViewport;
  /** When the snapshot was taken (RFC 3339), or `null` when it carried no time. */
  observedAt: string | null;
  snapshotId: string | null;
  route: string | null;
  capturedBy: { package: string; version: string };
  bases: DensityCaptureBases;
  /**
   * Whether `parent`, `path`, `landmark`, `ownChars` and `blockKey` have been computed.
   * While false they are `null` because they were not computed, not because
   * the item is a root.
   */
  structureResolved: boolean;
  /**
   * Whether every item's `siblingKey`, `cousinKey` and `cousinRowKey` were
   * computed. A capture file written before Phase 4 carries none of them, and
   * its repeats are then unknown, never "none". Optional on read: when absent,
   * true exactly when every item carries all three keys.
   */
  repeatKeysResolved: boolean;
  coverage: DensityCoverage;
  probe: DensityProbeResult | null;
  /** Hash of the targets whose `text` matchers this capture evaluated, or `null`. */
  targetsHash: string | null;
  /** Keyed by the matcher's hash (`densityMatcherKey` in `match.ts`). */
  textMatches: Record<string, DensityTextMatchRecord>;
  items: DensityItem[];
}

// ============================================================================
// Targets
// ============================================================================

/** The kinds a `classify` rule may declare. `answer` and `uncovered` are ledger kinds, not item kinds. */
export type DensityItemKind =
  | 'chrome'
  | 'heading'
  | 'label'
  | 'value'
  | 'control'
  | 'prose'
  | 'media'
  | 'other';
const DENSITY_ITEM_KINDS: readonly DensityItemKind[] = [
  'chrome',
  'heading',
  'label',
  'value',
  'control',
  'prose',
  'media',
  'other',
];

/**
 * Selects items of a capture. Every given field must hold; at least one is
 * given. `text` holds when the item's collapsed text contains the collapsed
 * `text` (case-sensitive), and is evaluated at capture time because the
 * capture keeps no text. `within` holds when an item matched by it is an
 * ancestor.
 */
export interface DensityMatcher {
  ids?: string[];
  idPrefix?: string;
  /** `*` is any run of characters, `?` one character; the whole id must match. */
  idGlob?: string;
  role?: string;
  tag?: string;
  text?: string;
  within?: DensityMatcher;
}

export type DensityAskKind = 'state' | 'lookup' | 'action' | 'reference';
const DENSITY_ASK_KINDS: readonly DensityAskKind[] = ['state', 'lookup', 'action', 'reference'];

/** One thing a role comes to the page to find out or do. */
export interface DensityAsk {
  id: string;
  /** 1 is the most important. */
  rank: number;
  /** How often and how urgently the role brings this question to the surface. */
  weight: number;
  kind: DensityAskKind;
  question: string;
  /** The audience-profile sentence the ask rests on, verbatim. */
  source: { doc: string; quote: string };
  /** `null`: the author states nothing on the page answers this ask (it lists as unanswered). */
  answer: DensityMatcher | DensityMatcher[] | null;
  /** `any`: the first answering leaf answers; `all`: every one is needed, so the last decides. */
  need: 'any' | 'all';
  /** Declared steps before the answer, when the structure cannot show them. */
  via: string[];
  /** Characters typed into a find field to reach the answer. */
  findChars: number;
  /** The answer's expected form, for `fit`; `null` when not declared. */
  form: { rows: number; lines: number } | null;
}

/** Evidence that a snapshot was taken as this role: the item `id`'s text includes `includes`. */
export interface DensityRoleProbe {
  id: string;
  includes: string;
}

export interface DensityRole {
  role: string;
  probe: DensityRoleProbe | null;
  asks: DensityAsk[];
}

export interface DensityTargets {
  schema: typeof DENSITY_TARGETS_SCHEMA;
  surface: string;
  /** `audience_profile/<name>@<version>`. */
  profile: string;
  classify: Array<{ match: DensityMatcher; kind: DensityItemKind }>;
  blocks: Array<{ id: string; match: DensityMatcher }>;
  roles: DensityRole[];
  review: { reviewer: string; asksHash: string } | null;
}

// ============================================================================
// Parsing
// ============================================================================

/** One problem a parser found, at a JSON path. */
export interface DensityProblem {
  path: string;
  message: string;
}

export type DensityParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; problems: DensityProblem[] };

/** A small reader that records every problem instead of stopping at the first. */
class Reader {
  readonly problems: DensityProblem[] = [];

  fail(path: string, message: string): void {
    this.problems.push({ path, message });
  }

  /** An object with exactly the allowed keys; reports missing required keys and every unknown one. */
  object(
    value: unknown,
    path: string,
    required: readonly string[],
    optional: readonly string[] = []
  ): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.fail(path, 'must be an object');
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of required) {
      if (!(key in record)) this.fail(`${path}.${key}`, 'is required');
    }
    for (const key of Object.keys(record)) {
      if (!required.includes(key) && !optional.includes(key)) {
        this.fail(`${path}.${key}`, 'is not a known key');
      }
    }
    return record;
  }

  string(value: unknown, path: string, opts: { nonEmpty?: boolean } = {}): string {
    if (typeof value !== 'string') {
      this.fail(path, 'must be a string');
      return '';
    }
    if (opts.nonEmpty && value === '') this.fail(path, 'must not be empty');
    if (hasLoneSurrogate(value))
      this.fail(path, 'must not hold a lone surrogate (it has no UTF-8 form)');
    return value;
  }

  stringOrNull(value: unknown, path: string): string | null {
    if (value === null) return null;
    return this.string(value, path);
  }

  number(
    value: unknown,
    path: string,
    opts: { integer?: boolean; min?: number; exclusiveMin?: number } = {}
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(path, 'must be a finite number');
      return 0;
    }
    if (opts.integer && !Number.isSafeInteger(value)) this.fail(path, 'must be an integer');
    if (opts.min !== undefined && value < opts.min) this.fail(path, `must be at least ${opts.min}`);
    if (opts.exclusiveMin !== undefined && value <= opts.exclusiveMin) {
      this.fail(path, `must be greater than ${opts.exclusiveMin}`);
    }
    return value;
  }

  numberOrNull(
    value: unknown,
    path: string,
    opts: { integer?: boolean; min?: number } = {}
  ): number | null {
    if (value === null) return null;
    return this.number(value, path, opts);
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
      this.fail(path, 'must be a boolean');
      return false;
    }
    return value;
  }

  booleanOrNull(value: unknown, path: string): boolean | null {
    if (value === null) return null;
    return this.boolean(value, path);
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.fail(path, `must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`);
      return allowed[0];
    }
    return value as T;
  }

  oneOfOrNull<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | null {
    if (value === null) return null;
    return this.oneOf(value, path, allowed);
  }

  array<T>(value: unknown, path: string, each: (v: unknown, p: string) => T): T[] {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be an array');
      return [];
    }
    return value.map((v, i) => each(v, `${path}[${i}]`));
  }

  literal<T extends string>(value: unknown, path: string, expected: T): T {
    if (value !== expected) this.fail(path, `must be ${JSON.stringify(expected)}`);
    return expected;
  }

  /** Report every duplicate of `key(item)` in `items`. */
  unique<T>(items: T[], path: string, key: (item: T) => string, what: string): void {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const k = key(item);
      if (seen.has(k)) this.fail(`${path}[${i}]`, `duplicate ${what} ${JSON.stringify(k)}`);
      seen.add(k);
    });
  }

  result<T>(value: T): DensityParseResult<T> {
    return this.problems.length === 0
      ? { ok: true, value }
      : { ok: false, problems: this.problems.slice() };
  }
}

/**
 * `JSON.parse` accepts a lone surrogate (`"\ud800"`); the hash refuses one. A
 * parsed document must always be hashable, so the parser refuses it first.
 */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** An RFC 3339 date-time that is also a calendar-valid instant (no Feb 30, no hour 24). */
function isDensityRfc3339(text: string): boolean {
  const m = RFC3339.exec(text);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d > days) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return true;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function readRect(r: Reader, value: unknown, path: string): DensityRect | null {
  if (value === null) return null;
  const o = r.object(value, path, ['x', 'y', 'w', 'h']);
  if (!o) return null;
  return {
    x: r.number(o.x, `${path}.x`),
    y: r.number(o.y, `${path}.y`),
    w: r.number(o.w, `${path}.w`, { min: 0 }),
    h: r.number(o.h, `${path}.h`, { min: 0 }),
  };
}

function readHashOrNull(r: Reader, value: unknown, path: string): string | null {
  const s = r.stringOrNull(value, path);
  if (s !== null && !SHA256_HEX.test(s)) r.fail(path, 'must be a SHA-256 hex digest');
  return s;
}

const ITEM_KEYS = [
  'id',
  'parent',
  'path',
  'structureBy',
  'tag',
  'role',
  'interactive',
  'authorId',
  'landmark',
  'rect',
  'visibility',
  'chars',
  'ownChars',
  'textHash',
  'shape',
  'fontPx',
  'lineHeightPx',
  'position',
  'truncated',
  'recoverable',
  'expanded',
  'controls',
  'href',
] as const;

function readItem(r: Reader, value: unknown, path: string): DensityItem | null {
  const o = r.object(value, path, ITEM_KEYS, [
    'blockKey',
    'siblingKey',
    'cousinKey',
    'cousinRowKey',
    'selected',
    'filters',
  ]);
  if (!o) return null;
  return {
    id: r.string(o.id, `${path}.id`, { nonEmpty: true }),
    parent: r.stringOrNull(o.parent, `${path}.parent`),
    path: o.path === null ? null : r.array(o.path, `${path}.path`, (v, p) => r.string(v, p)),
    structureBy: r.oneOf(o.structureBy, `${path}.structureBy`, ['xpath', 'geometry'] as const),
    tag: r.string(o.tag, `${path}.tag`),
    role: r.stringOrNull(o.role, `${path}.role`),
    interactive: r.boolean(o.interactive, `${path}.interactive`),
    authorId: r.boolean(o.authorId, `${path}.authorId`),
    landmark: r.oneOfOrNull(o.landmark, `${path}.landmark`, DENSITY_LANDMARKS),
    rect: readRect(r, o.rect, `${path}.rect`),
    visibility: r.oneOfOrNull(o.visibility, `${path}.visibility`, DENSITY_VISIBILITIES),
    chars: r.numberOrNull(o.chars, `${path}.chars`, { integer: true, min: 0 }),
    ownChars: r.numberOrNull(o.ownChars, `${path}.ownChars`, { integer: true, min: 0 }),
    // Optional on read: a capture written before the structure pass carried
    // no `blockKey`, and its absence is the same statement as `null`.
    blockKey: o.blockKey === undefined ? null : r.stringOrNull(o.blockKey, `${path}.blockKey`),
    siblingKey:
      o.siblingKey === undefined ? null : r.stringOrNull(o.siblingKey, `${path}.siblingKey`),
    cousinKey: o.cousinKey === undefined ? null : r.stringOrNull(o.cousinKey, `${path}.cousinKey`),
    cousinRowKey:
      o.cousinRowKey === undefined ? null : r.stringOrNull(o.cousinRowKey, `${path}.cousinRowKey`),
    textHash: readHashOrNull(r, o.textHash, `${path}.textHash`),
    shape: r.oneOfOrNull(o.shape, `${path}.shape`, DENSITY_SHAPES),
    fontPx: r.numberOrNull(o.fontPx, `${path}.fontPx`, { min: 0 }),
    lineHeightPx: r.numberOrNull(o.lineHeightPx, `${path}.lineHeightPx`, { min: 0 }),
    position: r.stringOrNull(o.position, `${path}.position`),
    truncated: r.booleanOrNull(o.truncated, `${path}.truncated`),
    recoverable: r.booleanOrNull(o.recoverable, `${path}.recoverable`),
    expanded: r.booleanOrNull(o.expanded, `${path}.expanded`),
    controls: r.stringOrNull(o.controls, `${path}.controls`),
    // Optional on read: a capture written before Phase 4 carried neither, and
    // their absence is the same statement as `null` (not stated).
    selected: o.selected === undefined ? null : r.booleanOrNull(o.selected, `${path}.selected`),
    filters: o.filters === undefined ? null : r.stringOrNull(o.filters, `${path}.filters`),
    href: readHashOrNull(r, o.href, `${path}.href`),
  };
}

function readUnmeasured(r: Reader, value: unknown, path: string): DensityUnmeasured {
  const o = r.object(value, path, ['dimension', 'count', 'code']);
  if (!o) return { dimension: '', count: 0, code: 'input_missing' };
  const code = o.code;
  if (!isUnknownCode(code)) r.fail(`${path}.code`, 'must be an UnknownCode');
  return {
    dimension: r.string(o.dimension, `${path}.dimension`, { nonEmpty: true }),
    count: r.number(o.count, `${path}.count`, { integer: true, min: 0 }),
    code: isUnknownCode(code) ? code : 'input_missing',
  };
}

function readCoverage(r: Reader, value: unknown, path: string): DensityCoverage {
  const o = r.object(value, path, ['considered', 'measured', 'unmeasured']);
  if (!o) return { considered: 0, measured: 0, unmeasured: [] };
  const coverage = {
    considered: r.number(o.considered, `${path}.considered`, { integer: true, min: 0 }),
    measured: r.number(o.measured, `${path}.measured`, { integer: true, min: 0 }),
    unmeasured: r.array(o.unmeasured, `${path}.unmeasured`, (v, p) => readUnmeasured(r, v, p)),
  };
  if (coverage.measured > coverage.considered) {
    r.fail(`${path}.measured`, 'must not exceed considered');
  }
  return coverage;
}

function readBases(r: Reader, value: unknown, path: string): DensityCaptureBases {
  const o = r.object(value, path, [
    'foldBasis',
    'pinBasis',
    'scrollBasis',
    'scroller',
    'contentCap',
  ]);
  const fallback: DensityCaptureBases = {
    foldBasis: 'measured',
    pinBasis: 'registered-only',
    scrollBasis: 'page',
    scroller: null,
    contentCap: { status: 'unreported', contentRows: 0 },
  };
  if (!o) return fallback;
  const scrollBasis = r.oneOf(o.scrollBasis, `${path}.scrollBasis`, [
    'page',
    'inner-scroller',
  ] as const);
  let scroller: DensityScrollerEvidence | null = null;
  if (o.scroller !== null) {
    const s = r.object(o.scroller, `${path}.scroller`, ['by'], ['id', 'count']);
    if (s) {
      const by = r.oneOf(s.by, `${path}.scroller.by`, [
        'scroll-info',
        'overflowing-items',
      ] as const);
      if (by === 'scroll-info') {
        if ('count' in s)
          r.fail(`${path}.scroller.count`, 'is not a key of a scroll-info scroller');
        scroller = { by, id: r.string(s.id, `${path}.scroller.id`, { nonEmpty: true }) };
      } else {
        if ('id' in s)
          r.fail(`${path}.scroller.id`, 'is not a key of an overflowing-items scroller');
        scroller = {
          by,
          count: r.number(s.count, `${path}.scroller.count`, { integer: true, min: 1 }),
        };
      }
    }
  }
  if ((scrollBasis === 'page') !== (o.scroller === null)) {
    r.fail(`${path}.scroller`, 'must be null exactly when scrollBasis is "page"');
  }
  let contentCap: DensityContentCap = fallback.contentCap;
  const c = r.object(o.contentCap, `${path}.contentCap`, ['status'], ['dropped', 'contentRows']);
  if (c) {
    const status = r.oneOf(c.status, `${path}.contentCap.status`, [
      'reported',
      'unreported',
    ] as const);
    if (status === 'reported') {
      if ('contentRows' in c)
        r.fail(`${path}.contentCap.contentRows`, 'is not a key of a reported cap');
      contentCap = {
        status,
        dropped: r.number(c.dropped, `${path}.contentCap.dropped`, { integer: true, min: 0 }),
      };
    } else {
      if ('dropped' in c) r.fail(`${path}.contentCap.dropped`, 'is not a key of an unreported cap');
      contentCap = {
        status,
        contentRows: r.number(c.contentRows, `${path}.contentCap.contentRows`, {
          integer: true,
          min: 0,
        }),
      };
    }
  }
  return {
    foldBasis: r.oneOf(o.foldBasis, `${path}.foldBasis`, ['measured', 'reprojected'] as const),
    pinBasis: r.oneOf(o.pinBasis, `${path}.pinBasis`, ['registered-only', 'measured'] as const),
    scrollBasis,
    scroller,
    contentCap,
  };
}

const CAPTURE_KEYS = [
  'schema',
  'scope',
  'cell',
  'viewport',
  'observedAt',
  'snapshotId',
  'route',
  'capturedBy',
  'bases',
  'structureResolved',
  'coverage',
  'probe',
  'targetsHash',
  'textMatches',
  'items',
] as const;

/** Whether every item of a raw capture carries `siblingKey`, `cousinKey` and `cousinRowKey`. */
function itemsHaveRepeatKeys(items: unknown): boolean {
  return (
    Array.isArray(items) &&
    items.every(
      (i) =>
        i !== null &&
        typeof i === 'object' &&
        'siblingKey' in i &&
        'cousinKey' in i &&
        'cousinRowKey' in i
    )
  );
}

/** An explicit `repeatKeysResolved: true` must be true of every item. */
function readRepeatKeysResolved(r: Reader, value: unknown, items: unknown): boolean {
  const v = r.boolean(value, '$.repeatKeysResolved');
  if (v && !itemsHaveRepeatKeys(items)) {
    r.fail(
      '$.repeatKeysResolved',
      'is true, but an item lacks siblingKey, cousinKey or cousinRowKey'
    );
  }
  return v;
}

/** Parse a `ui-bridge/density-capture@1` document. */
export function parseDensityCapture(value: unknown): DensityParseResult<DensityCapture> {
  const r = new Reader();
  const o = r.object(value, '$', CAPTURE_KEYS, ['repeatKeysResolved']);
  if (!o) return r.result(null as unknown as DensityCapture);

  r.literal(o.schema, '$.schema', DENSITY_CAPTURE_SCHEMA);

  const cellObj = r.object(o.cell, '$.cell', ['role', 'viewport', 'fixture']);
  const cellViewport = cellObj
    ? r.object(cellObj.viewport, '$.cell.viewport', ['width', 'height'])
    : null;
  const cell: DensityCell = {
    role: cellObj ? r.stringOrNull(cellObj.role, '$.cell.role') : null,
    viewport: {
      width: cellViewport
        ? r.number(cellViewport.width, '$.cell.viewport.width', { exclusiveMin: 0 })
        : 0,
      height: cellViewport
        ? r.number(cellViewport.height, '$.cell.viewport.height', { exclusiveMin: 0 })
        : 0,
    },
    fixture: cellObj ? r.stringOrNull(cellObj.fixture, '$.cell.fixture') : null,
  };

  const vp = r.object(o.viewport, '$.viewport', [
    'width',
    'height',
    'scrollX',
    'scrollY',
    'documentWidth',
    'documentHeight',
    'container',
  ]);
  const viewport: DensityCaptureViewport = {
    width: vp ? r.number(vp.width, '$.viewport.width', { exclusiveMin: 0 }) : 0,
    height: vp ? r.number(vp.height, '$.viewport.height', { exclusiveMin: 0 }) : 0,
    scrollX: vp ? r.number(vp.scrollX, '$.viewport.scrollX') : 0,
    scrollY: vp ? r.number(vp.scrollY, '$.viewport.scrollY') : 0,
    documentWidth: vp ? r.number(vp.documentWidth, '$.viewport.documentWidth', { min: 0 }) : 0,
    documentHeight: vp ? r.number(vp.documentHeight, '$.viewport.documentHeight', { min: 0 }) : 0,
    container: vp
      ? r.oneOfOrNull(vp.container, '$.viewport.container', ['viewport', 'body'] as const)
      : null,
  };

  const observedAt = r.stringOrNull(o.observedAt, '$.observedAt');
  if (observedAt !== null && !isDensityRfc3339(observedAt)) {
    r.fail('$.observedAt', 'must be an RFC 3339 date-time or null');
  }

  const by = r.object(o.capturedBy, '$.capturedBy', ['package', 'version']);
  const capturedBy = {
    package: by ? r.string(by.package, '$.capturedBy.package', { nonEmpty: true }) : '',
    version: by ? r.string(by.version, '$.capturedBy.version', { nonEmpty: true }) : '',
  };

  let probe: DensityProbeResult | null = null;
  if (o.probe !== null) {
    const p = r.object(o.probe, '$.probe', ['role', 'id', 'matched']);
    if (p) {
      probe = {
        role: r.string(p.role, '$.probe.role', { nonEmpty: true }),
        id: r.string(p.id, '$.probe.id', { nonEmpty: true }),
        matched: r.boolean(p.matched, '$.probe.matched'),
      };
    }
  }

  const textMatches: Record<string, DensityTextMatchRecord> = {};
  if (o.textMatches === null || typeof o.textMatches !== 'object' || Array.isArray(o.textMatches)) {
    r.fail('$.textMatches', 'must be an object');
  } else {
    for (const [key, rec] of Object.entries(o.textMatches as Record<string, unknown>)) {
      const path = `$.textMatches[${JSON.stringify(key)}]`;
      if (!SHA256_HEX.test(key)) r.fail(path, 'key must be a matcher hash (SHA-256 hex)');
      const m = r.object(rec, path, ['ids', 'unevaluated']);
      if (m) {
        textMatches[key] = {
          ids: r.array(m.ids, `${path}.ids`, (v, p) => r.string(v, p, { nonEmpty: true })),
          unevaluated: r.number(m.unevaluated, `${path}.unevaluated`, { integer: true, min: 0 }),
        };
      }
    }
  }

  const items = r
    .array(o.items, '$.items', (v, p) => readItem(r, v, p))
    .filter((i): i is DensityItem => i !== null);
  r.unique(items, '$.items', (i) => i.id, 'item id');

  const capture: DensityCapture = {
    schema: DENSITY_CAPTURE_SCHEMA,
    scope: r.oneOf(o.scope, '$.scope', ['registered', 'document'] as const),
    cell,
    viewport,
    observedAt,
    snapshotId: r.stringOrNull(o.snapshotId, '$.snapshotId'),
    route: r.stringOrNull(o.route, '$.route'),
    capturedBy,
    bases: readBases(r, o.bases, '$.bases'),
    structureResolved: r.boolean(o.structureResolved, '$.structureResolved'),
    repeatKeysResolved:
      o.repeatKeysResolved === undefined
        ? itemsHaveRepeatKeys(o.items)
        : readRepeatKeysResolved(r, o.repeatKeysResolved, o.items),
    coverage: readCoverage(r, o.coverage, '$.coverage'),
    probe,
    targetsHash: readHashOrNull(r, o.targetsHash, '$.targetsHash'),
    textMatches,
    items,
  };
  return r.result(capture);
}

const MATCHER_KEYS = ['ids', 'idPrefix', 'idGlob', 'role', 'tag', 'text', 'within'] as const;

function readMatcher(r: Reader, value: unknown, path: string): DensityMatcher {
  const o = r.object(value, path, [], MATCHER_KEYS);
  if (!o) return {};
  const m: DensityMatcher = {};
  if ('ids' in o) {
    m.ids = r.array(o.ids, `${path}.ids`, (v, p) => r.string(v, p, { nonEmpty: true }));
    if (m.ids.length === 0) r.fail(`${path}.ids`, 'must name at least one id');
  }
  if ('idPrefix' in o) m.idPrefix = r.string(o.idPrefix, `${path}.idPrefix`, { nonEmpty: true });
  if ('idGlob' in o) m.idGlob = r.string(o.idGlob, `${path}.idGlob`, { nonEmpty: true });
  if ('role' in o) m.role = r.string(o.role, `${path}.role`, { nonEmpty: true });
  if ('tag' in o) m.tag = r.string(o.tag, `${path}.tag`, { nonEmpty: true });
  if ('text' in o) {
    m.text = r.string(o.text, `${path}.text`);
    if (m.text.trim() === '') r.fail(`${path}.text`, 'must contain a non-space character');
  }
  if ('within' in o) m.within = readMatcher(r, o.within, `${path}.within`);
  if (Object.keys(o).length === 0) r.fail(path, 'must give at least one field');
  return m;
}

function readAnswer(
  r: Reader,
  value: unknown,
  path: string
): DensityMatcher | DensityMatcher[] | null {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) r.fail(path, 'must hold at least one matcher, or be null');
    return value.map((v, i) => readMatcher(r, v, `${path}[${i}]`));
  }
  return readMatcher(r, value, path);
}

function readAsk(r: Reader, value: unknown, path: string): DensityAsk | null {
  const o = r.object(
    value,
    path,
    ['id', 'rank', 'weight', 'kind', 'question', 'source', 'answer'],
    ['need', 'via', 'findChars', 'form']
  );
  if (!o) return null;
  const src = r.object(o.source, `${path}.source`, ['doc', 'quote']);
  let form: DensityAsk['form'] = null;
  if ('form' in o && o.form !== null) {
    const f = r.object(o.form, `${path}.form`, ['rows', 'lines']);
    if (f) {
      form = {
        rows: r.number(f.rows, `${path}.form.rows`, { integer: true, min: 1 }),
        lines: r.number(f.lines, `${path}.form.lines`, { integer: true, min: 1 }),
      };
    }
  }
  return {
    id: r.string(o.id, `${path}.id`, { nonEmpty: true }),
    rank: r.number(o.rank, `${path}.rank`, { integer: true, min: 1 }),
    weight: r.number(o.weight, `${path}.weight`, { exclusiveMin: 0 }),
    kind: r.oneOf(o.kind, `${path}.kind`, DENSITY_ASK_KINDS),
    question: r.string(o.question, `${path}.question`, { nonEmpty: true }),
    source: {
      doc: src ? r.string(src.doc, `${path}.source.doc`, { nonEmpty: true }) : '',
      quote: src ? r.string(src.quote, `${path}.source.quote`, { nonEmpty: true }) : '',
    },
    answer: readAnswer(r, o.answer, `${path}.answer`),
    need: 'need' in o ? r.oneOf(o.need, `${path}.need`, ['any', 'all'] as const) : 'any',
    via:
      'via' in o ? r.array(o.via, `${path}.via`, (v, p) => r.string(v, p, { nonEmpty: true })) : [],
    findChars:
      'findChars' in o ? r.number(o.findChars, `${path}.findChars`, { integer: true, min: 0 }) : 0,
    form,
  };
}

function readRole(r: Reader, value: unknown, path: string): DensityRole | null {
  const o = r.object(value, path, ['role', 'asks'], ['probe']);
  if (!o) return null;
  let probe: DensityRoleProbe | null = null;
  if ('probe' in o && o.probe !== null) {
    const p = r.object(o.probe, `${path}.probe`, ['id', 'includes']);
    if (p) {
      probe = {
        id: r.string(p.id, `${path}.probe.id`, { nonEmpty: true }),
        includes: r.string(p.includes, `${path}.probe.includes`, { nonEmpty: true }),
      };
    }
  }
  const asks = r
    .array(o.asks, `${path}.asks`, (v, p) => readAsk(r, v, p))
    .filter((a): a is DensityAsk => a !== null);
  r.unique(asks, `${path}.asks`, (a) => a.id, 'ask id');
  return { role: r.string(o.role, `${path}.role`, { nonEmpty: true }), probe, asks };
}

/** Parse a `ui-bridge/density-targets@1` document. Omitted optional fields take their stated defaults. */
export function parseDensityTargets(value: unknown): DensityParseResult<DensityTargets> {
  const r = new Reader();
  const o = r.object(
    value,
    '$',
    ['schema', 'surface', 'profile', 'roles'],
    ['classify', 'blocks', 'review']
  );
  if (!o) return r.result(null as unknown as DensityTargets);
  r.literal(o.schema, '$.schema', DENSITY_TARGETS_SCHEMA);

  const classify =
    'classify' in o
      ? r.array(o.classify, '$.classify', (v, p) => {
          const c = r.object(v, p, ['match', 'kind']);
          return {
            match: c ? readMatcher(r, c.match, `${p}.match`) : {},
            kind: c
              ? r.oneOf(c.kind, `${p}.kind`, DENSITY_ITEM_KINDS)
              : ('other' as DensityItemKind),
          };
        })
      : [];
  const blocks =
    'blocks' in o
      ? r.array(o.blocks, '$.blocks', (v, p) => {
          const b = r.object(v, p, ['id', 'match']);
          return {
            id: b ? r.string(b.id, `${p}.id`, { nonEmpty: true }) : '',
            match: b ? readMatcher(r, b.match, `${p}.match`) : {},
          };
        })
      : [];
  r.unique(blocks, '$.blocks', (b) => b.id, 'block id');

  const roles = r
    .array(o.roles, '$.roles', (v, p) => readRole(r, v, p))
    .filter((x): x is DensityRole => x !== null);
  r.unique(roles, '$.roles', (x) => x.role, 'role');

  let review: DensityTargets['review'] = null;
  if ('review' in o && o.review !== null) {
    const rv = r.object(o.review, '$.review', ['reviewer', 'asksHash']);
    if (rv) {
      const asksHash = r.string(rv.asksHash, '$.review.asksHash');
      if (!SHA256_HEX.test(asksHash)) r.fail('$.review.asksHash', 'must be a SHA-256 hex digest');
      review = {
        reviewer: r.string(rv.reviewer, '$.review.reviewer', { nonEmpty: true }),
        asksHash,
      };
    }
  }

  return r.result({
    schema: DENSITY_TARGETS_SCHEMA,
    surface: r.string(o.surface, '$.surface', { nonEmpty: true }),
    profile: r.string(o.profile, '$.profile', { nonEmpty: true }),
    classify,
    blocks,
    roles,
    review,
  });
}
