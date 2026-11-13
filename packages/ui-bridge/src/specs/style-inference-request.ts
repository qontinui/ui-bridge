/**
 * Style-inference requests over a live page — `POST /design/style-guide/infer`
 * and `POST /design/tokens/drift`.
 *
 * Two transports answer every `/design/*` route: the direct server handlers
 * (`server/handlers.ts`) and the browser relay (`react/commandHandlers.ts`).
 * Both call the functions here, so one model answers whichever path a request
 * takes — the pattern `./quality-request.ts` set for `/design/evaluate`.
 *
 * This module validates the body (a malformed one throws
 * `StyleInferenceRequestError`, which both transports answer with
 * `UB-VALIDATION-ERROR`) and reads samples off the DOM; the aggregation itself
 * is the pure `./style-inference`.
 */

import {
  getCSSCustomProperties,
  getElementDesignData,
  indexCustomProperties,
} from '../ai/design-inspector';
import type { QualityElementSource } from './quality-request';
import {
  buildStyleInventory,
  computeTokenDrift,
  inferStyleGuideFromInventory,
  type DeclaredTokenSet,
  type InferredStyleGuide,
  type StyleSample,
  type TokenDriftReport,
} from './style-inference';
import type { StyleGuideConfig } from './style-types';
import {
  loadedGuideTokens,
  parseDriftBody,
  parseInferBody,
  type DeclaredSourceSpec,
  type StyleSampleOptions,
  type StyleSampleScope,
} from './style-inference-body';

export {
  DEFAULT_MAX_ELEMENTS,
  StyleInferenceRequestError,
  styleInferenceFailureCode,
} from './style-inference-body';
export type { StyleSampleScope } from './style-inference-body';

/** What the sample was drawn from — reported with every answer. */
export interface StyleCaptureReport {
  scope: StyleSampleScope;
  /** Candidate elements before the cap (registered entries, or `document.body` descendants). */
  elementsAvailable: number;
  /** Elements whose computed styles were read. */
  elementsSampled: number;
  /** Registered entries skipped because their `element` is not a live `HTMLElement`. */
  elementsSkipped: number;
  /** True when `maxElements` cut the sample short. */
  elementCapReached: boolean;
  /** Distinct custom-property names seen on the sampled elements and `:root`. */
  customPropertiesSeen: number;
  /** The root font size `rem` values were resolved against. */
  rootFontSizePx: number;
  /** Limits of this capture a reader should know about. */
  notes: string[];
}

export interface StyleInferenceResponse extends InferredStyleGuide {
  capture: StyleCaptureReport;
  timestamp: number;
  durationMs: number;
}

export interface TokenDriftResponse extends TokenDriftReport {
  /** Which declared source was compared. */
  declaredSource: 'tokens' | 'customProperties' | 'pageCustomProperties' | 'loadedStyleGuide';
  capture: StyleCaptureReport;
  timestamp: number;
  durationMs: number;
}

// ============================================================================
// DOM collection
// ============================================================================

/** Tags whose computed styles are not rendered design. */
const NON_RENDERED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'LINK',
  'META',
  'HEAD',
  'TITLE',
]);

