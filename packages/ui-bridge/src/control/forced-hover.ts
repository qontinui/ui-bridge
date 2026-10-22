/**
 * Forced pseudo-state — put an element into its real CSS `:hover` (or
 * `:active`) appearance from page script, then take it out again and prove the
 * page is back.
 *
 * Plan 2026-10-22-ui-bridge-hover-forces-the-css-hover-state, Phases 1-2.
 *
 * WHY. A synthetic `mouseenter`/`mouseover` never sets the browser's `:hover`
 * flag; that flag follows the real pointer's hit-test and nothing else. So a
 * bridge `hover` used to report success while every `hover:` / `group-hover:`
 * rule stayed dormant, and a hover-revealed toolbar could not be seen,
 * captured or clicked. No page-script API sets `:hover`, so this module does
 * the next-most-faithful thing that works on every surface the SDK runs on
 * (runner WebView2, qontinui-web, headless Chromium):
 *
 *  1. IN-PLACE SELECTOR REWRITE. Every readable stylesheet in scope is walked,
 *     through `@media`/`@supports`/`@container`/`@layer` blocks, CSS nesting
 *     and `@import`. Every style rule (at any depth) whose selector contains an
 *     unescaped `:hover` has it rewritten THROUGH THE CSSOM SETTER to
 *     `:is(:hover,[data-ui-bridge-pseudo-hover])`. The rule keeps its exact
 *     position, layer and condition, `:is()` takes its most specific argument
 *     (both are 0,1,0), so the cascade is unchanged; and the real `:hover`
 *     still works while the attribute adds a second way to match. No rule is
 *     inserted, so a CSS-in-JS library that addresses its sheet by index never
 *     sees a shifted index, and `:not(:hover)` becomes
 *     `:not(:is(:hover,[attr]))`, which stops matching while forced, exactly as
 *     under a real hover. Serialized rule text is never regex-edited: a
 *     minified `(hover:hover)` media condition would be hit.
 *  2. MARK THE CHAIN. The attribute is set on the target and every ancestor on
 *     its flat-tree path (a slotted element's slot, shadow roots crossed to
 *     their hosts). A real `:hover` applies to the hovered element and all its
 *     ancestors, so this is the browser's own semantics, not a heuristic — and
 *     it is what makes a Tailwind `group-hover:` rule keyed on a `.group`
 *     ancestor fire.
 *  3. SETTLE. `getComputedStyle` is read on the target (so a delayed transition
 *     such as `delay-150` has been CREATED), then every animation the change
 *     started is awaited, bounded by `settleTimeoutMs`. Where the platform has
 *     no `getAnimations` (jsdom) one frame is awaited and the report says
 *     `settled: 'frame-only'`.
 *  4. REPORT what changed: `revealed` lists the registered elements whose
 *     computed `opacity`, `visibility`, `display` or `pointer-events` changed
 *     between before-apply and after-settle, with both values and a bbox.
 *
 * GUARANTEES (the same standard as `control/media-override.ts`):
 *
 *  - One forced state at a time, like one pointer — per page, not per bundle:
 *    the hold lives on a `globalThis` singleton, so separately bundled entry
 *    points share it. A new apply releases the old one first (`replaced`).
 *  - It never leaks. A TTL (`holdMs`, default 30 s, ceiling 300 s) releases it
 *    by itself, so a caller that dies mid-run cannot leave the page altered.
 *    {@link releaseAfter} releases it after a dispatched write-class action.
 *  - Release puts each rewritten selector back — unless the app changed it
 *    during the hold, in which case the app's selector is left alone and
 *    reported as `selectorDrift` — removes every attribute, sends the leave
 *    events a real pointer would (`pointerout`/`mouseout` on the target,
 *    bubbling; `pointerleave`/`mouseleave` on every marked element), waits for
 *    the resulting transitions, and then VERIFIES AGAINST WHAT RENDERS: each
 *    revealed element's four properties (and the target's) must read their
 *    before-apply values. Anything else is `restored_with_drift`, naming the
 *    element and property, and never `verified`.
 *  - A scan that throws part-way restores every selector it already rewrote.
 *  - Completeness is honest. A sheet whose `cssRules` throws (cross-origin) is
 *    counted in `unreadableSheets` and never skipped silently; `complete` is
 *    `false` whenever one was, because its `:hover` rules were not forced.
 *    A `:hover` scoped to a pseudo-element (`::-webkit-scrollbar-thumb:hover`,
 *    `::part(x):hover`, `::slotted(x):hover`) cannot take an `:is()` and is
 *    counted in `rulesNotApplicable`; it does not make the reveal incomplete.
 *
 * LIMITS (documented on the action, not hidden):
 *  - App JS reading `el.matches(':hover')` still sees `false`. JS keyed on
 *    `mouseenter`/`pointerenter` is covered by the enter events the callers
 *    keep dispatching.
 *  - A rule the app inserts during the hold is not rewritten. It surfaces as
 *    drift in the verified restore rather than being hidden.
 *  - `:hover` inside an attribute-selector string, or after an escaped
 *    backslash (`.a\\:hover`), is outside the rewrite's grammar.
 *  - `@scope (.card:hover) { … }`: an `@scope` prelude is not a style rule's
 *    `selectorText`, so a `:hover` in its scope-start or scope-end selector is
 *    not rewritten (the style rules inside the block are).
 *  - `:host-context(.x:hover)` is rewritten like any selector, but
 *    `:host-context()` accepts only a compound selector and engines differ on
 *    whether an `:is()` inside it parses (Firefox never shipped
 *    `:host-context`). A refused rewrite is counted in `rulesFailed`, which
 *    makes the report `complete: false`.
 */

import { readRunningAnimations } from '../core/running-animations';
import { standardActionEffect } from '../core/action-effect';

// ============================================================================
// Types
// ============================================================================

/** The user-action pseudo-classes this module can force. */
export type ForcedPseudoStateName = 'hover' | 'active';

