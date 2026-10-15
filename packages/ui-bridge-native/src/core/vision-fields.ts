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
 *   - `text` ← `state.value` / `state.textContent` / `label` (human-visible) —
 *     never for an `image`, which paints no text: its label is its
 *     accessibility label, i.e. its alt (see {@link projectVisionFields}).
 *   - `role` ← `type` mapped to the ARIA-ish vocabulary the analyzer expects.
 *   - `fg_color`/`bg_color` ← parsed from `flatStyle.color` /
 *     `flatStyle.backgroundColor` when the host wired styles via
 *     `captureStyle`/`updateElementStyle`. Same source the design inspector
 *     reads. Absent when no style was wired (analyzer soft-skips) — and absent
 *     for `transparent` or any partial alpha, which are UNKNOWN, never black
 *     and never flattened (see {@link parseColorToRgb}).
 *   - `font_size_px` ← `flatStyle.fontSize` (RN number is already px).
 *   - `font_family` ← `flatStyle.fontFamily`.
 *   - `media` ← for an `image`: its laid-out size, the object-fit its resize
 *     mode paints, its accessibility label as the text alternative, a digest of
 *     its source URL and whether it is on screen (see {@link projectMedia}).
 *
 * These fields are emitted directly in the runner-native snake_case shape so a
 * visual-audit caller can post the snapshot through with no transform — same
 * rationale as `bbox` emitting `{x,y,w,h}` (see {@link NativeElementBbox}).
 */

import { sha256Hex } from './sha256';
import type { NativeElementState, NativeElementType, NativeLayout } from './types';

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
  media?: VisionMedia;
}

/** CSS `object-fit` keywords — the vocabulary of `ElementMedia.object_fit`. */
export type VisionObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';

/**
 * The part of vision-core's `ElementMedia` (qontinui-schemas
 * `rust-vision-core/src/element_media.rs`) a native registry can measure. Every
 * field but `kind` is omitted when unknown — absence is "not measured", never
 * zero, `false` or "none".
 *
 * There is no `natural_px` (and so no `effective_resolution`): the registry
 * never learns an image's intrinsic size, so the source-pixel question —
 * including the density correction a `srcSet` candidate brings — never arises
 * here; vision-core reads both as unmeasured.
 */
export interface VisionMedia {
  /** A native image is vision-core's `img`. */
  kind: 'img';
  /**
   * The view's measured size in dp (`state.layout`, from `onLayout` /
   * `measureInWindow`) — vision-core's drawn-box `rendered_px` — before the
   * pixel-ratio scaling `bbox` applies.
   */
  rendered_px?: { w: number; h: number };
  /** The CSS object-fit the image's resize mode paints as (see {@link resolveObjectFit}). */
  object_fit?: VisionObjectFit;
  /**
   * The text alternative, read as one measurement (see {@link projectMedia}
   * for the rule): `{ decorative: true }` only from an explicit RN hide
   * signal in the recorded props (see {@link isHiddenFromAccessibility});
   * otherwise `{ decorative: false, text }` from the label RN announces
   * (`aria-label ?? accessibilityLabel ?? alt`; the registry's label only when
   * no props were recorded —
   * see {@link resolveImageLabel}) when it is non-empty after stripping ASCII
   * whitespace; otherwise the
   * whole record is OMITTED. RN has no `alt=""` convention, so an empty or
   * whitespace-only label is no reading of the alternative, exactly like a
   * missing one.
   */
  alt?: { decorative: boolean; text?: string };
  /** Lowercase hex SHA-256 of the source URL, query kept (see {@link resolveImageSource}). */
  src_digest?: string;
  /** Whether the measured rect intersects the element's clip region (`computeInViewport`). */
  in_viewport?: boolean;
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
//
// `transparent` is deliberately NOT here. It used to map to {0,0,0}, which
// made a transparent background read as OPAQUE BLACK — so light text over an
// image (where the background really is the image) could PASS a contrast check
// against a black that does not exist. It now parses to undefined: unknown.
const NAMED_COLORS: Readonly<Record<string, VisionRgb>> = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 128, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  silver: { r: 192, g: 192, b: 192 },
  orange: { r: 255, g: 165, b: 0 },
  yellow: { r: 255, g: 255, b: 0 },
  purple: { r: 128, g: 0, b: 128 },
  navy: { r: 0, g: 0, b: 128 },
};

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/**
 * The alpha of an `rgba()` component (`0.5`, `50%`), or undefined when it
 * does not parse. CSS clamps an alpha above 1 to 1.
 */
