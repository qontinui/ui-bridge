/**
 * UI Bridge Core Module
 *
 * Shared infrastructure for element identification and registry.
 */

// Types
export * from './types';

// Element identification utilities
export {
  ID_ATTRIBUTES,
  generateXPath,
  generateCSSSelector,
  getBestIdentifier,
  createElementIdentifier,
  findElementByIdentifier,
  findAllElementsByIdentifier,
  elementMatchesIdentifier,
} from './element-identifier';

// Registry
export {
  UIBridgeRegistry,
  getGlobalRegistry,
  setGlobalRegistry,
  resetGlobalRegistry,
  type RegistryOptions,
} from './registry';
