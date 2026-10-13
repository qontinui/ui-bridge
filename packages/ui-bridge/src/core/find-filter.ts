/**
 * Canonical find/discover filter — THE single implementation of the
 * `FindRequest` filter surface.
 *
 * History: `POST /control/find` (and its deprecated `/control/discover`
 * alias) was filtered by FOUR divergent copies of this logic — the React
 * commandHandlers, the direct server handlers (`applyFindFilters`), the
 * relay handlers (`filterCachedElements`), and the discover re-implementation
 * — each with its own interactive type-set and visibility semantics. That
 * drift produced a real incident: `discover {interactive_only: false}`
 * returned 194 elements while `/control/snapshot` returned 211, silently
 * omitting 9 registered elements via a default-on visibility filter plus
 * type-set drift. All four call sites now delegate here; do NOT re-implement
 * any of these predicates at a call site.
 *
 * The FOURTH arm, `DefaultActionExecutor.find()`, delegates too (plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 5). Until then it kept
 * its own copy of every predicate, defaulted `includeHidden` to false, and was
 * the only arm that honoured the media options at all: the server handler and
 * the relay returned media rows (they are in the registry) but ignored every
 * media predicate, so `find {mediaOnly: true}` over the relay answered with the
 * whole page. So this module now owns the WHOLE `FindRequest` surface — the
 * content, media, scope (`root` / `selector`) and `limit` options included —
 * and the four arms differ only in their candidate set.
 *
 * Hard invariant this module restores:
 *   `find/discover {interactive_only: false}` (no other filters) returns a
 *   SUPERSET of the registry elements the snapshot returns — no filter is
 *   applied unless the caller explicitly asked for one. Content and media rows
 *   therefore stay IN unless the caller passes `includeContent: false` /
 *   `includeMedia: false`.
 *
 * Visibility semantics (DELIBERATE BREAKING CHANGE, 0.22.0):
 *   `include_hidden` now defaults to TRUE — hidden elements are INCLUDED
 *   unless the caller explicitly passes `include_hidden: false` (or camelCase
 *   `includeHidden: false`). Previously the React command path silently
 *   filtered hidden elements by default, which broke the superset invariant.
 *   When `include_hidden === false`, the live DOM check
 *   (`offsetParent !== null || position === 'fixed'`) is used when a DOM node
 *   is available; otherwise the serialized `state.visible !== false`
 *   (falling back to the top-level `visible` field) decides.
 *
 * A filter acts only on what it can evaluate. An EXCLUSION drops only rows it
 * can prove fail: an element with no visibility signal at all survives
 * `include_hidden: false` (unknown ≠ hidden). A SELECTION keeps only rows it
 * can prove match: an image whose effective resolution is unmeasured (not yet
 * loaded) is not returned by `oversizeThreshold` — and, so that "could not
 * look" never reads as "not there", every such row is REPORTED in the
 * response's `unevaluated` list with the option and the code. (Before this,
 * the executor passed a row lacking the field, so `srcPattern` returned every
 * SVG and `oversizeThreshold` every unloaded image.)
 *
 * Degrade loudly (`domain_spec/ui-bridge` behaviour 8). An option the
 * transport cannot evaluate AT ALL is never silently dropped: the filter
 * throws a {@link FindRefusalError} carrying a typed code, and each call site
 * answers it as a typed failure. That covers `root` / `selector` where the
 * rows carry no DOM node (a relay's cached snapshot), the media-fact
 * predicates over rows whose `mediaMetadata` is not an observation envelope (a
 * snapshot from an SDK build that predates it), a media question asked of a
 * registry that has nothing registered, and requests that contradict
 * themselves (`mediaOnly` with `interactiveOnly`, …), which no row can match.
 */

import type { UiBridgeErrorCode } from '../diagnostics';
import type { UnknownCode } from '../observation/observation';
import { isMediaObservation, mediaFactsOf, unmeasuredMediaDimension } from './media-observation';
import { hasNestedQuantifiers } from './param-schema';
import { scrubMediaMetadata, verdictFromState, verdictOf } from './redaction';
import type { MediaFacts, MediaObservation } from './types';

