/**
 * Modal/Dialog Stack Detector
 *
 * Scans the DOM on demand for active modal dialogs, overlays, drawers, and
 * other blocking UI patterns. Supports native HTML dialogs, ARIA roles, and
 * popular component libraries (MUI, Ant Design, Bootstrap, Chakra, Radix,
 * Headless UI).
 *
 * This is a stateless detector — no MutationObserver or install/uninstall
 * lifecycle. It queries the DOM each time `detect()` is called.
 */

import type { ModalInfo, ModalStack, SnapshotModalContext, ModalDetectorConfig } from './types';
import { classString } from '../core/class-name';
import { readAriaLabelAttr, readAriaLabelledbyAttr } from '../core/a11y';

// ---------------------------------------------------------------------------
// Default selectors for common modal patterns
// ---------------------------------------------------------------------------

/** Native and ARIA modal selectors */
const NATIVE_SELECTORS = [
  'dialog[open]',
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"]',
];

/** Popular component library selectors */
const LIBRARY_SELECTORS = [
  // MUI
  '.MuiDialog-root',
  '.MuiDrawer-root',
  // Ant Design
  '.ant-modal-wrap:not(.ant-modal-wrap-hidden)',
  // Bootstrap
  '.modal.show',
  '.modal.fade.show',
  // Chakra UI
  '.chakra-modal__overlay',
  // Radix / shadcn
  '[data-radix-dialog-overlay]',
  '[data-state="open"][role="dialog"]',
  // Headless UI
  '[data-headlessui-state~="open"]',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether we're in a browser with a DOM */
function hasDom(): boolean {
  return typeof document !== 'undefined';
}

/**
 * Parse a computed z-index value to a number.
 * Returns 0 for 'auto' or non-numeric values.
 */
function parseZIndex(value: string): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Build a CSS selector that can uniquely target `el`.
 * Prefers #id, falls back to tag + nth-of-type.
 */
function buildSelector(el: Element): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  // Use data-testid if available
  const testId = el.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  // Fall back to role + tag + nth-of-type
  const role = el.getAttribute('role');
  const tag = el.tagName.toLowerCase();

  if (role) {
    const siblings = Array.from(document.querySelectorAll(`${tag}[role="${role}"]`));
    if (siblings.length === 1) {
      return `${tag}[role="${CSS.escape(role)}"]`;
    }
    const index = siblings.indexOf(el);
    return `${tag}[role="${CSS.escape(role)}"]:nth-of-type(${index + 1})`;
  }

  // Plain tag with nth-of-type
  const parent = el.parentElement;
  if (parent) {
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (sameTag.length === 1) {
      return tag;
    }
    const idx = sameTag.indexOf(el);
    return `${tag}:nth-of-type(${idx + 1})`;
  }

  return tag;
}

/**
 * Find title text for a modal element.
 * Checks aria-label, aria-labelledby, and heading elements inside.
 */
function extractTitle(el: Element): string | undefined {
  // aria-label
  const ariaLabel = readAriaLabelAttr(el);
  if (ariaLabel) return ariaLabel;

  // aria-labelledby → resolve to element text
  const labelledBy = readAriaLabelledbyAttr(el);
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent) {
      return labelEl.textContent.trim();
    }
  }

  // First heading inside the modal
  const heading = el.querySelector('h1, h2, h3, [class*="title"], [class*="header"]');
  if (heading?.textContent) {
    return heading.textContent.trim();
  }

  return undefined;
}

/**
 * Resolve aria-label text: direct attribute or via aria-labelledby.
 */
function resolveAriaLabel(el: Element): string | undefined {
  const direct = readAriaLabelAttr(el);
  if (direct) return direct;

  const labelledBy = readAriaLabelledbyAttr(el);
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent) {
      return labelEl.textContent.trim();
    }
  }

  return undefined;
}

/**
 * Determine the modal type from element attributes and class names.
 */
