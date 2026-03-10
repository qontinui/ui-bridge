/**
 * Framework Adapters Module
 *
 * Opt-in adapters for extracting form state from popular React form libraries
 * with perfect accuracy, bypassing DOM heuristics.
 *
 * Usage:
 * ```ts
 * import {
 *   createAdapterRegistry,
 *   ReactHookFormAdapter,
 *   FormikAdapter,
 * } from '@qontinui/ui-bridge';
 *
 * const registry = createAdapterRegistry();
 * registry.register(new ReactHookFormAdapter());
 * registry.register(new FormikAdapter());
 *
 * // Detect which adapters are active on the current page
 * const active = registry.detectAdapters();
 * for (const adapter of active) {
 *   const forms = adapter.extractForms();
 *   // ... use forms with perfect field-level error/touched/dirty state
 * }
 * ```
 */

// Types
export type { FormFrameworkAdapter, AdapterRegistry, AdapterFieldError } from './types';

// Registry
export { createAdapterRegistry } from './registry';

// Adapters
export { ReactHookFormAdapter } from './react-hook-form';
export { FormikAdapter } from './formik';