const BOX_SIDES = [
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const;

/** Minimal CSS Typed OM surface (Chrome); absent in jsdom and older engines. */
interface TypedOmValue {
  value?: unknown;
  unit?: unknown;
  toString(): string;
}
type ComputedStyleMapFn = () => { get(property: string): TypedOmValue | undefined | null };

/**
 * Chrome resolves `margin`/`padding` to the USED value, so `margin: 0 auto`
 * reads as a layout-dependent px figure and `padding: 5%` as its px result.
 * Typed OM reports the computed value instead: `auto` margins become `auto`
 * (skipped) and percentage padding stays `%`. Returns false when Typed OM is
 * unavailable, which the capture notes.
 */
function correctBoxSidesWithTypedOm(el: HTMLElement, styles: Record<string, string>): boolean {
  const fn = (el as unknown as { computedStyleMap?: ComputedStyleMapFn }).computedStyleMap;
  if (typeof fn !== 'function') return false;
  try {
    const map = fn.call(el);
    for (const side of BOX_SIDES) {
      const v = map.get(side.replace(/([A-Z])/g, '-$1').toLowerCase());
      if (!v) continue;
      const text = String(v).trim().toLowerCase();
      if (text === 'auto') styles[side] = 'auto';
      else if (v.unit === 'percent' && typeof v.value === 'number') styles[side] = `${v.value}%`;
    }
    return true;
  } catch {
    return false;
  }
}

/** True when this host has a DOM to read (a browser or jsdom, not a bare Node server). */
function hasDom(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

/**
 * The page's root font size — what `rem` resolves against — or 16 where there
 * is no DOM or it does not read as a positive number. The design audit
 * measures it the same way, so audit and drift agree on `rem`.
 */
export function measureRootFontSizePx(): number {
  if (!hasDom() || !document.documentElement) return 16;
  try {
    const n = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(n) && n > 0 ? n : 16;
  } catch {
    return 16;
  }
}

/** Whether a media query matches now; an unparseable one or a missing `matchMedia` does not. */
function mediaMatches(query: string): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Whether `el` matches a selector; an invalid selector does not. */
function selectorMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/** Style rules of a sheet, recursing into `@layer`, `@supports`, and `@media` blocks that match now. */
function* styleRulesDeep(rules: CSSRuleList): Generator<CSSStyleRule> {
  for (const rule of Array.from(rules)) {
    if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
      yield rule;
      continue;
    }
    if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
      if (mediaMatches(rule.media.mediaText)) yield* styleRulesDeep(rule.cssRules);
      continue;
    }
    const nested = (rule as unknown as { cssRules?: CSSRuleList }).cssRules;
    if (nested && typeof nested.length === 'number') yield* styleRulesDeep(nested);
  }
}

/**
 * The custom properties that apply to `document.documentElement`: names from
 * its inline style and from every readable rule matching it (recursing into
 * grouping rules, unlike `indexCustomProperties`), values from its computed
 * style — the browser substitutes `var()` there but does not evaluate `calc()`.
 */
export function readRootCustomProperties(): Record<string, string> {
  const root = document.documentElement;
  const names = new Set<string>();
  for (let i = 0; i < root.style.length; i++) {
    if (root.style[i].startsWith('--')) names.add(root.style[i]);
  }
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin
    }
    for (const rule of styleRulesDeep(rules)) {
      if (!selectorMatches(root, rule.selectorText)) continue;
      for (let i = 0; i < rule.style.length; i++) {
        if (rule.style[i].startsWith('--')) names.add(rule.style[i]);
      }
    }
  }
  const computed = window.getComputedStyle(root);
  const out: Record<string, string> = {};
  for (const name of [...names].sort()) out[name] = computed.getPropertyValue(name).trim();
  // Fall back to what getCSSCustomProperties reads, for engines whose computed
  // style omits custom properties.
  for (const [name, value] of Object.entries(getCSSCustomProperties(root))) {
    if (!(name in out) || out[name] === '') out[name] = value;
  }
  return out;
}

type CollectOptions = StyleSampleOptions;

interface Collected {
  samples: StyleSample[];
  rootCustomProperties: Record<string, string>;
  capture: StyleCaptureReport;
}

function collectSamples(
  elements: readonly QualityElementSource[],
  options: CollectOptions
): Collected {
  const notes: string[] = [];
  let candidates: Array<{ id: string; element: HTMLElement }> = [];
  let skipped = 0;

  const dom = hasDom();
  const isElement = (value: unknown): value is HTMLElement =>
    typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
  if (!dom) notes.push('no DOM is available in this host: nothing could be sampled');

  if (options.scope === 'registered') {
    const wanted = options.elementIds ? new Set(options.elementIds) : null;
    for (const el of elements) {
      if (wanted !== null && !wanted.has(el.id)) continue;
      if (dom && isElement(el.element)) candidates.push({ id: el.id, element: el.element });
      else skipped++;
    }
    if (wanted !== null && candidates.length + skipped === 0) {
      notes.push('elementIds matched no registered element');
    }
  } else if (dom) {
    const all = document.body ? Array.from(document.body.querySelectorAll('*')) : [];
    let i = 0;
    for (const el of all) {
      if (!isElement(el) || NON_RENDERED_TAGS.has(el.tagName)) continue;
      candidates.push({ id: `document:${i++}`, element: el });
    }
    if (!document.body) notes.push('the document has no body');
  }

  const available = candidates.length;
  const capReached = available > options.maxElements;
  if (capReached) candidates = candidates.slice(0, options.maxElements);

  const index =
    candidates.length > 0
      ? indexCustomProperties(
          document,
          candidates.map((c) => c.element)
        )
      : false;
  let typedOm = candidates.length > 0;
  const samples: StyleSample[] = candidates.map((c) => {
    const data = getElementDesignData(c.element, { elementId: c.id, customProperties: index });
    const styles = { ...(data.styles as unknown as Record<string, string>) };
    if (!correctBoxSidesWithTypedOm(c.element, styles)) typedOm = false;
    return { elementId: c.id, styles, customProperties: data.customProperties };
  });
  if (candidates.length > 0 && !typedOm) {
    notes.push(
      'CSS Typed OM unavailable: auto margins and percentage padding read as their used px values'
    );
  }
  notes.push('a border that differs per side computes to an empty shorthand and is not counted');

  // Nothing sampled: there is nothing for root custom properties to match, and
  // a DOM-less host has no root to read.
  const rootCustomProperties = samples.length > 0 && dom ? readRootCustomProperties() : {};
  const names = new Set(Object.keys(rootCustomProperties));
  for (const s of samples) for (const n of Object.keys(s.customProperties ?? {})) names.add(n);

  return {
    samples,
    rootCustomProperties,
    capture: {
      scope: options.scope,
      elementsAvailable: available,
      elementsSampled: samples.length,
      elementsSkipped: skipped,
      elementCapReached: capReached,
      customPropertiesSeen: names.size,
      rootFontSizePx: options.rootFontSizePx ?? measureRootFontSizePx(),
      notes,
    },
  };
}

