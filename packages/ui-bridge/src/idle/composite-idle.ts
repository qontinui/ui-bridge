/**
 * Composite Idle Detector
 *
 * Aggregates multiple IdleSignal detectors into a unified idle status.
 * Individual signals remain first-class — they can be accessed, queried,
 * and waited on independently through getSignal().
 */

import type {
  IdleSignal,
  SignalStatus,
  CompositeIdleStatus,
  CompositeWaitOptions,
  CompositeSignalEntry,
  SelectiveWaitOptions,
  WaitTarget,
  CompositeIdleConfig,
} from './types';
import { NetworkIdleDetector } from './network-idle';
import { DOMSettlingDetector } from './dom-settling';
import { LoadingIndicatorDetector } from './loading-indicators';
import { FormMutationDetector } from './form-mutation';

export type CompositeTransitionCallback = (status: CompositeIdleStatus) => void;

export class CompositeIdleDetector {
  private signals = new Map<string, IdleSignal>();
  private listeners: CompositeTransitionCallback[] = [];
  private lastIdle: boolean | null = null;
  private minIdleScore: number;

  constructor(config?: { minIdleScore?: number }) {
    this.minIdleScore = config?.minIdleScore ?? 0.7;
  }

  /**
   * Create a composite detector with default signals from config.
   */
  static create(config: CompositeIdleConfig = {}): CompositeIdleDetector {
    const detector = new CompositeIdleDetector({ minIdleScore: config.minIdleScore });

    if (config.network?.enabled !== false) {
      detector.addSignal(
        new NetworkIdleDetector({
          weight: config.network?.weight ?? 0.9,
          debounceMs: config.network?.debounceMs,
          ignorePatterns: config.network?.ignorePatterns,
          trackXHR: config.network?.trackXHR,
          tracker: config.network?.tracker,
        })
      );
    }

    if (config.dom?.enabled !== false) {
      detector.addSignal(
        new DOMSettlingDetector({
          weight: config.dom?.weight ?? 0.8,
          settleMs: config.dom?.settleMs,
          root: config.dom?.root,
        })
      );
    }

    if (config.loadingIndicators?.enabled !== false) {
      detector.addSignal(
        new LoadingIndicatorDetector({
          weight: config.loadingIndicators?.weight ?? 0.7,
          additionalSelectors: config.loadingIndicators?.additionalSelectors,
          checkAnimations: config.loadingIndicators?.checkAnimations,
          checkCursor: config.loadingIndicators?.checkCursor,
        })
      );
    }

    if (config.formMutation?.enabled !== false) {
      detector.addSignal(
        new FormMutationDetector({
          weight: config.formMutation?.weight ?? 0.5,
          settleMs: config.formMutation?.settleMs,
        })
      );
    }

    return detector;
  }

  /**
   * Add a signal to the composite. Installs it and subscribes to transitions.
   */
  addSignal(signal: IdleSignal): void {
    this.signals.set(signal.name, signal);
    signal.install();
    signal.onTransition(() => this.evaluate());
  }

  /**
   * Remove a signal by name. Destroys it.
   */
  removeSignal(name: string): boolean {
    const signal = this.signals.get(name);
    if (!signal) return false;
    signal.destroy();
    this.signals.delete(name);
    return true;
  }

  /**
   * Get an individual signal by name for direct access.
   */
  getSignal<T extends IdleSignal = IdleSignal>(name: string): T | undefined {
    return this.signals.get(name) as T | undefined;
  }

  /**
   * List all registered signal names.
   */
  getSignalNames(): string[] {
    return Array.from(this.signals.keys());
  }

  /**
   * Whether the composite considers the app idle.
   */
  isIdle(): boolean {
    return this.getStatus().idle;
  }

  /**
   * Get full composite status including per-signal breakdown.
   */
  getStatus(exclude?: string[]): CompositeIdleStatus {
    const signalEntries: Record<string, CompositeSignalEntry> = {};
    const excludeSet = new Set(exclude ?? []);

    let totalWeight = 0;
    let idleWeight = 0;
    let allCriticalIdle = true;

    for (const [name, signal] of this.signals) {
      if (excludeSet.has(name)) continue;

      const idle = signal.isIdle();
      const status = signal.getStatus();

      signalEntries[name] = {
        name,
        idle,
        weight: signal.weight,
        status,
      };

      totalWeight += signal.weight;
      if (idle) idleWeight += signal.weight;

      // Critical = weight >= 0.8
      if (signal.weight >= 0.8 && !idle) {
        allCriticalIdle = false;
      }
    }

    const idleScore = totalWeight > 0 ? idleWeight / totalWeight : 1;

    return {
      idle: allCriticalIdle && idleScore >= this.minIdleScore,
      idleScore,
      signals: signalEntries,
      timestamp: Date.now(),
    };
  }

