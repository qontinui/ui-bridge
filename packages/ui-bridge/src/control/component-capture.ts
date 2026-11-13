/**
 * Component capture — the structural, root-relative picture of one registered
 * component or element that the vision-core `matches_isolated_render`
 * assertion compares between an isolated render (a Storybook story) and the
 * same component in situ (plan
 * `2026-11-13-ui-bridge-matches-isolated-render-assertion`, Phase 2).
 *
 * Served by `GET /control/component/:id/capture` and
 * `GET /control/element/:id/capture`. The JSON shape is a wire contract: the
 * Rust `ComponentCapture` in `qontinui-vision-core` deserializes exactly these
 * camelCase field names, so a rename here is a cross-repo break.
 *
 * What it is NOT: a screenshot. Every fact is read from the DOM, computed
 * style and the React fiber, so geometry is relative to the root and a
 * viewport difference between the two sides cannot fail a comparison alone.
 *
 * §4.6: no DOM content (text, values, labels) is read. Props come from
 * {@link extractOwnerComponentProps}, scrubbed the way `extractReactState`
 * scrubs; a redacted element's component name is dropped (`null`) and
 * recorded in `unknownChecks`, never reported as a different name.
 */

import { computeRoleSafe } from '../core/a11y';
import { classList } from '../core/class-name';
import { projectComputedStyles, type ProjectedComputedStyles } from '../core/computed-styles';
import { verdictOf } from '../core/redaction';
import { extractOwnerComponentProps, extractReactState } from './action-executor';

// ============================================================================
// Wire types
// ============================================================================

/** A rectangle in CSS px. */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a capture was taken of. */
export interface ComponentCaptureTarget {
  kind: 'component' | 'element';
  id: string;
}

/** Portal facts for a node mounted outside its React parent's DOM node. */
export interface ComponentCapturePortal {
  /** CSS-ish descriptor of the node's actual DOM parent, e.g. `body>div#portal-root`. */
  mountTarget: string;
  /** `path` of the node's React parent host node within this capture. */
  reactParentPath: string;
}

/** One node of the captured subtree. */
export interface ComponentCaptureNode {
  /** Element-child index path from the root (`""` for the root). */
  path: string;
  /** Lowercase tag name. */
  tag: string;
  /** Explicit role, else the implicit role, else `null`. */
  role: string | null;
  /** UI Bridge registered element id (or, on a component root, the component id). */
  registeredId: string | null;
  /** Nearest owning React component name; `null` when unreadable or redacted. */
  componentName: string | null;
  /** Bounding box RELATIVE to the root bbox origin. */
  bbox: CaptureRect;
  /** Whitelisted computed styles ({@link CAPTURE_STYLE_KEYS}). */
  styles: Record<string, string>;
  portal: ComponentCapturePortal | null;
}

/** An ancestor outside the root whose overflow clips. */
export interface ComponentCaptureClipAncestor {
  descriptor: string;
  overflowX: string;
  overflowY: string;
  /** Page coordinates. */
  rect: CaptureRect;
}

/** The capture itself — the `matches_isolated_render` wire shape. */
export interface ComponentCapture {
  schemaVersion: 1;
  target: ComponentCaptureTarget;
  snapshotId: string | null;
  route: string | null;
  sourceSha: string | null;
  viewport: { width: number; height: number };
  dpr: number;
  root: {
    /** Page coordinates. */
    bbox: CaptureRect;
    /** The root's parent content box (page coordinates); `null` with no parent element. */
    parentContentBox: CaptureRect | null;
  };
  /** Depth-first pre-order; `nodes[0]` is the root. */
  nodes: ComponentCaptureNode[];
  /** Nearest-first. */
  clipAncestors: ComponentCaptureClipAncestor[];
  /** The component's `state()` for a component target, else `null`. */
  state: Record<string, unknown> | null;
  /** The owning component's scrubbed props, else `null`. */
  props: Record<string, unknown> | null;
  /** Capture-side notes about checks the capture could not support. */
  unknownChecks: string[];
}