// ============================================================================
// The two routes
// ============================================================================

/**
 * Answer `POST /design/style-guide/infer`. Throws `StyleInferenceRequestError`
 * on a malformed body.
 */
export function inferRegisteredStyleGuide(
  elements: readonly QualityElementSource[],
  request: unknown
): StyleInferenceResponse {
  const started = Date.now();
  const { maxPerCategory, limits, name, ...options } = parseInferBody(request);

  const { samples, rootCustomProperties, capture } = collectSamples(elements, options);
  const inventory = buildStyleInventory(samples, {
    rootFontSizePx: capture.rootFontSizePx,
    customProperties: rootCustomProperties,
  });
  const inferred = inferStyleGuideFromInventory(inventory, { maxPerCategory, limits, name });
  return { ...inferred, capture, timestamp: Date.now(), durationMs: Date.now() - started };
}

/** Resolve the declared source a drift body named against the page and the loaded guide. */
function declaredOf(
  spec: DeclaredSourceSpec,
  loadedGuide: Pick<StyleGuideConfig, 'tokens'> | null | undefined
): { declared: DeclaredTokenSet; source: TokenDriftResponse['declaredSource'] } {
  switch (spec.kind) {
    case 'tokens':
      return { declared: { tokens: spec.tokens }, source: 'tokens' };
    case 'customProperties':
      return { declared: { customProperties: spec.customProperties }, source: 'customProperties' };
    case 'pageCustomProperties': {
      const picked: Record<string, string> = {};
      const page = hasDom() ? readRootCustomProperties() : {};
      for (const [k, v] of Object.entries(page)) {
        if (k.startsWith(spec.prefix)) picked[k] = v;
      }
      return { declared: { customProperties: picked }, source: 'pageCustomProperties' };
    }
    case 'loadedStyleGuide':
      return { declared: { tokens: loadedGuideTokens(loadedGuide) }, source: 'loadedStyleGuide' };
  }
}

/**
 * Answer `POST /design/tokens/drift`. Throws `StyleInferenceRequestError` on a
 * malformed body or when no declared token source resolves.
 */
export function diffRegisteredDesignTokens(
  elements: readonly QualityElementSource[],
  request: unknown,
  loadedGuide: Pick<StyleGuideConfig, 'tokens'> | null | undefined
): TokenDriftResponse {
  const started = Date.now();
  const { tolerance, maxListed, source: spec, ...options } = parseDriftBody(request);
  const { declared, source } = declaredOf(spec, loadedGuide);

  const { samples, rootCustomProperties, capture } = collectSamples(elements, options);
  const inventory = buildStyleInventory(samples, {
    rootFontSizePx: capture.rootFontSizePx,
    customProperties: rootCustomProperties,
  });
  const report = computeTokenDrift(inventory, declared, {
    ...tolerance,
    maxListed,
    rootFontSizePx: capture.rootFontSizePx,
  });
  return {
    ...report,
    declaredSource: source,
    capture,
    timestamp: Date.now(),
    durationMs: Date.now() - started,
  };
}
