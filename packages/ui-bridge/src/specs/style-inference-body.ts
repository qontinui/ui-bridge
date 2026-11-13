/**
 * Request-body validation for `POST /design/style-guide/infer` and
 * `POST /design/tokens/drift`, shared by every transport that serves them:
 * the web server handlers and browser relay (through
 * `./style-inference-request`) and `@qontinui/ui-bridge-native` (through
 * `@qontinui/ui-bridge/specs`). Pure — no DOM access — so the native package
 * can load it.
 *
 * A malformed body throws `StyleInferenceRequestError` (internal code
 * `INVALID_REQUEST`). A key this module does not read (an adapter's `tabId`)
 * is ignored; absent and JSON `null` both mean "not given".
 */

import { STYLE_CATEGORIES, type DeepPartialTokens, type StyleCategory } from './style-inference';

/** Default cap on sampled elements. */
export const DEFAULT_MAX_ELEMENTS = 2000;

/** Where samples come from. */
export type StyleSampleScope = 'registered' | 'document';

/**
 * A style-inference request whose body does not have the route's shape. Both
 * transports answer it with `UB-VALIDATION-ERROR`.
 */
export class StyleInferenceRequestError extends Error {
  /** The internal code both transports map onto `UB-VALIDATION-ERROR`. */
  readonly code = 'INVALID_REQUEST';

  constructor(message: string) {
    super(message);
    this.name = 'StyleInferenceRequestError';
  }
}

/** The internal failure code for `err`: `INVALID_REQUEST` for a malformed request, else the route's. */
export function styleInferenceFailureCode(err: unknown, routeCode: string): string {
  return err instanceof StyleInferenceRequestError ? err.code : routeCode;
}

// ============================================================================
// Request validation
// ============================================================================

type RequestBody = Record<string, unknown>;

function isObject(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function bodyOf(request: unknown, route: string): RequestBody {
  if (!isGiven(request)) return {};
  if (!isObject(request)) {
    throw new StyleInferenceRequestError(`${route}: the request body must be a JSON object`);
  }
  return request;
}

function positiveIntOf(body: RequestBody, key: string, route: string): number | undefined {
  const v = body[key];
  if (!isGiven(v)) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new StyleInferenceRequestError(`${route}: ${key} must be an integer >= 1`);
  }
  return v;
}

function nonNegativeNumberOf(body: RequestBody, key: string, route: string): number | undefined {
  const v = body[key];
  if (!isGiven(v)) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new StyleInferenceRequestError(`${route}: ${key} must be a finite number >= 0`);
  }
  return v;
}

function stringOf(body: RequestBody, key: string, route: string): string | undefined {
  const v = body[key];
  if (!isGiven(v)) return undefined;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new StyleInferenceRequestError(`${route}: ${key} must be a non-empty string`);
  }
  return v;
}

function elementIdsOf(body: RequestBody, route: string): string[] | undefined {
  const ids = body.elementIds;
  if (!isGiven(ids)) return undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    throw new StyleInferenceRequestError(`${route}: elementIds must be an array of strings`);
  }
  return ids;
}

function scopeOf(body: RequestBody, route: string): StyleSampleScope {
  const scope = body.scope;
  if (!isGiven(scope)) return 'registered';
  if (scope !== 'registered' && scope !== 'document') {
    throw new StyleInferenceRequestError(`${route}: scope must be "registered" or "document"`);
  }
  return scope;
}

function limitsOf(
  body: RequestBody,
  route: string
): Partial<Record<StyleCategory, number>> | undefined {
  const limits = body.limits;
  if (!isGiven(limits)) return undefined;
  if (!isObject(limits)) {
    throw new StyleInferenceRequestError(
      `${route}: limits must be an object of category → integer`
    );
  }
  const out: Partial<Record<StyleCategory, number>> = {};
  for (const [key, value] of Object.entries(limits)) {
    if (!(STYLE_CATEGORIES as readonly string[]).includes(key)) {
      throw new StyleInferenceRequestError(
        `${route}: limits.${key} is not a category (${STYLE_CATEGORIES.join(', ')})`
      );
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new StyleInferenceRequestError(`${route}: limits.${key} must be an integer >= 0`);
    }
    out[key as StyleCategory] = value;
  }
  return out;
}