  /**
   * Get the status of a single signal by name.
   */
  getSignalStatus(name: string): SignalStatus | undefined {
    return this.signals.get(name)?.getStatus();
  }

  /**
   * Wait for the composite to become idle.
   */
  async waitForIdle(options?: CompositeWaitOptions): Promise<CompositeIdleStatus> {
    const timeout = options?.timeout ?? 30000;
    const minStable = options?.minStableMs ?? 500;
    const exclude = options?.exclude;

    return new Promise<CompositeIdleStatus>((resolve, reject) => {
      const startTime = Date.now();
      let stableSince: number | null = null;

      const check = () => {
        const status = this.getStatus(exclude);

        if (status.idle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }

        if (Date.now() - startTime > timeout) {
          // Include which signals are still busy in the error
          const busySignals = Object.values(status.signals)
            .filter((s) => !s.idle)
            .map((s) => s.name);
          return reject(
            new Error(
              `Idle timeout after ${timeout}ms. ` +
                `Busy signals: ${busySignals.join(', ') || 'none'}. ` +
                `Score: ${status.idleScore.toFixed(2)}`
            )
          );
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  /**
   * Wait for a specific subset of signals to become idle.
   * Targets can be signal names or { indicator: '.selector' } for specific loading indicators.
   */
  async waitFor(
    targets: WaitTarget[],
    options?: SelectiveWaitOptions
  ): Promise<Record<string, SignalStatus>> {
    const timeout = options?.timeout ?? 30000;
    const minStable = options?.minStableMs ?? 0;

    return new Promise<Record<string, SignalStatus>>((resolve, reject) => {
      const startTime = Date.now();
      let stableSince: number | null = null;

      const check = () => {
        let allIdle = true;
        const results: Record<string, SignalStatus> = {};

        for (const target of targets) {
          if (typeof target === 'string') {
            // Signal name
            const signal = this.signals.get(target);
            if (signal) {
              const status = signal.getStatus();
              results[target] = status;
              if (!status.idle) allIdle = false;
            }
          } else {
            // Specific loading indicator selector
            const el = document.querySelector(target.indicator);
            const present = el !== null && this.isElementVisible(el as HTMLElement);
            const key = `indicator:${target.indicator}`;
            results[key] = { idle: !present, timestamp: Date.now() };
            if (present) allIdle = false;
          }
        }

        if (allIdle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(results);
          }
        } else {
          stableSince = null;
        }

        if (Date.now() - startTime > timeout) {
          const busy = Object.entries(results)
            .filter(([, s]) => !s.idle)
            .map(([k]) => k);
          return reject(
            new Error(`Selective wait timeout after ${timeout}ms. Still busy: ${busy.join(', ')}`)
          );
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  /**
   * Wait for a single signal by name.
   */
  async waitForSignal(
    name: string,
    options?: { timeout?: number; minStableMs?: number }
  ): Promise<SignalStatus> {
    const signal = this.signals.get(name);
    if (!signal) {
      throw new Error(`Signal not found: ${name}. Available: ${this.getSignalNames().join(', ')}`);
    }
    return signal.waitForIdle(options);
  }

  /**
   * Subscribe to composite idle/busy transitions.
   */
  onTransition(callback: CompositeTransitionCallback): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Install all signals. Called automatically by addSignal, but can be
   * called explicitly if signals were added without install.
   */
  installAll(): void {
    for (const signal of this.signals.values()) {
      signal.install();
    }
  }

  /**
   * Clean up all signals.
   */
  destroy(): void {
    for (const signal of this.signals.values()) {
      signal.destroy();
    }
    this.signals.clear();
    this.listeners = [];
    this.lastIdle = null;
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  private evaluate(): void {
    const status = this.getStatus();
    if (this.lastIdle !== status.idle) {
      this.lastIdle = status.idle;
      for (const listener of this.listeners) {
        try {
          listener(status);
        } catch {
          // Don't let listener errors break the detector
        }
      }
    }
  }

  private isElementVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
}
