/**
 * Stable Element References
 *
 * Provides stable references to UI elements that survive React re-renders,
 * unmount/remount cycles, and DOM mutations. A StableElementRef captures
 * multiple identification strategies so the element can be resolved even
 * after its DOM node has been replaced.
 *
 * Resolution order:
 *   1. primaryId lookup in the registry
 *   2. data-ui-bridge-id DOM attribute query
 *   3. fingerprint match via findNearestRegisteredElement
 *   4. semanticPath traversal (CSS selector)
 */

import type { RegisteredElement } from './types';
import { getGlobalRegistry } from './registry';
import { computeElementFingerprint, findNearestRegisteredElement } from './element-fingerprint';
import {
  buildElementResolution,
  scoreResolution,
  type ElementResolution,
  type ElementResolutionCandidate,
  type ElementResolutionStrategy,
} from './resolution-score';

// ============================================================================
// Types
// ============================================================================

/**
 * A stable reference to a UI element that can survive React re-renders.
 *
 * Contains multiple identification strategies so the element can be
 * resolved even after its DOM node has been replaced.
 */
export interface StableElementRef {
  /** Current transient ID (changes on re-render) */
  id: string;
  /** Strategy used to generate the primaryId (e.g. 'prefer-existing', 'semantic') */
  idStrategy: string;
  /** The element's registered ID at time of creation */
  primaryId: string;
  /** Content-based fingerprint hash (survives re-renders) */
  fingerprint: string;
  /** Semantic path through the component tree (e.g., "App>Sidebar>NavItem[2]") */
  semanticPath: string;
  /** data-ui-bridge-id from DOM if present (highest priority for resolution) */
  stableId?: string;
  /** Timestamp (ms) when this ref was last confirmed to resolve */
  lastSeenAt: number;
}

// ============================================================================
// Creation
// ============================================================================

/**
 * Build a semantic CSS selector path for an element by walking up the DOM.
 * Produces something like "main > div.container > button.submit".
 * Used as a last-resort resolution strategy.
 */
function buildSemanticPath(element: HTMLElement): string | undefined {
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML' && depth < 8) {
    let selector = current.tagName.toLowerCase();

    // Prefer data-testid or id for precise targeting
    const testId = current.getAttribute('data-testid');
    if (testId) {
      parts.unshift(`[data-testid="${testId}"]`);
      break; // Anchored — no need to go higher
    }

    const htmlId = current.id;
    if (htmlId && !/^:r[0-9a-z]+:$/.test(htmlId)) {
      parts.unshift(`#${CSS.escape(htmlId)}`);
      break; // Anchored
    }

    // Add role or landmark info
    const role = current.getAttribute('role');
    if (role) {
      selector += `[role="${role}"]`;
    }

    // Add first meaningful class (skip utility classes)
    const classes = Array.from(current.classList).filter(
      (c) => c.length > 2 && !c.startsWith('css-') && !c.startsWith('_')
    );
    if (classes.length > 0) {
      selector += `.${CSS.escape(classes[0])}`;
    }

    parts.unshift(selector);
    current = current.parentElement;
    depth++;
  }

  return parts.length > 0 ? parts.join(' > ') : undefined;
}

/**
 * Create a StableElementRef for a registered element.
 *
 * Captures the element's ID, fingerprint hash, and semantic path
 * so it can be resolved later even after DOM replacement.
 */
