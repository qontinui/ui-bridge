/**
 * Adapter Registry
 *
 * Simple map-based registry for form framework adapters.
 * Consumers register adapters explicitly; detectAdapters() probes
 * each registered adapter and returns those whose detect() returns true.
 */

import type { AdapterRegistry, FormFrameworkAdapter } from './types';

/**
 * Create a new adapter registry.
 *
 * @example
 * ```ts
 * import { createAdapterRegistry, ReactHookFormAdapter } from '@qontinui/ui-bridge';
 *
 * const registry = createAdapterRegistry();
 * registry.register(new ReactHookFormAdapter());
 *
 * // Later, detect which adapters are active on the page
 * const active = registry.detectAdapters();
 * for (const adapter of active) {
 *   const forms = adapter.extractForms();
 *   console.log(`${adapter.name}: ${forms.length} forms`);
 * }
 * ```
 */
export function createAdapterRegistry(): AdapterRegistry {
  const adapters = new Map<string, FormFrameworkAdapter>();

  return {
    register(adapter: FormFrameworkAdapter): void {
      adapters.set(adapter.name, adapter);
    },

    unregister(name: string): void {
      adapters.delete(name);
    },

    getAdapter(name: string): FormFrameworkAdapter | undefined {
      return adapters.get(name);
    },

    detectAdapters(): FormFrameworkAdapter[] {
      const detected: FormFrameworkAdapter[] = [];
      for (const adapter of adapters.values()) {
        try {
          if (adapter.detect()) {
            detected.push(adapter);
          }
        } catch {
          // Adapter detection failed — skip silently
        }
      }
      return detected;
    },

    getAllAdapters(): FormFrameworkAdapter[] {
      return Array.from(adapters.values());
    },
  };
}
