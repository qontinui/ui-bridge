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
 * Media registers too, through the same `registerMediaInRegistry` the React
 * scanner uses (plan 2026-10-13-image-generation-and-visual-judgment,
 * Phase 5). Before, this seeder registered interactive elements only, so on a
 * page driven by inject-cli every media find answered with nothing — and a
 * media question about an uninstrumented page could not be asked at all.
 *
 * Content registers too, through the same `registerContentInRegistry` (the same
 * plan, Phase 16). A heading is neither interactive nor media, so an
 * uninstrumented page's snapshot held no heading at all, and
 * `text_over_image_contrast` could measure a link over a hero but never the
 * hero's own heading.
 *
 * No React, no app cooperation. This is what makes Tier-1 injected semantics
 * (find / act / snapshot / state-read) work on uninstrumented pages.
 */

import type { UIBridgeRegistry } from '../core/registry';
import {
  scanDOMForInteractiveElementsWithRefs,
  computeDomFallbackLabel,
  type DOMFallbackElementWithRef,
} from '../server/dom-fallback';
import {
  MEDIA_SELECTORS,
  registerMediaInRegistry,
  shouldRegisterMedia,
} from '../react/media-discovery';
import { IMAGE_SLOT_ATTR } from '../react/media-capture';
import {
  CONTENT_SELECTORS,
  registerContentInRegistry,
  shouldRegisterContent,
} from '../react/content-discovery';

/** Most media elements the seeder registers, as `useAutoRegister`'s default. */
const MAX_SEEDED_MEDIA = 200;

/** Most content elements the seeder registers, as `useAutoRegister`'s default. */
const MAX_SEEDED_CONTENT = 500;

/** The key this seeder reports refused content rows under. */
const SEED_DROP_SOURCE = 'injected-seed';

/** Content that comes in bulk, seeded after the rest so it cannot crowd it out. */
const BULK_CONTENT_SELECTORS = 'li, td, th, pre, code, dd, dt';

/** Outcome of a single seed pass. */
export interface SeedResult {
  /** Elements newly registered on this pass (interactive, media and content). */
  registered: number;
  /** Elements the interactive, media and content scans matched, before filtering; one both match counts twice. */
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
 * Register every interactive, media and content element under `root` into `registry`,
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
    const heldId = tracked?.get(item.element);
    if (heldId !== undefined) {
      // A row seeded as content that has since become interactive (a <th> a table
      // plugin gave a tabindex) is promoted: a content row has no actions, so left
      // alone it could never be clicked. Anything else held stays as it is.
      if (registry.getElement(heldId)?.category !== 'content') continue;
      registry.unregisterElement(heldId);
      usedIds.delete(heldId);
      tracked?.delete(item.element);
    }
    if (!isActionable(item)) continue;

