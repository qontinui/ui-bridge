/**
 * Native Element and Component Registry
 *
 * Central registry for all UI elements and components registered with UI Bridge Native.
 * Adapted from ui-bridge for React Native environments.
 */

import type {
  RegisteredNativeElement,
  RegisteredNativeComponent,
  NativeElementState,
  NativeElementType,
  NativeStandardAction,
  NativeCustomAction,
  NativeAppInfo,
  NativeBridgeSnapshot,
  NativeElementBbox,
  NativeElementIdentifier,
  NativeElementRef,
  NativeRegistrationCoverage,
  NativeRouteProviderLike,
  NativeSnapshotEnrichers,
  NativeSnapshotEnricher,
  Workflow,
  BridgeEvent,
  BridgeEventType,
  BridgeEventListener,
  IREffect,
} from './types';
import { projectVisionFields } from './vision-fields';

/**
 * Options for registering an element
 */
export interface RegisterElementOptions {
  type?: NativeElementType;
  label?: string;
  actions?: NativeStandardAction[];
  customActions?: Record<string, NativeCustomAction>;
  props?: Record<string, unknown>;
  treePath?: string;
  testId?: string;
  accessibilityLabel?: string;
  /** Route path where the element was registered (for page-scoped filtering) */
  registrationRoute?: string | null;
  /**
   * Id of the registered scrollable container this element lives inside.
   *
   * When set, {@link computeVisibility} clips the element against that
   * container's measured frame as well as the window, so a row scrolled out of
   * its `ScrollView` / `FlatList` stops reporting `visibility: 'visible'`.
   *
   * DECLARED, not inferred, and that is deliberate. React Native gives the
   * registry no parent chain — `useUIElement` is a hook, so it never wraps its
   * element's children and cannot publish itself as their ancestor. Guessing
   * the ancestor geometrically is worse than not clipping: a full-width scroll
   * container horizontally contains the tab bar and the header too, and
   * clipping those against it would report on-screen chrome as off-screen.
   * A wrong `hidden` is a worse answer than a coarse `visible`.
   *
   * Unset (the default) leaves the window as the only clip region.
   */
  scrollAncestorId?: string;
  /** Flattened RN style (from StyleSheet.flatten) for design review */
  flatStyle?: Record<string, unknown>;
  /** State-specific style overrides for design review */
  stateStyles?: {
    pressed?: Record<string, unknown>;
    focused?: Record<string, unknown>;
    disabled?: Record<string, unknown>;
  };
}

/**
 * Options for registering a component
 */
export interface RegisterComponentOptions {
  name: string;
  description?: string;
  actions?: Array<{
    id: string;
    label?: string;
    description?: string;
    /**
     * Phase 2 (same plan): the action's published parameter schema. It was
     * ABSENT here and dropped by the object literal in `registerComponent`
     * below, so the field `ComponentAction` declares could never reach a
     * registered native component and the native invocation seam had nothing
     * to validate against. That is the silent-drop trap the plan warns about,
     * already realised.
     */
    paramSchema?: Record<string, unknown>;
    /**
     * Phase 4 (same plan): the safety annotation. Absent here, an author's
     * `effect: 'destructive'` would die at this hop exactly the way
     * `paramSchema` did before Phase 2 — the literal in `registerComponent`
     * has a closed field list and nothing type-checks the omission.
     */
    effect?: IREffect;
    /**
     * Phase 3 (plan 2026-08-20-ui-bridge-action-declaration-shape): the second
     * argument is the `ActionHandlerOptions` bag carrying the cancellation
     * signal. A 1-arity handler stays assignable.
     */
    handler: (params?: unknown, options?: { signal?: AbortSignal }) => unknown | Promise<unknown>;
  }>;
  elementIds?: string[];
}

/**
 * Options for {@link NativeUIBridgeRegistry.updateComponentMeta}.
 *
 * Every field is optional and `undefined` means "leave the registered value
 * alone" — the same partial-update semantics {@link RegisterComponentOptions}'s
 * sister {@link NativeUIBridgeRegistry.updateElementMeta} uses. A consequence
 * worth stating: a `description` cannot be CLEARED through this door, only
 * replaced. Pass `actions: []` to publish an empty action list; that is
 * distinguishable from omitting the field.
 */
export interface UpdateComponentMetaOptions {
  name?: string;
  description?: string;
  actions?: RegisterComponentOptions['actions'];
  elementIds?: string[];
}

/**
 * Map declared component actions into the registry's stored shape.
 *
 * ⚠ CLOSED FIELD LIST. Any `ComponentAction` field not named here is dropped at
 * registration time, silently: the literal stays assignable, the serializer
 * still runs, the field is simply never there. `paramSchema` was exactly that
 * until Phase 2, and `effect` is the Phase 4 addition that would have gone the
 * same way.
 *
 * It lives in ONE place on purpose. `registerComponent` and
 * `updateComponentMeta` both publish actions, and a second hand-rolled copy of
 * this list is precisely how the two Phase-2/Phase-4 drops happened — a field
 * added to the declaration type stays assignable at every re-wrap site and
 * simply never arrives.
 */
function toRegisteredComponentActions(
  actions: NonNullable<RegisterComponentOptions['actions']>
): RegisteredNativeComponent['actions'] {
  return actions.map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    paramSchema: a.paramSchema,
    effect: a.effect,
    handler: a.handler,
  }));
}

/**
 * Value signature of everything about an action list that reaches a bridge
 * consumer.
 *
 * `handler` is excluded deliberately: it is a function, so it is not
 * serialisable, it is never published, and call sites pass inline closures that
 * are freshly allocated on every render — including it would make
 * `updateComponentMeta` report a change every single time and defeat its
 * idempotence. Order is significant, because published order is the order an
 * agent reads the actions in.
 */
function publishedActionSignature(actions: RegisteredNativeComponent['actions']): string {
  return JSON.stringify(
    actions.map((a) => [a.id, a.label, a.description, a.paramSchema, a.effect])
  );
}

/** Positional equality for the optional `elementIds` list. */
function sameElementIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Registry configuration
 */
export interface NativeRegistryConfig {
  verbose?: boolean;
  onEvent?: BridgeEventListener;
}

/**
 * Extract handler function names from an element's props.
 * Returns names of props whose values are functions (e.g. ['onPress', 'onChangeText']).
 */
export function extractHandlerNames(props?: Record<string, unknown>): string[] {
  if (!props) return [];
  return Object.keys(props).filter((k) => typeof props[k] === 'function');
}

/**
 * `currentRouteOnly` filter predicate for `registrationRoute`.
 *
 * Returns `true` when an element should be INCLUDED in a current-route-only
 * view. Two classes of elements pass the filter:
 *
 *   1. Elements registered on the current route
 *      (`registrationRoute === currentRoute`).
 *   2. Route-agnostic elements (`registrationRoute == null` or `''`) — these
 *      are typically registered at the app root (tab bars, persistent
 *      headers, modal hosts) and apply to every route. Excluding them by
 *      default makes `currentRouteOnly=true` return empty on mobile where
 *      most apps register chrome at the root and screens via routed stacks.
 *
 * The filter only DROPS elements whose `registrationRoute` is set to a
 * non-matching route — i.e. they belong to a different screen. This matches
 * the runner-side semantics: route-tagged DOM nodes that don't match the
 * active URL are scoped out; untagged nodes are always in scope.
 *
 * Surfaced 2026-05-23 (item 4 of the 0.6.6 robustness pass) — the prior
 * strict equality returned 0 elements on mobile screens that register tabs
 * at the root, because tab elements had `registrationRoute: null`.
 */
export function matchesCurrentRoute(
  registrationRoute: string | null | undefined,
  currentRoute: string
): boolean {
  if (registrationRoute == null || registrationRoute === '') return true;
  return registrationRoute === currentRoute;
}