/**
 * Unified interactive type-set — the superset of every type-set the four
 * divergent copies used. An element passes the `interactive_only` predicate
 * when its `kind`/`category` is not `'content'` AND (its type is in this set
 * OR it has at least one action).
 */
export const INTERACTIVE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'slider',
  'menuitem',
]);

/**
 * Structural shape the canonical filter reads. Deliberately loose — it covers
 * every element shape that flows through find/discover:
 *
 *  - registry `RegisteredElement` (live DOM node on `.element`),
 *  - serialized snapshot elements (`state`, `kind`, top-level `visible`),
 *  - DOM-fallback `DiscoveredElement` entries,
 *  - the executor's candidate rows (a `DiscoveredElement` plus its node).
 *
 * All fields optional so every shape flows through without per-call casts.
 */
export interface FindFilterableElement {
  id?: string;
  type?: string;
  kind?: string;
  category?: string;
  role?: string;
  label?: string;
  accessibleName?: string;
  textContent?: string;
  testId?: string;
  actions?: readonly string[];
  visible?: boolean;
  state?: {
    textContent?: string;
    visible?: boolean;
    redaction?: { content?: true; value?: true };
  };
  identifiers?: { testId?: string };
  /** Live DOM node when available (RegisteredElement / DiscoveredElement). */
  element?: unknown;
  /** Content metadata — `contentRole` is what the `contentRole` option reads. */
  contentMetadata?: { contentRole?: string };
  /**
   * The row's media observation (a {@link MediaObservation} on every current
   * producer; anything else is a build that predates the envelope).
   */
  mediaMetadata?: unknown;
  /**
   * Re-capture the media observation NOW. A registry media element carries
   * one so a predicate reads a broken / loaded transition as of this find,
   * not as of registration.
   */
  refreshMediaMetadata?: () => unknown;
}

/**
 * The filter criteria surface — every `FindRequest` filter. Accepts BOTH the
 * camelCase (`FindRequest`) and snake_case (wire payload) spellings of the
 * two historical flags. A `null` on any key is read as ABSENT: the runner
 * forwards unspecified `Option<T>` fields as explicit nulls.
 */
export interface CanonicalFindCriteria {
  /** Only keep interactive elements (see {@link INTERACTIVE_ELEMENT_TYPES}). */
  interactiveOnly?: boolean | null;
  /** snake_case alias for {@link CanonicalFindCriteria.interactiveOnly}. */
  interactive_only?: boolean | null;
  /**
   * Defaults to TRUE: hidden elements are included unless the caller
   * explicitly passes `false`. See the module doc for the breaking-change
   * rationale (superset invariant vs. snapshot).
   */
  includeHidden?: boolean | null;
  /** snake_case alias for {@link CanonicalFindCriteria.includeHidden}. */
  include_hidden?: boolean | null;
  /** Legacy single-type filter (alias for `element_type`). */
  type?: string | null;
  /** Filter by element type (single type). Takes precedence over `type`. */
  element_type?: string | null;
  /** Filter by element types (any-of). */
  types?: readonly string[] | null;
  /** Substring match (case-insensitive) on label/text/accessibleName/id. */
  text?: string | null;
  /** Exact match (case-insensitive, trimmed) on label/text/accessibleName. */
  exact_text?: string | null;
  /** ARIA role (or inferred type) equality, case-insensitive. */
  role?: string | null;
  /** Label substring match, case-insensitive. */
  label?: string | null;
  /** Exact `data-testid` match. */
  testId?: string | null;
  /** Keep only rows inside the element this CSS selector resolves to (needs a live DOM). */
  root?: string | null;
  /** Keep only rows whose element matches this CSS selector (needs a live DOM). */
  selector?: string | null;
  /** Cap on returned rows, applied after filtering. `0` / absent = no cap. */
  limit?: number | null;
  /** Content rows stay in unless this is explicitly `false`. */
  includeContent?: boolean | null;
  /** Keep only content rows. */
  contentOnly?: boolean | null;
  /** Keep only content rows whose `contentMetadata.contentRole` equals this. */
  contentRole?: string | null;
  /** Media rows stay in unless this is explicitly `false`. */
  includeMedia?: boolean | null;
  /** Keep only media rows. */
  mediaOnly?: boolean | null;
  /** Keep only media rows of this `mediaType` (`image`, `video`, `svg`, …). */
  mediaType?: string | null;
  /** Keep only media rows whose `loadingState` is `error`. */
  brokenOnly?: boolean | null;
  /** Keep only media rows with no alt text that are not decorative. */
  missingAltOnly?: boolean | null;
  /**
   * Keep only media rows whose `src` matches this regex (a substring match
   * when the pattern is over 200 chars, nests quantifiers, or is not a valid
   * regex — the ReDoS guard). Evaluated against the §4.6-SCRUBBED src, so a
   * pattern cannot probe a URL inside a redaction boundary.
   */
  srcPattern?: string | null;
  /**
   * Keep only media rows whose `effectiveResolution` (DPR- and
   * object-fit-aware) is at least this. A row whose effective resolution is
   * UNMEASURED is not returned but reported in `unevaluated`; one where it
   * does not apply (an SVG, a broken image) simply does not match.
   */
  oversizeThreshold?: number | null;
}

