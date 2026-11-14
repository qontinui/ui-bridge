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
 * a disabled sheet or one whose `media` does not match,
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
  /** Sheets not applied, so not read: disabled (an alternate sheet), or a `media` that does not match. */
  sheetsSkipped: { disabled: number; mediaNotMatching: number };
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
    sheetsSkipped: { disabled: 0, mediaNotMatching: 0 },
    skippedRules: {
      container: 0,
      scope: 0,
      startingStyle: 0,
      mediaNotMatching: 0,
      supportsFalse: 0,
    },
  };
}

/**
 * A declaration block the walk reached: a style rule, or the nested
 * declarations (`CSSNestedDeclarations`) that follow a nested rule inside one.
 */
export interface StyleBlock {
  readonly style: CSSStyleDeclaration;
}

/** One declaration block the walk reached, with its selector resolved for nesting. */
export interface WalkedRule {
  rule: StyleBlock;
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

/** Evaluate a condition once per walk, by its text. */
function cached(evaluate: (text: string) => boolean): (text: string) => boolean {
  const seen = new Map<string, boolean>();
  return (text) => {
    let result = seen.get(text);
    if (result === undefined) seen.set(text, (result = evaluate(text)));
    return result;
  };
}

function mediaMatchesNow(mediaText: string): boolean {
  if (!mediaText || mediaText === 'all') return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return window.matchMedia(mediaText).matches;
  } catch {
    return true;
  }
}

function supportsHoldsNow(conditionText: string): boolean {
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
  | 'nestedDeclarations'
  | 'other';

/** The CSSOM classes this engine defines, by kind; `undefined` where it has none. */
const RULE_CLASSES: ReadonlyArray<[GroupKind, string]> = [
  ['media', 'CSSMediaRule'],
  ['supports', 'CSSSupportsRule'],
  ['import', 'CSSImportRule'],
  ['container', 'CSSContainerRule'],
  ['scope', 'CSSScopeRule'],
  ['startingStyle', 'CSSStartingStyleRule'],
  ['nestedDeclarations', 'CSSNestedDeclarations'],
  ['other', 'CSSLayerBlockRule'],
];

function kindOf(rule: CSSRule): GroupKind {
  // Type checks first: serialising `cssText` costs the whole rule's text.
  for (const [kind, name] of RULE_CLASSES) {
    const ctor = (globalThis as unknown as Record<string, unknown>)[name];
    if (typeof ctor === 'function' && rule instanceof (ctor as new () => CSSRule)) return kind;
  }
  // Nested declarations: a declaration block with no selector of its own.
  if ('style' in rule && !('selectorText' in rule)) return 'nestedDeclarations';
  const at = (rule.cssText ?? '').slice(0, 20).trimStart().toLowerCase();
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
  doc: Document | ShadowRoot,
  options: {
    descend: boolean;
    coverage?: StylesheetCoverage;
    /**
     * Every rule, whether or not it applies now: conditions (`@media`,
     * `@supports`, a sheet's `media`, `disabled`) are ignored and
     * `@container` / `@scope` / `@starting-style` are entered. For an
     * over-approximation, such as the `var()` graph redaction follows.
     */
    everything?: boolean;
  }
): Generator<WalkedRule> {
  const { descend, coverage, everything = false } = options;
  const mediaMatches = everything ? () => true : cached(mediaMatchesNow);
  const supportsHolds = everything ? () => true : cached(supportsHoldsNow);

  /** A sheet the page does not apply (disabled, or its `media` does not match) is not read. */
  function applies(sheet: CSSStyleSheet): boolean {
    if (everything) return true;
    if (sheet.disabled) {
      if (coverage) coverage.sheetsSkipped.disabled++;
      return false;
    }
    const media = sheet.media?.mediaText ?? '';
    if (media && !mediaMatches(media)) {
      if (coverage) coverage.sheetsSkipped.mediaNotMatching++;
      return false;
    }
    return true;
  }

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
      if (kind === 'nestedDeclarations') {
        // Declarations after a nested rule apply with the parent's selector.
        const style = (rule as CSSRule & { style?: CSSStyleDeclaration }).style;
        if (style && parentSelector !== null)
          yield { rule: { style }, selector: parentSelector, topLevel: false };
        continue;
      }
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
      if (!everything && (kind === 'container' || kind === 'scope' || kind === 'startingStyle')) {
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

  let sheets: readonly CSSStyleSheet[] = [];
  try {
    sheets = Array.from(doc.styleSheets) as CSSStyleSheet[];
  } catch {
    // No readable `styleSheets` (an engine without them on a shadow root):
    // adopted sheets are still walked.
  }
  for (const sheet of sheets) {
    if (!applies(sheet)) continue;
    const rules = readRules(sheet);
    if (rules) yield* walk(rules, true, null);
  }
  if (descend) {
    // Adopted sheets cascade after the document's; they are not top-level
    // rules of `document.styleSheets`.
    const adopted = (doc as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets;
    for (const sheet of Array.isArray(adopted) ? adopted : []) {
      if (!applies(sheet)) continue;
      const rules = readRules(sheet);
      if (rules) yield* walk(rules, false, null);
    }
  }
}
