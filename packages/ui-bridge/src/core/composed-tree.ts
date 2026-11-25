/**
 * Flat-tree (composed-tree) navigation and focus reads, shared by the
 * forced-hover machinery (`control/forced-hover.ts`), the action render check
 * (`core/element-state.ts` `isRenderedForAction`), both `focus` action arms
 * ({@link focusAndReadBack}: the HTTP executor's `performFocus` and the
 * relay's `focus` case) and the design inspector's focus reads
 * (`ai/design-inspector.ts`, {@link deepestActiveElement}). Lives in `core/`
 * so no core module has to import from `control/`.
 */

/**
 * The shadow root `node` lives in, or `null` when it is in a document tree.
 *
 * Judged by node type, never `instanceof`: a node inside an iframe belongs to
 * another realm, whose `Element` is not this one's, and an `instanceof` test
 * there would read every shadow root as "no shadow root" and stop the
 * flat-tree walk at it.
 */
export function shadowRootOf(node: Node): ShadowRoot | null {
  const root = node.getRootNode?.();
  if (
    root &&
    root !== node &&
    root.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */ &&
    (root as ShadowRoot).host?.nodeType === 1 /* ELEMENT_NODE */
  ) {
    return root as ShadowRoot;
  }
  return null;
}

/**
 * The target and every ancestor on its flat-tree path, innermost first: a
 * slotted element's parent is its slot, and a shadow root is crossed to its
 * host — the path a real `:hover` propagates along, and the path layout
 * inherits `display: none` along.
 *
 * `assignedSlot` is `null` for a node slotted into a CLOSED shadow root, so
 * for such a node the path skips its slot and goes straight to the host.
 */
export function composedAncestry(target: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = target;
  while (current) {
    chain.push(current);
    current = current.assignedSlot ?? current.parentElement ?? shadowRootOf(current)?.host ?? null;
  }
  return chain;
}

/** The parent in the flat (composed) tree: the slot of a slotted node, the host past a shadow root. */
export function composedParent(el: Element): Element | null {
  const slot = (el as Element & { assignedSlot?: Element | null }).assignedSlot;
  if (slot) return slot;
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode as (Node & { host?: Element }) | null;
  return root && root.host && root.host.nodeType === 1 ? root.host : null;
}

/**
 * Whether `el` is drawn in the top layer: an open popover, a modal dialog, a
 * fullscreen element. That lifts it out of its ancestors' transforms, opacity,
 * filters and clips, though not out of their zoom, which it inherits.
 */
export function inTopLayer(el: Element): boolean {
  const is = (state: string): boolean => {
    try {
      return el.matches(state);
    } catch {
      return false;
    }
  };
  const doc = el.ownerDocument;
  return (
    (el.hasAttribute('popover') && is(':popover-open')) ||
    (el.localName === 'dialog' && is(':modal')) ||
    (doc?.fullscreenElement != null && is(':fullscreen'))
  );
}

/** The element `el` is painted inside: its composed parent, or none in the top layer. */
export function paintParent(el: Element): Element | null {
  return inTopLayer(el) ? null : composedParent(el);
}

/**
 * The product of `opacity` from `el` up its paint-parent chain (shadow and
 * slot aware; a top-layer element is exempt from its ancestors' opacity),
 * rounded to 4 decimals. An unparseable opacity counts as 1.
 *
 * `memo` caches the raw product per element and must be scoped to ONE pass
 * (one moment of style): sharing it across passes serves stale values. With
 * it, each element's computed style is read once however many registered
 * elements share an ancestor.
 */
export function effectiveOpacity(
  el: Element,
  view: Pick<Window, 'getComputedStyle'>,
  memo?: Map<Element, number>
): number {
  const chain: Element[] = [];
  let base = 1;
  for (let a: Element | null = el; a; a = paintParent(a)) {
    const known = memo?.get(a);
    if (known !== undefined) {
      base = known;
      break;
    }
    chain.push(a);
  }
  let product = base;
  for (let i = chain.length - 1; i >= 0; i--) {
    const parsed = parseFloat(view.getComputedStyle(chain[i]).opacity);
    if (!Number.isNaN(parsed)) product *= parsed;
    memo?.set(chain[i], product);
  }
  return Math.round(product * 10000) / 10000;
}

