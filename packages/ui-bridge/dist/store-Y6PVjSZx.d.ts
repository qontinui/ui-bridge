import { S as SpecCategory, a as SpecSeverity, b as SpecEvent, c as SpecConfig, d as SpecGroup, e as SpecAssertion, f as SpecCoverage } from './types-D__LSm5P.js';

/**
 * Spec Store
 *
 * In-memory store for spec configs with CRUD operations,
 * import/export, coverage tracking, and event emission.
 * Follows the AnnotationStore pattern.
 */

type SpecListener = (event: SpecEvent) => void;
interface SpecFilterOptions {
    categories?: SpecCategory[];
    severities?: SpecSeverity[];
    enabledOnly?: boolean;
    reviewedOnly?: boolean;
}
declare class SpecStore {
    private configs;
    private listeners;
    load(specId: string, config: SpecConfig): void;
    unload(specId: string): boolean;
    get(specId: string): SpecConfig | undefined;
    has(specId: string): boolean;
    getIds(): string[];
    getAll(): Map<string, SpecConfig>;
    get count(): number;
    clear(): void;
    addGroup(specId: string, group: SpecGroup): boolean;
    removeGroup(specId: string, groupId: string): boolean;
    getGroup(specId: string, groupId: string): SpecGroup | undefined;
    addAssertion(specId: string, groupId: string | null, assertion: SpecAssertion): boolean;
    removeAssertion(specId: string, groupId: string | null, assertionId: string): boolean;
    toggleAssertion(specId: string, groupId: string | null, assertionId: string): boolean;
    markReviewed(specId: string, groupId: string | null, assertionId: string): boolean;
    getAllAssertions(): SpecAssertion[];
    filterAssertions(opts: SpecFilterOptions): SpecAssertion[];
    getCoverage(allElementIds: string[]): SpecCoverage;
    importConfig(specId: string, config: SpecConfig): boolean;
    exportConfig(specId: string): SpecConfig | undefined;
    on(listener: SpecListener): () => void;
    private emit;
    private findAssertion;
}
declare function getGlobalSpecStore(): SpecStore;
declare function resetGlobalSpecStore(): void;

export { SpecStore as S, type SpecFilterOptions as a, type SpecListener as b, getGlobalSpecStore as g, resetGlobalSpecStore as r };