/** Why a capture was refused. */
export type ComponentCaptureRefusalReason = 'not_found' | 'no_mounted_elements';

/** The typed refusal body. */
export interface ComponentCaptureRefusal {
  error: 'component_capture_refused';
  reason: ComponentCaptureRefusalReason;
}

export type ComponentCaptureResult =
  | { ok: true; capture: ComponentCapture }
  | { ok: false; refusal: ComponentCaptureRefusal; message: string };

/** The registry surface the capture reads. */
export interface ComponentCaptureRegistry {
  getElement(id: string): unknown;
  getComponent(id: string): unknown;
  getAllElements?(): unknown[];
  getLastSnapshotIdentity?(): { snapshotId: string } | null;
}

/**
 * The capture's style whitelist — the wire contract's key set, every key
 * read through the one {@link projectComputedStyles} projection.
 */
export const CAPTURE_STYLE_KEYS = [
  'display',
  'position',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'flexDirection',
  'boxSizing',
  'overflow',
  'overflowX',
  'overflowY',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'color',
  'backgroundColor',
  'visibility',
  'opacity',
  'zIndex',
  'textOverflow',
  'whiteSpace',
] as const satisfies readonly (keyof ProjectedComputedStyles)[];

/** Hard cap on captured nodes, so a capture of a huge subtree stays bounded. */
export const MAX_CAPTURE_NODES = 2000;

// ============================================================================
// Entry point
// ============================================================================

/**
 * Capture a registered component or element.
 *
 * Root: an element target's root is that element; a component target's root
 * is the nearest common DOM ancestor of its mounted `elementIds`
 * (`RegisteredComponent` carries no DOM reference). An unknown id refuses
 * `not_found`; a component with no mounted element refuses
 * `no_mounted_elements`.
 */
export function captureComponent(
  registry: ComponentCaptureRegistry,
  target: ComponentCaptureTarget
): ComponentCaptureResult {
  let root: Element;
  let state: Record<string, unknown> | null = null;

  if (target.kind === 'element') {
    const entry = registry.getElement(target.id) as { element?: unknown } | undefined;
    if (!entry) return refuse('not_found', `Element not found: ${target.id}`);
    const el = entry.element;
    if (!isElement(el) || !el.isConnected) {
      return refuse('no_mounted_elements', `Element ${target.id} is not mounted`);
    }
    root = el;
  } else {
    const comp = registry.getComponent(target.id) as
      | { elementIds?: string[]; getState?: () => Record<string, unknown> }
      | undefined;
    if (!comp) return refuse('not_found', `Component not found: ${target.id}`);
    const mounted: Element[] = [];
    for (const elementId of comp.elementIds ?? []) {
      const entry = registry.getElement(elementId) as
        | { element?: unknown; mounted?: boolean }
        | undefined;
      const el = entry?.element;
      if (entry && entry.mounted !== false && isElement(el) && el.isConnected) mounted.push(el);
    }
    const common = nearestCommonAncestor(mounted);
    if (!common) {
      return refuse(
        'no_mounted_elements',
        `Component ${target.id} has no mounted elementIds to root a capture on`
      );
    }
    root = common;
    try {
      state = comp.getState?.() ?? null;
    } catch {
      state = null;
    }
  }

  return { ok: true, capture: buildCapture(registry, target, root, state) };
}

function refuse(reason: ComponentCaptureRefusalReason, message: string): ComponentCaptureResult {
  return { ok: false, refusal: { error: 'component_capture_refused', reason }, message };
}

// ============================================================================
// Capture construction
// ============================================================================