/** Why a forced state ended. */
export type ForcedPseudoReleaseReason =
  /** An explicit `unhover` (or a caller's own restore). */
  | 'explicit'
  /** A new forced state replaced it (one pointer, one hover). */
  | 'replaced'
  /** A dispatched write-class action completed (see {@link releaseAfter}). */
  | 'next-action'
  /** The hold's TTL elapsed. */
  | 'ttl';

/** The four computed properties a reveal is judged on. */
export const REVEAL_PROPERTIES = ['opacity', 'visibility', 'display', 'pointer-events'] as const;
export type RevealProperty = (typeof REVEAL_PROPERTIES)[number];
export type RevealValues = Record<RevealProperty, string>;

/** The settle verdict: `true` every started animation finished, `false` the wait timed out, `'frame-only'` the platform cannot list animations. */
export type ForcedPseudoSettle = boolean | 'frame-only';

export interface ForcedPseudoChange {
  property: RevealProperty;
  /** `null` when the element was not registered before the apply. */
  before: string | null;
  after: string;
}

export interface ForcedPseudoRevealed {
  /** The registered bridge element id. */
  id: string;
  /** True when the element was not registered before the apply (a JS-rendered reveal). */
  appeared: boolean;
  changes: ForcedPseudoChange[];
  rect: { x: number; y: number; width: number; height: number };
}

/** What an apply did. */
export interface ForcedPseudoReport {
  /** Identifies this hold, for {@link releaseForcedPseudoStateIfOwner}. */
  holdId: number;
  state: ForcedPseudoStateName;
  /** The attribute the rewritten selectors accept and the chain carries. */
  attribute: string;
  /** A short fingerprint of the target (`tag#id` / `tag.class`). */
  target: string;
  /** Style rules whose selector was rewritten in place for this hold. */
  rulesRewritten: number;
  /** Matching rules the browser refused the rewritten selector for. */
  rulesFailed: number;
  /** Matching rules whose every `:<state>` is scoped to a pseudo-element: nothing to force. */
  rulesNotApplicable: number;
  /** Stylesheets walked, including `@import`ed ones. */
  sheetsScanned: number;
  /** Stylesheets whose rules could not be read (cross-origin). Their rules were NOT forced. */
  unreadableSheets: number;
  /** The hrefs of the unreadable sheets, where they have one. */
  unreadableSheetHrefs: string[];
  /** False when any sheet was unreadable or any rewrite failed: the reveal is then UNKNOWN-complete. */
  complete: boolean;
  /** Elements given the attribute: the target and its flat-tree ancestors. */
  markedElements: number;
  settled: ForcedPseudoSettle;
  settleMs: number;
  /** Time spent walking the stylesheets. */
  scanMs: number;
  /** The effective hold, after the default and ceiling are applied. */
  holdMs: number;
  /** Epoch ms at which the TTL releases the hold by itself. */
  expiresAt: number;
  revealed: ForcedPseudoRevealed[];
  /** The previous hold this apply released first, when there was one. */
  replaced?: ForcedPseudoReleaseReport;
}

export interface ForcedPseudoDrift {
  id: string;
  property: RevealProperty;
  before: string;
  after: string;
}

/** A rewritten selector the app changed during the hold: left as the app set it. */
export interface ForcedPseudoSelectorDrift {
  /** The selector the rule carries now (the app's). */
  selector: string;
  /** The selector before the apply. */
  original: string;
}

/** What a release did, and whether the page is verifiably back. */
export interface ForcedPseudoReleaseReport {
  /** False when nothing was held: the release was a no-op. */
  released: boolean;
  reason: ForcedPseudoReleaseReason;
  state?: ForcedPseudoStateName;
  holdId?: number;
  /** Rewritten selectors set back to their original text. */
  rulesRestored: number;
  /** Rewritten rules no longer in any sheet (the sheet was replaced or the rule deleted). */
  rulesAlreadyGone: number;
  /** Rewritten selectors the app changed during the hold, left untouched. */
  selectorDrift: ForcedPseudoSelectorDrift[];
  unmarkedElements: number;
  settled?: ForcedPseudoSettle;
  /** How long the state was held. */
  heldMs?: number;
  /**
   * `verified`: every revealed element (and the target) reads its
   * before-apply values again, and no selector drifted.
   * `restored_with_drift`: at least one did not (see `drift`, `selectorDrift`).
   * `nothing_held`: there was nothing to release.
   */
  restore: 'verified' | 'restored_with_drift' | 'nothing_held';
  drift: ForcedPseudoDrift[];
}

/** The `forcedHover` field of an action response. */
export interface ForcedHoverActionReport {
  /** Present when the action forced the state (`hover`, `hoverClick`). */
  applied?: ForcedPseudoReport;
  /** Present when the action released a held state (`unhover`, a write-class action, `hoverClick`). */
  released?: ForcedPseudoReleaseReport;
}

/** Where `revealed` reads the bridge's registered elements from. Kept structural so this module stays registry-agnostic. */
export interface ForcedPseudoElementSource {
  getAllElements(): Iterable<{ id: string; element?: Element | null }>;
}

export interface ForcePseudoStateOptions {
  /** TTL in ms. Default {@link DEFAULT_HOLD_MS}; clamped to {@link MAX_HOLD_MS}. */
  holdMs?: number;
  /** Bound on the settle wait. Default {@link DEFAULT_SETTLE_TIMEOUT_MS}. */
  settleTimeoutMs?: number;
  /** The registry `revealed` is computed over. Without it `revealed` is empty. */
  registry?: ForcedPseudoElementSource;
  /**
   * Called after the chain is marked and before the settle wait, so a caller
   * can dispatch the JS half of a hover (enter events) and have its effects
   * included in the settle and the `revealed` diff.
   */
  afterMark?: (target: Element) => void;
  /**
   * This apply BORROWS the pointer from the hold `snapshot` describes (the
   * design inspector): it, and the release of the hold it creates, do not
   * count as a change of the page's pointer, so {@link reapplyIfIdle} can
   * still put the snapshot back afterwards.
   */
  borrowedFrom?: ForcedPseudoHoldSnapshot;
}