function stringMapOf(value: unknown, path: string, route: string): Record<string, string | number> {
  if (!isObject(value)) {
    throw new StyleInferenceRequestError(`${route}: ${path} must be an object of name → value`);
  }
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw new StyleInferenceRequestError(`${route}: ${path}.${k} must be a string or number`);
    }
  }
  return value as Record<string, string | number>;
}

const TOKEN_GROUPS = ['colors', 'spacing', 'borderRadius', 'shadows', 'breakpoints'] as const;
const TYPOGRAPHY_GROUPS = [
  'fontFamilies',
  'fontSizes',
  'fontWeights',
  'lineHeights',
  'letterSpacings',
] as const;

function tokensOf(value: unknown, route: string): DeepPartialTokens {
  if (!isObject(value)) {
    throw new StyleInferenceRequestError(`${route}: tokens must be a DesignTokens-shaped object`);
  }
  const out: DeepPartialTokens = {};
  for (const [key, group] of Object.entries(value)) {
    if (!isGiven(group)) continue;
    if ((TOKEN_GROUPS as readonly string[]).includes(key)) {
      (out as Record<string, unknown>)[key] = stringMapOf(group, `tokens.${key}`, route);
    } else if (key === 'typography') {
      if (!isObject(group)) {
        throw new StyleInferenceRequestError(`${route}: tokens.typography must be an object`);
      }
      const typography: NonNullable<DeepPartialTokens['typography']> = {};
      for (const [tk, tg] of Object.entries(group)) {
        if (!isGiven(tg)) continue;
        if (!(TYPOGRAPHY_GROUPS as readonly string[]).includes(tk)) {
          throw new StyleInferenceRequestError(
            `${route}: tokens.typography.${tk} is not a typography group (${TYPOGRAPHY_GROUPS.join(', ')})`
          );
        }
        typography[tk as (typeof TYPOGRAPHY_GROUPS)[number]] = stringMapOf(
          tg,
          `tokens.typography.${tk}`,
          route
        );
      }
      out.typography = typography;
    } else {
      throw new StyleInferenceRequestError(
        `${route}: tokens.${key} is not a DesignTokens group (${[...TOKEN_GROUPS, 'typography'].join(', ')})`
      );
    }
  }
  return out;
}

function toleranceOf(body: RequestBody, route: string): { colorDeltaE?: number; px?: number } {
  const t = body.tolerance;
  if (!isGiven(t)) return {};
  if (!isObject(t)) {
    throw new StyleInferenceRequestError(`${route}: tolerance must be { colorDeltaE?, px? }`);
  }
  return {
    colorDeltaE: nonNegativeNumberOf(t, 'colorDeltaE', `${route} tolerance`),
    px: nonNegativeNumberOf(t, 'px', `${route} tolerance`),
  };
}

// ============================================================================
// Parsed bodies
// ============================================================================

/** The sampling options both routes take. */
export interface StyleSampleOptions {
  scope: StyleSampleScope;
  elementIds?: string[];
  maxElements: number;
  rootFontSizePx?: number;
}

/** A validated `/design/style-guide/infer` body. */
export interface InferBody extends StyleSampleOptions {
  maxPerCategory?: number;
  limits?: Partial<Record<StyleCategory, number>>;
  name?: string;
}

/** The declared source a drift body names; `loadedStyleGuide` when it names none. */
export type DeclaredSourceSpec =
  | { kind: 'tokens'; tokens: DeepPartialTokens }
  | { kind: 'customProperties'; customProperties: Record<string, string | number> }
  | { kind: 'pageCustomProperties'; prefix: string }
  | { kind: 'loadedStyleGuide' };

/** A validated `/design/tokens/drift` body. */
export interface DriftBody extends StyleSampleOptions {
  tolerance: { colorDeltaE?: number; px?: number };
  maxListed?: number;
  source: DeclaredSourceSpec;
}

