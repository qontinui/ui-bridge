/**
 * Vision analyzer field projection.
 *
 * The runner's vision pipeline (`POST /ui-bridge/vision/{analyze,assert}`)
 * deserializes a snapshot's `elements[]` straight into the Rust
 * `qontinui_vision_core::Element` struct. Beyond geometry (`bbox` — see
 * {@link projectBbox}), the analyzers read these per-element fields:
 *
 *   - `interactable: bool`          — elements analyzer (interactive coverage),
 *                                     layout analyzer (WCAG target size).
 *   - `text: Option<String>`        — elements (no_text), color (contrast gate).
 *   - `role: Option<String>`        — elements analyzer role vocabulary.
 *   - `fg_color`/`bg_color: Rgb`    — color analyzer (WCAG contrast).
 *   - `font_size_px: f32`           — typography analyzer (size drift).
 *   - `font_family: String`         — typography analyzer (family drift).
 *
 * The web SDK populates the runner-facing equivalents via `getComputedStyle`
 * (`state.computedStyles.{color,backgroundColor,fontSize,fontFamily}`) and
 * the DOM (`textContent`, aria `role`, event handlers / tag → interactable);
 * the runner projects those into the snake_case Rust shape. React Native has
 * NO `getComputedStyle`, so the native SDK derives the same signals from what
 * the registry already carries:
 *
 *   - `interactable` ← the element's `actions` (press/click/tap/...) or its
 *     interactive `type` (button/input/switch/...). Mirrors web's
 *     "has a click-type handler OR is an interactive tag".
 *   - `text` ← `state.value` / `state.textContent` / `label` (human-visible).
 *   - `role` ← `type` mapped to the ARIA-ish vocabulary the analyzer expects.
 *   - `fg_color`/`bg_color` ← parsed from `flatStyle.color` /
 *     `flatStyle.backgroundColor` when the host wired styles via
 *     `captureStyle`/`updateElementStyle`. Same source the design inspector
 *     reads. Absent when no style was wired (analyzer soft-skips).
 *   - `font_size_px` ← `flatStyle.fontSize` (RN number is already px).
 *   - `font_family` ← `flatStyle.fontFamily`.
 *
 * These fields are emitted directly in the runner-native snake_case shape so a
 * visual-audit caller can post the snapshot through with no transform — same
 * rationale as `bbox` emitting `{x,y,w,h}` (see {@link NativeElementBbox}).
 */

import type { NativeElementState, NativeElementType } from './types';

/** Linear RGB triple, runner-native shape (`qontinui_vision_core::Rgb`). */
export interface VisionRgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Analyzer-facing fields projected onto a snapshot element. Every field is
 * optional/absent-when-unknown so the Rust deserializer's serde defaults
 * (`interactable: false`, the rest `None`) only kick in when we genuinely
 * couldn't derive the value — matching the "soft skip on missing field"
 * contract in `element_snapshot.rs`.
 */
export interface VisionElementFields {
  interactable: boolean;
  text?: string;
  role?: string;
  fg_color?: VisionRgb;
  bg_color?: VisionRgb;
  font_size_px?: number;
  font_family?: string;
}

/**
 * Real React Native handler prop names that imply the element accepts
 * pointer/key input. This is the GENUINE interactivity signal — a prop the host
 * actually wired to a function (surfaced by `extractHandlerNames(props)` as the
 * snapshot's `registeredHandlers`). Mirrors the web SDK's "has a real
 * click-type event handler" interactable signal.
 *
 * Deliberately NOT derived from the element's `actions` array: `inferActions`
 * synthesizes `click`/`press` for EVERY element (even plain `text`/`view`/
 * `custom`), so an action-based check marks every node interactive. The real
 * handler names below are only present when the app source actually attached
 * `onPress` (etc.) to that element.
 */
const INTERACTIVE_HANDLER_NAMES: ReadonlySet<string> = new Set([
  'onPress',
  'onPressIn',
  'onPressOut',
  'onLongPress',
  'onChangeText',
  'onValueChange',
  'onChange',
  'onSubmitEditing',
  'onClick',
  'onTouchStart',
  'onTouchEnd',
]);