function resolveType(el: Element): ModalInfo['type'] {
  const role = el.getAttribute('role');

  if (role === 'alertdialog') return 'alertdialog';

  const lower = classString(el).toLowerCase();
  if (lower) {
    if (lower.includes('drawer')) return 'drawer';
    if (lower.includes('sheet')) return 'sheet';
    if (lower.includes('popover')) return 'popover';
  }

  // Check data attributes for Radix/Headless UI variants
  if (el.hasAttribute('data-radix-dialog-overlay')) return 'modal';

  if (role === 'dialog') return 'dialog';

  // Native <dialog> element
  if (el.tagName === 'DIALOG') return 'dialog';

  return 'modal';
}

/**
 * Detect whether a backdrop/overlay is present for the given modal element.
 */
function detectBackdrop(el: Element): boolean {
  // Check previous sibling (common pattern: overlay sibling before modal content)
  const prevSibling = el.previousElementSibling;
  if (prevSibling) {
    const lower = classString(prevSibling).toLowerCase();
    if (lower.includes('backdrop') || lower.includes('overlay') || lower.includes('mask')) {
      return true;
    }
    // Radix overlay attribute
    if (prevSibling.hasAttribute('data-radix-dialog-overlay')) {
      return true;
    }
  }

  // Check parent for backdrop/overlay class
  const parent = el.parentElement;
  if (parent) {
    const lower = classString(parent).toLowerCase();
    if (lower.includes('backdrop') || lower.includes('overlay') || lower.includes('mask')) {
      return true;
    }
  }

  // Check for child overlay (e.g., Chakra modal__overlay)
  if (
    el.classList.contains('chakra-modal__overlay') ||
    el.hasAttribute('data-radix-dialog-overlay')
  ) {
    return true;
  }

  // Native <dialog> elements with ::backdrop
  if (el.tagName === 'DIALOG') {
    return true;
  }

  // Check for aria-modal (typically has a backdrop)
  if (el.getAttribute('aria-modal') === 'true') {
    return true;
  }

  return false;
}

/**
 * Find a close button inside the modal element.
 * Returns a CSS selector for the button if found.
 */
function findCloseButton(el: Element): string | undefined {
  // Button with aria-label containing "close" or "dismiss"
  const ariaClose = el.querySelector(
    'button[aria-label*="close" i], button[aria-label*="Close"], ' +
      'button[aria-label*="dismiss" i], button[aria-label*="Dismiss"]'
  );
  if (ariaClose) {
    return buildSelector(ariaClose);
  }

  // Button containing × or ✕ character
  const buttons = Array.from(el.querySelectorAll('button'));
  for (const btn of buttons) {
    const text = btn.textContent?.trim() ?? '';
    if (text === '×' || text === '✕' || text === '✖' || text === 'X' || text === 'x') {
      return buildSelector(btn);
    }
  }

  return undefined;
}

/**
 * Find the primary action button inside the modal element.
 * Returns the button text if found.
 */
function findPrimaryAction(el: Element): string | undefined {
  // submit button
  const submit = el.querySelector('button[type="submit"]');
  if (submit?.textContent) {
    return submit.textContent.trim();
  }

  // Button with primary class
  const primary = el.querySelector(
    'button.primary, button.btn-primary, button[class*="primary" i]'
  );
  if (primary?.textContent) {
    return primary.textContent.trim();
  }

  // Last button in a footer-like element
  const footer = el.querySelector(
    'footer, [class*="footer" i], [class*="actions" i], [class*="buttons" i]'
  );
  if (footer) {
    const footerButtons = footer.querySelectorAll('button');
    if (footerButtons.length > 0) {
      const lastBtn = footerButtons[footerButtons.length - 1];
      if (lastBtn.textContent) {
        return lastBtn.textContent.trim();
      }
    }
  }

  return undefined;
}

/**
 * Determine if ESC key likely dismisses this modal.
 */
function isEscDismissable(el: Element): boolean {
  // Native <dialog> elements are ESC-dismissable by default
  if (el.tagName === 'DIALOG') return true;

  // aria-modal dialogs are typically ESC-dismissable
  if (el.getAttribute('aria-modal') === 'true') return true;

  // Alert dialogs are typically NOT ESC-dismissable (require explicit action)
  if (el.getAttribute('role') === 'alertdialog') return false;

  return false;
}