function buildCapture(
  registry: ComponentCaptureRegistry,
  target: ComponentCaptureTarget,
  root: Element,
  state: Record<string, unknown> | null
): ComponentCapture {
  const win = root.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const scrollX = win?.scrollX ?? 0;
  const scrollY = win?.scrollY ?? 0;
  const rootRect = pageRect(root, scrollX, scrollY);
  const unknownChecks: string[] = [];
  const registeredIds = registeredIdIndex(registry);
  if (target.kind === 'component' && !registeredIds.has(root)) {
    registeredIds.set(root, target.id);
  }

  const nodes: ComponentCaptureNode[] = [];
  const pathOf = new Map<Element, string>();
  let truncated = false;

  const visit = (el: Element, path: string, portal: ComponentCapturePortal | null): void => {
    if (nodes.length >= MAX_CAPTURE_NODES) {
      truncated = true;
      return;
    }
    pathOf.set(el, path);
    nodes.push(
      buildNode(el, path, portal, rootRect, scrollX, scrollY, registeredIds, unknownChecks)
    );
    let index = 0;
    for (const child of Array.from(el.children)) {
      visit(child, path === '' ? String(index) : `${path}/${index}`, null);
      index++;
    }
  };
  visit(root, '', null);

  // Portals: host nodes that belong to the root's React subtree but are
  // mounted under another DOM parent. They are absent from the DOM walk
  // above, so they are appended with their DOM subtrees.
  for (const found of findPortalHosts(root)) {
    const reactParentPath = pathOf.get(found.reactParent);
    if (reactParentPath === undefined || pathOf.has(found.host)) continue;
    const siblingsAtParent = found.reactParent.children.length + found.ordinal;
    const path =
      reactParentPath === '' ? String(siblingsAtParent) : `${reactParentPath}/${siblingsAtParent}`;
    visit(found.host, path, {
      mountTarget: descriptorChain(found.host.parentElement),
      reactParentPath,
    });
  }

  if (truncated) {
    unknownChecks.push(`nodes: truncated at ${MAX_CAPTURE_NODES}; deeper nodes not captured`);
  }

  let props: Record<string, unknown> | null;
  try {
    props = isHTMLElementLike(root) ? extractOwnerComponentProps(root) : null;
  } catch {
    props = null;
  }

  return {
    schemaVersion: 1,
    target: { kind: target.kind, id: target.id },
    snapshotId: readSnapshotId(registry),
    route: win?.location?.pathname ?? null,
    sourceSha: readSourceSha(root.ownerDocument, win),
    viewport: { width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 },
    dpr: win?.devicePixelRatio || 1,
    root: { bbox: rootRect, parentContentBox: parentContentBox(root, scrollX, scrollY) },
    nodes,
    clipAncestors: clipAncestors(root, scrollX, scrollY),
    state,
    props,
    unknownChecks,
  };
}

function buildNode(
  el: Element,
  path: string,
  portal: ComponentCapturePortal | null,
  rootRect: CaptureRect,
  scrollX: number,
  scrollY: number,
  registeredIds: Map<Element, string>,
  unknownChecks: string[]
): ComponentCaptureNode {
  const rect = pageRect(el, scrollX, scrollY);
  return {
    path,
    tag: el.tagName.toLowerCase(),
    role: computeRoleSafe(el) ?? null,
    registeredId: registeredIds.get(el) ?? null,
    componentName: readComponentName(el, path, unknownChecks),
    bbox: {
      x: rect.x - rootRect.x,
      y: rect.y - rootRect.y,
      width: rect.width,
      height: rect.height,
    },
    styles: captureStyles(el),
    portal,
  };
}

/**
 * The nearest owning component's name, via `extractReactState`. `null` (with
 * an `unknownChecks` note) when the element is redacted, the name looks
 * minified, or no component fiber owns it. Not React-managed at all is
 * `null` with a note too: nothing about the name is known.
 */
function readComponentName(el: Element, path: string, unknownChecks: string[]): string | null {
  const at = `at "${path}"`;
  if (!isHTMLElementLike(el)) {
    unknownChecks.push(`componentName: unreadable (not an HTML element) ${at}`);
    return null;
  }
  let info: ReturnType<typeof extractReactState>;
  try {
    info = extractReactState(el);
  } catch {
    info = null;
  }
  if (!info) {
    unknownChecks.push(`componentName: unreadable (not React-managed) ${at}`);
    return null;
  }
  if (verdictOf(el).value) {
    unknownChecks.push(`componentName: unreadable (redacted) ${at}`);
    return null;
  }
  const name = info.componentName;
  if (!name) {
    unknownChecks.push(`componentName: unreadable (no owning component) ${at}`);
    return null;
  }
  if (looksMinified(name)) {
    unknownChecks.push(`componentName: unreadable (minified "${name}") ${at}`);
    return null;
  }
  return name;
}

