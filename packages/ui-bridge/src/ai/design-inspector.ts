/**
 * Design Inspector Module
 *
 * Browser-side functions for extracting design-relevant computed styles,
 * capturing interaction state variations, and responsive snapshots.
 *
 * These functions run in the browser context and use window.getComputedStyle().
 */

import type {
  ExtendedComputedStyles,
  FocusVisibleMatch,
  InteractionStateName,
  StateStyles,
  StyleDiff,
  PseudoElementStyles,
  ElementDesignData,
  ResponsiveSnapshot,
} from '../core/types';
import { classString } from '../core/class-name';
import { REDACTED_VALUE, scrubContent, scrubContentRequired, verdictOf } from '../core/redaction';
import { withRootWidthLock } from '../core/root-width-lock';
import {
  TokenIndexBuilder,
  disposeTokenIndex,
  beginReadPass,
  redactionGraphFor,
  noReportedTokens,
  scrubScriptValue,
  referencesOf,
  reportedTokensOf,
  tokenMatchesOf,
  tokenScopesOf,
  type DesignTokenIndex,
  type ReportedTokens,
} from './design-tokens';
import { styleRules, type StyleBlock, type WalkedRule } from './stylesheet-walk';
import {
  graphFor,
  inlineNamesInScope,
  referencesAnyOf,
  type RedactionGraph,
} from './redaction-graph';
import {
  forcePseudoState,
  reapplyIfIdle,
  releaseForcedPseudoStateIfOwner,
  snapshotForcedPseudoState,
  type ForcedPseudoHoldSnapshot,
} from '../control/forced-hover';

// ============================================================================
// Constants
// ============================================================================

/**
 * CSS properties extracted for design review
 */
const DESIGN_PROPERTIES: (keyof ExtendedComputedStyles)[] = [
  // Layout
  'display',
  'position',
  'boxSizing',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'overflow',
  'overflowX',
  'overflowY',

  // Flex/Grid
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignSelf',
  'gap',
  'gridTemplateColumns',
  'gridTemplateRows',

  // Typography
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecoration',
  'color',

  // Visual
  'backgroundColor',
  'backgroundImage',
  'border',
  'borderRadius',
  'boxShadow',
  'opacity',
  'outline',

  // Effects
  'transform',
  'transition',
  'cursor',
  'zIndex',
  'visibility',
  'pointerEvents',
];

/**
 * Interaction states to cycle through for state variation capture
 */
export const INTERACTION_STATES: readonly InteractionStateName[] = [
  'hover',
  'focus',
  'focus-visible',
  'active',
  'disabled',
];

/**
 * Default viewport breakpoints
 */
export const DEFAULT_VIEWPORTS: Record<string, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 1280,
  wide: 1920,
};

// ============================================================================
// Core Style Extraction
// ============================================================================

/**
 * Extract extended computed styles from an element.
 * Uses window.getComputedStyle() to read ~40 design-relevant CSS properties.
 */
export function getExtendedComputedStyles(el: HTMLElement): ExtendedComputedStyles {
  const computed = window.getComputedStyle(el);
  const styles = {} as ExtendedComputedStyles;
  const redacted = verdictOf(el).content;

  for (const prop of DESIGN_PROPERTIES) {
    // CSSStyleDeclaration uses camelCase property access
    const value =
      computed.getPropertyValue(camelToKebab(prop)) ||
      (computed as unknown as Record<string, string>)[prop] ||
      '';
    styles[prop] = redacted ? scrubStyleUrls(value) : value;
  }

  return styles;
}

/**
 * §4.6 CONTENT axis for computed style values: every `url(…)` reference of a
 * content-redacted element becomes `url("[REDACTED]")`.
 *
 * A URL names the resource the element shows — an avatar keyed by a user, a
 * document preview, a signed URL whose query carries a bearer token — which is
 * content, not design. Scrubbing only the query would still leak the path. The
 * rest of the value (gradient layers, `cursor` keyword fallbacks) is design
 * data and stays, so a redacted element still reports THAT it has a
 * background image and how it is layered. Values without `url(` are
 * untouched. Elements outside a redaction boundary keep their URLs, as every
 * other projection keeps their content.
 */
export function scrubStyleUrls(value: string): string {
  const lower = value.toLowerCase();
  let scrubbed = value;
  if (lower.includes('url(')) {
    scrubbed = scrubbed.replace(
      /url\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)]*)\s*\)/gi,
      `url("${REDACTED_VALUE}")`
    );
  }
  // `image-set("a.png" 1x, …)` / `-webkit-image-set(…)` name images with bare
  // quoted strings as well as `url(…)`.
  if (lower.includes('image-set(')) {
    scrubbed = scrubbed.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, `"${REDACTED_VALUE}"`);
  }
  return scrubbed;
}

