/**
 * Form Mutation Detector
 *
 * Tracks form field changes (input, change, focusin/focusout events) and
 * reports "settled" when no form mutations have occurred for `settleMs`.
 *
 * Lower weight (0.5) than network/DOM signals since form mutations are
 * user-driven and shouldn't block idle determination for network operations.
 */

import type {
  IdleSignal,
  FormMutationSignalStatus,
  FormMutationConfig,
  SignalWaitOptions,
  SignalTransitionCallback,
} from './types';

export class FormMutationDetector implements IdleSignal<FormMutationSignalStatus> {
  readonly name = 'form-mutation';
  readonly weight: number;

  private settleMs: number;
  private lastMutationAt = 0;
  private recentMutations: number[] = [];
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private _isSettled = true;
  private activeFieldId: string | undefined;
  private listeners: Array<SignalTransitionCallback<FormMutationSignalStatus>> = [];
  private installed = false;

  // Bound handlers for cleanup
  private handleInput: (e: Event) => void;
  private handleChange: (e: Event) => void;
  private handleFocusIn: (e: FocusEvent) => void;
  private handleFocusOut: (e: FocusEvent) => void;

  constructor(config: FormMutationConfig & { weight?: number } = {}) {
    this.weight = config.weight ?? 0.5;
    this.settleMs = config.settleMs ?? 800;

    // Bind handlers
    this.handleInput = this.onFormEvent.bind(this);
    this.handleChange = this.onFormEvent.bind(this);
    this.handleFocusIn = this.onFocusIn.bind(this);
    this.handleFocusOut = this.onFocusOut.bind(this);
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    // Use event delegation on document for all form events
    document.addEventListener('input', this.handleInput, true);
    document.addEventListener('change', this.handleChange, true);
    document.addEventListener('focusin', this.handleFocusIn, true);
    document.addEventListener('focusout', this.handleFocusOut, true);
  }

  destroy(): void {
    if (!this.installed) return;
    this.installed = false;

    document.removeEventListener('input', this.handleInput, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('focusin', this.handleFocusIn, true);
    document.removeEventListener('focusout', this.handleFocusOut, true);

    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }

    this.listeners = [];
  }

  isIdle(): boolean {
    return this._isSettled;
  }

  getStatus(): FormMutationSignalStatus {
    const now = Date.now();
    const cutoff = now - 1000;
    const recentCount = this.recentMutations.filter((t) => t >= cutoff).length;

    return {
      idle: this._isSettled,
      settled: this._isSettled,
      lastMutationAt: this.lastMutationAt,
      msSinceLastMutation: this.lastMutationAt > 0 ? now - this.lastMutationAt : now,
      recentMutationCount: recentCount,
      activeFieldId: this.activeFieldId,
      timestamp: now,
    };
  }

  async waitForIdle(options?: SignalWaitOptions): Promise<FormMutationSignalStatus> {
    const timeout = options?.timeout ?? 30000;
    const minStable = options?.minStableMs ?? 0;

    return new Promise<FormMutationSignalStatus>((resolve, reject) => {
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
              `Form mutation settling timeout after ${timeout}ms. ` +
                `Last mutation ${status.msSinceLastMutation}ms ago.`
            )
          );
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  onTransition(callback: SignalTransitionCallback<FormMutationSignalStatus>): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  private isFormElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    );
  }

  private onFormEvent(e: Event): void {
    if (!this.isFormElement(e.target)) return;

    const now = Date.now();
    this.lastMutationAt = now;

    // Track mutation count (1s window)
    this.recentMutations.push(now);
    const cutoff = now - 1000;
    this.recentMutations = this.recentMutations.filter((t) => t >= cutoff);

    // Transition to mutating
    if (this._isSettled) {
      this._isSettled = false;
      this.notifyTransition();
    }

    this.resetSettleTimer();
  }

  private onFocusIn(e: FocusEvent): void {
    if (!this.isFormElement(e.target)) return;
    const el = e.target as HTMLElement;
    this.activeFieldId = el.id || el.getAttribute('name') || undefined;
  }

  private onFocusOut(e: FocusEvent): void {
    if (!this.isFormElement(e.target)) return;
    this.activeFieldId = undefined;
  }

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
