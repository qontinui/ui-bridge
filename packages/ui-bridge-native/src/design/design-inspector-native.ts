/**
 * Native Design Inspector
 *
 * Pure TypeScript functions that map flattened React Native styles to the
 * web SDK's ExtendedComputedStyles format. No react-native imports — works
 * with already-flattened style objects from the registry.
 *
 * Key differences from web:
 * - No `window.getComputedStyle()` — styles are declarative objects
 * - No hover/active states — uses pressed/focused/disabled
 * - No pseudo-elements (::before/::after)
 * - No CSS grid, cursor, visibility, transitions, background-image
 * - RN default flexDirection is 'column' (not 'row')
 * - Shadows differ: iOS uses shadow* props, Android uses elevation
 * - Numeric values → "Npx" strings
 */

import type {
  ExtendedComputedStyles,
  ElementDesignData,
  StateStyles,
  StyleDiff,
  ResponsiveSnapshot,
  NativeInteractionStateName,
} from './design-types';
import type { NativeLayout } from '../core/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a numeric RN value to a CSS px string.
 * String values (like "50%") pass through unchanged.
 */
function toCssValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return `${value}px`;
  return String(value);
}

/**
 * Convert RN transform array to CSS transform string.
 * e.g. [{translateX: 10}, {rotate: '45deg'}] → "translateX(10px) rotate(45deg)"
 */