/**
 * The element that really holds focus within `root` (a document or a shadow
 * root): its `activeElement`, descended through each OPEN shadow root's own
 * `activeElement` (a focused node inside a shadow tree reads as its host one
 * level up). A closed shadow root below `root` stops the descent at its host.
 */
export function deepestActiveElement(root: Document | ShadowRoot): Element | null {
  let active: Element | null = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * The focused element as each tree on `el`'s path to the document sees it:
 * the deepest active element of `el`'s OWN root (`getRootNode()`), then of its
 * host's root, and so on up to the document — `null` where a root has none.
 * For a disconnected `el` no entry is ever focused: empty when `el` is in a
 * disconnected light tree, and one `null` per shadow root crossed when it is
 * in the shadow tree of a disconnected host (`[null]` for an `el` directly in
 * such a host's shadow root), since the climb stops at the first root that is
 * neither a document nor a shadow root.
 *
 * Reading from `el`'s own root first matters for a CLOSED shadow root: from
 * the document the descent stops at the closed host, so a focus that landed
 * inside would be invisible. Climbing matters for a `<slot>`: a light-DOM node
 * a slot inside `el` takes lives in an OUTER tree, so `el`'s own shadow root
 * reports no `activeElement` for it, and only an outer root sees it.
 */
function activeAlongRoots(el: Element): (Element | null)[] {
  const seen: (Element | null)[] = [];
  let root: Node = el.getRootNode();
  for (;;) {
    // By node type, not `instanceof`, so a node in another realm (an iframe)
    // is read too: a document, or a shadow root (a fragment with a host).
    if (root.nodeType === 9 /* DOCUMENT_NODE */) {
      seen.push(deepestActiveElement(root as Document));
      return seen;
    }
    const host = root.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */ ? (root as ShadowRoot).host : null;
    if (!host) return seen;
    seen.push(deepestActiveElement(root as ShadowRoot));
    root = host.getRootNode();
  }
}

/**
 * Call `el.focus()` and report whether focus was taken. The ONE observation
 * both action arms make (the HTTP executor's `performFocus` and the relay's
 * `focus` case): a browser does not move focus to a node that is not
 * focusable, or that sits in a `display: none` subtree or is
 * `visibility: hidden` / `collapse`, and without this read-back both arms
 * reported such a `focus()` as a success.
 *
 * Taken when either holds:
 *
 * - A `focusin` reached `el` during the call — focus arrived at `el` or at a
 *   node inside it — AND focus is still at `el` or inside it afterwards. A
 *   focus trap or roving container hands focus straight back to the
 *   descendant that already held it, and the read below cannot see that
 *   (nothing MOVED), yet `el` did take focus. A focus that something outside
 *   `el` (a document-level modal trap) pulls back OUT of `el` is not taken,
 *   even though `focusin` fired on the way.
 * - Afterwards, in some tree on `el`'s path to the document (see
 *   `activeAlongRoots`), the focused element is `el` itself, or a flat-tree
 *   descendant of `el` (`composedAncestry`: a slotted node's parent is its
 *   slot) that focus MOVED to — the `:focus-within` meaning, so a wrapper
 *   that forwards focus to an inner input (in its light tree, across its own
 *   open shadow root, or into a light-DOM node one of its `<slot>`s takes)
 *   counts as taken. Where focus stood is read just before the call: without
 *   it a descendant that ALREADY held focus would count, so a `focus()` that
 *   did nothing on a container whose child was focused would read as taken.
 *   This read is what catches an `el` that already held focus (no event
 *   fires) and a forwarded focus whose `focusin` a descendant's handler
 *   stopped before it reached `el`.
 *
 * A disconnected `el` reads as not taken.
 */
export function focusAndReadBack(el: HTMLElement): boolean {
  const before = activeAlongRoots(el);
  let reached = false;
  const onFocusIn = (): void => {
    reached = true;
  };
  el.addEventListener('focusin', onFocusIn);
  try {
    el.focus();
  } finally {
    el.removeEventListener('focusin', onFocusIn);
  }
  const after = activeAlongRoots(el);
  if (
    reached &&
    after.some((active) => active === el || (!!active && composedAncestry(active).includes(el)))
  ) {
    return true;
  }
  return after.some((active, i) => {
    if (!active) return false;
    if (active === el) return true;
    return before[i] !== active && composedAncestry(active).includes(el);
  });
}
