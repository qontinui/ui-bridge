/**
 * UI Bridge Native - Core
 *
 * Core types and registry for React Native.
 */

export * from './types';
// Action-invocation abandonment primitive (plan
// 2026-08-20-ui-bridge-action-declaration-shape, Phase 3)
export * from './abortable';
// Parameter-schema validation (plan
// 2026-08-20-ui-bridge-action-declaration-shape, Phase 2)
export * from './param-schema';
// Action effect defaults (plan
// 2026-08-20-ui-bridge-action-declaration-shape, Phase 4)
export * from './action-effect';
export * from './registry';
export * from './element-identifier';