/**
 * Get full design data for an element, including optional pseudo-elements.
 *
 * `customProperties` says how to read the element's CSS custom properties: an
 * index built once for a batch of elements (`indexCustomProperties`), or
 * `false` to skip them because nothing downstream reads them. Absent, they are
 * read for this element alone.
 */
export function getElementDesignData(
  el: HTMLElement,
  opts?: {
    includePseudoElements?: boolean;
    elementId?: string;
    label?: string;
    type?: string;
    customProperties?: CustomPropertyIndex | false;
    /** Attribute design properties to tokens (default `true` with an index). */
    attributeTokens?: boolean;
  }
): ElementDesignData {
  const rect = el.getBoundingClientRect();
  const styles = getExtendedComputedStyles(el);
  const pseudoElements: PseudoElementStyles[] = [];

  if (opts?.includePseudoElements) {
    for (const selector of ['::before', '::after'] as const) {
      const pseudo = getPseudoElementStyles(el, selector);
      if (pseudo) {
        pseudoElements.push(pseudo);
      }
    }
  }

  const index = opts?.customProperties;
  const customProperties = index === false ? {} : getCSSCustomProperties(el, index);
  // With a batch index, the element names the token scopes it sits in and its
  // design properties are attributed to tokens; the root tokens and the
  // scopes' values are reported once, by the response. An element the index
  // never reached (a shadow tree, detached) is flagged instead.
  const tokens = index !== false && index !== undefined ? index.tokens : undefined;
  const covered = tokens !== undefined && el.getRootNode() === tokens.document;
  const scopes = covered ? tokenScopesOf(el, tokens) : [];

  return {
    elementId: opts?.elementId || el.id || el.getAttribute('data-testid') || '',
    // §4.6 CONTENT axis: callers pass the registry's raw `label` (the registry
    // scrubs it only when it serializes), so a `data-bridge-redact` element's
    // label must collapse here — every design and quality route builds its
    // per-element payload through this one constructor.
    label: scrubContent(opts?.label, el),
    type: opts?.type || el.tagName.toLowerCase(),
    styles,
    pseudoElements: pseudoElements.length > 0 ? pseudoElements : undefined,
    customProperties: Object.keys(customProperties).length > 0 ? customProperties : undefined,
    tokenMatches:
      covered && opts?.attributeTokens !== false ? tokenMatchesOf(el, styles, tokens) : undefined,
    tokenScopes: scopes.length > 0 ? scopes : undefined,
    tokenAnalysis: tokens !== undefined && !covered ? 'uncovered' : undefined,
    className: classString(el) || undefined,
    classes: el.classList.length > 0 ? Array.from(el.classList) : undefined,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

// ============================================================================
// State Variation Capture
// ============================================================================

/**
 * Capture style variations across interaction states (hover, focus,
 * focus-visible, active, disabled). The `focus` entry carries `focusVisible`:
 * whether the browser's own `:focus-visible` matched while it was held.
 *
 * Dispatches synthetic events to trigger state changes, reads computed styles,
 * then restores the element to its default state. All wrapped in try/finally.
 *
 * Note: This modifies element state temporarily. Should not be called during
 * user interaction.
 */
export async function captureStateVariations(
  el: HTMLElement,
  states?: readonly InteractionStateName[]
): Promise<StateStyles[]> {
  const targetStates = states || INTERACTION_STATES;

  // The page has ONE forced pseudo-state (one pointer). If an agent is holding
  // a `hover` right now, inspection borrows the pointer: the agent's hold is
  // suspended (so `default` is read at rest, not hovered), and re-applied with
  // the TTL it had left once inspection is done. Inspection only ever releases
  // the holds it created itself (by hold id).
  const agentHold = snapshotForcedPseudoState();
  if (agentHold) {
    await releaseForcedPseudoStateIfOwner(agentHold.holdId, 'replaced', {
      borrowedFrom: agentHold,
    });
  }
  try {
    return await captureEachState(el, targetStates, agentHold ?? undefined);
  } finally {
    // Inside the serialized queue, and only if the pointer is idle: a hover
    // someone applied while inspection ran is newer, and wins. The re-apply
    // replays the original hover's JS half (its enter events) too.
    if (agentHold) await reapplyIfIdle(agentHold);
  }
}

async function captureEachState(
  el: HTMLElement,
  targetStates: readonly InteractionStateName[],
  borrowedFrom: ForcedPseudoHoldSnapshot | undefined
): Promise<StateStyles[]> {
  const defaultStyles = getExtendedComputedStyles(el);
  const results: StateStyles[] = [];

  // Add default state
  results.push({
    state: 'default',
    styles: defaultStyles,
    diffFromDefault: [],
  });

  for (const stateName of targetStates) {
    if (stateName === 'default') continue;

    let restore: (() => Promise<void>) | null = null;
    try {
      // Apply the state. `hover`/`active` force the real CSS pseudo-class and
      // wait for the transitions it started, so the read below is the settled
      // state appearance rather than a frame of a fade.
      const applied = await applyInteractionState(el, stateName, borrowedFrom);
      restore = applied.restore;
      await waitFrame();

      // Read styles in the new state
      const stateStyles = getExtendedComputedStyles(el);
      const diff = computeStyleDiff(defaultStyles, stateStyles);

      const entry: StateStyles = {
        state: stateName,
        styles: stateStyles,
        diffFromDefault: diff,
      };
      // Inside the hold: whether the browser's own `:focus-visible` matched
      // the focus just applied, so a reader knows which focus appearance
      // the `focus` entry's styles are — or `'not_focused'` when the focus
      // never landed, so there is no focus appearance at all.
      if (stateName === 'focus') entry.focusVisible = readFocusVisible(el);
      // The focus-visible entry says whether the focus landed: when it did
      // not, nothing was forced and its styles are the unfocused ones.
      if (stateName === 'focus-visible') entry.focused = applied.focused ?? false;
      results.push(entry);
    } finally {
      // Always restore to default state
      if (restore) await restore();
      await waitFrame();
    }
  }

  return results;
}

// ============================================================================
// Responsive Snapshot
// ============================================================================

/**
 * Registry-like interface for accessing registered elements
 */
export interface DesignRegistryLike {
  getAllElements(): Array<{
    id: string;
    element: HTMLElement;
    type: string;
    label?: string;
  }>;
}

/**
 * How `captureResponsiveSnapshots` narrows the page, as every response that
 * carries its snapshots reports it (`method`).
 *
 * The root element's width is constrained; the browser window is not resized.
 * `window.innerWidth` and the viewport the CSS `@media` width queries read are
 * therefore UNCHANGED, so a `@media (max-width: …)` breakpoint does not switch,
 * and neither does JS reading `window.innerWidth` or `matchMedia`. What does
 * re-flow is everything sized against its container: percentage and flex/grid
 * layout, wrapping text, and `@container` queries.
 */
export const RESPONSIVE_SNAPSHOT_METHOD = 'document-width-constraint' as const;

/**
 * The root inline-style longhands a root-width constraint sets:
 * `captureResponsiveSnapshots` sets and restores them per capture, and
 * `/control/viewport-constraints` (`specs/design-request.ts`) sets and clears
 * them on request, so both narrow the page the same way.
 */
export const CONSTRAINED_ROOT_PROPERTIES = [
  'width',
  'min-width',
  'max-width',
  'overflow-x',
  'overflow-y',
] as const;

/** What `captureResponsiveSnapshots` captured, and how. */
export interface ResponsiveCapture extends ReportedTokens {
  /** One snapshot per viewport captured, in request order. */
  snapshots: ResponsiveSnapshot[];
  /**
   * `true` when the lock's deadline ran out between viewports, so the
   * capture stopped early; `snapshots` holds the viewports it did capture.
   */
  timedOut: boolean;
  /**
   * `true` when the tab was hidden, so no animation frame was awaited: a
   * hidden tab runs no frames and throttles timers to a second or more. The
   * forced reflow and `getComputedStyle` still read the settled layout, but
   * a `requestAnimationFrame`-driven update on the page had no chance to run.
   */
  framesSkipped: boolean;
}

/**
 * Capture design snapshots at multiple root-element widths.
 *
 * Constrains `document.documentElement`'s inline width per viewport, forces a
 * reflow, reads every element, and restores the root's inline styles (value
 * AND priority, per longhand, removing the `style` attribute again if the root
 * had none) in a `finally`, so a throw mid-capture still restores the page.
 *
 * This is NOT a narrow viewport: see `RESPONSIVE_SNAPSHOT_METHOD`. `@media`
 * width queries and JS reading `window.innerWidth` do not re-evaluate.
 *
 * Custom properties are indexed once for the batch (`indexCustomProperties`);
 * which rules declare them does not depend on the width, only their computed
 * values do, and those are read per viewport.
 */
export function captureResponsiveSnapshots(
  registry: DesignRegistryLike,
  viewports: Record<string, number> | number[],
  options: { budgetMs?: number } = {}
): Promise<ResponsiveCapture> {
  // Serialized with every other root-width mutation (`core/root-width-lock`):
  // an overlapping capture would otherwise save this one's constraint as the
  // page's original and restore it last. The registry is read inside the
  // lock, so the selection is the page as it is when the capture runs.
  return withRootWidthLock((deadline) => captureUnderRootWidthLock(registry, viewports, deadline), {
    budgetMs: options.budgetMs,
  });
}

async function captureUnderRootWidthLock(
  registry: DesignRegistryLike,
  viewports: Record<string, number> | number[],
  deadline: number
): Promise<ResponsiveCapture> {
  const viewportEntries: Array<[string, number]> = Array.isArray(viewports)
    ? viewports.map((w) => [`${w}px`, w])
    : Object.entries(viewports);

  const docEl = document.documentElement;
  const hadStyleAttribute = docEl.hasAttribute('style');
  const original = CONSTRAINED_ROOT_PROPERTIES.map((prop) => ({
    prop,
    value: docEl.style.getPropertyValue(prop),
    priority: docEl.style.getPropertyPriority(prop),
  }));
  const snapshots: ResponsiveSnapshot[] = [];
  let timedOut = false;
  let framesSkipped = false;
  let index: CustomPropertyIndex | undefined;

  try {
    const elements = registry.getAllElements();
    // Indexed before the root is constrained: which rules declare and
    // reference tokens does not depend on the width, and the root tokens are
    // reported as the page has them.
    const customProperties = indexCustomProperties(
      document,
      elements.map((regEl) => regEl.element)
    );
    index = customProperties;
    let firstViewport = true;
    for (const [label, width] of viewportEntries) {
      // Out of time: stop here and restore, rather than keep the live page
      // narrowed after the caller has been told "timeout".
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      // Constrain the root width
      docEl.style.setProperty('width', `${width}px`);
      docEl.style.setProperty('min-width', `${width}px`);
      docEl.style.setProperty('max-width', `${width}px`);
      docEl.style.setProperty('overflow-x', 'hidden');
      docEl.style.setProperty('overflow-y', 'hidden');

      // Force reflow
      void docEl.offsetHeight;
      if (!(await waitFrame())) framesSkipped = true;

      // A new read pass: the redaction graphs are re-validated once for this
      // viewport (a stylesheet edited since the last one is seen), not per
      // element.
      beginReadPass(customProperties.tokens);

      // Attribution is width-independent here (`@media` does not re-evaluate
      // under a root-width constraint), so it is read once, at the first
      // viewport, rather than repeated per snapshot.
      const elementData: ElementDesignData[] = elements.map((regEl) =>
        getElementDesignData(regEl.element, {
          elementId: regEl.id,
          label: regEl.label,
          type: regEl.type,
          customProperties,
          attributeTokens: firstViewport,
        })
      );
      firstViewport = false;

      snapshots.push({
        viewportWidth: width,
        viewportLabel: label,
        elements: elementData,
        timestamp: Date.now(),
      });
    }
  } finally {
    // The token probe leaves the document with the capture.
    if (index) disposeTokenIndex(index.tokens);
    // Always restore the root's own inline styles, exactly
    for (const { prop, value, priority } of original) {
      if (value) docEl.style.setProperty(prop, value, priority);
      else docEl.style.removeProperty(prop);
    }
    if (!hadStyleAttribute && docEl.getAttribute('style') === '') {
      docEl.removeAttribute('style');
    }
  }

  // Read after the elements: the scopes they sit in are registered as they are read.
  const reported: ReportedTokens = index ? reportedTokensOf(index.tokens) : noReportedTokens();
  return { snapshots, timedOut, framesSkipped, ...reported };
}

// ============================================================================
// Accessibility Helpers
// ============================================================================

/**
 * Compute WCAG 2.1 contrast ratio between foreground and background colors.
 * Returns a ratio like 4.5 (for 4.5:1 contrast).
 *
 * Colors should be in CSS color format (rgb, rgba, hex, or named).
 *
 * Returns `null` (UNKNOWN) when either color cannot be parsed. An unparseable
 * color is never substituted with a default: a made-up black would fabricate a
 * ratio (and a pass or fail) the page does not have.
 */
export function computeContrastRatio(fgColor: string, bgColor: string): number | null {
  const fg = parseColor(fgColor);
  const bg = parseColor(bgColor);
  if (fg === null || bg === null) return null;
  const fgLuminance = getRelativeLuminance(fg);
  const bgLuminance = getRelativeLuminance(bg);

  const lighter = Math.max(fgLuminance, bgLuminance);
  const darker = Math.min(fgLuminance, bgLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check WCAG contrast compliance.
 * Level AA: 4.5:1 for normal text, 3:1 for large text
 * Level AAA: 7:1 for normal text, 4.5:1 for large text
 */
export function checkContrastCompliance(
  fgColor: string,
  bgColor: string,
  fontSize: string,
  fontWeight: string
): { ratio: number | null; passesAA: boolean | null; passesAAA: boolean | null } {
  const ratio = computeContrastRatio(fgColor, bgColor);
  // Unparseable color: the verdict is UNKNOWN, not a pass or a fail.
  if (ratio === null) return { ratio: null, passesAA: null, passesAAA: null };
  const isLargeText = isLargeTextForContrast(fontSize, fontWeight);

  return {
    ratio,
    passesAA: ratio >= (isLargeText ? 3 : 4.5),
    passesAAA: ratio >= (isLargeText ? 4.5 : 7),
  };
}

// ============================================================================
// CSS Custom Properties
// ============================================================================

/**
 * The custom properties a document's stylesheets declare, read rule-first for a
 * batch of elements.
 *
 * Reading one element at a time calls `el.matches()` on every top-level style
 * rule, so a batch costs elements × rules. Measured on qontinui.io's production
 * stylesheets with 1,120 registered elements (plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 6), that was 184,800
 * `matches()` calls, about 43 ms of every `/design/evaluate`. Only 6 of the 165
 * top-level style rules declared a custom property. The index reads the rules
 * once, keeps those that declare one, and queries each selector once with
 * `querySelectorAll`. The same batch then cost about 1 ms.
 *
 * `declared` keeps the per-element walk's scope: top-level `CSSStyleRule`s of
 * readable stylesheets. The token half (`tokens`, `ai/design-tokens.ts`) is
 * built in the same walk and also enters grouping rules — an `@media` that
 * applies, `@layer`, `@supports` — because that is where token systems put
 * their tokens and utilities (`@layer theme { :root { … } }`). A selector
 * reached from both is still queried once.
 */
export interface CustomPropertyIndex {
  /** The document whose stylesheets and elements were indexed. */
  readonly document: Document;
  /**
   * The elements `declared` answers for (all of the document's when `null`).
   * Any other element is matched rule by rule.
   */
  readonly scope: ReadonlySet<Element> | null;
  /** The custom properties declared by the rules each element matches, in rule order. */
  readonly declared: ReadonlyMap<Element, readonly string[]>;
  /** The page's design tokens, their root values, overrides and `var()` references. */
  readonly tokens: DesignTokenIndex;
}

/** The top-level style rules of a document's readable stylesheets, in cascade-source order. */
function topLevelStyleRules(doc: Document): Generator<WalkedRule> {
  return styleRules(doc, { descend: false });
}

/** The custom properties (`--*`) a rule declares. */
function declaredCustomProperties(rule: StyleBlock): string[] {
  const names: string[] = [];
  for (let i = 0; i < rule.style.length; i++) {
    const prop = rule.style[i];
    if (prop.startsWith('--')) names.push(prop);
  }
  return names;
}

function appendTo<K, V>(map: Map<K, V[]>, key: K, values: readonly V[]): void {
  const list = map.get(key);
  if (list) list.push(...values);
  else map.set(key, [...values]);
}

/**
 * Index the custom properties the document's stylesheets declare, for the
 * `candidates` (every element of the document when omitted). Read once, then
 * pass the index to `getCSSCustomProperties` / `getElementDesignData` for each
 * element of the batch.
 *
 * A batch queries each relevant selector once (`querySelectorAll`). A single
 * candidate matches each relevant rule against itself and its ancestors
 * instead (`matches`), which costs far less than querying the document per
 * rule for one element.
 */
export function indexCustomProperties(
  doc: Document = document,
  candidates?: Iterable<Element>
): CustomPropertyIndex {
  const scope = candidates ? new Set(candidates) : null;
  const inScope = (el: Element): boolean => scope === null || scope.has(el);
  const declared = new Map<Element, string[]>();
  const tokens = new TokenIndexBuilder(doc);

  let match: (selector: string) => Iterable<Element> | null;
  if (scope !== null && scope.size === 1) {
    // One element: test it and its ancestors (inherited tokens and scopes).
    const relevant: Element[] = [];
    for (let el: Element | null = [...scope][0]; el; el = el.parentElement) relevant.push(el);
    match = (selector) => {
      try {
        return relevant.filter((el) => el.matches(selector));
      } catch {
        return null; // Invalid selector — skip
      }
    };
  } else {
    // One query per selector, however many rules (or walks) name it.
    const queried = new Map<string, NodeListOf<Element> | null>();
    match = (selector) => {
      if (!queried.has(selector)) {
        try {
          queried.set(selector, doc.querySelectorAll(selector));
        } catch {
          queried.set(selector, null); // Invalid selector — skip
        }
      }
      return queried.get(selector) ?? null;
    };
  }

  for (const { rule, selector, topLevel } of styleRules(doc, {
    descend: true,
    coverage: tokens.coverage,
  })) {
    const declaredHere = declaredCustomProperties(rule);
    const refs = referencesOf(rule.style);
    tokens.addLiterals(rule.style, selector);
    if (declaredHere.length === 0 && refs === null) continue;
    const matched = match(selector);
    if (!matched) continue;
    const elements = [...matched];
    tokens.addRule(declaredHere, refs, elements, selector);
    if (topLevel && declaredHere.length > 0) {
      for (const el of elements) if (inScope(el)) appendTo(declared, el, declaredHere);
    }
  }
  return { document: doc, scope, declared, tokens: tokens.build() };
}

/**
 * Extract CSS custom properties (--var-name) applied to an element.
 *
 * Reads inline style custom properties and the custom properties declared by
 * stylesheet rules matching the element. Returns resolved values.
 *
 * With an `index` (`indexCustomProperties`), the rules are not walked again:
 * the index answers for the elements of its document in its scope. Any other
 * element — detached, in a shadow tree, or outside the scope — is matched
 * against every top-level style rule, as without an index.
 */
export function getCSSCustomProperties(
  el: HTMLElement,
  index?: CustomPropertyIndex
): Record<string, string> {
  const result: Record<string, string> = {};
  const computed = window.getComputedStyle(el);
  // §4.6 CONTENT axis: a custom property can hold page text
  // (`--who: 'Alice Smith'` feeding `content: var(--who)`) or a URL, so a
  // content-redacted element reports its token NAMES with every value
  // collapsed.
  const verdict = verdictOf(el);
  const read = (prop: string): string =>
    scrubContentRequired(computed.getPropertyValue(prop).trim(), verdict);

  // 1. Inline style custom properties. An inline value is often set from
  // script, so possibly from user data: only a colour, a dimension or a
  // short number keeps its value (`scrubScriptValue`).
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i];
    if (prop.startsWith('--')) {
      result[prop] = scrubScriptValue(read(prop));
    }
  }

  // 2. Custom properties declared by the stylesheet rules matching this element
  // One redaction graph, indexed or not: every rule of the element's document
  // (read once per batch by the index) and, outside the index, of each shadow
  // root along its host chain, whatever the rules' conditions
  // (`ai/redaction-graph.ts`).
  const covered = index !== undefined && indexCovers(index, el);
  const declared = covered ? (index.declared.get(el) ?? []) : matchedCustomProperties(el);
  // Recomputed on every read, never cached across reads: an inline custom
  // property set between two reads (a responsive capture's viewports) must
  // be seen by the next one.
  const scriptNames = (): Set<string> => inlineNamesInScope(el);
  const inScope = declared.length > 0 ? scriptNames() : new Set<string>();
  // The graph is read only when something is set from script at all.
  let graph: RedactionGraph | null = null;
  if (inScope.size > 0) {
    // A batch validates each root once per read pass; alone, once per read.
    graph = index ? redactionGraphFor(index.tokens, el) : graphFor(el);
  }
  for (const prop of declared) {
    // An inline declaration of the same name is the value in effect (and was
    // scrubbed as an inline value above): a rule must not re-read it raw.
    if (el.style.getPropertyValue(prop) !== '') continue;
    // A rule value built with var() from a custom property set inline here or
    // on an ancestor (`--title: var(--user-name)`) carries the script value.
    const value = read(prop);
    const fromScript =
      graph !== null &&
      referencesAnyOf(prop, graph, inScope, (ref) => computed.getPropertyValue(ref));
    result[prop] = fromScript ? scrubScriptValue(value) : value;
  }

  return result;
}

/**
 * Whether the index answers for `el`: an element of the indexed document
 * (`querySelectorAll` reaches no detached node and no shadow tree) in its scope.
 */
function indexCovers(index: CustomPropertyIndex, el: Element): boolean {
  return el.getRootNode() === index.document && (index.scope === null || index.scope.has(el));
}

/** The custom properties declared by the top-level style rules `el` matches, one rule at a time. */
function matchedCustomProperties(el: HTMLElement): string[] {
  const names: string[] = [];
  for (const { rule, selector } of topLevelStyleRules(document)) {
    try {
      if (!el.matches(selector)) continue;
    } catch {
      // Invalid selector — skip
      continue;
    }
    names.push(...declaredCustomProperties(rule));
  }
  return names;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Convert camelCase CSS property name to kebab-case
 */
function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Get computed styles for a pseudo-element (::before or ::after)
 */
function getPseudoElementStyles(
  el: HTMLElement,
  selector: '::before' | '::after'
): PseudoElementStyles | null {
  let computed: CSSStyleDeclaration;
  try {
    computed = window.getComputedStyle(el, selector);
  } catch {
    // jsdom and some environments don't support pseudo-element computed styles
    return null;
  }
  const content = computed.getPropertyValue('content');

  // Skip if no content (pseudo-element doesn't exist)
  if (!content || content === 'none' || content === 'normal') {
    return null;
  }

  const styles: Partial<ExtendedComputedStyles> = {};
  const redacted = verdictOf(el).content;
  for (const prop of DESIGN_PROPERTIES) {
    const val =
      computed.getPropertyValue(camelToKebab(prop)) ||
      (computed as unknown as Record<string, string>)[prop] ||
      '';
    if (val) {
      styles[prop] = redacted ? scrubStyleUrls(val) : val;
    }
  }

  // §4.6 CONTENT axis: generated content can carry page text
  // (`content: attr(data-…)`), so a `data-bridge-redact` element's collapses.
  return { selector, content: scrubContentRequired(content, verdictOf(el)), styles };
}

/**
 * Compute the diff between default styles and state styles
 */
function computeStyleDiff(
  defaultStyles: ExtendedComputedStyles,
  stateStyles: ExtendedComputedStyles
): StyleDiff[] {
  const diffs: StyleDiff[] = [];

  for (const prop of DESIGN_PROPERTIES) {
    if (defaultStyles[prop] !== stateStyles[prop]) {
      diffs.push({
        property: prop,
        defaultValue: defaultStyles[prop],
        stateValue: stateStyles[prop],
      });
    }
  }

  return diffs;
}

/** What {@link applyInteractionState} did: how to undo it, and (focus states) whether the focus landed. */
interface AppliedInteractionState {
  restore: () => Promise<void>;
  /** Set by `focus`/`focus-visible`: whether `el` holds focus after `el.focus()`. */
  focused?: boolean;
}

/**
 * Apply an interaction state to an element and return the function that
 * restores it.
 *
 * `hover` and `active` are user-action pseudo-classes no synthetic event can
 * set (`mouseenter` never sets `:hover`, `mousedown` never sets `:active`), so
 * they are FORCED through the in-place selector rewrite of `control/forced-hover.ts` —
 * the same primitive the `hover` action uses — and released (verified) by the
 * restore. `focus` uses the real `el.focus()` and restores the previously
 * focused element; whether `:focus-visible` then matches is the browser's
 * input-modality heuristic (Chromium: `false` when the last focus came from a
 * pointer), so `focus-visible` focuses the element AND forces
 * `:focus-visible` through the same rewrite, giving the keyboard-focus
 * appearance whatever input preceded the read. When the focus does not land
 * (a non-focusable, disabled or inert element, or a focus handler that moves
 * focus elsewhere) nothing is forced: the element can never draw that ring.
 * `disabled` restores the element's own prior value.
 */
async function applyInteractionState(
  el: HTMLElement,
  state: InteractionStateName,
  borrowedFrom?: ForcedPseudoHoldSnapshot
): Promise<AppliedInteractionState> {
  switch (state) {
    case 'hover':
    case 'active': {
      const { holdId } = await forcePseudoState(el, state, { borrowedFrom });
      return {
        restore: async () => {
          await releaseForcedPseudoStateIfOwner(holdId, 'explicit');
        },
      };
    }
    case 'focus': {
      const restore = applyFocus(el);
      return { restore, focused: holdsFocus(el) };
    }
    case 'focus-visible': {
      const restoreFocus = applyFocus(el);
      if (!holdsFocus(el)) return { restore: restoreFocus, focused: false };
      try {
        const { holdId } = await forcePseudoState(el, 'focus-visible', { borrowedFrom });
        return {
          focused: true,
          restore: async () => {
            try {
              await releaseForcedPseudoStateIfOwner(holdId, 'explicit');
            } finally {
              await restoreFocus();
            }
          },
        };
      } catch (err) {
        await restoreFocus();
        throw err;
      }
    }
    case 'disabled': {
      const control = el as HTMLButtonElement | HTMLInputElement;
      const wasDisabled = control.disabled;
      control.disabled = true;
      return {
        restore: async () => {
          control.disabled = wasDisabled;
        },
      };
    }
    default:
      return { restore: async () => undefined };
  }
}

/** Focus `el` with the real `el.focus()`; the returned function puts the previous focus back. */
function applyFocus(el: HTMLElement): () => Promise<void> {
  const previous = document.activeElement;
  el.focus();
  return async () => {
    if (previous instanceof HTMLElement && previous !== el && previous !== document.body) {
      previous.focus();
    }
    if (holdsFocus(el)) el.blur();
  };
}

/**
 * Whether `el` is the focused element of its own tree: the document's
 * `activeElement`, or its shadow root's when it lives in one (where the
 * document's `activeElement` is the shadow host).
 */
function holdsFocus(el: Element): boolean {
  const root = el.getRootNode?.() as Document | ShadowRoot | undefined;
  const active = root && 'activeElement' in root ? root.activeElement : document.activeElement;
  return active === el;
}

/**
 * Whether the browser's own `:focus-visible` matches `el` right now.
 * `'not_focused'` when `el` does not hold focus (it has no focus appearance
 * to classify — never `false`, which means the pointer-focus appearance).
 * `'unknown'` when `matches` throws (an engine without the selector): a match
 * that could not be read is never reported as `false`.
 */
export function readFocusVisible(el: Element): FocusVisibleMatch {
  if (!holdsFocus(el)) return 'not_focused';
  try {
    return el.matches(':focus-visible');
  } catch {
    return 'unknown';
  }
}

/**
 * Wait for the next animation frame
 */
function waitFrame(): Promise<boolean> {
  // A hidden tab runs no animation frames and throttles timers to a second or
  // more, so there is nothing to wait for: the caller's forced reflow and
  // `getComputedStyle` already read the settled layout. Answer `false` ("no
  // frame awaited") so the caller can report it.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    // A tab can go hidden while waiting, so the frame is raced with a timer:
    // whichever comes first resolves (resolving twice is a no-op).
    setTimeout(() => resolve(true), FRAME_FALLBACK_MS);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve(true));
  });
}