/** Which transport ran the filter — named in every refusal. */
export type FindTransport = 'executor' | 'server' | 'relay' | 'relay-cache' | 'direct';

/** A typed refusal: the find was NOT performed as asked, and why. */
export interface FindRefusal {
  /** Canonical diagnostic code, ready for `APIResponse.code`. */
  code: UiBridgeErrorCode;
  /** The observation vocabulary's reason, when the refusal is a could-not-look. */
  unknownCode?: UnknownCode;
  /** The request options the refusal is about. */
  options: string[];
  transport: FindTransport;
  detail: string;
}

/** Thrown by {@link applyCanonicalFindFilter} instead of answering a find it cannot honour. */
export class FindRefusalError extends Error {
  readonly refusal: FindRefusal;

  constructor(refusal: FindRefusal) {
    super(refusal.detail);
    this.name = 'FindRefusalError';
    this.refusal = refusal;
  }

  /** The canonical diagnostic code — the field error-to-response mappers read. */
  get code(): UiBridgeErrorCode {
    return this.refusal.code;
  }
}

/** Is `err` a {@link FindRefusalError}? Realm- and bundle-safe (checks the name, not the prototype). */
export function isFindRefusalError(err: unknown): err is FindRefusalError {
  return (
    err instanceof Error &&
    err.name === 'FindRefusalError' &&
    typeof (err as { refusal?: unknown }).refusal === 'object'
  );
}

/** A row a media-fact filter could not evaluate — left out of the result, and said so. */
export interface FindUnevaluated {
  /** The row's id. */
  id: string;
  /** The filter option that could not be evaluated for it. */
  option: string;
  /** Why: the code its observation recorded for the missing fact. */
  code: UnknownCode;
}

/** What the call site knows about where its rows came from. */
export interface CanonicalFindContext {
  /** Named in refusals. Defaults to `'direct'`. */
  transport?: FindTransport;
  /**
   * `false` when the rows are serialized JSON with no DOM behind them (a
   * relay's cached snapshot): `root` / `selector` are then refused, typed,
   * instead of being guessed at. Omitted = decide per row.
   */
  liveDom?: boolean;
  /**
   * How many elements the registry behind this answer holds. Zero means no
   * discovery producer has registered anything, so a media question cannot be
   * answered from it (`producer_not_run`) rather than answered "none".
   * Omitted = not known (no check).
   */
  registrySize?: number;
  /**
   * OUTPUT. Set by the filter when the request carried a media-fact filter
   * (`mediaType`, `brokenOnly`, `missingAltOnly`, `srcPattern`,
   * `oversizeThreshold`): the rows it could not evaluate, which it left out.
   * `[]` = every row was evaluated. Left untouched otherwise. Call sites copy
   * it onto the response as `unevaluated`.
   */
  unevaluated?: FindUnevaluated[];
}

