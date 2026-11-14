/**
 * Walk the style rules that apply to a document, and say what was not read.
 *
 * Two depths:
 *
 * - `descend: false` — the top-level `CSSStyleRule`s of `document.styleSheets`,
 *   nothing else. The per-element custom-property walk uses this scope.
 * - `descend: true` — also inside grouping rules whose condition holds now
 *   (`@media` via `matchMedia`, `@supports` via `CSS.supports`, `@layer`),
 *   `@import`ed sheets, `document.adoptedStyleSheets`, and natively nested
 *   style rules (their selector resolved against the parent's, `&` included).
 *
 * Rules the walk cannot place are skipped and counted, never silently
 * dropped: `@container` (its condition depends on each element's container),
 * `@scope` (its bounds are not applied), `@starting-style` (not a steady
 * state), an `@media` / `@supports` whose condition is false, and an
 * `@import` or sheet whose rules cannot be read (cross-origin).
 */

/** What a descending walk read and what it skipped. */
export interface StylesheetCoverage {
  /** Sheets whose rules were read (document, imported and adopted). */
  sheetsRead: number;
  /** Sheets whose rules could not be read (cross-origin, or still loading). */
  sheetsUnreadable: number;
  /** Rules skipped, by why. */
  skippedRules: {
    container: number;
    scope: number;
    startingStyle: number;
    mediaNotMatching: number;
    supportsFalse: number;
  };
}

export function emptyCoverage(): StylesheetCoverage {
  return {
    sheetsRead: 0,
    sheetsUnreadable: 0,
    skippedRules: {
      container: 0,
      scope: 0,
      startingStyle: 0,
      mediaNotMatching: 0,
      supportsFalse: 0,
    },
  };
}

/** One style rule the walk reached, with its selector resolved for nesting. */
export interface WalkedRule {
  rule: CSSStyleRule;
  /** The selector to match: `rule.selectorText`, or a nested rule's resolved against its parents. */
  selector: string;
  /** A top-level rule of `document.styleSheets`. */
  topLevel: boolean;
}

/** Split a selector list on its top-level commas. */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** A nested rule's selector, resolved against its parent's (CSS Nesting). */
export function resolveNestedSelector(parent: string, child: string): string {
  const is = `:is(${parent})`;
  return splitSelectorList(child)
    .map((part) => (part.includes('&') ? part.replace(/&/g, is) : `${is} ${part}`))
    .join(', ');
}

function mediaMatches(mediaText: string): boolean {
  if (!mediaText || mediaText === 'all') return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return window.matchMedia(mediaText).matches;
  } catch {
    return true;
  }
}

function supportsHolds(conditionText: string): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
  try {
    return CSS.supports(conditionText);
  } catch {
    return true;
  }
}

type GroupKind =
  | 'media'
  | 'supports'
  | 'container'
  | 'scope'
  | 'startingStyle'
  | 'import'
  | 'other';

function kindOf(rule: CSSRule): GroupKind {
  const at = (rule.cssText ?? '').trimStart().toLowerCase();
  if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) return 'media';
  if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule) return 'import';
  if (at.startsWith('@media')) return 'media';
  if (at.startsWith('@supports')) return 'supports';
  if (at.startsWith('@container')) return 'container';
  if (at.startsWith('@scope')) return 'scope';
  if (at.startsWith('@starting-style')) return 'startingStyle';
  if (at.startsWith('@import')) return 'import';
  return 'other';
}

/**
 * The style rules of `doc` in cascade-source order (see the module doc).
 * `coverage`, when given, is filled in by a descending walk.
 */
export function* styleRules(
  doc: Document,
  options: { descend: boolean; coverage?: StylesheetCoverage }
): Generator<WalkedRule> {
  const { descend, coverage } = options;

  function readRules(sheet: CSSStyleSheet): CSSRuleList | null {
    try {
      const rules = sheet.cssRules;
      if (coverage) coverage.sheetsRead++;
      return rules;
    } catch {
      if (coverage) coverage.sheetsUnreadable++;
      return null;
    }
  }

  function* walk(
    rules: CSSRuleList,
    topLevel: boolean,
    parentSelector: string | null
  ): Generator<WalkedRule> {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const selector =
          parentSelector === null
            ? rule.selectorText
            : resolveNestedSelector(parentSelector, rule.selectorText);
        yield { rule, selector, topLevel };
        const nested = (rule as CSSStyleRule & { cssRules?: CSSRuleList }).cssRules;
        if (descend && nested && nested.length > 0) yield* walk(nested, false, selector);
        continue;
      }
      if (!descend) continue;
      const kind = kindOf(rule);
      if (kind === 'import') {
        const imported = rule as CSSImportRule;
        if (!mediaMatches(imported.media?.mediaText ?? '')) {
          if (coverage) coverage.skippedRules.mediaNotMatching++;
          continue;
        }
        const sheet = imported.styleSheet;
        const importedRules = sheet ? readRules(sheet) : null;
        if (!sheet && coverage) coverage.sheetsUnreadable++;
        if (importedRules) yield* walk(importedRules, false, null);
        continue;
      }
      if (kind === 'container' || kind === 'scope' || kind === 'startingStyle') {
        if (coverage) coverage.skippedRules[kind]++;
        continue;
      }
      if (kind === 'media' && !mediaMatches((rule as CSSMediaRule).media?.mediaText ?? '')) {
        if (coverage) coverage.skippedRules.mediaNotMatching++;
        continue;
      }
      if (kind === 'supports' && !supportsHolds((rule as CSSSupportsRule).conditionText ?? '')) {
        if (coverage) coverage.skippedRules.supportsFalse++;
        continue;
      }
      // @layer blocks, true @media / @supports, and other grouping rules.
      const children = (rule as Partial<CSSGroupingRule>).cssRules;
      if (children) yield* walk(children, false, parentSelector);
    }
  }

  let sheets: readonly CSSStyleSheet[];
  try {
    sheets = Array.from(doc.styleSheets) as CSSStyleSheet[];
  } catch {
    return;
  }
  for (const sheet of sheets) {
    const rules = readRules(sheet);
    if (rules) yield* walk(rules, true, null);
  }
  if (descend) {
    // Adopted sheets cascade after the document's; they are not top-level
    // rules of `document.styleSheets`.
    const adopted = (doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets;
    for (const sheet of Array.isArray(adopted) ? adopted : []) {
      const rules = readRules(sheet);
      if (rules) yield* walk(rules, false, null);
    }
  }
}