/** The current hold, as {@link getForcedPseudoState} reports it. */
export interface ForcedPseudoHoldInfo {
  holdId: number;
  state: ForcedPseudoStateName;
  target: string;
  appliedAt: number;
  expiresAt: number;
  report: ForcedPseudoReport | null;
}

/** Enough of a hold to re-apply it after something else used the single pointer. */
export interface ForcedPseudoHoldSnapshot {
  holdId: number;
  target: Element;
  state: ForcedPseudoStateName;
  /** Epoch ms at which the hold would have expired; a re-apply keeps that deadline. */
  expiresAt: number;
  /** The pointer generation when the snapshot was taken; see {@link reapplyIfIdle}. */
  generation: number;
  settleTimeoutMs: number;
  registry?: ForcedPseudoElementSource;
  /** The JS half of the original hover, so a re-apply replays the enter events too. */
  afterMark?: (target: Element) => void;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_HOLD_MS = 30_000;
export const MAX_HOLD_MS = 300_000;
export const DEFAULT_SETTLE_TIMEOUT_MS = 1_500;
/** A settle wait is bounded even when a caller asks for more: the relay times commands out at ~8 s. */
export const MAX_SETTLE_TIMEOUT_MS = 5_000;
/** Bound on a single frame wait: rAF is paused in an occluded or minimized window. */
const FRAME_WAIT_CAP_MS = 100;

/** The attribute the rewritten selectors accept and the marked chain carries. */
export function pseudoStateAttribute(state: ForcedPseudoStateName): string {
  return `data-ui-bridge-pseudo-${state}`;
}

/**
 * The selector grammar this module rewrites: an UNESCAPED pseudo-class.
 * Tailwind class names carry escaped colons (`.hover\:bg-x`,
 * `.\[\&\:hover\]\:x`) and must not be touched; `:hover-foo` is not `:hover`.
 */
const PSEUDO_PATTERNS: Record<ForcedPseudoStateName, RegExp> = {
  hover: /(?<!\\):hover(?![\w-])/g,
  active: /(?<!\\):active(?![\w-])/g,
};

function matchIndices(selector: string, state: ForcedPseudoStateName): number[] {
  const pattern = PSEUDO_PATTERNS[state];
  pattern.lastIndex = 0;
  const out: number[] = [];
  for (let m = pattern.exec(selector); m; m = pattern.exec(selector)) out.push(m.index);
  pattern.lastIndex = 0;
  return out;
}

/**
 * Whether the pseudo-class at `index` belongs to a pseudo-element's compound
 * (`::-webkit-scrollbar-thumb:hover`, `::part(x):hover`, `::slotted(x):hover`).
 * Walks back to the start of the compound — a combinator or comma at the same
 * parenthesis depth, or the opening of an enclosing `:is(`/`:not(` — skipping
 * parenthesized arguments, and looks for `::`.
 */
function isPseudoElementScoped(selector: string, index: number): boolean {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = selector[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      if (depth === 0) return false;
      depth -= 1;
    } else if (depth === 0) {
      if (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === ',') return false;
      if (ch === ':' && selector[i - 1] === ':' && selector[i - 2] !== '\\') return true;
    }
  }
  return false;
}

/** Whether a selector contains the forced pseudo-class (not as an escaped class-name fragment). */
export function selectorHasPseudo(selector: string, state: ForcedPseudoStateName): boolean {
  return matchIndices(selector, state).length > 0;
}

/**
 * Rewrite every unescaped, forceable `:<state>` in a selector to
 * `:is(:<state>,[attr])`. Returns `null` when the selector has a match but
 * every match is scoped to a pseudo-element (nothing can be forced), and the
 * selector unchanged when it has no match at all.
 *
 * `:not(:hover)` becomes `:not(:is(:hover,[attr]))`, which stops matching while
 * forced — a real hover's reading. A pseudo inside `:is()`/`:where()`/`:has()`
 * is rewritten in place.
 */
export function rewritePseudoSelector(
  selector: string,
  state: ForcedPseudoStateName
): string | null {
  const hits = matchIndices(selector, state);
  if (hits.length === 0) return selector;
  const forceable = hits.filter((i) => !isPseudoElementScoped(selector, i));
  if (forceable.length === 0) return null;
  const token = `:${state}`;
  const replacement = `:is(${token},[${pseudoStateAttribute(state)}])`;
  let out = '';
  let last = 0;
  for (const i of forceable) {
    out += selector.slice(last, i) + replacement;
    last = i + token.length;
  }
  return out + selector.slice(last);
}

// ============================================================================
// Page-wide singleton
// ============================================================================

interface RewrittenRule {
  rule: CSSStyleRule;
  originalText: string;
  rewrittenText: string;
}

interface VerifyEntry {
  id: string;
  element: Element;
  before: RevealValues;
}

interface Hold {
  holdId: number;
  state: ForcedPseudoStateName;
  attribute: string;
  target: Element;
  doc: Document;
  rewritten: RewrittenRule[];
  marked: Element[];
  appliedAt: number;
  expiresAt: number;
  settleTimeoutMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  registry?: ForcedPseudoElementSource;
  /** The JS half of the hover (enter events), replayed when the hold is re-applied. */
  afterMark?: (target: Element) => void;
  /** The document and shadow roots whose sheets were scanned. */
  roots: Array<Document | ShadowRoot>;
  /** Applied while borrowing the pointer: its apply and release leave the generation alone. */
  borrowed: boolean;
  /** Elements whose four properties must read their before values after release. */
  verify: VerifyEntry[];
  report: ForcedPseudoReport | null;
}

