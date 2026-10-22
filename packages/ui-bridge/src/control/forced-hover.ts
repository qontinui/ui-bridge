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
 *  1. CSSOM TWIN RULES. Every readable stylesheet in scope is walked. For each
 *     style rule whose own selector contains an unescaped `:hover`, the rule's
 *     `cssText` is inserted as a sibling directly after it, in the same parent
 *     (sheet, `@media`/`@supports`/`@container`/`@layer` block, or nesting
 *     parent), and the twin's `selectorText` — and that of every style rule
 *     nested inside it — is rewritten THROUGH THE CSSOM SETTER, replacing the
 *     pseudo-class with `[data-ui-bridge-pseudo-hover]`. Serialized rule text
 *     is never regex-edited: a minified `(hover:hover)` media condition would
 *     be hit. The twin sits at the same nesting, layer and condition, and an
 *     attribute selector has the same specificity as a pseudo-class (0,1,0),
 *     so the cascade order is unchanged.
 *  2. MARK THE CHAIN. The attribute is set on the target and every ancestor on
 *     its composed path (crossing shadow roots to their hosts). A real `:hover`
 *     applies to the hovered element and all its ancestors, so this is the
 *     browser's own semantics, not a heuristic — and it is what makes a
 *     Tailwind `group-hover:` rule keyed on a `.group` ancestor fire.
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
 *  - One forced state at a time, like one pointer. A new apply releases the
 *    old one first (reason `replaced`).
 *  - It never leaks. A TTL (`holdMs`, default 30 s, ceiling 300 s) releases it
 *    by itself, so a caller that dies mid-run cannot leave the page altered.
 *    {@link releaseAfter} releases it after a dispatched write-class action.
 *  - Release removes every twin by OBJECT IDENTITY in its parent (indices shift
 *    as rules come and go), removes every attribute, sends the leave events a
 *    real pointer would (`pointerout`/`mouseout` on the target, bubbling;
 *    `pointerleave`/`mouseleave` on every marked element), waits for the
 *    resulting transitions, and then VERIFIES AGAINST WHAT RENDERS: each
 *    revealed element's four properties (and the target's) must read their
 *    before-apply values. Anything else is `restored_with_drift`, naming the
 *    element and property, and never `verified`.
 *  - Completeness is honest. A sheet whose `cssRules` throws (cross-origin) is
 *    counted in `unreadableSheets` and never skipped silently; `complete` is
 *    `false` whenever one was, because its `:hover` rules were not forced.
 *
 * LIMITS (documented on the action, not hidden):
 *  - App JS reading `el.matches(':hover')` still sees `false`. JS keyed on
 *    `mouseenter`/`pointerenter` is covered by the enter events the callers
 *    keep dispatching.
 *  - A rule the app inserts during the hold is not twinned; a sheet replaced
 *    during the hold drops its twins with it. Both surface as drift in the
 *    verified restore rather than being hidden.
 *  - `:hover` inside an attribute-selector string, or after an escaped
 *    backslash (`.a\\:hover`), is outside the rewrite's grammar.
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
  state: ForcedPseudoStateName;
  /** The attribute the twins key on and the chain carries. */
  attribute: string;
  /** A short fingerprint of the target (`tag#id` / `tag.class`). */
  target: string;
  /** Twin rules inserted (and installed) for this hold. */
  rulesCloned: number;
  /** Matching rules a twin could not be installed for (insert or rewrite refused). */
  rulesFailed: number;
  /** Stylesheets walked, including `@import`ed ones. */
  sheetsScanned: number;
  /** Stylesheets whose rules could not be read (cross-origin). Their rules were NOT forced. */
  unreadableSheets: number;
  /** The hrefs of the unreadable sheets, where they have one. */
  unreadableSheetHrefs: string[];
  /** False when any sheet was unreadable or any twin failed: the reveal is then UNKNOWN-complete. */
  complete: boolean;
  /** Elements given the attribute: the target and its composed ancestors. */
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

