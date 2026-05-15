/**
 * Vision pipeline SDK helpers. Currently only the mutation-occurred
 * signal, but the surface grows as Phase 4–6 vision endpoints expose
 * client-callable shapes (extract/describe/analyze/assert/baseline).
 */

export { mutationOccurred, installAutoMutationOccurred } from './mutation';
export type { MutationOccurredOptions, MutationOccurredResult } from './mutation';