/**
 * Element types that are inherently interactive regardless of which actions
 * were inferred/declared. Mirrors web treating `<button>/<a>/<input>/<select>`
 * as interactive by tag. `text`/`view`/`image` are intentionally absent — a
 * plain Text/View is only interactive if it carries a REAL press handler
 * (handled by the handler check), matching web's "div is interactive only with
 * a handler".
 */
const INTERACTIVE_TYPES: ReadonlySet<NativeElementType> = new Set<NativeElementType>([
  'button',
  'input',
  'switch',
  'checkbox',
  'radio',
  'touchable',
  'pressable',
  'listItem',
]);

/**
 * Map a native element `type` to the ARIA-ish `role` vocabulary the runner's
 * elements analyzer expects (matches the web SDK's aria/role values). Returns
 * `undefined` for generic containers so the analyzer doesn't over-count roles.
 */
export function roleForType(type: NativeElementType): string | undefined {
  switch (type) {
    case 'button':
    case 'touchable':
    case 'pressable':
      return 'button';
    case 'input':
      return 'textbox';
    case 'text':
      return 'text';
    case 'switch':
      return 'switch';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'image':
      return 'img';
    case 'list':
      return 'list';
    case 'listItem':
      return 'listitem';
    case 'modal':
      return 'dialog';
    case 'scroll':
    case 'view':
    case 'custom':
    default:
      return undefined;
  }
}

/**
 * Derive whether an element accepts input. True when it is an
 * inherently-interactive `type` (button/input/switch/...) OR the host wired a
 * REAL interactive handler to it (`onPress`/`onChangeText`/...). Matches web's
 * "has a real click-type handler OR is an interactive tag".
 *
 * The `handlerNames` come from `extractHandlerNames(props)` — the names of the
 * element's props whose values are actually functions (the snapshot's
 * `registeredHandlers`). This is the genuine interactivity signal. The
 * element's inferred `actions` array is deliberately NOT consulted:
 * `inferActions` synthesizes `click`/`press` for plain `text`/`view`/`custom`,
 * so an action-based check would mark every node interactive (the very
 * over-count this function exists to avoid). A plain `text`/`view`/`heading`
 * with no real handler is therefore `interactable: false`, mirroring web.
 */
export function deriveInteractable(
  type: NativeElementType,
  handlerNames: readonly string[] | undefined
): boolean {
  if (INTERACTIVE_TYPES.has(type)) return true;
  if (handlerNames) {
    for (const name of handlerNames) {
      if (INTERACTIVE_HANDLER_NAMES.has(name)) return true;
    }
  }
  return false;
}

/**
 * Derive the human-visible text for an element, preferring the most
 * "what the user reads" source. Mirrors web's `textContent`/accessibleName
 * precedence adapted to RN's registry shape:
 *   1. `state.value`       — current input value / text element's mirrored label.
 *   2. `state.textContent` — explicit text content if the host set it.
 *   3. `label`             — registration label (often the visible string).
 * Returns `undefined` when none carry a non-empty string so the analyzer's
 * `text.is_none()` gate stays accurate.
 */
