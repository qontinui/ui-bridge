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
 * Its own module so `a11y.ts` can read it without importing the registry,
 * which imports `a11y.ts`.
 */

const registryStamped = new WeakSet<Element>();

/** Record that the registry itself wrote `node`'s `data-ui-bridge-id`. */
export function markRegistryStamp(node: Element): void {
  registryStamped.add(node);
}

/** True when `node`'s `data-ui-bridge-id` was written by the registry itself. */
export function isRegistryStamp(node: Element): boolean {
  return registryStamped.has(node);
}

/** Forget that the registry stamped `node` (its stamp was removed or adopted). */
export function clearRegistryStamp(node: Element): void {
  registryStamped.delete(node);
}