/** What a release did, and whether the page is verifiably back. */
export interface ForcedPseudoReleaseReport {
  /** False when nothing was held: the release was a no-op. */
  released: boolean;
  reason: ForcedPseudoReleaseReason;
  state?: ForcedPseudoStateName;
  /** Twin rules found by identity and deleted. */
  rulesRemoved: number;
  /** Twin rules already gone (their sheet was replaced or the app deleted them). */
  rulesAlreadyGone: number;
  unmarkedElements: number;
  settled?: ForcedPseudoSettle;
  /** How long the state was held. */
  heldMs?: number;
  /**
   * `verified`: every revealed element (and the target) reads its
   * before-apply values again. `restored_with_drift`: at least one does not
   * (see `drift`). `nothing_held`: there was nothing to release.
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
}

/** The current hold, as {@link getForcedPseudoState} reports it. */
export interface ForcedPseudoHoldInfo {
  state: ForcedPseudoStateName;
  target: string;
  appliedAt: number;
  expiresAt: number;
  report: ForcedPseudoReport | null;
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

/** The attribute the twins key on and the marked chain carries. */
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

/** Whether a selector contains the forced pseudo-class (not as an escaped class-name fragment). */
export function selectorHasPseudo(selector: string, state: ForcedPseudoStateName): boolean {
  const pattern = PSEUDO_PATTERNS[state];
  pattern.lastIndex = 0;
  const hit = pattern.test(selector);
  pattern.lastIndex = 0;
  return hit;
}

/**
 * Replace every unescaped `:<state>` in a selector with the attribute selector.
 * `:not(:hover)` becomes `:not([attr])`, which keeps its meaning; a pseudo
 * inside `:is()`/`:where()`/`:has()` is rewritten in place.
 */
export function rewritePseudoSelector(selector: string, state: ForcedPseudoStateName): string {
  const pattern = PSEUDO_PATTERNS[state];
  pattern.lastIndex = 0;
  return selector.replace(pattern, `[${pseudoStateAttribute(state)}]`);
}

// ============================================================================
// CSSOM walk
// ============================================================================

/** Anything rules can be inserted into: a sheet, a grouping rule, or (CSS nesting) a style rule. */
interface RuleContainer {
  readonly cssRules: CSSRuleList;
  insertRule(rule: string, index?: number): number;
  deleteRule(index: number): void;
}

interface InstalledTwin {
  twin: CSSRule;
  parent: RuleContainer;
}

interface ScanResult {
  twins: InstalledTwin[];
  rulesFailed: number;
  sheetsScanned: number;
  unreadableSheets: number;
  unreadableSheetHrefs: string[];
}

/** Every twin this module has ever installed. The walker skips them, so index-order insertion never revisits one. */
const installedTwins = new WeakSet<CSSRule>();

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  // Duck-typed so a rule from another realm (an iframe's sheet) is still
  // recognised. A `CSSPageRule` also has `selectorText`, but no page selector
  // can contain `:hover`/`:active`.
  return typeof (rule as Partial<CSSStyleRule>).selectorText === 'string';
}

function asContainer(rule: CSSRule): RuleContainer | null {
  const c = rule as unknown as Partial<RuleContainer>;
  // `@keyframes` has `cssRules` but `appendRule`, not `insertRule`, and its
  // keyframes carry no selector — it is correctly excluded here.
  if (c.cssRules && typeof c.insertRule === 'function' && typeof c.deleteRule === 'function') {
    return c as RuleContainer;
  }
  return null;
}

function importedSheet(rule: CSSRule): CSSStyleSheet | null {
  const r = rule as Partial<CSSImportRule>;
  if ('href' in r && 'styleSheet' in r && r.styleSheet) return r.styleSheet;
  return null;
}

/** Rewrite the selector of a rule and of every style rule nested inside it, through the CSSOM setter. */
function rewriteRuleTree(rule: CSSRule, state: ForcedPseudoStateName): void {
  if (isStyleRule(rule) && selectorHasPseudo(rule.selectorText, state)) {
    rule.selectorText = rewritePseudoSelector(rule.selectorText, state);
  }
  const container = asContainer(rule);
  if (!container) return;
  for (let i = 0; i < container.cssRules.length; i++) {
    rewriteRuleTree(container.cssRules[i], state);
  }
}

function ruleIndexOf(parent: RuleContainer, rule: CSSRule): number {
  return Array.prototype.indexOf.call(parent.cssRules, rule) as number;
}

/**
 * Insert `rule`'s twin directly after it (at `index + 1`) and rewrite it.
 * Returns the twin, or `null` when the browser refused the insert or the
 * rewrite (an invalid rewritten selector is silently ignored by the setter,
 * which would leave an exact duplicate — harmless, but not a twin).
 */
function installTwin(
  parent: RuleContainer,
  rule: CSSStyleRule,
  index: number,
  state: ForcedPseudoStateName
): CSSRule | null {
  let at: number;
  try {
    at = parent.insertRule(rule.cssText, index + 1);
  } catch {
    return null;
  }
  const twin = parent.cssRules[at];
  if (!twin) return null;
  try {
    rewriteRuleTree(twin, state);
  } catch {
    // fall through to the check below
  }
  if (!isStyleRule(twin) || selectorHasPseudo(twin.selectorText, state)) {
    try {
      parent.deleteRule(at);
    } catch {
      // A twin that cannot even be removed is a duplicate of a real rule:
      // inert for the cascade.
    }
    return null;
  }
  installedTwins.add(twin);
  return twin;
}

function walkRules(
  parent: RuleContainer,
  state: ForcedPseudoStateName,
  out: ScanResult,
  visit: (sheet: CSSStyleSheet) => void
): void {
  const list = parent.cssRules;
  for (let i = 0; i < list.length; i++) {
    const rule = list[i];
    if (installedTwins.has(rule)) continue;

    const imported = importedSheet(rule);
    if (imported) {
      visit(imported);
      continue;
    }

    if (isStyleRule(rule) && selectorHasPseudo(rule.selectorText, state)) {
      const twin = installTwin(parent, rule, i, state);
      if (twin) {
        out.twins.push({ twin, parent });
        // Step over the twin just inserted at i + 1. The original is NOT
        // descended into: its nested `:hover` rules were rewritten inside the
        // twin, so they are twinned exactly once.
        i += 1;
      } else {
        out.rulesFailed += 1;
      }
      continue;
    }

    const container = asContainer(rule);
    if (container) walkRules(container, state, out, visit);
  }
}

function shadowRootOf(node: Node): ShadowRoot | null {
  const root = node.getRootNode?.();
  if (root && root !== node && (root as ShadowRoot).host instanceof Element) {
    return root as ShadowRoot;
  }
  return null;
}

/** The target and every ancestor on its composed path, innermost first (shadow roots are crossed to their hosts). */
export function composedAncestry(target: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = target;
  while (current) {
    chain.push(current);
    if (current.parentElement) {
      current = current.parentElement;
    } else {
      current = shadowRootOf(current)?.host ?? null;
    }
  }
  return chain;
}

/** The sheets in scope: the document's, its adopted ones, and those of every shadow root on the target's composed path. */
function sheetsInScope(target: Element): CSSStyleSheet[] {
  const out: CSSStyleSheet[] = [];
  const seen = new Set<CSSStyleSheet>();
  const add = (sheet: CSSStyleSheet | null | undefined): void => {
    if (sheet && !seen.has(sheet)) {
      seen.add(sheet);
      out.push(sheet);
    }
  };
  const addRoot = (root: Document | ShadowRoot): void => {
    for (const sheet of Array.from(root.styleSheets ?? [])) add(sheet as CSSStyleSheet);
    for (const sheet of root.adoptedStyleSheets ?? []) add(sheet);
  };
  if (typeof document !== 'undefined') addRoot(document);
  const roots = new Set<ShadowRoot>();
  for (const el of composedAncestry(target)) {
    const root = shadowRootOf(el);
    if (root && !roots.has(root)) {
      roots.add(root);
      addRoot(root);
    }
  }
  return out;
}

function scanSheets(target: Element, state: ForcedPseudoStateName): ScanResult {
  const out: ScanResult = {
    twins: [],
    rulesFailed: 0,
    sheetsScanned: 0,
    unreadableSheets: 0,
    unreadableSheetHrefs: [],
  };
  const scanned = new Set<CSSStyleSheet>();
  const visit = (sheet: CSSStyleSheet): void => {
    if (scanned.has(sheet)) return;
    scanned.add(sheet);
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      out.unreadableSheets += 1;
      if (sheet.href) out.unreadableSheetHrefs.push(sheet.href);
      return;
    }
    if (!rules) {
      out.unreadableSheets += 1;
      if (sheet.href) out.unreadableSheetHrefs.push(sheet.href);
      return;
    }
    out.sheetsScanned += 1;
    walkRules(sheet as unknown as RuleContainer, state, out, visit);
  };
  for (const sheet of sheetsInScope(target)) visit(sheet);
  return out;
}

