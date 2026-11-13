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
 * §4.6: no DOM content (text, values, labels) is read. `props` are NOT read
 * by default (`props: null`): the fail-closed redaction below cannot be
 * complete, because a CLOSED shadow root on a standard element (a `div`, a
 * `span`) is undetectable, so the prop read is opt-in
 * ({@link ComponentCaptureOptions.props}, `?props=true` on the routes). When
 * requested they come from {@link extractOwnerComponentProps} /
 * `extractComponentFiberProps`, which redact every value unless the owning
 * component's subtree shows no password input, redaction boundary, open
 * shadow root or custom element, and the capture notes the residual gap in
 * `unknownChecks`. A redacted element's component name is dropped (`null`)
 * and recorded in `unknownChecks`, never reported as a different name.
 *
 * Component targets: the root is the nearest common DOM ancestor of the
 * component's elements, whose own React owner is usually the PARENT. Root
 * identity (`nodes[0].componentName`) and `props` therefore come from the
 * component's fiber, resolved HEURISTICALLY as the deepest component fiber
 * owning all of its registered `elementIds`. When those elements are
 * rendered by children or slotted in by a wrapper, that can name a different
 * component (e.g. a `Layout`), so a component-target capture whose owner
 * resolved carries an `unknownChecks` note saying so (and a distinct note
 * when no owning component fiber resolved).
 */

import { computeRoleSafe } from '../core/a11y';
import { classList } from '../core/class-name';
import {
  projectExtendedComputedStyles,
  type ProjectedComputedStyles,
} from '../core/computed-styles';
import { isValueRedacted } from '../core/redaction';
import { extractComponentFiberProps, extractOwnerComponentProps } from './action-executor';
import {
  FIBER_TAG,
  commonOwningComponentFiber,
  componentNameOf,
  currentFiber,
  fiberChainOf,
  fiberKeyer,
  hostFiberOf,
  isElement,
  isReactManaged,
  owningComponentFiber,
  type FiberLike,
} from './react-fiber';

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
  /**
   * Element-child index path from the root (`""` for the root). A portalled
   * node is numbered under its React parent, after that parent's DOM children.
   */
  path: string;
  /** Lowercase tag name. */
  tag: string;
  /** Explicit role, else the implicit role, else `null`. */
  role: string | null;
  /** UI Bridge registered element id; on a component target's root, the component id. */
  registeredId: string | null;
  /**
   * The registered `useUIComponent` id owning this node when there is one,
   * else the nearest owning React component's name; `null` when unreadable
   * (minified, redacted, not React-managed).
   */
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
  /**
   * The owning component's scrubbed props when the caller asked for them
   * (`props: true` / `?props=true`), else `null` — never read by default.
   */
  props: Record<string, unknown> | null;
  /** Capture-side notes about checks the capture could not support (bounded, counted). */
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
  getAllComponents?(): unknown[];
  getLastSnapshotIdentity?(): { snapshotId: string } | null;
}

/**
 * The capture's style whitelist — the wire contract's key set, every key
 * read through {@link projectExtendedComputedStyles}.
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

/** Hard cap on fibers the portal walk visits. */
export const MAX_PORTAL_WALK_FIBERS = MAX_CAPTURE_NODES * 4;

/** Options for {@link captureComponent}. */
export interface ComponentCaptureOptions {
  /**
   * Read and scrub the owning component's props. Off by default: the
   * fail-closed redaction cannot see inside a closed shadow root on a
   * standard element, so the read happens only on request.
   */
  props?: boolean;
}

/**
 * The capture routes' `?props=` flag: `true` only for `true` / `"true"` /
 * `"1"`; anything else (absent included) is off.
 */
export function wantsCaptureProps(value: unknown): boolean {
  if (Array.isArray(value)) value = value[value.length - 1];
  return value === true || value === 'true' || value === '1';
}

/** Distinct `unknownChecks` notes kept; the rest are counted in one overflow note. */
const MAX_NOTE_KINDS = 20;

// ============================================================================
// Entry point
// ============================================================================

/**
 * Capture a registered component or element.
 *
 * Root: an element target's root is that element. A component target's root
 * is the nearest common DOM ancestor of its mounted, NON-portalled
 * `elementIds` (`RegisteredComponent` carries no DOM reference); its
 * portalled elements are recorded as portal nodes. An unknown id refuses
 * `not_found`; a component with no mounted element refuses
 * `no_mounted_elements`.
 */
