/**
 * `bridgeAccessOver` — a real {@link BridgeAccess} backed by a populated
 * {@link UIBridgeRegistry}, with no React and no app cooperation.
 *
 * `executeCommand` reads elements/components/workflows from the **global**
 * registry (`getGlobalRegistry()`), so for Tier-1 injected semantics
 * (find / act / snapshot / state-read) the bridge object is mostly a
 * formality — what matters is that the bootstrap installs the populated
 * registry via `setGlobalRegistry()`. The `BridgeAccess` returned here is
 * still real (its `getElement` resolves against the same registry), so the
 * handful of dispatcher branches that consult `bridge` directly behave
 * correctly. The author-supplied state-machine / workflow layer is
 * structurally absent on an uninstrumented page (plan §3.3 Tier-gap), so
 * `registry` (the state-machine accessor) is intentionally omitted.
 */

import type { UIBridgeRegistry } from '../core/registry';
import type { BridgeAccess } from '../react/commandHandlers';

/** Build a registry-backed {@link BridgeAccess}. */
export function bridgeAccessOver(registry: UIBridgeRegistry): BridgeAccess {
  return {
    get elements() {
      return registry.getAllElements();
    },
    getElement: (id: string) => registry.getElement(id),
    get components() {
      return registry.getAllComponents() as unknown as BridgeAccess['components'];
    },
    get workflows() {
      return registry.getAllWorkflows() as unknown as BridgeAccess['workflows'];
    },
  };
}
