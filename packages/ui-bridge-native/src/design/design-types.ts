/**
 * Native Design Review Types
 *
 * Types for React Native style capture and design review.
 * Maps RN style properties to the web SDK's ExtendedComputedStyles format.
 */

// ============================================================================
// Shared types — re-exported from web SDK when available, defined locally otherwise.
// These match the interfaces in @qontinui/ui-bridge/core exactly.
// ============================================================================

/**
 * Extended computed styles (~40 design-relevant CSS properties).
 * This is the canonical format shared with the web SDK.
 */
export interface ExtendedComputedStyles {
  // Layout
  display: string;
  position: string;
  boxSizing: string;
  width: string;
  height: string;
  minWidth: string;
  maxWidth: string;
  minHeight: string;
  maxHeight: string;
  margin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  padding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  overflow: string;
  overflowX: string;
  overflowY: string;

  // Flex/Grid
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  alignSelf: string;
  gap: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;

  // Typography
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  textTransform: string;
  textDecoration: string;
  color: string;

  // Visual
  backgroundColor: string;
  backgroundImage: string;
  border: string;
  borderRadius: string;
  boxShadow: string;
  opacity: string;
  outline: string;

  // Effects
  transform: string;
  transition: string;
  cursor: string;
  zIndex: string;
  visibility: string;
  pointerEvents: string;
}

/**
 * Style diff entry: a property that changed from default state
 */
export interface StyleDiff {
  property: string;
  defaultValue: string;
  stateValue: string;
}

/**
 * Styles captured in a specific interaction state
 */
export interface StateStyles {
  state: NativeInteractionStateName;
  styles: ExtendedComputedStyles;
  diffFromDefault: StyleDiff[];
}

/**
 * Full design data for a single element
 */
export interface ElementDesignData {
  elementId: string;
  label?: string;
  type: string;
  styles: ExtendedComputedStyles;
  stateVariations?: StateStyles[];
  pseudoElements?: PseudoElementStyles[];
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Pseudo-element styles (always empty on RN — no ::before/::after)
 */
export interface PseudoElementStyles {
  selector: '::before' | '::after';
  content: string;
  styles: Partial<ExtendedComputedStyles>;
}

/**
 * Design snapshot at a specific viewport/screen size
 */
export interface ResponsiveSnapshot {
  viewportWidth: number;
  viewportLabel?: string;
  elements: ElementDesignData[];
  timestamp: number;
}

// ============================================================================
// Native-specific types
// ============================================================================

/**
 * Flattened React Native style — explicit RN style properties.
 * Not tied to any specific RN version. All properties optional.
 */
export interface FlattenedNativeStyle {
  // Layout
  display?: 'flex' | 'none';
  position?: 'absolute' | 'relative';
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
  margin?: number | string;
  marginTop?: number | string;
  marginRight?: number | string;
  marginBottom?: number | string;
  marginLeft?: number | string;
  marginHorizontal?: number | string;
  marginVertical?: number | string;
  padding?: number | string;
  paddingTop?: number | string;
  paddingRight?: number | string;
  paddingBottom?: number | string;
  paddingLeft?: number | string;
  paddingHorizontal?: number | string;
  paddingVertical?: number | string;
  overflow?: 'visible' | 'hidden' | 'scroll';

  // Flex
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse';
  justifyContent?: string;
  alignItems?: string;
  alignSelf?: string;
  gap?: number;
  rowGap?: number;
  columnGap?: number;

  // Typography
  fontFamily?: string;
  fontSize?: number;
  fontWeight?:
    | 'normal'
    | 'bold'
    | '100'
    | '200'
    | '300'
    | '400'
    | '500'
    | '600'
    | '700'
    | '800'
    | '900';
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'auto' | 'left' | 'right' | 'center' | 'justify';
  textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase';
  textDecorationLine?: 'none' | 'underline' | 'line-through' | 'underline line-through';

  // Color
  color?: string;
  backgroundColor?: string;

  // Border
  borderWidth?: number;
  borderTopWidth?: number;
  borderRightWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderColor?: string;
  borderTopColor?: string;
  borderRightColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;

  // Visual
  opacity?: number;
  transform?: Array<Record<string, number>>;

  // Shadow (iOS)
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;

  // Shadow (Android)
  elevation?: number;

  // Other
  zIndex?: number;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';

  /** Catch-all for additional/custom style properties */
  [key: string]: unknown;
}

/**
 * State-specific style overrides for RN (maps to Pressable states)
 */
export interface NativeStateStyles {
  pressed?: FlattenedNativeStyle;
  focused?: FlattenedNativeStyle;
  disabled?: FlattenedNativeStyle;
}

/**
 * Native interaction state names.
 * RN doesn't have hover/active — uses pressed, focused, disabled instead.
 */
export type NativeInteractionStateName = 'default' | 'pressed' | 'focused' | 'disabled';