function transformToCss(transform: unknown): string {
  if (!Array.isArray(transform) || transform.length === 0) return '';

  return transform
    .map((t: Record<string, unknown>) => {
      const key = Object.keys(t)[0];
      if (!key) return '';
      const val = t[key];
      // Rotation values are already strings like '45deg'
      if (typeof val === 'string') return `${key}(${val})`;
      // Numeric values need px for translate, unitless for scale
      if (typeof val === 'number') {
        const needsPx = key.startsWith('translate') || key === 'perspective';
        return `${key}(${val}${needsPx ? 'px' : ''})`;
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Convert RN shadow props (iOS) + elevation (Android) to CSS box-shadow string.
 */
function shadowToCss(style: Record<string, unknown>): string {
  const parts: string[] = [];

  // iOS shadow
  const shadowColor = style.shadowColor as string | undefined;
  const shadowOffset = style.shadowOffset as { width: number; height: number } | undefined;
  const shadowOpacity = style.shadowOpacity as number | undefined;
  const shadowRadius = style.shadowRadius as number | undefined;

  if (shadowColor && shadowOffset && shadowOpacity != null && shadowOpacity > 0) {
    const { width, height } = shadowOffset;
    parts.push(
      `${width}px ${height}px ${shadowRadius ?? 0}px ${shadowColor}` +
        (shadowOpacity < 1 ? ` /* opacity: ${shadowOpacity} */` : '')
    );
  }

  // Android elevation
  const elevation = style.elevation as number | undefined;
  if (elevation != null && elevation > 0) {
    parts.push(`elevation(${elevation})`);
  }

  return parts.join(', ');
}

/**
 * Convert RN border props to CSS border shorthand.
 */
function borderToCss(style: Record<string, unknown>): string {
  const width = style.borderWidth as number | undefined;
  const color = style.borderColor as string | undefined;

  if (width == null && color == null) return '';
  return `${width ?? 0}px solid ${color ?? 'transparent'}`;
}

/**
 * Convert RN borderRadius to CSS border-radius string.
 * Handles both uniform radius and per-corner values.
 */
function borderRadiusToCss(style: Record<string, unknown>): string {
  const uniform = style.borderRadius as number | undefined;
  if (uniform != null) return `${uniform}px`;

  const tl = style.borderTopLeftRadius as number | undefined;
  const tr = style.borderTopRightRadius as number | undefined;
  const bl = style.borderBottomLeftRadius as number | undefined;
  const br = style.borderBottomRightRadius as number | undefined;

  if (tl == null && tr == null && bl == null && br == null) return '';
  return `${tl ?? 0}px ${tr ?? 0}px ${br ?? 0}px ${bl ?? 0}px`;
}

/**
 * Resolve margin/padding shorthand + Horizontal/Vertical expansions.
 * Returns top, right, bottom, left values.
 */
function resolveSpacing(
  style: Record<string, unknown>,
  prefix: 'margin' | 'padding'
): { top: string; right: string; bottom: string; left: string; shorthand: string } {
  const all = style[prefix];
  const top = style[`${prefix}Top`] ?? style[`${prefix}Vertical`] ?? all;
  const bottom = style[`${prefix}Bottom`] ?? style[`${prefix}Vertical`] ?? all;
  const right = style[`${prefix}Right`] ?? style[`${prefix}Horizontal`] ?? all;
  const left = style[`${prefix}Left`] ?? style[`${prefix}Horizontal`] ?? all;

  const t = toCssValue(top);
  const r = toCssValue(right);
  const b = toCssValue(bottom);
  const l = toCssValue(left);

  // Build shorthand
  let shorthand = '';
  if (t || r || b || l) {
    if (t === r && r === b && b === l) {
      shorthand = t || '0px';
    } else if (t === b && r === l) {
      shorthand = `${t || '0px'} ${r || '0px'}`;
    } else {
      shorthand = `${t || '0px'} ${r || '0px'} ${b || '0px'} ${l || '0px'}`;
    }
  }

  return {
    top: t,
    right: r,
    bottom: b,
    left: l,
    shorthand,
  };
}

/**
 * Resolve gap values (gap, rowGap, columnGap).
 */
function resolveGap(style: Record<string, unknown>): string {
  const gap = style.gap as number | undefined;
  const rowGap = style.rowGap as number | undefined;
  const columnGap = style.columnGap as number | undefined;

  if (gap != null) return `${gap}px`;
  if (rowGap != null && columnGap != null) return `${rowGap}px ${columnGap}px`;
  if (rowGap != null) return `${rowGap}px`;
  if (columnGap != null) return `${columnGap}px`;
  return '';
}

// ============================================================================
// Core mapping function
// ============================================================================

/**
 * Map a flattened React Native style object to ExtendedComputedStyles.
 *
 * Rules:
 * - Numeric values → "Npx"
 * - String values → pass through
 * - textDecorationLine → textDecoration
 * - RN shadow props → boxShadow string
 * - CSS-only properties (cursor, visibility, grid*, etc.) → empty string
 */
export function mapNativeStyleToExtended(
  rnStyle: Record<string, unknown> | undefined | null
): ExtendedComputedStyles {
  const s = rnStyle ?? {};

  const margin = resolveSpacing(s, 'margin');
  const padding = resolveSpacing(s, 'padding');

  return {
    // Layout
    display: (s.display as string) ?? 'flex',
    position: (s.position as string) ?? 'relative',
    boxSizing: '', // CSS-only
    width: toCssValue(s.width),
    height: toCssValue(s.height),
    minWidth: toCssValue(s.minWidth),
    maxWidth: toCssValue(s.maxWidth),
    minHeight: toCssValue(s.minHeight),
    maxHeight: toCssValue(s.maxHeight),
    margin: margin.shorthand,
    marginTop: margin.top,
    marginRight: margin.right,
    marginBottom: margin.bottom,
    marginLeft: margin.left,
    padding: padding.shorthand,
    paddingTop: padding.top,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left,
    overflow: (s.overflow as string) ?? '',
    overflowX: '', // CSS-only
    overflowY: '', // CSS-only

    // Flex/Grid — RN defaults to column, not row
    flexDirection: (s.flexDirection as string) ?? '',
    flexWrap: (s.flexWrap as string) ?? '',
    justifyContent: (s.justifyContent as string) ?? '',
    alignItems: (s.alignItems as string) ?? '',
    alignSelf: (s.alignSelf as string) ?? '',
    gap: resolveGap(s),
    gridTemplateColumns: '', // CSS-only
    gridTemplateRows: '', // CSS-only

    // Typography
    fontFamily: (s.fontFamily as string) ?? '',
    fontSize: toCssValue(s.fontSize),
    fontWeight: (s.fontWeight as string) ?? '',
    lineHeight: toCssValue(s.lineHeight),
    letterSpacing: toCssValue(s.letterSpacing),
    textAlign: (s.textAlign as string) ?? '',
    textTransform: (s.textTransform as string) ?? '',
    textDecoration: (s.textDecorationLine as string) ?? '', // RN name → CSS name
    color: (s.color as string) ?? '',

    // Visual
    backgroundColor: (s.backgroundColor as string) ?? '',
    backgroundImage: '', // CSS-only
    border: borderToCss(s),
    borderRadius: borderRadiusToCss(s),
    boxShadow: shadowToCss(s),
    opacity: s.opacity != null ? String(s.opacity) : '',
    outline: '', // CSS-only

    // Effects
    transform: transformToCss(s.transform),
    transition: '', // CSS-only
    cursor: '', // CSS-only
    zIndex: s.zIndex != null ? String(s.zIndex) : '',
    visibility: '', // CSS-only
    pointerEvents: (s.pointerEvents as string) ?? '',
  };
}

// ============================================================================
// Design data functions
// ============================================================================

/**
 * Produce ElementDesignData for a single native element.
 */
export function getNativeElementDesignData(
  id: string,
  label: string | undefined,
  type: string,
  rnStyle: Record<string, unknown> | undefined | null,
  layout: NativeLayout | null
): ElementDesignData {
  return {
    elementId: id,
    label,
    type,
    styles: mapNativeStyleToExtended(rnStyle),
    pseudoElements: [], // RN has no pseudo-elements
    rect: layout
      ? {
          x: layout.pageX,
          y: layout.pageY,
          width: layout.width,
          height: layout.height,
        }
      : { x: 0, y: 0, width: 0, height: 0 },
  };
}

/**
 * Compute style diffs between default and a state variation.
 */
function computeStyleDiff(
  defaultStyles: ExtendedComputedStyles,
  stateStyles: ExtendedComputedStyles
): StyleDiff[] {
  const diffs: StyleDiff[] = [];
  for (const key of Object.keys(defaultStyles) as Array<keyof ExtendedComputedStyles>) {
    if (defaultStyles[key] !== stateStyles[key]) {
      diffs.push({
        property: key,
        defaultValue: defaultStyles[key],
        stateValue: stateStyles[key],
      });
    }
  }
  return diffs;
}

/**
 * Merge a base RN style with a state override.
 */
function mergeStyles(
  base: Record<string, unknown>,
  override: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Produce StateStyles[] for default/pressed/focused/disabled.
 * Only includes states that have actual overrides or the default state.
 */
export function captureNativeStateVariations(
  baseStyle: Record<string, unknown> | undefined | null,
  stateStyles?: {
    pressed?: Record<string, unknown>;
    focused?: Record<string, unknown>;
    disabled?: Record<string, unknown>;
  }
): StateStyles[] {
  const base = baseStyle ?? {};
  const defaultExtended = mapNativeStyleToExtended(base);

  const results: StateStyles[] = [
    {
      state: 'default',
      styles: defaultExtended,
      diffFromDefault: [],
    },
  ];

  if (!stateStyles) return results;

  const states: Array<{ name: NativeInteractionStateName; override?: Record<string, unknown> }> = [
    { name: 'pressed', override: stateStyles.pressed },
    { name: 'focused', override: stateStyles.focused },
    { name: 'disabled', override: stateStyles.disabled },
  ];

  for (const { name, override } of states) {
    if (!override) continue;
    const merged = mergeStyles(base, override);
    const extended = mapNativeStyleToExtended(merged);
    const diff = computeStyleDiff(defaultExtended, extended);
    if (diff.length > 0) {
      results.push({ state: name, styles: extended, diffFromDefault: diff });
    }
  }

  return results;
}

/**
 * Capture a responsive snapshot.
 *
 * Platform limitation: RN cannot constrain screen width at runtime.
 * This returns a single snapshot at the current device dimensions.
 */
export function captureNativeResponsiveSnapshot(
  elements: Array<{
    id: string;
    label?: string;
    type: string;
    flatStyle?: Record<string, unknown>;
    layout: NativeLayout | null;
  }>,
  screenDimensions: { width: number; height: number }
): ResponsiveSnapshot[] {
  const elementData = elements.map((el) =>
    getNativeElementDesignData(el.id, el.label, el.type, el.flatStyle, el.layout)
  );

  return [
    {
      viewportWidth: screenDimensions.width,
      viewportLabel: 'current',
      elements: elementData,
      timestamp: Date.now(),
    },
  ];
}