/**
 * A production bundle's mangled function name (`a`, `Xe`, `t$`) carries no
 * identity. Heuristic: two characters or fewer.
 */
function looksMinified(name: string): boolean {
  return name.length <= 2;
}

function captureStyles(el: Element): Record<string, string> {
  const win = el.ownerDocument?.defaultView;
  if (!win?.getComputedStyle) return {};
  let projected: ProjectedComputedStyles;
  try {
    projected = projectComputedStyles(win.getComputedStyle(el));
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const key of CAPTURE_STYLE_KEYS) {
    const value = projected[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

// ============================================================================
// Geometry
// ============================================================================

function pageRect(el: Element, scrollX: number, scrollY: number): CaptureRect {
  const r = el.getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
}

function px(value: string | undefined): number {
  const n = parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
}

function parentContentBox(root: Element, scrollX: number, scrollY: number): CaptureRect | null {
  const parent = root.parentElement;
  if (!parent) return null;
  const rect = pageRect(parent, scrollX, scrollY);
  const style = parent.ownerDocument?.defaultView?.getComputedStyle?.(parent);
  if (!style) return rect;
  const left = px(style.borderLeftWidth) + px(style.paddingLeft);
  const right = px(style.borderRightWidth) + px(style.paddingRight);
  const top = px(style.borderTopWidth) + px(style.paddingTop);
  const bottom = px(style.borderBottomWidth) + px(style.paddingBottom);
  return {
    x: rect.x + left,
    y: rect.y + top,
    width: Math.max(0, rect.width - left - right),
    height: Math.max(0, rect.height - top - bottom),
  };
}

function clips(overflow: string | undefined): boolean {
  return !!overflow && overflow !== 'visible';
}

function clipAncestors(
  root: Element,
  scrollX: number,
  scrollY: number
): ComponentCaptureClipAncestor[] {
  const out: ComponentCaptureClipAncestor[] = [];
  const docEl = root.ownerDocument?.documentElement;
  for (let a = root.parentElement; a && a !== docEl; a = a.parentElement) {
    const style = a.ownerDocument?.defaultView?.getComputedStyle?.(a);
    if (!style) continue;
    const overflowX = style.overflowX || style.overflow || 'visible';
    const overflowY = style.overflowY || style.overflow || 'visible';
    if (!clips(overflowX) && !clips(overflowY)) continue;
    out.push({
      descriptor: descriptor(a),
      overflowX,
      overflowY,
      rect: pageRect(a, scrollX, scrollY),
    });
  }
  return out;
}

function nearestCommonAncestor(elements: Element[]): Element | null {
  if (elements.length === 0) return null;
  let candidate: Element | null = elements[0];
  while (candidate) {
    const c: Element = candidate;
    if (elements.every((el) => c === el || c.contains(el))) {
      return c;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

// ============================================================================
// Portals (React fiber structure only — no props are read here)
// ============================================================================

interface FiberLike {
  tag?: number;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  stateNode?: unknown;
}

function fiberOf(el: Element): FiberLike | undefined {
  const rec = el as unknown as Record<string, unknown>;
  const key = Object.keys(rec).find((k) => k.startsWith('__reactFiber$'));
  return key ? (rec[key] as FiberLike | undefined) : undefined;
}

/**
 * Walk the root's React subtree and return each host node whose DOM parent
 * differs from its React parent's host node — the definition of a portal.
 * Only the top host of each portal is returned; its DOM subtree is captured
 * by the caller's DOM walk.
 */
function findPortalHosts(
  root: Element
): Array<{ host: Element; reactParent: Element; ordinal: number }> {
  const rootFiber = fiberOf(root);
  if (!rootFiber) return [];
  const found: Array<{ host: Element; reactParent: Element; ordinal: number }> = [];
  const perParent = new Map<Element, number>();
  let budget = MAX_CAPTURE_NODES * 4;

  const walk = (fiber: FiberLike | null | undefined, reactParent: Element): void => {
    for (let f = fiber; f && budget > 0; f = f.sibling) {
      budget--;
      const node = f.stateNode;
      if (isElement(node)) {
        if (node.parentNode !== reactParent) {
          const ordinal = perParent.get(reactParent) ?? 0;
          perParent.set(reactParent, ordinal + 1);
          found.push({ host: node, reactParent, ordinal });
        }
        walk(f.child, node);
      } else {
        walk(f.child, reactParent);
      }
    }
  };
  walk(rootFiber.child, root);
  return found;
}

// ============================================================================
// Descriptors and provenance
// ============================================================================

function descriptor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = classList(el)[0];
  return cls ? `${tag}.${cls}` : tag;
}

/** Up to three ancestors deep, outermost first: `body>div#portal-root`. */
function descriptorChain(el: Element | null): string {
  const parts: string[] = [];
  const docEl = el?.ownerDocument?.documentElement;
  for (let a = el; a && a !== docEl && parts.length < 3; a = a.parentElement) {
    parts.unshift(descriptor(a));
  }
  return parts.join('>') || 'document';
}

function registeredIdIndex(registry: ComponentCaptureRegistry): Map<Element, string> {
  const index = new Map<Element, string>();
  for (const raw of registry.getAllElements?.() ?? []) {
    const entry = raw as { id?: unknown; element?: unknown };
    if (typeof entry.id === 'string' && isElement(entry.element)) {
      index.set(entry.element, entry.id);
    }
  }
  return index;
}

function readSnapshotId(registry: ComponentCaptureRegistry): string | null {
  try {
    return registry.getLastSnapshotIdentity?.()?.snapshotId ?? null;
  } catch {
    return null;
  }
}

function readSourceSha(doc: Document | null | undefined, win: Window | null): string | null {
  const fromWindow = (win as (Window & { __QONTINUI_SOURCE_SHA__?: unknown }) | null)
    ?.__QONTINUI_SOURCE_SHA__;
  if (typeof fromWindow === 'string' && fromWindow.trim()) return fromWindow.trim();
  const meta = doc?.querySelector?.('meta[name="qontinui-source-sha"]');
  const content = meta?.getAttribute('content');
  return content && content.trim() ? content.trim() : null;
}

function isElement(value: unknown): value is Element {
  return typeof Element !== 'undefined' && value instanceof Element;
}

function isHTMLElementLike(el: Element): el is HTMLElement {
  return typeof HTMLElement !== 'undefined' && el instanceof HTMLElement;
}

// ============================================================================
// Refusal mapping (shared by the direct handlers and the relay dispatcher)
// ============================================================================

/** The canonical diagnostic code a refusal answers with. */
export function componentCaptureRefusalCode(
  reason: ComponentCaptureRefusalReason
): 'UB-ELEM-NOT-FOUND' | 'UB-OBS-INPUT-MISSING' {
  return reason === 'not_found' ? 'UB-ELEM-NOT-FOUND' : 'UB-OBS-INPUT-MISSING';
}

/** The HTTP status a refusal answers with: 404 `not_found`, 422 `no_mounted_elements`. */
export function componentCaptureRefusalStatus(reason: ComponentCaptureRefusalReason): 404 | 422 {
  return reason === 'not_found' ? 404 : 422;
}

/**
 * The relay dispatcher's answer for a capture: the capture itself on success,
 * else an inner failure whose top-level `error`/`reason` carry the typed
 * refusal (the relay keeps that payload verbatim under `data`).
 */
export function componentCaptureCommandResult(result: ComponentCaptureResult): unknown {
  if (result.ok) return result.capture;
  return {
    success: false,
    error: result.refusal.error,
    reason: result.refusal.reason,
    code: componentCaptureRefusalCode(result.refusal.reason),
    message: result.message,
    timestamp: Date.now(),
  };
}
