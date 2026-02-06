/**
 * Spec Store
 *
 * In-memory store for spec configs with CRUD operations,
 * import/export, coverage tracking, and event emission.
 * Follows the AnnotationStore pattern.
 */

import type {
  SpecConfig,
  SpecGroup,
  SpecAssertion,
  SpecEvent,
  SpecCoverage,
  SpecCategory,
  SpecSeverity,
} from './types';
import { SPEC_CONFIG_VERSION } from './types';
import { validateSpecConfig } from './validator';

// =============================================================================
// Types
// =============================================================================

export type SpecListener = (event: SpecEvent) => void;

export interface SpecFilterOptions {
  categories?: SpecCategory[];
  severities?: SpecSeverity[];
  enabledOnly?: boolean;
  reviewedOnly?: boolean;
}

// =============================================================================
// Store
// =============================================================================

export class SpecStore {
  private configs = new Map<string, SpecConfig>();
  private listeners = new Set<SpecListener>();

  // ---------------------------------------------------------------------------
  // CRUD — Config Level
  // ---------------------------------------------------------------------------

  load(specId: string, config: SpecConfig): void {
    this.configs.set(specId, config);
    this.emit({ type: 'spec:loaded', specId, timestamp: Date.now() });
  }

  unload(specId: string): boolean {
    const existed = this.configs.delete(specId);
    if (existed) {
      this.emit({ type: 'spec:unloaded', specId, timestamp: Date.now() });
    }
    return existed;
  }

  get(specId: string): SpecConfig | undefined {
    return this.configs.get(specId);
  }

  has(specId: string): boolean {
    return this.configs.has(specId);
  }

  getIds(): string[] {
    return Array.from(this.configs.keys());
  }

  getAll(): Map<string, SpecConfig> {
    return new Map(this.configs);
  }

  get count(): number {
    return this.configs.size;
  }

  clear(): void {
    this.configs.clear();
    this.emit({ type: 'spec:cleared', timestamp: Date.now() });
  }

  // ---------------------------------------------------------------------------
  // CRUD — Group Level
  // ---------------------------------------------------------------------------

  addGroup(specId: string, group: SpecGroup): boolean {
    const config = this.configs.get(specId);
    if (!config) return false;

    config.groups.push(group);
    this.emit({ type: 'spec:group-added', specId, groupId: group.id, timestamp: Date.now() });
    return true;
  }

  removeGroup(specId: string, groupId: string): boolean {
    const config = this.configs.get(specId);
    if (!config) return false;

    const idx = config.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return false;

    config.groups.splice(idx, 1);
    this.emit({ type: 'spec:group-removed', specId, groupId, timestamp: Date.now() });
    return true;
  }

  getGroup(specId: string, groupId: string): SpecGroup | undefined {
    const config = this.configs.get(specId);
    if (!config) return undefined;
    return config.groups.find((g) => g.id === groupId);
  }

  // ---------------------------------------------------------------------------
  // CRUD — Assertion Level
  // ---------------------------------------------------------------------------

  addAssertion(specId: string, groupId: string | null, assertion: SpecAssertion): boolean {
    const config = this.configs.get(specId);
    if (!config) return false;

    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (!group) return false;
      group.assertions.push(assertion);
    } else {
      if (!config.assertions) config.assertions = [];
      config.assertions.push(assertion);
    }

