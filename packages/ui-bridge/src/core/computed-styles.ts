/**
 * The ONE computed-style projection.
 *
 * Four projections (`control/action-executor.ts`, `core/registry.ts`,
 * `debug/inspector.tsx`, `render-log/dom-capture.ts`) used to carry literal
 * copies of the same whitelist, free to drift apart. They all call this now,
 * and so does the component capture (`control/component-capture.ts`), whose
 * `styles` map is a subset of this projection.
 *
 * Reads style properties only — no DOM content — so it is outside the §4.6
 * redaction surface.
 */

import type { ElementState } from './types';

/** The projected style map, exactly `ElementState.computedStyles`. */
export type ProjectedComputedStyles = NonNullable<ElementState['computedStyles']>;

/** Project a `CSSStyleDeclaration` onto the whitelisted style map. */
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
