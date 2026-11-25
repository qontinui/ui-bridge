/**
 * Flat-tree (composed-tree) navigation shared by the forced-hover machinery
 * (`control/forced-hover.ts`) and the action render check
 * (`core/element-state.ts` `isRenderedForAction`). Lives in `core/` so no core
 * module has to import from `control/`.
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
 * Whether a `focus()` on `el` landed: the deepest active element is `el` or a
 * flat-tree descendant of it — the `:focus-within` meaning, so a registered
 * wrapper that forwards focus to an inner input (in its light tree, across
 * its own open shadow root, or into a light-DOM node one of its `<slot>`s
 * takes) counts as taken.
 *
 * The read starts from `el`'s OWN root (`getRootNode()`), not the document:
 * from the document, a node inside a CLOSED shadow root is unreachable (the
 * descent stops at the closed host), so a focus that did land there would read
 * as not taken. It then climbs root by root (a shadow root to its host's root,
 * up to the document): a light-DOM node assigned to a slot inside `el` lives in
 * an OUTER tree, so `el`'s own shadow root reports no `activeElement` for it,
 * and only an outer root sees it. Each candidate is accepted when its
 * flat-tree ancestry (`composedAncestry`: a slotted node's parent is its slot)
 * reaches `el`. A disconnected `el` has no tree root, and reads as not taken.
 *
 * Shared by both action arms (the HTTP executor's `performFocus` and the
 * relay's `focus` case). A browser does not move focus to a node that is not
 * focusable, or that sits in a `display: none` subtree or is
 * `visibility: hidden` / `collapse`; without this read-back both arms reported
 * such a `focus()` as a success.
 */
export function focusLanded(el: Element): boolean {
  let root: Node = el.getRootNode();
  for (;;) {
    // By node type, not `instanceof`, so a node in another realm (an iframe)
    // is read too: a document, or a shadow root (a fragment with a host).
    const isDocument = root.nodeType === 9; /* DOCUMENT_NODE */
    const host = root.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */ ? (root as ShadowRoot).host : null;
    if (!isDocument && !host) return false;
    const active = deepestActiveElement(root as Document | ShadowRoot);
    if (active && (active === el || composedAncestry(active).includes(el))) return true;
    if (isDocument || !host) return false;
    root = host.getRootNode();
  }
}
