/**
 * Toast Capture Tests
 *
 * Tests for the ToastCapture class: detection of toast notifications,
 * level inference, dismissal tracking, and snapshot integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastCapture } from '../toast-capture';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Flush pending microtasks (MutationObserver callbacks) and advance
 * fake timers so the debounced scan runs.
 *
 * MutationObserver delivers via microtasks, so we need a real
 * async gap. Then we advance fake timers to trigger the
 * requestAnimationFrame / setTimeout debounce inside ToastCapture.
 */
async function flushAndScan(): Promise<void> {
  // Yield to microtask queue so MutationObserver fires
  await vi.advanceTimersByTimeAsync(0);
  // Advance past the debounce timeout (RAF is faked to ~16ms by jsdom)
  await vi.advanceTimersByTimeAsync(50);
}

/** Create a toast element with optional attributes */
function createToast(
  attrs: Record<string, string> = {},
  text = 'Test notification',
  tag = 'div'
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = value;
    } else {
      el.setAttribute(key, value);
    }
  }
  el.textContent = text;
  return el;
}

// ============================================================================
// Tests
// ============================================================================

describe('ToastCapture', () => {
  let capture: ToastCapture;
  let createdElements: HTMLElement[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    createdElements = [];
  });

  afterEach(() => {
    capture?.uninstall();
    for (const el of createdElements) {
      el.remove();
    }
    createdElements = [];
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  /** Create, track, and append an element to body */
  function addToast(
    attrs: Record<string, string> = {},
    text = 'Test notification',
    tag = 'div'
  ): HTMLElement {
    const el = createToast(attrs, text, tag);
    createdElements.push(el);
    document.body.appendChild(el);
    return el;
  }

  // --------------------------------------------------------------------------
  // 1. Empty snapshot when no toasts present
  // --------------------------------------------------------------------------
  it('should return empty snapshot when no toasts are present', () => {
    capture = new ToastCapture();
    capture.install();

    const snapshot = capture.getSnapshot();
    expect(snapshot.active).toEqual([]);
    expect(snapshot.recent).toEqual([]);
    expect(snapshot.totalCaptured).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 2. Detects [role="alert"] elements as toasts
  // --------------------------------------------------------------------------
  it('should detect [role="alert"] elements as toasts', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert' }, 'Something went wrong');
    await flushAndScan();

    const snapshot = capture.getSnapshot();
    expect(snapshot.active).toHaveLength(1);
    expect(snapshot.active[0].message).toBe('Something went wrong');
  });

  // --------------------------------------------------------------------------
  // 3. Detects [role="status"] elements as toasts
  // --------------------------------------------------------------------------
  it('should detect [role="status"] elements as toasts', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'status' }, 'Operation completed');
    await flushAndScan();

    const snapshot = capture.getSnapshot();
    expect(snapshot.active).toHaveLength(1);
    expect(snapshot.active[0].message).toBe('Operation completed');
  });

  // --------------------------------------------------------------------------
  // 4. Captures toast message text
  // --------------------------------------------------------------------------
  it('should capture toast message text correctly', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert' }, 'File saved successfully');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].message).toBe('File saved successfully');
  });

  // --------------------------------------------------------------------------
  // 5. Infers 'error' level from CSS class
  // --------------------------------------------------------------------------
  it('should infer error level from CSS class', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert', className: 'toast toast-error' }, 'Failed to save');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe('error');
  });

  // --------------------------------------------------------------------------
  // 6. Infers 'success' level from CSS class
  // --------------------------------------------------------------------------
  it('should infer success level from CSS class', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'status', className: 'notification success' }, 'Item created');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe('success');
  });

  // --------------------------------------------------------------------------
  // 7. Infers level from data-type attribute
  // --------------------------------------------------------------------------
  it('should infer level from data-type attribute', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert', 'data-type': 'warning' }, 'Low disk space');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe('warning');
  });

  // --------------------------------------------------------------------------
  // 8. Detects Sonner toast elements
  // --------------------------------------------------------------------------
  it('should detect Sonner toast elements', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ 'data-sonner-toast': '' }, 'Sonner notification');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].message).toBe('Sonner notification');
    expect(active[0].source).toBe('sonner');
  });

  // --------------------------------------------------------------------------
  // 9. Detects React-Toastify elements
  // --------------------------------------------------------------------------
  it('should detect React-Toastify elements', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ className: 'Toastify__toast' }, 'Toastify notification');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].message).toBe('Toastify notification');
    expect(active[0].source).toBe('react-toastify');
  });

  // --------------------------------------------------------------------------
  // 10. Detects action button in toast
  // --------------------------------------------------------------------------
  it('should detect action button inside toast', async () => {
    capture = new ToastCapture();
    capture.install();

    const el = createToast({ role: 'alert' }, '');
    const messageSpan = document.createElement('span');
    messageSpan.textContent = 'File deleted';
    el.appendChild(messageSpan);

    const actionBtn = document.createElement('button');
    actionBtn.textContent = 'Undo';
    el.appendChild(actionBtn);

    createdElements.push(el);
    document.body.appendChild(el);
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].hasAction).toBe(true);
    expect(active[0].actionText).toBe('Undo');
  });

  // --------------------------------------------------------------------------
  // 11. Tracks dismissal when element is removed from DOM
  // --------------------------------------------------------------------------
  it('should track dismissal when element is removed from DOM', async () => {
    capture = new ToastCapture();
    capture.install();

    const el = addToast({ role: 'alert' }, 'Temporary message');
    await flushAndScan();

    expect(capture.getActive()).toHaveLength(1);

    // Remove element from DOM
    el.remove();

    // Advance past the poll interval to trigger dismissal check
    await vi.advanceTimersByTimeAsync(600);

    expect(capture.getActive()).toHaveLength(0);
    expect(capture.getRecent()).toHaveLength(1);
    expect(capture.getRecent()[0].visible).toBe(false);
    expect(capture.getRecent()[0].dismissedAt).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 12. Keeps dismissed toasts in recent buffer
  // --------------------------------------------------------------------------
  it('should keep dismissed toasts in recent buffer', async () => {
    capture = new ToastCapture();
    capture.install();

    const el = addToast({ role: 'alert' }, 'Will be dismissed');
    await flushAndScan();

    el.remove();
    await vi.advanceTimersByTimeAsync(600);

    const snapshot = capture.getSnapshot();
    expect(snapshot.recent).toHaveLength(1);
    expect(snapshot.recent[0].message).toBe('Will be dismissed');
    expect(snapshot.recent[0].visible).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 13. Respects maxRecent buffer size
  // --------------------------------------------------------------------------
  it('should respect maxRecent buffer size', async () => {
    capture = new ToastCapture({ maxRecent: 3 });
    capture.install();

    // Create and dismiss 5 toasts sequentially
    for (let i = 0; i < 5; i++) {
      const el = addToast({ role: 'alert' }, `Toast ${i}`);
      await flushAndScan();

      el.remove();
      await vi.advanceTimersByTimeAsync(600);
    }

    const recent = capture.getRecent();
    expect(recent.length).toBeLessThanOrEqual(3);
  });

  // --------------------------------------------------------------------------
  // 14. totalCaptured increments correctly
  // --------------------------------------------------------------------------
  it('should increment totalCaptured for each new toast', async () => {
    capture = new ToastCapture();
    capture.install();

    expect(capture.getSnapshot().totalCaptured).toBe(0);

    addToast({ role: 'alert' }, 'First');
    await flushAndScan();
    expect(capture.getSnapshot().totalCaptured).toBe(1);

    addToast({ role: 'status' }, 'Second');
    await flushAndScan();
    expect(capture.getSnapshot().totalCaptured).toBe(2);

    addToast({ 'data-sonner-toast': '' }, 'Third');
    await flushAndScan();
    expect(capture.getSnapshot().totalCaptured).toBe(3);
  });

  // --------------------------------------------------------------------------
  // 15. Deduplicates (same element not captured twice)
  // --------------------------------------------------------------------------
  it('should not capture the same element twice', async () => {
    capture = new ToastCapture();
    capture.install();

    const el = addToast({ role: 'alert' }, 'Only once');
    await flushAndScan();
    expect(capture.getSnapshot().totalCaptured).toBe(1);

    // Trigger another mutation on the same element
    el.textContent = 'Updated text';
    await flushAndScan();

    expect(capture.getSnapshot().totalCaptured).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 16. getActive returns only visible toasts
  // --------------------------------------------------------------------------
  it('should return only visible toasts from getActive', async () => {
    capture = new ToastCapture();
    capture.install();

    const el1 = addToast({ role: 'alert' }, 'Visible toast');
    addToast({ role: 'status' }, 'Another visible toast');
    await flushAndScan();

    expect(capture.getActive()).toHaveLength(2);

    // Remove one
    el1.remove();
    await vi.advanceTimersByTimeAsync(600);

    expect(capture.getActive()).toHaveLength(1);
    expect(capture.getActive()[0].message).toBe('Another visible toast');
  });

  // --------------------------------------------------------------------------
  // 17. getRecent returns dismissed toasts
  // --------------------------------------------------------------------------
  it('should return dismissed toasts from getRecent', async () => {
    capture = new ToastCapture();
    capture.install();

    const el = addToast({ role: 'alert' }, 'Dismissed toast');
    await flushAndScan();

    expect(capture.getRecent()).toHaveLength(0);

    el.remove();
    await vi.advanceTimersByTimeAsync(600);

    const recent = capture.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].message).toBe('Dismissed toast');
  });

  // --------------------------------------------------------------------------
  // 18. uninstall stops observing
  // --------------------------------------------------------------------------
  it('should stop observing after uninstall', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert' }, 'Before uninstall');
    await flushAndScan();
    expect(capture.getSnapshot().totalCaptured).toBe(1);

    capture.uninstall();

    // New toasts should not be captured
    addToast({ role: 'alert' }, 'After uninstall');
    await flushAndScan();

    // totalCaptured should remain 1 -- data readable after uninstall
    expect(capture.getSnapshot().totalCaptured).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 19. Handles SSR (no document)
  // --------------------------------------------------------------------------
  it('should handle SSR environment gracefully', () => {
    const originalDocument = globalThis.document;
    // @ts-expect-error -- simulating SSR by removing document
    delete globalThis.document;

    try {
      capture = new ToastCapture();
      // install should not throw when document is undefined
      capture.install();

      const snapshot = capture.getSnapshot();
      expect(snapshot.active).toEqual([]);
      expect(snapshot.recent).toEqual([]);
      expect(snapshot.totalCaptured).toBe(0);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  // --------------------------------------------------------------------------
  // 20. onToastEvent callback fires on appear and dismiss
  // --------------------------------------------------------------------------
  it('should fire onToastEvent callback on appear and dismiss', async () => {
    capture = new ToastCapture();
    const callback = vi.fn();
    capture.install(callback);

    const el = addToast({ role: 'alert' }, 'Callback test');
    await flushAndScan();

    // Should have been called with 'appeared'
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'appeared',
        toast: expect.objectContaining({
          message: 'Callback test',
          visible: true,
        }),
      })
    );

    // Remove to dismiss
    el.remove();
    await vi.advanceTimersByTimeAsync(600);

    // Should have been called again with 'dismissed'
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'dismissed',
        toast: expect.objectContaining({
          message: 'Callback test',
          visible: false,
        }),
      })
    );
  });

  // --------------------------------------------------------------------------
  // Additional: getRecent with count parameter
  // --------------------------------------------------------------------------
  it('should respect count parameter in getRecent', async () => {
    capture = new ToastCapture();
    capture.install();

    for (let i = 0; i < 3; i++) {
      const el = addToast({ role: 'alert' }, `Toast ${i}`);
      await flushAndScan();
      el.remove();
      await vi.advanceTimersByTimeAsync(600);
    }

    expect(capture.getRecent(2)).toHaveLength(2);
    expect(capture.getRecent(1)).toHaveLength(1);
    expect(capture.getRecent(0)).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Additional: getSnapshotToastContext returns same data as getSnapshot
  // --------------------------------------------------------------------------
  it('should return matching data from getSnapshotToastContext', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert' }, 'Context test');
    await flushAndScan();

    const snapshot = capture.getSnapshot();
    const context = capture.getSnapshotToastContext();

    expect(context.active).toEqual(snapshot.active);
    expect(context.recent).toEqual(snapshot.recent);
    expect(context.totalCaptured).toBe(snapshot.totalCaptured);
  });

  // --------------------------------------------------------------------------
  // Additional: Custom selectors
  // --------------------------------------------------------------------------
  it('should detect elements matching custom selectors', async () => {
    capture = new ToastCapture({ customSelectors: ['.my-custom-toast'] });
    capture.install();

    addToast({ className: 'my-custom-toast' }, 'Custom selector toast');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].message).toBe('Custom selector toast');
  });

  // --------------------------------------------------------------------------
  // Additional: data-level attribute
  // --------------------------------------------------------------------------
  it('should infer level from data-level attribute', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert', 'data-level': 'success' }, 'Level attr test');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe('success');
  });

  // --------------------------------------------------------------------------
  // Additional: destructive class maps to error
  // --------------------------------------------------------------------------
  it('should infer error level from destructive CSS class', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert', className: 'toast destructive' }, 'Destructive');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe('error');
  });

  // --------------------------------------------------------------------------
  // Additional: uses element id as toast id
  // --------------------------------------------------------------------------
  it('should use element id as toast id when available', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert', id: 'my-toast-1' }, 'ID test');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('my-toast-1');
  });

  // --------------------------------------------------------------------------
  // Additional: close buttons are excluded from action detection
  // --------------------------------------------------------------------------
  it('should not count close buttons as action buttons', async () => {
    capture = new ToastCapture();
    capture.install();

    const el = createToast({ role: 'alert' }, '');
    el.textContent = 'Message text';

    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'close');
    closeBtn.textContent = '\u00d7';
    el.appendChild(closeBtn);

    createdElements.push(el);
    document.body.appendChild(el);
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].hasAction).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Additional: role="alert" defaults to error level
  // --------------------------------------------------------------------------
  it('should default role="alert" to error level when no other hint exists', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'alert' }, 'Alert without class hints');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe('error');
  });

  // --------------------------------------------------------------------------
  // Additional: role="status" defaults to info level
  // --------------------------------------------------------------------------
  it('should default role="status" to info level', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ role: 'status' }, 'Status message');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe('info');
  });

  // --------------------------------------------------------------------------
  // Regression: bare aria-live regions are NOT captured
  //
  // The walker used to include bare `[aria-live="polite"]` and
  // `[aria-live="assertive"]` in BUILT_IN_SELECTORS, which matched
  // persistent status-bar text (e.g. the runner's TerminalTabBar
  // "13 terminals open" + ZoneStatusBar "Analyzing: idle"). Those got
  // tracked indefinitely and surfaced `durationMs` in the hours range.
  // After tightening, bare aria-live alone must NOT trigger capture.
  // --------------------------------------------------------------------------
  it('should NOT capture an element with bare aria-live="polite"', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ 'aria-live': 'polite' }, 'Analyzing: idle');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(0);
    expect(capture.getSnapshot().totalCaptured).toBe(0);
  });

  it('should NOT capture an element with bare aria-live="assertive"', async () => {
    capture = new ToastCapture();
    capture.install();

    addToast({ 'aria-live': 'assertive' }, '13 terminals open');
    await flushAndScan();

    const active = capture.getActive();
    expect(active).toHaveLength(0);
    expect(capture.getSnapshot().totalCaptured).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Regression: role="status" + aria-live + persistent text is auto-dismissed
  //
  // role="status" remains a legitimate signal (deliberate ARIA widget), so an
  // element using it IS captured initially. But the max-age guard ensures it
  // does not linger in `active` indefinitely — after maxToastAgeMs the entry
  // is auto-dismissed and moves to `recent`, preventing the `durationMs`
  // drift the original bug surfaced.
  // --------------------------------------------------------------------------
  it('should auto-dismiss role="status" + aria-live persistent regions after maxToastAgeMs', async () => {
    capture = new ToastCapture({ maxToastAgeMs: 5_000, pollInterval: 500 });
    capture.install();

    addToast({ role: 'status', 'aria-live': 'polite' }, 'Analyzing: idle');
    await flushAndScan();

    // Initial capture happens (role="status" is legitimate)
    expect(capture.getActive()).toHaveLength(1);

    // Element stays in DOM (it's persistent) — advance past max-age window
    await vi.advanceTimersByTimeAsync(6_000);

    // Max-age guard should have moved it out of active into recent
    expect(capture.getActive()).toHaveLength(0);
    const recent = capture.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].message).toBe('Analyzing: idle');
    expect(recent[0].visible).toBe(false);
    expect(recent[0].dismissedAt).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Defense-in-depth: custom-selector toasts also dismissed after maxToastAgeMs
  //
  // If a user app registers a custom selector that matches a long-lived
  // element (e.g. a sticky modal banner), the max-age guard keeps the
  // capture bounded. This is the Fix B safety net for greedy app-provided
  // selectors.
  // --------------------------------------------------------------------------
  it('should auto-dismiss custom-selector toast after maxToastAgeMs', async () => {
    capture = new ToastCapture({
      customSelectors: ['.my-sticky-toast'],
      maxToastAgeMs: 3_000,
      pollInterval: 500,
    });
    capture.install();

    addToast({ className: 'my-sticky-toast' }, 'Persistent banner');
    await flushAndScan();

    expect(capture.getActive()).toHaveLength(1);

    // Advance well past max-age
    await vi.advanceTimersByTimeAsync(4_000);

    expect(capture.getActive()).toHaveLength(0);
    const recent = capture.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].message).toBe('Persistent banner');
    expect(recent[0].visible).toBe(false);
    expect(recent[0].dismissedAt).toBeDefined();
    // Duration should reflect the time-to-dismiss (approx max-age)
    expect(recent[0].durationMs).toBeGreaterThanOrEqual(3_000);
  });

  // --------------------------------------------------------------------------
  // Max-age guard: a short-lived toast (< maxToastAgeMs) is NOT auto-dismissed
  //
  // Sanity check that the guard only fires on genuinely long-lived elements
  // and doesn't preempt normal toast lifecycles.
  // --------------------------------------------------------------------------
  it('should NOT auto-dismiss a still-fresh toast under maxToastAgeMs', async () => {
    capture = new ToastCapture({ maxToastAgeMs: 10_000, pollInterval: 500 });
    capture.install();

    addToast({ role: 'alert' }, 'Fresh toast');
    await flushAndScan();

    // Advance only halfway through the window — should still be active
    await vi.advanceTimersByTimeAsync(3_000);

    expect(capture.getActive()).toHaveLength(1);
    expect(capture.getActive()[0].message).toBe('Fresh toast');
  });
});