function parseAlpha(p: string): number | undefined {
  const pct = p.endsWith('%');
  const n = parseFloat(pct ? p.slice(0, -1) : p);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(1, pct ? n / 100 : n);
}

/**
 * Parse an RN/CSS color string into a runner-native `{r,g,b}` triple — for a
 * FULLY OPAQUE color only. Supports:
 *   - `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
 *   - `rgb(r,g,b)` / `rgba(r,g,b,a)` (integer or %),
 *   - named colors (subset).
 * Returns `undefined` for `undefined`, non-strings, unrecognized formats,
 * `transparent`, and ANY alpha below 1, so the snapshot omits the field and
 * the analyzer reads it as unmeasured rather than seeing a bogus color.
 *
 * Why partial alpha is unknown rather than flattened: the runner's `Rgb` has
 * no alpha channel, and a translucent color is composited over whatever lies
 * beneath it — which a snapshot does not carry. Dropping the alpha would turn
 * half-transparent black over a white screen (mid-grey) into BLACK, and a
 * contrast check over that fabricated black can pass illegible text.
 *
 * RN integer colors (e.g. `processColor` output) are not handled — inline
 * styles in app source are strings.
 */
export function parseColorToRgb(input: unknown): VisionRgb | undefined {
  if (typeof input !== 'string') return undefined;
  const raw = input.trim().toLowerCase();
  if (raw.length === 0) return undefined;

  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, raw)) {
    return NAMED_COLORS[raw];
  }

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa — an alpha digit pair must be `ff`.
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && hex[3] !== 'f') return undefined;
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].every((v) => Number.isFinite(v))) return { r, g, b };
      return undefined;
    }
    if (hex.length === 6 || hex.length === 8) {
      if (hex.length === 8 && hex.slice(6, 8) !== 'ff') return undefined;
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
    if (parts.length < 3 || parts.length > 4) return undefined;
    if (parts.length === 4) {
      const alpha = parseAlpha(parts[3]);
      if (alpha === undefined || alpha < 1) return undefined;
    }
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
 * HTML's "ASCII whitespace" at either end: tab, LF, FF, CR, space — the same
 * STRIPPING the web converters apply to alt text, so one label reads the same
 * text on every surface. Only the stripping is shared: what an EMPTY result
 * means is not (see {@link projectMedia}). Deliberately not
 * `String.prototype.trim`, which also strips U+00A0 and every other Unicode
 * space.
 */
const ASCII_WHITESPACE_EDGES = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/** A non-empty string, or undefined — RN reads resize props with `||`. */
function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * RN's own `objectFit` style → resize mode map (react-native
 * `Libraries/Image/ImageUtils.js`). `scale-down` is NOT implemented by RN: it
 * paints as `contain`, so that is what it maps to here too.
 */
const OBJECT_FIT_TO_RESIZE_MODE: ReadonlyMap<string, string> = new Map([
  ['contain', 'contain'],
  ['cover', 'cover'],
  ['fill', 'stretch'],
  ['scale-down', 'contain'],
  ['none', 'none'],
]);

/**
 * RN resize mode → the CSS object-fit that paints the same layout. `center`
 * ("scale down if bigger, never up, centred") is exactly CSS `scale-down`.
 * `repeat` TILES the image, which no object-fit paints, so it maps to nothing
 * and the field is omitted rather than approximated.
 */
const RESIZE_MODE_TO_OBJECT_FIT: ReadonlyMap<string, VisionObjectFit> = new Map<
  string,
  VisionObjectFit
>([
  ['cover', 'cover'],
  ['contain', 'contain'],
  ['stretch', 'fill'],
  ['center', 'scale-down'],
  ['none', 'none'],
]);

