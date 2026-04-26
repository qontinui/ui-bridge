import type { NativeModalInfo, NativeSnapshotModalContext } from '../core/types';

export interface ModalPushInput {
  id: string;
  title?: string;
  type?: NativeModalInfo['type'];
  blocking?: boolean;
  dismissible?: boolean;
}

/**
 * Declarative modal store. Components/hooks call pushModal/dismissModal directly
 * — there is no DOM/tree scanner. The detector is the single source of truth for
 * the snapshot's modalStack context.
 */
export class ModalDetector {
  /** Map preserves O(1) idempotent replace by id; ordering comes from detectedAt. */
  private modals = new Map<string, NativeModalInfo>();

  pushModal(modal: ModalPushInput): void {
    const existing = this.modals.get(modal.id);
    const detectedAt = existing ? existing.detectedAt : Date.now();
    const next: NativeModalInfo = {
      id: modal.id,
      title: modal.title,
      type: modal.type ?? 'modal',
      blocking: modal.blocking ?? true,
      dismissible: modal.dismissible ?? true,
      detectedAt,
    };
    this.modals.set(modal.id, next);
  }

  dismissModal(id: string): void {
    this.modals.delete(id);
  }

  getSnapshotModalContext(): NativeSnapshotModalContext {
    const active = this.getActive();
    const ctx: NativeSnapshotModalContext = {
      modals: active,
      hasBlockingModal: active.some((m) => m.blocking),
      count: active.length,
    };
    if (active.length > 0) {
      ctx.topModal = active[active.length - 1];
    }
    return ctx;
  }

  getActive(): NativeModalInfo[] {
    return Array.from(this.modals.values()).sort((a, b) => a.detectedAt - b.detectedAt);
  }

  clear(): void {
    this.modals.clear();
  }
}