/** Resolve the live DOM node for an element, when one is attached. */
function domNode(el: FindFilterableElement): HTMLElement | undefined {
  const node = el.element;
  if (typeof HTMLElement !== 'undefined' && node instanceof HTMLElement) {
    return node;
  }
  return undefined;
}

/**
 * The live node as a generic `Element` — an SVG media element is not an
 * `HTMLElement`, but its attributes, `matches` and containment still answer.
 */
function liveElement(el: FindFilterableElement): Element | undefined {
  const node = el.element;
  if (typeof Element !== 'undefined' && node instanceof Element) return node;
  return undefined;
}

/** Best-available text content across the element shapes. */
function elementText(el: FindFilterableElement): string {
  return el.state?.textContent ?? el.textContent ?? domNode(el)?.textContent ?? '';
}

/**
 * Visibility check used ONLY when the caller explicitly passed
 * `include_hidden: false`. Live DOM check when a node is available
 * (`offsetParent` is null for `display:none` subtrees and detached nodes,
 * but also for `position:fixed` elements — hence the second clause);
 * serialized `state.visible` / top-level `visible` otherwise. Elements with
 * no visibility signal at all are kept (unknown ≠ hidden).
 */
function isConsideredVisible(el: FindFilterableElement): boolean {
  const dom = domNode(el);
  if (dom) {
    return dom.offsetParent !== null || getComputedStyle(dom).position === 'fixed';
  }
  return (el.state?.visible ?? el.visible) !== false;
}

function isContentRow(el: FindFilterableElement): boolean {
  return el.kind === 'content' || el.category === 'content';
}

function isMediaRow(el: FindFilterableElement): boolean {
  return el.category === 'media';
}

/** `null` and `undefined` both mean "the caller did not ask". */
function given<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** The criteria with every `null` read as absent, and the aliases resolved. */
interface ResolvedCriteria {
  interactiveOnly: boolean;
  includeHidden: boolean;
  typeFilter?: string;
  types?: readonly string[];
  textLc?: string;
  exactTextLc?: string;
  roleLc?: string;
  labelLc?: string;
  testId?: string;
  root?: string;
  selector?: string;
  limit?: number;
  includeContent: boolean;
  contentOnly: boolean;
  contentRole?: string;
  includeMedia: boolean;
  mediaOnly: boolean;
  mediaType?: string;
  brokenOnly: boolean;
  missingAltOnly: boolean;
  srcPattern?: string;
  oversizeThreshold?: number;
}

function refuse(
  ctx: CanonicalFindContext,
  code: UiBridgeErrorCode,
  options: string[],
  detail: string,
  unknownCode?: UnknownCode
): never {
  throw new FindRefusalError({
    code,
    ...(unknownCode ? { unknownCode } : {}),
    options,
    transport: ctx.transport ?? 'direct',
    detail,
  });
}

function invalid(ctx: CanonicalFindContext, option: string, detail: string): never {
  return refuse(ctx, 'UB-VALIDATION-ERROR', [option], `find option \`${option}\` ${detail}`);
}

function readString(
  ctx: CanonicalFindContext,
  criteria: Record<string, unknown>,
  key: string
): string | undefined {
  const v = criteria[key];
  if (!given(v)) return undefined;
  if (typeof v !== 'string') invalid(ctx, key, `must be a string, got ${typeof v}`);
  return v;
}

function readBool(
  ctx: CanonicalFindContext,
  criteria: Record<string, unknown>,
  key: string
): boolean | undefined {
  const v = criteria[key];
  if (!given(v)) return undefined;
  if (typeof v !== 'boolean') invalid(ctx, key, `must be a boolean, got ${typeof v}`);
  return v;
}

