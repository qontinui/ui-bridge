/**
 * Central Target Registry (CTR)
 *
 * Maps stable logical names to physical selectors, surviving DOM restructuring.
 */

export type {
  CtrSelectorStrategy,
  CtrSelector,
  CtrEntryMetadata,
  CtrEntry,
  CtrConfig,
  CtrResolutionResult,
  CtrEventType,
  CtrEvent,
  CtrListener,
} from './types';

export {
  CTR_CONFIG_VERSION,
  CTR_FILE_EXTENSION,
  DEFAULT_SELECTOR_CONFIDENCE,
  CONFIDENCE_BOOST,
  CONFIDENCE_PENALTY,
  MIN_CONFIDENCE_THRESHOLD,
} from './types';

export {
  CentralTargetRegistry,
  getGlobalCtr,
  setGlobalCtr,
  resetGlobalCtr,
  createCtrEntry,
} from './registry';

export {
  promoteSelector,
  demoteSelector,
  getViableSelectors,
  hasViableSelectors,
} from './self-healing';

export { autoPopulateCtr } from './auto-populate';
export type { AutoPopulateOptions } from './auto-populate';

// Migration utilities (migrateSpecToCtr, migrateDirectoryToCtr, rewriteSpecWithCtr)
// are Node-only (import 'fs') and must NOT be in the browser-facing barrel.
// Import from 'ui-bridge/ctr/migrate' for Node-only consumers.
export type { MigrationResult } from './migrate-specs-to-ctr';
