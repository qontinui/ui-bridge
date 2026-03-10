/**
 * Modal Detector Tests
 *
 * Tests for the modal/dialog stack detection system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModalDetector } from '../modal-detector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Elements created during a test, cleaned up in afterEach */
let createdElements: Element[] = [];

/** Create an element, append to body, and track for cleanup */
function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  innerHTML = ''
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  if (innerHTML) {
    el.innerHTML = innerHTML;
  }
  document.body.appendChild(el);
  createdElements.push(el);
  return el;
}

/** Set computed z-index on an element via inline style */
function setZIndex(el: HTMLElement, z: number): void {
  el.style.zIndex = String(z);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModalDetector', () => {
  let detector: ModalDetector;

  beforeEach(() => {
    detector = new ModalDetector();
    createdElements = [];
  });

  afterEach(() => {
    for (const el of createdElements) {
      el.remove();
    }
    createdElements = [];
  });

  // ========================================================================
  // 1. Empty state
  // ========================================================================

  it('returns empty stack when no modals are present', () => {
    const stack = detector.detect();
    expect(stack.modals).toEqual([]);
    expect(stack.topModal).toBeUndefined();
    expect(stack.hasBlockingModal).toBe(false);
    expect(stack.count).toBe(0);
    expect(stack.timestamp).toBeGreaterThan(0);
  });

  // ========================================================================
  // 2. Native <dialog open>
  // ========================================================================

  it('detects native <dialog open> elements', () => {
    createElement('dialog', { open: '' }, '<p>Hello</p>');

    const stack = detector.detect();
    expect(stack.count).toBe(1);
    expect(stack.modals[0].type).toBe('dialog');
  });

  // ========================================================================
  // 3. ARIA modal dialog
  // ========================================================================

  it('detects [role="dialog"][aria-modal="true"] elements', () => {
    createElement('div', { role: 'dialog', 'aria-modal': 'true' }, '<p>Content</p>');

    const stack = detector.detect();
    expect(stack.count).toBe(1);
    expect(stack.modals[0].type).toBe('dialog');
    expect(stack.modals[0].role).toBe('dialog');
    expect(stack.modals[0].blocking).toBe(true);
  });

  // ========================================================================
  // 4. Alert dialog
  // ========================================================================

  it('detects [role="alertdialog"] elements', () => {
    createElement('div', { role: 'alertdialog' }, '<p>Are you sure?</p>');

    const stack = detector.detect();
    expect(stack.count).toBe(1);
    expect(stack.modals[0].type).toBe('alertdialog');
    expect(stack.modals[0].blocking).toBe(true);
    expect(stack.modals[0].escDismiss).toBe(false);
  });

  // ========================================================================
  // 5. Title from aria-label
  // ========================================================================

  it('extracts title from aria-label', () => {
    createElement('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Settings Dialog',
    });

    const stack = detector.detect();
    expect(stack.modals[0].title).toBe('Settings Dialog');
  });

  // ========================================================================
  // 6. Title from aria-labelledby
  // ========================================================================

  it('extracts title from aria-labelledby', () => {
    createElement('span', { id: 'dlg-title' }, 'Confirm Delete');
    createElement('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'dlg-title',
    });

    const stack = detector.detect();
    expect(stack.modals[0].title).toBe('Confirm Delete');
  });

  // ========================================================================
  // 7. Title from h2 inside modal
  // ========================================================================

  it('extracts title from h2 inside modal', () => {
    createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true' },
      '<h2>Edit Profile</h2><p>Form here</p>'
    );

    const stack = detector.detect();
    expect(stack.modals[0].title).toBe('Edit Profile');
  });

  // ========================================================================
  // 8. Blocking status
  // ========================================================================

  it('determines blocking status correctly (aria-modal=true is blocking)', () => {
    createElement('div', { role: 'dialog', 'aria-modal': 'true' });

    const stack = detector.detect();
    expect(stack.modals[0].blocking).toBe(true);
    expect(stack.hasBlockingModal).toBe(true);
  });

  // ========================================================================
  // 9. z-index sorting
  // ========================================================================

  it('sorts modals by z-index (topmost last)', () => {
    const low = createElement('div', {
      id: 'modal-low',
      role: 'dialog',
      'aria-modal': 'true',
    });
    setZIndex(low, 100);

    const high = createElement('div', {
      id: 'modal-high',
      role: 'dialog',
      'aria-modal': 'true',
    });
    setZIndex(high, 9999);

    const mid = createElement('div', {
      id: 'modal-mid',
      role: 'dialog',
      'aria-modal': 'true',
    });
    setZIndex(mid, 500);

    const stack = detector.detect();
    expect(stack.count).toBe(3);
    expect(stack.modals[0].id).toBe('modal-low');
    expect(stack.modals[1].id).toBe('modal-mid');
    expect(stack.modals[2].id).toBe('modal-high');
    expect(stack.topModal?.id).toBe('modal-high');
  });

  // ========================================================================
  // 10. Deduplication
  // ========================================================================

  it('deduplicates elements matched by multiple selectors', () => {
    // This element matches both [role="dialog"][aria-modal="true"]
    // and [data-state="open"][role="dialog"]
    createElement('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'data-state': 'open',
    });

    const stack = detector.detect();
    expect(stack.count).toBe(1);
  });

  // ========================================================================
  // 11. Close button detection
  // ========================================================================

  it('finds close button with aria-label="Close"', () => {
    createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true' },
      '<button aria-label="Close">×</button><p>Content</p>'
    );

    const stack = detector.detect();
    expect(stack.modals[0].closeButton).toBeDefined();
  });

  it('finds close button with × character', () => {
    createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true' },
      '<button>×</button><p>Content</p>'
    );

    const stack = detector.detect();
    expect(stack.modals[0].closeButton).toBeDefined();
  });

  // ========================================================================
  // 12. Primary action detection
  // ========================================================================

  it('finds primary action button (submit type)', () => {
    createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true' },
      '<form><button type="submit">Save Changes</button></form>'
    );

    const stack = detector.detect();
    expect(stack.modals[0].primaryAction).toBe('Save Changes');
  });

  it('finds primary action button (primary class)', () => {
    createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true' },
      '<div class="footer"><button class="btn-primary">Confirm</button></div>'
    );

    const stack = detector.detect();
    expect(stack.modals[0].primaryAction).toBe('Confirm');
  });

  // ========================================================================
  // 13. topModal
  // ========================================================================

  it('returns topModal correctly', () => {
    const first = createElement('div', {
      id: 'first-modal',
      role: 'dialog',
      'aria-modal': 'true',
    });
    setZIndex(first, 10);

    const second = createElement('div', {
      id: 'second-modal',
      role: 'dialog',
      'aria-modal': 'true',
    });
    setZIndex(second, 20);

    const stack = detector.detect();
    expect(stack.topModal).toBeDefined();
    expect(stack.topModal?.id).toBe('second-modal');
  });

  it('getTopModal() convenience method works', () => {
    createElement('div', {
      id: 'only-modal',
      role: 'dialog',
      'aria-modal': 'true',
    });

    const top = detector.getTopModal();
    expect(top).toBeDefined();
    expect(top?.id).toBe('only-modal');
  });

  // ========================================================================
  // 14. getSnapshotModalContext shape
  // ========================================================================

  it('getSnapshotModalContext returns proper shape', () => {
    createElement('div', { role: 'dialog', 'aria-modal': 'true' });

    const ctx = detector.getSnapshotModalContext();
    expect(ctx).toHaveProperty('modals');
    expect(ctx).toHaveProperty('topModal');
    expect(ctx).toHaveProperty('hasBlockingModal');
    expect(ctx).toHaveProperty('count');
    expect(Array.isArray(ctx.modals)).toBe(true);
    expect(ctx.count).toBe(1);
    expect(ctx.hasBlockingModal).toBe(true);

    // Should NOT have timestamp (that's on ModalStack, not SnapshotModalContext)
    expect(ctx).not.toHaveProperty('timestamp');
  });

  it('getSnapshotModalContext returns empty when no modals', () => {
    const ctx = detector.getSnapshotModalContext();
    expect(ctx.modals).toEqual([]);
    expect(ctx.topModal).toBeUndefined();
    expect(ctx.hasBlockingModal).toBe(false);
    expect(ctx.count).toBe(0);
  });

  // ========================================================================
  // 15. SSR guard (no document)
  // ========================================================================

  it('handles no document (SSR guard)', () => {
    // Temporarily hide document
    const origDocument = globalThis.document;
    // @ts-expect-error — intentionally removing document for SSR test
    delete globalThis.document;

    try {
      const stack = detector.detect();
      expect(stack.modals).toEqual([]);
      expect(stack.count).toBe(0);
      expect(stack.hasBlockingModal).toBe(false);
    } finally {
      globalThis.document = origDocument;
    }
  });

  // ========================================================================
  // Additional: Library-specific selectors
  // ========================================================================

  it('detects Bootstrap modal.show', () => {
    createElement('div', { class: 'modal show' }, '<p>Bootstrap modal</p>');

    const stack = detector.detect();
    expect(stack.count).toBe(1);
  });

  it('detects Radix dialog with data-state="open"', () => {
    createElement('div', {
      'data-state': 'open',
      role: 'dialog',
    });

    const stack = detector.detect();
    expect(stack.count).toBe(1);
  });

  it('detects elements with custom selectors', () => {
    createElement('div', { class: 'my-custom-dialog' }, '<p>Custom</p>');

    const customDetector = new ModalDetector({
      customSelectors: ['.my-custom-dialog'],
    });

    const stack = customDetector.detect();
    expect(stack.count).toBe(1);
  });

  // ========================================================================
  // Additional: Config options
  // ========================================================================

  it('skips close button detection when detectCloseButton is false', () => {
    createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true' },
      '<button aria-label="Close">×</button><p>Content</p>'
    );

    const noClose = new ModalDetector({ detectCloseButton: false });
    const stack = noClose.detect();
    expect(stack.modals[0].closeButton).toBeUndefined();
  });

  it('skips primary action detection when detectPrimaryAction is false', () => {
    createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true' },
      '<button type="submit">Save</button>'
    );

    const noPrimary = new ModalDetector({ detectPrimaryAction: false });
    const stack = noPrimary.detect();
    expect(stack.modals[0].primaryAction).toBeUndefined();
  });

  // ========================================================================
  // Additional: Type resolution
  // ========================================================================

  it('resolves drawer type from class name', () => {
    createElement('div', {
      role: 'dialog',
      'aria-modal': 'true',
      class: 'MuiDrawer-root',
    });

    const stack = detector.detect();
    expect(stack.modals[0].type).toBe('drawer');
  });

  it('resolves alertdialog type from role', () => {
    createElement('div', { role: 'alertdialog' });

    const stack = detector.detect();
    expect(stack.modals[0].type).toBe('alertdialog');
  });

  // ========================================================================
  // Additional: Selector and ariaLabel
  // ========================================================================

  it('builds selector using element id', () => {
    createElement('div', {
      id: 'my-dialog',
      role: 'dialog',
      'aria-modal': 'true',
    });

    const stack = detector.detect();
    expect(stack.modals[0].selector).toBe('#my-dialog');
  });

  it('resolves ariaLabel from aria-label attribute', () => {
    createElement('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'User Preferences',
    });

    const stack = detector.detect();
    expect(stack.modals[0].ariaLabel).toBe('User Preferences');
  });

  it('resolves ariaLabel from aria-labelledby', () => {
    createElement('span', { id: 'pref-label' }, 'Preferences');
    createElement('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'pref-label',
    });

    const stack = detector.detect();
    expect(stack.modals[0].ariaLabel).toBe('Preferences');
  });

  // ========================================================================
  // Additional: ESC dismiss
  // ========================================================================

  it('native dialog is ESC-dismissable', () => {
    createElement('dialog', { open: '' });

    const stack = detector.detect();
    expect(stack.modals[0].escDismiss).toBe(true);
  });

  it('aria-modal dialog is ESC-dismissable', () => {
    createElement('div', { role: 'dialog', 'aria-modal': 'true' });

    const stack = detector.detect();
    expect(stack.modals[0].escDismiss).toBe(true);
  });

  it('alertdialog is NOT ESC-dismissable', () => {
    createElement('div', { role: 'alertdialog' });

    const stack = detector.detect();
    expect(stack.modals[0].escDismiss).toBe(false);
  });
});
