/**
 * The custom-property `var()` graph redaction follows.
 *
 * A custom property set inline (often from script, so possibly from user
 * data) can reach a reported value through rule declarations:
 * `.card { --title: var(--user-name) }`. Every redaction decision — an
 * element's own custom properties, a token scope's overrides, the root
 * tokens — asks `referencesAnyOf` over ONE graph: the `var()` references of
 * every rule of the element's document and of every shadow root along its
 * host chain, whatever the rules' conditions (`@media`, `@supports`,
 * `@container`, `@scope`, `@starting-style`, a disabled sheet). Including a
 * rule that does not apply now only scrubs more; leaving one out can leak.
 * Attribution keeps its own condition-aware walk.
 */

import { styleRules } from './stylesheet-walk';

const VAR_PATTERN = /var\(\s*--/i;

/** A custom property name: `--` then name characters, non-ASCII, or escapes. */
const CUSTOM_NAME = String.raw`--(?:[A-Za-z0-9_-]|[^\x00-\x7F]|\\[0-9a-fA-F]{1,6}\s?|\\[^\n0-9a-fA-F])+`;
const VAR_NAMES = new RegExp(String.raw`var\(\s*(` + CUSTOM_NAME + ')', 'gi');

/**
 * Resolve CSS escapes in an identifier (`--a\.b` → `--a.b`, `--\31 x` →
 * `--1x`). A code point of 0, a surrogate, or one above U+10FFFF becomes
 * U+FFFD, as CSS Syntax says; it never throws.
 */
export function cssUnescape(ident: string): string {
  return ident.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_m, hex: string, ch: string) => {
    if (!hex) return ch;
    const code = parseInt(hex, 16);
    const valid = code !== 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return String.fromCodePoint(valid ? code : 0xfffd);
  });
}

/** The custom property names a value references (`var(--a, var(--b))` → both). */
export function varNames(value: string): string[] {
  const names: string[] = [];
  for (const m of value.matchAll(VAR_NAMES)) names.push(cssUnescape(m[1].trim()));
  return names;
}

/** Record which custom properties each of `declared` references with `var()` in `style`. */
export function recordCustomRefs(
  style: CSSStyleDeclaration,
  declared: readonly string[],
  into: Map<string, Set<string>>
): void {
  for (const name of declared) {
    const text = style.getPropertyValue(name);
    if (!VAR_PATTERN.test(text)) continue;
    let set = into.get(name);
    if (!set) into.set(name, (set = new Set()));
    for (const ref of varNames(text)) set.add(ref);
  }
}

/**
 * Whether `name`'s declarations reference (through any chain of `var()`s) one
 * of `targets`. A rule value built from a custom property set from script
 * carries that script value.
 */
export function referencesAnyOf(
  name: string,
  refs: ReadonlyMap<string, ReadonlySet<string>>,
  targets: ReadonlySet<string>
): boolean {
  if (targets.size === 0) return false;
  const seen = new Set<string>();
  const stack = [name];
  while (stack.length > 0) {
    const next = stack.pop()!;
    for (const ref of refs.get(next) ?? []) {
      if (targets.has(ref)) return true;
      if (!seen.has(ref)) {
        seen.add(ref);
        stack.push(ref);
      }
    }
  }
  return false;
}

/** `el`'s parent in the composed tree: its parent element, or the host of the shadow root it is in. */
function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const parent = el.parentNode;
  return typeof ShadowRoot !== 'undefined' && parent instanceof ShadowRoot ? parent.host : null;
}

/**
 * The custom properties set inline on `el` or any ancestor in the composed
 * tree — across shadow boundaries, since custom properties inherit through
 * them — the root included.
 */
export function inlineNamesInScope(el: Element): Set<string> {
  const names = new Set<string>();
  for (let node: Element | null = el; node; node = composedParent(node)) {
    const style = (node as HTMLElement).style as CSSStyleDeclaration | undefined;
    if (!style) continue;
    for (let i = 0; i < style.length; i++) if (style[i].startsWith('--')) names.add(style[i]);
  }
  return names;
}

// ============================================================================
// The graph, cached per root
// ============================================================================

type Root = Document | ShadowRoot;

/**
 * The cached graph per document or shadow root. The key is structural: every
 * sheet (the root's, adopted and `@import`ed ones) and every rule, by
 * identity, with every rule list's length. A sheet replaced, a rule inserted,
 * deleted or replaced invalidates it; a declaration edited in place through
 * the CSSOM does not.
 */
const graphCache = new WeakMap<Root, { key: unknown[]; refs: Map<string, Set<string>> }>();

function structuralKey(root: Root): unknown[] {
  const key: unknown[] = [];
  const visit = (rules: CSSRuleList | undefined): void => {
    if (!rules) return;
    key.push(rules.length);
    for (const rule of Array.from(rules)) {
      key.push(rule);
      const sheet = (rule as Partial<CSSImportRule>).styleSheet;
      if (sheet) {
        key.push(sheet);
        try {
          visit(sheet.cssRules);
        } catch {
          key.push(-1);
        }
      }
      visit((rule as Partial<CSSGroupingRule>).cssRules);
    }
  };
  const adopted = (root as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
  let sheets: CSSStyleSheet[] = [];
  try {
    sheets = [...(Array.from(root.styleSheets) as CSSStyleSheet[]), ...adopted];
  } catch {
    // No stylesheets readable
  }
  for (const sheet of sheets) {
    key.push(sheet);
    try {
      visit(sheet.cssRules);
    } catch {
      key.push(-1);
    }
  }
  return key;
}

function declaredNames(style: CSSStyleDeclaration): string[] {
  const names: string[] = [];
  for (let i = 0; i < style.length; i++) if (style[i].startsWith('--')) names.push(style[i]);
  return names;
}

/** Every custom property's `var()` references across all of a root's rules, whatever their conditions. */
export function rootCustomRefs(root: Root): Map<string, Set<string>> {
  const key = structuralKey(root);
  const cached = graphCache.get(root);
  if (cached && cached.key.length === key.length && cached.key.every((k, i) => k === key[i])) {
    return cached.refs;
  }
  const refs = new Map<string, Set<string>>();
  for (const { rule } of styleRules(root, { descend: true, everything: true })) {
    recordCustomRefs(rule.style, declaredNames(rule.style), refs);
  }
  graphCache.set(root, { key, refs });
  return refs;
}

/**
 * The redaction graph for `el`: its document's, merged with that of every
 * shadow root along its host chain.
 */
export function composedCustomRefs(el: Element): Map<string, Set<string>> {
  const roots: ShadowRoot[] = [];
  for (let root = el.getRootNode(); ; ) {
    if (typeof ShadowRoot === 'undefined' || !(root instanceof ShadowRoot)) break;
    roots.push(root);
    root = root.host.getRootNode();
  }
  const documentRefs = rootCustomRefs(el.ownerDocument);
  if (roots.length === 0) return documentRefs;
  const merged = new Map<string, Set<string>>();
  for (const graph of [documentRefs, ...roots.map(rootCustomRefs)]) {
    for (const [name, targets] of graph) {
      const set = merged.get(name) ?? new Set<string>();
      for (const t of targets) set.add(t);
      merged.set(name, set);
    }
  }
  return merged;
}