function resolveCriteria(raw: CanonicalFindCriteria, ctx: CanonicalFindContext): ResolvedCriteria {
  const c = raw as Record<string, unknown>;
  const typesRaw = c.types;
  if (given(typesRaw) && !Array.isArray(typesRaw)) {
    invalid(ctx, 'types', 'must be an array of strings');
  }
  const limitRaw = c.limit;
  let limit: number | undefined;
  if (given(limitRaw)) {
    if (typeof limitRaw !== 'number' || !Number.isFinite(limitRaw) || limitRaw < 0) {
      invalid(ctx, 'limit', `must be a non-negative number, got ${String(limitRaw)}`);
    }
    // 0 has always meant "no cap" (the executor's own truthiness check).
    limit = limitRaw > 0 ? Math.floor(limitRaw) : undefined;
  }
  const thresholdRaw = c.oversizeThreshold;
  let oversizeThreshold: number | undefined;
  if (given(thresholdRaw)) {
    if (typeof thresholdRaw !== 'number' || !Number.isFinite(thresholdRaw) || thresholdRaw <= 0) {
      invalid(ctx, 'oversizeThreshold', `must be a positive number, got ${String(thresholdRaw)}`);
    }
    oversizeThreshold = thresholdRaw;
  }
  const text = readString(ctx, c, 'text');
  const exactText = readString(ctx, c, 'exact_text');
  const role = readString(ctx, c, 'role');
  const label = readString(ctx, c, 'label');
  const srcPattern = readString(ctx, c, 'srcPattern');
  return {
    interactiveOnly:
      readBool(ctx, c, 'interactive_only') ?? readBool(ctx, c, 'interactiveOnly') ?? false,
    // BREAKING (0.22.0): default TRUE — only an explicit `false` filters.
    includeHidden: readBool(ctx, c, 'include_hidden') ?? readBool(ctx, c, 'includeHidden') ?? true,
    typeFilter: readString(ctx, c, 'element_type') ?? readString(ctx, c, 'type'),
    types: given(typesRaw) ? (typesRaw as readonly string[]) : undefined,
    textLc: text?.toLowerCase(),
    exactTextLc: exactText?.toLowerCase(),
    roleLc: role?.toLowerCase(),
    labelLc: label?.toLowerCase(),
    testId: readString(ctx, c, 'testId'),
    root: readString(ctx, c, 'root') || undefined,
    selector: readString(ctx, c, 'selector') || undefined,
    limit,
    includeContent: readBool(ctx, c, 'includeContent') ?? true,
    contentOnly: readBool(ctx, c, 'contentOnly') ?? false,
    contentRole: readString(ctx, c, 'contentRole'),
    includeMedia: readBool(ctx, c, 'includeMedia') ?? true,
    mediaOnly: readBool(ctx, c, 'mediaOnly') ?? false,
    mediaType: readString(ctx, c, 'mediaType'),
    brokenOnly: readBool(ctx, c, 'brokenOnly') ?? false,
    missingAltOnly: readBool(ctx, c, 'missingAltOnly') ?? false,
    srcPattern: srcPattern || undefined,
    oversizeThreshold,
  };
}

/** The media-FACT predicates set on this request (each needs a row's observation). */
function factPredicates(r: ResolvedCriteria): string[] {
  const set: string[] = [];
  if (r.mediaType !== undefined) set.push('mediaType');
  if (r.brokenOnly) set.push('brokenOnly');
  if (r.missingAltOnly) set.push('missingAltOnly');
  if (r.srcPattern !== undefined) set.push('srcPattern');
  if (r.oversizeThreshold !== undefined) set.push('oversizeThreshold');
  return set;
}

/**
 * Refuse a request no row could ever satisfy. Answering it with `[]` would
 * read as "the page has none" when the request itself is the defect.
 */