/**
 * The object-fit an RN `Image` actually paints with, from what the registry
 * recorded — RN's own precedence (`Image.ios.js` / `Image.android.js`): the
 * `objectFit` style, then the `resizeMode` prop, then the `resizeMode` style.
 *
 * RN's final fallback is `'cover'`, and it is NOT applied here: an element
 * registered as `type: 'image'` need not be RN's `Image` (an `expo-image`, a
 * `FastImage` and an SVG wrapper all register the same way), so a mode the
 * registry never saw is UNKNOWN rather than RN's default.
 */
export function resolveObjectFit(
  props: Record<string, unknown> | undefined,
  flatStyle: Record<string, unknown> | undefined
): VisionObjectFit | undefined {
  // Maps, not object literals: these strings come from the app, and an object
  // lookup would answer for inherited prototype keys (`constructor`, …).
  const styleFit = nonEmptyString(flatStyle?.objectFit);
  const mode =
    (styleFit !== undefined ? OBJECT_FIT_TO_RESIZE_MODE.get(styleFit) : undefined) ??
    nonEmptyString(props?.resizeMode) ??
    nonEmptyString(flatStyle?.resizeMode);
  return mode !== undefined ? RESIZE_MODE_TO_OBJECT_FIT.get(mode) : undefined;
}

/**
 * The URL an RN `Image` displays, from its recorded props — RN's own
 * precedence (`getImageSourcesFromImageProps`): `srcSet`, then `src`, then
 * `source`. Undefined when the displayed URL cannot be named:
 *   - a `srcSet`, or a `source` array of several candidates — RN picks one by
 *     size and density at render time, so which one shows is unknown;
 *   - a `require()`d asset (`source` is a number) — it has no URL;
 *   - no `props` recorded at all (the host never captured them).
 */
export function resolveImageSource(props: Record<string, unknown> | undefined): string | undefined {
  if (!props) return undefined;
  if (props.srcSet !== undefined && props.srcSet !== null) return undefined;
  const src = nonEmptyString(props.src);
  if (src !== undefined) return src;
  const source = props.source;
  const one = Array.isArray(source) ? (source.length === 1 ? source[0] : undefined) : source;
  if (one && typeof one === 'object') {
    return nonEmptyString((one as Record<string, unknown>).uri);
  }
  return undefined;
}

/**
 * Whether an RN `Image`'s recorded props EXPLICITLY take it out of the
 * accessibility tree — the only "presentational" signals an image has, read
 * the way react-native's own `Image` reads them (checked against 0.81.5
 * `Image.ios.js` / `Image.android.js`):
 *
 * - `accessible={false}` — but ONLY when `alt` is absent: `Image` forces
 *   `accessible: props.alt !== undefined ? true : props.accessible`, so an
 *   image with an `alt` is accessible whatever `accessible` says;
 * - `importantForAccessibility="no"` / `"no-hide-descendants"` (an Android
 *   prop) and `accessibilityElementsHidden` (an iOS prop). Each is honoured
 *   on BOTH platforms: the snapshot does not know which platform will render
 *   the component, and either prop is the developer's stated intent that the
 *   image is not part of what assistive technology announces.
 *
 * `aria-hidden` is deliberately NOT a signal here: RN maps it only on `View`,
 * and `Image` never reads it, so an image carrying it is still announced.
 * False when no props were recorded: absence of the signal is not the signal.
 */
export function isHiddenFromAccessibility(props: Record<string, unknown> | undefined): boolean {
  if (!props) return false;
  return (
    (props.accessible === false && props.alt === undefined) ||
    props.importantForAccessibility === 'no' ||
    props.importantForAccessibility === 'no-hide-descendants' ||
    props.accessibilityElementsHidden === true
  );
}

/**
 * The label an RN `Image` announces, in RN's own precedence
 * (`aria-label ?? accessibilityLabel ?? alt`, react-native 0.81.5 `Image`):
 * the first of those props that is set wins, even when it is empty.
 *
 * The registry's own `accessibilityLabel` (from the element's identifier) is
 * the fallback ONLY when the host recorded no props at all — then the props
 * were never read, and the identifier is the best reading there is. A props
 * record carrying none of the three is MEASURED: the image announces no
 * label, and a registry label must not claim one for it (a host that does
 * not spread the bridge's props onto the `Image` would otherwise report an
 * alt the image does not have). Undefined in that case, and when the winning
 * value is not a string — nothing readable was announced.
 */
