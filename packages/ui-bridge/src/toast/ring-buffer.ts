/**
 * ToastRingBuffer — persistent log of emitted toasts for after-the-fact queries.
 *
 * Unlike `ToastCapture` (which scans the DOM for transient notification elements),
 * this is an *explicit* log that consumers emit into when they show status
 * messages. Survives the toast's visual dismissal so tests can assert on the
 * banner text well after it has unmounted.
 *
 * Size-capped ring buffer (default 200 entries) with a TTL (default 10 minutes).
 * When either cap is hit, the oldest entries are evicted.
 *
 * Exported as a singleton (`toastBuffer`) since every consumer within a given
 * app shares one buffer — the runner fetches it through the IPC bridge.
 */

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastEntry {
  /** Stable identifier. Auto-generated if not provided on emit. */
  id: string;
  /** Banner text. */
  message: string;
  /** Severity. */
  kind: ToastKind;
  /** Epoch ms when the toast was emitted. */
  timestamp: number;
  /** Epoch ms when `markDismissed(id)` was called (if ever). */
  dismissedAt?: number;
}

export interface EmitToastInput {
  id?: string;
  message: string;
  kind: ToastKind;
  /** Epoch ms; defaults to `Date.now()`. Useful in tests. */
  timestamp?: number;
}

export interface ToastRingBufferOptions {
  /** Max entries retained. Defaults to 200. */
  maxEntries?: number;
  /** Entry TTL in ms. Defaults to 600_000 (10 min). */
  ttlMs?: number;
  /** Optional clock override for tests. */
  now?: () => number;
}

/** Subscriber callback. Receives the full current buffer snapshot. */
export type ToastSubscriber = (entries: ReadonlyArray<ToastEntry>) => void;

export class ToastRingBuffer {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private entries: ToastEntry[] = [];
  private subscribers = new Set<ToastSubscriber>();
  private idCounter = 0;

  constructor(options: ToastRingBufferOptions = {}) {
    this.maxEntries = options.maxEntries ?? 200;
    this.ttlMs = options.ttlMs ?? 600_000;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Append a toast to the buffer. Returns the finalized entry (with
   * generated id + timestamp filled in if omitted).
   */
  emit(input: EmitToastInput): ToastEntry {
    const timestamp = input.timestamp ?? this.now();
    const id = input.id ?? `toast-${timestamp}-${++this.idCounter}`;
    const entry: ToastEntry = {
      id,
      message: input.message,
      kind: input.kind,
      timestamp,
    };
    this.entries.push(entry);
    this.evict();
    this.notify();
    return entry;
  }

  /**
   * Mark a previously-emitted toast as dismissed. No-op if the id is
   * unknown. Safe to call multiple times (only the first call sets the
   * timestamp).
   */
  markDismissed(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.dismissedAt !== undefined) return;
    entry.dismissedAt = this.now();
    this.notify();
  }

  /**
   * Return every entry with `timestamp >= sinceMs`, optionally truncated
   * to `limit` most-recent entries. Output is sorted most-recent-first.
   *
   * `sinceMs` is inclusive so callers can use the timestamp from a prior
   * call as the new `sinceMs` without missing entries.
   */
  getSince(sinceMs: number | undefined, limit?: number): ToastEntry[] {
    this.evict();
    const filtered =
      sinceMs === undefined || sinceMs === null
        ? [...this.entries]
        : this.entries.filter((e) => e.timestamp >= sinceMs);
    // Most-recent-first so callers paginating from the tip get the
    // freshest entries even when `limit` truncates.
    filtered.sort((a, b) => b.timestamp - a.timestamp);
    if (limit !== undefined && limit >= 0) {
      return filtered.slice(0, limit);
    }
    return filtered;
  }

  /** Full current buffer, oldest-first. */
  getAll(): ToastEntry[] {
    this.evict();
    return [...this.entries];
  }

  /** Current buffer size (post-eviction). */
  size(): number {
    this.evict();
    return this.entries.length;
  }

  /** Drop all entries. Notifies subscribers. */
  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.notify();
  }

  /** Subscribe to changes; returns an unsubscribe fn. */
  subscribe(callback: ToastSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private evict(): void {
    // TTL eviction
    const cutoff = this.now() - this.ttlMs;
    if (this.entries.length > 0 && this.entries[0].timestamp < cutoff) {
      this.entries = this.entries.filter((e) => e.timestamp >= cutoff);
    }
    // Size eviction (oldest first)
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
  }

  private notify(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = [...this.entries];
    for (const sub of this.subscribers) {
      try {
        sub(snapshot);
      } catch {
        // A buggy subscriber must not break the buffer; swallow.
      }
    }
  }
}

/**
 * Module-wide singleton. The runner side fetches from this instance via the
 * IPC bridge, so every emit within the running app lands in the same buffer.
 */
export const toastBuffer = new ToastRingBuffer();

/**
 * Convenience helper: emit a toast into the global ring buffer.
 *
 * Usage in components that render their own inline status banner (like
 * `DiscoveryPanel.tsx`'s `setStatus`):
 *
 * ```ts
 * import { emitToast } from '@qontinui/ui-bridge';
 * emitToast({ message: `Registered "${app.name}"`, kind: 'success' });
 * ```
 */
export function emitToast(input: EmitToastInput): ToastEntry {
  return toastBuffer.emit(input);
}
