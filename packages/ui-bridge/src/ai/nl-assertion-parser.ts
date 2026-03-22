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

/** Input for the NL assertion parser. Target can be a string or a structured search criteria object. */
export interface NLAssertionInput {
  target?: unknown;
  type?: string;
  expected?: unknown;
  assertion?: string;
}

/** Output from the NL assertion parser */
export interface NLAssertionOutput {
  target: string;
  type: string;
  expected?: unknown;
}

/**
 * Parse a natural language assertion into a structured form.
 *
 * If `target` and `type` are already present, passes them through.
 * Otherwise, parses the `assertion` string into { target, type, expected }.
 */
export function parseNLAssertion(input: NLAssertionInput): NLAssertionOutput {
  // If already structured with target and type, pass through
  if (input.target && input.type) {
    return { target: String(input.target), type: input.type, expected: input.expected };
  }

  const text = input.assertion ?? '';
  if (!text) {
    return {
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
      return { target, type: 'hidden' };
    }
    // "not disabled" → enabled
    if (/\bdisabled\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|isn't|aren't)\s+/, '')
          .replace(/\s*(is\s+)?disabled.*/, '')
          .trim() || text;
      return { target, type: 'enabled' };
    }
    // "not checked" → unchecked
    if (/\bchecked\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|isn't|aren't)\s+/, '')
          .replace(/\s*(is\s+)?checked.*/, '')
          .trim() || text;
      return { target, type: 'unchecked' };
    }
    // "not enabled" → disabled
    if (/\benabled\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|isn't|aren't)\s+/, '')
          .replace(/\s*(is\s+)?enabled.*/, '')
          .trim() || text;
      return { target, type: 'disabled' };
    }
    // "not exist" / "not present" → notExists
    if (/\b(exist|present|on the page)\b/.test(lc)) {
      const target =
        lc
          .replace(/.*?(no|not|doesn't|don't)\s+/, '')
          .replace(/\s*(exist|present|on the page).*/, '')
          .replace(/\b(there\s+are|there\s+is)\b/g, '')
          .trim() || text;
      return { target, type: 'notExists' };
    }
    // Generic negative — default to notExists
    const target =
      lc
        .replace(/.*?(no|not|isn't|aren't)\s+/, '')
        .replace(/\b(on the page|visible|exist)\b/g, '')
        .trim() || text;
    return { target, type: 'notExists' };
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
            target: target.replace(/['"].*?['"]/g, '').trim() || text,
            type,
            expected: match[1],
          };
        }
      }

      // For "empty" → hasValue with expected empty string
      if (type === 'hasValue' && input.expected === undefined) {
        return { target, type, expected: '' };
      }

      return { target, type };
    }
  }

  // Default: treat the entire assertion as a target with "exists" type
  return { target: text, type: 'exists' };
}