function sampleOptionsOf(body: RequestBody, route: string): StyleSampleOptions {
  const scope = scopeOf(body, route);
  const elementIds = elementIdsOf(body, route);
  if (scope === 'document' && elementIds) {
    throw new StyleInferenceRequestError(`${route}: elementIds applies to scope "registered" only`);
  }
  const rootFontSizePx = nonNegativeNumberOf(body, 'rootFontSizePx', route);
  if (rootFontSizePx === 0) {
    throw new StyleInferenceRequestError(`${route}: rootFontSizePx must be greater than 0`);
  }
  return {
    scope,
    elementIds,
    maxElements: positiveIntOf(body, 'maxElements', route) ?? DEFAULT_MAX_ELEMENTS,
    rootFontSizePx,
  };
}

function nonNegativeIntOf(body: RequestBody, key: string, route: string): number | undefined {
  const v = nonNegativeNumberOf(body, key, route);
  if (v !== undefined && !Number.isInteger(v)) {
    throw new StyleInferenceRequestError(`${route}: ${key} must be an integer >= 0`);
  }
  return v;
}

/** Validate a `/design/style-guide/infer` body. Throws `StyleInferenceRequestError`. */
export function parseInferBody(request: unknown, route = '/design/style-guide/infer'): InferBody {
  const body = bodyOf(request, route);
  return {
    ...sampleOptionsOf(body, route),
    maxPerCategory: nonNegativeIntOf(body, 'maxPerCategory', route),
    limits: limitsOf(body, route),
    name: stringOf(body, 'name', route),
  };
}

/** Validate a `/design/tokens/drift` body. Throws `StyleInferenceRequestError`. */
export function parseDriftBody(request: unknown, route = '/design/tokens/drift'): DriftBody {
  const body = bodyOf(request, route);
  const sample = sampleOptionsOf(body, route);
  const tolerance = toleranceOf(body, route);
  const maxListed = nonNegativeIntOf(body, 'maxListed', route);
  const given = (['tokens', 'customProperties', 'pageCustomPropertyPrefix'] as const).filter((k) =>
    isGiven(body[k])
  );
  if (given.length > 1) {
    throw new StyleInferenceRequestError(
      `${route}: give exactly one declared token source; got ${given.join(' and ')}`
    );
  }
  let source: DeclaredSourceSpec = { kind: 'loadedStyleGuide' };
  if (isGiven(body.tokens)) {
    source = { kind: 'tokens', tokens: tokensOf(body.tokens, route) };
  } else if (isGiven(body.customProperties)) {
    const map = stringMapOf(body.customProperties, 'customProperties', route);
    for (const k of Object.keys(map)) {
      if (!k.startsWith('--')) {
        throw new StyleInferenceRequestError(
          `${route}: customProperties.${k} must start with "--"`
        );
      }
    }
    source = { kind: 'customProperties', customProperties: map };
  } else {
    const prefix = stringOf(body, 'pageCustomPropertyPrefix', route);
    if (prefix !== undefined) {
      if (!prefix.startsWith('--')) {
        throw new StyleInferenceRequestError(
          `${route}: pageCustomPropertyPrefix must start with "--"`
        );
      }
      source = { kind: 'pageCustomProperties', prefix };
    }
  }
  return { ...sample, tolerance, maxListed, source };
}

/**
 * The tokens of a loaded style guide, validated like a request's `tokens`, or
 * the refusal every transport gives when no declared source resolves.
 */
export function loadedGuideTokens(
  loadedGuide: { tokens?: unknown } | null | undefined,
  route = '/design/tokens/drift'
): DeepPartialTokens {
  if (loadedGuide && isGiven(loadedGuide.tokens) && isObject(loadedGuide.tokens)) {
    return tokensOf(loadedGuide.tokens, `${route} (loaded style guide)`);
  }
  throw new StyleInferenceRequestError(
    `${route}: no declared tokens — give tokens, customProperties or pageCustomPropertyPrefix, ` +
      'or load a style guide first'
  );
}