interface ForcedPseudoGlobal {
  /** The shape version of this object; see {@link FORCED_PSEUDO_STATE_VERSION}. */
  version: number;
  hold: Hold | null;
  /** Apply and release are serialized: a release never interleaves with an apply's settle. */
  queue: Promise<unknown>;
  /** Rules currently rewritten by a hold, so a scan never rewrites one twice. */
  rewritten: WeakSet<CSSRule>;
  nextHoldId: number;
  /**
   * Bumped by every apply and every release of the page's hold, except those
   * of a borrower ({@link ForcePseudoStateOptions.borrowedFrom}). A snapshot
   * whose generation no longer matches describes a pointer someone else has
   * moved since, and must not be put back.
   */
  generation: number;
}

/**
 * The shape of the shared state object. Bump it whenever
 * {@link ForcedPseudoGlobal} or {@link Hold} changes shape.
 */
export const FORCED_PSEUDO_STATE_VERSION = 4;

/**
 * One pointer per PAGE. tsup emits each entry point (`index`, `control`,
 * `react`, `injected`, …) as its own bundle, so a module-level `let` would be
 * one pointer per bundle: a hover applied through one entry could not be
 * released through another. The state lives on `globalThis` under a registered
 * symbol instead (the pattern of `getGlobalActionWindowRegistry`).
 *
 * The key carries the state version. Two SDK copies of DIFFERENT versions on
 * one page (an app bundle plus an injected runtime) then never see each
 * other's state object at all, so neither can read it through a shape it
 * does not know; copies of the same version share it.
 */
const GLOBAL_KEY = Symbol.for(`ui-bridge.forcedPseudo@v${FORCED_PSEUDO_STATE_VERSION}`);

function freshState(): ForcedPseudoGlobal {
  return {
    version: FORCED_PSEUDO_STATE_VERSION,
    hold: null,
    queue: Promise.resolve(),
    rewritten: new WeakSet(),
    nextHoldId: 1,
    generation: 0,
  };
}

function g(): ForcedPseudoGlobal {
  const host = globalThis as unknown as Record<symbol, ForcedPseudoGlobal | undefined>;
  let state = host[GLOBAL_KEY];
  if (!state || state.version !== FORCED_PSEUDO_STATE_VERSION) {
    state = freshState();
    host[GLOBAL_KEY] = state;
  }
  return state;
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const s = g();
  const run = s.queue.then(fn, fn);
  s.queue = run.catch(() => undefined);
  return run;
}

// ============================================================================
// CSSOM walk
// ============================================================================

/** Anything that holds rules: a sheet, a grouping rule, or (CSS nesting) a style rule. */
interface RuleContainer {
  readonly cssRules: CSSRuleList;
}

interface ScanResult {
  rewritten: RewrittenRule[];
  rulesFailed: number;
  rulesNotApplicable: number;
  sheetsScanned: number;
  unreadableSheets: number;
  unreadableSheetHrefs: string[];
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  // Duck-typed so a rule from another realm (an iframe's sheet) is still
  // recognised. A `CSSPageRule` also has `selectorText`, but no page selector
  // can contain `:hover`/`:active`.
  return typeof (rule as Partial<CSSStyleRule>).selectorText === 'string';
}

function childRules(rule: CSSRule): CSSRuleList | null {
  // `@media`/`@supports`/`@container`/`@layer` blocks and (CSS nesting) style
  // rules. `@keyframes` also has `cssRules`, but its keyframes carry no
  // selector, so walking them is harmless.
  const list = (rule as unknown as Partial<RuleContainer>).cssRules;
  return list ?? null;
}

function importedSheet(rule: CSSRule): CSSStyleSheet | null {
  const r = rule as Partial<CSSImportRule>;
  if ('href' in r && 'styleSheet' in r && r.styleSheet) return r.styleSheet;
  return null;
}

function rewriteRule(rule: CSSStyleRule, state: ForcedPseudoStateName, out: ScanResult): void {
  const originalText = rule.selectorText;
  const next = rewritePseudoSelector(originalText, state);
  if (next === originalText) return;
  if (next === null) {
    out.rulesNotApplicable += 1;
    return;
  }
  rule.selectorText = next;
  // The setter silently ignores a selector it cannot parse; read it back.
  const rewrittenText = rule.selectorText;
  if (rewrittenText === originalText) {
    out.rulesFailed += 1;
    return;
  }
  g().rewritten.add(rule);
  out.rewritten.push({ rule, originalText, rewrittenText });
}

function walkRules(
  list: CSSRuleList,
  state: ForcedPseudoStateName,
  out: ScanResult,
  visit: (sheet: CSSStyleSheet) => void
): void {
  const rewritten = g().rewritten;
  for (let i = 0; i < list.length; i++) {
    const rule = list[i];
    const imported = importedSheet(rule);
    if (imported) {
      visit(imported);
      continue;
    }
    if (isStyleRule(rule) && !rewritten.has(rule)) rewriteRule(rule, state, out);
    const children = childRules(rule);
    if (children) walkRules(children, state, out, visit);
  }
}

function shadowRootOf(node: Node): ShadowRoot | null {
  const root = node.getRootNode?.();
  if (root && root !== node && (root as ShadowRoot).host instanceof Element) {
    return root as ShadowRoot;
  }
  return null;
}

/**
 * The target and every ancestor on its flat-tree path, innermost first: a
 * slotted element's parent is its slot, and a shadow root is crossed to its
 * host — the path a real `:hover` propagates along.
 */
export function composedAncestry(target: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = target;
  while (current) {
    chain.push(current);
    current = current.assignedSlot ?? current.parentElement ?? shadowRootOf(current)?.host ?? null;
  }
  return chain;
}

/**
 * The sheets in scope: the document's and its adopted ones, the shadow root
 * each chain element lives in, and the open shadow root each chain element
 * hosts (its `:host(:hover)` rules).
 */