/**
 * Derive the snapshot's `activeTab` from an Expo Router segment list.
 *
 * Expo Router spells a layout group as a parenthesised segment and a dynamic
 * route as a bracketed one, so `usePathname()`/`useSegments()` on the "runs"
 * tab of a `(tabs)` layout yield `"/(tabs)/runs"` and `["(tabs)", "runs"]`
 * (the shape the `RouteProvider` doc comment already documents). The tab a user
 * is looking at is therefore the segment immediately following the INNERMOST
 * group.
 *
 * Rules, all deliberately conservative — an unknown tab is reported as absent
 * rather than guessed:
 *
 *   - `["(tabs)", "runs"]`        → `"runs"`
 *   - `["(tabs)", "runs", "[id]"]`→ `"runs"`  (a detail screen is still *on* a tab)
 *   - `["(tabs)"]`                → `"index"` (the group's own index route)
 *   - `["(tabs)", "[id]"]`        → `undefined` (dynamic route, not a tab)
 *   - `["settings"]`              → `undefined` (no group layout ⇒ no tabs)
 *   - `[]` / `undefined`          → `undefined`
 *
 * Exported so the rules are unit-testable without standing up a registry.
 */
export function deriveActiveTabFromSegments(segments?: string[]): string | undefined {
  if (!segments || segments.length === 0) return undefined;

  let innermostGroup = -1;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (typeof segment === 'string' && segment.startsWith('(') && segment.endsWith(')')) {
      innermostGroup = i;
    }
  }
  // No layout group at all — the app has no tab shell, so claiming an active
  // tab would be an invention.
  if (innermostGroup === -1) return undefined;

  const next = segments[innermostGroup + 1];
  // The group IS the leaf: the router is showing that group's index route.
  if (next === undefined) return 'index';
  if (typeof next !== 'string' || next.length === 0) return undefined;
  // A dynamic segment is a detail screen reached from a tab, not a tab itself.
  if (next.startsWith('[') && next.endsWith(']')) return undefined;
  return next;
}

/**
 * Project an element's runtime state into a runner-native pixel-space `bbox`.
 *
 * Returns `{x, y, w, h}` in PHYSICAL pixels (RN `state.layout` is logical dp;
 * we multiply by `pixelRatio` — `PixelRatio.get()`, injected via
 * `registry.setPixelRatio` — so the box aligns with the runner's adb screencap
 * frame). See {@link NativeElementBbox} for why the shape is `{x,y,w,h}` and
 * not the web SDK's `{x,y,width,height}`.
 *
 * `pixelRatio` is INJECTED rather than read from `react-native` here: this is a
 * non-React core module, and a static `import { PixelRatio } from 'react-native'`
 * breaks both the vitest suite ("Flow is not supported") and risks the
 * Metro/Hermes `unknownModuleError` that bit `design-handlers`/`page-health`.
 * The provider wires the real ratio via `setPixelRatio`; callers/tests that
 * never wire it get the `1` default (dp ≈ px, still a usable box).
 *
 * Gating (avoid poisoning the snapshot — the flat registry mixes routes and
 * some elements carry stale off-screen coords):
 *   - returns `undefined` unless `visibility === 'visible'` (visible + measured)
 *   - returns `undefined` when `state.layout` is null/absent
 * Clamps every component to a non-negative integer.
 *
 * Uses `measureInWindow`'s absolute `pageX`/`pageY` for the origin. Falls back
 * to the layout-relative `x`/`y` only when `pageX`/`pageY` weren't measured
 * (rare; keeps a best-effort box rather than dropping the element).
 */
export function projectBbox(
  state: NativeElementState,
  visibility: 'visible' | 'likely-visible' | 'hidden',
  pixelRatio = 1
): NativeElementBbox | undefined {
  if (visibility !== 'visible') return undefined;
  const layout = state.layout;
  if (!layout) return undefined;

  const ratio = pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1;
  const toPx = (v: number): number => Math.max(0, Math.round(v * ratio));

  const hasPage =
    typeof layout.pageX === 'number' &&
    typeof layout.pageY === 'number' &&
    Number.isFinite(layout.pageX) &&
    Number.isFinite(layout.pageY);
  const originX = hasPage ? layout.pageX : layout.x;
  const originY = hasPage ? layout.pageY : layout.y;

  if (
    typeof originX !== 'number' ||
    typeof originY !== 'number' ||
    typeof layout.width !== 'number' ||
    typeof layout.height !== 'number' ||
    !Number.isFinite(originX) ||
    !Number.isFinite(originY) ||
    !Number.isFinite(layout.width) ||
    !Number.isFinite(layout.height)
  ) {
    return undefined;
  }

  return {
    x: toPx(originX),
    y: toPx(originY),
    w: toPx(layout.width),
    h: toPx(layout.height),
  };
}

// ── Visibility ──────────────────────────────────────────────────────────────

/**
 * A rectangle in window (page) coordinates, logical dp — the same space
 * `measureInWindow` reports `pageX`/`pageY` in.
 */
export interface NativePageRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Why an element is not plainly visible.
 *
 * DUPLICATE of `@qontinui/ui-bridge` `VisibilityReason`
 * (`src/core/types.ts` — `'hidden' | 'off-screen' | 'occluded' | 'no-layout'`),
 * for the same reason the action types above are duplicated: `@qontinui/ui-bridge`
 * is an OPTIONAL peer of this package, so this module must not import from it.
 * KEEP IN SYNC — one vocabulary across both SDKs is the point; do not coin
 * native-only spellings.
 *
 * `'occluded'` is declared but never produced here: React Native gives the
 * registry no hit-test equivalent of `document.elementFromPoint`, so this SDK
 * cannot honestly claim occlusion. It stays in the union so a native reason
 * string is always a valid web reason string.
 */
export type NativeVisibilityReason = 'hidden' | 'off-screen' | 'occluded' | 'no-layout';

/** The three-value verdict carried on every snapshot element. */
export type NativeVisibility = 'visible' | 'likely-visible' | 'hidden';

/**
 * Convert an element's measured layout into a page-space rect, or `null` when
 * it has no TRUSTWORTHY page-space origin.
 *
 * STRICTER THAN {@link projectBbox} ON PURPOSE. `projectBbox` falls back to the
 * parent-relative `x`/`y` when `pageX`/`pageY` weren't measured, because a
 * slightly-wrong box is still a usable box. Clipping cannot take that trade: a
 * parent-relative origin compared against window coordinates silently mixes two
 * coordinate spaces and yields a wrong `hidden` verdict — the outcome
 * `RegisterElementOptions.scrollAncestorId` calls worse than a coarse
 * `visible`. So a layout flagged `pageOriginUnmeasured` returns `null` here,
 * and {@link computeVisibility} declines to clip rather than guess.
 */
export function pageRectOf(state: NativeElementState): NativePageRect | null {
  const layout = state.layout;
  if (!layout) return null;
  // The writer told us `pageX`/`pageY` are a parent-relative stand-in, not a
  // `measureInWindow` result. Not a page-space rect, and not guessable into one.
  if (layout.pageOriginUnmeasured === true) return null;

  const hasPage =
    typeof layout.pageX === 'number' &&
    typeof layout.pageY === 'number' &&
    Number.isFinite(layout.pageX) &&
    Number.isFinite(layout.pageY);
  if (!hasPage) return null;

  const left = layout.pageX;
  const top = layout.pageY;

  if (
    typeof layout.width !== 'number' ||
    typeof layout.height !== 'number' ||
    !Number.isFinite(layout.width) ||
    !Number.isFinite(layout.height)
  ) {
    return null;
  }

  return { left, top, right: left + layout.width, bottom: top + layout.height };
}

/** Do two 1-D spans share any extent? A zero-length span counts as touching. */
function spansOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  if (aMin === aMax) return aMin >= bMin && aMin <= bMax;
  return aMin < bMax && aMax > bMin;
}

