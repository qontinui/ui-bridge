/**
 * The ONE computed-style projection, and its extended variant.
 *
 * Four projections (`control/action-executor.ts`, `core/registry.ts`,
 * `debug/inspector.tsx`, `render-log/dom-capture.ts`) used to carry literal
 * copies of the same whitelist, free to drift apart. They all call
 * {@link projectComputedStyles} now. It keeps the ORIGINAL key set on purpose:
 * every snapshot and render-log element carries it, so widening it widens
 * every payload. The component capture (`control/component-capture.ts`)
 * needs sizing, flex and per-axis overflow too, and reads
 * {@link projectExtendedComputedStyles}, which is built on the base so the
 * shared keys cannot drift.
 *
 * Reads style properties only — no DOM content — so it is outside the §4.6
 * redaction surface.
 */

import type { ElementState } from './types';

/** The projected style map, exactly `ElementState.computedStyles`. */
export type ProjectedComputedStyles = NonNullable<ElementState['computedStyles']>;

/** Project a `CSSStyleDeclaration` onto the base whitelist (snapshots, render log). */
export function projectComputedStyles(style: CSSStyleDeclaration): ProjectedComputedStyles {
  return {
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    pointerEvents: style.pointerEvents,
    cursor: style.cursor,
    color: style.color,
    backgroundColor: style.backgroundColor,
    colorScheme: style.colorScheme,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    overflow: style.overflow,
    textOverflow: style.textOverflow,
    whiteSpace: style.whiteSpace,
    position: style.position,
    zIndex: style.zIndex,
    padding: style.padding,
    margin: style.margin,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderRadius: style.borderRadius,
  };
}

/**
 * The base projection plus the optional sizing / flex / box-model / per-axis
 * overflow / font-family keys. For the component capture only.
 */
export function projectExtendedComputedStyles(
  style: CSSStyleDeclaration
): Required<ProjectedComputedStyles> {
  return {
    ...projectComputedStyles(style),
    width: style.width,
    height: style.height,
    minWidth: style.minWidth,
    maxWidth: style.maxWidth,
    minHeight: style.minHeight,
    maxHeight: style.maxHeight,
    flexGrow: style.flexGrow,
    flexShrink: style.flexShrink,
    flexBasis: style.flexBasis,
    flexDirection: style.flexDirection,
    boxSizing: style.boxSizing,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    fontFamily: style.fontFamily,
  };
}