function sheetsInScope(target: Element): {
  sheets: CSSStyleSheet[];
  roots: Array<Document | ShadowRoot>;
} {
  const out: CSSStyleSheet[] = [];
  const seen = new Set<CSSStyleSheet>();
  const add = (sheet: CSSStyleSheet | null | undefined): void => {
    if (sheet && !seen.has(sheet)) {
      seen.add(sheet);
      out.push(sheet);
    }
  };
  const roots = new Set<Document | ShadowRoot>();
  const addRoot = (root: Document | ShadowRoot | null | undefined): void => {
    if (!root || roots.has(root)) return;
    roots.add(root);
    for (const sheet of Array.from(root.styleSheets ?? [])) add(sheet as CSSStyleSheet);
    for (const sheet of root.adoptedStyleSheets ?? []) add(sheet);
  };
  addRoot(target.ownerDocument);
  for (const el of composedAncestry(target)) {
    addRoot(shadowRootOf(el));
    addRoot(el.shadowRoot);
  }
  return { sheets: out, roots: Array.from(roots) };
}

function listHas(list: CSSRuleList, rule: CSSRule): boolean {
  return Array.prototype.includes.call(list, rule) as boolean;
}

/**
 * Whether a sheet still applies to a scanned root: its `<style>`/`<link>` is
 * connected and still owns it, it is still adopted by one of the roots, or (an
 * `@import`ed sheet) its import rule is itself still live.
 */
function sheetIsLive(sheet: CSSStyleSheet, roots: Array<Document | ShadowRoot>): boolean {
  if (sheet.ownerRule) return ruleIsAttached(sheet.ownerRule, roots);
  const owner = sheet.ownerNode as (Node & { sheet?: CSSStyleSheet | null }) | null | undefined;
  // `undefined` (not `null`): the platform does not track owners at all
  // (jsdom). The rule-in-sheet checks above are then the whole answer.
  if (owner === undefined) return true;
  if (owner) return owner.isConnected && owner.sheet === sheet;
  return roots.some((root) => (root.adoptedStyleSheets ?? []).includes(sheet));
}

/**
 * Whether a rewritten rule is still part of a live sheet. Each level of
 * `parentRule` must still list its child (a deleted rule keeps its parent
 * pointers), the top-level rule must still be in its sheet, and that sheet must
 * still be in scope (a removed `<style>`, an un-adopted sheet). A rule that
 * fails any of these draws nothing and is counted as already gone.
 */
function ruleIsAttached(rule: CSSRule, roots: Array<Document | ShadowRoot>): boolean {
  const sheet = listedTopSheet(rule);
  return sheet !== null && sheetIsLive(sheet, roots);
}

/**
 * The sheet a rule is still listed in — every `parentRule` level still lists
 * its child and the top-level rule is still in its sheet — or `null` when the
 * rule was deleted somewhere along the chain (a deleted rule keeps its parent
 * pointers).
 */
function listedTopSheet(rule: CSSRule): CSSStyleSheet | null {
  try {
    let current: CSSRule = rule;
    while (current.parentRule) {
      const parent = current.parentRule as unknown as RuleContainer;
      if (!listHas(parent.cssRules, current)) return null;
      current = current.parentRule;
    }
    const sheet = current.parentStyleSheet;
    return sheet && listHas(sheet.cssRules, current) ? sheet : null;
  } catch {
    return null;
  }
}

function restoreRewritten(
  records: RewrittenRule[],
  roots: Array<Document | ShadowRoot>
): {
  rulesRestored: number;
  rulesAlreadyGone: number;
  selectorDrift: ForcedPseudoSelectorDrift[];
} {
  const rewritten = g().rewritten;
  let rulesRestored = 0;
  let rulesAlreadyGone = 0;
  const selectorDrift: ForcedPseudoSelectorDrift[] = [];
  for (const { rule, originalText, rewrittenText } of records) {
    rewritten.delete(rule);
    const sheet = listedTopSheet(rule);
    if (!sheet) {
      // Deleted from its parent: nothing will ever read this rule again.
      rulesAlreadyGone += 1;
      continue;
    }
    const current = rule.selectorText;
    if (current !== rewrittenText) {
      // The app changed this selector while it was held. Its value is newer
      // than our original: leave it, and say so.
      selectorDrift.push({ selector: current, original: originalText });
      continue;
    }
    // Written back even when its sheet is no longer in scope (a removed
    // `<style>`, an un-adopted sheet): writing to a dead sheet is harmless, and
    // a sheet the app re-inserts or re-adopts must not come back forced.
    try {
      rule.selectorText = originalText;
    } catch {
      selectorDrift.push({ selector: current, original: originalText });
      continue;
    }
    if (sheetIsLive(sheet, roots)) rulesRestored += 1;
    else rulesAlreadyGone += 1;
  }
  return { rulesRestored, rulesAlreadyGone, selectorDrift };
}

function scanSheets(
  target: Element,
  state: ForcedPseudoStateName
): ScanResult & { roots: Array<Document | ShadowRoot> } {
  const out: ScanResult = {
    rewritten: [],
    rulesFailed: 0,
    rulesNotApplicable: 0,
    sheetsScanned: 0,
    unreadableSheets: 0,
    unreadableSheetHrefs: [],
  };
  const scanned = new Set<CSSStyleSheet>();
  const visit = (sheet: CSSStyleSheet): void => {
    if (scanned.has(sheet)) return;
    scanned.add(sheet);
    let rules: CSSRuleList | null;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null;
    }
    if (!rules) {
      out.unreadableSheets += 1;
      if (sheet.href) out.unreadableSheetHrefs.push(sheet.href);
      return;
    }
    out.sheetsScanned += 1;
    walkRules(rules, state, out, visit);
  };
  const { sheets, roots } = sheetsInScope(target);
  try {
    for (const sheet of sheets) visit(sheet);
  } catch (error) {
    // Never leave a half-forced page behind a failed apply.
    restoreRewritten(out.rewritten, roots);
    throw error;
  }
  return { ...out, roots };
}