    this.emit({
      type: 'spec:assertion-added',
      specId,
      groupId: groupId ?? undefined,
      assertionId: assertion.id,
      timestamp: Date.now(),
    });
    return true;
  }

  removeAssertion(specId: string, groupId: string | null, assertionId: string): boolean {
    const config = this.configs.get(specId);
    if (!config) return false;

    let removed = false;

    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (group) {
        const idx = group.assertions.findIndex((a) => a.id === assertionId);
        if (idx !== -1) {
          group.assertions.splice(idx, 1);
          removed = true;
        }
      }
    } else if (config.assertions) {
      const idx = config.assertions.findIndex((a) => a.id === assertionId);
      if (idx !== -1) {
        config.assertions.splice(idx, 1);
        removed = true;
      }
    }

    if (removed) {
      this.emit({
        type: 'spec:assertion-removed',
        specId,
        groupId: groupId ?? undefined,
        assertionId,
        timestamp: Date.now(),
      });
    }
    return removed;
  }

  toggleAssertion(specId: string, groupId: string | null, assertionId: string): boolean {
    const assertion = this.findAssertion(specId, groupId, assertionId);
    if (!assertion) return false;
    assertion.enabled = !assertion.enabled;
    this.emit({ type: 'spec:updated', specId, timestamp: Date.now() });
    return true;
  }

  markReviewed(specId: string, groupId: string | null, assertionId: string): boolean {
    const assertion = this.findAssertion(specId, groupId, assertionId);
    if (!assertion) return false;
    assertion.reviewed = !assertion.reviewed;
    this.emit({ type: 'spec:updated', specId, timestamp: Date.now() });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getAllAssertions(): SpecAssertion[] {
    const result: SpecAssertion[] = [];
    for (const config of this.configs.values()) {
      for (const group of config.groups) {
        result.push(...group.assertions);
      }
      if (config.assertions) {
        result.push(...config.assertions);
      }
    }
    return result;
  }

  filterAssertions(opts: SpecFilterOptions): SpecAssertion[] {
    return this.getAllAssertions().filter((a) => {
      if (opts.categories && !opts.categories.includes(a.category)) return false;
      if (opts.severities && !opts.severities.includes(a.severity)) return false;
      if (opts.enabledOnly && !a.enabled) return false;
      if (opts.reviewedOnly && !a.reviewed) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Coverage
  // ---------------------------------------------------------------------------

  getCoverage(allElementIds: string[]): SpecCoverage {
    const specifiedIdSet = new Set<string>();
    for (const assertion of this.getAllAssertions()) {
      if (assertion.target.type === 'elementId') {
        specifiedIdSet.add(assertion.target.elementId);
      }
    }

    const specifiedIds: string[] = [];
    const unspecifiedIds: string[] = [];
    for (const id of allElementIds) {
      if (specifiedIdSet.has(id)) {
        specifiedIds.push(id);
      } else {
        unspecifiedIds.push(id);
      }
    }

    const total = allElementIds.length;
    return {
      totalElements: total,
      specifiedElements: specifiedIds.length,
      coveragePercent: total > 0 ? (specifiedIds.length / total) * 100 : 0,
      specifiedIds,
      unspecifiedIds,
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Import / Export
  // ---------------------------------------------------------------------------

  importConfig(specId: string, config: SpecConfig): boolean {
    const result = validateSpecConfig(config);
    if (!result.valid) return false;
    this.configs.set(specId, config);
    this.emit({ type: 'spec:loaded', specId, timestamp: Date.now() });
    return true;
  }

  exportConfig(specId: string): SpecConfig | undefined {
    const config = this.configs.get(specId);
    if (!config) return undefined;
    return {
      ...config,
      version: SPEC_CONFIG_VERSION,
      metadata: {
        ...config.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on(listener: SpecListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SpecEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the store
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private findAssertion(
    specId: string,
    groupId: string | null,
    assertionId: string
  ): SpecAssertion | undefined {
    const config = this.configs.get(specId);
    if (!config) return undefined;

    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (!group) return undefined;
      return group.assertions.find((a) => a.id === assertionId);
    }

    return config.assertions?.find((a) => a.id === assertionId);
  }
}

// =============================================================================
// Global Singleton
// =============================================================================

let globalStore: SpecStore | null = null;

export function getGlobalSpecStore(): SpecStore {
  if (!globalStore) {
    globalStore = new SpecStore();
  }
  return globalStore;
}

export function resetGlobalSpecStore(): void {
  globalStore = null;
}