export function createStableRef(element: RegisteredElement): StableElementRef {
  const fingerprint = computeElementFingerprint(element.element);
  const semanticPath = buildSemanticPath(element.element) ?? element.element.tagName.toLowerCase();

  // Infer the ID strategy from the element's attributes
  const idStrategy = element.element.getAttribute('data-testid')
    ? 'data-testid'
    : element.element.id && !/^:r[0-9a-z]+:$/.test(element.element.id)
      ? 'html-id'
      : 'prefer-existing';

  // Capture data-ui-bridge-id if present (written by useAutoRegister)
  const stableId = element.element.getAttribute('data-ui-bridge-id') || undefined;

  return {
    id: element.id,
    idStrategy,
    primaryId: element.id,
    fingerprint: fingerprint.hash,
    semanticPath,
    stableId,
    lastSeenAt: Date.now(),
  };
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * The outcome of a successful {@link resolveStableRef}: the live element, plus
 * WHICH of the four strategies produced it and how stable that class of
 * evidence is.
 *
 * The chain used to return a bare `RegisteredElement`, which made an exact
 * registry hit and a fourth-strategy CSS-path guess indistinguishable to the
 * caller. The scores are ordinal class labels, not calibrated probabilities —
 * see `core/resolution-score.ts`.
 */
export interface StableRefResolution {
  /** The live element the chain resolved to. */
  element: RegisteredElement;
  /** Which strategy won, its stability class/rank, and (opt-in) the alternates. */
  resolution: ElementResolution;
}

/** Per-call options for {@link resolveStableRef}. */
export interface ResolveStableRefOptions {
  /**
   * Also report every OTHER strategy that would have resolved something,
   * ranked strongest-first, on {@link ElementResolution.alternates}.
   *
   * **Off by default, and a per-call request rather than a config setting.**
   * Building the list means running the whole chain instead of stopping at the
   * first hit — including a fingerprint sweep across every registered element —
   * so it is `O(elements)` on a path that is otherwise a map lookup. Making it
   * a config toggle would additionally make the same call return different
   * shapes on different machines.
   */
  includeAlternates?: boolean;
}

/** One strategy's hit: which strategy, and what it found. */
interface StrategyHit {
  strategy: ElementResolutionStrategy;
  element: RegisteredElement;
}

/** Strategy 1: direct id lookup in the registry. The only non-inferential arm. */
function tryRegistryId(ref: StableElementRef): RegisteredElement | null {
  const registry = getGlobalRegistry();
  const byId = registry.getElement(ref.primaryId);
  return byId && byId.mounted && byId.element.isConnected ? byId : null;
}

/** Strategy 2: the developer-stamped `data-ui-bridge-id` attribute. */
function tryUiBridgeIdAttr(ref: StableElementRef): RegisteredElement | null {
  if (typeof document === 'undefined') return null;
  const registry = getGlobalRegistry();
  const byAttr = document.querySelector(
    `[data-ui-bridge-id="${CSS.escape(ref.primaryId)}"]`
  ) as HTMLElement | null;
  if (!byAttr) return null;
  const registered = registry.findByDOMElement(byAttr);
  if (registered && registered.mounted) return registered;
  // The DOM node exists but isn't registered — try ancestor walk.
  const nearest = findNearestRegisteredElement(byAttr, registry);
  return nearest && nearest.mounted ? nearest : null;
}

/**
 * Strategy 3: content-fingerprint match across every registered element.
 *
 * Inferential: it finds an element that LOOKS like the one the ref captured. A
 * second element with identical content would satisfy it equally well, which is
 * why it scores `moderate` rather than `strong`.
 */
function tryFingerprint(ref: StableElementRef): RegisteredElement | null {
  if (!ref.fingerprint) return null;
  const registry = getGlobalRegistry();
  for (const el of registry.getAllElements()) {
    if (!el.mounted || !el.element.isConnected) continue;
    const fp = computeElementFingerprint(el.element);
    if (fp.hash === ref.fingerprint) return el;
  }
  return null;
}

/**
 * Strategy 4: `semanticPath` CSS traversal — the weakest arm.
 *
 * The path is role plus a non-utility class walked up to depth 8
 * (`buildSemanticPath`), so a match is structural guesswork: it says "something
 * shaped like this still exists here", not "this is your element". Scored
 * `weak` for exactly that reason.
 */
function trySemanticPath(ref: StableElementRef): RegisteredElement | null {
  if (!ref.semanticPath || typeof document === 'undefined') return null;
  const registry = getGlobalRegistry();
  try {
    const byPath = document.querySelector(ref.semanticPath) as HTMLElement | null;
    if (!byPath) return null;
    const registered = registry.findByDOMElement(byPath);
    if (registered && registered.mounted) return registered;
    // Walk up from the CSS-matched node to find a registered ancestor.
    const nearest = findNearestRegisteredElement(byPath, registry);
    return nearest && nearest.mounted ? nearest : null;
  } catch {
    // Invalid CSS selector — skip.
    return null;
  }
}

/**
 * The four strategies in strength order. First hit wins, which is why this
 * array order and `ELEMENT_RESOLUTION_RANK` must agree — they encode the same
 * claim (registry id > `data-ui-bridge-id` > fingerprint > semantic path) for
 * two different purposes.
 */
const STABLE_REF_STRATEGIES: ReadonlyArray<{
  strategy: ElementResolutionStrategy;
  run: (ref: StableElementRef) => RegisteredElement | null;
}> = [
  { strategy: 'registry-id', run: tryRegistryId },
  { strategy: 'ui-bridge-id-attr', run: tryUiBridgeIdAttr },
  { strategy: 'fingerprint', run: tryFingerprint },
  { strategy: 'semantic-path', run: trySemanticPath },
];

/**
 * Resolve a StableElementRef back to a live RegisteredElement, reporting which
 * strategy produced it.
 *
 * Tries resolution strategies in strength order:
 *   1. Direct ID lookup in the registry            (`registry-id`,        exact)
 *   2. DOM query for data-ui-bridge-id attribute   (`ui-bridge-id-attr`,  strong)
 *   3. Fingerprint match across all registered     (`fingerprint`,        moderate)
 *   4. Semantic path CSS selector traversal        (`semantic-path`,      weak)
 *
 * Returns `null` if no strategy finds a match.
 *
 * Without `includeAlternates` this stops at the first hit, so it costs exactly
 * what it always did. With it, every strategy runs — see
 * {@link ResolveStableRefOptions.includeAlternates} for what that buys and what
 * it costs.
 */
export function resolveStableRef(
  ref: StableElementRef,
  options: ResolveStableRefOptions = {}
): StableRefResolution | null {
  const hits: StrategyHit[] = [];
  for (const { strategy, run } of STABLE_REF_STRATEGIES) {
    const element = run(ref);
    if (element) {
      hits.push({ strategy, element });
      if (!options.includeAlternates) break;
    }
  }

  const winner = hits[0];
  if (!winner) return null;

  const alternates: ElementResolutionCandidate[] | undefined = options.includeAlternates
    ? hits.slice(1).map((hit) => scoreResolution(hit.strategy, hit.element.id))
    : undefined;

  return {
    element: winner.element,
    resolution: buildElementResolution(
      scoreResolution(winner.strategy, winner.element.id),
      alternates
    ),
  };
}
