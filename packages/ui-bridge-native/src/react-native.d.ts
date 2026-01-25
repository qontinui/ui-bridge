/**
 * React Native type augmentations for ui-bridge-native
 *
 * This file no longer re-declares the entire react-native module.
 * Instead, we rely on the actual react-native types from the consumer's
 * node_modules (since react-native is a peer dependency).
 *
 * The types here only provide minimal fallbacks for TypeScript compilation
 * when react-native types are not available (e.g., during isolated builds).
 */

// We only need to ensure LayoutChangeEvent is available for our hook signatures.
// In practice, this comes from the actual react-native package in consumer projects.
// This file is kept for backwards compatibility but should not conflict with
// actual react-native types.
