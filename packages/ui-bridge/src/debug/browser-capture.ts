/**
 * Browser Event Capture Orchestrator
 *
 * Single entry point that delegates to focused sub-modules.
 * Replaces the old ConsoleCapture class with unified event capture.
 */

import type {
  AnyCapturedEvent,
  BrowserCaptureConfig,
  BrowserEventType,
  CapturedError,
  OnBrowserEventCallback,
} from './browser-capture-types';
import { DEFAULT_CAPTURE_CONFIG } from './browser-capture-types';
import { installConsoleCapture } from './captures/console';
import { installNetworkCapture } from './captures/network';
import { installNavigationCapture } from './captures/navigation';
import { installLongTaskCapture } from './captures/long-tasks';
import { installResourceErrorCapture } from './captures/resource-errors';
import { installWebVitalsCapture } from './captures/web-vitals';
import { installMemoryCapture } from './captures/memory';
import { installHmrCapture } from './captures/hmr';
import { installLoafCapture } from './captures/long-animation-frames';
import {
  installFrameworkOverlayCapture,
  getActiveOverlays,
  type DetectedErrorOverlay,
} from './captures/framework-overlays';
import { installFreezeDetectorCapture } from './captures/freeze-detector';
import { installDomMetricsCapture } from './captures/dom-metrics';
import { MemoryTrendAnalyzer, type MemoryTrendResult } from './memory-trend';

/**
 * Default capacity for the console-error-style queryable buffer when no
 * maxEntries override is supplied by the caller. Deliberately larger than
 * the legacy 200 so agents making many tool calls between visits don't
 * silently lose errors. Can be overridden via BrowserCaptureConfig.maxEntries
 * or the QONTINUI_UI_BRIDGE_ERROR_BUFFER_CAPACITY env var when running under
 * Node (runners that pre-load this module in the browser should instead call
 * setBufferCapacity()).
 */
export const DEFAULT_BUFFER_CAPACITY = 250;

/** Internal buffer entry — carries a monotonic id alongside the event. */
interface BufferedEntry {
  id: number;
  event: AnyCapturedEvent;
}

/**
 * Cursor response shape for the new {@link BrowserEventCapture.getConsoleRecent}
 * overload. Includes pagination (`nextSinceId`), an eviction counter
 * (`droppedCount`), and the current buffer size (`bufferedCount`).
 */
export interface ConsoleRecentResponse {
  errors: CapturedError[];
  nextSinceId: number;
  droppedCount: number;
  bufferedCount: number;
}

/** Options for the new cursor-based getConsoleRecent overload. */
export interface ConsoleRecentOptions {
  /** Only return entries with id > sinceId. Default 0 (return everything). */
  sinceId?: number;
  /** Max entries to return. Default 250, max 500. */
  limit?: number;
}

/**
 * Resolve the initial buffer capacity for a BrowserEventCapture.
 *
 * Priority:
 *   1. explicit config.maxEntries
 *   2. QONTINUI_UI_BRIDGE_ERROR_BUFFER_CAPACITY env var (Node only — browsers
 *      have no process.env without a bundler shim)
 *   3. DEFAULT_BUFFER_CAPACITY
 */
