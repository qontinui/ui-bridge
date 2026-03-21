/**
 * CTR Auto-Populate
 *
 * Observes UIBridgeRegistry element registration events and automatically
 * creates CTR entries from registered elements. Bridges the runtime registry
 * (transient, tied to DOM lifecycle) to the CTR (persistent logical names).
 */

import type { UIBridgeRegistry } from '../core/registry';
import type { RegisteredElement } from '../core/types';
import type { CtrEntry, CtrSelector } from './types';
import { DEFAULT_SELECTOR_CONFIDENCE } from './types';
import type { CentralTargetRegistry } from './registry';

/**
 * Options for auto-populating CTR entries from registry events.
 */
export interface AutoPopulateOptions {
  /**
   * Whether to overwrite existing CTR entries when a new element is registered
   * with the same logical name. Default: false (keep existing).
   */
  overwrite?: boolean;
  /**
   * Prefix for auto-generated logical names. Default: '' (no prefix).
   */
  prefix?: string;
  /**
   * Filter function to decide whether a registered element should get a CTR entry.
   * Default: all elements get entries.
   */
  filter?: (element: RegisteredElement) => boolean;
}

/**
 * Start observing a UIBridgeRegistry and auto-creating CTR entries.
 * Returns an unsubscribe function.
 */
export function autoPopulateCtr(
  uiRegistry: UIBridgeRegistry,
  ctr: CentralTargetRegistry,
  options: AutoPopulateOptions = {}
): () => void {
  const { overwrite = false, prefix = '', filter } = options;

  const unsubscribe = uiRegistry.on('element:registered', (event) => {
    const element = event.data as RegisteredElement | undefined;
    if (!element) return;
    if (filter && !filter(element)) return;

    const logicalName = prefix + element.id;
    if (!overwrite && ctr.has(logicalName)) return;

    const selectors = buildSelectorsFromElement(element);
    if (selectors.length === 0) return;

    const entry: CtrEntry = {
      logicalName,
      selectors,
      metadata: {
        description: element.description ?? element.label,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      version: 1,
    };

    ctr.register(entry);
  });

  return unsubscribe;
}

/**
 * Build CTR selectors from a RegisteredElement's DOM element.
 * Extracts all applicable selector strategies in priority order.
 */
function buildSelectorsFromElement(registered: RegisteredElement): CtrSelector[] {
  const selectors: CtrSelector[] = [];
  let priority = 0;

  const el = registered.element;
  if (!el) return selectors;

  // data-testid (highest priority)
  const testId = el.getAttribute('data-testid');
  if (testId) {
    selectors.push({
      strategy: 'data-testid',
      value: testId,
      priority: priority++,
      confidence: DEFAULT_SELECTOR_CONFIDENCE,
    });
  }

  // data-awas-element
  const awasId = el.getAttribute('data-awas-element');
  if (awasId) {
    selectors.push({
      strategy: 'data-awas-element',
      value: awasId,
      priority: priority++,
      confidence: DEFAULT_SELECTOR_CONFIDENCE,
    });
  }

  // HTML id
  if (el.id) {
    selectors.push({
      strategy: 'id',
      value: el.id,
      priority: priority++,
      confidence: DEFAULT_SELECTOR_CONFIDENCE,
    });
  }

  // The registered element's own ID can serve as a search-based fallback
  if (registered.id) {
    selectors.push({
      strategy: 'search',
      value: { idPattern: registered.id, fuzzy: false },
      priority: priority++,
      confidence: DEFAULT_SELECTOR_CONFIDENCE * 0.9,
    });
  }

  return selectors;
}