export function captureComponent(
  registry: ComponentCaptureRegistry,
  target: ComponentCaptureTarget,
  options: ComponentCaptureOptions = {}
): ComponentCaptureResult {
  const notes = new NoteBag();
  let root: Element;
  let state: Record<string, unknown> | null = null;
  let portalled: Element[] = [];
  /** A component target's own fiber: owner of its props and root name. */
  let owner: FiberLike | undefined;

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
    if (mounted.length === 0) {
      return refuse(
        'no_mounted_elements',
        `Component ${target.id} has no mounted elementIds to root a capture on`
      );
    }
    owner = commonOwningComponentFiber(mounted);
    const split = splitPortalled(mounted);
    let common: Element | null;
    if (split.inPlace.length === 0) {
      notes.add(
        'root: every mounted element of the component is portalled; rooted at their common DOM ancestor'
      );
      common = nearestCommonAncestor(mounted);
    } else {
      common = nearestCommonAncestor(split.inPlace);
      portalled = split.portalled;
    }
    if (!common) {
      return refuse('no_mounted_elements', `Component ${target.id} has no common DOM ancestor`);
    }
    root = common;
    try {
      state = comp.getState?.() ?? null;
    } catch {
      state = null;
    }
  }

  return {
    ok: true,
    capture: buildCapture(registry, target, root, state, portalled, owner, notes, options),
  };
}

function refuse(reason: ComponentCaptureRefusalReason, message: string): ComponentCaptureResult {
  return { ok: false, refusal: { error: 'component_capture_refused', reason }, message };
}

// ============================================================================
// Capture construction
// ============================================================================

interface Walk {
  nodes: ComponentCaptureNode[];
  pathOf: Map<Element, string>;
  /** Portal ordinals already handed out under each React parent. */
  portalOrdinals: Map<Element, number>;
  truncated: boolean;
}

