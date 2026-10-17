/**
 * Shared PerformanceObserver plumbing.
 *
 * One home for the `layout-shift` and `longtask` observers, imported by BOTH
 * the debug captures (`debug/captures/web-vitals.ts`, `long-tasks.ts`) and the
 * change tracker's interaction timeline (`ai/timeline-recorder.ts`), so the two
 * never disagree on what a layout shift is or on whether this webview can see
 * one.
 *
 * Support is PROBED, never assumed: `PerformanceObserver.supportedEntryTypes`
 * is the only reliable signal (several engines silently ignore an unknown
 * `observe({ type })` rather than throwing), and an engine without the entry
 * type — WebKitGTK is the expected case — must surface as "could not look",
 * never as a measured zero. The observe helpers therefore return `null` when
 * the type is unsupported, and callers turn that `null` into an `unknown`
 * observation (`performance_observer_unsupported`).
 */

/** The entry types this module observes. */
export type PerfEntryKind = 'layout-shift' | 'longtask';

/** What this webview's PerformanceObserver can observe. */
export interface PerfEntrySupport {
  /** `layout-shift` entries are supported. */
  layoutShift: boolean;
  /** `longtask` entries are supported. */
  longTask: boolean;
  /**
   * The raw `PerformanceObserver.supportedEntryTypes` list, or `null` when it
   * could not be read (no `PerformanceObserver`, or an engine predating the
   * static property — in which case nothing is reported as supported).
   */
  supportedEntryTypes: readonly string[] | null;
}

/** Read `PerformanceObserver.supportedEntryTypes` now. Never throws. */
export function probePerfEntrySupport(): PerfEntrySupport {
  let types: readonly string[] | null = null;
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      const raw = (PerformanceObserver as unknown as { supportedEntryTypes?: unknown })
        .supportedEntryTypes;
      if (Array.isArray(raw) && raw.every((t) => typeof t === 'string')) {
        types = [...(raw as string[])];
      }
    }
  } catch {
    types = null;
  }
  return {
    layoutShift: types !== null && types.includes('layout-shift'),
    longTask: types !== null && types.includes('longtask'),
    supportedEntryTypes: types,
  };
}

/** One source node of a layout shift (the Layout Instability API's `LayoutShiftAttribution`). */
export interface LayoutShiftSource {
  /** The shifted node; `null` when it has since been removed from the document. */
  node: Node | null;
}

/** One `layout-shift` entry, reduced to what consumers read. */
export interface LayoutShiftSample {
  /** `performance.now()`-clock time of the shift. */
  startTime: number;
  /** The shift score. */
  value: number;
  /** Whether the shift followed recent discrete user input (the browser's own flag). */
  hadRecentInput: boolean;
  sources: LayoutShiftSource[];
}

/** One `longtask` entry, reduced to what consumers read. */
export interface LongTaskSample {
  /** `performance.now()`-clock time the task started. */
  startTime: number;
  /** Task duration (ms). */
  duration: number;
}

/** A live observer. */
export interface PerfObserverHandle {
  /** Deliver any entries the browser has queued but not yet dispatched. */
  flush(): void;
  /** Stop observing. Idempotent. */
  disconnect(): void;
}

export interface ObservePerfOptions {
  /** Replay entries recorded before the observer was installed. Default `false`. */
  buffered?: boolean;
  /** Support as already probed; probed now when omitted. */
  support?: PerfEntrySupport;
}

function toLayoutShiftSample(entry: PerformanceEntry): LayoutShiftSample {
  const e = entry as PerformanceEntry & {
    value?: number;
    hadRecentInput?: boolean;
    sources?: ReadonlyArray<{ node?: Node | null }>;
  };
  return {
    startTime: e.startTime,
    value: typeof e.value === 'number' && Number.isFinite(e.value) ? e.value : 0,
    hadRecentInput: e.hadRecentInput === true,
    sources: Array.isArray(e.sources) ? e.sources.map((s) => ({ node: s?.node ?? null })) : [],
  };
}

function observeEntries(
  type: PerfEntryKind,
  supported: boolean,
  onEntries: (entries: PerformanceEntry[]) => void,
  buffered: boolean
): PerfObserverHandle | null {
  if (!supported || typeof PerformanceObserver === 'undefined') return null;
  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => onEntries(list.getEntries()));
    observer.observe({ type, buffered } as PerformanceObserverInit);
  } catch {
    // Advertised but refused: the honest reading is still "could not look".
    return null;
  }
  let connected = true;
  return {
    flush() {
      if (!connected) return;
      try {
        const pending = observer.takeRecords?.() ?? [];
        if (pending.length > 0) onEntries(pending);
      } catch {
        // takeRecords unsupported — queued entries arrive via the callback.
      }
    },
    disconnect() {
      if (!connected) return;
      connected = false;
      observer.disconnect();
    },
  };
}

/**
 * Observe `layout-shift` entries. Returns `null` when this webview cannot
 * observe them — the caller must report that as unknown, never as zero.
 */
export function observeLayoutShifts(
  onSample: (sample: LayoutShiftSample) => void,
  options: ObservePerfOptions = {}
): PerfObserverHandle | null {
  const support = options.support ?? probePerfEntrySupport();
  return observeEntries(
    'layout-shift',
    support.layoutShift,
    (entries) => entries.forEach((e) => onSample(toLayoutShiftSample(e))),
    options.buffered ?? false
  );
}

/**
 * Observe `longtask` entries. Returns `null` when this webview cannot observe
 * them — the caller must report that as unknown, never as zero.
 */
export function observeLongTasks(
  onSample: (sample: LongTaskSample) => void,
  options: ObservePerfOptions = {}
): PerfObserverHandle | null {
  const support = options.support ?? probePerfEntrySupport();
  return observeEntries(
    'longtask',
    support.longTask,
    (entries) => entries.forEach((e) => onSample({ startTime: e.startTime, duration: e.duration })),
    options.buffered ?? false
  );
}