    // A promoted row keeps an id its author chose: an assertion may name it. Only
    // a promoted row: everything else this scan finds keeps the id it always had.
    const authored = heldId !== undefined ? item.element.getAttribute('data-content-id') : null;
    let id = authored || item.id;
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }

    const node = item.element;
    const reg = registry.registerElement(id, node, {
      label: item.label || undefined,
      // `label` above is the value scraped on THIS pass and is never touched
      // again — the `tracked` short-circuit at the top of this loop means a
      // node discovered once is never re-labelled, so an `aria-label` that
      // changes later would be served stale forever (including on an explicit
      // `discover`). Hand the registry the same derivation, with the same
      // `|| undefined` normalization, so `refreshScrapedText()` can re-read it on
      // the snapshot / find / discover paths.
      labelSource: () => computeDomFallbackLabel(node) || undefined,
      origin: 'auto',
    });

    usedIds.add(reg.id);
    tracked?.set(item.element, reg.id);
    registered++;
  }

  // Media — the React scanner's own registration, so the ids, the
  // collision rule and the observation are identical across both runtimes.
  // Background images stay off, as `useAutoRegister`'s default.
  const mediaRoot = root ?? document.body;
  const media = mediaRoot
    ? Array.from(mediaRoot.querySelectorAll<HTMLElement>(MEDIA_SELECTORS.join(', ')))
    : [];
  const isRegistered = (el: HTMLElement) =>
    tracked ? tracked.has(el) : registry.findByDOMElement(el) !== undefined;
  let mediaCount = registry.getAllMediaElements().length;
  for (const el of media) {
    if (mediaCount >= MAX_SEEDED_MEDIA) break;
    if (!shouldRegisterMedia(el, {}, isRegistered)) continue;
    const id = registerMediaInRegistry(registry, el);
    if (id === null) continue;
    tracked?.set(el, id);
    mediaCount++;
    registered++;
  }

  // Content — the React scanner's own registration, as for media above. Each
  // element is judged once more on every pass, since one with no text yet can
  // gain it; `isRegistered` is what stops a re-seed registering it twice.
  // Headings and prose go first, so that when the cap binds in a pass it binds on
  // table cells and list items, not on a hero heading further down the page. Only
  // within a pass: nothing evicts a row, so a heading mounted after a large table
  // filled the cap gets none. The pass does not stop at the cap: it counts every
  // registrable element it had to refuse and reports that count, which the
  // snapshot serves as `registration.contentDropped`.
  const matched = mediaRoot
    ? Array.from(mediaRoot.querySelectorAll<HTMLElement>(CONTENT_SELECTORS.join(', ')))
    : [];
  const isBulk = (el: HTMLElement) => el.matches(BULK_CONTENT_SELECTORS);
  const content = [...matched.filter((el) => !isBulk(el)), ...matched.filter(isBulk)];
  let contentCount = registry.getAllElements().filter((e) => e.category === 'content').length;
  let contentDropped = 0;
  for (const el of content) {
    // The scan above can hold an element a content selector matches too.
    if (isRegistered(el) || !shouldRegisterContent(el)) continue;
    if (contentCount >= MAX_SEEDED_CONTENT) {
      contentDropped++;
      continue;
    }
    const id = registerContentInRegistry(registry, el);
    if (id === null) continue;
    tracked?.set(el, id);
    contentCount++;
    registered++;
  }
  // The pass's whole count, so it replaces the previous pass's: a refused
  // element that has since got a row, or left the page, is no longer counted.
  registry.reportContentDropped(SEED_DROP_SOURCE, contentDropped);

  return { registered, total: scanned.length + media.length + content.length };
}

/** Options for {@link observeAndSeed}. */
export interface ObserveOptions {
  /** Debounce (ms) for re-seeding after DOM mutations. Default 100. */
  debounceMs?: number;
  /**
   * Called after every seed pass (the initial pass and each debounced re-seed),
   * with the registry's interactive and media element count at that point. The
   * injected bootstrap uses this to drive its settle tracker. The count is read
   * from the registry (not {@link SeedResult.registered}) so it reflects removals
   * too. Content rows do NOT count: a `<h1>Loading…</h1>` splash must not read as
   * the page having arrived, and a text-only page keeps its typed BLOCKED answer.
   */
  onSeed?: (elementCount: number) => void;
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
  const onSeed = options.onSeed;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reseed = () => {
    const result = seedRegistryFromDom(registry, root, { tracked });
    onSeed?.(registry.getAllElements().filter((e) => e.category !== 'content').length);
    return result;
  };

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
    // `src` / `srcset` / the image-slot marker: an image swapped in place is a
    // new image to consider, as in `useAutoRegister`.
    attributeFilter: [
      'class',
      'style',
      'hidden',
      'disabled',
      'aria-hidden',
      // A control can gain its interactivity from these alone, and a row seeded
      // as content is only promoted on a re-seed.
      'role',
      'tabindex',
      'src',
      'srcset',
      IMAGE_SLOT_ATTR,
    ],
  });

  return () => {
    observer.disconnect();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