function resolveInitialCapacity(config: BrowserCaptureConfig): number {
  if (typeof config.maxEntries === 'number' && config.maxEntries > 0) {
    return config.maxEntries;
  }
  const env =
    (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env ?? null;
  const raw = env?.QONTINUI_UI_BRIDGE_ERROR_BUFFER_CAPACITY;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_BUFFER_CAPACITY;
}

export class BrowserEventCapture {
  private buffer: AnyCapturedEvent[] = [];
  /**
   * Parallel entry buffer (event + monotonic id). Kept in lockstep with
   * `buffer` — both are always the same length, with matching indices.
   * Storing id alongside rather than on the event itself avoids mutating
   * the event object (which the capture sub-modules freeze in some cases)
   * and avoids a WeakMap allocation per push.
   */
  private entries: BufferedEntry[] = [];
  /** Monotonic counter — never reset, even on clear(). */
  private nextId = 1;
  /** Running total of entries evicted from the buffer. */
  private droppedCount = 0;
  private maxEntries: number;
  private installed = false;
  private cleanups: (() => void)[] = [];
  private onEvent: OnBrowserEventCallback | null = null;
  private config: BrowserCaptureConfig;
  private memoryTrend: MemoryTrendAnalyzer | null = null;

  constructor(config?: BrowserCaptureConfig) {
    this.config = config ?? {};
    this.maxEntries = resolveInitialCapacity(this.config);
  }

  /**
   * Override the buffer capacity at runtime. Useful when the runner knows
   * a high error rate is expected (e.g. driving a noisy external app) and
   * the env-var path isn't available (browser context).
   *
   * If the new capacity is smaller than the current buffer length, the
   * oldest entries are trimmed immediately and counted in `droppedCount`.
   */
  setBufferCapacity(n: number): void {
    if (!Number.isFinite(n) || n <= 0) return;
    this.maxEntries = Math.floor(n);
    this.trim();
  }

  setOnEvent(cb: OnBrowserEventCallback | null): void {
    this.onEvent = cb;
  }

  /**
   * Install all enabled capture sub-modules.
   * Safe to call multiple times (no-ops if already installed).
   */
  install(): void {
    if (this.installed) return;

    const cfg = { ...DEFAULT_CAPTURE_CONFIG, ...this.config };
    const emit = (event: AnyCapturedEvent) => {
      // Feed memory events to the trend analyzer
      if (event.type === 'memory' && this.memoryTrend) {
        this.memoryTrend.addSnapshot(event.timestamp, event.usedJSHeapSize, event.jsHeapSizeLimit);
      }
      const id = this.nextId++;
      this.buffer.push(event);
      this.entries.push({ id, event });
      this.trim();
      this.onEvent?.(event);
    };

    if (cfg.console) {
      this.cleanups.push(installConsoleCapture(emit));
    }
    if (cfg.network) {
      this.cleanups.push(installNetworkCapture(emit, cfg.networkOptions));
    }
    if (cfg.navigation) {
      this.cleanups.push(installNavigationCapture(emit));
    }
    if (cfg.longTasks) {
      this.cleanups.push(installLongTaskCapture(emit));
    }
    if (cfg.longAnimationFrames) {
      this.cleanups.push(installLoafCapture(emit));
    }
    if (cfg.resourceErrors) {
      this.cleanups.push(installResourceErrorCapture(emit));
    }
    if (cfg.webVitals) {
      this.cleanups.push(installWebVitalsCapture(emit));
    }
    if (cfg.memory) {
      this.memoryTrend = new MemoryTrendAnalyzer();
      this.cleanups.push(installMemoryCapture(emit, cfg.memoryIntervalMs));
    }
    if (cfg.hmr) {
      this.cleanups.push(installHmrCapture(emit));
    }
    if (cfg.frameworkOverlays) {
      this.cleanups.push(installFrameworkOverlayCapture(emit));
    }
    if (cfg.freezeDetector) {
      this.cleanups.push(
        installFreezeDetectorCapture(emit, cfg.freezeIntervalMs, cfg.freezeThresholdMs)
      );
    }
    if (cfg.domMetrics) {
      this.cleanups.push(installDomMetricsCapture(emit, cfg.domMetricsIntervalMs));
    }

    this.installed = true;
  }

  /**
   * Uninstall all capture sub-modules.
   */
  uninstall(): void {
    if (!this.installed) return;
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
    this.installed = false;
  }

  // -------------------------------------------------------------------------
  // Manual event reporting (for events that can't be auto-captured)
  // -------------------------------------------------------------------------

  reportReactError(error: Error, errorInfo: { componentStack?: string }): void {
    const event: AnyCapturedEvent = {
      type: 'react-error',
      timestamp: Date.now(),
      url: typeof window !== 'undefined' ? window.location.href : '',
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    };
    const id = this.nextId++;
    this.buffer.push(event);
    this.entries.push({ id, event });
    this.trim();
    this.onEvent?.(event);
  }

  reportWsStateChange(prev: string, next: string, reconnectAttempt?: number): void {
    // Only emit on actual disconnections
    if (next === 'disconnected' || next === 'error') {
      const event: AnyCapturedEvent = {
        type: 'ws-disconnection',
        timestamp: Date.now(),
        url: typeof window !== 'undefined' ? window.location.href : '',
        previousState: prev,
        newState: next,
        reconnectAttempt,
      };
      const id = this.nextId++;
      this.buffer.push(event);
      this.entries.push({ id, event });
      this.trim();
      this.onEvent?.(event);
    }
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  getSince(ts: number): AnyCapturedEvent[] {
    return this.buffer.filter((e) => e.timestamp >= ts);
  }

  getRecent(n = 50): AnyCapturedEvent[] {
    return this.buffer.slice(-n);
  }

  getByType(type: BrowserEventType): AnyCapturedEvent[] {
    return this.buffer.filter((e) => e.type === type);
  }

  /**
   * Get console errors since a timestamp (backward-compat for ActionExecutor).
   */
  getConsoleSince(ts: number): CapturedError[] {
    return this.buffer
      .filter((e) => (e.type === 'console' || e.type === 'hmr') && e.timestamp >= ts)
      .map((e) => ({
        timestamp: e.timestamp,
        level:
          e.type === 'hmr'
            ? e.level === 'warning'
              ? 'warn'
              : e.level
            : (e as { level: CapturedError['level'] }).level,
        message: (e as { message: string }).message,
        stack: (e as { stack?: string }).stack,
      }));
  }

  /**
   * Cursor-aware recent console error query.
   *
   * New callers should pass an options object to receive the full response
   * shape including `nextSinceId` (for pagination), `droppedCount` (running
   * total of evicted entries), and `bufferedCount` (current buffer size).
   *
   * @example
   *   const first = capture.getConsoleRecent({ limit: 100 });
   *   // … later …
   *   const delta = capture.getConsoleRecent({ sinceId: first.nextSinceId });
   */
  getConsoleRecent(options: ConsoleRecentOptions): ConsoleRecentResponse;
  /**
   * @deprecated Pass `{ limit: n }` instead. Retained for backward
   * compatibility with the legacy signature used by ActionExecutor and
   * direct relay handlers — returns a bare CapturedError[] so callers that
   * spread the result keep working.
   */
  getConsoleRecent(n?: number): CapturedError[];
  getConsoleRecent(arg?: number | ConsoleRecentOptions): CapturedError[] | ConsoleRecentResponse {
    // Legacy signature — no arg or numeric arg → bare CapturedError[].
    if (arg === undefined || typeof arg === 'number') {
      const response = this._getConsoleRecentImpl({ limit: arg ?? 50, sinceId: 0 });
      return response.errors;
    }
    return this._getConsoleRecentImpl(arg);
  }

  private _getConsoleRecentImpl(options: ConsoleRecentOptions): ConsoleRecentResponse {
    const sinceId = typeof options.sinceId === 'number' ? options.sinceId : 0;
    const rawLimit = typeof options.limit === 'number' ? options.limit : 250;
    const limit = Math.min(Math.max(rawLimit, 0), 500);

    // Walk the entry buffer in order, selecting console/hmr entries with
    // id > sinceId. We copy into `matching` first so we can bound by limit
    // and compute nextSinceId from the last returned entry.
    const matching: BufferedEntry[] = [];
    for (const entry of this.entries) {
      if (entry.id <= sinceId) continue;
      const t = entry.event.type;
      if (t !== 'console' && t !== 'hmr') continue;
      matching.push(entry);
    }

    const window = matching.slice(0, limit);
    const errors: CapturedError[] = window.map(({ event }) => ({
      timestamp: event.timestamp,
      level:
        event.type === 'hmr'
          ? (event as { level: string }).level === 'warning'
            ? 'warn'
            : ((event as { level: CapturedError['level'] }).level as CapturedError['level'])
          : (event as { level: CapturedError['level'] }).level,
      message: (event as { message: string }).message,
      stack: (event as { stack?: string }).stack,
    }));

    const nextSinceId = window.length > 0 ? window[window.length - 1].id : sinceId;

    return {
      errors,
      nextSinceId,
      droppedCount: this.droppedCount,
      bufferedCount: this.buffer.length,
    };
  }

  /**
   * Get currently visible framework error overlays (Next.js, Vite, React error boundary).
   * Returns empty array if no overlays are detected.
   */
  getFrameworkOverlays(): DetectedErrorOverlay[] {
    return getActiveOverlays();
  }

  /**
   * Get the latest memory trend analysis, if memory capture is enabled.
   */
  getMemoryTrend(): MemoryTrendResult | null {
    return this.memoryTrend?.getLatestTrend() ?? null;
  }

  clear(): void {
    this.buffer = [];
    this.entries = [];
    // `droppedCount` is intentionally NOT reset — it tracks lifetime
    // evictions, not buffered-entry count. Callers comparing a prior
    // droppedCount against a post-clear droppedCount correctly see no
    // new drops. `nextId` is likewise preserved so sinceId cursors don't
    // alias with post-clear ids.
  }

  private trim(): void {
    if (this.buffer.length > this.maxEntries) {
      const overflow = this.buffer.length - this.maxEntries;
      this.buffer = this.buffer.slice(-this.maxEntries);
      this.entries = this.entries.slice(-this.maxEntries);
      this.droppedCount += overflow;
    }
  }
}
