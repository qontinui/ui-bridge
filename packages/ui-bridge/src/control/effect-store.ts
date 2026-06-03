/**
 * D3 Effect Calculus — Effect Store (Phase 2)
 *
 * A bounded, in-memory ring buffer of the most recent predict-then-verify
 * cycles. The action executor pushes one {@link EffectRecordEntry} per verified
 * action; the read-only `GET /effects/recent` server endpoint drains the
 * newest-first slice for diagnostic / observability consumers.
 *
 * Pure bookkeeping: no DOM access, no timers.
 */

import type { EffectCause, EffectOutcome, EffectVerification } from './effect-types';

/**
 * One recorded predict-then-verify cycle.
 */
export interface EffectRecordEntry {
  /** The action's request id, when one was supplied. */
  requestId?: string;
  /** The action name (e.g. `click`, `navigate`). */
  action: string;
  /** The target element id, when the action targeted an element. */
  elementId?: string;
  /** The terminal classification of the cycle. */
  outcome: EffectOutcome;
  /** Attribution of the observed delta to the action (`causal`/`mixed`/…). */
  cause: EffectCause;
  /** The full verification result. */
  verification: EffectVerification;
  /** Record time, ms (epoch). */
  timestamp: number;
}

/** Default maximum number of retained entries. */
const DEFAULT_CAP = 100;

export class EffectStore {
  /** Insertion-ordered (oldest first) ring buffer of records. */
  private readonly entries: EffectRecordEntry[] = [];
  private readonly cap: number;

  constructor(cap: number = DEFAULT_CAP) {
    this.cap = cap > 0 ? cap : DEFAULT_CAP;
  }

  /** Append a record, evicting the oldest when over capacity. */
  record(e: EffectRecordEntry): void {
    this.entries.push(e);
    while (this.entries.length > this.cap) {
      this.entries.shift();
    }
  }

  /**
   * Return the most recent records, newest-first. When `limit` is omitted all
   * retained records are returned (newest-first). A non-positive `limit`
   * returns an empty array.
   */
  getRecent(limit?: number): EffectRecordEntry[] {
    const newestFirst = this.entries.slice().reverse();
    if (limit === undefined) return newestFirst;
    if (limit <= 0) return [];
    return newestFirst.slice(0, limit);
  }

  /** Drop all retained records. */
  clear(): void {
    this.entries.length = 0;
  }

  /** Current number of retained records (test/diagnostic aid). */
  get size(): number {
    return this.entries.length;
  }
}

// ---------------------------------------------------------------------------
// Process singleton (same lazy-on-globalThis pattern as getGlobalArtifactStore
// / getGlobalCtr in this codebase).
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__uiBridgeEffectStore';

export function getGlobalEffectStore(): EffectStore {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new EffectStore();
  }
  return g[GLOBAL_KEY] as EffectStore;
}

export function setGlobalEffectStore(store: EffectStore): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = store;
}

export function resetGlobalEffectStore(): void {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}