// ============================================================================
// Style reads, settle
// ============================================================================

function readRevealValues(el: Element): RevealValues | null {
  try {
    const view = el.ownerDocument?.defaultView ?? globalThis;
    const cs = view.getComputedStyle(el);
    return {
      opacity: cs.opacity,
      visibility: cs.visibility,
      display: cs.display,
      'pointer-events': cs.pointerEvents,
    };
  } catch {
    return null;
  }
}

function fingerprint(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = el.classList?.[0];
  return cls ? `${tag}.${cls}` : tag;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      resolve();
    };
    const hasRaf = typeof requestAnimationFrame === 'function';
    if (hasRaf) requestAnimationFrame(finish);
    timer = setTimeout(finish, hasRaf ? FRAME_WAIT_CAP_MS : 0);
  });
}

function isInfinite(animation: Animation): boolean {
  try {
    return animation.effect?.getTiming?.().iterations === Infinity;
  } catch {
    return false;
  }
}

/** The animations running right now, as identities, so a settle can ignore the ones that predate the change. */
function runningAnimationSet(doc: Document): Set<Animation> {
  return new Set(readRunningAnimations(doc).animations.map((a) => a.animation));
}

/**
 * Wait for every finite animation started since `preexisting` was read.
 * Infinite animations (spinners) never finish and are not waited on.
 */
async function settleAfter(
  doc: Document,
  preexisting: Set<Animation>,
  timeoutMs: number
): Promise<{ settled: ForcedPseudoSettle; settleMs: number }> {
  const start = now();
  const read = readRunningAnimations(doc);
  if (!read.available) {
    await nextFrame();
    return { settled: 'frame-only', settleMs: now() - start };
  }
  const started = read.animations
    .map((a) => a.animation)
    .filter((a) => !preexisting.has(a) && !isInfinite(a));
  let settled = true;
  if (started.length > 0) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const allFinished = Promise.allSettled(started.map((a) => a.finished)).then(() => true);
    try {
      settled = await Promise.race([allFinished, timedOut]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
  // One frame so the settled style is painted, not just computed, before a capture.
  await nextFrame();
  return { settled, settleMs: now() - start };
}

function clampHoldMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_HOLD_MS;
  return Math.min(Math.round(value), MAX_HOLD_MS);
}

function clampSettleMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_SETTLE_TIMEOUT_MS;
  }
  return Math.min(Math.round(value), MAX_SETTLE_TIMEOUT_MS);
}

// ============================================================================
// Apply / release
// ============================================================================

function dispatchLeave(hold: Hold): void {
  if (hold.state !== 'hover') return;
  const view = hold.doc.defaultView ?? globalThis;
  const make = (type: string, bubbles: boolean): Event => {
    const init = { bubbles, cancelable: type.endsWith('out'), composed: true, relatedTarget: null };
    if (type.startsWith('pointer') && typeof view.PointerEvent === 'function') {
      return new view.PointerEvent(type, {
        ...init,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      });
    }
    return new view.MouseEvent(type, init);
  };
  try {
    // `out` bubbles through the chain; `leave` is sent to each marked element,
    // innermost first — the order a real pointer leaving the window produces.
    hold.target.dispatchEvent(make('pointerout', true));
    hold.target.dispatchEvent(make('mouseout', true));
    for (const el of hold.marked) {
      el.dispatchEvent(make('pointerleave', false));
      el.dispatchEvent(make('mouseleave', false));
    }
  } catch {
    // An app handler that throws must not stop the restore.
  }
}

async function releaseHold(
  current: Hold,
  reason: ForcedPseudoReleaseReason,
  borrowing = false
): Promise<ForcedPseudoReleaseReport> {
  const s = g();
  if (current.timer !== null) clearTimeout(current.timer);
  current.timer = null;
  if (s.hold === current) s.hold = null;
  if (!current.borrowed && !borrowing) s.generation += 1;

  const preexisting = runningAnimationSet(current.doc);
  const { rulesRestored, rulesAlreadyGone, selectorDrift } = restoreRewritten(
    current.rewritten,
    current.roots ?? []
  );
  let unmarkedElements = 0;
  for (const el of current.marked) {
    if (el.hasAttribute(current.attribute)) {
      el.removeAttribute(current.attribute);
      unmarkedElements += 1;
    }
  }
  dispatchLeave(current);

  // Flush style on the target so the reverse transitions exist, then wait.
  void readRevealValues(current.target);
  const { settled } = await settleAfter(current.doc, preexisting, current.settleTimeoutMs);

  const drift: ForcedPseudoDrift[] = [];
  for (const entry of current.verify) {
    if (!entry.element.isConnected) continue; // unmounted: it draws nothing, so it cannot drift
    const after = readRevealValues(entry.element);
    if (!after) continue;
    for (const property of REVEAL_PROPERTIES) {
      if (after[property] !== entry.before[property]) {
        drift.push({
          id: entry.id,
          property,
          before: entry.before[property],
          after: after[property],
        });
      }
    }
  }

  return {
    released: true,
    reason,
    state: current.state,
    holdId: current.holdId,
    rulesRestored,
    rulesAlreadyGone,
    selectorDrift,
    unmarkedElements,
    settled,
    heldMs: Date.now() - current.appliedAt,
    restore: drift.length > 0 || selectorDrift.length > 0 ? 'restored_with_drift' : 'verified',
    drift,
  };
}

function nothingHeld(reason: ForcedPseudoReleaseReason): ForcedPseudoReleaseReport {
  return {
    released: false,
    reason,
    rulesRestored: 0,
    rulesAlreadyGone: 0,
    selectorDrift: [],
    unmarkedElements: 0,
    restore: 'nothing_held',
    drift: [],
  };
}

