/**
 * The custom-property `var()` graph redaction follows.
 *
 * A custom property set inline (often from script, so possibly from user
 * data) can reach a reported value through rule declarations:
 * `.card { --title: var(--user-name) }`. Every redaction decision — an
 * element's own custom properties, a token scope's overrides, the root
 * tokens — asks `referencesAnyOf` over ONE graph (`graphFor`): the `var()`
 * references of every rule of the element's document and of every shadow
 * root its custom properties inherit through, whatever the rules'
 * conditions (`@media`, `@supports`, `@container`, `@scope`,
 * `@starting-style`, a disabled sheet). Including a rule that does not apply
 * now only scrubs more; leaving one out can leak. When a sheet could not be
 * read, a chain reaching a name no readable rule declares is treated as
 * script-derived (fail closed). Attribution keeps its own condition-aware
 * walk.
 */

import { emptyCoverage, styleRules } from './stylesheet-walk';

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

/** A redaction graph: who references whom, who is declared at all, and whether every sheet was read. */
export interface RedactionGraph {
  /** Custom property → the custom properties its declarations reference with `var()`. */
  readonly refs: ReadonlyMap<string, ReadonlySet<string>>;
  /** Every custom property a readable rule declares. */
  readonly declared: ReadonlySet<string>;
  /** `false` when a sheet could not be read (cross-origin): unseen declarations may exist. */
  readonly complete: boolean;
}

/** Record `style`'s custom-property declarations into a graph under construction. */
function recordDeclarations(
  style: CSSStyleDeclaration,
  refs: Map<string, Set<string>>,
  declared: Set<string>
): void {
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    if (!name.startsWith('--')) continue;
    declared.add(name);
    const text = style.getPropertyValue(name);
    if (!VAR_PATTERN.test(text)) continue;
    let set = refs.get(name);
    if (!set) refs.set(name, (set = new Set()));
    for (const ref of varNames(text)) set.add(ref);
  }
}

/**
 * Whether `name`'s declarations reference (through any chain of `var()`s) one
 * of `targets`. A rule value built from a custom property set from script
 * carries that script value. With an incomplete graph, reaching a name no
 * readable rule declares (and that is not itself a target) also counts: its
 * declaration may be in the sheet that could not be read.
 */
export function referencesAnyOf(
  name: string,
  graph: RedactionGraph,
  targets: ReadonlySet<string>
): boolean {
  if (targets.size === 0) return false;
  const seen = new Set<string>();
  const stack = [name];
  while (stack.length > 0) {
    const next = stack.pop()!;
    for (const ref of graph.refs.get(next) ?? []) {
      if (targets.has(ref)) return true;
      if (!graph.complete && !graph.declared.has(ref)) return true;
      if (!seen.has(ref)) {
        seen.add(ref);
        stack.push(ref);
      }
    }
  }
  return false;
}

/**
 * `el`'s parent in the flat tree, along which custom properties inherit: the
 * slot it is assigned to, else its parent element, else the host of the
 * shadow root it is in.
 */
function flatParent(el: Element): Element | null {
  const slot = (el as Element & { assignedSlot?: Element | null }).assignedSlot;
  if (slot) return slot;
  if (el.parentElement) return el.parentElement;
  const parent = el.parentNode;
  return typeof ShadowRoot !== 'undefined' && parent instanceof ShadowRoot ? parent.host : null;
}

/**
 * The custom properties set inline on `el` or any flat-tree ancestor — into
 * the slot it is assigned to, across shadow boundaries — the root included.
 */
export function inlineNamesInScope(el: Element): Set<string> {
  const names = new Set<string>();
  for (let node: Element | null = el; node; node = flatParent(node)) {
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
 * sheet (the root's, adopted and `@import`ed ones) and every rule by
 * identity, every rule list's length, and the declaration text of every rule
 * that declares a custom property. A sheet replaced, a rule inserted, deleted
 * or replaced, or a custom property edited in place through the CSSOM
 * invalidates it.
 */
const graphCache = new WeakMap<Root, { key: unknown[]; graph: RedactionGraph }>();

function structuralKey(root: Root): unknown[] {
  const key: unknown[] = [];
  const visit = (rules: CSSRuleList | undefined): void => {
    if (!rules) return;
    key.push(rules.length);
    for (const rule of Array.from(rules)) {
      key.push(rule);
      const style = (rule as { style?: CSSStyleDeclaration }).style;
      if (
        style &&
        Array.from({ length: style.length }, (_, i) => style[i]).some((p) => p.startsWith('--'))
      ) {
        key.push(style.cssText);
      }
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
  let own: CSSStyleSheet[];
  try {
    own = Array.from(root.styleSheets) as CSSStyleSheet[];
  } catch {
    own = [];
  }
  const sheets = [...own, ...adopted];
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

/** The graph of every rule of one document or shadow root, whatever their conditions. */
export function rootGraph(root: Root): RedactionGraph {
  const key = structuralKey(root);
  const cached = graphCache.get(root);
  if (cached && cached.key.length === key.length && cached.key.every((k, i) => k === key[i])) {
    return cached.graph;
  }
  const refs = new Map<string, Set<string>>();
  const declared = new Set<string>();
  const coverage = emptyCoverage();
  for (const { rule } of styleRules(root, { descend: true, everything: true, coverage })) {
    recordDeclarations(rule.style, refs, declared);
  }
  const graph: RedactionGraph = { refs, declared, complete: coverage.sheetsUnreadable === 0 };
  graphCache.set(root, { key, graph });
  return graph;
}

/** Merge graphs: a reference or declaration in any counts; complete only if all are. */
function mergeGraphs(graphs: readonly RedactionGraph[]): RedactionGraph {
  if (graphs.length === 1) return graphs[0];
  const refs = new Map<string, Set<string>>();
  const declared = new Set<string>();
  for (const graph of graphs) {
    for (const [name, targets] of graph.refs) {
      const set = refs.get(name) ?? new Set<string>();
      for (const t of targets) set.add(t);
      refs.set(name, set);
    }
    for (const name of graph.declared) declared.add(name);
  }
  return { refs, declared, complete: graphs.every((g) => g.complete) };
}

/**
 * The redaction graph for `el`: its document's (`documentGraph` when the
 * caller already has it), merged with that of every shadow root its flat-tree
 * ancestors live in. `memo` caches the shadow roots' graphs for a batch.
 */
export function graphFor(
  el: Element,
  documentGraph?: RedactionGraph,
  memo?: Map<Root, RedactionGraph>
): RedactionGraph {
  const roots = new Set<ShadowRoot>();
  for (let node: Element | null = el; node; node = flatParent(node)) {
    const root = node.getRootNode();
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) roots.add(root);
  }
  const graphOf = (root: Root): RedactionGraph => {
    let graph = memo?.get(root);
    if (!graph) {
      graph = rootGraph(root);
      memo?.set(root, graph);
    }
    return graph;
  };
  const base = documentGraph ?? graphOf(el.ownerDocument);
  if (roots.size === 0) return base;
  return mergeGraphs([base, ...[...roots].map(graphOf)]);
}