export function resolveImageLabel(
  props: Record<string, unknown> | undefined,
  registryLabel: string | undefined
): string | undefined {
  if (props === undefined) return registryLabel;
  const own = props['aria-label'] ?? props.accessibilityLabel ?? props.alt;
  return typeof own === 'string' ? own : undefined;
}

/**
 * The vision-core `ElementMedia` record for a native image — what the registry
 * can actually measure about it. Every other `ElementMedia` fact (intrinsic
 * size, load state, format, weight, LCP, slot) is omitted, i.e. unmeasured:
 * RN exposes none of them to the registry.
 */
export function projectMedia(args: {
  layout: NativeLayout | null | undefined;
  props: Record<string, unknown> | undefined;
  flatStyle: Record<string, unknown> | undefined;
  accessibilityLabel: string | undefined;
  inViewport: boolean | undefined;
}): VisionMedia {
  const { layout, props, flatStyle, accessibilityLabel, inViewport } = args;
  const media: VisionMedia = { kind: 'img' };

  if (
    layout &&
    Number.isFinite(layout.width) &&
    Number.isFinite(layout.height) &&
    layout.width >= 0 &&
    layout.height >= 0
  ) {
    media.rendered_px = { w: layout.width, h: layout.height };
  }

  const objectFit = resolveObjectFit(props, flatStyle);
  if (objectFit !== undefined) media.object_fit = objectFit;

  // The text alternative. RN has no `alt=""` convention: an empty label is
  // not a declaration that the image is presentational, so it is read like a
  // missing one. Presentational is only ever an EXPLICIT RN signal — the
  // element is removed from the accessibility tree — and then no text is
  // needed. Otherwise a label that survives ASCII-whitespace stripping is the
  // alternative — read in RN's own label precedence (see resolveImageLabel) —
  // and with none the record is omitted: RN may simply not expose the image,
  // so "missing" cannot be told from "unread".
  if (isHiddenFromAccessibility(props)) {
    media.alt = { decorative: true };
  } else {
    const label = resolveImageLabel(props, accessibilityLabel);
    const text = label?.replace(ASCII_WHITESPACE_EDGES, '');
    if (text) media.alt = { decorative: false, text };
  }

  const src = resolveImageSource(props);
  if (src !== undefined) media.src_digest = sha256Hex(src);

  if (inViewport !== undefined) media.in_viewport = inViewport;
  return media;
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
 *
 * An `image` carries NO `text`: an RN `Image` paints none, and its label is
 * its accessibility label — the alt, which vision-core's `Element` forbids in
 * `text` (it would make the image read as a visible label to the elements and
 * color analyzers). It carries `media` instead.
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
  state: Pick<NativeElementState, 'value' | 'textContent'> & {
    layout?: NativeLayout | null;
  };
  flatStyle: Record<string, unknown> | undefined;
  /**
   * The element's recorded props (`registerElement({ props })` /
   * `captureProps`) — read for an image's `source` / `src` / `srcSet` and
   * `resizeMode`.
   */
  props?: Record<string, unknown>;
  /** The accessibility label the registry recorded (`identifier.accessibilityLabel`). */
  accessibilityLabel?: string;
  /**
   * Whether the measured rect intersects the element's clip region
   * (`computeInViewport` in `registry.ts`); undefined when either is unknown.
   */
  inViewport?: boolean;
}): VisionElementFields {
  const { type, label, handlerNames, state, flatStyle } = args;

  const fields: VisionElementFields = {
    interactable: deriveInteractable(type, handlerNames),
  };

  if (type === 'image') {
    fields.media = projectMedia({
      layout: state.layout,
      props: args.props,
      flatStyle,
      accessibilityLabel: args.accessibilityLabel,
      inViewport: args.inViewport,
    });
  } else {
    const text = deriveText(state, label);
    if (text !== undefined) fields.text = text;
  }

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
