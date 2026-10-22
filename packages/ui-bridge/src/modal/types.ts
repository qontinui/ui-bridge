/**
 * Modal/Dialog Stack Types
 *
 * Types for detecting and tracking modal dialogs, overlays, and blocking UI.
 */

/**
 * Information about a detected modal/dialog
 */
export interface ModalInfo {
  /**
   * Identifier: the element's DOM id, else its `data-testid`, else a generated
   * `modal-N`. Ambiguous by construction; match on `domId` / `testId` /
   * `bridgeId` when the KIND of identity matters.
   */
  id: string;
  /** The element's real DOM `id`, when it has one. */
  domId?: string;
  /** The element's `data-testid`, when it has one. */
  testId?: string;
  /**
   * The modal element's `data-ui-bridge-id`, when it has one: the name an
   * occlusion report gives a registered occluder. Lets `/control/visibility`
   * recognise a registered modal whose registry id differs from its DOM id.
   */
  bridgeId?: string;
  /** Dialog title text, if detectable */
  title?: string;
  /** Type of modal */
  type: 'dialog' | 'alertdialog' | 'modal' | 'drawer' | 'popover' | 'sheet';
  /** Whether this modal blocks interaction with content behind it */
  blocking: boolean;
  /**
   * WHY `blocking` is true. `element`: `isBlockingDialog` accepts the element
   * itself (an `alertdialog`; `aria-modal="true"` on a `role=dialog`,
   * `role=alertdialog` or `<dialog>`; or a `<dialog>` matching `:modal`) — the
   * same predicate the registry's occlusion hit-test names a dialog by.
   * `backdrop`: only the backdrop heuristic, a class substring
   * (`backdrop`/`overlay`/`mask`) on a neighbour, which also fires on
   * non-modal UI. Absent when not blocking, and absent from page SDKs older
   * than the field. Only `element` makes an occlusion an expected overlay in
   * `/control/visibility`.
   */
  blockingSource?: 'element' | 'backdrop';
  /** Computed z-index of the modal */
  zIndex: number;
  /** Whether a backdrop/overlay is present */
  hasBackdrop: boolean;
  /** CSS selector for the close button, if found */
  closeButton?: string;
  /** Text of the primary action button, if found */
  primaryAction?: string;
  /** Whether ESC key dismisses this modal */
  escDismiss: boolean;
  /** ARIA role */
  role?: string;
  /** ARIA label or labelledby text */
  ariaLabel?: string;
  /** Timestamp when detected */
  detectedAt: number;
  /** CSS selector that can target this modal */
  selector: string;
}

/**
 * Stack of active modals with analysis
 */
export interface ModalStack {
  /** Active modals ordered by z-index (topmost last) */
  modals: ModalInfo[];
  /** The topmost modal, if any */
  topModal?: ModalInfo;
  /** Whether any blocking modal is present */
  hasBlockingModal: boolean;
  /** Count of active modals */
  count: number;
  /** Timestamp of snapshot */
  timestamp: number;
}

/**
 * Snapshot context for ControlSnapshot integration
 */
export interface SnapshotModalContext {
  /** Active modals ordered by z-index */
  modals: ModalInfo[];
  /** Topmost modal info */
  topModal?: ModalInfo;
  /** Whether a blocking modal is present */
  hasBlockingModal: boolean;
  /** Number of active modals */
  count: number;
}

/**
 * Configuration for modal detection
 */
export interface ModalDetectorConfig {
  /** Additional CSS selectors to check for modals */
  customSelectors?: string[];
  /** Whether to detect backdrop elements (default: true) */
  detectBackdrop?: boolean;
  /** Whether to detect close buttons (default: true) */
  detectCloseButton?: boolean;
  /** Whether to detect primary actions (default: true) */
  detectPrimaryAction?: boolean;
}
