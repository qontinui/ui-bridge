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
 * The focused element as each tree on `el`'s path to the document sees it:
 * the deepest active element of `el`'s OWN root (`getRootNode()`), then of its
 * host's root, and so on up to the document — `null` where a root has none.
 * Empty for a disconnected `el`.
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

/** Where focus stood, as `focusLanded` compares it, before a `focus()`. */
export type FocusSnapshot = readonly (Element | null)[];

/** Read focus before calling `el.focus()`, for {@link focusLanded}. */
export function snapshotFocus(el: Element): FocusSnapshot {
  return activeAlongRoots(el);
}

/**
 * Whether a `focus()` on `el` landed. Taken when, in some tree on `el`'s path
 * to the document (see `activeAlongRoots`), the focused element is `el`
 * itself, or is a flat-tree descendant of `el` (`composedAncestry`: a slotted
 * node's parent is its slot) that focus MOVED to — the `:focus-within`
 * meaning, so a wrapper that forwards focus to an inner input (in its light
 * tree, across its own open shadow root, or into a light-DOM node one of its
 * `<slot>`s takes) counts as taken.
 *
 * `before` is the {@link snapshotFocus} taken just before the `focus()` call.
 * Without it a descendant that ALREADY held focus would count: a `focus()` on
 * a non-focusable container whose child was focused does nothing, yet would
 * read as taken. A disconnected `el` reads as not taken.
 *
 * Shared by both action arms (the HTTP executor's `performFocus` and the
 * relay's `focus` case). A browser does not move focus to a node that is not
 * focusable, or that sits in a `display: none` subtree or is
 * `visibility: hidden` / `collapse`; without this read-back both arms reported
 * such a `focus()` as a success.
 */
export function focusLanded(el: Element, before?: FocusSnapshot): boolean {
  return activeAlongRoots(el).some((active, i) => {
    if (!active) return false;
    if (active === el) return true;
    const moved = before === undefined || before[i] !== active;
    return moved && composedAncestry(active).includes(el);
  });
}
