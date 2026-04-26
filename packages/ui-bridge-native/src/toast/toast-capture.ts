import type { NativeCapturedToast, NativeSnapshotToastContext } from '../core/types';

export interface ToastRecordInput {
  id: string;
  message: string;
  level?: NativeCapturedToast['level'];
  appearedAt?: number;
}

export interface ToastCaptureConfig {
  maxRecent?: number;
}

const DEFAULT_MAX_RECENT = 50;

/**
 * Declarative toast/snackbar tracker. Components call recordToast/dismissToast
 * directly — there is no DOM/tree scanner. The active map plus a fixed-size
 * recent ring buffer feed the snapshot's toasts context.
 */
export class ToastCapture {
  private active = new Map<string, NativeCapturedToast>();
  private recent: NativeCapturedToast[] = [];
  private totalCaptured = 0;
  private maxRecent: number;

  constructor(config: ToastCaptureConfig = {}) {
    this.maxRecent = config.maxRecent ?? DEFAULT_MAX_RECENT;
  }

  recordToast(toast: ToastRecordInput): void {
    if (this.active.has(toast.id)) {
      return;
    }
    const appearedAt = toast.appearedAt ?? Date.now();
    const entry: NativeCapturedToast = {
      id: toast.id,
      message: toast.message,
      level: toast.level ?? 'info',
      appearedAt,
      visible: true,
      durationMs: 0,
    };
    this.active.set(toast.id, entry);
    this.totalCaptured += 1;
  }

  dismissToast(id: string): void {
    const entry = this.active.get(id);
    if (!entry) {
      return;
    }
    this.active.delete(id);
    const dismissedAt = Date.now();
    const dismissed: NativeCapturedToast = {
      ...entry,
      dismissedAt,
      visible: false,
      durationMs: dismissedAt - entry.appearedAt,
    };
    this.recent.push(dismissed);
    if (this.recent.length > this.maxRecent) {
      this.recent.shift();
    }
  }

  getSnapshotToastContext(): NativeSnapshotToastContext {
    const now = Date.now();
    const active = Array.from(this.active.values()).map((entry) => ({
      ...entry,
      durationMs: now - entry.appearedAt,
    }));
    return {
      active,
      recent: [...this.recent],
      totalCaptured: this.totalCaptured,
    };
  }

  clear(): void {
    this.active.clear();
    this.recent = [];
    this.totalCaptured = 0;
  }
}
