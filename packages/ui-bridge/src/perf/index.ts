/**
 * Shared PerformanceObserver plumbing.
 *
 * One home for the `layout-shift` and `longtask` observers, imported by BOTH
 * the debug captures (`debug/captures/web-vitals.ts`, `long-tasks.ts`) and the
 * change tracker's interaction timeline (`ai/timeline-recorder.ts`), so the two
 * never disagree on what a layout shift is or on whether this webview can see
 * one.
 *
 * Support is PROBED, never assumed. `PerformanceObserver.supportedEntryTypes`
 * is the primary signal: an engine that lists the type supports it, and an
 * engine whose list omits it — WebKitGTK is the expected case — must surface
 * as "could not look", never as a measured zero; the observe helpers return
 * `null` there, and callers turn that into an `unknown` observation
 * (`performance_observer_unsupported`).
 *
 * An engine that has `PerformanceObserver` but no static list at all is
 * handled by TRYING `observe({ type })`: a throw means unsupported. Several
 * engines silently ignore an unknown type instead of throwing, so a
 * try-observed handle reports `probe: 'try-observe'`, and a consumer that saw
 * no entries through it must not read that silence as a confirmed zero.
 */

/** The entry types this module observes. */
export type PerfEntryKind = 'layout-shift' | 'longtask';

/** What this webview's PerformanceObserver can observe. */
export interface PerfEntrySupport {
  /** `layout-shift` is in the static `supportedEntryTypes` list. */
  layoutShift: boolean;
  /** `longtask` is in the static `supportedEntryTypes` list. */
  longTask: boolean;
  /**
   * The raw `PerformanceObserver.supportedEntryTypes` list, or `null` when it
   * could not be read (no `PerformanceObserver`, or an engine predating the
   * static property — the observe helpers then try `observe({ type })`).
   */
  supportedEntryTypes: readonly string[] | null;
  /** Whether a `PerformanceObserver` constructor exists at all. */
  observerAvailable: boolean;
}

/** Read `PerformanceObserver.supportedEntryTypes` now. Never throws. */
export function probePerfEntrySupport(): PerfEntrySupport {
  let types: readonly string[] | null = null;
  let observerAvailable = false;
  try {
    if (typeof PerformanceObserver === 'function') {
      observerAvailable = true;
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
    observerAvailable,
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

/** How a handle's entry-type support was established. */
export type PerfSupportProbe = 'listed' | 'try-observe';

/** A live observer. */
export interface PerfObserverHandle {
  /** `listed`: the static list names the type. `try-observe`: no list; `observe` did not throw. */
  readonly probe: PerfSupportProbe;
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
  listed: boolean,
  support: PerfEntrySupport,
  onEntries: (entries: PerformanceEntry[]) => void,
  buffered: boolean
): PerfObserverHandle | null {
  if (!support.observerAvailable || typeof PerformanceObserver !== 'function') return null;
  // A list that exists and omits the type is a definitive "unsupported".
  if (!listed && support.supportedEntryTypes !== null) return null;
  const probe: PerfSupportProbe = listed ? 'listed' : 'try-observe';
  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => onEntries(list.getEntries()));
    observer.observe({ type, buffered } as PerformanceObserverInit);
  } catch {
    // Refused: the honest reading is "could not look".
    return null;
  }
  let connected = true;
  return {
    probe,
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
 * Observe `layout-shift` entries, one callback per observer batch. Returns
 * `null` when this webview cannot observe them — the caller must report that
 * as unknown, never as zero.
 */
export function observeLayoutShifts(
  onBatch: (samples: LayoutShiftSample[]) => void,
  options: ObservePerfOptions = {}
): PerfObserverHandle | null {
  const support = options.support ?? probePerfEntrySupport();
  return observeEntries(
    'layout-shift',
    support.layoutShift,
    support,
    (entries) => onBatch(entries.map(toLayoutShiftSample)),
    options.buffered ?? false
  );
}

/**
 * Observe `longtask` entries, one callback per observer batch. Returns `null`
 * when this webview cannot observe them — the caller must report that as
 * unknown, never as zero.
 */
export function observeLongTasks(
  onBatch: (samples: LongTaskSample[]) => void,
  options: ObservePerfOptions = {}
): PerfObserverHandle | null {
  const support = options.support ?? probePerfEntrySupport();
  return observeEntries(
    'longtask',
    support.longTask,
    support,
    (entries) => onBatch(entries.map((e) => ({ startTime: e.startTime, duration: e.duration }))),
    options.buffered ?? false
  );
}
