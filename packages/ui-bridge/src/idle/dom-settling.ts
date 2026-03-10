/**
 * DOM Mutation Settling Detector
 *
 * Tracks DOM mutations via MutationObserver and reports "settled" when
 * no mutations have occurred for `settleMs`.
 */

import type {
  IdleSignal,
  DOMSignalStatus,
  DOMSettlingConfig,
  SignalWaitOptions,
  SignalTransitionCallback,
} from './types';

export class DOMSettlingDetector implements IdleSignal<DOMSignalStatus> {
  readonly name = 'dom';
  readonly weight: number;

  private observer: MutationObserver | null = null;
  private settleMs: number;
  private root: HTMLElement | undefined;
  private lastMutationAt = 0;
  private recentMutations: number[] = []; // timestamps of recent mutations
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private _isSettled = true;
  private listeners: Array<SignalTransitionCallback<DOMSignalStatus>> = [];
  private installed = false;

  constructor(config: DOMSettlingConfig & { weight?: number } = {}) {
    this.weight = config.weight ?? 0.8;
    this.settleMs = config.settleMs ?? 300;
    this.root = config.root;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    const root = this.root ?? document.body;

    this.observer = new MutationObserver((mutations) => {
      const now = Date.now();
      this.lastMutationAt = now;

      // Track mutation count (keep 1s window)
      this.recentMutations.push(now);
      const cutoff = now - 1000;
      this.recentMutations = this.recentMutations.filter((t) => t >= cutoff);

      // Count meaningful mutations (skip trivial single-text changes)
      let meaningfulCount = 0;
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          meaningfulCount++;
        } else if (m.type === 'attributes') {
          meaningfulCount++;
        }
      }

      if (meaningfulCount === 0) return;

      // Transition to mutating
      if (this._isSettled) {
        this._isSettled = false;
        this.notifyTransition();
      }

      // Reset settle timer
      this.resetSettleTimer();
    });

    this.observer.observe(root, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });
  }

  destroy(): void {
    if (!this.installed) return;
    this.installed = false;

    this.observer?.disconnect();
    this.observer = null;

    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }

    this.listeners = [];
  }

  isIdle(): boolean {
    return this._isSettled;
  }

  getStatus(): DOMSignalStatus {
    const now = Date.now();
    const cutoff = now - 1000;
    const recentCount = this.recentMutations.filter((t) => t >= cutoff).length;

    return {
      idle: this._isSettled,
      settled: this._isSettled,
      lastMutationAt: this.lastMutationAt,
      msSinceLastMutation: this.lastMutationAt > 0 ? now - this.lastMutationAt : now,
      recentMutationCount: recentCount,
      timestamp: now,
    };
  }

  async waitForIdle(options?: SignalWaitOptions): Promise<DOMSignalStatus> {
    const timeout = options?.timeout ?? 30000;
    const minStable = options?.minStableMs ?? 0;

    return new Promise<DOMSignalStatus>((resolve, reject) => {
      const startTime = Date.now();
      let stableSince: number | null = null;

      const check = () => {
        const status = this.getStatus();

        if (status.settled) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }

        if (Date.now() - startTime > timeout) {
          return reject(
            new Error(
              `DOM settling timeout after ${timeout}ms. ` +
                `Last mutation ${status.msSinceLastMutation}ms ago.`
            )
          );
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  onTransition(callback: SignalTransitionCallback<DOMSignalStatus>): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  private resetSettleTimer(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);

    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (!this._isSettled) {
        this._isSettled = true;
        this.notifyTransition();
      }
    }, this.settleMs);
  }

  private notifyTransition(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(this._isSettled, status);
      } catch {
        // Don't let listener errors break the detector
      }
    }
  }
}