// ============================================================================
// Style reads, settle
// ============================================================================

function readRevealValues(el: Element): RevealValues | null {
  try {
    const cs = getComputedStyle(el);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    setTimeout(finish, typeof requestAnimationFrame === 'function' ? FRAME_WAIT_CAP_MS : 0);
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
function runningAnimationSet(): Set<Animation> {
  return new Set(readRunningAnimations().animations.map((a) => a.animation));
}

/**
 * Wait for every finite animation started since `preexisting` was read.
 * Infinite animations (spinners) never finish and are not waited on.
 */
async function settleAfter(
  preexisting: Set<Animation>,
  timeoutMs: number
): Promise<{ settled: ForcedPseudoSettle; settleMs: number }> {
  const start = now();
  const read = readRunningAnimations();
  if (!read.available) {
    await nextFrame();
    return { settled: 'frame-only', settleMs: now() - start };
  }
  const started = read.animations
    .map((a) => a.animation)
    .filter((a) => !preexisting.has(a) && !isInfinite(a));
  let settled = true;
  if (started.length > 0) {
    const allFinished = Promise.allSettled(started.map((a) => a.finished)).then(() => true);
    settled = await Promise.race([allFinished, delay(timeoutMs).then(() => false)]);
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
// The single hold
// ============================================================================

interface VerifyEntry {
  id: string;
  element: Element;
  before: RevealValues;
}

interface Hold {
  state: ForcedPseudoStateName;
  attribute: string;
  target: Element;
  twins: InstalledTwin[];
  marked: Element[];
  appliedAt: number;
  expiresAt: number;
  settleTimeoutMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Elements whose four properties must read their before values after release. */
  verify: VerifyEntry[];
  report: ForcedPseudoReport | null;
}

let hold: Hold | null = null;

/** Apply and release are serialized: a release never interleaves with an apply's settle. */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function dispatchLeave(hold: Hold): void {
  if (hold.state !== 'hover') return;
  const make = (type: string, bubbles: boolean): Event => {
    const init = { bubbles, cancelable: type.endsWith('out'), composed: true, relatedTarget: null };
    if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
      return new PointerEvent(type, {
        ...init,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      });
    }
    return new MouseEvent(type, init);
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
  reason: ForcedPseudoReleaseReason
): Promise<ForcedPseudoReleaseReport> {
  if (current.timer !== null) clearTimeout(current.timer);
  current.timer = null;
  if (hold === current) hold = null;

  const preexisting = runningAnimationSet();
  let rulesRemoved = 0;
  let rulesAlreadyGone = 0;
  for (const { twin, parent } of current.twins) {
    try {
      const idx = ruleIndexOf(parent, twin);
      if (idx < 0) {
        rulesAlreadyGone += 1;
        continue;
      }
      parent.deleteRule(idx);
      rulesRemoved += 1;
    } catch {
      rulesAlreadyGone += 1;
    }
  }
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
  const { settled } = await settleAfter(preexisting, current.settleTimeoutMs);

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
    rulesRemoved,
    rulesAlreadyGone,
    unmarkedElements,
    settled,
    heldMs: Date.now() - current.appliedAt,
    restore: drift.length > 0 ? 'restored_with_drift' : 'verified',
    drift,
  };
}

function nothingHeld(reason: ForcedPseudoReleaseReason): ForcedPseudoReleaseReport {
  return {
    released: false,
    reason,
    rulesRemoved: 0,
    rulesAlreadyGone: 0,
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
      if (entry.element && entry.element.isConnected)
        out.push({ id: entry.id, element: entry.element });
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
  return serialized(async () => {
    const replaced = hold ? await releaseHold(hold, 'replaced') : undefined;

    const holdMs = clampHoldMs(options.holdMs);
    const settleTimeoutMs = clampSettleMs(options.settleTimeoutMs);
    const attribute = pseudoStateAttribute(state);

    // Before: every registered element's four properties, and the target's.
    const before = new Map<Element, { id: string; values: RevealValues }>();
    for (const { id, element } of registeredElements(options.registry)) {
      const values = readRevealValues(element);
      if (values) before.set(element, { id, values });
    }
    const targetBefore = readRevealValues(target);
    const preexisting = runningAnimationSet();

    const scanStart = now();
    const scan = scanSheets(target, state);
    const scanMs = now() - scanStart;

    const marked = composedAncestry(target);
    for (const el of marked) el.setAttribute(attribute, '');

    const appliedAt = Date.now();
    const current: Hold = {
      state,
      attribute,
      target,
      twins: scan.twins,
      marked,
      appliedAt,
      expiresAt: appliedAt + holdMs,
      settleTimeoutMs,
      timer: null,
      verify: [],
      report: null,
    };
    hold = current;
    // Armed BEFORE the settle wait, so even an apply whose caller dies
    // mid-settle cannot leave the page altered.
    const timer = setTimeout(() => {
      void releaseForcedPseudoStateIf(current, 'ttl');
    }, holdMs);
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
    const { settled, settleMs } = await settleAfter(preexisting, settleTimeoutMs);

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
        if (was !== after[property])
          changes.push({ property, before: was, after: after[property] });
      }
      // A newly-registered element counts as revealed only when it draws.
      const appeared = !prior;
      if (
        appeared &&
        (after.display === 'none' ||
          after.visibility === 'hidden' ||
          parseFloat(after.opacity) === 0)
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
      state,
      attribute,
      target: fingerprint(target),
      rulesCloned: scan.twins.length,
      rulesFailed: scan.rulesFailed,
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
  });
}

function releaseForcedPseudoStateIf(
  expected: Hold,
  reason: ForcedPseudoReleaseReason
): Promise<ForcedPseudoReleaseReport> {
  return serialized(async () =>
    hold === expected ? releaseHold(expected, reason) : nothingHeld(reason)
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
  return serialized(async () => (hold ? releaseHold(hold, reason) : nothingHeld(reason)));
}

/** The current hold, or `null`. */
export function getForcedPseudoState(): ForcedPseudoHoldInfo | null {
  if (!hold) return null;
  return {
    state: hold.state,
    target: fingerprint(hold.target),
    appliedAt: hold.appliedAt,
    expiresAt: hold.expiresAt,
    report: hold.report,
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
    if (dispatched) {
      const report = await releaseHeldAfterDispatch(action);
      if (report) options.onRelease?.(report);
    }
  }
}

/**
 * The release half of {@link releaseAfter}, for a dispatch site that cannot
 * be wrapped in a closure (the relay's `executeElementAction` calls it from
 * its own `finally`). Releases a held forced state when `action` is
 * write-class and returns the report; `undefined` when nothing was released.
 */
export async function releaseHeldAfterDispatch(
  action: string
): Promise<ForcedPseudoReleaseReport | undefined> {
  if (!releasesForcedPseudoState(action) || !hold) return undefined;
  const report = await releaseForcedPseudoState('next-action');
  return report.released ? report : undefined;
}

/** Test-only: drop any hold without verification, so suites start clean. */
export async function __resetForcedPseudoStateForTest(): Promise<void> {
  await releaseForcedPseudoState('explicit');
}
