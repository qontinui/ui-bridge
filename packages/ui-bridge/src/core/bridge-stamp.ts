/**
 * The `data-ui-bridge-id` stamps the REGISTRY wrote itself.
 *
 * `registerElement` stamps a node that has no `data-ui-bridge-id`, so that
 * `describeOccluder` can name every directly registered occluder. That stamp
 * is the bridge's bookkeeping, not a developer's: it must not outrank the
 * node's own name sources in the derived accessible name, and it must leave
 * with the registration that wrote it. The doors that write their own stamp
 * (`useUIElement`, `useAutoRegister`) keep the historical semantics and are
 * never in this set.
 *
 * Ownership is per registry and per id: only the registry that wrote a stamp,
 * unregistering the id it wrote, removes it, and a stamp someone else has
 * since rewritten to a different value is no longer the registry's. A writer
 * that rewrites the SAME value is indistinguishable from the registry and is
 * treated as the registry's stamp.
 *
 * Its own module so `a11y.ts` can read it without importing the registry,
 * which imports `a11y.ts`.
 */

/** Who wrote a registry stamp, and the id it wrote. */
interface StampOwner {
  /**
   * Token of the registry that wrote it (several registries can share a DOM).
   * A per-registry token, not the registry, so the record holds no registry.
   */
  owner: object;
  /** The id the registry wrote. */
  id: string;
}

const registryStamped = new WeakMap<Element, StampOwner>();

/** Record that registry `owner` wrote `id` as `node`'s `data-ui-bridge-id`. */
export function markRegistryStamp(node: Element, owner: object, id: string): void {
  registryStamped.set(node, { owner, id });
}

/**
 * True when `node`'s CURRENT `data-ui-bridge-id` is a stamp a registry wrote.
 *
 * Ownership is checked against the live attribute: once anyone else writes a
 * different value (a hook, a JSX prop, the developer), the registry no longer
 * owns it, and the stale record is dropped here.
 */
export function isRegistryStamp(node: Element): boolean {
  return registryStampOwner(node) !== undefined;
}

/** The live owner record of `node`'s registry stamp, or `undefined`. */
export function registryStampOwner(node: Element): StampOwner | undefined {
  const entry = registryStamped.get(node);
  if (!entry) return undefined;
  if (node.getAttribute('data-ui-bridge-id') !== entry.id) {
    registryStamped.delete(node);
    return undefined;
  }
  return entry;
}

/**
 * True when registry `owner` wrote `node`'s current stamp, and it reads `id`.
 * The one test `unregisterElement` may remove a stamp on.
 */
export function ownsRegistryStamp(node: Element, owner: object, id: string): boolean {
  const entry = registryStampOwner(node);
  return entry !== undefined && entry.owner === owner && entry.id === id;
}

/** Forget that the registry stamped `node` (its stamp was removed or adopted). */
export function clearRegistryStamp(node: Element): void {
  registryStamped.delete(node);
}
