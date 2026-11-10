/**
 * Natural Language Assertion Parser
 *
 * Parses natural language assertion strings into structured assertion requests.
 * Shared between browser-side command handlers and server-side handlers.
 *
 * Examples:
 *   "a button exists"          → { target: "button", type: "exists" }
 *   "input is not visible"     → { target: "input", type: "hidden" }
 *   "button is not disabled"   → { target: "button", type: "enabled" }
 *   "checkbox is not checked"  → { target: "checkbox", type: "unchecked" }
 */

import type { AssertionRequest, BatchAssertionRequest, SearchCriteria } from './types';

/** Input for the NL assertion parser. Target can be a string or a structured search criteria object. */
export interface NLAssertionInput {
  target?: unknown;
  type?: string;
  expected?: unknown;
  assertion?: string;
}

/** The three fields the parser resolves; every other field of the input rides along unchanged. */
export interface NLAssertionOutput {
  /** An element id or description, or the caller's structured `SearchCriteria` kept as an object. */
  target: string | SearchCriteria;
  type: string;
  expected?: unknown;
}

/** A structured target (a `SearchCriteria` object) stays an object; anything else is an id string. */
function structuredTarget(target: unknown): string | SearchCriteria {
  return typeof target === 'object' && target !== null
    ? (target as SearchCriteria)
    : String(target);
}

/**
 * Parse a natural language assertion into a structured form.
 *
 * If `target` and `type` are already present, the request is passed through
 * WHOLE. Otherwise the `assertion` string is parsed into `{ target, type,
 * expected }`, again over the whole request. Either way every field the parser
 * does not resolve — `attributeName`, `propertyName`, `allowedValues`, `range`,
 * `tokenPath`, `timeout`, `message`, `fuzzy`, `relatedTarget`, `minGap` — rides
 * along. Until 2026-11-10 the structured branch returned only the three
 * resolved fields, and both transports that call this (the relay's
 * `aiAssert` / `aiAssertBatch` command handlers) forwarded only those, so an
 * `attribute` or `cssProperty*` assertion sent through the relay reached the
 * executor without the name it checks; a `SearchCriteria` target was turned
 * into the string `"[object Object]"`.
 */
export function parseNLAssertion<T extends NLAssertionInput>(input: T): T & NLAssertionOutput {
  // If already structured with target and type, pass through
  if (input.target && input.type) {
    return {
      ...input,
      target: structuredTarget(input.target),
      type: input.type,
      expected: input.expected,
    };
  }

  const text = input.assertion ?? '';
  if (!text) {
    return {
      ...input,
      target: String(input.target ?? ''),
      type: String(input.type ?? 'exists'),
      expected: input.expected,
    };
  }

  const lc = text.toLowerCase().trim();

  // Negative patterns: "there are no X", "no X exists", "X is not visible"
  if (/\b(no |not |isn't |aren't |doesn't |don't )/.test(lc)) {
    // "not visible" → hidden
    if (/\bvisible\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|isn't|aren't)\s+/, '')
          .replace(/\s*(is\s+)?visible.*/, '')
          .replace(/\b(there\s+are|on\s+the\s+page)\b/g, '')
          .trim() || text;
      return { ...input, target, type: 'hidden' };
    }
    // "not disabled" → enabled
    if (/\bdisabled\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|isn't|aren't)\s+/, '')
          .replace(/\s*(is\s+)?disabled.*/, '')
          .trim() || text;
      return { ...input, target, type: 'enabled' };
    }
    // "not checked" → unchecked
    if (/\bchecked\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|isn't|aren't)\s+/, '')
          .replace(/\s*(is\s+)?checked.*/, '')
          .trim() || text;
      return { ...input, target, type: 'unchecked' };
    }
    // "not enabled" → disabled
    if (/\benabled\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|isn't|aren't)\s+/, '')
          .replace(/\s*(is\s+)?enabled.*/, '')
          .trim() || text;
      return { ...input, target, type: 'disabled' };
    }
    // "not exist" / "not present" → notExists
    if (/\b(exist|present|on the page)\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|doesn't|don't)\s+/, '')
          .replace(/\s*(exist|present|on the page).*/, '')
          .replace(/\b(there\s+are|there\s+is)\b/g, '')
          .trim() || text;
      return { ...input, target, type: 'notExists' };
    }
    // Generic negative — default to notExists
    const target =
      lc
        .replace(/.*?(no|not|isn't|aren't)\s+/, '')
        .replace(/\b(on the page|visible|exist)\b/g, '')
        .trim() || text;
    return { ...input, target, type: 'notExists' };
  }

  // Positive patterns: "X is visible", "X exists", "X is enabled", etc.
  const typePatterns: Array<[RegExp, string]> = [
    [/\bvisible\b/, 'visible'],
    [/\benabled\b/, 'enabled'],
    [/\bdisabled\b/, 'disabled'],
    [/\bhidden\b/, 'hidden'],
    [/\bchecked\b/, 'checked'],
    [/\bunchecked\b/, 'unchecked'],
    [/\bfocused\b/, 'focused'],
    [/\bempty\b/, 'hasValue'],
    [/\bexist/, 'exists'],
    [/\bpresent\b/, 'exists'],
    [/\bon the page\b/, 'exists'],
    [/\bhas loaded\b/, 'exists'],
    [/\bcontains?\b.*['"](.+?)['"]/, 'hasText'],
  ];

  for (const [pattern, type] of typePatterns) {
    if (pattern.test(lc)) {
      // Extract target by removing the assertion type keywords
      let target = lc
        .replace(/\b(is|are|has|have|should be|must be|exists?|present)\b/g, '')
        .replace(pattern, '')
        .replace(/\b(the|a|an|on|page|this)\b/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .trim();
      if (!target) target = text;

      // For hasText, extract expected value from quotes
      if (type === 'hasText') {
        const match = lc.match(/contains?\s+['"](.+?)['"]/);
        if (match) {
          return {
            ...input,
            target: target.replace(/['"].*?['"]/g, '').trim() || text,
            type,
            expected: match[1],
          };
        }
      }

      // For "empty" → hasValue with expected empty string
      if (type === 'hasValue' && input.expected === undefined) {
        return { ...input, target, type, expected: '' };
      }

      return { ...input, target, type };
    }
  }

  // Default: treat the entire assertion as a target with "exists" type
  return { ...input, target: text, type: 'exists' };
}

/**
 * Normalise an `ai/assert/batch` request — THE one implementation both
 * transports use (the in-process `aiAssertBatch` handlers and the relay's
 * `aiAssertBatch` command): each entry parsed by {@link parseNLAssertion} (a
 * bare string is an NL assertion), `mode` defaulted to `'all'`, and every other
 * field — `stopOnFailure` included — passed through. A non-array `assertions`
 * is refused rather than read as an empty batch.
 */
export function normalizeAssertionBatch(request: {
  assertions?: unknown;
  mode?: 'all' | 'any' | null;
  stopOnFailure?: boolean;
}): BatchAssertionRequest {
  const raw = request.assertions ?? [];
  if (!Array.isArray(raw)) {
    throw new TypeError(`assertions must be an array, got ${typeof raw}`);
  }
  return {
    ...request,
    mode: request.mode || 'all',
    assertions: raw.map(
      (a: unknown) =>
        parseNLAssertion(
          typeof a === 'string' ? { assertion: a } : ((a ?? {}) as NLAssertionInput)
        ) as unknown as AssertionRequest
    ),
  };
}
