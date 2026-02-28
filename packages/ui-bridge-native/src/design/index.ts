/**
 * UI Bridge Native - Design Review
 *
 * Style capture, mapping, and design review for React Native elements.
 */

export type {
  ExtendedComputedStyles,
  StyleDiff,
  StateStyles,
  ElementDesignData,
  PseudoElementStyles,
  ResponsiveSnapshot,
  FlattenedNativeStyle,
  NativeStateStyles,
  NativeInteractionStateName,
} from './design-types';

export {
  mapNativeStyleToExtended,
  getNativeElementDesignData,
  captureNativeStateVariations,
  captureNativeResponsiveSnapshot,
} from './design-inspector-native';
