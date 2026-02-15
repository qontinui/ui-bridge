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

export class BrowserEventCapture {
  private buffer: AnyCapturedEvent[] = [];
  private maxEntries: number;
  private installed = false;
  private cleanups: (() => void)[] = [];
  private onEvent: OnBrowserEventCallback | null = null;
  private config: BrowserCaptureConfig;

  constructor(config?: BrowserCaptureConfig) {
    this.config = config ?? {};
    this.maxEntries = config?.maxEntries ?? DEFAULT_CAPTURE_CONFIG.maxEntries;
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
      this.buffer.push(event);
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
    if (cfg.resourceErrors) {
      this.cleanups.push(installResourceErrorCapture(emit));
    }
    if (cfg.webVitals) {
      this.cleanups.push(installWebVitalsCapture(emit));
    }
    if (cfg.memory) {
      this.cleanups.push(installMemoryCapture(emit, cfg.memoryIntervalMs));
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
    this.buffer.push(event);
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
      this.buffer.push(event);
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
      .filter((e) => e.type === 'console' && e.timestamp >= ts)
      .map((e) => ({
        timestamp: e.timestamp,
        level: (e as { level: CapturedError['level'] }).level,
        message: (e as { message: string }).message,
        stack: (e as { stack?: string }).stack,
      }));
  }

  /**
   * Get recent console errors (backward-compat for ActionExecutor).
   */
  getConsoleRecent(n = 50): CapturedError[] {
    return this.buffer
      .filter((e) => e.type === 'console')
      .slice(-n)
      .map((e) => ({
        timestamp: e.timestamp,
        level: (e as { level: CapturedError['level'] }).level,
        message: (e as { message: string }).message,
        stack: (e as { stack?: string }).stack,
      }));
  }

  clear(): void {
    this.buffer = [];
  }

  private trim(): void {
    if (this.buffer.length > this.maxEntries) {
      this.buffer = this.buffer.slice(-this.maxEntries);
    }
  }
}