function refuseContradictions(r: ResolvedCriteria, ctx: CanonicalFindContext): void {
  const media = [...(r.mediaOnly ? ['mediaOnly'] : []), ...factPredicates(r)];
  const content = [
    ...(r.contentOnly ? ['contentOnly'] : []),
    ...(r.contentRole !== undefined ? ['contentRole'] : []),
  ];
  const contradiction = (options: string[], why: string) =>
    refuse(
      ctx,
      'UB-VALIDATION-ERROR',
      options,
      `find options ${options.map((o) => `\`${o}\``).join(' + ')} contradict each other: ${why}`
    );
  if (!r.includeMedia && media.length > 0) {
    contradiction(
      ['includeMedia', ...media],
      'they select media rows that includeMedia:false excludes'
    );
  }
  if (!r.includeContent && content.length > 0) {
    contradiction(
      ['includeContent', ...content],
      'they select content rows that includeContent:false excludes'
    );
  }
  if (content.length > 0 && media.length > 0) {
    contradiction([...content, ...media], 'a content row is never a media row');
  }
  if (r.interactiveOnly && (media.length > 0 || content.length > 0)) {
    contradiction(
      ['interactiveOnly', ...content, ...media],
      'content and media rows never pass the interactive predicate'
    );
  }
}

/** Evaluate `pattern` against `haystack` behind the ReDoS guard. */
function srcMatches(pattern: string, haystack: string): boolean {
  if (pattern.length > 200 || hasNestedQuantifiers(pattern)) {
    return haystack.includes(pattern);
  }
  try {
    return new RegExp(pattern).test(haystack);
  } catch {
    // Not a valid regex — read it as a literal substring, as before.
    return haystack.includes(pattern);
  }
}

/**
 * Evaluate the media-fact predicates against a row's observation, read
 * through the §4.6 scrub for that row's verdict (so `srcPattern` sees
 * `[REDACTED]` inside a boundary, exactly as a client would).
 *
 * Three-valued per predicate: matched, missed, or COULD NOT TELL. A single
 * miss decides the row (it fails whatever the rest says); otherwise every
 * could-not-tell is returned with its code, and the row stays out.
 */
function mediaFactsVerdict(
  r: ResolvedCriteria,
  obs: MediaObservation,
  el: FindFilterableElement
): { miss: boolean; unknown: Array<{ option: string; code: UnknownCode }> } {
  const live = domNode(el) ?? liveElement(el);
  const verdict = live ? verdictOf(live as HTMLElement) : verdictFromState(el.state ?? {});
  const scrubbed = scrubMediaMetadata(obs, verdict);
  const facts: MediaFacts | undefined = mediaFactsOf(scrubbed);
  const options = factPredicates(r);
  if (!facts) {
    // The capture itself failed (or answered `absent`): no predicate can be
    // decided, for the reason the observation gives.
    const code: UnknownCode =
      scrubbed?.status === 'unknown' ? scrubbed.unknown.code : 'input_missing';
    return { miss: false, unknown: options.map((option) => ({ option, code })) };
  }

  let miss = false;
  const unknown: Array<{ option: string; code: UnknownCode }> = [];
  const decide = (option: string, outcome: boolean | UnknownCode) => {
    if (outcome === false) miss = true;
    else if (outcome !== true) unknown.push({ option, code: outcome });
  };
  // A fact the observation lists as unmeasured cannot be decided; one it does
  // not list does not apply to this media type, so the row cannot match.
  const unmeasured = (dimension: 'loadingState' | 'effectiveResolution'): UnknownCode | false =>
    (scrubbed && unmeasuredMediaDimension(scrubbed, dimension)) || false;

  if (r.mediaType !== undefined) decide('mediaType', facts.mediaType === r.mediaType);
  if (r.brokenOnly) {
    decide(
      'brokenOnly',
      facts.loadingState !== undefined ? facts.loadingState === 'error' : unmeasured('loadingState')
    );
  }
  if (r.missingAltOnly) {
    // A decorative image intentionally has no alt.
    decide('missingAltOnly', facts.altText === undefined && !facts.isDecorative);
  }
  if (r.srcPattern !== undefined) {
    // No src (an inline SVG, a canvas) is not a URL to match.
    decide('srcPattern', facts.src !== undefined && srcMatches(r.srcPattern, facts.src));
  }
  if (r.oversizeThreshold !== undefined) {
    decide(
      'oversizeThreshold',
      facts.effectiveResolution !== undefined
        ? facts.effectiveResolution >= r.oversizeThreshold
        : unmeasured('effectiveResolution')
    );
  }
  return { miss, unknown: miss ? [] : unknown };
}

/**
 * Apply the canonical find/discover filter. Pure with respect to its inputs
 * (returns a new array, never mutates) apart from asking a registry media row
 * to re-capture its observation. `criteria` may be undefined/empty, in which
 * case the input is returned unfiltered (the superset invariant).
 *
 * @throws {FindRefusalError} when the request cannot be honoured over these
 *   rows — see the module doc. Call sites answer it as a typed failure.
 */
export function applyCanonicalFindFilter<T extends FindFilterableElement>(
  elements: readonly T[],
  criteria?: CanonicalFindCriteria | null,
  ctx: CanonicalFindContext = {}
): T[] {
  if (!criteria) return [...elements];

  const r = resolveCriteria(criteria, ctx);
  refuseContradictions(r, ctx);

  const facts = factPredicates(r);
  const mediaScoped = r.mediaOnly || facts.length > 0;
  if (mediaScoped && ctx.registrySize === 0) {
    refuse(
      ctx,
      'UB-OBS-PRODUCER-NOT-RUN',
      [...(r.mediaOnly ? ['mediaOnly'] : []), ...facts],
      `the ${ctx.transport ?? 'direct'} transport cannot answer a media question: nothing is registered, ` +
        'so media discovery has not run (is AutoRegisterProvider mounted?) — an empty answer would read as "no media"',
      'producer_not_run'
    );
  }

  // Scope options need a live DOM: resolve them once, refusing typed when the
  // transport has none or the selector is unusable.
  let rootEl: Element | undefined;
  const scopeOptions = [...(r.root ? ['root'] : []), ...(r.selector ? ['selector'] : [])];
  if (scopeOptions.length > 0) {
    const noDom = () =>
      refuse(
        ctx,
        'UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD',
        scopeOptions,
        `the ${ctx.transport ?? 'direct'} transport cannot evaluate ${scopeOptions
          .map((o) => `\`${o}\``)
          .join(' / ')}: its rows carry no DOM node`,
        'capability_unavailable_in_build'
      );
    if (
      ctx.liveDom === false ||
      typeof document === 'undefined' ||
      elements.some((el) => !liveElement(el))
    ) {
      noDom();
    }
    if (r.root) {
      try {
        rootEl = document.querySelector(r.root) ?? undefined;
      } catch {
        invalid(ctx, 'root', `is not a valid CSS selector: ${r.root}`);
      }
      if (!rootEl) {
        refuse(ctx, 'UB-ELEM-NOT-FOUND', ['root'], `find root \`${r.root}\` matched no element`);
      }
    }
    if (r.selector) {
      try {
        document.createDocumentFragment().querySelector(r.selector);
      } catch {
        invalid(ctx, 'selector', `is not a valid CSS selector: ${r.selector}`);
      }
    }
  }

  // Media-fact predicates read a row's observation envelope. A media row
  // carrying anything else came from a build that predates the envelope: this
  // transport cannot evaluate the predicate, so it must not guess.
  const factObservations = new Map<T, MediaObservation>();
  const unevaluated: FindUnevaluated[] = [];
  if (facts.length > 0) {
    ctx.unevaluated = unevaluated;
    for (const el of elements) {
      if (!isMediaRow(el)) continue;
      const obs = el.refreshMediaMetadata ? el.refreshMediaMetadata() : el.mediaMetadata;
      if (!isMediaObservation(obs)) {
        refuse(
          ctx,
          'UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD',
          facts,
          `the ${ctx.transport ?? 'direct'} transport cannot evaluate ${facts
            .map((o) => `\`${o}\``)
            .join(
              ' / '
            )}: media row \`${el.id ?? '?'}\` carries no media observation (an SDK build that predates it)`,
          'capability_unavailable_in_build'
        );
      }
      factObservations.set(el, obs);
    }
  }

  const filtered = elements.filter((el) => {
    const content = isContentRow(el);
    const media = isMediaRow(el);

    if (!r.includeContent && content) return false;
    if (!r.includeMedia && media) return false;
    if (r.contentOnly && !content) return false;
    if (r.contentRole !== undefined) {
      if (!content || el.contentMetadata?.contentRole !== r.contentRole) return false;
    }
    if (r.mediaOnly && !media) return false;
    if (facts.length > 0 && !media) return false;

    if (r.interactiveOnly) {
      // Semantic content entries (cards/badges/pills opted in via
      // `data-ui-bridge-content`) are never interactive, even if they
      // inherited actions.
      if (content) return false;
      const isInteractive =
        (el.type !== undefined && INTERACTIVE_ELEMENT_TYPES.has(el.type)) ||
        (el.actions !== undefined && el.actions.length > 0);
      if (!isInteractive) return false;
    }

    if (r.includeHidden === false && !isConsideredVisible(el)) return false;

    if (r.typeFilter && el.type !== r.typeFilter) return false;
    if (r.types && r.types.length > 0) {
      if (el.type === undefined || !r.types.includes(el.type)) return false;
    }

    if (r.roleLc !== undefined) {
      const domRole = liveElement(el)?.getAttribute('role')?.toLowerCase();
      const elRole = el.role?.toLowerCase();
      const typeAsRole = el.type?.toLowerCase();
      if (domRole !== r.roleLc && elRole !== r.roleLc && typeAsRole !== r.roleLc) return false;
    }

    if (r.labelLc !== undefined) {
      if (!(el.label ?? '').toLowerCase().includes(r.labelLc)) return false;
    }

    if (r.textLc !== undefined) {
      const label = (el.label ?? '').toLowerCase();
      const text = elementText(el).toLowerCase();
      const accessibleName = (el.accessibleName ?? '').toLowerCase();
      const id = (el.id ?? '').toLowerCase();
      if (
        !label.includes(r.textLc) &&
        !text.includes(r.textLc) &&
        !accessibleName.includes(r.textLc) &&
        !id.includes(r.textLc)
      ) {
        return false;
      }
    }

    if (r.exactTextLc !== undefined) {
      const label = (el.label ?? '').toLowerCase();
      const text = elementText(el).trim().toLowerCase();
      const accessibleName = (el.accessibleName ?? '').toLowerCase();
      if (label !== r.exactTextLc && text !== r.exactTextLc && accessibleName !== r.exactTextLc) {
        return false;
      }
    }

    if (r.testId !== undefined) {
      const elTestId =
        el.testId ??
        el.identifiers?.testId ??
        liveElement(el)?.getAttribute('data-testid') ??
        undefined;
      if (elTestId !== r.testId) return false;
    }

    if (rootEl && !rootEl.contains(liveElement(el) ?? null)) return false;
    if (r.selector && !liveElement(el)?.matches(r.selector)) return false;

    // The media-fact predicates go LAST: a row is reported as unevaluated only
    // when every decidable predicate already let it through.
    if (facts.length > 0) {
      const obs = factObservations.get(el);
      if (!obs) return false;
      const outcome = mediaFactsVerdict(r, obs, el);
      if (outcome.miss) return false;
      if (outcome.unknown.length > 0) {
        // Could not tell: not returned, but never silently gone either.
        for (const u of outcome.unknown) unevaluated.push({ id: el.id ?? '?', ...u });
        return false;
      }
    }

    return true;
  });

  return r.limit !== undefined ? filtered.slice(0, r.limit) : filtered;
}
