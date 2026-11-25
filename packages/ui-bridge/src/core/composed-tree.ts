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
 * The element that really holds focus: `document.activeElement`, descended
 * through each open shadow root's own `activeElement` (a focused node inside a
 * shadow tree reads as its host at the document level). A closed shadow root
 * stops the descent at its host.
 */
export function deepestActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * Whether a `focus()` on `el` landed: the deepest active element is `el` or a
 * flat-tree descendant of it — the `:focus-within` meaning, so a registered
 * wrapper that forwards focus to an inner input counts as taken.
 *
 * Shared by both action arms (the HTTP executor's `performFocus` and the
 * relay's `focus` case). A browser does not move focus to a node that is not
 * focusable, or that sits in a `display: none` subtree or is
 * `visibility: hidden` / `collapse`; without this read-back both arms reported
 * such a `focus()` as a success.
 */
export function focusLanded(el: Element): boolean {
  const active = deepestActiveElement(el.ownerDocument);
  if (!active) return false;
  return active === el || composedAncestry(active).includes(el);
}
