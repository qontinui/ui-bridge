/**
 * DOM → registry seeding for injected mode
 *
 * Framework-free analog of the embedded `useAutoRegister` scan→observe→
 * register cycle. Walks the live DOM via the shipping `dom-fallback`
 * substrate (`scanDOMForInteractiveElementsWithRefs`) and registers each
 * interactive node into a real {@link UIBridgeRegistry} with its live
 * `HTMLElement` ref — so the relay command dispatcher (`executeCommand`) can
 * `find`, snapshot, and act on a page that ships **zero** UI Bridge code.
 *
 * No React, no app cooperation. This is what makes Tier-1 injected semantics
 * (find / act / snapshot / state-read) work on uninstrumented pages.
 */

import type { UIBridgeRegistry } from '../core/registry';
import {
  scanDOMForInteractiveElementsWithRefs,
  type DOMFallbackElementWithRef,
} from '../server/dom-fallback';

/** Outcome of a single seed pass. */
export interface SeedResult {
  /** Elements newly registered on this pass. */
  registered: number;
  /** Total interactive elements the scan found (registered + already-tracked). */
  total: number;
}

/** Options for the seeder. */
export interface SeedOptions {
  /**
   * Element → registry-id map tracking what this seeder has already
   * registered. Pass the same map across re-seeds (e.g. from a
   * MutationObserver) so already-registered nodes are skipped instead of
   * duplicated. {@link observeAndSeed} manages this for you.
   */
  tracked?: Map<HTMLElement, string>;
}

/** True when the element type carries no actionable verbs worth registering. */
function isActionable(item: DOMFallbackElementWithRef): boolean {
  return item.element.isConnected;
}

/**
 * Register every interactive DOM element under `root` into `registry`,
 * carrying the live `HTMLElement` ref. Idempotent when a shared `tracked`
 * map is supplied. Element `type` and `actions` are inferred by the registry
 * itself (`registerElement` runs `inferElementType` / `inferActions` when
 * they're omitted), guaranteeing valid `ElementType` / `StandardAction`
 * values; only the human-readable `label` is carried over from the scan.
 */
export function seedRegistryFromDom(
  registry: UIBridgeRegistry,
  root?: HTMLElement,
  options: SeedOptions = {}
): SeedResult {
  const tracked = options.tracked;
  const scanned = scanDOMForInteractiveElementsWithRefs(root);

  // Seed the used-id set from both the registry's current contents and any
  // ids this seeder assigned on prior passes, so collisions disambiguate
  // deterministically across re-seeds.
  const usedIds = new Set<string>(registry.getAllElements().map((e) => e.id));

  let registered = 0;
  for (const item of scanned) {
    if (tracked?.has(item.element)) continue;
    if (!isActionable(item)) continue;

    let id = item.id;
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }

    const reg = registry.registerElement(id, item.element, {
      label: item.label || undefined,
      origin: 'auto',
    });

    usedIds.add(reg.id);
    tracked?.set(item.element, reg.id);
    registered++;
  }

  return { registered, total: scanned.length };
}

/** Options for {@link observeAndSeed}. */
export interface ObserveOptions {
  /** Debounce (ms) for re-seeding after DOM mutations. Default 100. */
  debounceMs?: number;
}

/**
 * Seed once, then keep the registry live via a `MutationObserver` mirroring
 * `useAutoRegister`: new subtrees are (debounced) re-seeded; removed nodes are
 * unregistered immediately. Returns a disconnect function.
 *
 * Safe to call only once the page realm has a `document.body` — the injected
 * bootstrap defers this until DOM-ready (init-scripts run at document_start,
 * before `<body>` exists).
 */
export function observeAndSeed(
  registry: UIBridgeRegistry,
  root: HTMLElement = document.body,
  options: ObserveOptions = {}
): () => void {
  const tracked = new Map<HTMLElement, string>();
  const debounceMs = options.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reseed = () => seedRegistryFromDom(registry, root, { tracked });

  // Initial pass.
  reseed();

  const pruneRemoved = (el: HTMLElement) => {
    const id = tracked.get(el);
    if (id && !el.isConnected) {
      registry.unregisterElement(id);
      tracked.delete(el);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.removedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        pruneRemoved(el);
        el.querySelectorAll<HTMLElement>('*').forEach(pruneRemoved);
      });
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(reseed, debounceMs);
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-hidden'],
  });

  return () => {
    observer.disconnect();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