/**
 * Determine if this modal blocks interaction with content behind it.
 */
function isBlocking(el: Element, hasBackdropEl: boolean): boolean {
  if (el.getAttribute('role') === 'alertdialog') return true;
  if (el.getAttribute('aria-modal') === 'true') return true;
  if (hasBackdropEl) return true;

  // Native <dialog> opened via showModal() has aria-modal behavior
  if (el.tagName === 'DIALOG') return true;

  return false;
}

/**
 * Generate an id for a modal element.
 */
function generateId(el: Element, index: number): string {
  if (el.id) return el.id;

  const testId = el.getAttribute('data-testid');
  if (testId) return testId;

  return `modal-${index}`;
}

// ---------------------------------------------------------------------------
// ModalDetector
// ---------------------------------------------------------------------------

export class ModalDetector {
  private readonly config: Required<
    Pick<ModalDetectorConfig, 'detectBackdrop' | 'detectCloseButton' | 'detectPrimaryAction'>
  > & { customSelectors: string[] };

  constructor(config: ModalDetectorConfig = {}) {
    this.config = {
      customSelectors: config.customSelectors ?? [],
      detectBackdrop: config.detectBackdrop ?? true,
      detectCloseButton: config.detectCloseButton ?? true,
      detectPrimaryAction: config.detectPrimaryAction ?? true,
    };
  }

  /**
   * Scan the DOM for active modals and return the current stack.
   */
  detect(): ModalStack {
    const now = Date.now();

    if (!hasDom()) {
      return {
        modals: [],
        topModal: undefined,
        hasBlockingModal: false,
        count: 0,
        timestamp: now,
      };
    }

    // Collect all selectors
    const allSelectors = [
      ...NATIVE_SELECTORS,
      ...LIBRARY_SELECTORS,
      ...this.config.customSelectors,
    ];

    // Query all matching elements, deduplicating
    const seen = new Set<Element>();
    const elements: Element[] = [];

    for (const selector of allSelectors) {
      try {
        const matches = Array.from(document.querySelectorAll(selector));
        for (const el of matches) {
          if (!seen.has(el)) {
            seen.add(el);
            elements.push(el);
          }
        }
      } catch {
        // Invalid selector — skip silently
      }
    }

    // Build ModalInfo for each element
    let modalIndex = 0;
    const modals: ModalInfo[] = elements.map((el) => {
      const hasBackdropEl = this.config.detectBackdrop ? detectBackdrop(el) : false;

      const info: ModalInfo = {
        id: generateId(el, modalIndex),
        title: extractTitle(el),
        type: resolveType(el),
        blocking: isBlocking(el, hasBackdropEl),
        zIndex: parseZIndex(window.getComputedStyle(el).zIndex),
        hasBackdrop: hasBackdropEl,
        closeButton: this.config.detectCloseButton ? findCloseButton(el) : undefined,
        primaryAction: this.config.detectPrimaryAction ? findPrimaryAction(el) : undefined,
        escDismiss: isEscDismissable(el),
        role: el.getAttribute('role') ?? undefined,
        ariaLabel: resolveAriaLabel(el),
        detectedAt: now,
        selector: buildSelector(el),
      };

      modalIndex++;
      return info;
    });

    // Sort by z-index ascending (topmost last)
    modals.sort((a, b) => a.zIndex - b.zIndex);

    const topModal = modals.length > 0 ? modals[modals.length - 1] : undefined;
    const hasBlockingModal = modals.some((m) => m.blocking);

    return {
      modals,
      topModal,
      hasBlockingModal,
      count: modals.length,
      timestamp: now,
    };
  }

  /**
   * Get the snapshot context shape for ControlSnapshot integration.
   */
  getSnapshotModalContext(): SnapshotModalContext {
    const stack = this.detect();
    return {
      modals: stack.modals,
      topModal: stack.topModal,
      hasBlockingModal: stack.hasBlockingModal,
      count: stack.count,
    };
  }

  /**
   * Convenience: get the topmost modal, if any.
   */
  getTopModal(): ModalInfo | undefined {
    return this.detect().topModal;
  }
}