function registeredElements(
  source: ForcedPseudoElementSource | undefined
): Array<{ id: string; element: Element }> {
  if (!source) return [];
  const out: Array<{ id: string; element: Element }> = [];
  try {
    for (const entry of source.getAllElements()) {
      if (entry.element && entry.element.isConnected) {
        out.push({ id: entry.id, element: entry.element });
      }
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * Force `target` into its CSS `:<state>` appearance and hold it until it is
 * released (explicitly, by a new apply, by {@link releaseAfter}, or by the TTL).
 */
export function forcePseudoState(
  target: Element,
  state: ForcedPseudoStateName,
  options: ForcePseudoStateOptions = {}
): Promise<ForcedPseudoReport> {
  return serialized(() => applyNow(target, state, options));
}

/**
 * Re-apply a hold taken with {@link snapshotForcedPseudoState} — only if the
 * pointer is idle when it runs and nobody but the borrower moved it since the
 * snapshot (the generation still matches). Decided INSIDE the serialized
 * queue, so a hold applied or released after the snapshot always wins. Returns
 * `null` when it did not apply (the pointer moved, something is held, the
 * target is gone, or the original deadline has passed).
 */
export function reapplyIfIdle(
  snapshot: ForcedPseudoHoldSnapshot
): Promise<ForcedPseudoReport | null> {
  return serialized(async () => {
    const s = g();
    // Someone else applied or released the page's hold since the snapshot:
    // the pointer has moved on, and the snapshot is history.
    if (s.generation !== snapshot.generation) return null;
    if (s.hold || !snapshot.target.isConnected) return null;
    // The deadline is the original one: time spent borrowed is not given back.
    const remainingMs = snapshot.expiresAt - Date.now();
    if (remainingMs <= 1) return null;
    return applyNow(
      snapshot.target,
      snapshot.state,
      {
        holdMs: remainingMs,
        settleTimeoutMs: snapshot.settleTimeoutMs,
        registry: snapshot.registry,
        afterMark: snapshot.afterMark,
      },
      snapshot.expiresAt
    );
  });
}

/** The apply itself. Always runs inside {@link serialized}. */
async function applyNow(
  target: Element,
  state: ForcedPseudoStateName,
  options: ForcePseudoStateOptions,
  /** Keep this exact expiry (a re-applied snapshot's original deadline). */
  deadline?: number
): Promise<ForcedPseudoReport> {
  const s = g();
  const borrowing = options.borrowedFrom !== undefined;
  const replaced = s.hold ? await releaseHold(s.hold, 'replaced', borrowing) : undefined;

  const holdMs = clampHoldMs(options.holdMs);
  const settleTimeoutMs = clampSettleMs(options.settleTimeoutMs);
  const attribute = pseudoStateAttribute(state);
  const doc = target.ownerDocument;

  // Before: every registered element's four properties, and the target's.
  const before = new Map<Element, { id: string; values: RevealValues }>();
  for (const { id, element } of registeredElements(options.registry)) {
    const values = readRevealValues(element);
    if (values) before.set(element, { id, values });
  }
  const targetBefore = readRevealValues(target);
  const preexisting = runningAnimationSet(doc);

  const scanStart = now();
  const scan = scanSheets(target, state);
  const scanMs = now() - scanStart;

  const marked = composedAncestry(target);
  for (const el of marked) el.setAttribute(attribute, '');

  const appliedAt = Date.now();
  const current: Hold = {
    holdId: s.nextHoldId++,
    state,
    attribute,
    target,
    doc,
    rewritten: scan.rewritten,
    marked,
    appliedAt,
    expiresAt: deadline ?? appliedAt + holdMs,
    settleTimeoutMs,
    timer: null,
    registry: options.registry,
    afterMark: options.afterMark,
    roots: scan.roots,
    borrowed: borrowing,
    verify: [],
    report: null,
  };
  s.hold = current;
  if (!borrowing) s.generation += 1;
  // Armed BEFORE the settle wait, so even an apply whose caller dies
  // mid-settle cannot leave the page altered.
  const timer = setTimeout(
    () => {
      void releaseIfCurrent(current, 'ttl');
    },
    Math.max(1, current.expiresAt - appliedAt)
  );
  (timer as { unref?: () => void }).unref?.();
  current.timer = timer;

  try {
    options.afterMark?.(target);
  } catch {
    // The JS half of a hover is best-effort; the CSS half is already applied.
  }

  // Read the target's style first, so a delayed transition has been CREATED
  // when the settle collects animations.
  void readRevealValues(target);
  const { settled, settleMs } = await settleAfter(doc, preexisting, settleTimeoutMs);

  const revealed: ForcedPseudoRevealed[] = [];
  const verify: VerifyEntry[] = [];
  let targetId = fingerprint(target);
  for (const { id, element } of registeredElements(options.registry)) {
    if (element === target) targetId = id;
    const after = readRevealValues(element);
    if (!after) continue;
    const prior = before.get(element);
    const changes: ForcedPseudoChange[] = [];
    for (const property of REVEAL_PROPERTIES) {
      const was = prior ? prior.values[property] : null;
      if (was !== after[property]) {
        changes.push({ property, before: was, after: after[property] });
      }
    }
    // A newly-registered element counts as revealed only when it draws.
    const appeared = !prior;
    if (
      appeared &&
      (after.display === 'none' || after.visibility === 'hidden' || parseFloat(after.opacity) === 0)
    ) {
      continue;
    }
    if (changes.length === 0) continue;
    const rect = element.getBoundingClientRect();
    revealed.push({
      id,
      appeared,
      changes,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
    if (prior && element !== target) verify.push({ id, element, before: prior.values });
  }
  if (targetBefore) verify.push({ id: targetId, element: target, before: targetBefore });
  current.verify = verify;

  const report: ForcedPseudoReport = {
    holdId: current.holdId,
    state,
    attribute,
    target: fingerprint(target),
    rulesRewritten: scan.rewritten.length,
    rulesFailed: scan.rulesFailed,
    rulesNotApplicable: scan.rulesNotApplicable,
    sheetsScanned: scan.sheetsScanned,
    unreadableSheets: scan.unreadableSheets,
    unreadableSheetHrefs: scan.unreadableSheetHrefs,
    complete: scan.unreadableSheets === 0 && scan.rulesFailed === 0,
    markedElements: marked.length,
    settled,
    settleMs,
    scanMs,
    holdMs,
    expiresAt: current.expiresAt,
    revealed,
    ...(replaced ? { replaced } : {}),
  };
  current.report = report;
  return report;
}

function releaseIfCurrent(
  expected: Hold,
  reason: ForcedPseudoReleaseReason
): Promise<ForcedPseudoReleaseReport> {
  return serialized(async () =>
    g().hold === expected ? releaseHold(expected, reason) : nothingHeld(reason)
  );
}

/**
 * Release the forced state, whichever element holds it. A no-op
 * (`released: false`, `restore: 'nothing_held'`) when nothing is held, so it is
 * safe to call defensively.
 */
export function releaseForcedPseudoState(
  reason: ForcedPseudoReleaseReason = 'explicit'
): Promise<ForcedPseudoReleaseReport> {
  return serialized(async () => {
    const current = g().hold;
    return current ? releaseHold(current, reason) : nothingHeld(reason);
  });
}

/**
 * Release the forced state only if it is still the hold `holdId` names — the
 * one the caller applied. A caller that borrowed the single pointer (the
 * design inspector) uses this so it can never release a hold someone else
 * applied after it.
 */
export function releaseForcedPseudoStateIfOwner(
  holdId: number,
  reason: ForcedPseudoReleaseReason = 'explicit',
  options: { borrowedFrom?: ForcedPseudoHoldSnapshot } = {}
): Promise<ForcedPseudoReleaseReport> {
  return serialized(async () => {
    const current = g().hold;
    return current && current.holdId === holdId
      ? releaseHold(current, reason, options.borrowedFrom !== undefined)
      : nothingHeld(reason);
  });
}

/** The current hold, or `null`. */
export function getForcedPseudoState(): ForcedPseudoHoldInfo | null {
  const current = g().hold;
  if (!current) return null;
  return {
    holdId: current.holdId,
    state: current.state,
    target: fingerprint(current.target),
    appliedAt: current.appliedAt,
    expiresAt: current.expiresAt,
    report: current.report,
  };
}

/**
 * Enough of the current hold to re-apply it later (`null` when nothing is
 * held). The design inspector takes one before it borrows the single pointer,
 * and puts the agent's hold back afterwards.
 */
export function snapshotForcedPseudoState(): ForcedPseudoHoldSnapshot | null {
  const current = g().hold;
  if (!current) return null;
  return {
    holdId: current.holdId,
    target: current.target,
    state: current.state,
    expiresAt: current.expiresAt,
    generation: g().generation,
    settleTimeoutMs: current.settleTimeoutMs,
    registry: current.registry,
    afterMark: current.afterMark,
  };
}

/**
 * Whether completing `action` releases a held forced state: the
 * `write`/`destructive` verbs of `STANDARD_ACTION_EFFECTS`. Read-class verbs
 * (`scroll`, `scrollIntoView`, `focus`, `blur`, `hover`, `unhover`) and verbs
 * the static map does not know (free-form custom actions) keep the hold — an
 * unknown effect is not evidence of a write.
 */
export function releasesForcedPseudoState(action: string): boolean {
  const effect = standardActionEffect(action);
  return effect === 'write' || effect === 'destructive';
}

export interface ReleaseAfterOptions {
  /** Receives the release report when a hold was released. */
  onRelease?: (report: ForcedPseudoReleaseReport) => void;
  /**
   * Classifies a thrown error as "refused before dispatch" (a click gate, a
   * visibility gate). Such a failure keeps the hold, because the runner
   * retries a refused or unresolved action, and a release on the failed first
   * attempt would make the retry hit `pointer-events:none`.
   */
  notDispatched?: (error: unknown) => boolean;
  /**
   * Whether the page was actually reached. A caller that hands the dispatch
   * to something that may fail BEFORE calling it (the effect verifier's
   * pre-observation) sets a flag inside the dispatch and reports it here; the
   * hold is released only when it returns true. Omitted = reached.
   */
  dispatched?: () => boolean;
}

/**
 * Run an action's dispatch and, when the action is write-class, release any
 * held forced state in its `finally` — after the action completes, so
 * `hover` header → `click` revealed button succeeds the way a real pointer
 * that hovered and then clicked would, and the page is returned to rest.
 *
 * Wrap only the dispatch: resolution and validation failures that return
 * before it never reach here, and so keep the hold.
 */
export async function releaseAfter<T>(
  action: string,
  dispatch: () => Promise<T> | T,
  options: ReleaseAfterOptions = {}
): Promise<T> {
  let dispatched = true;
  try {
    return await dispatch();
  } catch (error) {
    if (options.notDispatched?.(error)) dispatched = false;
    throw error;
  } finally {
    if (dispatched && (options.dispatched?.() ?? true)) {
      const report = await releaseHeldAfterDispatch(action);
      if (report) options.onRelease?.(report);
    }
  }
}

/**
 * The release half of {@link releaseAfter}, for a dispatch site that cannot
 * be wrapped in a closure (the relay's `executeElementAction` calls it itself).
 * Releases a held forced state when `action` is write-class and returns the
 * report; `undefined` when nothing was released. Whether anything is held is
 * decided inside the serialized queue, never before it.
 */
export async function releaseHeldAfterDispatch(
  action: string
): Promise<ForcedPseudoReleaseReport | undefined> {
  if (!releasesForcedPseudoState(action)) return undefined;
  const report = await releaseForcedPseudoState('next-action');
  return report.released ? report : undefined;
}

/** Test-only: release any hold, so suites start clean. */
export async function __resetForcedPseudoStateForTest(): Promise<void> {
  await releaseForcedPseudoState('explicit');
}