export function deriveText(
  state: Pick<NativeElementState, 'value' | 'textContent'>,
  label: string | undefined
): string | undefined {
  const candidates = [state.value, state.textContent, label];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

// Common CSS/RN named colors. RN accepts the full CSS named-color set; we
// cover the ones a design system realistically declares inline. Anything
// outside this map + the hex/rgb parsers returns undefined (analyzer skips).
const NAMED_COLORS: Readonly<Record<string, VisionRgb>> = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 128, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  silver: { r: 192, g: 192, b: 192 },
  transparent: { r: 0, g: 0, b: 0 },
  orange: { r: 255, g: 165, b: 0 },
  yellow: { r: 255, g: 255, b: 0 },
  purple: { r: 128, g: 0, b: 128 },
  navy: { r: 0, g: 0, b: 128 },
};

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Parse an RN/CSS color string into a runner-native `{r,g,b}` triple, dropping
 * alpha (the runner's `Rgb` has no alpha; the analyzers convert to Lab/sRGB on
 * demand). Supports:
 *   - `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
 *   - `rgb(r,g,b)` / `rgba(r,g,b,a)` (integer or %),
 *   - named colors (subset).
 * Returns `undefined` for `undefined`, non-strings, or unrecognized formats so
 * the snapshot omits the field and the analyzer soft-skips rather than seeing a
 * bogus color. RN integer colors (e.g. `processColor` output) are not handled —
 * inline styles in app source are strings.
 */
export function parseColorToRgb(input: unknown): VisionRgb | undefined {
  if (typeof input !== 'string') return undefined;
  const raw = input.trim().toLowerCase();
  if (raw.length === 0) return undefined;

  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, raw)) {
    return NAMED_COLORS[raw];
  }

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].every((v) => Number.isFinite(v))) return { r, g, b };
      return undefined;
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].every((v) => Number.isFinite(v))) return { r, g, b };
      return undefined;
    }
    return undefined;
  }

  // rgb()/rgba()
  const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((p) => p.trim());
    if (parts.length < 3) return undefined;
    const channel = (p: string): number | undefined => {
      if (p.endsWith('%')) {
        const pct = parseFloat(p.slice(0, -1));
        if (!Number.isFinite(pct)) return undefined;
        return clamp255((pct / 100) * 255);
      }
      const n = parseFloat(p);
      if (!Number.isFinite(n)) return undefined;
      return clamp255(n);
    };
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return { r, g, b };
  }

  return undefined;
}

/**
 * Parse an RN `fontSize` into CSS pixels. RN `fontSize` is a unitless number
 * already in density-independent pixels (the analyzer compares relative sizes,
 * so dp vs px scaling is consistent across all elements in one snapshot).
 * Accepts a bare number or a `"16px"`/`"16"` string. Returns `undefined` for
 * anything non-numeric so typography soft-skips.
 */
export function parseFontSizePx(input: unknown): number | undefined {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? input : undefined;
  }
  if (typeof input === 'string') {
    const m = input.trim().match(/^(-?\d*\.?\d+)/);
    if (m) {
      const n = parseFloat(m[1]);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
  }
  return undefined;
}

/**
 * Project the analyzer-facing fields for one registered element. Pure — takes
 * the already-resolved state + the element's static metadata, returns the
 * snake_case field bag to spread onto the snapshot element. Visual fields
 * (colors/fonts) are present only when `flatStyle` carried them; the runner's
 * serde defaults handle their absence.
 *
 * Unlike `bbox` (gated on `visibility === 'visible'`), interactable/text/role
 * are populated for ALL elements so the elements analyzer's coverage counts
 * are accurate — matching the web SDK, which emits role/text/interactable for
 * every element it discovers regardless of viewport position.
 */
export function projectVisionFields(args: {
  type: NativeElementType;
  label: string | undefined;
  /**
   * Names of the element's props that are real functions (from
   * `extractHandlerNames(props)` — the snapshot's `registeredHandlers`). The
   * genuine interactivity signal; the inferred `actions` array is NOT used here
   * because `inferActions` synthesizes press/click for every element.
   */
  handlerNames: readonly string[] | undefined;
  state: Pick<NativeElementState, 'value' | 'textContent'>;
  flatStyle: Record<string, unknown> | undefined;
}): VisionElementFields {
  const { type, label, handlerNames, state, flatStyle } = args;

  const fields: VisionElementFields = {
    interactable: deriveInteractable(type, handlerNames),
  };

  const text = deriveText(state, label);
  if (text !== undefined) fields.text = text;

  const role = roleForType(type);
  if (role !== undefined) fields.role = role;

  if (flatStyle) {
    const fg = parseColorToRgb(flatStyle.color);
    if (fg !== undefined) fields.fg_color = fg;
    const bg = parseColorToRgb(flatStyle.backgroundColor);
    if (bg !== undefined) fields.bg_color = bg;
    const size = parseFontSizePx(flatStyle.fontSize);
    if (size !== undefined) fields.font_size_px = size;
    if (typeof flatStyle.fontFamily === 'string' && flatStyle.fontFamily.trim().length > 0) {
      fields.font_family = flatStyle.fontFamily;
    }
  }

  return fields;
}