function buildCapture(
  registry: ComponentCaptureRegistry,
  target: ComponentCaptureTarget,
  root: Element,
  state: Record<string, unknown> | null,
  extraPortals: Element[],
  owner: FiberLike | undefined,
  notes: NoteBag,
  options: ComponentCaptureOptions
): ComponentCapture {
  const win = root.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const scrollX = win?.scrollX ?? 0;
  const scrollY = win?.scrollY ?? 0;
  const rootRect = pageRect(root, scrollX, scrollY);
  const registeredIds = registeredIdIndex(registry);
  const componentIds = componentIdIndex(registry);

  const walk: Walk = { nodes: [], pathOf: new Map(), portalOrdinals: new Map(), truncated: false };

  // A component target's root is a common DOM ancestor, whose own owner is
  // usually the PARENT component. Its identity comes from the component's own
  // fiber instead (heuristic: the deepest component owning all of its
  // registered elements) — also when the root itself is not React-managed.
  // A value-redacted root keeps `null`.
  let rootName: string | undefined;
  if (target.kind === 'component') {
    notes.add(
      owner
        ? 'componentName/props: the component fiber is resolved heuristically as the deepest component owning all its elementIds, and may name a wrapper (e.g. Layout)'
        : 'componentName/props: no owning component fiber resolved for the elementIds; root name and props unknown'
    );
    const name = owner ? componentNameOf(owner) : undefined;
    if (name && !looksMinified(name) && !isValueRedacted(root as HTMLElement)) rootName = name;
  }

  const visit = (el: Element, path: string, portal: ComponentCapturePortal | null): void => {
    if (walk.nodes.length >= MAX_CAPTURE_NODES) {
      walk.truncated = true;
      return;
    }
    walk.pathOf.set(el, path);
    walk.nodes.push(
      buildNode(el, path, portal, rootRect, scrollX, scrollY, registeredIds, componentIds, notes, {
        nameOverride: path === '' && el === root ? rootName : undefined,
      })
    );
    let index = 0;
    for (const child of Array.from(el.children)) {
      visit(child, path === '' ? String(index) : `${path}/${index}`, null);
      index++;
    }
  };

  const visitPortal = (host: Element, reactParent: Element): void => {
    if (walk.pathOf.has(host)) return;
    const reactParentPath = walk.pathOf.get(reactParent);
    if (reactParentPath === undefined) return;
    const ordinal = walk.portalOrdinals.get(reactParent) ?? 0;
    walk.portalOrdinals.set(reactParent, ordinal + 1);
    const slot = reactParent.children.length + ordinal;
    const path = reactParentPath === '' ? String(slot) : `${reactParentPath}/${slot}`;
    visit(host, path, { mountTarget: descriptorChain(host.parentElement), reactParentPath });
  };

  visit(root, '', null);

  // Portals: host nodes that belong to the root's React subtree but are
  // mounted under another DOM parent. They are absent from the DOM walk
  // above, so they are appended with their DOM subtrees.
  const portals = findPortalHosts(root);
  if (!portals.enumerable) {
    notes.add(
      'portals: not enumerable (no React fiber reachable from the root); portal facts unknown'
    );
  }
  if (portals.exhausted) {
    notes.add(
      `portals: walk stopped at its budget of ${MAX_PORTAL_WALK_FIBERS} fibers / elements; portals beyond it not captured`
    );
  }
  for (const found of portals.found) visitPortal(found.host, found.reactParent);

  // A component's own registered elements that are portalled away from its
  // root: recorded as portal nodes under their nearest captured React parent.
  for (const host of extraPortals) {
    visitPortal(host, nearestCapturedReactParent(host, walk.pathOf) ?? root);
  }

  if (walk.truncated) {
    notes.add(`nodes: truncated at ${MAX_CAPTURE_NODES}; deeper nodes not captured`);
  }

  // The component target's id names the root, as documented on `registeredId`.
  if (target.kind === 'component' && walk.nodes[0]) walk.nodes[0].registeredId = target.id;

  // Props only on request (see the module doc). Like the root name, they
  // come from the component's own fiber for a component target; without one
  // (not React), they are unknown.
  let props: Record<string, unknown> | null = null;
  if (options.props) {
    notes.add(
      'props: a closed shadow root on a standard element cannot be detected, so the fail-closed redaction may miss content inside one'
    );
    try {
      if (target.kind === 'component') {
        props = owner ? extractComponentFiberProps(owner, root) : null;
      } else {
        props = extractOwnerComponentProps(root);
      }
    } catch {
      props = null;
    }
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
    nodes: walk.nodes,
    clipAncestors: clipAncestors(root, scrollX, scrollY),
    state,
    props,
    unknownChecks: notes.render(),
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
  componentIds: Map<Element, string>,
  notes: NoteBag,
  opts: { nameOverride?: string } = {}
): ComponentCaptureNode {
  const rect = pageRect(el, scrollX, scrollY);
  return {
    path,
    tag: el.tagName.toLowerCase(),
    role: computeRoleSafe(el) ?? null,
    registeredId: registeredIds.get(el) ?? null,
    componentName: opts.nameOverride ?? readComponentName(el, path, componentIds, notes),
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
 * A node's component identity: `null` (with a counted `unknownChecks` note)
 * when the node is value-redacted or not React-managed; else the registered
 * `useUIComponent` id owning it; else the nearest owning component's name
 * from a dedicated fiber walk (function, class, forwardRef and memo fibers),
 * `null` when there is none or it looks minified.
 */
function readComponentName(
  el: Element,
  path: string,
  componentIds: Map<Element, string>,
  notes: NoteBag
): string | null {
  if (isValueRedacted(el as HTMLElement)) {
    notes.addAt('componentName: unreadable (redacted)', path);
    return null;
  }
  const registered = componentIds.get(el);
  if (registered) return registered;
  if (!isReactManaged(el)) {
    notes.addAt('componentName: unreadable (not React-managed)', path);
    return null;
  }
  const host = hostFiberOf(el);
  const owner = host ? owningComponentFiber(host) : undefined;
  const name = owner ? componentNameOf(owner) : undefined;
  if (!name) {
    notes.addAt('componentName: unreadable (no named owning component)', path);
    return null;
  }
  if (looksMinified(name)) {
    notes.addAt('componentName: unreadable (minified)', path);
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
  let projected: Required<ProjectedComputedStyles>;
  try {
    projected = projectExtendedComputedStyles(win.getComputedStyle(el));
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
// unknownChecks — counted, bounded
// ============================================================================

/**
 * Collapses repeated per-node notes into one counted note per kind (with up
 * to three example paths), and caps the number of kinds.
 */
class NoteBag {
  private readonly kinds = new Map<string, { count: number; paths: string[] }>();
  private readonly order: string[] = [];
  private dropped = 0;

  add(note: string): void {
    this.bump(note, undefined);
  }

  addAt(kind: string, path: string): void {
    this.bump(kind, path);
  }

  private bump(kind: string, path: string | undefined): void {
    let entry = this.kinds.get(kind);
    if (!entry) {
      if (this.order.length >= MAX_NOTE_KINDS) {
        this.dropped++;
        return;
      }
      entry = { count: 0, paths: [] };
      this.kinds.set(kind, entry);
      this.order.push(kind);
    }
    entry.count++;
    if (path !== undefined && entry.paths.length < 3) entry.paths.push(path);
  }

  render(): string[] {
    const out = this.order.map((kind) => {
      const { count, paths } = this.kinds.get(kind)!;
      if (paths.length === 0) return count > 1 ? `${kind} (x${count})` : kind;
      const quoted = paths.map((p) => `"${p}"`).join(', ');
      return count === 1
        ? `${kind} at 1 node (${quoted})`
        : `${kind} at ${count} nodes (e.g. ${quoted})`;
    });
    if (this.dropped > 0) out.push(`unknownChecks: ${this.dropped} further note(s) not listed`);
    return out;
  }
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
  for (let c: Element | null = elements[0]; c; c = c.parentElement) {
    const candidate = c;
    if (elements.every((el) => candidate === el || candidate.contains(el))) return candidate;
  }
  return null;
}

// ============================================================================
// Portals (React fiber STRUCTURE only — no props are read here)
// ============================================================================

/**
 * Split a component's mounted elements into those rendered in place and those
 * portalled: an element is portalled when a HostPortal fiber sits between it
 * and the lowest fiber common to all the elements. Without fibers, in place.
 */
function splitPortalled(elements: Element[]): { inPlace: Element[]; portalled: Element[] } {
  const chains = elements.map(fiberChainOf);
  if (elements.length < 2 || chains.some((c) => !c)) return { inPlace: elements, portalled: [] };
  // A fiber and its alternate are one ancestor: chains read through
  // different halves of a pair must still meet.
  const key = fiberKeyer();
  const sets = chains.map((c) => new Set(c!.map(key)));
  const lca = chains[0]!.find((f) => sets.every((set) => set.has(key(f))));
  if (!lca) return { inPlace: elements, portalled: [] };
  const lcaKey = key(lca);
  const inPlace: Element[] = [];
  const portalled: Element[] = [];
  elements.forEach((el, i) => {
    let crossed = false;
    for (const f of chains[i]!) {
      if (key(f) === lcaKey) break;
      if (f.tag === FIBER_TAG.HostPortal) crossed = true;
    }
    (crossed ? portalled : inPlace).push(el);
  });
  return { inPlace, portalled };
}

/** The nearest React-ancestor host node of `el` that the walk already captured. */
function nearestCapturedReactParent(el: Element, pathOf: Map<Element, string>): Element | null {
  const host = hostFiberOf(el);
  for (let f = host?.return; f; f = f.return) {
    const node = f.stateNode;
    if (isElement(node) && pathOf.has(node)) return node;
  }
  return null;
}

/**
 * Walk the root's CURRENT React subtree and return each connected host node
 * whose DOM parent differs from its React parent's host node — the definition
 * of a portal. Only the top host of each portal is returned; its DOM subtree
 * is captured by the caller's DOM walk.
 *
 * A root React does not manage (a `createRoot` container, a plain DOM
 * wrapper) has no fiber of its own: the walk then starts from the React roots
 * that render into it — the HostRoot of each top-most React-managed
 * descendant — and keeps only portals whose React parent lies inside the
 * root. `enumerable: false` says no fiber was reachable at all, so portal
 * facts are unknown rather than absent.
 */
function findPortalHosts(root: Element): {
  found: Array<{ host: Element; reactParent: Element }>;
  exhausted: boolean;
  enumerable: boolean;
} {
  const found: Array<{ host: Element; reactParent: Element }> = [];
  let budget = MAX_PORTAL_WALK_FIBERS;
  let exhausted = false;

  // No containment filter: the unmanaged-root branch only starts from React
  // roots whose container lies inside the capture root (`reactRootsInside`),
  // and below that a React parent outside the root is a portal host already
  // captured — a portal nested in a portal — which must be kept.
  const walk = (fiber: FiberLike | null | undefined, reactParent: Element): void => {
    for (let f = fiber; f; f = f.sibling) {
      if (budget <= 0) {
        exhausted = true;
        return;
      }
      budget--;
      const node = f.stateNode;
      if (isElement(node)) {
        if (!node.isConnected) continue;
        if (node.parentNode !== reactParent) found.push({ host: node, reactParent });
        walk(f.child, node);
      } else {
        walk(f.child, reactParent);
      }
    }
  };

  const rootFiber = hostFiberOf(root);
  if (rootFiber) {
    walk(rootFiber.child, root);
    return { found, exhausted, enumerable: true };
  }

  const roots = reactRootsInside(root);
  if (roots.exhausted) exhausted = true;
  for (const start of roots.starts) walk(start.fiber.child, start.container);
  return { found, exhausted, enumerable: roots.starts.length > 0 };
}

/**
 * The current HostRoot fibers of the React roots rendering into `root`, with
 * their containers. The DOM scan is a TreeWalker bounded by
 * {@link MAX_PORTAL_WALK_FIBERS} elements; `exhausted` says it stopped early.
 * It never descends into a React-managed subtree (its React root is recorded
 * at its top-most node, and the fiber walk covers the rest), so a large app
 * costs one step per React root, while non-React islands are still searched
 * for further roots.
 */
function reactRootsInside(root: Element): {
  starts: Array<{ fiber: FiberLike; container: Element }>;
  exhausted: boolean;
} {
  const starts: Array<{ fiber: FiberLike; container: Element }> = [];
  const seen = new Set<unknown>();
  const doc = root.ownerDocument;
  if (!doc?.createTreeWalker) return { starts, exhausted: false };
  const walker = doc.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */);
  // A container React rendered into is marked even when it holds no managed
  // DOM (a root rendering only a portal), so containers are recorded from
  // that marker; managed nodes cover the rest.
  recordContainerRoot(root, root, seen, starts);
  let scanned = 0;
  let node = walker.firstChild();
  while (node) {
    if (++scanned > MAX_PORTAL_WALK_FIBERS) return { starts, exhausted: true };
    const el = node as Element;
    if (!isReactManaged(el)) {
      recordContainerRoot(el, root, seen, starts);
      node = walker.nextNode();
      continue;
    }
    recordReactRoot(el, root, seen, starts);
    node = nextSkippingSubtree(walker);
  }
  return { starts, exhausted: false };
}

/** The walker's next node in document order that is NOT inside its current node. */
function nextSkippingSubtree(walker: TreeWalker): Node | null {
  for (;;) {
    const sibling = walker.nextSibling();
    if (sibling) return sibling;
    if (!walker.parentNode()) return null;
  }
}

/** Record the React root whose container `el` is (React's `__reactContainer$` marker). */
function recordContainerRoot(
  el: Element,
  root: Element,
  seen: Set<unknown>,
  starts: Array<{ fiber: FiberLike; container: Element }>
): void {
  const rec = el as unknown as Record<string, unknown>;
  const key = Object.keys(rec).find((k) => k.startsWith('__reactContainer$'));
  const hostRoot = key ? (rec[key] as FiberLike | null | undefined) : undefined;
  if (!hostRoot || hostRoot.tag !== FIBER_TAG.HostRoot) return;
  const fiberRoot = hostRoot.stateNode as { current?: FiberLike } | undefined;
  const current = fiberRoot?.current ?? hostRoot;
  if (seen.has(fiberRoot ?? hostRoot)) return;
  if (el !== root && !root.contains(el)) return;
  seen.add(fiberRoot ?? hostRoot);
  starts.push({ fiber: current, container: el });
}

function recordReactRoot(
  el: Element,
  root: Element,
  seen: Set<unknown>,
  starts: Array<{ fiber: FiberLike; container: Element }>
): void {
  let f: FiberLike | null | undefined = hostFiberOf(el);
  while (f && f.tag !== FIBER_TAG.HostRoot) f = f.return;
  const fiberRoot = f?.stateNode as { current?: FiberLike; containerInfo?: unknown } | undefined;
  const current = fiberRoot?.current ?? (f ? (currentFiber(f) ?? f) : undefined);
  const container = fiberRoot?.containerInfo;
  if (!current || !isElement(container) || seen.has(fiberRoot)) return;
  if (container !== root && !root.contains(container)) return;
  seen.add(fiberRoot);
  starts.push({ fiber: current, container });
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

/** DOM node → the id of the registered component that lists it in `elementIds`. */
function componentIdIndex(registry: ComponentCaptureRegistry): Map<Element, string> {
  const index = new Map<Element, string>();
  for (const raw of registry.getAllComponents?.() ?? []) {
    const comp = raw as { id?: unknown; elementIds?: unknown };
    if (typeof comp.id !== 'string' || !Array.isArray(comp.elementIds)) continue;
    for (const elementId of comp.elementIds) {
      if (typeof elementId !== 'string') continue;
      const el = (registry.getElement(elementId) as { element?: unknown } | undefined)?.element;
      if (isElement(el) && !index.has(el)) index.set(el, comp.id);
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

// ============================================================================
// Refusal mapping (shared by the direct handlers, the relay handlers and the
// in-page relay dispatcher)
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
 * The HTTP envelope of a refusal. `error` and `reason` sit at the TOP level
 * (the contract body is `{ error: "component_capture_refused", reason }`);
 * `data` repeats the refusal body for envelope readers.
 */
export interface ComponentCaptureRefusalEnvelope {
  success: false;
  error: 'component_capture_refused';
  reason: ComponentCaptureRefusalReason;
  code: 'UB-ELEM-NOT-FOUND' | 'UB-OBS-INPUT-MISSING';
  data: ComponentCaptureRefusal;
  suggestions: string[];
  httpStatus: 404 | 422;
  timestamp: number;
}

export function componentCaptureRefusalEnvelope(
  reason: ComponentCaptureRefusalReason,
  message: string
): ComponentCaptureRefusalEnvelope {
  return {
    success: false,
    error: 'component_capture_refused',
    reason,
    code: componentCaptureRefusalCode(reason),
    data: { error: 'component_capture_refused', reason },
    suggestions: [message],
    httpStatus: componentCaptureRefusalStatus(reason),
    timestamp: Date.now(),
  };
}

/**
 * The in-page relay dispatcher's refusal message. A relayed failure keeps
 * ONLY its message across the transport (the relay client posts
 * `success: false`, `rejectCommand` and the cross-instance bus carry the
 * string alone), so the reason is encoded in it and recovered by
 * {@link parseComponentCaptureRefusal} on the server side.
 */
export function componentCaptureRefusalMessage(
  reason: ComponentCaptureRefusalReason,
  message: string
): string {
  return `component_capture_refused:${reason}: ${message}`;
}

// Anchored at the start: `relayCommand` passes the in-page message through
// first (hints are only ever APPENDED), so nothing precedes the marker.
const REFUSAL_MESSAGE =
  /^component_capture_refused:(not_found|no_mounted_elements)(?::\s*([\s\S]*))?$/;

/** Recover a refusal from a relayed failure message, or `undefined`. */
export function parseComponentCaptureRefusal(
  text: unknown
): { reason: ComponentCaptureRefusalReason; message: string } | undefined {
  if (typeof text !== 'string') return undefined;
  const m = REFUSAL_MESSAGE.exec(text);
  if (!m) return undefined;
  return { reason: m[1] as ComponentCaptureRefusalReason, message: (m[2] ?? '').trim() };
}

/**
 * The relay dispatcher's answer for a capture: the capture itself on success,
 * else an inner failure whose message encodes the refusal (see
 * {@link componentCaptureRefusalMessage}) and whose top-level fields carry it
 * for a transport that keeps the payload.
 */
export function componentCaptureCommandResult(result: ComponentCaptureResult): unknown {
  if (result.ok) return result.capture;
  return {
    success: false,
    error: componentCaptureRefusalMessage(result.refusal.reason, result.message),
    reason: result.refusal.reason,
    code: componentCaptureRefusalCode(result.refusal.reason),
    timestamp: Date.now(),
  };
}