/** How long `waitFrame` waits for an animation frame before going on without one. */
const FRAME_FALLBACK_MS = 50;

/** Values that parse as a colour but do not name one (see `parseColor`). */
const NON_COLOR_KEYWORDS = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

/** `true` for an `rgba(...)` / `rgb(... / a)` value whose alpha is zero. */
function isFullyTransparent(color: string): boolean {
  const m = color.trim().match(/^rgba?\(([^)]*)\)$/i);
  if (!m) return false;
  // Only a 4th component is alpha; `rgb(0, 0, 0)` has none.
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  // CSS reads an alpha of `none` as 0.
  return parts.length >= 4 && (parts[3].toLowerCase() === 'none' || parseFloat(parts[3]) === 0);
}

/**
 * Parse a CSS color value to [r, g, b] (0-255 range), or `null` when it is not
 * a color this can read. Never defaults: a caller must treat `null` as UNKNOWN.
 */
function parseColor(color: string): [number, number, number] | null {
  const keyword = color.trim().toLowerCase();
  // These parse, but name no colour of their own: a CSS-wide keyword or
  // `currentcolor` computes to the probe's INHERITED colour, and `transparent`
  // shows whatever is behind it. Either would fabricate a ratio.
  if (NON_COLOR_KEYWORDS.has(keyword)) return null;
  // A `var()` reference resolves against the PROBE's custom properties (what
  // it inherits from <body>), not the caller's element, so it is not this
  // colour either; an undefined one computes to the inherited colour.
  if (keyword.includes('var(')) return null;
  // Try to use a temporary element for reliable parsing
  if (typeof document !== 'undefined') {
    const temp = document.createElement('div');
    temp.style.color = color;
    // The engine drops a value it cannot parse, leaving the property empty; the
    // computed color would then be the INHERITED one, not this color's.
    if (temp.style.color === '') return null;
    temp.style.display = 'none';
    document.body.appendChild(temp);
    const computed = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);
    if (isFullyTransparent(computed)) return null;

    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    }
  }

  // Fallback: try to parse directly
  if (isFullyTransparent(color)) return null;
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  }

  return null;
}

/**
 * Compute relative luminance per WCAG 2.1
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function getRelativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Determine if text is "large" for WCAG contrast purposes.
 * Large text: >= 18pt (24px) or >= 14pt (18.66px) bold
 */
function isLargeTextForContrast(fontSize: string, fontWeight: string): boolean {
  const sizeInPx = parseFloat(fontSize);
  const weight = parseInt(fontWeight, 10) || (fontWeight === 'bold' ? 700 : 400);

  if (sizeInPx >= 24) return true;
  if (sizeInPx >= 18.66 && weight >= 700) return true;
  return false;
}