/**
 * Is this rect empty — nothing can overlap it?
 *
 * {@link intersectRects} returns an INVERTED rect (`right < left`) when the two
 * inputs are disjoint, which is the honest answer for "the reachable region",
 * but `spansOverlap`'s `aMin < bMax && aMax > bMin` reads an inverted span as
 * overlapping. Every consumer of an intersection must ask this first.
 */
export function isEmptyRect(rect: NativePageRect): boolean {
  return rect.right <= rect.left || rect.bottom <= rect.top;
}

/**
 * Intersect two page rects, or `null` when either is absent (`null` means
 * UNKNOWN, so it never narrows the other side).
 *
 * The result may be EMPTY — check {@link isEmptyRect}. That happens whenever
 * the two rects are disjoint, e.g. a scroll container that has itself been
 * scrolled out of the window: nothing inside it can be on screen, and an empty
 * clip is exactly how that is expressed.
 */
export function intersectRects(
  a: NativePageRect | null,
  b: NativePageRect | null
): NativePageRect | null {
  if (!a) return b;
  if (!b) return a;
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

/**
 * Decide what a snapshot should say about an element being on screen.
 *
 * THE DEFECT THIS CLOSES: visibility used to be derived from mount + `measure()`
 * alone — `state.visible ? (state.layout ? 'visible' : 'likely-visible') : 'hidden'`
 * — with no comparison against any bounds at all. Every mounted, measured
 * element reported `visible`, including rows scrolled far past the fold, so a
 * snapshot claimed things were on screen that were not.
 *
 * SCOPE — read this before citing it. This is a PURE PROJECTION: it reads
 * `state.visible` and never writes it. An off-screen element still carries
 * `state.visible === true`; only the snapshot's `visibility` /
 * `visibilityReason` change. That is a deliberate divergence from the web SDK,
 * which folds off-screen INTO the boolean (`@qontinui/ui-bridge`
 * `src/core/registry.ts` — `if (!inViewport) return { visible: false, reason:
 * 'off-screen' }`), and it means any consumer asserting on `state.visible`
 * alone — `/manual-test`'s "PRESENT IS NOT VISIBLE" gate among them — sees no
 * change on mobile and stays as vacuous as it was. Closing that needs either a
 * matching demotion of `state.visible` here or a consumer that reads
 * `visibility`; both are contract decisions beyond this projection, and
 * neither is done. The strings are shared with the web SDK; the SHAPE is not.
 *
 * `clip` is the region the element must reach to count as on screen — the
 * window, intersected with the measured frame of a declared
 * `scrollAncestorId`. **A `null`/absent clip means the bounds are UNKNOWN, and
 * an unknown never demotes**: with no viewport injected (every non-RN caller,
 * including this package's own suite) the answer is exactly what it was before.
 * Absence of evidence is not evidence of off-screen.
 *
 * Any overlap at all counts as visible. A half-scrolled row IS on screen, and
 * a ratio threshold would be a second, unshared policy knob for callers to
 * disagree about.
 */
export function computeVisibility(
  state: NativeElementState,
  clip?: NativePageRect | null
): { visibility: NativeVisibility; visibilityReason?: NativeVisibilityReason } {
  if (!state.visible) {
    return { visibility: 'hidden', visibilityReason: 'hidden' };
  }
  if (state.layout === null) {
    // Registered and mounted but not yet measured. `'likely-visible'` already
    // is this SDK's honest-UNKNOWN value; `'no-layout'` names why.
    return { visibility: 'likely-visible', visibilityReason: 'no-layout' };
  }
  if (!clip) {
    return { visibility: 'visible' };
  }
  const rect = pageRectOf(state);
  if (!rect) {
    // Measured, but with no trustworthy page-space origin (see `pageRectOf`).
    // Report it exactly as before — an unknown must not manufacture a verdict.
    return { visibility: 'visible' };
  }
  // A disjoint intersection (a scroll container itself scrolled off the window)
  // inverts rather than zeroing, and `spansOverlap` would read an inverted span
  // as overlapping. Nothing can be inside an empty clip.
  if (isEmptyRect(clip)) {
    return { visibility: 'hidden', visibilityReason: 'off-screen' };
  }
  const onScreen =
    spansOverlap(rect.left, rect.right, clip.left, clip.right) &&
    spansOverlap(rect.top, rect.bottom, clip.top, clip.bottom);

  return onScreen
    ? { visibility: 'visible' }
    : { visibility: 'hidden', visibilityReason: 'off-screen' };
}

/**
 * Infer available actions based on element type
 */
function inferActions(type: NativeElementType): NativeStandardAction[] {
  const baseActions: NativeStandardAction[] = ['focus', 'blur'];

  switch (type) {
    case 'button':
    case 'touchable':
    case 'pressable':
      return [...baseActions, 'click', 'press', 'longPress', 'doubleTap'];
    case 'input':
      return [...baseActions, 'click', 'press', 'type', 'setValue', 'clear'];
    case 'text':
      return [...baseActions, 'click', 'press', 'longPress'];
    case 'view':
      return [...baseActions, 'click', 'press'];
    case 'scroll':
      return [...baseActions, 'scroll', 'swipe'];
    case 'list':
      return [...baseActions, 'scroll', 'swipe'];
    case 'listItem':
      return [...baseActions, 'click', 'press', 'longPress', 'swipe'];
    case 'switch':
    case 'checkbox':
      return [...baseActions, 'click', 'press', 'toggle'];
    case 'radio':
      return [...baseActions, 'click', 'press'];
    case 'image':
      return [...baseActions, 'click', 'press', 'longPress'];
    case 'modal':
      return ['focus', 'blur'];
    case 'custom':
    default:
      return [...baseActions, 'click', 'press'];
  }
}

/**
 * Native UI Bridge Registry
 *
 * Manages registration and lookup of native UI elements and components.
 */
export class NativeUIBridgeRegistry {
  private elements = new Map<string, RegisteredNativeElement>();
  private components = new Map<string, RegisteredNativeComponent>();
  private workflows = new Map<string, Workflow>();
  private eventListeners = new Map<BridgeEventType, Set<BridgeEventListener>>();
  private config: NativeRegistryConfig;
  private enrichers: NativeSnapshotEnrichers = {};
  private snapshotExtras = new Map<string, NativeSnapshotEnricher>();
  /**
   * App identification metadata (appId/appName/appType/framework). Set via
   * `setAppInfo` — typically wired in the server constructor from the
   * `NativeUIBridgeConfig` the host passes to `UIBridgeNativeProvider`.
   *
   * When set, `createSnapshot` includes it on the resulting snapshot so
   * agents can identify the app from snapshot bytes alone (parity with the
   * `uiBridge` block on the `health` response). Snapshots created before
   * this is wired simply omit the field.
   */
  private appInfo: NativeAppInfo | null = null;
  /**
   * Optional route provider. When set, `createSnapshot` reads
   * `currentRoute`/`segments` from it whenever the caller does not pass an
   * explicit `routeInfo` argument. This lets the default `getSnapshot` HTTP
   * handler — which has no direct reference to the `NativeUIBridgeServer`
   * instance — still emit a populated `currentRoute` field.
   *
   * Wired by `NativeUIBridgeServer.setRouteProvider`, which forwards the
   * provider into the registry alongside the per-handler overrides it
   * already installs.
   */
  private routeProvider: NativeRouteProviderLike | null = null;
  /**
   * Device pixel ratio used to project `state.layout` (logical dp) into the
   * physical-pixel `bbox` emitted on each snapshot element. Defaults to `1`
   * (dp ≈ px) so callers/tests that never inject a ratio still get a usable
   * box; the React provider wires the real `PixelRatio.get()` via
   * {@link setPixelRatio}. Read from a non-React core module on purpose — see
   * the `projectBbox` doc comment for why we don't import `react-native` here.
   */
  private pixelRatio = 1;
  /**
   * Injected getter for the device window size in logical dp, used to clip
   * reported visibility. Injected rather than read here for exactly the reason
   * `pixelRatio` is: a static `import { Dimensions } from 'react-native'` in
   * this non-React core module breaks the vitest suite and risks the
   * Metro/Hermes `unknownModuleError`. It is a PROVIDER, not a value, so a
   * rotation is picked up on the next snapshot with nothing to keep in sync.
   *
   * `null` means the window bounds are UNKNOWN, and {@link computeVisibility}
   * treats unknown bounds as "cannot demote" — never as an empty viewport.
   */
  private viewportProvider: (() => { width: number; height: number }) | null = null;
  /**
   * Sticky flag: flips `true` the first time any element is registered and
   * stays `true` even after elements are unregistered. Lets agents distinguish
   * "this route never wired any elements" from "this route registered then
   * unmounted".
   */
  private everHadRegistrations = false;

  constructor(config: NativeRegistryConfig = {}) {
    this.config = config;
  }

  // ============================================================================
  // App Info & Route Provider
  // ============================================================================

  /**
   * Set the app identification metadata returned alongside snapshots.
   * Idempotent — re-calling with the same shape is a no-op.
   * Pass `null` (or omit a previous call) to clear.
   */
  setAppInfo(info: NativeAppInfo | null | undefined): void {
    this.appInfo = info ?? null;
  }

  /** Read-only accessor for the registered app info, if any. */
  getAppInfo(): NativeAppInfo | null {
    return this.appInfo;
  }

  /**
   * Set a route provider whose `getCurrentRoute`/`getSegments` are read by
   * `createSnapshot` when no explicit `routeInfo` argument is supplied.
   *
   * Call with `null` to detach (e.g. when the host swaps providers on HMR).
   */
  setRouteProvider(provider: NativeRouteProviderLike | null | undefined): void {
    this.routeProvider = provider ?? null;
  }

  /** Read-only accessor for the registered route provider, if any. */
  getRouteProvider(): NativeRouteProviderLike | null {
    return this.routeProvider;
  }

  /**
   * Resolve the snapshot's `activeTab`: an explicit `getActiveTab()` on the
   * route provider wins, otherwise derive it from the Expo Router segments the
   * provider already exposes.
   *
   * A throwing or empty-string provider degrades to the derivation rather than
   * to `undefined` — the host's opt-in extra should never be able to make the
   * snapshot WORSE than it was without it. A blank derivation stays blank.
   */
  private resolveActiveTab(segments: string[] | undefined): string | undefined {
    const explicit = (() => {
      if (!this.routeProvider?.getActiveTab) return undefined;
      try {
        const value = this.routeProvider.getActiveTab();
        return typeof value === 'string' && value.length > 0 ? value : undefined;
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`[ui-bridge-native] routeProvider getActiveTab threw:`, error);
        }
        return undefined;
      }
    })();
    return explicit ?? deriveActiveTabFromSegments(segments);
  }

  /**
   * Set the device pixel ratio used to project per-element `bbox` geometry
   * into physical pixels. The React provider passes `PixelRatio.get()` here
   * once at startup. Ignores non-finite / non-positive values (keeps the
   * previous ratio) so a bad call can't zero out every bbox.
   */
  setPixelRatio(ratio: number): void {
    if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0) {
      this.pixelRatio = ratio;
    }
  }

  /** Read-only accessor for the device pixel ratio used for bbox projection. */
  getPixelRatio(): number {
    return this.pixelRatio;
  }

  /**
   * Set the getter for the device window size (logical dp) that reported
   * visibility is clipped against. The React provider passes
   * `() => Dimensions.get('window')` here at construction.
   *
   * Pass `null` to detach. While detached the window bounds are UNKNOWN and no
   * element is ever demoted for being outside them.
   */
  setViewportProvider(
    provider: (() => { width: number; height: number }) | null | undefined
  ): void {
    this.viewportProvider = provider ?? null;
  }

  /**
   * The window as a page-space rect, or `null` when it is unknown or the
   * provider returned something unusable (it throws in some RN teardown
   * paths, and a zero-size window would silently hide the entire screen).
   */
  getViewportRect(): NativePageRect | null {
    if (!this.viewportProvider) return null;
    let size: { width: number; height: number };
    try {
      size = this.viewportProvider();
    } catch (error) {
      if (this.config.verbose) {
        console.warn(`[ui-bridge-native] viewportProvider threw:`, error);
      }
      return null;
    }
    const { width, height } = size ?? {};
    if (
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }
    return { left: 0, top: 0, right: width, bottom: height };
  }

  /**
   * The region `element` must reach to count as on screen: the window,
   * intersected with the measured frame of its declared `scrollAncestorId`.
   *
   * Returns `null` when neither bound is known — see {@link computeVisibility}
   * for why that means "do not demote" rather than "nothing is visible".
   * An ancestor that is not registered, or registered but not yet measured,
   * contributes nothing rather than hiding its subtree.
   */
  getClipRectFor(
    element: RegisteredNativeElement,
    viewport?: NativePageRect | null
  ): NativePageRect | null {
    // `undefined` = not supplied, read it now. `null` = the caller already
    // read it and it was UNKNOWN — don't re-read and disagree with them.
    const bounds = viewport === undefined ? this.getViewportRect() : viewport;
    const ancestorId = element.scrollAncestorId;
    if (!ancestorId) return bounds;

    // Single level by design: only the DECLARED ancestor is applied, and its
    // own `scrollAncestorId` is not followed. The window clip already covers
    // most of what a second level would add, and a recursive walk needs a
    // visited set to survive a declaration cycle. Revisit together.
    const ancestor = this.elements.get(ancestorId);
    if (!ancestor || ancestorId === element.id) return bounds;

    return intersectRects(bounds, pageRectOf(ancestor.getState()));
  }

  // ============================================================================
  // Snapshot Enricher Slots
  // ============================================================================

  /**
   * Register/replace canonical enrichers (modal/toast/undo). HMR-safe — calling
   * with a partial set merges into existing slots instead of clobbering them.
   */
  setEnrichers(e: Partial<NativeSnapshotEnrichers>): void {
    this.enrichers = { ...this.enrichers, ...e };
  }

  /**
   * Read-only accessor for the canonical enrichers slot. Returned object is
   * the live reference, so callers can detect "no detector wired" via
   * `getEnrichers().modalDetector === undefined`. Used by the test-hook HTTP
   * handlers (`control/modal/push`, `control/modal/dismiss/:id`) which need
   * to drive the ModalDetector directly without re-instantiating it.
   */
  getEnrichers(): Readonly<NativeSnapshotEnrichers> {
    return this.enrichers;
  }

  /**
   * Register a custom snapshot enricher. The returned object will be
   * `Object.assign`ed onto the snapshot, so use unique top-level keys to avoid
   * clobbering canonical fields. Returns a disposer.
   */
  registerSnapshotEnricher(name: string, fn: NativeSnapshotEnricher): () => void {
    this.snapshotExtras.set(name, fn);
    return () => this.unregisterSnapshotEnricher(name);
  }

  /** Remove a custom snapshot enricher by name */
  unregisterSnapshotEnricher(name: string): void {
    this.snapshotExtras.delete(name);
  }

  // ============================================================================
  // Element Management
  // ============================================================================

  /**
   * Register a native element
   */
  registerElement(
    id: string,
    ref: React.RefObject<NativeElementRef>,
    options: RegisterElementOptions = {}
  ): RegisteredNativeElement {
    const {
      type = 'custom',
      label,
      actions = inferActions(type),
      customActions,
      props,
      treePath = id,
      testId,
      accessibilityLabel,
      registrationRoute,
      scrollAncestorId,
      flatStyle,
      stateStyles,
    } = options;

    // Create state getter
    const getState = (): NativeElementState => {
      const element = ref.current;
      if (!element) {
        return {
          mounted: false,
          visible: false,
          enabled: false,
          focused: false,
          layout: null,
        };
      }

      // State is populated by the element during onLayout
      // Here we return the stored state from the element's metadata
      const stored = this.elements.get(id);
      if (stored && stored.getState !== getState) {
        return stored.getState();
      }

      return {
        mounted: true,
        visible: true,
        enabled: true,
        focused: false,
        layout: null,
      };
    };

    // Create identifier getter
    const getIdentifier = (): NativeElementIdentifier => ({
      uiId: id,
      testId: testId || id,
      accessibilityLabel,
      treePath,
    });

    const registered: RegisteredNativeElement = {
      id,
      ref,
      type,
      label,
      actions,
      customActions,
      props,
      getState,
      getIdentifier,
      registeredAt: Date.now(),
      mounted: true,
      registrationRoute: registrationRoute ?? null,
      scrollAncestorId,
      flatStyle,
      stateStyles,
    };

    this.elements.set(id, registered);
    this.everHadRegistrations = true;

    this.emit('element:registered', { id, type, label });

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered element: ${id} (${type})`);
    }

    // Seed a sensible initial state so elements are immediately visible in snapshots
    // even before onLayout fires. Layout-measuring code can overwrite this later.
    //
    // For controlled-input elements (`type:'input'` with a string `props.value`),
    // also seed `state.value` from the prop so bridge consumers can read the
    // default value before the user has typed. See `updateElementProps` for
    // the corresponding re-sync path on prop changes.
    const seededState: Partial<NativeElementState> = {
      mounted: true,
      visible: true,
      enabled: true,
      focused: false,
      layout: null,
    };
    if (type === 'input' && typeof props?.value === 'string') {
      seededState.value = props.value;
    }
    // For `type:'text'` elements, surface the (dynamic) label as `state.value`
    // so bridge consumers can read text content with a uniform `state.value`
    // accessor instead of parsing the `label` field ("Status: ..."). The hook
    // already re-publishes the label via `updateElementMeta` when consumers
    // call `updateLabel(newLabel)` — that path also re-syncs `state.value`
    // (see `updateElementMeta`).
    if (type === 'text' && typeof label === 'string') {
      seededState.value = label;
    }
    this.updateElementState(id, seededState);

    return registered;
  }

  /**
   * Unregister an element
   */
  unregisterElement(id: string): void {
    const element = this.elements.get(id);
    if (element) {
      this.elements.delete(id);
      this.emit('element:unregistered', { id });

      if (this.config.verbose) {
        console.log(`[ui-bridge-native] Unregistered element: ${id}`);
      }
    }
  }

  /**
   * Get a registered element
   */
  getElement(id: string): RegisteredNativeElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Get all registered elements
   */
  getAllElements(): RegisteredNativeElement[] {
    return Array.from(this.elements.values());
  }

  /**
   * Get all registered elements that are visible AND have a measured layout.
   *
   * This is the *strict* visibility filter: requires `state.visible === true`
   * AND `state.layout !== null`. Use this when you need both signals
   * (e.g. coord-based tap, where you need an actual rect to hit-test against).
   *
   * Callers driving an LLM agent typically want
   * {@link getMountedVisibleElements} instead — that variant accepts
   * elements that *should* be on screen (visible:true) but whose first
   * `onLayout` has not yet fired. Without it, a snapshot taken in the gap
   * between mount and the first layout pass returns 0 elements on a fully
   * populated screen.
   */
  getVisibleElements(): RegisteredNativeElement[] {
    return this.getAllElements().filter((e) => {
      const state = e.getState();
      return state.visible && state.layout !== null;
    });
  }

  /**
   * Get all registered elements marked as visible (regardless of layout).
   *
   * Looser than {@link getVisibleElements}: includes elements whose
   * `onLayout` callback has not yet fired (so `layout === null`). React
   * Native's `onLayout` is async — there's a one-tick window after mount
   * where elements are in the tree, the user *sees* them, but the
   * registry hasn't received their measurements yet. Excluding those
   * elements makes `getSnapshot?visibleOnly=true` return 0 on a populated
   * screen, which is a worse failure mode than including a few elements
   * we can't yet locate spatially.
   *
   * Used by `createSnapshot`'s `visibleOnly` filter and by the
   * `getSnapshot` / `getElements` handlers. Each emitted element carries a
   * `visibility` discriminator (`"visible"` / `"likely-visible"`) so
   * agents that *do* require a known rect can branch downstream.
   */
  getMountedVisibleElements(): RegisteredNativeElement[] {
    return this.getAllElements().filter((e) => e.getState().visible);
  }

  /**
   * Get elements registered on a specific route (for page-scoped filtering)
   */
  getElementsForRoute(route: string): RegisteredNativeElement[] {
    return this.getAllElements().filter((e) => e.registrationRoute === route);
  }

  /**
   * Mark elements registered on a route as off-screen (visible: false, layout: null).
   *
   * Use this when a screen loses focus but stays mounted — common in React Navigation
   * tab navigators where inactive tabs remain in the tree. Without this call, stale
   * `layout` data lingers in snapshots and makes off-screen elements look rendered.
   *
   * Does NOT unregister the elements — they stay registered so the user's next visit
   * re-measures them via `onLayout` without re-mount cost. Elements without a
   * `registrationRoute` (app-wide registrations) are untouched.
   */
  markRouteOffscreen(route: string): void {
    // Guard against accidental global wipes. Elements registered without a
    // route have `registrationRoute: null` — passing null/empty here would
    // match every globally-registered element and erase their layouts.
    if (route == null || route === '') {
      if (this.config.verbose) {
        console.warn(
          `[ui-bridge-native] markRouteOffscreen called with null/empty route — ignoring`
        );
      }
      return;
    }
    let cleared = 0;
    for (const element of this.elements.values()) {
      if (element.registrationRoute === route) {
        this.updateElementState(element.id, {
          visible: false,
          layout: null,
        });
        cleared++;
      }
    }
    if (this.config.verbose && cleared > 0) {
      console.log(`[ui-bridge-native] Marked ${cleared} elements offscreen for route: ${route}`);
    }
  }

  /**
   * Re-measure every mounted-visible element's geometry via its stored React
   * ref and write the fresh coordinates into the registry ("measure-on-
   * snapshot").
   *
   * Why: element geometry is otherwise captured ONCE at mount time
   * (`onLayout` + `measureInWindow` in `useUIElement`) and RN never re-fires
   * `onLayout` on pure translation — scrolling a virtualized list
   * (FlashList), recycling a cell, a keyboard shift or an orientation change
   * all move elements WITHOUT updating the stored `state.layout`. Snapshot
   * consumers (vision analyzers hit-testing `bbox`, coord-based tap) then
   * operate on stale positions. Re-measuring at READ time is correct
   * regardless of what moved the element and needs zero per-consumer wiring:
   * every registry entry already stores its ref (see `registerElement`).
   *
   * Per-element outcomes:
   *   - non-zero dims → write a fresh full layout (same state shape as the
   *     mount-time measure loop in `useUIElement`); counted as `measured`.
   *   - zero dims AND the element previously had a non-null `state.layout` →
   *     the view collapsed / left the screen; clear to
   *     `{ visible: false, layout: null }` (same shape `markRouteOffscreen`
   *     writes); counted as `cleared`.
   *   - zero dims and it never had a layout → leave state untouched (element
   *     in the mount→first-onLayout gap; don't demote `likely-visible`);
   *     counted as `skipped`.
   *   - no ref / no callable `measureInWindow` (test fixtures, web) → leave
   *     untouched; counted as `skipped`.
   *
   * The whole sweep races an overall timeout (default 250 ms) so a dead ref
   * whose `measureInWindow` never calls back can never hang a snapshot: the
   * returned promise resolves at the deadline with whatever counts have
   * accumulated. Late callbacks may still write state afterwards — harmless,
   * freshest data wins. Never throws.
   *
   * Non-React core module on purpose — `measureInWindow` is duck-typed off
   * the stored ref rather than imported from `react-native` (see the
   * `projectBbox` doc comment for why this file must not import RN).
   */
  async refreshMeasurements(options?: {
    timeoutMs?: number;
  }): Promise<{ measured: number; cleared: number; skipped: number }> {
    const timeoutMs =
      typeof options?.timeoutMs === 'number' &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
        ? options.timeoutMs
        : 250;

    const counts = { measured: 0, cleared: 0, skipped: 0 };
    const pending: Array<Promise<void>> = [];

    for (const element of this.getMountedVisibleElements()) {
      const node = element.ref?.current as
        | (NativeElementRef & {
            measureInWindow?: (
              callback: (pageX: number, pageY: number, w: number, h: number) => void
            ) => void;
          })
        | null
        | undefined;

      if (!node || typeof node.measureInWindow !== 'function') {
        counts.skipped++;
        continue;
      }

      const id = element.id;
      pending.push(
        new Promise<void>((resolve) => {
          let settled = false;
          try {
            node.measureInWindow!((pageX: number, pageY: number, w: number, h: number) => {
              if (settled) return;
              settled = true;
              try {
                if (w > 0 && h > 0) {
                  this.updateElementState(id, {
                    mounted: true,
                    visible: true,
                    enabled: true,
                    focused: false,
                    layout: { x: pageX, y: pageY, width: w, height: h, pageX, pageY },
                  });
                  counts.measured++;
                } else if (this.elements.get(id)?.getState().layout != null) {
                  // Collapsed / off-screen: it HAD a measured rect and now
                  // reports zeros. Clear it so stale coords can't poison the
                  // snapshot (same shape as markRouteOffscreen).
                  this.updateElementState(id, { visible: false, layout: null });
                  counts.cleared++;
                } else {
                  counts.skipped++;
                }
              } finally {
                resolve();
              }
            });
          } catch {
            // A throwing measureInWindow must never break the sweep.
            if (!settled) {
              settled = true;
              counts.skipped++;
              resolve();
            }
          }
        })
      );
    }

    if (pending.length > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        void Promise.all(pending).then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    return counts;
  }

  /**
   * Update element state
   */
  updateElementState(id: string, state: Partial<NativeElementState>): void {
    const element = this.elements.get(id);
    if (element) {
      // Create a new getState that includes the updated state
      const currentState = element.getState();
      const newState = { ...currentState, ...state };

      const updated: RegisteredNativeElement = {
        ...element,
        getState: () => newState,
      };

      this.elements.set(id, updated);
      this.emit('element:stateChanged', { id, state: newState });
    }
  }

  /**
   * Update an element's descriptive metadata (label / accessibilityLabel /
   * testId). Sister to {@link updateElementState} (which carries layout +
   * visibility) and {@link updateElementProps} (which carries event handlers).
   *
   * Idempotent — if every passed field equals the existing value, the call
   * returns without mutating the entry or emitting an event. This keeps
   * `useUIElement().updateLabel(...)` cheap when consumers re-publish from a
   * render path that produces the same string on every tick.
   *
   * Returns `true` when the entry was mutated, `false` otherwise. Callers
   * that want to gate a `console.warn` on no-op invocations can use the
   * return value instead of recomputing equality.
   */
  updateElementMeta(
    id: string,
    meta: { label?: string; accessibilityLabel?: string; testId?: string }
  ): boolean {
    const element = this.elements.get(id);
    if (!element) return false;

    // The `testId` on a registered element lives inside the identifier
    // closure (see registerElement's `getIdentifier`). To rebuild it we
    // need the current value — read it via the existing identifier and
    // overlay the new one if provided.
    const currentIdentifier = element.getIdentifier();
    const nextLabel = meta.label !== undefined ? meta.label : element.label;
    const nextAccessibilityLabel =
      meta.accessibilityLabel !== undefined
        ? meta.accessibilityLabel
        : currentIdentifier.accessibilityLabel;
    const nextTestId = meta.testId !== undefined ? meta.testId : currentIdentifier.testId;

    const labelChanged = nextLabel !== element.label;
    const accessibilityLabelChanged =
      nextAccessibilityLabel !== currentIdentifier.accessibilityLabel;
    const testIdChanged = nextTestId !== currentIdentifier.testId;

    if (!labelChanged && !accessibilityLabelChanged && !testIdChanged) {
      return false;
    }

    const updated: RegisteredNativeElement = {
      ...element,
      label: nextLabel,
      getIdentifier: (): NativeElementIdentifier => ({
        uiId: id,
        testId: nextTestId,
        accessibilityLabel: nextAccessibilityLabel,
        treePath: currentIdentifier.treePath,
      }),
    };
    this.elements.set(id, updated);

    // For text-type elements, mirror the new label into `state.value` so
    // bridge consumers can read text content with a uniform `state.value`
    // accessor. Initial seed lives in `registerElement`; this keeps the
    // mirror in sync when consumers call `updateLabel(newLabel)` from a
    // state-driven render path (e.g. `Status: ${connected ? 'online' : 'offline'}`).
    if (element.type === 'text' && labelChanged && typeof nextLabel === 'string') {
      this.updateElementState(id, { value: nextLabel });
    }

    // Reuse `element:registered` rather than minting a new event — downstream
    // consumers already subscribe to it for label/identifier diffs, and
    // adding a new BridgeEventType ('element:metaChanged') would force a
    // SemVer-major bump on every snapshot consumer.
    this.emit('element:registered', {
      id,
      type: element.type,
      label: nextLabel,
    });

    return true;
  }

  /**
   * Update element props (for action execution).
   *
   * Side effect for `type: 'input'` elements: when `props.value` is a string,
   * mirror it into `state.value` so AI drivers reading the registry don't see
   * `state.value === undefined` until the user types. Before this mirror,
   * controlled-input consumers (`<TextInput value={x} onChangeText={setX} />`
   * with `captureProps({ value: x, onChangeText: setX })`) registered an
   * input whose `state.value` only became defined after the FIRST
   * `onChangeText` call — bridge consumers couldn't read the default value
   * (e.g. a pre-populated API-URL input) until someone typed into it.
   *
   * Re-runs on every `updateElementProps` so a parent passing a fresh
   * `value` prop (controlled re-render) keeps the registry in sync. The
   * mirror is gated on `type === 'input'` to avoid touching non-input
   * elements that may carry an unrelated `value` prop (e.g. a Switch's
   * boolean value, which lives on `state.checked`).
   */
  updateElementProps(id: string, props: Record<string, unknown>): void {
    const element = this.elements.get(id);
    if (element) {
      const updated: RegisteredNativeElement = {
        ...element,
        props: { ...element.props, ...props },
      };
      this.elements.set(id, updated);

      // Controlled-input value mirror — see doc comment above.
      if (
        element.type === 'input' &&
        Object.prototype.hasOwnProperty.call(props, 'value') &&
        typeof props.value === 'string'
      ) {
        const currentState = updated.getState();
        if (currentState.value !== props.value) {
          this.updateElementState(id, { value: props.value });
        }
      }
    }
  }

  /**
   * Update element style for design review
   */
  updateElementStyle(
    id: string,
    flatStyle: Record<string, unknown>,
    stateStyles?: {
      pressed?: Record<string, unknown>;
      focused?: Record<string, unknown>;
      disabled?: Record<string, unknown>;
    }
  ): void {
    const element = this.elements.get(id);
    if (element) {
      const updated: RegisteredNativeElement = {
        ...element,
        flatStyle,
        ...(stateStyles !== undefined ? { stateStyles } : {}),
      };
      this.elements.set(id, updated);
    }
  }

  /**
   * Get element style for design review
   */
  getElementStyle(id: string): Record<string, unknown> | null {
    const element = this.elements.get(id);
    return element?.flatStyle ?? null;
  }

  /**
   * Find element by testID
   */
  findByTestId(testId: string): RegisteredNativeElement | undefined {
    for (const element of this.elements.values()) {
      const identifier = element.getIdentifier();
      if (identifier.testId === testId) {
        return element;
      }
    }
    return undefined;
  }

  /**
   * Find elements by type
   */
  findByType(type: NativeElementType): RegisteredNativeElement[] {
    return Array.from(this.elements.values()).filter((e) => e.type === type);
  }

  // ============================================================================
  // Component Management
  // ============================================================================

  /**
   * Register a component
   */
  registerComponent(id: string, options: RegisterComponentOptions): RegisteredNativeComponent {
    const { name, description, actions = [], elementIds } = options;

    const registered: RegisteredNativeComponent = {
      id,
      name,
      description,
      // Closed field list, applied once — see `toRegisteredComponentActions`.
      actions: toRegisteredComponentActions(actions),
      elementIds,
      registeredAt: Date.now(),
      mounted: true,
    };

    this.components.set(id, registered);

    this.emit('component:registered', { id, name });

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered component: ${id} (${name})`);
    }

    return registered;
  }

  /**
   * Update a registered component's declaration in place — name, description,
   * actions, elementIds.
   *
   * Sister to {@link updateElementMeta}, and it exists for the same reason one
   * level up. `registerComponent` publishes the declaration exactly once, and
   * `useUIComponent` registers on mount and never again, so an action whose
   * `label` carries a count, an action that only exists while a row is
   * selected, a `paramSchema` that widens once options load, or an `elementIds`
   * list that grows after mount, all published their mount-time shape to
   * `/control/components` forever. PR #176 closed that hole for an ELEMENT's
   * label; this closes it for a COMPONENT's declaration.
   *
   * **Idempotent by VALUE over the PUBLISHED shape.** `handler` identity is
   * excluded from the comparison — call sites pass inline closures that are
   * freshly allocated every render, so including it would report a change on
   * every call and make the door useless for a render-path publisher. The
   * newest handlers are still STORED whenever `actions` is supplied, which is
   * the other half of the same defect: without it the registry keeps the
   * closure from the render that registered the component, so a handler reading
   * component state read the state as it was at mount.
   *
   * Returns `true` when the published shape changed and an event was emitted,
   * `false` otherwise — the same contract as `updateElementMeta`, so a caller
   * can gate a warning or a state write on a real change.
   */
  updateComponentMeta(id: string, meta: UpdateComponentMetaOptions): boolean {
    const component = this.components.get(id);
    if (!component) return false;

    const nextName = meta.name !== undefined ? meta.name : component.name;
    const nextDescription =
      meta.description !== undefined ? meta.description : component.description;
    const nextActions =
      meta.actions !== undefined ? toRegisteredComponentActions(meta.actions) : component.actions;
    const nextElementIds = meta.elementIds !== undefined ? meta.elementIds : component.elementIds;

    const changed =
      nextName !== component.name ||
      nextDescription !== component.description ||
      !sameElementIds(nextElementIds, component.elementIds) ||
      publishedActionSignature(nextActions) !== publishedActionSignature(component.actions);

    // Nothing published changed AND no fresh handlers were offered: leave the
    // stored entry untouched so its identity stays stable for consumers holding
    // a reference.
    if (!changed && meta.actions === undefined) return false;

    // Store even when `changed` is false, provided actions were supplied: the
    // handlers in `nextActions` are the CURRENT render's closures. Keeping the
    // old ones is exactly how a component action ends up reading state from the
    // render it was first declared in.
    this.components.set(id, {
      ...component,
      name: nextName,
      description: nextDescription,
      actions: nextActions,
      elementIds: nextElementIds,
    });

    if (!changed) return false;

    // Reuse `component:registered` rather than minting a
    // 'component:metaChanged' BridgeEventType — same reasoning as
    // `updateElementMeta`'s reuse of `element:registered`: a new event type is a
    // breaking change for every consumer switching exhaustively over the union.
    this.emit('component:registered', { id, name: nextName });

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Updated component: ${id} (${nextName})`);
    }

    return true;
  }

  /**
   * Unregister a component
   */
  unregisterComponent(id: string): void {
    const component = this.components.get(id);
    if (component) {
      this.components.delete(id);
      this.emit('component:unregistered', { id });

      if (this.config.verbose) {
        console.log(`[ui-bridge-native] Unregistered component: ${id}`);
      }
    }
  }

  /**
   * Get a registered component
   */
  getComponent(id: string): RegisteredNativeComponent | undefined {
    return this.components.get(id);
  }

  /**
   * Get all registered components
   */
  getAllComponents(): RegisteredNativeComponent[] {
    return Array.from(this.components.values());
  }

  // ============================================================================
  // Workflow Management
  // ============================================================================

  /**
   * Register a workflow
   */
  registerWorkflow(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered workflow: ${workflow.id}`);
    }
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(id: string): void {
    this.workflows.delete(id);
  }

  /**
   * Get a workflow
   */
  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  // ============================================================================
  // Event System
  // ============================================================================

  /**
   * Subscribe to events
   */
  on<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): () => void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener as BridgeEventListener);

    // Return unsubscribe function
    return () => this.off(type, listener);
  }

  /**
   * Unsubscribe from events
   */
  off<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): void {
    this.eventListeners.get(type)?.delete(listener as BridgeEventListener);
  }

  /**
   * Emit an event
   */
  emit(type: BridgeEventType, data: unknown): void {
    const event: BridgeEvent = {
      type,
      timestamp: Date.now(),
      data,
    };

    // Notify listeners
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`[ui-bridge-native] Event listener error:`, error);
        }
      }
    }

    // Notify global handler
    if (this.config.onEvent) {
      try {
        this.config.onEvent(event);
      } catch (error) {
        console.error(`[ui-bridge-native] Global event handler error:`, error);
      }
    }
  }

  // ============================================================================
  // Snapshots
  // ============================================================================

  /**
   * Create a snapshot of the current state.
   *
   * Route resolution: `routeInfo` wins when provided. Otherwise — and this
   * is the path the default `getSnapshot` HTTP handler takes — we fall back
   * to the registered `routeProvider`. This means callers that never wire a
   * server-level override (the bare-server / cloud-relay path) still get a
   * populated `currentRoute` field as long as `setRouteProvider` was called
   * on the registry.
   *
   * `activeTab` resolves through {@link resolveActiveTab} on BOTH branches. An
   * explicit `routeInfo.activeTab` wins outright; otherwise a registered
   * provider's `getActiveTab()` answers and the Expo Router derivation is the
   * fallback. Deriving straight from `routeInfo.segments` here instead — which
   * is what this branch did when `activeTab` was introduced — silently ignored
   * `RouteProvider.getActiveTab` on the ONLY path that serves
   * `control/snapshot` once `setRouteProvider` is wired (the server installs a
   * `getSnapshot` override that passes `routeInfo`), so the opt-in hook for an
   * app whose visible pane is decoupled from the router reached no consumer.
   */
  createSnapshot(
    routeInfo?: {
      currentRoute?: string | null;
      segments?: string[];
      /**
       * Explicit active tab for callers that own the answer outright. Omit to
       * let the registered `routeProvider` / the segment derivation resolve it.
       */
      activeTab?: string | null;
    },
    options?: { visibleOnly?: boolean; currentRouteOnly?: boolean }
  ): NativeBridgeSnapshot {
    // Resolve route info: prefer the explicit argument, fall back to a
    // registered route provider. We treat an explicitly-passed `routeInfo`
    // (even if both fields are null/undefined) as "the caller is in charge"
    // so server-layer overrides that pass `{currentRoute: null}` keep working.
    const resolvedRoute: {
      currentRoute: string | null;
      segments: string[] | undefined;
      activeTab: string | undefined;
    } = (() => {
      if (routeInfo !== undefined) {
        const explicit =
          typeof routeInfo.activeTab === 'string' && routeInfo.activeTab.length > 0
            ? routeInfo.activeTab
            : undefined;
        return {
          currentRoute: routeInfo.currentRoute ?? null,
          segments: routeInfo.segments,
          activeTab: explicit ?? this.resolveActiveTab(routeInfo.segments),
        };
      }
      if (this.routeProvider) {
        try {
          const segments = this.routeProvider.getSegments?.();
          return {
            currentRoute: this.routeProvider.getCurrentRoute() ?? null,
            segments,
            activeTab: this.resolveActiveTab(segments),
          };
        } catch (error) {
          if (this.config.verbose) {
            console.warn(`[ui-bridge-native] routeProvider getCurrentRoute threw:`, error);
          }
          return { currentRoute: null, segments: undefined, activeTab: undefined };
        }
      }
      return { currentRoute: null, segments: undefined, activeTab: undefined };
    })();

    // visibleOnly uses the *looser* mounted-visible filter so a snapshot
    // taken in the gap between mount and the first `onLayout` doesn't
    // return 0 elements on a populated screen. Each element in the
    // payload carries a `visibility` field so agents can branch on
    // measured vs unmeasured.
    let elements = options?.visibleOnly ? this.getMountedVisibleElements() : this.getAllElements();

    // Filter to elements that belong on the current route. Route-agnostic
    // elements (no `registrationRoute`) pass through too — see the
    // `matchesCurrentRoute` doc comment for the rationale (tab bars, modal
    // hosts and other app-root registrations have a null route and apply to
    // every screen).
    if (options?.currentRouteOnly && resolvedRoute.currentRoute) {
      const currentRoute = resolvedRoute.currentRoute;
      elements = elements.filter((e) => matchesCurrentRoute(e.registrationRoute, currentRoute));
    }

    // Read ONCE per snapshot, not once per element: it is a `Dimensions.get`
    // call behind a try/catch, and a rotation landing mid-map would otherwise
    // give elements in the SAME snapshot different clip regions.
    const viewport = this.getViewportRect();

    const snapshot: NativeBridgeSnapshot = {
      timestamp: Date.now(),
      elements: elements.map((e) => {
        const handlers = extractHandlerNames(e.props);
        const state = e.getState();
        const { visibility, visibilityReason } = computeVisibility(
          state,
          this.getClipRectFor(e, viewport)
        );
        const bbox = projectBbox(state, visibility, this.pixelRatio);
        const vision = projectVisionFields({
          type: e.type,
          label: e.label,
          // Real interactivity signal: the names of props that are actually
          // functions (onPress/onChangeText/...). NOT `e.actions`, which
          // `inferActions` synthesizes press/click onto for every element —
          // using it would mark plain text/view nodes interactable.
          handlerNames: handlers,
          state,
          flatStyle: e.flatStyle,
        });
        return {
          id: e.id,
          type: e.type,
          label: e.label,
          identifier: e.getIdentifier(),
          state,
          actions: e.actions,
          customActions: e.customActions ? Object.keys(e.customActions) : undefined,
          registeredHandlers: handlers.length > 0 ? handlers : undefined,
          registrationRoute: e.registrationRoute,
          visibility,
          ...(visibilityReason ? { visibilityReason } : {}),
          ...(bbox ? { bbox } : {}),
          ...vision,
        };
      }),
      components: this.getAllComponents().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        actions: c.actions.map((a) => a.id),
        elementIds: c.elementIds,
      })),
      workflows: this.getAllWorkflows().map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        stepCount: w.steps.length,
      })),
      currentRoute: resolvedRoute.currentRoute,
      segments: resolvedRoute.segments,
      // Canonical aliases, spelled the way the web SDK's `BridgeSnapshot`
      // spells them so a cross-platform consumer reads one field name on both
      // platforms. Omitted rather than nulled when unknown — same convention
      // as the web fields, and it keeps the emitted shape byte-identical for
      // hosts that wire no route provider.
      ...(resolvedRoute.currentRoute ? { route: resolvedRoute.currentRoute } : {}),
      ...(resolvedRoute.activeTab ? { activeTab: resolvedRoute.activeTab } : {}),
      registration: this.getRegistrationCoverage(),
    };

    // Include app identification metadata so consumers can identify which
    // app produced this snapshot without a separate health probe.
    if (this.appInfo) {
      snapshot.appInfo = this.appInfo;
    }

    // Canonical enrichers — each in its own try/catch so a misbehaving tracker
    // can never break the rest of the snapshot.
    if (this.enrichers.modalDetector) {
      try {
        snapshot.modalStack = this.enrichers.modalDetector.getSnapshotModalContext();
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`[ui-bridge-native] modalDetector enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.toastCapture) {
      try {
        snapshot.toasts = this.enrichers.toastCapture.getSnapshotToastContext();
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`[ui-bridge-native] toastCapture enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.undoTracker) {
      try {
        snapshot.undoRedo = this.enrichers.undoTracker.getSnapshotUndoContext();
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`[ui-bridge-native] undoTracker enricher threw:`, error);
        }
      }
    }

    // Custom enrichers — keys assign-merged onto the snapshot
    if (this.snapshotExtras.size > 0) {
      const ctx = { elements, currentRoute: resolvedRoute.currentRoute };
      for (const [name, fn] of this.snapshotExtras) {
        try {
          const extra = fn(ctx);
          if (extra && typeof extra === 'object') {
            Object.assign(snapshot, extra);
          }
        } catch (error) {
          if (this.config.verbose) {
            console.warn(`[ui-bridge-native] snapshot enricher "${name}" threw:`, error);
          }
        }
      }
    }

    return snapshot;
  }

  /**
   * Get registry statistics
   */
  getStats(): { elements: number; components: number; workflows: number } {
    return {
      elements: this.elements.size,
      components: this.components.size,
      workflows: this.workflows.size,
    };
  }

  /**
   * Compute registration coverage metadata for the current registry state.
   *
   * Groups currently-registered elements by `registrationRoute`, bucketing
   * elements without a route under `'?'`. `everHadRegistrations` is sticky —
   * once true, it stays true for the lifetime of the registry instance.
   */
  getRegistrationCoverage(): NativeRegistrationCoverage {
    const byRoute: Record<string, number> = {};
    for (const element of this.elements.values()) {
      const key =
        element.registrationRoute == null || element.registrationRoute === ''
          ? '?'
          : element.registrationRoute;
      byRoute[key] = (byRoute[key] ?? 0) + 1;
    }
    return {
      totalRegistered: this.elements.size,
      everHadRegistrations: this.everHadRegistrations,
      byRoute,
    };
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.elements.clear();
    this.components.clear();
    this.workflows.clear();

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registry cleared`);
    }
  }
}

// ============================================================================
// Global Registry
// ============================================================================

let globalRegistry: NativeUIBridgeRegistry | null = null;

/**
 * Set the global registry
 */
export function setGlobalRegistry(registry: NativeUIBridgeRegistry): void {
  globalRegistry = registry;
}

/**
 * Get the global registry
 */
export function getGlobalRegistry(): NativeUIBridgeRegistry | null {
  return globalRegistry;
}

/**
 * Reset the global registry
 */
export function resetGlobalRegistry(): void {
  globalRegistry?.clear();
  globalRegistry = null;
}
