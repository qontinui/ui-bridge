/**
 * UI Bridge Modal/Dialog Stack Detection Module
 *
 * Detects and tracks modal dialogs, overlays, drawers, and other blocking UI
 * by scanning the DOM on demand. Designed for integration with ControlSnapshot.
 */

export { ModalDetector } from './modal-detector';
export type { ModalInfo, ModalStack, SnapshotModalContext, ModalDetectorConfig } from './types';
