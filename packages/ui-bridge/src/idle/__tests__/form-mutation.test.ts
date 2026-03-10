/**
 * Form Mutation Detector Tests
 *
 * Tests for the FormMutationDetector which tracks form field changes
 * and reports settled/mutating state based on a debounce timer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FormMutationDetector } from '../form-mutation';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Dispatch an event on the document with a specified target element.
 * Uses bubbling so the document-level capture handler sees it.
 */
function dispatchFormEvent(
  eventType: string,
  target: HTMLElement,
  EventConstructor: typeof Event | typeof FocusEvent = Event
): void {
  const event = new EventConstructor(eventType, { bubbles: true });
  Object.defineProperty(event, 'target', { value: target, writable: false });
  document.dispatchEvent(event);
}

/**
 * Create an input element attached to the document body.
 */
function createFormElement(
  tag: 'input' | 'textarea' | 'select' = 'input',
  attrs: Record<string, string> = {}
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  document.body.appendChild(el);
  return el;
}

// ============================================================================
// Tests
// ============================================================================

describe('FormMutationDetector', () => {
  let detector: FormMutationDetector;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    detector?.destroy();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // ============================================================================
  // Configuration
  // ============================================================================

  describe('configuration', () => {
    it('should use default weight=0.5 and settleMs=800', () => {
      detector = new FormMutationDetector();
      expect(detector.weight).toBe(0.5);
      expect(detector.name).toBe('form-mutation');
    });

    it('should accept custom weight and settleMs', () => {
      detector = new FormMutationDetector({ weight: 0.8, settleMs: 500 });
      expect(detector.weight).toBe(0.8);
    });
  });

  // ============================================================================
  // Initial state
  // ============================================================================

  describe('initial state', () => {
    it('should start in idle/settled state', () => {
      detector = new FormMutationDetector();
      expect(detector.isIdle()).toBe(true);

      const status = detector.getStatus();
      expect(status.idle).toBe(true);
      expect(status.settled).toBe(true);
    });

    it('should have zero recent mutations initially', () => {
      detector = new FormMutationDetector();
      const status = detector.getStatus();
      expect(status.recentMutationCount).toBe(0);
    });

    it('should have no active field initially', () => {
      detector = new FormMutationDetector();
      const status = detector.getStatus();
      expect(status.activeFieldId).toBeUndefined();
    });
  });

  // ============================================================================
  // Install / destroy
  // ============================================================================

  describe('install and destroy', () => {
    it('should be idempotent on install (calling twice does not double-register)', () => {
      detector = new FormMutationDetector({ settleMs: 100 });
      detector.install();
      detector.install(); // second call should be no-op

      const input = createFormElement('input');
      const transitions: boolean[] = [];
      detector.onTransition((idle) => transitions.push(idle));

      dispatchFormEvent('input', input);

      // If double-registered, we'd see duplicate transitions
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toBe(false);
    });

    it('should clean up on destroy and be idempotent', () => {
      detector = new FormMutationDetector({ settleMs: 100 });
      detector.install();

      const input = createFormElement('input');

      // First event should be noticed
      dispatchFormEvent('input', input);
      expect(detector.isIdle()).toBe(false);

      // Settle
      vi.advanceTimersByTime(200);
      expect(detector.isIdle()).toBe(true);

      // Destroy
      detector.destroy();
      detector.destroy(); // second call should be no-op (idempotent)

      // Events after destroy should not be tracked
      dispatchFormEvent('input', input);
      expect(detector.isIdle()).toBe(true); // stays idle since destroyed
    });

    it('should clear settle timer on destroy', () => {
      detector = new FormMutationDetector({ settleMs: 500 });
      detector.install();

      const input = createFormElement('input');
      dispatchFormEvent('input', input);
      expect(detector.isIdle()).toBe(false);

      // Destroy while settle timer is pending
      detector.destroy();

      // Advancing time should not trigger a settle transition
      vi.advanceTimersByTime(1000);
      // No error thrown — timer was cleared
    });
  });

  // ============================================================================
  // Form event handling
  // ============================================================================

  describe('form event handling', () => {
    beforeEach(() => {
      detector = new FormMutationDetector({ settleMs: 200 });
      detector.install();
    });

    it('should transition to mutating on input event from form element', () => {
      const input = createFormElement('input');
      expect(detector.isIdle()).toBe(true);

      dispatchFormEvent('input', input);

      expect(detector.isIdle()).toBe(false);
      const status = detector.getStatus();
      expect(status.settled).toBe(false);
    });

    it('should transition to mutating on change event from form element', () => {
      const select = createFormElement('select');
      dispatchFormEvent('change', select);
      expect(detector.isIdle()).toBe(false);
    });

    it('should ignore events from non-form elements', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      dispatchFormEvent('input', div);
      expect(detector.isIdle()).toBe(true);

      const span = document.createElement('span');
      document.body.appendChild(span);

      dispatchFormEvent('change', span);
      expect(detector.isIdle()).toBe(true);
    });

    it('should settle after settleMs with no new events', () => {
      const input = createFormElement('input');

      dispatchFormEvent('input', input);
      expect(detector.isIdle()).toBe(false);

      // Advance to just before settle time
      vi.advanceTimersByTime(199);
      expect(detector.isIdle()).toBe(false);

      // Advance past settle time
      vi.advanceTimersByTime(2);
      expect(detector.isIdle()).toBe(true);
    });

    it('should reset settle timer on subsequent events', () => {
      const input = createFormElement('input');

      dispatchFormEvent('input', input);
      vi.advanceTimersByTime(150);

      // Another event resets the timer
      dispatchFormEvent('input', input);
      vi.advanceTimersByTime(150);

      // Should still be mutating (only 150ms since last event)
      expect(detector.isIdle()).toBe(false);

      // Advance remaining time
      vi.advanceTimersByTime(51);
      expect(detector.isIdle()).toBe(true);
    });
  });

  // ============================================================================
  // getStatus()
  // ============================================================================

  describe('getStatus', () => {
    it('should return correct fields', () => {
      detector = new FormMutationDetector({ settleMs: 200 });
      detector.install();

      const status = detector.getStatus();
      expect(status).toHaveProperty('idle');
      expect(status).toHaveProperty('settled');
      expect(status).toHaveProperty('lastMutationAt');
      expect(status).toHaveProperty('msSinceLastMutation');
      expect(status).toHaveProperty('recentMutationCount');
      expect(status).toHaveProperty('timestamp');
    });

    it('should track recentMutationCount within 1s window', () => {
      detector = new FormMutationDetector({ settleMs: 2000 });
      detector.install();

      const input = createFormElement('input');

      // Dispatch 3 events within 1s
      dispatchFormEvent('input', input);
      vi.advanceTimersByTime(200);
      dispatchFormEvent('input', input);
      vi.advanceTimersByTime(200);
      dispatchFormEvent('input', input);

      const status = detector.getStatus();
      expect(status.recentMutationCount).toBe(3);
    });

    it('should expire recentMutationCount entries older than 1s', () => {
      detector = new FormMutationDetector({ settleMs: 5000 });
      detector.install();

      const input = createFormElement('input');

      dispatchFormEvent('input', input);
      vi.advanceTimersByTime(500);
      dispatchFormEvent('input', input);

      // First event is still within 1s window
      expect(detector.getStatus().recentMutationCount).toBe(2);

      // Advance past 1s from first event
      vi.advanceTimersByTime(600);

      // First event should have expired
      expect(detector.getStatus().recentMutationCount).toBe(1);
    });

    it('should reflect lastMutationAt timestamp', () => {
      detector = new FormMutationDetector({ settleMs: 200 });
      detector.install();

      const input = createFormElement('input');
      const before = Date.now();

      dispatchFormEvent('input', input);

      const status = detector.getStatus();
      expect(status.lastMutationAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ============================================================================
  // Focus tracking
  // ============================================================================

  describe('focus tracking', () => {
    beforeEach(() => {
      detector = new FormMutationDetector({ settleMs: 200 });
      detector.install();
    });

    it('should set activeFieldId on focusin to form element by id', () => {
      const input = createFormElement('input', { id: 'username' });

      dispatchFormEvent('focusin', input, FocusEvent);

      const status = detector.getStatus();
      expect(status.activeFieldId).toBe('username');
    });

    it('should set activeFieldId on focusin to form element by name', () => {
      const input = createFormElement('input', { name: 'email' });

      dispatchFormEvent('focusin', input, FocusEvent);

      const status = detector.getStatus();
      expect(status.activeFieldId).toBe('email');
    });

    it('should clear activeFieldId on focusout from form element', () => {
      const input = createFormElement('input', { id: 'field1' });

      dispatchFormEvent('focusin', input, FocusEvent);
      expect(detector.getStatus().activeFieldId).toBe('field1');

      dispatchFormEvent('focusout', input, FocusEvent);
      expect(detector.getStatus().activeFieldId).toBeUndefined();
    });

    it('should not set activeFieldId for non-form elements', () => {
      const div = document.createElement('div');
      div.id = 'not-a-form-field';
      document.body.appendChild(div);

      dispatchFormEvent('focusin', div, FocusEvent);

      expect(detector.getStatus().activeFieldId).toBeUndefined();
    });
  });

  // ============================================================================
  // onTransition
  // ============================================================================

  describe('onTransition', () => {
    beforeEach(() => {
      detector = new FormMutationDetector({ settleMs: 200 });
      detector.install();
    });

    it('should fire callback on idle -> busy transition', () => {
      const transitions: Array<{ idle: boolean }> = [];
      detector.onTransition((idle) => transitions.push({ idle }));

      const input = createFormElement('input');
      dispatchFormEvent('input', input);

      expect(transitions).toHaveLength(1);
      expect(transitions[0].idle).toBe(false);
    });

    it('should fire callback on busy -> idle transition', () => {
      const transitions: Array<{ idle: boolean }> = [];
      detector.onTransition((idle) => transitions.push({ idle }));

      const input = createFormElement('input');
      dispatchFormEvent('input', input);

      // Settle
      vi.advanceTimersByTime(201);

      expect(transitions).toHaveLength(2);
      expect(transitions[0].idle).toBe(false); // idle -> busy
      expect(transitions[1].idle).toBe(true); // busy -> idle
    });

    it('should not fire duplicate transitions for repeated events', () => {
      const transitions: Array<{ idle: boolean }> = [];
      detector.onTransition((idle) => transitions.push({ idle }));

      const input = createFormElement('input');

      // Multiple input events while already mutating
      dispatchFormEvent('input', input);
      dispatchFormEvent('input', input);
      dispatchFormEvent('input', input);

      // Should only have one idle->busy transition
      expect(transitions).toHaveLength(1);
      expect(transitions[0].idle).toBe(false);
    });

    it('should return a working unsubscribe function', () => {
      const transitions: Array<{ idle: boolean }> = [];
      const unsubscribe = detector.onTransition((idle) => transitions.push({ idle }));

      const input = createFormElement('input');
      dispatchFormEvent('input', input);
      expect(transitions).toHaveLength(1);

      // Settle
      vi.advanceTimersByTime(201);
      expect(transitions).toHaveLength(2);

      // Unsubscribe
      unsubscribe();

      // Further transitions should not be captured
      dispatchFormEvent('input', input);
      vi.advanceTimersByTime(201);

      expect(transitions).toHaveLength(2); // no new entries
    });

    it('should not break the detector when a listener throws', () => {
      detector.onTransition(() => {
        throw new Error('listener error');
      });

      const safeCalls: boolean[] = [];
      detector.onTransition((idle) => safeCalls.push(idle));

      const input = createFormElement('input');

      // Should not throw
      expect(() => dispatchFormEvent('input', input)).not.toThrow();

      // Second listener should still have been called
      expect(safeCalls).toHaveLength(1);
      expect(safeCalls[0]).toBe(false);
    });
  });

  // ============================================================================
  // waitForIdle
  // ============================================================================

  describe('waitForIdle', () => {
    it('should resolve immediately when already settled', async () => {
      detector = new FormMutationDetector({ settleMs: 200 });
      detector.install();

      const promise = detector.waitForIdle({ timeout: 1000 });

      // Advance a tick for the internal check
      vi.advanceTimersByTime(50);

      const status = await promise;
      expect(status.settled).toBe(true);
    });

    it('should resolve after form mutations settle', async () => {
      detector = new FormMutationDetector({ settleMs: 200 });
      detector.install();

      const input = createFormElement('input');
      dispatchFormEvent('input', input);

      const promise = detector.waitForIdle({ timeout: 5000 });

      // Not settled yet
      vi.advanceTimersByTime(100);

      // Settle the detector
      vi.advanceTimersByTime(150);

      // Let waitForIdle polling pick it up
      vi.advanceTimersByTime(50);

      const status = await promise;
      expect(status.settled).toBe(true);
    });

    it('should reject on timeout', async () => {
      // Use settleMs much larger than timeout so the detector never settles
      detector = new FormMutationDetector({ settleMs: 10000 });
      detector.install();

      const input = createFormElement('input');

      // Single event puts detector in mutating state
      dispatchFormEvent('input', input);
      expect(detector.isIdle()).toBe(false);

      const promise = detector.waitForIdle({ timeout: 500 });

      // Advance past timeout but not past settleMs
      vi.advanceTimersByTime(600);

      await expect(promise).rejects.toThrow(/timeout/i);
    });
  });
});
