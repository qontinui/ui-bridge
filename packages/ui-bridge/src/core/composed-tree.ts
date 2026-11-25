/**
 * Flat-tree (composed-tree) navigation shared by the forced-hover machinery
 * (`control/forced-hover.ts`) and the action render check
 * (`core/element-state.ts` `isRenderedForAction`). Lives in `core/` so no core
 * module has to import from `control/`.
 */

/** The shadow root `node` lives in, or `null` when it is in a document tree. */
export function shadowRootOf(node: Node): ShadowRoot | null {
  const root = node.getRootNode?.();
  if (root && root !== node && (root as ShadowRoot).host instanceof Element) {
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
 * wrapper that forwards focus to an inner input (in its light tree or across
 * its own open shadow root) counts as taken.
 *
 * The read starts from `el`'s OWN root (`getRootNode()`), not the document:
 * from the document, a node inside a CLOSED shadow root is unreachable (the
 * descent stops at the closed host), so a focus that did land there would read
 * as not taken. A disconnected `el` has neither, and reads as not taken.
 *
 * Shared by both action arms (the HTTP executor's `performFocus` and the
 * relay's `focus` case). A browser does not move focus to a node that is not
 * focusable, or that sits in a `display: none` subtree or is
 * `visibility: hidden` / `collapse`; without this read-back both arms reported
 * such a `focus()` as a success.
 */
export function focusLanded(el: Element): boolean {
  // By node type, not `instanceof`, so a node in another realm (an iframe)
  // is read too: a document, or a shadow root (a fragment with a host).
  const root = el.getRootNode();
  const isTreeRoot =
    root.nodeType === 9 /* DOCUMENT_NODE */ ||
    (root.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */ && 'host' in root);
  if (!isTreeRoot) return false;
  const active = deepestActiveElement(root as Document | ShadowRoot);
  if (!active) return false;
  return active === el || composedAncestry(active).includes(el);
}
